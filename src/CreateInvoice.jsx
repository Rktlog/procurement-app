import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { Document, Page, Text, View, StyleSheet, pdf, Image } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import logoUrl from './assets/project-clothing-logo.png';

// ---------------------------------------------------------------------------
// Company details. Matches the old subscription app's invoice exactly so
// customers see no difference.
// ---------------------------------------------------------------------------
const COMPANY = {
  name: 'Project Clothing',
  abn: '61110042427',
  addressLines: ['84 Stephenson St, Cremorne VIC 3121'],
  phone: '+61 3 8652 5444',
  email: 'hello@projectclothing.com.au',
  bank: {
    accountName: 'Project Clothing',
    bsb: '013-435',
    account: '220713053',
  },
  // Shown verbatim above the bank details, same wording as the old app's
  // output. Edit here if the account ever changes again.
  paymentNote: 'Our bank account has changed!',
};

const DOC_TYPES = {
  invoice: { label: 'INVOICE', prefix: 'INV', showPayment: true },
  quote: { label: 'Quote', prefix: 'Q', showPayment: false },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callProxy(body) {
  const { data, error } = await supabase.functions.invoke('shopify-proxy', { body });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'Shopify proxy returned no data.');
  return data;
}

const fmtMoney = (n, currency = 'AUD') =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(n) || 0);

const fmtDate = (d) =>
  (d ? new Date(d) : new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const addressLines = (a) =>
  !a
    ? []
    : [
        // The recipient's name is already shown as the bold line above
        // this block, so a.name is never repeated here -- comparing it
        // against the customer name string was fragile (case, whitespace,
        // or a company vs. contact name mismatch), and there's no case
        // where showing it twice is actually useful.
        [a.address1, a.address2].filter(Boolean).join(', '),
        a.city,
        [a.zip, a.countryCodeV2 === 'AU' ? 'Australia' : a.countryCodeV2].filter(Boolean).join(', '),
      ].filter(Boolean);

// Shopify's rolled-up subtotal/tax/total fields have come back as zero on
// some drafts here despite real line items -- likely a draft that hasn't
// gone through Shopify's own recalculate step. Rather than ship a $0.00
// invoice, recompute from the line items whenever the API total doesn't
// match what the lines actually add up to.
function getTotals(draft) {
  const linesSum = draft.lines.reduce((sum, l) => sum + (Number(l.line_total) || 0), 0);
  const apiSubtotal = Number(draft.subtotal) || 0;

  if (apiSubtotal > 0 && Math.abs(apiSubtotal - linesSum) < 0.5) {
    // API totals look trustworthy, use them as-is.
    return {
      subtotal: apiSubtotal,
      shipping: Number(draft.shipping) || 0,
      tax: Number(draft.tax) || 0,
      total: Number(draft.total) || 0,
      taxRateLabel: apiSubtotal > 0 && draft.tax > 0
        ? `${Math.round((draft.tax / apiSubtotal) * 100)}%`
        : '10%',
    };
  }

  // Fall back to line-item totals. GST rate assumed 10% (AU) since the
  // API didn't give us a reliable figure to derive the real rate from.
  const shipping = Number(draft.shipping) || 0;
  const subtotal = linesSum;
  const tax = draft.taxes_included ? subtotal - subtotal / 1.1 : subtotal * 0.1;
  const total = draft.taxes_included ? subtotal + shipping : subtotal + shipping + tax;

  return { subtotal, shipping, tax, total, taxRateLabel: '10%' };
}

// Fetches an image (logo or product thumbnail) and returns a base64 data
// URI. @react-pdf/renderer's browser build is unreliable pulling remote
// URLs directly at render time, so resolving to data URIs first is the
// dependable path -- same reason the QR code below is generated as one.
async function toDataUri(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Product thumbnails come from the Shopify CDN, and converting them to a
// data URI in-browser requires fetch() to actually read the bytes -- which
// the browser blocks unless that specific CDN response carries the right
// CORS header. A plain <img> tag can display the same image fine (no CORS
// involved in just rendering it), which is why the on-screen preview works
// but this direct-fetch path was silently failing. Routed through the
// proxy instead: server-to-server requests aren't subject to CORS at all.
async function toDataUriViaProxy(url) {
  const { data, error } = await supabase.functions.invoke('shopify-proxy', {
    body: { action: 'fetch_image_data_uri', imageUrl: url },
  });
  if (error || !data?.success) return null;
  return data.dataUri;
}

// ---------------------------------------------------------------------------
// PDF document
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: '#333333', fontFamily: 'Helvetica' },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 26 },
  logo: { width: 110, height: 75, objectFit: 'contain' },
  companyBlock: { width: '48%', alignItems: 'flex-end', textAlign: 'right' },
  companyName: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 2, color: '#111827' },
  companyLine: { color: '#4b5563', lineHeight: 1.5 },

  partiesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 22 },
  partyCol: { width: '25%' },
  partyLabel: { fontSize: 7.5, letterSpacing: 0.5, color: '#6b7280', marginBottom: 4 },
  partyName: { fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 2 },
  partyLine: { color: '#4b5563', lineHeight: 1.5 },

  docBlock: { width: '38%', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-start' },
  qr: { width: 50, height: 50, marginRight: 10, marginTop: 3 },
  docTitleWrap: { alignItems: 'flex-end' },
  docTitle: { fontSize: 24, color: '#111827', marginBottom: 4 },
  docMeta: { color: '#4b5563' },

  tHead: {
    flexDirection: 'row',
    backgroundColor: '#c2c2c2',
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  tHeadText: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#ffffff', letterSpacing: 0.3 },
  tRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
  },
  tRowShaded: { backgroundColor: '#f2f4f6' },

  cThumb: { width: '9%' },
  thumbImg: { width: 34, height: 34, objectFit: 'cover', borderRadius: 3 },
  cProduct: { width: '46%', paddingRight: 6 },
  productTitle: { color: '#111827', fontFamily: 'Helvetica-Bold', lineHeight: 1.4 },
  productVariant: { color: '#9ca3af', fontSize: 8, marginTop: 2 },
  cPrice: { width: '15%' },
  cQty: { width: '10%' },
  cTotal: { width: '20%', textAlign: 'right' },

  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
  },
  summaryLabel: { color: '#4b5563' },
  summaryTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#c2c2c2',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  summaryTotalLabel: { color: '#f3f4f6', fontFamily: 'Helvetica-Bold' },
  summaryTotalValue: { color: '#f3f4f6', fontFamily: 'Helvetica-Bold' },

  paymentBlock: { width: '48%' },
  paymentLabel: { fontSize: 7.5, letterSpacing: 0.5, color: '#6b7280', marginBottom: 5, fontFamily: 'Helvetica-Bold' },
  paymentNote: { color: '#111827', marginBottom: 4 },
  paymentLine: { color: '#4b5563', lineHeight: 1.5 },

  footer: { position: 'absolute', bottom: 40, left: 40, right: 40 },
  footerHead: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#111827', letterSpacing: 0.3, marginBottom: 2 },
  footerBody: { color: '#6b7280' },
});

function InvoicePDF({ draft, docType, docNumber, issuedAt, logoDataUri, qrDataUri, lineImages }) {
  const cfg = DOC_TYPES[docType];
  const cur = draft.currency || 'AUD';
  const totals = getTotals(draft);
  const billLines = addressLines(draft.billing_address);
  const shipLines = addressLines(draft.shipping_address);

  return (
    <Document title={`${docNumber} ${draft.customer_name}`}>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          {logoDataUri ? <Image src={logoDataUri} style={s.logo} /> : <View style={{ width: 110 }} />}

          <View style={s.companyBlock}>
            <Text style={s.companyName}>{COMPANY.name}</Text>
            <Text style={s.companyLine}>
              {[`ABN: ${COMPANY.abn}`, ...COMPANY.addressLines, `Phone: ${COMPANY.phone}`, `Email: ${COMPANY.email}`].join(
                '\n'
              )}
            </Text>
          </View>
        </View>

        <View style={s.partiesRow}>
          <View style={s.partyCol}>
            <Text style={s.partyLabel}>INVOICE TO</Text>
            <Text style={s.partyName}>{draft.customer_name || 'Customer'}</Text>
            <Text style={s.partyLine}>{(billLines.length ? billLines : ['—']).join('\n')}</Text>
          </View>

          <View style={s.partyCol}>
            <Text style={s.partyLabel}>SHIP TO</Text>
            <Text style={s.partyName}>{draft.customer_name || 'Customer'}</Text>
            <Text style={s.partyLine}>
              {(shipLines.length ? shipLines : billLines.length ? billLines : ['—']).join('\n')}
            </Text>
          </View>

          <View style={s.docBlock}>
            {qrDataUri && <Image src={qrDataUri} style={s.qr} />}
            <View style={s.docTitleWrap}>
              <Text style={s.docTitle}>{cfg.label}</Text>
              <Text style={s.docMeta}>#{docNumber}, {fmtDate(issuedAt)}</Text>
            </View>
          </View>
        </View>

        <View style={s.tHead}>
          <Text style={{ ...s.tHeadText, width: '9%' }}></Text>
          <Text style={{ ...s.tHeadText, width: '46%' }}>PRODUCT</Text>
          <Text style={{ ...s.tHeadText, width: '15%' }}>PRICE</Text>
          <Text style={{ ...s.tHeadText, width: '10%' }}>QTY</Text>
          <Text style={{ ...s.tHeadText, width: '20%', textAlign: 'right' }}>TOTAL</Text>
        </View>

        {draft.lines.map((l, i) => (
          <View key={i} style={[s.tRow, i % 2 === 1 ? s.tRowShaded : null]} wrap={false}>
            <View style={s.cThumb}>
              {lineImages[i] ? <Image src={lineImages[i]} style={s.thumbImg} /> : null}
            </View>
            <View style={s.cProduct}>
              <Text style={s.productTitle}>{l.title}</Text>
              {l.variant_title ? <Text style={s.productVariant}>{l.variant_title}</Text> : null}
            </View>
            <Text style={s.cPrice}>{fmtMoney(l.unit_price, cur)}</Text>
            <Text style={s.cQty}>{l.qty}</Text>
            <Text style={s.cTotal}>{fmtMoney(l.line_total, cur)}</Text>
          </View>
        ))}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
          {cfg.showPayment ? (
            <View style={s.paymentBlock}>
              <Text style={s.paymentLabel}>PAYMENT</Text>
              {COMPANY.paymentNote ? <Text style={s.paymentNote}>{COMPANY.paymentNote}</Text> : null}
              <Text style={s.paymentLine}>
                {[
                  COMPANY.bank.accountName,
                  `BSB: ${COMPANY.bank.bsb}`,
                  `Acc: ${COMPANY.bank.account}`,
                  `Ref: ${docNumber}`,
                ].join('\n')}
              </Text>
            </View>
          ) : (
            <View style={s.paymentBlock} />
          )}

          <View style={{ width: '48%' }}>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Subtotal</Text>
              <Text>{fmtMoney(totals.subtotal, cur)}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Shipping</Text>
              <Text>{fmtMoney(totals.shipping, cur)}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Tax {totals.taxRateLabel}</Text>
              <Text>{fmtMoney(totals.tax, cur)}</Text>
            </View>
            <View style={s.summaryTotalRow}>
              <Text style={s.summaryTotalLabel}>Total</Text>
              <Text style={s.summaryTotalValue}>{fmtMoney(totals.total, cur)}</Text>
            </View>
          </View>
        </View>

        {/* Pinned near the page bottom rather than following the content --
            matches the reference, where a short one-line invoice still
            leaves the footer sitting at the bottom margin instead of
            right under the totals. */}
        <View style={s.footer} fixed>
          <Text style={s.footerHead}>THANK YOU FOR YOUR BUSINESS</Text>
          <Text style={s.footerBody}>
            Thank you for your {docType === 'quote' ? 'interest in' : 'purchase from'} {COMPANY.name}.
            Please let us know if we can do anything else for you!
          </Text>
        </View>
      </Page>
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CreateInvoice() {
  const [drafts, setDrafts] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [search, setSearch] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const [docType, setDocType] = useState('invoice');
  const [downloading, setDownloading] = useState(false);

  const issuedAt = useMemo(() => new Date().toISOString(), [selectedId, docType]);

  // Not yet allocated from a database sequence -- see note in the previous
  // build. Numbers should only be assigned when the user commits to
  // issuing, not on every preview.
  const docNumber = useMemo(() => {
    const n = detail?.name?.replace(/\D/g, '') || 'PREVIEW';
    return `${DOC_TYPES[docType].prefix}-${n}`;
  }, [detail, docType]);

  const previewTotals = useMemo(() => (detail ? getTotals(detail) : null), [detail]);

  useEffect(() => {
    loadDrafts();
  }, []);

  const loadDrafts = async (cursor = null) => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await callProxy({ action: 'fetch_draft_orders', cursor });
      setDrafts((prev) => (cursor ? [...prev, ...res.draftOrders] : res.draftOrders));
      setPageInfo(res.pageInfo);
    } catch (err) {
      setListError(err.message);
    }
    setListLoading(false);
  };

  const openDraft = async (id) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await callProxy({ action: 'fetch_draft_order', draftOrderId: id });
      setDetail(res.draftOrder);
    } catch (err) {
      setDetailError(err.message);
    }
    setDetailLoading(false);
  };

  const downloadPdf = async () => {
    if (!detail) return;
    setDownloading(true);
    try {
      const [logoDataUri, lineImages] = await Promise.all([
        toDataUri(logoUrl).catch(() => null),
        Promise.all(
          detail.lines.map((l) => (l.image_url ? toDataUriViaProxy(l.image_url) : null))
        ),
      ]);

      // QR encodes the plain document number as text, not a link -- it
      // isn't wired to anything, it's just a scannable reference.
      const qrDataUri = await QRCode.toDataURL(docNumber, { margin: 1, width: 200 });

      const blob = await pdf(
        <InvoicePDF
          draft={detail}
          docType={docType}
          docNumber={docNumber}
          issuedAt={issuedAt}
          logoDataUri={logoDataUri}
          qrDataUri={qrDataUri}
          lineImages={lineImages}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${docNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDetailError(`Couldn't build the PDF: ${err.message}`);
    }
    setDownloading(false);
  };

  const emailHref = useMemo(() => {
    if (!detail) return '#';
    const cfg = DOC_TYPES[docType];
    const subject = `${cfg.label === 'INVOICE' ? 'Invoice' : cfg.label} ${docNumber} from ${COMPANY.name}`;
    const body = [
      `Hi ${detail.customer_name || 'there'},`,
      '',
      `Please find attached ${cfg.label === 'INVOICE' ? 'invoice' : 'quote'} ${docNumber} for ${fmtMoney(
        detail.total,
        detail.currency
      )}.`,
      ...(docType === 'invoice' && detail.invoice_url ? ['', `To pay by card: ${detail.invoice_url}`] : []),
      '',
      'Thanks,',
      COMPANY.name,
    ].join('\n');
    return `mailto:${detail.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [detail, docType, docNumber]);

  const visibleDrafts = drafts.filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.name?.toLowerCase().includes(q) ||
      d.customer_name?.toLowerCase().includes(q) ||
      d.email?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/80 rounded-xl p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
            🧾
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 leading-tight">Create invoice</h3>
            <p className="text-[11px] text-slate-500">
              Build a tax invoice or quotation from a Shopify draft order
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by order, name or email"
            className="text-[11px] bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
          />
          <button
            onClick={() => loadDrafts()}
            disabled={listLoading}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50 h-8 flex items-center gap-1.5"
          >
            {listLoading ? (
              <>
                <span className="inline-block animate-spin">🔄</span> Loading
              </>
            ) : (
              'Refresh drafts'
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 items-start">
        <div className="lg:col-span-2 bg-white border border-slate-200/80 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700">
              Open drafts{drafts.length ? ` (${visibleDrafts.length})` : ''}
            </span>
          </div>

          {listError && (
            <div className="m-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-md">
              <div className="font-bold mb-0.5">Couldn't load draft orders</div>
              {listError}
              {/read_draft_orders|Access denied|not approved/i.test(listError) && (
                <div className="mt-1.5 text-red-600">
                  Add the read_draft_orders scope to the Shopify app, then redeploy
                  shopify-proxy so it mints a new token.
                </div>
              )}
            </div>
          )}

          {!listError && !listLoading && visibleDrafts.length === 0 && (
            <div className="p-6 text-center text-[11px] text-slate-500">
              No open draft orders. Create one in Shopify and refresh.
            </div>
          )}

          <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
            {visibleDrafts.map((d) => {
              const active = d.shopify_id === selectedId;
              return (
                <button
                  key={d.shopify_id}
                  onClick={() => openDraft(d.shopify_id)}
                  className={`w-full text-left px-3 py-2.5 cursor-pointer transition-colors ${
                    active ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {d.name} · {d.customer_name || 'No customer'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {d.email || 'No email'} · {fmtDate(d.updated_at)}
                      </div>
                      {d.lines_needing_sku > 0 && (
                        <div className="text-[10px] font-bold text-amber-700 mt-1">
                          {d.lines_needing_sku} custom line
                          {d.lines_needing_sku > 1 ? 's' : ''} without a SKU
                        </div>
                      )}
                    </div>
                    <div className="text-xs font-bold text-slate-900 whitespace-nowrap">
                      {fmtMoney(d.total, d.currency)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {pageInfo?.hasNextPage && (
            <div className="p-2 border-t border-slate-100">
              <button
                onClick={() => loadDrafts(pageInfo.endCursor)}
                disabled={listLoading}
                className="w-full text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md py-1.5 cursor-pointer disabled:opacity-50"
              >
                Load more
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 bg-white border border-slate-200/80 rounded-xl shadow-2xs">
          {!selectedId && (
            <div className="p-10 text-center text-[11px] text-slate-500">
              Pick a draft order to build a document from it.
            </div>
          )}

          {detailLoading && (
            <div className="p-10 text-center text-[11px] text-slate-500">Loading draft order...</div>
          )}

          {detailError && (
            <div className="m-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-md">
              {detailError}
            </div>
          )}

          {detail && !detailLoading && (
            <>
              <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                  {Object.entries(DOC_TYPES).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => setDocType(key)}
                      className={`px-3 py-1 text-[11px] font-bold rounded cursor-pointer ${
                        docType === key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {cfg.label === 'INVOICE' ? 'Invoice' : cfg.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={emailHref}
                    className="text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-2.5 py-1.5 rounded-md cursor-pointer"
                  >
                    Draft email
                  </a>
                  <button
                    onClick={downloadPdf}
                    disabled={downloading}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-1.5 rounded-md cursor-pointer disabled:opacity-50"
                  >
                    {downloading ? 'Building PDF...' : 'Download PDF'}
                  </button>
                </div>
              </div>

              {detail.lines_needing_sku > 0 && (
                <div className="mx-3 mt-3 p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] rounded-md">
                  {detail.lines_needing_sku} hand-typed line
                  {detail.lines_needing_sku > 1 ? 's have' : ' has'} no SKU. Fine for a
                  document like this, but won't match anything in Cin7 later.
                </div>
              )}

              <div className="p-5">
                <div className="border border-slate-200 rounded-lg p-5 text-[11px] text-slate-700">
                  <div className="flex justify-between gap-6 mb-6">
                    <img src={logoUrl} alt="" className="h-14 object-contain" />
                    <div className="text-right text-slate-500 leading-relaxed">
                      <div className="text-sm font-bold text-slate-900">{COMPANY.name}</div>
                      <div>ABN: {COMPANY.abn}</div>
                      {COMPANY.addressLines.map((l) => (
                        <div key={l}>{l}</div>
                      ))}
                      <div>Phone: {COMPANY.phone}</div>
                      <div>Email: {COMPANY.email}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-5">
                    <div>
                      <div className="text-[9px] tracking-wide text-slate-400 mb-1">INVOICE TO</div>
                      <div className="font-bold text-slate-900">{detail.customer_name}</div>
                      {(addressLines(detail.billing_address).length
                        ? addressLines(detail.billing_address)
                        : ['—']
                      ).map((l, i) => (
                        <div key={i} className="text-slate-500 leading-relaxed">{l}</div>
                      ))}
                    </div>
                    <div>
                      <div className="text-[9px] tracking-wide text-slate-400 mb-1">SHIP TO</div>
                      <div className="font-bold text-slate-900">{detail.customer_name}</div>
                      {(addressLines(detail.shipping_address).length
                        ? addressLines(detail.shipping_address)
                        : ['—']
                      ).map((l, i) => (
                        <div key={i} className="text-slate-500 leading-relaxed">{l}</div>
                      ))}
                    </div>
                    <div className="text-right">
                      <div className="text-xl text-slate-900">
                        {DOC_TYPES[docType].label === 'INVOICE' ? 'INVOICE' : 'Quote'}
                      </div>
                      <div className="text-slate-500">#{docNumber}, {fmtDate(issuedAt)}</div>
                    </div>
                  </div>

                  <table className="w-full">
                    <thead>
                      <tr style={{ backgroundColor: '#c2c2c2' }} className="text-white">
                        <th className="text-left py-1.5 px-2 font-bold w-10"></th>
                        <th className="text-left py-1.5 px-2 font-bold">PRODUCT</th>
                        <th className="text-left py-1.5 px-2 font-bold">PRICE</th>
                        <th className="text-left py-1.5 px-2 font-bold">QTY</th>
                        <th className="text-right py-1.5 px-2 font-bold">TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l, i) => (
                        <tr key={i} className={i % 2 === 1 ? 'bg-slate-50' : ''}>
                          <td className="py-2 px-2">
                            {l.image_url && (
                              <img src={l.image_url} alt="" className="w-7 h-7 object-cover rounded" />
                            )}
                          </td>
                          <td className="py-2 px-2">
                            <div className="font-bold text-slate-900">{l.title}</div>
                            {l.variant_title && (
                              <div className="text-slate-400 text-[10px] mt-0.5">{l.variant_title}</div>
                            )}
                          </td>
                          <td className="py-2 px-2">{fmtMoney(l.unit_price, detail.currency)}</td>
                          <td className="py-2 px-2">{l.qty}</td>
                          <td className="py-2 px-2 text-right">
                            {fmtMoney(l.line_total, detail.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="mt-3.5 flex justify-between items-start">
                    {docType === 'invoice' ? (
                      <div className="w-56">
                        <div className="text-[9px] tracking-wide text-slate-400 mb-1.5">PAYMENT</div>
                        <div className="text-slate-900">{COMPANY.paymentNote}</div>
                        <div className="text-slate-500">{COMPANY.bank.accountName}</div>
                        <div className="text-slate-500">BSB: {COMPANY.bank.bsb}</div>
                        <div className="text-slate-500">Acc: {COMPANY.bank.account}</div>
                        <div className="text-slate-500">Ref: {docNumber}</div>
                      </div>
                    ) : (
                      <div className="w-56" />
                    )}

                    <div className="w-64">
                      <div className="flex justify-between py-1.5 border-b border-slate-100">
                        <span className="text-slate-500">Subtotal</span>
                        <span>{fmtMoney(previewTotals.subtotal, detail.currency)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-100">
                        <span className="text-slate-500">Shipping</span>
                        <span>{fmtMoney(previewTotals.shipping, detail.currency)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-100">
                        <span className="text-slate-500">Tax {previewTotals.taxRateLabel}</span>
                        <span>{fmtMoney(previewTotals.tax, detail.currency)}</span>
                      </div>
                      <div
                        className="flex justify-between py-2 px-2 mt-1 font-bold text-white"
                        style={{ backgroundColor: '#c2c2c2' }}
                      >
                        <span>Total</span>
                        <span>{fmtMoney(previewTotals.total, detail.currency)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { Document, Page, Text, View, StyleSheet, pdf, Image } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import logoUrl from './assets/project-clothing-logo.png';

// ---------------------------------------------------------------------------
// Company details. Matches the subscription app's output exactly.
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
  (d ? new Date(d) : new Date()).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

// Address helper matching the preview format (each part on a new line with commas)
const addressLines = (a) => {
  if (!a) return [];
  const lines = [];
  if (a.address1) lines.push(`${a.address1},`);
  if (a.address2) lines.push(`${a.address2},`);
  if (a.city) lines.push(`${a.city},`);
  
  const country = a.countryCodeV2 === 'AU' ? 'Australia' : a.countryCodeV2 || '';
  const zipCountry = [a.zip, country].filter(Boolean).join(', ');
  if (zipCountry) lines.push(zipCountry);

  return lines;
};

function getTotals(draft) {
  const linesSum = draft.lines.reduce((sum, l) => sum + (Number(l.line_total) || 0), 0);
  const apiSubtotal = Number(draft.subtotal) || 0;

  if (apiSubtotal > 0 && Math.abs(apiSubtotal - linesSum) < 0.5) {
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

  const shipping = Number(draft.shipping) || 0;
  const subtotal = linesSum;
  const tax = draft.taxes_included ? subtotal - subtotal / 1.1 : subtotal * 0.1;
  const total = draft.taxes_included ? subtotal + shipping : subtotal + shipping + tax;

  return { subtotal, shipping, tax, total, taxRateLabel: '10%' };
}

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

// ---------------------------------------------------------------------------
// PDF Document Stylesheet (Target Matching)
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  page: { padding: 35, fontSize: 8.5, color: '#333333', fontFamily: 'Helvetica' },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  logo: { width: 95, height: 45, objectFit: 'contain' },
  companyBlock: { width: '48%', alignItems: 'flex-end', textAlign: 'right' },
  companyName: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginBottom: 2, color: '#111827' },
  companyLine: { color: '#4b5563', lineHeight: 1.3 },

  partiesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  partyCol: { width: '30%' },
  partyLabel: { fontSize: 7, letterSpacing: 0.5, color: '#6b7280', marginBottom: 3, fontFamily: 'Helvetica-Bold' },
  partyName: { fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 2 },
  partyLine: { color: '#4b5563', lineHeight: 1.3 },

  docBlock: { width: '35%', alignItems: 'flex-end' },
  docTitle: { fontSize: 22, color: '#111827', marginBottom: 2, fontFamily: 'Helvetica' },
  docMeta: { color: '#4b5563' },

  tHead: {
    flexDirection: 'row',
    backgroundColor: '#c2c2c2',
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 4,
  },
  tHeadText: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#ffffff', letterSpacing: 0.3 },
  tRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
  },
  tRowShaded: { backgroundColor: '#f9fafb' },

  cProduct: { width: '55%', paddingRight: 6 },
  productTitle: { color: '#111827', fontFamily: 'Helvetica-Bold', lineHeight: 1.3 },
  productVariant: { color: '#6b7280', fontSize: 8, marginTop: 1 },
  cPrice: { width: '15%' },
  cQty: { width: '10%' },
  cTotal: { width: '20%', textAlign: 'right' },

  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
  },
  summaryLabel: { color: '#4b5563' },
  summaryTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#c2c2c2',
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  summaryTotalLabel: { color: '#ffffff', fontFamily: 'Helvetica-Bold' },
  summaryTotalValue: { color: '#ffffff', fontFamily: 'Helvetica-Bold' },

  paymentBlock: { width: '45%' },
  paymentLabel: { fontSize: 7, letterSpacing: 0.5, color: '#6b7280', marginBottom: 3, fontFamily: 'Helvetica-Bold' },
  paymentNote: { color: '#111827', marginBottom: 2, fontFamily: 'Helvetica-Bold' },
  paymentLine: { color: '#4b5563', lineHeight: 1.3 },

  footer: { position: 'absolute', bottom: 35, left: 35, right: 35 },
  footerHead: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#111827', letterSpacing: 0.3, marginBottom: 2 },
  footerBody: { color: '#6b7280', lineHeight: 1.3 },
});

function InvoicePDF({ draft, docType, docNumber, issuedAt, logoDataUri }) {
  const cfg = DOC_TYPES[docType];
  const cur = draft.currency || 'AUD';
  const totals = getTotals(draft);
  const billLines = addressLines(draft.billing_address);
  const shipLines = addressLines(draft.shipping_address);

  return (
    <Document title={`${docNumber} ${draft.customer_name}`}>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          {logoDataUri ? <Image src={logoDataUri} style={s.logo} /> : <View style={{ width: 95 }} />}

          <View style={s.companyBlock}>
            <Text style={s.companyName}>{COMPANY.name}</Text>
            <Text style={s.companyLine}>
              {[`ABN: ${COMPANY.abn}`, ...COMPANY.addressLines, `Phone: ${COMPANY.phone}`, `Email: ${COMPANY.email}`].join('\n')}
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
            <Text style={s.docTitle}>{cfg.label}</Text>
            <Text style={s.docMeta}>#{docNumber}, {fmtDate(issuedAt)}</Text>
          </View>
        </View>

        <View style={s.tHead}>
          <Text style={{ ...s.tHeadText, width: '55%' }}>PRODUCT</Text>
          <Text style={{ ...s.tHeadText, width: '15%' }}>PRICE</Text>
          <Text style={{ ...s.tHeadText, width: '10%' }}>QTY</Text>
          <Text style={{ ...s.tHeadText, width: '20%', textAlign: 'right' }}>TOTAL</Text>
        </View>

        {draft.lines.map((l, i) => (
          <View key={i} style={[s.tRow, i % 2 === 1 ? s.tRowShaded : null]} wrap={false}>
            <View style={s.cProduct}>
              <Text style={s.productTitle}>{l.title}</Text>
              {l.variant_title ? <Text style={s.productVariant}>{l.variant_title}</Text> : null}
            </View>
            <Text style={s.cPrice}>{fmtMoney(l.unit_price, cur)}</Text>
            <Text style={s.cQty}>{l.qty}</Text>
            <Text style={s.cTotal}>{fmtMoney(l.line_total, cur)}</Text>
          </View>
        ))}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
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
// Screen Component
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
      const logoDataUri = await toDataUri(logoUrl).catch(() => null);

      const blob = await pdf(
        <InvoicePDF
          draft={detail}
          docType={docType}
          docNumber={docNumber}
          issuedAt={issuedAt}
          logoDataUri={logoDataUri}
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
            {listLoading ? 'Loading...' : 'Refresh drafts'}
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
                    </div>
                    <div className="text-xs font-bold text-slate-900 whitespace-nowrap">
                      {fmtMoney(d.total, d.currency)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
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

              <div className="p-5">
                <div className="border border-slate-200 rounded-lg p-5 text-[11px] text-slate-700">
                  <div className="flex justify-between gap-6 mb-4">
                    <img src={logoUrl} alt="" className="h-12 object-contain" />
                    <div className="text-right text-slate-500 leading-tight">
                      <div className="text-sm font-bold text-slate-900">{COMPANY.name}</div>
                      <div>ABN: {COMPANY.abn}</div>
                      {COMPANY.addressLines.map((l) => (
                        <div key={l}>{l}</div>
                      ))}
                      <div>Phone: {COMPANY.phone}</div>
                      <div>Email: {COMPANY.email}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <div className="text-[9px] tracking-wide text-slate-400 mb-1">INVOICE TO</div>
                      <div className="font-bold text-slate-900">{detail.customer_name}</div>
                      {addressLines(detail.billing_address).map((l, i) => (
                        <div key={i} className="text-slate-500 leading-tight">{l}</div>
                      ))}
                    </div>
                    <div>
                      <div className="text-[9px] tracking-wide text-slate-400 mb-1">SHIP TO</div>
                      <div className="font-bold text-slate-900">{detail.customer_name}</div>
                      {addressLines(detail.shipping_address).map((l, i) => (
                        <div key={i} className="text-slate-500 leading-tight">{l}</div>
                      ))}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-slate-900">
                        {DOC_TYPES[docType].label === 'INVOICE' ? 'INVOICE' : 'Quote'}
                      </div>
                      <div className="text-slate-500">#{docNumber}, {fmtDate(issuedAt)}</div>
                    </div>
                  </div>

                  <table className="w-full">
                    <thead>
                      <tr style={{ backgroundColor: '#c2c2c2' }} className="text-white">
                        <th className="text-left py-1 px-2 font-bold">PRODUCT</th>
                        <th className="text-left py-1 px-2 font-bold">PRICE</th>
                        <th className="text-left py-1 px-2 font-bold">QTY</th>
                        <th className="text-right py-1 px-2 font-bold">TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l, i) => (
                        <tr key={i} className={i % 2 === 1 ? 'bg-slate-50' : ''}>
                          <td className="py-1 px-2">
                            <div className="font-bold text-slate-900">{l.title}</div>
                            {l.variant_title && (
                              <div className="text-slate-400 text-[10px]">{l.variant_title}</div>
                            )}
                          </td>
                          <td className="py-1 px-2">{fmtMoney(l.unit_price, detail.currency)}</td>
                          <td className="py-1 px-2">{l.qty}</td>
                          <td className="py-1 px-2 text-right">
                            {fmtMoney(l.line_total, detail.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="mt-3 flex justify-between items-start">
                    {docType === 'invoice' ? (
                      <div className="w-56 leading-tight">
                        <div className="text-[9px] tracking-wide text-slate-400 mb-1">PAYMENT</div>
                        <div className="text-slate-900 font-bold">{COMPANY.paymentNote}</div>
                        <div className="text-slate-500">{COMPANY.bank.accountName}</div>
                        <div className="text-slate-500">BSB: {COMPANY.bank.bsb}</div>
                        <div className="text-slate-500">Acc: {COMPANY.bank.account}</div>
                        <div className="text-slate-500">Ref: {docNumber}</div>
                      </div>
                    ) : (
                      <div className="w-56" />
                    )}

                    <div className="w-64">
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">Subtotal</span>
                        <span>{fmtMoney(previewTotals.subtotal, detail.currency)}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">Shipping</span>
                        <span>{fmtMoney(previewTotals.shipping, detail.currency)}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">Tax {previewTotals.taxRateLabel}</span>
                        <span>{fmtMoney(previewTotals.tax, detail.currency)}</span>
                      </div>
                      <div
                        className="flex justify-between py-1.5 px-2 mt-1 font-bold text-white"
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
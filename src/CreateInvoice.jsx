import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';

// ---------------------------------------------------------------------------
// EDIT THESE. They appear on every document you issue.
// An Australian tax invoice must show the seller's identity and ABN, so the
// ABN is not optional if you're issuing invoices rather than quotes.
// ---------------------------------------------------------------------------
const COMPANY = {
  name: 'Rocket Logistics',
  abn: '00 000 000 000',
  addressLines: ['Unit 0, 000 Example Road', 'Melbourne VIC 3000', 'Australia'],
  email: 'accounts@example.com.au',
  phone: '+61 3 0000 0000',
  bank: {
    name: 'Rocket Logistics Pty Ltd',
    bsb: '000-000',
    account: '0000 0000',
  },
};

const DOC_TYPES = {
  invoice: {
    label: 'Tax invoice',
    prefix: 'INV',
    showDue: true,
    showPayment: true,
    intro: 'Payment is due by the date shown above.',
  },
  quote: {
    label: 'Quotation',
    prefix: 'QUO',
    showDue: false,
    showPayment: false,
    intro: 'This quotation is valid for 30 days from the date of issue.',
  },
};

const DEFAULT_TERMS_DAYS = 14;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callProxy(body) {
  const { data, error } = await supabase.functions.invoke('shopify-proxy', { body });

  if (error) {
    // invoke only surfaces the status, so the real message is in the body.
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'Shopify proxy returned no data.');
  return data;
}

const fmtMoney = (n, currency = 'AUD') =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(n) || 0);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const addressLines = (a) =>
  !a
    ? []
    : [
        a.company,
        a.name,
        a.address1,
        a.address2,
        [a.city, a.provinceCode, a.zip].filter(Boolean).join(' '),
        a.countryCodeV2,
      ].filter(Boolean);

// ---------------------------------------------------------------------------
// PDF document
// ---------------------------------------------------------------------------

const pdfStyles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: '#1e293b', fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
  company: { width: '55%' },
  companyName: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  meta: { width: '40%', alignItems: 'flex-end' },
  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  metaLine: { flexDirection: 'row', marginBottom: 2 },
  metaKey: { color: '#64748b', marginRight: 6 },
  muted: { color: '#64748b', lineHeight: 1.5 },
  partiesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  party: { width: '48%' },
  partyLabel: { fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  tHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingBottom: 4,
    marginBottom: 2,
    fontFamily: 'Helvetica-Bold',
  },
  tRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 5,
  },
  cDesc: { width: '46%', paddingRight: 6 },
  cSku: { width: '18%', paddingRight: 6 },
  cQty: { width: '10%', textAlign: 'right' },
  cUnit: { width: '13%', textAlign: 'right' },
  cTotal: { width: '13%', textAlign: 'right' },
  totals: { marginTop: 14, alignItems: 'flex-end' },
  totalLine: { flexDirection: 'row', width: 200, justifyContent: 'space-between', paddingVertical: 2 },
  grandTotal: {
    flexDirection: 'row',
    width: 200,
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    marginTop: 4,
    paddingTop: 5,
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  footer: { marginTop: 28, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: '#e2e8f0' },
  payBlock: { marginTop: 10 },
  payLabel: { fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  link: { color: '#2563eb' },
});

function InvoicePDF({ draft, docType, docNumber, issuedAt, dueAt }) {
  const cfg = DOC_TYPES[docType];
  const cur = draft.currency || 'AUD';

  return (
    <Document title={`${docNumber} ${draft.customer_name}`}>
      <Page size="A4" style={pdfStyles.page}>
        <View style={pdfStyles.headerRow}>
          <View style={pdfStyles.company}>
            <Text style={pdfStyles.companyName}>{COMPANY.name}</Text>
            <Text style={pdfStyles.muted}>
              {COMPANY.addressLines.join('\n')}
              {'\n'}ABN {COMPANY.abn}
              {'\n'}{COMPANY.email} · {COMPANY.phone}
            </Text>
          </View>

          <View style={pdfStyles.meta}>
            <Text style={pdfStyles.docTitle}>{cfg.label}</Text>
            <View style={pdfStyles.metaLine}>
              <Text style={pdfStyles.metaKey}>Number</Text>
              <Text>{docNumber}</Text>
            </View>
            <View style={pdfStyles.metaLine}>
              <Text style={pdfStyles.metaKey}>Issued</Text>
              <Text>{fmtDate(issuedAt)}</Text>
            </View>
            {cfg.showDue && (
              <View style={pdfStyles.metaLine}>
                <Text style={pdfStyles.metaKey}>Due</Text>
                <Text>{fmtDate(dueAt)}</Text>
              </View>
            )}
            <View style={pdfStyles.metaLine}>
              <Text style={pdfStyles.metaKey}>Order</Text>
              <Text>{draft.name}</Text>
            </View>
          </View>
        </View>

        <View style={pdfStyles.partiesRow}>
          <View style={pdfStyles.party}>
            <Text style={pdfStyles.partyLabel}>Bill to</Text>
            <Text style={pdfStyles.muted}>
              {(addressLines(draft.billing_address).length
                ? addressLines(draft.billing_address)
                : [draft.customer_name]
              ).join('\n')}
              {draft.email ? `\n${draft.email}` : ''}
            </Text>
          </View>

          {addressLines(draft.shipping_address).length > 0 && (
            <View style={pdfStyles.party}>
              <Text style={pdfStyles.partyLabel}>Deliver to</Text>
              <Text style={pdfStyles.muted}>{addressLines(draft.shipping_address).join('\n')}</Text>
            </View>
          )}
        </View>

        <View style={pdfStyles.tHead}>
          <Text style={pdfStyles.cDesc}>Description</Text>
          <Text style={pdfStyles.cSku}>SKU</Text>
          <Text style={pdfStyles.cQty}>Qty</Text>
          <Text style={pdfStyles.cUnit}>Unit</Text>
          <Text style={pdfStyles.cTotal}>Amount</Text>
        </View>

        {draft.lines.map((l, i) => (
          <View key={i} style={pdfStyles.tRow} wrap={false}>
            <Text style={pdfStyles.cDesc}>
              {l.title}
              {l.variant_title ? ` — ${l.variant_title}` : ''}
            </Text>
            <Text style={pdfStyles.cSku}>{l.sku || '—'}</Text>
            <Text style={pdfStyles.cQty}>{l.qty}</Text>
            <Text style={pdfStyles.cUnit}>{fmtMoney(l.unit_price, cur)}</Text>
            <Text style={pdfStyles.cTotal}>{fmtMoney(l.line_total, cur)}</Text>
          </View>
        ))}

        <View style={pdfStyles.totals}>
          <View style={pdfStyles.totalLine}>
            <Text style={pdfStyles.metaKey}>
              Subtotal {draft.taxes_included ? '(incl. GST)' : '(excl. GST)'}
            </Text>
            <Text>{fmtMoney(draft.subtotal, cur)}</Text>
          </View>

          {draft.shipping > 0 && (
            <View style={pdfStyles.totalLine}>
              <Text style={pdfStyles.metaKey}>Shipping</Text>
              <Text>{fmtMoney(draft.shipping, cur)}</Text>
            </View>
          )}

          <View style={pdfStyles.totalLine}>
            <Text style={pdfStyles.metaKey}>
              GST {draft.taxes_included ? 'included' : ''}
            </Text>
            <Text>{fmtMoney(draft.tax, cur)}</Text>
          </View>

          <View style={pdfStyles.grandTotal}>
            <Text>Total {cur}</Text>
            <Text>{fmtMoney(draft.total, cur)}</Text>
          </View>
        </View>

        <View style={pdfStyles.footer}>
          <Text style={pdfStyles.muted}>{cfg.intro}</Text>

          {draft.note ? <Text style={{ ...pdfStyles.muted, marginTop: 8 }}>{draft.note}</Text> : null}

          {cfg.showPayment && (
            <View style={pdfStyles.payBlock}>
              <Text style={pdfStyles.payLabel}>Bank transfer</Text>
              <Text style={pdfStyles.muted}>
                {COMPANY.bank.name}
                {'\n'}BSB {COMPANY.bank.bsb} · Account {COMPANY.bank.account}
                {'\n'}Please quote {docNumber} as the reference.
              </Text>

              {draft.invoice_url ? (
                <Text style={{ ...pdfStyles.muted, marginTop: 8 }}>
                  Or pay by card:{' '}
                  <Text style={pdfStyles.link}>{draft.invoice_url}</Text>
                </Text>
              ) : null}
            </View>
          )}
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
  const dueAt = useMemo(() => addDays(DEFAULT_TERMS_DAYS), [selectedId, docType]);

  // Not yet allocated from the database sequence, so this is a placeholder.
  // Numbers get assigned on issue, not on preview, so browsing doesn't burn
  // them and leave unexplainable gaps in the register.
  const docNumber = `${DOC_TYPES[docType].prefix}-PREVIEW`;

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
      // Re-fetch rather than reuse the list row: drafts stay editable in
      // Shopify, so the list data may already be stale.
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
      const blob = await pdf(
        <InvoicePDF
          draft={detail}
          docType={docType}
          docNumber={docNumber}
          issuedAt={issuedAt}
          dueAt={dueAt}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${docNumber}-${detail.name.replace(/[^\w-]/g, '')}.pdf`;
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
    const subject = `${cfg.label} ${docNumber} from ${COMPANY.name}`;
    const body = [
      `Hi ${detail.customer_name || 'there'},`,
      '',
      `Please find attached ${cfg.label.toLowerCase()} ${docNumber} for ${fmtMoney(
        detail.total,
        detail.currency
      )}.`,
      ...(docType === 'invoice' && detail.invoice_url
        ? ['', `To pay by card: ${detail.invoice_url}`]
        : []),
      '',
      'Thanks,',
      COMPANY.name,
    ].join('\n');
    return `mailto:${detail.email || ''}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
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
      {/* Header */}
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
        {/* Draft list */}
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

        {/* Preview */}
        <div className="lg:col-span-3 bg-white border border-slate-200/80 rounded-xl shadow-2xs">
          {!selectedId && (
            <div className="p-10 text-center text-[11px] text-slate-500">
              Pick a draft order to build a document from it.
            </div>
          )}

          {detailLoading && (
            <div className="p-10 text-center text-[11px] text-slate-500">
              Loading draft order...
            </div>
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
                      {cfg.label}
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
                  {detail.lines_needing_sku > 1 ? 's have' : ' has'} no SKU. Fine for an
                  invoice, but these won't match anything in Cin7 later.
                </div>
              )}

              {/* On-screen preview mirrors the PDF layout */}
              <div className="p-5">
                <div className="border border-slate-200 rounded-lg p-5 text-[11px] text-slate-700">
                  <div className="flex justify-between gap-6 mb-6">
                    <div>
                      <div className="text-sm font-bold text-slate-900">{COMPANY.name}</div>
                      <div className="text-slate-500 leading-relaxed">
                        {COMPANY.addressLines.map((l) => (
                          <div key={l}>{l}</div>
                        ))}
                        <div>ABN {COMPANY.abn}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-slate-900 mb-1">
                        {DOC_TYPES[docType].label}
                      </div>
                      <div className="text-slate-500">
                        <div>{docNumber}</div>
                        <div>Issued {fmtDate(issuedAt)}</div>
                        {DOC_TYPES[docType].showDue && <div>Due {fmtDate(dueAt)}</div>}
                        <div>{detail.name}</div>
                      </div>
                    </div>
                  </div>

                  <div className="mb-5">
                    <div className="font-bold text-slate-900 mb-1">Bill to</div>
                    <div className="text-slate-500">
                      {(addressLines(detail.billing_address).length
                        ? addressLines(detail.billing_address)
                        : [detail.customer_name]
                      ).map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                      {detail.email && <div>{detail.email}</div>}
                    </div>
                  </div>

                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-900 font-bold">
                        <th className="text-left pb-1">Description</th>
                        <th className="text-left pb-1">SKU</th>
                        <th className="text-right pb-1">Qty</th>
                        <th className="text-right pb-1">Unit</th>
                        <th className="text-right pb-1">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-1.5 pr-2">
                            {l.title}
                            {l.variant_title ? ` — ${l.variant_title}` : ''}
                          </td>
                          <td className="py-1.5 pr-2 text-slate-500">{l.sku || '—'}</td>
                          <td className="py-1.5 text-right">{l.qty}</td>
                          <td className="py-1.5 text-right">
                            {fmtMoney(l.unit_price, detail.currency)}
                          </td>
                          <td className="py-1.5 text-right">
                            {fmtMoney(l.line_total, detail.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="mt-4 flex justify-end">
                    <div className="w-56 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-500">
                          Subtotal {detail.taxes_included ? '(incl. GST)' : '(excl. GST)'}
                        </span>
                        <span>{fmtMoney(detail.subtotal, detail.currency)}</span>
                      </div>
                      {detail.shipping > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Shipping</span>
                          <span>{fmtMoney(detail.shipping, detail.currency)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-500">
                          GST {detail.taxes_included ? 'included' : ''}
                        </span>
                        <span>{fmtMoney(detail.tax, detail.currency)}</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-800 pt-1.5 font-bold text-slate-900 text-xs">
                        <span>Total {detail.currency}</span>
                        <span>{fmtMoney(detail.total, detail.currency)}</span>
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
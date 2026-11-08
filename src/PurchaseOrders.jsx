import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { inbox } from './inbox/api';

// Every active purchase order from DEAR, in plain words.
//   Missing invoice            part of the order isn't on an invoice yet. Dated with the PO's required-by date.
//   Waiting for delivery       invoiced but not received yet. Dated with the invoice date.
//   Received, no invoice       everything arrived but DEAR has no (or only a partial) invoice.
//   Fix in DEAR                something was left unfinished in DEAR (for example paid but never marked received).
// Amounts use the currency DEAR records for the supplier on that PO. Nothing is converted.
const todayMelb = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
const daysBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'No date');
const money = (n, cur) => (n == null ? 'Not recorded' : `${cur ? `${cur} ` : ''}${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const qty = (n) => Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 });

const stateOf = (p) => {
  const missing = Number(p.expected_qty) > 0;
  const waiting = Number(p.confirmed_qty) > 0;
  return { missing, waiting, receivedMissing: !missing && !waiting && !p.is_open, fix: Array.isArray(p.cleanup) && p.cleanup.length > 0 };
};
const FILTERS = [['all', 'Everything'], ['missing', 'Missing invoice'], ['waiting', 'Waiting for delivery'], ['received', 'Received, no invoice'], ['fix', 'Fix in DEAR']];

const Chip = ({ tone, children }) => <span className={`inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${tone}`}>{children}</span>;

function Late({ date, today }) {
  if (!date || date >= today) return null;
  const d = daysBetween(today, date);
  return <span className="text-xs font-semibold text-red-700">{d} day{d === 1 ? '' : 's'} late</span>;
}

// What the supplier said in their own emails, beside DEAR's date. Read only.
function SupplierSays({ p }) {
  const sd = p.supplier_date;
  if (!sd?.date) return null;
  const diff = p.required_by ? daysBetween(sd.date, p.required_by) : null;
  const word = sd.kind === 'ship' ? 'ships' : sd.kind === 'arrive' ? 'arrives' : 'date';
  return (
    <span className="block text-xs text-slate-600" title={sd.sentence || ''}>
      Supplier says it {word} {fmtDay(sd.date)}
      {diff != null && Math.abs(diff) > 3 && <span className="ml-1 font-semibold text-amber-800">({Math.abs(diff)} days {diff > 0 ? 'later' : 'earlier'} than DEAR)</span>}
    </span>
  );
}

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const today = todayMelb();

  useEffect(() => {
    supabase.rpc('get_purchase_orders').then(({ data, error: err }) => {
      if (err) { setError(err.message); setRows([]); } else setRows(data || []);
    });
  }, []);

  // Writes a polite email to the supplier as a suggested reply (never sent) and opens it in the Inbox.
  const chase = async (po, kind) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await inbox('po_chase', { po_number: po, kind });
      navigate(`/inbox/mail?thread=${r.thread_id}`);
    } catch (err) {
      setNote({ type: 'error', text: err.friendly || err.message });
    }
    setBusy(false);
  };

  const view = useMemo(() => {
    const list = (rows || []).map((p) => ({ ...p, ...stateOf(p), invoices: Array.isArray(p.invoices) ? p.invoices : [] }));
    const counts = {
      all: list.length, missing: list.filter((p) => p.missing).length, waiting: list.filter((p) => p.waiting).length,
      received: list.filter((p) => p.receivedMissing).length, fix: list.filter((p) => p.fix).length,
    };
    const waitingValue = new Map();
    for (const p of list) for (const i of p.invoices) if (!i.all_received && i.amount != null) waitingValue.set(i.currency || 'No currency recorded', (waitingValue.get(i.currency || 'No currency recorded') || 0) + Number(i.amount));
    const term = q.trim().toLowerCase();
    const shown = list.filter((p) => (filter === 'all' || (filter === 'missing' && p.missing) || (filter === 'waiting' && p.waiting) || (filter === 'received' && p.receivedMissing) || (filter === 'fix' && p.fix))
      && (!term || `${p.po_number} ${p.supplier_name || ''}`.toLowerCase().includes(term)));
    return { shown, counts, waitingValue: [...waitingValue.entries()] };
  }, [rows, filter, q]);

  if (rows === null) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          The purchase order list isn't ready yet. Either the set-up isn't finished or the first read from DEAR is still running. Try again in a few minutes.
          <details className="mt-1 text-xs text-amber-800"><summary className="cursor-pointer">Show details for support</summary>{error}</details>
        </div>
      )}
      {note && <div role="alert" className={`rounded-md border p-3 text-sm ${note.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{note.text}</div>}

      <details className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer font-semibold text-blue-700">What do these labels mean?</summary>
        <ul className="mt-2 space-y-1.5 text-slate-700">
          <li><Chip tone="bg-amber-100 text-amber-800">Missing invoice</Chip> The supplier hasn't invoiced all of this order yet. The date shown is the one on the order in DEAR.</li>
          <li><Chip tone="bg-emerald-100 text-emerald-800">Waiting for delivery</Chip> It has been invoiced but hasn't arrived. The date is the invoice date.</li>
          <li><Chip tone="bg-violet-100 text-violet-800">Received, no invoice</Chip> Everything has arrived but there is no invoice in DEAR for it.</li>
          <li><Chip tone="bg-red-100 text-red-800">Fix in DEAR</Chip> Something was left unfinished in DEAR, for example it was paid but never marked as received. Open the order to see what.</li>
        </ul>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold cursor-pointer ${filter === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            {label} ({view.counts[id]})
          </button>
        ))}
        <input className="ml-auto min-h-[2.5rem] w-64 rounded-md border border-slate-300 px-3 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by PO or supplier" aria-label="Search purchase orders" />
      </div>

      {view.waitingValue.length > 0 && (
        <p className="text-sm text-slate-700">
          <b>Invoiced and waiting for delivery:</b>{' '}
          {view.waitingValue.map(([cur, sum], i) => <span key={cur}>{i ? ' · ' : ''}{money(sum, cur === 'No currency recorded' ? '' : cur)}{cur === 'No currency recorded' ? ' (no currency recorded)' : ''}</span>)}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)] gap-3 border-b border-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 md:grid">
          <span>Purchase order</span><span>Expected delivery</span><span>Where it's up to</span><span className="text-right">Order value</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {view.shown.map((p) => {
            const isOpen = open === p.po_number;
            return (
              <li key={p.po_number}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.po_number)}
                  className={`grid w-full gap-x-3 gap-y-1 px-4 py-3 text-left cursor-pointer md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)] ${isOpen ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                  <span className="min-w-0"><span className="block text-sm font-bold text-ink">PO {p.po_number}</span><span className="block truncate text-xs text-slate-600">{p.supplier_name || 'Supplier'}</span></span>
                  <span className="text-sm text-ink">{p.required_by ? fmtDay(p.required_by) : 'No date'}{(p.missing || p.waiting) && <> <Late date={p.required_by} today={today} /></>}<SupplierSays p={p} /></span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {p.missing && <Chip tone="bg-amber-100 text-amber-800">Missing invoice ({qty(p.expected_qty)} items)</Chip>}
                    {p.waiting && <Chip tone="bg-emerald-100 text-emerald-800">Waiting for delivery ({qty(p.confirmed_qty)} items)</Chip>}
                    {p.receivedMissing && <Chip tone="bg-violet-100 text-violet-800">Received, no invoice</Chip>}
                    {p.fix && <Chip tone="bg-red-100 text-red-800">Fix in DEAR</Chip>}
                  </span>
                  <span className="text-sm font-semibold text-ink md:text-right">{p.order_total != null ? money(p.order_total, p.supplier_currency) : <span className="font-normal text-slate-500">Not recorded</span>}</span>
                </button>
                {isOpen && (
                  <div className="space-y-3 bg-slate-50/70 px-4 pb-4 pt-1">
                    {p.fix && (
                      <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-900">
                        <b>Needs fixing in DEAR:</b>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">{p.cleanup.map((c) => <li key={c.code}>{c.text}</li>)}</ul>
                      </div>
                    )}
                    <p className="text-xs text-slate-600">Amounts are in the currency DEAR records for this supplier{p.supplier_currency ? ` (${p.supplier_currency})` : ', which DEAR has not recorded for this order'}. Nothing is converted.</p>
                    {p.invoices.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3 font-semibold">Invoice</th><th className="py-1 pr-3 font-semibold">Invoice date (delivery date)</th><th className="py-1 pr-3 font-semibold">Has it arrived?</th><th className="py-1 text-right font-semibold">Value of this shipment</th></tr></thead>
                          <tbody className="divide-y divide-slate-200">
                            {p.invoices.map((i, n) => (
                              <tr key={n} className="align-top">
                                <td className="py-1.5 pr-3 font-semibold text-ink">{i.invoice_number || 'No number yet'}{i.status === 'DRAFT' && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[0.65rem] font-semibold text-slate-700">Draft</span>}</td>
                                <td className="py-1.5 pr-3">{fmtDay(i.invoice_date)}{!i.all_received && <> <Late date={i.invoice_date} today={today} /></>}</td>
                                <td className="py-1.5 pr-3">{i.all_received ? <Chip tone="bg-slate-200 text-slate-700">Yes, received</Chip> : <Chip tone="bg-emerald-100 text-emerald-800">Not yet{Number(i.waiting_qty) > 0 ? ` (${qty(i.waiting_qty)} items)` : ''}</Chip>}</td>
                                <td className="py-1.5 text-right font-semibold">{money(i.amount, i.currency)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-sm text-slate-700">{p.receivedMissing ? 'Everything has arrived, but DEAR has no invoice for this order.' : 'No invoice on this order yet.'}</p>}
                    {p.missing && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">Not on an invoice yet: <b>{qty(p.expected_qty)} items</b>, expected {p.required_by ? fmtDay(p.required_by) : 'on an unknown date'} (the date on the order in DEAR).</p>}
                    {p.supplier_date?.sentence && <p className="text-sm text-slate-700">The supplier wrote: <i>"{p.supplier_date.sentence}"</i></p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {p.missing && <button type="button" disabled={busy} onClick={() => chase(p.po_number, 'invoice')} className="min-h-[2.5rem] rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-ink hover:bg-slate-50 cursor-pointer disabled:opacity-60">Write to the supplier about the invoice</button>}
                      {(p.waiting || p.missing) && <button type="button" disabled={busy} onClick={() => chase(p.po_number, 'delivery')} className="min-h-[2.5rem] rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-ink hover:bg-slate-50 cursor-pointer disabled:opacity-60">Write to the supplier about the delivery date</button>}
                    </div>
                    {(p.missing || p.waiting) && <p className="text-xs text-slate-500">This writes a suggested email in your Inbox for you to read and change. Nothing is sent until you press Send.</p>}
                  </div>
                )}
              </li>
            );
          })}
          {view.shown.length === 0 && <li className="p-8 text-center text-sm text-slate-500">{rows.length === 0 && !error ? 'No purchase orders have been read from DEAR yet.' : 'No purchase orders match.'}</li>}
        </ul>
      </div>
    </div>
  );
}

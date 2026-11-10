import { useCallback, useEffect, useMemo, useState } from 'react';
import { inputClass, buttonPrimary, buttonPlain } from '../wms/api';
import { salesMail } from '../salesinbox/api';

// PO to DEAR for JC Gilmore: the PO emails the agent has read, what is left for a person to settle, the item-number map, and the backtest
// (the agent's reading compared with the sale staff really keyed). Reading and checking only. Writing a draft sale into DEAR is locked.
const STATUS = {
  ready: ['Ready', 'bg-emerald-100 text-emerald-800'], needs_mapping: ['Needs item numbers matched', 'bg-amber-100 text-amber-800'], needs_check: ['Needs a person', 'bg-red-100 text-red-800'],
  read: ['Read', 'bg-slate-100 text-slate-700'], drafted: ['Draft sale made', 'bg-blue-100 text-blue-800'], skipped: ['Skipped', 'bg-slate-100 text-slate-500'], failed: ['Stopped part-way', 'bg-red-100 text-red-800'],
};
const FILTERS = [['open', 'Needs attention'], ['ready', 'Ready'], ['all', 'Everything']];
const money = (n) => (n == null ? '—' : Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'not stated');

export default function PoToDear() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('pos');
  const [filter, setFilter] = useState('open');
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [codes, setCodes] = useState({});
  const fail = (err) => ({ type: 'error', text: err.friendly || err.message, detail: err.technical && err.technical !== err.message ? err.technical : null });

  const load = useCallback(async () => {
    try { setData(await salesMail('po_list')); } catch (err) { setNote(fail(err)); setData({ orders: [], summary: {}, map: [], write_locked: true, customers: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, ok) => {
    setBusy(true);
    setNote(null);
    try { const r = await fn(); if (ok) setNote({ type: 'success', text: typeof ok === 'function' ? ok(r) : ok }); await load(); } catch (err) { setNote(fail(err)); }
    setBusy(false);
  };

  const orders = useMemo(() => {
    const list = data?.orders || [];
    return list.filter((o) => filter === 'all' || (filter === 'ready' && o.status === 'ready') || (filter === 'open' && !['ready', 'drafted', 'skipped'].includes(o.status)));
  }, [data, filter]);

  if (!data) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;
  const s = data.summary || {};
  const customerKey = data.customers?.[0]?.key || 'gilmores';
  const confirm = (item, sku) => act(() => salesMail('po_map_save', { customer_key: customerKey, customer_item: item, sku, confirmed: true }), (r) => `Saved. ${r.changed} PO${r.changed === 1 ? '' : 's'} checked again.`);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-ink">PO to DEAR</h2>
          <p className="text-sm text-slate-600">JC Gilmore purchase orders read from sales@, checked, and compared with what staff keyed. Nothing is written to DEAR.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonPlain} disabled={busy} onClick={() => act(() => salesMail('po_scan', { limit: 3 }), (r) => `Found ${r.found} PO email${r.found === 1 ? '' : 's'}, read ${r.read} new.${r.errors?.length ? ` Problem: ${r.errors[0]}` : ''}`)}>Look for new POs</button>
          <button type="button" className={buttonPrimary} disabled={busy || !s.read} onClick={() => act(() => salesMail('po_backtest', { limit: 5 }), (r) => `Checked ${r.done}: ${r.matched} matched what staff keyed, ${r.not_found} had no sale to compare.${r.errors?.length ? ` Problem: ${r.errors[0]}` : ''}`)}>Run the backtest</button>
        </div>
      </div>
      {note && (
        <div role={note.type === 'error' ? 'alert' : 'status'} className={`rounded-md border p-3 text-sm ${note.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {note.text}
          {note.detail && <details className="mt-1 text-xs opacity-80"><summary className="cursor-pointer">Show details for support</summary>{note.detail}</details>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[[s.read || 0, 'POs read'], [s.ready || 0, 'Ready'], [(s.needs_mapping || 0) + (s.needs_check || 0), 'Need a person'], [s.backtested || 0, 'Backtested'], [`${s.backtest_match || 0} of ${s.backtest_found || 0}`, 'Matched staff']].map(([n, label]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-2xl font-bold text-ink">{n}</div><div className="text-xs font-semibold text-slate-600">{label}</div></div>
        ))}
      </div>
      <p className="text-xs text-slate-600">Johnson's bar: 36 of 38 matching on lines, quantities, prices and ship-to, and never a wrong address. "Matched staff" counts only POs where a sale carrying the PO number as its customer reference was found.</p>

      <div className="flex gap-2 border-b border-slate-200">
        {[['pos', 'Purchase orders'], ['map', `Item numbers (${(data.map || []).length})`]].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold cursor-pointer ${tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-ink'}`}>{label}</button>
        ))}
      </div>

      {tab === 'pos' && (
        <>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(([id, label]) => <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-full px-3 py-1.5 text-sm font-semibold cursor-pointer ${filter === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{label}</button>)}
          </div>
          <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {orders.map((o) => {
              const [label, tone] = STATUS[o.status] || STATUS.read;
              const isOpen = open === o.id;
              const d = o.data || {};
              return (
                <li key={o.id}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : o.id)} className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left cursor-pointer ${isOpen ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                    <span className="min-w-0"><span className="block text-sm font-bold text-ink">{o.po_number}{o.is_amendment ? ' (amended)' : ''}{o.is_cancellation ? ' (cancelled)' : ''}</span><span className="block truncate text-xs text-slate-600">{d.ship_to?.company || o.subject}</span></span>
                    <span className="flex items-center gap-2">
                      {o.backtest && <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${o.backtest.matches ? 'bg-emerald-100 text-emerald-800' : o.backtest.found ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600'}`}>{o.backtest.matches ? 'Matched staff' : o.backtest.found ? 'Differs from staff' : 'No sale to compare'}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${tone}`}>{label}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-3 bg-slate-50/70 px-4 pb-4 pt-1">
                      {(o.flags || []).length > 0 && <ul className="list-disc space-y-0.5 rounded-md border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-sm text-amber-900">{o.flags.map((f, i) => <li key={i}>{f.text}</li>)}</ul>}
                      <div className="text-sm text-slate-700">
                        <b>Ship to:</b> {d.ship_to?.company || 'not stated'}{d.ship_to?.address ? `, ${d.ship_to.address}` : ''}{d.ship_to?.notes ? ` (${d.ship_to.notes})` : ''}<br />
                        <b>Delivery date:</b> {day(d.delivery_date)}{d.customer_reference ? <> · <b>End customer's PO:</b> {d.customer_reference}</> : null}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-sm">
                          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3 font-semibold">Their item</th><th className="py-1 pr-3 font-semibold">Description</th><th className="py-1 pr-3 text-right font-semibold">Qty</th><th className="py-1 pr-3 text-right font-semibold">Price</th><th className="py-1 font-semibold">Our product</th></tr></thead>
                          <tbody className="divide-y divide-slate-200">
                            {(d.lines || []).map((l, i) => (
                              <tr key={i} className="align-top">
                                <td className="py-1.5 pr-3 font-semibold text-ink">{l.item_number}</td><td className="py-1.5 pr-3">{l.description}</td><td className="py-1.5 pr-3 text-right">{l.qty ?? '—'}</td><td className="py-1.5 pr-3 text-right">{money(l.unit_price)}</td>
                                <td className="py-1.5">
                                  {l.sku ? <span className="font-semibold text-emerald-800">{l.sku}</span> : (
                                    <span className="flex flex-wrap items-center gap-1.5">
                                      <input className={`${inputClass} !min-h-[2rem] !w-36`} aria-label={`Our product code for ${l.item_number}`} value={codes[`${o.id}-${i}`] ?? l.suggested_sku ?? ''} placeholder="Product code" onChange={(e) => setCodes({ ...codes, [`${o.id}-${i}`]: e.target.value })} />
                                      <button type="button" className={buttonPlain} disabled={busy || !(codes[`${o.id}-${i}`] ?? l.suggested_sku)} onClick={() => confirm(l.item_number, codes[`${o.id}-${i}`] ?? l.suggested_sku)}>Confirm</button>
                                      {l.suggested_sku && <span className="text-xs text-slate-500">suggested from the backtest</span>}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {o.backtest && (
                        <div className="rounded-md border border-slate-200 bg-white p-2.5 text-sm text-slate-700">
                          <b>Backtest:</b> {!o.backtest.found ? o.backtest.note : o.backtest.matches ? `Matches the sale staff keyed (${o.backtest.sale_number}).` : `Differs from the sale staff keyed (${o.backtest.sale_number}):`}
                          {o.backtest.found && !o.backtest.matches && <ul className="mt-1 list-disc pl-5">{(o.backtest.mismatches || []).map((m, i) => <li key={i}>{m}</li>)}</ul>}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button type="button" className={buttonPlain} disabled={busy || o.status === 'drafted'} onClick={() => act(() => salesMail('po_reread', { id: o.id }), 'Read again.')}>Read the PDF again</button>
                        <button type="button" className={buttonPlain} disabled={busy} onClick={() => act(() => salesMail('po_backtest', { id: o.id }), 'Checked against DEAR.')}>Backtest this one</button>
                        <button type="button" className={buttonPlain} disabled={busy || o.status === 'drafted'} onClick={() => act(() => salesMail('po_skip', { id: o.id, skip: o.status !== 'skipped' }), o.status === 'skipped' ? 'Back on the list.' : 'Skipped.')}>{o.status === 'skipped' ? 'Put back on the list' : 'Skip this one'}</button>
                        <button type="button" className={buttonPlain} disabled={busy || data.write_locked || o.status !== 'ready'} onClick={() => window.confirm(`Create a draft sale in DEAR for ${o.po_number}?`) && act(() => salesMail('po_dear_draft', { id: o.id }), (r) => `Draft sale ${r.sale_id} created in DEAR. A person authorises it there.`)}>Create the draft sale in DEAR</button>
                      </div>
                      {data.write_locked && <p className="text-xs text-slate-500">Creating a sale in DEAR is <b>locked</b>. It is unlocked only after the backtest passes and a test sale has worked. An admin does that in the server settings.</p>}
                    </div>
                  )}
                </li>
              );
            })}
            {orders.length === 0 && <li className="p-8 text-center text-sm text-slate-500">{(data.orders || []).length ? 'Nothing here.' : 'No POs have been read yet. Press Look for new POs once sales@ is connected.'}</li>}
          </ul>
        </>
      )}

      {tab === 'map' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Gilmores' own item numbers matched to our product codes. <b>Only confirmed rows are used.</b> A suggestion from the backtest does nothing until a person confirms it.</p>
          <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {(data.map || []).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span><b className="text-ink">{m.customer_item}</b> → {m.sku || 'no product yet'} {m.sku_name ? <span className="text-slate-500">({m.sku_name})</span> : null}</span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${m.confirmed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{m.confirmed ? 'Confirmed' : `Suggested (${m.source})`}</span>
                  {!m.confirmed && m.sku && <button type="button" className={buttonPlain} disabled={busy} onClick={() => confirm(m.customer_item, m.sku)}>Confirm</button>}
                  <button type="button" className={buttonPlain} disabled={busy} onClick={() => window.confirm('Remove this row?') && act(() => salesMail('po_map_remove', { id: m.id }), 'Removed.')}>Remove</button>
                </span>
              </li>
            ))}
            {(data.map || []).length === 0 && <li className="p-8 text-center text-sm text-slate-500">No item numbers yet. They appear as POs are read, and the backtest suggests matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

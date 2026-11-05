import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';

// What is still to come for one product, PO by PO.
//   Confirmed (green): covered by a supplier invoice, dated with the invoice date.
//   Expected (amber):  not invoiced yet, dated with the PO's required-by date.
//   Late (red):        the date has passed and the stock hasn't arrived.
// The words always show next to the colour. Anything more than 90 days late is tucked away as stale.
const todayMelb = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
const daysBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const fmtDate = (d) => {
  if (!d) return 'No date';
  const [y, m, day] = d.split('-').map(Number);
  const sameYear = String(y) === todayMelb().slice(0, 4);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
};
const qtyText = (n) => Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 });
const STALE_DAYS = 90;

function Line({ l, today }) {
  const late = l.due_date && l.due_date < today ? daysBetween(today, l.due_date) : 0;
  const confirmed = l.kind === 'confirmed';
  return (
    <li className={`flex flex-wrap items-center justify-between gap-2 border-l-4 py-1.5 pl-2.5 pr-2 text-sm ${late ? 'border-red-500 bg-red-50/60' : confirmed ? 'border-emerald-500 bg-emerald-50/60' : 'border-amber-400 bg-amber-50/60'}`}>
      <span className="font-semibold text-ink">{fmtDate(l.due_date)} <span className="font-normal text-slate-500">·</span> {qtyText(l.qty)}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${confirmed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{confirmed ? 'Confirmed (invoice)' : 'Expected (required by)'}</span>
        {confirmed && l.invoice_status === 'DRAFT' && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">Draft invoice</span>}
        {late > 0 && <span className="font-semibold text-red-700">{late} day{late === 1 ? '' : 's'} late</span>}
      </span>
    </li>
  );
}

export default function IncomingBreakdown({ sku, onOrder, onLoaded }) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const today = todayMelb();

  useEffect(() => {
    let live = true;
    setRows(null);
    setFailed(false);
    supabase.rpc('get_incoming_for_sku', { p_sku: String(sku || '').trim() }).then(({ data, error }) => {
      if (!live) return;
      if (error) { setFailed(true); setRows([]); onLoaded?.(null); return; }
      const list = data || [];
      setRows(list);
      // Which POs still have stock coming: `all` includes stale ones, `live` leaves them out.
      const isStale = (l) => l.due_date && daysBetween(todayMelb(), l.due_date) > STALE_DAYS;
      onLoaded?.({ all: [...new Set(list.map((l) => l.po_number))], live: [...new Set(list.filter((l) => !isStale(l)).map((l) => l.po_number))] });
    });
    return () => { live = false; };
  }, [sku]); // eslint-disable-line react-hooks/exhaustive-deps

  const { groups, stale, staleTotal, freshTotal } = useMemo(() => {
    const list = rows || [];
    const fresh = list.filter((l) => !(l.due_date && daysBetween(today, l.due_date) > STALE_DAYS));
    const old = list.filter((l) => l.due_date && daysBetween(today, l.due_date) > STALE_DAYS);
    const byPo = new Map();
    for (const l of fresh) {
      const g = byPo.get(l.po_number) || { po: l.po_number, supplier: l.supplier_name, lines: [], first: l.due_date || '9999' };
      g.lines.push(l);
      if ((l.due_date || '9999') < g.first) g.first = l.due_date || '9999';
      byPo.set(l.po_number, g);
    }
    return {
      groups: [...byPo.values()].sort((a, b) => a.first.localeCompare(b.first)), stale: old,
      staleTotal: old.reduce((n, l) => n + Number(l.qty), 0), freshTotal: fresh.reduce((n, l) => n + Number(l.qty), 0),
    };
  }, [rows, today]);

  if (rows === null) return null;
  const onOrderNum = Number(onOrder) || 0;
  if (rows.length === 0 && onOrderNum <= 0) return null;
  // Compared with DEAR's On Order using the live lines only. Stale lines are shown separately.
  const unscheduled = Math.round((onOrderNum - freshTotal) * 100) / 100;

  return (
    <div className="mb-4">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Incoming{rows.length ? ` (${qtyText(freshTotal)})` : ''}</h4>
      {rows.length === 0 && (
        <p className="text-xs text-slate-500">{failed ? "Incoming detail isn't available yet." : `DEAR shows ${qtyText(onOrderNum)} on order, but no PO detail has been read for this product yet.`}</p>
      )}
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.po} className="rounded-xl border border-slate-200 bg-white p-2.5">
            <p className="text-sm font-bold text-slate-800">PO {g.po}{g.supplier ? <span className="ml-2 text-xs font-medium text-slate-500">{g.supplier}</span> : null}</p>
            <ul className="mt-1.5 space-y-1">{g.lines.map((l, i) => <Line key={i} l={l} today={today} />)}</ul>
          </div>
        ))}
      </div>
      {stale.length > 0 && (
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700">Stale: {stale.length} line{stale.length === 1 ? '' : 's'} more than {STALE_DAYS} days late ({qtyText(staleTotal)})</summary>
          <div className="mt-1.5 space-y-2">
            {[...new Set(stale.map((l) => l.po_number))].map((po) => (
              <div key={po} className="rounded-xl border border-slate-200 bg-white p-2.5">
                <p className="text-sm font-bold text-slate-800">PO {po}</p>
                <ul className="mt-1.5 space-y-1">{stale.filter((l) => l.po_number === po).map((l, i) => <Line key={i} l={l} today={today} />)}</ul>
              </div>
            ))}
          </div>
        </details>
      )}
      {rows.length > 0 && Math.abs(unscheduled) <= 0.5 && stale.length > 0 && <p className="mt-2 text-xs text-slate-600">DEAR's On Order of {qtyText(onOrderNum)} matches the lines above. It isn't counting the stale {stale.length === 1 ? 'line' : 'lines'}, so check {stale.length === 1 ? 'that PO' : 'those POs'} in DEAR.</p>}
      {rows.length > 0 && unscheduled > 0.5 && <p className="mt-2 text-xs text-slate-600">Not scheduled: {qtyText(unscheduled)}. DEAR counts this as on order, but it isn't on a PO line here.</p>}
      {rows.length > 0 && unscheduled < -0.5 && <p className="mt-2 text-xs text-slate-600">The lines above add up to {qtyText(freshTotal)}, more than DEAR's On Order of {qtyText(onOrderNum)}. DEAR may not have caught up yet.</p>}
    </div>
  );
}
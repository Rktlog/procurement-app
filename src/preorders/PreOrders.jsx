import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { inputClass, buttonPlain } from '../wms/api';
import { salesMail } from '../salesinbox/api';

// What Seaga's customers have asked to pre-order, added up by product, against what is in stock and already coming.
// For 2PRE managers: they place the order. The sales reps contact the customers and keep the lines up to date.
// A manager's "ordered" notes are stored apart from the sales side, which never sees them.
const qty = (n) => (n == null ? 'not known' : Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 }));
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const FILTERS = [['order', 'Needs ordering'], ['all', 'Everything'], ['unmatched', 'Not matched to a product']];

export default function PreOrders() {
  const navigate = useNavigate();
  const [products, setProducts] = useState(null);
  const [canNote, setCanNote] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [filter, setFilter] = useState('order');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [po, setPo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await salesMail('preorder_summary');
      setProducts(r.products);
      setCanNote(!!r.can_note);
    } catch (err) {
      setError(err);
      setProducts([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const mark = async (ids, ordered) => {
    setBusy(true);
    setNote(null);
    try {
      await salesMail('preorder_note', { line_ids: ids, ordered, po_number: ordered ? po : undefined });
      setNote({ type: 'success', text: ordered ? `Marked as ordered${po.trim() ? ` on ${po.trim().toUpperCase()}` : ''}.` : 'Put back on the list.' });
      await load();
    } catch (err) { setNote({ type: 'error', text: err.friendly || err.message }); }
    setBusy(false);
  };

  const view = useMemo(() => {
    const list = products || [];
    const counts = { order: list.filter((p) => (p.to_order || 0) > 0).length, all: list.length, unmatched: list.filter((p) => !p.matched).length };
    const term = q.trim().toLowerCase();
    const shown = list.filter((p) => (filter === 'all' || (filter === 'order' && (p.to_order || 0) > 0) || (filter === 'unmatched' && !p.matched))
      && (!term || `${p.name} ${p.sku || ''}`.toLowerCase().includes(term)));
    return { shown, counts };
  }, [products, filter, q]);

  if (products === null) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {error.friendly || error.message}
          {error.technical && error.technical !== error.message && <details className="mt-1 text-xs"><summary className="cursor-pointer">Show details for support</summary>{error.technical}</details>}
        </div>
      )}
      {note && <div role="status" className={`rounded-md border p-3 text-sm ${note.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{note.text}</div>}

      <details className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer font-semibold text-blue-700">How to read this page</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
          <li>Each row is a product customers have asked to pre-order, added up across customers.</li>
          <li><b>To order</b> is what customers want, less what is available now, less what is already on its way. Nothing is ordered for you.</li>
          <li>The quantities were read from the customers' emails. Open the email and check a line before you order.</li>
          <li>When you have ordered, tick the lines and press <b>Mark as ordered</b>. The sales team can't see your notes.</li>
        </ul>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-full px-3 py-1.5 text-sm font-semibold cursor-pointer ${filter === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{label} ({view.counts[id]})</button>
        ))}
        <input className={`${inputClass} ml-auto !w-64`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] gap-3 border-b border-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 md:grid">
          <span>Product</span><span className="text-right">Customers want</span><span className="text-right">Available</span><span className="text-right">Already coming</span><span className="text-right">To order</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {view.shown.map((p) => {
            const isOpen = open === p.key;
            const openLines = p.lines.filter((l) => !l.ordered);
            return (
              <li key={p.key}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.key)}
                  className={`grid w-full gap-x-3 gap-y-1 px-4 py-3 text-left cursor-pointer md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] ${isOpen ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-ink">{p.name}</span>
                    <span className="block text-xs text-slate-500">{p.sku ? p.sku : 'Not matched to a product yet'}{p.wanted_by ? ` · wanted by ${fmtDay(p.wanted_by)}` : ''}{p.unclear ? ` · ${p.unclear} line${p.unclear === 1 ? '' : 's'} with no quantity` : ''}</span>
                  </span>
                  <span className="text-sm md:text-right"><span className="md:hidden text-xs text-slate-500">Customers want </span>{qty(p.demand)}</span>
                  <span className="text-sm md:text-right"><span className="md:hidden text-xs text-slate-500">Available </span>{p.matched ? qty(p.available) : '—'}</span>
                  <span className="text-sm md:text-right"><span className="md:hidden text-xs text-slate-500">Already coming </span>{p.matched ? qty(p.incoming) : '—'}</span>
                  <span className={`text-sm font-bold md:text-right ${(p.to_order || 0) > 0 ? 'text-amber-800' : 'text-slate-500'}`}><span className="md:hidden text-xs font-normal text-slate-500">To order </span>{p.to_order == null ? 'check' : qty(p.to_order)}</span>
                </button>
                {isOpen && (
                  <div className="space-y-2 bg-slate-50/70 px-4 pb-4 pt-1">
                    {!p.matched && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">This isn't matched to one of our products yet, so there are no stock figures. Ask the sales rep to add the product code.</p>}
                    <ul className="space-y-1.5">
                      {p.lines.map((l) => (
                        <li key={l.id} className={`rounded-lg border bg-white p-2.5 text-sm ${l.ordered ? 'border-emerald-200 opacity-75' : 'border-slate-200'}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span><b>{l.customer_name || 'A customer'}</b> wants <b>{l.qty != null ? qty(l.qty) : 'an unknown number'}</b>{l.wanted_by ? ` by ${fmtDay(l.wanted_by)}` : ''}</span>
                            <span className="flex items-center gap-2">
                              {l.ordered && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-800">Ordered{l.po_number ? ` on ${l.po_number}` : ''}</span>}
                              <button type="button" className="cursor-pointer text-xs font-semibold text-blue-700 hover:underline" onClick={() => navigate(`/sales-inbox-view/mail?thread=${l.thread_id}`)}>Open the email</button>
                              {canNote && l.ordered && <button type="button" className="cursor-pointer text-xs font-semibold text-slate-600 hover:underline" disabled={busy} onClick={() => mark([l.id], false)}>Undo</button>}
                            </span>
                          </div>
                          {l.sentence && <p className="mt-1 text-xs text-slate-500">They wrote: "{l.sentence}"</p>}
                        </li>
                      ))}
                    </ul>
                    {canNote && openLines.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input className={`${inputClass} !w-44 !min-h-[2.25rem]`} value={po} onChange={(e) => setPo(e.target.value)} placeholder="PO number (optional)" aria-label="PO number" />
                        <button type="button" className={buttonPlain} disabled={busy} onClick={() => mark(openLines.map((l) => l.id), true)}>Mark these {openLines.length} as ordered</button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {view.shown.length === 0 && <li className="p-8 text-center text-sm text-slate-500">{(products || []).length === 0 && !error ? 'No pre-orders have been recorded yet. The sales reps add them from the customer emails.' : filter === 'order' ? 'Nothing needs ordering. Everything customers have asked for is in stock or already coming.' : 'Nothing matches.'}</li>}
        </ul>
      </div>
    </div>
  );
}

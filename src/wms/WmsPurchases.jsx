import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { wms, fmtMoney, fmtDate, fmtDateTime, nice, Badge } from './api';

const FILTERS = [
  ['', 'All'],
  ['DRAFT', 'Drafts'],
  ['OPEN', 'On order'],
  ['COMPLETED', 'Received'],
  ['VOIDED', 'Cancelled'],
];
const inFilter = (status, f) => !f || (f === 'OPEN' ? status === 'ORDERED' || status === 'PARTIALLY_RECEIVED' : status === f);
const lineTotal = (l) => (Number(l.qty) || 0) * (Number(l.cost) || 0);

const inputClass =
  'w-full h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20';
const buttonPrimary =
  'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer';
const buttonPlain =
  'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-ink hover:border-blue-600 hover:text-blue-700 disabled:opacity-60 cursor-pointer';

// Purchase orders for a Shopify business. Receiving stock adds it to Shopify.
export default function WmsPurchases() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [filter, setFilter] = useState('');
  const [suppliers, setSuppliers] = useState([]);

  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('view'); // view | edit | new
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('purchases')
      .select('id, number, supplier_name, status, order_date, eta, purchase_lines(qty, received_qty, cost)')
      .order('order_date', { ascending: false })
      .order('number', { ascending: false })
      .limit(200);
    if (error) setListError(error.message);
    else {
      setListError(null);
      setList(data || []);
    }
    setLoading(false);
  }, []);

  const loadSuppliers = useCallback(async () => {
    const { data } = await supabase
      .from('suppliers')
      .select('id, name, email, contact_name, phone')
      .eq('is_active', true)
      .order('name');
    setSuppliers(data || []);
  }, []);

  const loadDetail = useCallback(async (id) => {
    setDetailError(null);
    const { data, error } = await supabase
      .from('purchases')
      .select('*, purchase_lines(*), purchase_receipts(*)')
      .eq('id', id)
      .single();
    if (error) setDetailError(error.message);
    else setDetail(data);
  }, []);

  useEffect(() => {
    loadList();
    loadSuppliers();
  }, [loadList, loadSuppliers]);

  const select = (id) => {
    setSelectedId(id);
    setMode('view');
    setDetail(null);
    setNotice(null);
    loadDetail(id);
  };

  const refresh = async (id = selectedId) => {
    await Promise.all([loadList(), id ? loadDetail(id) : null]);
  };

  const visible = useMemo(() => list.filter((p) => inFilter(p.status, filter)), [list, filter]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      {/* ---------------------------------------------------------- list */}
      <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden" aria-label="Purchase orders">
        <div className="p-3 border-b border-slate-100 space-y-2">
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setDetail(null);
              setMode('new');
            }}
            className={`${buttonPrimary} w-full`}
          >
            <Plus size={16} /> New purchase order
          </button>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter purchase orders">
            {FILTERS.map(([value, label]) => (
              <button
                key={value || 'all'}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer ${
                  filter === value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {listError && (
          <div role="alert" className="m-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
            {listError}
          </div>
        )}
        {!listError && !loading && visible.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">
            {list.length === 0 ? 'No purchase orders yet. Create the first one.' : 'None in this view.'}
          </div>
        )}

        <ul className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
          {visible.map((p) => {
            const ordered = p.purchase_lines.reduce((n, l) => n + Number(l.qty), 0);
            const received = p.purchase_lines.reduce((n, l) => n + Number(l.received_qty), 0);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => select(p.id)}
                  className={`w-full text-left px-3 py-2.5 cursor-pointer ${p.id === selectedId ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-ink">
                        {p.number} <span className="font-normal text-slate-600">{p.supplier_name}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {fmtDate(p.order_date)}
                        {p.eta ? ` · due ${fmtDate(p.eta)}` : ''}
                        {p.status !== 'DRAFT' && p.status !== 'VOIDED' ? ` · ${received} of ${ordered} received` : ''}
                      </div>
                      <div className="mt-1">
                        <Badge status={p.status}>{p.status === 'COMPLETED' ? 'Received' : p.status === 'VOIDED' ? 'Cancelled' : nice(p.status)}</Badge>
                      </div>
                    </div>
                    <div className="text-sm font-bold text-ink whitespace-nowrap">
                      {fmtMoney(p.purchase_lines.reduce((n, l) => n + lineTotal(l), 0))}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        {loading && <div className="p-3 text-center text-sm text-slate-500">Loading</div>}
      </section>

      {/* -------------------------------------------------------- detail */}
      <section className="lg:col-span-3 bg-white border border-slate-200 rounded-xl" aria-label="Purchase order details" aria-live="polite">
        {mode === 'new' && (
          <PoEditor
            suppliers={suppliers}
            onSuppliersChanged={loadSuppliers}
            onCancel={() => setMode('view')}
            onSaved={async (id) => {
              await loadList();
              select(id);
              setNotice({ type: 'success', text: 'Saved as a draft.' });
            }}
          />
        )}
        {mode === 'edit' && detail && (
          <PoEditor
            initial={detail}
            suppliers={suppliers}
            onSuppliersChanged={loadSuppliers}
            onCancel={() => setMode('view')}
            onSaved={async (id) => {
              setMode('view');
              await refresh(id);
              setNotice({ type: 'success', text: 'Draft saved.' });
            }}
          />
        )}
        {mode === 'view' && !selectedId && (
          <div className="p-12 text-center text-sm text-slate-500">Pick a purchase order, or create a new one.</div>
        )}
        {mode === 'view' && selectedId && !detail && !detailError && (
          <div className="p-12 text-center text-sm text-slate-500">Loading</div>
        )}
        {detailError && (
          <div role="alert" className="m-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
            {detailError}
          </div>
        )}
        {mode === 'view' && detail && (
          <PoDetail
            po={detail}
            notice={notice}
            setNotice={setNotice}
            onEdit={() => setMode('edit')}
            onChanged={() => refresh(detail.id)}
          />
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ detail
function PoDetail({ po, notice, setNotice, onEdit, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [receiving, setReceiving] = useState(false);

  const lines = [...po.purchase_lines].sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  const receipts = [...po.purchase_receipts].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const pending = receipts.filter((r) => r.status === 'pending');
  const total = lines.reduce((n, l) => n + lineTotal(l), 0);
  const canReceive = po.status === 'ORDERED' || po.status === 'PARTIALLY_RECEIVED';
  const hasReceipts = receipts.some((r) => r.status !== 'failed');

  const run = async (fn, success) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (success) setNotice({ type: 'success', text: success });
      await onChanged();
    } catch (err) {
      setError(err.message);
      await onChanged();
    }
    setBusy(false);
  };

  const retry = (receipt) =>
    run(
      () => wms('receive_purchase', { id: po.id, receipt_id: receipt.id }),
      'Stock added to Shopify.'
    );

  return (
    <div>
      <header className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="page-title text-[1.7rem] text-ink">{po.number}</h2>
          <div className="text-sm text-slate-600">{po.supplier_name}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge status={po.status}>{po.status === 'COMPLETED' ? 'Received' : po.status === 'VOIDED' ? 'Cancelled' : nice(po.status)}</Badge>
            <span>Created {fmtDate(po.order_date)}</span>
            {po.eta && <span>Due {fmtDate(po.eta)}</span>}
            {po.ordered_at && <span>Ordered {fmtDate(po.ordered_at)}</span>}
            {po.received_at && <span>Fully received {fmtDate(po.received_at)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {po.status === 'DRAFT' && (
            <>
              <button type="button" className={buttonPlain} onClick={onEdit} disabled={busy}>Edit</button>
              <button
                type="button"
                className={buttonPrimary}
                disabled={busy}
                onClick={() => run(() => wms('set_purchase_status', { id: po.id, status: 'ORDERED' }), 'Marked as ordered.')}
              >
                Mark as ordered
              </button>
            </>
          )}
          {canReceive && (
            <button type="button" className={buttonPrimary} disabled={busy || pending.length > 0} onClick={() => setReceiving(true)}>
              Receive stock
            </button>
          )}
          {(po.status === 'DRAFT' || po.status === 'ORDERED') && !hasReceipts && (
            <button
              type="button"
              className={buttonPlain}
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Cancel ${po.number}? This can't be undone.`)) {
                  run(() => wms('set_purchase_status', { id: po.id, status: 'VOIDED' }), `${po.number} cancelled.`);
                }
              }}
            >
              Cancel order
            </button>
          )}
        </div>
      </header>

      {notice && (
        <div role="status" className="mx-5 mb-3 p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md">
          {notice.text}
        </div>
      )}
      {error && (
        <div role="alert" className="mx-5 mb-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
          {error}
        </div>
      )}
      {pending.length > 0 && (
        <div role="alert" className="mx-5 mb-3 p-3 bg-amber-50 border border-amber-300 text-amber-900 text-sm rounded-md">
          A stock receipt hasn't been confirmed by Shopify yet. Retry it below. It's safe: if Shopify already has it, the repeat is ignored.
        </div>
      )}

      <section className="px-5 py-4 border-t border-slate-100">
        <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase mb-2">Items</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1 pr-2 font-semibold">Product</th>
                <th className="py-1 pr-2 font-semibold text-right">Ordered</th>
                <th className="py-1 pr-2 font-semibold text-right">Received</th>
                <th className="py-1 pr-2 font-semibold text-right">To come</th>
                <th className="py-1 pr-2 font-semibold text-right">Unit cost</th>
                <th className="py-1 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-2">
                    <div className="font-semibold text-ink">{l.name || l.sku}</div>
                    <div className="text-xs text-slate-500">SKU {l.sku}</div>
                  </td>
                  <td className="py-2 pr-2 text-right">{l.qty}</td>
                  <td className="py-2 pr-2 text-right">{l.received_qty}</td>
                  <td className={`py-2 pr-2 text-right ${Number(l.qty) - Number(l.received_qty) > 0 ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>
                    {Number(l.qty) - Number(l.received_qty)}
                  </td>
                  <td className="py-2 pr-2 text-right">{fmtMoney(l.cost)}</td>
                  <td className="py-2 text-right font-semibold">{fmtMoney(lineTotal(l))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="pt-2 text-right text-sm font-bold text-ink">Total</td>
                <td className="pt-2 text-right text-sm font-bold text-ink">{fmtMoney(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {po.notes && (
          <div className="mt-3 text-sm">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Notes</div>
            <div className="text-ink whitespace-pre-line">{po.notes}</div>
          </div>
        )}
      </section>

      {receipts.length > 0 && (
        <section className="px-5 py-4 border-t border-slate-100">
          <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase mb-2">Stock received into Shopify</h3>
          <ul className="space-y-2">
            {receipts.map((r) => (
              <li key={r.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge status={r.status}>{r.status === 'pending' ? 'Not confirmed' : nice(r.status)}</Badge>
                  <span className="text-slate-600">{fmtDateTime(r.created_at)}</span>
                  {r.location_name && <span className="text-slate-500">to {r.location_name}</span>}
                  {r.status === 'pending' && (
                    <button type="button" className={`${buttonPlain} !h-7 !px-2.5 text-xs`} disabled={busy} onClick={() => retry(r)}>
                      Retry
                    </button>
                  )}
                </div>
                <div className="text-xs text-slate-500">{(r.lines || []).map((i) => `${i.qty} × ${i.sku}`).join(', ')}</div>
                {r.error && <div className="text-xs text-red-700">{r.error}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {receiving && (
        <ReceiveDialog
          po={po}
          lines={lines}
          onClose={() => setReceiving(false)}
          onDone={async (message) => {
            setReceiving(false);
            setNotice(message ? { type: 'success', text: message } : null);
            await onChanged();
          }}
          onUnconfirmed={onChanged}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------- receive
function ReceiveDialog({ po, lines, onClose, onDone, onUnconfirmed }) {
  const open = lines.filter((l) => Number(l.qty) - Number(l.received_qty) > 0);
  const [locations, setLocations] = useState(null);
  const [locationId, setLocationId] = useState(po.shopify_location_id || '');
  const [qty, setQty] = useState(() => Object.fromEntries(open.map((l) => [l.id, String(Number(l.qty) - Number(l.received_qty))])));
  const [updateCost, setUpdateCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    wms('list_locations')
      .then((r) => {
        setLocations(r.locations);
        setLocationId((cur) => (r.locations.some((l) => l.id === cur) ? cur : r.locations[0]?.id || ''));
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const units = open.reduce((n, l) => n + (Number(qty[l.id]) > 0 ? Number(qty[l.id]) : 0), 0);
  const place = locations?.find((l) => l.id === locationId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await wms('receive_purchase', {
        id: po.id,
        location_id: locationId,
        location_name: place?.name || '',
        update_cost: updateCost,
        lines: open.map((l) => ({ line_id: l.id, qty: Number(qty[l.id]) || 0 })),
      });
      const costNote = res.cost_errors?.length ? ` Cost couldn't be updated for: ${res.cost_errors.join('; ')}.` : '';
      onDone(`${res.units} units added to Shopify${res.completed ? ' and the purchase order is complete' : ''}.${costNote}`);
    } catch (err) {
      setError(err.message);
      if (err.data?.unconfirmed) await onUnconfirmed();
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="recv-title">
      <div className="absolute inset-0 bg-ink/50" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-lg p-6">
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="absolute top-3 right-3 p-1.5 rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer">
          <X size={18} />
        </button>
        <h2 id="recv-title" className="page-title text-[1.5rem] text-ink">Receive stock for {po.number}</h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">What arrived. This adds it to your Shopify stock straight away.</p>

        <label htmlFor="recv-loc" className="block text-sm font-semibold text-ink mb-1">Receive into</label>
        <select id="recv-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputClass} disabled={!locations}>
          {!locations && <option>Loading locations</option>}
          {locations?.map((l) => (
            <option key={l.id} value={l.id}>{l.name}{l.place ? ` (${l.place})` : ''}</option>
          ))}
        </select>

        <table className="w-full text-sm mt-4">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 font-semibold">Product</th>
              <th className="py-1 font-semibold text-right">Still to come</th>
              <th className="py-1 pl-3 font-semibold text-right w-28">Received now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {open.map((l) => {
              const left = Number(l.qty) - Number(l.received_qty);
              return (
                <tr key={l.id}>
                  <td className="py-2">
                    <div className="font-semibold text-ink">{l.name || l.sku}</div>
                    <div className="text-xs text-slate-500">SKU {l.sku}</div>
                  </td>
                  <td className="py-2 text-right">{left}</td>
                  <td className="py-2 pl-3">
                    <input
                      type="number"
                      min="0"
                      max={left}
                      step="1"
                      value={qty[l.id]}
                      onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                      aria-label={`Quantity received for ${l.sku}`}
                      className={`${inputClass} text-right`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} className="mt-0.5" />
          <span>Also set Shopify's "cost per item" to the cost on this order</span>
        </label>

        {error && (
          <div role="alert" className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">{error}</div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            {units > 0 ? <>Adds <b>{units}</b> unit{units === 1 ? '' : 's'} to {place?.name || 'Shopify'}</> : 'Enter what arrived'}
          </div>
          <div className="flex gap-2">
            <button type="button" className={buttonPlain} onClick={onClose} disabled={busy}>Close</button>
            <button type="button" className={buttonPrimary} onClick={submit} disabled={busy || units <= 0 || !locationId}>
              {busy ? 'Updating Shopify' : 'Add to Shopify stock'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ editor
function PoEditor({ initial, suppliers, onSuppliersChanged, onSaved, onCancel }) {
  const [supplierId, setSupplierId] = useState(initial?.supplier_id || '');
  const [expected, setExpected] = useState(initial?.eta || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [lines, setLines] = useState(() =>
    (initial?.purchase_lines || []).map((l) => ({ product_id: l.product_id, sku: l.sku, name: l.name || l.sku, qty: String(l.qty), cost: String(l.cost) }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [addingSupplier, setAddingSupplier] = useState(false);

  const total = lines.reduce((n, l) => n + lineTotal(l), 0);
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const addProduct = (p) => {
    setLines((ls) => (ls.some((l) => l.product_id === p.id) ? ls : [...ls, { product_id: p.id, sku: p.sku, name: p.name, qty: '1', cost: '' }]));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await wms('save_purchase', {
        id: initial?.id,
        supplier_id: supplierId,
        expected_date: expected || null,
        notes,
        lines: lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), cost: Number(l.cost) || 0 })),
      });
      await onSaved(res.id);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="p-5">
      <h2 className="page-title text-[1.5rem] text-ink">{initial ? `Edit ${initial.number}` : 'New purchase order'}</h2>

      <div className="mt-4 grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="po-supplier" className="block text-sm font-semibold text-ink mb-1">Supplier</label>
          <div className="flex gap-2">
            <select id="po-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button type="button" className={`${buttonPlain} shrink-0`} onClick={() => setAddingSupplier((v) => !v)}>
              {addingSupplier ? 'Cancel' : 'New'}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="po-due" className="block text-sm font-semibold text-ink mb-1">Expected delivery</label>
          <input id="po-due" type="date" value={expected || ''} onChange={(e) => setExpected(e.target.value)} className={inputClass} />
        </div>
      </div>

      {addingSupplier && (
        <SupplierForm
          onSaved={async (s) => {
            await onSuppliersChanged();
            setSupplierId(s.id);
            setAddingSupplier(false);
          }}
        />
      )}

      <div className="mt-5">
        <div className="text-sm font-semibold text-ink mb-1">Products</div>
        <ProductPicker onPick={addProduct} />
        {lines.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 font-semibold">Product</th>
                  <th className="py-1 pl-2 font-semibold text-right w-24">Qty</th>
                  <th className="py-1 pl-2 font-semibold text-right w-28">Unit cost</th>
                  <th className="py-1 pl-2 font-semibold text-right w-24">Total</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, i) => (
                  <tr key={l.product_id}>
                    <td className="py-2">
                      <div className="font-semibold text-ink">{l.name}</div>
                      <div className="text-xs text-slate-500">SKU {l.sku}</div>
                    </td>
                    <td className="py-2 pl-2">
                      <input type="number" min="1" step="1" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label={`Quantity for ${l.sku}`} className={`${inputClass} text-right`} />
                    </td>
                    <td className="py-2 pl-2">
                      <input type="number" min="0" step="0.01" value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} aria-label={`Unit cost for ${l.sku}`} className={`${inputClass} text-right`} placeholder="0.00" />
                    </td>
                    <td className="py-2 pl-2 text-right font-semibold">{fmtMoney(lineTotal(l))}</td>
                    <td className="py-2 pl-1">
                      <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove ${l.sku}`} className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="pt-2 text-right font-bold text-ink">Total</td>
                  <td className="pt-2 pl-2 text-right font-bold text-ink">{fmtMoney(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4">
        <label htmlFor="po-notes" className="block text-sm font-semibold text-ink mb-1">Notes</label>
        <textarea id="po-notes" rows={2} value={notes || ''} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} h-auto py-2`} placeholder="Anything the supplier or your team should know" />
      </div>

      {error && (
        <div role="alert" className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">{error}</div>
      )}
      <div className="mt-5 flex gap-2">
        <button type="button" className={buttonPrimary} onClick={save} disabled={saving || !supplierId || lines.length === 0}>
          {saving ? 'Saving' : 'Save draft'}
        </button>
        <button type="button" className={buttonPlain} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}

function ProductPicker({ onPick }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);

  useEffect(() => {
    // Characters with a special meaning in the search filter are dropped.
    const t = term.replace(/[,()%*\\]/g, ' ').trim();
    if (t.length < 2) {
      setResults(null);
      return undefined;
    }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from('products')
        .select('id, sku, name')
        .or(`sku.ilike.%${t}%,name.ilike.%${t}%`)
        .eq('status', 'Active')
        .order('sku')
        .limit(10);
      setResults(data || []);
    }, 300);
    return () => clearTimeout(handle);
  }, [term]);

  return (
    <div className="relative">
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search by SKU or product name to add"
        aria-label="Search products to add"
        className={inputClass}
      />
      {results && (
        <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No products match. Run Sync now if it's new.</li>}
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => {
                  onPick(p);
                  setTerm('');
                  setResults(null);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer"
              >
                <span className="font-semibold text-ink">{p.name}</span>
                <span className="block text-xs text-slate-500">SKU {p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SupplierForm({ onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', contact_name: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await wms('save_supplier', form);
      await onSaved(res.supplier);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
      <div className="grid sm:grid-cols-2 gap-3">
        <input value={form.name} onChange={set('name')} placeholder="Supplier name" aria-label="Supplier name" className={inputClass} />
        <input value={form.email} onChange={set('email')} placeholder="Email (for sending orders)" aria-label="Supplier email" className={inputClass} />
        <input value={form.contact_name} onChange={set('contact_name')} placeholder="Contact person" aria-label="Contact person" className={inputClass} />
        <input value={form.phone} onChange={set('phone')} placeholder="Phone" aria-label="Phone" className={inputClass} />
      </div>
      {error && <div role="alert" className="mt-2 text-sm text-red-700">{error}</div>}
      <button type="button" className={`${buttonPrimary} mt-3`} onClick={save} disabled={saving || !form.name.trim()}>
        {saving ? 'Saving' : 'Save supplier'}
      </button>
    </div>
  );
}
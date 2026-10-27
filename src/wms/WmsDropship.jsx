import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { wms, fmtDate, fmtDateTime, Badge, inputClass, buttonPrimary, buttonPlain } from './api';

const LABEL = { draft: 'Not sent', sent: 'Waiting for supplier', needs_review: 'Needs you', fulfilled: 'Done', failed: 'Problem', skipped: 'Skipped' };
const NEEDS_YOU = ['draft', 'failed', 'needs_review'];
const FILTERS = [['', 'All'], ['attention', 'Needs you'], ['sent', 'Waiting for supplier'], ['fulfilled', 'Done'], ['skipped', 'Skipped']];

// Dropship: orders that suppliers ship straight to the customer, plus the setup
// that drives it (which products, which supplier, when to re-order, and Gmail).
export default function WmsDropship() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('gmail') || params.get('gmail_error') ? 'settings' : 'requests');
  const [attention, setAttention] = useState(0);
  const tabs = [['requests', 'Requests'], ['products', 'Products'], ['settings', 'Settings']];

  return (
    <div>
      <div role="tablist" aria-label="Dropship" className="flex gap-1 border-b border-slate-200 mb-4">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px cursor-pointer ${
              tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-ink'
            }`}
          >
            {label}
            {id === 'requests' && attention > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[0.7rem] font-bold text-white">{attention}</span>
            )}
          </button>
        ))}
      </div>
      {tab === 'requests' && <RequestsTab onAttention={setAttention} />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'settings' && <SettingsTab gmailParam={params.get('gmail')} gmailError={params.get('gmail_error')} />}
    </div>
  );
}

// ---------------------------------------------------------------- requests
function RequestsTab({ onAttention }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('attention');
  const [selectedId, setSelectedId] = useState(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from('dropship_requests').select('*').order('created_at', { ascending: false }).limit(200);
    if (err) setError(err.message);
    else {
      setError(null);
      setRows(data || []);
      onAttention((data || []).filter((r) => NEEDS_YOU.includes(r.status)).length);
    }
    setLoading(false);
  }, [onAttention]);

  useEffect(() => {
    load();
  }, [load]);

  const checkNow = async () => {
    setChecking(true);
    setNotice(null);
    try {
      const r = await wms('dropship_tick');
      const bits = [
        !r.enabled && 'Dropship is switched off in Settings, so new orders were not picked up.',
        r.new_requests && `${r.new_requests} new order${r.new_requests === 1 ? '' : 's'}`,
        r.emails_sent && `${r.emails_sent} email${r.emails_sent === 1 ? '' : 's'} sent`,
        r.fulfilled && `${r.fulfilled} completed in Shopify`,
        r.needs_review && `${r.needs_review} need${r.needs_review === 1 ? 's' : ''} you`,
        !r.mail_connected && 'Gmail is not connected.',
        ...(r.errors || []),
      ].filter(Boolean);
      setNotice({ type: r.errors?.length ? 'error' : 'success', text: bits.length ? bits.join(' · ') : 'Nothing new.' });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    }
    setChecking(false);
  };

  const visible = useMemo(
    () => rows.filter((r) => (filter === 'attention' ? NEEDS_YOU.includes(r.status) : !filter || r.status === filter)),
    [rows, filter]
  );
  const selected = rows.find((r) => r.id === selectedId) || null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden" aria-label="Dropship requests">
        <div className="p-3 border-b border-slate-100 space-y-2">
          <button type="button" className={`${buttonPlain} w-full`} onClick={checkNow} disabled={checking}>
            {checking ? 'Checking' : 'Check now'}
          </button>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter requests">
            {FILTERS.map(([value, label]) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer ${filter === value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {notice && (
          <div role={notice.type === 'error' ? 'alert' : 'status'} className={`m-3 p-2.5 text-sm rounded-md border ${notice.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            {notice.text}
          </div>
        )}
        {error && <div role="alert" className="m-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">{error}</div>}
        {!error && !loading && visible.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">
            {rows.length === 0 ? 'No dropship orders yet. Set up products in the Products tab, then switch it on in Settings.' : 'Nothing here.'}
          </div>
        )}
        <ul className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
          {visible.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setSelectedId(r.id)} className={`w-full text-left px-3 py-2.5 cursor-pointer ${r.id === selectedId ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink">{r.order_name} <span className="font-normal text-slate-600">{r.supplier_name || 'No supplier'}</span></div>
                    <div className="text-xs text-slate-500">{r.lines.map((l) => `${l.quantity} × ${l.title}`).join(', ')}</div>
                    {r.error && r.status !== 'fulfilled' && <div className="text-xs text-red-700 mt-0.5">{r.error}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge status={r.status}>{LABEL[r.status]}</Badge>
                    <div className="text-xs text-slate-500 mt-0.5">{fmtDate(r.sent_at || r.created_at)}</div>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="lg:col-span-3 bg-white border border-slate-200 rounded-xl" aria-label="Request details" aria-live="polite">
        {!selected && <div className="p-12 text-center text-sm text-slate-500">Pick an order to see what was sent and what the supplier said.</div>}
        {selected && <RequestDetail key={selected.id + selected.updated_at} r={selected} onChanged={load} />}
        <OlderOrder onDone={load} />
      </section>
    </div>
  );
}

function RequestDetail({ r, onChanged }) {
  const [tracking, setTracking] = useState(r.tracking_number || '');
  const [carrier, setCarrier] = useState(r.carrier || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const open = !['fulfilled', 'skipped'].includes(r.status);

  const act = async (action, extra, done) => {
    setBusy(true);
    setMessage(null);
    try {
      await wms(action, { id: r.id, ...extra });
      setMessage({ type: 'success', text: done });
      await onChanged();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
    setBusy(false);
  };

  const ship = r.ship_to || {};
  return (
    <div>
      <header className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="page-title text-[1.6rem] text-ink">{r.order_name}</h2>
          <div className="text-sm text-slate-600">
            {r.supplier_name || 'No supplier'}{r.supplier_email ? ` · ${r.supplier_email}` : ''}
          </div>
        </div>
        <Badge status={r.status}>{LABEL[r.status]}</Badge>
      </header>

      {r.error && r.status !== 'fulfilled' && (
        <div role="alert" className="mx-5 mb-3 p-2.5 bg-amber-50 border border-amber-300 text-amber-900 text-sm rounded-md">{r.error}</div>
      )}
      {message && (
        <div role={message.type === 'error' ? 'alert' : 'status'} className={`mx-5 mb-3 p-2.5 text-sm rounded-md border ${message.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
          {message.text}
        </div>
      )}

      <section className="px-5 py-3 border-t border-slate-100">
        <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase mb-1">Items</h3>
        <ul className="text-sm">
          {r.lines.map((l, i) => (
            <li key={i}>{l.quantity} × <span className="font-semibold text-ink">{l.title}</span> <span className="text-slate-500">SKU {l.supplier_sku || l.sku}</span></li>
          ))}
        </ul>
      </section>

      <section className="px-5 py-3 border-t border-slate-100 grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase mb-1">Ship to</h3>
          <div className="leading-snug">
            {[ship.name, [ship.address1, ship.address2].filter(Boolean).join(', '), [ship.city, ship.provinceCode, ship.zip].filter(Boolean).join(' '), ship.country].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase mb-1">Customer</h3>
          <div className="leading-snug">
            <div>{r.customer?.name}</div>
            {r.customer?.email && <div className="text-slate-600">{r.customer.email}</div>}
            {r.customer?.phone && <div className="text-slate-600">{r.customer.phone}</div>}
            {r.customer?.note && <div className="text-slate-600 mt-1">Note: {r.customer.note}</div>}
          </div>
        </div>
      </section>

      <section className="px-5 py-3 border-t border-slate-100 text-sm">
        <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase mb-1">Supplier</h3>
        {r.sent_at ? <div>Emailed {fmtDateTime(r.sent_at)}</div> : <div className="text-slate-500">Not emailed yet.</div>}
        {r.reply_summary && <div className="mt-1"><span className="font-semibold">Reply:</span> {r.reply_summary}</div>}
        {r.reply_text && (
          <details className="mt-1">
            <summary className="cursor-pointer text-blue-700 font-semibold">Read their reply</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700">{r.reply_text}</pre>
          </details>
        )}
        {r.status === 'fulfilled' && (
          <div className="mt-1">Completed in Shopify {fmtDateTime(r.fulfilled_at)}: <span className="font-mono font-semibold">{r.tracking_number}</span> {r.carrier}</div>
        )}
      </section>

      {open && (
        <section className="px-5 py-4 border-t border-slate-100">
          <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase mb-2">Complete in Shopify</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ds-track" className="block text-sm font-semibold text-ink mb-1">Tracking number</label>
              <input id="ds-track" value={tracking} onChange={(e) => setTracking(e.target.value)} className={inputClass} placeholder="As the supplier gave it" />
            </div>
            <div>
              <label htmlFor="ds-carrier" className="block text-sm font-semibold text-ink mb-1">Carrier</label>
              <input id="ds-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} className={inputClass} placeholder="e.g. Australia Post" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonPrimary} disabled={busy || !tracking.trim()}
              onClick={() => act('dropship_confirm', { tracking_number: tracking, carrier }, 'Completed in Shopify. The customer has been emailed their tracking.')}>
              Confirm and complete in Shopify
            </button>
            {['draft', 'failed'].includes(r.status) && r.supplier_id && (
              <button type="button" className={buttonPlain} disabled={busy} onClick={() => act('dropship_send', {}, 'Email sent to the supplier.')}>Send email now</button>
            )}
            <button type="button" className={buttonPlain} disabled={busy} onClick={() => act('dropship_skip', {}, 'Skipped.')}>Skip this order</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Confirming marks the order shipped in Shopify and emails the customer the tracking.</p>
        </section>
      )}
    </div>
  );
}

// An order from before dropship was switched on (the automatic check never emails the backlog).
function OlderOrder({ onDone }) {
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const send = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const found = await wms('list_orders', { search: number.trim() });
      const wanted = number.trim().replace('#', '');
      const hit = found.orders.find((o) => o.name.replace('#', '') === wanted);
      if (!hit) throw new Error(`No order ${number.trim()} found in Shopify.`);
      const r = await wms('dropship_create_for_order', { order_id: hit.id });
      setMessage({ type: 'success', text: `${hit.name}: ${r.created} request created, ${r.sent} email sent.` });
      setNumber('');
      await onDone();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
    setBusy(false);
  };

  return (
    <section className="px-5 py-4 border-t border-slate-100">
      <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase mb-1">Send an older order to its supplier</h3>
      <p className="text-xs text-slate-500 mb-2">Orders placed before dropship was switched on are never emailed automatically. Do one by hand here.</p>
      <div className="flex gap-2 max-w-sm">
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Order number, e.g. #122313" aria-label="Order number" className={inputClass} />
        <button type="button" className={`${buttonPlain} shrink-0`} onClick={send} disabled={busy || !number.trim()}>{busy ? 'Sending' : 'Send'}</button>
      </div>
      {message && <div role={message.type === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${message.type === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{message.text}</div>}
    </section>
  );
}

// ---------------------------------------------------------------- products
const PAGE = 50;

function ProductsTab() {
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState('');
  const [onlySetUp, setOnlySetUp] = useState(false);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async (from = 0, replace = true) => {
    setLoading(true);
    let query = supabase
      .from('products')
      .select('id, sku, name, is_dropship, reorder_point, reorder_to, product_supplier(supplier_id, supplier_sku, last_cost, moq, is_primary)')
      .eq('status', 'Active')
      .order('sku')
      .range(from, from + PAGE - 1);
    const t = search.replace(/[,()%*\\]/g, ' ').trim();
    if (t.length >= 2) query = query.or(`sku.ilike.%${t}%,name.ilike.%${t}%`);
    if (onlySetUp) query = query.or('is_dropship.eq.true,reorder_point.not.is.null');
    const { data, error: err } = await query;
    if (err) setError(err.message);
    else {
      setError(null);
      setRows((prev) => (replace ? data : [...prev, ...data]));
      setMore((data || []).length === PAGE);
    }
    setLoading(false);
  }, [search, onlySetUp]);

  useEffect(() => {
    const h = setTimeout(() => load(0, true), 350);
    return () => clearTimeout(h);
  }, [load]);

  useEffect(() => {
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name').then(({ data }) => setSuppliers(data || []));
  }, []);

  const baseOf = (p) => {
    const ps = (p.product_supplier || []).find((x) => x.is_primary) || {};
    return { is_dropship: !!p.is_dropship, supplier_id: ps.supplier_id || '', supplier_sku: ps.supplier_sku || '', cost: ps.last_cost ?? '', moq: ps.moq ?? '', reorder_point: p.reorder_point ?? '', reorder_to: p.reorder_to ?? '' };
  };
  const valueOf = (p) => edits[p.id] || baseOf(p);
  const edit = (p, patch) => setEdits((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] || baseOf(p)), ...patch } }));
  const changed = rows.filter((p) => edits[p.id] && JSON.stringify(edits[p.id]) !== JSON.stringify(baseOf(p)));

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await wms('save_product_setup', { rows: changed.map((p) => ({ product_id: p.id, ...edits[p.id] })) });
      setEdits({});
      setNotice({ type: 'success', text: `Saved ${changed.length} product${changed.length === 1 ? '' : 's'}.` });
      await load(0, true);
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    }
    setSaving(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="p-4 border-b border-slate-100 space-y-3">
        <p className="text-sm text-slate-600 max-w-3xl">
          <b>Dropship</b>: when a paid order has this product, the supplier is emailed to ship it to the customer.
          <b> Re-order at / Order up to</b>: when available plus on-order stock falls to the first number, a purchase order is drafted to bring it back up to the second.
          Leave both blank to not auto-order. Each product needs a supplier.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU or name" aria-label="Search products" className={`${inputClass} max-w-xs`} />
          <label className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={onlySetUp} onChange={(e) => setOnlySetUp(e.target.checked)} /> Only products I've set up
          </label>
          <div className="ml-auto flex items-center gap-2">
            {changed.length > 0 && <button type="button" className={buttonPlain} onClick={() => setEdits({})} disabled={saving}>Discard</button>}
            <button type="button" className={buttonPrimary} onClick={save} disabled={saving || changed.length === 0}>
              {saving ? 'Saving' : `Save ${changed.length || ''} change${changed.length === 1 ? '' : 's'}`.replace('Save  change', 'Save changes')}
            </button>
          </div>
        </div>
        {notice && <div role={notice.type === 'error' ? 'alert' : 'status'} className={`text-sm ${notice.type === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{notice.text}</div>}
        {error && <div role="alert" className="text-sm text-red-700">{error}</div>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="p-2 pl-4 font-semibold">Product</th>
              <th className="p-2 font-semibold text-center">Dropship</th>
              <th className="p-2 font-semibold">Supplier</th>
              <th className="p-2 font-semibold">Supplier SKU</th>
              <th className="p-2 font-semibold w-24">Cost</th>
              <th className="p-2 font-semibold w-24">Re-order at</th>
              <th className="p-2 pr-4 font-semibold w-24">Order up to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => {
              const v = valueOf(p);
              const dirty = changed.includes(p);
              return (
                <tr key={p.id} className={dirty ? 'bg-amber-50/60' : ''}>
                  <td className="p-2 pl-4"><div className="font-semibold text-ink">{p.name}</div><div className="text-xs text-slate-500">SKU {p.sku}</div></td>
                  <td className="p-2 text-center"><input type="checkbox" checked={v.is_dropship} onChange={(e) => edit(p, { is_dropship: e.target.checked })} aria-label={`Dropship ${p.sku}`} /></td>
                  <td className="p-2">
                    <select value={v.supplier_id} onChange={(e) => edit(p, { supplier_id: e.target.value })} aria-label={`Supplier for ${p.sku}`} className={inputClass}>
                      <option value="">None</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td className="p-2"><input value={v.supplier_sku} onChange={(e) => edit(p, { supplier_sku: e.target.value })} aria-label={`Supplier SKU for ${p.sku}`} className={inputClass} /></td>
                  <td className="p-2"><input type="number" min="0" step="0.01" value={v.cost} onChange={(e) => edit(p, { cost: e.target.value })} aria-label={`Cost for ${p.sku}`} className={inputClass} /></td>
                  <td className="p-2"><input type="number" min="0" step="1" value={v.reorder_point} onChange={(e) => edit(p, { reorder_point: e.target.value })} aria-label={`Re-order at for ${p.sku}`} className={inputClass} /></td>
                  <td className="p-2 pr-4"><input type="number" min="0" step="1" value={v.reorder_to} onChange={(e) => edit(p, { reorder_to: e.target.value })} aria-label={`Order up to for ${p.sku}`} className={inputClass} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {loading && <div className="p-4 text-center text-sm text-slate-500">Loading</div>}
      {!loading && rows.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No products match. Run Sync now (Procurement) if the catalogue is empty.</div>}
      {more && !loading && (
        <div className="p-3 border-t border-slate-100"><button type="button" className={`${buttonPlain} w-full`} onClick={() => load(rows.length, false)}>Load more</button></div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings
// Small building blocks for the Settings tab. They live out here (not inside
// SettingsTab) so typing in a box doesn't rebuild them and drop your cursor.
function Switch({ id, checked, onChange, label, hint, busy }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer">
      <input id={id} type="checkbox" checked={checked} disabled={busy} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <span><span className="block text-sm font-semibold text-ink">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}
function Card({ title, children }) {
  return <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"><h3 className="text-sm font-bold text-ink">{title}</h3>{children}</section>;
}

function SettingsTab({ gmailParam, gmailError }) {
  const [mail, setMail] = useState(null);
  const [settings, setSettings] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [signature, setSignature] = useState('');
  const [message, setMessage] = useState(gmailParam ? { type: 'success', text: 'Gmail is connected.' } : gmailError ? { type: 'error', text: `Gmail wasn't connected: ${gmailError}` } : null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setMail(await wms('mail_status')); } catch (err) { setMessage({ type: 'error', text: err.message }); }
    const { data } = await supabase.from('wms_settings').select('*').maybeSingle();
    setSettings(data || { dropship_enabled: false, auto_fulfil: true, auto_order_enabled: false });
    setSignature(data?.signature || '');
    const sup = await supabase.from('suppliers').select('id, name, email, contact_name, phone, auto_order').eq('is_active', true).order('name');
    setSuppliers(sup.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, success) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      if (success) setMessage({ type: 'success', text: typeof success === 'function' ? success(r) : success });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
    setBusy(false);
  };
  const saveSetting = (patch, success) => run(async () => { const r = await wms('save_wms_settings', patch); setSettings(r.settings); return r; }, success);

  if (!settings || !mail) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      {message && (
        <div role={message.type === 'error' ? 'alert' : 'status'} className={`p-3 text-sm rounded-md border ${message.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{message.text}</div>
      )}

      <Card title="Gmail">
        {mail.connected ? (
          <>
            <p className="text-sm text-slate-700">Connected as <b>{mail.email}</b>. Orders and purchase orders go out from this mailbox, and supplier replies are read from it.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonPlain} disabled={busy} onClick={() => run(() => wms('mail_test'), (r) => `Test email sent to ${r.to}.`)}>Send a test email</button>
              <button type="button" className={buttonPlain} disabled={busy} onClick={() => run(async () => { await wms('mail_disconnect'); await load(); }, 'Gmail disconnected.')}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-700">Not connected. Connect the mailbox you want supplier emails sent from.</p>
            {mail.google_configured ? (
              <button type="button" className={buttonPrimary} disabled={busy} onClick={() => run(async () => { const r = await wms('mail_connect_url'); window.location.assign(r.url); })}>Connect Gmail</button>
            ) : (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5">The Google details haven't been added yet. Follow the steps below first.</p>
            )}
          </>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-blue-700">One-time Google setup</summary>
          <ol className="mt-2 list-decimal pl-5 space-y-1 text-slate-700">
            <li>In Google Cloud Console, create or pick a project and turn on the <b>Gmail API</b>.</li>
            <li>OAuth consent screen: choose <b>Internal</b> if you use Google Workspace. With "External", Google makes the connection expire every 7 days.</li>
            <li>Credentials: create an <b>OAuth client ID</b> of type <b>Web application</b>. Under Authorised redirect URIs add: <code className="break-all rounded bg-slate-100 px-1">{mail.redirect_uri}</code></li>
            <li>In Supabase, add the secrets <code>GMAIL_CLIENT_ID_METROBABY</code>, <code>GMAIL_CLIENT_SECRET_METROBABY</code> and <code>APP_URL</code> (this app's web address).</li>
            <li>Come back here and press <b>Connect Gmail</b>, and allow both permissions (send and read email).</li>
          </ol>
        </details>
      </Card>

      <Card title="Dropship orders">
        <Switch busy={busy} id="ds-on" checked={!!settings.dropship_enabled} label="Email suppliers when a paid order with dropship items arrives"
          hint={settings.dropship_enabled && settings.dropship_start_at ? `On since ${fmtDateTime(settings.dropship_start_at)}. Orders placed before then are never emailed automatically.` : 'Turning this on starts from now. Orders already in Shopify are left alone.'}
          onChange={(v) => saveSetting({ dropship_enabled: v }, v ? 'Dropship is on. New paid orders will be emailed to suppliers within about 5 minutes.' : 'Dropship is off.')} />
        <Switch busy={busy} id="ds-auto" checked={settings.auto_fulfil !== false} label="Complete the order in Shopify when the supplier replies with tracking"
          hint="Only when the reply clearly says it shipped and the tracking number appears in the email. Anything unclear waits for you. The customer is emailed their tracking."
          onChange={(v) => saveSetting({ auto_fulfil: v }, v ? 'Orders will be completed automatically.' : 'Replies will wait for you to confirm.')} />
        <p className="text-xs text-slate-500">{mail.ai_configured ? 'AI reading of replies is on.' : 'AI reading of replies is not set up (add ANTHROPIC_API_KEY). Until then every reply waits for you to confirm.'}</p>
      </Card>

      <Card title="Automatic ordering">
        <Switch busy={busy} id="ao-on" checked={!!settings.auto_order_enabled} label="Check stock every day and draft purchase orders for what's low"
          hint="Uses each product's Re-order at / Order up to levels (Products tab). Drafts wait on the Purchases page. A supplier marked automatic below is ordered and emailed without a click."
          onChange={(v) => saveSetting({ auto_order_enabled: v }, v ? 'Automatic ordering is on.' : 'Automatic ordering is off.')} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-semibold">Supplier</th><th className="py-1 font-semibold">Email</th><th className="py-1 font-semibold text-center">Order automatically</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {suppliers.map((s) => <SupplierRow key={s.id} s={s} disabled={busy} onSave={(patch) => run(async () => { await wms('save_supplier', { id: s.id, name: s.name, ...patch }); await load(); }, `${s.name} saved.`)} />)}
              {suppliers.length === 0 && <tr><td colSpan={4} className="py-3 text-slate-500">No suppliers yet. Add one when you create a purchase order.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Email signature">
        <textarea rows={3} value={signature} onChange={(e) => setSignature(e.target.value)} aria-label="Email signature" className={`${inputClass} h-auto py-2`} placeholder={'e.g. Sam, Metro Baby\nmetrobaby.com.au'} />
        <button type="button" className={buttonPlain} disabled={busy || signature === (settings.signature || '')} onClick={() => saveSetting({ signature }, 'Signature saved.')}>Save signature</button>
      </Card>
    </div>
  );
}

function SupplierRow({ s, onSave, disabled }) {
  const [email, setEmail] = useState(s.email || '');
  const dirty = email.trim() !== (s.email || '');
  return (
    <tr>
      <td className="py-2 pr-2 font-semibold text-ink">{s.name}</td>
      <td className="py-2 pr-2"><input value={email} onChange={(e) => setEmail(e.target.value)} aria-label={`Email for ${s.name}`} className={inputClass} placeholder="orders@supplier.com" /></td>
      <td className="py-2 text-center"><input type="checkbox" checked={!!s.auto_order} disabled={disabled || !s.email} onChange={(e) => onSave({ auto_order: e.target.checked })} aria-label={`Order automatically from ${s.name}`} title={s.email ? '' : 'Save an email address first'} /></td>
      <td className="py-2 pl-2"><button type="button" className={buttonPlain} disabled={disabled || !dirty} onClick={() => onSave({ email, contact_name: s.contact_name, phone: s.phone })}>Save</button></td>
    </tr>
  );
}
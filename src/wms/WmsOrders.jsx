import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { wms, fmtMoney, fmtDate, fmtDateTime, nice, Badge } from './api';

const FILTERS = [
  ['', 'All orders'],
  ['unfulfilled', 'Unfulfilled'],
  ['fulfilled', 'Fulfilled'],
  ['unpaid', 'Unpaid'],
  ['cancelled', 'Cancelled'],
];

// Every Shopify order, read live from the store, with everything Shopify holds
// about it. Nothing is copied or cached here, so what you see is what Shopify has.
export default function WmsOrders() {
  const [orders, setOrders] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const load = async (cursor = null) => {
    setLoading(true);
    setListError(null);
    try {
      const res = await wms('list_orders', { search, filter, cursor });
      setOrders((prev) => (cursor ? [...prev, ...res.orders] : res.orders));
      setPageInfo(res.page_info);
    } catch (err) {
      setListError(err.message);
    }
    setLoading(false);
  };

  // Searching happens in Shopify (not just in what's already loaded), so wait
  // for a pause in typing before asking.
  useEffect(() => {
    const t = setTimeout(() => load(null), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter]);

  const open = async (id) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      setDetail(await wms('get_order', { orderId: id }));
    } catch (err) {
      setDetailError(err.message);
    }
    setDetailLoading(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      {/* ---------------------------------------------------------- list */}
      <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden" aria-label="Orders">
        <div className="p-3 border-b border-slate-100 space-y-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order #, name or email"
            aria-label="Search orders"
            className="w-full h-9 text-sm bg-slate-50 border border-slate-300 rounded-md px-3 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter orders">
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
        {!listError && !loading && orders.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">No orders match.</div>
        )}

        <ul className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
          {orders.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => open(o.id)}
                className={`w-full text-left px-3 py-2.5 cursor-pointer ${o.id === selectedId ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink">
                      {o.name} <span className="font-normal text-slate-600">{o.customer}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {fmtDate(o.created_at)} &middot; {o.item_count} item{o.item_count === 1 ? '' : 's'}
                      {o.ship_to ? ` · ${o.ship_to}` : ''}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {o.cancelled_at ? <Badge status="CANCELLED" /> : <Badge status={o.fulfillment_status} />}
                      <Badge status={o.financial_status} />
                    </div>
                  </div>
                  <div className="text-sm font-bold text-ink whitespace-nowrap">{fmtMoney(o.total, o.currency)}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>

        {loading && <div className="p-3 text-center text-sm text-slate-500">Loading orders</div>}
        {pageInfo?.hasNextPage && !loading && (
          <div className="p-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => load(pageInfo.endCursor)}
              className="w-full py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-sm font-semibold cursor-pointer"
            >
              Load more
            </button>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- detail */}
      <section className="lg:col-span-3 bg-white border border-slate-200 rounded-xl" aria-label="Order details" aria-live="polite">
        {!selectedId && <div className="p-12 text-center text-sm text-slate-500">Pick an order to see everything about it.</div>}
        {detailLoading && <div className="p-12 text-center text-sm text-slate-500">Loading order</div>}
        {detailError && (
          <div role="alert" className="m-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
            {detailError}
          </div>
        )}
        {detail && !detailLoading && <OrderDetail data={detail} />}
      </section>
    </div>
  );
}

function Section({ title, children, aside }) {
  return (
    <section className="px-5 py-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Address({ a }) {
  if (!a) return <div className="text-sm text-slate-400">None</div>;
  const lines = [
    a.name,
    a.company,
    [a.address1, a.address2].filter(Boolean).join(', '),
    [a.city, a.provinceCode || a.province, a.zip].filter(Boolean).join(' '),
    a.country,
    a.phone,
  ].filter(Boolean);
  return (
    <div className="text-sm text-ink leading-snug">
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? 'font-semibold' : 'text-slate-600'}>{l}</div>
      ))}
    </div>
  );
}

function Row({ label, value, strong, tone }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${strong ? 'font-bold text-ink border-t border-slate-200 mt-1 pt-2' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className={tone}>{value}</span>
    </div>
  );
}

function OrderDetail({ data }) {
  const o = data.order;
  const c = o.currency;
  const warnings = Object.entries(data.warnings || {});
  const fulfilled = o.lines.reduce((n, l) => n + Math.max(0, (l.current_quantity ?? l.quantity) - (l.unfulfilled_quantity ?? 0)), 0);
  const total = o.lines.reduce((n, l) => n + (l.current_quantity ?? l.quantity), 0);

  return (
    <div>
      <header className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="page-title text-[1.7rem] text-ink">{o.name}</h2>
          <div className="text-sm text-slate-600">
            Placed {fmtDateTime(o.created_at)}
            {o.source ? ` · via ${o.app || o.source}` : ''}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {o.cancelled_at ? <Badge status="CANCELLED">Cancelled {fmtDate(o.cancelled_at)}</Badge> : <Badge status={o.fulfillment_status} />}
            <Badge status={o.financial_status} />
            {o.test && <Badge status="DRAFT">Test order</Badge>}
            {o.tags.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.7rem] font-semibold text-slate-600">{t}</span>
            ))}
          </div>
        </div>
        <a
          href={o.admin_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 text-sm font-semibold text-ink hover:border-blue-600 hover:text-blue-700"
        >
          Open in Shopify <ExternalLink size={14} />
        </a>
      </header>

      {warnings.length > 0 && (
        <div className="mx-5 mb-3 p-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-md">
          Some details couldn't be loaded from Shopify: {warnings.map(([k, v]) => `${k} (${v})`).join('; ')}
        </div>
      )}

      <Section title="Customer">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="text-sm leading-snug">
            <div className="font-semibold text-ink">{o.customer?.displayName || o.shipping_address?.name || 'Guest'}</div>
            {(o.email || o.customer?.email) && <div className="text-slate-600">{o.email || o.customer?.email}</div>}
            {(o.phone || o.customer?.phone) && <div className="text-slate-600">{o.phone || o.customer?.phone}</div>}
            {o.customer?.orders_count != null && <div className="text-slate-500 text-xs mt-1">{o.customer.orders_count} orders in total</div>}
          </div>
          <div className="text-sm">
            {o.note ? (
              <>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Customer note</div>
                <div className="text-ink">{o.note}</div>
              </>
            ) : (
              <div className="text-slate-400">No customer note</div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Addresses">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1">Ship to</div>
            <Address a={o.shipping_address} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1">Billing</div>
            <Address a={o.billing_address} />
          </div>
        </div>
      </Section>

      <Section title={`Items (${fulfilled} of ${total} fulfilled)`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1 pr-2 font-semibold w-10"></th>
                <th className="py-1 pr-2 font-semibold">Product</th>
                <th className="py-1 pr-2 font-semibold text-right">Qty</th>
                <th className="py-1 pr-2 font-semibold text-right">Price</th>
                <th className="py-1 pr-2 font-semibold text-right">Discount</th>
                <th className="py-1 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {o.lines.map((l) => {
                const unf = l.unfulfilled_quantity ?? 0;
                return (
                  <tr key={l.id} className="align-top">
                    <td className="py-2 pr-2">
                      {l.image_url && <img src={l.image_url} alt="" className="w-9 h-9 rounded object-cover" />}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-semibold text-ink">{l.title}</div>
                      {l.variant_title && <div className="text-xs text-slate-500">{l.variant_title}</div>}
                      <div className="text-xs text-slate-500">
                        {l.sku ? `SKU ${l.sku}` : 'No SKU'}
                        {l.vendor ? ` · ${l.vendor}` : ''}
                      </div>
                      {unf > 0 && <div className="text-xs font-semibold text-amber-700">{unf} still to fulfil</div>}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {l.current_quantity ?? l.quantity}
                      {l.current_quantity != null && l.current_quantity !== l.quantity && (
                        <div className="text-xs text-slate-400">was {l.quantity}</div>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">{fmtMoney(l.unit_price, c)}</td>
                    <td className="py-2 pr-2 text-right text-red-700">{l.discount > 0 ? `-${fmtMoney(l.discount, c)}` : ''}</td>
                    <td className="py-2 text-right font-semibold">{fmtMoney(l.total, c)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Payment">
        <div className="max-w-sm ml-auto">
          <Row label="Subtotal" value={fmtMoney(o.totals.subtotal, c)} />
          {o.totals.discounts > 0 && (
            <Row
              label={`Discount${o.discount_codes.length ? ` (${o.discount_codes.join(', ')})` : ''}`}
              value={`-${fmtMoney(o.totals.discounts, c)}`}
              tone="text-red-700"
            />
          )}
          <Row label={`Shipping${o.shipping_method ? ` (${o.shipping_method.title})` : ''}`} value={fmtMoney(o.totals.shipping, c)} />
          <Row label="Tax included" value={fmtMoney(o.totals.tax, c)} />
          <Row label="Total" value={fmtMoney(o.totals.total, c)} strong />
          {o.totals.refunded > 0 && <Row label="Refunded" value={`-${fmtMoney(o.totals.refunded, c)}`} tone="text-red-700" />}
          {o.totals.net_payment != null && <Row label="Net payment" value={fmtMoney(o.totals.net_payment, c)} />}
        </div>
        {o.gateways.length > 0 && <div className="mt-2 text-xs text-slate-500">Paid with {o.gateways.join(', ')}</div>}
        {o.transactions.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {o.transactions.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Badge status={t.status} />
                <span className="font-semibold text-ink">{nice(t.kind)}</span>
                <span className="text-slate-600">{fmtMoney(t.amount, t.currency)}</span>
                <span className="text-xs text-slate-500">
                  {t.gateway} &middot; {fmtDateTime(t.processed_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Fulfilment">
        {o.fulfillments.length === 0 && o.fulfillment_orders.length === 0 && (
          <div className="text-sm text-slate-500">Nothing has been fulfilled yet.</div>
        )}
        {o.fulfillments.map((f) => (
          <div key={f.id} className="mb-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={f.status} />
              <span className="text-slate-600">{fmtDateTime(f.created_at)}</span>
            </div>
            {f.tracking.map((t, i) => (
              <div key={i} className="mt-1">
                {t.company && <span className="text-slate-600">{t.company} </span>}
                {t.url ? (
                  <a href={t.url} target="_blank" rel="noreferrer" className="font-mono font-semibold text-blue-700 hover:underline">
                    {t.number}
                  </a>
                ) : (
                  <span className="font-mono font-semibold">{t.number}</span>
                )}
              </div>
            ))}
            <div className="mt-1 text-xs text-slate-500">{f.items.map((i) => `${i.quantity} × ${i.title}`).join(', ')}</div>
          </div>
        ))}
        {o.fulfillment_orders.map((f) => (
          <div key={f.id} className="mb-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={f.status} />
              {f.location && <span className="text-slate-600">at {f.location}</span>}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {f.items.map((i) => `${i.remaining} of ${i.total} × ${i.title} left`).join(', ')}
            </div>
          </div>
        ))}
      </Section>

      {o.refunds.length > 0 && (
        <Section title="Refunds">
          {o.refunds.map((r) => (
            <div key={r.id} className="text-sm mb-2">
              <span className="font-semibold text-red-700">-{fmtMoney(r.total, c)}</span>{' '}
              <span className="text-slate-600">{fmtDateTime(r.created_at)}</span>
              {r.note && <div className="text-slate-600">{r.note}</div>}
              <div className="text-xs text-slate-500">{r.items.map((i) => `${i.quantity} × ${i.title}`).join(', ')}</div>
            </div>
          ))}
        </Section>
      )}

      {o.custom_attributes.length > 0 && (
        <Section title="Additional details">
          <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {o.custom_attributes.map((a, i) => (
              <div key={i} className="contents">
                <dt className="text-slate-500">{a.key}</dt>
                <dd className="text-ink">{a.value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {o.events.length > 0 && (
        <Section title="Timeline">
          <ol className="space-y-1.5 text-sm">
            {o.events.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-36 shrink-0 text-xs text-slate-500 pt-0.5">{fmtDateTime(e.created_at)}</span>
                <span className="text-ink">{e.message}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}
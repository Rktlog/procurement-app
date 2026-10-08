import { useEffect, useState } from 'react';
import { supabase, shopifyProxy } from '../supabaseClient';

// Shows which Shopify store this company is actually connected to, read from
// the live connection, so nobody fulfils orders against the wrong store. For
// companies with their own proxy it also has a "Details" check that explains
// why the order list might be empty.

const NEEDED_SCOPES = [
  'read_orders',
  'read_merchant_managed_fulfillment_orders',
  'write_merchant_managed_fulfillment_orders',
];

async function callProxy(action) {
  const { data, error } = await supabase.functions.invoke(shopifyProxy(), { body: { action } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'No response');
  return data;
}

// Turns Shopify's answer into plain-English reasons.
function explain(d) {
  const tips = [];
  const orders = d.recent_orders || [];

  if (d.errors?.counts || d.errors?.recent_orders) {
    tips.push('Shopify refused the order lookup. The app most likely lacks the read_orders permission.');
  }
  if (d.scopes) {
    const missing = NEEDED_SCOPES.filter((s) => !d.scopes.includes(s));
    if (missing.length) {
      tips.push(`The Shopify app is missing these permissions: ${missing.join(', ')}. Add them under the app's API access, then approve the update.`);
    }
  }
  const unfulfilled = d.counts ? (d.counts.unfulfilled || 0) + (d.counts.partial || 0) : null;
  if (unfulfilled === 0) {
    tips.push('Shopify has no open, unfulfilled orders right now, so an empty list is correct.');
  }
  const notFulfilled = orders.filter((o) => o.fulfillment_status !== 'FULFILLED');
  const hidden = notFulfilled.filter((o) => o.fulfillment_orders.length === 0);
  if (hidden.length) {
    tips.push(
      `${hidden.length} recent order(s) exist (${hidden.slice(0, 5).map((o) => o.name).join(', ')}) but Shopify shows this app no fulfillment order for them. ` +
        'This happens when an order is assigned to a dropship or 3PL location. Add the read/write third-party and assigned fulfillment-order permissions to the Shopify app.'
    );
  }
  const held = notFulfilled.filter(
    (o) => o.fulfillment_orders.length > 0 && !o.fulfillment_orders.some((s) => s === 'OPEN' || s === 'IN_PROGRESS')
  );
  if (held.length) {
    tips.push(
      `${held.length} order(s) (${held.slice(0, 5).map((o) => o.name).join(', ')}) are on hold, scheduled or closed in Shopify, so they're not ready to ship.`
    );
  }
  if (!tips.length) tips.push("Nothing wrong found on Shopify's side.");
  return tips;
}

export default function ShopifyStoreBadge() {
  const [state, setState] = useState({ status: 'loading' });
  const [details, setDetails] = useState(null); // null | 'loading' | { ... } | { error }
  const hasDetails = shopifyProxy() !== 'shopify-proxy';

  useEffect(() => {
    let alive = true;
    callProxy('get_shop_info')
      .then((d) => alive && setState({ status: 'ok', shop: d.shop }))
      .catch((err) => alive && setState({ status: 'error', message: err.message }));
    return () => {
      alive = false;
    };
  }, []);

  const toggleDetails = async () => {
    if (details) return setDetails(null);
    setDetails('loading');
    try {
      setDetails(await callProxy('diagnose'));
    } catch (err) {
      setDetails({ error: err.message });
    }
  };

  if (state.status === 'loading') {
    return <span className="text-[0.8rem] text-slate-500">Checking Shopify connection</span>;
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="max-w-sm text-[0.8rem] text-red-700">
        <span className="font-semibold">Shopify store not connected.</span> {state.message}
      </div>
    );
  }

  return (
    <div className="text-[0.8rem] text-slate-600 md:text-right leading-tight">
      <div>
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle" aria-hidden="true" />
        Connected to <span className="font-semibold text-ink">{state.shop.name}</span>
        {hasDetails && (
          <button
            type="button"
            onClick={toggleDetails}
            className="ml-2 font-semibold text-blue-700 hover:underline cursor-pointer"
          >
            {details ? 'Hide details' : 'Details'}
          </button>
        )}
      </div>
      <div className="text-[0.75rem] text-slate-500">{state.shop.myshopifyDomain}</div>

      {details === 'loading' && <div className="mt-2 text-slate-500">Checking with Shopify</div>}
      {details?.error && <div className="mt-2 text-red-700">{details.error}</div>}
      {details && details !== 'loading' && !details.error && (
        <div className="mt-2 md:ml-auto w-full md:w-[26rem] text-left rounded-lg border border-rule bg-white p-3 space-y-2">
          <ul className="list-disc pl-4 space-y-1 text-ink">
            {explain(details).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          {details.counts && (
            <div className="text-slate-600">
              Open orders: <b>{details.counts.open}</b> &middot; Unfulfilled: <b>{details.counts.unfulfilled}</b> &middot;
              Partly fulfilled: <b>{details.counts.partial}</b>
            </div>
          )}
          {details.scopes && (
            <div className="text-slate-500 break-words">Permissions: {details.scopes.join(', ') || 'none'}</div>
          )}
          {details.recent_orders?.length > 0 && (
            <table className="w-full text-[0.75rem]">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left font-semibold">Order</th>
                  <th className="text-left font-semibold">Status</th>
                  <th className="text-left font-semibold">Fulfillment orders</th>
                </tr>
              </thead>
              <tbody>
                {details.recent_orders.map((o) => (
                  <tr key={o.name}>
                    <td>{o.name}</td>
                    <td>{o.fulfillment_status}</td>
                    <td>{o.fulfillment_orders.length ? o.fulfillment_orders.join(', ') : 'none visible'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
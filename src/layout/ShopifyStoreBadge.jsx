import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

// Shows which Shopify store this company is actually connected to, read from
// the live connection (not from a label), so nobody fulfils orders against
// the wrong store -- and so a new store's secrets can be checked at a glance.
export default function ShopifyStoreBadge() {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.functions.invoke('shopify-proxy', {
        body: { action: 'get_shop_info' },
      });
      if (!alive) return;
      if (error || !data?.success) {
        const detail = await error?.context?.json?.().catch(() => null);
        setState({ status: 'error', message: detail?.error || data?.error || error?.message || 'No response' });
      } else {
        setState({ status: 'ok', shop: data.shop });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle" aria-hidden="true" />
      Connected to <span className="font-semibold text-ink">{state.shop.name}</span>
      <span className="block text-[0.75rem] text-slate-500">{state.shop.myshopifyDomain}</span>
    </div>
  );
}
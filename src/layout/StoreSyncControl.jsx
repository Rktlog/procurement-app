import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase, shopifyProxy } from '../supabaseClient';

// Sync for companies whose products, stock and orders live in Shopify. Shown
// on every Procurement page, because Product search, Urgent orders and the
// forecast all read the tables this sync fills.
//
// The proxy works in chunks of about 90 seconds and says whether it has
// finished, so the button just repeats each step until it's done.
const MAX_CALLS = 120;

async function callSync(action) {
  const { data, error } = await supabase.functions.invoke(shopifyProxy(), { body: { action } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'The sync did not return a result.');
  return data;
}

export default function StoreSyncControl() {
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState('');
  const [msg, setMsg] = useState(null);

  const loadLastSync = async () => {
    const { data } = await supabase
      .from('sync_runs')
      .select('finished_at')
      .in('entity', ['shopify_catalog', 'shopify_orders'])
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.finished_at) setLastSyncedAt(data.finished_at);
  };

  useEffect(() => {
    loadLastSync();
  }, []);

  // Repeats one step until the proxy reports it has finished.
  const runStep = async (action, label, totals) => {
    for (let i = 0; i < MAX_CALLS; i++) {
      const r = await callSync(action);
      if (r.busy) throw new Error('A sync is already running. Try again in a few minutes.');
      for (const [why, n] of Object.entries(r.skipped || {})) totals.skipped[why] = (totals.skipped[why] || 0) + n;
      setProgress(`${label}: ${r.rows_read} read`);
      if (r.done) return r;
    }
    throw new Error(`${label} is taking longer than expected. Click Sync now again to carry on.`);
  };

  const handleSync = async () => {
    setSyncing(true);
    setMsg(null);
    const totals = { skipped: {} };
    try {
      const products = await runStep('sync_catalog', 'Products and stock', totals);
      const orders = await runStep('sync_orders', 'Orders', totals);
      setProgress('Updating the forecast');
      const { error } = await supabase.rpc('refresh_longterm_summary');
      if (error) throw error;

      const notes = Object.entries(totals.skipped)
        .filter(([, n]) => n > 0)
        .map(([why, n]) => `${n} skipped (${why})`);
      setMsg({
        type: 'success',
        text: `Synced ${products.rows_read} variants and ${orders.rows_read} orders.${notes.length ? ' ' + notes.join('; ') + '.' : ''}`,
        reload: true,
      });
      await loadLastSync();
    } catch (err) {
      setMsg({ type: 'error', text: `Sync failed: ${err.message}` });
    }
    setProgress('');
    setSyncing(false);
  };

  return (
    <div className="flex flex-col items-start md:items-end gap-1.5 max-w-md">
      <div className="flex items-center gap-3">
        <div className="text-sm text-slate-600 md:text-right leading-tight">
          {syncing ? (
            <span className="font-semibold text-ink">{progress || 'Starting'}</span>
          ) : lastSyncedAt ? (
            <>
              Shopify synced <span className="font-semibold text-ink">{formatSyncTime(lastSyncedAt)}</span>
            </>
          ) : (
            <span className="text-amber-700 font-medium">Not synced yet. Click Sync now to load products, stock and orders.</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-ink hover:border-blue-600 hover:text-blue-700 disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing' : 'Sync now'}
        </button>
      </div>
      {msg && (
        <div role="status" className={`text-[0.8rem] font-medium ${msg.type === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
          {msg.text}
          {msg.reload && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ml-2 font-semibold text-blue-700 hover:underline cursor-pointer"
            >
              Reload page to see it
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatSyncTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return `${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} at ${time}`;
}
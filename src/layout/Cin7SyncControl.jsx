import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../supabaseClient';

// Cin7 inventory sync. Shown on every Procurement page because Urgent,
// Long-term and Product search all read the tables this sync writes to.
export default function Cin7SyncControl() {
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState(null);

  const fetchLastSyncTime = async () => {
    const { data } = await supabase
      .from('sync_runs')
      .select('finished_at, status')
      .eq('entity', 'inventory_sync')
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.finished_at) setLastSyncedAt(data.finished_at);
  };

  useEffect(() => {
    fetchLastSyncTime();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('cin7-proxy', {
        body: { action: 'sync_inventory_database' },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Cin7 sync did not complete.');
      setMsg({ type: 'success', text: data.message || 'Cin7 data is up to date.' });
      await fetchLastSyncTime();
    } catch (err) {
      setMsg({ type: 'error', text: `Sync failed: ${err.message}` });
    }
    setSyncing(false);
  };

  return (
    <div className="flex flex-col items-start md:items-end gap-1.5">
      <div className="flex items-center gap-3">
        <div className="text-sm text-slate-600 md:text-right leading-tight">
          {lastSyncedAt ? (
            <>
              Cin7 synced <span className="font-semibold text-ink">{formatSyncTime(lastSyncedAt)}</span>
              <span className="block text-[0.78rem] text-slate-500">Runs automatically every 30 min</span>
            </>
          ) : (
            <span className="text-amber-700 font-medium">No Cin7 sync recorded yet</span>
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

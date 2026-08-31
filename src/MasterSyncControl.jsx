import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function MasterSyncControl({ onSyncComplete }) {
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    // Load persisted last sync timestamp from LocalStorage
    const savedTime = localStorage.getItem('cin7_master_last_synced_at');
    if (savedTime) {
      setLastSyncedTime(savedTime);
    }
  }, []);

  const handleMasterSync = async () => {
    setSyncing(true);
    setMsg(null);

    const results = [];
    let hasError = false;

    try {
      // 1. Trigger Cin7 Stock, PO & Inventory Database Sync
      const { data: cin7Data, error: cin7Err } = await supabase.functions.invoke('cin7-proxy', {
        body: { action: 'sync_inventory_database' },
      });

      if (cin7Err || !cin7Data?.success) {
        hasError = true;
        results.push(`Cin7 Inventory Sync: ${cin7Err?.message || cin7Data?.error || 'Failed'}`);
      } else {
        results.push('Cin7 Inventory & Stock Levels synced');
      }

      // 2. Fetch Latest Shopify Orders Cache
      const { data: shopifyData, error: shopifyErr } = await supabase.functions.invoke('shopify-proxy', {
        body: { action: 'fetch_unfulfilled_orders' },
      });

      if (shopifyErr) {
        hasError = true;
        results.push(`Shopify Orders Sync: ${shopifyErr.message}`);
      } else {
        results.push('Shopify Orders synced');
      }

      // 3. Save Timestamp on Success
      const currentTimestamp = new Date().toLocaleString('en-AU', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

      localStorage.setItem('cin7_master_last_synced_at', currentTimestamp);
      setLastSyncedTime(currentTimestamp);

      setMsg({
        type: hasError ? 'error' : 'success',
        text: results.join(' • '),
      });

      // Optional callback to refresh active React components
      if (onSyncComplete) onSyncComplete();

    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Master sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4 my-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg">
          ⚡
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Master System Sync</h2>
          <p className="text-xs text-slate-500">
            {lastSyncedTime ? (
              <>
                Last Synced: <strong className="text-slate-800 font-semibold">{lastSyncedTime}</strong>
              </>
            ) : (
              <span className="text-amber-600 font-medium">Never synced in this session</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {msg && (
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${
            msg.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            {msg.text}
          </span>
        )}

        <button
          type="button"
          onClick={handleMasterSync}
          disabled={syncing}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer"
        >
          {syncing ? (
            <>
              <span className="inline-block animate-spin">🔄</span> Syncing Systems...
            </>
          ) : (
            '🔄 Run Master Sync'
          )}
        </button>
      </div>
    </div>
  );
}
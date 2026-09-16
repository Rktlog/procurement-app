import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Tab 5: Tracking. Reads the same manifest data as Tab 4 (list_auspost_
// manifests), flattened to one row per shipment, since that's already
// where real tracking numbers get recorded at booking time. Status
// checks go through track_auspost_items in batches of 10 -- AusPost's
// real, confirmed limits: max 10 tracking IDs per call, and the
// service itself is rate-limited to 10 calls/minute. A small delay
// between batches is cheap insurance against that second limit for
// anything beyond a very small batch.
export default function AusPostTrackingTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusResults, setStatusResults] = useState({});
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadRows();
  }, []);

  const loadRows = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('cin7-proxy', {
        body: { action: 'list_auspost_manifests' },
      });
      if (invokeError) throw invokeError;
      if (!data.success) throw new Error(data.error);

      const flattened = [];
      (data.manifests || []).forEach((m) => {
        (m.shipments || []).forEach((s) => {
          if (s.tracking_number) {
            flattened.push({
              orderReference: s.shipment_reference || '—',
              trackingNumber: s.tracking_number,
              orderId: m.order_id,
              bookedAt: m.created_at,
            });
          }
        });
      });
      setRows(flattened);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const visibleRows = rows.filter((r) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return r.orderReference.toLowerCase().includes(q) || r.trackingNumber.toLowerCase().includes(q);
  });

  const handleCheckStatus = async () => {
    if (visibleRows.length === 0) return;
    setCheckingStatus(true);

    // Batches of 10 -- AusPost's real, confirmed hard limit per request.
    for (let i = 0; i < visibleRows.length; i += 10) {
      const batch = visibleRows.slice(i, i + 10);
      try {
        const { data, error: invokeError } = await supabase.functions.invoke('cin7-proxy', {
          body: { action: 'track_auspost_items', auspostTrackingIds: batch.map((r) => r.trackingNumber) },
        });
        if (invokeError) throw invokeError;
        if (!data.success) throw new Error(data.error);

        const newResults = {};
        (data.result?.tracking_results || []).forEach((tr) => {
          // Confirmed real: the response shape genuinely varies by
          // product type -- status can sit directly on the result, on
          // trackable_items[], or nested under a separate consignment
          // object. Checking all three rather than assuming one shape.
          const status =
            tr.status ||
            tr.consignment?.status ||
            tr.trackable_items?.[0]?.status ||
            (tr.errors?.length ? `Error: ${tr.errors[0].name}` : 'Unknown');
          newResults[tr.tracking_id] = status;
        });
        setStatusResults((prev) => ({ ...prev, ...newResults }));
      } catch (err) {
        // Mark this batch's rows with the error rather than stopping
        // the whole check -- a later batch might still succeed.
        const failedResults = {};
        batch.forEach((r) => { failedResults[r.trackingNumber] = `Check failed: ${err.message}`; });
        setStatusResults((prev) => ({ ...prev, ...failedResults }));
      }

      // Small gap between batches -- cheap insurance against the
      // 10-calls/minute limit for anything beyond a tiny batch, without
      // meaningfully slowing down a normal-sized check.
      if (i + 10 < visibleRows.length) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    setCheckingStatus(false);
  };

  const statusColor = (status) => {
    if (!status) return 'text-slate-400';
    const s = status.toLowerCase();
    if (s.includes('delivered')) return 'text-emerald-600 font-bold';
    if (s.includes('error') || s.includes('invalid')) return 'text-red-600 font-bold';
    return 'text-slate-700 font-semibold';
  };

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700">Tracking {rows.length ? `(${rows.length})` : ''}</span>
        <div className="flex items-center gap-2">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search order or tracking #"
            className="text-[11px] bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 w-52"
          />
          <button
            onClick={loadRows}
            disabled={loading}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-1.5 px-3 rounded-md cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Loading...' : '🔄 Refresh'}
          </button>
          <button
            onClick={handleCheckStatus}
            disabled={checkingStatus || visibleRows.length === 0}
            className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-1.5 px-3 rounded-md cursor-pointer disabled:opacity-50"
          >
            {checkingStatus ? 'Checking...' : `📍 Check Status (${visibleRows.length})`}
          </button>
        </div>
      </div>

      {error && (
        <div className="m-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-md">
          Couldn't load tracking data: {error}
        </div>
      )}

      {!error && !loading && rows.length === 0 && (
        <div className="p-8 text-center text-xs text-slate-400">
          No tracked shipments yet. They'll appear here automatically once a manifest is booked in Tab 3.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
                <th className="p-3">Order Number</th>
                <th className="p-3">Tracking Number</th>
                <th className="p-3">Booked</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibleRows.map((r) => (
                <tr key={r.trackingNumber} className="hover:bg-slate-50/80">
                  <td className="p-3 font-bold text-slate-900">{r.orderReference}</td>
                  <td className="p-3 font-mono text-slate-600">{r.trackingNumber}</td>
                  <td className="p-3 text-slate-500">{fmtDate(r.bookedAt)}</td>
                  <td className={`p-3 ${statusColor(statusResults[r.trackingNumber])}`}>
                    {statusResults[r.trackingNumber] || 'Not checked'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
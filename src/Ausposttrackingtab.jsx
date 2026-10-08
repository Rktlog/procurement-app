import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Tracking step, shared by the Pantone and Shopify pages. Reads the same
// manifest data as the Saved manifests step (list_auspost_manifests),
// flattened to one row per shipment, since that's where real tracking
// numbers get recorded at booking time.
//
// Status checks go through track_auspost_items in batches of 10 -- AusPost's
// real limits: max 10 tracking IDs per call, and the service is rate-limited
// to 10 calls/minute.
//
// Delivered is a final state, so once AusPost says a parcel is delivered it's
// saved (with the delivery date) in auspost_tracking_status. Saved parcels are
// shown straight away and never sent to AusPost again.

// The response shape genuinely varies by product type: events can sit on the
// result, on trackable_items[], under items[] inside those, or under a
// separate consignment object. Gather them from every place.
function collectEvents(tr) {
  const out = [];
  const add = (arr) => Array.isArray(arr) && out.push(...arr);
  add(tr.events);
  add(tr.consignment?.events);
  (tr.trackable_items || []).forEach((ti) => {
    add(ti.events);
    (ti.items || []).forEach((it) => add(it.events));
  });
  return out;
}

// Only a status that *starts* with "Delivered" counts. "Undelivered",
// "Attempted delivery" or "Out for delivery" must not be saved as final.
const isDelivered = (status) => /^delivered\b/i.test(String(status || '').trim());

// Date of the delivered scan; if AusPost doesn't give one, the day we saw it.
function deliveryDate(tr) {
  const delivered = collectEvents(tr)
    .map((e) => ({ text: String(e.description || e.status || '').trim(), date: e.date || e.event_date || e.timestamp }))
    .filter((e) => /^delivered\b/i.test(e.text) && e.date && !Number.isNaN(new Date(e.date).getTime()))
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  return (delivered ? new Date(delivered.date) : new Date()).toISOString();
}

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function AusPostTrackingTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusResults, setStatusResults] = useState({});
  const [delivered, setDelivered] = useState({}); // tracking number -> delivered_at (saved)
  const [saveWarning, setSaveWarning] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [hideDelivered, setHideDelivered] = useState(false);

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
              customerName: s.customer_name || '—',
              trackingNumber: s.tracking_number,
              orderId: m.order_id,
              bookedAt: m.created_at,
            });
          }
        });
      });
      setRows(flattened);

      // Which of these are already known to be delivered.
      const saved = {};
      const numbers = flattened.map((r) => r.trackingNumber);
      for (let i = 0; i < numbers.length; i += 100) {
        const { data: found, error: lookupError } = await supabase
          .from('auspost_tracking_status')
          .select('tracking_number, delivered_at')
          .in('tracking_number', numbers.slice(i, i + 100));
        if (lookupError) break; // tracking still works without saved statuses
        (found || []).forEach((r) => {
          saved[r.tracking_number] = r.delivered_at;
        });
      }
      setDelivered(saved);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const isSavedDelivered = (trackingNumber) => trackingNumber in delivered;

  const visibleRows = rows.filter((r) => {
    if (hideDelivered && isSavedDelivered(r.trackingNumber)) return false;
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      r.orderReference.toLowerCase().includes(q) ||
      r.trackingNumber.toLowerCase().includes(q) ||
      (r.customerName || '').toLowerCase().includes(q)
    );
  });

  // Delivered parcels are never checked again.
  const rowsToCheck = visibleRows.filter((r) => !isSavedDelivered(r.trackingNumber));
  const deliveredCount = rows.filter((r) => isSavedDelivered(r.trackingNumber)).length;

  const handleCheckStatus = async () => {
    if (rowsToCheck.length === 0) return;
    setCheckingStatus(true);
    setSaveWarning(null);

    // Batches of 10 -- AusPost's hard limit per request.
    for (let i = 0; i < rowsToCheck.length; i += 10) {
      const batch = rowsToCheck.slice(i, i + 10);
      try {
        const { data, error: invokeError } = await supabase.functions.invoke('cin7-proxy', {
          body: { action: 'track_auspost_items', auspostTrackingIds: batch.map((r) => r.trackingNumber) },
        });
        if (invokeError) throw invokeError;
        if (!data.success) throw new Error(data.error);

        const newResults = {};
        const toSave = [];
        (data.result?.tracking_results || []).forEach((tr) => {
          const status =
            tr.status ||
            tr.consignment?.status ||
            tr.trackable_items?.[0]?.status ||
            (tr.errors?.length ? `Error: ${tr.errors[0].name}` : 'Unknown');
          newResults[tr.tracking_id] = status;
          if (isDelivered(status)) {
            toSave.push({ tracking_number: tr.tracking_id, status, delivered_at: deliveryDate(tr) });
          }
        });
        setStatusResults((prev) => ({ ...prev, ...newResults }));

        // Remember delivered parcels so they're not checked again.
        if (toSave.length) {
          const { error: saveError } = await supabase
            .from('auspost_tracking_status')
            .upsert(toSave, { onConflict: 'tracking_number' });
          if (saveError) {
            setSaveWarning(`Delivered parcels couldn't be saved, so they'll be checked again next time: ${saveError.message}`);
          } else {
            setDelivered((prev) => {
              const next = { ...prev };
              toSave.forEach((r) => {
                next[r.tracking_number] = r.delivered_at;
              });
              return next;
            });
          }
        }
      } catch (err) {
        // Mark this batch's rows with the error rather than stopping the whole
        // check -- a later batch might still succeed.
        const failedResults = {};
        batch.forEach((r) => {
          failedResults[r.trackingNumber] = `Check failed: ${err.message}`;
        });
        setStatusResults((prev) => ({ ...prev, ...failedResults }));
      }

      // Small gap between batches, for the 10-calls/minute limit.
      if (i + 10 < rowsToCheck.length) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    setCheckingStatus(false);
  };

  const statusColor = (status) => {
    if (!status) return 'text-slate-400';
    const s = status.toLowerCase();
    if (s.includes('delivered') && !s.includes('undelivered')) return 'text-emerald-600 font-bold';
    if (s.includes('error') || s.includes('invalid')) return 'text-red-600 font-bold';
    return 'text-slate-700 font-semibold';
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700">
          Tracking {rows.length ? `(${rows.length})` : ''}
          {deliveredCount > 0 && (
            <span className="ml-2 font-normal text-slate-500">{deliveredCount} delivered, not checked again</span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
            <input type="checkbox" checked={hideDelivered} onChange={(e) => setHideDelivered(e.target.checked)} />
            Hide delivered
          </label>
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
            disabled={checkingStatus || rowsToCheck.length === 0}
            className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-1.5 px-3 rounded-md cursor-pointer disabled:opacity-50"
          >
            {checkingStatus ? 'Checking...' : `📍 Check Status (${rowsToCheck.length})`}
          </button>
        </div>
      </div>

      {error && (
        <div className="m-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-md">
          Couldn't load tracking data: {error}
        </div>
      )}

      {saveWarning && (
        <div className="m-3 p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] rounded-md">
          {saveWarning}
        </div>
      )}

      {!error && !loading && rows.length === 0 && (
        <div className="p-8 text-center text-xs text-slate-400">
          No tracked shipments yet. They'll appear here automatically once a manifest is booked in the Label &amp;
          manifest step.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
                <th className="p-3">Order Number</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Tracking Number</th>
                <th className="p-3">Booked</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibleRows.map((r) => {
                const savedAt = delivered[r.trackingNumber];
                const status = isSavedDelivered(r.trackingNumber)
                  ? `Delivered${savedAt ? ` ${fmtDate(savedAt)}` : ''}`
                  : statusResults[r.trackingNumber];
                return (
                  <tr key={r.trackingNumber} className="hover:bg-slate-50/80">
                    <td className="p-3 font-bold text-slate-900">{r.orderReference}</td>
                    <td className="p-3 text-slate-700">{r.customerName}</td>
                    <td className="p-3 font-mono text-slate-600">{r.trackingNumber}</td>
                    <td className="p-3 text-slate-500">{fmtDate(r.bookedAt)}</td>
                    <td className={`p-3 ${statusColor(status)}`}>{status || 'Not checked'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
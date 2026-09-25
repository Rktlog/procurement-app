import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Tab 4: Saved Manifests. Purely a read + on-demand-fetch tab -- no
// AusPost "list everything I've booked" endpoint exists, so this reads
// entirely from our own auspost_manifests table (populated automatically
// by create_auspost_order). Label downloads are fetched fresh each time
// via get_auspost_manifest_label, since the PDF is only kept for 48
// hours -- an expired one simply shows as unavailable rather than a
// broken link.
export default function AusPostSavedManifestsTab() {
  const [manifests, setManifests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [downloadingKey, setDownloadingKey] = useState(null);
  const [downloadError, setDownloadError] = useState({});

  useEffect(() => {
    loadManifests();
  }, []);

  const loadManifests = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('cin7-proxy', {
        body: { action: 'list_auspost_manifests' },
      });
      if (invokeError) throw invokeError;
      if (!data.success) throw new Error(data.error);
      setManifests(data.manifests || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleDownloadLabel = async (orderId, shipmentId) => {
    const key = `${orderId}_${shipmentId}`;
    setDownloadingKey(key);
    setDownloadError((prev) => ({ ...prev, [key]: null }));
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('cin7-proxy', {
        body: { action: 'get_auspost_manifest_label', auspostOrderId: orderId, auspostShipmentId: shipmentId },
      });
      if (invokeError) throw invokeError;
      if (!data.success) throw new Error(data.error);
      window.open(data.url, '_blank');
    } catch (err) {
      setDownloadError((prev) => ({ ...prev, [key]: err.message }));
    }
    setDownloadingKey(null);
  };

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const fmtMoney = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700">Saved Manifests {manifests.length ? `(${manifests.length})` : ''}</span>
        <button
          onClick={loadManifests}
          disabled={loading}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-1.5 px-3 rounded-md cursor-pointer disabled:opacity-50"
        >
          {loading ? 'Loading...' : '🔄 Refresh'}
        </button>
      </div>

      {error && (
        <div className="m-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-md">
          Couldn't load manifests: {error}
        </div>
      )}

      {!error && !loading && manifests.length === 0 && (
        <div className="p-8 text-center text-xs text-slate-400">
          No manifests booked yet. They'll appear here automatically once you book one in Tab 3.
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {manifests.map((m) => {
          const isExpanded = expandedOrderId === m.order_id;
          return (
            <div key={m.order_id}>
              <button
                onClick={() => setExpandedOrderId(isExpanded ? null : m.order_id)}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 cursor-pointer flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900">
                    {m.order_id} {m.order_reference ? `· ${m.order_reference}` : ''}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {fmtDate(m.created_at)} · {m.number_of_shipments ?? '—'} shipment(s), {m.number_of_items ?? '—'} item(s)
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-bold text-slate-900">{fmtMoney(m.total_cost)}</span>
                  <span className="text-slate-400 text-xs font-bold">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-y border-slate-200 text-slate-600 font-bold">
                        <th className="p-2">Order Reference</th>
                        <th className="p-2">Shipment ID</th>
                        <th className="p-2 text-center">Label</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(m.shipments || []).map((s) => {
                        const key = `${m.order_id}_${s.shipment_id}`;
                        return (
                          <tr key={s.shipment_id}>
                            <td className="p-2 font-semibold text-slate-800">{s.shipment_reference || '—'}</td>
                            <td className="p-2 font-mono text-slate-500">{s.shipment_id}</td>
                            <td className="p-2 text-center">
                              {s.label_storage_path ? (
                                <>
                                  <button
                                    onClick={() => handleDownloadLabel(m.order_id, s.shipment_id)}
                                    disabled={downloadingKey === key}
                                    className="text-purple-600 hover:text-purple-800 font-bold cursor-pointer disabled:opacity-50"
                                  >
                                    {downloadingKey === key ? '...' : '📄 Download'}
                                  </button>
                                  {downloadError[key] && (
                                    <div className="text-red-600 mt-0.5">{downloadError[key]}</div>
                                  )}
                                </>
                              ) : (
                                <span className="text-slate-400">Expired (48hr limit)</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
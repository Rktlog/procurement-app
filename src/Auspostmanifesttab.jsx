import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import { SENDER_ADDRESS, INTL_PRODUCT_ID, normaliseCountryCode } from './Auspostconstants';

// Tab 3: Create Label & Book Manifest. This is the real, multi-step
// pipeline per queued order: Create Shipment -> Create Label -> Book
// Manifest (all queued shipments together) -> update DEAR. Each step
// only ever moves an entry forward from wherever it currently sits --
// re-running "Create Shipments" after some are already done only
// processes the ones that still need it, so this is safe to click
// again if something partially fails partway through.
export default function AusPostManifestTab({ csvQueue }) {
  // Keyed by order number. Tracks this tab's own multi-step process --
  // deliberately separate from csvQueue (which just defines what's
  // queued) and from checkResults in Tab 2 (validation/pricing, not
  // process state). Cleared on page refresh -- if that's a real
  // problem in practice, Tab 4 (Saved Manifests) is the durable record
  // of anything that actually got booked.
  const [processState, setProcessState] = useState({});
  const [busy, setBusy] = useState(false);
  const [orderReference, setOrderReference] = useState(`Order-${new Date().toISOString().slice(0, 10)}`);

  const getState = (orderNumber) => processState[orderNumber] || {};
  const updateState = (orderNumber, patch) => {
    setProcessState((prev) => ({ ...prev, [orderNumber]: { ...(prev[orderNumber] || {}), ...patch } }));
  };

  const callProxy = async (body) => {
    const { data, error } = await supabase.functions.invoke('cin7-proxy', { body });
    if (error) throw error;
    if (!data.success) {
      const err = new Error(data.error);
      err.raw = data.raw;
      err.isTimeout = data.isTimeout;
      throw err;
    }
    return data;
  };

  // Step 1: Create Shipment. Only processes entries that don't already
  // have a shipment_id -- safe to re-run.
  const handleCreateShipments = async (entries) => {
    setBusy(true);
    for (const entry of entries) {
      const order = entry.order_data;
      const orderNumber = order.OrderNumber || order.orderName;
      if (getState(orderNumber).shipmentId) continue; // already done

      updateState(orderNumber, { stage: 'creating_shipment', error: null });
      try {
        const addr = order.ShippingAddress || order.rawAddress || {};
        const isInternational = entry.service === INTL_PRODUCT_ID;
        const toAddress = {
          name: order.Customer || order.customer || 'Customer',
          lines: [addr.Line1 || '', addr.Line2 || ''].filter(Boolean),
          suburb: addr.City || '',
          state: addr.State || '',
          postcode: addr.Postcode || '',
          phone: order.Phone || order.phone || '',
          email: order.Email || order.email || '',
          ...(isInternational ? { country: normaliseCountryCode(addr.Country) } : {}),
        };

        const data = await callProxy({
          action: 'create_auspost_shipment',
          auspostShipments: [
            {
              shipment_reference: orderNumber,
              from: SENDER_ADDRESS,
              to: toAddress,
              items: [
                {
                  item_reference: orderNumber,
                  product_id: entry.service,
                  length: String(entry.length),
                  width: String(entry.width),
                  height: String(entry.height),
                  weight: String(entry.weight),
                },
              ],
            },
          ],
        });

        const shipment = data.result?.shipments?.[0];
        const trackingNumber = shipment?.items?.[0]?.tracking_details?.article_id || null;
        updateState(orderNumber, {
          stage: 'shipment_created',
          shipmentId: shipment?.shipment_id || null,
          trackingNumber,
          error: null,
        });
      } catch (err) {
        updateState(orderNumber, { stage: 'error', error: `Shipment creation failed: ${err.message}` });
      }
    }
    setBusy(false);
  };

  // Step 2: Create Label. Only processes entries that have a shipment
  // but no label yet.
  const handleCreateLabels = async (entries) => {
    setBusy(true);
    const withShipments = entries.filter((entry) => {
      const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
      const s = getState(orderNumber);
      return s.shipmentId && !s.labelRequestId;
    });

    for (const entry of withShipments) {
      const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
      const s = getState(orderNumber);
      updateState(orderNumber, { stage: 'creating_label', error: null });
      try {
        const isInternational = entry.service === INTL_PRODUCT_ID;
        const data = await callProxy({
          action: 'create_auspost_label',
          auspostShipmentIds: [s.shipmentId],
          labelGroup: isInternational ? 'International' : (entry.service === '3J55' ? 'Express Post' : 'Parcel Post'),
        });
        const label = data.result?.labels?.[0];
        updateState(orderNumber, {
          stage: 'label_created',
          labelRequestId: label?.request_id || null,
          labelUrl: label?.url || null,
          error: null,
        });
      } catch (err) {
        updateState(orderNumber, { stage: 'error', error: `Label creation failed: ${err.message}` });
      }
    }
    setBusy(false);
  };

  // Step 3: Book Manifest. One single order covering every entry that's
  // ready (has both a shipment and a label). This is genuinely
  // different from steps 1/2 -- it's one bulk call, not per-entry.
  const handleBookManifest = async (entries) => {
    const readyEntries = entries.filter((entry) => {
      const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
      const s = getState(orderNumber);
      return s.shipmentId && s.labelRequestId && !s.orderId;
    });
    if (readyEntries.length === 0) return;

    setBusy(true);
    try {
      const shipmentIds = readyEntries.map((entry) => {
        const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
        return getState(orderNumber).shipmentId;
      });
      const labelRequestIds = {};
      const labelUrls = {};
      readyEntries.forEach((entry) => {
        const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
        const s = getState(orderNumber);
        labelRequestIds[s.shipmentId] = s.labelRequestId;
        labelUrls[s.shipmentId] = s.labelUrl;
      });

      const data = await callProxy({
        action: 'create_auspost_order',
        auspostShipmentIds: shipmentIds,
        auspostOrderReference: orderReference,
        auspostLabelRequestIds: labelRequestIds,
        auspostLabelUrls: labelUrls,
      });

      const orderId = data.result?.order?.order_id || null;
      readyEntries.forEach((entry) => {
        const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
        updateState(orderNumber, { stage: 'booked', orderId, error: null });
      });
    } catch (err) {
      readyEntries.forEach((entry) => {
        const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
        updateState(orderNumber, { stage: 'error', error: `Manifest booking failed: ${err.message}` });
      });
    }
    setBusy(false);
  };

  // Step 4: Update DEAR. Only runs for entries that are genuinely
  // booked -- matches exactly the same fulfill_sale shape already
  // proven in the CSV/Import Tracking flow (Tab 7), so DEAR is updated
  // identically regardless of which path was used to get the tracking
  // number.
  const handleUpdateDear = async (entries) => {
    setBusy(true);
    const readyEntries = entries.filter((entry) => {
      const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
      const s = getState(orderNumber);
      return s.stage === 'booked' && s.trackingNumber && !s.dearUpdated;
    });

    for (const entry of readyEntries) {
      const order = entry.order_data;
      const orderNumber = order.OrderNumber || order.orderName;
      const s = getState(orderNumber);
      updateState(orderNumber, { stage: 'updating_dear', error: null });
      try {
        const { data, error } = await supabase.functions.invoke('cin7-proxy', {
          body: {
            action: 'fulfill_sale',
            saleId: order.ID || order.saleId,
            orderNumber,
            trackingNumber: s.trackingNumber,
            trackingUrl: `https://auspost.com.au/mypost/track/#/details/${s.trackingNumber}`,
            carrier: 'Australia Post',
          },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Unknown error');
        updateState(orderNumber, { stage: 'complete', dearUpdated: true, error: null });
      } catch (err) {
        updateState(orderNumber, { stage: 'error', error: `DEAR update failed: ${err.message}` });
      }
    }
    setBusy(false);
  };

  const stageLabel = (stage) => {
    switch (stage) {
      case 'creating_shipment': return { text: 'Creating shipment...', color: 'text-slate-500' };
      case 'shipment_created': return { text: '✅ Shipment created', color: 'text-emerald-600' };
      case 'creating_label': return { text: 'Creating label...', color: 'text-slate-500' };
      case 'label_created': return { text: '✅ Label ready', color: 'text-emerald-600' };
      case 'booked': return { text: '✅ Manifest booked', color: 'text-emerald-600' };
      case 'updating_dear': return { text: 'Updating DEAR...', color: 'text-slate-500' };
      case 'complete': return { text: '✅ Complete -- DEAR updated', color: 'text-emerald-700 font-bold' };
      case 'error': return { text: '⚠️ Error', color: 'text-red-600 font-bold' };
      default: return { text: 'Not started', color: 'text-slate-400' };
    }
  };

  if (csvQueue.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-400 shadow-xs">
        No orders queued. Select orders from Tab 1 and click "Add Selected to Batch".
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
        <input
          value={orderReference}
          onChange={(e) => setOrderReference(e.target.value)}
          placeholder="Manifest reference"
          className="text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 w-48"
        />
        <button
          onClick={() => handleCreateShipments(csvQueue)}
          disabled={busy}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-3 rounded-md cursor-pointer disabled:opacity-50"
        >
          1️⃣ Create Shipments
        </button>
        <button
          onClick={() => handleCreateLabels(csvQueue)}
          disabled={busy}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-3 rounded-md cursor-pointer disabled:opacity-50"
        >
          2️⃣ Create Labels
        </button>
        <button
          onClick={() => handleBookManifest(csvQueue)}
          disabled={busy}
          className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-2 px-3 rounded-md cursor-pointer disabled:opacity-50"
        >
          3️⃣ Book Manifest
        </button>
        <button
          onClick={() => handleUpdateDear(csvQueue)}
          disabled={busy}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-3 rounded-md cursor-pointer disabled:opacity-50"
        >
          4️⃣ Update DEAR
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
              <th className="p-3">Order Number</th>
              <th className="p-3">Service</th>
              <th className="p-3">Tracking Number</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-center">Label</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {csvQueue.map((entry, idx) => {
              const order = entry.order_data;
              const orderNumber = order.OrderNumber || order.orderName;
              const s = getState(orderNumber);
              const label = stageLabel(s.stage);

              return (
                <tr key={idx} className="hover:bg-slate-50/80">
                  <td className="p-3 font-bold text-slate-900">{orderNumber}</td>
                  <td className="p-3 text-slate-600">{entry.service}</td>
                  <td className="p-3 font-mono text-slate-600">{s.trackingNumber || '—'}</td>
                  <td className="p-3">
                    <span className={label.color} title={s.error || ''}>{label.text}</span>
                  </td>
                  <td className="p-3 text-center">
                    {s.labelUrl && (
                      <a
                        href={s.labelUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-purple-600 hover:text-purple-800 font-bold text-[11px]"
                      >
                        📄 Download
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
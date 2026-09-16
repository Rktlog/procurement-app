import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { INTL_PRODUCT_ID, SENDER_ADDRESS, normaliseCountryCode } from './Auspostconstants';

// Tab 2: Validate & Price. Auto-checks every queued order's address and
// price as soon as it arrives (or changes) -- no manual "Check" click
// needed for the common case, though a per-row re-check button stays
// available for after an edit. "Create Label" (bulk or per-row) hands
// off to the shared handler in Cin7Fulfillment.jsx, since shipment/
// label creation needs to update process state that Tab 3 also reads.
export default function AusPostValidateTab({ csvQueue, onUpdateQueueItem, processState, onCreateShipmentAndLabel }) {
  const [checkResults, setCheckResults] = useState({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [creatingLabels, setCreatingLabels] = useState(false);

  // Tracks which order numbers have already been auto-checked once, so
  // arriving/edited entries get checked without re-checking everything
  // on every render.
  const autoCheckedRef = useRef(new Set());

  const orderNumberOf = (entry) => entry.order_data.OrderNumber || entry.order_data.orderName;

  const handleCheckEntry = async (entry) => {
    const order = entry.order_data;
    const orderNumber = orderNumberOf(entry);
    const addr = order.ShippingAddress || order.rawAddress || {};
    const isInternational = entry.service === INTL_PRODUCT_ID;

    setCheckResults((prev) => ({ ...prev, [orderNumber]: { ...(prev[orderNumber] || {}), checking: true } }));
    const result = { checking: false, addressValid: null, addressSuggestions: [], addressError: null, price: null, priceError: null };

    if (!isInternational) {
      try {
        const { data, error } = await supabase.functions.invoke('cin7-proxy', {
          body: {
            action: 'validate_auspost_suburb',
            auspostSuburb: addr.City || '',
            auspostState: addr.State || '',
            auspostPostcode: addr.Postcode || '',
          },
        });
        if (error) throw error;
        if (!data.success) throw new Error(data.error);
        result.addressValid = !!data.result?.found;
        result.addressSuggestions = data.result?.results || [];
      } catch (err) {
        result.addressError = err.message;
      }
    }

    try {
      const toAddress = isInternational
        ? { suburb: addr.City || '', state: addr.State || '', postcode: addr.Postcode || '', country: normaliseCountryCode(addr.Country) }
        : { suburb: addr.City || '', state: addr.State || '', postcode: addr.Postcode || '' };

      const { data, error } = await supabase.functions.invoke('cin7-proxy', {
        body: {
          action: 'get_auspost_shipment_price',
          auspostShipments: [
            {
              from: SENDER_ADDRESS,
              to: toAddress,
              items: [
                {
                  product_id: entry.service,
                  length: String(entry.length),
                  width: String(entry.width),
                  height: String(entry.height),
                  weight: String(entry.weight),
                },
              ],
            },
          ],
        },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      const summary = data.result?.shipments?.[0]?.shipment_summary;
      result.price = summary?.total_cost ?? null;
    } catch (err) {
      result.priceError = err.message;
    }

    setCheckResults((prev) => ({ ...prev, [orderNumber]: result }));
  };

  const handleCheckAllQueued = async () => {
    if (csvQueue.length === 0) return;
    setCheckingAll(true);
    for (const entry of csvQueue) {
      await handleCheckEntry(entry);
      autoCheckedRef.current.add(orderNumberOf(entry));
    }
    setCheckingAll(false);
  };

  // Auto-check requirement: any order newly present in the queue (or
  // whose service/dims changed enough that its old check is stale)
  // gets validated and priced automatically, without waiting for a
  // manual click. Only the genuinely new/changed ones run -- already-
  // checked entries aren't silently re-checked on every render.
  useEffect(() => {
    const toCheck = csvQueue.filter((entry) => !autoCheckedRef.current.has(orderNumberOf(entry)));
    if (toCheck.length === 0) return;
    (async () => {
      for (const entry of toCheck) {
        autoCheckedRef.current.add(orderNumberOf(entry));
        await handleCheckEntry(entry);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvQueue.length]);

  const toggleSelected = (orderNumber) => {
    setSelectedNumbers((prev) => (prev.includes(orderNumber) ? prev.filter((n) => n !== orderNumber) : [...prev, orderNumber]));
  };
  const selectAll = () => setSelectedNumbers(csvQueue.map(orderNumberOf));
  const unselectAll = () => setSelectedNumbers([]);

  const handleCreateLabelsForSelected = async () => {
    const entries = csvQueue.filter((entry) => selectedNumbers.includes(orderNumberOf(entry)));
    if (entries.length === 0) return;
    setCreatingLabels(true);
    await onCreateShipmentAndLabel(entries);
    setCreatingLabels(false);
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700">{csvQueue.length} order(s) in batch</span>
          <button onClick={selectAll} className="text-[11px] font-bold text-purple-600 hover:text-purple-800 cursor-pointer">Select All</button>
          <button onClick={unselectAll} className="text-[11px] font-bold text-slate-500 hover:text-slate-700 cursor-pointer">Unselect All</button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCheckAllQueued}
            disabled={checkingAll}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {checkingAll ? 'Checking...' : '✅ Re-check All'}
          </button>
          <button
            onClick={handleCreateLabelsForSelected}
            disabled={creatingLabels || selectedNumbers.length === 0}
            className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {creatingLabels ? 'Creating...' : `📦 Create Label (${selectedNumbers.length})`}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
              <th className="p-3 w-8"></th>
              <th className="p-3">Order Number</th>
              <th className="p-3">Address</th>
              <th className="p-3">Service</th>
              <th className="p-3">L × W × H (cm)</th>
              <th className="p-3">Weight (kg)</th>
              <th className="p-3">Address Check</th>
              <th className="p-3">Price</th>
              <th className="p-3 text-center">Label Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {csvQueue.map((entry, idx) => {
              const order = entry.order_data;
              const orderNumber = orderNumberOf(entry);
              const addr = order.ShippingAddress || order.rawAddress || {};
              const check = checkResults[orderNumber];
              const isInternational = entry.service === INTL_PRODUCT_ID;
              const alreadyCreated = !!processState[orderNumber]?.shipmentId;

              return (
                <tr key={idx} className="hover:bg-slate-50/80">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selectedNumbers.includes(orderNumber)}
                      onChange={() => toggleSelected(orderNumber)}
                      disabled={alreadyCreated}
                    />
                  </td>
                  <td className="p-3 font-bold text-slate-900">{orderNumber}</td>
                  <td className="p-3 text-slate-600">
                    {addr.Line1 || ''}, {addr.City || ''} {addr.State || ''} {addr.Postcode || ''}
                  </td>
                  <td className="p-3">
                    <select
                      value={entry.service}
                      onChange={(e) => {
                        onUpdateQueueItem(idx, { service: e.target.value });
                        autoCheckedRef.current.delete(orderNumber); // service changed -- re-check on next pass
                      }}
                      className="text-xs bg-white border border-slate-300 rounded px-2 py-1"
                    >
                      <option value="3D55">Parcel Post (3D55)</option>
                      <option value="3J55">Express Post (3J55)</option>
                      <option value="PTI7">International (PTI7)</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="number" step="0.1" value={entry.length}
                        onChange={(e) => { onUpdateQueueItem(idx, { length: parseFloat(e.target.value) || 0, presetName: 'Custom / Manual' }); autoCheckedRef.current.delete(orderNumber); }}
                        className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                      />
                      <span className="text-slate-400">×</span>
                      <input
                        type="number" step="0.1" value={entry.width}
                        onChange={(e) => { onUpdateQueueItem(idx, { width: parseFloat(e.target.value) || 0, presetName: 'Custom / Manual' }); autoCheckedRef.current.delete(orderNumber); }}
                        className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                      />
                      <span className="text-slate-400">×</span>
                      <input
                        type="number" step="0.1" value={entry.height}
                        onChange={(e) => { onUpdateQueueItem(idx, { height: parseFloat(e.target.value) || 0, presetName: 'Custom / Manual' }); autoCheckedRef.current.delete(orderNumber); }}
                        className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                      />
                    </div>
                  </td>
                  <td className="p-3">
                    <input
                      type="number" step="0.01" value={entry.weight}
                      onChange={(e) => { onUpdateQueueItem(idx, { weight: parseFloat(e.target.value) || 0 }); autoCheckedRef.current.delete(orderNumber); }}
                      className="w-16 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                    />
                  </td>
                  <td className="p-3">
                    {!check && <span className="text-slate-400">Checking...</span>}
                    {check?.checking && <span className="text-slate-400">Checking...</span>}
                    {check && !check.checking && isInternational && <span className="text-slate-400">N/A (international)</span>}
                    {check && !check.checking && !isInternational && check.addressError && (
                      <span className="text-red-600 font-bold" title={check.addressError}>⚠️ Error</span>
                    )}
                    {check && !check.checking && !isInternational && !check.addressError && check.addressValid && (
                      <span className="text-emerald-600 font-bold">✅ Valid</span>
                    )}
                    {check && !check.checking && !isInternational && !check.addressError && check.addressValid === false && (
                      <div>
                        <span className="text-red-600 font-bold">❌ Needs a different address</span>
                        {check.addressSuggestions.length > 0 && (
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Did you mean: {check.addressSuggestions.slice(0, 3).join(', ')}? Edit the order's address in DEAR and re-sync, or adjust below.
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    {check?.priceError && <span className="text-red-600 font-bold" title={check.priceError}>⚠️ Error</span>}
                    {check && !check.checking && check.price != null && (
                      <span className="font-bold text-slate-900">${Number(check.price).toFixed(2)}</span>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    {(() => {
                      const s = processState[orderNumber] || {};
                      if (s.error) {
                        return <span className="text-red-600 font-bold text-[11px]" title={s.error}>⚠️ Failed -- hover for details</span>;
                      }
                      if (s.stage === 'creating_shipment') return <span className="text-slate-400 text-[11px]">Creating shipment...</span>;
                      if (s.stage === 'creating_label') return <span className="text-slate-400 text-[11px]">Creating label...</span>;
                      if (alreadyCreated) return <span className="text-emerald-600 font-bold text-[11px]">✅ Label created</span>;
                      return <span className="text-slate-400 text-[11px]">Not yet</span>;
                    })()}
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
import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import { INTL_PRODUCT_ID, SENDER_ADDRESS, normaliseCountryCode } from './auspostConstants';

// Tab 2: Validate & Price. Receives the queued batch (built in Tab 1)
// and the shared update handler as props -- csvQueue itself stays
// owned by the parent (Cin7Fulfillment.jsx), since Tab 6/7 (CSV export)
// also read and write it. Everything specific to THIS tab -- the
// validation/pricing results, and the two functions that produce them
// -- lives entirely in this file.
export default function AusPostValidateTab({ csvQueue, onUpdateQueueItem }) {
  // Keyed by order number -- results of validating the address and
  // pricing a queued entry against the real AusPost API. Transient
  // (re-checked on demand, not persisted), separate from csvQueue
  // itself since these are verification results, not data the entry
  // owns.
  const [checkResults, setCheckResults] = useState({});
  const [checkingAll, setCheckingAll] = useState(false);

  // Validates the address and prices one queued entry against the real
  // AusPost API -- both real, tested actions (validate_auspost_suburb,
  // get_auspost_shipment_price), not estimates. Address check runs
  // first since a bad address would make a price check meaningless;
  // both results land in checkResults regardless of whether one failed,
  // so the person can see exactly which one needs attention.
  const handleCheckEntry = async (entry) => {
    const order = entry.order_data;
    const orderNumber = order.OrderNumber || order.orderName;
    const addr = order.ShippingAddress || order.rawAddress || {};

    setCheckResults((prev) => ({ ...prev, [orderNumber]: { ...(prev[orderNumber] || {}), checking: true } }));

    const result = { checking: false, addressValid: null, addressSuggestions: [], addressError: null, price: null, priceError: null };
    const isInternational = entry.service === INTL_PRODUCT_ID;

    // Address validation only covers domestic Australian addresses --
    // AusPost's Validate Suburb service has no international variant,
    // so skip it entirely for an international entry rather than send
    // a request that could never meaningfully succeed.
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
    // Sequential, not parallel -- these calls aren't rate-limited as
    // tightly as Track Items, but there's no real need to burst them
    // all at once either, and sequential keeps any error message easy
    // to attribute to the right order if something fails partway
    // through.
    for (const entry of csvQueue) {
      await handleCheckEntry(entry);
    }
    setCheckingAll(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      {csvQueue.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-400">
          No orders queued. Select orders from Tab 1 and click "Add Selected to Batch".
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">{csvQueue.length} order(s) in batch</span>
            <button
              onClick={handleCheckAllQueued}
              disabled={checkingAll}
              className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {checkingAll ? 'Checking...' : `✅ Validate & Price All (${csvQueue.length})`}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
                  <th className="p-3">Order Number</th>
                  <th className="p-3">Address</th>
                  <th className="p-3">Service</th>
                  <th className="p-3">L × W × H (cm)</th>
                  <th className="p-3">Weight (kg)</th>
                  <th className="p-3">Address Check</th>
                  <th className="p-3">Price</th>
                  <th className="p-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {csvQueue.map((entry, idx) => {
                  const order = entry.order_data;
                  const orderNumber = order.OrderNumber || order.orderName;
                  const addr = order.ShippingAddress || order.rawAddress || {};
                  const check = checkResults[orderNumber];
                  const isInternational = entry.service === INTL_PRODUCT_ID;

                  return (
                    <tr key={idx} className="hover:bg-slate-50/80">
                      <td className="p-3 font-bold text-slate-900">{orderNumber}</td>
                      <td className="p-3 text-slate-600">
                        {addr.Line1 || ''}, {addr.City || ''} {addr.State || ''} {addr.Postcode || ''}
                      </td>
                      <td className="p-3">
                        <select
                          value={entry.service}
                          onChange={(e) => onUpdateQueueItem(idx, { service: e.target.value })}
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
                            type="number"
                            step="0.1"
                            value={entry.length}
                            onChange={(e) => onUpdateQueueItem(idx, { length: parseFloat(e.target.value) || 0, presetName: 'Custom / Manual' })}
                            className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                          />
                          <span className="text-slate-400">×</span>
                          <input
                            type="number"
                            step="0.1"
                            value={entry.width}
                            onChange={(e) => onUpdateQueueItem(idx, { width: parseFloat(e.target.value) || 0, presetName: 'Custom / Manual' })}
                            className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                          />
                          <span className="text-slate-400">×</span>
                          <input
                            type="number"
                            step="0.1"
                            value={entry.height}
                            onChange={(e) => onUpdateQueueItem(idx, { height: parseFloat(e.target.value) || 0, presetName: 'Custom / Manual' })}
                            className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                          />
                        </div>
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          step="0.01"
                          value={entry.weight}
                          onChange={(e) => onUpdateQueueItem(idx, { weight: parseFloat(e.target.value) || 0 })}
                          className="w-16 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                        />
                      </td>
                      <td className="p-3">
                        {!check && <span className="text-slate-400">Not checked</span>}
                        {check?.checking && <span className="text-slate-400">Checking...</span>}
                        {check && !check.checking && isInternational && (
                          <span className="text-slate-400">N/A (international)</span>
                        )}
                        {check && !check.checking && !isInternational && check.addressError && (
                          <span className="text-red-600 font-bold" title={check.addressError}>⚠️ Error</span>
                        )}
                        {check && !check.checking && !isInternational && !check.addressError && check.addressValid && (
                          <span className="text-emerald-600 font-bold">✅ Valid</span>
                        )}
                        {check && !check.checking && !isInternational && !check.addressError && check.addressValid === false && (
                          <div>
                            <span className="text-red-600 font-bold">❌ Not found</span>
                            {check.addressSuggestions.length > 0 && (
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                Did you mean: {check.addressSuggestions.slice(0, 3).join(', ')}?
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
                        <button
                          onClick={() => handleCheckEntry(entry)}
                          disabled={check?.checking}
                          className="text-purple-600 hover:text-purple-800 font-bold text-[11px] cursor-pointer disabled:opacity-50"
                        >
                          {check?.checking ? '...' : 'Check'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
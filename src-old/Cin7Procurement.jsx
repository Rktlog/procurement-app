import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Cin7Procurement now does exactly one job: build and submit a draft PO
// to DEAR from whatever items are staged (handed off from Urgent Orders
// or Longterm Orders, or added manually below). It no longer calls
// fetch_procurement_reorder_list or fetch_suppliers -- those looped
// through DEAR live on every mount, which duplicated the scheduled
// sync_inventory_database cron job. Suppliers and cost lookups now read
// straight from the synced products/suppliers/product_supplier tables.
export default function Cin7Procurement({ stagedItems, onRemoveStagedItem, onClearStagedItems }) {
  const [suppliers, setSuppliers] = useState([]);
  const [inactiveTermNames, setInactiveTermNames] = useState(new Set());
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [orderQtys, setOrderQtys] = useState({});
  const [unitPrices, setUnitPrices] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    fetchSuppliers();
    fetchInactivePaymentTerms();
  }, []);

  // Reads DEAR's own payment terms straight from the synced
  // payment_terms table -- kept current automatically by
  // sync_inventory_database, so nobody needs to edit code or a config
  // file when DEAR activates/deactivates a term. If DEAR changes
  // something, the next sync (every 30 min, or the manual button)
  // picks it up with zero manual maintenance.
  const fetchInactivePaymentTerms = async () => {
    const { data, error } = await supabase
      .from('payment_terms')
      .select('name')
      .eq('is_active', false);

    if (!error && data) {
      setInactiveTermNames(new Set(data.map((t) => t.name)));
    }
  };

  // Whenever staged items change, seed order quantities AND unit prices
  // from whatever Urgent/Longterm already looked up (via
  // attachSupplierAndCost) -- without clobbering a value the user has
  // already started editing by hand.
  useEffect(() => {
    setOrderQtys((prev) => {
      const next = { ...prev };
      stagedItems.forEach((item) => {
        if (!(item.SKU in next)) next[item.SKU] = item.Quantity || 1;
      });
      return next;
    });
    setUnitPrices((prev) => {
      const next = { ...prev };
      stagedItems.forEach((item) => {
        if (!(item.SKU in next) && item.UnitPrice) next[item.SKU] = item.UnitPrice;
      });
      return next;
    });
  }, [stagedItems]);

  // Auto-select the supplier when every staged item agrees on one --
  // this is the actual point of carrying SupplierId over from
  // Urgent/Longterm: the person shouldn't have to manually pick a
  // supplier that was already determined by the product's own primary
  // supplier link. If items span more than one supplier, nothing is
  // auto-selected and the warning below tells the person which SKUs
  // belong to a different supplier than the one currently chosen.
  useEffect(() => {
    const withSupplier = stagedItems.filter((i) => i.SupplierId);
    if (withSupplier.length === 0) return;
    const uniqueSupplierIds = new Set(withSupplier.map((i) => i.SupplierId));
    if (uniqueSupplierIds.size === 1 && !selectedSupplierId) {
      setSelectedSupplierId(withSupplier[0].SupplierId);
    }
  }, [stagedItems, selectedSupplierId]);

  // Suppliers come straight from the synced table, including dear_id --
  // the real DEAR supplier ID needed to submit a PO -- and payment_term,
  // so a stale/inactive term can be flagged here rather than only
  // discovered after DEAR rejects the PO.
  const fetchSuppliers = async () => {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id, dear_id, name, currency, payment_term')
      .eq('is_active', true)
      .order('name');

    if (!error && data) {
      const withDearId = data.filter((s) => !!s.dear_id);
      setSuppliers(withDearId);
    }
  };

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);
  const selectedSupplierHasBadTerm = selectedSupplier && inactiveTermNames.has(selectedSupplier.payment_term);

  // Items staged from a different supplier than the one currently
  // selected -- surfaced as a warning rather than silently included in
  // whatever PO gets submitted (which would attach the wrong price/
  // supplier context to that line).
  const mismatchedItems = stagedItems.filter(
    (item) => item.SupplierId && selectedSupplierId && item.SupplierId !== selectedSupplierId
  );

  const handleCreatePurchaseOrder = async () => {
    if (!selectedSupplierId) return setMsg({ type: 'error', text: 'Please select a supplier.' });
    if (stagedItems.length === 0) return setMsg({ type: 'error', text: 'No items staged. Add items from Urgent or Longterm Orders first.' });

    const supplier = suppliers.find((s) => s.id === selectedSupplierId);
    if (!supplier?.dear_id) {
      return setMsg({ type: 'error', text: 'Selected supplier has no linked Cin7 supplier ID yet -- run a sync first.' });
    }

    if (inactiveTermNames.has(supplier.payment_term)) {
      return setMsg({
        type: 'error',
        text: `"${supplier.payment_term}" is not an active payment term in Cin7/DEAR anymore. Open ${supplier.name} in DEAR, pick a currently-active payment term, save it, then run a sync here before trying again.`,
      });
    }

    // Validate quantities client-side rather than letting a bad value
    // silently become 1 in the edge function -- the person should know
    // if what they typed didn't parse, not discover it after the PO
    // already went to DEAR.
    const invalidSkus = stagedItems.filter((item) => {
      const qty = parseInt(orderQtys[item.SKU], 10);
      return !Number.isFinite(qty) || qty <= 0;
    });
    if (invalidSkus.length > 0) {
      return setMsg({
        type: 'error',
        text: `Invalid quantity for: ${invalidSkus.map((i) => i.SKU).join(', ')}. Enter a whole number greater than 0.`,
      });
    }

    setSubmitting(true);
    setMsg(null);

    // Only items matching the currently selected supplier submit --
    // items staged from a different supplier are left in place with a
    // warning shown, rather than silently bundled into a PO under the
    // wrong supplier's price/terms.
    const itemsForThisSupplier = stagedItems.filter(
      (item) => !item.SupplierId || item.SupplierId === selectedSupplierId
    );

    const poLines = itemsForThisSupplier.map((item) => ({
      SKU: item.SKU,
      Name: item.Name,
      Quantity: parseInt(orderQtys[item.SKU], 10),
      UnitPrice: Number(unitPrices[item.SKU]) || 0,
    }));

    try {
      const { data, error } = await supabase.functions.invoke('cin7-proxy', {
        body: {
          action: 'create_purchase_order',
          supplierId: supplier.dear_id,
          lines: poLines,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      setMsg({
        type: 'success',
        text: `Draft Purchase Order created in Cin7! Order Reference: ${data.purchaseOrder?.OrderNumber || 'Draft'}`,
      });

      // Only clear the items that were actually submitted -- items from
      // a mismatched supplier stay staged so the person can switch
      // suppliers and submit those separately.
      itemsForThisSupplier.forEach((item) => onRemoveStagedItem(item.SKU));
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4">
      {/* Top Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs grid grid-cols-1 md:grid-cols-2 gap-3 text-xs items-end">
        <div>
          <label className="block font-bold text-slate-700 mb-1">Target Supplier</label>
          <select
            value={selectedSupplierId}
            onChange={(e) => setSelectedSupplierId(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 h-9"
          >
            {suppliers.length === 0 && <option value="">No synced suppliers found -- run a sync first</option>}
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.currency}){inactiveTermNames.has(s.payment_term) ? ' ⚠️ needs payment term fixed in DEAR' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <button
            onClick={handleCreatePurchaseOrder}
            disabled={submitting || stagedItems.length === 0 || !selectedSupplierId || selectedSupplierHasBadTerm}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-3 rounded-md h-9 cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Creating PO...' : `📦 Send PO to Cin7 (${stagedItems.length - mismatchedItems.length})`}
          </button>
        </div>
      </div>

      {selectedSupplierHasBadTerm && (
        <div className="p-3 text-xs rounded-lg border bg-red-50 text-red-700 border-red-200">
          <strong>{selectedSupplier.name}</strong>'s payment term ("{selectedSupplier.payment_term}") is no longer
          active in Cin7/DEAR. Open this supplier in DEAR, select a currently-active payment term, save it, then
          run a sync here before creating a PO.
        </div>
      )}

      {msg && (
        <div className={`p-3 text-xs rounded-lg border ${
          msg.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          {msg.text}
        </div>
      )}

      {mismatchedItems.length > 0 && (
        <div className="p-3 text-xs rounded-lg border bg-amber-50 text-amber-800 border-amber-200">
          {mismatchedItems.length} item(s) belong to a different supplier than the one selected
          ({mismatchedItems.map((i) => `${i.SKU} → ${i.SupplierName || 'unknown supplier'}`).join(', ')}).
          They won't be included when you submit -- switch the supplier dropdown to send those separately.
        </div>
      )}

      {/* Staged Items Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <h2 className="text-sm font-bold text-slate-900">Staged for Purchase Order</h2>
          {stagedItems.length > 0 && (
            <button
              onClick={onClearStagedItems}
              className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1 rounded border border-slate-300 cursor-pointer"
            >
              Clear All
            </button>
          )}
        </div>

        {stagedItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Nothing staged yet. Select items in Urgent Orders or Longterm Orders and click "Add to Purchase Order" there.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
                  <th className="p-3">SKU</th>
                  <th className="p-3">Product Name</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Supplier (auto-filled)</th>
                  <th className="p-3 text-right">Order Quantity</th>
                  <th className="p-3 text-right">Unit Price</th>
                  <th className="p-3 text-center">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stagedItems.map((item) => {
                  const isMismatched = item.SupplierId && selectedSupplierId && item.SupplierId !== selectedSupplierId;
                  return (
                  <tr key={item.SKU} className={`hover:bg-slate-50 ${isMismatched ? 'bg-amber-50/50' : ''}`}>
                    <td className="p-3 font-bold text-slate-900">{item.SKU}</td>
                    <td className="p-3 text-slate-700">{item.Name}</td>
                    <td className="p-3 text-slate-400 uppercase text-[10px] font-bold">{item.source || 'manual'}</td>
                    <td className="p-3 text-xs">
                      {item.SupplierName ? (
                        <span className={isMismatched ? 'text-amber-700 font-bold' : 'text-slate-600'}>
                          {item.SupplierName}{isMismatched ? ' ⚠️' : ''}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">No supplier on file</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={orderQtys[item.SKU] ?? ''}
                        onChange={(e) => setOrderQtys({ ...orderQtys, [item.SKU]: e.target.value })}
                        className="w-20 text-xs bg-white border border-slate-300 rounded px-2 py-1 text-right font-bold"
                      />
                    </td>
                    <td className="p-3 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={unitPrices[item.SKU] ?? ''}
                        onChange={(e) => setUnitPrices({ ...unitPrices, [item.SKU]: e.target.value })}
                        className="w-24 text-xs bg-white border border-slate-300 rounded px-2 py-1 text-right font-bold"
                      />
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => onRemoveStagedItem(item.SKU)}
                        className="text-slate-400 hover:text-red-600 font-bold cursor-pointer"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
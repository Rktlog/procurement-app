import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { attachSupplierAndCost, getSupplierReadinessBySku, SupplierReadinessBadge } from './Procurementlookup';

export default function UrgentSalesShortage({ onAddToPO }) {
  const [shortages, setShortages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBrand, setSelectedBrand] = useState('ALL');
  const [selectedSupplier, setSelectedSupplier] = useState('ALL');
  const [selectedSkus, setSelectedSkus] = useState(new Set());
  const [addingToPO, setAddingToPO] = useState(false);
  const [supplierReadiness, setSupplierReadiness] = useState(new Map());

  const fetchShortages = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_urgent_purchases');
    if (!error) {
      setShortages(data || []);
      // Auto-select all items by default
      setSelectedSkus(new Set((data || []).map(item => item.sku)));

      const readiness = await getSupplierReadinessBySku((data || []).map((i) => i.sku));
      setSupplierReadiness(readiness);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchShortages();
  }, []);

  const brands = ['ALL', ...new Set(shortages.map(i => i.brand || 'Unassigned Brand'))];
  const suppliers = ['ALL', ...new Set(shortages.map(i => i.latest_supplier || 'Vendor'))];

  const filteredShortages = shortages.filter(item => {
    const matchBrand = selectedBrand === 'ALL' || (item.brand || 'Unassigned Brand') === selectedBrand;
    const matchSupplier = selectedSupplier === 'ALL' || (item.latest_supplier || 'Vendor') === selectedSupplier;
    return matchBrand && matchSupplier;
  });

  // Checkbox handlers
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedSkus(new Set(filteredShortages.map(i => i.sku)));
    } else {
      setSelectedSkus(new Set());
    }
  };

  const handleToggleItem = (sku) => {
    const updated = new Set(selectedSkus);
    if (updated.has(sku)) {
      updated.delete(sku);
    } else {
      updated.add(sku);
    }
    setSelectedSkus(updated);
  };

  // Escapes a CSV field and neutralises formula injection (a leading
  // =, +, -, or @ would otherwise be evaluated as a formula by Excel/
  // Sheets) -- product names here come from DEAR data, not from us.
  const csvSafe = (val) => {
    let s = val === undefined || val === null ? '' : String(val);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    // Minimal quoting -- only when the field actually needs it (comma,
    // quote, or newline present). Blanket-quoting every field broke
    // AusPost's importer for the shipping CSVs (see Cin7Fulfillment.jsx);
    // applying the same fix here defensively, since DEAR's own bulk
    // import likely has similar expectations around its template.
    const needsQuoting = /[",\n\r]/.test(s);
    if (needsQuoting) s = s.replace(/"/g, '""');
    return needsQuoting ? `"${s}"` : s;
  };

  // CSV Export for DEAR / Cin7 Core Import
  const exportToDearCSV = () => {
    const itemsToExport = filteredShortages.filter(item => selectedSkus.has(item.sku));

    if (itemsToExport.length === 0) {
      alert('Please select at least one urgent item to export.');
      return;
    }

    // Exact headers from DEAR Purchase Order line template
    const headers = ['SKU', 'Name', 'Quantity', 'Price', 'Discount', 'SupplierSKU', 'Comment'];

    const rows = itemsToExport.map(item => {
      const exportQty = item.net_shortage > 0 ? item.net_shortage : item.shortage_qty;

      return [
        csvSafe(item.sku),
        csvSafe(item.name),
        exportQty,
        0,
        0,
        '',
        csvSafe('Urgent Stock Shortage - Approved Sales Orders'),
      ];
    });

    const csvContent = [
      headers.map(csvSafe).join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `DEAR_Urgent_PO_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Hands selected items to the Procurement tab's staged PO list, using
  // the net shortage (accounting for stock already on order) as the
  // suggested order quantity -- same figure shown in the "Export Qty"
  // column, so what gets staged matches what the person can see here.
  const handleAddToPO = async () => {
    const itemsToAdd = filteredShortages
      .filter(item => selectedSkus.has(item.sku))
      .map(item => ({
        SKU: item.sku,
        Name: item.name,
        Quantity: item.net_shortage > 0 ? item.net_shortage : item.shortage_qty,
      }));

    if (itemsToAdd.length === 0) {
      alert('Please select at least one urgent item to add.');
      return;
    }

    setAddingToPO(true);
    const enriched = await attachSupplierAndCost(itemsToAdd);
    setAddingToPO(false);
    onAddToPO(enriched);
  };

  const isAllSelected = filteredShortages.length > 0 && filteredShortages.every(i => selectedSkus.has(i.sku));

  return (
    <div className="bg-white rounded-xl border border-red-200 shadow-sm p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-red-100 pb-4">
        <div>
          <h2 className="text-lg font-bold text-red-900 flex items-center gap-2">
            🚨 Approved Sales Stock Shortages ({filteredShortages.length})
          </h2>
          <p className="text-xs text-red-600">Select short items to send to Procurement or export a DEAR CSV</p>
        </div>

        {/* Filters & Export Action */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-semibold text-gray-600">Brand:</label>
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white focus:ring-2 focus:ring-blue-500"
            >
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-xs font-semibold text-gray-600">Supplier:</label>
            <select
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
              className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white focus:ring-2 focus:ring-blue-500"
            >
              {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <button
            onClick={handleAddToPO}
            disabled={addingToPO}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-lg shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {addingToPO ? 'Looking up suppliers...' : `➕ Add to Purchase Order (${selectedSkus.size})`}
          </button>

          <button
            onClick={exportToDearCSV}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
          >
            📥 Export to DEAR CSV ({selectedSkus.size})
          </button>
        </div>
      </div>

      {/* Select All Controls */}
      {filteredShortages.length > 0 && (
        <div className="flex justify-between items-center bg-gray-50 px-4 py-2 rounded-lg text-xs border border-gray-200">
          <label className="flex items-center gap-2 font-semibold text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={handleSelectAll}
              className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
            />
            Select All ({filteredShortages.length} items)
          </label>
          <span className="text-gray-500 font-medium">{selectedSkus.size} items selected</span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-sm text-gray-500">Checking approved sales against stock...</div>
      ) : filteredShortages.length === 0 ? (
        <div className="text-center py-8 text-sm text-emerald-600 font-medium bg-emerald-50 rounded-lg">
          ✅ No urgent stock shortages match the active filters.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredShortages.map((item) => {
            const isChecked = selectedSkus.has(item.sku);
            return (
              <div 
                key={item.product_id} 
                className={`border rounded-lg p-4 transition-all ${
                  isChecked ? 'bg-red-50/30 border-red-300' : 'bg-white border-gray-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleItem(item.sku)}
                    className="mt-1 rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-3 border-b border-gray-100 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold bg-red-100 text-red-800 px-2 py-0.5 rounded border border-red-300">
                            {item.sku}
                          </span>
                          <h3 className="font-bold text-gray-900 text-sm">{item.name}</h3>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                          <span>Brand: <strong>{item.brand || 'N/A'}</strong> | Supplier: <strong>{item.latest_supplier}</strong></span>
                          <SupplierReadinessBadge readiness={supplierReadiness.get(item.sku)} />
                        </p>
                      </div>

                      <div className="flex gap-3 text-xs text-center flex-wrap">
                        <div className="px-3 py-1.5 bg-gray-100 rounded">
                          <span className="text-gray-500 block">On Hand</span>
                          <strong className="text-gray-800 text-sm">{item.on_hand} {item.uom}</strong>
                        </div>
                        <div className="px-3 py-1.5 bg-amber-100/70 rounded text-amber-900">
                          <span className="block font-medium">Approved Orders</span>
                          <strong className="text-sm">{item.allocated} {item.uom}</strong>
                        </div>
                        <div className="px-3 py-1.5 bg-red-100 rounded text-red-900">
                          <span className="block font-medium">Stock Deficit</span>
                          <strong className="text-sm">-{item.shortage_qty} {item.uom}</strong>
                        </div>
                        <div className="px-3 py-1.5 bg-emerald-100 text-emerald-900 rounded font-bold">
                          <span className="block font-medium text-[10px] uppercase">Export Qty</span>
                          <strong className="text-sm">+{item.net_shortage > 0 ? item.net_shortage : item.shortage_qty} {item.uom}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
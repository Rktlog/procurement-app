import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { attachSupplierAndCost, getSupplierReadinessBySku, SupplierReadinessBadge } from './Procurementlookup';

const DEFAULT_PLANNING_MONTHS = 6;

export default function LongtermOrders({ onAddToPO }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingToPO, setAddingToPO] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchedProduct, setSearchedProduct] = useState(null);
  const [searchingSku, setSearchingSku] = useState(false);
  const [selectedSkus, setSelectedSkus] = useState(new Set());

  // Draft filter/window selections -- what the dropdowns are bound to.
  // These update instantly as the person changes a dropdown, but don't
  // touch the table until "Apply Filters" copies them into the applied
  // state below. With this many controls (brand, supplier, sort, sales
  // window, planning horizon) live-recomputing on every single change
  // was both hard to reason about and a real point of confusion earlier
  // -- one explicit action is clearer than five independent live ones.
  const [draftBrand, setDraftBrand] = useState('ALL');
  const [draftSupplier, setDraftSupplier] = useState('ALL');
  const [draftSortBy, setDraftSortBy] = useState('REORDER_DESC');
  const [draftPlanningMonths, setDraftPlanningMonths] = useState(DEFAULT_PLANNING_MONTHS);
  const [draftSalesWindow, setDraftSalesWindow] = useState(12);

  // Applied state -- what the table actually renders from. Only changes
  // when "Apply Filters" is clicked, or on initial load.
  const [selectedBrand, setSelectedBrand] = useState('ALL');
  const [selectedSupplier, setSelectedSupplier] = useState('ALL');
  const [sortBy, setSortBy] = useState('REORDER_DESC');
  const [planningMonths, setPlanningMonths] = useState(DEFAULT_PLANNING_MONTHS);
  const [salesWindow, setSalesWindow] = useState(12);

  const applyFilters = () => {
    setSelectedBrand(draftBrand);
    setSelectedSupplier(draftSupplier);
    setSortBy(draftSortBy);
    setPlanningMonths(draftPlanningMonths);
    setSalesWindow(draftSalesWindow);
  };

  // Whether each SKU's supplier is actually ready for PO creation right
  // now -- same three checks Cin7Procurement enforces (real DEAR link,
  // payment term on file, that term currently active). Fetched once
  // alongside the list so the color coding is visible immediately, not
  // just discovered after clicking through to Procurement.
  const [supplierReadiness, setSupplierReadiness] = useState(new Map());

  const fetchLongtermItems = async () => {
    setLoading(true);
    // Query the table directly instead of calling get_longterm_purchases()
    // -- that RPC is just a thin "SELECT * FROM product_longterm_summary
    // ORDER BY reorder_qty DESC" wrapper, but its cached return-type
    // definition in PostgREST kept serving the old 18-column shape even
    // after the function was recreated with the new sales_3m/6m/12m
    // columns (confirmed: search worked because it bypasses this RPC
    // entirely and queries sale_lines directly; the bulk list, still
    // going through the RPC, never got the new fields). A direct table
    // select doesn't have this problem -- every other direct table
    // query tonight (procurementLookup.js, etc.) has picked up new
    // columns immediately with no caching issue at all.
    //
    // PostgREST caps a single request at 1000 rows -- if the reorder
    // list genuinely has more than that, this pages through in batches
    // instead of silently truncating (confirmed this was happening:
    // the header showed exactly "1000", the same round number that
    // truncated the products table earlier tonight).
    let allRows = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('product_longterm_summary')
        .select('*')
        // Secondary sort on product_id (the table's real unique key)
        // makes pagination deterministic. Sorting on reorder_qty alone
        // left ties (many rows likely share reorder_qty = 0) with no
        // guaranteed stable order between separate paginated requests --
        // Postgres can order tied rows differently from one query to
        // the next, which duplicated some rows across the page boundary
        // and dropped others, surfacing as React's "two children with
        // the same key" warning once the list grew past 1000 rows.
        .order('reorder_qty', { ascending: false })
        .order('product_id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) break;
      allRows = allRows.concat(data || []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }

    {
      const moving = allRows.filter((item) => item.movement_type !== 'INACTIVE');
      setItems(moving);
      setSelectedSkus(new Set(moving.map(item => item.sku)));

      const readiness = await getSupplierReadinessBySku(moving.map((i) => i.sku));
      setSupplierReadiness(readiness);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLongtermItems();
  }, []);

  const handleSyncSummary = async () => {
    setRefreshing(true);
    const { error } = await supabase.rpc('refresh_longterm_summary');
    if (!error) await fetchLongtermItems();
    setRefreshing(false);
  };

  // Recomputes target stock and reorder quantity for the chosen planning
  // horizon, using the raw monthly_burn_rate and lead_time_stock already
  // returned per row. target_stock = monthly_burn_rate * planningMonths;
  // reorder_qty = target_stock + lead_time_stock - (available + on_order).
  // Available (not on_hand) is used for the actual order-quantity math,
  // consistent with how ProductSearch's forecast treats already-allocated
  // stock as unavailable to cover new demand -- on_hand is still shown as
  // its own "Stock in Hand" column for visibility.
  // Picks the sales-window-specific burn rate if the RPC provided it,
  // otherwise falls back to the single stored monthly_burn_rate --
  // this is the graceful-degradation point mentioned above.
  const effectiveMonthlyBurn = (item, window) => {
    const windowSales = { 3: item.sales_3m, 6: item.sales_6m, 12: item.sales_12m }[window];
    const windowActiveMonths = { 3: item.active_months_3m, 6: item.active_months_6m, 12: item.active_months_12m }[window];

    if (windowSales !== undefined && windowSales !== null) {
      return Number(windowSales) / Math.max(1, Number(windowActiveMonths) || window);
    }
    // Fallback: RPC doesn't return the new columns yet.
    return Number(item.monthly_burn_rate) || 0;
  };

  // The raw total for whichever window is selected -- not just the
  // averaged monthly figure. This is what the "Sales" column and its
  // header label reflect; previously that column was permanently
  // labeled and valued as the 12-month total (sales_last_3m) no matter
  // what the Sales Window dropdown was set to.
  const windowSalesTotal = (item, window) => {
    const windowSales = { 3: item.sales_3m, 6: item.sales_6m, 12: item.sales_12m }[window];
    if (windowSales !== undefined && windowSales !== null) return Number(windowSales);
    // Fallback: RPC doesn't return the new columns yet -- only the true
    // 12-month total is available regardless of what's selected.
    return Number(item.sales_last_3m) || 0;
  };

  const recomputeForHorizon = (item, months, window) => {
    const monthlyBurn = effectiveMonthlyBurn(item, window);
    const leadTimeStock = Number(item.lead_time_stock) || 0;
    const available = Number(item.available) || 0;
    const onOrder = Number(item.on_order) || 0;

    const targetStock = Math.round(monthlyBurn * months);
    const reorderQty = Math.max(0, Math.round(targetStock + leadTimeStock - (available + onOrder)));

    return {
      targetStock,
      reorderQty,
      monthlyBurn: Math.round(monthlyBurn * 100) / 100,
      windowSales: windowSalesTotal(item, window),
    };
  };

  const handleSkuSearch = async (e) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return setSearchedProduct(null);

    setSearchingSku(true);
    try {
      const { data: prodData } = await supabase
        .from('products')
        .select(`id, sku, name, brand, category, uom, inventory(available, on_hand, on_order)`)
        .ilike('sku', query)
        .maybeSingle();

      if (prodData) {
        // Compute real sums for all three windows (3/6/12 months), same
        // shape as the bulk RPC path, so effectiveMonthlyBurn works
        // identically here -- this used to have its own hardcoded
        // 365-day/divide-by-12 calculation completely disconnected
        // from the Sales Window selector, which is why switching the
        // dropdown never changed anything for a searched product even
        // though it worked correctly for the bulk list.
        const { data: salesData } = await supabase
          .from('sale_lines')
          .select('qty, sales!inner(order_date, status)')
          .or(`product_id.eq.${prodData.id},sku.ilike.${prodData.sku}`)
          .gte('sales.order_date', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());

        const rows = salesData || [];
        const sumSince = (days) => {
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          return rows
            .filter((r) => new Date(r.sales?.order_date || 0).getTime() >= cutoff)
            .reduce((acc, r) => acc + (Number(r.qty) || 0), 0);
        };
        const activeMonthsSince = (days) => {
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          const months = new Set(
            rows
              .filter((r) => new Date(r.sales?.order_date || 0).getTime() >= cutoff)
              .map((r) => {
                const d = new Date(r.sales.order_date);
                return `${d.getFullYear()}-${d.getMonth()}`;
              })
          );
          return months.size;
        };

        const sales3m = sumSince(90);
        const sales6m = sumSince(180);
        const sales12m = sumSince(365);

        const inv = Array.isArray(prodData.inventory) ? prodData.inventory[0] : prodData.inventory || {};
        const available = Number(inv.available) || 0;
        const onOrder = Number(inv.on_order) || 0;
        const onHand = Number(inv.on_hand) || 0;

        // Real per-supplier lead time, not a hardcoded 3.0 -- looked up
        // via the product's primary supplier and that supplier's
        // configured override in supplier_settings, same source Settings
        // writes to. Falls back to the 3.0 default only if neither the
        // supplier link nor a custom setting exists.
        let leadTimeMonths = 3.0;
        let supplierName = 'Unassigned Supplier';
        const { data: supplierLink } = await supabase
          .from('product_supplier')
          .select('supplier_id, suppliers(name)')
          .eq('product_id', prodData.id)
          .eq('is_primary', true)
          .maybeSingle();

        if (supplierLink?.supplier_id) {
          supplierName = supplierLink.suppliers?.name || supplierName;
          const { data: settingRow } = await supabase
            .from('supplier_settings')
            .select('lead_time_months')
            .eq('supplier_id', supplierLink.supplier_id)
            .maybeSingle();
          if (settingRow?.lead_time_months) leadTimeMonths = Number(settingRow.lead_time_months);
        }

        // monthly_burn_rate here is the 12-month figure, matching what
        // the bulk list stores in that same field -- the actual
        // per-window number now comes from effectiveMonthlyBurn reading
        // sales_3m/6m/12m below, same as every other row.
        const monthlyRun12 = Number((sales12m / 12.0).toFixed(2));
        const leadTimeStock = Math.round(monthlyRun12 * leadTimeMonths);

        setSearchedProduct({
          product_id: prodData.id,
          sku: prodData.sku,
          name: prodData.name,
          brand: prodData.brand || 'Unassigned Brand',
          latest_supplier: supplierName,
          sales_last_3m: sales12m,
          monthly_burn_rate: monthlyRun12,
          sales_3m: sales3m,
          sales_6m: sales6m,
          sales_12m: sales12m,
          active_months_3m: activeMonthsSince(90),
          active_months_6m: activeMonthsSince(180),
          active_months_12m: activeMonthsSince(365),
          available,
          on_hand: onHand,
          on_order: onOrder,
          lead_time_stock: leadTimeStock,
          movement_type: sales12m > 0 ? 'ACTIVE' : 'INACTIVE',
          uom: prodData.uom || 'ea'
        });
        // Reset selection to just this searched item -- otherwise the
        // "N selected" count and Add-to-PO/Export buttons kept
        // reflecting whatever was selected in the full list before
        // searching, even though only one row is now visible.
        setSelectedSkus(new Set([prodData.sku]));
      } else {
        setSearchedProduct(null);
        alert(`SKU "${query}" not found.`);
      }
    } catch (err) {
      console.error('Error fetching SKU:', err);
    }
    setSearchingSku(false);
  };

  const brands = ['ALL', ...Array.from(new Set(items.map(i => i.brand || 'Unassigned Brand'))).sort()];
  const suppliers = ['ALL', ...Array.from(new Set(items.map(i => i.latest_supplier || 'Default Supplier'))).sort()];

  // A manually searched inactive product is still shown (the search box
  // is an explicit lookup, not the "what should I reorder" list), but
  // the main list keeps dead stock filtered out per fetchLongtermItems.
  const baseItems = searchedProduct ? [searchedProduct] : items;

  const filteredItems = baseItems.filter(item => {
    const matchesBrand = selectedBrand === 'ALL' || (item.brand || 'Unassigned Brand') === selectedBrand;
    const matchesSupplier = selectedSupplier === 'ALL' || (item.latest_supplier || 'Default Supplier') === selectedSupplier;
    const matchesSearch = !searchQuery || item.sku?.toLowerCase().includes(searchQuery.toLowerCase()) || item.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesBrand && matchesSupplier && matchesSearch;
  });

  // Attach the horizon-adjusted target/reorder figures to every row right
  // before sorting/rendering, so every downstream reference (table cells,
  // CSV export, Add-to-PO) uses the same recomputed number.
  const itemsWithForecast = filteredItems.map((item) => ({
    ...item,
    ...recomputeForHorizon(item, planningMonths, salesWindow),
  }));

  const sortedItems = [...itemsWithForecast].sort((a, b) => {
    if (sortBy === 'REORDER_DESC') return (Number(b.reorderQty) || 0) - (Number(a.reorderQty) || 0);
    if (sortBy === 'SALES_DESC') return (Number(b.windowSales) || 0) - (Number(a.windowSales) || 0);
    if (sortBy === 'BURN_DESC') return (Number(b.monthly_burn_rate) || 0) - (Number(a.monthly_burn_rate) || 0);
    if (sortBy === 'AVAILABLE_ASC') return (Number(a.on_hand) || 0) - (Number(b.on_hand) || 0);
    if (sortBy === 'SKU_ASC') return (a.sku || '').localeCompare(b.sku || '');
    return 0;
  });

  const handleSelectAll = (e) => {
    if (e.target.checked) setSelectedSkus(new Set(sortedItems.map(i => i.sku)));
    else setSelectedSkus(new Set());
  };

  const handleToggleItem = (sku) => {
    const updated = new Set(selectedSkus);
    if (updated.has(sku)) updated.delete(sku);
    else updated.add(sku);
    setSelectedSkus(updated);
  };

  const csvSafe = (val) => {
    let s = val === undefined || val === null ? '' : String(val);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    // Minimal quoting -- see Cin7Fulfillment.jsx for the full reasoning
    // (blanket-quoting every field, including headers, broke AusPost's
    // importer; applying the same defensive fix here).
    const needsQuoting = /[",\n\r]/.test(s);
    if (needsQuoting) s = s.replace(/"/g, '""');
    return needsQuoting ? `"${s}"` : s;
  };

  const exportToDearCSV = () => {
    const itemsToExport = sortedItems.filter(item => selectedSkus.has(item.sku));
    if (itemsToExport.length === 0) return alert('Please select at least one item.');

    const headers = ['SKU', 'Name', 'Quantity', 'Price', 'Discount', 'SupplierSKU', 'Comment'];
    const rows = itemsToExport.map(item => [
      csvSafe(item.sku),
      csvSafe(item.name),
      item.reorderQty || 0,
      0, 0, '',
      csvSafe(`${planningMonths}M Sales Projection + Lead Buffer`)
    ]);

    const csvContent = [headers.map(csvSafe).join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `DEAR_Longterm_PO_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Hands selected items to the Procurement tab's staged PO list, using
  // the same horizon-adjusted reorder quantity shown in the table.
  const handleAddToPO = async () => {
    const itemsToAdd = sortedItems
      .filter(item => selectedSkus.has(item.sku))
      .map(item => ({
        SKU: item.sku,
        Name: item.name,
        Quantity: item.reorderQty || 1,
      }));

    if (itemsToAdd.length === 0) {
      alert('Please select at least one item to add.');
      return;
    }

    setAddingToPO(true);
    const enriched = await attachSupplierAndCost(itemsToAdd);
    setAddingToPO(false);
    onAddToPO(enriched);
  };

  const isAllSelected = sortedItems.length > 0 && sortedItems.every(i => selectedSkus.has(i.sku));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
      {/* Header & Controls Bar */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            📦 Long-Term Order Projections ({sortedItems.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Forward demand forecast & supplier lead buffer stock</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <form onSubmit={handleSkuSearch} className="flex gap-1">
            <input
              type="text"
              placeholder="Search SKU..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!e.target.value) {
                  setSearchedProduct(null);
                  // Restore full-list selection when clearing search --
                  // matches fetchLongtermItems' own initial behaviour.
                  setSelectedSkus(new Set(items.map((i) => i.sku)));
                }
              }}
              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white w-32 sm:w-40"
            />
            <button type="submit" disabled={searchingSku} className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-lg font-bold cursor-pointer">
              {searchingSku ? '...' : 'Search'}
            </button>
          </form>

          <div className="flex items-center gap-1">
            <span className="text-[11px] font-bold text-slate-500">Brand:</span>
            <select
              value={draftBrand}
              onChange={(e) => setDraftBrand(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
            >
              {brands.map(b => (
                <option key={b} value={b}>
                  {b === 'ALL' ? 'All Brands' : b}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[11px] font-bold text-slate-500">Supplier:</span>
            <select
              value={draftSupplier}
              onChange={(e) => setDraftSupplier(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
            >
              {suppliers.map(s => (
                <option key={s} value={s}>
                  {s === 'ALL' ? 'All Suppliers' : s}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[11px] font-bold text-slate-500">Sort By:</span>
            <select
              value={draftSortBy}
              onChange={(e) => setDraftSortBy(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
            >
              <option value="REORDER_DESC">Highest Reorder Qty</option>
              <option value="SALES_DESC">{draftSalesWindow}M Sales (Highest)</option>
              <option value="BURN_DESC">Monthly Run (Highest)</option>
              <option value="AVAILABLE_ASC">Stock in Hand (Lowest)</option>
              <option value="SKU_ASC">SKU (A-Z)</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[11px] font-bold text-slate-500">Sales Window:</span>
            <select
              value={draftSalesWindow}
              onChange={(e) => setDraftSalesWindow(Number(e.target.value))}
              className="px-2.5 py-1.5 bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 font-bold"
              title="How far back to average sales from, for the Avg Monthly Sales / reorder calculation"
            >
              <option value={3}>Last 3 Months</option>
              <option value={6}>Last 6 Months</option>
              <option value={12}>Last 12 Months (Default)</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[11px] font-bold text-slate-500">Planning For:</span>
            <select
              value={draftPlanningMonths}
              onChange={(e) => setDraftPlanningMonths(Number(e.target.value))}
              className="px-2.5 py-1.5 bg-blue-50 border border-blue-300 text-blue-900 text-xs rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 font-bold"
            >
              {[3, 6, 9, 12].map(m => (
                <option key={m} value={m}>{m} Months{m === DEFAULT_PLANNING_MONTHS ? ' (Default)' : ''}</option>
              ))}
            </select>
          </div>

          <button
            onClick={applyFilters}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-1.5 rounded-lg transition-all shadow-2xs cursor-pointer"
          >
            🔍 Apply Filters
          </button>

          <button
            onClick={handleSyncSummary}
            disabled={refreshing}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs px-3 py-1.5 rounded-lg font-bold border border-slate-300 transition-colors cursor-pointer"
          >
            {refreshing ? 'Syncing...' : '🔄 Sync'}
          </button>

          <button
            onClick={handleAddToPO}
            disabled={addingToPO}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all shadow-2xs cursor-pointer disabled:opacity-50"
          >
            {addingToPO ? 'Looking up suppliers...' : `➕ Add to PO (${selectedSkus.size})`}
          </button>

          <button
            onClick={exportToDearCSV}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all shadow-2xs cursor-pointer"
          >
            📥 Export CSV ({selectedSkus.size})
          </button>
        </div>
      </div>

      {/* Select All Ribbon */}
      {sortedItems.length > 0 && (
        <div className="flex justify-between items-center bg-slate-50 px-3.5 py-2 rounded-xl text-xs border border-slate-200">
          <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={handleSelectAll}
              className="rounded text-blue-600 border-slate-300 w-4 h-4 cursor-pointer"
            />
            Select All ({sortedItems.length} items)
          </label>
          <span className="text-slate-500 font-medium">{selectedSkus.size} selected</span>
        </div>
      )}

      {/* Main Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-xs font-medium">Loading inventory projections...</div>
      ) : sortedItems.length === 0 ? (
        <div className="text-center py-8 text-xs text-slate-500 bg-slate-50 rounded-xl">No matching items found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                <th className="p-3 w-8"></th>
                <th className="p-3">Status</th>
                <th className="p-3">SKU / Item</th>
                <th className="p-3">Brand / Vendor</th>
                <th className="p-3 text-center">Stock in Hand</th>
                <th className="p-3 text-center">Avg Monthly Sales</th>
                <th className="p-3 text-center">{salesWindow}M Sales</th>
                <th className="p-3 text-center">Incoming</th>
                <th className="p-3 text-center">Buffer Stock</th>
                <th className="p-3 text-right">Ordering Next Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedItems.map(item => {
                const isChecked = selectedSkus.has(item.sku);
                const isSurge = item.movement_type === 'SURGE';
                const hasIncoming = Number(item.on_order) > 0;

                return (
                  <tr key={item.product_id} className={`hover:bg-slate-50 transition-colors ${isChecked ? 'bg-blue-50/50' : ''}`}>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleItem(item.sku)}
                        className="rounded text-blue-600 border-slate-300 w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                        isSurge ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}>
                        {isSurge ? '🔥 SURGE' : '⚡ ACTIVE'}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="font-mono font-bold text-slate-900 block">{item.sku}</span>
                      <span className="text-slate-500 block truncate max-w-[160px] text-[11px]">{item.name}</span>
                    </td>
                    <td className="p-3">
                      <span className="font-semibold text-slate-800 block">{item.brand}</span>
                      <span className="text-slate-400 text-[11px] block">{item.latest_supplier}</span>
                      <SupplierReadinessBadge readiness={supplierReadiness.get(item.sku)} />
                    </td>
                    <td className="p-3 text-center font-bold text-slate-700">{item.on_hand} {item.uom}</td>
                    <td className="p-3 text-center font-semibold text-blue-700">{item.monthlyBurn} {item.uom}/mo</td>
                    <td className="p-3 text-center text-slate-600">{item.windowSales} {item.uom}</td>
                    <td className="p-3 text-center">
                      <span className={`font-bold ${hasIncoming ? 'text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200' : 'text-slate-400'}`}>
                        {hasIncoming ? `+${item.on_order}` : '0'} {item.uom}
                      </span>
                    </td>
                    <td className="p-3 text-center text-slate-500 font-medium">{item.lead_time_stock} {item.uom}</td>
                    <td className="p-3 text-right font-extrabold text-emerald-700 text-sm">
                      +{item.reorderQty} {item.uom}
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
}
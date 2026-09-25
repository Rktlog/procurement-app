import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

const DEFAULT_PLANNING_MONTHS = 6;

const formatUnit = (uom) => {
  if (!uom) return 'ea';
  const unit = uom.toLowerCase().trim();
  if (unit.includes('metre') || unit.includes('meter') || unit === 'm') return 'm';
  if (unit.includes('feet') || unit.includes('foot') || unit === 'ft') return 'ft';
  if (unit.includes('each') || unit === 'ea') return 'ea';
  return unit;
};

export default function ProductSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Fixed at the same default Longterm Orders starts with -- no selector
  // here. The horizon control lives in Longterm Orders only; this page
  // always reflects the default view so a SKU looked up here matches
  // what Longterm shows before anyone touches its horizon dropdown.
  const planningMonths = DEFAULT_PLANNING_MONTHS;

  const executeSearch = async (query) => {
    if (!query || !query.trim()) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const { data, error } = await supabase.rpc('search_products', {
        search_term: query.trim(),
        result_limit: 25
      });

      if (error) throw error;
      setProducts(data || []);
    } catch (err) {
      console.error('Fetch Error:', err);
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    executeSearch(searchTerm);
  };

  return (
    <div className="space-y-6">
      {/* Search Bar Card */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/80 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">🔍 Product & Stock Search</h2>
          <p className="text-xs text-slate-500">Search by SKU or item name to view stock levels and sales history</p>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Enter SKU or item description (e.g., 735, 11692)..."
            className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-300/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl text-xs transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Searching...' : 'Search Inventory'}
          </button>
        </form>

        {errorMsg && (
          <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
            <strong>Error:</strong> {errorMsg}
          </div>
        )}
      </div>

      {/* Loading/Empty States */}
      {loading && products.length === 0 && (
        <div className="text-center py-16 text-slate-400 text-xs font-medium">Scanning inventory records...</div>
      )}

      {!loading && products.length === 0 && searchTerm.trim() !== '' && !errorMsg && (
        <div className="bg-white border border-slate-200/80 p-8 text-center rounded-2xl text-slate-500 text-xs">
          No records found matching "<span className="font-semibold text-slate-800">{searchTerm}</span>".
        </div>
      )}

      {/* Results List */}
      <div className="space-y-3">
        {products.map((item) => (
          <CollapsibleProductCard key={item.product_id} product={item} planningMonths={planningMonths} />
        ))}
      </div>
    </div>
  );
}

function CollapsibleProductCard({ product, planningMonths }) {
  const [isOpen, setIsOpen] = useState(false);
  const [leadTimeMonths, setLeadTimeMonths] = useState(null);
  const [leadTimeSupplier, setLeadTimeSupplier] = useState(null);

  const recentPurchases = product.recent_purchases || [];
  const recentSales = product.recent_sales || [];
  const locations = product.locations_breakdown || [];
  const allocatedOrders = product.allocated_orders || [];

  const availableNum = Number(product.available) || 0;
  const onOrderNum = Number(product.on_order) || 0;
  const allocatedNum = Number(product.allocated) || 0;

  const sales12m = Number(product.sales_12m ?? product.sales_last_3m) ||
    recentSales.reduce((acc, row) => acc + (Number(row.qty || row.units_sold || row.quantity) || 0), 0);

  const monthlyRun = Number(product.monthly_burn_rate) || Number((sales12m / 12.0).toFixed(2));
  const unitLabel = formatUnit(product.uom);

  // Real per-supplier lead time, fetched once the card is expanded (not
  // for every collapsed row in the results list, to avoid a query per
  // search result). Same source Settings.jsx writes to, and the same
  // lookup path used in LongtermOrders' manual SKU search -- so a SKU
  // looked up here and the same SKU in Longterm Orders always agree.
  // Falls back to the 3.0-month system default only if no supplier link
  // or no custom override exists.
  useEffect(() => {
    if (!isOpen || leadTimeMonths !== null || !product.product_id) return;

    let cancelled = false;
    (async () => {
      let months = 3.0;
      let supplierName = product.latest_supplier || null;

      const { data: link } = await supabase
        .from('product_supplier')
        .select('supplier_id, suppliers(name)')
        .eq('product_id', product.product_id)
        .eq('is_primary', true)
        .maybeSingle();

      if (link?.supplier_id) {
        supplierName = link.suppliers?.name || supplierName;
        const { data: setting } = await supabase
          .from('supplier_settings')
          .select('lead_time_months')
          .eq('supplier_id', link.supplier_id)
          .maybeSingle();
        if (setting?.lead_time_months) months = Number(setting.lead_time_months);
      }

      if (!cancelled) {
        setLeadTimeMonths(months);
        setLeadTimeSupplier(supplierName);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, leadTimeMonths, product.product_id, product.latest_supplier]);

  // Reorder math waits for the real lead time rather than assuming 3.0
  // months up front -- a card that hasn't been expanded yet just shows
  // its RPC-provided reorder_qty (if any) as a placeholder, and swaps to
  // the accurate horizon-based figure once expanded.
  const leadTimeStock = leadTimeMonths !== null ? Math.round(monthlyRun * leadTimeMonths) : null;
  const targetStock = Math.round(monthlyRun * planningMonths);
  const nextOrderQty = leadTimeStock !== null
    ? Math.max(0, Math.round(targetStock + leadTimeStock - (availableNum + onOrderNum)))
    : (Number(product.reorder_qty) || Math.max(0, Math.round((monthlyRun * 9.0) - (availableNum + onOrderNum))));

  const isLowStock = availableNum <= 5;

  const activePoNumbers = [
    ...new Set(recentPurchases.map((po) => po.po_number || po.number).filter(Boolean))
  ];

  return (
    <div className="bg-white rounded-2xl shadow-2xs border border-slate-200/80 overflow-hidden transition-all hover:border-slate-300">
      {/* Clickable Header */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="p-4 cursor-pointer hover:bg-slate-50/80 flex justify-between items-center select-none transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold bg-slate-100 text-slate-800 px-3 py-1 rounded-lg border border-slate-200">
            {product.sku}
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">{product.name}</h3>
            <p className="text-xs text-slate-500">
              {product.brand || 'No Brand'}
              {(leadTimeSupplier || product.latest_supplier) ? ` • Vendor: ${leadTimeSupplier || product.latest_supplier}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Available</span>
            <span className={`text-sm font-extrabold ${isLowStock ? 'text-amber-600' : 'text-emerald-600'}`}>
              {product.available} {unitLabel}
            </span>
          </div>
          <span className="text-slate-400 text-xs font-bold transition-transform duration-200">
            {isOpen ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {/* Expanded Content Drawer */}
      {isOpen && (
        <div className="border-t border-slate-100 bg-slate-50/50">
          {/* Top Inventory Metrics Grid */}
          <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-100">
            <div className="p-3 bg-white rounded-xl border border-slate-200/80 text-center shadow-2xs">
              <span className="text-xs text-slate-500 font-medium">On Hand</span>
              <p className="text-base font-bold text-slate-800 mt-0.5">{product.on_hand} {unitLabel}</p>
            </div>

            <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200/80 text-center text-amber-900 shadow-2xs">
              <span className="text-xs font-medium">Allocated</span>
              <p className="text-base font-bold mt-0.5">{product.allocated} {unitLabel}</p>
            </div>

            <div className={`p-3 rounded-xl text-center border shadow-2xs ${isLowStock ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
              <span className="text-xs font-medium">Available</span>
              <p className="text-base font-bold mt-0.5">{product.available} {unitLabel}</p>
            </div>

            <div className="p-3 bg-blue-50/60 border border-blue-200/80 rounded-xl text-center text-blue-900 shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-medium">On Order</span>
                <p className="text-base font-bold mt-0.5">{product.on_order} {unitLabel}</p>
              </div>
              {onOrderNum > 0 && activePoNumbers.length > 0 && (
                <div className="mt-2 pt-1.5 border-t border-blue-200/60 text-[11px]">
                  <span className="font-semibold block text-[10px] uppercase tracking-wider text-blue-600 mb-0.5">PO Ref:</span>
                  <div className="flex flex-wrap justify-center gap-1">
                    {activePoNumbers.map((poNum, i) => (
                      <span key={i} className="bg-white border border-blue-200 px-1.5 py-0.5 rounded font-mono font-bold text-[10px] text-blue-800">
                        #{poNum}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Currently-outstanding orders: any order with real
              qty > shipped_qty, regardless of age -- an old backorder
              is still real demand, not something that should silently
              disappear from this list after 90 days. No date filter is
              applied server-side; the label used to claim "last 90
              days" while the query had no such bound, which was
              misleading. */}
          {allocatedOrders.length > 0 && (
            <div className="p-4 bg-amber-50/30 border-b border-slate-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-1">
                📋 Allocated Sales Orders ({allocatedOrders.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                {allocatedOrders.map((ord, idx) => (
                  <div key={idx} className="p-2.5 bg-white rounded-xl border border-amber-200/80 flex justify-between items-center shadow-2xs">
                    <div>
                      <span className="font-mono font-bold text-blue-600 block">#{ord.order_number}</span>
                      <span className="text-slate-500 text-[11px] block truncate max-w-[130px]">{ord.customer_name || 'Customer'}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-amber-700 block">{ord.allocated_qty} {unitLabel}</span>
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                        {ord.status || 'Allocated'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stock Locations */}
          {locations.length > 0 && (
            <div className="p-4 bg-blue-50/30 border-b border-slate-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900 mb-2.5">
                📍 Stock Locations ({locations.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {locations.map((loc, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2.5 bg-white rounded-xl border border-blue-100 shadow-2xs">
                    <span className="font-semibold text-slate-700">{loc.location || 'Main Warehouse'}</span>
                    <span className="text-slate-500">
                      On Hand: <strong className="text-slate-900">{loc.on_hand} {unitLabel}</strong> | Avail: <strong className="text-emerald-600">{loc.available} {unitLabel}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Side-by-Side Sales & Purchase History */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 divide-y md:divide-y-0 md:divide-x divide-slate-200 border-b border-slate-100">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Recent Sales</h4>
              <div className="space-y-2 text-xs">
                {recentSales.map((sale, idx) => (
                  <div key={idx} className="p-2.5 bg-white rounded-xl border border-slate-200/80 flex justify-between items-center shadow-2xs">
                    <div>
                      <p className="font-semibold text-slate-800">Order #{sale.order_number || 'N/A'}</p>
                      <p className="text-slate-400 text-[11px]">{sale.customer_name || 'Customer'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-emerald-600">-{sale.units_sold || sale.quantity || sale.qty || 0} {unitLabel}</p>
                      <p className="text-slate-400 text-[11px]">{sale.sale_date ? new Date(sale.sale_date).toLocaleDateString() : 'N/A'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 md:pt-0 md:pl-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Recent Purchase Orders</h4>
              <div className="space-y-2 text-xs">
                {recentPurchases.map((po, idx) => (
                  <div key={idx} className="p-2.5 bg-white rounded-xl border border-slate-200/80 flex justify-between items-center shadow-2xs">
                    <div>
                      <p className="font-semibold text-slate-800">PO #{po.po_number || 'N/A'}</p>
                      <p className="text-slate-500 text-[11px] font-medium">{po.supplier_name || 'Vendor'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-blue-600">+{po.quantity || po.qty || 0} {unitLabel}</p>
                      <p className="text-slate-400 text-[11px]">{po.order_date ? new Date(po.order_date).toLocaleDateString() : 'N/A'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom Forecast Summary */}
          <div className="p-4 bg-slate-100/60">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
              📊 Sales & Reorder Forecast
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-2xs">
                <span className="text-slate-500 font-medium block">Total Sales</span>
                <span className="text-base font-bold text-slate-900 block mt-0.5">{sales12m} {unitLabel}</span>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-2xs">
                <span className="text-slate-500 font-medium block">Monthly Burn Rate</span>
                <span className="text-base font-bold text-blue-700 block mt-0.5">{monthlyRun} {unitLabel}/mo</span>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-2xs">
                <span className="text-slate-500 font-medium block">
                  Lead Buffer {leadTimeMonths !== null ? `(${leadTimeMonths}mo)` : ''}
                </span>
                <span className="text-base font-bold text-slate-700 block mt-0.5">
                  {leadTimeStock !== null ? `${leadTimeStock} ${unitLabel}` : '...'}
                </span>
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200/80 shadow-2xs">
                <span className="text-emerald-800 font-semibold block">Next Order ({planningMonths}mo plan)</span>
                <span className="text-base font-bold text-emerald-700 block mt-0.5">+{nextOrderQty} {unitLabel}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
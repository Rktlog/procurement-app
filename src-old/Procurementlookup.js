import React from 'react';
import { supabase } from './supabaseClient';

// Chunks a large .in('sku', [...]) lookup into smaller requests so the
// resulting URL never gets long enough to be rejected. Confirmed real
// failure: Longterm Orders now works with ~2,900 SKUs at once, and a
// single unbatched request built a URL Supabase's REST API rejected
// outright with a 400. Same class of bug already fixed server-side in
// cin7-proxy.ts's lookupIdsBySku -- this is the client-side equivalent,
// needed because these two functions call supabase-js directly from
// the browser rather than going through the edge function.
async function chunkedSkuLookup(table, selectCols, skus, chunkSize = 150) {
  const rows = [];
  for (let i = 0; i < skus.length; i += chunkSize) {
    const chunk = skus.slice(i, i + chunkSize);
    const { data } = await supabase.from(table).select(selectCols).in('sku', chunk);
    if (data) rows.push(...data);
  }
  return rows;
}

async function chunkedIdLookup(table, selectCols, ids, idCol, chunkSize = 150) {
  const rows = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data } = await supabase.from(table).select(selectCols).in(idCol, chunk);
    if (data) rows.push(...data);
  }
  return rows;
}

// Shared lookup used by both Urgent Orders and Longterm Orders when
// handing items to Procurement. Kept in one place rather than duplicated
// in each file -- the same mistake as the reorder-quantity formula
// earlier (two copies that could silently disagree). Attaches each
// item's real primary supplier and last known cost from the synced
// product_supplier table, so Procurement opens with the correct
// supplier pre-selected and prices pre-filled instead of defaulting to
// whichever supplier happens to be first in the dropdown.
export async function attachSupplierAndCost(items) {
  if (!items.length) return items;

  const skus = items.map((i) => i.SKU);
  const productRows = await chunkedSkuLookup('products', 'id, sku', skus);

  if (!productRows || productRows.length === 0) {
    return items.map((i) => ({ ...i, SupplierId: null, SupplierName: null, UnitPrice: 0 }));
  }

  const productIdBySku = new Map(productRows.map((p) => [p.sku, p.id]));
  const productIds = productRows.map((p) => p.id);

  const linkRows = await chunkedIdLookup(
    'product_supplier',
    'product_id, supplier_id, last_cost, suppliers(name, dear_id)',
    productIds,
    'product_id'
  );
  const linkByProductId = new Map(linkRows.filter((l) => l.product_id).map((l) => [l.product_id, l]));

  return items.map((item) => {
    const productId = productIdBySku.get(item.SKU);
    const link = productId ? linkByProductId.get(productId) : null;

    return {
      ...item,
      SupplierId: link?.supplier_id || null,
      SupplierName: link?.suppliers?.name || null,
      SupplierDearId: link?.suppliers?.dear_id || null,
      UnitPrice: link?.last_cost !== null && link?.last_cost !== undefined ? Number(link.last_cost) : 0,
    };
  });
}

// Checks whether each SKU's primary supplier is actually ready for PO
// creation right now -- the same three things Cin7Procurement checks
// before letting a PO submit: a real DEAR link (dear_id), a payment
// term on file, and that term being currently active in DEAR (not
// stale, per payment_terms). Returns a map keyed by SKU so Longterm/
// Urgent Orders can color-code the supplier column without duplicating
// the readiness rules -- if what counts as "ready" ever changes, this
// is the one place to update it, same reasoning as attachSupplierAndCost.
//
// Status values: 'ready', 'inactive_term', 'missing_data', 'no_link'
export async function getSupplierReadinessBySku(skus) {
  const result = new Map();
  if (!skus.length) return result;

  const productRows = await chunkedSkuLookup('products', 'id, sku', skus);

  if (!productRows || productRows.length === 0) {
    skus.forEach((sku) => result.set(sku, { status: 'no_link', supplierName: null }));
    return result;
  }

  const productIdBySku = new Map(productRows.map((p) => [p.sku, p.id]));
  const productIds = productRows.map((p) => p.id);

  const linkRows = await chunkedIdLookup(
    'product_supplier',
    'product_id, suppliers(name, dear_id, payment_term, tax_rule)',
    productIds,
    'product_id'
  );
  const linkByProductId = new Map(linkRows.filter((l) => l.product_id).map((l) => [l.product_id, l]));

  const { data: termRows } = await supabase
    .from('payment_terms')
    .select('name, is_active');
  const activeTermNames = new Set((termRows || []).filter((t) => t.is_active).map((t) => t.name));

  for (const sku of skus) {
    const productId = productIdBySku.get(sku);
    const link = productId ? linkByProductId.get(productId) : null;
    const supplier = link?.suppliers;

    if (!supplier || !supplier.dear_id) {
      result.set(sku, { status: 'no_link', supplierName: supplier?.name || null });
    } else if (!supplier.payment_term || !supplier.tax_rule) {
      result.set(sku, { status: 'missing_data', supplierName: supplier.name });
    } else if (!activeTermNames.has(supplier.payment_term)) {
      result.set(sku, { status: 'inactive_term', supplierName: supplier.name, term: supplier.payment_term });
    } else {
      result.set(sku, { status: 'ready', supplierName: supplier.name });
    }
  }

  return result;
}

// Small colored dot + label for the supplier readiness statuses above.
// Shared so Longterm and Urgent Orders render this identically.
export function SupplierReadinessBadge({ readiness }) {
  if (!readiness) return null;

  const styles = {
    ready: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Ready for PO' },
    inactive_term: { dot: 'bg-red-500', text: 'text-red-700', label: `Term "${readiness.term}" inactive in DEAR` },
    missing_data: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Missing payment term/tax rule' },
    no_link: { dot: 'bg-slate-300', text: 'text-slate-400', label: 'No supplier link synced' },
  };
  const s = styles[readiness.status] || styles.no_link;

  // Plain React.createElement here instead of JSX -- this file is
  // loaded as .js, and Vite's default config only parses JSX syntax in
  // .jsx/.tsx files. Using JSX in a .js file fails to build ("Unexpected
  // JSX expression"). createElement is equivalent, just more verbose.
  return React.createElement(
    'span',
    { className: `inline-flex items-center gap-1 text-[10px] font-bold ${s.text}`, title: s.label },
    React.createElement('span', { className: `w-1.5 h-1.5 rounded-full ${s.dot}` }),
    readiness.status === 'ready' ? 'Ready' : 'Blocked'
  );
}
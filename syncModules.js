import { supabase, fetchDear } from './config.js';

// 1. SYNC PRODUCTS & SUPPLIERS
export async function syncProducts() {
  console.log('🔄 [1/4] Syncing Products & Suppliers...');
  let page = 1;
  let totalProducts = 0;

  while (true) {
    const data = await fetchDear('/product', { page, limit: 1000 });
    const products = data.Products || [];
    if (products.length === 0) break;

    const suppliersMap = new Map();
    products.forEach((p) => {
      if (p.DefaultSupplierID && p.DefaultSupplier) {
        suppliersMap.set(p.DefaultSupplierID, {
          id: p.DefaultSupplierID,
          name: p.DefaultSupplier,
          is_active: true,
          source: 'api',
        });
      }
    });

    if (suppliersMap.size > 0) {
      await supabase
        .from('suppliers')
        .upsert(Array.from(suppliersMap.values()), { onConflict: 'id' });
    }

    const productsPayload = products.map((p) => ({
      id: p.ID,
      sku: p.SKU,
      name: p.Name,
      brand: p.Brand || 'Unassigned',
      category: p.Category || 'General',
      product_type: p.Type || 'Stock',
      uom: p.UOM,
      carton_qty: p.CartonQuantity || 1,
      weight_kg: p.Weight || 0,
      status: p.Status || 'Active',
      is_discontinued: p.Status === 'Deprecated',
      dear_updated_at: p.LastModifiedOn,
      source: 'api',
    }));

    await supabase.from('products').upsert(productsPayload, { onConflict: 'id' });

    const supplierLinks = products
      .filter((p) => p.DefaultSupplierID)
      .map((p) => ({
        product_id: p.ID,
        supplier_id: p.DefaultSupplierID,
        supplier_sku: p.SupplierSKU || p.SKU,
        last_cost: p.AverageCost || p.PriceTier1 || 0,
        is_primary: true,
      }));

    if (supplierLinks.length > 0) {
      await supabase
        .from('product_supplier')
        .upsert(supplierLinks, { onConflict: 'product_id,supplier_id' });
    }

    totalProducts += products.length;
    if (products.length < 1000) break;
    page++;
  }

  console.log(`✅ Synced ${totalProducts} Products.`);
  return totalProducts;
}

// 2. SYNC INVENTORY
export async function syncInventory() {
  console.log('🔄 [2/4] Syncing Inventory per Location...');
  let page = 1;
  let totalRows = 0;

  while (true) {
    const data = await fetchDear('/productavailability', { page, limit: 1000 });
    const availability = data.ProductAvailability || [];
    if (availability.length === 0) break;

    const inventoryPayload = availability
      .filter((item) => item.ID && item.Location)
      .map((item) => ({
        product_id: item.ID,
        location: item.Location,
        on_hand: item.OnHand || 0,
        allocated: item.Allocated || 0,
        as_of: new Date().toISOString(),
      }));

    if (inventoryPayload.length > 0) {
      await supabase
        .from('inventory')
        .upsert(inventoryPayload, { onConflict: 'product_id,location' });
    }

    totalRows += availability.length;
    if (availability.length < 1000) break;
    page++;
  }

  console.log(`✅ Synced ${totalRows} Inventory Location records.`);
  return totalRows;
}

// 3. SYNC SALES (INCREMENTAL)
export async function syncSalesIncremental() {
  console.log('🔄 [3/4] Syncing Sales Orders...');
  
  const { data: cursorData } = await supabase.rpc('sync_cursor', { p_entity: 'sales' });
  const sinceDate = cursorData ? cursorData.split('T')[0] : '2025-01-01';

  let page = 1;
  let totalSales = 0;

  while (true) {
    const data = await fetchDear('/saleList', {
      page,
      limit: 100,
      createdSince: sinceDate,
    });
    const sales = data.Sales || [];
    if (sales.length === 0) break;

    for (const saleHeader of sales) {
      if (['DRAFT', 'VOIDED'].includes(saleHeader.Status)) continue;

      const detail = await fetchDear('/sale', { ID: saleHeader.ID });
      if (!detail) continue;

      await supabase.from('sales').upsert({
        id: saleHeader.ID,
        number: saleHeader.OrderNumber,
        customer_id: saleHeader.CustomerID,
        customer_name: saleHeader.Customer,
        order_date: saleHeader.OrderDate ? saleHeader.OrderDate.split('T')[0] : new Date().toISOString().split('T')[0],
        status: saleHeader.Status,
        location: saleHeader.Location,
        dear_updated_at: saleHeader.Updated,
        source: 'api',
      }, { onConflict: 'id' });

      if (detail.Lines && detail.Lines.length > 0) {
        const lines = detail.Lines.map((l) => ({
          id: l.ID,
          sale_id: saleHeader.ID,
          product_id: l.ProductID,
          sku: l.SKU,
          qty: l.Quantity || 0,
          price: l.Price || 0,
          discount: l.Discount || 0,
        }));

        await supabase.from('sale_lines').upsert(lines, { onConflict: 'id' });
      }
      totalSales++;
    }

    if (sales.length < 100) break;
    page++;
  }

  console.log(`✅ Synced ${totalSales} Sales Orders.`);
  return totalSales;
}

// 4. SYNC PURCHASES
export async function syncPurchases() {
  console.log('🔄 [4/4] Syncing Open Purchase Orders...');
  const data = await fetchDear('/purchaseList', { limit: 100 });
  const purchases = data.Purchases || [];

  const activePurchases = purchases.filter(
    (p) => !['DRAFT', 'VOIDED', 'COMPLETED'].includes(p.Status)
  );

  for (const po of activePurchases) {
    const detail = await fetchDear('/purchase', { ID: po.ID });
    if (!detail) continue;

    await supabase.from('purchases').upsert({
      id: po.ID,
      number: po.OrderNumber,
      supplier_id: po.SupplierID,
      supplier_name: po.Supplier,
      order_date: po.OrderDate ? po.OrderDate.split('T')[0] : new Date().toISOString().split('T')[0],
      eta: detail.RequiredByDate ? detail.RequiredByDate.split('T')[0] : null,
      status: po.Status,
      location: po.Location,
      dear_updated_at: po.Updated,
      source: 'api',
    }, { onConflict: 'id' });

    if (detail.Lines && detail.Lines.length > 0) {
      const lines = detail.Lines.map((l) => ({
        id: l.ID,
        purchase_id: po.ID,
        product_id: l.ProductID,
        sku: l.SKU,
        qty: l.Quantity || 0,
        received_qty: l.Received || 0,
        cost: l.Price || 0,
      }));

      await supabase.from('purchase_lines').upsert(lines, { onConflict: 'id' });
    }
  }

  console.log(`✅ Synced ${activePurchases.length} Open Purchase Orders.`);
  return activePurchases.length;
}
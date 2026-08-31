import fs from 'fs';
import csv from 'csv-parser';
import crypto from 'crypto';
import { supabase } from './config.js';

export async function importProductsCsv(filePath) {
  console.log(`\n==================================================`);
  console.log(`🚀 Starting Product Catalog Import from: ${filePath}`);
  console.log(`==================================================`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return;
  }

  const productsMap = new Map();
  const suppliersMap = new Map();
  const productSupplierLinks = [];
  let totalRowsRead = 0;

  const stream = fs.createReadStream(filePath).pipe(csv());

  for await (const row of stream) {
    totalRowsRead++;

    // Map exact DEAR Export Column Names
    const sku = row['ProductCode'];
    if (!sku || !sku.trim()) continue;

    // Generate a deterministic UUID based on ProductCode
    const skuHash = crypto.createHash('md5').update(sku.trim()).digest('hex');
    const productId = `${skuHash.substring(0,8)}-${skuHash.substring(8,12)}-${skuHash.substring(12,16)}-${skuHash.substring(16,20)}-${skuHash.substring(20)}`;

    const productName = row['Name'] || row['Description'] || 'Unnamed Product';
    const brand = row['Brand'] || 'Unassigned';
    const category = row['Category'] || 'General';
    const supplierName = row['LastSuppliedBy'];

    // 1. Master Product Payload
    productsMap.set(productId, {
      id: productId,
      sku: sku.trim(),
      name: productName.trim(),
      brand: brand.trim(),
      category: category.trim(),
      product_type: row['Type'] || 'Stock',
      uom: row['DefaultUnitOfMeasure'] || 'Unit',
      carton_qty: parseFloat(row['CartonQuantity'] || row['CartonInnerQuantity']) || 1,
      weight_kg: parseFloat(row['Weight']) || 0,
      status: row['Status'] || 'Active',
      is_discontinued: row['Status'] === 'Deprecated' || row['Status'] === 'Discontinued',
      source: 'csv'
    });

    // 2. Supplier & Link Payload
    if (supplierName && supplierName.trim().length > 0) {
      const cleanSupplier = supplierName.trim();
      const supplierHash = crypto.createHash('md5').update(cleanSupplier).digest('hex');
      const supplierGuid = `${supplierHash.substring(0,8)}-${supplierHash.substring(8,12)}-${supplierHash.substring(12,16)}-${supplierHash.substring(16,20)}-${supplierHash.substring(20)}`;

      if (!suppliersMap.has(supplierGuid)) {
        suppliersMap.set(supplierGuid, {
          id: supplierGuid,
          name: cleanSupplier,
          is_active: true
        });
      }

      productSupplierLinks.push({
        product_id: productId,
        supplier_id: supplierGuid,
        supplier_sku: row['SupplierProductCode'] || sku.trim(),
        last_cost: parseFloat(row['SupplierFixedPrice'] || row['AverageCost'] || row['PriceTier1']) || 0,
        is_primary: true
      });
    }
  }

  console.log(`📊 Read ${totalRowsRead} rows. Unique Products: ${productsMap.size}, Unique Suppliers: ${suppliersMap.size}`);

  // Upload Suppliers
  if (suppliersMap.size > 0) {
    console.log('📦 Uploading Suppliers to Supabase...');
    const { error: supErr } = await supabase.from('suppliers').upsert(Array.from(suppliersMap.values()), { onConflict: 'id' });
    if (supErr) console.error('Error uploading suppliers:', supErr.message);
  }

  // Upload Products in Batches of 1,000
  console.log('📦 Uploading Products to Supabase...');
  const productsArray = Array.from(productsMap.values());
  for (let i = 0; i < productsArray.length; i += 1000) {
    const chunk = productsArray.slice(i, i + 1000);
    const { error: prodErr } = await supabase.from('products').upsert(chunk, { onConflict: 'id' });
    if (prodErr) console.error('Error uploading products chunk:', prodErr.message);
    else console.log(` -> Uploaded ${Math.min(i + 1000, productsArray.length)} / ${productsArray.length} products...`);
  }

  // Upload Product-Supplier Links in Batches of 1,000
  if (productSupplierLinks.length > 0) {
    console.log('📦 Uploading Product-Supplier Links...');
    for (let i = 0; i < productSupplierLinks.length; i += 1000) {
      const chunk = productSupplierLinks.slice(i, i + 1000);
      const { error: linkErr } = await supabase.from('product_supplier').upsert(chunk, { onConflict: 'product_id,supplier_id' });
      if (linkErr) console.error('Error uploading supplier links:', linkErr.message);
    }
  }

  console.log(`\n🎉 SUCCESS! Uploaded ${productsMap.size} products to Supabase.`);
}

importProductsCsv('./products_export.csv');
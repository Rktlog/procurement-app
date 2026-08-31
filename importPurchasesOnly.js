import fs from 'fs';
import csv from 'csv-parser';
import crypto from 'crypto';
import { supabase } from './config.js';

// Helper to generate deterministic GUIDs
function toGuid(str) {
  const hash = crypto.createHash('md5').update(str).digest('hex');
  return `${hash.substring(0,8)}-${hash.substring(8,12)}-${hash.substring(12,16)}-${hash.substring(16,20)}-${hash.substring(20)}`;
}

// Helper to parse dates (DD/MM/YYYY, YYYY-MM-DD, or ISO strings)
function parseDate(dateStr) {
  if (!dateStr || !dateStr.trim()) return null;
  const clean = dateStr.trim().split(' ')[0];
  if (clean.includes('/')) {
    const parts = clean.split('/');
    if (parts.length === 3) {
      if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
      return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    }
  }
  return clean;
}

async function runPurchasesImport() {
  const filePath = './purchases_export.csv';

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Purchase CSV file not found at ${filePath}`);
    return;
  }

  console.log(`\n==================================================`);
  console.log(`🚀 Starting Purchases CSV Import from: ${filePath}`);
  console.log(`==================================================`);

  const purchasesMap = new Map();
  const purchaseLines = [];
  let totalRows = 0;

  // 1. Fetch Product Master list for SKU matching
  console.log('🔍 Fetching Product Master list from Supabase for SKU matching...');
  const { data: dbProducts, error: prodErr } = await supabase.from('products').select('id, sku');
  if (prodErr) {
    console.error('❌ Error fetching product master:', prodErr.message);
    return;
  }
  
  const productSkuMap = new Map(dbProducts.map(p => [p.sku.toUpperCase(), p.id]));
  console.log(`✅ Loaded ${productSkuMap.size} products from database for cross-referencing.`);

  // 2. Stream and Parse Purchases CSV
  const stream = fs.createReadStream(filePath).pipe(csv());

  for await (const row of stream) {
    totalRows++;

    const poNumber = row['PO #'] || row['Order #'] || row['PO Number'];
    if (!poNumber || !poNumber.trim()) continue;

    const sku = row['SKU'];
    if (!sku || !sku.trim()) continue;

    const orderDate = parseDate(row['PO date'] || row['Order date']) || new Date().toISOString().split('T')[0];
    const etaDate = parseDate(row['Required by']);

    const poGuid = toGuid(`PO_${poNumber.trim()}`);
    const cleanSku = sku.trim().toUpperCase();
    const matchedProductId = productSkuMap.get(cleanSku) || null;

    // Build Purchase Header
    if (!purchasesMap.has(poGuid)) {
      purchasesMap.set(poGuid, {
        id: poGuid,
        number: poNumber.trim(),
        supplier_name: row['Supplier'] || 'CSV Supplier',
        order_date: orderDate,
        eta: etaDate,
        status: row['Status'] || 'AUTHORISED',
        source: 'csv'
      });
    }

    // Build Purchase Line Item
    purchaseLines.push({
      id: toGuid(`POLINE_${poNumber.trim()}_${sku.trim()}_${totalRows}`),
      purchase_id: poGuid,
      product_id: matchedProductId,
      sku: sku.trim(),
      qty: parseFloat(row['Quantity']) || 0,
      received_qty: row['Status'] === 'RECEIVED' ? parseFloat(row['Quantity']) || 0 : 0,
      cost: parseFloat(row['Cost']) || 0
    });
  }

  console.log(`📊 Read ${totalRows} CSV rows. Unique POs: ${purchasesMap.size}, Line Items: ${purchaseLines.length}`);

  // 3. Batch Upload Purchase Headers
  console.log('📦 Uploading Purchase Headers to Supabase...');
  const purchasesArray = Array.from(purchasesMap.values());
  for (let i = 0; i < purchasesArray.length; i += 1000) {
    const chunk = purchasesArray.slice(i, i + 1000);
    const { error } = await supabase.from('purchases').upsert(chunk, { onConflict: 'id' });
    if (error) console.error('Error uploading purchase headers:', error.message);
  }

  // 4. Batch Upload Purchase Lines
  console.log('📦 Uploading Purchase Lines to Supabase...');
  for (let i = 0; i < purchaseLines.length; i += 2000) {
    const chunk = purchaseLines.slice(i, i + 2000);
    const { error } = await supabase.from('purchase_lines').upsert(chunk, { onConflict: 'id' });
    if (error) console.error('Error uploading purchase lines:', error.message);
    else console.log(` -> Uploaded ${Math.min(i + 2000, purchaseLines.length)} / ${purchaseLines.length} purchase lines...`);
  }

  // 5. Refresh Demand Analytics & Incoming Views
  console.log('🔄 Refreshing Materialized Demand Analytics View...');
  await supabase.rpc('refresh_demand');

  console.log(`\n🎉 PURCHASES CSV IMPORT COMPLETED SUCCESSFULLY!\n`);
}

runPurchasesImport();
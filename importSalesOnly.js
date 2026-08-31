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
  if (!dateStr || !dateStr.trim()) return new Date().toISOString().split('T')[0];
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

async function runSalesImport() {
  const filePath = './sales_export.csv';

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Sales CSV file not found at ${filePath}`);
    return;
  }

  console.log(`\n==================================================`);
  console.log(`🚀 Starting Sales CSV Import from: ${filePath}`);
  console.log(`==================================================`);

  const salesMap = new Map();
  const saleLines = [];
  let newestDate = '2020-01-01';
  let totalRows = 0;

  // 1. Fetch Product SKU-to-ID Mapping from Supabase
  console.log('🔍 Fetching Product Master list from Supabase for SKU matching...');
  const { data: dbProducts, error: prodErr } = await supabase.from('products').select('id, sku');
  if (prodErr) {
    console.error('❌ Error fetching product master:', prodErr.message);
    return;
  }
  
  const productSkuMap = new Map(dbProducts.map(p => [p.sku.toUpperCase(), p.id]));
  console.log(`✅ Loaded ${productSkuMap.size} products from database for cross-referencing.`);

  // 2. Stream and Parse Sales CSV
  const stream = fs.createReadStream(filePath).pipe(csv());

  for await (const row of stream) {
    totalRows++;

    const orderNumber = row['Order #'] || row['Order Number'] || row['Sale#'];
    if (!orderNumber || !orderNumber.trim()) continue;

    const sku = row['SKU'];
    if (!sku || !sku.trim()) continue;

    const orderDate = parseDate(row['Order date'] || row['Order Date'] || row['Sale Date']);
    if (orderDate > newestDate) newestDate = orderDate;

    const saleGuid = toGuid(`SALE_${orderNumber.trim()}`);
    const cleanSku = sku.trim().toUpperCase();
    const matchedProductId = productSkuMap.get(cleanSku) || null;

    // Build Sales Header
    if (!salesMap.has(saleGuid)) {
      salesMap.set(saleGuid, {
        id: saleGuid,
        number: orderNumber.trim(),
        customer_name: row['Customer'] || 'CSV Customer',
        order_date: orderDate,
        status: row['Status'] || 'AUTHORISED',
        source: 'csv'
      });
    }

    // Build Sale Line Item
    saleLines.push({
      id: toGuid(`SALELINE_${orderNumber.trim()}_${sku.trim()}_${totalRows}`),
      sale_id: saleGuid,
      product_id: matchedProductId,
      sku: sku.trim(),
      qty: parseFloat(row['Quantity'] || row['Qty']) || 0,
      price: parseFloat(row['Price'] || row['Unit Price'] || row['Sale']) || 0,
      discount: parseFloat(row['Discount']) || 0
    });
  }

  console.log(`📊 Read ${totalRows} CSV rows. Unique Orders: ${salesMap.size}, Line Items: ${saleLines.length}`);

  // 3. Batch Upload Sales Headers
  console.log('📦 Uploading Sales Headers to Supabase...');
  const salesArray = Array.from(salesMap.values());
  for (let i = 0; i < salesArray.length; i += 1000) {
    const chunk = salesArray.slice(i, i + 1000);
    const { error } = await supabase.from('sales').upsert(chunk, { onConflict: 'id' });
    if (error) console.error('Error uploading sales headers:', error.message);
  }

  // 4. Batch Upload Sale Lines
  console.log('📦 Uploading Sale Lines to Supabase...');
  for (let i = 0; i < saleLines.length; i += 2000) {
    const chunk = saleLines.slice(i, i + 2000);
    const { error } = await supabase.from('sale_lines').upsert(chunk, { onConflict: 'id' });
    if (error) console.error('Error uploading sale lines:', error.message);
    else console.log(` -> Uploaded ${Math.min(i + 2000, saleLines.length)} / ${saleLines.length} sale lines...`);
  }

  // 5. Seed API Sync Cursor
  console.log(`⏩ Fast-forwarding sync cursor through date: ${newestDate}`);
  await supabase.rpc('seed_sync_cursor', { p_entity: 'sales', p_through: newestDate });

  // 6. Refresh Materialized Demand View
  console.log('🔄 Refreshing Materialized Demand Analytics View...');
  await supabase.rpc('refresh_demand');

  console.log(`\n🎉 SALES CSV IMPORT COMPLETED SUCCESSFULLY! Through date: ${newestDate}\n`);
}

runSalesImport();
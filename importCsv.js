import fs from 'fs';
import csv from 'csv-parser';
import crypto from 'crypto';
import { supabase } from './config.js';

export async function importSalesCsv(filePath) {
  console.log(`🚀 Streaming CSV file: ${filePath}`);
  const salesMap = new Map();
  const saleLines = [];
  let newestDate = '2020-01-01';

  const stream = fs.createReadStream(filePath).pipe(csv());

  for await (const row of stream) {
    const saleNumber = row['Order Number'] || row['Sale#'];
    if (!saleNumber) continue;

    const orderDate = row['Order Date'] ? row['Order Date'].split('T')[0] : null;
    if (orderDate && orderDate > newestDate) newestDate = orderDate;

    if (!salesMap.has(saleNumber)) {
      salesMap.set(saleNumber, {
        id: crypto.randomUUID(),
        number: saleNumber,
        customer_name: row['Customer'] || 'CSV Import',
        order_date: orderDate,
        status: row['Status'] || 'AUTHORISED',
        source: 'csv',
      });
    }

    const saleHeader = salesMap.get(saleNumber);

    saleLines.push({
      id: crypto.randomUUID(),
      sale_id: saleHeader.id,
      sku: row['SKU'],
      qty: parseFloat(row['Quantity']) || 0,
      price: parseFloat(row['Price']) || 0,
      discount: parseFloat(row['Discount']) || 0,
    });
  }

  // Upload Headers
  const salesArray = Array.from(salesMap.values());
  for (let i = 0; i < salesArray.length; i += 1000) {
    await supabase.from('sales').upsert(salesArray.slice(i, i + 1000), { onConflict: 'id' });
  }

  // Upload Line Items
  for (let i = 0; i < saleLines.length; i += 2000) {
    await supabase.from('sale_lines').upsert(saleLines.slice(i, i + 2000), { onConflict: 'id' });
  }

  // Update sync cursor to skip CSV history in future API calls
  await supabase.rpc('seed_sync_cursor', { p_entity: 'sales', p_through: newestDate });
  await supabase.rpc('refresh_demand');

  console.log(`🎉 CSV Import complete through date: ${newestDate}`);
}
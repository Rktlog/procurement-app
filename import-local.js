import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { supabase } from './src/supabaseClient.js';

const filePath = path.resolve('./inventory_export.csv');

async function uploadDirectToInventory() {
  console.log(`Locating file at: ${filePath}...`);

  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: "inventory_export.csv" was not found in your root project directory.`);
    return;
  }

  const fileContent = fs.readFileSync(filePath, 'utf8');

  Papa.parse(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    complete: async (results) => {
      try {
        const rows = results.data;
        console.log(`Parsing ${rows.length} rows...`);

        // Map CSV fields matching your schema requirements
        const mappedRows = rows.map((row) => ({
          sku: row['SKU'] || row['ProductCode'] || row['Product Code'] || '',
          name: row['Name'] || row['ProductName'] || row['Product Name'] || '',
          brand: row['Brand'] || '',
          category: row['Category'] || '',
          location: row['Location'] || row['Warehouse'] || row['Depot'] || 'Main Warehouse',
          on_hand: parseFloat(row['On Hand'] || row['OnHand'] || 0) || 0,
          allocated: parseFloat(row['Allocated'] || 0) || 0,
          available: parseFloat(row['Available'] || 0) || 0,
          on_order: parseFloat(row['On Order'] || row['OnOrder'] || 0) || 0,
        })).filter((r) => r.sku !== '');

        if (mappedRows.length === 0) {
          console.error('No valid rows containing a SKU column were found.');
          return;
        }

        console.log(`Processing ${mappedRows.length} items directly into public.inventory...`);

        let totalNewProducts = 0;
        let totalUpdatedInventory = 0;

        const chunkSize = 500;
        for (let i = 0; i < mappedRows.length; i += chunkSize) {
          const chunk = mappedRows.slice(i, i + chunkSize);
          
          const { data, error } = await supabase.rpc('upsert_dear_inventory', {
            p_data: chunk
          });

          if (error) throw error;

          totalNewProducts += data.new_products || 0;
          totalUpdatedInventory += data.updated_inventory || 0;

          console.log(`Synced batch ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(mappedRows.length / chunkSize)} (${Math.min(i + chunkSize, mappedRows.length)} / ${mappedRows.length} items)...`);
        }

        console.log('\n====================================');
        console.log('SUCCESSFULLY SAVED TO PUBLIC.INVENTORY!');
        console.log(`New Products Created: ${totalNewProducts}`);
        console.log(`Inventory Records Updated: ${totalUpdatedInventory}`);
        console.log('====================================\n');

      } catch (err) {
        console.error('\nImport Failed:', err.message);
      }
    }
  });
}

uploadDirectToInventory();
import express from 'express';
import { supabase } from './config.js';
import {
  syncProducts,
  syncInventory,
  syncSalesIncremental,
  syncPurchases,
} from './syncModules.js';
import { importSalesCsv } from './importCsv.js';

const app = express();
app.use(express.json());

// Master Orchestration Function
async function runFullSync() {
  if (!process.env.DEAR_ACCOUNT_ID) {
    console.log('ℹ️ DEAR API credentials missing. Skipping background sync.');
    return;
  }

  const startTime = new Date();
  console.log(`\n==================================================`);
  console.log(`🚀 Starting Full DEAR Sync Job at ${startTime.toISOString()}`);
  console.log(`==================================================`);

  const { data: runRecord } = await supabase
    .from('sync_runs')
    .insert({ entity: 'DEAR_FULL_SYNC', status: 'running', started_at: startTime.toISOString() })
    .select()
    .single();

  try {
    const prodCount = await syncProducts();
    const invCount = await syncInventory();
    const salesCount = await syncSalesIncremental();
    const poCount = await syncPurchases();

    console.log('🔄 Refreshing Materialized Demand View...');
    await supabase.rpc('refresh_demand');

    if (runRecord) {
      await supabase.from('sync_runs').update({
        status: 'success',
        rows_read: prodCount + invCount + salesCount + poCount,
        finished_at: new Date().toISOString(),
      }).eq('id', runRecord.id);
    }

    console.log('🎉 DEAR Sync Job completed successfully!\n');
  } catch (error) {
    console.error('❌ DEAR Sync Job failed:', error.message);
    if (runRecord) {
      await supabase.from('sync_runs').update({
        status: 'failed',
        error: error.message,
        finished_at: new Date().toISOString(),
      }).eq('id', runRecord.id);
    }
  }
}

// -----------------------------------------------------------------------------
// ENDPOINTS
// -----------------------------------------------------------------------------

app.post('/api/sync', async (req, res) => {
  runFullSync();
  res.json({ message: 'Sync job triggered in background.' });
});

app.post('/api/import-csv', async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath is required' });

  importSalesCsv(filePath);
  res.json({ message: 'CSV backfill job triggered in background.' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n⚡ DEAR Sync Server listening on port ${PORT}`);
  console.log(`🟢 Ready to process CSV imports!\n`);
});
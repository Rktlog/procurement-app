import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

const AUSPOST_CSV_COLUMNS = [
  'Row type', 'Sender account', 'Payer account', 'Recipient contact name',
  'Recipient business name', 'Recipient address line 1', 'Recipient address line 2',
  'Recipient address line 3', 'Recipient suburb', 'Recipient state',
  'Recipient postcode', 'Send tracking email to recipient', 'Recipient email address',
  'Recipient phone number', 'Delivery/special instruction 1', 'Special instruction 2',
  'Special instruction 3', 'Sender reference 1 ', 'Sender reference 2', 'Product id',
  'Authority to leave', 'Safe drop ', 'Quantity', 'Packaging type', 'Weight',
  'Length', 'Width', 'Height', 'Parcel contents', 'Transit cover value',
  'Deliver wine to addressee only', 'Schedule 8 or medicinal cannabis'
];

// AusPost International Parcel Send template -- exact 55 columns, verbatim
// (including trailing spaces on some headers, which the real template has).
// Confirmed against a working implementation already used for this account.
const AUSPOST_INTL_COLUMNS = [
  'Row type', 'Sender account', 'Payer account', 'Sender business name',
  'Sender email address', 'Sender phone number', 'Recipient contact name',
  'Recipient business name', 'Recipient country / region',
  'Recipient address line 1', 'Recipient address line 2', 'Recipient address line 3',
  'Recipient suburb', 'Recipient state', 'Recipient postcode ',
  'Send tracking email to recipient', 'Recipient email address',
  'Recipient phone number', 'Delivery/special instruction 1', 'Special instruction 2',
  'Special instruction 3', 'Sender reference 1 ', 'Sender reference 2', 'Product id',
  'Authority to leave', 'Safe drop ', 'Quantity', 'Packaging type', 'Weight',
  'Length', 'Width', 'Height', 'Parcel contents', 'Transit cover value',
  'Senders customs reference', 'Comments', 'Landed costs payer',
  "Importer's reference number", 'Licence number', 'Certificate number',
  'Invoice number', 'Digital declaration', 'Commercial value', 'Reason for export',
  'Other reason for export', 'Export declaration number', 'Non-delivery preference',
  'Item - Quantity', 'Item - Unit weight', 'Item - Individual unit value (AUD)',
  'Item - Description', 'Item - Origin', 'Item - HS tariff code',
  'Deliver wine to addressee only', 'Schedule 8 or medicinal cannabis',
];

// Fixed per-business settings for international shipments. Same values
// already used in this account's existing working implementation.
const INTL_SENDER_BUSINESS = 'Rocket Logistics';
const INTL_SENDER_EMAIL = 'logistics@rocketlog.com.au';
const INTL_PRODUCT_ID = 'PTI7';
const INTL_REASON_FOR_EXPORT = 'Commercial Sale of Goods (B2B)';
const INTL_ITEM_ORIGIN = 'US';
const INTL_ITEM_DESCRIPTION = 'Pantone Color Guide Book';
const INTL_ITEM_HS_CODE = '9609100919';

const COUNTRY_CODE_MAP = {
  'NEW ZEALAND': 'NZ', 'NZ': 'NZ',
  'AUSTRALIA': 'AU', 'AU': 'AU',
  'UNITED STATES': 'US', 'USA': 'US', 'UNITED STATES OF AMERICA': 'US',
};

// AusPost's international template wants a country CODE, not a full name.
function normaliseCountryCode(rawCountry) {
  const key = (rawCountry || '').trim().toUpperCase();
  if (COUNTRY_CODE_MAP[key]) return COUNTRY_CODE_MAP[key];
  if (!key) return 'NZ'; // default destination for these shipments
  if (key.length === 2) return key; // already looks like a code
  return rawCountry;
}

const DIM_PRESETS = {
  '20 x 25 x 5 (Default)': { length: 20.0, width: 25.0, height: 5.0 },
  '30 x 20 x 15': { length: 30.0, width: 20.0, height: 15.0 },
  '40 x 30 x 20': { length: 40.0, width: 30.0, height: 20.0 },
  '60 x 40 x 30': { length: 60.0, width: 40.0, height: 30.0 },
  'Custom / Manual': null,
};

// Escapes a CSV field: wraps in quotes, doubles any embedded quotes, and
// neutralises formula injection by prefixing a leading apostrophe on any
// value that starts with =, +, -, or @ (Excel/Sheets would otherwise try
// to evaluate it -- a real risk here since customer names/addresses come
// from DEAR sale data, not from us).
function csvSafe(val) {
  let s = val === undefined || val === null ? '' : String(val);

  // Neutralise formula injection first -- a leading =, +, -, or @ would
  // otherwise be evaluated as a formula by Excel/Sheets. This alone
  // doesn't require quoting under CSV rules, so it's separate from the
  // quoting decision below.
  if (/^[=+\-@]/.test(s)) s = "'" + s;

  // Quote only when actually necessary (contains a comma, a quote
  // character, or a newline) -- matching AusPost's own official
  // template, which uses plain unquoted headers and mostly-unquoted
  // data. Blanket-quoting every field (including the header row) was
  // silently breaking AusPost's bulk importer: it doesn't recognise
  // quoted header names as matching its expected column names, so the
  // whole file got rejected even though the data itself was fine. This
  // is "minimal quoting" (RFC 4180's QUOTE_MINIMAL convention), not a
  // loosening of the earlier CSV-injection protection -- that guard
  // above still applies regardless of whether the field ends up quoted.
  const needsQuoting = /[",\n\r]/.test(s);
  if (needsQuoting) s = s.replace(/"/g, '""');
  return needsQuoting ? `"${s}"` : s;
}

export default function Cin7Fulfillment() {
  const [activeTab, setActiveTab] = useState('select');
  const [expandedSaleIds, setExpandedSaleIds] = useState(new Set());
  const [sales, setSales] = useState([]);
  const [selectedSaleIds, setSelectedSaleIds] = useState([]);
  const [csvQueue, setCsvQueue] = useState([]);
  const [selectedExportIndices, setSelectedExportIndices] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [msg, setMsg] = useState(null);

  const [senderAccount, setSenderAccount] = useState('');
  const [payerAccount, setPayerAccount] = useState('');
  const [defaultService, setDefaultService] = useState('3D55');

  const [importResults, setImportResults] = useState([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    // No setInterval here anymore. Freshness is owned by a pg_cron job
    // calling sync_sales_database every 30 minutes server-side -- this
    // component only ever reads shopify_orders_cache. Previously every
    // open tab ran its own 30-minute timer calling the DEAR API loop
    // directly, so two tabs open at once doubled the effective request
    // rate against Cin7's 60/min limit for no benefit.
    fetchQueueFromDb();
    loadCachedSales();
    fetchCompletedHistory();
  }, []);

  useEffect(() => {
    if (activeTab === 'export') {
      setSelectedExportIndices(csvQueue.map((_, idx) => idx));
    }
  }, [activeTab, csvQueue.length]);

  const filterAndSortSales = (rawSales) => {
    const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // No pick/pack re-check here -- the edge function already applies
    // the authoritative check (Fulfilments[].Pick/Pack.Status ===
    // "AUTHORISED") before anything reaches this cache, so every row
    // here is already ready. Re-testing a different field client-side
    // risks silently diverging from that real check again.
    return rawSales
      .filter((sale) => {
        const orderTime = new Date(sale.OrderDate || sale.CreatedDate || 0).getTime();
        return orderTime >= thirtyDaysAgoMs;
      })
      .sort((a, b) => {
        const timeA = new Date(a.OrderDate || a.CreatedDate || 0).getTime();
        const timeB = new Date(b.OrderDate || b.CreatedDate || 0).getTime();
        return timeB - timeA;
      });
  };

  // Pure DB read. No DEAR call, ever, from this function -- the cache
  // row is kept warm by pg_cron (and by the manual sync button below,
  // which writes to the same row through the same edge function action).
  const loadCachedSales = async () => {
    try {
      const { data, error } = await supabase
        .from('shopify_orders_cache')
        .select('orders_data, last_fetched_at')
        .eq('id', 'cin7_unfulfilled_cache')
        .maybeSingle();

      if (!error && data) {
        setSales(filterAndSortSales(data.orders_data || []));
      } else if (!error && !data) {
        // First run ever, nothing synced yet -- prompt for a manual sync
        // rather than silently triggering a live DEAR call on page load.
        setMsg({ type: 'error', text: 'No synced data yet. Click "Sync Pantone Sales" to run the first sync.' });
      }
    } catch (err) {
      setMsg({ type: 'error', text: `Failed to load cached sales: ${err.message}` });
    }
  };

  const saveSalesToCache = async (fetchedSales) => {
    try {
      await supabase.from('shopify_orders_cache').upsert({
        id: 'cin7_unfulfilled_cache',
        orders_data: fetchedSales,
        last_fetched_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to save Cin7 cache:', err);
    }
  };

  const fetchQueueFromDb = async () => {
    const { data, error } = await supabase
      .from('csv_queue')
      .select('*')
      .eq('source', 'pantone')
      .maybeSingle();

    if (!error && data?.queue_data) setCsvQueue(data.queue_data);
    else setCsvQueue([]);
  };

  const saveQueueToDb = async (newQueue) => {
    setCsvQueue(newQueue);
    const { data: userData } = await supabase.auth.getUser();

    await supabase.from('csv_queue').upsert({
      user_id: userData.user?.id,
      source: 'pantone',
      queue_data: newQueue,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, source' });
  };

  // Reads this app's own completion log -- not the shared shipments/
  // orders tables, which are the Shopify side's (orders has shopify_id/
  // fulfillment_order_id columns, and a shipments row requires a
  // matching orders row via foreign key). Pantone orders live in
  // sales/sale_lines, not orders, so writing into shipments was never
  // actually possible for this flow -- which is the real reason
  // "Completed Orders" has always been empty regardless of how many
  // orders were actually shipped.
  const fetchCompletedHistory = async () => {
    setLoadingHistory(true);
    const { data, error } = await supabase
      .from('fulfillment_history')
      .select('*')
      .order('shipped_at', { ascending: false });

    if (!error && data) setCompletedOrders(data);
    setLoadingHistory(false);
  };

  // Manual "Sync" button. Calls the SAME sync action pg_cron calls on its
  // 30-minute schedule -- this guarantees the button and the background
  // job always produce identical results through one code path, instead
  // of the button re-running its own separate DEAR loop.
  const handleManualSync = async () => {
    setLoading(true);
    setMsg(null);
    setSelectedSaleIds([]);
    try {
      const { data, error } = await supabase.functions.invoke('cin7-proxy', {
        body: { action: 'sync_sales_database' },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      await loadCachedSales();
      setMsg({ type: 'success', text: data.message || 'Sync complete.' });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setLoading(false);
  };

  const filteredSales = sales.filter((s) => {
    const term = searchTerm.toLowerCase();
    return (s.OrderNumber || '').toLowerCase().includes(term) || (s.Customer || '').toLowerCase().includes(term);
  });

  const queuedSaleIds = new Set(csvQueue.map((item) => item.order_data?.ID || item.order_data?.saleId).filter(Boolean));

  const handleSelectAllTab1 = () => {
    const unqueuedFiltered = filteredSales.filter((s) => !queuedSaleIds.has(s.ID));
    setSelectedSaleIds(unqueuedFiltered.map((s) => s.ID));
  };

  const handleUnselectAllTab1 = () => setSelectedSaleIds([]);

  const toggleSaleSelectionTab1 = (id) => {
    if (queuedSaleIds.has(id)) return;
    setSelectedSaleIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSaleExpanded = (id) => {
    setExpandedSaleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Once an order is pick/pack approved it's shipping as-is -- the same
  // SKU can legitimately appear on more than one line if DEAR split it
  // across locations, but that's not something anyone needs to act on
  // here. Collapsed view shows one total count; the per-line detail
  // (including any location split) is still there if someone wants to
  // check it, just behind a click instead of always taking up space.
  const totalItemsPacked = (lines = []) =>
    lines.reduce((sum, l) => sum + (Number(l.Quantity) || 0), 0);

  const calculateOrderPackageSpecs = (lines = []) => {
    let totalWeight = 0;
    let maxL = 25.0;
    let maxW = 15.0;
    let sumH = 0;

    lines.forEach((line) => {
      const qty = line.Quantity || 1;
      const w = line.Weight || 0.2;
      totalWeight += qty * w;

      if (line.Length && line.Length > maxL) maxL = line.Length;
      if (line.Width && line.Width > maxW) maxW = line.Width;
      sumH += (line.Height || 8.0) * qty;
    });

    const weight = Math.max(parseFloat(totalWeight.toFixed(2)), 0.1);
    const length = parseFloat(maxL.toFixed(1));
    const width = parseFloat(maxW.toFixed(1));
    const height = parseFloat(Math.min(sumH || 8.0, 100.0).toFixed(1));

    let matchedPreset = 'Custom / Manual';
    Object.entries(DIM_PRESETS).forEach(([pName, pVal]) => {
      if (pVal && pVal.length === length && pVal.width === width && pVal.height === height) {
        matchedPreset = pName;
      }
    });

    return { weight, length, width, height, presetName: matchedPreset };
  };

  const buildQueueEntryForSale = (sale) => {
    const lines = sale.Lines || sale.lines || [];
    const specs = calculateOrderPackageSpecs(lines);

    return {
      order_data: { ...sale },
      // Auto-detected from DEAR's carrier/shipping-method fields when
      // available (see detectRequestedService in cin7-proxy), same
      // fallback pattern Shopify already uses -- falls back to whatever
      // is set in the Default Service dropdown when DEAR has no signal.
      service: sale.DetectedService || defaultService,
      weight: specs.weight,
      length: specs.length,
      width: specs.width,
      height: specs.height,
      presetName: specs.presetName,
    };
  };

  const handleBulkQueueSelected = async () => {
    if (selectedSaleIds.length === 0) return;

    const selectedSales = sales.filter((s) => selectedSaleIds.includes(s.ID));
    const newQueueEntries = selectedSales.map((sale) => buildQueueEntryForSale(sale));

    const updatedQueue = [...csvQueue, ...newQueueEntries];
    await saveQueueToDb(updatedQueue);

    setSelectedSaleIds([]);
    setMsg({ type: 'success', text: `Added ${newQueueEntries.length} Pantone sales to CSV batch.` });
  };

  const handleRemoveFromQueue = async (indexToRemove) => {
    const itemToRemove = csvQueue[indexToRemove];
    if (!itemToRemove) return;

    const updatedQueue = csvQueue.filter((_, idx) => idx !== indexToRemove);
    await saveQueueToDb(updatedQueue);
    setSelectedExportIndices((prev) => prev.filter((i) => i !== indexToRemove));
  };

  const handleClearBatch = async () => {
    if (csvQueue.length === 0) return;
    await saveQueueToDb([]);
    setSelectedExportIndices([]);
    setMsg({ type: 'success', text: 'Batch cleared. All Pantone orders returned to full view in Tab 1.' });
  };

  const handleSelectAllExport = () => setSelectedExportIndices(csvQueue.map((_, idx) => idx));
  const handleUnselectAllExport = () => setSelectedExportIndices([]);

  const toggleExportSelection = (index) => {
    setSelectedExportIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const handleUpdateQueueItem = (index, updatedFields) => {
    const updatedQueue = [...csvQueue];
    updatedQueue[index] = { ...updatedQueue[index], ...updatedFields };
    saveQueueToDb(updatedQueue);
  };

  const handleDimensionDropdownChange = (index, presetName) => {
    const preset = DIM_PRESETS[presetName];
    if (preset) {
      handleUpdateQueueItem(index, {
        length: preset.length,
        width: preset.width,
        height: preset.height,
        presetName: presetName,
      });
    } else {
      handleUpdateQueueItem(index, { presetName: 'Custom / Manual' });
    }
  };

  const downloadSelectedAusPostCsv = () => {
    if (selectedExportIndices.length === 0) return;

    const selectedEntries = csvQueue.filter((_, idx) => selectedExportIndices.includes(idx));
    const rows = [AUSPOST_CSV_COLUMNS.map(csvSafe).join(',')];

    selectedEntries.forEach((entry) => {
      const order = entry.order_data;
      const addr = order.ShippingAddress || order.rawAddress || {};

      const rowMap = {
        'Row type': 'S',
        'Sender account': senderAccount,
        'Payer account': payerAccount || senderAccount,
        'Recipient contact name': order.Customer || order.customer,
        'Recipient address line 1': addr.Line1 || '',
        'Recipient address line 2': addr.Line2 || '',
        'Recipient suburb': addr.City || '',
        'Recipient state': addr.State || '',
        'Recipient postcode': addr.Postcode || '',
        'Send tracking email to recipient': order.Email || order.email ? 'Yes' : 'No',
        'Recipient email address': order.Email || order.email || '',
        'Recipient phone number': order.Phone || order.phone || '',
        'Sender reference 1 ': order.OrderNumber || order.orderName,
        'Product id': entry.service,
        'Quantity': 1,
        'Weight': entry.weight,
        'Length': entry.length,
        'Width': entry.width,
        'Height': entry.height,
        'Parcel contents': ' ',
      };

      // csvSafe on every field: consistent quoting/escaping, and it
      // neutralises formula injection for any value that starts with
      // =, +, -, or @ -- addresses and names here come from customer
      // data via DEAR, not from us, so they can't be trusted as-is.
      // Using `in` rather than `|| ''` so a real 0 (e.g. Weight) isn't
      // swapped for an empty string, which `||` would do since 0 is falsy.
      rows.push(
        AUSPOST_CSV_COLUMNS.map((col) => csvSafe(col in rowMap ? rowMap[col] : '')).join(',')
      );
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `auspost_pantone_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  // International Parcel Send export. Ported from a working, tested
  // implementation for this account -- same column set, same field
  // mapping, same fixed sender/customs defaults. Per-unit customs value
  // is total declared value divided by quantity, not the total itself
  // (AusPost wants the per-item value on the "Item -" columns).
  const downloadSelectedIntlCsv = () => {
    if (selectedExportIndices.length === 0) return;

    const selectedEntries = csvQueue.filter((_, idx) => selectedExportIndices.includes(idx));
    const rows = [AUSPOST_INTL_COLUMNS.map(csvSafe).join(',')];

    selectedEntries.forEach((entry) => {
      const order = entry.order_data;
      const addr = order.ShippingAddress || order.rawAddress || {};
      const unitCount = (order.Lines || order.lines || []).reduce(
        (sum, l) => sum + (Number(l.Quantity) || 0), 0
      ) || 1;

      const totalValue = entry.customsValue;
      let unitValue = '';
      if (totalValue !== undefined && totalValue !== null && totalValue !== '') {
        const tv = Number(totalValue);
        if (!Number.isNaN(tv)) unitValue = unitCount ? Math.round((tv / unitCount) * 100) / 100 : tv;
      }

      const rowMap = {
        'Row type': 's',
        'Sender account': '',
        'Payer account': '',
        'Sender business name': INTL_SENDER_BUSINESS,
        'Sender email address': INTL_SENDER_EMAIL,
        'Sender phone number': '',
        'Recipient contact name': order.Customer || order.customer,
        'Recipient country / region': normaliseCountryCode(addr.Country),
        'Recipient address line 1': addr.Line1 || '',
        'Recipient address line 2': addr.Line2 || '',
        'Recipient suburb': addr.City || '',
        'Recipient state': addr.State || '',
        'Recipient postcode ': addr.Postcode || '',
        'Send tracking email to recipient': order.Email || order.email ? 'Yes' : 'No',
        'Recipient email address': order.Email || order.email || '',
        'Recipient phone number': order.Phone || order.phone || '',
        'Sender reference 1 ': order.OrderNumber || order.orderName,
        'Product id': INTL_PRODUCT_ID,
        'Quantity': 1,
        'Weight': entry.weight,
        'Length': entry.length,
        'Width': entry.width,
        'Height': entry.height,
        'Parcel contents': '',
        'Digital declaration': 'No',
        'Landed costs payer': 'RECEIVER_PAYS',
        'Reason for export': INTL_REASON_FOR_EXPORT,
        'Commercial value': 'yes',
        'Item - Quantity': unitCount,
        'Item - Unit weight': entry.weight,
        'Item - Individual unit value (AUD)': unitValue,
        'Item - Description': INTL_ITEM_DESCRIPTION,
        'Item - Origin': INTL_ITEM_ORIGIN,
        'Item - HS tariff code': INTL_ITEM_HS_CODE,
        'Deliver wine to addressee only': 'No',
        'Schedule 8 or medicinal cannabis': 'No',
      };

      rows.push(
        AUSPOST_INTL_COLUMNS.map((col) => csvSafe(col in rowMap ? rowMap[col] : '')).join(',')
      );
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `auspost_international_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const handleResultsCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const lines = evt.target.result.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length < 2) return setMsg({ type: 'error', text: 'No data rows found in uploaded CSV.' });

      const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
      const refIdx = headers.findIndex((h) => h.toLowerCase().includes('sender reference') || h.toLowerCase().includes('reference'));
      const trackingIdx = headers.findIndex((h) => h.toLowerCase().includes('connote') || h.toLowerCase().includes('tracking number') || h.toLowerCase().includes('article id'));
      const urlIdx = headers.findIndex((h) => h.toLowerCase().includes('tracking url'));

      const parsed = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',').map((c) => c.trim().replace(/"/g, ''));
        const ref = row[refIdx];
        const tracking = row[trackingIdx];
        const url = urlIdx !== -1 && row[urlIdx] ? row[urlIdx] : `https://auspost.com.au/mypost/track/#/details/${tracking}`;

        if (ref && tracking) parsed.push({ ref, tracking, url });
      }

      setImportResults(parsed);
      setMsg({ type: 'success', text: `Extracted tracking numbers for ${parsed.length} Pantone orders.` });
    };
    reader.readAsText(file);
  };

  const handleExecuteCin7Fulfillment = async () => {
    if (importResults.length === 0) return;

    setImporting(true);
    let successCount = 0;
    const completedRefs = [];
    const failed = [];

    for (const item of importResults) {
      const queueMatch = csvQueue.find((q) => q.order_data.OrderNumber === item.ref || q.order_data.orderName === item.ref);
      if (!queueMatch) {
        failed.push(`${item.ref} (no matching queued order)`);
        continue;
      }

      try {
        const { data, error } = await supabase.functions.invoke('cin7-proxy', {
          body: {
            action: 'fulfill_sale',
            saleId: queueMatch.order_data.ID || queueMatch.order_data.saleId,
            orderNumber: queueMatch.order_data.OrderNumber || queueMatch.order_data.orderName,
            trackingNumber: item.tracking,
            trackingUrl: item.url,
            carrier: 'Australia Post',
          },
        });

        if (!error && data?.success) {
          successCount++;
          completedRefs.push(item.ref);

          // Log the completion so it shows up in the Completed Orders
          // tab -- nothing previously wrote here, which is why that tab
          // has always been empty regardless of how many orders were
          // actually shipped.
          const { data: userData } = await supabase.auth.getUser();
          await supabase.from('fulfillment_history').insert({
            order_name: queueMatch.order_data.OrderNumber || queueMatch.order_data.orderName,
            customer_name: queueMatch.order_data.Customer || queueMatch.order_data.customer || null,
            tracking_number: item.tracking,
            carrier: 'Australia Post',
            shipped_at: new Date().toISOString(),
            created_by: userData?.user?.id || null,
          });
        } else {
          failed.push(`${item.ref} (${error?.message || data?.error || 'unknown error'})`);
        }
      } catch (e) {
        failed.push(`${item.ref} (${e.message})`);
        console.error('Failed to fulfill Cin7 sale:', e);
      }
    }

    const remainingQueue = csvQueue.filter((q) => !completedRefs.includes(q.order_data.OrderNumber) && !completedRefs.includes(q.order_data.orderName));
    await saveQueueToDb(remainingQueue);

    const remainingSales = sales.filter((s) => !completedRefs.includes(s.OrderNumber) && !completedRefs.includes(s.orderName));
    setSales(remainingSales);
    await saveSalesToCache(remainingSales);

    await fetchCompletedHistory();

    setMsg({
      type: failed.length ? 'error' : 'success',
      text: `Fulfilled ${successCount} orders.${failed.length ? ` Failed: ${failed.join(', ')}` : ''}`,
    });
    setImporting(false);
    setImportResults([]);
  };

  return (
    <div className="space-y-4">
      {/* Top Settings Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
        <div>
          <label className="block font-bold text-slate-700 mb-1">AusPost Sender Account</label>
          <input
            type="text"
            value={senderAccount}
            onChange={(e) => setSenderAccount(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5"
          />
        </div>
        <div>
          <label className="block font-bold text-slate-700 mb-1">AusPost Payer Account</label>
          <input
            type="text"
            value={payerAccount}
            onChange={(e) => setPayerAccount(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5"
          />
        </div>
        <div>
          <label className="block font-bold text-slate-700 mb-1">Default Service</label>
          <select
            value={defaultService}
            onChange={(e) => setDefaultService(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5"
          >
            <option value="3D55">Parcel Post (3D55)</option>
            <option value="3J55">Express Post (3J55)</option>
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={handleManualSync}
            disabled={loading}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-3 rounded-md cursor-pointer h-9"
          >
            {loading ? 'Syncing...' : '🔄 Sync Pantone Sales (auto every 30m)'}
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex gap-1 flex-wrap">
        <button
          onClick={() => setActiveTab('select')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'select' ? 'bg-purple-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          1️⃣ Select Pantone Orders ({sales.length})
        </button>
        <button
          onClick={() => setActiveTab('export')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'export' ? 'bg-purple-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          2️⃣ Pantone Export CSV ({csvQueue.length})
        </button>
        <button
          onClick={() => setActiveTab('import')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'import' ? 'bg-purple-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          3️⃣ Import Tracking
        </button>
        <button
          onClick={() => { setActiveTab('completed'); fetchCompletedHistory(); }}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'completed' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          4️⃣ Completed Orders ({completedOrders.length})
        </button>
      </div>

      {msg && (
        <div className={`p-3 text-xs rounded-lg border ${
          msg.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          {msg.text}
        </div>
      )}

      {/* TAB 1: SELECT PANTONE ORDERS */}
      {activeTab === 'select' && (
        <div className="space-y-3">
          {sales.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-3">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search Pantone Order # or Customer..."
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 h-9"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSelectAllTab1}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-md border border-slate-300 cursor-pointer"
                  >
                    Select All ({filteredSales.filter((s) => !queuedSaleIds.has(s.ID)).length})
                  </button>
                  <button
                    onClick={handleUnselectAllTab1}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-md border border-slate-300 cursor-pointer"
                  >
                    Unselect All
                  </button>
                  <span className="text-slate-500 font-medium pl-2">
                    Selected: <strong className="text-purple-600">{selectedSaleIds.length}</strong> / {filteredSales.length}
                  </span>
                </div>

                <button
                  onClick={handleBulkQueueSelected}
                  disabled={selectedSaleIds.length === 0}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-1.5 rounded-md cursor-pointer disabled:opacity-50"
                >
                  ➕ Add Selected ({selectedSaleIds.length}) to Batch
                </button>
              </div>
            </div>
          )}

          {filteredSales.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-400">
              No Pick/Pack authorised Pantone sales from the last 30 days found. Click "Sync Pantone Sales" above.
            </div>
          ) : (
            filteredSales.map((sale) => {
              const saleId = sale.ID;
              const isQueued = queuedSaleIds.has(saleId);
              const isSelected = selectedSaleIds.includes(saleId);

              if (isQueued) {
                return (
                  <div
                    key={saleId}
                    className="bg-purple-50/50 border border-purple-200 rounded-xl p-3 shadow-xs flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="bg-purple-600 text-white font-bold px-2 py-0.5 rounded text-[10px]">
                        IN CSV BATCH
                      </span>
                      <div>
                        <span className="font-bold text-slate-900">{sale.OrderNumber}</span>
                        <span className="text-slate-500 ml-2">— {sale.Customer}</span>
                      </div>
                    </div>
                    <span className="text-slate-400 italic text-[11px]">
                      Queued in Tab 2
                    </span>
                  </div>
                );
              }

              const lines = sale.Lines || sale.lines || [];
              const isExpanded = expandedSaleIds.has(saleId);
              const totalQty = totalItemsPacked(lines);

              return (
                <div
                  key={saleId}
                  className={`bg-white border rounded-xl shadow-xs ${
                    isSelected ? 'border-purple-500 ring-1 ring-purple-500/20 bg-purple-50/20' : 'border-slate-200'
                  }`}
                >
                  <div
                    onClick={() => toggleSaleExpanded(saleId)}
                    className="p-5 flex justify-between items-center cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => { e.stopPropagation(); toggleSaleSelectionTab1(saleId); }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 text-purple-600 border-slate-300 rounded cursor-pointer"
                      />
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">{sale.OrderNumber} — {sale.Customer}</h3>
                        <p className="text-xs text-slate-500">{sale.ShippingAddress?.Line1 || sale.rawAddress?.Line1 || 'No address'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-md">
                        {totalQty} item{totalQty === 1 ? '' : 's'} packed
                      </span>
                      <span className="text-[11px] font-semibold text-slate-400">
                        {sale.OrderDate ? new Date(sale.OrderDate).toLocaleDateString() : ''}
                      </span>
                      <span className="text-slate-400 text-xs font-bold">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  </div>

                  {isExpanded && lines.length > 0 && (
                    <div className="px-5 pb-5 space-y-2 border-t border-slate-100 pt-3">
                      {lines.map((item, idx) => (
                        <div
                          key={item.SKU || item.ID || `line_${saleId}_${idx}`}
                          className="flex justify-between items-center text-xs bg-slate-50 p-2 rounded border border-slate-200"
                        >
                          <span className="font-semibold text-slate-800">{item.SKU ? `${item.SKU} — ` : ''}{item.Name || 'Product'}</span>
                          <span className="text-slate-500 font-medium">Qty: {item.Quantity}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 2: EXPORT CSV */}
      {activeTab === 'export' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectAllExport}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-3 py-1.5 rounded-md border border-slate-300 cursor-pointer"
              >
                Select All ({csvQueue.length})
              </button>
              <button
                onClick={handleUnselectAllExport}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-3 py-1.5 rounded-md border border-slate-300 cursor-pointer"
              >
                Unselect All
              </button>
              <span className="text-xs text-slate-500 font-medium pl-2">
                Selected: <strong className="text-purple-600">{selectedExportIndices.length}</strong> / {csvQueue.length}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleClearBatch}
                className="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs py-2 px-3 rounded-lg border border-red-200 cursor-pointer"
              >
                Clear Batch
              </button>
              <button
                onClick={downloadSelectedAusPostCsv}
                disabled={selectedExportIndices.length === 0}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50"
              >
                ⬇️ Domestic CSV ({selectedExportIndices.length})
              </button>
              <button
                onClick={downloadSelectedIntlCsv}
                disabled={selectedExportIndices.length === 0}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50"
              >
                🌏 International CSV ({selectedExportIndices.length})
              </button>
            </div>
          </div>

          {csvQueue.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No orders queued in Pantone batch. Select orders from Tab 1 and click "Add Selected to Batch".
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
                    <th className="p-3 w-10 text-center">Select</th>
                    <th className="p-3">Order Number</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Service</th>
                    <th className="p-3">Box Dimension Preset</th>
                    <th className="p-3">L x W x H (cm)</th>
                    <th className="p-3">Weight (kg)</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {csvQueue.map((entry, idx) => {
                    const isChecked = selectedExportIndices.includes(idx);
                    const order = entry.order_data;
                    const addr = order.ShippingAddress || order.rawAddress || {};
                    const country = (addr.Country || '').trim().toUpperCase();
                    const isInternational = country && country !== 'AUSTRALIA' && country !== 'AU';

                    return (
                      <React.Fragment key={idx}>
                      <tr className={`hover:bg-slate-50/80 ${isChecked ? 'bg-purple-50/30' : ''}`}>
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleExportSelection(idx)}
                            className="w-4 h-4 text-purple-600 border-slate-300 rounded cursor-pointer"
                          />
                        </td>

                        <td className="p-3 font-bold text-slate-900">{order.OrderNumber || order.orderName}</td>

                        <td className="p-3 font-semibold text-slate-800">{order.Customer || order.customer}</td>

                        <td className="p-3">
                          <select
                            value={entry.service}
                            onChange={(e) => handleUpdateQueueItem(idx, { service: e.target.value })}
                            className="text-xs bg-white border border-slate-300 rounded px-2 py-1"
                          >
                            <option value="3D55">Parcel Post (3D55)</option>
                            <option value="3J55">Express Post (3J55)</option>
                          </select>
                        </td>

                        <td className="p-3">
                          <select
                            value={entry.presetName || 'Custom / Manual'}
                            onChange={(e) => handleDimensionDropdownChange(idx, e.target.value)}
                            className="text-xs bg-white border border-slate-300 rounded px-2 py-1 max-w-[180px]"
                          >
                            {Object.keys(DIM_PRESETS).map((preset) => (
                              <option key={preset} value={preset}>
                                {preset}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.1"
                              value={entry.length}
                              onChange={(e) =>
                                handleUpdateQueueItem(idx, {
                                  length: parseFloat(e.target.value) || 0,
                                  presetName: 'Custom / Manual',
                                })
                              }
                              className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                            />
                            <span className="text-slate-400">×</span>
                            <input
                              type="number"
                              step="0.1"
                              value={entry.width}
                              onChange={(e) =>
                                handleUpdateQueueItem(idx, {
                                  width: parseFloat(e.target.value) || 0,
                                  presetName: 'Custom / Manual',
                                })
                              }
                              className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                            />
                            <span className="text-slate-400">×</span>
                            <input
                              type="number"
                              step="0.1"
                              value={entry.height}
                              onChange={(e) =>
                                handleUpdateQueueItem(idx, {
                                  height: parseFloat(e.target.value) || 0,
                                  presetName: 'Custom / Manual',
                                })
                              }
                              className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                            />
                          </div>
                        </td>

                        <td className="p-3">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={entry.weight}
                            onChange={(e) =>
                              handleUpdateQueueItem(idx, { weight: parseFloat(e.target.value) || 0.1 })
                            }
                            className="w-20 text-xs bg-white border border-slate-300 rounded px-2 py-1 text-right font-semibold text-slate-800"
                          />
                        </td>

                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleRemoveFromQueue(idx)}
                            title="Remove from batch and expand in Tab 1"
                            className="text-slate-400 hover:text-red-600 font-bold p-1 cursor-pointer text-sm"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                      {isInternational && (
                        <tr className="bg-blue-50/40">
                          <td></td>
                          <td colSpan={7} className="p-3">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-bold text-blue-900">🌏 Customs value (AUD) for {order.OrderNumber || order.orderName}:</span>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={entry.customsValue ?? ''}
                                onChange={(e) => handleUpdateQueueItem(idx, { customsValue: e.target.value })}
                                placeholder="Total declared value"
                                className="w-32 text-xs bg-white border border-blue-300 rounded px-2 py-1"
                              />
                              <span className="text-blue-700">Required on the international CSV -- per-unit value is calculated from this automatically.</span>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: IMPORT TRACKING */}
      {activeTab === 'import' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <label className="block text-xs font-bold text-slate-700">Upload Australia Post / Courier Result CSV File</label>
          <input type="file" accept=".csv" onChange={handleResultsCsvUpload} className="block w-full text-xs text-slate-500" />
          {importResults.length > 0 && (
            <button onClick={handleExecuteCin7Fulfillment} disabled={importing} className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-2 px-4 rounded-lg h-9 cursor-pointer">
              {importing ? 'Fulfilling in Cin7...' : `✅ Fulfill ${importResults.length} Orders in Cin7`}
            </button>
          )}
        </div>
      )}

      {/* TAB 4: COMPLETED ORDERS */}
      {activeTab === 'completed' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="p-2">Shipped Date</th>
                <th className="p-2">Order #</th>
                <th className="p-2">Customer</th>
                <th className="p-2">Tracking Number</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {completedOrders.map((i) => (
                <tr key={i.id}>
                  <td className="p-2">{i.shipped_at ? new Date(i.shipped_at).toLocaleString() : 'N/A'}</td>
                  <td className="p-2 font-bold text-purple-600">{i.order_name || 'N/A'}</td>
                  <td className="p-2">{i.customer_name || 'N/A'}</td>
                  <td className="p-2 font-mono">
                    <a href={`https://auspost.com.au/mypost/track/#/details/${i.tracking_number}`} target="_blank" rel="noreferrer" className="text-purple-600 hover:underline">
                      {i.tracking_number} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
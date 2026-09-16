import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import AusPostValidateTab from './Auspostvalidatetab';
import AusPostManifestTab from './Auspostmanifesttab';
import AusPostSavedManifestsTab from './Auspostsavedmanifeststab';
import AusPostTrackingTab from './Ausposttrackingtab';
import { INTL_PRODUCT_ID, SENDER_ADDRESS, normaliseCountryCode, truncateField, buildAddressLines, LABEL_LAYOUT_A6 } from './Auspostconstants';

const DIM_PRESETS = {
  '20 x 25 x 5 (Default)': { length: 20.0, width: 25.0, height: 5.0 },
  '30 x 20 x 15': { length: 30.0, width: 20.0, height: 15.0 },
  '40 x 30 x 20': { length: 40.0, width: 30.0, height: 20.0 },
  '60 x 40 x 30': { length: 60.0, width: 40.0, height: 30.0 },
  'Custom / Manual': null,
};

export default function Cin7Fulfillment() {
  const [activeTab, setActiveTab] = useState('select');
  const [expandedSaleIds, setExpandedSaleIds] = useState(new Set());
  const [sales, setSales] = useState([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [selectedSaleIds, setSelectedSaleIds] = useState([]);
  const [csvQueue, setCsvQueue] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [msg, setMsg] = useState(null);

  const [defaultService, setDefaultService] = useState('3D55');

  // Shared between Tab 2 (creates shipments/labels) and Tab 3 (books
  // manifests, deletes, re-downloads labels) -- lifted up here rather
  // than living inside one tab, since both genuinely need to read and
  // write the same per-order process state now.
  const [processState, setProcessState] = useState({});

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

  const filterAndSortSales = (rawSales) => {
    // No date filter here anymore -- there used to be a 30-day cutoff
    // on top of the server-side eligibility check, but that check
    // (Fulfilments[].Pick/Pack.Status === "AUTHORISED", applied in the
    // edge function before anything reaches this cache) is already the
    // authoritative signal for "genuinely ready to ship," not order
    // age. Confirmed this cutoff was actively hiding real, currently-
    // actionable orders: a genuinely ready order from months ago (one
    // that got stuck in the sync backlog the DETAIL_FETCH_CAP fix
    // above now clears) was invisible here purely because it was
    // "old," even though DEAR itself still says it's ready to pick/
    // pack/ship right now. Sorting still puts the most recently
    // updated orders first; nothing genuinely eligible is hidden.
    return [...rawSales].sort((a, b) => {
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

      // Cross-reference against manually-hidden orders -- a person can
      // remove an order from view here without touching the sync's own
      // cache at all. It stays hidden until the sync itself has real
      // evidence to remove it from the cache entirely (the order
      // actually ships); if the sync never removes it because it's
      // genuinely still eligible, it also stays hidden here
      // indefinitely, since a manual hide is a deliberate choice, not
      // a temporary snooze.
      const { data: hiddenRows } = await supabase.from('pantone_hidden_orders').select('order_number');
      const hiddenOrderNumbers = new Set((hiddenRows || []).map((r) => r.order_number));
      setHiddenCount(hiddenOrderNumbers.size);

      if (!error && data) {
        const visible = (data.orders_data || []).filter(
          (s) => !hiddenOrderNumbers.has(s.OrderNumber)
        );
        setSales(filterAndSortSales(visible));
      } else if (!error && !data) {
        // First run ever, nothing synced yet -- prompt for a manual sync
        // rather than silently triggering a live DEAR call on page load.
        setMsg({ type: 'error', text: 'No synced data yet. Click "Sync Pantone Sales" to run the first sync.' });
      }
    } catch (err) {
      setMsg({ type: 'error', text: `Failed to load cached sales: ${err.message}` });
    }
  };

  const handleHideOrder = async (orderNumber) => {
    if (!window.confirm(`Remove ${orderNumber} from this list? It'll stay hidden until it's actually shipped/removed by the system, or until you re-sync and it's still genuinely eligible with fresh data.`)) return;
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from('pantone_hidden_orders').upsert({
        order_number: orderNumber,
        hidden_at: new Date().toISOString(),
        hidden_by: userData?.user?.id || null,
      });
      if (error) throw error;
      setSales((prev) => prev.filter((s) => (s.OrderNumber || s.orderName) !== orderNumber));
      setHiddenCount((prev) => prev + 1);
      setMsg({ type: 'success', text: `${orderNumber} hidden from this list.` });
    } catch (err) {
      setMsg({ type: 'error', text: `Failed to hide order: ${err.message}` });
    }
  };

  // Restores every manually-hidden order at once -- equivalent to
  // `delete from pantone_hidden_orders;`, run through the app instead
  // of needing direct SQL access each time. The JS client requires an
  // explicit filter on delete (no unrestricted delete allowed), so
  // .neq('order_number', '') matches every real row, since a genuine
  // order number is never an empty string.
  const handleUnhideAll = async () => {
    if (hiddenCount === 0) return;
    if (!window.confirm(`Restore all ${hiddenCount} hidden order(s) back to this list?`)) return;
    try {
      const { error } = await supabase.from('pantone_hidden_orders').delete().neq('order_number', '');
      if (error) throw error;
      setHiddenCount(0);
      setMsg({ type: 'success', text: 'All hidden orders restored. Reloading list...' });
      await loadCachedSales();
    } catch (err) {
      setMsg({ type: 'error', text: `Failed to restore hidden orders: ${err.message}` });
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

    // International takes priority over the domestic carrier-based
    // detection -- DetectedService only ever distinguishes Parcel Post
    // vs Express Post (see detectRequestedService in cin7-proxy), it
    // has no concept of international at all. Same isInternational
    // check already proven in the export table below, applied here so
    // a genuinely international order is never defaulted to a domestic
    // service that would fail validation.
    const addr = sale.ShippingAddress || sale.rawAddress || {};
    const country = (addr.Country || '').trim().toUpperCase();
    const isInternational = country && country !== 'AUSTRALIA' && country !== 'AU';

    return {
      order_data: { ...sale },
      // Auto-detected from DEAR's carrier/shipping-method fields when
      // available (see detectRequestedService in cin7-proxy), same
      // fallback pattern Shopify already uses -- falls back to whatever
      // is set in the Default Service dropdown when DEAR has no signal.
      // Still fully editable afterward in the table below.
      service: isInternational ? INTL_PRODUCT_ID : (sale.DetectedService || defaultService),
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
  };

  // Bulk-safe version for Tab 2's "Send back to Tab 1" -- computes the
  // full removal against one snapshot of csvQueue in a single update,
  // rather than calling handleRemoveFromQueue repeatedly in a loop
  // (which would see a stale csvQueue between calls, since React state
  // updates aren't synchronous/immediate within a loop).
  const handleRemoveMultipleFromQueue = async (orderNumbers) => {
    if (orderNumbers.length === 0) return;
    const updatedQueue = csvQueue.filter((e) => {
      const orderNumber = e.order_data.OrderNumber || e.order_data.orderName;
      return !orderNumbers.includes(orderNumber);
    });
    await saveQueueToDb(updatedQueue);
    setMsg({ type: 'success', text: `${orderNumbers.length} order(s) sent back to Tab 1.` });
  };

  const handleClearBatch = async () => {
    if (csvQueue.length === 0) return;
    await saveQueueToDb([]);
    setMsg({ type: 'success', text: 'Batch cleared. All Pantone orders returned to full view in Tab 1.' });
  };

  const handleUpdateQueueItem = (index, updatedFields) => {
    const updatedQueue = [...csvQueue];
    updatedQueue[index] = { ...updatedQueue[index], ...updatedFields };
    saveQueueToDb(updatedQueue);
  };

  // ===========================================================
  // Shared AusPost process state + handlers (Tab 2 + Tab 3)
  // ===========================================================
  const getProcessState = (orderNumber) => processState[orderNumber] || {};
  const updateProcessState = (orderNumber, patch) => {
    setProcessState((prev) => ({ ...prev, [orderNumber]: { ...(prev[orderNumber] || {}), ...patch } }));
  };

  const callAusPostAction = async (body) => {
    const { data, error } = await supabase.functions.invoke('cin7-proxy', { body });
    if (error) throw error;
    if (!data.success) {
      const err = new Error(data.error);
      err.raw = data.raw;
      throw err;
    }
    return data;
  };

  // Forces a genuine browser download rather than just opening the PDF
  // in a new tab -- fetches the bytes and triggers an anchor click,
  // same pattern already used elsewhere in this codebase (CreateInvoice.jsx).
  // Routed through the server-side proxy rather than fetching the PDF
  // URL directly from the browser -- AusPost's signed label/asset URLs
  // can be blocked by CORS the same way Shopify's CDN images were
  // earlier tonight, and a server-to-server request sidesteps that
  // entirely rather than depending on the asset host sending the right
  // CORS headers for a browser request.
  const downloadFileFromUrl = async (url, filename) => {
    const { data, error } = await supabase.functions.invoke('cin7-proxy', {
      body: { action: 'fetch_pdf_data_uri', pdfUrl: url },
    });
    if (error) throw error;
    if (!data.success) throw new Error(data.error);

    const byteChars = atob(data.dataUri.split(',')[1]);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
  };

  // Builds a properly AusPost-safe "to" address -- name/business_name
  // truncated to the real confirmed 40-character limit, full address
  // broken across up to 3 lines respecting each line's own limit
  // (40/60/60), rather than sending raw untruncated DEAR data that
  // AusPost's API would silently cut off or reject.
  const buildSafeToAddress = (order, isInternational) => {
    const addr = order.ShippingAddress || order.rawAddress || {};
    const fullAddressText = [addr.Line1, addr.Line2, addr.Line3].filter(Boolean).join(' ');
    const lines = buildAddressLines(fullAddressText);

    return {
      name: truncateField(order.Customer || order.customer || 'Customer'),
      business_name: addr.Company ? truncateField(addr.Company) : undefined,
      lines: lines.length ? lines : [truncateField(fullAddressText)],
      suburb: addr.City || '',
      state: addr.State || '',
      postcode: addr.Postcode || '',
      phone: order.Phone || order.phone || '',
      email: order.Email || order.email || '',
      ...(isInternational ? { country: normaliseCountryCode(addr.Country) } : {}),
    };
  };

  // Tab 2's "Create Label" action: creates the AusPost shipment, then
  // immediately creates its label (A6), then forces a real download of
  // the label PDF. Only processes entries that don't already have a
  // shipment -- safe to re-run on a partially-completed batch. Once
  // done, the order naturally appears in Tab 3 (same csvQueue +
  // processState, nothing further needs to happen for it to "move"
  // there).
  const handleCreateShipmentAndLabel = async (entries) => {
    for (const entry of entries) {
      const order = entry.order_data;
      const orderNumber = order.OrderNumber || order.orderName;
      if (getProcessState(orderNumber).shipmentId) continue;

      updateProcessState(orderNumber, { stage: 'creating_shipment', error: null });
      try {
        const isInternational = entry.service === INTL_PRODUCT_ID;
        const toAddress = buildSafeToAddress(order, isInternational);

        const shipData = await callAusPostAction({
          action: 'create_auspost_shipment',
          auspostShipments: [
            {
              shipment_reference: orderNumber,
              from: SENDER_ADDRESS,
              to: toAddress,
              items: [
                {
                  item_reference: orderNumber,
                  product_id: entry.service,
                  length: String(entry.length),
                  width: String(entry.width),
                  height: String(entry.height),
                  weight: String(entry.weight),
                },
              ],
            },
          ],
        });

        const shipment = shipData.result?.shipments?.[0];
        const shipmentId = shipment?.shipment_id || null;
        const trackingNumber = shipment?.items?.[0]?.tracking_details?.article_id || null;
        updateProcessState(orderNumber, { stage: 'shipment_created', shipmentId, trackingNumber, error: null });

        if (!shipmentId) continue;

        updateProcessState(orderNumber, { stage: 'creating_label' });
        const labelData = await callAusPostAction({
          action: 'create_auspost_label',
          auspostShipmentIds: [shipmentId],
          labelGroup: isInternational ? 'International' : (entry.service === '3J55' ? 'Express Post' : 'Parcel Post'),
          // A6, per spec -- confirmed valid layout value via AusPost's
          // real documentation (A4-1pp, A4-3pp, A4-4pp, A6-1pp).
          labelLayout: LABEL_LAYOUT_A6,
          // A6 doesn't support branded:true -- confirmed via a real
          // INVALID_BRANDING_REQUEST (70010) error when it was left
          // defaulting to true.
          labelBranded: false,
        });
        const label = labelData.result?.labels?.[0];
        updateProcessState(orderNumber, { stage: 'label_created', labelRequestId: label?.request_id || null, labelUrl: label?.url || null, error: null });

        if (label?.url) {
          try {
            await downloadFileFromUrl(label.url, `${orderNumber}_label.pdf`);
          } catch (downloadErr) {
            updateProcessState(orderNumber, { error: `Label created but download failed: ${downloadErr.message}` });
          }
        }
      } catch (err) {
        updateProcessState(orderNumber, { stage: 'error', error: err.message });
      }
    }
  };

  // Tab 3's re-download -- for a shipment not yet booked into a
  // manifest, the label URL from creation may have expired, so this
  // re-fetches a fresh one from AusPost directly via the stored
  // request_id (the Get Label action), rather than assuming the
  // original URL is still valid.
  const handleRedownloadLabel = async (entry) => {
    const order = entry.order_data;
    const orderNumber = order.OrderNumber || order.orderName;
    const s = getProcessState(orderNumber);
    if (!s.labelRequestId) return;
    try {
      const data = await callAusPostAction({ action: 'get_auspost_label', auspostRequestId: s.labelRequestId });
      const url = data.result?.url || data.result?.labels?.[0]?.url;
      if (!url) throw new Error('No label URL returned.');
      await downloadFileFromUrl(url, `${orderNumber}_label.pdf`);
    } catch (err) {
      setMsg({ type: 'error', text: `Couldn't re-download label for ${orderNumber}: ${err.message}` });
    }
  };

  // Tab 3's "Delete Shipment": deletes the real AusPost shipment
  // (removes the label with it -- AusPost has no separate "delete
  // label" call, deleting the shipment is what clears both), then
  // clears local process state, then removes the order from csvQueue
  // entirely -- which is what makes it reappear in Tab 1, since Tab 1
  // filters out anything currently queued.
  const handleDeleteShipment = async (entries) => {
    const successfullyDeleted = [];
    for (const entry of entries) {
      const order = entry.order_data;
      const orderNumber = order.OrderNumber || order.orderName;
      const s = getProcessState(orderNumber);
      if (!s.shipmentId) continue;

      try {
        await callAusPostAction({ action: 'delete_auspost_shipment', auspostShipmentIds: [s.shipmentId] });
        setProcessState((prev) => {
          const next = { ...prev };
          delete next[orderNumber];
          return next;
        });
        successfullyDeleted.push(orderNumber);
      } catch (err) {
        setMsg({ type: 'error', text: `Couldn't delete shipment for ${orderNumber}: ${err.message}` });
      }
    }
    // One bulk removal against a single csvQueue snapshot, after every
    // delete call has resolved -- same reasoning as
    // handleRemoveMultipleFromQueue: looping the single-item removal
    // here would read a stale csvQueue between iterations.
    if (successfullyDeleted.length > 0) await handleRemoveMultipleFromQueue(successfullyDeleted);
  };

  // Tab 3's "Create Manifest": books the manifest (seals every ready
  // shipment into one real AusPost order), downloads the real order
  // summary PDF (A4 -- this is simply what that endpoint returns, no
  // separate size parameter exists for it), then updates DEAR for each
  // shipment via fulfill_sale, then removes completed entries from the
  // active batch -- their job here is done, Tab 4 holds the permanent
  // record from this point on.
  const handleCreateManifestAndComplete = async (entries, orderReference) => {
    const readyEntries = entries.filter((entry) => {
      const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
      const s = getProcessState(orderNumber);
      return s.shipmentId && s.labelRequestId && !s.orderId;
    });
    if (readyEntries.length === 0) return;

    try {
      const shipmentIds = readyEntries.map((entry) => {
        const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
        return getProcessState(orderNumber).shipmentId;
      });
      const labelRequestIds = {};
      const labelUrls = {};
      readyEntries.forEach((entry) => {
        const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
        const s = getProcessState(orderNumber);
        labelRequestIds[s.shipmentId] = s.labelRequestId;
        labelUrls[s.shipmentId] = s.labelUrl;
      });

      const orderData = await callAusPostAction({
        action: 'create_auspost_order',
        auspostShipmentIds: shipmentIds,
        auspostOrderReference: orderReference,
        auspostLabelRequestIds: labelRequestIds,
        auspostLabelUrls: labelUrls,
      });
      const orderId = orderData.result?.order?.order_id || null;

      readyEntries.forEach((entry) => {
        const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
        updateProcessState(orderNumber, { stage: 'booked', orderId, error: null });
      });

      // Real order summary PDF (A4) -- confirmed real endpoint, tested
      // earlier tonight.
      if (orderId) {
        try {
          const summaryData = await callAusPostAction({ action: 'get_auspost_order_summary', auspostOrderId: orderId });
          if (summaryData.pdfBase64) {
            const byteChars = atob(summaryData.pdfBase64);
            const byteNumbers = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
            const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = `manifest_${orderId}.pdf`;
            a.click();
            URL.revokeObjectURL(objectUrl);
          }
        } catch (summaryErr) {
          setMsg({ type: 'error', text: `Manifest booked, but couldn't download the summary PDF: ${summaryErr.message}` });
        }
      }

      // Update DEAR for each shipment, matching the exact same
      // fulfill_sale shape already proven in the original CSV/Import
      // Tracking flow.
      const loggingFailures = [];
      for (const entry of readyEntries) {
        const order = entry.order_data;
        const orderNumber = order.OrderNumber || order.orderName;
        const s = getProcessState(orderNumber);
        try {
          const { data, error } = await supabase.functions.invoke('cin7-proxy', {
            body: {
              action: 'fulfill_sale',
              saleId: order.ID || order.saleId,
              orderNumber,
              trackingNumber: s.trackingNumber,
              trackingUrl: `https://auspost.com.au/mypost/track/#/details/${s.trackingNumber}`,
              carrier: 'Australia Post',
            },
          });
          if (error) throw error;
          if (!data?.success) throw new Error(data?.error || 'Unknown error');
          updateProcessState(orderNumber, { stage: 'complete', dearUpdated: true, error: null });
        } catch (err) {
          loggingFailures.push(orderNumber);
          updateProcessState(orderNumber, { stage: 'error', error: `DEAR update failed: ${err.message}` });
        }
      }

      // Remove fully-completed entries from the active batch -- their
      // job here is done. Anything that failed the DEAR step stays in
      // the queue so it's not silently lost.
      const completedNumbers = readyEntries
        .map((entry) => entry.order_data.OrderNumber || entry.order_data.orderName)
        .filter((n) => !loggingFailures.includes(n));
      const remainingQueue = csvQueue.filter(
        (e) => !completedNumbers.includes(e.order_data.OrderNumber || e.order_data.orderName)
      );
      await saveQueueToDb(remainingQueue);

      setMsg({
        type: loggingFailures.length ? 'error' : 'success',
        text: loggingFailures.length
          ? `Manifest booked, but DEAR update failed for: ${loggingFailures.join(', ')}.`
          : `Manifest booked and DEAR updated for ${completedNumbers.length} order(s).`,
      });
    } catch (err) {
      readyEntries.forEach((entry) => {
        const orderNumber = entry.order_data.OrderNumber || entry.order_data.orderName;
        updateProcessState(orderNumber, { stage: 'error', error: `Manifest booking failed: ${err.message}` });
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Settings Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
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
        {hiddenCount > 0 && (
          <div className="flex items-end">
            <button
              onClick={handleUnhideAll}
              title="Restore every order you've manually removed from this list"
              className="w-full bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs py-2 px-3 rounded-md cursor-pointer h-9 border border-slate-300"
            >
              ↩️ Restore {hiddenCount} Hidden Order{hiddenCount === 1 ? '' : 's'}
            </button>
          </div>
        )}
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
          onClick={() => setActiveTab('validate')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'validate' ? 'bg-purple-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          2️⃣ Validate & Price ({csvQueue.length})
        </button>
        <button
          onClick={() => setActiveTab('manifest')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'manifest' ? 'bg-purple-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          3️⃣ Create Label & Book Manifest
        </button>
        <button
          onClick={() => setActiveTab('manifests')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'manifests' ? 'bg-purple-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          4️⃣ Saved Manifests
        </button>
        <button
          onClick={() => setActiveTab('tracking')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'tracking' ? 'bg-purple-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          5️⃣ Tracking
        </button>
        <button
          onClick={() => { setActiveTab('completed'); fetchCompletedHistory(); }}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'completed' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          6️⃣ Completed Orders ({completedOrders.length})
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
                      <button
                        onClick={(e) => { e.stopPropagation(); handleHideOrder(sale.OrderNumber); }}
                        title="Remove from this list -- stays hidden until it's shipped or genuinely re-confirmed by a sync"
                        className="text-slate-300 hover:text-red-500 text-sm cursor-pointer px-1"
                      >
                        🗑️
                      </button>
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

      {/* TAB 2: VALIDATE & PRICE */}
      {activeTab === 'validate' && (
        <AusPostValidateTab
          csvQueue={csvQueue}
          onUpdateQueueItem={handleUpdateQueueItem}
          processState={processState}
          onCreateShipmentAndLabel={handleCreateShipmentAndLabel}
          onRemoveFromQueue={handleRemoveMultipleFromQueue}
        />
      )}

      {/* TAB 3: CREATE LABEL & BOOK MANIFEST */}
      {activeTab === 'manifest' && (
        <AusPostManifestTab
          csvQueue={csvQueue}
          processState={processState}
          onRedownloadLabel={handleRedownloadLabel}
          onDeleteShipment={handleDeleteShipment}
          onCreateManifestAndComplete={handleCreateManifestAndComplete}
        />
      )}

      {/* TAB 4: SAVED MANIFESTS */}
      {activeTab === 'manifests' && (
        <AusPostSavedManifestsTab />
      )}

      {/* TAB 5: TRACKING */}
      {activeTab === 'tracking' && (
        <AusPostTrackingTab />
      )}

      {/* TAB 6: COMPLETED ORDERS */}
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
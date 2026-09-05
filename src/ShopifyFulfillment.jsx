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

const CARRIERS = ['Australia Post', 'StarTrack', 'DHL', 'CouriersPlease', 'Other'];

const SERVICE_OPTIONS = {
  'Parcel Post (3D55)': '3D55',
  'Express Post (3J55)': '3J55',
};

const DIM_PRESETS = {
  '20 x 25 x 5 (Default)': { length: 20.0, width: 25.0, height: 5.0 },
  '30 x 20 x 15': { length: 30.0, width: 20.0, height: 15.0 },
  '40 x 30 x 20': { length: 40.0, width: 30.0, height: 20.0 },
  '60 x 40 x 30': { length: 60.0, width: 40.0, height: 30.0 },
  'Custom / Manual': null,
};

const getAutoDimensionsFromWeight = (weightKg) => {
  if (weightKg < 1.0) {
    return { length: 20.0, width: 25.0, height: 5.0, presetName: '20 x 25 x 5 (Default)' };
  } else if (weightKg <= 2.0) {
    return { length: 30.0, width: 20.0, height: 15.0, presetName: '30 x 20 x 15' };
  } else {
    return { length: 40.0, width: 30.0, height: 20.0, presetName: '40 x 30 x 20' };
  }
};

export default function ShopifyFulfillment() {
  const [activeTab, setActiveTab] = useState('select');
  const [expandedOrderIds, setExpandedOrderIds] = useState(new Set());
  const [orders, setOrders] = useState([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
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

  const [carrierMap, setCarrierMap] = useState({});
  const [trackingMap, setTrackingMap] = useState({});
  const [dispatchingMap, setDispatchingMap] = useState({});
  const [itemQtysMap, setItemQtysMap] = useState({});

  const [importResults, setImportResults] = useState([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    loadCachedOrdersAndCheckAge();
    fetchQueueFromDb();
    fetchCompletedHistory();
  }, []);

  useEffect(() => {
    if (activeTab === 'export') {
      setSelectedExportIndices(csvQueue.map((_, idx) => idx));
    }
  }, [activeTab, csvQueue.length]);

  const loadCachedOrdersAndCheckAge = async () => {
    try {
      const { data, error } = await supabase
        .from('shopify_orders_cache')
        .select('orders_data, last_fetched_at')
        .eq('id', 'latest_unfulfilled')
        .maybeSingle();

      if (!error && data) {
        setOrders(data.orders_data || []);

        const lastFetched = new Date(data.last_fetched_at).getTime();
        const now = new Date().getTime();
        const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

        if (now - lastFetched > THREE_HOURS_MS) {
          fetchShopifyOrders();
        }
      } else {
        fetchShopifyOrders();
      }
    } catch (err) {
      fetchShopifyOrders();
    }
  };

  const saveOrdersToCache = async (fetchedOrders) => {
    try {
      await supabase.from('shopify_orders_cache').upsert({
        id: 'latest_unfulfilled',
        orders_data: fetchedOrders,
        last_fetched_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to save orders to cache:', err);
    }
  };

  const logError = async (module, message) => {
    try {
      await supabase.from('error_logs').insert({ module, message });
    } catch (e) {
      console.error('Failed to write to error_logs:', e);
    }
  };

  const saveOrderToDb = async (orderDict) => {
    try {
      const shopifyId = orderDict['Order ID'];

      const { data: existing, error: findError } = await supabase
        .from('orders')
        .select('id')
        .eq('shopify_id', shopifyId)
        .maybeSingle();

      if (findError) throw findError;

      let orderDbId;

      if (existing) {
        orderDbId = existing.id;
        await supabase
          .from('orders')
          .update({
            order_number: orderDict['Order Name'] || 'N/A',
            customer: orderDict.Customer || '',
            email: orderDict.Email || '',
            phone: orderDict.Phone || '',
            address: JSON.stringify(orderDict['Raw Address'] || {}),
            fulfillment_order_id: orderDict['Fulfillment Order ID'],
            source: 'shopify',
          })
          .eq('id', orderDbId);
      } else {
        const { data: newOrder, error: insertError } = await supabase
          .from('orders')
          .insert({
            // external_id is NOT NULL with no default -- confirmed via
            // error_logs that every single order sync has been failing
            // on this exact constraint (zero rows in the whole table
            // have ever had it populated). Using the same value as
            // shopify_id: it's the natural unique identifier this
            // column is almost certainly meant to hold, and no other
            // convention exists yet to conflict with.
            external_id: shopifyId,
            shopify_id: shopifyId,
            order_number: orderDict['Order Name'] || 'N/A',
            customer: orderDict.Customer || '',
            email: orderDict.Email || '',
            phone: orderDict.Phone || '',
            address: JSON.stringify(orderDict['Raw Address'] || {}),
            fulfillment_order_id: orderDict['Fulfillment Order ID'],
            status: 'OPEN',
            source: 'shopify',
          })
          .select('id')
          .single();

        if (insertError) throw insertError;
        orderDbId = newOrder.id;
      }

      await _upsertLineItems(orderDbId, orderDict['Line Items']);
    } catch (err) {
      await logError('saveOrderToDb', err.message);
    }
  };

  const _upsertLineItems = async (orderDbId, lineItems) => {
    for (const item of lineItems) {
      const foId = item.fo_line_item_id;

      const { data: existingItem } = await supabase
        .from('order_items')
        .select('id')
        .eq('order_id', orderDbId)
        .eq('fo_line_item_id', foId)
        .maybeSingle();

      if (existingItem) {
        await supabase
          .from('order_items')
          .update({
            quantity: item.remaining_qty,
            unit_weight: item.unit_weight_kg || 0,
          })
          .eq('id', existingItem.id);
      } else {
        await supabase.from('order_items').insert({
          order_id: orderDbId,
          fo_line_item_id: foId,
          sku: item.sku || '',
          title: item.title || 'Product Item',
          variant: item.variant || '',
          unit_weight: item.unit_weight_kg || 0,
          quantity: item.remaining_qty,
          dispatched_quantity: 0,
        });
      }
    }
  };

  // orderContext (new) is a fallback source of order details -- the
  // caller's own in-memory order object -- used ONLY if no matching
  // orders row exists yet. Previously this function gave up silently
  // (logError + return) when the lookup failed, meaning a fulfillment
  // could succeed completely in Shopify while the shipment record (and
  // therefore its Completed Orders entry) never got written, with no
  // visible error. Confirmed via error_logs: order #39524 hit exactly
  // this path. The gap happens when an order sitting in
  // shopify_orders_cache predates its own orders-table row -- the cache
  // refreshes every 3 hours, so an order fulfilled between refreshes
  // (or one that failed to write during a previous saveOrderToDb call)
  // has nothing to match against here.
  //
  // Returns true/false now (previously nothing) -- every caller used to
  // await this without ever checking the result, so it could fail
  // silently (only visible in error_logs) while the calling code still
  // showed "Order fulfilled!" regardless of whether this local logging
  // actually succeeded. Shopify itself genuinely completed the order in
  // that case -- only the Completed Orders entry was ever missing.
  const saveShipmentToDb = async (orderNumber, shipmentId, tracking, service, label, manifest, dispatchedItems, orderContext) => {
    try {
      let { data: order } = await supabase
        .from('orders')
        .select('id')
        .eq('order_number', orderNumber)
        .maybeSingle();

      if (!order && orderContext) {
        const { data: created, error: createErr } = await supabase
          .from('orders')
          .insert({
            // Same fix as saveOrderToDb's insert above -- external_id
            // is NOT NULL with no default, and this fallback path was
            // the one that first surfaced the constraint violation in
            // error_logs.
            external_id: orderContext.saleId || null,
            shopify_id: orderContext.saleId || null,
            order_number: orderNumber,
            customer: orderContext.customer || '',
            email: orderContext.email || '',
            phone: orderContext.phone || '',
            address: JSON.stringify(orderContext.rawAddress || {}),
            fulfillment_order_id: orderContext.fulfillmentOrderId || null,
            status: 'OPEN',
            source: 'shopify',
          })
          .select('id')
          .single();

        if (createErr) {
          await logError('saveShipmentToDb', `Could not create missing order row for order_number=${orderNumber}: ${createErr.message}`);
          return false;
        }
        order = created;
      }

      if (!order) {
        await logError('saveShipmentToDb', `No matching order found for order_number=${orderNumber} and no order context was available to create one.`);
        return false;
      }

      // shipped_date was missing from this insert entirely, despite
      // fetchCompletedHistory sorting by it and Tab 4 displaying it --
      // if that column is NOT NULL with no default, every single insert
      // here would fail on a constraint violation, get caught below,
      // logged only to error_logs, and never surface to the user. This
      // is very likely the direct cause of "order completes but never
      // shows in Completed Orders."
      const { error: shipmentInsertErr } = await supabase.from('shipments').insert({
        order_id: order.id,
        shipment_id: shipmentId || '',
        tracking_number: tracking,
        shipping_service: service,
        label_path: label || '',
        manifest_id: manifest || '',
        source: 'shopify',
        shipped_date: new Date().toISOString(),
      });

      if (shipmentInsertErr) {
        await logError('saveShipmentToDb', `shipments insert failed for order_number=${orderNumber}: ${shipmentInsertErr.message}`);
        return false;
      }

      for (const shipped of dispatchedItems) {
        const foId = shipped.fo_line_item_id;

        let { data: item } = await supabase
          .from('order_items')
          .select('id, dispatched_quantity')
          .eq('order_id', order.id)
          .eq('fo_line_item_id', foId)
          .maybeSingle();

        if (!item) {
          const { data: itemByTitle } = await supabase
            .from('order_items')
            .select('id, dispatched_quantity')
            .eq('order_id', order.id)
            .eq('title', shipped.title)
            .maybeSingle();
          item = itemByTitle;
        }

        if (item) {
          await supabase
            .from('order_items')
            .update({
              dispatched_quantity: (item.dispatched_quantity || 0) + (shipped.dispatch_qty || shipped.remaining_qty),
            })
            .eq('id', item.id);
        }
      }

      const { data: allItems } = await supabase
        .from('order_items')
        .select('quantity, dispatched_quantity')
        .eq('order_id', order.id);

      let completed = true;
      let partial = false;

      (allItems || []).forEach((item) => {
        if (item.dispatched_quantity < item.quantity) {
          completed = false;
          if (item.dispatched_quantity > 0) partial = true;
        }
      });

      const newStatus = completed ? 'SHIPPED' : partial ? 'PARTIALLY_SHIPPED' : 'OPEN';
      await supabase.from('orders').update({ status: newStatus }).eq('id', order.id);

      return true;
    } catch (err) {
      await logError('saveShipmentToDb', err.message);
      return false;
    }
  };

  const fetchQueueFromDb = async () => {
    const { data, error } = await supabase
      .from('csv_queue')
      .select('*')
      .eq('source', 'shopify')
      .maybeSingle();

    if (!error && data?.queue_data) setCsvQueue(data.queue_data);
    else setCsvQueue([]);
  };

  const saveQueueToDb = async (newQueue) => {
    setCsvQueue(newQueue);
    const { data: userData } = await supabase.auth.getUser();

    await supabase.from('csv_queue').upsert({
      user_id: userData.user?.id,
      source: 'shopify',
      queue_data: newQueue,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, source' });
  };

  const fetchCompletedHistory = async () => {
    setLoadingHistory(true);
    let { data, error } = await supabase
      .from('shipments')
      .select('*, orders(order_number, customer, email)')
      .eq('source', 'shopify')
      .order('shipped_date', { ascending: false });

    if (error) {
      const fallback = await supabase
        .from('shipments')
        .select('*, orders(order_number, customer, email)')
        .order('shipped_date', { ascending: false });
      data = fallback.data;
    }

    if (data) setCompletedOrders(data);
    setLoadingHistory(false);
  };

  const normalizeWeight = (val, unit) => {
    let w = parseFloat(val) || 0.2;
    const u = (unit || 'KILOGRAMS').toUpperCase();
    if (u === 'GRAMS') w = w / 1000.0;
    else if (u === 'OUNCES') w = w * 0.0283495;
    else if (u === 'POUNDS') w = w * 0.453592;
    return parseFloat(w.toFixed(3));
  };

  const fetchShopifyOrders = async () => {
    setLoading(true);
    setMsg(null);
    setSelectedOrderIds([]);
    try {
      const { data, error } = await supabase.functions.invoke('shopify-proxy', {
        body: { action: 'fetch_unfulfilled_orders' },
      });

      if (error) throw error;

      const edges = data.data?.orders?.edges || [];
      const parsedOrders = [];

      for (const edge of edges) {
        const node = edge.node;
        const addr = node.shippingAddress || {};
        const foEdges = node.fulfillmentOrders?.edges || [];

        const activeFoNode = foEdges.find((f) => ['OPEN', 'IN_PROGRESS'].includes(f.node.status))?.node;
        if (!activeFoNode) continue;

        const shippingTitle = (node.shippingLine?.title || '').toLowerCase();
        const autoDetectedService = shippingTitle.includes('express') ? '3J55' : '3D55';

        const parsedItems = [];
        let totalUnfulfilled = 0;

        (activeFoNode.lineItems?.edges || []).forEach((itemEdge) => {
          const item = itemEdge.node;
          const remQty = item.remainingQuantity;

          if (remQty > 0) {
            totalUnfulfilled += remQty;
            const rawItem = item.lineItem || {};
            const weightObj = rawItem.variant?.inventoryItem?.measurement?.weight || {};

            parsedItems.push({
              fo_line_item_id: item.id,
              title: rawItem.title || 'Product',
              remaining_qty: remQty,
              unit_weight_kg: normalizeWeight(weightObj.value, weightObj.unit),
            });
          }
        });

        if (totalUnfulfilled > 0 && parsedItems.length > 0) {
          const orderDict = {
            'Order Name': node.name,
            'Order ID': node.id,
            'Fulfillment Order ID': activeFoNode.id,
            'Customer': addr.name || 'N/A',
            'Email': node.email || '',
            'Phone': addr.phone || node.phone || '',
            'Address': `${addr.address1 || ''}, ${addr.city || ''} ${addr.zip || ''}`.trim(),
            'Raw Address': addr,
            'Line Items': parsedItems,
          };

          await saveOrderToDb(orderDict);

          parsedOrders.push({
            saleId: node.id,
            orderName: node.name,
            fulfillmentOrderId: activeFoNode.id,
            customer: addr.name || 'N/A',
            email: node.email || '',
            phone: addr.phone || node.phone || '',
            detectedService: autoDetectedService,
            address: `${addr.address1 || ''}, ${addr.city || ''} ${addr.zip || ''}`.trim(),
            rawAddress: addr,
            lineItems: parsedItems,
          });
        }
      }

      setOrders(parsedOrders);
      await saveOrdersToCache(parsedOrders);
      setMsg({ type: 'success', text: `Fetched ${parsedOrders.length} unfulfilled orders from Shopify.` });
    } catch (err) {
      await logError('fetchShopifyOrders', err.message);
      setMsg({ type: 'error', text: err.message });
    }
    setLoading(false);
  };

  const filteredOrders = orders.filter((o) => {
    const term = searchTerm.toLowerCase();
    return o.orderName.toLowerCase().includes(term) || o.customer.toLowerCase().includes(term);
  });

  const queuedOrderIds = new Set(csvQueue.map((item) => item.order_data?.saleId).filter(Boolean));

  const handleSelectAllTab1 = () => {
    const unqueuedFiltered = filteredOrders.filter((o) => !queuedOrderIds.has(o.saleId));
    setSelectedOrderIds(unqueuedFiltered.map((o) => o.saleId));
  };

  const handleUnselectAllTab1 = () => setSelectedOrderIds([]);

  const toggleOrderSelectionTab1 = (saleId) => {
    if (queuedOrderIds.has(saleId)) return;
    setSelectedOrderIds((prev) =>
      prev.includes(saleId) ? prev.filter((id) => id !== saleId) : [...prev, saleId]
    );
  };

  const toggleOrderExpanded = (saleId) => {
    setExpandedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(saleId)) next.delete(saleId);
      else next.add(saleId);
      return next;
    });
  };

  // Sum of what's currently set to dispatch for this order -- reflects
  // any qty edits already made in itemQtysMap, falling back to each
  // line's remaining_qty for items not yet touched. Shown on the
  // collapsed card so the count updates live as quantities are edited,
  // even while collapsed.
  const totalDispatchQty = (order) =>
    order.lineItems.reduce((sum, item) => {
      const input = itemQtysMap[`${order.saleId}_${item.fo_line_item_id}`];
      const qty = input !== undefined ? parseInt(input) || 0 : item.remaining_qty;
      return sum + qty;
    }, 0);

  const buildQueueEntryForOrder = (order) => {
    const saleId = order.saleId;
    const itemsToDispatch = order.lineItems
      .map((item) => {
        const inputQty = itemQtysMap[`${saleId}_${item.fo_line_item_id}`];
        return {
          ...item,
          dispatch_qty: inputQty !== undefined ? parseInt(inputQty) : item.remaining_qty,
        };
      })
      .filter((i) => i.dispatch_qty > 0);

    if (itemsToDispatch.length === 0) return null;

    const calculatedWeight = itemsToDispatch.reduce((acc, i) => acc + i.dispatch_qty * i.unit_weight_kg, 0);
    const weight = Math.max(parseFloat(calculatedWeight).toFixed(2), 0.1);
    const autoDims = getAutoDimensionsFromWeight(weight);

    return {
      order_data: { ...order },
      selected_items: itemsToDispatch,
      service: order.detectedService || defaultService,
      weight: weight,
      length: autoDims.length,
      width: autoDims.width,
      height: autoDims.height,
      presetName: autoDims.presetName,
    };
  };

  const handleBulkQueueSelected = async () => {
    if (selectedOrderIds.length === 0) return setMsg({ type: 'error', text: 'No orders selected.' });

    const selectedOrders = orders.filter((o) => selectedOrderIds.includes(o.saleId));
    const newQueueEntries = [];

    for (const order of selectedOrders) {
      const entry = buildQueueEntryForOrder(order);
      if (entry) {
        newQueueEntries.push(entry);
      }
    }

    if (newQueueEntries.length === 0) return setMsg({ type: 'error', text: 'Selected orders have no valid items.' });

    const updatedQueue = [...csvQueue, ...newQueueEntries];
    await saveQueueToDb(updatedQueue);

    setSelectedOrderIds([]);
    setMsg({ type: 'success', text: `Added ${newQueueEntries.length} orders to CSV batch.` });
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
    setMsg({ type: 'success', text: 'Batch cleared. All orders returned to full view in Tab 1.' });
  };

  const handleFulfillSingleOrderDirect = async (order) => {
    const saleId = order.saleId;
    const trackingNo = trackingMap[saleId] || '';
    const carrier = carrierMap[saleId] || 'Australia Post';

    if (!trackingNo.trim()) return setMsg({ type: 'error', text: `Please enter tracking number for Order ${order.orderName}.` });

    setDispatchingMap((prev) => ({ ...prev, [saleId]: true }));
    setMsg(null);

    const itemsToDispatch = order.lineItems.map((item) => {
      const inputQty = itemQtysMap[`${saleId}_${item.fo_line_item_id}`];
      return {
        ...item,
        dispatch_qty: inputQty !== undefined ? parseInt(inputQty) : item.remaining_qty,
      };
    }).filter((i) => i.dispatch_qty > 0);

    try {
      const { data, error } = await supabase.functions.invoke('shopify-proxy', {
        body: {
          action: 'mark_fulfilled',
          fulfillmentOrderId: order.fulfillmentOrderId,
          lineItems: itemsToDispatch,
          trackingNumber: trackingNo.trim(),
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      // Check the actual local-logging result now, instead of trusting
      // it blindly -- Shopify's own fulfillment already succeeded by
      // this point (the throw above would have caught a Shopify-side
      // failure), so a false here means specifically "shipped fine, but
      // won't show in Completed Orders" -- worth telling the person
      // directly rather than showing an unqualified success either way.
      const loggedLocally = await saveShipmentToDb(
        order.orderName,
        '',
        trackingNo.trim(),
        carrier,
        '',
        '',
        itemsToDispatch,
        order
      );

      const remainingOrders = orders.filter((o) => o.saleId !== saleId);
      setOrders(remainingOrders);
      await saveOrdersToCache(remainingOrders);

      if (loggedLocally) {
        setMsg({ type: 'success', text: `Order ${order.orderName} fulfilled!` });
      } else {
        setMsg({
          type: 'error',
          text: `Order ${order.orderName} was fulfilled in Shopify, but could not be logged to Completed Orders here. Check error_logs for details -- the order itself is genuinely shipped, this only affects this app's own record of it.`,
        });
      }
      setSelectedOrderIds((prev) => prev.filter((id) => id !== saleId));
    } catch (err) {
      await logError('handleFulfillSingleOrderDirect', err.message);
      setMsg({ type: 'error', text: err.message });
    }

    setDispatchingMap((prev) => ({ ...prev, [saleId]: false }));
  };

  const handleQueueSingleOrder = async (order) => {
    const entry = buildQueueEntryForOrder(order);
    if (!entry) return setMsg({ type: 'error', text: 'Set item quantity above 0.' });

    const newQueue = [...csvQueue, entry];
    await saveQueueToDb(newQueue);

    setSelectedOrderIds((prev) => prev.filter((id) => id !== order.saleId));
    setMsg({ type: 'success', text: `Order ${order.orderName} added to CSV batch.` });
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
    const rows = [AUSPOST_CSV_COLUMNS.join(',')];

    selectedEntries.forEach((entry) => {
      const order = entry.order_data;
      const addr = order.rawAddress || {};

      const rowMap = {
        'Row type': 'S',
        'Sender account': senderAccount,
        'Payer account': payerAccount || senderAccount,
        'Recipient contact name': `"${order.customer}"`,
        'Recipient address line 1': `"${addr.address1 || ''}"`,
        'Recipient address line 2': `"${addr.address2 || ''}"`,
        'Recipient suburb': `"${addr.city || ''}"`,
        'Recipient state': `"${addr.provinceCode || ''}"`,
        'Recipient postcode': `"${addr.zip || ''}"`,
        'Send tracking email to recipient': order.email ? 'Yes' : 'No',
        'Recipient email address': order.email || '',
        'Recipient phone number': order.phone || '',
        'Sender reference 1 ': order.orderName,
        'Product id': entry.service,
        'Quantity': 1,
        'Weight': entry.weight,
        'Length': entry.length,
        'Width': entry.width,
        'Height': entry.height,
        'Parcel contents': ' ',
      };

      rows.push(AUSPOST_CSV_COLUMNS.map((col) => rowMap[col] || '').join(','));
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `auspost_shopify_${new Date().toISOString().slice(0, 10)}.csv`;
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
      setMsg({ type: 'success', text: `Extracted tracking numbers for ${parsed.length} orders.` });
    };
    reader.readAsText(file);
  };

  const handleExecuteShopifyFulfillment = async () => {
    if (importResults.length === 0) return;

    setImporting(true);
    let successCount = 0;
    const completedRefs = [];
    const loggingFailures = [];

    for (const item of importResults) {
      const queueMatch = csvQueue.find((q) => q.order_data.orderName === item.ref);
      if (!queueMatch) continue;

      try {
        const { data, error } = await supabase.functions.invoke('shopify-proxy', {
          body: {
            action: 'mark_fulfilled',
            fulfillmentOrderId: queueMatch.order_data.fulfillmentOrderId,
            lineItems: queueMatch.selected_items,
            trackingNumber: item.tracking,
            trackingUrl: item.url,
          },
        });

        if (!error && data?.success) {
          const loggedLocally = await saveShipmentToDb(
            queueMatch.order_data.orderName,
            '',
            item.tracking,
            queueMatch.service,
            '',
            '',
            queueMatch.selected_items,
            queueMatch.order_data
          );

          successCount++;
          completedRefs.push(item.ref);
          // Genuinely fulfilled in Shopify either way -- only note it
          // here if the local Completed Orders log specifically failed,
          // rather than silently losing that distinction the way this
          // used to (loggedLocally was never checked before).
          if (!loggedLocally) loggingFailures.push(item.ref);
        }
      } catch (e) {
        await logError('handleExecuteShopifyFulfillment', e.message);
      }
    }

    const remainingQueue = csvQueue.filter((q) => !completedRefs.includes(q.order_data.orderName));
    await saveQueueToDb(remainingQueue);

    const remainingOrders = orders.filter((o) => !completedRefs.includes(o.orderName));
    setOrders(remainingOrders);
    await saveOrdersToCache(remainingOrders);

    await fetchCompletedHistory();

    setMsg({
      type: loggingFailures.length ? 'error' : 'success',
      text: `Fulfillment Complete: ${successCount} orders fulfilled in Shopify.${
        loggingFailures.length
          ? ` ${loggingFailures.length} of these shipped fine but failed to log to Completed Orders (${loggingFailures.join(', ')}) -- check error_logs.`
          : ''
      }`,
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
            className="w-full bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 focus:bg-white"
          />
        </div>
        <div>
          <label className="block font-bold text-slate-700 mb-1">AusPost Payer Account</label>
          <input
            type="text"
            value={payerAccount}
            onChange={(e) => setPayerAccount(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 focus:bg-white"
          />
        </div>
        <div>
          <label className="block font-bold text-slate-700 mb-1">Default Service</label>
          <select
            value={defaultService}
            onChange={(e) => setDefaultService(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5"
          >
            {Object.entries(SERVICE_OPTIONS).map(([k, v]) => (
              <option key={v} value={v}>{k}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={fetchShopifyOrders}
            disabled={loading}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-3 rounded-md transition-colors cursor-pointer h-9"
          >
            {loading ? 'Fetching...' : '🔄 Fetch Shopify Orders'}
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex gap-1 flex-wrap">
        <button
          onClick={() => setActiveTab('select')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'select' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          1️⃣ Select Orders ({orders.length})
        </button>
        <button
          onClick={() => setActiveTab('export')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'export' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          2️⃣ Export CSV ({csvQueue.length})
        </button>
        <button
          onClick={() => setActiveTab('import')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'import' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
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

      {/* TAB 1: SELECT ORDERS */}
      {activeTab === 'select' && (
        <div className="space-y-3">
          {orders.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-3">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search Order Number or Customer..."
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 h-9"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSelectAllTab1}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-md border border-slate-300 cursor-pointer"
                  >
                    Select All ({filteredOrders.filter((o) => !queuedOrderIds.has(o.saleId)).length})
                  </button>
                  <button
                    onClick={handleUnselectAllTab1}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-md border border-slate-300 cursor-pointer"
                  >
                    Unselect All
                  </button>
                  <span className="text-slate-500 font-medium pl-2">
                    Selected: <strong className="text-blue-600">{selectedOrderIds.length}</strong> / {filteredOrders.length}
                  </span>
                </div>

                <button
                  onClick={handleBulkQueueSelected}
                  disabled={selectedOrderIds.length === 0}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-1.5 rounded-md cursor-pointer disabled:opacity-50"
                >
                  ➕ Add Selected ({selectedOrderIds.length}) to CSV Batch
                </button>
              </div>
            </div>
          )}

          {filteredOrders.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-400">
              No active Shopify orders in cache. Click "Fetch Shopify Orders" above.
            </div>
          ) : (
            filteredOrders.map((order) => {
              const saleId = order.saleId;
              const isQueued = queuedOrderIds.has(saleId);
              const isProcessing = dispatchingMap[saleId] || false;
              const isSelected = selectedOrderIds.includes(saleId);

              if (isQueued) {
                return (
                  <div
                    key={saleId}
                    className="bg-blue-50/50 border border-blue-200 rounded-xl p-3 shadow-xs flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="bg-blue-600 text-white font-bold px-2 py-0.5 rounded text-[10px]">
                        IN CSV BATCH
                      </span>
                      <div>
                        <span className="font-bold text-slate-900">{order.orderName}</span>
                        <span className="text-slate-500 ml-2">— {order.customer}</span>
                      </div>
                    </div>
                    <span className="text-slate-400 italic text-[11px]">
                      Queued in Tab 2
                    </span>
                  </div>
                );
              }

              const isExpanded = expandedOrderIds.has(saleId);
              const dispatchQty = totalDispatchQty(order);

              return (
                <div
                  key={saleId}
                  className={`bg-white border rounded-xl shadow-xs ${
                    isSelected ? 'border-blue-500 ring-1 ring-blue-500/20 bg-blue-50/20' : 'border-slate-200'
                  }`}
                >
                  <div
                    onClick={() => toggleOrderExpanded(saleId)}
                    className="p-5 flex justify-between items-center cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => { e.stopPropagation(); toggleOrderSelectionTab1(saleId); }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 text-blue-600 border-slate-300 rounded cursor-pointer"
                      />
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">{order.orderName} — {order.customer}</h3>
                        <p className="text-xs text-slate-500">{order.address}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md">
                        {dispatchQty} item{dispatchQty === 1 ? '' : 's'} to dispatch
                      </span>
                      <span className="text-slate-400 text-xs font-bold">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-5 pb-5 space-y-3 border-t border-slate-100 pt-3">
                      <div className="space-y-2">
                        {order.lineItems.map((item) => (
                          <div key={item.fo_line_item_id} className="flex justify-between items-center text-xs bg-slate-50 p-2 rounded border border-slate-200">
                            <span className="font-semibold text-slate-800">{item.title}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500">Remaining: {item.remaining_qty}</span>
                              <input
                                type="number"
                                min="0"
                                max={item.remaining_qty}
                                defaultValue={item.remaining_qty}
                                onChange={(e) => setItemQtysMap({ ...itemQtysMap, [`${saleId}_${item.fo_line_item_id}`]: e.target.value })}
                                className="w-16 text-xs bg-white border border-slate-300 rounded px-2 py-1 text-right"
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-2 border-t border-slate-100">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">Carrier</label>
                          <select
                            value={carrierMap[saleId] || 'Australia Post'}
                            onChange={(e) => setCarrierMap({ ...carrierMap, [saleId]: e.target.value })}
                            className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 h-9"
                          >
                            {CARRIERS.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">Tracking Number</label>
                          <input
                            type="text"
                            value={trackingMap[saleId] || ''}
                            onChange={(e) => setTrackingMap({ ...trackingMap, [saleId]: e.target.value })}
                            placeholder="Enter tracking number"
                            className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 h-9"
                          />
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleFulfillSingleOrderDirect(order)}
                            disabled={isProcessing}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-3 rounded-lg cursor-pointer disabled:opacity-50 h-9"
                          >
                            {isProcessing ? 'Processing...' : 'Complete Order'}
                          </button>

                          <button
                            onClick={() => handleQueueSingleOrder(order)}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-3 rounded-lg cursor-pointer h-9"
                          >
                            ➕ CSV Batch
                          </button>
                        </div>
                      </div>
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
                Selected: <strong className="text-blue-600">{selectedExportIndices.length}</strong> / {csvQueue.length}
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
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50"
              >
                ⬇️ Download Selected CSV ({selectedExportIndices.length})
              </button>
            </div>
          </div>

          {csvQueue.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No orders queued in batch. Select orders from Tab 1 and click "Add Selected to CSV Batch".
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

                    return (
                      <tr key={idx} className={`hover:bg-slate-50/80 ${isChecked ? 'bg-blue-50/30' : ''}`}>
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleExportSelection(idx)}
                            className="w-4 h-4 text-blue-600 border-slate-300 rounded cursor-pointer"
                          />
                        </td>

                        <td className="p-3 font-bold text-slate-900">{order.orderName}</td>

                        <td className="p-3">
                          <div className="font-semibold text-slate-800">{order.customer}</div>
                          <div className="text-[10px] text-slate-500 truncate max-w-[180px]">{order.address}</div>
                        </td>

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
            <button onClick={handleExecuteShopifyFulfillment} disabled={importing} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-4 rounded-lg h-9 cursor-pointer">
              {importing ? 'Fulfilling in Shopify...' : `✅ Fulfill ${importResults.length} Orders in Shopify`}
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
                  <td className="p-2">{new Date(i.shipped_date).toLocaleString()}</td>
                  <td className="p-2 font-bold text-blue-600">{i.orders?.order_number || 'N/A'}</td>
                  <td className="p-2">{i.orders?.customer || 'N/A'}</td>
                  <td className="p-2 font-mono">
                    <a href={`https://auspost.com.au/mypost/track/#/details/${i.tracking_number}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
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
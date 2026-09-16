import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { INTL_PRODUCT_ID, SENDER_ADDRESS, normaliseCountryCode, truncateField, buildAddressLines, LABEL_LAYOUT_A6 } from './Auspostconstants';

const CARRIERS = ['Australia Post', 'StarTrack', 'DHL', 'CouriersPlease', 'Other'];

const SERVICE_OPTIONS = {
  'Parcel Post (3D55)': '3D55',
  'Express Post (3J55)': '3J55',
  'International (PTI7)': 'PTI7',
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
  const [completedOrders, setCompletedOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [msg, setMsg] = useState(null);

  const [defaultService, setDefaultService] = useState('3D55');

  // --- Validate & Price (Tab 2) ---
  const [checkResults, setCheckResults] = useState({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [selectedForLabel, setSelectedForLabel] = useState([]);
  const [creatingLabels, setCreatingLabels] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const autoCheckedRef = useRef(new Set());

  // --- Create Label & Book Manifest (Tab 3) ---
  const [processState, setProcessState] = useState({});
  const [manifestBusy, setManifestBusy] = useState(false);
  const [orderReference, setOrderReference] = useState(`Order-${new Date().toISOString().slice(0, 10)}`);
  const [selectedManifestNumbers, setSelectedManifestNumbers] = useState([]);
  const [redownloadingFor, setRedownloadingFor] = useState(null);

  // --- Saved Manifests (Tab 4) ---
  const [manifests, setManifests] = useState([]);
  const [manifestsLoading, setManifestsLoading] = useState(false);
  const [manifestsError, setManifestsError] = useState(null);
  const [expandedManifestId, setExpandedManifestId] = useState(null);
  const [downloadingKey, setDownloadingKey] = useState(null);
  const [downloadError, setDownloadError] = useState({});

  // --- Tracking (Tab 5) ---
  const [trackingRows, setTrackingRows] = useState([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusResults, setStatusResults] = useState({});
  const [trackingSearchTerm, setTrackingSearchTerm] = useState('');

  const [carrierMap, setCarrierMap] = useState({});
  const [trackingMap, setTrackingMap] = useState({});
  const [dispatchingMap, setDispatchingMap] = useState({});
  const [itemQtysMap, setItemQtysMap] = useState({});

  useEffect(() => {
    loadCachedOrdersAndCheckAge();
    fetchQueueFromDb();
    fetchCompletedHistory();
  }, []);

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

    // International takes priority over the domestic auto-detection --
    // detectedService only ever distinguishes Parcel Post vs Express
    // Post, it has no concept of international. Same real field name
    // confirmed via shopify-proxy.ts's addressLines helper
    // (countryCodeV2), not a guess.
    const addr = order.rawAddress || {};
    const country = (addr.countryCodeV2 || '').trim().toUpperCase();
    const isInternational = country && country !== 'AU';

    return {
      order_data: { ...order },
      selected_items: itemsToDispatch,
      service: isInternational ? INTL_PRODUCT_ID : (order.detectedService || defaultService),
      weight: weight,
      length: autoDims.length,
      width: autoDims.width,
      height: autoDims.height,
      presetName: autoDims.presetName,
    };
  };

  // ===========================================================
  // TAB 2: Validate & Price
  // ===========================================================
  const handleCheckEntry = async (entry) => {
    const order = entry.order_data;
    const orderNumber = order.orderName;
    const addr = order.rawAddress || {};
    const isInternational = entry.service === INTL_PRODUCT_ID;

    setCheckResults((prev) => ({ ...prev, [orderNumber]: { ...(prev[orderNumber] || {}), checking: true } }));
    const result = { checking: false, addressValid: null, addressSuggestions: [], addressError: null, price: null, priceError: null };

    if (!isInternational) {
      try {
        const { data, error } = await supabase.functions.invoke('cin7-proxy', {
          body: {
            action: 'validate_auspost_suburb',
            auspostSuburb: addr.city || '',
            auspostState: addr.provinceCode || '',
            auspostPostcode: addr.zip || '',
          },
        });
        if (error) throw error;
        if (!data.success) throw new Error(data.error);
        result.addressValid = !!data.result?.found;
        result.addressSuggestions = data.result?.results || [];
      } catch (err) {
        result.addressError = err.message;
      }
    }

    try {
      const toAddress = isInternational
        ? { suburb: addr.city || '', state: addr.provinceCode || '', postcode: addr.zip || '', country: normaliseCountryCode(addr.countryCodeV2) }
        : { suburb: addr.city || '', state: addr.provinceCode || '', postcode: addr.zip || '' };

      const { data, error } = await supabase.functions.invoke('cin7-proxy', {
        body: {
          action: 'get_auspost_shipment_price',
          auspostShipments: [
            {
              from: SENDER_ADDRESS,
              to: toAddress,
              items: [
                {
                  product_id: entry.service,
                  length: String(entry.length),
                  width: String(entry.width),
                  height: String(entry.height),
                  weight: String(entry.weight),
                },
              ],
            },
          ],
        },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      const summary = data.result?.shipments?.[0]?.shipment_summary;
      result.price = summary?.total_cost ?? null;
    } catch (err) {
      result.priceError = err.message;
    }

    setCheckResults((prev) => ({ ...prev, [orderNumber]: result }));
  };

  const handleCheckAllQueued = async () => {
    if (csvQueue.length === 0) return;
    setCheckingAll(true);
    for (const entry of csvQueue) {
      await handleCheckEntry(entry);
      autoCheckedRef.current.add(entry.order_data.orderName);
    }
    setCheckingAll(false);
  };

  // Auto-check requirement: any order newly present in the queue gets
  // validated and priced automatically, without waiting for a manual
  // click. Only the genuinely new ones run -- already-checked entries
  // aren't silently re-checked on every render.
  useEffect(() => {
    const toCheck = csvQueue.filter((entry) => !autoCheckedRef.current.has(entry.order_data.orderName));
    if (toCheck.length === 0) return;
    (async () => {
      for (const entry of toCheck) {
        autoCheckedRef.current.add(entry.order_data.orderName);
        await handleCheckEntry(entry);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvQueue.length]);

  // ===========================================================
  // TAB 3: Create Label & Book Manifest
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

  // Routed through the server-side proxy rather than fetching the PDF
  // URL directly from the browser -- AusPost's signed label/asset URLs
  // can be blocked by CORS the same way Shopify's own CDN images are
  // (hence shopify-proxy.ts's own image proxy), and a server-to-server
  // request sidesteps that entirely.
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
  // (40/60/60), rather than sending raw untruncated Shopify data that
  // AusPost's API would silently cut off or reject. Same helper
  // already proven on the Pantone/DEAR side, just fed Shopify's own
  // field names (address1/address2/city/provinceCode/zip) instead.
  const buildSafeToAddress = (order, isInternational) => {
    const addr = order.rawAddress || {};
    const fullAddressText = [addr.address1, addr.address2].filter(Boolean).join(' ');
    const lines = buildAddressLines(fullAddressText);

    return {
      name: truncateField(order.customer || 'Customer'),
      business_name: addr.company ? truncateField(addr.company) : undefined,
      lines: lines.length ? lines : [truncateField(fullAddressText)],
      suburb: addr.city || '',
      state: addr.provinceCode || '',
      postcode: addr.zip || '',
      phone: order.phone || '',
      email: order.email || '',
      ...(isInternational ? { country: normaliseCountryCode(addr.countryCodeV2) } : {}),
    };
  };

  // Tab 2's "Create Label" action: creates the AusPost shipment, then
  // immediately creates its label (A6, unbranded-stationery-safe per
  // AusPost's real branding documentation -- branded:true since this
  // business doesn't use AusPost's pre-printed stock), then forces a
  // real download of the label PDF. Only processes entries that don't
  // already have a shipment -- safe to re-run on a partially-completed
  // batch.
  const handleCreateShipmentAndLabel = async (entries) => {
    for (const entry of entries) {
      const order = entry.order_data;
      const orderNumber = order.orderName;
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
              // Real confirmed field name: customer_reference_1 -- what
              // "Sender reference 1" in the old CSV template
              // corresponds to in the JSON API.
              customer_reference_1: truncateField(orderNumber, 50),
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
          // THERMAL-LABEL-A6-1PP -- confirmed real value for Parcel
          // Post/Express Post/International specifically (StarTrack/On
          // Demand use a different bare "A6-1pp" naming).
          labelLayout: LABEL_LAYOUT_A6,
          // true -- confirmed via AusPost's real branding docs: needed
          // specifically when NOT using purchased AusPost stationery.
          labelBranded: true,
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
  // request_id (Get Label), rather than assuming the original URL is
  // still valid.
  const handleRedownloadLabel = async (entry) => {
    const order = entry.order_data;
    const orderNumber = order.orderName;
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

  // Bulk-safe queue removal -- computes the full removal against one
  // snapshot of csvQueue in a single update, rather than looping the
  // single-item handleRemoveFromQueue (which would see a stale
  // csvQueue between calls, since React state updates aren't
  // synchronous/immediate within a loop).
  const handleRemoveMultipleFromQueue = async (orderNumbers) => {
    if (orderNumbers.length === 0) return;
    const updatedQueue = csvQueue.filter((e) => !orderNumbers.includes(e.order_data.orderName));
    await saveQueueToDb(updatedQueue);
    setMsg({ type: 'success', text: `${orderNumbers.length} order(s) sent back to Tab 1.` });
  };

  // Tab 3's "Delete Shipment": deletes the real AusPost shipment
  // (removes the label with it -- AusPost has no separate "delete
  // label" call), then clears local process state, then removes the
  // order from csvQueue entirely -- which is what makes it reappear
  // in Tab 1.
  const handleDeleteShipment = async (entries) => {
    const successfullyDeleted = [];
    for (const entry of entries) {
      const order = entry.order_data;
      const orderNumber = order.orderName;
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
    if (successfullyDeleted.length > 0) await handleRemoveMultipleFromQueue(successfullyDeleted);
  };

  // Tab 3's "Create Manifest": books the manifest (seals every ready
  // shipment into one real AusPost order), downloads the real order
  // summary PDF, then updates Shopify for each shipment via
  // mark_fulfilled (matching exactly the same pattern already proven
  // in the original CSV/Import Tracking flow), then removes completed
  // entries from the active batch.
  const handleCreateManifestAndComplete = async (entries, orderReferenceValue) => {
    const readyEntries = entries.filter((entry) => {
      const orderNumber = entry.order_data.orderName;
      const s = getProcessState(orderNumber);
      return s.shipmentId && s.labelRequestId && !s.orderId;
    });
    if (readyEntries.length === 0) return;

    try {
      const shipmentIds = readyEntries.map((entry) => getProcessState(entry.order_data.orderName).shipmentId);
      const labelRequestIds = {};
      const labelUrls = {};
      const customerNames = {};
      readyEntries.forEach((entry) => {
        const orderNumber = entry.order_data.orderName;
        const s = getProcessState(orderNumber);
        labelRequestIds[s.shipmentId] = s.labelRequestId;
        labelUrls[s.shipmentId] = s.labelUrl;
        customerNames[s.shipmentId] = entry.order_data.customer || null;
      });

      const orderData = await callAusPostAction({
        action: 'create_auspost_order',
        auspostShipmentIds: shipmentIds,
        auspostOrderReference: orderReferenceValue,
        auspostLabelRequestIds: labelRequestIds,
        auspostLabelUrls: labelUrls,
        auspostCustomerNames: customerNames,
      });
      const orderId = orderData.result?.order?.order_id || null;

      readyEntries.forEach((entry) => {
        updateProcessState(entry.order_data.orderName, { stage: 'booked', orderId, error: null });
      });

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

      const loggingFailures = [];
      for (const entry of readyEntries) {
        const order = entry.order_data;
        const orderNumber = order.orderName;
        const s = getProcessState(orderNumber);
        try {
          const trackUrl = `https://auspost.com.au/mypost/track/#/details/${s.trackingNumber}`;
          const { data, error } = await supabase.functions.invoke('shopify-proxy', {
            body: {
              action: 'mark_fulfilled',
              fulfillmentOrderId: order.fulfillmentOrderId,
              lineItems: entry.selected_items,
              trackingNumber: s.trackingNumber,
              trackingUrl: trackUrl,
            },
          });
          if (error) throw error;
          if (!data?.success) throw new Error(data?.error || 'Unknown error');

          const loggedLocally = await saveShipmentToDb(
            orderNumber, '', s.trackingNumber, entry.service, '', '', entry.selected_items, order
          );
          updateProcessState(orderNumber, {
            stage: 'complete',
            shopifyUpdated: true,
            error: loggedLocally ? null : 'Shipped fine, but failed to log to Completed Orders.',
          });
        } catch (err) {
          loggingFailures.push(orderNumber);
          updateProcessState(orderNumber, { stage: 'error', error: `Shopify update failed: ${err.message}` });
        }
      }

      const completedNumbers = readyEntries
        .map((entry) => entry.order_data.orderName)
        .filter((n) => !loggingFailures.includes(n));
      const remainingQueue = csvQueue.filter((e) => !completedNumbers.includes(e.order_data.orderName));
      await saveQueueToDb(remainingQueue);

      setMsg({
        type: loggingFailures.length ? 'error' : 'success',
        text: loggingFailures.length
          ? `Manifest booked, but Shopify update failed for: ${loggingFailures.join(', ')}.`
          : `Manifest booked and Shopify updated for ${completedNumbers.length} order(s).`,
      });
    } catch (err) {
      readyEntries.forEach((entry) => {
        updateProcessState(entry.order_data.orderName, { stage: 'error', error: `Manifest booking failed: ${err.message}` });
      });
    }
  };

  // ===========================================================
  // TAB 4: Saved Manifests
  // ===========================================================
  const loadManifests = async () => {
    setManifestsLoading(true);
    setManifestsError(null);
    try {
      const { data, error } = await supabase.functions.invoke('cin7-proxy', { body: { action: 'list_auspost_manifests' } });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      setManifests(data.manifests || []);
    } catch (err) {
      setManifestsError(err.message);
    }
    setManifestsLoading(false);
  };

  const handleDownloadLabel = async (orderId, shipmentId) => {
    const key = `${orderId}_${shipmentId}`;
    setDownloadingKey(key);
    setDownloadError((prev) => ({ ...prev, [key]: null }));
    try {
      const { data, error } = await supabase.functions.invoke('cin7-proxy', {
        body: { action: 'get_auspost_manifest_label', auspostOrderId: orderId, auspostShipmentId: shipmentId },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      window.open(data.url, '_blank');
    } catch (err) {
      setDownloadError((prev) => ({ ...prev, [key]: err.message }));
    }
    setDownloadingKey(null);
  };

  // ===========================================================
  // TAB 5: Tracking
  // ===========================================================
  const loadTrackingRows = async () => {
    setTrackingLoading(true);
    setTrackingError(null);
    try {
      const { data, error } = await supabase.functions.invoke('cin7-proxy', { body: { action: 'list_auspost_manifests' } });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      const flattened = [];
      (data.manifests || []).forEach((m) => {
        (m.shipments || []).forEach((s) => {
          if (s.tracking_number) {
            flattened.push({ orderReference: s.shipment_reference || '—', customerName: s.customer_name || '—', trackingNumber: s.tracking_number, bookedAt: m.created_at });
          }
        });
      });
      setTrackingRows(flattened);
    } catch (err) {
      setTrackingError(err.message);
    }
    setTrackingLoading(false);
  };

  const visibleTrackingRows = trackingRows.filter((r) => {
    if (!trackingSearchTerm.trim()) return true;
    const q = trackingSearchTerm.toLowerCase();
    return (
      r.orderReference.toLowerCase().includes(q) ||
      r.trackingNumber.toLowerCase().includes(q) ||
      (r.customerName || '').toLowerCase().includes(q)
    );
  });

  const handleCheckTrackingStatus = async () => {
    if (visibleTrackingRows.length === 0) return;
    setCheckingStatus(true);

    for (let i = 0; i < visibleTrackingRows.length; i += 10) {
      const batch = visibleTrackingRows.slice(i, i + 10);
      try {
        const { data, error } = await supabase.functions.invoke('cin7-proxy', {
          body: { action: 'track_auspost_items', auspostTrackingIds: batch.map((r) => r.trackingNumber) },
        });
        if (error) throw error;
        if (!data.success) throw new Error(data.error);

        const newResults = {};
        (data.result?.tracking_results || []).forEach((tr) => {
          const status = tr.status || tr.consignment?.status || tr.trackable_items?.[0]?.status || (tr.errors?.length ? `Error: ${tr.errors[0].name}` : 'Unknown');
          newResults[tr.tracking_id] = status;
        });
        setStatusResults((prev) => ({ ...prev, ...newResults }));
      } catch (err) {
        const failedResults = {};
        batch.forEach((r) => { failedResults[r.trackingNumber] = `Check failed: ${err.message}`; });
        setStatusResults((prev) => ({ ...prev, ...failedResults }));
      }
      if (i + 10 < visibleTrackingRows.length) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    setCheckingStatus(false);
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
    setMsg({ type: 'success', text: `Added ${newQueueEntries.length} orders to the batch.` });
  };

  const handleRemoveFromQueue = async (indexToRemove) => {
    const itemToRemove = csvQueue[indexToRemove];
    if (!itemToRemove) return;

    const updatedQueue = csvQueue.filter((_, idx) => idx !== indexToRemove);
    await saveQueueToDb(updatedQueue);
  };

  const handleClearBatch = async () => {
    if (csvQueue.length === 0) return;
    await saveQueueToDb([]);
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
    setMsg({ type: 'success', text: `Order ${order.orderName} added to the batch.` });
  };

  const handleUpdateQueueItem = (index, updatedFields) => {
    const updatedQueue = [...csvQueue];
    updatedQueue[index] = { ...updatedQueue[index], ...updatedFields };
    saveQueueToDb(updatedQueue);
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
          onClick={() => setActiveTab('validate')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'validate' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          2️⃣ Validate & Price ({csvQueue.length})
        </button>
        <button
          onClick={() => setActiveTab('manifest')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'manifest' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          3️⃣ Create Label & Book Manifest
        </button>
        <button
          onClick={() => { setActiveTab('manifests'); loadManifests(); }}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'manifests' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          4️⃣ Saved Manifests
        </button>
        <button
          onClick={() => { setActiveTab('tracking'); loadTrackingRows(); }}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            activeTab === 'tracking' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
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
                  ➕ Add Selected ({selectedOrderIds.length}) to Batch
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
                        IN BATCH
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
                            ➕ Add to Batch
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

      {/* TAB 2: VALIDATE & PRICE */}
      {activeTab === 'validate' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          {csvQueue.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No orders queued. Select orders from Tab 1 and click "Add Selected to Batch".
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-700">{csvQueue.length} order(s) in batch</span>
                  <button
                    onClick={() => setSelectedForLabel(csvQueue.map((e) => e.order_data.orderName))}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setSelectedForLabel([])}
                    className="text-[11px] font-bold text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    Unselect All
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCheckAllQueued}
                    disabled={checkingAll}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {checkingAll ? 'Checking...' : '✅ Re-check All'}
                  </button>
                  <button
                    onClick={async () => {
                      const eligible = selectedForLabel.filter((n) => !processState[n]?.shipmentId);
                      if (eligible.length === 0) return;
                      if (!window.confirm(`Send ${eligible.length} order(s) back to Tab 1?`)) return;
                      setSendingBack(true);
                      await handleRemoveMultipleFromQueue(eligible);
                      setSelectedForLabel((prev) => prev.filter((n) => !eligible.includes(n)));
                      setSendingBack(false);
                    }}
                    disabled={sendingBack || selectedForLabel.length === 0}
                    className="bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50 border border-slate-300"
                  >
                    {sendingBack ? 'Sending...' : `↩️ Send Back to Tab 1 (${selectedForLabel.length})`}
                  </button>
                  <button
                    onClick={async () => {
                      const entries = csvQueue.filter((e) => selectedForLabel.includes(e.order_data.orderName));
                      if (entries.length === 0) return;
                      setCreatingLabels(true);
                      await handleCreateShipmentAndLabel(entries);
                      setCreatingLabels(false);
                    }}
                    disabled={creatingLabels || selectedForLabel.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {creatingLabels ? 'Creating...' : `📦 Create Label (${selectedForLabel.length})`}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
                      <th className="p-3 w-8"></th>
                      <th className="p-3">Order Number</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3">Address</th>
                      <th className="p-3">Service</th>
                      <th className="p-3">L × W × H (cm)</th>
                      <th className="p-3">Weight (kg)</th>
                      <th className="p-3">Address Check</th>
                      <th className="p-3">Price</th>
                      <th className="p-3 text-center">Label Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {csvQueue.map((entry, idx) => {
                      const order = entry.order_data;
                      const orderNumber = order.orderName;
                      const addr = order.rawAddress || {};
                      const check = checkResults[orderNumber];
                      const isInternational = entry.service === INTL_PRODUCT_ID;
                      const alreadyCreated = !!processState[orderNumber]?.shipmentId;

                      return (
                        <tr key={idx} className="hover:bg-slate-50/80">
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={selectedForLabel.includes(orderNumber)}
                              onChange={() => setSelectedForLabel((prev) => (prev.includes(orderNumber) ? prev.filter((n) => n !== orderNumber) : [...prev, orderNumber]))}
                              disabled={alreadyCreated}
                            />
                          </td>
                          <td className="p-3 font-bold text-slate-900">{orderNumber}</td>
                          <td className="p-3 text-slate-700">{order.customer || '—'}</td>
                          <td className="p-3 text-slate-600">
                            {addr.address1 || ''}, {addr.city || ''} {addr.provinceCode || ''} {addr.zip || ''}
                          </td>
                          <td className="p-3">
                            <select
                              value={entry.service}
                              onChange={(e) => { handleUpdateQueueItem(idx, { service: e.target.value }); autoCheckedRef.current.delete(orderNumber); }}
                              className="text-xs bg-white border border-slate-300 rounded px-2 py-1"
                            >
                              {Object.entries(SERVICE_OPTIONS).map(([k, v]) => (
                                <option key={v} value={v}>{k}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.1"
                                value={entry.length}
                                onChange={(e) => { handleUpdateQueueItem(idx, { length: parseFloat(e.target.value) || 0, presetName: 'Custom / Manual' }); autoCheckedRef.current.delete(orderNumber); }}
                                className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                              />
                              <span className="text-slate-400">×</span>
                              <input
                                type="number"
                                step="0.1"
                                value={entry.width}
                                onChange={(e) => { handleUpdateQueueItem(idx, { width: parseFloat(e.target.value) || 0, presetName: 'Custom / Manual' }); autoCheckedRef.current.delete(orderNumber); }}
                                className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                              />
                              <span className="text-slate-400">×</span>
                              <input
                                type="number"
                                step="0.1"
                                value={entry.height}
                                onChange={(e) => { handleUpdateQueueItem(idx, { height: parseFloat(e.target.value) || 0, presetName: 'Custom / Manual' }); autoCheckedRef.current.delete(orderNumber); }}
                                className="w-12 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                              />
                            </div>
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              step="0.01"
                              value={entry.weight}
                              onChange={(e) => { handleUpdateQueueItem(idx, { weight: parseFloat(e.target.value) || 0 }); autoCheckedRef.current.delete(orderNumber); }}
                              className="w-16 text-xs bg-white border border-slate-300 rounded px-1.5 py-1 text-center"
                            />
                          </td>
                          <td className="p-3">
                            {!check && <span className="text-slate-400">Checking...</span>}
                            {check?.checking && <span className="text-slate-400">Checking...</span>}
                            {check && !check.checking && isInternational && (
                              <span className="text-slate-400">N/A (international)</span>
                            )}
                            {check && !check.checking && !isInternational && check.addressError && (
                              <span className="text-red-600 font-bold" title={check.addressError}>⚠️ Error</span>
                            )}
                            {check && !check.checking && !isInternational && !check.addressError && check.addressValid && (
                              <span className="text-emerald-600 font-bold">✅ Valid</span>
                            )}
                            {check && !check.checking && !isInternational && !check.addressError && check.addressValid === false && (
                              <div>
                                <span className="text-red-600 font-bold">❌ Wrong suburb</span>
                                {check.addressSuggestions.length > 0 ? (
                                  <select
                                    defaultValue=""
                                    onChange={(e) => {
                                      const correctedSuburb = e.target.value;
                                      if (!correctedSuburb) return;
                                      handleUpdateQueueItem(idx, {
                                        order_data: {
                                          ...order,
                                          rawAddress: { ...(order.rawAddress || {}), city: correctedSuburb },
                                        },
                                      });
                                      autoCheckedRef.current.delete(orderNumber);
                                    }}
                                    className="mt-1 text-[10px] bg-white border border-slate-300 rounded px-1.5 py-1 w-full"
                                  >
                                    <option value="" disabled>Select correct suburb...</option>
                                    {check.addressSuggestions.slice(0, 8).map((s) => (
                                      <option key={s} value={s}>{s}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="text-[10px] text-slate-500 mt-0.5">No suggestions available -- check the postcode.</div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            {check?.priceError && <span className="text-red-600 font-bold" title={check.priceError}>⚠️ Error</span>}
                            {check && !check.checking && check.price != null && (
                              <span className="font-bold text-slate-900">${Number(check.price).toFixed(2)}</span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {(() => {
                              const s = processState[orderNumber] || {};
                              if (s.error) return <span className="text-red-600 font-bold text-[11px]" title={s.error}>⚠️ Failed -- hover for details</span>;
                              if (s.stage === 'creating_shipment') return <span className="text-slate-400 text-[11px]">Creating shipment...</span>;
                              if (s.stage === 'creating_label') return <span className="text-slate-400 text-[11px]">Creating label...</span>;
                              if (alreadyCreated) return <span className="text-emerald-600 font-bold text-[11px]">✅ Label created</span>;
                              return <span className="text-slate-400 text-[11px]">Not yet</span>;
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: CREATE LABEL & BOOK MANIFEST */}
      {activeTab === 'manifest' && (() => {
        const orderNumberOf = (entry) => entry.order_data.orderName;
        const readyQueue = csvQueue.filter((entry) => !!processState[orderNumberOf(entry)]?.shipmentId);

        if (readyQueue.length === 0) {
          return (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-400 shadow-xs">
              No labelled shipments yet. Create labels for orders in Tab 2 first.
            </div>
          );
        }

        const stageLabel = (stage) => {
          switch (stage) {
            case 'shipment_created': return { text: 'Shipment created', color: 'text-slate-600' };
            case 'label_created': return { text: '✅ Label ready', color: 'text-emerald-600' };
            case 'booked': return { text: '✅ Manifest booked', color: 'text-emerald-600' };
            case 'complete': return { text: '✅ Complete -- Shopify updated', color: 'text-emerald-700 font-bold' };
            case 'error': return { text: '⚠️ Error', color: 'text-red-600 font-bold' };
            default: return { text: stage || '—', color: 'text-slate-500' };
          }
        };

        return (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700">{readyQueue.length} labelled order(s)</span>
                <button onClick={() => setSelectedManifestNumbers(readyQueue.map(orderNumberOf))} className="text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer">Select All</button>
                <button onClick={() => setSelectedManifestNumbers([])} className="text-[11px] font-bold text-slate-500 hover:text-slate-700 cursor-pointer">Unselect All</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={orderReference}
                  onChange={(e) => setOrderReference(e.target.value)}
                  placeholder="Manifest reference"
                  className="text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 w-44"
                />
                <button
                  onClick={async () => {
                    const entries = readyQueue.filter((entry) => selectedManifestNumbers.includes(orderNumberOf(entry)));
                    if (entries.length === 0) return;
                    if (!window.confirm(`Delete ${entries.length} shipment(s) and their labels? This returns the order(s) to Tab 1.`)) return;
                    setManifestBusy(true);
                    await handleDeleteShipment(entries);
                    setSelectedManifestNumbers([]);
                    setManifestBusy(false);
                  }}
                  disabled={manifestBusy || selectedManifestNumbers.length === 0}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2 px-3 rounded-md cursor-pointer disabled:opacity-50"
                >
                  🗑️ Delete Shipment ({selectedManifestNumbers.length})
                </button>
                <button
                  onClick={async () => {
                    const entries = readyQueue.filter((entry) => selectedManifestNumbers.includes(orderNumberOf(entry)));
                    if (entries.length === 0) return;
                    setManifestBusy(true);
                    await handleCreateManifestAndComplete(entries, orderReference);
                    setSelectedManifestNumbers([]);
                    setManifestBusy(false);
                  }}
                  disabled={manifestBusy || selectedManifestNumbers.length === 0}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {manifestBusy ? 'Working...' : `📮 Create Manifest (${selectedManifestNumbers.length})`}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
                    <th className="p-3 w-8"></th>
                    <th className="p-3">Order Number</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Service</th>
                    <th className="p-3">Tracking Number</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {readyQueue.map((entry, idx) => {
                    const orderNumber = orderNumberOf(entry);
                    const s = processState[orderNumber] || {};
                    const label = stageLabel(s.stage);
                    const alreadyBooked = !!s.orderId;

                    return (
                      <tr key={idx} className="hover:bg-slate-50/80">
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selectedManifestNumbers.includes(orderNumber)}
                            onChange={() => setSelectedManifestNumbers((prev) => (prev.includes(orderNumber) ? prev.filter((n) => n !== orderNumber) : [...prev, orderNumber]))}
                            disabled={alreadyBooked}
                          />
                        </td>
                        <td className="p-3">
                          <button
                            onClick={async () => { setRedownloadingFor(orderNumber); await handleRedownloadLabel(entry); setRedownloadingFor(null); }}
                            disabled={redownloadingFor === orderNumber || !s.labelRequestId}
                            className="font-bold text-blue-600 hover:text-blue-800 cursor-pointer disabled:opacity-50 disabled:text-slate-400"
                            title="Click to re-download this order's label"
                          >
                            {redownloadingFor === orderNumber ? 'Downloading...' : orderNumber}
                          </button>
                        </td>
                        <td className="p-3 text-slate-700">{entry.order_data.customer || '—'}</td>
                        <td className="p-3 text-slate-600">{entry.service}</td>
                        <td className="p-3 font-mono text-slate-600">{s.trackingNumber || '—'}</td>
                        <td className="p-3">
                          <span className={label.color} title={s.error || ''}>{label.text}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* TAB 4: SAVED MANIFESTS */}
      {activeTab === 'manifests' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">Saved Manifests {manifests.length ? `(${manifests.length})` : ''}</span>
            <button
              onClick={loadManifests}
              disabled={manifestsLoading}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-1.5 px-3 rounded-md cursor-pointer disabled:opacity-50"
            >
              {manifestsLoading ? 'Loading...' : '🔄 Refresh'}
            </button>
          </div>

          {manifestsError && (
            <div className="m-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-md">
              Couldn't load manifests: {manifestsError}
            </div>
          )}

          {!manifestsError && !manifestsLoading && manifests.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-400">
              No manifests booked yet. They'll appear here automatically once you book one in Tab 3.
            </div>
          )}

          <div className="divide-y divide-slate-100">
            {manifests.map((m) => {
              const isExpanded = expandedManifestId === m.order_id;
              return (
                <div key={m.order_id}>
                  <button
                    onClick={() => setExpandedManifestId(isExpanded ? null : m.order_id)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900">
                        {m.order_id} {m.order_reference ? `· ${m.order_reference}` : ''}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {m.created_at ? new Date(m.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'} · {m.number_of_shipments ?? '—'} shipment(s), {m.number_of_items ?? '—'} item(s)
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-bold text-slate-900">{m.total_cost == null ? '—' : `$${Number(m.total_cost).toFixed(2)}`}</span>
                      <span className="text-slate-400 text-xs font-bold">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4">
                      <table className="w-full text-left text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-y border-slate-200 text-slate-600 font-bold">
                            <th className="p-2">Order Reference</th>
                            <th className="p-2">Shipment ID</th>
                            <th className="p-2 text-center">Label</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(m.shipments || []).map((s) => {
                            const key = `${m.order_id}_${s.shipment_id}`;
                            return (
                              <tr key={s.shipment_id}>
                                <td className="p-2 font-semibold text-slate-800">{s.shipment_reference || '—'}</td>
                                <td className="p-2 font-mono text-slate-500">{s.shipment_id}</td>
                                <td className="p-2 text-center">
                                  {s.label_storage_path ? (
                                    <>
                                      <button
                                        onClick={() => handleDownloadLabel(m.order_id, s.shipment_id)}
                                        disabled={downloadingKey === key}
                                        className="text-blue-600 hover:text-blue-800 font-bold cursor-pointer disabled:opacity-50"
                                      >
                                        {downloadingKey === key ? '...' : '📄 Download'}
                                      </button>
                                      {downloadError[key] && <div className="text-red-600 mt-0.5">{downloadError[key]}</div>}
                                    </>
                                  ) : (
                                    <span className="text-slate-400">Expired (48hr limit)</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 5: TRACKING */}
      {activeTab === 'tracking' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700">Tracking {trackingRows.length ? `(${trackingRows.length})` : ''}</span>
            <div className="flex items-center gap-2">
              <input
                value={trackingSearchTerm}
                onChange={(e) => setTrackingSearchTerm(e.target.value)}
                placeholder="Search order or tracking #"
                className="text-[11px] bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 w-52"
              />
              <button
                onClick={loadTrackingRows}
                disabled={trackingLoading}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-1.5 px-3 rounded-md cursor-pointer disabled:opacity-50"
              >
                {trackingLoading ? 'Loading...' : '🔄 Refresh'}
              </button>
              <button
                onClick={handleCheckTrackingStatus}
                disabled={checkingStatus || visibleTrackingRows.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-1.5 px-3 rounded-md cursor-pointer disabled:opacity-50"
              >
                {checkingStatus ? 'Checking...' : `📍 Check Status (${visibleTrackingRows.length})`}
              </button>
            </div>
          </div>

          {trackingError && (
            <div className="m-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-md">
              Couldn't load tracking data: {trackingError}
            </div>
          )}

          {!trackingError && !trackingLoading && trackingRows.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-400">
              No tracked shipments yet. They'll appear here automatically once a manifest is booked in Tab 3.
            </div>
          )}

          {trackingRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
                    <th className="p-3">Order Number</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Tracking Number</th>
                    <th className="p-3">Booked</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {visibleTrackingRows.map((r) => {
                    const status = statusResults[r.trackingNumber];
                    const color = !status ? 'text-slate-400' : status.toLowerCase().includes('delivered') ? 'text-emerald-600 font-bold' : status.toLowerCase().includes('error') ? 'text-red-600 font-bold' : 'text-slate-700 font-semibold';
                    return (
                      <tr key={r.trackingNumber} className="hover:bg-slate-50/80">
                        <td className="p-3 font-bold text-slate-900">{r.orderReference}</td>
                        <td className="p-3 text-slate-700">{r.customerName}</td>
                        <td className="p-3 font-mono text-slate-600">{r.trackingNumber}</td>
                        <td className="p-3 text-slate-500">{r.bookedAt ? new Date(r.bookedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                        <td className={`p-3 ${color}`}>{status || 'Not checked'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
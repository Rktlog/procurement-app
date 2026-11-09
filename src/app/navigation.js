import {
  ClipboardList, Search, AlertTriangle, CalendarRange, SlidersHorizontal,
  Palette, ShoppingBag, FileText, Users, Package, Truck, Receipt, ShieldCheck,
  Warehouse, ShoppingCart, PackagePlus, Handshake, Sparkles,Mail,
  Inbox,
} from 'lucide-react';

// Single source of truth for every page in the app. The sidebar, the home
// screen, page headers and route permission checks all read from here, so a
// new page only needs adding in two places: this list and the <Routes> in
// App.jsx.
//
// `appId` matches the ids returned by the get_my_assigned_apps RPC.
// `masterOnly` modules are shown to master admins only.
export const MODULES = [
  {
    appId: 'product_search',
    title: 'Product search',
    summary: 'Look up a product: stock, prices and when more is coming.',
    icon: Search,
    pages: [
      {
        path: '/procurement/search',
        label: 'Product search',
        description: 'Look up a SKU or item name for stock on hand and sales history.',
        icon: Search,
      },
    ],
  },
  {
    appId: 'procurement',
    title: 'Procurement',
    summary: 'Purchase orders, stock lookups and what to reorder next.',
    icon: Package,
    pages: [
      {
        path: '/procurement/reorder',
        label: 'Reorder & POs',
        description: 'Review staged items, pick a supplier and send the purchase order to Cin7.',
        icon: ClipboardList,
        showsStagedCount: true,
        platforms: ['cin7'], // POs are created in DEAR/Cin7
      },
      {
        path: '/procurement/purchase-orders',
        label: 'Purchase orders',
        description: 'Every active purchase order from DEAR: expected delivery, missing invoices, what is waiting for delivery, and the value of each invoice.',
        icon: Receipt,
        platforms: ['cin7'], // read from DEAR/Cin7
      },
      {
        path: '/procurement/urgent',
        label: 'Urgent orders',
        description: 'Approved sales that are short on stock right now.',
        icon: AlertTriangle,
      },
      {
        path: '/procurement/longterm',
        label: 'Long-term orders',
        description: 'Six-month demand forecast with supplier lead-time buffer.',
        icon: CalendarRange,
      },
      {
        path: '/procurement/settings',
        label: 'Supplier lead time',
        description: 'Set how long each supplier takes to deliver, so reorders land before stock runs out.',
        icon: SlidersHorizontal,
      },
    ],
  },
  {
    appId: 'preorders',
    title: 'Pre-orders',
    summary: 'What Seaga customers have asked to pre-order, added up by product.',
    icon: ShoppingCart,
    pages: [
      {
        path: '/preorders/list',
        label: 'Customer pre-orders',
        description: 'Products customers want to pre-order, against stock and what is already coming, so you can place the order.',
        icon: ShoppingCart,
        platforms: ['cin7'],
      },
    ],
  },
  {
    appId: 'assistant',
    title: 'Product assistant',
    summary: 'Ask about stock, prices, incoming dates and what sold, in plain English.',
    icon: Sparkles,
    pages: [
      {
        path: '/assistant/chat',
        label: 'Product assistant',
        description: 'Ask about stock, list prices, when stock is coming in and what sold recently. It only looks things up.',
        icon: Sparkles,
        platforms: ['cin7'],
      },
    ],
  },
  {
    appId: 'wms',
    title: 'WMS',
    summary: 'Orders, purchasing and receiving stock into Shopify.',
    icon: Warehouse,
    pages: [
      {
        path: '/wms/orders',
        label: 'Orders',
        description: 'Every Shopify order with all its details: items, customer, payment, fulfilment and history.',
        icon: ShoppingCart,
        platforms: ['shopify'],
      },
      {
        path: '/wms/purchases',
        label: 'Purchases',
        description: 'Create purchase orders. Receiving one adds the stock straight to Shopify.',
        icon: PackagePlus,
        platforms: ['shopify'],
      },
      {
        path: '/wms/dropship',
        label: 'Dropship',
        description: 'Orders your suppliers ship straight to the customer: emailed automatically, completed in Shopify when they reply with tracking.',
        icon: Handshake,
        platforms: ['shopify'],
      },
      {
        path: '/wms/assistant',
        label: 'Assistant',
        description: 'Ask about orders, stock and suppliers in plain English. It can look things up in Shopify and Gmail and write email drafts for you to send.',
        icon: Sparkles,
        platforms: ['shopify'],
      },
    ],
  },
  {
    appId: 'inbox',
    title: 'Operations inbox',
    summary: 'Supplier and forwarder email, sorted for you, with replies written for you to check.',
    icon: Mail,
    pages: [
      {
        path: '/inbox/mail',
        label: 'Operations inbox',
        description: 'Email from suppliers and forwarders. I say what needs a reply, write it for you and build your morning to-do. Nothing is sent until you press Send.',
        icon: Inbox,
        platforms: ['cin7'],
      },
    ],
  },
  {
    appId: 'sales_inbox',
    title: 'Sales inbox',
    summary: 'Customer email from the sales mailbox, sorted, with suggested replies.',
    icon: Users,
    pages: [
      {
        path: '/sales-inbox/mail',
        label: 'Sales inbox',
        description: 'Customer email from the sales mailbox. System notices are set aside, questions get a suggested reply from our stock and prices, and nothing is sent unless an admin switches sending on.',
        icon: Inbox,
        platforms: ['cin7'],
      },
    ],
  },
  {
    appId: 'sales_inbox_view',
    title: 'Sales inbox (view only)',
    summary: "See what Seaga's sales team is working on. You can look, not reply.",
    icon: Users,
    pages: [
      {
        path: '/sales-inbox-view/mail',
        label: 'Sales inbox (view only)',
        description: 'Customer email from the sales mailbox, including pre-orders. View only: the sales reps contact the customers.',
        icon: Inbox,
        platforms: ['cin7'],
      },
    ],
  },
  {
    appId: 'shipping',
    title: 'Shipping',
    summary: 'Pick, label and manifest AusPost shipments.',
    icon: Truck,
    pages: [
      {
        path: '/shipping/pantone',
        label: 'Pantone orders',
        description: 'Cin7 sales for Pantone, from order selection through to AusPost manifest.',
        icon: Palette,
        shippingSource: 'pantone',
      },
      {
        path: '/shipping/shopify',
        label: 'Shopify orders',
        description: 'Unfulfilled Shopify orders, from selection through to AusPost manifest.',
        icon: ShoppingBag,
        shippingSource: 'shopify',
      },
    ],
  },
  {
    appId: 'sales',
    title: 'Sales',
    summary: 'Invoices and quotes from Shopify draft orders.',
    icon: Receipt,
    pages: [
      {
        path: '/sales/invoice',
        label: 'Create invoice',
        description: 'Turn a Shopify draft order into an invoice or quote.',
        icon: FileText,
        platforms: ['shopify'], // works from Shopify draft orders, so Shopify companies only
      },
    ],
  },
  {
    appId: 'admin',
    title: 'Admin',
    summary: 'User accounts and module access.',
    icon: ShieldCheck,
    masterOnly: true,
    pages: [
      {
        path: '/admin/users',
        label: 'User access',
        description: 'Add accounts and choose which modules each person can open.',
        icon: Users,
      },
    ],
  },
];

// A page is only shown for companies that have what it needs: the right
// platform (e.g. POs need Cin7) or the right shipping source.
export function pageAllowed(page, business) {
  if (!business) return false;
  if (page.platforms && !page.platforms.includes(business.platform)) return false;
  if (page.shippingSource && !(business.shipping_sources || []).includes(page.shippingSource)) return false;
  return true;
}

// What the menu shows: the company's own modules and pages, narrowed by the
// user's assigned apps. Admins see every module of whichever company they
// have switched to, plus Admin.
export function visibleModules({ isMasterAdmin, userApps, business }) {
  return MODULES.map((m) => {
    if (m.masterOnly) return isMasterAdmin ? m : null;
    if (!business || !(business.modules || []).includes(m.appId)) return null;
    if (!isMasterAdmin && !userApps.includes(m.appId)) return null;
    const pages = m.pages.filter((p) => pageAllowed(p, business));
    return pages.length ? { ...m, pages } : null;
  }).filter(Boolean);
}

export function findPage(pathname) {
  for (const module of MODULES) {
    const page = module.pages.find((p) => pathname === p.path || pathname.startsWith(p.path + '/'));
    if (page) return { module, page };
  }
  return null;
}

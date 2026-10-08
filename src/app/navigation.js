import {
  ClipboardList, Search, AlertTriangle, CalendarRange, SlidersHorizontal,
  Palette, ShoppingBag, FileText, Users, Package, Truck, Receipt, ShieldCheck,
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
    appId: 'procurement',
    title: 'Procurement',
    summary: 'Purchase orders, stock lookups and what to reorder next.',
    icon: Package,
    pages: [
      {
        path: '/procurement/search',
        label: 'Product search',
        description: 'Look up a SKU or item name for stock on hand and sales history.',
        icon: Search,
      },
      {
        path: '/procurement/reorder',
        label: 'Reorder & POs',
        description: 'Review staged items, pick a supplier and send the purchase order to Cin7.',
        icon: ClipboardList,
        showsStagedCount: true,
        platforms: ['cin7'], // POs are created in DEAR/Cin7
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
        label: 'Settings',
        description: 'Supplier lead times and your password.',
        icon: SlidersHorizontal,
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
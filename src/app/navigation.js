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
      },
      {
        path: '/shipping/shopify',
        label: 'Shopify orders',
        description: 'Unfulfilled Shopify orders, from selection through to AusPost manifest.',
        icon: ShoppingBag,
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

export function visibleModules({ isMasterAdmin, userApps }) {
  return MODULES.filter((m) =>
    m.masterOnly ? isMasterAdmin : isMasterAdmin || userApps.includes(m.appId)
  );
}

export function findPage(pathname) {
  for (const module of MODULES) {
    const page = module.pages.find((p) => pathname === p.path || pathname.startsWith(p.path + '/'));
    if (page) return { module, page };
  }
  return null;
}

import { lazy } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './app/AuthContext';
import { StagedPOProvider } from './app/StagedPOContext';
import AppLayout from './layout/AppLayout';
import { findPage, pageAllowed } from './app/navigation';

import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import { LoadingScreen, NoAccessPage, NotFoundPage, PermissionsErrorScreen } from './pages/SystemPages';

// Each page is its own chunk, so the first load only pulls in the shell and
// the page being opened (PDF and label libraries load only where used).
const ReorderPage = lazy(() => import('./pages/ReorderPage'));
const UrgentOrdersPage = lazy(() => import('./pages/UrgentOrdersPage'));
const LongtermOrdersPage = lazy(() => import('./pages/LongtermOrdersPage'));
const ProductSearchPage = lazy(() => import('./pages/ProductSearchPage'));
const ProcurementSettingsPage = lazy(() => import('./pages/ProcurementSettingsPage'));
const PantoneFulfillmentPage = lazy(() => import('./pages/PantoneFulfillmentPage'));
const ShopifyFulfillmentPage = lazy(() => import('./pages/ShopifyFulfillmentPage'));
const CreateInvoicePage = lazy(() => import('./pages/CreateInvoicePage'));
const UserAccessPage = lazy(() => import('./pages/UserAccessPage'));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </BrowserRouter>
  );
}

function AuthGate() {
  const { session, loading, permissionsError, business } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!session) return <LoginPage />;
  if (permissionsError) return <PermissionsErrorScreen />;

  // Keyed by company: switching company remounts every page and the staged
  // PO list, so nothing from one company is ever shown under another.
  return (
    <StagedPOProvider key={business?.id}>
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />

        <Route path="procurement" element={<RequireApp appId="procurement" />}>
          <Route index element={<ModuleIndex appId="procurement" />} />
          <Route path="reorder" element={<ReorderPage />} />
          <Route path="urgent" element={<UrgentOrdersPage />} />
          <Route path="longterm" element={<LongtermOrdersPage />} />
          <Route path="search" element={<ProductSearchPage />} />
          <Route path="settings" element={<ProcurementSettingsPage />} />
        </Route>

        <Route path="shipping" element={<RequireApp appId="shipping" />}>
          <Route index element={<ModuleIndex appId="shipping" />} />
          <Route path="pantone" element={<PantoneFulfillmentPage />} />
          <Route path="shopify" element={<ShopifyFulfillmentPage />} />
        </Route>

        <Route path="sales" element={<RequireApp appId="sales" />}>
          <Route index element={<ModuleIndex appId="sales" />} />
          <Route path="invoice" element={<CreateInvoicePage />} />
        </Route>

        <Route path="admin" element={<RequireApp appId="admin" />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<UserAccessPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </StagedPOProvider>
  );
}

// Route guard: only renders the module's pages if this user has the module
// assigned (or is a master admin). The server still enforces access through
// RLS; this just keeps people out of screens that would fail for them.
function RequireApp({ appId }) {
  const { canOpen, business } = useAuth();
  const { pathname } = useLocation();
  const match = findPage(pathname);
  if (!canOpen(appId)) return <NoAccessPage />;
  // The module can be open while a single page isn't (e.g. Pantone orders
  // for a company that only ships from Shopify).
  if (match && appId !== 'admin' && !pageAllowed(match.page, business)) return <NoAccessPage />;
  return <Outlet />;
}

// /shipping on its own opens the first page this company actually has.
function ModuleIndex({ appId }) {
  const { modules } = useAuth();
  const first = modules.find((m) => m.appId === appId)?.pages[0]?.path;
  return <Navigate to={first || '/'} replace />;
}
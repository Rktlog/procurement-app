import { lazy } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './app/AuthContext';
import { StagedPOProvider } from './app/StagedPOContext';
import AppLayout from './layout/AppLayout';

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
        <StagedPOProvider>
          <AuthGate />
        </StagedPOProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

function AuthGate() {
  const { session, loading, permissionsError } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!session) return <LoginPage />;
  if (permissionsError) return <PermissionsErrorScreen />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />

        <Route path="procurement" element={<RequireApp appId="procurement" />}>
          <Route index element={<Navigate to="search" replace />} />
          <Route path="reorder" element={<ReorderPage />} />
          <Route path="urgent" element={<UrgentOrdersPage />} />
          <Route path="longterm" element={<LongtermOrdersPage />} />
          <Route path="search" element={<ProductSearchPage />} />
          <Route path="settings" element={<ProcurementSettingsPage />} />
        </Route>

        <Route path="shipping" element={<RequireApp appId="shipping" />}>
          <Route index element={<Navigate to="pantone" replace />} />
          <Route path="pantone" element={<PantoneFulfillmentPage />} />
          <Route path="shopify" element={<ShopifyFulfillmentPage />} />
        </Route>

        <Route path="sales" element={<RequireApp appId="sales" />}>
          <Route index element={<Navigate to="invoice" replace />} />
          <Route path="invoice" element={<CreateInvoicePage />} />
        </Route>

        <Route path="admin" element={<RequireApp appId="admin" />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<UserAccessPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

// Route guard: only renders the module's pages if this user has the module
// assigned (or is a master admin). The server still enforces access through
// RLS; this just keeps people out of screens that would fail for them.
function RequireApp({ appId }) {
  const { canOpen } = useAuth();
  return canOpen(appId) ? <Outlet /> : <NoAccessPage />;
}

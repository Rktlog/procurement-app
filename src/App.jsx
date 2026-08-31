import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import ProductSearch from './ProductSearch';
import UrgentSalesShortage from './UrgentSalesShortage';
import LongtermOrders from './LongtermOrders';
import Settings from './Settings';
import UserManagementAdmin from './UserManagementAdmin';
import Cin7Fulfillment from './Cin7Fulfillment';
import ShopifyFulfillment from './ShopifyFulfillment';
import Cin7Procurement from './Cin7Procurement';

const APPS_REGISTRY = [
  {
    id: 'procurement',
    title: 'Procurement Hub',
    description: 'Cin7 PO generation, low stock reorders, product lookups, and order shortages.',
    icon: '📦',
  },
  {
    id: 'shipping',
    title: 'Shipping & Logistics',
    description: 'Dispatch manifests, Pantone fulfillment, and Shopify carrier integrations.',
    icon: '🚀',
  },
];

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [permissionsError, setPermissionsError] = useState(false);
  const [isMasterAdmin, setIsMasterAdmin] = useState(false);
  const [userApps, setUserApps] = useState([]);
  const [activeApp, setActiveApp] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserPermissions();
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserPermissions();
      else setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserPermissions = async () => {
    setLoading(true);
    setPermissionsError(false);
    try {
      const { data, error } = await supabase.rpc('get_my_assigned_apps');
      if (!error && data && data.length > 0) {
        const masterStatus = data[0].is_master;
        const appsList = data[0].assigned_apps || [];

        setIsMasterAdmin(masterStatus);
        setUserApps(appsList);

        if (appsList.length === 1 && !masterStatus) {
          setActiveApp(appsList[0]);
        } else {
          setActiveApp(null);
        }
      } else {
        // Fail closed, not open: a broken or empty permissions response
        // should not silently grant full access to every app. Previously
        // this branch set userApps to ['procurement', 'shipping'] (i.e.
        // everything) on any RPC error or empty result -- the failure
        // mode of an access-control check should never be "give everyone
        // everything."
        setUserApps([]);
        setIsMasterAdmin(false);
        setActiveApp(null);
        setPermissionsError(true);
      }
    } catch (err) {
      console.error('Error fetching permissions:', err);
      setUserApps([]);
      setIsMasterAdmin(false);
      setActiveApp(null);
      setPermissionsError(true);
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', fontSize: '12px', color: '#64748b' }}>
        Authenticating session...
      </div>
    );
  }

  if (!session) {
    return <AuthLoginView />;
  }

  if (permissionsError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', fontFamily: 'sans-serif', padding: '16px', textAlign: 'center' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#991b1b' }}>Couldn't verify your app access.</div>
        <div style={{ fontSize: '11px', color: '#64748b', maxWidth: '360px' }}>
          This could be a temporary issue, or your account may not have any modules assigned yet. Contact an admin if this persists.
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={fetchUserPermissions}
            style={{ fontSize: '11px', fontWeight: 700, padding: '6px 12px', borderRadius: '6px', background: '#1e293b', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            Retry
          </button>
          <button
            onClick={handleLogout}
            style={{ fontSize: '11px', fontWeight: 700, padding: '6px 12px', borderRadius: '6px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', cursor: 'pointer' }}
          >
            Logout
          </button>
        </div>
      </div>
    );
  }

  const availableApps = isMasterAdmin
    ? APPS_REGISTRY
    : APPS_REGISTRY.filter((app) => userApps.includes(app.id));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
      {/* Top Navigation Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 flex justify-between items-center h-12">
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => (availableApps.length > 1 || isMasterAdmin) && setActiveApp(null)}>
              <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center text-white text-xs font-black">
                🚀
              </div>
              <h1 className="text-xs font-bold text-slate-900 leading-none">Rocket Operation</h1>
            </div>

            {(availableApps.length > 1 || isMasterAdmin) && activeApp && (
              <button
                onClick={() => setActiveApp(null)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] px-2.5 py-1 rounded-md font-bold border border-slate-300 transition-colors cursor-pointer ml-2"
              >
                Switch App
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md">
              {session.user.email}
            </span>

            <button
              onClick={handleLogout}
              className="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 text-[11px] px-2.5 py-1 rounded-md font-bold border border-slate-300 transition-colors cursor-pointer"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {!activeApp && (
          <div className="space-y-4 max-w-4xl mx-auto pt-2">
            <div className="text-center space-y-1">
              <h2 className="text-base font-bold text-slate-900">Assigned Applications</h2>
              <p className="text-xs text-slate-500">Select an allocated module to launch your workspace</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-2">
              {availableApps.map((app) => (
                <div
                  key={app.id}
                  onClick={() => setActiveApp(app.id)}
                  className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:border-blue-500 hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div className="space-y-2">
                    <span className="text-3xl block group-hover:scale-105 transition-transform">{app.icon}</span>
                    <h3 className="text-xs font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                      {app.title}
                    </h3>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{app.description}</p>
                  </div>

                  <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold text-blue-600">
                    <span>Launch Module</span>
                    <span>→</span>
                  </div>
                </div>
              ))}

              {isMasterAdmin && (
                <div
                  onClick={() => setActiveApp('admin_management')}
                  className="bg-purple-50/60 rounded-xl border border-purple-200 p-4 shadow-2xs hover:border-purple-500 hover:bg-purple-50 transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <span className="text-3xl block group-hover:scale-105 transition-transform">👑</span>
                      <span className="text-[9px] font-bold uppercase bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded">
                        Admin Only
                      </span>
                    </div>
                    <h3 className="text-xs font-bold text-purple-950 group-hover:text-purple-700 transition-colors">
                      User Access Control
                    </h3>
                    <p className="text-[11px] text-purple-800/80 leading-relaxed">
                      Add new user accounts, edit permissions, and grant/revoke module access.
                    </p>
                  </div>

                  <div className="mt-4 pt-2.5 border-t border-purple-200/60 flex items-center justify-between text-[11px] font-bold text-purple-700">
                    <span>Manage Users</span>
                    <span>→</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeApp === 'procurement' && <ProcurementAppShell />}
        {activeApp === 'shipping' && <ShippingAppShell />}
        {activeApp === 'admin_management' && isMasterAdmin && <UserManagementAdmin />}
      </main>
    </div>
  );
}

function ProcurementAppShell() {
  const [subTab, setSubTab] = useState('reorder');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  // Staged PO items live here, above all four tabs, so a selection made in
  // Urgent Orders or Longterm Orders survives switching to the Reorder &
  // POs tab -- each tab below unmounts when subTab changes, so state kept
  // inside any one of them would be lost on switch. This is the hand-off
  // mechanism: Urgent/Longterm call addToStagedPO, Cin7Procurement reads
  // stagedPOItems and clears them once a PO is submitted.
  const [stagedPOItems, setStagedPOItems] = useState([]);

  useEffect(() => {
    fetchLastSyncTime();
  }, []);

  const fetchLastSyncTime = async () => {
    const { data } = await supabase
      .from('sync_runs')
      .select('finished_at, status')
      .eq('entity', 'inventory_sync')
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.finished_at) setLastSyncedAt(data.finished_at);
  };

  const handleSyncCin7 = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('cin7-proxy', {
        body: { action: 'sync_inventory_database' },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      setSyncMsg({ type: 'success', text: data.message || 'Sync complete.' });
      await fetchLastSyncTime();
    } catch (err) {
      setSyncMsg({ type: 'error', text: err.message });
    }
    setSyncing(false);
  };

  // Adds items to the PO staging area and jumps to the Reorder & POs tab
  // so the person can see what just landed there and pick a supplier.
  // Merges by SKU: if the same SKU is added twice (e.g. once from Urgent,
  // once from Longterm), quantities add together rather than duplicating
  // the row.
  const addToStagedPO = (items, source) => {
    setStagedPOItems((prev) => {
      const merged = new Map(prev.map((i) => [i.SKU, { ...i }]));
      for (const item of items) {
        const existing = merged.get(item.SKU);
        if (existing) {
          existing.Quantity = (Number(existing.Quantity) || 0) + (Number(item.Quantity) || 0);
        } else {
          merged.set(item.SKU, { ...item, source });
        }
      }
      return [...merged.values()];
    });
    setSubTab('reorder');
  };

  const removeStagedItem = (sku) => {
    setStagedPOItems((prev) => prev.filter((i) => i.SKU !== sku));
  };

  const clearStagedItems = () => setStagedPOItems([]);

  return (
    <div className="space-y-3">
      {/* Sync bar -- above all tabs since Urgent/Longterm/ProductSearch all
          read from the same products/inventory tables this sync writes to,
          not just the Reorder tab. */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
            🔄
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 leading-tight">Cin7 Data Sync</h3>
            <p className="text-[11px] text-slate-500">
              {lastSyncedAt ? (
                <>Last synced: <strong className="text-slate-800 font-semibold">{new Date(lastSyncedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</strong> (auto every 30 min)</>
              ) : (
                <span className="text-amber-600 font-medium">No sync recorded yet</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {syncMsg && (
            <span className={`text-[11px] font-semibold ${syncMsg.type === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
              {syncMsg.text}
            </span>
          )}
          <button
            onClick={handleSyncCin7}
            disabled={syncing}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50 h-8 flex items-center gap-1.5"
          >
            {syncing ? (
              <>
                <span className="inline-block animate-spin">🔄</span> Syncing...
              </>
            ) : (
              '🔄 Sync Cin7 Now'
            )}
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-white p-1 rounded-lg border border-slate-200 max-w-fit flex-wrap">
        <button
          onClick={() => setSubTab('reorder')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            subTab === 'reorder' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          📦 Cin7 Reorder & POs{stagedPOItems.length > 0 ? ` (${stagedPOItems.length})` : ''}
        </button>
        <button
          onClick={() => setSubTab('search')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            subTab === 'search' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          🔍 Product Search
        </button>
        <button
          onClick={() => setSubTab('urgent')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            subTab === 'urgent' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          ⚠️ Urgent Orders
        </button>
        <button
          onClick={() => setSubTab('longterm')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            subTab === 'longterm' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          📅 Longterm Orders
        </button>
        <button
          onClick={() => setSubTab('settings')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
            subTab === 'settings' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          ⚙️ Settings
        </button>
      </div>

      {subTab === 'reorder' && (
        <Cin7Procurement
          stagedItems={stagedPOItems}
          onRemoveStagedItem={removeStagedItem}
          onClearStagedItems={clearStagedItems}
        />
      )}
      {subTab === 'search' && <ProductSearch />}
      {subTab === 'urgent' && <UrgentSalesShortage onAddToPO={(items) => addToStagedPO(items, 'urgent')} />}
      {subTab === 'longterm' && <LongtermOrders onAddToPO={(items) => addToStagedPO(items, 'longterm')} />}
      {subTab === 'settings' && <Settings />}
    </div>
  );
}

function ShippingAppShell() {
  const [subTab, setSubTab] = useState('pantone');

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-white p-1 rounded-lg border border-slate-200 max-w-fit">
        <button
          onClick={() => setSubTab('pantone')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer transition-colors ${
            subTab === 'pantone' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Pantone
        </button>
        <button
          onClick={() => setSubTab('shopify')}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer transition-colors ${
            subTab === 'shopify' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Shopify
        </button>
      </div>

      {subTab === 'pantone' && <Cin7Fulfillment />}
      {subTab === 'shopify' && <ShopifyFulfillment />}
    </div>
  );
}

function AuthLoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErrorMsg(error.message);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm max-w-xs w-full space-y-3">
        <div className="text-center space-y-0.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-sm mx-auto font-black">
            🚀
          </div>
          <h1 className="text-xs font-bold text-slate-900 pt-1">Rocket Operation</h1>
          <p className="text-[11px] text-slate-500">Log in to launch workspace</p>
        </div>

        {errorMsg && (
          <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-md">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-2.5">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-1.5 px-3 rounded-md transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

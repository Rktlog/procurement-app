import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase, setActiveBusiness } from '../supabaseClient';
import { visibleModules } from './navigation';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [permissionsError, setPermissionsError] = useState(false);
  const [isMasterAdmin, setIsMasterAdmin] = useState(false);
  const [userApps, setUserApps] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [activeBusinessId, setActiveBusinessId] = useState(null);

  // Supabase fires onAuthStateChange for TOKEN_REFRESHED and INITIAL_SESSION
  // whenever a backgrounded tab regains focus. Only a genuine fresh sign-in
  // should re-fetch permissions, otherwise the app drops to a loading screen
  // mid-task.
  const hasLoadedPermissions = useRef(false);

  const fetchUserPermissions = useCallback(async () => {
    setLoading(true);
    setPermissionsError(false);
    try {
      const { data, error } = await supabase.rpc('get_my_access');
      const list = data?.[0]?.businesses || [];
      if (!error && data && data.length > 0 && list.length > 0) {
        const master = Boolean(data[0].is_master);
        // Staff open their own company. Admins reopen the last one they used.
        const saved = master ? localStorage.getItem('activeBusiness') : null;
        const pick = list.find((b) => b.id === saved) || list[0];
        // Set before any page renders, so the first queries are already scoped.
        setActiveBusiness(pick.id, pick.shopify_function);
        setBusinesses(list);
        setActiveBusinessId(pick.id);
        setIsMasterAdmin(master);
        setUserApps(data[0].assigned_apps || []);
      } else {
        // Fail closed: a broken or empty permissions response grants nothing.
        setUserApps([]);
        setIsMasterAdmin(false);
        setPermissionsError(true);
      }
    } catch (err) {
      console.error('Error fetching permissions:', err);
      setUserApps([]);
      setIsMasterAdmin(false);
      setPermissionsError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        hasLoadedPermissions.current = true;
        fetchUserPermissions();
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);

      if (event === 'SIGNED_OUT') {
        hasLoadedPermissions.current = false;
        setActiveBusiness(null);
        setBusinesses([]);
        setActiveBusinessId(null);
        setUserApps([]);
        setIsMasterAdmin(false);
        setLoading(false);
        return;
      }

      if (event === 'SIGNED_IN' && !hasLoadedPermissions.current) {
        hasLoadedPermissions.current = true;
        fetchUserPermissions();
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchUserPermissions]);

  const signOut = useCallback(() => supabase.auth.signOut(), []);

  const business = businesses.find((b) => b.id === activeBusinessId) || null;
  // Only admins can switch company. Everyone else stays in their own.
  const canSwitchBusiness = isMasterAdmin && businesses.length > 1;

  const switchBusiness = useCallback(
    (id) => {
      const target = businesses.find((b) => b.id === id);
      if (!isMasterAdmin || !target) return;
      setActiveBusiness(id, target.shopify_function); // before the state change, so the remounted pages query the new company
      localStorage.setItem('activeBusiness', id);
      setActiveBusinessId(id);
    },
    [isMasterAdmin, businesses]
  );

  const canOpen = useCallback(
    (appId) =>
      appId === 'admin'
        ? isMasterAdmin
        : !!business && (business.modules || []).includes(appId) && (isMasterAdmin || userApps.includes(appId)),
    [isMasterAdmin, userApps, business]
  );

  const modules = visibleModules({ isMasterAdmin, userApps, business });

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    permissionsError,
    isMasterAdmin,
    userApps,
    business,
    businesses,
    canSwitchBusiness,
    switchBusiness,
    modules,
    canOpen,
    retryPermissions: fetchUserPermissions,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
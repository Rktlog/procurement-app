import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [permissionsError, setPermissionsError] = useState(false);
  const [isMasterAdmin, setIsMasterAdmin] = useState(false);
  const [userApps, setUserApps] = useState([]);

  // Supabase fires onAuthStateChange for TOKEN_REFRESHED and INITIAL_SESSION
  // whenever a backgrounded tab regains focus. Only a genuine fresh sign-in
  // should re-fetch permissions, otherwise the app drops to a loading screen
  // mid-task.
  const hasLoadedPermissions = useRef(false);

  const fetchUserPermissions = useCallback(async () => {
    setLoading(true);
    setPermissionsError(false);
    try {
      const { data, error } = await supabase.rpc('get_my_assigned_apps');
      if (!error && data && data.length > 0) {
        setIsMasterAdmin(Boolean(data[0].is_master));
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

  const canOpen = useCallback(
    (appId) => (appId === 'admin' ? isMasterAdmin : isMasterAdmin || userApps.includes(appId)),
    [isMasterAdmin, userApps]
  );

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    permissionsError,
    isMasterAdmin,
    userApps,
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

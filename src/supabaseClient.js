import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://tpptyqicgclrvgagyidq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_W9DS5gykBUmvb4LET5TS6g_T1Bm-A8Q"; // was the old legacy anon JWT — now dead since legacy keys were disabled

// The company being viewed. Sent as x-business-id on every database call;
// row-level security only returns rows for that company, and only if the
// logged-in user is allowed it. AuthContext sets this before any page loads.
let activeBusinessId = null;
export const setActiveBusiness = (id) => {
  activeBusinessId = id || null;
};

const fetchWithBusiness = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  // Database calls (row-level security) and the edge functions (which pick the
  // Shopify store and tag AusPost manifests) both need to know the company.
  if (activeBusinessId && (url.includes('/rest/v1/') || url.includes('/functions/v1/'))) {
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
    headers.set('x-business-id', activeBusinessId);
    return fetch(input, { ...init, headers });
  }
  return fetch(input, init);
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: fetchWithBusiness },
});
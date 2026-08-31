import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://tpptyqicgclrvgagyidq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_W9DS5gykBUmvb4LET5TS6g_T1Bm-A8Q"; // was the old legacy anon JWT — now dead since legacy keys were disabled

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
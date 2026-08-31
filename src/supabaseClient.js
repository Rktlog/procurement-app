import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://tpptyqicgclrvgagyidq.supabase.co"; // Replace with your Supabase URL
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcHR5cWljZ2NscnZnYWd5aWRxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzUxOTE1NywiZXhwIjoyMTAzMDk1MTU3fQ.S8EM81j7AtUbKwoVo_MpOp_XxotUgzjCGpfPZjqPgLE"; // Replace with your public ANON key

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
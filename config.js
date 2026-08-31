import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import PQueue from 'p-queue';

// 1. Supabase Client (Only requires SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY)
export const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
);

// 2. Axios Instance for DEAR
const dearAxios = axios.create({
  baseURL: 'https://inventory.dearsystems.com/externalapi/v2',
  headers: {
    'api-auth-accountid': process.env.DEAR_ACCOUNT_ID || '',
    'api-auth-applicationkey': process.env.DEAR_APPLICATION_KEY || '',
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// 3. Queue Limiter
const queue = new PQueue({
  intervalCap: 55,
  interval: 60000,
  carryoverConcurrencyCount: true,
});

export async function fetchDear(endpoint, params = {}) {
  if (!process.env.DEAR_ACCOUNT_ID || !process.env.DEAR_APPLICATION_KEY) {
    console.warn('⚠️ Skipping DEAR API call: Missing DEAR credentials in .env');
    return {};
  }

  return queue.add(async () => {
    try {
      const response = await dearAxios.get(endpoint, { params });
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        console.warn('⚠️ DEAR 429 Rate Limit hit. Retrying in 12s...');
        await new Promise((res) => setTimeout(res, 12000));
        return fetchDear(endpoint, params);
      }
      throw error;
    }
  });
}
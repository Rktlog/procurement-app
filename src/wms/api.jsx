import { supabase, shopifyProxy } from '../supabaseClient';

// Calls the company's Shopify function (Metro Baby: metrobaby-proxy). Errors
// carry the function's own message; `error.data` holds the full reply, which
// the purchase screen uses to offer a retry when Shopify didn't confirm.
export async function wms(action, body = {}) {
  const { data, error } = await supabase.functions.invoke(shopifyProxy(), { body: { action, ...body } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (!data?.success) {
    const err = new Error(data?.error || 'No response from the server.');
    err.data = data;
    throw err;
  }
  return data;
}

// Same look for inputs and buttons on every WMS screen.
export const inputClass =
  'w-full h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20';
export const buttonPrimary =
  'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer';
export const buttonPlain =
  'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-ink hover:border-blue-600 hover:text-blue-700 disabled:opacity-60 cursor-pointer';

// The AI assistant is its own function; it answers with text and any email drafts it wrote.
export async function askAssistant(messages) {
  const { data, error } = await supabase.functions.invoke('metrobaby-assistant', { body: { messages } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'No answer came back.');
  return data;
}

export const fmtMoney = (n, currency = 'AUD') =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency || 'AUD' }).format(Number(n) || 0);

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

// "PARTIALLY_FULFILLED" -> "Partially fulfilled"
export const nice = (s) => (s ? s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

const GOOD = 'bg-emerald-100 text-emerald-800';
const WARN = 'bg-amber-100 text-amber-800';
const BAD = 'bg-red-100 text-red-800';
const NEUTRAL = 'bg-slate-100 text-slate-700';
const INFO = 'bg-blue-100 text-blue-800';

export const statusTone = (s) =>
  ({
    PAID: GOOD, FULFILLED: GOOD, SUCCESS: GOOD, COMPLETED: GOOD, APPLIED: GOOD, OPEN: INFO, IN_PROGRESS: INFO, ORDERED: INFO, SENT: INFO, NEEDS_REVIEW: WARN,
    PARTIALLY_FULFILLED: WARN, PARTIALLY_PAID: WARN, PARTIALLY_RECEIVED: WARN, PENDING: WARN, AUTHORIZED: WARN, UNFULFILLED: WARN,
    ON_HOLD: WARN, SCHEDULED: WARN, DRAFT: NEUTRAL, CLOSED: NEUTRAL,
    VOIDED: BAD, REFUNDED: BAD, CANCELLED: BAD, FAILURE: BAD, FAILED: BAD,
  })[String(s || '').toUpperCase()] || NEUTRAL;

export function Badge({ status, children }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[0.7rem] font-bold ${statusTone(status)}`}>
      {children ?? nice(status)}
    </span>
  );
}
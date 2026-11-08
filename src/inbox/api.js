import { supabase } from '../supabaseClient';

// Technical messages turned into plain words. The original text is kept (err.technical) and shown under
// "Show details for support", so nothing is hidden from whoever has to fix a problem.
const FRIENDLY = [
  [/Failed to send a request|Failed to fetch|NetworkError|non-2xx/i, "Couldn't reach the server. Check your internet connection and try again."],
  [/Unauthorized|invalid or expired session|Invalid JWT/i, 'Your session has ended. Please sign in again.'],
  [/statement timeout|57014/i, 'That took too long. Please try again in a minute.'],
  [/HTTP 429|rate limit/i, 'The system is busy. Please wait a minute and try again.'],
  [/Database error on|\(HTTP 5\d\d\)/i, 'Something went wrong saving that. Please try again. If it keeps happening, tell your admin.'],
  [/The AI (service|didn't|wasn't|returned)|AI key|ANTHROPIC/i, "The assistant couldn't finish that. Please try again in a moment."],
  [/Gmail error|Gmail sign-in failed/i, "Gmail didn't answer. Please try again in a moment."],
];
const explain = (msg) => { for (const [re, text] of FRIENDLY) if (re.test(msg)) return text; return msg; };
const fail = (technical) => { const e = new Error(explain(technical)); e.friendly = e.message; e.technical = technical; return e; };

// Calls the Sales inbox function. Errors carry a plain-words message.
export async function salesMail(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('seaga-sales-mail', { body: { action, ...body } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw fail(detail?.error || error.message);
  }
  if (!data?.success) throw fail(data?.error || 'No response from the server.');
  return data;
}

export const timeAgo = (iso) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return days < 14 ? `${days}d` : new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

export const gmailLink = (email, threadId) => `https://mail.google.com/mail/u/${encodeURIComponent(email)}/#all/${threadId}`;

import { supabase } from '../supabaseClient';

// Calls the Seaga inbox function. Errors carry the function's own message.
export async function inbox(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('seaga-mail', { body: { action, ...body } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'No response from the server.');
  return data;
}

export { inputClass, buttonPrimary, buttonPlain, fmtDateTime } from '../wms/api';

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

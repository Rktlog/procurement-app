import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { inputClass, buttonPrimary } from '../wms/api';

// Product questions for the sales team: stock, list prices, when stock is coming in, and what sold
// recently. It looks things up and answers. It can't change anything, and it doesn't show costs,
// suppliers or customers.
const STARTERS = [
  ['How much stock do we have of ', 'Stock'],
  ['When is more coming in for ', 'When it is coming in'],
  ['What is the price of ', 'Price'],
  ['When did we last sell ', 'Last sold'],
];

async function askProductAssistant(messages) {
  const { data, error } = await supabase.functions.invoke('seaga-sales-assistant', { body: { messages } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'No response from the server.');
  return data;
}

export default function ProductAssistant() {
  const [messages, setMessages] = useState([]); // { role, content, used? }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [messages, busy]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const r = await askProductAssistant(next.map((m) => ({ role: m.role, content: m.content })));
      setMessages([...next, { role: 'assistant', content: r.reply, used: r.used || [] }]);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <section className="max-w-3xl bg-white border border-slate-200 rounded-xl flex flex-col min-h-[520px]" aria-label="Product assistant">
      <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[600px]" aria-live="polite">
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-slate-600 mb-3">Ask about a product by SKU or name: stock, list price, when more is coming in, or when it last sold. I can only look things up.</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map(([start, label]) => (
                <button key={label} type="button" onClick={() => { setInput(start); inputRef.current?.focus(); }} className="rounded-full bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-sm text-slate-700 cursor-pointer">{label}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-ink'}`}>
              {m.content}
              {m.used?.length > 0 && <div className="mt-1.5 text-[0.7rem] text-slate-500">Looked at: {[...new Set(m.used)].join(', ').replace(/_/g, ' ')}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-slate-500" role="status">Looking it up</div>}
        {error && <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">{error}</div>}
        <div ref={endRef} />
      </div>
      <form className="border-t border-slate-100 p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input ref={inputRef} className={inputClass} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about a product" aria-label="Your question" disabled={busy} />
        <button type="submit" className={buttonPrimary} disabled={busy || !input.trim()}>Ask</button>
      </form>
    </section>
  );
}

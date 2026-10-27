import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { wms, askAssistant, fmtDateTime, inputClass, buttonPrimary, buttonPlain } from './api';

const SUGGESTIONS = [
  'Which dropship orders are waiting on a supplier?',
  'What should I reorder this week?',
  'Any supplier replies in Gmail I should look at?',
  'Where is order #122313?',
];

// Ask questions in plain English. The assistant looks things up (orders, stock,
// purchase orders, dropship requests, Gmail) and can write email DRAFTS. It never
// sends: every draft waits here for a person to read it and press Send.
export default function WmsAssistant() {
  const [messages, setMessages] = useState([]); // { role, content, drafts?, used? }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [waiting, setWaiting] = useState([]); // drafts from earlier, still unsent
  const [inline, setInline] = useState(() => new Set());
  const endRef = useRef(null);

  const loadDrafts = async () => {
    const { data } = await supabase.from('assistant_drafts').select('*').eq('status', 'draft').order('created_at', { ascending: false }).limit(20);
    setWaiting(data || []);
  };
  useEffect(() => { loadDrafts(); }, []);
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
      const r = await askAssistant(next.map((m) => ({ role: m.role, content: m.content })));
      setMessages([...next, { role: 'assistant', content: r.reply, drafts: r.drafts || [], used: r.used || [] }]);
      if (r.drafts?.length) {
        // Shown in the chat now, so they're left out of the waiting list (one card per draft).
        setInline((ids) => new Set([...ids, ...r.drafts.map((d) => d.id)]));
        await loadDrafts();
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      <section className="lg:col-span-3 bg-white border border-slate-200 rounded-xl flex flex-col min-h-[520px]" aria-label="Assistant">
        <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[600px]" aria-live="polite">
          {messages.length === 0 && (
            <div>
              <p className="text-sm text-slate-600 mb-3">Ask about orders, stock, purchase orders, dropship orders or supplier email. I can look things up and write email drafts. I can't send anything: you read each draft and press Send.</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-full bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-sm text-slate-700 cursor-pointer">{s}</button>
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
              {m.drafts?.map((d) => <div key={d.id} className="mt-2"><DraftCard d={d} /></div>)}
            </div>
          ))}
          {busy && <div className="text-sm text-slate-500">Looking into it</div>}
          {error && <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">{error}</div>}
          <div ref={endRef} />
        </div>
        <form className="border-t border-slate-100 p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything about Metro Baby's orders, stock or suppliers" aria-label="Message" className={inputClass} disabled={busy} />
          <button type="submit" className={`${buttonPrimary} shrink-0`} disabled={busy || !input.trim()}>Ask</button>
        </form>
      </section>

      <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4" aria-label="Drafts waiting">
        <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase mb-2">Email drafts waiting for you</h3>
        {waiting.filter((d) => !inline.has(d.id)).length === 0 && <p className="text-sm text-slate-500">None. Ask the assistant to write one, e.g. "Email Acme asking when PO-0004 ships".</p>}
        <div className="space-y-3">{waiting.filter((d) => !inline.has(d.id)).map((d) => <DraftCard key={d.id} d={d} />)}</div>
      </section>
    </div>
  );
}

// Once sent or discarded the card stays, saying what happened, until you leave the page.
function DraftCard({ d }) {
  const [state, setState] = useState('draft'); // draft | sent | discarded
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const act = async (action, next) => {
    setBusy(true);
    setError(null);
    try {
      await wms(action, { id: d.id });
      setState(next);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  if (state !== 'draft') return <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-600">{state === 'sent' ? `Sent to ${d.to_email}.` : 'Draft discarded.'}</div>;
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm">
      <div className="text-xs text-slate-500">To</div><div className="font-semibold text-ink">{d.to_email}</div>
      <div className="mt-1 text-xs text-slate-500">Subject</div><div className="font-semibold text-ink">{d.subject}</div>
      <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700 font-sans">{d.body}</pre>
      {d.created_at && <div className="mt-1 text-[0.7rem] text-slate-400">Written {fmtDateTime(d.created_at)}</div>}
      {error && <div role="alert" className="mt-2 text-xs text-red-700">{error}</div>}
      <div className="mt-2 flex gap-2">
        <button type="button" className={buttonPrimary} disabled={busy} onClick={() => act('draft_send', 'sent')}>Send email</button>
        <button type="button" className={buttonPlain} disabled={busy} onClick={() => act('draft_discard', 'discarded')}>Discard</button>
      </div>
    </div>
  );
}
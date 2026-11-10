import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Check, Paperclip, Sparkles, ArrowLeft, Clock, Trash2 } from 'lucide-react';
import { inputClass, buttonPrimary, buttonPlain } from '../wms/api';
import { salesMail, timeAgo, gmailLink } from './api';

// The Sales inbox: customer email from the sales@ mailbox, kept apart from the Operations inbox.
// Customers' names are shown here. Replies are drafts: staff copy them into Gmail until an admin switches sending on.
const CAT = {
  new: ['Reading it', 'bg-slate-100 text-slate-700'],
  question: ['Question', 'bg-violet-100 text-violet-800'],
  order: ['Order', 'bg-emerald-100 text-emerald-800'],
  delivery: ['Delivery', 'bg-sky-100 text-sky-800'],
  other: ['Other', 'bg-amber-100 text-amber-800'],
  unknown: ["Not sure who this is", 'bg-slate-100 text-slate-700'],
  waiting: ['Waiting for the customer', 'bg-blue-100 text-blue-800'],
  automatic: ['Automatic', 'bg-slate-100 text-slate-500'],
  done: ['Finished', 'bg-emerald-100 text-emerald-800'],
};
const LIST_VIEWS = ['question', 'order', 'delivery', 'other', 'unknown', 'all', 'mine', 'automatic', 'archived'];
const errNotice = (err) => ({ type: 'error', text: err.friendly || err.message, detail: err.technical || null });

const Pill = ({ cat }) => {
  const [label, tone] = CAT[cat] || CAT.other;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${tone}`}>{label}</span>;
};

const Notice = ({ n }) => (n ? (
  <div role={n.type === 'error' ? 'alert' : 'status'} className={`p-3 text-sm rounded-md border ${n.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
    {n.text}
    {n.type === 'error' && n.detail && n.detail !== n.text && (
      <details className="mt-1 text-xs opacity-80"><summary className="cursor-pointer">Show details for support</summary><span className="break-words">{n.detail}</span></details>
    )}
  </div>
) : null);

const copyText = async (text) => {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (_e) { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
};

export default function SalesInbox() {
  const [params] = useSearchParams();
  const [view, setView] = useState('today');
  const [status, setStatus] = useState(null);
  const [overview, setOverview] = useState(null);
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState(null);
  const readOnly = status?.mode === 'view'; // a 2PRE manager: look, never reply or change

  const loadStatus = useCallback(async () => { try { setStatus(await salesMail('mail_status')); } catch (err) { setNotice(errNotice(err)); } }, []);
  const loadOverview = useCallback(async () => { try { setOverview(await salesMail('sales_overview')); } catch (err) { setNotice(errNotice(err)); } }, []);
  const loadThreads = useCallback(async () => {
    if (!LIST_VIEWS.includes(view)) return;
    try { setThreads((await salesMail('list_threads', { group: view, q })).threads); } catch (err) { setNotice(errNotice(err)); }
  }, [view, q]);

  useEffect(() => { loadStatus(); loadOverview(); }, [loadStatus, loadOverview]);
  useEffect(() => { loadThreads(); }, [loadThreads]);
  // A link such as /sales-inbox-view/mail?thread=... (from the Pre-orders page) opens that email straight away.
  useEffect(() => {
    const t = params.get('thread');
    if (t) { setView('all'); setSelectedId(t); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (params.get('gmail') === 'connected') { setNotice({ type: 'success', text: 'Gmail is connected for the sales mailbox. Press Get new emails to bring in the latest.' }); loadStatus(); setView('setup'); }
    else if (params.get('gmail_error')) { setNotice({ type: 'error', text: params.get('gmail_error') }); setView('setup'); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = async () => { await Promise.all([loadOverview(), loadThreads()]); };
  const pick = (v) => { setView(v); setSelectedId(null); };

  // Brings in new email and reads it. Repeats a few times if there is a lot.
  const syncNow = async () => {
    setBusy(true);
    setNotice(null);
    try {
      let last = null;
      for (let i = 0; i < 4; i++) {
        setProgress(i ? `Still reading (round ${i + 1})` : 'Getting your emails');
        last = await salesMail('run_pipeline');
        if (last.skipped || last.done) break;
      }
      const s = last?.sync;
      const t = last?.triage;
      setNotice(last?.skipped
        ? { type: 'error', text: "Gmail isn't connected yet. Connect the sales mailbox on the Setup page." }
        : { type: 'success', text: `Looked at ${s?.listed ?? 0} emails; ${s?.synced ?? 0} were new or changed. I read ${t?.triaged ?? 0} and wrote ${t?.drafted ?? 0} suggested replies.${t?.failed ? ` ${t.failed} couldn't be read and will be tried again.` : ''}` });
      await Promise.all([loadStatus(), refreshAll()]);
    } catch (err) {
      setNotice(errNotice(err));
    }
    setProgress('');
    setBusy(false);
  };

  const c = overview?.counts || {};
  const navBtn = (key, label, n) => (
    <button key={key} type="button" onClick={() => pick(key)} aria-current={view === key ? 'page' : undefined}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm cursor-pointer ${view === key ? 'bg-blue-50 font-bold text-blue-800' : 'text-ink hover:bg-slate-100'}`}>
      <span className="truncate">{label}</span>
      {n > 0 && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${view === key ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{n}</span>}
    </button>
  );
  const listMode = LIST_VIEWS.includes(view);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {status?.connected ? <>Connected to <b>{status.email}</b>{status.last_sync ? <> · last checked {timeAgo(status.last_sync)} ago</> : null}</> : 'Not connected to Gmail yet.'}
        </p>
        {readOnly
          ? <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">View only</span>
          : (
            <button type="button" className={buttonPrimary} disabled={busy || !status?.connected} onClick={syncNow}>
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />{busy ? progress || 'Working' : 'Get new emails'}
            </button>
          )}
      </div>
      <Notice n={notice} />

      <div className="grid gap-3 lg:grid-cols-[14rem_minmax(0,22rem)_minmax(0,1fr)]">
        <nav aria-label="Sales inbox menu" className={`rounded-xl border border-slate-200 bg-white p-2 space-y-0.5 ${selectedId ? 'hidden lg:block' : ''}`}>
          {navBtn('today', 'Today', 0)}
          {navBtn('question', 'Questions to answer', c.question)}
          {navBtn('order', 'Orders to enter', c.order)}
          {navBtn('delivery', 'Deliveries to chase', c.delivery)}
          {navBtn('other', 'Other', c.other)}
          {!readOnly && navBtn('drafts', 'Drafts', overview?.drafts_waiting || 0)}
          {navBtn('unknown', "Not sure who this is", c.unknown)}
          <div className="px-2.5 pt-3 pb-1 text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">More</div>
          {navBtn('all', 'All emails', 0)}
          {!readOnly && navBtn('mine', "I'm handling", c.mine)}
          {navBtn('customers', 'Customers', 0)}
          {navBtn('automatic', 'Automatic (not read)', c.automatic)}
          {navBtn('archived', 'Archived', c.archived)}
          {!readOnly && navBtn('setup', 'Setup', 0)}
        </nav>

        {view === 'today' && (
          <div className="lg:col-span-2"><TodayView status={status} overview={overview} go={pick} readOnly={readOnly} /></div>
        )}
        {view === 'drafts' && !readOnly && <div className="lg:col-span-2"><DraftsView status={status} setNotice={setNotice} onOpen={(id) => { setView('all'); setSelectedId(id); }} onChanged={refreshAll} /></div>}
        {view === 'customers' && <div className="lg:col-span-2"><CustomersView setNotice={setNotice} status={status} onChanged={refreshAll} readOnly={readOnly} /></div>}
        {view === 'setup' && !readOnly && <div className="lg:col-span-2"><SetupView status={status} reload={loadStatus} setNotice={setNotice} /></div>}

        {listMode && (
          <>
            <section aria-label="Emails" className={`rounded-xl border border-slate-200 bg-white ${selectedId ? 'hidden lg:block' : ''}`}>
              <div className="border-b border-slate-100 p-2">
                <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by subject or sender" aria-label="Search emails" />
              </div>
              <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setSelectedId(t.id)} className={`w-full px-3 py-2.5 text-left cursor-pointer ${selectedId === t.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold text-ink">{t.customer_name || t.last_from || 'Unknown sender'}</span>
                        <span className="shrink-0 text-xs text-slate-400">{timeAgo(t.last_message_at)}</span>
                      </div>
                      <div className="truncate text-sm text-ink">{t.subject}</div>
                      {(t.summary || t.snippet) && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{t.summary || t.snippet}</div>}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Pill cat={t.category} />
                        {t.has_draft && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[0.7rem] font-semibold text-violet-800">Suggested reply ready</span>}
                        {t.assigned_name && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.7rem] font-semibold text-slate-700">{t.assigned_name} is handling it</span>}
                        {t.urgency === 'high' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[0.7rem] font-semibold text-red-800">Urgent</span>}
                        {t.has_attachments && <Paperclip size={11} className="text-slate-400" aria-label="Has attachments" />}
                      </div>
                    </button>
                  </li>
                ))}
                {threads.length === 0 && <li className="p-8 text-center text-sm text-slate-500">{view === 'question' || view === 'order' || view === 'delivery' || view === 'other' ? "You're all caught up here." : 'Nothing here.'}</li>}
              </ul>
            </section>
            <section aria-label="Email" className={selectedId ? '' : 'hidden lg:block'}>
              {selectedId ? (
                <ThreadView key={selectedId} id={selectedId} status={status} readOnly={readOnly} setNotice={setNotice} onBack={() => setSelectedId(null)} onChanged={refreshAll} />
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">Pick an email from the list to read it.</div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ today
function TodayView({ status, overview, go, readOnly }) {
  if (!overview) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;
  const c = overview.counts;
  const hour = Number(new Date().toLocaleString('en-AU', { hour: 'numeric', hour12: false, timeZone: 'Australia/Melbourne' }));
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const cards = [
    { n: overview.drafts_waiting || 0, label: 'Suggested replies ready', hint: 'Read, change, then copy into Gmail', view: 'question', tone: 'border-violet-200 bg-violet-50 text-violet-900' },
    { n: c.question || 0, label: 'Questions to answer', hint: 'Price, stock and quote questions', view: 'question', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
    { n: c.order || 0, label: 'Orders to enter', hint: 'Purchase orders from customers', view: 'order', tone: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
    { n: c.delivery || 0, label: 'Deliveries to chase', hint: 'Where is my order, freight problems', view: 'delivery', tone: 'border-sky-200 bg-sky-50 text-sky-900' },
  ];
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-bold text-ink">{hello}</h2>
        <p className="text-sm text-slate-600">Here is what needs the sales team today.</p>
      </div>
      {readOnly && <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">This is the sales team's inbox, <b>view only</b>. You can see what customers are asking for, including pre-orders. The reps contact the customers.</p>}
      {!readOnly && !status?.connected && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-amber-950"><b>Connect the sales mailbox first.</b> It takes a minute on the Setup page.</div>
          <button type="button" className={buttonPrimary} onClick={() => go('setup')}>Go to Setup</button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <button key={card.label} type="button" onClick={() => go(card.view)} className={`rounded-xl border p-3.5 text-left cursor-pointer hover:shadow-sm ${card.tone}`}>
            <span className="block text-3xl font-bold leading-none">{card.n}</span>
            <span className="mt-1.5 block text-sm font-semibold">{card.label}</span>
            <span className="mt-0.5 block text-xs opacity-80">{card.hint}</span>
          </button>
        ))}
      </div>
      {!readOnly && c.unknown > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm text-amber-950"><b>{c.unknown} emails are from people who aren't saved as customers.</b> <span className="text-xs text-amber-900">I only read emails from saved customers. Open one to save the customer; I'll suggest who it might be.</span></div>
          <button type="button" className={buttonPrimary} onClick={() => go('unknown')}>Look at them</button>
        </div>
      )}
      {!readOnly && <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-blue-700">New here? How this works</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-700">
          <li>Press <b>Get new emails</b> at the top. It brings in the latest emails from the sales mailbox.</li>
          <li>Notices and newsletters from systems are set aside under <b>Automatic</b> and never read. Everything else is sorted into questions, orders and deliveries.</li>
          <li>When a customer asks a question, I write a <b>suggested reply</b> using our stock, prices and delivery dates. Read it, change anything, then <b>Copy reply</b> and send it from Gmail.</li>
          <li>An email from someone new? <b>Save them as a customer</b> so I can read their emails from then on.</li>
          <li>Press <b>I'll handle this</b> on an email so a colleague doesn't answer it too.</li>
        </ol>
        <p className="mt-3 text-slate-600">Nothing is sent from this screen for now. Sending is locked, and an admin unlocks it later.</p>
      </details>}
    </div>
  );
}

// ------------------------------------------------------------------------------ one email
function ThreadView({ id, status, readOnly, setNotice, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [copied, setCopied] = useState(false);
  const [custName, setCustName] = useState('');
  const [custEmail, setCustEmail] = useState('');

  const load = useCallback(async () => {
    setData(null);
    try {
      const r = await salesMail('get_thread', { id });
      setData(r);
      setBody(r.draft?.body || '');
      setSubject(r.draft?.subject || '');
      setCustEmail(r.sender?.email || '');
      setCustName(r.sender?.name || '');
    } catch (err) { setNotice(errNotice(err)); }
  }, [id, setNotice]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fn();
      if (ok) setNotice({ type: 'success', text: typeof ok === 'function' ? ok(r) : ok });
      setBusy(false);
      return r;
    } catch (err) {
      setNotice(errNotice(err));
      setBusy(false);
      return null;
    }
  };

  if (!data) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading</div>;
  const { thread, messages, draft, customer, sender, suggestions } = data;
  const preorderLines = data.preorder_lines || [];
  const mailEmail = status?.email;
  const locked = status?.sending_locked !== false; // locked on the server until an admin unlocks it (also the safe default)
  const sendOn = status?.settings?.send_enabled === true && !locked;
  const menuBtn = 'block w-full rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-slate-100 cursor-pointer disabled:opacity-50';
  const latest = messages.slice(-2);
  const earlier = messages.slice(0, -2);

  const saveCustomer = async (name, dearId, email) => {
    const r = await run(() => salesMail('save_customer', { name, dear_customer_id: dearId || undefined, emails: email ? [email] : [], thread_id: thread.id }),
      (x) => `Saved ${name}.${x.threads_updated ? ` ${x.threads_updated} email${x.threads_updated === 1 ? '' : 's'} moved under them.` : ''}${x.note ? ` ${x.note}` : ''}`);
    if (r) { await load(); onChanged(); }
  };
  const writeReply = async () => {
    const r = await run(() => salesMail('make_draft', { thread_id: thread.id, instructions: instructions.trim() || undefined }), 'I wrote a suggested reply below. Nothing has been sent.');
    if (r) { setInstructions(''); await load(); onChanged(); }
  };
  const setCategory = async (category) => { const r = await run(() => salesMail('set_category', { id: thread.id, category })); if (r) { await load(); onChanged(); } };
  const assign = async (assign, force) => {
    const r = await run(() => salesMail('assign_thread', { id: thread.id, assign, force }), assign ? "Okay, it's yours. Your colleagues will see you're handling it." : 'Let go.');
    if (r) { await load(); onChanged(); }
  };
  const archive = async (archived) => {
    setMenu(false);
    const r = await run(() => salesMail('archive_threads', { ids: [thread.id], archived }), archived ? 'Archived.' : 'Put back in your list.');
    if (r) { onChanged(); if (archived) onBack(); else await load(); }
  };
  const saveDraft = async () => { const r = await run(() => salesMail('save_draft', { id: draft.id, body, subject }), 'Saved.'); if (r) await load(); };
  const markSent = async () => { const r = await run(() => salesMail('mark_draft_sent', { id: draft.id }), 'Marked as sent. It is now waiting for the customer.'); if (r) { await load(); onChanged(); } };
  const discard = async () => { const r = await run(() => salesMail('discard_draft', { id: draft.id }), 'Discarded.'); if (r) { await load(); onChanged(); } };
  const copy = async () => { const ok = await copyText(body); setCopied(ok); if (!ok) setNotice({ type: 'error', text: "Couldn't copy. Select the text and press Ctrl+C." }); setTimeout(() => setCopied(false), 4000); };
  const send = async () => {
    if (!window.confirm(`Send this reply to ${draft.to_email} now?`)) return;
    const r = await run(() => salesMail('send_draft', { id: draft.id }), 'Sent.');
    if (r) { await load(); onChanged(); }
  };
  const mine = thread.assigned_name;

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start gap-2 border-b border-slate-100 p-3">
        <button type="button" onClick={onBack} aria-label="Back to the list" className="mt-0.5 cursor-pointer text-slate-500 lg:hidden"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-bold text-ink">{customer?.name || sender?.name || sender?.email || 'Unknown sender'}</h2>
          <div className="break-words text-sm text-slate-600">{thread.subject}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Pill cat={thread.category} />
            {mine && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700"><Clock size={11} />{mine} is handling it</span>}
          </div>
        </div>
        {!readOnly && (
        <div className="relative flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {!mine
            ? <button type="button" className={buttonPlain} disabled={busy} onClick={() => assign(true)}>I'll handle this</button>
            : <button type="button" className={buttonPlain} disabled={busy} onClick={() => assign(false)}>Let go</button>}
          {thread.category !== 'done'
            ? <button type="button" className={buttonPlain} disabled={busy} onClick={() => setCategory('done')}><Check size={14} />Mark as finished</button>
            : <button type="button" className={buttonPlain} disabled={busy} onClick={() => setCategory('reopen')}>Open it again</button>}
          <button type="button" className={buttonPlain} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>More</button>
          {menu && (
            <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg" onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false); }}>
              {thread.gmail_thread_id && mailEmail && <a role="menuitem" href={gmailLink(mailEmail, thread.gmail_thread_id)} target="_blank" rel="noopener noreferrer" className={menuBtn} onClick={() => setMenu(false)}>Open this email in Gmail</a>}
              {thread.assigned_to && <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={() => { setMenu(false); assign(true, true); }}>Take this over</button>}
              {thread.archived_at
                ? <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={() => archive(false)}>Put back in my list</button>
                : <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={() => archive(true)}>Archive (I don't need this)</button>}
            </div>
          )}
        </div>
        )}
      </div>
      {readOnly && <p className="mx-3 mt-3 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-700">View only. You can read this email, but the sales rep looks after the customer, so there is no reply or change button here.</p>}

      {!customer && !readOnly && (
        <div className="m-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p><b>This sender isn't saved as a customer yet,</b> so I haven't written a summary or a reply for this email. Save them and I will, and I'll do the same for their emails from now on.</p>
          {suggestions?.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-amber-900">Could this be one of your DEAR customers? Pick one only if you're sure.</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {suggestions.map((s) => <button key={s.dear_id} type="button" className={buttonPlain} disabled={busy} onClick={() => saveCustomer(s.name, s.dear_id, sender?.email)}>Save as {s.name}</button>)}
              </div>
            </div>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input className={inputClass} value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Customer or company name" aria-label="Customer name" />
            <input className={inputClass} value={custEmail} onChange={(e) => setCustEmail(e.target.value)} placeholder="Their email address" aria-label="Customer email address" />
            <button type="button" className={buttonPrimary} disabled={busy || !custName.trim() || !custEmail.trim()} onClick={() => saveCustomer(custName.trim(), null, custEmail.trim())}>Save as customer</button>
          </div>
        </div>
      )}

      {thread.summary && <div className="m-3 rounded-md bg-slate-50 p-2.5 text-sm text-slate-700"><b>Quick summary:</b> {thread.summary}{thread.reason ? <span className="text-slate-500"> ({thread.reason})</span> : null}</div>}

      <div className="space-y-3 p-3">
        {earlier.length > 0 && (
          <details className="rounded-lg border border-slate-200 p-2.5">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Show {earlier.length} earlier message{earlier.length === 1 ? '' : 's'}</summary>
            <div className="mt-2 space-y-3">{earlier.map((m) => <Message key={m.id} m={m} />)}</div>
          </details>
        )}
        {latest.map((m) => <Message key={m.id} m={m} />)}
        {messages.some((m) => (m.attachments || []).length) && <p className="text-xs text-slate-500">Open the email in Gmail to download attached files.</p>}
      </div>

      {!readOnly && (
      <div className="space-y-3 border-t border-slate-100 p-3">
        {draft ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-ink">Suggested reply</h3>
              <span className="text-xs text-slate-500">{sendOn ? 'Not sent until you press Send' : 'Drafts only: copy it into Gmail to send'}</span>
            </div>
            {draft.note && <p className="rounded-md bg-violet-50 p-2 text-sm text-violet-900"><b>Note:</b> {draft.note}</p>}
            {draft.needs_check && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">Fill in the <b>[[TO CHECK]]</b> parts first. I wasn't sure of those details.</p>}
            <div className="text-xs text-slate-500">To: {draft.to_email}</div>
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
            <textarea className={`${inputClass} min-h-[14rem] py-2 font-sans`} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Reply" />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonPrimary} disabled={busy} onClick={copy}>{copied ? 'Copied' : 'Copy reply'}</button>
              {thread.gmail_thread_id && mailEmail && <a className={buttonPlain} href={gmailLink(mailEmail, thread.gmail_thread_id)} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}
              <button type="button" className={buttonPlain} disabled={busy || (body === draft.body && subject === draft.subject)} onClick={saveDraft}>Save my changes</button>
              {sendOn && <button type="button" className={buttonPrimary} disabled={busy || draft.needs_check} onClick={send}>Send</button>}
              {!sendOn && <button type="button" className={buttonPlain} disabled={busy || draft.needs_check} onClick={markSent}>I've sent it</button>}
              <button type="button" className={buttonPlain} disabled={busy} onClick={discard}><Trash2 size={14} />Discard</button>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input className={`${inputClass} flex-1`} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Ask for a different version, e.g. offer 500 and mention the next delivery" aria-label="Ask for a different version" />
              <button type="button" className={buttonPlain} disabled={busy} onClick={writeReply}><Sparkles size={14} />Write it again</button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-sm font-bold text-ink">Write a reply</h3>
            <p className="text-xs text-slate-500">I look up stock, prices and delivery dates for you. You read it before anything goes anywhere.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${inputClass} flex-1`} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Say what you want to tell them, or leave this blank" aria-label="What to say" />
              <button type="button" className={buttonPrimary} disabled={busy} onClick={writeReply}><Sparkles size={14} />{busy ? 'Writing' : 'Write a reply for me'}</button>
            </div>
          </>
        )}
      </div>
      )}
      <PreOrderPanel thread={thread} lines={preorderLines} readOnly={readOnly} busy={busy} run={run} reload={load} />
    </div>
  );
}

// ------------------------------------------------------------------------------ pre-order
// What the customer wants, line by line, so a 2PRE manager can place the order. Reps read it from the email and fix it;
// managers only see it. Every line shows the customer's own words so it can be checked.
function PreOrderPanel({ thread, lines, readOnly, busy, run, reload }) {
  const [edits, setEdits] = useState({});
  const [adding, setAdding] = useState({ product_text: '', sku: '', qty: '', wanted_by: '' });
  if (readOnly && !lines.length) return null;
  const val = (l, k) => (edits[l.id]?.[k] ?? (k === 'qty' ? (l.qty ?? '') : (l[k] ?? '')));
  const set = (l, k, v) => setEdits((e) => ({ ...e, [l.id]: { ...e[l.id], [k]: v } }));
  const dirty = (l) => !!edits[l.id] && Object.keys(edits[l.id]).length > 0;

  const read = async () => {
    const r = await run(() => salesMail('extract_preorder', { thread_id: thread.id }),
      (x) => (x.found ? `I found ${x.found} product${x.found === 1 ? '' : 's'} they want.${x.without_quantity ? ` ${x.without_quantity} had no number, so fill those in.` : ''} Check each against the email.` : "I couldn't find any products they want in this email."));
    if (r) { setEdits({}); await reload(); }
  };
  const save = async (l) => {
    const r = await run(() => salesMail('save_preorder_line', { id: l.id, thread_id: thread.id, product_text: val(l, 'product_text'), sku: String(val(l, 'sku') || '').trim() || undefined, qty: val(l, 'qty') === '' ? undefined : Number(val(l, 'qty')), wanted_by: val(l, 'wanted_by') || undefined }), 'Saved.');
    if (r) { setEdits((e) => { const n = { ...e }; delete n[l.id]; return n; }); await reload(); }
  };
  const remove = async (l) => { const r = await run(() => salesMail('delete_preorder_line', { id: l.id }), 'Removed.'); if (r) await reload(); };
  const add = async () => {
    const r = await run(() => salesMail('save_preorder_line', { thread_id: thread.id, product_text: adding.product_text, sku: adding.sku.trim() || undefined, qty: adding.qty === '' ? undefined : Number(adding.qty), wanted_by: adding.wanted_by || undefined }), 'Added.');
    if (r) { setAdding({ product_text: '', sku: '', qty: '', wanted_by: '' }); await reload(); }
  };

  return (
    <div className="space-y-3 border-t border-slate-100 p-3" aria-label="Pre-order">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Pre-order</h3>
        {!readOnly && <button type="button" className={buttonPlain} disabled={busy} onClick={read}><Sparkles size={14} />{lines.length ? 'Read the email again' : 'Read what they want'}</button>}
      </div>
      <p className="text-xs text-slate-500">{readOnly ? 'What the customer asked for. The sales rep keeps this up to date.' : 'I list what the customer asks for, so a 2PRE manager can place the order. Check each line against the email.'}</p>
      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.id} className="rounded-lg border border-slate-200 p-2.5">
            {readOnly ? (
              <div className="text-sm text-ink">
                <b>{l.product_name || l.product_text}</b>{l.sku ? <span className="ml-1.5 text-xs text-slate-500">{String(l.sku).trim()}</span> : <span className="ml-1.5 text-xs text-amber-800">not matched to a product</span>}
                <span className="ml-2">{l.qty != null ? `${l.qty}` : 'no quantity yet'}</span>
                {l.wanted_by && <span className="ml-2 text-slate-600">by {l.wanted_by}</span>}
                {l.ordered && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-800">Ordered{l.po_number ? ` on ${l.po_number}` : ''}</span>}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_6rem_9rem_auto]">
                <input className={`${inputClass} !min-h-[2.25rem]`} value={val(l, 'product_text')} onChange={(e) => set(l, 'product_text', e.target.value)} aria-label="What the customer wants" />
                <input className={`${inputClass} !min-h-[2.25rem]`} value={val(l, 'sku') || ''} placeholder="Product code" onChange={(e) => set(l, 'sku', e.target.value)} aria-label="Product code" />
                <input className={`${inputClass} !min-h-[2.25rem]`} type="number" min="0" value={val(l, 'qty')} placeholder="How many" onChange={(e) => set(l, 'qty', e.target.value)} aria-label="How many" />
                <input className={`${inputClass} !min-h-[2.25rem]`} type="date" value={val(l, 'wanted_by') || ''} onChange={(e) => set(l, 'wanted_by', e.target.value)} aria-label="Wanted by" />
                <div className="flex gap-1.5">
                  <button type="button" className={buttonPlain} disabled={busy || !dirty(l)} onClick={() => save(l)}>Save</button>
                  <button type="button" className={buttonPlain} disabled={busy} aria-label="Remove this line" onClick={() => remove(l)}><Trash2 size={14} /></button>
                </div>
              </div>
            )}
            {l.sentence && <p className="mt-1.5 text-xs text-slate-500">They wrote: "{l.sentence}"</p>}
            {!readOnly && !l.sku && <p className="mt-1 text-xs text-amber-800">Not matched to one of our products yet. Type the product code so the totals can be worked out.</p>}
          </li>
        ))}
        {lines.length === 0 && <li className="text-sm text-slate-500">No lines yet. Press <b>Read what they want</b>, or add one below.</li>}
      </ul>
      {!readOnly && (
        <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_6rem_9rem_auto]">
          <input className={`${inputClass} !min-h-[2.25rem]`} value={adding.product_text} onChange={(e) => setAdding({ ...adding, product_text: e.target.value })} placeholder="Add a product they want" aria-label="Add a product they want" />
          <input className={`${inputClass} !min-h-[2.25rem]`} value={adding.sku} onChange={(e) => setAdding({ ...adding, sku: e.target.value })} placeholder="Product code" aria-label="New line product code" />
          <input className={`${inputClass} !min-h-[2.25rem]`} type="number" min="0" value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value })} placeholder="How many" aria-label="New line quantity" />
          <input className={`${inputClass} !min-h-[2.25rem]`} type="date" value={adding.wanted_by} onChange={(e) => setAdding({ ...adding, wanted_by: e.target.value })} aria-label="New line wanted by" />
          <button type="button" className={buttonPlain} disabled={busy || !adding.product_text.trim()} onClick={add}>Add</button>
        </div>
      )}
    </div>
  );
}

function Message({ m }) {
  return (
    <article className={`rounded-lg border p-3 ${m.is_from_us ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">{m.is_from_us ? 'Us' : m.from_name || m.from_addr}</span>
        <span>{new Date(m.sent_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <div className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink">{m.body}</div>
      {(m.attachments || []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.attachments.map((a, i) => <span key={i} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"><Paperclip size={11} />{a.name}</span>)}
        </div>
      )}
    </article>
  );
}

// ------------------------------------------------------------------------------ customers
function CustomersView({ setNotice, status, onChanged, readOnly }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState({});

  const load = useCallback(async () => { try { setList((await salesMail('list_customers')).customers); } catch (err) { setNotice(errNotice(err)); } }, [setNotice]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try { await fn(); if (ok) setNotice({ type: 'success', text: ok }); await load(); onChanged(); } catch (err) { setNotice(errNotice(err)); }
    setBusy(false);
  };

  if (!list) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;
  const term = q.trim().toLowerCase();
  const shown = list.filter((c) => !term || c.name.toLowerCase().includes(term) || c.contacts.some((x) => x.email.includes(term)));

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <h2 className="text-base font-bold text-ink">Customers</h2>
        <p className="text-sm text-slate-600">I only read emails from the addresses saved here. {status?.dear_names_loaded ? 'DEAR customer names are loaded, so I can suggest who a new sender might be.' : 'The DEAR customer names load automatically the first time emails are checked.'}</p>
        {!readOnly && <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer or company name" aria-label="New customer name" />
          <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Their email address" aria-label="New customer email address" />
          <button type="button" className={buttonPrimary} disabled={busy || !name.trim() || !email.trim()}
            onClick={() => run(async () => { await salesMail('save_customer', { name: name.trim(), emails: [email.trim()] }); setName(''); setEmail(''); }, 'Customer saved.')}>Add customer</button>
        </div>}
      </div>
      <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers or addresses" aria-label="Search customers" />
      <ul className="space-y-2">
        {shown.map((c) => (
          <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-ink">{c.name}</span>
              {!readOnly && <button type="button" className="cursor-pointer text-xs font-semibold text-red-700 hover:underline" disabled={busy}
                onClick={() => window.confirm(`Delete ${c.name}? Their emails will go back to "Not sure who this is".`) && run(() => salesMail('delete_customer', { id: c.id }), 'Customer deleted.')}>Delete</button>}
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {c.contacts.map((x) => (
                <li key={x.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  {x.email}
                  {!readOnly && <button type="button" aria-label={`Remove ${x.email}`} className="cursor-pointer text-slate-400 hover:text-red-600" disabled={busy} onClick={() => run(() => salesMail('remove_contact', { id: x.id }))}>×</button>}
                </li>
              ))}
            </ul>
            {!readOnly && <div className="mt-2 flex gap-2">
              <input className={`${inputClass} !min-h-[2.25rem]`} value={adding[c.id] || ''} onChange={(e) => setAdding({ ...adding, [c.id]: e.target.value })} placeholder="Add another email address" aria-label={`Add an email address for ${c.name}`} />
              <button type="button" className={buttonPlain} disabled={busy || !(adding[c.id] || '').trim()}
                onClick={() => run(async () => { await salesMail('add_contact', { customer_id: c.id, email: adding[c.id] }); setAdding({ ...adding, [c.id]: '' }); })}>Add</button>
            </div>}
          </li>
        ))}
        {shown.length === 0 && <li className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{list.length ? 'No customers match.' : 'No customers saved yet. Add one above, or open an email from someone new and save them from there.'}</li>}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------------------ setup
function SetupView({ status, reload, setNotice }) {
  const [signature, setSignature] = useState(status?.settings?.signature || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSignature(status?.settings?.signature || ''); }, [status?.settings?.signature]);
  if (!status) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;

  const run = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try { await fn(); if (ok) setNotice({ type: 'success', text: ok }); await reload(); } catch (err) { setNotice(errNotice(err)); }
    setBusy(false);
  };
  const connect = async () => {
    setBusy(true);
    try { window.location.assign((await salesMail('mail_connect_url')).url); } catch (err) { setNotice(errNotice(err)); setBusy(false); }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-base font-bold text-ink">The sales mailbox</h2>
        {status.connected ? (
          <>
            <p className="text-sm text-slate-700">Connected to <b>{status.email}</b>.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonPlain} disabled={busy} onClick={connect}>Connect again</button>
              {status.can_change_sending && <button type="button" className={buttonPlain} disabled={busy} onClick={() => window.confirm('Disconnect the sales mailbox? Emails stop coming in until it is connected again.') && run(() => salesMail('mail_disconnect'), 'Disconnected.')}>Disconnect</button>}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-700">Not connected yet. When you press the button, sign in to Google <b>with the sales@ account</b>. It asks to <b>read</b> email only; it can't send.</p>
            {!status.google_configured && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">An admin needs to finish the Google set-up for the sales mailbox first. The sales@ account is in a different Google workspace from ops@, so it needs its own Google client. The steps are in the install notes.</p>}
            <button type="button" className={buttonPrimary} disabled={busy || !status.google_configured} onClick={connect}>Connect the sales mailbox</button>
          </>
        )}
        {!status.ai_configured && <p className="text-sm text-amber-900">The assistant isn't switched on yet, so emails are sorted but not read. Your admin needs to add the AI key.</p>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-base font-bold text-ink">Replies</h2>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={status.settings.auto_draft} disabled={busy} onChange={(e) => run(() => salesMail('save_mail_settings', { auto_draft: e.target.checked }), 'Saved.')} />
          <span>Write a suggested reply automatically when a customer asks a question.</span>
        </label>
        <div>
          <label className="text-sm font-semibold text-ink" htmlFor="sales-signature">Sign-off added to every reply</label>
          <textarea id="sales-signature" className={`${inputClass} mt-1 min-h-[5rem] py-2`} value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={'Kind regards,\nSeaga Sales'} />
          <button type="button" className={`${buttonPlain} mt-2`} disabled={busy || signature === (status.settings.signature || '')} onClick={() => run(() => salesMail('save_mail_settings', { signature }), 'Saved.')}>Save sign-off</button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <h2 className="text-base font-bold text-ink">Sending</h2>
        {status.sending_locked !== false ? (
          <p className="text-sm text-slate-700">Sending is <b>locked</b>, so nothing can be sent from here. Suggested replies are drafts: copy them into Gmail and send them from there, then press <b>I've sent it</b>. An admin unlocks sending later, in the server settings.</p>
        ) : (
          <>
            <p className="text-sm text-slate-700">{status.settings.send_enabled ? 'Sending is switched on. A Send button appears on suggested replies, and nothing goes out until someone presses it.' : 'Sending is switched off. Suggested replies are drafts: copy them into Gmail and send them from there.'}</p>
            {status.can_change_sending
              ? <button type="button" className={buttonPlain} disabled={busy} onClick={() => window.confirm(status.settings.send_enabled ? 'Switch sending off? Replies go back to being copied into Gmail.' : 'Switch sending on? Staff will be able to send replies from this screen. Each one still needs a person to press Send.') && run(() => salesMail('save_mail_settings', { send_enabled: !status.settings.send_enabled }), status.settings.send_enabled ? 'Sending is off.' : 'Sending is on.')}>{status.settings.send_enabled ? 'Switch sending off' : 'Switch sending on'}</button>
              : <p className="text-xs text-slate-500">Only an admin can change this.</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ drafts
// Every saved suggested reply in one place. Nothing here is sent by itself.
function DraftsView({ status, setNotice, onOpen, onChanged }) {
  const locked = status?.sending_locked !== false;
  const [drafts, setDrafts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const load = useCallback(async () => {
    try { setDrafts((await salesMail('list_drafts')).drafts); } catch (err) { setNotice(errNotice(err)); setDrafts([]); }
  }, [setNotice]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try { await fn(); if (ok) setNotice({ type: 'success', text: ok }); await load(); onChanged(); } catch (err) { setNotice(errNotice(err)); }
    setBusy(false);
  };
  const copy = async (d) => {
    const ok = await copyText(d.body);
    setCopied(ok ? d.id : '');
    setTimeout(() => setCopied(''), 3000);
    if (!ok) setNotice({ type: 'error', text: "Couldn't copy. Select the text and press Ctrl+C." });
  };
  if (!drafts) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-bold text-ink">Drafts</h2>
        <p className="text-sm text-slate-600">Every suggested reply I've written that hasn't gone out. {locked ? "Sending is switched off for now: copy a reply, send it from Gmail, then press I've sent it." : 'Nothing is sent until you open it and press Send.'}</p>
      </div>
      {drafts.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No drafts waiting.</p>}
      <ul className="space-y-2">
        {drafts.map((d) => (
          <li key={d.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold text-ink">{d.customer_name || d.to_email}</div>
                <div className="break-words text-xs text-slate-600">{d.thread_subject || d.subject}</div>
                <div className="mt-0.5 text-xs text-slate-500">To: {d.to_email} · {timeAgo(d.updated_at)} ago{d.edited ? ' · edited by you' : ''}</div>
              </div>
              {d.needs_check && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-800">Needs checking</span>}
            </div>
            {d.note && <p className="mt-1.5 text-xs text-violet-900">Note: {d.note}</p>}
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-semibold text-blue-700">Read the reply</summary>
              <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-slate-50 p-2.5 font-sans text-sm text-ink">{d.body}</pre>
            </details>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={buttonPlain} disabled={busy} onClick={() => onOpen(d.thread_id)}>Open the email</button>
              {locked && <button type="button" className={buttonPlain} disabled={busy || d.needs_check} onClick={() => copy(d)}>{copied === d.id ? 'Copied' : 'Copy reply'}</button>}
              {locked && <button type="button" className={buttonPlain} disabled={busy || d.needs_check} onClick={() => act(() => salesMail('mark_draft_sent', { id: d.id }), 'Marked as sent.')}>I've sent it</button>}
              <button type="button" className={buttonPlain} disabled={busy} onClick={() => window.confirm('Discard this draft?') && act(() => salesMail('discard_draft', { id: d.id }), 'Draft discarded.')}><Trash2 size={14} />Discard</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

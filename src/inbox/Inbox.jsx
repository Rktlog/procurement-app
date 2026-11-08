import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Send, Check, Paperclip, Sparkles, ArrowLeft, Trash2, Download, Clock, ExternalLink } from 'lucide-react';
import { inbox, inputClass, buttonPrimary, buttonPlain, fmtDateTime, timeAgo } from './api';

const CAT = {
  new: ['Reading it', 'bg-slate-100 text-slate-700'],
  needs_reply: ['Needs your reply', 'bg-amber-100 text-amber-800'],
  waiting: ['Waiting for the supplier', 'bg-blue-100 text-blue-800'],
  fyi: ['For your information', 'bg-slate-100 text-slate-700'],
  done: ['Finished', 'bg-emerald-100 text-emerald-800'],
};
// Opens a conversation in Gmail itself, in the connected account.
const gmailLink = (email, threadId) => `https://mail.google.com/mail/u/${encodeURIComponent(email)}/#all/${threadId}`;

// A typed supplier name either matches a Cin7 supplier (linked to it) or is a new custom supplier.
const nameKey = (s) => String(s || '').trim().toLowerCase();
const supplierPayload = (name, suppliers) => {
  const hit = suppliers.find((x) => nameKey(x.name) === nameKey(name));
  return hit ? { supplier_id: hit.id, label: '' } : { supplier_id: '', label: String(name || '').trim() };
};
const isCin7Supplier = (name, suppliers) => suppliers.some((x) => nameKey(x.name) === nameKey(name));

const fmtDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'No date');

const FILTERS = [['attention', 'Needs your reply'], ['waiting', 'Waiting for the supplier'], ['fyi', 'For your information'], ['done', 'Finished'], ['', 'Everything']];
const errNotice = (err) => ({ type: 'error', text: err.friendly || err.message, detail: err.technical || null });

const Pill = ({ cat }) => {
  const [label, tone] = CAT[cat] || CAT.new;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${tone}`}>{label}</span>;
};
const Notice = ({ n }) =>
  n ? (
    <div role={n.type === 'error' ? 'alert' : 'status'} className={`p-3 text-sm rounded-md border ${n.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
      {n.text}
      {n.type === 'error' && n.detail && n.detail !== n.text && (
        <details className="mt-1 text-xs opacity-80"><summary className="cursor-pointer">Show details for support</summary><span className="break-words">{n.detail}</span></details>
      )}
    </div>
  ) : null;

// Supplier inbox: Gmail stays the source. This groups it by supplier, says what
// needs a reply, drafts the replies, and lists today's jobs. Nothing is sent
// until a person clicks Send.
export default function Inbox() {
  const [params] = useSearchParams();
  const [mail, setMail] = useState(null);
  const [overview, setOverview] = useState(null);
  const [view, setView] = useState('today'); // today | all | unmatched | s:<id> | f:<label> | settings
  const [filter, setFilter] = useState('attention');
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoFind, setAutoFind] = useState(false);
  const [freightFocus, setFreightFocus] = useState('');
  const [checked, setChecked] = useState(() => new Set());
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState(
    params.get('gmail') ? { type: 'success', text: 'Gmail is connected.' }
      : params.get('gmail_error') ? { type: 'error', text: `Gmail wasn't connected: ${params.get('gmail_error')}` } : null
  );

  const loadStatus = useCallback(async () => {
    try { setMail(await inbox('mail_status')); } catch (err) { setNotice(errNotice(err)); }
  }, []);
  const loadOverview = useCallback(async () => {
    try { setOverview(await inbox('inbox_overview')); } catch (err) { setNotice(errNotice(err)); }
  }, []);
  const loadThreads = useCallback(async () => {
    if (['today', 'settings', 'freight', 'pos'].includes(view)) return;
    try { setThreads((await inbox('list_threads', { group: view, category: filter })).threads); }
    catch (err) { setNotice(errNotice(err)); }
  }, [view, filter]);

  useEffect(() => { loadStatus(); loadOverview(); }, [loadStatus, loadOverview]);
  // A link such as /inbox/mail?thread=... (from the purchase order page) opens that email straight away.
  useEffect(() => {
    const t = params.get('thread');
    if (t) { setView('all'); setFilter(''); setSelectedId(t); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadThreads(); }, [loadThreads]);

  const refreshAll = useCallback(async () => { await Promise.all([loadStatus(), loadOverview(), loadThreads()]); }, [loadStatus, loadOverview, loadThreads]);

  // Reads new mail, then has Claude read and draft. Repeats until it has caught up.
  const syncNow = async () => {
    setBusy(true);
    setNotice(null);
    try {
      let last = null;
      for (let i = 0; i < 8; i++) {
        setProgress(i === 0 ? 'Reading Gmail' : `Still working (round ${i + 1})`);
        last = await inbox('run_pipeline');
        if (last.done) break;
      }
      await inbox('build_todo');
      const s = last?.sync, t = last?.triage;
      setNotice({ type: 'success', text: `Looked at ${s?.listed ?? 0} emails; ${s?.synced ?? 0} were new or changed. I read ${t?.triaged ?? 0} and wrote ${t?.drafted ?? 0} suggested replies.${t?.failed ? ` ${t.failed} couldn't be read and will be retried.` : ''}` });
    } catch (err) {
      setNotice(errNotice(err));
    }
    setProgress('');
    setBusy(false);
    refreshAll();
  };

  const groups = overview?.groups || [];
  const sup = groups.filter((g) => g.kind === 'supplier').sort((a, b) => b.needs - a.needs || a.label.localeCompare(b.label));
  const fwd = groups.filter((g) => g.kind === 'forwarder');
  const unmatched = groups.find((g) => g.kind === 'unmatched');
  const selfGroup = groups.find((g) => g.kind === 'self');
  const snoozedCount = overview?.snoozed || 0;
  const totalNeeds = groups.reduce((n, g) => (g.kind === 'unmatched' ? n : n + g.needs), 0);

  const pick = (v) => {
    setView(v); setSelectedId(null); setChecked(new Set());
    if (v === 'self' || v === 'archived' || v === 'snoozed') setFilter('');
    else if (view === 'self' || view === 'archived' || view === 'snoozed') setFilter('attention');
  };
  useEffect(() => { setChecked(new Set()); }, [filter]);
  const snoozeChecked = async (until) => {
    const ids = [...checked];
    if (!ids.length) return;
    setBusy(true);
    setNotice(null);
    try {
      await inbox('snooze_threads', { ids, until });
      setNotice({ type: 'success', text: until === 'clear' ? 'They are back in your list.' : `Done. They will come back ${until === 'tomorrow' ? 'tomorrow morning' : until === '3days' ? 'in 3 days' : 'next Monday'}, or sooner if the supplier writes again.` });
      setChecked(new Set());
      await refreshAll();
    } catch (err) { setNotice(errNotice(err)); }
    setBusy(false);
  };
  const archiveChecked = async ({ archived, ignore }) => {
    const ids = [...checked];
    if (!ids.length) return;
    if (ignore && !window.confirm(`Archive these ${ids.length} and hide future emails from their senders? Emails from them will go straight to Archived and I won't read them. You can undo this under Setup.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await inbox('archive_threads', { ids, archived, ignore });
      setNotice({ type: 'success', text: archived
        ? `Archived ${r.archived}.${r.ignored_senders ? ` Ignoring ${r.ignored_senders} sender(s)${r.also_archived ? ` and archived ${r.also_archived} more from them` : ''}.` : ''}`
        : `Put ${r.restored} back in your list.` });
      setChecked(new Set());
      await refreshAll();
    } catch (err) {
      setNotice(errNotice(err));
    }
    setBusy(false);
  };
  const openFreight = (po) => { setFreightFocus(po || ''); setView('freight'); setSelectedId(null); };
  const findSuppliers = () => { setAutoFind(true); setView('settings'); setSelectedId(null); };
  const navBtn = (key, label, count, extra) => (
    <button key={key} type="button" onClick={() => pick(key)}
      className={`w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm cursor-pointer ${view === key ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-slate-700 hover:bg-slate-100'}`}>
      <span className="truncate">{label}</span>
      {count > 0 ? <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[0.7rem] font-bold text-white">{count}</span> : extra ? <span className="shrink-0 text-xs text-slate-400">{extra}</span> : null}
    </button>
  );

  if (!mail) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonPrimary} disabled={busy || !mail.connected} onClick={syncNow}>
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />{busy ? progress || 'Working' : 'Get new emails'}
        </button>
        <span className="text-xs text-slate-500">
          {mail.connected ? <>Connected as <b>{mail.email}</b>{mail.last_sync ? ` · last checked ${timeAgo(mail.last_sync)} ago` : ' · not checked yet'}</> : 'Gmail is not connected'}
        </span>
        {!mail.ai_configured && <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">The assistant isn't switched on yet (your admin needs to add the AI key). Mail will be sorted by supplier but not read.</span>}
      </div>
      <Notice n={notice} />

      <div className="grid gap-4 lg:grid-cols-[14rem_21rem_minmax(0,1fr)] items-start">
        {/* ------------------------------------------------------ left: groups */}
        <nav aria-label="Main menu" className={`rounded-xl border border-slate-200 bg-white p-2 space-y-0.5 ${selectedId ? 'hidden lg:block' : ''}`}>
          {navBtn('today', 'Today', 0, overview?.drafts_waiting ? `${overview.drafts_waiting} replies ready` : '')}
          {navBtn('all', 'All emails', totalNeeds)}
          {navBtn('pos', 'Purchase orders', 0, overview?.po_count ? String(overview.po_count) : '')}
          {navBtn('freight', 'Freight quotes', 0, overview?.freight_open ? `${overview.freight_open} open` : '')}
          {sup.length > 0 && <div className="px-2.5 pt-3 pb-1 text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Suppliers</div>}
          {sup.map((g) => navBtn(g.key, g.label, g.needs, g.waiting ? `${g.waiting} waiting` : ''))}
          {fwd.length > 0 && <div className="px-2.5 pt-3 pb-1 text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Forwarders</div>}
          {fwd.map((g) => navBtn(g.key, g.label, g.needs, g.waiting ? `${g.waiting} waiting` : ''))}
          <div className="px-2.5 pt-3 pb-1 text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Other</div>
          {unmatched && navBtn('unmatched', "People I don't know yet", 0, String(unmatched.total))}
          {snoozedCount > 0 && navBtn('snoozed', 'Remind me later', 0, String(snoozedCount))}
          {selfGroup && navBtn('self', 'Notes to myself', 0, String(selfGroup.total))}
          {navBtn('archived', 'Archived', 0, overview?.archived ? String(overview.archived) : '')}
          {navBtn('settings', 'Setup', 0)}
        </nav>

        {/* ----------------------------------------------- middle and right */}
        {view === 'pos' ? (
          <>
            <section aria-label="Purchase orders" className={`rounded-xl border border-slate-200 bg-white ${selectedId ? 'hidden lg:block' : ''}`}>
              <PosView selectedId={selectedId} onOpen={setSelectedId} setNotice={setNotice} />
            </section>
            <section aria-label="Conversation" className={selectedId ? '' : 'hidden lg:block'}>
              {selectedId ? (
                <ThreadView id={selectedId} mailEmail={mail.email} onFreight={openFreight} onBack={() => setSelectedId(null)} onChanged={loadOverview} setNotice={setNotice} />
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">Open a purchase order, then pick one of its emails.</div>
              )}
            </section>
          </>
        ) : view === 'freight' ? (
          <div className="lg:col-span-2"><FreightView mailEmail={mail.email} focus={freightFocus} setNotice={setNotice} onChanged={loadOverview}
            onOpenThread={(tid) => { setView('all'); setFilter(''); setSelectedId(tid); }} /></div>
        ) : view === 'settings' ? (
          <div className="lg:col-span-2"><SettingsView mail={mail} reloadStatus={loadStatus} onChanged={refreshAll} autoFind={autoFind} onFindStarted={() => setAutoFind(false)} /></div>
        ) : view === 'today' ? (
          <div className="lg:col-span-2"><TodayView go={pick} overview={overview} reload={loadOverview} onOpen={(id) => { setView('all'); setFilter(''); setSelectedId(id); }} connected={mail.connected} mail={mail} setNotice={setNotice} unfiled={unmatched?.total || 0} onFind={findSuppliers} /></div>
        ) : (
          <>
            <section aria-label="Conversations" className={`rounded-xl border border-slate-200 bg-white ${selectedId ? 'hidden lg:block' : ''}`}>
              {view !== 'self' && view !== 'archived' && view !== 'snoozed' && (
              <div className="flex flex-wrap gap-1 p-2 border-b border-slate-100">
                {FILTERS.map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setFilter(id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold cursor-pointer ${filter === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{label}</button>
                ))}
              </div>
              )}
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs">
                <label className="flex items-center gap-1.5 font-semibold text-slate-600">
                  <input type="checkbox" className="h-4 w-4" aria-label="Select all conversations shown" disabled={threads.length === 0}
                    checked={threads.length > 0 && checked.size === threads.length}
                    onChange={(e) => setChecked(e.target.checked ? new Set(threads.map((t) => t.id)) : new Set())} />Select all
                </label>
                {checked.size > 0 && (view === 'archived'
                  ? <button type="button" className="font-semibold text-blue-700 hover:underline cursor-pointer" disabled={busy} onClick={() => archiveChecked({ archived: false })}>Put back in my list ({checked.size})</button>
                  : view === 'snoozed'
                    ? <button type="button" className="font-semibold text-blue-700 hover:underline cursor-pointer" disabled={busy} onClick={() => snoozeChecked('clear')}>Show again now ({checked.size})</button>
                    : (
                      <>
                        <button type="button" className="font-semibold text-blue-700 hover:underline cursor-pointer" disabled={busy} onClick={() => archiveChecked({ archived: true })}>Archive ({checked.size})</button>
                        <button type="button" className="font-semibold text-blue-700 hover:underline cursor-pointer" disabled={busy} onClick={() => archiveChecked({ archived: true, ignore: true })}>Archive and hide these senders in future ({checked.size})</button>
                        <select aria-label="Remind me later" className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-semibold text-blue-700" value="" onChange={(e) => e.target.value && snoozeChecked(e.target.value)}>
                          <option value="">Remind me later…</option>
                          <option value="tomorrow">Tomorrow morning</option>
                          <option value="3days">In 3 days</option>
                          <option value="nextweek">Next Monday</option>
                        </select>
                      </>
                    ))}
              </div>
              <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
                {threads.map((t) => (
                  <li key={t.id} className="flex items-start">
                    <input type="checkbox" className="mt-3.5 ml-3 h-4 w-4 shrink-0" aria-label={`Select ${t.subject}`} checked={checked.has(t.id)}
                      onChange={(e) => setChecked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} />
                    <button type="button" onClick={() => setSelectedId(t.id)} className={`min-w-0 flex-1 text-left px-3 py-2.5 cursor-pointer ${selectedId === t.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{t.subject}</span>
                        <span className="shrink-0 text-xs text-slate-400">{timeAgo(t.last_message_at)}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-slate-600">{t.summary || t.snippet}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Pill cat={t.category} />
                        {t.urgency === 'high' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[0.7rem] font-semibold text-red-800">Urgent</span>}
                        {t.has_draft && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[0.7rem] font-semibold text-violet-800">Draft ready</span>}
                        {t.freight_detected && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[0.7rem] font-semibold text-sky-800">Has shipment details</span>}
                        {t.payment_risk && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[0.7rem] font-semibold text-red-800">Check payment details</span>}
                        {t.has_attachments && <Paperclip size={12} className="text-slate-400" aria-label="Has attachments" />}
                      </div>
                    </button>
                  </li>
                ))}
                {threads.length === 0 && <li className="p-6 text-center text-sm text-slate-500">{filter === 'attention' ? "You're all caught up. Nothing needs your reply." : 'Nothing here.'}</li>}
              </ul>
            </section>
            <section aria-label="Conversation" className={selectedId ? '' : 'hidden lg:block'}>
              {selectedId ? (
                <ThreadView id={selectedId} mailEmail={mail.email} onFreight={openFreight} onBack={() => setSelectedId(null)} onChanged={() => { loadThreads(); loadOverview(); }} setNotice={setNotice} />
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">Pick a conversation.</div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ today
function TodayView({ go, overview, reload, onOpen, connected, mail, setNotice, unfiled, onFind }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { await fn(); await reload(); } catch (err) { setNotice(errNotice(err)); } setBusy(false); };
  if (!overview) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;
  if (!connected) return <ConnectCard mail={mail} setNotice={setNotice} />;

  const today = overview.todos.filter((t) => t.for_date === overview.today);
  const carried = overview.todos.filter((t) => t.for_date !== overview.today && !t.done);
  const needsReply = overview.groups.filter((g) => g.kind === 'supplier' || g.kind === 'forwarder').reduce((n, g) => n + g.needs, 0);
  const hour = Number(new Date().toLocaleString('en-AU', { hour: 'numeric', hour12: false, timeZone: 'Australia/Melbourne' }));
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const cards = [
    { n: overview.drafts_waiting || 0, label: 'Suggested replies ready', hint: 'Read them, change anything, then send', view: 'all', tone: 'border-violet-200 bg-violet-50 text-violet-900' },
    { n: needsReply, label: 'Emails waiting for your reply', hint: 'Suppliers and forwarders waiting on you', view: 'all', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
    { n: overview.freight_open || 0, label: 'Freight quotes in progress', hint: 'Check the box sizes, then ask for a price', view: 'freight', tone: 'border-sky-200 bg-sky-50 text-sky-900' },
  ];
  const Item = ({ t }) => (
    <li className="flex items-start gap-3 py-2.5">
      <input type="checkbox" className="mt-1 h-5 w-5 cursor-pointer" checked={t.done} disabled={busy} aria-label={`Done: ${t.text}`}
        onChange={(e) => run(() => inbox('toggle_todo', { id: t.id, done: e.target.checked }))} />
      <div className="min-w-0 flex-1">
        <div className={`text-[0.95rem] leading-snug ${t.done ? 'line-through text-slate-400' : 'text-ink'}`}>{t.text}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          {t.priority === 'high' && <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800">Do first</span>}
          {t.source === 'manual' && <span className="text-slate-400">Added by you</span>}
          {t.thread_id && <button type="button" className="font-semibold text-blue-700 hover:underline cursor-pointer" onClick={() => onOpen(t.thread_id)}>Open the email</button>}
          {t.gmail_thread_id && mail.email && <a href={gmailLink(mail.email, t.gmail_thread_id)} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">Open in Gmail</a>}
        </div>
      </div>
      <button type="button" aria-label="Remove this" className="text-slate-300 hover:text-red-600 cursor-pointer" onClick={() => run(() => inbox('delete_todo', { id: t.id }))}><Trash2 size={15} /></button>
    </li>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-ink">{hello}</h2>
        <p className="text-sm text-slate-600">Here is what needs you today.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <button key={c.label} type="button" onClick={() => go(c.view)} className={`rounded-xl border p-3.5 text-left cursor-pointer hover:shadow-sm ${c.tone}`}>
            <span className="block text-3xl font-bold leading-none">{c.n}</span>
            <span className="mt-1.5 block text-sm font-semibold">{c.label}</span>
            <span className="mt-0.5 block text-xs opacity-80">{c.hint}</span>
          </button>
        ))}
      </div>

      {unfiled > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-amber-950">{unfiled} emails are from people I don't know yet</div>
            <div className="text-xs text-amber-900">I only read emails from suppliers and forwarders you've saved. I can suggest who each person is, and you approve every one.</div>
          </div>
          <button type="button" className={buttonPrimary} onClick={onFind}><Sparkles size={14} />Work out who they are</button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink">Your to-do list for today</h2>
          <button type="button" className={buttonPlain} disabled={busy} onClick={() => run(() => inbox('build_todo', { force: true }))}><Sparkles size={14} />Refresh my list</button>
        </div>
        {today.length === 0 && carried.length === 0 && <p className="text-sm text-slate-500">Nothing here yet. Your list is made each morning from your emails, or press Refresh my list.</p>}
        <ul className="divide-y divide-slate-100">{today.map((t) => <Item key={t.id} t={t} />)}</ul>
        {carried.length > 0 && (
          <div>
            <div className="text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Still to do from earlier</div>
            <ul className="divide-y divide-slate-100">{carried.map((t) => <Item key={t.id} t={t} />)}</ul>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <input className={inputClass} value={text} placeholder="Add something to your list" aria-label="Add something to your list" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) run(async () => { await inbox('add_todo', { text }); setText(''); }); }} />
          <button type="button" className={buttonPlain} disabled={busy || !text.trim()} onClick={() => run(async () => { await inbox('add_todo', { text }); setText(''); })}>Add</button>
        </div>
      </div>

      <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-blue-700">New here? How this works</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-700">
          <li>Press <b>Get new emails</b> at the top. It brings in your latest supplier emails.</li>
          <li>When an email needs an answer, I write a suggested reply. Open it, read it, change anything you like, then press <b>Send</b>. <b>Nothing is ever sent unless you press Send.</b></li>
          <li>Don't need an email? Press <b>More</b> on it, then <b>Archive</b>, or ask me to <b>remind you later</b>.</li>
          <li>When a supplier sends box sizes and weights, open <b>Freight quotes</b> to ask the forwarders for a price.</li>
          <li>Under <b>Purchase orders</b> you can see each order and every email about it.</li>
        </ol>
      </details>
    </div>
  );
}

// ----------------------------------------------------------------- thread
function ThreadView({ id, mailEmail, onFreight, onBack, onChanged, setNotice }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState(null);
  const [poInput, setPoInput] = useState('');
  const [busyFile, setBusyFile] = useState(null);
  const [menu, setMenu] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    try { const r = await inbox('get_thread', { id }); setData(r); setDraft(r.draft); } catch (err) { setNotice(errNotice(err)); }
  }, [id, setNotice]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try { const r = await fn(); if (ok) setNotice({ type: 'success', text: ok }); return r; }
    catch (err) { setNotice(errNotice(err)); }
    finally { setBusy(false); }
  };

  if (!data) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading</div>;
  const { thread, messages, purchase_orders: pos } = data;
  const known = !!(thread.supplier_id || thread.group_label);
  const hasPlaceholder = /\[\[/.test(draft?.body || '');
  const setDraftField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const generate = async () => {
    const r = await run(() => inbox('draft_reply', { thread_id: thread.id, instructions }), 'Draft written. Read it before sending.');
    if (r) { setDraft(r.draft); setInstructions(''); onChanged(); }
  };
  const save = () => run(() => inbox('save_draft', { id: draft.id, to_email: draft.to_email, cc_email: draft.cc_email || '', subject: draft.subject, body: draft.body }), 'Draft saved.');
  const send = async () => {
    if (!window.confirm(`Send this email to ${draft.to_email}${draft.cc_email ? ` (cc ${draft.cc_email})` : ''}?`)) return;
    const r = await run(() => inbox('send_draft', { id: draft.id, to_email: draft.to_email, cc_email: draft.cc_email || '', subject: draft.subject, body: draft.body }), 'Sent.');
    if (r) { setDraft(null); await load(); onChanged(); }
  };
  const discard = async () => { const r = await run(() => inbox('discard_draft', { id: draft.id }), 'Draft discarded.'); if (r) { setDraft(null); onChanged(); } };
  const makeFreight = async () => {
    const r = await run(() => inbox('freight_extract', { thread_id: thread.id }));
    if (!r) return;
    const added = [...r.created, ...r.updated];
    const files = r.read?.files?.length ? ` and ${r.read.files.join(', ')}` : '';
    setNotice({ type: 'success', text: `Added to Freight quotes: ${added.join(', ') || 'nothing new'}. I read ${r.read?.messages ?? 0} message(s)${files}. Found ${r.found_count ?? added.length} PO(s). Check every number against the source before sending.${r.no_details?.length ? ` No skid details were found for ${r.no_details.join(', ')}; fill those in.` : ''}${r.blanked ? ` ${r.blanked} number(s) weren't found in the text, so I left them blank.` : ''}${r.read?.skipped?.length ? ` Couldn't read: ${r.read.skipped.join(', ')}.` : ''}${r.skipped.length ? ` Skipped: ${r.skipped.join(', ')}.` : ''}${r.drafts?.made?.length ? ` Draft quote requests are ready (not sent): ${r.drafts.made.join(', ')}.` : ''}${r.drafts?.needs_attention?.length ? ` Needs you: ${r.drafts.needs_attention.join('; ')}.` : ''}` });
    onChanged();
    onFreight(r.first);
  };
  const poTags = data.pos || [];
  const linkPo = async (po, linked) => {
    const r = await run(() => inbox('po_link', { thread_id: thread.id, po_number: po, linked }));
    if (r) { setPoInput(''); await load(); onChanged(); }
  };
  // The file comes from Gmail through the function and is saved by your browser as a download. It is never opened here.
  const downloadFile = async (messageId, index, name) => {
    setBusyFile(`${messageId}-${index}`);
    setNotice(null);
    try {
      const r = await inbox('attachment_download', { message_id: messageId, index });
      const bin = atob(r.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.name || name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      setNotice(errNotice(err));
    }
    setBusyFile(null);
  };
  const menuBtn = 'block w-full rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-slate-100 cursor-pointer disabled:opacity-50';
  const snooze = async (until) => {
    setMenu(false);
    const r = await run(() => inbox('snooze_threads', { ids: [thread.id], until }));
    if (!r) return;
    setNotice({ type: 'success', text: until === 'clear' ? 'It is back in your list.' : `Okay. I'll bring this back ${until === 'tomorrow' ? 'tomorrow morning' : until === '3days' ? 'in 3 days' : 'next Monday'}, or sooner if they write again.` });
    onChanged();
    if (until !== 'clear') onBack();
  };
  const snoozedNow = !!thread.snoozed_until && new Date(thread.snoozed_until) > new Date();
  const archive = async (ignore) => {
    setMenu(false);
    if (ignore && !window.confirm('Archive this and hide future emails from this sender? Their emails will go straight to Archived and I won\'t read them. You can undo this under Setup.')) return;
    const r = await run(() => inbox('archive_threads', { ids: [thread.id], archived: true, ignore }));
    if (!r) return;
    setNotice({ type: 'success', text: ignore ? `Archived. Future emails from this sender will go straight to Archived.${r.also_archived ? ` ${r.also_archived} other email(s) from them were archived too.` : ''}` : 'Archived.' });
    onChanged();
    onBack();
  };
  const restore = async () => { setMenu(false); const r = await run(() => inbox('archive_threads', { ids: [thread.id], archived: false }), 'Put back in your list.'); if (r) { await load(); onChanged(); } };
  const addToTodo = () => { setMenu(false); return run(() => inbox('add_todo', { text: thread.subject, thread_id: thread.id }), 'Added to your to-do list.'); };
  const setCategory = async (category) => { const r = await run(() => inbox('set_thread_category', { id: thread.id, category })); if (r) { await load(); onChanged(); } };

  const latest = messages.slice(-2);
  const earlier = messages.slice(0, -2);
  const renderMsg = (m) => (
        <article key={m.id} className={`rounded-lg border p-3 ${m.is_from_us ? 'border-blue-100 bg-blue-50/50' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{m.is_from_us ? 'You' : m.from_name || m.from_addr}</span>
              <span>{fmtDateTime(m.sent_at)}</span>
            </div>
            <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-sm text-ink">{m.body || '(no text)'}</pre>
            {m.attachments?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.attachments.map((a, i) => (
                  <button key={i} type="button" title="Download" disabled={busyFile === `${m.id}-${i}`} onClick={() => downloadFile(m.id, i, a.name)}
                    className="inline-flex items-center gap-1 rounded bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-xs text-slate-700 cursor-pointer disabled:opacity-60">
                    <Paperclip size={11} />{a.name}<Download size={11} />
                  </button>
                ))}
              </div>
            )}
        </article>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start gap-2 border-b border-slate-100 p-3">
        <button type="button" onClick={onBack} aria-label="Back to the list" className="lg:hidden mt-0.5 text-slate-500 cursor-pointer"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-ink break-words">{thread.subject}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Pill cat={thread.category} />
            <span>{thread.supplier_name || thread.group_label || "Someone I don't know yet"}</span>
            {thread.freight_detected && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[0.7rem] font-semibold text-sky-800">Has shipment details</span>}
            {snoozedNow && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[0.7rem] font-semibold text-slate-700"><Clock size={11} />Reminder set</span>}
          </div>
        </div>
        <div className="relative flex shrink-0 items-center gap-1.5">
          {thread.category !== 'done'
            ? <button type="button" className={buttonPlain} disabled={busy} onClick={() => setCategory('done')}><Check size={14} />Mark as finished</button>
            : <button type="button" className={buttonPlain} disabled={busy} onClick={() => setCategory('needs_reply')}>Open it again</button>}
          <button type="button" className={buttonPlain} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>More</button>
          {menu && (
            <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg" onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false); }}>
              {thread.gmail_thread_id && mailEmail && (
                <a role="menuitem" href={gmailLink(mailEmail, thread.gmail_thread_id)} target="_blank" rel="noopener noreferrer" className={menuBtn} onClick={() => setMenu(false)}>Open this email in Gmail</a>
              )}
              <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={() => { setMenu(false); makeFreight(); }}>Get freight quotes from this email</button>
              {thread.is_self && <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={addToTodo}>Add to my to-do list</button>}
              {!thread.archived_at && (
                <>
                  <div className="px-3 pb-1 pt-2 text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Remind me later</div>
                  <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={() => snooze('tomorrow')}>Tomorrow morning</button>
                  <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={() => snooze('3days')}>In 3 days</button>
                  <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={() => snooze('nextweek')}>Next Monday</button>
                  {snoozedNow && <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={() => snooze('clear')}>Show it in my list again</button>}
                </>
              )}
              <div className="my-1 border-t border-slate-100" />
              {thread.archived_at
                ? <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={restore}>Put back in my list</button>
                : (
                  <>
                    <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={() => archive(false)}>Archive (I don't need this)</button>
                    {!thread.is_self && <button type="button" role="menuitem" className={menuBtn} disabled={busy} onClick={() => archive(true)}>Archive and hide this sender in future</button>}
                  </>
                )}
            </div>
          )}
        </div>
      </div>
      {thread.payment_risk && (
        <div role="alert" className="mx-3 mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <b>Be careful with this email.</b> It talks about bank or payment details. Scammers often pretend to be a supplier and ask you to pay into a new account. Before you act on it, phone the supplier on a number you already have, not one from this email. I haven't written a reply for it.
        </div>
      )}
      <p className="px-3 pt-2 text-xs text-slate-500">Replied in Gmail instead? It will show here the next time I check.</p>

      <div className="mx-3 mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold text-slate-600">Purchase orders in this email:</span>
        {poTags.map((x) => (
          <span key={x.po_number} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
            {x.po_number}
            {x.source === 'manual' && <button type="button" aria-label={`Unlink ${x.po_number}`} className="text-slate-400 hover:text-red-600 cursor-pointer" onClick={() => linkPo(x.po_number, false)}>×</button>}
          </span>
        ))}
        {poTags.length === 0 && <span className="text-slate-500">none named</span>}
        <input aria-label="Link to a PO" placeholder="Link to PO, e.g. P23-3137" className={`${smallInput} !w-48`} value={poInput}
          onChange={(e) => setPoInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && poInput.trim()) linkPo(poInput, true); }} />
        <button type="button" className={buttonPlain} disabled={busy || !poInput.trim()} onClick={() => linkPo(poInput, true)}>Link</button>
      </div>
      {thread.is_self && <p className="mx-3 mt-3 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-700">A reminder you sent to yourself. I don't read these. Archive it, or add it to your to-do.</p>}
      {thread.archived_at && <p className="mx-3 mt-3 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-700">This conversation is archived. It comes back by itself if they write again, unless you chose to ignore the sender.</p>}
      {thread.summary && (
        <div className="m-3 rounded-md bg-slate-50 border border-slate-200 p-2.5 text-sm text-slate-700">
          <b>Quick summary:</b> {thread.summary}{thread.reason ? <span className="text-slate-500"> ({thread.reason})</span> : null}
        </div>
      )}

      {!known && (
        <div className="m-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm space-y-2">
          <p className="text-amber-900">This sender isn't saved yet, so I haven't read this email. Who is it?</p>
          <AssignForm thread={thread} messages={messages} people={people} setPeople={setPeople} busy={busy}
            onSave={async (payload) => { const r = await run(() => inbox('save_contact', payload), "Saved. I'll read it the next time I check."); if (r) { await load(); onChanged(); } }} />
        </div>
      )}

      <div className="space-y-3 p-3">
        {earlier.length > 0 && (
          <details className="rounded-lg border border-slate-200 p-2.5">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Show {earlier.length} earlier message{earlier.length === 1 ? '' : 's'}</summary>
            <div className="mt-2 space-y-3">{earlier.map(renderMsg)}</div>
          </details>
        )}
        {latest.map(renderMsg)}
      </div>

      {pos?.length > 0 && (
        <details className="mx-3 mb-3 rounded-md border border-slate-200 p-2.5 text-sm">
          <summary className="cursor-pointer font-semibold text-slate-700">Open purchase orders with {thread.supplier_name} ({pos.length})</summary>
          <ul className="mt-2 space-y-1.5 text-slate-700">
            {pos.map((p) => <li key={p.number}><b>{p.number}</b> · {p.status}{p.eta ? ` · due ${p.eta}` : ''}{p.outstanding.length ? <span className="block text-xs text-slate-500">Still to come: {p.outstanding.join(', ')}</span> : null}</li>)}
          </ul>
        </details>
      )}

      {known && (
        <div className="border-t border-slate-100 p-3 space-y-2.5">
          {draft ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">Suggested reply</h3>
                <span className="text-xs text-slate-500">Not sent until you click Send</span>
              </div>
              {draft.note && <p className="rounded-md bg-violet-50 border border-violet-200 p-2 text-xs text-violet-900"><b>Note:</b> {draft.note}</p>}
              {hasPlaceholder && <p role="alert" className="rounded-md bg-amber-50 border border-amber-300 p-2 text-xs text-amber-900">Fill in the <b>[[TO CHECK]]</b> parts below. I wasn't sure of those details. The email can't be sent until they're filled in.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">To<input className={inputClass} value={draft.to_email} onChange={(e) => setDraftField('to_email', e.target.value)} /></label>
                <label className="text-xs font-semibold text-slate-600">Cc<input className={inputClass} value={draft.cc_email || ''} onChange={(e) => setDraftField('cc_email', e.target.value)} /></label>
              </div>
              <label className="block text-xs font-semibold text-slate-600">Subject<input className={inputClass} value={draft.subject} onChange={(e) => setDraftField('subject', e.target.value)} /></label>
              <textarea aria-label="Email body" className="w-full min-h-[14rem] rounded-md border border-slate-300 p-2.5 text-sm focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                value={draft.body} onChange={(e) => setDraftField('body', e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonPrimary} disabled={busy || hasPlaceholder} onClick={send}><Send size={14} />Send</button>
                <button type="button" className={buttonPlain} disabled={busy} onClick={save}>Save changes</button>
                <button type="button" className={buttonPlain} disabled={busy} onClick={discard}>Discard</button>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-blue-700">Ask for a different version</summary>
                <div className="mt-2 space-y-2">
                  <textarea className="w-full min-h-[4rem] rounded-md border border-slate-300 p-2 text-sm" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Ask for carton dimensions and weight, and say we need them by Friday." />
                  <button type="button" className={buttonPlain} disabled={busy} onClick={generate}><Sparkles size={14} />Write it again</button>
                </div>
              </details>
            </>
          ) : (
            <>
              <h3 className="text-sm font-bold text-ink">Write a reply</h3>
              <textarea className="w-full min-h-[4rem] rounded-md border border-slate-300 p-2 text-sm" value={instructions} onChange={(e) => setInstructions(e.target.value)}
                placeholder="Say what you want to tell them, or leave this blank and I'll write the reply this email needs." />
              <button type="button" className={buttonPrimary} disabled={busy} onClick={generate}><Sparkles size={14} />{busy ? 'Writing' : 'Write a reply for me'}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Files an unmatched sender under a supplier or a forwarder.
function AssignForm({ thread, messages, people, setPeople, busy, onSave }) {
  const sender = [...messages].reverse().find((m) => !m.is_from_us)?.from_addr || '';
  const [kind, setKind] = useState('supplier');
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState('email');
  useEffect(() => { if (!people) inbox('list_contacts').then(setPeople).catch(() => {}); }, [people, setPeople]);
  const domain = sender.split('@')[1] || '';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" checked={kind === 'supplier'} onChange={() => setKind('supplier')} />Supplier</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={kind === 'forwarder'} onChange={() => setKind('forwarder')} />Forwarder</label>
      </div>
      {kind === 'supplier' ? (
        <div>
          <input className={inputClass} list="assign-supplier-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pick a supplier, or type a new name" aria-label="Supplier" />
          <datalist id="assign-supplier-names">{(people?.suppliers || []).map((s) => <option key={s.id} value={s.name} />)}</datalist>
          {name.trim() && <p className="mt-1 text-xs text-slate-600">{isCin7Supplier(name, people?.suppliers || []) ? 'Linked to the Cin7 supplier.' : 'Not in Cin7. It will be saved as a custom supplier.'}</p>}
        </div>
      ) : (
        <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Forwarder name" aria-label="Forwarder name" />
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'email'} onChange={() => setScope('email')} />Just {sender}</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'domain'} onChange={() => setScope('domain')} />Everyone at {domain}</label>
      </div>
      <button type="button" className={buttonPrimary} disabled={busy || !sender || (kind === 'supplier' ? !name.trim() : !label.trim())}
        onClick={() => onSave({ kind, ...(kind === 'supplier' ? supplierPayload(name, people?.suppliers || []) : { label }), email: scope === 'email' ? sender : '', domain: scope === 'domain' ? domain : '' })}>Save</button>
    </div>
  );
}

// --------------------------------------------------------- settings view
function ConnectCard({ mail, setNotice }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 max-w-2xl">
      <h2 className="text-base font-bold text-ink">Connect Gmail</h2>
      <p className="text-sm text-slate-700">Connect the mailbox your supplier email arrives in. The inbox reads from it and sends from it. Gmail stays exactly as it is.</p>
      {mail.google_configured ? (
        <button type="button" className={buttonPrimary} disabled={busy} onClick={async () => { setBusy(true); try { window.location.assign((await inbox('mail_connect_url')).url); } catch (err) { setNotice(errNotice(err)); setBusy(false); } }}>Connect Gmail</button>
      ) : (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5">The Google details haven't been added yet. Follow the steps below first.</p>
      )}
      <details className="text-sm" open={!mail.google_configured}>
        <summary className="cursor-pointer font-semibold text-blue-700">One-time Google setup</summary>
        <ol className="mt-2 list-decimal pl-5 space-y-1 text-slate-700">
          <li>In Seaga's Google Cloud Console, turn on the <b>Gmail API</b> and create an <b>OAuth client ID</b> of type <b>Web application</b>. On the consent screen choose <b>Internal</b> if Seaga uses Google Workspace.</li>
          <li>Under Authorised redirect URIs add: <code className="break-all rounded bg-slate-100 px-1">{mail.redirect_uri}</code></li>
          <li>In Supabase, add the secrets <code>GMAIL_CLIENT_ID_SEAGA</code> and <code>GMAIL_CLIENT_SECRET_SEAGA</code> from that client. <code>ANTHROPIC_API_KEY</code> and <code>APP_URL</code> are shared by the whole app.</li>
          <li>Come back here, press <b>Connect Gmail</b>, and allow both permissions (send and read email).</li>
        </ol>
      </details>
    </div>
  );
}

function SettingsView({ mail, reloadStatus, onChanged, autoFind, onFindStarted }) {
  const [data, setData] = useState(null);
  const [sig, setSig] = useState(mail.settings?.signature || '');
  const [auto, setAuto] = useState(mail.settings?.auto_draft !== false);
  const [form, setForm] = useState({ kind: 'supplier', name: '', email: '', domain: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => { try { setData(await inbox('list_contacts')); } catch (err) { setMsg(errNotice(err)); } }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg({ type: 'success', text: typeof ok === 'function' ? ok(r) : ok }); await load(); onChanged(); }
    catch (err) { setMsg(errNotice(err)); }
    setBusy(false);
  };
  const nameOfSupplier = useMemo(() => new Map((data?.suppliers || []).map((s) => [s.id, s.name])), [data]);
  if (!data) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;

  return (
    <div className="space-y-4 max-w-5xl">
      <Notice n={msg} />
      {!mail.connected ? <ConnectCard mail={mail} setNotice={setMsg} /> : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="text-base font-bold text-ink">Gmail</h2>
          <p className="text-sm text-slate-700">Connected as <b>{mail.email}</b>. Replies are sent from {mail.send_as}.</p>
          <button type="button" className={buttonPlain} disabled={busy} onClick={() => run(async () => { await inbox('mail_disconnect'); await reloadStatus(); }, 'Gmail disconnected.')}>Disconnect</button>
        </div>
      )}

      {mail.connected && (
        <FindSuppliers suppliers={data.suppliers} forwarderLabels={[...new Set(data.contacts.filter((c) => c.kind === 'forwarder' && c.label).map((c) => c.label))]}
          autoRun={autoFind} onStarted={onFindStarted} setMsg={setMsg} onDone={() => { load(); onChanged(); }} />
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-base font-bold text-ink">Who is who</h2>
        <p className="text-sm text-slate-600">I only read emails from the addresses saved here. This is also how emails are sorted under each supplier. Drafts can only be addressed to these contacts or people already in the conversation.</p>
        <div className="grid gap-2 sm:grid-cols-[9rem_1fr_1fr_1fr_auto] items-end">
          <label className="text-xs font-semibold text-slate-600">Type
            <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="supplier">Supplier</option><option value="forwarder">Forwarder</option></select>
          </label>
          <label className="text-xs font-semibold text-slate-600">{form.kind === 'supplier' ? 'Supplier name' : 'Forwarder name'}
            <input className={inputClass} list={form.kind === 'supplier' ? 'settings-supplier-names' : 'settings-forwarder-names'} value={form.name}
              placeholder={form.kind === 'supplier' ? 'Pick one, or type a new name' : 'e.g. the forwarder\'s company'} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="text-xs font-semibold text-slate-600">Email address<input className={inputClass} value={form.email} placeholder="name@company.com" onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="text-xs font-semibold text-slate-600">or whole domain<input className={inputClass} value={form.domain} placeholder="company.com" onChange={(e) => setForm({ ...form, domain: e.target.value })} /></label>
          <button type="button" className={buttonPrimary} disabled={busy} onClick={() => run(async () => { const r = await inbox('save_contact', { kind: form.kind, ...(form.kind === 'supplier' ? supplierPayload(form.name, data.suppliers) : { label: form.name }), email: form.email, domain: form.domain }); setForm({ ...form, email: '', domain: '' }); return r; }, (r) => `Saved. ${r.refiled} conversation(s) re-filed.`)}>Add</button>
        </div>
        <datalist id="settings-supplier-names">{data.suppliers.map((x) => <option key={x.id} value={x.name} />)}</datalist>
        <datalist id="settings-forwarder-names">{[...new Set(data.contacts.filter((c) => c.kind === 'forwarder' && c.label).map((c) => c.label))].map((x) => <option key={x} value={x} />)}</datalist>
        {form.kind === 'supplier' && form.name.trim() && (
          <p className="text-xs text-slate-600">{isCin7Supplier(form.name, data.suppliers) ? 'Linked to the Cin7 supplier. Drafts can mention its open purchase orders.' : 'Not in Cin7. It will be saved as a custom supplier, with no purchase orders attached.'}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-semibold">Belongs to</th><th className="py-1 font-semibold">Address</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.contacts.map((c) => (
                <tr key={c.id}>
                  <td className="py-1.5">{c.kind === 'forwarder' ? <>{c.label} <span className="text-xs text-slate-400">forwarder</span></> : c.supplier_id ? nameOfSupplier.get(c.supplier_id) || 'Supplier' : <>{c.label} <span className="text-xs text-slate-400">custom supplier</span></>}</td>
                  <td className="py-1.5">{c.email || `everyone at ${c.domain}`}</td>
                  <td className="py-1.5 text-right"><button type="button" className="text-slate-400 hover:text-red-600 cursor-pointer" aria-label="Remove" disabled={busy} onClick={() => run(() => inbox('delete_contact', { id: c.id }), (r) => `Removed. ${r.refiled} conversation(s) re-filed.`)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
              {data.contacts.length === 0 && <tr><td colSpan={3} className="py-3 text-slate-500">Nothing saved yet. Open an email from someone I don't know yet and tell me who it is, or add addresses here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {data.ignored?.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="text-base font-bold text-ink">Ignored senders</h2>
          <p className="text-sm text-slate-600">Mail from these addresses is archived automatically and never read. Remove one to see their mail again.</p>
          <ul className="divide-y divide-slate-100">
            {data.ignored.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 min-h-[2.25rem] text-sm">
                <span className="break-all">{c.email}</span>
                <button type="button" className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer" disabled={busy} onClick={() => run(() => inbox('remove_ignored', { id: c.id }), 'Removed. Their next email will show again.')}>Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-base font-bold text-ink">Replies</h2>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>Write a draft automatically when a reply is needed<span className="block text-xs text-slate-500">Drafts are never sent without your click.</span></span></label>
        <label className="block text-xs font-semibold text-slate-600">Sign-off added to every draft
          <textarea className="mt-1 w-full min-h-[4.5rem] rounded-md border border-slate-300 p-2 text-sm font-normal" value={sig} onChange={(e) => setSig(e.target.value)} placeholder={'Kind regards,\nYour name\nSeaga'} />
        </label>
        <button type="button" className={buttonPrimary} disabled={busy} onClick={() => run(async () => { await inbox('save_mail_settings', { signature: sig, auto_draft: auto }); await reloadStatus(); }, 'Saved.')}>Save</button>
        <p className="text-xs text-slate-500">{mail.ai_configured ? 'Claude is switched on.' : 'Claude is not set up. Add ANTHROPIC_API_KEY in Supabase secrets.'}</p>
      </div>
    </div>
  );
}

// Claude suggests who each unfiled sender is. Nothing is saved until a person accepts it.
const LEVEL = { high: ['High match', 'bg-emerald-100 text-emerald-800'], likely: ['Likely', 'bg-blue-100 text-blue-800'], low: ['Not sure', 'bg-amber-100 text-amber-800'] };

function FindSuppliers({ suppliers, forwarderLabels, autoRun, onStarted, onDone, setMsg }) {
  const [state, setState] = useState('idle'); // idle | working | done
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);

  const find = useCallback(async () => {
    setState('working');
    setMsg(null);
    try {
      const r = await inbox('suggest_contacts');
      setRows(r.suggestions.map((x) => ({ ...x, pick: x.kind === 'forwarder' ? 'forwarder' : 'supplier', supplierName: x.supplier_name || '', label: x.label || '' })));
      setMeta({ automated: r.automated, scanned: r.scanned, failed: r.failed });
      setState('done');
    } catch (err) {
      setMsg(errNotice(err));
      setState('idle');
    }
  }, [setMsg]);

  useEffect(() => { if (autoRun) { onStarted?.(); find(); } }, [autoRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key, patch) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const toItem = (r) => {
    if (r.pick === 'supplier' && !r.supplierName.trim()) return { error: 'Type or pick a supplier name.' };
    if (r.pick === 'forwarder' && !r.label.trim()) return { error: 'Enter the forwarder name.' };
    const who = r.pick === 'supplier' ? supplierPayload(r.supplierName, suppliers) : { supplier_id: '', label: r.label };
    return { item: { kind: r.pick, ...who, email: r.scope === 'email' ? r.email : '', domain: r.scope === 'domain' ? r.domain : '' } };
  };

  const accept = async (list) => {
    const ready = list.map((r) => ({ r, ...toItem(r) }));
    const bad = ready.find((x) => x.error);
    if (bad && list.length === 1) { setMsg({ type: 'error', text: bad.error }); return; }
    const good = ready.filter((x) => x.item);
    if (!good.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await inbox('accept_contacts', { items: good.map((x) => x.item) });
      const done = new Set(good.map((x) => x.r.key));
      if (!res.errors?.length) setRows((cur) => cur.filter((r) => !done.has(r.key)));
      setMsg({
        type: res.errors?.length ? 'error' : 'success',
        text: `Saved ${res.saved}${res.duplicates ? `, ${res.duplicates} already saved` : ''}. ${res.refiled} email(s) sorted. Press Get new emails and I'll read them.${res.errors?.length ? ` Problems: ${res.errors.join('; ')}` : ''}`,
      });
      onDone();
    } catch (err) {
      setMsg(errNotice(err));
    }
    setBusy(false);
  };

  const high = rows.filter((r) => r.level === 'high' && toItem(r).item);
  const selectCls = `${inputClass} mt-1`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-base font-bold text-ink">Find suppliers from my mail</h2>
          <p className="mt-1 text-sm text-slate-600">
            I look at who writes to you (names, addresses and subject lines only, never the email text) and matches them to your suppliers.
            <b className="text-ink"> Nothing is saved until you accept it.</b> You can change or remove any contact afterwards.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={state === 'done' ? buttonPlain : buttonPrimary} disabled={state === 'working'} onClick={find}>
            <Sparkles size={14} />{state === 'working' ? 'Looking at your mail' : state === 'done' ? 'Look again' : 'Find suppliers'}
          </button>
          {high.length > 0 && <button type="button" className={buttonPrimary} disabled={busy} onClick={() => accept(high)}>Accept all high matches ({high.length})</button>}
        </div>
      </div>

      {state === 'working' && <p className="text-sm text-slate-600" role="status">This takes up to a minute when there are many senders.</p>}
      {state === 'done' && (
        <>
          <p className="text-xs text-slate-500">
            Looked at {meta.scanned} sender group(s). {meta.automated} automated sender(s) (newsletters, notifications) left out.
            {meta.failed ? ` Some couldn't be checked (${meta.failed}). Press Look again.` : ''}
          </p>
          <datalist id="supplier-names">{suppliers.map((x) => <option key={x.id} value={x.name} />)}</datalist>
          <datalist id="forwarder-names">{forwarderLabels.map((x) => <option key={x} value={x} />)}</datalist>
          {rows.length === 0 && <p className="text-sm text-slate-600">No suggestions. Every sender is already filed or looks automated.</p>}
          <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto pr-1">
            {rows.map((r) => {
              const [lvlLabel, lvlTone] = LEVEL[r.level] || LEVEL.low;
              const who = r.sender_count > 1 && r.domain ? `${r.sender_count} senders at ${r.domain}` : r.senders[0]?.name || r.email;
              return (
                <li key={r.key} className="flex flex-wrap items-end gap-3 py-3">
                  <div className="min-w-[14rem] flex-1">
                    <div className="text-sm font-bold text-ink break-words">{who}</div>
                    <div className="text-xs text-slate-500 break-all">{r.sender_count > 1 && r.domain ? r.senders.map((x) => x.email).join(', ') : r.email}</div>
                    <div className="mt-0.5 text-xs text-slate-600">{r.subjects.join(' · ')}</div>
                    {r.reason && <div className="mt-0.5 text-xs text-slate-500">{r.reason}</div>}
                  </div>
                  <label className="w-32 text-xs font-semibold text-slate-600">Type
                    <select className={selectCls} value={r.pick} onChange={(e) => update(r.key, { pick: e.target.value })}><option value="supplier">Supplier</option><option value="forwarder">Forwarder</option></select>
                  </label>
                  {r.pick === 'supplier' ? (
                    <label className="w-56 text-xs font-semibold text-slate-600">Supplier
                      <input className={selectCls} list="supplier-names" value={r.supplierName} placeholder="Pick one, or type a new name" onChange={(e) => update(r.key, { supplierName: e.target.value })} />
                      {r.supplierName.trim() && !isCin7Supplier(r.supplierName, suppliers) && <span className="mt-1 block text-[0.7rem] font-normal text-slate-500">Not in Cin7: saved as a custom supplier</span>}
                    </label>
                  ) : (
                    <label className="w-56 text-xs font-semibold text-slate-600">Forwarder name
                      <input className={selectCls} list="forwarder-names" value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} />
                    </label>
                  )}
                  <label className="w-44 text-xs font-semibold text-slate-600">Save
                    <select className={selectCls} value={r.scope} onChange={(e) => update(r.key, { scope: e.target.value })}>
                      <option value="email">This address only</option>
                      {r.domain && <option value="domain">Everyone at {r.domain}</option>}
                    </select>
                  </label>
                  <div className="flex flex-col items-start gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${lvlTone}`}>{lvlLabel}</span>
                    <div className="flex gap-1.5">
                      <button type="button" className={buttonPrimary} disabled={busy} onClick={() => accept([r])}>Accept</button>
                      <button type="button" className={buttonPlain} disabled={busy} onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}>Skip</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------- freight quotes
const money = (price, cur) => `${cur ? `${cur} ` : ''}${Number(price).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;
const QSTATUS = {
  drafted: ['Draft', 'bg-slate-100 text-slate-700'], sent: ['Waiting for reply', 'bg-blue-100 text-blue-800'], quoted: ['Quote in', 'bg-emerald-100 text-emerald-800'],
  declined: ['Declined', 'bg-red-100 text-red-800'], question: ['Needs a look', 'bg-amber-100 text-amber-800'],
};
const toForm = (r) => ({
  mode: r.mode || '', weight_unit: r.weight_unit || '', dim_unit: r.dim_unit || '', pickup: r.pickup || '', deliver_to: r.deliver_to || '', ready_date: r.ready_date || '', notes: r.notes || '',
  skids: (r.skids || []).map((k) => ({ label: k.label || '', contents: k.contents || '', weight: k.weight ?? '', h: k.h ?? '', l: k.l ?? '', w: k.w ?? '' })),
});
const smallInput = `${inputClass} !min-h-[2.25rem] !px-2`;

function FreightView({ mailEmail, focus, onOpenThread, setNotice, onChanged }) {
  const [data, setData] = useState(null);
  const [po, setPo] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await inbox('freight_list')); onChanged?.(); } catch (err) { setNotice(errNotice(err)); }
  }, [setNotice, onChanged]);
  useEffect(() => { load(); }, [load]);

  const addByHand = async () => {
    setBusy(true);
    setNotice(null);
    try { await inbox('freight_create', { po_number: po }); setPo(''); await load(); } catch (err) { setNotice(errNotice(err)); }
    setBusy(false);
  };
  if (!data) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;

  return (
    <div className="space-y-3 max-w-5xl">
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <h2 className="text-base font-bold text-ink">Freight quotes</h2>
        <p className="text-sm text-slate-600">When a supplier sends PO details with skid weights and sizes, open that email and press <b>More</b>, then <b>Get freight quotes from this email</b>. It reads the whole conversation, including earlier emails and any PDF or Excel files attached. This also happens automatically when a supplier sends sizes and weights, and draft quote requests are prepared for your forwarders. Each PO appears here as a heading. Check the sizes, send them to your forwarders, and their prices fill in as the replies arrive.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <input className={`${inputClass} !w-56`} value={po} onChange={(e) => setPo(e.target.value)} placeholder="Add a PO by hand, e.g. P23-3276" aria-label="PO number" onKeyDown={(e) => { if (e.key === 'Enter' && po.trim()) addByHand(); }} />
          <button type="button" className={buttonPlain} disabled={busy || !po.trim()} onClick={addByHand}>Add PO</button>
        </div>
      </div>
      {data.requests.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">No POs yet.</div>}
      {data.requests.map((r) => (
        <PoCard key={r.id} req={r} quotes={data.quotes.filter((q) => q.request_id === r.id)} forwarders={data.forwarders} mailEmail={mailEmail}
          defaultOpen={r.po_number === focus} reload={load} setNotice={setNotice} onOpenThread={onOpenThread} />
      ))}
    </div>
  );
}

function PoCard({ req, quotes, forwarders, mailEmail, defaultOpen, reload, setNotice, onOpenThread }) {
  const [open, setOpen] = useState(defaultOpen);
  const [f, setF] = useState(() => toForm(req));
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState(() => Object.fromEntries(forwarders.map((x) => [x.label, { on: true, to: x.emails[0] || '', cc: x.emails.slice(1).join(', ') }])));
  useEffect(() => { setF(toForm(req)); }, [req.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const call = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try { const r = await fn(); if (ok) setNotice({ type: 'success', text: typeof ok === 'function' ? ok(r) : ok }); await reload(); return r; }
    catch (err) { setNotice(errNotice(err)); }
    finally { setBusy(false); }
  };
  const save = (confirmed) => call(() => inbox('freight_save', { id: req.id, ...f, confirmed }), confirmed ? 'Marked as checked.' : 'Saved. The sizes need checking again before you send.');
  const setSkid = (i, k, v) => setF((cur) => ({ ...cur, skids: cur.skids.map((s, n) => (n === i ? { ...s, [k]: v } : s)) }));

  const drafts = quotes.filter((q) => q.status === 'drafted');
  const asked = quotes.filter((q) => q.status !== 'drafted');
  const priced = asked.filter((q) => q.price != null);
  const allIn = asked.length > 0 && asked.every((q) => q.status === 'quoted' || q.status === 'declined');
  const sameCur = priced.length > 1 && new Set(priced.map((q) => q.currency || '')).size === 1;
  const lowest = sameCur ? Math.min(...priced.map((q) => Number(q.price))) : null;
  const differentBasis = priced.length > 1 && new Set(priced.map((q) => (q.price_basis || '').toLowerCase())).size > 1;
  const total = f.skids.reduce((n, s) => n + (Number(s.weight) || 0), 0);
  const askedLabels = new Set(asked.map((q) => q.forwarder_label));
  const chosen = forwarders.filter((x) => picks[x.label]?.on && !askedLabels.has(x.label));
  const unitsMissing = !f.weight_unit || !f.dim_unit;

  const prepare = () => call(() => inbox('freight_prepare', { request_id: req.id, forwarders: chosen.map((x) => ({ label: x.label, to: picks[x.label].to, cc: picks[x.label].cc })) }),
    (r) => `Drafts ready for ${r.made.join(', ') || 'nobody'}. Read each one, then send.${r.skipped.length ? ` Skipped: ${r.skipped.join(', ')}.` : ''}`);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left cursor-pointer">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-ink">PO# {req.po_number}{req.mode ? ` (${req.mode})` : ''}</h3>
          <div className="mt-0.5 text-xs text-slate-600">{req.supplier_label || 'Supplier'} · {f.skids.length} skid{f.skids.length === 1 ? '' : 's'}{total ? ` · ${total} ${f.weight_unit || ''}` : ''}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {req.dims_confirmed ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-800">Sizes checked</span> : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-800">Check the sizes</span>}
          {asked.length > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[0.7rem] font-semibold text-blue-800">{priced.length} of {asked.length} quotes in</span>}
          {allIn && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-800">All quotes in</span>}
          {lowest != null && <span className="text-xs font-semibold text-ink">Lowest {money(lowest, priced[0].currency)}</span>}
        </div>
      </button>

      {open && (
        <div className="space-y-5 border-t border-slate-100 p-4">
          {/* 1. the dims */}
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-ink">1. Sizes and weights</h4>
            <p className="text-xs text-slate-600">Exactly as the supplier gave them. Check every number against their email before marking them checked.</p>
            <div className="flex flex-wrap gap-3">
              <label className="text-xs font-semibold text-slate-600">Mode
                <select className={`${smallInput} mt-1 w-28`} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="">Not stated</option><option value="sea">Sea</option><option value="air">Air</option><option value="road">Road</option></select></label>
              <label className="text-xs font-semibold text-slate-600">Weight in
                <select className={`${smallInput} mt-1 w-24`} value={f.weight_unit} onChange={(e) => setF({ ...f, weight_unit: e.target.value })}><option value="">Choose</option><option value="lb">lb</option><option value="kg">kg</option></select></label>
              <label className="text-xs font-semibold text-slate-600">Sizes in
                <select className={`${smallInput} mt-1 w-24`} value={f.dim_unit} onChange={(e) => setF({ ...f, dim_unit: e.target.value })}><option value="">Choose</option><option value="in">inches</option><option value="cm">cm</option></select></label>
            </div>
            {unitsMissing && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">The units weren't clear in the email, so I haven't guessed. Choose them before sending.</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-2 font-semibold">Skid</th><th className="py-1 pr-2 font-semibold">Contents</th><th className="py-1 pr-2 font-semibold">Weight {f.weight_unit && `(${f.weight_unit})`}</th><th className="py-1 pr-2 font-semibold">H</th><th className="py-1 pr-2 font-semibold">L</th><th className="py-1 pr-2 font-semibold">W {f.dim_unit && `(${f.dim_unit})`}</th><th /></tr></thead>
                <tbody>
                  {f.skids.map((s, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2"><input className={smallInput} value={s.label} aria-label={`Skid ${i + 1} name`} onChange={(e) => setSkid(i, 'label', e.target.value)} /></td>
                      <td className="py-1 pr-2"><input className={smallInput} value={s.contents} aria-label={`Skid ${i + 1} contents`} placeholder="105 sheets" onChange={(e) => setSkid(i, 'contents', e.target.value)} /></td>
                      {['weight', 'h', 'l', 'w'].map((k) => (
                        <td key={k} className="py-1 pr-2"><input className={`${smallInput} w-20`} inputMode="decimal" value={s[k]} aria-label={`Skid ${i + 1} ${k === 'weight' ? 'weight' : k.toUpperCase()}`} onChange={(e) => setSkid(i, k, e.target.value)} /></td>
                      ))}
                      <td className="py-1"><button type="button" aria-label={`Remove skid ${i + 1}`} className="text-slate-400 hover:text-red-600 cursor-pointer" onClick={() => setF({ ...f, skids: f.skids.filter((_, n) => n !== i) })}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className={buttonPlain} onClick={() => setF({ ...f, skids: [...f.skids, { label: '', contents: '', weight: '', h: '', l: '', w: '' }] })}>Add a skid</button>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">Pick-up from<input className={`${smallInput} mt-1`} value={f.pickup} onChange={(e) => setF({ ...f, pickup: e.target.value })} placeholder="Optional" /></label>
              <label className="text-xs font-semibold text-slate-600">Deliver to<input className={`${smallInput} mt-1`} value={f.deliver_to} onChange={(e) => setF({ ...f, deliver_to: e.target.value })} placeholder="Optional" /></label>
              <label className="text-xs font-semibold text-slate-600">Ready date<input className={`${smallInput} mt-1`} value={f.ready_date} onChange={(e) => setF({ ...f, ready_date: e.target.value })} placeholder="Optional" /></label>
            </div>
            <label className="block text-xs font-semibold text-slate-600">Notes for the forwarder<input className={`${smallInput} mt-1`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Optional" /></label>
            {req.source_text && (
              <details className="text-xs text-slate-600"><summary className="cursor-pointer font-semibold text-blue-700">What the supplier's email said</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans">{req.source_text}</pre></details>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={buttonPrimary} disabled={busy} onClick={() => save(true)}><Check size={14} />Sizes checked</button>
              <button type="button" className={buttonPlain} disabled={busy} onClick={() => save(false)}>Save changes</button>
              {req.source_thread_id && <button type="button" className={buttonPlain} onClick={() => onOpenThread(req.source_thread_id)}>Open the supplier's email</button>}
              <button type="button" className="ml-auto text-xs font-semibold text-slate-500 hover:text-red-700 cursor-pointer" disabled={busy} onClick={() => window.confirm(`Close PO ${req.po_number}? It leaves this list.`) && call(() => inbox('freight_close', { id: req.id }), 'PO closed.')}>Close this PO</button>
            </div>
          </div>

          {/* 2. ask the forwarders */}
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <h4 className="text-sm font-bold text-ink">2. Ask your forwarders for a quote</h4>
            {forwarders.length === 0 ? <p className="text-xs text-slate-600">No forwarders are saved yet. Add them in Setup. Quote requests only go to saved forwarders.</p>
              : (
                <>
                  <p className="text-xs text-slate-600">Drafts are prepared for your saved forwarders automatically when a supplier sends sizes and weights, and you can make more here. The same details can go to several forwarders, and requests only go to forwarders you've saved. Nothing is sent until the dims are checked and you press Send.</p>
                  <ul className="divide-y divide-slate-100">
                    {forwarders.map((x) => {
                      const pk = picks[x.label] || { on: false, to: '', cc: '' };
                      const done = askedLabels.has(x.label);
                      return (
                        <li key={x.label} className="flex flex-wrap items-end gap-3 py-2">
                          <label className="flex w-44 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-4 w-4" disabled={done} checked={pk.on && !done} onChange={(e) => setPicks({ ...picks, [x.label]: { ...pk, on: e.target.checked } })} />{x.label}{done && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[0.7rem] font-semibold text-blue-800">Asked</span>}</label>
                          <label className="text-xs font-semibold text-slate-600">To<input className={`${smallInput} mt-1 w-56`} disabled={done} value={pk.to} onChange={(e) => setPicks({ ...picks, [x.label]: { ...pk, to: e.target.value } })} /></label>
                          <label className="text-xs font-semibold text-slate-600">Cc (key account manager)<input className={`${smallInput} mt-1 w-64`} disabled={done} value={pk.cc} onChange={(e) => setPicks({ ...picks, [x.label]: { ...pk, cc: e.target.value } })} /></label>
                        </li>
                      );
                    })}
                  </ul>
                  <button type="button" className={buttonPrimary} disabled={busy || chosen.length === 0} onClick={prepare}><Sparkles size={14} />Create draft emails ({chosen.length})</button>
                </>
              )}
            {drafts.map((q) => <QuoteDraft key={`${q.id}-${q.updated_at}`} q={q} canSend={!!req.dims_confirmed} reload={reload} setNotice={setNotice} />)}
          </div>

          {/* 3. the prices */}
          {asked.length > 0 && (
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <h4 className="text-sm font-bold text-ink">3. Quotes{allIn ? ' (all in)' : ''}</h4>
              {priced.length > 1 && !sameCur && <p className="text-xs text-amber-900">These prices are in different currencies, or the currency wasn't stated. Don't compare them until that's clear.</p>}
              {differentBasis && <p className="text-xs text-amber-900">The quotes don't cover the same things (see the second column). Compare what's included, not just the total.</p>}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-2 font-semibold">Forwarder</th><th className="py-1 pr-2 font-semibold">Price</th><th className="py-1 pr-2 font-semibold">Covers</th><th className="py-1 pr-2 font-semibold">Transit</th><th className="py-1 pr-2 font-semibold">Valid until</th><th /></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {asked.map((q) => <QuoteRow key={`${q.id}-${q.updated_at}`} q={q} lowest={lowest} mailEmail={mailEmail} reload={reload} setNotice={setNotice} />)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function QuoteDraft({ q, canSend, reload, setNotice }) {
  const [d, setD] = useState({ to_email: q.to_email, cc_email: q.cc_email || '', subject: q.subject, body: q.body });
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try { await fn(); if (ok) setNotice({ type: 'success', text: ok }); await reload(); } catch (err) { setNotice(errNotice(err)); }
    setBusy(false);
  };
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between"><h5 className="text-sm font-bold text-ink">Draft to {q.forwarder_label}</h5><span className="text-xs text-slate-500">Not sent until you click Send</span></div>
      {!canSend && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">Check the sizes above and press <b>Sizes checked</b> before this can be sent.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">To<input className={`${smallInput} mt-1`} value={d.to_email} onChange={(e) => setD({ ...d, to_email: e.target.value })} /></label>
        <label className="text-xs font-semibold text-slate-600">Cc<input className={`${smallInput} mt-1`} value={d.cc_email} onChange={(e) => setD({ ...d, cc_email: e.target.value })} /></label>
      </div>
      <label className="block text-xs font-semibold text-slate-600">Subject<input className={`${smallInput} mt-1`} value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} /></label>
      <textarea aria-label={`Email to ${q.forwarder_label}`} className="min-h-[16rem] w-full rounded-md border border-slate-300 bg-white p-2.5 text-sm" value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonPrimary} disabled={busy || !canSend} onClick={() => window.confirm(`Send this quote request to ${d.to_email}${d.cc_email ? ` (cc ${d.cc_email})` : ''}?`) && run(() => inbox('freight_quote_send', { id: q.id, ...d }), `Sent to ${q.forwarder_label}. Their price fills in when they reply.`)}><Send size={14} />Send</button>
        <button type="button" className={buttonPlain} disabled={busy} onClick={() => run(() => inbox('freight_quote_save', { id: q.id, ...d }), 'Draft saved.')}>Save changes</button>
        <button type="button" className={buttonPlain} disabled={busy} onClick={() => run(() => inbox('freight_quote_discard', { id: q.id }), 'Draft discarded.')}>Discard</button>
      </div>
    </div>
  );
}

function QuoteRow({ q, lowest, mailEmail, reload, setNotice }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ price: q.price ?? '', currency: q.currency || '', price_basis: q.price_basis || '', includes: q.includes || '', transit_days: q.transit_days ?? '', valid_until: q.valid_until || '' });
  const [busy, setBusy] = useState(false);
  const [label, tone] = QSTATUS[q.status] || QSTATUS.sent;
  const run = async (payload, ok) => {
    setBusy(true);
    setNotice(null);
    try { await inbox('freight_quote_update', { id: q.id, ...payload }); setNotice({ type: 'success', text: ok }); setEdit(false); await reload(); }
    catch (err) { setNotice(errNotice(err)); }
    setBusy(false);
  };
  const confirmPrice = () => run({ price: q.price, currency: q.currency || '', price_basis: q.price_basis || '', includes: q.includes || '', excludes: q.excludes || '', transit_days: q.transit_days ?? '', valid_until: q.valid_until || '' }, 'Price confirmed.');
  const isLowest = lowest != null && q.price != null && Number(q.price) === lowest;
  return (
    <>
      <tr className="align-top">
        <td className="py-2 pr-2"><div className="font-semibold">{q.forwarder_label}</div><span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${tone}`}>{label}</span></td>
        <td className="py-2 pr-2">
          {q.price != null ? (
            <>
              <div className="font-bold text-ink">{money(q.price, q.currency)}{!q.currency && <span className="ml-1 text-xs font-normal text-amber-800">currency?</span>} {isLowest && <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-800">Lowest</span>}</div>
              {q.price_verified ? <span className="text-xs text-emerald-800">Confirmed by you</span> : <span className="text-xs text-amber-800">{q.price_source?.startsWith('File:') ? `From the file ${q.price_source.slice(6)}. Check it.` : 'From their email. Check it.'}</span>}
              {q.price_text && <div className="mt-0.5 max-w-[16rem] text-xs text-slate-500">They wrote: "{q.price_text}"</div>}
            </>
          ) : <span className="text-xs text-slate-500">{q.reply_summary || 'Waiting for their reply'}</span>}
        </td>
        <td className="py-2 pr-2 text-xs text-slate-700">{q.price_basis || ''}{q.includes ? <div className="text-slate-500">Includes: {q.includes}</div> : null}{q.excludes ? <div className="text-slate-500">Excludes: {q.excludes}</div> : null}</td>
        <td className="py-2 pr-2 text-xs">{q.transit_days != null ? `${q.transit_days} days` : ''}</td>
        <td className="py-2 pr-2 text-xs">{q.valid_until || ''}</td>
        <td className="py-2 text-right">
          <div className="flex flex-wrap justify-end gap-1.5">
            {q.price != null && !q.price_verified && <button type="button" className={buttonPrimary} disabled={busy} onClick={confirmPrice}>Confirm</button>}
            <button type="button" className={buttonPlain} disabled={busy} onClick={() => setEdit(!edit)}>{q.price != null ? 'Edit' : 'Enter price'}</button>
            {q.gmail_thread_id && mailEmail && <a href={gmailLink(mailEmail, q.gmail_thread_id)} target="_blank" rel="noopener noreferrer" className={`${buttonPlain} no-underline`} aria-label={`Open ${q.forwarder_label} email in Gmail`}><ExternalLink size={14} /></a>}
          </div>
        </td>
      </tr>
      {edit && (
        <tr><td colSpan={6} className="pb-3">
          <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="text-xs font-semibold text-slate-600">Price<input className={`${smallInput} mt-1`} inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></label>
            <label className="text-xs font-semibold text-slate-600">Currency<input className={`${smallInput} mt-1`} maxLength={3} placeholder="AUD" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} /></label>
            <label className="text-xs font-semibold text-slate-600">Covers<input className={`${smallInput} mt-1`} placeholder="door to door" value={v.price_basis} onChange={(e) => setV({ ...v, price_basis: e.target.value })} /></label>
            <label className="text-xs font-semibold text-slate-600">Includes<input className={`${smallInput} mt-1`} value={v.includes} onChange={(e) => setV({ ...v, includes: e.target.value })} /></label>
            <label className="text-xs font-semibold text-slate-600">Transit days<input className={`${smallInput} mt-1`} inputMode="numeric" value={v.transit_days} onChange={(e) => setV({ ...v, transit_days: e.target.value })} /></label>
            <label className="text-xs font-semibold text-slate-600">Valid until<input className={`${smallInput} mt-1`} placeholder="YYYY-MM-DD" value={v.valid_until} onChange={(e) => setV({ ...v, valid_until: e.target.value })} /></label>
            <div className="sm:col-span-3 lg:col-span-6"><button type="button" className={buttonPrimary} disabled={busy} onClick={() => run(v, 'Price saved.')}>Save price</button></div>
          </div>
        </td></tr>
      )}
    </>
  );
}

// ------------------------------------------------------- purchase orders
// The active purchase orders from DEAR, each with the emails that name its PO number.
function PosView({ selectedId, onOpen, setNotice }) {
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState('');
  const [onlyMail, setOnlyMail] = useState(false);
  const [openPo, setOpenPo] = useState(null);
  const [threads, setThreads] = useState({});
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    try { setPos((await inbox('po_list')).pos); } catch (err) { setNotice(errNotice(err)); }
  }, [setNotice]);
  useEffect(() => { loadList(); }, [loadList]);
  const loadThreads = async (po) => {
    try { const r = await inbox('po_threads', { po_number: po }); setThreads((t) => ({ ...t, [po]: r.threads })); } catch (err) { setNotice(errNotice(err)); }
  };
  const toggle = async (po) => {
    if (openPo === po) { setOpenPo(null); return; }
    setOpenPo(po);
    if (!threads[po]) await loadThreads(po);
  };
  // A polite email to the supplier, written as a suggested reply. It is opened for you to read; nothing is sent.
  const chase = async (po, kind) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await inbox('po_chase', { po_number: po, kind });
      setNotice({ type: 'success', text: 'I wrote a suggested email. Read it, change anything you like, then press Send. It has not been sent.' });
      await loadList();
      onOpen(r.thread_id);
    } catch (err) { setNotice(errNotice(err)); }
    setBusy(false);
  };
  const pull = async (po) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await inbox('po_pull_emails', { po_number: po });
      setNotice({ type: 'success', text: `Searched Gmail for ${po}: ${r.found_in_gmail} conversation(s) found, ${r.added} added or updated, ${r.linked} linked to this PO.${r.remaining ? ' There are more: press the button again.' : ''}` });
      await loadThreads(po);
      await loadList();
    } catch (err) { setNotice(errNotice(err)); }
    setBusy(false);
  };

  if (!pos) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;
  const term = q.trim().toLowerCase();
  const shown = pos.filter((p) => (!onlyMail || p.emails > 0) && (!term || `${p.po_number} ${p.supplier_name || ''}`.toLowerCase().includes(term)));

  return (
    <div>
      <div className="space-y-2 border-b border-slate-100 p-3">
        <h2 className="text-sm font-bold text-ink">Active purchase orders ({pos.length})</h2>
        <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by PO number or supplier" aria-label="Search purchase orders" />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" className="h-4 w-4" checked={onlyMail} onChange={(e) => setOnlyMail(e.target.checked)} />Only POs that have emails</label>
      </div>
      <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
        {shown.map((p) => (
          <li key={p.po_number}>
            <button type="button" aria-expanded={openPo === p.po_number} onClick={() => toggle(p.po_number)} className={`w-full px-3 py-2.5 text-left cursor-pointer ${openPo === p.po_number ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-ink">PO {p.po_number}</span>
                <span className="shrink-0 text-xs text-slate-500">{p.required_by ? `Due ${fmtDay(p.required_by)}` : 'No due date'}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-600">{p.supplier_name || 'Supplier'}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${p.emails ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>{p.emails} email{p.emails === 1 ? '' : 's'}</span>
                {p.needs > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-800">{p.needs} to reply</span>}
              </div>
            </button>
            {openPo === p.po_number && (
              <div className="space-y-1 bg-slate-50/60 px-3 pb-3">
                {(threads[p.po_number] || []).map((t) => (
                  <button key={t.id} type="button" onClick={() => onOpen(t.id)} className={`block w-full rounded-lg border px-2.5 py-2 text-left cursor-pointer ${selectedId === t.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                    <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-ink">{t.subject}</span><span className="shrink-0 text-[0.7rem] text-slate-400">{timeAgo(t.last_message_at)}</span></div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5"><Pill cat={t.category} />{t.has_attachments && <Paperclip size={11} className="text-slate-400" aria-label="Has attachments" />}</div>
                  </button>
                ))}
                {threads[p.po_number] && threads[p.po_number].length === 0 && <p className="py-1 text-xs text-slate-500">No emails mention this PO yet.</p>}
                {!threads[p.po_number] && <p className="py-1 text-xs text-slate-500">Loading</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" className={buttonPlain} disabled={busy} onClick={() => chase(p.po_number, 'invoice')}>Ask for the invoice</button>
                  <button type="button" className={buttonPlain} disabled={busy} onClick={() => chase(p.po_number, 'delivery')}>Ask for a delivery date</button>
                  <button type="button" className={buttonPlain} disabled={busy} onClick={() => pull(p.po_number)}>{busy ? 'Working' : 'Look for older emails'}</button>
                </div>
              </div>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="p-6 text-center text-sm text-slate-500">No purchase orders match.</li>}
      </ul>
    </div>
  );
}

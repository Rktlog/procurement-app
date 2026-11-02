import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Send, Check, Paperclip, Sparkles, ArrowLeft, Trash2 } from 'lucide-react';
import { inbox, inputClass, buttonPrimary, buttonPlain, fmtDateTime, timeAgo } from './api';

const CAT = {
  new: ['Reading', 'bg-slate-100 text-slate-700'],
  needs_reply: ['Needs reply', 'bg-amber-100 text-amber-800'],
  waiting: ['Waiting on them', 'bg-blue-100 text-blue-800'],
  fyi: ['FYI', 'bg-slate-100 text-slate-700'],
  done: ['Done', 'bg-emerald-100 text-emerald-800'],
};
const FILTERS = [['attention', 'Needs reply'], ['waiting', 'Waiting on them'], ['fyi', 'FYI'], ['done', 'Done'], ['', 'All']];

const Pill = ({ cat }) => {
  const [label, tone] = CAT[cat] || CAT.new;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${tone}`}>{label}</span>;
};
const Notice = ({ n }) =>
  n ? (
    <div role={n.type === 'error' ? 'alert' : 'status'} className={`p-3 text-sm rounded-md border ${n.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
      {n.text}
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
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState(
    params.get('gmail') ? { type: 'success', text: 'Gmail is connected.' }
      : params.get('gmail_error') ? { type: 'error', text: `Gmail wasn't connected: ${params.get('gmail_error')}` } : null
  );

  const loadStatus = useCallback(async () => {
    try { setMail(await inbox('mail_status')); } catch (err) { setNotice({ type: 'error', text: err.message }); }
  }, []);
  const loadOverview = useCallback(async () => {
    try { setOverview(await inbox('inbox_overview')); } catch (err) { setNotice({ type: 'error', text: err.message }); }
  }, []);
  const loadThreads = useCallback(async () => {
    if (['today', 'settings'].includes(view)) return;
    try { setThreads((await inbox('list_threads', { group: view, category: filter })).threads); }
    catch (err) { setNotice({ type: 'error', text: err.message }); }
  }, [view, filter]);

  useEffect(() => { loadStatus(); loadOverview(); }, [loadStatus, loadOverview]);
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
      setNotice({ type: 'success', text: `Checked ${s?.listed ?? 0} conversations, ${s?.synced ?? 0} updated. Claude read ${t?.triaged ?? 0} and drafted ${t?.drafted ?? 0} replies.${t?.failed ? ` ${t.failed} couldn't be read and will be retried.` : ''}` });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    }
    setProgress('');
    setBusy(false);
    refreshAll();
  };

  const groups = overview?.groups || [];
  const sup = groups.filter((g) => g.kind === 'supplier').sort((a, b) => b.needs - a.needs || a.label.localeCompare(b.label));
  const fwd = groups.filter((g) => g.kind === 'forwarder');
  const unmatched = groups.find((g) => g.kind === 'unmatched');
  const totalNeeds = groups.reduce((n, g) => (g.kind === 'unmatched' ? n : n + g.needs), 0);

  const pick = (v) => { setView(v); setSelectedId(null); };
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
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />{busy ? progress || 'Working' : 'Check mail now'}
        </button>
        <span className="text-xs text-slate-500">
          {mail.connected ? <>Connected as <b>{mail.email}</b>{mail.last_sync ? ` · last checked ${timeAgo(mail.last_sync)} ago` : ' · not checked yet'}</> : 'Gmail is not connected'}
        </span>
        {!mail.ai_configured && <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">Claude isn't set up (add ANTHROPIC_API_KEY). Mail will be sorted by supplier but not read.</span>}
      </div>
      <Notice n={notice} />

      <div className="grid gap-4 lg:grid-cols-[14rem_21rem_minmax(0,1fr)] items-start">
        {/* ------------------------------------------------------ left: groups */}
        <nav aria-label="Suppliers" className={`rounded-xl border border-slate-200 bg-white p-2 space-y-0.5 ${selectedId ? 'hidden lg:block' : ''}`}>
          {navBtn('today', 'Today', 0, overview?.drafts_waiting ? `${overview.drafts_waiting} drafts` : '')}
          {navBtn('all', 'All mail', totalNeeds)}
          {sup.length > 0 && <div className="px-2.5 pt-3 pb-1 text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Suppliers</div>}
          {sup.map((g) => navBtn(g.key, g.label, g.needs, g.waiting ? `${g.waiting} waiting` : ''))}
          {fwd.length > 0 && <div className="px-2.5 pt-3 pb-1 text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Forwarders</div>}
          {fwd.map((g) => navBtn(g.key, g.label, g.needs, g.waiting ? `${g.waiting} waiting` : ''))}
          <div className="pt-3" />
          {unmatched && navBtn('unmatched', 'Unmatched senders', 0, String(unmatched.total))}
          {navBtn('settings', 'Contacts and settings', 0)}
        </nav>

        {/* ----------------------------------------------- middle and right */}
        {view === 'settings' ? (
          <div className="lg:col-span-2"><SettingsView mail={mail} reloadStatus={loadStatus} onChanged={refreshAll} /></div>
        ) : view === 'today' ? (
          <div className="lg:col-span-2"><TodayView overview={overview} reload={loadOverview} onOpen={(id) => { setView('all'); setFilter(''); setSelectedId(id); }} connected={mail.connected} mail={mail} setNotice={setNotice} /></div>
        ) : (
          <>
            <section aria-label="Conversations" className={`rounded-xl border border-slate-200 bg-white ${selectedId ? 'hidden lg:block' : ''}`}>
              <div className="flex flex-wrap gap-1 p-2 border-b border-slate-100">
                {FILTERS.map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setFilter(id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold cursor-pointer ${filter === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{label}</button>
                ))}
              </div>
              <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setSelectedId(t.id)} className={`w-full text-left px-3 py-2.5 cursor-pointer ${selectedId === t.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{t.subject}</span>
                        <span className="shrink-0 text-xs text-slate-400">{timeAgo(t.last_message_at)}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-slate-600">{t.summary || t.snippet}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Pill cat={t.category} />
                        {t.urgency === 'high' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[0.7rem] font-semibold text-red-800">Urgent</span>}
                        {t.has_draft && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[0.7rem] font-semibold text-violet-800">Draft ready</span>}
                        {t.has_attachments && <Paperclip size={12} className="text-slate-400" aria-label="Has attachments" />}
                      </div>
                    </button>
                  </li>
                ))}
                {threads.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Nothing here{filter === 'attention' ? '. No replies waiting.' : '.'}</li>}
              </ul>
            </section>
            <section aria-label="Conversation" className={selectedId ? '' : 'hidden lg:block'}>
              {selectedId ? (
                <ThreadView id={selectedId} onBack={() => setSelectedId(null)} onChanged={() => { loadThreads(); loadOverview(); }} setNotice={setNotice} />
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
function TodayView({ overview, reload, onOpen, connected, mail, setNotice }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { await fn(); await reload(); } catch (err) { setNotice({ type: 'error', text: err.message }); } setBusy(false); };
  if (!overview) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;
  if (!connected) return <ConnectCard mail={mail} setNotice={setNotice} />;

  const today = overview.todos.filter((t) => t.for_date === overview.today);
  const carried = overview.todos.filter((t) => t.for_date !== overview.today && !t.done);
  const Item = ({ t }) => (
    <li className="flex items-start gap-2.5 py-2">
      <input type="checkbox" className="mt-1 h-4 w-4 cursor-pointer" checked={t.done} disabled={busy} aria-label={t.text}
        onChange={(e) => run(() => inbox('toggle_todo', { id: t.id, done: e.target.checked }))} />
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${t.done ? 'line-through text-slate-400' : 'text-ink'}`}>{t.text}</div>
        <div className="mt-0.5 flex gap-2 text-xs">
          {t.priority === 'high' && <span className="font-semibold text-red-700">Urgent</span>}
          {t.source === 'manual' && <span className="text-slate-400">Added by you</span>}
          {t.thread_id && <button type="button" className="font-semibold text-blue-700 hover:underline cursor-pointer" onClick={() => onOpen(t.thread_id)}>Open email</button>}
        </div>
      </div>
      <button type="button" aria-label="Remove" className="text-slate-300 hover:text-red-600 cursor-pointer" onClick={() => run(() => inbox('delete_todo', { id: t.id }))}><Trash2 size={14} /></button>
    </li>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 max-w-2xl">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-ink">Today's to-do</h2>
        <button type="button" className={buttonPlain} disabled={busy} onClick={() => run(() => inbox('build_todo', { force: true }))}><Sparkles size={14} />Rebuild from email</button>
      </div>
      {today.length === 0 && carried.length === 0 && <p className="text-sm text-slate-500">Nothing yet. The list is built each morning from your email, or press Rebuild.</p>}
      <ul className="divide-y divide-slate-100">{today.map((t) => <Item key={t.id} t={t} />)}</ul>
      {carried.length > 0 && (
        <div>
          <div className="text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Carried over</div>
          <ul className="divide-y divide-slate-100">{carried.map((t) => <Item key={t.id} t={t} />)}</ul>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <input className={inputClass} value={text} placeholder="Add your own task" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) run(async () => { await inbox('add_todo', { text }); setText(''); }); }} />
        <button type="button" className={buttonPlain} disabled={busy || !text.trim()} onClick={() => run(async () => { await inbox('add_todo', { text }); setText(''); })}>Add</button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- thread
function ThreadView({ id, onBack, onChanged, setNotice }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState(null);

  const load = useCallback(async () => {
    setData(null);
    try { const r = await inbox('get_thread', { id }); setData(r); setDraft(r.draft); } catch (err) { setNotice({ type: 'error', text: err.message }); }
  }, [id, setNotice]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try { const r = await fn(); if (ok) setNotice({ type: 'success', text: ok }); return r; }
    catch (err) { setNotice({ type: 'error', text: err.message }); }
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
  const setCategory = async (category) => { const r = await run(() => inbox('set_thread_category', { id: thread.id, category })); if (r) { await load(); onChanged(); } };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start gap-2 border-b border-slate-100 p-3">
        <button type="button" onClick={onBack} aria-label="Back" className="lg:hidden mt-0.5 text-slate-500 cursor-pointer"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-ink break-words">{thread.subject}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Pill cat={thread.category} />
            <span>{thread.supplier_name || thread.group_label || 'Unmatched sender'}</span>
            <span>{thread.message_count} messages</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {thread.category !== 'done'
            ? <button type="button" className={buttonPlain} disabled={busy} onClick={() => setCategory('done')}><Check size={14} />Done</button>
            : <button type="button" className={buttonPlain} disabled={busy} onClick={() => setCategory('needs_reply')}>Reopen</button>}
        </div>
      </div>

      {thread.summary && (
        <div className="m-3 rounded-md bg-slate-50 border border-slate-200 p-2.5 text-sm text-slate-700">
          <b>Claude's read:</b> {thread.summary}{thread.reason ? <span className="text-slate-500"> ({thread.reason})</span> : null}
        </div>
      )}

      {!known && (
        <div className="m-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm space-y-2">
          <p className="text-amber-900">This sender isn't saved yet, so Claude hasn't read this email. Who is it?</p>
          <AssignForm thread={thread} messages={messages} people={people} setPeople={setPeople} busy={busy}
            onSave={async (payload) => { const r = await run(() => inbox('save_contact', payload), 'Saved. Claude will read it on the next check.'); if (r) { await load(); onChanged(); } }} />
        </div>
      )}

      <div className="space-y-3 p-3">
        {messages.map((m) => (
          <article key={m.id} className={`rounded-lg border p-3 ${m.is_from_us ? 'border-blue-100 bg-blue-50/50' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{m.is_from_us ? 'You' : m.from_name || m.from_addr}</span>
              <span>{fmtDateTime(m.sent_at)}</span>
            </div>
            <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-sm text-ink">{m.body || '(no text)'}</pre>
            {m.attachments?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.attachments.map((a, i) => <span key={i} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"><Paperclip size={11} />{a.name}</span>)}
              </div>
            )}
          </article>
        ))}
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
                <h3 className="text-sm font-bold text-ink">Reply draft</h3>
                <span className="text-xs text-slate-500">Not sent until you click Send</span>
              </div>
              {draft.note && <p className="rounded-md bg-violet-50 border border-violet-200 p-2 text-xs text-violet-900"><b>Note from Claude:</b> {draft.note}</p>}
              {hasPlaceholder && <p role="alert" className="rounded-md bg-amber-50 border border-amber-300 p-2 text-xs text-amber-900">Fill in the <b>[[TO CHECK]]</b> parts below. The email can't be sent until they're gone.</p>}
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
                <summary className="cursor-pointer font-semibold text-blue-700">Ask Claude to rewrite it</summary>
                <div className="mt-2 space-y-2">
                  <textarea className="w-full min-h-[4rem] rounded-md border border-slate-300 p-2 text-sm" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Ask for carton dimensions and weight, and say we need them by Friday." />
                  <button type="button" className={buttonPlain} disabled={busy} onClick={generate}><Sparkles size={14} />Rewrite</button>
                </div>
              </details>
            </>
          ) : (
            <>
              <h3 className="text-sm font-bold text-ink">Write a reply</h3>
              <textarea className="w-full min-h-[4rem] rounded-md border border-slate-300 p-2 text-sm" value={instructions} onChange={(e) => setInstructions(e.target.value)}
                placeholder="Tell Claude what to say, or leave blank and it will write the reply this email needs." />
              <button type="button" className={buttonPrimary} disabled={busy} onClick={generate}><Sparkles size={14} />{busy ? 'Writing' : 'Write draft'}</button>
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
  const [supplierId, setSupplierId] = useState('');
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
        <select className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier">
          <option value="">Choose the supplier</option>
          {(people?.suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (
        <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Forwarder name" aria-label="Forwarder name" />
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'email'} onChange={() => setScope('email')} />Just {sender}</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'domain'} onChange={() => setScope('domain')} />Everyone at {domain}</label>
      </div>
      <button type="button" className={buttonPrimary} disabled={busy || !sender || (kind === 'supplier' ? !supplierId : !label.trim())}
        onClick={() => onSave({ kind, supplier_id: supplierId, label, email: scope === 'email' ? sender : '', domain: scope === 'domain' ? domain : '' })}>Save</button>
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
        <button type="button" className={buttonPrimary} disabled={busy} onClick={async () => { setBusy(true); try { window.location.assign((await inbox('mail_connect_url')).url); } catch (err) { setNotice({ type: 'error', text: err.message }); setBusy(false); } }}>Connect Gmail</button>
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

function SettingsView({ mail, reloadStatus, onChanged }) {
  const [data, setData] = useState(null);
  const [sig, setSig] = useState(mail.settings?.signature || '');
  const [auto, setAuto] = useState(mail.settings?.auto_draft !== false);
  const [form, setForm] = useState({ kind: 'supplier', supplier_id: '', label: '', email: '', domain: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => { try { setData(await inbox('list_contacts')); } catch (err) { setMsg({ type: 'error', text: err.message }); } }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg({ type: 'success', text: typeof ok === 'function' ? ok(r) : ok }); await load(); onChanged(); }
    catch (err) { setMsg({ type: 'error', text: err.message }); }
    setBusy(false);
  };
  const nameOfSupplier = useMemo(() => new Map((data?.suppliers || []).map((s) => [s.id, s.name])), [data]);
  if (!data) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <Notice n={msg} />
      {!mail.connected ? <ConnectCard mail={mail} setNotice={setMsg} /> : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="text-base font-bold text-ink">Gmail</h2>
          <p className="text-sm text-slate-700">Connected as <b>{mail.email}</b>. Replies are sent from {mail.send_as}.</p>
          <button type="button" className={buttonPlain} disabled={busy} onClick={() => run(async () => { await inbox('mail_disconnect'); await reloadStatus(); }, 'Gmail disconnected.')}>Disconnect</button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-base font-bold text-ink">Who is who</h2>
        <p className="text-sm text-slate-600">Claude only reads email from the addresses and domains saved here. This is also how email gets filed under a supplier. Drafts can only be addressed to these contacts or people already in the conversation.</p>
        <div className="grid gap-2 sm:grid-cols-[9rem_1fr_1fr_1fr_auto] items-end">
          <label className="text-xs font-semibold text-slate-600">Type
            <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="supplier">Supplier</option><option value="forwarder">Forwarder</option></select>
          </label>
          {form.kind === 'supplier' ? (
            <label className="text-xs font-semibold text-slate-600">Supplier
              <select className={inputClass} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}><option value="">Choose</option>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
          ) : (
            <label className="text-xs font-semibold text-slate-600">Forwarder name<input className={inputClass} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          )}
          <label className="text-xs font-semibold text-slate-600">Email address<input className={inputClass} value={form.email} placeholder="name@company.com" onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="text-xs font-semibold text-slate-600">or whole domain<input className={inputClass} value={form.domain} placeholder="company.com" onChange={(e) => setForm({ ...form, domain: e.target.value })} /></label>
          <button type="button" className={buttonPrimary} disabled={busy} onClick={() => run(async () => { const r = await inbox('save_contact', form); setForm({ ...form, email: '', domain: '' }); return r; }, (r) => `Saved. ${r.refiled} conversation(s) re-filed.`)}>Add</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-semibold">Belongs to</th><th className="py-1 font-semibold">Address</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.contacts.map((c) => (
                <tr key={c.id}>
                  <td className="py-1.5">{c.kind === 'forwarder' ? <>{c.label} <span className="text-xs text-slate-400">forwarder</span></> : nameOfSupplier.get(c.supplier_id) || 'Supplier'}</td>
                  <td className="py-1.5">{c.email || `everyone at ${c.domain}`}</td>
                  <td className="py-1.5 text-right"><button type="button" className="text-slate-400 hover:text-red-600 cursor-pointer" aria-label="Remove" disabled={busy} onClick={() => run(() => inbox('delete_contact', { id: c.id }), (r) => `Removed. ${r.refiled} conversation(s) re-filed.`)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
              {data.contacts.length === 0 && <tr><td colSpan={3} className="py-3 text-slate-500">Nothing saved yet. Open an unmatched email and file its sender, or add addresses here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

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

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { salesMail } from '../salesinbox/api';
import { buttonPrimary, buttonPlain } from '../wms/api';

// Johnson's Monday report: what lands in sales@, what kind of job it is, and how well the agent's practice (Shadow) replies match
// what staff really did. It only reads the log. Nothing here writes to DEAR or to a customer.
const PERIODS = [[7, 'Last 7 days'], [14, 'Last 14 days'], [28, 'Last 28 days'], [90, 'Last 90 days']];
const mins = (n) => (n == null ? 'not seen' : n < 90 ? `${n} min` : `${Math.round(n / 6) / 10} hours`);
const pct = (n) => (n == null ? 'not tested' : `${n}%`);

const Card = ({ n, label, hint }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3.5">
    <div className="text-3xl font-bold leading-none text-ink">{n}</div>
    <div className="mt-1.5 text-sm font-semibold text-ink">{label}</div>
    {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
  </div>
);

const VERDICT = {
  running: ['Still running. There is no verdict until every email has been done.', 'border-blue-200 bg-blue-50 text-blue-900'],
  memory_helps: ['Memory helps. It is worth building.', 'border-emerald-200 bg-emerald-50 text-emerald-900'],
  no_clear_gain: ["No clear gain from memory. Don't build it yet.", 'border-slate-200 bg-slate-50 text-slate-800'],
  memory_hurts_or_risky: ['Memory made the drafts worse, or let a wrong fact in. Do not build it.', 'border-red-200 bg-red-50 text-red-800'],
  not_enough: ['Not enough results to say. At least 30 emails that had similar examples are needed.', 'border-amber-200 bg-amber-50 text-amber-900'],
};
const TYPE_LABEL = { customer_order: 'Customer orders', delivery_freight: 'Delivery and freight', enquiry: 'Quote and stock enquiries' };
const show = (n) => (n == null ? 'n/a' : `${n}%`);

// Does showing the agent how the team answered similar emails make its drafts better? It takes real customer emails that a person answered,
// writes the reply twice (plain, and shown up to three similar OLDER replies), and marks both against what the person sent.
// Nothing is sent, saved as a draft, or written to DEAR.
function LearningTest() {
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const fail = (err) => ({ type: 'error', text: err.friendly || err.message });
  const load = useCallback(async () => {
    try { setRep(await salesMail('replay_report')); } catch (err) { setNote(fail(err)); setRep({ run: null }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, ok) => {
    setBusy(true);
    setNote(null);
    try { const r = await fn(); setNote({ type: 'success', text: ok(r) }); await load(); } catch (err) { setNote(fail(err)); }
    setBusy(false);
  };
  if (!rep) return <div className="p-4 text-sm text-slate-500">Loading the learning test</div>;
  const has = !!rep.run_id;
  const finished = has && rep.pending === 0;
  const verdict = has ? VERDICT[rep.verdict] : null;

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="lt-title">
      <div>
        <h3 id="lt-title" className="text-base font-bold text-ink">Learning test</h3>
        <p className="mt-0.5 text-sm text-slate-600">Does showing the agent how your team answered similar emails make its drafts better? It picks real customer emails that a person answered, writes the reply twice (plain, and shown three similar older replies), and marks both against what the person sent. Neither version looks up stock or prices, and the marking ignores facts the agent could not know: it judges the job done and the style. Nothing is sent or saved as a draft.</p>
      </div>
      {note && <div role={note.type === 'error' ? 'alert' : 'status'} className={`rounded-md border p-2.5 text-sm ${note.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{note.text}</div>}

      {finished && rep.failed > 0 && (
        <button type="button" className={buttonPlain} disabled={busy} onClick={() => act(() => salesMail('replay_retry'), (r) => `Put ${r.requeued} email${r.requeued === 1 ? '' : 's'} back in the queue. Press Run the next batch.`)}>Try the {rep.failed} that failed again</button>
      )}

      {(!has || finished) && (
        <button type="button" className={buttonPrimary} disabled={busy} onClick={() => act(() => salesMail('replay_start', { n: 60 }), (r) => `Picked ${r.total} emails to test (${Object.entries(r.selected).map(([t, n]) => `${n} ${(TYPE_LABEL[t] || t).toLowerCase()}`).join(', ')}).`)}>
          {busy ? 'Working' : has ? 'Start another test' : 'Start a test (about 60 emails)'}
        </button>
      )}

      {has && rep.pending > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm text-slate-700"><b>{rep.total - rep.pending - rep.failed} of {rep.total}</b> done{rep.failed ? `, ${rep.failed} could not be tested` : ''}. A batch takes a few minutes, and you can press the button again until it reaches the end.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonPrimary} disabled={busy} onClick={() => act(() => salesMail('replay_run'), (r) => `Marked ${r.done} email${r.done === 1 ? '' : 's'}${r.failed ? `, ${r.failed} failed` : ''}. ${r.remaining} still to go.`)}>
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />{busy ? 'Working (this can take a few minutes)' : 'Run the next batch'}
            </button>
            <button type="button" className={buttonPlain} disabled={busy} onClick={() => window.confirm('Stop this test? The emails not yet done are dropped, and you can start a new one.') && act(() => salesMail('replay_stop'), (r) => `Stopped. ${r.stopped} email${r.stopped === 1 ? '' : 's'} dropped.`)}>Stop this test</button>
          </div>
        </div>
      )}

      {has && (rep.tested > 0 || rep.pending > 0) && verdict && (
        <div className={`rounded-md border p-3 text-sm font-semibold ${verdict[1]}`}>{verdict[0]}</div>
      )}

      {has && rep.tested > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1.5 pr-3 font-semibold">{rep.tested} emails with similar examples</th><th className="py-1.5 pr-3 text-right font-semibold">Plain</th><th className="py-1.5 text-right font-semibold">With memory</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                <tr><td className="py-1.5 pr-3">Did the same job as the person</td><td className="py-1.5 pr-3 text-right">{show(rep.base_match)}</td><td className="py-1.5 text-right font-semibold">{show(rep.memory_match)}</td></tr>
                <tr><td className="py-1.5 pr-3">Same job, or partly</td><td className="py-1.5 pr-3 text-right">{show(rep.base_ok)}</td><td className="py-1.5 text-right font-semibold">{show(rep.memory_ok)}</td></tr>
                <tr><td className="py-1.5 pr-3">Tone and length close to the person's</td><td className="py-1.5 pr-3 text-right">{show(rep.base_close)}</td><td className="py-1.5 text-right font-semibold">{show(rep.memory_close)}</td></tr>
                <tr><td className="py-1.5 pr-3">Emails with a day, date or time copied from an example</td><td className="py-1.5 pr-3 text-right">{rep.base_wrong}</td><td className={`py-1.5 text-right font-semibold ${rep.memory_wrong - rep.base_wrong > 2 ? 'text-red-700' : ''}`}>{rep.memory_wrong}</td></tr>
              </tbody>
            </table>
          </div>
          {rep.by_type?.length > 0 && (
            <ul className="divide-y divide-slate-100 text-sm">
              {rep.by_type.map((t) => <li key={t.job_type} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="font-semibold text-ink">{TYPE_LABEL[t.job_type] || t.job_type}</span><span className="text-slate-600">{t.tested} tested: same job {show(t.base_match)} plain, {show(t.memory_match)} with memory. Style close {show(t.base_close)} plain, {show(t.memory_close)} with memory</span></li>)}
            </ul>
          )}
          <p className="text-xs text-slate-500">{rep.no_examples ? `${rep.no_examples} email${rep.no_examples === 1 ? '' : 's'} had nothing similar in the past, so were left out. ` : ''}Both versions are marked by the same AI marker, so read the examples below as well. The bar: at least 30 tested, 10 points better on the job or the style with neither 5 points worse, and no more than 2 extra emails copying a fact from an example.</p>
          {rep.examples?.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-blue-700">Read some examples side by side</summary>
              <ul className="mt-2 space-y-3">
                {rep.examples.map((e, i) => (
                  <li key={i} className="rounded-md border border-slate-200 p-2.5">
                    <div className="text-xs font-semibold text-slate-500">{TYPE_LABEL[e.job_type] || e.job_type} · {e.examples_used} example{e.examples_used === 1 ? '' : 's'} shown</div>
                    <div className="mt-1.5 grid gap-2 md:grid-cols-3">
                      {[[`What ${e.staff_replier || 'a person'} sent`, e.staff_reply, null], [`Plain (${e.base_score})`, e.base_reply, null], [`With memory (${e.memory_score})`, e.memory_reply, null]].map(([title, text]) => (
                        <div key={title}><div className="text-xs font-bold text-ink">{title}</div><pre className="mt-0.5 whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-sans text-xs text-slate-800">{text}</pre></div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export default function WatchReport() {
  const [days, setDays] = useState(28);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const failure = (err) => ({ type: 'error', text: err.friendly || err.message, detail: err.technical && err.technical !== err.message ? err.technical : null });

  const load = useCallback(async () => {
    try { setData(await salesMail('watch_report', { days })); } catch (err) { setNote(failure(err)); setData({ summary: [], gate: [], weeks: [], total: 0 }); }
  }, [days]);
  useEffect(() => { setData(null); load(); }, [load]);

  const runNow = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await salesMail('run_watch');
      setNote({ type: 'success', text: `Logged ${r.logged} new email${r.logged === 1 ? '' : 's'} (${r.ai} sorted by the assistant), found ${r.replies} staff repl${r.replies === 1 ? 'y' : 'ies'}, wrote ${r.shadow} practice repl${r.shadow === 1 ? 'y' : 'ies'} and scored ${r.scored}.${r.remaining ? ` ${r.remaining} more are waiting: run it again.` : ''}` });
      await load();
    } catch (err) { setNote(failure(err)); }
    setBusy(false);
  };

  if (!data) return <div className="p-8 text-center text-sm text-slate-500">Loading</div>;
  const share = data.total ? Math.round((data.machine_made / data.total) * 100) : 0;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-ink">Watch report</h2>
          <p className="text-sm text-slate-600">What lands in sales@ and how well the agent's practice replies match what staff did.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Period" className="min-h-[2.5rem] rounded-md border border-slate-300 bg-white px-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
          </select>
          <button type="button" className={buttonPrimary} disabled={busy} onClick={runNow}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />{busy ? 'Working' : 'Run Watch now'}</button>
        </div>
      </div>
      {note && (
        <div role={note.type === 'error' ? 'alert' : 'status'} className={`rounded-md border p-3 text-sm ${note.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {note.text}
          {note.detail && <details className="mt-1 text-xs opacity-80"><summary className="cursor-pointer">Show details for support</summary>{note.detail}</details>}
        </div>
      )}

      {data.total === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Nothing has been logged yet. Watch logs each customer email once sales@ is connected. Press <b>Run Watch now</b>, or wait for the schedule.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card n={data.total} label="Emails logged" hint={data.first_logged ? `Since ${new Date(data.first_logged).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : undefined} />
            <Card n={data.needs_person} label="Needed a person" hint="Orders, questions and problems" />
            <Card n={`${share}%`} label="Machine-made" hint="Never needed a person" />
            <Card n={data.replied} label="Staff replies seen" hint="Only where sales@ was on the reply" />
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <h3 className="border-b border-slate-100 px-4 py-2.5 text-sm font-bold text-ink">By job type</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-semibold">Job type</th><th className="px-2 py-2 text-right font-semibold">Emails</th><th className="px-2 py-2 text-right font-semibold">Needed a person</th>
                  <th className="px-2 py-2 text-right font-semibold">Replies seen</th><th className="px-2 py-2 text-right font-semibold">Typical reply time</th><th className="px-2 py-2 text-right font-semibold">Practice replies tested</th>
                  <th className="px-2 py-2 text-right font-semibold">Matched</th><th className="px-2 py-2 text-right font-semibold">Wrong fact</th><th className="px-4 py-2 text-right font-semibold">With a DEAR change</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.summary.map((r) => (
                    <tr key={r.job_type}>
                      <td className="px-4 py-2 font-semibold text-ink">{r.label}</td><td className="px-2 py-2 text-right">{r.emails}</td><td className="px-2 py-2 text-right">{r.needs_person}</td>
                      <td className="px-2 py-2 text-right">{r.replied}</td><td className="px-2 py-2 text-right">{mins(r.median_reply_minutes)}</td><td className="px-2 py-2 text-right">{r.shadow_tested}</td>
                      <td className="px-2 py-2 text-right">{pct(r.shadow_match_percent)}</td><td className={`px-2 py-2 text-right ${r.wrong_fact ? 'font-semibold text-red-700' : ''}`}>{r.wrong_fact}</td><td className="px-4 py-2 text-right">{r.with_dear_change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-bold text-ink">Ready to move up from practice to drafts?</h3>
            <p className="mt-1 text-xs text-slate-600">Johnson's gate: at least 10 practice replies in the last 14 days, 90% matching what staff did, and no wrong price, date or address.</p>
            <ul className="mt-2 divide-y divide-slate-100">
              {data.gate.map((g) => (
                <li key={g.job_type} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-semibold text-ink">{(data.summary.find((s) => s.job_type === g.job_type) || {}).label || g.job_type}</span>
                  <span className="text-slate-600">{g.tested} tested · {g.match_percent}% matched · {g.wrong_fact} wrong fact{g.wrong_fact === 1 ? '' : 's'}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${g.ready ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{g.ready ? 'Ready' : 'Not yet'}</span>
                </li>
              ))}
              {data.gate.length === 0 && <li className="py-2 text-sm text-slate-500">No practice replies have been scored yet. They are scored once staff have replied.</li>}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-bold text-ink">Week by week</h3>
            <ul className="mt-1 divide-y divide-slate-100 text-sm">
              {data.weeks.map((w) => <li key={w.label} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{w.label}</span><span className="text-slate-600">{w.emails} emails · {w.needs_person} needed a person · {w.machine_made} machine-made</span></li>)}
            </ul>
          </section>
        </>
      )}

      <LearningTest />

      <p className="text-xs text-slate-500">
        What this can't see: phone calls, staff's own inboxes when sales@ isn't copied, and clicks inside DEAR (only the result). Reply times only show for threads where sales@ was on the reply.
        The practice replies are never shown to a customer or put in the Drafts list.
      </p>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { salesMail } from '../salesinbox/api';
import { buttonPrimary } from '../wms/api';

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

      <p className="text-xs text-slate-500">
        What this can't see: phone calls, staff's own inboxes when sales@ isn't copied, and clicks inside DEAR (only the result). Reply times only show for threads where sales@ was on the reply.
        The practice replies are never shown to a customer or put in the Drafts list.
      </p>
    </div>
  );
}

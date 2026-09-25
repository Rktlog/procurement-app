// Step navigation for the fulfillment workflows. The numbered steps are a
// real sequence (select, validate, label, manifest, track); "Completed" is a
// history view, not a step, so it sits apart on the right without a number.
export default function StepBar({ steps, active, onChange, aside }) {
  return (
    <nav aria-label="Workflow steps" className="-mx-4 sm:mx-0 overflow-x-auto">
      <div className="flex items-stretch gap-2 min-w-max px-4 sm:px-0 border-b border-rule">
        <ol className="flex items-stretch">
          {steps.map((step, i) => {
            const isActive = step.id === active;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onChange(step.id)}
                  aria-current={isActive ? 'step' : undefined}
                  className={`group flex items-center gap-2.5 px-3.5 py-3 -mb-px border-b-[3px] text-sm cursor-pointer transition-colors ${
                    isActive
                      ? 'border-blue-600 text-ink font-semibold'
                      : 'border-transparent text-slate-600 hover:text-ink'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-full text-[0.75rem] font-bold flex items-center justify-center tabular-nums ${
                      isActive ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 group-hover:bg-slate-300'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="whitespace-nowrap">{step.label}</span>
                  {step.count != null && (
                    <span className="text-[0.78rem] tabular-nums text-slate-500">{step.count}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        {aside && (
          <div className="ml-auto flex items-stretch">
            <span aria-hidden="true" className="w-px bg-rule my-2.5 mr-2" />
            {aside.map((item) => {
              const isActive = item.id === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChange(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-2 px-3.5 py-3 -mb-px border-b-[3px] text-sm cursor-pointer whitespace-nowrap transition-colors ${
                    isActive ? 'border-emerald-600 text-ink font-semibold' : 'border-transparent text-slate-600 hover:text-ink'
                  }`}
                >
                  {item.label}
                  {item.count != null && <span className="text-[0.78rem] tabular-nums text-slate-500">{item.count}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}

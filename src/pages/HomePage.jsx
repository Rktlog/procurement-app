import { Link, Navigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../app/AuthContext';
import { useStagedPO } from '../app/StagedPOContext';

export default function HomePage() {
  const { isMasterAdmin, modules, business } = useAuth();
  const { items: stagedItems } = useStagedPO();

  // Someone with access to a single module goes straight to it.
  if (!isMasterAdmin && modules.length === 1) {
    return <Navigate to={modules[0].pages[0].path} replace />;
  }

  return (
    <div>
      <header className="border-b border-rule pb-5 mb-8">
        <h1 className="page-title text-[2.4rem] sm:text-[3rem] text-ink">{greeting()}</h1>
        <p className="mt-2 text-[0.95rem] text-slate-600">{business?.name}</p>
      </header>

      {stagedItems.length > 0 && (
        <Link
          to="/procurement/reorder"
          className="mb-8 flex items-center gap-4 rounded-lg border-l-[6px] border-hivis bg-white px-5 py-4 hover:bg-slate-50"
        >
          <span className="font-display font-extrabold [font-stretch:78%] text-3xl tabular-nums text-ink">
            {stagedItems.length}
          </span>
          <span className="flex-1 text-sm text-slate-700">
            {stagedItems.length === 1 ? 'item is' : 'items are'} staged for a purchase order and not sent yet.
          </span>
          <span className="text-sm font-semibold text-blue-700">Review PO</span>
          <ChevronRight size={18} className="text-blue-700" />
        </Link>
      )}

      {modules.length === 0 ? (
        <p className="text-sm text-slate-600">
          No modules are assigned to your account yet. Ask an admin to give you access.
        </p>
      ) : (
        <div className="grid gap-x-10 gap-y-10 md:grid-cols-2">
          {modules.map((module) => (
            <section key={module.appId}>
              <div className="flex items-center gap-2.5 mb-1">
                <module.icon size={20} strokeWidth={1.9} className="text-blue-600" />
                <h2 className="font-display font-bold [font-stretch:82%] text-xl text-ink">{module.title}</h2>
              </div>
              <p className="text-sm text-slate-600 mb-3">{module.summary}</p>
              <ul className="divide-y divide-rule border-y border-rule">
                {module.pages.map((page) => (
                  <li key={page.path}>
                    <Link
                      to={page.path}
                      className="group flex items-start gap-3 py-3 px-1 hover:bg-white/70 rounded-sm"
                    >
                      <page.icon size={17} strokeWidth={1.9} className="mt-0.5 shrink-0 text-slate-500 group-hover:text-blue-600" />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2 text-[0.95rem] font-semibold text-ink group-hover:text-blue-700">
                          {page.label}
                          {page.showsStagedCount && stagedItems.length > 0 && (
                            <span className="px-1.5 rounded-full bg-hivis text-ink text-[0.72rem] font-bold tabular-nums">
                              {stagedItems.length}
                            </span>
                          )}
                        </span>
                        <span className="block text-sm text-slate-600">{page.description}</span>
                      </span>
                      <ChevronRight size={16} className="mt-1 shrink-0 text-slate-400 group-hover:text-blue-600" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
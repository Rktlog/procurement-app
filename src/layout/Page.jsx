import { useLocation } from 'react-router-dom';
import { findPage } from '../app/navigation';

// Standard page frame: module name, page title, one-line description and an
// optional actions slot on the right. Title and description come from
// app/navigation.js so the sidebar and the header never disagree.
export default function Page({ title, description, actions, children }) {
  const { pathname } = useLocation();
  const match = findPage(pathname);
  const heading = title ?? match?.page.label;
  const blurb = description ?? match?.page.description;

  return (
    <div>
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between border-b border-rule pb-5 mb-6">
        <div className="min-w-0">
          {match && (
            <div className="text-sm font-medium text-blue-600 mb-1.5">{match.module.title}</div>
          )}
          <h1 className="page-title text-[2rem] sm:text-[2.4rem] text-ink">{heading}</h1>
          {blurb && <p className="mt-2 text-[0.95rem] text-slate-600 max-w-[62ch]">{blurb}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

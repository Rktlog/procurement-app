import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../app/AuthContext';
import PageErrorBoundary from './PageErrorBoundary';
import { useStagedPO } from '../app/StagedPOContext';
import { findPage } from '../app/navigation';

export default function AppLayout() {
  const location = useLocation();
  const match = findPage(location.pathname);

  useEffect(() => {
    document.title = match ? `${match.page.label} | Rocket Operation` : 'Rocket Operation';
  }, [match]);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <TopBar activeModuleId={match?.module.appId} />
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
        <PageErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </PageErrorBoundary>
      </main>
    </div>
  );
}

function TopBar({ activeModuleId }) {
  const { user, signOut, modules, business, businesses, canSwitchBusiness, switchBusiness } = useAuth();
  const { items: stagedItems } = useStagedPO();
  const location = useLocation();

  const [openMenu, setOpenMenu] = useState(null); // module appId, 'user', or null
  const [mobileOpen, setMobileOpen] = useState(false);
  const barRef = useRef(null);

  // Close everything on page change.
  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  // Click outside or Esc closes an open menu.
  useEffect(() => {
    if (!openMenu && !mobileOpen) return;
    const onClick = (e) => barRef.current && !barRef.current.contains(e.target) && setOpenMenu(null);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [openMenu, mobileOpen]);

  const stagedCount = stagedItems.length;

  return (
    <header ref={barRef} className="sticky top-0 z-40 bg-rail text-white">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 h-14 flex items-stretch gap-6">
        <Link to="/" className="flex items-center shrink-0">
          <span className="font-display font-extrabold [font-stretch:72%] text-[1.35rem] leading-none tracking-tight">
            Rocket Operation
          </span>
        </Link>

        {/* Company: a switcher for admins, a plain label for everyone else */}
        <div className="hidden lg:flex items-center shrink-0">
          {canSwitchBusiness ? (
            <select
              value={business?.id || ''}
              onChange={(e) => switchBusiness(e.target.value)}
              aria-label="Company"
              className="h-8 rounded-md bg-rail-hover text-white text-[0.85rem] font-semibold pl-2.5 pr-7 border border-white/15 cursor-pointer focus:outline-none focus:ring-2 focus:ring-hivis"
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id} className="text-ink">
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[0.85rem] font-semibold text-white/90 px-2.5 py-1 rounded-md bg-rail-hover">
              {business?.name}
            </span>
          )}
        </div>

        {/* Desktop menu */}
        <nav className="hidden lg:flex items-stretch gap-1" aria-label="Main">
          <NavLink
            to="/"
            end
            className={({ isActive }) => topItemClass(isActive)}
          >
            Home
          </NavLink>

          {modules.map((module) => {
            const isOpen = openMenu === module.appId;
            const isActive = activeModuleId === module.appId;
            const showBadge = module.appId === 'procurement' && stagedCount > 0;
            return (
              <div key={module.appId} className="relative flex items-stretch">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  onClick={() => setOpenMenu(isOpen ? null : module.appId)}
                  className={`${topItemClass(isActive)} ${isOpen ? 'bg-rail-hover text-white' : ''}`}
                >
                  {module.title}
                  {showBadge && <Badge count={stagedCount} />}
                  <ChevronDown size={15} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div
                    role="menu"
                    className="absolute left-0 top-full mt-1 w-[22rem] rounded-lg border border-rule bg-white text-ink shadow-lg py-2"
                  >
                    {module.pages.map((page) => (
                      <NavLink
                        key={page.path}
                        to={page.path}
                        role="menuitem"
                        className={({ isActive }) =>
                          `flex items-start gap-3 px-4 py-2.5 ${isActive ? 'bg-blue-50' : 'hover:bg-slate-50'}`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <page.icon
                              size={17}
                              strokeWidth={1.9}
                              className={`mt-0.5 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-500'}`}
                            />
                            <span className="flex-1 min-w-0">
                              <span className="flex items-center gap-2 text-[0.92rem] font-semibold">
                                {page.label}
                                {page.showsStagedCount && stagedCount > 0 && <Badge count={stagedCount} />}
                              </span>
                              <span className="block text-[0.8rem] text-slate-600 leading-snug">{page.description}</span>
                            </span>
                          </>
                        )}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Desktop user menu */}
        <div className="hidden lg:flex items-stretch ml-auto relative">
          <button
            type="button"
            aria-expanded={openMenu === 'user'}
            onClick={() => setOpenMenu(openMenu === 'user' ? null : 'user')}
            className="flex items-center gap-2 px-3 text-sm text-rail-text hover:text-white cursor-pointer"
          >
            <span className="max-w-[16rem] truncate">{user?.email}</span>
            <ChevronDown size={15} />
          </button>
          {openMenu === 'user' && (
            <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-rule bg-white text-ink shadow-lg py-1.5">
              <button
                type="button"
                onClick={signOut}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 cursor-pointer"
              >
                <LogOut size={16} className="text-slate-500" />
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          className="lg:hidden ml-auto self-center p-2 -mr-2 rounded-md hover:bg-rail-hover cursor-pointer"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu panel */}
      {mobileOpen && (
        <div className="lg:hidden absolute inset-x-0 top-full max-h-[calc(100vh-3.5rem)] overflow-y-auto bg-white text-ink border-b border-rule shadow-lg">
          <nav className="px-4 py-3" aria-label="Main">
            {canSwitchBusiness ? (
              <select
                value={business?.id || ''}
                onChange={(e) => switchBusiness(e.target.value)}
                aria-label="Company"
                className="w-full h-10 mb-2 rounded-md border border-rule bg-white text-[0.95rem] font-semibold px-2"
              >
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            ) : (
              <div className="text-[0.9rem] font-bold text-slate-700 mb-1">{business?.name}</div>
            )}
            <NavLink to="/" end className="block py-2 text-[0.95rem] font-semibold">
              Home
            </NavLink>
            {modules.map((module) => (
              <div key={module.appId} className="mt-3">
                <div className="text-[0.78rem] font-semibold text-blue-600 mb-1">{module.title}</div>
                {module.pages.map((page) => (
                  <NavLink
                    key={page.path}
                    to={page.path}
                    className={({ isActive }) =>
                      `flex items-center gap-3 py-2 pl-1 text-[0.95rem] ${isActive ? 'font-semibold text-blue-700' : ''}`
                    }
                  >
                    <page.icon size={17} strokeWidth={1.9} className="text-slate-500" />
                    <span className="flex-1">{page.label}</span>
                    {page.showsStagedCount && stagedCount > 0 && <Badge count={stagedCount} />}
                  </NavLink>
                ))}
              </div>
            ))}
            <div className="mt-4 pt-3 border-t border-rule">
              <div className="text-[0.8rem] text-slate-500 truncate">{user?.email}</div>
              <button
                type="button"
                onClick={signOut}
                className="mt-1.5 inline-flex items-center gap-2 text-sm font-semibold cursor-pointer"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

function topItemClass(isActive) {
  return `relative flex items-center gap-1.5 px-3 text-[0.92rem] cursor-pointer transition-colors ${
    isActive
      ? 'text-white font-semibold after:absolute after:left-3 after:right-3 after:bottom-0 after:h-[3px] after:bg-hivis'
      : 'text-rail-text hover:text-white hover:bg-rail-hover'
  }`;
}

function Badge({ count }) {
  return (
    <span
      className="min-w-[1.3rem] h-[1.3rem] px-1.5 rounded-full bg-hivis text-ink text-[0.72rem] font-bold inline-flex items-center justify-center tabular-nums"
      aria-label={`${count} staged`}
    >
      {count}
    </span>
  );
}

function PageLoading() {
  return (
    <div className="flex items-center gap-3 py-16 text-sm text-slate-600" role="status">
      <span className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin" />
      Loading page
    </div>
  );
}
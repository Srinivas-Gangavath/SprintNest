import { Link, useNavigate } from 'react-router-dom';
import { useOrg } from '../../contexts/OrgContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useProjectRoute } from '../../hooks/useProjectRoute';
import NotificationBell from '../NotificationBell';
import UserMenu from './UserMenu';

export default function TopBar({
  navOpen,
  onToggleNav,
}: {
  navOpen: boolean;
  onToggleNav: () => void;
}) {
  const navigate = useNavigate();
  const projectRoute = useProjectRoute();
  const { organizations, currentOrg, setCurrentOrg } = useOrg();
  const { openCreateWorkspace } = useWorkspace();

  const switcherOrgs =
    currentOrg && !organizations.some((org) => org.id === currentOrg.id)
      ? [currentOrg, ...organizations]
      : organizations;

  return (
    <header className="h-14 shrink-0 bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="h-full px-3 sm:px-4 flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          aria-controls="app-sidebar"
          onClick={onToggleNav}
        >
          {navOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>

        <Link
          to="/dashboard"
          className="flex items-center gap-2 shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          aria-label="SprintNest, go to dashboard"
        >
          <span className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            S
          </span>
          <span className="hidden sm:inline text-lg font-bold text-slate-900 tracking-tight">
            Sprint<span className="text-brand-600">Nest</span>
          </span>
        </Link>

        {switcherOrgs.length > 0 && (
          <div className="min-w-0 flex-1 sm:flex-none sm:max-w-xs">
            <label htmlFor="workspace-switcher" className="sr-only">
              Current workspace
            </label>
            <select
              id="workspace-switcher"
              value={currentOrg?.id || ''}
              onChange={(event) => {
                const selected = switcherOrgs.find((org) => org.id === event.target.value);
                if (!selected) return;
                setCurrentOrg(selected);
                if (projectRoute.onProject && projectRoute.orgId !== selected.id) {
                  navigate('/projects');
                }
              }}
              className="w-full max-w-[11rem] sm:max-w-xs bg-slate-50 border border-slate-300 text-slate-800 text-sm font-medium rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 cursor-pointer"
            >
              {switcherOrgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.role})
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={openCreateWorkspace}
          className="shrink-0 text-xs font-semibold text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2.5 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          <span className="sm:hidden" aria-hidden="true">
            +
          </span>
          <span className="hidden sm:inline">+ New Workspace</span>
          <span className="sr-only sm:hidden">New workspace</span>
        </button>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

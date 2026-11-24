import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useOrg } from '../../contexts/OrgContext';
import { WorkspaceProvider } from '../../contexts/WorkspaceContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useProjectRoute } from '../../hooks/useProjectRoute';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import CreateProjectModal from '../workspace/CreateProjectModal';
import CreateWorkspaceModal from '../workspace/CreateWorkspaceModal';
import InviteMemberModal from '../workspace/InviteMemberModal';
import SidebarNav from './SidebarNav';
import TopBar from './TopBar';

function ShellLayout() {
  const persistentNav = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const { orgId: routeOrgId } = useProjectRoute();
  const { organizations, currentOrg, setCurrentOrg } = useOrg();
  const appliedRouteOrg = useRef<string | null>(null);
  const drawerActive = navOpen && !persistentNav;

  useFocusTrap(drawerActive, drawerRef, closeNav);

  useEffect(() => {
    if (!drawerActive) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerActive]);

  useEffect(() => {
    if (persistentNav) setNavOpen(false);
  }, [persistentNav]);

  useEffect(() => {
    if (!routeOrgId) {
      appliedRouteOrg.current = null;
      return;
    }
    if (appliedRouteOrg.current === routeOrgId) return;
    if (currentOrg?.id === routeOrgId) {
      appliedRouteOrg.current = routeOrgId;
      return;
    }
    const match = organizations.find((org) => org.id === routeOrgId);
    if (!match) return;
    appliedRouteOrg.current = routeOrgId;
    setCurrentOrg(match);
  }, [routeOrgId, organizations, currentOrg?.id, setCurrentOrg]);

  return (
    <div className="h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[70] focus:top-2 focus:left-2 focus:bg-white focus:text-brand-700 focus:px-3 focus:py-2 focus:rounded-lg focus:shadow focus:ring-2 focus:ring-brand-500"
      >
        Skip to main content
      </a>
      <TopBar navOpen={drawerActive} onToggleNav={() => setNavOpen((open) => !open)} />
      <div className="flex flex-1 min-h-0">
        {drawerActive && (
          <button
            type="button"
            className="fixed inset-0 top-14 z-40 bg-slate-900/40 md:hidden"
            aria-label="Close navigation"
            onClick={closeNav}
          />
        )}
        {(persistentNav || navOpen) && (
          <aside
            id="app-sidebar"
            ref={drawerRef}
            tabIndex={-1}
            role={drawerActive ? 'dialog' : undefined}
            aria-modal={drawerActive ? true : undefined}
            aria-label={drawerActive ? 'Main menu' : undefined}
            className={
              persistentNav
                ? 'relative shrink-0 w-56 lg:w-60 bg-white border-r border-slate-200 flex flex-col'
                : 'fixed top-14 bottom-0 left-0 z-40 w-72 max-w-[85vw] bg-white border-r border-slate-200 flex flex-col shadow-xl'
            }
          >
            <SidebarNav onNavigate={persistentNav ? undefined : closeNav} />
          </aside>
        )}
        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 overflow-y-auto focus:outline-none">
          <Outlet />
        </main>
      </div>
      <CreateWorkspaceModal />
      <InviteMemberModal />
      <CreateProjectModal />
    </div>
  );
}

export default function AppShell() {
  return (
    <WorkspaceProvider>
      <ShellLayout />
    </WorkspaceProvider>
  );
}

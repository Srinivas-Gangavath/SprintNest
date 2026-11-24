import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useProjectRoute } from '../../hooks/useProjectRoute';
import { PRIMARY_NAV, SETTINGS_NAV, type NavItem } from './nav';

function NavIcon({ name }: { name: string }) {
  const common = 'w-4 h-4 shrink-0';
  switch (name) {
    case 'Dashboard':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" />
        </svg>
      );
    case 'My Tasks':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
      );
    case 'Projects':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
      );
    case 'Members':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 11a3 3 0 100-6 3 3 0 000 6zM22 19v-1a4 4 0 00-3-3.87M16 4.13a3 3 0 010 5.74" />
        </svg>
      );
    case 'Notifications':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0" />
        </svg>
      );
    case 'Activity':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" />
        </svg>
      );
    default:
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
        </svg>
      );
  }
}

function isNavActive(item: NavItem, pathname: string, projectOpen: boolean): boolean {
  if (item.to === '/projects' && projectOpen) return true;
  return pathname === item.to;
}

export default function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const { onProject } = useProjectRoute();
  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ data: { unreadCount: number } }>('/api/v1/notifications/unread-count'),
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.data?.unreadCount ?? 0;

  function renderItem(item: NavItem) {
    const active = isNavActive(item, pathname, onProject);
    return (
      <li key={item.to}>
        <Link
          to={item.to}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'group relative flex items-center gap-3 min-h-11 px-3 rounded-lg text-sm font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
            active ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          )}
        >
          <span
            className={cn(
              'absolute left-0 top-2 bottom-2 w-0.5 rounded-full',
              active ? 'bg-brand-600' : 'bg-transparent',
            )}
            aria-hidden="true"
          />
          <NavIcon name={item.label} />
          <span className="truncate">{item.label}</span>
          {item.to === '/notifications' && unreadCount > 0 && (
            <span
              className="ml-auto min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
              aria-label={`${unreadCount} unread`}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
      </li>
    );
  }

  return (
    <nav aria-label="Primary" className="flex-1 flex flex-col min-h-0 overflow-y-auto px-3 py-4">
      <ul className="space-y-1">{PRIMARY_NAV.map(renderItem)}</ul>
      <div className="mt-auto pt-4">
        <div className="mx-3 mb-3 border-t border-slate-200" role="separator" />
        <ul className="space-y-1">{SETTINGS_NAV.map(renderItem)}</ul>
      </div>
    </nav>
  );
}

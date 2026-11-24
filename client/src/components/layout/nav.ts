export interface NavItem {
  to: string;
  label: string;
  end: boolean;
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', end: true },
  { to: '/my-tasks', label: 'My Tasks', end: true },
  { to: '/projects', label: 'Projects', end: true },
  { to: '/members', label: 'Members', end: true },
  { to: '/notifications', label: 'Notifications', end: true },
  { to: '/activity', label: 'Activity', end: true },
];

export const SETTINGS_NAV: NavItem[] = [{ to: '/settings', label: 'Settings', end: true }];

export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function notificationIcon(type: string): string {
  switch (type) {
    case 'task_assigned':
      return '📋';
    case 'comment_added':
      return '💬';
    case 'invitation_received':
      return '✉️';
    default:
      return '🔔';
  }
}

/** Project board path stored on task and comment notifications. */
export function notificationProjectPath(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const { orgId, projectId } = data;
  if (typeof orgId !== 'string' || typeof projectId !== 'string') return null;
  if (!orgId || !projectId) return null;
  return `/orgs/${orgId}/projects/${projectId}`;
}

import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageHeader, { PageFrame } from '../components/layout/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import ErrorState from '../components/ui/ErrorState';
import LoadingBlock from '../components/ui/LoadingBlock';
import Pagination from '../components/ui/Pagination';
import { useListParams } from '../hooks/useListParams';
import { useSocketEvent } from '../hooks/useSocket';
import { api } from '../lib/api';
import { notificationIcon, notificationProjectPath, timeAgo, type AppNotification } from '../lib/notifications';
import { useOrg } from '../contexts/OrgContext';

interface NotificationsResponse {
  data: {
    notifications: AppNotification[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };
}

export default function NotificationsPage() {
  const { currentOrg } = useOrg();
  const queryClient = useQueryClient();
  const { page, setPage, setFilter, filter } = useListParams();
  const unreadOnly = filter('unread') === '1';

  const query = useQuery({
    queryKey: ['notifications', 'page', page, unreadOnly],
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.get<NotificationsResponse>(
        `/api/v1/notifications?page=${page}&limit=20${unreadOnly ? '&unreadOnly=true' : ''}`,
      ),
  });

  useSocketEvent('notification:new', () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });

  const markRead = useMutation({
    mutationFn: (notificationId: string) => api.patch(`/api/v1/notifications/${notificationId}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/api/v1/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const notifications = query.data?.data.notifications ?? [];
  const pagination = query.data?.data.pagination;

  return (
    <PageFrame>
      <PageHeader
        title="Notifications"
        description="Updates addressed to you."
        breadcrumbs={[{ label: currentOrg?.name ?? 'Workspace', to: '/dashboard' }, { label: 'Notifications' }]}
        actions={
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="btn-secondary text-xs"
          >
            {markAllRead.isPending ? 'Marking…' : 'Mark all read'}
          </button>
        }
      />

      <div className="flex items-center gap-2" role="group" aria-label="Notification filter">
        <button
          type="button"
          aria-pressed={!unreadOnly}
          onClick={() => setFilter('unread', '')}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            !unreadOnly ? 'bg-brand-50 text-brand-800 border-brand-200' : 'bg-white text-slate-600 border-slate-200'
          }`}
        >
          All
        </button>
        <button
          type="button"
          aria-pressed={unreadOnly}
          onClick={() => setFilter('unread', '1')}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            unreadOnly ? 'bg-brand-50 text-brand-800 border-brand-200' : 'bg-white text-slate-600 border-slate-200'
          }`}
        >
          Unread
        </button>
      </div>

      {query.isLoading ? (
        <LoadingBlock label="Loading notifications" />
      ) : query.isError ? (
        <ErrorState message="Failed to load notifications." onRetry={() => void query.refetch()} />
      ) : notifications.length === 0 ? (
        <EmptyState
          title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
          description="Assignments, comments, and invitations will show up here."
        />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {notifications.map((notification) => {
            const href = notificationProjectPath(notification.data);
            return (
              <li key={notification.id} className={!notification.isRead ? 'bg-brand-50/40' : undefined}>
                <div className="px-4 py-3.5 flex items-start gap-3">
                  <span className="text-base mt-0.5" aria-hidden="true">
                    {notificationIcon(notification.type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${notification.isRead ? 'text-slate-600' : 'text-slate-900 font-medium'}`}>
                      {notification.title}
                      {!notification.isRead && <span className="sr-only"> (unread)</span>}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">{timeAgo(notification.createdAt)}</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {href && (
                        <Link
                          to={href}
                          onClick={() => {
                            if (!notification.isRead) markRead.mutate(notification.id);
                          }}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          Open project
                        </Link>
                      )}
                      {!notification.isRead && (
                        <button
                          type="button"
                          onClick={() => markRead.mutate(notification.id)}
                          className="text-xs font-medium text-slate-500 hover:text-slate-800 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pagination && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          busy={query.isFetching}
          onPageChange={setPage}
        />
      )}
    </PageFrame>
  );
}

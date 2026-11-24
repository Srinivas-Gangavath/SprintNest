import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useOrg } from '../contexts/OrgContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import EmptyWorkspace from '../components/workspace/EmptyWorkspace';
import ProjectsPanel from '../components/workspace/ProjectsPanel';
import ReceivedInvitationsBanner from '../components/workspace/ReceivedInvitationsBanner';
import PageHeader, { PageFrame, WorkspaceAlert } from '../components/layout/PageHeader';
import ErrorState from '../components/ui/ErrorState';
import LoadingBlock from '../components/ui/LoadingBlock';
import { api, ApiError } from '../lib/api';
import { notificationIcon, timeAgo, type AppNotification } from '../lib/notifications';
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS, type TaskSummary } from '../lib/tasks';

interface MyTasksPreview {
  data: {
    tasks: Array<{
      id: string;
      title: string;
      taskNumber: number;
      status: string;
      priority: string;
      project: { id: string; name: string };
    }>;
    summary: TaskSummary;
  };
}

interface ActivityPreview {
  data: {
    activities: Array<{
      id: string;
      summary: string;
      createdAt: string;
      actor: { displayName: string };
    }>;
  };
}

interface NotificationPreview {
  data: { notifications: AppNotification[] };
}

const STATUS_ORDER = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BACKLOG', 'DONE'] as const;

export default function DashboardPage() {
  const { currentOrg, isLoading, error: orgError, clearError } = useOrg();
  const { directoryLoading, error, setError } = useWorkspace();
  const orgId = currentOrg?.id;
  const canReviewActivity = currentOrg?.role === 'OWNER' || currentOrg?.role === 'ADMIN';

  const tasksQuery = useQuery({
    queryKey: ['my-tasks', orgId, 'preview'],
    enabled: Boolean(orgId),
    queryFn: () => api.get<MyTasksPreview>(`/api/v1/orgs/${orgId}/my-tasks?limit=5`),
  });

  const activityQuery = useQuery({
    queryKey: ['activity', orgId, 'preview'],
    enabled: Boolean(orgId && canReviewActivity),
    queryFn: () => api.get<ActivityPreview>(`/api/v1/orgs/${orgId}/activity?limit=5`),
  });

  const notificationsQuery = useQuery({
    queryKey: ['notifications', 'preview'],
    enabled: Boolean(orgId),
    queryFn: () => api.get<NotificationPreview>('/api/v1/notifications?limit=5'),
  });

  const summary = tasksQuery.data?.data.summary;

  return (
    <PageFrame className="py-6 sm:py-6 space-y-5">
      <PageHeader
        title={currentOrg ? currentOrg.name : 'Dashboard'}
        description={currentOrg ? 'Overview of your work in this workspace.' : 'Your workspaces and assignments.'}
        actions={
          currentOrg ? (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200">
              {currentOrg.role}
            </span>
          ) : undefined
        }
      />

      <WorkspaceAlert message={orgError || error} onDismiss={() => { clearError(); setError(null); }} />
      <ReceivedInvitationsBanner />

      {isLoading ? (
        <LoadingBlock label="Loading workspace" />
      ) : !currentOrg ? (
        <EmptyWorkspace />
      ) : (
        <div className="space-y-4">
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4" aria-label="Task summary">
            <div className="card p-5 col-span-2 sm:col-span-1">
              <p className="text-xs text-slate-500">Assigned to you</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{summary?.total ?? '—'}</p>
            </div>
            {STATUS_ORDER.map((status) => (
              <div key={status} className="card p-5">
                <p className="text-xs text-slate-500">{TASK_STATUS_LABELS[status]}</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{summary ? summary[status] : '—'}</p>
              </div>
            ))}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="card p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-lg font-semibold text-slate-900">My Tasks</h2>
                <Link to="/my-tasks" className="text-xs font-semibold text-brand-600 hover:text-brand-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  View all
                </Link>
              </div>
              {tasksQuery.isLoading ? (
                <LoadingBlock label="Loading your tasks" />
              ) : tasksQuery.isError ? (
                <ErrorState
                  message={tasksQuery.error instanceof ApiError ? tasksQuery.error.message : 'Could not load your tasks.'}
                  onRetry={() => void tasksQuery.refetch()}
                />
              ) : (tasksQuery.data?.data.tasks.length ?? 0) === 0 ? (
                <p className="text-sm text-slate-500">Nothing is assigned to you yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {tasksQuery.data?.data.tasks.map((task) => (
                    <li key={task.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to={`/orgs/${orgId}/projects/${task.project.id}`}
                          className="text-sm font-medium text-slate-800 hover:text-brand-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          <span className="text-slate-400 font-mono text-xs mr-2">#{task.taskNumber}</span>
                          {task.title}
                        </Link>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">{task.project.name}</p>
                      </div>
                      <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded border ${TASK_STATUS_COLORS[task.status]}`}>
                        {TASK_STATUS_LABELS[task.status] ?? task.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              {directoryLoading ? <LoadingBlock label="Loading projects" /> : <ProjectsPanel mode="preview" />}
            </section>

            <section className="card p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Recent activity</h2>
                {canReviewActivity && (
                  <Link to="/activity" className="text-xs font-semibold text-brand-600 hover:text-brand-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    View all
                  </Link>
                )}
              </div>
              {!canReviewActivity ? (
                <p className="text-sm text-slate-500">Owners and admins can review this workspace&apos;s audit log.</p>
              ) : activityQuery.isLoading ? (
                <LoadingBlock label="Loading activity" />
              ) : activityQuery.isError ? (
                <ErrorState message="Could not load activity." onRetry={() => void activityQuery.refetch()} />
              ) : (activityQuery.data?.data.activities.length ?? 0) === 0 ? (
                <p className="text-sm text-slate-500">No activity yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {activityQuery.data?.data.activities.map((entry) => (
                    <li key={entry.id} className="py-3">
                      <p className="text-sm text-slate-800">
                        <span className="font-medium">{entry.actor.displayName}</span> {entry.summary}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{timeAgo(entry.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
                <Link to="/notifications" className="text-xs font-semibold text-brand-600 hover:text-brand-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  View all
                </Link>
              </div>
              {notificationsQuery.isLoading ? (
                <LoadingBlock label="Loading notifications" />
              ) : notificationsQuery.isError ? (
                <ErrorState message="Could not load notifications." onRetry={() => void notificationsQuery.refetch()} />
              ) : (notificationsQuery.data?.data.notifications.length ?? 0) === 0 ? (
                <p className="text-sm text-slate-500">No notifications yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {notificationsQuery.data?.data.notifications.map((notification) => (
                    <li key={notification.id} className="py-3 flex items-start gap-2.5">
                      <span aria-hidden="true">{notificationIcon(notification.type)}</span>
                      <div className="min-w-0">
                        <p className={`text-sm ${notification.isRead ? 'text-slate-600' : 'text-slate-900 font-medium'}`}>
                          {notification.title}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">{timeAgo(notification.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </PageFrame>
  );
}

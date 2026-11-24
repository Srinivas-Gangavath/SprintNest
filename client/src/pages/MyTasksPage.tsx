import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useOrg } from '../contexts/OrgContext';
import EmptyWorkspace from '../components/workspace/EmptyWorkspace';
import PageHeader, { PageFrame } from '../components/layout/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import ErrorState from '../components/ui/ErrorState';
import LoadingBlock from '../components/ui/LoadingBlock';
import Pagination from '../components/ui/Pagination';
import { useListParams } from '../hooks/useListParams';
import { api, ApiError } from '../lib/api';
import { TASK_PRIORITY_LABELS, TASK_STATUS_COLORS, TASK_STATUS_LABELS, type TaskSummary } from '../lib/tasks';

interface MyTask {
  id: string;
  taskNumber: number;
  title: string;
  status: string;
  priority: string;
  project: { id: string; name: string };
}

interface MyTasksResponse {
  data: {
    tasks: MyTask[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
    summary: TaskSummary;
  };
}

const STATUSES = ['', 'BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];
const PRIORITIES = ['', 'NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export default function MyTasksPage() {
  const { currentOrg, isLoading } = useOrg();
  const { page, setPage, setFilter, filter } = useListParams();
  const status = filter('status');
  const priority = filter('priority');
  const orgId = currentOrg?.id;

  const query = useQuery({
    queryKey: ['my-tasks', orgId, { page, status, priority }],
    enabled: Boolean(orgId),
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (status) params.set('status', status);
      if (priority) params.set('priority', priority);
      return api.get<MyTasksResponse>(`/api/v1/orgs/${orgId}/my-tasks?${params}`);
    },
  });

  const tasks = query.data?.data.tasks ?? [];
  const pagination = query.data?.data.pagination;

  return (
    <PageFrame>
      <PageHeader
        title="My Tasks"
        description={currentOrg ? `Tasks assigned to you in ${currentOrg.name}` : 'Tasks assigned to you.'}
        breadcrumbs={[{ label: currentOrg?.name ?? 'Workspace', to: '/dashboard' }, { label: 'My Tasks' }]}
      />

      {isLoading ? (
        <LoadingBlock label="Loading workspace" />
      ) : !currentOrg ? (
        <EmptyWorkspace />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="min-w-0">
              <label htmlFor="task-status-filter" className="label">
                Status
              </label>
              <select
                id="task-status-filter"
                className="input py-2"
                value={STATUSES.includes(status) ? status : ''}
                onChange={(event) => setFilter('status', event.target.value)}
              >
                <option value="">All statuses</option>
                {STATUSES.filter(Boolean).map((value) => (
                  <option key={value} value={value}>
                    {TASK_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="task-priority-filter" className="label">
                Priority
              </label>
              <select
                id="task-priority-filter"
                className="input py-2"
                value={PRIORITIES.includes(priority) ? priority : ''}
                onChange={(event) => setFilter('priority', event.target.value)}
              >
                <option value="">All priorities</option>
                {PRIORITIES.filter(Boolean).map((value) => (
                  <option key={value} value={value}>
                    {TASK_PRIORITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {query.isLoading ? (
            <LoadingBlock label="Loading your tasks" />
          ) : query.isError ? (
            <ErrorState
              message={query.error instanceof ApiError ? query.error.message : 'Could not load your tasks.'}
              onRetry={() => void query.refetch()}
            />
          ) : tasks.length === 0 ? (
            <EmptyState
              title="No matching tasks"
              description="Tasks assigned to you in this workspace show up here. Try another status or priority."
              action={
                <Link to="/projects" className="btn-primary text-sm">
                  Browse projects
                </Link>
              }
            />
          ) : (
            <ul className="card divide-y divide-slate-100">
              {tasks.map((task) => (
                <li key={task.id} className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to={`/orgs/${orgId}/projects/${task.project.id}`}
                      className="text-sm font-medium text-slate-800 hover:text-brand-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <span className="text-slate-400 font-mono text-xs mr-2">#{task.taskNumber}</span>
                      {task.title}
                    </Link>
                    <p className="text-xs text-slate-400 mt-0.5">{task.project.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-medium text-slate-500">{TASK_PRIORITY_LABELS[task.priority] ?? task.priority}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${TASK_STATUS_COLORS[task.status] ?? TASK_STATUS_COLORS.BACKLOG}`}>
                      {TASK_STATUS_LABELS[task.status] ?? task.status}
                    </span>
                  </div>
                </li>
              ))}
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
        </>
      )}
    </PageFrame>
  );
}

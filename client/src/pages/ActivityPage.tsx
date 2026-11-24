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
import { timeAgo } from '../lib/notifications';

interface ActivityResponse {
  data: {
    activities: Array<{
      id: string;
      orgId: string;
      action: string;
      summary: string;
      createdAt: string;
      actor: { id: string; displayName: string };
      project: { id: string; name: string } | null;
      task: { id: string; title: string; taskNumber: number } | null;
    }>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };
}

export default function ActivityPage() {
  const { currentOrg, isLoading } = useOrg();
  const { page, setPage } = useListParams();
  const canReview = currentOrg?.role === 'OWNER' || currentOrg?.role === 'ADMIN';
  const orgId = currentOrg?.id;

  const query = useQuery({
    queryKey: ['activity', orgId, { page }],
    enabled: Boolean(orgId && canReview),
    placeholderData: keepPreviousData,
    queryFn: () => api.get<ActivityResponse>(`/api/v1/orgs/${orgId}/activity?page=${page}&limit=20`),
  });

  const rows = (query.data?.data.activities ?? []).filter((row) => row.orgId === orgId);
  const pagination = query.data?.data.pagination;

  return (
    <PageFrame>
      <PageHeader
        title="Activity"
        description={currentOrg ? `Audit log for ${currentOrg.name}` : 'Workspace audit log.'}
        breadcrumbs={[{ label: currentOrg?.name ?? 'Workspace', to: '/dashboard' }, { label: 'Activity' }]}
      />

      {isLoading ? (
        <LoadingBlock label="Loading workspace" />
      ) : !currentOrg ? (
        <EmptyWorkspace />
      ) : !canReview ? (
        <EmptyState
          title="Owners and admins only"
          description="The audit log is limited to workspace owners and admins. Your role in this workspace does not include it."
        />
      ) : query.isLoading ? (
        <LoadingBlock label="Loading activity" />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : 'Could not load activity.'}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No activity yet" description="Workspace changes will be listed here as they happen." />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-3.5">
              <p className="text-sm text-slate-800">
                <span className="font-semibold">{row.actor.displayName}</span> {row.summary}
              </p>
              <p className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <span>{timeAgo(row.createdAt)}</span>
                {row.project && <span>{row.project.name}</span>}
                {row.task && (
                  <span>
                    #{row.task.taskNumber} {row.task.title}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canReview && pagination && (
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

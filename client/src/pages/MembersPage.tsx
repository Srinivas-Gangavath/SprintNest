import { useOrg } from '../contexts/OrgContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import EmptyWorkspace from '../components/workspace/EmptyWorkspace';
import MembersPanel from '../components/workspace/MembersPanel';
import PageHeader, { PageFrame, WorkspaceAlert } from '../components/layout/PageHeader';
import LoadingBlock from '../components/ui/LoadingBlock';

export default function MembersPage() {
  const { currentOrg, isLoading, error: orgError, clearError } = useOrg();
  const { directoryLoading, error, setError, canManage, openInvite } = useWorkspace();
  const loading = isLoading || (Boolean(currentOrg) && directoryLoading);

  return (
    <PageFrame>
      <PageHeader
        title="Members"
        description={currentOrg ? `People in ${currentOrg.name}` : 'Create a workspace to invite your team.'}
        breadcrumbs={[{ label: currentOrg?.name ?? 'Workspace', to: '/dashboard' }, { label: 'Members' }]}
        actions={
          currentOrg && canManage ? (
            <button type="button" onClick={openInvite} className="btn-primary text-sm py-2">
              Invite Member
            </button>
          ) : undefined
        }
      />
      <WorkspaceAlert message={orgError || error} onDismiss={() => { clearError(); setError(null); }} />
      {loading ? (
        <LoadingBlock label="Loading members" />
      ) : !currentOrg ? (
        <EmptyWorkspace />
      ) : (
        <MembersPanel />
      )}
    </PageFrame>
  );
}

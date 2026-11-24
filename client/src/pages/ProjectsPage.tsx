import { useOrg } from '../contexts/OrgContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import EmptyWorkspace from '../components/workspace/EmptyWorkspace';
import ProjectsPanel from '../components/workspace/ProjectsPanel';
import PageHeader, { PageFrame, WorkspaceAlert } from '../components/layout/PageHeader';
import LoadingBlock from '../components/ui/LoadingBlock';

export default function ProjectsPage() {
  const { currentOrg, isLoading, error: orgError, clearError } = useOrg();
  const { directoryLoading, error, setError, canManage, openCreateProject, projects } = useWorkspace();
  const loading = isLoading || (Boolean(currentOrg) && directoryLoading);

  return (
    <PageFrame>
      <PageHeader
        title="Projects"
        description={
          currentOrg
            ? loading
              ? `Projects in ${currentOrg.name}`
              : `${projects.length} project${projects.length === 1 ? '' : 's'} in ${currentOrg.name}`
            : 'Create a workspace to add projects.'
        }
        breadcrumbs={[{ label: currentOrg?.name ?? 'Workspace', to: '/dashboard' }, { label: 'Projects' }]}
        actions={
          currentOrg && canManage ? (
            <button type="button" onClick={openCreateProject} className="btn-primary text-sm py-2">
              + New Project
            </button>
          ) : undefined
        }
      />
      <WorkspaceAlert message={orgError || error} onDismiss={() => { clearError(); setError(null); }} />
      {loading ? (
        <LoadingBlock label="Loading projects" />
      ) : !currentOrg ? (
        <EmptyWorkspace />
      ) : (
        <ProjectsPanel mode="full" />
      )}
    </PageFrame>
  );
}

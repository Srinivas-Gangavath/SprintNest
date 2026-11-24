import { useMatch } from 'react-router-dom';

/** Matches a project board and an optional task deep link on that board. */
export function useProjectRoute() {
  const projectMatch = useMatch('/orgs/:orgId/projects/:projectId');
  const taskMatch = useMatch('/orgs/:orgId/projects/:projectId/tasks/:taskId');
  const orgId = taskMatch?.params.orgId ?? projectMatch?.params.orgId ?? null;
  const projectId = taskMatch?.params.projectId ?? projectMatch?.params.projectId ?? null;
  const taskId = taskMatch?.params.taskId ?? null;

  return {
    orgId,
    projectId,
    taskId,
    onProject: Boolean(orgId && projectId),
  };
}

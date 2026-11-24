import { Link } from 'react-router-dom';
import { useOrg } from '../../contexts/OrgContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { cn } from '../../lib/cn';

export default function ProjectsPanel({ mode }: { mode: 'full' | 'preview' }) {
  const { currentOrg } = useOrg();
  const { projects, canManage, openCreateProject } = useWorkspace();

  if (!currentOrg) return null;

  const visible = mode === 'preview' ? projects.slice(0, 5) : projects;

  return (
    <div className={cn('card', mode === 'preview' ? 'p-5' : 'p-6')}>
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Projects
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={openCreateProject}
            className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 px-2 py-1 rounded hover:bg-brand-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            + New
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center">
          <span className="text-xs text-slate-400">No projects yet</span>
          {canManage && (
            <button
              type="button"
              onClick={openCreateProject}
              className="block mx-auto mt-2 text-xs text-brand-600 hover:text-brand-700 font-medium rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Create your first project
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map((project) => (
            <Link
              key={project.id}
              to={`/orgs/${currentOrg.id}/projects/${project.id}`}
              className="interactive-card flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-md bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 text-xs font-bold shrink-0">
                  {project.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate group-hover:text-brand-700 transition-colors">
                    {project.name}
                  </div>
                  {project.description && <div className="text-[10px] text-slate-400 truncate">{project.description}</div>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-slate-400 font-mono">{project.taskCount ?? project.taskCounter} tasks</span>
                <svg className="w-3.5 h-3.5 text-slate-300 group-hover:text-brand-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}

      {mode === 'preview' && projects.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <Link
            to="/projects"
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
          >
            {projects.length > visible.length ? 'View all projects' : 'Open projects'}
          </Link>
        </div>
      )}
    </div>
  );
}

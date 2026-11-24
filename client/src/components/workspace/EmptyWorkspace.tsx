import { useWorkspace } from '../../contexts/WorkspaceContext';

export default function EmptyWorkspace() {
  const { openCreateWorkspace } = useWorkspace();

  return (
    <div className="card p-12 text-center max-w-lg mx-auto mt-6">
      <div className="w-12 h-12 rounded-xl bg-brand-50 border border-brand-100 text-brand-600 flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-slate-900 mb-2">Welcome to SprintNest</h2>
      <p className="text-slate-500 text-sm mb-6">
        Create your first organization or workspace to start managing projects and collaborating with your team.
      </p>
      <button type="button" onClick={openCreateWorkspace} className="btn-primary">
        Create Organization
      </button>
    </div>
  );
}

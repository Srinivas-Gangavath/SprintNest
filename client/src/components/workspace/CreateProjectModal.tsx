import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useOrg } from '../../contexts/OrgContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { ApiError } from '../../lib/api';

export default function CreateProjectModal() {
  const { currentOrg } = useOrg();
  const { isCreateProjectOpen, closeCreateProject, createProject } = useWorkspace();
  const panelRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCreateProjectOpen) return;
    setName('');
    setDescription('');
    setError(null);
  }, [isCreateProjectOpen]);

  useFocusTrap(isCreateProjectOpen, panelRef, closeCreateProject);

  if (!isCreateProjectOpen) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createProject(name.trim(), description.trim());
      closeCreateProject();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="create-project-title" tabIndex={-1} className="card p-6 max-w-md w-full shadow-xl outline-none">
        <h3 id="create-project-title" className="text-lg font-bold text-slate-900 mb-2">
          Create New Project
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Projects organize tasks and team collaboration within <strong className="text-slate-700">{currentOrg?.name}</strong>.
        </p>
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 mb-4">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="project-name" className="label">
              Project Name
            </label>
            <input
              id="project-name"
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Website Redesign"
              className="input"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="project-description" className="label">
              Description <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Brief description of the project..."
              className="input min-h-[80px] resize-y"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeCreateProject} className="btn-secondary text-xs">
              Cancel
            </button>
            <button type="submit" disabled={submitting || !name.trim()} className="btn-primary text-xs">
              {submitting ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

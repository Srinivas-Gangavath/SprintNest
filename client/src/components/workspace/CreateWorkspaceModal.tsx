import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useOrg } from '../../contexts/OrgContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { ApiError } from '../../lib/api';

export default function CreateWorkspaceModal() {
  const { createOrganization } = useOrg();
  const { isCreateWorkspaceOpen, closeCreateWorkspace } = useWorkspace();
  const panelRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCreateWorkspaceOpen) return;
    setName('');
    setError(null);
  }, [isCreateWorkspaceOpen]);

  useFocusTrap(isCreateWorkspaceOpen, panelRef, closeCreateWorkspace);

  if (!isCreateWorkspaceOpen) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createOrganization(name.trim());
      closeCreateWorkspace();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create organization');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-workspace-title"
        tabIndex={-1}
        className="card p-6 max-w-md w-full shadow-xl outline-none"
      >
        <h3 id="create-workspace-title" className="text-lg font-bold text-slate-900 mb-2">
          Create New Organization
        </h3>
        <p className="text-xs text-slate-500 mb-4">Enter a name for your team or organization workspace.</p>
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 mb-4">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="workspace-name" className="label">
              Organization Name
            </label>
            <input
              id="workspace-name"
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Acme Engineering"
              className="input"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeCreateWorkspace} className="btn-secondary text-xs">
              Cancel
            </button>
            <button type="submit" disabled={submitting || !name.trim()} className="btn-primary text-xs">
              {submitting ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

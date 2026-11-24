import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useOrg } from '../../contexts/OrgContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { ApiError } from '../../lib/api';

export default function InviteMemberModal() {
  const { currentOrg } = useOrg();
  const { isInviteOpen, closeInvite, inviteMember } = useWorkspace();
  const panelRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isInviteOpen) return;
    setEmail('');
    setRole('MEMBER');
    setError(null);
    setSuccess(null);
  }, [isInviteOpen]);

  useFocusTrap(isInviteOpen, panelRef, closeInvite);

  if (!isInviteOpen) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await inviteMember(email.trim(), role);
      setSuccess(`Invitation sent to ${email.trim()}`);
      setEmail('');
      window.setTimeout(() => closeInvite(), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send invitation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="invite-member-title" tabIndex={-1} className="card p-6 max-w-md w-full shadow-xl outline-none">
        <h3 id="invite-member-title" className="text-lg font-bold text-slate-900 mb-2">
          Invite Teammate
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Send an invitation to join <strong className="text-slate-700">{currentOrg?.name}</strong>.
        </p>
        {success && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-xs text-green-700 mb-4">{success}</div>
        )}
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 mb-4">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="invite-email" className="label">
              Teammate&apos;s Email
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="colleague@company.com"
              className="input"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="label">
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value as 'ADMIN' | 'MEMBER')}
              className="input cursor-pointer"
            >
              <option value="MEMBER">Member (can create & edit tasks)</option>
              <option value="ADMIN">Admin (can manage members & projects)</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeInvite} className="btn-secondary text-xs">
              Cancel
            </button>
            <button type="submit" disabled={submitting || !email.trim()} className="btn-primary text-xs">
              {submitting ? 'Sending...' : 'Send Invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export default function ReceivedInvitationsBanner() {
  const { user } = useAuth();
  const { pendingInvitations } = useWorkspace();

  if (pendingInvitations.length === 0) return null;

  return (
    <div className="card p-5 border-amber-200 bg-amber-50/50">
      <h2 className="text-sm font-semibold text-amber-900 mb-1">Pending Workspace Invitations</h2>
      <p className="text-xs text-amber-800/80 mb-3">
        Click <span className="font-medium">Accept Invitation</span> in the email we sent to{' '}
        <span className="font-medium">{user?.email}</span>. That link opens this app and adds you to the workspace.
      </p>
      <div className="space-y-2">
        {pendingInvitations.map((invitation) => (
          <div
            key={invitation.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white p-3 rounded-lg border border-amber-200 text-sm"
          >
            <div>
              <span className="font-semibold text-slate-800">{invitation.organization.name}</span>
              <span className="text-slate-500 text-xs ml-2">
                invited by {invitation.invitedBy.displayName} as{' '}
                <span className="font-medium text-amber-700">{invitation.role}</span>
              </span>
            </div>
            <span className="text-xs text-slate-400">Expires {new Date(invitation.expiresAt).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

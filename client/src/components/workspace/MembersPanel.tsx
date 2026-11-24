import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import { useWorkspace, type OrgMember, type OrgPendingInvitation } from '../../contexts/WorkspaceContext';
import ConfirmDialog from '../ui/ConfirmDialog';

function roleBadge(role: string) {
  return role === 'OWNER'
    ? 'bg-purple-50 text-purple-700 border border-purple-200'
    : role === 'ADMIN'
      ? 'bg-blue-50 text-blue-700 border border-blue-200'
      : 'bg-slate-100 text-slate-600';
}

export default function MembersPanel() {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const {
    members,
    sentInvitations,
    sentInvitationsLoading,
    sentInvitationsError,
    invitationActionId,
    canManage,
    isOwner,
    changeMemberRole,
    removeMember,
    resendInvitation,
    cancelInvitation,
  } = useWorkspace();
  const [pendingRemove, setPendingRemove] = useState<OrgMember | null>(null);
  const [pendingCancel, setPendingCancel] = useState<OrgPendingInvitation | null>(null);

  if (!currentOrg) return null;

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Team Members</h2>
            <p className="text-xs text-slate-500">Collaborators with access to this workspace</p>
          </div>
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md shrink-0">
            {members.length} member{members.length === 1 ? '' : 's'}
          </span>
        </div>

        {!canManage && (
          <p className="text-xs text-slate-500 mb-4">
            Owners and admins manage invitations and roles. You can see who belongs to this workspace.
          </p>
        )}

        {members.length === 0 ? (
          <p className="text-sm text-slate-400">No members yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {members.map((member) => (
              <div key={member.id} className="py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600 text-xs shrink-0">
                    {member.user.displayName?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800 text-sm truncate">{member.user.displayName}</span>
                      {member.userId === user?.id && (
                        <span className="text-[10px] bg-slate-100 text-slate-500 font-medium px-1.5 py-0.5 rounded">You</span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 truncate block">{member.user.email}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {isOwner && member.role !== 'OWNER' ? (
                    <select
                      value={member.role}
                      aria-label={`Role for ${member.user.displayName}`}
                      onChange={(event) => void changeMemberRole(member.id, event.target.value as 'ADMIN' | 'MEMBER')}
                      className="text-xs font-medium rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="MEMBER">MEMBER</option>
                    </select>
                  ) : (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleBadge(member.role)}`}>
                      {member.role}
                    </span>
                  )}

                  {((isOwner && member.role !== 'OWNER') || (currentOrg.role === 'ADMIN' && member.role === 'MEMBER')) &&
                    member.userId !== user?.id && (
                      <button
                        type="button"
                        onClick={() => setPendingRemove(member)}
                        className="text-slate-400 hover:text-red-600 text-xs font-medium transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        aria-label={`Remove ${member.user.displayName}`}
                      >
                        Remove
                      </button>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {canManage && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Pending Invitations</h2>
              <p className="text-xs text-slate-500">Invitations sent by this workspace that have not been accepted</p>
            </div>
            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md shrink-0">
              {sentInvitations.length} pending
            </span>
          </div>

          {sentInvitationsLoading ? (
            <p className="text-sm text-slate-400">Loading invitations…</p>
          ) : sentInvitationsError ? (
            <p className="text-sm text-red-600">Could not load pending invitations.</p>
          ) : sentInvitations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
              <p className="text-sm text-slate-500">No pending invitations.</p>
              <p className="text-xs text-slate-400 mt-1">Invite a teammate and they will show up here until they accept.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sentInvitations.map((invitation) => {
                const busy = invitationActionId === invitation.id;
                return (
                  <div key={invitation.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 text-sm truncate">{invitation.email}</div>
                      <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>
                          Role <span className="font-medium text-slate-700">{invitation.role}</span>
                        </span>
                        <span>Invited by {invitation.invitedBy.displayName}</span>
                        <span>Sent {new Date(invitation.createdAt).toLocaleDateString()}</span>
                        <span>Expires {new Date(invitation.expiresAt).toLocaleDateString()}</span>
                        <span className="font-medium text-amber-700">{invitation.status}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void resendInvitation(invitation.id)}
                        disabled={busy}
                        className="text-xs font-medium text-brand-700 hover:text-brand-800 border border-brand-200 px-2.5 py-1.5 rounded-lg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        {busy ? 'Working…' : 'Resend'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingCancel(invitation)}
                        disabled={busy}
                        className="text-xs font-medium text-red-600 hover:text-red-700 border border-red-200 px-2.5 py-1.5 rounded-lg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        title="Remove member"
        description={
          pendingRemove
            ? `${pendingRemove.user.displayName} will lose access to ${currentOrg.name}.`
            : ''
        }
        confirmLabel="Remove member"
        onClose={() => setPendingRemove(null)}
        onConfirm={() => {
          if (!pendingRemove) return;
          const memberId = pendingRemove.id;
          setPendingRemove(null);
          void removeMember(memberId);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingCancel)}
        title="Cancel invitation"
        description={
          pendingCancel
            ? `The emailed link for ${pendingCancel.email} will stop working.`
            : ''
        }
        confirmLabel="Cancel invitation"
        pending={Boolean(pendingCancel && invitationActionId === pendingCancel.id)}
        onClose={() => setPendingCancel(null)}
        onConfirm={() => {
          if (!pendingCancel) return;
          const invitationId = pendingCancel.id;
          setPendingCancel(null);
          void cancelInvitation(invitationId);
        }}
      />
    </div>
  );
}

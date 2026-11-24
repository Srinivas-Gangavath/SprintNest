import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useOrg } from '../contexts/OrgContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import PageHeader, { PageFrame, WorkspaceAlert } from '../components/layout/PageHeader';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { api, ApiError } from '../lib/api';

type SettingsTab = 'profile' | 'workspace' | 'security';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'security', label: 'Security' },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, refreshUser, logout } = useAuth();
  const { currentOrg, error: orgError, clearError } = useOrg();
  const { error, setError, canManage, isOwner, renameWorkspace, deleteCurrentWorkspace } = useWorkspace();
  const [tab, setTab] = useState<SettingsTab>('profile');

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [workspaceName, setWorkspaceName] = useState(currentOrg?.name ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
  }, [user?.displayName]);

  useEffect(() => {
    setWorkspaceName(currentOrg?.name ?? '');
  }, [currentOrg?.id, currentOrg?.name]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!displayName.trim()) return;
    setProfileSaving(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      await api.patch('/api/v1/auth/me', { displayName: displayName.trim() });
      await refreshUser();
      setProfileMessage('Profile updated.');
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !workspaceName.trim()) return;
    setWorkspaceSaving(true);
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    try {
      await renameWorkspace(workspaceName.trim());
      setWorkspaceMessage('Workspace name updated.');
    } catch (err) {
      setWorkspaceError(err instanceof ApiError ? err.message : 'Failed to rename workspace');
    } finally {
      setWorkspaceSaving(false);
    }
  }

  return (
    <PageFrame>
      <PageHeader
        title="Settings"
        description="Profile, workspace, and account security."
        breadcrumbs={[{ label: currentOrg?.name ?? 'Workspace', to: '/dashboard' }, { label: 'Settings' }]}
      />
      <WorkspaceAlert message={orgError || error} onDismiss={() => { clearError(); setError(null); }} />

      <div role="tablist" aria-label="Settings sections" className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`settings-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`settings-panel-${item.id}`}
            onClick={() => setTab(item.id)}
            className={`text-sm font-medium px-3 py-1.5 rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              tab === item.id ? 'bg-brand-50 text-brand-800 border-brand-200' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <form
          id="settings-panel-profile"
          role="tabpanel"
          aria-labelledby="settings-tab-profile"
          onSubmit={saveProfile}
          className="card p-6 space-y-4 max-w-xl"
        >
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
            <p className="text-xs text-slate-500 mt-1">This name appears on tasks, comments, and invitations.</p>
          </div>
          {profileMessage && <p className="text-sm text-green-700">{profileMessage}</p>}
          {profileError && (
            <p role="alert" className="text-sm text-red-700">
              {profileError}
            </p>
          )}
          <div>
            <label htmlFor="display-name" className="label">
              Display name
            </label>
            <input
              id="display-name"
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              maxLength={100}
            />
          </div>
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" className="input bg-slate-50" value={user?.email ?? ''} readOnly />
          </div>
          <button type="submit" className="btn-primary text-sm" disabled={profileSaving || !displayName.trim()}>
            {profileSaving ? 'Saving...' : 'Save profile'}
          </button>
        </form>
      )}

      {tab === 'workspace' && (
        <div id="settings-panel-workspace" role="tabpanel" aria-labelledby="settings-tab-workspace" className="space-y-6 max-w-xl">
          <form onSubmit={saveWorkspace} className="card p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Workspace</h2>
              <p className="text-xs text-slate-500 mt-1">
                {currentOrg
                  ? `You are ${currentOrg.role} in ${currentOrg.name}.`
                  : 'Create a workspace from the top bar to manage one here.'}
              </p>
            </div>
            {currentOrg && (
              <>
                {workspaceMessage && <p className="text-sm text-green-700">{workspaceMessage}</p>}
                {workspaceError && (
                  <p role="alert" className="text-sm text-red-700">
                    {workspaceError}
                  </p>
                )}
                <div>
                  <label htmlFor="workspace-name-setting" className="label">
                    Workspace name
                  </label>
                  <input
                    id="workspace-name-setting"
                    className="input"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    required
                    maxLength={100}
                    readOnly={!canManage}
                  />
                </div>
                <p className="text-xs text-slate-400">Slug: {currentOrg.slug}</p>
                {!canManage && (
                  <p className="text-xs text-slate-500">Only owners and admins can rename this workspace.</p>
                )}
                {canManage && (
                  <button type="submit" className="btn-primary text-sm" disabled={workspaceSaving || !workspaceName.trim()}>
                    {workspaceSaving ? 'Saving...' : 'Save workspace'}
                  </button>
                )}
              </>
            )}
          </form>

          {isOwner && currentOrg && (
            <section className="card p-6 border-red-200">
              <h2 className="text-lg font-semibold text-red-700">Delete workspace</h2>
              <p className="text-sm text-slate-600 mt-1 mb-4">
                Deleting {currentOrg.name} removes its projects and cannot be undone.
              </p>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 px-3 py-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                Delete workspace
              </button>
            </section>
          )}
        </div>
      )}

      {tab === 'security' && (
        <section
          id="settings-panel-security"
          role="tabpanel"
          aria-labelledby="settings-tab-security"
          className="card p-6 space-y-4 max-w-xl"
        >
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Security</h2>
            <p className="text-sm text-slate-600 mt-2">
              Your session is stored in an httpOnly cookie. SprintNest does not offer an in-session password change.
              To set a new password, sign out and request a reset email from the sign-in page.
            </p>
          </div>
          <button type="button" onClick={() => setConfirmReset(true)} className="btn-secondary text-sm">
            Sign out and reset password
          </button>
        </section>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete workspace"
        description={currentOrg ? `${currentOrg.name} and its projects will be removed. This cannot be undone.` : ''}
        confirmLabel="Delete workspace"
        pending={deleting}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setDeleting(true);
          void deleteCurrentWorkspace().finally(() => {
            setDeleting(false);
            setConfirmDelete(false);
          });
        }}
      />
      <ConfirmDialog
        open={confirmReset}
        title="Reset your password"
        description="You will be signed out. On the next screen, enter your email to receive a reset link."
        confirmLabel="Sign out"
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          void logout().then(() => navigate('/forgot-password'));
        }}
      />
    </PageFrame>
  );
}

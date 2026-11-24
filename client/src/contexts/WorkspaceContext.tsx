import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { useOrg, type Organization } from './OrgContext';
import { api, ApiError } from '../lib/api';
import { useSocketEvent } from '../hooks/useSocket';

export interface OrgMember {
  id: string;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  joinedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
  };
}

/** Invitation this organization sent. Not an invitation the current user received. */
export interface OrgPendingInvitation {
  id: string;
  email: string;
  role: 'ADMIN' | 'MEMBER' | 'OWNER';
  status: string;
  createdAt: string;
  expiresAt: string;
  invitedBy: { displayName: string };
}

export interface PendingInvitation {
  id: string;
  role: 'ADMIN' | 'MEMBER';
  createdAt: string;
  expiresAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  invitedBy: {
    displayName: string;
  };
}

export interface WorkspaceProject {
  id: string;
  name: string;
  description: string | null;
  isArchived: boolean;
  taskCounter: number;
  taskCount?: number;
  createdAt: string;
}

interface WorkspaceContextValue {
  members: OrgMember[];
  projects: WorkspaceProject[];
  pendingInvitations: PendingInvitation[];
  sentInvitations: OrgPendingInvitation[];
  sentInvitationsLoading: boolean;
  sentInvitationsError: boolean;
  invitationActionId: string | null;
  directoryLoading: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  isCreateWorkspaceOpen: boolean;
  openCreateWorkspace: () => void;
  closeCreateWorkspace: () => void;
  isInviteOpen: boolean;
  openInvite: () => void;
  closeInvite: () => void;
  isCreateProjectOpen: boolean;
  openCreateProject: () => void;
  closeCreateProject: () => void;
  inviteMember: (email: string, role: 'ADMIN' | 'MEMBER') => Promise<void>;
  resendInvitation: (invitationId: string) => Promise<void>;
  cancelInvitation: (invitationId: string) => Promise<void>;
  changeMemberRole: (memberId: string, role: 'ADMIN' | 'MEMBER') => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  createProject: (name: string, description: string) => Promise<void>;
  deleteCurrentWorkspace: () => Promise<void>;
  renameWorkspace: (name: string) => Promise<void>;
  canManage: boolean;
  isOwner: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  return fallback;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { currentOrg, refreshOrganizations, deleteOrganization } = useOrg();
  const queryClient = useQueryClient();

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);

  const [isCreateWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [isInviteOpen, setInviteOpen] = useState(false);
  const [isCreateProjectOpen, setCreateProjectOpen] = useState(false);

  const canManage = currentOrg?.role === 'OWNER' || currentOrg?.role === 'ADMIN';
  const isOwner = currentOrg?.role === 'OWNER';

  const sentInvitationsQuery = useQuery({
    queryKey: ['org-pending-invitations', currentOrg?.id],
    enabled: Boolean(currentOrg?.id && canManage),
    queryFn: async () => {
      const res = await api.get<{ data: { invitations: OrgPendingInvitation[] } }>(
        `/api/v1/orgs/${currentOrg!.id}/members/invitations`,
      );
      return res.data.invitations;
    },
  });

  const refreshSentInvitations = useCallback(async () => {
    if (!currentOrg?.id) return;
    await queryClient.invalidateQueries({ queryKey: ['org-pending-invitations', currentOrg.id] });
  }, [currentOrg?.id, queryClient]);

  const fetchMembers = useCallback(async (orgId: string) => {
    const res = await api.get<{ data: { members: OrgMember[] } }>(`/api/v1/orgs/${orgId}/members`);
    setMembers(res.data.members);
  }, []);

  const fetchProjects = useCallback(async (orgId: string) => {
    const res = await api.get<{ data: { projects: WorkspaceProject[] } }>(`/api/v1/orgs/${orgId}/projects`);
    setProjects(res.data.projects);
  }, []);

  const fetchInvitations = useCallback(async () => {
    try {
      const res = await api.get<{ data: { invitations: PendingInvitation[] } }>('/api/v1/invitations/pending');
      setPendingInvitations(res.data.invitations || []);
    } catch {
      // Non-critical. The workspace still loads if this list fails.
    }
  }, []);

  useEffect(() => {
    void fetchInvitations();
  }, [fetchInvitations]);

  useEffect(() => {
    if (!currentOrg?.id) {
      setMembers([]);
      setProjects([]);
      return;
    }
    let cancelled = false;
    setDirectoryLoading(true);
    Promise.all([fetchMembers(currentOrg.id), fetchProjects(currentOrg.id)])
      .catch((err) => {
        if (!cancelled) setError(messageFrom(err, 'Failed to load workspace'));
      })
      .finally(() => {
        if (!cancelled) setDirectoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentOrg?.id, fetchMembers, fetchProjects]);

  const syncMembership = useCallback(
    (payload: { orgId?: string; userId?: string }) => {
      if (payload?.orgId && payload.orgId === currentOrg?.id) {
        void fetchMembers(payload.orgId).catch((err) => {
          setError(messageFrom(err, 'Failed to refresh members'));
        });
      }
      if (payload?.userId && payload.userId === user?.id) {
        void refreshOrganizations({ replaceMissing: true });
      }
    },
    [currentOrg?.id, user?.id, fetchMembers, refreshOrganizations],
  );

  useSocketEvent('member:added', syncMembership);
  useSocketEvent('member:removed', syncMembership);

  const inviteMember = useCallback(
    async (email: string, role: 'ADMIN' | 'MEMBER') => {
      if (!currentOrg) return;
      await api.post(`/api/v1/orgs/${currentOrg.id}/members/invitations`, { email, role });
      await refreshSentInvitations();
    },
    [currentOrg, refreshSentInvitations],
  );

  const resendInvitation = useCallback(
    async (invitationId: string) => {
      if (!currentOrg) return;
      setInvitationActionId(invitationId);
      setError(null);
      try {
        await api.post(`/api/v1/orgs/${currentOrg.id}/members/invitations/${invitationId}/resend`);
        await refreshSentInvitations();
      } catch (err) {
        setError(messageFrom(err, 'Failed to resend invitation'));
      } finally {
        setInvitationActionId(null);
      }
    },
    [currentOrg, refreshSentInvitations],
  );

  const cancelInvitation = useCallback(
    async (invitationId: string) => {
      if (!currentOrg) return;
      setInvitationActionId(invitationId);
      setError(null);
      try {
        await api.post(`/api/v1/orgs/${currentOrg.id}/members/invitations/${invitationId}/cancel`);
        await refreshSentInvitations();
      } catch (err) {
        setError(messageFrom(err, 'Failed to cancel invitation'));
      } finally {
        setInvitationActionId(null);
      }
    },
    [currentOrg, refreshSentInvitations],
  );

  const changeMemberRole = useCallback(
    async (memberId: string, role: 'ADMIN' | 'MEMBER') => {
      if (!currentOrg) return;
      try {
        await api.patch(`/api/v1/orgs/${currentOrg.id}/members/${memberId}/role`, { role });
        setMembers((prev) => prev.map((member) => (member.id === memberId ? { ...member, role } : member)));
      } catch (err) {
        setError(messageFrom(err, 'Failed to change role'));
      }
    },
    [currentOrg],
  );

  const removeMember = useCallback(
    async (memberId: string) => {
      if (!currentOrg) return;
      try {
        await api.delete(`/api/v1/orgs/${currentOrg.id}/members/${memberId}`);
        setMembers((prev) => prev.filter((member) => member.id !== memberId));
      } catch (err) {
        setError(messageFrom(err, 'Failed to remove member'));
      }
    },
    [currentOrg],
  );

  const createProject = useCallback(
    async (name: string, description: string) => {
      if (!currentOrg) return;
      await api.post(`/api/v1/orgs/${currentOrg.id}/projects`, {
        name,
        description: description || undefined,
      });
      await fetchProjects(currentOrg.id);
    },
    [currentOrg, fetchProjects],
  );

  const deleteCurrentWorkspace = useCallback(async () => {
    if (!currentOrg) return;
    try {
      await deleteOrganization(currentOrg.id);
    } catch (err) {
      setError(messageFrom(err, 'Failed to delete workspace'));
    }
  }, [currentOrg, deleteOrganization]);

  const renameWorkspace = useCallback(
    async (name: string) => {
      if (!currentOrg) return;
      await api.patch(`/api/v1/orgs/${currentOrg.id}`, { name });
      await refreshOrganizations();
    },
    [currentOrg, refreshOrganizations],
  );

  const value: WorkspaceContextValue = {
    members,
    projects,
    pendingInvitations,
    sentInvitations: sentInvitationsQuery.data ?? [],
    sentInvitationsLoading: sentInvitationsQuery.isLoading,
    sentInvitationsError: sentInvitationsQuery.isError,
    invitationActionId,
    directoryLoading,
    error,
    setError,
    isCreateWorkspaceOpen,
    openCreateWorkspace: () => {
      setError(null);
      setCreateWorkspaceOpen(true);
    },
    closeCreateWorkspace: () => setCreateWorkspaceOpen(false),
    isInviteOpen,
    openInvite: () => {
      setError(null);
      setInviteOpen(true);
    },
    closeInvite: () => setInviteOpen(false),
    isCreateProjectOpen,
    openCreateProject: () => {
      setError(null);
      setCreateProjectOpen(true);
    },
    closeCreateProject: () => setCreateProjectOpen(false),
    inviteMember,
    resendInvitation,
    cancelInvitation,
    changeMemberRole,
    removeMember,
    createProject,
    deleteCurrentWorkspace,
    renameWorkspace,
    canManage,
    isOwner,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

export type { Organization };

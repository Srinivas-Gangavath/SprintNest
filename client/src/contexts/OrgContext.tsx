import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useAuth } from './AuthContext';
import { api, ApiError } from '../lib/api';
import { useProjectRoute } from '../hooks/useProjectRoute';
import { readPreferredOrgId, selectWorkspace, writePreferredOrgId } from '../lib/workspacePreference';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  role: string;
  createdAt: string;
}

interface RefreshOptions {
  /** When the selected workspace was just deleted, pick another from the fresh list. */
  dropOrgId?: string;
  /** If the selected workspace is no longer in the list, select the first remaining one. */
  replaceMissing?: boolean;
}

interface OrgContextValue {
  organizations: Organization[];
  currentOrg: Organization | null;
  setCurrentOrg: Dispatch<SetStateAction<Organization | null>>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  refreshOrganizations: (options?: RefreshOptions) => Promise<Organization[]>;
  createOrganization: (name: string) => Promise<Organization>;
  deleteOrganization: (orgId: string) => Promise<void>;
}

const OrgContext = createContext<OrgContextValue | null>(null);

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { orgId: routeOrgId } = useProjectRoute();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrgState] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const userIdRef = useRef<string | null>(null);
  const routeOrgIdRef = useRef<string | null>(null);
  const loadedForUser = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;
  routeOrgIdRef.current = routeOrgId;

  const setCurrentOrg = useCallback((action: SetStateAction<Organization | null>) => {
    setCurrentOrgState(action);
  }, []);

  const refreshOrganizations = useCallback(async (options?: RefreshOptions) => {
    const seq = ++requestSeq.current;
    try {
      const res = await api.get<{ data: { organizations: Organization[] } }>('/api/v1/orgs');
      if (seq !== requestSeq.current) return res.data.organizations;
      const list = res.data.organizations;
      setOrganizations(list);
      setCurrentOrgState((prev) => {
        const previous = prev && prev.id !== options?.dropOrgId ? prev : null;
        const storage = browserStorage();
        const stored =
          storage && userIdRef.current ? readPreferredOrgId(storage, userIdRef.current) : null;
        const decision = selectWorkspace(list, {
          routeOrgId: routeOrgIdRef.current,
          currentOrgId: previous?.id ?? null,
          persistedOrgId: stored && stored !== options?.dropOrgId ? stored : null,
          retainMissingCurrent: Boolean(previous) && !options?.replaceMissing && !options?.dropOrgId,
        });
        if (decision.source === 'keep-current') return previous;
        if (decision.source === 'none') return null;
        return decision.organization;
      });
      setError(null);
      return list;
    } catch (err) {
      if (seq !== requestSeq.current) return [];
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load workspaces');
      return [];
    }
  }, []);

  useEffect(() => {
    const storage = browserStorage();
    if (!storage || !user?.id || !currentOrg?.id) return;
    writePreferredOrgId(storage, user.id, currentOrg.id);
  }, [user?.id, currentOrg?.id]);

  useEffect(() => {
    if (!user) {
      loadedForUser.current = null;
      requestSeq.current += 1;
      setOrganizations([]);
      setCurrentOrgState(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (loadedForUser.current !== user.id) {
      loadedForUser.current = user.id;
      requestSeq.current += 1;
      setCurrentOrgState(null);
    }

    let cancelled = false;
    setIsLoading(true);
    refreshOrganizations().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user, refreshOrganizations]);

  const createOrganization = useCallback(
    async (name: string) => {
      const res = await api.post<{ data: { organization: Organization } }>('/api/v1/orgs', { name });
      const created: Organization = { ...res.data.organization, role: 'OWNER' };
      setCurrentOrg(created);
      await refreshOrganizations();
      return created;
    },
    [refreshOrganizations],
  );

  const deleteOrganization = useCallback(
    async (orgId: string) => {
      await api.delete(`/api/v1/orgs/${orgId}`);
      await refreshOrganizations({ dropOrgId: orgId });
    },
    [refreshOrganizations],
  );

  return (
    <OrgContext.Provider
      value={{
        organizations,
        currentOrg,
        setCurrentOrg,
        isLoading,
        error,
        clearError: () => setError(null),
        refreshOrganizations,
        createOrganization,
        deleteOrganization,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}

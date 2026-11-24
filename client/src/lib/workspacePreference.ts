/**
 * Remembers which workspace the user last chose.
 * The value is an organization id only. It is never an authorization decision:
 * startup still picks an organization from the list the API returned for this user.
 */

const PREFIX = 'sprintnest.workspace.';

export function workspacePreferenceKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function readPreferredOrgId(storage: Pick<Storage, 'getItem'>, userId: string): string | null {
  try {
    const value = storage.getItem(workspacePreferenceKey(userId));
    if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function writePreferredOrgId(storage: Pick<Storage, 'setItem'>, userId: string, orgId: string): void {
  try {
    storage.setItem(workspacePreferenceKey(userId), orgId);
  } catch {
    // A full or blocked store must not stop workspace switching.
  }
}

export type WorkspaceSelection<T extends { id: string }> =
  | { source: 'route' | 'current' | 'persisted' | 'fallback'; organization: T }
  | { source: 'keep-current' }
  | { source: 'none' };

/**
 * Chooses a workspace the user is allowed to see.
 *
 * A route organization wins, then the in-memory selection, then a stored id
 * that still appears in `accessible`, then the first accessible organization.
 * Ids that are not in `accessible` are ignored.
 */
export function selectWorkspace<T extends { id: string }>(
  accessible: readonly T[],
  input: {
    routeOrgId?: string | null;
    currentOrgId?: string | null;
    persistedOrgId?: string | null;
    retainMissingCurrent?: boolean;
  },
): WorkspaceSelection<T> {
  const find = (id?: string | null) => (id ? accessible.find((organization) => organization.id === id) : undefined);

  const fromRoute = find(input.routeOrgId);
  if (fromRoute) return { source: 'route', organization: fromRoute };

  const fromCurrent = find(input.currentOrgId);
  if (fromCurrent) return { source: 'current', organization: fromCurrent };

  if (input.retainMissingCurrent && input.currentOrgId) {
    return { source: 'keep-current' };
  }

  const fromPersisted = find(input.persistedOrgId);
  if (fromPersisted) return { source: 'persisted', organization: fromPersisted };

  const first = accessible[0];
  if (first) return { source: 'fallback', organization: first };
  return { source: 'none' };
}

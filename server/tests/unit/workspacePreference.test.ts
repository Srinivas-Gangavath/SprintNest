import { describe, expect, it } from 'vitest';
import {
  readPreferredOrgId,
  selectWorkspace,
  workspacePreferenceKey,
  writePreferredOrgId,
} from '../../../client/src/lib/workspacePreference';

const orgA = { id: '11111111-1111-4111-8111-111111111111', name: 'Org A' };
const orgB = { id: '22222222-2222-4222-8222-222222222222', name: 'Org B' };
const accessible = [orgA, orgB];

describe('selectWorkspace', () => {
  it('keeps the organization from the URL when the user can access it', () => {
    const selected = selectWorkspace(accessible, {
      routeOrgId: orgA.id,
      persistedOrgId: orgB.id,
      currentOrgId: orgB.id,
    });
    expect(selected).toEqual({ source: 'route', organization: orgA });
  });

  it('uses a stored organization after refresh when the URL has no organization', () => {
    const selected = selectWorkspace(accessible, {
      routeOrgId: null,
      currentOrgId: null,
      persistedOrgId: orgB.id,
    });
    expect(selected).toEqual({ source: 'persisted', organization: orgB });
  });

  it('ignores a stored id the user cannot access and uses the first accessible organization', () => {
    const selected = selectWorkspace(accessible, {
      persistedOrgId: '33333333-3333-4333-8333-333333333333',
    });
    expect(selected).toEqual({ source: 'fallback', organization: orgA });
  });

  it('ignores a route id the user cannot access', () => {
    const selected = selectWorkspace(accessible, {
      routeOrgId: '33333333-3333-4333-8333-333333333333',
      persistedOrgId: orgB.id,
    });
    expect(selected).toEqual({ source: 'persisted', organization: orgB });
  });

  it('keeps an in-memory selection that the latest list does not contain yet', () => {
    const selected = selectWorkspace(accessible, {
      currentOrgId: '44444444-4444-4444-8444-444444444444',
      persistedOrgId: orgA.id,
      retainMissingCurrent: true,
    });
    expect(selected).toEqual({ source: 'keep-current' });
  });

  it('returns none when the user has no organizations', () => {
    expect(selectWorkspace([], { persistedOrgId: orgB.id })).toEqual({ source: 'none' });
  });
});

describe('workspace preference storage', () => {
  it('stores only the organization id for that user', () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    };

    writePreferredOrgId(storage, 'user-b', orgB.id);

    expect(saved.get(workspacePreferenceKey('user-b'))).toBe(orgB.id);
    expect(readPreferredOrgId(storage, 'user-b')).toBe(orgB.id);
    expect(readPreferredOrgId(storage, 'user-a')).toBeNull();
    expect([...saved.values()].join(' ')).not.toMatch(/token|secret|password/i);
  });

  it('rejects a stored value that is not an organization id', () => {
    const storage = {
      getItem: () => 'not-an-id',
    };
    expect(readPreferredOrgId(storage, 'user-a')).toBeNull();
  });
});

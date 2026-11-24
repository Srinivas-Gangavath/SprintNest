import { redis } from '../config/redis.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'cache' });

/**
 * Cache-aside utility built on the existing ioredis client.
 *
 * Design principles:
 * - Redis is ONLY an optimization layer — never a dependency for correctness.
 * - Every operation is wrapped in try/catch so Redis failures never crash requests.
 * - Malformed cached JSON is treated as a cache miss.
 * - All keys use deterministic, scoped naming.
 */
export const cache = {
  /**
   * Get a cached value. Returns null on miss, Redis error, or malformed JSON.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await redis.get(key);
      if (raw === null) {
        log.debug({ key }, 'cache miss');
        return null;
      }

      try {
        const parsed = JSON.parse(raw) as T;
        log.debug({ key }, 'cache hit');
        return parsed;
      } catch {
        // Malformed JSON — treat as miss, delete the bad entry
        log.warn({ key }, 'cache malformed JSON, treating as miss');
        redis.del(key).catch(() => {}); // fire-and-forget cleanup
        return null;
      }
    } catch (err) {
      log.warn({ err, key }, 'cache get failed, falling back to database');
      return null;
    }
  },

  /**
   * Set a value in the cache with a TTL in seconds.
   * Failures are logged but never thrown.
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await redis.set(key, serialized, 'EX', ttlSeconds);
      log.debug({ key, ttl: ttlSeconds }, 'cache set');
    } catch (err) {
      log.warn({ err, key }, 'cache set failed');
    }
  },

  /**
   * Delete one or more deterministic cache keys.
   * Failures are logged but never thrown.
   */
  async delete(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await redis.del(...keys);
      log.debug({ keys }, 'cache invalidated');
    } catch (err) {
      log.warn({ err, keys }, 'cache delete failed');
    }
  },
};

// ─── Cache Key Builders ──────────────────────────────

export const cacheKeys = {
  userOrgs: (userId: string) => `user:${userId}:orgs`,
  orgMembers: (orgId: string) => `org:${orgId}:members`,
  projectTaskStats: (projectId: string) => `project:${projectId}:task-stats`,
  userUnreadCount: (userId: string) => `user:${userId}:unread-count`,
};

// ─── TTL Constants (seconds) ─────────────────────────

export const cacheTTL = {
  USER_ORGS: 300,         // 5 minutes
  ORG_MEMBERS: 300,       // 5 minutes
  TASK_STATS: 120,        // 2 minutes
  UNREAD_COUNT: 60,       // 1 minute
};

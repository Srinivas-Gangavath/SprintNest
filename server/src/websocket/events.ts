/**
 * Socket.IO contract for Phase 11.
 *
 * REST stays authoritative: every event below is emitted *after* a database
 * mutation has committed. Clients treat these as synchronization signals and
 * refetch through the normal API, so a missed event is never fatal.
 */

// ─── Rooms ──────────────────────────────────────────────

/** Personal room — notification delivery and membership changes for one user. */
export const userRoom = (userId: string): string => `user:${userId}`;

/** Project room — task and comment activity for everyone viewing a project. */
export const projectRoom = (projectId: string): string => `project:${projectId}`;

// ─── Handshake rejection reasons ────────────────────────

/**
 * Sent as the `connect_error` message. The client uses `TOKEN_EXPIRED` and
 * `UNAUTHENTICATED` to decide whether to attempt a REST token refresh.
 */
export const SOCKET_AUTH_ERRORS = {
  /** No access_token cookie on the handshake (missing or browser-expired). */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** Cookie present but the JWT is past its expiry. */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  /** Cookie present but the JWT is malformed or has a bad signature. */
  INVALID_TOKEN: 'INVALID_TOKEN',
} as const;

// ─── Server → client events ─────────────────────────────

export interface TaskEventPayload {
  orgId: string;
  projectId: string;
  task: Record<string, unknown>;
}

export interface TaskDeletedPayload {
  orgId: string;
  projectId: string;
  taskId: string;
}

export interface CommentEventPayload {
  orgId: string;
  projectId: string;
  taskId: string;
  comment: Record<string, unknown>;
}

export interface CommentDeletedPayload {
  orgId: string;
  projectId: string;
  taskId: string;
  commentId: string;
}

export interface NotificationEventPayload {
  notification: Record<string, unknown>;
}

export interface MemberAddedPayload {
  orgId: string;
  userId: string;
  role: string;
}

export interface MemberRemovedPayload {
  orgId: string;
  memberId: string;
  userId: string;
}

export interface ServerToClientEvents {
  'task:created': (payload: TaskEventPayload) => void;
  'task:updated': (payload: TaskEventPayload) => void;
  'task:deleted': (payload: TaskDeletedPayload) => void;
  'comment:created': (payload: CommentEventPayload) => void;
  'comment:updated': (payload: CommentEventPayload) => void;
  'comment:deleted': (payload: CommentDeletedPayload) => void;
  'notification:new': (payload: NotificationEventPayload) => void;
  'member:added': (payload: MemberAddedPayload) => void;
  'member:removed': (payload: MemberRemovedPayload) => void;
}

// ─── Client → server events ─────────────────────────────

/** Result of a room subscription request. */
export type RoomAck = { ok: true } | { ok: false; error: string };

export interface ClientToServerEvents {
  'join:project': (projectId: string, ack?: (result: RoomAck) => void) => void;
  'leave:project': (projectId: string, ack?: (result: RoomAck) => void) => void;
}

/** Authenticated context attached to every socket by the handshake middleware. */
export interface SocketData {
  userId: string;
  email: string;
}

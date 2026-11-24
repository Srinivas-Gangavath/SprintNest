import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { prisma } from '../config/database.js';
import { logger } from '../logger.js';
import { projectRoom, userRoom } from './events.js';
import type {
  ClientToServerEvents,
  CommentDeletedPayload,
  CommentEventPayload,
  MemberAddedPayload,
  MemberRemovedPayload,
  NotificationEventPayload,
  ServerToClientEvents,
  SocketData,
  TaskDeletedPayload,
  TaskEventPayload,
} from './events.js';
import { authenticateSocket } from './middleware.js';
import { registerProjectHandlers } from './handlers/project.handlers.js';

export type { RoomAck } from './events.js';

/** Inter-server events are unused: single process, in-memory rooms, no adapter. */
type InterServerEvents = Record<string, never>;

export type AppServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

let io: AppServer | null = null;

/**
 * Attaches Socket.IO to the existing Express HTTP server.
 *
 * Rooms live in this process's memory. There is deliberately no Redis adapter:
 * the MVP runs as a single Render Free web service, and Redis stays dedicated
 * to application caching and BullMQ.
 */
export function initializeSocketIO(httpServer: HttpServer): AppServer {
  const server: AppServer = new SocketIOServer(httpServer, {
    path: '/socket.io',
  });

  server.use(authenticateSocket);

  server.on('connection', (socket) => {
    const { userId } = socket.data;

    // Personal room for notifications and membership changes. The room name is
    // derived from the verified JWT, so a client cannot subscribe to another user.
    socket.join(userRoom(userId));

    registerProjectHandlers(socket);

    logger.debug({ socketId: socket.id, userId }, 'Socket connected');

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, userId, reason }, 'Socket disconnected');
    });
  });

  io = server;
  logger.info('Socket.IO initialized (in-memory rooms, no Redis adapter)');
  return server;
}

/** Closes all connections and stops accepting new ones during shutdown. */
export async function closeSocketIO(): Promise<void> {
  if (!io) return;
  const server = io;
  io = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  logger.info('Socket.IO closed');
}

// ─── Emit helpers ───────────────────────────────────────
//
// Every helper is a no-op when Socket.IO has not been initialized (for example
// unit tests that exercise services directly). Real-time delivery is best-effort
// on top of REST, so a missing server must never break a mutation.

type EventName = keyof ServerToClientEvents;

/** Emits through the loosely-typed signature; the exported wrappers below are typed. */
function emitToRoom(room: string, event: EventName, payload: unknown): void {
  if (!io) return;
  // Cast the operator, not the method — `emit` must stay bound to it.
  (io.to(room) as unknown as { emit: (e: string, p: unknown) => void }).emit(event, payload);
}

function emitToProject(projectId: string, event: EventName, payload: unknown): void {
  emitToRoom(projectRoom(projectId), event, payload);
}

function emitToUser(userId: string, event: EventName, payload: unknown): void {
  emitToRoom(userRoom(userId), event, payload);
}

// ─── Task events ────────────────────────────────────────

export function emitTaskCreated(payload: TaskEventPayload): void {
  emitToProject(payload.projectId, 'task:created', payload);
}

export function emitTaskUpdated(payload: TaskEventPayload): void {
  emitToProject(payload.projectId, 'task:updated', payload);
}

export function emitTaskDeleted(payload: TaskDeletedPayload): void {
  emitToProject(payload.projectId, 'task:deleted', payload);
}

// ─── Comment events ─────────────────────────────────────

export function emitCommentCreated(payload: CommentEventPayload): void {
  emitToProject(payload.projectId, 'comment:created', payload);
}

export function emitCommentUpdated(payload: CommentEventPayload): void {
  emitToProject(payload.projectId, 'comment:updated', payload);
}

export function emitCommentDeleted(payload: CommentDeletedPayload): void {
  emitToProject(payload.projectId, 'comment:deleted', payload);
}

// ─── Notification events ────────────────────────────────

/** Delivers a already-persisted notification to its owner's personal room. */
export function emitNotificationNew(
  recipientUserId: string,
  payload: NotificationEventPayload,
): void {
  emitToUser(recipientUserId, 'notification:new', payload);
}

// ─── Membership events ──────────────────────────────────

/**
 * Fans a membership change out to the organization's current active members.
 *
 * Recipients are resolved from `org_members` at emit time and addressed through
 * their personal rooms. That keeps membership events inside the organization
 * without a separate org-room lifecycle to keep in sync.
 */
async function emitToOrgMembers(
  orgId: string,
  event: EventName,
  payload: unknown,
  alsoNotifyUserId?: string,
): Promise<void> {
  if (!io) return;

  const recipients = new Set<string>();

  try {
    const members = await prisma.orgMember.findMany({
      where: { orgId },
      select: { userId: true },
    });
    for (const member of members) recipients.add(member.userId);
  } catch (err) {
    logger.error({ err, orgId, event }, 'Failed to resolve membership event recipients');
    return;
  }

  // A removed member is no longer in org_members but still needs the event.
  if (alsoNotifyUserId) recipients.add(alsoNotifyUserId);

  for (const recipientId of recipients) {
    emitToUser(recipientId, event, payload);
  }

  logger.debug({ orgId, event, recipientCount: recipients.size }, 'Membership event emitted');
}

export async function emitMemberAdded(payload: MemberAddedPayload): Promise<void> {
  await emitToOrgMembers(payload.orgId, 'member:added', payload);
}

export async function emitMemberRemoved(payload: MemberRemovedPayload): Promise<void> {
  await emitToOrgMembers(payload.orgId, 'member:removed', payload, payload.userId);
  await revokeProjectRooms(payload.userId, payload.orgId);
}

/**
 * Evicts a user's sockets from every project room belonging to an organization.
 *
 * Room membership was authorized when the socket joined, so a member removed
 * mid-session would keep receiving that organization's task and comment events
 * until they happened to reconnect.
 */
async function revokeProjectRooms(userId: string, orgId: string): Promise<void> {
  if (!io) return;

  try {
    const projects = await prisma.project.findMany({
      where: { orgId },
      select: { id: true },
    });

    for (const project of projects) {
      io.in(userRoom(userId)).socketsLeave(projectRoom(project.id));
    }
  } catch (err) {
    logger.error({ err, userId, orgId }, 'Failed to revoke project rooms after member removal');
  }
}

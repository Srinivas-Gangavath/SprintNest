import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { logger } from '../../logger.js';
import { projectRoom } from '../events.js';
import type { AppSocket, RoomAck } from '../socket.js';

const projectIdSchema = z.string().uuid();

/**
 * Resolves a project the socket's user is allowed to observe.
 *
 * Authorization chain: project → organization (not soft-deleted) → active
 * membership for the authenticated user. Knowing a project UUID is never
 * sufficient, so a client cannot subscribe to another organization's project.
 */
async function authorizeProjectAccess(
  userId: string,
  projectId: string,
): Promise<{ orgId: string } | null> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      organization: { deletedAt: null },
    },
    select: { orgId: true },
  });

  if (!project) return null;

  const membership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId: project.orgId, userId } },
    select: { role: true },
  });

  if (!membership) return null;

  return { orgId: project.orgId };
}

/** Registers the `join:project` / `leave:project` room subscription handlers. */
export function registerProjectHandlers(socket: AppSocket): void {
  const { userId } = socket.data;

  socket.on('join:project', (projectId, ack) => {
    const respond = (result: RoomAck) => ack?.(result);

    const parsed = projectIdSchema.safeParse(projectId);
    if (!parsed.success) {
      respond({ ok: false, error: 'INVALID_PROJECT_ID' });
      return;
    }

    authorizeProjectAccess(userId, parsed.data)
      .then((project) => {
        if (!project) {
          logger.warn(
            { socketId: socket.id, userId, projectId: parsed.data },
            'Socket project room join denied',
          );
          respond({ ok: false, error: 'PROJECT_ACCESS_DENIED' });
          return;
        }

        socket.join(projectRoom(parsed.data));
        logger.debug(
          { socketId: socket.id, userId, projectId: parsed.data, orgId: project.orgId },
          'Socket joined project room',
        );
        respond({ ok: true });
      })
      .catch((err) => {
        logger.error(
          { err, socketId: socket.id, userId, projectId: parsed.data },
          'Socket project room join failed',
        );
        respond({ ok: false, error: 'PROJECT_JOIN_FAILED' });
      });
  });

  // Leaving needs no authorization or database lookup — a socket can only ever
  // remove itself from a room.
  socket.on('leave:project', (projectId, ack) => {
    const parsed = projectIdSchema.safeParse(projectId);
    if (!parsed.success) {
      ack?.({ ok: false, error: 'INVALID_PROJECT_ID' });
      return;
    }

    socket.leave(projectRoom(parsed.data));
    logger.debug(
      { socketId: socket.id, userId, projectId: parsed.data },
      'Socket left project room',
    );
    ack?.({ ok: true });
  });
}

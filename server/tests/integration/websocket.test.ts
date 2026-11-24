import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import app from '../../src/app.js';
import { cleanDatabase, testPrisma } from '../helpers/db.js';
import { closeSocketIO, initializeSocketIO, type AppServer } from '../../src/websocket/socket.js';
import { generateAccessToken } from '../../src/modules/auth/auth.service.js';
import { ACCESS_TOKEN_COOKIE } from '../../src/shared/constants.js';
import { config } from '../../src/config/index.js';
import { createTask, updateTask, deleteTask } from '../../src/modules/tasks/tasks.service.js';
import {
  createComment,
  updateComment,
  deleteComment,
} from '../../src/modules/comments/comments.service.js';
import { acceptInvitation, removeMember } from '../../src/modules/members/members.service.js';
import { createNotificationWorker } from '../../src/jobs/workers/notification.worker.js';
import { notificationQueue } from '../../src/jobs/queues.js';
import { hashToken } from '../../src/shared/utils/hash.js';

// ─── Test harness ────────────────────────────────────────

let httpServer: HttpServer;
let socketServer: AppServer;
let port: number;

/** Sockets opened by the current test, torn down in afterEach. */
const openSockets: ClientSocket[] = [];

function connectClient(token?: string): ClientSocket {
  const socket = ioClient(`http://localhost:${port}`, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: token ? { Cookie: `${ACCESS_TOKEN_COOKIE}=${token}` } : {},
  });
  openSockets.push(socket);
  return socket;
}

/** Resolves once the socket connects; rejects with the handshake error message. */
function waitForConnect(socket: ClientSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Resolves with the first payload received for `event`. */
function waitForEvent<T = any>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Collects every payload received for `event` until explicitly read. */
function collectEvent(socket: ClientSocket, event: string): { received: any[] } {
  const bucket: { received: any[] } = { received: [] };
  socket.on(event, (payload: any) => bucket.received.push(payload));
  return bucket;
}

function joinProject(socket: ClientSocket, projectId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('join:project ack timeout')), 5000);
    socket.emit('join:project', projectId, (result: any) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function leaveProject(socket: ClientSocket, projectId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('leave:project ack timeout')), 5000);
    socket.emit('leave:project', projectId, (result: any) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

/** Gives the server a moment to finish broadcasting before asserting absence. */
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

// ─── Fixture builders ────────────────────────────────────

let userSeq = 0;

async function makeUser(displayName: string) {
  userSeq += 1;
  const user = await testPrisma.user.create({
    data: {
      email: `ws-user-${userSeq}@test.com`,
      passwordHash: 'hash',
      displayName,
    },
  });
  return { ...user, token: generateAccessToken(user) };
}

let orgSeq = 0;

async function makeOrgWithProject(owner: { id: string }, name: string) {
  orgSeq += 1;
  const org = await testPrisma.organization.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${orgSeq}`,
      ownerId: owner.id,
    },
  });
  await testPrisma.orgMember.create({
    data: { orgId: org.id, userId: owner.id, role: 'OWNER' },
  });
  const project = await testPrisma.project.create({
    data: {
      name: `${name} Project`,
      organization: { connect: { id: org.id } },
      createdBy: { connect: { id: owner.id } },
    },
  });
  return { org, project };
}

async function addMember(orgId: string, userId: string, role: 'ADMIN' | 'MEMBER' = 'MEMBER') {
  return testPrisma.orgMember.create({ data: { orgId, userId, role } });
}

// ─── Lifecycle ───────────────────────────────────────────

beforeAll(async () => {
  httpServer = createServer(app);
  socketServer = initializeSocketIO(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await closeSocketIO();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  try {
    await notificationQueue.close();
  } catch {
    /* queue may already be closed */
  }
});

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(async () => {
  for (const socket of openSockets) socket.disconnect();
  openSockets.length = 0;
  await settle(50);
});

// ─── 1. Handshake authentication ─────────────────────────

describe('Phase 11 — Socket authentication', () => {
  it('accepts a connection carrying a valid access token cookie', async () => {
    const user = await makeUser('Valid User');
    const socket = connectClient(user.token);

    await expect(waitForConnect(socket)).resolves.toBeUndefined();
    expect(socket.connected).toBe(true);
  });

  it('rejects a connection with no access token cookie', async () => {
    const socket = connectClient();

    await expect(waitForConnect(socket)).rejects.toThrow('UNAUTHENTICATED');
    expect(socket.connected).toBe(false);
  });

  it('rejects a malformed / wrongly-signed token', async () => {
    const forged = jwt.sign({ sub: 'attacker', email: 'a@b.c' }, 'wrong-signing-secret');
    const socket = connectClient(forged);

    await expect(waitForConnect(socket)).rejects.toThrow('INVALID_TOKEN');
  });

  it('rejects an expired token with a distinguishable reason', async () => {
    const user = await makeUser('Expired User');
    const expired = jwt.sign({ sub: user.id, email: user.email }, config.JWT_SECRET, {
      expiresIn: '-10s',
    });
    const socket = connectClient(expired);

    await expect(waitForConnect(socket)).rejects.toThrow('TOKEN_EXPIRED');
  });

  it('derives identity from the JWT, ignoring any client-supplied user id', async () => {
    const victim = await makeUser('Victim');
    const attacker = await makeUser('Attacker');

    const socket = connectClient(attacker.token);
    await waitForConnect(socket);

    // The attacker is only ever in their own personal room.
    const attackerRoom = socketServer.sockets.adapter.rooms.get(`user:${attacker.id}`);
    const victimRoom = socketServer.sockets.adapter.rooms.get(`user:${victim.id}`);
    expect(attackerRoom?.has(socket.id!)).toBe(true);
    expect(victimRoom).toBeUndefined();
  });
});

// ─── 2. User rooms ───────────────────────────────────────

describe('Phase 11 — User rooms', () => {
  it('joins only the authenticated user\'s own room', async () => {
    const user = await makeUser('Room Owner');
    const socket = connectClient(user.token);
    await waitForConnect(socket);

    const rooms = socketServer.sockets.sockets.get(socket.id!)?.rooms;
    // A socket is always in its own id-room, plus exactly one user room.
    expect(rooms?.has(`user:${user.id}`)).toBe(true);
    const userRooms = [...(rooms ?? [])].filter((r) => r.startsWith('user:'));
    expect(userRooms).toEqual([`user:${user.id}`]);
  });

  it('does not deliver another user\'s personal notification', async () => {
    const [alice, bob] = [await makeUser('Alice'), await makeUser('Bob')];

    const aliceSocket = connectClient(alice.token);
    const bobSocket = connectClient(bob.token);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);

    const bobEvents = collectEvent(bobSocket, 'notification:new');
    const aliceReceived = waitForEvent(aliceSocket, 'notification:new');

    socketServer.to(`user:${alice.id}`).emit('notification:new', {
      notification: { id: 'n1', title: 'For Alice only' },
    } as any);

    await expect(aliceReceived).resolves.toMatchObject({
      notification: { title: 'For Alice only' },
    });
    await settle();
    expect(bobEvents.received).toHaveLength(0);
  });
});

// ─── 3. Project rooms ────────────────────────────────────

describe('Phase 11 — Project room authorization', () => {
  it('lets an active org member join their project room', async () => {
    const owner = await makeUser('Project Owner');
    const { project } = await makeOrgWithProject(owner, 'Acme');

    const socket = connectClient(owner.token);
    await waitForConnect(socket);

    await expect(joinProject(socket, project.id)).resolves.toEqual({ ok: true });
    expect(
      socketServer.sockets.adapter.rooms.get(`project:${project.id}`)?.has(socket.id!),
    ).toBe(true);
  });

  it('refuses a user from another organization who knows the project UUID', async () => {
    const owner = await makeUser('Insider');
    const outsider = await makeUser('Outsider');
    const { project } = await makeOrgWithProject(owner, 'Inside Org');
    await makeOrgWithProject(outsider, 'Outside Org');

    const socket = connectClient(outsider.token);
    await waitForConnect(socket);

    await expect(joinProject(socket, project.id)).resolves.toEqual({
      ok: false,
      error: 'PROJECT_ACCESS_DENIED',
    });
    expect(socketServer.sockets.adapter.rooms.get(`project:${project.id}`)).toBeUndefined();
  });

  it('refuses a project that does not exist', async () => {
    const user = await makeUser('Explorer');
    const socket = connectClient(user.token);
    await waitForConnect(socket);

    await expect(
      joinProject(socket, '11111111-2222-3333-4444-555555555555'),
    ).resolves.toEqual({ ok: false, error: 'PROJECT_ACCESS_DENIED' });
  });

  it('refuses a malformed project id without hitting the database', async () => {
    const user = await makeUser('Fuzzer');
    const socket = connectClient(user.token);
    await waitForConnect(socket);

    await expect(joinProject(socket, 'not-a-uuid')).resolves.toEqual({
      ok: false,
      error: 'INVALID_PROJECT_ID',
    });
  });

  it('refuses a project in a soft-deleted organization', async () => {
    const owner = await makeUser('Deleted Org Owner');
    const { org, project } = await makeOrgWithProject(owner, 'Gone Org');
    await testPrisma.organization.update({
      where: { id: org.id },
      data: { deletedAt: new Date() },
    });

    const socket = connectClient(owner.token);
    await waitForConnect(socket);

    await expect(joinProject(socket, project.id)).resolves.toEqual({
      ok: false,
      error: 'PROJECT_ACCESS_DENIED',
    });
  });

  it('removes the socket from the room on leave:project', async () => {
    const owner = await makeUser('Leaver');
    const { project } = await makeOrgWithProject(owner, 'Leave Org');

    const socket = connectClient(owner.token);
    await waitForConnect(socket);
    await joinProject(socket, project.id);

    await expect(leaveProject(socket, project.id)).resolves.toEqual({ ok: true });
    expect(socketServer.sockets.adapter.rooms.get(`project:${project.id}`)).toBeUndefined();
  });
});

// ─── 4. Task events ──────────────────────────────────────

describe('Phase 11 — Task events', () => {
  it('emits task:created, task:updated and task:deleted to the project room', async () => {
    const owner = await makeUser('Task Owner');
    const { org, project } = await makeOrgWithProject(owner, 'Task Org');

    const socket = connectClient(owner.token);
    await waitForConnect(socket);
    await joinProject(socket, project.id);

    // Created
    const createdPromise = waitForEvent(socket, 'task:created');
    const task = await createTask(org.id, project.id, owner.id, { title: 'Ship Phase 11' });
    const created = await createdPromise;

    expect(created).toMatchObject({ orgId: org.id, projectId: project.id });
    expect(created.task).toMatchObject({ id: task.id, title: 'Ship Phase 11' });

    // Updated
    const updatedPromise = waitForEvent(socket, 'task:updated');
    await updateTask(org.id, project.id, task.id, owner.id, { status: 'IN_PROGRESS' });
    const updated = await updatedPromise;

    expect(updated.task).toMatchObject({ id: task.id, status: 'IN_PROGRESS' });

    // Deleted
    const deletedPromise = waitForEvent(socket, 'task:deleted');
    await deleteTask(org.id, project.id, task.id, owner.id);

    await expect(deletedPromise).resolves.toMatchObject({
      orgId: org.id,
      projectId: project.id,
      taskId: task.id,
    });
  });

  it('does not emit when the mutation fails', async () => {
    const owner = await makeUser('Failing Actor');
    const stranger = await makeUser('Non Member');
    const { org, project } = await makeOrgWithProject(owner, 'Fail Org');

    const socket = connectClient(owner.token);
    await waitForConnect(socket);
    await joinProject(socket, project.id);

    const events = collectEvent(socket, 'task:created');

    // Assignee is not a member of the org → service rejects before committing.
    await expect(
      createTask(org.id, project.id, owner.id, { title: 'Bad assignee', assigneeId: stranger.id }),
    ).rejects.toThrow(/member of this organization/i);

    await settle();
    expect(events.received).toHaveLength(0);
  });

  it('does not leak task events to a project room the socket never joined', async () => {
    const owner = await makeUser('Org A Owner');
    const outsider = await makeUser('Org B Owner');
    const { org, project } = await makeOrgWithProject(owner, 'Org A');
    await makeOrgWithProject(outsider, 'Org B');

    const outsiderSocket = connectClient(outsider.token);
    await waitForConnect(outsiderSocket);
    await joinProject(outsiderSocket, project.id).catch(() => undefined);

    const events = collectEvent(outsiderSocket, 'task:created');
    await createTask(org.id, project.id, owner.id, { title: 'Private work' });

    await settle();
    expect(events.received).toHaveLength(0);
  });
});

// ─── 5. Comment events ───────────────────────────────────

describe('Phase 11 — Comment events', () => {
  it('emits comment:created, comment:updated and comment:deleted to the project room', async () => {
    const owner = await makeUser('Commenter');
    const { org, project } = await makeOrgWithProject(owner, 'Comment Org');
    const task = await createTask(org.id, project.id, owner.id, { title: 'Discuss me' });

    const socket = connectClient(owner.token);
    await waitForConnect(socket);
    await joinProject(socket, project.id);

    const createdPromise = waitForEvent(socket, 'comment:created');
    const comment = await createComment(org.id, project.id, task.id, owner.id, {
      body: 'First!',
    });
    const created = await createdPromise;

    expect(created).toMatchObject({ orgId: org.id, projectId: project.id, taskId: task.id });
    expect(created.comment).toMatchObject({ id: comment.id, body: 'First!' });

    const updatedPromise = waitForEvent(socket, 'comment:updated');
    await updateComment(org.id, project.id, task.id, comment.id, owner.id, 'OWNER', {
      body: 'Edited body',
    });
    await expect(updatedPromise).resolves.toMatchObject({
      taskId: task.id,
      comment: { id: comment.id, body: 'Edited body', isEdited: true },
    });

    const deletedPromise = waitForEvent(socket, 'comment:deleted');
    await deleteComment(org.id, project.id, task.id, comment.id, owner.id, 'OWNER');
    await expect(deletedPromise).resolves.toMatchObject({
      taskId: task.id,
      commentId: comment.id,
    });
  });

  it('does not emit when an unauthorized edit is rejected', async () => {
    const owner = await makeUser('Comment Author');
    const member = await makeUser('Other Member');
    const { org, project } = await makeOrgWithProject(owner, 'Moderation Org');
    await addMember(org.id, member.id, 'MEMBER');

    const task = await createTask(org.id, project.id, owner.id, { title: 'Guarded' });
    const comment = await createComment(org.id, project.id, task.id, owner.id, {
      body: 'Mine',
    });

    const socket = connectClient(owner.token);
    await waitForConnect(socket);
    await joinProject(socket, project.id);

    const events = collectEvent(socket, 'comment:updated');

    await expect(
      updateComment(org.id, project.id, task.id, comment.id, member.id, 'MEMBER', {
        body: 'Hijacked',
      }),
    ).rejects.toThrow(/only edit your own comments/i);

    await settle();
    expect(events.received).toHaveLength(0);
  });
});

// ─── 6. Notification events ──────────────────────────────

describe('Phase 11 — Notification delivery', () => {
  let worker: ReturnType<typeof createNotificationWorker>;

  beforeEach(async () => {
    try {
      await notificationQueue.drain();
    } catch {
      /* empty queue */
    }
    worker = createNotificationWorker();
  });

  afterEach(async () => {
    await worker.close();
  });

  it('emits notification:new to the recipient only, after the record is persisted', async () => {
    const recipient = await makeUser('Recipient');
    const bystander = await makeUser('Bystander');

    const recipientSocket = connectClient(recipient.token);
    const bystanderSocket = connectClient(bystander.token);
    await Promise.all([waitForConnect(recipientSocket), waitForConnect(bystanderSocket)]);

    const bystanderEvents = collectEvent(bystanderSocket, 'notification:new');
    const delivered = waitForEvent(recipientSocket, 'notification:new', 10000);

    await notificationQueue.add('fan-out-notification', {
      type: 'task_assigned',
      recipientId: recipient.id,
      title: 'You were assigned to "Realtime work"',
      data: { taskId: 'task-1', taskTitle: 'Realtime work' },
    });

    const payload = await delivered;
    expect(payload.notification).toMatchObject({
      userId: recipient.id,
      type: 'task_assigned',
      title: 'You were assigned to "Realtime work"',
      isRead: false,
    });

    // The emitted notification must already exist in PostgreSQL.
    const stored = await testPrisma.notification.findUnique({
      where: { id: payload.notification.id },
    });
    expect(stored).not.toBeNull();

    await settle();
    expect(bystanderEvents.received).toHaveLength(0);
  });
});

// ─── 7. Membership events ────────────────────────────────

describe('Phase 11 — Membership events', () => {
  it('emits member:added to existing org members when an invitation is accepted', async () => {
    const owner = await makeUser('Org Owner');
    const invitee = await makeUser('Invitee');
    const { org } = await makeOrgWithProject(owner, 'Growing Org');

    const rawToken = 'invitation-raw-token-for-member-added';
    await testPrisma.orgInvitation.create({
      data: {
        orgId: org.id,
        email: invitee.email,
        role: 'MEMBER',
        invitedById: owner.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const ownerSocket = connectClient(owner.token);
    await waitForConnect(ownerSocket);

    const added = waitForEvent(ownerSocket, 'member:added');
    await acceptInvitation(rawToken, invitee.id, invitee.email);

    await expect(added).resolves.toMatchObject({
      orgId: org.id,
      userId: invitee.id,
      role: 'MEMBER',
    });
  });

  it('emits member:removed to remaining members and to the removed user', async () => {
    const owner = await makeUser('Remover');
    const target = await makeUser('Removed Member');
    const { org } = await makeOrgWithProject(owner, 'Shrinking Org');
    const membership = await addMember(org.id, target.id, 'MEMBER');

    const ownerSocket = connectClient(owner.token);
    const targetSocket = connectClient(target.token);
    await Promise.all([waitForConnect(ownerSocket), waitForConnect(targetSocket)]);

    const ownerGot = waitForEvent(ownerSocket, 'member:removed');
    const targetGot = waitForEvent(targetSocket, 'member:removed');

    await removeMember(org.id, membership.id, owner.id, 'OWNER');

    await expect(ownerGot).resolves.toMatchObject({ orgId: org.id, userId: target.id });
    await expect(targetGot).resolves.toMatchObject({ orgId: org.id, userId: target.id });
  });

  it('does not leak membership events to an unrelated organization', async () => {
    const owner = await makeUser('Org One Owner');
    const invitee = await makeUser('Org One Invitee');
    const stranger = await makeUser('Org Two Owner');
    const { org } = await makeOrgWithProject(owner, 'Org One');
    await makeOrgWithProject(stranger, 'Org Two');

    const rawToken = 'invitation-raw-token-no-leak';
    await testPrisma.orgInvitation.create({
      data: {
        orgId: org.id,
        email: invitee.email,
        role: 'MEMBER',
        invitedById: owner.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const strangerSocket = connectClient(stranger.token);
    await waitForConnect(strangerSocket);
    const strangerEvents = collectEvent(strangerSocket, 'member:added');

    await acceptInvitation(rawToken, invitee.id, invitee.email);

    await settle();
    expect(strangerEvents.received).toHaveLength(0);
  });

  it('evicts a removed member from the org\'s project rooms', async () => {
    const owner = await makeUser('Eviction Owner');
    const target = await makeUser('Evicted Member');
    const { org, project } = await makeOrgWithProject(owner, 'Eviction Org');
    const membership = await addMember(org.id, target.id, 'MEMBER');

    const targetSocket = connectClient(target.token);
    await waitForConnect(targetSocket);
    await expect(joinProject(targetSocket, project.id)).resolves.toEqual({ ok: true });

    await removeMember(org.id, membership.id, owner.id, 'OWNER');
    await settle();

    expect(
      socketServer.sockets.adapter.rooms.get(`project:${project.id}`)?.has(targetSocket.id!),
    ).not.toBe(true);

    // And they no longer receive that project's task events.
    const events = collectEvent(targetSocket, 'task:created');
    await createTask(org.id, project.id, owner.id, { title: 'After removal' });
    await settle();
    expect(events.received).toHaveLength(0);
  });
});

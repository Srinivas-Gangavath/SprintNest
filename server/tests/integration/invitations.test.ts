import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import app from '../../src/app.js';
import { createTestAgent, withCsrf, registerUser } from '../helpers/request.js';
import { cleanDatabase, testPrisma } from '../helpers/db.js';
import { emailQueue } from '../../src/jobs/queues.js';
import { generateToken, hashToken } from '../../src/shared/utils/hash.js';
import { envSchema } from '../../src/config/index.js';
import { createEmailProvider } from '../../src/email/index.js';
import { ConsoleEmailProvider } from '../../src/email/console.provider.js';

/**
 * Phase 12 — invitation acceptance link (`/invitations/:token/accept`) and
 * production email configuration.
 *
 * The frontend route posts to the pre-existing acceptance endpoint, so these
 * tests exercise that endpoint's contract plus the SPA/API boundary the link
 * depends on in production.
 */

const owner = { email: 'owner@test.com', password: 'Password123!', displayName: 'Owner' };
const invitee = { email: 'invitee@test.com', password: 'Password123!', displayName: 'Invitee' };
const stranger = { email: 'stranger@test.com', password: 'Password123!', displayName: 'Stranger' };

/** Creates an invitation row directly and hands back the raw (emailed) token. */
async function seedInvitation(opts: {
  orgId: string;
  invitedById: string;
  email: string;
  role?: 'ADMIN' | 'MEMBER';
  status?: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  expiresAt?: Date;
}) {
  const rawToken = generateToken(32);
  const invitation = await testPrisma.orgInvitation.create({
    data: {
      orgId: opts.orgId,
      email: opts.email.toLowerCase(),
      role: opts.role ?? 'MEMBER',
      status: opts.status ?? 'PENDING',
      invitedById: opts.invitedById,
      tokenHash: hashToken(rawToken),
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  return { rawToken, invitation };
}

/** Owner + organization fixture. */
async function seedOrg(name = 'Acme') {
  const agent = createTestAgent();
  const reg = await registerUser(agent, owner);
  const res = await withCsrf(agent.post('/api/v1/orgs').send({ name }));
  return {
    agent,
    ownerId: reg.body.data.user.id as string,
    orgId: res.body.data.organization.id as string,
    orgName: res.body.data.organization.name as string,
  };
}

describe('Invitation acceptance link', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  // ─── Happy path ───────────────────────────────────

  it('accepts a valid invitation and returns the joined organization', async () => {
    const org = await seedOrg('Acme Inc');
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });

    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const res = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe('Invitation accepted');
    // The client needs this to drop the user into the right workspace.
    expect(res.body.data.organization).toMatchObject({
      id: org.orgId,
      name: 'Acme Inc',
      role: 'MEMBER',
    });
    expect(res.body.data.organization.slug).toBeDefined();

    const membership = await testPrisma.orgMember.findFirst({
      where: { orgId: org.orgId, user: { email: invitee.email } },
    });
    expect(membership?.role).toBe('MEMBER');

    const stored = await testPrisma.orgInvitation.findFirst({ where: { orgId: org.orgId } });
    expect(stored?.status).toBe('ACCEPTED');
  });

  it('records a member.joined activity log in the accepting transaction', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });
    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));

    const logs = await testPrisma.activityLog.findMany({
      where: { orgId: org.orgId, action: 'member.joined' },
    });
    expect(logs).toHaveLength(1);
  });

  it('grants the invited ADMIN role', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
      role: 'ADMIN',
    });
    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const res = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));
    expect(res.body.data.organization.role).toBe('ADMIN');
  });

  // ─── Rejected invitations ─────────────────────────

  it('rejects an unknown token with 400', async () => {
    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const res = await withCsrf(
      inviteeAgent.post(`/api/v1/invitations/${generateToken(32)}/accept`),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid or already used invitation');
  });

  it('rejects an expired invitation and marks it EXPIRED', async () => {
    const org = await seedOrg();
    const { rawToken, invitation } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const res = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This invitation has expired');

    const stored = await testPrisma.orgInvitation.findUnique({ where: { id: invitation.id } });
    expect(stored?.status).toBe('EXPIRED');
    const membership = await testPrisma.orgMember.findFirst({
      where: { orgId: org.orgId, user: { email: invitee.email } },
    });
    expect(membership).toBeNull();
  });

  it('rejects a declined (cancelled) invitation', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
      status: 'DECLINED',
    });
    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const res = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid or already used invitation');
  });

  it('rejects an already-accepted invitation on a second click of the same link', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });
    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const first = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));
    expect(first.status).toBe(200);

    // Second click of the same emailed link: already a member of that workspace.
    const second = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));
    expect(second.status).toBe(409);
    expect(second.body.message).toBe('You are already a member of this organization');

    const memberships = await testPrisma.orgMember.findMany({
      where: { orgId: org.orgId, user: { email: invitee.email } },
    });
    expect(memberships).toHaveLength(1);
  });

  it('returns 409 when the user is already a member', async () => {
    const org = await seedOrg();
    const inviteeAgent = createTestAgent();
    const reg = await registerUser(inviteeAgent, invitee);

    await testPrisma.orgMember.create({
      data: { orgId: org.orgId, userId: reg.body.data.user.id, role: 'MEMBER' },
    });

    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });

    const res = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));
    expect(res.status).toBe(409);
  });

  it('rejects an invitation for a soft-deleted organization', async () => {
    const org = await seedOrg();
    await testPrisma.organization.update({
      where: { id: org.orgId },
      data: { deletedAt: new Date() },
    });
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });
    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const res = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));

    expect(res.status).toBe(400);
    const membership = await testPrisma.orgMember.findFirst({
      where: { orgId: org.orgId, user: { email: invitee.email } },
    });
    expect(membership).toBeNull();
  });

  // ─── Authorization ────────────────────────────────

  it('requires authentication, preserving the link for a post-login retry', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });

    const res = await withCsrf(
      createTestAgent().post(`/api/v1/invitations/${rawToken}/accept`),
    );

    expect(res.status).toBe(401);
    // The invitation must survive so the user can retry after signing in.
    const stored = await testPrisma.orgInvitation.findFirst({ where: { orgId: org.orgId } });
    expect(stored?.status).toBe('PENDING');
  });

  it('requires the CSRF header', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });
    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const res = await inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`);
    expect(res.status).toBe(403);
  });

  it('refuses acceptance by a different account than the invited email', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });

    const strangerAgent = createTestAgent();
    const reg = await registerUser(strangerAgent, stranger);

    const res = await withCsrf(strangerAgent.post(`/api/v1/invitations/${rawToken}/accept`));

    expect(res.status).toBe(403);
    const membership = await testPrisma.orgMember.findFirst({
      where: { orgId: org.orgId, userId: reg.body.data.user.id },
    });
    expect(membership).toBeNull();
  });

  it('grants membership only in the invitation\'s own organization', async () => {
    const orgA = await seedOrg('Org A');
    const orgB = await withCsrf(orgA.agent.post('/api/v1/orgs').send({ name: 'Org B' }));
    const orgBId = orgB.body.data.organization.id as string;

    const { rawToken } = await seedInvitation({
      orgId: orgA.orgId,
      invitedById: orgA.ownerId,
      email: invitee.email,
    });

    const inviteeAgent = createTestAgent();
    const reg = await registerUser(inviteeAgent, invitee);
    await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));

    const memberships = await testPrisma.orgMember.findMany({
      where: { userId: reg.body.data.user.id },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.orgId).toBe(orgA.orgId);

    // And the invitee still cannot reach Org B.
    const forbidden = await inviteeAgent.get(`/api/v1/orgs/${orgBId}`);
    expect(forbidden.status).toBe(403);
  });

  // ─── Token handling ───────────────────────────────

  it('never returns the token or its hash from any invitation response', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });
    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const pending = await inviteeAgent.get('/api/v1/invitations/pending');
    expect(pending.status).toBe(200);
    expect(pending.body.data.invitations).toHaveLength(1);
    expect(pending.body.data.invitations[0]).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(pending.body)).not.toContain(rawToken);
    expect(JSON.stringify(pending.body)).not.toContain(hashToken(rawToken));

    const accept = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));
    expect(JSON.stringify(accept.body)).not.toContain(rawToken);
    expect(JSON.stringify(accept.body)).not.toContain(hashToken(rawToken));
  });

  it('does not expose the token created by the invite endpoint', async () => {
    const org = await seedOrg();
    const res = await withCsrf(
      org.agent
        .post(`/api/v1/orgs/${org.orgId}/members/invitations`)
        .send({ email: invitee.email, role: 'MEMBER' }),
    );

    expect(res.status).toBe(201);
    expect(res.body.data.invitation).not.toHaveProperty('tokenHash');

    const stored = await testPrisma.orgInvitation.findFirst({ where: { orgId: org.orgId } });
    expect(stored?.tokenHash).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(stored?.tokenHash);
  });

  it('redacts the invitation token and session cookies from request logs', async () => {
    // The pino-http serializers are wrapped so the token segment of the URL and
    // the session cookies never reach the log stream.
    const { redactRequestForTest, redactResponseForTest } = await import('../../src/app.js');
    const redacted = redactRequestForTest({
      url: '/api/v1/invitations/super-secret-token/accept',
      headers: { cookie: 'access_token=jwt', authorization: 'Bearer jwt', host: 'x' },
    });

    expect(redacted.url).toBe('/api/v1/invitations/[redacted]/accept');
    expect(
      redactRequestForTest({ url: '/api/v1/invitations/super-secret-token/register' }).url,
    ).toBe('/api/v1/invitations/[redacted]/register');
    expect(redactRequestForTest({ url: '/api/v1/invitations/pending' }).url).toBe('/api/v1/invitations/pending');
    expect(
      redactRequestForTest({
        url: '/api/v1/auth/me',
        headers: { referer: 'http://localhost:5173/invitations/super-secret-token/accept' },
      }).headers?.referer,
    ).toBe('http://localhost:5173/invitations/[redacted]/accept');
    expect(redacted.headers).not.toHaveProperty('cookie');
    expect(redacted.headers).not.toHaveProperty('authorization');
    expect(redacted.headers).toHaveProperty('host');

    // The SPA route carries the token too.
    expect(
      redactRequestForTest({ url: '/invitations/super-secret-token/accept' }).url,
    ).toBe('/invitations/[redacted]/accept');
    // Non-token invitation paths stay readable.
    expect(
      redactRequestForTest({ url: '/reset-password?token=super-secret-reset' }).url,
    ).toBe('/reset-password?token=[redacted]');

    // Newly issued access/refresh JWTs travel back in Set-Cookie.
    const response = redactResponseForTest({
      headers: { 'set-cookie': ['access_token=jwt', 'refresh_token=raw'], 'content-type': 'json' },
    });
    expect(response.headers).not.toHaveProperty('set-cookie');
    expect(response.headers).toHaveProperty('content-type');
  });

  // ─── Existing behaviour preserved ─────────────────

  it('still supports declining an invitation', async () => {
    const org = await seedOrg();
    const { rawToken, invitation } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });
    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const res = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/decline`));
    expect(res.status).toBe(200);

    const stored = await testPrisma.orgInvitation.findUnique({ where: { id: invitation.id } });
    expect(stored?.status).toBe('DECLINED');
  });

  it('hides invitations belonging to a soft-deleted organization from the pending list', async () => {
    const org = await seedOrg();
    await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });
    await testPrisma.organization.update({
      where: { id: org.orgId },
      data: { deletedAt: new Date() },
    });

    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const pending = await inviteeAgent.get('/api/v1/invitations/pending');
    expect(pending.body.data.invitations).toHaveLength(0);
  });
});

describe('SPA / API boundary', () => {
  it('returns JSON (not index.html) for an unknown API route', async () => {
    const res = await supertest(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('API endpoint not found');
  });

  it('serves the SPA for a direct invitation accept URL', async () => {
    const res = await supertest(app).get(`/invitations/${generateToken(32)}/accept`);
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toMatch(/id="root"/);
  });

  it('keeps the emailed accept URL aligned with the client route', async () => {
    // The email worker builds `${APP_URL}/invitations/${rawToken}/accept`;
    // the React router registers `/invitations/:token/accept`.
    const { readFileSync } = await import('node:fs');
    const worker = readFileSync(
      new URL('../../src/jobs/workers/email.worker.ts', import.meta.url),
      'utf8',
    );
    expect(worker).toContain('${config.APP_URL}/invitations/${data.rawToken}/accept');

    const routes = readFileSync(new URL('../../../client/src/App.tsx', import.meta.url), 'utf8');
    expect(routes).toContain('path="/invitations/:token/accept"');

    const page = readFileSync(
      new URL('../../../client/src/pages/AcceptInvitationPage.tsx', import.meta.url),
      'utf8',
    );
    expect(page).toContain('/api/v1/invitations/${encodeURIComponent(token)}/accept');
    expect(page).toContain('/api/v1/invitations/${encodeURIComponent(token)}/register');
    expect(page).toContain('loginPathWithRedirect');
    expect(page).not.toContain('localStorage');
    expect(page).not.toContain('sessionStorage');
    expect(page).not.toMatch(/console\.(log|info|debug|error)\(/);
  });
});

describe('Invitation onboarding and organization pending invitations', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  const account = {
    displayName: 'New Invitee',
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  it('creates an account from the invitation and joins that organization once', async () => {
    const org = await seedOrg('Invited Workspace');
    const email = 'brand-new@test.com';
    const { rawToken, invitation } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email,
      role: 'ADMIN',
    });

    const agent = createTestAgent();
    const preview = await agent.get(`/api/v1/invitations/${rawToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.invitation).toMatchObject({
      email,
      role: 'ADMIN',
      status: 'PENDING',
      accountExists: false,
    });
    expect(preview.body.data.invitation).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(preview.body)).not.toContain(rawToken);
    expect(JSON.stringify(preview.body)).not.toContain(invitation.tokenHash);

    const res = await withCsrf(
      agent.post(`/api/v1/invitations/${rawToken}/register`).send(account),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.organization).toMatchObject({ id: org.orgId, role: 'ADMIN' });
    expect(JSON.stringify(res.body)).not.toContain(rawToken);
    expect(JSON.stringify(res.body)).not.toContain(invitation.tokenHash);
    expect(res.headers['set-cookie']?.join(';')).toMatch(/access_token=/);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);

    const memberships = await testPrisma.orgMember.findMany({
      where: { orgId: org.orgId, user: { email } },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe('ADMIN');

    const stored = await testPrisma.orgInvitation.findUnique({ where: { id: invitation.id } });
    expect(stored?.status).toBe('ACCEPTED');

    const again = await withCsrf(agent.post(`/api/v1/invitations/${rawToken}/register`).send(account));
    expect(again.status).toBe(400);
    expect(
      await testPrisma.orgMember.count({ where: { orgId: org.orgId, user: { email } } }),
    ).toBe(1);
  });

  it('rejects a registration that tries to change the invited email', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: 'locked@test.com',
    });

    const res = await withCsrf(
      createTestAgent().post(`/api/v1/invitations/${rawToken}/register`).send({
        ...account,
        email: 'attacker@test.com',
      }),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot be changed/i);
    expect(await testPrisma.user.findUnique({ where: { email: 'attacker@test.com' } })).toBeNull();
    expect(await testPrisma.user.findUnique({ where: { email: 'locked@test.com' } })).toBeNull();
    const stored = await testPrisma.orgInvitation.findFirst({ where: { orgId: org.orgId } });
    expect(stored?.status).toBe('PENDING');
    expect(await testPrisma.orgMember.count({ where: { orgId: org.orgId } })).toBe(1);
  });

  it('lets an existing invited account sign in and accept', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
      role: 'MEMBER',
    });

    const inviteeAgent = createTestAgent();
    await registerUser(inviteeAgent, invitee);

    const preview = await inviteeAgent.get(`/api/v1/invitations/${rawToken}`);
    expect(preview.body.data.invitation.accountExists).toBe(true);

    const res = await withCsrf(inviteeAgent.post(`/api/v1/invitations/${rawToken}/accept`));
    expect(res.status).toBe(200);
    expect(res.body.data.organization).toMatchObject({ id: org.orgId, role: 'MEMBER' });
  });

  it('still rejects a different signed-in account with 403', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: invitee.email,
    });
    const strangerAgent = createTestAgent();
    const reg = await registerUser(strangerAgent, stranger);

    const res = await withCsrf(strangerAgent.post(`/api/v1/invitations/${rawToken}/accept`));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/different email/i);
    expect(
      await testPrisma.orgMember.findFirst({ where: { userId: reg.body.data.user.id, orgId: org.orgId } }),
    ).toBeNull();
  });

  it('keeps expired, cancelled, and invalid invitations from creating an account', async () => {
    const org = await seedOrg();
    const expired = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: 'expired@test.com',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const expiredPreview = await createTestAgent().get(`/api/v1/invitations/${expired.rawToken}`);
    expect(expiredPreview.body.data.invitation.status).toBe('EXPIRED');
    const expiredReg = await withCsrf(
      createTestAgent().post(`/api/v1/invitations/${expired.rawToken}/register`).send(account),
    );
    expect(expiredReg.status).toBe(400);

    const cancelled = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: 'cancelled@test.com',
      status: 'DECLINED',
    });
    const cancelledPreview = await createTestAgent().get(`/api/v1/invitations/${cancelled.rawToken}`);
    expect(cancelledPreview.body.data.invitation.status).toBe('DECLINED');
    const cancelledReg = await withCsrf(
      createTestAgent().post(`/api/v1/invitations/${cancelled.rawToken}/register`).send(account),
    );
    expect(cancelledReg.status).toBe(400);

    const missing = generateToken(32);
    expect((await createTestAgent().get(`/api/v1/invitations/${missing}`)).status).toBe(400);
    expect(
      (await withCsrf(createTestAgent().post(`/api/v1/invitations/${missing}/register`).send(account))).status,
    ).toBe(400);

    expect(await testPrisma.user.findUnique({ where: { email: 'expired@test.com' } })).toBeNull();
    expect(await testPrisma.user.findUnique({ where: { email: 'cancelled@test.com' } })).toBeNull();
  });

  it('requires the CSRF header to register from an invitation', async () => {
    const org = await seedOrg();
    const { rawToken } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: 'csrf@test.com',
    });
    const res = await createTestAgent().post(`/api/v1/invitations/${rawToken}/register`).send(account);
    expect(res.status).toBe(403);
    expect(await testPrisma.user.findUnique({ where: { email: 'csrf@test.com' } })).toBeNull();
  });

  it('lists pending invitations sent by the organization to owners and admins only', async () => {
    const org = await seedOrg();
    const { rawToken, invitation } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: 'listed@test.com',
      role: 'MEMBER',
    });

    const listed = await org.agent.get(`/api/v1/orgs/${org.orgId}/members/invitations`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.invitations).toHaveLength(1);
    expect(listed.body.data.invitations[0]).toMatchObject({
      id: invitation.id,
      email: 'listed@test.com',
      role: 'MEMBER',
      status: 'PENDING',
      invitedBy: { displayName: 'Owner' },
    });
    expect(listed.body.data.invitations[0].createdAt).toBeTruthy();
    expect(listed.body.data.invitations[0].expiresAt).toBeTruthy();
    expect(listed.body.data.invitations[0]).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(listed.body)).not.toContain(rawToken);
    expect(JSON.stringify(listed.body)).not.toContain(invitation.tokenHash);

    const memberAgent = createTestAgent();
    const member = await registerUser(memberAgent, {
      email: 'plain-member@test.com',
      password: 'Password123!',
      displayName: 'Plain Member',
    });
    await testPrisma.orgMember.create({
      data: { orgId: org.orgId, userId: member.body.data.user.id, role: 'MEMBER' },
    });
    expect((await memberAgent.get(`/api/v1/orgs/${org.orgId}/members/invitations`)).status).toBe(403);
    expect(
      (await withCsrf(memberAgent.post(`/api/v1/orgs/${org.orgId}/members/invitations/${invitation.id}/resend`))).status,
    ).toBe(403);
    expect(
      (await withCsrf(memberAgent.post(`/api/v1/orgs/${org.orgId}/members/invitations/${invitation.id}/cancel`))).status,
    ).toBe(403);

    const adminAgent = createTestAgent();
    const admin = await registerUser(adminAgent, {
      email: 'org-admin@test.com',
      password: 'Password123!',
      displayName: 'Org Admin',
    });
    await testPrisma.orgMember.create({
      data: { orgId: org.orgId, userId: admin.body.data.user.id, role: 'ADMIN' },
    });
    expect((await adminAgent.get(`/api/v1/orgs/${org.orgId}/members/invitations`)).status).toBe(200);
  });

  it('rejects pending-invitation access from another organization', async () => {
    const orgA = await seedOrg('Org A');
    const { invitation } = await seedInvitation({
      orgId: orgA.orgId,
      invitedById: orgA.ownerId,
      email: 'secret-invite@test.com',
    });

    const orgBOwner = createTestAgent();
    await registerUser(orgBOwner, {
      email: 'orgb-owner@test.com',
      password: 'Password123!',
      displayName: 'Org B Owner',
    });
    const orgB = await withCsrf(orgBOwner.post('/api/v1/orgs').send({ name: 'Org B' }));
    const orgBId = orgB.body.data.organization.id as string;

    expect((await orgBOwner.get(`/api/v1/orgs/${orgA.orgId}/members/invitations`)).status).toBe(403);
    const ownList = await orgBOwner.get(`/api/v1/orgs/${orgBId}/members/invitations`);
    expect(ownList.status).toBe(200);
    expect(ownList.body.data.invitations).toHaveLength(0);
    expect(JSON.stringify(ownList.body)).not.toContain('secret-invite@test.com');

    const resend = await withCsrf(
      orgBOwner.post(`/api/v1/orgs/${orgBId}/members/invitations/${invitation.id}/resend`),
    );
    expect(resend.status).toBe(404);
    const cancel = await withCsrf(
      orgBOwner.post(`/api/v1/orgs/${orgBId}/members/invitations/${invitation.id}/cancel`),
    );
    expect(cancel.status).toBe(404);

    const stillPending = await testPrisma.orgInvitation.findUnique({ where: { id: invitation.id } });
    expect(stillPending?.status).toBe('PENDING');
    expect(stillPending?.orgId).toBe(orgA.orgId);
  });

  it('resends by replacing the token hash and cancel withdraws the invitation', async () => {
    const org = await seedOrg();
    const email = 'resend-me@test.com';
    const { rawToken, invitation } = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email,
    });
    await emailQueue.drain();

    const resent = await withCsrf(
      org.agent.post(`/api/v1/orgs/${org.orgId}/members/invitations/${invitation.id}/resend`),
    );
    expect(resent.status).toBe(200);
    expect(resent.body.data.invitation).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(resent.body)).not.toContain(rawToken);

    const stored = await testPrisma.orgInvitation.findUnique({ where: { id: invitation.id } });
    expect(stored?.tokenHash).toBeTruthy();
    expect(stored?.tokenHash).not.toBe(invitation.tokenHash);
    expect(stored?.status).toBe('PENDING');

    const jobs = await emailQueue.getJobs(['waiting', 'delayed', 'active', 'completed']);
    const job = jobs.find((item) => item.name === 'send-invitation-email' && item.data.to === email);
    expect(job).toBeTruthy();
    expect(hashToken(job!.data.rawToken)).toBe(stored?.tokenHash);
    expect(JSON.stringify(resent.body)).not.toContain(job!.data.rawToken);

    const oldLink = await withCsrf(
      createTestAgent().post(`/api/v1/invitations/${rawToken}/register`).send(account),
    );
    expect(oldLink.status).toBe(400);

    const joined = await withCsrf(
      createTestAgent().post(`/api/v1/invitations/${job!.data.rawToken}/register`).send({
        ...account,
        displayName: 'Resent Invitee',
      }),
    );
    expect(joined.status).toBe(201);
    expect(joined.body.data.organization.id).toBe(org.orgId);
    expect(await testPrisma.orgMember.count({ where: { orgId: org.orgId, user: { email } } })).toBe(1);

    const second = await seedInvitation({
      orgId: org.orgId,
      invitedById: org.ownerId,
      email: 'cancel-me@test.com',
    });
    const cancelled = await withCsrf(
      org.agent.post(`/api/v1/orgs/${org.orgId}/members/invitations/${second.invitation.id}/cancel`),
    );
    expect(cancelled.status).toBe(200);
    expect(
      (await testPrisma.orgInvitation.findUnique({ where: { id: second.invitation.id } }))?.status,
    ).toBe('DECLINED');
    const audit = await testPrisma.activityLog.findFirst({
      where: { orgId: org.orgId, action: 'invitation.cancelled' },
    });
    expect(audit).toBeTruthy();

    const afterCancel = await org.agent.get(`/api/v1/orgs/${org.orgId}/members/invitations`);
    expect(afterCancel.body.data.invitations.map((row: { email: string }) => row.email)).not.toContain('cancel-me@test.com');

    const cancelledAccept = await withCsrf(
      createTestAgent().post(`/api/v1/invitations/${second.rawToken}/register`).send(account),
    );
    expect(cancelledAccept.status).toBe(400);
    expect(await testPrisma.user.findUnique({ where: { email: 'cancel-me@test.com' } })).toBeNull();
  });
});

describe('Email configuration', () => {
  it('uses the console provider in the development/test configuration', () => {
    // EMAIL_PROVIDER is `console` in the test environment.
    expect(createEmailProvider()).toBeInstanceOf(ConsoleEmailProvider);
  });

  const baseEnv = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'a'.repeat(32),
  };

  const validProd = {
    ...baseEnv,
    NODE_ENV: 'production',
    APP_URL: 'https://sprintnest.example.com',
    REDIS_URL: 'rediss://default:pass@redis.example.com:6379',
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 're_test',
  };

  it('requires RESEND_API_KEY when the Resend provider is selected', () => {
    const missing = envSchema.safeParse({ ...baseEnv, EMAIL_PROVIDER: 'resend' });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.flatten().fieldErrors.RESEND_API_KEY).toBeDefined();
    }

    // A blank value in a .env file counts as missing.
    expect(
      envSchema.safeParse({ ...baseEnv, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: '  ' }).success,
    ).toBe(false);

    expect(
      envSchema.safeParse({ ...baseEnv, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' })
        .success,
    ).toBe(true);
  });

  it('normalizes blank optional email variables to undefined', () => {
    const parsed = envSchema.parse({ ...baseEnv, RESEND_FROM_EMAIL: '' });
    // Otherwise the provider would send an empty `from` address.
    expect(parsed.RESEND_FROM_EMAIL).toBeUndefined();

    expect(
      envSchema.parse({ ...baseEnv, RESEND_FROM_EMAIL: 'SprintNest <hi@example.com>' })
        .RESEND_FROM_EMAIL,
    ).toBe('SprintNest <hi@example.com>');
  });

  it('rejects development defaults in a production configuration', () => {
    const prod = { ...validProd };

    const devSecret = envSchema.safeParse({
      ...prod,
      JWT_SECRET: 'dev-jwt-secret-change-in-production',
    });
    expect(devSecret.success).toBe(false);

    const shortSecret = envSchema.safeParse({ ...prod, JWT_SECRET: 'short-but-16-chars' });
    expect(shortSecret.success).toBe(false);

    expect(envSchema.safeParse(prod).success).toBe(true);
  });

  it('requires a public APP_URL in production because email links depend on it', () => {
    const prod = { ...validProd };

    expect(envSchema.safeParse({ ...prod, APP_URL: 'http://localhost:3000' }).success).toBe(false);
    expect(envSchema.safeParse({ ...prod, APP_URL: 'http://127.0.0.1:3000' }).success).toBe(false);
    expect(envSchema.safeParse({ ...prod, APP_URL: 'https://app.sprintnest.io' }).success).toBe(
      true,
    );

    // APP_URL also drives the password-reset link, so it must be a valid URL.
    expect(envSchema.safeParse({ ...prod, APP_URL: 'not-a-url' }).success).toBe(false);
  });

  it('rejects localhost Redis and the console email provider in production', () => {
    expect(
      envSchema.safeParse({ ...validProd, REDIS_URL: 'redis://localhost:6379' }).success,
    ).toBe(false);
    expect(envSchema.safeParse({ ...validProd, EMAIL_PROVIDER: 'console' }).success).toBe(false);

    const omitted = { ...validProd } as Record<string, unknown>;
    delete omitted.EMAIL_PROVIDER;
    expect(envSchema.safeParse(omitted).success).toBe(false);
  });
});

/**
 * Verifies the `.env` → config → Resend provider chain with a production-shaped
 * configuration, without sending real mail or holding a real API key.
 */
describe('Resend provider (production configuration)', () => {
  const RESEND_KEY = 're_test_key_never_real';

  afterEach(() => {
    vi.doUnmock('../../src/config/index.js');
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadWithResendConfig(overrides: Record<string, unknown> = {}) {
    vi.resetModules();
    vi.doMock('../../src/config/index.js', () => ({
      config: {
        NODE_ENV: 'production',
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: RESEND_KEY,
        RESEND_FROM_EMAIL: undefined,
        APP_URL: 'https://app.sprintnest.io',
        ...overrides,
      },
      isProduction: true,
      isDevelopment: false,
      isTest: false,
      envSchema,
    }));
    return import('../../src/email/index.js');
  }

  it('selects the Resend provider and sends the configured API key', async () => {
    const { createEmailProvider: create } = await loadWithResendConfig();
    const { ResendEmailProvider } = await import('../../src/email/resend.provider.js');

    const provider = create();
    expect(provider).toBeInstanceOf(ResendEmailProvider);

    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await provider.sendEmail({ to: 'x@test.com', subject: 'Hi', html: '<p>Hi</p>' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${RESEND_KEY}`);
    // Falls back to Resend's shared sender when RESEND_FROM_EMAIL is unset.
    expect(JSON.parse(init.body as string).from).toBe('SprintNest <onboarding@resend.dev>');
  });

  it('uses RESEND_FROM_EMAIL when provided', async () => {
    const { createEmailProvider: create } = await loadWithResendConfig({
      RESEND_FROM_EMAIL: 'SprintNest <no-reply@sprintnest.io>',
    });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await create().sendEmail({ to: 'x@test.com', subject: 'Hi', html: '<p>Hi</p>' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).from).toBe('SprintNest <no-reply@sprintnest.io>');
  });

  it('never writes the API key to the logs, including on API failures', async () => {
    const { createEmailProvider: create } = await loadWithResendConfig();
    const { logger } = await import('../../src/logger.js');

    const written: string[] = [];
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(((...args: unknown[]) => {
      written.push(JSON.stringify(args));
    }) as never);
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(((...args: unknown[]) => {
      written.push(JSON.stringify(args));
    }) as never);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"invalid api key"}', { status: 401 })),
    );

    await expect(
      create().sendEmail({ to: 'x@test.com', subject: 'Hi', html: '<p>Hi</p>' }),
    ).rejects.toThrow('Resend API error: 401');

    expect(written.length).toBeGreaterThan(0);
    expect(written.join('\n')).not.toContain(RESEND_KEY);

    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

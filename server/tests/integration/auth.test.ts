import { describe, it, expect, beforeEach } from 'vitest';
import { createTestAgent, withCsrf, registerUser, loginUser } from '../helpers/request.js';
import { cleanDatabase } from '../helpers/db.js';

describe('Auth Module', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  const testUser = {
    email: 'test@example.com',
    password: 'SecurePass123!',
    displayName: 'Test User',
  };

  // ─── Registration ───────────────────────────────────

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user and set cookies', async () => {
      const agent = createTestAgent();
      const res = await registerUser(agent, testUser);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user.email).toBe(testUser.email);
      expect(res.body.data.user.displayName).toBe(testUser.displayName);
      expect(res.body.data.user).not.toHaveProperty('passwordHash');

      // Should have cookies set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const list = Array.isArray(cookies) ? cookies : [cookies];
      const cookieStr = list.join('\n');
      expect(cookieStr).toContain('access_token');
      expect(cookieStr).toContain('refresh_token');

      const access = list.find((c) => c.startsWith('access_token='));
      const refresh = list.find((c) => c.startsWith('refresh_token='));
      expect(access).toMatch(/HttpOnly/i);
      expect(access).toMatch(/SameSite=Lax/i);
      expect(access).toMatch(/Path=\//i);
      expect(access).not.toMatch(/Secure/i);
      expect(refresh).toMatch(/HttpOnly/i);
      expect(refresh).toMatch(/Path=\/api\/v1\/auth\/refresh/i);
      expect(refresh).not.toMatch(/Secure/i);
    });

    it('should reject duplicate email', async () => {
      const agent = createTestAgent();
      await registerUser(agent, testUser);
      const res = await registerUser(createTestAgent(), testUser);

      expect(res.status).toBe(409);
      expect(res.body.status).toBe('error');
    });

    it('should reject invalid input', async () => {
      const agent = createTestAgent();
      const res = await withCsrf(
        agent.post('/api/v1/auth/register').send({ email: 'bad', password: '1', displayName: '' }),
      );

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });
  });

  // ─── Login ──────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials and set cookies', async () => {
      const agent = createTestAgent();
      await registerUser(agent, testUser);

      const loginAgent = createTestAgent();
      const res = await loginUser(loginAgent, { email: testUser.email, password: testUser.password });

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(testUser.email);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      const agent = createTestAgent();
      await registerUser(agent, testUser);

      const res = await withCsrf(
        createTestAgent().post('/api/v1/auth/login').send({ email: testUser.email, password: 'wrong' }),
      );

      expect(res.status).toBe(401);
    });

    it('should reject non-existent email', async () => {
      const res = await withCsrf(
        createTestAgent().post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'whatever' }),
      );

      expect(res.status).toBe(401);
    });
  });

  // ─── Protected Endpoint ─────────────────────────────

  describe('GET /api/v1/auth/me', () => {
    it('should return 401 without auth', async () => {
      const res = await createTestAgent().get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return user profile with valid cookie', async () => {
      const agent = createTestAgent();
      await registerUser(agent, testUser);

      const res = await agent.get('/api/v1/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(testUser.email);
    });
  });

  // ─── Refresh ────────────────────────────────────────

  describe('POST /api/v1/auth/refresh', () => {
    it('should rotate refresh token and set new cookies', async () => {
      const agent = createTestAgent();
      await registerUser(agent, testUser);

      const res = await agent.post('/api/v1/auth/refresh');
      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(testUser.email);
    });

    it('should reject without refresh token cookie', async () => {
      const res = await createTestAgent().post('/api/v1/auth/refresh');
      expect(res.status).toBe(401);
    });
  });

  // ─── Logout ─────────────────────────────────────────

  describe('POST /api/v1/auth/logout', () => {
    it('should clear cookies and revoke token', async () => {
      const agent = createTestAgent();
      await registerUser(agent, testUser);

      const res = await withCsrf(agent.post('/api/v1/auth/logout'));
      expect(res.status).toBe(200);

      // After logout, /me should fail
      const meRes = await agent.get('/api/v1/auth/me');
      expect(meRes.status).toBe(401);
    });
  });

  // ─── CSRF Protection ───────────────────────────────

  describe('CSRF protection', () => {
    it('should reject state-changing request without CSRF header', async () => {
      const res = await createTestAgent()
        .post('/api/v1/auth/register')
        .send(testUser);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('CSRF');
    });
  });

  // ─── Password Reset ────────────────────────────────

  describe('Password reset flow', () => {
    it('should always return success for forgot-password (no email enumeration)', async () => {
      const res = await withCsrf(
        createTestAgent().post('/api/v1/auth/forgot-password').send({ email: 'nonexistent@example.com' }),
      );

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should accept forgot-password for existing user', async () => {
      const agent = createTestAgent();
      await registerUser(agent, testUser);

      const res = await withCsrf(
        createTestAgent().post('/api/v1/auth/forgot-password').send({ email: testUser.email }),
      );

      expect(res.status).toBe(200);
    });

    it('should reject reset-password with invalid token', async () => {
      const res = await withCsrf(
        createTestAgent().post('/api/v1/auth/reset-password').send({ token: 'invalid-token', password: 'NewPass123!' }),
      );

      expect(res.status).toBe(400);
    });
  });
});

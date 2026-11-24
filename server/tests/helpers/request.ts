import supertest from 'supertest';
import app from '../../src/app.js';
import { CSRF_HEADER } from '../../src/shared/constants.js';

/** Supertest agent with CSRF header pre-set */
export function createTestAgent() {
  const agent = supertest.agent(app);
  return agent;
}

/** Helper to make requests with the CSRF header */
export function withCsrf(request: supertest.Test): supertest.Test {
  return request.set(CSRF_HEADER, 'XMLHttpRequest');
}

/** Register a user and return cookies + user data */
export async function registerUser(
  agent: ReturnType<typeof createTestAgent>,
  data: { email: string; password: string; displayName: string },
) {
  const res = await withCsrf(
    agent
      .post('/api/v1/auth/register')
      .send(data),
  );
  return res;
}

/** Login a user and return cookies + user data */
export async function loginUser(
  agent: ReturnType<typeof createTestAgent>,
  data: { email: string; password: string },
) {
  const res = await withCsrf(
    agent
      .post('/api/v1/auth/login')
      .send(data),
  );
  return res;
}

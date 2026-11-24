import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import app from '../../src/app.js';

const request = supertest(app);

describe('GET /api/health', () => {
  it('should return status ok', async () => {
    const res = await request.get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.uptime).toBeDefined();
  });
});

describe('API 404', () => {
  it('should return 404 for unknown API routes', async () => {
    const res = await request.get('/api/v1/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
  });
});

describe('Validation middleware', () => {
  it('should return 400 with field errors for invalid input', async () => {
    const res = await request
      .post('/api/v1/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: 'not-an-email', password: '123', displayName: '' });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.errors).toBeDefined();
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});

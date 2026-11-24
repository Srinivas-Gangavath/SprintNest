// Global test setup — set environment variables before any imports
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://sprintnest:sprintnest@localhost:5433/sprintnest_test';
process.env.DIRECT_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
// Database 1, not the default 0. A running `docker compose` dev server keeps its
// own in-process BullMQ workers attached to Redis; sharing a database lets that
// container steal queued test jobs and fail them against the dev database.
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-chars';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY_DAYS = '7';
process.env.EMAIL_PROVIDER = 'console';
process.env.APP_URL = 'http://localhost:3001';

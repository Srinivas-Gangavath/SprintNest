import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { config, isProduction } from './config/index.js';
import { logger } from './logger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';

// Route imports
import authRoutes from './modules/auth/auth.routes.js';
import orgRoutes from './modules/organizations/organizations.routes.js';
import invitationRoutes from './modules/invitations/invitations.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';

const app = express();

// ─── Log redaction ──────────────────────────────────────
// Three secrets pass through the HTTP layer: single-use invitation tokens in
// the URL path, session JWTs in the request Cookie header, and freshly issued
// JWTs in the response Set-Cookie header. The default pino-http serializers
// log all three, so both are wrapped to strip them.

function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  // Fresh regexes: a shared /g pattern keeps lastIndex and can skip the next URL.
  // `pending` is a literal route, not a token. Every other invitation path segment is.
  // Anchor at the start (or after an origin) so org routes like
  // `/orgs/:orgId/members/invitations/:id` are not treated as token URLs.
  return url
    .replace(
      /^(https?:\/\/[^/?#]+)?(\/(?:api\/v1\/)?invitations\/)(?!pending(?:\/|$|\?))[^/?#]+/,
      '$1$2[redacted]',
    )
    .replace(/([?&]token=)[^&]*/gi, '$1[redacted]');
}

interface SerializedMessage {
  url?: string;
  headers?: Record<string, unknown>;
}

function redactRequest(req: SerializedMessage): SerializedMessage {
  const { cookie: _cookie, authorization: _authorization, referer, ...headers } = req.headers ?? {};
  const safeReferer = typeof referer === 'string' ? redactUrl(referer) : undefined;
  return {
    ...req,
    url: redactUrl(req.url),
    headers: safeReferer !== undefined ? { ...headers, referer: safeReferer } : headers,
  };
}

function redactResponse(res: SerializedMessage): SerializedMessage {
  const { 'set-cookie': _setCookie, ...headers } = res.headers ?? {};
  return { ...res, headers };
}

export { redactRequest as redactRequestForTest, redactResponse as redactResponseForTest };

// In production the app sits behind the platform's TLS-terminating proxy. Without
// this, `req.ip` resolves to the proxy for every request and the auth rate limiter
// would share one 20-request budget across all users.
if (isProduction) {
  app.set('trust proxy', 1);
}

// ─── Global Middleware ──────────────────────────────────

app.use(requestIdMiddleware);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({ requestId: (req as any).requestId }),
    autoLogging: {
      ignore: (req) => req.url === '/api/health',
    },
    // pino-http wraps these, so they receive the standard serializers' output.
    serializers: { req: redactRequest as never, res: redactResponse as never },
  }),
);

// ─── Health Check ───────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ─── API Routes ─────────────────────────────────────────

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/orgs', orgRoutes);
app.use('/api/v1/invitations', invitationRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// ─── 404 for unmatched API routes ───────────────────────
// Registered before the SPA fallback so an unknown /api path returns JSON
// instead of being answered with index.html.

app.use('/api', (_req, res) => {
  res.status(404).json({
    status: 'error',
    statusCode: 404,
    message: 'API endpoint not found',
  });
});

// ─── SPA (same-origin) ──────────────────────────────────
// Serves the built React app and rewrites unknown non-API GET paths to
// index.html so client-side routes survive a refresh or a direct link — for
// example the invitation link `/invitations/:token/accept` sent by email.

const clientDist =
  config.CLIENT_DIST_PATH ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

if (existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false }));

  app.get('*', (req, res, next) => {
    // Never hijack the API or the Socket.IO endpoint.
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  logger.info({ clientDist }, 'Serving React SPA from Express');
} else {
  logger.info(
    { clientDist },
    'No client build found — running API-only (Vite dev server serves the SPA)',
  );
}

// ─── Global Error Handler ───────────────────────────────

app.use(errorHandler);

export default app;

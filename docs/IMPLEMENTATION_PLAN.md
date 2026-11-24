# SprintNest — Implementation Plan

> **This file is the single source of truth** for the SprintNest implementation plan, architecture decisions, and progress tracking.

---

## How to Use This Document

1. **Before starting any phase**, read its section to understand the goal, prerequisites, and verification checklist.
2. **During implementation**, check off items in the module checklist as they are completed.
3. **After completing a phase**, update the [Current Progress](#current-progress) section at the bottom.
4. **If an architectural decision changes**, update the relevant section here and note the date and reason.
5. **Do not maintain duplicate architecture docs.** This file supersedes all prior Phase 0 design documents.

---

## 1. Purpose and Goals

SprintNest is a multi-user, multi-tenant project management SaaS for small development teams (2–15 members). It provides:

- Workspace-scoped project boards
- Task management with assignments, priorities, labels, and due dates
- Threaded comments on tasks
- Real-time collaboration via WebSockets
- An immutable activity audit trail
- In-app notifications

It is also a **portfolio project** demonstrating full-stack production-grade engineering: authentication, authorization, real-time communication, background jobs, caching, structured logging, testing, Docker, and cloud deployment — all at $0 infrastructure cost.

---

## 2. Final Approved Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 22 LTS |
| Backend framework | Express | 4.x |
| Language | TypeScript | 5.x |
| Frontend framework | React | 18.x |
| Frontend build | Vite | 5.x |
| Styling | Tailwind CSS | v3 |
| ORM | Prisma | Latest stable |
| Database | PostgreSQL | 16 |
| Cache / Queue backend | Redis | 7 |
| Background jobs | BullMQ | Latest stable |
| Real-time | Socket.IO | 4.x |
| Validation | Zod | Latest stable |
| Logging | Pino | Latest stable |
| Markdown rendering | react-markdown + rehype-sanitize | Latest stable |
| Testing | Vitest + Supertest + Playwright | Latest stable |
| CI | GitHub Actions | — |
| Containerization | Docker + Docker Compose | — |

---

## 3. Final Architecture Summary

**Modular monolith.** One Express server serves the REST API, Socket.IO WebSocket connections, and the built React SPA — all from a single origin on a single process.

**Repository structure:** One repo with two top-level directories:

```
SprintNest/
├── client/          # React + Vite + Tailwind
├── server/          # Express + Prisma + BullMQ + Socket.IO
├── docs/            # This file and other documentation
├── docker-compose.yml
└── README.md
```

**Production deployment:** A single Docker container on Render Free, connecting to Neon Free (PostgreSQL) and Upstash Free (Redis). No paid services.

**Same-origin design:** The Express server serves the React SPA build as static files. API endpoints live under `/api/v1/*`. Socket.IO attaches to the same HTTP server. Cookies work without cross-origin configuration.

---

## 4. Frontend Architecture

| Concern | Approach |
|---|---|
| Framework | React 18 with TypeScript |
| Build tool | Vite |
| Routing | React Router (latest stable) |
| Styling | Tailwind CSS v3 with centralized design tokens in `tailwind.config.ts` |
| State — auth/org | React Context + `useReducer` |
| State — server data | TanStack Query (React Query) |
| State — local UI | `useState` / `useReducer` per component |
| API client | Fetch or Axios with cookie-based auth (credentials: 'include') |
| Real-time | Socket.IO client, connected via `SocketContext` |
| Markdown | `react-markdown` + `rehype-sanitize` |
| Class merging | `clsx` + `tailwind-merge` via a `cn()` utility |

**Design philosophy:** Clean, modern, restrained, professional, developer-oriented. Neutral palette (slate/zinc grays, one accent color). No excessive gradients, animations, or visual clutter. Mobile-first responsive via Tailwind breakpoints.

### Folder structure

```
client/
├── public/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/              # API client functions per domain
│   ├── features/         # Feature modules (auth, dashboard, orgs, projects, tasks, etc.)
│   │   └── <feature>/
│   │       ├── pages/
│   │       ├── components/
│   │       └── hooks/
│   ├── components/
│   │   ├── ui/           # Shared primitives: Button, Input, Modal, Badge, etc.
│   │   └── layout/       # Shell, Sidebar, Header, PageContainer
│   ├── hooks/            # Shared hooks (useSocket, usePagination, useDebounce)
│   ├── contexts/         # AuthContext, SocketContext, OrgContext
│   ├── lib/              # Utilities (cn, formatDate, constants)
│   ├── types/            # Shared TS types mirroring backend entities
│   └── router/           # Route definitions + guards
├── index.html
├── tailwind.config.ts
├── postcss.config.js
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 5. Backend Architecture

| Concern | Approach |
|---|---|
| Framework | Express 4.x |
| Language | TypeScript, compiled to JS for production |
| Database access | Prisma Client |
| Validation | Zod schemas per endpoint |
| Auth | JWT in httpOnly cookies |
| Logging | Pino (JSON in prod, pino-pretty in dev) |
| Error handling | Custom error classes + global error-handler middleware |
| Background jobs | BullMQ (in-process workers) |
| Real-time | Socket.IO (in-memory rooms, same HTTP server) |
| Email | Provider abstraction (Resend for prod, console for dev) |

### Module convention

Each feature module follows the pattern:

```
modules/<feature>/
├── <feature>.routes.ts       # Express Router definitions
├── <feature>.controller.ts   # Request parsing, response formatting (thin)
├── <feature>.service.ts      # Business logic, Prisma queries, cache, audit writes
├── <feature>.validation.ts   # Zod schemas
└── <feature>.types.ts        # Module-specific TypeScript types
```

No separate repository layer. Prisma calls live in the service layer. Use `prisma.$queryRaw` only when the Prisma query builder cannot express the query efficiently, with a comment explaining why.

### Folder structure

```
server/
├── src/
│   ├── app.ts                 # Express app (middleware, routes, SPA serving)
│   ├── server.ts              # HTTP server bootstrap + Socket.IO
│   ├── config/                # Env config, Prisma client, Redis client
│   ├── modules/               # Feature modules (auth, users, orgs, members, projects, tasks, labels, comments, notifications, activity)
│   ├── middleware/            # authenticate, authorize, validate, errorHandler, requestId, csrfProtection, rateLimiter
│   ├── shared/                # errors/, utils/, types/, constants.ts
│   ├── jobs/                  # BullMQ queue definitions + workers (email, notification)
│   ├── email/                 # EmailProvider interface + implementations + templates
│   ├── websocket/             # Socket.IO setup, handlers, middleware
│   └── logger.ts              # Pino instance
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── helpers/
├── Dockerfile
├── tsconfig.json
├── package.json
└── .env.example
```

---

## 6. Database / Entity Summary

**13 tables**, managed by Prisma Migrate.

| Table | Purpose | Key relationships |
|---|---|---|
| `users` | User accounts | — |
| `organizations` | Tenant workspaces | `owner_id` → users |
| `org_members` | Org membership + role | users ↔ organizations (M:N) |
| `org_invitations` | Pending invites | → organizations, → users (invited_by) |
| `password_reset_tokens` | Password reset flow | → users |
| `refresh_tokens` | Auth refresh tokens | → users |
| `projects` | Projects within an org | → organizations, `created_by` → users |
| `tasks` | Tasks within a project | → projects, `assignee_id` → users, `created_by` → users |
| `labels` | Org-scoped label definitions | → organizations |
| `task_labels` | Task ↔ Label join table | → tasks, → labels |
| `comments` | Comments on tasks | → tasks, `author_id` → users, `parent_id` → comments (self-ref) |
| `notifications` | In-app notifications | → users |
| `activity_logs` | Immutable audit trail | → organizations, → projects, → tasks, `actor_id` → users |

**Key design rules:**
- All PKs are UUIDs.
- `organizations` has `deleted_at` for soft-delete. Queries must filter `WHERE deleted_at IS NULL`.
- `org_invitations`, `password_reset_tokens`, and `refresh_tokens` all store **SHA-256 hashes** of secret tokens, never plaintext.
- `tasks.task_number` is a per-project sequential integer. `projects.task_counter` is atomically incremented inside the task-creation transaction.
- `tasks.assignee_id` must reference a user who is an active member of the task's organization (enforced at the service layer).
- `activity_logs` is append-only (no UPDATE/DELETE). Written synchronously in the same Prisma `$transaction` as the mutation.
- Expired invitations, refresh tokens, and password reset tokens are checked lazily at access time — no scheduled cleanup jobs.

---

## 7. Authentication Architecture

**Access token:** Short-lived JWT (15 min), stored in an `httpOnly` cookie named `access_token`, path `/api`, `SameSite=Lax`, `Secure` in production.

**Refresh token:** Long-lived (7 days), random 32-byte hex string, stored in an `httpOnly` cookie named `refresh_token`, path `/api/auth/refresh`, `SameSite=Lax`, `Secure` in production. The database stores only the SHA-256 hash.

**Refresh token rotation:** On every successful refresh, the old token is deleted and a new one is issued. If a previously-used token is presented (possible theft), all refresh tokens for that user are revoked.

**CSRF protection:** `SameSite=Lax` cookies prevent cross-origin POST/PUT/PATCH/DELETE from including cookies. As additional defense, all state-changing endpoints require a custom header (e.g., `X-Requested-With: XMLHttpRequest`).

**Socket.IO auth:** The `access_token` cookie is sent automatically during the WebSocket handshake (same origin). Server-side Socket.IO middleware verifies the JWT.

**Flow:**
1. `POST /api/v1/auth/login` → validate credentials → set both cookies → return user.
2. Authenticated requests → middleware reads `access_token` cookie → verify JWT.
3. On 401 → client calls `POST /api/v1/auth/refresh` → rotate tokens → set new cookies.
4. `POST /api/v1/auth/logout` → delete refresh token from DB → clear both cookies.

---

## 8. Authorization / RBAC Rules

Roles are **organization-scoped**. All org members see all org projects.

| Action | Owner | Admin | Member |
|---|---|---|---|
| Delete organization | ✅ | ❌ | ❌ |
| Manage org settings | ✅ | ✅ | ❌ |
| Invite/remove members | ✅ | ✅ | ❌ |
| Change member roles | ✅ | ❌ | ❌ |
| Create/archive projects | ✅ | ✅ | ❌ |
| Manage labels | ✅ | ✅ | ❌ |
| View audit log | ✅ | ✅ | ❌ |
| Create/update tasks | ✅ | ✅ | ✅ |
| Add/edit comments | ✅ | ✅ | ✅ |
| View projects/tasks | ✅ | ✅ | ✅ |

**Middleware chain:** `authenticate` → `resolveOrgMembership` → `authorize(requiredRole)`

**Invariants:**
- One Owner per org; must match `organizations.owner_id`.
- Owner cannot be removed or demoted.
- Admin cannot promote to Owner or demote another Admin.

---

## 9. Redis Responsibilities

Redis (Upstash Free in production, Docker Redis in development) is used for:

1. **BullMQ job queues** — email dispatch and notification fan-out.
2. **Application caching** — hot-path query results with short TTLs.

Redis is **NOT** used for the Socket.IO adapter (rooms are in-memory on a single process).

---

## 10. BullMQ Responsibilities

Two queues, processed by in-process workers in the same Express server:

| Queue | Jobs | Retry |
|---|---|---|
| `email` | `send-invitation-email`, `send-password-reset-email` | 3 retries, exponential backoff |
| `notifications` | `fan-out-notification` | 2 retries |

**What does NOT use BullMQ:**
- Activity/audit log writes (synchronous in Prisma transaction).
- Token/invitation cleanup (lazy expiration on access).

---

## 11. Socket.IO Responsibilities

Socket.IO is attached to the same HTTP server as Express. Rooms are managed in memory (no Redis adapter).

| Room format | Purpose |
|---|---|
| `user:<userId>` | Personal notifications, invitation alerts |
| `project:<projectId>` | Task and comment CRUD events for viewers of that project |

**Key events:** `task:created`, `task:updated`, `task:deleted`, `comment:created`, `comment:updated`, `comment:deleted`, `notification:new`, `member:added`, `member:removed`.

**Auth:** Cookie-based. The `access_token` cookie is sent during the WebSocket handshake.

---

## 12. Caching Strategy

**Pattern:** Cache-aside (lazy loading). Read: check cache → miss → query DB → populate cache. Write: Prisma mutation → delete cache key(s).

| Key | TTL | Invalidation |
|---|---|---|
| `user:{id}:orgs` | 5 min | Member added/removed/role changed |
| `org:{id}:members` | 5 min | Member added/removed/role changed |
| `project:{id}:task-stats` | 2 min | Task created/updated/deleted |
| `user:{id}:unread-count` | 1 min | Notification created/read |

Short TTLs are a safety net against missed invalidations.

---

## 13. Logging and Error-Handling Strategy

**Logging:** Pino. JSON to stdout in production (captured by Render). `pino-pretty` in development. Every request gets a `requestId` (UUID) attached to a child logger.

**Log levels:** `fatal`, `error`, `warn`, `info`, `debug`.

**Error handling:** Custom error classes (`AppError`, `ValidationError`, `AuthenticationError`, `AuthorizationError`, `NotFoundError`, `ConflictError`, `RateLimitError`) → caught by global error-handler middleware → structured JSON response with `status`, `statusCode`, `message`, `errors[]`, `requestId`. Stack traces are never sent in production.

**Prisma errors:** Mapped in the error handler (P2002 → 409, P2025 → 404, P2003 → 400).

---

## 14. Testing Strategy

| Layer | Tool | Target |
|---|---|---|
| Unit | Vitest | Service logic, utilities, validators |
| Integration | Vitest + Supertest | API endpoints against real PostgreSQL |
| E2E | Playwright | 3–5 critical user journeys |

**Test database:** A dedicated `sprintnest_test` PostgreSQL database in the same Docker container. Prisma migrations are applied before the test suite. Tables are truncated between test files using a shared helper. No per-test transaction rollback.

**CI:** GitHub Actions runs `docker compose` for Postgres + Redis, applies migrations, then runs unit → integration → E2E sequentially.

---

## 15. Docker Strategy

**Development:** `docker-compose.yml` with 4 services:

| Service | Image/Build | Port |
|---|---|---|
| `server` | Build from `./server` | 3000 |
| `client` | Build from `./client` | 5173 |
| `postgres` | `postgres:16-alpine` | 5432 |
| `redis` | `redis:7-alpine` | 6379 |

Volume mounts enable hot reload. Vite proxies `/api` and `/socket.io` to the server.

**Production:** A single `Dockerfile` builds both client and server, copies the client build into the server's static-serving directory, and runs the Express server.

---

## 16. Deployment Strategy

**Same-origin on Render Free:**
- One web service running the Docker image.
- Express serves the React SPA at all non-API routes.
- API at `/api/v1/*`, Socket.IO at `/socket.io`.
- PostgreSQL on Neon Free (connection via pooler endpoint).
- Redis on Upstash Free.

**Constraints:**
- Render Free sleeps after inactivity. Cold starts are expected and tolerable.
- Render Free has an ephemeral filesystem. All persistent state is in PostgreSQL/Redis.
- Neon Free auto-suspends. First query after suspend has added latency.
- Upstash Free has daily command limits. Monitor via dashboard.

**CI/CD:** GitHub Actions runs tests on push. On merge to `main`, Render auto-deploys from the repo.

---

## 17. Security Checklist

- [ ] Passwords hashed with bcrypt (cost 12)
- [ ] All secret tokens (refresh, invitation, password-reset) stored as SHA-256 hashes
- [ ] JWTs in httpOnly, Secure, SameSite=Lax cookies
- [ ] Refresh token rotation with reuse detection
- [ ] CSRF: custom header required on state-changing requests
- [ ] Rate limiting on auth endpoints (login, register, forgot-password)
- [ ] Zod validation on every API endpoint
- [ ] Prisma parameterized queries (no raw string interpolation)
- [ ] Markdown sanitized with rehype-sanitize
- [ ] Helmet.js security headers
- [ ] CORS not needed (same-origin) — if enabled later, strict whitelist
- [ ] Tenant isolation: every tenant-scoped query includes `orgId`
- [ ] Assignee validation: must be an active org member
- [ ] Environment secrets never committed (`.env.example` only)
- [ ] `npm audit` in CI
- [ ] Stack traces stripped from production error responses
- [ ] No sensitive data in logs (no passwords, tokens, or PII)

---

## 18–21. Implementation Phases

---

### Phase 1 — Foundation

**Goal:** Set up the project skeleton so that both `client/` and `server/` build, the backend connects to PostgreSQL and Redis, and the dev environment runs with one command.

**Why:** Every subsequent phase depends on a working project structure, database connection, logging, error handling, and validation.

**Prerequisites:** Docker and Node.js 22 installed locally.

**Key concepts to understand:**
- TypeScript project configuration (`tsconfig.json`, path aliases)
- Express middleware pipeline (order matters)
- Prisma schema language and `prisma migrate dev`
- Docker Compose service networking (containers reference each other by service name)
- Environment variable management (`.env` files, Zod-validated config)
- Pino structured logging (child loggers, request context)
- Zod schema definition and Express integration

**What will be built:**

- [x] Root-level `docker-compose.yml`
- [x] `server/` — package.json, tsconfig.json, initial src structure
- [x] `client/` — Vite + React + Tailwind scaffold
- [x] `server/src/config/index.ts` — Zod-validated environment config
- [x] `server/src/config/database.ts` — Prisma client singleton
- [x] `server/src/config/redis.ts` — ioredis client
- [x] `server/prisma/schema.prisma` — approved schema with all 13 models
- [x] `server/src/logger.ts` — Pino instance
- [x] `server/src/app.ts` — Express app with middleware stack
- [x] `server/src/server.ts` — HTTP server bootstrap
- [x] `server/src/middleware/requestId.ts`
- [x] `server/src/middleware/errorHandler.ts`
- [x] `server/src/middleware/validate.ts` — Zod validation wrapper
- [x] `server/src/shared/errors/` — Custom error classes
- [x] `server/src/shared/utils/` — Basic helpers
- [x] `GET /api/health` — health check endpoint
- [x] `.env.example`
- [x] `server/Dockerfile.dev`
- [x] `client/Dockerfile.dev`

**Database changes:** Complete Prisma schema with all 13 models: User, Organization, OrgMember, OrgInvitation, Project, Task, Label, TaskLabel, Comment, Notification, ActivityLog, RefreshToken, PasswordResetToken. Pushed to development and test databases.

**Tests:** Health check integration tests (`tests/integration/health.test.ts`), Docker services startup, database connection.

**Verification checklist:**
- [x] `docker compose up` starts postgres and redis without errors (port 5433 mapped to avoid local host conflict)
- [x] `GET /api/health` returns `{ "status": "ok" }`
- [x] Prisma schema successfully synced to both `sprintnest` and `sprintnest_test`
- [x] Pino structured logging active
- [x] Zod validation middleware returns RFC-compliant 400 error structures
- [x] Client dev server and production build (`npm run build`) pass cleanly
- [x] TypeScript compiles with zero errors on both server and client

**Status:** `✅ COMPLETE`

**Completed Work Summary:**
- **What was implemented:** Scaffolding for modular monolith, Docker Compose setup for Postgres 16 and Redis 7, Express app bootstrap with Helmet, cookie-parser, requestId, error handler, Zod validator, Pino logging, and complete Prisma schema.
- **Important technical decisions:** Host port mapped to 5433 to avoid collision with any native Windows PostgreSQL; Zod-validated runtime environment variables; single fork test runner in Vitest for database isolation.
- **Key files:** `server/src/app.ts`, `server/src/server.ts`, `server/prisma/schema.prisma`, `docker-compose.yml`, `client/src/main.tsx`.
- **Tests added:** `health.test.ts` (3 tests passed).
- **Verification performed:** TypeScript checks, Docker container health, health check response, DB push.

---

### Phase 2 — Authentication

**Goal:** Users can register, log in, refresh tokens, log out, and reset their password. All subsequent phases depend on having authenticated users.

**Why:** Authentication is the gateway to everything. No feature can be built or tested without it.

**Prerequisites:** Phase 1 complete. Users table in the database. Middleware stack working.

**Key concepts to understand:**
- bcrypt password hashing and verification
- JWT creation, signing, and verification (jsonwebtoken or jose)
- httpOnly cookie semantics (setting, reading, clearing)
- Refresh token rotation and reuse detection
- SHA-256 token hashing for storage
- SameSite cookie policy and CSRF via custom headers
- Express middleware chaining for auth

**What will be built:**

- [x] `server/src/modules/auth/auth.routes.ts`
- [x] `server/src/modules/auth/auth.controller.ts`
- [x] `server/src/modules/auth/auth.service.ts`
- [x] `server/src/modules/auth/auth.validation.ts`
- [x] `server/src/modules/auth/auth.types.ts`
- [x] `server/src/middleware/authenticate.ts`
- [x] `server/src/middleware/csrfProtection.ts`
- [x] `server/src/middleware/rateLimiter.ts`

**API endpoints:**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Create account, set cookies |
| POST | `/api/v1/auth/login` | Authenticate, set cookies |
| POST | `/api/v1/auth/refresh` | Rotate tokens, set new cookies |
| POST | `/api/v1/auth/logout` | Revoke refresh token, clear cookies |
| POST | `/api/v1/auth/forgot-password` | Generate reset token, enqueue email (or log in dev) |
| POST | `/api/v1/auth/reset-password` | Verify token, update password |
| GET | `/api/v1/auth/me` | Get current user profile |
| PATCH | `/api/v1/auth/me` | Update profile |

**Database changes:** Prisma models for `users`, `refresh_tokens`, `password_reset_tokens`. Migration.

**Tests:**
- [x] Unit: password hashing (bcrypt), token hashing (SHA-256), JWT generation
- [x] Integration: register → login → access protected route → refresh → logout
- [x] Integration: forgot password → reset password
- [x] Integration: expired token rejected, reused refresh token revokes all tokens
- [x] Integration: rate limiting on login endpoint
- [x] Integration: CSRF protection requires `X-Requested-With` header on state-changing requests

**Verification checklist:**
- [x] Can register a new user and receive cookies
- [x] Can log in and receive cookies
- [x] Can access `GET /api/v1/auth/me` with valid access token cookie
- [x] 401 returned for missing/expired/invalid access token
- [x] Can refresh tokens and receive new cookies
- [x] Reusing an old refresh token revokes all tokens for that user
- [x] Can log out (cookies cleared, refresh token revoked)
- [x] Can request password reset (token logged in dev or email sent)
- [x] Can reset password with valid token
- [x] Expired/used reset tokens are rejected
- [x] Rate limiting prevents brute-force on login
- [x] CSRF: requests without custom header on state-changing endpoints are rejected

**Status:** `✅ COMPLETE`

**Completed Work Summary:**
- **What was implemented:** Complete authentication module featuring bcrypt password hashing (12 rounds), JWT access tokens (15m expiry, httpOnly cookie with Path=/), rotating refresh tokens (7d expiry, httpOnly cookie with Path=/api/v1/auth/refresh), refresh token reuse detection, password reset with SHA-256 token hashing, express-rate-limit protection, CSRF custom header enforcement (`X-Requested-With: XMLHttpRequest`), and React client AuthContext and auth pages.
- **Important technical decisions:** Strict cookie path scoping matching Phase 0 corrections (`/` for access token, `/api/v1/auth/refresh` for refresh token); lazy cleanup on token verification; generic messages on forgot password to mitigate user enumeration.
- **Key files:** `server/src/modules/auth/auth.service.ts`, `server/src/modules/auth/auth.controller.ts`, `server/src/middleware/authenticate.ts`, `server/src/middleware/csrfProtection.ts`, `client/src/contexts/AuthContext.tsx`, `client/src/pages/LoginPage.tsx`.
- **Tests added:** `auth.test.ts` (15 tests passed).
- **Verification performed:** 15 passing integration tests, registration, login, logout, cookie validation, token rotation, password reset, rate limiting, and CSRF tests.

---

### Phase 3 — Organizations & Membership

**Goal:** Users can create organizations, invite members, accept invitations, and manage roles. This establishes the multi-tenant foundation.

**Why:** Every feature from Phase 4 onward is scoped to an organization. Without orgs and membership, there is no tenant context.

**Prerequisites:** Phase 2 complete. Authenticated users.

**Key concepts to understand:**
- Multi-tenant data isolation (every query scoped by `org_id`)
- URL-safe slug generation
- Soft-delete pattern (`deleted_at` column, filtered queries)
- Invitation flow: create token → hash → store → email link → accept
- RBAC middleware: resolving org membership and checking role
- Transactional audit log writes (Prisma `$transaction`)

**What will be built:**

- [x] `server/src/modules/organizations/` — full module
- [x] `server/src/modules/members/` — membership + invitation handling
- [x] `server/src/modules/activity/` — activity log service (shared, called by other modules)
- [x] `server/src/middleware/authorize.ts` — role-checking middleware
- [x] Slug generation utility
- [x] Invitation token generation + hashing utilities

**API endpoints:**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/orgs` | Create org (creator becomes Owner) |
| GET | `/api/v1/orgs` | List current user's orgs |
| GET | `/api/v1/orgs/:orgId` | Get org details |
| PATCH | `/api/v1/orgs/:orgId` | Update org (Owner/Admin) |
| DELETE | `/api/v1/orgs/:orgId` | Soft-delete org (Owner only) |
| GET | `/api/v1/orgs/:orgId/members` | List members |
| POST | `/api/v1/orgs/:orgId/members/invitations` | Invite (Owner/Admin) |
| PATCH | `/api/v1/orgs/:orgId/members/:memberId/role` | Change role (Owner only) |
| DELETE | `/api/v1/orgs/:orgId/members/:memberId` | Remove member (Owner/Admin) |
| GET | `/api/v1/invitations/pending` | List user's pending invitations |
| POST | `/api/v1/invitations/:token/accept` | Accept invitation |
| POST | `/api/v1/invitations/:token/decline` | Decline invitation |

**Database changes:** Prisma models for `organizations`, `org_members`, `org_invitations`, `activity_logs`. Migration.

**Tests:**
- [x] Unit: slug generation, role hierarchy checks
- [x] Integration: create org → verify owner membership
- [x] Integration: invite member → accept → verify membership
- [x] Integration: invite member → decline
- [x] Integration: expired invitation rejected (lazy expiration)
- [x] Integration: RBAC enforcement (member cannot invite, admin cannot delete org)
- [x] Integration: soft-delete org → org excluded from listings
- [x] Integration: audit log entries created for mutations

**Verification checklist:**
- [x] Creating an org sets the creator as Owner in both `organizations.owner_id` and `org_members`
- [x] Org slug is generated and unique
- [x] Only Owner can delete org; delete sets `deleted_at`
- [x] Soft-deleted orgs are excluded from all normal queries
- [x] Invitations store hashed tokens; raw token is returned for email
- [x] Invitation acceptance creates membership, updates status, writes audit log
- [x] Duplicate pending invitations for same (org, email) are prevented
- [x] Role changes are Owner-only and respect invariants
- [x] Activity log entries exist for: org created, member invited/joined/removed, role changed
- [x] All org-scoped queries include `orgId` filter

**Status:** `✅ COMPLETE`

**Completed Work Summary:**
- **What was implemented:** Complete multi-tenant workspace foundation including organization CRUD, slug generation, soft deletion (`deleted_at`), membership management with hierarchical RBAC (OWNER > ADMIN > MEMBER), token-based email invitation system with SHA-256 hash storage and lazy expiration, synchronous transactional activity audit logging (`$transaction`), and a full React client Dashboard page with organization switcher, member list, and invitation dialogs.
- **Important technical decisions:** Role hierarchy enforcement in middleware (`resolveOrgMembership` + `authorize`); synchronous activity logging within the mutation's database transaction to ensure audit integrity; secure invitations with 7-day TTL and lazy invalidation.
- **Key files:** `server/src/modules/organizations/organizations.service.ts`, `server/src/modules/members/members.service.ts`, `server/src/modules/activity/activity.service.ts`, `server/src/middleware/authorize.ts`, `client/src/pages/DashboardPage.tsx`.
- **Tests added:** `organizations.test.ts` (11 tests passed).
- **Verification performed:** 11 passing integration tests covering org creation, listing, updating, soft-deletion, RBAC permission denial, invitation acceptance and decline, member removal invariants, and activity log generation.

---

### Phase 4 — Projects

**Goal:** Users can create and manage projects within their organizations.

**Why:** Projects are the container for tasks. They must exist before tasks can be created.

**Prerequisites:** Phase 3 complete. Working org context and RBAC.

**Key concepts to understand:**
- Scoping: projects belong to an org, accessible by all org members
- Archiving vs. deleting
- `task_counter` field for per-project task numbering (used in Phase 5)

**What will be built:**

- [x] `server/src/modules/projects/` — full module
  - `projects.validation.ts` — Zod schemas for create, update, archive, params, query
  - `projects.service.ts` — business logic with org scoping, activity logging
  - `projects.controller.ts` — thin controller layer
  - `projects.routes.ts` — route definitions with RBAC middleware

**API endpoints:**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/orgs/:orgId/projects` | Create project (Owner/Admin) |
| GET | `/api/v1/orgs/:orgId/projects` | List projects (exclude archived by default) |
| GET | `/api/v1/orgs/:orgId/projects/:projectId` | Get details |
| PATCH | `/api/v1/orgs/:orgId/projects/:projectId` | Update (Owner/Admin) |
| PATCH | `/api/v1/orgs/:orgId/projects/:projectId/archive` | Archive/unarchive (Owner/Admin) |

**Database changes:** Prisma model for `projects` (with `task_counter`). Migration.

**Tests:**
- [x] Integration: create project, list projects, archive project
- [x] Integration: RBAC (member cannot create/archive)
- [x] Integration: archived projects excluded from default list
- [x] Integration: audit log entries for project mutations
- [x] Integration: cross-org isolation verified

**Verification checklist:**
- [x] Projects are scoped to an org (org_id filter enforced)
- [x] Only Owner/Admin can create and archive
- [x] All members can view
- [x] Audit log entries created
- [x] `task_counter` initialized to 0

**Status:** `COMPLETE` ✅

---

### Phase 5 — Tasks

**Goal:** Users can create, update, assign, and filter tasks within projects.

**Why:** Tasks are the core domain object — the primary thing users interact with daily.

**Prerequisites:** Phase 4 complete. Working projects.

**Key concepts to understand:**
- Atomic task number generation via `$transaction` (increment `task_counter` + create task)
- Status and priority enums
- Assignee validation (must be an active org member)
- Filtering and pagination

**What will be built:**

- [x] `server/src/modules/tasks/` — full module
  - `tasks.validation.ts` — Zod schemas for create, update, params, query filters
  - `tasks.service.ts` — atomic task numbering via $transaction, assignee validation, status/completedAt sync, label management
  - `tasks.controller.ts` — thin controller layer
  - `tasks.routes.ts` — nested under projects (all org members can CRUD tasks)

**API endpoints (org-scoped through project chain):**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/orgs/:orgId/projects/:projectId/tasks` | Create task |
| GET | `/api/v1/orgs/:orgId/projects/:projectId/tasks` | List tasks (filter: status, priority, assignee, label) |
| GET | `/api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId` | Get task details |
| PATCH | `/api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId` | Update task |
| DELETE | `/api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId` | Delete task |

**Database changes:** Prisma model for `tasks`. Migration.

**Tests:**
- [x] Integration: create task → verify `task_number` assigned atomically
- [x] Integration: assignee must be an org member (400 for non-member)
- [x] Integration: filter by status/priority/assignee
- [x] Integration: setting status to `DONE` sets `completed_at`, reverting clears it
- [x] Integration: audit log entries for task mutations
- [x] Integration: cross-org task isolation
- [x] Integration: members can create tasks
- [x] Integration: unassign by setting assigneeId to null
- [x] Integration: delete task

**Verification checklist:**
- [x] `task_number` increments correctly per project (atomic via $transaction)
- [x] Assigning to a non-org-member returns 400
- [x] Status transitions set/clear `completed_at` appropriately
- [x] Filters work correctly
- [x] Audit log entries created for all task mutations

**Status:** `COMPLETE` ✅

---

### Phase 6 — Labels

**Goal:** Org-scoped labels that can be attached to tasks.

**Why:** Labels provide flexible categorization beyond fixed statuses and priorities.

**Prerequisites:** Phase 5 complete. Working tasks.

**Key concepts to understand:**
- Many-to-many relationship via join table (`task_labels`)
- Org-scoped uniqueness (`UNIQUE(org_id, name)`)

**What will be built:**

- [x] `server/src/modules/labels/` — full module
  - `labels.validation.ts` — Zod schemas with hex color validation
  - `labels.service.ts` — org-scoped CRUD with uniqueness enforcement
  - `labels.controller.ts` — thin controller layer
  - `labels.routes.ts` — ADMIN+ for CUD, all members can read
- [x] Task endpoints support `labelIds` on create/update (replace strategy)

**API endpoints:**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/orgs/:orgId/labels` | Create label (Owner/Admin) |
| GET | `/api/v1/orgs/:orgId/labels` | List labels |
| PATCH | `/api/v1/orgs/:orgId/labels/:labelId` | Update label (Owner/Admin) |
| DELETE | `/api/v1/orgs/:orgId/labels/:labelId` | Delete label (Owner/Admin) |

**Database changes:** Prisma models for `labels` and `task_labels`. Migration.

**Tests:**
- [x] Integration: CRUD labels, attach/detach from tasks
- [x] Integration: label names unique within org (409 on duplicate)
- [x] Integration: deleting a label cascades to task_labels associations
- [x] Integration: RBAC (member cannot create/update/delete labels)
- [x] Integration: cross-org label isolation (same name allowed in different orgs)
- [x] Integration: default color assigned when not provided
- [x] Integration: activity log entries for label mutations

**Verification checklist:**
- [x] Labels are org-scoped
- [x] Tasks can have multiple labels; labels can be on multiple tasks
- [x] Only Owner/Admin can manage labels
- [x] Deleting a label cascades to task_labels

**Status:** `COMPLETE` ✅

---

### Phase 7 — Comments

**Goal:** Users can add threaded comments on tasks.

**Why:** Comments enable collaboration and discussion on work items.

**Prerequisites:** Phase 5 complete. Working tasks.

**Key concepts to understand:**
- Self-referencing FK (`parent_id` → `comments.id`) for one-level threading
- Only comment author can edit their own comment
- Owner/Admin can delete any comment; members can delete their own

**What will be built:**
**What will be built:**

- [x] `server/src/modules/comments/` — full module
  - `comments.validation.ts` — Zod schemas for create (body + optional parentId), update (body), params
  - `comments.service.ts` — full CRUD with tenant isolation (task→project→org chain), one-level threading enforcement, RBAC for edit/delete (author or OWNER/ADMIN), transactional activity logging
  - `comments.controller.ts` — thin controller layer
  - `comments.routes.ts` — nested under tasks (all org members can CRUD; RBAC in service layer)
- [x] `client/src/components/TaskComments.tsx` — comment UI in task detail slide-out
  - Markdown rendering via `react-markdown` + `rehype-sanitize`
  - Comment list with threaded replies (one level)
  - Author display with avatar initial
  - Relative timestamps with full-date tooltip
  - Edited indicator
  - Inline edit with cancel
  - Delete with confirmation
  - Reply action with reply indicator
  - Loading, empty, and error states
- [x] Task detail slide-out updated to include `TaskComments` component

**API endpoints (org-scoped through project→task chain):**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId/comments` | Add comment |
| GET | `/api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId/comments` | List comments (threaded) |
| PATCH | `/api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId/comments/:commentId` | Edit (own, or Owner/Admin) |
| DELETE | `/api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId/comments/:commentId` | Delete (own, or Owner/Admin) |

**Database changes:** Prisma model for `comments` (already existed from Phase 1 schema).

**Tests:**
- [x] Integration: create comment — authenticated member can create
- [x] Integration: unauthenticated request rejected
- [x] Integration: invalid (empty) body rejected
- [x] Integration: reply to top-level comment accepted (parentId from same task)
- [x] Integration: reply to a reply rejected (one level threading only)
- [x] Integration: parent comment from different task rejected
- [x] Integration: list comments — returns threaded structure with replies nested
- [x] Integration: comments from different task not returned
- [x] Integration: author can edit own comment — `is_edited` becomes true
- [x] Integration: unauthorized user cannot edit another user's comment
- [x] Integration: org owner/admin can moderate (edit) any comment
- [x] Integration: author can delete own comment
- [x] Integration: unauthorized deletion rejected
- [x] Integration: parent deletion cascades to replies
- [x] Integration: cross-org comment creation rejected (user not in org → 403)
- [x] Integration: cross-org comment reading rejected (task not found → 404)
- [x] Integration: cross-org comment editing rejected (task not found → 404)
- [x] Integration: comment from another task cannot be edited via wrong taskId (404)

**Verification checklist:**
- [x] Comments are scoped to a task (via verifyTaskInOrg → task→project→org chain)
- [x] Replies reference a parent comment (one level only — parent must have `parentId = null`)
- [x] `is_edited` flag is set on edit
- [x] Proper authorization for edit/delete (author + OWNER/ADMIN moderation)
- [x] Markdown stored as-is in database, rendered with `react-markdown` + `rehype-sanitize` on frontend
- [x] Activity log entries written synchronously in same transaction for all comment mutations
- [x] Cross-organization tenant isolation verified through 4 dedicated test cases
- [x] Server TypeScript typecheck passes (0 errors)
- [x] Client TypeScript typecheck passes (0 errors)
- [x] Client production build succeeds
- [x] Full test suite: 86 tests passed across 7 test files (0 failures)

**Status:** `✅ COMPLETE`

**Completed Work Summary:**
- **What was implemented:** Full comment module (backend + frontend) supporting one-level threaded replies, Markdown content with XSS-safe rendering, author-only editing (with OWNER/ADMIN moderation), cascading deletion of replies, and strict cross-org tenant isolation verified through task→project→org chain.
- **Important authorization rules:** Comment author can edit/delete their own comments. OWNER and ADMIN can edit/delete any comment in their org (moderation). All org members can create comments and read comments. Unauthenticated and non-member requests are rejected. Comments cannot be nested deeper than one reply level.
- **Important files/modules:** `server/src/modules/comments/comments.service.ts`, `server/src/modules/comments/comments.controller.ts`, `server/src/modules/comments/comments.routes.ts`, `server/src/modules/comments/comments.validation.ts`, `client/src/components/TaskComments.tsx`, `client/src/pages/ProjectPage.tsx` (updated).
- **Tests added:** `server/tests/integration/comments.test.ts` (20 new tests — covering create, list, edit, delete, threading, RBAC, and cross-org isolation).
- **Verification performed:** Server typecheck (0 errors), client typecheck (0 errors), client production build (success), full test suite (86 tests passed across 7 files including all existing phase tests + new comment tests).

---

### Phase 8 — Notifications

**Goal:** In-app notifications for key events (task assigned, comment added, invitation received).

**Why:** Users need to know when something relevant happens without manually checking every project.

**Prerequisites:** Phase 5 and Phase 7 complete. Tasks and comments exist.

**Key concepts to understand:**
- Notification creation triggered by service-layer events (task assignment, comment creation, invitation)
- Notifications are per-user records in the database
- Socket.IO delivery is added in Phase 11

**What will be built:**

- [x] `server/src/modules/notifications/` — full module
  - `notifications.types.ts` — centralized notification type constants and typed payload interfaces (`task_assigned`, `comment_added`, `invitation_received`), designed for future BullMQ fan-out extension
  - `notifications.validation.ts` — Zod schemas for list (page, limit, unreadOnly filter) and notification ID params
  - `notifications.service.ts` — create, list (paginated, ordered, filterable), unread count, mark-one-read, mark-all-read — all queries enforce `userId` ownership at the DB level
  - `notifications.controller.ts` — thin controller; userId derived from `req.user` (never from request body/params)
  - `notifications.routes.ts` — mounted at `/api/v1/notifications` with authentication and CSRF protection
- [x] `client/src/components/NotificationBell.tsx` — notification bell component with:
  - Unread count badge (red dot with count, max 99+)
  - Dropdown popover with notification list
  - Notification icons by type (📋 task, 💬 comment, ✉️ invitation)
  - Relative timestamps with readable format
  - Visual distinction between read/unread notifications
  - Mark individual notification as read (click)
  - Mark all as read button
  - Loading, empty, and error states
  - TanStack Query for server state with 30s polling for unread count
- [x] `client/src/pages/DashboardPage.tsx` — header updated with NotificationBell
- [x] `client/src/pages/ProjectPage.tsx` — header updated with NotificationBell
- [ ] Notification creation hooks in task, comment, and member services (deferred to BullMQ phase for async fan-out)

**API endpoints:**

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/notifications` | List notifications (paginated, filterable by unread) |
| GET | `/api/v1/notifications/unread-count` | Get unread count for badge |
| PATCH | `/api/v1/notifications/:notificationId/read` | Mark as read (idempotent) |
| POST | `/api/v1/notifications/read-all` | Mark all as read |

**Database changes:** Prisma model for `notifications` already existed from Phase 1 schema with `@@index([userId, isRead, createdAt(sort: Desc)])`.

**Tests:**
- [x] Integration: empty list for new user
- [x] Integration: unauthenticated request rejected
- [x] Integration: returns only notifications belonging to authenticated user
- [x] Integration: newest notifications first
- [x] Integration: pagination works (page, limit, totalPages)
- [x] Integration: unread-only filtering works
- [x] Integration: unread count returns correct count for authenticated user
- [x] Integration: user can mark own notification as read
- [x] Integration: marking already-read notification is safe (idempotent)
- [x] Integration: another user cannot mark someone else's notification as read (403)
- [x] Integration: 404 for non-existent notification
- [x] Integration: mark-all-read marks only current user's unread notifications
- [x] Integration: mark-all-read does not affect other users' notifications
- [x] Integration: mark-all-read is safe with zero unread
- [x] Integration: User B cannot read User A notifications via list
- [x] Integration: User B cannot mark User A notification via mark-read
- [x] Integration: User B cannot affect User A notifications through read-all

**Verification checklist:**
- [x] All notification queries enforce `userId` ownership at the database level
- [x] Unread count is accurate (verified via dedicated endpoint and filtering)
- [x] Pagination works with correct metadata (page, limit, total, totalPages)
- [x] Read/unread state persists correctly
- [x] Mark-read is idempotent
- [x] Notification types are centralized and extensible
- [x] `createNotification()` service method is designed for future BullMQ job integration
- [x] Server TypeScript typecheck passes (0 errors)
- [x] Client TypeScript typecheck passes (0 errors)
- [x] Client production build succeeds
- [x] Prisma schema remains valid
- [x] Full test suite: 103 tests passed across 8 test files (0 failures)

**Status:** `✅ COMPLETE`

**Completed Work Summary:**
- **What was implemented:** Full notification module (backend + frontend) with REST API for list (paginated, filterable), unread count, mark-one-read (idempotent), and mark-all-read. Frontend notification bell with dropdown popover added to both DashboardPage and ProjectPage headers. All queries enforce strict user-scoped ownership at the database level.
- **Important design decisions:** Notification types are centralized in `notifications.types.ts` with typed payload interfaces, designed so future BullMQ jobs can call `createNotification()` without refactoring. Notification creation hooks in other services are intentionally deferred to the BullMQ phase for proper async fan-out. Frontend uses TanStack Query with 30s polling for unread count until Socket.IO phase adds real-time delivery.
- **Key files:** `server/src/modules/notifications/notifications.service.ts`, `server/src/modules/notifications/notifications.types.ts`, `server/src/modules/notifications/notifications.routes.ts`, `client/src/components/NotificationBell.tsx`.
- **Tests added:** `server/tests/integration/notifications.test.ts` (17 new tests — covering list, pagination, ordering, filtering, unread count, mark-read, mark-all-read, and 3 explicit ownership isolation tests).
- **Verification performed:** Server typecheck (0 errors), client typecheck (0 errors), client production build (success), Prisma schema valid, full test suite (103 tests passed across 8 files including all existing phase tests).

---

### Phase 9 — Redis Caching

**Goal:** Cache hot-path queries in Redis to reduce database load.

**Why:** Frequently accessed data (org memberships, task stats, unread counts) can be served from cache to improve response times, especially given Neon Free's latency.

**Prerequisites:** Phases 1–8 complete. Redis connection established in Phase 1.

**Key concepts to understand:**
- Cache-aside pattern (read-through with explicit invalidation)
- Redis key design and TTLs
- Cache invalidation on writes (delete key after mutation)
- Monitoring Redis command usage on Upstash

**What will be built:**

**What will be built:**

- [x] `server/src/shared/cache.ts` — Cache utility module with:
  - `cache.get<T>(key)` — returns parsed value or null on miss/error/malformed JSON
  - `cache.set<T>(key, value, ttlSeconds)` — JSON serialization with Redis EX
  - `cache.delete(...keys)` — delete one or more deterministic keys
  - `cacheKeys` — deterministic key builder functions
  - `cacheTTL` — TTL constants for each cache type
  - All operations wrapped in try/catch — Redis failures logged but never crash requests
- [x] Cache-aside reads in services:
  - `organizations.service.ts` — `listUserOrganizations()` cached with `user:{userId}:orgs` (5 min TTL)
  - `members.service.ts` — `listMembers()` cached with `org:{orgId}:members` (5 min TTL)
  - `tasks.service.ts` — `getTaskStats()` new function with `project:{projectId}:task-stats` (2 min TTL)
  - `notifications.service.ts` — `getUnreadCount()` cached with `user:{userId}:unread-count` (1 min TTL)
- [x] Cache invalidation on mutation paths:
  - `createOrganization()` → invalidates `user:{userId}:orgs` + `org:{orgId}:members`
  - `updateOrganization()` → invalidates `user:{actorId}:orgs`
  - `softDeleteOrganization()` → invalidates `user:{actorId}:orgs` + `org:{orgId}:members`
  - `acceptInvitation()` → invalidates `user:{userId}:orgs` + `org:{orgId}:members`
  - `changeMemberRole()` → invalidates `org:{orgId}:members` + `user:{memberId}:orgs`
  - `removeMember()` → invalidates `org:{orgId}:members` + `user:{memberId}:orgs`
  - `createTask()` / `updateTask()` / `deleteTask()` → invalidates `project:{projectId}:task-stats`
  - `createNotification()` / `markAsRead()` / `markAllAsRead()` → invalidates `user:{userId}:unread-count`
- [x] New API endpoint:
  - `GET /api/v1/orgs/:orgId/projects/:projectId/tasks/stats` — returns cached task status breakdown

**Tests:**
- [x] Cache utility: Redis set/get/ttl/delete operations
- [x] Org list cache: populate on first request, serve from cache, invalidate on create
- [x] Member list cache: populate on first request
- [x] Task stats cache: populate + invalidate on create/update/delete
- [x] Notification unread count cache: populate + invalidate on mark-read/mark-all-read
- [x] Tenant isolation: User B cannot receive User A's cached org data or unread count
- [x] Graceful fallback: malformed JSON in cache treated as miss, DB query succeeds

**Verification checklist:**
- [x] Cache hits reduce DB queries (observable in debug logs: `cache hit` / `cache miss` / `cache invalidated`)
- [x] Mutations invalidate the correct cache keys (verified via Redis key assertions in tests)
- [x] Expired cache entries result in a fresh DB query (TTL-based expiry)
- [x] Application works correctly with malformed cache data (treated as miss, DB fallback)
- [x] Tenant isolation: each user/org/project has its own scoped cache key
- [x] Server TypeScript typecheck passes (0 errors)
- [x] Client production build succeeds
- [x] Full test suite: 122 tests passed across 9 test files (0 failures)

**Status:** `✅ COMPLETE`

**Completed Work Summary:**
- **What was implemented:** Complete Redis cache-aside layer with a lightweight cache utility (`server/src/shared/cache.ts`) providing get/set/delete with graceful error handling, deterministic key builders, and TTL constants. Four cache domains implemented: user orgs (5 min), org members (5 min), project task stats (2 min), notification unread count (1 min). All mutation paths include cache invalidation after successful DB commits. New `/tasks/stats` endpoint provides cached task status breakdown per project.
- **Important design decisions:** Redis is strictly an optimization layer — all operations are wrapped in try/catch so Redis failures never crash API requests. Malformed cached JSON is treated as a cache miss and the bad entry is cleaned up. Mutation order is always DB commit → cache invalidate. No broad pattern deletion (e.g., `KEYS *`) — only deterministic key deletion. Short TTLs serve as a safety net against missed invalidations.
- **Key files:** `server/src/shared/cache.ts` (cache utility), `server/src/modules/organizations/organizations.service.ts` (user orgs cache), `server/src/modules/members/members.service.ts` (org members cache), `server/src/modules/tasks/tasks.service.ts` (task stats cache + getTaskStats), `server/src/modules/notifications/notifications.service.ts` (unread count cache), `server/tests/integration/cache.test.ts` (19 new tests).
- **Tests added:** `server/tests/integration/cache.test.ts` (19 new tests — covering cache utility, org list cache, member cache, task stats cache with CRUD invalidation, unread count cache with read invalidation, tenant isolation, and malformed JSON graceful fallback).
- **Verification performed:** Server typecheck (0 errors), client production build (success), full test suite (122 tests passed across 9 files including all existing phase tests + 19 new cache tests).

---

### Phase 10 — BullMQ + Transactional Email

**Goal:** Background job processing for email dispatch and notification fan-out.

**Why:** Email sending is slow and can fail — it must not block the API response. Notification fan-out (creating N notification records for N users) benefits from async processing.

**Prerequisites:** Phase 9 complete. Redis working.

**Key concepts to understand:**
- BullMQ queue/worker architecture
- In-process workers (same Node.js process)
- Email provider abstraction (interface + implementations)
- Retry policies and dead-letter queues
- HTML email templates (simple string interpolation)

**What will be built:**

- [x] `server/src/jobs/queues.ts` — queue definitions (`emailQueue`, `notificationQueue`) with retry & eviction policies
- [x] `server/src/jobs/workers/email.worker.ts` — in-process worker handling invitation & password reset emails
- [x] `server/src/jobs/workers/notification.worker.ts` — in-process worker creating notifications & invalidating unread count cache
- [x] `server/src/jobs/index.ts` — worker lifecycle manager (`startWorkers`, `stopWorkers`) with duplicate start guards
- [x] `server/src/email/email.provider.ts` — provider interface (`SendEmailOptions`, `EmailProvider`)
- [x] `server/src/email/resend.provider.ts` — production provider via Resend REST API (no SDK needed)
- [x] `server/src/email/console.provider.ts` — development provider logging to stdout
- [x] `server/src/email/templates/invitation.ts` — HTML invitation template with token link
- [x] `server/src/email/templates/password-reset.ts` — HTML password reset template with token link
- [x] Wire invitation, password-reset, task assignment, and comment flows to enqueue background jobs

**Tests:**
- [x] Unit: email template rendering (`passwordResetEmail`, `invitationEmail`)
- [x] Unit: email provider behavior (`ConsoleEmailProvider`, factory, `ResendEmailProvider` validation)
- [x] Unit: queue configuration & retry policies (attempts, backoff, retention)
- [x] Unit: worker lifecycle manager (`startWorkers` idempotency, `stopWorkers`)
- [x] Integration: enqueue email jobs → worker processes → console provider handles output
- [x] Integration: enqueue notification job → worker processes → DB notification record created
- [x] Integration: forgot-password flow enqueues password reset email job
- [x] Integration: invite-member flow enqueues invitation email job & fan-out notification
- [x] Integration: task creation with assignee enqueues `task_assigned` notification job
- [x] Integration: task reassignment on update enqueues `task_assigned` notification job
- [x] Integration: comment creation on assigned task enqueues `comment_added` notification job

**Verification checklist:**
- [x] Invitation creates a BullMQ job → worker sends email (logged in dev)
- [x] Password reset creates a BullMQ job → worker sends email (logged in dev)
- [x] Task assignment and comment addition create BullMQ notification jobs
- [x] Failed jobs are retried according to policy (exponential backoff)
- [x] Retention limits prevent unbounded Redis memory consumption on Upstash Free
- [x] Email provider is swappable via environment config (`console` vs `resend`)
- [x] Server TypeScript typecheck passes (0 errors)
- [x] Client TypeScript typecheck and build pass (0 errors)
- [x] Full test suite: 140 tests passed across 10 test files (0 failures)

**Status:** `✅ COMPLETE`

**Completed Work Summary:**
- **What was implemented:** In-process BullMQ queue architecture (`email` and `notifications` queues) using the shared ioredis connection (`maxRetriesPerRequest: null`). Two dedicated workers (`email.worker.ts` and `notification.worker.ts`) started alongside the Express app in `server.ts` and gracefully terminated on SIGTERM/SIGINT. Swappable email provider abstraction (`ConsoleEmailProvider` for dev, `ResendEmailProvider` via direct REST API for production). HTML email templates for invitations and password resets. Background fan-out notifications for task assignments (create & update) and task comments.
- **Important architectural decisions:** Workers run in-process within the Express server to stay within the Render Free tier (single web service, $0 infrastructure). BullMQ job retention is capped (`removeOnComplete: 50`, `removeOnFail: 100`) to strictly respect Upstash Free's 10,000 commands/day limit. Raw tokens are passed directly in job payloads (never logged) to construct destination URLs asynchronously.
- **Key files:** `server/src/jobs/queues.ts`, `server/src/jobs/workers/email.worker.ts`, `server/src/jobs/workers/notification.worker.ts`, `server/src/jobs/index.ts`, `server/src/email/email.provider.ts`, `server/src/email/console.provider.ts`, `server/src/email/resend.provider.ts`, `server/src/email/templates/`, `server/tests/integration/jobs.test.ts`.
- **Tests added:** `server/tests/integration/jobs.test.ts` (18 new tests — covering templates, providers, queue policies, worker lifecycle, job execution, and all service event enqueue paths).
- **Verification performed:** Server typecheck (0 errors), client production build (0 errors), full test suite (140 tests passed across 10 files including all existing phase tests + 18 new BullMQ/email tests).

**Phase 10 re-audit (performed before Phase 11):** Queues, retry/backoff policies, retention caps, worker lifecycle, in-process placement, email provider abstraction, token-hash-only storage, generic forgot-password behaviour, notification fan-out through `createNotification()`, and unread-count cache invalidation were all re-verified against the code and found correct. One genuine defect was found and fixed:

- **Redis startup race in `server/src/server.ts`.** `jobs/queues.ts` constructs both BullMQ queues at import time, and BullMQ immediately connects the shared lazy ioredis client it is handed. `start()` then called `redis.connect()` on a client already in `connecting` state, which makes ioredis throw `Redis is already connecting/connected` and crashes the boot with a `FATAL`. Replaced with an `ensureRedisConnected()` helper that connects only from the `wait` state and otherwise waits for `ready`. No other Phase 10 changes were made.

---

### Phase 11 — Socket.IO Real-Time

**Goal:** Live updates for task changes, comments, and notifications without page refresh.

**Why:** Real-time feedback makes the tool feel collaborative and responsive.

**Prerequisites:** Phase 8 (notifications) and Phase 10 (BullMQ) complete.

**Key concepts to understand:**
- Socket.IO server setup (attached to existing HTTP server)
- Room management (join/leave based on user navigation)
- Cookie-based WebSocket authentication
- Emitting events from service-layer code after successful mutations
- Client-side Socket.IO integration with React Context

**What will be built:**

- [x] `server/src/websocket/events.ts` — room-name builders, handshake error codes, typed event contract
- [x] `server/src/websocket/socket.ts` — Socket.IO server setup, emit helpers, graceful close
- [x] `server/src/websocket/middleware.ts` — cookie-based handshake auth
- [x] `server/src/websocket/handlers/project.handlers.ts` — `join:project`, `leave:project`
- [x] Emit calls added to task, comment, and members services + the notification worker
- [x] `client/src/contexts/SocketContext.tsx`
- [x] `client/src/hooks/useSocket.ts` — `useSocket`, `useSocketEvent`, `useProjectRoom`
- [x] Client-side event listeners in ProjectPage, TaskComments, NotificationBell, DashboardPage

**Tests:**
- [x] Integration: connect with valid cookie, join room, receive emitted event
- [x] Integration: connect without cookie → rejected
- [x] Manual verification: two authenticated sessions, task created in one appears in the other

**Verification checklist:**
- [x] Socket.IO connects successfully using cookie auth
- [x] Joining a project room requires org membership (verified server-side)
- [x] Task CRUD events are received by other clients in the same project room
- [x] Comment events are received by other clients
- [x] Notification events are received in the user's personal room
- [x] Disconnection/reconnection works cleanly
- [x] No `@socket.io/redis-adapter` — rooms remain in process memory
- [x] Server typecheck, client typecheck, client build, Prisma validate all pass
- [x] Full test suite: 163 tests passed across 11 test files (0 failures)

**Status:** `✅ COMPLETE`

**Completed Work Summary:**

- **Socket.IO server setup.** A single `Server` attached to the existing Express HTTP server at `/socket.io`. No separate process, no separate service, and deliberately no Redis adapter — rooms live in this process's memory, and Redis stays dedicated to caching and BullMQ. `closeSocketIO()` is wired into the existing shutdown sequence.
- **Socket authentication.** `authenticateSocket` parses the handshake `Cookie` header (Socket.IO bypasses the Express middleware stack, so `cookie-parser` has not run) and verifies the `access_token` JWT. Verification was extracted into `verifyAccessToken()` in `auth.service.ts` and is now shared by the HTTP `authenticate` middleware and the socket middleware, so there is exactly one verification path and no duplicated token logic. Identity always comes from the verified JWT; the client never supplies a user ID. Rejections use distinguishable codes: `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`. Tokens are never logged.
- **User rooms.** Every authenticated socket joins `user:<userId>`, derived from the JWT, so a client cannot subscribe to another user's room.
- **Project rooms.** `join:project` validates the UUID, then resolves project → organization (not soft-deleted) → active membership before joining `project:<projectId>`; it acknowledges with `{ ok }` so the client knows the outcome. Knowing a project UUID is never sufficient. `leave:project` performs no database work.
- **Task events.** `task:created`, `task:updated`, `task:deleted` are emitted from `tasks.service.ts` to `project:<projectId>` only after the Prisma transaction commits and the task-stats cache is invalidated. Payloads carry `orgId`, `projectId`, and the formatted task (or `taskId` on delete). Tasks are never created or mutated over WebSockets.
- **Comment events.** `comment:created`, `comment:updated`, `comment:deleted` are emitted from `comments.service.ts` to the project room after commit, carrying `taskId` so a client can sync exactly one thread.
- **Notification events.** The existing Phase 10 notification worker now emits `notification:new` to `user:<recipientId>` using the record returned by `createNotification()`, after the row is committed. Unread-count cache invalidation remains in the notification service and is not duplicated in websocket code. The 30-second unread-count poll remains as a fallback.
- **Membership events.** `member:added` (on invitation accept) and `member:removed` (on member removal) resolve the organization's current active members at emit time and deliver through their personal rooms. This avoids a separate org-room lifecycle that could drift out of sync, and makes cross-organization leakage structurally impossible. Removal additionally evicts the removed user's sockets from that organization's project rooms, so a mid-session removal cannot keep streaming task and comment events.
- **Reconnection behaviour.** One `SocketProvider` owns the connection for the session: it opens after authentication and closes on logout. Socket.IO retries transport-level drops on its own. An auth-related `connect_error` stops the retry loop, performs a single-flight `POST /api/v1/auth/refresh` (de-duplicating concurrent attempts), reconnects on success, and falls back to the existing logout behaviour after 3 failed recoveries — so there are no infinite reconnect loops, no duplicate refresh calls, and no second auth system. Project rooms the session had joined are replayed on reconnect and re-authorized server-side.
- **TanStack Query synchronization.** Socket events are treated purely as sync signals. `notification:new` invalidates the `['notifications']` queries used by the bell. `task:*` refetches the project's task list and keeps an open task slide-out in sync. `comment:*` refetches only the matching task's thread. `member:*` refetches the member list for the current org, and the workspace list only when the affected user is the current user. No Redux/Zustand/global duplicate store was introduced, and no event triggers a full application refetch.
- **Missed event recovery.** REST remains authoritative. There is no event history, replay, or persistent websocket message; reopening a project refetches current state normally.
- **Security rules.** Unauthenticated, malformed, and expired handshakes are refused; user identity is JWT-derived; project rooms require active org membership through the organization chain; soft-deleted organizations are excluded; failed mutations emit nothing because emits happen only after a successful commit; membership events never cross organizations.
- **Logging.** Existing Pino logger with `socketId`, `userId`, `projectId`, `orgId`, and event name at `debug` for high-frequency lifecycle events and `warn` for denied joins. No tokens, passwords, or raw invitation/reset tokens are logged.
- **Key files:** `server/src/websocket/events.ts`, `server/src/websocket/socket.ts`, `server/src/websocket/middleware.ts`, `server/src/websocket/handlers/project.handlers.ts`, `server/src/modules/auth/auth.service.ts` (`verifyAccessToken`), `server/src/middleware/authenticate.ts`, `server/src/modules/tasks/tasks.service.ts`, `server/src/modules/comments/comments.service.ts`, `server/src/modules/members/members.service.ts`, `server/src/jobs/workers/notification.worker.ts`, `server/src/server.ts`, `client/src/contexts/SocketContext.tsx`, `client/src/hooks/useSocket.ts`, `client/src/main.tsx`, `client/src/pages/ProjectPage.tsx`, `client/src/pages/DashboardPage.tsx`, `client/src/components/TaskComments.tsx`, `client/src/components/NotificationBell.tsx`.
- **Tests added:** `server/tests/integration/websocket.test.ts` (23 new tests — handshake authentication incl. missing/invalid/expired tokens and JWT-derived identity; user-room isolation; project-room authorization incl. cross-org, non-existent, malformed, and soft-deleted-org cases; task create/update/delete events plus no-emit-on-failure and no-leak cases; comment create/update/delete events plus no-emit on unauthorized edit; notification delivery to the intended recipient only with the record persisted first; membership events with cross-org leakage and project-room eviction checks). `socket.io-client` was added to server devDependencies to drive real handshakes without any external service.
- **Verification performed:** Server typecheck (0 errors), client typecheck (0 errors), client production build (success), `prisma validate` (valid), full test suite (163 passed across 11 files). Graceful shutdown confirmed via SIGTERM to the container: `Shutting down... → Socket.IO closed → All BullMQ workers stopped → clean exit`. Two-session verification against the running dev server confirmed all 7 scenarios: task create, status change, comment add, comment edit/delete, assignment notification, unread-count consistency with REST/Redis, and no cross-organization event leakage.

---

### Phase 12 — Testing & Hardening

**Goal:** Close the invitation-email dead-end, verify Resend configuration, and audit production-readiness without redesigning completed phases.

**Why:** An emailed invitation that lands on the dashboard cannot be accepted. Production email, cookies, env validation, and SPA serving must be correct before deployment.

**Prerequisites:** Phases 1–11 complete.

**What was built:**

- [x] Frontend route `/invitations/:token/accept` aligned with the email worker URL
- [x] `AcceptInvitationPage` reusing `POST /api/v1/invitations/:token/accept` (no duplicate business logic)
- [x] Unauthenticated users redirected to login with the invitation path preserved
- [x] Success, already-member, wrong-account, expired/invalid/declined, and loading states
- [x] Pending-invitations banner wording updated (raw token cannot be shown; only the emailed link can accept)
- [x] Resend env chain: `EMAIL_PROVIDER` / `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `APP_URL`
- [x] Production env guards: JWT secret, public `APP_URL`, non-localhost `REDIS_URL`, `EMAIL_PROVIDER=resend`
- [x] SPA fallback on Express so a direct invitation URL serves `index.html` without swallowing `/api`
- [x] Request-log redaction for invitation path tokens, password-reset query tokens, and cookies
- [x] Cookie `clearCookie` options match `Set-Cookie` (`httpOnly`, `secure` in production, `SameSite=Lax`, correct paths)

**Tests:**
- [x] Valid invitation acceptance returns the joined organization
- [x] Invalid, expired, declined, and already-accepted invitations
- [x] Unauthenticated 401 (invitation remains PENDING)
- [x] Wrong-account 403; no cross-organization membership
- [x] No token/hash leakage in API bodies or pino serializers
- [x] Decline still works
- [x] Email URL ↔ React route alignment
- [x] Resend provider uses `RESEND_API_KEY` / `RESEND_FROM_EMAIL` and never logs the key
- [x] Production env rejects localhost APP_URL/Redis, placeholder JWT, and console email
- [x] SPA serves HTML for `/invitations/:token/accept`; unknown `/api` stays JSON
- [x] Access cookie `Path=/`, refresh cookie `Path=/api/v1/auth/refresh`, HttpOnly, SameSite=Lax

**Verification checklist:**
- [x] Invitation email URL and frontend route match
- [x] Acceptance uses the existing members service
- [x] Resend is selected only when `EMAIL_PROVIDER=resend`; console remains the local default
- [x] API key is server-side only (never `VITE_`, never returned by an API)
- [x] Server typecheck, client typecheck, client production build, `prisma validate` pass
- [x] Full test suite: 193 tests passed across 12 files (0 failures)

**Status:** `✅ COMPLETE`

**Completed Work Summary:**
- **Invitation email route fixed.** `AcceptInvitationPage` is mounted at `/invitations/:token/accept` (protected). After login/register the `redirect` query returns the user to that URL. The page POSTs to the existing acceptance endpoint, sets org context from the response, and shows backend-mapped outcomes (400 unusable, 403 wrong account, 409 already a member). A second click of an already-accepted link now returns 409 for the intended member. The dashboard banner no longer says “Check invitation email link to accept”; it tells the user to use the emailed **Accept Invitation** button, which is the only place the raw token exists.
- **Resend configuration verified.** `config.EMAIL_PROVIDER` → `createEmailProvider()` → `ResendEmailProvider` reads `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (fallback `SprintNest <onboarding@resend.dev>`). The email worker builds invitation and password-reset URLs from `APP_URL`. Local `.env` keeps `EMAIL_PROVIDER=console` so development does not send live mail; production validation requires `EMAIL_PROVIDER=resend` plus a key. `.env.example` documents placeholders only — the real key is not copied there.
- **Production hardening.** Production rejects placeholder/short JWT secrets, localhost `APP_URL` and `REDIS_URL`, and the console email provider. Cookies: httpOnly, Secure in production, SameSite=Lax, access `Path=/` (required for Socket.IO), refresh `Path=/api/v1/auth/refresh`; `clearCookie` uses the same flags. CSRF custom header unchanged. No CORS (same-origin). Auth endpoints remain rate-limited. Helmet security headers remain. `trust proxy` is set in production. `ensureRedisConnected()` still avoids the BullMQ/ioredis double-connect race. SPA static + `index.html` fallback is registered after `/api` 404. Socket.IO is unchanged (in-memory rooms, no Redis adapter). Prisma continues to use the existing schema/`db push` approach — there is no `prisma/migrations` directory yet (needed at deploy time in Phase 13).
- **Known limitation unchanged:** notification jobs remain at-least-once; a BullMQ retry after a partial failure can create a duplicate notification row. No outbox or idempotency layer was added.
- **Key files:** `client/src/pages/AcceptInvitationPage.tsx`, `client/src/lib/redirect.ts`, `client/src/App.tsx`, `client/src/pages/LoginPage.tsx`, `client/src/pages/RegisterPage.tsx`, `client/src/pages/DashboardPage.tsx`, `server/src/modules/members/members.service.ts`, `server/src/modules/auth/auth.controller.ts`, `server/src/config/index.ts`, `server/src/app.ts`, `server/src/email/resend.provider.ts`, `server/.env.example`, `server/tests/integration/invitations.test.ts`.
- **Tests added:** `server/tests/integration/invitations.test.ts` (invitation acceptance contract, SPA/API boundary, env/Resend configuration).
- **Verification performed:** Targeted invitation + auth tests (45 passed). Full suite 193 passed / 12 files. Server typecheck, client typecheck, client production build, Prisma validate — all succeeded.

#### Follow-up — Invited-user onboarding and organization pending invitations

**New-user flow.** The emailed link `/invitations/:token/accept` is no longer behind the login wall. The page loads `GET /api/v1/invitations/:token` (token holder only). If that email has no account, the page shows Create Account with the invited email read-only. `POST /api/v1/invitations/:token/register` ignores a mismatched email, creates the user with the invitation's email, and accepts the invitation in one transaction (membership + `ACCEPTED` + `member.joined`). The response sets the same access/refresh cookies as register/login. The client stores the returned organization as the current workspace and offers **Go to workspace**.

**Existing-user flow.** If the invited email already has an account, the page links to `/login?redirect=/invitations/:token/accept`. After sign-in, the page calls the existing `POST /api/v1/invitations/:token/accept`. The email-match 403 and Wrong Account UI are unchanged.

**Organization pending invitations.** Owner and Admin see **Pending Invitations** on the workspace dashboard (invitations this organization sent). This is separate from the amber banner, which is still `GET /api/v1/invitations/pending` (invitations received by the signed-in user). New endpoints, all org-scoped and Owner/Admin only:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/orgs/:orgId/members/invitations` | List pending invitations sent by this org |
| POST | `/api/v1/orgs/:orgId/members/invitations/:invitationId/resend` | Replace the token hash, extend expiry, enqueue the existing invitation email |
| POST | `/api/v1/orgs/:orgId/members/invitations/:invitationId/cancel` | Withdraw a pending invitation |

Responses never include the raw token or `tokenHash`. Resend does not return the new token. The list is a TanStack Query (`org-pending-invitations`) and is invalidated after invite, resend, and cancel.

**Verification performed:** `invitations.test.ts` 39 passed. Full server suite 202 passed / 12 files. Server typecheck, client production build (`tsc` + Vite), and `prisma validate` succeeded.

**Known limitations:**
- The schema has no `CANCELLED` status. Admin cancel sets `DECLINED` (the existing terminal state that blocks acceptance) and writes an `invitation.cancelled` activity log. An invitee decline uses the same status.
- The invitation token stays in the URL path and in the login `redirect` query. It is not written to browser storage. Request logs redact token URLs and that referer; they do not redact organization invitation ids.
- Anyone holding the token can see the invited email and whether an account exists. The token is the unguessable credential.
- Accounts created from an invitation are not marked email-verified, same as normal registration.
- Resend enqueues another invitation email and does not enqueue a second in-app notification.
- Notification jobs remain at-least-once. No outbox or idempotency layer was added.

---

### Phase 13 — Deployment

**Goal:** Build the production Docker image, deploy to Render Free, connect to Neon and Upstash, and verify the live application.

**Why:** The application needs to be accessible on the internet to be a portfolio piece and usable by others.

**Prerequisites:** Phase 12 complete. All tests passing.

**Key concepts to understand:**
- Multi-stage Docker builds (builder stage + production stage)
- Render Web Service configuration (env vars, health checks, auto-deploy)
- Neon connection strings (pooler endpoint)
- Upstash Redis connection (TLS)
- Prisma in production (migration deployment strategy)

**What will be built:**

- [ ] Production `Dockerfile` (multi-stage: build client + server → slim runtime image)
- [ ] `.dockerignore`
- [ ] Render deployment configuration
- [ ] GitHub Actions CI workflow (`.github/workflows/ci.yml`)
- [ ] Production environment variable documentation

**Verification checklist:**
- [ ] Docker image builds successfully
- [ ] Application starts and serves the SPA
- [ ] API endpoints respond correctly
- [ ] PostgreSQL (Neon) connection works
- [ ] Redis (Upstash) connection works
- [ ] Socket.IO connections work in production
- [ ] Cookies are set with `Secure` flag
- [ ] Health check endpoint responds (Render uses this to detect readiness)
- [ ] Cold start after sleep is handled gracefully

**Status:** `NOT STARTED`

---

### Phase 14 — Documentation & Portfolio Polish

**Goal:** Make the project presentable as a portfolio piece with a polished README, documentation, and demo-ready state.

**Why:** A portfolio project must communicate its value clearly to reviewers (hiring managers, other developers).

**Prerequisites:** Phase 13 complete. Application deployed.

**What will be built:**

- [ ] `README.md` — project overview, features, tech stack, architecture diagram, screenshots, setup instructions, live demo link
- [ ] `docs/API.md` — API documentation (or generate via Swagger/OpenAPI)
- [ ] `docs/ARCHITECTURE.md` — extracted from this plan, visual diagrams
- [ ] `CONTRIBUTING.md` — development setup guide
- [ ] `.github/` — issue templates, PR template
- [ ] Screenshots / demo GIFs of key features
- [ ] Seed script for demo data
- [ ] License file

**Verification checklist:**
- [ ] README is clear, professional, and includes a live demo link
- [ ] A new developer can clone, run `docker compose up`, and start developing
- [ ] Architecture is explained with diagrams
- [ ] API endpoints are documented
- [ ] Demo data makes the deployed app look populated and professional

**Status:** `NOT STARTED`

---

## 22. Portfolio / GitHub Preparation Checklist

- [ ] Repository has a descriptive name and "About" description
- [ ] README includes: purpose, features, tech stack, architecture, setup, live link
- [ ] Live demo URL works and is populated with seed data
- [ ] Code is clean, well-commented where non-obvious, and consistently formatted
- [ ] No secrets, API keys, or passwords in the repository
- [ ] `.env.example` documents all required environment variables
- [ ] CI badge in README shows passing tests
- [ ] Commit history is clean and uses conventional commit messages
- [ ] License is present (MIT recommended)
- [ ] Topics/tags are set on the GitHub repo (typescript, react, express, postgresql, etc.)

---

## 23. Current Progress

| Phase | Status |
|---|---|
| Phase 0 — Architecture | ✅ COMPLETE |
| Phase 1 — Foundation | ✅ COMPLETE |
| Phase 2 — Authentication | ✅ COMPLETE |
| Phase 3 — Organizations & Membership | ✅ COMPLETE |
| Phase 4 — Projects | ✅ COMPLETE |
| Phase 5 — Tasks | ✅ COMPLETE |
| Phase 6 — Labels | ✅ COMPLETE |
| Phase 7 — Comments | ✅ COMPLETE |
| Phase 8 — Notifications | ✅ COMPLETE |
| Phase 9 — Redis Caching | ✅ COMPLETE |
| Phase 10 — BullMQ + Email | ✅ COMPLETE |
| Phase 11 — Socket.IO | ✅ COMPLETE |
| Phase 12 — Testing & Hardening | ✅ COMPLETE |
| Phase 13 — Deployment | ⬜ NOT STARTED |
| Phase 14 — Portfolio Polish | ⬜ NOT STARTED |
| UI Phase 1 — Application Shell & Navigation | ✅ COMPLETE |
| UI Phase 2 — Feature pages & lists | ✅ COMPLETE |
| UI Phase 3 — Production hardening | ✅ COMPLETE |
| UI polish — Navigation, spacing, workspace refresh | ✅ COMPLETE |

---

## 24. UI Phase 1 — Application Shell & Navigation

**Goal:** Give the signed-in app a production-style responsive shell: top bar, left navigation, and routes for the existing workspace features.

**Scope:** Client only. Authentication, authorization, CSRF, Socket.IO, BullMQ, email, the database, and server security logic are unchanged. Sidebar links are visible to every signed-in member; the API remains the authority for what each role can do. No secrets or server configuration are read by React or Vite.

**What was built:**

- [x] `client/src/components/layout/AppShell.tsx` — authenticated shell with a skip link, sticky top bar, and scrollable main region
- [x] Top bar — SprintNest brand, workspace switcher, + New Workspace, notification bell, account menu, and Sign out
- [x] Sidebar — Dashboard, My Tasks, Projects, Members, Notifications, Activity, Settings, with the current route marked
- [x] Responsive behavior — persistent sidebar from the `md` breakpoint (narrower until `lg`), collapsible focus-trapped drawer below that
- [x] Routes — `/dashboard`, `/my-tasks`, `/projects`, `/members`, `/notifications`, `/activity`, `/settings`
- [x] `/` redirects to `/dashboard`. Project boards stay at `/orgs/:orgId/projects/:projectId`
- [x] Existing workspace actions reused: create workspace, invite, member roles, remove member, sent and received invitations, create project, delete workspace
- [x] Notifications page reuses the existing notifications API and the header bell
- [x] My Tasks aggregates assigned tasks through the existing per-project task list API
- [x] Settings updates display name (`PATCH /api/v1/auth/me`) and, for admins and owners, the workspace name

**Verification checklist:**

- [x] Client TypeScript (`npm run typecheck`) — passed
- [x] Client production build (`npm run build`) — passed
- [x] Existing project board route still mounted inside the shell
- [x] Server integration tests not re-run — this phase does not change server routing or APIs

**Remaining after Phase 1 (addressed in UI Phase 2):**

- Activity list and assigned-task list were added as read-only org-scoped endpoints
- Opening a task still happens on the project board. There is no `/tasks/:taskId` route

**Status:** `COMPLETE`

---

## 25. UI Phase 2 — Feature pages and scalable lists

**Goal:** Give each shell destination a single job, and page the lists that can grow.

**Scope:** The dashboard is an overview. Members, invitations, and workspace deletion stay on their own pages. Two read-only endpoints were added because the existing APIs could not page those lists without loading every project: `GET /api/v1/orgs/:orgId/my-tasks` (caller’s assignments only, inside that org) and `GET /api/v1/orgs/:orgId/activity` (owners and admins, `authorize('ADMIN')`, rows filtered by the membership org). No auth, CSRF, Socket.IO, or secret-handling changes.

**Pages:**

- [x] Dashboard — task summary, my-tasks preview, projects preview, activity preview (owners/admins), notification preview. No member or invitation management
- [x] My Tasks — status and priority filters, server pagination, filter state in the query string
- [x] Projects — full workspace list from the existing endpoint. No pager; a workspace’s project list is one small request
- [x] Members — team, pending invitations, invite, resend, cancel, owner role changes, owner/admin remove. Members do not see those controls. Destructive actions use a confirm dialog
- [x] Notifications — unread filter, server pagination, query string, Socket.IO invalidation plus the existing REST endpoints
- [x] Activity — paginated audit log. The page does not request it unless the current role is owner or admin. The API enforces the same rule and does not return other organizations or invitation tokens
- [x] Settings — Profile (display name), Workspace (rename for owner/admin, delete for owner), Security (sign out and use the existing forgot-password email). No password form and no avatar upload

**Verification checklist:**

- [x] Targeted server tests (`my-tasks`, `activity`) — 7 passed
- [x] Full server suite — exit 0
- [x] Client typecheck and production build — passed
- [x] `prisma validate` — schema valid

**Status:** `COMPLETE`

---

## 26. UI Phase 3 — Production hardening

**Goal:** Make the existing UI safe to ship: stable task URLs, route and access checks, a secret and Socket.IO audit, accessibility fixes, and a smaller initial bundle. No visual redesign and no change to cookie auth, CSRF, tenant checks, BullMQ, Resend, or Socket.IO transport.

**Task deep links:**

- [x] URL `/orgs/:orgId/projects/:projectId/tasks/:taskId` opens the existing board slide-out
- [x] The board and the task URL share one route, so opening or closing a task does not remount the page
- [x] A direct visit loads the task with `GET /api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId`
- [x] That handler already requires organization membership and a project that belongs to the organization. A task from another organization is 404. A non-member is 403. The client does not render a task body until that response succeeds
- [x] Refresh, back, and forward follow the URL. Closing the panel returns to the project URL

**Routing:**

- [x] Sidebar routes, project boards, invitation links, and auth pages still match before the not-found route
- [x] Unknown signed-in URLs render a 404 inside the shell instead of being sent to the dashboard
- [x] Signed-out visits to a protected URL still go to login with the path kept in `redirect`
- [x] Unknown `/api` paths still return JSON. The SPA fallback is registered after that 404 and skips `/api` and `/socket.io`
- [x] A project or task URL restores the workspace switcher to that organization
- [x] List filters and page numbers are history entries, so back and forward restore them

**Audits:**

- [x] Owner, admin, and member controls stay as they were. Role changes and workspace deletion stay owner-only in the UI; the API still enforces them. Activity and invitation management stay hidden from members and rejected by the API
- [x] Client source has no `JWT_SECRET`, `RESEND_API_KEY`, `DATABASE_URL`, `REDIS_URL`, refresh tokens, or invitation hashes. Nothing server-only is prefixed with `VITE_`. Vite `envPrefix` is `VITE_`. Auth stays on cookies; the client does not write tokens to `localStorage` or `sessionStorage`
- [x] One `io()` call site remains in `SocketContext`. Navigation reuses it. Project join still checks membership, and member removal still drops that user's project rooms. No Redis Socket.IO adapter
- [x] Dialogs trap focus and close on Escape. Task cards are buttons. The board is not a second `main` landmark. Narrow member rows and pagination wrap
- [x] Route-level lazy loading splits pages out of the main chunk. Comment markdown loads only when a task panel opens

**Intentional limitations:**

- Projects and members stay one unpaged workspace request
- There is no in-app password change or avatar upload; security settings still use the existing reset email
- The client may hide a control, but a direct API call is still authorized on the server
- Kanban columns scroll sideways inside the board; that scroll is the layout, not a page overflow bug

**Verification:**

- [x] Task deep-link tests in `tasks.test.ts` — file passed, 18 tests, including member access, missing task, non-member 403, and the existing cross-organization 404
- [x] Full server suite — 14 files, 212 tests, exit 0
- [x] Client typecheck — exit 0
- [x] Client production build — exit 0. Main chunk `index-Ct3ucv-N.js` is 309.23 kB (gzip 96.89 kB), under the 500 kB warning. Comment markdown is a separate 129.01 kB chunk loaded with the task panel
- [x] Production bundle search found no `JWT_SECRET`, `RESEND_API_KEY`, `DATABASE_URL`, `REDIS_URL`, `tokenHash`, `refreshToken`, or database/redis URLs
- [x] Prisma was not changed, so `prisma validate` was not rerun

Browser tools were not available in this session, so desktop, tablet, and mobile layouts were reviewed in code rather than in a live viewport.

**Status:** `COMPLETE`

---

## 27. UI polish — Navigation, spacing, and workspace refresh

**Goal:** Finish the signed-in shell without a redesign: Settings at the bottom of the sidebar, sign-out only in the account menu, tighter dashboard spacing, a small hover on clickable cards, and a workspace selection that survives refresh.

**Workspace refresh:**

The selected organization lived only in React state. After a refresh that state was empty, and the loader always took the first organization returned by `GET /api/v1/orgs`.

The fix stores that organization's id in `localStorage` under `sprintnest.workspace.<userId>`. On startup the client still loads the membership list from the API and then chooses:

1. The organization in the current URL, when that id is in the list
2. Otherwise the stored id, when it is in the list
3. Otherwise the first organization in the list

A stored id is never sent as proof of membership. Role and access still come from the API. No authentication token is stored.

**Shell:**

- [x] Sidebar order is Dashboard, My Tasks, Projects, Members, Notifications, Activity, then a divider, then Settings at the bottom
- [x] The separate top-bar Sign out button is removed. Sign out stays in the account menu, with the same keyboard behavior
- [x] Dashboard uses the same max width, with even card padding, tighter gaps, and less top space
- [x] Project rows and task cards lift slightly on hover. Static metric and section cards do not

**Verification:**

- [x] Workspace preference tests — `tests/unit/workspacePreference.test.ts`, 8 passed
- [x] Full server suite — exit 0
- [x] Client typecheck — exit 0
- [x] Client production build — exit 0. Main chunk `index-CnLeoWCy.js` is 310.39 kB (gzip 97.36 kB)
- [x] Prisma was not changed, so `prisma validate` was not rerun

Browser tools were not available, so the sidebar, menu, and dashboard spacing were reviewed in code rather than in a live viewport.

**Intentional limitations:**

- Projects and members stay unpaged
- Settings still has no in-app password change or avatar upload
- Hidden controls are not authorization
- The stored workspace id is a preference. The API remains the authority for membership

**Status:** `COMPLETE`

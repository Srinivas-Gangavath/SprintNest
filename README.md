# SprintNest

SprintNest is a modern, production-ready, multi-tenant project management SaaS platform built with TypeScript, React, Express, Prisma, PostgreSQL, Redis, BullMQ, and Socket.IO.

It empowers organizations and cross-functional teams to organize workspaces, create projects, manage tasks on interactive Kanban boards, assign responsibilities, collaborate through threaded comments, track complete activity audit trails, and receive instantaneous in-app and email notifications.

---

## Table of Contents

- [Core Features](#core-features)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Architecture Diagram](#architecture-diagram)
- [Multi-Tenant Security & Isolation](#multi-tenant-security--isolation)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Local Development Setup](#local-development-setup)
- [Testing](#testing)
- [Production Deployment Guide](#production-deployment-guide)
  - [1. Neon PostgreSQL](#1-neon-postgresql)
  - [2. Upstash Redis](#2-upstash-redis)
  - [3. Render Web Service](#3-render-web-service)
- [Background Workers & Cold Start Details](#background-workers--cold-start-details)
- [Known Limitations & Technical Debt](#known-limitations--technical-debt)

---

## Core Features

- **Multi-Tenant Workspaces**: Organizations provide strict tenant boundaries. Users can belong to multiple organizations with independent roles (`OWNER`, `ADMIN`, `MEMBER`).
- **Interactive Kanban Boards**: Drag-and-drop or status-driven task tracking (`BACKLOG`, `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`) with priority indicators and due dates.
- **Atomic Task Numbering**: Projects maintain sequential, race-condition-free task numbers (e.g., `#1`, `#2`) using database-level transaction counters.
- **Threaded Markdown Comments**: Task discussions support single-level nested replies with sanitized Markdown (`rehype-sanitize`) preventing XSS.
- **Real-Time Collaboration**: Socket.IO connects clients for live task updates, status changes, and notifications without polling.
- **Audit Logging**: Comprehensive activity logs capture workspace actions (`task.created`, `task.status_changed`, `member.invited`, etc.).
- **Background Jobs with BullMQ**: Async queues process transactional emails (invitations, password resets) and fan-out notification events with retry policies and worker-level idempotency.
- **Single-Origin Deployment**: Express serves the production React SPA bundle alongside the REST API and WebSocket gateway on a single origin.

---

## Architecture & Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18, Vite, TypeScript | Fast SPA with client-side routing, responsive UI (Tailwind CSS), and TanStack Query. |
| **Backend** | Express 4, Node.js 22, TypeScript | Modular monolith REST API architecture with type-safe schemas and middleware pipeline. |
| **Database** | PostgreSQL 16, Prisma ORM 6 | Relational data persistence with strict foreign keys, indexes, and automated migrations. |
| **Cache & Queues**| Redis 7, BullMQ 5, ioredis | Distributed cache-aside caching, BullMQ background job queues with exponential retries. |
| **Real-Time** | Socket.IO 4 | WebSocket communication with HTTP cookie handshake authentication and room isolation. |
| **Email** | Resend API / Console Provider | Transactional email delivery for invitations and secure password resets. |
| **Security** | Helmet, bcrypt (12 rounds), JWT | Secure HTTP headers, rate limiting (`express-rate-limit`), CSRF protection, and HttpOnly cookies. |

---

## Architecture Diagram

```mermaid
flowchart TD
    subgraph Client ["Client (Browser)"]
        SPA["React 18 SPA (Vite)"]
        SocketClient["Socket.IO Client"]
    end

    subgraph Service ["Render Web Service (Single Origin)"]
        HTTP["Express HTTP Server (:10000)"]
        SocketServer["Socket.IO Server (In-Memory Rooms)"]
        Static["Express Static SPA Handler"]
        API["REST API Router (/api/v1)"]
        Workers["In-Process BullMQ Workers"]
    end

    subgraph Storage ["Cloud Infrastructure"]
        Postgres[("Neon PostgreSQL 16\n(Pooled & Direct URLs)")]
        RedisClient[("Upstash Redis 7\n(TLS rediss://)")]
        Resend["Resend Email API"]
    end

    SPA -->|HTTP Requests with CSRF & Cookies| HTTP
    SocketClient -->|WebSocket Handshake| SocketServer
    HTTP --> Static
    HTTP --> API
    API -->|Prisma Client| Postgres
    API -->|Cache Aside & Enqueue| RedisClient
    Workers -->|Process Jobs| RedisClient
    Workers -->|Save Notifications| Postgres
    Workers -->|Send Mail| Resend
    Workers -->|Emit Updates| SocketServer
    SocketServer -->|Real-Time Events| SocketClient
```

---

## Multi-Tenant Security & Isolation

SprintNest adheres to strict multi-tenant boundaries:
1. **Tenant Scoping**: All projects, tasks, comments, and members belong directly to an `orgId`.
2. **Membership Resolution**: The `resolveOrgMembership` middleware verifies the authenticated user has an active membership in the requested organization before any business logic executes.
3. **Cross-Tenant Protection**: Manipulating resource IDs (e.g. requesting a project ID from Organization B while authenticated in Organization A) fails with a `404 Not Found` or `403 Forbidden` response.
4. **WebSocket Room Authorization**: Sockets can only join `project:<projectId>` rooms after the backend validates the user's active membership in the owning organization.
5. **CSRF & Cookie Protection**: Session tokens are stored in `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookies. State-changing requests enforce the custom `X-Requested-With: XMLHttpRequest` header.

---

## Project Structure

```
SprintNest/
├── client/                     # React 18 frontend
│   ├── src/
│   │   ├── components/         # Reusable UI components (Kanban, Comments, Modals)
│   │   ├── contexts/           # Auth, Org, Workspace, Socket contexts
│   │   ├── pages/              # Route views (Dashboard, Project, Settings, etc.)
│   │   └── lib/api.ts          # Same-origin fetch client with CSRF injection
│   ├── package.json
│   └── vite.config.ts
├── server/                     # Express & Prisma backend
│   ├── prisma/
│   │   ├── migrations/         # Production Prisma SQL migrations
│   │   └── schema.prisma       # Database schema definition
│   ├── src/
│   │   ├── config/             # Zod environment validation & database/Redis singletons
│   │   ├── middleware/         # Auth, Org authorization, CSRF, rate limiter, error handler
│   │   ├── modules/            # Domain modules (auth, orgs, projects, tasks, comments, etc.)
│   │   ├── jobs/               # BullMQ queues and in-process workers
│   │   ├── websocket/          # Socket.IO handlers, authentication, and events
│   │   └── server.ts           # Server bootstrap and graceful shutdown
│   ├── tests/                  # Integration and unit test suite
│   ├── package.json
│   └── tsconfig.json
├── docker/                     # Docker initialization scripts
├── .github/workflows/ci.yml    # GitHub Actions CI workflow
├── docker-compose.yml          # Local full-stack compose definition
├── Dockerfile                  # Multi-stage production container build
└── README.md
```

---

## Environment Variables

Copy `server/.env.example` to `server/.env` for local configuration:

| Variable | Required | Description | Example (Local) |
|---|---|---|---|
| `NODE_ENV` | Yes | Application environment (`development`, `production`, `test`) | `development` |
| `PORT` | No | Server HTTP listening port (defaults to 3000) | `3000` |
| `DATABASE_URL` | Yes | PostgreSQL connection string (pooler on Neon) | `postgresql://sprintnest:sprintnest@localhost:5432/sprintnest` |
| `DIRECT_URL` | Yes | Direct PostgreSQL connection string (for migrations) | `postgresql://sprintnest:sprintnest@localhost:5432/sprintnest` |
| `REDIS_URL` | Yes | Redis connection string (use `rediss://` for Upstash) | `redis://localhost:6379` |
| `JWT_SECRET` | Yes | Secret key for access token signing (min 32 chars in prod) | `dev-jwt-secret-change-in-production` |
| `JWT_ACCESS_EXPIRY` | No | Access token lifespan | `15m` |
| `JWT_REFRESH_EXPIRY_DAYS`| No | Refresh token lifespan | `7` |
| `EMAIL_PROVIDER` | No | Email driver (`console` for dev, `resend` for prod) | `console` |
| `RESEND_API_KEY` | If resend | Resend API Key | `re_...` |
| `RESEND_FROM_EMAIL` | No | From sender address | `SprintNest <onboarding@resend.dev>` |
| `APP_URL` | Yes | Public application URL for invitation/reset links | `http://localhost:3000` |
| `CLIENT_DIST_PATH` | No | Path to built client assets (defaults to `../client/dist`)| `../client/dist` |

---

## Local Development Setup

### Option 1: Docker Compose (Quickest)

Prerequisites: Docker & Docker Compose installed.

```bash
# Clone the repository
git clone <your-repo-url>
cd SprintNest

# Start the full stack (Postgres, Redis, Express server, and Vite dev server)
docker compose up -d

# Open the application
# Frontend (Vite): http://localhost:5173
# Backend API:     http://localhost:3000
```

### Option 2: Local Node.js Development

Prerequisites: Node.js 22, Docker (for local database services).

1. **Start database dependencies**:
   ```bash
   docker compose up -d postgres redis
   ```

2. **Configure environment**:
   ```bash
   cp server/.env.example server/.env
   ```

3. **Install dependencies and migrate**:
   ```bash
   # In server/
   cd server
   npm ci
   npx prisma migrate deploy
   npx prisma generate

   # In client/
   cd ../client
   npm ci
   ```

4. **Run development servers**:
   ```bash
   # Terminal 1: Backend API
   cd server
   npm run dev

   # Terminal 2: Frontend client
   cd client
   npm run dev
   ```

---

## Testing

SprintNest includes 220+ automated tests covering unit logic, service layers, authentication flows, multi-tenant isolation, cache invalidation, BullMQ workers, and WebSocket operations.

```bash
# Run the complete test suite
cd server
npm test

# Run TypeScript typechecks
npm run typecheck

# Build client for production
cd ../client
npm run build
```

---

## Production Deployment Guide

SprintNest is engineered to run seamlessly on modern free-tier cloud providers:
- **Web Service**: Render (Free Tier Web Service)
- **Database**: Neon (Serverless PostgreSQL Free Tier)
- **Redis & Queues**: Upstash (Serverless Redis Free Tier)
- **Email**: Resend (Free Tier)

### 1. Neon PostgreSQL
1. Create a free project on [Neon](https://neon.tech).
2. Under **Connection Details**, copy both connection strings:
   - **Pooled connection string**: Set as `DATABASE_URL` (includes `?sslmode=require`).
   - **Direct connection string**: Set as `DIRECT_URL` (direct port 5432 connection for migrations).

### 2. Upstash Redis
1. Create a free Redis database on [Upstash](https://upstash.com).
2. Copy the **Node.js ioredis connection string** (`rediss://default:...@...upstash.io:6379`).
3. Set as `REDIS_URL`. Note: the `rediss://` protocol automatically enables TLS.

### 3. Render Web Service
1. Create a new **Web Service** on [Render](https://render.com).
2. Select your GitHub repository.
3. Choose **Docker** as the runtime.
4. Set the following Environment Variables in the Render Dashboard:
   - `NODE_ENV`: `production`
   - `PORT`: `10000`
   - `DATABASE_URL`: *(from Neon pooled string)*
   - `DIRECT_URL`: *(from Neon direct string)*
   - `REDIS_URL`: *(from Upstash string)*
   - `JWT_SECRET`: *(generate a cryptographically secure 32+ character random string)*
   - `EMAIL_PROVIDER`: `resend`
   - `RESEND_API_KEY`: *(from Resend dashboard)*
   - `RESEND_FROM_EMAIL`: `SprintNest <onboarding@resend.dev>` *(or your verified domain)*
   - `APP_URL`: `https://your-app-name.onrender.com`
5. Deploy service. The container will automatically run `npx prisma migrate deploy` on boot and launch the application.

---

## Background Workers & Cold Start Details

- **In-Process Worker Architecture**: BullMQ workers run in the same Node.js process as Express to fit inside Render's single free-instance limitation.
- **Sleep & Wake Behavior**: Free Render web services spin down after 15 minutes of inactivity. When asleep:
  - Incoming HTTP requests wake the service (30–50s cold start).
  - Enqueued BullMQ jobs remain safely stored in durable external Upstash Redis.
  - As soon as the service wakes, in-process workers resume and process pending jobs immediately.
- **Worker Idempotency**: Notification jobs use Redis job-completion keys and recent-duplicate database checks. If a worker is interrupted during a shutdown or restart, retried jobs will never insert duplicate notification rows.

---

## Known Limitations & Technical Debt

1. **At-Least-Once Delivery**: BullMQ workers guarantee at-least-once execution. Worker-level idempotency prevents database duplication, but external notification deliveries remain best-effort.
2. **Invitation Cancellation State**: Cancelling a pending invitation sets the status to `DECLINED` and records an activity audit entry rather than using a dedicated `CANCELLED` status enum.
3. **List Pagination**: Workspace member lists and project lists load completely without cursor pagination. Designed for small-to-medium teams.
4. **Single-Node Socket.IO**: Socket.IO uses in-memory rooms suited for single-instance web services. Scaling horizontally across multiple web instances will require the `@socket.io/redis-adapter`.

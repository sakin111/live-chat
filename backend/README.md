# AnonChat API

A real-time anonymous group chat service built with NestJS, PostgreSQL (Drizzle ORM), Redis, and Socket.io.

> **Deadline:** 30 April 2026 — submit a public GitHub link + deployed URL.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Database Migrations](#database-migrations)
- [Running the Server](#running-the-server)
- [REST API Reference](#rest-api-reference)
- [WebSocket Reference](#websocket-reference)
- [Deployment (Render)](#deployment-render)
- [Architecture Overview](#architecture-overview)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 10 |
| Database | PostgreSQL 16 + Drizzle ORM |
| Cache / Pub-Sub | Redis 7 |
| Real-time | Socket.io 4 with `@socket.io/redis-adapter` |
| Language | TypeScript 5 |
| Runtime | Node.js 20 |

---

## Project Structure

```
src/
├── auth/
│   ├── auth.controller.ts     # POST /login
│   ├── auth.service.ts        # Token generation, session storage in Redis
│   └── auth.module.ts
├── rooms/
│   ├── rooms.controller.ts    # CRUD endpoints
│   ├── rooms.service.ts       # DB queries + Redis active-user tracking
│   └── rooms.module.ts
├── messages/
│   ├── messages.controller.ts # GET/POST messages
│   ├── messages.service.ts    # Persist + publish to Redis pub/sub
│   └── messages.module.ts
├── gateway/
│   ├── chat.gateway.ts        # Socket.io /chat namespace
│   └── gateway.module.ts
├── database/
│   └── database.module.ts     # Drizzle ORM provider
├── redis/
│   └── redis.module.ts        # Redis client providers (main, pub, sub)
├── common/
│   ├── filters/               # Global exception → envelope filter
│   └── guards/                # JWT-less Bearer token guard
├── schema.ts                  # Drizzle table definitions
├── app.module.ts
└── main.ts
drizzle/                       # Generated SQL migrations
docker-compose.yml             # Postgres + Redis for local dev
Dockerfile
drizzle.config.ts
```

---

## Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10
- **Docker + Docker Compose** (for local Postgres and Redis)

---

## Local Development Setup

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/anonchat-api.git
cd anonchat-api
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start Postgres and Redis

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on `localhost:5432` (user: `postgres`, password: `password`, db: `anonchat`)
- Redis on `localhost:6379`

### 4. Configure environment

```bash
cp .env.example .env
```

The defaults in `.env.example` match the Docker Compose setup and work out of the box. Edit only if you change ports or credentials.

### 5. Run database migrations

```bash
npm run db:push
```

> `db:push` syncs the Drizzle schema directly to the database — ideal for development. For production use `db:migrate` with generated migration files.

### 6. Start the development server

```bash
npm run start:dev
```

The API is now live at `http://localhost:3000`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | `development` or `production` |
| `DATABASE_URL` | *(see example)* | Full PostgreSQL connection string |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | *(empty)* | Redis password (leave empty for local) |
| `SESSION_TTL_SECONDS` | `86400` | Session token lifetime (24 h) |

---

## Database Migrations

**Development — push schema directly:**
```bash
npm run db:push
```

**Production — generate and run migration files:**
```bash
npm run db:generate   # generates SQL into /drizzle
npm run db:migrate    # applies migrations
```

---

## Running the Server

| Command | Description |
|---|---|
| `npm run start:dev` | Development mode with hot-reload |
| `npm run start` | Production-compiled mode |
| `npm run build && npm run start:prod` | Compile then run production bundle |

---

## REST API Reference

**Base path:** `http://localhost:3000/api/v1`

All responses use the envelope format:

```json
// Success
{ "success": true, "data": { } }

// Error
{ "success": false, "error": { "code": "SNAKE_CASE", "message": "..." } }
```

Protected endpoints require: `Authorization: Bearer <sessionToken>`

---

### POST `/api/v1/login`

Get or create a user and receive a session token.

**No auth required.**

```bash
curl -X POST http://localhost:3000/api/v1/login \
  -H "Content-Type: application/json" \
  -d '{"username": "ali_123"}'
```

**Request body:**

| Field | Type | Constraints |
|---|---|---|
| `username` | string | 2–24 chars, alphanumeric + underscores only |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "sessionToken": "aBcDeFgH...",
    "user": {
      "id": "usr_a1b2c3",
      "username": "ali_123",
      "createdAt": "2024-03-01T10:00:00Z"
    }
  }
}
```

> If the username already exists, the existing user is returned with a **fresh** session token. Idempotent by username.

---

### GET `/api/v1/rooms`

List all rooms with live active user counts from Redis.

```bash
curl http://localhost:3000/api/v1/rooms \
  -H "Authorization: Bearer <sessionToken>"
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "rooms": [
      {
        "id": "room_x9y8z7",
        "name": "general",
        "createdBy": "ali_123",
        "activeUsers": 4,
        "createdAt": "2024-03-01T10:00:00Z"
      }
    ]
  }
}
```

---

### POST `/api/v1/rooms`

Create a new room.

```bash
curl -X POST http://localhost:3000/api/v1/rooms \
  -H "Authorization: Bearer <sessionToken>" \
  -H "Content-Type: application/json" \
  -d '{"name": "general"}'
```

**Request body:**

| Field | Type | Constraints |
|---|---|---|
| `name` | string | 3–32 chars, alphanumeric + hyphens only, must be unique |

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "room_x9y8z7",
    "name": "general",
    "createdBy": "ali_123",
    "createdAt": "2024-03-01T10:00:00Z"
  }
}
```

**Errors:** `409 ROOM_NAME_TAKEN`

---

### GET `/api/v1/rooms/:id`

Get a single room with live active user count.

```bash
curl http://localhost:3000/api/v1/rooms/room_x9y8z7 \
  -H "Authorization: Bearer <sessionToken>"
```

**Errors:** `404 ROOM_NOT_FOUND`

---

### DELETE `/api/v1/rooms/:id`

Delete a room and all its messages. Only the creator can do this.

Before deletion, emits a `room:deleted` WebSocket event to all connected clients in the room via Redis pub/sub.

```bash
curl -X DELETE http://localhost:3000/api/v1/rooms/room_x9y8z7 \
  -H "Authorization: Bearer <sessionToken>"
```

**Response `200`:**
```json
{ "success": true, "data": { "deleted": true } }
```

**Errors:** `403 FORBIDDEN` · `404 ROOM_NOT_FOUND`

---

### GET `/api/v1/rooms/:id/messages`

Paginated message history, newest first.

```bash
curl "http://localhost:3000/api/v1/rooms/room_x9y8z7/messages?limit=20&before=msg_ab12cd" \
  -H "Authorization: Bearer <sessionToken>"
```

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max `100` |
| `before` | string | — | Message ID cursor — returns messages older than this |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg_ab12cd",
        "roomId": "room_x9y8z7",
        "username": "ali_123",
        "content": "hello everyone",
        "createdAt": "2024-03-01T10:05:22Z"
      }
    ],
    "hasMore": true,
    "nextCursor": "msg_zz9900"
  }
}
```

> `nextCursor` is `null` when there are no more pages.

**Errors:** `404 ROOM_NOT_FOUND`

---

### POST `/api/v1/rooms/:id/messages`

Send a message. Persists to PostgreSQL, then publishes to Redis so the WebSocket gateway can broadcast it.

```bash
curl -X POST http://localhost:3000/api/v1/rooms/room_x9y8z7/messages \
  -H "Authorization: Bearer <sessionToken>" \
  -H "Content-Type: application/json" \
  -d '{"content": "hello everyone"}'
```

**Request body:**

| Field | Type | Constraints |
|---|---|---|
| `content` | string | 1–1000 chars, trimmed server-side |

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "msg_ab12cd",
    "roomId": "room_x9y8z7",
    "username": "ali_123",
    "content": "hello everyone",
    "createdAt": "2024-03-01T10:05:22Z"
  }
}
```

**Errors:** `404 ROOM_NOT_FOUND` · `422 MESSAGE_TOO_LONG` · `422 MESSAGE_EMPTY`

---

### Error Code Reference

| HTTP | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Request body fails validation |
| `401` | `UNAUTHORIZED` | Missing or expired session token |
| `403` | `FORBIDDEN` | Action not permitted for this user |
| `404` | `ROOM_NOT_FOUND` | Room ID does not exist |
| `409` | `ROOM_NAME_TAKEN` | Room name already in use |
| `422` | `MESSAGE_TOO_LONG` | Content exceeds 1000 chars |
| `422` | `MESSAGE_EMPTY` | Content is empty after trimming |

---

## WebSocket Reference

### Connection

```
ws://localhost:3000/chat?token=<sessionToken>&roomId=<roomId>
```

- Invalid or expired `token` → immediate disconnect with error code `401`
- Unknown `roomId` → immediate disconnect with error code `404`

### Server → Client Events

| Event | Recipient | Payload |
|---|---|---|
| `room:joined` | Connecting client only | `{ activeUsers: string[] }` |
| `room:user_joined` | All **other** clients in room | `{ username, activeUsers }` |
| `message:new` | All clients in room | `{ id, username, content, createdAt }` |
| `room:user_left` | All clients in room | `{ username, activeUsers }` |
| `room:deleted` | All clients in room | `{ roomId }` |

### Client → Server Events

| Event | Payload | Description |
|---|---|---|
| `room:leave` | *(none)* | Graceful disconnect — triggers `room:user_left` broadcast |

### Example (browser)

```javascript
const socket = io('http://localhost:3000/chat', {
  query: { token: 'YOUR_SESSION_TOKEN', roomId: 'room_x9y8z7' },
});

socket.on('room:joined', ({ activeUsers }) => {
  console.log('Online:', activeUsers);
});

socket.on('message:new', (msg) => {
  console.log(`${msg.username}: ${msg.content}`);
});

socket.on('room:user_joined', ({ username }) => {
  console.log(`${username} joined`);
});

socket.on('room:user_left', ({ username }) => {
  console.log(`${username} left`);
});

socket.on('room:deleted', () => {
  console.log('Room was deleted');
  socket.disconnect();
});

// Graceful leave
socket.emit('room:leave');
```

---

## Deployment (Render)

### Required services on Render

1. **PostgreSQL** — managed database (free tier works)
2. **Redis** — use Redis Cloud free tier or Render's Redis add-on
3. **Web Service** — deploys this repo

### Steps

1. Push the repo to GitHub
2. Create a Render **Web Service**, connect the repo
3. Set **Build Command:** `npm install && npm run build && npm run db:migrate`
4. Set **Start Command:** `npm run start:prod`
5. Add all environment variables from `.env.example` using Render's dashboard
6. Deploy

> The app is stateless — you can run multiple instances behind Render's load balancer and Redis pub/sub will keep WebSockets in sync across all of them.

---

## Architecture Overview

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for a full breakdown of:

- Component interaction diagram
- Session strategy and token lifecycle
- Redis pub/sub WebSocket fan-out
- Concurrent user capacity estimate
- Scale-to-10× plan
- Known trade-offs

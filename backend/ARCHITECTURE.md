# Architecture — AnonChat API

## Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLIENT(S)                              │
│              Browser / Mobile / Test Scripts                    │
└──────────┬───────────────────────────────┬──────────────────────┘
           │ HTTP REST                     │ WebSocket (Socket.io)
           │ /api/v1/*                     │ /chat?token=&roomId=
           ▼                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     NestJS Application                           │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │AuthController│  │RoomsController│  │  MessagesController   │  │
│  │  POST /login│  │GET/POST/DELETE│  │  GET/POST messages    │  │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬────────────┘  │
│         │                │                       │               │
│  ┌──────▼──────┐  ┌──────▼───────┐  ┌──────────▼────────────┐  │
│  │ AuthService │  │ RoomsService │  │   MessagesService     │  │
│  │             │  │              │  │                        │  │
│  │ - login()   │  │ - findAll()  │  │  - getMessages()      │  │
│  │ - validate  │  │ - create()   │  │  - createMessage()    │  │
│  │   Token()   │  │ - delete()   │  │  - redis.publish()    │  │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬────────────┘  │
│         │                │                       │               │
│         │         ┌──────▼───────────────────────▼────────────┐ │
│         │         │          ChatGateway (/chat ns)           │ │
│         │         │                                            │ │
│         │         │  onConnection()  → validate token + room  │ │
│         │         │  onDisconnect()  → cleanup Redis state    │ │
│         │         │  room:leave      → graceful disconnect    │ │
│         │         │  redisSub.on()   → fan-out events        │ │
│         │         └──────────────────────────────────────────┘ │
└─────────┼────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────┐    ┌──────────────────────────┐
│           Redis                 │    │       PostgreSQL          │
│                                 │    │                          │
│  session:<token>  (24h TTL)     │    │  users                   │
│  room:<id>:users  (Set)         │    │  rooms                   │
│  socket:<id>      (24h TTL)     │    │  messages                │
│                                 │    │   └─ FK → rooms          │
│  Pub/Sub channels:              │    │      (cascade delete)    │
│  room:<id>:message:new          │    └──────────────────────────┘
│  room:<id>:deleted              │
└─────────────────────────────────┘
```

---

## Session Strategy

### Token Generation

Sessions are **opaque bearer tokens** — 48-character random strings generated with `nanoid` using a `[a-zA-Z0-9]` alphabet. This gives ~285 bits of entropy, which is infeasible to brute-force.

No JWTs are used because:
- There is no need to embed claims that clients read
- Opaque tokens allow instant revocation by deleting the Redis key
- Simpler to reason about expiry

### Storage

```
Redis key:   session:<token>
Value:       JSON { userId, username }
TTL:         86400 seconds (24 hours)
```

Every call to `POST /login` creates a **new token** for the user. Old tokens remain valid until their TTL expires — this is an acceptable trade-off for simplicity. A production system could scan and invalidate old tokens by maintaining a `user:<id>:sessions` set.

### Validation

Every protected HTTP route passes through `AuthGuard`, which:
1. Extracts the `Bearer` token from the `Authorization` header
2. Calls `redis.get(session:<token>)`
3. Returns `401` if missing, expired, or malformed

WebSocket connections validate in `handleConnection()` using the same `AuthService.validateToken()` method.

---

## Redis Pub/Sub — WebSocket Fan-out

The core challenge in scaling WebSockets is that Socket.io's `server.to(room).emit()` only reaches clients connected to **the current process**. Redis pub/sub bridges this gap.

### Flow: REST → Redis → WebSocket

```
POST /rooms/:id/messages
        │
        ▼
MessagesService.createMessage()
   1. INSERT into PostgreSQL
   2. redis.publish('room:<id>:message:new', JSON.stringify(payload))
        │
        │ (Redis pub/sub delivers to ALL subscribers)
        │
        ▼
ChatGateway.onModuleInit()
   redisSub.psubscribe('room:*:message:new')
   redisSub.on('pmessage', handler)
        │
        ▼
   server.to(roomId).emit('message:new', payload)
   (reaches all Socket.io clients on THIS instance)
```

Each server instance subscribes to `room:*:message:new` at startup. When any instance publishes a message, Redis delivers it to all subscribers (all instances), and each one emits to its locally connected clients. The result is that all clients across all instances receive the event.

The same pattern is used for `room:deleted`.

### Why `@socket.io/redis-adapter`?

The `@socket.io/redis-adapter` package extends Socket.io's internal adapter so that calls like `server.to(room).emit()` automatically propagate across instances via Redis pub/sub. It uses two Redis clients: one for publishing, one for subscribing. This is why `RedisModule` exposes three separate clients (`REDIS`, `REDIS_PUB`, `REDIS_SUB`).

---

## Active User Tracking

Active users per room are stored in Redis Sets:

```
Key:     room:<roomId>:users
Type:    Set
Members: usernames
```

On connection: `SADD room:<id>:users <username>`
On disconnect: `SREM room:<id>:users <username>`
Live count: `SCARD room:<id>:users`
Member list: `SMEMBERS room:<id>:users`

This means active user counts in `GET /rooms` and `GET /rooms/:id` reflect real-time connected users, not a DB counter.

### Socket State in Redis

Socket-to-user mapping is stored in Redis (not in-memory) so that cleanup works correctly on any instance:

```
Key:   socket:<socketId>
Value: JSON { username, roomId }
TTL:   86400s
```

This ensures `handleDisconnect()` on instance A can look up which room a socket was in, even if the socket first connected to instance B.

---

## Estimated Concurrent User Capacity (Single Instance)

### Assumptions

| Resource | Limit |
|---|---|
| Node.js process | 1 CPU, 512 MB RAM |
| Each idle WebSocket | ~3–5 KB memory |
| Each Redis op | ~0.1–0.5 ms |
| Socket.io overhead | ~10 KB per active connection |

### Estimate

- **Memory bound:** 512 MB / 10 KB per socket ≈ **~50,000 sockets** (theoretical)
- **CPU bound:** NestJS event loop on 1 core handles ~5,000–10,000 concurrent connections comfortably with light workloads. Heavy bursts (all users sending messages simultaneously) will saturate the event loop earlier.
- **Redis bound:** Redis can handle ~100,000 ops/sec; at 1,000 concurrent users sending 1 msg/sec each, Redis is nowhere near a bottleneck.

**Practical estimate: ~5,000–8,000 concurrent WebSocket connections on a single 1-CPU / 512 MB instance** with typical chat workloads (message every few seconds per user).

---

## Scaling to 10× Load

To handle ~50,000–80,000 concurrent connections:

### 1. Horizontal Scaling (Primary lever)

Run **N instances** behind a load balancer with **sticky sessions** (required for Socket.io). The Redis adapter already handles cross-instance event delivery. Render, Railway, and Fly.io all support horizontal scaling.

```
Load Balancer (sticky by socket ID)
   ├── Instance 1
   ├── Instance 2
   └── Instance N
         ↕ Redis pub/sub
```

### 2. Redis Upgrade

Move from a single Redis instance to **Redis Cluster** or a managed service like **Upstash** (serverless) or **Redis Enterprise**. This removes Redis as a single point of failure and increases throughput.

### 3. PostgreSQL Read Replicas

Message history reads (`GET /rooms/:id/messages`) can be routed to read replicas. This is especially impactful if many clients are paginating history while simultaneously chatting.

### 4. Connection Pooling

Replace the `pg.Pool` in `DatabaseModule` with **PgBouncer** in transaction-pooling mode to handle thousands of short DB connections without exhausting Postgres `max_connections`.

### 5. Separate WebSocket Workers

Split the NestJS app into two services:
- **REST API workers** — handle HTTP, scale based on request load
- **WebSocket workers** — handle Socket.io connections, scale based on connection count

This allows independent scaling of each workload type.

---

## Known Limitations and Trade-offs

### 1. No true pagination cursor

The current `before` cursor for message pagination uses the message ID to identify a position, but the implementation fetches all messages and slices. A production-grade version would use `WHERE created_at < (SELECT created_at FROM messages WHERE id = $cursor)` with proper index utilization.

### 2. Multi-device per username

A username can be logged in from multiple devices simultaneously (multiple valid session tokens, one per `POST /login`). The system does not track or limit concurrent sessions per user.

### 3. No session invalidation on login

Old session tokens are not invalidated when a new one is issued. They remain valid until their 24-hour TTL expires. A session blacklist (a Redis Set per user) would fix this.

### 4. Active user set is not deduplicated by device

If the same username connects twice (two browser tabs), they appear once in the active users Set (Redis Set deduplicates), but `removeActiveUser` on one disconnect removes them entirely — even if the second connection is still active. A reference-count approach (`HINCRBY`) or a per-socket tracking Set would fix this.

### 5. No rate limiting

There is no per-user rate limit on `POST /rooms/:id/messages`. A malicious user can flood a room. Production deployments should add a Redis-based sliding window rate limiter (e.g., using `ioredis` + `rate-limiter-flexible`).

### 6. In-memory Socket.io state on the Gateway

`server.to(roomId)` relies on Socket.io's in-memory room tracking for local sockets. This is correct and intentional — the Redis adapter handles cross-instance delivery. However, Socket.io's in-memory state grows with connections and is lost on crash. Clients should reconnect and re-join on connection loss.

### 7. No message delivery guarantees

Messages published via Redis pub/sub use fire-and-forget. If a subscriber crashes before processing a published event, that event is lost. For guaranteed delivery, a Redis Stream (`XADD` / `XREAD`) would provide persistence and consumer-group acknowledgement.

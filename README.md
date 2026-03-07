# DebugRush

Real-time multiplayer debugging game built as an npm workspaces monorepo.

Players join a room, get rotating roles (proposer/counter/voter), answer code-bug questions under time limits, and score points based on correctness and voting outcomes.

## What this repo contains

```text
.
├─ apps/
│  ├─ web/          # React + Vite + Tailwind client
│  └─ server/       # Socket.IO + Redis game server
├─ packages/
│  └─ shared/       # Shared zod schemas + typed socket event contracts
├─ .env.example     # Reference values for local env variables
└─ package.json     # Workspace scripts
```

## Tech stack

- Frontend: React 19, TypeScript, Vite 7, Tailwind CSS 4
- Backend: Node.js, TypeScript (tsx runtime), Socket.IO, ioredis
- Shared contracts: zod schemas + TypeScript types in `@debugrush/shared`
- State store: Redis (`room:*` keys, TTL-based cleanup)

## Core gameplay

- Room IDs are exactly 6 uppercase alphanumeric characters.
- Max connected players per room: 5.
- Minimum players to start: 3 connected players.
- Roles rotate round-robin by join order:
  - `proposer` picks an option (+ optional reason)
  - `counter` picks an option (+ optional reason)
  - remaining connected players vote (`proposer` or `counter`)
- Majority vote determines final side automatically.
- If selected side is wrong, game ends immediately.
- Reveal phase shows outcome, then next round starts (or game ends).

### Phase timers

- `propose`: 30s
- `counter`: 20s
- `vote`: 20s
- `reveal`: 10s
- `final`: 12s exists in schema/engine for compatibility, but final decision is currently automatic from majority vote.

### Scoring

- Proposer/counter manual pick:
  - correct: `+4`
  - wrong: `-4`
- Voter manual vote:
  - correct side: `+2`
  - wrong side: `-2`
- Tie round mode:
  - correct: `+1`
  - wrong: `-1`
- Timeout auto-pick penalty for proposer/counter: `-2` (fixed override for that role action)

## Real-time protocol (Socket.IO)

Shared event typing lives in `packages/shared/src/events.ts`.

Client -> Server:

- `auth:whoami`
- `room:join`
- `room:leave`
- `game:start`
- `round:proposer:submit`
- `round:counter:submit`
- `round:vote:submit`
- `round:final:submit` (currently disabled by server)
- `round:reveal:skip`

Server -> Client:

- `auth:identity`
- `room:state`
- `room:left`
- `action:error`

All payloads are zod-validated in `packages/shared/src/schemas.ts`.

## Persistence and reliability behavior

- Room state is stored in Redis and refreshed with TTL on mutation.
- TTL: 2 hours (`ROOM_TTL_SECONDS` in `apps/server/src/repo/roomsRepo.ts`).
- Atomic room mutations use Redis `WATCH`/`MULTI` with retries to reduce race conditions.
- On server boot, in-progress rooms are scanned and phase timers are recovered.
- Disconnect handling:
  - 1.5s grace window allows refresh/reconnect without immediate removal.
  - if a player actually leaves during an active match, game ends immediately.

## Prerequisites

- Node.js 20+ (recommended)
- npm 10+ (recommended)
- Redis running locally (default: `redis://localhost:6379`)

## Environment setup

`npm` workspace scripts run each app in its own directory, so use per-app `.env` files:

`apps/server/.env`

```env
REDIS_URL=redis://localhost:6379
PORT=4000
CORS_ORIGIN=http://localhost:5173
```

`apps/web/.env`

```env
# Required in non-development builds.
# In development, empty falls back to http://localhost:4000 in client code.
VITE_WS_URL=http://localhost:4000
```

Notes:

- `.env.example` in repo root is a reference template only.
- If Vite starts on a different port (for example `5174`), update `CORS_ORIGIN` accordingly or free `5173`.

## Install and run locally

1. Install dependencies:

```bash
npm install
```

2. Start Redis (example with local install):

```bash
redis-server
```

3. Start web + server together:

```bash
npm run dev
```

4. Open the client:

```text
http://localhost:5173
```

If `5173` is already in use, Vite may auto-switch ports. In that case, make sure server `CORS_ORIGIN` matches the actual web origin.

## Script reference

Root scripts (`package.json`):

- `npm run dev` -> kills port `4000`, then runs web + server concurrently
- `npm run dev:web` -> starts only `apps/web`
- `npm run dev:server` -> starts only `apps/server`
- `npm run build` -> workspace build (currently fails because `apps/server` has no `build` script)
- `npm run lint` -> workspace lint

Workspace scripts:

- Web (`apps/web/package.json`)
  - `npm run dev -w apps/web`
  - `npm run build -w apps/web`
  - `npm run preview -w apps/web`
- Server (`apps/server/package.json`)
  - `npm run dev -w apps/server`
- Shared (`packages/shared/package.json`)
  - `npm run build -w packages/shared`

## Current known gaps

- No automated tests are configured yet.
- `apps/server` has no `build` script, so root `npm run build` exits with a missing-script error for that workspace.
- Root `npm run lint` currently reports existing lint issues in `apps/web`.
- Production identity verification middleware is not wired in this repo yet:
  - in production mode, server requires authenticated identity from session or verified token.
  - development fallback uses client-provided handshake identity.

## Game logic details worth knowing

- Question deck is defined in `apps/server/src/engine/gameEngine.ts` (`QUESTION_DECK`).
- Current deck has one active question and many commented entries, so repeated rounds may recycle the same prompt.
- Duplicate proposer/counter pick behavior:
  - server generates a system alternative option for voting.
  - vote resolution gives baseline support to the shared role pick to prevent a single voter from overriding both role picks.
- Immediate game-over conditions include:
  - both proposer and counter pick different wrong options.
  - a player leaves/disconnects during an active match.

## Troubleshooting

- `Missing REDIS_URL` on server start:
  - create/fix `apps/server/.env` and ensure Redis is running.
- Web cannot connect to server:
  - verify `VITE_WS_URL`, server `PORT`, and `CORS_ORIGIN` alignment.
- Frequent room errors under heavy multi-client actions:
  - expected occasional `ROOM_BUSY` retries due optimistic Redis transactions.
- Stale favicon/tab icon in browser:
  - do a hard refresh or clear site cache (favicons are aggressively cached).

## Suggested next improvements

- Add `apps/server` build/start scripts for production packaging.
- Add end-to-end tests for round transitions and scoring.
- Move question deck to durable storage + admin tooling.
- Add proper auth middleware for production identity.

# BALL ARENA LEGENDS

A real-time, full-stack 2D top-down **ball** arena game that runs in any modern browser (Android + PC).
You are a glowing ball: move, dash, farm enemies and coins, level up, collect flags, unlock skins and
fight eight bosses — online with other players or solo.

## Highlights

- **Authoritative server game engine** (33 ms tick, 66 ms snapshots) — position, damage, coins and EXP are
  computed on the server, so the client can never fake rewards.
- **Real multiplayer** over Socket.IO: every `MULTIPLAYER` player joins the same shared arena and sees the
  others move in real time. No fake bots in online mode.
- **Four modes**: MULTIPLAYER, SOLO (bot arena), 1V1 matchmaking with results, and GLOBAL CHAT.
- **Progression**: coins (start at 0), EXP/level, flags that gate bosses, 8 bosses with level scaling.
- **95 skins + GODMAX**: COMMON 20, UNCOMMON 18, RARE 16, EPIC 14, LEGEND 12, MYTHIC 8, SECRET 4, GODLY 2,
  ULTIMAX 1, plus the owner-grantable rainbow GODMAX skin.
- **Secure accounts**: scrypt password hashing, HTTP-only cookie sessions, unique usernames, logout,
  self-registration can only ever create `PLAYER` accounts.
- **Owner account + 16-capability dashboard**: chat moderation, temporary/permanent bans, grants
  (EXP, levels, coins, skins, GODMAX), player management, reports, statistics, owner image messages,
  owner password change. Every owner endpoint is checked server-side.
- **Premium UI**: cinematic intro, futuristic dark theme, canvas arena with particles, virtual joystick on
  mobile (WASD/arrows on PC).

## Tech stack

| Layer      | Technology                                   |
| ---------- | -------------------------------------------- |
| Server     | Node.js 18+, Express 4, Socket.IO 4          |
| Database   | SQLite (better-sqlite3), auto-migrating      |
| Auth       | scrypt hashes + session cookies (HttpOnly)   |
| Frontend   | Vanilla ES modules, Canvas 2D, CSS3          |
| Packaging  | Docker (`Dockerfile` provided)               |

## Quick start (local)

```bash
npm install
npm start            # http://localhost:3000
```

Then open `http://localhost:3000`, register an account and press **PLAY**.

### Configuration (environment variables)

| Variable   | Default        | Purpose |
| ---------- | -------------- | ------- |
| `PORT`     | `3000`         | HTTP/Socket.IO port. The server binds `0.0.0.0` so containers work. |
| `DATA_DIR` | `./data`       | Directory for `ball-arena.db` and `uploads/`. Point this at a persistent volume in production. |
| `NODE_ENV` | —              | Set to `production` for the hardened cookie settings. |

The schema is created automatically on first boot. Persistent data lives in exactly one file
(`$DATA_DIR/ball-arena.db`) plus `$DATA_DIR/uploads/` for owner chat images — back up that directory.

### Owner account

The owner account is created **server-side only, on first boot**, from a hashed credential source inside
`server/index.js`. The password is never present in the public HTML/JS bundle, and registration can never
create an owner account. After the first login, change the password from the owner dashboard
(requires the current password; must be at least 10 characters).

## Testing

```bash
npm test
```

`tests/integration.test.js` boots the real server on a temporary `DATA_DIR`/port and asserts 22 behaviours
end-to-end: hashing on disk, duplicate/reserved usernames, session + logout, owner-only APIs, server-side
economy (no coins without funds), skin ownership rules, boss gating, two-player multiplayer state sync,
1v1 matchmaking, chat profanity filter/history/reporting, owner grants, ban/unban, password rules and
static asset delivery.

## Docker / deployment

```bash
docker build -t ball-arena-legends .
docker run -p 3000:3000 -v ball-arena-data:/app/data ball-arena-legends
```

The image is a two-stage Alpine build: the first stage installs `python3 make g++` so `better-sqlite3`
compiles its native addon against musl, and the final stage ships only `libstdc++` plus
`node_modules`, `server` and `public`. It exposes `3000`, sets `DATA_DIR=/app/data`, runs as the
non-root `node` user and ships a container healthcheck against `/api/health`.
Alpine is used instead of a Debian base because the Debian 12 glibc/gnutls packages used by the
official `node:*-bookworm-slim` images are flagged as unfixed high/critical advisories, which blocks
the deployment image security gate.

Deployment checklist:

1. Build/run with the Dockerfile (port **3000**).
2. Mount a persistent volume on `/app/data` (SQLite + uploads) — otherwise data resets on redeploy.
3. `GET /api/health` must return `200` with `{"ok":true}`.
4. Optional: put a TLS reverse proxy in front; session cookies are `HttpOnly` and marked `Secure` in production.

No external database service is required: SQLite is embedded, so there is no connection string to configure.
If you prefer Postgres/MySQL later, `server/db.js` is the single place that talks to the database.

## Project layout

```
server/
  index.js       HTTP + Socket.IO API surface (auth, shop, owners, chat, sockets)
  game.js        authoritative arena engine (rooms, enemies, bosses, snapshots)
  db.js          schema, statements, sessions, economy helpers
  auth.js        scrypt hashing, cookie sessions, owner middleware
  skins.js       95-skin catalog + GODMAX rainbow skin
  bosses.js      8 boss definitions
  progression.js EXP -> level curve and flag rules
  filter.js      profanity filter ($#@%$)
  upload.js      validated image uploads for owner chat messages
public/
  index.html     single-page shell (intro, auth, lobby, arena, shop, profile, chat, owner)
  css/style.css  premium dark futuristic theme + responsive layout
  js/ball.js     ball rendering, skins, trails, particles
  js/game.js     canvas client: input, joystick, camera, interpolation, HUD
  js/app.js      UI state machine + REST/Socket.IO wiring
tests/
  integration.test.js  end-to-end API/socket test suite
```

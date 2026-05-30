# @decent/backend

The heart of Decent: a pzp node + a tiny local HTTP API.

## What it does

- Boots a `secret-stack` peer with the `ppppp-db` plugin (the pzp database:
  account tangle, feeds, deletion).
- Loads or creates a persistent ed25519 identity keypair in the data dir.
- Ensures an account + a `post` feed exist.
- Serves a localhost-only JSON API that both the web UI and CLI use.

## Run

```bash
node bin/decentd.js
# or from the repo root:
npm run backend
```

Environment:

- `DECENT_PORT` — API port (default `8008`).

Data lives in `~/.decent/default/` (keypair + pzp database). **The keypair is your
identity — back it up, never commit it.**

## API

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/whoami` | — | `{ account, pubkey }` |
| GET | `/api/posts` | — | `[{ id, text, account, received }]` (newest first) |
| POST | `/api/posts` | `{ text }` | the created post |
| DELETE | `/api/posts/:id` | — | `{ deleted }` |

## Portability constraint

This package must stay runnable on mobile (via nodejs-mobile or WASM). **Never
import `sodium-native` directly** — pzp's crypto goes through `sodium-universal`,
which swaps in a JS/WASM implementation off Node. See `docs/decisions.md`.

## Layout

- `src/node.js` — assembles and starts the pzp node.
- `src/store.js` — promise wrapper over `db` (the only place we touch pzp).
- `src/api.js` — the HTTP API.
- `bin/decentd.js` — the daemon entrypoint.

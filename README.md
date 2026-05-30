# Decent

A local-first, decentralized social client built on [pzp](https://github.com/staltz/ppppp-db) (the "ppppp" successor to Secure Scuttlebutt).

> The name plays on **dece**ntralized — and is mildly self-deprecating. It's *decent*.

Decent treats **human and programmatic use as co-equal, first-class concerns**. You can scroll your feed in a browser, or let an AI agent read and post to your feed through the same local API. It runs entirely on your machine — no servers, no accounts, no cloud. Your data is yours.

## Status

🌱 **Early scaffold.** This is a fresh project. The backend stands up a real pzp node and publishes to your feed; the web UI is minimal. Expect sharp edges. We're public from the start because we intend to build this with friends.

## Why pzp (and not SSB / ActivityPub / AT Protocol)?

We evaluated all four against two principles: **decentralization** and **local-first**.

- **ActivityPub** (Mastodon) and **AT Protocol** (Bluesky) trade away local-first for reach — your data lives on a server someone else controls.
- **SSB (classic)** is decentralized and local-first but its design has accumulated warts (append-only with no deletion, unbounded storage, single-keypair identity).
- **pzp** fixes those: a multi-device **account tangle**, real **deletion**, **storage caps**, and a DAG feed model (no forks). It's dormant upstream but its core (`ppppp-db`, `ppppp-sync`) is finished and stable — it builds and passes its full test suite on current Node.

We're not chasing a big network. Decent is for tinkering with technically-curious friends, seeded partly by mirroring content in from other platforms.

Full rationale and the protocol comparison live in `docs/decisions.md`.

## Goals

1. **Local web app first**, with the door kept open to a **mobile app** (verified feasible — see `docs/decisions.md`).
2. **Human and programmatic usage are co-equal.** Agents interact via a companion CLI or the local API directly.
3. **One-way mirroring** of posts/accounts from other social platforms *into* pzp. (Posting *out* is out of scope for now.)

## Architecture

```
┌─────────────────────────────────────────────┐
│  apps/web        Svelte SPA (the human UI)   │
└──────────────────────┬──────────────────────┘
                       │ HTTP / JSON (localhost)
┌──────────────────────┴──────────────────────┐
│  packages/backend    Node process:           │
│    • pzp node (secret-stack + ppppp-* )      │
│    • local HTTP/RPC API                       │
└──────────────────────┬──────────────────────┘
                       │ same local API
┌──────────────────────┴──────────────────────┐
│  packages/cli        companion CLI            │
│    (humans + AI agents, co-equal with the UI) │
└─────────────────────────────────────────────┘
```

**Portability constraint:** the backend is portable-by-default so the mobile door stays open. It must never import `sodium-native` directly — always go through `sodium-universal` (whose `browser`/`react-native` field swaps the native crypto addon for a WASM/JS fallback). See `docs/decisions.md`.

## Monorepo layout

| Path | What |
|------|------|
| `packages/backend` | The pzp node + local HTTP API. The heart of Decent. |
| `packages/cli` | Companion CLI for humans and agents. |
| `apps/web` | Svelte single-page app (the human UI). |
| `docs/` | Decision log, architecture notes. |

## Quick start

```bash
npm install

# Start the backend (creates an identity on first run, publishes a hello post)
npm run backend

# In another terminal, talk to it via the CLI
npm run cli -- whoami
npm run cli -- post "hello from the CLI"

# Or run the web UI
npm run web
```

## Contributing

We're building this in the open with friends. If that's you: open an issue, start a discussion, or just clone it and tinker. The decision log in `docs/` is the best place to understand *why* things are the way they are.

## License

AGPL-3.0 — in keeping with the SSB/pzp ecosystem and the spirit of building software that stays free.

# Decent — Decision Log

The *why* behind Decent's architecture. The full exploration history lives in the
private project vault; this is the public-facing summary.

## Protocol substrate: pzp (the "ppppp" successor to SSB)

We evaluated four decentralized social protocols against two principles:
**decentralization** and **local-first**.

| | SSB (classic) | **pzp** | ActivityPub | AT Protocol |
|---|---|---|---|---|
| Topology | P2P gossip | P2P gossip + hubs | Federated servers | PDS + Relay + AppView |
| Local-first | ✅ | ✅ | ❌ (server holds data) | ⚠️ partial |
| Decentralization | ✅ strong | ✅ strong | ⚠️ instance admin controls all | ⚠️ Bluesky runs ~all infra |
| Identity portability | keypair (single point) | ✅ account tangle, multi-device | ❌ content stuck on instance | ✅ DID-based |
| Deletion | ❌ append-only | ✅ | ✅ | ✅ |
| Storage growth | ❌ unbounded | ✅ capped (~100MB) | server | server |
| Maturity | mature, dormant | finished core, dormant | very mature | active, funded |
| Network size | niche | ~none | large | large |

**ActivityPub and AT Protocol trade away local-first for reach** — your data lives
on a server someone else controls. **SSB and pzp** are the only options that are
both strongly decentralized and local-first.

Between them, **pzp wins on design**: a multi-device account tangle (no single
point of failure for identity), real deletion, storage caps, and a DAG feed model
(no forks). It's dormant upstream (André Staltz stepped away in 2024), but its
core is *finished*, not broken:

- `ppppp-db` builds and passes **107/107 tests** on Node 23.
- `ppppp-sync` builds and passes **21/21 tests** (incl. two-peer replication).

We're not chasing network size — Decent is for tinkering with technically-curious
friends, seeded partly by mirroring content in from other platforms. That makes
the "we maintain the substrate" tradeoff acceptable.

### Consequence

We are the de-facto stewards of a pzp client. There's no active fork ecosystem
(checked: no third-party dependents; `ahdinosaur/ppppp-rs` Rust port is an
abandoned 2023 sketch). We vendor / pin the `ppppp-*` packages and own our
dependency on them.

## Stack

- **Backend** (`packages/backend`): a single Node process running a `secret-stack`
  peer with the `ppppp-db` plugin, plus a tiny dependency-free HTTP API
  (Node's built-in `http`). This is the one surface both the UI and CLI use.
- **CLI** (`packages/cli`): companion CLI hitting the same HTTP API. Humans and AI
  agents are co-equal — no special agent path.
- **Web** (`apps/web`): a Svelte 5 + SvelteKit 2 SPA (static adapter, no SSR),
  talking to the local API. Chosen partly as a real-world Svelte learning project.

## Mobile: door verified open

A core goal is keeping the mobile door open even though we're not building it yet.
Verified feasible:

- **Manyverse** (same lineage) runs a full SSB node on phones via
  `nodejs-mobile-react-native` — the same Node backend code, on-device.
- pzp's only native (C/C++) dependencies are `sodium-native` and `blake3`, and
  **both have non-native fallbacks**: pzp uses `sodium-native` *via*
  `sodium-universal` (whose `browser` field maps `sodium-native` →
  `sodium-javascript`), and `blake3` ships a WASM build.

Two mobile paths remain available: (1) nodejs-mobile with cross-compiled native
addons, or (2) pure WASM/JS. Either works.

### Design constraint (load-bearing)

**The backend must stay portable-by-default.** Never import `sodium-native`
directly — always go through `sodium-universal`. No desktop-only assumptions in
the backend. This is what keeps both mobile paths open.

## Out of scope (for now)

- **Posting *out*** to other social platforms. Mirroring is one-way *in* only.
- **SSR / hosted deployment.** Decent is a local daemon, not a web service.

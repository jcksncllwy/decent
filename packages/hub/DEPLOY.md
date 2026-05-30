# Decent Hub — Deploy Spec (for infra)

This is the handoff doc for deploying the Decent hub to the DigitalOcean droplet.
**dev owns this artifact; infra owns the box.** Everything below has been verified
locally on macOS (Node 23).

## What this is

`@decent/hub` is a **ppppp-hub**: a public rendezvous/relay. Decent nodes behind
NAT connect to it and it cross-connects them so they can replicate feeds. It
**does not store anyone's feed data** — it only brokers connections. Low resource
needs (a small droplet is fine).

## What it needs

- **Node.js ≥ 18** (verified on 23).
- **Two open inbound TCP ports:**
  | Port | Env var | Purpose | Public? |
  |------|---------|---------|---------|
  | `8008` | `PPPPP_PORT` | peer secret-handshake connections | **yes — must be open to the internet** |
  | `3000` | `HTTP_PORT` | bootstrap/invite web page | optional (nice for humans; can stay closed or firewalled to you) |
- Outbound TCP (standard).
- **A persistent data dir for the hub's keypair** (= its identity, the
  `shseCredentials` clients trust). Set via **`HUB_DATA_DIR`** (default
  `packages/hub/vendor/data/`, gitignored). **On a server, set `HUB_DATA_DIR`
  explicitly** to a known persisted path (e.g. `/opt/decent/hub-data`) so the
  identity survives redeploys/checkout moves — **if this keypair changes, every
  existing invite breaks.** Back it up after first boot.

## How to run

From the repo root on the droplet:

```bash
npm install                       # installs hub deps (workspaces)
# or just the hub:  npm install --workspace packages/hub

HTTP_PORT=3000 PPPPP_PORT=8008 HUB_DATA_DIR=/opt/decent/hub-data \
  node packages/hub/bin/decent-hub.js
```

Expected startup output:

```
[decent-hub] starting...
[decent-hub]   HTTP_PORT  = 3000 (bootstrap/invite web page)
[decent-hub]   PPPPP_PORT = 8008 (peer connections, 0.0.0.0)
[decent-hub] running. Open http://<host>:3000/ for the invite page.
```

## Health check

- **HTTP:** `curl -s http://127.0.0.1:3000/` returns HTML. With zero members it
  renders a "Bootstrap" page exposing `tcpPort` and the hub's `shseCredentials`
  (its public key) — that's expected and is what clients use to connect.
- **Peer port:** `nc -z 127.0.0.1 8008` succeeds (port listening on 0.0.0.0).

## systemd unit (suggested — infra owns the final form)

```ini
[Unit]
Description=Decent ppppp-hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/decent          # wherever the repo is cloned
Environment=HTTP_PORT=3000
Environment=PPPPP_PORT=8008
Environment=HUB_DATA_DIR=/opt/decent/hub-data
ExecStart=/usr/bin/node packages/hub/bin/decent-hub.js
Restart=on-failure
RestartSec=5
# Hub keypair (its stable identity) lives in HUB_DATA_DIR. Keep it persisted and
# backed up — if it changes, all existing invites break.

[Install]
WantedBy=multi-user.target
```

## What dev needs back from infra

Once it's running on the droplet, please record in the coordination doc
(`decent-hub-deploy.md`):

1. **Public IP / hostname** of the droplet.
2. **The `PPPPP_PORT`** you opened (default 8008) and confirmation it's reachable
   from the public internet (e.g. `nc -z <public-ip> 8008` from elsewhere).
3. The hub's **`shseCredentials`** pubkey from the bootstrap page (or just confirm
   the page loads and dev will read it).

dev (Step 4) then points both Decent nodes at `<public-ip>:<PPPPP_PORT>` + that
pubkey and confirms cross-network replication.

## Notes / gotchas (so infra isn't surprised)

- The hub source is **vendored** under `packages/hub/vendor/` on purpose: the
  published `ppppp-hub` npm package omits `HOMEPAGE.md` and `lib/public|views`
  (its `files` allow-list is too narrow), so it can't run as installed. The vendor
  copy is complete and verified. **We also patched `vendor/lib/peer.cjs`** to read
  `HUB_DATA_DIR` (upstream hardcoded `__dirname/../data`).
- **Invite URIs embed the browser's hostname.** The bootstrap page (`/`) builds the
  invite from `window.location.hostname` — so it must be loaded via the droplet's
  **public IP/DNS** (`http://<public-ip>:<HTTP_PORT>/`), not `127.0.0.1`, or the
  invite embeds localhost and is useless remotely. (Credit: infra found this.) For
  dev's Step 4 this doesn't matter — dev assembles the connection from the three
  values below, not from the web invite.
- `ppppp-caps` is pinned to the **same commit** as the client. If you ever bump
  it, bump it in `packages/backend` too or the handshake breaks.
- The hub is ESM; the launcher imports the vendored entry by path.

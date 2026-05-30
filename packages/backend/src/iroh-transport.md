# iroh-transport — interface contract (dev ↔ codex)

The seam for parallel work on Phase 1 step 3. **codex builds the transport module
to this contract; dev wires the backend (Store/API) against it.** Because both sides
build to this interface, we can develop in parallel and cross-check at the seam.

This is a desktop iroh transport that carries `ppppp-sync`'s duplex (proven in
`spike/iroh/sync-over-iroh.mjs`). It lives ALONGSIDE the existing secret-stack path
(Jackson: alongside-then-evaluate). The secret-stack `connect(address)` stays working.

## Module: `src/iroh-transport.js` (codex owns)

A factory that wraps a peer's sync engine with iroh connectivity. It does NOT know
about HTTP, the Store, or pzp internals beyond the `syncDuplex` callback handed to it.

```
createIrohTransport({ syncDuplex, onPeerConnected }) -> Promise<IrohTransport>

  // syncDuplex: () => pull-stream duplex   (the thing to carry; from the Store)
  // onPeerConnected?: (remoteNodeId: string) => void   (optional, for logging/state)

IrohTransport = {
  nodeId(): Promise<string>        // our iroh NodeId (the "code" to share)
  ticket(): Promise<string>        // optional richer connect string (addr hints)
  connect(nodeIdOrTicket: string): Promise<void>   // dial a peer, bridge sync, kick it
  close(): Promise<void>
}
```

### Required behavior (from the proven spike)
- One iroh endpoint per node, ALPN `decent/sync/0`.
- `connect()` = the DIALER: `endpoint.connect(addr, alpn)` → `openBi()`. The ACCEPT
  side handles inbound dials via the protocol handler (`acceptBi()`).
- **Framing:** 4-byte BE length-prefixed JSON, exactly as the spike
  (`encodeFrame`/`readFrame` in `spike/iroh/sync-over-iroh.mjs`). Promote that code.
- For each established bi-di stream (dialed OR accepted): call `syncDuplex()` to get
  a fresh duplex, bridge it both directions over the stream, then the caller's
  `sync.start()` drives replication.
- **Honor the ordering constraint:** iroh `acceptBi()` doesn't resolve until the
  dialer writes its first frame — so on the dial side, start bridging/sync before
  awaiting the remote, mirroring the spike's structure.
- Robust to a peer disconnecting (don't crash the process; the spike's error
  handling on `finish`/`closed` is the reference).

### What the transport needs from the caller
- `syncDuplex()` → `this.#peer.sync.connect.call({shse:{pubkey}})`. dev exposes this
  from the Store so the transport stays pzp-agnostic.
- The caller calls `peer.sync.start()` after `connect()` (or the transport can call a
  passed-in `startSync()` — TBD at the seam; default: caller does it).

## Backend wiring (dev owns)

- **`node.js`**: keep `startNode()` (secret-stack) as-is for now. The iroh path reuses
  the SAME peer's `db/dict/set/goals/sync` plugins — we do NOT need a second pzp peer,
  only a second *transport*. (The peer still loads ppppp-net/hub-client; harmless,
  unused on the iroh path. Cleanup later.)
- **`store.js`**: add `syncDuplex()` (exposes `peer.sync.connect.call(...)`),
  `irohNodeId()`, `irohConnect(codeOrTicket)`. Construct the transport in `init()`
  (or lazily), wiring `syncDuplex` to the peer. Keep existing `connect(address)`
  (secret-stack) untouched.
- **`api.js`**: add `GET /api/nodeid` → `{ nodeId, ticket }`; `POST /api/connect-iroh`
  → body `{ code }` (NodeId or ticket). Keep existing routes.

## Cross-check protocol (how we verify each other)

1. **dev writes a transport test** `spike/iroh/transport.test.mjs` that drives the
   PUBLIC interface above (two transports, exchange nodeIds, `connect`, assert a post
   replicates) — using the `makePair` harness for the pzp peers. This test is the
   executable spec; codex's module must pass it.
2. **codex implements** `src/iroh-transport.js` to pass that test.
3. **dev wires** Store/API against the same interface and writes
   `test/iroh-two-node.js` (full backend path: two `startNode` backends, dial by
   nodeId via the Store, assert replication).
4. We each run BOTH tests and report RAW output (no summaries — verified-evidence
   rule from the infra retro). Green on both = step 3 done for the in-process case.
5. Then the real cross-machine test (two laptops) — separate, manual.

## Status
- 2026-05-30 (dev): contract written. dev → transport.test.mjs + Store/API wiring.
  codex → src/iroh-transport.js. Parallel; meet at this interface.

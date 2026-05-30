# iroh spike

Phase 1 binding spike for the iroh transport swap. See
`~/obsidian/brain/projects/decent-iroh-spike.md`.

Run from the repo root:

```sh
npm run spike:iroh --workspace packages/backend
```

The script creates two in-memory iroh nodes in one process. Endpoint A dials endpoint
B by B's `NodeAddr.nodeId`, opens a QUIC bi-directional stream, sends bytes to B, and
reads B's reply.

To run the ppppp-sync over iroh adapter PoC:

```sh
npm run spike:iroh-sync --workspace packages/backend
```

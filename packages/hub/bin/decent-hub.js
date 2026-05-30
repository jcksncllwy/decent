#!/usr/bin/env node
// Decent hub launcher.
//
// A ppppp-hub is a public rendezvous/relay: nodes behind NAT connect to it and
// it cross-connects them so they can replicate. It does NOT store anyone's feed
// data — it only brokers connections. The replication protocol itself is the
// same one proven in packages/backend (test/two-node-sync.js).
//
// Config (env):
//   HTTP_PORT   web page (bootstrap/invite) port. Default 3000.
//   PPPPP_PORT  TCP port for peer secret-handshake connections. Default 8008.
//
// The hub source is vendored under ./vendor (see package.json comment for why).
// It generates and persists its own keypair under ./vendor/data on first run.
// Its ppppp-caps MUST match the clients' (pinned in package.json) or the
// handshake fails.

import { pathToFileURL } from 'node:url'
import path from 'node:path'

const httpPort = process.env.HTTP_PORT ?? 3000
const ppppPort = process.env.PPPPP_PORT ?? 8008

console.log('[decent-hub] starting...')
console.log(`[decent-hub]   HTTP_PORT  = ${httpPort} (bootstrap/invite web page)`)
console.log(`[decent-hub]   PPPPP_PORT = ${ppppPort} (peer connections, 0.0.0.0)`)

const here = path.dirname(new URL(import.meta.url).pathname)
const hubEntry = path.join(here, '..', 'vendor', 'lib', 'index.js')

await import(pathToFileURL(hubEntry).href)

console.log(`[decent-hub] running. Open http://<host>:${httpPort}/ for the invite page.`)

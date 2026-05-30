'use strict'

/**
 * Full-backend iroh path: two real Decent backends (startNode + Store) replicate
 * by dialing iroh NodeId — exercising the Store/API wiring, not the spike harness.
 *
 * This is dev's cross-check for the integration: it drives the SAME public
 * transport interface that spike/iroh/transport.test.mjs does, but through the
 * Store (irohId / irohConnect / follow / syncStart), proving the backend wiring
 * is correct end to end.
 *
 * Requires src/iroh-transport.js (codex's module). Fails cleanly until it exists.
 *
 * Run: node packages/backend/test/iroh-two-node.js
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert')
const { promisify: p } = require('node:util')
const { startNode } = require('../src/node')
const { Store } = require('../src/store')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function tmpDir(name) {
  const dir = path.join(os.tmpdir(), `decent-iroh2-${name}-${Date.now()}`)
  fs.rmSync(dir, { recursive: true, force: true })
  return dir
}

async function makeBackend(name) {
  const node = await startNode({ dataDir: tmpDir(name), port: 0 })
  const store = new Store(node)
  await store.init()
  return { name, node, store }
}

async function main() {
  // Contract handshake: bail clearly if the transport module isn't there yet.
  try {
    require.resolve('../src/iroh-transport')
  } catch {
    console.error('\nFAIL: src/iroh-transport.js missing — waiting on codex.')
    process.exit(1)
  }

  console.log('[iroh-two-node] starting two backends')
  const a = await makeBackend('alice')
  const b = await makeBackend('bob')

  // bob publishes; alice follows bob's feed.
  await b.store.post('iroh backend post #1')
  await b.store.post('iroh backend post #2')
  const bobAccount = b.store.whoami().account
  a.store.follow(bobAccount, 'all')
  b.store.follow(bobAccount, 'all')

  const before = await a.store.posts()
  assert.equal(
    before.filter((post) => post.account === bobAccount).length,
    0,
    'alice starts with no bob posts'
  )

  // bob's iroh code; alice dials it.
  const { nodeId } = await b.store.irohId()
  console.log(`[iroh-two-node] bob nodeId ${nodeId.slice(0, 12)}…`)
  console.log('[iroh-two-node] alice.irohConnect(bob)')
  await a.store.irohConnect(nodeId)
  a.store.syncStart()
  b.store.syncStart()

  let fromBob = []
  for (let i = 0; i < 40; i++) {
    await delay(150)
    fromBob = (await a.store.posts())
      .filter((post) => post.account === bobAccount)
      .map((post) => post.text)
      .sort()
    if (fromBob.length >= 2) break
  }
  console.log(`[iroh-two-node] alice holds from bob: ${JSON.stringify(fromBob)}`)

  assert.deepEqual(
    fromBob,
    ['iroh backend post #1', 'iroh backend post #2'],
    'alice replicated bob over the iroh backend path'
  )

  console.log('\nPASS: full backend replicates over iroh (dial-by-NodeId via the Store)')

  await new Promise((r) => a.node.peer.close(true, r))
  await new Promise((r) => b.node.peer.close(true, r))
  process.exit(0)
}

main().catch((err) => {
  console.error('\nFAIL:', err)
  process.exit(1)
})

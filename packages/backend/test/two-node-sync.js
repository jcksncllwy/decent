'use strict'

/**
 * Two-node sync proof: stand up two independent Decent nodes (alice, bob) in
 * temp dirs, have bob publish posts, have alice follow bob and connect, then
 * assert alice replicated bob's posts.
 *
 * This proves the replication mechanism with zero cloud — the only thing a
 * public hub later adds is reachability between NATed peers, not a different
 * protocol.
 *
 * Run: node packages/backend/test/two-node-sync.js
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert')
const { startNode } = require('../src/node')
const { Store } = require('../src/store')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function tmpDir(name) {
  const dir = path.join(os.tmpdir(), `decent-sync-${name}-${Date.now()}`)
  fs.rmSync(dir, { recursive: true, force: true })
  return dir
}

async function main() {
  console.log('[test] starting two nodes...')
  const a = await startNode({ dataDir: tmpDir('alice'), port: 0 })
  const b = await startNode({ dataDir: tmpDir('bob'), port: 0 })

  const alice = new Store(a)
  const bob = new Store(b)
  const aliceMe = await alice.init()
  const bobMe = await bob.init()
  console.log(`[test] alice: ${aliceMe.account.slice(0, 12)}…`)
  console.log(`[test] bob:   ${bobMe.account.slice(0, 12)}…`)

  // Bob publishes three posts.
  await bob.post('bob post 1')
  await bob.post('bob post 2')
  await bob.post('bob post 3')
  console.log('[test] bob published 3 posts')

  // Alice has none of bob's posts yet.
  let alicePosts = await alice.posts()
  assert.equal(
    alicePosts.filter((p) => p.account === bobMe.account).length,
    0,
    'alice should start with 0 of bob posts'
  )

  // Alice follows bob's feed; both must set goals so sync agrees on what to move.
  alice.follow(bobMe.account, 'all')
  bob.follow(bobMe.account, 'all')
  console.log('[test] alice follows bob; goals set on both sides')

  // Alice dials bob and starts syncing.
  console.log(`[test] alice dialing bob at ${b.peer.getAddress()}`)
  await alice.connect(b.peer.getAddress())
  bob.syncStart()

  // Give replication a moment.
  await delay(2000)

  alicePosts = await alice.posts()
  const fromBob = alicePosts
    .filter((p) => p.account === bobMe.account)
    .map((p) => p.text)
    .sort()
  console.log(`[test] alice now holds bob posts: ${JSON.stringify(fromBob)}`)

  assert.deepEqual(
    fromBob,
    ['bob post 1', 'bob post 2', 'bob post 3'],
    'alice should have replicated all 3 of bob posts'
  )

  console.log('\n✅ PASS: two-node replication works')

  await new Promise((r) => a.peer.close(true, r))
  await new Promise((r) => b.peer.close(true, r))
  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌ FAIL:', err)
  process.exit(1)
})

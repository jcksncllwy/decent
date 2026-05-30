'use strict'

/**
 * Step 4: replicate between two nodes via the REAL public hub on the droplet.
 *
 * Model (corrected): both nodes JOIN the hub and set goals; the ppppp-net
 * scheduler then auto-discovers co-members (via hub.attendants()) and opens
 * tunnels between them. We do NOT manually dial — we join + wait.
 *
 * Env:
 *   HUB_HOST  (default 146.190.35.76)  use 100.79.158.62 for the tailnet path
 *   HUB_PORT  (default 8008)
 *   HUB_PUBKEY (default the droplet hub's shseCredentials)
 *
 * Run: node packages/backend/test/hub-sync-remote.js
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert')
const { startNode } = require('../src/node')
const { Store } = require('../src/store')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const HUB = {
  host: process.env.HUB_HOST || '146.190.35.76',
  port: process.env.HUB_PORT || 8008,
  pubkey: process.env.HUB_PUBKEY || '3eFXbm2J9b8aGUVfFFLykAFJ9bND7zZyR4S3Dn8nWuiU',
}

// STABLE data dirs (not timestamped): keep the same identity across runs so
// hub membership carries over. Alice stays the bootstrap member; bob stays a
// remembered member after his first token-join. Pass --fresh to wipe them.
function stableDir(name) {
  const dir = path.join(os.tmpdir(), `decent-remote-${name}`)
  if (process.argv.includes('--fresh')) fs.rmSync(dir, { recursive: true, force: true })
  return dir
}

async function main() {
  console.log(`[test] using hub ${HUB.host}:${HUB.port} (${HUB.pubkey.slice(0, 10)}…)`)
  const a = await startNode({ dataDir: stableDir("alice"), port: 0 })
  const b = await startNode({ dataDir: stableDir("bob"), port: 0 })
  const alice = new Store(a)
  const bob = new Store(b)
  const aliceMe = await alice.init()
  const bobMe = await bob.init()

  // Unique marker per run so the assertion is meaningful even on a persistent
  // feed (bob keeps his posts across runs with stable dirs).
  const marker = `run-${Date.now()}`
  await bob.post(`remote hub ${marker} #1`)
  await bob.post(`remote hub ${marker} #2`)
  console.log(`[test] bob published 2 posts (marker ${marker})`)

  // Alice joins as a member; she mints a token for bob; bob joins with it.
  // (If the hub already remembers these pubkeys from a prior run, the token is
  // harmless — members are admitted regardless.)
  await alice.joinHub(HUB)
  console.log('[test] alice joined the hub')
  const { token } = await alice.mintToken(HUB)
  console.log(`[test] alice minted invite token ${token.slice(0, 10)}…`)
  await bob.joinHub({ ...HUB, token })
  console.log('[test] bob joined the hub with the token')

  // Both want bob's feed. Let the scheduler discover attendants + tunnel them.
  alice.follow(bobMe.account, 'all')
  bob.follow(bobMe.account, 'all')
  alice.syncStart()
  bob.syncStart()

  console.log('[test] waiting for scheduler to wire attendants + replicate...')
  let thisRun = []
  for (let i = 0; i < 20; i++) {
    await delay(1500)
    thisRun = (await alice.posts())
      .filter((p) => p.account === bobMe.account && p.text.includes(marker))
      .map((p) => p.text)
      .sort()
    if (thisRun.length >= 2) break
    process.stdout.write(`  …${(i + 1) * 1.5}s: alice has ${thisRun.length}/2 of this run's posts\n`)
  }

  console.log(`[test] alice holds from bob (this run): ${JSON.stringify(thisRun)}`)
  assert.deepEqual(
    thisRun,
    [`remote hub ${marker} #1`, `remote hub ${marker} #2`],
    'replicated via remote hub'
  )

  console.log('\n✅ PASS: replication via the public droplet hub works')
  await new Promise((r) => a.peer.close(true, r))
  await new Promise((r) => b.peer.close(true, r))
  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌ FAIL:', err.message)
  process.exit(1)
})

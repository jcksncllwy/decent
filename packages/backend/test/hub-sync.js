'use strict'

/**
 * Hub-mediated sync proof: start a local ppppp-hub, stand up two Decent nodes,
 * have both JOIN the hub, then have alice connect to bob *through the hub's
 * tunnel* (not a direct dial) and replicate his posts.
 *
 * This proves the exact Step 4 path locally — the only thing the real droplet
 * adds is a public IP. If this passes, cross-network sync is just reachability.
 *
 * Run (hub must be started first by this script): node packages/backend/test/hub-sync.js
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert')
const { spawn } = require('node:child_process')
const { startNode } = require('../src/node')
const { Store } = require('../src/store')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const HUB_HTTP = 3098
const HUB_PPPPP = 8098

function tmpDir(name) {
  const dir = path.join(os.tmpdir(), `decent-hubsync-${name}-${Date.now()}`)
  fs.rmSync(dir, { recursive: true, force: true })
  return dir
}

async function getHubPubkey() {
  // The hub exposes its shseCredentials on the bootstrap page (window.hubInvite).
  const res = await fetch(`http://127.0.0.1:${HUB_HTTP}/`)
  const html = await res.text()
  const m = html.match(/shseCredentials["']?\s*[:=]\s*["']([A-Za-z0-9]+)["']/)
  if (!m) throw new Error('could not read hub shseCredentials from bootstrap page')
  return m[1]
}

async function main() {
  const hubData = tmpDir('hub')
  console.log('[test] starting local hub...')
  const hub = spawn(
    process.execPath,
    [path.join(__dirname, '..', '..', 'hub', 'bin', 'decent-hub.js')],
    {
      env: { ...process.env, HTTP_PORT: HUB_HTTP, PPPPP_PORT: HUB_PPPPP, HUB_DATA_DIR: hubData },
      stdio: 'ignore',
    }
  )

  // Wait for the hub HTTP to be up.
  let hubPubkey
  for (let i = 0; i < 30; i++) {
    try {
      hubPubkey = await getHubPubkey()
      break
    } catch {
      await delay(500)
    }
  }
  if (!hubPubkey) throw new Error('hub did not come up')
  const hubAddr = { host: '127.0.0.1', port: HUB_PPPPP, pubkey: hubPubkey }
  console.log(`[test] hub up. pubkey ${hubPubkey.slice(0, 12)}…`)

  console.log('[test] starting two nodes...')
  const a = await startNode({ dataDir: tmpDir('alice'), port: 0 })
  const b = await startNode({ dataDir: tmpDir('bob'), port: 0 })
  const alice = new Store(a)
  const bob = new Store(b)
  const aliceMe = await alice.init()
  const bobMe = await bob.init()

  await bob.post('hub post 1')
  await bob.post('hub post 2')
  console.log('[test] bob published 2 posts')

  // Alice joins as the bootstrap member, then mints an invite token for bob
  // (the hub only auto-admits its first member; everyone else needs a token).
  await alice.joinHub(hubAddr)
  const { token } = await alice.mintToken(hubAddr)
  await bob.joinHub({ ...hubAddr, token })
  console.log('[test] alice joined (bootstrap); bob joined with an invite token')

  // Both declare the goal and start sync. We do NOT manually dial: the ppppp-net
  // scheduler discovers co-members via hub.attendants() and opens tunnels
  // between them automatically. We just wait for it to wire them up.
  alice.follow(bobMe.account, 'all')
  bob.follow(bobMe.account, 'all')
  alice.syncStart()
  bob.syncStart()

  console.log('[test] waiting for the scheduler to tunnel attendants + replicate...')
  let fromBob = []
  for (let i = 0; i < 20; i++) {
    await delay(1500)
    fromBob = (await alice.posts())
      .filter((p) => p.account === bobMe.account)
      .map((p) => p.text)
      .sort()
    if (fromBob.length >= 2) break
  }
  console.log(`[test] alice now holds bob posts (via hub): ${JSON.stringify(fromBob)}`)

  assert.deepEqual(fromBob, ['hub post 1', 'hub post 2'], 'alice replicated bob via hub')

  console.log('\n✅ PASS: hub-mediated replication works')

  hub.kill()
  await new Promise((r) => a.peer.close(true, r))
  await new Promise((r) => b.peer.close(true, r))
  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌ FAIL:', err)
  process.exit(1)
})

'use strict'

/**
 * Hub-mediated sync proof (WORK IN PROGRESS — see KNOWN ISSUE below).
 *
 * Starts a local ppppp-hub, stands up two Decent nodes, both JOIN the hub, then
 * replicate bob's posts to alice *through the hub tunnel*.
 *
 * STATUS: every piece works in isolation (join, invite token, the hub's
 * attendants() stream correctly reports co-members), BUT the final tunnel→sync
 * step fails. Root cause: connecting to the hub via ppppp-net (required so the
 * tunnel transport registers the hub) triggers ppppp-net's `net.ping` keepalive,
 * which throws "unexpected end of parent stream" against the hub and tears the
 * connection down (~5-10s). This is a bug in the dormant ppppp-net ping/glue
 * layer's interaction with ppppp-hub. See docs/decisions.md "Hub replication".
 *
 * Direct (hubless) two-node sync is fully working — see two-node-sync.js.
 *
 * Run: node packages/backend/test/hub-sync.js
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

  // Both declare the goal, then explicitly drive hub→tunnel→sync via
  // followHubPeers (watches attendants, tunnels to each co-member).
  alice.follow(bobMe.account, 'all')
  bob.follow(bobMe.account, 'all')
  await alice.followHubPeers(hubAddr)
  await bob.followHubPeers(hubAddr)
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

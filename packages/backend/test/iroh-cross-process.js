'use strict'

/**
 * Cross-PROCESS iroh test: the in-process tests share a LOCAL_NODE_ADDRS registry,
 * so they don't prove that dialing a bare NodeId via real iroh discovery works
 * between separate processes (the thing two laptops actually need). This runs bob
 * and alice as separate `node` child processes that ONLY exchange a bare NodeId
 * string over stdout/stdin — no shared memory, no address hints. If alice
 * replicates bob's post, real discovery-based dialing works.
 *
 * Run: node packages/backend/test/iroh-cross-process.js
 * (set DECENT_IROH_ROLE=alice|bob to run a single role child directly)
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { promisify: p } = require('node:util')

const ROLE = process.env.DECENT_IROH_ROLE

function tmpDir(name) {
  const dir = path.join(os.tmpdir(), `decent-iroh-xp-${name}-${Date.now()}`)
  fs.rmSync(dir, { recursive: true, force: true })
  return dir
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- Child role: a single backend that talks over stdout (JSON lines) --------

async function runRole() {
  const { startNode } = require('../src/node')
  const { Store } = require('../src/store')
  const say = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

  const node = await startNode({ dataDir: tmpDir(ROLE), port: 0 })
  const store = new Store(node)
  await store.init()
  const account = store.whoami().account
  const { nodeId } = await store.irohId()

  if (ROLE === 'bob') {
    await store.post('cross-process post #1')
    store.follow(account, 'all')
    say({ type: 'ready', nodeId, account })
    // Wait for parent to tell us we can exit.
    process.stdin.on('data', (b) => {
      if (b.toString().includes('done')) process.exit(0)
    })
  } else {
    // alice: wait for bob's {nodeId, account} on stdin, then dial + report.
    say({ type: 'ready', nodeId, account })
    process.stdin.on('data', async (b) => {
      const msg = JSON.parse(b.toString().trim())
      if (msg.type !== 'dial') return
      store.follow(msg.account, 'all')
      await store.irohConnect(msg.nodeId) // BARE nodeId — no address hints
      store.syncStart()
      for (let i = 0; i < 60; i++) {
        await delay(200)
        const got = (await store.posts())
          .filter((post) => post.account === msg.account)
          .map((post) => post.text)
        if (got.length >= 1) {
          say({ type: 'result', replicated: got })
          process.exit(0)
        }
      }
      say({ type: 'result', replicated: [] })
      process.exit(1)
    })
  }
}

// ---- Parent: orchestrate two child processes --------------------------------

function spawnRole(role) {
  const child = spawn(process.execPath, [__filename], {
    env: { ...process.env, DECENT_IROH_ROLE: role },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const lines = []
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) lines.push(JSON.parse(line))
    }
  })
  const waitFor = async (type, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = lines.find((l) => l.type === type)
      if (found) return found
      await delay(50)
    }
    throw new Error(`timed out waiting for "${type}" from ${role}`)
  }
  return { child, waitFor }
}

async function main() {
  console.log('[iroh-xp] spawning bob + alice as separate processes')
  const bob = spawnRole('bob')
  const alice = spawnRole('alice')

  const bobReady = await bob.waitFor('ready')
  await alice.waitFor('ready')
  console.log(`[iroh-xp] bob nodeId ${bobReady.nodeId.slice(0, 12)}… (bare, no hints)`)

  // Hand alice ONLY bob's bare nodeId + account. No address, no ticket.
  alice.child.stdin.write(JSON.stringify({ type: 'dial', nodeId: bobReady.nodeId, account: bobReady.account }) + '\n')

  const result = await alice.waitFor('result', 40000)
  bob.child.stdin.write('done\n')

  console.log(`[iroh-xp] alice replicated: ${JSON.stringify(result.replicated)}`)
  if (result.replicated.includes('cross-process post #1')) {
    console.log('\nPASS: bare-NodeId dialing via real iroh discovery works ACROSS PROCESSES')
    process.exit(0)
  } else {
    console.log('\nFAIL: no replication across processes (discovery/dial gap)')
    process.exit(1)
  }
}

if (ROLE) {
  runRole().catch((err) => {
    console.error(`[${ROLE}] error`, err)
    process.exit(1)
  })
} else {
  main().catch((err) => {
    console.error('\nFAIL:', err)
    process.exit(1)
  })
}

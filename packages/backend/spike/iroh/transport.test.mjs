// Executable spec for src/iroh-transport.js (the dev↔codex seam).
//
// dev writes this test against the PUBLIC interface; codex implements the module
// to pass it. Green here means the transport contract is satisfied independent of
// the Store/API wiring.
//
// Run: node packages/backend/spike/iroh/transport.test.mjs
//
// Interface under test (see src/iroh-transport.md):
//   createIrohTransport({ syncDuplex }) -> { nodeId(), ticket(), connect(code), close() }

import assert from 'node:assert'
import { makePair } from './harness.mjs'

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForPosts(node, accountId, expected, timeoutMs = 6000) {
  const want = [...expected].sort()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const got = (await node.postsFrom(accountId)).sort()
    if (want.every((p) => got.includes(p))) return got
    await delay(100)
  }
  return (await node.postsFrom(accountId)).sort()
}

async function main() {
  // Import the module under test. codex creates this file. Until it exists, this
  // test fails loudly with a clear message — that's the contract handshake.
  let createIrohTransport
  try {
    ;({ createIrohTransport } = await import('../../src/iroh-transport.js'))
  } catch (err) {
    console.error('\nFAIL: src/iroh-transport.js not importable yet —', err.message)
    console.error('(codex: implement createIrohTransport({ syncDuplex }) to this spec.)')
    process.exit(1)
  }

  console.log('[transport.test] building pzp pair')
  const { alice, bob, bobPosts } = await makePair()

  const before = await alice.postsFrom(bob.accountId)
  assert.deepEqual(before, [], 'alice starts with no bob posts')

  // Each side gets a transport wired to its own peer's sync duplex.
  const aliceT = await createIrohTransport({ syncDuplex: () => alice.syncDuplex() })
  const bobT = await createIrohTransport({ syncDuplex: () => bob.syncDuplex() })

  const bobId = await bobT.nodeId()
  assert.ok(typeof bobId === 'string' && bobId.length > 0, 'bob has a nodeId')
  console.log(`[transport.test] bob nodeId ${bobId.slice(0, 12)}…`)

  // alice dials bob by nodeId; both kick their sync engines.
  console.log('[transport.test] alice.connect(bob)')
  await aliceT.connect(bobId)
  alice.syncStart()
  bob.syncStart()

  const got = await waitForPosts(alice, bob.accountId, bobPosts)
  console.log(`[transport.test] alice holds: ${JSON.stringify(got)}`)

  assert.deepEqual(
    got.filter((p) => bobPosts.includes(p)).sort(),
    [...bobPosts].sort(),
    'alice replicated bob posts via the iroh transport module'
  )

  console.log('\nPASS: iroh-transport module satisfies the contract')

  await aliceT.close()
  await bobT.close()
  await alice.close()
  await bob.close()
  process.exit(0)
}

main().catch((err) => {
  console.error('\nFAIL:', err)
  process.exit(1)
})

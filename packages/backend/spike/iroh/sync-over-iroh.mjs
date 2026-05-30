import { createRequire } from 'node:module'
import assert from 'node:assert'
import { Iroh, NodeDiscoveryConfig } from '@number0/iroh'
import { makePair } from './harness.mjs'

const require = createRequire(import.meta.url)
const pull = require('pull-stream')
const Pushable = require('pull-pushable')

const ALPN = Buffer.from('decent/sync/0')
const MAX_FRAME_BYTES = 16 * 1024 * 1024
const SYNC_TIMEOUT_MS = 5000

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function encodeFrame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length, 0)
  return Buffer.concat([header, body])
}

async function readFrame(recv) {
  const header = Buffer.alloc(4)
  await recv.readExact(header)
  const len = header.readUInt32BE(0)
  if (len > MAX_FRAME_BYTES) {
    throw new Error(`refusing oversized sync frame (${len} bytes)`)
  }

  const body = Buffer.alloc(len)
  await recv.readExact(body)
  return JSON.parse(body.toString('utf8'))
}

function toIrohSink(send, label) {
  let count = 0
  return (read) => {
    const next = (end, obj) => {
      if (end) {
        if (end !== true) console.error(`[${label}] outgoing sync source ended with error`, end)
        send.finish().catch((err) => {
          console.error(`[${label}] send.finish failed`, err)
        })
        return
      }

      count += 1
      if (count <= 20) console.log(`[${label}] frame ${count} phase ${obj?.phase}`)
      send.writeAll(encodeFrame(obj))
        .then(() => read(null, next))
        .catch((err) => {
          console.error(`[${label}] send.writeAll failed`, err)
          read(err, () => {})
        })
    }

    read(null, next)
  }
}

function fromIrohSource(recv, label) {
  const source = Pushable()
  let count = 0

  ;(async () => {
    try {
      while (true) {
        const obj = await readFrame(recv)
        count += 1
        if (count <= 20) console.log(`[${label}] frame ${count} phase ${obj?.phase}`)
        source.push(obj)
      }
    } catch (err) {
      const message = err?.message ?? String(err)
      if (!/finished|closed|reset|stopped|end/i.test(message)) {
        console.error(`[${label}] recv loop failed`, err)
        source.end(err)
        return
      }
      source.end()
    }
  })()

  return source
}

function bridgeSyncDuplexOverIroh(node, stream) {
  const dup = node.syncDuplex()

  pull(dup.source, toIrohSink(stream.send, `${node.name} -> iroh`))
  pull(
    fromIrohSource(stream.recv, `iroh -> ${node.name}`),
    dup.sink
  )
}

async function waitForPosts(node, accountId, expectedPosts, timeoutMs) {
  const expected = [...expectedPosts].sort()
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const actual = (await node.postsFrom(accountId)).sort()
    if (expected.every((post) => actual.includes(post))) return actual
    await delay(100)
  }

  return (await node.postsFrom(accountId)).sort()
}

async function main() {
  console.log('[sync-over-iroh] creating pzp harness pair')
  const { alice, bob, bobPosts } = await makePair()

  let aliceIroh
  let bobIroh

  try {
    const before = await alice.postsFrom(bob.accountId)
    assert.deepEqual(before, [], 'alice should start with no bob posts')

    const bobAccepted = new Promise((resolve, reject) => {
      bobIroh = Iroh.memory({
        nodeDiscovery: NodeDiscoveryConfig.None,
        protocols: {
          [ALPN]: (err) => {
            if (err) throw err

            return {
              accept: async (err, conn) => {
                try {
                  if (err) throw err
                  console.log(`[bob-iroh] accepted ${Buffer.from(conn.alpn()).toString()}`)
                  console.log('[bob-iroh] waiting for bi-di stream')
                  const stream = await conn.acceptBi()
                  console.log('[bob-iroh] accepted bi-di stream')
                  resolve(stream)
                } catch (acceptErr) {
                  reject(acceptErr)
                }
              },
            }
          },
        },
      })
    })

    bobIroh = await bobIroh
    aliceIroh = await Iroh.memory({ nodeDiscovery: NodeDiscoveryConfig.None })

    const bobAddr = await bobIroh.net.nodeAddr()
    console.log(`[alice-iroh] dialing bob ${bobAddr.nodeId}`)
    const aliceConn = await aliceIroh.node.endpoint().connect(bobAddr, ALPN)
    console.log('[alice-iroh] connected; opening bi-di stream')
    const aliceStream = await aliceConn.openBi()
    console.log('[alice-iroh] opened bi-di stream')

    bridgeSyncDuplexOverIroh(alice, aliceStream)
    console.log('[sync-over-iroh] starting ppppp-sync; bob stream will attach after first incoming bytes')
    alice.syncStart()
    bob.syncStart()

    const bobStream = await bobAccepted
    console.log('[sync-over-iroh] bob iroh stream end is ready')
    bridgeSyncDuplexOverIroh(bob, bobStream)

    const replicated = await waitForPosts(alice, bob.accountId, bobPosts, SYNC_TIMEOUT_MS)
    console.log(`[sync-over-iroh] alice has bob posts: ${JSON.stringify(replicated)}`)

    assert.deepEqual(
      replicated.filter((post) => bobPosts.includes(post)).sort(),
      [...bobPosts].sort(),
      'alice should replicate bob posts over iroh'
    )

    console.log('\nPASS: ppppp-sync replicated bob posts over an iroh bi-di stream')
  } finally {
    await aliceIroh?.node.shutdown()
    await bobIroh?.node.shutdown()
    await alice?.close()
    await bob?.close()
  }
}

main().catch((err) => {
  console.error('\nFAIL:', err)
  process.exit(1)
})

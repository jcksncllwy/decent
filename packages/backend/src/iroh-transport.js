'use strict'

const { Iroh, NodeDiscoveryConfig } = require('@number0/iroh')
const pull = require('pull-stream')
const Pushable = require('pull-pushable')

const ALPN = Buffer.from('decent/sync/0')
const MAX_FRAME_BYTES = 16 * 1024 * 1024

// Deterministic same-process dialing for tests/local multi-node runs. Real
// cross-process dialing can use iroh discovery or the richer ticket() string.
const LOCAL_NODE_ADDRS = new Map()

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

function isExpectedClose(err) {
  const message = err?.message ?? String(err)
  return /finished|closed|reset|stopped|end|ApplicationClosed|ConnectionLost/i.test(message)
}

function toIrohSink(send, onDone) {
  return (read) => {
    const next = (end, obj) => {
      if (end) {
        if (end !== true && !isExpectedClose(end)) {
          console.error('[iroh-transport] outgoing sync source ended with error', end)
        }
        send.finish().catch((err) => {
          if (!isExpectedClose(err)) console.error('[iroh-transport] send.finish failed', err)
        }).finally(onDone)
        return
      }

      send.writeAll(encodeFrame(obj))
        .then(() => read(null, next))
        .catch((err) => {
          if (!isExpectedClose(err)) console.error('[iroh-transport] send.writeAll failed', err)
          onDone()
          read(err, () => {})
        })
    }

    read(null, next)
  }
}

function fromIrohSource(recv, onDone) {
  const source = Pushable()

  ;(async () => {
    try {
      while (true) {
        source.push(await readFrame(recv))
      }
    } catch (err) {
      source.end(isExpectedClose(err) ? true : err)
      onDone()
    }
  })()

  return source
}

function once(fn) {
  let called = false
  return () => {
    if (called) return
    called = true
    fn()
  }
}

function bridgeSyncDuplexOverIroh(syncDuplex, stream, onDone = () => {}) {
  const dup = syncDuplex()
  let remaining = 2
  let abort
  const directionDone = () => {
    remaining -= 1
    if (remaining <= 0) onDone(abort)
  }

  const abortOutgoing = pull(dup.source, toIrohSink(stream.send, once(directionDone)))
  const abortIncoming = pull(fromIrohSource(stream.recv, once(directionDone)), dup.sink)

  abort = () => {
    abortOutgoing?.(true, () => {})
    abortIncoming?.(true, () => {})
  }
  return abort
}

function parseTicket(input) {
  try {
    const parsed = JSON.parse(input)
    if (parsed && typeof parsed.nodeId === 'string') return parsed
  } catch {}
  return null
}

function normalizeNodeAddr(nodeIdOrTicket) {
  const ticket = parseTicket(nodeIdOrTicket)
  if (ticket) return ticket

  const local = LOCAL_NODE_ADDRS.get(nodeIdOrTicket)
  if (local) return local

  return { nodeId: nodeIdOrTicket }
}

async function createIrohTransport({ syncDuplex, onPeerConnected } = {}) {
  if (typeof syncDuplex !== 'function') {
    throw new TypeError('createIrohTransport requires syncDuplex()')
  }

  const aborts = new Set()
  let closed = false

  const iroh = await Iroh.memory({
    nodeDiscovery: NodeDiscoveryConfig.Default,
    protocols: {
      [ALPN]: (err) => {
        if (err) throw err

        return {
          accept: async (err, conn) => {
            if (closed) return
            if (err) {
              if (!isExpectedClose(err)) console.error('[iroh-transport] inbound accept failed', err)
              return
            }

            try {
              const remote = await conn.remoteNodeId()
              onPeerConnected?.(remote.toString())

              // acceptBi may not resolve until the dialer writes the first frame.
              // Keep this inbound path independent from outbound connect().
              const stream = await conn.acceptBi()
              if (closed) return
              const abort = bridgeSyncDuplexOverIroh(syncDuplex, stream, (done) => aborts.delete(done))
              aborts.add(abort)
            } catch (acceptErr) {
              if (!isExpectedClose(acceptErr)) {
                console.error('[iroh-transport] inbound stream setup failed', acceptErr)
              }
            }
          },
        }
      },
    },
  })

  async function currentNodeAddr() {
    const addr = await iroh.net.nodeAddr()
    LOCAL_NODE_ADDRS.set(addr.nodeId, addr)
    return addr
  }

  await currentNodeAddr()

  return {
    async nodeId() {
      return iroh.net.nodeId()
    },

    async ticket() {
      return JSON.stringify(await currentNodeAddr())
    },

    async connect(nodeIdOrTicket) {
      if (closed) throw new Error('iroh transport is closed')

      const addr = normalizeNodeAddr(nodeIdOrTicket)
      const conn = await iroh.node.endpoint().connect(addr, ALPN)
      const remote = await conn.remoteNodeId()
      onPeerConnected?.(remote.toString())

      const stream = await conn.openBi()
      const abort = bridgeSyncDuplexOverIroh(syncDuplex, stream, (done) => aborts.delete(done))
      aborts.add(abort)
    },

    async close() {
      if (closed) return
      closed = true

      for (const abort of aborts) {
        try {
          abort(true, () => {})
        } catch {}
      }
      aborts.clear()

      try {
        const addr = await iroh.net.nodeAddr()
        LOCAL_NODE_ADDRS.delete(addr.nodeId)
      } catch {}

      await iroh.node.shutdown()
    },
  }
}

module.exports = {
  createIrohTransport,
  _private: {
    encodeFrame,
    readFrame,
    normalizeNodeAddr,
  },
}

import { Iroh, NodeDiscoveryConfig } from '@number0/iroh'

const ALPN = Buffer.from('decent/iroh-spike/echo/0')
const MAX_MESSAGE_BYTES = 1024

function utf8(bytes) {
  return Buffer.from(bytes).toString('utf8')
}

function createReceiverProtocols() {
  return {
    [ALPN]: (err, endpoint) => {
      if (err) throw err

      return {
        accept: async (err, conn) => {
          if (err) throw err

          const localNodeId = endpoint.nodeId()
          const remoteNodeId = await conn.remoteNodeId()
          console.log(`[B] accepted ${Buffer.from(conn.alpn()).toString()} from ${remoteNodeId}`)
          console.log(`[B] local NodeId ${localNodeId}`)

          const stream = await conn.acceptBi()
          const fromA = await stream.recv.readToEnd(MAX_MESSAGE_BYTES)
          console.log(`[B] received: ${utf8(fromA)}`)

          await stream.send.writeAll(Buffer.from('hello from endpoint B'))
          await stream.send.finish()
          console.log('[B] sent reply')
        },
      }
    },
  }
}

const endpointOptions = {
  nodeDiscovery: NodeDiscoveryConfig.None,
}

let nodeA
let nodeB

try {
  nodeB = await Iroh.memory({
    ...endpointOptions,
    protocols: createReceiverProtocols(),
  })
  nodeA = await Iroh.memory(endpointOptions)

  const nodeAId = await nodeA.net.nodeId()
  const nodeBAddr = await nodeB.net.nodeAddr()
  const endpointA = nodeA.node.endpoint()

  console.log(`[A] local NodeId ${nodeAId}`)
  console.log(`[B] dialable NodeId ${nodeBAddr.nodeId}`)
  console.log(`[B] direct addresses ${JSON.stringify(nodeBAddr.addresses ?? [])}`)

  const conn = await endpointA.connect(nodeBAddr, ALPN)
  console.log(`[A] connected to ${await conn.remoteNodeId()}`)

  const stream = await conn.openBi()
  await stream.send.writeAll(Buffer.from('hello from endpoint A'))
  await stream.send.finish()
  console.log('[A] sent message')

  const fromB = await stream.recv.readToEnd(MAX_MESSAGE_BYTES)
  console.log(`[A] received: ${utf8(fromB)}`)
} finally {
  await nodeA?.node.shutdown()
  await nodeB?.node.shutdown()
}

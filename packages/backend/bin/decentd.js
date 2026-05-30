#!/usr/bin/env node
'use strict'

const { startNode } = require('../src/node')
const { Store } = require('../src/store')
const { createApiServer } = require('../src/api')

const PORT = Number(process.env.DECENT_PORT) || 8008
const DATA_DIR = process.env.DECENT_DATA

async function main() {
  console.log('[decentd] starting pzp node...')
  const { peer, keypair, dataDir } = await startNode({ dataDir: DATA_DIR })
  console.log(`[decentd] data dir: ${dataDir}`)

  const store = new Store({ peer, keypair, dataDir })
  const me = await store.init()
  console.log(`[decentd] identity ready`)
  console.log(`[decentd]   account: ${me.account}`)
  console.log(`[decentd]   pubkey:  ${me.pubkey}`)

  // Proof of life: publish a hello post on first run if the feed is empty.
  const existing = await store.posts()
  if (existing.length === 0) {
    const post = await store.post('hello from Decent 🌱')
    console.log(`[decentd] published first post: ${post.id}`)
  } else {
    console.log(`[decentd] ${existing.length} post(s) already in feed`)
  }

  const server = createApiServer(store)
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[decentd] API listening on http://127.0.0.1:${PORT}`)
  })

  const shutdown = () => {
    console.log('\n[decentd] shutting down...')
    server.close()
    peer.close(true, () => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[decentd] fatal:', err)
  process.exit(1)
})

// Spike harness: build two ready-to-sync pzp nodes without ppppp-net/secret-stack
// networking. dev provides this so the adapter spike can focus on the iroh framing,
// not Decent internals. NOT production code — spike only.
//
// Each returned node has: { peer, keypair, accountId, pubkey, post, follow, posts }.
// The `peer` already has db/dict/set/goals/sync plugins loaded (via startNode).
// We deliberately do NOT call net.start() — we are NOT using ppppp-net here; the
// whole point is to carry peer.sync.connect()'s duplex over iroh instead.

import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const { promisify: p } = require('node:util')
const { startNode } = require('../../src/node.js')

function tmpDir(name) {
  const dir = path.join(os.tmpdir(), `decent-iroh-spike-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  fs.rmSync(dir, { recursive: true, force: true })
  return dir
}

/** Build one ready node. */
export async function makeNode(name) {
  const { peer, keypair } = await startNode({ dataDir: tmpDir(name), port: 0 })

  const accountId = await p(peer.db.account.findOrCreate)({
    keypair,
    subdomain: 'person',
  })
  // ppppp-set must be loaded before goals/sync use it.
  await p(peer.set.load)(accountId)

  const pubkey = keypair.public

  return {
    name,
    peer,
    keypair,
    accountId,
    pubkey,

    /** Publish a text post; returns the record. */
    async post(text) {
      return p(peer.db.feed.publish)({ account: accountId, domain: 'post', data: { text } })
    },

    /** Declare a replication goal for another account's 'post' feed. */
    follow(otherAccountId, goal = 'all') {
      const feedId = peer.db.feed.getID(otherAccountId, 'post')
      peer.goals.set(feedId, goal)
      return feedId
    },

    /** All 'post' texts this node currently holds for a given account (newest-first not guaranteed). */
    async postsFrom(otherAccountId) {
      const out = []
      for await (const rec of peer.db.records()) {
        if (!rec?.msg?.data) continue
        if (rec.msg.metadata?.domain !== 'post') continue
        if (rec.msg.metadata?.account !== otherAccountId) continue
        if (typeof rec.msg.data.text === 'string') out.push(rec.msg.data.text)
      }
      return out
    },

    /**
     * The pull-stream duplex that ppppp-sync wants carried over a transport.
     * THIS is what the iroh adapter must pipe to the remote peer's equivalent.
     * Returns { source, sink } (standard pull-stream duplex of {id,phase,payload}).
     */
    syncDuplex() {
      return peer.sync.connect.call({ shse: { pubkey } })
    },

    /** Kick the sync engine. */
    syncStart() {
      peer.sync.start()
    },

    async close() {
      await new Promise((r) => peer.close(true, r))
    },
  }
}

/** Build alice + bob, with bob having published `posts`, and alice following bob. */
export async function makePair(bobPosts = ['hello over iroh #1', 'hello over iroh #2']) {
  const alice = await makeNode('alice')
  const bob = await makeNode('bob')
  for (const text of bobPosts) await bob.post(text)
  alice.follow(bob.accountId, 'all')
  bob.follow(bob.accountId, 'all') // bob must also goal its own feed for sync to offer it
  return { alice, bob, bobPosts }
}

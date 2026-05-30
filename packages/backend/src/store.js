'use strict'

const { promisify: p } = require('node:util')

/**
 * A thin, promise-based wrapper over a started pzp node's `db` plugin.
 *
 * This is the single place where Decent talks to pzp. The HTTP API and the CLI
 * both go through here, so humans and agents share exactly one code path to the
 * underlying feed — keeping them co-equal by construction.
 *
 * pzp's db methods are Node-style callbacks; we promisify them here.
 */
class Store {
  #peer
  #keypair
  #accountId

  constructor({ peer, keypair }) {
    this.#peer = peer
    this.#keypair = keypair
  }

  /**
   * Ensure this node has an account (the root of its identity tangle) and a
   * 'post' feed moot. Idempotent — safe to call on every startup.
   */
  async init() {
    this.#accountId = await p(this.#peer.db.account.findOrCreate)({
      keypair: this.#keypair,
      subdomain: 'person',
    })
    return this.whoami()
  }

  whoami() {
    return {
      account: this.#accountId,
      pubkey: this.#keypair.public,
    }
  }

  /** Publish a text post to this node's 'post' feed. */
  async post(text) {
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('post text must be a non-empty string')
    }
    const rec = await p(this.#peer.db.feed.publish)({
      account: this.#accountId,
      domain: 'post',
      data: { text },
    })
    return toPost(rec)
  }

  /**
   * Return all posts currently in the database, newest first.
   * For now this is every 'post'-domain message we hold (ours + anyone we sync
   * with later). Pagination/filtering comes later.
   */
  async posts() {
    const out = []
    for await (const rec of this.#peer.db.records()) {
      if (!rec.msg || !rec.msg.data) continue // deleted/erased
      if (rec.msg.metadata?.domain !== 'post') continue
      if (typeof rec.msg.data.text !== 'string') continue
      out.push(toPost(rec))
    }
    out.sort((a, b) => b.received - a.received)
    return out
  }

  /** Delete a message from our database by ID (pzp supports real deletion). */
  async del(msgId) {
    await p(this.#peer.db.del)(msgId)
    return { deleted: msgId }
  }

  // ---- Replication ----------------------------------------------------------

  /** This node's own connectable address (hand to a peer so they can dial us). */
  address() {
    return this.#peer.getAddress()
  }

  /**
   * Follow another account's 'post' feed: declare a replication goal for it so
   * sync will pull its messages. `goal` defaults to 'all' (full feed).
   */
  follow(accountId, goal = 'all') {
    const feedId = this.#peer.db.feed.getID(accountId, 'post')
    this.#peer.goals.set(feedId, goal)
    return { feed: feedId, goal }
  }

  /**
   * Connect to a peer by address and run a sync pass. Both sides must have set
   * matching goals for the feeds they care about. Returns when the dial
   * resolves; replication then proceeds in the background until `syncStop()`.
   */
  async connect(address) {
    const rpc = await p(this.#peer.connect)(address)
    this.#peer.sync.start()
    return rpc
  }

  /** Start the sync scheduler (replicate goaled feeds with connected peers). */
  syncStart() {
    this.#peer.sync.start()
  }
}

/** Normalize a pzp record into Decent's wire shape for a post. */
function toPost(rec) {
  return {
    id: rec.id,
    text: rec.msg.data.text,
    account: rec.msg.metadata.account,
    received: rec.received ?? Date.now(),
  }
}

module.exports = { Store }

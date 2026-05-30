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
  #iroh

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
    // ppppp-set must be loaded for our account before it can be written to.
    // The hub-client persists joined hubs into a Set feed, so this is required
    // before joinHub() works.
    await p(this.#peer.set.load)(this.#accountId)
    // Always offer our own posts to connected peers. Pulling a friend's posts
    // still requires an explicit follow goal for their account.
    this.follow(this.#accountId, 'all')
    // Now that the Set is loaded, start the net scheduler (it reads the Set on
    // start for hub discovery, so it must run after set.load — which is why we
    // disable autostart in node.js). This is what registers hub connections in
    // the tunnel transport's hub map so connectViaHub() can find them.
    this.#peer.net.start()
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

  // ---- iroh transport (dial-by-code, NAT-traversing; alongside secret-stack) --

  /**
   * The pull-stream duplex ppppp-sync wants carried over a transport. The iroh
   * transport bridges this over a QUIC stream. Kept pzp-internal here so the
   * transport module stays pzp-agnostic.
   */
  syncDuplex() {
    return this.#peer.sync.connect.call({ shse: { pubkey: this.#keypair.public } })
  }

  /** Lazily create the iroh transport, wiring it to this peer's sync duplex. */
  async #irohTransport() {
    if (!this.#iroh) {
      const { createIrohTransport } = require('./iroh-transport')
      this.#iroh = await createIrohTransport({
        syncDuplex: () => this.syncDuplex(),
      })
    }
    return this.#iroh
  }

  /** Our iroh NodeId + ticket — the "code" a friend pastes to connect to us. */
  async irohId() {
    const t = await this.#irohTransport()
    return { nodeId: await t.nodeId(), ticket: await t.ticket() }
  }

  /** Dial a peer by their iroh NodeId (or ticket) and start syncing. */
  async irohConnect(code) {
    const t = await this.#irohTransport()
    await t.connect(code)
    this.#peer.sync.start()
    return { connected: code }
  }

  // ---- Hub connectivity (reach peers behind NAT via a public ppppp-hub) ------

  /**
   * Join a hub so it can tunnel connections between us and other members.
   * Builds the multiaddr ppppp-net wants (modern multiaddr URI form):
   *   `/net/<host>/tcp/<port>/shse/<pubkey>[.<token>]`
   *
   * The hub only auto-admits its FIRST (bootstrap) member. Everyone else must
   * present an invite `token` (minted by an existing member via mintToken()),
   * which rides in the secret-handshake `extra` field. Once admitted, you're a
   * remembered member and can rejoin tokenless.
   *
   * @param {{host: string, port: number|string, pubkey: string, token?: string}} hub
   */
  async joinHub({ host, port, pubkey, token }) {
    const cred = token ? `${pubkey}.${token}` : pubkey
    const multiaddr = `/net/${host}/tcp/${port}/shse/${cred}`
    await p(this.#peer.hubClient.addHub)(multiaddr)
    return { hub: multiaddr }
  }

  /**
   * Mint a one-time invite token from a hub we're connected to. Hand the token
   * to a friend so they can join the hub. (The hub allows this anonymously, but
   * in practice you call it after you've joined.)
   * @param {string} hubPubkey the hub's shse pubkey
   */
  async mintToken({ host, port, pubkey }) {
    // Raw peer.connect uses the legacy multiserver address form (not the
    // multiaddr URI form that addHub wants).
    const rpc = await p(this.#peer.connect)(`net:${host}:${port}~shse:${pubkey}`)
    const token = await p(rpc.hub.createToken)()
    return { token }
  }

  /**
   * Connect to a hub, watch its attendants, and open a tunnel to each co-member
   * as they appear — which triggers ppppp-sync automatically. This drives the
   * hub→tunnel→sync chain explicitly rather than relying on the ppppp-net
   * scheduler (whose auto-discovery proved unreliable). Returns a stop fn.
   *
   * @param {{host: string, port: number|string, pubkey: string}} hub
   */
  async followHubPeers({ host, port, pubkey: hubPubkey }) {
    const pull = require('pull-stream')
    const rpc = await p(this.#peer.connect)(`net:${host}:${port}~shse:${hubPubkey}`)
    const me = this.#keypair.public
    const tunneled = new Set()

    const drain = pull.drain((attendants) => {
      for (const peerPubkey of attendants) {
        if (peerPubkey === me || tunneled.has(peerPubkey)) continue
        tunneled.add(peerPubkey)
        const addr = `tunnel:${hubPubkey}:${peerPubkey}~shse:${peerPubkey}`
        this.#peer.connect(addr, (err) => {
          if (err) {
            tunneled.delete(peerPubkey) // allow retry on the next emit
          } else {
            this.#peer.sync.start()
          }
        })
      }
    })
    pull(rpc.hub.attendants(), drain)
    return () => drain.abort && drain.abort()
  }

  /**
   * Connect to a peer *through* a hub and start syncing. The hub brokers the
   * connection; the replication protocol is identical to a direct dial.
   * Address form (multiaddr URI): `/tunnel/<hubPubkey>.<peerPubkey>/shse/<peerPubkey>`.
   * @param {string} hubPubkey  the hub's shse pubkey
   * @param {string} peerPubkey the target peer's shse pubkey
   */
  async connectViaHub(hubPubkey, peerPubkey) {
    // Legacy multiserver address form (what raw peer.connect parses):
    //   tunnel:<hubPubkey>:<peerPubkey>~shse:<peerPubkey>
    const address = `tunnel:${hubPubkey}:${peerPubkey}~shse:${peerPubkey}`
    const rpc = await p(this.#peer.connect)(address)
    this.#peer.sync.start()
    return rpc
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

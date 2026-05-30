'use strict'

const { promisify: p } = require('node:util')
const path = require('node:path')
const fs = require('node:fs')
const Keypair = require('ppppp-keypair')

/**
 * Mirror manager — the pzp side of account mirroring (see
 * src/mirror/INGEST_CONTRACT.md and the [[decent-mirroring]] vault doc).
 *
 * For each mirrored source account (e.g. an Instagram handle) the user's node:
 *  - creates a distinct pzp account with its OWN fresh keypair (subdomain 'mirror'),
 *  - stamps a replicable `profile` meta message (source/handle/managedBy),
 *  - publishes the source's posts into that feed, deduped by source id.
 *
 * The mirror's keypair lives on THIS node — we are the responsible publisher. Mirror
 * feeds are first-class and replicate to peers (decision 2). Multiple users mirroring
 * the same handle = different pzp accounts = the resilience mechanism (decision 4).
 *
 * This module is platform-agnostic: it takes already-normalized ingest data (the
 * contract JSON) and does pzp I/O. Instagram/Instaloader specifics live in the
 * separate ingest service.
 */
class MirrorManager {
  #peer
  #ownAccount
  #dataDir
  /** @type {Map<string, {account: string, keypair: object}>} key = `${platform}:${handle}` */
  #mirrors = new Map()

  /**
   * @param {object} opts
   * @param {object} opts.peer - the started pzp peer.
   * @param {string} opts.ownAccount - the node's own (native) account id (the manager).
   * @param {string} opts.dataDir - node data dir; mirror keypairs persist under here.
   */
  constructor({ peer, ownAccount, dataDir }) {
    this.#peer = peer
    this.#ownAccount = ownAccount
    this.#dataDir = dataDir
    this.#load()
  }

  get #storePath() {
    return path.join(this.#dataDir, 'mirrors.json')
  }

  /** Load the handle→{account,keypair} registry from disk. */
  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.#storePath, 'utf8'))
      for (const [key, entry] of Object.entries(raw)) this.#mirrors.set(key, entry)
    } catch {
      // no registry yet — fine.
    }
  }

  #persist() {
    const obj = Object.fromEntries(this.#mirrors)
    fs.mkdirSync(this.#dataDir, { recursive: true })
    fs.writeFileSync(this.#storePath, JSON.stringify(obj, null, 2), { mode: 0o600 })
  }

  #key(platform, handle) {
    return `${platform}:${handle.toLowerCase()}`
  }

  /**
   * Ensure a mirror account exists for (platform, handle). Idempotent: returns the
   * existing one or creates a fresh-keypair account + stamps its profile.
   * @param {{platform: string, handle: string, profile?: object}} args
   * @returns {Promise<{account: string, created: boolean}>}
   */
  async ensureMirror({ platform, handle, profile }) {
    const key = this.#key(platform, handle)
    const existing = this.#mirrors.get(key)
    if (existing) return { account: existing.account, created: false }

    const keypair = Keypair.generate('ed25519')
    const account = await p(this.#peer.db.account.create)({ keypair, subdomain: 'mirror' })

    // A replicable profile/meta message so peers learn this is a mirror, of whom,
    // and which account is responsible for it.
    await p(this.#peer.db.feed.publish)({
      keypair,
      account,
      domain: 'profile',
      data: {
        source: { platform, handle, profileUrl: profile?.profileUrl },
        fullName: profile?.fullName,
        bio: profile?.bio,
        avatarUrl: profile?.avatarUrl,
        managedBy: this.#ownAccount,
        mirroredAt: new Date().toISOString(),
      },
    })

    this.#mirrors.set(key, { account, keypair })
    this.#persist()
    return { account, created: true }
  }

  /**
   * Publish ingest posts into a mirror feed, deduped by source id. Returns how many
   * new posts were published.
   * @param {{platform: string, handle: string, posts: Array<object>}} args
   */
  async publishPosts({ platform, handle, posts }) {
    const key = this.#key(platform, handle)
    const entry = this.#mirrors.get(key)
    if (!entry) throw new Error(`no mirror for ${key} — call ensureMirror first`)

    const have = await this.#publishedSourceIds(entry.account)
    let published = 0
    // Publish oldest-first so the feed reads chronologically.
    for (const post of [...posts].reverse()) {
      if (!post?.sourceId || have.has(post.sourceId)) continue
      await p(this.#peer.db.feed.publish)({
        keypair: entry.keypair,
        account: entry.account,
        domain: 'post',
        data: {
          text: post.caption ?? '',
          source: {
            platform,
            handle,
            sourceId: post.sourceId,
            url: post.url,
            postedAt: post.postedAt,
          },
          media: post.media ?? [],
        },
      })
      have.add(post.sourceId)
      published++
    }
    return { published }
  }

  /** Source ids already mirrored into an account's 'post' feed (for dedup). */
  async #publishedSourceIds(account) {
    const ids = new Set()
    for await (const rec of this.#peer.db.records()) {
      if (rec?.msg?.metadata?.account !== account) continue
      if (rec.msg.metadata?.domain !== 'post') continue
      const id = rec.msg?.data?.source?.sourceId
      if (id) ids.add(id)
    }
    return ids
  }

  /** The latest mirrored post's source (for freshness comparison). */
  async latestMirroredSource(account) {
    let latest = null
    for await (const rec of this.#peer.db.records()) {
      if (rec?.msg?.metadata?.account !== account) continue
      if (rec.msg.metadata?.domain !== 'post') continue
      const src = rec.msg?.data?.source
      if (!src?.postedAt) continue
      if (!latest || src.postedAt > latest.postedAt) latest = src
    }
    return latest
  }

  /** List all mirrors this node manages: {platform, handle, account}. */
  list() {
    return [...this.#mirrors.entries()].map(([key, e]) => {
      const [platform, handle] = key.split(':')
      return { platform, handle, account: e.account }
    })
  }

  /**
   * The mirror's profile metadata (from its replicable `profile` message): source,
   * fullName, avatarUrl, managedBy. Works for ANY mirror account we hold OR have
   * replicated from a peer — so the UI can badge mirrors it didn't create itself.
   * Returns null if the account has no profile message (i.e. not a known mirror).
   */
  async profileOf(account) {
    for await (const rec of this.#peer.db.records()) {
      if (!rec?.msg?.data) continue
      if (rec.msg.metadata?.account !== account) continue
      if (rec.msg.metadata?.domain !== 'profile') continue
      if (rec.msg.data.source) return rec.msg.data
    }
    return null
  }

  /** Look up a mirror's account by handle. */
  accountFor(platform, handle) {
    return this.#mirrors.get(this.#key(platform, handle))?.account ?? null
  }

  /**
   * Compute a freshness verdict given the source's latest (from the ingest
   * `freshness` command). Pure — no I/O. The caller fetches `sourceLatest`.
   * @param {string} account - mirror account.
   * @param {{sourceId: string, postedAt: string}|null} sourceLatest
   */
  async freshness(account, sourceLatest) {
    const mirrored = await this.latestMirroredSource(account)
    if (!sourceLatest) return { state: 'unknown', reason: 'no source signal' }
    if (!mirrored) {
      return { state: 'stale', mirroredLatest: null, sourceLatest, reason: 'nothing mirrored yet' }
    }
    const upToDate = mirrored.sourceId === sourceLatest.sourceId
    return {
      state: upToDate ? 'fresh' : 'stale',
      mirroredLatest: { sourceId: mirrored.sourceId, postedAt: mirrored.postedAt },
      sourceLatest,
    }
  }
}

module.exports = { MirrorManager }

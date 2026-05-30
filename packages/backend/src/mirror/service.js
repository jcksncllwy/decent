'use strict'

const { MirrorManager } = require('./manager')
const { fetchProfile, fetchFreshness } = require('./ingest')

/**
 * MirrorService — orchestrates the ingest CLI + the pzp mirror manager. This is what
 * the HTTP API calls. It owns the "mirror a handle" and "check freshness" flows end
 * to end: shell out to ingest, then create/publish via the manager.
 */
class MirrorService {
  #manager
  #store

  /**
   * @param {object} opts
   * @param {import('./manager').MirrorManager} opts.manager
   * @param {object} opts.store - the Decent Store (to follow mirrors into the feed).
   */
  constructor({ manager, store }) {
    this.#manager = manager
    this.#store = store
  }

  static create({ peer, ownAccount, dataDir, store }) {
    const manager = new MirrorManager({ peer, ownAccount, dataDir })
    return new MirrorService({ manager, store })
  }

  /**
   * Mirror one Instagram handle: fetch its recent posts, ensure the mirror account,
   * publish new posts, and follow the mirror so it shows in the feed.
   * @param {string} handle
   * @param {{limit?: number}} [opts]
   */
  async mirrorInstagram(handle, { limit } = {}) {
    const data = await fetchProfile(handle, { limit })
    const { account, created } = await this.#manager.ensureMirror({
      platform: 'instagram',
      handle: data.handle,
      profile: data.profile,
    })
    const { published } = await this.#manager.publishPosts({
      platform: 'instagram',
      handle: data.handle,
      posts: data.posts,
    })
    // Follow the mirror so its posts appear in the user's feed.
    this.#store.follow(account)
    this.#store.syncStart()
    return { handle: data.handle, account, created, published }
  }

  /** Mirror several handles; returns per-handle results (errors captured, not thrown). */
  async mirrorInstagramMany(handles, opts) {
    const results = []
    for (const handle of handles) {
      try {
        results.push({ ok: true, ...(await this.mirrorInstagram(handle, opts)) })
      } catch (err) {
        results.push({ ok: false, handle, error: err.message, kind: err.kind || 'other' })
      }
    }
    return results
  }

  /** List mirrors this node manages (account + handle + platform). */
  list() {
    return this.#manager.list()
  }

  /**
   * Freshness of a mirror: shell out for the source's latest, compare to mirrored.
   * @param {string} platform @param {string} handle
   */
  async freshness(platform, handle) {
    const account = this.#manager.accountFor(platform, handle)
    if (!account) {
      const e = new Error(`no mirror for ${platform}:${handle}`)
      e.kind = 'notfound'
      throw e
    }
    const probe = await fetchFreshness(handle)
    const verdict = await this.#manager.freshness(account, probe.latest)
    return { platform, handle, account, ...verdict }
  }
}

module.exports = { MirrorService }

'use strict'

const { MirrorManager } = require('./manager')
const { fetchProfiles, fetchFreshness } = require('./ingest')

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
   * Mirror one or more Instagram handles. Fetches ALL handles in a SINGLE ingest
   * run (one Instaloader instance — never a per-handle loop, which would defeat
   * Instaloader's rate management), then does the local pzp work (create mirror,
   * publish, follow) per handle. Returns per-handle results; a per-handle failure
   * is captured, not thrown.
   * @param {string[]} handles
   * @param {{limit?: number}} [opts]
   */
  async mirrorInstagramMany(handles, { limit } = {}) {
    // ONE network run for the whole batch.
    const batch = await fetchProfiles(handles, { limit })

    const out = []
    for (const r of batch.results ?? []) {
      // The ingest CLI reports per-handle errors in-band (no network retry here).
      if (r.error) {
        out.push({ ok: false, handle: r.handle, error: r.error, kind: r.kind || 'other' })
        continue
      }
      try {
        const { account, created } = await this.#manager.ensureMirror({
          platform: 'instagram',
          handle: r.handle,
          profile: r.profile,
        })
        const { published } = await this.#manager.publishPosts({
          platform: 'instagram',
          handle: r.handle,
          posts: r.posts,
        })
        this.#store.follow(account) // surface mirrored posts in the feed
        out.push({ ok: true, handle: r.handle, account, created, published })
      } catch (err) {
        out.push({ ok: false, handle: r.handle, error: err.message, kind: 'pzp' })
      }
    }
    this.#store.syncStart()
    return out
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
    const batch = await fetchFreshness([handle])
    const r = (batch.results ?? [])[0]
    if (!r || r.error) {
      const e = new Error(r?.error || 'freshness probe failed')
      e.kind = r?.kind || 'other'
      throw e
    }
    const verdict = await this.#manager.freshness(account, r.latest)
    return { platform, handle, account, ...verdict }
  }
}

module.exports = { MirrorService }

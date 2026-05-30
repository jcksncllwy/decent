'use strict'

/**
 * Mirror manager test — pzp side, using FIXTURE ingest data (no Instagram needed).
 * Builds against the contract (src/mirror/INGEST_CONTRACT.md), so dev's half is
 * verified independently of codex's ingest service.
 *
 * Proves: create a mirror (fresh keypair + profile meta), publish posts with dedup,
 * idempotent re-mirror, and the freshness verdict (fresh vs stale).
 *
 * Run: node packages/backend/test/mirror-manager.js
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert')
const { promisify: p } = require('node:util')
const { startNode } = require('../src/node')
const { MirrorManager } = require('../src/mirror/manager')

function tmpDir() {
  const dir = path.join(os.tmpdir(), `decent-mirror-${Date.now()}`)
  fs.rmSync(dir, { recursive: true, force: true })
  return dir
}

// Fixture matching the ingest `fetch` contract.
const FETCH = {
  platform: 'instagram',
  handle: 'chef_jane',
  profile: { fullName: 'Jane Doe', bio: 'chef', avatarUrl: 'https://x/a.jpg', postCount: 2 },
  posts: [
    { sourceId: 'P2', url: 'https://ig/p/P2', postedAt: '2026-05-29T14:00:00Z', caption: 'newer', media: [] },
    { sourceId: 'P1', url: 'https://ig/p/P1', postedAt: '2026-05-28T10:00:00Z', caption: 'older', media: [] },
  ],
}

async function main() {
  const dataDir = tmpDir()
  const { peer, keypair } = await startNode({ dataDir })
  const ownAccount = await p(peer.db.account.findOrCreate)({ keypair, subdomain: 'person' })
  await p(peer.set.load)(ownAccount)

  const mgr = new MirrorManager({ peer, ownAccount, dataDir })

  // 1. ensureMirror creates a fresh-keypair account + profile.
  const { account, created } = await mgr.ensureMirror({
    platform: 'instagram', handle: 'chef_jane', profile: FETCH.profile,
  })
  assert.ok(created, 'mirror created on first call')
  assert.ok(account && account !== ownAccount, 'mirror account distinct from own')

  // idempotent
  const again = await mgr.ensureMirror({ platform: 'instagram', handle: 'chef_jane' })
  assert.equal(again.account, account, 'ensureMirror idempotent')
  assert.equal(again.created, false, 'second ensureMirror does not re-create')

  // 2. publish posts (dedup).
  const r1 = await mgr.publishPosts({ platform: 'instagram', handle: 'chef_jane', posts: FETCH.posts })
  assert.equal(r1.published, 2, 'published both posts')

  const r2 = await mgr.publishPosts({ platform: 'instagram', handle: 'chef_jane', posts: FETCH.posts })
  assert.equal(r2.published, 0, 're-publish is fully deduped')

  // a new post arrives
  const r3 = await mgr.publishPosts({
    platform: 'instagram', handle: 'chef_jane',
    posts: [{ sourceId: 'P3', url: 'https://ig/p/P3', postedAt: '2026-05-30T09:00:00Z', caption: 'newest', media: [] }],
  })
  assert.equal(r3.published, 1, 'only the new post is published')

  // 3. the profile meta message is in the mirror feed.
  let hasProfile = false
  for await (const rec of peer.db.records()) {
    if (!rec?.msg?.data) continue // skip moots / deleted
    if (rec.msg.metadata?.account === account && rec.msg.metadata?.domain === 'profile') {
      assert.equal(rec.msg.data.source.handle, 'chef_jane', 'profile carries handle')
      assert.equal(rec.msg.data.managedBy, ownAccount, 'profile names the managing account')
      hasProfile = true
    }
  }
  assert.ok(hasProfile, 'mirror feed has a profile meta message')

  // 4. freshness: source latest == P3 (we have it) => fresh; source latest == P9 => stale.
  const fresh = await mgr.freshness(account, { sourceId: 'P3', postedAt: '2026-05-30T09:00:00Z' })
  assert.equal(fresh.state, 'fresh', 'up to date when source latest is already mirrored')

  const stale = await mgr.freshness(account, { sourceId: 'P9', postedAt: '2026-06-01T00:00:00Z' })
  assert.equal(stale.state, 'stale', 'stale when source has a newer post we lack')

  // 5. list + lookup.
  assert.deepEqual(mgr.list(), [{ platform: 'instagram', handle: 'chef_jane', account }], 'lists the mirror')
  assert.equal(mgr.accountFor('instagram', 'CHEF_JANE'), account, 'lookup is case-insensitive')

  console.log('\nPASS: mirror manager creates/publishes/dedups/freshness over fixture ingest data')
  await new Promise((r) => peer.close(true, r))
  process.exit(0)
}

main().catch((err) => {
  console.error('\nFAIL:', err)
  process.exit(1)
})

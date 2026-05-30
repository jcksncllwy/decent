'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')

const ingestPath = path.resolve(__dirname, '../src/mirror/ingest.js')

let freshnessCalls = 0
require.cache[ingestPath] = {
  id: ingestPath,
  filename: ingestPath,
  loaded: true,
  exports: {
    fetchProfiles: async () => {
      throw new Error('fetchProfiles should not be called')
    },
    fetchFreshness: async (handles) => {
      freshnessCalls++
      assert.deepEqual(handles, ['chef_jane', 'baker_bob'])
      return {
        platform: 'instagram',
        checkedAt: '2026-05-30T00:00:00Z',
        results: [
          { handle: 'chef_jane', latest: { sourceId: 'P2', postedAt: '2026-05-30T00:00:00Z' } },
          { handle: 'baker_bob', error: 'private profile', kind: 'private' },
        ],
      }
    },
  },
}

const { MirrorService } = require('../src/mirror/service')

async function main() {
  const manager = {
    accountFor(platform, handle) {
      assert.equal(platform, 'instagram')
      return `account:${handle}`
    },
    async freshness(account, sourceLatest) {
      return { state: 'fresh', account, sourceLatest }
    },
  }

  const service = new MirrorService({ manager, store: {} })
  const results = await service.freshnessMany([
    { platform: 'instagram', handle: 'chef_jane' },
    { platform: 'instagram', handle: 'baker_bob' },
  ])

  assert.equal(freshnessCalls, 1)
  assert.deepEqual(results, [
    {
      platform: 'instagram',
      handle: 'chef_jane',
      account: 'account:chef_jane',
      state: 'fresh',
      sourceLatest: { sourceId: 'P2', postedAt: '2026-05-30T00:00:00Z' },
    },
    {
      platform: 'instagram',
      handle: 'baker_bob',
      account: 'account:baker_bob',
      error: 'private profile',
      kind: 'private',
    },
  ])

  console.log('PASS: mirror service batches freshness probes into one ingest run')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

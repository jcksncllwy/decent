'use strict'

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const Keypair = require('ppppp-keypair')

/**
 * Assemble and start a Decent pzp node.
 *
 * This is the heart of Decent: a secret-stack peer with the ppppp-db plugin,
 * which gives us the account tangle, feeds, deletion, and (later) sync.
 *
 * Portability note: we depend on ppppp-keypair, which uses `sodium-universal`
 * for crypto. We must NEVER import `sodium-native` directly — sodium-universal's
 * `browser`/`react-native` field swaps the native addon for a WASM/JS fallback,
 * which is what keeps the mobile door open. See docs/decisions.md.
 *
 * @param {object} [opts]
 * @param {string} [opts.dataDir] - where to store the node's data + keypair.
 * @returns {Promise<{ peer: object, keypair: object, dataDir: string }>}
 */
async function startNode(opts = {}) {
  const dataDir =
    opts.dataDir || path.join(os.homedir(), '.decent', 'default')
  fs.mkdirSync(dataDir, { recursive: true })

  // The keypair IS your identity on the network. ppppp-keypair persists it to
  // disk and generates one on first run.
  const keypair = Keypair.loadOrCreateSync(path.join(dataDir, 'keypair.json'))

  const peer = require('secret-stack/bare')()
    .use(require('secret-stack/plugins/net'))
    .use(require('secret-handshake-ext/secret-stack'))
    .use(require('ppppp-db'))
    .use(require('ssb-box'))
    .call(null, {
      shse: { caps: require('ppppp-caps') },
      global: { keypair, path: dataDir },
    })

  await peer.db.loaded()

  return { peer, keypair, dataDir }
}

module.exports = { startNode }

const Path = require('node:path')
const Keypair = require('ppppp-keypair')
const caps = require('ppppp-caps')
const SecretStack = require('secret-stack/bare')

module.exports = function startPeer() {
  // Decent vendor change: make the data dir (which holds the hub's keypair =
  // its stable identity / shseCredentials) configurable via HUB_DATA_DIR, so
  // deployments can point it at a known persisted path outside the repo tree.
  // Upstream hardcoded `__dirname/../data`, tying the identity to the checkout
  // location. Default preserves the old behavior.
  const path = process.env.HUB_DATA_DIR || Path.join(__dirname, '..', 'data')
  const keypairPath = Path.join(path, 'keypair')
  const keypair = Keypair.loadOrCreateSync(keypairPath)

  return SecretStack()
    .use(require('secret-stack/plugins/net'))
    .use(require('secret-handshake-ext/secret-stack'))
    .use(require('ppppp-net'))
    .use(require('./plugin-hub.cjs'))
    .use(require('./plugin-hub-client.cjs'))
    .call(null, {
      shse: { caps },
      global: {
        path,
        keypair,
        timers: {
          inactivity: 600e3,
        },
        connections: {
          incoming: {
            net: [
              {
                scope: 'public',
                transform: 'shse',
                port: process.env.PPPPP_PORT ?? 8008,
                host: '0.0.0.0',
              },
            ],
          },
          outgoing: {
            net: [{ transform: 'shse' }],
          },
        },
      },
      net: {
        autostart: false,
      },
    })
}

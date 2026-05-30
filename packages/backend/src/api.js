'use strict'

const http = require('node:http')

/**
 * Decent's local HTTP API. Deliberately tiny and dependency-free (Node's built-in
 * http) — this is the single surface both the web UI and the CLI talk to, and
 * keeping it lean helps the mobile-portability goal.
 *
 * Bound to localhost only. This is a personal daemon, not a public server.
 *
 * Routes:
 *   GET  /api/whoami        -> { account, pubkey }
 *   GET  /api/address       -> { address }   (secret-stack: dial us directly)
 *   GET  /api/nodeid        -> { nodeId, ticket }  (iroh: the code a friend pastes)
 *   GET  /api/posts         -> [ { id, text, account, received }, ... ]
 *   POST /api/posts         -> { id, ... }   body: { text }
 *   DELETE /api/posts/:id   -> { deleted }
 *   POST /api/follow        -> { feed, goal } body: { account, goal? }
 *   POST /api/connect       -> { connected }  body: { address }  (secret-stack)
 *   POST /api/connect-iroh  -> { connected }  body: { code }     (iroh dial-by-code)
 *   POST /api/hub/join      -> { hub }        body: { multiaddr }
 *   POST /api/hub/connect   -> { connected }  body: { hub, peer } (pubkeys)
 */
function createApiServer(store) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const route = `${req.method} ${url.pathname}`

    try {
      if (isMutating(req.method) && !isAllowedOrigin(req.headers.origin)) {
        return json(res, 403, { error: 'origin not allowed' })
      }

      if (route === 'GET /api/whoami') {
        return json(res, 200, store.whoami())
      }

      if (route === 'GET /api/address') {
        return json(res, 200, { address: store.address() })
      }

      // iroh: our dial-by-code identity (the "code" a friend pastes to reach us).
      if (route === 'GET /api/nodeid') {
        return json(res, 200, await store.irohId())
      }

      if (route === 'GET /api/posts') {
        return json(res, 200, await store.posts())
      }

      if (route === 'POST /api/posts') {
        const body = await readJson(req)
        const post = await store.post(body.text)
        return json(res, 201, post)
      }

      const delMatch = url.pathname.match(/^\/api\/posts\/(.+)$/)
      if (req.method === 'DELETE' && delMatch) {
        return json(res, 200, await store.del(decodeURIComponent(delMatch[1])))
      }

      if (route === 'POST /api/follow') {
        const { account, goal } = await readJson(req)
        if (!account) throw new Error('follow requires an account')
        return json(res, 200, store.follow(account, goal))
      }

      if (route === 'POST /api/connect') {
        const { address } = await readJson(req)
        if (!address) throw new Error('connect requires an address')
        await store.connect(address)
        return json(res, 200, { connected: address })
      }

      // iroh: dial a peer by their pasted NodeId/ticket (NAT-traversing).
      if (route === 'POST /api/connect-iroh') {
        const { code } = await readJson(req)
        if (!code) throw new Error('connect-iroh requires a code (nodeId or ticket)')
        return json(res, 200, await store.irohConnect(code))
      }

      if (route === 'POST /api/hub/join') {
        const { multiaddr } = await readJson(req)
        if (!multiaddr) throw new Error('hub/join requires a multiaddr')
        return json(res, 200, await store.joinHub(multiaddr))
      }

      if (route === 'POST /api/hub/connect') {
        const { hub, peer } = await readJson(req)
        if (!hub || !peer) throw new Error('hub/connect requires hub and peer pubkeys')
        await store.connectViaHub(hub, peer)
        return json(res, 200, { connected: { hub, peer } })
      }

      return json(res, 404, { error: 'not found' })
    } catch (err) {
      return json(res, 400, { error: err.message })
    }
  })
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json',
  })
  res.end(body)
}

function isMutating(method) {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

function isAllowedOrigin(origin) {
  if (!origin) return true
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1e6) reject(new Error('payload too large'))
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

module.exports = { createApiServer }

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
 *   GET  /api/address       -> { address }   (hand to a peer so they can dial us)
 *   GET  /api/posts         -> [ { id, text, account, received }, ... ]
 *   POST /api/posts         -> { id, ... }   body: { text }
 *   DELETE /api/posts/:id   -> { deleted }
 *   POST /api/follow        -> { feed, goal } body: { account, goal? }
 *   POST /api/connect       -> { connected }  body: { address }
 */
function createApiServer(store) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const route = `${req.method} ${url.pathname}`

    try {
      if (route === 'GET /api/whoami') {
        return json(res, 200, store.whoami())
      }

      if (route === 'GET /api/address') {
        return json(res, 200, { address: store.address() })
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
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  res.end(body)
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

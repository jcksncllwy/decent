#!/usr/bin/env node
'use strict'

/**
 * Decent CLI — the co-equal surface for humans and AI agents.
 *
 * It talks to the running decentd HTTP API (same surface as the web UI), so
 * anything a person can do in the browser, an agent can script here. No special
 * agent path: humans and programs share one door.
 *
 * Usage:
 *   decent whoami
 *   decent posts
 *   decent post "some text"
 *   decent del <msgId>
 *
 * Env:
 *   DECENT_PORT   API port (default 8008)
 */

const PORT = Number(process.env.DECENT_PORT) || 8008
const BASE = `http://127.0.0.1:${PORT}/api`

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const commands = {
  async whoami() {
    const me = await api('GET', '/whoami')
    console.log(`account: ${me.account}`)
    console.log(`pubkey:  ${me.pubkey}`)
  },

  async posts() {
    const posts = await api('GET', '/posts')
    if (posts.length === 0) return console.log('(no posts yet)')
    for (const p of posts) {
      const when = new Date(p.received).toLocaleString()
      console.log(`${when}  ${p.id.slice(0, 8)}  ${p.text}`)
    }
  },

  async post(text) {
    if (!text) throw new Error('usage: decent post "text"')
    const p = await api('POST', '/posts', { text })
    console.log(`published ${p.id}`)
  },

  async del(id) {
    if (!id) throw new Error('usage: decent del <msgId>')
    const r = await api('DELETE', `/posts/${encodeURIComponent(id)}`)
    console.log(`deleted ${r.deleted}`)
  },
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  if (!cmd || cmd === 'help' || !commands[cmd]) {
    console.log('Decent CLI — usage:')
    console.log('  decent whoami')
    console.log('  decent posts')
    console.log('  decent post "text"')
    console.log('  decent del <msgId>')
    process.exit(cmd && cmd !== 'help' ? 1 : 0)
  }
  try {
    await commands[cmd](...args)
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error(`error: can't reach decentd on port ${PORT}. Is it running? (npm run backend)`)
    } else {
      console.error(`error: ${err.message}`)
    }
    process.exit(1)
  }
}

main()

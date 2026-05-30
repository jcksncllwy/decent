// Tiny client for the local decentd API. The web UI and the CLI hit the exact
// same endpoints — humans and agents share one surface.

async function req(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export const api = {
  whoami: () => req('GET', '/whoami'),
  posts: () => req('GET', '/posts'),
  post: (text) => req('POST', '/posts', { text }),
  del: (id) => req('DELETE', `/posts/${encodeURIComponent(id)}`),

  // iroh dial-by-code: your own code to share, and connecting to a friend's.
  nodeId: () => req('GET', '/nodeid'), // -> { nodeId, ticket }
  connectIroh: (code) => req('POST', '/connect-iroh', { code }), // -> { connected }
}

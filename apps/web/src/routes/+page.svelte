<script>
  import { api } from '$lib/api.js'
  import Connect from '$lib/Connect.svelte'
  import Mirrors from '$lib/Mirrors.svelte'

  // Svelte 5 runes: $state for reactive local state, $effect for lifecycle.
  let me = $state(null)
  let posts = $state([])
  let mirrorProfiles = $state({})
  let draft = $state('')
  let error = $state(null)
  let loading = $state(true)

  function shortAccount(account) {
    if (!account) return ''
    if (account.length <= 18) return account
    return `${account.slice(0, 10)}...${account.slice(-6)}`
  }

  async function loadMirrorProfiles(nextPosts) {
    const accounts = [
      ...new Set(nextPosts.filter((post) => post.source?.platform).map((post) => post.account)),
    ]

    const entries = await Promise.all(
      accounts.map(async (account) => {
        try {
          return [account, await api.mirrorProfile(account)]
        } catch {
          return [account, {}]
        }
      })
    )
    mirrorProfiles = Object.fromEntries(entries)
  }

  async function refresh() {
    try {
      const [nextMe, nextPosts] = await Promise.all([api.whoami(), api.posts()])
      me = nextMe
      posts = nextPosts
      await loadMirrorProfiles(nextPosts)
      error = null
    } catch (err) {
      error = err.message
    } finally {
      loading = false
    }
  }

  async function submit() {
    const text = draft.trim()
    if (!text) return
    try {
      await api.post(text)
      draft = ''
      await refresh()
    } catch (err) {
      error = err.message
    }
  }

  async function remove(id) {
    try {
      await api.del(id)
      await refresh()
    } catch (err) {
      error = err.message
    }
  }

  $effect(() => {
    refresh()
  })
</script>

<main>
  <header>
    <h1>Decent <span class="seed">🌱</span></h1>
    {#if me}
      <p class="id" title={me.pubkey}>{me.account.slice(0, 12)}…</p>
    {/if}
  </header>

  {#if error}
    <p class="error">
      {error}
      <br /><small>Is the daemon running? <code>npm run backend</code></small>
    </p>
  {/if}

  <Connect onConnected={refresh} />
  <Mirrors onMirrored={refresh} />

  <form onsubmit={(e) => { e.preventDefault(); submit() }}>
    <textarea
      bind:value={draft}
      placeholder="What's on your mind?"
      rows="2"
    ></textarea>
    <button type="submit" disabled={!draft.trim()}>Post</button>
  </form>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if posts.length === 0}
    <p class="muted">No posts yet. Say something.</p>
  {:else}
    <ul class="feed">
      {#each posts as post (post.id)}
        <li>
          {#if post.source}
            <div class="mirror-badge">
              <a href={post.source.url} target="_blank" rel="noreferrer">
                Mirrored from Instagram · @{post.source.handle}
              </a>
              {#if mirrorProfiles[post.account]?.managedBy}
                <span title={mirrorProfiles[post.account].managedBy}>
                  managed by {shortAccount(mirrorProfiles[post.account].managedBy)}
                </span>
              {/if}
            </div>
          {/if}
          <p class="text">{post.text}</p>
          <div class="meta">
            <time>{new Date(post.received).toLocaleString()}</time>
            <button class="del" onclick={() => remove(post.id)} title="Delete">×</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #0f1115;
    color: #e6e6e6;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }
  main {
    max-width: 560px;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  h1 {
    font-size: 1.6rem;
    margin: 0;
  }
  .seed {
    font-size: 1.1rem;
  }
  .id {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    color: #8a8f98;
    margin: 0;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }
  textarea {
    background: #1a1d24;
    color: inherit;
    border: 1px solid #2a2f3a;
    border-radius: 8px;
    padding: 0.7rem;
    font: inherit;
    resize: vertical;
  }
  button {
    align-self: flex-end;
    background: #4f8cff;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.5rem 1.1rem;
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .feed {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .feed li {
    background: #1a1d24;
    border: 1px solid #2a2f3a;
    border-radius: 10px;
    padding: 0.8rem 0.9rem;
  }
  .mirror-badge {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.55rem;
    align-items: center;
    margin-bottom: 0.55rem;
    color: #8a8f98;
    font-size: 0.76rem;
  }
  .mirror-badge a {
    color: #9dbbff;
    text-decoration: none;
  }
  .mirror-badge a:hover {
    text-decoration: underline;
  }
  .mirror-badge span {
    color: #8a8f98;
    font-family: ui-monospace, monospace;
  }
  .text {
    margin: 0 0 0.5rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  time {
    font-size: 0.75rem;
    color: #8a8f98;
  }
  .del {
    background: transparent;
    color: #8a8f98;
    padding: 0 0.4rem;
    font-size: 1.1rem;
    line-height: 1;
  }
  .del:hover {
    color: #ff6b6b;
  }
  .muted {
    color: #8a8f98;
  }
  .error {
    background: #2a1416;
    border: 1px solid #5a2329;
    color: #ff9b9b;
    padding: 0.7rem 0.9rem;
    border-radius: 8px;
  }
  code {
    font-family: ui-monospace, monospace;
  }
</style>

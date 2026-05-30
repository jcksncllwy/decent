<script>
  import { api } from '$lib/api.js'

  let { onMirrored = async () => {} } = $props()

  let handlesText = $state('')
  let mirrors = $state([])
  let freshness = $state({})
  let results = $state([])
  let loading = $state(true)
  let mirroring = $state(false)
  let activeHandle = $state(null)
  let error = $state(null)

  function parseHandles(value) {
    return [
      ...new Set(
        value
          .split(/[\s,]+/)
          .map((handle) => handle.trim().replace(/^@+/, '').toLowerCase())
          .filter(Boolean)
      ),
    ]
  }

  function friendlyError(result) {
    if (result?.kind === 'ratelimit') return 'Instagram is throttling, try again in a few minutes.'
    if (result?.kind === 'auth') return 'Instagram session is missing or expired.'
    if (result?.kind === 'private') return 'Private or unavailable with this Instagram session.'
    if (result?.kind === 'notfound') return 'Instagram handle not found.'
    return result?.error || 'Mirror failed.'
  }

  function freshnessLabel(info) {
    if (info?.state === 'fresh') return 'up to date'
    if (info?.state === 'stale') return 'stale - mirror this yourself'
    if (info?.kind === 'ratelimit') return 'freshness throttled'
    return 'freshness unknown'
  }

  function shortAccount(account) {
    if (!account) return ''
    if (account.length <= 18) return account
    return `${account.slice(0, 10)}...${account.slice(-6)}`
  }

  function mirrorKey(mirror) {
    return `${mirror.platform}:${mirror.handle}`
  }

  async function loadMirrors() {
    loading = true
    try {
      const nextMirrors = await api.listMirrors()
      mirrors = nextMirrors
      error = null

      const entries = await Promise.all(
        nextMirrors.map(async (mirror) => {
          try {
            return [mirrorKey(mirror), await api.mirrorFreshness(mirror.handle, mirror.platform)]
          } catch (err) {
            return [mirrorKey(mirror), { state: 'unknown', error: err.message, kind: err.kind }]
          }
        })
      )
      freshness = Object.fromEntries(entries)
    } catch (err) {
      error = err.message
    } finally {
      loading = false
    }
  }

  async function mirrorHandles(handles) {
    if (handles.length === 0 || mirroring) return

    mirroring = true
    activeHandle = handles.length === 1 ? handles[0] : null
    error = null

    try {
      results = await api.mirrorInstagram(handles)
      handlesText = ''
      await loadMirrors()
      await onMirrored()
    } catch (err) {
      results = []
      error = friendlyError(err)
    } finally {
      mirroring = false
      activeHandle = null
    }
  }

  function submit() {
    mirrorHandles(parseHandles(handlesText))
  }

  $effect(() => {
    loadMirrors()
  })
</script>

<section class="mirrors-panel" aria-label="Instagram mirrors">
  <form class="mirror-form" onsubmit={(e) => { e.preventDefault(); submit() }}>
    <label for="mirror-handles">Instagram mirrors</label>
    <div class="mirror-row">
      <input
        id="mirror-handles"
        bind:value={handlesText}
        placeholder="@handle, @another"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      <button type="submit" disabled={mirroring || parseHandles(handlesText).length === 0}>
        {mirroring && !activeHandle ? 'Mirroring' : 'Mirror'}
      </button>
    </div>
  </form>

  {#if results.length > 0}
    <ul class="results" aria-label="Mirror results">
      {#each results as result}
        <li class:failed={!result.ok}>
          <span class="handle">@{result.handle}</span>
          {#if result.ok}
            <span>{result.published === 1 ? '1 post published' : `${result.published} posts published`}</span>
          {:else}
            <span>{friendlyError(result)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if error}
    <p class="status error">{error}</p>
  {/if}

  <div class="mirror-list">
    {#if loading}
      <p class="muted">Loading mirrors...</p>
    {:else if mirrors.length === 0}
      <p class="muted">No mirrors yet.</p>
    {:else}
      {#each mirrors as mirror (`${mirror.platform}:${mirror.handle}:${mirror.account}`)}
        <article class="mirror-item">
          <div>
            <p class="mirror-handle">@{mirror.handle}</p>
            <p class="mirror-account" title={mirror.account}>{shortAccount(mirror.account)}</p>
          </div>
          <div class="freshness">
            <span class:stale={freshness[mirrorKey(mirror)]?.state === 'stale'} class:fresh={freshness[mirrorKey(mirror)]?.state === 'fresh'}>
              {freshnessLabel(freshness[mirrorKey(mirror)])}
            </span>
            {#if freshness[mirrorKey(mirror)]?.state === 'stale'}
              <button
                type="button"
                class="remirror"
                disabled={mirroring}
                onclick={() => mirrorHandles([mirror.handle])}
              >
                {activeHandle === mirror.handle ? 'Mirroring' : 'Mirror this yourself'}
              </button>
            {/if}
          </div>
        </article>
      {/each}
    {/if}
  </div>
</section>

<style>
  .mirrors-panel {
    background: #151820;
    border: 1px solid #2a2f3a;
    border-radius: 8px;
    padding: 0.9rem;
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  label {
    display: block;
    margin: 0 0 0.35rem;
    color: #c8ccd4;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .mirror-row {
    display: flex;
    gap: 0.5rem;
  }
  input {
    min-width: 0;
    flex: 1;
    background: #0f1115;
    color: inherit;
    border: 1px solid #2a2f3a;
    border-radius: 8px;
    padding: 0.55rem 0.65rem;
    font: inherit;
  }
  input:focus {
    border-color: #4f8cff;
    outline: none;
  }
  button {
    background: #4f8cff;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.5rem 0.85rem;
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .results li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    justify-content: space-between;
    color: #8fe3a3;
    font-size: 0.84rem;
  }
  .results li.failed {
    color: #ffbd8a;
  }
  .handle {
    color: #f1f3f7;
    font-weight: 700;
  }
  .mirror-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .mirror-item {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
    background: #10131a;
    border: 1px solid #252a35;
    border-radius: 8px;
    padding: 0.65rem 0.7rem;
  }
  .mirror-handle {
    margin: 0 0 0.15rem;
    color: #f1f3f7;
    font-weight: 700;
  }
  .mirror-account {
    margin: 0;
    color: #8a8f98;
    font-family: ui-monospace, monospace;
    font-size: 0.76rem;
  }
  .freshness {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: flex-end;
    text-align: right;
  }
  .freshness span {
    color: #aeb4c0;
    font-size: 0.78rem;
  }
  .freshness .fresh {
    color: #8fe3a3;
  }
  .freshness .stale {
    color: #ffbd8a;
  }
  .remirror {
    background: #22304a;
    color: #dce7ff;
    padding: 0.42rem 0.65rem;
    font-size: 0.82rem;
  }
  .status {
    margin: -0.2rem 0 0;
    font-size: 0.85rem;
  }
  .error {
    color: #ff9b9b;
  }
  .muted {
    margin: 0;
    color: #8a8f98;
  }
  @media (max-width: 520px) {
    .mirror-row,
    .mirror-item,
    .freshness,
    .results li {
      align-items: stretch;
      flex-direction: column;
      text-align: left;
    }
    button {
      align-self: stretch;
    }
  }
</style>

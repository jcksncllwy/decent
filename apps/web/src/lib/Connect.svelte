<script>
  import { api } from '$lib/api.js'

  let { onConnected = async () => {} } = $props()

  let nodeId = $state('')
  let shareCode = $state('')
  let loadingCode = $state(true)
  let copied = $state(false)
  let code = $state('')
  let connecting = $state(false)
  let connected = $state(false)
  let error = $state(null)

  function shortCode(value) {
    if (!value) return ''
    if (value.length <= 24) return value
    return `${value.slice(0, 12)}...${value.slice(-8)}`
  }

  async function loadNodeId() {
    try {
      const info = await api.nodeId()
      nodeId = info.nodeId
      shareCode = info.code
      error = null
    } catch (err) {
      error = err.message
    } finally {
      loadingCode = false
    }
  }

  async function copyNodeId() {
    if (!shareCode) return
    try {
      await navigator.clipboard.writeText(shareCode)
      copied = true
      setTimeout(() => {
        copied = false
      }, 1400)
    } catch (err) {
      error = err.message
    }
  }

  async function connect() {
    const trimmed = code.trim()
    if (!trimmed || connecting) return

    connecting = true
    connected = false
    error = null

    try {
      await api.connectIroh(trimmed)
      connected = true
      code = ''
      await onConnected()
    } catch (err) {
      error = err.message
    } finally {
      connecting = false
    }
  }

  $effect(() => {
    loadNodeId()
  })
</script>

<section class="connect-panel" aria-label="Connect with iroh">
  <div class="block">
    <div>
      <h2>Your code</h2>
      {#if loadingCode}
        <p class="code muted">Loading...</p>
      {:else if nodeId}
        <p class="code" title={nodeId}>{shortCode(nodeId)}</p>
      {:else}
        <p class="code muted">Unavailable</p>
      {/if}
    </div>
    <button type="button" class="copy" disabled={!shareCode || loadingCode} onclick={copyNodeId}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  </div>

  <form class="block connect-form" onsubmit={(e) => { e.preventDefault(); connect() }}>
    <label for="friend-code">Connect to a friend</label>
    <div class="connect-row">
      <input
        id="friend-code"
        bind:value={code}
        placeholder="Paste their code"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="submit" disabled={!code.trim() || connecting}>
        {connecting ? 'Connecting' : 'Connect'}
      </button>
    </div>
  </form>

  {#if connected}
    <p class="status success">Connected. Refreshing feed...</p>
  {/if}
  {#if error}
    <p class="status error">{error}</p>
  {/if}
</section>

<style>
  .connect-panel {
    background: #151820;
    border: 1px solid #2a2f3a;
    border-radius: 8px;
    padding: 0.9rem;
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .block {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    justify-content: space-between;
  }
  h2,
  label {
    display: block;
    margin: 0 0 0.35rem;
    color: #c8ccd4;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .code {
    margin: 0;
    color: #f1f3f7;
    font-family: ui-monospace, monospace;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .muted {
    color: #8a8f98;
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
  .copy {
    min-width: 4.8rem;
  }
  .connect-form {
    display: block;
  }
  .connect-row {
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
    font-family: ui-monospace, monospace;
  }
  input:focus {
    border-color: #4f8cff;
    outline: none;
  }
  .status {
    margin: -0.2rem 0 0;
    font-size: 0.85rem;
  }
  .success {
    color: #8fe3a3;
  }
  .error {
    color: #ff9b9b;
  }
  @media (max-width: 460px) {
    .block,
    .connect-row {
      align-items: stretch;
      flex-direction: column;
    }
    button {
      align-self: stretch;
    }
  }
</style>

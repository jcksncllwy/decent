# Mirror ingest contract (dev ↔ codex seam)

The interface between the **Python ingest service** (codex — reuses
`~/Projects/instagram-scrape`) and the **Decent mirror manager** (dev). Both build
to this contract so we can work in parallel. See [[decent-mirroring]] for product
shape + locked decisions.

The ingest service is a CLI the Decent backend shells out to. It does Instagram I/O
(Instaloader, the user's own session); it knows NOTHING about pzp. The mirror manager
does pzp I/O (create accounts, publish posts); it knows NOTHING about Instagram.

## Service: `decent-ig-ingest` (codex owns)

A Python CLI in a new repo dir (suggest `packages/ig-ingest/` in the Decent monorepo,
or a sibling — codex's call; keep it self-contained with its own venv/requirements).
Auth via the user's IG session (env/session-file, like `instagram-scrape`).

### Command 1 — fetch a profile's recent posts
```
decent-ig-ingest fetch <handle> [--limit N] [--since <iso8601>]
```
→ writes JSON to stdout:
```json
{
  "platform": "instagram",
  "handle": "chef_jane",
  "fetchedAt": "2026-05-30T08:30:00Z",
  "profile": {
    "fullName": "Jane Doe",
    "bio": "chef. food pics.",
    "avatarUrl": "https://.../jane.jpg",
    "postCount": 412
  },
  "posts": [
    {
      "sourceId": "C3xY...",              // IG shortcode — STABLE dedup key
      "url": "https://instagram.com/p/C3xY.../",
      "postedAt": "2026-05-29T14:02:00Z",  // ISO8601 UTC
      "caption": "today's special...",
      "media": [
        { "type": "image", "thumbUrl": "https://.../t.jpg", "fullUrl": "https://.../f.jpg" }
      ]
    }
  ]
}
```
- `posts` newest-first. `--limit` caps count (default e.g. 12). `--since` filters to
  posts newer than a timestamp (for incremental refresh).
- **No media download** in v1 — just URLs/thumb refs.
- Respect Instaloader rate limiting (RateController). One profile per invocation.

### Command 2 — freshness probe (cheap, no post bodies)
```
decent-ig-ingest freshness <handle>
```
→ stdout:
```json
{
  "platform": "instagram",
  "handle": "chef_jane",
  "checkedAt": "2026-05-30T08:31:00Z",
  "latest": { "sourceId": "C3xY...", "postedAt": "2026-05-29T14:02:00Z" },
  "postCount": 412
}
```
- Just `Profile.from_username` + first item of `get_posts()`. 1-2 calls, no downloads.
- The Decent side compares `latest.sourceId`/`postedAt` to the mirror's last-published
  `source` to compute the freshness badge.

### Errors
- On failure (bad handle, auth expired, rate-limited, private profile): exit non-zero,
  write `{ "error": "<message>", "kind": "auth|notfound|private|ratelimit|other" }`
  to stdout. The Decent side surfaces `kind` to the UI.

### Contract test (codex)
A fixture-or-live test proving both commands emit JSON matching the shapes above.
The Decent side will validate against these shapes; keep them stable.

## Decent mirror manager (dev owns) — for context, not codex's job

> **Data-model note (dev verified):** pzp `account.create` only takes
> `keypair`/`subdomain`/`_nonce` — NO custom fields on the account root. So the
> "this is a mirror" marker is carried by **a `profile` message published into the
> mirror account's own feed** (SSB-style "about"/meta message), which is replicable
> (decision 2 — peers learn it). Mirror accounts use `subdomain: 'mirror'` (vs
> `'person'` for native users) as a coarse signal; the `profile` message carries the
> rich metadata: `{ source:{platform,handle,profileUrl}, fullName, bio, avatarUrl,
> managedBy: <managing pzp account>, mirroredAt }`.

- `src/mirror/manager.js`: per-handle pzp account (fresh keypair under
  `subdomain:'mirror'`, persisted in node data dir), a `profile` meta message stamped
  into its feed (source/handle/managedBy), username→accountId map. `account.create`
  with explicit keypair. Idempotent.
- Publish each ingest `post` into that account's feed:
  `feed.publish({account, domain:'post', data:{ text: caption, source: {platform,
  handle, url, sourceId, postedAt}, media }})`. **Dedup by `source.sourceId`.**
- Freshness: shell `freshness`, compare to last-published `source`, return a badge.
- API: `POST /api/mirror/instagram` {handles, limit?}; `GET /api/mirror` (list mirrors
  + freshness); `POST /api/mirror/:handle/refresh`; `GET /api/mirror/:account/freshness`.
- UI: badge "Mirrored from Instagram" + managing account; freshness state; "Mirror
  this yourself" remediation.

## Status
- 2026-05-30 (dev): contract written. codex → `decent-ig-ingest` (Python). dev →
  mirror manager + API + UI. Meet at the JSON shapes above.

# decent-ig-ingest

Instagram ingest CLI for Decent account mirroring. This service only talks to
Instagram/Instaloader and writes contract JSON to stdout; it knows nothing about pzp.

## Setup

```sh
cd packages/ig-ingest
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
pip install -e .
```

Authentication reuses Instaloader session files. Set `IG_USERNAME`; optionally set
`IG_PASSWORD` for first login or `IG_SESSION_FILE` to point at a specific session.

## Commands

```sh
decent-ig-ingest fetch <handle> [<handle> ...] --limit 12
decent-ig-ingest fetch <handle> [<handle> ...] --since 2026-05-01T00:00:00Z
decent-ig-ingest freshness <handle> [<handle> ...]
```

Each command uses one Instaloader instance per invocation, even for multiple handles,
so Instaloader's RateController can pace the whole batch. Per-handle failures are
returned in the top-level `results` array as `{ "handle": "...", "error": "...",
"kind": "..." }` and do not fail the whole run. Setup/auth failures are written to
stdout as `{ "error": "...", "kind": "..." }` and exit non-zero.

## Contract Test

```sh
python -m unittest discover -s tests
```

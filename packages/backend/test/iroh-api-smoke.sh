#!/usr/bin/env bash
# Two-daemon paste-a-code smoke over the REAL HTTP API — the exact path the Svelte
# Connect UI exercises. Boots two backends, gets bob's nodeId via GET /api/nodeid,
# posts a message as bob, dials it from alice via POST /api/connect-iroh, and checks
# alice's GET /api/posts replicates bob's post.
#
# Run: bash packages/backend/test/iroh-api-smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
A_PORT=8031
B_PORT=8032
A_DATA="$(mktemp -d)/alice"
B_DATA="$(mktemp -d)/bob"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$A_DATA" "$B_DATA" 2>/dev/null || true
}
trap cleanup EXIT

boot() {
  local port="$1" data="$2"
  DECENT_PORT="$port" DECENT_DATA="$data" \
    node "$ROOT/packages/backend/bin/decentd.js" >/tmp/decent-smoke-$port.log 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 25); do
    curl -sf "http://127.0.0.1:$port/api/whoami" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "FAIL: daemon on $port did not come up"; cat /tmp/decent-smoke-$port.log; exit 1
}

echo "[smoke] booting alice ($A_PORT) + bob ($B_PORT)"
boot "$A_PORT" "$A_DATA"
boot "$B_PORT" "$B_DATA"

echo "[smoke] bob posts + exposes its code"
curl -sf -X POST "http://127.0.0.1:$B_PORT/api/posts" \
  -H 'content-type: application/json' -d '{"text":"hello via the connect UI path"}' >/dev/null
BOB_ACCOUNT="$(curl -sf "http://127.0.0.1:$B_PORT/api/whoami" | python3 -c 'import sys,json;print(json.load(sys.stdin)["account"])')"
BOB_NODEID="$(curl -sf "http://127.0.0.1:$B_PORT/api/nodeid" | python3 -c 'import sys,json;print(json.load(sys.stdin)["nodeId"])')"
echo "[smoke] bob nodeId ${BOB_NODEID:0:12}…"

# alice must follow bob's feed (the UI/Store does this; here we use the follow API).
curl -sf -X POST "http://127.0.0.1:$A_PORT/api/follow" \
  -H 'content-type: application/json' -d "{\"account\":\"$BOB_ACCOUNT\"}" >/dev/null
# bob follows its own feed too (so sync offers it).
curl -sf -X POST "http://127.0.0.1:$B_PORT/api/follow" \
  -H 'content-type: application/json' -d "{\"account\":\"$BOB_ACCOUNT\"}" >/dev/null

echo "[smoke] alice pastes bob's code -> POST /api/connect-iroh"
curl -sf -X POST "http://127.0.0.1:$A_PORT/api/connect-iroh" \
  -H 'content-type: application/json' -d "{\"code\":\"$BOB_NODEID\"}" >/dev/null

echo "[smoke] waiting for replication..."
for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$A_PORT/api/posts" | grep -q "hello via the connect UI path"; then
    echo ""
    echo "PASS: alice replicated bob's post via the HTTP connect-iroh path (the UI flow)"
    exit 0
  fi
  sleep 0.25
done

echo ""
echo "FAIL: no replication via the HTTP path"
exit 1

#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8000}"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$PROJECT_DIR"

uv sync --locked
uv run pytest -q

BACKEND_PORT="$PORT" BACKEND_RELOAD=false uv run backend serve &
SERVER_PID=$!

for _ in {1..50}; do
  if curl --silent --fail "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    break
  fi

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
    exit 1
  fi

  sleep 0.2
done

curl --silent --fail "http://127.0.0.1:$PORT/" >/dev/null
curl --fail "http://127.0.0.1:$PORT/api/health"
printf '\n'

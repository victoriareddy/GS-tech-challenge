#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5500}"
CHAT_PORT="${CHAT_PORT:-3000}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' is required but not installed." >&2
    exit 1
  fi
}

kill_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"

  if [[ -z "${pids}" ]]; then
    echo "No listener found on port ${port}."
    return 0
  fi

  echo "Stopping process(es) on port ${port}: ${pids//$'\n'/ }"
  # shellcheck disable=SC2086
  kill ${pids}
}

require_command lsof
require_command kill

kill_listeners "${BACKEND_PORT}"
kill_listeners "${FRONTEND_PORT}"
kill_listeners "${CHAT_PORT}"

echo "Done."

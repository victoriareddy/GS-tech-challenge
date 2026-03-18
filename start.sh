#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_PORT="${FRONTEND_PORT:-5500}"
BACKEND_PORT="${BACKEND_PORT:-8080}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' is required but not installed." >&2
    exit 1
  fi
}

find_listener_pid() {
  local port="$1"
  lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n1 || true
}

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    echo
    echo "Stopping backend (PID ${BACKEND_PID})..."
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

require_command javac
require_command java
require_command python3
require_command lsof

EXISTING_BACKEND_PID="$(find_listener_pid "${BACKEND_PORT}")"
if [[ -n "${EXISTING_BACKEND_PID}" ]]; then
  echo "Error: port ${BACKEND_PORT} is already in use by PID ${EXISTING_BACKEND_PID}."
  echo "Stop it with: kill ${EXISTING_BACKEND_PID}"
  echo "Then rerun: ./start.sh"
  exit 1
fi

echo "Compiling backend..."
mkdir -p "${BACKEND_DIR}/bin"
javac -d "${BACKEND_DIR}/bin" "${BACKEND_DIR}/src/MutualFundCalculatorServer.java"

echo "Starting backend on http://localhost:${BACKEND_PORT} ..."
(
  cd "${BACKEND_DIR}"
  java -cp bin MutualFundCalculatorServer
) &
BACKEND_PID=$!

sleep 1
if ! kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
  echo "Error: backend failed to start." >&2
  exit 1
fi

echo "Starting frontend static server on http://localhost:${FRONTEND_PORT} ..."
echo "Open: http://localhost:${FRONTEND_PORT}/frontend/index.html"
echo "Press Ctrl+C to stop everything."

cd "${ROOT_DIR}"
python3 -m http.server "${FRONTEND_PORT}"

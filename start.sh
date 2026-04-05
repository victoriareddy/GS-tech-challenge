#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
CHAT_DIR="${ROOT_DIR}/frontend"
ANGULAR_DIR="${ROOT_DIR}/frontend/angular"
ENV_FILE="${ROOT_DIR}/.env"
FRONTEND_PORT="${FRONTEND_PORT:-5500}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
CHAT_PORT="${CHAT_PORT:-3000}"
START_CHAT="${START_CHAT:-true}" # true | false
FRONTEND_MODE="${FRONTEND_MODE:-auto}" # auto | angular | static

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

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
  if [[ -n "${CHAT_PID:-}" ]] && kill -0 "${CHAT_PID}" >/dev/null 2>&1; then
    echo
    echo "Stopping chat backend (PID ${CHAT_PID})..."
    kill "${CHAT_PID}" >/dev/null 2>&1 || true
    wait "${CHAT_PID}" 2>/dev/null || true
  fi
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
if [[ "${START_CHAT}" == "true" ]]; then
  require_command node
fi

if [[ "${BACKEND_PORT}" == "${FRONTEND_PORT}" ]]; then
  echo "Error: BACKEND_PORT and FRONTEND_PORT cannot be the same (${BACKEND_PORT})."
  exit 1
fi
if [[ "${START_CHAT}" == "true" && "${CHAT_PORT}" == "${BACKEND_PORT}" ]]; then
  echo "Error: CHAT_PORT and BACKEND_PORT cannot be the same (${CHAT_PORT})."
  exit 1
fi
if [[ "${START_CHAT}" == "true" && "${CHAT_PORT}" == "${FRONTEND_PORT}" ]]; then
  echo "Error: CHAT_PORT and FRONTEND_PORT cannot be the same (${CHAT_PORT})."
  exit 1
fi

EXISTING_BACKEND_PID="$(find_listener_pid "${BACKEND_PORT}")"
if [[ -n "${EXISTING_BACKEND_PID}" ]]; then
  echo "Error: port ${BACKEND_PORT} is already in use by PID ${EXISTING_BACKEND_PID}."
  echo "Stop it with: kill ${EXISTING_BACKEND_PID}"
  echo "Then rerun: ./start.sh"
  exit 1
fi

EXISTING_FRONTEND_PID="$(find_listener_pid "${FRONTEND_PORT}")"
if [[ -n "${EXISTING_FRONTEND_PID}" ]]; then
  echo "Error: port ${FRONTEND_PORT} is already in use by PID ${EXISTING_FRONTEND_PID}."
  echo "Stop it with: kill ${EXISTING_FRONTEND_PID}"
  echo "Then rerun: ./start.sh"
  exit 1
fi

if [[ "${START_CHAT}" == "true" ]]; then
  EXISTING_CHAT_PID="$(find_listener_pid "${CHAT_PORT}")"
  if [[ -n "${EXISTING_CHAT_PID}" ]]; then
    echo "Error: port ${CHAT_PORT} is already in use by PID ${EXISTING_CHAT_PID}."
    echo "Stop it with: kill ${EXISTING_CHAT_PID}"
    echo "Then rerun: ./start.sh"
    exit 1
  fi
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

if [[ "${START_CHAT}" == "true" ]]; then
  if [[ ! -d "${CHAT_DIR}/node_modules" ]]; then
    require_command npm
    echo "Chat dependencies missing. Installing in ${CHAT_DIR} ..."
    npm --prefix "${CHAT_DIR}" install
  fi

  echo "Starting chat backend on http://localhost:${CHAT_PORT} ..."
  (
    cd "${CHAT_DIR}"
    PORT="${CHAT_PORT}" node server.js
  ) &
  CHAT_PID=$!

  sleep 1
  if ! kill -0 "${CHAT_PID}" >/dev/null 2>&1; then
    echo "Error: chat backend failed to start." >&2
    exit 1
  fi
fi

if [[ "${FRONTEND_MODE}" == "auto" ]]; then
  if [[ -f "${ANGULAR_DIR}/package.json" ]]; then
    FRONTEND_MODE="angular"
  else
    FRONTEND_MODE="static"
  fi
fi

if [[ "${FRONTEND_MODE}" == "angular" ]]; then
  require_command npm
  if [[ ! -x "${ANGULAR_DIR}/node_modules/.bin/ng" ]]; then
    echo "Angular dependencies missing. Installing in ${ANGULAR_DIR} ..."
    npm --prefix "${ANGULAR_DIR}" install
  fi
  echo "Starting Angular frontend on http://localhost:${FRONTEND_PORT} ..."
  echo "Open: http://localhost:${FRONTEND_PORT}/"
  if [[ "${START_CHAT}" == "true" ]]; then
    echo "Chat API on http://localhost:${CHAT_PORT} (proxied from /api/chat)"
  else
    echo "Chat API startup disabled (START_CHAT=false). /chat will not work."
  fi
  echo "Press Ctrl+C to stop everything."
  if [[ "${FRONTEND_PORT}" == "5500" ]]; then
    npm --prefix "${ANGULAR_DIR}" run start
  else
    npm --prefix "${ANGULAR_DIR}" run start -- --port "${FRONTEND_PORT}"
  fi
else
  echo "Starting static frontend server on http://localhost:${FRONTEND_PORT} ..."
  echo "Open: http://localhost:${FRONTEND_PORT}/frontend/index.html"
  echo "Press Ctrl+C to stop everything."
  cd "${ROOT_DIR}"
  python3 -m http.server "${FRONTEND_PORT}"
fi

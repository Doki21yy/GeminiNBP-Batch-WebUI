#!/bin/zsh
set -e

cd "$(dirname "$0")"

URL="http://127.0.0.1:8000"
PYTHON="python3"
VENV_PYTHON=".venv/bin/python"

echo "Starting Gemini NBP Batch WebUI..."

if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "Creating local virtual environment..."
  "$PYTHON" -m venv .venv
fi

echo "Installing dependencies..."
"$VENV_PYTHON" -m pip install -r requirements.txt -q

EXISTING_PIDS=$(lsof -ti tcp:8000 || true)
if [[ -n "$EXISTING_PIDS" ]]; then
  echo "Stopping existing service on port 8000..."
  echo "$EXISTING_PIDS" | xargs kill 2>/dev/null || true
  sleep 1
fi

echo "Starting server on port 8000..."
"$VENV_PYTHON" -m uvicorn server:app --host 127.0.0.1 --port 8000 &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "Waiting for service to be ready..."
for i in {1..30}; do
  if curl -fsS "$URL/api/key" >/dev/null 2>&1; then
    echo "WebUI is ready: $URL"
    open "$URL"
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.5
done

echo "Service did not become ready in time."
exit 1
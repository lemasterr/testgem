#!/usr/bin/env bash
# NOTE:
# This script starts the Electron dev environment (Vite renderer + Electron shell).
# Do NOT open http://localhost:5173 directly in your browser; use the Electron window that launches.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run this project. Please install Node.js 18+ and npm." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting dev environment (Vite + Electron)..."
npm run dev

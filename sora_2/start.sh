#!/usr/bin/env bash
# NOTE:
# Цей скрипт запускає dev-оточення: Electron (Vite + React) та Python Core (FastAPI).
# Не відкривайте http://localhost:5173 напряму в браузері — використовуйте вікно Electron.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

# --- 1. Перевірка Node.js ---
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run this project. Please install Node.js 18+ and npm." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing Node.js dependencies..."
  npm install
fi

# --- 2. Перевірка Python ---
PYTHON_CMD="python3"
if ! command -v python3 >/dev/null 2>&1; then
  if command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
  else
    echo "Python is required for core services (ffmpeg processing). Please install Python 3.9+." >&2
    exit 1
  fi
fi

# Створення venv (опціонально, але рекомендовано)
if [ ! -d "python-core/venv" ]; then
  echo "Creating Python virtual environment..."
  $PYTHON_CMD -m venv python-core/venv
fi

# Акцивація venv та встановлення залежностей
source python-core/venv/bin/activate || true
echo "Installing Python dependencies..."
pip install -r python-core/requirements.txt

# --- 3. Запуск ---
echo "Starting dev environment (Vite + Electron + Python Core)..."
# Python Core запускається автоматично через Electron (main.ts -> pythonClient.ts),
# тому нам потрібно запустити лише npm run dev.
npm run dev
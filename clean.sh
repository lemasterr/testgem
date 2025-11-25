#!/usr/bin/env bash
# sora_2/clean.sh
# Скрипт для очистки проекта от зависимостей и артефактов сборки.
# Используйте перед архивацией проекта.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

echo "🧹 Starting cleanup..."

# 1. Удаление Node.js зависимостей
if [ -d "node_modules" ]; then
  echo "Removing node_modules..."
  rm -rf node_modules
fi

# 2. Удаление Python виртуального окружения
if [ -d "python-core/venv" ]; then
  echo "Removing python-core/venv..."
  rm -rf python-core/venv
fi

# 3. Удаление артефактов сборки Electron и Vite
if [ -d "dist" ]; then
  echo "Removing dist..."
  rm -rf dist
fi

if [ -d "dist-electron" ]; then
  echo "Removing dist-electron..."
  rm -rf dist-electron
fi

if [ -d "release" ]; then
  echo "Removing release..."
  rm -rf release
fi

# 4. Опционально: удаление кешей (например, .vite)
if [ -d "node_modules/.vite" ]; then
    rm -rf node_modules/.vite
fi

echo "✨ Cleanup complete! The project is ready for archiving."
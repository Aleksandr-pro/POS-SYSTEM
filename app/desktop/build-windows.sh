#!/usr/bin/env bash
# Сборка настольной версии POS Контроль для Windows (.exe)
set -e
cd "$(dirname "$0")"

echo "== 1. Сборка веб-версии =="
python3 ../build.py | tail -1
cp ../dist/index.html app/index.html

echo "== 2. Установка зависимостей =="
[ -d node_modules/electron ] || npm install --no-audit --no-fund

echo "== 3. Сборка .exe =="
# на Linux для правки ресурсов exe нужен wine + xvfb:
#   sudo apt-get install -y wine64 wine32:i386 xvfb
export WINEPREFIX="${WINEPREFIX:-$HOME/.wineprefix}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/rt}"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
xvfb-run -a npx electron-builder --win portable --x64

echo "== Готово: release/POS-Kontrol-*.exe =="

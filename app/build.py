#!/usr/bin/env python3
"""Сборка POS Контроль:
   dist/index.html — единый файл для превью и быстрого шаринга
   web/            — PWA-сборка (для хостинга и для Capacitor/APK)
"""
import base64
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
DIST = os.path.join(ROOT, 'dist')
WEB = os.path.join(ROOT, 'web')

SCRIPTS = [
    'xlsx.js', 'import-data.js', 'core.js', 'api.js', 'ui.js', 'pages-auth.js', 'pages-dashboard.js', 'pages-cash.js',
    'pages-products.js', 'pages-stock.js', 'pages-points.js', 'pages-time.js',
    'pages-analytics.js', 'pages-manual.js', 'pages-changes.js', 'pages-help.js', 'pages-settings.js', 'main.js'
]


def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()


def build_web():
    if os.path.isdir(WEB):
        shutil.rmtree(WEB)
    os.makedirs(WEB)
    for name in os.listdir(SRC):
        if name.endswith(('.html', '.css', '.js', '.json')):
            shutil.copy2(os.path.join(SRC, name), os.path.join(WEB, name))
    shutil.copytree(os.path.join(ROOT, 'icons'), os.path.join(WEB, 'icons'))
    print('web/ собрана')


def build_single():
    os.makedirs(DIST, exist_ok=True)
    html = read('index.html')
    css = read('styles.css')

    icon_b64 = base64.b64encode(open(os.path.join(ROOT, 'icons', 'icon-192.png'), 'rb').read()).decode()

    html = html.replace('<link rel="manifest" href="manifest.json">', '')
    html = html.replace('<link rel="icon" href="icons/icon-192.png" sizes="192x192" type="image/png">',
                        '<link rel="icon" href="data:image/png;base64,' + icon_b64 + '" type="image/png">')
    html = html.replace('<link rel="apple-touch-icon" href="icons/icon-192.png">',
                        '<link rel="apple-touch-icon" href="data:image/png;base64,' + icon_b64 + '">')
    html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>')

    for name in SCRIPTS:
        code = read(name)
        tag = '<script src="' + name + '"></script>'
        if tag not in html:
            raise SystemExit('Не найден тег для ' + name)
        # защищаемся от закрывающих тегов внутри кода
        safe = code.replace('</script>', '<\\/script>')
        html = html.replace(tag, '<script>\n' + safe + '\n</script>')

    # sw-регистрация не нужна в едином файле
    html = re.sub(r'<script>\s*// Service worker.*?</script>', '', html, flags=re.S)

    out = os.path.join(DIST, 'index.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    size = os.path.getsize(out)
    print('dist/index.html: %.1f КБ' % (size / 1024))


if __name__ == '__main__':
    build_web()
    build_single()

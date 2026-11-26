#!/usr/bin/env bash
# ============================================================================
# POS Контроль — сборка APK без Gradle:
#   aapt2 (ресурсы) → javac (Java) → d8 (dex) → zip → zipalign → apksigner
# Требуется: JDK 17+, Android SDK build-tools (aapt2, d8, zipalign, apksigner),
#            platforms/android-34/android.jar
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$ROOT/.." && pwd)"

if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(ls -d /home/user/.cache/jdk/jdk-17* 2>/dev/null | head -1)"
fi
SDK="${ANDROID_SDK:-/home/user/.cache/android-sdk}"
BT="$SDK/android-14"
PLATFORM="$SDK/android-34/android.jar"
BUILD="$ROOT/build"
OUT="$PROJECT/dist"
MIN_SDK=23
TARGET_SDK=34

export PATH="$JAVA_HOME/bin:$PATH"

echo "== 1. Подготовка каталогов =="
rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$BUILD/apk" "$BUILD/assets/www" "$OUT"

echo "== 2. Копирование веб-части в assets =="
# index.html в APK — из web/ (отдельные файлы, без service worker)
cp -r "$PROJECT/web/." "$BUILD/assets/www/"
rm -f "$BUILD/assets/www/sw.js" "$BUILD/assets/www/manifest.json"
# индекс для WebView: убираем регистрацию service worker (не нужна и мешает file://)
python3 - "$BUILD/assets/www/index.html" <<'PY'
import re, sys
path = sys.argv[1]
html = open(path, encoding='utf-8').read()
html = re.sub(r'<script>\s*// Service worker.*?</script>', '', html, flags=re.S)
html = html.replace('<link rel="manifest" href="manifest.json">', '')
open(path, 'w', encoding='utf-8').write(html)
print('   index.html подготовлен для WebView')
PY

echo "== 3. aapt2: компиляция ресурсов =="
"$BT/aapt2" compile --dir "$ROOT/res" -o "$BUILD/res.zip"

echo "== 4. aapt2: линковка (манифест + ресурсы + assets) =="
"$BT/aapt2" link \
  -o "$BUILD/base.apk" \
  -I "$PLATFORM" \
  --manifest "$ROOT/AndroidManifest.xml" \
  -A "$BUILD/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version $MIN_SDK \
  --target-sdk-version $TARGET_SDK \
  --version-code 30 \
  --version-name "3.4.12" \
  --auto-add-overlay \
  -v \
  "$BUILD/res.zip"

echo "== 5. javac: компиляция Java =="
find "$ROOT/src" "$BUILD/gen" -name "*.java" > "$BUILD/sources.txt"
javac -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$PLATFORM:$BT/core-lambda-stubs.jar" \
  -classpath "$PLATFORM:$BT/core-lambda-stubs.jar" \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt" 2>&1 | grep -v "bootstrap class path\|source value 8\|target value 8\|deprecat" || true

echo "== 6. d8: dex =="
find "$BUILD/classes" -name "*.class" > "$BUILD/classes.txt"
"$BT/d8" --release --min-api $MIN_SDK --lib "$PLATFORM" --output "$BUILD/dex" @"$BUILD/classes.txt"

echo "== 7. Сборка APK =="
cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
cd "$BUILD/dex"
zip -q -X "$BUILD/unsigned.apk" classes.dex
cd "$ROOT"

echo "== 8. zipalign =="
"$BT/zipalign" -p -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

echo "== 9. Ключ для подписи =="
KEYSTORE="$ROOT/poskontrol.keystore"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias poskontrol \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KEYSTORE_PASS" -keypass "$KEYSTORE_PASS" \
    -dname "CN=POS Kontrol, OU=Sales, O=POS Kontrol, L=Aktobe, ST=Aktobe, C=KZ" 2>&1 | tail -2
fi

echo "== 10. apksigner =="
APK_NAME="POS-Kontrol-3.4.12.apk"
"$BT/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias poskontrol \
  --ks-pass env:KEYSTORE_PASS \
  --key-pass env:KEYSTORE_PASS \
  --min-sdk-version $MIN_SDK \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --out "$OUT/$APK_NAME" \
  "$BUILD/aligned.apk"

echo "== 11. Проверка подписи =="
"$BT/apksigner" verify --verbose --print-certs "$OUT/$APK_NAME" | head -14

echo
echo "ГОТОВО: $OUT/$APK_NAME"
ls -lh "$OUT/$APK_NAME"

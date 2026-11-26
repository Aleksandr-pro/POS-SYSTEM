#!/usr/bin/env bash
# Установка JDK 17 и Android SDK (build-tools 34 + platform 34) в ~/.cache
# Нужно один раз за сессию: каталог .cache не попадает в снапшот рабочей папки.
set -euo pipefail

CACHE="${HOME}/.cache"
JDK_DIR="${CACHE}/jdk"
SDK="${CACHE}/android-sdk"

mkdir -p "$JDK_DIR" "$SDK"

if ! ls -d "$JDK_DIR"/jdk-17* >/dev/null 2>&1; then
  echo "== JDK 17 =="
  cd "$JDK_DIR"
  curl -sL -o jdk.tar.gz "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
  tar xzf jdk.tar.gz && rm jdk.tar.gz
fi

if [ ! -x "$SDK/android-14/aapt2" ]; then
  echo "== Android SDK =="
  cd "$SDK"
  if [ ! -d cmdline-tools ]; then
    curl -sL -o cmdline.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
    unzip -q cmdline.zip && rm cmdline.zip
  fi
  JAVA_HOME=$(ls -d "$JDK_DIR"/jdk-17* | head -1)
  export JAVA_HOME
  export PATH="$JAVA_HOME/bin:$PATH"
  yes | cmdline-tools/bin/sdkmanager --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
  cmdline-tools/bin/sdkmanager --sdk_root="$SDK" "build-tools;34.0.0" "platforms;android-34" >/dev/null 2>&1
  ln -sfn "$SDK/build-tools/34.0.0" "$SDK/android-14"
  ln -sfn "$SDK/platforms/android-34" "$SDK/android-34"
fi

echo "JAVA_HOME=$(ls -d "$JDK_DIR"/jdk-17* | head -1)"
echo "ANDROID_SDK=$SDK"
ls -l "$SDK/android-14/aapt2" "$SDK/android-34/android.jar"

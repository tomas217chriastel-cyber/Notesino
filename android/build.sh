#!/usr/bin/env bash
# Builds a debug-signed Notesino APK without Gradle or Android Studio, using
# only the Debian/Ubuntu-packaged Android SDK tools (aapt, dx, apksigner,
# zipalign) and a plain javac compile against the API 23 android.jar.
#
# Prerequisites (Debian/Ubuntu):
#   apt-get install android-sdk-build-tools android-sdk-platform-23 \
#                    android-sdk-platform-tools dalvik-exchange
#
# Usage: ./build.sh
# Output: build/apk/notesino-debug-signed.apk

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ="$HERE/app"
BUILD="$HERE/build"
KEYSTORE="$HERE/debug.keystore"
ANDROID_JAR="/usr/lib/android-sdk/platforms/android-23/android.jar"

export PATH="/usr/lib/android-sdk/build-tools/debian:/usr/lib/android-sdk/build-tools/29.0.3:$PATH"

if [ ! -f "$ANDROID_JAR" ]; then
  echo "android.jar not found at $ANDROID_JAR — install android-sdk-platform-23" >&2
  exit 1
fi

rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/obj" "$BUILD/apk"

echo "== Copying the web app into assets =="
cp "$HERE/../index.html" "$PROJ/src/main/assets/index.html"

echo "== aapt: generating R.java =="
aapt package -f -m \
  -J "$BUILD/gen" \
  -M "$PROJ/src/main/AndroidManifest.xml" \
  -S "$PROJ/src/main/res" \
  -I "$ANDROID_JAR"

echo "== javac: compiling sources =="
find "$PROJ/src/main/java" "$BUILD/gen" -name "*.java" > "$BUILD/sources.txt"
javac -encoding UTF-8 -source 8 -target 8 \
  -bootclasspath "$ANDROID_JAR" \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD/obj" \
  @"$BUILD/sources.txt"

echo "== dx: converting to classes.dex =="
dx --dex --output="$BUILD/classes.dex" "$BUILD/obj"

echo "== aapt: packaging resources + assets =="
aapt package -f \
  -M "$PROJ/src/main/AndroidManifest.xml" \
  -S "$PROJ/src/main/res" \
  -A "$PROJ/src/main/assets" \
  -I "$ANDROID_JAR" \
  -F "$BUILD/apk/notesino.unsigned.apk"

( cd "$BUILD" && zip -q -j "$BUILD/apk/notesino.unsigned.apk" classes.dex )

echo "== zipalign =="
zipalign -f -p 4 "$BUILD/apk/notesino.unsigned.apk" "$BUILD/apk/notesino.aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  echo "== generating a debug keystore (first run only) =="
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias notesinodebug \
    -storepass notesino123 \
    -keypass notesino123 \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Notesino Debug, OU=Dev, O=Notesino, L=Local, S=NA, C=US"
fi

echo "== apksigner: signing =="
apksigner sign \
  --ks "$KEYSTORE" \
  --ks-key-alias notesinodebug \
  --ks-pass pass:notesino123 \
  --key-pass pass:notesino123 \
  --out "$BUILD/apk/notesino-debug-signed.apk" \
  "$BUILD/apk/notesino.aligned.apk"

apksigner verify "$BUILD/apk/notesino-debug-signed.apk"

echo
echo "Built: $BUILD/apk/notesino-debug-signed.apk"

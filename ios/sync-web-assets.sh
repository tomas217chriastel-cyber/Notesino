#!/usr/bin/env bash
# Copies the current root index.html/manifest.json/service-worker.js/icons
# into ios/Notesino/www so the iOS app bundle matches the web app. Run this
# after any change to those files and before building in Xcode -- nothing
# in the Xcode project reaches outside ios/Notesino/www on its own.
set -euo pipefail
cd "$(dirname "$0")/.."

cp index.html ios/Notesino/www/index.html
cp manifest.json ios/Notesino/www/manifest.json
cp service-worker.js ios/Notesino/www/service-worker.js
mkdir -p ios/Notesino/www/icons
cp icons/*.png ios/Notesino/www/icons/

echo "Synced web assets into ios/Notesino/www"

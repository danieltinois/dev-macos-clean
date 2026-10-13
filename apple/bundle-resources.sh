#!/bin/sh
# Xcode build phase: builds the shared UI (desktop/) and the TypeScript engine
# (core/, with rules/ embedded) with Bun and copies them into the app.
# Xcode doesn't load the shell profile, so look for Bun in the usual places.
set -eu
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  echo "error: Bun not found. Install Bun 1.2+ (https://bun.sh) to build DevClean."
  exit 1
fi
cd "$SRCROOT/.."
bun scripts/build.ts
resources="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
mkdir -p "$resources/ui"
cp dist/engine/devclean-engine.js "$resources/"
cp dist/desktop/index.html dist/desktop/renderer.js dist/desktop/style.css "$resources/ui/"

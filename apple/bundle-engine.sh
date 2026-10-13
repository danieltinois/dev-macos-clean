#!/bin/sh
# Xcode build phase: bundles the TypeScript engine (core/, with rules/ embedded)
# and copies it into the app. Needs Bun; Xcode doesn't load the shell profile.
set -eu
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  echo "error: Bun not found. Install Bun 1.2+ (https://bun.sh) to build DevClean."
  exit 1
fi
cd "$SRCROOT/.."
bun scripts/engine.ts
destination="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
mkdir -p "$destination"
cp dist/engine/devclean-engine.js "$destination/"

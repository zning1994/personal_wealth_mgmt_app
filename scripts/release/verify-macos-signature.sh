#!/usr/bin/env bash
set -euo pipefail
release_dir=${1:?release directory is required}
app_path=$(find "$release_dir" -maxdepth 2 -name '*.app' -print -quit)
if [[ -z "$app_path" ]]; then
  echo "No app bundle found" >&2
  exit 1
fi
codesign --verify --deep --strict --verbose=2 "$app_path"
spctl --assess --type execute --verbose=2 "$app_path"
for dmg in "$release_dir"/*.dmg; do
  [[ -e "$dmg" ]] || continue
  xcrun stapler validate "$dmg"
done

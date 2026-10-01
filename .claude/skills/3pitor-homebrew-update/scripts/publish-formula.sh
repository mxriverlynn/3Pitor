#!/usr/bin/env bash
# Commits the updated formula, and the alias when it is new, as "3pitor X.Y.Z"
# and pushes it to the tap's main branch. Removes the tap folder afterward when
# it was a temp clone.
# Usage: publish-formula.sh TAP_DIR X.Y.Z TEMP
set -euo pipefail

tap_dir=${1:?usage: publish-formula.sh TAP_DIR X.Y.Z TEMP}
version=${2:?usage: publish-formula.sh TAP_DIR X.Y.Z TEMP}
temp=${3:?usage: publish-formula.sh TAP_DIR X.Y.Z TEMP}
version=${version#v}

git -C "$tap_dir" add Formula/threepitor.rb Aliases/3pitor
git -C "$tap_dir" commit --quiet -m "3pitor $version"
# HEAD:main, because the first push into the empty tap creates main
git -C "$tap_dir" push --quiet origin HEAD:main

commit=$(git -C "$tap_dir" rev-parse HEAD)
echo "commit=https://github.com/mxriverlynn/homebrew-tap/commit/$commit"

if [ "$temp" = "yes" ]; then
  rm -rf "$(dirname "$tap_dir")"
fi

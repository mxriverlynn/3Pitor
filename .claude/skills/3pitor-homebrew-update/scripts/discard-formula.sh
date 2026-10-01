#!/usr/bin/env bash
# Undoes an unpushed formula update: restores Formula/threepitor.rb, removes a
# formula and alias that were just created, or removes the tap folder entirely
# when it was a temp clone.
# Usage: discard-formula.sh TAP_DIR TEMP
set -euo pipefail

tap_dir=${1:?usage: discard-formula.sh TAP_DIR TEMP}
temp=${2:?usage: discard-formula.sh TAP_DIR TEMP}

if [ "$temp" = "yes" ]; then
  rm -rf "$(dirname "$tap_dir")"
  echo "removed the temp clone"
  exit 0
fi

for file in Formula/threepitor.rb Aliases/3pitor; do
  if git -C "$tap_dir" ls-files --error-unmatch "$file" >/dev/null 2>&1; then
    git -C "$tap_dir" checkout --quiet -- "$file"
    echo "restored $file in $tap_dir"
  elif [ -e "$tap_dir/$file" ] || [ -L "$tap_dir/$file" ]; then
    rm "$tap_dir/$file"
    echo "removed the new $file from $tap_dir"
  fi
done

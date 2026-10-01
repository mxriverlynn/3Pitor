#!/bin/sh
# Bundles the UI and prints its CSS in two parts, for a before/after diff (D-10).
# Usage: css_snapshot.sh <out-dir>. Writes <out-dir>/rules.css (the CSS with only Bun's per-file
# "/* src/... */" and "/* node_modules/... */" header lines removed) and <out-dir>/order.txt (those headers, in order).
set -e
out=$1
rm -rf "$out" && mkdir -p "$out/bundle"
bun build ./src/ui/index.html --outdir="$out/bundle" > /dev/null
css=$(ls "$out"/bundle/*.css)
grep -E '^/\* (src|node_modules)/.*\.css \*/$' "$css" > "$out/order.txt"
grep -vE '^/\* (src|node_modules)/.*\.css \*/$' "$css" > "$out/rules.css"

#!/usr/bin/env bash
# Checks the GitHub Release for a tag: both archives and their .sha256 files are attached, each archive matches its
# .sha256 file and holds only 3pitor, and the archive for this Mac's architecture runs, reports the release version,
# and passes codesign verification.
# Prints one "sha256 <archive> <hash>" line per archive for the formula.
set -euo pipefail

tag=${1:?usage: verify-release.sh vX.Y.Z}
version=${tag#v}

fail() {
  echo "VERIFY FAILED: $1" >&2
  exit 1
}

release=$(gh release view "$tag" --json url,isDraft,assets)
echo "url=$(jq -r .url <<<"$release")"
echo "draft=$(jq -r .isDraft <<<"$release")"

archives=("3pitor-$version-darwin-arm64.tar.gz" "3pitor-$version-darwin-x86_64.tar.gz")
for archive in "${archives[@]}"; do
  for asset in "$archive" "$archive.sha256"; do
    jq -e --arg name "$asset" '.assets | any(.name == $name)' <<<"$release" >/dev/null ||
      fail "release $tag is missing $asset"
  done
done

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
gh release download "$tag" --dir "$dir" --pattern '3pitor-*'

for archive in "${archives[@]}"; do
  actual=$(shasum -a 256 "$dir/$archive" | awk '{print $1}')
  expected=$(awk '{print $1}' "$dir/$archive.sha256")
  [ "$actual" = "$expected" ] || fail "$archive hashes to $actual, but its .sha256 file says $expected"
  [ "$(tar -tzf "$dir/$archive")" = "3pitor" ] || fail "$archive must hold exactly one entry, 3pitor"
  echo "sha256 $archive $actual"
done

case "$(uname -m)" in
  arm64) local_arch=arm64 ;;
  x86_64) local_arch=x86_64 ;;
  *) echo "skipped run check: no archive for $(uname -m)"; exit 0 ;;
esac

mkdir "$dir/$local_arch"
tar -xzf "$dir/3pitor-$version-darwin-$local_arch.tar.gz" -C "$dir/$local_arch"
reported=$(OPEN_BROWSER=0 "$dir/$local_arch/3pitor" --version)
[ "$reported" = "3pitor $version" ] || fail "3pitor --version printed '$reported', expected '3pitor $version'"
codesign --verify --strict "$dir/$local_arch/3pitor" || fail "the $local_arch binary fails codesign verification"
echo "checked darwin-$local_arch: --version $reported, signature valid"

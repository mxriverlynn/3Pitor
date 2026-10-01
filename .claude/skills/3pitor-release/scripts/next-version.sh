#!/usr/bin/env bash
# Resolves the release version from patch, minor, major, or an exact X.Y.Z. The current version is the newest vX.Y.Z
# tag, since the tag is 3pitor's only version source, or 0.0.0 before the first release.
# Prints the new version. Exits 1 if it is not newer than the current version or its tag already exists locally or on
# origin.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

request=${1:?usage: next-version.sh patch|minor|major|X.Y.Z}
current=$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
current=${current#v}
current=${current:-0.0.0}

[[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]
major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}

case "$request" in
  patch) next="$major.$minor.$((patch + 1))" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  major) next="$((major + 1)).0.0" ;;
  *)
    # Accept a leading v so "v0.2.0" and "0.2.0" mean the same thing
    next=${request#v}
    if ! [[ "$next" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "'$request' is not patch, minor, major, or X.Y.Z" >&2
      exit 1
    fi
    ;;
esac

if [ "$next" = "$current" ] || [ "$(printf '%s\n%s\n' "$current" "$next" | sort -V | tail -1)" != "$next" ]; then
  echo "$next is not newer than the current version $current" >&2
  exit 1
fi

if ! remote_tag=$(git ls-remote --tags origin "refs/tags/v$next"); then
  echo "could not reach origin to check whether tag v$next exists" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/v$next" >/dev/null || [ -n "$remote_tag" ]; then
  echo "tag v$next already exists" >&2
  exit 1
fi

echo "$next"

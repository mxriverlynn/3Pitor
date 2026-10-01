#!/usr/bin/env bash
# Commits the new CHANGELOG.md notes as "chore(release): vX.Y.Z" and creates an annotated vX.Y.Z tag on that commit.
# There is no version file to bump: release.yml stamps the version from the tag. Local only: nothing is pushed.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

version=${1:?usage: prepare-release.sh X.Y.Z}

if ! grep -q "^## v$version " CHANGELOG.md 2>/dev/null; then
  echo "CHANGELOG.md has no section for v$version. Write the release notes first." >&2
  exit 1
fi

git add CHANGELOG.md
git commit --quiet -m "chore(release): v$version"
git tag -a "v$version" -m "3pitor v$version"

echo "commit=$(git rev-parse HEAD)"
echo "tag=v$version"

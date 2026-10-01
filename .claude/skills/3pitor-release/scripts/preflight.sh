#!/usr/bin/env bash
# Checks that the repo is in a state a release can be cut from: main, clean, matching origin/main, and passing
# make test. 3pitor has no CI on main, so the test suite runs here instead.
# Prints the current version (the newest vX.Y.Z tag, or 0.0.0 before the first release) on success. Exits 1 with a
# reason on failure.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

fail() {
  echo "PREFLIGHT FAILED: $1" >&2
  exit 1
}

for tool in gh jq bun make; do
  command -v "$tool" >/dev/null || fail "$tool is not installed. Install it with: brew install $tool"
done

if ! gh auth status >/dev/null 2>&1; then
  fail "gh is not authenticated. Run: gh auth login"
fi

branch=$(git branch --show-current)
[ "$branch" = "main" ] || fail "on branch '$branch'. Releases are cut from main: git checkout main"

[ -z "$(git status --porcelain)" ] || fail "working tree has uncommitted changes. Commit or stash them first."

git fetch --quiet origin main --tags || fail "could not fetch from origin."
head=$(git rev-parse HEAD)
remote=$(git rev-parse origin/main)
[ "$head" = "$remote" ] || fail "local main ($head) differs from origin/main ($remote). Pull or push first."

[ -f .github/workflows/release.yml ] || fail ".github/workflows/release.yml is not on main, so a tag would build nothing."

log=$(mktemp)
if ! make test >"$log" 2>&1; then
  tail -40 "$log" >&2
  rm -f "$log"
  fail "make test failed on $head."
fi
rm -f "$log"

current=$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
current=${current#v}
echo "current_version=${current:-0.0.0}"
echo "head=$head"

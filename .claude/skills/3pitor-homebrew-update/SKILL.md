---
name: 3pitor-homebrew-update
description: >
  Updates the 3pitor Homebrew formula in the mxriverlynn/homebrew-tap repo to a published release: confirms the release
  is public and each macOS archive matches its checksum file, rewrites the formula's url and sha256 lines for Apple
  silicon and Intel, checks the formula with ruby and brew style, and commits and pushes it after approval. On the first
  release it creates Formula/threepitor.rb and the Aliases/3pitor link that lets users type 3pitor. Use when updating,
  bumping, creating, or publishing the Homebrew formula or tap for a new 3pitor version, or when 3pitor-release reaches
  its Homebrew step. Requires the gh CLI and Homebrew. Does not cut, tag, or publish the release itself; use
  3pitor-release for that.
argument-hint: "[X.Y.Z]"
allowed-tools: Bash(gh release view *)
---

# Update the 3pitor Homebrew Formula

Point `Formula/threepitor.rb` in `mxriverlynn/homebrew-tap` at one published 3pitor release, so
`brew install mxriverlynn/tap/3pitor` installs it. The formula is named `threepitor` because a Ruby class cannot start
with a digit; the tap's `Aliases/3pitor` link carries the name users type. The version is `$ARGUMENTS` (may be empty).

Run every script from the 3pitor repository root. When a script exits non-zero, show the user its output and stop.

## Step 1: Resolve the Version

If `$ARGUMENTS` is empty, find the latest published release with
`gh release view --repo mxriverlynn/3Pitor --json tagName --jq .tagName` and use it. Call the version `{version}`,
without the `v`.

## Step 2: Find the Tap

Find a checkout to edit by running `${CLAUDE_SKILL_DIR}/scripts/locate-tap.sh`. Capture `tap_dir` and `temp`.

It uses `../homebrew-tap` when that folder's origin is `mxriverlynn/homebrew-tap`, fast-forwarding it to `origin/main`
when it is only behind. It stops when that clone is on another branch, has uncommitted changes, or has unpushed
commits. Never fix the clone yourself BECAUSE the user owns its state. Without the sibling clone, it clones the tap into
a temp folder (`temp=yes`).

## Step 3: Update the Formula

Update the formula by running `${CLAUDE_SKILL_DIR}/scripts/update-formula.sh {tap_dir} {version}`. It checks that the
`v{version}` release is published and newer than the formula's version, and that both archives download without GitHub
credentials and match their `.sha256` files. It then rewrites both `url` and `sha256` lines, runs `ruby -c` and
`brew style`, and prints the `sha256` lines, `created`, and the formula diff.

When the tap has no `Formula/threepitor.rb` yet, the script first copies `${CLAUDE_SKILL_DIR}/assets/threepitor.rb` into
the tap, adds the `Aliases/3pitor` link, and prints `created=yes` with the whole new formula in place of a diff. Never
hand-edit the formula's `url` or `sha256` lines BECAUSE the script's checksums are the ones Homebrew will verify.

- Exit code 3 means the formula already points at `{version}`. Tell the user there is nothing to update, run
  `${CLAUDE_SKILL_DIR}/scripts/discard-formula.sh {tap_dir} {temp}` to remove any temp clone, and stop.
- Exit code 1 means a check failed. Show the reason, run `${CLAUDE_SKILL_DIR}/scripts/discard-formula.sh {tap_dir}
  {temp}` to undo any partial edit, and stop.

## Step 4: Approval to Push

Show the user the formula diff, or the new formula and alias when `created=yes`, then ask them to approve pushing it.
State what happens next: a `3pitor {version}` commit goes to the `main` branch of `mxriverlynn/homebrew-tap`, and from
then on `brew install` and `brew upgrade` install `{version}` for everyone. When `created=yes`, say this is the tap's
first formula, so it makes `brew install mxriverlynn/tap/3pitor` work for the first time.

If the user declines, undo the edit by running `${CLAUDE_SKILL_DIR}/scripts/discard-formula.sh {tap_dir} {temp}`, then
stop.

## Step 5: Commit and Push

Publish the update by running `${CLAUDE_SKILL_DIR}/scripts/publish-formula.sh {tap_dir} {version} {temp}`. Capture the
`commit` URL. If the push is rejected, stop and tell the user the commit exists only in `{tap_dir}`, so nothing reached
Homebrew users.

## Step 6: Report

Tell the user the formula now installs `{version}`, with the tap commit URL and the two `sha256` lines. Remind them
that `brew upgrade 3pitor` picks it up after `brew update`. When `created=yes`, suggest checking the first install with
`brew install mxriverlynn/tap/3pitor` and `brew test threepitor`.

When `3pitor-release` invoked this skill, hand control back to it after reporting.

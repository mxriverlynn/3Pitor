# Change Plan: Homebrew distribution for 3pitor

## Why This Change

3pitor should install with one `brew install` and run from any folder. Today the only way to get it is to clone the
repo, install Bun, and run `make build`. This is a constraint arriving: a new distribution requirement. It comes from
the operator's request: "use ~/dev/testdouble/skillwalker/docs/planning/homebrew-distribution/investigation.md to build
a plan for making 3pitor a homebrew installable project". That investigation covers a sibling project. It is the
pattern this plan follows, not a source of facts about 3pitor. The tap repo already exists:
https://github.com/mxriverlynn/homebrew-tap.

## What Changes, In One Paragraph

After this change, 3pitor knows its own version and can say so. Pushing a `v*` tag builds, signs, checks, and publishes
macOS archives for Apple silicon and Intel. A formula in the operator's tap installs the one binary onto `PATH`.

Someone runs `brew install mxriverlynn/tap/3pitor`, then `3pitor` from any folder of posts, and gets the editor in
their browser. `3pitor --version`, `-v`, and `--help` answer and exit cleanly. The missing-API-key warning names
`3pitor` rather than a contributor-only command. Contributors keep `bun run server` and `make build` as they are.

## Current State

3pitor is already close to installable. `make build` produces one self-contained executable with the UI, the system
prompt, and the app's skills embedded inside it
([C-1](artifacts/current-state-findings.md#c-1-the-build-is-one-self-contained-executable)). It runs through a symlink
from a read-only folder, launched from a third folder, and writes nothing beside itself
([C-2](artifacts/current-state-findings.md#c-2-the-binary-runs-through-a-symlink-from-a-read-only-folder-launched-from-another-folder)).
The only source-tree path it knows, `SRC`, is reached at runtime only when `WORKSPACE` is set
([C-5](artifacts/current-state-findings.md#c-5-the-source-tree-anchor-src-is-reached-at-runtime-only-through-workspace)).
Skillwalker needed a `libexec` layout, `post_install`, and a stable scripts folder. 3pitor needs none of them
([D-1](artifacts/change-decision-log.md#d-1-a-formula-holding-one-file-with-no-skillwalker-style-layout)).

What stands between 3pitor and a Homebrew install:

- **No version and no `--version`.** No version exists anywhere. `--version` and `--help` fail strict parsing and exit 2
  ([C-6](artifacts/current-state-findings.md#c-6-3pitor-has-no-version-and---version-and---help-exit-2)).
  `parseCommandLine` neither prints nor exits, and tests pin its whole return value
  ([C-7](artifacts/current-state-findings.md#c-7-parsecommandline-neither-prints-nor-exits-and-tests-pin-its-whole-return-value)).
- **No release pipeline.** There is no `.github/`, no tag, and no LICENSE
  ([C-9](artifacts/current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)).
- **Signing for Intel.** A native Apple silicon build already passes `codesign --verify`
  ([C-3](artifacts/current-state-findings.md#c-3-a-natively-built-apple-silicon-binary-already-has-a-valid-signature)).
  An Intel build cross-compiled on Apple silicon does not, until it is re-signed ad hoc
  ([C-4](artifacts/current-state-findings.md#c-4-a-cross-compiled-intel-binary-has-an-invalid-signature-and-an-ad-hoc-re-sign-fixes-it)).
- **The formula's name.** Homebrew cannot load a formula named `3pitor`, because Ruby class names cannot start with a
  digit. A tap alias can carry the name instead
  ([C-11](artifacts/current-state-findings.md#c-11-a-formula-cannot-be-named-3pitor-but-a-tap-alias-can-be)). The tap
  is empty ([C-12](artifacts/current-state-findings.md#c-12-the-tap-repo-exists-and-is-empty)).
- **A contributor-only command in user-facing text.** The missing-API-key help tells users to run `bun run server`
  ([C-8](artifacts/current-state-findings.md#c-8-the-missing-api-key-help-names-a-command-a-homebrew-user-cannot-run)).
  The README documents only the contributor path
  ([C-17](artifacts/current-state-findings.md#c-17-the-readme-documents-only-the-contributor-path)).

## Target State

Each part owns one stage of the version's trip from a git tag to a passing `brew test`.

| Part | Owns | Does not own |
| --- | --- | --- |
| `src/server/command-line.ts` | The `VERSION` constant; recognizing `--version`, `-v`, and `--help`; the `USAGE` text | Printing and exiting |
| `src/server/server.ts` `commandLine()` | Printing the version or the usage line, and exiting 0 | Parsing |
| `Makefile` `build` | Compiling, stamping `VERSION`, and taking an optional `TARGET` | Signing, packaging, reading tags |
| `.github/workflows/release.yml` | Tag to version, both builds, re-signing and verifying, the smoke check, archives, checksums, and the GitHub Release | Bumping the formula |
| `mxriverlynn/homebrew-tap` | `Formula/threepitor.rb`, `Aliases/3pitor`, the caveat, and the `brew test` contract | Building anything |
| `README.md` and the help strings | Installed-user wording and an "Install it" section | — |

**The version contract** ([D-2](artifacts/change-decision-log.md#d-2-the-git-tag-is-the-only-version-source-stamped-in-with---define)).
The git tag is the only source. Worked example:

```
git tag v0.1.0
  → release.yml: V=${GITHUB_REF_NAME#v}                       # 0.1.0
  → make build VERSION=0.1.0
  → bun build ... --define THREEPITOR_VERSION='"0.1.0"'
  → command-line.ts: VERSION = typeof THREEPITOR_VERSION === 'string' ? THREEPITOR_VERSION : 'dev'
  → `3pitor --version` writes "3pitor 0.1.0\n" to stdout, exits 0
  → assets 3pitor-0.1.0-darwin-arm64.tar.gz, 3pitor-0.1.0-darwin-x64.tar.gz
  → formula: version "0.1.0"; test asserts "3pitor #{version}\n"
```

A run from source, or `make build` with no `VERSION`, prints `3pitor dev`.

**The command-line contract** ([D-3](artifacts/change-decision-log.md#d-3---version--v-and---help-print-and-exit-cleanly)):

```ts
export type CommandLine =
  | { target: string | undefined; claude: ClaudeMode }
  | { print: 'version' | 'help' };
// options: claude (string, default 'auto'), version (boolean, short 'v'), help (boolean)
// Strict parsing first. Then: help wins over version, and both win over a bad --claude value.
```

`server.ts` acts on `{ print }` before it chooses a workspace. It writes `3pitor ${VERSION}` or `USAGE` to stdout and
exits 0. Every existing caller sees the run shape unchanged. The input-to-result table is in D-3.

**The archive contract** ([D-8](artifacts/change-decision-log.md#d-8-the-release-archive-contract)). Each release
carries `3pitor-<V>-darwin-arm64.tar.gz` and `3pitor-<V>-darwin-x64.tar.gz`. Each holds exactly one entry, `3pitor`, at
the root with mode 755, made by `tar -czf dist/<name> -C build 3pitor`. Both are published at
`https://github.com/mxriverlynn/3Pitor/releases/download/v<V>/<name>`.

**The release job**
([D-7](artifacts/change-decision-log.md#d-7-one-tag-triggered-release-job-builds-both-architectures-on-one-apple-silicon-runner)).
One job runs on `macos-15` (arm64), with Bun pinned to `1.4.2`. It builds natively through `make check-build`, then
cross-compiles Intel with `TARGET=bun-darwin-x64`. It re-signs and verifies both binaries, and checks the native
`--version` output. It writes the checksums to the job summary and creates the GitHub Release last, so a failure
anywhere earlier publishes nothing.

**The formula** ([D-9](artifacts/change-decision-log.md#d-9-the-formula-is-threepitor-with-the-alias-3pitor)). The
formula is `Formula/threepitor.rb` (`class Threepitor`), with `Aliases/3pitor` linking to it. It downloads per
architecture inside `on_arm`/`on_intel` and runs `bin.install "3pitor"`. Its test checks `--version` exactly and runs
`codesign --verify --strict`. One caveat says chat needs an API key or the `claude` program
([D-15](artifacts/change-decision-log.md#trivial-decisions)). The operator bumps it by hand from the job summary
([D-10](artifacts/change-decision-log.md#d-10-the-formula-is-bumped-by-hand-for-now)).

## Surface Delta

### S-1: `VERSION` in `src/server/command-line.ts` — Added

**Target state.** `command-line.ts` exports `VERSION: string`. Its value is the build-time global `THREEPITOR_VERSION`
when `bun build --define` set it, and `'dev'` otherwise. The module declares the global as
`declare const THREEPITOR_VERSION: string | undefined` and reads it behind a `typeof` guard.

**Behavior.** Preserving. Nothing observes the constant until S-3 prints it.

**Why.** A formula test needs a version to check, and none exists
([C-6](artifacts/current-state-findings.md#c-6-3pitor-has-no-version-and---version-and---help-exit-2),
[C-18](artifacts/current-state-findings.md#c-18-bun-build---define-stamps-a-value-into-a-compiled-binary-and-source-runs-fall-back)).

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-git-tag-is-the-only-version-source-stamped-in-with---define)

### S-2: `parseCommandLine` — Re-scoped

**Target state.** `parseCommandLine(argv, env)` returns `CommandLine`, which is either the run shape
`{ target, claude }` or `{ print: 'version' | 'help' }`. It recognizes `--version`, `-v`, and `--help`, and it still
neither prints nor exits. Unknown options still throw. `--help` wins over `--version`, and both win over an invalid
`--claude` value.

**Behavior.** Changing. Inputs that used to throw `Unknown option` now return a `print` result. Settled by the operator
in D-3.

**Why.** `--version` must exit 0 for the formula test, and the operator asked for `-v` and `--help` too.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3---version--v-and---help-print-and-exit-cleanly)

### S-3: `commandLine()` in `src/server/server.ts` — Re-scoped

**Target state.** `commandLine()` returns only the run shape. On a `print` result it writes `3pitor <VERSION>` (for
`version`) or `USAGE` (for `help`) to stdout, and exits 0. That happens before `chooseWorkspace`, the session load,
`Bun.serve`, and the browser open. A parse error still writes to stderr and exits 2.

**Behavior.** Changing. `3pitor --version`, `-v`, and `--help` now print and exit 0 instead of exiting 2. Settled by the
operator in D-3.

**Why.** The printing half of S-2. Printing and exiting already live here
([C-7](artifacts/current-state-findings.md#c-7-parsecommandline-neither-prints-nor-exits-and-tests-pin-its-whole-return-value)).

**Depends on.** S-1, S-2.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3---version--v-and---help-print-and-exit-cleanly)

### S-4: `USAGE` — Re-scoped

**Target state.** `USAGE` is exactly `Usage: 3pitor [--claude=auto|api|cli] [--version|-v] [--help] [folder-or-file]`.

**Behavior.** Changing. The usage line after a bad flag, and the output of `--help`, now list the new flags. Settled by
the operator in D-5.

**Why.** `--help` prints this line, so it has to mention the flags it documents.

**Depends on.** S-2.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-usage-line-lists-the-new-flags)

### S-5: `MISSING_API_KEY_HELP` — Re-scoped

**Target state.** `MISSING_API_KEY_HELP` ends with `  ANTHROPIC_API_KEY=sk-ant-... 3pitor`, the same last line as
`CLAUDE_NOT_FOUND_HELP`. Its first line is unchanged.

**Behavior.** Changing. The startup warning and the chat-panel error for a missing key name `3pitor` rather than
`bun run server`. Settled by the operator in D-4.

**Why.** A Homebrew user cannot run `bun run server`
([C-8](artifacts/current-state-findings.md#c-8-the-missing-api-key-help-names-a-command-a-homebrew-user-cannot-run)).

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-missing-api-key-help-names-the-installed-command)

### S-6: `VERSION` and `TARGET` in `Makefile` — Added

**Target state.** The `build` target takes `VERSION` (default `dev`) and an optional `TARGET`. It passes
`--define THREEPITOR_VERSION='"$(VERSION)"'` always, and `--target=$(TARGET)` only when `TARGET` is set. Its output is
still `build/3pitor`. `check-build` passes both variables through, because it depends on `build`. The Makefile does no
signing and has no new targets.

**Behavior.** Preserving. `make build` with no variables still produces one native `build/3pitor`, and
`make check-build` still passes. The binary's new `--version` answer belongs to S-3.

**Why.** It keeps the build flags in one place for both the native and the Intel release build
([C-10](artifacts/current-state-findings.md#c-10-check-build-is-a-ready-made-smoke-test-and-listening-on-is-a-contract)).

**Depends on.** S-1.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-the-makefile-stamps-the-version-and-takes-an-optional-target-and-does-no-signing)

### S-7: `.github/workflows/release.yml` — Added

**Target state.** A workflow runs on `push` of a `v*` tag. Its one `macos-15` job uses Bun `1.4.2` and does the steps
in D-7:

1. Native `make check-build`.
2. Re-sign and verify, then an exact `--version` check.
3. Pack the arm64 archive.
4. Build Intel with `TARGET=bun-darwin-x64`, re-sign, verify, and check the architecture.
5. Pack the x64 archive.
6. Write both checksums to the job summary.
7. Run `gh release create`, last.

**Behavior.** Preserving. The workflow is new and runs only on tag pushes. Nothing existing observes it.

**Why.** No release pipeline exists
([C-9](artifacts/current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)), and
the Intel build must be re-signed
([C-4](artifacts/current-state-findings.md#c-4-a-cross-compiled-intel-binary-has-an-invalid-signature-and-an-ad-hoc-re-sign-fixes-it)).

**Depends on.** S-6.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-one-tag-triggered-release-job-builds-both-architectures-on-one-apple-silicon-runner),
[D-10](artifacts/change-decision-log.md#d-10-the-formula-is-bumped-by-hand-for-now)

### S-8: Release archives — Added

**Target state.** Every `v<V>` GitHub Release carries `3pitor-<V>-darwin-arm64.tar.gz` and
`3pitor-<V>-darwin-x64.tar.gz`. Each is a gzip tarball with exactly one entry, `3pitor` (mode 755), at its root.

**Behavior.** Preserving. This is a new published format with no existing reader.

**Why.** It is the seam between the workflow and the formula. Both sides must agree on the names and the layout.

**Depends on.** S-7.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-release-archive-contract)

### S-9: `Formula/threepitor.rb` and `Aliases/3pitor` in `mxriverlynn/homebrew-tap` — Added

**Target state.** The tap holds `Formula/threepitor.rb`, defining `class Threepitor < Formula`, and `Aliases/3pitor`, a
symlink to it.

- The formula declares `version`, `depends_on :macos`, and per-architecture `url`/`sha256` inside `on_arm`/`on_intel`,
  pointing at S-8's assets.
- It runs `bin.install "3pitor"` and prints one caveat about the API key or `claude`.
- Its test asserts `"3pitor #{version}\n"` from `--version` and runs `codesign --verify --strict`.
- `brew install mxriverlynn/tap/3pitor` installs it.

**Behavior.** Preserving. The formula is new.

**Why.** It is the install vehicle the reason asks for
([C-11](artifacts/current-state-findings.md#c-11-a-formula-cannot-be-named-3pitor-but-a-tap-alias-can-be),
[C-12](artifacts/current-state-findings.md#c-12-the-tap-repo-exists-and-is-empty)).

**Depends on.** S-3, S-8, and a published release.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-a-formula-holding-one-file-with-no-skillwalker-style-layout),
[D-9](artifacts/change-decision-log.md#d-9-the-formula-is-threepitor-with-the-alias-3pitor),
[D-10](artifacts/change-decision-log.md#d-10-the-formula-is-bumped-by-hand-for-now),
[D-15](artifacts/change-decision-log.md#trivial-decisions)

### S-10: `README.md` — Re-scoped

**Target state.**

- The README opens its setup with an "Install it" section, ahead of "Run it". It covers
  `brew install mxriverlynn/tap/3pitor`, `brew upgrade 3pitor`, `3pitor --version`, and the API-key-or-`claude` note.
- It gives the release steps: push `vX.Y.Z`, then copy the checksums from the job summary into the tap formula.
- "Run it" and "Build it" remain the contributor path.
- Its copy of the usage line matches S-4.

**Behavior.** Preserving. This is documentation.

**Why.** The README documents only a clone
([C-17](artifacts/current-state-findings.md#c-17-the-readme-documents-only-the-contributor-path)).

**Depends on.** S-4 for the usage line. S-9 must be published for the "Install it" section.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-usage-line-lists-the-new-flags),
[D-11](artifacts/change-decision-log.md#d-11-readme-gets-an-install-it-section-after-the-formula-is-live)

## Behavior Changes

Four entries change what someone sees. The operator decided each one.

- **`3pitor --version` and `3pitor -v` (S-2, S-3).** Anyone running 3pitor from a terminal sees this, and so does
  Homebrew's own test. Today these print "Unknown option" and the usage line, then exit with an error. After the
  change they print `3pitor 0.1.0` (or `3pitor dev` from source) and exit cleanly, without starting the server. The
  operator chose this, adding `-v` and `--help` ("all of the above").
- **`3pitor --help` (S-2, S-3).** Today it prints "Unknown option" and exits with an error. After the change it prints
  the usage line and exits cleanly. The operator chose it.
- **The usage line (S-4).** It shows after every mistyped flag, and now from `--help`. It gains
  `[--version|-v] [--help]`. The operator chose "List them".
- **The missing-API-key warning (S-5).** It shows at startup and in the chat panel when a message fails. Its example
  command becomes `ANTHROPIC_API_KEY=sk-ant-... 3pitor`. The operator chose "Change to `3pitor`".

## Change Units

### Unit 1: Help text names the installed command

**What it does.** The missing-API-key help ends with the `3pitor` command.

**Delta entries.** S-5.

**How you know it worked.** `make test` passes unchanged. Starting with no key and `--claude=api` prints the new last
line.

### Unit 2: The CLI knows its version and answers `--version`, `-v`, and `--help`

**What it does.** Adds `VERSION`, the `CommandLine` union, the `print` handling in `server.ts`, and the new `USAGE`
text, along with the README's copy of the usage line.

**Delta entries.** S-1, S-2, S-3, S-4, and the usage-line part of S-10.

**How you know it worked.**

- New `command-line.test.ts` cases cover every row of D-3's input table, plus `VERSION === 'dev'` from source.
- The existing run-shape assertions stay as they are. The `USAGE` assertion changes to the new text.
- `bun run src/server/server.ts --version` prints `3pitor dev` and exits 0.
- `make test` passes.

### Unit 3: The build stamps a version and can cross-compile

**What it does.** Adds `VERSION` and `TARGET` to the `build` target.

**Delta entries.** S-6.

**Ordering constraint.** After Unit 2, so the stamped value is observable.

**How you know it worked.**

- `make build && ./build/3pitor --version` prints `3pitor dev`.
- `make build VERSION=0.0.0-test` prints `3pitor 0.0.0-test`.
- `make check-build` passes.
- `make build TARGET=bun-darwin-x64` gives an x86_64 file. Re-signing it ad hoc makes `codesign --verify --strict`
  pass, which repeats C-4.

### Unit 4: The release workflow

**What it does.** Adds `.github/workflows/release.yml`, which produces S-8's archives.

**Delta entries.** S-7, S-8.

**Ordering constraint.** After Unit 3.

**How you know it worked.**

- Before merging, run the workflow's steps locally, in order, against a fake `V`. Both binaries verify, the
  `--version` check passes, and each tarball lists exactly `3pitor`.
- After merging, the operator pushes `v0.1.0`
  ([D-12](artifacts/change-decision-log.md#trivial-decisions)). The job goes green and a release with two assets
  appears.
- If the job fails, nothing is published. Delete the tag, fix the problem, and tag again.

### Unit 5: The tap formula and alias

**What it does.** Commits `Formula/threepitor.rb` and `Aliases/3pitor` to `mxriverlynn/homebrew-tap`, with the
checksums from the `v0.1.0` job summary.

**Delta entries.** S-9.

**Ordering constraint.** After the `v0.1.0` release exists.

**How you know it worked.** All of these pass:

- `brew install mxriverlynn/tap/3pitor`
- `brew test threepitor`
- `brew audit --strict mxriverlynn/tap/threepitor`
- `3pitor` from an empty folder opens the editor.

### Unit 6: README "Install it" section

**What it does.** Documents installing, upgrading, and releasing.

**Delta entries.** The rest of S-10.

**Ordering constraint.** After Unit 5, so the README never points at an install that does not exist.

**How you know it worked.** The README's install commands work on a machine without the repo.

### After Unit 6: the upgrade check

Release `v0.1.1`, bump the formula, and run `brew upgrade 3pitor`. Then confirm three things:

- `3pitor --version` prints `3pitor 0.1.1`.
- `codesign --verify --strict` passes on the Cellar binary.
- An already-open workspace's `.3pitor/` state loads in the new version.

## Risks

- **The tap alias may not resolve the way Homebrew's source suggests.** C-11 comes from reading `formulary.rb`, not
  from a real install. Unit 5's `brew install mxriverlynn/tap/3pitor` detects this at once. The fallback is to
  document `brew install mxriverlynn/tap/threepitor`.
- **The Intel binary is checked only for architecture and signature in CI.** It never runs there. C-4 ran it under
  Rosetta locally, but not on an Intel Mac. A user on an Intel Mac would be the first to find a runtime problem. Run
  `arch -x86_64 build/3pitor --version` locally before the first tag.
- **A hosted runner may behave differently from this Mac.** C-3 and C-4 were measured locally. The workflow re-signs
  and verifies both binaries regardless, so a difference fails the job before anything is published.
- **Homebrew could alter the binary on install.** No relocation is expected for a downloaded binary with no Homebrew
  prefix in it. The formula test's `codesign --verify` catches it if it happens.
- **A missed bump.** With a manual bump, a release can exist while the formula still points at the previous one. Users
  simply stay on the older version until the bump. Nothing breaks.

## Deferred (YAGNI)

| Item | Why deferred | Reopen when |
| --- | --- | --- |
| `-h` short flag | The operator's approved usage line has none, and nothing asks for it ([D-13](artifacts/change-decision-log.md#trivial-decisions)) | Someone asks for it |
| Automated formula bump (bump action and a tap token) | No releases yet, so no measured friction ([D-10](artifacts/change-decision-log.md#d-10-the-formula-is-bumped-by-hand-for-now)) | A bump is forgotten or wrong, or the third manual bump |
| Signing inside `make build` | Local builds are native and already verify ([C-3](artifacts/current-state-findings.md#c-3-a-natively-built-apple-silicon-binary-already-has-a-valid-signature)) | A supported local cross-compile or second distribution path |
| `version` in `package.json` / a `version.ts` module | A duplicate source with no reader ([D-2](artifacts/change-decision-log.md#d-2-the-git-tag-is-the-only-version-source-stamped-in-with---define)) | A tool or second module needs to read it |
| Version in `/api/health` | No reader | The UI or a support flow needs it |
| `.bun-version` or `packageManager` pin | One literal in the one workflow is enough | A second workflow appears |

## Cut for Scope

- **Linux builds and Homebrew on Linux.** These would have published Linux archives and let the formula install on
  Linux. They were offered in the confirmation turn, and the operator did not add them
  (`artifacts/scope-boundary.md`, Operator-Stated Scope).
- **CI on every pull request.** This would have run `make test` and `make check-build` on each PR. It was offered, and
  the operator did not add it (same citation).
- **Startup failures Homebrew does not cause.** These would have turned three crashes into clear messages: a missing
  `WORKSPACE` folder, a read-only workspace with a stored mid-turn session, and a bad `PORT`
  ([C-15](artifacts/current-state-findings.md#c-15-existing-startup-failures-that-homebrew-does-not-cause)). The
  confirmed area does not include these files.

The operator can reinstate any of these, and their saying so is itself the justification the reinstated entry records.

## Open Items

- **License (non-blocking).** The repo is public with no LICENSE file
  ([C-9](artifacts/current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)). The
  formula works without a `license` line, but publishing binaries with no stated license leaves users without terms.
  Settled by the operator choosing a license, after which the formula gains a `license` line
  ([D-14](artifacts/change-decision-log.md#trivial-decisions)).
- **`NODE_ENV` in the installed binary (non-blocking, Unverified).** It is not known whether a user's shell `NODE_ENV`
  can switch the installed binary into dev mode
  ([C-14](artifacts/current-state-findings.md#c-14-whether---production-inlines-node_env-in-the-binary-was-not-checked)).
  This is true of `make build` today and unchanged by this plan. Settled by running `NODE_ENV=development 3pitor` once.

## Review Findings

To be filled after the review round.

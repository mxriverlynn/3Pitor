# Change Plan: Homebrew distribution for 3pitor

## Why This Change

3pitor should install with one `brew install` and run from any folder. Today the only way to get it is to clone the
repo, install Bun, and run `make build`. This is a constraint arriving: a new distribution requirement.

It comes from the operator's request: "use ~/dev/testdouble/skillwalker/docs/planning/homebrew-distribution/investigation.md
to build a plan for making 3pitor a homebrew installable project". That investigation covers a sibling project. This
plan follows it as a pattern, not as a source of facts about 3pitor. The tap repo already exists, at
https://github.com/mxriverlynn/homebrew-tap.

## What Changes, In One Paragraph

After this change, 3pitor knows its own version and can report it. Pushing a `v` tag builds 3pitor on native Apple
silicon and Intel runners. Each build is smoke-tested, re-signed, and checked, and the archives land in a draft GitHub
Release. The operator publishes that release and updates a formula in their tap. Someone can then run
`brew install mxriverlynn/tap/3pitor`, start `3pitor` in any folder of posts, and get the editor in their browser.

`3pitor --version`, `-v`, and `--help` answer and exit cleanly. The missing-API-key warning names `3pitor` instead of a
command only contributors have. Contributors keep `bun run server` and `make build` as they are.

## Current State

3pitor is already close to installable:

- `make build` produces one self-contained executable, with the UI, the system prompt, and the app's skills inside it
  ([C-1](artifacts/current-state-findings.md#c-1-the-build-is-one-self-contained-executable)).
- It runs through a symlink, from a read-only folder, launched from a third folder, and writes nothing beside itself
  ([C-2](artifacts/current-state-findings.md#c-2-the-binary-runs-through-a-symlink-from-a-read-only-folder-launched-from-another-folder)).
- A user's `NODE_ENV` does not change what it serves
  ([C-14](artifacts/current-state-findings.md#c-14-a-users-node_env-does-not-change-the-page-the-installed-binary-serves)).

Skillwalker needed a `libexec` layout, `post_install`, and a stable scripts folder. 3pitor needs none of them
([D-1](artifacts/change-decision-log.md#d-1-a-formula-holding-one-file-with-no-skillwalker-style-layout)).

Five gaps stand between 3pitor and a Homebrew install:

- **It has no version, and `--version` fails.** No version exists anywhere. `--version` and `--help` fail strict
  parsing and exit 2
  ([C-6](artifacts/current-state-findings.md#c-6-3pitor-has-no-version-and---version-and---help-exit-2)).
  `parseCommandLine` neither prints nor exits, and its tests pin its whole return value
  ([C-7](artifacts/current-state-findings.md#c-7-parsecommandline-neither-prints-nor-exits-and-tests-pin-its-whole-return-value)).
- **It has no release pipeline.** There is no `.github/` folder, no tag, and no LICENSE
  ([C-9](artifacts/current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)).
  Skillwalker's shipped workflow is a working model in the operator's own repos
  ([C-21](artifacts/current-state-findings.md#c-21-skillwalkers-shipped-release-workflow-uses-a-native-intel-runner-and-a-draft-release)).
- **Signing needs checking.** A native Apple silicon build already passes `codesign --verify`
  ([C-3](artifacts/current-state-findings.md#c-3-a-natively-built-apple-silicon-binary-already-has-a-valid-signature)).
  An Intel build cross-compiled on Apple silicon passes only after an ad-hoc re-sign
  ([C-4](artifacts/current-state-findings.md#c-4-a-cross-compiled-intel-binary-has-an-invalid-signature-and-an-ad-hoc-re-sign-fixes-it)).
  Both builds need macOS 13 or later
  ([C-20](artifacts/current-state-findings.md#c-20-both-binaries-need-macos-130-or-later)).
- **The formula can't be named `3pitor`.** Homebrew cannot load a formula by that name, because Ruby class names
  cannot start with a digit. A tap alias can carry the name instead
  ([C-11](artifacts/current-state-findings.md#c-11-a-formula-cannot-be-named-3pitor-but-a-tap-alias-can-be)).
  The tap is empty ([C-12](artifacts/current-state-findings.md#c-12-the-tap-repo-exists-and-is-empty)). Skillwalker's
  formula shows a layout that passes `brew style` and `brew audit --strict`
  ([C-19](artifacts/current-state-findings.md#c-19-skillwalkers-formula-shape-passes-brew-style-and-brew-audit---strict)).
- **User-facing text assumes a clone.** The missing-API-key help tells users to run `bun run server`
  ([C-8](artifacts/current-state-findings.md#c-8-the-missing-api-key-help-names-a-command-a-homebrew-user-cannot-run)).
  The README documents only the contributor path
  ([C-17](artifacts/current-state-findings.md#c-17-the-readme-documents-only-the-contributor-path)).

## Target State

Each part owns one stage of the version's trip from a git tag to a passing `brew test`.

| Part | Owns | Does not own |
| --- | --- | --- |
| `src/server/command-line.ts` | The `VERSION` constant; recognizing `--version`, `-v`, and `--help`; the `USAGE` text | Printing and exiting |
| `src/server/server.ts` `commandLine()` | Printing the version or the usage line, and exiting 0 | Parsing |
| `Makefile` | Compiling with `THREEPITOR_VERSION` stamped in; `check-build` asserting the stamp | Signing, cross-compiling, packaging, reading tags |
| `.github/workflows/release.yml` | Checking the tag; native builds per architecture; smoke tests; re-signing and verifying; archives with checksums; the draft release | Publishing the release; bumping the formula |
| The operator | Publishing the draft, bumping the formula | — |
| `mxriverlynn/homebrew-tap` | `Formula/threepitor.rb`, `Aliases/3pitor`, the caveat, the `brew test` contract | Building anything |
| `README.md` and the help strings | Installed-user wording, "Install it", and release steps | — |

**The version contract**
([D-2](artifacts/change-decision-log.md#d-2-the-git-tag-is-the-only-version-source-stamped-in-with---define)). The git
tag is the only source of the version:

```
git tag v0.1.0
  → release.yml: V=${GITHUB_REF_NAME#v}; must match ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$
  → make check-build THREEPITOR_VERSION=0.1.0
  → bun build ... --define THREEPITOR_VERSION='"0.1.0"'
  → command-line.ts: VERSION = typeof THREEPITOR_VERSION === 'string' ? THREEPITOR_VERSION : 'dev'
  → `3pitor --version` writes "3pitor 0.1.0\n" to stdout, exits 0
  → assets 3pitor-0.1.0-darwin-arm64.tar.gz and 3pitor-0.1.0-darwin-x86_64.tar.gz, each with a .sha256
  → formula url ".../v0.1.0/3pitor-0.1.0-darwin-<arch>.tar.gz"; Homebrew detects version 0.1.0 from it
  → formula test asserts "3pitor #{version}\n"
```

A run from source, or `make build` with no version set, prints `3pitor dev`.

**The command-line contract**
([D-3](artifacts/change-decision-log.md#d-3---version--v-and---help-print-and-exit-cleanly)):

```ts
export type CommandLine =
  | { target: string | undefined; claude: ClaudeMode }
  | { print: 'version' | 'help' };
// options: claude (string, default 'auto'), version (boolean, short 'v'), help (boolean)
// Strict parsing runs first. Then: help wins over version, and both win over a bad --claude value and a folder.
```

`server.ts` acts on `{ print }` before it chooses a workspace. It writes `3pitor ${VERSION}` or `USAGE` to stdout and
exits 0. Every existing caller sees the run shape unchanged. The full input-to-result table is in D-3.

**The archive contract** ([D-8](artifacts/change-decision-log.md#d-8-the-release-archive-contract)). Each release
carries four assets at `https://github.com/mxriverlynn/3Pitor/releases/download/v<V>/<name>`:

- `3pitor-<V>-darwin-arm64.tar.gz` and `3pitor-<V>-darwin-x86_64.tar.gz`. Each holds exactly one entry, `3pitor`, at the
  root, with mode 755.
- A `.sha256` file beside each tarball.

**The release workflow**
([D-7](artifacts/change-decision-log.md#d-7-tag-triggered-release-on-native-runners-ending-in-a-draft-release)) is
modeled on Skillwalker's shipped workflow. A tag matching `v[0-9]*` starts it.

- A build matrix runs on `macos-15` (arm64) and `macos-15-intel` (x86_64). Each job has a 20-minute timeout, a
  read-only token, Bun 1.4.2, and checkout without persisted credentials. Each job does four things:
  1. Checks the tag's version against a semver pattern.
  2. Runs `make check-build` with that version.
  3. Re-signs ad hoc and verifies, then checks `--version` again.
  4. Packs the tarball, checks its listing, writes its `.sha256`, and uploads it.
- A release job on `ubuntu-latest` alone holds `contents: write`. It creates a **draft** release with `GH_TOKEN`,
  `--repo`, and `--verify-tag`.

**Publishing** ([D-10](artifacts/change-decision-log.md#d-10-publish-the-draft-then-bump-the-formula-by-hand)). The
operator checks the draft, publishes it, then edits the formula's two `url` and two `sha256` lines from the `.sha256`
assets. A published version is never re-used
([D-16](artifacts/change-decision-log.md#trivial-decisions)).

**The formula**
([D-9](artifacts/change-decision-log.md#d-9-the-formula-is-threepitor-with-the-alias-3pitor-shaped-like-skillwalkers)).
The tap holds `Formula/threepitor.rb` (`class Threepitor`) and `Aliases/3pitor`, which links to it. Its layout copies
Skillwalker's:

- `depends_on :macos` and `depends_on macos: :ventura`.
- `on_macos` holding `on_arm`/`on_intel` blocks, each with a literal `url` and `sha256`, and no `version` line.
- `bin.install "3pitor"`.
- One caveat about the API key or `claude`
  ([D-15](artifacts/change-decision-log.md#trivial-decisions)).
- A test asserting `"3pitor #{version}\n"` and running `codesign --verify --strict`.

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

**Target state.** `parseCommandLine(argv, env)` returns `CommandLine`: either the run shape `{ target, claude }` or
`{ print: 'version' | 'help' }`.

- It recognizes `--version`, `-v`, and `--help`, and still neither prints nor exits.
- Unknown options still throw.
- `--help` wins over `--version`. Both win over an invalid `--claude` value and over a folder argument.

**Behavior.** Changing. Inputs that used to throw `Unknown option` now return a `print` result. Settled by the operator
in D-3.

**Why.** `--version` must exit 0 for the formula test, and the operator asked for `-v` and `--help` too.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3---version--v-and---help-print-and-exit-cleanly),
[D-18](artifacts/change-decision-log.md#d-18-new-tests-for-the-cli-and-the-help-text)

### S-3: `commandLine()` in `src/server/server.ts` — Re-scoped

**Target state.** `commandLine()` returns only the run shape.

- On a `print` result, it writes `3pitor <VERSION>` (for `version`) or `USAGE` (for `help`) to stdout and exits 0. That
  happens before `chooseWorkspace`, the session load, `Bun.serve`, and the browser open.
- A parse error still writes to stderr and exits 2.

**Behavior.** Changing. `3pitor --version`, `-v`, and `--help` now print and exit 0 instead of exiting 2. Settled by the
operator in D-3.

**Why.** It is the printing half of S-2. Printing and exiting already live here
([C-7](artifacts/current-state-findings.md#c-7-parsecommandline-neither-prints-nor-exits-and-tests-pin-its-whole-return-value)).

**Depends on.** S-1, S-2.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3---version--v-and---help-print-and-exit-cleanly),
[D-18](artifacts/change-decision-log.md#d-18-new-tests-for-the-cli-and-the-help-text)

### S-4: `USAGE` — Re-scoped

**Target state.** `USAGE` is exactly `Usage: 3pitor [--claude=auto|api|cli] [--version|-v] [--help] [folder-or-file]`.

**Behavior.** Changing. The usage line after a bad flag, and the output of `--help`, now list the new flags. Settled by
the operator in D-5.

**Why.** `--help` prints this line, so it has to name the flags it documents.

**Depends on.** S-2.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-usage-line-lists-the-new-flags)

### S-5: `MISSING_API_KEY_HELP` — Re-scoped

**Target state.** `MISSING_API_KEY_HELP` ends with `  ANTHROPIC_API_KEY=sk-ant-... 3pitor`, the same last line as
`CLAUDE_NOT_FOUND_HELP`. Its first line is unchanged.

**Behavior.** Changing. The startup warning and the chat-panel error for a missing key name `3pitor` instead of
`bun run server`. Settled by the operator in D-4.

**Why.** A Homebrew user cannot run `bun run server`
([C-8](artifacts/current-state-findings.md#c-8-the-missing-api-key-help-names-a-command-a-homebrew-user-cannot-run)).

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-missing-api-key-help-names-the-installed-command),
[D-18](artifacts/change-decision-log.md#d-18-new-tests-for-the-cli-and-the-help-text)

### S-6: `THREEPITOR_VERSION` in the `Makefile`, and the `check-build` version assertion — Added

**Target state.**

- The Makefile defines `THREEPITOR_VERSION ?= dev`.
- `build` passes `--define THREEPITOR_VERSION='"$(THREEPITOR_VERSION)"'` to `bun build`, and its output is still
  `build/3pitor`.
- `check-build` keeps its existing checks, then asserts that `OPEN_BROWSER=0 build/3pitor --version` prints exactly
  `3pitor $(THREEPITOR_VERSION)`.
- The Makefile has no signing, no cross-compile variable, and no new targets.

**Behavior.** Preserving. `make build` with no variables still produces one native `build/3pitor`. `make check-build`
still passes on a correct build. Its new assertion can fail only on a wrong stamp, which did not exist before.

**Why.** The build flags stay in one place for every release job. `check-build` becomes the repeatable proof of the
stamp
([C-10](artifacts/current-state-findings.md#c-10-check-build-is-a-ready-made-smoke-test-and-listening-on-is-a-contract)).

**Depends on.** S-1, S-3.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-git-tag-is-the-only-version-source-stamped-in-with---define),
[D-6](artifacts/change-decision-log.md#d-6-the-makefile-stamps-the-version-and-checks-it-and-does-no-signing-or-cross-compiling)

### S-7: `.github/workflows/release.yml` — Added

**Target state.** `release.yml` runs on a pushed tag matching `v[0-9]*`. It has two jobs.

- **A `build` matrix job** runs on `macos-15`/`arm64` and `macos-15-intel`/`x86_64`. Each leg has `timeout-minutes: 20`
  and a read-only token. In order, each leg:
  1. Checks out with `persist-credentials: false`.
  2. Sets up Bun `1.4.2`.
  3. Checks the version from the tag against the semver pattern.
  4. Runs `bun install --frozen-lockfile`.
  5. Runs `make check-build THREEPITOR_VERSION=$V`.
  6. Re-signs ad hoc and runs `codesign --verify --strict`.
  7. Checks `OPEN_BROWSER=0 build/3pitor --version` again.
  8. Packs the tarball, checks it lists exactly `3pitor`, and writes its `.sha256`.
  9. Uploads both files as an artifact.
- **A `release` job** on `ubuntu-latest` has `contents: write`. It downloads the artifacts. Then, with
  `GH_TOKEN: ${{ github.token }}`, it runs
  `gh release create "$GITHUB_REF_NAME" dist/* --repo "$GITHUB_REPOSITORY" --verify-tag --draft --generate-notes`.

**Behavior.** Preserving. The workflow is new, and only a `v<digit>` tag starts it. Nothing public appears until the
operator publishes the draft.

**Why.** No release pipeline exists
([C-9](artifacts/current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)).
Skillwalker's shipped workflow proves this shape
([C-21](artifacts/current-state-findings.md#c-21-skillwalkers-shipped-release-workflow-uses-a-native-intel-runner-and-a-draft-release)).

**Depends on.** S-6.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-tag-triggered-release-on-native-runners-ending-in-a-draft-release),
[D-16](artifacts/change-decision-log.md#trivial-decisions),
[D-19](artifacts/change-decision-log.md#d-19-intel-stays-in-scope)

### S-8: Release assets — Added

**Target state.** Every `v<V>` GitHub Release carries four assets:

- `3pitor-<V>-darwin-arm64.tar.gz` and `3pitor-<V>-darwin-x86_64.tar.gz`. Each is a gzip tarball with exactly one
  entry, `3pitor` (mode 755), at its root.
- A `.sha256` file beside each tarball, holding one `shasum -a 256` line.

**Behavior.** Preserving. This is a new published format with no existing reader.

**Why.** It is the seam between the workflow and the formula, and both sides must agree on its names and layout.

**Depends on.** S-7.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-release-archive-contract)

### S-9: `Formula/threepitor.rb` and `Aliases/3pitor` in `mxriverlynn/homebrew-tap` — Added

**Target state.** The tap holds `Formula/threepitor.rb`, defining `class Threepitor < Formula`, and `Aliases/3pitor`, a
symlink to it.

- The formula declares `depends_on :macos` and `depends_on macos: :ventura`.
- Its `on_macos` block holds an `on_arm` block and an `on_intel` block. Each has a literal versioned `url` pointing at
  an S-8 asset, plus that asset's `sha256`. There is no `version` line.
- It runs `bin.install "3pitor"` and prints one caveat about the API key or `claude`.
- Its test asserts `"3pitor #{version}\n"` from `--version` and runs `codesign --verify --strict`.

`brew install mxriverlynn/tap/3pitor` installs it, and `brew upgrade 3pitor` upgrades it.

**Behavior.** Preserving. The formula is new.

**Why.** It is the install vehicle the reason asks for
([C-11](artifacts/current-state-findings.md#c-11-a-formula-cannot-be-named-3pitor-but-a-tap-alias-can-be),
[C-19](artifacts/current-state-findings.md#c-19-skillwalkers-formula-shape-passes-brew-style-and-brew-audit---strict),
[C-20](artifacts/current-state-findings.md#c-20-both-binaries-need-macos-130-or-later)).

**Depends on.** S-3, S-8, and a published release.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-a-formula-holding-one-file-with-no-skillwalker-style-layout),
[D-9](artifacts/change-decision-log.md#d-9-the-formula-is-threepitor-with-the-alias-3pitor-shaped-like-skillwalkers),
[D-10](artifacts/change-decision-log.md#d-10-publish-the-draft-then-bump-the-formula-by-hand),
[D-15](artifacts/change-decision-log.md#trivial-decisions)

### S-10: `README.md` — Re-scoped

**Target state.** The README's setup opens with an "Install it" section, ahead of "Run it". It covers:

- `brew install mxriverlynn/tap/3pitor` and `brew upgrade 3pitor`;
- `3pitor --version`;
- macOS 13 or later;
- the note that chat needs an API key or `claude`.

A "Release it" note covers four steps:

1. Push `vX.Y.Z`.
2. Publish the draft.
3. Bump the formula's URLs and checksums from the `.sha256` assets.
4. Never re-use a version.

"Run it" and "Build it" remain the contributor path. The README's copy of the usage line matches S-4.

**Behavior.** Preserving for code. A README reader sees a new first section, which is a documentation change.

**Why.** The README documents only a clone
([C-17](artifacts/current-state-findings.md#c-17-the-readme-documents-only-the-contributor-path)).

**Depends on.** S-4, for the usage line. "Install it" needs S-9 published.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-usage-line-lists-the-new-flags),
[D-11](artifacts/change-decision-log.md#d-11-the-readme-gets-an-install-it-section-after-the-formula-is-live)

## Behavior Changes

Four entries change what someone sees, and the operator decided each one.

- **`3pitor --version` and `3pitor -v` (S-2, S-3).** Anyone running 3pitor from a terminal sees this, and so does
  Homebrew's own test. Today these print "Unknown option" and the usage line, then exit with an error. After the
  change they print `3pitor 0.1.0` (or `3pitor dev` from source) and exit cleanly, without starting the server. The
  operator chose this, adding `-v` and `--help` ("all of the above").
- **`3pitor --help` (S-2, S-3).** Today it prints "Unknown option" and exits with an error. After the change it prints
  the usage line and exits cleanly. The operator chose this.
- **The usage line (S-4).** This line follows every mistyped flag, and now `--help` prints it too. It gains
  `[--version|-v] [--help]`. The operator chose "List them".
- **The missing-API-key warning (S-5).** It shows at startup, and in the chat panel when a message fails. Its example
  command becomes `ANTHROPIC_API_KEY=sk-ant-... 3pitor`. The operator chose "Change to `3pitor`".

## Change Units

### Unit 1: Help text names the installed command

**What it does.** Ends the missing-API-key help with the `3pitor` command, and pins that line with a test.

**Delta entries.** S-5.

**How you know it worked.** A new assertion in `claude-backend.test.ts` checks that `MISSING_API_KEY_HELP` ends with
`ANTHROPIC_API_KEY=sk-ant-... 3pitor` and does not contain `bun run`. It fails before the edit and passes after it.
`make test` passes
([D-18](artifacts/change-decision-log.md#d-18-new-tests-for-the-cli-and-the-help-text)).

### Unit 2: The CLI knows its version and answers `--version`, `-v`, and `--help`

**What it does.** Adds `VERSION`, the `CommandLine` union, and the `print` handling in `server.ts`. Updates the `USAGE`
text and the README's copy of it.

**Delta entries.** S-1, S-2, S-3, S-4, and the usage-line part of S-10.

**How you know it worked.**

- `command-line.test.ts` has one test per row of D-3's table. The existing run-shape assertions are unchanged, and the
  `USAGE` assertion holds the new text.
- A new `src/server/server.test.ts` spawns `bun run src/server/server.ts` with piped stdout. It checks four things:
  - `--version` prints exactly `3pitor dev\n`, exits 0, and leaves stderr empty.
  - `--help` prints `USAGE` and exits 0.
  - `--version` with `WORKSPACE=<tmp>/new` does not create `<tmp>/new`.
  - `--claude=bogus` still exits 2, with the message and `USAGE` on stderr.
- `make test` passes.

### Unit 3: The build stamps and checks a version

**What it does.** Adds `THREEPITOR_VERSION` to `build` and the version assertion to `check-build`.

**Delta entries.** S-6.

**Ordering constraint.** After Unit 2, so the binary answers `--version`.

**How you know it worked.** `make check-build` passes, which proves the `dev` fallback.
`make check-build THREEPITOR_VERSION=0.0.0-test` passes, which proves the stamped value.

### Unit 4: The release workflow

**What it does.** Adds `.github/workflows/release.yml`, which produces S-8's assets as a draft release.

**Delta entries.** S-7, S-8.

**Ordering constraint.** After Unit 3.

**How you know it worked.**

- Before merging, run one leg's steps locally, with the archives going to a scratch folder rather than the repo. The
  binary verifies, `--version` matches, and the tarball lists exactly `3pitor`.
- After merging, the operator pushes `v0.1.0` from `main`
  ([D-12](artifacts/change-decision-log.md#trivial-decisions)). Both legs and the release job go green, and a draft
  release with four assets appears.
- If a job fails, delete the tag and any draft, fix the problem, and tag again. Nothing was published
  ([D-16](artifacts/change-decision-log.md#trivial-decisions)).

### Unit 5: Publish, and add the tap formula and alias

**What it does.** The operator publishes the `v0.1.0` draft. Then they commit `Formula/threepitor.rb` and
`Aliases/3pitor` to `mxriverlynn/homebrew-tap`, with the checksums from the `.sha256` assets.

**Delta entries.** S-9.

**Ordering constraint.** After the `v0.1.0` release is published.

**How you know it worked.** All of these pass:

- `brew style mxriverlynn/tap/threepitor`
- `brew audit --strict mxriverlynn/tap/threepitor`
- `brew install mxriverlynn/tap/3pitor`
- `brew test threepitor`
- `3pitor` from an empty folder opens the editor

### Unit 6: The README's "Install it" and "Release it" sections

**What it does.** Documents installing, upgrading, and releasing.

**Delta entries.** The rest of S-10.

**Ordering constraint.** After Unit 5, so the README never points at an install that does not exist.

**How you know it worked.** The README's install commands work on a machine without the repo.

### On the next real release: the upgrade check

When the next version with a real change ships, run `brew upgrade 3pitor`. Then confirm three things:

- `3pitor --version` prints the new version.
- `codesign --verify --strict` passes on the Cellar binary.
- An existing workspace's `.3pitor/` state loads.

Do not cut a release just to run this check.

## Risks

- **The tap alias might not resolve as Homebrew's source suggests.** C-11 and the reviewers' reading of
  `FromNameLoader` come from source, not a real install. Unit 5's `brew install mxriverlynn/tap/3pitor` detects it at
  once. The fallback is to document `brew install mxriverlynn/tap/threepitor`.
- **GitHub may retire the `macos-15-intel` runner.** The Intel leg would then stop starting. The proven fallback is to
  cross-compile on arm64 with an ad-hoc re-sign
  ([C-4](artifacts/current-state-findings.md#c-4-a-cross-compiled-intel-binary-has-an-invalid-signature-and-an-ad-hoc-re-sign-fixes-it)),
  adding a `--target` variable to the Makefile at that point.
- **Homebrew could alter the binary, or quarantine it.** No relocation is expected for a downloaded binary with no
  Homebrew prefix inside it. Formula downloads do not get the quarantine flag that casks do, and Skillwalker's ad-hoc
  signed formula installs the same way. The formula test's `codesign --verify` catches an altered signature. Only a
  real install proves the quarantine claim.
- **A release can be published while the formula still points at the old one.** Users stay on the older version until
  the bump, and nothing breaks.
- **The manual steps are easy to get wrong.** Swapping the two checksums makes `brew install` fail loudly, with a
  checksum mismatch, for one architecture. Each `.sha256` file names its archive, which makes a swap unlikely.

## Deferred (YAGNI)

| Item | Why deferred | Reopen when |
| --- | --- | --- |
| `-h` short flag | The operator's approved usage line has none, and nothing asks for it ([D-13](artifacts/change-decision-log.md#trivial-decisions)) | Someone asks for it |
| Automated formula bump (bump action and a tap token) | No releases yet, so no measured friction ([D-10](artifacts/change-decision-log.md#d-10-publish-the-draft-then-bump-the-formula-by-hand)) | A bump is forgotten or wrong, or the third manual bump |
| Cross-compiling Intel (`--target` in the Makefile) | Native Intel runners work today ([D-7](artifacts/change-decision-log.md#d-7-tag-triggered-release-on-native-runners-ending-in-a-draft-release)) | GitHub retires `macos-15-intel` |
| Signing inside `make build` | Local builds are native and already verify ([C-3](artifacts/current-state-findings.md#c-3-a-natively-built-apple-silicon-binary-already-has-a-valid-signature)) | A supported local cross-compile appears |
| Pinning actions to full commit SHAs | Skillwalker pins to major tags, and only the release job holds a write token ([D-7](artifacts/change-decision-log.md#d-7-tag-triggered-release-on-native-runners-ending-in-a-draft-release)) | A second maintainer, a long-lived secret, or a supply-chain policy |
| Checking that a tag sits on `main` | One maintainer reviews every draft ([D-17](artifacts/change-decision-log.md#trivial-decisions)) | A second person can push tags |
| `version` in `package.json` or a `version.ts` module | A duplicate source with no reader ([D-2](artifacts/change-decision-log.md#d-2-the-git-tag-is-the-only-version-source-stamped-in-with---define)) | A tool or a second module needs to read it |
| Version in `/api/health` | No reader | The UI or a support flow needs it |
| A `VERSION === 'dev'` unit test, extra parser rows, a README-contains-`USAGE` test | Covered by the kept tests ([D-18](artifacts/change-decision-log.md#d-18-new-tests-for-the-cli-and-the-help-text)) | `allowNegative` or `-h` is added, or the README drifts |
| A `.bun-version` or `packageManager` pin | The one workflow carries one literal | A second workflow appears |

## Cut for Scope

- **Linux builds and Homebrew on Linux.** These would have published Linux archives and let the formula install on
  Linux. The confirmation turn offered them, and the operator did not add them (`artifacts/scope-boundary.md`,
  Operator-Stated Scope).
- **CI on every pull request.** This would have run `make test` and `make check-build` on each PR. It was offered, and
  the operator did not add it (same citation).
- **Startup failures Homebrew does not cause.** This would have turned three crashes into clear messages: a missing
  `WORKSPACE` folder, a read-only workspace holding a stored mid-turn session, and a bad `PORT`
  ([C-15](artifacts/current-state-findings.md#c-15-existing-startup-failures-that-homebrew-does-not-cause)). The
  confirmed area does not include those files.
- **Ignoring `dist/` in git.** This would have stopped a local dry run from leaving archives to commit by accident.
  `.gitignore` is outside the confirmed area, so Unit 4 writes its dry-run archives to a scratch folder instead.

The operator can reinstate any of these, and their saying so is itself the justification the reinstated entry records.

## Open Items

- **License (non-blocking).** The repo is public with no LICENSE file
  ([C-9](artifacts/current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)). The
  formula installs and audits without a `license` line. But publishing binaries with no stated license leaves users
  with no terms. The operator settles this by choosing a license, after which the formula gains a `license` line
  ([D-14](artifacts/change-decision-log.md#trivial-decisions)).
- **Rosetta on the arm64 runner (non-blocking).** This matters only if the Intel leg ever moves to cross-compiling. In
  that case the first job log settles it.

## Review Findings

The review round ran once, with the junior-developer, devops-engineer, and test-engineer. A software-architect proposed
the target state first. The findings that changed the plan:

- **The first-draft formula would have failed Homebrew's own checks.** The junior-developer (JD-001) and the
  devops-engineer (DOR-002, DOR-011) found this. An explicit `version` line fails `brew audit`, and `url` inside a
  top-level `on_arm` fails `brew style`. Both were verified in this run. The formula now copies Skillwalker's layout,
  which passes both checks
  ([C-19](artifacts/current-state-findings.md#c-19-skillwalkers-formula-shape-passes-brew-style-and-brew-audit---strict),
  [D-9](artifacts/change-decision-log.md#d-9-the-formula-is-threepitor-with-the-alias-3pitor-shaped-like-skillwalkers)).
- **The release step had no token, and no checkout step** (JD-004, DOR-001). Following Skillwalker's shipped workflow,
  the step now sets `GH_TOKEN` and `--repo`, and gains `--verify-tag`
  ([C-21](artifacts/current-state-findings.md#c-21-skillwalkers-shipped-release-workflow-uses-a-native-intel-runner-and-a-draft-release),
  [D-7](artifacts/change-decision-log.md#d-7-tag-triggered-release-on-native-runners-ending-in-a-draft-release)).
- **The Intel binary never ran in CI** (DOR-006). The Intel leg moved to a native `macos-15-intel` runner, which runs
  the full smoke test. That also removed the Makefile's `TARGET` variable. The junior-developer's JD-002 proposed
  dropping Intel instead; that was overruled
  ([D-19](artifacts/change-decision-log.md#d-19-intel-stays-in-scope)).
- **Junk tags, a missing rollback path, and the scope of the write token** (DOR-003, DOR-004, DOR-005, JD-007). The
  plan now has these protections:
  - The tag filter and semver check stop a stray `v` tag.
  - Draft releases and roll-forward-only give a clean undo.
  - The write token is scoped to the release job.
  - Checkout keeps no credentials.
- **Hangs, and checksums that were easy to swap** (DOR-007, DOR-008). The plan now adds job timeouts, sets
  `OPEN_BROWSER=0` on the `--version` checks, and publishes a `.sha256` file per archive.
- **Generic Makefile variable names** (JD-005, DOR-009). `VERSION` was renamed `THREEPITOR_VERSION`.
- **The minimum macOS** (JD-003, DOR-010). Both binaries were measured at macOS 13.0, so the formula requires Ventura
  ([C-20](artifacts/current-state-findings.md#c-20-both-binaries-need-macos-130-or-later)).
- **Unit 1's check proved nothing, and the print-and-exit path had no test** (test-engineer T1, T2, T4). Unit 1 now pins
  the help text's last line, and Unit 2 adds a subprocess test. `check-build` now asserts the stamped version
  ([D-18](artifacts/change-decision-log.md#d-18-new-tests-for-the-cli-and-the-help-text),
  [D-6](artifacts/change-decision-log.md#d-6-the-makefile-stamps-the-version-and-checks-it-and-does-no-signing-or-cross-compiling)).
- **A release cut only to test upgrading** (JD-006). The upgrade check moved to the next real release.

Findings that stayed **Unverified** rest on things this run could not inspect: a GitHub-hosted runner, a real
`brew install` from the tap, and Homebrew's quarantine handling for formula downloads. They are named under Risks, and
none of them blocks the build. Pass B left no finding at build-blocking severity on an uninspected input.

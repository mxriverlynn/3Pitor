# Change Decision Log: Homebrew distribution for 3pitor

<!--
This file records every decision committed while planning Homebrew distribution for 3pitor.
The plan itself lives in [../change-plan.md](../change-plan.md). This file captures the
question, rationale, evidence, and rejected alternatives behind each decision.
Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

After the operator's first three answers, they said: "make the best decisions you can, without asking me".
Every decision after D-5 was settled by the run on evidence, without escalation.
-->

## Trivial decisions

- D-12: First release version — The first tag is `v0.1.0`. Nothing has shipped before, so it is a pre-1.0 version. —
  Referenced in plan: Change Units.
- D-13: No `-h` short flag — `--help` gets no `-h` alias. The operator approved the usage line
  `[--version|-v] [--help]`, which has no `-h`, and nothing asks for one. — Referenced in plan: Deferred (YAGNI).
- D-14: License left to the operator — The plan adds no LICENSE file and no `license` line in the formula. The confirmed
  area does not include a license
  ([C-9](current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)), and `brew audit`
  checks `license` only when one is present (devops review, "Brew checks with no finding"). — Referenced in plan:
  Open Items.
- D-15: Formula caveats — The formula prints one caveat: chat needs `ANTHROPIC_API_KEY` set, or the `claude` program
  installed and signed in
  ([C-13](current-state-findings.md#c-13-cli-mode-needs-claude-on-path-and-3pitor-never-installs-it)). — Referenced in
  plan: Target State, Surface Delta.
- D-16: Roll forward only — A published version is never re-tagged or replaced. A bad release is fixed with the next
  patch version. A failed or abandoned draft is deleted together with its tag. This is the devops review's DOR-004
  recommendation, and Homebrew cannot downgrade users through a re-used version. — Referenced in plan: Surface Delta,
  Risks.
- D-17: No check that a tag sits on `main` — The release job does not check which branch the tagged commit is on.
  There is one maintainer, and a person reviews every draft release (D-10). Reopen when a second person can push tags.
  — Referenced in plan: Deferred (YAGNI).

## Full decisions

### D-1: A formula holding one file, with no Skillwalker-style layout

- **Question:** How much of the Skillwalker plan's packaging carries over to 3pitor?
- **Decision:** Distribute 3pitor as a Homebrew **formula** in `mxriverlynn/homebrew-tap`, not a cask. The formula
  installs the one binary straight into `bin`. It has no `libexec` folder, no wrapper script, no `post_install`, no
  stable scripts folder, and no scripts-folder environment variable.
- **Rationale:** 3pitor builds to a single self-contained file. It runs through a symlink, from a read-only folder,
  launched from any folder. Every piece of Skillwalker's machinery existed either to keep six files together or to
  keep a sandbox mount stable across upgrades, and 3pitor has neither problem. The cask-versus-formula reasoning
  carries over unchanged.
- **Evidence:**
  - [C-1](current-state-findings.md#c-1-the-build-is-one-self-contained-executable)
  - [C-2](current-state-findings.md#c-2-the-binary-runs-through-a-symlink-from-a-read-only-folder-launched-from-another-folder)
  - [C-5](current-state-findings.md#c-5-the-source-tree-anchor-src-is-reached-at-runtime-only-through-workspace)
  - Skillwalker investigation E12.
- **Behavior impact:** Preserving. Nothing in the repo changes for this decision alone.
- **Rejected alternatives:**
  - A cask — rejected because a cask needs paid Developer ID signing and notarization (Skillwalker E12).
  - Skillwalker's `libexec` and `post_install` layout — rejected because 3pitor has no sidecar files and no sandbox
    mount (C-1, C-2).
- **Revisit criterion:** The build starts producing more than one file.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9
- **Dependent decisions:** D-7, D-8, D-9
- **Referenced in plan:** What Changes, In One Paragraph; Current State; Target State; Surface Delta

### D-2: The git tag is the only version source, stamped in with `--define`

- **Question:** Where does 3pitor's version come from, and how does it get into the binary?
- **Decision:** The pushed git tag is the only source of the version, and `package.json` gets no `version` field.
  - The Makefile variable is named `THREEPITOR_VERSION`, defaults to `dev`, and is passed to
    `bun build --define THREEPITOR_VERSION='"$(THREEPITOR_VERSION)"'`.
  - `command-line.ts` reads the global behind a `typeof` guard.
  - The release workflow accepts only a tag of the form `v<semver>`.

  ```
  git tag v0.1.0
    → release.yml: V=${GITHUB_REF_NAME#v}; [[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || exit 1
    → make check-build THREEPITOR_VERSION=0.1.0
    → bun build ... --define THREEPITOR_VERSION='"0.1.0"'
    → command-line.ts:
        declare const THREEPITOR_VERSION: string | undefined;
        export const VERSION = typeof THREEPITOR_VERSION === 'string' ? THREEPITOR_VERSION : 'dev';
    → `3pitor --version` prints "3pitor 0.1.0\n" on stdout, exit 0
    → assets 3pitor-0.1.0-darwin-arm64.tar.gz, 3pitor-0.1.0-darwin-x86_64.tar.gz
    → formula url ".../v0.1.0/3pitor-0.1.0-darwin-<arch>.tar.gz"; Homebrew detects version 0.1.0 from the url
    → formula test asserts "3pitor #{version}\n"
  ```

- **Rationale:**
  - One value flows end to end. `package.json` is `"private": true`, and nothing reads a version from it.
  - The define works: a compiled binary carries the value, and a source run falls back to `dev` without throwing.
  - Two reviewers flagged that a plain `VERSION` is a generic name, and a contributor's shell might already export
    it. A project-specific name avoids stamping a stray value.
  - The devops review showed that a tag like `v` or `vendor-test` would otherwise publish a junk release that passes
    every check, so the version is checked against a pattern first.
- **Evidence:**
  - [C-6](current-state-findings.md#c-6-3pitor-has-no-version-and---version-and---help-exit-2)
  - [C-9](current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)
  - [C-18](current-state-findings.md#c-18-bun-build---define-stamps-a-value-into-a-compiled-binary-and-source-runs-fall-back)
  - Software-architect A1; junior-developer JD-005; devops DOR-003, DOR-009.
- **Behavior impact:** Preserving on its own. The value becomes observable through D-3.
- **Rejected alternatives:**
  - A `version` field in `package.json` checked against the tag, as Skillwalker's workflow does — rejected because it
    adds a second source that must be kept equal to the tag by hand. 3pitor has no reader for it.
  - `git describe` inside the Makefile — rejected because it fails on a checkout with no tags (C-9).
  - A Makefile variable named `VERSION` — rejected because it is easy to pick up from a contributor's environment.
- **Revisit criterion:** A tool needs the version from `package.json`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-6, S-7
- **Dependent decisions:** D-3, D-6, D-7, D-8, D-9
- **Referenced in plan:** Target State; Surface Delta

### D-3: `--version`, `-v`, and `--help` print and exit cleanly

- **Question:** What does 3pitor do when asked for its version or for help?
- **Decision:** `parseCommandLine` returns a union: the unchanged run shape, or a request to print. `server.ts` prints
  and exits 0 before it chooses a workspace, loads the session, starts the server, or opens a browser.

  ```ts
  // command-line.ts
  export type CommandLine =
    | { target: string | undefined; claude: ClaudeMode }
    | { print: 'version' | 'help' };

  // parseArgs options
  { claude: { type: 'string', default: 'auto' },
    version: { type: 'boolean', short: 'v' },
    help: { type: 'boolean' } }
  // Strict parsing still runs first, so unknown options still throw.
  // Then: help wins over version, and both win over a bad --claude value and over a folder argument.
  ```

  ```ts
  // server.ts, inside commandLine()
  if ('print' in line) {
    console.log(line.print === 'version' ? `3pitor ${VERSION}` : USAGE);
    process.exit(0);
  }
  ```

  | Input | Result |
  | --- | --- |
  | `['--version']`, `['--VERSION']`, `['-v']` | `{ print: 'version' }` |
  | `['--help']` | `{ print: 'help' }` |
  | `['--help', '--version']` | `{ print: 'help' }` |
  | `['--version', '--claude=bogus']` | `{ print: 'version' }` |
  | `['--version', 'posts']` | `{ print: 'version' }` |
  | `['--version=x']` | throws (a boolean takes no value) |
  | `['--claude', '--version']` | throws (`parseArgs` reports the ambiguous argument), and nothing prints |
  | `['--', '--version']` | `{ target: '--version', claude: … }` |
  | `['-h']` | throws `Unknown option '-h'` (D-13) |

- **Rationale:**
  - A formula test needs `--version` to print and exit 0, and today it exits 2.
  - The union leaves every existing `toEqual({ target, claude })` assertion as it is.
  - Parsing stays in `command-line.ts`, and printing and exiting stay in `server.ts`, as that module's header comment
    already says.
  - The test-engineer ran each input on Bun 1.4.2 against these options to confirm the table's rows.
- **Evidence:**
  - [C-6](current-state-findings.md#c-6-3pitor-has-no-version-and---version-and---help-exit-2)
  - [C-7](current-state-findings.md#c-7-parsecommandline-neither-prints-nor-exits-and-tests-pin-its-whole-return-value)
  - Software-architect A2; test-engineer T3; operator's answer.
- **Behavior impact:** Changing.
  - `3pitor --version`, `-v`, and `--help` used to print "Unknown option" and the usage line on stderr, and exit 2.
  - After the change, `--version` and `-v` print `3pitor <version>` on stdout, and `--help` prints the usage line on
    stdout. All three exit 0.
  - The operator was asked whether `--version` should behave this way, with `-v` and `--help` offered as additions.
    Their answer, verbatim: "all of the above".
- **Rejected alternatives:**
  - Adding `version: boolean` to every result — rejected because it rewrites every existing `toEqual` assertion (C-7).
  - Checking `process.argv.includes('--version')` in `server.ts` — rejected because it skips case-folding and `--`
    handling.
- **Revisit criterion:** A further flag that prints and exits is wanted. It extends `print` rather than adding a shape.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-3
- **Dependent decisions:** D-5, D-9, D-18
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-4: The missing-API-key help names the installed command

- **Question:** What command should the missing-API-key help tell someone to run?
- **Decision:** The last line of `MISSING_API_KEY_HELP` becomes `  ANTHROPIC_API_KEY=sk-ant-... 3pitor`. That matches
  the last line of `CLAUDE_NOT_FOUND_HELP`. A new assertion pins that last line.
- **Rationale:** A Homebrew user has no repo and no Bun. Today no test checks the line, so without a new assertion the
  change could be reverted silently (test-engineer T2).
- **Evidence:** [C-8](current-state-findings.md#c-8-the-missing-api-key-help-names-a-command-a-homebrew-user-cannot-run);
  test-engineer T2.
- **Behavior impact:** Changing. The startup warning and the chat-panel error for a missing key end with
  `ANTHROPIC_API_KEY=sk-ant-... 3pitor`. Operator's answer, verbatim: "Change to `3pitor` (Recommended)".
- **Rejected alternatives:**
  - Showing both commands — rejected because it makes the warning longer.
  - Leaving it as it is — rejected because it names a command Homebrew users do not have.
- **Revisit criterion:** None expected.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Behavior Changes

### D-5: The usage line lists the new flags

- **Question:** Should the usage line mention `--version`, `-v`, and `--help`?
- **Decision:** `USAGE` becomes exactly
  `Usage: 3pitor [--claude=auto|api|cli] [--version|-v] [--help] [folder-or-file]`. Its test at
  `command-line.test.ts:43` and the README's copy change with it.
- **Rationale:** `--help` prints this line, so it must name the flags it documents.
- **Evidence:** [C-6](current-state-findings.md#c-6-3pitor-has-no-version-and---version-and---help-exit-2);
  `src/server/command-line.test.ts:43`.
- **Behavior impact:** Changing. The usage line after every bad-flag error, and from `--help`, gains
  `[--version|-v] [--help]`. Operator's answer, verbatim: "List them (Recommended)".
- **Rejected alternatives:**
  - Keeping it unchanged — rejected by the operator.
  - A test asserting the README contains `USAGE` (test-engineer T5) — rejected because it ties a code test to a
    document for a string that changes once in this plan.
- **Revisit criterion:** The README copy drifts from `USAGE` in a later change.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-10
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Behavior Changes

### D-6: The Makefile stamps the version and checks it, and does no signing or cross-compiling

- **Question:** What does the Makefile own after the change?
- **Decision:**
  - `build` gains `THREEPITOR_VERSION ?= dev` and passes it with `--define`. Its output stays `build/3pitor`.
  - `check-build` gains one assertion, after its existing checks: `build/3pitor --version` must print exactly
    `3pitor $(THREEPITOR_VERSION)`.
  - The Makefile has no `TARGET` variable, no signing, and no new targets.

  ```make
  THREEPITOR_VERSION ?= dev
  # build:       bun build --compile --production --define THREEPITOR_VERSION='"$(THREEPITOR_VERSION)"' \
  #                src/server/server.ts --outfile $(BUILD)/3pitor
  # check-build: ... existing checks ...
  #              [ "$$(OPEN_BROWSER=0 $(BUILD)/3pitor --version)" = "3pitor $(THREEPITOR_VERSION)" ]
  ```

- **Rationale:**
  - The build flags live in one place, and every release job uses them through `make`.
  - The `check-build` assertion is the one repeatable check that proves the stamp. Plain `make check-build` proves the
    `dev` fallback, and the release job proves the stamped value. It catches a dropped `--define` or a quoting
    mistake.
  - With the native Intel runner (D-7), nothing calls a cross-compile target, so `TARGET` has no caller.
  - Local builds are native and already verify (C-3).
- **Evidence:**
  - [C-3](current-state-findings.md#c-3-a-natively-built-apple-silicon-binary-already-has-a-valid-signature)
  - [C-10](current-state-findings.md#c-10-check-build-is-a-ready-made-smoke-test-and-listening-on-is-a-contract)
  - Test-engineer T4; devops DOR-009; junior-developer JD-005.
- **Behavior impact:** Preserving.
  - `make build` with no variables still produces one native `build/3pitor`.
  - `make check-build` still passes on a correct build. It fails only when the stamp is wrong.
  - The observer is a contributor running it. Before this change no stamp existed to be wrong, so that contributor
    loses nothing.
- **Rejected alternatives:**
  - A `TARGET` variable for cross-compiling Intel (the architect's A3) — rejected once D-7 moved Intel to a native
    runner, which left it with no caller.
  - Signing in `make build` — rejected because local builds verify and it would add a platform branch.
  - A unit test that `VERSION === 'dev'` from source — rejected because `check-build` and the D-18 subprocess test
    catch every mutation it would catch (test-engineer S1).
- **Revisit criterion:** Intel moves back to cross-compiling (see D-7).
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-7
- **Referenced in plan:** Target State; Surface Delta; Change Units

### D-7: Tag-triggered release on native runners, ending in a draft release

- **Question:** How are release binaries built, checked, and published?
- **Decision:** Add `.github/workflows/release.yml`, modeled on Skillwalker's shipped `release.yml`.

  ```yaml
  on:
    push:
      tags: ['v[0-9]*']
  # build job: matrix { runner: macos-15, arch: arm64 } and { runner: macos-15-intel, arch: x86_64 };
  #            timeout-minutes: 20; default read-only token
  #   1. actions/checkout@v7 with persist-credentials: false
  #   2. oven-sh/setup-bun@v2 with bun-version: 1.4.2
  #   3. V=${GITHUB_REF_NAME#v}; semver pattern check (D-2), else exit 1
  #   4. bun install --frozen-lockfile
  #   5. make check-build THREEPITOR_VERSION=$V        # build, smoke test, exact --version check
  #   6. codesign --remove-signature build/3pitor && codesign --force --sign - build/3pitor \
  #        && codesign --verify --strict build/3pitor
  #   7. test "$(OPEN_BROWSER=0 build/3pitor --version)" = "3pitor $V"   # still runs after re-signing
  #   8. tar -czf dist/3pitor-$V-darwin-${{ matrix.arch }}.tar.gz -C build 3pitor
  #      test "$(tar -tzf dist/<that file>)" = "3pitor"
  #      shasum -a 256 dist/<that file> > dist/<that file>.sha256
  #   9. actions/upload-artifact@v4 named darwin-${{ matrix.arch }}
  # release job: needs build; runs-on ubuntu-latest; permissions: contents: write
  #   1. actions/download-artifact@v4 with merge-multiple: true into dist/
  #   2. env GH_TOKEN: ${{ github.token }}
  #      gh release create "$GITHUB_REF_NAME" dist/* --repo "$GITHUB_REPOSITORY" --verify-tag \
  #        --draft --generate-notes --title "3pitor $GITHUB_REF_NAME"
  ```

- **Rationale:**
  - Skillwalker's workflow, in the operator's other project, already shipped `v0.2.0` from this shape. That includes
    the `macos-15-intel` runner, `GH_TOKEN`, and a draft release.
  - A native Intel runner lets the Intel binary run the full `check-build` smoke test in CI. A cross-compiled binary
    could only be checked for its architecture and signature, and whether the arm64 image has Rosetta was never
    checked (devops DOR-006).
  - Re-signing both binaries costs nothing. It also covers a hosted runner that signs differently from this Mac
    (C-3 is unverified there).
  - A draft release means a person looks before anything is public, which gives a clean undo for a bad build (D-16).
  - Only the release job holds a write token. The build jobs, which run third-party dependency code during
    `bun install`, do not, and checkout leaves no credentials behind (devops DOR-005).
  - `timeout-minutes` and `OPEN_BROWSER=0` stop a regression in `--version` from hanging a job for six hours or
    opening a browser on the runner (devops DOR-007).
  - The tarball-listing check pins the archive layout inside the workflow, not only in prose (test-engineer, archive
    contract).
- **Evidence:**
  - [C-3](current-state-findings.md#c-3-a-natively-built-apple-silicon-binary-already-has-a-valid-signature)
  - [C-4](current-state-findings.md#c-4-a-cross-compiled-intel-binary-has-an-invalid-signature-and-an-ad-hoc-re-sign-fixes-it)
  - [C-9](current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)
  - [C-10](current-state-findings.md#c-10-check-build-is-a-ready-made-smoke-test-and-listening-on-is-a-contract)
  - `~/dev/testdouble/skillwalker/.github/workflows/release.yml` and its tag `v0.2.0`.
  - Devops DOR-001, DOR-003, DOR-005, DOR-006, DOR-007; junior-developer JD-004.
- **Behavior impact:** Preserving. The workflow is new, and only a `v<digit>` tag starts it. Repo watchers see a
  draft release only after the operator publishes it.
- **Rejected alternatives:**
  - One arm64 runner that cross-compiles Intel and re-signs it (the architect's A4) — rejected because the Intel
    binary would never run in CI. The native-runner shape is already proven in the operator's own repo. C-4 stays as
    the fallback if Intel runners go away.
  - Publishing the release directly, with no draft — rejected because a published version cannot be safely replaced
    (D-16).
  - Pinning actions to full commit SHAs — deferred. Skillwalker pins to major tags, and the only write token is
    scoped to the release job. Listed under Deferred (YAGNI).
  - A per-PR CI workflow — out of scope.
- **Revisit criterion:** GitHub retires `macos-15-intel`. At that point, switch the Intel leg to cross-compiling on
  arm64 with an ad-hoc re-sign (C-4), and add a `--target` variable to the Makefile then.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7
- **Dependent decisions:** D-8, D-10, D-19
- **Referenced in plan:** Target State; Surface Delta; Change Units; Risks

### D-8: The release archive contract

- **Question:** What exactly does the formula download?
- **Decision:** Each release carries four assets:
  - `3pitor-<V>-darwin-arm64.tar.gz` and `3pitor-<V>-darwin-x86_64.tar.gz`. Each is a gzip tarball with exactly one
    entry, `3pitor`, at its root, mode 755.
  - `<archive>.sha256` beside each, holding one `shasum -a 256` line.
  - All are published at `https://github.com/mxriverlynn/3Pitor/releases/download/v<V>/<name>`.
- **Rationale:** A tarball keeps the executable bit and compresses the 64 MB binary. One file needs no top-level folder.
  `x86_64` matches the matrix `arch` value and Skillwalker's asset names. The `.sha256` files give the manual bump a
  labeled source for each checksum, in place of copying from a job summary (devops DOR-008).
- **Evidence:** [C-1](current-state-findings.md#c-1-the-build-is-one-self-contained-executable); Skillwalker's
  `release.yml`; devops DOR-008.
- **Behavior impact:** Preserving. This is a new published format with no existing reader.
- **Rejected alternatives:**
  - The raw binary — rejected because the download loses the executable bit and is not compressed.
  - Checksums in the job summary — rejected because two adjacent lines render as one paragraph, so the two
    architectures are easy to swap when copying (DOR-008).
  - `x64` (Bun's name) — rejected once Intel builds natively, because no Bun target name is in play.
- **Revisit criterion:** A second file has to ship beside the binary.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-9, D-10
- **Referenced in plan:** Target State; Surface Delta

### D-9: The formula is `threepitor` with the alias `3pitor`, shaped like Skillwalker's

- **Question:** What is the formula called, what do users type, and what shape passes `brew audit`?
- **Decision:** The tap gets two files:
  - `Formula/threepitor.rb`, defining `class Threepitor < Formula`;
  - `Aliases/3pitor`, a symlink to `../Formula/threepitor.rb`.

  Users run `brew install mxriverlynn/tap/3pitor`. The formula follows the layout of Skillwalker's formula, which
  passes `brew style` and `brew audit --strict` locally.

  ```ruby
  class Threepitor < Formula
    desc "Markdown blog-post editor with Claude built in"
    homepage "https://github.com/mxriverlynn/3Pitor"

    depends_on :macos
    depends_on macos: :ventura

    on_macos do
      on_arm do
        url "https://github.com/mxriverlynn/3Pitor/releases/download/v0.1.0/3pitor-0.1.0-darwin-arm64.tar.gz"
        sha256 "<from 3pitor-0.1.0-darwin-arm64.tar.gz.sha256>"
      end
      on_intel do
        url "https://github.com/mxriverlynn/3Pitor/releases/download/v0.1.0/3pitor-0.1.0-darwin-x86_64.tar.gz"
        sha256 "<from 3pitor-0.1.0-darwin-x86_64.tar.gz.sha256>"
      end
    end

    def install
      bin.install "3pitor"
    end

    def caveats
      <<~EOS
        3pitor's chat needs ANTHROPIC_API_KEY set, or the claude program installed and signed in.
      EOS
    end

    test do
      assert_equal "3pitor #{version}\n", shell_output("#{bin}/3pitor --version")
      system "codesign", "--verify", "--strict", bin/"3pitor"
    end
  end
  ```

- **Rationale:**
  - Ruby rejects a class named `3pitor`. A tap alias resolves both `mxriverlynn/tap/3pitor` and a bare `3pitor` (as in
    `brew upgrade 3pitor`).
  - An explicit `version` line fails `brew audit` when the URL already holds the version, and
    `Version.detect` finds `0.1.0` in these URLs. So the version is written into the URLs and Homebrew detects it.
  - `url` inside a top-level `on_arm` fails `brew style`. Nested inside `on_macos`, as Skillwalker does it, it passes.
  - Both binaries declare a minimum of macOS 13.0, so `depends_on macos: :ventura` stops an install that could not
    launch.
  - `assert_equal` pins the exact output from D-3, and the `codesign` line catches an install that left the signature
    invalid.
- **Evidence:**
  - [C-11](current-state-findings.md#c-11-a-formula-cannot-be-named-3pitor-but-a-tap-alias-can-be)
  - [C-12](current-state-findings.md#c-12-the-tap-repo-exists-and-is-empty)
  - [C-13](current-state-findings.md#c-13-cli-mode-needs-claude-on-path-and-3pitor-never-installs-it)
  - [C-19](current-state-findings.md#c-19-skillwalkers-formula-shape-passes-brew-style-and-brew-audit---strict)
  - [C-20](current-state-findings.md#c-20-both-binaries-need-macos-130-or-later)
  - Junior-developer JD-001, JD-003; devops DOR-002, DOR-010, DOR-011, Q1.
- **Behavior impact:** Preserving. The formula is new.
- **Rejected alternatives:**
  - `Formula/3pitor.rb` — rejected because it cannot load (C-11).
  - An explicit `version` with `#{version}` in the URLs (the first draft) — rejected because `brew audit` reports it as
    redundant (C-19).
  - Top-level `on_arm`/`on_intel` — rejected because `brew style` reports "`on_arm` cannot include `url`".
  - `if Hardware::CPU.arm?` — rejected because Skillwalker's nested `on_macos` form is a working precedent that
    passes both checks.
  - Dropping `brew audit` from Unit 5 — rejected because a passing audit is cheap once the shape is right.
- **Revisit criterion:** The alias fails on the first real install. C-11 was confirmed by reading Homebrew's source
  only.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9
- **Dependent decisions:** D-10
- **Referenced in plan:** Target State; Surface Delta; Change Units; Risks

### D-10: Publish the draft, then bump the formula by hand

- **Question:** How does a release reach users?
- **Decision:** After the release job goes green, the operator does three things:
  1. Opens the draft release and checks it has four assets.
  2. Publishes it.
  3. Edits `Formula/threepitor.rb`: both `url` lines (the version appears in each) and both `sha256` lines, from the
     two `.sha256` assets. Then pushes the tap.

  No cross-repo token and no bump action are added.
- **Rationale:** Nothing has been released yet, so there is no measured friction to automate away. Automating it needs
  a tap-write secret plus an action that was never checked for nested `on_macos` blocks. Publishing before the bump is
  required, because the URLs of a draft release's assets are not public.
- **Evidence:**
  - [C-12](current-state-findings.md#c-12-the-tap-repo-exists-and-is-empty)
  - Software-architect A5; devops DOR-002 P1; junior-developer JD-001.
- **Behavior impact:** Preserving.
- **Rejected alternatives:** `mislav/bump-homebrew-formula-action` with a tap token — deferred under YAGNI.
- **Revisit criterion:** A bump is forgotten or wrong, or the third manual bump happens.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9, S-10
- **Dependent decisions:** D-11
- **Referenced in plan:** Target State; Change Units; Deferred (YAGNI)

### D-11: The README gets an "Install it" section after the formula is live

- **Question:** How are installing and releasing documented, and when?
- **Decision:**
  - `README.md` gets an "Install it" section ahead of "Run it", covering:
    - `brew install mxriverlynn/tap/3pitor`;
    - `brew upgrade 3pitor`;
    - `3pitor --version`;
    - the note that chat needs an API key or `claude`;
    - macOS 13 or later.
  - A short "Release it" note covers:
    - push `vX.Y.Z`;
    - publish the draft;
    - bump the formula from the `.sha256` assets;
    - never re-use a version.
  - "Run it" and "Build it" stay as the contributor path. The README's usage line changes with D-5.
  - "Install it" lands only after the formula is published.
- **Rationale:** The README documents only a clone today, and the manual release steps have no other written record.
- **Evidence:** [C-17](current-state-findings.md#c-17-the-readme-documents-only-the-contributor-path); scope boundary
  Direction of Travel; devops DOR-004.
- **Behavior impact:** Preserving for code. README readers see a new first section (junior-developer JD-008). That is
  a documentation change, not a change to anything 3pitor does.
- **Rejected alternatives:** Documenting the install in the same unit as the CLI change — rejected because the install
  would not work yet.
- **Revisit criterion:** None expected.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Change Units

### D-18: New tests for the CLI and the help text

- **Question:** What proves Units 1 and 2 worked?
- **Decision:**
  - **`src/server/command-line.test.ts`** gets one test per row of D-3's table, each asserting with `toEqual` or
    `toThrow`. The `USAGE` assertion moves to the new text.
  - **`src/server/chat/claude-backend/claude-backend.test.ts`** gets one assertion: `MISSING_API_KEY_HELP` ends with
    `ANTHROPIC_API_KEY=sk-ant-... 3pitor` and does not contain `bun run`.
  - **A new `src/server/server.test.ts`** spawns `bun run src/server/server.ts` with piped stdout and asserts:
    - `--version` gives stdout exactly `3pitor dev\n`, exit 0, and empty stderr;
    - `--help` gives stdout `USAGE + '\n'` and exit 0;
    - with `WORKSPACE=<tmp>/new` and `OPEN_BROWSER=0`, `--version` leaves `<tmp>/new` not created;
    - `--claude=bogus` gives exit 2, stderr containing the message and `USAGE`, and empty stdout.
- **Rationale:**
  - **The subprocess test** is the only way to see exit codes, streams, and the trailing newline that the formula test
    matches. It also shows whether startup side effects ran. `server.ts` has top-level `await` and calls
    `process.exit`, so it cannot be tested in-process. `check.ts:87` already spawns the server this way, and startup
    took about 50 ms. The `WORKSPACE` check makes "exits before choosing a workspace" falsifiable.
  - **The help-text assertion** exists because today's help-text tests compare the constant with itself, so nothing
    would fail if the line were reverted.
- **Evidence:** [C-7](current-state-findings.md#c-7-parsecommandline-neither-prints-nor-exits-and-tests-pin-its-whole-return-value),
  [C-8](current-state-findings.md#c-8-the-missing-api-key-help-names-a-command-a-homebrew-user-cannot-run),
  test-engineer T1, T2, T3.
- **Behavior impact:** Preserving. These are tests only.
- **Rejected alternatives:**
  - A unit test that `VERSION === 'dev'` — rejected because it is redundant with the subprocess test (T S1).
  - Extra parser rows (`-vx`, `-vv`, `--help=x`, `--no-version`, `-V`) — rejected because they exercise the same
    `parseArgs` mechanics as rows already kept (T S2).
  - A README-contains-`USAGE` test — rejected (D-5).
- **Revisit criterion:** `allowNegative` is turned on, or `-h` is added.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-3, S-5
- **Dependent decisions:** —
- **Referenced in plan:** Change Units

### D-19: Intel stays in scope

- **Question:** Should the first release ship an Intel build at all? The junior-developer's JD-002 says nothing asks
  for one.
- **Decision:** Ship both Apple silicon and Intel.
- **Rationale:**
  - The pattern the operator chose to follow names "macOS on Apple silicon (arm64) and Intel (x86_64)" as its
    conditions. The operator's own Skillwalker tap ships both.
  - With the native Intel runner (D-7), Intel costs one matrix row and one `on_intel` block.
  - Intel no longer carries the riskiest part of the earlier draft: an Intel binary that never ran in CI.
- **Evidence:** Skillwalker investigation, Problem Statement, "Conditions"; `skillwalker.rb` `on_intel`; D-7.
- **Behavior impact:** Preserving.
- **Rejected alternatives:** Apple silicon only, with `depends_on arch: :arm64` (JD-002) — rejected because the
  operator's chosen pattern and their existing tap include Intel, and the cost is now small.
- **Revisit criterion:** GitHub retires `macos-15-intel` and the C-4 cross-compile fallback is not wanted.
- **Dissent (if any):** Junior-developer JD-002 recommended deferring Intel. Overruled on the evidence above.
- **Settles delta entry:** S-7, S-8, S-9
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Review Findings

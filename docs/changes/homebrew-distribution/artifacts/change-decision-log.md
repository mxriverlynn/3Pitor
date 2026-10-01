# Change Decision Log: Homebrew distribution for 3pitor

<!--
This file records every decision committed while planning Homebrew distribution for 3pitor.
The plan itself lives in [../change-plan.md](../change-plan.md). This file captures the
question, rationale, evidence, and rejected alternatives behind each decision.
Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.
-->

## Trivial decisions

- D-12: First release version — The first tag is `v0.1.0`. Nothing has shipped before, so it is a pre-1.0 version. —
  Referenced in plan: Change Units.
- D-13: No `-h` short flag — `--help` gets no `-h` alias. The operator approved the usage line
  `[--version|-v] [--help]`, which has no `-h`, and nothing asks for one. It is listed under Deferred (YAGNI). —
  Referenced in plan: Deferred (YAGNI).
- D-14: License left to the operator — The plan adds no LICENSE file and no `license` line in the formula. The confirmed
  area does not include a license ([C-9](current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)),
  and Homebrew does not require one for a third-party tap formula. It is carried as a non-blocking open item. —
  Referenced in plan: Open Items.
- D-15: Formula caveats — The formula prints one caveat: chat needs `ANTHROPIC_API_KEY` set, or the `claude` program
  installed and signed in. A fresh install otherwise starts with chat broken and only a console warning
  ([C-13](current-state-findings.md#c-13-cli-mode-needs-claude-on-path-and-3pitor-never-installs-it)). — Referenced in
  plan: Target State, Surface Delta.

## Full decisions

### D-1: A formula holding one file, with no Skillwalker-style layout

- **Question:** How much of the Skillwalker plan's packaging carries over to 3pitor?
- **Decision:**
  - Distribute 3pitor as a Homebrew **formula** in `mxriverlynn/homebrew-tap`, not a cask.
  - The formula installs the one binary straight into `bin`.
  - It uses no `libexec` folder, no wrapper script, no `post_install`, no stable scripts folder, and no
    scripts-folder environment variable.
- **Rationale:**
  - 3pitor builds to a single self-contained file. It runs through a symlink, from a read-only folder, launched from
    any folder.
  - Every piece of Skillwalker machinery existed to keep six files together, or to keep a sandbox mount stable across
    upgrades. 3pitor has neither problem.
  - The cask-versus-formula reasoning carries over unchanged: a cask would need Apple Developer ID signing and
    notarization.
- **Evidence:**
  - [C-1](current-state-findings.md#c-1-the-build-is-one-self-contained-executable)
  - [C-2](current-state-findings.md#c-2-the-binary-runs-through-a-symlink-from-a-read-only-folder-launched-from-another-folder)
  - [C-5](current-state-findings.md#c-5-the-source-tree-anchor-src-is-reached-at-runtime-only-through-workspace)
  - Skillwalker investigation E12 for formula versus cask.
- **Behavior impact:** Preserving. Nothing in the repo changes for this decision on its own.
- **Rejected alternatives:**
  - A cask — rejected because casks that fail Gatekeeper lose support on September 1, 2026, so a cask needs paid
    Developer ID signing and notarization (Skillwalker E12).
  - Skillwalker's `libexec` and `post_install` layout — rejected because 3pitor has no sidecar files and no sandbox
    mount (C-1, C-2).
- **Revisit criterion:** The build starts producing more than one file, or 3pitor starts reading files from beside its
  own executable.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9
- **Dependent decisions:** D-7, D-8, D-9
- **Referenced in plan:** What Changes, In One Paragraph; Current State; Target State; Surface Delta

### D-2: The git tag is the only version source, stamped in with `--define`

- **Question:** Where does 3pitor's version come from, and how does it get into the binary?
- **Decision:**
  - The pushed git tag is the only source of the version, and `package.json` gets no `version` field.
  - `make build` passes `--define THREEPITOR_VERSION='"$(VERSION)"'` to `bun build`, with `VERSION ?= dev`.
  - `command-line.ts` reads the global behind a `typeof` guard, so a run from source falls back to `dev`.
  - The value flows like this:

  ```
  git tag v0.1.0
    → release.yml: V=${GITHUB_REF_NAME#v}            # V=0.1.0
    → make build VERSION=0.1.0
    → bun build ... --define THREEPITOR_VERSION='"0.1.0"'
    → command-line.ts:
        declare const THREEPITOR_VERSION: string | undefined;
        export const VERSION = typeof THREEPITOR_VERSION === 'string' ? THREEPITOR_VERSION : 'dev';
    → `3pitor --version` prints "3pitor 0.1.0\n" on stdout, exit 0
    → archive 3pitor-0.1.0-darwin-arm64.tar.gz
    → formula: version "0.1.0"; test asserts "3pitor #{version}\n"
  ```

- **Rationale:**
  - One value flows end to end, and nothing has to stay in step with a second copy.
  - `package.json` is `"private": true`, and nothing reads a version from it.
  - The define was tested. A compiled binary carries the value, and the same source run with `bun run` falls back
    without throwing.
- **Evidence:**
  - [C-6](current-state-findings.md#c-6-3pitor-has-no-version-and---version-and---help-exit-2)
  - [C-9](current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)
  - [C-18](current-state-findings.md#c-18-bun-build---define-stamps-a-value-into-a-compiled-binary-and-source-runs-fall-back)
  - The software-architect's proposal, A1.
- **Behavior impact:** Preserving on its own. The value becomes observable only through D-3.
- **Rejected alternatives:**
  - A `version` field in `package.json`, imported as JSON — rejected because it adds a second source that must match
    the tag, and a check to enforce that.
  - `git describe` inside the Makefile — rejected because it fails on a checkout with no tags (C-9), and the workflow
    already has the tag.
  - A separate `src/server/version.ts` module — rejected because `command-line.ts` is its only reader.
- **Revisit criterion:** A tool needs to read the version from `package.json`, or a second module needs `VERSION`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-6
- **Dependent decisions:** D-3, D-7, D-8, D-9
- **Referenced in plan:** Target State; Surface Delta

### D-3: `--version`, `-v`, and `--help` print and exit cleanly

- **Question:** What does 3pitor do when asked for its version or for help?
- **Decision:**
  - `parseCommandLine` recognizes `--version`, its short form `-v`, and `--help`.
  - It returns a union. The run shape is unchanged, and a second shape asks `server.ts` to print something and exit.
  - `server.ts` prints and exits 0 before it chooses a workspace, loads the session, starts the server, or opens a
    browser.

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
  // Then: help wins over version, and both win over a bad --claude value.
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
  | `['--version=x']` | throws (a boolean takes no value) |
  | `['--', '--version']` | `{ target: '--version', claude: … }` |
  | `['-h']` | throws `Unknown option '-h'` (D-13) |

- **Rationale:**
  - A formula test needs a command that exits 0 and prints the version. Today `--version` exits 2.
  - The union leaves every existing `toEqual({ target, claude })` assertion as it is.
  - Parsing stays in `command-line.ts`, and printing and exiting stay in `server.ts`, as that module's header comment
    already says.
- **Evidence:**
  - [C-6](current-state-findings.md#c-6-3pitor-has-no-version-and---version-and---help-exit-2)
  - [C-7](current-state-findings.md#c-7-parsecommandline-neither-prints-nor-exits-and-tests-pin-its-whole-return-value)
  - The software-architect's proposal, A2.
  - The operator's answer.
- **Behavior impact:** Changing.
  - `3pitor --version`, `-v`, and `--help` used to print "Unknown option" and the usage line on stderr, and exit 2.
  - Now `--version` and `-v` print `3pitor <version>` on stdout, and `--help` prints the usage line on stdout. All
    three exit 0.
  - The operator was asked whether `--version` should behave this way, with `-v` and `--help` offered as additions.
    They answered verbatim: "all of the above".
- **Rejected alternatives:**
  - Adding `version: boolean` to every result — rejected because it rewrites every existing `toEqual` assertion (C-7).
  - Checking `process.argv.includes('--version')` in `server.ts` — rejected because it skips the parser's
    case-folding and `--` handling, and moves parsing out of the parser.
  - `--version` alone — rejected by the operator's answer.
- **Revisit criterion:** A further flag that prints and exits is wanted. That one extends `print` rather than adding a
  shape.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-3
- **Dependent decisions:** D-5, D-9
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-4: The missing-API-key help names the installed command

- **Question:** What command should the missing-API-key help tell someone to run?
- **Decision:** The last line of `MISSING_API_KEY_HELP` becomes `  ANTHROPIC_API_KEY=sk-ant-... 3pitor`. That matches
  the last line of `CLAUDE_NOT_FOUND_HELP`.
- **Rationale:** A Homebrew user has no repo and no Bun, so `bun run server` is a command they cannot run. No test
  checks that line.
- **Evidence:** [C-8](current-state-findings.md#c-8-the-missing-api-key-help-names-a-command-a-homebrew-user-cannot-run)
- **Behavior impact:** Changing.
  - The startup warning and the chat-panel error for a missing key now end with `ANTHROPIC_API_KEY=sk-ant-... 3pitor`
    rather than `... bun run server`.
  - Operator's answer, verbatim: "Change to `3pitor` (Recommended)".
- **Rejected alternatives:**
  - Showing both commands — rejected because it makes the warning longer, and contributors already know
    `bun run server`.
  - Leaving it as it is — rejected because Homebrew users would be told to run a command they do not have.
- **Revisit criterion:** None expected.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Behavior Changes

### D-5: The usage line lists the new flags

- **Question:** Should the usage line mention `--version`, `-v`, and `--help`?
- **Decision:** `USAGE` becomes exactly `Usage: 3pitor [--claude=auto|api|cli] [--version|-v] [--help] [folder-or-file]`.
  The test that pins it and the README's copy change with it.
- **Rationale:** `--help` prints this line. A help screen that omits the help and version flags would leave them
  undiscoverable.
- **Evidence:** [C-6](current-state-findings.md#c-6-3pitor-has-no-version-and---version-and---help-exit-2) and
  `src/server/command-line.test.ts:43`, which pins the old text with `toBe`.
- **Behavior impact:** Changing.
  - The usage line, printed after every bad-flag error and now by `--help`, gains `[--version|-v] [--help]`.
  - Operator's answer, verbatim: "List them (Recommended)".
- **Rejected alternatives:** Keeping the usage line unchanged — rejected by the operator.
- **Revisit criterion:** The usage line grows past one terminal line.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-10
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Behavior Changes

### D-6: The Makefile stamps the version and takes an optional target, and does no signing

- **Question:** What does `make build` own after the change?
- **Decision:**
  - `make build` gains two variables, `VERSION ?= dev` and an optional `TARGET`.
  - `TARGET` is passed as `--target=$(TARGET)` only when it is set.
  - The output stays `build/3pitor`.
  - Signing, packaging, and reading git tags stay out of the Makefile, and no new targets are added.

  ```make
  VERSION ?= dev
  # build: bun build --compile --production $(if $(TARGET),--target=$(TARGET)) \
  #          --define THREEPITOR_VERSION='"$(VERSION)"' src/server/server.ts --outfile $(BUILD)/3pitor
  ```

- **Rationale:**
  - The `--production` and `--define` flags live in one place, so the release workflow does not copy the build
    command.
  - `TARGET` has one caller, the Intel build in the release workflow, and without it that command would be
    duplicated.
  - Local builds are native and already verify (C-3), so a contributor's build has no use for `codesign`. Calling it
    would break a build on any machine without it.
- **Evidence:**
  - [C-3](current-state-findings.md#c-3-a-natively-built-apple-silicon-binary-already-has-a-valid-signature)
  - [C-4](current-state-findings.md#c-4-a-cross-compiled-intel-binary-has-an-invalid-signature-and-an-ad-hoc-re-sign-fixes-it)
  - [C-10](current-state-findings.md#c-10-check-build-is-a-ready-made-smoke-test-and-listening-on-is-a-contract)
  - The software-architect's proposal, A3.
- **Behavior impact:** Preserving.
  - `make build` with no variables still produces one native file at `build/3pitor`, and `check-build` still passes.
  - The binary's answer to `--version` comes from D-3.
- **Rejected alternatives:**
  - Signing in `make build` behind a `uname` check — rejected because no finding needs it locally, and it adds a
    platform branch.
  - New `release`, `package`, or `sign` targets — rejected because each would have one caller.
- **Revisit criterion:** A second distribution path appears, or a local cross-compile becomes a supported thing to do.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-7
- **Referenced in plan:** Target State; Surface Delta; Change Units

### D-7: One tag-triggered release job builds both architectures on one Apple silicon runner

- **Question:** How are release binaries built, checked, and published?
- **Decision:** Add `.github/workflows/release.yml`.
  - It triggers on `push: tags: ['v*']`, with `permissions: contents: write`.
  - It runs one job on `runs-on: macos-15`, which is arm64.
  - It sets up Bun with `oven-sh/setup-bun` and `bun-version: 1.4.2`, written as a literal.
  - The steps, in order:
    1. `bun install --frozen-lockfile`, then set `V=${GITHUB_REF_NAME#v}`.
    2. `make check-build VERSION=$V`, which builds natively and runs the existing smoke test.
    3. Re-sign and verify:
       `codesign --remove-signature build/3pitor && codesign --force --sign - build/3pitor && codesign --verify --strict build/3pitor`.
    4. `test "$(build/3pitor --version)" = "3pitor $V"`.
    5. Pack `build/3pitor` as `dist/3pitor-$V-darwin-arm64.tar.gz`, per D-8.
    6. `make build VERSION=$V TARGET=bun-darwin-x64`, then re-sign and verify as in step 3.
    7. `file build/3pitor | grep -q x86_64`, then pack as `dist/3pitor-$V-darwin-x64.tar.gz`.
    8. `shasum -a 256 dist/*.tar.gz >> "$GITHUB_STEP_SUMMARY"`.
    9. `gh release create "$GITHUB_REF_NAME" dist/*.tar.gz --generate-notes`.
  - Release creation is the last step, so a failure anywhere earlier publishes nothing.
- **Rationale:**
  - An Intel binary cross-compiled on Apple silicon runs once it is re-signed (C-4). That removes the need for an
    Intel runner image and for handing artifacts between jobs.
  - Re-signing both binaries costs nothing, and C-3 has not been checked on a hosted runner.
  - Pinning Bun matters, because signature behavior has differed between Bun versions (Skillwalker on 1.3.11, C-3 on
    1.4.2).
- **Evidence:**
  - [C-3](current-state-findings.md#c-3-a-natively-built-apple-silicon-binary-already-has-a-valid-signature)
  - [C-4](current-state-findings.md#c-4-a-cross-compiled-intel-binary-has-an-invalid-signature-and-an-ad-hoc-re-sign-fixes-it)
  - [C-9](current-state-findings.md#c-9-the-repo-has-no-ci-no-release-pipeline-no-tags-and-no-license)
  - [C-10](current-state-findings.md#c-10-check-build-is-a-ready-made-smoke-test-and-listening-on-is-a-contract)
  - The software-architect's proposal, A4.
- **Behavior impact:** Preserving. The workflow is new and only runs when a `v*` tag is pushed, and nothing existing
  observes it.
- **Rejected alternatives:**
  - A two-runner matrix with an Intel runner — rejected because it needs an Intel image and an artifact hand-off,
    while one runner plus a re-sign covers both architectures (C-4).
  - Re-signing only the cross-compiled binary — rejected because it needs a branch on the host architecture, and the
    native case is not verified on a hosted runner.
  - A per-PR CI workflow — out of scope. The operator did not add it.
- **Revisit criterion:** The cross-compiled Intel binary fails on a real Intel Mac, or GitHub's arm64 image changes
  signing behavior.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7
- **Dependent decisions:** D-8, D-10
- **Referenced in plan:** Target State; Surface Delta; Change Units; Risks

### D-8: The release archive contract

- **Question:** What exactly does the formula download?
- **Decision:**
  - Each release carries two assets:
    - `3pitor-<V>-darwin-arm64.tar.gz`
    - `3pitor-<V>-darwin-x64.tar.gz`
  - Each is a gzip tarball with exactly one entry, `3pitor`, at its root, with mode 755, made by
    `tar -czf dist/<name> -C build 3pitor`.
  - Each is published at `https://github.com/mxriverlynn/3Pitor/releases/download/v<V>/<name>`.
- **Rationale:**
  - A tarball keeps the executable bit and gives a stable name for `bin.install "3pitor"`. It also compresses the
    64 MB binary.
  - There is one file, so no top-level folder is needed.
  - The architecture names match Bun's `--target` names.
- **Evidence:**
  - [C-1](current-state-findings.md#c-1-the-build-is-one-self-contained-executable)
  - The software-architect's proposal, A4.
- **Behavior impact:** Preserving. This is a new published format with no existing reader.
- **Rejected alternatives:**
  - Uploading the raw binary — rejected because the download loses the executable bit and is not compressed.
  - Skillwalker's top-level folder — rejected because there is only one file (C-1).
- **Revisit criterion:** A second file has to ship beside the binary.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-9
- **Referenced in plan:** Target State; Surface Delta

### D-9: The formula is `threepitor`, with the alias `3pitor`

- **Question:** What is the formula called, and what do users type?
- **Decision:** The tap gets two files.
  - `Formula/threepitor.rb`, defining `class Threepitor < Formula`.
  - `Aliases/3pitor`, a symlink to `../Formula/threepitor.rb`.
  - Users run `brew install mxriverlynn/tap/3pitor`. The installed command is `3pitor`.

  ```ruby
  class Threepitor < Formula
    desc "Markdown blog-post editor with Claude built in"
    homepage "https://github.com/mxriverlynn/3Pitor"
    version "0.1.0"
    depends_on :macos

    on_arm do
      url "https://github.com/mxriverlynn/3Pitor/releases/download/v#{version}/3pitor-#{version}-darwin-arm64.tar.gz"
      sha256 "<from the release job summary>"
    end
    on_intel do
      url "https://github.com/mxriverlynn/3Pitor/releases/download/v#{version}/3pitor-#{version}-darwin-x64.tar.gz"
      sha256 "<from the release job summary>"
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
  - Ruby rejects a class named `3pitor`, and Homebrew derives the class name from the file name.
  - A tap alias resolves `mxriverlynn/tap/3pitor` to the formula before the class is loaded.
  - An explicit `version` avoids Homebrew guessing one from the archive name.
  - `assert_equal` pins the exact output from D-3.
  - The `codesign` line catches an install that left the signature invalid.
- **Evidence:**
  - [C-11](current-state-findings.md#c-11-a-formula-cannot-be-named-3pitor-but-a-tap-alias-can-be)
  - [C-12](current-state-findings.md#c-12-the-tap-repo-exists-and-is-empty)
  - [C-13](current-state-findings.md#c-13-cli-mode-needs-claude-on-path-and-3pitor-never-installs-it)
  - [C-4](current-state-findings.md#c-4-a-cross-compiled-intel-binary-has-an-invalid-signature-and-an-ad-hoc-re-sign-fixes-it)
  - The software-architect's proposal, A5.
- **Behavior impact:** Preserving. The formula is new.
- **Rejected alternatives:**
  - `Formula/3pitor.rb` — rejected because it cannot load (C-11).
  - `three-pitor` — rejected because `threepitor` matches how Homebrew spells digit-led names (for example
    `sevenzip`), and users never type it.
  - A formula named `threepitor` with no alias — rejected because users would have to know the spelled-out name.
  - `assert_match` in the test — rejected because it accepts output that only contains the version.
- **Revisit criterion:** The alias fails on the first real install (C-11 is verified only by reading Homebrew's
  source).
- **Dissent (if any):** None.
- **Settles delta entry:** S-9
- **Dependent decisions:** D-10
- **Referenced in plan:** Target State; Surface Delta; Change Units; Risks

### D-10: The formula is bumped by hand for now

- **Question:** How does the formula learn about a new release?
- **Decision:**
  - After each release job, the operator edits `version` and the two `sha256` lines in `Formula/threepitor.rb`.
  - The values come from the job summary (D-7, step 8).
  - No cross-repo token and no bump action are added.
- **Rationale:**
  - Nothing has been released yet, so there is no measured friction to automate away.
  - Automating it needs a repository secret with write access to the tap, plus an action whose handling of
    `on_arm`/`on_intel` blocks was not verified.
- **Evidence:**
  - [C-12](current-state-findings.md#c-12-the-tap-repo-exists-and-is-empty)
  - The software-architect's proposal, A5, which flags the action's behavior as Unverified.
- **Behavior impact:** Preserving.
- **Rejected alternatives:** `mislav/bump-homebrew-formula-action` with a `HOMEBREW_TAP_TOKEN` secret, as Skillwalker
  did — rejected for now under YAGNI. It is listed under Deferred (YAGNI).
- **Revisit criterion:** A bump is forgotten or wrong, or the third manual bump happens.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-9
- **Dependent decisions:** D-11
- **Referenced in plan:** Target State; Change Units; Deferred (YAGNI)

### D-11: README gets an "Install it" section after the formula is live

- **Question:** How are installing and releasing documented, and when?
- **Decision:**
  - `README.md` gets an "Install it" section ahead of "Run it", covering:
    - `brew install mxriverlynn/tap/3pitor`
    - `brew upgrade 3pitor`
    - `3pitor --version`
    - the caveat about the API key or `claude`
  - The section also gives the release steps: push `vX.Y.Z`, then copy the two checksums from the job summary into
    the tap formula.
  - "Run it" and "Build it" stay as the contributor path.
  - The README's copy of the usage line changes with D-5.
  - The "Install it" section lands only after the formula is published, so the README never points at an install that
    does not exist.
- **Rationale:** The README documents only the contributor path today. The manual bump in D-10 has no other written
  record.
- **Evidence:** [C-17](current-state-findings.md#c-17-the-readme-documents-only-the-contributor-path); the scope
  boundary's Direction of Travel.
- **Behavior impact:** Preserving. This is documentation.
- **Rejected alternatives:** Documenting the install in the same unit as the CLI change — rejected because the install
  would not work yet.
- **Revisit criterion:** None expected.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Change Units

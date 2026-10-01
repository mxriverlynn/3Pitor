# Current State Findings: Homebrew distribution for 3pitor

## Provenance

These findings come from this run's own discovery. They do not come from a prior report on 3pitor.

- `han-core:structural-analyst` covered `Makefile`, `package.json`, `src/server/server.ts`,
  `src/server/command-line.ts`, `src/server/paths.ts`, `src/server/workspace/`, `src/server/workspace-config/`, and
  the help strings in `claude-backend.ts` and `claude-cli.ts`. Its findings are labelled S1–S7.
- `han-core:behavioral-analyst` traced the runtime startup path of `src/server/server.ts`. Its findings are labelled
  B1–B9.
- `han-core:concurrency-analyst` was not dispatched. Startup is sequential, and the only shared-state question is two
  instances sharing a workspace across an upgrade. B9 covers that.
- The run ran its own hands-on checks on 2026-10-01: macOS 26.5.1, Apple silicon, Bun 1.4.2. These are labelled
  "run's own test" below.

The Skillwalker investigation at `~/dev/testdouble/skillwalker/docs/planning/homebrew-distribution/investigation.md`
is prior art for a sibling project. Its findings are about Skillwalker's code, so none are carried here as facts about
3pitor. Where 3pitor differs from Skillwalker, the finding says so.

## Project Context

- **Stack:** Bun 1.4.2 and TypeScript 7, with Hono on the server and React 19 with ProseMirror/Yjs in the UI. Tests
  run on `bun test` with happy-dom for the UI. `make build` compiles everything into one executable with
  `bun build --compile --production`.
- **Conventions source:** No CLAUDE.md, AGENTS.md, or `project-discovery.md`. The conventions live in `README.md`,
  in its layout rules for `src/` and its "Run it" and "Build it" sections.
- **ADRs found:** None found under `docs/adr/`.
- **Coding standards found:** None found under `docs/coding-standards/`. The house style shows in the code: one-line
  header comments on each module, plain `Error`, tests that assert on whole return values with `toEqual`, and prose
  test names.
- **Recent churn (90 days):** `src/server/server.ts` 14 commits, `package.json` 10, `Makefile` 7,
  `src/server/command-line.ts` 3, `src/server/command-line.test.ts` 1. `server.ts` is the busiest file in the area,
  so expect it to move before the build.

## Gaps

- No `.github/` folder exists, so the repo has no CI and no release workflow.
- The repo has no git tags.
- No `version` field exists in `package.json`.
- No LICENSE file exists. `gh repo view` reports `licenseInfo: null` for a public repo.
- No ADR or coding standard covers releases, versioning, or distribution.
- Nothing pins the Bun version for a CI runner: no `.bun-version`, no `packageManager` field, and no `engines` field.
  Only `@types/bun` is pinned at `1.4.2`.

## Findings

### C-1: The build is one self-contained executable

- **Claim:** `make build` produces exactly one file, `build/3pitor`. The UI, the chat system prompt, and the app's
  skills are all embedded in it. At runtime the binary reads only the user's own workspace from disk.
- **Location:** `Makefile` `build` target; `src/server/server.ts:7`; `src/server/chat/agent/agent.ts:11`;
  `src/server/workspace-config/workspace-config.ts:6`
- **Evidence:**
  ```make
  build: node_modules
  	rm -rf $(BUILD)/3pitor $(BUILD)/claude $(BUILD)/fixtures
  	bun build --compile --production src/server/server.ts --outfile $(BUILD)/3pitor
  ```
  ```ts
  import homepage from '../ui/index.html';
  import systemPrompt from './system-prompt.md' with { type: 'text' };
  import { appSkillFiles } from './app-skills.macro' with { type: 'macro' };
  ```
  Run's own test: `ls build` lists only `3pitor`, at 64,670,706 bytes.
- **Raised by:** structural-analyst S3; run's own test
- **Confidence:** Verified
- **Bears on:** S-8, S-9; D-1, D-8. This is the main difference from Skillwalker, which needed six files kept together and a stable scripts folder. 3pitor needs neither `libexec` sidecars nor `post_install`.

### C-2: The binary runs through a symlink, from a read-only folder, launched from another folder

- **Claim:** The test copied the binary into a read-only `libexec/` folder, symlinked it from `bin/3pitor`, and
  launched it from a third, empty folder. It served the page and the workspace config, listed its embedded skills, and
  wrote nothing into `libexec/`. The workspace is the launch folder.
- **Location:** `src/server/workspace/workspace.ts:14-25`
- **Evidence:** Run's own test:
  ```
  3pitor chat: claude via the Anthropic API
  3pitor listening on http://localhost:54618 (workspace: .../scratchpad/brew/ws)
  {"skills":["collaborative-editing","proofread","research"],"agents":["title-writer"]}
  page 200
  ```
  ```ts
  if (process.env.WORKSPACE) return ensureWorkspace(resolve(process.env.WORKSPACE));
  return process.cwd();
  ```
- **Raised by:** run's own test; structural-analyst S2; behavioral-analyst B3
- **Confidence:** Verified
- **Bears on:** S-9; D-1

### C-3: A natively built Apple silicon binary already has a valid signature

- **Claim:** `codesign --verify --strict build/3pitor` exits 0 on an arm64 binary that Bun 1.4.2 built on an arm64
  Mac. Its signature is ad-hoc and linker-signed. Skillwalker hit an invalid signature on Bun 1.3.11, and 3pitor does
  not hit it on 1.4.2 when built natively.
- **Location:** `build/3pitor`
- **Evidence:** Run's own test:
  ```
  verify exit=0
  Format=Mach-O thin (arm64)
  CodeDirectory v=20400 size=501438 flags=0x20002(adhoc,linker-signed) hashes=15667+0 location=embedded
  Signature=adhoc
  ```
- **Raised by:** run's own test
- **Confidence:** Verified for a native arm64 build on this machine. Unverified on a GitHub-hosted runner.
- **Bears on:** S-6, S-7; D-6, D-7

### C-4: A cross-compiled Intel binary has an invalid signature, and an ad-hoc re-sign fixes it

- **Claim:** `bun build --compile --target=bun-darwin-x64` on an arm64 Mac produces an x86_64 binary that fails
  `codesign --verify` with "invalid signature (code or signature have been modified)". Removing the signature and
  ad-hoc signing again makes it verify, and it still runs under Rosetta.
- **Location:** run's own test against `src/server/server.ts`
- **Evidence:**
  ```
  3pitor-x64: Mach-O 64-bit executable x86_64
  3pitor-x64: invalid signature (code or signature have been modified)
  CodeDirectory v=20500 size=537679 flags=0x10000(runtime) hashes=16792+7 location=embedded
  $ codesign --remove-signature X && codesign --force --sign - X && codesign --verify --strict X
  resign verify=0
  $ arch -x86_64 X --claude=bogus
  3pitor: --claude must be api, cli, or auto (got "bogus")
  ```
- **Raised by:** run's own test
- **Confidence:** Verified on this machine under Rosetta. Not tested on a real Intel Mac.
- **Bears on:** S-7; D-6, D-7, D-9. A build that is not native to the host must be re-signed. This matches Skillwalker's E10/E11.

### C-5: The source-tree anchor `SRC` is reached at runtime only through `WORKSPACE`

- **Claim:** `SRC` resolves from `import.meta.dir`, which points inside Bun's virtual filesystem in a compiled binary.
  Its only runtime path is the fixture seed that `WORKSPACE` triggers. A normal launch never touches it, so no change
  is needed for a read-only Cellar.
- **Location:** `src/server/paths.ts:5`; `src/server/workspace/workspace.ts:6,9,23,28-30`
- **Evidence:**
  ```ts
  export const SRC = resolve(import.meta.dir, '..');
  const FIXTURE = join(SRC, 'fixtures/workspace');
  if (!(await exists(path))) await cp(FIXTURE, path, { recursive: true });
  ```
- **Raised by:** structural-analyst S1; behavioral-analyst B2
- **Confidence:** Verified by reading the code. The `$bunfs` location is inferred from Bun's semantics and the
  README's statement that "the built app has no fixtures"; nobody inspected it at runtime.
- **Bears on:** — (no delta entry; recorded so the build does not chase it)

### C-6: 3pitor has no version, and `--version` and `--help` exit 2

- **Claim:** No version exists anywhere: `package.json` has no `version` and the repo has no tags. The only
  version-like output is `Bun.version` in `/api/health`. `3pitor --version`, `--help`, `-v`, and `-h` all fail
  strict parsing, print the usage line to stderr, and exit 2.
- **Location:** `package.json`; `src/server/command-line.ts:12-17`; `src/server/server.ts:30,66-74`
- **Evidence:**
  ```ts
  options: { claude: { type: 'string', default: 'auto' } },
  allowPositionals: true,
  strict: true,
  ```
  Run's own test:
  ```
  $ ./build/3pitor --version
  3pitor: Unknown option '--version'. ...
  Usage: 3pitor [--claude=auto|api|cli] [folder-or-file]
  version exit=2
  ```
- **Raised by:** structural-analyst S4, S5; behavioral-analyst B1; run's own test
- **Confidence:** Verified
- **Bears on:** S-1, S-2, S-3, S-4; D-2, D-3, D-5

### C-7: `parseCommandLine` neither prints nor exits, and tests pin its whole return value

- **Claim:** `command-line.ts` states that it does not print or exit; `server.ts` owns both. Parsing runs before the
  workspace, the session load, `Bun.serve`, and the browser open, so an early exit there has no side effects. Every
  happy-path test asserts the return value with `toEqual({ target, claude })`, so adding a field changes each one.
  Option names are lowercased before parsing.
- **Location:** `src/server/command-line.ts:1-2,8-11,27-33`; `src/server/server.ts:18-19,66-74`;
  `src/server/command-line.test.ts`
- **Evidence:**
  ```ts
  // Turns 3pitor's command line and environment into a folder argument and how chat reaches Claude. It does not print,
  // exit, look for the claude program, or know about models.
  export function parseCommandLine(argv, env): { target: string | undefined; claude: ClaudeMode }
  ```
  ```ts
  const { target, claude } = commandLine();
  const workspace = await chooseWorkspace(target);
  ```
  ```ts
  expect(parseCommandLine([], withKey)).toEqual({ target: undefined, claude: 'api' });
  ```
- **Raised by:** structural-analyst S5; behavioral-analyst B1
- **Confidence:** Verified
- **Bears on:** S-2, S-3; D-3

### C-8: The missing-API-key help names a command a Homebrew user cannot run

- **Claim:** `MISSING_API_KEY_HELP` ends with `ANTHROPIC_API_KEY=sk-ant-... bun run server`. It prints at startup and
  again when a chat turn fails. The CLI-mode help already ends with `ANTHROPIC_API_KEY=sk-ant-... 3pitor`. Tests pin
  only the first line of each help text and compare against the constant itself, so changing the last line breaks no
  test.
- **Location:** `src/server/chat/claude-backend/claude-backend.ts:22-26`;
  `src/server/chat/claude-cli/claude-cli.ts:21-25`; `src/server/chat/agent/agent.ts:31`;
  `src/server/chat/claude-backend/claude-backend.test.ts:22-25`; `src/server/chat/sessions/sessions.test.ts:201-202`
- **Evidence:**
  ```ts
  export const MISSING_API_KEY_HELP = `ANTHROPIC_API_KEY is not set, so chat won't work.
  ...
    ANTHROPIC_API_KEY=sk-ant-... bun run server`;
  ```
  ```ts
  expect(MISSING_API_KEY_HELP).toStartWith("ANTHROPIC_API_KEY is not set, so chat won't work.");
  ```
- **Raised by:** structural-analyst S6; behavioral-analyst B5; run's own grep
- **Confidence:** Verified
- **Bears on:** S-5; D-4. This is the 3pitor equivalent of Skillwalker's V2.

### C-9: The repo has no CI, no release pipeline, no tags, and no license

- **Claim:** `.github/` does not exist and `git tag` lists nothing. The repo `mxriverlynn/3Pitor` is public, and
  GitHub reports no license.
- **Location:** repo root
- **Evidence:** Run's own test:
  ```
  ls: .github: No such file or directory
  {"isPrivate":false,"licenseInfo":null,"nameWithOwner":"mxriverlynn/3Pitor"}
  (eval):1: no matches found: LICENSE*
  ```
- **Raised by:** run's own test
- **Confidence:** Verified
- **Bears on:** S-7; D-2, D-7, D-14

### C-10: `check-build` is a ready-made smoke test, and "listening on" is a contract

- **Claim:** `make check-build` runs the built binary from an empty folder with `OPEN_BROWSER=0` and a dummy key. It
  reads the URL from the `listening on <url>` line and fails unless `/api/workspace-config` lists
  `collaborative-editing`. `check.ts` reads the same line. The `build` target depends on `node_modules`, which runs
  `bun install`.
- **Location:** `Makefile` `check-build` and `node_modules` targets; `src/server/server.ts:49`;
  `src/server/scripts/check.ts`
- **Evidence:**
  ```make
  (cd $$dir && OPEN_BROWSER=0 ANTHROPIC_API_KEY=unused exec $(CURDIR)/$(BUILD)/3pitor > $$log 2>&1) & pid=$$!; \
  ...
  [ $$status -eq 0 ] && echo "$$config" | grep -q '"collaborative-editing"'
  ```
  ```ts
  // check.ts reads the URL from this line; keep its "listening on <url>" shape.
  console.log(`3pitor listening on ${server.url.origin} (workspace: ${join(workspace)})`);
  ```
- **Raised by:** structural-analyst S3, S7; behavioral-analyst (non-finding note)
- **Confidence:** Verified
- **Bears on:** S-6, S-7; D-6, D-7

### C-11: A formula cannot be named `3pitor`, but a tap alias can be

- **Claim:** Homebrew turns a formula name into a Ruby class name by capitalizing it, which leaves `3pitor` unchanged.
  Ruby rejects a class name that starts with a digit. No formula in homebrew-core starts with a digit (the API
  listing returned none). Homebrew resolves `<tap>/<name>` through the tap's `Aliases/` folder before it looks up the
  formula, so an alias `3pitor` pointing at a formula with a spelled-out name loads.
- **Location:** `$(brew --repository)/Library/Homebrew/formulary.rb:455-461,1175-1190`; `tap.rb:1142-1165`
- **Evidence:**
  ```ruby
  def self.class_s(name)
    class_name = name.capitalize
    class_name.gsub!(/[-_.\s][a-zA-Z0-9]/) { |matched| matched.chars.fetch(-1).upcase }
    ...
  alias_table_key = tap.core_tap? ? name : "#{tap}/#{name}"
  if (possible_alias = tap.alias_table[alias_table_key].presence)
  ```
  ```
  $ ruby -e 'class 3pitor; end'
  -e:1: syntax error, unexpected local variable or method ...
  $ ruby -e 'p Object.const_defined?("3pitor")'
  wrong constant name 3pitor (NameError)
  ```
- **Raised by:** run's own test
- **Confidence:** Verified for the class name. The alias path was verified by reading Homebrew's source, not by an
  install.
- **Bears on:** S-9; D-9

### C-12: The tap repo exists and is empty

- **Claim:** `mxriverlynn/homebrew-tap` is public, has no commits and no default branch, and is described as "Homebrew
  install formulae for my projects". Taps named `homebrew-tap` install as `brew install mxriverlynn/tap/<name>`.
- **Location:** https://github.com/mxriverlynn/homebrew-tap
- **Evidence:** Run's own test:
  ```
  {"defaultBranchRef":{"name":""},"description":"Homebrew install formulae for my projects","isPrivate":false}
  gh: This repository is empty. (HTTP 404)
  ```
- **Raised by:** operator input; run's own test
- **Confidence:** Verified
- **Bears on:** S-9; D-9, D-10

### C-13: CLI mode needs `claude` on PATH, and 3pitor never installs it

- **Claim:** CLI mode spawns the bare name `claude`. When `claude` is not on PATH, startup prints a warning and
  carries on. The README says 3pitor never installs a `claude` program. With no API key and no `claude`, a fresh
  install starts with chat broken and only a console warning to say so.
- **Location:** `src/server/chat/claude-cli/claude-cli.ts:110`;
  `src/server/chat/claude-backend/claude-backend.ts:45`; `src/server/command-line.ts:21`
- **Evidence:**
  ```ts
  proc = Bun.spawn(['claude', ...claudeArgs(...)], {
  startupWarning: (env) => (Bun.which('claude', { PATH: env.PATH ?? '' }) ? undefined : CLAUDE_NOT_FOUND_HELP),
  if (mode === 'auto') return { target, claude: env.ANTHROPIC_API_KEY ? 'api' : 'cli' };
  ```
- **Raised by:** structural-analyst S2; behavioral-analyst B6
- **Confidence:** Verified
- **Bears on:** S-9; D-9, D-15

### C-14: Whether `--production` inlines `NODE_ENV` in the binary was not checked

- **Claim:** `development: process.env.NODE_ENV !== 'production'` is read at runtime. If `--production` inlines
  `NODE_ENV`, a user's shell `NODE_ENV` cannot switch the installed binary into dev mode. If it does not, it can.
- **Location:** `src/server/server.ts:43`; `Makefile` `build` target
- **Evidence:**
  ```ts
  development: process.env.NODE_ENV !== 'production',
  ```
- **Raised by:** behavioral-analyst B7
- **Confidence:** Unverified. Nobody ran the binary with `NODE_ENV=development` set.
- **Bears on:** — (behavior already true of `make build` today, unchanged by this plan)

### C-15: Existing startup failures that Homebrew does not cause

- **Claim:** Three startup paths fail with an unhandled rejection rather than a 3pitor message:
  - a `WORKSPACE` folder that does not exist (B2);
  - a stored mid-turn session in a workspace that cannot be written (B4);
  - a `PORT` that is busy or not a number (B8).
  Each is equally true of `./build/3pitor` today.
- **Location:** `src/server/workspace/workspace.ts:23,28-30`; `src/server/chat/sessions/sessions.ts:44-56`;
  `src/server/server.ts:40`
- **Evidence:**
  ```ts
  if (session.uiMessages.at(-1)?.role === 'user') {
    session.uiMessages.push(stoppedReply());
    await this.save(session);
  }
  port: Number(process.env.PORT ?? 0),
  ```
- **Raised by:** behavioral-analyst B2, B4, B8
- **Confidence:** Verified by reading the code. B4's narrower claim about `isRecord` is Unverified, carried from the
  analyst.
- **Bears on:** — (outside the boundary; not in the delta)

### C-16: Two versions sharing a workspace after an upgrade write the same state files

- **Claim:** A running instance keeps working after `brew upgrade` replaces its Cellar folder. An old and a new
  instance can share one workspace's `.3pitor/` files. Writes are atomic, and the last one wins. `session.json` has no
  format version.
- **Location:** `src/server/components/json-file.ts:20,34-37`
- **Evidence:** Atomic temp-and-rename per process, with `${path}.${process.pid}.tmp` names. Nothing detects another
  instance.
- **Raised by:** behavioral-analyst B9
- **Confidence:** Verified by reading the code
- **Bears on:** — (already documented in the README, "the last one to write wins"; unchanged by this plan)

### C-17: The README documents only the contributor path

- **Claim:** The README's "Run it" and "Build it" sections cover `bun install`, `bun run server`, `make build`, and
  `./build/3pitor`. The usage line is copied into the README by hand. Nothing documents an install.
- **Location:** `README.md` "Run it", "Build it", and "Choose how chat reaches Claude"
- **Evidence:**
  ```
  make build             # compiles everything into build/3pitor
  ./build/3pitor         # the workspace is the folder you launch it from
  Usage: 3pitor [--claude=auto|api|cli] [folder-or-file]
  ```
- **Raised by:** structural-analyst S5, S6; run's own read
- **Confidence:** Verified
- **Bears on:** S-10; D-11

### C-18: `bun build --define` stamps a value into a compiled binary, and source runs fall back

- **Claim:** A `declare const` global set with `--define` on `bun build --compile` is baked into the binary. The same
  file run from source with `bun run` sees the global as undefined, and `typeof` guards it without throwing.
- **Location:** run's own test in the scratchpad, Bun 1.4.2
- **Evidence:**
  ```ts
  declare const THREEPITOR_VERSION: string | undefined;
  console.log(typeof THREEPITOR_VERSION === 'string' ? THREEPITOR_VERSION : 'dev');
  ```
  ```
  $ bun build --compile --production --define 'THREEPITOR_VERSION="1.2.3"' v.ts --outfile v && ./v
  1.2.3
  $ bun run v.ts
  dev
  ```
- **Raised by:** run's own test
- **Confidence:** Verified
- **Bears on:** S-1; D-2

## Findings No Agent Could Audit

- **A real `brew install` and `brew upgrade` from the tap.** The tap is empty, so nothing could be installed. It would
  take a published release and formula to check that Homebrew leaves the binary's signature alone and that the alias
  resolves.
- **A GitHub-hosted macOS runner.** Whether a runner's native build verifies like C-3 is untested. It would take the
  first workflow run.
- **A physical Intel Mac.** C-4 ran under Rosetta only.

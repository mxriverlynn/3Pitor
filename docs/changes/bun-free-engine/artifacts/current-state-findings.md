# Current State Findings: Bun-free engine

## Provenance

This run's own discovery round produced these findings; there was no prior report. On 2026-10-02 it dispatched
`han-core:structural-analyst` (S-numbered findings) and `han-core:behavioral-analyst` (B-numbered findings), each
briefed with:

- the area: production code under `src/engine/`, `src/file-system/glob/glob.ts`, the `FileSystem` contract, and the
  receiving packages `src/cli/` and `src/server/`;
- the reason: reuse the engine outside the Bun runtime;
- the boundary record.

`han-core:concurrency-analyst` was not dispatched. The only async coordination in the area is the `claude` child
process lifecycle in `claude-cli.ts`, and the behavioral analyst traced it (C-6, C-7).

The orchestrator then ran its own sweep (Project Context) and checked three claims by hand:

- Node 22's `node:fs/promises` has no `exists` export (C-13).
- `system-prompt.md` contains four backticks and no `${` (C-9).
- No hand-written `FileSystem` test double exists (C-12).

## Project Context

- **Stack:** TypeScript on Bun 1.4.2. Hono for HTTP, Vercel AI SDK v7, zod, React UI bundled by Bun. Tests run on
  `bun test` and type checks on `tsc --noEmit` (TypeScript 7) through `make test`. One `tsconfig.json` covers all of
  `src/` with `"types": ["bun"]`. The shipped artifact is a single binary from `bun build --compile src/cli/cli.ts`
  (Makefile `build`); `make check-build` smoke-tests it.
- **Conventions source:** `README.md` ("All code lives in `src/`, organized by package, then by feature, then by
  component"). It covers the package import rules (cli → engine, server, file-system; server → engine only through
  `engine/engine.ts`; engine → `file-system/file-system.ts` contract symbols, `shared`, and npm packages; file-system
  imports no package) and the per-file descriptions. There is no CLAUDE.md, AGENTS.md, or `project-discovery.md`.
- **ADRs found:** none found under `docs/adr/`. Prior change plans under `docs/changes/` set precedent:
  - `server-engine-split/` created the engine package.
  - `file-system-package/` introduced the injected `FileSystem` and `boundary.test.ts`.
- **Coding standards found:** none as documents. `src/file-system/boundary.test.ts` enforces package rules by scanning
  source.
- **Recent churn (90 days, `src/engine` and `src/file-system`):**
  - The file-system package landed in the last few days (PR #29), so `local-file-system.ts`, `file-system.ts`,
    `json-file.ts`, and the engine feature files all moved recently.
  - `system-prompt.md` has had 6 commits in 90 days, so it is edited regularly.

## Gaps

- No ADR on runtime choice or on which code may be Bun-specific.
- No check that the engine loads or runs outside Bun (C-16). The shared `tsconfig.json` accepts `Bun.*` anywhere.
  `boundary.test.ts` matches only `Bun.file`, `Bun.write`, and `Bun.Glob`.
- No YAML library in `package.json` (C-8).
- No CI workflow runs tests. `.github/workflows/release.yml` only builds and smoke-tests on a version tag.
- Neither analyst ran code. Claims about Node behavior (spawn ENOENT timing, signal exit codes) come from reading the
  code plus knowledge of Node. Only the `exists` export was checked by running Node (C-13).

## Findings

### C-1: Package direction is clean and acyclic; the engine already takes injected collaborators

- **Claim:** The package edges are:
  - cli → engine, server, file-system.
  - server → engine, through `engine/engine.ts` in production.
  - engine → file-system entry only.
  - file-system → nothing.

  The engine already receives its file system (`EngineOptions.fileSystem`) and its tool server (`serveTools`) from
  cli, so there is a working injection precedent.
- **Location:** `src/cli/cli.ts:5-14`, `src/engine/engine.ts:19-36`
- **Evidence:**
  ```ts
  const fileSystem = createLocalFileSystem(root);
  const engine = await startEngine({ fileSystem, claude, model: process.env.MODEL, serveTools });
  ```
  ```ts
  export interface EngineOptions {
    fileSystem: FileSystem;
    model?: string;
    claude: ClaudeMode;
    maxSteps?: number;
    serveTools: ServeTools;
  }
  ```
- **Raised by:** structural-analyst S1, S11; behavioral-analyst B15
- **Confidence:** Verified
- **Bears on:** S-1, S-3, D-2, D-3

### C-2: Inventory of Bun-specific code in engine production files

- **Claim:** Eight production sites in `src/engine/` use something only Bun provides. Everything else in engine
  production code (`process.env`, `console.*`, `node:path`, `node:os`, Web streams, `Promise.withResolvers`) runs on
  Node 22.
- **Location:**
  - `workspace-config/workspace-config.ts:6` (macro import) and `:115` (`Bun.YAML.parse`)
  - `workspace-config/app-skills.macro.ts:13` (`Bun.Glob`)
  - `paths.ts:5` (`import.meta.dir`)
  - `chat/agent/agent.ts:24` (text import)
  - `text-imports.d.ts`
  - `chat/claude-backend/claude-backend.ts:81` (`Bun.which`)
  - `chat/claude-cli/claude-cli.ts:100,131` (`Bun.Subprocess`, `Bun.spawn`)
  - transitively, `src/file-system/glob/glob.ts:42` (`Bun.Glob`), through the engine's `glob` import
- **Evidence:** see C-4 through C-11 for each site verbatim.
- **Raised by:** structural-analyst S2; behavioral-analyst (inventory); orchestrator grep
- **Confidence:** Verified
- **Bears on:** every S-N entry

### C-3: Three of the sites fail at module load under Node, not at call time

- **Claim:** Node cannot load these:
  - the macro import (`with { type: 'macro' }`)
  - the text import (`with { type: 'text' }`)
  - `import.meta.dir`, which is `undefined` on Node, so `resolve(undefined, '..')` throws

  `engine.ts` imports `workspace-config.ts` and, through sessions, `agent.ts`, so the whole engine fails to load.
- **Location:** `workspace-config.ts:6`, `agent.ts:24`, `paths.ts:5`
- **Evidence:**
  ```ts
  import { appSkillFiles } from './app-skills.macro' with { type: 'macro' };
  import systemPrompt from './system-prompt.md' with { type: 'text' };
  export const SRC = resolve(import.meta.dir, '..');
  ```
- **Raised by:** structural-analyst S6, S7, S8
- **Confidence:** Verified (by reading); not executed under Node
- **Bears on:** S-6, S-7, S-8

### C-4: `glob` is a free function over `FileSystem`; only its per-segment match uses Bun

- **Claim:**
  - `glob(fileSystem, pattern, { dot })` walks the tree through `fileSystem.list()` and handles `**`, `./`, and the
    hidden-name rule itself.
  - Only single-segment matching calls `Bun.Glob`.
  - It is exported from the file-system entry and is on the engine's allowed-symbol list in `boundary.test.ts`.
  - `glob.test.ts` pins its semantics against `Bun.Glob.scan` over a real folder.
- **Location:** `src/file-system/glob/glob.ts:10-43`, `src/file-system/file-system.ts:81`,
  `src/file-system/boundary.test.ts:28-31`, `src/file-system/glob/glob.test.ts:39-48`
- **Evidence:**
  ```ts
  export async function glob(fileSystem: FileSystem, pattern: string, options: { dot?: boolean } = {}): Promise<string[]> {
  ...
  return new Bun.Glob(parts[i]).match(segment) && matches(parts, segments, dot, partial, i + 1, j + 1);
  ```
  ```ts
  const ENGINE_CONTRACT = new Set([
    'FileSystem', 'FileEntry', 'EntryKind', 'FileEvent', 'WatchOptions',
    'FileSystemError', 'FileSystemErrorReason', 'normalizeKey', 'parentKey', 'glob',
  ]);
  ```
- **Raised by:** structural-analyst S4, S16; behavioral-analyst B12, B13
- **Confidence:** Verified
- **Bears on:** S-1, S-2, D-1

### C-5: The engine calls `glob` in exactly two places, each already holding a `FileSystem`

- **Claim:** Two call sites:
  - `workspace-config.ts` scans `.claude/skills/*/SKILL.md` and `.claude/agents/*.md` with `{ dot: true }`.
  - The model's `Glob` tool in `tools.ts` passes a model-typed pattern with no options.

  Both sort the result.
- **Location:** `src/engine/workspace-config/workspace-config.ts:100`, `src/engine/chat/tools/tools.ts:155`
- **Evidence:**
  ```ts
  const scan = async (fileSystem: FileSystem, pattern: string) => (await glob(fileSystem, pattern, { dot: true })).sort();
  ```
  ```ts
  return (await glob(fileSystem, pattern)).sort().join('\n');
  ```
- **Raised by:** structural-analyst S5; behavioral-analyst B13
- **Confidence:** Verified
- **Bears on:** S-2

### C-6: `claude-cli.ts` uses four members of the Bun child process, and relies on spawn throwing ENOENT synchronously

- **Claim:** The child's surface used is:
  - `kill()`, with no argument;
  - `stdout` and `stderr` as `ReadableStream<Uint8Array>`;
  - `exited`, a promise of the exit code.

  Stdin is one known string, written and closed. A missing `claude` is detected by `Bun.spawn` throwing synchronously
  with `code === 'ENOENT'`. That throw turns into `Error(CLAUDE_NOT_FOUND_HELP)` before the stream is returned, so the
  call fails the way an API error does and nothing reaches chat history. Node's `child_process.spawn` reports ENOENT
  through an async `'error'` event instead, and reports a signal exit as `code === null`.
- **Location:** `src/engine/chat/claude-cli/claude-cli.ts:100-163`
- **Evidence:**
  ```ts
  let proc: Bun.Subprocess<Blob, 'pipe', 'pipe'> | undefined;
  ...
  proc = Bun.spawn(['claude', ...claudeArgs(modelId, call.prompt, defs, options.webTools, endpoint?.mcpServer)], {
    cwd: tmpdir(),
    env: childEnv(),
    stdin: new Blob([stdinFor(call.prompt)]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  } catch (error) {
    cleanup();
    throw (error as { code?: string }).code === 'ENOENT' ? new Error(CLAUDE_NOT_FOUND_HELP) : error;
  }
  const child = proc;
  call.abortSignal?.addEventListener('abort', cleanup);
  ...
  const [lastLines, code] = await Promise.all([stderr, child.exited]);
  ```
- **Raised by:** structural-analyst S10; behavioral-analyst B1, B2, B4
- **Confidence:** Verified for the Bun side. The Node-side behavior is Unverified: nobody ran Node `spawn` in this run.
- **Bears on:** S-3, S-5, D-3, D-4

### C-7: Cleanup is idempotent; the abort listener is attached only after spawn returns

- **Claim:** `cleanup()` is guarded by `closed`. It removes the abort listener, calls `proc?.kill()`, stops the tool
  endpoint, and closes the output unless the reader cancelled. An abort before spawn is caught by `throwIfAborted()` at
  entry, and the listener goes on right after the synchronous spawn, so there is no window between them today. The
  reading IIFE has no `catch`.
- **Location:** `src/engine/chat/claude-cli/claude-cli.ts:85-111, 144, 146-163`
- **Evidence:**
  ```ts
  const cleanup = () => {
    if (closed) return;
    closed = true;
    call.abortSignal?.removeEventListener('abort', cleanup);
    proc?.kill();
    endpoint?.stop();
    if (!cancelled) output.close();
  };
  ```
- **Raised by:** behavioral-analyst B3
- **Confidence:** Verified
- **Bears on:** S-5, D-4

### C-8: `Bun.YAML.parse` reads skill and agent frontmatter; no YAML library is installed

- **Claim:** `parseFrontmatter` returns `undefined` on a parse error (pinned by the `description: [unclosed` tests), and
  turns a scalar or null result into `{}`. The frontmatter in use has these features:
  - plain scalars;
  - double-quoted strings;
  - folded block scalars (`description: >`) with non-ASCII text.

  `package.json` has no YAML dependency. On Node, the call throws `ReferenceError`, which the `catch` swallows, so
  every skill and agent would silently disappear.

  **Corrected by the review round (test-engineer):** the real skills' parsed descriptions are not pinned exactly.
  - `workspace-config.test.ts` checks them with `stringContaining`.
  - `agent.test.ts:20-22` builds its expected lines from the same parser, so that comparison is circular.
  - Only the fixture's `doc-stats` description and `proofreader` prompt are compared exactly.
  - No test pins the `{}` fallback for scalar or null frontmatter.
- **Location:** `src/engine/workspace-config/workspace-config.ts:104-121`
- **Evidence:**
  ```ts
  try {
    data = Bun.YAML.parse(lines.slice(1, close).join('\n'));
  } catch {
    return undefined;
  }
  ```
- **Raised by:** structural-analyst S3; behavioral-analyst B7, B8
- **Confidence:** Verified
- **Bears on:** S-3, S-6, D-5

### C-9: The system prompt is a `.md` text import, used once per turn as the cache-marked first system message

- **Claim:**
  - Bun inlines `system-prompt.md` as a string at bundle time.
  - `agent.ts` sends `systemPrompt.trimEnd()` as the first system message with `cacheControl`, and `claude-cli.ts`
    splits the prompt at that mark.
  - `text-imports.d.ts` exists only so the type checker accepts the import.
  - The file is 76 lines with 4 backticks and no `${`. It has had 6 commits in 90 days.
  - `agent.test.ts` also text-imports it, and uses it as its own expectation. **Review correction (test-engineer):** once
    both sides read one constant, no test pins the prompt's bytes.
- **Location:** `src/engine/chat/agent/agent.ts:24, 133`, `src/engine/text-imports.d.ts`,
  `src/engine/chat/agent/system-prompt.md`
- **Evidence:**
  ```ts
  import systemPrompt from './system-prompt.md' with { type: 'text' };
  ...
  { role: 'system', content: systemPrompt.trimEnd(), providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
  ```
- **Raised by:** structural-analyst S7; behavioral-analyst B11; orchestrator (backtick count, churn)
- **Confidence:** Verified
- **Bears on:** S-7, D-6

### C-10: App skills are embedded by a Bun macro into a module-level constant that two features read directly

- **Claim:**
  - `app-skills.macro.ts` reads every `.md` under `src/skills/`, excluding hidden names, sorted, and keyed by path
    relative to that folder.
  - It runs at transpile time and is inlined as `APP_SKILL_FILES`.
  - `loadWorkspaceConfig` lists the app skills from it, and the Read tool serves `3pitor://skills/...` paths from it
    through `appSkillText`.
  - Neither reaches it through a parameter. `appSkills(files)` already takes the files as an argument.
  - `make check-build` verifies the embed in the compiled binary.
- **Location:** `src/engine/workspace-config/app-skills.macro.ts`, `workspace-config.ts:29, 63, 70-76, 80`,
  `src/engine/chat/tools/tools.ts:16, 100`
- **Evidence:**
  ```ts
  export const APP_SKILL_FILES: Record<string, string> = appSkillFiles();
  ...
  const apps = appSkills(APP_SKILL_FILES).filter((app) => !skills.some((s) => s.name === app.name));
  ...
  if (path.startsWith('..') || !Object.hasOwn(APP_SKILL_FILES, path)) throw new Error(`${filePath} does not exist`);
  ```
- **Raised by:** structural-analyst S6; behavioral-analyst B9, B10
- **Confidence:** Verified
- **Bears on:** S-4, S-6, S-8, D-2

### C-11: `Bun.which` decides the CLI-mode startup warning; the engine reads `process.env` to feed it

- **Claim:** `startEngine` prints the backend label and calls `backend.startupWarning(process.env)` once. CLI mode
  looks up `claude` on the `PATH` it is handed, and an unset PATH means not found. `claudeBackend(mode, serveTools)` is
  also called per turn from `agent.ts`, so anything the CLI backend needs must reach both call sites.
- **Location:** `src/engine/chat/claude-backend/claude-backend.ts:76-91`, `src/engine/engine.ts:84-87`,
  `src/engine/chat/agent/agent.ts:65`
- **Evidence:**
  ```ts
  // Looked up on the PATH it is given, since Bun may keep the PATH it started with.
  startupWarning: (env) => (Bun.which('claude', { PATH: env.PATH ?? '' }) ? undefined : CLAUDE_NOT_FOUND_HELP),
  ```
- **Raised by:** structural-analyst S9; behavioral-analyst B6
- **Confidence:** Verified
- **Bears on:** S-3, S-5

### C-12: Options flow cli → `startEngine`/`createEngine` → `Sessions` → `agentSettings` → `claudeBackend` as one object

- **Claim:**
  - `SessionsOptions extends AgentOptions`, and `wire()` hands `EngineOptions` to `new Sessions(options, events)`.
  - `agentSettings(options, …)` calls `loadWorkspaceConfig(options.fileSystem)`,
    `claudeBackend(options.claude, options.serveTools)`, and `fileTools(options.fileSystem, turn, progress)`.
  - A field added to `AgentOptions` reaches every one of them.
  - No hand-written `FileSystem` test double exists; every test builds `createLocalFileSystem`.
- **Location:** `src/engine/chat/agent/agent.ts:26-33, 59-80`, `src/engine/chat/sessions/sessions.ts:22, 32-33`,
  `src/engine/engine.ts:93`
- **Evidence:**
  ```ts
  export interface AgentOptions {
    fileSystem: FileSystem;
    model?: string;
    claude: ClaudeMode;
    serveTools: ServeTools;
  }
  ...
  const config = await loadWorkspaceConfig(options.fileSystem);
  const backend = claudeBackend(options.claude, options.serveTools);
  ...
  const files = fileTools(options.fileSystem, turn, progress);
  ```
- **Raised by:** behavioral-analyst B15; orchestrator (test-double grep)
- **Confidence:** Verified
- **Bears on:** S-3, S-4, S-5, S-6

### C-13: Loading the file-system entry under Node fails, so the engine fails to load even with its own Bun code gone

- **Claim:**
  - The engine imports runtime values (`FileSystemError`, `normalizeKey`, `parentKey`, `glob`) from
    `file-system/file-system.ts`.
  - That module re-exports `chooseWorkspace` from `local/workspace/workspace.ts`, which imports `exists` from
    `node:fs/promises`.
  - Node 22 has no such export, so an ES module import of the entry fails with a missing-export error before any code
    runs.
  - `local-file-system.ts` also calls `Bun.write`, but only inside write paths, so it does not affect loading.
- **Location:** `src/file-system/local/workspace/workspace.ts:3`, `src/file-system/file-system.ts:82`,
  `src/file-system/local/local-file-system/local-file-system.ts:178,193`
- **Evidence:**
  ```ts
  import { cp, exists, rm, stat } from 'node:fs/promises';
  ```
  ```
  $ node -e "import('node:fs/promises').then(m=>console.log('exists' in m))"   # node v22.21.1
  false
  ```
- **Raised by:** structural-analyst S14; orchestrator ran the Node check
- **Confidence:** Verified
- **Bears on:** S-9, D-7

### C-14: `paths.ts` locates app assets outside the engine, and its consumers are cli, the check script, and tests

- **Claim:**
  - `SRC` and `WORKSPACE_FIXTURE` come from `import.meta.dir`.
  - The engine itself never uses either. It only re-exports `WORKSPACE_FIXTURE` for cli.
  - Production consumers are:
    - `cli.ts`, which seeds the dev workspace;
    - `server/scripts/check.ts`, which uses both;
    - the macro, at build time.
  - Test consumers are `paths.test.ts`, `workspace-config.test.ts`, `agent.test.ts`, and
    `workspace-config.routes.test.ts`.
  - `paths.test.ts` requires the file to sit directly under its package root.
- **Location:** `src/engine/paths.ts`, `src/engine/engine.ts:16`, `src/cli/cli.ts:5,12`,
  `src/server/scripts/check.ts:6-7`
- **Evidence:**
  ```ts
  export const SRC = resolve(import.meta.dir, '..');
  export const WORKSPACE_FIXTURE = join(SRC, 'fixtures/workspace');
  ```
  ```ts
  export { WORKSPACE_FIXTURE } from './paths';
  ```
- **Raised by:** structural-analyst S8, S17; behavioral-analyst B14
- **Confidence:** Verified
- **Bears on:** S-8, D-2

### C-15: The `bun build --compile` entry is `src/cli/cli.ts`; both embeds happen there and `check-build` verifies the skills

- **Claim:** The binary is built from `cli.ts`, which pulls in the engine, the server, and the UI. The macro and the
  text import are resolved during that build. `make check-build` runs the binary and greps `/api/workspace-config` for
  `collaborative-editing`.
- **Location:** `Makefile` (`build`, `check-build`)
- **Evidence:**
  ```
  bun build --compile --production --define THREEPITOR_VERSION='"$(THREEPITOR_VERSION)"' src/cli/cli.ts \
  	--outfile $(BUILD)/3pitor
  ```
- **Raised by:** structural-analyst S15; behavioral-analyst B9
- **Confidence:** Verified
- **Bears on:** S-6, S-8, D-2

### C-16: Nothing checks that the engine is Bun-free

- **Claim:**
  - `tsconfig.json` declares `"types": ["bun"]` for all of `src/`, so the type checker accepts `Bun.*` in the engine.
  - `boundary.test.ts`'s `FS_API` patterns cover only `Bun.file`, `Bun.write`, and `Bun.Glob`.
  - Nothing catches `Bun.spawn`, `Bun.which`, `Bun.YAML`, `bun:` imports, import attributes, or `import.meta.dir`.
  - No command loads the engine under Node.
- **Location:** `tsconfig.json`, `src/file-system/boundary.test.ts:10-16`
- **Evidence:**
  ```json
  "types": ["bun"],
  ```
- **Raised by:** structural-analyst S15, S16
- **Confidence:** Verified
- **Bears on:** S-10, S-11, D-8

### C-17: Engine logging goes straight to `console`; it runs on Node and has no seam

- **Claim:** `sessions.ts`, `stream-json.ts`, `json-file.ts`, `claude-backend.ts`, and `engine.ts` log with
  `console.*`. Every one of these runs on Node.
- **Location:** `src/engine/chat/sessions/sessions.ts:89,114,153`, `src/engine/engine.ts:85-87`, and others
- **Evidence:**
  ```ts
  console.log(`3pitor chat: claude via ${backend.label}`);
  ```
- **Raised by:** structural-analyst S13
- **Confidence:** Verified
- **Bears on:** Deferred (YAGNI): a logger seam

### C-18: Runtime probes: `exists`, `Bun.YAML`, and `node:child_process` behave as the plan assumes on both runtimes

- **Claim:** Probes run during the review round, on Node v22.21.1 and Bun 1.4.2, established the following.
  - **`exists`.** Bun's `exists` and `stat(p).then(() => true, () => false)` agree for each case tried: an existing
    folder (true), a broken symlink (false), a missing path (false), a file inside an unreadable folder (false), and
    the unreadable folder itself (true).
  - **`Bun.YAML.parse`.** It keeps a duplicated key's last value. It folds `d: >\n  one\n  two\n` to
    `"one two\n"`.
  - **ENOENT.** On both runtimes, `node:child_process` `spawn` of a missing program does not throw synchronously.
    `once(child, 'spawn')` rejects with `ENOENT`, and a `kill()` after that does not throw.
  - **Kill before spawn.** A `kill()` before `'spawn'` still kills the child.
  - **Signal exit.** `'close'` reports `(null, 'SIGTERM')` for a signal exit. `Bun.spawn(...).exited` resolved to `143`
    in the same case.
  - **EPIPE.** Writing to the stdin of a child that has closed it emits `EPIPE`, which needs a listener.
  - **Unhandled rejections.** One exits the process on both runtimes.
  - **Late `'close'` listener.** A `once(child, 'close')` attached after stdout has drained hung 20 of 20 times when
    the reader lagged by a tick per chunk.
  - **Early `once(child, 'close')`.** Created before `'spawn'`, it rejects unhandled on ENOENT. A plain
    `child.on('close', …)` listener does not.
- **Location:** probe scripts in the session scratchpad (`p1`–`p6.mjs`, `probe.ts`); not committed.
- **Evidence:**
  ```
  p true true / p/broken false false / p/missing false false / p/locked/f false false / p/locked true true
  { a: 2 }   { d: "one two\n" }
  ```
- **Raised by:** on-call-engineer (child-process probes); orchestrator (`exists` and YAML probe)
- **Confidence:** Verified (run on both runtimes)
- **Bears on:** S-3, S-4, S-14, D-4, D-5, D-7

## Findings No Agent Could Audit

- **Runtime behavior under Node.** The discovery round ran no code. The review round's probes then confirmed the C-6
  spawn semantics on both runtimes (C-18). The engine's own code has still not run on Node. The Node check in the plan
  (S-16) closes that.
- **The real `claude` binary.** Nobody tested whether it exits promptly on SIGTERM, or whether its output can leave
  the parser a tick behind EOF. These bear on how often the hazards D-4 guards against would occur, not on whether they
  exist.
- **The compiled binary's `import.meta.dir`.** Nobody inspected what it evaluates to inside `build/3pitor`.
  `make check-build` exercising the moved macro is what closes this.
- **`Bun.Glob.match` per-segment edge cases** (for example `*` against `.x`, or `{a,.b}`). They were not probed. The
  plan keeps `Bun.Glob` inside the local backend, so this does not need closing for this change.

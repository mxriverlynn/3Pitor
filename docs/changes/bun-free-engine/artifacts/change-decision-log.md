# Change Decision Log: Bun-free engine

The plan lives in [../change-plan.md](../change-plan.md). This file records the question, rationale, evidence, and
rejected alternatives behind each decision. Evidence about the code as it stands lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

**How these decisions were made.** The operator has standing guidance for han planning runs: settle escalations and
behavior-change gates without asking, log each decision, and report behavior changes in the final summary. The
operator confirmed scope in this run's confirmation turn. Every decision below that would otherwise have gone to the
operator says so under **Behavior impact**.

## Trivial decisions

- D-10: The engine stops re-exporting `WORKSPACE_FIXTURE`. cli and the check script import it from
  `app-files/app-files.ts` instead, since the engine never used it itself
  ([C-14](current-state-findings.md#c-14-pathsts-locates-app-assets-outside-the-engine-and-its-consumers-are-cli-the-check-script-and-tests)).
  — Referenced in plan: Surface Delta (S-9).
- D-11: Engine tests and test-only helpers stay on `bun:test` and may keep using `Bun.*`. Their construction sites
  are updated to pass the new options, and nothing more. This is the operator's stated exclusion. — Referenced in plan:
  Target State, Change Units, Cut for Scope.
- D-12: The README's package rules and per-file descriptions are updated in the same change, so they describe
  app-files, `FileSystem.glob`, and the Bun-free engine rule. — Referenced in plan: Surface Delta (S-17).

## Full decisions

### D-1: `glob` becomes a method on the `FileSystem` contract

- **Question:** How does the engine match file patterns without depending on `Bun.Glob`?
- **Decision:** `FileSystem` gains this method:

  ```ts
  // The file keys matching pattern, in no order. A pattern is not a key and is not checked against the key grammar.
  // It is '/'-separated, and a leading './' is ignored. A whole-segment '**' matches zero or more folders; any other
  // segment matches one name, using '*', '?', '[...]', and '{a,b}'. Unless dot is set, a name starting with '.' is
  // matched only by a pattern segment that itself starts with '.' (a brace alternative that starts with '.' does not
  // count). Only 'file' entries are returned. A folder the pattern cannot reach is never listed. A missing or refused
  // folder gives nothing; other errors propagate.
  glob(pattern: string, options?: { dot?: boolean }): Promise<string[]>;
  ```

  Worked example. A workspace holds `notes.md`, `drafts/a.md`, and `.claude/skills/doc-stats/SKILL.md`:

  - `glob('**/*.md')` → `['notes.md', 'drafts/a.md']`, in any order.
  - `glob('.claude/skills/*/SKILL.md', { dot: true })` → `['.claude/skills/doc-stats/SKILL.md']`.

  Changes around the method:

  - `src/file-system/glob/glob.ts` becomes a walker internal to the package. Its parameter narrows to
    `Pick<FileSystem, 'list'>`, and its `Bun.Glob` segment match stays.
  - `createLocalFileSystem` implements the method by calling that walker over itself.
  - The entry module stops exporting `glob`, and `boundary.test.ts`'s `ENGINE_CONTRACT` drops `'glob'`.
  - The engine calls `fileSystem.glob(...)` at its two call sites, and both keep their `.sort()`.
- **Rationale:** The operator said: "the pattern matcher must move into the file-system package, as a method to be
  called". Each backend now owns how it matches patterns, and the engine depends only on the contract. The walker
  needs nothing but `list()`, so narrowing its parameter states that.
- **Evidence:**
  - [C-4](current-state-findings.md#c-4-glob-is-a-free-function-over-filesystem-only-its-per-segment-match-uses-bun)
  - [C-5](current-state-findings.md#c-5-the-engine-calls-glob-in-exactly-two-places-each-already-holding-a-filesystem)
  - [C-12](current-state-findings.md#c-12-options-flow-cli--startenginecreateengine--sessions--agentsettings--claudebackend-as-one-object):
    no other `FileSystem` implementation or test double exists, so a new required method breaks nothing.
- **Behavior impact:** Preserving. The same walker produces the same keys for the same pattern, and `glob.test.ts`
  still pins it against `Bun.Glob.scan`.
- **Rejected alternatives:**
  - Keep `glob` as a free function, and replace `Bun.Glob` with a pure-JS segment matcher. Rejected because it goes
    against the operator's explicit instruction. It would also mean re-proving every `Bun.Glob` edge case, which C-4
    shows is pinned only through a Bun oracle.
  - Inject a matcher function into the engine. Rejected for the same instruction, and because it adds a seam the
    contract already provides.
- **Revisit criterion:** A non-local backend can glob natively, for example a remote store with a pattern query, and
  wants to skip the walker.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** D-8
- **Referenced in plan:** Target State, Surface Delta (S-1, S-2), Change Units (Unit 2)

### D-2: A new leaf package, `src/app-files/`, owns `paths.ts` and the app-skills macro; the engine receives `appSkillFiles`

- **Question:** Where do `import.meta.dir` and the Bun macro go, and how does the engine get the app's own skills?
- **Decision:**
  - A new package, `src/app-files/`, holds:
    - `paths.ts`, moved unchanged, with `paths.test.ts` beside it;
    - `app-skills.macro.ts`, moved unchanged;
    - the entry module `app-files.ts`.
  - The entry module exports `APP_SKILL_FILES` (the macro's result), `SRC`, and `WORKSPACE_FIXTURE`. app-files
    imports one thing from another package: the `AppSkillFiles` type, from `engine/engine.ts`.
  - Engine production code never imports app-files. cli and `server/scripts/check.ts` import it in production; tests
    may import it.
  - The engine gains this contract:

  ```ts
  // engine/workspace-config/workspace-config.ts, re-exported as a type from engine/engine.ts
  // Each app skill file's full text, keyed by its '/'-separated path under the skills folder: no leading '/', no '..'
  // segments, hidden names excluded.
  // Example: { 'collaborative-editing/SKILL.md': '---\nname: collaborative-editing\n...' }
  export type AppSkillFiles = Readonly<Record<string, string>>;

  export async function loadWorkspaceConfig(fileSystem: FileSystem, appSkillFiles: AppSkillFiles): Promise<WorkspaceConfig>;
  export function appSkillText(appSkillFiles: AppSkillFiles, filePath: string): string | undefined; // throw rules unchanged

  // AgentOptions (and so SessionsOptions), EngineOptions, and StartOptions each gain, required:
  appSkillFiles: AppSkillFiles;

  // tools.ts: optional fourth parameter; agentSettings always passes options.appSkillFiles
  export function fileTools(fileSystem: FileSystem, turn: TurnTexts, onChange?: () => void, appSkillFiles?: AppSkillFiles);
  ```

  - With `appSkillFiles` omitted, `fileTools` uses `{}`, so a `3pitor://skills/...` Read throws `does not exist`.
  - `engine.ts`'s `workspaceConfig.names()` passes `options.appSkillFiles`.
  - `cli.ts` passes `APP_SKILL_FILES` from app-files to `startEngine`.
- **Rationale:**
  - The macro and `import.meta.dir` are the two Bun-only features left, and both exist to locate and embed files from
    the app's own source tree. One package owning that is cohesive.
  - No existing package fits:
    - nothing may import cli, and check.ts needs these paths;
    - the file-system entry must load on Node (C-13);
    - `shared` runs in the browser;
    - in server, engine tests would have to import server.
  - The skill files are app content that the host chooses to ship, so the engine takes them as data. That is the
    `fileSystem` and `serveTools` precedent (C-1).
  - Making the option required means a host that forgets it gets a type error. A silent loss of every app skill is
    the C-8 failure mode, and required rules it out.
- **Evidence:**
  - [C-10](current-state-findings.md#c-10-app-skills-are-embedded-by-a-bun-macro-into-a-module-level-constant-that-two-features-read-directly)
  - [C-14](current-state-findings.md#c-14-pathsts-locates-app-assets-outside-the-engine-and-its-consumers-are-cli-the-check-script-and-tests)
  - [C-15](current-state-findings.md#c-15-the-bun-build---compile-entry-is-srcclicl-ts-both-embeds-happen-there-and-check-build-verifies-the-skills)
  - [C-1](current-state-findings.md#c-1-package-direction-is-clean-and-acyclic-the-engine-already-takes-injected-collaborators)
  - [C-12](current-state-findings.md#c-12-options-flow-cli--startenginecreateengine--sessions--agentsettings--claudebackend-as-one-object)
  - software-architect A6
- **Behavior impact:** Preserving. The same macro embeds the same files into the same binary, and the same map
  reaches `loadWorkspaceConfig` and the Read tool. `make check-build` confirms the embed survives the move.
- **Rejected alternatives:**
  - Put the macro and paths in cli. Rejected because `server/scripts/check.ts` needs `SRC` and `WORKSPACE_FIXTURE`,
    and nothing may import cli.
  - Put them in server. Rejected because engine tests would import server, reversing the package direction.
  - Make `appSkillFiles` optional, defaulting to `{}`, on `EngineOptions`. Rejected because a Node host that forgot it
    would silently lose every app skill.
  - Load app skills through a second, in-memory `FileSystem`. Rejected under YAGNI: there is one use, and it adds a
    `FileSystem` implementation for a read-only map.
- **Revisit criterion:** A host needs to load app skills from somewhere other than an embedded map, for example from
  disk at runtime.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6, S-7, S-8, S-9, S-10, S-11
- **Dependent decisions:** D-8, D-10
- **Referenced in plan:** Target State, Surface Delta (S-6–S-11), Change Units (Units 5, 6)

### D-3: The engine runs `claude` through `node:child_process`, with no injected spawn

- **Question:** How does the engine start the `claude` program without `Bun.spawn`?
- **Decision:** `claude-cli.ts` uses `spawn` from `node:child_process`. Bun and Node both implement it. No spawn
  function is injected, and no `Runtime` object is introduced.
- **Rationale:** The goal is an engine with no Bun-specific code. `node:child_process` is not Bun-specific, because
  both runtimes provide it. An injected spawn function would have the same body in the Bun host and in the Node host,
  so the seam would vary nothing.
- **Evidence:**
  - [C-6](current-state-findings.md#c-6-claude-clits-uses-four-members-of-the-bun-child-process-and-relies-on-spawn-throwing-enoent-synchronously)
  - software-architect A1. The architect's Node probe loaded `claude-backend.ts` successfully.
- **Behavior impact:** see D-4 for the lifecycle; that decision carries the behavior classification.
- **Rejected alternatives:**
  - An engine-owned `spawn(command, args, options): Promise<ChildProcess>` port, implemented with `Bun.spawn` in the
    host. Rejected under YAGNI: it has one implementation shape, and the Node host's version would be
    `node:child_process` anyway.
  - A grouped `Runtime` object `{ spawn, which, parseYaml }`. Rejected because two of its three members do not need
    injecting (D-3, D-5), and what is left fails the rule of three.
- **Revisit criterion:** A named host lacks `node:child_process`, for example a browser or an edge worker.
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** D-4
- **Referenced in plan:** Target State, Surface Delta (S-14), Deferred (YAGNI)

### D-4: The lifecycle and error contract of the `claude` child process

- **Question:** What order of operations keeps the call's behavior the same under `node:child_process`? On Node,
  "not found" arrives asynchronously, and a signal exit has no exit code.
- **Decision:** `runClaude` keeps its contract with its callers:
  - It rejects before returning a stream when `claude` is not found.
  - It never lets a failure before the first output reach chat history.
  - Its cleanup stays idempotent.

  It does this in this order:

  1. `child = spawn('claude', args, { cwd: tmpdir(), env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] })`, inside a
     `try`. A synchronous throw calls `cleanup()` and rethrows. An `ENOENT` code becomes
     `new Error(CLAUDE_NOT_FOUND_HELP)`.
  2. Attach `call.abortSignal`'s `'abort'` listener at once, synchronously, before any `await`.
  3. `await once(child, 'spawn')`. A rejection, which is Node's async ENOENT, calls `cleanup()` and rethrows with the
     same `ENOENT` mapping. This still happens before the stream is returned.
  4. Then:
     - `child.on('error', (error) => emit({ type: 'error', error }))`, so a later error is never unhandled;
     - `child.stdin.on('error', () => {})`, to ignore an EPIPE when `claude` exits before reading;
     - `child.stdin.end(stdinFor(call.prompt))`.
  5. Read stdout and stderr as `Readable.toWeb(...)` streams through the existing `lines()`/`streamJsonParts()` chain
     and `tail()`. Wait on `once(child, 'close')`, not `'exit'`, so stdio has drained.
  6. Report a non-zero end with no `finish` part as
     `claude exited with code ${code}: ${lastLine}` when `code` is a number, or
     `claude exited with signal ${signal}: ${lastLine}` when it is `null`.

  `cleanup()` keeps its `closed` guard and calls `child?.kill()`, which is safe after exit.
- **Rationale:** Step 2 closes the abort window an `await` would otherwise open
  ([C-7](current-state-findings.md#c-7-cleanup-is-idempotent-the-abort-listener-is-attached-only-after-spawn-returns)).
  Step 3 makes the async ENOENT reject at the same point the synchronous one did. Step 6 gives a signal exit a readable
  message instead of `code null`.
- **Evidence:**
  - [C-6](current-state-findings.md#c-6-claude-clits-uses-four-members-of-the-bun-child-process-and-relies-on-spawn-throwing-enoent-synchronously)
  - [C-7](current-state-findings.md#c-7-cleanup-is-idempotent-the-abort-listener-is-attached-only-after-spawn-returns)
  - behavioral-analyst B1–B4
  - software-architect A1
- **Behavior impact:** **Changing**, in two narrow ways. Both are visible only when `claude` misbehaves:
  - If something outside 3pitor kills `claude` mid-reply, the chat's error reads `claude exited with signal SIGTERM:
    …` where it may have read `claude exited with code 143: …`. Nobody inspected what Bun reported before, so the old
    text is not known exactly.
  - A child-process `'error'` that arrives after startup now shows as a chat error. Before, it had no handler.

  Under the operator's standing guidance, decided without asking: accept both. A stop 3pitor asks for itself is
  unaffected, because cleanup has already closed the stream. The not-found message and its timing are unchanged.
- **Rejected alternatives:**
  - Keep `code ${code}` and print `code null` for a signal. Rejected because the message tells the reader nothing.
  - Map a signal to `128 + n`, to imitate a shell. Rejected because it invents a number neither runtime reports.
- **Revisit criterion:** `claude-cli.test.ts` shows Bun's `node:child_process` reporting ENOENT or signal exits
  differently from what this order assumes.
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-14), Behavior Changes, Risks

### D-5: YAML frontmatter is parsed with the npm `yaml` package, with duplicate keys allowed

- **Question:** What replaces `Bun.YAML.parse` in `parseFrontmatter`?
- **Decision:**
  - Add `yaml` to `dependencies`, at an exact version, as every other dependency is pinned.
  - `parseFrontmatter` calls `parse(text, { uniqueKeys: false })` from `yaml`.
  - The `try/catch → undefined` path and the scalar or null → `{}` handling stay exactly as they are.
- **Rationale:**
  - Frontmatter parsing is engine behavior. The README already lets the engine import npm packages.
  - Injecting a parser would make every host supply one, and the Node host would install this same package to do it.
  - `uniqueKeys: false` keeps a skill with a duplicated key, using its last value, instead of dropping the whole skill.
    That matches the function's lenient design.
- **Evidence:**
  - [C-8](current-state-findings.md#c-8-bunyamlparse-reads-skill-and-agent-frontmatter-no-yaml-library-is-installed)
  - behavioral-analyst B7, B8
  - software-architect A4
- **Behavior impact:** **Unknown, settled as Preserving under test.**
  - The frontmatter in use is plain scalars, quoted strings, and folded block scalars. The `description: [unclosed`
    case and the full app-skill descriptions are pinned by `workspace-config.test.ts`.
  - Two parsers can still disagree on inputs nobody has written yet.
  - Decided without asking, under the operator's standing guidance: the existing tests are the bar. If one fails, the
    builder adjusts the parse options to match. The builder does not change the tests.
- **Rejected alternatives:**
  - Inject `parseYaml` from the host and keep `Bun.YAML` in the Bun host. Rejected because every host would need a
    parser for engine-owned behavior, and there would be one real implementation.
  - Write a hand-rolled frontmatter parser. Rejected because folded block scalars with correct folding are already in
    use (B8), and a hand-rolled parser would get them wrong.
- **Revisit criterion:** A skill author reports frontmatter that worked before the change and no longer does.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-4), Behavior Changes, Risks

### D-6: The system prompt becomes a TypeScript module inside the engine

- **Question:** How does the engine carry its system prompt without a Bun text import?
- **Decision:**
  - Add `src/engine/chat/agent/system-prompt.ts`, which exports `SYSTEM_PROMPT`, a template literal holding the exact
    text of `system-prompt.md`. Its four backticks are escaped as `` \` ``. The file has no `${` and no backslashes.
  - `agent.ts` keeps `.trimEnd()` and the cache mark.
  - Delete `system-prompt.md` and `text-imports.d.ts`.
  - `agent.test.ts` imports `SYSTEM_PROMPT`.
- **Rationale:** The prompt describes the engine's own tools, so it belongs to the engine. Any host reusing the engine
  wants the same text. Injecting it would make every host ship a copy. A code generator from `.md` would add a build
  step and a freshness check. Writing it as a module costs four escapes in a file edited about twice a month.
- **Evidence:**
  - [C-9](current-state-findings.md#c-9-the-system-prompt-is-a-md-text-import-used-once-per-turn-as-the-cache-marked-first-system-message)
  - [C-3](current-state-findings.md#c-3-three-of-the-sites-fail-at-module-load-under-node-not-at-call-time)
  - software-architect A5
- **Behavior impact:** Preserving. The model receives the same bytes after `.trimEnd()`. The unit that makes the
  change proves this once: before deleting the `.md`, assert `SYSTEM_PROMPT === <the .md text>`.
- **Rejected alternatives:**
  - Inject the prompt from the host. Rejected because every host would ship the same engine-owned text.
  - Generate a `.ts` file from the `.md` at build time. Rejected because it adds a build step that must run before
    `tsc` and the tests, and the generated file can drift from its source.
  - Read the prompt through the file system. Rejected because it is not workspace content.
- **Revisit criterion:** Editing the prompt as a template literal causes repeated mistakes, such as an unescaped
  backtick breaking the type check.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-5)

### D-7: Fix the one Node load failure in the file-system entry; leave the local backend's call-time Bun use

- **Question:** The engine loads the file-system entry at runtime, and the entry fails to load on Node. How much of
  the file-system package changes?
- **Decision:**
  - In `src/file-system/local/workspace/workspace.ts`, stop importing `exists` from `node:fs/promises` and define it
    locally from the already-imported `stat`: `(path) => stat(path).then(() => true, () => false)`.
  - Leave `Bun.write` (in `local-file-system.ts`) and `Bun.Glob` (in the walker) alone. Both run only when called.
- **Rationale:** Without this fix, removing every Bun API from the engine still leaves an engine that cannot load
  outside Bun, so the goal fails. The local backend's call-time Bun use only matters to a host that picks the local
  backend. Nothing in the boundary asks for that.
- **Evidence:**
  - [C-13](current-state-findings.md#c-13-loading-the-file-system-entry-under-node-fails-so-the-engine-fails-to-load-even-with-its-own-bun-code-gone):
    the Node check returned `false`.
  - software-architect A3: its load probe failed with "does not provide an export named 'exists'".
- **Behavior impact:** Preserving. `exists` answers true or false for a path either way. `chooseWorkspace` and
  `resetWorkspace` behave the same.
- **Rejected alternatives:**
  - Make the whole local backend run on Node. Rejected as outside the boundary: the operator scoped file-system
    changes to the pattern matcher. Recorded in Cut for Scope.
  - Split the file-system entry so the engine imports a contract-only module. Rejected because one import fix is
    enough, and `boundary.test.ts` deliberately allows only one entry.
- **Revisit criterion:** A Node host wants to use `createLocalFileSystem`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** D-8
- **Referenced in plan:** Target State, Surface Delta (S-3), Cut for Scope

### D-8: Prove the engine is Bun-free with a source scan and a Node load check, both in `make test`

- **Question:** What stops the engine from quietly becoming Bun-dependent again?
- **Decision:** Two checks.

  **The scan.** `src/engine/bun-free.test.ts`, on `bun:test`, modelled on `boundary.test.ts`.
  - It scans every engine `.ts` file that is not a `*.test.ts` and is not one of the named test helpers:
    `chat/components/fake-claude.ts`, `fake-claude-on-path.ts`, `chat-test-helpers.ts`, `test-model.ts`, and
    `stub-tool-server.ts`.
  - These patterns fail it:

  ```ts
  /\bBun\.\w/                                   // any Bun API
  /\b(from|import)\s*\(?\s*['"]bun(:[\w-]+)?['"]/   // 'bun' or 'bun:*' imports
  /\bwith\s*\{\s*type\s*:/                      // import attributes (macro, text)
  /\bimport\.meta\.(dir|file|path|main)\b/      // Bun-only import.meta fields
  /['"][^'"]*app-files\//                       // engine production code never imports app-files
  ```

  - It also carries an "every exemption names a file that exists" test and a planted-lines self-test, as
    `boundary.test.ts` does.

  **The load check.** `src/engine/node-load-check.mjs`, run by a new Makefile target:
  `check-node: node --experimental-transform-types src/engine/node-load-check.mjs`.
  - It registers a `node:module` resolve hook that retries a relative specifier with `.ts`.
  - Then it runs `await import('./engine.ts')` and exits 0.
  - `test` gains `check-node` as a prerequisite, beside `typecheck`.
- **Rationale:**
  - The two checks catch different failure classes. The load check misses call-time APIs such as `Bun.spawn`,
    `Bun.which`, and `Bun.YAML`, and C-8 shows that last one fails silently. The scan misses non-Bun load failures in
    the import graph, and C-13's `exists` was exactly that.
  - Running the load check in `make test` means a regression fails the normal test run instead of waiting for someone
    to remember a separate target.
- **Evidence:**
  - [C-16](current-state-findings.md#c-16-nothing-checks-that-the-engine-is-bun-free)
  - [C-13](current-state-findings.md#c-13-loading-the-file-system-entry-under-node-fails-so-the-engine-fails-to-load-even-with-its-own-bun-code-gone)
  - [C-8](current-state-findings.md#c-8-bunyamlparse-reads-skill-and-agent-frontmatter-no-yaml-library-is-installed)
  - software-architect A8, which prototyped the load check and saw it reproduce C-3 and C-13 today.
- **Behavior impact:** **Changing**, for developers only. `make test` now needs Node 22.15 or later on the `PATH`
  (`registerHooks` and `--experimental-transform-types`). Nothing changes for anyone running the app. Decided without
  asking, under the operator's standing guidance: accept it. The local machine has Node 22.21.1, and the release
  workflow runs `make check-build`, not `make test`.
- **Rejected alternatives:**
  - Make `check-node` a separate target, outside `make test`, as `check-build` is. Rejected because a check nobody
    runs does not stop a regression.
  - Add a second `tsconfig` for the engine with `types: ["node"]`. Rejected because it would also type-check the
    file-system entry's graph, which still holds `Bun.write` and `Bun.Glob`, so it would need exclusions and would add
    nothing the scan does not cover.
  - Run only the scan. Rejected because it would have missed C-13.
- **Revisit criterion:** A developer machine or CI runner without Node needs to run `make test`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-15, S-16
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-15, S-16), Behavior Changes, Change Units (Unit 8)

### D-9: The `claude`-on-PATH check is injected as `isOnPath` on `StartOptions` only, and cli passes `Bun.which`

- **Question:** How does the CLI-mode startup warning find `claude` without `Bun.which`?
- **Decision:**

  ```ts
  // claude-backend.ts, re-exported as a type from engine/engine.ts
  // Whether an executable named `program` is on `path`, a list joined by the platform's delimiter. '' finds nothing.
  // Must not throw.
  export type IsOnPath = (program: string, path: string) => boolean;

  // ClaudeBackend
  startupWarning(env: Record<string, string | undefined>, isOnPath: IsOnPath): string | undefined;
  // cliBackend:  (env, isOnPath) => (isOnPath('claude', env.PATH ?? '') ? undefined : CLAUDE_NOT_FOUND_HELP)
  // apiBackend:  (env) => (env.ANTHROPIC_API_KEY ? undefined : MISSING_API_KEY_HELP)   // ignores isOnPath

  // StartOptions gains, required:
  isOnPath: IsOnPath;
  // startEngine: backend.startupWarning(process.env, isOnPath)

  // cli.ts
  isOnPath: (program, path) => Bun.which(program, { PATH: path }) !== null,
  ```

  - `EngineOptions` and `AgentOptions` do not gain it.
  - The Bun-specific comment about PATH caching moves to `cli.ts` with the call.
- **Rationale:**
  - Finding a program on `PATH` reads the disk outside the workspace. The engine must not do that (README;
    `boundary.test.ts`), so the host supplies the check.
  - Only `startEngine` calls `startupWarning`. The per-turn `claudeBackend` call in `agent.ts` never does, so
    threading `isOnPath` through `AgentOptions` would carry it somewhere that never uses it.
  - The warning text stays in `claude-backend.ts`, the one place that knows the modes.
- **Evidence:**
  - [C-11](current-state-findings.md#c-11-bunwhich-decides-the-cli-mode-startup-warning-the-engine-reads-processenv-to-feed-it)
  - [C-12](current-state-findings.md#c-12-options-flow-cli--startenginecreateengine--sessions--agentsettings--claudebackend-as-one-object)
  - software-architect A7
- **Behavior impact:** Preserving. The same lookup runs on the same `PATH`, and an empty `PATH` still finds nothing.
- **Rejected alternatives:**
  - Move the whole startup warning into cli. Rejected because cli would then have to know which modes exist.
  - Have the engine scan `PATH` itself with `node:fs`. Rejected because the engine may not touch the disk outside the
    file-system package.
  - Add `isOnPath` to a grouped `Runtime` object. Rejected for the same reason as in D-3.
- **Revisit criterion:** A second startup check needs host services.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12, S-13
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-12, S-13)

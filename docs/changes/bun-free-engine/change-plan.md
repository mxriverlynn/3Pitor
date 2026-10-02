# Change Plan: Bun-free engine

## Why This Change

The operator wants to reuse the engine outside the Bun runtime. In their words: "remove all bun specific code from the
'engine' package, and put it into a different package … the goal, though, is to be able to re-use the engine outside
of the bun runtime." This is a **constraint arriving**: a second runtime the current structure cannot absorb. The
boundary is recorded in [artifacts/scope-boundary.md](artifacts/scope-boundary.md). It covers the engine's production
code and the file-system package's pattern matcher, which becomes a `FileSystem` method. Engine tests stay on Bun.

## What Changes, In One Paragraph

After the change, the engine's production code uses only what Bun and Node both provide, and it loads and runs under
Node 22:

- It starts `claude` through `node:child_process`.
- It parses frontmatter with the npm `yaml` package.
- It carries its system prompt as a TypeScript module.
- It matches file patterns by asking its `FileSystem`.

The engine gets two new inputs from its host: the app's skill files, as data, and a check for whether a program is on
the `PATH`. The Bun-only code that locates and embeds files from the app's own source tree moves to a new leaf package,
`src/app-files/`. That code is `import.meta.dir` and the skills macro. cli stays where everything is wired together,
and it passes `Bun.which` in directly. Two checks in `make test` keep the engine Bun-free: a source scan and a Node
load check.

## Current State

The package graph is clean and acyclic. The engine already receives its file system and its tool server from cli
([C-1](artifacts/current-state-findings.md#c-1-package-direction-is-clean-and-acyclic-the-engine-already-takes-injected-collaborators)).
Eight places in engine production code use something only Bun provides
([C-2](artifacts/current-state-findings.md#c-2-inventory-of-bun-specific-code-in-engine-production-files)). They fail
in two different ways under Node.

**At load time.** These stop the whole engine from loading:

- the skills macro import;
- the `.md` text import of the system prompt;
- `import.meta.dir` in `paths.ts`
  ([C-3](artifacts/current-state-findings.md#c-3-three-of-the-sites-fail-at-module-load-under-node-not-at-call-time)).

So does one non-Bun cause outside the engine. The file-system entry re-exports a module that imports `exists` from
`node:fs/promises`, an export only Bun has
([C-13](artifacts/current-state-findings.md#c-13-loading-the-file-system-entry-under-node-fails-so-the-engine-fails-to-load-even-with-its-own-bun-code-gone)).

**At call time.** These fail only when the code runs:

- `Bun.spawn` runs `claude`
  ([C-6](artifacts/current-state-findings.md#c-6-claude-clits-uses-four-members-of-the-bun-child-process-and-relies-on-spawn-throwing-enoent-synchronously)).
- `Bun.which` decides the startup warning
  ([C-11](artifacts/current-state-findings.md#c-11-bunwhich-decides-the-cli-mode-startup-warning-the-engine-reads-processenv-to-feed-it)).
- `Bun.YAML.parse` reads frontmatter. On Node its failure is swallowed, so every skill and agent would silently vanish
  ([C-8](artifacts/current-state-findings.md#c-8-bunyamlparse-reads-skill-and-agent-frontmatter-no-yaml-library-is-installed)).
- `Bun.Glob` is reached through the file-system package's `glob` function
  ([C-4](artifacts/current-state-findings.md#c-4-glob-is-a-free-function-over-filesystem-only-its-per-segment-match-uses-bun)).

The app's skills come from a module-level constant the macro fills at build time, and two features read it directly
([C-10](artifacts/current-state-findings.md#c-10-app-skills-are-embedded-by-a-bun-macro-into-a-module-level-constant-that-two-features-read-directly)).
Nothing checks that the engine is Bun-free. The type checker accepts `Bun.*` everywhere, and `boundary.test.ts` matches
only three Bun file APIs
([C-16](artifacts/current-state-findings.md#c-16-nothing-checks-that-the-engine-is-bun-free)).

The structural property this change addresses is that the engine depends on its runtime directly. It should depend
only on APIs both runtimes share, plus inputs its host passes in.

## Target State

### The engine (`src/engine/`)

The engine is answerable for everything it did before. Its production code uses no `Bun.*` API, no `bun` or `bun:*`
import, no import attributes, and no Bun-only `import.meta` field. It never imports `src/app-files/`.

**Running `claude`.** `claude-cli.ts` spawns `claude` with `node:child_process`. Its callers see the same contract as
today. A missing `claude` rejects with `CLAUDE_NOT_FOUND_HELP` before any stream exists. Cleanup is idempotent. A stop
the reader asks for produces no error. The lifecycle order is pinned in
([D-4](artifacts/change-decision-log.md#d-4-the-lifecycle-and-error-contract-of-the-claude-child-process)):

1. Spawn, with a synchronous `try`.
2. Attach the abort listener at once, before any `await`.
3. `await once(child, 'spawn')`, so Node's async ENOENT rejects at the same point.
4. Handle later `'error'` events as error parts. Swallow stdin EPIPE. Write stdin in full and end it.
5. Read stdout and stderr through `Readable.toWeb`. Wait on `'close'`.
6. Report a non-zero end with no `finish` part as `claude exited with code N: …`, or as
   `claude exited with signal SIG…: …` when the code is `null`.

No spawn function is injected
([D-3](artifacts/change-decision-log.md#d-3-the-engine-runs-claude-through-nodechild_process-with-no-injected-spawn)).

**Frontmatter.** `parseFrontmatter` calls `parse(text, { uniqueKeys: false })` from the npm `yaml` package. Its
`undefined`-on-error behavior and its `{}` fallback for scalars are unchanged
([D-5](artifacts/change-decision-log.md#d-5-yaml-frontmatter-is-parsed-with-the-npm-yaml-package-with-duplicate-keys-allowed)).

**System prompt.** `chat/agent/system-prompt.ts` exports `SYSTEM_PROMPT`, the exact former text of `system-prompt.md`
with four escaped backticks. `system-prompt.md` and `text-imports.d.ts` no longer exist
([D-6](artifacts/change-decision-log.md#d-6-the-system-prompt-becomes-a-typescript-module-inside-the-engine)).

**Inputs from the host.** The engine takes two new inputs:

```ts
// engine/workspace-config/workspace-config.ts; re-exported as a type from engine/engine.ts
// Each app skill file's full text, keyed by its '/'-separated path under the skills folder: no leading '/', no '..'
// segments, hidden names excluded. Example: { 'collaborative-editing/SKILL.md': '---\nname: collaborative-editing\n...' }
export type AppSkillFiles = Readonly<Record<string, string>>;

// engine/chat/claude-backend/claude-backend.ts; re-exported as a type from engine/engine.ts
// Whether an executable named `program` is on `path`, a list joined by the platform's delimiter. '' finds nothing.
// Must not throw.
export type IsOnPath = (program: string, path: string) => boolean;

export interface EngineOptions {      // and AgentOptions / SessionsOptions, through which it flows
  fileSystem: FileSystem;
  appSkillFiles: AppSkillFiles;       // new, required
  model?: string;
  claude: ClaudeMode;
  maxSteps?: number;
  serveTools: ServeTools;
}

export interface StartOptions {
  fileSystem: FileSystem;
  appSkillFiles: AppSkillFiles;       // new, required
  isOnPath: IsOnPath;                 // new, required; used once, for the startup warning
  claude: ClaudeMode;
  model?: string;
  serveTools: ServeTools;
}
```

`appSkillFiles` reaches `loadWorkspaceConfig` and the Read tool through the options object
([D-2](artifacts/change-decision-log.md#d-2-a-new-leaf-package-srcapp-files-owns-pathsts-and-the-app-skills-macro-the-engine-receives-appskillfiles)).
`isOnPath` reaches only `startupWarning`
([D-9](artifacts/change-decision-log.md#d-9-the-claude-on-path-check-is-injected-as-isonpath-on-startoptions-only-and-cli-passes-bunwhich)).

**Pattern matching.** The engine calls `fileSystem.glob(...)` and imports no `glob` function
([D-1](artifacts/change-decision-log.md#d-1-glob-becomes-a-method-on-the-filesystem-contract)).

**What the engine does not own.** It no longer owns the location of `src/`, the workspace fixture, how app skills are
embedded, or how a program is looked up on `PATH`.

### The file-system package (`src/file-system/`)

`FileSystem` gains `glob`, with this contract
([D-1](artifacts/change-decision-log.md#d-1-glob-becomes-a-method-on-the-filesystem-contract)):

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

- `glob('**/*.md')` → `notes.md`, `drafts/a.md`.
- `glob('.claude/skills/*/SKILL.md', { dot: true })` → `.claude/skills/doc-stats/SKILL.md`.

Inside the package:

- `glob/glob.ts` is the walker. Only package code imports it, and it takes `Pick<FileSystem, 'list'>`. It still uses
  `Bun.Glob` for single segments. `createLocalFileSystem` implements `glob` by calling it.
- The entry module no longer exports `glob`.
- The entry module loads on Node, because `workspace.ts` defines `exists` from `stat`
  ([D-7](artifacts/change-decision-log.md#d-7-fix-the-one-node-load-failure-in-the-file-system-entry-leave-the-local-backends-call-time-bun-use)).
- The local backend still uses `Bun.write` and `Bun.Glob` when called, so it remains a Bun backend.

### The app-files package (`src/app-files/`), new

It is answerable for finding and embedding files from the app's own source tree, and nothing else. Its files:

- `paths.ts`: `SRC` and `WORKSPACE_FIXTURE`, unchanged. It must sit directly under `src/app-files/`, and
  `paths.test.ts` moves with it and enforces this.
- `app-skills.macro.ts`: the Bun macro, unchanged, still reading `src/skills/**/*.md`.
- `app-files.ts`: the entry. It exports `APP_SKILL_FILES: AppSkillFiles` (the macro's result), `SRC`, and
  `WORKSPACE_FIXTURE`.

Its import rules:

- It imports one thing from another package: the `AppSkillFiles` type, from `engine/engine.ts`.
- In production, cli and `server/scripts/check.ts` import it. Tests may import it.
- The engine's production code never does.

### cli (`src/cli/cli.ts`)

cli wires everything together. It passes `appSkillFiles: APP_SKILL_FILES` and
`isOnPath: (program, path) => Bun.which(program, { PATH: path }) !== null` to `startEngine`. It imports
`WORKSPACE_FIXTURE` from app-files.

### Checks

These checks keep the engine Bun-free
([D-8](artifacts/change-decision-log.md#d-8-prove-the-engine-is-bun-free-with-a-source-scan-and-a-node-load-check-both-in-make-test)):

- `src/engine/bun-free.test.ts` scans engine production files for Bun-only code, with five named test helpers exempt.
- `make check-node` loads `engine.ts` under Node with a resolve hook that adds `.ts`. `make test` runs it.

## Surface Delta

### S-1: `FileSystem.glob` — Added

**Target state.** `FileSystem` has a `glob(pattern, options?)` method returning the matching file keys in no order,
under the contract and worked example in Target State. `createLocalFileSystem` implements it by walking itself with the
package's internal walker.

**Behavior.** Preserving. The local backend's method runs the same walker that `glob(fileSystem, …)` runs today, so it
returns the same keys for the same pattern. `glob.test.ts` keeps pinning that against `Bun.Glob.scan`.

**Why.** The operator's instruction to make the matcher a method, and C-4.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-glob-becomes-a-method-on-the-filesystem-contract)

### S-2: `glob` export from `file-system/file-system.ts` — Removed

**Target state.** The file-system entry does not export a `glob` function. `glob/glob.ts` is a walker that only code
inside `src/file-system/` imports, and it takes `Pick<FileSystem, 'list'>`. Pattern matching for any caller outside the
package is `FileSystem.glob`. `boundary.test.ts`'s `ENGINE_CONTRACT` does not list `'glob'`.

**Behavior.** Preserving. The two engine callers make the same match through the method and keep their `.sort()`
([C-5](artifacts/current-state-findings.md#c-5-the-engine-calls-glob-in-exactly-two-places-each-already-holding-a-filesystem)).

**Why.** Once the method exists, the free function exported to the engine is a second way to do the same thing, and
the path through which `Bun.Glob` reaches the engine.

**Depends on.** S-1.

**Migration.** `glob(fileSystem, pattern, options)` becomes `fileSystem.glob(pattern, options)` in
`workspace-config.ts` and `tools.ts`.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-glob-becomes-a-method-on-the-filesystem-contract)

### S-3: `file-system/file-system.ts` load graph — Re-scoped

**Target state.** Importing the file-system entry module succeeds on Node 22 as well as on Bun.
`local/workspace/workspace.ts` defines `exists` locally from `stat`, and imports nothing that only Bun provides. The
local backend's `Bun.write` and `Bun.Glob` calls remain, and run only when called.

**Behavior.** Preserving. `exists(path)` answers true when `stat` succeeds and false otherwise, which is the answer the
Bun export gave. `chooseWorkspace` and `resetWorkspace` behave the same.

**Why.** C-13: the engine imports runtime values from this entry, so the engine cannot load on Node until the entry
can.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-fix-the-one-node-load-failure-in-the-file-system-entry-leave-the-local-backends-call-time-bun-use)

### S-4: `parseFrontmatter` — Re-scoped

**Target state.** `parseFrontmatter` parses the frontmatter block with `parse(text, { uniqueKeys: false })` from the
npm `yaml` package. `yaml` is in `package.json` `dependencies` at an exact version. A parse error still returns
`undefined`. A null, scalar, or empty result still becomes `{}`. A duplicated key takes its last value.

**Behavior.** Unknown, settled as Preserving under test. The frontmatter in use is plain scalars, quoted strings, and
folded block scalars. `workspace-config.test.ts` pins the error case and every app-skill description. If a test fails,
the parse options change; the test does not.

**Why.** C-8. `Bun.YAML` does not exist on Node, and its failure there is silent.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-yaml-frontmatter-is-parsed-with-the-npm-yaml-package-with-duplicate-keys-allowed)

### S-5: The system prompt, `system-prompt.md` → `SYSTEM_PROMPT` in `system-prompt.ts` — Moved

**Target state.** The chat's fixed instructions are `SYSTEM_PROMPT`, exported from
`src/engine/chat/agent/system-prompt.ts`. It holds the exact text `system-prompt.md` held. `agent.ts` sends
`SYSTEM_PROMPT.trimEnd()` as the first, cache-marked system message. `system-prompt.md` and
`src/engine/text-imports.d.ts` do not exist.

**Behavior.** Preserving. The model receives the same bytes. The unit asserts `SYSTEM_PROMPT` equals the `.md` text
before deleting the `.md`.

**Why.** C-3 and C-9: Node cannot load a text import, and the prompt belongs to the engine.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-the-system-prompt-becomes-a-typescript-module-inside-the-engine)

### S-6: `src/app-files/` package — Added

**Target state.** `src/app-files/` exists, and its entry is `app-files.ts`. It owns locating and embedding files from
the app's own source tree: `SRC`, `WORKSPACE_FIXTURE`, and `APP_SKILL_FILES`. It imports one thing from another
package: the `AppSkillFiles` type, from `engine/engine.ts`. In production, cli and `server/scripts/check.ts` import it;
tests may too. Engine production code never imports it.

**Behavior.** Preserving. It is a new home for existing code.

**Why.** C-14 and C-15. The macro and `import.meta.dir` need a home that cli and the server's check script can both
import, and that is not the engine.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-new-leaf-package-srcapp-files-owns-pathsts-and-the-app-skills-macro-the-engine-receives-appskillfiles)

### S-7: `paths.ts` — Moved

**Target state.** `src/app-files/paths.ts` exports `SRC`, the absolute path of `src/`, and `WORKSPACE_FIXTURE`, both
computed as today. It sits directly under `src/app-files/`. `src/app-files/paths.test.ts` fails if it moves.
`src/engine/paths.ts` does not exist.

**Behavior.** Preserving. Both values name the same folders, because `src/app-files/` is at the same depth as
`src/engine/`.

**Why.** C-3 and C-14: `import.meta.dir` is Bun-only, and the engine never used either value itself.

**Depends on.** S-6.

**Migration.** Imports of `engine/paths` become `app-files/app-files`. That covers `check.ts` and the tests
`workspace-config.test.ts`, `agent.test.ts`, and `workspace-config.routes.test.ts`.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-new-leaf-package-srcapp-files-owns-pathsts-and-the-app-skills-macro-the-engine-receives-appskillfiles)

### S-8: `app-skills.macro.ts` and `APP_SKILL_FILES` — Moved

**Target state.** `src/app-files/app-skills.macro.ts` is the Bun macro. It returns every non-hidden `.md` file under
`src/skills/`, keyed by its sorted relative path. `src/app-files/app-files.ts` imports it with
`{ type: 'macro' }` and exports the result as `APP_SKILL_FILES: AppSkillFiles`. No engine module holds or exports
`APP_SKILL_FILES`. The first `FS_EXEMPT` entry in `boundary.test.ts` names `src/app-files/app-skills.macro.ts`.

**Behavior.** Preserving. The same macro embeds the same files into the binary that `cli.ts` is built from.
`make check-build` confirms the binary still lists `collaborative-editing`.

**Why.** C-10: the macro is Bun-only, and the embedded files are app content the host decides to ship.

**Depends on.** S-6, S-7, S-10.

**Migration.** Tests that imported `APP_SKILL_FILES` from `engine/workspace-config/workspace-config` import it from
`app-files/app-files`.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-new-leaf-package-srcapp-files-owns-pathsts-and-the-app-skills-macro-the-engine-receives-appskillfiles)

### S-9: `WORKSPACE_FIXTURE` re-export from `engine/engine.ts` — Removed

**Target state.** `engine/engine.ts` does not export `WORKSPACE_FIXTURE`. The workspace fixture's location is
`app-files`'s responsibility, and cli and `check.ts` read it from there.

**Behavior.** Preserving. cli seeds the same folder.

**Why.** C-14: the engine only passed this value through.

**Depends on.** S-7.

**Migration.** `cli.ts` and `check.ts` import `WORKSPACE_FIXTURE` from `app-files/app-files`.

**Decision.** [D-10](artifacts/change-decision-log.md#trivial-decisions)

### S-10: `AppSkillFiles` and the `appSkillFiles` option — Added

**Target state.** `AppSkillFiles` (`Readonly<Record<string, string>>`, keyed as Target State pins) is exported from
`workspace-config.ts` and re-exported as a type from `engine.ts`. `AgentOptions` has a required `appSkillFiles`, and so
`SessionsOptions` and `EngineOptions` do too. `StartOptions` also has a required `appSkillFiles`.

**Behavior.** Preserving. cli passes the same map the module-level constant held.

**Why.** C-10 and C-12: the app's skills must reach the engine without a build-time import, and every reader already
receives the options object.

**Migration.** Every `createEngine`, `startEngine`, `agentSettings`, and `Sessions` construction passes
`appSkillFiles`. In production that is `cli.ts`, and tests pass `APP_SKILL_FILES` from app-files.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-new-leaf-package-srcapp-files-owns-pathsts-and-the-app-skills-macro-the-engine-receives-appskillfiles)

### S-11: `loadWorkspaceConfig`, `appSkillText`, and `fileTools` — Re-scoped

**Target state.** These three serve the app's skills from a map they are handed. None of them reads a module-level
constant.

- `loadWorkspaceConfig(fileSystem, appSkillFiles)` lists app skills from the map it is handed.
- `appSkillText(appSkillFiles, filePath)` serves `3pitor://skills/…` from the map it is handed, with unchanged throw
  rules.
- `fileTools(fileSystem, turn, onChange?, appSkillFiles = {})`'s Read tool resolves `3pitor://skills/…` through
  `appSkillText` with that map.
- `agentSettings` passes `options.appSkillFiles` to both. `engine.ts`'s `workspaceConfig.names()` passes it to
  `loadWorkspaceConfig`.

**Behavior.** Preserving on every production path, because cli always supplies the map. A direct `fileTools` call
without the map, which only tests make, finds no app skill files.

**Why.** C-10: two features read the constant directly, with no seam.

**Depends on.** S-10.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-new-leaf-package-srcapp-files-owns-pathsts-and-the-app-skills-macro-the-engine-receives-appskillfiles)

### S-12: `IsOnPath` and `StartOptions.isOnPath` — Added

**Target state.** `IsOnPath` is `(program: string, path: string) => boolean`, as pinned in Target State, and is
exported from `claude-backend.ts` and re-exported as a type from `engine.ts`. `StartOptions` has a required `isOnPath`.
`startEngine` passes it to `startupWarning`. cli supplies
`(program, path) => Bun.which(program, { PATH: path }) !== null`, along with the comment explaining why the lookup takes
an explicit `PATH`. `EngineOptions` and `AgentOptions` do not have it.

**Behavior.** Preserving. The same Bun lookup runs on the same `PATH`.

**Why.** C-11: the engine may not scan the disk for a program, so its host does.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-claude-on-path-check-is-injected-as-isonpath-on-startoptions-only-and-cli-passes-bunwhich)

### S-13: `ClaudeBackend.startupWarning` — Re-scoped

**Target state.** `startupWarning(env, isOnPath)` decides the startup warning from the environment and a lookup it is
handed:

- The CLI backend warns with `CLAUDE_NOT_FOUND_HELP` unless `isOnPath('claude', env.PATH ?? '')`.
- The API backend ignores `isOnPath` and warns with `MISSING_API_KEY_HELP` when `ANTHROPIC_API_KEY` is unset.

**Behavior.** Preserving. The same text is printed under the same conditions.

**Depends on.** S-12.

**Migration.** `claude-backend.test.ts` calls pass a lookup, for example one built on `Bun.which`.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-claude-on-path-check-is-injected-as-isonpath-on-startoptions-only-and-cli-passes-bunwhich)

### S-14: `claudeCliModel`'s child process — Re-scoped

**Target state.** `claudeCliModel` runs `claude` with `spawn` from `node:child_process`, following the lifecycle
pinned in [D-4](artifacts/change-decision-log.md#d-4-the-lifecycle-and-error-contract-of-the-claude-child-process). A
missing `claude` rejects `doStream` with `Error(CLAUDE_NOT_FOUND_HELP)` before any stream is returned, and stops the
tool endpoint once. An abort at any point kills the child and stops the endpoint. A non-zero end with no `finish` part
is an error part:

- `claude exited with code N: <last stderr line>`, or
- `claude exited with signal SIGNAME: <last stderr line>` when there is no exit code.

A child-process `'error'` after startup is an error part.

**Behavior.** Changing, and narrowly so. See Behavior Changes. Arguments, environment, working folder, stdin text,
the stream parsing, and the not-found path are all unchanged.

**Why.** C-6 and C-7: `Bun.spawn` is Bun-only, and Node reports ENOENT asynchronously.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-engine-runs-claude-through-nodechild_process-with-no-injected-spawn),
[D-4](artifacts/change-decision-log.md#d-4-the-lifecycle-and-error-contract-of-the-claude-child-process)

### S-15: `src/engine/bun-free.test.ts` — Added

**Target state.** A `bun:test` file fails when any engine `.ts` file contains one of the patterns pinned in D-8: a
`Bun.` API, a `bun` or `bun:*` import, an import attribute, a Bun-only `import.meta` field, or an `app-files/` import.
The scan skips `*.test.ts` files and the five named test helpers in `chat/components/`. It also fails when an exemption
names a file that does not exist, and it proves its patterns against planted lines.

**Behavior.** Preserving. It adds a check and changes no runtime behavior.

**Why.** C-16: today nothing catches a Bun API creeping back into the engine.

**Depends on.** S-2, S-4, S-5, S-8, S-11, S-13, S-14. It passes only once all of them have landed.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-prove-the-engine-is-bun-free-with-a-source-scan-and-a-node-load-check-both-in-make-test)

### S-16: `make check-node` and `src/engine/node-load-check.mjs` — Added

**Target state.** `make check-node` runs `node --experimental-transform-types src/engine/node-load-check.mjs`. That
script registers a resolve hook that retries a relative specifier with `.ts`, then imports `./engine.ts`. It exits 0
when the import succeeds and non-zero otherwise. `make test` runs `check-node` beside `typecheck`, so `make test` needs
Node 22.15 or later.

**Behavior.** Changing, for developers only. See Behavior Changes.

**Why.** C-13 and C-3: load failures that are not Bun APIs are invisible to a source scan.

**Depends on.** S-3, S-5, S-7, S-8.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-prove-the-engine-is-bun-free-with-a-source-scan-and-a-node-load-check-both-in-make-test)

### S-17: README package rules — Re-scoped

**Target state.** The README's package list:

- names `src/app-files/`, what it owns, and its import rules;
- states that engine production code uses no Bun-only API, import, import attribute, or `import.meta` field;
- names the two checks that enforce this;
- describes `FileSystem.glob` in place of the exported `glob` function.

Its per-file descriptions of `paths.ts`, `app-skills.macro.ts`, `system-prompt.md`, and `text-imports.d.ts` match
where those things now live, or are removed.

**Behavior.** Preserving. Documentation only.

**Depends on.** All other entries.

**Decision.** [D-12](artifacts/change-decision-log.md#trivial-decisions)

## Behavior Changes

These are what a person could notice. Each was decided without asking the operator, under their standing guidance for
planning runs.

1. **A `claude` killed from outside 3pitor shows a different error line** (S-14). A reply that ends because something
   outside 3pitor killed `claude` shows `claude exited with signal SIGTERM: …` in the chat. Before, it showed
   `claude exited with code …: …`. The person who sees it is the chat user in CLI mode. Decision: accept it, because
   the new line names what happened
   ([D-4](artifacts/change-decision-log.md#d-4-the-lifecycle-and-error-contract-of-the-claude-child-process)). Stopping
   a reply from the chat is unaffected.
2. **A rare process error now shows as a chat error** (S-14). If the operating system reports a failure from the
   `claude` process after it has started, the reply ends with that error instead of the failure going unhandled.
   Decision: accept it
   ([D-4](artifacts/change-decision-log.md#d-4-the-lifecycle-and-error-contract-of-the-claude-child-process)).
3. **Skill frontmatter is read by a different YAML parser** (S-4). For every skill and agent file in the repository
   today, the result is the same, and the tests check it. A skill file using unusual YAML might now be read differently
   or skipped. One known difference runs the other way: a file that repeats a key keeps its last value instead of
   possibly being skipped. Decision: accept it, and treat a failing test as a reason to adjust the parser, not the test
   ([D-5](artifacts/change-decision-log.md#d-5-yaml-frontmatter-is-parsed-with-the-npm-yaml-package-with-duplicate-keys-allowed)).
4. **`make test` needs Node 22.15 or later on the developer's machine** (S-16). Developers notice this. People using
   the app do not, and the release build does not run `make test`. Decision: accept it, so a regression fails the
   normal test run
   ([D-8](artifacts/change-decision-log.md#d-8-prove-the-engine-is-bun-free-with-a-source-scan-and-a-node-load-check-both-in-make-test)).

Every other entry is behavior-preserving.

## Change Units

Each unit leaves `make test` passing. Units 1 to 8 touch different files, and their order is a suggestion except where
a constraint is stated. Unit 9 comes last.

### Unit 1: The file-system entry loads on Node

**What it does.** Replaces the Bun-only `exists` import in `workspace.ts` with a local helper built on `stat`.

**Delta entries.** S-3.

**How you know it worked.** The `workspace.test.ts` tests pass.
`node -e "import('node:fs/promises').then(m => console.log('exists' in m))"` still prints `false`, and nothing imports
`exists` from it any more.

### Unit 2: `glob` becomes a `FileSystem` method

**What it does.**

- Adds `glob` to the `FileSystem` interface and implements it in `createLocalFileSystem` over the walker.
- Narrows the walker's parameter to `Pick<FileSystem, 'list'>`.
- Removes the `glob` export from the entry and `'glob'` from `ENGINE_CONTRACT`.
- Switches the two engine call sites to `fileSystem.glob(...)`.

**Delta entries.** S-1, S-2.

**How you know it worked.** `glob.test.ts`, `local-file-system.test.ts`, `boundary.test.ts`, `workspace-config.test.ts`,
and the `Glob` tool tests in `tools.test.ts` pass. A grep for `glob(` imports from `file-system/file-system` outside the
package finds none.

### Unit 3: Frontmatter through the npm `yaml` package

**What it does.** Adds `yaml` at an exact version, and swaps `Bun.YAML.parse` for `parse(…, { uniqueKeys: false })`.

**Delta entries.** S-4.

**How you know it worked.** `workspace-config.test.ts` passes unchanged, including the `[unclosed` cases and the full
app-skill descriptions. So do `agent.test.ts` and `workspace-config.routes.test.ts`.

### Unit 4: The system prompt as a TypeScript module

**What it does.**

- Adds `system-prompt.ts` with `SYSTEM_PROMPT`.
- Asserts once that it equals the `.md` text, then deletes `system-prompt.md` and `text-imports.d.ts`.
- Points `agent.ts` and `agent.test.ts` at `SYSTEM_PROMPT`.

**Delta entries.** S-5.

**How you know it worked.** The equality assertion passes before the `.md` is deleted. After that, `agent.test.ts` and
`tsc` pass with no `*.md` module declaration.

### Unit 5: The app-files package, with `paths.ts`

**What it does.**

- Creates `src/app-files/` with `paths.ts` and its test, and an `app-files.ts` entry that re-exports `SRC` and
  `WORKSPACE_FIXTURE`.
- Points `cli.ts`, `check.ts`, and the tests at it.
- Drops the engine's `WORKSPACE_FIXTURE` re-export.
- For this unit only, the engine's macro imports `SRC` from `../../app-files/paths`. Unit 6 removes that import.

**Delta entries.** S-6, S-7, S-9.

**How you know it worked.** `app-files/paths.test.ts` passes. `src/engine/paths.ts` is gone. `bun run server` still
seeds its dev workspace from the fixture.

### Unit 6: App skills arrive as `appSkillFiles`

**What it does.**

- Moves the macro to app-files and exports `APP_SKILL_FILES` from the app-files entry.
- Adds `AppSkillFiles` and the required `appSkillFiles` option.
- Threads the option to `loadWorkspaceConfig`, `appSkillText`, and `fileTools`.
- cli passes it, and every test construction site passes it.
- Updates `FS_EXEMPT`.

**Delta entries.** S-8, S-10, S-11.

**Ordering constraint.** After Unit 5, because the macro and the entry need `paths.ts` in app-files.

**How you know it worked.** `make test` passes, and `make check-build` passes, so the binary still lists
`collaborative-editing`. `workspace-config.test.ts`'s comparison of `APP_SKILL_FILES` with `src/skills/` on disk passes
from its new import.

### Unit 7: `isOnPath` from the host

**What it does.**

- Adds `IsOnPath` and the required `StartOptions.isOnPath`.
- Changes `startupWarning` to take the lookup.
- Moves `Bun.which` into `cli.ts`.
- Updates `claude-backend.test.ts`.

**Delta entries.** S-12, S-13.

**How you know it worked.** `claude-backend.test.ts` passes. Starting with `ANTHROPIC_API_KEY` unset and `claude` off
the `PATH` still prints the CLI-mode warning.

### Unit 8: `claude` through `node:child_process`

**What it does.** Rewrites the process part of `runClaude` to the lifecycle in D-4.

**Delta entries.** S-14.

**How you know it worked.** `claude-cli.test.ts`, `claude-backend.test.ts`, `sessions.test.ts`, and the server's
`mcp-endpoint.test.ts` pass with the fake `claude`. Those tests cover not-found, a non-zero exit, a stop mid-reply, and
tools.

### Unit 9: The checks, and the README

**What it does.** Adds `bun-free.test.ts`, `node-load-check.mjs`, and the `check-node` target, wired into `test`.
Updates the README.

**Delta entries.** S-15, S-16, S-17.

**Ordering constraint.** Last. The scan passes only after Units 2, 3, 4, 6, 7, and 8. The load check passes only after
Units 1, 4, 5, and 6.

**How you know it worked.** `make test` passes. Planting `Bun.sleep(1)` in any engine production file fails
`bun-free.test.ts`. Re-adding the `exists` import fails `make check-node`.

## Risks

- **Bun's `node:child_process` behaves differently from Node's** (Unit 8). It may differ in ENOENT timing,
  `Readable.toWeb`, or `'close'` ordering. Detect: the fake-`claude` tests run on Bun. If one fails, the D-4 order is
  what to adjust. Blast radius: CLI-mode chat.
- **The `yaml` parser and `Bun.YAML` disagree on some file** (Unit 3). Detect: `workspace-config.test.ts` compares
  every app skill's parsed description. Blast radius: which skills and agents are listed.
- **The macro stops embedding after it moves** (Unit 6). Detect: `make check-build`, which `make test` does not run.
  Run it in this unit. Blast radius: the shipped binary would list no app skills.
- **A test construction site is missed** when `appSkillFiles` becomes required (Unit 6). Detect: `tsc` in `make test`
  fails on it. Blast radius: none at runtime.
- **The Node load check relies on experimental Node flags** (Unit 9), which may change in a later Node. Detect:
  `make check-node` fails on a Node upgrade. Blast radius: the developer test run only.

## Deferred (YAGNI)

- **A grouped `Runtime` or `Host` options object.** Its proposed members were spawn, which, and parseYaml. Two need no
  injection (D-3, D-5), and what remains is two inputs with different lifetimes. Reopen when a third host-provided
  capability lands.
- **An injected spawn function.** It would have one implementation shape. Reopen when a named host lacks
  `node:child_process`, such as a browser or an edge worker.
- **A logger seam**
  ([C-17](artifacts/current-state-findings.md#c-17-engine-logging-goes-straight-to-console-it-runs-on-node-and-has-no-seam)).
  `console` works on Node. Reopen when a host needs engine output somewhere other than the console.
- **A separate engine `tsconfig` with Node types.** The scan covers the same ground without excluding the file-system
  graph. Reopen if the scan proves too coarse.
- **An in-memory `FileSystem` serving app skills.** It has one use. Reopen when a host loads app skills from somewhere
  other than an embedded map.

## Cut for Scope

The operator can reinstate any of these. Their saying so is itself a valid justification, which the reinstated entry
records.

- **Making the local-disk file system run on Node.** This means replacing `Bun.write` in `local-file-system.ts` and
  `Bun.Glob` in the walker. It would let a Node host use `createLocalFileSystem` instead of bringing its own
  `FileSystem`. Cut because the boundary scopes file-system changes to the pattern matcher
  ([scope-boundary.md](artifacts/scope-boundary.md), Operator-Stated Scope). Only the one load-time fix the engine needs
  is kept (S-3).
- **Moving engine tests and test helpers off Bun.** This means `bun:test` imports, `Bun.file`, `Bun.sleep`, and the
  fake `claude`'s `Bun.stdin`. Cut because the operator said "the engine's tests are fine as bun-specific right now"
  ([scope-boundary.md](artifacts/scope-boundary.md)).

## Open Items

- **How another program actually consumes the engine** (non-blocking). The engine's relative imports have no file
  extension, and three classes use TypeScript constructor parameter properties. Plain Node therefore cannot import
  `engine.ts` directly, even after this change. A host must bundle it, or load it with a resolve hook and
  `--experimental-transform-types`, as the load check does. Options include publishing a built package, adding `.ts`
  extensions, or treating "the host bundles it" as the answer. That is a distribution decision this plan does not
  make. It is settled when the first real non-Bun host is named.

## Review Findings

_Pending the review round._

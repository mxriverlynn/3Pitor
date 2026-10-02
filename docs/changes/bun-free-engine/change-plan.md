# Change Plan: Bun-free engine

## Why This Change

The operator wants to reuse the engine outside the Bun runtime. In their words: "remove all bun specific code from the
'engine' package, and put it into a different package … the goal, though, is to be able to re-use the engine outside
of the bun runtime." This is a **constraint arriving**: a second runtime the current structure cannot absorb. The
boundary is recorded in [artifacts/scope-boundary.md](artifacts/scope-boundary.md). It covers the engine's production
code and the file-system package's pattern matcher, which becomes a `FileSystem` method. Engine tests stay on Bun.

The change is done when the engine's production code has no Bun-specific code and the engine loads and runs a chat
call on Node 22. A non-Bun host still brings its own versions of four inputs, which this plan names
([D-13](artifacts/change-decision-log.md#d-13-reuse-outside-bun-means-the-engine-loads-and-runs-on-node-with-its-host-supplying-four-inputs)).

## What Changes, In One Paragraph

After the change, the engine's production code uses only what Bun and Node both provide, and it loads and runs under
Node 22:

- It starts `claude` through `node:child_process`.
- It parses frontmatter with the npm `yaml` package.
- It carries its system prompt as a TypeScript module.
- It matches file patterns by asking its `FileSystem`.

The engine gets two new inputs from its host: the app's skill files, as data, and a check for whether a program is on
the `PATH`. The Bun-only code that locates and embeds files from the app's own source tree moves to a new leaf package
(one that imports no other package), `src/app-files/`. That code is `import.meta.dir` and the skills macro. cli stays where everything is wired together,
and it passes `Bun.which` in directly. Two checks in `make test` keep the engine Bun-free:

- a source scan;
- a Node check that loads the engine and runs `claude` through it.

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

One more cause sits outside the engine's own Bun code and also stops loading. The file-system entry re-exports a module that imports `exists` from
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

Two gaps in the tests matter for this change. No test pins the exact parsed text of the real skills' frontmatter. And
once the prompt test reads the same constant it checks, nothing pins the system prompt's bytes
([C-8](artifacts/current-state-findings.md#c-8-bunyamlparse-reads-skill-and-agent-frontmatter-no-yaml-library-is-installed),
[C-9](artifacts/current-state-findings.md#c-9-the-system-prompt-is-a-md-text-import-used-once-per-turn-as-the-cache-marked-first-system-message)).

Probes during review showed that `node:child_process` behaves the same on Bun and Node for every point the new process
code relies on
([C-18](artifacts/current-state-findings.md#c-18-runtime-probes-exists-bunyaml-and-nodechild_process-behave-as-the-plan-assumes-on-both-runtimes)).

The structural property this change addresses is that the engine depends on its runtime directly. It should depend
only on APIs both runtimes share, plus inputs its host passes in.

## Target State

### The engine (`src/engine/`)

The engine still does everything it did before. Its production code uses no `Bun.*` API, no `bun` or `bun:*`
import, no import attributes, and no Bun-only `import.meta` field. It never imports `src/app-files/`.

**Running `claude`.** `claude-cli.ts` spawns `claude` with `node:child_process`. Its callers see the same contract as
today:

- A missing `claude` rejects with `CLAUDE_NOT_FOUND_HELP` before any stream exists.
- Cleanup is idempotent.
- A stop the reader asks for produces no error.

[D-4](artifacts/change-decision-log.md#d-4-the-lifecycle-and-error-contract-of-the-claude-child-process) pins the
lifecycle order:

1. Spawn, inside a synchronous `try`.
2. Before any `await`, attach the abort listener and an end latch on `child.on('close')`. The latch is a record that
   `'close'` already fired, so the later wait cannot miss it. It is never `once(child, 'close')`.
3. `await once(child, 'spawn')`. On rejection, report a stop as the stop's reason, ENOENT as `CLAUDE_NOT_FOUND_HELP`,
   and anything else as itself.
4. Only then:
   - attach the `'error'` handler;
   - attach a stdin handler that ignores `EPIPE` and `ERR_STREAM_DESTROYED`;
   - write stdin in full and end it.
5. Read stdout and stderr through `Readable.toWeb`, and await the latch. The reading task's `.catch` turns any throw
   into an error part and cleans up.
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

`appSkillFiles` reaches `loadWorkspaceConfig` and the Read tool through the options object. `fileTools` takes it as a
required second parameter
([D-2](artifacts/change-decision-log.md#d-2-a-new-leaf-package-srcapp-files-owns-pathsts-and-the-app-skills-macro-the-engine-receives-appskillfiles)).
`isOnPath` reaches only `startupWarning`
([D-9](artifacts/change-decision-log.md#d-9-the-claude-on-path-check-is-injected-as-isonpath-on-startoptions-only-and-cli-passes-bunwhich)).

**Pattern matching.** The engine calls `fileSystem.glob(...)` and imports no `glob` function
([D-1](artifacts/change-decision-log.md#d-1-glob-becomes-a-method-on-the-filesystem-contract)).

**What the engine does not own.** It no longer owns the location of `src/`, the workspace fixture, how app skills are
embedded, or how a program is looked up on `PATH`.

### What a non-Bun host must provide

The host provides four inputs. 3pitor's own versions of three of them stay Bun-specific
([D-13](artifacts/change-decision-log.md#d-13-reuse-outside-bun-means-the-engine-loads-and-runs-on-node-with-its-host-supplying-four-inputs)):

| Input           | Contract                                | 3pitor's Bun host supplies it with                |
| --------------- | --------------------------------------- | ------------------------------------------------- |
| `fileSystem`    | `FileSystem`, including `glob`          | `createLocalFileSystem` (`Bun.write`, `Bun.Glob`) |
| `serveTools`    | `ServeTools` (unchanged)                | the server's MCP endpoint (`Bun.serve`)           |
| `isOnPath`      | `IsOnPath`, at start only               | `Bun.which`                                       |
| `appSkillFiles` | `AppSkillFiles`                         | the app-files macro                               |

The host also loads TypeScript whose relative imports have no extension, so it either bundles the engine or loads it
the way the Node check does (see Open Items).

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

- `glob/glob.ts` is the walker: it walks folders through `list` and matches one segment at a time. Only package code
  imports it, and it takes `Pick<FileSystem, 'list'>`. It still uses `Bun.Glob` for single segments. `createLocalFileSystem` implements `glob` by calling it.
- The entry module no longer exports `glob`.
- The entry module loads on Node, because `workspace.ts` defines `exists` from `stat`
  ([D-7](artifacts/change-decision-log.md#d-7-fix-the-one-node-load-failure-in-the-file-system-entry-leave-the-local-backends-call-time-bun-use)).
- The local backend still uses `Bun.write` and `Bun.Glob` when called, so it remains a Bun backend.

### The app-files package (`src/app-files/`), new

It owns finding and embedding files from the app's own source tree, and nothing else. Its files:

- `paths.ts`: `SRC` and `WORKSPACE_FIXTURE`, unchanged. It must sit directly under `src/app-files/`, and
  `paths.test.ts` moves with it and enforces this.
- `app-skills.macro.ts`: the Bun macro, unchanged, still reading `src/skills/**/*.md`.
- `app-files.ts`: the entry. It exports `APP_SKILL_FILES: Readonly<Record<string, string>>` (the macro's result),
  `SRC`, and `WORKSPACE_FIXTURE`.

Its import rules:

- It imports no other package.
- In production, cli and `server/scripts/check.ts` import it. Tests may import it.
- The engine's production code never does.

### cli (`src/cli/cli.ts`)

cli wires everything together. It passes `appSkillFiles: APP_SKILL_FILES` and
`isOnPath: (program, path) => Bun.which(program, { PATH: path }) !== null` to `startEngine`. It imports
`WORKSPACE_FIXTURE` from app-files.

### Checks

These checks keep the engine Bun-free
([D-8](artifacts/change-decision-log.md#d-8-prove-the-engine-is-bun-free-with-a-source-scan-and-a-node-load-check-both-in-make-test)).

- `src/engine/bun-free.test.ts` scans engine production files for Bun-only code. Five named test helpers are exempt.
- `make check-node` runs `src/engine/node-check.ts` under Node, through the `.ts`-resolving loader
  `scripts/node-ts.mjs`. It does three things:
  1. imports `engine.ts`;
  2. runs one `claude` call against the fake `claude` to `finish`;
  3. runs one call with an empty `PATH`, and expects `CLAUDE_NOT_FOUND_HELP`.

  `make test` runs it.

## Surface Delta

### S-1: `FileSystem.glob` — Added

**Target state.** `FileSystem` has a `glob(pattern, options?)` method returning the matching file keys in no order,
under the contract and worked example in Target State. `createLocalFileSystem` implements it by walking itself with the
package's internal walker.

**Behavior.** Preserving. The local backend's method runs the same walker that `glob(fileSystem, …)` runs today, so it
returns the same keys for the same pattern. `glob.test.ts` keeps pinning that against `Bun.Glob.scan`, and a new
`local-file-system.test.ts` case pins that the method returns what the walker returns.

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

**Behavior.** Preserving. The `stat`-based `exists` answers what Bun's export answered for an existing folder, a
broken symlink, a missing path, and unreadable paths
([C-18](artifacts/current-state-findings.md#c-18-runtime-probes-exists-bunyaml-and-nodechild_process-behave-as-the-plan-assumes-on-both-runtimes)).

**Why.** C-13: the engine imports runtime values from this entry, so the engine cannot load on Node until the entry
can.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-fix-the-one-node-load-failure-in-the-file-system-entry-leave-the-local-backends-call-time-bun-use)

### S-4: `parseFrontmatter` — Re-scoped

**Target state.** `parseFrontmatter` parses the frontmatter block with `parse(text, { uniqueKeys: false })` from the
npm `yaml` package. `yaml` is in `package.json` `dependencies` at an exact version. A parse error still returns
`undefined`. A null, scalar, or empty result still becomes `{}`. A duplicated key takes its last value, as it did
under `Bun.YAML`.

**Behavior.** Unknown, settled as Preserving under test. Before the swap, new tests pin against `Bun.YAML`:

- each real skill's exact parsed description;
- a double-quoted value;
- a duplicated key;
- the `{}` fallback.

The swap keeps them passing. If one fails, the parse options change; the test does not.

**Why.** C-8. `Bun.YAML` does not exist on Node, and its failure there is silent.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-yaml-frontmatter-is-parsed-with-the-npm-yaml-package-with-duplicate-keys-allowed)

### S-5: The system prompt, `system-prompt.md` → `SYSTEM_PROMPT` in `system-prompt.ts` — Moved

**Target state.** The chat's fixed instructions are `SYSTEM_PROMPT`, exported from
`src/engine/chat/agent/system-prompt.ts`. It holds the exact text `system-prompt.md` held. `agent.ts` sends
`SYSTEM_PROMPT.trimEnd()` as the first, cache-marked system message. `system-prompt.md` and
`src/engine/text-imports.d.ts` do not exist.

**Behavior.** Preserving. The model receives the same bytes. The unit proves it once against the `.md` text in git, and
a lasting test pins features of the prompt that an escaping mistake would break.

**Why.** C-3 and C-9: Node cannot load a text import, and the prompt belongs to the engine.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-the-system-prompt-becomes-a-typescript-module-inside-the-engine)

### S-6: `src/app-files/` package — Added

**Target state.** `src/app-files/` exists, and its entry is `app-files.ts`. It owns locating and embedding files from
the app's own source tree: `SRC`, `WORKSPACE_FIXTURE`, and `APP_SKILL_FILES`. It imports no other package. In
production, cli and `server/scripts/check.ts` import it; tests may too. Engine production code never imports it.

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
`{ type: 'macro' }` and exports the result as `APP_SKILL_FILES: Readonly<Record<string, string>>`. No engine module
holds or exports `APP_SKILL_FILES`. The first `FS_EXEMPT` entry in `boundary.test.ts` names
`src/app-files/app-skills.macro.ts`.

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
- `fileTools(fileSystem, appSkillFiles, turn, onChange?)` takes the map as a required second parameter. Its Read tool
  resolves `3pitor://skills/…` through `appSkillText`.
- `agentSettings` passes `options.appSkillFiles` to `loadWorkspaceConfig` and `fileTools`. `engine.ts`'s
  `workspaceConfig.names()` passes it to `loadWorkspaceConfig`.

**Behavior.** Preserving. Every caller supplies the same map the constant held, and a new test reads an app skill
through a whole engine turn to prove the map reaches the Read tool.

**Why.** C-10: two features read the constant directly, with no seam.

**Depends on.** S-10.

**Migration.** Direct `fileTools(fs, turn)` calls in tests become `fileTools(fs, APP_SKILL_FILES, turn)`, or pass
`{}` where the test does not read app skills.

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

**Migration.** `claude-backend.test.ts` passes a stub lookup and checks the arguments it receives.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-claude-on-path-check-is-injected-as-isonpath-on-startoptions-only-and-cli-passes-bunwhich)

### S-14: `claudeCliModel`'s child process — Re-scoped

**Target state.** `claudeCliModel` runs `claude` with `spawn` from `node:child_process`, following the lifecycle
pinned in [D-4](artifacts/change-decision-log.md#d-4-the-lifecycle-and-error-contract-of-the-claude-child-process).

- A missing `claude` rejects `doStream` with `Error(CLAUDE_NOT_FOUND_HELP)` before any stream is returned, and stops
  the tool endpoint once.
- A stop at any point kills the child, stops the endpoint, and adds no error part. A stop while `claude` is still
  starting rejects with the stop's reason.
- A non-zero end with no `finish` part is an error part:
  - `claude exited with code N: <last stderr line>`, or
  - `claude exited with signal SIGNAME: <last stderr line>` when there is no exit code.
- A child-process `'error'` after startup is an error part, and so is a stdin error other than `EPIPE` or
  `ERR_STREAM_DESTROYED`. So is a throw inside the reading task.
- The call always reaches cleanup. The end latch is attached before any `await`, so it cannot miss the child's
  `'close'`.

**Behavior.** Changing, and narrowly so. See Behavior Changes. Arguments, environment, working folder, stdin text,
the stream parsing, and the not-found path are all unchanged.

**Why.** C-6 and C-7: `Bun.spawn` is Bun-only, and Node reports ENOENT asynchronously.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-engine-runs-claude-through-nodechild_process-with-no-injected-spawn),
[D-4](artifacts/change-decision-log.md#d-4-the-lifecycle-and-error-contract-of-the-claude-child-process)

### S-15: `src/engine/bun-free.test.ts` — Added

**Target state.** A `bun:test` file fails when any engine `.ts` file contains one of the patterns pinned in D-8: a
`Bun.` API, a `bun` or `bun:*` import, an import attribute, a Bun-only `import.meta` field, or an `app-files/` import.
The scan skips `*.test.ts` files and the five named test helpers in `chat/components/`. It scans `node-check.ts` like
any other engine file, since that file runs on Node. The test also fails when an exemption names a file that does not
exist, and it proves its patterns against planted lines.

**Behavior.** Preserving. It adds a check and changes no runtime behavior.

**Why.** C-16: today nothing catches a Bun API creeping back into the engine.

**Depends on.** S-2, S-4, S-5, S-8, S-11, S-13, S-14. It passes only once all of them have landed.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-prove-the-engine-is-bun-free-with-a-source-scan-and-a-node-load-check-both-in-make-test)

### S-16: `make check-node`, `src/engine/node-check.ts`, and `scripts/node-ts.mjs` — Added

**Target state.** `scripts/node-ts.mjs` registers a `node:module` resolve hook that retries a relative specifier with
`.ts`. `make check-node` runs
`node --experimental-transform-types --import ./scripts/node-ts.mjs src/engine/node-check.ts`. That script:

1. imports `./engine.ts`;
2. runs one `claudeCliModel(...).doStream` to `finish` against the fake `claude`, on a temporary `PATH` that also holds
   the running `bun`;
3. runs one `doStream` with an empty `PATH`, and expects a rejection with `CLAUDE_NOT_FOUND_HELP`.

It exits non-zero on the first failure. `make test` runs `check-node` beside `typecheck`, so `make test` needs Node
22.15 or later.

**Behavior.** Changing, for developers only. See Behavior Changes.

**Why.** Load failures that are not Bun APIs are invisible to a source scan (C-3, C-13). This is also the one place the
D-4 lifecycle runs on Node.

**Depends on.** S-3, S-5, S-7, S-8, S-14.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-prove-the-engine-is-bun-free-with-a-source-scan-and-a-node-load-check-both-in-make-test)

### S-17: README package rules — Re-scoped

**Target state.** The README's package list:

- counts seven packages;
- names `src/app-files/`, what it owns, that it imports no package, and who imports it;
- states that engine production code uses no Bun-only API, import, import attribute, or `import.meta` field;
- names the two checks that enforce this, and the Node 22.15 prerequisite for `make test`;
- describes `FileSystem.glob` in place of the exported `glob` function;
- says what a non-Bun host must provide.

Its per-file descriptions of `paths.ts`, `app-skills.macro.ts`, `system-prompt.md`, and `text-imports.d.ts` match
where those things now live, or are removed. Its phrase "browser and Bun code" reads "browser and server-side code".

**Behavior.** Preserving. Documentation only.

**Depends on.** All other entries.

**Decision.** [D-12](artifacts/change-decision-log.md#trivial-decisions)

## Behavior Changes

These are what a person could notice. Each was decided without asking the operator, under their standing guidance for
planning runs.

1. **A `claude` killed from outside 3pitor shows a different error line** (S-14). A reply that ends because something
   outside 3pitor killed `claude` showed `claude exited with code 143: …` in the chat. It now shows
   `claude exited with signal SIGTERM: …`. The person who sees it is the chat user in CLI mode. Decision: accept it,
   because the new line names what happened
   ([D-4](artifacts/change-decision-log.md#d-4-the-lifecycle-and-error-contract-of-the-claude-child-process)). Stopping
   a reply from the chat is unaffected.
2. **A rare process or pipe failure ends one reply instead of going unhandled** (S-14). This covers three failures:
   - the operating system reports an error from the `claude` process after it has started;
   - writing the conversation to `claude` fails for a reason other than `claude` having already exited;
   - reading `claude`'s output throws.

   Each now ends that reply with an error. Before, the first two had no handler. The third was an unhandled
   rejection, which exits the whole app on both runtimes. Decision: accept it
   ([D-4](artifacts/change-decision-log.md#d-4-the-lifecycle-and-error-contract-of-the-claude-child-process)).
3. **Skill frontmatter is read by a different YAML parser** (S-4). For every skill and agent file in the repository
   today, the result is the same. New tests pin it against the old parser before the swap. A skill file using unusual
   YAML might be read differently, or skipped, without any message. Decision: accept it, and treat a failing test as a
   reason to adjust the parser, not the test
   ([D-5](artifacts/change-decision-log.md#d-5-yaml-frontmatter-is-parsed-with-the-npm-yaml-package-with-duplicate-keys-allowed)).
4. **`make test` needs Node 22.15 or later on the developer's machine, as well as Bun** (S-16). Developers notice
   this. People using the app do not, and the release build does not run `make test`. Decision: accept it, so a
   regression fails the normal test run
   ([D-8](artifacts/change-decision-log.md#d-8-prove-the-engine-is-bun-free-with-a-source-scan-and-a-node-load-check-both-in-make-test)).

Every other entry is behavior-preserving.

## Change Units

Each unit leaves `make test` passing. Units 1 to 8 touch different files, and their order is a suggestion except where
a constraint is stated. Unit 9 comes last. Tests named "new" are written first and seen to fail, where a failure is
possible, before the change that makes them pass.

### Unit 1: The file-system entry loads on Node

**What it does.**

- Adds `scripts/node-ts.mjs`, the `.ts`-resolving loader for Node.
- Replaces the Bun-only `exists` import in `workspace.ts` with a local helper built on `stat`.

**Delta entries.** S-3, and the loader half of S-16.

**How you know it worked.**

```
node --experimental-transform-types --import ./scripts/node-ts.mjs -e "await import('./src/file-system/file-system.ts')"
```

This fails before the change with "does not provide an export named 'exists'", and succeeds after it. The
`workspace.test.ts` tests still pass.

### Unit 2: `glob` becomes a `FileSystem` method

**What it does.**

- Adds `glob` to the `FileSystem` interface and implements it in `createLocalFileSystem` over the walker.
- Narrows the walker's parameter to `Pick<FileSystem, 'list'>`.
- Removes the `glob` export from the entry and `'glob'` from `ENGINE_CONTRACT`.
- Switches the two engine call sites to `fileSystem.glob(...)`.

**Delta entries.** S-1, S-2.

**How you know it worked.**

- New: one `local-file-system.test.ts` case shows `createLocalFileSystem(root).glob('**/*.md', { dot: true })` returns
  the walker's keys.
- `glob.test.ts`, `boundary.test.ts`, `workspace-config.test.ts`, and the `Glob` tool tests in `tools.test.ts` pass.

### Unit 3: Frontmatter through the npm `yaml` package

**What it does.**

1. Adds new tests in `workspace-config.test.ts` and runs them green against `Bun.YAML` first. They pin:
   - each real app skill's exact parsed description, with its folding and em dash;
   - a double-quoted value;
   - a duplicated key, where the last value wins;
   - scalar and null frontmatter becoming `{}`.
2. Replaces `agent.test.ts:20-22`'s circular expected lines with literal text for at least one skill.
3. Adds `yaml` at an exact version, and swaps `Bun.YAML.parse` for `parse(…, { uniqueKeys: false })`.

**Delta entries.** S-4.

**How you know it worked.** The new tests pass before and after the swap. So do the existing `[unclosed` cases,
`agent.test.ts`, and `workspace-config.routes.test.ts`.

### Unit 4: The system prompt as a TypeScript module

**What it does.**

1. Adds `system-prompt.ts` with `SYSTEM_PROMPT`.
2. Checks once that `SYSTEM_PROMPT` equals the `.md` text (`git show HEAD:src/engine/chat/agent/system-prompt.md`).
3. Deletes `system-prompt.md` and `text-imports.d.ts`.
4. Points `agent.ts` and `agent.test.ts` at `SYSTEM_PROMPT`.
5. Adds a new lasting test in `agent.test.ts` that `SYSTEM_PROMPT` contains a backtick and contains no backslash. An
   escaping mistake breaks one or the other.

**Delta entries.** S-5.

**How you know it worked.** The one-time equality holds. After the `.md` is deleted, the new test, `agent.test.ts`, and
`tsc` pass with no `*.md` module declaration.

### Unit 5: The app-files package, with `paths.ts`

**What it does.**

- Creates `src/app-files/` with `paths.ts` and its test, and an `app-files.ts` entry that re-exports `SRC` and
  `WORKSPACE_FIXTURE`.
- Points `cli.ts`, `check.ts`, and the tests at it.
- Drops the engine's `WORKSPACE_FIXTURE` re-export.
- For this unit only, the engine's macro imports `SRC` from `../../app-files/paths`. Unit 6 removes that import.

**Delta entries.** S-6, S-7, S-9.

**How you know it worked.** `app-files/paths.test.ts` passes. `src/engine/paths.ts` is gone. `cli.test.ts` passes, and
`bun run server` still seeds its dev workspace from the fixture.

### Unit 6: App skills arrive as `appSkillFiles`

**What it does.**

- Moves the macro to app-files and exports `APP_SKILL_FILES` from the app-files entry.
- Adds `AppSkillFiles` and the required `appSkillFiles` option.
- Threads the option to `loadWorkspaceConfig`, `appSkillText`, and the required `fileTools` parameter.
- cli passes it, and every test construction site passes it.
- Updates `FS_EXEMPT`.

**Delta entries.** S-8, S-10, S-11.

**Ordering constraint.** After Unit 5, because the macro and the entry need `paths.ts` in app-files.

**How you know it worked.**

- New: a turn through `createEngine` with `APP_SKILL_FILES`, in `sessions.test.ts` or `agent.test.ts`, Reads
  `3pitor://skills/proofread/SKILL.md` and gets its text. It fails if `agentSettings` does not pass the map to
  `fileTools`.
- `make test` passes, and `make check-build` passes, so the binary still lists `collaborative-editing`.

### Unit 7: `isOnPath` from the host

**What it does.**

- Adds `IsOnPath` and the required `StartOptions.isOnPath`.
- Changes `startupWarning` to take the lookup.
- Moves `Bun.which` into `cli.ts`.

**Delta entries.** S-12, S-13.

**How you know it worked.** New: `claude-backend.test.ts` passes a stub lookup and pins three things:

- the CLI backend calls it with `('claude', env.PATH ?? '')`, so an empty env gives `''`;
- it warns only when the stub answers false;
- the API backend never calls it.

### Unit 8: `claude` through `node:child_process`

**What it does.** Rewrites the process part of `runClaude` to the lifecycle in D-4.

**Delta entries.** S-14.

**How you know it worked.** First, new `claude-cli.test.ts` cases against the fake `claude`. Some need new behaviors in
`fake-claude.ts`, which stays a Bun script.

- Not found, with an empty `PATH`: `doStream` itself rejects with `CLAUDE_NOT_FOUND_HELP`, and the stub tool server
  counts exactly one stop.
- The fake kills itself with SIGTERM after printing to stderr: the error part reads
  `claude exited with signal SIGTERM: <last line>`.
- A stop mid-reply: no `error` part follows. The existing test at line 199 checks only that no `finish` part follows.
- The fake exits at once without reading a stdin larger than 64 KB: the only error is the exit error, and nothing is
  unhandled.
- The fake writes about 2 MB and exits: the stream reaches its end and cleanup runs.

Then `claude-cli.test.ts`, `claude-backend.test.ts`, `sessions.test.ts`, and the server's `mcp-endpoint.test.ts` all
pass.

### Unit 9: The checks, and the README

**What it does.**

- Adds `bun-free.test.ts`, `node-check.ts`, and the `check-node` target, wired into `test`.
- Updates the README.

**Delta entries.** S-15, S-16, S-17.

**Ordering constraint.** Last. The scan passes only after Units 2, 3, 4, 6, 7, and 8. The Node check passes only after
Units 1, 4, 5, 6, and 8.

**How you know it worked.**

- `make test` passes.
- Planting `Bun.sleep(1)` in any engine production file fails `bun-free.test.ts`.
- Re-adding the `exists` import fails `make check-node`.
- Swapping the D-4 `'close'` latch for `once(child, 'close')` attached after the read makes the Node check's `claude`
  run hang or fail.

## Risks

- **Bun's and Node's `node:child_process` differ somewhere the probes did not reach** (Unit 8). The probes covered
  ENOENT timing, kill before spawn, signal exits, EPIPE, and `'close'`, and the two runtimes agreed on all of them
  (C-18). Detect: the fake-`claude` tests on Bun and the Node check's `claude` run on Node. Blast radius: CLI-mode
  chat.
- **A stop before `claude`'s first output waits for `claude` to exit.** `cleanup()` sends SIGTERM and does not settle
  the call until the process closes. Nobody has checked that the real `claude` exits promptly on SIGTERM. This is
  unchanged by the plan, which keeps today's kill. Detect: a stop that does not take effect in CLI mode. Blast radius:
  one reply.
- **The `yaml` parser and `Bun.YAML` disagree on a file nobody has written yet** (Unit 3). Detect: Unit 3's new pinning
  tests guard every file that exists today. A disagreement later shows up as a skill that is missing from the list.
  Blast radius: which skills and agents are listed.
- **The macro stops embedding after it moves** (Unit 6). Detect: `make check-build`, which `make test` does not run.
  Run it in this unit. Blast radius: the shipped binary would list no app skills.
- **The `FileSystem.glob` grammar is a prose contract with one implementation.** A second backend has no test it can
  run to prove it matches, and the per-segment edge cases were never probed. Detect: the first non-local backend's
  tests. Blast radius: the model's Glob tool and skill discovery on that backend.
- **The Node check relies on experimental Node flags** (Unit 9), which may change in a later Node. Detect:
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
- **A backend-neutral conformance suite for `FileSystem.glob`.** No second backend exists to run it. Reopen when the
  first non-local `FileSystem` is written.

## Cut for Scope

The operator can reinstate any of these. Their saying so is itself a valid justification, which the reinstated entry
records.

- **Making the local-disk file system run on Node.** This means replacing `Bun.write` in `local-file-system.ts` and
  `Bun.Glob` in the walker. It would let a Node host use `createLocalFileSystem` instead of bringing its own
  `FileSystem`. Cut because the boundary scopes file-system changes to the pattern matcher
  ([scope-boundary.md](artifacts/scope-boundary.md), Operator-Stated Scope). Only the one load-time fix the engine needs
  is kept (S-3).
- **Making the server's tool endpoint (`serveTools`) run on Node.** It is built on `Bun.serve`. It would let a Node
  host in CLI mode reuse 3pitor's endpoint instead of writing one. Cut because it is server code, not engine code, and
  the boundary covers the engine
  ([D-13](artifacts/change-decision-log.md#d-13-reuse-outside-bun-means-the-engine-loads-and-runs-on-node-with-its-host-supplying-four-inputs)).
- **Moving engine tests and test helpers off Bun.** This means `bun:test` imports, `Bun.file`, `Bun.sleep`, and the
  fake `claude`'s `Bun.stdin`. Cut because the operator said "the engine's tests are fine as bun-specific right now"
  ([scope-boundary.md](artifacts/scope-boundary.md)).

## Open Items

- **How another program will consume the engine** (non-blocking). The engine's relative imports have no file
  extension, and three classes use TypeScript constructor parameter properties. Plain Node therefore cannot import
  `engine.ts` directly, even after this change. A host must bundle it, or load it with a resolve hook and
  `--experimental-transform-types`, as the Node check does. Options include publishing a built package, adding `.ts`
  extensions, or treating "the host bundles it" as the answer. That is a distribution decision this plan does not
  make. It is settled when the operator names the first real non-Bun host
  ([D-13](artifacts/change-decision-log.md#d-13-reuse-outside-bun-means-the-engine-loads-and-runs-on-node-with-its-host-supplying-four-inputs)).

## Review Findings

One review round ran, against a cap of two. The team was medium-sized:

- `han-core:junior-developer`;
- `han-core:test-engineer`;
- `han-core:on-call-engineer`, which ran its probes on both runtimes.

Findings that changed the plan:

- **The `'close'` wait could hang a reply forever, and the reading task could crash the app** (on-call-engineer
  OCE-001, OCE-002). D-4 now attaches a plain `'close'` latch before any `await`. The reading task now has a `catch`.
- **The stdin handler swallowed every error, a stop during startup reported not-found, and an unreachable ENOENT
  mapping sat in step 1** (OCE-003, OCE-005, OCE-006). D-4 narrows the stdin handler, reports the stop's reason, and
  maps ENOENT only after `'spawn'`.
- **The old signal-exit text is now known** (OCE-004): `code 143`. Behavior Changes item 1 states it exactly.
- **"Reuse outside Bun" was undefined, and only loading was checked** (junior-developer JD-001, JD-002; test-engineer
  T9). D-13 defines the goal and lists the four host inputs. The Node check now runs `claude` on Node.
- **app-files imported a type from the engine, closing a package loop** (JD-004). It now exports a plain map and
  imports nothing.
- **`fileTools` kept a silent default** (JD-006). Its `appSkillFiles` is now required.
- **The README update missed stale text** (JD-005). S-17 now covers it.
- **The YAML swap and the prompt move were not pinned by any test** (test-engineer, correcting C-8 and C-9). Units 3
  and 4 add pinning tests first.
- **The test engineer's tests T1, T2, T3, T4, T5, T6, T7, and T8** became the "new" checks in Units 2, 3, 4, 6, 7,
  and 8. **Unit 1's original check proved nothing** (test-engineer), so it now loads the file-system entry on Node.
- **Bun's `exists` and `stat` might disagree** (JD-007). A probe closed this: they agree (C-18).

Findings declined, with the decision that records why:

- **Print a warning when a skill's frontmatter fails to parse** (on-call-engineer OCE-007). Declined in
  [D-5](artifacts/change-decision-log.md#d-5-yaml-frontmatter-is-parsed-with-the-npm-yaml-package-with-duplicate-keys-allowed).
- **A conformance suite for the `glob` grammar** (JD-003). Deferred under YAGNI above, and kept as a Risk.

No finding stayed `Unverified`. Two questions about the real `claude` binary remain open: whether it exits promptly on
SIGTERM, and whether its output can leave the parser a tick behind. Both bear on how often the hazards D-4 guards
against would occur, and neither blocks the change. Both are listed in Risks and in the findings' "Findings No Agent
Could Audit".

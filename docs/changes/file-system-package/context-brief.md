# Context Brief: A Swappable File-System Package

**Goal (verbatim):** "similar to what we did for CLI and API, i want to separate all file operations into their own
package all file reads and writes must happen through this package, using an abstraction layer that allows us to swap
out the filesystem backend. for example, we may want to use AWS S3 buckets. or we may use Notion documents. or some other
idea. the API needs to work from a file "key", which will represent the path to the file. the initial implementation will
of this abstraction will expect the file "key" to be a path relative to the workspace root. this new package will also be
able to raise events for files and folder being created, updated, renamed, deleted, etc, facilitating the current file
system watcher as an implementation of the initial file system that works from actual files. i expect the engine to
receive an instance of the file system package, as part of the factory/constructor that builds the engine. this means
the CLI package will have to do the file system package constructor/factory, and pass the results to the engine
constructor/factory, similar to how the engine is passed into the API factory"

**Interface:** a new top-level package beside `src/cli/`, `src/server/`, `src/engine/`, `src/ui/`, `src/shared/`. It
exposes a key-based file-system abstraction and a local-disk implementation. It changes the engine factories
(`src/engine/engine.ts` `createEngine`/`startEngine`/`wire`) to take an instance, and `src/cli/cli.ts` constructs it.

**Starting point:** working tree on branch `file-system-package`, identical to `main` (84d5540).

**Project conventions:** no `CLAUDE.md` or `project-discovery.md`. Conventions come from `README.md` ("How `src/` is laid
out") and the previous split, `docs/changes/server-engine-split/api-design.md`.

**Agents:** codebase-explorer (CE), structural-analyst (SA), behavioral-analyst (BA), concurrency-analyst (CA),
adversarial-security-analyst (SEC). Every agent returned usable output. Not dispatched (band cap): on-call-engineer,
data-engineer.

## Findings

### Where file I/O happens today

- **F1.** Runtime file I/O sits in six engine modules: `engine/documents/documents.ts:3-4,128`,
  `engine/components/json-file.ts:3,10,36`, `engine/components/workspace-path.ts:3`, `engine/chat/tools/tools.ts:7,86,97,112,130,150`,
  `engine/workspace-config/workspace-config.ts:100,104`, `engine/workspace/workspace.ts:2`. — SA, CE, BA
- **F2.** `engine/workspace-config/app-skills.macro.ts:5,13` reads `src/skills/` at bundle time (Bun macro). It is not a
  workspace read and never runs at runtime. — SA, CE
- **F3.** Non-production file users: `server/scripts/check.ts:80,211` (reads the check workspace from disk to verify
  edits), `engine/chat/components/{chat-test-helpers,fake-claude,fake-claude-on-path}.ts` (test fixtures), and 15 test
  files that build `mkdtemp` workspaces. — SA S1, S7; CE D23, D24
- **F4.** The `claude` program is spawned with `cwd: tmpdir()` (`claude-cli/claude-cli.ts:131-133`), deliberately not
  the workspace. The model reaches files only through the tools, so no backend has to provide a real directory for
  the spawned process. — SA S3, CE D21, BA

### How the workspace string is threaded

- **F5.** `startEngine` calls `chooseWorkspace(target)` (`engine.ts:78`), then `wire(...)`, then
  `watchDocuments(workspace, …)` (`engine.ts:81`), then `sessions.load()`. Workspace choice and the watcher live inside
  the engine today, not the CLI. — SA S2, BA B10
- **F6.** `workspace: string` is a positional argument to every file-touching function: about 14 call sites in
  `engine.ts:97-117`, 3 in `sessions.ts:45,104,161`, 2 in `agent.ts:63,71`, about 10 in `tools.ts`, 2-3 in
  `workspace-config.ts`. — SA S2
- **F7.** `engine.workspace` is used for display only: `cli.ts:18` (the `listening on … (workspace: …)` line, which
  `check.ts` and `make check-build` parse) and `server/server.ts:30` (`/api/health`). For an S3 or Notion backend the
  value is not a path. — SA S3, BA B10
- **F8.** `createEngine` is called only from tests: 7 sites (`engine.test.ts:25,33`, four server route tests,
  `mcp-endpoint.test.ts:252,270`). Each passes a real temp directory as `workspace`. 51 test lines call the
  workspace-string APIs directly, 35 of them in `tools.test.ts`. — SA S7
- **F9.** `chooseWorkspace` resolves: folder → itself; file → its parent; missing → warn and use cwd; none →
  `WORKSPACE` env (seeded from `src/fixtures/workspace` if absent) or cwd (`workspace.ts:14-31`). `resetWorkspace` and
  `dataDir` serve dev and check scripts only. — BA B10, CE D2-D3

### Leaky local-disk details

- **F10.** The helpers hand callers absolute disk paths: `resolveInWorkspace` returns a real path
  (`workspace-path.ts:8-12`), `stateFile` builds `join(workspace,'.3pitor',name)` (`json-file.ts:6`), and documents'
  `locate` returns node `Stats` (`documents.ts:38`). `tools.ts` recomputes `relative(realpathSync(workspace), target)`
  five times (`:75,109,129,193,205`), which is the nearest existing thing to a key. — SA S4
- **F11.** `stateFile` is imported by two server tests (`view-state.routes.test.ts:6`, `mcp-endpoint.test.ts:11`) and
  is on the boundary script's allowlist. — SA S5

### Document semantics (what list/read/write/create/move/count/delete do)

- **F12.** `DocumentError` has two reasons, `'invalid'` and `'not-found'` (`documents.ts:9-18`). Routes map not-found →
  404, invalid → 400, anything else → plain-text 500 (`documents.routes.ts:16-20`). "Already exists" is `'invalid'`.
  Errors come from pre-checks; no errno is mapped, so EISDIR, ENOTDIR, EACCES and races surface as 500s. — BA B1, CE D25
- **F13.** Key grammar `checkPath` (`documents.ts:28-33`): `/`-separated, no empty segment, no segment starting with
  `.`, no `\` or NUL; files end in `.md`. This rejects `..`, absolute paths, and hidden folders lexically. — BA B2, SEC C1
- **F14.** `list()` returns `DocumentEntry {path, kind: 'file'|'folder'}` (`wire.ts:50-53`): all folders including empty
  ones, `.md` files only, no hidden names, no symlinks, sorted by `<`. A subfolder vanishing mid-walk is skipped
  (`documents.ts:61-84`). — BA B2, CE D4
- **F15.** `writeDocument` overwrites in place with `Bun.write`, creating missing parent folders
  (`documents.ts:125-129`; comment at :125). It is not atomic. — BA B6, CA C4
- **F16.** Conflicting reports on parent folders. CE D6 says write creates parents via `requireParent`/`mkdir`, and CE
  D8 says move "creates parent folder if needed". BA B4/B6 say create and move refuse a missing parent. The code
  (`documents.ts:131-156`) shows `createEntry` and `moveEntry` call `requireParent`, which throws `not-found`; only
  `writeDocument` creates parents, through `Bun.write`. — CE D6, D8 vs BA B4, B6
- **F17.** `createEntry` seeds a new file with `` `# ${basename(path,'.md')}\n` `` and refuses an existing item
  (`documents.ts:131-138`). — BA B6, CE D7
- **F18.** `moveEntry` refuses: missing source (not-found), into itself or a descendant (checked by real path), existing
  target unless the same inode (case-only rename), missing target parent (`documents.ts:140-156`). The final `rename`
  is unguarded against races. — BA B4, SEC C5-C6
- **F19.** `countContents` counts everything a recursive delete removes, hidden and non-`.md` items included
  (`documents.ts:158-174`). The UI's delete confirmation shows it (`FolderCount`, `wire.ts:61-65`). `deleteEntry` is
  `rm(full,{recursive:true})` (`:176-181`). — BA B5, CE D9-D10

### State persistence (`.3pitor/`)

- **F20.** `json-file.ts:20-41` `writeText`: per-path writes are serialized by a module-level `pending` Map, written to
  `${path}.${pid}.tmp` and then renamed (atomic). The first write drops a `.gitignore` of `*` in `.3pitor/`. — BA B6, CE D14
- **F21.** `readJson` returns `undefined` for missing and for unreadable or corrupt files alike, logging a warning for
  the latter. The next save overwrites the corrupt file (`json-file.ts:8-18`; `sessions.ts:44-56`). With a remote
  backend a transient read error would look the same as no state. — BA B7
- **F22.** Users: sessions → `.3pitor/session.json` (`sessions.ts:45,161`), view-state → `.3pitor/view.json`
  (`view-state.ts:7-14`), and AI notes → `.3pitor/**/*.md` through `writeText` (`tools.ts:106-108,130-132`). — CE D15,
  D16, D20

### Chat tools and workspace config

- **F23.** The AI's Write and Edit on posts never touch disk: they update the in-memory turn copy (`turn.texts`), which
  the user saves later (`tools.ts:1-5,102-143`). Read returns the turn copy, else reads disk. — BA B8, CA C6
- **F24.** The AI's Read falls back to `Bun.file(resolveInWorkspace(...))` (`tools.ts:97`), which reads **any** file
  in the workspace, hidden and non-`.md` included. Glob (`tools.ts:149-151`) lists hidden files too, with a real-path
  post-filter. — SEC-003, BA B8
- **F25.** There are three key grammars today: documents (`checkPath`, lexical, strict), AI posts (`resolvePost`
  `tools.ts:190-198`, normalizes first, then checks `.md` and dots on the real path), and AI Read (containment only).
  Plus the `.3pitor` notes carve-out (`resolveAppNote` `tools.ts:202-208`). `documents.ts:25-27` says the document
  grammar is narrower on purpose. — SEC inventory, BA B8
- **F26.** Edit on a missing post surfaces Bun's raw ENOENT text to the model, while Read says "does not exist"
  (`tools.ts:85-86` vs `:98`). Error strings the model sees will change if the package's errors replace them. — BA B8
- **F27.** `loadWorkspaceConfig` globs `.claude/skills/*/SKILL.md` and `.claude/agents/*.md` with `dot: true` and reads
  each with `Bun.file(join(workspace,path))` without containment or a try (`workspace-config.ts:43-65,99-105`). It runs
  on every chat turn and every `names()` call. — BA B9, CE D17
- **F28.** Glob over patterns is a disk feature (`Bun.Glob`). An object store or Notion cannot glob natively; the
  package would offer list-by-prefix and filter in memory. — BA B9, CE D29

### The watcher and events

- **F29.** The only file event today is `{ type: 'documents-changed' }` with no payload (`wire.ts:7`). `watchDocuments`
  uses recursive `fs.watch`, discards the event kind, drops paths with a hidden segment, and debounces (100 ms quiet,
  1 s cap) (`documents.ts:86-117`). — CA C1, C3; BA B11
- **F30.** On `documents-changed` the UI re-lists and re-reads every open file (`ui/app.tsx:98`,
  `ui/documents/documents/documents.tsx:256-283`). It ignores its own save echoes through `saving`/`saves` guards, and
  re-syncs on every socket reconnect (`app.tsx:106-108`). The UI uses no event detail; it treats events as hints. — CA
  C5, C12; BA B11
- **F31.** `fs.watch` reports only `rename` or `change`. Create, delete, and move all arrive as `rename`; a move is two
  unpaired events; a folder delete may report only the folder; macOS can coalesce or replay. Typed
  created/updated/renamed/deleted events can only come reliably from diffing a snapshot after each settled burst, and
  even then a rename looks like delete plus create. — CA C2 (`inferred` from platform docs)
- **F32.** Writes the engine makes are reported back to it by the watcher, and the UI tolerates this. `.3pitor/` writes
  are hidden and filtered, so state saves never echo. `createEngine` (tests) never starts the watcher. — BA B11, CA C4
- **F33.** The watcher's `{close()}` handle is discarded (`engine.ts:81`); the `Engine` has no close. A watcher error is
  logged and watching silently stops until restart (`documents.ts:108-116`). — CA C8, BA B11
- **F34.** The watcher starts before any subscriber exists; there is no replay. The gap-free pattern is "subscribe,
  then list", which the UI follows by re-syncing on connect. — CA C9
- **F35.** `EventBus.emit` calls listeners without try/catch (`events/events.ts:14-16`), so one throwing listener stops
  delivery to later ones. — CA C10, BA B11
- **F36.** If events carry keys, an unfiltered broadcast would leak hidden key names (`.3pitor/session.json`, `.env`,
  `.claude/…`) to every socket. The hidden filter has to run before emitting. — SEC lost-check 2

### Concurrency and atomicity

- **F37.** Document writes have no per-key serialization; concurrent PUTs from two tabs are last-writer-wins
  (`documents.ts:126-129`). The UI collapses overlapping saves within one tab (`documents.tsx:124`). — CA C14
- **F38.** Every document mutation is check-then-act (`lstat`, then act). `createEntry` writes without `wx`, and
  `rename` overwrites a target that appears in between. These are single-user windows today. — CA C13, BA B4
- **F39.** The AI's note Edit is read-modify-write (`tools.ts:130-132`); `pending` orders writes but not the read, so
  parallel tool calls on one note can lose an update (`inferred`: the AI SDK runs tools in parallel by default). — CA C6

### Security of keys

- **F40.** Keys from the browser come from anyone who can reach the server: `Bun.serve` binds every interface with no
  auth, and Hono parses `text/plain` bodies as JSON, so cross-site simple POSTs work (`server/server.ts:36-45`,
  `documents.routes.ts:62-63`; verified by experiment). The fix (bind to 127.0.0.1, check Origin) sits outside the
  file-system package; the finding means key validation is the only defense on writes. — SEC-001
- **F41.** A symlinked folder inside the workspace that points at `.claude/` lets the browser read and write hidden
  files, because `checkPath` checks the requested segments and `resolveInWorkspace` only checks the real path stays
  inside the workspace (`documents.ts:30,42,57`; verified). — SEC-002
- **F42.** `workspace-config.ts:104` and `json-file.ts` do no containment, so a symlinked `.claude/skills` or `.3pitor`
  reads or writes outside the workspace (verified for workspace config). — SEC-004
- **F43.** Move-into-itself is checked by real path only (`documents.ts:146-148`). A non-disk backend needs a lexical
  check (`to === from || to.startsWith(from + '/')`) in the key layer. — SEC lost-check 1
- **F44.** Canonicalize once, validate the canonical form, and pass only the canonical form to the backend; validating
  before normalizing would admit `a/../.claude/x.md`. — SEC lost-check 4
- **F45.** `resolveInWorkspace`'s `relative(...).startsWith('..')` test wrongly refuses a root entry named `..foo` and
  (inferred) passes a different Windows drive. — SEC lost-check 7

### Boundary rules and layout

- **F46.** README: "Five packages, and imports run one way only"; the engine "imports only `src/shared/` and npm
  packages" (`README.md:17-25`). An engine that imports a new package contradicts that sentence unless the interface
  type lives in `shared` or the rule is rewritten. — SA S6
- **F47.** `docs/changes/server-engine-split/artifacts/check_boundaries.py` enforces the package rules by hand: rule E2
  (engine imports only engine/shared) and C1 (cli imports only `engine/engine` and `server/server`) would both fail
  for a new package. It has no rule banning `node:fs` outside a package. It is not wired into the Makefile. — SA S5
- **F48.** The previous split updated README, the `update-code-structure` skill, and a change log (commits 272bc68,
  67a45cd, 664fc64). — SA S6
- **F49.** `src/engine/components/` holds only `json-file.ts` and `workspace-path.ts`, both file helpers. — SA S8

## Open items with no evidence

- **O1.** Whether non-document reads (workspace config under `.claude/`, state under `.3pitor/`) belong to the same key
  space and backend as documents, or to a separate store. The goal says "all file reads and writes" go through the
  package; it does not say whether app state must live in the same backend as documents.
- **O2.** What `engine.workspace` (F7) becomes for a non-disk backend: a label from the file system, or kept as the
  CLI's own value.

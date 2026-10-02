# Options: The `file-system` Package Contract

Source context: [context-brief.md](./context-brief.md) (F1–F49, O1–O2). The style follows
[server-engine-split/api-design.md](../server-engine-split/api-design.md). Produced by `han-core:software-architect`,
which re-read `src/engine/engine.ts`, `src/cli/cli.ts`, `src/engine/documents/documents.ts`,
`src/engine/chat/tools/tools.ts`, `src/engine/components/{json-file,workspace-path}.ts`,
`src/engine/workspace/workspace.ts`, `src/engine/workspace-config/workspace-config.ts`,
`src/engine/view-state/view-state.ts`, `src/engine/events/events.ts`, `src/shared/wire.ts`,
`src/server/scripts/check.ts`, `src/engine/paths.ts`, the README layout section, and `check_boundaries.py` rules E2 and C1.

## Goal clauses (cited as G1–G9)

- **G1** "separate all file operations into their own package"
- **G2** "all file reads and writes must happen through this package"
- **G3** "using an abstraction layer that allows us to swap out the filesystem backend. for example, we may want to use
  AWS S3 buckets. or we may use Notion documents"
- **G4** "the API needs to work from a file "key", which will represent the path to the file"
- **G5** "the initial implementation … will expect the file "key" to be a path relative to the workspace root"
- **G6** "raise events for files and folder being created, updated, renamed, deleted, etc"
- **G7** "facilitating the current file system watcher as an implementation of the initial file system that works from
  actual files"
- **G8** "i expect the engine to receive an instance of the file system package, as part of the factory/constructor that
  builds the engine"
- **G9** "the CLI package will have to do the file system package constructor/factory, and pass the results to the
  engine constructor/factory, similar to how the engine is passed into the API factory"

A "necessity" justification points at a finding. For example, "F14" means "necessity of keeping today's list behavior
described in F14".

---

## Option A (recommended): a generic key store, with one key space and document rules kept in the engine

A new package, `src/file-system/`, with one entry module, `file-system/file-system.ts`. This mirrors `engine/engine.ts`.
The package exports:

- one `FileSystem` interface over plain-string keys
- a key grammar that the package enforces on every call
- a `FileSystemError` with three reasons
- a typed batch event from `watch`
- a `glob` helper written over the interface
- the local implementation `createLocalFileSystem(root)`
- `chooseWorkspace`, which moves here from the engine

App state (`.3pitor/…`) and config (`.claude/…`) are ordinary keys in the same space, as G5 says. Hidden-name policy,
the `.md` rule, seeding, the parent rules, and counting stay in `engine/documents`. Tool grammars stay in
`engine/chat/tools`.

### Sketch

```ts
// src/file-system/file-system.ts — the only module cli and engine import from this package.

// A key: workspace-relative, "/"-separated, no empty / "." / ".." segment, no "\" or NUL, no leading "/".
// "" is the root, valid only for list() and stat().
export type EntryKind = 'file' | 'folder' | 'other';          // 'other' = symlink, socket, …

export interface FileEntry { key: string; kind: EntryKind }

export type FileEvent =
  | { type: 'created' | 'deleted'; key: string; kind: 'file' | 'folder' }
  | { type: 'updated'; key: string; kind: 'file' }
  | { type: 'renamed'; from: string; to: string; kind: 'file' | 'folder' };

export interface WatchOptions {
  // Keys for which this returns true are never tracked or reported (the engine passes its hidden rule).
  ignore?: (key: string) => boolean;
}

export interface FileSystem {
  // Where the files live, for display only (local: the root folder's path).
  readonly label: string;
  stat(key: string): Promise<EntryKind | undefined>;
  read(key: string): Promise<string>;                          // utf-8
  // Replaces the whole file, creating missing parent folders. A reader never sees half a file.
  // Writes to one key land in call order.
  write(key: string, text: string): Promise<void>;
  createFolder(key: string): Promise<void>;                     // parent must exist
  list(folder: string): Promise<FileEntry[]>;                   // direct children, unordered
  // Refuses into-itself, a missing target parent, and an existing target unless it is the same item.
  move(from: string, to: string): Promise<void>;
  delete(key: string): Promise<void>;                           // recursive; a link is removed as a link
  // Batches of changes after each settled burst. Returns unsubscribe. Listener throws are caught and logged.
  watch(listener: (events: FileEvent[]) => void, options?: WatchOptions): () => void;
}

export class FileSystemError extends Error {
  constructor(readonly reason: 'invalid' | 'not-found' | 'exists', message: string) { super(message); }
}

// Loose input (the model's "./notes.md", "a/../b.md") → canonical key, or FileSystemError('invalid',
// `${input} is outside the workspace`) for absolute or escaping input.
export function toKey(input: string): string;
export function glob(files: FileSystem, pattern: string, options?: { dot?: boolean }): Promise<string[]>;

export { createLocalFileSystem } from './local/local';
export { chooseWorkspace, dataDir, ensureWorkspace, resetWorkspace } from './local/workspace';
```

```ts
// src/file-system/local/local.ts
export function createLocalFileSystem(root: string): FileSystem;   // synchronous, no I/O (like createEngine)
// Each key maps to join(root, key). If any existing component is a symlink, the key is refused ('invalid',
// "<key> is a symlink"); move and delete may act on a final-segment link itself.
// write = temp ".<name>.<pid>.tmp" in the same folder, then rename, behind a per-key queue (moved from json-file.ts).
// errno: ENOENT/ENOTDIR → 'not-found', EEXIST → 'exists'; everything else is rethrown as is (a 500 today, unchanged).
// watch = recursive fs.watch + a snapshot {key → kind, ino} built on the first watch() call. Each settled burst
// (100 ms quiet / 1 s cap, as today) re-lists only the dirty folders and diffs. A delete and a create with the
// same ino in one burst become 'renamed'. A watcher error is logged and watching stops (as today).
```

```ts
// src/engine/engine.ts (changes only)
import type { FileSystem } from '../file-system/file-system';
export interface EngineOptions { files: FileSystem; model?: string; claude: ClaudeMode; maxSteps?: number; serveTools: ServeTools }
export interface StartOptions  { files: FileSystem; claude: ClaudeMode; model?: string; serveTools: ServeTools } // `target` removed
export interface Engine { readonly workspace: string; /* = files.label */ … unchanged … }

export async function startEngine({ files, claude, model, serveTools }: StartOptions) {
  const { engine, events, sessions } = wire({ files, claude, model, serveTools });
  files.watch(() => events.emit({ type: 'documents-changed' }), { ignore: isHiddenKey });
  await sessions.load();
  …
}
// wire(): documents.list: () => listEntries(files), …; viewState: loadViewState(files); workspaceConfig: loadWorkspaceConfig(files)
```

```ts
// src/cli/cli.ts
import { chooseWorkspace, createLocalFileSystem } from '../file-system/file-system';
const { target, claude } = commandLine();
const files = createLocalFileSystem(await chooseWorkspace(target, process.env.WORKSPACE));
const engine = await startEngine({ files, claude, model: process.env.MODEL, serveTools });
const server = startServer(engine, { … });   // unchanged; listening line still prints join(engine.workspace)
```

```ts
// src/engine/components/json-file.ts (stays; its I/O goes through files)
export const stateKey = (name: 'session.json' | 'view.json') => `.3pitor/${name}`;
export function readJson(files: FileSystem, key: string): Promise<unknown>;      // not-found → undefined; other failure/corrupt → warn, undefined (F21 kept)
export function writeJson(files: FileSystem, key: string, value: unknown): Promise<void>;
export function writeText(files: FileSystem, key: string, text: string): Promise<void>;
// writeText chains every write off one memoized "ensure .3pitor/.gitignore" promise per FileSystem, so call order is kept.
```

### What moves and what stays

| Today | Option A |
|---|---|
| `engine/components/workspace-path.ts` (+test) | Deleted. Containment becomes the key grammar plus the local backend's no-symlink rule. |
| `engine/components/json-file.ts` queue, temp file, and rename | Move into `file-system/local/local.ts` `write`. |
| `json-file.ts` `readJson`/`writeJson`/`writeText`/`.gitignore` drop | Stay in the engine, rewritten over `files` (app-state policy). |
| `documents.ts` `watchDocuments` | Moves into `file-system/local/watch.ts` as the snapshot-diff watcher (G7). |
| `documents.ts` `checkPath`, hidden rule, `.md`, seed heading, `requireParent`, sort, count, `DocumentError` | Stay in `engine/documents`, rewritten over `stat`/`read`/`write`/`createFolder`/`list`/`move`/`delete`. |
| `engine/workspace/workspace.ts` (`chooseWorkspace`, `ensureWorkspace`, `resetWorkspace`, `dataDir`) | Moves to `file-system/local/workspace.ts`. `chooseWorkspace(name, workspaceEnv)` now takes the env value, so the package reads no environment. Its fixture path uses a package-local `SRC`, pinned by a test like `engine/paths.test.ts`. |
| `tools.ts` grammars (`resolvePost`, `resolveAppNote`, Read, Glob) | Stay in the engine. They become lexical over `toKey()` output. `postName`/`turnTexts` drop the `workspace` argument. |
| `workspace-config.ts` `scan`/`readMarkdown` | Stay. They use `glob(files, …, {dot:true})` and `files.read`. |
| `app-skills.macro.ts` (F2), test `mkdtemp` (F3), `check.ts` verification reads (F3) | Exempt; see the boundary rules below. |
| Turn overlay (`turn.texts`, F23) | Stays in the engine, unchanged. |

### Element justifications (Option A)

| Element | Justification |
|---|---|
| Package `src/file-system/`, a single entry module `file-system.ts` | G1. The single entry mirrors G9's "similar to how the engine is passed into the API factory" (the engine.ts precedent). |
| `FileSystem` interface | G3 (the swappable abstraction layer). |
| Keys are plain `string` | G4. The engine's 51 test lines and every route already pass strings (F8). A branded type adds no runtime check beyond the per-call validation below. |
| Key grammar enforced on every method | G5, plus containment F40 and F44 (validate the canonical form; this is the only defense on writes). It must hold for every backend, so it lives in the package and not in a backend. It fixes F45: `..foo` becomes valid. |
| `""` as root, valid only for `list`/`stat` | Necessity of `listEntries` walking from the root (F14). Refusing it elsewhere prevents `delete("")`. |
| `toKey(input)` | Canonicalize once (F44). The tools receive loose model input (`./notes.md`), which they normalize today (F25). |
| `toKey` message `"<input> is outside the workspace"` | Keeps today's tool string (workspace-path.ts:10) for escapes. |
| `EntryKind` including `'other'` | F14 (the list omits symlinks) and F19 (the count includes them as files). |
| `label` | F7 and O2. It keeps `/api/health` and the `listening on … (workspace: …)` line byte-identical. A non-disk backend supplies its own display string. |
| `stat` | Necessity of documents' pre-checks: exists, kind, and parent (F16, F17, F18). |
| `read` (utf-8 string) | G2. Every file read today is text (F1, F22, F27). |
| `write` replaces the whole file and creates parents | F15 (save creates parents) and F20 (state writes). |
| `write` never shows half a file; writes per key land in order | F20 (state atomicity and serialization). It is one contract for all keys. See behavior change BC2. |
| `createFolder`, parent must exist | G6 names folders, and F14 shows empty folders. The parent rule comes from F16. |
| `list(folder)` returns direct children, unordered | Necessity of skipping hidden folders without descending into `.git` (F14). Natural for S3 delimiter listing (F28). The engine sorts (F14). |
| `list` of a missing folder or a file → `not-found` | F14 (a folder vanishing mid-walk is skipped). Maps today's ENOENT/ENOTDIR. |
| `move` refuses into-itself, lexically, in the package | F43. The local backend also compares real paths for letter-case variants (documents.ts:145). |
| `move` refuses an existing target unless it is the same item | F18 (case-only rename). It removes the engine's need for an inode. |
| `move` refuses a missing target parent | F16 and F18. |
| `delete` is recursive; a link is removed as a link | F19 (`rm` recursive, documents.ts:176). |
| `watch(listener)` returns unsubscribe | G6 and G7. It is lazy, so `createEngine` (tests) starts no watcher (F32). Unsubscribe is the only lifecycle needed; see the cut list for `close`. |
| Batch `FileEvent[]` per settled burst | G6. The batching comes from today's debounce (F29). The UI treats events as hints (F30). |
| `created`/`updated`/`deleted`/`renamed` | G6, verbatim. |
| `renamed` only when the backend can tell, else delete plus create | F31: an honest contract, no promise of pairing. |
| Local typing by snapshot diff with ino pairing | F31 (the only reliable way to get types) and G7. |
| `WatchOptions.ignore` | F29 (today's watcher drops hidden paths, so it never tracks `.git`) and F36 (hidden keys are never emitted). The policy stays the engine's predicate. |
| Listener throws caught and logged | Keeps documents.ts:96-100 behavior (F35, as far as this package's emitter goes). |
| Watcher error logged, then watching stops | Keeps F33 behavior. Cut alternatives are listed below. |
| `FileSystemError` | G3. The engine must not read node errno codes, which are a local-disk leak (F12, documents.ts:48,68). |
| Reason `'invalid'` | F12 and F13 (a refusal that can never succeed). It covers a key outside the grammar, a symlink in the path, and into-itself. |
| Reason `'not-found'` | F12 (404), F16 (missing parent), F14 (vanished folder). |
| Reason `'exists'` | F17 and F18 ("already exists"). It is a separate reason because the backend detects it on `move`; documents still maps it to `DocumentError('invalid')` (F12). |
| Package messages worded like today's documents messages (`<key> was not found`, `<to> already exists`, `<from> cannot move into itself`) | F12: browser-visible strings stay byte-identical, because documents passes `message` through. |
| errno passthrough for anything else | F12 (EISDIR and EACCES are 500s today, unchanged). |
| Local: key → `join(root,key)`, refused if any existing component is a symlink | G5 ("path relative to the workspace root") and key identity: a key must name the location it reads, or the engine's hidden policy over keys is bypassed. This closes F41 and F42. See behavior change BC1. |
| Local temp name `.<name>.<pid>.tmp` | F20 (the pid avoids two servers colliding). The leading dot keeps it inside the engine's hidden filter, so a save never shows a stray entry (F32). |
| `createLocalFileSystem(root)`: synchronous, no I/O | G9. It mirrors `createEngine` "synchronous and no I/O" (engine.ts:76). |
| `chooseWorkspace(name, workspaceEnv)` moves into the package | G2. Its `stat` and fixture `cp` are file I/O. It is local-backend root choice (F9). Taking the env value as an argument keeps env reads in cli, per the README cli rule. |
| `ensureWorkspace`/`resetWorkspace`/`dataDir` move with it | G2 (`cp`/`rm` are file writes). `check.ts` imports them (F9). |
| `glob(files, pattern, {dot})` as a function over the interface | F28 (no backend can glob natively). Two current users: tools Glob and workspace-config (F27). It walks from the literal prefix and skips `'other'`. A missing or refused prefix gives `[]`. |
| `EngineOptions.files` and `StartOptions.files` | G8 ("the engine … receive[s] an instance"). Both factories take it because tests use `createEngine` (F8). |
| `StartOptions.target` removed | G9: cli resolves the target before the factory. |
| `Engine.workspace` kept, as `files.label` | F7 and O2. No server or cli change. |
| `startEngine` subscribes with `ignore: isHiddenKey` and emits a payload-free `documents-changed` | Keeps F29 and F30 (the UI uses no detail). F36: no key ever reaches a socket. F32: `.3pitor` saves never echo. |
| cli builds `files` and passes it to `startEngine` | G9, verbatim. |
| json-file over `files`, with a memoized `.gitignore` chain | F20 (`.gitignore`, call order) and F21 (missing or corrupt reads as `undefined`). The `.gitignore` is app policy, so it stays in the engine. |
| `stateKey` replaces `stateFile` | G4. Two server tests import it (F11) and change to `join(dir, stateKey(…))`. |
| Documents rules stay in the engine | F13–F19 are domain rules. Keeping them out of the backend keeps one copy for every backend (SRP). |
| Tools grammars stay, made lexical | F25 (three grammars on purpose, documents.ts:25-27) and F23 (the turn overlay). |

### Option A boundary and README implications (F46–F48)

README: "Six packages". New bullet: "`src/file-system/` holds every runtime file read and write behind
`file-system.ts`. It imports no other package." Engine: "imports only `src/shared/`, `src/file-system/file-system.ts`,
and npm packages." Cli: "imports `engine/engine`, `server/server`, and `file-system/file-system`."

New rule: no `node:fs`, `node:fs/promises`, `Bun.file`, `Bun.write`, or `Bun.Glob#scan` in cli, server, or engine
production code. Three exemptions:

- `engine/workspace-config/app-skills.macro.ts`, which runs at bundle time (F2)
- `*.test.ts` and `engine/chat/components/*` test helpers (F3)
- `server/scripts/check.ts` verification reads (F3). It imports `file-system/file-system` for `dataDir`/`resetWorkspace`,
  through the existing script allowance.

`check_boundaries.py` changes:

- E2 adds `file-system/file-system`.
- C1 adds `file-system/file-system`.
- A new rule FS1 bans the fs APIs above outside `src/file-system/`, with the exemptions listed.
- A new rule FS2: `src/file-system/` imports no other package.

Following F48, this also updates the `update-code-structure` skill and adds a change log. Following F49,
`engine/components/` keeps `json-file.ts` only.

### Option A behavior changes visible to users or the AI

- **BC1: symlinks.** Keys never pass through a symlink on disk.
  - This closes F41 (the browser reaching `.claude/` through a linked folder) and F42 (`.claude/skills` or `.3pitor`
    linked outside the workspace).
  - The tree shows no links today (F14), so the tree does not change.
  - The AI's Read through a linked folder fails with "<key> is a symlink", and Glob leaves those entries out.
  - A symlinked `.claude/skills` or `.claude/agents` is now silently ignored. A user who links shared skills loses them.
  - A symlinked `.3pitor/` makes state saves fail. They are logged as save errors.
- **BC2: atomic saves.** Document saves become temp plus rename instead of in-place `Bun.write` (F15). The content is
  the same. The inode changes, so hard links break and a custom file mode is reset to the default.
- **BC3: model-visible strings (F26).**
  - Edit on a missing post says `notes.md was not found` instead of Bun's raw ENOENT text.
  - Read keeps `<file_path> does not exist`, because tools keep that string.
  - An absolute path inside the workspace, which `resolve()` accepted until now, is refused with
    `<input> is outside the workspace`. The system prompt already tells the model to use relative paths
    (`system-prompt.md:75`).
- **BC4: case folding lost.** `postName('Notes.md')` no longer folds to `notes.md` on a case-insensitive disk
  (`tools.test.ts:34`). A model that types the wrong case edits a separate turn entry, and the UI's open file is not
  updated.
- **BC5: `..foo` (F45).** A root entry named `..foo` becomes reachable.
- **Unchanged:** all HTTP statuses and bodies; the `listening on` line; the `/api/health` body; `documents-changed`
  timing (100 ms quiet, 1 s cap); F21 corrupt-state behavior; the F37–F39 races.

---

## Option B: branded keys and scoped capabilities (separate stores for documents, state, and config)

The package exports a branded `Key`, which only `toKey()` can produce. The local factory returns a `Workspace` of scoped
stores, each with keys relative to its scope. The backend decides where each scope lives; for example, S3 could hold
documents while state stays local. This answers O1 with "separate". The hidden rule becomes structural: the documents
scope refuses hidden segments, so the package owns that piece of policy.

```ts
// src/file-system/file-system.ts
export type Key = string & { readonly __key: unique symbol };
export function toKey(input: string): Key;                         // throws FileSystemError('invalid')
export interface FileStore {                                       // same methods as Option A, over Key
  stat(key: Key): Promise<EntryKind | undefined>; read(key: Key): Promise<string>; write(key: Key, text: string): Promise<void>;
  createFolder(key: Key): Promise<void>; list(folder: Key): Promise<FileEntry[]>; move(from: Key, to: Key): Promise<void>;
  delete(key: Key): Promise<void>;
}
export interface Workspace {
  readonly label: string;
  documents: FileStore & { watch(listener: (events: FileEvent[]) => void): () => void }; // refuses hidden segments
  state: FileStore;                                                // local: <root>/.3pitor/
  config: Pick<FileStore, 'read' | 'list'>;                         // local: <root>/.claude/, read-only
  raw: Pick<FileStore, 'read' | 'list'>;                            // whole workspace: AI Read and Glob (F24) need it
}
export function createLocalWorkspace(root: string): Workspace;
// EngineOptions/StartOptions: { workspace: Workspace, … }. cli: createLocalWorkspace(await chooseWorkspace(target, env.WORKSPACE)).
```

Element justifications that differ from A:

| Element | Justification |
|---|---|
| Branded `Key` | F44 (canonicalize once, enforced by the type checker, not by convention). |
| `documents` scope refuses hidden names | F13 and F36 (structural hidden filter) and F41. |
| `state` scope | F22 (three state users). It answers O1, though O1 has no evidence either way. |
| Read-only `config` | F27 (config is only ever read). |
| `raw` scope | F24 (the AI's Read and Glob reach any workspace file). It is required, or this option breaks the AI. |
| `watch` only on documents | F29 and F30 (only documents events are consumed). |

The rest (errors, local mapping, events, cli wiring, moves) is as in A, with the same justifications.

**README implications.** Same as A. The new rule also says the documents scope's hidden policy lives in the package, so
README's documents description splits across two packages.

**Behavior changes.** Same as A, plus every test line wraps literals in `toKey()` (F8, 51 lines).

**Weaknesses.**

- The `raw` scope is needed, which collapses the separation the option exists to provide: one backend must still serve
  the whole workspace key space, as G5 says.
- O1 has no evidence that state lives elsewhere, so the scopes are speculative.
- The hidden rule moves into the package while `.md`, seeding, and the parent rules stay in the engine. That splits one
  policy across two packages.

---

## Option C: a document-semantic file system (the backend implements documents)

The package interface is today's `engine.documents` plus state and config. `documents.ts` moves almost whole into
`file-system/local/`. A Notion backend would map pages to documents directly.

```ts
// src/file-system/file-system.ts — imports DocumentEntry, FolderCount from shared/wire
export interface FileSystem {
  readonly label: string;
  documents: {
    list(): Promise<DocumentEntry[]>; read(key: string): Promise<string>; write(key: string, content: string): Promise<void>;
    create(key: string, kind: 'file' | 'folder'): Promise<void>;     // seeds "# <name>\n"
    move(from: string, to: string): Promise<void>; count(key: string): Promise<FolderCount>; delete(key: string): Promise<void>;
    watch(listener: (events: FileEvent[]) => void): () => void;      // already hidden-filtered
  };
  state: { readJson(name: string): Promise<unknown>; writeText(key: string, text: string): Promise<void> }; // .3pitor/
  config: { glob(pattern: string): Promise<string[]>; read(key: string): Promise<string> };                 // .claude/
  workspaceFiles: { read(key: string): Promise<string>; glob(pattern: string): Promise<string[]> };         // AI Read/Glob
}
export class FileSystemError extends Error { constructor(readonly reason: 'invalid' | 'not-found', message: string) }
// DocumentError disappears from the engine. engine.ts re-exports FileSystemError as DocumentError for the server routes.
```

Element justifications that differ from A:

| Element | Justification |
|---|---|
| `documents.*` shaped like `Engine['documents']` | F14–F19, kept verbatim with the least engine churn. |
| Two-reason error | F12 (unchanged mapping). |
| `state.readJson` | F21. |
| `config.glob`/`read` | F27 and F28. |
| `workspaceFiles` | F24. |
| Hidden filtering in the backend's watcher | F36. |

**README implications.** file-system imports `shared/wire`. The engine's documents feature becomes a pass-through.
Documents' rules (F13–F19) are described under the package instead of the engine.

**Behavior changes.** Fewest. The symlink gaps (F41, F42) stay open unless the moved code changes. F26 does not change.

**Weaknesses.**

- Every future backend re-implements the domain rules: the seed heading, `.md`-only, hidden policy, count semantics,
  case-only rename. The backend owns storage and domain policy.
- A rule change means editing every backend.
- Each backend gets four ad-hoc interfaces.
- G4's "key represents the path to the file" is reduced to documents' grammar.

---

## Recommendation: Option A

1. **It is the only option where swapping a backend means implementing storage only.** That is G3's stated purpose. A,
   B, and C all need eight or so methods per backend, but only A's methods carry no domain rule. C makes every future
   backend re-derive F13–F19.
2. **One key space is what G5 literally describes.** `.3pitor/session.json` and `.claude/skills/x/SKILL.md` are paths
   relative to the workspace root. B's scopes answer O1 without evidence and still need a `raw` scope for F24, so they
   cost structure and buy nothing today.
3. **Containment ends up in one place.** The grammar runs on every call (F40, F43, F44, F45), and the local backend
   closes F41 and F42 with a rule that is easy to state: keys never pass through symlinks. Hidden-key leakage (F36)
   cannot happen, because events stay payload-free past the engine.
4. **Events meet G6 honestly within F31.** Typed batches come from a snapshot diff of non-ignored keys. `renamed` is
   reported only when an inode pairs a delete with a create. The UI keeps its hint semantics (F30), and `createEngine`
   still starts no watcher (F32).
5. **The wiring is exactly G9's pattern.** cli resolves the folder and builds `files`, hands it to `startEngine`, then
   hands the engine to `startServer`. `Engine.workspace` survives as `files.label`, so no server code and no parsed
   output changes (F7).

**Decisions inside A to confirm, each with an alternative.**

- **No-follow symlinks (BC1).** The alternative keeps today's behavior of following links that stay inside the
  workspace, which leaves F41 open.
- **Atomic saves for documents (BC2).** The alternative is a `write(key, text, { replace: 'in-place' })` flag, but no
  finding asks for in-place writes.
- **`chooseWorkspace` in the package, with its own pinned `SRC` for the fixture.** The alternative is to move it to cli,
  which is rejected below.

---

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| A facade class wrapping a separate `FileBackend` port, so the package enforces keys, errors, and events for any backend | Two layers with one backend is over-abstraction. A's local backend calls the package's own key check. Reopen trigger: a second backend lands; then lift the shared checks into a wrapper. |
| `FileSystem` interface type in `src/shared/` so the engine still "imports only shared" (F46) | G1 asks for a package. The engine needs runtime values (`FileSystemError`, `toKey`, `glob`), not just types. `shared` is browser-importable. Rewriting the README sentence is cheaper and honest. |
| Raw events (`{type:'changed', key}`) passed straight from `fs.watch` | Fails G6's created/updated/renamed/deleted. F31 shows raw `fs.watch` events cannot be typed. |
| Events only from the package's own operations (no watcher) | Fails G7 ("facilitating the current file system watcher"). It misses edits made in other editors, which the UI depends on (F30). |
| Whole-workspace snapshot including hidden folders | Walks `.git`, and a cwd fallback (F9) can be a home folder. `ignore` keeps today's cost profile (F29). |
| Package hides every hidden key from all operations | Breaks state (F22), config (F27), and the AI's Read of `.claude/` (F24). |
| `chooseWorkspace` in `src/cli/` | Its `stat`, plus the fixture `cp`/`rm`, are file reads and writes outside the package (G2). It would also need a new cli → `engine/paths` import, which breaks C1. |
| A single `openLocalFileSystem(target, env)` that hides the root choice | Two steps keep `createLocalFileSystem` free of I/O (mirroring `createEngine`) and keep root choice visibly local-only. |
| Branded `Key` (Option B's element, on its own inside A) | It only adds a compile-time guarantee on top of per-call validation, and costs 51 test lines plus every route (F8). |
| Packaging documents' rules as a domain service inside the package | Same objection as Option C. |

---

## Cut list (plausible, but not asked for by the goal)

| Cut | What it would have done | Why cut / reopen trigger |
|---|---|---|
| S3, Notion, or other backend implementations | Prove G3 with real alternatives | G3 says "may", and the goal asks only for the initial implementation (G5). Consistency, auth, and integration choices are system-level. |
| In-memory backend as a test double | Faster engine tests without `mkdtemp` (F8) | One implementation. Tests keep using `createLocalFileSystem(tmp)`. Reopen when a second backend needs a shared contract suite or test runtime becomes measured friction. |
| A contract (conformance) test suite run against every backend | Guarantee substitutability | Only one backend. Reopen at the second. |
| Conditional writes, etags, version vectors | Fix F37's last-writer-wins and F39's lost AI note update | F37–F39 are single-user windows today. Reopen on a multi-tab data-loss report or a remote backend. |
| Exclusive create (`wx`) flag | Close F38's create race | Documents pre-checks via `stat` as today. Reopen with the conditional-write item. |
| Byte/binary and streaming read/write | Non-text files | Every file read today is text (F1, F22, F27). |
| `mtime`, size, and other metadata on `stat` or entries | Richer listings | No caller uses them. |
| `FileSystem.close()` / `Engine.close()` | Release watchers and clients (F33) | `watch` returns unsubscribe, and the process exits anyway. Reopen when a backend holds a connection or tests leak watchers. |
| `resync`/`error` event when watching stops | Tell the UI to re-list after a watcher failure (F33) | Today's behavior is logged and stops. Reopen if F33 bites in practice. |
| Event replay or a "subscribe then list" helper (F34) | Gap-free startup for late subscribers | The UI already re-syncs on connect (F30). |
| Shared single watcher per backend across subscribers | Fewer OS watches | There is one subscriber (the engine). |
| Case canonicalization of keys (BC4) | Fold `Notes.md` to the on-disk case | A local-disk-only feature, and the prompt names posts exactly. Reopen if BC4 shows up in use. |
| Telling transient from missing errors in `readJson` (F21) | Avoid overwriting state after a remote read blip | Local reads only. Reopen with a remote backend. |
| Server bind to 127.0.0.1 and an Origin check (F40) | Stop cross-site writes | Outside this package (server). A separate, recommended security change. |
| Permissions or auth on keys | Per-user access | There is one user. |
| Hidden-rule filtering for the AI's Read and Glob (F24, SEC-003) | Stop the model reading `.env` or `.git` | Today's behavior; the goal is about where I/O lives, not tool policy. Flagged as a separate security follow-up. |
| `EventBus` listener isolation in the engine (F35) | One throwing socket listener cannot starve the others | An engine concern, not this contract. The package isolates its own listeners. |
| Routing `app-skills.macro.ts` (F2) and `check.ts` verification reads (F3) through the package | Literal "all reads" | Bundle-time and test-harness reads, not workspace runtime I/O. Recorded as named exemptions to FS1. |
| Wiring `check_boundaries.py` into the Makefile (F47) | Enforce FS1 and FS2 automatically | The previous split left it manual too. |
| Native glob in the backend | Faster pattern search | F28: no remote backend can. The function over `list` is enough. |

## Deferred

- **Remote backends (S3, Notion)** to `system-architect`: integration, consistency, credentials, and whether app state
  lives in the same remote store (O1 for remote backends).
- **Option B's scoped stores (O1).** Trigger: a backend where `.3pitor/` cannot live beside documents.
- **Facade over a `FileBackend` port.** Trigger: a second backend.
- **In-memory backend.** Trigger: a second backend, or measured test-time friction.

**Unverified:** that Bun's `fs.watch` gives an inode-stable rename on every platform, and that `Bun.Glob#match` matches
`scan`'s dot handling exactly. No experiment was run; the ino pairing in `renamed` and the `glob` helper's parity rest on
platform behavior (F31 is itself `inferred`).

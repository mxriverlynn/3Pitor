---
goal: "similar to what we did for CLI and API, i want to separate all file operations into their own package all file reads and writes must happen through this package, using an abstraction layer that allows us to swap out the filesystem backend. for example, we may want to use AWS S3 buckets. or we may use Notion documents. or some other idea. the API needs to work from a file \"key\", which will represent the path to the file. the initial implementation will of this abstraction will expect the file \"key\" to be a path relative to the workspace root. this new package will also be able to raise events for files and folder being created, updated, renamed, deleted, etc, facilitating the current file system watcher as an implementation of the initial file system that works from actual files. i expect the engine to receive an instance of the file system package, as part of the factory/constructor that builds the engine. this means the CLI package will have to do the file system package constructor/factory, and pass the results to the engine constructor/factory, similar to how the engine is passed into the API factory"
goal_source: "described in conversation (/han-coding:design-an-api, 2026-10-02)"
interface: "A new src/file-system/ package (a key-based FileSystem interface plus the local-disk implementation and its watcher), the engine factories in src/engine/engine.ts that now take it, and src/cli/cli.ts, which builds it"
size: "large"
size_reason: "Many file-touching consumers across the engine, typed watcher events as part of the contract, file keys arriving from the browser and the AI, and errors crossing the new package boundary"
roster: "han-core:codebase-explorer, han-core:structural-analyst, han-core:behavioral-analyst, han-core:concurrency-analyst, han-core:adversarial-security-analyst, han-core:software-architect, han-core:junior-developer, han-core:adversarial-validator"
starting_point: "working tree (identical to main at 84d5540; branch file-system-package)"
git_available: "yes"
---

# API Design: The `file-system` Package

## Summary

Every runtime file read and write moves into a new package, `src/file-system/`. Its single entry module,
`file-system.ts`, exposes:

- a `FileSystem` interface over keys, which are workspace-relative `/` paths
- one key grammar that the package enforces on every call
- a three-reason `FileSystemError`
- typed `created`/`updated`/`renamed`/`deleted` batches from `watch`, plus a coarse `changed` event when it cannot
  tell what changed

The local implementation, `createLocalFileSystem(root)`, replaces today's direct `node:fs` and `Bun.file` calls and the
recursive watcher. The CLI chooses the folder, builds the file system, and passes it to `startEngine` as `fileSystem`,
the same way it passes the engine to `startServer`. Document rules, tool path policy, and app-state policy stay in the
engine, rewritten on top of the interface.

- **Option chosen.** Option A: a generic key store with one key space, with document rules kept in the engine. It was
  chosen over Option B, scoped stores with branded keys, and Option C, a backend that implements document semantics
  itself. Only A lets a new backend such as S3 or Notion implement storage alone.
- **Decisions at the gates.** You told earlier planning runs to "make the best decisions you can, without asking me".
  Under that instruction this run settled both gates itself:
  - the option pick (D1)
  - all 34 question-round questions (D2–D32)
  - ten points settled while amending (D33–D42)

  Each is logged in [artifacts/decision-log.md](./artifacts/decision-log.md). Every behavior change they cause is listed
  under Behavior Changes, BC1–BC14. The most visible ones:
  - Keys never pass through a symlink below the workspace (BC1).
  - Saves write the new text to a temp file first, then copy it into the original, so a failed save never damages the file and the file keeps its links and attributes (BC2, D43). The app's own `.3pitor/` state uses an atomic rename.
  - A few strings the AI sees change (BC3).
- **Validation outcome.** The adversarial validator found no design-killer. Its experiments on macOS settled three risks
  the design had marked unverified:
  - Bun reports every change as `rename`.
  - `Bun.Glob#match` ignores the dot option.
  - APFS does not reuse inodes.

  Of its 15 findings, 14 were accepted. They changed the design to:
  - fix glob's handling of hidden names
  - keep refreshing the UI when the watcher cannot type a change
  - refuse FIFOs and other special files
  - keep file modes on atomic saves
  - cap the watcher at 10,000 entries

  One finding was rejected: renaming `FileSystem` to avoid the DOM type of the same name (V14).
- **Coverage.** The run's size limit left out `han-core:on-call-engineer` (code-level resilience) and `han-core:data-engineer`.
  Neither domain is central here: no schema and no outbound calls.

## The Goal This Serves

> "similar to what we did for CLI and API, i want to separate all file operations into their own package all file reads and writes must happen through this package, using an abstraction layer that allows us to swap out the filesystem backend. for example, we may want to use AWS S3 buckets. or we may use Notion documents. or some other idea. the API needs to work from a file "key", which will represent the path to the file. the initial implementation will of this abstraction will expect the file "key" to be a path relative to the workspace root. this new package will also be able to raise events for files and folder being created, updated, renamed, deleted, etc, facilitating the current file system watcher as an implementation of the initial file system that works from actual files. i expect the engine to receive an instance of the file system package, as part of the factory/constructor that builds the engine. this means the CLI package will have to do the file system package constructor/factory, and pass the results to the engine constructor/factory, similar to how the engine is passed into the API factory"

The goal breaks into these clauses, cited as G1–G9:

- **G1:** "separate all file operations into their own package"
- **G2:** "all file reads and writes must happen through this package"
- **G3:** "using an abstraction layer that allows us to swap out the filesystem backend. for example, we may want to use AWS S3 buckets. or we may use Notion documents"
- **G4:** "the API needs to work from a file "key", which will represent the path to the file"
- **G5:** "the initial implementation … will expect the file "key" to be a path relative to the workspace root"
- **G6:** "raise events for files and folder being created, updated, renamed, deleted, etc"
- **G7:** "facilitating the current file system watcher as an implementation of the initial file system that works from actual files"
- **G8:** "i expect the engine to receive an instance of the file system package, as part of the factory/constructor that builds the engine"
- **G9:** "the CLI package will have to do the file system package constructor/factory, and pass the results to the engine constructor/factory, similar to how the engine is passed into the API factory"

## The Designed Contract

### Surface

**Package layout** (D6: package → feature → component)

```text
src/file-system/
  file-system.ts                     entry: contract types and re-exports. The only module of this package that anything
                                     outside src/file-system/ imports (boundary.test.ts enforces this, V13).
  boundary.test.ts                   D9/V13: no fs API outside this package; entry-only imports; engine uses contract symbols only
  components/                        shared by this package's features (README "components/" rule)
    file-system-error.ts             FileSystemError, FileSystemErrorReason
    keys.ts                          checkKey (strict grammar), normalizeKey (loose input), parentKey
    keys.test.ts                     the grammar table
  glob/                              a feature with one component, so its files sit in the feature folder
    glob.ts                          glob(fileSystem, pattern, { dot })
    glob.test.ts                     includes the scan parity table (V1)
  local/                             feature: the local-disk backend (two components, so one folder each)
    local-file-system/
      local-file-system.ts           createLocalFileSystem(root); per-key write queue; segment walk; errno map
      local-file-system.test.ts
      watch.ts                       helper that only local-file-system.ts imports: the snapshot-diff watcher
      watch.test.ts
    workspace/
      workspace.ts                   chooseWorkspace, ensureWorkspace, resetWorkspace (moved from engine/workspace/)
      workspace.test.ts
```

These are deleted:

- `src/engine/components/workspace-path.ts` and `workspace-path.test.ts`
- `src/engine/workspace/workspace.ts` and `workspace.test.ts` (the test moves to the package)
- `dataDir` (D33)

After the change, `src/engine/components/` holds only `json-file.ts` (F49).

**Entry module: `src/file-system/file-system.ts`**

```ts
// The file-system package: every runtime file read and write, behind one key-based contract. cli builds an instance
// and hands it to the engine (G9). Imports no other package.

// "file": a regular file. "folder": a directory. "other": anything else. On local disk that is a symlink, socket, FIFO,
// or device. Remote backends never return "other" (D14). How callers treat it: list callers drop it, count counts it
// as a file (F19), glob skips it, and read/write refuse it (V7).
export type EntryKind = 'file' | 'folder' | 'other';

export interface FileEntry {
  key: string;         // the full key, not just the name
  kind: EntryKind;
}

// Changes arrive in batches (G6). A folder delete or rename is one event, and its descendants are implied (D19).
// A created folder is followed by one created event for each key under it. No other order is promised.
// 'changed': the backend saw activity it could not type: an empty diff after raw events (V3), or the local snapshot
// cap was passed (V9). Treat it as "re-list everything".
export type FileEvent =
  | { type: 'created'; key: string; kind: 'file' | 'folder' }
  | { type: 'deleted'; key: string; kind: 'file' | 'folder' }
  | { type: 'updated'; key: string; kind: 'file' }
  | { type: 'renamed'; from: string; to: string; kind: 'file' | 'folder' }
  | { type: 'changed' };

export interface WatchOptions {
  // Called for a folder key before the watcher descends into it, and for a file key before the watcher tracks it.
  // A key for which this returns true is never walked, tracked, or reported, and neither is anything under it (D15).
  // It is never called with "".
  ignore?: (key: string) => boolean;
}

export interface FileSystem {
  // Where the files live, for display only. Local: the root exactly as passed to createLocalFileSystem (D2, D11).
  readonly location: string;

  // Does not follow links (D21). Returns undefined when nothing is there, or when a parent segment is missing or is
  // not a folder. A link as the final segment → 'other'. A link as a middle segment → rejects 'invalid'.
  // "" is the root.
  stat(key: string): Promise<EntryKind | undefined>;

  // Reads utf-8 text. A missing key → 'not-found'. A final-segment link → 'invalid' "<key> is a symlink".
  // Any other non-regular item → 'invalid' "<key> is not a regular file" (V7).
  read(key: string): Promise<string>;

  // Writes the text to a temp file in the system temp folder, then copies it into the existing file (D43). A failed
  // write never damages the file, and the file keeps its identity: hard links, xattrs, mode, owner, birthtime. A reader
  // may briefly see a partial file during the copy. With { atomic: true }, a temp file beside the target is renamed
  // over it instead, so a reader never sees half a file, but the file is replaced (json-file's .3pitor/ writes use this).
  // Missing parent folders are created (D22). The write is queued when called, before any await, so writes to one key land in call order across the process (D3).
  // Keys are compared as given: two letter-case spellings of one file on a case-insensitive disk are separate
  // queues (V10). A key that is a folder → 'invalid' "<key> is a folder" (D26). Non-regular items are refused as in
  // read (V7). An existing file that is not writable → EACCES passes through (V6).
  write(key: string, text: string, options?: { atomic?: boolean }): Promise<void>;

  // The parent must exist and be a folder. An existing item at key → 'exists'.
  createFolder(key: string): Promise<void>;

  // Direct children, in no order. "" lists the root. A missing key, or one that is not a folder → 'not-found'.
  // A final-segment link → 'invalid'.
  list(folder: string): Promise<FileEntry[]>;

  // First waits for writes already queued under from and to (D4). Refuses: a move into itself (checked lexically,
  // plus by real path on local disk, V5); an existing target unless it is the same stored item (D25); a missing
  // target parent. A final-segment link moves as a link.
  move(from: string, to: string): Promise<void>;

  // Recursive. First waits for writes already queued under key (D4). A link is removed as a link.
  delete(key: string): Promise<void>;

  // Delivers non-empty batches after each settled burst (100 ms quiet / 1 s cap) and returns an idempotent
  // unsubscribe. A throw from the listener is caught and logged. Lazy: nothing is watched until this is called,
  // so createEngine starts no watcher.
  watch(listener: (events: FileEvent[]) => void, options?: WatchOptions): () => void;
}

export { FileSystemError, type FileSystemErrorReason } from './components/file-system-error';
export { normalizeKey, parentKey } from './components/keys';                       // parentKey exported (V4)
export { glob } from './glob/glob';
export { createLocalFileSystem } from './local/local-file-system/local-file-system';
export { chooseWorkspace, ensureWorkspace, resetWorkspace } from './local/workspace/workspace';
```

```ts
// src/file-system/components/file-system-error.ts
export type FileSystemErrorReason = 'invalid' | 'not-found' | 'exists';
// invalid: can never succeed as asked. not-found: the item, or a target's parent, is missing. exists: the target is taken.
export class FileSystemError extends Error {
  constructor(readonly reason: FileSystemErrorReason, message: string) { super(message); }
}
```

```ts
// src/file-system/components/keys.ts
// The strict grammar that every method applies to its key arguments. It never canonicalizes.
// "" (the root) is accepted only where allowRoot is set (stat, list).
export function checkKey(key: string, options?: { allowRoot?: boolean }): void;
//   throws FileSystemError('invalid', `${JSON.stringify(key)} is not a valid key`)

// Only for loose, untrusted model input (D13). Browser keys never pass through it.
// "./notes.md" → "notes.md"; "a/../b.md" → "b.md"; "a//b/" → "a/b"; "." → "".
// Absolute or escaping input → FileSystemError('invalid', `${input} is outside the workspace`).
// The canonical result is then checked with checkKey(…, { allowRoot: true }) (F44: validate after canonicalizing).
export function normalizeKey(input: string): string;

// "a/b/c.md" → "a/b"; "c.md" → "" (the root). Used for parent lookups.
// Messages use posix dirname instead, which gives "." at the top level.
export function parentKey(key: string): string;
```

**Glob: `src/file-system/glob/glob.ts`** (written over the interface, so it works on any backend; F28)

```ts
export function glob(fileSystem: FileSystem, pattern: string, options?: { dot?: boolean }): Promise<string[]>;
// 1. A leading "./" is stripped from the pattern (V1).
// 2. The walk uses list(), starting at the pattern's literal prefix: its leading segments that hold no glob
//    characters. If the pattern has no "**", the walk goes no deeper than the pattern has segments.
// 3. With dot: false (the default), a name starting with "." is entered or returned only when the pattern segment
//    aligned with it starts with a literal "." (V1). A brace group counts when one of its alternatives starts with ".".
//    Segments before the first "**" align by position. A segment after a "**" may align with any depth at or below
//    it. "**" itself never matches a hidden name. dot: true enters and returns every name. A hidden folder that no
//    segment allows is never listed (D28).
// 4. Each file key the walk reaches is tested with Bun.Glob#match(pattern-without-"./").
//    'other' entries are skipped (D14).
// 5. A missing prefix, or a prefix refused as 'invalid', gives []. Other errors propagate.
//    Keys are returned in no order.
// The parity table in glob.test.ts (patterns × dot, compared against Bun.Glob#scan) decides correctness. Where they
// differ, the rule above is adjusted to match scan.
```

**Local backend: `src/file-system/local/local-file-system/local-file-system.ts`**

```ts
// Synchronous, no I/O (mirrors createEngine). root must be absolute, else throws Error(`${root} is not an absolute path`).
// location = root exactly as passed (D2, D11).
export function createLocalFileSystem(root: string): FileSystem;

// Imported only by local-file-system.test.ts (boundary.test.ts forbids importing this module path from outside the
// package). It returns the number of pending queue entries (V10).
export function pendingWriteCount(): number;

// --- internals, described at signature level ---

// Process-wide map, keyed by the absolute disk path join(root, key) (D3). Every instance on the same root string
// shares it. An entry is deleted once its tail settles, unless a later write has replaced it (V10).
const pending: Map<string, Promise<void>>;

// Walks the key's segments below root with lstat. The components of root itself are never checked (D2).
// It reports the parent as one of three states (V8):
// - a middle segment that is a symlink → throws FileSystemError('invalid', `${key} is outside the workspace`) (D35)
// - a middle segment that is missing (or root missing) → { path, parent: 'missing' }
// - a middle segment that is not a folder (file or other) → { path, parent: 'not-folder' }
// - otherwise → { path, parent: 'folder', stats?: lstat of the final segment }
async function locate(root: string, key: string):
  Promise<{ path: string; parent: 'folder' | 'missing' | 'not-folder'; stats?: Stats }>;

// read(key):   checkKey → locate → parent ≠ 'folder' or no stats → 'not-found' `${key} was not found`
//              → symlink → 'invalid' `${key} is a symlink`; other non-regular → 'invalid' `${key} is not a regular file`
//              → readFile(path, 'utf8')
// write(key, text):
//   checkKey(key) → enqueue on pending[path] at call time →
//   locate → parent 'not-folder' → 'not-found' `${dirname(key)} was not found`
//          → parent 'missing' → mkdir(dirname(path), { recursive: true })
//          → final is a symlink → 'invalid' `${key} is a symlink`
//          → final is a folder → 'invalid' `${key} is a folder` (D26)
//          → final is another non-regular item → 'invalid' `${key} is not a regular file` (V7)
//          → final is a regular file → access(path, W_OK) (EACCES passes through unchanged, V6); mode = stats.mode & 0o7777
//   default (D43): temp = join(tmpdir(), `3pitor-${pid}-${n}.tmp`); Bun.write(temp, text);
//     writeFile(path, readFile(temp)) — the same file, written in place; rm(temp) always, best effort
//   atomic: temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`); Bun.write(temp, text); rename(temp, path);
//     on failure rm(temp) best effort, then reject with the original error (D27)
//   tail = write.catch(() => {}); pending.set(path, tail); tail.then(() => pending.get(path) === tail && pending.delete(path))
// createFolder(key): checkKey → locate → parent ≠ 'folder' → 'not-found' `${dirname(key)} was not found`
//              → stats → 'exists' `${key} already exists` → mkdir(path)
// list(key):   checkKey(allowRoot) → "" : stat(root) not a folder → 'not-found' `the workspace root was not found`
//              → else locate → parent ≠ 'folder' or no stats or not a dir (non-link) → 'not-found' `${key} was not found`
//              → symlink → 'invalid' `${key} is a symlink` → readdir withFileTypes → FileEntry[]
// move(from, to):
//   checkKey both → await queued writes under from and to (D4) → locate(from): parent ≠ 'folder' or no stats →
//   'not-found' `${from} was not found`
//   → to === from || to.startsWith(from + '/') → 'invalid' `${from} cannot move into itself` (lexical, F43)
//   → locate(to); realSource = from is a link ? join(realpath(dirname(path)), basename) : realpath(path)
//     realTargetParent = realpath of the target parent's nearest existing ancestor + the remaining segments
//     realTargetParent === realSource or starts with realSource + sep → 'invalid' `${from} cannot move into itself` (V5)
//   → target stats present and not the same (dev, ino) → 'exists' `${to} already exists` (D25)
//   → target parent ≠ 'folder' → 'not-found' `${dirname(to)} was not found` → rename(path(from), path(to))
// delete(key): checkKey → await queued writes under key (D4) → locate → parent ≠ 'folder' or no stats →
//   'not-found' `${key} was not found` → rm(path, { recursive: true })
// "Queued writes under p": every pending entry whose path === p or starts with p + sep. Only writes queued before
//   the call are awaited.
// errno map, applied to the final act only (a race after the checks): ENOENT/ENOTDIR → 'not-found' `${key} was not found`,
//   EEXIST → 'exists' `${key} already exists`. Every other errno is rethrown unchanged (F12).
// watch(listener, options) → watchLocal(root, listener, options)
```

**Local watcher: `src/file-system/local/local-file-system/watch.ts`** (a helper imported only by `local-file-system.ts`)

```ts
export function watchLocal(
  root: string,
  listener: (events: FileEvent[]) => void,
  options: WatchOptions,
  limit = 10_000,                     // snapshot cap (V9); tests pass a small number
): () => void;
// 1. fs.watch(root, { recursive: true }) starts synchronously. A synchronous throw propagates, as today (D41).
// 2. The snapshot { key → { kind, dev, ino, mtimeMs, size } } of non-ignored keys is built asynchronously (D20).
//    It skips 'other' entries, names matching /^\..+\.\d+\.tmp$/ (D40), and ignored keys. ignore is checked on a
//    folder before the build descends into it (D15). Raw events that arrive during the build are held, then settled
//    in the first burst after the build.
// 3. If the snapshot would hold more than `limit` entries, during the build or after a diff, it is dropped and the
//    watcher switches to coarse mode for the rest of this subscription (V9). On the switch it logs once with
//    console.warn: `Watching the workspace without change details: more than <limit> entries`.
//    In coarse mode, each burst that holds any non-ignored raw event delivers [{ type: 'changed' }].
// 4. Handling a raw event: key = filename with platform separators turned into "/". If ignore() is true for the key
//    or any ancestor, the event is dropped and starts no timer (F32). Otherwise the event marks the parent folder
//    dirty, and marks the key too if it is a tracked folder. A raw event of any kind on a tracked file key adds that
//    key to `touched` (V2: macOS reports every event as 'rename'). A null filename marks the whole tree dirty.
// 5. Settling (100 ms quiet / 1 s cap): re-list each dirty folder and diff it against the snapshot.
//    - a key that is gone and a new key share (dev, ino, kind) → renamed (a folder's subtree is re-keyed;
//      no descendant events)
//    - present before and after with a changed ino (a temp-and-rename save) → updated (D17)
//    - same ino with a changed mtimeMs or size, or the key is in `touched` → updated (D17, V2)
//    - gone → deleted (a folder is reported once, and its subtree is dropped from the snapshot) (D19)
//    - new → created; a new folder is walked and each new descendant is reported as created (D36)
//    - the burst held non-ignored raw events but the diff is empty → [{ type: 'changed' }] (V3)
//    The listener is called only with a non-empty batch (D17). A throw from the listener is logged as
//    `Could not report a workspace change: <message>` (today's string).
// 6. A watcher 'error' event, or a read error other than ENOENT/ENOTDIR during the build or a diff:
//    log `Stopped watching the workspace: <message>` (today's string), close the watcher, and clear the timers
//    (F33, D20).
// 7. Unsubscribe: close fs.watch, clear the timers, and drop the snapshot. A pending burst is never delivered.
//    Unsubscribing twice is safe.
```

**Workspace choice: `src/file-system/local/workspace/workspace.ts`** (moved here; D5)

```ts
// Picks the root to open: the folder named, or the folder holding a named file. A name that does not exist warns and
// falls back to process.cwd(). With no name: workspaceEnv (seeded from fixture if absent), else process.cwd().
// Always returns an absolute path.
export function chooseWorkspace(
  name: string | undefined,
  options: { workspaceEnv: string | undefined; fixture: string },
): Promise<string>;
export function ensureWorkspace(path: string, fixture: string): Promise<string>;   // cp fixture → path only if path is absent
export function resetWorkspace(path: string, fixture: string): Promise<string>;   // rm path; cp fixture → path
// dataDir is removed (D33).
```

**`src/engine/paths.ts` and `src/engine/engine.ts`** (changes only)

```ts
// src/engine/paths.ts
export const SRC = resolve(import.meta.dir, '..');
export const WORKSPACE_FIXTURE = join(SRC, 'fixtures/workspace');      // D34
```

```ts
// src/engine/engine.ts
import type { FileSystem } from '../file-system/file-system';
import { countContents, createEntry, deleteEntry, isHiddenKey, listEntries, moveEntry, readDocument, writeDocument } from './documents/documents';
// no import of ./workspace/workspace (deleted)

export { DocumentError } from './documents/documents';
export { WORKSPACE_FIXTURE } from './paths';                            // D5/D34: cli and check.ts get the fixture here
export type { McpServerEntry, ServeTools, ToolEndpoint } from './chat/claude-cli/claude-cli';

export interface EngineOptions {
  fileSystem: FileSystem;            // D12, G8
  model?: string;
  claude: ClaudeMode;
  maxSteps?: number;
  serveTools: ServeTools;
}

export interface StartOptions {      // `target` removed (G9)
  fileSystem: FileSystem;
  claude: ClaudeMode;
  model?: string;
  serveTools: ServeTools;
}

export interface Engine {
  readonly workspace: string;        // = fileSystem.location, for display only (D11, F7)
  /* documents, sessions, viewState, workspaceConfig, events: unchanged */
}

export function createEngine(options: EngineOptions): Engine;  // unchanged: synchronous, no I/O, no watcher

export async function startEngine({ fileSystem, claude, model, serveTools }: StartOptions): Promise<Engine> {
  const { engine, events, sessions } = wire({ fileSystem, claude, model, serveTools });
  // One payload-free hint per batch, whatever the event types, including 'changed' (D18, F30, V3).
  // Hidden keys are never tracked or reported (F36, F32). The unsubscribe is discarded (F33).
  fileSystem.watch(() => events.emit({ type: 'documents-changed' }), { ignore: isHiddenKey });
  await sessions.load();
  /* backend label + warning: unchanged */
  return engine;
}

function wire(options: EngineOptions) {
  const { fileSystem } = options;
  // workspace: fileSystem.location
  // documents.list: () => listEntries(fileSystem), read: (p) => readDocument(fileSystem, p), … (each takes fileSystem)
  // viewState: loadViewState(fileSystem) / saveViewState(fileSystem, view)
  // workspaceConfig.names: loadWorkspaceConfig(fileSystem)
  // new Sessions(options, events): options.fileSystem flows into AgentOptions
}
```

**`src/cli/cli.ts`**

```ts
import { join } from 'node:path';
import { WORKSPACE_FIXTURE, startEngine } from '../engine/engine';
import { chooseWorkspace, createLocalFileSystem } from '../file-system/file-system';
import { serveTools, startServer } from '../server/server';

const { target, claude } = commandLine();                    // --version/--help exit before any workspace I/O
const root = await chooseWorkspace(target, { workspaceEnv: process.env.WORKSPACE, fixture: WORKSPACE_FIXTURE });
const fileSystem = createLocalFileSystem(root);
const engine = await startEngine({ fileSystem, claude, model: process.env.MODEL, serveTools });
const server = startServer(engine, { /* unchanged */ });
console.log(`3pitor listening on ${server.url.origin} (workspace: ${join(engine.workspace)})`);   // unchanged
```

**`src/server/scripts/check.ts`** (changes only)

```ts
import { SRC } from '../../engine/paths';
import { WORKSPACE_FIXTURE } from '../../engine/engine';
import { resetWorkspace } from '../../file-system/file-system';
const WORKSPACE = join(SRC, '.data', 'check-workspace');     // D33
await resetWorkspace(WORKSPACE, WORKSPACE_FIXTURE);
// The readDoc and summary.md checks keep using Bun.file (a named exemption, F3).
```

**`src/engine/components/json-file.ts`**

```ts
import { FileSystemError, type FileSystem } from '../../file-system/file-system';

export const stateKey = (name: 'session.json' | 'view.json') => `.3pitor/${name}`;   // replaces stateFile (F11)
const GITIGNORE = '.3pitor/.gitignore';

// not-found → undefined, silently. Any other failure, or text that does not parse → console.warn(`Could not read ${key}: …`)
// and undefined (F21 kept; BC11).
export function readJson(fileSystem: FileSystem, key: string): Promise<unknown>;

// JSON.stringify runs at call time, so the value is captured then.
export function writeJson(fileSystem: FileSystem, key: string, value: unknown): Promise<void>;

// fileSystem.write(key, text) is issued before any await, so the package's queue keeps call order (D3, D39).
// Alongside it: if stat(GITIGNORE) is undefined, write "*\n" to GITIGNORE. This is checked on every write, with no
// memo (D23). A user's own file is left alone, and two instances racing both write "*". The call resolves when both
// settle and rejects with the first failure, for this call only. If the .gitignore write fails, the content may
// already have landed.
export function writeText(fileSystem: FileSystem, key: string, text: string): Promise<void>;
```

**Engine feature signature changes**

```ts
// engine/documents/documents.ts: the rules stay here (F13–F19); I/O goes through fileSystem; FileSystemError → DocumentError
export class DocumentError { /* unchanged: 'invalid' | 'not-found' */ }
export function checkPath(path: string, kind: 'file' | 'folder'): void;                 // unchanged
export const isHiddenKey: (key: string) => boolean;                                     // true when any segment starts with "."
export function listEntries(fileSystem: FileSystem): Promise<DocumentEntry[]>;
//   Recursive list from "". Skips hidden names and 'other'. Keeps .md files only. A FileSystemError on a non-root
//   folder → skipped (it vanished mid-walk). Root not-found → rethrown as a plain Error (D16 → 500). Sorted with "<".
export function readDocument(fileSystem: FileSystem, path: string): Promise<string>;     // checkPath(path,'file'); read
export function writeDocument(fileSystem: FileSystem, path: string, content: string): Promise<void>;  // checkPath; write
export function createEntry(fileSystem: FileSystem, path: string, kind: 'file' | 'folder'): Promise<void>;
//   checkPath; stat(path): 'other' with kind 'file' → invalid `${path} is a symlink` (today's string); any other
//   defined result → invalid `${path} already exists`; stat(parentKey(path)) !== 'folder' → not-found
//   `${dirname(path)} was not found` (the D22 pre-check is kept); folder → createFolder;
//   file → write(path, `# ${basename(path,'.md')}\n`)
export function moveEntry(fileSystem: FileSystem, from: string, to: string): Promise<void>;
//   checkPath(from,'folder'); stat(from) → undefined → not-found `${from} was not found`; real kind: 'folder' → folder,
//   'file' or 'other' → file (V5); checkPath(from, kind) and checkPath(to, kind); fileSystem.move
export function countContents(fileSystem: FileSystem, path: string): Promise<FolderCount>;
//   Recursive list: a folder → folders++ and recurse; a file or other → files++. A non-folder item →
//   { files: 0, folders: 0 } (D38)
export function deleteEntry(fileSystem: FileSystem, path: string): Promise<void>;
// Error mapping: FileSystemError 'exists' → DocumentError('invalid'); other reasons are kept; the message passes
// through unchanged (F12).
// watchDocuments: removed (it moved into the package as watch.ts)
```

```ts
// engine/chat/agent/agent.ts
export interface AgentOptions { fileSystem: FileSystem; model?: string; claude: ClaudeMode; serveTools: ServeTools }
//   loadWorkspaceConfig(options.fileSystem); fileTools(options.fileSystem, turn, progress)

// engine/chat/sessions/sessions.ts: SessionsOptions extends AgentOptions; its shape is otherwise unchanged
//   readJson(this.options.fileSystem, stateKey('session.json')); turnTexts(documents);
//   writeJson(this.options.fileSystem, stateKey('session.json'), …)

// engine/chat/tools/tools.ts: lexical grammars over normalizeKey; no node:fs, no Bun.file, no Bun.Glob
export function turnTexts(documents: Record<string, string>): TurnTexts;                // the workspace argument is dropped
export function postName(filePath: string): string;                                     // pure; no case folding (BC4)
export function fileTools(fileSystem: FileSystem, turn: TurnTexts, onChange?: () => void);
//   resolvePost(filePath): starts with APP_SKILL_PREFIX → `${filePath} is not a markdown post`;
//     key = normalizeKey(filePath); not .md, or any segment starts with "." → `${filePath} is not a markdown post`
//   resolveAppNote(filePath): a key under ".3pitor/" that ends in .md, with no hidden segment after ".3pitor" → key;
//     else undefined
//   Read: appSkillText → turn copy → fileSystem.read(normalizeKey(file_path)); not-found → `${file_path} does not exist`;
//     invalid passes through (e.g. `link.md is a symlink`, BC1/BC3)
//   Write note: writeText(fileSystem, key, content) → `wrote ${key}`
//   Edit note: read; not-found → `${file_path} does not exist`; writeText(…) → `edited ${key}`
//   Edit/Highlight post: the turn copy, else fileSystem.read(key) (a not-found message passes through: BC3)
//   Write post: the turn copy, else read, with not-found → ''
//   Glob: the same refusal of absolute and ".." patterns; (await glob(fileSystem, pattern)).sort().join('\n');
//     insideWorkspace is removed

// engine/workspace-config/workspace-config.ts
export function loadWorkspaceConfig(fileSystem: FileSystem): Promise<WorkspaceConfig>;
//   scan = glob(fileSystem, pattern, { dot: true }); readMarkdown = parseFrontmatter(await fileSystem.read(key))

// engine/view-state/view-state.ts
export function loadViewState(fileSystem: FileSystem): Promise<ViewState>;
export function saveViewState(fileSystem: FileSystem, view: ViewState): Promise<void>;

// engine/chat/components/chat-test-helpers.ts (a test helper)
export function withWorkspace(run: (workspace: string, turn: TurnTexts, fileSystem: FileSystem) => Promise<void>);
//   The third parameter is appended and built with createLocalFileSystem(workspace), so the four existing callers
//   keep compiling.
```

**`src/file-system/boundary.test.ts`** (D9, V13)

```ts
// G2: reads and writes "must" go through the package. This runs inside make test, because Makefile test-server lists
// src/file-system (D42).
const FS_API = [
  /(\bfrom|\bimport)\s+['"](node:)?fs(\/promises)?['"]/,                 // static and side-effect imports
  /\b(require|import)\s*\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/,      // require and dynamic import (V13)
  /\bBun\.file\s*\(/, /\bBun\.write\s*\(/, /\bBun\.Glob\b/,
];
const FS_EXEMPT = [                                    // named files only (V13)
  'src/engine/workspace-config/app-skills.macro.ts',   // bundle-time macro (F2)
  'src/engine/chat/components/chat-test-helpers.ts',   // test fixture (F3)
  'src/engine/chat/components/fake-claude.ts',         // test fixture (F3)
  'src/engine/chat/components/fake-claude-on-path.ts', // test fixture (F3)
  'src/server/scripts/check.ts',                       // end-to-end check's verification reads (F3)
];
// The engine may import only contract symbols from the entry module (V13).
const ENGINE_CONTRACT = new Set(['FileSystem', 'FileEntry', 'EntryKind', 'FileEvent', 'WatchOptions',
  'FileSystemError', 'FileSystemErrorReason', 'normalizeKey', 'parentKey', 'glob']);
const ENGINE_CONTRACT_EXEMPT = ['src/engine/chat/components/chat-test-helpers.ts'];   // builds a local instance for tests

test('no production module outside src/file-system/ touches the disk directly');
//   Scans src/**/*.{ts,tsx} except *.test.ts(x), src/file-system/**, and FS_EXEMPT. Lists path:line for each hit.
test('nothing outside src/file-system/ imports a package module other than file-system/file-system');
//   Scans src/** including tests. Any import specifier that ends in file-system/<anything but file-system> is a hit.
test('engine production code imports only contract symbols from the file-system entry');
//   Scans src/engine/** except *.test.ts(x) and ENGINE_CONTRACT_EXEMPT. Every named import or re-export from
//   file-system/file-system must be in ENGINE_CONTRACT (so createLocalFileSystem and chooseWorkspace are refused).
test('every exemption names a file that exists');      // a stale exemption fails
```

### Invariants

**Key grammar.** The grammar is exact and the same on every OS (D29).

```text
key     := "" | segment ( "/" segment )*
segment := one or more characters, other than "." and "..", containing no "/", "\" or U+0000
```

- `""` is the root. Only `stat` and `list` accept it.
- Anything else fails the grammar with `invalid`: a leading or trailing `/`, an empty segment, a `.` or `..` segment, `\`, or NUL. This adds no rule beyond today's lexical rules (F13).
- `..foo` is a valid key (F45, BC5).
- The grammar has no hidden-name rule. Hidden-name policy belongs to the engine: `checkPath`, `isHiddenKey`, and the tools' grammars (F25).

**Canonicalization.**

- Methods never canonicalize. Keys are compared byte for byte, with no case folding and no Unicode normalization.
- Only `normalizeKey` canonicalizes. It runs, in order:
  1. posix normalize
  2. strip a trailing `/`
  3. map `.` to `""`
  4. refuse absolute or `..`-escaping results
  5. `checkKey`

  Validation runs on the canonical form (F44).
- Browser keys never pass through `normalizeKey`, so `a/./b.md` is refused rather than rewritten (D13).

**Root (D2, D16).**

- `root` must be absolute, and `location === root` exactly as passed.
- The components of the root path are never checked for links. So a workspace opened through a link works, and so does `/var` → `/private/var`.
- A missing root, or a root that is not a folder, gives `stat("") → undefined` and `list("") → not-found`. `listEntries` rethrows that as a plain `Error`, so `GET /api/documents` stays a 500.

**Links and non-regular items (D21, BC1, V7).**

- Below the root, a key never passes through a symlink. This closes the static case of F41 and F42. A link swapped in between the check and the act is not covered (V12; see Open Risks).
- A link as a middle segment: every method rejects with `invalid` `<key> is outside the workspace`.
- A link as the final segment:
  - `stat` gives `'other'`, and `list` reports it as `'other'`.
  - `read`, `write`, and `list(key)` reject with `invalid` `<key> is a symlink`.
  - `move` and `delete` act on the link itself.
- Any other final-segment non-regular item (FIFO, socket, device): `read` and `write` reject with `invalid` `<key> is not a regular file`, and never open it.
- A parent segment that is not a folder counts as missing. `stat` gives `undefined`, and the methods fail with the not-found errors in the Failure Behavior table (D37). Internally, `locate` keeps "missing" and "not a folder" apart, because `write` treats them differently (V8).

**Parent creation (D22).**

- `write` creates missing parent folders, and the watcher reports them as `created`.
- `createFolder` and `move` require the parent to exist.
- Documents' `create` keeps its own parent pre-check. The window between that check and the act is accepted (F38).

**Write atomicity and ordering (D3, D4, D27, D30, V6, V10).**

1. By default, `write` writes the text to a temp file in the system temp folder, then copies it into the target in place, then removes the temp (D43). A failed temp write never touches the target. The target stays the same file, so hard links, xattrs and Finder tags, mode, owner, and birthtime all survive, and a writable file in a folder that allows no new files still saves. A reader may see a partial file during the copy, a window of a few milliseconds that was accepted.
2. With `{ atomic: true }`, `write` writes a temp file `.<name>.<pid>.tmp` in the target folder and renames it over the target, so a reader sees the old text or the new, never half. The target becomes a new file. `json-file` uses this for `.3pitor/` state and notes. If the target is not writable, either form refuses with EACCES and leaves the target unchanged.
3. Writes are queued at call time, before any await, in a process-wide map keyed by `join(root, key)`. Writes to one key land in call order across every instance on the same root string.
   - The guarantee holds for keys as the tree reports them. Two letter-case spellings of one file are separate queues.
   - A failed write rejects only its own caller, and later writes still run.
   - A settled entry is removed from the map.
4. `move` and `delete` first wait for writes already queued under any key they touch (a prefix match for folders). So a save followed at once by a rename or delete cannot bring back the old name.
5. These things are not ordered:
   - writes across processes, beyond what rename atomicity gives (the pid in the temp name avoids collisions)
   - writes against `move` or `delete` calls made later
   - reads against writes

   F37–F39 are unchanged.
6. A failed write removes its temp file on a best-effort basis. A crash can leave one behind: in the system temp folder for a default write, or beside the target for an atomic one (BC7).

**Events (D15, D17–D20, V2, V3, V9).**

- Events are delivered in batches, one per settled burst. A burst is a run of raw file-system events, delivered after 100 ms of quiet or after 1 s at most, as today.
- The listener is never called with an empty batch.
- A burst made only of ignored keys calls nothing, so `.3pitor` saves stay silent (F32).
- A burst with non-ignored raw activity always calls the listener. When nothing could be typed, it gets `[{ type: 'changed' }]` (V3). So a UI refresh is never lost to a diff miss.
- `ignore` is checked on a folder before the watcher descends into it, so an ignored folder such as `.git` is never walked.
- `updated` is reported for:
  - any raw event on a tracked file key, whatever its kind (V2)
  - a change in `mtimeMs` or `size` on re-list
  - a changed ino at the same key (temp-and-rename saves, including the package's own)
- `renamed` is reported only when a delete and a create in one burst share `(dev, ino, kind)`. Otherwise a rename arrives as a delete plus a create (F31).
- A folder delete or rename is one event. A folder create is the folder plus one event per descendant.
- The package's temp names are never tracked. `'other'` entries are never tracked or reported.
- The snapshot holds at most 10,000 entries. Past that, the subscription delivers only `[{ type: 'changed' }]` per burst (V9).
- The engine turns each batch into one payload-free `documents-changed` (D18). No key reaches a socket (F36).

**Lifecycle.**

- `createLocalFileSystem` does no I/O.
- `watch` is lazy. Each call gets its own `fs.watch` and snapshot, and returns an idempotent unsubscribe.
- `createEngine` starts no watcher. `startEngine` subscribes once and discards the unsubscribe (F33).
- The initial snapshot is built asynchronously, and startup does not wait for it (D20).

**Package boundary (D9, V13).**

- Outside `src/file-system/`, no production module uses an fs API. The only exceptions are the five named files.
- Nothing outside the package imports any module of it other than `file-system/file-system`.
- Engine production code imports only contract symbols. So only cli (`chooseWorkspace`, `createLocalFileSystem`) and `check.ts` (`resetWorkspace`) choose the backend.

**Unchanged on the wire (D31).** This is an acceptance criterion. The following stay as they are:

- every HTTP route, status, and JSON body, except those listed under Behavior Changes
- the `listening on … (workspace: …)` line
- the `/api/health` body (`workspace` = `location` = today's path)
- `documents-changed`: still payload-free with the same burst timing, plus the time to re-list
- WebSocket framing, SSE, and every type in `shared/wire.ts`

### Failure Behavior

The message strings are exact, and `<key>` is the key as given (D24). These mappings apply across the table:

- Documents maps `exists` to a 400 `invalid`.
- Any plain `Error` on a documents route becomes a 500 `Internal Server Error`, with a constant body.
- A view-state PUT failure becomes a 500 `{"error": message}`.
- The AI tools return the message as the tool error.

| Condition | Method | Reason | Exact message | What HTTP / AI observes |
|---|---|---|---|---|
| Key fails the grammar (including `""` outside stat/list) | all | invalid | `"<key>" is not a valid key` (JSON-quoted) | Documents: unreachable, because `checkPath` refuses first (F13). Tools: only after `normalizeKey`, e.g. `\` in input. |
| Absolute or escaping loose input | `normalizeKey` | invalid | `<input> is outside the workspace` | Tools: the same string as today (`workspace-path.ts:11`). An absolute path inside the workspace is now refused (BC3). |
| Link as a middle segment | all | invalid | `<key> is outside the workspace` | 400 with today's body for links that point out. Links that point inside are newly refused (BC1). Tools: Read and Edit show the message; Glob skips the entry. |
| Link as the final segment | read, write, list | invalid | `<key> is a symlink` | Browser: 400, today's string (`documents.ts:57`). AI: Read of any final link shows this (BC1/BC3, V11). |
| Other non-regular final item (FIFO, socket, device) | read, write | invalid | `<key> is not a regular file` | 400 for documents; was a hang or a 500 (BC14). AI: this text. |
| Missing key | read, delete, move (from), list (non-root) | not-found | `<key> was not found` | 404, today's string. Tools: Read and note Edit rewrite it to `<file_path> does not exist` (kept). Post Edit and Highlight pass it through (BC3). |
| Parent segment is a file, on read/delete/move-from | read, delete, move (from), list | not-found | `<key> was not found` | 404; was 500 (BC8). |
| Parent segment is a file, on write/createFolder/move-target | write, createFolder, move (to) | not-found | `<dirname(key)> was not found` (`.` at top level) | 404; was 500 (BC8). |
| Missing parent | createFolder, move (to) | not-found | `<dirname(key)> was not found` | 404, today's string (`documents.ts:197`). |
| Target exists | createFolder (`<key>`), move (`<to>`, unless it is the same item per D25) | exists | `<key> already exists` | 400, today's string. Documents' own pre-check gives the same string. |
| Move into itself (`to === from`, `to` under `from/`, or under it by real path of both sides, V5) | move | invalid | `<from> cannot move into itself` | 400, today's string. Holds under a symlinked root and for letter-case variants. |
| Write onto a folder | write | invalid | `<key> is a folder` | PUT document: 400 `{"error":"<key> is a folder"}`; was 500 (BC6). View-state: 500 with this text. Note Write tool: this text. |
| Existing file not writable (e.g. mode 444) | write | — (errno) | EACCES text, rethrown unchanged | 500 `Internal Server Error`, as today. The target is unchanged (V6). |
| Folder not writable (e.g. mode 555), file writable | write | — | the save succeeds | As today: the default write copies into the existing file (D43). An atomic write here fails with EACCES. |
| Root missing or not a folder | list(`""`) | not-found | `the workspace root was not found` | `listEntries` rethrows it as a plain `Error` → 500 `Internal Server Error`, as today (D16). |
| Root missing | stat(`""`) | — | returns `undefined` | — |
| Race after the checks: ENOENT/ENOTDIR or EEXIST on the final act | all | not-found / exists | `<key> was not found` / `<key> already exists` | 404 / 400. Today these were 500s, and they are reachable only in a race (BC13). |
| Any other errno (EACCES, EISDIR on read, EBUSY, ENOSPC…) | all | — | rethrown unchanged | 500 `Internal Server Error`, as today (F12). Tools: the raw text. |
| Non-absolute root | createLocalFileSystem | — (plain Error) | `<root> is not an absolute path` | A programming error; cli always passes an absolute path. |
| `fs.watch` throws synchronously | watch | — | rethrown | `startEngine` rejects, as today (D41). |
| Watcher `error` event | watch | — | logged: `Stopped watching the workspace: <message>` | Watching stops, and no more `documents-changed` is sent until restart (F33, as today). |
| Read error other than ENOENT/ENOTDIR during the initial walk or a diff | watch | — | logged: `Stopped watching the workspace: <message>` | Same as the row above (D20). |
| Snapshot passes its cap | watch | — | warned once: `Watching the workspace without change details: more than 10000 entries` | Batches become `[changed]`. The engine still emits `documents-changed` per burst, so the UI is unaffected (V9). |
| Raw activity with an empty diff | watch | — | delivers `[{ type: 'changed' }]` | `documents-changed` is emitted, as today (V3). |
| Listener throws | watch | — | logged: `Could not report a workspace change: <message>` | Later batches are still delivered. |
| Write fails after the temp exists | write | the original error | original | The temp is removed best effort (D27). If the copy itself fails partway, the target may hold partial text. A crash leaves a temp behind (BC7). |
| `.3pitor/.gitignore` write fails | json-file writeText | the original error | original | That `writeText` call rejects, though the content write may have landed (D39). Session save: logged, as today. View-state: 500. Note tool: the error text (D23). |
| Corrupt or unreadable state | json-file readJson | — | warn: `Could not read <key>: <message>` | Treated as no state; the next save overwrites it (F21 kept). The log names the key (BC11). |
| Glob prefix missing or refused | glob | — | `[]` | The Glob tool returns empty. Workspace config gets no skills or agents from that folder (BC1 for a linked `.claude/skills`). |

## Why Each Element Is Here

| Element | What it does | Justification |
|---|---|---|
| Package `src/file-system/` | Holds all runtime file I/O | G1 |
| Entry `file-system.ts`, the only importable module | One contract surface | G9 (the `engine/engine.ts` precedent); D7; V13 enforces it |
| Layout `components/`, `glob/`, `local/{local-file-system,workspace}/` | README package → feature → component | D6; README "components/" rule |
| `watch.ts` as a helper inside `local-file-system/` | Imported only by the local backend | README "a component is one module plus the helpers only it imports" |
| Types declared in the entry, values in `components/` | No runtime import cycle between the entry and the backend | D6 |
| `FileSystem` interface | The swappable layer | G3 |
| `location` (renamed from `label`) | Display string; `Engine.workspace` | D11, F7, O2; keeps the `listening on` line and `/api/health` byte-identical (D2) |
| `stat(key)` | Returns a kind or undefined, without following links | F16–F18 pre-checks; D21 |
| `stat("")` allowed | Checks that the root exists | F14; D16 |
| `read` → utf-8 string | Text read | G2; every read today is text (F1, F22, F27) |
| `read`/`write` refuse non-regular items | No hang on a FIFO; a clear refusal | V7 |
| `write` replaces the whole file | Save and state writes | F15, F20 |
| `write` via a finished temp copied in place | A failed save never damages the file, and the file keeps its identity | F15; D43 (operator direction) |
| `write` option `atomic` (temp + rename) | No half files for the app's own state | F20; D43 (operator direction: `.3pitor/` keeps the rename) |
| Temp copies the existing mode; unwritable target → EACCES | Keeps today's permission outcome for files | V6 |
| `write` creates parents | Saving into new folders | F15; D22 |
| `write` queue at call time, process-wide, keyed by absolute path | Writes to one key land in call order | F20; D3 |
| Settled queue entries pruned | No unbounded map | V10 |
| `pendingWriteCount()` (test-only, not re-exported) | Makes the pruning testable | V10; V13's entry-only rule keeps it private |
| `write` onto a folder → invalid | A clear refusal | D26 |
| Failed write removes its temp | No litter on a normal failure | D27 |
| Temp name `.<name>.<pid>.tmp` | Hidden and unique per process | F20 (pid); D27; the leading dot keeps it out of the tree and the watch (F32) |
| `createFolder`, parent required | Empty folders | G6 "folder"; F14; F16 |
| `list(folder)`: direct children, unordered | Walks without descending into hidden folders; fits object stores | F14, F28; the engine sorts (F14) |
| `list` of a missing or non-folder key → not-found | Skips a folder that vanished | F14 |
| `move` waits for queued writes | No resurrected names | D4 |
| `move` lexical into-itself check | Works on any backend | F43 |
| `move` real-path into-itself check, both sides resolved | Catches case variants under a symlinked root | F18; V5 (D2's unresolved root) |
| `move` same-item exception | Case-only rename | F18; D25 (dev+ino on local) |
| `move` target parent required | Today's rule | F16, F18 |
| `delete`: recursive, a link removed as a link, waits for writes | Today's `rm`; no resurrection | F19; D4 |
| `locate` tri-state parent (`folder`/`missing`/`not-folder`) | `write` creates a missing parent but refuses a file in a parent position | V8; D37 |
| `watch(listener, options)` → unsubscribe | Events plus lifecycle | G6, G7; F32 (lazy); F33 |
| Batched `FileEvent[]` | Settled bursts | G6; F29 debounce |
| `created`/`updated`/`deleted`/`renamed` | Typed events | G6 verbatim; D18 |
| `changed` event | Says "something changed" when the diff is empty or the snapshot is capped | V3, V9; G6 "etc" |
| `renamed` only with ino pairing | Honest about what the platform reports | F31 (corrected by V2/V15) |
| One event per folder delete/rename | Descendants implied | D19 |
| One `created` per key in a new subtree | `write` reports the parents it created, then the file | D22; D36 |
| `updated` on any raw event for a tracked file, or an mtime/size/ino change | In-place and temp-and-rename edits refresh the UI on macOS | D17; V2; F30 |
| No empty batch; bursts of only ignored keys are silent | `.3pitor` saves never echo | D17; F32 |
| Async initial snapshot, with raw events held during the build | Startup is not blocked, and no events are lost | D20 |
| Snapshot cap (10,000) with a coarse fallback | Bounds the memory of a huge or home-folder root | V9; D20 |
| `limit` parameter on `watchLocal` | Lets tests reach the cap cheaply | V9; `watchLocal` is internal |
| Temp-pattern names never tracked | The package's own saves read as `updated`, never delete+create | D17; D40 |
| `'other'` never tracked by the watcher | `FileEvent.kind` is file/folder only | D14; F14 |
| Listener throws caught and logged | Isolation within this emitter | F35; today's `documents.ts:96-100` string |
| Watcher or walk error → log and stop | Today's behavior | F33; D20 |
| `watch()` rethrows a synchronous `fs.watch` throw | `startEngine` rejects, as today | D41 |
| `WatchOptions.ignore`, checked before descending | Applies the engine's hidden policy; never walks `.git` | F29, F36; D15 |
| `EntryKind` including `'other'` | Links, sockets, and the like | F14, F19; D14 |
| `FileEntry {key, kind}` | List result | F14 |
| `FileSystemError` | Failures that do not depend on the backend | G3; F12 (no errno leaks) |
| Reason `invalid` / `not-found` / `exists` | Can never succeed / item or parent missing / target taken | F12, F13, F14, F16, F17, F18 |
| Exact messages (Failure Behavior table) | Byte-identical browser strings where they exist today | D24; F12; D31 |
| Middle-link message `… is outside the workspace` | Keeps today's refusal body | D35; `documents.test.ts:79-87` |
| errno passthrough | 500s stay 500s | F12 |
| Key grammar enforced on every call, in the package | The only defense on writes | G4, G5; F40, F44, F45 |
| Grammar has no OS-specific rules | Portable | D29 |
| `""` only for stat/list | Allows the root walk; prevents `delete("")` | F14 |
| `checkKey` | Strict per-call validation | G4; D13 |
| `normalizeKey` (renamed from `toKey`) | Canonicalizes model input once | F25, F44; D13 |
| `normalizeKey` escape message | Today's tool string | `workspace-path.ts:11`; F26 |
| `parentKey`, exported from the entry | Parent lookups without disk paths; documents uses it | F10; V4 |
| `glob(fileSystem, pattern, {dot})` | Pattern search over `list` | G2 (`Bun.Glob#scan` is disk I/O); F28; two users (F24, F27) |
| `glob` dot rule aligned to the pattern's segments; leading `./` stripped | Explicit-dot patterns still match; hidden folders are pruned otherwise | V1; D28 |
| `glob` skips refused and `'other'` entries | Links excluded | D14; D28 |
| Glob parity table against `scan` | Proves the dot rule | V1 |
| `createLocalFileSystem(root)`: synchronous, no I/O | Mirrors `createEngine` | G9; D2 |
| Local key → `join(root, key)` | "path relative to the workspace root" | G5 |
| Local rule: no links below the root | Closes the static case of F41/F42 | D2, D21, D30; V12 |
| Root components unchecked | Linked roots and macOS temp folders | D2 |
| `chooseWorkspace(name, {workspaceEnv, fixture})` in the package | Its `stat`/`cp` are file I/O; the env read stays in cli | G2; F9; D5 |
| `ensureWorkspace(path, fixture)` / `resetWorkspace(path, fixture)` | Seeding is file writes | G2; D5; F9 |
| `dataDir` removed, inlined in `check.ts` | No I/O, one user, no `SRC` in the package | D5; D33 |
| `WORKSPACE_FIXTURE` in `paths.ts`, re-exported by `engine.ts` | Only `paths.ts` finds `src/` | D5; D34 |
| `EngineOptions.fileSystem` / `StartOptions.fileSystem` | The engine receives an instance | G8; D12; F8 |
| `StartOptions.target` removed | cli resolves the target | G9 |
| `Engine.workspace` = `fileSystem.location` | No server or cli change | D11; F7 |
| `startEngine` subscribes with `ignore: isHiddenKey` → `documents-changed` | Today's hint semantics, including for `changed` | D18; F29, F30, F36; V3 |
| `isHiddenKey` exported from documents | One hidden rule for the tree and the watch | F13, F29 |
| `AgentOptions.fileSystem` (via `SessionsOptions`) | Tools and config need the instance | F6; G8 |
| Documents functions take `fileSystem` | The rules stay in the engine (SRP) | D1; F13–F19 |
| `FileSystemError` → `DocumentError` mapping | Route mapping unchanged | F12; D31 |
| `listEntries` root not-found → plain Error | Keeps the 500 | D16 |
| `createEntry` final link with kind file → `is a symlink` | Keeps today's string | `documents.ts:54-58`; D31 |
| `moveEntry` treats `'other'` as a file | Matches today's `isDirectory() ? folder : file` | V5; `documents.ts:142` |
| `countContents` of a non-folder → zeros | Matches its own contract; needs no errno | F19; D38 (BC9) |
| Tools grammars lexical over `normalizeKey` | Three grammars kept on purpose | F25; `documents.ts:25-27` |
| `postName(filePath)` / `turnTexts(documents)` drop the workspace argument | Pure; no disk needed | F10 (`realpathSync` ×5 removed) |
| `fileTools(fileSystem, …)` | Reads through the package | G2; F24 |
| `loadWorkspaceConfig(fileSystem)` over `glob` + `read` | Config reads through the package | G2; F27 |
| `loadViewState`/`saveViewState(fileSystem, …)` | State through the package | G2; F22 |
| `stateKey` replaces `stateFile` | Keys, not disk paths | G4; F11 |
| `readJson`: not-found silent, else warn → undefined | Today's state semantics | F21 |
| `writeText` issues the write first, with the `.gitignore` check alongside, on every write | Keeps call order; no memo | D23; D39; F20 |
| `.gitignore` fixed at `.3pitor/.gitignore` | One ignore file for the whole folder | D23 (BC10) |
| `withWorkspace` third parameter | Helper callers get an instance without breaking | F8; D32 |
| cli builds `fileSystem` and passes it | The wiring the goal states | G9 verbatim |
| `boundary.test.ts` fs-API ban, including `require` and dynamic `import` | "Must" is enforced in `make test` | G2; D9; V13 |
| Exemptions named file by file | No directory-wide loophole | F2, F3; V13 |
| Entry-only import rule | Package internals stay private; the symbol rule cannot be bypassed | V13; D7 |
| Engine contract-symbol rule | The engine cannot build its own backend | G8, G9; V13 |
| Exemption-exists test | Stops stale allowances | D9 |
| Makefile `test-server` adds `src/file-system` | The boundary and package tests run in `make test` | D9; D42 |
| Real temp folders in tests; no in-memory backend | One implementation | D32 |

## Behavior Changes

The delegation accepts each of these changes (D30). Each one says who sees it.

- **BC1: symlinks.** Keys never pass through a symlink below the root. This closes the static case of F41 and F42; a swap race remains (V12). It is seen by:
  - **Browser:** a crafted path through any linked folder now gets a 400 `<key> is outside the workspace`. Before, only links pointing out of the workspace were refused. The tree never showed links, so the UI does not change.
  - **AI:**
    - Read through a linked folder fails with `<key> is outside the workspace`.
    - Read of any final-segment link fails with `<key> is a symlink` (V11). Today a link pointing inside the workspace reads its target, and one pointing out fails with `<file_path> is outside the workspace`.
    - Glob skips linked entries.
  - **Users with a linked `.claude/skills` or `.claude/agents`:** those skills and agents are silently ignored.
  - **Users with a linked `.3pitor/`:** state saves fail and are logged.

  A workspace opened through a link is unaffected (D2).

- **BC2: saves copy a finished temp file into the original (D43).** Document saves and new-file seeds write the text to a temp file in the system temp folder, then copy it into the file in place. A failed temp write never touches the original. The file keeps its hard links, xattrs and Finder tags, mode, owner, and birthtime, and a file in a folder that allows no new files still saves, all as before this change. A read-only file (mode 444) is still refused with EACCES. A reader may briefly see a partial file during the copy, as with the in-place save before this change. The app's own `.3pitor/` state keeps the atomic rename. Who sees it: nobody, compared with before this change; the earlier draft of this design swapped in new files and lost the extras.

- **BC3: strings the model sees (V11).**
  - Edit or Highlight on a missing post: `notes.md was not found`, instead of Bun's raw ENOENT text (F26).
  - Read keeps `<file_path> does not exist`, and so does note Edit.
  - An absolute path inside the workspace is refused with `<input> is outside the workspace`.
  - A final-segment link reads as `<key> is a symlink`. The message names the normalized key, not the raw `file_path`.

  Who sees it: the AI.

  The six deleted `workspace-path.test.ts` cases map as follows:

  | Deleted case | New outcome | Covered by |
  |---|---|---|
  | (1) resolves `notes.md` | read succeeds | local-backend test |
  | (2) `../secret.md` | `normalizeKey` gives the same string | `keys.test.ts` |
  | (3) absolute path outside | `normalizeKey` gives the same string | `keys.test.ts` |
  | (4) `link.md` pointing out | `link.md is a symlink` (changed) | local-backend test, tools test |
  | (5) new file under a new folder | `write` creates the parents | local-backend test |
  | (6) new file under a linked folder pointing out | `escape/new/post.md is outside the workspace` (same string) | local-backend test |

- **BC4: case folding lost.** `postName('Notes.md')` no longer folds to `notes.md` on a case-insensitive disk (`tools.test.ts:34` changes). A wrong-case Edit lands on a separate turn entry. Who sees it: the AI and the editor.
- **BC5: `..foo`.** A root entry named `..foo` becomes reachable (F45). Who sees it: the browser and the AI.
- **BC6: write onto a folder (D26).**
  - `PUT /api/documents/<key>` where the key is a folder: was 500 `Internal Server Error`, now 400 `{"error":"<key> is a folder"}`.
  - View-state PUT when `view.json` is a folder: still a 500, but the body text is now `.3pitor/view.json is a folder`.
  - An AI note Write onto a folder gets that text.

  Who sees it: crafted requests and the AI.
- **BC7: temp litter (D27).** A crash mid-save can leave a `3pitor-<pid>-<n>.tmp` file in the system temp folder, or, for `.3pitor/` state, a hidden `.<name>.<pid>.tmp` inside `.3pitor/`, which git ignores. Document folders get no temp files. Who sees it: nobody in normal use.
- **BC8: paths through a file (D37).** Who sees it: crafted requests only.
  - Read, delete, move, or count of `notes.md/x.md`, where `notes.md` is a file: was 500, now 404 `… was not found`.
  - Write there: was 500, now 404 `notes.md was not found`.
- **BC9: count of a file (D38).** `POST /api/documents/count` on a file: was 500, now 200 `{"files":0,"folders":0}`. Who sees it: crafted requests. The UI counts only folders.
- **BC10: `.gitignore` placement (D23).** Only `.3pitor/.gitignore` is ever created. Nested note folders no longer get their own, and the effect is the same. `json-file.test.ts:78` changes. Who sees it: git users looking inside `.3pitor/`.
- **BC11: log lines.** The `readJson` warning names the key (`.3pitor/session.json`), not the absolute path. Who sees it: the operator's console.
- **BC12: emit latency.** Each `documents-changed` now also waits for the dirty-folder re-list. Bursts with an empty diff still emit, through `changed` (V3). The UI does not notice, because it treats events as hints (F30).
- **BC13: race outcomes.** ENOENT, ENOTDIR, or EEXIST on the final act after a passing check: was 500, now 404/400. Who sees it: concurrent tabs or editors only (F38).
- **BC14: non-regular items (V7).** Read or write of a FIFO, socket, or device named `*.md`: was a hang or a 500, now 400 `<key> is not a regular file`. AI Read gets the same text. Who sees it: crafted requests, and the AI in unusual workspaces.
- **Unchanged:**
  - every other status and body (D31 makes this an acceptance criterion)
  - the `listening on` line and `/api/health`
  - burst timing
  - F21's corrupt-state handling
  - the F37–F39 races
  - how far the AI's Read reaches (SEC-003)

## Options Considered

### Option A — chosen

A generic key store with one key space. The document rules stay in the engine.

- It is the only option where a new backend implements storage alone (G3).
- Its single key space is what G5 describes: `.3pitor/…` and `.claude/…` are paths relative to the root.
- Containment lives in one place: the grammar on every call, plus the local no-link rule.
- Events are typed by a snapshot diff, which is honest within F31.
- The wiring follows G9 exactly. (D1)

### Option B — rejected

Branded `Key` values and scoped stores (`documents`, `state`, `config`, `raw`).

- It needs a `raw` scope for the AI's Read and Glob (F24). That collapses the separation the option exists to provide.
- The scopes answer O1 without evidence.
- The hidden rule would be split across two packages.
- The branded type costs every test line (F8).

### Option C — rejected

A document-semantic file system: the backend implements `documents`, `state`, and `config`.

- Every future backend would re-implement F13–F19 (seed heading, `.md`-only, hidden policy, count, case-only rename).
- Every rule change would mean editing every backend.
- It leaves F41 and F42 open.
- It reduces G4's "key" to the documents grammar.

Other alternatives were rejected:

- **A facade over a `FileBackend` port:** one backend.
- **The interface type in `shared/`:** the engine needs runtime values, and `shared` can be imported by the browser.
- **Raw events:** they fail G6.
- **Events only from the package's own operations:** they fail G7.
- **A whole-workspace snapshot:** it walks `.git`.
- **A package that hides hidden keys:** it breaks state, config, and the AI's Read.
- **`chooseWorkspace` in cli:** it is file I/O, which G2 puts in the package.
- **One `openLocalFileSystem(target, env)`:** it would hide I/O in the factory.
- **A branded `Key` inside A:** it adds compile-time checking only.
- **Documents rules as a domain service in the package:** the same objection as Option C.

## Questions Resolved

Decisions were settled under the operator's standing delegation. The source column says whether the goal, the brief, or the delegation settled each one.

| # | Question | Answer | Source |
|---|---|---|---|
| Q1 | Does the no-link rule check the root path's own components? | No. Only the key's segments below the root are checked. | D2 (decided) |
| Q2 | What must `root` be, and what does the display string hold? | An absolute path, with no I/O. `location` is the root as passed. | D2 (decided) |
| Q3 | Is the write queue per instance or process-wide? | Process-wide, keyed by the absolute path. | D3 (brief F20) |
| Q4 | Can a save followed at once by a move or delete resurrect a name? | No. `move` and `delete` wait for writes already queued under the keys they touch. | D4 (decided) |
| Q5 | Where does the fixture path come from without the package finding `src/`? | `engine/paths.ts`, re-exported by `engine.ts` as `WORKSPACE_FIXTURE`. | D5 (decided) |
| Q6 | How do `chooseWorkspace` and `resetWorkspace` get the fixture and the env value? | As arguments; cli reads the env. | D5 (decided) |
| Q7 | What is the package's folder layout? | README package → feature → component. | D6 (decided) |
| Q8 | May server tests and `check.ts` import the package? | Yes, the entry only. The allowlist moves to the new names. | D7 (decided) |
| Q9 | Does the design carry Invariants, a Failure table, and a Test Plan? | Yes, as the precedent does. | D8 (brief F48) |
| Q10 | How is the "must" in G2 enforced? | `boundary.test.ts` inside `make test`. | D9 (goal G2) |
| Q11 | Which docs are updated? | README, the update-code-structure skill, and a change log. | D10 (brief F48) |
| Q12 | `label` or something else; does `Engine.workspace` survive? | `location`; `Engine.workspace` holds it. | D11 (decided) |
| Q13 | What is the engine option called? | `fileSystem`. | D12 (goal G8) |
| Q14 | What is `toKey` called, and who uses it? | `normalizeKey`, for model input only. | D13 (decided) |
| Q15 | Keep `'other'`? | Yes. It means anything that is not a regular file or folder. Callers' rules are stated once. | D14 (decided) |
| Q16 | When is `ignore` called? | On folders before descending, so `.git` is never walked. | D15 (brief F29) |
| Q17 | What happens when the root is missing? | `GET /api/documents` stays a 500. | D16 (brief F14) |
| Q18 | Do external edits still refresh the UI? | Yes. Any raw event on a tracked file, or an mtime/size change, gives `updated`. | D17 (brief F30); amended by V2 |
| Q19 | Do the package's own saves show as `updated`; can a batch be empty? | `updated`, and no batch is ever empty. An empty diff after activity gives `changed`. | D17; amended by V3 |
| Q20 | Keep typed events when the engine collapses them? | Yes. They are tested at the package level. | D18 (goal G6, G7) |
| Q21 | Descendant events on a folder delete or rename? | No. One event for the folder. | D19 (decided) |
| Q22 | Is the initial snapshot built synchronously; what happens on errors? | Asynchronously, with events held during the build. An error is logged and watching stops. | D20 (decided); capped by V9 |
| Q23 | How does `stat` treat links? | No-follow. A final link is `'other'`; a middle link is `invalid`; a file as parent gives `undefined`. | D21 (decided) |
| Q24 | Does `write` create parents for every key? | Yes. Documents' create keeps its pre-check. | D22 (brief F15, F38) |
| Q25 | Memoize the `.gitignore` check? | No. It is checked on every write. | D23 (brief F20) |
| Q26 | What are the exact error messages? | One table (Failure Behavior). | D24 (decided) |
| Q27 | What counts as "the same item" for a move? | The same stored item; dev+ino on local disk. | D25 (decided) |
| Q28 | What happens on a write onto a folder? | `invalid` "<key> is a folder" (BC6). | D26 (decided) |
| Q29 | Is the temp file cleaned up on failure? | Yes, best effort. A crash can leave one behind (BC7). | D27 (decided) |
| Q30 | Does glob with `dot:false` prune hidden folders? | Yes, unless the aligned pattern segment starts with a literal `.`. | D28 (decided); amended by V1 |
| Q31 | Any OS-specific key rules? | None. | D29 (decided) |
| Q32 | Accept BC1 and BC2? | Yes. | D30 (delegation) |
| Q33 | Is "HTTP unchanged except listed BCs" an acceptance criterion? | Yes. | D31 (decided) |
| Q34 | Use an in-memory backend for tests? | No. Real temp folders. | D32 (brief F8) |

These points were settled while writing the amended design:

- **D33:** `dataDir` is deleted and inlined in `check.ts`.
- **D34:** `WORKSPACE_FIXTURE` lives in `engine/paths.ts` and is re-exported by `engine.ts`.
- **D35:** A middle-segment link is refused with today's `<key> is outside the workspace`.
- **D36:** Creations are reported per key, including the parents that `write` creates. Folder deletes and renames are reported once.
- **D37:** A parent segment that is a file counts as missing everywhere (BC8).
- **D38:** `countContents` on a file gives zeros (BC9).
- **D39:** `writeText` starts the write synchronously, with the `.gitignore` check alongside it.
- **D40:** The local watcher never tracks its own temp pattern.
- **D41:** `watch()` rethrows a synchronous `fs.watch` throw.
- **D42:** Makefile `test-server` adds `src/file-system`.

## Validation Findings

| # | Finding | Disposition | What changed in the design, or why rejected |
|---|---|---|---|
| V1 | `Bun.Glob#match` has no dot option. Blanket pruning breaks explicit-dot patterns, and a leading `./` was undefined. | accepted | The glob dot rule now aligns with the pattern's segments, and a leading `./` is stripped. A parity table (patterns × dot vs `scan`) is in the tests. The glob open risk is closed. |
| V2 | On macOS every raw event is `rename`; `change` never fires. | accepted | A raw event of any kind on a tracked file marks it `touched`. A same-size in-place write test is added. F31 is corrected. |
| V3 | A stateful diff can miss a change, and a miss silently stops UI refresh. | accepted | A burst with non-ignored raw events and an empty diff delivers `[{ type: 'changed' }]`, a new `FileEvent` variant. The engine maps it to `documents-changed`. BC12 is narrowed to latency only. |
| V4 | `parentKey` was not exported, but documents uses it. | accepted | Exported from `file-system.ts`. It is in the engine contract-symbol set. |
| V5 | The real-path into-itself check conflicted with D2's unresolved root. | accepted | Both the source and the target parent's nearest existing ancestor are resolved with realpath, then compared. A test covers a symlinked root with a case-variant move. `moveEntry` treats `'other'` as a file. |
| V6 | Temp + rename inverts permissions; xattrs, tags, and birthtime reset. | accepted | `write` checks W_OK on the existing file (EACCES passes through) and gives the temp the existing mode. The 555-folder case and the metadata resets are listed in BC2. |
| V7 | `read` on a FIFO hangs; non-link `'other'` had no rule. | accepted | `read` and `write` refuse a non-link `'other'` with `<key> is not a regular file`. A `mkfifo` test is added, and BC14 is added. |
| V8 | `parentMissing` conflated "missing" with "is a file". | accepted | `locate` returns `parent: 'folder' \| 'missing' \| 'not-folder'`. |
| V9 | An unbounded snapshot on `node_modules` or a home-folder root. | accepted | The cap is 10,000 entries. Past it, the watcher warns once and degrades to `changed`. `watchLocal` takes a `limit` for tests. |
| V10 | Queue keys differ by letter case; `pending` was never pruned. | accepted | The guarantee is stated for keys as the tree reports them. Settled entries are deleted. A test-only `pendingWriteCount()` is added. |
| V11 | Model-visible strings change for final links, and an in-workspace final link no longer reads. | accepted | Added to BC1 and BC3. Each deleted `workspace-path.test.ts` case is mapped to its new outcome. |
| V12 | Symlink refusal is check-then-act, so a swap can escape. | accepted | The wording is now "closes the static case of F41/F42", and the race is an open risk. |
| V13 | Directory-wide exemption; engine could import the local factory; `require` and dynamic `import` were missed. | accepted | Exemptions are named file by file. Three rules are added: entry-only imports, the engine contract-symbol rule, and bans on `require` and dynamic `import` of fs. |
| V14 | `FileSystem` collides with the DOM global type in `tsconfig` `lib`. | rejected | The goal's own term is "an instance of the file system package" (G8, D12). A missing import fails type-checking at the first method call, because the DOM `FileSystem` has no `read`, `write`, or `watch`. That is a confusing error, not a silent bug. Recorded as an open risk. |
| V15 | F31 understated macOS behavior; Linux inode reuse is untested. | accepted | F31 is corrected (through V2). False `renamed` from Linux inode reuse is an open risk. |

**What held up.** The validator confirmed these parts of the design:

- The consumer list: a production grep finds exactly the listed consumers.
- The cli wiring: `--version` and `--help` stay free of I/O, and `chooseWorkspace` and the watcher each have one caller.
- The `createEngine` and direct-call test counts.
- The claude CLI's isolation from the workspace (F4).
- The F16 resolution.
- The documents messages and HTTP mapping.
- D5.
- The fit of the moved watcher tests to the diff design.
- macOS startup replay is harmless; with V3 it produces at most one `documents-changed`.
- NFC names survive watch and readdir on APFS.

## Test Plan

**New package tests (`src/file-system/`)**

`components/keys.test.ts` is a table-driven grammar test:

- **Valid:** `a`, `a/b.md`, `..foo`, `.3pitor/x.md`, `a b/c.md`, `x:y`.
- **Invalid:** `""` (outside stat/list), `/a`, `a/`, `a//b`, `.`, `..`, `a/../b`, `a/./b`, `a\b`, `a\0b`. Each is checked for its exact message.
- **`normalizeKey`:**
  - `./notes.md`→`notes.md`
  - `a/../b.md`→`b.md`
  - `a//b/`→`a/b`
  - `.`→`""`
  - `a/../.claude/x.md`→`.claude/x.md` (canonical form first, F44)
  - `../x`, `a/../../x`, and `/abs` → `<input> is outside the workspace`
- **`parentKey`:** `a/b`→`a`, `c`→`""`.

`glob/glob.test.ts`:

- a literal-prefix walk
- `**` and single-level patterns
- `dot:false` prunes hidden folders; a spy shows `list` is never called on `.git`
- `dot:true` finds `.claude/skills/*/SKILL.md`
- `'other'` entries and linked folders are skipped
- a missing prefix gives `[]`
- a leading `./` is stripped (V1)
- **Parity table (V1).** Each pattern is run with `dot` false and true on a fixture tree, and each result must equal `Array.fromAsync(new Bun.Glob(p).scan({ cwd, onlyFiles: true, dot }))`. The patterns:
  - `**/*.md`
  - `*.md`
  - `.claude/skills/*/SKILL.md`
  - `.claude/agents/*.md`
  - `{a,.claude}/**`
  - `.*`
  - `a/**/.x.md`
  - `./notes.md`
  - `docs/*`

`local/local-file-system/local-file-system.test.ts`: one test per row of the Failure Behavior table, with exact messages. In addition:

- A non-absolute root throws, and `location` equals the input.
- A root reached through a symlink works, and so does a macOS `mkdtemp` root (D2).
- `stat`'s four D21 cases.
- `write` creates parents (deleted case 5).
- `write` through a parent that is a file → not-found `<dirname>` (V8).
- D26: write onto a folder.
- `mkfifo` at `p.md`: `read` and `write` reject `p.md is not a regular file` without hanging (V7).
- A 0o640 file keeps 0o640 after `write` (V6).
- A 0o444 file: `write` rejects with EACCES and the content is unchanged (V6).
- 50 unawaited writes to one key leave the last value and no temp; afterwards `pendingWriteCount()` is 0 (V10). Moved from `json-file.test.ts:17,70`.
- A failed write rejects for its caller, and a later write succeeds. Moved from `json-file.test.ts:25`.
- Two instances on one root keep call order (D3).
- A write followed at once by `delete` or `move` leaves no resurrected name (D4).
- A failed rename leaves no temp: `spyOn` the module's `rename` so it rejects once (D27).
- Middle-link refusal (deleted case 6), and final-link `read` → `link.md is a symlink` (deleted case 4).
- `move`:
  - a case-only rename on a case-insensitive disk (skipped elsewhere)
  - into itself, lexically and by real path
  - under a symlinked root: `a` → `A/sub/a` is refused as into itself, and the case-only rename `a.md` → `A.md` succeeds (V5)
  - the target exists
  - the target parent is missing
  - a link is moved as a link
- `delete` removes a link as a link.
- `list` reports `'other'` for links.
- EACCES passes through unchanged (`chmod 000`).

`local/local-file-system/watch.test.ts`: the 8 watcher tests move here from `documents.test.ts:296-380` and are adapted to batches. New tests:

- **Typed events.** Each asserts the exact batch:
  - creating a file → `created`
  - an in-place `writeFile` on an existing file → `updated`
  - a same-size in-place overwrite → `updated` (V2)
  - the package's own `write` → exactly `[updated]`, with no temp keys
  - `rename a.md b.md` → `renamed`
  - a folder rename → one `renamed`, no descendants
  - a folder delete with 10 files → one `deleted` (D19)
  - `write('new/x.md')` → `created new` (folder), then `created new/x.md` (D36)
  - a file created and removed inside one burst → `[changed]` (V3)
- **Ignore and filtering:**
  - an `ignore` spy never sees keys under `.git` (D15)
  - writes only under an ignored `.3pitor` → the listener is never called (D17)
  - no empty batch is ever delivered
  - creating a symlink → no event
- **Cap:** `watchLocal(root, listener, {}, 3)` on a tree of 5 entries warns once with the exact string, and every later burst delivers `[changed]` (V9).
- **Errors:**
  - a listener that throws is logged, and later batches still arrive
  - an initial walk over a tree with an unreadable folder → logs `Stopped watching…` and makes no calls (D20)
- **Startup and unsubscribe:**
  - an event during the initial walk is delivered after the walk
  - unsubscribing before settle delivers nothing, and unsubscribing twice is safe

`local/workspace/workspace.test.ts` moves from `engine/workspace/workspace.test.ts`, with 3 call lines changed to the options form. New tests:

- `workspaceEnv` seeds from the given `fixture` only when the folder is absent.
- `resetWorkspace(path, fixture)` re-seeds.

`boundary.test.ts`:

- It passes on the new tree.
- A matcher self-check flags planted lines:
  - `from 'node:fs'`
  - `import 'fs'`
  - `require('node:fs')`
  - `await import('fs/promises')`
  - `Bun.file(`
  - `Bun.write(`
  - `new Bun.Glob(`
- It does not flag `ui/test-setup.ts`'s `await import('@testing-library/react')`.
- Planted import lines are flagged: one of `file-system/local/local-file-system/local-file-system`, and one engine line importing `createLocalFileSystem` from the entry (V13).
- The exemption-exists check runs.

**Engine and server setup changes (measured by grep)**

- `createEngine` call sites: 7 lines in 5 files.
  - The lines: `engine.test.ts:25,33`, `documents.routes.test.ts:25`, `view-state.routes.test.ts:22`, `workspace-config.routes.test.ts:20`, and `mcp-endpoint.test.ts:252,270`.
  - Each becomes `createEngine({ fileSystem: createLocalFileSystem(workspace), … })`.
- Direct calls to the workspace-string APIs: 125 lines in 11 test files.
  - Setup-only changes: 60 lines in 7 files (`tools.test.ts` 39, `agent.test.ts` 5, `workspace-config.test.ts` 5, `sessions.test.ts` 4, `mcp-endpoint.test.ts` 4, `claude-cli.test.ts` 2, `view-state.routes.test.ts` 1).
  - Rewritten: `documents.test.ts` 41 and `json-file.test.ts` 15.
  - Deleted: `workspace-path.test.ts` 6.
  - Moved: `workspace.test.ts` 3.
- Option objects that change: `agentSettings({ workspace … })` ×5 in `agent.test.ts`, `new Sessions({ workspace … })` in `sessions.test.ts:32`, and `withWorkspace` in `chat-test-helpers.ts:42-46`.
- `stateFile(workspace, n)` becomes `join(workspace, stateKey(n))` in `view-state.routes.test.ts:54`, `mcp-endpoint.test.ts:265`, and `sessions.test.ts:353,389,418`.

`tools.test.ts`:

- `:30-36`: the case-fold line is removed (BC4).
- `:248-251`: the Glob refusal strings are kept.
- `:254-260`: Glob through a link still expects `''`.
- Add these tests:
  - Edit on a missing post → `notes.md was not found` (BC3)
  - Read through a linked folder that points inside → refused (BC1)
  - Read of a final-segment link → `link.md is a symlink` (V11)

`documents.test.ts`: every symlink-message test keeps its string. Add these tests:

- a linked folder that points inside is now refused (BC1)
- write onto a folder (D26)
- count of a file → zeros (BC9)
- root missing → a plain Error (D16)
- `isHiddenKey`
- `moveEntry` of a final-segment link checks it as a file (V5)

`json-file.test.ts`: the queue and temp tests move to the package. It keeps, over `fileSystem`:

- missing → undefined
- unparseable → a warning that names the key
- round trip
- the first write creates `.3pitor/.gitignore`, and an existing one is left alone
- a nested note gets `.3pitor/.gitignore`, not `.3pitor/editing/.gitignore` (BC10)
- two unawaited `writeText` calls keep their order
- a `.gitignore` failure rejects that call only

`workspace-path.test.ts` is deleted. Its six cases are mapped in BC3.

`cli.test.ts` is unchanged. The end-to-end `documents-changed` test at `:44` and the `--version` test at `:26` must still pass.

**Acceptance criterion (D31).** Every existing HTTP route test passes with only its setup lines changed:

- `documents.routes.test.ts`
- `view-state.routes.test.ts` (its 500 test expects any string)
- `workspace-config.routes.test.ts`
- `sessions.routes.test.ts` (no change)
- `mcp-endpoint.test.ts`

Any other assertion that changes must map to a numbered BC.

## Docs and Rules to Update

**README** (D10, F48):

- `:17`: "Five packages" → "Six packages". Add this bullet: "`src/file-system/` holds every runtime file read and write behind `file-system.ts`: a key-based `FileSystem`, its local-disk implementation, and workspace choice. It imports no other package."
- `:19-20`, cli: "chooses the workspace folder, builds the file system, starts the engine with it…". Add `file-system/file-system.ts` to its imports.
- `:22`, engine:
  - Drop "workspaces".
  - Imports become "only `src/shared/`, `src/file-system/file-system.ts` (contract symbols only), and npm packages".
  - Add "It does no file I/O itself."
- `:23`, ui: "imports none of cli, server, engine, or file-system".
- The `cli.ts` bullet: it calls `chooseWorkspace` and `createLocalFileSystem`, and reads `WORKSPACE` as well as `MODEL`, `PORT`, `NODE_ENV`, and `OPEN_BROWSER`.
- `:74`, `startEngine`: "takes the file system and subscribes to its changes. It sends a payload-free `documents-changed` per batch, with hidden keys ignored. Then it loads the stored chat…"
- `paths.ts`: "exports `SRC` and `WORKSPACE_FIXTURE`".
- Remove the `components/workspace-path.ts` and `workspace/workspace.ts` bullets.
- Rewrite the `components/json-file.ts` bullet: `stateKey`; writes go through the file system; each write ensures `.3pitor/.gitignore`.
- `documents/`: remove the `watchDocuments` sentence. Mention `isHiddenKey`, and that I/O goes through the file system.
- `tools/tools.ts`: "paths are turned into keys with `normalizeKey`".
- Add a new `### src/file-system/` section that describes the layout and states the boundary test's three rules.

**Makefile:** `test-server: bun test src/cli src/server src/engine src/shared src/file-system` (D42).

**`.claude/skills/update-code-structure/SKILL.md`:** in "Target layout", change "Five packages" to six and add the file-system package rules:

- it imports no other package
- engine and cli import only `file-system/file-system.ts`, and the engine imports contract symbols only
- ui imports none of it

This edit gets its own commit, as `67a45cd` did.

**Change log:** `docs/changes/file-system-package/change-log.md`, in the precedent's shape (done-when table, test counts, decisions).

**`check_boundaries.py`** stays manual (D9):

- **E2:** allow the module `file-system/file-system` exactly.
- **C1:** cli production may import `file-system/file-system`.
- **FS2 (new):** `src/file-system/` production imports resolve only inside the package (npm and `node:` allowed).
- **FS3 (new, D7):** server production imports no file-system module. Server tests and `server/scripts/` may import only the entry.
- **U1:** add `file-system` to the banned packages.
- **S3 allowlist:**
  - `engine/components/json-file`: `{'stateFile'}` → `{'stateKey'}`
  - remove `engine/workspace/workspace`
  - `engine/chat/tools/tools` keeps `{'fileTools','turnTexts','editedTexts'}`
- **Removed-files block:** add `src/engine/components/workspace-path.ts` and `src/engine/workspace/workspace.ts`.
- The fs-API ban, the entry-only rule, and the engine contract-symbol rule are not duplicated here; they live in `boundary.test.ts`.

**Code comments:**

- `engine.ts:1-3`: "over one workspace" → "over one file system"
- `cli.ts:1-3`
- `tools.ts:1-5`: "checked as keys"
- the `documents.ts:1-2` header
- `events.ts:1` (the watcher reference)
- the `json-file.ts` header

## Cut List

- **S3, Notion, or other backends** — cut because G3 says "may" and G5 asks only for the initial implementation. Reopen on an explicit request, with system-architect first.
- **An in-memory backend / test double** — cut by D32. Reopen when a second backend needs a contract suite, or test time becomes measured friction.
- **A conformance suite run against every backend** — cut because there is one backend. Reopen at the second.
- **A facade over a `FileBackend` port that enforces keys, errors, and events for any backend** — cut because there is one backend. Reopen at the second.
- **Conditional writes, etags, and version vectors (F37, F39)** — cut because these are single-user windows. Reopen on a multi-tab data-loss report or a remote backend.
- **Exclusive create (`wx`) on `write` (F38)** — cut because documents' pre-check is accepted (D22). Reopen together with conditional writes.
- **Binary and streaming I/O** — cut because every read is text.
- **`mtime`/size on `stat` or `FileEntry`** — cut because no caller needs them. The watcher keeps them privately.
- **`FileSystem.close()` / `Engine.close()` (F33)** — cut because unsubscribe is enough. Reopen when a backend holds a connection, or tests leak watchers.
- **Restarting the watcher, or a `resync`/`error` event, after the watcher stops (F33)** — cut because stopping is today's behavior. Reopen if it bites. (`changed` covers only bursts that are seen.)
- **Event replay or a subscribe-then-list helper (F34)** — cut because the UI re-syncs on connect.
- **One shared watcher per backend** — cut because there is one subscriber.
- **Typed events on the wire or to the UI** — cut by D18. The engine keeps `documents-changed` payload-free (F30, F36).
- **Descendant events for a folder delete or rename** — cut by D19.
- **A configurable snapshot cap** — cut because 10,000 is a constant. The `limit` parameter exists only for tests (V9). Reopen if a real workspace degrades.
- **Case canonicalization of keys (BC4)** — cut because it is local-only. Reopen if BC4 shows up in use.
- **Unicode normalization of keys** — cut because there is no finding, and NFC held on APFS.
- **OS-specific key rules (Windows reserved names, `:`)** — cut by D29.
- **Telling transient failures from missing files in `readJson` (F21)** — cut because reads are local only. Reopen with a remote backend.
- **`createFolder` semantics on object stores** — deferred with remote backends (D22).
- **A memoized `.gitignore` check** — cut by D23.
- **Sweeping stale temp files at startup (BC7)** — cut because D27 accepts the litter. Reopen on user reports.
- **Preserving xattrs, tags, and birthtime across saves** — cut because V6 asked only for mode and writability. Reopen on user reports.
- **Closing the symlink swap race with `openat`/`O_NOFOLLOW`-style handles (V12)** — cut because Bun has no portable API for it and it is a single-user window. Recorded as an open risk.
- **Renaming the interface to avoid the DOM `FileSystem` global (V14)** — rejected. The goal names it, and the failure is loud.
- **Server bind to 127.0.0.1 and an Origin check (F40)** — cut because it belongs to the server package, as a separate security change.
- **Permissions or auth on keys** — cut because there is one user.
- **Hidden-rule filtering for the AI's Read (F24, SEC-003)** — cut because it is tool policy; flagged as a follow-up.
- **`EventBus` listener isolation (F35)** — cut because it is an engine concern.
- **Routing `app-skills.macro.ts` and `check.ts` reads through the package** — cut because they are bundle-time and test-harness reads (named exemptions).
- **Native glob in a backend** — cut because `list` is enough (F28).
- **A branded `Key` type** — cut because it is compile-time only and costs every test line (F8).
- **The `dataDir` helper** — cut because it has one user and the package has no `SRC` (D33).
- **Wiring `check_boundaries.py` into the Makefile** — superseded by `boundary.test.ts` (D9).

## Open Risks

Each risk names the condition that makes it matter.

- **False or missing `renamed` on Linux (V15).** This matters in two cases. If Linux reuses an inode within one burst, the watcher reports a false `renamed`. If its rename events split across bursts, the watcher reports delete+create. Either way the engine still emits `documents-changed`.

  Unverified: could not inspect Bun's `fs.watch` and inode behavior on Linux or Windows, because the validator's experiments ran only on macOS APFS.
- **Glob patterns outside the parity table.** This matters if a tool or a skill pattern uses a brace or `**` shape the table does not cover, where the alignment rule may differ from `scan`.
- **Symlink swap race (V12).** This matters if another process replaces a checked segment with a link between `locate` and the act. A key could then read or write outside the workspace. It is a single-user window on a local machine.
- **DOM `FileSystem` name collision (V14).** This matters when a module uses `FileSystem` without importing it. Type-checking then fails with a confusing message about missing members, not silently.
- **Writes in read-only folders (BC2, V6).** This matters for users who keep posts in a 555 folder with writable files: saves now fail with a 500.
- **Coarse mode on large roots (V9).** This matters when cli falls back to a home folder or a workspace with more than 10,000 non-hidden entries. Typed events stop for that run, though the UI is unaffected. The walk up to the cap still costs time in the background.
- **Unicode normalization.** This matters for NFD-named files, or for platforms other than macOS, where `fs.watch` filenames and `readdir` names may differ. A change could then go untyped. V3's `changed` still refreshes the UI.

  Unverified: could not test NFD names or non-APFS file systems, because the validator tested only NFC on APFS.
- **Null filenames and Linux recursive watch.** This matters on large trees on Linux: a null filename forces a full re-walk. Bun's recursive `fs.watch` on Linux is an existing, unchanged dependency.
- **Cost of the per-call segment walk.** This matters for deep or large trees: every operation does O(depth) `lstat` calls, and `listEntries` and `glob` call `list` per folder. It is not measured beyond blog-sized trees.
- **Queue keyed by the root string and letter case (V10).** This matters if two instances open one folder through different root strings, or if callers use letter-case variants of one key. Those writes are not ordered against each other.
- **Windows drive-style keys.** This matters if the app runs on Windows: `C:/x` is a valid key, and `join(root, 'C:/x')` is undefined there (F45 is inferred).
- **F40, server binding.** This matters while the server binds to every interface: any host that can reach the port can write documents. Key validation is the only defense on writes.
- **SEC-003, the AI's Read reach.** This matters whenever a workspace holds secrets: Read still reaches every key, including `.env`, `.git/…`, and `.3pitor/…`.
- **BC7, temp litter.** This matters after a crash mid-save: the temp files show in `git status` and in the delete count.
- **Boundary rules that stay manual.** This matters when E2, C1, FS2, or FS3 regress. Only `check_boundaries.py` checks them, and it is not in `make test`. `boundary.test.ts` covers the fs-API ban, entry-only imports, and the engine symbol rule.
- **Makefile omission.** This matters if `src/file-system` is not added to `test-server`. Then D9's enforcement and every package test silently stop running.
- **Remote backends**, deferred to `system-architect`. This matters when an S3 or Notion backend is requested. The open questions are:
  - consistency
  - credentials
  - integration style
  - whether `.3pitor/` lives in the same store (O1)
  - transient errors in `readJson` (F21)
  - object-store folder semantics (D22)
  - whether `changed` is that backend's only event

## Evidence

The evidence for this design is in these files:

- **Discovery findings F1–F49 and open items O1–O2:** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/file-system-package/context-brief.md`
- **Goal clauses G1–G9 and options A–C:** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/file-system-package/design-options.md`
- **Decisions D1–D42:** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/file-system-package/artifacts/decision-log.md`
- **The pre-validation design:** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/file-system-package/artifacts/amended-design.md`
- **V1–V15 with dispositions:** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/file-system-package/artifacts/validation-findings.md`

This revision was checked again against these source files:

- `src/engine/components/workspace-path{,.test}.ts` (the six cases mapped in BC3)
- `src/engine/documents/documents.ts` (move order, `'other'` treated as a file, today's link messages)
- `src/engine/components/json-file.ts`
- `src/engine/chat/tools/tools.ts`
- `src/engine/chat/components/` (the five files, three of which use fs)
- `src/engine/workspace/workspace.ts`
- `src/engine/engine.ts`
- `tsconfig.json` (`lib` includes DOM)
- `Makefile:40`
- a production-wide grep for fs APIs and for `require`/`import(`; the only dynamic import is `ui/test-setup.ts`, and it is not fs

## Next Step

Run `/tdd` against this document on branch `file-system-package`, following the "planning runs ship on a branch" practice: branch, push as you go, and open a draft PR. Build in this order:

1. The package tests: keys, glob parity, local backend, watcher, workspace, boundary.
2. The engine rewiring, with the D31 acceptance criterion holding.
3. The cli wiring.
4. Docs and rules.

Every assertion change outside setup lines must map to a BC number.
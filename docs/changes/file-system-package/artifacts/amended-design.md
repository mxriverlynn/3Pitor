# Amended Design: The `file-system` Package (Option A, with D2–D32 applied)

I checked this design against the source on branch `file-system-package`. Files read: `engine/engine.ts`, `cli/cli.ts`, `engine/documents/documents.ts` (+ test), `engine/components/{json-file,workspace-path}.ts` (+ tests), `engine/workspace/workspace.ts` (+ test), `engine/paths.ts` (+ test), `engine/chat/tools/tools.ts` (+ test), `engine/chat/{agent/agent.ts,sessions/sessions.ts,components/chat-test-helpers.ts}`, `engine/workspace-config/workspace-config.ts`, `engine/view-state/view-state.ts`, `engine/events/events.ts`, `server/documents/documents.routes.ts`, `server/view-state/view-state.routes{,.test}.ts`, `server/scripts/check.ts`, `server/server.ts`, `Makefile`, `README.md`, `docs/changes/server-engine-split/artifacts/check_boundaries.py`, and `.claude/skills/update-code-structure/SKILL.md`. Goal clauses G1–G9 are the ones defined in design-options.md.

## 0. Points I settled while writing this (log them as D33+ if you want them recorded)

1. **`dataDir` is deleted and inlined into `check.ts`** as `join(SRC, '.data', 'check-workspace')`.
   - Under D5 the package has no `SRC`.
   - `dataDir` does no I/O, so G2 does not require moving it.
   - It has one user, which already imports `SRC`.
2. **`WORKSPACE_FIXTURE` is defined in `engine/paths.ts`** and re-exported by `engine.ts` (D5). This keeps "only paths.ts finds `src/`" true, and `paths.test.ts` already checks that `fixtures/workspace` exists.
3. **A symlink as a middle segment is refused with today's string `<key> is outside the workspace`,** not a new one.
   - This keeps `documents.test.ts:79-87` and the 400 body for the case that is refused today byte-identical (D31).
   - Reasoning: under BC1, a link's target is outside the key space.
   - The original sketch said the AI would see `<key> is a symlink` here. That is replaced.
4. **Creations are reported per key; deletes and renames of folders are reported once (D19).**
   - `write('new/x.md')` reports `created new` (folder) and then `created new/x.md`. This is how D22's "the watcher reports the created parent folders" is met.
   - A renamed folder's descendants raise nothing.
5. **The package treats a parent segment that is a file as "missing" everywhere** (it extends D21's `stat → undefined` rule): `read`, `delete`, and `move`'s source give `not-found`, and `write`, `createFolder`, and `move`'s target parent give `<dirname> was not found`. See BC8.
6. **`countContents` on a file returns `{ files: 0, folders: 0 }`.** That matches its own comment ("everything a delete would remove, not counting the item itself"). Today it is a 500 from ENOTDIR. See BC9.
7. **json-file's `writeText` starts `fileSystem.write(key)` synchronously and runs the `.gitignore` check alongside it.**
   - Starting the write before any `await` is what keeps call order; a check-then-write would let two writes swap.
   - This is how I read D23's "in the same queue". The difference: a failed `.gitignore` write rejects that call, but the content may already have landed. Today the content is not written in that case.
8. **The local watcher never tracks names that match the package's own temp pattern** `^\..+\.\d+\.tmp$`. That is how D17's "own saves are `updated`, not delete plus create" holds even when the 1 s cap splits a burst mid-write.
9. **`watch()` still throws synchronously if `fs.watch` itself throws.** That is today's behavior: `startEngine` rejects. Only errors during the initial walk and later errors are logged and stop watching (D20).
10. **`Makefile` `test-server` must add `src/file-system`.** Otherwise `boundary.test.ts` (D9) never runs under `make test`. Today the line is `bun test src/cli src/server src/engine src/shared`. This one is load-bearing.

---

## 1. Surface

### 1.1 Package layout (D6: package → feature → component)

```text
src/file-system/
  file-system.ts                     entry: the contract types, re-exports. The only module cli, engine, server tests import.
  boundary.test.ts                   D9: no fs API outside this package (with named exemptions)
  components/                        shared by this package's features (README "components/" rule)
    file-system-error.ts             FileSystemError, FileSystemErrorReason
    keys.ts                          checkKey (strict grammar), normalizeKey (loose input), parentKey
    keys.test.ts                     the grammar table
  glob/                              feature, single component: files sit in the feature folder
    glob.ts                          glob(fileSystem, pattern, { dot })
    glob.test.ts
  local/                             feature: the local-disk backend (two components → one folder each)
    local-file-system/
      local-file-system.ts           createLocalFileSystem(root); per-key write queue; segment walk; errno map
      local-file-system.test.ts
      watch.ts                       helper only local-file-system.ts imports: snapshot-diff watcher
      watch.test.ts
    workspace/
      workspace.ts                   chooseWorkspace, ensureWorkspace, resetWorkspace (moved from engine/workspace/)
      workspace.test.ts
```

Deleted:

- `src/engine/components/workspace-path.ts` and its test
- `src/engine/workspace/workspace.ts` and its test (the test moves)

`src/engine/components/` keeps only `json-file.ts` (F49).

### 1.2 `src/file-system/file-system.ts`

```ts
// The file-system package: every runtime file read and write, behind one key-based contract. cli builds an instance and
// hands it to the engine (G9). Imports no other package.

// "file": regular file. "folder": directory. "other": anything else. On local disk: symlink, socket, FIFO, device.
// Remote backends never return "other" (D14). Callers' rules: list callers drop it; count counts it as a file (F19);
// glob skips it.
export type EntryKind = 'file' | 'folder' | 'other';

export interface FileEntry {
  key: string;         // the full key, not just the name
  kind: EntryKind;
}

// Batched, typed changes (G6). A folder delete or rename is one event; descendants are implied (D19).
// A created folder is followed by a created event for each key under it. No other order is promised.
export type FileEvent =
  | { type: 'created'; key: string; kind: 'file' | 'folder' }
  | { type: 'deleted'; key: string; kind: 'file' | 'folder' }
  | { type: 'updated'; key: string; kind: 'file' }
  | { type: 'renamed'; from: string; to: string; kind: 'file' | 'folder' };

export interface WatchOptions {
  // Called for a folder key before the watcher descends into it, and for a file key before tracking it. A key for which
  // it returns true, and everything under it, is never walked, tracked, or reported (D15). Never called with "".
  ignore?: (key: string) => boolean;
}

export interface FileSystem {
  // Where the files live, for display only. Local: the root exactly as passed to createLocalFileSystem (D2, D11).
  readonly location: string;

  // Does not follow links (D21). undefined: nothing there, or a parent segment is missing or is a file.
  // A link as the final segment → 'other'. A link as a middle segment → rejects 'invalid'. "" is the root.
  stat(key: string): Promise<EntryKind | undefined>;

  // utf-8 text. A missing key → 'not-found'. A final-segment link → 'invalid'.
  read(key: string): Promise<string>;

  // Replaces the whole file. A reader never sees half a file (D30/BC2). Missing parent folders are created (D22).
  // Queued when called, before any await: writes to one key land in call order, process-wide (D3).
  // A key that is a folder → 'invalid' "<key> is a folder" (D26).
  write(key: string, text: string): Promise<void>;

  // The parent must exist and be a folder; an existing item at key → 'exists'.
  createFolder(key: string): Promise<void>;

  // Direct children, unordered. "" lists the root. A missing key, or one that is not a folder → 'not-found'.
  list(folder: string): Promise<FileEntry[]>;

  // Waits first for writes already queued under from and to (D4). Refuses: into itself (lexical, plus same-disk-item
  // check on local), an existing target unless it is the same stored item (D25), a missing target parent.
  // A final-segment link moves as a link.
  move(from: string, to: string): Promise<void>;

  // Recursive. Waits first for writes already queued under key (D4). A link is removed as a link.
  delete(key: string): Promise<void>;

  // Non-empty batches after each settled burst (100 ms quiet / 1 s cap). Returns unsubscribe (idempotent).
  // Listener throws are caught and logged. Lazy: nothing is watched until called (createEngine starts no watcher).
  watch(listener: (events: FileEvent[]) => void, options?: WatchOptions): () => void;
}

export { FileSystemError, type FileSystemErrorReason } from './components/file-system-error';
export { normalizeKey } from './components/keys';
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
// The strict grammar every method applies to its key arguments. Never canonicalizes. "" (the root) is accepted only
// where allowRoot is set (stat, list).
export function checkKey(key: string, options?: { allowRoot?: boolean }): void;
//   throws FileSystemError('invalid', `${JSON.stringify(key)} is not a valid key`)

// For loose, untrusted model input only (D13). Browser keys never pass through it.
// "./notes.md" → "notes.md"; "a/../b.md" → "b.md"; "a//b/" → "a/b"; "." → "".
// Absolute or escaping input → FileSystemError('invalid', `${input} is outside the workspace`).
// The canonical result is then checked with checkKey(…, { allowRoot: true }) (F44: validate after canonicalizing).
export function normalizeKey(input: string): string;

// "a/b/c.md" → "a/b"; "c.md" → "" (the root). Used for parent lookups. Messages use posix dirname ("." at top level).
export function parentKey(key: string): string;
```

```ts
// src/file-system/glob/glob.ts — over the interface, so it works on any backend (F28).
// Walks with list() from the pattern's literal prefix (its leading segments without glob characters). If the pattern
// has no "**", it descends no deeper than the pattern's segment count. Matches file keys with Bun.Glob#match.
// dot: false (default) skips names starting with "." and never walks hidden folders (D28).
// Skips 'other' entries (D14). A missing prefix, or a prefix refused as 'invalid', gives [] (D28).
// Other errors propagate. Returns keys, unordered.
export function glob(fileSystem: FileSystem, pattern: string, options?: { dot?: boolean }): Promise<string[]>;
```

### 1.3 `src/file-system/local/local-file-system/local-file-system.ts`

```ts
// Synchronous, no I/O (mirrors createEngine). root must be absolute, else throws Error(`${root} is not an absolute path`).
// location = root exactly as passed (D2, D11).
export function createLocalFileSystem(root: string): FileSystem;

// --- internals, described at signature level ---

// Process-wide, keyed by absolute disk path join(root, key) (D3). Shared by every instance on the same root string.
const pending: Map<string, Promise<void>>;

// Walks a key's segments below root with lstat. Root components are never checked (D2).
// - a middle segment that is a symlink → FileSystemError('invalid', `${key} is outside the workspace`)
// - a middle segment missing or a file → { path, parentMissing: true }
// - otherwise → { path, stats?: lstat of the final segment }
async function locate(root: string, key: string): Promise<{ path: string; stats?: Stats; parentMissing: boolean }>;

// write(key, text):
//   checkKey(key) → enqueue on pending[path] at call time →
//   locate → parentMissing because a segment is a file → 'not-found' `${dirname(key)} was not found`
//          → final is a symlink → 'invalid' `${key} is a symlink`
//          → final is a folder → 'invalid' `${key} is a folder` (D26)
//   mkdir(dirname(path), { recursive: true })
//   temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
//   Bun.write(temp, text); rename(temp, path)
//   on any failure after the temp exists: rm(temp, { force: true }) best effort, then reject with the original error (D27)
//   pending[path] = write.catch(() => {})  // a failed write does not block later writes (as json-file today)

// move(from, to) / delete(key): first await every pending entry whose path === p or startsWith(p + sep), for p in the
//   keys touched (D4). Only writes queued before the call are awaited.

// errno map, for the final act only (a race after the checks): ENOENT/ENOTDIR → 'not-found' `${key} was not found`,
//   EEXIST → 'exists' `${key} already exists`. Every other errno is rethrown unchanged (F12).
```

`watch.ts` is a helper that only `local-file-system.ts` imports:

```ts
// src/file-system/local/local-file-system/watch.ts
export function watchLocal(root: string, listener: (events: FileEvent[]) => void, options: WatchOptions): () => void;
// 1. fs.watch(root, { recursive: true }) starts synchronously (a synchronous throw propagates, as today).
// 2. The snapshot { key → { kind, dev, ino, mtimeMs, size } } of non-ignored keys is built asynchronously (D20).
//    It skips 'other' entries, names matching /^\..+\.\d+\.tmp$/, and ignored keys (ignore is checked on a folder before
//    descending, D15). Raw events that arrive during the build are held, then settled in the first burst after it.
// 3. A raw event: key = filename with platform separators turned into "/". If ignore() is true for the key or any
//    ancestor, the event is dropped and starts no timer (F32). Otherwise it marks the parent folder dirty, and the key
//    too if it is a tracked folder. A 'change' on a tracked file key adds it to `touched` (D17). A null filename
//    marks the whole tree dirty.
// 4. Settle (100 ms quiet / 1 s cap): re-list each dirty folder and diff it against the snapshot.
//    - gone + new with the same (dev, ino, kind) → renamed (a folder's subtree is re-keyed; no descendant events)
//    - present before and after, ino changed (temp-and-rename save) → updated (D17)
//    - same ino with mtimeMs or size changed, or in `touched` → updated (D17)
//    - gone → deleted (a folder once; its subtree is dropped from the snapshot) (D19)
//    - new → created, a new folder walked and each new descendant reported as created
//    The listener is called only with a non-empty batch (D17). Listener throws are logged:
//    `Could not report a workspace change: <message>` (today's string).
// 5. A watcher 'error', or a read error other than ENOENT/ENOTDIR during the build or a diff:
//    log `Stopped watching the workspace: <message>` (today's string), close, clear timers (F33, D20).
// 6. Unsubscribe: close fs.watch, clear timers, drop the snapshot. A pending burst is never delivered.
```

### 1.4 `src/file-system/local/workspace/workspace.ts` (moved; D5)

```ts
// The root to open: the folder named, or the folder holding a named file. A name that does not exist warns and falls
// back to process.cwd(). With no name: workspaceEnv (seeded from fixture if absent), else process.cwd().
export function chooseWorkspace(
  name: string | undefined,
  options: { workspaceEnv: string | undefined; fixture: string },
): Promise<string>;

export function ensureWorkspace(path: string, fixture: string): Promise<string>;   // cp fixture → path only if path is absent
export function resetWorkspace(path: string, fixture: string): Promise<string>;   // rm path; cp fixture → path
// dataDir: removed (point 1 in section 0).
```

### 1.5 `src/engine/paths.ts` and `src/engine/engine.ts` (changes only)

```ts
// src/engine/paths.ts
export const SRC = resolve(import.meta.dir, '..');
export const WORKSPACE_FIXTURE = join(SRC, 'fixtures/workspace');      // D5
```

```ts
// src/engine/engine.ts
import type { FileSystem } from '../file-system/file-system';
import { countContents, createEntry, deleteEntry, isHiddenKey, listEntries, moveEntry, readDocument, writeDocument } from './documents/documents';
// (no import of ./workspace/workspace — deleted)

export { DocumentError } from './documents/documents';
export { WORKSPACE_FIXTURE } from './paths';                            // D5: cli and check.ts get the fixture here
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
  readonly workspace: string;        // = fileSystem.location, display only (D11, F7)
  /* documents, sessions, viewState, workspaceConfig, events: unchanged */
}

export function createEngine(options: EngineOptions): Engine;  // unchanged: synchronous, no I/O, no watcher

export async function startEngine({ fileSystem, claude, model, serveTools }: StartOptions): Promise<Engine> {
  const { engine, events, sessions } = wire({ fileSystem, claude, model, serveTools });
  // Payload-free hint per batch (D18, F30); hidden keys never tracked nor reported (F36, F32). Unsubscribe discarded (F33).
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
  // new Sessions(options, events)  — options.fileSystem flows to AgentOptions
}
```

### 1.6 `src/engine/components/json-file.ts`

```ts
import { FileSystemError, type FileSystem } from '../../file-system/file-system';

export const stateKey = (name: 'session.json' | 'view.json') => `.3pitor/${name}`;   // replaces stateFile (F11)
const GITIGNORE = '.3pitor/.gitignore';

// not-found → undefined, silently. Any other failure, or unparseable text → console.warn(`Could not read ${key}: …`),
// undefined (F21 kept).
export function readJson(fileSystem: FileSystem, key: string): Promise<unknown>;

// JSON.stringify runs at call time (value captured).
export function writeJson(fileSystem: FileSystem, key: string, value: unknown): Promise<void>;

// fileSystem.write(key, text) is issued before any await (call order kept by the package's queue, D3). Alongside it:
// if stat(GITIGNORE) is undefined, write GITIGNORE "*\n" (D23: checked on every write, no memo; a user's own file is
// left alone; two instances racing both write "*"). Resolves when both settle; rejects with the first failure, for this
// call only.
export function writeText(fileSystem: FileSystem, key: string, text: string): Promise<void>;
```

### 1.7 Engine feature signature changes

```ts
// engine/documents/documents.ts — rules stay here (F13–F19); I/O through fileSystem; FileSystemError → DocumentError
export class DocumentError { /* unchanged: 'invalid' | 'not-found' */ }
export function checkPath(path: string, kind: 'file' | 'folder'): void;                 // unchanged
export const isHiddenKey: (key: string) => boolean;                                     // any segment starts with "."
export function listEntries(fileSystem: FileSystem): Promise<DocumentEntry[]>;
//   recursive list from ""; skips hidden names and 'other'; .md files only; a FileSystemError on a non-root folder →
//   skipped (vanished mid-walk); root not-found → rethrown as plain Error (D16 → 500); sorted by "<"
export function readDocument(fileSystem: FileSystem, path: string): Promise<string>;
export function writeDocument(fileSystem: FileSystem, path: string, content: string): Promise<void>;
export function createEntry(fileSystem: FileSystem, path: string, kind: 'file' | 'folder'): Promise<void>;
//   checkPath; stat(path): 'other' with kind 'file' → invalid `${path} is a symlink` (today's string); any other
//   defined → invalid `${path} already exists`; stat(parentKey) !== 'folder' → not-found `${dirname(path)} was not found`
//   (D22 pre-check kept); folder → createFolder; file → write(path, `# ${basename(path,'.md')}\n`)
export function moveEntry(fileSystem: FileSystem, from: string, to: string): Promise<void>;
//   checkPath(from,'folder'); stat → undefined → not-found; checkPath both with the real kind; fileSystem.move
export function countContents(fileSystem: FileSystem, path: string): Promise<FolderCount>;
//   recursive list; folder → folders++ and recurse; file/other → files++; a non-folder item → { files: 0, folders: 0 }
export function deleteEntry(fileSystem: FileSystem, path: string): Promise<void>;
// mapping: FileSystemError 'exists' → DocumentError('invalid'), others keep their reason; message passed through (F12)
// watchDocuments: removed (moved into the package as watch.ts)
```

```ts
// engine/chat/agent/agent.ts
export interface AgentOptions { fileSystem: FileSystem; model?: string; claude: ClaudeMode; serveTools: ServeTools }
//   loadWorkspaceConfig(options.fileSystem); fileTools(options.fileSystem, turn, progress)

// engine/chat/sessions/sessions.ts — SessionsOptions extends AgentOptions (unchanged shape otherwise)
//   readJson(this.options.fileSystem, stateKey('session.json')); turnTexts(documents);
//   writeJson(this.options.fileSystem, stateKey('session.json'), …)

// engine/chat/tools/tools.ts — lexical grammars over normalizeKey; no node:fs, no Bun.file, no Bun.Glob
export function turnTexts(documents: Record<string, string>): TurnTexts;                // workspace arg dropped
export function postName(filePath: string): string;                                     // pure; no case folding (BC4)
export function fileTools(fileSystem: FileSystem, turn: TurnTexts, onChange?: () => void);
//   resolvePost(filePath): APP_SKILL_PREFIX → `${filePath} is not a markdown post`; key = normalizeKey(filePath);
//     not .md or any segment starts with "." → `${filePath} is not a markdown post`
//   resolveAppNote(filePath): key under ".3pitor/", .md, no hidden segment after it → key; else undefined
//   Read: appSkillText → turn copy → fileSystem.read(normalizeKey(file_path)); not-found → `${file_path} does not exist`
//   Write note: writeText(fileSystem, key, content) → `wrote ${key}`
//   Edit note: read; not-found → `${file_path} does not exist`; writeText(…) → `edited ${key}`
//   Edit/Highlight post: turn copy ?? fileSystem.read(key) (not-found message passes through: BC3)
//   Write post: turn copy ?? read, with not-found → ''
//   Glob: same absolute/".." pattern refusal; (await glob(fileSystem, pattern)).sort().join('\n'); insideWorkspace removed

// engine/workspace-config/workspace-config.ts
export function loadWorkspaceConfig(fileSystem: FileSystem): Promise<WorkspaceConfig>;
//   scan = glob(fileSystem, pattern, { dot: true }); readMarkdown = parseFrontmatter(await fileSystem.read(key))

// engine/view-state/view-state.ts
export function loadViewState(fileSystem: FileSystem): Promise<ViewState>;
export function saveViewState(fileSystem: FileSystem, view: ViewState): Promise<void>;

// engine/chat/components/chat-test-helpers.ts (test helper)
export function withWorkspace(run: (workspace: string, turn: TurnTexts, fileSystem: FileSystem) => Promise<void>);
//   third parameter appended; the four existing callers keep compiling
```

### 1.8 `src/cli/cli.ts`

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

### 1.9 `src/server/scripts/check.ts` (changes only)

```ts
import { SRC } from '../../engine/paths';
import { WORKSPACE_FIXTURE } from '../../engine/engine';
import { resetWorkspace } from '../../file-system/file-system';
const WORKSPACE = join(SRC, '.data', 'check-workspace');
await resetWorkspace(WORKSPACE, WORKSPACE_FIXTURE);
// readDoc / summary.md checks: Bun.file stays (named exemption, F3)
```

### 1.10 `src/file-system/boundary.test.ts` (D9)

```ts
// G2: reads and writes "must" go through the package. Runs inside make test (Makefile test-server lists src/file-system).
const BANNED = [/from\s+['"](node:)?fs(\/promises)?['"]/, /\bBun\.file\(/, /\bBun\.write\(/, /\bBun\.Glob\b/];
const EXEMPT = [
  'src/engine/workspace-config/app-skills.macro.ts',   // bundle-time macro (F2)
  'src/engine/chat/components/',                       // test fixtures: chat-test-helpers, fake-claude, fake-claude-on-path (F3)
  'src/server/scripts/check.ts',                       // end-to-end check's verification reads (F3)
];
// Scans src/**/*.{ts,tsx} except *.test.ts(x) and src/file-system/**.
test('no production module outside src/file-system/ touches the disk directly');   // lists path:line for each hit
test('every exemption names a path that exists');                                  // a stale exemption fails
```

---

## 2. Invariants

**Key grammar (exact; D29, the same on every OS).**

```text
key     := "" | segment ( "/" segment )*
segment := one or more characters, other than "." and "..", containing no "/", "\" or U+0000
```

- `""` is the root. Only `stat` and `list` accept it.
- Anything else fails the grammar with `invalid`: a leading or trailing `/`, an empty segment, a `.` or `..` segment, `\`, or NUL. This adds no rule beyond today's lexical rules (F13). `..foo` is valid (F45, BC5).
- The grammar has no hidden-name rule. Hidden-name policy belongs to the engine (`checkPath`, `isHiddenKey`, the tools' grammars; F25).

**Canonicalization.**

- Methods never canonicalize. A key is compared byte for byte: no case folding, no Unicode normalization.
- Only `normalizeKey` canonicalizes. It does posix normalize, then removes a trailing `/`, then maps `.` to `""`, then refuses absolute or `..`-escaping results, then applies `checkKey`. Validation runs on the canonical form (F44).
- Browser keys skip `normalizeKey`, so `a/./b.md` is refused rather than rewritten (D13).

**Root handling (D2, D16).**

- `root` must be absolute. `location === root` as passed.
- Components of the root path are never checked for links: a workspace opened through a link, and `/var` → `/private/var`, work.
- A missing or non-folder root gives `stat("") → undefined` and `list("") → not-found`. `listEntries` rethrows that as a plain `Error`, so `GET /api/documents` stays a 500.

**Links and stat (D21, BC1).**

- Keys never pass through a symlink below the root.
- Middle-segment link: every method rejects with `invalid`.
- Final-segment link:
  - `stat` gives `'other'`
  - `list` lists it as `'other'`
  - `read`, `write`, and `list(key)` reject with `invalid`
  - `move` and `delete` act on the link itself
- A file in a parent position counts as missing: `stat → undefined`, and the not-found errors listed in section 3.

**Parent creation (D22).**

- `write` creates missing parent folders, and the watcher reports them as `created`.
- `createFolder` and `move` require the parent.
- Documents' `create` keeps its own parent pre-check. The window between that check and the act is accepted (F38).

**Write atomicity and ordering scope (D3, D4, D27, D30).**

1. Every `write` goes to a temp file `.<name>.<pid>.tmp` in the target folder, then is renamed over the target. A reader sees the old text or the new text, never half.
2. Writes are queued at call time, before any await, in a process-wide map keyed by `join(root, key)`. Writes to one key land in call order across every instance on the same root string. A failed write rejects only its own caller; later writes still run.
3. `move` and `delete` first wait for writes already queued under any key they touch (a prefix match for folders). A save followed at once by a rename or delete cannot bring back the old name.
4. Nothing orders writes across processes beyond rename atomicity (the pid in the temp name avoids collisions). Nothing orders writes against later `move`/`delete` calls, or reads against writes (F37–F39 unchanged).
5. A failed write removes its temp file on a best-effort basis. A crash can leave one behind (BC7).

**Event semantics (D15, D17–D20).**

- Events come in batches, one per settled burst (100 ms quiet / 1 s cap, as today). The listener is never called with an empty batch. A burst made only of ignored keys calls nothing, so `.3pitor` saves stay silent (F32).
- `ignore` is checked on a folder before descending into it, so an ignored folder (`.git`) is never walked.
- `updated`:
  - a tracked file's raw `change` (deduplicated per burst)
  - a change in `mtimeMs` or `size` on re-list
  - a changed ino at the same key (temp-and-rename saves, including the package's own)
- `renamed`: only when a delete and a create in one burst share `(dev, ino, kind)`. Otherwise a rename is a delete plus a create (F31).
- Folder delete or rename: one event. Folder create: the folder plus each descendant.
- The package's temp names are never tracked. `'other'` entries are never tracked or reported.
- The engine turns each batch into one payload-free `documents-changed` (D18). No key reaches a socket (F36).

**Lifecycle.**

- `createLocalFileSystem` does no I/O.
- `watch` is lazy. Each call has its own `fs.watch` and snapshot. It returns an idempotent unsubscribe.
- `createEngine` starts no watcher. `startEngine` subscribes once and discards the unsubscribe (F33).
- The initial snapshot is built asynchronously. Startup does not wait for it (D20).

**Unchanged on the wire (D31).**

- Every HTTP route, status, and JSON body, except the BC-listed ones
- the `listening on … (workspace: …)` line
- the `/api/health` body (`workspace` = `location` = today's path)
- `documents-changed` (no payload, same burst timing, plus the re-list time)
- WebSocket framing, SSE, and every `shared/wire.ts` type

---

## 3. Failure Behavior

Message strings are exact; `<key>` is the key as given (D24). Documents maps `exists` → 400 `invalid`. Every plain `Error` on documents routes → 500 `Internal Server Error` (body constant). View-state PUT → 500 `{"error": message}`. AI tools → the message as the tool error.

| Condition | Method(s) | Reason | Exact message | HTTP route / AI tool observes |
|---|---|---|---|---|
| Key fails grammar (incl. `""` outside stat/list) | all | invalid | `"<key>" is not a valid key` (JSON-quoted) | Documents: unreachable, because `checkPath` refuses first (F13). Tools: only after `normalizeKey`, e.g. `\` in input. |
| Absolute or escaping loose input | `normalizeKey` | invalid | `<input> is outside the workspace` | Tools: same string as today (`workspace-path.ts:11`). An absolute path inside the workspace is now refused (BC3). |
| Link as a middle segment | all | invalid | `<key> is outside the workspace` | 400 with today's body for out-pointing links. In-pointing links are newly refused (BC1). Tools: Read/Edit show the message; Glob skips. |
| Link as the final segment | read, write, list | invalid | `<key> is a symlink` | 400, today's string (`documents.ts:57`). |
| Missing key | read, delete, move (from), list (non-root) | not-found | `<key> was not found` | 404, today's string. Tools: Read and note Edit rewrite it to `<file_path> does not exist` (kept). Post Edit/Highlight pass it through (BC3). |
| Parent segment is a file | read/delete/move-from → not-found as above; write/createFolder/move-target → | not-found | `<dirname(key)> was not found` (`.` at top level) | 404, was 500 (BC8). |
| Missing parent | createFolder, move (target) | not-found | `<dirname(key)> was not found` | 404, today's string (`documents.ts:197`). |
| Target exists | createFolder (`<key>`), move (`<to>`, not the same item per D25) | exists | `<key> already exists` | 400, today's string. Documents' own pre-check gives the same string. |
| Into itself (`to === from`, `to` under `from/`, or same item on disk by real path) | move | invalid | `<from> cannot move into itself` | 400, today's string. |
| Write onto a folder | write | invalid | `<key> is a folder` | PUT document: 400 `{"error":"<key> is a folder"}`, was 500 (BC6). View-state: 500 with this text. Tools note Write: this text. |
| Root missing or not a folder | list(`""`) | not-found | `the workspace root was not found` | `listEntries` rethrows as plain `Error` → 500 `Internal Server Error`, as today (D16). |
| Root missing | stat(`""`) | — | returns `undefined` | — |
| Race after checks: ENOENT/ENOTDIR or EEXIST on the final act | all | not-found / exists | `<key> was not found` / `<key> already exists` | 404 / 400. Today these were 500s; only reachable in a race. |
| Any other errno (EACCES, EISDIR on read, EBUSY, ENOSPC…) | all | — | rethrown unchanged | 500 `Internal Server Error`, as today (F12). Tools: raw text. |
| Non-absolute root | createLocalFileSystem | — (plain Error) | `<root> is not an absolute path` | Programming error; cli always passes an absolute path. |
| `fs.watch` throws synchronously | watch | — | rethrown | `startEngine` rejects, as today. |
| Watcher `error` event | watch | — | logged: `Stopped watching the workspace: <message>` | Watching stops; no more `documents-changed` until restart (F33, as today). |
| Initial-walk or diff read error (not ENOENT/ENOTDIR) | watch | — | logged: `Stopped watching the workspace: <message>` | Same as above (D20). |
| Listener throws | watch | — | logged: `Could not report a workspace change: <message>` | Later batches still delivered. |
| Write fails after the temp exists | write | the original error | original | Temp removed best effort (D27). A crash leaves `.<name>.<pid>.tmp` (BC7). |
| `.3pitor/.gitignore` write fails | json-file writeText | the original error | original | That `writeText` call rejects. The content write may still have landed (point 7 in section 0). Session save: logged as today. View-state: 500. Note tool: error text (D23). |
| Corrupt or unreadable state | json-file readJson | — | warn: `Could not read <key>: <message>` | Treated as no state; the next save overwrites (F21 kept). The log names the key, not the absolute path (BC11). |
| Glob prefix missing or refused | glob | — | `[]` | Glob tool returns empty. Workspace config: no skills or agents from that folder (BC1 for linked `.claude/skills`). |

---

## 4. Why Each Element Is Here

| Element | What it does | Justification |
|---|---|---|
| Package `src/file-system/` | Holds all runtime file I/O | G1 "separate all file operations into their own package" |
| Entry `file-system.ts` (the only importable module) | One contract surface | G9 "similar to how the engine is passed" (the `engine/engine.ts` precedent); D7 |
| Layout `components/`, `glob/`, `local/{local-file-system,workspace}/` | README package → feature → component | D6; README "components/ folders" rule |
| `watch.ts` as a helper inside `local-file-system/` | Imported only by the local backend | README "a component is one module plus the helpers only it imports" |
| Types declared in the entry; values in `components/` | Avoids a runtime import cycle between entry and backend | D6; the local backend imports types only from the entry |
| `FileSystem` interface | The swappable layer | G3 "abstraction layer that allows us to swap out the filesystem backend" |
| `location` (renamed from `label`) | Display string; `Engine.workspace` | D11, F7, O2; keeps `listening on` and `/api/health` byte-identical (D2) |
| `stat(key)` | Kind or undefined, no link-following | F16–F18 pre-checks; D21 |
| `stat("")` allowed | Root existence | F14 (walk from root); D16 |
| `read` → utf-8 string | Text read | G2; every read today is text (F1, F22, F27) |
| `write` replaces whole file | Save and state writes | F15, F20 |
| `write` atomic via temp + rename | No half files | F20; D30 (BC2) |
| `write` creates parents | Save into new folders | F15; D22 |
| `write` queue at call time, process-wide, keyed by absolute path | Call-order writes per key | F20; D3 |
| `write` onto folder → invalid | Clear refusal | D26 |
| Failed write removes its temp | No litter on a normal failure | D27 |
| Temp name `.<name>.<pid>.tmp` | Hidden, per-process | F20 (pid); D27; the leading dot keeps it out of the tree and the engine's watch (F32) |
| `createFolder`, parent required | Empty folders | G6 "folder"; F14; F16 |
| `list(folder)` direct children, unordered | Walk without descending into hidden folders; S3-friendly | F14, F28; the engine sorts (F14) |
| `list` missing/non-folder → not-found | Vanished-folder skip | F14 |
| `move` waits for queued writes | No resurrected names | D4 |
| `move` lexical into-itself | Works on any backend | F43 |
| `move` local real-path into-itself | Case variants on a case-insensitive disk | F18 (`documents.ts:145-149`) |
| `move` same-item exception | Case-only rename | F18; D25 (dev+ino on local) |
| `move` target parent required | Today's rule | F16, F18 |
| `delete` recursive, link as link, waits for writes | Today's `rm`; no resurrection | F19; D4 |
| `watch(listener, options)` → unsubscribe | Events plus lifecycle | G6, G7; F32 (lazy); F33 |
| Batched `FileEvent[]` | Settled bursts | G6; F29 debounce |
| `created`/`updated`/`deleted`/`renamed` | Typed events | G6 verbatim; D18 |
| `renamed` only with ino pairing | Honest about what the platform reports | F31 |
| One event per folder delete/rename | Descendants implied | D19 |
| Per-key `created` for new subtrees | `write` reports created parents and the file | D22; point 4 in section 0 |
| `updated` on raw `change` + mtime/size + ino change | In-place and temp-and-rename edits refresh the UI | D17; F30 |
| No empty batch; ignored-only bursts silent | `.3pitor` saves never echo | D17; F32 |
| Async initial snapshot, held raw events | Startup not blocked, no lost events | D20 |
| Temp-pattern names never tracked | Own saves are `updated`, never delete+create | D17; point 8 in section 0 |
| `'other'` never tracked by the watcher | `FileEvent.kind` is file/folder only | D14; F14 (the tree omits links) |
| Listener throws caught and logged | Isolation within this emitter | F35; today's `documents.ts:96-100` string |
| Watcher/walk error → log and stop | Today's behavior | F33; D20 |
| `WatchOptions.ignore`, checked before descending | Engine hidden policy; no `.git` walk | F29, F36; D15 |
| `EntryKind` incl. `'other'` | Links, sockets, etc. | F14, F19; D14 |
| `FileEntry {key, kind}` | List result | F14 |
| `FileSystemError` | Backend-neutral failures | G3; F12 (no errno leaks) |
| Reason `invalid` | Can never succeed | F12, F13 |
| Reason `not-found` | Missing item or parent | F12, F14, F16 |
| Reason `exists` | Target taken | F17, F18 |
| Exact messages (section 3) | Byte-identical browser strings where they exist today | D24; F12; D31 |
| Middle-link message `… is outside the workspace` | Keeps today's refusal body | D31; `documents.test.ts:79-87`; point 3 in section 0 |
| errno passthrough | 500s stay 500s | F12 |
| Key grammar enforced per call in the package | Only defense on writes | G4, G5; F40, F44, F45 |
| Grammar has no OS-specific rules | Portable | D29 |
| `""` only for stat/list | Root walk; prevents `delete("")` | F14 |
| `checkKey` | Strict per-call validation | G4; D13 |
| `normalizeKey` (renamed from `toKey`) | Canonicalizes model input once | F25, F44; D13 |
| `normalizeKey` escape message | Today's tool string | `workspace-path.ts:11`; F26 |
| `parentKey` | Parent lookups without disk paths | F10 (no absolute paths leak) |
| `glob(fileSystem, pattern, {dot})` | Pattern search over `list` | G2 (`Bun.Glob#scan` is disk I/O); F28; two users (F24, F27) |
| `glob` `dot:false` prunes hidden folders; skips refused/`'other'` | Never walks `.git`; links excluded | D28; D14 |
| `createLocalFileSystem(root)` synchronous, no I/O | Mirrors `createEngine` | G9; D2 |
| Local key → `join(root, key)` | "Path relative to the workspace root" | G5 |
| Local no-links-below-root rule | Closes F41, F42 | D2, D21, D30 |
| Root components unchecked | Linked roots and macOS temp folders | D2 |
| `chooseWorkspace(name, {workspaceEnv, fixture})` in the package | Its `stat`/`cp` are file I/O; env read stays in cli | G2; F9; D5 |
| `ensureWorkspace(path, fixture)` / `resetWorkspace(path, fixture)` | Seeding is file writes | G2; D5; `check.ts` (F9) |
| `dataDir` removed, inlined in `check.ts` | No I/O, one user, no `SRC` in the package | D5; point 1 in section 0 |
| `WORKSPACE_FIXTURE` in `paths.ts`, re-exported by `engine.ts` | Only `paths.ts` finds `src/` | D5 |
| `EngineOptions.fileSystem` / `StartOptions.fileSystem` | The engine receives an instance | G8; D12; F8 (tests use `createEngine`) |
| `StartOptions.target` removed | cli resolves the target | G9 |
| `Engine.workspace` = `fileSystem.location` | No server/cli change | D11; F7 |
| `startEngine` subscribes with `ignore: isHiddenKey` → `documents-changed` | Today's hint semantics | D18; F29, F30, F36 |
| `isHiddenKey` exported from documents | One hidden rule for tree and watch | F13, F29 |
| `AgentOptions.fileSystem` (via `SessionsOptions`) | Tools and config need the instance | F6; G8 |
| Documents functions take `fileSystem` | Rules stay in the engine (SRP) | D1; F13–F19 |
| `FileSystemError` → `DocumentError` mapping | Route mapping unchanged | F12; D31 |
| `listEntries` root not-found → plain Error | Keeps 500 | D16 |
| `createEntry` final link with kind file → `is a symlink` | Keeps today's string | `documents.ts:54-58`; D31 |
| `countContents` of a non-folder → zeros | Matches its contract; no errno needed | F19; point 6 in section 0 (BC9) |
| Tools grammars lexical over `normalizeKey` | Three grammars kept on purpose | F25; `documents.ts:25-27` |
| `postName(filePath)` / `turnTexts(documents)` drop workspace | Pure; no disk needed | F10 (`realpathSync` ×5 removed) |
| `fileTools(fileSystem, …)` | Reads through the package | G2; F24 |
| `loadWorkspaceConfig(fileSystem)` over `glob` + `read` | Config reads through the package | G2; F27 |
| `loadViewState`/`saveViewState(fileSystem, …)` | State through the package | G2; F22 |
| `stateKey` replaces `stateFile` | Keys, not disk paths | G4; F11 |
| `readJson` not-found silent, else warn → undefined | Today's state semantics | F21 |
| `writeText` issues write first; `.gitignore` check alongside, per write | Call order kept; no memo | D23; F20 |
| `.gitignore` fixed at `.3pitor/.gitignore` | One ignore for the whole folder | D23 (BC10) |
| `withWorkspace` third parameter | Helper callers get an instance without breaking | F8; D32 |
| cli builds `fileSystem` and passes it | Wiring as the goal states | G9 verbatim |
| `boundary.test.ts` | "Must" is enforced in `make test` | G2; D9 |
| Exemptions: macro, chat test helpers, `check.ts` | Bundle-time and test I/O | F2, F3; D9 |
| Exemption-exists test | Stops stale allowances | D9 (keeps the rule honest) |
| Makefile `test-server` adds `src/file-system` | The boundary and package tests actually run | D9; point 10 in section 0 |
| Real temp folders in tests, no in-memory backend | One implementation | D32 |

---

## 5. Behavior changes

Each of these is a change from what users or callers see today, and is accepted under the delegation (D30).

- **BC1: symlinks.** Keys never pass through a symlink below the root.
  - Closes F41 and F42.
  - Who sees it:
    - **Browser.** A crafted path through any linked folder is a 400 `<key> is outside the workspace`; before, only out-pointing links were refused. The tree never showed links, so the UI does not change.
    - **AI.** Read through a linked folder fails with that string. Glob skips linked entries.
    - **Users with a linked `.claude/skills` or `.claude/agents`.** Those skills and agents are silently ignored.
    - **Users with a linked `.3pitor/`.** State saves fail and are logged.
  - A workspace opened through a link is unaffected (D2).
- **BC2: atomic saves.**
  - Document saves and new-file seeds use temp plus rename instead of in-place `Bun.write`/`writeFile`.
  - Same content, but the inode changes: hard links break and a custom file mode resets.
  - Who sees it: users with hard links or custom modes.
- **BC3: strings the model sees.**
  - Edit or Highlight on a missing post: `notes.md was not found` instead of Bun's raw ENOENT text (F26).
  - Read keeps `<file_path> does not exist`, and so does note Edit.
  - An absolute path inside the workspace is refused with `<input> is outside the workspace` (the prompt already asks for relative paths).
  - Who sees it: the AI.
- **BC4: case folding lost.** `postName('Notes.md')` no longer folds to `notes.md` on a case-insensitive disk (`tools.test.ts:34` changes). Who sees it: the AI and the editor. The wrong-case Edit lands on a separate turn entry.
- **BC5: `..foo`.** A root entry named `..foo` becomes reachable (F45). Who sees it: browser and AI.
- **BC6: write onto a folder (D26).**
  - `PUT /api/documents/<key>` where the key is a folder: was 500 `Internal Server Error`, now 400 `{"error":"<key> is a folder"}`.
  - View-state PUT when `view.json` is a folder: still 500, but the body text becomes `.3pitor/view.json is a folder`.
  - An AI note Write onto a folder gets that text.
  - Who sees it: crafted requests and the AI.
- **BC7: temp litter (D27).**
  - A crash mid-save can leave `.<name>.<pid>.tmp` beside a document. Today document saves leave none; state temps sat in the git-ignored `.3pitor/`.
  - It is hidden from the tree. It is counted in the delete confirmation's file count (F19) and visible to `git status` in document folders.
  - Who sees it: users after a crash.
- **BC8: paths through a file.**
  - Read, delete, move, or count of `notes.md/x.md`, where `notes.md` is a file: 404 `… was not found` instead of 500.
  - Write there: 404 `notes.md was not found` instead of 500.
  - Who sees it: crafted requests only; the tree never offers such paths.
- **BC9: count of a file.** `POST /api/documents/count` on a file: 200 `{"files":0,"folders":0}` instead of 500. Who sees it: crafted requests; the UI counts only folders (`documents.tsx:285`).
- **BC10: `.gitignore` placement (D23).**
  - Only `.3pitor/.gitignore` is ever created, on any first write under `.3pitor/`. Nested note folders (`.3pitor/editing/`) no longer get their own.
  - The effect is the same, since `*` at `.3pitor/` ignores everything under it.
  - `json-file.test.ts:78` changes. Who sees it: git users looking inside `.3pitor/`.
- **BC11: log lines.** The `readJson` warning names the key (`.3pitor/session.json`), not the absolute path. Who sees it: the operator's console.
- **BC12: no-op bursts.**
  - A burst whose diff is empty no longer emits `documents-changed`, for example a file created and removed inside one burst.
  - Each emit now also waits for the dirty-folder re-list.
  - Invisible to the UI, which treats events as hints (F30).
- **BC13: race outcomes.** ENOENT/ENOTDIR/EEXIST on the final act after a passing check become 404/400 instead of 500. Who sees it: concurrent tabs or editors only (F38).
- **Unchanged:**
  - every other status and body, which D31 makes an acceptance criterion
  - the `listening on` line and `/api/health`
  - burst timing
  - F21 corrupt-state handling
  - the F37–F39 races
  - SEC-003's AI Read reach

---

## 6. Test Plan

**New package tests (`src/file-system/`).**

- `components/keys.test.ts`, a table-driven grammar test:
  - **Valid:** `a`, `a/b.md`, `..foo`, `.3pitor/x.md`, `a b/c.md`, `x:y`.
  - **Invalid:** `""` (outside stat/list), `/a`, `a/`, `a//b`, `.`, `..`, `a/../b`, `a/./b`, `a\b`, `a\0b`. Each is checked for the exact message.
  - **`normalizeKey`:** `./notes.md`→`notes.md`, `a/../b.md`→`b.md`, `a//b/`→`a/b`, `.`→`""`, `a/../.claude/x.md`→`.claude/x.md` (canonical first, F44); `../x`, `a/../../x`, and `/abs` → `<input> is outside the workspace`.
  - **`parentKey`:** `a/b`→`a`, `c`→`""`.
- `glob/glob.test.ts`:
  - literal-prefix walk
  - `**` and single-level patterns
  - `dot:false` prunes hidden folders, checked with a spy showing `list` is never called on `.git`
  - `dot:true` finds `.claude/skills/*/SKILL.md`
  - `'other'` and linked folders are skipped
  - a missing prefix gives `[]`
  - results match `Bun.Glob#scan` on a fixture tree (the parity check behind an open risk)
- `local/local-file-system/local-file-system.test.ts`, one test per row of the section 3 table with exact messages. Plus:
  - a non-absolute root throws
  - `location` equals the input
  - a root reached through a symlink and a macOS `mkdtemp` root work (D2)
  - `stat`'s four D21 cases
  - `write` creates parents
  - D26
  - 50 unawaited writes to one key leave the last value and no temp (moved from `json-file.test.ts:17,70`)
  - a failed write rejects for its caller and a later write succeeds (moved from `json-file.test.ts:25`)
  - two instances on one root keep call order (D3)
  - write then an immediate `delete`/`move` leaves no resurrected name (D4)
  - a failed rename leaves no temp: `spyOn` the module's `rename`, rejecting once (D27)
  - move: case-only rename on a case-insensitive disk (skipped elsewhere), into-itself lexical and by real path, target exists, target parent missing, a link moved as a link
  - delete removes a link as a link
  - list reports `'other'` for links
  - EACCES passes through unchanged (`chmod 000`)
- `local/local-file-system/watch.test.ts`. The 8 watcher tests move from `documents.test.ts:296-380` and are adapted to batches. New tests:
  - Typed events (each asserts the exact batch):
    - create a file → `created`
    - an in-place `writeFile` on an existing file → `updated` (D17)
    - the package's own `write` → exactly `[updated]`, with no temp keys
    - `rename a.md b.md` → `renamed` (Unverified on Linux; see open risks)
    - a folder rename → one `renamed`, no descendants
    - a folder delete with 10 files → one `deleted` (D19)
    - `write('new/x.md')` → `created new` (folder), then `created new/x.md` (D22)
  - Ignore and filtering:
    - an `ignore` spy never sees keys under `.git` (D15)
    - writes only under an ignored `.3pitor` → the listener is never called (D17)
    - no empty batch is ever delivered
    - a symlink created → no event
  - Errors:
    - a listener that throws is logged and later batches still arrive
    - an initial walk on a tree with an unreadable folder → logged `Stopped watching…` and no calls (D20)
  - Startup and unsubscribe:
    - an event during the initial walk is delivered after the walk
    - unsubscribe before settle → nothing, and unsubscribe twice is safe
- `local/workspace/workspace.test.ts`, moved from `engine/workspace/workspace.test.ts` (3 call lines change to the options form). New: `workspaceEnv` seeds from the given `fixture` only when absent, and `resetWorkspace(path, fixture)` re-seeds.
- `boundary.test.ts` (D9): passes on the new tree. A matcher self-check flags planted lines (`from 'node:fs'`, `Bun.file(`, `Bun.write(`, `new Bun.Glob(`), and the exemption-exists check runs.

**Engine and server setup changes (measured by grep).**

- `createEngine` call sites: **7 lines in 5 files**: `engine.test.ts:25,33`, `documents.routes.test.ts:25`, `view-state.routes.test.ts:22`, `workspace-config.routes.test.ts:20`, `mcp-endpoint.test.ts:252,270`. F8's "four server route tests" is three route tests plus the MCP endpoint test. Each becomes `createEngine({ fileSystem: createLocalFileSystem(workspace), … })`.
- Direct calls to the workspace-string APIs (`fileTools|turnTexts|postName|listEntries|readDocument|writeDocument|createEntry|moveEntry|countContents|deleteEntry|watchDocuments|readJson|writeJson|writeText|stateFile|loadWorkspaceConfig|loadViewState|saveViewState|chooseWorkspace|resolveInWorkspace|ensureWorkspace|resetWorkspace`): **125 lines in 11 test files.** F8 counted 51 with a narrower pattern. They break down as:
  - setup-only changes, **60 lines in 7 files**: `tools.test.ts` 39, `agent.test.ts` 5, `workspace-config.test.ts` 5, `sessions.test.ts` 4, `mcp-endpoint.test.ts` 4, `claude-cli.test.ts` 2, `view-state.routes.test.ts` 1
  - rewritten: `documents.test.ts` 41, `json-file.test.ts` 15
  - deleted: `workspace-path.test.ts` 6
  - moved: `workspace.test.ts` 3
- Option objects: `agentSettings({ workspace … })` ×5 in `agent.test.ts`, `new Sessions({ workspace … })` ×1 in `sessions.test.ts:32`, and `withWorkspace` in `chat-test-helpers.ts:42-46`.
- Server tests replace `stateFile(workspace, n)` with `join(workspace, stateKey(n))` (`view-state.routes.test.ts:54`, `mcp-endpoint.test.ts:265`; `sessions.test.ts:353,389,418`).
- Expected test changes:
  - `tools.test.ts:30-36`: the case-fold line is removed (BC4); the rest pass the plain string
  - `tools.test.ts:248-251`: the Glob refusal strings are kept
  - `tools.test.ts:254-260`: the Glob-through-link test still expects `''`
  - add: Edit on a missing post → `notes.md was not found` (BC3)
  - add: Read through an in-pointing linked folder is refused (BC1)
- `documents.test.ts`: every symlink-message test keeps its string. Add:
  - an in-pointing linked folder is now refused (BC1)
  - write onto a folder (D26)
  - count of a file → zeros (BC9)
  - root missing → plain Error (D16)
  - `isHiddenKey`
- `json-file.test.ts`: the queue and temp tests move to the package. It keeps, over `fileSystem`:
  - missing → undefined
  - unparseable → warn with the key
  - round trip
  - first write creates `.3pitor/.gitignore`, and an existing one is left alone
  - a nested note → `.3pitor/.gitignore`, not `.3pitor/editing/.gitignore` (BC10)
  - two unawaited `writeText` calls keep order
  - a `.gitignore` failure rejects that call only
- Deleted: `workspace-path.test.ts`. Its six cases are covered by `keys.test.ts` (`..`, absolute) and the local backend's link tests.
- `cli.test.ts`: unchanged. The end-to-end `documents-changed` test at `:44` must still pass, and so must `--version` at `:26`.

**Acceptance criterion (D31).** Every existing HTTP route test passes with only its setup lines changed: `documents.routes.test.ts`, `view-state.routes.test.ts` (its 500 test expects any string), `workspace-config.routes.test.ts`, `sessions.routes.test.ts` (no change), and `mcp-endpoint.test.ts`. Any other assertion that changes must map to a numbered BC.

---

## 7. Docs and rules to update

**README** (D10, F48):

- `:17` "Five packages" → "Six packages". Add a bullet: "`src/file-system/` holds every runtime file read and write behind `file-system.ts`: a key-based `FileSystem`, its local-disk implementation, and workspace choice. It imports no other package."
- `:19-20` cli: "chooses the workspace folder, builds the file system, starts the engine with it…". Add "and `file-system/file-system.ts`" to its imports.
- `:22` engine: drop "workspaces". Imports become "only `src/shared/`, `src/file-system/file-system.ts`, and npm packages". Add "It does no file I/O itself."
- `:23` ui: "imports none of cli, server, engine, or file-system".
- `cli.ts` bullet: it calls `chooseWorkspace` and `createLocalFileSystem`, and reads `WORKSPACE` as well as `MODEL`, `PORT`, `NODE_ENV`, and `OPEN_BROWSER`.
- `:74` `startEngine`: "takes the file system, subscribes to its changes (sending a payload-free `documents-changed` per batch, hidden keys ignored), loads the stored chat…"
- `paths.ts`: "exports `SRC` and `WORKSPACE_FIXTURE`".
- Remove the `components/workspace-path.ts` and `workspace/workspace.ts` bullets.
- Rewrite `components/json-file.ts`: `stateKey`; writes go through the file system; each write ensures `.3pitor/.gitignore`.
- `documents/`: remove the `watchDocuments` sentence; mention `isHiddenKey` and that I/O goes through the file system.
- `tools/tools.ts`: "paths are turned into keys with `normalizeKey`".
- New `### src/file-system/` section describing the files in 1.1.

**Makefile:** `test-server: bun test src/cli src/server src/engine src/shared src/file-system`. D9 depends on this.

**`.claude/skills/update-code-structure/SKILL.md`:** in "Target layout", "Five packages" → six, with the file-system package rules (no package imports; engine and cli import only `file-system/file-system.ts`; ui none). This edit gets its own commit, as with `67a45cd`.

**Change log:** `docs/changes/file-system-package/change-log.md`, in the precedent's shape (done-when table, test counts, decisions).

**`check_boundaries.py`** (it stays manual, D9):

- **E2:** allow the module `file-system/file-system` exactly. Any other `file-system/*` module from engine production is a violation.
- **C1:** cli production may import `file-system/file-system` and nothing else from that package. Today's C1 does not inspect file-system imports at all.
- **FS2 (new):** `src/file-system/` production imports resolve only inside `file-system` (npm and `node:` allowed).
- **FS3 (new, D7):** server production imports no file-system module. Server tests and `server/scripts/` may import only `file-system/file-system`. Today S1/S3 skip non-engine packages, so this needs its own rule.
- **U1:** add `file-system` to the banned packages.
- **S3 allowlist:**
  - `engine/components/json-file`: `{'stateFile'}` → `{'stateKey'}`
  - remove `engine/workspace/workspace`
  - `engine/chat/tools/tools` keeps `{'fileTools','turnTexts','editedTexts'}` (signatures changed, names unchanged)
  - add `engine/engine` exports: no entry needed, since `None` already allows all
- **Removed-files block:** add `src/engine/components/workspace-path.ts` and `src/engine/workspace/workspace.ts`.
- The fs-API ban (Option A's FS1) is not duplicated here. It lives in `boundary.test.ts`.

**Code comments:**

- `engine.ts:1-3` ("over one workspace" → "over one file system")
- `cli.ts:1-3`
- `tools.ts:1-5` ("checked against the workspace's real location on disk" → "checked as keys")
- the `documents.ts:1-2` header ("on disk")
- `events.ts:1` ("the workspace watcher")

---

## 8. Cut list

| Cut | Why cut / reopen trigger |
|---|---|
| S3, Notion, or other backends | G3 says "may"; G5 asks only for the initial implementation. Reopen: an explicit request (system-architect first). |
| In-memory backend / test double | D32. Reopen: a second backend needs a contract suite, or test time becomes measured friction. |
| Conformance suite run against every backend | One backend. Reopen at the second. |
| Facade over a `FileBackend` port that enforces keys, errors, and events for any backend | One backend. Reopen at the second. |
| Conditional writes, etags, version vectors (F37, F39) | Single-user windows. Reopen: a multi-tab data-loss report or a remote backend. |
| Exclusive-create (`wx`) on `write` (F38) | Documents pre-check accepted (D22). Reopen with conditional writes. |
| Binary and streaming I/O | All reads are text. |
| `mtime`/size on `stat` or `FileEntry` | No caller. The watcher keeps them privately (D17). |
| `FileSystem.close()` / `Engine.close()` (F33) | Unsubscribe is enough. Reopen: a backend holds a connection, or tests leak watchers. |
| `resync`/`error` event, or restart after the watcher stops (F33) | Today's behavior. Reopen if it bites. |
| Event replay or a subscribe-then-list helper (F34) | The UI re-syncs on connect. |
| One shared watcher per backend | One subscriber. |
| Typed events on the wire or to the UI | D18: the engine keeps `documents-changed` payload-free (F30, F36). |
| Descendant events for folder delete/rename | D19. |
| Case canonicalization of keys (BC4) | Local-only. Reopen if BC4 shows up in use. |
| Unicode normalization of keys | No finding. See open risks. |
| OS-specific key rules (Windows reserved names, `:`) | D29. |
| Telling transient from missing in `readJson` (F21) | Local only. Reopen with a remote backend. |
| `createFolder` semantics on object stores | D22: deferred with remote backends. |
| Memoized `.gitignore` check | D23. |
| Sweeping stale temp files at startup (BC7) | D27 accepts litter. Reopen on user reports. |
| Server bind to 127.0.0.1 and an Origin check (F40) | Server package; a separate security change. |
| Permissions or auth on keys | One user. |
| Hidden-rule filtering for the AI's Read (F24, SEC-003) | Tool policy, not this contract; flagged follow-up. |
| `EventBus` listener isolation (F35) | Engine concern. |
| Routing `app-skills.macro.ts` and `check.ts` reads through the package | Bundle-time and test-harness reads; named exemptions in D9. |
| Native glob in a backend | `list` is enough (F28). |
| Branded `Key` type | Compile-time only; costs every test line (F8). |
| `dataDir` helper | One user; no `SRC` in the package (D5). |
| ~~Wiring `check_boundaries.py` into the Makefile~~ | **Removed:** D9 replaced it with `boundary.test.ts` in `make test`. The py script stays manual. |

---

## 9. Open risks

- **Inode-stable rename.** `renamed` relies on `(dev, ino)` surviving `rename` and on both halves landing in one burst. If not, a rename degrades to `deleted` + `created`, which is still correct under F31.
  Unverified: could not inspect Bun's `fs.watch`/`rename` behavior on Linux and Windows, because no experiment was run (F31 is itself inferred).
- **`Bun.Glob#match` vs `scan` dot handling.** The `glob` helper matches keys with `match` and handles `dot` by pruning, so a pattern that names a dot segment explicitly may differ from today's `scan`. The parity test in section 6 is the check.
  Unverified: could not confirm `match`'s dot semantics, because no experiment was run.
- **Raw `change` on in-place edits.** D17's `updated` for editors that write in place depends on `fs.watch` reporting `change`, or on mtime/size differing at re-list. A same-size edit within mtime granularity and without a `change` event would be missed.
  Unverified: could not inspect per-platform event kinds, because no experiment was run.
- **Unicode normalization.** On macOS, `fs.watch` filenames and `readdir` names may differ in NFC/NFD form. Then a dirty-folder key may miss the snapshot entry and a change would go unreported until the next burst in that folder.
  Unverified: could not test with non-ASCII names, because no experiment was run.
- **Null filenames and recursive watch on Linux.** A null filename forces a full re-walk, which is expensive on big trees. Bun's recursive `fs.watch` on Linux is an existing, unchanged dependency.
- **cwd fallback to a home folder (D20).** The initial snapshot walks every non-hidden folder: `node_modules`, `Library` on macOS, and so on. It runs in the background and does not block startup, but costs memory (one entry per key) and time. Today's watcher keeps no snapshot. `make check-build` runs from an empty folder, so it does not exercise this.
- **Cost of the per-call segment walk.** O(depth) `lstat`s per operation, with `listEntries` and `glob` calling `list` per folder. Fine for blog-sized trees; unmeasured on large ones.
- **Queue keyed by the root string.** Two instances opened on the same folder through different root strings (a link vs the real path) do not share ordering (D3 assumes one root string).
- **Windows drive-style keys.** D29 adds no OS rules, so `C:/x` is a valid key, and `join(root, 'C:/x')` on Windows is undefined behavior (F45 is inferred).
- **F40, server binding.** Any host that can reach the port can write documents. Key validation is the only defense on writes until the server binds to loopback and checks Origin. That fix sits outside this package.
- **SEC-003, the AI's Read reach.** Read still reaches every key, including `.env`, `.git/…`, and `.3pitor/…`. Out of scope; a flagged follow-up.
- **BC7, temp litter in document folders.** These files are visible to `git status` and to the delete count after a crash.
- **Boundary rules beyond the fs-API ban stay manual.** E2, C1, FS2, and FS3 are enforced only by `check_boundaries.py`, which is not in `make test`.
- **Makefile omission.** If `src/file-system` is not added to `test-server`, D9's enforcement and every package test silently stop running.
- **Remote backends,** deferred to `system-architect`: consistency, credentials, integration style, whether `.3pitor/` state lives in the same remote store (O1), transient-error handling in `readJson` (F21), and object-store folder semantics (D22).
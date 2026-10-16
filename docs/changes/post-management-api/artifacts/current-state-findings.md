# Current State Findings: Implement the Post Management API

## Provenance

Both paths, because the prior report covers what posts are today and this change mostly adds new code beside them.

1. **Prior report.** [`../context-brief.md`](../context-brief.md) (2026-10-15), written by the `han-coding:design-an-api`
   run that produced [`../api-design.md`](../api-design.md). Its 36 findings (F1–F36) came from codebase-explorer,
   structural-analyst, behavioral-analyst, data-engineer, and concurrency-analyst. Most of them describe the documents
   code (`src/engine/documents/`, the routes, the tools, the UI) that this change does not touch, because wiring the
   store in is the later integration change. They are not re-extracted here. C-1 to C-4 carry forward the few that bear
   directly on the build, with their F-numbers. The brief marks some of its races `inferred` and unreproduced (its
   "Coverage notes"). None of those races bears on this build.
2. **This run's own sweep.** No specialist discovery round was dispatched. The design already went through a
   five-agent discovery round and an adversarial validation round, and nothing the build touches lies outside the
   brief except the precedent files below. The run read those files directly: the `FileSystem` contract and the local
   backend, the file-system boundary test, the engine's Bun-free scan, `entry-name.ts`, the `Makefile`, `README.md`,
   `tsconfig.json`, and `package.json`. Those reads are C-5 to C-17.

## Project Context

- **Stack:** TypeScript (`typescript` 7.0.2, `tsc --noEmit` with `strict`, `module: Preserve`, `moduleResolution:
  bundler`, `types: ["bun"]`), run and tested with Bun (`bun test`, `@types/bun` 1.4.2). The engine must also load on
  Node 22.15+ (`make check-node`).
- **Conventions source:** `README.md` ("How `src/` is laid out": packages, features, components, one-way imports, a
  Bun-free engine). No `CLAUDE.md` and no `project-discovery.md`.
- **ADRs found:** none found. `docs/adr/` does not exist.
- **Coding standards found:** none found apart from the README's layout rules.
- **Recent churn (90 days):** `README.md` 45 commits and `Makefile` 12. Under `src/file-system/`:
  `local-file-system.test.ts` 7, `local-file-system.ts` 6, `file-system.ts` 5, `boundary.test.ts` 4. Also
  `src/shared/entry-name.ts` 2 and `src/engine/bun-free.test.ts` 1. The README is the hot spot: expect a rebase there.

## Gaps

- No ADR folder and no coding standard. The README is the only written convention, so the build follows it and the
  file-system package's precedent (C-5, C-6).
- No shared contract test suite (a `describeX(name, makeStore)` style suite) exists anywhere in `src/`.
  `describePostStore` is the first. Nothing in the repo shows how one is shaped, so the plan pins it (searched `src/`
  for `function describe`).
- No in-memory or fake `FileSystem` exists. Tests use `createLocalFileSystem` over a `mkdtemp` folder (C-13).
- No helper detects whether a disk folds letter case outside `local-file-system.test.ts`, where `foldsCase` is a local
  function (C-13).

## Findings

### C-1: Today a post is a path, and nothing defines a post entity

- **Claim:** No `Post` type or post id exists in `src/`. A post is the workspace path of its draft, and a rename changes
  that path.
- **Location:** `src/shared/wire.ts:50-64`, `src/engine/documents/documents.ts:98-132`
- **Evidence:** context-brief F1, F2: "`createPost` resolves to the draft's path (`documents.ts:98-115`), and the wire
  shape is `CreatedPost { path }` (`wire.ts:61-64`)."
- **Raised by:** context-brief F1, F2 (CE D14, DE F1, BA B1, CA C6)
- **Confidence:** Verified (by the design run)
- **Bears on:** S-1, S-4. The new package defines the entity, and nothing existing changes.

### C-2: The engine imports only `shared/`, the `file-system.ts` contract, and npm packages, and stays Bun-free

- **Claim:** The README's import rules decide where the new contract can sit and what the engine may import from it.
- **Location:** `README.md:18-43`
- **Evidence:**
  ```text
  - `src/engine/` holds everything else ... It imports only `src/shared/`,
    `src/file-system/file-system.ts` (contract symbols only), and npm packages.
    - Its production code uses no Bun-only API, `bun` or `bun:*` import, import attribute, or `import.meta` field, so
      a host other than Bun can reuse it.
  ```
- **Raised by:** context-brief F31 (SA S6); re-read by this run
- **Confidence:** Verified
- **Bears on:** S-1, S-2, S-7, S-8, S-11

### C-3: The file-system package is the precedent for a swappable backend

- **Claim:** It defines one contract module and a host-built instance, and the engine receives that instance through
  its factory.
- **Location:** `src/file-system/file-system.ts`, `docs/changes/file-system-package/api-design.md`
- **Evidence:** context-brief F36. See C-5 for the module itself.
- **Raised by:** context-brief F36 (CE D13)
- **Confidence:** Verified
- **Bears on:** S-1, S-4

### C-4: `FileSystemError` reasons overlap the new `PostError` reasons

- **Claim:** `FileSystemError` has `invalid`, `not-found`, and `exists`. A caller cannot tell the two error types apart
  by `.reason` alone.
- **Location:** `src/file-system/components/file-system-error.ts:1-12`
- **Evidence:**
  ```ts
  export type FileSystemErrorReason = 'invalid' | 'not-found' | 'exists';

  export class FileSystemError extends Error {
    constructor(
      readonly reason: FileSystemErrorReason,
      message: string,
    ) {
      super(message);
    }
  }
  ```
- **Raised by:** context-brief F18; re-read by this run
- **Confidence:** Verified
- **Bears on:** S-2 (the `PostError` shape mirrors this class, but its message is fixed by its reason)

### C-5: The `FileSystem` contract the file store is built over

- **Claim:** The file store needs `list` (direct children, full keys, kinds `file`/`folder`/`other`, `not-found` for a
  missing or non-folder key), an exclusive `createFolder` (`exists` when taken), `read`, `write` (creates missing
  parents; `atomic` option), a recursive `delete`, and `watch` (batched, its unsubscribe safe to call twice, listener
  throws logged, an `ignore` predicate). Every method rejects a key failing the grammar as `invalid`.
- **Location:** `src/file-system/file-system.ts:5-85`
- **Evidence:**
  ```ts
  // A folder's direct children, in no order. "" lists the root. A missing key, or one that is not a folder, is
  // 'not-found'.
  list(folder: string): Promise<FileEntry[]>;
  ...
  // The parent must exist and be a folder; an item already at the key is 'exists'.
  createFolder(key: string): Promise<void>;
  ...
  // Replaces the file's text and creates missing parent folders. Writes to one key land in call order. ...
  write(key: string, text: string, options?: { atomic?: boolean }): Promise<void>;
  ...
  watch(listener: (events: FileEvent[]) => void, options?: WatchOptions): () => void;
  ```
  The entry also exports `FileSystemError`, `normalizeKey`, `parentKey`, `createLocalFileSystem`, and the workspace
  helpers.
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-4

### C-6: The key grammar rejects `\` and NUL in a segment, so `list` can report a key that no other call accepts

- **Claim:** `checkKey` refuses an empty segment, `.`, `..`, and any segment holding `\` or NUL, as `invalid`. The local
  `list` builds keys from `readdir` names without checking them, so a folder named `a\b` on disk is listed, and then
  `list('a\b')` is `invalid`.
- **Location:** `src/file-system/components/keys.ts:6-12`, `src/file-system/local/local-file-system/local-file-system.ts:43-61`
- **Evidence:**
  ```ts
  const valid = key.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !/[\\\0]/.test(s));
  if (!valid) throw new FileSystemError('invalid', `${JSON.stringify(key)} is not a valid key`);
  ```
  ```ts
  return dirents.map((dirent) => ({
    key: key ? `${key}/${dirent.name}` : dirent.name,
    kind: dirent.isFile() ? 'file' : dirent.isDirectory() ? 'folder' : 'other',
  }));
  ```
- **Raised by:** this run (confirms the design's V9)
- **Confidence:** Verified
- **Bears on:** S-4 (the walk and `list` skip `invalid`)

### C-7: Local `list` on a link is `invalid`, a missing root is `not-found`, and links are listed as `other`

- **Claim:** The file store's walk sees links as `other` entries, and so never descends into them. A missing workspace
  root fails `list('')` with `not-found` "the workspace root was not found".
- **Location:** `src/file-system/local/local-file-system/local-file-system.ts:43-57`;
  `local-file-system.test.ts:162-183`
- **Evidence:**
  ```ts
  if (!stats?.isDirectory()) throw new FileSystemError('not-found', 'the workspace root was not found');
  ...
  if (item.stats?.isSymbolicLink()) throw new FileSystemError('invalid', `${key} is a symlink`);
  ```
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-4. The design's file-store failure row says a missing root is "a plain Error, never a PostError". It
  is really a `FileSystemError` `not-found` from `list('')`. That is still not a PostError, so `list` passes it through
  as a storage failure. See D-9.

### C-8: Local `delete` waits for writes queued under the key, then removes recursively; a missing key is `not-found`

- **Location:** `src/file-system/local/local-file-system/local-file-system.ts:85-90`
- **Evidence:**
  ```ts
  async delete(key) {
    checkKey(key);
    await queuedUnder(join(root, key));
    const { path, parent, stats } = await locate(root, key);
    if (parent !== 'folder' || !stats) throw new FileSystemError('not-found', `${key} was not found`);
    await finalAct(rm(path, { recursive: true }), key);
  },
  ```
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-4 (delete's `not-found` mapping)

### C-9: The local write queue is per disk path, module-level, and covers writes only

- **Claim:** Writes to one key land in call order across instances in one process. Reads, lists, and `createFolder`
  are not queued. The file store's per-post queue (D16) therefore cannot be left to this one.
- **Location:** `src/file-system/local/local-file-system/local-file-system.ts:102-124`
- **Evidence:**
  ```ts
  // Every write in the process, keyed by its disk path, so writes to one key land in call order, even across instances
  // on the same root. An entry is dropped once its last write settles.
  const pending = new Map<string, Promise<void>>();
  ...
  // Queues the write when called, before any await. A failed write rejects only its own caller.
  function enqueue(path: string, write: () => Promise<void>): Promise<void> {
    const result = (pending.get(path) ?? Promise.resolve()).then(write);
    const tail = result.catch(() => {});
    pending.set(path, tail);
    tail.then(() => {
      if (pending.get(path) === tail) pending.delete(path);
    });
    return result;
  }
  ```
  context-brief F12 records the same queue.
- **Raised by:** this run; context-brief F12 (CA C1/C2)
- **Confidence:** Verified
- **Bears on:** S-4. The per-post queue copies this exact enqueue shape.

### C-10: The local watcher applies `ignore` to every ancestor prefix of a key, and logs listener throws

- **Claim:** `ignore` is called for each prefix of a key (`a`, `a/b`, `a/b/c`), so a rule that is true for any hidden
  segment but false when the last segment is `.post.json` behaves as the design intends. Listener throws are logged as
  `Could not report a workspace change: <message>`, which is the wording precedent for
  `Could not report a post change: <message>`.
- **Location:** `src/file-system/local/local-file-system/watch.ts:37-55`
- **Evidence:**
  ```ts
  const ignored = (key: string) => {
    const segments = key.split('/');
    return segments.some((_, i) => ignore(segments.slice(0, i + 1).join('/')));
  };
  ...
  const deliver = (events: FileEvent[]) => {
    if (closed || events.length === 0) return;
    try {
      listener(events);
    } catch (error) {
      console.error(`Could not report a workspace change: ${(error as Error).message}`);
    }
  };
  ```
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-4 (the watch ignore rule and listener logging)

### C-11: `newEntryName` strips unsafe characters and trims spaces and dots, and does no length cut

- **Location:** `src/shared/entry-name.ts:1-9`
- **Evidence:**
  ```ts
  const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
  export function newEntryName(typed: string): string {
    return typed.replace(UNSAFE, '').replace(/^[\s.]+|[\s.]+$/g, '');
  }
  ```
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-4. The 200-byte cut and the re-trim are the file store's own steps, not a change to `newEntryName`.

### C-12: The file-system boundary test is the shape `src/posts/boundary.test.ts` mirrors

- **Claim:** It scans `src/**/*.{ts,tsx}` with `Bun.Glob` from the repo root, and exports its pure hit functions
  (`fsHits`, `deepImportHits`, `nonContractHits`) so a planted-lines test can prove the patterns. It has named-file
  exemptions and a test that every exemption exists. Its deep-import pattern does not flag
  `'../../file-system/file-system'`, so the file store's import passes it, and nothing under `src/posts/` touches the
  disk directly, so the FS scan passes too.
- **Location:** `src/file-system/boundary.test.ts:1-110`
- **Evidence:**
  ```ts
  const SRC = join(import.meta.dir, '..');
  const REPO = join(SRC, '..');
  ...
  async function sources(): Promise<{ path: string; lines: string[] }[]> {
    const paths = await Array.fromAsync(new Bun.Glob('src/**/*.{ts,tsx}').scan({ cwd: REPO }));
    return Promise.all(paths.sort().map(async (path) => ({ path, lines: (await Bun.file(join(REPO, path)).text()).split('\n') })));
  }
  ...
  // path:line for each import of a package module other than the entry.
  export function deepImportHits(files: { path: string; lines: string[] }[]): string[] {
    return files.flatMap(({ path, lines }) =>
      lines.flatMap((line, i) => (/['"][^'"]*file-system\/(?!file-system['"])[^'"]+['"]/.test(line) ? [`${path}:${i + 1}`] : [])),
    );
  }
  ```
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-6, S-10

### C-13: Bun-side tests use a real temp folder and `createLocalFileSystem`; there is no fake `FileSystem`

- **Claim:** Tests create a `mkdtemp` folder in `beforeEach` and remove it in `afterEach`. Case-folding is probed at run
  time by a local `foldsCase` helper rather than assumed.
- **Location:** `src/file-system/local/local-file-system/local-file-system.test.ts:10-20, 185-190`
- **Evidence:**
  ```ts
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), '3pitor-local-fs-'));
  });
  ...
  // True on a disk that folds letter case (the macOS default), where "A.md" finds "a.md".
  async function foldsCase(folder: string) {
    await writeFile(join(folder, 'case-probe'), '');
    const folds = await stat(join(folder, 'CASE-PROBE')).then(() => true, () => false);
    await rm(join(folder, 'case-probe'));
    return folds;
  }
  ```
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-5 (the file store's `PostStoreFixture`), S-9

### C-14: The engine's Bun-free scan owns `BUN_ONLY` and `bunHits`, with paths relative to `src/engine/`

- **Claim:** `BUN_ONLY` is a module-level constant and `bunHits` is exported from the test file itself. Nothing else in
  `src/` imports either. The scan globs `**/*.ts` from `import.meta.dir`, and `EXEMPT` names five test helpers
  relative to `src/engine/`.
- **Location:** `src/engine/bun-free.test.ts:8-73`
- **Evidence:**
  ```ts
  const ENGINE = import.meta.dir;

  const BUN_ONLY = [
    /\bBun\.\w/,
    /\b(from|import)\s*\(?\s*['"]bun(:[\w-]+)?['"]/,
    /\bwith\s*\{\s*type\s*:/,
    /\bimport\.meta\.(dir|file|path|main)\b/,
    /['"][^'"]*app-files\//,
  ];

  const EXEMPT = [
    'chat/components/fake-claude.ts', // a stand-in claude program, run by bun
    'chat/components/fake-claude-on-path.ts',
    'chat/components/chat-test-helpers.ts',
    'chat/components/test-model.ts',
    'chat/components/stub-tool-server.ts',
  ];
  ...
  export function bunHits(files: { path: string; lines: string[] }[]): string[] {
  ```
  A grep of `src/` for `bunHits` and `BUN_ONLY` outside this file found nothing.
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-7, S-8

### C-15: Tests already import another package's internal module

- **Claim:** A test in one package importing a non-entry module of another has precedent. So
  `src/posts/bun-free.test.ts` importing `src/engine/components/bun-only-code.ts` breaks no written rule, and no
  boundary test forbids it.
- **Location:** `src/server/view-state/view-state.routes.test.ts:6`
- **Evidence:**
  ```ts
  import { stateKey } from '../../engine/components/json-file';
  ```
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-8, D-4

### C-16: `make test-server` lists its folders by name

- **Location:** `Makefile`, target `test-server`
- **Evidence:**
  ```make
  test-server: node_modules
  	bun test src/cli src/server src/engine src/shared src/file-system src/app-files
  ```
  The `test` comment above it and `README.md:300` both repeat the list.
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-9, S-11

### C-17: The README counts seven packages and describes each in its own section

- **Location:** `README.md:18-43` (package list), `README.md:172-196` (`src/file-system/` section, the shape a
  `src/posts/` section follows), `README.md:300` (the `make test-server` line)
- **Evidence:**
  ```text
  - **Packages.** Seven packages, and imports run one way only:
  ...
  - `boundary.test.ts` holds the package's rules, run by `make test`: no module outside the package touches the disk
    directly (six named files are exempt), nothing outside it imports any module but `file-system.ts`, and the engine
    imports only the contract, never a backend.
  ```
- **Raised by:** this run
- **Confidence:** Verified
- **Bears on:** S-11

## Findings No Agent Could Audit

- **A disk that stores names in NFD (HFS+).** The design's V5 id resolution has an NFC fallback for it. The dev machine's
  temp folder is APFS, which keeps the form it is given, so the fallback branch cannot run against a real disk here.
  Closing this takes an HFS+ volume, or a test that wraps the `FileSystem` so its `list` reports NFD names.
- **A case-sensitive disk.** On one, the case-variant-id test proves nothing new, because the variant is simply a
  missing folder. The test probes the disk the way `foldsCase` does (C-13) and still checks the `not-found` either way.
- No test was run during planning. Every claim above comes from reading the code.

# Change Decision Log: Implement the Post Management API

This file records every decision made while planning the build of the `src/posts/` package. The plan is
[../change-plan.md](../change-plan.md). Each decision here gives its question, rationale, evidence, and the alternatives
it rejected. Evidence about the code as it stands is in [current-state-findings.md](current-state-findings.md), as
numbered C-N findings. The design's own decisions (D1–D26, V1–V14, with no hyphen) are in
[decision-log.md](decision-log.md) and [validation-dispositions.md](validation-dispositions.md). This log never reopens
them. Its D-N identifiers have a hyphen to keep the two series apart.

The operator's standing instruction for planning runs in this repo is "make the best decisions you can, without asking
me". Under it, this run settled every escalation and the behavior gate itself. Each decision that would otherwise have
gone to the operator says so.

## Trivial decisions

- D-3: Team size — Small: `han-core:junior-developer` plus `han-core:test-engineer`, one review round. One new package,
  no outside callers, and one developer-visible behavior change (D-22). — Referenced in plan: Review Findings.
- D-23: The engine scan's exemption for `bun-only-code.ts` — Kept, as the design says. Its comment calls the file a
  test-only helper rather than Bun code, because a scratch run showed none of its lines match `BUN_ONLY`. —
  Referenced in plan: Target State, Surface Delta (S-8).
- D-24: Output folder — `docs/changes/post-management-api/`, beside `api-design.md`, with companions in the existing
  `artifacts/` folder. The operator confirmed it ("looks good"). — Referenced in plan: Why This Change.

## Full decisions

### D-1: The plan builds the design as written, and settles only what the build needs

- **Question:** Does this run re-examine the design's contract, or only plan its build?
- **Decision:** Only the build. The design's contract, invariants, failure rows, file-store notes, and build list are
  inputs. Where the design is ambiguous or contradicts itself in a way that would make two builders write different
  code, this log pins the form (D-9 to D-20) and names the design section it clarifies. None of these changes a
  contract-level rule.
- **Rationale:** The recorded reason is "a decision already taken". The design went through a five-agent discovery
  round, a 32-question round, and an adversarial validation round. Reopening it would spend a second planning pass on
  settled ground.
- **Evidence:** `scope-boundary.md` (Stated Scope, Operator-Stated Scope "to implement
  docs/changes/post-management-api/api-design.md"); `api-design.md` "Validation Findings".
- **Behavior impact:** —
- **Rejected alternatives:**
  - Re-run architectural analysis of the design — rejected because the validation round already did, and the operator
    asked to implement it.
- **Revisit criterion:** A build-time finding that a contract-level rule (I1–I13) cannot be met.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** D-9 to D-20
- **Referenced in plan:** Why This Change

### D-2: The current state comes from the design's context brief plus this run's own reading, with no new discovery round

- **Question:** Should the run dispatch structural and behavioral analysts, as it does when no prior report exists?
- **Decision:** No. The design's context brief serves as the prior report. This run read the files the build touches
  directly and recorded them as C-5 to C-18.
- **Rationale:** The brief's 36 findings cover what posts are today, and they came from the same specialists. The
  build adds a package and edits three files, and every one of those was read directly.
- **Evidence:** `context-brief.md` "Agents"; C-5 to C-18.
- **Behavior impact:** —
- **Rejected alternatives:**
  - Dispatch `structural-analyst` and `behavioral-analyst` over `src/file-system/` and `src/engine/bun-free.test.ts` —
    rejected because the precedent files are short and were read in full.
- **Revisit criterion:** The review round names a current-state question that the C-N record does not answer.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Current State

### D-4: The file store is one module with private functions

- **Question:** Does `src/posts/file/file-post-store.ts` hold the whole file store, or does it split into helpers (walk,
  naming, queue, subscriptions)?
- **Decision:** One module. `createFilePostStore` is its only export. These private functions sit at module level:
  - `folderName`
  - `cutToBytes`
  - `isHidden`
  - `lastSegment`
  - `ignoreForWatch`
  - `titleFrom`

  These are per-instance state and functions inside the factory closure:
  - `queues` and `enqueue`
  - `tombstones`
  - `subscriptions` and `stopWatching`
  - `locatePost` (the address walk)
  - `walk` (the list walk)
  - `signal`

  The per-post queue copies the shape of the local file system's `enqueue`, generic over the resolved value. It is not
  shared with that queue.
- **Rationale:** I1 needs the list walk and the address walk to use one "what is a post" predicate. One module keeps
  that predicate in one place. Each concern has one caller, and every file-only test goes through the public store.
- **Evidence:** software-architect A1; C-9 (the queue shape, internal to `src/file-system/`); C-12 (the deep-import rule
  forbids reusing it); `local-file-system.ts` precedent (it splits off `watch.ts` only because watching is large and
  tested on its own).
- **Behavior impact:** Preserving (new code with no callers).
- **Rejected alternatives:**
  - Separate `walk.ts` and `naming.ts` — rejected under YAGNI: one caller each, and no test needs them alone. See
    `change-plan.md#deferred-yagni`.
  - Export `folderName` for unit tests — rejected: the 200-byte cases go through `create` and check the returned id.
  - Share the local file system's write queue — rejected: it covers writes only (C-9), and the deep-import rule forbids
    importing it (C-12).
- **Revisit criterion:** The module grows past about 400 lines, or a test needs to drive a walk without a store.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** D-9, D-10, D-11, D-13, D-14, D-15, D-16
- **Referenced in plan:** Target State, Surface Delta (S-3)

### D-5: File-only tests wrap the real local file system inline; no shared fake

- **Question:** How do the file-only tests count `fileSystem.watch` calls, make `watch` throw, and report NFD names,
  when no fake `FileSystem` exists?
- **Decision:** `file-post-store.test.ts` defines a local `wrap(fileSystem, overrides: Partial<FileSystem>): FileSystem`
  that returns `{ ...fileSystem, ...overrides }` over `createLocalFileSystem(root)`. It also copies the `foldsCase`
  probe from C-13 as a local function. No module under `components/` is added.
- **Rationale:** `createLocalFileSystem` returns a plain object literal, so spreading it works. Only one test file needs
  the wrapper.
- **Evidence:** software-architect A2; C-13; current-state "Gaps" (no fake FileSystem, `foldsCase` local).
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - A shared `src/posts/components/fake-file-system.ts` — rejected under YAGNI (one user).
- **Revisit criterion:** A third test file needs the wrapper.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3 (its tests)
- **Dependent decisions:** D-13
- **Referenced in plan:** Target State, Change Units (Unit 8, Unit 9)

### D-6: The contract suite's seam with each implementation

- **Question:** What exactly do `describePostStore` and an implementation's test file agree on?
- **Decision:**
  ```ts
  // src/posts/components/describe-post-store.ts
  import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
  import type { PostStore } from '../posts';
  import { PostError } from '../post-error';

  export interface PostStoreFixture {
    store: PostStore;          // a new store over empty storage, used by exactly one test
    dispose(): Promise<void>;  // frees that storage
  }
  export function describePostStore(name: string, makeStore: () => Promise<PostStoreFixture>): void;
  // registers describe(`PostStore contract: ${name}`, …) with
  //   beforeEach(async () => { fixture = await makeStore(); })
  //   afterEach(() => fixture.dispose())
  ```
  Obligations:
  - (a) The suite calls every unsubscribe that `watch` gives it before the test ends. `dispose` frees storage only.
  - (b) The suite calls `dispose` exactly once per fixture, in `afterEach`, whether the test passed or failed.
  - (c) Signal counts are read when the awaited call settles and asserted with `>=`, never as an exact total after a
    delay (D-17).

  The file side, in `src/posts/file/file-post-store.test.ts`:
  ```ts
  describePostStore('file', async () => {
    const root = await mkdtemp(join(tmpdir(), '3pitor-posts-'));
    return { store: createFilePostStore(createLocalFileSystem(root)), dispose: () => rm(root, { recursive: true, force: true }) };
  });
  ```
- **Rationale:** The suite and the database store's future test file are written at different times by different
  people. A store left watching a deleted temp folder would leak a recursive watcher, which is why (a) exists.
- **Evidence:** `api-design.md` "The contract suite"; software-architect P1; C-13 (the `mkdtemp` convention).
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Let `dispose` stop the store's watchers — rejected: the contract has no close method, and adding one is a contract
    change.
- **Revisit criterion:** The database store needs per-test setup that `makeStore` cannot express.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-17
- **Referenced in plan:** Target State, Surface Delta (S-5)

### D-7: `bun-only-code.ts` exports `bunHits` only

- **Question:** What does the test-only helper export, and what stays in each scan?
- **Decision:**
  ```ts
  // src/engine/components/bun-only-code.ts — test-only
  const BUN_ONLY = [ /* the five patterns from C-14, unchanged and in the same order */ ];
  export function bunHits(files: { path: string; lines: string[] }[]): string[];  // "path:line" for each hit
  ```
  - `BUN_ONLY` moves into the helper as a private constant.
  - Each scan keeps its own `productionFiles()`, glob root, and `EXEMPT` list.
  - The planted-lines test stays in `src/engine/bun-free.test.ts` and imports `bunHits` from
    `./components/bun-only-code`.
  - `src/posts/bun-free.test.ts` imports `bunHits` from `../engine/components/bun-only-code`.
- **Rationale:** `BUN_ONLY` has no reader except `bunHits`, so exporting it fails the evidence test. The design asks for
  one definition of Bun-only code, and this gives one.
- **Evidence:** C-14 (no other reader); C-15 (a test importing another package's internal module has precedent);
  software-architect P2.
- **Behavior impact:** Preserving. The engine scan's three tests check the same files with the same patterns.
- **Rejected alternatives:**
  - Export `BUN_ONLY` too — rejected under YAGNI.
  - Widen the engine scan to cover `src/posts/` — rejected by the design (V12): its paths are relative to `src/engine/`.
- **Revisit criterion:** A scan needs the patterns without `bunHits`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-8, S-9
- **Dependent decisions:** D-23
- **Referenced in plan:** Target State, Surface Delta (S-7)

### D-8: The `.post.json` format

- **Question:** What exactly does the file store write to `.post.json`, and what does it accept when reading?
- **Decision:**
  - **Write** (create and setTitle):
    `fileSystem.write(`${id}/.post.json`, `${JSON.stringify({ title })}\n`, { atomic: true })`. One line with a
    trailing newline. For the title `The Sun`, the file is `{"title":"The Sun"}` followed by a newline.
  - **Read:**
    ```ts
    // entry = the post folder's listing entry named '.post.json'
    if (!entry || entry.kind !== 'file') → fallback          // decided from the listing, never by read (D-12)
    text = await fileSystem.read(`${id}/.post.json`)         // FileSystemError 'not-found' | 'invalid' → fallback; anything else rethrows
    value = JSON.parse(text)                                  // a throw → fallback
    title = value is a non-null object && typeof value.title === 'string' && value.title.trim() !== '' ? value.title : fallback
    fallback = lastSegment(id).trim() !== '' ? lastSegment(id) : 'Untitled'
    ```
- **Rationale:** The file is tracked in git (design BC14, D26), and a trailing newline keeps git diffs clean. The read
  rule is the design's D10 fallback list, written as code so `get` and `list` cannot diverge.
- **Evidence:** `api-design.md` "title and its fallback (D10)"; `src/engine/components/json-file.ts` (its files are
  git-ignored and carry no newline); software-architect P3.
- **Behavior impact:** Preserving for today's app (nothing reads `.post.json`). It adds a new persisted format, which
  the database store will never read.
- **Rejected alternatives:**
  - Pretty-printed JSON — rejected: one field, and no reader benefits.
  - No trailing newline, matching `json-file.ts` — rejected: that precedent is for git-ignored files.
- **Revisit criterion:** A second field joins `.post.json`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** D-12, D-19
- **Referenced in plan:** Target State, Surface Delta (S-4)

### D-9: A missing workspace root fails `list`; the skip rule covers listings below the root only

- **Question:** The design's `list()` skips a folder whose listing fails with FileSystemError `not-found`, but it also
  says a missing root is a storage failure. The local `list('')` reports a missing root as FileSystemError `not-found`.
  Which wins?
- **Decision:**
  - The skip rule (`not-found` or `invalid` → skip) applies only to listings of folders below the root.
  - A failure of the root listing is rethrown unchanged. It is a FileSystemError, never a PostError, and so a storage
    failure under I9.
  - The address walk maps every walk failure, including a root `not-found`, to PostError `not-found`. So `get` on a
    store whose root is missing is PostError `not-found`, while `list` is a storage failure.
  - A file-only test pins both.
- **Rationale:** This keeps the design's failure row "Workspace root missing or not a folder → storage failure" true.
  For `get`, `not-found` is honest: nothing changed, and no post exists.
- **Evidence:** C-7 (`'the workspace root was not found'`); `api-design.md` file store failure rows; software-architect
  F1.
- **Behavior impact:** Preserving (new code). The design's row calls the error "a plain Error". It is a
  `FileSystemError`. That is still a storage failure, so no contract rule changes.
- **Rejected alternatives:**
  - Apply the skip rule to the root too — rejected: `list` on a missing workspace would succeed with `{ posts: [] }`
    and hide the problem.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State (the file store's walk rules)

### D-10: Tombstones mark a key as "not a post" and never stop descent; the root is never an enclosing post

- **Question:** The list walk "skips tombstoned keys". Does that stop it descending? And does address rule 3 ("no
  folder before the last may hold `draft.md`") count the root?
- **Decision:**
  - In both walks, a tombstoned key is simply not a post. Whether to descend into a folder depends only on whether it
    holds `draft.md` as a file, so a tombstone never blocks descent. Example: after this store deletes `series`,
    another writer makes `series/one/draft.md`. `list` returns `series/one`, and `get('series/one')` succeeds.
  - Address rule 3 checks only the folders strictly between the root and the id. A `draft.md` at the root (not a post,
    per BC3) hides nothing.
- **Rationale:** If skipping a tombstoned folder also stopped descent, `series/one` would be addressable but not listed,
  which breaks I1. Counting the root would let one stray root `draft.md` hide every post.
- **Evidence:** `api-design.md` "Addressability and the exact-name check", "list()"; software-architect F2 and F3.
- **Behavior impact:** Preserving (new code).
- **Rejected alternatives:**
  - Not descending into a tombstoned folder — rejected: it breaks I1.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State (the file store's walk rules)

### D-11: Where the tombstone checks run

- **Question:** When is a call's id checked against the tombstones?
- **Decision:**
  - `get`, `setBody`, `setTitle`, and `delete` check the tombstones inside their queued task, as the first step of the
    address walk, not at call time. An unawaited `delete` then `setBody` therefore always meets the tombstone.
  - `create` checks the tombstones twice: at step 3, against each candidate name (the typed form), and at step 4,
    against the listed id. On a disk that stores NFD the two forms differ.
- **Rationale:** A check at call time would run before the queued delete adds its tombstone. Another writer recreating
  the folder in between would then let the `setBody` through, which breaks I7.
- **Evidence:** `api-design.md` "Per-post queue", "create" steps 3–4; software-architect F4.
- **Behavior impact:** Preserving (new code).
- **Rejected alternatives:**
  - Check at call time — rejected for the reason above.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-12: Whether `.post.json` and `draft.md` are regular files is decided from the folder listing

- **Question:** The design's title fallback includes ".post.json is not a regular file". But the local `read` of a
  folder fails with a raw Node error (EISDIR), not a FileSystemError, so that case would surface as a storage failure.
  How does the store decide?
- **Decision:**
  - The address walk already lists the post folder. That listing, and the list walk's, are the source of truth.
  - `.post.json` is read only when its listing entry has kind `'file'`. Otherwise the title falls back.
  - A post exists only when its `draft.md` entry has kind `'file'` (walk rule 4).
  - When a folder replaces `draft.md` after the walk, `get` rejects with whatever the read throws, as a storage
    failure. The design's row "A FileSystemError other than the mapped ones, such as `<key> is a folder`" covers it,
    though the error is Node's, not a FileSystemError.
- **Rationale:** The listing is already in hand, so this costs no extra I/O. It keeps D10's "not a regular file →
  fallback" true without depending on how `read` refuses.
- **Evidence:** `local-file-system.ts` `read` (`refuseNonRegular` lets folders through); software-architect F5; C-7.
- **Behavior impact:** Preserving (new code).
- **Rejected alternatives:**
  - Map EISDIR to the fallback — rejected: it matches a Node error code from inside the posts package, which breaks the
    package's rule of building over the `FileSystem` contract.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-13: Create's id resolution, pinned at its edges

- **Question:** What does create's step 4 (resolve the id from the root listing) do at its edges?
- **Decision:**
  - (a) An exact match must have kind `'folder'`.
  - (b) With no exact match, take the folder entries whose `name.normalize('NFC')` equals
    `candidate.normalize('NFC')`. Exactly one is the id. Zero or two-plus is a storage failure:
    `new Error('Could not find the new post folder')`, after `fileSystem.delete(candidate)`.
  - (c) When the resolved id is tombstoned, delete the folder by its listed id and continue at step 3 with the next
    candidate.
  - (d) Once the id resolves, the rest of create (steps 6–7) is enqueued on that id with no `await` in between, so a
    caller who finds the id in `list` early waits (V14).
  - The NFD branch is tested through the D-5 wrapper. Its `list` reports the created folder's name in NFD.
- **Rationale:** The design leaves these edges open, and each is a place two builders would differ. The message is
  plain because it is a storage failure, not a PostError, and no fixed message applies.
- **Evidence:** `api-design.md` "create" step 4, Open Risks (NFC fallback); software-architect F6; current-state
  "Findings No Agent Could Audit" (no HFS+ disk here).
- **Behavior impact:** Preserving (new code).
- **Rejected alternatives:**
  - Pick the first NFC match when there are several — rejected: it could return a wrong id, which the design's Open
    Risks rule out.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-14: The folder-name algorithm

- **Question:** How exactly does a title become a folder name?
- **Decision:**
  ```ts
  folderName(title) = newEntryName(cutToBytes(newEntryName(title), 200)) || 'Untitled'
  // cutToBytes(s, max): walk `for (const ch of s)` (code points), adding new TextEncoder().encode(ch).length,
  // and stop before the total would pass max
  ```
  Worked examples (a scratch Bun run checked each):
  - `'x'.repeat(199) + ' z'` (201 bytes) → `'x'.repeat(199)`. The cut leaves a trailing space, and the re-trim removes
    it.
  - `'a'.repeat(199) + 'é'` (U+00E9 is 2 bytes, 201 in all) → `'a'.repeat(199)`
  - `'x'.repeat(198) + '😀'` (4 bytes) → `'x'.repeat(198)`
  - `'...'` → `''` → `Untitled`

  Suffixes (` 2`, ` 3`, …) are added after the cut.
- **Rationale:** The second `newEntryName` is the design's "trimmed of spaces and dots again". Unsafe characters are
  already gone, so it trims with the same rule as the first pass. `TextEncoder` is global on Bun and Node, so the
  module stays Bun-free.
- **Evidence:** C-11; `api-design.md` "create" step 2; software-architect P4.
- **Behavior impact:** Preserving (new code). `newEntryName` is unchanged (C-11), and its other callers see nothing.
- **Rejected alternatives:**
  - Add the cut to `newEntryName` — rejected: it changes the UI dialogs' preview of a folder name (C-11's other
    callers).
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-15: The watch ignore rule tests the last segment only

- **Question:** How is the design's rule ("any key with a hidden segment unless its last segment is `.post.json`")
  written?
- **Decision:**
  `ignoreForWatch = (key) => { const last = lastSegment(key); return last.startsWith('.') && last !== '.post.json'; }`
- **Rationale:** The `WatchOptions` contract calls `ignore` for a folder key before descending into it, so a hidden
  folder is cut off at its own key. The local watcher's per-prefix calls (C-10) give the same result. The rule does not
  depend on them, so another backend behaves the same.
- **Evidence:** C-5 (`WatchOptions`); C-10; software-architect P5.
- **Behavior impact:** Preserving (new code).
- **Rejected alternatives:**
  - Splitting the key and testing every segment — rejected: it gives the same result with more code.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-16: Every mutator signals on every exit except a PostError

- **Question:** The design says a mutator signals when the call "reaches storage". Where exactly is that line?
- **Decision:** `create`, `setBody`, `setTitle`, and `delete` each call `signal()` synchronously before their promise
  settles, on every exit except a rejection with a `PostError`:
  ```ts
  try { const result = await act(); signal(); return result; }
  catch (error) { if (!(error instanceof PostError)) signal(); throw error; }
  ```
  `get` and `list` never signal.
- **Rationale:** One rule is easier to get right than tracking whether a call "reached storage". The extra signal it can
  send, such as when a walk fails with an unmapped error before anything is written, is allowed by D20. It also covers
  the design's row "A step of create fails … Subscriptions are signalled", including a `createFolder` that fails before
  claiming a folder.
- **Evidence:** `api-design.md` "Own-write signals (D18, V14)", the file store failure rows; software-architect P6.
- **Behavior impact:** Preserving (new code).
- **Rejected alternatives:**
  - Signal only after an I/O call has started — rejected: it needs per-step bookkeeping, and the extra precision buys
    nothing D20 does not already allow.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-17: Suite signal assertions tolerate echoes

- **Question:** The file store's watcher echoes its own writes about 100 ms later. How do the suite's signal cases avoid
  flaking?
- **Decision:**
  - Each signal case reads its listener counts right after the awaited call settles and asserts `>=` the expected
    count.
  - The "after unsubscribe, nothing" case asserts the count does not grow between the unsubscribe and a later awaited
    write's settling. It does not wait for echoes.
  - The "one function subscribed twice" case asserts `>= 2` at settle.
  - The "two listeners that each unsubscribe the other" case asserts that exactly one of them was called during the
    synchronous own-write signal. That signal is delivered before the call settles (D-16), so an echo cannot land
    inside it.
  - The file-only test "a signal for an outside write" waits for at least one signal, with a timeout.
- **Rationale:** D20 allows duplicate signals, so an exact count would test something the contract does not promise.
- **Evidence:** `api-design.md` "Watcher signals (D20)"; software-architect F7.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Exact counts after a fixed sleep — rejected: flaky, and stricter than the contract.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Risks

### D-18: The posts boundary test's patterns

- **Question:** How does `src/posts/boundary.test.ts` recognize an import of the package, without flagging unrelated
  strings like `'posts/b.md'` in `local-file-system.test.ts`?
- **Decision:**
  - The test exports its pure hit functions, the way `src/file-system/boundary.test.ts` does (C-12).
  - It anchors on relative imports:
    ```ts
    const PACKAGE_IMPORT = /['"](?:\.\.\/)+posts\/([^'"]+)['"]/;  // group 1 = the module path inside src/posts/
    // rule 1 (who imports): a hit in any file outside src/posts/ whose path does not start with src/cli/, src/server/, or src/engine/
    // rule 2 (entries only): a hit whose group 1 is not 'posts' or 'post-error'
    // rule 3 (engine type-only), over engine production text:
    //   each /\b(import|export)\b[^;]*?\bfrom\s+['"](?:\.\.\/)+posts\/posts['"]/g clause must match /^import\s+type\s*\{[^}]*\}/
    //   and /\bimport\s*\(\s*['"](?:\.\.\/)+posts\/posts['"]/ never matches
    // rule 4: post-error.ts has no import or export-from line; other production modules under src/posts/ import only
    //   relative paths inside src/posts/, ../../file-system/file-system or ../file-system/file-system, and ../../shared/* or ../shared/*
    // rule 5: components/describe-post-store is imported only by *.test.ts files under src/posts/, and posts.ts has no line naming it
    ```
  - Planted lines prove each rule. No planted line may contain `file-system/` followed by anything but `file-system`,
    because `src/file-system/boundary.test.ts` deep-import-scans every file in `src/`, tests included (C-12). For rule
    4, plant `'../engine/engine'` instead.
- **Rationale:** An unanchored `posts/` pattern flags `local-file-system.test.ts:200-204`. Rule 3 only accepts the
  `import type { … }` declaration form, as D23 requires.
- **Evidence:** C-12; `api-design.md` "Boundary test"; software-architect F8.
- **Behavior impact:** Preserving for existing code: nothing outside `src/posts/` imports it today. The new rules can
  fail a future build, which D-22 records.
- **Rejected alternatives:**
  - Unanchored `posts/` matching — rejected: false hits.
  - Parse with the TypeScript compiler API — rejected: the precedent scans text, and the patterns cover every form the
    design names.
- **Revisit criterion:** A legitimate import form the patterns misread.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-6)

### D-19: `setTitle` overwrites the whole `.post.json`

- **Question:** If another writer added fields to `.post.json`, does `setTitle` keep them?
- **Decision:** No. `setTitle` writes `{ title }` only (D-8), and any other field is dropped.
- **Rationale:** The design gives `.post.json` one field and no merge rule. Reading before writing would add I/O and a
  check-then-act window for a field nothing defines.
- **Evidence:** `api-design.md` "setTitle"; software-architect F10.
- **Behavior impact:** Preserving (new code; nothing writes `.post.json` today).
- **Rejected alternatives:**
  - Read, merge, then write — rejected under YAGNI.
- **Revisit criterion:** `.post.json` gains a second field.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta (S-4)

### D-20: Delete tombstones the id on every outcome once the address walk has passed

- **Question:** The design tombstones on success and on a storage failure. What about a delete whose act maps to
  PostError `not-found`, because the folder vanished after the walk?
- **Decision:** Tombstone on every outcome once the address walk has passed: success, storage failure, or mapped
  `not-found`. A delete that fails the walk adds no tombstone.
- **Rationale:** Without it, another writer could recreate a folder at that key and it would become addressable,
  breaking the V1 reasoning. The cost is one set entry.
- **Evidence:** `api-design.md` "delete", "Tombstones (V1)"; software-architect F11.
- **Behavior impact:** Preserving (new code).
- **Rejected alternatives:**
  - Tombstone only on success and storage failure, as literally written — rejected for the reason above.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-21: Build order: ten units, and the store grows behind stubs

- **Question:** How is the build split so each unit leaves `make test` green?
- **Decision:** Ten units, in the order in `change-plan.md#change-units`.
  - The Bun-only helper extraction goes first.
  - The entries, the boundary test, and the Makefile change go together, because `bun test` exits 1 when a listed path
    holds no test files (C-18).
  - The store, the contract suite, and its first call land together, since an uncalled suite never runs.
  - Methods not built yet throw `new Error('not built yet')`. Nothing outside `src/posts/` can call them, because the
    boundary test allows no importer in this change.
  - The README goes last.
- **Rationale:** Small units suit a test-first build. Stubs keep `PostStore` satisfied under `tsc` without shipping
  half-made behavior to any caller.
- **Evidence:** C-16, C-18; software-architect "Build order"; `Makefile` `test: typecheck check-node test-server
  test-ui`.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - One unit holding the whole file store — rejected: still green, but one large step.
  - The suite alone in its own unit — rejected: it never runs, so it cannot go red then green.
- **Revisit criterion:** The `/tdd` run finds a unit that cannot go green alone.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Change Units

### D-22: `make test` runs the posts package's tests and rules (behavior gate, settled under the standing instruction)

- **Question:** After the change, `make test-server`, and so `make test`, runs `src/posts`. That includes two new
  rules that can fail a future build: only cli, server, and engine may import the package, and only through its two
  entries. A developer can observe this. Is it acceptable?
- **Decision:** Yes. The design asks for it ("`src/posts` added to the Makefile's `test-server` target"; D22, V12). The
  run settled the gate itself under the operator's standing instruction, "make the best decisions you can, without
  asking me".
- **Rationale:** These rules are what keep a database driver out of the engine and out of the browser bundle. The
  change only adds to the output of `make test`.
- **Evidence:** `scope-boundary.md` Stated Scope; C-16.
- **Behavior impact:** Changing. A developer running `make test` or `make test-server` sees the posts tests run. A
  future change that imports `src/posts/` from `ui`, `shared`, `file-system`, or `app-files`, or that value-imports
  `posts/posts` from engine production code, now fails `make test`. Decided under the standing instruction; no
  operator answer was requested.
- **Rejected alternatives:**
  - A separate `make test-posts` target outside `make test` — rejected: the design requires the rules to run in
    `make test` (D22).
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes, Surface Delta (S-10)

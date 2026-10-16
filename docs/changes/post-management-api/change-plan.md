# Change Plan: Implement the Post Management API

## Why This Change

The design for a `posts` package is settled, and this plan builds it. The reason is **a decision already taken**:
[api-design.md](./api-design.md) fixed the contract after a discovery round, a 32-question round, and an adversarial
validation round. The operator asked "to implement docs/changes/post-management-api/api-design.md"
([scope-boundary.md](artifacts/scope-boundary.md)). This plan follows the design as written. Where the design is
ambiguous or contradicts itself in a way two builders would resolve differently, it pins one form and never changes a
contract rule ([D-1](artifacts/change-decision-log.md#d-1-the-plan-builds-the-design-as-written-and-settles-only-what-the-build-needs)).
The plan lives beside the design ([D-24](artifacts/change-decision-log.md#trivial-decisions)).

## What Changes, In One Paragraph

After this change, the repo has an eighth package, `src/posts/`. In it, a post is a record with a stable id, a title, and
a markdown body, reached through one contract, `PostStore`. A file-backed store implements that contract over today's
workspace folders, so existing posts need no migration. A shared contract suite holds the store to the contract, and
the future database store will be held to the same suite. Two package checks run in `make test`. One limits who may
import the package and how. The other keeps the package free of Bun-only code, and it shares one definition of "Bun-only
code" with the engine's scan. Nothing in the running app calls the package yet. The editor, file tree, AI tools, and
server behave exactly as before, and wiring them to the store is the later integration change.

## Current State

- **No post entity exists.** A post is the workspace path of its draft, and a rename changes it
  ([C-1](artifacts/current-state-findings.md#c-1-today-a-post-is-a-path-and-nothing-defines-a-post-entity)). The engine
  may import only `shared/`, the file-system contract, and npm packages, and it must stay Bun-free
  ([C-2](artifacts/current-state-findings.md#c-2-the-engine-imports-only-shared-the-file-systemts-contract-and-npm-packages-and-stays-bun-free)).
  This change addresses that structural property: posts have no home of their own that both a file store and a
  database store can implement.
- **The precedent is the file-system package.** It has one contract module, a host-built instance, a boundary test with
  exported hit functions and planted lines, and named-file exemptions
  ([C-3](artifacts/current-state-findings.md#c-3-the-file-system-package-is-the-precedent-for-a-swappable-backend),
  [C-12](artifacts/current-state-findings.md#c-12-the-file-system-boundary-test-is-the-shape-srcpostsboundarytestts-mirrors)).
- **The file store builds over `FileSystem`.** The parts it uses are listed in
  [C-5](artifacts/current-state-findings.md#c-5-the-filesystem-contract-the-file-store-is-built-over). Its edges:
  - A folder whose name holds `\` is listed but cannot be addressed
    ([C-6](artifacts/current-state-findings.md#c-6-the-key-grammar-rejects--and-nul-in-a-segment-so-list-can-report-a-key-that-no-other-call-accepts)).
  - Links list as `other`, and a missing root lists as FileSystemError `not-found`
    ([C-7](artifacts/current-state-findings.md#c-7-local-list-on-a-link-is-invalid-a-missing-root-is-not-found-and-links-are-listed-as-other)).
  - `delete` is recursive, and a missing key is `not-found`
    ([C-8](artifacts/current-state-findings.md#c-8-local-delete-waits-for-writes-queued-under-the-key-then-removes-recursively-a-missing-key-is-not-found)).
  - The local queue orders writes only
    ([C-9](artifacts/current-state-findings.md#c-9-the-local-write-queue-is-per-disk-path-module-level-and-covers-writes-only)).
  - The watcher applies `ignore` to every prefix and logs listener throws
    ([C-10](artifacts/current-state-findings.md#c-10-the-local-watcher-applies-ignore-to-every-ancestor-prefix-of-a-key-and-logs-listener-throws)).
- **Shared helpers and tests.**
  - `newEntryName` does no length cut
    ([C-11](artifacts/current-state-findings.md#c-11-newentryname-strips-unsafe-characters-and-trims-spaces-and-dots-and-does-no-length-cut)).
  - Tests run over a real `mkdtemp` folder, and no fake `FileSystem` exists
    ([C-13](artifacts/current-state-findings.md#c-13-bun-side-tests-use-a-real-temp-folder-and-createlocalfilesystem-there-is-no-fake-filesystem)).
  - The engine's Bun-free scan owns `BUN_ONLY` and `bunHits`, and nothing else reads them
    ([C-14](artifacts/current-state-findings.md#c-14-the-engines-bun-free-scan-owns-bun_only-and-bunhits-with-paths-relative-to-srcengine)).
  - A test that imports another package's internal module has precedent
    ([C-15](artifacts/current-state-findings.md#c-15-tests-already-import-another-packages-internal-module)).
- **Build plumbing.**
  - `make test-server` lists its folders by name
    ([C-16](artifacts/current-state-findings.md#c-16-make-test-server-lists-its-folders-by-name)).
  - `bun test` exits 1 for a listed path with no test files
    ([C-18](artifacts/current-state-findings.md#c-18-bun-test-exits-1-when-a-listed-path-holds-no-test-files)).
  - The README counts seven packages
    ([C-17](artifacts/current-state-findings.md#c-17-the-readme-counts-seven-packages-and-describes-each-in-its-own-section)).

The current state comes from the design's [context-brief.md](./context-brief.md), plus this run's direct reading of the
files the build touches
([D-2](artifacts/change-decision-log.md#d-2-the-current-state-comes-from-the-designs-context-brief-plus-this-runs-own-reading-with-no-new-discovery-round)).

## Target State

The contract, its invariants (I1–I13), its failure table, and the file store's conformance notes are in
[api-design.md, "The Designed Contract"](./api-design.md#the-designed-contract). They are not restated here. This
section names each part's job and pins the seams and edge rules the design leaves open.

### The parts and what each answers for

```text
src/posts/
  posts.ts                      the contract types and re-exports (S-2). Imported as a type only by the engine.
  post-error.ts                 PostError and PostErrorReason; imports nothing (S-1).
  boundary.test.ts              who may import the package, and how (S-6).
  bun-free.test.ts              no Bun-only code in the package's production files (S-9).
  components/
    describe-post-store.ts      the shared contract suite; test-only (S-5).
  file/
    file-post-store.ts          createFilePostStore(fileSystem); the whole file store (S-3).
    file-post-store.test.ts     the suite for 'file', plus file-only tests.
src/engine/components/
  bun-only-code.ts              bunHits and its private BUN_ONLY patterns; test-only (S-7).
```

- **`post-error.ts`** answers for what a refusal is. It does not answer for when one is raised.
- **`posts.ts`** answers for the shape every store presents. It holds no behavior except re-exports.
- **`file/file-post-store.ts`** answers for everything the file store does, in one module
  ([D-4](artifacts/change-decision-log.md#d-4-the-file-store-is-one-module-with-private-functions)):
  - the one "what is a post" predicate, shared by the list walk and the address walk
  - the folder naming
  - the per-instance per-post queue and tombstones
  - the one underlying watch

  Its only export is `createFilePostStore`. It does not answer for a database store or for anything outside the
  contract.
- **`components/describe-post-store.ts`** answers for proving the contract through the contract alone. It never reaches
  storage.
- **`src/engine/components/bun-only-code.ts`** answers for what "Bun-only code" means. Each scan keeps its own file list
  and exemptions.

### Seams two parts must agree on

**Suite ↔ each implementation's test**
([D-6](artifacts/change-decision-log.md#d-6-the-contract-suites-seam-with-each-implementation)):

```ts
export interface PostStoreFixture { store: PostStore; dispose(): Promise<void> }
export function describePostStore(name: string, makeStore: () => Promise<PostStoreFixture>): void;
// describe(`PostStore contract: ${name}`): beforeEach makes a fixture; afterEach awaits fixture.dispose(), once.
// The suite itself calls every unsubscribe watch gave it before each test ends.

// file side, in file-post-store.test.ts:
describePostStore('file', async () => {
  const root = await mkdtemp(join(tmpdir(), '3pitor-posts-'));
  return { store: createFilePostStore(createLocalFileSystem(root)), dispose: () => rm(root, { recursive: true, force: true }) };
});
```

Signal cases read counts when the awaited call settles and assert `>=`, because the file store's watcher echoes its own
writes later ([D-17](artifacts/change-decision-log.md#d-17-suite-signal-assertions-tolerate-echoes)).

**Engine scan ↔ posts scan**
([D-7](artifacts/change-decision-log.md#d-7-bun-only-codets-exports-bunhits-only)):

```ts
// src/engine/components/bun-only-code.ts — test-only
const BUN_ONLY = [ /* the five patterns in C-14, unchanged, same order */ ];
export function bunHits(files: { path: string; lines: string[] }[]): string[];  // "path:line" per hit
```

**`.post.json`, between create/setTitle and get/list**
([D-8](artifacts/change-decision-log.md#d-8-the-postjson-format)):

- Written as `{"title":"The Sun"}` followed by a newline, through `fileSystem.write(…, { atomic: true })`. `setTitle`
  overwrites the whole file
  ([D-19](artifacts/change-decision-log.md#d-19-settitle-overwrites-the-whole-postjson)).
- Read only when the folder listing shows it as a `'file'`. A missing or bad file, or a blank title, falls back to the
  folder's last segment, then to `Untitled`.

**The file store's watch filter**
([D-15](artifacts/change-decision-log.md#d-15-the-watch-ignore-rule-tests-the-last-segment-only)):
`ignoreForWatch(key)` is true when the last segment starts with `.` and is not `.post.json`.

**The posts boundary test's import patterns**
([D-18](artifacts/change-decision-log.md#d-18-the-posts-boundary-tests-patterns)):

- Imports of the package are recognized by `/['"](?:\.\.\/)+posts\/([^'"]+)['"]/`, so `'posts/b.md'` in
  `local-file-system.test.ts` is not a hit.
- Engine production code passes rule 3 only with `import type { … } from '…/posts/posts'`.
- No planted line names a non-entry `file-system/` module, because the file-system boundary test scans every file in
  `src/`.

### Edge rules the file store pins

The design's conformance notes stand. These settle the points it leaves open or states two ways:

- **Missing root.**
  - `list` rethrows the root listing's failure as a storage failure. The skip rule (`not-found` or `invalid`) applies
    only to folders below the root.
  - `get` on a missing root is PostError `not-found`.
  - ([D-9](artifacts/change-decision-log.md#d-9-a-missing-workspace-root-fails-list-the-skip-rule-covers-listings-below-the-root-only))
- **Tombstones never stop descent.** A tombstoned key is only "not a post". Descent depends on `draft.md` alone.
  Address rule 3 checks only the folders strictly between the root and the id
  ([D-10](artifacts/change-decision-log.md#d-10-tombstones-mark-a-key-as-not-a-post-and-never-stop-descent-the-root-is-never-an-enclosing-post)).
- **Tombstone checks run inside the queued task.** `create` checks both the candidate name and the listed id
  ([D-11](artifacts/change-decision-log.md#d-11-where-the-tombstone-checks-run)).
- **"Is a regular file" comes from the listing**, for both `draft.md` and `.post.json`
  ([D-12](artifacts/change-decision-log.md#d-12-whether-postjson-and-draftmd-are-regular-files-is-decided-from-the-folder-listing)).
- **Create's id resolution** ([D-13](artifacts/change-decision-log.md#d-13-creates-id-resolution-pinned-at-its-edges)):
  - An exact match must be a `'folder'`.
  - Otherwise, exactly one NFC-equal folder is the id. Zero or several is a storage failure, after deleting the
    candidate.
  - A tombstoned result is deleted, and the next candidate is tried.
  - The remaining steps are enqueued on the id with no `await` in between.
- **Folder name** ([D-14](artifacts/change-decision-log.md#d-14-the-folder-name-algorithm)):
  - `newEntryName(cutToBytes(newEntryName(title), 200)) || 'Untitled'`, cutting at a code-point boundary.
  - `'x'.repeat(199) + ' z'` becomes `'x'.repeat(199)`.
- **Signals** ([D-16](artifacts/change-decision-log.md#d-16-every-mutator-signals-on-every-exit-except-a-posterror)):
  - Every mutator calls `signal()` before settling, on every exit except a PostError rejection.
  - `get` and `list` never signal.
- **Delete tombstones on every outcome once the address walk passes**
  ([D-20](artifacts/change-decision-log.md#d-20-delete-tombstones-the-id-on-every-outcome-once-the-address-walk-has-passed)).

### What is not in the target

There is no `system-architect` input: nothing here crosses a service boundary, and integration is out of scope. The
software architect deferred nothing to it.

## Surface Delta

### S-1: `src/posts/post-error.ts` (`PostError`, `PostErrorReason`) — Added

**Target state.** `src/posts/post-error.ts` exists and imports nothing.

- It exports `type PostErrorReason = 'not-found' | 'invalid'` and `class PostError extends Error`, with
  `readonly reason: PostErrorReason`.
- The message is fixed by the reason: `not-found` is "That post no longer exists.", and `invalid` is "A post needs a
  title."
- Code outside the package recognizes a refusal with `instanceof PostError`.

**Behavior.** Preserving. New module, with no importer outside `src/posts/` in this change.

**Why.** The design's error entry (V2). `FileSystemError` shares the same reason names
([C-4](artifacts/current-state-findings.md#c-4-filesystemerror-reasons-overlap-the-new-posterror-reasons)).

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-plan-builds-the-design-as-written-and-settles-only-what-the-build-needs)

### S-2: `src/posts/posts.ts` (the `PostStore` contract) — Added

**Target state.** `src/posts/posts.ts` is the package's main entry.

- It exports the types `PostId`, `PostSummary`, `Post`, `PostList`, and `PostStore`, exactly as
  [api-design.md](./api-design.md#surface) shows them, with their comments.
- It re-exports `PostError` and `type PostErrorReason` from `./post-error`, and `createFilePostStore` from
  `./file/file-post-store`.
- It does not export the contract suite.

**Behavior.** Preserving. New module, with no importer outside `src/posts/`.

**Why.** The design's entry module (G1, G5, D23). See
[C-2](artifacts/current-state-findings.md#c-2-the-engine-imports-only-shared-the-file-systemts-contract-and-npm-packages-and-stays-bun-free).

**Depends on.** S-1. The `createFilePostStore` re-export depends on S-3 and joins in Unit 3.

**Decision.** [D-21](artifacts/change-decision-log.md#d-21-build-order-ten-units-and-the-store-grows-behind-stubs)

### S-3: `src/posts/file/file-post-store.ts` (`createFilePostStore`) — Added

**Target state.** `createFilePostStore(fileSystem: FileSystem): PostStore` exists, is synchronous, and does no I/O when
called.

- It meets every invariant and every contract failure row.
- It follows the design's File Store Conformance Notes, plus the edge rules under
  [Target State](#edge-rules-the-file-store-pins).
- It imports only `../../file-system/file-system`, `../../shared/entry-name`, and the package's own entries.
- It is one module with private functions, and its only export is `createFilePostStore`.

**Behavior.** Preserving. New code that nothing outside `src/posts/` calls.

**Why.** G4, the first implementation. See
[C-5](artifacts/current-state-findings.md#c-5-the-filesystem-contract-the-file-store-is-built-over).

**Depends on.** S-1, S-2, S-4.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-file-store-is-one-module-with-private-functions), plus
D-9 to D-16 and D-20 for its edges.

### S-4: `<post folder>/.post.json` (persisted title) — Added

**Target state.** A post the file store creates or retitles holds `.post.json`, written as `{"title":"<title>"}` plus a
newline, atomically.

- `setTitle` overwrites the whole file.
- A post folder without a valid `.post.json` takes its folder's last segment as its title, or `Untitled`.
- Nothing outside `src/posts/` reads or writes the file.

**Behavior.** Preserving for today's app. Nothing reads `.post.json`, and nothing calls the store yet, so no workspace
gets one until integration.

**Why.** The design's title sidecar (D10, D26).

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-postjson-format),
[D-19](artifacts/change-decision-log.md#d-19-settitle-overwrites-the-whole-postjson)

### S-5: `src/posts/components/describe-post-store.ts` (`describePostStore`, `PostStoreFixture`) — Added

**Target state.** The shared contract suite exists. It has the signature and obligations pinned under
[Target State](#seams-two-parts-must-agree-on) and covers every case the design lists under "The contract suite".

- It imports `bun:test`, the package's two entries, and nothing else.
- Only `*.test.ts` files under `src/posts/` import it.
- `file/file-post-store.test.ts` calls it once, as `'file'`.

**Behavior.** Preserving (test code).

**Why.** D4 and G5: the database store must pass the same rules.

**Depends on.** S-2.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-the-contract-suites-seam-with-each-implementation),
[D-17](artifacts/change-decision-log.md#d-17-suite-signal-assertions-tolerate-echoes)

### S-6: `src/posts/boundary.test.ts` — Added

**Target state.** A source-scanning test enforces the design's six boundary rules (I13, V12) with the patterns in D-18.
It exports its pure hit functions, proves each rule with planted lines, and fails when an exemption names a missing
file.

**Behavior.** Preserving. Every rule holds for today's code, because nothing outside `src/posts/` imports it.

**Why.** D22, V2, V12. See
[C-12](artifacts/current-state-findings.md#c-12-the-file-system-boundary-test-is-the-shape-srcpostsboundarytestts-mirrors).

**Depends on.** S-1, S-2.

**Decision.** [D-18](artifacts/change-decision-log.md#d-18-the-posts-boundary-tests-patterns)

### S-7: `BUN_ONLY` and `bunHits` — Moved, to `src/engine/components/bun-only-code.ts`

**Target state.** `src/engine/components/bun-only-code.ts` is a test-only module.

- It holds `BUN_ONLY` (private; the same five patterns in the same order) and exports
  `bunHits(files: { path: string; lines: string[] }[]): string[]`, which behaves as before.
- `src/engine/bun-free.test.ts` no longer defines or exports either one.

**Behavior.** Preserving. The engine scan checks the same files against the same patterns, and its planted-lines test
passes unchanged.

**Why.** The design wants one definition of Bun-only code for both scans (V12). See
[C-14](artifacts/current-state-findings.md#c-14-the-engines-bun-free-scan-owns-bun_only-and-bunhits-with-paths-relative-to-srcengine).

**Migration.** Import `bunHits` from `./components/bun-only-code` (engine) or `../engine/components/bun-only-code`
(posts).

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-bun-only-codets-exports-bunhits-only)

### S-8: `src/engine/bun-free.test.ts` — Re-scoped

**Target state.** The engine scan picks the engine's production files and checks them with the imported `bunHits`. Its
`EXEMPT` list names `components/bun-only-code.ts`, commented as a test-only helper, beside the five existing helpers.
It no longer owns the pattern list.

**Behavior.** Preserving. It runs the same three tests over the same files.

**Why.** It follows from S-7.

**Depends on.** S-7.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-bun-only-codets-exports-bunhits-only),
[D-23](artifacts/change-decision-log.md#trivial-decisions)

### S-9: `src/posts/bun-free.test.ts` — Added

**Target state.** A scan of `src/posts/` production files (not `*.test.ts`) fails on any `bunHits` hit. Its paths are
relative to `src/posts/`.

- Its one named exemption is `components/describe-post-store.ts`.
- It checks that the exemption exists, and that the scanned set includes `posts.ts`.
- It imports `bunHits` from `../engine/components/bun-only-code`.

**Behavior.** Preserving (new test).

**Why.** D23, V12. See
[C-15](artifacts/current-state-findings.md#c-15-tests-already-import-another-packages-internal-module).

**Depends on.** S-5, S-7.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-bun-only-codets-exports-bunhits-only)

### S-10: `Makefile` `test-server` — Re-scoped

**Target state.** `test-server` runs
`bun test src/cli src/server src/engine src/shared src/file-system src/posts src/app-files`. The comment above `test`
names `posts` among the Bun-side tests.

**Behavior.** Changing. `make test` and `make test-server` now run the posts tests, and a future import that breaks the
package's rules fails the build. Settled under the operator's standing instruction; see
[Behavior Changes](#behavior-changes).

**Why.** The design's build list. See
[C-16](artifacts/current-state-findings.md#c-16-make-test-server-lists-its-folders-by-name) and
[C-18](artifacts/current-state-findings.md#c-18-bun-test-exits-1-when-a-listed-path-holds-no-test-files).

**Depends on.** S-6 (a test file must exist under `src/posts/`).

**Decision.** [D-22](artifacts/change-decision-log.md#d-22-make-test-runs-the-posts-packages-tests-and-rules-behavior-gate-settled-under-the-standing-instruction)

### S-11: `README.md` — Re-scoped

**Target state.** The README describes eight packages.

- A `src/posts/` section follows the file-system section's shape. It covers:
  - what the package holds
  - its two entries
  - its importers (cli, server, engine)
  - the contract suite
  - the boundary and Bun-free tests
- The engine bullet says the engine imports `posts/posts.ts` with `import type` only, and may import
  `posts/post-error.ts` as a value.
- The `make test-server` line lists `src/posts`.
- The engine's `bun-free.test.ts` bullet mentions the shared helper.

**Behavior.** Preserving (documentation).

**Why.** D21. See
[C-17](artifacts/current-state-findings.md#c-17-the-readme-counts-seven-packages-and-describes-each-in-its-own-section).

**Depends on.** S-1 to S-10.

**Decision.** [D-21](artifacts/change-decision-log.md#d-21-build-order-ten-units-and-the-store-grows-behind-stubs)

## Behavior Changes

One entry changes something a person can observe, and it is visible only to developers:

- **S-10: `make test` runs the posts package's tests and rules.**
  - What a developer sees: `make test` and `make test-server` run more tests.
  - What can fail: a later change fails the build if it imports `src/posts/` from the browser code, `shared`,
    `file-system`, or `app-files`, or if engine code imports the contract as a value.
  - Decision: the design asks for this, so the run accepted it under the standing instruction, "make the best decisions
    you can, without asking me"
    ([D-22](artifacts/change-decision-log.md#d-22-make-test-runs-the-posts-packages-tests-and-rules-behavior-gate-settled-under-the-standing-instruction)).

App users see no change. Nothing in the editor, tree, chat, or server calls the new package.

## Change Units

Every unit ends with `make test` green: the type-check over all of `src/`, the Node check, and the Bun and UI tests.
Methods a unit has not built yet throw `new Error('not built yet')`. Nothing can call them, because the boundary test
admits no importer in this change
([D-21](artifacts/change-decision-log.md#d-21-build-order-ten-units-and-the-store-grows-behind-stubs)).

### Unit 1: Share the Bun-only patterns

**What it does.** Moves `BUN_ONLY` and `bunHits` out of the engine's scan into a test-only helper. The scan imports the
helper and names it in its exemptions.

**Delta entries.** S-7, S-8.

**How you know it worked.** The engine scan's three existing tests pass unchanged. A grep shows `BUN_ONLY` defined only
in `bun-only-code.ts`.

### Unit 2: The package's entries and boundary

**What it does.**
- Adds `post-error.ts`, with its own test of the fixed messages and `instanceof`.
- Adds `posts.ts`, with the contract types and the `PostError` re-export. The `createFilePostStore` re-export comes in
  Unit 3.
- Adds `boundary.test.ts`, with every rule and its planted lines.
- Adds `src/posts` to `test-server`.

**Delta entries.** S-1, S-2 (without the store re-export), S-6, S-10.

**Ordering constraint.** The Makefile change must land with a test file under `src/posts/`, because `bun test` exits 1
for a path with no test files
([C-18](artifacts/current-state-findings.md#c-18-bun-test-exits-1-when-a-listed-path-holds-no-test-files)). Rule 5
(suite importers) passes with nothing to check until Unit 3.

**How you know it worked.** `make test-server` runs `src/posts`. The planted lines fail each rule. No real file trips
one.

### Unit 3: A file store that lists, gets, and creates

**What it does.**
- Adds `file/file-post-store.ts`:
  - `list`, `get`, and `create` on the happy path: posts at the root, the `.post.json` write and read, and `draft.md`
    written last.
  - The other methods are stubs.
- Adds `components/describe-post-store.ts`, with the seam in D-6 and the cases those three methods satisfy: empty list,
  create then get and list, exact title round-trip, two creates with one title, body round-trips, blank titles
  `invalid` from create, unknown and `""` ids `not-found` from `get`, and the ASCII create-id-in-list case.
- Adds `file/file-post-store.test.ts`, which calls the suite for `'file'`.
- Adds the `createFilePostStore` re-export to `posts.ts`.

**Delta entries.** S-2 (completed), S-3 (partial), S-4, S-5 (partial).

**Ordering constraint.** After Unit 2. The suite and the store land together: a suite nobody calls never runs, so it
cannot go red then green.

**How you know it worked.** `PostStore contract: file` runs and passes. The boundary test's rule 5 now sees a real
importer.

### Unit 4: The package's Bun-free scan

**What it does.** Adds `src/posts/bun-free.test.ts`.

**Delta entries.** S-9.

**Ordering constraint.** After Unit 1 (the helper) and Unit 3 (its exemption must name a file that exists).

**How you know it worked.** The scan passes, lists `posts.ts` among the scanned files, and confirms its exemption exists.

### Unit 5: What counts as a post

**What it does.**
- Builds the full list walk and the address walk with the one predicate.
- Covers hidden names, `other` entries and links, folders nested in a post, a root `draft.md`, names holding `\`, and
  the case-variant id (probed with a local `foldsCase`).
- Adds fallback titles, and the missing-root rule (D-9, D-10, D-12).
- Adds the suite's "variant and never-given ids are `not-found` from get".

**Delta entries.** S-3, S-5.

**Ordering constraint.** After Unit 3.

**How you know it worked.** The design's file-only tests for fallback titles, nested and hidden folders, the case
variant, links, and the `\` name pass, along with a file-only test for the missing root.

### Unit 6: Changing a post, in order

**What it does.** Builds `setBody`, `setTitle`, and the per-instance per-post queue, with the suite's cases:

- `setBody` leaves the title, and `setTitle` leaves the body.
- Blank titles are `invalid` from `setTitle`.
- `not-found` from both setters.
- The unawaited ordering cases.

**Delta entries.** S-3, S-5.

**Ordering constraint.** After Unit 5. The setters use the address walk.

**How you know it worked.** The suite's ordering cases pass. The suite's "no upsert" cases pass: a missing id creates
no folder.

### Unit 7: Deleting for good

**What it does.**
- Builds `delete` and the tombstones (D-11, D-20).
- Makes `create` skip tombstoned candidate names.
- Adds the suite's V1 case and the delete-ordering cases.
- Adds the file-only test that a folder another writer makes at a tombstoned key is neither listed nor addressable,
  while a post nested under it is (D-10).

**Delta entries.** S-3, S-5.

**Ordering constraint.** After Unit 6. "Delete then setBody" needs the queue.

**How you know it worked.** The suite's delete cases and the tombstone file-only tests pass.

### Unit 8: Create's naming and recovery

**What it does.**
- Adds the ` 2`, ` 3`, … retries and the 200-byte cut with `Untitled` (D-14).
- Adds the id resolution through the root listing: exact first, then NFC, tested with the D-5 wrapper reporting NFD
  names (D-13).
- Adds the cleanup rule (D15), and the suite's NFD create-id-in-list case.

**Delta entries.** S-3, S-5.

**Ordering constraint.** After Unit 7. Step 4 of create skips tombstoned ids.

**How you know it worked.** The design's file-only tests for ` 2` naming, the 200-byte cut, and cleanup pass, plus the
D-14 worked examples and the NFD wrapper case.

### Unit 9: Change signals

**What it does.**
- Builds `watch`: the subscription set, one underlying `fileSystem.watch` started by the first subscriber and stopped
  by the last, and the ignore rule (D-15).
- Adds `signal()` to every mutator under D-16.
- Adds the suite's signal cases under D-17.
- Adds file-only tests, using the D-5 wrapper:
  - one underlying watch, however many subscriptions
  - none left after the last unsubscribe
  - a throwing `fileSystem.watch` leaves no subscription
  - a signal for an outside write

**Delta entries.** S-3, S-5.

**Ordering constraint.** After Unit 8. No stub remains after this unit.

**How you know it worked.** Every case the design lists under "The contract suite" and "What the Build Delivers" passes,
and no method throws `not built yet`.

### Unit 10: README

**What it does.** Updates the README as S-11 describes.

**Delta entries.** S-11.

**Ordering constraint.** Last. The README is the most-changed file in the repo, at 45 commits in 90 days, so it is
rebased once, at the end.

**How you know it worked.** The README names eight packages, and its `src/posts/` section matches the files on disk.

## Risks

- **Flaky signal tests.** The file watcher echoes writes about 100 ms later, and coalesces. Asserting `>=` at settle
  (D-17) avoids most of it. The outside-write test waits with a timeout. Detect it by running `bun test src/posts`
  several times before closing Unit 9.
- **The case-variant and NFD tests depend on the disk.** The case test probes the disk and checks `not-found` either
  way. The NFD branch can only run through the wrapper, because the dev disk keeps the form it is given (current-state
  "Findings No Agent Could Audit").
- **The boundary test's patterns may misread real code.** It is text-based, like its precedent. A legitimate import form
  the patterns misread fails the build loudly, not silently. The planted lines in D-18 are the early check.
- **Stubs left behind.** A stub that survives Unit 9 would ship a method that always fails. Unit 9's check is that no
  `not built yet` remains.
- **Blast radius.** Units 2–9 touch only `src/posts/`. Unit 1 touches the engine's test scan. Unit 10 touches the
  README. No unit changes production code outside `src/posts/`.

## Deferred (YAGNI)

### A `walk.ts` / `naming.ts` split of the file store
**Why deferred:** It fails the evidence test. Each concern has one caller, and no test needs one alone (D-4).
**Reopen when:** `file-post-store.ts` grows past about 400 lines, or a test needs to drive a walk without a store.
**Source:** software-architect A1.

### A shared fake `FileSystem` under `src/posts/components/`
**Why deferred:** It fails the evidence test, because one test file uses it (D-5).
**Reopen when:** A third test file needs the wrapper.
**Source:** software-architect A2.

### Exporting `BUN_ONLY` from `bun-only-code.ts`
**Why deferred:** It fails the evidence test. `bunHits` is its only reader (D-7).
**Reopen when:** A scan needs the patterns without `bunHits`.
**Source:** software-architect P2.

### Exporting `folderName` for unit tests
**Why deferred:** It fails the simpler-version test. The cases go through `create` (D-4).
**Reopen when:** A naming case cannot be reached through `create`.
**Source:** software-architect A1.

## Cut for Scope

The scope record's Stated Exclusions settle each of these. You can reinstate any of them, and your saying so is enough
justification.

- **Connecting the app to the store.** The cli would build the file store and hand it to the engine, and the engine
  would listen to the store's change signals instead of the file system's. Without it, the running app never uses the
  new package. Cut by "cli builds the file store and passes `posts` to `startEngine`" and "`startEngine` swaps
  `fileSystem.watch` for `posts.watch`".
- **Moving the editor, tree, routes, AI tools, saved view state, and chat history onto post ids.** Without it, every one
  of them still names a post by its draft path, and the identity change (design BC1) has not reached anyone. Cut by
  "`Engine['documents']`, the routes, wire types …, the chat tools …, view state and session references …, the system
  prompt …, the skills, the UI tree, and `fake-documents-api.ts` … move onto ids".
- **Deciding whether new posts get a heading in their body.** Without it, a post the store creates has an empty body
  apart from what the caller passes. Cut by "Whether the UI seeds an H1 on new posts (D9)".
- **The database store and any migration.** Without it, the only store is the file store. Cut by "Migrating to a
  database, and remapping stored references (D5)" and "A database store will be a second feature folder beside
  `file/`. It is not part of this change".

## Open Items

None that block the build. The builder inherits the design's own Open Risks
([api-design.md, "Open Risks"](./api-design.md#open-risks)) unchanged. Two of them become checks here: the NFC fallback
(D-13) and the per-instance tombstones (D-11, D-20).

## Review Findings

To be filled after the review round.

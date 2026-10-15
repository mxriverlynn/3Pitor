# Chosen Option (A), amended with the question round and D2–D26

This is the working copy of the chosen design. It folds in every answer in [question-round.md](./question-round.md)
and every decision in [decision-log.md](./decision-log.md). The goal clauses (G1–G8) and findings (F1–F36) are defined
in [../design-options.md](../design-options.md) and [../context-brief.md](../context-brief.md).

## 1. The contract

**Package layout** (README package → feature → component; the file-system package is the precedent, F36)

```text
src/posts/
  posts.ts                        entry: contract types and re-exports. The only module anything outside src/posts/
                                  imports. The engine imports it with `import type` only (D23).
  boundary.test.ts                D22: the package's import rules, run by `make test`
  components/                     shared by the entry and the package's implementations
    post-error.ts                 PostError, PostErrorReason (a value, so it sits outside the entry: no import cycle)
    describe-post-store.ts        D4: the shared contract suite. Test-only; imported only by *.test.ts files
  file/                           feature: the file store (G4). One component, so its files sit in the feature folder.
    file-post-store.ts            createFilePostStore(fileSystem); per-post queue; addressability walk; signals
    file-post-store.test.ts       describePostStore('file', …) plus the file-only tests
```

A database store will be a second feature folder beside `file/`. It is not part of this change (G5, D3).

**Entry module: `src/posts/posts.ts`**

```ts
// The posts package: every post is created, read, changed, listed, and deleted through one contract, so the store
// behind it can be swapped (G1, G5). A host builds a store; at integration it hands it to the engine (G7, D2).
// This is the only module anything outside src/posts/ imports, and the engine imports it with `import type` only, so
// no implementation ever loads into the engine (D23). The package imports only src/file-system/file-system.ts and
// src/shared/.

// A post's identity, assigned by the store when the post is made.
// - Exact (D7, D8): a string names a post only when list() would return exactly that string, code unit for code unit.
//   A variant in letter case, Unicode form, or spacing names no post. "" never names a post.
// - Stable (D5): no call on this contract changes it, whatever happens to the title. It is stable within one store;
//   moving posts to another store is not part of the contract.
// - One live post per id. After a delete, a store may give the same id to a later post.
// - Opaque (D6): callers store it and pass it back. They never build, parse, order, or show it. Some stores' ids look
//   like paths or names (the file store's do); they are still opaque.
// Any string that names no post is 'not-found'. There is no "malformed id".
export type PostId = string;

// What list() gives for each post: enough to show and pick it, without its body.
export interface PostSummary {
  id: PostId;
  // Never blank. The title exactly as last given to create or setTitle. For a post this store never titled, a title
  // the store derives (the file store's fallback, D10).
  title: string;
}

export interface Post extends PostSummary {
  // The post's markdown, exactly as last given (D13). The store checks nothing about it and never reads or writes a
  // heading in it: the title is separate metadata, and any H1 belongs to the caller (D9).
  // A body must be a well-formed string (no lone surrogate); any such string round-trips, including "", NUL, CRLF,
  // and large bodies.
  body: string;
}

// Per-post order (D16, D17). Calls that name one id through one store (get, setBody, setTitle, delete) take effect in
// the order they were made, whether or not the caller awaits between them. So setBody then delete leaves no post, and
// a get made after a setBody sees that body. list() is not ordered against them. Calls through different store
// instances, or from other processes, have no promised order (OQ5).
//
// Failures. A rejection with a PostError changed nothing. Any other rejection, of any type, is a storage failure: the
// call may or may not have taken effect, and get and list say which.
export interface PostStore {
  // Every post that exists for the whole of the call, each once, in no promised order. Callers sort. A post made or
  // deleted while the call runs may or may not appear (D11). Never rejects with a PostError.
  list(): Promise<PostSummary[]>;

  // One post, body included. An id that names no post is 'not-found'.
  get(id: PostId): Promise<Post>;

  // Makes a new post and resolves to its id. Titles need not be unique. Once this resolves, get and list include the
  // post. A blank title (no non-whitespace character) is 'invalid', and nothing is made.
  create(post: { title: string; body: string }): Promise<PostId>;

  // Replace one field and leave the other alone. Neither ever creates a post: an id that names no post is
  // 'not-found'. A blank title is 'invalid'. Once the call resolves, get returns the new value.
  setBody(id: PostId, body: string): Promise<void>;
  setTitle(id: PostId, title: string): Promise<void>;

  // Removes the post, and everything the store keeps for it, for good. An id that names no post is 'not-found'.
  // Through this store, once a delete takes effect, every later call on that id is 'not-found', and no later call
  // brings the post back (D16).
  delete(id: PostId): Promise<void>;

  // Subscribes listener to change signals and returns its unsubscribe (D19).
  // - Each call is its own subscription. Nothing is watched until the first call.
  // - The caller must call the unsubscribe when it stops listening; it is safe to call twice. Once it returns, the
  //   listener is never called again.
  // - A signal carries no detail: re-list, and re-get the posts you hold.
  // - Own writes (D18): every create, setBody, setTitle, or delete through this store that reaches storage signals
  //   every subscription of this store before its promise settles. That includes a call that rejects with a storage
  //   failure, since the change may have landed. A call that rejects with a PostError changed nothing.
  // - Other writers, including another store instance: signalled when, and if, the implementation can see the change.
  // - One signal may stand for many changes, one change may be signalled more than once, and a signal may arrive when
  //   nothing visible changed (D20).
  // - A throw from the listener is caught and logged as `Could not report a post change: <message>`. It never rejects
  //   the call that caused the signal, and later signals still arrive.
  watch(listener: () => void): () => void;
}

export { PostError, type PostErrorReason } from './components/post-error';
export { createFilePostStore } from './file/file-post-store';
```

**Error: `src/posts/components/post-error.ts`**

```ts
// A refusal the caller can show as is (D12, D25). The message is fixed by the reason, so it carries no id, title,
// path, or storage detail.
// - 'not-found': the id names no post. It was never given out, was deleted, or is not one list() could return.
//                Message: "That post no longer exists."
// - 'invalid':   an argument the store refuses. Today that is only a blank title.
//                Message: "A post needs a title."
export type PostErrorReason = 'not-found' | 'invalid';
export class PostError extends Error {
  constructor(readonly reason: PostErrorReason) { super(/* the fixed message for reason */); }
}
```

**The file store: `src/posts/file/file-post-store.ts`**

```ts
// The first implementation (G4), built over today's FileSystem. It imports only file-system/file-system.ts (contract
// symbols), shared/entry-name.ts, and its own package, and it is Bun-free (D23). Like createLocalFileSystem, it is
// synchronous and does no I/O when called. Its ids are the workspace keys of post folders, such as `the sun` or
// `series/one`; they look like paths and are still opaque (D6).
export function createFilePostStore(fileSystem: FileSystem): PostStore;
```

**The contract suite: `src/posts/components/describe-post-store.ts`** (D4)

```ts
// Test-only: it imports bun:test. Every PostStore implementation's own *.test.ts file calls it once, so a second
// implementation is held to the same contract. posts.ts never re-exports it; boundary.test.ts fails if anything but a
// *.test.ts file under src/posts/ imports it; the Bun-free scan names it as an exemption. No in-memory store (D4).
export interface PostStoreFixture {
  store: PostStore;          // a new store over empty storage, used by exactly one test
  dispose(): Promise<void>;  // frees that storage; run after the test whether it passed or failed
}

// Registers describe(`PostStore contract: ${name}`, …). Uses only the contract, never storage, so it holds for any
// implementation. It proves:
// - a new store lists []; create → get and list show the post; titles round-trip exactly, spaces included
// - two creates with one title give two ids
// - bodies round-trip: "", NUL, CRLF, multi-byte text, and a large body (D13)
// - a blank title ("", "  \t\n") is 'invalid' from create and setTitle, with the fixed message, and nothing changes
// - "", an id never given out, a letter-case variant of a given id, and a deleted id are 'not-found' from get,
//   setBody, setTitle, and delete, with the fixed message (D7, D8, D12)
// - setBody leaves the title, and setTitle leaves the body
// - unawaited setBody 'a' then setBody 'b' → get gives 'b'; unawaited setBody then delete → 'not-found' afterwards and
//   absent from list; unawaited delete then setBody → the setBody is 'not-found' (D16, D17)
// - each change made through the store signals every subscription before its call settles; two subscriptions each get
//   it; after unsubscribe, nothing; unsubscribe twice is safe; a throwing listener neither rejects the call nor stops
//   later signals (D18, D19)
// - every rejection in these cases is a PostError with the expected reason
export function describePostStore(name: string, makeStore: () => Promise<PostStoreFixture>): void;
```

**Boundary test: `src/posts/boundary.test.ts`** (D22, D23; mirrors `src/file-system/boundary.test.ts`)

```ts
// 1. Nothing outside src/posts/ imports a module of the package other than posts/posts.
// 2. Engine production code imports posts/posts only with an `import type { … }` declaration. A value import, or
//    `import { type X }`, fails: only the declaration form is erased under every transpiler, so only it keeps every
//    implementation out of the engine (D23).
// 3. Production modules in src/posts/ import no package but file-system/file-system and shared/ (no cli, server,
//    engine, ui, or app-files).
// 4. components/describe-post-store is imported only by *.test.ts files under src/posts/, and posts.ts does not
//    export it.
// 5. Every exemption names a file that exists, and the checks catch planted lines.
```

**Integration shape (not built now, D2).** These sketches show where the store will plug in.

```ts
// src/cli/cli.ts (at integration)
const fileSystem = createLocalFileSystem(root);
const posts = createFilePostStore(fileSystem); // later: a database-backed store
const engine = await startEngine({ fileSystem, posts, appSkillFiles: APP_SKILL_FILES, serveTools, env: process.env, isOnPath });

// src/engine/engine.ts (at integration)
import type { PostStore } from '../posts/posts';
export interface EngineOptions {
  fileSystem: FileSystem; // stays: app state, config, skills, and notes are not posts (F30)
  posts: PostStore;
  // … unchanged …
}
// startEngine subscribes posts.watch(...) in place of the fileSystem.watch call at engine.ts:89, and keeps the
// unsubscribe for stop (D19). The event name is integration's choice (D26).
```

## 2. Invariants

1. **I1. Addressable means listable (D7, D8).** `get`, `setBody`, `setTitle`, and `delete` accept exactly the strings
   `list()` would return as ids at that moment. Everything else is `not-found`, never `invalid`.
2. **I2. Ids are stable and exact (D5, D7).** No call on the contract changes an id. At most one live post holds an
   id. A store may reuse an id after its post is deleted.
3. **I3. Titles are never blank.** `create` and `setTitle` refuse a blank title; a stored title is returned exactly
   as given; a derived title is never blank (D10).
4. **I4. Bodies round-trip.** Any well-formed string comes back unchanged. The store never parses, validates, or adds
   a heading (D9, D13, F29).
5. **I5. Read-after-write.** Once `create`, `setBody`, or `setTitle` resolves, `get` returns the new value and `list`
   includes the post. Once `delete` resolves, `get` is `not-found` and `list` excludes the post.
6. **I6. Per-post order (D16, D17).** Calls naming one id through one store take effect in call order. `list` is not
   ordered against them. Nothing is ordered across store instances or processes.
7. **I7. Delete is final through one store (D16).** No later call through the same store brings a deleted post back.
8. **I8. No upsert.** `setBody` and `setTitle` never create a post (OQ4, F10).
9. **I9. Failure meaning.** A `PostError` changed nothing. Any other rejection may or may not have taken effect.
   `list` never rejects with a `PostError`.
10. **I10. Fixed messages (D12).** `not-found` is always "That post no longer exists." and `invalid` is always "A post
    needs a title."
11. **I11. Signals (D18–D20).** Every call through a store that reaches storage signals every subscription of that
    store before it settles. Other writers are signalled when visible. Signals may be coalesced, repeated, or
    spurious. A listener's throw is logged and contained. Each `watch` call is its own subscription, and its
    unsubscribe is idempotent and required.
12. **I12. Lifecycle.** The factory is synchronous and does no I/O. `watch` is lazy.
13. **I13. Package boundary (D22, D23).** Only `posts/posts` is imported from outside `src/posts/`. The engine uses
    `import type` only. The package imports only `file-system/file-system` and `shared/`. The contract suite is
    test-only. `src/posts/` is Bun-free except the contract suite and, later, a database adapter's folder.

## 3. Failure Behavior

Every PostError message is fixed (I10). "Storage failure" means a rejection that is not a PostError (I9).

| Condition | Method | What the caller observes |
|---|---|---|
| Title has no non-whitespace character | create, setTitle | PostError `invalid`, "A post needs a title.". Nothing changes, no signal. Checked before any I/O and before the id. |
| `""`, an id never given out, a letter-case or other variant of an id (D7), or a deleted id | get, setBody, setTitle, delete | PostError `not-found`, "That post no longer exists.". Nothing changes. |
| (file) Id with a hidden segment, a folder nested inside another post, a folder without a regular `draft.md`, a path through a link, or a string that fails the key grammar (D8) | get, setBody, setTitle, delete | PostError `not-found`. A FileSystemError from the walk never reaches the caller as such. |
| Call queued behind a delete of the same id (same store) | get, setBody, setTitle, delete | PostError `not-found` (I7). |
| Title is taken by another post | create | Succeeds. Titles need not be unique; the file store's folder gets a ` 2`, ` 3`, … suffix (D14). |
| (file) Title has no character a folder name can use | create | Succeeds; the folder is named `Untitled` (or `Untitled 2`, …). The title is stored as given. |
| (file) A step of create fails (createFolder other than `exists`, `.post.json`, or `draft.md` write) | create | Storage failure: the original error. The folder is removed only if it holds nothing but the store's own files (D15); otherwise left, and without `draft.md` it is not a post. Subscriptions are signalled. |
| (file) The `draft.md` write rejects after landing | create | Storage failure. Cleanup may remove the post, so `get`/`list` say whether it exists. |
| Storage refuses or fails the act (EACCES, ENOSPC, a FileSystemError such as `<key> is a folder`, a lost DB connection) | create, setBody, setTitle, delete, get | Storage failure, rethrown unchanged. For a change, the store signals anyway. |
| (file) The post's folder vanishes after the walk and before the act | get, delete | PostError `not-found` (a FileSystemError `not-found` from the act is mapped). |
| (file) The post's folder is deleted by another writer between the walk and the write | setBody, setTitle | Accepted gap: `write` creates missing folders, so the folder comes back (as a post after setBody; as a non-post folder holding `.post.json` after setTitle). Not reachable through one store (D16). |
| (file) `.post.json` missing, not JSON, without a string `title`, blank, or not a regular file | get, list | Not an error: the title falls back to the folder's last segment, then `Untitled` (D10). |
| (file) `.post.json` or `draft.md` read fails otherwise (EACCES, EIO) | get, list | Storage failure. |
| (file) Workspace root missing or not a folder | list | Storage failure (a plain Error), never a PostError. |
| (file) A folder vanishes during the walk (FileSystemError `not-found`) | list | That folder is skipped; the call succeeds (D11). |
| (file) Any other error during the walk | list | Storage failure (D11). |
| Listener throws | watch (signal delivery) | Logged: `Could not report a post change: <message>`. The causing call is unaffected; later signals arrive. |
| (file) `fs.watch` throws synchronously | watch | Rethrown from `watch`, as in the FileSystem precedent. |
| (file) The FileSystem watcher stops (its own error) | watch | Logged by FileSystem. Other writers' changes are no longer signalled; the store's own writes still are (D18). |
| Unsubscribe called twice | the returned function | No effect. |

## 4. How the file implementation maps onto today's FileSystem

- **PostId.** The workspace key of the post's folder, such as `the sun` or `series/one`. The store never moves or
  renames the folder. A folder renamed or moved by another writer is, to the store, a delete plus a new post. A folder
  name freed by a delete may be given to a later post (I2).
- **What counts as a post (D8).** A folder, never the root, reached from the root through non-hidden folders only (no
  links), that holds an entry named exactly `draft.md` of kind `'file'`, and that is not inside another post.
- **Addressability and the exact-name check (D7, D8).** Before any other step, `get`, `setBody`, `setTitle`, and
  `delete` walk the id one segment at a time with `fileSystem.list`:
  1. The id is non-empty, and no segment starts with `.`.
  2. Each segment must appear in its parent's listing with exactly that name and kind `'folder'`. Listings report real
     names, so on a case-insensitive disk `The Sun` does not name `the sun`.
  3. No folder before the last may hold `draft.md` as a file (the post would be nested in another post).
  4. The last folder's listing must hold `draft.md` as a file.
  - Any failed rule, and any FileSystemError `invalid` or `not-found` from the walk, is PostError `not-found`. This is
    the same predicate `list` uses, so I1 holds.
- **body.** The text of `<id>/draft.md`, read and written with the FileSystem defaults. The store adds no heading
  (D9), so it does not import `shared/markdown` (F32 no longer applies).
- **title and its fallback (D10).** The string `title` in `<id>/.post.json`, written with `{ atomic: true }`. If that
  file is missing, not JSON, has no string `title`, has a blank one, or is not a regular file, the title is the
  folder's last segment; if that is blank, `Untitled`. Existing posts need no migration.
- **list().** A walk from the root with `fileSystem.list`, skipping hidden names and `'other'` entries, that does not
  descend into a post. It reads each post's `.post.json`. A folder that vanishes mid-walk is skipped; any other error
  rejects (D11). The root is never a post.
- **create.** In order:
  1. A blank title is `invalid`.
  2. The folder name is `newEntryName(title)`, cut at a code-point boundary to at most 200 UTF-8 bytes and trimmed of
     spaces and dots again; if empty, `Untitled`.
  3. `createFolder(name)` at the root. On `exists`, retry `name 2`, `name 3`, … with no cap. The exclusive
     `createFolder` keeps two creates, even in two processes, from sharing a folder (D14).
  4. The claimed id's queue is held from here until create settles, so a caller who finds the id in `list` early waits.
  5. Write `.post.json`, then `draft.md` last. A crash before `draft.md` leaves a folder that is not a post.
  6. **Cleanup (D15).** If step 5 fails, list the folder. Delete it only if every entry is `.post.json` or `draft.md`;
     otherwise leave it. The original error is rethrown.
- **setBody.** Walk, then `fileSystem.write(<id>/draft.md, body)`.
- **setTitle.** Refuse a blank title, walk, then write `.post.json` atomically. The folder keeps its name.
- **delete.** Walk, then `fileSystem.delete(<id>)`: the whole folder, including siblings such as `outline.md` and
  `research.md` and any subfolders.
- **Per-post queue (D16, D17).** A map in each store instance, from id (exactly as given) to the tail of a promise
  chain. `get`, `setBody`, `setTitle`, and `delete` are queued at call time, before any await, and run one at a time
  per id. A failed call rejects only its caller, and later calls still run. A settled tail is removed from the map.
  Because only exact ids are addressable (D7), two spellings of one folder can never sit in two queues for live posts.
  This removes the old known gap in which a `setBody` racing a `delete` recreated the folder.
- **Own-write signals (D18).** Each store keeps its set of current listeners. After every create, setBody, setTitle,
  or delete that reaches storage (succeeds, or fails with a storage failure), it calls each listener synchronously,
  each in its own try/catch, before settling the call.
- **watch (D19, D20).** Each call adds the listener to the set and starts its own
  `fileSystem.watch(() => listener(), { ignore })`. `ignore` matches any key with a hidden segment unless its last
  segment is `.post.json`, so non-post `.md` edits and folder changes still signal (spurious, allowed). The
  unsubscribe removes the listener and stops that watch; it is idempotent. The watcher also echoes the store's own
  writes, so those arrive twice.
- **Errors.** Walk failures become `not-found` as above. A FileSystemError `not-found` from the act of `get` or
  `delete` becomes `not-found`. Every other error is rethrown unchanged as a storage failure.
- **Known gap.** Against another writer, check-then-act windows remain. The main one is the setBody/setTitle row in
  the Failure Behavior table. Cleanup's list-then-delete has the same window.

## 5. Why each element is here

| Element | Justification |
|---|---|
| A contract (an interface), not a concrete module | G1 "an abstraction", G2a; G5 means two implementations. |
| Package `src/posts/`, entry `posts.ts` the only importable module | G2a, G5; F31 (a database driver must not reach the Bun-free engine); F36 precedent. |
| Layout `components/`, `file/` | README package → feature → component; D4 (the suite is shared by implementations, not owned by the file store). |
| `PostError` declared in `components/post-error.ts`, re-exported | N: the file store imports `PostError`; declaring it in the entry, which re-exports the file store, makes an import cycle (F36's D6). |
| Package imports only `file-system/file-system` and `shared/` | N: G4 (built over today's FileSystem); F31 one-way imports. |
| Engine imports `posts.ts` with `import type` only | D23; F31. |
| `fileSystem` stays in `EngineOptions` (integration sketch) | N: F30. App state, config, skills, and notes are not posts. |
| cli builds the store (integration sketch) | N: G5, the host chooses the implementation (F31, F36); built later per D2. |
| `PostId` store-assigned, stable, opaque, unbranded | G3 (F1, F2); G5 (F26); D5 (stable within one store); D6 (unbranded). |
| Exact ids; addressable means listable | D7, D8. |
| Ids may be reused after delete | N: G4. The file store's ids are folder names, which a later create may claim; stating it lets integration plan for it (F26). |
| Unknown or malformed id is `not-found`, never `invalid` | N: an opaque id has no malformed form. |
| `PostSummary { id, title }` | G2l. N: a list of opaque ids needs a human label. |
| `title` stored as given, never blank, separate from the H1 | G3, F4 (one stored title ends drift); D9; D10 for derived titles. |
| `Post { id, title, body }` | G3, G2e. |
| `body` opaque, round-trips any well-formed string | N: G5 (F29: editor rules stay out of adapters); D13. |
| `list()` without body or order; posts existing for the whole call; never a PostError | G2l; N: G5 (removing later breaks callers); D11. |
| No pagination | D24 (known exception to the admission test). |
| `get(id)` | G2e. |
| `create({ title, body }) → PostId`, titles not unique, visible once resolved | G2c; N: G3, G5 (uniqueness today is an accident of folder names, F9); N: the caller opens what it made. |
| `setBody`, `setTitle` | G2e; G2m (rename is today's main management action, F2, F16). |
| `set*` never creates | N: store-assigned ids leave upsert no meaning; settles OQ4 (F10). |
| Per-post call order, including `get` and `delete` | D16, D17; G5 (F12: the database must match). |
| Delete final through one store | D16. |
| `delete(id)` hard, removes everything kept for the post | G2m; F15 (today's delete is hard). |
| `watch` without payload, coalesced, spurious, duplicated | G2a; G5 (database writes are invisible to the FileSystem watcher); F19 (the consumer discards detail); F20; D20. |
| Own-write signals before the call settles | D18. |
| Each `watch` call its own subscription; unsubscribe required, idempotent | D19. |
| Listener throws logged and contained | N: the FileSystem precedent (F36). |
| `PostError` with `not-found` and `invalid`; `invalid` keeps its name | N: the server must tell 404 from 400 (F17); D25. |
| Fixed messages with no id | D12. |
| PostError changed nothing; other rejections unknown | N: G5 (a database commit can land after the connection drops). |
| `createFilePostStore(fileSystem)`, synchronous, no I/O | G4; F36 factory precedent. |
| File ids are folder keys; `.post.json` title sidecar; folder-name fallback | G4 (no migration); D10; D26 (`.post.json` is intended). |
| Addressability walk with exact names | D7, D8. |
| Create at the root, ` 2` retries with no cap | N: the contract has no folders (Option A, D1); D14. |
| Folder name cut to 200 UTF-8 bytes | N: the contract refuses only blank titles, and an over-long folder name would make a valid create fail (ENAMETOOLONG). |
| `draft.md` written last; cleanup only of the store's own files | N: G2c (no half-made post is listed); D15. |
| Per-post queue in the file store | D16. |
| Broad watch ignore rule | D20. |
| Contract suite `describePostStore(name, makeStore)` in `components/`, test-only | D4; N: G5 (the second implementation is proved against the same rules); kept out of production by the boundary test (D22). |
| Boundary test `src/posts/boundary.test.ts` | D22, D23. |
| Bun-free scan covers `src/posts/` (except the suite and a future database adapter folder) | D23; F31. |
| `make test-server` runs `src/posts` | N: D4, D22 (the tests must run in `make test`). |
| README update | D21; F31 (the README is the conventions source). |

## 6. What the build delivers, and what integration does later (D2)

**The `tdd` build delivers:**

- `src/posts/` with `posts.ts`, `components/post-error.ts`, and `file/file-post-store.ts`.
- `components/describe-post-store.ts`, and `file/file-post-store.test.ts`, which runs it for the file store and adds
  the file-only tests: fallback titles, nested and hidden folders, the case-variant id on a case-insensitive disk,
  links, ` 2` naming, the 200-byte cut, the cleanup rule, and a signal for an outside write.
- `src/posts/boundary.test.ts`.
- The Bun-free scan widened: `src/engine/bun-free.test.ts` also scans `src/posts/` production files, with
  `components/describe-post-store.ts` as a named exemption. One scan keeps one definition of "Bun-only code".
- `src/posts` added to the Makefile's `test-server` target.
- README: eight packages; a `src/posts/` entry (what it holds, its imports, the contract suite, the boundary test);
  the rule that the engine imports `posts/posts.ts` with `import type` only.

**Integration does later (G7):**

- cli builds the file store and passes `posts` to `startEngine`; `EngineOptions.posts`.
- `startEngine` swaps `fileSystem.watch` for `posts.watch` and keeps the unsubscribe; the event name (D26).
- `Engine['documents']`, the routes, wire types (F33), the chat tools (F22–F24), view state and session references
  (F25–F27), the system prompt (F35), the skills, the UI tree, and `fake-documents-api.ts` (F34) move onto ids.
- Whether the UI seeds an H1 on new posts (D9). Migrating to a database, and remapping stored references (D5).

## 7. Behavior changes integration will absorb

- **BC1. Identity.** A post was its draft path, `the sun/draft.md`. It is now the folder key, `the sun`, and
  `create` returns that id. Every store that copies the path (F26) holds the old form.
- **BC2. Title.** The title lives in `.post.json`, not in the folder name or an H1. `setTitle` does not rename the
  folder. New posts get no H1 from the store (D9).
- **BC3. What is a post.** Loose `.md` files (such as `check.ts`'s root `summary.md`), siblings such as `outline.md`
  and `research.md`, folders inside a post, and a `draft.md` at the root are not posts. They are not listed or
  addressable through `posts`.
- **BC4. Listing.** Flat summaries of posts only: no folders, no file/folder kinds, no path order. Posts in nested
  folders are still listed, with ids such as `series/one`.
- **BC5. No upsert.** Saving to a post that does not exist is `not-found` and creates no folder (F10). An AI-made post
  must go through `create`.
- **BC6. Create.** No parent argument: posts are made at the root (F6). A taken name gets ` 2`, … instead of a 400. A
  title with no usable characters makes `Untitled` instead of a 400. Over-long names are cut.
- **BC7. Folder operations leave the contract.** `createFolder`, `move`, and `count` are not post operations
  (F7, F14, F16).
- **BC8. Delete.** Only posts can be deleted through `posts`, and deleting one removes its siblings too.
- **BC9. Errors.** `PostError` replaces `DocumentError` and the tools' `FileSystemError` (F17, F18). Messages are
  fixed and carry no key; `exists` disappears.
- **BC10. Exact ids.** A letter-case variant no longer reaches a post on a case-insensitive disk.
- **BC11. Listing failures.** A subfolder that fails for a reason other than vanishing now fails the list instead of
  being dropped (F13, D11).
- **BC12. Ordering.** Calls on one post through one store, including reads, run in call order; a delete is final.
- **BC13. Signals.** Own writes signal at once and again through the watcher. `.post.json` changes signal. Each
  subscription is separate and must be unsubscribed.
- **BC14. Workspace files.** `.post.json` appears in post folders, and in git (D26).

## 8. Elements dropped or changed in this round

- **Changed: ordering.** "The same field of one post, last call wins" became every call naming one id through one
  store, `get` and `delete` included (D16, D17). Queuing `get` is this round's reading of D17 ("every call on one
  post"); it also keeps a same-store reader from seeing a half-copied `draft.md` (F12).
- **Dropped: the known setBody/delete gap through one store** (D16). A narrower gap against other writers is stated.
- **Dropped: the `shared/markdown` dependency and the H1 write** (D9). F32 no longer applies.
- **Changed: `stat` checks became the addressability walk** (D7, D8), the same predicate `list` uses.
- **Changed: `list` error handling.** It now skips only vanished folders (D11). It never rejects with a PostError.
- **Changed: title fallback.** The fallback now ends in `Untitled`, and covers invalid or blank `.post.json` (D10).
- **Changed: create cleanup** deletes only a folder holding nothing but the store's own files (D15).
- **Changed: watch.** Own-write signals (D18), and a subscription per call with a required unsubscribe (D19).
- **Changed: `PostError`.** The constructor takes only a reason, so messages are fixed (D12). It moved to
  `components/post-error.ts` to avoid an import cycle.
- **Changed: cli and engine wiring** is now integration, not build (D2).
- **Added, not from a decision:** the folder name is cut to 200 UTF-8 bytes. Without it, a long valid title fails
  create in the file store, which breaks the contract. The contract statement that ids may be reused after a delete
  is also new; it describes what the file store already does.
- **Not added:** an in-memory store (D4), a branded id (D6), pagination (D24), and every item on the cut list.

## Open risks

- Callers may come to depend on file ids being paths (D6).
- Other processes' changes may not be signalled by a database store until OQ5 is answered (Q23).
- Against other writers, the file store has check-then-act windows (section 4, Known gap).
- References to a deleted post's id can point at a later post with the same folder name (I2).

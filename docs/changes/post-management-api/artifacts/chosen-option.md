# Chosen Option (A), amended with the question round, D2–D26, and validation V1–V14

This is the working copy of the chosen design. It folds in every answer in [question-round.md](./question-round.md),
every decision in [decision-log.md](./decision-log.md), and every accepted finding in
[validation-dispositions.md](./validation-dispositions.md). The goal clauses (G1–G8) and findings (F1–F36) are defined
in [../design-options.md](../design-options.md) and [../context-brief.md](../context-brief.md).

The document has two layers (V13):

- **The contract** (sections 1–3): the types, the error, the invariants, and the failures every implementation must
  meet. A database store is held to exactly this.
- **File store conformance notes** (section 4): how the first implementation meets the contract over today's
  FileSystem, and the failures and gaps only it has. Nothing in section 4 binds another implementation.

## 1. The contract

**Package layout** (README package → feature → component; the file-system package is the precedent, F36)

```text
src/posts/
  posts.ts                        entry: contract types and re-exports. The engine imports it with `import type` only
                                  (D23).
  post-error.ts                   second entry: PostError, PostErrorReason. Imports nothing, so the engine may import
                                  it as a value and test `instanceof PostError` (V2).
  boundary.test.ts                D22, V12: the package's import rules, run by `make test`
  bun-free.test.ts                V12: the package's own Bun-free scan
  components/                     shared by the package's implementations
    describe-post-store.ts        D4: the shared contract suite. Test-only; imported only by *.test.ts files
  file/                           feature: the file store (G4). One component, so its files sit in the feature folder.
    file-post-store.ts            createFilePostStore(fileSystem); see section 4
    file-post-store.test.ts       describePostStore('file', …) plus the file-only tests
```

A database store will be a second feature folder beside `file/`. It is not part of this change (G5, D3).

**Entry module: `src/posts/posts.ts`**

```ts
// The posts package: every post is created, read, changed, listed, and deleted through one contract, so the store
// behind it can be swapped (G1, G5). A host builds a store; at integration it hands it to the engine (G7, D2).
// Outside src/posts/, only cli, server, and engine import the package, and only through posts/posts or
// posts/post-error (V12). The engine imports this module with `import type` only, so no implementation ever loads into
// the engine (D23); it may import posts/post-error as a value (V2). The package imports only
// src/file-system/file-system.ts and src/shared/.

// A post's identity, assigned by the store when the post is made.
// - Exact (D7, D8): a string names a post only when list() would return exactly that string, code unit for code unit.
//   A variant in letter case, Unicode form, or spacing names no post. "" never names a post.
// - Stable (D5): no call on this contract changes it, whatever happens to the title. It is stable within one store;
//   moving posts to another store is not part of the contract.
// - Never reused (V1): a store instance never gives out an id it has given out before, even after that post is
//   deleted. So a stale call holding a deleted id can never reach a later post. Reuse across store instances (a
//   restart, another process) is not promised against.
// - Opaque (D6): callers store it and pass it back. They never build, parse, order, or show it. Some stores' ids look
//   like paths or names (the file store's do); they are still opaque.
// Any string that names no post is 'not-found'. There is no "malformed id".
export type PostId = string;

// Strings (V7). Titles and bodies are JavaScript strings. A string holding a lone surrogate or U+0000 (NUL) is
// outside the contract: what a store does with it is not promised (a database TEXT column refuses NUL).
//
// Blank (V7): a title is blank when title.trim() === "", that is, when every code unit is whitespace or a line
// terminator as String.prototype.trim() defines them (so "", " \t\n", " ", and "　" are blank).
// U+200B (zero-width space) is not whitespace to trim(), so "​" is a valid title.

// What list() gives for each post: enough to show and pick it, without its body.
export interface PostSummary {
  id: PostId;
  // Never blank. The title exactly as last given to create or setTitle. For a post this store never titled, a title
  // the store derives (the file store's fallback, D10).
  title: string;
}

export interface Post extends PostSummary {
  // The post's markdown, exactly as last given (D13). The store checks nothing about it and never reads or writes a
  // heading in it: the title is separate metadata, and any H1 belongs to the caller (D9). The title and an H1 are
  // independent and can disagree (V10).
  // Any string inside the contract round-trips, including "", CRLF, multi-byte text, and large bodies.
  body: string;
}

// What list() resolves to (V6). An object, so fields such as a paging cursor can be added later without breaking
// callers. Today it holds only the posts; there is no paging (D24).
export interface PostList {
  posts: PostSummary[];
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
  list(): Promise<PostList>;

  // One post, body included. An id that names no post is 'not-found'.
  get(id: PostId): Promise<Post>;

  // Makes a new post and resolves to its id. The id is one list() returns (V5). Titles need not be unique. Once this
  // resolves, get and list include the post. A blank title is 'invalid', and nothing is made.
  create(post: { title: string; body: string }): Promise<PostId>;

  // Replace one field and leave the other alone. Neither ever creates a post: an id that names no post is
  // 'not-found'. A blank title is 'invalid'. Once the call resolves, get returns the new value.
  setBody(id: PostId, body: string): Promise<void>;
  setTitle(id: PostId, title: string): Promise<void>;

  // Removes the post, and everything the store keeps for it, for good. An id that names no post is 'not-found'.
  // Through this store, once a delete takes effect, every later call on that id is 'not-found', and no later call
  // brings the post back or gives its id to another post (D16, V1).
  delete(id: PostId): Promise<void>;

  // Subscribes listener to change signals and returns its unsubscribe (D19).
  // - Each call is its own subscription, even when the same function is passed twice: it is then called once per
  //   subscription per signal (V4). Nothing is watched until the first call.
  // - The caller must call the unsubscribe when it stops listening; it is safe to call twice. Once it returns, the
  //   listener is never called again through that subscription, including later in a signal already being delivered
  //   (V4).
  // - If watch throws, no subscription was made (V4).
  // - A signal carries no detail: re-list, and re-get the posts you hold.
  // - Own writes (D18, V14): every create, setBody, setTitle, or delete through this store that reaches storage
  //   signals every subscription of this store before its promise settles. That includes a call that rejects with a
  //   storage failure, since the change may have landed. A call that rejects with a PostError changed nothing and
  //   does not signal.
  // - Other writers, including another store instance: signalled when, and if, the implementation can see the change.
  // - One signal may stand for many changes, one change may be signalled more than once, and a signal may arrive when
  //   nothing visible changed (D20).
  // - A throw from the listener is caught and logged as `Could not report a post change: <message>`. It never rejects
  //   the call that caused the signal, and later signals and other subscriptions still get it.
  watch(listener: () => void): () => void;
}

export { PostError, type PostErrorReason } from './post-error';
export { createFilePostStore } from './file/file-post-store';
```

**Error entry: `src/posts/post-error.ts`** (V2)

```ts
// A refusal the caller can show as is (D12, D25). The message is fixed by the reason, so it carries no id, title,
// path, or storage detail. This module imports nothing, so the engine may import it as a value and recognize a
// refusal with `error instanceof PostError`. Reading `.reason` alone is not enough: FileSystemError also has
// 'not-found' and 'invalid' reasons (F18).
// - 'not-found': the id names no post. It was never given out, was deleted, or is not one list() could return.
//                Message: "That post no longer exists."
// - 'invalid':   an argument the store refuses. Today that is only a blank title.
//                Message: "A post needs a title."
export type PostErrorReason = 'not-found' | 'invalid';
export class PostError extends Error {
  constructor(readonly reason: PostErrorReason) { super(/* the fixed message for reason */); }
}
```

**The contract suite: `src/posts/components/describe-post-store.ts`** (D4)

```ts
// Test-only: it imports bun:test. Every PostStore implementation's own *.test.ts file calls it once, so a second
// implementation is held to the same contract. posts.ts never re-exports it; boundary.test.ts fails if anything but a
// *.test.ts file under src/posts/ imports it; the package's Bun-free scan names it as an exemption. No in-memory store
// (D4).
export interface PostStoreFixture {
  store: PostStore;          // a new store over empty storage, used by exactly one test
  dispose(): Promise<void>;  // frees that storage; run after the test whether it passed or failed
}

// Registers describe(`PostStore contract: ${name}`, …). Uses only the contract, never storage, so it holds for any
// implementation. It proves:
// - a new store lists { posts: [] }; create → get and list show the post; titles round-trip exactly, spaces included
// - every id create returns appears in list(), for an ASCII title and an NFD title such as "Café" (V5)
// - two creates with one title give two ids
// - bodies round-trip: "", CRLF, multi-byte text, and a large body (D13). Not NUL, which is outside the contract (V7).
// - a blank title ("", " \t\n", " 　") is 'invalid' from create and setTitle, with the fixed message, and
//   nothing changes; "​" is accepted as a title (V7)
// - "", an id never given out, a letter-case variant of a given id, and a deleted id are 'not-found' from get,
//   setBody, setTitle, and delete, with the fixed message (D7, D8, D12)
// - delete a post, then create one with the same title: the new id differs from the deleted one, and a setBody on
//   the deleted id is 'not-found' and leaves the new post unchanged (V1)
// - setBody leaves the title, and setTitle leaves the body
// - unawaited setBody 'a' then setBody 'b' → get gives 'b'; unawaited setBody then delete → 'not-found' afterwards and
//   absent from list; unawaited delete then setBody → the setBody is 'not-found' (D16, D17)
// - each change made through the store signals every subscription before its call settles; two subscriptions each get
//   it; after unsubscribe, nothing; unsubscribe twice is safe; a throwing listener neither rejects the call nor stops
//   later signals or other subscriptions (D18, D19)
// - one function subscribed twice is called twice per signal, and unsubscribing one leaves the other (V4)
// - two subscriptions whose listeners each unsubscribe the other: on one signal exactly one of them is called (V4)
// - every rejection in these cases is a PostError with the expected reason
export function describePostStore(name: string, makeStore: () => Promise<PostStoreFixture>): void;
```

**Boundary test: `src/posts/boundary.test.ts`** (D22, D23, V2, V12; mirrors `src/file-system/boundary.test.ts`)

```ts
// 1. Allowed importers (V12). Outside src/posts/, only src/cli/, src/server/, and src/engine/ (production or test)
//    import the package. src/ui/, src/shared/, src/file-system/, src/app-files/, and every other folder import
//    nothing from it.
// 2. Entries only. Those importers name only posts/posts or posts/post-error, never a module under components/ or
//    file/.
// 3. Engine production code imports posts/posts only with an `import type { … }` declaration. A value import, or
//    `import { type X }`, fails: only the declaration form is erased under every transpiler, so only it keeps every
//    implementation out of the engine (D23). The engine may import posts/post-error in any form (V2).
// 4. post-error.ts imports nothing. The package's other production modules import no package but
//    file-system/file-system and shared/ (no cli, server, engine, ui, or app-files).
// 5. components/describe-post-store is imported only by *.test.ts files under src/posts/, and posts.ts does not
//    export it.
// 6. Every exemption names a file that exists, and the checks catch planted lines.
```

**Bun-free scan: `src/posts/bun-free.test.ts`** (D23, V12)

```ts
// Scans src/posts/ production files (not *.test.ts) for Bun-only code, with components/describe-post-store.ts as a
// named exemption (and, later, a database adapter's folder if its driver needs Bun). It uses the same pattern list as
// the engine's scan: BUN_ONLY and bunHits move out of src/engine/bun-free.test.ts into a test-only helper,
// src/engine/components/bun-only-code.ts, which both scans import. One list keeps one definition of "Bun-only code".
// The engine scan names that helper as an exemption, and keeps its own paths relative to src/engine/.
```

## 2. Invariants

Every implementation holds these.

1. **I1. Addressable means listable (D7, D8).** `get`, `setBody`, `setTitle`, and `delete` accept exactly the strings
   `list()` would return as ids at that moment. Everything else is `not-found`, never `invalid`.
2. **I2. Ids are stable, exact, and never reused (D5, D7, V1).** No call on the contract changes an id. At most one
   post ever holds an id within one store instance: a deleted post's id is never given to a later post by that
   instance.
3. **I3. Titles are never blank.** `create` and `setTitle` refuse a title with `title.trim() === ""` (V7); a stored
   title is returned exactly as given; a derived title is never blank (D10).
4. **I4. Bodies round-trip.** Any string inside the contract (no lone surrogate, no NUL, V7) comes back unchanged. The
   store never parses, validates, or adds a heading (D9, D13, F29).
5. **I5. Read-after-write.** Once `create`, `setBody`, or `setTitle` resolves, `get` returns the new value and `list`
   includes the post under the id `create` returned (V5). Once `delete` resolves, `get` is `not-found` and `list`
   excludes the post.
6. **I6. Per-post order (D16, D17).** Calls naming one id through one store take effect in call order. `list` is not
   ordered against them. Nothing is ordered across store instances or processes.
7. **I7. Delete is final through one store (D16, V1).** No later call through the same store brings a deleted post
   back, or reaches another post through its id.
8. **I8. No upsert.** `setBody` and `setTitle` never create a post (OQ4, F10).
9. **I9. Failure meaning.** A `PostError` changed nothing. Any other rejection may or may not have taken effect.
   `list` never rejects with a `PostError`. (The file store has one exception against other writers; section 4,
   Known gaps, V11.)
10. **I10. Fixed messages (D12).** `not-found` is always "That post no longer exists." and `invalid` is always "A post
    needs a title."
11. **I11. Signals (D18–D20, V4, V14).** Every call through a store that reaches storage signals every subscription of
    that store before it settles. Other writers are signalled when visible. Signals may be coalesced, repeated, or
    spurious. A listener's throw is logged and contained. Each `watch` call is its own subscription, even for the same
    function; its unsubscribe is idempotent, required, and takes effect at once, even during a signal. A `watch` that
    throws subscribes nothing.
12. **I12. Lifecycle.** The factory is synchronous and does no I/O. `watch` is lazy.
13. **I13. Package boundary (D22, D23, V2, V12).** Only cli, server, and engine import the package from outside, and
    only through `posts/posts` and `posts/post-error`. The engine uses `import type` for `posts/posts`. The package
    imports only `file-system/file-system` and `shared/`; `post-error.ts` imports nothing. The contract suite is
    test-only. `src/posts/` is Bun-free except the contract suite and, later, a database adapter's folder.

## 3. Failure behavior (contract)

Every implementation behaves this way. Every PostError message is fixed (I10). "Storage failure" means a rejection
that is not a PostError (I9). The file store's own rows are in section 4.

| Condition | Method | What the caller observes |
|---|---|---|
| Blank title (`title.trim() === ""`, V7) | create, setTitle | PostError `invalid`, "A post needs a title.". Nothing changes, no signal. Checked before any I/O and before the id. |
| `""`, an id never given out, a letter-case or other variant of an id (D7), or a deleted id (V1) | get, setBody, setTitle, delete | PostError `not-found`, "That post no longer exists.". Nothing changes. |
| Call queued behind a delete of the same id (same store) | get, setBody, setTitle, delete | PostError `not-found` (I7). Holds because the id is never reused (V1). |
| Title is taken by another post | create | Succeeds with a new id. Titles need not be unique. |
| Storage refuses or fails the act (for example EACCES, ENOSPC, a lost DB connection) | create, setBody, setTitle, delete, get | Storage failure, rethrown unchanged. For a change, the store signals anyway (D18). |
| Storage cannot be read at all | list | Storage failure, never a PostError. |
| A string outside the contract (lone surrogate, NUL; V7) | create, setBody, setTitle | Not promised. A store may store it, alter it, or fail. |
| Listener throws | watch (signal delivery) | Logged: `Could not report a post change: <message>`. The causing call is unaffected; other subscriptions and later signals still arrive. |
| Starting to watch fails | watch | Thrown from `watch`; no subscription was made (V4). |
| Unsubscribe called twice | the returned function | No effect. |

## 4. File store conformance notes

Nothing in this section binds another implementation (V13).

**Factory: `src/posts/file/file-post-store.ts`**

```ts
// The first implementation (G4), built over today's FileSystem. It imports only file-system/file-system.ts (contract
// symbols), shared/entry-name.ts, and its own package's entries, and it is Bun-free (D23). Like createLocalFileSystem,
// it is synchronous and does no I/O when called. Its ids are the workspace keys of post folders, such as `the sun` or
// `series/one`; they look like paths and are still opaque (D6).
export function createFilePostStore(fileSystem: FileSystem): PostStore;
```

**Mapping onto today's FileSystem**

- **PostId.** The workspace key of the post's folder, exactly as `fileSystem.list` reports it, such as `the sun` or
  `series/one`. The store never moves or renames the folder. A folder renamed or moved by another writer is, to the
  store, a delete plus a new post.
- **Tombstones (V1).** Each store instance keeps a set of the ids it has deleted, exactly as given. A tombstoned id is
  never a post to that instance: `list` leaves it out, and `get`, `setBody`, `setTitle`, and `delete` on it are
  `not-found`, even if another writer later makes a post folder at that key (needed for I1 and I2). `create` never
  gives one out (see create). The set lives as long as the instance and is not persisted.
- **What counts as a post (D8).** A folder, never the root, reached from the root through non-hidden folders only (no
  links), that holds an entry named exactly `draft.md` of kind `'file'`, that is not inside another post, whose key
  passes the FileSystem key grammar (V9), and whose key is not tombstoned (V1).
- **Addressability and the exact-name check (D7, D8).** Before any other step, `get`, `setBody`, `setTitle`, and
  `delete` check the id:
  1. The id is non-empty, not tombstoned, and no segment starts with `.`.
  2. Walking one segment at a time with `fileSystem.list`, each segment must appear in its parent's listing with
     exactly that name and kind `'folder'`. Listings report real names, so on a case-insensitive disk `The Sun` does
     not name `the sun`.
  3. No folder before the last may hold `draft.md` as a file (the post would be nested in another post).
  4. The last folder's listing must hold `draft.md` as a file.
  - Any failed rule, and any FileSystemError `invalid` or `not-found` from the walk, is PostError `not-found`. This is
    the same predicate `list` uses, so I1 holds.
- **body.** The text of `<id>/draft.md`, read and written with the FileSystem defaults. The store adds no heading
  (D9), so it does not import `shared/markdown` (F32 no longer applies). NUL round-trips (the file store's own test,
  V7).
- **title and its fallback (D10).** The string `title` in `<id>/.post.json`, written with `{ atomic: true }`. If that
  file is missing, not JSON, has no string `title`, has a blank one, or is not a regular file, the title is the
  folder's last segment; if that is blank, `Untitled`. Existing posts need no migration.
- **list().** A walk from the root with `fileSystem.list`, skipping hidden names, `'other'` entries, and tombstoned
  keys, that does not descend into a post. It reads each post's `.post.json` and resolves to `{ posts }`. A folder
  whose listing fails with FileSystemError `not-found` (it vanished, D11) or `invalid` (its name fails the key
  grammar, such as a name holding `\`, V9) is skipped. Any other error rejects (D11). The root is never a post.
- **create.** In order:
  1. A blank title is `invalid`.
  2. The folder name is `newEntryName(title)`, cut at a code-point boundary to at most 200 UTF-8 bytes and trimmed of
     spaces and dots again; if empty, `Untitled`.
  3. Candidates are `name`, `name 2`, `name 3`, … with no cap (D14). A candidate that is tombstoned is skipped
     without touching the disk. Otherwise `createFolder(candidate)` at the root; on `exists`, try the next. The
     exclusive `createFolder` keeps two creates, even in two processes, from sharing a folder.
  4. **Resolve the id (V5).** List the root and take the folder entry whose name equals the candidate exactly; if
     there is none (a normalizing disk such as HFS+ stored it in NFD), the one folder entry whose NFC form equals the
     candidate's NFC form. That listed name is the id, so `list` returns it (I1). If it is tombstoned, remove the
     empty folder just made and go back to step 3 with the next candidate. If no entry matches, remove the empty
     folder and reject with a storage failure.
  5. The resolved id's queue is held from here until create settles, so a caller who finds the id in `list` early
     waits (V14: create holds the queue only after claiming its folder).
  6. Write `.post.json`, then `draft.md` last. A crash before `draft.md` leaves a folder that is not a post.
  7. **Cleanup (D15).** If step 6 fails, list the folder. Delete it only if every entry is `.post.json` or `draft.md`;
     otherwise leave it. The original error is rethrown.
- **setBody.** Check the id, then `fileSystem.write(<id>/draft.md, body)`.
- **setTitle.** Refuse a blank title, check the id, then write `.post.json` atomically. The folder keeps its name.
- **delete.** Check the id, then `fileSystem.delete(<id>)`: the whole folder, including siblings such as `outline.md`
  and `research.md` and any subfolders. Then add the id to the tombstones (also when the act fails with a storage
  failure, since part of the folder may be gone).
- **Per-post queue (D16, D17).** A map in each store instance, from id (exactly as given) to the tail of a promise
  chain. `get`, `setBody`, `setTitle`, and `delete` are queued at call time, before any await, and run one at a time
  per id. A failed call rejects only its caller, and later calls still run. A settled tail is removed from the map.
  Because only exact ids are addressable (D7), two spellings of one folder can never sit in two queues for live posts,
  and because ids are never reused (V1), a queued call on a deleted id can never reach a later post.
- **Subscriptions (D19, V3, V4).** Each store holds a set of subscription entries and at most one underlying
  `fileSystem.watch`.

  ```ts
  // inside createFilePostStore (sketch)
  type Subscription = { listener: () => void; active: boolean };
  const subscriptions = new Set<Subscription>();
  let stopWatching: (() => void) | undefined;

  watch(listener) {
    // First subscriber starts the one underlying watch. If it throws, nothing is registered (V4).
    if (subscriptions.size === 0) stopWatching = fileSystem.watch(() => signal(), { ignore });
    const entry: Subscription = { listener, active: true }; // a fresh object per call, never merged (V4)
    subscriptions.add(entry);
    return () => {
      if (!entry.active) return;                           // idempotent
      entry.active = false;
      subscriptions.delete(entry);
      if (subscriptions.size === 0) { stopWatching?.(); stopWatching = undefined; } // last one stops it (V3)
    };
  }

  // Own writes and watcher events both go through here.
  function signal() {
    for (const entry of [...subscriptions]) {              // a copy, so unsubscribes during dispatch are safe
      if (!entry.active) continue;                         // unsubscribed earlier in this signal
      try { entry.listener(); } catch (error) { console.error(`Could not report a post change: ${message(error)}`); }
    }
  }
  ```

  A later `watch` after the last unsubscribe starts a new underlying watch (and a new full-tree snapshot).
- **Own-write signals (D18, V14).** After every create, setBody, setTitle, or delete that reaches storage (succeeds, or
  fails with a storage failure), the store calls `signal()` synchronously before settling the call. A call refused
  with a PostError does not signal.
- **Watcher signals (D20).** `ignore` matches any key with a hidden segment unless its last segment is `.post.json`, so
  non-post `.md` edits and folder changes still signal (spurious, allowed). The watcher also echoes the store's own
  writes, so those arrive twice per subscription.
- **Errors.** Walk failures become `not-found` as above. A FileSystemError `not-found` from the act of `get` or
  `delete` becomes `not-found`. Every other error is rethrown unchanged as a storage failure.

**File store failure rows** (in addition to section 3)

| Condition | Method | What the caller observes |
|---|---|---|
| Id with a hidden segment, a folder nested inside another post, a folder without a regular `draft.md`, a path through a link, a string that fails the key grammar, or a tombstoned id (D8, V1, V9) | get, setBody, setTitle, delete | PostError `not-found`. A FileSystemError from the walk never reaches the caller as such. |
| Title is taken by another post | create | The folder gets a ` 2`, ` 3`, … suffix (D14). |
| Title has no character a folder name can use | create | Succeeds; the folder is named `Untitled` (or `Untitled 2`, …). The title is stored as given. |
| The candidate folder name is tombstoned | create | Skipped; the next suffix is tried (V1). |
| The created folder cannot be found in the root listing | create | Storage failure after removing the empty folder (V5). |
| A step of create fails (createFolder other than `exists`, `.post.json`, or `draft.md` write) | create | Storage failure: the original error. The folder is removed only if it holds nothing but the store's own files (D15); otherwise left, and without `draft.md` it is not a post. Subscriptions are signalled. |
| The `draft.md` write rejects after landing | create | Storage failure. Cleanup may remove the post, so `get`/`list` say whether it exists. |
| A FileSystemError other than the mapped ones, such as `<key> is a folder` | create, setBody, setTitle, delete, get | Storage failure, rethrown unchanged. |
| The post's folder vanishes after the walk and before the act | get, delete | PostError `not-found` (a FileSystemError `not-found` from the act is mapped). |
| The post's folder is deleted by another writer between the walk and the write | setBody, setTitle | Known gap: `write` creates missing folders, so the folder comes back (as a post after setBody; as a non-post folder holding `.post.json` after setTitle). Not reachable through one store (D16). |
| `.post.json` missing, not JSON, without a string `title`, blank, or not a regular file | get, list | Not an error: the title falls back to the folder's last segment, then `Untitled` (D10). |
| `.post.json` or `draft.md` read fails otherwise (EACCES, EIO) | get, list | Storage failure. |
| Workspace root missing or not a folder | list | Storage failure (a plain Error), never a PostError. |
| A folder vanishes during the walk, or its name fails the key grammar (FileSystemError `not-found` or `invalid`) | list | That folder is skipped; the call succeeds (D11, V9). |
| Any other error during the walk | list | Storage failure (D11). |
| `fs.watch` throws synchronously | watch | Rethrown from `watch`, as in the FileSystem precedent; no subscription is registered (V4). |
| The FileSystem watcher stops (its own error) | watch | Logged by FileSystem. Other writers' changes are no longer signalled; the store's own writes still are (D18). |

**Known gaps** (accepted, not fixed)

- **Other writers' check-then-act windows.** The main one is the setBody/setTitle row above. Create's cleanup
  (list-then-delete) has the same window.
- **Partial delete reported as not-found (V11).** `fileSystem.delete` removes the folder recursively. If another writer
  removes part of it at the same time, the removal can delete some entries and then fail with FileSystemError
  `not-found`, which the store maps to PostError `not-found` although something changed. This breaks I9 only against
  another writer; through one store, the queue rules it out.
- **Cost of each addressed call (V8).** The exact-name check lists every folder along the id, starting with the root,
  so each `get`, `setBody`, and `setTitle` (every autosave) costs one listing of the root's entries plus one per
  further segment: O(entries at the root) per call. No cache is added: a cache needs invalidation from a watcher that
  is coalesced and late, which would reopen I1.
- **Tombstones are per instance (V1).** They are kept in memory for the life of the store and grow by one per delete.
  A new instance (a restart, another process) does not know them, so it may give a deleted id to a new post. And a
  post folder another writer makes at a tombstoned key stays invisible to that instance until it is rebuilt.

## 5. Why each element is here

**Contract elements**

| Element | Justification |
|---|---|
| A contract (an interface), not a concrete module | G1 "an abstraction", G2a; G5 means two implementations. |
| Package `src/posts/`, entries `posts.ts` and `post-error.ts` | G2a, G5; F31 (a database driver must not reach the Bun-free engine); F36 precedent; V2 for the second entry. |
| `PostError` in a dependency-free `post-error.ts` the engine may value-import | V2: under `import type` only, the engine cannot test `instanceof`, and `.reason` collides with FileSystemError's reasons (F18). Keeping it out of `posts.ts` also avoids the import cycle with the file store (F36's D6). |
| Allowed importers named: cli, server, engine | V12. |
| Package imports only `file-system/file-system` and `shared/` | N: G4 (built over today's FileSystem); F31 one-way imports. |
| Engine imports `posts.ts` with `import type` only | D23; F31. |
| `PostId` store-assigned, stable, opaque, unbranded | G3 (F1, F2); G5 (F26); D5 (stable within one store); D6 (unbranded). |
| Exact ids; addressable means listable | D7, D8. |
| Ids never reused by one store instance | V1: reuse lets a stale call write into a later post, breaking I7. A database does not reuse ids either (G5). |
| Unknown or malformed id is `not-found`, never `invalid` | N: an opaque id has no malformed form. |
| `PostSummary { id, title }` | G2l. N: a list of opaque ids needs a human label. |
| `title` stored as given, never blank, separate from the H1 | G3: titles get a home that is not the path (V10); D9; D10 for derived titles. F4's sample evidence shows path-typing drift (F26, F27), not title drift, so this is not claimed to end drift; the title and an H1 can disagree. |
| Blank defined by `String.prototype.trim()` | V7: "blank" must be one testable rule for every store. |
| `Post { id, title, body }` | G3, G2e. |
| `body` opaque; NUL and lone surrogates outside the contract | N: G5 (F29: editor rules stay out of adapters); D13; V7 (a database TEXT column refuses NUL). |
| `list()` without body or order; posts existing for the whole call; never a PostError | G2l; N: G5 (removing later breaks callers); D11. |
| `list()` resolves to `{ posts }` | V6: an object can gain a paging field later without breaking callers. |
| No pagination | D24; the `{ posts }` shape makes adding it later non-breaking (V6). |
| `get(id)` | G2e. |
| `create({ title, body }) → PostId`, titles not unique, visible once resolved | G2c; N: G3, G5 (uniqueness today is an accident of folder names, F9); N: the caller opens what it made. |
| `create`'s id is one `list` returns | V5; I1. |
| `setBody`, `setTitle` | G2e; G2m (rename is today's main management action, F2, F16). |
| `set*` never creates | N: store-assigned ids leave upsert no meaning; settles OQ4 (F10). |
| Per-post call order, including `get` and `delete` | D16, D17; G5 (F12: the database must match). |
| Delete final through one store | D16; V1. |
| `delete(id)` hard, removes everything kept for the post | G2m; F15 (today's delete is hard). |
| `watch` without payload, coalesced, spurious, duplicated | G2a; G5 (database writes are invisible to the FileSystem watcher); F19 (the consumer discards detail); F20; D20. |
| Own-write signals before the call settles, for calls that reach storage | D18; V14. |
| Each `watch` call its own subscription, even for one function; unsubscribe required, idempotent, effective mid-signal; a throwing `watch` subscribes nothing | D19; V4. |
| Listener throws logged and contained | N: the FileSystem precedent (F36). |
| `PostError` with `not-found` and `invalid`; `invalid` keeps its name | N: the server must tell 404 from 400 (F17); D25. |
| Fixed messages with no id | D12. |
| PostError changed nothing; other rejections unknown | N: G5 (a database commit can land after the connection drops). |

**Package and test elements**

| Element | Justification |
|---|---|
| Layout `components/`, `file/` | README package → feature → component; D4 (the suite is shared by implementations, not owned by the file store). |
| Contract suite `describePostStore(name, makeStore)` in `components/`, test-only | D4; N: G5 (the second implementation is proved against the same rules); kept out of production by the boundary test (D22). |
| Suite cases for id reuse, create-id-in-list (ASCII and NFD), blank titles, same-function and mid-signal unsubscribe; no NUL | V1, V5, V7, V4. |
| Boundary test `src/posts/boundary.test.ts` | D22, D23; V2 (post-error rule); V12 (allowed importers). |
| `src/posts/bun-free.test.ts`, sharing the pattern list via `src/engine/components/bun-only-code.ts` | D23; F31; V12 (the engine scan's paths are relative to `src/engine/`, so widening it is awkward). |
| `make test-server` runs `src/posts` | N: D4, D22 (the tests must run in `make test`). |
| README update | D21; F31 (the README is the conventions source). |

**File store elements** (these cite the contract they serve, not G5; V13)

| Element | Justification |
|---|---|
| `createFilePostStore(fileSystem)`, synchronous, no I/O | G4; N: I12; F36 factory precedent. |
| File ids are folder keys; `.post.json` title sidecar; folder-name fallback | G4 (no migration); D10; D26 (`.post.json` is intended). |
| Ids are the listed names | V5; N: I1. |
| Tombstone set; create skips tombstoned names; list and addressed calls treat them as not posts | V1; N: I2, I7, and I1 (list must agree with addressability). |
| Addressability walk with exact names | D7, D8; N: I1. |
| `list` and the walk skip names failing the key grammar | V9; N: I1 (one predicate), D11. |
| Create at the root, ` 2` retries with no cap | N: the contract has no folders (Option A, D1); D14. |
| Folder name cut to 200 UTF-8 bytes | N: the contract refuses only blank titles, and an over-long folder name would make a valid create fail (ENAMETOOLONG). |
| `draft.md` written last; cleanup only of the store's own files | N: G2c and I5 (no half-made post is listed); D15. |
| Create holds the queue only after claiming and resolving its folder | V14; D16. |
| Per-post queue | D16, D17; N: I6. |
| One refcounted underlying watch per store | V3: N subscribers would otherwise start N recursive watchers and full-tree snapshots. |
| Fresh subscription entries; register after the watch starts; dispatch over a copy | V4; N: I11. |
| Broad watch ignore rule | D20. |
| Known gaps documented, not fixed (root listing cost, partial delete) | V8, V11. |

## 6. What the build delivers, and what integration does later (D2)

The build scope is unchanged by validation (V13 accepted in part).

**The `tdd` build delivers:**

- `src/posts/` with `posts.ts`, `post-error.ts`, and `file/file-post-store.ts`.
- `components/describe-post-store.ts`, and `file/file-post-store.test.ts`, which runs it for the file store and adds
  the file-only tests: fallback titles, nested and hidden folders, the case-variant id on a case-insensitive disk,
  links, a folder name holding `\` skipped by `list` and `not-found` when addressed, ` 2` naming, the 200-byte cut,
  the cleanup rule, NUL bodies round-tripping, tombstones (a deleted name is skipped by create; a folder another writer
  makes at a tombstoned key is neither listed nor addressable), one underlying `fileSystem.watch` however many
  subscriptions and none after the last unsubscribe, a `fileSystem.watch` that throws leaving no subscription, and a
  signal for an outside write.
- `src/posts/boundary.test.ts` and `src/posts/bun-free.test.ts`.
- `BUN_ONLY` and `bunHits` moved from `src/engine/bun-free.test.ts` into the test-only helper
  `src/engine/components/bun-only-code.ts`, named in the engine scan's exemptions; both scans import it.
- `src/posts` added to the Makefile's `test-server` target.
- README: eight packages; a `src/posts/` entry (what it holds, its two entries, its importers, the contract suite, the
  boundary and Bun-free tests); the rule that the engine imports `posts/posts.ts` with `import type` only and may
  import `posts/post-error.ts` as a value.

**Integration shape (not built now, D2).** These sketches show where the store will plug in.

```ts
// src/cli/cli.ts (at integration)
const fileSystem = createLocalFileSystem(root);
const posts = createFilePostStore(fileSystem); // later: a database-backed store
const engine = await startEngine({ fileSystem, posts, appSkillFiles: APP_SKILL_FILES, serveTools, env: process.env, isOnPath });

// src/engine/engine.ts (at integration)
import type { PostStore } from '../posts/posts';
import { PostError } from '../posts/post-error'; // a value: tools tell a refusal from a FileSystemError (V2)
export interface EngineOptions {
  fileSystem: FileSystem; // stays: app state, config, skills, and notes are not posts (F30)
  posts: PostStore;
  // … unchanged …
}
// startEngine subscribes posts.watch(...) in place of the fileSystem.watch call at engine.ts:89, and keeps the
// unsubscribe for stop (D19). The event name is integration's choice (D26).
```

**Integration does later (G7):**

- cli builds the file store and passes `posts` to `startEngine`; `EngineOptions.posts`.
- `startEngine` swaps `fileSystem.watch` for `posts.watch` and keeps the unsubscribe; the event name (D26).
- `Engine['documents']`, the routes, wire types (F33), the chat tools (F22–F24), view state and session references
  (F25–F27), the system prompt (F35), the skills, the UI tree, and `fake-documents-api.ts` (F34) move onto ids.
- Whether the UI seeds an H1 on new posts (D9), knowing the title and an H1 can then disagree (V10). Migrating to a
  database, and remapping stored references (D5).

## 7. Behavior changes integration will absorb

- **BC1. Identity.** A post was its draft path, `the sun/draft.md`. It is now the folder key, `the sun`, exactly as the
  listing reports it, and `create` returns that id. Every store that copies the path (F26) holds the old form.
- **BC2. Title.** The title lives in `.post.json`, not in the folder name or an H1. `setTitle` does not rename the
  folder. New posts get no H1 from the store (D9). The title and any H1 in the body are independent: nothing keeps
  them in step, and they can disagree (V10).
- **BC3. What is a post.** Loose `.md` files (such as `check.ts`'s root `summary.md`), siblings such as `outline.md`
  and `research.md`, folders inside a post, a `draft.md` at the root, and folders whose names fail the key grammar
  are not posts. They are not listed or addressable through `posts`.
- **BC4. Listing.** `list()` resolves to `{ posts }` (V6): flat summaries of posts only, with no folders, no file/folder
  kinds, and no path order. Posts in nested folders are still listed, with ids such as `series/one`.
- **BC5. No upsert.** Saving to a post that does not exist is `not-found` and creates no folder (F10). An AI-made post
  must go through `create`.
- **BC6. Create.** No parent argument: posts are made at the root (F6). A taken name gets ` 2`, … instead of a 400. A
  title with no usable characters makes `Untitled` instead of a 400. Over-long names are cut. A name this store
  instance deleted is not reused; the next suffix is used (V1).
- **BC7. Folder operations leave the contract.** `createFolder`, `move`, and `count` are not post operations
  (F7, F14, F16).
- **BC8. Delete.** Only posts can be deleted through `posts`, and deleting one removes its siblings too. Until the
  store is rebuilt, a post folder that reappears at a deleted key is invisible to it (V1).
- **BC9. Errors.** `PostError` replaces `DocumentError` and the tools' `FileSystemError` (F17, F18). Messages are
  fixed and carry no key; `exists` disappears. Code recognizes a refusal with `instanceof PostError`, imported from
  `posts/post-error` (V2).
- **BC10. Exact ids.** A letter-case variant no longer reaches a post on a case-insensitive disk.
- **BC11. Listing failures.** A subfolder that fails for a reason other than vanishing or a name failing the key
  grammar now fails the list instead of being dropped (F13, D11). A folder whose name fails the key grammar (such as
  one holding `\`) is skipped instead of failing the list (V9).
- **BC12. Ordering.** Calls on one post through one store, including reads, run in call order; a delete is final.
- **BC13. Signals.** Own writes signal at once and again through the watcher. `.post.json` changes signal. Each
  subscription is separate, even for one function, and must be unsubscribed. However many subscriptions a store has,
  it runs one file-system watcher (V3).
- **BC14. Workspace files.** `.post.json` appears in post folders, and in git (D26).

## 8. Elements dropped or changed in the question round

- **Changed: ordering.** "The same field of one post, last call wins" became every call naming one id through one
  store, `get` and `delete` included (D16, D17). Queuing `get` is this round's reading of D17 ("every call on one
  post"); it also keeps a same-store reader from seeing a half-copied `draft.md` (F12).
- **Dropped: the known setBody/delete gap through one store** (D16). A narrower gap against other writers is stated.
- **Dropped: the `shared/markdown` dependency and the H1 write** (D9). F32 no longer applies.
- **Changed: `stat` checks became the addressability walk** (D7, D8), the same predicate `list` uses.
- **Changed: `list` error handling.** It skipped only vanished folders (D11); validation adds names failing the key
  grammar (V9). It never rejects with a PostError.
- **Changed: title fallback.** The fallback now ends in `Untitled`, and covers invalid or blank `.post.json` (D10).
- **Changed: create cleanup** deletes only a folder holding nothing but the store's own files (D15).
- **Changed: watch.** Own-write signals (D18), and a subscription per call with a required unsubscribe (D19).
- **Changed: `PostError`.** The constructor takes only a reason, so messages are fixed (D12). Validation moved it to
  the dependency-free entry `post-error.ts` (V2).
- **Changed: cli and engine wiring** is now integration, not build (D2).
- **Added, not from a decision:** the folder name is cut to 200 UTF-8 bytes. Without it, a long valid title fails
  create in the file store, which breaks the contract.
- **Not added:** an in-memory store (D4), a branded id (D6), pagination (D24), and every item on the cut list.

## 9. Changes from validation

| Finding | What changed |
|---|---|
| V1 | Ids are never reused by one store instance (PostId doc, I2, I7, delete doc). The file store keeps per-instance tombstones: create skips them, list hides them, addressed calls on them are `not-found`. Suite case for delete-then-create-same-title with a stale setBody. The "may reuse ids" statement and its justification row are gone; the old reuse open risk is replaced by the per-instance limit. |
| V2 | `PostError` moved from `components/post-error.ts` to a second, dependency-free entry `src/posts/post-error.ts`. The engine may import it as a value and use `instanceof`. Boundary rules 2–4 updated; integration sketch shows the import; BC9 updated. |
| V3 | The file store runs one underlying `fileSystem.watch` per store, started by the first subscriber and stopped by the last unsubscribe. BC13 updated. |
| V4 | Fresh entry object per `watch` call; registered only after the underlying watch starts; dispatch over a copy, skipping entries unsubscribed mid-signal. Contract doc, I11, failure rows, and two suite cases (same function twice; mutual unsubscribe). |
| V5 | create resolves its id from the root listing (exact match, else the one NFC-equal folder). Suite asserts create's id appears in `list()` for ASCII and NFD titles. I5 and the create doc state it. |
| V6 | `list(): Promise<PostList>` with `PostList { posts: PostSummary[] }`. Still no paging (D24). BC4 updated. |
| V7 | NUL and lone surrogates are outside the contract; the shared suite drops NUL (the file store tests it itself). Blank is `title.trim() === ""`; `"​"` is a valid title. I3, I4, failure rows, suite updated. |
| V8 | Known gaps: each addressed call lists the root, O(root entries) per autosave. No cache. |
| V9 | `list` skips folders whose listing fails with FileSystemError `invalid`; the walk already maps it to `not-found`, so one predicate holds. Failure row and BC3, BC11 updated. |
| V10 | The title justification now reads "titles get a home that is not the path"; F4's evidence is noted as path drift. BC2 states the title and the H1 can disagree. |
| V11 | Known gaps: a delete racing another writer can partly succeed and still report `not-found`; I9 notes the exception. |
| V12 | Boundary rule 1 names the allowed importers (cli, server, engine). `src/posts/bun-free.test.ts` is the package's own scan, sharing the pattern list through `src/engine/components/bun-only-code.ts`; the engine scan is no longer widened. |
| V13 (in part) | Sections 1–3 are the contract; section 4 holds the file store's conformance notes, failure rows, and gaps. The justification table is split, and file-store rows cite D#, V#, or the invariant they serve instead of G5. Build scope (D2) is unchanged. |
| V14 | Own-write signals are stated as "reaches storage" throughout; create holds the id's queue only after claiming and resolving its folder. |

## Open risks

- Callers may come to depend on file ids being paths (D6).
- Other processes' changes may not be signalled by a database store until OQ5 is answered (Q23).
- Against other writers, the file store has check-then-act windows, and a partial delete can report `not-found`
  (section 4, Known gaps; V11).
- Ids are never reused only within one store instance (V1). After a restart, the file store may give a deleted id to a
  new post, so a reference to a deleted post persisted across restarts (session references, F26) can point at a later
  post. Integration must drop or check such references.
- A post folder another writer makes at a key this file store instance deleted stays invisible until the store is
  rebuilt (V1), and the tombstone set grows by one per delete for the life of the instance.
- Each addressed file store call lists the root, so autosave cost grows with the number of root entries (V8).
- The NFC fallback in create's id resolution assumes a normalizing disk stores at most one folder per NFC form, which
  holds for HFS+; an unusual filesystem that both normalizes and keeps distinct forms would make create fail with a
  storage failure rather than return a wrong id (V5).
- `instanceof PostError` needs one copy of `post-error.ts` loaded; a database adapter bundled separately with its own
  copy would break recognition (V2).
- Strings holding NUL or lone surrogates behave differently per store (V7); integration may need to refuse them at the
  edge before the database cut-over.

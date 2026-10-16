# Options: The Post Management Contract

Produced by `han-core:software-architect` from [context-brief.md](./context-brief.md) (F1–F36, OQ1–OQ6). It follows the
style of [../file-system-package/api-design.md](../file-system-package/api-design.md).

**Caller check.** Only `src/engine/engine.ts` imports `engine/documents/documents`, and only
`src/server/documents/documents.routes.ts` uses `Engine['documents']`. None of the options edits those callers, because
integration comes later (G7). Each option adds a contract and changes no caller.

## Goal clauses (cited as G1–G8)

- **G1** "an abstraction for "post management""
- **G2** "this abstraction will sit in between the engine and the implementation of actually …". The clauses below
  quote its parts:
  - **G2a** "sit in between the engine and the implementation"
  - **G2c** "creating"
  - **G2e** "editing"
  - **G2m** "managing"
  - **G2l** "listing"
  - **G2o** "otherwise handling"
- **G3** "posts as a first class concept in the system"
- **G4** "the first implementation of this abstraction will be the direct file system reads and writes that we currently use"
- **G5** "this abstraction will soon be replaced with a database backed implementation"
- **G6** "don't worry about how this will break current features"
- **G7** "we'll work on integrating this new api, and handling breaking changes to do so, later"
- **G8** "i want the abstraction that will handle these requirements to be documented"

**Admission test.** An element enters the contract only when one of these holds:

1. A clause of the goal names its behavior.
2. It is a **necessity** (written `N:`) of a behavior the goal names.
3. G5 forces it: the database implementation could not satisfy the contract without it, or adding it after the
   database implementation exists would break callers or implementers.

An element a later change could add without breaking anyone is cut, and the cut list names its reopen trigger.

---

## Option A (recommended): a flat store of posts with stable ids and one body each, in a new `src/posts/` package

A post is an entity with three fields: a store-assigned id, a title, and a markdown body. The contract has no folders,
collections, or parts. It lives in a new package whose entry is `src/posts/posts.ts`, mirroring `src/file-system/`
(F36):

- cli builds the file-backed store over the `FileSystem` it already builds.
- cli hands that store to `startEngine` as `posts`.
- The engine imports only contract symbols.
- The database store will be another implementation under `src/posts/`, built by the host the same way.

```ts
// src/posts/posts.ts
export type PostId = string;

export interface PostSummary {
  id: PostId;
  title: string;
}

export interface Post extends PostSummary {
  body: string;
}

export type PostErrorReason = 'not-found' | 'invalid';
export class PostError extends Error {
  constructor(readonly reason: PostErrorReason, message: string) { super(message); }
}

export interface PostStore {
  list(): Promise<PostSummary[]>;
  get(id: PostId): Promise<Post>;
  create(post: { title: string; body: string }): Promise<PostId>;
  setBody(id: PostId, body: string): Promise<void>;
  setTitle(id: PostId, title: string): Promise<void>;
  delete(id: PostId): Promise<void>;
  watch(listener: () => void): () => void;
}

export { createFilePostStore } from './file/file-post-store';
```

```ts
// src/posts/file/file-post-store.ts
export function createFilePostStore(fileSystem: FileSystem): PostStore;

// src/cli/cli.ts (changes only)
const posts = createFilePostStore(fileSystem); // later: a database-backed store
const engine = await startEngine({ fileSystem, posts, /* … */ });

// src/engine/engine.ts (changes only)
export interface EngineOptions {
  fileSystem: FileSystem; // stays: app state, config, skills, and notes are not posts (F30)
  posts: PostStore;
  // …
}
```

### Why each element is here (Option A)

| Element | Justification |
| --- | --- |
| A contract (an interface), not a concrete module | G1 "an abstraction" and G2a; G5 means there are two implementations. |
| New package `src/posts/` with one entry module, `posts.ts` | G2a and G5. The database implementation will need a driver, and the engine must stay Bun-free with no I/O (F31). The precedent is the file-system package (F36). |
| `posts` imports only `file-system/file-system.ts` and `shared/` | N: G4 (it is built over today's `FileSystem`) and the one-way imports (F31). |
| The engine imports only contract symbols | G2a, F31. |
| cli builds the store and passes `posts` to `startEngine` | N: G5, because the host chooses the implementation (F31, F36). |
| `fileSystem` stays in `EngineOptions` | N: F30. App state, config, skills, and notes are not posts. |
| `PostId` is store-assigned, stable, and opaque | G3 "first class concept", where today a post is a path plus conventions (F1) and a rename changes it (F2). G5: identity cannot change after the database holds data and seven stores hold references (F26). |
| An unknown id is `not-found`, never `invalid` | N: an opaque id means a caller cannot know what a malformed id looks like. |
| `PostSummary { id, title }` | G2l. N: a listing of opaque ids needs a human label. |
| `title` is stored as given and never blank | G3 and N of G2l. One stored title ends today's drift (F4). |
| `Post { id, title, body }` | G3 (one entity) and G2e. |
| `body` is opaque markdown, unchecked by the store | N: G5. The editor-fidelity rule stays out of both adapters (F29). |
| `list()` carries no body and no promised order | G2l. N: G5, because adding later is free and removing later breaks callers. |
| `get(id)` | G2e. |
| `create({ title, body }) → PostId` | G2c. The caller supplies the body, so the store needs no markdown (F32). |
| Titles need not be unique | N: G3 and G5. Uniqueness today is an accident of folder names (F9). |
| `create` is visible to `get` and `list` once it resolves | N: G2c. The caller opens what it just made. |
| `setBody`, `setTitle` | G2e, and G2m (rename is today's main management action, F2 and F16). |
| `set*` never creates a post | N: with store-assigned ids, an upsert has no meaning. This settles OQ4 (F10). |
| Calls that change one field of a post land in call order | N: G2e. G5 requires the database to match today's ordering (F12). |
| `delete(id)` is hard | G2m; today's delete is hard (F15). |
| `watch(listener) → unsubscribe`, with no payload, possibly coalesced and possibly spurious | G2a. G5: database writes are invisible to the `FileSystem` watcher, so the post contract must carry notification itself. No payload, because the only consumer discards the detail (F19). Coalesced and spurious signals are allowed because the file implementation's watcher is lossy (F20). |
| A listener's throw is caught and logged | N: the `FileSystem` precedent. |
| `PostError` with `not-found` and `invalid` | N: the server must tell a 404 from a 400 (F17). |
| A `PostError` changed nothing; any other rejection may or may not have taken effect | N: G5. A database commit can succeed after the connection is lost. |
| `createFilePostStore(fileSystem)` is synchronous and does no I/O | G4, and the factory precedent. |

### How the file implementation maps onto today's `FileSystem`

- **PostId.** The key of the post's folder. The store never moves the folder.
- **What counts as a post.** A non-hidden folder that holds a regular file named `draft.md`.
- **body.** The text of `<id>/draft.md`.
- **title.** The value in `<id>/.post.json`, written atomically. When that file is missing, the title is the folder's
  last segment, so existing posts need no migration.
- **list.** A recursive walk that skips hidden names and does not descend into a post.
- **create.** In order:
  1. Name the folder `newEntryName(title)`, or `Untitled` when that is empty.
  2. Create it, retrying ` 2`, ` 3`, and so on while the name is taken.
  3. Write `.post.json`.
  4. Write `draft.md` last.
  5. If any step fails, make a best-effort delete of the folder.
- **setBody.** Write `draft.md`.
- **setTitle.** Rewrite `.post.json`. The folder keeps its name.
- **delete.** Delete the whole folder, including the sibling files.
- **watch.** Use `fileSystem.watch` with an ignore rule that hides dot names except `.post.json`.
- **Known gap.** A `setBody` that races a `delete` can bring the folder back (F12, inferred).

---

## Option B: a path-addressed post tree in an engine feature folder (closest to today)

The caller chooses a path, and that path is the post's identity. Folders form the namespace, and the folder's name is
the title. The contract lives in `src/engine/posts/posts.ts`.

```ts
export type PostPath = string;
export interface PostTreeEntry { path: PostPath; kind: 'post' | 'folder' }
export interface Post { path: PostPath; body: string }
export type PostErrorReason = 'invalid' | 'not-found' | 'exists';
export interface PostStore {
  list(): Promise<PostTreeEntry[]>;
  get(path: PostPath): Promise<Post>;
  create(parent: PostPath, title: string, body: string): Promise<PostPath>;
  setBody(path: PostPath, body: string): Promise<void>;
  createFolder(path: PostPath): Promise<void>;
  move(from: PostPath, to: PostPath): Promise<void>;
  delete(path: PostPath): Promise<void>;
  watch(listener: () => void): () => void;
}
```

**Justifications.**

- G4: it keeps today's identity (F2).
- G2m and F6/F7: folders are managed today.
- Taken names can collide, so it needs `exists`, which fixes the folding in F17.
- It keeps F16's move rules, minus the case-insensitive quirk.

**Why rejected.** A database would have to emulate a directory tree:

- a unique `path` column;
- a prefix rewrite on every folder move;
- a check that a folder is not moved into itself.

Identity would still change on rename. That fails G3 and goes against G5. Placing the contract in the engine also makes
the database adapter import from the engine, which is a new dependency direction (F31, F36).

---

## Option C: stable ids, named parts, collections, and typed events

Like Option A, plus three things:

- named parts per post (`draft`, `outline`, `research`; F5)
- nested collections (F6, F7)
- typed per-post change events (F19)

```ts
export interface PostSummary { id: PostId; title: string; collection: CollectionId | null }
export interface Post extends PostSummary { parts: PartName[] }
export interface Collection { id: CollectionId; name: string; parent: CollectionId | null }
export type PostEvent =
  | { type: 'post-created' | 'post-updated' | 'post-deleted'; id: PostId }
  | { type: 'collection-changed'; id: CollectionId }
  | { type: 'changed' };
export interface PostStore {
  list(): Promise<{ posts: PostSummary[]; collections: Collection[] }>;
  get(id: PostId): Promise<Post>;
  create(post: { title: string; collection: CollectionId | null; draft: string }): Promise<PostId>;
  setTitle(id: PostId, title: string): Promise<void>;
  movePost(id: PostId, collection: CollectionId | null): Promise<void>;
  delete(id: PostId): Promise<void>;
  readPart(id: PostId, part: PartName): Promise<string>;
  writePart(id: PostId, part: PartName, body: string): Promise<void>;
  deletePart(id: PostId, part: PartName): Promise<void>;
  createCollection(name: string, parent: CollectionId | null): Promise<CollectionId>;
  renameCollection(id: CollectionId, name: string): Promise<void>;
  moveCollection(id: CollectionId, parent: CollectionId | null): Promise<void>;
  deleteCollection(id: CollectionId): Promise<{ posts: number; collections: number }>;
  watch(listener: (events: PostEvent[]) => void): () => void;
}
```

**Justifications.** Option C's parts, collections, and typed events descend from G2o "otherwise handling" and
G2m "managing", and from findings about today's conventions (F5, F6, F7, F14, F19).

**Why rejected.**

- None of its additions is asked for by the goal.
- Each can be added to Option A later without breaking anyone.
- Its file mapping needs sidecar ids for collections, detection of ids duplicated by a Finder copy, and a cache that
  maps keys back to ids.

---

## Recommendation: Option A

1. **First class without baking in the file system.** Only Option A makes posts first class (G3) and keeps file-system
   assumptions out of the contract (G5). Option B keeps path identity and directory semantics. Option C carries
   conventions the goal does not ask for.
2. **The smallest contract that covers every verb in G2.** Each of its seven methods traces to a verb in G2.
3. **It settles the one choice that cannot be undone, identity, while breaking changes are free (G6, G7).**
4. **The file implementation needs no migration.** The folder key is the id, and `.post.json` is optional.
5. **Its placement follows the precedent (F36).** A database driver never touches the Bun-free engine (F31).

## Rejected alternatives

1. **Make the database a second `FileSystem` backend.** Posts stay paths (F1). The database would have to emulate
   folders, implicit creation of parent folders, glob, and case-insensitive renames.
2. **Promote `Engine['documents']` (F8) unchanged.** It carries over path identity, the upsert `write`, the folder
   operations, `count`, and the folding of `exists` into `invalid`.
3. **A single `update(id, { title?, body? })`.** The file store would need rules for an empty patch and for partial
   failure.
4. **Derive the title from the body's H1.** Both adapters would have to parse markdown, a post with no H1 would have no
   title, and renaming would mean editing content.
5. **Keep the file store's id and title in front matter.** The shared markdown has no front matter, so the editor
   would show it or drop it.
6. **Keep the file store's ids in an index file, `.3pitor/posts.json`.** A rename outside the app would orphan the
   entry.
7. **A branded `PostId`.** Every boundary would need a cast. Reopen if mixing up paths and ids causes bugs during
   integration.
8. **Option A's shape inside an engine feature folder.** The database adapter would have to import from the engine.

## Cut list

The goal asks for none of these. Each can be added later without breaking anyone unless noted.

| Cut | What it would do | Reopen trigger |
| --- | --- | --- |
| Publish status | A lifecycle state per post | A publishing feature is planned |
| Tags and categories | Labels for filtering | A feature filters by label |
| Slug or permalink | A URL-safe name | Publishing to URLs |
| `createdAt` and `updatedAt` | Timestamps on summaries | A sort-by-date or "recent" view |
| Revision with `expectedRevision` | Optimistic concurrency (F11) | OQ5 is answered "more than one writer", or a lost-update bug |
| Revision history | Past bodies of a post | A history feature |
| Trash and `restore` | Recoverable delete (F15) | A post lost to Delete |
| Pagination | Paged `list` (changing the return type later would break callers; accepted) | A measured list over budget |
| Search, filter, server-side sort | Query posts | A search box |
| Named parts (`outline`, `research`) | Sub-documents (F5) | The skills need them through the store |
| Folders, collections, series | Grouping (F6, F7) | Integration needs grouping |
| `count` | Numbers for the delete confirmation (F14) | Collections land |
| `move` | Relocate a post | Collections land |
| Typed per-post events, sequence numbers, cursors | Know which post changed (F19, F20) | A consumer needs to know which post changed |
| Callback when the watcher fails | Report a dead watcher (F20) | That bug is fixed |
| Content validation in the store | `unsupportedMarkdown` (F29) | Never in the store |
| Title rules beyond "not blank" | Refuse control characters, limit length | A title breaks the list UI |
| Transactions and batches | Atomic multi-post changes | A feature changes several posts at once |
| Idempotency key on `create` | Retry without duplicates | A database retry layer |
| Author, owner, tenant | Multi-user scoping | Multi-user hosting |
| `exists(id)` and bulk `get` | Convenience reads | A measured N+1 cost |
| Moving the AI tools and view state onto ids | F22–F26 | The integration plan (G7) |
| Wire types for posts in `shared/wire.ts` | HTTP shapes | The server routes move onto `posts` (G7, F33) |

## Deferred to `han-core:system-architect`

- **OQ5.** Whether the database has more than one writer. This decides whether revisions return before the database
  lands.
- **Cross-process change notification for a database.**
- **Migrating file workspaces into a database.**

## Questions the architect could not settle

- **Q1 (OQ1).** Is the folder key acceptable as the file store's id, with the title in `.post.json`?
- **Q2 (OQ2).** Loose `.md` files, and siblings such as `outline.md`, stop being posts. Should `delete` remove the
  siblings too?
- **Q3 (OQ3).** Do folders survive anywhere? New posts would be created at the root.
- **Q4.** Should the title be a stored field or the H1?
- **Q5.** In the file store, may a `setBody` that races a `delete` bring the post back?
- **Q6 (OQ6).** Must old chat history still resolve after a rename?
- **Q7.** Does "otherwise handling" (G2o) name a specific operation?
- **Q8.** Should titles refuse control characters or line breaks, or have a maximum length?
- **Q9.** Should the names be `PostStore` and `createFilePostStore`, or something that echoes "post management"?

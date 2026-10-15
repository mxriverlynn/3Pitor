# Chosen Option (A), with the architect's full contract comments

This is the working copy of the chosen design. Later rounds amend this file. The goal clauses (G1–G8) are defined in
[../design-options.md](../design-options.md).

```ts
// src/posts/posts.ts — the posts package: every post is created, read, changed, listed, and deleted through one
// contract, so the store behind it can be swapped. cli builds an instance and hands it to the engine. This module is
// the only one anything outside src/posts/ imports. The package imports only src/file-system/file-system.ts and
// src/shared/.

// A post's identity, assigned by the store when the post is created. It never changes for the life of the post,
// whatever happens to the title. It is opaque: callers store it and pass it back, and never build, parse, or order it.
// Any string that names no post is 'not-found'; there is no "malformed id".
export type PostId = string;

// What list() gives for each post: enough to show and pick it, without its body.
export interface PostSummary {
  id: PostId;
  // The title exactly as last given to create or setTitle. Never blank.
  title: string;
}

export interface Post extends PostSummary {
  // The post's markdown, kept exactly as given. The store checks nothing about it.
  body: string;
}

// A refusal the caller can show. Its message is one sentence fit for the user. A call that rejects with a PostError
// changed nothing.
// - not-found: no post has that id, or it was deleted.
// - invalid:   a title with no non-whitespace character.
// Any other rejection is a storage failure: the call may or may not have taken effect, and get/list say which.
export type PostErrorReason = 'not-found' | 'invalid';
export class PostError extends Error {
  constructor(readonly reason: PostErrorReason, message: string) { super(message); }
}

export interface PostStore {
  // Every post, in no promised order. Callers sort.
  list(): Promise<PostSummary[]>;

  // One post, body included. An unknown id is 'not-found'.
  get(id: PostId): Promise<Post>;

  // Makes a new post and resolves to its id. Titles need not be unique. Once this resolves, get and list include
  // it. A blank title is 'invalid'.
  create(post: { title: string; body: string }): Promise<PostId>;

  // Replaces the post's body or title. An unknown id is 'not-found'; a blank title is 'invalid'. Calls that change the
  // same field of one post take effect in call order, so the last call wins. Neither ever creates a post.
  setBody(id: PostId, body: string): Promise<void>;
  setTitle(id: PostId, title: string): Promise<void>;

  // Removes the post for good. An unknown id is 'not-found'. Afterwards get and the set* methods give 'not-found'.
  delete(id: PostId): Promise<void>;

  // Calls listener after posts change, and returns an unsubscribe that is safe to call twice.
  // - The signal carries no detail: re-list, and re-get the posts you hold.
  // - One signal may stand for many changes, and a signal may arrive when nothing visible changed.
  // - Every change made through this store is followed by a signal. A change by another writer is signalled when the
  //   implementation can see it.
  // - A throw from the listener is caught and logged, and later signals still arrive.
  // - Nothing is watched until this is called.
  watch(listener: () => void): () => void;
}

export { createFilePostStore } from './file/file-post-store';
```

```ts
// src/posts/file/file-post-store.ts — the first implementation (G4), built over today's FileSystem. It is Bun-free,
// since it touches only the FileSystem contract and src/shared/entry-name.ts. Like createLocalFileSystem, it is
// synchronous and does no I/O when called.
export function createFilePostStore(fileSystem: FileSystem): PostStore;

// src/cli/cli.ts (changes only)
const fileSystem = createLocalFileSystem(root);
const posts = createFilePostStore(fileSystem); // later: a database-backed store
const engine = await startEngine({ fileSystem, posts, appSkillFiles: APP_SKILL_FILES, serveTools, env: process.env, isOnPath });

// src/engine/engine.ts (changes only)
import type { PostStore } from '../posts/posts';
export interface EngineOptions {
  fileSystem: FileSystem; // stays: app state, config, skills, and notes are not posts (F30)
  posts: PostStore;
  // … unchanged …
}
// startEngine subscribes posts.watch(() => events.emit({ type: 'documents-changed' })) in place of the
// fileSystem.watch call at engine.ts:89. Moving Engine['documents'] and the tools onto `posts` is integration (G7).
```

## How the file implementation maps onto today's FileSystem

- **PostId.** The workspace key of the post's folder, such as `the sun` or `series/one`. The store never moves the
  folder, so the id stays stable for as long as the contract is in use.
- **What counts as a post.** A non-hidden folder that holds a regular file named `draft.md`.
- **body.** The text of `<id>/draft.md`.
- **title.** The `{ "title": … }` value in `<id>/.post.json`, written with `{ atomic: true }`.
  - If that file is missing or unreadable, the title is the folder's last segment.
  - Because of that fallback, every existing post can be read with no migration.
- **list().** A recursive walk from the workspace root using `fileSystem.list`.
  - It skips hidden names and does not descend into a folder that is itself a post.
  - A subfolder that fails with a FileSystemError is skipped.
  - A failure at the root is a plain Error.
  - It reads each post's `.post.json`.
- **get(id).** In order:
  1. `stat(<id>/draft.md)` must be `'file'`, or the call fails with `'not-found'`.
  2. A FileSystemError `'invalid'` from the key grammar also becomes `'not-found'`.
  3. It reads the draft and the sidecar.
- **create.** In order:
  1. The folder name is `newEntryName(title)`, or `Untitled` when that is empty.
  2. The folder is created at the root. If the name is taken (`'exists'`), it retries with ` 2`, ` 3`, and so on.
  3. It writes `.post.json`.
  4. It writes `draft.md` last, so a crash before this step leaves a folder that is not a post.
  5. If a step fails, it makes a best-effort `delete(folder)`.
- **setBody.** `stat`, then `fileSystem.write(<id>/draft.md, body)`.
- **setTitle.** Refuses a blank title, then runs `stat` and writes `.post.json` atomically. The folder is not renamed.
- **delete.** `stat`, then `fileSystem.delete(<id>)`. This removes the whole folder, including `outline.md` and
  `research.md`.
- **watch.** `fileSystem.watch(() => listener(), { ignore })`. The `ignore` rule matches any key with a hidden segment,
  unless the last segment is `.post.json`.
- **Errors.** A FileSystemError `'not-found'` becomes a PostError `'not-found'`. Any other error that is not a
  PostError is rethrown unchanged.
- **Known gap.** A `setBody` that races a `delete` can recreate the folder (F12, inferred).

## Why each element is here

See the justification table for Option A in [../design-options.md](../design-options.md).

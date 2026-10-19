# Design Options: Research and Outline Documents on a Post

Produced by `han-core:software-architect` from [context-brief.md](./context-brief.md). Findings are cited as F-numbers.

## Goal clauses

- **G1** "associate research documents and outline documents with a blog post"
- **G2** "both are optional"
- **G3** "a blog post can have zero or more research documents associated with it"
- **G4** "a blog post can have zero or one outline associated with it"
- **G5** "the implementation of this api will live in the post management package"
- **G6** "do not worry about actual implementation yet … i'm only setting the direction"
- **G7** "we'll handle planning the implementation and integration later"

"N:" marks an element that is a necessity of another asked-for behavior.

## Elements shared by all three options

| Element | Justification |
| --- | --- |
| The new surface lives in `src/posts/`, re-exported from `posts.ts`, Bun-free | G5. N: package import rules (F16). |
| Research belongs to exactly one post; it is never shared | G3 "associated with it". N: the delete promise (F11, F27). |
| `delete(postId)` also removes the post's research and outline; afterwards every research or outline call naming that post is `'not-found'` | N: F11, which already promises it. The wording only has to name the new data. |
| `ResearchId = string`: store-assigned, exact, stable, opaque, never reused within its post by one store instance | G3: zero or more documents need individual names. N: F28, with the same rules as `PostId` (F8). |
| A research id is scoped to its post; every research call takes `(postId, researchId)` | N: per-post ordering (F14, F20). The post id is the queue key, so research writes are ordered against the post's delete (F24). |
| A research id naming nothing under a live post is `'not-found'` (subject `research`); there is no "malformed id" | N: opaque ids (F8). |
| `ResearchSummary { id, title }` | N: G3. A list of opaque ids needs a human label to pick from. |
| A research title is never blank (`trim() === ""`); blank is `'invalid'` (subject `research`) and nothing is made | N: the label exists to identify the document, under the same rule as post titles (F13). |
| `Research extends ResearchSummary { body }`; the body is opaque markdown and round-trips `""` | G1 "documents". Same body rules as `Post.body` (F13). |
| Research listings carry no bodies | N: F31. |
| Research comes back in no promised order; callers sort | N: F30. Ids are opaque, and the rule matches `list()`. Promising an order later is additive. |
| The outline has no id; the post id names it | G4 "zero or one". N: F28. |
| "No outline" is `null`; an empty outline is `""` | G2 "optional". N: F29. |
| The outline is opaque markdown with no title | G4. Nothing asks for an outline title. |
| Writing the outline creates or replaces it; writing `null` removes it; removing an absent outline resolves and changes nothing | G4: at most one. G2: absence is a valid state to return to. |
| Outline and research calls never create a post; a missing post is `'not-found'` (subject `post`) | N: the earlier design's no-upsert rule (BC5). |
| When both the post and the research document are missing, the post's `'not-found'` wins | N: a caller told the post is gone drops everything it holds for it. |
| `PostError` gains `subject: 'post' \| 'research'`, defaulting to `'post'`. `reason` stays `'not-found' \| 'invalid'`, and the message is fixed by the pair | N: F32. Keeping `reason` closed keeps the server's 404/400 mapping (F7) and existing `new PostError(reason)` sites correct. |
| A `PostError` changed nothing; any other rejection is a storage failure | N: F12, extended to the new calls. |
| Per-post order covers every research and outline call naming a post | N: F14, F24. |
| Every new write that reaches storage signals `watch` before it settles; a `PostError` does not signal | N: F15. Watch is the only change channel. |
| `describePostStore` is widened to cover the new surface | N: F19. The future database store is held to the same rules. |

## Option A: extend `PostStore` with flat, post-id-first methods (recommended)

```ts
// A research document's identity, assigned by the store when the document is made, scoped to its post. The same
// rules as PostId (exact, stable, never reused within its post by one store instance, opaque), and any string that
// names no research document under a live post is 'not-found'. There is no "malformed id".
export type ResearchId = string;

export interface ResearchSummary {
  id: ResearchId;
  // Never blank. Exactly as given to createResearch. Independent of any H1 in the body.
  title: string;
}

export interface Research extends ResearchSummary {
  // Markdown, exactly as given. Same rules as Post.body.
  body: string;
}

export interface ResearchList {
  research: ResearchSummary[];
}

export interface PostStore {
  // ...existing members unchanged...

  listResearch(postId: PostId): Promise<ResearchList>;
  getResearch(postId: PostId, researchId: ResearchId): Promise<Research>;
  createResearch(postId: PostId, research: { title: string; body: string }): Promise<ResearchId>;
  deleteResearch(postId: PostId, researchId: ResearchId): Promise<void>;

  getOutline(postId: PostId): Promise<string | null>;
  setOutline(postId: PostId, outline: string | null): Promise<void>;
}

// post-error.ts
export type PostErrorReason = 'not-found' | 'invalid';
export type PostErrorSubject = 'post' | 'research';
export class PostError extends Error {
  constructor(readonly reason: PostErrorReason, readonly subject: PostErrorSubject = 'post') { ... }
}
```

| Element | Justification |
| --- | --- |
| The methods live on `PostStore` itself | G5. N: F20. Ordering against `delete` needs the store's queue and tombstones. |
| `listResearch(postId)` returning `ResearchList { research }` | G3. The object wrapper follows the `PostList` convention. |
| `getResearch(postId, researchId)` | N: G1. A document must be readable, and the listing has no body (F31). |
| `createResearch(postId, { title, body })` returning `ResearchId` | G1, G3. The store assigns the id (F28), and the object argument mirrors `create`. |
| `deleteResearch(postId, researchId)` | G2, G3: going back to fewer documents, or none, is valid. |
| `getOutline(postId): string \| null` | G4, G2. F29 separates `null` from `""`. |
| `setOutline(postId, string \| null)` | G4: one write creates or replaces. G2: `null` removes. |
| `…Research` / `…Outline` names, post id first | N: naming and argument conventions (F10). |
| Exposed to the engine and server through `Omit<PostStore,'watch'>` | N: F18. No route uses them yet (G7). |
| Test doubles keep working | N: F17. Spread doubles inherit the new methods. |

Existing comments change in four places:

- **Per-post order** names the research and outline calls.
- **Watch's own-writes list** adds `createResearch`, `deleteResearch`, and `setOutline`.
- **The signal hint** becomes "re-list, and re-get the posts, research, and outlines you hold".
- **`delete`** names the post's research and outline.

## Option B: a sibling `PostDocuments` interface built with the store (rejected)

```ts
export interface PostDocuments { /* the same six methods as Option A */ }
export function createFilePosts(fs: FileSystem): { posts: PostStore; documents: PostDocuments };
// createFilePostStore(fs) stays as createFilePosts(fs).posts, so existing call sites do not break.
```

| Element | Justification |
| --- | --- |
| A separate `PostDocuments` interface | Interface segregation. G5. |
| `createFilePosts` returns the pair | N: F20. Both halves must share the queue and tombstones. |
| `createFilePostStore` kept as a wrapper | N: avoids breaking the 55 existing call sites. |
| Document writes signal through `posts.watch` | N: F15. |
| A second suite, or a widened fixture | N: F19. |

**Why rejected.** The `Pick<PostStore, …>` pattern (F18) already gives each call site interface segregation. Option B
adds costs Option A does not have:

- A construction duty: the pair must come from one build, or delete ordering is silently lost.
- A second object for the host and the engine to carry.
- Signals that cross from one interface to the other.
- New `TEST_ONLY` and `EXEMPT` entries.

## Option C: a nested per-post handle (rejected)

```ts
export interface PostStore {
  // ...existing members...
  documents(postId: PostId): PostDocumentsHandle; // synchronous, no I/O; each call checks the post when it runs
}
export interface PostDocumentsHandle {
  research: {
    list(): Promise<ResearchList>;
    get(id: ResearchId): Promise<Research>;
    create(r: { title: string; body: string }): Promise<ResearchId>;
    delete(id: ResearchId): Promise<void>;
  };
  outline: { get(): Promise<string | null>; set(outline: string | null): Promise<void> };
}
```

| Element | Justification |
| --- | --- |
| `documents(postId)` handle | G1: the shape makes "associated with a blog post" visible. |
| The handle is synchronous and checks the post on each call | N: a handle to a post deleted later must fail its calls. |
| `research` and `outline` groups | G3, G4: one group per cardinality. |

**Why rejected.** It adds a second addressing style alongside id-first arguments (F10), and a handle lifecycle the
contract would have to document. Spread-based doubles (F17) would quietly copy the real store's handle factory. Its only
gain is grouping, which the shared name prefixes already give.

## Recommendation: Option A

- **F20 is met by construction.** The new writes share the post's queue and tombstones, so the delete cascade and
  per-post ordering each extend by one sentence.
- **It is the smallest change that matches the conventions** (F10, F17, F18, F19). It needs no new entry module and no
  new boundary rule.
- **What it gives up** is interface segregation at the interface level, which `Pick` already provides per call site.

## Other rejected alternatives

- **The outline as a field on `Post`.** Every `get` pays an extra read, including autosave reloads and the server's
  full-body `search()` (`posts.routes.ts:56-73`).
- **A generic attachment with a `kind`.** The two kinds differ in cardinality (G3 vs G4) and identity (F28).
- **New reasons such as `'research-not-found'`.** `posts.routes.ts:20` would answer them with 400 instead of 404.
- **Research ids unique store-wide, addressed alone.** The ordering key would have to be looked up before queueing,
  which brings back F20's race.
- **Association data in `.post.json`.** The next `setTitle` wipes it (F23).

## Cut list

- **Research shared across posts (O1).** It would let one document serve many posts. Cut: it breaks the delete promise
  (F27) and needs a link table and an orphan policy. Adding it later is breaking.
- **Editing research in place (`setResearchBody`, `setResearchTitle`).** Cut: the goal asks to associate documents;
  delete plus create covers changes. Adding it later is additive.
- **Reordering research, or a promised order.** Cut by F30; additive later.
- **Titles on outlines.** Cut: one outline per post, so the post names it.
- **Timestamps on research.** Cut for the same reason the earlier design cut post timestamps.
- **Version tokens and conditional saves.** Cut, as for posts.
- **Research counts in `PostSummary`, or research inlined into `get`.** Cut by F31.
- **Migrating legacy flat `research.md` or the root `research/` folder (F3, F34, O4).** Integration (G7).
- **Wiring into the engine, routes, agent tools, skills, and UI (F4, F5).** Integration (G7).
- **Typed per-document change events.** Signals carry no detail (F15).
- **A separate `ResearchError` class.** `PostError` with a subject is enough.
- **A branded `ResearchId`.** Same reason as the unbranded `PostId`.

## How each store would meet Option A (direction only)

- **File store.**
  - The outline is `outline.md` in the post folder, which already matches today's data (F2). `null` means the file is
    absent.
  - Research is a non-hidden `research/` subfolder with one `.md` per document (F21).
  - Research titles live in metadata the watcher sees (F25).
  - Every call runs through the post's queue and post check (F24) and signals through `changing()`.
  - The recursive delete already cascades (F11).
- **Database store.**
  - `research(post_id FK ON DELETE CASCADE, id, title, body)`.
  - The outline is a nullable column, or a table keyed by `post_id` (F33).
  - No ordering column is needed.

## Open questions that would change the contract

1. Can research be shared between posts? (O1)
2. Do research documents carry a stored title, or is the body's H1 their label? (O2)
3. Is "no outline" truly different from an empty outline? (O3)
4. Must a research document be addressable by its own id alone, for example from agent references at integration?

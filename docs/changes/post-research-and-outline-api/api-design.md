---
goal: "to associate research documents and outline documents with a blog post. both are optional. a blog post can have zero or more research documents associated with it. a blog post can have zero or one outline associated with it. the implementation of this api will live in the post management package. do not worry about actual implementation yet, though, i'm only setting the direction for now. we'll handle planning the implementation and integration later."
goal_source: "described in conversation (/han-coding:design-an-api, 2026-10-19)"
interface: "Eight new methods on PostStore in src/posts/posts.ts for a post's research documents (zero or more) and outline (zero or one), plus a required subject on PostError in src/posts/post-error.ts"
size: "medium"
size_reason: "A data-contract signal (the links are persisted data a database store will hold) and a consumer-spread signal (PostStore is imported by the engine, server, and cli)."
roster: "han-core:codebase-explorer, han-core:data-engineer, han-core:structural-analyst, han-core:software-architect, han-core:junior-developer, han-core:adversarial-validator"
starting_point: "working tree (identical to main at 7b6d459; branch post-research-and-outline-api)"
git_available: "yes"
---

# API Design: Research Documents and an Outline on a Post

## Summary

`PostStore` gains eight methods, and every one takes the post id first:

- Six methods manage a post's **research documents**: list, get, create, set body, set title, and delete. A research
  document has a store-assigned id, a title, and a markdown body.
- Two methods manage its **outline**: `getOutline` and `setOutline`. The outline is plain markdown, or `null` when the
  post has none.

Research documents belong to one post and are deleted with it. Every new call is ordered with the post's other calls
and signals `watch` the same way. `PostError` gains a required `subject` (`'post'` or `'research-document'`), so a
missing research document gets its own message instead of "That post no longer exists."

- **Option chosen.** Option A, which puts the methods on `PostStore` itself. It was chosen over two others:
  - Option B, a sibling `PostDocuments` interface built alongside the store.
  - Option C, a per-post handle (`store.documents(postId).research.list()`).

  Only Option A orders research and outline writes against the post's `delete` by construction. It also needs no new
  module or boundary rule.
- **Decisions at the gates.** Your standing instruction for planning runs here is "make the best decisions you can,
  without asking me". Under it, this run settled the option gate (D1) and seven open questions (D2–D11) itself. Each
  decision is in [artifacts/decision-log.md](./artifacts/decision-log.md). Three are worth checking:
  - **D7 goes beyond the goal.** Research documents can be edited in place (`setResearchDocumentBody`,
    `setResearchDocumentTitle`). Your goal says "associate", and the validator flagged this as more than that. It is
    kept because deleting and re-creating a document changes its id and is not one atomic step. If you want
    attach-only, cut these two methods.
  - **D6:** the `subject` on `PostError` is required, so all 21 existing `new PostError(reason)` calls gain `'post'`.
  - **D8:** names use your words, "research document": `ResearchDocument`, `listResearchDocuments`, and so on.
- **Validation outcome.** The adversarial validator found no design-breaking defect. All 11 of its findings were
  accepted, V2 only in part. The biggest change: in the file store, each research document became its own exclusively
  claimed subfolder, so two writers can never overwrite each other's document.
- **Omitted domains.** None. The band cap left no signalled domain out.

## The Goal This Serves

> to associate research documents and outline documents with a blog post. both are optional. a blog post can have zero
> or more research documents associated with it. a blog post can have zero or one outline associated with it. the
> implementation of this api will live in the post management package. do not worry about actual implementation yet,
> though, i'm only setting the direction for now. we'll handle planning the implementation and integration later.

Source: described in conversation, 2026-10-19. The justifications below cite these clauses:

- **G1** "associate research documents and outline documents with a blog post"
- **G2** "both are optional"
- **G3** "a blog post can have zero or more research documents associated with it"
- **G4** "a blog post can have zero or one outline associated with it"
- **G5** "the implementation of this api will live in the post management package"
- **G6** "do not worry about actual implementation yet … i'm only setting the direction"
- **G7** "we'll handle planning the implementation and integration later"

## The Designed Contract

### Surface

`src/posts/posts.ts`, with the changed and added members shown. Members not shown stay as they are, apart from the
comment edits listed under [Changes to existing text](#changes-to-existing-text).

```ts
// A research document's identity, assigned by the store when the document is made. It names a document only together
// with its post: a research document's identity is the pair (postId, researchDocumentId), and anything that keeps a
// reference to a research document must keep both. Ids are unique only within their post: two posts may each have a
// research document with the same id. Within its post it follows the same rules as PostId:
// - Exact: a string names a document only when listResearchDocuments(postId) would return exactly that string, code
//   unit for code unit. A variant in letter case, Unicode form, or spacing names no document. "" never names one.
// - Stable: no call on this contract changes it, whatever happens to the document's title or body.
// - Never reused: a store instance never gives out, within one post, an id it has given out before in that post, even
//   after that document is deleted. A deleted post's id is never reused either. So, through one store instance, a
//   stale pair can never reach a later document. Reuse across store instances (a restart, another process) is not
//   promised against.
// - Opaque: callers store it and pass it back. They never build, parse, order, or show it.
// Any string that names no research document of a found post is 'not-found' (subject 'research-document'). There is
// no "malformed id".
export type ResearchDocumentId = string;

// What listResearchDocuments gives for each research document: enough to show and pick it, without its body. It has no
// postId field, because every call that returns it was given the post id.
export interface ResearchDocumentSummary {
  id: ResearchDocumentId;
  // Never blank. The title exactly as last given to createResearchDocument or setResearchDocumentTitle. For a document
  // this store never titled (one another writer made), a title the store derives. The title is the only key callers
  // sort by: research documents carry no timestamp or position. Titles need not be unique, and nothing is promised
  // about the order of documents with equal titles: it may differ from one call to the next. Independent of any H1 in
  // the body; the two can disagree.
  title: string;
}

export interface ResearchDocument extends ResearchDocumentSummary {
  // The document's markdown, exactly as last given. Same rules as Post.body: the store checks nothing about it, never
  // reads or writes a heading in it, and any string inside the contract round-trips, including "".
  body: string;
}

// What listResearchDocuments resolves to. An object, like PostList, so fields can be added later without breaking
// callers. There is no paging.
export interface ResearchDocumentList {
  researchDocuments: ResearchDocumentSummary[];
}

// Per-post order. Calls that name one post id through one store take effect in the order they were made, whether or
// not the caller awaits between them. That covers get, setBody, setTitle, delete, and every research document and
// outline call naming that post, listResearchDocuments included. So setOutline then delete leaves no post and no
// outline, a createResearchDocument made after a delete is 'not-found', and a getResearchDocument made after a
// setResearchDocumentBody sees that body. list() is not ordered against them. Calls through different store
// instances, or from other processes, have no promised order.
//
// Failures. A rejection with a PostError changed nothing; its subject says what was refused, the post or one of its
// research documents. Any other rejection, of any type, is a storage failure: the call may or may not have taken
// effect, and the matching get or list says which.
//
// Precedence. A blank title is checked before any I/O. So createResearchDocument or setResearchDocumentTitle with a
// blank title is 'invalid' (subject 'research-document') even when the post or the document is missing. Otherwise a
// missing post wins: a call naming a post that does not exist is 'not-found' (subject 'post'), whatever research
// document id it names. 'not-found' with subject 'research-document' means the post was found when checked and the
// research document was not.
export interface PostStore {
  // ...list, get, create, setBody, setTitle unchanged...

  // Removes the post, and everything the store keeps for it, for good: its body, its title, its research documents,
  // and its outline. An id that names no post is 'not-found'. Through this store, once a delete takes effect, every
  // later call naming that id is 'not-found', post and research document and outline calls alike. No later call
  // brings the post, its research documents, or its outline back, or gives its id to another post.
  delete(id: PostId): Promise<void>;

  // Every research document of the post that exists for the whole of the call, each once, without bodies, in no
  // promised order. Callers sort, by title. Unlike list(), this call is ordered with the post's other calls (see
  // Per-post order), and it rejects 'not-found' (subject 'post') when the post id names no post. It never rejects
  // with subject 'research-document'. A post with no research documents resolves to { researchDocuments: [] }. It
  // never includes an id this store has deleted in that post, even if another writer makes a document there later.
  // A document another writer adds or removes while the call runs may or may not appear.
  listResearchDocuments(postId: PostId): Promise<ResearchDocumentList>;

  // One research document of the post, body included. A post id that names no post is 'not-found' (subject 'post').
  // An id that names no research document of that post is 'not-found' (subject 'research-document').
  getResearchDocument(postId: PostId, researchDocumentId: ResearchDocumentId): Promise<ResearchDocument>;

  // Makes a new research document on the post and resolves to its id, an id listResearchDocuments(postId) returns.
  // Titles need not be unique within a post. Once this resolves, getResearchDocument and listResearchDocuments include
  // it. It never creates a post. A blank title is 'invalid' (subject 'research-document') and nothing is made; this is
  // checked first, even when the post is missing. Otherwise a post id that names no post is 'not-found' (subject
  // 'post').
  createResearchDocument(postId: PostId, researchDocument: { title: string; body: string }): Promise<ResearchDocumentId>;

  // Replace one field of a research document and leave the other alone. The document's id does not change. Neither
  // call creates a post or a research document. A post id that names no post is 'not-found' (subject 'post'), and a
  // document id that names no research document of that post is 'not-found' (subject 'research-document'). A blank
  // title is 'invalid' (subject 'research-document'), checked before either. Once the call resolves,
  // getResearchDocument returns the new value.
  setResearchDocumentBody(postId: PostId, researchDocumentId: ResearchDocumentId, body: string): Promise<void>;
  setResearchDocumentTitle(postId: PostId, researchDocumentId: ResearchDocumentId, title: string): Promise<void>;

  // Removes one research document of the post for good. Through this store, once it takes effect, every later call
  // naming that pair is 'not-found' (subject 'research-document'), listResearchDocuments never includes that id
  // again, and the id is never given to another document in that post. All of this holds even if another writer makes
  // a document with that id later. A post id that names no post is 'not-found' (subject 'post'). A document id that
  // names no research document of that post is 'not-found' (subject 'research-document'). Unlike removing an absent
  // outline, this is a refusal, because an id that names nothing is always 'not-found'.
  deleteResearchDocument(postId: PostId, researchDocumentId: ResearchDocumentId): Promise<void>;

  // The post's outline: its markdown, exactly as last given, or null when the post has no outline. An empty outline
  // ("") is not null: "" is an outline with no text, and null is no outline. Same body rules as Post.body. The outline
  // has no title and no id, because the post names it. A post id that names no post is 'not-found' (subject 'post').
  getOutline(postId: PostId): Promise<string | null>;

  // Sets the post's outline. A string creates the outline or replaces the whole of it, and "" is stored as an empty
  // outline. null removes it. Removing an absent outline resolves, changes nothing, and does not fail (it may still
  // signal; see watch). Never creates a post: a post id that names no post is 'not-found' (subject 'post'). An outline
  // is never 'invalid'. Once the call resolves, getOutline returns the new value.
  setOutline(postId: PostId, outline: string | null): Promise<void>;

  // watch: unchanged except the signal hint and the own-writes list (see "Changes to existing text", items 7 and 8).
  watch(listener: () => void): () => void;
}

export { PostError, type PostErrorReason, type PostErrorSubject } from './post-error';
export { createFilePostStore } from './file/file-post-store';
```

`src/posts/post-error.ts`:

```ts
// A refusal the caller can show as is. The message is fixed by the pair (subject, reason), so it carries no id, title,
// path, or storage detail. This module imports nothing, so the engine may import it as a value and recognize a refusal
// with `error instanceof PostError`. Reading `.reason` alone is not enough. FileSystemError also has 'not-found' and
// 'invalid' reasons. And a 'not-found' with subject 'research-document' says the post was found when checked, not that
// the post is gone.
// - 'not-found': the id names nothing. With subject 'post', the post id names no post (never given out, deleted, or not
//   one list() could return). With subject 'research-document', the post was found when checked, and the research
//   document was not: the research document id names no research document of it.
// - 'invalid': an argument the store refuses. Today that is only a blank title, of a post (subject 'post') or of a
//   research document (subject 'research-document'). An outline is never refused as invalid.
export type PostErrorReason = 'not-found' | 'invalid';

// What was refused. The outline has no subject of its own: the post names it, so an outline call's only refusal is
// 'not-found' with subject 'post'.
export type PostErrorSubject = 'post' | 'research-document';

const MESSAGES: Record<PostErrorSubject, Record<PostErrorReason, string>> = {
  post: { 'not-found': 'That post no longer exists.', invalid: 'A post needs a title.' },
  'research-document': {
    'not-found': 'That research document no longer exists.',
    invalid: 'A research document needs a title.',
  },
};

export class PostError extends Error {
  // subject is required, with no default, so a research path that leaves it out fails to compile instead of showing
  // the post's message.
  constructor(readonly reason: PostErrorReason, readonly subject: PostErrorSubject) {
    super(MESSAGES[subject][reason]);
  }
}
```

### Invariants

- **Ownership.** A research document belongs to exactly one post and is never shared. Deleting a post removes its
  research documents and its outline. After that delete, every call naming the post is `'not-found'` (subject `post`).
- **Cardinality.** A post has zero or more research documents and zero or one outline. A write to the outline either
  creates it or replaces it, so a post can never have two.
- **Research document identity.** The identity is the pair (post id, research document id), and any stored reference
  holds both. Ids are store-assigned, exact, stable across title and body changes, and opaque. They are unique only
  within their post.
- **No reuse after delete.** Within a post, through one store instance, a research document id is never reused.
  Once deleted, that id is never listed or reached again, even if another writer recreates it. Reuse across store
  instances (a restart, another process) is not promised against, as for posts.
- **The outline has no id or title.** It is `null` when absent and `""` when present but empty, and those are
  different states.
- **Order.**
  - `listResearchDocuments` promises no order. Callers sort by title, the only sort key.
  - Nothing is promised about the order of documents with equal titles.
  - Bodies never appear in a listing, and research is never inlined into `Post` or `PostSummary`.
- **Per-post order.** Every research document and outline call naming a post takes effect in call order with that
  post's `get`, `setBody`, `setTitle`, and `delete`. That includes `listResearchDocuments`, unlike `list()`.
- **Read after write.** Once a research or outline mutator resolves, the matching get returns the new value.
- **Signals.** Every new write that reaches storage signals `watch` before its promise settles. A `PostError` does not
  signal. A call that changes nothing may signal. Signals still carry no detail. Other writers' changes are visible and
  signalled "if the implementation can see it".
- **No upsert.** Research and outline calls never create a post.

### Failure Behavior

Every implementation behaves this way. The earlier design's Failure Behavior table
(`docs/changes/post-management-api/api-design.md:350-366`) covers only the post methods. This table covers the eight new
ones. The earlier table's watch rows still apply to signals the new methods cause:

- listener throws
- starting to watch fails
- unsubscribing twice

"Storage failure" means a rejection that is not a `PostError`.

**Order of checks for every new call.** The first check that fails decides the refusal:

1. **Blank title.** Title-taking calls only, checked before any I/O.
2. **Post missing.**
3. **Research document missing.** Calls that take a pair only.

| Condition | Methods | Refusal (reason, subject, message) | Precedence | Signals |
| --- | --- | --- | --- | --- |
| Blank title (`title.trim() === ""`) | createResearchDocument, setResearchDocumentTitle | `invalid`, `research-document`, "A research document needs a title." Nothing is made or changed. | First, before any I/O. Wins even when the post or the document is missing (D9). | No |
| Post id is `""`, never given out, a variant (letter case, Unicode form, spacing), or deleted by this store | all eight | `not-found`, `post`, "That post no longer exists." Nothing changes. | Second. Wins over any research document id (D9). | No |
| Call queued behind a `delete` of the same post (same store) | all eight | `not-found`, `post` | Second. Holds because post ids are never reused through one store. | No |
| Research id is `""`, never given out in that post, another post's id, or a variant, under a found post | getResearchDocument, setResearchDocumentBody, setResearchDocumentTitle, deleteResearchDocument | `not-found`, `research-document`, "That research document no longer exists." Nothing changes. | Third. Only after the post is found. | No |
| Research id deleted by this store, including when another writer later recreated it | the four above; listResearchDocuments | The four reject `not-found`, `research-document`. The list leaves the id out. | Third | No |
| Call queued behind a `deleteResearchDocument` of the same pair (same store) | the four above | `not-found`, `research-document` | Third | No |
| Post has no research documents | listResearchDocuments | None. Resolves `{ researchDocuments: [] }`. | n/a | n/a (read) |
| Title equals another research document's title in the post | createResearchDocument, setResearchDocumentTitle | None. Succeeds, and create gives a new id. | n/a | Yes |
| Post has no outline | getOutline | None. Resolves `null`. | n/a | n/a (read) |
| Post has no outline | setOutline(null) | None. Resolves and changes nothing. | n/a | May |
| Any outline string, including `""` | setOutline | Never `invalid`. | n/a | Yes |
| Storage refuses or fails the act (EACCES, ENOSPC, a lost DB connection) | all eight | Storage failure, rethrown unchanged. A mutator may or may not have taken effect; get and list say which. | After any refusal above that already applied | Mutators: yes, since the change may have landed. Reads: no. |
| A string outside the contract (lone surrogate, NUL) | createResearchDocument, setResearchDocumentBody, setResearchDocumentTitle, setOutline | Not promised. A store may store it, change it, or fail. | n/a | n/a |

## Why Each Element Is Here

The E-numbers match the architect's rounds in [artifacts/amended-design.md](./artifacts/amended-design.md). "N:" marks a
necessity of another asked-for behavior. D-numbers are decisions in
[artifacts/decision-log.md](./artifacts/decision-log.md). Q-numbers are questions from the question round. V-numbers are
validation findings.

| Element | What it does | Justification |
| --- | --- | --- |
| Methods on `PostStore`, in `src/posts/`, re-exported from `posts.ts`, Bun-free (E1, E2, E44) | Puts the surface where the posts contract already is | G5. N: package import rules (F16). N: ordering against `delete` needs the store's queue and tombstones (F20). D1. |
| One owning post per research document (E3) | No sharing between posts | G3 "associated with it". N: the delete promise (F11, F27). D3. |
| `delete(postId)` cascade wording (E4) | Names the research documents and outline among what a delete removes | N: F11, which already promises "everything the store keeps for it". |
| `ResearchDocumentId` (E5, E8) | Store-assigned, exact, stable, opaque id; never reused within its post through one store instance; anything else is `'not-found'` | G3: many documents need individual names. N: `PostId` rules (F8, F28, `posts.ts:13-15`). D8. V5. |
| The pair identity (E6, E7) | Every research call takes `(postId, researchDocumentId)`, post id first | D2. N: per-post ordering keyed by post id (F14, F20, F24). N: argument order convention (F10). |
| `ResearchDocumentSummary { id, title }` (E9) | What a listing shows for each document | N: G3, because a list of opaque ids needs a label. D2 (no `postId` field), D8. |
| Never-blank research title (E10, E11, E12) | Blank is `'invalid'`; another writer's document gets a derived title; independent of the body's H1 | D4, D10. N: the post title rule (F13). |
| `ResearchDocument { …, body }` (E13) | One document with its markdown | G1 "documents". N: body rules (F13). |
| `ResearchDocumentList { researchDocuments }` (E14) | Object wrapper for the listing | G3. N: the `PostList` convention (F9). D8. |
| No bodies in listings (E15) | Keeps listings small | N: F31. |
| No promised order; title is the sort key; no tie-break (E16, E53) | Callers sort by title | N: opaque ids cannot be ordered (F30, F8). Q9. V7. |
| `listResearchDocuments(postId)` (E37, E30, E56) | Lists a post's documents, ordered with the post's calls, rejecting only for a missing post | G3. Q11. N: F14. V10. |
| A deleted research id is never listed or reached again (E52) | Keeps "the list returned it" equivalent to "get will find it" | V1. N: `walk()` drops deleted post ids (`file-post-store.ts:138`). |
| `getResearchDocument(postId, id)` (E38) | Reads one document with its body | N: G1, since a document must be readable and listings carry no body (F31). |
| `createResearchDocument(postId, { title, body })` (E39) | Adds a document and returns its id | G1 "associate", G3. N: store-assigned ids (F28), the `create` argument shape (F10). |
| `setResearchDocumentBody`, `setResearchDocumentTitle` (E35, E36) | Edit a document in place without changing its id | D7, Q7: delete plus create changes the id (breaking D2's references) and is not atomic; posts and the outline are editable. **Goes beyond the goal (V2, R15).** |
| `deleteResearchDocument(postId, id)` (E40) | Removes one document | G2, G3: going back to fewer documents, or none, is a valid state. |
| No outline id (E17) | The post id names the outline | G4 "zero or one". N: F28. |
| `getOutline(postId): string \| null` (E41, E18) | Reads the outline; `null` for none, `""` for empty | G4, G2. N: bodies round-trip `""` (F29). D5. |
| `setOutline(postId, string \| null)` (E42, E20, E19) | Creates or replaces; `null` removes; removing an absent outline never fails; never `'invalid'` | G4: at most one. G2: absence is a state to return to. V6. |
| No upsert (E21) | Research and outline calls never create a post | N: the earlier design's BC5 and I8. |
| Precedence: blank title, then post, then document (E22, E23, E54) | Decides which refusal a caller sees | D9, matching `create` (`docs/changes/post-management-api/api-design.md:357`). V9. |
| `PostErrorSubject` (E24) | Says whether the post or a research document was refused | N: otherwise a missing document shows "That post no longer exists." (F32). D8. |
| `subject` is required (E25) | A research path that forgets it fails to compile | D6. |
| `reason` stays `'not-found' \| 'invalid'` (E26) | Keeps the server's 404/400 mapping correct | N: `src/server/posts/posts.routes.ts:20` maps by reason (F7). |
| Two new messages (E27) | "That research document no longer exists." and "A research document needs a title." | Q4. N: F32. |
| Failure rule (E28) | A `PostError` changed nothing; anything else is a storage failure | N: F12. |
| Per-post order covers the new calls (E29) | Orders research and outline writes with the post's delete | N: F14; a write after a delete would recreate the folder (F24). |
| Read after write (E31) | A resolved mutator is visible to the next get | N: `posts.ts:64-69`. |
| Signals (E32, E33, E34) | New writes signal; no-op calls may; other writers per what the store can see | N: watch is the only change channel (F15). Q3. D10. |
| Contract suite widened (E47) | `expectRefusal(promise, reason, subject)` plus research and outline cases | N: every implementation is held to one suite (F19). |
| Strings paragraph covers outlines (E48) | NUL and lone surrogates are outside the contract | N: F13. |
| Method set (E49) | The set for this direction; removing one later is breaking once a second store exists | D11. G6, G7. |
| BC3 and I10 amendments (E50, E51) | Make `outline.md` and research documents addressable; list all four messages | Q13. N: F22, E26, E27. |
| Separate failure table (E55) | The new methods' failures in one place | V10. |

## Options Considered

### Option A: extend `PostStore` with flat, post-id-first methods (chosen)

The methods sit on `PostStore` itself. That gets the hardest requirement for free: research and outline writes share
the post's queue and tombstones, so they are always ordered against the post's `delete` (F20, F24). It follows the
package's conventions:

- id-first arguments (F10)
- one contract suite (F19)
- spread-based test doubles (F17)
- automatic exposure to the engine through `Omit<PostStore,'watch'>` (F18)

It needs no new entry module and no new boundary rule. What it gives up is interface segregation at the interface
level. `Pick<PostStore, …>` already gives that per call site (`src/engine/chat/tools/tools.ts:79`).

### Option B: a sibling `PostDocuments` interface (rejected)

```ts
export interface PostDocuments { /* the same methods as Option A */ }
export function createFilePosts(fs: FileSystem): { posts: PostStore; documents: PostDocuments };
```

Rejected. It adds four costs that Option A avoids:

- The pair must come from one build, or delete ordering is silently lost.
- The host and the engine have a second object to carry.
- Signals cross from one interface to the other.
- It needs new boundary-test exemptions.

Its only gain is a smaller interface, and `Pick` already gives that.

### Option C: a nested per-post handle (rejected)

```ts
documents(postId: PostId): {
  research: { list(); get(id); create(r); delete(id) };
  outline: { get(); set(outline) };
};
```

Rejected for three reasons:

- It adds a second addressing style beside id-first arguments.
- It brings a handle lifecycle the contract would have to document.
- Spread-based test doubles would quietly copy the real store's handle factory.

Its only gain is grouping, which the shared name prefixes already give.

### Other alternatives rejected

- **The outline as a field on `Post`.** Every `get` would pay an extra read, including the server's full-body search.
- **A generic attachment with a `kind`.** The two kinds differ in cardinality (G3 vs G4) and in identity (F28).
- **New reasons such as `'research-not-found'`.** `posts.routes.ts:20` would answer them with 400 instead of 404.
- **Research ids unique across the store, addressed alone.** The post id would have to be looked up before queueing,
  which brings back F20's race.
- **Association data in `.post.json`.** The next `setTitle` rewrites the file whole and wipes it (F23).

## Questions Resolved

Under your standing instruction, the run lead settled every open question. Details are in
[artifacts/question-round.md](./artifacts/question-round.md).

| # | Question | Answer | Source |
| --- | --- | --- | --- |
| Q1 | Is a research id meaningful alone, or is the identity the pair? | The pair; stored references keep both. | Decision D2 |
| Q2 | Are O1–O3 (sharing, titles, null vs empty) decided? | No sharing; stored titles; `null` ≠ `""`. | Decisions D3, D4, D5 |
| Q3 | Does a `setOutline` that changes nothing signal? | It may; the suite asserts nothing. | F15 (`posts.ts:90-91`) |
| Q4 | What are the research messages, and which texts change? | Two new messages; `post-error.ts`, the suite table, and the earlier I10 change. | F12, F32 |
| Q5 | Why does `subject` default to `'post'`? | It does not; it is required. | Decision D6 |
| Q6 | How does an HTTP client tell "post gone" from "document gone"? | Integration's problem; open risk R1. | Goal (G7) |
| Q7 | Is "no editing research" acceptable when the outline is editable? | No; in-place editing is added. | Decision D7 |
| Q8 | What do `Research` and `ResearchList.research` hold? | Renamed to "research document" throughout. | Decision D8 |
| Q9 | What can callers sort by? | Title only, on purpose; a timestamp is additive later. | F30 |
| Q10 | Missing post plus blank title on create: which error wins? | `'invalid'`, checked before I/O. | Decision D9 |
| Q11 | Is `listResearchDocuments` ordered with the post, and can it reject? | Yes to both, unlike `list()`. | F14 |
| Q12 | Do other writers' research documents appear, and with what title? | Yes, with a derived, never-blank title. | Decision D10 |
| Q13 | Why does `outline.md` become visible while `research.md` stays hidden? | Accepted for the file-store mapping; BC3 is amended. | Goal (G7), F34 |
| Q14 | How much must a caller re-read after a signal? | Signals stay detail-free; open risk R4. | F15 |
| Q15 | Does the method set match its first consumer? | Direction only; delete and `setOutline(null)` descend from G2. | Goal (G6, G7), Decision D11 |

## Validation Findings

Details are in [artifacts/validation-dispositions.md](./artifacts/validation-dispositions.md).

| # | Finding | Disposition | What changed |
| --- | --- | --- | --- |
| V1 | `listResearchDocuments` could list a deleted id that another writer recreated, while `get` refuses it. | Accepted | The list and `deleteResearchDocument` now say a deleted id is never listed or reached again. File-store tombstones are keyed `${postId}/research/${id}`. Suite cases added. |
| V2 | In-place editing (D7) is not justified by the goal, and D11 contradicted itself. | Accepted in part | Editing kept, re-justified on Q7 only and flagged to you (R15). D11 reworded. |
| V3 | Title-derived file ids written with plain writes cannot keep the id rules across processes or on case-insensitive disks. | Accepted | Each research document is its own subfolder, claimed with `createFolder` and named with `folderName`, like posts. |
| V4 | "Body writes are atomic" was false. | Accepted | Corrected: bodies use the default write, like `draft.md`. Only title metadata is atomic. |
| V5 | "A stale pair can never reach a later document" overclaimed. | Accepted | Qualified to "through one store instance"; risks R11 and R12 added. |
| V6 | Several file-store states were undefined. | Accepted | Each is defined in [Store direction](#store-direction): `research` as a file, non-file `outline.md`, removing an absent outline, which entries count, create order. |
| V7 | The order of documents with equal titles was undefined. | Accepted | The contract promises nothing for ties; ids stay opaque; risk R13 added. |
| V8 | Orphan title sidecars. | Accepted | Resolved by V3: title and body share one folder. |
| V9 | "means the post still exists" overstated what a not-found can know. | Accepted | Now "the post was found when checked". |
| V10 | The earlier Failure Behavior table no longer covered every method. | Accepted | The new methods have their own table, and the earlier design gets a pointer to it. |
| V11 | Discovery labels collided with decision numbers. | Accepted | The brief's labels are renamed DE-n, SA-n, and CE-n. |

## Cut List

You can put any of these back; your direction then becomes its justification.

- **One research document shared by several posts.** Cut because it breaks the delete promise (F27) and needs a link
  table and an orphan policy (D3). Adding it later is a breaking change.
- **Reordering research, or a promised order.** Cut because ids are opaque and callers sort by title (F30, Q9). It can
  be added later without breaking anyone.
- **A tie-break order for equal titles.** Cut because ids are opaque and must not be ordered (V7, F8). A position or
  timestamp field can add it later.
- **A title on the outline.** Cut because there is one outline per post and the post names it (G4).
- **Created and updated timestamps on research.** Cut for the same reason the earlier design cut post timestamps. They
  can be added later.
- **Version tokens or conditional saves to catch lost updates.** Cut, as for posts.
- **A research count on each post in the post list, or research inlined into `get`.** Cut because the listing must stay
  small and `get` would grow with every document (F31).
- **A `postId` field on each research summary.** Cut because every call already takes the post id (D2).
- **Research ids unique across the whole store.** Cut because the pair is the identity (D2). Risk R11 covers the cost.
- **Atomic body writes for outlines and research documents.** Cut to match `draft.md` (V4).
- **Making old flat `research.md` files and the root `research/` folder visible.** Left to integration (G7, F3, F34).
- **Wiring into the engine, server routes, wire types, agent tools, skills, and UI.** Left to integration (G7). Per D11,
  integration planning confirms the method set before a second store exists.
- **Change signals that say what changed.** Cut because signals carry no detail (F15).
- **A separate error class for research documents.** Cut because `PostError` with a required subject is enough.
- **A branded `ResearchDocumentId` type.** Cut, as for `PostId`.
- **A `'post'` default for the error subject.** Cut because a forgotten subject would show the post's message (D6).

## Store Direction

This is direction only, to inform implementation planning. It binds no implementation.

### File store

**Every new call:**

- **Queue.** It runs on the post id's existing queue (`enqueue(postId, …)`, `src/posts/file/file-post-store.ts:50`) and
  starts with `locatePost(postId)`. So deleted and missing posts are `'not-found'` (`post`), and every write is ordered
  against `delete` (F20, F24).
- **Signals.** Mutators run inside `changing()`, so they signal like post writes.

**Outline:**

- **Where it lives.** `outline.md` in the post folder, which matches today's data (F2). It counts only when the post
  folder's listing shows it as a regular file, checked the way `draft.md` is.
- **`getOutline`.** No entry, a folder, or a link resolves `null`.
- **`setOutline(string)`.** Uses the default `write`, like `draft.md`. If something that is not a file sits at
  `outline.md`, the call is a storage failure. The store never removes an item it did not make.
- **`setOutline(null)`.** Checks the listing first. It deletes only a regular `outline.md`; otherwise it resolves and
  changes nothing.

**Research documents:**

- **Layout.** `<post>/research/` holds one non-hidden subfolder per document. The subfolder's listed name is the
  `ResearchDocumentId`. Each subfolder holds:
  - `document.md`, the body, written with the default `write`.
  - `.research.json`, `{ "title" }`, written whole with `{ atomic: true }`, like `.post.json`.
- **What counts.** A child of `research/` is a document only when every one of these holds:
  - it is a non-hidden folder (links are never followed)
  - it holds a regular `document.md`
  - the key grammar accepts its name
  - it is not deleted (tombstoned) by this store

  Anything else is not listed, is `'not-found'` (`research-document`), and is deleted with the post.
- **`research` that is not a folder.** If `research` is absent, a file, or a link:
  - `listResearchDocuments` resolves `[]`.
  - Pair calls are `'not-found'` (`research-document`).
  - `createResearchDocument` is a storage failure.
- **Create.** Five steps:
  1. Ensure `research/` exists.
  2. Claim `research/<candidate>` exclusively with `createFolder`. The candidate comes from `folderName(title)`:
     `newEntryName`, a cut to 200 UTF-8 bytes, and `Untitled` as the fallback (`file-post-store.ts:23`). Try ` 2`,
     ` 3`, and so on when the name exists, and skip deleted ids. Resolve the listed name the way `listedName` does.
  3. Write `.research.json`.
  4. Write `document.md` last, so a half-made document is never listed.
  5. On failure, remove the subfolder only if it holds nothing but those two files.
- **Edits and deletes.**
  - `setResearchDocumentTitle` rewrites `.research.json` and never renames the folder, so the id stays stable.
  - `setResearchDocumentBody` rewrites `document.md`.
  - `deleteResearchDocument` deletes the subfolder recursively and records `${postId}/research/${id}` as deleted, the way
    `delete` does (`file-post-store.ts:263-273`). An empty `research/` stays and lists `[]`.
- **Derived title.** If `.research.json` is missing, unreadable as JSON, lacks a string `title`, or has a blank one, the
  title is the subfolder name, else `Untitled`. This mirrors `titleOf` (`file-post-store.ts:147-165`).
- **Watch.** `ignoreForWatch` (`file-post-store.ts:39-42`) is widened so `.research.json` gets through, like
  `.post.json` (F25).
- **Post delete.** The existing recursive delete removes `outline.md` and `research/`.

**File-store failure rows**, in addition to the contract table:

| Condition | Methods | Caller observes |
| --- | --- | --- |
| `outline.md` is a folder or a link | getOutline / setOutline(null) / setOutline(string) | `null` / resolves, nothing changes / storage failure |
| `research` is a file or a link | listResearchDocuments / pair calls / createResearchDocument | `[]` / `'not-found'` (`research-document`) / storage failure |
| A research subfolder lacks a regular `document.md` | all research calls | Not a document: not listed, `'not-found'` |
| The title's name is taken, or collides by letter case | createResearchDocument | A ` 2`, ` 3` suffix on the id |
| The title has no usable characters | createResearchDocument | Succeeds. The id is `Untitled` (or `Untitled 2`, and so on); the title is stored as given. |
| Another writer deletes the subfolder between the check and the write | setResearchDocumentBody, setResearchDocumentTitle | Known gap: `write` recreates the parent folders (F24). Not reachable through one store. |

### Database store

- **Research table.** `research_documents(post_id FK ON DELETE CASCADE, id, title NOT NULL, body NOT NULL, PRIMARY KEY
  (post_id, id))`. The composite key states the pair identity (D2).
- **Ids.** Never reused within a post: use a per-post sequence or random ids, never `MAX(id)+1`.
- **Outline.** A nullable `outline` column on posts, or `outlines(post_id PK FK ON DELETE CASCADE, body NOT NULL)`. A
  missing row is `null`, and removing an absent outline is a no-op `DELETE`.
- **Order.** No ordering column is needed, and there is no tie-break for equal titles.

## Changes to Existing Text

**`src/posts/posts.ts`**

1. **Package header (:1-2).** Change it to "every post, and its research documents and outline, is created, read,
   changed, listed, and deleted through one contract".
2. **Strings (:21).** Change it to "Titles, bodies, and outlines are JavaScript strings".
3. **Per-post order (:49-52).** Replace it with the paragraph in [Surface](#surface).
4. **Failures (:54-55).** Add "its subject says what was refused, the post or one of its research documents".
5. **New Precedence paragraph.** Add it after Failures.
6. **`delete` (:73-75).** Name the body, title, research documents, and outline. Every later call naming the id is
   `'not-found'`.
7. **Signal hint (:84).** Change it to "re-list, and re-get the posts, research document lists, research documents, and
   outlines you hold".
8. **Own-writes list (:85).** Add createResearchDocument, setResearchDocumentBody, setResearchDocumentTitle,
   deleteResearchDocument, and setOutline.
9. **Spurious signals (:89-91).** No change: "a signal may arrive when nothing visible changed" already covers a call
   that changes nothing.
10. **Export (:97).** Add `type PostErrorSubject`.

**`src/posts/post-error.ts`**

11. **Header, reason bullets, `MESSAGES`, constructor.** As in [Surface](#surface).

**`PostError` call sites (D6 makes these compile errors until fixed)**

12. **Production.** Add `'post'` at 8 sites in `src/posts/file/file-post-store.ts`.
13. **Tests.** Add `'post'` at 11 sites in `src/posts/file/file-post-store.test.ts` and 2 in
    `src/posts/post-error.test.ts`. `post-error.test.ts` also gains cases for the two new messages.

**`src/posts/components/describe-post-store.ts`**

14. **Message table.** Import `type PostErrorSubject`, and copy the nested `MESSAGES` table with all four texts.
15. **`expectRefusal`.** It becomes `expectRefusal(promise, reason, subject)` and asserts `.subject`. All 18 existing
    calls add `'post'`.
16. **New cases.** Add cases for every new rule, including these:
    - A deleted research id is never listed or reached again (V1). The file-store suite adds the case where another
      writer recreates it.
    - Two posts can hold the same research id, and (A, x) never returns B's document (V5).
    - `setOutline(null)` with no outline resolves and leaves `null` (V6).

**`docs/changes/post-management-api/api-design.md`**

17. **I10 (:331).** The message is fixed by (subject, reason), and I10 lists all four messages.
18. **BC3 (:652-654).**
    - A post's regular `outline.md` is addressable as its outline.
    - Each non-hidden subfolder of `research/` holding a regular `document.md` is addressable as a research document.
    - Every other sibling stays unaddressable and is still deleted with the post. That includes a legacy flat
      `research.md`.
19. **Failure Behavior (:350).** Add: "This table covers posts' methods. The research document and outline methods have
    their own table in `docs/changes/post-research-and-outline-api/`."
20. **Not changed, on purpose.** I3, I5, I6, I8, the existing Failure Behavior rows, and the UI delete-confirm text
    (`src/ui/documents/post-list/post-list.test.tsx:126` already says "notes or outlines").

## Open Risks

- **R1: the error subject does not reach HTTP clients.** `ApiError` is `{ error: string }` (`src/shared/wire.ts:83`),
  and `posts.routes.ts:20` maps by reason only. A client that treats every 404 as "post gone" would close a live post.
  This matters when integration exposes research routes.
- **R2: existing code reads only the reason.** `posts.routes.ts:66` (search) and `tools.ts:85` read any `'not-found'` as
  "post gone". That is correct today, but becomes wrong once research calls join those paths.
- **R3: a wrong subject still compiles.** Only the contract suite catches it, so the suite must assert the subject on
  every research refusal.
- **R4: the re-read cost after a signal.** Signals carry no detail. A caller holding research for k posts may re-read up
  to k × (`listResearchDocuments` + `getOutline`) per signal. This matters if a view holds more than the open post.
- **R5: existing outlines appear and become overwritable.** Existing `outline.md` files become visible and overwritable
  the day this ships. Flat `research.md` files stay invisible until integration decides on them.
- **R6: a write that skips the queue can recreate a deleted post.** Any write that skips the per-post queue can bring a
  deleted post folder back (F24). Separately, another writer deleting a folder between the check and the write is the
  same known gap posts already have.
- **R7: another writer renaming a research subfolder.** It looks like a delete followed by a create to anyone holding
  the pair.
- **R8: research title changes can go unsignalled.** If the `ignoreForWatch` widening for `.research.json` is skipped,
  other writers' research title changes never signal.
- **R9: removing a method gets expensive later.** Removing a method is cheap only while the file store is the sole
  implementor (D11).
- **R10: no deployable seam.** Nothing here crosses a deployable seam.
- **R11: research ids are unique only within a post.** A caller that pairs a research id with the wrong post may reach
  that post's document of the same id, and no error says so. The pair rule is the only guard.
- **R12: ids may be reused after a restart.** Never-reused holds only through one store instance. The file store's
  tombstones live in memory, so after a restart a deleted research id may be given out again. This matches posts.
- **R13: equal titles may reorder.** Documents with equal titles may come back in a different order on each list, so a
  UI may reorder them between refreshes.
- **R14: a non-file `outline.md` or non-folder `research` blocks writes.** Writes fail with a storage failure that the
  writer cannot clear through the store.
- **R15: in-place editing goes beyond the goal.** `setResearchDocumentBody` and `setResearchDocumentTitle` go beyond
  "associate" (V2). Cut them if you want attach-only research documents.

## Evidence

- [context-brief.md](./context-brief.md) holds findings F1–F34, with `file:line` provenance, from the codebase
  explorer, data engineer, and structural analyst.
- [design-options.md](./design-options.md) holds the three options as first proposed.
- [artifacts/question-round.md](./artifacts/question-round.md),
  [artifacts/decision-log.md](./artifacts/decision-log.md),
  [artifacts/amended-design.md](./artifacts/amended-design.md), and
  [artifacts/validation-dispositions.md](./artifacts/validation-dispositions.md) hold the trail from options to the final
  design.
- The earlier design this builds on is
  [docs/changes/post-management-api/api-design.md](../post-management-api/api-design.md).

## Next Step

This document is the input for implementation planning, and then a `tdd` run that implements the contract in
`src/posts/`.

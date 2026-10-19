# Amended Design (before validation)

`han-core:software-architect` amended Option A with the question-round answers and decisions D2–D11. This is the design
the adversarial validator attacked.

The architect checked these facts against the code:

- **`new PostError(` sites.** There are 21: 8 in `src/posts/file/file-post-store.ts` (:20, :100, :109, :114, :116, :118,
  :228, :254), 11 in `src/posts/file/file-post-store.test.ts`, and 2 in `src/posts/post-error.test.ts`. None are outside
  `src/posts/`.
- **Code that reads `.reason` without a subject.** `src/server/posts/posts.routes.ts:20` (status mapping), `:66`
  (search), and `src/engine/chat/tools/tools.ts:85`.
- **The wire error.** `ApiError` is `{ error: string }` (`src/shared/wire.ts:83`).
- **The contract suite.** It calls `expectRefusal(promise, reason)` 18 times.

## 1. Contract sketch

### `src/posts/posts.ts`: changed and added members

```ts
// A research document's identity, assigned by the store when the document is made. It names a document only together
// with its post: a research document's identity is the pair (postId, researchDocumentId), and anything that keeps a
// reference to a research document must keep both. Within its post it follows the same rules as PostId:
// - Exact: a string names a document only when listResearchDocuments(postId) would return exactly that string, code
//   unit for code unit. "" never names a research document.
// - Stable: no call on this contract changes it, whatever happens to the document's title or body.
// - Never reused: a store instance never gives out, within one post, an id it has given out before in that post, even
//   after that document is deleted. A deleted post's id is never reused either, so a stale pair can never reach a
//   later document.
// - Opaque: callers store it and pass it back. They never build, parse, order, or show it.
// Any string that names no research document under a live post is 'not-found' (subject 'research-document'). There is
// no "malformed id".
export type ResearchDocumentId = string;

// What listResearchDocuments gives for each research document: enough to show and pick it, without its body. It has no
// postId field, because every call that returns it was given the post id.
export interface ResearchDocumentSummary {
  id: ResearchDocumentId;
  // Never blank. The title exactly as last given to createResearchDocument or setResearchDocumentTitle. For a document
  // this store never titled (one another writer made), a title the store derives. The title is the only key callers
  // sort by: research documents carry no timestamp or position. Independent of any H1 in the body; the two can
  // disagree.
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
// document id it names. 'not-found' with subject 'research-document' means the post exists and the document does not.
export interface PostStore {
  // ...list, get, create, setBody, setTitle unchanged...

  // Removes the post, and everything the store keeps for it, for good: its body, its title, its research documents,
  // and its outline. An id that names no post is 'not-found'. Through this store, once a delete takes effect, every
  // later call naming that id is 'not-found', post and research document and outline calls alike. No later call
  // brings the post, its research documents, or its outline back, or gives its id to another post.
  delete(id: PostId): Promise<void>;

  // Every research document of the post that exists for the whole of the call, each once, without bodies, in no
  // promised order. Callers sort, by title. Unlike list(), this call is ordered with the post's other calls (see
  // Per-post order), and it rejects 'not-found' (subject 'post') when the post id names no post. A post with no
  // research documents resolves to { researchDocuments: [] }. A document another writer adds or removes while the call
  // runs may or may not appear.
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
  // naming that pair is 'not-found' (subject 'research-document'), and the id is never given to another document in
  // that post. A post id that names no post is 'not-found' (subject 'post'). A document id that names no research
  // document of that post is 'not-found' (subject 'research-document'): unlike removing an absent outline, this is a
  // refusal, because an id that names nothing is always 'not-found'.
  deleteResearchDocument(postId: PostId, researchDocumentId: ResearchDocumentId): Promise<void>;

  // The post's outline: its markdown, exactly as last given, or null when the post has no outline. An empty outline
  // ("") is not null: "" is an outline with no text, and null is no outline. Same body rules as Post.body; the outline
  // has no title and no id, because the post names it. A post id that names no post is 'not-found' (subject 'post').
  getOutline(postId: PostId): Promise<string | null>;

  // Sets the post's outline. A string creates the outline or replaces the whole of it, and "" is stored as an empty
  // outline. null removes it, and removing an absent outline resolves and changes nothing (it may still signal; see
  // watch). Never creates a post: a post id that names no post is 'not-found' (subject 'post'). An outline is never
  // 'invalid'. Once the call resolves, getOutline returns the new value.
  setOutline(postId: PostId, outline: string | null): Promise<void>;

  // watch: unchanged except the two bullets edited in section 3.
  watch(listener: () => void): () => void;
}

export { PostError, type PostErrorReason, type PostErrorSubject } from './post-error';
export { createFilePostStore } from './file/file-post-store';
```

### `src/posts/post-error.ts`

```ts
// A refusal the caller can show as is. The message is fixed by the pair (subject, reason), so it carries no id, title,
// path, or storage detail. This module imports nothing, so the engine may import it as a value and recognize a refusal
// with `error instanceof PostError`. Reading `.reason` alone is not enough: FileSystemError also has 'not-found' and
// 'invalid' reasons, and a 'not-found' with subject 'research-document' means the post still exists.
// - 'not-found': the id names nothing. With subject 'post', the post id names no post (never given out, deleted, or not
//   one list() could return). With subject 'research-document', the post exists and the research document id names no
//   research document of it.
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

## 2. Justification table

| # | Element | Justification |
|---|---|---|
| E1 | The new surface lives in `src/posts/`, re-exported from `posts.ts`, Bun-free | G5. N: package import rules (F16). |
| E2 | The methods sit on `PostStore` itself | G5. N: F20. D1. |
| E3 | A research document belongs to exactly one post and is never shared | G3. N: F11, F27. D3. |
| E4 | `delete(postId)` removes the post's research documents and outline; every later call naming that post is `'not-found'` | N: F11. |
| E5 | `ResearchDocumentId = string`: store-assigned, exact, stable, never reused within its post, opaque | G3. N: F28, F8. D8. |
| E6 | The identity is the pair (postId, researchDocumentId); stored references keep both | D2. N: F14, F20. |
| E7 | Every research call takes `(postId, researchDocumentId)`, post id first | D2. N: F14, F24, F10. |
| E8 | An id naming nothing under a live post is `'not-found'` (`'research-document'`); there is no "malformed id" | N: F8. |
| E9 | `ResearchDocumentSummary { id, title }`, with no `postId` field | N: G3. D2, D8. |
| E10 | A research title is never blank; blank is `'invalid'` and nothing is made or changed | D4. N: F13. |
| E11 | The title is exactly as last given, or derived for documents the store never titled | D10. |
| E12 | The research title and a body H1 are independent | N: F13. |
| E13 | `ResearchDocument extends ResearchDocumentSummary { body }`; the body round-trips `""` | G1. N: F13. D8. |
| E14 | `ResearchDocumentList { researchDocuments }`, an object wrapper | G3. N: F9. D8. |
| E15 | No bodies in listings; research is not inlined into `Post` or `PostSummary` | N: F31. |
| E16 | No promised order; the title is the only sort key, on purpose | N: F30. Q9. |
| E17 | The outline has no id | G4. N: F28. |
| E18 | No outline is `null`; an empty outline is `""` | G2. N: F29. D5. |
| E19 | The outline is opaque markdown with no title and is never `'invalid'` | G4. N: F13. |
| E20 | `setOutline` with a string creates or replaces; `null` removes; removing an absent outline resolves | G4, G2. |
| E21 | Research and outline calls never create a post | N: BC5 / I8 in the earlier design. |
| E22 | A blank title is checked before I/O | D9. |
| E23 | Otherwise a missing post's `'not-found'` wins | D9. |
| E24 | `PostErrorSubject = 'post' \| 'research-document'` | N: F32. D8. |
| E25 | `subject` is required; the 21 existing sites add `'post'` | D6. |
| E26 | `reason` stays closed; the message is fixed by (subject, reason) | N: F7. |
| E27 | Two new messages | Q4. N: F32. |
| E28 | A `PostError` changed nothing; any other rejection is a storage failure | N: F12. |
| E29 | Per-post order covers every research and outline call | N: F14, F24. |
| E30 | `listResearchDocuments` is ordered with the post and can reject `'not-found'` (`'post'`) | Q11. N: F14. |
| E31 | Read-after-write for the research and outline mutators | N: `posts.ts:64-69`. |
| E32 | New writes signal `watch` before they settle; a `PostError` does not | N: F15. |
| E33 | A call that changes nothing may signal | Q3. N: F15. |
| E34 | Other writers' changes are visible and signalled "if the implementation can see it" | D10. N: F15. |
| E35 | `setResearchDocumentBody` | D7. F4. |
| E36 | `setResearchDocumentTitle`; the id does not change | D7. N: E5. |
| E37 | `listResearchDocuments` | G3. |
| E38 | `getResearchDocument` | N: G1, F31. |
| E39 | `createResearchDocument` returns the id | G1, G3. N: F28, F10. |
| E40 | `deleteResearchDocument`; a missing id is `'not-found'` | G2, G3. N: E8. |
| E41 | `getOutline` | G4, G2. N: F29. |
| E42 | `setOutline` | G4, G2. |
| E43 | Method names, post id first | D8. N: F10. |
| E44 | `PostErrorSubject` re-exported from `posts.ts` | N: F16. |
| E45 | Exposed through `Omit<PostStore,'watch'>`, with no routes yet | N: F18. G7. |
| E46 | Spread test doubles keep working | N: F17. |
| E47 | `describePostStore` widened, with `expectRefusal(promise, reason, subject)` | N: F19. |
| E48 | The strings paragraph covers outlines | N: F13. |
| E49 | The method set is final for this direction | D11. |
| E50 | BC3 amendment | Q13. N: F22. |
| E51 | I10 amendment | N: E26, E27. |

## 3. Existing text changes

**`src/posts/posts.ts`**

1. **:1-2 package header.** It becomes "every post, and its research documents and outline, is created, read, changed,
   listed, and deleted through one contract".
2. **:21 Strings.** It becomes "Titles, bodies, and outlines are JavaScript strings".
3. **:49-52 Per-post order.** Replace it with the paragraph in section 1.
4. **:54-55 Failures.** Add "its subject says what was refused, the post or one of its research documents".
5. **A new Precedence paragraph** goes after Failures.
6. **:73-75 `delete`.** Name its body, title, research documents, and outline, and say that every later call naming
   that id is `'not-found'`.
7. **:84 signal hint.** It becomes "re-list, and re-get the posts, research document lists, research documents, and
   outlines you hold".
8. **:85 own-writes list.** Add createResearchDocument, setResearchDocumentBody, setResearchDocumentTitle,
   deleteResearchDocument, and setOutline.
9. **:89-91.** No change. "A signal may arrive when nothing visible changed" already covers E33.
10. **:97 export.** Add `type PostErrorSubject`.

**`src/posts/post-error.ts`**

11. **Header.** The message is fixed by the pair (subject, reason). A `'research-document'` 'not-found' means the post
    still exists.
12. **Reason bullets.** Replace them with the text in section 1.
13. **`MESSAGES`.** Nest it by subject and add the two research document messages.
14. **Constructor.** Add a required `readonly subject` and look up `MESSAGES[subject][reason]`.

**Call sites (compile-forced by D6)**

15. `src/posts/file/file-post-store.ts`: 8 sites add `'post'`.
16. `src/posts/file/file-post-store.test.ts` (11 sites) and `src/posts/post-error.test.ts` (2 sites) add `'post'`.
    `post-error.test.ts` gains two cases for the research document messages.

**`src/posts/components/describe-post-store.ts`**

17. Import `type PostErrorSubject`.
18. Copy the nested `MESSAGES` table, with all four texts.
19. `expectRefusal(promise, reason, subject)` also asserts `.subject`. All 18 existing calls add `'post'`.
20. Add cases for E4, E8, E10, E16, E18, E20–E23, E29–E33, E35–E36, and E40.

**`docs/changes/post-management-api/api-design.md`**

21. **I10 (:331).** The message is fixed by (subject, reason), and the line lists all four messages.
22. **BC3 (:652-654).** A post's `outline.md` is addressable as its outline, and its research folder as its research
    documents. Every other sibling, including a legacy flat `research.md`, is still not addressable and is still
    deleted with the post.
23. **Not changed, on purpose.** I3, I5, I6, I8, the Failure Behavior table, and the UI delete confirm text.

## 4. Cut list

- **Research shared across posts (O1).** Cut by D3. Adding it later is breaking.
- **Reordering research, or a promised order.** Cut by F30 and Q9. Additive later.
- **Titles on outlines.** Cut by G4 and F28.
- **Timestamps on research.** Cut, as for posts. Additive later.
- **Version tokens and conditional saves.** Cut, as for posts.
- **Research counts in `PostSummary`, or research inlined into `get`.** Cut by F31.
- **A `postId` field on `ResearchDocumentSummary`.** Cut by D2 (YAGNI).
- **Migrating legacy flat `research.md` or the root `research/` folder.** Integration (G7).
- **Wiring into the engine, routes, wire types, agent tools, skills, and UI.** Integration (G7, D11).
- **Typed per-document change events.** Cut by F15.
- **A separate `ResearchDocumentError` class.** Cut: `PostError` with a required subject suffices.
- **A branded `ResearchDocumentId`.** Cut, as for `PostId`.
- **A `'post'` default for `subject`.** Cut by D6.

## 5. Store direction

**File store**

- **Outline.** `outline.md` in the post folder: `null` is absent, and `""` is an empty file. `setOutline(null)` deletes
  the file.
- **Research.** A non-hidden `research/` subfolder holding one `.md` per document. Ids are the key within `research/`,
  assigned from the title with `newEntryName`, with ` 2` added on a clash. `setResearchDocumentTitle` never renames.
  Research tombstones are kept per (postId, researchDocumentId).
- **Titles.** They live in metadata the watcher sees: a non-hidden sidecar per document, or a widened `ignoreForWatch`
  exception.
- **Derived title.** For a document another writer made: the file name without `.md`, else `Untitled`.
- **Unchanged behavior.** Body writes are atomic. The recursive post delete cascades. `removeIfOnlyOurs` is unaffected.

**Database store**

- **Research table.** `research_documents(post_id FK ON DELETE CASCADE, id, title NOT NULL, body NOT NULL, PRIMARY KEY
  (post_id, id))`.
- **Ids.** Never reused: use a per-post sequence or random ids, never `MAX(id)+1`.
- **Outline.** A nullable column, or `outlines(post_id PK FK ON DELETE CASCADE, body NOT NULL)`.

## 6. Open risks

- **R1.** The subject does not cross HTTP. `ApiError` is `{ error: string }` (`src/shared/wire.ts:83`), and
  `posts.routes.ts:20` maps by `reason` only.
- **R2.** `posts.routes.ts:66` (search) and `tools.ts:85` treat any `PostError` 'not-found' as "post gone". That is
  correct today, but not once research calls join those paths.
- **R3.** Passing a wrong subject still compiles. Only the suite catches it.
- **R4.** The re-read cost after a detail-free signal is up to k x (`listResearchDocuments` + `getOutline`).
- **R5.** Existing `outline.md` files become visible and overwritable. Flat `research.md` files stay invisible.
- **R6.** Orphan folders appear if any write skips the per-post queue (F24).
- **R7.** Another writer renaming a research file looks like delete plus create.
- **R8.** Research metadata hidden from the watcher never signals.
- **R9.** D11 cuts are cheap only while the file store is the sole implementor.
- **R10.** Nothing here crosses a deployable seam.

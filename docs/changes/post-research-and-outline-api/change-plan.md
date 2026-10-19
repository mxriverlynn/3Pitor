# Change Plan: Research Documents and an Outline on the Current Post

## Why This Change

Research and outlines should belong to the post they were made for, and the left panel should show that post's
documents instead of every post. The operator asked to implement
[api-design.md](api-design.md), which settled how a post holds its research documents and its outline, and to connect it
to the app. That makes this two reason classes at once: a decision already taken (the design) and a constraint arriving
(the new requirement). The source is the operator's request, recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md). The plan lives beside the design
([D-1](artifacts/change-decision-log.md#trivial-decisions)).

## What Changes, In One Paragraph

After this change, `/research` with a post open saves its report as a new research document of that post, unsaved for
the writer to review, and leaves the post's own text alone
([D-13](artifacts/change-decision-log.md#d-13-the-research-skill-saves-its-report-as-a-research-document-of-the-open-post)).
Research or an outline asked for in plain chat goes to the same places: a research document, or the post's one outline
([D-7](artifacts/change-decision-log.md#d-7-the-ais-research-and-outline-text-arrives-unsaved-like-its-post-edits-a-research-document-is-created-empty-first),
[D-11](artifacts/change-decision-log.md#d-11-the-system-prompt-says-where-research-and-outlines-go)). The left panel
shows the open post's title with its outline and research documents beneath it, and each opens in the editor like a post
([D-15](artifacts/change-decision-log.md#d-15-the-left-panel-shows-only-the-open-post-and-its-documents)). Choosing a
different post, or making a new one, happens on the post table, which is already the landing page. Underneath, the post
store implements the design, and one string "document key" names a post, an outline, or a research document everywhere
outside the store, so the AI's turn, the browser–server messages, and the browser's open documents can carry all three
kinds without changing their types
([D-4](artifacts/change-decision-log.md#d-4-one-string-document-key-names-every-document-outside-the-store)).

## Current State

Everything outside the store knows about exactly one kind of document: a post, named by its id. Four places carry that
assumption.

- **The AI's tools.** `Read`, `Write`, `Edit`, and `Highlight` resolve a name to a post and refuse anything else as "not
  a post" ([C-8](artifacts/current-state-findings.md#c-8-every-ai-file-tool-addresses-a-document-by-one-post-id-string)).
  The AI's text reaches disk only through the writer's Save. The two exceptions are `.3pitor/` notes and `NewPost`'s
  empty create ([C-9](artifacts/current-state-findings.md#c-9-the-ai-reaches-disk-two-ways-today-and-newpost-is-the-only-store-write)).
- **The research skill and the prompt.** The research skill appends its report to the open post's text
  ([C-5](artifacts/current-state-findings.md#c-5-the-research-skill-writes-its-report-into-the-open-posts-body-after-any-text-already-there)).
  It finds the post through one sentence the engine adds to each message
  ([C-4](artifacts/current-state-findings.md#c-4-the-open-post-reaches-the-model-as-one-sentence-the-research-skill-depends-on-its-wording)).
  Nothing produces an outline today; an outline lands in the post's text, the chat, or a note
  ([C-7](artifacts/current-state-findings.md#c-7-no-outline-producer-exists-an-outline-today-lands-in-the-post-body-the-chat-or-a-hidden-note)).
- **The browser–server messages.** A turn's edits come back keyed by post id, and the browser loads each one through the
  post route ([C-11](artifacts/current-state-findings.md#c-11-turn-results-carry-edits-keyed-by-post-id-and-the-browser-loads-each-one-through-the-post-route)).
  A refusal is `{ error }` and a 404, with nothing saying whether the post or something inside it was missing
  ([C-15](artifacts/current-state-findings.md#c-15-a-posterror-maps-to-http-by-reason-alone-and-apierror-carries-only-a-message)).
- **The browser.** `useDocuments` keys every map, ref, and saved view field by post id
  ([C-13](artifacts/current-state-findings.md#c-13-usedocuments-is-one-972-line-hook-in-which-every-map-ref-and-persisted-field-keys-by-post-id)).
  It treats "not in the post list" or a 404 as "gone"
  ([C-14](artifacts/current-state-findings.md#c-14-gone-means-not-in-the-post-list-and-a-404-closes-the-entry)).
  The left panel lists every post and also hosts New post, Rename, Delete, and the target of "Show in the post list"
  ([C-19](artifacts/current-state-findings.md#c-19-the-left-panel-is-a-flat-list-of-every-post-and-also-hosts-new-post-rename-delete-and-show-in-the-post-list)).
  The post table already offers open, rename, delete, and New post
  ([C-20](artifacts/current-state-findings.md#c-20-the-post-table-is-the-landing-page-and-already-duplicates-open-rename-and-delete)).

Two properties make the change cheaper than it looks. The server's view of the store widens on its own as methods are
added ([C-1](artifacts/current-state-findings.md#c-1-the-engine-reaches-the-store-through-two-type-windows-and-only-the-tools-window-is-a-closed-list)),
and test doubles spread a real store, so they keep compiling
([C-2](artifacts/current-state-findings.md#c-2-tests-spread-a-real-store-so-the-store-can-grow-without-breaking-them)).

## Target State

### The post store implements the design

`PostStore` gains the eight methods, three types, and required error `subject` that `api-design.md` specifies, and the
file store implements its Store Direction
([D-2](artifacts/change-decision-log.md#d-2-implement-the-store-contract-exactly-as-the-api-design-specifies)). The one
difference: deleted research ids are remembered in their own per-post map, because a research tombstone written as
`${postId}/research/${id}` is also a valid post id
([D-3](artifacts/change-decision-log.md#d-3-research-tombstones-live-in-their-own-per-post-map)).

```ts
const researchTombstones = new Map<string, Set<string>>();   // postId -> research ids deleted in that post
```

### One document key names every document outside the store

`src/shared/document-key.ts` is new, imports nothing, and is used by the engine, the browser, and the check script. It
owns the only grammar for naming documents
([D-4](artifacts/change-decision-log.md#d-4-one-string-document-key-names-every-document-outside-the-store)). A post's
key is its id, so every existing post id, saved view, and session keeps working. An outline or research document is a
JSON array.

```ts
export type DocumentRef =
  | { kind: 'post'; postId: string }
  | { kind: 'outline'; postId: string }
  | { kind: 'research'; postId: string; researchDocumentId: string };
export function documentKey(ref: DocumentRef): string;
export function parseDocumentKey(key: string): DocumentRef | undefined;   // exact inverse; undefined when not a key
export const postKey = (postId: string) => documentKey({ kind: 'post', postId });
export const postOfKey = (key: string) => parseDocumentKey(key)?.postId;
```

| Ref | Key |
| --- | --- |
| post `1/p 1` | `1/p 1` |
| outline of `1/p 1` | `["outline","1/p 1"]` |
| research `Sources 2` of `1/p 1` | `["research","1/p 1","Sources 2"]` |
| post `["outline","x"]` | `["post","[\"outline\",\"x\"]"]` |

Every field that names a document keeps its `string` type and is documented as a document key:

- `ChatRequest.openFile` and the keys of `documents`
- `SessionData.edited` and `TurnProgress.edited`
- `SessionHighlights.file`, `StoredDoc.name`, `TurnRecord.bases`, `NotApplied.name`, and `ViewState.current`
- `TurnTexts` and the maps in `useDocuments`

### The server answers for a post's documents and says what was missing

`postRoutes` gains six routes, and every refusal body gains `subject`
([D-5](artifacts/change-decision-log.md#d-5-six-new-routes-under-the-post-routes-with-one-combined-listing-for-the-panel),
[D-6](artifacts/change-decision-log.md#d-6-refusal-bodies-carry-the-errors-subject-and-the-page-reads-it)). The browser
treats a 404 with subject `research-document` as "this research document is gone", and a 404 with subject `post` (or no
subject) as "the post is gone".

| Method and path | Body | 200 answer |
| --- | --- | --- |
| `GET /api/posts/:id/documents` | — | `{ outline: boolean; researchDocuments: { id; title }[] }` |
| `GET /api/posts/:id/outline` | — | `{ outline: string \| null }` |
| `PUT /api/posts/:id/outline` | `{ outline: string \| null }` | `{ ok: true }` |
| `GET /api/posts/:id/research/:rid` | — | `{ id; title; body }` |
| `PUT /api/posts/:id/research/:rid/body` | `{ body }` | `{ ok: true }` |
| `DELETE /api/posts/:id/research/:rid` | — | `{ ok: true }` |

```ts
export interface ApiError { error: string; subject?: 'post' | 'research-document'; }
// 404 {"error":"That research document no longer exists.","subject":"research-document"}
```

### The AI's research and outlines arrive unsaved, on the open post

The AI's text still reaches disk only through the writer's Save
([D-7](artifacts/change-decision-log.md#d-7-the-ais-research-and-outline-text-arrives-unsaved-like-its-post-edits-a-research-document-is-created-empty-first)):

- **Research.** A new tool, `NewResearchDocument`, creates an empty research document on a post and puts the report in
  the editor as an unsaved edit, the way `NewPost` does for posts
  ([D-8](artifacts/change-decision-log.md#d-8-the-newresearchdocument-tools-contract)).
- **The outline.** The AI `Write`s the whole outline to the outline's key. Nothing is stored until the writer saves.

`Read`, `Write`, `Edit`, and `Highlight` accept any document key through one `target` function, the only place in the
engine that branches on kind
([D-9](artifacts/change-decision-log.md#d-9-the-ai-tools-resolve-any-document-key-through-one-target-function)). The
model learns the outline's key, and which document is open, from the sentence the engine adds to each message
([D-10](artifacts/change-decision-log.md#d-10-the-open-document-sentence-names-the-outline-key-and-the-document-being-looked-at)):

```
The post open in my editor is "the sun". When my message does not name a post, it means this post. Its outline, if it has one, is named ["outline","the sun"].
```

```ts
NewResearchDocument: { post_id: string; title: string; content: string }
// -> made research document ["research","the sun","Sources"] titled "Sources" on post "the sun"; its text is in the editor, unsaved
```

The system prompt tells the model where research and outlines go and never to put them in the post's text
([D-11](artifacts/change-decision-log.md#d-11-the-system-prompt-says-where-research-and-outlines-go)). The research
skill's Step 5 calls `NewResearchDocument` instead of `Write`
([D-13](artifacts/change-decision-log.md#d-13-the-research-skill-saves-its-report-as-a-research-document-of-the-open-post)).
There is no outline skill
([D-12](artifacts/change-decision-log.md#d-12-no-outline-skill)).

### The left panel shows one post and its documents

`PostPanel` replaces `PostList`
([D-15](artifacts/change-decision-log.md#d-15-the-left-panel-shows-only-the-open-post-and-its-documents)):

- **Nothing open.** It shows "No post open. Pick one from your posts.", with the post table in the editor area.
- **A post open, or one of its documents.** It shows the post's title as a heading with Rename and Delete. Beneath it
  are an Outline row, when there is one, and a Research group sorted by title.
- **Gone documents with unsaved changes.** They keep their own group, as today.

Each row opens its document in the editor, where it is edited and saved like a post. Each research row and the Outline
row can be deleted ([D-18](artifacts/change-decision-log.md#d-18-research-and-outline-rows-have-a-delete-action)).

The panel answers for showing one post's documents and nothing else:

- **New post** lives only on the post table
  ([D-16](artifacts/change-decision-log.md#d-16-new-post-lives-only-in-the-post-table)).
- **The editor bar's "Show in the post list" button** becomes a plain heading
  ([D-17](artifacts/change-decision-log.md#d-17-the-editor-bars-post-name-becomes-a-plain-heading)).
- **The pause while Claude works** covers every menu in the panel
  ([D-19](artifacts/change-decision-log.md#d-19-the-claude-is-working-pause-covers-every-panel-menu)).

### `useDocuments` handles every kind through a few functions

The hook stays one hook, keyed by document key
([D-20](artifacts/change-decision-log.md#d-20-extend-usedocuments-only-two-functions-know-how-to-load-and-save-each-kind)).
Four functions know how each kind loads, saves, counts as gone, and is named:

- `readDocument(key)` loads a document.
- `saveDocument(key, text)` saves one.
- `isGone(key)` decides whether a document is gone.
- `label(key)` names a document for the writer.

The open post's documents load into `postDocs`, behind a guard that checks both a call counter and the current post
([D-21](artifacts/change-decision-log.md#d-21-the-panels-list-has-its-own-latest-wins-guard-keyed-by-post)). Disk sync
and restore treat each kind by its own rules
([D-22](artifacts/change-decision-log.md#d-22-gone-and-disk-sync-are-decided-per-kind)), and research failures get their
own messages ([D-23](artifacts/change-decision-log.md#d-23-new-messages-for-research-documents-post-messages-unchanged)).

```ts
async function readDocument(key: string): Promise<{ text: string | null; title?: string }>;
async function saveDocument(key: string, text: string): Promise<void>;
```

## Surface Delta

### S-1: `PostError` — Re-scoped

**Target state.** `PostError` carries a required `subject: PostErrorSubject` (`'post' | 'research-document'`) alongside
`reason`. Its message is fixed by the pair, with four texts: the two post messages unchanged, plus "That research
document no longer exists." and "A research document needs a title." `PostErrorSubject` is exported from
`src/posts/posts.ts`.

**Behavior.** Preserving. Every existing site passes `'post'` and gets the same message. No code outside `src/posts/`
constructs a `PostError`.

**Why.** The design's error contract (`api-design.md`, `post-error.ts`).

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-implement-the-store-contract-exactly-as-the-api-design-specifies)

### S-2: `PostStore` — Re-scoped

**Target state.** `PostStore` manages a post's research documents (`listResearchDocuments`, `getResearchDocument`,
`createResearchDocument`, `setResearchDocumentBody`, `setResearchDocumentTitle`, `deleteResearchDocument`) and its
outline (`getOutline`, `setOutline`) as well as posts, with the types `ResearchDocumentId`, `ResearchDocumentSummary`,
`ResearchDocument`, and `ResearchDocumentList`. `delete` removes the post's research documents and outline with it. Its
comments match the design's "Changes to Existing Text" items 1–10.

**Behavior.** Preserving for the existing methods: their inputs, outputs, and messages are unchanged.

**Why.** The design, implemented as written.

**Depends on.** S-1.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-implement-the-store-contract-exactly-as-the-api-design-specifies)

### S-3: The file store's on-disk layout for outlines and research — Added

**Target state.** A post folder's regular `outline.md` is that post's outline. `research/<id>/` holds one research
document as `document.md` (its body) and `.research.json` (`{ "title" }`, written atomically). `research/` folder names
are research ids, claimed exclusively. Deleted research ids are kept per post in `researchTombstones`. The file watcher
passes `.research.json` changes as it does `.post.json`. An existing `outline.md` becomes visible as the outline. A flat
`research.md` stays invisible.

**Behavior.** Changing. A writer's existing `outline.md` appears as the post's outline and can be overwritten. Settled
under the standing instruction; see Behavior Changes.

**Why.** The design's Store Direction, with D-3's tombstone change.

**Depends on.** S-2.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-research-tombstones-live-in-their-own-per-post-map),
[D-24](artifacts/change-decision-log.md#d-24-existing-outlinemd-files-become-the-posts-outline-flat-researchmd-files-stay-hidden)

### S-4: `describePostStore` contract suite — Re-scoped

**Target state.** The suite in `src/posts/components/describe-post-store.ts` holds every implementation to the research
and outline rules as well as the post rules. `expectRefusal(promise, reason, subject)` asserts the subject, and the
message table is nested by subject.

**Behavior.** Preserving (test code).

**Why.** Every implementation is held to one suite (design item 15–16).

**Depends on.** S-1, S-2.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-implement-the-store-contract-exactly-as-the-api-design-specifies)

### S-5: `src/shared/document-key.ts` — Added

**Target state.** The module exports `DocumentRef`, `documentKey`, `parseDocumentKey`, `postKey`, and `postOfKey`, and
owns the only grammar for naming a post, an outline, or a research document outside the store. It imports nothing and
is Bun-free.

**Behavior.** Preserving (new module).

**Why.** Three parts must agree on how documents are named: the engine's tools, the browser, and the check script.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-one-string-document-key-names-every-document-outside-the-store)

### S-6: Research and outline wire types — Added

**Target state.** `src/shared/wire.ts` declares `ResearchDocumentSummary`, `ResearchDocument`, `PostDocuments`,
`Outline`, and `SetOutlineBody`, restating the store's shapes.

**Behavior.** Preserving (new types).

**Why.** The browser cannot import the posts package (C-3).

**Depends on.** S-2.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-six-new-routes-under-the-post-routes-with-one-combined-listing-for-the-panel)

### S-7: `ApiError` — Re-scoped

**Target state.** `ApiError` is `{ error: string; subject?: ApiErrorSubject }`. Every refusal the store made carries
the subject. A bad request body carries none.

**Behavior.** Changing, additively: refusal bodies gain a field. Nothing reads it before S-10. Settled under the
standing instruction.

**Why.** The page must tell a missing research document from a missing post.

**Depends on.** S-1.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-refusal-bodies-carry-the-errors-subject-and-the-page-reads-it)

### S-8: Document-naming fields on the wire — Re-scoped

**Target state.** `ChatRequest.openFile` and `documents`, `SessionData.edited`, `TurnProgress.edited`,
`SessionHighlights.file`, `StoredDoc.name`, `TurnRecord.bases`, `NotApplied.name`, and `ViewState.current` each hold a
document key. Their types are unchanged.

**Behavior.** Preserving. A post's key is its id.

**Why.** These fields must be able to name an outline or a research document.

**Depends on.** S-5.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-one-string-document-key-names-every-document-outside-the-store)

### S-9: `postRoutes` — Re-scoped

**Target state.** `postRoutes` serves the six routes in the Target State table as well as today's post routes. Its
`onError` sends `{ error, subject }` with today's status rule.

**Behavior.** Preserving for the existing routes, apart from S-7's added field.

**Why.** The panel and the editor need to list, read, save, and delete outlines and research documents.

**Depends on.** S-2, S-6, S-7.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-six-new-routes-under-the-post-routes-with-one-combined-listing-for-the-panel),
[D-6](artifacts/change-decision-log.md#d-6-refusal-bodies-carry-the-errors-subject-and-the-page-reads-it)

### S-10: `api()` in `src/ui/components/api.ts` — Re-scoped

**Target state.** A failed request's error carries `subject` beside `status` when the body names one.

**Behavior.** Preserving. Existing callers read only `status` and `message`.

**Why.** The browser's gone and save logic branches on it.

**Depends on.** S-7.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-refusal-bodies-carry-the-errors-subject-and-the-page-reads-it)

### S-11: The UI fake post API — Re-scoped

**Target state.** `src/ui/components/fake-posts-api.ts` serves the six new routes from in-memory research and outline
maps. It sends `subject` on its 404s and copies the two new messages.

**Behavior.** Preserving (test code).

**Why.** Every UI test runs against it (C-26).

**Depends on.** S-9.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-refusal-bodies-carry-the-errors-subject-and-the-page-reads-it)

### S-12: `useDocuments` — Re-scoped

**Target state.** `useDocuments` opens, loads, saves, syncs, persists, and restores posts, outlines, and research
documents, all keyed by document key:

- **Loading and saving** go through `readDocument` and `saveDocument`.
- **The open post's documents** are held in `postDocs` and refreshed behind a post-keyed guard. `removeDocument(key)`
  deletes a research document or the outline.
- **Gone** is decided per kind, using a `goneDocs` set for research documents.
- **Messages.** Research failures and the Undo all warning use the D-23 texts.
- **Removed.** `newPosts`, `requestNewPost`, `finds`, and `findInDocs` no longer exist.

**Behavior.** Changing for the Undo all warning's wording and the new research messages. Preserving for every post path.
Settled under the standing instruction.

**Why.** Every opened document flows through this hook (C-13).

**Depends on.** S-5, S-9, S-10.

**Decision.** [D-20](artifacts/change-decision-log.md#d-20-extend-usedocuments-only-two-functions-know-how-to-load-and-save-each-kind),
[D-21](artifacts/change-decision-log.md#d-21-the-panels-list-has-its-own-latest-wins-guard-keyed-by-post),
[D-22](artifacts/change-decision-log.md#d-22-gone-and-disk-sync-are-decided-per-kind),
[D-23](artifacts/change-decision-log.md#d-23-new-messages-for-research-documents-post-messages-unchanged),
[D-16](artifacts/change-decision-log.md#d-16-new-post-lives-only-in-the-post-table),
[D-17](artifacts/change-decision-log.md#d-17-the-editor-bars-post-name-becomes-a-plain-heading)

### S-13: `PostList` — Removed

**Target state.** `src/ui/documents/post-list/` does not exist. Listing every post is the post table's job. Rename and
Delete of the open post are `PostPanel`'s, and New post is the post table's.

**Behavior.** Changing: see S-14.

**Why.** The panel no longer lists every post.

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-the-left-panel-shows-only-the-open-post-and-its-documents),
[D-27](artifacts/change-decision-log.md#trivial-decisions)

### S-14: `PostPanel` — Added

**Target state.** `src/ui/documents/post-panel/post-panel.tsx` exports `PostPanel`, which `app.tsx` renders in the left
column. It shows the open document's post with Rename and Delete, its Outline row, its research documents sorted by
title, and the gone-with-unsaved-changes group. Outline and research rows have Delete. With nothing open it shows "No
post open. Pick one from your posts." While Claude works, every menu is disabled, and the paused text reads "Changes to
posts and their documents are paused while Claude works. You can still open them."

**Behavior.** Changing: what the left panel shows. Settled under the standing instruction; see Behavior Changes.

**Why.** The scope's third sentence.

**Depends on.** S-12.

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-the-left-panel-shows-only-the-open-post-and-its-documents),
[D-18](artifacts/change-decision-log.md#d-18-research-and-outline-rows-have-a-delete-action),
[D-19](artifacts/change-decision-log.md#d-19-the-claude-is-working-pause-covers-every-panel-menu)

### S-15: `PostTable` — Re-scoped

**Target state.** The post table owns New post through its own `usePostDialogs`. It opens a post with
`open(postKey(id))`. `PostTableDocs` has no `requestNewPost`.

**Behavior.** Preserving for what the table shows and does. The New post dialog opens from the table itself.

**Why.** The panel no longer hosts the dialog.

**Depends on.** S-12.

**Decision.** [D-16](artifacts/change-decision-log.md#d-16-new-post-lives-only-in-the-post-table)

### S-16: The editor bar's document name — Re-scoped

**Target state.** The editor bar shows `label(current)` in an `<h2 tabIndex={-1}>` that takes the focus the code moves
to it. It is not a button and does not scroll the panel.

**Behavior.** Changing: the name is no longer clickable. Settled under the standing instruction.

**Why.** There is no post list to show the post in.

**Depends on.** S-12.

**Decision.** [D-17](artifacts/change-decision-log.md#d-17-the-editor-bars-post-name-becomes-a-plain-heading)

### S-17: `fileTools` — Re-scoped

**Target state.** `Read`, `Write`, `Edit`, and `Highlight` take any document key. `target(key)` resolves a key to its
text from the turn copy or the store, and words its refusal by kind and subject. `Posts` prints post keys. `NewPost`
prints its new post's key. The store window is `Pick<PostStore, 'get' | 'list' | 'create' | 'getOutline' |
'getResearchDocument' | 'createResearchDocument'>`. The header comment still says the AI's text reaches disk only
through the writer's Save, and names the empty creates of `NewPost` and `NewResearchDocument` as the exceptions.

**Behavior.** Preserving for post ids: every input gives the same result and message.

**Why.** The tools refuse anything but a post today (C-8).

**Depends on.** S-2, S-5.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-ai-tools-resolve-any-document-key-through-one-target-function),
[D-7](artifacts/change-decision-log.md#d-7-the-ais-research-and-outline-text-arrives-unsaved-like-its-post-edits-a-research-document-is-created-empty-first)

### S-18: `NewResearchDocument` tool — Added

**Target state.** `fileTools` returns `NewResearchDocument`. It creates an empty research document on a post, puts the
given text in the turn as an unsaved edit, and answers with the document's key. Its schema and result texts are
specified in D-8.

**Behavior.** Changing: it is how research becomes a research document. Settled under the standing instruction.

**Why.** `Write` cannot create a store-assigned id.

**Depends on.** S-17.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-newresearchdocument-tools-contract)

### S-19: The open-document sentence — Re-scoped

**Target state.** `Sessions.chat` adds one of the D-10 sentences, chosen by the open document's kind. Each starts with
`The post open in my editor is <post>` and names the outline's key.

**Behavior.** Changing for the model's input only. A writer sees no difference.

**Why.** The model must be given the outline's key and told what is open.

**Depends on.** S-5.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-the-open-document-sentence-names-the-outline-key-and-the-document-being-looked-at)

### S-20: The system prompt's `<tools>` paragraph — Re-scoped

**Target state.** The paragraph says a post has one outline and any number of research documents, how to name them,
which tool makes or changes each, and never to put research or an outline into the post's text. The D-11 text is exact.

**Behavior.** Changing: research and outlines asked for in plain chat no longer land in the post's text. Settled under
the standing instruction.

**Why.** Plain-language requests never load the research skill.

**Depends on.** S-18.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-the-system-prompt-says-where-research-and-outlines-go)

### S-21: `src/skills/research/SKILL.md` — Re-scoped

**Target state.** The research skill saves its report with one `NewResearchDocument` call on the open post and never
reads or changes the post's text. Its description, intro, tools line, Steps 1, 5, and 6 read as D-13 states.

**Behavior.** Changing: `/research` no longer appends to the post. Settled under the standing instruction.

**Why.** The scope's first sentence.

**Depends on.** S-18.

**Decision.** [D-13](artifacts/change-decision-log.md#d-13-the-research-skill-saves-its-report-as-a-research-document-of-the-open-post)

### S-22: `check.ts` research and outline scenarios — Re-scoped

**Target state.** The check script asserts that `/research` makes one research document of the open post and leaves
the post untouched, and that an outline request becomes the post's unsaved outline. The scenarios are listed in D-14.

**Behavior.** Preserving (test code).

**Why.** Only a live run shows the model following the new skill and prompt (C-6).

**Depends on.** S-19, S-20, S-21.

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-the-live-check-scenarios-assert-the-new-destinations)

### S-23: Chat tool-row text — Re-scoped

**Target state.** A tool row whose `file_path` is an outline or research key reads `outline of <post>` or `research
document in <post>`. A post key reads as today.

**Behavior.** Changing, cosmetic: rows that would show raw JSON show words instead.

**Why.** Raw JSON keys are unreadable to a writer.

**Depends on.** S-5.

**Decision.** [D-26](artifacts/change-decision-log.md#trivial-decisions)

### S-24: The earlier post-management design's text — Re-scoped

**Target state.** `docs/changes/post-management-api/api-design.md` carries the design's items 17–19. I10 says the
message is fixed by subject and reason and lists all four messages. BC3 makes `outline.md` and research subfolders
addressable. Failure Behavior points at the new methods' table.

**Behavior.** Preserving (documentation).

**Why.** The design lists these as part of implementing it.

**Depends on.** S-1, S-2.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-implement-the-store-contract-exactly-as-the-api-design-specifies)

## Behavior Changes

Every one of these was settled by the run lead under the operator's standing instruction ("make the best decisions you
can, without asking me"). Most are what the operator asked for; the rest follow from it.

1. **`/research` makes a research document instead of adding to the post.** With "the sun" open, `/research` leaves the
   post's text untouched. The report appears as a new research document of "the sun", unsaved, in the editor. The
   observer is the writer. Asked for. (S-18, S-21; D-7, D-13)
2. **An outline request becomes the post's outline.** "Outline this post" fills the post's outline, unsaved, instead of
   writing into the post's text. Research asked for in plain chat becomes a research document. The observer is the
   writer. Asked for. (S-20; D-7, D-11)
3. **The left panel shows one post.** It no longer lists every post. It shows the open post's title with its outline
   and research documents, or "No post open. Pick one from your posts." To switch posts, the writer goes Home to the
   post table. The observer is the writer. Asked for. (S-13, S-14; D-15)
4. **New post moves to the post table.** The "+" button at the top of the left panel is gone. The post table's New post
   button is the way to make a post. Follows from 3. (S-12, S-15; D-16)
5. **The editor bar's post name is no longer a button.** Clicking it used to scroll the post list to the post. Follows
   from 3. (S-16; D-17)
6. **Research documents and the outline can be deleted from the panel.** This is a new "…" menu on their rows. It is
   needed because Undo all after `/research` leaves an empty research document, as it leaves an empty post today.
   (S-14; D-18)
7. **Existing `outline.md` files show up.** A writer who already has `outline.md` in a post folder sees it as that
   post's Outline the first time they open the post, and can overwrite it. (S-3; D-24)
8. **New wording.** The paused message reads "Changes to posts and their documents are paused while Claude works. You
   can still open them." The Undo all warning reads "Posts and research documents Claude made stay, empty. Delete them
   if you don't want them." Research failures have their own messages (D-23). (S-12, S-14; D-19, D-23)
9. **Refusal bodies gain `subject`.** Every 4xx from the post routes that the store refused carries
   `"subject":"post"` or `"subject":"research-document"`. Only the page reads it. (S-7; D-6)

## Change Units

### Unit 1: The store implements the design

**What it does.** The post store gains research documents and the outline, exactly as `api-design.md` specifies, with
research tombstones in their own map. Write the contract-suite cases first, then the file store.

**Delta entries.** S-1, S-2, S-3, S-4, S-24.

**How you know it worked.** `make test` passes, including the widened contract suite: the subject on every refusal, a
deleted research id never listed again, two posts holding the same research id, and `setOutline(null)` on no outline.
`src/posts/boundary.test.ts` passes unchanged. The engine, server, and cli compile with no edits.

### Unit 2: Document keys, wire types, routes, and the UI fake

**What it does.** Adds the document key module, the research and outline wire types, the six routes, the subject on
refusals and on `api()` errors, and the same routes in the UI fake. Nothing produces a tagged key yet.

**Delta entries.** S-5, S-6, S-7, S-8, S-9, S-10, S-11.

**Ordering constraint.** After Unit 1: the routes call the new store methods.

**How you know it worked.** `document-key.test.ts` covers the grammar table, round trips, the `1/p 1` id, an id
starting with "[", and non-canonical spellings. Route tests cover each route's success and both 404 subjects. Every
existing UI and route test passes.

### Unit 3: `useDocuments` handles every document kind

**What it does.** The browser's document hook loads, saves, syncs, restores, and names outlines and research documents
by key. It also loads the open post's documents into `postDocs`. The left panel still lists every post.

**Delta entries.** S-12, apart from removing `newPosts`, `requestNewPost`, `finds`, and `findInDocs`, which moves to Unit
4.

**Ordering constraint.** After Unit 2: it calls the new routes, reads `subject`, and uses the fake.

**How you know it worked.** Hook tests, driven through the fake, cover each of these:

- Opening, editing, and saving an outline and a research document.
- A research 404 closing only that document.
- A slow `postDocs` answer for post A, arriving after a switch to B, being dropped.
- An AI edit to a research key and to an absent outline merging as unsaved.
- Restore keeping an outline key.

Every existing post test passes.

### Unit 4: The left panel shows the open post and its documents

**What it does.** Replaces the post list with the post panel, moves New post into the post table, makes the editor
bar's name a heading, and adds Delete for research and outline rows.

**Delta entries.** S-13, S-14, S-15, S-16, and the removals from S-12.

**Ordering constraint.** After Unit 3: the panel reads `postDocs`, `label`, and `removeDocument`.

**How you know it worked.** Panel tests cover each state in D-15's table, the busy pause, and deleting a research
document and the outline. Post-table tests cover New post from the table. `app.test.tsx` passes with the panel in place
of the list. No test references `post-list`.

### Unit 5: The AI saves research and outlines to the open post

**What it does.** The AI tools take document keys, `NewResearchDocument` exists, the open-document sentence names the
outline, the system prompt and the research skill send research and outlines to their new places, and the chat's tool
rows show readable names.

**Delta entries.** S-17, S-18, S-19, S-20, S-21, S-22, S-23.

**Ordering constraint.** After Units 3 and 4: the browser must already accept the keys this unit's tools return. The
prompt, skill, and check change in this one unit so the model never reads contradictory instructions
([D-25](artifacts/change-decision-log.md#d-25-five-change-units-with-the-engine-the-skill-and-the-check-landing-together)).

**How you know it worked.** Tool tests cover each case:

- `target` for each kind and subject.
- Every `NewResearchDocument` result text.
- `Write` to an absent outline.
- Unchanged results for post ids.

Session tests cover each sentence variant. `make test` passes. Then one `bun run check` run with an API key passes the
D-14 scenarios. This is the only way to see the model follow the new skill and prompt.

## Risks

- **The model may not copy a JSON key into `file_path` reliably.** Every outline and research edit depends on it. It is
  detectable in Unit 5's live check (the outline scenario). If it fails, the fallback is wording in the open-document
  sentence and the system prompt. A tool-name change is not needed.
- **Unit 3 is the widest unit.** `documents.tsx` is 972 lines, and every opened document flows through it. The blast
  radius is every document action in the browser. The existing 1,864-line `documents.test.tsx` is the guard. Keep post
  behavior byte-identical, and add kind branches only in `readDocument`, `saveDocument`, `isGone`, `label`, and
  `syncFile`.
- **Empty research documents pile up** when the writer discards or undoes `/research` output (D-7). Delete on the row is
  the remedy (D-18). The Undo all warning says so.
- **The panel's list costs one extra request per sync.** Each store signal re-reads the post list, every open document,
  and now the open post's documents (C-22, design R4). The file watcher already coalesces bursts (100 ms quiet, 1 s at
  most), so this is bounded.
- **Existing `outline.md` files become overwritable** the day Unit 1 ships (design R5). Nothing writes them until Unit 5
  gives the AI a way to, and the writer must save.
- **Carried from the design:** R1 (subject on the wire) is closed by S-7 and S-10. R2 (code that reads `.reason`
  alone) is closed for `tools.ts` by S-17; `posts.routes.ts` search still reads only `get`, which stays correct. R11–R14
  are unchanged.

## Deferred (YAGNI)

- **An outline skill.** The prompt and one `Write` cover it. Reopen when the outline check scenario fails, or when the
  writer asks for an outlining workflow.
  ([D-12](artifacts/change-decision-log.md#d-12-no-outline-skill))
- **Routes and controls to create or rename a research document from the page.** Only the AI creates research documents
  in this change. Reopen when a "New research document" or "Rename" control is asked for. The store methods already
  exist.
  ([D-5](artifacts/change-decision-log.md#d-5-six-new-routes-under-the-post-routes-with-one-combined-listing-for-the-panel))
- **A tool for the model to list a post's research documents.** No request asks the AI to find research it did not make
  in the same turn. Reopen when "draft from my research" is asked for, or the check shows the model cannot find research.
- **A separate hook for a post's documents.** It would share `useDocuments`' refs across a hook boundary. Reopen when a
  second consumer needs `postDocs` without the turn machinery.
  ([D-20](artifacts/change-decision-log.md#d-20-extend-usedocuments-only-two-functions-know-how-to-load-and-save-each-kind))
- **A structured document reference on the wire, and version fields on `view.json` and `session.json`.** The string key
  is backward-compatible for every existing id. Reopen if a key form must change incompatibly.
  ([D-4](artifacts/change-decision-log.md#d-4-one-string-document-key-names-every-document-outside-the-store))

## Cut for Scope

- **Making flat `research.md` files and the root `research/` folder visible.** These would have shown research written
  before this change, such as "the sun/research.md", in the panel. The scope asks that research produced from now on
  belong to the post, and the design left older files to a later decision.
  ([D-24](artifacts/change-decision-log.md#d-24-existing-outlinemd-files-become-the-posts-outline-flat-researchmd-files-stay-hidden);
  [C-30](artifacts/current-state-findings.md#c-30-sample-data-already-holds-outlinemd-and-a-flat-researchmd-beside-draftmd);
  scope-boundary.md, Stated Scope) The operator can reinstate this, and saying so is the justification.

## Open Items

- **Does the model reliably follow the new skill, prompt, and keys?** Non-blocking. Only Unit 5's `bun run check` run
  settles it, and no one in this run could execute a live model.

## Review Findings

Pending the review round.

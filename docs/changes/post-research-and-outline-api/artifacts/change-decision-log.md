# Change Decision Log: Research Documents and an Outline on the Current Post

<!--
This file records every decision committed while planning this change.
The plan itself lives in [../change-plan.md](../change-plan.md). This file captures the
question, rationale, evidence, and rejected alternatives behind each decision.
Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.
The earlier API design's decisions (D1–D11 in decision-log.md) are a separate series and are cited as "design D-n".
-->

Every escalation and behavior-change gate in this run was settled by the run lead under the operator's standing
instruction for planning runs in this repository: "make the best decisions you can, without asking me". Each decision
below that settles a behavior change says so in its **Behavior impact** field. The final summary lists every one of
them for the operator.

## Trivial decisions

- D-1: Where the plan lives — in `docs/changes/post-research-and-outline-api/`, beside `api-design.md`, with its
  companion files in the existing `artifacts/` folder, as stated in the confirmation turn the operator accepted. —
  Referenced in plan: Why This Change.
- D-26: Tool rows in the chat show a readable name for tagged keys — `chat.tsx`'s tool-row text shows
  `outline of <post title or id>` or `research document in <post title or id>` instead of the raw JSON key; a post key
  shows as it does today. — Referenced in plan: Surface Delta (S-23).
- D-27: The panel module's folder is `src/ui/documents/post-panel/` — the folder and component name say what the panel
  now does (one post's documents) rather than what it used to do (list every post). — Referenced in plan: Surface Delta
  (S-13, S-14).

## Full decisions

### D-2: Implement the store contract exactly as the API design specifies

- **Question:** Does the post store implement `api-design.md`'s contract as written, or does integration change it?
- **Decision:** As written: the eight `PostStore` methods, the three research types, `PostErrorSubject` with a required
  `subject`, the per-post order, the failure table, the contract-suite changes (`expectRefusal(promise, reason,
  subject)`), and the comment and earlier-design edits listed under the design's "Changes to Existing Text" (items
  1–20). The only change is where research tombstones live (D-3).
- **Rationale:** The operator asked to implement that design. The architect checked every part of its Store Direction
  against `file-post-store.ts` and found no conflict apart from D-3. Consumers compile untouched: the engine's
  `Omit<PostStore,'watch'>` widens itself (C-1) and test doubles spread a real store (C-2). All 21 `new
  PostError(reason)` sites are inside `src/posts/`.
- **Evidence:** `api-design.md`; C-1; C-2; C-3; architect A1.
- **Behavior impact:** Preserving for every existing caller: post methods, messages, and statuses are unchanged. The new
  methods are additions with no caller until later units.
- **Rejected alternatives:**
  - Re-opening the design's method set (for example cutting `setResearchDocumentTitle`, which no UI control in this
    change calls) — rejected because the design is the decided input, and design D11 already records that the set is
    cheap to trim while the file store is the only implementation.
- **Revisit criterion:** A second `PostStore` implementation is planned (design R9).
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2, S-4, S-24
- **Dependent decisions:** D-3, D-5, D-6
- **Referenced in plan:** Target State, Surface Delta, Change Units

### D-3: Research tombstones live in their own per-post map

- **Question:** Where does the file store remember research document ids it deleted?
- **Decision:** In a separate structure, not in the post tombstone set:
  ```ts
  const tombstones = new Set<string>();                        // post ids, unchanged
  const researchTombstones = new Map<string, Set<string>>();   // postId -> research ids deleted in that post
  const isDeletedResearch = (postId: string, id: string) => researchTombstones.get(postId)?.has(id) ?? false;
  ```
  `claimFolder` and `listedName` take a parent key and an `isDeleted` predicate, so posts (`''`, post tombstones) and
  research documents (`<postKey>/research`, `isDeletedResearch`) share them. `ignoreForWatch` lets `.research.json`
  through as it does `.post.json`.
- **Rationale:** Post ids are "/"-joined folder keys, so the design's `${postId}/research/${id}` tombstone is itself a
  well-formed post id. After a post is deleted, another writer could make a real post at that path and the shared set
  would hide it. One structure per id space keeps `locatePost` and `walk` meaning one thing.
- **Evidence:** architect A1 (`file-post-store.ts:3-4,62,107,138,197`); C-29; design V1, R8.
- **Behavior impact:** Preserving. It changes only an internal structure. The observable rule (a deleted id is never
  listed or reached again through one store) is the design's.
- **Rejected alternatives:**
  - The design's shared set with `${postId}/research/${id}` keys — rejected because that string can collide with a real
    post id (above).
  - A shared set with a hidden-name prefix such as `.research/` — workable, since hidden names are never posts, but less
    legible than a structure keyed by post.
- **Revisit criterion:** Tombstones move out of memory (design R12).
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

### D-4: One string "document key" names every document outside the store

- **Question:** How do the AI tools, the wire, the persisted view, and the browser name a research document or an
  outline, when all of them key by one post-id string today (C-8, C-11, C-13, C-25)?
- **Decision:** A string key with a pinned grammar, owned by a new import-free module `src/shared/document-key.ts`:
  ```ts
  export type DocumentRef =
    | { kind: 'post'; postId: string }
    | { kind: 'outline'; postId: string }
    | { kind: 'research'; postId: string; researchDocumentId: string };

  // Grammar:
  //   post P, P not starting with "[" : P                                  (unchanged from today)
  //   post P, P starting with "["     : JSON.stringify(["post", P])
  //   outline of P                    : JSON.stringify(["outline", P])
  //   research R of P                 : JSON.stringify(["research", P, R])
  export function documentKey(ref: DocumentRef): string;
  // The inverse. undefined for "", for a "[" key that is not one of the three tagged shapes, for ["post", P] where P does
  // not start with "[", and for any key where documentKey(parsed) !== key. So the two are exact inverses.
  export function parseDocumentKey(key: string): DocumentRef | undefined;
  export const postKey = (postId: string) => documentKey({ kind: 'post', postId });
  export const postOfKey = (key: string) => parseDocumentKey(key)?.postId;
  ```
  Worked examples:

  | Ref | Key |
  | --- | --- |
  | post `1/p 1` | `1/p 1` |
  | outline of `1/p 1` | `["outline","1/p 1"]` |
  | research `Sources 2` of `1/p 1` | `["research","1/p 1","Sources 2"]` |
  | post `["outline","x"]` | `["post","[\"outline\",\"x\"]"]` |
  | `[ "outline","x"]` | parses to `undefined` (not canonical) |

  Every `Map<string,…>`, `Record<string,string>`, and persisted name field keeps its type. Only their doc comments change
  from "post id" to "document key".
- **Rationale:** Untagged keys never start with "[" and tagged keys always do, `JSON.stringify` of a string array is
  one-to-one, and the canonical check rejects every other spelling, so the grammar is unambiguous for any post id,
  including ids with "/" and spaces. Every existing post id is its own key, so `view.json` and `session.json` need no
  migration. The research id is carried byte for byte inside the envelope; no code splits, sorts, compares, or shows it,
  which is the "store it and pass it back" the design allows.
- **Evidence:** C-8, C-11, C-13, C-25, C-27; architect A2; three consumers today: `tools.ts`, `documents.tsx`,
  `check.ts`.
- **Behavior impact:** Preserving for every existing post (its key is its id). A persisted name beginning with "[" would
  drop out on restore, and no current store produces such an id.
- **Rejected alternatives:**
  - A path suffix such as `P/outline` or `P/research/R` — rejected because post ids contain "/" (`series/one`, the UI
    fake's `1/p 1`), so it is ambiguous.
  - A structured `DocumentRef` on the wire and in the hook — rejected because it changes the type of every map and
    record for the same coverage, and maps would still need a string key.
- **Revisit criterion:** A fourth document kind, or a kind needing more than three components.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5, S-8
- **Dependent decisions:** D-5, D-7, D-9, D-10, D-20
- **Referenced in plan:** Target State, Surface Delta

### D-5: Six new routes under the post routes, with one combined listing for the panel

- **Question:** Which HTTP routes does the browser need, and in what shape?
- **Decision:** Six routes in `postRoutes`, each id one `encodeURIComponent`'d path segment:

  | Method and path | Body | 200 answer | Store call |
  | --- | --- | --- | --- |
  | `GET /api/posts/:id/documents` | — | `PostDocuments` | `listResearchDocuments(id)`, then `getOutline(id)` |
  | `GET /api/posts/:id/outline` | — | `Outline` | `getOutline(id)` |
  | `PUT /api/posts/:id/outline` | `SetOutlineBody` | `{ ok: true }` | `setOutline(id, outline)` |
  | `GET /api/posts/:id/research/:rid` | — | `ResearchDocument` | `getResearchDocument(id, rid)` |
  | `PUT /api/posts/:id/research/:rid/body` | `SetBodyBody` | `{ ok: true }` | `setResearchDocumentBody(id, rid, body)` |
  | `DELETE /api/posts/:id/research/:rid` | — | `{ ok: true }` | `deleteResearchDocument(id, rid)` |

  Wire types in `src/shared/wire.ts`, restated by hand per C-17:
  ```ts
  export interface ResearchDocumentSummary { id: string; title: string; }
  export interface ResearchDocument extends ResearchDocumentSummary { body: string; }
  // GET /api/posts/:id/documents. Research in no order; the page sorts by title.
  export interface PostDocuments { outline: boolean; researchDocuments: ResearchDocumentSummary[]; }
  // GET /api/posts/:id/outline. null: the post has no outline; "": an empty one.
  export interface Outline { outline: string | null; }
  // PUT /api/posts/:id/outline. A string creates or replaces it; null removes it.
  export interface SetOutlineBody { outline: string | null; }
  ```
  `SetOutlineBody` is validated with a zod schema like the other bodies (`outline: z.string().nullable()`).
- **Rationale:** Each route has a named caller in this change: the panel's listing, opening, saving, and deleting the
  outline and research documents. One `/documents` listing serves the panel with one request and one latest-wins guard
  (D-21). Calling the two store methods one after the other is safe because both are per-post ordered: a delete between
  them gives a 404 with subject `post`, never half an answer.
- **Evidence:** C-17, C-18; architect A3.
- **Behavior impact:** Preserving for the existing routes. The new routes are additions.
- **Rejected alternatives:**
  - `POST /api/posts/:id/research` and `PUT …/research/:rid/title` — deferred (YAGNI): no control in this change creates
    or renames a research document from the page; only the AI creates them.
  - Separate list and outline requests — rejected: two guards, and an outline body fetched only to learn whether it
    exists.
- **Revisit criterion:** A "New research document" or "Rename" control is asked for.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6, S-9
- **Dependent decisions:** D-18, D-20, D-21
- **Referenced in plan:** Target State, Surface Delta, Deferred (YAGNI)

### D-6: Refusal bodies carry the error's subject, and the page reads it

- **Question:** How does the page tell "the post is gone" from "this research document is gone" (C-14, C-15, design R1)?
- **Decision:**
  ```ts
  export type ApiErrorSubject = 'post' | 'research-document';   // restates PostErrorSubject
  export interface ApiError {
    error: string;
    // Present on every refusal the store made. Absent on a bad request body.
    subject?: ApiErrorSubject;
  }
  ```
  `onError` sends `{ error: error.message, subject: error.subject }` with the same status rule as today. `api()` in
  `src/ui/components/api.ts` attaches `subject` to the thrown error next to `status` when the body's `subject` is a
  string. The page's rule: 404 with `subject: 'research-document'` closes only that research document; 404 with
  `subject: 'post'`, or with no subject, means the post is gone. The UI fake sends `subject` on its 404s and copies the two
  new messages.

  Worked example: `GET /api/posts/the%20sun/research/Gone` answers `404 {"error":"That research document no longer
  exists.","subject":"research-document"}`. `GET /api/posts/Gone/research/x` answers `404 {"error":"That post no longer
  exists.","subject":"post"}`.
- **Rationale:** The page already tells failures apart by structured fields (`status`). Matching message strings would
  copy `post-error.ts` text into the page.
- **Evidence:** C-14, C-15, C-16, C-26; design R1; architect A3.
- **Behavior impact:** Changing, additively: every refusal body from the post routes gains a `subject` field. Nothing
  reads the body's fields other than `error` today. Settled under the standing instruction.
- **Rejected alternatives:**
  - New reasons or status codes for research — rejected by the design (`posts.routes.ts:20` maps by reason).
  - Matching the message text — rejected above.
- **Revisit criterion:** A client outside this repository reads the post routes.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-10, S-11
- **Dependent decisions:** D-22, D-23
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-7: The AI's research and outline text arrives unsaved, like its post edits; a research document is created empty first

- **Question:** When the AI produces research or an outline, does it save it to the store at once, or does it arrive as
  an unsaved edit the writer reviews and saves?
- **Decision:** As an unsaved edit, for both:
  - **Research** needs a store-assigned id before the page can hold it, so a new tool, `NewResearchDocument` (D-8),
    creates the research document empty in the store and puts the text in the turn as an unsaved edit. This mirrors
    `NewPost`.
  - **The outline** is named by its post and needs no id. The AI writes the whole outline to the outline's key with
    `Write`. No store call happens. The page loads an absent outline as an empty document, merges the text in as unsaved,
    and Save creates it.
- **Rationale:** The tools' header and the system prompt promise that the AI's text reaches disk only through the
  writer's Save (C-9). Saving directly would skip the review, the highlights, and Undo all (C-9, concurrency K8), and
  for the outline it would silently replace an existing one. `NewPost` is the existing precedent for "create empty, text
  unsaved".
- **Evidence:** C-9, C-11, C-12; architect A4.
- **Behavior impact:** Changing. After the change, an outline the writer asks for appears as the post's outline, unsaved,
  instead of landing in the post's text. Undo all or a discard after `/research` leaves an empty research document
  behind, exactly as it leaves an empty post after `NewPost`; the panel's Delete (D-18) removes it. Settled under the
  standing instruction; the operator's request names both behaviors.
- **Rejected alternatives:**
  - Save research directly with its full text (one call simpler) — rejected: it bypasses review and Undo all, and breaks
    the rule that AI text arrives unsaved.
  - Save the outline directly — rejected: it would overwrite an existing outline with no review.
- **Revisit criterion:** The writer asks for research to be saved without review.
- **Dissent (if any):** None.
- **Settles delta entry:** S-17, S-18
- **Dependent decisions:** D-8, D-9, D-11, D-13, D-18
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Behavior Changes

### D-8: The `NewResearchDocument` tool's contract

- **Question:** What exactly does the new tool take and answer?
- **Decision:**
  ```ts
  NewResearchDocument: tool({
    description: "Save research as a new research document of a post, from a title and its text. The document is made empty at once, and the text appears in the writer's editor as an unsaved edit, for them to review and save. The post's own text is not changed. Returns the document's name, which names it to Read, Edit, Write, and Highlight.",
    inputSchema: z.object({ post_id: z.string(), title: z.string(), content: z.string() }),
  })
  ```
  Results, exactly:
  - Made: `made research document ${key} titled ${JSON.stringify(title)} on post ${JSON.stringify(post_id)}; its text is
    in the editor, unsaved` — `key` printed raw, since it is already JSON, for example
    `["research","the sun","Sources"]`.
  - `post_id` is not a post key (`parseDocumentKey(post_id)?.kind !== 'post'`): `${post_id} is not a post. Call Posts to
    list the posts by id.`
  - A `PostError`: its message, returned rather than thrown, as `NewPost` does ("A research document needs a title." or
    "That post no longer exists.").
  - Unsupported markdown in `content`: `refuseUnsupported(title, '', content)`, as `NewPost`.

  After a successful create: `markEdited(turn, key, content)`, `highlightChanges(turn, key, content,
  postBlocks(content))`, `onChange()`.
- **Rationale:** `Write` cannot mint a store id, and the scope says research is "a separate research document". Copying
  `NewPost`'s shape keeps one pattern for "make, then edit unsaved".
- **Evidence:** C-9, C-10; architect A4.
- **Behavior impact:** Changing (it is how D-7's research behavior happens). Settled under the standing instruction.
- **Rejected alternatives:**
  - Overloading `NewPost` with a `post_id` — rejected: one tool would make two different things.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-18
- **Dependent decisions:** D-13, D-14
- **Referenced in plan:** Target State, Surface Delta

### D-9: The AI tools resolve any document key through one `target` function

- **Question:** How do `Read`, `Write`, `Edit`, and `Highlight` reach an outline or a research document?
- **Decision:** `target(key)` replaces `storedBody` plus `target` in `tools.ts` and is the one place that branches on
  kind. The turn copy wins; otherwise:
  - unparseable, or a post the store does not find: throw the unchanged
    `${key} is not a post. Call Posts to list the posts by id, or NewPost to make one.`
  - outline: `getOutline(postId)`. A string is the text; `null` is text `''` with `absentOutline: true`. A missing post
    gives the "is not a post" error for the post's key.
  - research: `getResearchDocument(postId, id)`. Subject `research-document` throws
    `${key} is not a research document of the post ${JSON.stringify(postKey(postId))}. NewResearchDocument makes one.`
    Subject `post` gives the "is not a post" error for the post's key.

  `Read` keeps its order (app skill file, turn copy, then `target` for a key it accepts, then a workspace file). On an
  absent outline it answers `the post ${JSON.stringify(postKey)} has no outline yet; Write the whole outline to ${key}
  to make one`. `Write` uses `''` as the base of an absent outline. `Posts` prints each id as `postKey(id)` and `NewPost`
  prints `JSON.stringify(postKey(id))`; both are unchanged for every real id. The tools' `Pick` grows to
  `'get' | 'list' | 'create' | 'getOutline' | 'getResearchDocument' | 'createResearchDocument'`.
- **Rationale:** One dispatch point instead of one per tool. Deciding the message by `subject` retires design R2 in
  `tools.ts`.
- **Evidence:** C-1, C-8; design R2; architect A4.
- **Behavior impact:** Preserving for post ids: every existing input gives the same result and the same messages.
- **Rejected alternatives:**
  - Separate `ReadOutline`/`WriteOutline` tools — rejected: more tools for the model to choose between, and `Edit` and
    `Highlight` would need copies too.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-17
- **Dependent decisions:** D-10, D-11
- **Referenced in plan:** Target State, Surface Delta

### D-10: The open-document sentence names the outline's key and the document being looked at

- **Question:** How does the model learn the outline's key, or that the writer is looking at a research document?
- **Decision:** `sessions.ts` builds the sentence from `parseDocumentKey(openFile)`:
  ```
  post open:     The post open in my editor is "the sun". When my message does not name a post, it means this post. Its outline, if it has one, is named ["outline","the sun"].
  outline open:  The post open in my editor is "the sun", and I am looking at its outline, ["outline","the sun"]. When my message does not name a post, it means this post.
  research open: The post open in my editor is "the sun", and I am looking at its research document ["research","the sun","Sources"]. When my message does not name a post, it means this post. Its outline, if it has one, is named ["outline","the sun"].
  unparseable:   no sentence, as with no openFile
  ```
  The post id is quoted with `JSON.stringify(postId)` as today; tagged keys are printed raw.
- **Rationale:** Every variant keeps the prefix `The post open in my editor is <post>`, which the research skill and
  `check.ts` rely on (C-4, C-6). The model never builds a key; it copies one it was given.
- **Evidence:** C-4, C-27; architect A4.
- **Behavior impact:** Changing for the model's input only (one added clause). Nothing a writer sees changes. Old turns
  in `session.json` keep the old wording, which still reads correctly.
- **Rejected alternatives:**
  - Teaching the model the key grammar in the system prompt — rejected: asking a model to build JSON keys invites
    mistakes; copying a given string does not.
- **Revisit criterion:** The live check shows the model mis-copying keys.
- **Dissent (if any):** None.
- **Settles delta entry:** S-19
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

### D-11: The system prompt says where research and outlines go

- **Question:** What does the model read about the new document kinds?
- **Decision:** In `system-prompt.ts`'s `<tools>` paragraph, replace "Use Edit to change part of a post, Write to replace
  a whole post, and NewPost to make a new post from a title and its text." with:
  > A post can have one outline and any number of research documents. Name a post's outline as my message gives it, and
  > a research document by the name NewResearchDocument returned or my message gives; Read, Edit, Write, and Highlight
  > take those names as they take a post's id. Use Edit to change part of a post, outline, or research document, Write to
  > replace a whole one, NewPost to make a new post, and NewResearchDocument to save research as a new research document
  > of a post. To make or replace a post's outline, Write the whole outline to its outline's name. Never put research or
  > an outline into the post's own text.

  The following "unsaved edit" sentence stays and is true for all three kinds.
- **Rationale:** "Other request for research" and "when an outline is created" (the scope) cover requests that do not go
  through `/research`; only the system prompt reaches those.
- **Evidence:** C-7; scope-boundary.md; architect A4.
- **Behavior impact:** Changing: research or an outline asked for in plain chat lands in a research document or the
  outline instead of the post's text. Settled under the standing instruction; the operator's request asks for it.
- **Rejected alternatives:**
  - Relying on the research skill alone — rejected: plain-language requests never load the skill.
- **Revisit criterion:** The live check shows the model ignoring it.
- **Dissent (if any):** None.
- **Settles delta entry:** S-20
- **Dependent decisions:** D-12
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-12: No outline skill

- **Question:** Does making an outline need its own skill, like `/research`?
- **Decision:** No. The system prompt (D-11) and the open-document sentence (D-10) give the model the outline's name, and
  making an outline is one `Write`.
- **Rationale:** YAGNI: no finding describes an outline procedure with steps, and nothing exists to extend (C-7).
- **Evidence:** C-7; architect A4.
- **Behavior impact:** Preserving (nothing is added).
- **Rejected alternatives:**
  - A `/outline` skill — deferred; see the plan's Deferred (YAGNI) section.
- **Revisit criterion:** The outline check scenario (D-14) fails, or the writer asks for an outlining workflow.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Deferred (YAGNI)

### D-13: The research skill saves its report as a research document of the open post

- **Question:** What changes in `src/skills/research/SKILL.md`?
- **Decision:** These edits, and no others:
  - **Frontmatter description:** "…then writes an evidence-backed, self-validated report into the post open in the
    editor…" becomes "…then saves an evidence-backed, self-validated report as a new research document of the post open
    in the editor…".
  - **Intro:** "writes a report into the post open in the editor" becomes "saves its report as a new research document
    of the post open in the editor".
  - **Tools line:** "Your tools are Read, Write, Edit, Glob, Highlight, NewResearchDocument, `web_search`, and
    `web_fetch`. A turn has a limit of 20 tool calls for Read, Write, Edit, Glob, Highlight, and NewResearchDocument."
  - **Next sentence:** "The report you save with NewResearchDocument appears in the writer's editor as a new research
    document of the open post, unsaved, and the writer saves it. The post's own text is never changed."
  - **Step 1:** "find the post the report goes into" becomes "find the post the report belongs to"; the no-post branch
    stays word for word.
  - **Step 5:** "**Save the report as a research document of the open post**, in one NewResearchDocument call:
    `post_id` is the open post's id exactly as the message gives it, `title` a short title naming the question,
    `content` the whole report. Do not Read, Write, or Edit the post itself. When NewResearchDocument refuses, say why in
    one line and put the whole report in the chat instead."
  - **Step 6:** "Say which file holds the report" becomes "Say the report is the research document titled "<title>" of
    the open post".
- **Rationale:** The scope's first sentence. The 20-call budget holds, since one `Write` becomes one
  `NewResearchDocument`, and Step 5 no longer needs the post's Read.
- **Evidence:** C-5; scope-boundary.md; architect A4.
- **Behavior impact:** Changing: after `/research` with "the sun" open, the post's text is untouched and the report is a
  new, unsaved research document of "the sun". Settled under the standing instruction; it is the operator's first ask.
- **Rejected alternatives:**
  - Keeping the post append as a fallback — rejected: the writer's text must not change, and the chat is already the
    fallback.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-21
- **Dependent decisions:** D-14
- **Referenced in plan:** What Changes, In One Paragraph; Surface Delta; Behavior Changes

### D-14: The live check scenarios assert the new destinations

- **Question:** What do `check.ts`'s research scenarios assert, and is there an outline scenario?
- **Decision:**
  - "research with no post open asks for one and writes nothing": unchanged.
  - "research writes its report into the open post, after the text already there" is replaced by **"research saves its
    report as a research document of the open post and leaves the post alone"**, asserting: exactly one edited key;
    `parseDocumentKey(key)` is `{ kind: 'research', postId: ideas }`; `edited[ideas]` is undefined;
    `GET /api/posts/:ideas/documents` lists that id with a non-blank title; `GET /api/posts/:ideas`'s body still equals
    the starting text; `/sources/i` matches the report; the report has no unsupported markdown; the turn's tools include
    `NewResearchDocument`.
  - New: **"outline: asked for an outline with a post open, it becomes the post's outline, unsaved"**. Open `ideas`, send
    "Outline this post", assert the edited keys are exactly `[documentKey({ kind: 'outline', postId: ideas })]` and
    `GET /api/posts/:ideas/outline` is still `{ outline: null }`.
- **Rationale:** The check script is the only thing that observes the model following the skill and prompt (C-6).
- **Evidence:** C-6; architect A4.
- **Behavior impact:** Preserving (test code).
- **Rejected alternatives:** —
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-22
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Change Units

### D-15: The left panel shows only the open post and its documents

- **Question:** What does the left panel show after the change?
- **Decision:** `PostList` is removed and `PostPanel` (in `src/ui/documents/post-panel/`, D-27) takes its place in
  `app.tsx`:

  | State | The panel shows |
  | --- | --- |
  | Nothing open | `3pitor`, then "No post open. Pick one from your posts." The post table fills the editor area, as today. |
  | A post, its outline, or one of its research documents is open | A heading button with the post's title (or its id, plus " — unsaved, not in your posts" when the post is gone) and a "…" menu with Rename and Delete. Beneath it: an "Outline" row when the post has an outline or an unsaved one is open; then a "Research" heading and one row per research document, sorted by title only. The open document's row is marked active, and " (unsaved)" follows any row with unsaved changes. |
  | Unsaved documents whose post or research document is gone | A last group, as the "missing" rows are today: the label plus " — unsaved, not in your posts" (post) or " — unsaved, no longer in its post" (research). Clicking one opens it. |

  Clicking the heading opens the post, "Outline" opens the outline, and a research row opens that document. All three
  open in the editor, editable and saveable like a post; the read-only rule for unsupported markdown applies unchanged.
  The research rows and the Outline row have no "Research"/"Outline" heading when the post has neither.
- **Rationale:** The scope's third sentence. Post selection already lives in the post table (C-20), so the panel's
  every-post list is the part that goes. The "missing" group is kept because it is the only way back to unsaved changes
  that are no longer stored (C-14, C-19).
- **Evidence:** C-14, C-19, C-20; scope-boundary.md; architect A5.
- **Behavior impact:** Changing: the left panel no longer lists every post; to switch posts the writer goes Home to the
  post table. Settled under the standing instruction; the operator's request asks for it and the confirmation turn
  stated the post-table route.
- **Rejected alternatives:**
  - Dropping post Rename and Delete from the panel because the table has them — rejected: it removes an action the
    writer has today without a request to.
  - Keeping the all-posts list collapsed beneath the current post — rejected: the request says the panel should "no
    longer show all available posts".
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-13, S-14
- **Dependent decisions:** D-16, D-17, D-18, D-19
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Behavior Changes

### D-16: New post lives only in the post table

- **Question:** Where does the "+" New post control go once the panel stops listing posts?
- **Decision:** The panel has no "+" button. The post table's New post button calls its own
  `usePostDialogs(...).askNewPost` (the table already mounts that hook). `newPosts`/`requestNewPost` are removed from
  `useDocuments` and from `PostTableDocs`.
- **Rationale:** New post is choosing which post to work on, which is the table's job. The `newPosts` counter exists only
  so the table could reach the panel's dialog (C-19); with the dialog in the table it has no producer.
- **Evidence:** C-19, C-20; architect A5.
- **Behavior impact:** Changing: the "+" button at the top of the left panel is gone; New post is on the post table.
  Settled under the standing instruction.
- **Rejected alternatives:**
  - Keeping "+" in the panel header — rejected: it would keep the counter and dialog host for a control the table
    already has.
- **Revisit criterion:** The writer asks for New post while a post is open.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12, S-15
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-17: The editor bar's post name becomes a plain heading

- **Question:** What happens to the editor bar's "Show “…” in the post list" button?
- **Decision:** It is removed, along with `finds` and `findInDocs`. The name becomes a non-interactive
  `<h2 tabIndex={-1}>` that still receives the focus the code moves to it today. Its text is `label(current)`.
- **Rationale:** The panel shows only the open post, so there is nothing to scroll to.
- **Evidence:** C-19; architect A5.
- **Behavior impact:** Changing: the post name in the editor bar is no longer a button. Settled under the standing
  instruction.
- **Rejected alternatives:**
  - Keeping the button to focus the panel heading — rejected: no finding shows a need.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-16
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes

### D-18: Research and outline rows have a Delete action

- **Question:** Can the writer remove a research document or the outline from the panel?
- **Decision:** Yes. Each research row and the Outline row has a "…" menu with Delete. Delete asks "Delete “<title>”? Its
  text goes for good." Confirming sends `DELETE …/research/:rid` or `PUT …/outline { outline: null }`, then forgets the
  document and refreshes the panel. The hook gains `removeDocument(key)`.
- **Rationale:** D-7 leaves an empty research document behind after Undo all or a discard, as `NewPost` leaves an empty
  post. Without Delete the writer could never remove it from the page.
- **Evidence:** D-7; `documents.tsx:590-595` (the Undo all warning tells writers to delete posts Claude made); architect
  A5.
- **Behavior impact:** Changing (a new control). Settled under the standing instruction.
- **Rejected alternatives:**
  - No delete — rejected: empty research documents would pile up.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-19: The "Claude is working" pause covers every panel menu

- **Question:** What does the panel lock while Claude works?
- **Decision:** While busy, every "…" menu in the panel (post, outline, research) is disabled; opening rows stays
  allowed. The `#tree-paused` paragraph stays in the panel at all times (the table's `aria-describedby` points at it).
  Its text becomes "Changes to posts and their documents are paused while Claude works. You can still open them."
- **Rationale:** The reason for the pause is unchanged: the keys the AI's edits come back under must stay current
  (C-21). Research and outline keys need the same protection.
- **Evidence:** C-21; architect A5.
- **Behavior impact:** Changing (the paused message's wording). Settled under the standing instruction.
- **Rejected alternatives:**
  - Gating edits and saves of the open document too — rejected: today's pause does not, and the merge handles it (C-12).
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes

### D-20: Extend `useDocuments`; only two functions know how to load and save each kind

- **Question:** Split `useDocuments` or extend it, and where does kind-specific I/O live?
- **Decision:** Extend it. Every map stays `Map<string,…>` keyed by document key. `postUrl` and `readFile` are replaced
  by:
  ```ts
  // A document's stored text now, and its title when it has one. null: an outline the post does not have.
  // Rejects with the request's error ({ status, subject }).
  async function readDocument(key: string): Promise<{ text: string | null; title?: string }>;
  //   post     -> GET /api/posts/:p               -> { text: body }
  //   outline  -> GET /api/posts/:p/outline       -> { text: outline }
  //   research -> GET /api/posts/:p/research/:rid -> { text: body, title }
  //   unparseable key -> reject Error('not a document') with status 404, subject 'post'
  async function saveDocument(key: string, text: string): Promise<void>;
  //   post -> PUT …/body { body }; outline -> PUT …/outline { outline: text }; research -> PUT …/research/:rid/body { body }
  ```
  `ensureLoaded` loads `text ?? ''`. `Entry` gains `title?: string` from the research read. The hook's API divides into
  key-taking members (`open`, `save`, `isDirty`, `label`, `discard`, `current`, `missing`), post-id-taking members
  (`createPost`, `rename`, `remove`, `search`), and new members (`postDocs`, `removeDocument(key)`). `remove(postId)` also
  forgets every opened key whose post is that post. `label(key)`: post → listed title, else its id; outline →
  `Outline: ${label(postKey(P))}`; research → the `postDocs` title, else `entry.title`, else `Research document`.
  `PostTable` calls `open(postKey(id))` and `isDirty(postKey(id))`.

  Turn plumbing: `turnListed` holds the listed post keys plus the current `postDocs` keys, so "made" means "not known at
  Send"; `applyEditedNow` refreshes the post list only when `postOfKey(name)` is not listed; `undoTurn` also forgets a
  document whose outline read returns `null`.
- **Rationale:** Load, save, sync, turn, and persistence already share `opened` and the turn refs; a second hook would
  share them across a hook boundary. Kind knowledge stays in `readDocument`, `saveDocument`, `isGone`, and `label`.
- **Evidence:** C-11, C-12, C-13; architect A6.
- **Behavior impact:** Preserving for posts.
- **Rejected alternatives:**
  - A separate hook for a post's documents — rejected above; deferred under YAGNI.
- **Revisit criterion:** A second consumer needs `postDocs` without the turn machinery.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** D-21, D-22, D-23
- **Referenced in plan:** Target State, Surface Delta, Deferred (YAGNI)

### D-21: The panel's list has its own latest-wins guard, keyed by post

- **Question:** How does the page load the open post's documents without showing post A's list under post B (C-23)?
- **Decision:**
  ```ts
  const [postDocs, setPostDocs] = useState<{ postId: string } & PostDocuments>();
  const postDocsCalls = useRef(0);
  const refreshPostDocs = async (postId = currentPostRef.current) => {
    const call = ++postDocsCalls.current;
    if (postId === undefined) { setPostDocs(undefined); return; }
    const docs = await api<PostDocuments>('GET', `/api/posts/${encodeURIComponent(postId)}/documents`)
      .catch((e) => (e.status === 404 ? { outline: false, researchDocuments: [] } : Promise.reject(e)));
    if (call !== postDocsCalls.current || currentPostRef.current !== postId) return;
    setPostDocs({ postId, ...docs });
  };
  ```
  It runs when the current post changes (moving between one post's documents does not refetch), in `syncOnce` after
  `refreshList`, after `removeDocument`, and in `applyEditedNow` when a loaded key is not a post.
- **Rationale:** The counter drops an older answer for the same post; the post check drops a slow answer for A after a
  switch to B. Both are needed.
- **Evidence:** C-22, C-23; concurrency K1; architect A6.
- **Behavior impact:** Preserving (new state).
- **Rejected alternatives:**
  - Reusing `listCalls` — rejected: it would drop the post list's answer whenever a documents refresh started later.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

### D-22: "Gone" and disk sync are decided per kind

- **Question:** When is an opened research document or outline "gone", and what does a sync do with it?
- **Decision:**
  ```ts
  const goneDocs = useRef(new Set<string>());   // research keys a read answered 404 'research-document'
  const isGone = (key: string) => {
    const ref = parseDocumentKey(key);
    if (!ref) return true;
    const postGone = listLoaded.current && !isListed(ref.postId);
    return ref.kind === 'research' ? postGone || goneDocs.current.has(key) : postGone;
  };
  ```
  `syncFile`:

  | Read result | Entry has no unsaved changes | Entry has unsaved changes |
  | --- | --- | --- |
  | 404, subject `post` (any kind) | forget, as for a post today | keep; gone through the post list |
  | 404, subject `research-document` | forget | add to `goneDocs`; keep |
  | outline `null` | forget (the outline was removed) | keep; Save recreates it |
  | text | remove from `goneDocs`; today's compare and follow logic | today's changed-on-disk logic |

  An outline is never gone while its post exists. Restore keeps a key when its post is listed:
  `known(key) = !listed || (ref = parseDocumentKey(key)) && listed.has(ref.postId)`.
- **Rationale:** A research 404 must not close the post (C-14, design R1), and the post-list test alone cannot see a
  deleted research document.
- **Evidence:** C-14, C-15, C-22, C-25; concurrency K3; architect A6.
- **Behavior impact:** Preserving for posts.
- **Rejected alternatives:**
  - Using the panel's research list as the gone test — rejected: it only covers the current post, and an unsaved
    research document of another post can stay open after a switch.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** D-23
- **Referenced in plan:** Target State, Surface Delta

### D-23: New messages for research documents; post messages unchanged

- **Question:** What does the writer read when a research document fails or is gone?
- **Decision:** Exact texts:
  - Save fails with 404, subject `research-document`: `Could not save “${label}”: That research document no longer
    exists. Copy your changes into another document.`
  - Gone notice for a research key: "These unsaved changes belong to a research document that is no longer in its post,
    so they can't be saved here. To keep them, copy them into another document. Then discard them."
  - The Undo all warning's sentence about made documents: "Posts and research documents Claude made stay, empty. Delete
    them if you don't want them."
  - Every post message, and the "Ask Claude again with the post open." tail, is unchanged.
- **Rationale:** Without these, a research failure reads "That post no longer exists" (C-11, C-16).
- **Evidence:** C-11, C-16; architect A6.
- **Behavior impact:** Changing: the Undo all warning's wording changes, and research documents get their own failure
  texts. Settled under the standing instruction.
- **Rejected alternatives:** —
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes

### D-24: Existing `outline.md` files become the post's outline; flat `research.md` files stay hidden

- **Question:** What happens to outline and research files already in writers' post folders?
- **Decision:** As the design states: a regular `outline.md` in a post folder is that post's outline from the day this
  ships, visible in the panel and overwritable. A flat `research.md` and the root `research/` folder stay invisible
  through the store and are still deleted with their post.
- **Rationale:** The outline file's layout matches (C-30, design R5). Flat research files do not fit the
  one-folder-per-document layout, and the scope does not ask for them.
- **Evidence:** C-30; design R5, F34, cut list.
- **Behavior impact:** Changing: a writer with an `outline.md` sees it under the post as "Outline". Settled under the
  standing instruction.
- **Rejected alternatives:**
  - Migrating flat `research.md` into a research document — cut for scope; see the plan's Cut for Scope.
- **Revisit criterion:** The writer asks to see older research files.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes, Cut for Scope

### D-25: Five change units, with the engine, the skill, and the check landing together

- **Question:** In what order is the change made?
- **Decision:** (1) the store; (2) the document key, wire, routes, and UI fake; (3) `useDocuments`; (4) the panel, the
  table, and the editor bar; (5) the engine tools, the open-document sentence, the system prompt, the research skill,
  the check scenarios, and the tool-row labels.
- **Rationale:** Each unit leaves `make test` passing. The page can take tagged keys (units 3–4) before the engine
  emits them (unit 5). The prompt, skill, and check change together in unit 5 so the model never reads "never put
  research into the post" next to a skill that says to append it.
- **Evidence:** C-1, C-2 (consumers compile as the store grows); architect's change units, with its units 5 and 6
  merged.
- **Behavior impact:** Preserving (sequencing).
- **Rejected alternatives:**
  - The architect's six units, with the skill after the engine — rejected for the contradiction above.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Change Units

# Change Decision Log: Research Documents and an Outline on the Current Post

<!--
This file records every decision committed while planning this change.
The plan itself lives in [../change-plan.md](../change-plan.md). This file captures the
question, rationale, evidence, and rejected alternatives behind each decision.
Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.
The earlier API design's decisions (D1–D11 in decision-log.md) are a separate series and are cited as "design D-n".
Review findings are cited by the reviewer's own identifiers: JD-n (junior-developer), T-n and section numbers
(test-engineer), UX-n (user-experience-designer), R-n (risk-analyst, written "risk R-n" to keep them apart from the
design's R-n).
-->

Every escalation and behavior-change gate in this run was settled by the run lead under the operator's standing
instruction for planning runs in this repository: "make the best decisions you can, without asking me". Each decision
below that settles a behavior change says so in its **Behavior impact** field. The final summary lists every one of
them for the operator.

## Trivial decisions

- D-1: Where the plan lives — in `docs/changes/post-research-and-outline-api/`, beside `api-design.md`, with its
  companion files in the existing `artifacts/` folder, as stated in the confirmation turn the operator accepted. —
  Referenced in plan: Why This Change.
- D-26: The chat shows readable names for outline and research keys — the tool-row text and the screen-reader status
  line ("Claude is working on …") show `outline of <post>` or `research document in <post>` for a tagged key, and the
  `NewResearchDocument` row shows `research document “<title>” in <post>`; a post key shows as it does today (UX-011,
  UX-012). — Referenced in plan: Surface Delta (S-23).
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
- **Evidence:** `api-design.md`; C-1; C-2; C-3; architect A1; test-engineer section 1 (the contract suite pins the post
  paths).
- **Behavior impact:** Preserving for every existing caller: post methods, messages, and statuses are unchanged. The new
  methods are additions with no caller until later units.
- **Rejected alternatives:**
  - Re-opening the design's method set (for example cutting `setResearchDocumentTitle`, which no UI control in this
    change calls) — rejected because the design is the decided input, and design D11 records that the set is cheap to
    trim while the file store is the only implementation. The junior developer and the test engineer agreed (JD Q7).
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
- **Evidence:** architect A1 (`file-post-store.ts:3-4,62,107,138,197`); C-29; design V1, R8; risk R9 (low, covered by
  the contract suite).
- **Behavior impact:** Preserving. It changes only an internal structure. The observable rule (a deleted id is never
  listed or reached again through one store) is the design's. Every post path now runs through the changed
  `claimFolder`/`listedName`, so the existing post tests in `file-post-store.test.ts` and the contract suite are the
  guard and keep their assertions unchanged (test-engineer section 4).
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

### D-4: One string document key names every document outside the store, with outline and research keys marked by a leading dot

- **Question:** How do the AI tools, the wire, the persisted view, and the browser name a research document or an
  outline, when all of them key by one post-id string today (C-8, C-11, C-13, C-25)?
- **Decision:** A string key with a pinned grammar, owned by a new import-free module `src/shared/document-key.ts`.
  A post's key is always its id. An outline's or research document's key is "." followed by a JSON array:
  ```ts
  export type DocumentRef =
    | { kind: 'post'; postId: string }
    | { kind: 'outline'; postId: string }
    | { kind: 'research'; postId: string; researchDocumentId: string };

  // Grammar:
  //   post P          : P                                          (every post id, unchanged from today)
  //   outline of P    : "." + JSON.stringify(["outline", P])
  //   research R of P : "." + JSON.stringify(["research", P, R])
  export function documentKey(ref: DocumentRef): string;
  // The inverse:
  //   ""                                      -> undefined
  //   a key not starting with "."            -> { kind: 'post', postId: key }
  //   "." + a canonical ["outline", P] or ["research", P, R] of strings -> that ref
  //   any other key starting with "."        -> undefined
  // "Canonical" means documentKey(parsed) === key, so the two are exact inverses on every key parse accepts.
  export function parseDocumentKey(key: string): DocumentRef | undefined;
  export const postKey = (postId: string) => documentKey({ kind: 'post', postId });
  export const postOfKey = (key: string) => parseDocumentKey(key)?.postId;
  ```
  Worked examples:

  | Ref | Key |
  | --- | --- |
  | post `1/p 1` | `1/p 1` |
  | post `[Draft] Sun` | `[Draft] Sun` |
  | outline of `1/p 1` | `.["outline","1/p 1"]` |
  | research `Sources 2` of `1/p 1` | `.["research","1/p 1","Sources 2"]` |
  | `.[ "outline","x"]` | parses to `undefined` (not canonical) |
  | `.3pitor/notes.md` | parses to `undefined` (starts with "." and is not a tagged array) |

  Every `Map<string,…>`, `Record<string,string>`, and persisted name field keeps its type. Only their doc comments change
  from "post id" to "document key".
- **Rationale:** No post id starts with ".": the store refuses any id with a hidden segment (`file-post-store.ts:109`,
  `segments.some(isHidden)`), and `isHidden` is "starts with '.'" (`file-post-store.ts:13`). So every post id, whatever
  it contains, is its own key with no exceptions, and keys starting with "." can only be outline or research keys.
  `JSON.stringify` of a string array is one-to-one and the canonical check rejects every other spelling, so tagged keys
  are unambiguous too. Every saved `view.json` and `session.json` keeps working with no migration. The research id is
  carried byte for byte inside the envelope; no code splits, sorts, compares, or shows it, which is the "store it and
  pass it back" the design allows.
- **Evidence:** C-8, C-11, C-13, C-25, C-27; architect A2; JD-001 and risk R2 (a post titled "[Draft] Sun" gets the id
  `[Draft] Sun`, because `newEntryName` in `src/shared/entry-name.ts:3` keeps "[", which broke the first grammar);
  three consumers today: `tools.ts`, `documents.tsx`, `check.ts`.
- **Behavior impact:** Preserving. Every post id is its own key, so every existing input, saved view, and session
  behaves as today.
- **Rejected alternatives:**
  - The first grammar, a bare JSON array with a `["post", P]` escape for post ids starting with "[" — rejected after
    review: post ids starting with "[" are real today, and they would have been renamed in `Posts`, refused by
    `NewResearchDocument` when copied from the open-post sentence, and dropped from saved views (JD-001, risk R2).
  - A path suffix such as `P/outline` or `P/research/R` — rejected because post ids contain "/" (`series/one`, the UI
    fake's `1/p 1`), so it is ambiguous.
  - A structured `DocumentRef` on the wire and in the hook — rejected because it changes the type of every map and
    record for the same coverage, and maps would still need a string key.
- **Revisit criterion:** The store ever admits a post id starting with ".", or a fourth document kind is needed.
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
  // PUT /api/posts/:id/outline. Creates or replaces the outline. The page never removes one (D-18).
  export interface SetOutlineBody { outline: string; }
  ```
  `SetOutlineBody` is validated with a zod schema like the other bodies (`outline: z.string()`).
- **Rationale:** Each route has a named caller in this change: the panel's listing, opening and saving the outline,
  and opening, saving, and deleting research documents. One `/documents` listing serves the panel with one request and
  one latest-wins guard (D-21). Calling the two store methods one after the other is safe because both are per-post
  ordered: a delete between them gives a 404 with subject `post`, never half an answer.
- **Evidence:** C-17, C-18; architect A3; test-engineer section 5 (both GET routes have a named caller in
  `readDocument`); JD-002 (no caller removes an outline, so the wire body takes only a string).
- **Behavior impact:** Preserving for the existing routes. The new routes are additions.
- **Rejected alternatives:**
  - `POST /api/posts/:id/research` and `PUT …/research/:rid/title` — deferred (YAGNI): no control in this change creates
    or renames a research document from the page; only the AI creates them.
  - `SetOutlineBody { outline: string | null }` — narrowed once the outline's Delete was deferred (D-18).
  - Separate list and outline requests — rejected: two guards, and an outline body fetched only to learn whether it
    exists.
- **Revisit criterion:** A "New research document", "Rename", or outline "Delete" control is asked for.
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
- **Evidence:** C-14, C-15, C-16, C-26; design R1; architect A3; JD Q9 and test-engineer section 1 (no existing test
  deep-equals a refusal body, from grep only).
- **Behavior impact:** Changing, additively: every refusal body from the post routes gains a `subject` field. Nothing
  reads the body's fields other than `error` today. Settled under the standing instruction.
- **Rejected alternatives:**
  - New reasons or status codes for research — rejected by the design (`posts.routes.ts:20` maps by reason).
  - Matching the message text — rejected above.
- **Revisit criterion:** A client outside this repository reads the post routes.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-10, S-11
- **Dependent decisions:** D-22, D-23, D-31
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-7: The AI's research and outline text arrives unsaved, like its post edits; a research document is created empty first

- **Question:** When the AI produces research or an outline, does it save it to the store at once, or does it arrive as
  an unsaved edit the writer reviews and saves?
- **Decision:** As an unsaved edit, for both:
  - **Research** needs a store-assigned id before the page can hold it, so a new tool, `NewResearchDocument` (D-8),
    creates the research document empty in the store and puts the text in the turn as an unsaved edit. This mirrors
    `NewPost`. Undo all removes an empty research document Claude made in that turn (D-28).
  - **The outline** is named by its post and needs no id. The AI writes the whole outline to the outline's key with
    `Write`. No store call happens. The page loads an absent outline as an empty document, merges the text in as unsaved,
    and Save creates it.
- **Rationale:** The tools' header and the system prompt promise that the AI's text reaches disk only through the
  writer's Save (C-9). Saving directly would skip the review, the highlights, and Undo all (C-9, concurrency K8), and
  for the outline it would silently replace an existing one. `NewPost` is the existing precedent for "create empty, text
  unsaved".
- **Evidence:** C-9, C-11, C-12; architect A4.
- **Behavior impact:** Changing. After the change, an outline the writer asks for appears as the post's outline, unsaved,
  instead of landing in the post's text. When the post already has an outline, the AI's whole-outline `Write` merges
  into it as unsaved changes, highlighted, exactly as a `Write` to a post does today; the writer reviews before saving
  and Undo all puts the stored outline back (risk R1). Settled under the standing instruction; the operator's request
  names both behaviors.
- **Rejected alternatives:**
  - Save research directly with its full text (one call simpler) — rejected: it bypasses review and Undo all, and breaks
    the rule that AI text arrives unsaved.
  - Save the outline directly — rejected: it would overwrite an existing outline with no review.
- **Revisit criterion:** The writer asks for research to be saved without review.
- **Dissent (if any):** None.
- **Settles delta entry:** S-17, S-18
- **Dependent decisions:** D-8, D-9, D-11, D-13, D-18, D-28
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
  `post_id` is a post's id exactly as `Posts` lists it or as the open-post sentence quotes it. Results, exactly:
  - Made: `made research document ${key} titled ${JSON.stringify(title)} on post ${JSON.stringify(post_id)}; its text is
    in the editor, unsaved` — `key` printed raw, for example `.["research","the sun","Sources"]`.
  - `post_id` is not a post key (`parseDocumentKey(post_id)?.kind !== 'post'`): `${post_id} is not a post. Call Posts to
    list the posts by id.`
  - A `PostError`: its message, returned rather than thrown, as `NewPost` does ("A research document needs a title." or
    "That post no longer exists.").
  - Unsupported markdown in `content`: `refuseUnsupported(title, '', content)`, as `NewPost`.

  After a successful create: `markEdited(turn, key, content)`, `highlightChanges(turn, key, content,
  postBlocks(content))`, `onChange()`.
- **Rationale:** `Write` cannot mint a store id, and the scope says research is "a separate research document". Copying
  `NewPost`'s shape keeps one pattern for "make, then edit unsaved". Under D-4 the open-post sentence's quoted id, the
  `Posts` id, and `post_id` are the same string for every post, so the three agree (risk R2).
- **Evidence:** C-9, C-10; architect A4; risk R2.
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
  kind. `Write` and `Edit` check for an outline or research key before `resolveAppNote`, so a tagged key never reaches
  the `.3pitor/` note path. The turn copy wins; otherwise:
  - a post key the store does not find: throw the unchanged
    `${key} is not a post. Call Posts to list the posts by id, or NewPost to make one.`
  - a key starting with `.[` that does not parse: throw
    `${key} is not a document. Name an outline or research document exactly as my message or NewResearchDocument gave it.`
  - outline: `getOutline(postId)`. A string is the text; `null` is text `''` with `absentOutline: true`. A missing post
    gives the "is not a post" error for the post's key.
  - research: `getResearchDocument(postId, id)`. Subject `research-document` throws
    `${key} is not a research document of the post ${JSON.stringify(postId)}. NewResearchDocument makes one.`
    Subject `post` gives the "is not a post" error for the post's key.

  `Read` keeps its order (app skill file, turn copy, then `target` for a key it accepts, then a workspace file). On an
  absent outline it answers `the post ${JSON.stringify(postId)} has no outline yet; Write the whole outline to ${key}
  to make one`. `Write` uses `''` as the base of an absent outline. `Posts` and `NewPost` are unchanged, since a post's
  key is its id. The tools' `Pick` grows to `'get' | 'list' | 'create' | 'getOutline' | 'getResearchDocument' |
  'createResearchDocument'`.
- **Rationale:** One dispatch point instead of one per tool. Deciding the message by `subject` retires design R2 in
  `tools.ts`. A mangled tagged key gets a message pointing back at the given name instead of "or NewPost to make one",
  which would push the model toward making a stray post (risk R3). Every input not starting with `.[`, including
  `.3pitor/../notes` (pinned in `tools.test.ts`), keeps today's message.
- **Evidence:** C-1, C-8; design R2; architect A4; risk R3; test-engineer section 1 (`tools.test.ts:104-114,165-169,
  222-258,337,488-490` pin the "is not a post" text).
- **Behavior impact:** Preserving for every input that is not an outline or research key: same result, same message.
- **Rejected alternatives:**
  - Separate `ReadOutline`/`WriteOutline` tools — rejected: more tools for the model to choose between, and `Edit` and
    `Highlight` would need copies too.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-17
- **Dependent decisions:** D-10, D-11
- **Referenced in plan:** Target State, Surface Delta

### D-10: The open-document sentence names the outline's key and the document being looked at

- **Question:** How does the model learn the outline's key, and which document a plain "edit this" means?
- **Decision:** `sessions.ts` builds the sentence from `parseDocumentKey(openFile)`:
  ```
  post open:     The post open in my editor is "the sun". When my message does not name a post, it means this post. Its outline, if it has one, is named .["outline","the sun"].
  outline open:  The post open in my editor is "the sun", and I am looking at its outline, .["outline","the sun"]. When my message does not name a document, it means this outline.
  research open: The post open in my editor is "the sun", and I am looking at its research document .["research","the sun","Sources"]. When my message does not name a document, it means this research document. Its outline, if it has one, is named .["outline","the sun"].
  unparseable:   no sentence, as with no openFile
  ```
  The post id is quoted with `JSON.stringify(postId)` as today; tagged keys are printed raw.
- **Rationale:** Every variant keeps the prefix `The post open in my editor is <post>`, which the research skill and
  `check.ts` rely on (C-4, C-6). The model never builds a key; it copies one it was given. With an outline or research
  document open, a plain "shorten this" means the document on screen, not the post (JD-003).
- **Evidence:** C-4, C-27; architect A4; JD-003.
- **Behavior impact:** Changing for the model's input only. Nothing a writer sees changes. Old turns in `session.json`
  keep the old wording, which still reads correctly.
- **Rejected alternatives:**
  - Teaching the model the key grammar in the system prompt — rejected: asking a model to build JSON keys invites
    mistakes; copying a given string does not.
  - Keeping "it means this post" in every variant — rejected: with research open it points the model at the post's text,
    which Behavior Changes 1 and 2 promise not to touch (JD-003).
- **Revisit criterion:** The live check shows the model mis-copying keys.
- **Dissent (if any):** None.
- **Settles delta entry:** S-19
- **Dependent decisions:** D-14
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
    `post_id` is the open post's id exactly as the message quotes it, `title` a short title naming the question,
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

- **Question:** What do `check.ts`'s research scenarios assert, and which outline scenarios are there?
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
  - New: **"outline open: a plain edit request changes the outline, not the post"**. Store an outline on `ideas`, open
    the outline's key, send "Make the first point shorter", assert the edited keys are exactly the outline's key.
- **Rationale:** The check script is the only thing that observes the model following the skill and prompt (C-6). The
  third scenario covers the sentence variant JD-003 raised.
- **Evidence:** C-6; architect A4; JD-003.
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
  | A post, its outline, or one of its research documents is open | The post's title as the panel's heading button (or its id, plus " — unsaved, not in your posts" when the post is gone) with a "…" menu holding Rename and Delete. Beneath it: an "Outline" row when the post has an outline or an unsaved one is open; then a "Research" heading and one row per research document, sorted by title only. When the post has neither, one muted line reads "Research and an outline for this post appear here." The open document's button carries `aria-current="true"` and the active style, whether it is the heading or a row, and " (unsaved)" follows any of them with unsaved changes. |
  | Unsaved documents whose post or research document is gone | A last group, as the "missing" rows are today: the label plus " — unsaved, not in your posts" (post) or " — unsaved, no longer in its post" (research). Clicking one opens it. |

  Clicking the heading opens the post, "Outline" opens the outline, and a research row opens that document. All three
  open in the editor, editable and saveable like a post; the read-only rule for unsupported markdown applies unchanged.
  Accessibility details are in D-30.
- **Rationale:** The scope's third sentence. Post selection already lives in the post table (C-20), so the panel's
  every-post list is the part that goes. The "missing" group is kept because it is the only way back to unsaved changes
  that are no longer stored (C-14, C-19). The open-state marker covers the heading because the heading is the only way
  back to the post's own text (UX-006). The muted line tells a writer where research will land before it ever has
  (UX-013).
- **Evidence:** C-14, C-19, C-20; scope-boundary.md; architect A5; UX-006, UX-013.
- **Behavior impact:** Changing: the left panel no longer lists every post; to switch posts the writer goes to the post
  table through the editor bar's "Your posts" button (D-30). Settled under the standing instruction; the operator's
  request asks for it and the confirmation turn stated the post-table route.
- **Rejected alternatives:**
  - Dropping post Rename and Delete from the panel because the table has them — rejected: it removes an action the
    writer has today without a request to.
  - Keeping the all-posts list collapsed beneath the current post — rejected: the request says the panel should "no
    longer show all available posts".
  - A "Your posts" link inside the panel — deferred (UX-005 marks it a YAGNI candidate until switching frequency is
    known); the renamed editor-bar button covers the route.
- **Revisit criterion:** Writers report losing their way between posts.
- **Dissent (if any):** None.
- **Settles delta entry:** S-13, S-14
- **Dependent decisions:** D-16, D-17, D-18, D-19, D-30
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Behavior Changes

### D-16: New post lives only in the post table

- **Question:** Where does the "+" New post control go once the panel stops listing posts?
- **Decision:** The panel has no "+" button. The post table's New post button calls its own
  `usePostDialogs(...).askNewPost` (the table already mounts that hook). `newPosts`/`requestNewPost` are removed from
  `useDocuments` and from `PostTableDocs`. Cancelling the dialog moves focus to the table's search box, as the table's
  other dialogs already do.
- **Rationale:** New post is choosing which post to work on, which is the table's job. The `newPosts` counter exists only
  so the table could reach the panel's dialog (C-19); with the dialog in the table it has no producer.
- **Evidence:** C-19, C-20; architect A5; JD-004 (the table's `usePostDialogs(docs, open, () =>
  searchInput.current?.focus())` focuses search on close).
- **Behavior impact:** Changing: the "+" button at the top of the left panel is gone, New post is on the post table, and
  cancelling New post leaves focus in the table's search box. Settled under the standing instruction.
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
  `<h2 tabIndex={-1}>` that still receives the focus the code moves to it today (after save, restore, Home, and
  discard). Its text is `label(current)`.
- **Rationale:** The panel shows only the open post, so there is nothing to scroll to.
- **Evidence:** C-19; architect A5; test-engineer T-C (seven focus assertions in `documents.test.tsx` find the button by
  its accessible name and must find the heading instead).
- **Behavior impact:** Changing: the post name in the editor bar is no longer a button. Settled under the standing
  instruction.
- **Rejected alternatives:**
  - Keeping the button to focus the panel heading — rejected: no finding shows a need.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-16
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes, Change Units

### D-18: Research rows have a Delete action; the outline has none

- **Question:** Can the writer remove a research document or the outline from the panel?
- **Decision:** Each research row has a "…" menu with Delete. The Outline row has no menu. Delete asks "Delete
  “${label}”? You can’t undo this." and, when the document has unsaved changes, adds the same unsaved-changes line the
  post dialog uses. Confirming sends `DELETE …/research/:rid`, forgets the document, and refreshes the panel. When the
  deleted document was the one on screen, the editor shows its post instead of the post table. The hook gains
  `removeDocument(key)`.
- **Rationale:** A research document the writer no longer wants (or an empty one left by a discard) needs a way out.
  The outline's Delete had no evidence: Undo all leaves no empty outline, since an outline is never stored until Save,
  and nothing in the request asks to remove one (JD-002). Landing on the post keeps the writer in place after deleting
  the document they were reading (UX-001). The plain "You can’t undo this." matches the post dialog and avoids an idiom
  (UX-014).
- **Evidence:** D-7; `documents.tsx:213-215` (`forget` shows nothing when the current document goes); JD-002; UX-001,
  UX-014.
- **Behavior impact:** Changing (a new control). Settled under the standing instruction.
- **Rejected alternatives:**
  - Delete on the Outline row too — deferred to Deferred (YAGNI) with JD-002's trigger.
  - Returning to the post table after deleting the open document — rejected (UX-001).
- **Revisit criterion:** A writer asks to remove an outline, or an imported `outline.md` (D-24) proves unwanted.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12, S-14
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes, Deferred (YAGNI)

### D-19: The "Claude is working" pause covers every panel menu, and its text says what is paused

- **Question:** What does the panel lock while Claude works, and what does it say?
- **Decision:** While busy, every "…" menu in the panel (post and research) is disabled; opening, editing, and saving
  stay allowed. The `#tree-paused` paragraph is rendered by `PostPanel` in every state, including nothing open, because
  the post table's `aria-describedby` points at it. Its text becomes "Renaming and deleting are paused while Claude
  works. You can still open, edit, and save." A menu that is open when Claude starts closes and moves focus to its row's
  name button, as the post table does.
- **Rationale:** The reason for the pause is unchanged: the keys the AI's edits come back under must stay current
  (C-21). The first proposed text ("Changes to posts and their documents are paused") would tell a writer editing the
  outline to stop typing, which is not true (UX-007). Focus would otherwise drop to the page when the menu closes
  (UX-008).
- **Evidence:** C-21; architect A5; UX-007, UX-008; JD-005, T-D (the `#tree-paused` id is a cross-component contract).
- **Behavior impact:** Changing (the paused message's wording). Settled under the standing instruction.
- **Rejected alternatives:**
  - Gating edits and saves of the open document too — rejected: today's pause does not, and the merge handles it (C-12).
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes, Change Units

### D-20: Extend `useDocuments`; only a few functions know how to load, save, and name each kind

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
  `ensureLoaded` loads `text ?? ''`. `Entry` gains `title?: string` from the research read.

  The hook's API divides into:
  - key-taking members: `open`, `save`, `isDirty`, `label`, `discard`, `current`, `missing`
  - post-id-taking members: `createPost`, `rename`, `remove`, `search`, and the new `isPostDirty(postId)` (D-29)
  - new members: `postDocs`, `removeDocument(key)`

  `remove(postId)` also forgets every opened key whose post is that post. `label(key)`: post → listed title, else its id;
  outline → `Outline: ${label(postKey(P))}`; research → `Research: ${title}`, where the title is the `postDocs` title,
  else `entry.title`, else `Research document`. `PostTable` calls `open(postKey(id))`, which is `open(id)`.

  Turn plumbing:
  - `turnListed` holds the listed post keys plus the current `postDocs` keys, so "made" means "not known at Send".
  - `applyEditedNow` refreshes the post list only when `postOfKey(name)` is not listed.
  - `undoTurn` treats an absent outline's stored text as `''` and closes the entry when that leaves it with no unsaved
    changes; an outline the writer also typed in during the turn stays open (risk R1).
- **Rationale:** Load, save, sync, turn, and persistence already share `opened` and the turn refs; a second hook would
  share them across a hook boundary. Kind knowledge stays in `readDocument`, `saveDocument`, `isGone`, `label`, and
  `syncFile`. A research label names its kind, so a screen-reader writer whose focus lands on the editor bar's heading
  after `/research` hears "Research: Sources" rather than a bare title (UX-010).
- **Evidence:** C-11, C-12, C-13; architect A6; UX-010; risk R1, R5.
- **Behavior impact:** Preserving for posts.
- **Rejected alternatives:**
  - A separate hook for a post's documents — rejected above; deferred under YAGNI.
- **Revisit criterion:** A second consumer needs `postDocs` without the turn machinery.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** D-21, D-22, D-23, D-28, D-29
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
    let docs: PostDocuments;
    try {
      docs = await api<PostDocuments>('GET', `/api/posts/${encodeURIComponent(postId)}/documents`);
    } catch (error) {
      if ((error as { status?: number }).status === 404) docs = { outline: false, researchDocuments: [] };
      else { console.error('Could not list the post’s documents:', error); return; }   // keep what is shown
    }
    if (call !== postDocsCalls.current || currentPostRef.current !== postId) return;
    setPostDocs({ postId, ...docs });
  };
  ```
  It runs when the current post changes (moving between one post's documents does not refetch), in `syncOnce` after
  `refreshList`, after `removeDocument`, and in `applyEditedNow` when a loaded key is not a post.
- **Rationale:** The counter drops an older answer for the same post; the post check drops a slow answer for A after a
  switch to B. Both are needed. A failure other than 404 keeps the last list and logs, like `refreshList`'s mount-time
  call, so it never raises a banner or an unhandled rejection; the existing `documents.test.tsx` fetch overrides that
  answer 500 to every URL therefore keep passing (test-engineer section 2, T-B).
- **Evidence:** C-22, C-23; concurrency K1, K11; architect A6; test-engineer section 2.
- **Behavior impact:** Preserving (new state).
- **Rejected alternatives:**
  - Reusing `listCalls` — rejected: it would drop the post list's answer whenever a documents refresh started later.
  - Rejecting on non-404 failures — rejected: the caller has no place to show it, and it would change what existing tests
    see.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Change Units

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
  `known(key) = !listed || (ref = parseDocumentKey(key)) && listed.has(ref.postId)`. For every post key this is today's
  check, since a post's key is its id.
- **Rationale:** A research 404 must not close the post (C-14, design R1), and the post-list test alone cannot see a
  deleted research document.
- **Evidence:** C-14, C-15, C-22, C-25; concurrency K3; architect A6.
- **Behavior impact:** Preserving for posts.
- **Rejected alternatives:**
  - Using the panel's research list as the gone test — rejected: it only covers the current post, and an unsaved
    research document of another post can stay open after a switch.
  - Deriving gone research from `postDocs` plus the 404 instead of a `goneDocs` set (risk R10) — rejected for the same
    reason.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** D-23
- **Referenced in plan:** Target State, Surface Delta

### D-23: New messages for research documents, and post messages that no longer point at a list

- **Question:** What does the writer read when a research document fails or is gone, and which post messages change?
- **Decision:** Exact texts:
  - Save fails with 404, subject `research-document`: `Could not save “${label}”: That research document no longer
    exists. Copy your changes into another document.`
  - Gone notice for a research key: "These unsaved changes belong to a research document that is no longer in its post,
    so they can't be saved here. To keep them, copy them into another document. Then discard them."
  - Gone notice for a post: "copy them into a post from the list" becomes "copy them into another post". The rest of the
    notice is unchanged.
  - Undo all warning, when Claude made posts: "Posts Claude made stay in your list, empty. Delete them from the list if you
    don't want them." becomes "Posts Claude made stay in your posts, empty. Delete them from your posts if you don't
    want them." The announcement "Posts it made are still in your list." becomes "Posts it made are still in your
    posts."
  - Every other post message, and the "Ask Claude again with the post open." tail, is unchanged.
- **Rationale:** Without the research texts, a research failure reads "That post no longer exists" (C-11, C-16). The
  post texts that say "the list" point at a list the left panel no longer shows (test-engineer section 4, T-E).
- **Evidence:** C-11, C-16; architect A6; test-engineer T-E (`documents.test.tsx:258,1626` pin the gone notice);
  `documents.tsx:927,953`.
- **Behavior impact:** Changing: research documents get their own failure texts, and three post texts stop mentioning
  "the list". Settled under the standing instruction.
- **Rejected alternatives:** —
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes, Change Units

### D-24: Existing `outline.md` files become the post's outline; flat `research.md` files stay hidden

- **Question:** What happens to outline and research files already in writers' post folders?
- **Decision:** As the design states: a regular `outline.md` in a post folder is that post's outline from the day this
  ships, visible in the panel and overwritable through Save. A flat `research.md` and the root `research/` folder stay
  invisible through the store and are still deleted with their post.
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

### D-25: Five change units on one branch, merged together, with the tests each one rewrites named

- **Question:** In what order is the change made, and how is it released?
- **Decision:** (1) the store; (2) the document key, wire, routes, and UI fake; (3) `useDocuments`; (4) the panel, the
  table, and the editor bar; (5) the engine tools, the open-document sentence, the system prompt, the research skill,
  the check scenarios, and the chat's names for keys. Each unit is one or more commits on `post-research-and-outline-api`
  that leaves `make test` passing. The branch merges as one pull request, so no writer ever runs Units 1–4 without
  Unit 5. Each unit names the existing tests it rewrites or deletes (the plan's Change Units).
- **Rationale:** The page can take tagged keys (Units 3–4) before the engine emits them (Unit 5). The prompt, skill, and
  check change together in Unit 5 so the model never reads "never put research into the post" next to a skill that says
  to append it. Shipping Unit 4 without Unit 5 would take away the all-posts list while `/research` still appended to the
  post (risk R4). Without the rewrite lists, "`make test` passes" cannot be checked off for Units 3–5 (test-engineer T-B).
- **Evidence:** C-1, C-2; architect's change units, with its units 5 and 6 merged; risk R4; test-engineer section 2 and
  T-B.
- **Behavior impact:** Preserving (sequencing).
- **Rejected alternatives:**
  - The architect's six units, with the skill after the engine — rejected for the contradiction above.
  - Releasing units separately — rejected (risk R4).
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Change Units, Risks

### D-28: Undo all removes an empty research document Claude made in that turn

- **Question:** What happens to the empty research document `NewResearchDocument` created when the writer chooses Undo
  all?
- **Decision:** `undoTurn` deletes, with `DELETE …/research/:rid`, each research key in the turn's `made` list whose
  stored body is still `''`, then forgets it. A research document whose stored body is not empty (the writer saved it
  during the turn) is left alone, like a post. Posts Claude made keep today's behavior: they stay, empty. A discard of
  one research document does not delete it; the row's Delete does.
- **Rationale:** Undo all after `/research` is the most likely way to end up with a stray empty research document, and
  `/research` again on the same question gives a second document with the same title. Two rows reading "Sources", one
  empty and one holding a report, invite deleting the wrong one for good (UX-002, risk R6). Removing the leftover at the
  source closes that path. The empty-body check means Undo all never deletes text the writer saved.
- **Evidence:** UX-002; risk R6; C-12 (`made` is computed at turn end); D-7.
- **Behavior impact:** Changing: after Undo all, a research document Claude made in that turn is gone instead of left
  empty. Settled under the standing instruction.
- **Rejected alternatives:**
  - Leaving research leftovers like posts, with a word count in the Delete dialog to tell duplicates apart — rejected: it
    needs an extra read per dialog and still leaves the clutter.
  - Deleting on discard too — rejected: a discard is about unsaved edits, and the row's Delete is one click away.
- **Revisit criterion:** Writers ask for Undo all to remove posts Claude made as well.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-29: A post's Delete warning and its "(unsaved)" marker cover its outline and research documents

- **Question:** When a post's outline or research document has unsaved changes, do the post table and the post Delete
  dialog say so?
- **Decision:** `useDocuments` gains `isPostDirty(postId)`: true when any opened key whose post is `postId` has unsaved
  changes. The post table's " (unsaved)" marker and the post Delete dialog's unsaved-changes line use it. The post Delete
  dialog's text "…such as notes or outlines. You can’t undo this." becomes "…such as research documents, an outline, or
  notes. You can’t undo this."
- **Rationale:** Today the left list showed " (unsaved)" on every post; after the change the table is the only place a
  writer sees other posts, so it must carry the marker for a post's documents too (UX-004). Deleting a post deletes its
  documents, and the dialog must warn when their unsaved text will go (UX-003).
- **Evidence:** UX-003, UX-004; `post-dialogs.tsx:178-179`; D-20.
- **Behavior impact:** Changing: the table marks a post " (unsaved)" when its outline or a research document has unsaved
  changes, and the post Delete dialog names research documents and warns about their unsaved changes. Settled under the
  standing instruction.
- **Rejected alternatives:**
  - Leaving both as post-only checks — rejected: unsaved research text could vanish with no warning.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12, S-15
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-30: The panel's heading, rows, and Home button are reachable and say where they lead

- **Question:** How do keyboard and screen-reader writers use the new panel and find their way to other posts?
- **Decision:**
  - The post's title is `<h2><button aria-current={…}>` in the panel. The Outline and research rows are buttons with
    `aria-current="true"` when open. Only the open document's button carries it.
  - Each row's "…" button comes after the row's name in the DOM and is visible whenever the row has keyboard focus within
    it, so Tab reaches it. Its target is at least 24×24 pixels.
  - The editor bar's Home button's accessible name changes from "Home" to "Your posts", matching its tooltip, the
    panel's "Pick one from your posts.", and the table's heading.
- **Rationale:** The heading is the only way back to the post's text and must read as a button that is open when it is
  (UX-006). Today's row actions are hover-revealed and come before the name, so Tab skips them (UX-009). With the
  all-posts list gone, "Your posts" is the writer's route to every other post, and its spoken name should say so
  (UX-005).
- **Evidence:** UX-005, UX-006, UX-009; `documents.tsx:793-794`; `post-list.css` (`.row-actions { visibility: hidden }`).
- **Behavior impact:** Changing: the Home button is announced as "Your posts", and row menus are reachable with Tab.
  Settled under the standing instruction.
- **Rejected alternatives:**
  - Copying `PostList`'s hover-only row actions — rejected (UX-009).
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-14, S-16
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes, Change Units

### D-31: No test compares the UI fake's refusals with the real routes'

- **Question:** Should one test hold the UI fake's statuses, messages, and subjects equal to the real post routes'
  (test-engineer T-A, risk R8)?
- **Decision:** Not in this change. Unit 2's route tests pin the real side and Unit 3's hook tests pin the fake side; the
  fake copies the messages by hand, as it does for posts today.
- **Rationale:** The fake lives in `src/ui/` and runs under the UI test setup, while the routes run as Bun server code
  (`Makefile`: `test-server` and `test-ui` are separate, and `src/ui/test-setup.ts` is kept out of server tests). A test
  that loads both crosses that split, which no test does today. C-26 already accepts hand-copied messages for posts.
- **Evidence:** C-26; `Makefile` test targets; test-engineer T-A; risk R8.
- **Behavior impact:** Preserving (no code).
- **Rejected alternatives:**
  - A parity test in either test suite — deferred; see the plan's Deferred (YAGNI).
- **Revisit criterion:** The fake and the routes disagree once in a way a test missed.
- **Dissent (if any):** The test engineer rated T-A High.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Deferred (YAGNI)

# Change Decision Log: New Post Instead of New File

<!--
This file records every decision committed while planning New Post Instead of New File.
The plan itself lives in [../change-plan.md](../change-plan.md). This file captures the
question, rationale, evidence, and rejected alternatives behind each decision.
Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

The operator asked for decisions to be made without escalating to them (standing preference recorded from earlier
planning runs in this repository). Each behavior-changing decision below was settled by the planner on that delegation,
says so in its Behavior impact field, and is listed again in the plan's Behavior Changes section.
-->

## Trivial decisions

- D-7: The empty editor's New post calls the post dialog by name — the tree's `useEffect` on `docs.newPosts` calls
  `askNewPost('')` instead of `createItems('')[0].run()`, so the menu's order no longer decides what that button does
  ([C-8](current-state-findings.md#c-8-the-empty-editors-new-post-button-runs-whatever-is-first-in-the--menu)). —
  Referenced in plan: Target State, Surface Delta.
- D-12: New post keeps the `new-file` menu icon — the document icon already shows "a new thing to write in", and no post
  icon exists. — Referenced in plan: Surface Delta.
- D-13: An open that fails after a post was made shows in the tree's notice, not the dialog — the dialog has already
  closed on success, and the tree's own `open` wrapper routes the failure to its alert. The post exists and shows in the
  tree, so a retry never meets "already exists" for a post that was made (user-experience-designer UX-007; revised in
  review from "keep New file's handling"). — Referenced in plan: Target State; Risks.
- D-19: The fake names the post folder with `newEntryName` and refuses only a taken name — `fakeDocumentsApi`'s
  create-post branch makes `{parent}/{newEntryName(title)}`, answers 400 `{post folder} already exists` when it exists,
  and leaves the missing-parent 404 and every other refusal to the server's tests, as its header comment already says
  (test-engineer D1–D2, junior-developer JD-005). — Referenced in plan: Surface Delta.
- D-20: Opened from a folder's … menu, the dialog is titled `New post in {parent}` — the modal hides the menu that said
  where the post goes (user-experience-designer UX-009). From + or the empty editor it is `New post`. — Referenced in
  plan: Target State; Surface Delta.
- D-21: The create route keeps `kind: z.literal('folder')` rather than a strict `{ path }` body — the browser's New
  folder request keeps its shape unchanged, and a stale `kind: 'file'` still gets a 400 (junior-developer JD-009). —
  Referenced in plan: Surface Delta.
- D-22: A title like `Notes.md` makes a folder named `Notes.md` — the folder rule already allows it for New folder today
  (`entry-name.test.ts` pins `'a.md'` as a folder name), and `listEntries` lists a folder by what it is on disk, not by
  its name (C-3; junior-developer JD-007, OQ2). — Referenced in plan: Risks.
- D-14: Team size is medium — three modules (UI, server, engine) and behavior-changing entries; reviewers are
  junior-developer, test-engineer, and user-experience-designer, two rounds at most. — Referenced in plan: Review
  Findings.

## Full decisions

### D-1: A post is made by one engine operation behind its own endpoint

- **Question:** Is "make a post" an engine operation the browser asks for once, or does the browser build it from the
  existing create and save requests?
- **Decision:** One engine function, `createPost(fileSystem, parent, title): Promise<string>`, makes the folder and its
  `draft.md` and resolves to the draft's path. The browser reaches it through `POST /api/documents/create-post` (D-3)
  and never names `draft.md` or derives the post's folder; it opens and reveals whatever path comes back.
- **Rationale:** The operator asked for a post to be managed "as a unit" with "an abstraction on top" of files and
  folders. A single operation is that unit: the browser, the wire, and the engine's public surface all speak of a post,
  and only the engine knows its layout. It is also the only place a half-made post can be cleaned up safely (D-5).
- **Evidence:** Operator request (scope-boundary.md); C-1, C-5, C-6; software-architect A1.
- **Behavior impact:** Changing. Writers see New post make a folder with a draft in it. Settled by the planner under the
  operator's delegation; listed in the plan's Behavior Changes.
- **Rejected alternatives:**
  - The browser calls `create` for the folder, then `PUT /api/documents/{folder}/draft.md` — rejected because a failed
    second call leaves a folder that blocks the retry (C-6), cleaning it up takes a third request that can also fail,
    and the browser would own the post's layout.
  - Add `kind: 'post'` to `POST /api/documents/create` — rejected because that body carries a `path`, not a title, and
    answers `{ ok: true }`, not the path to open. One schema would have to become a union.
- **Revisit criterion:** A second way to make a post (the AI, an import) that needs the same layout.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-4
- **Dependent decisions:** D-3, D-4, D-5, D-8, D-10
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta

### D-2: The naming rule moves to `src/shared` and becomes the folder rule only

- **Question:** Where does `newEntryName` live once the engine has to derive a folder name from a title, and what
  happens to its `.md` branch?
- **Decision:** Move `src/ui/documents/file-tree/entry-name.ts` and its test to `src/shared/entry-name.ts`, unchanged
  (Unit 1). Once the loose-file create path is gone (D-9), drop the `kind` parameter and the `.md` handling:
  ```ts
  // src/shared/entry-name.ts
  export function newEntryName(typed: string): string;
  ```
  Its callers afterwards are the tree's New folder and New post dialogs, and `createPost`.
- **Rationale:** The dialog and the engine must give the same name for the same title: the dialog to switch Create on
  and off, the engine to make the folder. `src/shared` is the only code both may import, and engine code cannot import
  `src/ui` (C-3).
- **Evidence:** C-3; structural-analyst S-1; software-architect A3.
- **Behavior impact:** Preserving. The folder rule is unchanged character for character; the file rule has no caller
  after D-9.
- **Rejected alternatives:**
  - The browser sends the cleaned name and the title, and the engine only runs `checkPath` — rejected because two
    values would have to agree, and `checkPath` accepts `:` and `*`, so the engine would trust a rule it does not
    enforce (C-3).
  - Keep the `'file'` branch "in case" — rejected because nothing calls it once New file is gone (D-9).
- **Revisit criterion:** A new way to create a loose file by name.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** D-1
- **Referenced in plan:** Target State; Surface Delta

### D-3: The create-post wire contract

- **Question:** What exactly do the browser and the server agree on for making a post?
- **Decision:**
  ```ts
  // src/server/documents/documents.routes.ts
  const CreatePostBody = z.object({ parent: z.string(), title: z.string() }); // parent is '' for the top level
  // src/shared/wire.ts
  export type CreatedPost = { path: string }; // the draft's workspace path
  ```
  `POST /api/documents/create-post` answers 200 with `CreatedPost`. Refusals use the existing `onError` mapping:
  `{ error }` with 400 for `invalid` and 404 for `not-found` (C-7). Worked example:
  | Request body | Answer |
  | --- | --- |
  | `{"parent":"Essays","title":"Why I Love: Rust?"}` | 200 `{"path":"Essays/Why I Love Rust/draft.md"}`; the draft holds `# Why I Love: Rust?\n` |
  | the same again | 400 `{"error":"Essays/Why I Love Rust already exists"}` |
  | `{"parent":"Gone","title":"Hi"}` with no `Gone` folder | 404 `{"error":"Gone was not found"}` |
  | `{"parent":"","title":"::"}` | 400 `{"error":"\"::\" has no characters a folder name can use"}` |
- **Rationale:** The path comes back in the answer, so `draft.md` is named in exactly one place, the engine. The field
  is `parent`, the engine's own name for it, so "folder" never means both the parent and the post's folder
  (junior-developer JD-003).
- **Evidence:** C-1, C-7; software-architect A1.
- **Behavior impact:** Preserving for every existing caller; the endpoint is new.
- **Rejected alternatives:**
  - The browser builds `{folder}/{name}/draft.md` itself — rejected because the browser and engine would have to agree
    on the file name, and on the cleaned folder name, independently.
- **Revisit criterion:** A caller that needs a post's draft without having just made it.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-6, D-8
- **Referenced in plan:** Target State; Surface Delta

### D-4: The draft's heading is the typed title, escaped by the editor's own serializer

- **Question:** How does the exact typed title become a markdown heading that reads back as the same text?
- **Decision:** A private `draftText(title)` in `src/engine/documents/documents.ts` turns each run of control
  characters into one space, trims both ends, and serializes a level-1 heading with that text through
  `markdownSerializer` from `src/shared/markdown.ts`, followed by a newline. `"Why I Love: Rust?"` becomes
  `# Why I Love: Rust?\n`; `"*bold*"` becomes `# \*bold\*\n`; `" Spaced "` becomes `# Spaced\n`.
- **Rationale:** The operator asked for the exact string, "sanitizing it only for markdown compatibility". The
  serializer is already the code that decides how text is escaped in this app's markdown, and every escaped title in
  the check read back as itself (C-4). Spaces at either end and line breaks cannot survive in a heading line, so those
  two are the only changes, and both are the markdown compatibility the operator named.
- **Evidence:** C-4 (serializer run this session); software-architect A2 (a title holding `\n` splits into a heading and
  a paragraph).
- **Behavior impact:** Changing, in a small way: a title with spaces at either end gets a heading without them. Settled by
  the planner under the operator's delegation; listed in Behavior Changes.
- **Rejected alternatives:**
  - `` `# ${title}\n` `` — rejected because `# Not a sub`, `` `code` ``, and `*bold*` would not read back as typed (C-4).
  - A shared `markdownHeading` helper in `src/shared` — deferred (YAGNI): it has one caller.
- **Revisit criterion:** A second caller that needs plain text as a heading.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes; Deferred (YAGNI)

### D-5: A failed draft write removes the folder it just made

- **Question:** What does `createPost` leave behind when the folder is made but `draft.md` cannot be written?
- **Decision:** Order is fixed: (1) derive and check the names, (2) `fileSystem.createFolder(folder)`, (3)
  `fileSystem.write(draft, draftText(title))`. If step 3 throws, `createPost` calls `fileSystem.delete(folder)`,
  ignores a failure of that delete, and rethrows step 3's error mapped as `asDocument` maps it. `createFolder` refuses a
  key that already exists, so the folder deleted is always one this request made.
- **Rationale:** Without it, the writer is left with an unexplained empty folder and a retry that says "already exists"
  (C-6).
- **Evidence:** C-5, C-6; behavioral-analyst B-3; software-architect A1.
- **Behavior impact:** Preserving; there is no post-making path today.
- **Rejected alternatives:**
  - One `fileSystem.write(draft)` that makes the folder on the way (C-5) — rejected because it skips `createFolder`'s
    "already exists" refusal, so it would write a `draft.md` into an existing folder of that name, and still leaves the
    folder behind on a failed write.
  - No cleanup — rejected because of C-6.
- **Revisit criterion:** A file system that can make a folder and file atomically.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Risks

### D-6: What the New post dialog says when it cannot make the post

- **Question:** Which sentences does a writer see for a title that cannot become a folder, a taken name, and a missing
  folder?
- **Decision:** The dialog keeps Create switched off while `newEntryName(draft)` is `''`, so the writer cannot send such
  a title. The engine still refuses one with `{JSON title} has no characters a folder name can use` (400). A taken
  name reads `{folder path} already exists` (400), as New folder's does today. A missing parent reads
  `{parent} was not found` (404). The dialog shows each in its alert, unchanged (C-7).
- **Rationale:** Reuse the sentences writers already see from New folder. The engine's own refusal covers a request
  that bypasses the dialog.
- **Evidence:** C-7; behavioral-analyst B-2.
- **Behavior impact:** Changing only in that New post is a new dialog; the sentences match New folder's. Settled by the
  planner.
- **Rejected alternatives:**
  - Name the title in the taken-name sentence ("A post titled … already exists") — rejected for now: the folder path is
    what the writer sees in the tree, and two titles can clean to one folder name (B-2), so the folder is the
    accurate thing to name.
- **Revisit criterion:** Writers report confusion when two titles clean to the same folder name.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-15
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Behavior Changes

### D-8: After New post, the tree reveals and opens the new draft

- **Question:** What does the writer see right after New post succeeds, and how does the tree find the post's folder?
- **Decision:** `useDocuments().createPost(parent, title)` sends `POST /api/documents/create-post`, then runs
  `refreshList()`, and resolves to the returned `path`. It opens nothing. The tree's New post submit then, in order:
  resolves (which closes the dialog), calls `revealPath(path)`, and calls its own `open(path)` wrapper. `revealPath`
  is the Find-in-docs loop pulled out of its effect: it expands every folder above `path` and sets the flag that
  scrolls the active row into view. Find in docs calls the same `revealPath(docs.current)`.
- **Rationale:** Today only the parent expands (C-9), which would leave the open draft hidden in a collapsed post folder.
  Expanding every folder above the returned path needs no knowledge of a post's layout and no second run of
  `newEntryName`, so the browser and engine never have to agree on the folder's name (junior-developer JD-002,
  test-engineer D3). Reusing Find in docs' loop and its scroll adds no new mechanism (user-experience-designer UX-008).
  Opening through the tree's wrapper sends an open failure to the tree's alert (D-13).
- **Evidence:** C-9; `file-tree.tsx` Find-in-docs effect; behavioral-analyst B-6; software-architect A6; review findings
  JD-002, UX-007, UX-008.
- **Behavior impact:** Changing: New post expands the post's folders and scrolls the new draft into view. Settled by the
  planner.
- **Rejected alternatives:**
  - Leave the post folder collapsed — rejected because the active file would be hidden.
  - Expand `parentOf(path)` only, or `newEntryName(typed)` — rejected: the first misses the parent `folder` and still
    needs a second expand; the second is two derivations that must agree (D-2's rejected alternative).
  - Open inside `useDocuments().createPost` — rejected because an open failure would show in the dialog, and Create
    again would answer "already exists" for a post that was made (UX-007).
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11, S-15, S-19
- **Dependent decisions:** D-13
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-9: The loose-file create path is removed end to end

- **Question:** With New file gone from the tree, what happens to the code that creates a loose `.md` file?
- **Decision:** Remove it at every layer. The engine's `createEntry(fs, path, kind)` becomes `createFolder(fs, path)`;
  `Engine['documents'].create(path, kind)` becomes `createFolder(path)`; `useDocuments().createEntry(path, kind)`
  becomes `createFolder(path)`; the fake's `/create` branch keeps only folders. `POST /api/documents/create` keeps its
  URL and `{ ok: true }` answer, and its body becomes:
  ```ts
  const CreateBody = z.object({ path: z.string(), kind: z.literal('folder') });
  ```
  so an old `{ "path": "x.md", "kind": "file" }` gets a 400 rather than a folder named `x.md`.
- **Rationale:** The operator wants to "move ... away from managing raw files". After New file goes, nothing calls the
  file branch; the search found no non-test caller of `documents.create` but the route (software-architect A5). Keeping
  `kind` as a literal stops a stale request being quietly turned into a folder.
- **Evidence:** Operator request; C-1, C-2, C-10; structural-analyst S-4; software-architect A5.
- **Behavior impact:** Changing for anything that posts `kind: 'file'` to `/api/documents/create`: it now gets a 400.
  Only this app's own browser code ever did. Settled by the planner under the operator's delegation.
- **Rejected alternatives:**
  - Keep the server's file create for some later caller — rejected: no caller is named, and the operator is moving away
    from loose files.
  - Drop `kind` from the body — rejected because Zod would strip it and make a folder named `x.md` for a stale request.
- **Revisit criterion:** A feature that needs to make a loose file again.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-6, S-7, S-8, S-9, S-10, S-12, S-13, S-18
- **Dependent decisions:** D-2
- **Referenced in plan:** What Changes, In One Paragraph; Surface Delta; Behavior Changes

### D-10: `createPost` lives beside `createEntry`, not in a new posts module

- **Question:** Does the "abstraction on top" the operator asked for need its own engine module or type?
- **Decision:** `createPost` is a function in `src/engine/documents/documents.ts`, next to the folder create it builds
  on. It uses that file's private `checkPath` and `asDocument`. The abstraction is the operation: the wire, the browser,
  and the engine's public surface speak of a post, and only this one function knows a post's layout.
- **Rationale:** There is one post-level operation. A `posts.ts` module or `Post` type would have one function in it
  and would need `checkPath`, `asDocument`, and `DocumentError` exported to it.
- **Evidence:** software-architect A1 and its YAGNI deferral; operator request.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - `src/engine/posts/posts.ts` with a `Post` type — deferred (YAGNI); see the plan's Deferred section.
- **Revisit criterion:** A second post-level operation, such as listing posts, renaming a post's title, or publishing.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None
- **Referenced in plan:** What Changes, In One Paragraph; Deferred (YAGNI)

### D-11: The New post dialog asks for a "Working title", and the + button says "New post or folder"

- **Question:** What do the dialog's input and the + button say, including to a screen reader?
- **Decision:** The name dialog's `Pending` gains `label: string`. New post passes `'Working title'`; New folder and
  Rename pass `'Name'`, today's label. The + button's `aria-label` and `title` become `New post or folder`. The menu
  items read `New post` and `New folder`, in that order.
- **Rationale:** The operator's word is "working title". The + button's label names what its menu holds.
- **Evidence:** Operator request; file-tree.tsx `aria-label="New file or folder"`, `aria-label="Name"`.
- **Behavior impact:** Changing for screen-reader users and anyone reading the tooltip. Settled by the planner.
- **Rejected alternatives:**
  - Keep `Name` for every dialog — rejected because the writer is asked for a title, not a file name.
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-14, S-15, S-16
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-15: Creation is the first post-level operation; Rename, Move to…, and Delete stay file-and-folder operations

- **Question:** Does "managing an entire blog post as a unit" require Rename, Move to…, and Delete to act on posts in
  this change?
- **Decision:** No. This change makes creation the first operation that treats a post as a unit. Rename, Move to…, and
  Delete keep working on the files and folders the tree shows. Because a post is a folder, moving or deleting the
  post's folder already moves or deletes the whole post.
- **Rationale:** The request says "the "new folder" and other options still remain". The planner's confirmation turn
  listed Rename, Move, and Delete as out of scope, and the operator answered "looks good". The plan's Why is worded so
  it does not promise more than creation (junior-developer JD-001).
- **Evidence:** scope-boundary.md; the confirmation turn; junior-developer JD-001, OQ1.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Make Rename of a post also rewrite its heading — cut for scope; the operator confirmed those options stay as they
    are.
- **Revisit criterion:** The operator asks for a second post-level operation (this also reopens D-10).
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** None
- **Referenced in plan:** Why This Change; What Changes, In One Paragraph; Cut for Scope

### D-16: The editor bar's name button names the whole path

- **Question:** With every new post's file called `draft.md`, how does a screen reader tell one open post from another?
- **Decision:** The editor bar's name button's `aria-label` becomes `Show {docs.current} in Posts` — the full workspace
  path, such as `Show Essays/Why I Love Rust/draft.md in Posts`. Its visible text stays `draft.md`, after the
  `{folder} /` span that already shows.
- **Rationale:** Today the label reads `Show {basename} in Posts`, which would announce "Show draft.md in Posts" for
  every post made with New post (junior-developer JD-004, user-experience-designer UX-006). Sighted writers already see
  the folder beside it.
- **Evidence:** `src/ui/documents/documents/documents.tsx` name button; JD-004; UX-006.
- **Behavior impact:** Changing for screen-reader users, who hear the full path. Settled by the planner.
- **Rejected alternatives:**
  - Show the post's heading in the bar instead of the file name — rejected: it would make the bar read the document,
    which is a bigger change than the request.
- **Revisit criterion:** Writers ask for the bar to name the post rather than the file.
- **Dissent (if any):** None.
- **Settles delta entry:** S-20
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-17: The name dialog says what folder name a title becomes, and why Create is off

- **Question:** How does the writer learn that `Why I Love: Rust?` becomes the folder `Why I Love Rust`, or why Create
  will not switch on for `::`?
- **Decision:** Under the input, the name dialog shows one line, `id="name-hint"`, which the input names with
  `aria-describedby`:
  - while `clean(draft)` is `''` and `draft.trim()` is not: `A name can't use \ / : * ? " < > | — add other characters.`
  - while `clean(draft)` is not `''` and differs from `draft.trim()`: `Folder: {clean(draft)}`
  - otherwise nothing.
  It reads the dialog's existing `pending.clean`, so New folder gets the same line. Rename's `clean` returns either `''`
  for a draft holding `/`, or the trimmed draft. For a draft holding `/` it shows the first message, which is true of a file name too.
- **Rationale:** The cleaned folder name is otherwise invisible until the writer finds it in the tree, and a dead Create
  button gives no reason (user-experience-designer UX-001, UX-002). The engine's own sentence never reaches the dialog,
  because the dialog stops the request first (D-6).
- **Evidence:** `file-tree.tsx` name dialog; UX-001; UX-002.
- **Behavior impact:** Changing: New post, New folder, and Rename (for a name holding `/`) show a hint line. Settled by
  the planner.
- **Rejected alternatives:**
  - Show the hint for New post only — rejected: New folder has the same gap, and limiting it needs a flag on `Pending`
    with no other use.
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-16
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-18: The name dialog's existing gaps stay out of this change

- **Question:** Should this change also fix what reviewers found in the name dialog that New file already does today?
- **Decision:** No. These stay as they are, and are recorded with their reopening triggers:
  - an error stays on screen after the writer edits the name, and the input has no `aria-invalid` (UX-003);
  - Create can be pressed twice while a request runs (UX-004);
  - focus is lost when the dialog closes, because the control that opened it is gone (UX-005);
  - the input's label exists only for screen readers, so sighted writers never see "Working title".
- **Rationale:** Each applies equally to New folder and Rename today, so none is caused by this change, and each changes
  every name dialog. The operator asked for New post, and these are a separate, dialog-wide fix.
- **Evidence:** user-experience-designer UX-003, UX-004, UX-005, and its unnumbered visible-label note; `file-tree.tsx`
  name dialog.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Fold them into Unit 3 — rejected: they widen the change to every name dialog, beyond the recorded request.
- **Revisit criterion:** A writer reports double-made posts, a stale error, or lost focus, or the operator asks for a
  name-dialog pass.
- **Dissent (if any):** user-experience-designer ranks UX-005 (focus lost) as degrading the task.
- **Settles delta entry:** —
- **Dependent decisions:** None
- **Referenced in plan:** Open Items; Review Findings

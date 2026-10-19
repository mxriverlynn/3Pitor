# Change Decision Log: Post Table Landing Page

<!--
This file records every decision committed while planning the Post Table Landing Page.
The plan itself lives in [../change-plan.md](../change-plan.md) — this file captures the
question, rationale, evidence, and rejected alternatives behind each decision.
Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.
-->

The user delegated escalations in earlier planning runs ("make the best decisions you can, without asking me"). This
run applies that delegation: it settled every behavior-changing entry itself, recorded the reasoning here, and lists
each behavior change in the closing summary so the user can overturn it. The opening scope confirmation was still asked,
and answered: "looks good. leave the sidebar for now. we'll make changes to it later".

## Trivial decisions

- D-14: Plan folder — `docs/changes/post-table-landing-page/`, beside the earlier change plans; proposed in the
  confirmation turn and accepted. — Referenced in plan: Why This Change.
- D-15: Team size — Medium. The change spans the page, the server's post routes, and the test fake, and it has a
  behavior-changing entry. Reviewers: `han-core:junior-developer`, `han-core:test-engineer`,
  `han-core:user-experience-designer`. — Referenced in plan: Review Findings.
- D-16: Edit icon — `ACTION_PATHS` gains an `edit` key drawing the document outline the old empty state showed,
  `'M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5'`. `Item.icon` stays required. — Referenced in plan: Surface Delta.

## Full decisions

### D-1: The table replaces the empty state inside Editor

- **Question:** Where does the post table live, and what happens to "Pick a post to start" and its New post button?
- **Decision:** `PostTable` renders inside `Editor` in place of the `.empty-post` block, under the same condition plus
  the `ready` gate (D-7): `{docs.current === undefined && docs.ready && <PostTable docs={docs} busy={busy} />}`. The
  heading "Pick a post to start", its sentence, and its icon are gone. The table keeps a New post button. The editor
  bar stays above the table, as it sits above the empty state today.
- **Rationale:** The user asked for the landing page to become a table. The empty state is that landing page (C-1), and
  it also shows mid-session after the open post goes away (C-2). Mounting the table in the same place gives the same
  behavior in both cases with a one-line change to `Editor`, the area's churn hotspot. New post stays because the
  request replaces "just a message" and says nothing about taking away the way to start a post.
- **Evidence:** C-1, C-2; the user's request; `app.test.tsx` clicks New post inside the editor (C-14).
- **Behavior impact:** Changing. The writer sees a table of posts, a search box, and a New post button where the
  heading and sentence were. Decided under the user's delegation; the user's own request asks for this change.
- **Rejected alternatives:**
  - A route or separate page for the table — rejected because the app has no routing, and the empty state already is
    the landing page.
  - Dropping New post from the landing page — rejected because nothing in the request asks for it, and the sidebar's
    "+" would then be the only way to start a post on a fresh workspace.
- **Revisit criterion:** The sidebar rework the user mentioned, if it moves post management out of the sidebar.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11
- **Dependent decisions:** D-2, D-7, D-8, D-11
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Behavior Changes

### D-2: The newPosts counter goes

- **Question:** The empty state's New post reaches the sidebar's dialog through the `newPosts` counter (C-5). With the
  table opening its own dialog, what happens to the counter?
- **Decision:** `newPosts` and `requestNewPost` are removed from `useDocuments`, `newPosts` from `PostListDocs`, and the
  `docs.newPosts` effect from `PostList`. The table's New post calls its own `askNewPost` from `usePostDialogs` (D-3).
  The removal lands in the same unit that mounts the table.
- **Rationale:** If the counter stayed while the table also opened its own dialog, one click would open two. Keeping the
  counter and having the table bump it would keep the table dependent on a sidebar the user plans to change. The
  sidebar's own "+" button does not use the counter, so the writer sees no change in the sidebar.
- **Evidence:** C-5, C-14; architect A4.
- **Behavior impact:** Preserving for the writer: one click on the landing page's New post still opens one New post
  dialog with the same heading, box, and buttons. The sidebar's code and its test file change (the effect and its test
  go), which the "leave the sidebar" exclusion allows because nothing the writer sees in the sidebar changes.
- **Rejected alternatives:**
  - Keep the counter and have the table bump it — rejected because it spreads C-5's coupling to the new table and ties
    it to the sidebar.
  - Keep the counter and also open the table's own dialog — rejected because one click would open two dialogs.
- **Revisit criterion:** None expected.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12, S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Change Units

### D-3: The dialogs move into usePostDialogs, shared by the sidebar and the table

- **Question:** How does the table reuse the sidebar's New post, Rename, and Delete dialogs without changing the
  sidebar?
- **Decision:** The title dialog, the delete dialog, `Pending`, `duplicateHint`, `DialogError`, and their state move
  verbatim from `post-list.tsx` to `src/ui/documents/post-dialogs/post-dialogs.tsx`, with their CSS in
  `post-dialogs.css`. The contract:
  ```ts
  // What the dialogs need from the documents hook.
  export interface PostDialogsDocs {
    posts: PostSummary[];                        // for duplicateHint
    isDirty(id: string): boolean;                // the delete dialog's "unsaved changes" line
    createPost(title: string): Promise<string>;
    rename(id: string, title: string): Promise<void>;
    remove(id: string): Promise<void>;
  }

  // `open` is the caller's own wrapper, so a failure to open a new post shows in the caller's alert.
  export function usePostDialogs(docs: PostDialogsDocs, open: (id: string) => void): {
    askNewPost(): void;                   // heading "New post", action "Create", empty box
    askRename(post: PostSummary): void;   // heading "Rename “<title>”", action "Rename", the sidebar's hint, self = post.id
    askDelete(post: PostSummary): void;   // clears the dialog error, then asks "Delete “<title>”?"
    dialogs: ReactElement;                // both <dialog> elements; the caller renders it where it likes
  };
  ```
  The dialogs' heading and hint ids come from `useId()` instead of the fixed `title-dialog-heading`, `title-hint`, and
  `delete-dialog-heading`, because the sidebar and the table each mount a copy. `post-list.test.tsx` selects the hint by
  `.name-hint` instead of `#title-hint`.
- **Rationale:** Two concrete callers exist: the sidebar and the table. Without the move, the table copies about 120
  lines of dialog code and the two copies drift. Moving the code as it is keeps every sidebar dialog's text, ARIA
  wiring, classes, and styles the same.
- **Evidence:** C-4, C-6, C-14; architect A1.
- **Behavior impact:** Preserving. The writer sees the same dialogs. Only the generated id values change, and only tests
  read them.
- **Rejected alternatives:**
  - Keep one set of dialogs in the sidebar and drive them from the table with more counters — rejected because it
    spreads the C-5 coupling to Rename and Delete.
  - Copy the dialogs into the table — rejected because two copies would drift.
  - An id-prefix prop — rejected because `useId` needs no prop.
- **Revisit criterion:** The sidebar rework; if the sidebar stops managing posts, the hook may fold into the table.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2, S-3
- **Dependent decisions:** D-2, D-8
- **Referenced in plan:** Target State; Surface Delta; Change Units

### D-4: Search runs on the server, through an optional q on GET /api/posts

- **Question:** Search must match post text, and the page has only titles (C-7). Where does the matching happen, and
  what is the contract?
- **Decision:**
  - Request: `GET /api/posts?q=<encodeURIComponent(query)>`.
  - Response: the existing `PostList`, `{ posts: PostSummary[] }`, holding only the matching posts, in no order.
  - Rule: `needle = q.trim().toLowerCase()`. When `q` is absent or `needle === ''`, the answer is the full list,
    exactly as today. Otherwise a post matches when `title.toLowerCase().includes(needle) ||
    body.toLowerCase().includes(needle)`. A literal substring: spaces inside the needle count, there is no regex, no
    word splitting, and no Unicode normalization.
  - A post that disappears between the list and its body read (a `PostError` with reason `not-found`) is left out; the
    search does not fail. Any other error is a plain-text 500, as on every post route today.
  - Worked example, with posts `Moon` (body `"the TIDE"`) and `Sun` (body `""`): `?q=%20tide%20` answers
    `{ "posts": [{ "id": "<Moon's id>", "title": "Moon" }] }`; `?q=sun` answers `Sun`; `?q=%20` answers both.
- **Rationale:** The server already holds the bodies. One request per search is cheaper than the page reading every
  body (N requests, each locating its post on disk, C-7). The path stays `/api/posts`: a path like `/api/posts/search`
  would shadow a post whose opaque id is `search`.
- **Evidence:** C-7, C-15; architect A2.
- **Behavior impact:** Preserving for every current caller, since none passes `q`.
- **Rejected alternatives:**
  - The page reads each body through `GET /api/posts/:id` — rejected because it costs N requests on every search and
    every list refresh, and needs a body cache with its own invalidation in the hook.
  - `GET /api/posts?bodies=1`, filtered in the page — rejected because it ships every body and keeps a second copy of
    the list that goes stale on posts-changed.
  - `GET /api/posts/search?q=` — rejected because of the id collision.
- **Revisit criterion:** A measured search delay at real post counts.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-5, S-6, S-7
- **Dependent decisions:** D-5, D-6, D-12
- **Referenced in plan:** Target State; Surface Delta; Risks

### D-5: The search lives in the route layer, not on PostStore

- **Question:** Does `PostStore` gain a `search` method?
- **Decision:** No. A private `search(posts, needle)` inside `posts.routes.ts` calls `posts.list()` and then
  `posts.get(id)` for each post, with `Promise.all`. `PostStore` and `file-post-store.ts` do not change.
- **Rationale:** One caller needs search. The AI's Posts tool, the other `list()` caller, does not search (C-7). A
  method on the store contract would have one caller and an implementation in every store.
- **Evidence:** C-7; YAGNI rule, single-implementation abstraction.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - `PostStore.search(query)` — rejected because it has one caller; deferred with a reopening trigger.
- **Revisit criterion:** The AI's tools or the CLI need search, or a store with an index arrives.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Deferred (YAGNI)

### D-6: Search matches saved text, not unsaved edits

- **Question:** An open post with unsaved changes holds text the store does not have (C-8). Which text does search
  match?
- **Decision:** The saved text only. The search box's description says so: "Searches titles and saved text."
- **Rationale:** Matching live text would need the hook to expose each open post's text and merge server matches with
  local ones. No one has asked for it, and most posts on the landing page are not open.
- **Evidence:** C-8.
- **Behavior impact:** Changing, in the sense that it is a limit the writer can observe: they type a word they just
  wrote into an open post, have not saved, and that post does not match. Decided under the user's delegation.
- **Rejected alternatives:**
  - Also match the live text of open posts in the page — rejected for now; deferred.
- **Revisit criterion:** A writer reports a missed match on unsaved text.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes; Deferred (YAGNI)

### D-7: The table waits until restore has finished

- **Question:** The landing page shows for a moment on every reload with a post open, before restore reopens it (C-3).
  Does the table wait?
- **Decision:** `useDocuments` returns `ready: restored || restoreError !== undefined`, and `Editor` mounts the table
  only when `ready` is true. Until then the area below the editor bar is blank.
- **Rationale:** A full table flashing for three round trips is worse than today's heading. `restoreFailed` sets only
  `restoreError` and never `restored`, so gating on `restored` alone would hide the table for good after a failed
  restore. `restore` awaits the list before setting `restored`, so `ready` also means the list has loaded or failed.
- **Evidence:** C-3; architect A5.
- **Behavior impact:** Changing. A writer who reloads with a post open sees a blank editor area until the post appears,
  instead of a flash of "Pick a post to start". A writer on a fresh workspace sees the table once the first list
  arrives. Decided under the user's delegation.
- **Rejected alternatives:**
  - No gate — rejected because the table would flash on every reload with a post open.
  - Expose `restored` and `listLoaded` separately — rejected because the table needs one fact.
- **Revisit criterion:** Restore gets slow enough that a loading indicator is wanted.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8, S-11
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-8: While Claude works, the table pauses changes the way the sidebar does

- **Question:** The pause on changing posts while Claude works lives only in the sidebar's buttons (C-11). What does
  the table do?
- **Decision:** The same as the sidebar. The table's actions buttons and New post are `disabled={busy}`, an open menu
  hides with `const menu = busy ? undefined : openMenu`, and both point `aria-describedby="tree-paused"` at the
  sidebar's status line, which is always mounted. Title clicks, Edit, and search stay available while Claude works.
- **Rationale:** Renaming or deleting a post mid-turn would change the ids the turn is tracking. The status line already
  explains the pause, and a second one would announce the same thing twice.
- **Evidence:** C-5, C-11.
- **Behavior impact:** Preserving: the pause already applies on the landing page's New post today.
- **Rejected alternatives:**
  - A status line of the table's own — rejected because screen readers would hear the pause twice; deferred until the
    sidebar changes.
  - Enforce the pause in the hook — rejected because it changes the sidebar's code paths.
- **Revisit criterion:** The sidebar rework removes `tree-paused`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Risks

### D-9: Only the Title column sorts, ascending by default

- **Question:** Which columns sort, and how?
- **Decision:** Only Title, since the Actions column holds no data. The comparator is the sidebar's `byTitle`
  (`localeCompare`, ties broken by id), copied into `post-table.tsx`; descending reverses it. The default is ascending.
  The Title header is a button; each press flips the direction, and the `<th>` carries `aria-sort="ascending"` or
  `"descending"`. Sorting applies after the search filter.
- **Rationale:** The user asked for column sorting, and the user asked for two columns, one of which has no label and
  no data. Copying a two-line comparator keeps the sidebar file untouched.
- **Evidence:** C-9; the user's request.
- **Behavior impact:** New behavior on a new screen; part of S-10.
- **Rejected alternatives:**
  - Export `byTitle` from `post-list.tsx` — rejected to keep the sidebar file out of this change beyond D-2 and D-3.
  - A shared sortable-table component — rejected; one use, deferred.
- **Revisit criterion:** The table gains a second sortable column, or the sidebar rework starts.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-10: Edit and a title click both open the post

- **Question:** What does Edit do, given there is no separate editing mode?
- **Decision:** Edit and a click on the title both call the table's `open(id)`, which wraps `docs.open` and shows a
  failure in the table's own alert with a "Close error" button.
- **Rationale:** Opening a post is the only way into the editor (C-1). The sidebar's alert is not visible from the
  editor (C-12), so the table needs its own.
- **Evidence:** C-12; the user's request.
- **Behavior impact:** New behavior on a new screen; part of S-10.
- **Rejected alternatives:**
  - Leave Edit out as a duplicate — rejected because the user asked for it.
- **Revisit criterion:** None expected.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-11: The table's buttons have their own accessible names

- **Question:** The sidebar's buttons are named by the title and `Actions for <title>`, and the app tests find them by
  those names (C-14). What are the table's named?
- **Decision:** A title button is named `Open “<title>”`, and an actions button `More actions for “<title>”`. The title
  button shows the title, and an `(unsaved)` note when the post has unsaved changes, as the sidebar does. The Actions
  header holds `<span className="visually-hidden">Actions</span>`, so it shows no label but still names the column for
  screen readers.
- **Rationale:** With both on screen, the same names would make `getByRole('button', { name: /^Notes/ })` and
  `'Actions for Notes'` match two buttons in `app.test.tsx`. The names include the visible title, so voice control
  users can still say what they see.
- **Evidence:** C-14; architect A3; `.visually-hidden` exists in `src/ui/styles.css`.
- **Behavior impact:** New behavior on a new screen; part of S-10.
- **Rejected alternatives:**
  - Reuse the sidebar's names — rejected because queries in `app.test.tsx` would match two elements.
  - An empty `<th>` — rejected because the column would have no name for screen readers.
- **Revisit criterion:** The sidebar rework.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-12: The search box waits 200 ms and keeps only the latest answer

- **Question:** How does the table call search as the writer types?
- **Decision:**
  - The query lives in `PostTable` state. An effect keyed on `[query.trim(), docs.posts]` runs the search.
  - A blank query sets `matches` to `undefined`: no filter and no request. A fresh workspace still makes exactly three
    `GET /api/posts` requests (C-14).
  - Otherwise the effect calls `docs.search(query)` after 200 ms. Its cleanup clears the timer and marks the call stale,
    so an older answer never replaces a newer one.
  - `docs.posts` is a dependency, so a rename, a delete, or a posts-changed refresh runs the search again.
  - Rows are the live list filtered by the latest matches (`docs.posts.filter((p) => !matches || matches.has(p.id))`),
    then sorted. Titles always come from the live list. The previous matches stay in place until the new answer lands.
  - A failed search shows its message in a `role="alert"` notice and leaves the previous rows.
  - Two empty messages: "No posts yet." when there are no posts, and `No posts match “<query>”.` when a search finds
    none.
  - The hook's `search(query: string): Promise<string[]>` sends `GET /api/posts?q=${encodeURIComponent(query)}` and
    resolves to the matching ids.
- **Rationale:** Each search reads every body on the server (D-4), so a request per keystroke is waste. Keeping the
  URL in the hook keeps every post URL beside `postUrl`.
- **Evidence:** C-7, C-14; architect A3.
- **Behavior impact:** New behavior on a new screen; part of S-7 and S-10.
- **Rejected alternatives:**
  - Search on every keystroke — rejected for the server cost.
  - A Search button — rejected because nothing in the request asks for one, and typing to filter is what a writer
    expects of a search box above a table.
- **Revisit criterion:** A measured search delay.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-13: Unsaved posts missing from the store are not in the table

- **Question:** The sidebar lists open posts with unsaved changes that the store no longer has (`missing`). Does the
  table?
- **Decision:** No. The table lists `docs.posts` only.
- **Rationale:** Those rows cannot be renamed, deleted, or searched, so they fit none of the table's actions, and the
  sidebar still shows them. The request asks for "all the current posts".
- **Evidence:** C-6; behavioral-analyst B-6.
- **Behavior impact:** New behavior on a new screen; part of S-10.
- **Rejected alternatives:**
  - Show them as rows with no actions — rejected because they are not current posts.
- **Revisit criterion:** The sidebar rework removes the sidebar's `missing` rows.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State

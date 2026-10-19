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
  `'M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5'`. `Item.icon` stays required. — Referenced in plan: Target State; Surface Delta.

## Full decisions

### D-1: The table replaces the empty state inside Editor

- **Question:** Where does the post table live, and what happens to "Pick a post to start" and its New post button?
- **Decision:** `PostTable` renders inside `Editor` in place of the `.empty-post` block, under the same condition plus
  the `ready` gate (D-7): `{docs.current === undefined && docs.ready && <PostTable docs={docs} busy={busy} onOpened={...} />}`. The
  heading "Pick a post to start", its sentence, and its icon are gone. The table keeps a New post button. The editor
  bar stays above the table, as it sits above the empty state today.
- **Rationale:** The user asked for the landing page to become a table. The empty state is that landing page (C-1), and
  it also shows mid-session after the open post goes away (C-2). The request names "the landing page that loads when
  the app first starts"; showing the same table mid-session is this run's reading, because it is the same screen. Mounting the table in the same place gives the same
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
- **Dependent decisions:** D-2, D-7, D-8, D-11, D-17
- **Referenced in plan:** What Changes, In One Paragraph; Surface Delta; Behavior Changes; Open Items

### D-2: The newPosts counter stays, and the table's New post bumps it

- **Question:** The empty state's New post reaches the sidebar's dialog through the `newPosts` counter (C-5). What does
  the table's New post do?
- **Decision:** The table's New post calls `docs.requestNewPost()`, exactly as the empty state's button does today. The
  sidebar's `PostList` keeps its `docs.newPosts` effect and opens its own New post dialog. The table never calls
  `askNewPost` and never watches `newPosts`, so one click opens one dialog. `useDocuments`, `PostListDocs`, and the
  sidebar's counter test are unchanged.
- **Rationale:** The draft removed the counter, so the table would open its own dialog. The junior developer's review
  (JD-002) showed that a second dialog opens only when a second component also watches the counter. Leaving it in
  place keeps the sidebar's code fully untouched, which is what the exclusion asks for. It also keeps the
  fresh-workspace and New post tests as they are, and removes an ordering constraint between units. The coupling C-5
  names stays until the sidebar rework, which the user has already said is coming.
- **Evidence:** C-5, C-14; junior-developer JD-002; scope boundary, Stated Exclusions.
- **Behavior impact:** Preserving. One click on the landing page's New post opens the sidebar's New post dialog, as it
  does today, and the new post opens with focus in its editor.
- **Rejected alternatives:**
  - Remove the counter and have the table open its own dialog (the draft) — rejected because it edits the sidebar's
    code and tests for no change the writer can see.
  - Keep the counter and also open a dialog from the table — rejected because one click would open two dialogs.
- **Revisit criterion:** The sidebar rework removes or moves `PostList`'s `newPosts` effect.
- **Dissent (if any):** The software architect preferred removing the counter (A4) and named this as the fallback if
  the exclusion is read strictly. The run reads it strictly.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Risks; Deferred (YAGNI)

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
  // `onClose`, when given, is called each time either dialog closes, whatever the outcome. The sidebar passes none.
  export function usePostDialogs(docs: PostDialogsDocs, open: (id: string) => void, onClose?: () => void): {
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
- **Dependent decisions:** D-8, D-17
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta

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
  - The body reads run in parallel (`Promise.all` over `get`). A read that rejects with a `PostError` whose reason is
    `not-found` (the post was deleted after the list) leaves that post out; the search does not fail. Any other
    rejection fails the request through the routes' existing `onError`: another `PostError` as its 400, anything else
    as a plain-text 500.
  - Worked example, with posts `Moon` (body `"the TIDE"`) and `Sun` (body `""`): `?q=%20tide%20` answers
    `{ "posts": [{ "id": "<Moon's id>", "title": "Moon" }] }`; `?q=sun` answers `Sun`; `?q=%20` answers both. A post titled `Tidepools` with an empty body also
    matches `tide`, by title.
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
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Risks

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
- **Referenced in plan:** Target State; Surface Delta; Deferred (YAGNI)

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
- **Referenced in plan:** Surface Delta; Behavior Changes; Deferred (YAGNI)

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
  instead of a flash of "Pick a post to start". A writer starting the app on any workspace also sees a blank area
  until the stored view and the first list have loaded, where today the heading shows at once. On a local app that
  wait is expected to be short; nobody has measured it. Decided under the user's delegation.
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
  sidebar's status line, which is always mounted. When busy hides a menu, focus moves to that row's title button.
  Title clicks and search stay available while Claude works. Edit is inside the menu, so it is not available while
  Claude works; a title click opens the post instead.
- **Rationale:** Renaming or deleting a post mid-turn would change the ids the turn is tracking. The status line already
  explains the pause, and a second one would announce the same thing twice. The draft said Edit stayed usable, which
  contradicted the disabled actions button (junior-developer JD-001); keeping the button disabled matches the sidebar
  and needs no change to `Menu`.
- **Evidence:** C-5, C-11; junior-developer JD-001; user-experience-designer UX-008.
- **Behavior impact:** Preserving: the pause already applies on the landing page's New post today.
- **Rejected alternatives:**
  - A status line of the table's own — rejected because screen readers would hear the pause twice; deferred until the
    sidebar changes.
  - Enforce the pause in the hook — rejected because it changes the sidebar's code paths.
  - Keep the actions button enabled and offer only Edit while Claude works — rejected because `Menu` has no disabled
    items, and a menu whose contents change with Claude's state is harder to learn than a paused button.
- **Revisit criterion:** The sidebar rework removes `tree-paused`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes; Risks; Deferred (YAGNI)

### D-9: Only the Title column sorts, ascending by default

- **Question:** Which columns sort, and how?
- **Decision:** Only Title, since the Actions column holds no data. The comparator is the sidebar's `byTitle`
  (`localeCompare`, ties broken by id), copied into `post-table.tsx`; descending is `(a, b) => -byTitle(a, b)`, so ties reverse too. The default is ascending.
  The Title header is a button; each press flips the direction, and the `<th>` carries `aria-sort="ascending"` or
  `"descending"`. The button shows an `aria-hidden` arrow after its text: `▲` ascending, `▼` descending. Sorting
  applies after the search filter.
- **Rationale:** The user asked for column sorting, and the user asked for two columns, one of which has no label and
  no data. Copying a two-line comparator keeps the sidebar file untouched.
- **Evidence:** C-9; the user's request; user-experience-designer UX-006; test-engineer section 5.
- **Behavior impact:** New behavior on a new screen; part of S-10.
- **Rejected alternatives:**
  - Export `byTitle` from `post-list.tsx` — rejected to keep the sidebar file out of this change beyond D-3.
  - A shared sortable-table component — rejected; one use, deferred.
- **Revisit criterion:** The table gains a second sortable column, or the sidebar rework starts.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Deferred (YAGNI)

### D-10: Edit and a title click both open the post

- **Question:** What does Edit do, given there is no separate editing mode?
- **Decision:** Edit and a click on the title both call the table's `open(id)`, which wraps `docs.open`. A failure
  shows `error.message` in the table's own `role="alert"` notice, with the sidebar's "Close error" button, until the
  next open succeeds or the writer closes it. The menu's items are, in order, Edit (`edit` icon), Rename (`rename`),
  Delete (`delete`).
- **Rationale:** Opening a post is the only way into the editor (C-1). The sidebar's alert is not visible from the
  editor (C-12), so the table needs its own. The request lists "edit" and "click the title, it opens the post"
  separately; with no separate editing mode in the app, this run reads both as opening the post.
- **Evidence:** C-12; the user's request.
- **Behavior impact:** New behavior on a new screen; part of S-10.
- **Rejected alternatives:**
  - Leave Edit out as a duplicate — rejected because the user asked for it.
- **Revisit criterion:** None expected.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Open Items

### D-11: The table's buttons have their own accessible names

- **Question:** The sidebar's buttons are named by the title and `Actions for <title>`, and the app tests find them by
  those names (C-14). What are the table's named?
- **Decision:** A title button holds `<span className="visually-hidden">Open </span>`, then the title, then the
  sidebar's `<span className="unsaved"> (unsaved)</span>` when the post has unsaved changes. It has no `aria-label`,
  so its name is `Open Moon` or `Open Moon (unsaved)`. An actions button is named by
  `aria-label={`More actions for “${title}”`}` and shows `…`; it is always visible, not only on hover, and at least
  24 by 24 pixels. The Actions
  header holds `<span className="visually-hidden">Actions</span>`, so it shows no label but still names the column for
  screen readers.
- **Rationale:** With both on screen, the same names would make `getByRole('button', { name: /^Notes/ })` and
  `'Actions for Notes'` match two buttons in `app.test.tsx`. The draft used `aria-label="Open “Moon”"`, which would
  have hidden "(unsaved)" from screen readers and left the visible text out of the name (user-experience-designer
  UX-004). A hidden prefix keeps everything visible in the name. The actions column is what the request names, so its
  button cannot hide until hover as the sidebar's does (UX-009).
- **Evidence:** C-14; architect A3; user-experience-designer UX-004, UX-009; `.visually-hidden` exists in
  `src/ui/styles.css`.
- **Behavior impact:** New behavior on a new screen; part of S-10.
- **Rejected alternatives:**
  - Reuse the sidebar's names — rejected because queries in `app.test.tsx` would match two elements.
  - `aria-label="Open “<title>”"` on the title button — rejected because it hides the unsaved note.
  - An empty `<th>` — rejected because the column would have no name for screen readers.
- **Revisit criterion:** The sidebar rework.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Risks

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
  - A failed search shows `Could not search your posts: <error.message>` in a `role="alert"` notice and leaves the
    previous rows. The notice clears when the next search answers or the box is emptied.
  - The messages sit in one always-mounted `<p role="status">`, empty while rows show, so screen readers hear them
    when they appear. With no posts at all it says "No posts yet.", whatever is typed. With posts but no matches it
    says `No posts match “<trimmed query>”.`.
  - The hook's `search(query: string): Promise<string[]>` sends `GET /api/posts?q=${encodeURIComponent(query)}` and
    resolves to the matching ids.
- **Rationale:** Each search reads every body on the server, and each read locates its post on disk (C-7, D-4), so a
  request per keystroke is real cost on an existing code path. Keeping the
  URL in the hook keeps every post URL beside `postUrl`.
- **Evidence:** C-7, C-14; architect A3; user-experience-designer UX-005; junior-developer JD-004, JD-008.
- **Behavior impact:** New behavior on a new screen; part of S-7 and S-10.
- **Rejected alternatives:**
  - Search on every keystroke — rejected for the server cost.
  - A Search button — rejected because nothing in the request asks for one, and typing to filter is what a writer
    expects of a search box above a table.
- **Revisit criterion:** A measured search delay.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta

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
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-17: Where focus goes after the table's actions

- **Question:** The table unmounts when a post opens, and the menu unmounts before its dialog opens. Where does keyboard
  focus land?
- **Decision:**
  - **After a title click or Edit opens a post:** focus moves to the editor bar's post name button. `PostTable` takes
    `onOpened: () => void` and calls it after `docs.open` resolves. `Editor` passes a function that marks the name
    button for focus, and focuses `nameButton` once the opened post's bar renders.
  - **After New post from the table:** unchanged. The sidebar's dialog opens the new post, and its editor takes focus
    (`justCreated`), as today.
  - **After Rename or Delete from the table:** when either dialog closes, whatever the outcome, focus moves to the
    table's search box. The table passes `onClose` to `usePostDialogs`; the sidebar passes none.
  - **Escape in a row's menu:** the menu closes and focus returns to that row's actions button. The table's `onClose`
    for `Menu` does this; `Menu` itself is unchanged.
  - **Tab out of a row's menu:** the menu closes when focus leaves the actions cell (an `onBlur` on the cell that
    checks `relatedTarget`).
- **Rationale:** Without targets, a keyboard writer lands at the top of the page after the screen's main task. Each fix
  is local to the table; `Menu` and the sidebar keep their behavior.
- **Evidence:** user-experience-designer UX-001, UX-002, UX-003, UX-008; C-10.
- **Behavior impact:** New behavior on a new screen; part of S-1 (the optional `onClose`), S-10, and S-11.
- **Rejected alternatives:**
  - Focus the next row after a delete — rejected because rows move as the list refreshes; the search box is always
    there.
  - Give `Menu` arrow keys and focus return — rejected because it changes the sidebar's menu (cut for scope).
- **Revisit criterion:** The sidebar rework, which may move focus handling into `Menu`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-10, S-11
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta

### D-18: The table's heading, search box, and New post button

- **Question:** Which exact strings and elements does the builder use?
- **Decision:**
  - Heading: `<h2>Your posts</h2>` with a `useId()` id. The table has `aria-labelledby` pointing at it, and no
    `aria-label`.
  - Search box: `<input type="search" aria-label="Search posts" placeholder="Search posts" aria-describedby={hintId}>`,
    followed by a visible `<p id={hintId}>Searches titles and saved text.</p>`.
  - New post: `<button className="primary" disabled={busy} aria-describedby="tree-paused" onClick={docs.requestNewPost}>New post</button>`.
- **Rationale:** One name for the table instead of two ("Your posts" and "All posts"), and a visible description so
  the saved-text limit is something the writer can read.
- **Evidence:** user-experience-designer UX-007, UX-012; D-2.
- **Behavior impact:** New behavior on a new screen; part of S-10.
- **Rejected alternatives:**
  - No heading — rejected because the table needs a name and the screen had a heading before. Its wording is an open
    item.
- **Revisit criterion:** The user names a different heading.
- **Dissent (if any):** junior-developer JD-009 suggested deferring the heading as unrequested.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Open Items

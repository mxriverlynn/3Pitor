# Change Plan: Post Table Landing Page

## Why This Change

This is a new requirement (a constraint arriving). When no post is open, the editor shows "Pick a post to start" and a
New post button. The user wants that landing page to be a table of every post instead: sortable, searchable by title
and text, with a title column that opens the post and an unlabeled actions column whose pop-up menu offers Edit,
Rename, and Delete. The source is the user's request, recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md). The Posts sidebar stays as it is for now: "leave the
sidebar for now. we'll make changes to it later". The plan lives in `docs/changes/post-table-landing-page/`
([D-14](artifacts/change-decision-log.md#trivial-decisions)).

## What Changes, In One Paragraph

When no post is open, the editor shows a table of every post, sorted by title, with a search box and a New post button
above it ([D-1](artifacts/change-decision-log.md#d-1-the-table-replaces-the-empty-state-inside-editor)). Clicking a
title, or choosing Edit from its row's menu, opens the post. Rename and Delete open the same dialogs the sidebar uses,
because those dialogs move out of the sidebar into a hook both can call
([D-3](artifacts/change-decision-log.md#d-3-the-dialogs-move-into-usepostdialogs-shared-by-the-sidebar-and-the-table)).
New post still reaches the sidebar's dialog the way it does today
([D-2](artifacts/change-decision-log.md#d-2-the-newposts-counter-stays-and-the-tables-new-post-bumps-it)). Search
matches the title and the saved text. The server does the matching through an optional `q` on the existing
`GET /api/posts`, because only the server holds the post bodies
([D-4](artifacts/change-decision-log.md#d-4-search-runs-on-the-server-through-an-optional-q-on-get-apiposts)). The
sidebar looks and behaves exactly as it does today.

## Current State

The landing page is a block inside `Editor`, in `src/ui/documents/documents/documents.tsx`. It renders whenever
`docs.current` is undefined
([C-1](artifacts/current-state-findings.md#c-1-the-landing-page-is-the-editors-empty-state)). That happens at first
start, and also mid-session: after the open post is deleted, discarded, or removed on disk, or when restore cannot reopen
it ([C-2](artifacts/current-state-findings.md#c-2-the-empty-state-also-shows-mid-session-not-only-at-start)). It also
shows for a moment on every reload with a post open, because nothing marks restore as unfinished
([C-3](artifacts/current-state-findings.md#c-3-nothing-marks-restore-not-finished-so-the-landing-page-shows-briefly-on-every-reload-with-a-post-open)).

Four properties of the code stand in the way of the table:

- **The dialogs are trapped in the sidebar.** The New post, Rename, and Delete dialogs are private state inside
  `PostList` in `src/ui/documents/post-list/post-list.tsx`
  ([C-4](artifacts/current-state-findings.md#c-4-the-rename-and-delete-dialogs-are-private-state-inside-postlist)).
  The empty state's New post reaches them only through a `newPosts` counter in the hook
  ([C-5](artifacts/current-state-findings.md#c-5-new-post-from-the-empty-state-reaches-the-sidebar-through-a-counter)).
- **The page has no post bodies.** `GET /api/posts` returns ids and titles only. A body is one `GET /api/posts/:id` at
  a time, and each one locates its post on disk
  ([C-7](artifacts/current-state-findings.md#c-7-the-page-has-titles-for-every-post-but-no-bodies)).
- **Nothing to reuse for a table.** There is no table, sort, or search code anywhere in `src/`
  ([C-9](artifacts/current-state-findings.md#c-9-there-is-no-table-sort-or-search-code-to-reuse)).
- **`Menu` has no Edit icon.** `Menu` requires an icon for every item and has none for Edit
  ([C-10](artifacts/current-state-findings.md#c-10-menu-needs-an-icon-for-every-item-and-has-none-for-edit)).

Two things the table must copy from the sidebar:

- The pause on changing posts while Claude works is enforced only in the sidebar's buttons
  ([C-11](artifacts/current-state-findings.md#c-11-the-claude-is-working-pause-lives-only-in-the-sidebars-buttons)).
- A failed open shows only in the sidebar's own alert
  ([C-12](artifacts/current-state-findings.md#c-12-open-failures-surface-in-the-sidebars-own-alert)).

## Target State

Three new parts, and small changes to four existing ones.

**`usePostDialogs`** (`src/ui/documents/post-dialogs/post-dialogs.tsx`, with `post-dialogs.css`) owns the title dialog
(New post and Rename) and the Delete dialog. That covers their state, `duplicateHint`, `Pending`, and `DialogError`, all
moved verbatim from `post-list.tsx`. It does not own a list, a menu, or an open-failure alert. The contract
([D-3](artifacts/change-decision-log.md#d-3-the-dialogs-move-into-usepostdialogs-shared-by-the-sidebar-and-the-table)):

```ts
// What the dialogs need from the documents hook.
export interface PostDialogsDocs {
  posts: PostSummary[];
  isDirty(id: string): boolean;
  createPost(title: string): Promise<string>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
}

// `open` is the caller's own wrapper, so a failure to open a new post shows in the caller's alert.
// `onClose`, when given, is called each time either dialog closes, whatever the outcome. The sidebar passes none.
export function usePostDialogs(docs: PostDialogsDocs, open: (id: string) => void, onClose?: () => void): {
  askNewPost(): void;
  askRename(post: PostSummary): void;
  askDelete(post: PostSummary): void;
  dialogs: ReactElement;
};
```

Each instance takes its heading and hint ids from `useId()`, because the sidebar and the table each mount one. Every
other attribute, class, and string is what `PostList` renders today.

**`PostTable`** (`src/ui/documents/post-table/post-table.tsx`, `.css`, `.test.tsx`) owns the landing page:

- the "Your posts" heading;
- the search box and its description;
- the New post button;
- the table and its sort;
- the debounced search and the status line;
- its own open-failure and search-failure alerts;
- the row menus and where focus goes after them.

It does not own any dialog; it calls `usePostDialogs` for Rename and Delete. Its contract:

```ts
export interface PostTableDocs extends PostDialogsDocs {
  open(id: string): Promise<void>;
  search(query: string): Promise<string[]>;
  // Asks the sidebar to open its New post dialog, as the old empty state did.
  requestNewPost(): void;
}
// `onOpened` is called after a title click or Edit has opened a post.
export function PostTable({ docs, busy, onOpened }: { docs: PostTableDocs; busy: boolean; onOpened: () => void }): ReactElement;
```

The screen's structure, with the strings pinned
([D-18](artifacts/change-decision-log.md#d-18-the-tables-heading-search-box-and-new-post-button)):

```html
<h2 id=":h:">Your posts</h2>
<input type="search" aria-label="Search posts" placeholder="Search posts" aria-describedby=":d:">
<p id=":d:">Searches titles and saved text.</p>
<button class="primary" aria-describedby="tree-paused">New post</button>
<table aria-labelledby=":h:">
  <thead><tr>
    <th aria-sort="ascending"><button>Title <span aria-hidden="true">▲</span></button></th>
    <th><span class="visually-hidden">Actions</span></th>
  </tr></thead>
  <tbody><tr>
    <td><button><span class="visually-hidden">Open </span>Moon<span class="unsaved"> (unsaved)</span></button></td>
    <td><button aria-label="More actions for “Moon”" aria-haspopup="menu" aria-expanded="false">…</button></td>
  </tr></tbody>
</table>
<p role="status"></p>
```

- **Sort.** Only Title sorts. The default is ascending, using the sidebar's `byTitle` comparator copied locally.
  Descending is `-byTitle`, so ties reverse too. Each press on the header flips the direction and its arrow
  ([D-9](artifacts/change-decision-log.md#d-9-only-the-title-column-sorts-ascending-by-default)).
- **Opening.** A title click and the menu's Edit both open the post. The menu's items are Edit, Rename, and Delete, in
  that order. A failure shows `error.message` in the table's own alert, with a "Close error" button
  ([D-10](artifacts/change-decision-log.md#d-10-edit-and-a-title-click-both-open-the-post)).
- **Button names.** A title button is named by its content: `Open Moon`, or `Open Moon (unsaved)`. An actions button
  is named `More actions for “Moon”`, is always visible, and is at least 24 by 24 pixels. Neither collides with the
  sidebar's names ([D-11](artifacts/change-decision-log.md#d-11-the-tables-buttons-have-their-own-accessible-names)).
- **Search.** The search box waits 200 ms after typing stops and keeps only the latest answer
  ([D-12](artifacts/change-decision-log.md#d-12-the-search-box-waits-200-ms-and-keeps-only-the-latest-answer)).
  - The query is re-run whenever `query.trim()` or `docs.posts` changes. Until a new answer arrives, the previous
    matches stay applied.
  - A blank query sends no request and shows every post.
  - A failure shows `Could not search your posts: <message>` and keeps the previous rows.
  - The status line is empty while rows show. With no posts, it says "No posts yet.". With no matches, it says
    `No posts match “<trimmed query>”.`.
- **New post.** It calls `docs.requestNewPost()`, and the sidebar's dialog opens, as from the old empty state
  ([D-2](artifacts/change-decision-log.md#d-2-the-newposts-counter-stays-and-the-tables-new-post-bumps-it)).
- **While Claude works.** New post and the actions buttons are disabled and point at the sidebar's `tree-paused` status
  line. An open menu hides, and focus moves to its row's title. Titles and search stay usable. Edit, being in the
  menu, waits
  ([D-8](artifacts/change-decision-log.md#d-8-while-claude-works-the-table-pauses-changes-the-way-the-sidebar-does)).
- **Focus** ([D-17](artifacts/change-decision-log.md#d-17-where-focus-goes-after-the-tables-actions)):
  - **Opening a post.** Focus goes to the editor bar's post name.
  - **Rename and Delete.** When the dialog closes, focus goes to the search box.
  - **Escape in a menu.** Focus returns to the row's actions button.
  - **Tab out of a menu.** The menu closes.
- **What it lists.** Only `docs.posts`. Unsaved posts the store no longer holds stay in the sidebar
  ([D-13](artifacts/change-decision-log.md#d-13-unsaved-posts-missing-from-the-store-are-not-in-the-table)).

**The search on the server** is a private `search` in `src/server/posts/posts.routes.ts`, behind an optional `q` on
`GET /api/posts` ([D-4](artifacts/change-decision-log.md#d-4-search-runs-on-the-server-through-an-optional-q-on-get-apiposts),
[D-5](artifacts/change-decision-log.md#d-5-the-search-lives-in-the-route-layer-not-on-poststore)):

```
GET /api/posts?q=%20tide%20
200 { "posts": [{ "id": "<Moon's id>", "title": "Moon" }, { "id": "<Tidepools' id>", "title": "Tidepools" }] }
```

Here Moon's body is `"the TIDE"`, and Tidepools has an empty body.

- **The rule.** `needle = q.trim().toLowerCase()`. A blank or absent `q` returns the full list. Otherwise a post
  matches when its lowercased title or body includes `needle`.
- **Reads.** The body reads run in parallel, with `Promise.all` over `get`.
- **Failed reads.** A read that rejects with a `not-found` `PostError` leaves that post out. Any other rejection fails
  the request through the routes' `onError`.
- **`PostStore` is unchanged.** It gains no method.

**Existing parts that change:**

- **`useDocuments`** gains `search(query)`, which sends the request and resolves to the matching ids. It also gains
  `ready: restored || restoreError !== undefined`
  ([D-7](artifacts/change-decision-log.md#d-7-the-table-waits-until-restore-has-finished)). `newPosts` and
  `requestNewPost` stay as they are.
- **`Editor`** renders `{docs.current === undefined && docs.ready && <PostTable docs={docs} busy={busy} onOpened={...} />}`
  where `.empty-post` was. Its `onOpened` focuses `nameButton` once the opened post's bar renders.
- **`PostList`** calls `usePostDialogs` and renders its `dialogs`. It keeps its list, its menu, its alert, its
  `byTitle`, and its `newPosts` effect, which now calls the hook's `askNewPost`.
- **`Menu`** gains an `edit` icon ([D-16](artifacts/change-decision-log.md#trivial-decisions)).

## Surface Delta

### S-1: `usePostDialogs` and `PostDialogsDocs` — Added

**Target state.** `src/ui/documents/post-dialogs/post-dialogs.tsx` exports `PostDialogsDocs` and `usePostDialogs`,
with the signatures in Target State.

- **What it owns.** The New post / Rename title dialog and the Delete dialog: their state, submit handlers, the
  duplicate-title hint, and the inline error.
- **What it returns.** `askNewPost`, `askRename`, `askDelete`, and `dialogs`, a `ReactElement` holding both `<dialog>`
  elements.
- **Ids.** The heading and hint ids come from `useId()`.
- **`onClose`.** An optional callback, run each time either dialog closes, whatever the outcome.
- **What it does not own.** No list, menu, or open-failure alert.

**Behavior.** Preserving. The code moves from `PostList` as it stands. The dialogs' text, classes, ARIA wiring, focus,
and submit and error handling are unchanged, including the shared `dialogError` and the Delete dialog's missing
submit guard. Only the generated id values differ, and only tests read them. The sidebar passes no `onClose`.

**Why.** The table needs the Rename and Delete dialogs, and they are private to `PostList` today
([C-4](artifacts/current-state-findings.md#c-4-the-rename-and-delete-dialogs-are-private-state-inside-postlist)).

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-dialogs-move-into-usepostdialogs-shared-by-the-sidebar-and-the-table),
[D-17](artifacts/change-decision-log.md#d-17-where-focus-goes-after-the-tables-actions)

### S-2: `PostList` and `PostListDocs` — Re-scoped

**Target state.** `PostList` owns the sidebar's flat list, its row menus, its open-failure alert, its `tree-paused`
status line, Show in the post list, and its `newPosts` effect. It gets its dialogs from `usePostDialogs` and renders
`dialogs` where the two `<dialog>` elements were. `PostListDocs` extends `PostDialogsDocs` with `missing`, `current`,
`finds`, `newPosts`, `label`, and `open`.

**Behavior.** Preserving. The sidebar renders the same markup, text, and styles. Its "+", its row menus, and the
`newPosts` counter open the same dialogs.

**Why.** The dialogs are now shared.

**Depends on.** S-1.

**Migration.** `post-list.test.tsx` selects the hint by `.name-hint` instead of `#title-hint` in its four duplicate-hint
and rename assertions.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-dialogs-move-into-usepostdialogs-shared-by-the-sidebar-and-the-table)

### S-3: The dialog styles — Moved

**Target state.** The `dialog:is(.name, .confirm)` and `dialog.name` rules, including the spinner, live in
`src/ui/documents/post-dialogs/post-dialogs.css`, imported by `post-dialogs.tsx`. `post-list.css` keeps only the
sidebar's own rules.

**Behavior.** Preserving. The rules are the same text, and the page bundles both stylesheets. The dialog rules are
scoped to `dialog.name` and `dialog.confirm`, so the order of the two files does not change which rule wins. No test
can see styles, so Unit 1 checks the dialogs by eye.

**Why.** The styles belong to the dialogs, which now render in two places.

**Depends on.** S-1.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-dialogs-move-into-usepostdialogs-shared-by-the-sidebar-and-the-table)

### S-4: `GET /api/posts` — Re-scoped

**Target state.** `GET /api/posts` takes an optional `q` query parameter.

- **No search.** With `q` absent or blank after trimming, it answers every post, as `PostList`, exactly as before.
- **Search.** With a non-blank `q`, it answers only the posts whose title or saved body contains `q.trim()`, ignoring
  case, as `PostList`, in no order.
- **How it reads.** The body reads run in parallel.
- **Failed reads.** A read rejected with a `not-found` `PostError` drops that post. Any other rejection fails the
  request through the routes' existing `onError`.

The matching is a private `search` in `posts.routes.ts`, which calls `list()` and then `get()` for each post.
`PostStore` does not change.

**Behavior.** Preserving for every existing caller. None sends `q`, so the list route answers as before.

**Why.** Search must match post text, and only the server holds the bodies
([C-7](artifacts/current-state-findings.md#c-7-the-page-has-titles-for-every-post-but-no-bodies)).

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-search-runs-on-the-server-through-an-optional-q-on-get-apiposts),
[D-5](artifacts/change-decision-log.md#d-5-the-search-lives-in-the-route-layer-not-on-poststore)

### S-5: `PostList` in `src/shared/wire.ts` — Re-scoped

**Target state.** The comment on the wire `PostList` type says it answers both `GET /api/posts` and
`GET /api/posts?q=`, the second holding only matches. The type's fields are unchanged.

**Behavior.** Preserving. Only a comment changes.

**Why.** The type now carries a second meaning.

**Depends on.** S-4.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-search-runs-on-the-server-through-an-optional-q-on-get-apiposts)

### S-6: `fakePostsApi` — Re-scoped

**Target state.** The test fake answers `GET /api/posts?q=…` by the same rule as S-4, over its in-memory titles and
bodies, still newest first. It splits off the query string before matching the URL. It still records each request in
`requests`, with the full URL.

**Behavior.** Preserving for every existing test, none of which sends `q`. Today a `?q=` URL falls through to a 404
([C-15](artifacts/current-state-findings.md#c-15-the-fake-posts-api-lists-newest-first-and-uses-ids-with--and-spaces)).

**Why.** UI tests of the table need the search answered.

**Depends on.** S-4.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-search-runs-on-the-server-through-an-optional-q-on-get-apiposts)

### S-7: `useDocuments().search` — Added

**Target state.** `useDocuments` returns `search(query: string): Promise<string[]>`. It sends
`GET /api/posts?q=${encodeURIComponent(query)}` and resolves to the ids of the matching posts. It rejects with the
request's error. It does not change `posts`, and it does not refresh the list.

**Behavior.** Preserving. Nothing calls it until S-10 does.

**Why.** It keeps every post URL inside the hook, beside `postUrl`.

**Depends on.** S-4, S-6.

**Decision.** [D-12](artifacts/change-decision-log.md#d-12-the-search-box-waits-200-ms-and-keeps-only-the-latest-answer)

### S-8: `useDocuments().ready` — Added

**Target state.** `useDocuments` returns `ready: boolean`, true once `restore` has finished or `restoreFailed` has been
called. Once true it stays true.

**Behavior.** Preserving on its own. S-11 is where the page starts reading it.

**Why.** The table must not flash before restore reopens the writer's post
([C-3](artifacts/current-state-findings.md#c-3-nothing-marks-restore-not-finished-so-the-landing-page-shows-briefly-on-every-reload-with-a-post-open)).

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-the-table-waits-until-restore-has-finished)

### S-9: `ACTION_PATHS.edit` in `Menu` — Added

**Target state.** `src/ui/components/menu/menu.tsx` has an `edit` action icon, the document outline
`'M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5'`. `Item.icon` still requires a key of `ACTION_PATHS`.

**Behavior.** Preserving. No existing menu uses it.

**Why.** Every menu item needs an icon, and Edit has none
([C-10](artifacts/current-state-findings.md#c-10-menu-needs-an-icon-for-every-item-and-has-none-for-edit)).

**Decision.** [D-16](artifacts/change-decision-log.md#trivial-decisions)

### S-10: `PostTable` and `PostTableDocs` — Added

**Target state.** `src/ui/documents/post-table/post-table.tsx` exports `PostTableDocs` and `PostTable`, with the
signatures and structure in Target State.

`PostTable` renders, in order:

- the "Your posts" heading;
- an open-failure alert, when there is one;
- the search box and its visible description;
- New post;
- a search-failure alert, when there is one;
- the table, labelled by the heading;
- an always-mounted status line.

What it does:

- **Rows.** It lists `docs.posts`, filtered by the latest search answer, then sorted by title. The sort is ascending by
  default and flips on each press of the Title header, with `aria-sort` and an arrow.
- **Search.** It runs 200 ms after the trimmed query or `docs.posts` changes. A blank query sends no request.
- **Opening.** A title click and the menu's Edit open the post, then call `onOpened`.
- **Rename and Delete.** They call `askRename` and `askDelete`. When their dialog closes, focus goes to the search box.
- **New post.** It calls `docs.requestNewPost()`.
- **While Claude works.** New post and the actions buttons are disabled, with `aria-describedby="tree-paused"`. An open
  menu hides, and focus moves to its row's title.

It imports nothing from `documents.tsx`. Its styles live in `post-table.css`. The actions cell is positioned so its
menu is not clipped, and the actions button is always visible and at least 24 by 24 pixels.

**Behavior.** Changing; new behavior. Search covers saved text only
([D-6](artifacts/change-decision-log.md#d-6-search-matches-saved-text-not-unsaved-edits)). It does not show unsaved
posts the store no longer has
([D-13](artifacts/change-decision-log.md#d-13-unsaved-posts-missing-from-the-store-are-not-in-the-table)). Both were
settled under the user's delegation.

**Why.** The user's request.

**Depends on.** S-1, S-7, S-9.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-only-the-title-column-sorts-ascending-by-default),
[D-10](artifacts/change-decision-log.md#d-10-edit-and-a-title-click-both-open-the-post),
[D-11](artifacts/change-decision-log.md#d-11-the-tables-buttons-have-their-own-accessible-names),
[D-12](artifacts/change-decision-log.md#d-12-the-search-box-waits-200-ms-and-keeps-only-the-latest-answer),
[D-8](artifacts/change-decision-log.md#d-8-while-claude-works-the-table-pauses-changes-the-way-the-sidebar-does),
[D-2](artifacts/change-decision-log.md#d-2-the-newposts-counter-stays-and-the-tables-new-post-bumps-it),
[D-17](artifacts/change-decision-log.md#d-17-where-focus-goes-after-the-tables-actions),
[D-18](artifacts/change-decision-log.md#d-18-the-tables-heading-search-box-and-new-post-button),
[D-6](artifacts/change-decision-log.md#d-6-search-matches-saved-text-not-unsaved-edits),
[D-13](artifacts/change-decision-log.md#d-13-unsaved-posts-missing-from-the-store-are-not-in-the-table)

### S-11: The `Editor` empty state — Removed

**Target state.** `Editor` has no `.empty-post` block, no "Pick a post to start" heading, and no `.empty-post` styles
in `documents.css`. When no post is open and `docs.ready` is true, `Editor` renders `PostTable` below the editor bar.
When `docs.ready` is false, nothing renders there. `Editor` passes `onOpened`, which focuses the editor bar's post name
once it renders.

**Behavior.** Changing. The writer sees the post table where the heading and sentence were. Until the stored view and
the first list have loaded, they see a blank area, on a fresh start and on a reload with a post open. Today the
landing page shows at once. Settled under the user's delegation.

**Why.** The user's request
([C-1](artifacts/current-state-findings.md#c-1-the-landing-page-is-the-editors-empty-state)).

**Depends on.** S-8, S-10.

**Migration.** `documents.test.tsx` asserts the "Your posts" heading in place of "Pick a post to start" and its
sentence. The fresh-workspace request count stays at three `GET /api/posts`. "New post in the empty editor asks the
Posts list for a new post" keeps passing against the table's New post.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-table-replaces-the-empty-state-inside-editor),
[D-7](artifacts/change-decision-log.md#d-7-the-table-waits-until-restore-has-finished),
[D-17](artifacts/change-decision-log.md#d-17-where-focus-goes-after-the-tables-actions)

## Behavior Changes

The user's standing delegation covers each of these: decide without asking. Any of them can be reversed.

1. **The landing page is a post table.** On a fresh start, or after the open post goes away, the writer sees:
   - "Your posts";
   - a search box;
   - New post;
   - a table of every post by title.

   "Pick a post to start" and its sentence are gone (S-11,
   [D-1](artifacts/change-decision-log.md#d-1-the-table-replaces-the-empty-state-inside-editor)).
2. **A blank area while the page loads.** A writer who starts or reloads the app sees an empty area under the editor
   bar until the stored view and the post list have loaded. If a post was open, it then reappears. Otherwise the table
   shows. Today "Pick a post to start" shows at once, and flashes before a reopened post (S-11,
   [D-7](artifacts/change-decision-log.md#d-7-the-table-waits-until-restore-has-finished)).
3. **Search sees saved text only.** A writer types a word they just added to an open post without saving, and that post
   does not match. The search box says "Searches titles and saved text." (S-10,
   [D-6](artifacts/change-decision-log.md#d-6-search-matches-saved-text-not-unsaved-edits)).
4. **The table lists only posts the store has.** Suppose an open post with unsaved changes was deleted on disk. It
   appears in the sidebar but not in the table (S-10,
   [D-13](artifacts/change-decision-log.md#d-13-unsaved-posts-missing-from-the-store-are-not-in-the-table)).
5. **Edit waits while Claude works.** The actions button is paused while Claude works, so Edit, Rename, and Delete are
   not available then. Clicking a title still opens the post (S-10,
   [D-8](artifacts/change-decision-log.md#d-8-while-claude-works-the-table-pauses-changes-the-way-the-sidebar-does)).

Every other entry is behavior-preserving.

## Change Units

The units follow the order below.

### Unit 1: Move the dialogs out of the sidebar

**What it does.** Extracts `usePostDialogs` and its styles. `PostList` uses it. The sidebar looks and works the same.

**Delta entries.** S-1, S-2, S-3.

**How you know it worked.**

- `post-list.test.tsx` and `app.test.tsx` pass. The only edit is four `#title-hint` selectors in `post-list.test.tsx`,
  which become `.name-hint`.
- A new `post-list.test.tsx` test opens each dialog and checks its wiring with `document.getElementById`. The `Title`
  input's `aria-describedby` names the `.name-hint`, and each dialog's `aria-labelledby` names its `h3`. Use
  `getElementById` rather than `#id`, because `useId` ids contain colons.
- A new `post-list.test.tsx` test makes `remove` reject. The Delete dialog shows the message in its alert, and Close
  error clears it. Rename, opened next, shows no stale alert.
- The sidebar's Rename and Delete dialogs look the same in the running app, which checks that `post-dialogs.css` is
  imported.

### Unit 2: Search on the server and in the fake

**What it does.** Adds `?q=` to `GET /api/posts`, the same rule in `fakePostsApi`, and the wire comment.

**Delta entries.** S-4, S-5, S-6.

**How you know it worked.** New tests in `posts.routes.test.ts` use separate fixtures and compare ids as sets, since
the order is not promised. They cover:

- a title-only match;
- a body-only match in a different case;
- a post that does not match;
- `?q=%20` returning everything;
- `?q=%20tide%20` trimmed.

One more test runs over the real `createFilePostStore`. It deletes a matching post after `list()` returns, and expects
a 200 with the surviving matches only. All existing route and UI tests pass unchanged.

### Unit 3: The hook's search and ready, and the Edit icon

**What it does.** Adds `search` and `ready` to `useDocuments` and `edit` to `ACTION_PATHS`. Nothing reads them yet.

**Delta entries.** S-7, S-8, S-9.

**Ordering constraint.** After Unit 2, because `search`'s tests run against the fake.

**How you know it worked.** Hook tests in `documents.test.tsx` show:

- `ready` is false before `restore` resolves, and true after it;
- `ready` is true after `restoreFailed`;
- `search('a&b c')` sends `GET /api/posts?q=a%26b%20c` and resolves to the matching ids;
- it leaves `docs.current.posts` unchanged and sends no extra `GET /api/posts`;
- it rejects with the request's error.

### Unit 4: Build the post table

**What it does.** Adds `PostTable` with its tests. Only its own tests render it.

**Delta entries.** S-10.

**Ordering constraint.** After Units 1 and 3.

**How you know it worked.** `post-table.test.tsx` uses stand-in docs, listed newest first, the way
`post-list.test.tsx` uses `docsWith`. The repo has no fake timers, so timing tests use real short waits, as in
`documents.test.tsx`'s "a burst of changes after a reload is stored once". It covers:

- **Sorting.**
  - Both directions, with two posts sharing a title so the tie-break shows.
  - `aria-sort` and the arrow flip on each press.
- **Debounced search.**
  - Several changes within the wait, then a pause of about 300 ms, make one `search` call with the last value.
  - Don't assert exact timings.
- **Stale answers.**
  - A later answer that resolves first wins over an earlier one.
  - An answer that lands after the box is cleared does not filter the full list.
- **Blank and failed searches.**
  - A blank query makes no `search` call.
  - A search failure shows its alert and keeps the rows.
- **The status line.** "No posts yet." with no posts, and `No posts match “…”.` with no matches.
- **Opening.**
  - A title click and Edit call `docs.open` and then `onOpened`.
  - An open failure shows in the table's alert.
- **The other actions.**
  - Rename and Delete open their dialogs, and focus moves to the search box when a dialog closes.
  - Escape in a menu returns focus to its actions button.
  - New post calls `requestNewPost`.
- **The busy pause.**
  - New post and the actions buttons are disabled.
  - An open menu hides, and focus moves to the row's title.

### Unit 5: Put the table on the landing page

**What it does.** Mounts `PostTable` in `Editor` behind `docs.ready`, removes `.empty-post` and its styles, and wires
`onOpened` to focus the post name.

**Delta entries.** S-11.

**Ordering constraint.** After Unit 4.

**How you know it worked.**

- `documents.test.tsx` covers the landing page:
  - It finds "Your posts" on a fresh workspace, with three `GET /api/posts` requests.
  - It shows no table before `restore` resolves.
  - It shows the table after `restoreFailed`, and again after the open post is deleted.
- A `documents.test.tsx` or `app.test.tsx` test types a body-only word into the landing page's search, through the
  real hook and the fake.
  - The rows filter, and `api.requests` holds the `GET /api/posts?q=…` entry.
  - Clearing the box shows every post, with no further `?q=` request.
- Opening a post from the table puts focus on the editor bar's post name.
- `app.test.tsx` passes in full: its New post in the editor still opens one dialog, and its sidebar queries still
  match one element each.
- `app.test.tsx`'s busy test also asserts that the landing page's New post is disabled. Its `aria-describedby` must
  resolve to the sidebar's `#tree-paused`.
- In the running app, a row menu near the bottom of a long table is not clipped.

## Risks

- **Duplicate matches in app tests.** If a table button shares an accessible name with a sidebar button,
  `getByRole` throws in `app.test.tsx`. Unit 5's full run of `app.test.tsx` catches it. The blast radius is tests only
  ([D-11](artifacts/change-decision-log.md#d-11-the-tables-buttons-have-their-own-accessible-names)).
- **Search cost grows with the number of posts.**
  - Each search reads every body in parallel, and each read locates its post on disk.
  - While a query is typed, every list change runs the search again, and so does every posts-changed event.
  - The 200 ms wait keeps it to one search per pause in typing.
  - No workload has been measured. A slow search shows stale rows until it answers, and nothing breaks
    ([D-4](artifacts/change-decision-log.md#d-4-search-runs-on-the-server-through-an-optional-q-on-get-apiposts)).
- **A new post can briefly hide under a search.** A writer makes a post from the table while a query is typed. The new
  row stays hidden until the re-run search answers, even if it matches. The new post opens in the editor anyway, so
  the table is no longer on screen.
- **The borrowed sidebar parts.** The table's paused buttons point at `tree-paused`, and its New post goes through the
  sidebar's `newPosts` effect. If the sidebar rework removes either one, the description dangles or New post stops
  opening a dialog. Unit 5's `app.test.tsx` assertions catch both
  ([D-8](artifacts/change-decision-log.md#d-8-while-claude-works-the-table-pauses-changes-the-way-the-sidebar-does),
  [D-2](artifacts/change-decision-log.md#d-2-the-newposts-counter-stays-and-the-tables-new-post-bumps-it)).
- **Menu clipping.** `Menu` is absolutely positioned. A scrolling table wrapper clips the menu on the last rows. Unit
  5 checks this by eye.

## Deferred (YAGNI)

### A shared table or sortable-column component
**Why deferred:** Evidence test. There is one table.
**Reopen when:** A second table lands.
**Source:** software-architect A3.

### `PostStore.search`
**Why deferred:** Evidence test. There is one caller.
**Reopen when:** The AI's tools or the CLI need search, or a store with a search index arrives.
**Source:** software-architect A2; [D-5](artifacts/change-decision-log.md#d-5-the-search-lives-in-the-route-layer-not-on-poststore).

### A shared `byTitle` module
**Why deferred:** Simpler-version test. A two-line copy keeps the sidebar file out of the change.
**Reopen when:** The sidebar rework begins.
**Source:** software-architect A3; [D-9](artifacts/change-decision-log.md#d-9-only-the-title-column-sorts-ascending-by-default).

### Searching unsaved text in open posts
**Why deferred:** Evidence test. No one has asked for it.
**Reopen when:** A writer reports a missed match on unsaved text.
**Source:** [D-6](artifacts/change-decision-log.md#d-6-search-matches-saved-text-not-unsaved-edits).

### A search index or paging
**Why deferred:** Evidence test. No workload has been measured.
**Reopen when:** Search delay is measured as a problem.
**Source:** software-architect A2.

### The table owning its New post dialog and paused status line
**Why deferred:** Simpler-version test. Leaving the `newPosts` counter and `tree-paused` in place keeps the sidebar's
code untouched. A second status line would also announce the pause twice.
**Reopen when:** The sidebar rework changes or removes `PostList`'s `newPosts` effect or `tree-paused`.
**Source:** junior-developer JD-002; software-architect A4;
[D-2](artifacts/change-decision-log.md#d-2-the-newposts-counter-stays-and-the-tables-new-post-bumps-it),
[D-8](artifacts/change-decision-log.md#d-8-while-claude-works-the-table-pauses-changes-the-way-the-sidebar-does).

### A spoken result count, a "searching" indicator, and a loading marker
**Why deferred:** Evidence test. No count shows on screen, so WCAG 4.1.3 does not ask for one. No search or restore
delay has been measured.
**Reopen when:** Screen-reader testing shows writers miss results, or a measured delay is long enough to notice.
**Source:** user-experience-designer UX-005, UX-011.

## Cut for Scope

The boundary excludes changes to the sidebar: "leave the sidebar for now. we'll make changes to it later". These would
change it:

- **Fixing the Delete dialog's double submit and the shared error between the two dialogs.** In the sidebar today, a
  quick double click on Delete sends two deletes, and the second shows an error even though the first worked. The
  table inherits the same behavior through the shared dialogs.
- **Arrow keys, Home, and End in the pop-up menu, and focus returning to its button on Escape.** `Menu` is shared with
  the sidebar, so the table adds its own focus return instead and leaves `Menu` alone (UX-010).
- **Where focus goes after Rename or Delete from the sidebar.** The table sets its own targets. The sidebar keeps
  today's behavior.

The request does not ask for this one:

- **Telling a failed post list apart from an empty one.** When the list cannot load, the table says "No posts yet.",
  the same as a workspace with no posts
  ([C-13](artifacts/current-state-findings.md#c-13-a-failed-list-load-looks-the-same-as-having-no-posts)). The gap
  exists today.

## Open Items

None of these block the change.

- **The heading.** This plan chose "Your posts" as a placeholder. Changing it touches one string and one test
  ([D-18](artifacts/change-decision-log.md#d-18-the-tables-heading-search-box-and-new-post-button)).
- **What "Edit" means.** This plan reads Edit as opening the post, the same as a title click, because the app has no
  separate editing mode. If the user meant something else, S-9 and S-10 change
  ([D-10](artifacts/change-decision-log.md#d-10-edit-and-a-title-click-both-open-the-post)).
- **The table mid-session.** The request names the landing page at first start. This plan also shows the table
  whenever no post is open, because that is the same screen
  ([D-1](artifacts/change-decision-log.md#d-1-the-table-replaces-the-empty-state-inside-editor)).
- **The reload flash.** It is traced from the source and has not been seen in the running app
  ([C-3](artifacts/current-state-findings.md#c-3-nothing-marks-restore-not-finished-so-the-landing-page-shows-briefly-on-every-reload-with-a-post-open)).
  Running the app once confirms it.

## Review Findings

The team was `han-core:junior-developer`, `han-core:test-engineer`, and `han-core:user-experience-designer`, in one
round, at medium size ([D-15](artifacts/change-decision-log.md#trivial-decisions)). These findings changed the plan:

- **junior-developer JD-001.** The draft said Edit stayed usable while Claude works, but the actions button holding it
  was disabled. Settled in D-8: Edit waits with the rest of the menu.
- **junior-developer JD-002.** Removing the `newPosts` counter was not needed. Settled in D-2: the counter stays, and
  the sidebar's code is untouched.
- **junior-developer JD-003, JD-004, JD-007, JD-008.** These added:
  - the blank area on a fresh start, to Behavior Change 2;
  - when the search re-runs, to S-10;
  - which failed reads are skipped, and that reads run in parallel, to S-4;
  - C-7 as the evidence behind the 200 ms wait (D-12).
- **user-experience-designer UX-001, UX-002, UX-003, UX-008.** Focus targets after the table's actions (D-17).
- **user-experience-designer UX-004, UX-009.** The hidden "Open " prefix in place of `aria-label`, and an
  always-visible actions button (D-11).
- **user-experience-designer UX-005, UX-006, UX-007, UX-012.** These added:
  - the always-mounted status line;
  - the sort arrow;
  - the search box's label and visible description;
  - one name for the table (D-12, D-9, D-18).
- **test-engineer.** These added:
  - the id-wiring and Delete-failure tests in Unit 1;
  - separate fixtures and the mid-search delete in Unit 2;
  - the encoded query in Unit 3;
  - the debounce, stale-answer, and tie-break tests in Unit 4;
  - the `ready` gate, the C-2 path, and the end-to-end search in Unit 5;
  - the pinned descending order, failure text, and message text (D-9, D-12).

Findings that rest on running the app are `Unverified`, because nobody ran it. None of them block the change:

- the reload flash (C-3);
- how screen readers announce `aria-sort` changes (UX-006);
- the menu overlap in a table (UX-002);
- the CSS order after the move (JD-006).

Each has a by-eye check in its unit or an open item.

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
Search matches the title and the saved text. The server does the matching through an optional `q` on the existing
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
export function usePostDialogs(docs: PostDialogsDocs, open: (id: string) => void): {
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
- the search box, labelled "Search posts" and described as "Searches titles and saved text.";
- the New post button;
- the table and its sort;
- the debounced search;
- its own open-failure alert;
- the row menus.

It does not own any dialog; it calls `usePostDialogs`. Its contract:

```ts
export interface PostTableDocs extends PostDialogsDocs {
  open(id: string): Promise<void>;
  search(query: string): Promise<string[]>;
}
export function PostTable({ docs, busy }: { docs: PostTableDocs; busy: boolean }): ReactElement;
```

The table's structure:

```html
<table aria-label="All posts">
  <thead><tr>
    <th aria-sort="ascending"><button>Title</button></th>
    <th><span class="visually-hidden">Actions</span></th>
  </tr></thead>
  <tbody><tr>
    <td><button aria-label="Open “Moon”">Moon</button></td>
    <td><button aria-label="More actions for “Moon”" aria-haspopup="menu" aria-expanded="false">…</button></td>
  </tr></tbody>
</table>
```

- **Sort.** Only Title sorts. The default is ascending, using the sidebar's `byTitle` comparator copied locally, and
  each press on the header flips the direction
  ([D-9](artifacts/change-decision-log.md#d-9-only-the-title-column-sorts-ascending-by-default)).
- **Opening.** A title click and the menu's Edit both open the post. A failure shows in the table's own alert
  ([D-10](artifacts/change-decision-log.md#d-10-edit-and-a-title-click-both-open-the-post)).
- **Button names.** The table's buttons are named `Open “…”` and `More actions for “…”`, so they never collide with the
  sidebar's ([D-11](artifacts/change-decision-log.md#d-11-the-tables-buttons-have-their-own-accessible-names)).
- **Search.** It waits 200 ms after typing stops and keeps only the latest answer. A blank query sends no request
  ([D-12](artifacts/change-decision-log.md#d-12-the-search-box-waits-200-ms-and-keeps-only-the-latest-answer)).
- **While Claude works.** New post and the actions buttons are disabled and point at the sidebar's `tree-paused` status
  line. Titles, Edit, and search stay usable
  ([D-8](artifacts/change-decision-log.md#d-8-while-claude-works-the-table-pauses-changes-the-way-the-sidebar-does)).
- **What it lists.** Only `docs.posts`. Unsaved posts the store no longer holds stay in the sidebar
  ([D-13](artifacts/change-decision-log.md#d-13-unsaved-posts-missing-from-the-store-are-not-in-the-table)).

**The search on the server** is a private `search` in `src/server/posts/posts.routes.ts`, behind an optional `q` on
`GET /api/posts` ([D-4](artifacts/change-decision-log.md#d-4-search-runs-on-the-server-through-an-optional-q-on-get-apiposts),
[D-5](artifacts/change-decision-log.md#d-5-the-search-lives-in-the-route-layer-not-on-poststore)):

```
GET /api/posts?q=%20tide%20
200 { "posts": [{ "id": "<Moon's id>", "title": "Moon" }] }
```

- **The rule.** `needle = q.trim().toLowerCase()`. A blank or absent `q` returns the full list. Otherwise a post
  matches when its lowercased title or body includes `needle`.
- **Vanished posts.** A post that is gone by the time its body is read is left out.
- **`PostStore` is unchanged.** It gains no method.

**Existing parts that change:**

- **`useDocuments`** gains `search(query)`, which sends the request and resolves to the matching ids. It also gains
  `ready: restored || restoreError !== undefined`
  ([D-7](artifacts/change-decision-log.md#d-7-the-table-waits-until-restore-has-finished)). It loses `newPosts` and
  `requestNewPost` ([D-2](artifacts/change-decision-log.md#d-2-the-newposts-counter-goes)).
- **`Editor`** renders `{docs.current === undefined && docs.ready && <PostTable docs={docs} busy={busy} />}` where
  `.empty-post` was.
- **`PostList`** calls `usePostDialogs` and renders its `dialogs`. It keeps its list, its menu, its alert, and its
  `byTitle`.
- **`Menu`** gains an `edit` icon ([D-16](artifacts/change-decision-log.md#trivial-decisions)).

## Surface Delta

### S-1: `usePostDialogs` and `PostDialogsDocs` — Added

**Target state.** `src/ui/documents/post-dialogs/post-dialogs.tsx` exports `PostDialogsDocs` and `usePostDialogs`,
with the signatures in Target State. The hook owns the New post / Rename title dialog and the Delete dialog: their
state, submit handlers, the duplicate-title hint, and the inline error. It returns `askNewPost`, `askRename`,
`askDelete`, and `dialogs`, a `ReactElement` holding both `<dialog>` elements. Heading and hint ids come from `useId()`.
It owns no list, menu, or open-failure alert.

**Behavior.** Preserving. The code moves from `PostList` as it stands. The dialogs' text, classes, ARIA wiring, focus,
and submit and error handling are unchanged, including the shared `dialogError` and the Delete dialog's missing
submit guard. Only the generated id values differ, and only tests read them.

**Why.** The table needs the same three dialogs, and they are private to `PostList` today
([C-4](artifacts/current-state-findings.md#c-4-the-rename-and-delete-dialogs-are-private-state-inside-postlist)).

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-dialogs-move-into-usepostdialogs-shared-by-the-sidebar-and-the-table)

### S-2: `PostList` and `PostListDocs` — Re-scoped

**Target state.** `PostList` owns the sidebar's flat list, its row menus, its open-failure alert, its `tree-paused`
status line, and Show in the post list. It gets its dialogs from `usePostDialogs` and renders `dialogs` where the two
`<dialog>` elements were. `PostListDocs` extends `PostDialogsDocs` with `missing`, `current`, `finds`, `label`, and
`open`. It no longer has `newPosts`, and `PostList` no longer watches it.

**Behavior.** Preserving. The sidebar renders the same markup, text, and styles. Its "+" and its row menus open the same
dialogs. The `newPosts` effect fired only for the empty state's New post, which S-11 replaces with the table's own.

**Why.** The dialogs are now shared, and the counter would open a second dialog.

**Depends on.** S-1.

**Migration.** `post-list.test.tsx` selects the hint by `.name-hint` instead of `#title-hint`, and drops `newPosts` from
`docsWith` and its New post counter test.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-dialogs-move-into-usepostdialogs-shared-by-the-sidebar-and-the-table),
[D-2](artifacts/change-decision-log.md#d-2-the-newposts-counter-goes)

### S-3: The dialog styles — Moved

**Target state.** The `dialog:is(.name, .confirm)` and `dialog.name` rules, including the spinner, live in
`src/ui/documents/post-dialogs/post-dialogs.css`, imported by `post-dialogs.tsx`. `post-list.css` keeps only the
sidebar's own rules.

**Behavior.** Preserving. The rules are the same text, and both stylesheets are bundled into the one page.

**Why.** The styles belong to the dialogs, which now render in two places.

**Depends on.** S-1.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-dialogs-move-into-usepostdialogs-shared-by-the-sidebar-and-the-table)

### S-4: `GET /api/posts` — Re-scoped

**Target state.** `GET /api/posts` takes an optional `q` query parameter.

- With `q` absent or blank after trimming, it answers every post, as `PostList`, exactly as before.
- With a non-blank `q`, it answers only the posts whose title or saved body contains `q.trim()`, ignoring case, as
  `PostList`, in no order.
- A post deleted while the search runs is left out.
- Any error other than a `PostError` is a plain-text 500.

The matching is a private `search` in `posts.routes.ts`, which calls `list()` and then `get()` per post. `PostStore`
does not change.

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
bodies, still newest first. The query string is split off before the URL is matched. It still records each request
in `requests`, with the full URL.

**Behavior.** Preserving for every existing test, none of which sends `q`. Today a `?q=` URL falls through to a 404
([C-15](artifacts/current-state-findings.md#c-15-the-fake-posts-api-lists-newest-first-and-uses-ids-with--and-spaces)).

**Why.** UI tests of the table need the search answered.

**Depends on.** S-4.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-search-runs-on-the-server-through-an-optional-q-on-get-apiposts)

### S-7: `useDocuments().search` — Added

**Target state.** `useDocuments` returns `search(query: string): Promise<string[]>`. It sends
`GET /api/posts?q=${encodeURIComponent(query)}` and resolves to the ids of the matching posts. It rejects with the
request's error. It does not change `posts`.

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
signatures in Target State. `PostTable` renders, in order:

- the "Your posts" heading;
- an open-failure alert, when there is one;
- a `type="search"` box labelled "Search posts" and described as "Searches titles and saved text.";
- a New post button;
- a search-failure alert, when there is one;
- the table, or "No posts yet." or `No posts match “<query>”.` in its place.

What it does:

- **Rows.** It lists `docs.posts`, filtered by the latest search answer and sorted by title. The sort is ascending by
  default and flips on each press of the Title header, with `aria-sort` on that `<th>`.
- **Opening.** A title click and the menu's Edit open the post.
- **Rename and Delete.** They call `askRename` and `askDelete`.
- **New post.** It calls `askNewPost`.
- **While Claude works.** New post and the actions buttons are disabled, with `aria-describedby="tree-paused"`, and an
  open menu hides.

It imports nothing from `documents.tsx`. Its styles live in `post-table.css`, and the actions cell is positioned so its
menu is not clipped.

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
[D-6](artifacts/change-decision-log.md#d-6-search-matches-saved-text-not-unsaved-edits),
[D-13](artifacts/change-decision-log.md#d-13-unsaved-posts-missing-from-the-store-are-not-in-the-table)

### S-11: The `Editor` empty state — Removed

**Target state.** `Editor` has no `.empty-post` block, no "Pick a post to start" heading, and no `.empty-post` styles
in `documents.css`. When no post is open and `docs.ready` is true, `Editor` renders `PostTable` below the editor bar.
When `docs.ready` is false, nothing renders there.

**Behavior.** Changing. The writer sees the post table where the heading and sentence were. A writer reloading with a
post open sees a blank area, not a flash of the landing page. Settled under the user's delegation.

**Why.** The user's request
([C-1](artifacts/current-state-findings.md#c-1-the-landing-page-is-the-editors-empty-state)).

**Depends on.** S-8, S-10, S-12.

**Migration.** `documents.test.tsx` asserts the "Your posts" heading in place of "Pick a post to start" and its
sentence. The fresh-workspace request count stays three `GET /api/posts`.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-table-replaces-the-empty-state-inside-editor),
[D-7](artifacts/change-decision-log.md#d-7-the-table-waits-until-restore-has-finished)

### S-12: `newPosts` and `requestNewPost` — Removed

**Target state.** `useDocuments` returns neither. Starting a new post from the landing page is `PostTable`'s, through
`usePostDialogs().askNewPost`. Starting one from the sidebar stays `PostList`'s "+".

**Behavior.** Preserving for the writer. One click on the landing page's New post opens one New post dialog, with the
same heading, box, and buttons as before.

**Why.** If both the counter and the table's own dialog stayed, one click would open two dialogs
([C-5](artifacts/current-state-findings.md#c-5-new-post-from-the-empty-state-reaches-the-sidebar-through-a-counter)).

**Depends on.** S-2, S-10. It lands in the same unit as S-11.

**Migration.** `documents.test.tsx` drops "New post in the empty editor asks the Posts list for a new post". Its busy
assertion moves to `post-table.test.tsx`.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-newposts-counter-goes)

## Behavior Changes

Each of these was settled under the user's standing delegation to decide without asking. Any of them can be reversed.

1. **The landing page is a post table.** On a fresh start, or after the open post goes away, the writer sees:
   - "Your posts";
   - a search box;
   - New post;
   - a table of every post by title.

   "Pick a post to start" and its sentence are gone (S-11,
   [D-1](artifacts/change-decision-log.md#d-1-the-table-replaces-the-empty-state-inside-editor)).
2. **No flash on reload.** A writer who reloads with a post open sees an empty area under the editor bar until the post
   reappears. Today they see "Pick a post to start" for a moment (S-11,
   [D-7](artifacts/change-decision-log.md#d-7-the-table-waits-until-restore-has-finished)).
3. **Search sees saved text only.** A writer types a word they just added to an open post without saving, and that post
   does not match. The search box says "Searches titles and saved text." (S-10,
   [D-6](artifacts/change-decision-log.md#d-6-search-matches-saved-text-not-unsaved-edits)).
4. **The table lists only posts the store has.** An open post with unsaved changes that was deleted on disk appears
   in the sidebar but not in the table (S-10,
   [D-13](artifacts/change-decision-log.md#d-13-unsaved-posts-missing-from-the-store-are-not-in-the-table)).

Every other entry is behavior-preserving.

## Change Units

### Unit 1: Move the dialogs out of the sidebar

**What it does.** Extracts `usePostDialogs` and its styles. `PostList` uses it. The sidebar looks and works the same.

**Delta entries.** S-1, S-3, and S-2 except for the `newPosts` removal. `newPosts` stays on `PostListDocs`, and its
effect stays in `PostList`, calling the hook's `askNewPost`.

**How you know it worked.** `post-list.test.tsx` and `app.test.tsx` pass, with only `#title-hint` changed to
`.name-hint`.

### Unit 2: Search on the server and in the fake

**What it does.** Adds `?q=` to `GET /api/posts`, the same rule in `fakePostsApi`, and the wire comment.

**Delta entries.** S-4, S-5, S-6.

**How you know it worked.** New tests in `posts.routes.test.ts` cover:

- the worked example in Target State;
- a blank `q` returning everything;
- a case-insensitive match on the body;
- a post deleted mid-search being left out.

All existing route and UI tests pass unchanged.

### Unit 3: The hook's search and ready, and the Edit icon

**What it does.** Adds `search` and `ready` to `useDocuments` and `edit` to `ACTION_PATHS`. Nothing reads them yet.

**Delta entries.** S-7, S-8, S-9.

**Ordering constraint.** After Unit 2, because `search`'s tests run against the fake.

**How you know it worked.** Hook tests show:

- `ready` is false before `restore` resolves, and true after it;
- `ready` is true after `restoreFailed`;
- `search('tide')` resolves to the matching ids and sends `GET /api/posts?q=tide`.

### Unit 4: Build the post table

**What it does.** Adds `PostTable` with its tests, rendered only by its own tests.

**Delta entries.** S-10.

**Ordering constraint.** After Units 1 and 3.

**How you know it worked.** `post-table.test.tsx` covers:

- sorting both ways against the fake's newest-first list;
- `aria-sort`;
- debounced search, and a stale answer dropped;
- the blank query sending no request;
- both empty messages;
- a search failure;
- a title click and Edit opening the post, and an open failure showing in the table's alert;
- Rename and Delete opening their dialogs;
- the busy pause.

### Unit 5: Put the table on the landing page

**What it does.** Mounts `PostTable` in `Editor` behind `docs.ready`, removes `.empty-post`, and removes the
`newPosts` counter from the hook, `PostListDocs`, and `PostList`.

**Delta entries.** S-11, S-12, and the `newPosts` part of S-2.

**Ordering constraint.** After Unit 4. The counter removal and the mount land together. Removing the counter first
breaks the old New post button, and mounting first opens two dialogs per click.

**How you know it worked.**

- `documents.test.tsx` finds "Your posts" on a fresh workspace with three `GET /api/posts` requests.
- `app.test.tsx`'s New post in the editor opens exactly one `dialog.name[open]`.
- The sidebar queries in `app.test.tsx` still match one element each.

## Risks

- **Duplicate matches in app tests.** If a table button shares an accessible name with a sidebar button,
  `getByRole` throws in `app.test.tsx`. Unit 5's run of `app.test.tsx` catches it. The blast radius is tests only
  ([D-11](artifacts/change-decision-log.md#d-11-the-tables-buttons-have-their-own-accessible-names)).
- **Search cost grows with the number of posts.** Each search reads every body, and each read locates its post on
  disk. The 200 ms wait limits it to one search per pause in typing. No workload has been measured. A slow search shows
  stale rows until it answers, and nothing breaks
  ([D-4](artifacts/change-decision-log.md#d-4-search-runs-on-the-server-through-an-optional-q-on-get-apiposts)).
- **The borrowed status line.** The table's paused buttons point at `tree-paused`, which lives in the sidebar. If the
  sidebar rework removes it, the description dangles silently
  ([D-8](artifacts/change-decision-log.md#d-8-while-claude-works-the-table-pauses-changes-the-way-the-sidebar-does)).
- **Menu clipping.** `Menu` is absolutely positioned. A scrolling table wrapper clips the menu on the last rows. Check
  it by eye in the running app with enough posts to scroll.

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

### A paused status line of the table's own
**Why deferred:** Simpler-version test. The sidebar's line already says it, and two would announce twice.
**Reopen when:** The sidebar rework changes or removes `tree-paused`.
**Source:** [D-8](artifacts/change-decision-log.md#d-8-while-claude-works-the-table-pauses-changes-the-way-the-sidebar-does).

## Cut for Scope

- **Fixing the Delete dialog's double submit and the shared error between the two dialogs.** In the sidebar today, a
  quick double click on Delete sends two deletes, and the second shows an error even though the first worked. Fixing it
  changes sidebar behavior, which the boundary excludes: "leave the sidebar for now. we'll make changes to it later".
  The table inherits the same behavior through the shared dialogs.
- **Telling a failed post list apart from an empty one.** When the list cannot load, the table shows "No posts yet.",
  the same as a workspace with no posts
  ([C-13](artifacts/current-state-findings.md#c-13-a-failed-list-load-looks-the-same-as-having-no-posts)). This is
  a gap that already exists, and the request does not ask to fix it.
- **Any change to the sidebar's look or behavior.** Excluded by the boundary.

## Open Items

None blocking. One non-blocking item: whether "Your posts" is the heading the user wants. It is a placeholder chosen
here, and changing it touches one string and one test.

## Review Findings

Pending the review round.

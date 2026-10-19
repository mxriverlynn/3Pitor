# Current State Findings: Post Table Landing Page

## Provenance

No prior findings report existed. This run's own discovery round produced these findings on 2026-10-19:

- `han-core:structural-analyst` (its S-1 to S-7), over `src/ui/documents/`, `src/ui/components/menu/`, `src/ui/app.tsx`,
  `src/shared/wire.ts`, `src/server/posts/posts.routes.ts`, and `src/posts/posts.ts`.
- `han-core:behavioral-analyst` (its B-1 to B-9), over the same area plus `src/posts/file/file-post-store.ts` and the
  engine's posts-changed emission.
- `han-core:concurrency-analyst` was not dispatched. The area's only async coordination is the list's latest-call-wins
  counter and the sync coalescing, both already covered by the behavioral round.

Where an analyst marked a claim unverified because it did not open a file, the run's own sweep opened that file
(`wire.ts`, `fake-posts-api.ts`, `confirm-dialog.tsx`, `post-list.css`, `file-post-store.ts`). Those claims are
recorded here as Verified.

## Project Context

- **Stack:** Bun, TypeScript 7, React 19, Hono 4 server, zod. UI tests run with `bun test` on happy-dom and
  `@testing-library/react`. From `package.json`.
- **Conventions source:** none found. There is no `CLAUDE.md` and no `project-discovery.md`. The conventions come from
  the code itself and the earlier plans under `docs/changes/`: a comment above each unit saying what it is for, one
  folder per feature (`src/ui/documents/post-list/post-list.{tsx,css,test.tsx}`), and wire types in
  `src/shared/wire.ts` paired with `c.json<T>` on the server.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** across the last 90 days, `src/ui/documents/documents/documents.tsx` (31 commits) and its test (28)
  churn the most in this area, after the markdown editor. `post-list/` is new: it arrived in PR #39
  (`57ad03e`, "Add the flat post list, not yet mounted"), which replaced the old `file-tree/`.

## Gaps

- No table, column-sort, or text-search code exists anywhere in `src/` (C-9).
- No server route returns post bodies in bulk, and no route searches (C-7).
- No ADR or coding standard covers UI component reuse or accessibility.
- The hook exposes no "restore has finished" or "the first list has loaded" signal (C-3).

## Findings

### C-1: The landing page is the Editor's empty state

- **Claim:** What the app shows when no post is open is a block inside `Editor`, rendered whenever `docs.current` is
  undefined. It has a heading, a sentence, and a New post button.
- **Location:** `src/ui/documents/documents/documents.tsx`, `Editor`, the `.empty-post` block; styles in
  `src/ui/documents/documents/documents.css` (`.empty-post`).
- **Evidence:**
  ```tsx
  {docs.current === undefined && (
    <div className="empty-post">
      <svg ...>...</svg>
      <h2>Pick a post to start</h2>
      <p>Choose a post from the list, or start a new one. Claude can help once a post is open.</p>
      <button className="primary" disabled={busy} aria-describedby="tree-paused" onClick={docs.requestNewPost}>
        New post
      </button>
    </div>
  )}
  ```
- **Raised by:** structural-analyst S-2, behavioral-analyst B-1; read by the run.
- **Confidence:** Verified.
- **Bears on:** S1, S2, D1, D2.

### C-2: The empty state also shows mid-session, not only at start

- **Claim:** `current` becomes undefined again after the writer deletes the open post, after an outside delete of a
  clean open post, after Discard, after an Undo all that gets a 404, and after a restore that cannot reopen its post.
- **Location:** `documents.tsx`, `forget`, called from `remove`, `discard`, `syncFile`, and `undoTurn`; `restore`.
- **Evidence:**
  ```ts
  const forget = (name: string) => {
    opened.current.delete(name);
    if (currentRef.current === name) show(undefined);
  ```
- **Raised by:** behavioral-analyst B-2.
- **Confidence:** Verified.
- **Bears on:** D1.

### C-3: Nothing marks "restore not finished", so the landing page shows briefly on every reload with a post open

- **Claim:** `current` starts undefined and is set only after `restore` has fetched the view state, the list, and the
  post. The hook keeps a `restored` state but does not return it, and `listLoaded` is a ref it does not return either.
  `posts` starts as `[]`.
- **Location:** `documents.tsx`, `useDocuments`: `const [restored, setRestored] = useState(false);`,
  `const listLoaded = useRef(false);`, `restore` (ends `show(file); ... setRestored(true);`), and the return object
  (no `restored`, no `listLoaded`).
- **Evidence:**
  ```ts
  // True once the stored view is back: from then on, every change to the view is stored.
  const [restored, setRestored] = useState(false);
  ...
  // False until the first list is applied: until then, no post is known to be missing.
  const listLoaded = useRef(false);
  ```
- **Raised by:** behavioral-analyst B-1.
- **Confidence:** Verified. Today the flash is a heading and a sentence; a table would make it more visible.
- **Bears on:** S6, D7.

### C-4: The Rename and Delete dialogs are private state inside `PostList`

- **Claim:** The title dialog (shared by New post and Rename), the Delete dialog, the duplicate-title hint, and
  `DialogError` all live inside `post-list.tsx`. Their state (`pending`, `draft`, `dialogError`, `submitting`,
  `deleting`, two dialog refs) is local to `PostList`, so nothing outside the sidebar can open them. `dialogError` is one
  value shared by both dialogs. The Delete dialog has no `submitting` guard.
- **Location:** `src/ui/documents/post-list/post-list.tsx`: `duplicateHint`, `Pending`, `DialogError`, the state at the
  top of `PostList`, `ask`, `askNewPost`, `actions(post)`, and the two `<dialog>` elements. Dialog styles are in
  `post-list.css` under `dialog:is(.name, .confirm)`.
- **Evidence:**
  ```ts
  const [pending, setPending] = useState<Pending>();
  const [draft, setDraft] = useState('');
  const [dialogError, setDialogError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const titleDialog = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState<PostSummary>();
  const deleteDialog = useRef<HTMLDialogElement>(null);
  ```
- **Raised by:** structural-analyst S-1, behavioral-analyst B-8.
- **Confidence:** Verified.
- **Bears on:** S3, S4, D3.

### C-5: New post from the empty state reaches the sidebar through a counter

- **Claim:** The empty state's New post button bumps `newPosts` in the hook, and `PostList` opens its dialog when the
  counter changes. A second component that also watched `newPosts` would open a second dialog on one click. The button
  also points `aria-describedby` at `tree-paused`, an element inside `PostList`.
- **Location:** `documents.tsx` (`newPosts`, `requestNewPost`); `post-list.tsx` (the `docs.newPosts` effect, the
  `<p className="paused" role="status" id="tree-paused">`).
- **Evidence:**
  ```ts
  useEffect(() => {
    if (docs.newPosts && !busy) askNewPost();
  }, [docs.newPosts]);
  ```
- **Raised by:** structural-analyst S-2, behavioral-analyst B-8.
- **Confidence:** Verified.
- **Bears on:** S2, D2.

### C-6: `PostListDocs` is a narrow structural interface the hook already satisfies

- **Claim:** `PostList` declares what it needs from the hook as its own interface and imports nothing from
  `documents.tsx`. `Editor` takes the whole `Documents` type, so it already has `posts`, `open`, `rename`, `remove`,
  `isDirty`, and `createPost`.
- **Location:** `post-list.tsx`, `export interface PostListDocs`; `documents.tsx`,
  `export type Documents = ReturnType<typeof useDocuments>`; `app.tsx`, `<PostList docs={docs} busy={chat.busy} />`.
- **Evidence:**
  ```ts
  export interface PostListDocs {
    posts: PostSummary[];
    missing: string[];
    current?: string;
    finds: number;
    newPosts: number;
    label(id: string): string;
    isDirty(id: string): boolean;
    open(id: string): Promise<void>;
    createPost(title: string): Promise<string>;
    rename(id: string, title: string): Promise<void>;
    remove(id: string): Promise<void>;
  }
  ```
- **Raised by:** structural-analyst S-3.
- **Confidence:** Verified.
- **Bears on:** S3, S5.

### C-7: The page has titles for every post but no bodies

- **Claim:** `GET /api/posts` returns `{ posts: { id, title }[] }`, in no order. `PostStore.list()` is documented as
  carrying no body. The only way to get a body is `GET /api/posts/:id`, one post at a time. In the file store each `get`
  locates the post (a root listing plus listings down its path) and reads `draft.md`. `list()` has two callers: the
  route and the AI's Posts tool (`src/engine/chat/tools/tools.ts`).
- **Location:** `src/posts/posts.ts` (`PostSummary`, `PostStore.list`), `src/shared/wire.ts` (`PostSummary`, `Post`,
  `PostList`), `src/server/posts/posts.routes.ts`, `src/posts/file/file-post-store.ts` (`list`, `get`).
- **Evidence:**
  ```ts
  // What list() gives for each post: enough to show and pick it, without its body.
  export interface PostSummary {
  ```
  ```ts
  app.get('/api/posts', async (c) => c.json<PostList>(await posts.list()));
  app.get('/api/posts/:id', async (c) => c.json<Post>(await posts.get(c.req.param('id'))));
  ```
- **Raised by:** structural-analyst S-6, behavioral-analyst B-3; callers confirmed by the run's grep.
- **Confidence:** Verified.
- **Bears on:** S7, S8, D4, D5.

### C-8: Open posts with unsaved changes hold text the store does not have

- **Claim:** An open post's live text is in its Y.Doc inside the ref-held `opened` map. The stored body only changes
  on Save. The hook exposes `isDirty(id)` but not any post's live text.
- **Location:** `documents.tsx`, `Entry`, `opened`, `track`, `isDirty`.
- **Evidence:**
  ```ts
  isDirty: (name: string) => opened.current.get(name)?.dirty ?? false,
  ```
- **Raised by:** behavioral-analyst B-4.
- **Confidence:** Verified.
- **Bears on:** D6.

### C-9: There is no table, sort, or search code to reuse

- **Claim:** The only sort in UI code is the sidebar's private `byTitle`. There is no table component, no
  `aria-sort`, and no text-filter helper.
- **Location:** `post-list.tsx`: `const byTitle = (a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : ...)`,
  used as `[...docs.posts].sort(byTitle)`.
- **Evidence:**
  ```ts
  // By title, then by id, so posts that share a title keep one order.
  const byTitle = (a: PostSummary, b: PostSummary) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  ```
- **Raised by:** structural-analyst S-4.
- **Confidence:** Verified for `<table`, `aria-sort`, and `.sort(`. The analyst's grep for `filter(` failed; the run's
  reading of `post-list.tsx`, `documents.tsx`, and `menu.tsx` found no text filter.
- **Bears on:** S5, S9.

### C-10: `Menu` needs an icon for every item, and has none for Edit

- **Claim:** `Item.icon` must be a key of `ACTION_PATHS`. Rename and Delete icons exist; there is no edit or open icon.
  `Menu` is absolutely positioned against its nearest positioned ancestor, focuses its first item on mount, and closes on
  Escape (while focus is inside it) or a press outside it and its opener. The caller owns which row's menu is open.
- **Location:** `src/ui/components/menu/menu.tsx`, `menu.css`.
- **Evidence:**
  ```ts
  export type Item = { label: string; icon: Action; run: () => void };
  ```
- **Raised by:** structural-analyst S-5, behavioral-analyst B-7.
- **Confidence:** Verified.
- **Bears on:** S10.

### C-11: The Claude-is-working pause lives only in the sidebar's buttons

- **Claim:** `open`, `rename`, `remove`, and `createPost` in the hook accept calls at any time. The pause on changing
  posts while Claude works is enforced in `PostList` with `disabled={busy}` and `const menu = busy ? undefined :
  openMenu`. Opening a post stays allowed while busy.
- **Location:** `post-list.tsx`; `documents.tsx`.
- **Evidence:**
  ```ts
  const menu = busy ? undefined : openMenu;
  ```
  ```tsx
  {busy && 'Changes to the post list are paused while Claude works. You can still open posts.'}
  ```
- **Raised by:** behavioral-analyst B-5, B-7.
- **Confidence:** Verified.
- **Bears on:** S5, D8.

### C-12: Open failures surface in the sidebar's own alert

- **Claim:** `docs.open` rejects when the post cannot be read, for example a 404 for a post deleted since the list was
  fetched. `PostList` catches that into a local `alert` state shown in the sidebar. Nothing in `Editor` would show it.
- **Location:** `post-list.tsx`, `const [alert, setAlert] = useState<string>();` and its `open` wrapper.
- **Evidence:**
  ```ts
  const open = (id: string) =>
    docs.open(id).then(
      () => setAlert(undefined),
      (error: Error) => setAlert(error.message),
    );
  ```
- **Raised by:** structural-analyst S-3, behavioral-analyst B-5.
- **Confidence:** Verified.
- **Bears on:** S5.

### C-13: A failed list load looks the same as having no posts

- **Claim:** The first `refreshList` on mount only logs a failure; `syncOnce` also swallows errors. `posts` stays `[]`.
- **Location:** `documents.tsx`, the mount effect's `refreshList().catch(...)` and `syncOnce`.
- **Evidence:**
  ```ts
  console.error('Could not sync with the disk:', error)
  ```
- **Raised by:** behavioral-analyst B-5.
- **Confidence:** Verified.
- **Bears on:** Cut list (C-13 is a pre-existing gap the request does not ask to fix).

### C-14: Tests that pin the empty state and the sidebar

- **Claim:** `documents.test.tsx` asserts the "Pick a post to start" heading and sentence, and that a fresh workspace
  makes exactly three `GET /api/posts` requests and no body reads. It also tests that New post in the empty editor bumps
  `newPosts`. `app.test.tsx` clicks New post inside the editor and expects the sidebar's dialog, and it finds the
  sidebar's `Actions for Notes` with `within(aside.files)`. `post-list.test.tsx` renders `PostList` with a local
  `docsWith` stand-in and checks dialogs through `dialog.name[open]`.
- **Location:** `src/ui/documents/documents/documents.test.tsx` ("a fresh workspace opens nothing…", "New post in the
  empty editor asks the Posts list for a new post"); `src/ui/app.test.tsx`; `src/ui/documents/post-list/post-list.test.tsx`.
- **Evidence:**
  ```ts
  expect(screen.getByRole('heading', { name: 'Pick a post to start' })).toBeTruthy();
  expect(api.requests).toEqual(['GET /api/posts', 'GET /api/posts', 'GET /api/posts']);
  ```
- **Raised by:** structural-analyst S-7; read by the run.
- **Confidence:** Verified.
- **Bears on:** S1, S7, Change Units.

### C-15: The fake posts API lists newest first and uses ids with "/" and spaces

- **Claim:** `fakePostsApi` lists posts newest first so a page that forgets to sort fails. Its ids look like `"1/p 1"`,
  so any new URL must encode ids. It answers only `/api/posts` and `/api/posts/:id[/title|body]`; any other post URL is
  a 404.
- **Location:** `src/ui/components/fake-posts-api.ts`.
- **Evidence:**
  ```ts
  const [, encoded, field] = url.match(/^\/api\/posts\/([^/]+)(?:\/(title|body))?$/) ?? [];
  ```
- **Raised by:** structural-analyst S-7; read by the run.
- **Confidence:** Verified.
- **Bears on:** S8.

## Findings No Agent Could Audit

Nobody ran the app or the test suite. Every runtime claim (the reload flash in C-3, the empty-state paths in C-2) is
traced from the source, not observed. Running the app with a post open and reloading would confirm C-3.

# Current State Findings: Post Title and Heading Sync

## Provenance

No prior findings report exists. This run produced its own discovery round on 2026-10-19:

- `han-core:structural-analyst` (findings S-1 to S-10 in its report), over `src/posts/`, `src/server/posts/`,
  `src/engine/chat/tools/`, `src/ui/documents/`, and `src/shared/`.
- `han-core:behavioral-analyst` (findings B-1 to B-15 in its report), over the rename, save, create, AI-edit, display,
  and error flows across the same area.
- `han-core:concurrency-analyst` was not dispatched. The area's async coordination (a save in flight, list-refresh
  ordering, the store's per-post queue) is single-threaded JavaScript, and the behavioral analyst covered it (B-12).

The two reports are merged by substance below. Each `C-N` names the findings it came from. The run's own sweep checked
the routes, the wire comment, the `NewPost` tool, and the merge helpers directly.

## Project Context

- **Stack:** Bun + TypeScript, Hono server, React browser UI with a ProseMirror/Yjs editor, Vercel AI SDK engine.
  Tests run under `bun test` through `make test`, which also runs `make check-node` (the engine loaded on Node).
- **Conventions source:** `README.md` "How `src/` is laid out" (package import rules, feature and component folders).
  No CLAUDE.md or `project-discovery.md`.
- **ADRs found:** none found under `docs/adr/`. The nearest record is the post-management API design,
  `docs/changes/post-management-api/`, whose decision D9 made title and heading independent (C-2).
- **Coding standards found:** none found.
- **Recent churn:** over the last 90 days, `src/ui/documents/markdown-editor/` (57 commits to `markdown-editor.tsx`)
  and `src/ui/documents/documents/documents.tsx` (47) change most. `src/posts/file/file-post-store.ts` (10),
  `src/engine/chat/tools/tools.ts` (7), and `src/server/posts/` change rarely.

## Gaps

- No function anywhere reads or sets a heading in a markdown string. The only heading code is private to the editor
  and works on an editor document (C-5).
- No test asserts the Rename dialog's hint text (C-9).
- No shared place decides a new post's starting text. The routes and the engine tool each pass `body: ''` (C-10).
- No coding standard or ADR covers markdown escaping or title normalization.
- The file-system watch implementation was not read, so it is not known whether one Save that makes two store writes
  reaches the browser as one `posts-changed` signal or two. The browser's sync coalesces either way (C-12).

## Findings

### C-1: Title and body are separate files, written by separate store calls

- **Claim:** The file store keeps a post's title in `<post>/.post.json` and its body in `<post>/draft.md`. `setTitle`
  and `setBody` are separate calls, each queued per post id. No call writes both.
- **Location:** `src/posts/file/file-post-store.ts`, `writeTitle` (lines 188-191), `setBody` and `setTitle` (296-317),
  `enqueue` (52-64)
- **Evidence:**
  ```ts
  async setTitle(id, title) {
    if (title.trim() === '') throw new PostError('invalid', 'post');
    return changing(() => enqueue(id, async () => { await locatePost(id); await writeTitle(id, title); }));
  },
  ```
- **Raised by:** behavioral-analyst B-1, B-12; structural-analyst S-9
- **Confidence:** Verified
- **Bears on:** D-2, S-3, S-4

### C-2: The store's contract says title and heading are independent, by a prior decision

- **Claim:** `PostStore`'s contract says the store never reads or writes a heading in a body, and that the title and a
  `#` heading can disagree. The post-management design chose this in its decision D9 and dropped a `shared/markdown`
  dependency from the posts package as a result.
- **Location:** `src/posts/posts.ts` lines 31-41; `docs/changes/post-management-api/artifacts/decision-log.md` D9;
  `docs/changes/post-management-api/artifacts/chosen-option.md` line 592
- **Evidence:**
  ```ts
  // The post's markdown, exactly as last given. The store checks nothing about it and never reads or writes a heading
  // in it: the title is separate metadata, and any H1 belongs to the caller. The title and an H1 are independent and
  // can disagree.
  ```
  D9: "The H1 belongs to the caller. The store never reads or writes it. The title is separate metadata."
- **Raised by:** structural-analyst S-8; behavioral-analyst B-1
- **Confidence:** Verified
- **Bears on:** D-2

### C-3: Only `src/shared/` is importable by every writer of a post

- **Claim:** A post's title or body is written from four places: the UI's rename and save, the server's post routes,
  and the engine's `NewPost` tool. Under the README's import rules, `src/ui/` imports none of server, engine, or posts,
  and the server and engine cannot import the UI. Code all of them use must live in `src/shared/`, which imports no
  package. Engine code must stay Bun-free (`make check-node`).
- **Location:** `README.md` lines 17-66; `src/posts/boundary.test.ts` lines 21-60; `Makefile` lines 39-43
- **Evidence:** README: "`src/ui/` imports none of cli, server, engine, file-system, or posts; `src/shared/` imports no
  package."
- **Raised by:** structural-analyst S-1
- **Confidence:** Verified
- **Bears on:** D-1, S-1

### C-4: `src/shared/markdown.ts` holds the one CommonMark parser and serializer, with no heading API

- **Claim:** `shared/markdown.ts` exports `schema` (with a `heading` node and a `level` attribute), `markdownParser`,
  `markdownSerializer`, and `parseMarkdown`. It imports only npm packages (markdown-it, prosemirror-model,
  prosemirror-markdown) and is already loaded by the engine, so it is Bun-free. The UI and engine import it; the
  server's production code does not yet. Because the parser is CommonMark, a `#` inside a fenced code block is code,
  not a heading, and setext headings (`Title` over `===`) are headings.
- **Location:** `src/shared/markdown.ts` lines 6-16, 68, 86, 118
- **Evidence:** the exports named above; importers are `ui/documents/markdown-editor/markdown-editor.tsx`,
  `task-items.ts`, `raw-formatting.ts`, and `engine/chat/tools/tools.ts`.
- **Raised by:** structural-analyst S-2
- **Confidence:** Verified
- **Bears on:** D-1, D-4, S-1

### C-5: The only heading finders are private to the editor

- **Claim:** `headingsOf(doc: Y.Doc)` lists top-level headings of levels 1 to 5 for the Outline box, skipping empty
  ones and collapsing whitespace. `rawHeadingStart(text, ordinal)` finds a heading's line in a markdown string through
  markdown-it tokens (`heading_open`, `level === 0`, `map[0]`). Both live in the 1,900-line editor module, and
  `rawHeadingStart` is not exported. Neither returns the first level-1 heading or rewrites one.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.tsx` lines 58-86
- **Evidence:**
  ```ts
  if (node.type.name !== 'heading') return;
  const text = node.textContent.replace(/\s+/g, ' ').trim();
  if (node.attrs.level <= 5 && text) headings.push({ level: node.attrs.level, text, pos, ordinal });
  ```
  `rawHeadingStart` shows that `markdownParser.tokenizer.parse(text, {})` already finds a heading's source lines in a
  plain string.
- **Raised by:** structural-analyst S-3
- **Confidence:** Verified
- **Bears on:** D-1, D-4

### C-6: The editor changes an open document only by applying a whole markdown string

- **Claim:** `markdownOf(doc)` serializes the editor document. `replaceMarkdown(live, markdown)` makes the document hold
  text read from disk and clears its undo history. `mergeMarkdown(live, base, markdown)` applies an AI edit under
  `AI_ORIGIN`, which Undo tracks, and keeps the user's concurrent typing. There is no "edit one heading" call.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.tsx` lines 52-54, 121-144
- **Evidence:**
  ```ts
  export function replaceMarkdown(live: Y.Doc, markdown: string): void {
    applyMarkdown(live, snapshot(live), markdown);
    undoManagers.get(live)?.clear();
  }
  ```
- **Raised by:** structural-analyst S-4; this run's sweep
- **Confidence:** Verified
- **Bears on:** D-6, S-6

### C-7: The UI's `rename` changes the title and never touches the open editor

- **Claim:** `useDocuments().rename` sends `PUT /api/posts/:id/title`, then refreshes the list. It does not read or
  change the `opened` entry, so an open post keeps its old `#` line, its `saved` text, and its unsaved state.
- **Location:** `src/ui/documents/documents/documents.tsx` lines 247-254
- **Evidence:**
  ```ts
  // Gives a post a new title. Its id, its text, and any unsaved changes to it stay as they are.
  const rename = useCallback(
    async (id: string, title: string) => {
      await api('PUT', `${postUrl(id)}/title`, { title });
      await refreshList();
    },
  ```
- **Raised by:** structural-analyst S-5; behavioral-analyst B-4
- **Confidence:** Verified
- **Bears on:** D-6, S-6

### C-8: A body change under an open post either reloads it or raises the "changed on disk" notice

- **Claim:** Every store write signals `posts-changed`; the tab then runs `syncWithDisk`, which refreshes the list and
  calls `syncFile` for each open file. For a post with no unsaved changes, a new disk text replaces the editor's
  (`followDisk`). For one with unsaved changes, the editor shows "This file changed on disk since you opened it. Save
  overwrites it.", with keep and take choices. A read that raced a save (`entry.saving`, or `entry.saves` changed) is
  dropped. So if the server rewrote a dirty open post's `#` line, the writer's next Save would write the old line back.
- **Location:** `src/engine/engine.ts` line 81; `src/ui/app.tsx` lines 103-123; `src/ui/documents/documents/documents.tsx`
  lines 294-301 (`followDisk`), 327-405 (`syncFile`), 355 (dropped read)
- **Evidence:**
  ```ts
  const followDisk = (entry: Entry, text: string) => {
    replaceMarkdown(entry.doc, text);
    entry.saved = text;
    entry.dirty = false;
    entry.diskText = entry.keptOver = undefined;
  };
  ```
- **Raised by:** behavioral-analyst B-5, B-12; structural-analyst S-5
- **Confidence:** Verified
- **Bears on:** D-6, S-6

### C-9: The Rename dialog's hint promises the opposite of the change

- **Claim:** One `usePostDialogs` hook serves the Rename item in a post-table row's menu and in the open post's menu.
  Its hint tells the writer the heading stays as it is. No test asserts the string. A blank title cannot be submitted
  (the button is disabled), and a refusal shows the server's sentence in the dialog, which stays open.
- **Location:** `src/ui/documents/components/post-dialogs/post-dialogs.tsx` lines 97-107, 131-137;
  `src/ui/documents/documents/post-table.tsx` line 106; `src/ui/documents/post-panel/post-panel.tsx` line 113
- **Evidence:**
  ```ts
  hint: 'Only the name in the list changes. The post’s text, including any heading at the top, stays as it is.',
  ```
- **Raised by:** structural-analyst S-6; behavioral-analyst B-3, B-13
- **Confidence:** Verified
- **Bears on:** S-7

### C-10: Every new post starts with an empty body, from two separate call sites

- **Claim:** `POST /api/posts` calls `posts.create({ title, body: '' })`. The engine's `NewPost` tool calls the same
  store method with `body: ''`, then puts the model's `content` into the editor as an unsaved edit
  (`markEdited(turn, id, content)`). The model's `content` may have no `#` line, or one that differs from `title`. The
  tool description, the wire comment, and the README all say the post is made empty.
- **Location:** `src/server/posts/posts.routes.ts` lines 44-47; `src/engine/chat/tools/tools.ts` lines 228-246;
  `src/shared/wire.ts` line 66; `README.md` lines 6, 267, 451
- **Evidence:**
  ```ts
  id = await posts.create({ title, body: '' });
  ...
  markEdited(turn, id, content);
  ```
  Tool description: "The post is made empty at once, and the text appears in the writer's editor as an unsaved edit".
- **Raised by:** structural-analyst S-7; behavioral-analyst B-7
- **Confidence:** Verified
- **Bears on:** D-5, S-2, S-5

### C-11: The server's post routes are a thin pass-through

- **Claim:** Each post route checks its body with zod and calls one store method. `PUT /title` and `PUT /body` do not
  know about each other. Both answer `{ ok: true }`. A `PostError` maps to a 400 or 404 with `{ error, subject }`; any
  other error is a 500.
- **Location:** `src/server/posts/posts.routes.ts` lines 32-39, 44-59
- **Evidence:**
  ```ts
  app.put('/api/posts/:id/title', async (c) => {
    await posts.setTitle(c.req.param('id'), (await body(c, TitleBody)).title);
    return c.json({ ok: true });
  });
  ```
- **Raised by:** structural-analyst S-10; behavioral-analyst B-2, B-13
- **Confidence:** Verified
- **Bears on:** D-2, S-3, S-4

### C-12: Save writes only the body, and the title reaches the screen only through a list refresh

- **Claim:** `save` captures `markdownOf(entry.doc)`, sends `PUT .../body`, then records `saved`, `saves`, and `dirty`.
  It does not refresh the list. Every title on screen (post table, post panel header, notices, `docs.label`) comes from
  the last applied `GET /api/posts`. The server's own write still reaches the tab as a `posts-changed` signal, whose
  sync refreshes the list. A clean post never saves.
- **Location:** `src/ui/documents/documents/documents.tsx` lines 208-234, 740-749, 836-842
- **Evidence:**
  ```ts
  const content = markdownOf(entry.doc);
  await saveDocument(name, content);
  entry.saved = content;
  entry.saves++;
  entry.dirty = markdownOf(entry.doc) !== content;
  ```
- **Raised by:** behavioral-analyst B-6, B-11
- **Confidence:** Verified
- **Bears on:** D-3, S-4, S-6

### C-13: Claude's edits to a post stay unsaved until the writer's Save

- **Claim:** The engine's `Write` and `Edit` change the turn's copy only. The UI merges each edit into the editor as an
  unsaved change. Nothing saves it, renames the post, or calls a title route. The `Posts` tool lists titles from the
  store, so it sees the stored title even while a pending `#` edit differs.
- **Location:** `src/engine/chat/tools/tools.ts` lines 100-195; `src/ui/documents/documents/documents.tsx` lines 410-500
- **Evidence:** `applyEditedNow` runs `mergeMarkdown(entry.doc, turnBase ?? entry.loadBase, edited[name])` and sets
  `entry.dirty = true`.
- **Raised by:** behavioral-analyst B-8; structural-analyst S-7
- **Confidence:** Verified
- **Bears on:** D-3, D-5

### C-14: Undo all resets a post Claude made to what the store holds

- **Claim:** A post Claude made in the last turn has no start text, so Undo all reads the store and follows it. Today
  that is `''`, which is why the README says such a post is left "empty".
- **Location:** `src/ui/documents/documents/documents.tsx` lines 644-703
- **Evidence:**
  ```ts
  const { text } = await readDocument(name);
  ...
  else if (now) followDisk(now, text ?? '');
  ```
- **Raised by:** behavioral-analyst B-9
- **Confidence:** Verified
- **Bears on:** S-2, S-5

### C-15: Rename is blocked while Claude works, but only in the menus

- **Claim:** The post table's and post panel's menus are disabled while the chat is busy, so Claude's edits come back
  under stable keys. A Rename dialog already open when a turn starts can still be submitted, and the server has no such
  check. Ids never change on rename, because the folder name is fixed at create.
- **Location:** `src/ui/documents/post-panel/post-panel.tsx` lines 43-48; `src/ui/documents/documents/post-table.tsx`
  lines 97-102; `src/ui/app.tsx` lines 148-159
- **Evidence:** "Renaming and deleting wait while the AI works, so the keys its edits come back under stay current."
- **Raised by:** behavioral-analyst B-10
- **Confidence:** Verified
- **Bears on:** Risks

### C-16: A rename and a save of the same post are not coordinated in the browser

- **Claim:** The store runs calls on one post in the order they arrive. In the browser, `rename` does not wait for a
  save already running (`entry.saving`). A save that captured the old `#` line, then landed after a rename, would write
  the old line back.
- **Location:** `src/posts/file/file-post-store.ts` lines 52-64; `src/ui/documents/documents/documents.tsx` lines
  208-234, 247-254
- **Evidence:** `if (entry?.saving) return entry.saving;` is checked only by `save`.
- **Raised by:** behavioral-analyst B-12
- **Confidence:** Verified
- **Bears on:** D-6, S-6

### C-17: Research documents share the save and sync code with posts

- **Claim:** `save`, `saveDocument`, `readDocument`, and `syncFile` handle posts, outlines, and research documents,
  told apart by `parseDocumentKey(name).kind`. Research documents keep their own title in `.research.json`.
- **Location:** `src/ui/documents/documents/documents.tsx` (`saveDocument`, `syncFile`);
  `src/posts/file/file-post-store.ts` line 189
- **Evidence:** `saveDocument` branches on `ref.kind` and sends `PUT .../body` only for `'post'`.
- **Raised by:** behavioral-analyst B-15; structural-analyst S-5
- **Confidence:** Verified
- **Bears on:** S-6, Cut for Scope

### C-18: The store's contract tests treat title and body as separate fields

- **Claim:** The shared contract suite checks that `setBody` leaves the title alone and `setTitle` leaves the body
  alone, and stores a body whose `#` line differs from its padded title.
- **Location:** `src/posts/components/describe-post-store.ts` lines 148-156, 186-205
- **Evidence:**
  ```ts
  const id = await store.create({ title: '  The Sun  ', body: '# The Sun\n\nIt rises.' });
  expect(await store.get(id)).toEqual({ id, title: '  The Sun  ', body: '# The Sun\n\nIt rises.' });
  ```
- **Raised by:** structural-analyst S-9
- **Confidence:** Verified
- **Bears on:** D-2

## Findings No Agent Could Audit

- Whether one Save that makes two store writes reaches the browser as one `posts-changed` signal or two. Closing it
  means reading `src/file-system/` watch code or watching the socket in a running app. The browser's sync coalesces
  signals, so either answer converges.
- How `prosemirror-markdown`'s serializer escapes characters inside a heading (for example `_`, `*`, a leading `1.`).
  Closing it means running the serializer on sample titles. D-4 depends on the round trip being stable, and Unit 1's
  tests pin it.

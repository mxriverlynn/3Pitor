# Current State Findings: New Post Instead of New File

## Provenance

Produced by this run's own discovery round on 2026-10-15. `han-core:structural-analyst` and
`han-core:behavioral-analyst` were given the create path: `src/ui/documents/file-tree/`,
`src/ui/documents/documents/documents.tsx`, `src/engine/documents/documents.ts`, `src/engine/engine.ts`,
`src/server/documents/documents.routes.ts`, `src/shared/`, `src/ui/components/fake-documents-api.ts`, and
`src/file-system/`. `han-core:concurrency-analyst` was not dispatched: the area's only shared state is the workspace on
disk, and its one race is covered by C-9. The run's own sweep added C-4's serializer check, which was run against the
real `markdownSerializer`.

## Project Context

- **Stack:** TypeScript on Bun; React 19 UI; Hono server; engine code that must also run on Node
  (`src/engine/bun-free.test.ts`); ProseMirror and prosemirror-markdown for the editor; `bun test` with happy-dom.
- **Conventions source:** none found. No `CLAUDE.md` or `project-discovery.md`. `README.md` documents the layout and the
  endpoints table, and earlier plans live in `docs/changes/`.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** in the last 90 days `file-tree.test.tsx` changed in 19 commits, `file-tree.css` in 17, and
  `file-tree.tsx` in 11. The server and engine documents code changed in 2 to 5 commits each. The most recent precedent
  is `docs/changes/sanitize-new-entry-names/`, which added `newEntryName`.

## Gaps

- No ADR, coding standard, or `CLAUDE.md`.
- No shared helper that escapes plain text for markdown (C-4).
- No create operation that makes more than one thing (C-1).

## Findings

### C-1: One create request makes one folder or one file, and never sees a title

- **Claim:** The tree's New file and New folder both send `POST /api/documents/create` with `{ path, kind }`. The engine
  makes exactly one item, and nothing on the wire carries the text the writer typed.
- **Location:** `src/ui/documents/documents/documents.tsx` `createEntry`; `src/server/documents/documents.routes.ts`
  `CreateBody`; `src/engine/documents/documents.ts` `createEntry`; `src/engine/engine.ts` `documents.create`
- **Evidence:**
  ```ts
  const CreateBody = z.object({ path: z.string(), kind: z.enum(['file', 'folder']) });
  ```
  ```ts
  await api('POST', '/api/documents/create', { path, kind });
  await refreshList();
  if (kind === 'file') await open(path);
  ```
- **Raised by:** structural-analyst S-4, S-5; behavioral-analyst B-1
- **Confidence:** Verified
- **Bears on:** S-1, S-3, S-5, D-1, D-3

### C-2: A new file's heading is its sanitized file name

- **Claim:** `createEntry` writes `# {file name without .md}`, so the heading comes from the cleaned name. The fake
  repeats the same rule.
- **Location:** `src/engine/documents/documents.ts` `createEntry`; `src/ui/components/fake-documents-api.ts`
- **Evidence:**
  ```ts
  else await asDocument(fileSystem.write(path, `# ${basename(path, '.md')}\n`));
  ```
  ```ts
  else api.files.set(path, `# ${path.slice(path.lastIndexOf('/') + 1, -'.md'.length)}\n`);
  ```
- **Raised by:** structural-analyst S-2
- **Confidence:** Verified
- **Bears on:** S-1, S-7, D-4

### C-3: The naming rule lives in the UI only

- **Claim:** `newEntryName` is the only code that turns typed text into a safe name, and it lives under `src/ui/`. The
  engine's `checkPath` refuses bad paths but never rewrites one, and it allows characters `newEntryName` strips, such
  as `:` and `*`. Engine code cannot import from `src/ui/`.
- **Location:** `src/ui/documents/file-tree/entry-name.ts`; `src/engine/documents/documents.ts` `checkPath`
- **Evidence:**
  ```ts
  const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
  export function newEntryName(typed: string, kind: 'file' | 'folder'): string {
  ```
  ```ts
  const valid = segments.every((s) => s !== '' && !isHiddenName(s) && !/[\\\0]/.test(s));
  ```
- **Raised by:** structural-analyst S-1
- **Confidence:** Verified
- **Bears on:** S-2, D-2

### C-4: The editor's serializer already escapes plain text for a heading

- **Claim:** There is no standalone escape helper, but `markdownSerializer` from `src/shared/markdown.ts` escapes a text
  node when it writes a heading, and the engine already imports `src/shared/markdown` (`engine/chat/tools/tools.ts`).
  When run on a set of titles, every one read back through `parseMarkdown` as the same text, except a title with
  spaces at either end, which the heading loses.
- **Location:** `src/shared/markdown.ts` `markdownSerializer`, `parseMarkdown`
- **Evidence:** run in this session via `markdownSerializer.serialize(doc(heading{level:1}(text(t))))`:
  ```text
  "Why I Love: Rust?"        => "# Why I Love: Rust?"                    round-trips
  "*bold* _x_ [link](u) <b>" => "# \*bold\* \_x\_ \[link\](u) <b>"      round-trips
  "# Not a sub"              => "# # Not a sub"                          round-trips
  "`code`"                   => "# \`code\`"                             round-trips
  "back\slash"               => "# back\\slash"                          round-trips
  "  spaced  "               => "#   spaced  "                           does not round-trip
  ```
- **Raised by:** structural-analyst S-3 (no helper; serializer unconfirmed); confirmed by this run's own check
- **Confidence:** Verified
- **Bears on:** S-1, D-4

### C-5: `fileSystem.write` creates missing parent folders; `createEntry` refuses them on purpose

- **Claim:** The file system's `write` makes any missing parent folders. `createEntry` checks for a missing parent first,
  so nothing in the tree's create path makes folders along the way.
- **Location:** `src/file-system/file-system.ts`; `src/file-system/local/local-file-system/local-file-system.ts`;
  `src/engine/documents/documents.ts` `createEntry`
- **Evidence:**
  ```ts
  if (parent === 'missing') await mkdir(dirname(path), { recursive: true });
  ```
  ```ts
  if ((await asDocument(fileSystem.stat(parentKey(path)))) !== 'folder') {
    throw new DocumentError('not-found', `${dirname(path)} was not found`);
  }
  ```
- **Raised by:** behavioral-analyst B-4; structural-analyst (negative results)
- **Confidence:** Verified
- **Bears on:** S-1, D-5

### C-6: A failed second step would leave an empty folder that blocks a retry

- **Claim:** Nothing in the engine undoes a step. If a post's folder were made and its `draft.md` write then failed, the
  folder would stay, show in the tree as an ordinary empty folder, and make the retry fail with "already exists".
- **Location:** `src/engine/documents/documents.ts`; `listEntries`
- **Evidence:**
  ```ts
  if (kind === 'folder') await asDocument(fileSystem.createFolder(path));
  else await asDocument(fileSystem.write(path, `# ${basename(path, '.md')}\n`));
  ```
- **Raised by:** behavioral-analyst B-3
- **Confidence:** Verified (by reading; the failure was not reproduced)
- **Bears on:** S-1, D-5

### C-7: Error sentences reach the dialog unchanged

- **Claim:** A `DocumentError` becomes `{ error }` with 400 (`invalid`) or 404 (`not-found`), and the name dialog shows
  `error.message` in its alert. A taken name reads `{path} already exists`. A missing parent reads
  `{folder} was not found`.
- **Location:** `src/server/documents/documents.routes.ts` `onError`; `src/ui/documents/file-tree/file-tree.tsx` name
  dialog `onSubmit`; `src/ui/components/api.ts`
- **Evidence:**
  ```ts
  if (error instanceof DocumentError) return c.json<ApiError>({ error: error.message }, error.reason === 'not-found' ? 404 : 400);
  ```
  ```ts
  pending.submit(pending.clean(draft)).then(() => setPending(undefined), (error: Error) => setDialogError(error.message));
  ```
- **Raised by:** behavioral-analyst B-2
- **Confidence:** Verified
- **Bears on:** S-1, S-3, D-6

### C-8: The empty editor's New post button runs whatever is first in the + menu

- **Claim:** The empty editor's **New post** button bumps a counter, and the tree answers it by running
  `createItems('')[0]`, the first item by position. Today that item is New file.
- **Location:** `src/ui/documents/file-tree/file-tree.tsx`; `src/ui/documents/documents/documents.tsx` `requestNewPost`
- **Evidence:**
  ```ts
  // New post in the empty editor asks for a new post's name, as the + menu's New file does, unless Claude is working.
  useEffect(() => {
    if (docs.newPosts && !busy) createItems('')[0].run();
  }, [docs.newPosts]);
  ```
- **Raised by:** structural-analyst S-6; behavioral-analyst B-1
- **Confidence:** Verified
- **Bears on:** S-4, D-7

### C-9: After create, only the parent folder expands, and a file opens by its own path

- **Claim:** The tree expands the folder the item was made in, not the new item. `createEntry` opens the path it made
  only when that path is a file.
- **Location:** `src/ui/documents/file-tree/file-tree.tsx` `createItems`; `src/ui/documents/documents/documents.tsx`
  `createEntry`
- **Evidence:**
  ```ts
  const create = async (path: string, kind: 'file' | 'folder') => {
    await docs.createEntry(path, kind);
    if (folder) expand(folder);
  };
  ```
- **Raised by:** structural-analyst S-5; behavioral-analyst B-6
- **Confidence:** Verified
- **Bears on:** S-4, S-5, D-8

### C-10: The test fake routes by URL, with a catch-all for document names

- **Claim:** `fakeDocumentsApi` answers `/api/documents/create` explicitly and treats any other `/api/documents/...`
  path as a document name. A new endpoint needs its own branch ahead of that catch-all. The fake leaves the path
  grammar and other refusals to the server's own tests.
- **Location:** `src/ui/components/fake-documents-api.ts`
- **Evidence:**
  ```ts
  if (url === '/api/documents/create') {
    ...
    if (kind === 'folder') api.folders.add(path);
    else api.files.set(path, `# ${path.slice(path.lastIndexOf('/') + 1, -'.md'.length)}\n`);
  ```
- **Raised by:** structural-analyst S-7
- **Confidence:** Verified
- **Bears on:** S-7

### C-11: The chat tools accept a post inside a folder, and already use "post" to mean a markdown file

- **Claim:** The chat tools accept any `.md` key without a hidden segment, so `My Post/draft.md` works for the AI as is.
  In those tools, "post" already means one markdown file by path (`postName`).
- **Location:** `src/engine/chat/tools/tools.ts`
- **Evidence:**
  ```ts
  if (!key.endsWith('.md') || key.split('/').some((s) => s.startsWith('.')))
  ```
- **Raised by:** behavioral-analyst B-7; structural-analyst (negative results)
- **Confidence:** Verified
- **Bears on:** Cut for Scope

### C-12: The watcher reports a new folder and its file as separate events

- **Claim:** The watcher batches changes after 100 ms of quiet. A new folder with a file inside can arrive in two
  batches, so another open window may briefly show the empty folder. The window that made the post refreshes its own
  list after the request, and only the latest list request is applied.
- **Location:** `src/file-system/local/local-file-system/watch.ts`; `src/ui/documents/documents/documents.tsx`
  `refreshList`
- **Evidence:** the contract line "A created folder is followed by one created event for each key under it".
- **Raised by:** behavioral-analyst B-5
- **Confidence:** Unverified. The UI's handling of watcher events was inferred from `syncWithDisk` call sites, not
  traced.
- **Bears on:** —

## Findings No Agent Could Audit

- How the browser shows a plain-text 500, such as one from a file-system error the engine does not map. `api()` falls
  back to the body text, so the dialog would show `Internal Server Error`. Closing this needs an end-to-end run against
  a failing disk, which nobody did.

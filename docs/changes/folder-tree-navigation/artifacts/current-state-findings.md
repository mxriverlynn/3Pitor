# Current State Findings: Folder Tree Navigation

## Provenance

Produced by this run's own discovery round on 2026-09-29. No prior findings report exists for this area.

- `han-core:structural-analyst` — findings S-1 to S-9, over `src/server/documents/`, `src/server/workspace/`,
  `src/server/server.ts`, `src/ui/documents/documents/`, `src/ui/app.tsx`, `src/ui/components/api.ts`,
  `src/shared/wire.ts`, and the naming helpers in `src/server/chat/tools/tools.ts`.
- `han-core:behavioral-analyst` — findings B-1 to B-10, over the same area plus `src/ui/chat/chat/chat.tsx` and
  `src/server/chat/sessions/sessions.ts`. It ran a small Hono 4.13.9 script to check how route parameters decode.
- `han-core:concurrency-analyst` was not dispatched. The area has no threads or locks. Its one async hazard, a chat turn
  finishing after a rename, was traced by the behavioral analyst (C-8).
- The orchestrator re-read `tools.ts` (`postName`, `resolveInWorkspace`, `resolvePost`), `documents.routes.ts`,
  `documents.tsx`, and `documents.test.tsx` to confirm the merged findings below.

## Project Context

- **Stack:** Bun + TypeScript, Hono on the server, React 19 in the browser, ProseMirror with Yjs for the editor, and
  `bun:test` with happy-dom and Testing Library for UI tests. `package.json` has no drag-and-drop or menu library.
- **Conventions source:** `README.md`, section "How `src/` is laid out". The layout is package, then feature, then
  component. Code shared by siblings goes in a `components/` folder at the lowest level covering its users. Server
  features have a domain file that knows nothing about HTTP, plus a `*.routes.ts`. `app.tsx` is the only UI file that
  wires features together. There is no CLAUDE.md and no `project-discovery.md`.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** these paths changed in the last 90 days: `src/ui/app.tsx` 16 times,
  `src/ui/documents/documents/documents.tsx` 3 times, and `src/server/documents/documents.routes.ts` once. The
  documents files moved into their feature folders in the `restructure-by-feature` change (see
  `docs/changes/restructure-by-feature/`). Before that move, `src/ui/documents.tsx` changed about 10 times.

## Gaps

- No ADR or coding standard covers file naming, path confinement, or error responses.
- The documents routes have no server tests. `src/server/documents/` holds only `documents.routes.ts`. The only
  end-to-end check of them is the `check.ts` scenario "documents: save and load over REST".
- There is no shared menu, pop-up, or confirmation component in `src/ui/components/`. It holds only `api.ts`.
- `src/shared/wire.ts` has no types for the documents API.
- Nothing in the codebase lists directories, counts a folder's contents, renames, or deletes.

## Findings

### C-1: The list endpoint returns top-level `.md` files only, with no folders

- **Claim:** `GET /api/documents` lists only `.md` files directly in the workspace root, as a bare sorted `string[]`.
  It never descends into a folder and never reports a folder, empty or not.
- **Location:** `src/server/documents/documents.routes.ts:14-17`
- **Evidence:**
  ```ts
  app.get('/api/documents', async (c) => {
    const names = await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: workspace }));
    return c.json({ documents: names.sort() });
  });
  ```
- **Raised by:** structural-analyst S-3, behavioral-analyst B-3
- **Confidence:** Verified
- **Bears on:** S-5, D-2

### C-2: A name containing "/" already works through the single-segment route, but only when encoded

- **Claim:** The UI builds every document URL with `encodeURIComponent(name)`. Hono's `:name` matches one segment and
  decodes `%2F` to `/`, so `drafts/a.md` reaches the handler intact. An unencoded slash returns Hono's plain-text 404.
- **Location:** `src/ui/documents/documents/documents.tsx:59,77,92`; `src/server/documents/documents.routes.ts:19-27`
- **Evidence:** the behavioral analyst's run against Hono 4.13.9:
  ```
  /api/documents/drafts%2Fa.md  200 {"n":"drafts/a.md"}
  /api/documents/drafts/a.md    404 404 Not Found
  /api/documents/..%2Fx.md      200 {"n":"../x.md"}
  ```
- **Raised by:** behavioral-analyst B-2, structural-analyst S-1
- **Confidence:** Verified (a script ran against the installed Hono. The app itself was not run.)
- **Bears on:** S-4, D-3

### C-3: A document's name is a workspace-relative path string, and browser and server match it by string equality

- **Claim:** Every hop from the list to `entries` to Save to the chat request and back uses the same workspace-relative
  string. The server's `postName` is the only place a name is normalised, and it runs one way. The browser matches
  `edited` and `highlights.file` back to its `entries` keys by exact string. Nested names already flow this way, because
  the chat tools accept `drafts/a.md`.
- **Location:** `src/server/chat/tools/tools.ts:26-30,53-56`; `src/ui/documents/documents/documents.tsx:128`;
  `src/shared/wire.ts`
- **Evidence:**
  ```ts
  export function postName(workspace: string, filePath: string): string {
    return relative(realpathSync(workspace), resolvePost(workspace, filePath));
  }
  ```
  ```ts
  const entry = entries.current.get(name);
  ```
- **Raised by:** structural-analyst S-1, S-9; behavioral-analyst B-1
- **Confidence:** Verified. On Windows, `relative` would return `\` separators. That was read from the code, not run.
- **Bears on:** D-3, D-8

### C-4: The documents routes' path check is weaker than the chat tools' check and applies no post rule

- **Claim:** `docPath` checks the path by its text alone. It does not resolve symlinks, and it does not limit writes to
  `.md` files outside dot-folders. The chat tools' `resolveInWorkspace` resolves symlinks, including for paths that do
  not exist yet. Their `resolvePost` refuses anything but a `.md` outside dot-folders. When `docPath` throws, the result
  is an unhandled 500.
- **Location:** `src/server/documents/documents.routes.ts:8-12`; `src/server/chat/tools/tools.ts:151-170`
- **Evidence:**
  ```ts
  function docPath(name: string): string {
    const path = resolve(workspace, name);
    if (relative(workspace, path).startsWith('..')) throw new Error('path escapes workspace');
    return path;
  }
  ```
  ```ts
  export function resolveInWorkspace(workspace: string, filePath: string): string {
    const realWorkspace = realpathSync(workspace);
    const target = realTarget(resolve(realWorkspace, filePath));
    if (relative(realWorkspace, target).startsWith('..')) throw new Error(`${filePath} is outside the workspace`);
    return target;
  }
  ```
- **Raised by:** structural-analyst S-2, behavioral-analyst B-8
- **Confidence:** Verified
- **Bears on:** S-1, S-4, D-4, D-17, D-26

### C-5: The workspace-confinement check lives in the chat feature

- **Claim:** `resolveInWorkspace` is exported from `src/server/chat/tools/tools.ts`. If the documents routes imported
  it, the `documents` feature would depend on the `chat` feature. The README's rule for code shared by features of one
  package is `<package>/components/`.
- **Location:** `src/server/chat/tools/tools.ts:151-157`; `README.md` "`components/` folders"
- **Evidence:** as in C-4.
- **Raised by:** structural-analyst S-2
- **Confidence:** Verified
- **Bears on:** S-1, D-4

### C-6: The routes can only read and write a file; a folder appears only as a side effect of a write

- **Claim:** The routes offer list, GET, and PUT, nothing else. PUT overwrites without checking whether the file
  exists. `Bun.write` creates missing parent folders, so a folder can only come into being when a file is written inside
  it.
- **Location:** `src/server/documents/documents.routes.ts:19-29`; `src/ui/documents/documents/documents.tsx:89-97`
- **Evidence:**
  ```ts
  app.put('/api/documents/:name', async (c) => {
    const { content } = await c.req.json<{ content: string }>();
    await Bun.write(docPath(c.req.param('name')), content);
    return c.json({ ok: true });
  });
  ```
  ```ts
  const file = name.endsWith('.md') ? name : `${name}.md`;
  await api('PUT', `/api/documents/${encodeURIComponent(file)}`, { content: `# ${file.replace(/\.md$/, '')}\n` });
  ```
- **Raised by:** structural-analyst S-4, behavioral-analyst B-8
- **Confidence:** Verified. The folder creation is Bun's documented behavior and was not run here.
- **Bears on:** S-4, S-6, S-9, D-6, D-17

### C-7: `api()` ignores the response status, so a missing file opens as an empty document

- **Claim:** `api()` returns `res.json()` without checking `res.ok`. A 404 from GET opens as an empty, clean document
  under that name, and it stays in the list until the page reloads. A 500 comes back as plain text, so `res.json()`
  rejects and no caller catches the error. When a create fails, the dialog stays open and shows no message.
- **Location:** `src/ui/components/api.ts:1-8`; `src/ui/documents/documents/documents.tsx:57-61,228`
- **Evidence:**
  ```ts
  export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, { ... });
    return res.json();
  }
  ```
  ```ts
  const doc = await api('GET', `/api/documents/${encodeURIComponent(name)}`);
  load(name, doc.content ?? '');
  ```
- **Raised by:** behavioral-analyst B-7, B-8; structural-analyst S-3
- **Confidence:** Verified. Hono's default 500 body was read from its source and not run.
- **Bears on:** S-7, S-14, D-7, D-24

### C-8: The browser keeps per-file state under the name in many places and has no way to re-key or drop it

- **Claim:** `useDocuments` keys state by name in `entries`, `current`/`currentRef`, `turnBases`, `turnSaves`,
  `turnFile`, `highlights.file`, and `notApplied`. It also keeps the disk list in `names`. It has no function that
  renames or removes a key. The list shown is the disk list plus every opened entry, so an opened name stays listed
  whether or not it still exists on disk.
- **Location:** `src/ui/documents/documents/documents.tsx:16-52,176-195`
- **Evidence:**
  ```ts
  listed: [...new Set([...names, ...entries.current.keys()])].sort(),
  ```
- **Raised by:** structural-analyst S-5, behavioral-analyst B-5
- **Confidence:** Verified
- **Bears on:** S-10, D-8, D-14, D-23

### C-9: A chat turn that finishes after a rename, move, or delete brings the old name back

- **Claim:** `beginTurn` sends names as they are at send time, and the server returns `edited` keyed by those names. If
  the old key is gone from `entries`, `applyEdited` loads a new entry under the old name, marks it unsaved, and switches
  the editor to it. Saving it recreates the old path, and its parent folders, on disk. `showHighlights` has the same
  shape through `ensureLoaded`, which then opens an empty document as in C-7. The file list cannot see whether a turn is
  running: `busy` belongs to the chat only.
- **Location:** `src/ui/documents/documents/documents.tsx:101-161`; `src/server/chat/sessions/sessions.ts:93`
- **Evidence:**
  ```ts
  if (entry) mergeMarkdown(entry.doc, turnBase ?? entry.loadBase, edited[name]);
  else load(name, edited[name]);
  entries.current.get(name)!.dirty = true;
  ```
- **Raised by:** behavioral-analyst B-6
- **Confidence:** Verified by tracing the code; not run.
- **Bears on:** S-13, S-15, D-9

### C-10: The chat tools reject any open document that is not a `.md` post outside dot-folders

- **Claim:** `turnTexts` runs every key of `documents` through `postName`, which throws for a non-`.md` name or one
  with a dot-segment. It does not catch the error, so one such key fails the whole chat send. When a name is not in the
  turn's copy, the tools read the file from disk. The session's message history keeps old names after a rename.
- **Location:** `src/server/chat/tools/tools.ts:26-30,160-170`; `src/server/chat/sessions/sessions.ts:84`
- **Evidence:**
  ```ts
  if (!target.endsWith('.md') || segments.some((s) => s.startsWith('.'))) {
    throw new Error(`${filePath} is not a markdown post`);
  }
  ```
- **Raised by:** behavioral-analyst B-4, structural-analyst S-9
- **Confidence:** Verified
- **Bears on:** D-15, D-16, D-26

### C-11: The page always opens `notes.md` at startup, whether or not it exists

- **Claim:** `current` starts as `'notes.md'`, and the first effect opens `notes.md` after listing. If `notes.md` has
  been renamed, moved, or deleted, it opens as an empty phantom document through C-7.
- **Location:** `src/ui/documents/documents/documents.tsx:18,163-165`
- **Evidence:**
  ```ts
  useEffect(() => {
    refreshList().then(() => open('notes.md'));
  }, []);
  ```
- **Raised by:** behavioral-analyst B-9, structural-analyst S-5
- **Confidence:** Verified. Commit `da3bfaf` ("Show the first file when the page loads") is recent history on this line.
- **Bears on:** S-10, S-14, D-10

### C-12: `Files` is a flat list of buttons with one inline dialog, and its CSS has no hover or nesting

- **Claim:** `Files` renders each name as a `<button className="file">` and opens one `<dialog>` straight from "+". It
  takes the whole `useDocuments` return value as its prop but reads only `listed`, `current`, `isDirty`, `open`, and
  `create`. The stylesheet has no hover rule and no indent. Because each row is a `<button>`, a "..." button inside a
  row would be a button nested in a button, which HTML does not allow.
- **Location:** `src/ui/documents/documents/documents.tsx:200-245`; `src/ui/documents/documents/documents.css:1-4,14-18`
- **Evidence:**
  ```tsx
  {docs.listed.map((name) => (
    <button key={name} className={`file ${name === docs.current ? 'active' : ''}`} onClick={() => docs.open(name)}>
  ```
  ```css
  .files button.file { display: block; width: 100%; text-align: left; border: none; background: none; padding: 5px 8px; }
  .files button.file.active { background: var(--accent-soft); color: var(--accent); }
  ```
- **Raised by:** structural-analyst S-6, S-7
- **Confidence:** Verified
- **Bears on:** S-12, S-13, D-11

### C-13: The UI tests mock the documents API with a flat `Map`, written twice

- **Claim:** `documents.test.tsx` and `app.test.tsx` each hand-roll a fetch mock over `disk: Map<string, string>`. That
  mock cannot hold an empty folder. It knows only list, GET, and PUT. Two tests cover `Files`: the "+" dialog creates a
  file, and Cancel does not.
- **Location:** `src/ui/documents/documents/documents.test.tsx:9-29,247-278`; `src/ui/app.test.tsx:60-61`
- **Evidence:**
  ```ts
  const name = decodeURIComponent(String(url).replace('/api/documents', '').replace(/^\//, ''));
  if (!name) return Response.json({ documents: [...disk.keys()].sort() });
  ```
- **Raised by:** structural-analyst S-8
- **Confidence:** Verified
- **Bears on:** S-16, D-19, Change Units 3-5

### C-14: `wire.ts` has no types for the documents API

- **Claim:** `src/shared/wire.ts` holds the chat and event payload types, but no documents API types. The browser reads
  the list response as `any`. The shape `{ documents: string[] }` exists only in the route and in the two test mocks.
- **Location:** `src/shared/wire.ts`; `src/ui/components/api.ts:1`
- **Evidence:** `api<T = any>`, and the two mock lines quoted in C-13.
- **Raised by:** structural-analyst S-3
- **Confidence:** Verified
- **Bears on:** S-3, D-2

## Findings No Agent Could Audit

- **How `@ai-sdk/react`'s `useChat` captures `onFinish` between renders.** This affects whether `applyEdited` sees the
  latest `current` when a turn finishes. Nobody read the library source. Unverified. Closing it would mean reading
  `node_modules/@ai-sdk/react`, or a test that switches files mid-turn.
- **Windows path separators.** The app has not been run on Windows. C-3's note about `\` comes from reading the code.
- **Real filesystem behavior of `Bun.write` creating parent folders, and of `rename` across folders.** This rests on
  Bun's and Node's documented behavior; no run against a real workspace happened in this round.

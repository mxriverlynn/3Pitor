# Current State Findings: Live workspace file watching

## Provenance

Two paths produced these findings.

1. **Prior research.** `docs/research/live-workspace-file-watching.md` (2026-10-01) supplied the codebase sources A1–A10
   and A44, the local watcher experiment A43, and validation findings V1–V11. They are carried forward where they bear on
   the change, cited by their research ID.
2. **This run's discovery round** (2026-10-01). Three agents were briefed with the research report, the boundary record,
   and the area:
   - `han-core:structural-analyst`, findings S1–S24
   - `han-core:behavioral-analyst`, findings B1–B30
   - `han-core:concurrency-analyst`, findings K1–K17

   Area: `src/server/server.ts`, `agent-host.ts`, `events/`, `documents/`, `components/json-file.ts`,
   `components/workspace-path.ts`, `src/shared/wire.ts`, `src/ui/app.tsx`, `src/ui/events/host-events.ts`,
   `src/ui/documents/documents/`, `markdown-editor/`, and `file-tree/`.

The orchestrator read `documents.ts:20-100`, `workspace-path.ts`, `host-events.ts`, and `app.tsx:60-110` directly to
settle C-27 and C-28.

## Project Context

- **Stack:** TypeScript on Bun 1.4.2. The server uses Hono with Bun's WebSocket. The UI is React 19, with ProseMirror
  bound to Yjs through y-prosemirror 1.3.7. Tests use `bun:test`, with happy-dom and Testing Library for the UI. The app
  ships as one `bun build --compile` executable (`Makefile:11`).
- **Conventions source:** no CLAUDE.md and no `project-discovery.md`. Conventions come from the code. The code is
  organized by feature folder: `<feature>/<feature>.ts`, `<feature>.routes.ts`, and tests beside each module (S1, S22).
  Earlier plans under `docs/changes/` follow the same layout as this one.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn (90 days, file touches):**
  - `markdown-editor.tsx` 40, `markdown-editor.test.tsx` 46
  - `server.ts` 16, `wire.ts` 15, `documents.tsx` 13, `documents.test.tsx` 10, `file-tree.tsx` 5, `host-events.ts` 1
  - The editor module is the hottest file in the area. Recent commits there are AI-edit highlighting and merge work
    (d40fb19, aafc765, 558845a).

## Gaps

- No ADRs, no coding standards, no CLAUDE.md or project-discovery file.
- No test exists for `src/server/events/` (S22).
- No server lifecycle or shutdown hook exists anywhere (S7, K17).
- Nothing in the code watches the filesystem today (A1, research D10).
- No one measured the event shape of the app's own in-place `Bun.write` save under the watcher. A43 measured creates,
  temp-file-and-rename saves, and a folder delete only.

## Findings

### C-1: The tree is a full eager walk with no cache, and one vanished folder fails the whole request

- **Claim:** `listEntries` walks the whole workspace on every `GET /api/documents`. It skips dot-names and symlinks and
  lists only folders and `.md` files. Its `readdir` has no per-folder catch, so a folder deleted mid-walk throws ENOENT.
  The route then answers 500.
- **Location:** `src/server/documents/documents.ts:56-74`; `documents.routes.ts:15-19`
- **Evidence:**
  ```ts
  for (const dirent of await readdir(join(workspace, folder), { withFileTypes: true })) {
    if (dirent.name.startsWith('.')) continue;
  ```
- **Raised by:** research A1; structural-analyst S2; behavioral-analyst B28; concurrency-analyst K7
- **Confidence:** Verified (code read). The mid-walk ENOENT was not run.
- **Bears on:** S-1, D-2

### C-2: The hidden-name rule is written out twice and is not exported

- **Claim:** Skipping names that start with "." appears inline in `checkPath` and in `listEntries`. Neither exports a
  predicate. `.3pitor/` and `.git/` stay out of the tree only because they start with a dot.
- **Location:** `src/server/documents/documents.ts:23-28, 62`; `src/server/components/json-file.ts`
- **Evidence:**
  ```ts
  const valid = segments.every((s) => s !== '' && !s.startsWith('.') && !/[\\\0]/.test(s));
  ```
- **Raised by:** structural-analyst S2, S20
- **Confidence:** Verified
- **Bears on:** S-1, S-2, D-3

### C-3: The event bus and socket are a bare, type-agnostic fan-out with no replay

- **Claim:** `EventBus.emit` calls each listener synchronously with no try/catch. `/ws/events` subscribes each socket on
  open and sends every event as JSON. It keeps no sequence number and no buffer. A new event type needs no change to
  either file.
- **Location:** `src/server/events/events.ts:6-17`; `src/server/events/events.routes.ts:6-23`
- **Evidence:**
  ```ts
  onOpen: (_event, ws) => { unsubscribe = events.subscribe((event) => ws.send(JSON.stringify(event))); },
  onClose: () => unsubscribe?.(),
  ```
- **Raised by:** research A2; structural-analyst S9; behavioral-analyst B23; concurrency-analyst K12
- **Confidence:** Verified. Whether `ws.send` on a closing Bun socket throws is Unverified (Bun source not available).
- **Bears on:** S-3, S-4, D-4, D-6

### C-4: `HostEvent` is a two-member union, and no consumer switches on it exhaustively

- **Claim:** Both members carry `sessionId`. Every consumer narrows with an `if` on `type`, so a third member breaks
  nothing at compile time. The only UI consumer is `App`'s `useHostEvents` handler.
- **Location:** `src/shared/wire.ts:4-6`; `src/ui/app.tsx:96-98`; `src/server/chat/agent/agent.ts:82`
- **Evidence:**
  ```ts
  export type HostEvent =
    | { type: 'task'; sessionId: string; subtype: 'task_started' | 'task_notification'; description: string; subagentType: string }
    | { type: 'turn-finished'; sessionId: string; aborted: boolean };
  ```
- **Raised by:** structural-analyst S3, S4, S5; behavioral-analyst B24
- **Confidence:** Verified
- **Bears on:** S-3, D-6

### C-5: The event bus is built in `createAgentHost` and reaches `server.ts` as `host.events`

- **Claim:** `createAgentHost` creates the only `EventBus`. `server.ts` passes `host.events` to the socket route.
  `server.ts` is the single composition root.
- **Location:** `src/server/agent-host.ts:16-20`; `src/server/server.ts:21, 35`
- **Evidence:**
  ```ts
  const events = new EventBus();
  const sessions = new Sessions(options, events);
  return { events, sessions };
  ```
- **Raised by:** structural-analyst S6; behavioral-analyst B23
- **Confidence:** Verified
- **Bears on:** S-4, D-4

### C-6: The server has no lifecycle hook, and no long-lived resource needs closing today

- **Claim:** `server.ts` runs its top-level awaits and `Bun.serve`. There is no signal handler, no `server.stop()`, and no
  object with `start`/`close`. An `fs.watch` handle would be the first resource that needs releasing. An `FSWatcher`
  `error` event with no listener throws.
- **Location:** `src/server/server.ts:18-50`
- **Evidence:** a search for `SIGINT|SIGTERM|server.stop|process.on|beforeExit` finds only the chat MCP endpoint's own
  `stop`.
- **Raised by:** structural-analyst S7, S8; concurrency-analyst K17
- **Confidence:** Verified for absence. The watcher error behavior on Bun 1.4.2 is Unverified (not run).
- **Bears on:** S-2, S-4, D-4

### C-7: The browser reconnects every second with no replay and no first-versus-reconnect signal

- **Claim:** `useHostEvents` exposes only a `connected` boolean. It retries one second after any close. An event emitted
  while the socket is down is lost. `App` already re-checks chat on `connected`, through an effect that also fires on
  the first connect.
- **Location:** `src/ui/events/host-events.ts:5-29`; `src/ui/app.tsx:96-103`
- **Evidence:**
  ```ts
  ws.onclose = () => { setConnected(false); retry = setTimeout(connect, 1000); };
  ws.onmessage = (msg) => handler.current(JSON.parse(msg.data));
  ```
- **Raised by:** research A44, V3; structural-analyst S5; behavioral-analyst B22; concurrency-analyst K11
- **Confidence:** Verified
- **Bears on:** S-10, D-11

### C-8: `useDocuments` is a 380-line hook with about eight responsibilities, and it alone holds the open files

- **Claim:** `useDocuments` (lines 18-395) holds the open-file registry, the disk operations, AI turn bookkeeping,
  highlights, editor mode, and view-state persistence. It returns about 30 members. `opened` is a ref to a Map that only
  this hook holds, and React learns of changes through a `rerender()` version counter.
- **Location:** `src/ui/documents/documents/documents.tsx:18-395, 32-34`
- **Evidence:**
  ```ts
  const opened = useRef(new Map<string, Entry>());
  const [version, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);
  ```
- **Raised by:** structural-analyst S10, S11; concurrency-analyst K10
- **Confidence:** Verified
- **Bears on:** S-8, D-8

### C-9: Every Yjs update marks an open file unsaved, whatever made it

- **Claim:** `track()` attaches an `update` listener that sets `dirty = true` and re-renders, with no origin filter. Any
  `Y.applyUpdate` into the document, including a merge, marks it unsaved. The AI path sets `dirty = true` again
  explicitly after merging.
- **Location:** `src/ui/documents/documents/documents.tsx:56-62, 202`
- **Evidence:**
  ```ts
  entry.doc.on('update', () => { entry.dirty = true; rerender(); });
  ```
- **Raised by:** research V6 (defect 1); structural-analyst S11; behavioral-analyst B1, B9; concurrency-analyst K3
- **Confidence:** Verified
- **Bears on:** S-8, D-9

### C-10: An entry's `saved` is the raw disk text, and its `loadBase` is never updated after load

- **Claim:** `Entry` is `{ doc, saved, loadBase, saves, dirty }`. `saved` starts as the disk text and becomes the sent
  content on Save. `loadBase` is set only in `load` and `restoredEntry`. Comparing disk text with `saved` is the right
  test for "changed on disk". Comparing with `markdownOf(doc)` would not be, because the editor rewrites some markdown.
- **Location:** `src/ui/documents/documents/documents.tsx:13, 64-67, 96-112, 399-403`
- **Evidence:**
  ```ts
  type Entry = { doc: Y.Doc; saved: string; loadBase: Snapshot; saves: number; dirty: boolean };
  ```
- **Raised by:** research A3, V1, V6 (defect 3); behavioral-analyst B2; structural-analyst S11
- **Confidence:** Verified
- **Bears on:** S-7, S-8, D-9

### C-11: Save records `saved` only after the PUT and an optional list reload

- **Claim:** `save` reads `content` and awaits the PUT. When the file is not in `entries`, it also awaits
  `refreshList()`. Only then does it set `saved`, `saves`, and `dirty`. The disk holds the new text before `saved` does.
  If the list reload rejects, `saved` never updates.
- **Location:** `src/ui/documents/documents/documents.tsx:96-112`
- **Evidence:**
  ```ts
  await api('PUT', `/api/documents/${encodeURIComponent(name)}`, { content });
  if (!entries.some((e) => e.path === name)) await refreshList();
  entry.saved = content;
  ```
- **Raised by:** research V5; structural-analyst S12; behavioral-analyst B3; concurrency-analyst K1
- **Confidence:** Verified. The real ordering of the socket message versus the PUT response was not run.
- **Bears on:** S-7, D-10

### C-12: Two saves of one file can overlap, on both sides

- **Claim:** The `dirty` gate is cleared only after the awaited PUT, so a second Save during the first starts a second
  PUT. The server's `writeDocument` has no per-path queue, unlike `writeText` for `.3pitor` files. `saved` ends as
  whichever response resolved last, which need not match disk.
- **Location:** `src/ui/documents/documents/documents.tsx:96-112`; `src/server/documents/documents.ts:83-86`;
  `src/server/components/json-file.ts:20-41`
- **Evidence:**
  ```ts
  if (!entry?.dirty || unsupportedMarkdown(entry.saved).length) return;
  ```
- **Raised by:** concurrency-analyst K2, K6
- **Confidence:** Verified by reading. Completion order of overlapping `Bun.write` calls is Unverified.
- **Bears on:** S-7, D-10

### C-13: The app's own Save is an in-place overwrite, while its state writes are temp-file-and-rename

- **Claim:** `writeDocument` calls `Bun.write` on the target directly. A reader during the write can see a short file.
  `writeText` for `.3pitor/` writes a temp file and renames it, serialized per path, about every 300 ms while typing.
  `resolveInWorkspace` accepts a missing parent through its nearest existing folder, and `Bun.write` creates it. So
  Save into a deleted folder recreates the folder.
- **Location:** `src/server/documents/documents.ts:82-86`; `src/server/components/json-file.ts:24-40`;
  `src/server/components/workspace-path.ts:7-17`
- **Evidence:**
  ```ts
  // Overwrites the file, creating any missing parent folders; Save writes a post the AI made in a new folder this way.
  export async function writeDocument(workspace: string, path: string, content: string): Promise<void> {
  ```
- **Raised by:** structural-analyst S20; behavioral-analyst B25, B26; concurrency-analyst K5, K6; orchestrator read
- **Confidence:** Verified by reading. The truncate-then-write window and its watcher events are Unverified (not run).
- **Bears on:** S-2, S-8, D-3, D-14

### C-14: Post files reach disk only through Save; the AI writes to disk only under `.3pitor/`

- **Claim:** The chat tools' Write and Edit for posts change the browser's documents, not the disk. Only their note
  writes go to disk, through `writeText`. The only server writers of workspace `.md` files are the document routes.
- **Location:** `src/server/chat/tools/tools.ts:102-132`
- **Evidence:** `writeText` is called only for note paths (`tools.ts:107-108, 132`).
- **Raised by:** behavioral-analyst B27; concurrency-analyst K6
- **Confidence:** Verified for the write calls. Whether the AI reads posts from disk mid-turn is out of scope.
- **Bears on:** D-3

### C-15: `mergeMarkdown` hard-codes the AI origin, which the editor's undo tracks

- **Claim:** `mergeMarkdown(live, base, markdown)` forks `base`, rewrites the fork to match the markdown, and applies the
  diff to `live` with origin `AI_ORIGIN`. The editor installs `yUndoPlugin({ trackedOrigins: [AI_ORIGIN] })`, so a merge
  becomes an undo step. The undo manager is reached through a module-level `WeakMap` that is filled only while that
  document's editor is mounted.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.tsx:44-45, 82-98, 643, 666-678`
- **Evidence:**
  ```ts
  Y.applyUpdate(live, Y.encodeStateAsUpdate(fork, base.vector), AI_ORIGIN);
  ...
  yUndoPlugin({ trackedOrigins: [AI_ORIGIN] }),
  ```
- **Raised by:** research A4, V6 (defect 2); structural-analyst S15; behavioral-analyst B7, B8
- **Confidence:** Verified. How y-undo matches string origins was not run.
- **Bears on:** S-5, D-7

### C-16: The merge's diff removes text and blocks, but only for items the base shares with the live document

- **Claim:** y-prosemirror's `updateYFragment` trims matching blocks, diffs text inside changed blocks, and deletes
  removed text and blocks. Those deletes reach the live document only when the base shares item history with it. A
  snapshot of the live document taken at merge time does.
- **Location:** `node_modules/y-prosemirror/src/plugins/sync-plugin.js:1079-1090, 1145-1290`
- **Evidence:** `yDomFragment.delete(left, yDelLen)` after the trim loop; `ytext.delete(index, remove)` in
  `updateYText`.
- **Raised by:** research A5, V1, V6
- **Confidence:** Verified by reading; not executed
- **Bears on:** S-5, S-8, D-7, D-9

### C-17: Unsupported markdown makes a file read-only and blocks Save, gated on `saved`

- **Claim:** `unsupportedMarkdown(entry.saved)` gates `save` and `beginTurn`, and makes the editor read-only. The merge
  itself has no gate. A file whose disk text gains unsupported markdown therefore shows read-only once `saved` holds
  that text.
- **Location:** `src/ui/documents/documents/documents.tsx:100, 164, 369, 461, 496`
- **Evidence:**
  ```ts
  if (!entry?.dirty || unsupportedMarkdown(entry.saved).length) return;
  ```
- **Raised by:** research V6 (defect 4); structural-analyst S16; behavioral-analyst B4
- **Confidence:** Verified
- **Bears on:** S-13, D-9, D-19

### C-18: The editor view lives as long as its Yjs document object, and the scroller is `.rich-editor`

- **Claim:** `MarkdownEditor` builds its `EditorView` in `useEffect([doc])`, and `Editor` passes `key={docs.current}`. A
  change applied in place to the same `Y.Doc` keeps the view. Replacing the doc rebuilds it at the top. The scrolling
  element is the host `div.rich-editor`, and scroll is not saved anywhere.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.tsx:636-681`; `markdown-editor.css:2`;
  `src/ui/documents/documents/documents.tsx:493-495`
- **Evidence:**
  ```css
  .rich-editor { flex: 1; min-height: 0; overflow: auto; }
  ```
- **Raised by:** research A6; structural-analyst S17; behavioral-analyst B12, B13
- **Confidence:** Verified
- **Bears on:** D-12

### C-19: y-prosemirror rebuilds only changed parts and scrolls only when focused with the cursor on screen

- **Claim:** On a Yjs change, `_typeChanged` rebuilds changed top-level parts, reuses cached nodes for the rest,
  replaces the editor content in one transaction, and restores the selection. It calls `scrollIntoView` only when the
  editor has focus and the cursor is in view.
- **Location:** `node_modules/y-prosemirror/src/plugins/sync-plugin.js:358-368, 592-641`
- **Evidence:**
  ```js
  if (this.beforeTransactionSelection !== null && this._isLocalCursorInView()) { tr.scrollIntoView() }
  ```
- **Raised by:** research A5, V2
- **Confidence:** Verified by reading. Whether unchanged DOM stays mounted and the view holds still is Unverified (not
  run).
- **Bears on:** D-12

### C-20: Raw mode re-renders from regenerated markdown on every document update

- **Claim:** Raw and rendered modes share one `Y.Doc` and one `EditorView`. Raw mode hides ProseMirror and shows a
  controlled textarea fed by `setText(markdownOf(doc))` on each `update`, unless the writer is typing. The textarea does
  not scroll; `.rich-editor` does.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.tsx` (the `[doc, raw]` effect); `raw-view.tsx:218-245`;
  `markdown-editor.css:110-112`
- **Evidence:**
  ```ts
  const changed = () => { if (!typing.current) setText(markdownOf(doc)); };
  doc.on('update', changed);
  ```
- **Raised by:** behavioral-analyst B14, B15, B16
- **Confidence:** Verified by reading. Textarea caret and scroll behavior on a value change is Unverified (no browser).
- **Bears on:** D-12

### C-21: Highlight scrolling is driven by highlight changes, not document changes

- **Claim:** The highlight plugin and the raw view scroll to the current highlight only when the passages or highlight
  quotes change and the editor is not focused. An in-place document change alone does not scroll.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.tsx:248, 683-690, 796-799`
- **Evidence:**
  ```ts
  if (!view.hasFocus()) view.dom.querySelector('mark.current-highlight')?.scrollIntoView({ block: 'nearest' });
  ```
- **Raised by:** behavioral-analyst B11, B17
- **Confidence:** Verified
- **Bears on:** D-12

### C-22: `refreshList` replaces the list wholesale, has no latest-wins guard, and is not exposed

- **Claim:** `refreshList` sets `entries` from whichever GET resolves, so an older response can land last. Its mount call
  has no catch. It is called on mount and after create, move, delete, and a first save. It is not in the hook's
  returned object, so `App` cannot call it.
- **Location:** `src/ui/documents/documents/documents.tsx:69, 346-348`
- **Evidence:**
  ```ts
  const refreshList = useCallback(async () => setEntries((await api<DocumentList>('GET', '/api/documents')).entries), []);
  ```
- **Raised by:** structural-analyst S13; behavioral-analyst B18, B21, B30; concurrency-analyst K8, K15
- **Confidence:** Verified
- **Bears on:** S-6, D-11

### C-23: The tree renders an open file with no disk entry as `onDisk: false`, and keeps its own expanded state

- **Claim:** `listed()` merges `entries` with every open file's path. An open file missing from disk shows with
  `onDisk: false`, which hides its menu and disables dragging. `FileTree` keeps `expanded` in its own state and a list
  reload does not reset it. A per-row "(unsaved)" marker already exists.
- **Location:** `src/ui/documents/documents/documents.tsx:407-418`; `src/ui/documents/file-tree/file-tree.tsx:116-402`
- **Evidence:**
  ```tsx
  {docs.isDirty(node.path) && <span className="unsaved"> (unsaved)</span>}
  ```
- **Raised by:** structural-analyst S18; behavioral-analyst B18
- **Confidence:** Verified
- **Bears on:** S-9, S-11, D-13

### C-24: In-app delete and move are the existing models for closing and re-filing open files

- **Claim:** `remove()` drops every open file `within` the path, clears the current file if inside it, clears matching
  highlights, and reloads the list. `move()` re-keys `opened`, `turnBases`, the current file, and highlights.
  `within(p, root)` is `p === root || p.startsWith(root + '/')`.
- **Location:** `src/ui/documents/documents/documents.tsx:126-151`; `src/ui/documents/components/paths.ts:4`
- **Evidence:**
  ```ts
  for (const name of [...opened.current.keys()]) if (within(name, path)) opened.current.delete(name);
  if (currentRef.current !== undefined && within(currentRef.current, path)) show(undefined);
  ```
- **Raised by:** research A7, A10; structural-analyst S14; behavioral-analyst B19, B20
- **Confidence:** Verified
- **Bears on:** S-8, D-8, D-14

### C-25: An open file is never re-read from disk, and a missing file is never discovered

- **Claim:** `ensureLoaded` returns at once for a name already in `opened`. No code path re-reads an open file, so an
  open file deleted or changed on disk stays as it was, and Save recreates a deleted one. A load that resolves after
  something else filled the entry replaces that entry.
- **Location:** `src/ui/documents/documents/documents.tsx:75-94`
- **Evidence:**
  ```ts
  if (opened.current.has(name)) return Promise.resolve();
  ```
- **Raised by:** behavioral-analyst B29; concurrency-analyst K9
- **Confidence:** Verified
- **Bears on:** S-8, D-9

### C-26: A missing file reads as a 404 with a sentence, but callers see only the message

- **Claim:** `readDocument` throws `DocumentError('not-found')`, which maps to 404. The client's `api()` turns any
  failure into an `Error` carrying only the message. A file deleted between `lstat` and `readFile` becomes a 500.
- **Location:** `src/server/documents/documents.ts:76-80`; `documents.routes.ts:15-19`; `src/ui/components/api.ts`
- **Evidence:**
  ```ts
  if (!stat) throw new DocumentError('not-found', `${path} was not found`);
  ```
- **Raised by:** behavioral-analyst B28
- **Confidence:** Verified
- **Bears on:** S-13, D-9, D-19

### C-27: Restore tracks stored unsaved files before its first await and never checks them against disk

- **Claim:** `restore` tracks each stored unsaved entry with its stored `saved` and `dirty: true`, then awaits loading
  the current file. Nothing compares the stored `saved` with today's disk, so a change made while the page was closed
  goes unnoticed. A watcher event that arrives before restore finds no open files.
- **Location:** `src/ui/documents/documents/documents.tsx:226-258, 399-403`; `src/ui/app.tsx:43-60`
- **Evidence:**
  ```ts
  return { doc, saved: stored.saved, loadBase: snapshotFromUpdate(decodeUpdate(stored.loadBase)), saves: 0, dirty: true };
  ```
- **Raised by:** behavioral-analyst B5; concurrency-analyst K14
- **Confidence:** Verified
- **Bears on:** S-12, D-11

### C-28: Persisted view state stores unsaved files only, with no per-file disk-state field

- **Claim:** `ViewState.unsaved` holds `{ name, saved, doc, loadBase }` for dirty entries only. Clean entries are
  re-read from disk after a reload. Every `rerender()` restarts a 300 ms debounce before the view is written.
- **Location:** `src/ui/documents/documents/documents.tsx:267-283, 285-319`; `src/shared/wire.ts:84-115`
- **Evidence:**
  ```ts
  entry.dirty ? [{ name, saved: entry.saved, doc: encodeUpdate(Y.encodeStateAsUpdate(entry.doc)), loadBase: encodeUpdate(entry.loadBase.update) }] : [],
  ```
- **Raised by:** behavioral-analyst B5, B6; concurrency-analyst K14
- **Confidence:** Verified
- **Bears on:** D-13

### C-29: The AI-edit failure notice is the existing pattern for a per-file message above the editor

- **Claim:** `notApplied` failures render above the editor as "Could not apply the AI's edit to {name}: {message}", and
  save failures as a "Could not save" banner. Both are AI- or save-specific in wording and state.
- **Location:** `src/ui/documents/documents/documents.tsx:197-208, 441, 481-485`
- **Evidence:**
  ```ts
  failed.push({ name, message: error instanceof Error ? error.message : String(error) });
  ```
- **Raised by:** behavioral-analyst B10, B29
- **Confidence:** Verified
- **Bears on:** S-11, D-13

### C-30: The test fixtures needed already exist

- **Claim:**
  - Server disk tests use a `mkdtemp` workspace with `afterEach` cleanup.
  - `app.test.tsx` has a local `FakeSocket` that drives `HostEvent`s.
  - `documents.test.tsx` mocks the editor module but calls the real `mergeMarkdown`.
  - `src/ui/components/fake-documents-api.ts` fakes the documents API.
  - `src/server/scripts/check.ts` drives the real server end to end, with events typed as `any`.
- **Location:** `src/server/documents/documents.test.ts:12-19`; `src/ui/app.test.tsx:40`;
  `src/ui/documents/documents/documents.test.tsx:230-251`; `src/server/scripts/check.ts:18-19`
- **Evidence:**
  ```ts
  mkdtemp(join(tmpdir(), '3pitor-documents-routes-'))
  ```
- **Raised by:** structural-analyst S22, S23
- **Confidence:** Verified
- **Bears on:** Change Units

### C-31: Bun's recursive watcher is fast and complete on a 22,000-entry workspace in this project's runtime

- **Claim:** One `fs.watch(root, { recursive: true })` under Bun 1.4.2 on macOS:
  - started in 3 ms
  - saw 500 of 500 creates, and 20 of 20 writes while a second watcher was opened and closed
  - reported a 551-entry folder delete as 551 events
  - reported every delete and atomic save as `rename`

  The tree walk took about 65 ms and returned about 870 KB.
- **Location:** research A43 (scratchpad experiment)
- **Evidence:** `walk 22040 entries 65ms json 873441 bytes`; `watch start 3ms`; `A burst: 500/500`;
  `B churn: 20/20`; `C rm subtree: 551 events`; `D atomic save: rename:…tmp | rename:…n0.md`
- **Raised by:** research A43
- **Confidence:** Verified, for one run on one Mac with a generated tree. It did not cover git, symlinks, or Linux.
- **Bears on:** S-2, D-1, D-3

## Findings No Agent Could Audit

- **Browser runtime behavior.** Scroll and caret behavior through an in-place merge, in both rendered and raw modes, was
  not run. Neither was the ordering of socket messages against HTTP responses. Closing it needs a UI test, or a manual
  check in the built app.
- **Bun internals.** These were not run: `ServerWebSocket.send` on a closing socket, `fs.watch` `error` events when the
  root is removed, and the event shape of an in-place `Bun.write`. Closing them needs small Bun tests in the build.
- **y-undo string-origin matching.** Not executed. A test that merges with an untracked origin and then presses Undo
  closes it.
- **Real git operations and other editors' save patterns.** Not exercised. A manual check with `git checkout` and one
  external editor closes it.

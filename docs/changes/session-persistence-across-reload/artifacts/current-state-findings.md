# Current State Findings: Session persistence across reload

## Provenance

Produced by this run's own discovery round on 2026-09-29. No prior findings report existed.

- `han-core:structural-analyst` (its findings S-1 to S-14), `han-core:behavioral-analyst` (B-1 to B-6), and
  `han-core:concurrency-analyst` (K-1 to K-10), briefed with the area below, the recorded reason, and
  [scope-boundary.md](scope-boundary.md).
- Area: `src/server/chat/sessions/*`, `src/server/agent-host.ts`, `src/server/server.ts`, `src/server/chat/agent/agent.ts`
  (session identity and events only), `src/server/chat/tools/tools.ts`, `src/server/workspace/workspace.ts`,
  `src/server/events/*`, `src/shared/wire.ts`, `src/ui/app.tsx`, `src/ui/chat/**`,
  `src/ui/documents/documents/documents.tsx`, `src/ui/documents/markdown-editor/markdown-editor.tsx` (snapshot, merge,
  and mode only), `src/ui/components/api.ts`, `src/ui/events/host-events.ts`.
- The orchestrating run then checked by hand three points the agents left unverified: whether `useChat` accepts seeded
  messages (C-4), what `createUIMessageStream` offers for persistence (C-4), and whether the model's tools can reach a
  dot-folder in the workspace (C-13).

The agents' own identifiers (S-, B-, K-) are cited on each finding under **Raised by**. In the plan, `S-N` means a
surface-delta entry, not a structural finding.

## Project Context

- **Stack:** Bun + TypeScript. Hono server with REST, an AI SDK v7 UI message stream (SSE) for chat, and a Bun-native
  WebSocket for events. React 19 UI using `@ai-sdk/react` `useChat`. ProseMirror editor bound to Yjs
  (`y-prosemirror`). Tests: `bun test` (`make test-server`, `make test-ui` with happy-dom). End-to-end:
  `bun run check` (`src/server/scripts/check.ts`). Build: `make build` produces a single executable, `build/3pitor`.
- **Conventions source:** `README.md` ("How `src/` is laid out"). No CLAUDE.md and no `project-discovery.md`.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found. The README's layout rules act as the standard (C-15).
- **Recent churn:** in the last 90 days, the files this change touches are the most-changed in the repo: `README.md`
  (23 commits), `src/ui/app.tsx` (17), `check.ts` (15), `chat.tsx` (12), `documents.tsx` (10), `wire.ts` (10),
  `sessions.ts` (8). Recent precedent in the same area: `ba9858f` (highlights that clear on save, adding
  `SessionHighlights.untilSaved`), `206c16d` (folder tree), `62df707` (rendered/raw switch),
  `da3bfaf` ("Show the first file when the page loads", later replaced by "Nothing opens when the page loads").
  Earlier plans for this code live in `docs/changes/*/`.

## Gaps

- No ADR, and no written decision on where app state may live on disk. The only precedent is the app reading the
  workspace's `.claude/` folder (C-13).
- No test covers a reload or a server restart. No test covers `POST /api/sessions` or `/cancel` at the route level (C-16).
- No UI code uses `localStorage`, `sessionStorage`, or IndexedDB, so there is nothing to build on client-side (C-1).
- Nothing in the AI SDK converts `ModelMessage` back to `UIMessage` (C-4).
- No resumable-stream store exists, so a page cannot re-attach to a running turn's stream (C-9).

## Findings

### C-1: Everything the writer wants restored lives only in page or process memory

- **Claim:** Every piece of state the request names is held in React state, React refs, or the server's in-memory
  `Map`. Nothing is written anywhere except saved markdown.
- **Location:** `src/ui/app.tsx`, `src/ui/chat/chat/chat.tsx`, `src/ui/documents/documents/documents.tsx`,
  `src/server/chat/sessions/sessions.ts`
- **Evidence:**

  | State | Owner today | Lifetime |
  |---|---|---|
  | session id | `useState<string>()` in `App` | page |
  | server conversation (`ModelMessage[]`) | `Sessions.sessions: Map<string, Session>` | process |
  | chat display (`UIMessage[]`) | inside `useChat` in `useChatSession` | page |
  | chat draft | `useState('')` in `useChatSession` | page |
  | open file | `useState<string>()` + `currentRef` in `useDocuments` | page |
  | opened files and their Yjs docs | `opened = useRef(new Map<string, Entry>())` | page |
  | highlights | `useState<SessionHighlights>()` in `useDocuments` | page |
  | "could not apply" notices | `useState<{ name; message }[]>` (`notApplied`) in `useDocuments` | page |
  | turn bookkeeping | `turnBases`, `turnSaves`, `turnFile` refs in `useDocuments` | page |
  | editor mode | `useState<EditorMode>('rendered')` in `Editor` | page |
  | question/selection popups | `asking`, `askingAbout` in `App` | page |

  A search for `localStorage|sessionStorage|indexedDB` across `src/` returns nothing.
- **Raised by:** structural-analyst S-1; behavioral-analyst B-1
- **Confidence:** Verified
- **Bears on:** D-5; S-2, S-10, S-12

### C-2: Every page load creates a new session, and the server has no way to read one back

- **Claim:** `App` POSTs a new session on mount and on Clear Chat through the same function. The server exposes no route
  that returns a session, so a page that remembered an id would have nothing to ask for. Abandoned sessions are never
  removed.
- **Location:** `src/ui/app.tsx` (`newSession`, mount effect); `src/server/chat/sessions/sessions.routes.ts`
- **Evidence:**

  ```ts
  const newSession = useCallback(async () => setSessionId((await api('POST', '/api/sessions')).id), []);
  const newChat = () => {
    docs.showHighlights(undefined);
    newSession();
  };
  useEffect(() => {
    newSession();
  }, []);
  ```

  Routes: `POST /api/sessions`, `POST /api/sessions/:id/chat`, `POST /api/sessions/:id/cancel`. `Sessions.get(id)`
  exists, but only tests call it.
- **Raised by:** S-2, S-5; B-1; K-9
- **Confidence:** Verified
- **Bears on:** D-3, D-6; S-4, S-7, S-17

### C-3: `Sessions` holds durable and transient session data in one record, with one write point for history

- **Claim:** `Session` combines the durable `id` and `messages` with the transient `abort` controller. History is
  written in exactly one place, after the turn's response resolves, and only when the turn was not stopped. Failed turns
  are dropped too, by an early return.
- **Location:** `src/server/chat/sessions/sessions.ts`
- **Evidence:**

  ```ts
  export interface Session {
    id: string;
    messages: ModelMessage[];
    // Set while a turn is running; cleared when it ends.
    abort?: AbortController;
  }
  ```

  ```ts
  try {
    const responseMessages = await result.responseMessages;
    if (!abort.signal.aborted) session.messages = [...messages, ...responseMessages];
  } catch (error) {
    if (streamFailed && !abort.signal.aborted) return;
    if (!abort.signal.aborted) throw error;
  } finally {
    session.abort = undefined;
  }
  ```

- **Raised by:** S-5; B-2; K-4
- **Confidence:** Verified
- **Bears on:** D-4; S-3, S-6

### C-4: The chat display cannot be rebuilt from the server's history. `useChat` can be seeded, and the stream can hand back the finished `UIMessage` list

- **Claim:** The server keeps `ModelMessage[]`. The panel renders `UIMessage[]`, whose `data-task` and `data-session`
  parts, tool-part states, and stopped/failed turns do not exist in the server copy. The server's user turn also carries
  an extra "The file open in my editor is …" text part that the panel never showed. The AI SDK has no
  `ModelMessage`→`UIMessage` converter. It does have both ends a stored `UIMessage` list needs: `useChat` accepts a
  `messages` seed, and `createUIMessageStream` accepts `originalMessages` plus an `onEnd` callback.
- **Location:** `src/server/chat/sessions/sessions.ts`; `src/ui/chat/chat/chat.tsx`; `node_modules/ai/dist/index.d.ts`
- **Evidence:**

  ```ts
  // chat.tsx
  // The server keeps the conversation itself, so it only needs the newest message.
  prepareSendMessagesRequest: ({ messages, body }) => {
  ```

  ```ts
  // sessions.ts
  { type: 'text', text: `The file open in my editor is ${openFile}. When my message does not name a file, it means this file.` },
  ```

  ```ts
  // node_modules/ai/dist/index.d.ts — ChatInit (useChat's options)
  messages?: UI_MESSAGE[];
  // createUIMessageStream options
  * @param options.originalMessages - The original messages. If provided, persistence mode is assumed
  *   and a message ID is provided for the response message.
  * @param options.onEnd - A callback that is called when the stream ends.
  ```

  `Chat` renders the "subagent … started" line from `data-task` parts and the "stopped" line from `data-session` parts.
- **Raised by:** S-3; B-2; the seeding and `originalMessages` API were checked by hand in this run
- **Confidence:** Verified (declarations read). The exact `onEnd` argument shape was not read; see Findings No Agent Could
  Audit.
- **Bears on:** D-4; S-3, S-6, S-16

### C-5: A turn's edits and highlights exist only in the stream's closing `data-session` part

- **Claim:** `TurnTexts` (the turn's working copy, edited texts, and last highlights) lives only in the `chat()`
  closure. It reaches the browser only as the `data-session` part. The browser moves edits and highlights into the
  editor from `useChat`'s `onFinish` alone, so seeded (restored) messages would never be applied again.
- **Location:** `src/server/chat/sessions/sessions.ts`; `src/ui/chat/chat/chat.tsx`; `src/ui/app.tsx`
- **Evidence:**

  ```ts
  const data: SessionData = { aborted, edited: aborted ? {} : editedTexts(turn) };
  if (!aborted && turn.highlights) data.highlights = turn.highlights;
  writer.write({ type: 'data-session', data });
  this.events.emit({ type: 'turn-finished', sessionId, aborted });
  ```

  ```ts
  onFinish: ({ message, isAbort, isError, isDisconnect }) => {
    if (isAbort || isError || isDisconnect) return;
    const session = message.parts.findLast((part) => part.type === 'data-session') as { data: SessionData } | undefined;
    if (session && !session.data.aborted) onTurnFinished(session.data);
  },
  ```

- **Raised by:** S-6, S-7; B-4; K-3
- **Confidence:** Verified
- **Bears on:** D-7, D-16; S-6, S-12

### C-6: Highlights, question labels, and notices are small JSON that can be stored as they are

- **Claim:** `SessionHighlights` (file, passages with `quote`/`label`/`question`, `untilSaved`) is a wire type already.
  The editor places highlights by finding each quote in the text, not by Yjs position, so the stored JSON is enough to
  redraw them. The "could not apply" notices are `{ name, message }[]`, computed only in the browser, with no wire type.
- **Location:** `src/shared/wire.ts`; `src/ui/documents/markdown-editor/markdown-editor.tsx` (`drawHighlights`);
  `src/ui/documents/documents/documents.tsx` (`notApplied`)
- **Evidence:**

  ```ts
  export interface SessionHighlights {
    file: string;
    passages: Passage[];
    // True when the passages mark changes rather than ask about them, so saving the post clears them.
    untilSaved?: true;
  }
  ```

  ```ts
  passages.forEach(({ quote, label }) => {
    const matches = findQuote(texts, quote);
    if (matches.length !== 1) return;
  ```

- **Raised by:** S-6; B-4
- **Confidence:** Verified
- **Bears on:** D-2, D-5; S-12

### C-7: An opened file's unsaved state is Yjs history, not markdown, and markdown cannot stand in for it

- **Claim:** Unsaved typing and unsaved AI edits exist only in each file's `Y.Doc`. AI edits merge against a base
  snapshot (`turnBase`, else `loadBase`) that must be an ancestor of the live doc. `docFromMarkdown` makes fresh Yjs
  client ids each time, so a base rebuilt from markdown is not an ancestor, and a merge from it would duplicate or garble
  text. `dirty` is tracked from edit events rather than by comparing text, because the editor's markdown output can
  differ from the file even when nobody changed anything. `load` is the only constructor of an `Entry`, and it always
  starts clean from markdown.
- **Location:** `src/ui/documents/documents/documents.tsx` (`Entry`, `load`, `applyEdited`);
  `src/ui/documents/markdown-editor/markdown-editor.tsx` (`snapshot`, `mergeMarkdown`)
- **Evidence:**

  ```ts
  type Entry = { doc: Y.Doc; saved: string; loadBase: Snapshot; saves: number; dirty: boolean };
  ```

  ```ts
  export type Snapshot = { update: Uint8Array; vector: Uint8Array };
  export function mergeMarkdown(live: Y.Doc, base: Snapshot, markdown: string): void {
    const fork = new Y.Doc();
    Y.applyUpdate(fork, base.update);
    ...
    Y.applyUpdate(live, Y.encodeStateAsUpdate(fork, base.vector), AI_ORIGIN);
  ```

  ```ts
  // Tracked from edits rather than by comparing text: the editor's markdown output can differ
  // from the file (bullet style, line wrapping) even when nobody changed anything.
  entry.doc.on('update', () => {
    entry.dirty = true;
    rerender();
  });
  ```

  Undo history (`undoManagers`, a `WeakMap<Y.Doc, Y.UndoManager>`) is also in memory only.
- **Raised by:** S-8; B-4; K-8
- **Confidence:** Verified
- **Bears on:** D-2, D-15; S-11, S-12

### C-8: The leave-page warning guards exactly the unsaved-edit flag, and says why

- **Claim:** The browser's "Leave site?" prompt fires when any opened file is `dirty`. The code comment gives the reason
  as those edits existing only in this page. The warning does not cover a running turn, the draft, chat history,
  highlights, notices, or mode.
- **Location:** `src/ui/documents/documents/documents.tsx`
- **Evidence:**

  ```ts
  // The browser asks "Leave site?" while any file has unsaved edits, since they exist only in this page.
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if ([...opened.current.values()].some((entry) => entry.dirty)) event.preventDefault();
    };
  ```

  Pinned by `documents.test.tsx` "leaving the page warns while any file has unsaved changes".
- **Raised by:** B-6; S-8
- **Confidence:** Verified
- **Bears on:** D-2; S-15

### C-9: A reload mid-turn leaves the turn running, and its edits and highlights reach nobody

- **Claim:** Nothing ties a client disconnect to the turn's abort. `createUIMessageStream` swallows enqueue errors, so
  `execute` runs to the end. `session.messages` is updated, but the `data-session` part goes into a dead stream and the
  `turn-finished` event goes to a UI handler that ignores it. A reloaded page cannot reach the old session. If it could,
  it would get a 409 while the old turn ran, with its Send button enabled.
- **Location:** `src/server/chat/sessions/sessions.ts`; `node_modules/ai/dist/index.js` (`createUIMessageStream`);
  `src/ui/app.tsx` (`useHostEvents(() => {})`)
- **Evidence:**

  ```js
  function safeEnqueue(data) {
    try { controller.enqueue(data); } catch (e) { }
  }
  ```

  ```ts
  if (session.abort) throw new Error(`session ${sessionId} already has a turn in progress`);
  ```

- **Raised by:** B-3; K-1; S-11
- **Confidence:** Verified from the code. Whether Bun cancels the response body on close was not run; the turn survives
  either way.
- **Bears on:** D-7; S-6, S-16, S-17

### C-10: Stop is keyed on the session alone, and one turn runs per session

- **Claim:** `/cancel` aborts whatever turn the session is running, whichever page sent it. The one-turn guard is a
  check-then-set within one event-loop tick, so it is safe in-process.
- **Location:** `src/server/chat/sessions/sessions.routes.ts`; `src/ui/chat/chat/chat.tsx`
- **Evidence:**

  ```ts
  app.post('/api/sessions/:id/cancel', (c) => c.json({ cancelled: sessions.cancel(c.req.param('id')) }));
  ```

- **Raised by:** K-2, K-1
- **Confidence:** Verified
- **Bears on:** D-7 (Stop stays keyed on the session while a reloaded page waits)

### C-11: History is replaced wholesale after an await, and any disk write would have no ordering

- **Claim:** `session.messages` is copied at the start of the turn and reassigned after `await result.responseMessages`.
  `data-session` is written after the `finally` clears `abort`. There is no write queue anywhere. Two overlapping
  asynchronous writes of the same file could land out of order.
- **Location:** `src/server/chat/sessions/sessions.ts`
- **Evidence:** see C-3 and C-5.
- **Raised by:** K-3, K-5
- **Confidence:** Verified
- **Bears on:** D-9; S-1

### C-12: The browser's own storage cannot survive a server restart, because the port changes

- **Claim:** The server listens on a random free port unless `PORT` is set. Browser storage is scoped to the origin,
  which includes the port. After a restart, the page is on a new origin and cannot see what the old one stored.
- **Location:** `src/server/server.ts`
- **Evidence:**

  ```ts
  // Port 0 asks the OS for any free port, so several instances can run side by side.
  // Set PORT to pin one.
  const server = Bun.serve({
    port: Number(process.env.PORT ?? 0),
  ```

- **Raised by:** K-10
- **Confidence:** Verified (origin scoping is standard browser behavior)
- **Bears on:** D-1; S-2, S-10

### C-13: The server has no place for app state on disk. The workspace's dot-folders are the nearest precedent

- **Claim:** `dataDir` points under `src/.data/`, which exists only in a source checkout, not beside a built binary's
  workspace. The documents domain refuses any path segment starting with ".", so a dot-folder in the workspace is
  invisible to the file tree and cannot be written through the documents API. The chat tools refuse to write or edit a
  post under a dot-folder. The model's Read tool falls back to `resolveInWorkspace`, so it can read any file inside the
  workspace, dot-folders included, if it knows the path. The app already reads the workspace's `.claude/` folder.
- **Location:** `src/server/workspace/workspace.ts`; `src/server/documents/documents.ts` (`checkPath`);
  `src/server/chat/tools/tools.ts` (`resolvePost`, `Read`, `Glob`)
- **Evidence:**

  ```ts
  // A workspace directory under src/.data/, which is not tracked by git.
  export const dataDir = (name: string) => join(SRC, '.data', name);
  ```

  ```ts
  const valid = segments.every((s) => s !== '' && !s.startsWith('.') && !/[\\\0]/.test(s));
  ```

  ```ts
  // Like resolveInWorkspace, and also refuses anything but a .md file outside dot-folders, which keeps
  // the model out of .git/ and .claude/, and refuses the app's skill files, which are read-only.
  function resolvePost(workspace: string, filePath: string): string {
  ```

  ```ts
  const file = Bun.file(resolveInWorkspace(workspace, file_path));
  ```

- **Raised by:** S-4, S-14; checked by hand in this run
- **Confidence:** Verified. Whether `Bun.Glob` with the model's usual `**/*.md` pattern matches inside dot-folders was
  not run; `**/*.md` would not match a `.json` file in any case.
- **Bears on:** D-1; S-2; Risks

### C-14: The page's three stateful units meet only in `App`, through callbacks and refs

- **Claim:** `useChatSession` and `useDocuments` are joined in `App` by `openFile`, `beginTurn`, and `onTurnFinished`.
  Clear Chat's "clear highlights, then new session" order lives in `App`. Any change to `docs.highlights` closes the
  question popup and moves its typed text into the draft. Editor mode lives in a third place, the `Editor` component,
  out of reach of both hooks. `showHighlights` and `open` both await a load and then change the open file, and
  `ensureLoaded` is check-then-act across that await, so two concurrent loads of one file both load it. The second one
  replaces the first `Entry`.
- **Location:** `src/ui/app.tsx`; `src/ui/documents/documents/documents.tsx` (`ensureLoaded`, `open`,
  `showHighlights`, `Editor`)
- **Evidence:**

  ```ts
  const chat = useChatSession({
    sessionId,
    openFile: docs.current,
    beginTurn: docs.beginTurn,
    onTurnFinished: (data) => {
      docs.applyEdited(data.edited);
      docs.showHighlights(data.highlights);
    },
  });
  ```

  ```ts
  const ensureLoaded = async (name: string) => {
    if (opened.current.has(name)) return;
    const doc = await api('GET', `/api/documents/${encodeURIComponent(name)}`);
    load(name, doc.content ?? '');
  };
  ```

  ```ts
  // Kept here rather than in the editor, which remounts for each file, so switching files keeps the mode.
  const [mode, setMode] = useState<EditorMode>('rendered');
  ```

- **Raised by:** S-7, S-9; K-7, K-8, K-9
- **Confidence:** Verified
- **Bears on:** D-6; S-13, S-14, S-17

### C-15: The README's layout rules place any new module

- **Claim:** Each server feature has a domain file with no HTTP in it, plus a `*.routes.ts`. `agent-host.ts` wires
  features and `server.ts` mounts routes. `app.tsx` is the only UI file that wires features together. `wire.ts` holds
  types only, with no imports. Shared code goes in the lowest `components/` folder that covers every user. A capability
  spanning both packages uses the same feature name in each.
- **Location:** `README.md` ("How `src/` is laid out")
- **Evidence:** "Each feature has a domain file that knows nothing about HTTP, plus a matching `*.routes.ts` file with
  its Hono routes." "`app.tsx` is the entry point. It is the only file that wires features together." "`wire.ts` holds
  the shapes that cross the wire".
- **Raised by:** S-14, S-10
- **Confidence:** Verified
- **Bears on:** D-8; S-9, S-10

### C-16: Tests and the check script pin today's lifetimes

- **Claim:** Several tests assert the behavior this change alters, and the end-to-end script expects a fresh session
  from every `POST /api/sessions`.
- **Location:** test files as named
- **Evidence:**
  - `documents.test.tsx`: "nothing opens when the page loads: the editor asks for a file, and no document is fetched";
    "leaving the page warns while any file has unsaved changes".
  - `chat.test.tsx`: "a new chat starts with an empty chat box"; "a turn still running when a new chat starts hands
    nothing to the editor, even once it finishes"; "hands the edits and highlights of a finished turn to the editor".
  - `agent-panel.test.tsx`: "clears the chat when Clear Chat is clicked".
  - `sessions.test.ts`: constructs `Sessions` directly with `test-model.ts`, and covers a second turn sending the
    conversation so far, stopped turns sending no edits, and highlights.
  - `check.ts` calls `POST /api/sessions` at six points and expects a new session each time.
  - The UI tests answer `fetch` with `fakeDocumentsApi` (`src/ui/components/fake-documents-api.ts`), which answers only
    the documents routes.
- **Raised by:** S-12
- **Confidence:** Verified from test names. Test bodies were not read.
- **Bears on:** Change Units 2, 3, 6, 7

### C-17: Pre-existing defect: a failure before the turn's `try` leaves the session stuck

- **Claim:** `session.abort` is set before `await agentSettings(...)`, but the `try/finally` that clears it starts
  after that await. If `agentSettings` rejects, every later chat on that session answers 409 "already has a turn in
  progress" until the process restarts. Once sessions persist, a restart no longer brings back a fresh session
  automatically, but it does clear `abort`, which is not persisted.
- **Location:** `src/server/chat/sessions/sessions.ts`
- **Evidence:**

  ```ts
  const abort = new AbortController();
  session.abort = abort;
  return createUIMessageStream({
    execute: async ({ writer }) => {
      ...
      ...(await agentSettings(this.options, this.events, sessionId, turn, writer)),
  ```

- **Raised by:** K-4; B-3
- **Confidence:** Verified for the ordering. The paths on which `agentSettings` rejects were not inspected.
- **Bears on:** D-11; S-6

## Findings No Agent Could Audit

- **Runtime behavior.** Nothing was run. Bun's handling of a closed SSE connection, the text `DefaultChatTransport`
  shows for a 409, and the exact argument `createUIMessageStream`'s `onEnd` receives are known only from declarations.
  To close this: a unit test around `Sessions.chat` with `test-model.ts` that asserts what `onEnd` delivers, written as
  the first test of the unit that uses it.
- **`@ai-sdk/react` behavior when `useChat`'s `id` or `messages` seed changes after mount.** The library source was not
  read. To close this: the UI test for restoring a chat.

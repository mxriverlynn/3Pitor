# Current State Findings: Tell the AI Which File Is Open

## Provenance

Produced by this run's own discovery round on 2026-09-28. No prior findings report existed.

- `han-core:structural-analyst` and `han-core:behavioral-analyst` were dispatched in parallel over `src/ui/app.tsx`,
  `chat.tsx`, `documents.tsx`, `api.ts`, `markdown-editor.tsx`, `src/server/sessions.routes.ts`, `sessions.ts`,
  `agent.ts`, `jobs.ts`, `tools.ts`, `documents.routes.ts`, `src/shared/wire.ts`, their tests, and
  `src/server/scripts/check.ts`. The behavioral analyst also read the vendored `ai@7.0.114` and `hono@4.13.9` sources
  and ran a live server to confirm B-5, B-6 and B-7.
- `han-core:concurrency-analyst` was not dispatched. The area has no shared mutable state across threads; the one async
  ordering question (save, then send) is covered by the behavioral findings C-11 and C-12.
- The run's own sweep read the `ai` type declarations to confirm the per-message `body` option (C-6).
- Two behavioral findings were left out as unrelated to this change: the approval buttons ignore network errors, and
  `documents.routes.ts` checks paths less strictly than `tools.ts` (it does not resolve symlinks).

Each finding keeps its originating identifier (`S-N` structural, `B-N` behavioral).

## Project Context

- **Stack:** Bun + TypeScript, Hono server, React UI on the Vercel AI SDK v7 (`useChat`, `DefaultChatTransport`,
  `streamText`) with the Anthropic provider. Tests: `bun test` with happy-dom for the UI; `bun run check` is the
  end-to-end script.
- **Conventions source:** `README.md` only. There is no CLAUDE.md, AGENTS.md or project-discovery.md. The README and
  the header comment in `src/ui/app.tsx` state that each feature has one file and `app.tsx` is the only UI file that
  wires features together.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** in the last 90 days, `app.tsx` changed in 6 commits, `sessions.ts` and `jobs.ts` in 3, `chat.tsx`
  and `agent.ts` in 2, and `documents.tsx` in 1. All of these were the switch to the Anthropic API and the per-feature
  file split. None were bug fixes.

## Gaps

- No ADRs and no coding standards exist. The README is the only written convention source.
- There are no unit tests for `src/ui/chat.tsx` or `src/ui/documents.tsx` (C-14).
- There is no shared type for any REST request body, including the chat body (C-4).

## Findings

### C-1: The chat panel is never given the open document

- **Claim:** `app.tsx` holds `docs` (the open document's name and its `save` function) and passes it to `Files` and
  `Editor`, but `Chat` receives only `sessionId`, `approvals`, and `onTurnFinished`.
- **Location:** `src/ui/app.tsx`, `App` render; `src/ui/chat.tsx`, `Chat` props.
- **Evidence:**
  ```tsx
  <Files docs={docs} />
  <Editor docs={docs} />
  ...
  <Chat key={sessionId} sessionId={sessionId} approvals={approvals} onTurnFinished={docs.syncFromDisk} />
  ```
- **Raised by:** S1, B-1
- **Confidence:** Verified
- **Bears on:** S-3, S-4

### C-2: `app.tsx` is the only UI file that wires features together, and `chat.tsx` does not import `documents.tsx`

- **Claim:** The convention is stated in `app.tsx`'s header comment and followed in the code. `chat.tsx` imports only
  `@ai-sdk/react`, `ai`, `marked`, and `./api`.
- **Location:** `src/ui/app.tsx` lines 1-2; `src/ui/chat.tsx` imports.
- **Evidence:**
  ```tsx
  // Page entry. The only file that knows about more than one feature: it owns the state that crosses
  // features and wires them together, the way src/server/server.ts does for the server.
  ```
- **Raised by:** S1, S2
- **Confidence:** Verified
- **Bears on:** S-3, S-4, D-3

### C-3: Nothing in the code has a notion of a "current file"

- **Claim:** No identifier or prompt text anywhere in `src/` refers to an open, active, or current file. The system
  prompt tells the model only that tool paths are relative to the workspace.
- **Location:** `src/server/agent.ts`, `instructionsFor`.
- **Evidence:**
  ```ts
  const base = `You are the writing assistant inside 3pitor, an editor for blog posts written in markdown. The user's posts are files in the workspace folder. Every file path you give a tool is relative to that folder; paths outside it are refused.
  ```
- **Raised by:** B-2
- **Confidence:** Verified (grep for `currentfile|current_file|openfile|open_file|active.?file` returned no hits)
- **Bears on:** S-1

### C-4: The chat request body is `{ text }`, written separately in three places with no shared type

- **Claim:** The UI transport builds `{ text }`, the route reads `{ text: string }` inline, and the check script posts
  `{ text }` through its own helper. `src/shared/wire.ts` holds only event and job shapes, not REST request bodies.
- **Location:** `src/ui/chat.tsx` `prepareSendMessagesRequest`; `src/server/sessions.routes.ts` chat route;
  `src/server/scripts/check.ts` `chat()`; `src/shared/wire.ts`.
- **Evidence:**
  ```ts
  // chat.tsx
  prepareSendMessagesRequest: ({ messages }) => {
    const last = messages.at(-1)!;
    return { body: { text: last.parts.map((p) => (p.type === 'text' ? p.text : '')).join('') } };
  },
  // sessions.routes.ts
  const { text } = await c.req.json<{ text: string }>();
  // check.ts
  body: JSON.stringify({ text }),
  ```
- **Raised by:** S3, S9, B-16
- **Confidence:** Verified
- **Bears on:** S-2, S-3, D-3

### C-5: `Sessions.chat(sessionId, text)` has two callers, and the model sees each user turn as a bare string

- **Claim:** The route and `sessions.test.ts` call `Sessions.chat`. It appends `{ role: 'user', content: text }` to the
  history, which is kept in memory on the server and replayed whole on every turn.
- **Location:** `src/server/sessions.ts`, `Sessions.chat`; callers in `sessions.routes.ts` and `sessions.test.ts`
  (`turn()`).
- **Evidence:**
  ```ts
  const messages: ModelMessage[] = [...session.messages, { role: 'user', content: text }];
  ...
  if (!abort.signal.aborted) session.messages = [...messages, ...responseMessages];
  ```
- **Raised by:** S4, S6, B-3
- **Confidence:** Verified
- **Bears on:** S-1, D-1, D-2

### C-6: `useChat`'s `sendMessage` can carry extra body fields for one message

- **Claim:** `sendMessage(message, { body })` passes `body` through to `prepareSendMessagesRequest`, which receives it
  as its `body` argument. The transport is memoized per session, so a per-message field has to arrive this way (or
  through a ref) rather than through the transport's constructor.
- **Location:** `node_modules/ai/dist/index.d.ts`, `ChatRequestOptions` and `PrepareSendMessagesRequest`.
- **Evidence:**
  ```ts
  type ChatRequestOptions = {
      headers?: Record<string, string> | Headers;
      /** Additional body JSON properties that should be sent to the API endpoint. */
      body?: object;
      metadata?: unknown;
  };
  type PrepareSendMessagesRequest<UI_MESSAGE extends UIMessage> = (options: {
      id: string;
      messages: UI_MESSAGE[];
      requestMetadata: unknown;
      body: Record<string, any> | undefined;
      ...
  ```
  The vendored runtime confirms the merge: `sendMessage` passes `...options` to `makeRequest`
  (`node_modules/ai/dist/index.js:22356-22359`), and the transport calls `prepareSendMessagesRequest` with
  `body: { ...resolvedBody, ...options.body }` (`node_modules/ai/dist/index.js:22140`).
- **Raised by:** this run's sweep; runtime lines from the junior-developer review (JD-005), re-read by this run
- **Confidence:** Verified from the type declarations and the runtime source. Not run in a browser.
- **Bears on:** S-3, D-3

### C-7: The prompt builder is shared by chat and jobs, and only `Sessions.chat` is chat-only

- **Claim:** `agentSettings` and `instructionsFor` build the model, instructions, and tools for chat and jobs alike,
  and take no per-turn context. The history array built inside `Sessions.chat` is the only place that jobs never reach.
- **Location:** `src/server/agent.ts` `agentSettings`, `instructionsFor`; `src/server/sessions.ts`;
  `src/server/jobs.ts`.
- **Evidence:**
  ```ts
  // sessions.ts
  ...(await agentSettings(this.options, this.events, sessionId, writer)),
  // jobs.ts
  agentSettings(this.options, this.events, job.id).then((settings) => generateText({ ...settings, prompt, ... }))
  ```
- **Raised by:** S5, S6
- **Confidence:** Verified
- **Bears on:** S-1, D-1

### C-8: The UI's document name is a valid tool path as it stands

- **Claim:** `useDocuments().current` holds a bare top-level name such as `notes.md`. The document list is
  non-recursive and `create` always writes at the top level, so `current` never holds a subfolder path. The model's
  file tools resolve that name against the same workspace root.
- **Location:** `src/ui/documents.tsx` `useDocuments`; `src/server/documents.routes.ts` `GET /api/documents`;
  `src/server/tools.ts` `resolveInWorkspace`.
- **Evidence:**
  ```ts
  const [current, setCurrent] = useState<string>('notes.md');
  // documents.routes.ts
  new Bun.Glob('*.md').scan({ cwd: workspace })
  ```
- **Raised by:** S10, B-13
- **Confidence:** Verified
- **Bears on:** S-1, D-2

### C-9: A chat body the server cannot use fails inside the stream, not as an HTTP error

- **Claim:** A `{}` body returns HTTP 200 with an `error` chunk inside the stream. A body that is not JSON returns a
  plain-text 500. Only a turn already in progress, or an unknown session, returns a 409.
- **Location:** `src/server/sessions.routes.ts` chat route; `src/server/sessions.ts`.
- **Evidence:**
  ```
  POST /chat {}  ->  HTTP/1.1 200 OK
  data: {"type":"error","errorText":"Invalid prompt: The messages do not match the ModelMessage[] schema."}
  ```
- **Raised by:** B-4, B-5, B-6
- **Confidence:** Verified (live server)
- **Bears on:** S-2

### C-10: After every send attempt, the chat reloads the open document from disk

- **Claim:** `useChat`'s `onFinish` runs `docs.syncFromDisk` after every send, including one that fails with a 409.
  `syncFromDisk` reloads the file when there are no unsaved edits, and otherwise shows the "The agent changed this
  file" banner. It reads `dirty` when the turn ends, not when the message was sent.
- **Location:** `src/ui/chat.tsx` `useChat({ onFinish })`; `src/ui/documents.tsx` `syncFromDisk`;
  `node_modules/ai/dist/index.js` `AbstractChat`.
- **Evidence:**
  ```ts
  const syncFromDisk = useCallback(async () => {
    await refreshList();
    const doc = await api('GET', `/api/documents/${encodeURIComponent(current)}`);
    if (doc.content === undefined || doc.content === saved) return;
    if (dirty) setChangedOnDisk(true);
    else load(current, doc.content);
  }, [current, saved, dirty, refreshList]);
  ```
- **Raised by:** B-8, B-9
- **Confidence:** Verified
- **Bears on:** S-3, D-5, D-8, D-12

### C-11: `save()` resolves the same way whether or not it saved, and it can reject

- **Claim:** `save` returns early with no signal when the document has no unsaved edits, or when it is read-only
  because of markdown the editor cannot keep. A read-only document can never have unsaved edits, because the editor is
  not editable. `api()` never checks `res.ok`, so a network failure, or a server error with a plain-text body, makes
  `save` reject. Both existing callers (the Save button and Cmd/Ctrl+S) ignore the promise.
- **Location:** `src/ui/documents.tsx` `save`; `src/ui/api.ts`; `src/ui/markdown-editor.tsx` `editable`.
- **Evidence:**
  ```ts
  const save = useCallback(async () => {
    if (!dirty || unsupported.length) return;
    await api('PUT', `/api/documents/${encodeURIComponent(current)}`, { content });
    setSaved(content);
    setDirty(false);
    setChangedOnDisk(false);
  }, [current, content, dirty, unsupported]);
  // api.ts
  const res = await fetch(path, { ... });
  return res.json();
  ```
- **Raised by:** S11, S12, B-10, B-11
- **Confidence:** Verified for the no-op paths and `api()`. The server-side `docPath` throw that leads to a 500 is
  Unverified: the UI cannot produce the name that triggers it, so it was traced from source only. A network failure
  takes the same rejection path and can happen.
- **Bears on:** S-3, S-4, D-5, D-6, D-12

### C-12: Switching files while a save is in flight can mix up two documents' state

- **Claim:** `current`, `content`, `saved`, and `dirty` are single state slots, not kept per document. If the user
  opens another file while a save's PUT is in flight, the save's follow-up updates (`setSaved(content)`,
  `setDirty(false)`) land on the newly opened document. `docs.current` read after `await docs.save()` is not
  guaranteed to be the file that was saved.
- **Location:** `src/ui/documents.tsx` `load`, `open`, `save`.
- **Evidence:** see C-11's `save`, and:
  ```ts
  const load = (name: string, text: string) => {
    setCurrent(name);
    setContent(text);
    setSaved(text);
    setDirty(false);
    ...
  ```
- **Raised by:** B-12
- **Confidence:** Verified from source. Not reproduced in a browser.
- **Bears on:** S-3, D-4

### C-13: Two tests pin exact prompt text

- **Claim:** `agent.test.ts` checks the whole instructions string with `toBe`. `sessions.test.ts` checks each user
  turn's first content part against the exact text the test sent.
- **Location:** `src/server/agent.test.ts` lines 12-21; `src/server/sessions.test.ts` "a second turn sends the
  conversation so far".
- **Evidence:**
  ```ts
  expect(prompt.map((m) => [m.role, (m.content as { text: string }[])[0].text])).toEqual([
    ['user', 'What is the heading?'],
    ['assistant', 'Garden Plan'],
    ['user', 'What did you just tell me?'],
  ]);
  ```
- **Raised by:** S7, S8
- **Confidence:** Verified
- **Bears on:** S-1, D-1

### C-14: No unit tests cover `chat.tsx` or `documents.tsx`

- **Claim:** `src/ui/agent-panel.test.tsx` is the only UI test. The chat panel's request body and the documents
  hook's save behavior are covered only by the end-to-end check, which does not use the UI.
- **Location:** `src/ui/`.
- **Evidence:** `find src/ui -name "*.test.tsx"` returns only `src/ui/agent-panel.test.tsx`.
- **Raised by:** S13
- **Confidence:** Verified for the test-file pattern. Unverified whether any manual QA checklist exists.
- **Bears on:** Change Units

### C-15: The editor can show a document that does not exist on disk

- **Claim:** `useDocuments` always opens `notes.md` at startup. When the workspace has no `notes.md` (for example, a
  server started in a folder without one), the GET returns 404, and the editor shows an empty `notes.md`. Pressing
  Save in that state creates the file.
- **Location:** `src/ui/documents.tsx` `useDocuments` (`open`, the startup effect); `src/server/documents.routes.ts`
  `GET /api/documents/:name`; `src/server/workspace.ts` `chooseWorkspace`.
- **Evidence:**
  ```ts
  // documents.tsx
  const doc = await api('GET', `/api/documents/${encodeURIComponent(name)}`);
  load(name, doc.content ?? '');
  ...
  refreshList().then(() => open('notes.md'));
  // documents.routes.ts
  if (!(await file.exists())) return c.json({ error: 'not found' }, 404);
  // workspace.ts: with no name and no WORKSPACE, the workspace is the launch folder
  return process.cwd();
  ```
- **Raised by:** junior-developer review (JD-002), re-read by this run
- **Confidence:** Verified
- **Bears on:** D-13

## Findings No Agent Could Audit

- How the model behaves when told which file is open: whether it acts on that file when the request names none, and
  whether it still follows a request that names a different file. Only a live model run can show this. The end-to-end
  check (`bun run check`) with a real API key is what closes it.
- The runtime merge of `sendMessage`'s `body` into `prepareSendMessagesRequest` (C-6) was read from the runtime
  source, not run in a browser. The `chat.test.tsx` test planned in Unit 2 closes it.

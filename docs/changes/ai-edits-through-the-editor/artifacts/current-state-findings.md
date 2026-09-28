# Current State Findings: AI Edits Through the Editor

## Provenance

Produced by this run's own discovery round on 2026-09-28. No prior findings report existed. Three agents were
dispatched in parallel over `src/server/` (tools, agent, sessions, approvals, jobs, documents routes, events, server,
check script), `src/shared/wire.ts`, and `src/ui/` (documents, markdown editor, chat, app, jobs, host events):

- `han-core:structural-analyst` (its IDs S-1 to S-12)
- `han-core:behavioral-analyst` (B-1 to B-19)
- `han-core:concurrency-analyst` (K-1 to K-10)

The run then did its own project sweep and one hands-on probe: it installed `yjs` and `y-prosemirror` into a scratch
folder outside the repo and ran the merge the plan depends on (C-19). The agents' IDs are kept in each finding's
**Raised by** field. Findings the agents raised that do not bear on this change are omitted, and listed under
[Findings Recorded but Not Carried](#findings-recorded-but-not-carried).

## Project Context

- **Stack:** Bun + TypeScript, Hono server, Vercel AI SDK `ai@7.0.114` with `@ai-sdk/anthropic@4.0.63` and
  `@ai-sdk/react@4.0.117`, React 19, ProseMirror (`prosemirror-markdown@1.13.8`, `prosemirror-example-setup@1.2.3`).
  Tests use `bun test`. UI tests run in happy-dom (`make test-ui`). There is an end-to-end check script,
  `bun run check`. Versions are pinned exactly in `package.json`.
- **Conventions source:** `README.md`, the only one found. No CLAUDE.md, AGENTS.md, or `project-discovery.md`. Its
  conventions are: each server feature has a domain file with no HTTP in it, plus a matching `*.routes.ts`;
  `agent-host.ts` wires features and `server.ts` mounts routes; `src/shared/wire.ts` holds only types and has no
  imports; each UI feature is one file with its CSS beside it; and `app.tsx` is the only UI file that wires features
  together.
- **ADRs found:** none under `docs/adr/`. `docs/changes/` holds two earlier `plan-a-change` plans. The latest,
  `docs/changes/tell-ai-the-open-file/`, is fully built. Its "auto-save before sending" decision is what this plan
  reverses (C-6).
- **Coding standards found:** none.
- **Recent churn:** the repository is three days old, with 32 commits between 2026-09-25 and 2026-09-28, all adding
  features. The most-touched files are `chat.tsx`, `chat.test.tsx`, `app.tsx`, `server.ts`, and `sessions.ts`. Churn
  here is not a risk signal.

## Gaps

- No ADR, coding standard, or CLAUDE.md exists. Nothing written records why approvals exist, or why jobs skip them.
- `src/server/documents.routes.ts` has no unit test. It becomes the only code that writes posts (C-2).
- `yjs`, `y-prosemirror` and `y-protocols` are not dependencies. This run checked their APIs only in a scratch
  install (C-19), not in the repo.
- The only UI tests are for `chat.tsx` and `agent-panel.tsx`. `documents.tsx` and `markdown-editor.tsx` have no tests.

## Findings

### C-1: The model's Edit and Write tools write straight to disk

- **Claim:** `Edit` reads the file from disk, replaces `old_string` (which must occur exactly once), and writes the
  file. `Write` writes a whole file. Both only accept `.md` files outside dot-folders.
- **Location:** `src/server/tools.ts`, `fileTools` (Write, Edit) and `resolvePost`
- **Evidence:**
  ```ts
  const Edit = tool({
    description: 'Change part of a markdown post by replacing old_string, which must occur exactly once, with new_string.',
    inputSchema: z.object({ file_path: z.string(), old_string: z.string(), new_string: z.string() }),
    execute: async ({ file_path, old_string, new_string }) => {
      const file = Bun.file(resolvePost(workspace, file_path));
      const text = await file.text();
      const count = text.split(old_string).length - 1;
      if (count === 0) throw new Error(`old_string not found in ${file_path}`);
      if (count > 1) throw new Error(`old_string appears ${count} times in ${file_path}`);
      await Bun.write(file, text.replace(old_string, () => new_string));
      return `edited ${file_path}`;
    },
  });
  ```
- **Raised by:** structural-analyst S-1, behavioral-analyst B-2, concurrency-analyst K-6
- **Confidence:** Verified
- **Bears on:** S-8, D-1

### C-2: The document PUT route is the other disk write, and its path check is weaker than the tools'

- **Claim:** `PUT /api/documents/:name` writes whatever content it is sent. Its workspace check does not resolve
  symlinks, unlike `resolveInWorkspace` in `tools.ts`, and no unit test covers it.
- **Location:** `src/server/documents.routes.ts`, `docPath` and the PUT handler; `src/server/tools.ts`,
  `resolveInWorkspace`
- **Evidence:**
  ```ts
  function docPath(name: string): string {
    const path = resolve(workspace, name);
    if (relative(workspace, path).startsWith('..')) throw new Error('path escapes workspace');
    return path;
  }
  ```
- **Raised by:** structural-analyst S-1, S-2, S-12
- **Confidence:** Verified
- **Bears on:** D-19 (Cut for Scope)

### C-3: The Read tool reads disk, so it never sees text typed but not yet saved

- **Claim:** `Read` returns the file's text from disk. Subagents started by the `Task` tool share the same `Read`.
- **Location:** `src/server/tools.ts`, `Read`; `src/server/agent.ts`, `agentSettings` and `taskTool`
- **Evidence:**
  ```ts
  const files = fileTools(options.workspace);
  ...
  tools: { ...files, Task: taskTool(config.agents, model, files, ownerId, report) },
  ```
- **Raised by:** behavioral-analyst B-2, B-5
- **Confidence:** Verified
- **Bears on:** S-8, D-1, D-2

### C-4: Subagents can only ever read

- **Claim:** `AgentDef['tools']` is typed `('Read' | 'Glob')[]`, and the agent-file parser drops any other tool name, so
  no subagent can reach `Edit` or `Write`.
- **Location:** `src/server/workspace-config.ts`, `AgentDef` and `isAgentTool`
- **Evidence:**
  ```ts
  const isAgentTool = (name: string): name is AgentDef['tools'][number] => name === 'Read' || name === 'Glob';
  ```
- **Raised by:** structural-analyst S-9, behavioral-analyst B-5
- **Confidence:** Verified
- **Bears on:** S-8 (subagents stay read-only)

### C-5: Edit and Write in chat wait for an Allow or Deny answer

- **Claim:** Chat turns pass every `Edit` and `Write` call through `Approvals.request`, which shows an approval card and
  pauses the turn until the user answers, the request times out, or the turn stops. `EDIT_TOOLS` is the only consumer of
  `Approvals`. The approval routes, the socket's `approval-response` message, and the `approval-request` and
  `approval-resolved` events exist only for it.
- **Location:** `src/server/sessions.ts`, `toolApproval`; `src/server/approvals.ts`; `src/server/approvals.routes.ts`;
  `src/server/events.routes.ts`; `src/shared/wire.ts`; `src/ui/chat.tsx`, `Approval`; `src/ui/app.tsx`
- **Evidence:**
  ```ts
  toolApproval: async ({ toolCall }) => {
    if (!EDIT_TOOLS.has(toolCall.toolName)) return 'not-applicable';
    const allow = await this.approvals.request(sessionId, toolCall.toolName, toolCall.input, abort.signal, writer);
    return allow ? 'approved' : { type: 'denied', reason: 'The user denied this action.' };
  },
  ```
- **Raised by:** structural-analyst S-3, behavioral-analyst B-12, B-19
- **Confidence:** Verified
- **Bears on:** S-14, D-5

### C-6: Send saves the open file first, and the message is not sent when that save fails

- **Claim:** `Chat.send` awaits `saveOpenFile()` (which is `docs.save`, a disk write) before it sends. When the save
  rejects, it shows "Could not save {file}, so the message was not sent." The request body is
  `{ text, openFile }`. `chat.test.tsx` pins this order.
- **Location:** `src/ui/chat.tsx`, `send` and `prepareSendMessagesRequest`; `src/ui/app.tsx`;
  `src/server/sessions.routes.ts`
- **Evidence:**
  ```ts
  try {
    await saveOpenFile();
  } catch {
    setSaveError(`Could not save ${file}, so the message was not sent. Try Send again.`);
    return;
  } finally {
    savingRef.current = false;
  }
  sendMessage({ text }, { body: { openFile: file } });
  ```
- **Raised by:** behavioral-analyst B-1, B-2, concurrency-analyst K-5
- **Confidence:** Verified
- **Bears on:** S-13, D-8

### C-7: The server keeps the chat history, and the UI sends only the newest message's text

- **Claim:** `Sessions.chat` builds each turn from its own `session.messages` plus one new user turn. The UI transport
  sends only the newest message's text. A stopped turn is left out of the history, and so is a turn whose stream
  failed.
- **Location:** `src/server/sessions.ts`, `chat`; `src/ui/chat.tsx`, `prepareSendMessagesRequest`
- **Evidence:**
  ```ts
  try {
    const responseMessages = await result.responseMessages;
    if (!abort.signal.aborted) session.messages = [...messages, ...responseMessages];
  } catch (error) {
    // The stream already showed its error in the chat; throwing would add a vaguer second one.
    if (streamFailed && !abort.signal.aborted) return;
  ```
- **Raised by:** behavioral-analyst B-1, B-16, concurrency-analyst K-7
- **Confidence:** Verified
- **Bears on:** S-12, D-1, D-6

### C-8: The AI SDK can hand a tool call to the browser, but this app's turn model cannot resume one

- **Claim:** In `ai@7.0.114`, a tool with no `execute` ends the step and the stream, and `useChat` offers `onToolCall`,
  `addToolOutput` and `sendAutomaticallyWhen` to finish it in the browser. Resuming needs the whole message list sent
  back to the server. This app sends only text (C-7), and `Sessions` has no way to take a tool result for a turn in
  progress.
- **Location:** `node_modules/ai/dist/index.js` (the step-continuation check); `node_modules/@ai-sdk/react/dist/index.d.ts`;
  `src/server/sessions.ts`
- **Evidence:**
  ```js
  if (tool3.execute != null && chunk.providerExecuted !== true) { toolCallsToExecute.push(chunk); }
  ```
- **Raised by:** behavioral-analyst B-14, B-15, B-16
- **Confidence:** Verified (read from the SDK source; not run against a live model)
- **Bears on:** D-1

### C-9: Tool errors reach the model as results it can react to, not as turn failures

- **Claim:** When a tool's `execute` throws, the AI SDK turns it into a `tool-error` result, and the turn carries on.
  Today's `Edit` relies on this for "old_string not found".
- **Location:** `node_modules/ai/dist/index.js`, `executeToolCall`
- **Evidence:**
  ```js
  } catch (error) {
    const toolError = { type: "tool-error", toolCallId, toolName, input, ... };
  ```
- **Raised by:** behavioral-analyst B-11
- **Confidence:** Verified (SDK source)
- **Bears on:** S-8, D-1

### C-10: The document state models one open file, and switching files throws away unsaved edits

- **Claim:** `useDocuments` holds one `current`, `content`, `saved`, `dirty` and `version`. `open` → `load` replaces
  all of them, with no prompt and no copy kept. One `MarkdownEditor` exists, and a `version` bump replaces its whole
  state.
- **Location:** `src/ui/documents.tsx`, `useDocuments`, `load`, `open`; `src/ui/markdown-editor.tsx`
- **Evidence:**
  ```ts
  const load = (name: string, text: string) => {
    setCurrent(name);
    setContent(text);
    setSaved(text);
    setDirty(false);
    setChangedOnDisk(false);
    setVersion((v) => v + 1);
  };
  ```
  ```ts
  useEffect(() => {
    view.current?.updateState(createState(markdown));
  }, [version]);
  ```
- **Raised by:** structural-analyst S-5, behavioral-analyst B-3
- **Confidence:** Verified
- **Bears on:** S-6, D-4

### C-11: After a turn, the editor reloads the AI's disk changes or shows a banner. Nothing merges.

- **Claim:** `onTurnFinished` is `docs.syncFromDisk`, which only checks the open file. It reloads the file when there
  are no unsaved edits. When there are, it shows "The agent changed this file. Reload (discards your edits)". Saving
  instead overwrites the AI's changes. A file the AI changed that is not open is never looked at.
- **Location:** `src/ui/documents.tsx`, `syncFromDisk` and the `changedOnDisk` banner; `src/ui/app.tsx`
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
- **Raised by:** structural-analyst S-6, behavioral-analyst B-8, concurrency-analyst K-5, K-8
- **Confidence:** Verified
- **Bears on:** S-6, D-15

### C-12: `save` and `open` apply their results to whichever file is open when they finish

- **Claim:** `save` and `open` do not check, after their `await`, that the file they started on is still the open
  file. A save that finishes after a switch marks the newly opened file as saved. When two opens overlap, the slower
  response wins.
- **Location:** `src/ui/documents.tsx`, `save`, `open`
- **Evidence:**
  ```ts
  const save = useCallback(async () => {
    if (!dirty || unsupported.length) return;
    await api('PUT', `/api/documents/${encodeURIComponent(current)}`, { content });
    setSaved(content);
    setDirty(false);
    setChangedOnDisk(false);
  }, [current, content, dirty, unsupported]);
  ```
- **Raised by:** concurrency-analyst K-2, K-3, K-4
- **Confidence:** Verified
- **Bears on:** S-6, D-4

### C-13: Documents the editor cannot hold open read-only, and the check lives only in the UI

- **Claim:** A document containing a table, a task list, or raw HTML opens read-only, and Save is disabled for it.
  `unsupportedMarkdown` lives in `markdown-editor.tsx`. The server's tools never consult it, so today the AI can edit
  such a file on disk.
- **Location:** `src/ui/markdown-editor.tsx`, `UNSUPPORTED` and `unsupportedMarkdown`; `src/ui/documents.tsx`
- **Evidence:**
  ```ts
  // Markdown the editor's CommonMark schema cannot hold. Saving a document that contains
  // any of these would silently rewrite or flatten it, so such documents open read-only.
  const UNSUPPORTED: [string, RegExp][] = [
  ```
- **Raised by:** behavioral-analyst B-4
- **Confidence:** Verified
- **Bears on:** S-2, S-8, D-9

### C-14: Background jobs reach a precisely bounded set of files

- **Claim:** Jobs run the same tools with no approval gate. Their code is `jobs.ts`, `jobs.routes.ts`, `jobs.test.ts`,
  the `Jobs` construction in `agent-host.ts`, the route in `server.ts`, `Job`, `JobStatus` and the `job-status` event
  in `wire.ts`, `ui/jobs.tsx` and `jobs.css`, the `useJobs` wiring and `job-status` branch in `app.tsx`, the two `job:`
  scenarios in `check.ts`, and the README's job text and three `/api/jobs` rows. Nothing else imports them.
- **Location:** as listed
- **Evidence:**
  ```ts
  // No approval gate, so edits are auto-accepted.
  agentSettings(this.options, this.events, job.id)
    .then((settings) =>
      generateText({ ...settings, prompt, stopWhen: stepCountIs(limits.maxTurns ?? 10), abortSignal: abort.signal }),
    )
  ```
- **Raised by:** structural-analyst S-4, behavioral-analyst B-13
- **Confidence:** Verified
- **Bears on:** S-1, D-12

### C-15: `wire.ts` is the one module both server and UI import

- **Claim:** No UI file imports from `src/server/` and no server file imports from `src/ui/`. Both import types from
  `src/shared/wire.ts`, which has no imports and holds only types.
- **Location:** `src/shared/wire.ts`
- **Evidence:**
  ```ts
  // The shapes that cross the wire between the server and its clients (the UI and the check script).
  // Types only, with no imports, so the browser bundle can import it with `import type`.
  ```
- **Raised by:** structural-analyst S-10, S-7
- **Confidence:** Verified
- **Bears on:** S-2, S-10, S-11

### C-16: The chat renders tool calls from the streamed message parts

- **Claim:** Each assistant message's tool calls arrive as tool parts carrying `input` and a `state`
  (`output-available`, `output-error`, `output-denied`, or running). `chat.tsx` renders them with `toolSummary`. The
  UI never reads a tool's output today.
- **Location:** `src/ui/chat.tsx`, `Message` and `toolSummary`
- **Evidence:**
  ```tsx
  if (isToolUIPart(part)) {
    return (
      <div key={i} className="tool">
        <b>{getToolOrDynamicToolName(part)}</b> {toolSummary(part.input)}{' '}
  ```
- **Raised by:** structural-analyst S-7, this run's own read
- **Confidence:** Verified
- **Bears on:** D-3

### C-17: The editor's undo comes from `prosemirror-example-setup`'s history plugin

- **Claim:** `createState` uses `exampleSetup({ schema })`, which adds `prosemirror-history`, binds Mod-z to its
  `undo`, and puts undo and redo items in the menu. The setup can leave the history plugin out (`history: false`),
  but its menu items stay bound to `prosemirror-history`.
- **Location:** `src/ui/markdown-editor.tsx`, `createState`; `node_modules/prosemirror-example-setup/dist/index.js`
- **Evidence:**
  ```js
  r.fullMenu = r.inlineMenu.concat([[r.insertMenu, r.typeMenu]], [[undoItem, redoItem]], r.blockMenu);
  ...
  bind("Mod-z", undo);
  ...
  if (options.history !== false)
      plugins.push(history());
  ```
- **Raised by:** this run's own read
- **Confidence:** Verified
- **Bears on:** S-5, D-10

### C-18: The event bus broadcasts every event to every socket

- **Claim:** `EventBus.emit` sends each event to every listener, and each WebSocket is one listener. The UI filters by
  event type only.
- **Location:** `src/server/events.ts`; `src/server/events.routes.ts`; `src/ui/app.tsx`
- **Evidence:**
  ```ts
  emit(event: HostEvent) { for (const listener of this.listeners) listener(event); }
  ```
- **Raised by:** behavioral-analyst B-6
- **Confidence:** Verified
- **Bears on:** D-3

### C-19: A Yjs fork of the document, edited through markdown, merges with typing done meanwhile

- **Claim:** The run installed `yjs@13.6.33` and `y-prosemirror@1.3.7` in a scratch folder and ran the following
  steps. It loaded a markdown post into a `Y.XmlFragment` and recorded its state vector and state. It typed into the
  live copy. It copied the recorded state into a second `Y.Doc` and serialized that copy to markdown with this app's
  `prosemirror-markdown` version. It applied a string replacement, parsed the result, and wrote it back with
  `updateYFragment`. Finally it applied `Y.encodeStateAsUpdate(fork, stateVector)` to the live doc. In all three
  cases, the typing and the AI's edit both survived:
  - the edit and the typing were in different paragraphs;
  - both were in the same paragraph;
  - the edit added a new paragraph.
- **Location:** scratch probe outside the repo; `y-prosemirror/src/y-prosemirror.js` exports
  `ySyncPlugin`, `updateYFragment`, `prosemirrorToYXmlFragment`, `yXmlFragmentToProseMirrorRootNode`, `yUndoPlugin`,
  `undo`, `redo`
- **Evidence:**
  ```ts
  const sv = Y.encodeStateVector(live);
  const base = Y.encodeStateAsUpdate(live);
  (p2.get(0) as Y.XmlText).insert(0, 'USER ');              // typing after the snapshot
  const fork = new Y.Doc();
  Y.applyUpdate(fork, base);
  const snapMd = defaultMarkdownSerializer.serialize(yXmlFragmentToProseMirrorRootNode(forkFrag, schema));
  const edited = snapMd.replace('quick brown', 'slow red');
  fork.transact(() => updateYFragment(fork, forkFrag, defaultMarkdownParser.parse(edited)!, { mapping: new Map(), isOMark: new Map() } as any));
  Y.applyUpdate(live, Y.encodeStateAsUpdate(fork, sv), 'ai');
  // → "The slow red fox jumps."  and  "USER Second paragraph here."
  ```
  `y-prosemirror@1.3.7` has peer dependencies `yjs ^13.5.38`, `y-protocols ^1.0.1`, and ProseMirror versions the
  repo already satisfies. `yUndoPlugin({ trackedOrigins })` tracks the `ySyncPluginKey` origin plus whatever it is given.
- **Raised by:** this run's own probe
- **Confidence:** Verified in the scratch probe. Unverified in the running app (happy-dom and the real `EditorView`
  were not exercised), and `updateYFragment`'s `meta` argument is an internal shape, passed here as a cast.
- **Bears on:** S-4, D-16, D-24

### C-20: The documents routes accept a post in a subfolder by its encoded name

- **Claim:** Hono decodes an encoded `/` in the `:name` parameter, so `GET /api/documents/drafts%2Fa.md` reaches the
  handler with `name` set to `drafts/a.md`. The UI already encodes names with `encodeURIComponent`. The documents list
  (`GET /api/documents`) scans only `*.md` at the workspace's top level.
- **Location:** `src/server/documents.routes.ts`; scratch probe against `node_modules/hono`
- **Evidence:**
  ```ts
  app.get('/api/documents/:name', (c) => c.text(c.req.param('name')));
  await app.request('/api/documents/' + encodeURIComponent('drafts/a.md')); // → 200 "drafts/a.md"
  ```
- **Raised by:** this run's own probe, prompted by software-architect's unverified note
- **Confidence:** Verified
- **Bears on:** S-6, D-7

### C-21: The merge works through a live `EditorView` in happy-dom, and undo groups it with recent typing unless capture is stopped

- **Claim:** In happy-dom with `@happy-dom/global-registrator@20.14.5`, an `EditorView` built with the following plugins
  works:
  - `ySyncPlugin(fragment)`;
  - `yUndoPlugin({ trackedOrigins: ['ai'] })`;
  - `exampleSetup({ schema, history: false })`.

  Text typed through `view.dispatch` and a forked AI update applied with origin `'ai'` both show in `view.state.doc`.
  `Y.UndoManager` groups changes made within its capture timeout into one undo step. So when the AI's update lands
  soon after typing, a single `undo` reverts both. Calling `undoManager.stopCapturing()` before and after applying the
  update makes the AI's edit a step of its own: `undo` then reverts only the AI's change, and the typing stays. The
  plugin reads its undo manager from `yUndoPluginKey.getState(view.state).undoManager`. The plugin's view `destroy`
  calls `undoManager.destroy()`, including on a manager passed in through the `undoManager` option.
- **Location:** scratch probe outside the repo; `y-prosemirror/src/plugins/undo-plugin.js`, `yUndoPlugin`
- **Evidence:**
  ```ts
  view.dispatch(view.state.tr.insertText(' USER', pos));            // typing
  um.stopCapturing(); Y.applyUpdate(live, aiUpdate, 'ai'); um.stopCapturing();
  // view after merge: "# Title\n\nThe slow red fox. USER"
  // view after undo : "# Title\n\nThe quick brown fox. USER"   (without stopCapturing: "...quick brown fox.")
  ```
  ```js
  destroy: () => {
    undoManager.destroy()
  }
  ```
- **Raised by:** this run's own probe
- **Confidence:** Verified in the scratch probe
- **Bears on:** S-4, S-5, D-10, D-16

### C-22: Under Bun on macOS, `realpathSync` returns an existing file's real letter case

- **Claim:** For a file that exists, `realpathSync('ws/Notes.md')` returns `ws/notes.md`, the case on disk, both in its
  plain form and as `realpathSync.native`. `resolveInWorkspace` already calls `realpathSync` on paths that exist, so a
  name the model spells in a different case comes back in the disk's case. For a path that does not exist yet,
  `realTarget` joins the base name as given, keeping its case.
- **Location:** `src/server/tools.ts`, `resolveInWorkspace` and `realTarget`; scratch probe
- **Evidence:**
  ```
  $ bun -e 'console.log(realpathSync("casews/Notes.md"), realpathSync.native("casews/Notes.md"))'
  …/casews/notes.md …/casews/notes.md
  ```
- **Raised by:** this run's own probe, prompted by junior-developer JD-006
- **Confidence:** Verified on this machine (macOS, case-insensitive APFS). Unverified on a case-sensitive file system,
  where the two spellings are different files anyway.
- **Bears on:** S-7, D-1

## Findings Recorded but Not Carried

These are real, but they do not bear on this change, so the plan does not act on them:

- K-1: `session.abort` stays set if `agentSettings` throws before the `try`, which blocks the session. That is a
  defect outside this change.
- K-7: Stop does not interrupt a disk write already under way. It stops applying once `Edit` no longer writes.
- S-8: the tool errors are plain `Error`s. The model reads the message, and nothing else needs a code.
- S-11: churn.
- B-7: sessions and approvals do not persist across restarts.

## Findings No Agent Could Audit

- No agent ran the app against the live Anthropic model, so the exact wire parts for tool calls come from SDK source
  and types, not a captured stream.
- The Yjs merge was proven in a scratch script, not in the browser against a live `EditorView` with `ySyncPlugin`.
  Closing that needs the first change unit's UI test (or a manual run).

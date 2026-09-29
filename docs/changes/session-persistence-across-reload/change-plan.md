# Change Plan: Session Persistence Across Reload

## Why This Change

Reloading the page wipes the agent panel. The chat history, what the AI is doing, the open file, the highlights and
their questions, the "could not apply" notices, and the editor's rendered/raw view are all lost. The user wants a reload,
and a server restart too, to bring all of it back. This is **a constraint arriving**: a new requirement the current
structure cannot absorb, because every piece of that state lives only in page or process memory. The source is the
user's own request, recorded word for word in [artifacts/scope-boundary.md](artifacts/scope-boundary.md). No ticket
exists.

## What Changes, In One Paragraph

After this change, the server keeps the current chat session and the editor's view on disk. Both live in a `.3pitor/`
folder inside the workspace that tells git to ignore it, so they survive a reload and a server restart. The session
record holds two lists: the conversation the model sees, and the messages the chat panel shows. The view record holds
the open file, the rendered/raw mode, the highlights and their questions, the "could not apply" notices, and the full
editing state of every file with unsaved changes. A loaded page reads both records and rebuilds the panel and the editor
from them. It no longer starts a new session. A turn that was still running when the page reloaded keeps running on the
server. The reloaded page shows it as working, then applies its edits and highlights when it finishes. The browser's
"Leave site?" prompt now fires only while a change has not yet reached the disk, and the editor says so if a change
could not be written.

## Current State

Everything the user wants restored lives only in React state, React refs, or the server's in-memory `Map`. Nothing is
persisted except saved markdown
([C-1](artifacts/current-state-findings.md#c-1-everything-the-writer-wants-restored-lives-only-in-page-or-process-memory)).
That is the structural property this change addresses.

- **Sessions are created per page load, and no route reads one back.** `App` POSTs `/api/sessions` on mount and on
  Clear Chat through the same `newSession`
  ([C-2](artifacts/current-state-findings.md#c-2-every-page-load-creates-a-new-session-and-the-server-has-no-way-to-read-one-back)).
- **The server's history cannot rebuild the chat display.** `Session.messages` is `ModelMessage[]`, which has no
  `data-task` or `data-session` parts, no tool-part states, and no stopped or failed turns. It also carries a per-turn
  "file open in my editor" sentence the panel never showed. `useChat` accepts a `messages` seed, and
  `createUIMessageStream` accepts `originalMessages`
  ([C-3](artifacts/current-state-findings.md#c-3-sessions-holds-durable-and-transient-session-data-in-one-record-with-one-write-point-for-history),
  [C-4](artifacts/current-state-findings.md#c-4-the-chat-display-cannot-be-rebuilt-from-the-servers-history-usechat-can-be-seeded-and-the-stream-can-hand-back-the-finished-uimessage-list)).
- **A turn's edits and highlights exist only in the stream's closing `data-session` part.** The browser applies them
  only from `useChat`'s `onFinish`
  ([C-5](artifacts/current-state-findings.md#c-5-a-turns-edits-and-highlights-exist-only-in-the-streams-closing-data-session-part)).
- **Highlights and notices are small JSON.** Highlights are re-found by quote text, so storing
  `SessionHighlights` is enough to redraw them
  ([C-6](artifacts/current-state-findings.md#c-6-highlights-question-labels-and-notices-are-small-json-that-can-be-stored-as-they-are)).
- **Unsaved editor state is Yjs history, not markdown.** AI edits merge against a base snapshot that must be an
  ancestor of the live doc, and a doc rebuilt from markdown is not one
  ([C-7](artifacts/current-state-findings.md#c-7-an-opened-files-unsaved-state-is-yjs-history-not-markdown-and-markdown-cannot-stand-in-for-it)).
  The leave-page prompt guards exactly the `dirty` flag, "since they exist only in this page"
  ([C-8](artifacts/current-state-findings.md#c-8-the-leave-page-warning-guards-exactly-the-unsaved-edit-flag-and-says-why)).
- **A reload mid-turn leaves the turn running with nobody to receive its result**
  ([C-9](artifacts/current-state-findings.md#c-9-a-reload-mid-turn-leaves-the-turn-running-and-its-edits-and-highlights-reach-nobody)).
- **Today, a turn's session is free again before its stream closes.** `session.abort` is cleared and `session.messages`
  is set inside `execute`, before `data-session` is written
  ([C-11](artifacts/current-state-findings.md#c-11-history-is-replaced-wholesale-after-an-await-and-any-disk-write-would-have-no-ordering)).
  Back-to-back turns in `sessions.test.ts` and `check.ts`, and a writer pressing Send right after a reply, rely on
  this.
- **Browser storage cannot survive a restart**, because the server picks a new port and so a new origin each time
  ([C-12](artifacts/current-state-findings.md#c-12-the-browsers-own-storage-cannot-survive-a-server-restart-because-the-port-changes)).
- **The server has no place for app state on disk.** Dot-folders in the workspace are hidden from the file tree and
  cannot be written by the AI's tools
  ([C-13](artifacts/current-state-findings.md#c-13-the-server-has-no-place-for-app-state-on-disk-the-workspaces-dot-folders-are-the-nearest-precedent)).
- **Two latent problems a restore would hit.** Concurrent `ensureLoaded` calls load one file twice, and the second load
  replaces the first `Entry`
  ([C-14](artifacts/current-state-findings.md#c-14-the-pages-three-stateful-units-meet-only-in-app-through-callbacks-and-refs)).
  A failure before the turn's `try` leaves the session answering 409 until restart
  ([C-17](artifacts/current-state-findings.md#c-17-pre-existing-defect-a-failure-before-the-turns-try-leaves-the-session-stuck)).

## Target State

### Where each responsibility lives

| Part | Answerable for | Not answerable for |
| --- | --- | --- |
| `src/server/components/json-file.ts` | Reading and writing one JSON file under `<workspace>/.3pitor/`, with writes to one path applied in call order and atomically, and keeping `.3pitor/` out of git | What the JSON means |
| `Sessions` (`src/server/chat/sessions/sessions.ts`) | Turns, as today. Also: which session is current, both histories of each session, and writing the current session's record | View state, documents, Yjs |
| `src/server/view-state/view-state.ts` + `view-state.routes.ts` | Reading and writing `.3pitor/view.json` | The meaning of anything inside it |
| `src/shared/wire.ts` | The types of the two new routes' bodies and of `view.json` | — |
| `markdown-editor.tsx` | Turning a `Y.Doc` or `Snapshot` into base64 and back | When anything is stored |
| `useDocuments` (`documents.tsx`) | Everything today, plus: rebuilding the editor from a `ViewState`, writing `ViewState` back after changes, the editor mode, the turn record, and which turn's result it has applied | The chat's messages |
| `useChatSession` (`chat.tsx`) | Everything today, plus: starting from stored messages, and a waiting state for a turn that began before the reload | Where the messages come from |
| `App` (`app.tsx`) | Wiring: the page-load restore sequence, and noticing when a turn the page is waiting on has finished | — |

Nothing here adds an interface, a storage abstraction, or a configurable location
([D-8](artifacts/change-decision-log.md#d-8-where-the-new-code-lives)).

### Contract 1: `.3pitor/session.json`

Written by `Sessions` for the current session only. Read by `Sessions.load()`. `messages` and `uiMessages` are the AI
SDK's own `ModelMessage[]` and `UIMessage[]`, serialized with `JSON.stringify` as they are
([D-4](artifacts/change-decision-log.md#d-4-store-both-histories)).

```json
{
  "id": "5b1e0c1a-2f7d-4a4e-9b1c-0d6f3c2a9e11",
  "messages": [
    { "role": "user", "content": [
      { "type": "text", "text": "Fix the spelling" },
      { "type": "text", "text": "The file open in my editor is post.md. When my message does not name a file, it means this file." } ] },
    { "role": "assistant", "content": [ { "type": "text", "text": "Fixed two typos." } ] }
  ],
  "uiMessages": [
    { "id": "0c9f7a52-4b0e-4a57-9d1a-1c3e5b7d9f21", "role": "user", "parts": [ { "type": "text", "text": "Fix the spelling" } ] },
    { "id": "msg-a91c2", "role": "assistant", "parts": [
      { "type": "step-start" },
      { "type": "text", "text": "Fixed two typos.", "state": "done" },
      { "type": "data-session", "data": {
        "aborted": false,
        "edited": { "post.md": "# Post\n..." },
        "highlights": { "file": "post.md", "passages": [ { "quote": "the", "label": "Q1", "question": "Keep this?" } ] } } } ] }
  ]
}
```

Rules:

- **When it is written.** Every write goes through `writeJson` and happens only for the current session. It is written
  on `create()` with empty lists, at turn start after the user's UI message is added, and at turn end after the
  assistant's UI message is added (and `messages` too, if the turn completed). `load()` does not write it when it falls
  back to a fresh session, so a folder where nobody chats gets no `session.json`
  ([D-23](artifacts/change-decision-log.md#d-23-create-awaits-its-write-and-a-fresh-load-writes-nothing)).
- **What counts as unreadable.** The file is missing, or it does not parse, or it lacks a string `id` and two arrays.
  In any of those cases `load()` starts a fresh session in memory and logs a warning if a file was present.
- **An interrupted turn loads as stopped.** When the last entry in `uiMessages` has `role: "user"`, the server stopped
  mid-turn. `load()` appends `stoppedReply()` and writes the record. The panel then shows the request as "stopped"
  ([D-12](artifacts/change-decision-log.md#d-12-a-server-restart-mid-turn-shows-the-turn-as-stopped)).
- **`stoppedReply()` builds the stopped message.** It is one private function in `sessions.ts` that returns
  `{ id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'data-session', data: { aborted: true, edited: {} } }] }`.
  Contract 5 uses it too.
- **The user's UI message is built by the server** as `{ id: crypto.randomUUID(), role: 'user', parts: [{ type:
  'text', text }] }`, without the open-file sentence.
- **No version field** ([Deferred](#deferred-yagni)).

### Contract 2: `.3pitor/view.json` and the `ViewState` type

Written by the page through `PUT /api/view-state`. Read by the page through `GET /api/view-state`. The server treats it
as opaque.

```ts
// src/shared/wire.ts — types only, no imports

// A file with unsaved changes: its last saved text and its editor state, so a reload keeps the changes and later AI
// edits can still merge. `doc` and `loadBase` are base64 of Yjs updates; a Snapshot's vector is rebuilt with
// Y.encodeStateVectorFromUpdate.
export interface StoredDoc {
  name: string;
  saved: string;
  doc: string; // base64 of Y.encodeStateAsUpdate(entry.doc)
  loadBase: string; // base64 of entry.loadBase.update
}

// The documents as they were when the latest chat message was sent: what the AI's edits are merged against.
export interface TurnRecord {
  file?: string; // the file open when the message was sent (useDocuments' turnFile)
  bases: Record<string, string>; // file name → base64 of that file's turnBases snapshot update
}

// An AI edit the editor could not bring in, and why.
export interface NotApplied {
  name: string;
  message: string;
}

// GET/PUT /api/view-state, and the body of .3pitor/view.json.
export interface ViewState {
  current?: string;
  mode: 'rendered' | 'raw';
  unsaved: StoredDoc[];
  highlights?: SessionHighlights;
  notApplied: NotApplied[];
  turn?: TurnRecord;
  // The id of the last assistant message whose edits and highlights the editor took in.
  appliedTurn?: string;
}

// GET /api/sessions/current. `Message` is the AI SDK's UIMessage on the page; wire.ts stays import-free.
export interface CurrentSession<Message = unknown> {
  id: string;
  messages: Message[];
  running: boolean;
}
```

Worked example of `view.json`:

```json
{
  "current": "drafts/post.md",
  "mode": "raw",
  "unsaved": [ { "name": "drafts/post.md", "saved": "# Post\n", "doc": "AQLr3wE...", "loadBase": "AQGa1...==" } ],
  "highlights": { "file": "drafts/post.md", "untilSaved": true, "passages": [ { "quote": "tightened intro" } ] },
  "notApplied": [ { "name": "ideas.md", "message": "it was saved while the AI was working; ask again" } ],
  "turn": { "file": "drafts/post.md", "bases": { "drafts/post.md": "AQKx0...", "ideas.md": "AQE9c..." } },
  "appliedTurn": "msg-a91c2"
}
```

With no file on disk, `GET` returns `{ "mode": "rendered", "unsaved": [], "notApplied": [] }`.

Only files with unsaved changes are stored, plus the name of the open file. A clean file other than the open one is not
restored. It reopens from disk when clicked
([D-15](artifacts/change-decision-log.md#d-15-only-unsaved-files-and-the-open-file-are-restored)).

### Contract 3: routes

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/sessions/current` | none | 200 `CurrentSession`: the current session's `id`, its `uiMessages` as `messages`, and `running` (`!!session.abort`). Always 200 once `load()` has run. `abort` never appears in the body. |
| `POST /api/sessions` | none | 201 `{ id }`, sent after the new session's record is written. It becomes current. A failed write answers 500 `{ error }`. |
| `POST /api/sessions/:id/chat` | unchanged | unchanged, 409 included. The assistant message's id in the stream is the id stored in `uiMessages`. The stream closes only after the turn is recorded (Contract 5). |
| `POST /api/sessions/:id/cancel` | unchanged | unchanged |
| `GET /api/view-state` | none | 200 `ViewState` |
| `PUT /api/view-state` | `ViewState` | 200 `{ "ok": true }` once the file is written, matching the documents routes, so `api()` can parse it. A failed write answers 500 `{ "error": <message> }`. |

The view-state `PUT` does not check the body's shape. The page is its only writer, and restore tolerates bad pieces
(Contract 6) ([Deferred](#deferred-yagni)).

### Contract 4: disk writes

```ts
// src/server/components/json-file.ts
export const stateFile = (workspace: string, name: 'session.json' | 'view.json') => join(workspace, '.3pitor', name);
export function readJson(path: string): Promise<unknown>; // missing or unparseable → undefined (unparseable also warns)
export function writeJson(path: string, value: unknown): Promise<void>;
```

What `writeJson(path, value)` does
([D-9](artifacts/change-decision-log.md#d-9-writes-to-one-file-are-serialized-and-atomic),
[D-18](artifacts/change-decision-log.md#d-18-a-failed-disk-write-reaches-its-caller-and-the-writer)):

1. Runs `JSON.stringify(value)` synchronously when called, so it captures the value at that moment.
2. Chains onto a per-path promise held in a module-level `Map<string, Promise<void>>`.
3. The chained work does the following, in order:
   - `mkdir -p` the `.3pitor` folder.
   - Write `.3pitor/.gitignore` containing `*` if it does not exist yet
     ([D-24](artifacts/change-decision-log.md#d-24-3pitor-keeps-itself-out-of-git)).
   - `Bun.write` to `` `${path}.${process.pid}.tmp` ``.
   - `rename` that temp file onto `path`.
4. The promise returned to the caller rejects with the write's error. The copy stored in the `Map` has a `.catch`
   attached, so one failure never stops later writes.

Writes to one path land in call order, and a crash never leaves a half-written file. The process id in the temp name
keeps two servers on one workspace from colliding on a temp file, since the README says several servers can run at
once. Between processes, the last one to write wins (see Risks).

### Contract 5: one turn's lifecycle in `Sessions.chat`

The order below is the contract. The page, the `turn-finished` event, and back-to-back turns all depend on it
([D-4](artifacts/change-decision-log.md#d-4-store-both-histories),
[D-11](artifacts/change-decision-log.md#d-11-a-turn-that-fails-to-start-ends-like-any-failed-turn),
[D-16](artifacts/change-decision-log.md#d-16-turn-finished-fires-after-the-record-is-written),
[D-17](artifacts/change-decision-log.md#d-17-the-routes-stream-closes-only-after-the-turn-is-recorded)):

1. Refuse with the existing 409 errors, thrown synchronously, if the session is unknown or `session.abort` is set. Set
   `session.abort`.
2. Append the user's UI message to `session.uiMessages`. If the session is current, start the record write. It is not
   awaited here, and a failure is logged.
3. Build the stream with `createUIMessageStream({ originalMessages: session.uiMessages, execute, onError })`:
   - `execute` is today's body, with two things removed: clearing `session.abort`, and emitting `turn-finished`.
     `session.messages` is still set inside `execute`, exactly as today.
   - `originalMessages` makes the stream's `start` chunk carry the assistant message id, so the page and the server
     see the same id.
4. `tee()` the stream:
   - The server reads one branch with `readUIMessageStream`, keeping the last message it yields. This copy keeps
     reading when the page disconnects.
   - The other branch goes to the route through a `TransformStream` whose `flush` awaits `recorded`, the promise step 5
     resolves. The page's stream therefore closes only after the turn is recorded and the session is free.
5. When the server's copy ends, whether normally, stopped, or with an error:

   ```
   try     { append the last message, or stoppedReply() if there is none; if current, await the record write }
   catch   { log it }
   finally { session.abort = undefined; emit turn-finished { sessionId, aborted }; resolve recorded }
   ```

   The reader has a terminal `.catch` that logs, so its rejection is never unhandled.

Because step 5's `finally` is the only place `abort` is cleared, and it runs on every path, a turn that fails before its
`try` (C-17) no longer leaves the session stuck. Because `recorded` holds the page's stream open, a writer who presses
Send the moment a reply finishes never meets "already has a turn in progress".

### Contract 6: page-load restore sequence

`App` runs this once, on mount ([D-6](artifacts/change-decision-log.md#d-6-the-page-load-restore-sequence),
[D-22](artifacts/change-decision-log.md#d-22-restore-survives-missing-or-broken-pieces)):

1. Mount without POSTing a session. The chat panel renders nothing until step 4. `useDocuments` fetches the document
   list as today.
2. Fetch `GET /api/sessions/current` and `GET /api/view-state` in parallel.
3. `docs.restore(view)`. Each piece below succeeds or fails on its own. A failed piece is dropped and logged to the
   console, and restore carries on:
   - **Unsaved files.** For each `unsaved` entry, build an `Entry` with `restoredEntry`: a new `Y.Doc` with the decoded
     `doc` update applied, `saved` as stored, `loadBase` decoded, `saves: 0`, and `dirty: true`. Attach the `update`
     listener after the update is applied. An entry that will not decode is dropped.
   - **Turn bookkeeping.** Set `turnBases` and `turnFile` from `view.turn`, and `appliedTurn` from `view.appliedTurn`.
   - **The open file.** If `current` is not among the restored entries, `ensureLoaded(current)`. Any failure means the
     file is treated as gone, and `current` stays undefined.
   - **The rest of the view.** `show(current)`, then set highlights, notices, and mode.
4. In one state update, set the chat to `{ id, messages, waiting: running }`, so `useChat` builds its `Chat` object with
   the seed. `useChat` reads `messages` only when `id` changes.
5. If `running` was true, fetch `GET /api/sessions/current` once more, in case the turn ended during steps 3–4. Then,
   whenever the session is not running, run `docs.applyPending(messages)`.
6. Mark the page restored. From here on, `useDocuments` writes `ViewState` after changes, and Send and Clear Chat are
   enabled.

**When a step 2 fetch fails.** If `GET /api/view-state` fails, the editor shows "Could not load your saved editor
state: {message}. Changes on this page will not survive a reload." The view writer stays off for this page load, so it
cannot overwrite the stored drafts, and the leave-page prompt goes back to firing on unsaved changes, as it does today.
If `GET /api/sessions/current` fails, the chat panel shows the error with Clear Chat enabled.

**Applying a finished turn.** `docs.applyPending(messages)` finds the last message with `role: 'assistant'`. If it has a
`data-session` part with `aborted: false`, and its id is not `appliedTurn`, it runs `applyTurn(id, data)`. The live
`onFinish` path calls the same function. `applyTurn` runs `applyEdited(data.edited)` and
`showHighlights(data.highlights)`, then sets `appliedTurn = id`. Applying the edits and recording `appliedTurn` land in
the same `ViewState` write, so a reload can never apply a turn twice or skip one
([D-7](artifacts/change-decision-log.md#d-7-a-reload-mid-turn-lets-the-turn-finish-and-the-page-picks-it-up)).

**While the chat is waiting.** Send is disabled, "thinking…" shows, and Stop is enabled and POSTs `/cancel` as today.
`App` holds `waiting` in a ref for its event handler. It fetches `GET /api/sessions/current` whenever either of these
happens while waiting:

- `turn-finished` arrives with this session's id.
- `useHostEvents`' `connected` goes from false to true. The socket's first open counts.

If that fetch returns `running: false`, `App` calls `chat.setMessages(messages)`, sets `waiting` to false, and runs
`docs.applyPending(messages)`
([D-20](artifacts/change-decision-log.md#d-20-a-waiting-page-re-checks-rather-than-trusting-one-event)).

**Clear Chat.** It keeps today's order: clear highlights, POST `/api/sessions`, then set the chat to
`{ id, messages: [], waiting: false }`.

### Contract 7: when the page writes `ViewState`

After restore, `useDocuments` computes the `ViewState` from its own state. Any change to that computed value schedules a
write. That includes typing, a save, `move`, `remove`, `current`, `mode`, highlights, notices, `turn`, and
`appliedTurn`. `move` re-keys `turn.bases` along with the open files.

The write rules ([D-10](artifacts/change-decision-log.md#d-10-the-page-writes-view-state-after-a-short-pause),
[D-21](artifacts/change-decision-log.md#d-21-the-turn-record-is-written-at-send-without-the-pause)):

- **The pause.** The write waits 300 ms after the last change. That is a literal, not a setting.
- **Send skips the pause.** The write that `beginTurn` triggers starts at once, so the merge bases are on disk as soon
  as possible. It is not awaited before the chat message is sent.
- **One at a time.** Only one `PUT` is in flight at a time. Changes made while one is in flight trigger exactly one more
  `PUT` with the latest state when it finishes.
- **After a failure.** A failed `PUT` is retried on the next change.

**The "Leave site?" prompt** fires while a write is waiting, in flight, or has failed. Unsaved changes in a file no
longer trigger it on their own. While the last write has failed, the editor also shows "Changes are not saved to disk:
{message}", so a full disk or an unwritable folder is visible before a reload rather than after
([D-2](artifacts/change-decision-log.md#d-2-unsaved-changes-survive-a-reload),
[D-18](artifacts/change-decision-log.md#d-18-a-failed-disk-write-reaches-its-caller-and-the-writer)).

## Surface Delta

### S-1: `src/server/components/json-file.ts` — Added

**Target state.** `json-file.ts` exists in `src/server/components/`. It exports `stateFile(workspace, name)`,
`readJson(path)`, and `writeJson(path, value)`, as pinned in Contract 4. It is the only code that reads or writes files
under `<workspace>/.3pitor/`. It creates `.3pitor/.gitignore` containing `*` the first time it writes there.

**Behavior.** Preserving on its own: this is new code with no callers until S-4 and S-10. The `.gitignore` it writes is
covered as a behavior change under S-2.

**Why.** Two callers, `Sessions` and the view-state routes, need ordered, atomic writes, and none exist today
([C-11](artifacts/current-state-findings.md#c-11-history-is-replaced-wholesale-after-an-await-and-any-disk-write-would-have-no-ordering)).

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-writes-to-one-file-are-serialized-and-atomic),
[D-18](artifacts/change-decision-log.md#d-18-a-failed-disk-write-reaches-its-caller-and-the-writer),
[D-24](artifacts/change-decision-log.md#d-24-3pitor-keeps-itself-out-of-git)

### S-2: `.3pitor/session.json` — Added

**Target state.** `<workspace>/.3pitor/session.json` holds the current session's `id`, `messages`, and `uiMessages`, in
the layout pinned in Contract 1. It is written only by `Sessions`. `.3pitor/` holds a `.gitignore` that makes git ignore
the whole folder.

**Behavior.** Changing. A `.3pitor/` folder appears in the writer's workspace the first time they chat or open a file.
Git does not show it. Settled by the user's answers on storage location and on keeping it out of git.

**Why.** The chat must survive a server restart
([C-12](artifacts/current-state-findings.md#c-12-the-browsers-own-storage-cannot-survive-a-server-restart-because-the-port-changes)).

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-durable-copy-lives-in-the-workspaces-3pitor-folder),
[D-24](artifacts/change-decision-log.md#d-24-3pitor-keeps-itself-out-of-git)

### S-3: `Session` — Re-scoped

**Target state.** `Session` is `{ id: string; messages: ModelMessage[]; uiMessages: UIMessage[]; abort?:
AbortController }`.

- `messages` is what the model is sent. It follows today's rules and is set at today's point: only completed turns
  enter it.
- `uiMessages` is what the chat panel shows. Every turn enters it: completed, stopped, and failed.
- `abort` is set from the moment a turn is accepted until its record has been written, or its write has failed. It is
  never persisted.

**Behavior.** Preserving for the model. `messages` is built exactly as today.

**Why.** The panel cannot be rebuilt from `messages`
([C-4](artifacts/current-state-findings.md#c-4-the-chat-display-cannot-be-rebuilt-from-the-servers-history-usechat-can-be-seeded-and-the-stream-can-hand-back-the-finished-uimessage-list)).

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-store-both-histories)

### S-4: `Sessions.load()` and `Sessions.current()` — Added

**Target state.** `Sessions.load(): Promise<void>` reads `session.json` into the `Map` and makes it the current session.
When the record is unreadable (Contract 1), it makes a fresh current session in memory and writes nothing. It marks an
interrupted turn as stopped. `Sessions.current(): Session` returns the current session, and there is always one once
`load()` has run. `Sessions` keeps its `Map`, because `check.ts` keeps chatting on an older session after creating newer
ones. Only the current session is written to disk.

**Behavior.** Changing. The conversation now survives a server restart, which is what the user asked for.

**Why.** Reload and restart must find "the current chat session".

**Depends on.** S-1, S-3.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-one-current-session-per-workspace),
[D-23](artifacts/change-decision-log.md#d-23-create-awaits-its-write-and-a-fresh-load-writes-nothing)

### S-5: `Sessions.create()` — Re-scoped

**Target state.** `create(): Promise<Session>` makes a new session, makes it current, and resolves once its empty record
has been written over `session.json`. It rejects if the write fails. `POST /api/sessions` awaits it.

**Behavior.** Preserving from the writer's view. Clear Chat already leaves the old chat unreachable. After the change it
is also gone from disk. The signature changes from synchronous to a promise. Its callers are the route and the tests.

**Why.** Clear Chat starts a new current session, and there is no list of old chats to keep
([Deferred](#deferred-yagni)). Awaiting the write means a restart right after Clear Chat cannot bring the cleared chat
back.

**Depends on.** S-4.

**Migration.** `const { id } = await sessions.create()` where tests wrote `sessions.create()`.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-one-current-session-per-workspace),
[D-23](artifacts/change-decision-log.md#d-23-create-awaits-its-write-and-a-fresh-load-writes-nothing)

### S-6: `Sessions.chat()` — Re-scoped

**Target state.** `chat()` runs a turn as today and follows the lifecycle in Contract 5. It records both histories and
writes the current session's record at turn start and turn end. It clears `abort`, emits `turn-finished`, and closes
the page's stream only after the turn is recorded. The stream the route receives carries the same chunks as today,
except that its `start` chunk now carries a server-chosen `messageId`.

**Behavior.** Changing, in two ways the user decided:

- A turn whose page has gone away still has its result recorded.
- A turn that fails before it starts no longer leaves the session answering 409.

Also changing, with no current consumer affected: `turn-finished` fires, and the stream closes, slightly later, after
the disk write.

**Why.** Contract 5.

**Depends on.** S-3, S-4.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-store-both-histories),
[D-7](artifacts/change-decision-log.md#d-7-a-reload-mid-turn-lets-the-turn-finish-and-the-page-picks-it-up),
[D-11](artifacts/change-decision-log.md#d-11-a-turn-that-fails-to-start-ends-like-any-failed-turn),
[D-16](artifacts/change-decision-log.md#d-16-turn-finished-fires-after-the-record-is-written),
[D-17](artifacts/change-decision-log.md#d-17-the-routes-stream-closes-only-after-the-turn-is-recorded)

### S-7: `GET /api/sessions/current` — Added

**Target state.** `sessionRoutes` answers `GET /api/sessions/current` as pinned in Contract 3.

**Behavior.** Changing. This is a new route.

**Why.** A loaded page has no other way to find the session
([C-2](artifacts/current-state-findings.md#c-2-every-page-load-creates-a-new-session-and-the-server-has-no-way-to-read-one-back)).

**Depends on.** S-4, S-9.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-the-page-load-restore-sequence)

### S-8: `server.ts` startup — Re-scoped

**Target state.** `server.ts` runs `await host.sessions.load()` before `Bun.serve`, and mounts `viewStateRoutes`.
`createAgentHost` stays synchronous.

**Behavior.** Preserving. Startup reads one file and writes nothing.

**Why.** `GET /api/sessions/current` must never see an empty `Sessions`.

**Depends on.** S-4, S-10.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-one-current-session-per-workspace),
[D-23](artifacts/change-decision-log.md#d-23-create-awaits-its-write-and-a-fresh-load-writes-nothing)

### S-9: `wire.ts` types `CurrentSession`, `ViewState`, `StoredDoc`, `TurnRecord`, `NotApplied` — Added

**Target state.** `src/shared/wire.ts` exports the five types exactly as pinned in Contract 2. It stays types-only with
no imports. `documents.tsx` types its `notApplied` state as `NotApplied[]`.

**Behavior.** Preserving. These are types only.

**Why.** The page and the server must agree on both new bodies. `wire.ts` is where cross-wire shapes live
([C-15](artifacts/current-state-findings.md#c-15-the-readmes-layout-rules-place-any-new-module)).

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-where-the-new-code-lives)

### S-10: `src/server/view-state/` (`view-state.ts`, `view-state.routes.ts`) — Added

**Target state.** A server feature folder `view-state/` exists:

- `view-state.ts` exports `loadViewState(workspace): Promise<ViewState>`, which returns the empty default when the file
  is missing or unreadable, and `saveViewState(workspace, view): Promise<void>`, which rejects when the write fails.
- `view-state.routes.ts` exports `viewStateRoutes(workspace): Hono` with `GET` and `PUT /api/view-state`, as pinned in
  Contract 3.

**Behavior.** Changing. This is a new route and a new file in the workspace.

**Why.** The view must survive a restart, so it has to live on the server
([C-12](artifacts/current-state-findings.md#c-12-the-browsers-own-storage-cannot-survive-a-server-restart-because-the-port-changes)).
It is kept out of the session record so that Clear Chat does not touch the editor.

**Depends on.** S-1, S-9.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-where-the-new-code-lives),
[D-19](artifacts/change-decision-log.md#trivial-decisions)

### S-11: `encodeUpdate` / `decodeUpdate` / `snapshotFromUpdate` in `markdown-editor.tsx` — Added

**Target state.** `markdown-editor.tsx` exports three helpers:

- `encodeUpdate(update: Uint8Array): string`, standard base64 with padding. It must handle updates of hundreds of
  kilobytes, so no spreading a whole array into `String.fromCharCode`.
- `decodeUpdate(text: string): Uint8Array`.
- `snapshotFromUpdate(update: Uint8Array): Snapshot`, which returns `{ update, vector: Y.encodeStateVectorFromUpdate(update) }`.

They sit beside `snapshot` and `mergeMarkdown`, the other code that knows the `Snapshot` shape.

**Behavior.** Preserving. New helpers.

**Why.** Stored docs and merge bases must round-trip through JSON with their Yjs identity intact
([C-7](artifacts/current-state-findings.md#c-7-an-opened-files-unsaved-state-is-yjs-history-not-markdown-and-markdown-cannot-stand-in-for-it)).

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-unsaved-changes-survive-a-reload)

### S-12: `useDocuments` — Re-scoped

**Target state.** `useDocuments` owns everything it owns today, and also:

- `restore(view: ViewState)` and `applyPending(messages)`, from Contract 6.
- `applyTurn(messageId, data: SessionData)`, the one path by which a finished turn's edits and highlights enter the
  editor.
- A `ViewState` writer that follows Contract 7.
- `mode` and `setMode`.
- The "could not load your saved editor state" and "changes are not saved to disk" notices.

`beginTurn` also records `turn` (`file`, plus the base64 `bases`) and triggers an immediate write. The hook returns
`mode`, `setMode`, `restore`, `applyTurn`, `applyPending`, and `restored`.

**Behavior.** Changing. A reload brings back the open file, unsaved changes, highlights, notices, and mode, which is
what the user asked for.

**Why.** The editor half of the request.

**Depends on.** S-9, S-11, S-13, S-14.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-unsaved-changes-survive-a-reload),
[D-5](artifacts/change-decision-log.md#d-5-a-reload-restores-the-confirmed-area),
[D-7](artifacts/change-decision-log.md#d-7-a-reload-mid-turn-lets-the-turn-finish-and-the-page-picks-it-up),
[D-15](artifacts/change-decision-log.md#d-15-only-unsaved-files-and-the-open-file-are-restored),
[D-21](artifacts/change-decision-log.md#d-21-the-turn-record-is-written-at-send-without-the-pause),
[D-22](artifacts/change-decision-log.md#d-22-restore-survives-missing-or-broken-pieces)

### S-13: `useDocuments`' `ensureLoaded` — Re-scoped

**Target state.** `ensureLoaded` loads each file at most once at a time. A load already in progress is awaited through a
`loading: Map<string, Promise<void>>` rather than started again. A failed load is removed from `loading`, so a later
call tries again.

**Behavior.** Preserving. It removes a race in which two loads of one file replaced the first `Entry`.

**Why.** Restore and a file-tree click can now load the same file at once
([C-14](artifacts/current-state-findings.md#c-14-the-pages-three-stateful-units-meet-only-in-app-through-callbacks-and-refs)).

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-the-page-load-restore-sequence)

### S-14: Editor mode state — Moved

**Target state.** The rendered/raw `mode` is state in `useDocuments`. `Editor` reads `docs.mode` and calls
`docs.setMode`. It still survives switching files, because the hook outlives the editor.

**Behavior.** Preserving.

**Why.** Mode must be written with the rest of the view.

**Decision.** [D-13](artifacts/change-decision-log.md#trivial-decisions)

### S-15: The leave-page warning — Re-scoped

**Target state.** Once restored, the `beforeunload` handler in `useDocuments` prevents unload while a `ViewState` write
is waiting, in flight, or has failed. Unsaved file changes alone no longer trigger it. If the view state could not be
loaded, it keeps today's rule: any unsaved file triggers it.

**Behavior.** Changing. Settled by the user's answer on unsaved changes.

**Why.** Unsaved changes no longer "exist only in this page".

**Depends on.** S-12.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-unsaved-changes-survive-a-reload)

### S-16: `useChatSession` — Re-scoped

**Target state.** `useChatSession` takes `chat: { id: string; messages: UIMessage[]; waiting: boolean } | undefined`
in place of `sessionId`, and passes `messages` to `useChat` as its seed. It returns `setMessages`, `waiting`, and
`setWaiting`. `busy` is true while `useChat` is submitting or streaming, or while `waiting`. `onTurnFinished` receives
`(messageId, data)`. The rest is unchanged, including the rule that a stopped, failed, or disconnected turn applies
nothing.

**Behavior.** Changing. A reloaded page shows the stored chat, and shows a turn that is still running as working.

**Why.** The chat half of the request.

**Depends on.** S-7.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-the-page-load-restore-sequence),
[D-7](artifacts/change-decision-log.md#d-7-a-reload-mid-turn-lets-the-turn-finish-and-the-page-picks-it-up)

### S-17: `App` — Re-scoped

**Target state.** `App` runs the restore sequence in Contract 6 instead of POSTing a session on mount. It watches
`turn-finished` and socket reconnects for a waiting chat. Clear Chat keeps today's order and ends by setting the chat to
`{ id, messages: [], waiting: false }`. `onTurnFinished` calls `docs.applyTurn(messageId, data)`.

**Behavior.** Changing. This is the user's requested behavior.

**Why.** `App` is the only file that wires features together
([C-15](artifacts/current-state-findings.md#c-15-the-readmes-layout-rules-place-any-new-module)).

**Depends on.** S-12, S-16.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-the-page-load-restore-sequence),
[D-20](artifacts/change-decision-log.md#d-20-a-waiting-page-re-checks-rather-than-trusting-one-event)

### S-18: `README.md` — Re-scoped

**Target state.** The README:

- Describes `components/json-file.ts`, `view-state/`, and the `.3pitor/` folder, including that it keeps itself out of
  git and that deleting it resets the saved session.
- Lists `GET /api/sessions/current` and `GET`/`PUT /api/view-state` in the endpoints table.
- Replaces "Nothing opens when the page loads" and "every file opened since the page loaded" with the restore behavior.
- Says that a chat now lasts until Clear Chat, and that Clear Chat is the way out of a conversation grown too long for
  the model.

**Behavior.** Preserving. Documentation only.

**Why.** The README is the layout standard, and it states the lifetimes this change alters.

**Decision.** [D-14](artifacts/change-decision-log.md#trivial-decisions)

## Behavior Changes

Each row is something the writer, or someone reading their folder, sees differently. Each was settled with the user.

| What the writer sees differently | Who notices | Decision |
| --- | --- | --- |
| A reload or server restart brings back the chat, the open file, highlights with their questions, "could not apply" notices, and the rendered/raw view. Before, the page came back empty with nothing open. A chat now lasts until Clear Chat. | The writer | Requested ("refreshing should reload the current file and the current chat session, with all the details"). [D-5](artifacts/change-decision-log.md#d-5-a-reload-restores-the-confirmed-area) |
| Unsaved typing and unsaved AI edits come back after a reload or restart, still marked unsaved. Undo can't reach back past the reload. | The writer | "go with recommendation". [D-2](artifacts/change-decision-log.md#d-2-unsaved-changes-survive-a-reload) |
| The "Leave site?" prompt no longer fires for unsaved changes. It fires only in the brief moment before a change has reached the disk, or after a write failed, and then the editor also says "Changes are not saved to disk". | The writer | Same answer, which stated the prompt would go away. [D-2](artifacts/change-decision-log.md#d-2-unsaved-changes-survive-a-reload), [D-18](artifacts/change-decision-log.md#d-18-a-failed-disk-write-reaches-its-caller-and-the-writer) |
| Reloading while the AI works shows the request, with the chat working and Send off. When the AI finishes, its reply, edits, and highlights arrive. Progress lines from before the reload are not shown while it works. | The writer | "go with recommended". [D-7](artifacts/change-decision-log.md#d-7-a-reload-mid-turn-lets-the-turn-finish-and-the-page-picks-it-up) |
| A server restart mid-turn shows that request as "stopped". | The writer | Stated in the same question. [D-12](artifacts/change-decision-log.md#d-12-a-server-restart-mid-turn-shows-the-turn-as-stopped) |
| A `.3pitor/` folder appears in the writing folder once they chat or open a file. It holds the chat and unsaved drafts. Git ignores it. | The writer, and anyone with the folder | "go with recommended" (location), "recommended" (git). [D-1](artifacts/change-decision-log.md#d-1-the-durable-copy-lives-in-the-workspaces-3pitor-folder), [D-24](artifacts/change-decision-log.md#d-24-3pitor-keeps-itself-out-of-git) |
| A turn that fails before it starts no longer leaves the chat refusing every later message with "already has a turn in progress". | The writer | "recommended". [D-11](artifacts/change-decision-log.md#d-11-a-turn-that-fails-to-start-ends-like-any-failed-turn) |

## Change Units

Every unit ends with `make test` passing. `bun run check` needs an API key and is a manual check, not a unit gate.

### Unit 1: An ordered, atomic JSON file writer

**What it does.** Adds `json-file.ts` with its unit tests.

**Delta entries.** S-1.

**How you know it worked.** Its tests pass:

- Several writes to one path, started without awaiting, leave the last value, and no `.tmp` file remains.
- A failed write rejects for its own caller, and a later write to the same path still succeeds.
- A missing or unparseable file reads as `undefined`.
- The first write creates `.3pitor/.gitignore` containing `*`.

Nothing calls it yet.

### Unit 2: `Sessions` records both histories, and every turn ends cleanly

**What it does.** This unit changes memory only, with no disk writes yet:

- Adds `uiMessages` to `Session`.
- Builds the user's UI message on the server.
- Adds `stoppedReply()`.
- Passes `originalMessages`, `tee()`s the stream, and holds the route's branch open on `recorded`.
- Moves clearing `abort` and emitting `turn-finished` into step 5's `finally`.

**Delta entries.** S-3, and S-6 without the disk writes.

**How you know it worked.** New `sessions.test.ts` cases, using `test-model.ts` and a real `EventBus`:

- **What is stored.** `uiMessages` after a completed, a stopped, and a failed turn. The stored user message has no
  open-file sentence, while the model prompt still does.
- **What the model sees.** After a stopped turn and a failed turn, the next turn's model prompt leaves both out. This
  pins that `messages` is unchanged.
- **Back-to-back turns.** As soon as a turn's stream has been read to the end, the next `chat()` on that session
  succeeds, and its prompt holds the previous reply.
- **The one-turn rule.** A second `chat()` while a turn is held throws "already has a turn in progress" synchronously.
- **Shared ids.** The assistant id in the route's stream equals the stored id.
- **Page gone.** A turn whose route branch is cancelled early still stores its closing `data-session` part.
- **Stuck sessions.** A rejecting `agentSettings` stores a stopped reply and leaves the session able to take the next
  turn.
- **The event.** `turn-finished` is emitted exactly once per turn, with the right `aborted`, after `uiMessages` holds
  the reply. Covered for completed, stopped, failed, and fail-before-start turns.

Existing `sessions.test.ts` cases pass unchanged. That includes the "no API key" case's exact `console.error` calls. If
the server's own stream reader adds a log line, that case must be told apart rather than loosened.

### Unit 3: The current session persists

**What it does.**

- Adds `current()` and `load()`.
- Makes `create()` async, with its write awaited.
- Writes the record at turn start and turn end.
- Marks an interrupted turn as stopped.
- Adds `GET /api/sessions/current` and the `CurrentSession` type.
- Awaits `load()` in `server.ts`.
- Adds a model-free scenario to `check.ts` that asserts `GET /api/sessions/current` answers 200.

**Delta entries.** S-2, S-4, S-5, S-6 (disk writes), S-7, S-8 (except the view-state mount), and `CurrentSession` from
S-9.

**Ordering constraint.** After Units 1 and 2. `create()` becoming async changes every `sessions.test.ts` case and the
route in this same unit.

**How you know it worked.** Tests:

- **Restart round trip.** A test builds `Sessions` on a temp workspace, runs a turn that includes a tool call, and waits
  for `turn-finished`. It then builds a second `Sessions` on the same workspace and calls `load()`. It gets the same id
  and both histories, and a second turn on the loaded session sends a prompt that holds the first turn.
- **Interrupted turn.** A record whose last UI message is the user's loads with a stopped reply after it.
- **Clear Chat mid-turn.** Start a held turn on session A, `create()` session B, then let A finish. `load()` on a second
  `Sessions` gets B, with empty lists.
- **Clear Chat on disk.** `POST /api/sessions` replaces `session.json` with the new id and empty lists.
- **Fresh workspace.** `load()` on an empty workspace writes nothing.
- **The route.** A `sessions.routes.test.ts` case with a stub whose `messages` and `uiMessages` differ. The body is
  `{ id, messages: <uiMessages>, running }`, `running` follows `abort`, and `abort` does not appear.

### Unit 4: Groundwork in `useDocuments`

**What it does.** Deduplicates `ensureLoaded`, and moves `mode` from `Editor` into `useDocuments`.

**Delta entries.** S-13, S-14.

**How you know it worked.** `documents.test.tsx` cases:

- Opening one file twice at once makes one `GET`.
- After a load fails, a later open tries again.
- Choosing Raw, then opening another file, leaves the editor in Raw.

### Unit 5: View state on the server, and Yjs encoding

**What it does.**

- Adds the remaining `wire.ts` types.
- Adds the `view-state/` feature and mounts its routes.
- Adds `encodeUpdate`, `decodeUpdate`, and `snapshotFromUpdate`.
- Extends the `check.ts` smoke scenario to `PUT` then `GET /api/view-state`.

**Delta entries.** S-9 (the rest), S-10, S-11, and the view-state mount in S-8.

**Ordering constraint.** After Unit 1.

**How you know it worked.**

- **Route tests.** `GET` with no file returns the default. A `PUT` answers `{ ok: true }`. A `GET` through a second
  `viewStateRoutes(workspace)` on the same workspace returns what was put. A failed write answers 500 with an `error`.
- **Merge test.** A `markdown-editor.test.tsx` case encodes a doc with typing and its `loadBase`, decodes both, and runs
  `mergeMarkdown` from the decoded base. The typing survives and the AI's change lands.
- **Size test.** One case encodes an update of a few hundred kilobytes.

### Unit 6: The chat comes back after a reload

**What it does.**

- `App` restores the chat from `GET /api/sessions/current` rather than POSTing on mount. There is no view-state fetch
  yet.
- `useChatSession` takes a seed and a waiting state.
- `App` watches `turn-finished` and reconnects for a waiting chat.
- `onTurnFinished` passes the message id. At this unit it still calls `applyEdited` and `showHighlights` directly.

**Delta entries.** S-16, and S-17 without the docs restore.

**Ordering constraint.** After Unit 3.

**Test scaffolding it must change.**

- **`app.test.tsx`.** The inline `fetch` mock answers only `POST /api/sessions` before falling through to the documents
  fake, so it must also answer `GET /api/sessions/current` from a stateful stub.
- **The socket stub.** The WebSocket stub (`class { close() {} }`) must become one the test can open, message, and
  close.
- **`chat.test.tsx`.** The `ChatFor` harness moves from `sessionId` to `chat`, and from `onTurnFinished(data)` to
  `onTurnFinished(id, data)`. Its three tests named in C-16 are updated to match.

**How you know it worked.** New `app.test.tsx` cases:

- **Restore.** A stored chat renders on mount with no `POST /api/sessions`. Sending posts to
  `/api/sessions/<restored id>/chat` with only the new text.
- **Waiting.** A `running: true` session shows "thinking…" with Send disabled. A `turn-finished` event for another
  session changes nothing. One for this session shows the reply.
- **Missed event.** A turn that ended before the socket's first open is still picked up.
- **Stop.** Stop while waiting POSTs `/api/sessions/<id>/cancel`.

At this unit, a turn that finishes while the page waits shows its reply but does not yet apply its edits. That is
today's behavior (C-9), not a regression. Unit 7 completes it.

### Unit 7: The editor comes back after a reload

**What it does.**

- Adds `restore`, `applyTurn`, `applyPending`, the `ViewState` writer, the turn record with its immediate write, and the
  two notices.
- Re-scopes the leave-page warning.
- Wires the view-state fetch, `docs.restore`, and `docs.applyPending` into `App`'s sequence and the waiting path.
- The `documents.test.tsx` fetch mock answers `/api/view-state`.

**Delta entries.** S-12, S-15, and the rest of S-17.

**Ordering constraint.** After Units 4, 5, and 6.

**How you know it worked.**

- **Replaced tests.** "nothing opens when the page loads" becomes two tests: "restores the open file, its unsaved
  changes, highlights, notices, and mode" and "a fresh workspace opens nothing". "leaving the page warns while any file
  has unsaved changes" becomes "leaving the page warns only while a view write is pending or failed".
- **Merge after restore.** Restore a doc whose turn base differs from its `loadBase`: type A, send, then type B. Apply
  an AI edit made from the sent text. A appears once, B survives, and the AI's change lands. This discriminates between
  the two bases.
- **Applied once.**
  - A turn applied live, followed by a restore of the same stored chat, is not applied again.
  - A reply that was never applied is applied on restore exactly once across two restores.
  - `applyTurn` produces one `PUT` holding both the edited docs and `appliedTurn`.
- **The writer.**
  - A burst of changes makes one `PUT` with the latest state.
  - A change during an in-flight `PUT` makes exactly one follow-up.
  - A failed `PUT` shows "Changes are not saved to disk" and keeps the prompt on until a later write lands.
  - After Save, the next body drops that file from `unsaved` and drops `untilSaved` highlights for it.
  - After a move, the next body uses the new names.
  - Timing is asserted only as "no `PUT` at once, one `PUT` eventually".
- **Restore failures.** A missing `current` file, and an `unsaved` entry that will not decode, are each dropped while
  the rest restores. A failed `GET /api/view-state` shows its notice, writes nothing, and keeps today's prompt rule.
- **The whole story.** In `app.test.tsx`: a waiting page gets `turn-finished`, and the edits reach the editor once.

### Unit 8: README

**What it does.** Carries out S-18.

**Delta entries.** S-18.

**How you know it worked.** A read-through: the README's endpoint table and layout lists match `server.ts` and the folder
tree.

## Risks

- **Two tabs, or two servers, on one workspace overwrite each other's state.** Whichever writes last wins, for both
  files. The README invites running several servers, and every `bun run server` in one checkout uses
  `src/.data/workspace`. Two dev servers there share one chat on disk, and a restart brings back whichever wrote last.
  Detectable by starting two servers and chatting in each. The damage is limited to chat history and `view.json`; the
  other tab's live page keeps its own state until it reloads.
- **A second tab's chat after Clear Chat in the first tab is not saved.** Only the current session is written, so tab B
  keeps chatting on the old session in memory, and its turns are gone once it reloads.
- **A file changed on disk while it had stored unsaved changes.** The restored doc wins, and Save overwrites the disk
  version, as it would today within one page load. There is no warning.
- **`session.json` and `view.json` grow, and each is rewritten whole.** `session.json` grows with every turn until Clear
  Chat, carrying each turn's full edited markdown and tool inputs. It is rewritten at every turn start and end, and
  `GET /api/sessions/current` returns all of it. `view.json` carries two base64 Yjs states per unsaved file, plus one
  per file in the turn record, and the whole state is re-sent on each debounced change. For blog posts this is at most
  a few megabytes. Detectable as a slow turn end or a slow page load.
- **A conversation too long for the model can no longer be escaped by reloading.** Each turn fails with the model's
  error, and only Clear Chat fixes it. The README says so (S-18).
- **The saved-while-the-AI-worked guard weakens across a reload.** `saves` restarts at 0 after a reload, and
  `turnSaves` is not stored. A file saved after Send and then reloaded, which the AI read from disk rather than from the
  sent documents, can merge from a stale base. This needs Send, then Save, then a reload, then a turn that finishes on a
  file not sent with the message.
- **The AI's Read tool can read `.3pitor/`** if it is told the path
  ([C-13](artifacts/current-state-findings.md#c-13-the-server-has-no-place-for-app-state-on-disk-the-workspaces-dot-folders-are-the-nearest-precedent)).
  The content is the writer's own chat and drafts.
- **Units 2 and 3 change the busiest file in the server.** `sessions.ts` has 8 commits in 90 days. The existing session
  tests, plus Unit 2's back-to-back and model-prompt tests, are the guard that turns still behave as before.

## Deferred (YAGNI)

### Schema version field in `session.json` and `view.json`

**Why deferred:** Evidence test. There is no second format, and an unreadable `session.json`, wrong shape included,
already falls back to a fresh start.
**Reopen when:** a change to either format ships while writers have files in the old one.
**Source:** software-architect.

### Keeping a copy of an unreadable `view.json` before it is overwritten

**Why deferred:** Evidence test. Writes are atomic, so only a hand edit or a sync conflict can make the file unreadable.
If one did, the default view would load and the first write would replace the only copy of the drafts.
**Reopen when:** the `readJson` warning is first seen in real use. The fix then is to rename the file to
`view.json.bad` before continuing.
**Source:** on-call-engineer (Y1).

### A shape check on `PUT /api/view-state`

**Why deferred:** Evidence test. This is defensive code at a trusted internal boundary: the app's own page is the only
writer, and restore drops pieces it cannot use.
**Reopen when:** something other than the page writes view state, or a malformed body is seen.
**Source:** junior-developer (JD-008).

### Flushing view state on `pagehide` with a `keepalive` request

**Why deferred:** Simpler-version test. The re-scoped leave-page prompt already covers the 300 ms window. The
`keepalive` body cap is 64 KB, which an unsaved doc can exceed.
**Reopen when:** the writer reports losing typing across a reload despite the prompt.
**Source:** software-architect.

### A list of past chats, or a way back to a cleared one

**Why deferred:** Evidence test. The user asked for "the current chat session".
**Reopen when:** the user asks to return to an earlier chat.
**Source:** this run.

### A `SessionStore` class, a storage interface, or a configurable state folder

**Why deferred:** Simpler-version test. Each would have one implementation, and no caller would set it.
**Reopen when:** a second storage location is required.
**Source:** software-architect.

### Showing a turn's live progress after a reload (a resumable stream)

**Why deferred:** Simpler-version test. The finished reply arrives without it, and nothing in the codebase stores a
stream today.
**Reopen when:** the writer asks to watch a turn's tool steps live after reloading.
**Source:** software-architect.

### An end-to-end restart scenario in `check.ts`

**Why deferred:** Simpler-version test. Unit 3's two-`Sessions` test runs the real AI SDK stream against the test model,
and the model-free smoke scenario (Units 3 and 5) covers the server wiring.
**Reopen when:** a persistence bug shows up that only a real server restart reproduces.
**Source:** software-architect; test-engineer.

### Size limits and cleanup: bounding `session.json`, capping the `PUT` body, removing orphaned `.tmp` files

**Why deferred:** Evidence test. There is no measured pressure. The model's context caps `messages`, and `view.json`
is tens of kilobytes.
**Reopen when:** a turn end or page load is measured to feel slow, or `.tmp` files are seen left behind.
**Source:** on-call-engineer (Y2, Y4).

### A restored stopped turn whose tool row still says "running"

**Why deferred:** Evidence test. A turn stopped mid-tool-call shows its tool row as "running" today too, in the live
page, so restoring it changes nothing.
**Reopen when:** the writer reports a restored chat that looks like it is still working.
**Source:** test-engineer (S5).

## Cut for Scope

- **The chat box's unsent draft.** It would bring back text typed into the chat box but not sent. The confirmed area
  (the scope the user agreed to) names "the chat panel and the chat history it shows", and the user answered "yes, that's it"
  ([scope-boundary.md](artifacts/scope-boundary.md#operator-stated-scope)). The draft was not in that list.
- **An open question or selection popup, and what was typed in it.** It would reopen the speech bubble. It is not in
  the confirmed area either.

The user can reinstate either one, and saying so is itself the justification the reinstated entry records.

## Open Items

- **Non-blocking: does `readUIMessageStream` on a `tee()` branch finish after the other branch is cancelled?** The AI SDK
  source was read and not run. Unit 2's "page gone" test settles it. If it fails, read the server's copy from a
  `TransformStream` passthrough instead, and Contract 5 does not change.
- **Non-blocking: the exact `UIMessage` a failed turn produces.** The panel restores whatever parts the stream carried.
  The error sentence `useChat` shows today is not a message part, so it does not come back after a reload. Unit 2's
  failed-turn test pins what is stored.
- **Non-blocking: whether `createUIMessageStream` emits `start` before a failing `execute`.** If it does not, step 5 has
  no message, and `stoppedReply()` is stored. Either way the chat shows the request as ended. Unit 2's
  fail-before-start test pins which.

## Review Findings

One round ran, with `han-core:junior-developer`, `han-core:test-engineer`, and `han-core:on-call-engineer`. After
merging duplicates, 21 findings remained. The ones that changed the plan:

- **An immediate Send after a reply could get "already has a turn in progress".** Raised by junior-developer (JD-001)
  and test-engineer. Moving the session's release to after the disk write opened a window between the page's stream
  closing and the session freeing up. Fixed by holding the page's stream open until the turn is recorded, and by keeping
  `messages` set where it is today. [D-17](artifacts/change-decision-log.md#d-17-the-routes-stream-closes-only-after-the-turn-is-recorded)
- **A failed disk write could lose a draft silently.** Raised by on-call-engineer (OCE-001). `writeJson` now rejects to
  its caller, the `PUT` answers 500, and the editor says so.
  [D-18](artifacts/change-decision-log.md#d-18-a-failed-disk-write-reaches-its-caller-and-the-writer)
- **The step-5 cleanup could skip the event, and the contracts disagreed on when `running` ends.** Raised by
  on-call-engineer (OCE-002). Step 5 is now `try`/`catch`/`finally`, and Contract 3 and S-3 agree with it.
- **`PUT` answering 204 would break `api()`.** Raised by test-engineer. It now answers `{ ok: true }`.
  [D-19](artifacts/change-decision-log.md#trivial-decisions)
- **A waiting page could miss `turn-finished` and wait forever.** Raised by on-call-engineer (OCE-003) and
  test-engineer. It now re-checks after setting `waiting` and on every connect, first open included.
  [D-20](artifacts/change-decision-log.md#d-20-a-waiting-page-re-checks-rather-than-trusting-one-event)
- **The turn record could be 300 ms stale at a reload right after Send.** Raised by on-call-engineer (OCE-004). Send's
  write skips the pause. [D-21](artifacts/change-decision-log.md#d-21-the-turn-record-is-written-at-send-without-the-pause)
- **Restore had no failure path.** Raised by junior-developer (JD-007) and on-call-engineer (OCE-005). Each piece now
  fails on its own, and a failed view fetch turns the writer off.
  [D-22](artifacts/change-decision-log.md#d-22-restore-survives-missing-or-broken-pieces)
- **Move and delete were missing from the write triggers.** Raised by junior-developer (JD-003). Any change to the
  computed view now writes. Contract 7.
- **Startup wrote a session in folders nobody chats in, and `create()`'s signature was unpinned.** Raised by
  junior-developer (JD-004, JD-012), on-call-engineer, and test-engineer. `load()` no longer writes, and `create()` is
  async. [D-23](artifacts/change-decision-log.md#d-23-create-awaits-its-write-and-a-fresh-load-writes-nothing)
- **`.3pitor/` in git.** Raised by junior-developer (JD-005). Escalated, and the user chose to have it ignore itself.
  [D-24](artifacts/change-decision-log.md#d-24-3pitor-keeps-itself-out-of-git)
- **A fail-before-start turn left a request with no reply.** Raised by on-call-engineer (OCE-006). It now gets
  `stoppedReply()`.
- **Two servers on one workspace is real, per the README.** Raised by junior-developer (JD-002). The risk is raised, and
  the process id in the temp name is kept with the README as its evidence.
- **Test coverage.** Raised by test-engineer. Units 2–7 gained the back-to-back, model-prompt, event, Clear Chat
  mid-turn, discriminating-merge, applied-once, writer, and restore-failure tests. The scaffolding Unit 6 must change is
  named. Unit 6 no longer fetches view state before Unit 5 exists.
- **Moved to Risks or the README.** Growth of `session.json` (JD-010), the second tab after Clear Chat (JD-011), and the
  lost reload escape from an over-long conversation (OCE-007).

Findings closed without a change:

- **The leave-page change and the cost of letting a turn finish may not have been shown to the user** (JD-006). The
  recorded questions did carry both: "The 'Leave site?' prompt goes away, since leaving no longer loses anything" and
  "This is the bigger of the two options". D-2 and D-7 now quote them.
- **Deferred as YAGNI candidates:** the `PUT` shape check (JD-008), the non-deterministic partial-read test, the
  redundant one-`Entry` assertion, automating the README check, and size limits (on-call Y1, Y2, Y4).

No finding was labeled `Unverified` with blocking severity. Findings that rested on uninspected AI SDK timing are
carried as the three Open Items, each with the test that settles it.

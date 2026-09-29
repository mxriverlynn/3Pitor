# Change Decision Log: Session Persistence Across Reload

This file records every decision committed while planning Session Persistence Across Reload. The plan itself lives in
[../change-plan.md](../change-plan.md). Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings. The recorded boundary is
[scope-boundary.md](scope-boundary.md).

## Trivial decisions

- D-13: Editor mode moves into `useDocuments` — `mode` becomes hook state so it is written with the rest of the view;
  `Editor` reads and sets it through `docs`. — Referenced in plan: Surface Delta (S-14).
- D-19: `PUT /api/view-state` answers `{ ok: true }` — it answers 200 with `{ "ok": true }` like the documents routes,
  not 204, because `api()` parses every OK body as JSON (test-engineer review). — Referenced in plan: Target State
  (Contract 3), Surface Delta (S-10), Review Findings.
- D-14: The README is updated with the change — its layout lists, endpoint table, and the lifetimes it states ("Nothing
  opens when the page loads") follow the new behavior, plus a note to git-ignore `.3pitor/`. — Referenced in plan:
  Surface Delta (S-18).

## Full decisions

### D-1: The durable copy lives in the workspace's `.3pitor` folder

- **Question:** Where does state that must survive a server restart live?
- **Decision:** On the server's disk, in `<workspace>/.3pitor/`, as two files: `session.json` and `view.json`. Paths
  come from `stateFile(workspace, name)` in `src/server/components/json-file.ts`.
- **Rationale:**
  - Browser storage cannot survive a restart, because the port changes and so does the origin.
  - A folder inside the workspace moves with it, needs no hashing or home-folder path, and works the same for
    `bun run server`, a folder named on the command line, and the built binary.
  - `check.ts` resets its workspace, so check runs start clean with no extra seam.
  - It follows the `.claude/` precedent.
- **Evidence:** C-12, C-13; `workspace.ts` `resetWorkspace`; user input.
- **Behavior impact:** Changing. A `.3pitor/` folder appears in the writing folder. Asked: "where should the saved
  session live on disk?", with a `.3pitor` folder in the writing folder (recommended) or `~/.3pitor/`. User's answer,
  verbatim: "go with recommended".
- **Rejected alternatives:**
  - `~/.3pitor/<hash of workspace path>/`. Rejected because moving the folder orphans its session, and tests and
    `check.ts` would need an injected home folder, a configuration seam no production caller sets.
  - Browser `localStorage`. Rejected because it does not survive a restart on a new port (C-12).
  - `src/.data/`. Rejected because it does not exist beside a built binary's workspace (C-13).
- **Revisit criterion:** The writer reports `.3pitor/` getting committed or getting in the way in their repo.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-3, D-8, D-9, D-24
- **Referenced in plan:** Surface Delta (S-2), Behavior Changes

### D-2: Unsaved changes survive a reload

- **Question:** Should unsaved typing and unsaved AI edits come back after a reload or restart, and what happens to
  the leave-page prompt?
- **Decision:**
  - Each file with unsaved changes is stored as a `StoredDoc` (`name`, `saved`, base64 `doc`, base64 `loadBase`).
  - A restored file keeps its Yjs identity, so later AI edits still merge.
  - The `beforeunload` prompt fires only while a `ViewState` write is waiting, in flight, or has failed.
  - Undo history is not stored.
- **Rationale:**
  - The user asked for "anything else that was done" to come back, and AI edits land in the editor as unsaved changes.
    Without this, a restored chat says "edited post.md" while the editor shows the old text, and restored
    `untilSaved` highlights stop matching.
  - Markdown cannot stand in for the merge base (C-7), so the Yjs state is stored.
- **Evidence:** C-6, C-7, C-8; user input.
- **Behavior impact:** Changing. Unsaved changes come back after a reload, and the "Leave site?" prompt no longer fires
  just for them. Asked: "When you reload with changes you haven't saved yet, should they come back?", with "Bring them
  back (recommended)" or "Don't bring them back". The recommended option read, in part: "The 'Leave site?' prompt goes
  away, since leaving no longer loses anything. … What you'd give up: Undo can't reach back past the reload." User's
  answer, verbatim: "go with recommendation". The review round added the failed-write notice (D-18) to the same prompt
  rule.
- **Rejected alternatives:**
  - Store only file names, and reload files from disk. Rejected by the user. It also loses AI edits made just before a
    reload.
  - Store markdown instead of Yjs state. Rejected because a doc rebuilt from markdown is not an ancestor of the merge
    base, so the next AI merge duplicates or garbles text (C-7).
  - Remove the leave-page prompt entirely. Rejected because a change made in the last 300 ms, before the write, would be
    lost silently.
- **Revisit criterion:** `view.json` size becomes noticeable, or the writer asks for undo across a reload.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11, S-12, S-15
- **Dependent decisions:** D-7, D-10, D-15, D-18
- **Referenced in plan:** Target State (Contract 7), Surface Delta (S-11, S-12, S-15), Behavior Changes

### D-3: One current session per workspace

- **Question:** Which session does a loaded page resume, and what does `Sessions` keep?
- **Decision:**
  - `Sessions` tracks one current session: the last one created or loaded.
  - `load()` restores it from `session.json`, or creates one.
  - `create()` makes the new session current and overwrites the file (D-23 pins when).
  - The in-memory `Map` stays, and only the current session is written.
- **Rationale:**
  - The user asked for "the current chat session".
  - `check.ts` chats on an older session after creating newer ones, so the `Map` must keep older sessions usable in
    memory.
  - Writing only the current session keeps one file and no clean-up rule.
- **Evidence:** C-2; `check.ts` (older session used at line 201 after new sessions are created at 169); user input.
- **Behavior impact:** Changing (the conversation survives a restart), which is the requested behavior. Clear Chat
  dropping the old chat from disk is preserving from the writer's view, since it is already unreachable today.
- **Rejected alternatives:**
  - Replace the `Map` with a single session. Rejected because `check.ts` would break.
  - Store every session in its own file. Rejected because no caller reads old sessions (see Deferred).
- **Revisit criterion:** A list of past chats is requested.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-5, S-8
- **Dependent decisions:** D-6, D-23
- **Referenced in plan:** Surface Delta (S-4, S-5, S-8)

### D-4: Store both histories

- **Question:** What does the server store so the chat panel can be rebuilt, and how does it get it?
- **Decision:**
  - `Session` gains `uiMessages: UIMessage[]` beside `messages: ModelMessage[]`.
  - The server builds the user's UI message itself.
  - The assistant's UI message is taken from a `tee()` of the turn's stream, read on the server with
    `readUIMessageStream`.
  - `createUIMessageStream` gets `originalMessages: session.uiMessages`, so its `start` chunk carries the assistant
    message id, and the page and the server see the same id.
  - Every turn enters `uiMessages`. Only completed turns enter `messages`, as today.
  - The lifecycle order is pinned in the plan's Contract 5.
- **Rationale:**
  - The panel's parts (`data-task`, `data-session`, tool states, stopped and failed turns) do not exist in
    `ModelMessage`, and the AI SDK has no converter back (C-4).
  - `onEnd` fires early when the client cancels, carrying a partial message that can miss `data-session`, so it cannot
    be the source. The server's own branch reads to the end.
  - A shared id is what lets `appliedTurn` (D-7) name a turn both sides agree on.
- **Evidence:** C-3, C-4, C-5, C-9; the software-architect's reading of `createUIMessageStream` and
  `handleUIMessageStreamFinish` in `node_modules/ai`.
- **Behavior impact:** Preserving for the model, whose `messages` are unchanged. The stream's `start` chunk now carries
  a server-chosen `messageId`, which `useChat` already honors.
- **Rejected alternatives:**
  - Store only `uiMessages`, and rebuild `messages` with `convertToModelMessages`. Rejected because the stored UI list
    drops the per-turn open-file sentence and keeps stopped turns, so the model's history would change.
  - Rebuild the display from `messages`. Rejected because too much is lost (C-4).
  - Use `createUIMessageStream`'s `onEnd`. Rejected because of the early cancel described above.
  - Have the page PUT its messages. Rejected because a page that reloaded mid-turn never has the reply.
- **Revisit criterion:** The AI SDK adds a supported server-side message persistence hook that survives client cancel.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-6
- **Dependent decisions:** D-7, D-16, D-17
- **Referenced in plan:** Target State (Contracts 1 and 5), Surface Delta (S-3, S-6)

### D-5: A reload restores the confirmed area

- **Question:** What exactly comes back after a reload?
- **Decision:** The chat history, a turn's running state, the open file, unsaved changes (D-2), highlights with their
  labels and questions, the "could not apply" notices, and the rendered/raw mode. Not the chat draft or an open popup
  (Cut for Scope).
- **Rationale:** This is the area the user confirmed.
- **Evidence:** scope-boundary.md (Stated Scope, Operator-Stated Scope); C-1, C-6.
- **Behavior impact:** Changing. A reload no longer returns an empty page with nothing open. The user's request is the
  decision: "refreshing should reload the current file and the current chat session, with all the details -
  highlights, feedback from the editor, or anything else that was done". Their confirmation of the area: "yes, that's
  it".
- **Rejected alternatives:**
  - Also restore the draft and popups. Rejected because they are outside the confirmed area; see Cut for Scope.
- **Revisit criterion:** The user reinstates a cut item.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** D-15
- **Referenced in plan:** Surface Delta (S-12), Behavior Changes

### D-6: The page-load restore sequence

- **Question:** In what order does a loaded page rebuild itself, and how does it avoid the load races?
- **Decision:** The ordered sequence in the plan's Contract 6.
  - There is no `POST /api/sessions` on mount.
  - `GET /api/sessions/current` and `GET /api/view-state` are fetched in parallel.
  - Docs restore first. Then the chat's id and seed are set in one state update. Then any pending turn is applied.
    Only then are writes enabled.
  - `ensureLoaded` deduplicates in-flight loads.
- **Rationale:**
  - Removing the mount POST removes the race between it and Clear Chat.
  - `useChat` reads its `messages` seed only when `id` changes, so the two must be set together.
  - Enabling writes only after restore stops the empty initial state from overwriting `view.json`.
  - Restore and a file-tree click can load one file at once, and today the second load replaces the first `Entry`.
- **Evidence:** C-2, C-14; K-9; the software-architect's reading of `useChat` (`useMemo` on the chat id in
  `node_modules/@ai-sdk/react/dist/index.js`).
- **Behavior impact:** Changing, as part of D-5. The `ensureLoaded` change is preserving (it removes a race).
- **Rejected alternatives:**
  - Keep the mount POST and switch sessions after restore. Rejected because it keeps the race and leaks a session per
    load.
  - Seed `useChat` with `setMessages` after mount. Rejected for the first load, because the `id` change already rebuilds
    the chat. `setMessages` is used only for the waiting path, where the id does not change.
- **Revisit criterion:** `@ai-sdk/react` changes when it reads the `messages` seed.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-13, S-16, S-17
- **Dependent decisions:** D-7
- **Referenced in plan:** Target State (Contract 6), Surface Delta (S-7, S-13, S-16, S-17)

### D-7: A reload mid-turn lets the turn finish, and the page picks it up

- **Question:** What happens to a turn that is running when the page reloads?
- **Decision:** The turn keeps running on the server, and its full reply is recorded (D-4).
  - `GET /api/sessions/current` reports `running`.
  - The page shows the chat as waiting, with Send disabled and Stop enabled.
  - On `turn-finished` for its session, or on a socket reconnect, the page re-fetches the session, sets its messages,
    and applies the turn.
  - Which turn has been applied is recorded as `appliedTurn` in `view.json`, in the same write as the edits it brought
    in, so no turn is applied twice or skipped.
  - The merge bases taken at Send are stored as `ViewState.turn`, so edits can still merge after a reload.
- **Rationale:** The user asked for "current status" to come back. A running turn's status is "still working", and
  stopping it would discard the AI's work.
- **Evidence:** C-5, C-7, C-9, C-10; user input.
- **Behavior impact:** Changing. Asked: "what happens if you reload while the AI is still working?", with "Let it finish
  and pick it up (recommended)" (noting that live progress lines don't show after the reload) or "Stop it when you
  reload". The recommended option said: "This is the bigger of the two options." User's answer, verbatim: "go with
  recommended".
- **Rejected alternatives:**
  - Stop the turn on reload. Rejected by the user. The software-architect preferred it for size.
  - A separate `POST /api/sessions/:id/applied` route to confirm delivery. Rejected because it leaves a window between
    applying and confirming. Writing `appliedTurn` in the same `ViewState` as the applied edits has no such window.
  - A resumable stream. Deferred; see the plan.
- **Revisit criterion:** The writer asks to watch progress live after a reload.
- **Dissent (if any):** The software-architect recommended stopping the turn, citing size. The user chose otherwise, and
  the plan carries the architect's cost list as Units 6 and 7.
- **Settles delta entry:** S-6, S-12, S-16
- **Dependent decisions:** D-12, D-20, D-21
- **Referenced in plan:** Target State (Contract 6), Surface Delta (S-6, S-12, S-16), Behavior Changes

### D-8: Where the new code lives

- **Question:** Which folders do the new pieces go in?
- **Decision:**
  - `src/server/components/json-file.ts`, with two server features as callers.
  - A new server feature `src/server/view-state/`, with `view-state.ts` and `view-state.routes.ts`.
  - The five types in `src/shared/wire.ts`.
  - The encoding helpers in `markdown-editor.tsx`.
  - Session persistence inside `sessions.ts`, with no store class.
- **Rationale:**
  - The README's placement rules (C-15). Shared-by-features code goes in `<package>/components/`.
  - Each server feature has a domain file and a routes file.
  - `wire.ts` holds cross-wire types.
  - A separate store class for one caller fails the simpler-version test.
- **Evidence:** C-15, README.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Put view state in `src/server/documents/`. Rejected because it would split that single-component feature into
    component folders under the README's rule, moving `documents.ts`.
  - Put view state inside `session.json`. Rejected because Clear Chat would then have to carry the editor's state into
    the new record, coupling chat to the editor.
  - A `SessionStore` class or a storage interface. Rejected because it has one implementation.
- **Revisit criterion:** The UI grows a separate view-state component, which would make the shared feature name
  worthwhile on both sides.
- **Dissent (if any):** The software-architect noted the README prefers one feature name across packages. The UI half
  stays inside `documents`, so the names differ. Recorded, and accepted.
- **Settles delta entry:** S-9, S-10
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Surface Delta (S-9, S-10)

### D-9: Writes to one file are serialized and atomic

- **Question:** How are disk writes ordered and protected?
- **Decision:** As pinned in the plan's Contract 4:
  - `JSON.stringify` runs at call time.
  - Each path has its own promise chain.
  - Each write goes to a temp file named with the process id, then `rename`s onto the path.
  - A failed write is logged, and the chain carries on.
- **Rationale:**
  - Turn start, turn end, `create()`, and view PUTs can overlap. Without ordering, an older write can land last (C-11).
  - Temp-then-rename means a crash never leaves half a file.
  - The process id in the temp name keeps two servers on one workspace from colliding on the temp file.
- **Evidence:** C-11, C-12; README "Run it" ("you can run several at once"); junior-developer JD-002.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - A file lock between processes. Rejected because two servers on one workspace is possible (the README invites
    several servers, and `bun run server` always uses `src/.data/workspace`) but its damage is limited to chat history
    and view state, so last-writer-wins is accepted and raised in Risks.
  - Append-only logs. Rejected because nothing reads history, and a whole-file rewrite is simpler.
- **Revisit criterion:** The writer reports two servers' chats overwriting each other.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** D-18
- **Referenced in plan:** Target State (Contract 4), Surface Delta (S-1)

### D-10: The page writes view state after a short pause

- **Question:** When does the page send `ViewState`?
- **Decision:** 300 ms after the last change (a literal), one `PUT` in flight at a time, one follow-up for changes made
  meanwhile, and a retry on the next change after a failure.
- **Rationale:** Typing produces a Yjs update per keystroke, and a pause keeps that to a handful of requests. One
  request in flight keeps them in order without the server needing to know.
- **Evidence:** C-7 (the `update` listener fires on every edit).
- **Behavior impact:** Preserving on its own. The prompt that covers its window is D-2.
- **Rejected alternatives:**
  - Write on every change. Rejected because it floods the server while typing.
  - Flush on `pagehide` with `keepalive`. Deferred, because the 64 KB cap makes it unreliable and the prompt covers the
    same window.
  - A configurable delay. Rejected because no caller would set it.
- **Revisit criterion:** The writer reports losing typing across a reload.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contract 7)

### D-11: A turn that fails to start ends like any failed turn

- **Question:** Should the plan fix the pre-existing stuck-session defect?
- **Decision:** Yes. Clearing `session.abort` moves to the `finally` that ends the server's copy of the stream
  (Contract 5, step 5), which runs on every exit, including a rejecting `agentSettings`.
- **Rationale:** Once sessions persist and report `running`, a session stuck in `abort` would show "still working"
  forever after a reload. The fix falls out of the lifecycle the change needs anyway.
- **Evidence:** C-17; K-4; B-3.
- **Behavior impact:** Changing. Asked: "If the AI fails to start a turn, should the chat stay stuck?", with "Fix it as
  part of this change (recommended)" or "Leave it as it is". User's answer, verbatim: "recommended".
- **Rejected alternatives:**
  - Leave it. Rejected by the user. A reload would show "still working" forever.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contract 5), Surface Delta (S-6), Behavior Changes

### D-12: A server restart mid-turn shows the turn as stopped

- **Question:** What does the chat show for a turn the server was running when it stopped?
- **Decision:** `load()` sees a trailing user UI message, appends `stoppedReply()` (an assistant message holding only a
  `data-session` part with `aborted: true`), and writes the record. The same function supplies the reply for a turn
  whose stream produced no assistant message (Contract 5, step 5). `messages` is unchanged, as for any stopped turn.
- **Rationale:** The turn's work is gone with the process. Showing the request as "stopped" uses the display the panel
  already has for stopped turns, and matches the model's history.
- **Evidence:** C-3, C-4 (the panel renders "stopped" from `data-session`); D-7.
- **Behavior impact:** Changing. Presented to the user within the mid-turn question: "If the server itself restarts
  mid-turn, either way the AI's work is lost. The restored chat shows your request marked 'stopped'." User's answer,
  verbatim: "go with recommended".
- **Rejected alternatives:**
  - Show the request with no reply. Rejected because the panel would look like it is still waiting.
  - Drop the request from the history. Rejected because the writer would lose what they asked.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contract 1), Behavior Changes

### D-15: Only unsaved files and the open file are restored

- **Question:** Which of the files opened before a reload come back?
- **Decision:** Files with unsaved changes, from their stored state, and the open file, from its stored state or else
  from disk. A clean file that was open earlier but is not the open file is not restored, and reopens from disk when
  clicked.
- **Rationale:** A clean file's editor state is exactly its disk text, so storing it adds nothing the writer can see.
  Reopening it from disk also picks up any change made to it outside the app.
- **Evidence:** C-7 (`load` builds a clean entry from disk text); the user's words name "the current file".
- **Behavior impact:** Changing, as part of D-5.
- **Rejected alternatives:**
  - Store every opened file's name and reload each from disk. Rejected because it makes more requests for no
    difference the writer sees.
- **Revisit criterion:** A feature starts depending on the set of opened files, such as tabs.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contract 2), Surface Delta (S-12)

### D-16: `turn-finished` fires after the record is written

- **Question:** When is `turn-finished` emitted relative to the disk write?
- **Decision:** It is emitted after the turn's record is written (or its write has failed) and `abort` is cleared, in
  step 5's `finally` (Contract 5), so a failing write cannot skip it.
- **Rationale:** A waiting page answers `turn-finished` by fetching `GET /api/sessions/current`. It must see
  `running: false` and the reply.
- **Evidence:** C-5 (today it is emitted inside `execute`, before the stream closes); `check.ts` records events but
  does not assert on `turn-finished`, and the UI ignores it today.
- **Behavior impact:** Changing, slightly. The event fires a little later. No current consumer depends on its timing.
- **Rejected alternatives:**
  - A new event carrying the messages. Rejected because the existing event plus a GET does the job.
- **Revisit criterion:** A consumer needs the event before the write.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contract 5), Surface Delta (S-6)

### D-17: The route's stream closes only after the turn is recorded

- **Question:** How does moving the session's release to after the disk write avoid a 409 for an immediate next Send?
- **Decision:**
  - `session.messages` stays set inside `execute`, exactly where it is today.
  - The route's branch of the `tee()` passes through a `TransformStream` whose `flush` awaits `recorded`, the promise
    step 5 resolves in its `finally`.
  - The page's stream therefore closes only after the reply is stored, `abort` is cleared, and `turn-finished` is
    emitted.
- **Rationale:**
  - Today `abort` clears before the page's stream closes (C-11).
  - `sessions.test.ts` runs turns back to back, and so do `check.ts` and a writer pressing Send the moment a reply
    finishes.
  - Holding the stream open keeps that ordering while still letting the server's copy finish when no page is
    listening.
- **Evidence:** C-11; junior-developer JD-001; test-engineer Unit 2 review; `sessions.test.ts` "a second turn sends the
  conversation so far".
- **Behavior impact:** Preserving. A next Send after a finished stream succeeds, as today. The stream closes a little
  later, after a local file write.
- **Rejected alternatives:**
  - Let `chat()` wait for the previous turn's tail instead of refusing. Rejected because it changes the 409 contract,
    and turns would queue silently.
  - Clear `abort` before the record write. Rejected because `running` would read false before the reply is stored, and a
    waiting page could fetch a session without its reply.
- **Revisit criterion:** The AI SDK offers a server-side persistence hook that completes before the client stream
  closes.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contract 5), Surface Delta (S-6), Review Findings

### D-18: A failed disk write reaches its caller, and the writer

- **Question:** What happens when a write to `.3pitor/` fails?
- **Decision:**
  - `writeJson` returns a promise that rejects with the write's error. The per-path chain keeps a copy with a `.catch`
    attached, so later writes still run.
  - `PUT /api/view-state` and `POST /api/sessions` answer 500 `{ error }` on a failed write.
  - The turn-end write failure is logged, and step 5's `finally` still frees the session and emits the event.
  - The page keeps the leave-page prompt on while its last `PUT` has failed, and the editor shows "Changes are not
    saved to disk: {message}".
- **Rationale:** D-2 turns off the unsaved-changes prompt on the understanding that changes are on disk. A write that
  failed silently, from a full disk, a read-only or synced folder, or a `.3pitor` file in the way, would lose a draft at
  the next reload with no warning.
- **Evidence:** on-call-engineer OCE-001, OCE-002; C-8.
- **Behavior impact:** Changing, as part of D-2's prompt rule. The notice is new, and appears only after a failure.
- **Rejected alternatives:**
  - Log and swallow. Rejected because it loses drafts silently.
  - Retry on a timer. Rejected because no evidence shows transient failures here. The next change retries.
- **Revisit criterion:** The writer reports the notice for failures that fix themselves.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-12, S-15
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contracts 4 and 7), Surface Delta (S-1), Behavior Changes, Review Findings

### D-20: A waiting page re-checks rather than trusting one event

- **Question:** How does a page waiting on a turn that began before the reload avoid waiting forever?
- **Decision:**
  - After setting `waiting`, the page fetches `GET /api/sessions/current` once more (Contract 6, step 5).
  - While waiting, it also re-fetches on `turn-finished` for its session, and on every `connected` false-to-true
    change, the socket's first open included.
  - The handler reads `waiting` from a ref.
- **Rationale:** The turn can end between the page's first fetch and its socket opening. The event bus keeps no history
  (C-9; structural-analyst finding S-11), so that `turn-finished` is gone. A server restart while waiting sends none at
  all.
- **Evidence:** on-call-engineer OCE-003; test-engineer T6; `host-events.ts` exposes `connected`.
- **Behavior impact:** Preserving within D-7. It makes D-7's promised behavior hold.
- **Rejected alternatives:**
  - Poll on a timer. Rejected because the event plus the reconnect check covers every path that ends a turn.
  - Replay events on connect. Rejected because the bus would need history for one consumer.
- **Revisit criterion:** A waiting page is seen stuck.
- **Dissent (if any):** None.
- **Settles delta entry:** S-17
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contract 6), Surface Delta (S-17), Review Findings

### D-21: The turn record is written at Send without the pause

- **Question:** When is the turn record (the merge bases taken at Send) written?
- **Decision:** The write that `beginTurn` triggers skips the 300 ms pause and starts at once. It is not awaited before
  the chat message is sent. The leave-page prompt covers it while in flight.
- **Rationale:** D-7 exists for a reload mid-turn, and the likeliest moment is just after Send. A stale turn record
  would merge the AI's edit against an older base and could repeat the writer's typing.
- **Evidence:** on-call-engineer OCE-004; C-7.
- **Behavior impact:** Preserving. It is one extra local request per Send.
- **Rejected alternatives:**
  - Await the write before sending. Rejected because it adds a round trip to every Send, and the prompt already covers
    the gap.
  - Keep the pause. Rejected because of the stale-base risk above.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contract 7), Surface Delta (S-12), Review Findings

### D-22: Restore survives missing or broken pieces

- **Question:** What does the page do when part of the stored state cannot be restored?
- **Decision:**
  - Each piece of `docs.restore` succeeds or fails on its own. A failed piece is dropped and logged, and restore still
    reaches "restored".
  - Any `ensureLoaded` failure for `current` means the file is treated as gone.
  - If `GET /api/view-state` fails, the editor says so, the view writer stays off for that page load, and the prompt
    keeps today's rule.
  - If `GET /api/sessions/current` fails, the chat panel shows the error with Clear Chat enabled.
- **Rationale:**
  - A file deleted or renamed outside the app, in Finder or git, is ordinary.
  - A restore that throws would leave the page blank with Send disabled.
  - Turning the writer off after a failed fetch stops the empty default from overwriting stored drafts.
- **Evidence:** junior-developer JD-007; on-call-engineer OCE-005; `api.ts` drops the status code, so "gone" cannot be
  told apart from other failures.
- **Behavior impact:** Preserving within D-5. It keeps the restore from failing whole.
- **Rejected alternatives:**
  - Fail the whole restore and show an error. Rejected because one deleted file would lose everything else.
  - Match on the "was not found" message. Rejected because it is brittle, and every failure is handled the same way
    anyway.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contract 6), Surface Delta (S-12), Review Findings

### D-23: `create()` awaits its write, and a fresh `load()` writes nothing

- **Question:** When is `session.json` first written, and is `create()` synchronous?
- **Decision:**
  - `create(): Promise<Session>` resolves after its empty record is written, and rejects if the write fails.
    `POST /api/sessions` awaits it and answers 500 on failure.
  - `load()`'s fallback makes a fresh session in memory and writes nothing.
  - `.3pitor/` therefore appears only once the writer chats, clears the chat, or changes the view.
- **Rationale:**
  - A fire-and-forget write after Clear Chat could lose to a restart, bringing back the chat the writer cleared.
  - Awaiting it also gives tests a point to check the file.
  - Not writing on a fresh `load()` keeps a folder the writer only launched in untouched.
- **Evidence:** junior-developer JD-004, JD-012; test-engineer Unit 3 review; on-call-engineer's S-8 note.
- **Behavior impact:** Preserving for the writer. The signature change touches `sessions.routes.ts` and every
  `sessions.test.ts` case.
- **Rejected alternatives:**
  - Keep `create()` synchronous with an unawaited write. Rejected because of the restart race, and because the write
    races the tests' temp-folder cleanup.
  - Write on the `load()` fallback. Rejected because it creates `.3pitor/` in every folder the app starts in.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-5, S-8
- **Dependent decisions:** None
- **Referenced in plan:** Target State (Contract 1), Surface Delta (S-4, S-5, S-8), Review Findings

### D-24: `.3pitor` keeps itself out of git

- **Question:** How is `.3pitor/`, which holds the chat and unsaved drafts, kept out of the writer's git repo?
- **Decision:** `writeJson` writes `.3pitor/.gitignore` containing `*` if it does not exist yet, so git ignores the
  whole folder. The README says so.
- **Rationale:** Relying on a README note leaves every writer one `git add .` away from committing drafts and chat
  history. One line inside the folder protects every repo without touching the writer's own `.gitignore`.
- **Evidence:** junior-developer JD-005; user input.
- **Behavior impact:** Changing. Asked: "Should the .3pitor folder keep itself out of git?", with "Have it ignore itself
  (recommended)" or "Leave it to you". User's answer, verbatim: "recommended".
- **Rejected alternatives:**
  - A README instruction to add `.3pitor/` to the repo's `.gitignore`. Rejected by the user.
- **Revisit criterion:** The writer wants to commit their session.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** None
- **Referenced in plan:** What Changes, Target State (Contract 4), Surface Delta (S-1, S-2), Behavior Changes, Review
  Findings

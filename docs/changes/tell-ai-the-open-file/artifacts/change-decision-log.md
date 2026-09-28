# Change Decision Log: Tell the AI Which File Is Open

This file records every decision committed while planning this change. The plan itself lives in
[../change-plan.md](../change-plan.md). Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

## Trivial decisions

- D-9: Plan folder — the plan lives in `docs/changes/tell-ai-the-open-file/`, next to the earlier Anthropic API change
  plan; the user answered "that's fine". — Referenced in plan: Why This Change.
- D-10: Background jobs are unchanged — the user said "just the chat panel", so jobs keep needing the file named in the
  prompt. — Referenced in plan: What Changes, In One Paragraph; Cut for Scope.
- D-11: The AI is told the file's name, not sent the editor's text — settled by the confirmation turn: auto-save makes
  the file on disk match the editor, so the name is enough. — Referenced in plan: What Changes, In One Paragraph.

## Full decisions

### D-1: The open file reaches the model in the user turn

- **Question:** Where does the open file's name enter the model's prompt?
- **Decision:** `Sessions.chat(sessionId: string, text: string, openFile?: string)` builds the user turn as two text
  parts when `openFile` is given:
  ```ts
  { role: 'user', content: [
    { type: 'text', text },
    { type: 'text', text: `The file open in my editor is ${openFile}. When my message does not name a file, it means this file.` },
  ] }
  ```
  Without `openFile`, the turn stays `{ role: 'user', content: text }`.
- **Rationale:** `Sessions.chat` is the only server code that jobs never reach, and the user excluded jobs. The user turn
  is kept in the replayed history, so each turn keeps the file it was about when the user switches files mid-chat. The
  user's text stays in the first part, so the existing test that reads `content[0].text` still passes.
- **Evidence:** C-3, C-5, C-7, C-8, C-13; the architect's check of the vendored `ai` source
  (`node_modules/ai/dist/index.js:1673-1692`), which maps array parts one by one without merging them.
- **Behavior impact:** Changing. With a file named, the model acts on the open file when the request names none. The
  user asked for exactly this: "the AI should automatically be told which file i'm currently working in and do whatever
  command i said, against that current file."
- **Rejected alternatives:**
  - Add the file to `instructionsFor` or `agentSettings` — rejected because both are shared with jobs (C-7), and
    `agent.test.ts` pins the whole instructions string (C-13).
  - Override the system instructions per turn inside `Sessions.chat` — rejected because `sessions.ts` would have to
    rebuild or append to text `agentSettings` owns, and system text is not replayed per turn, so older turns lose their
    file.
  - Put the note in front of the user's text in one string — rejected because it changes `content[0].text` and breaks
    the test in C-13, and it is not simpler.
- **Revisit criterion:** The model is seen ignoring the note, or overriding a file the user named.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** D-2
- **Referenced in plan:** Target State; Surface Delta

### D-2: `openFile` is an optional field on the chat body

- **Question:** How does the open file cross from the browser to the server?
- **Decision:** `POST /api/sessions/:id/chat` takes `{ "text": string, "openFile"?: string }`, for example
  `{"text":"Fix the spelling","openFile":"notes.md"}`. The route passes `openFile` on only when it is a string that is
  not empty:
  ```ts
  const body = await c.req.json<{ text: string; openFile?: unknown }>();
  const openFile = typeof body.openFile === 'string' && body.openFile !== '' ? body.openFile : undefined;
  ```
  Anything else is ignored, and the turn runs with no note. The server does not check that the file exists.
- **Rationale:** An optional field keeps `check.ts`'s `{ text }` body and `sessions.test.ts`'s direct calls working
  with no change. The name is only prompt text, and the file tools still enforce the workspace boundary.
- **Evidence:** C-4, C-8, C-9.
- **Behavior impact:** Preserving for every existing caller. A body with only `text` behaves exactly as before.
- **Rejected alternatives:**
  - A required field — rejected because a missing required field fails inside the stream, not as an HTTP error (C-9),
    and it would break `check.ts`.
  - A shared `ChatRequest` type in `src/shared/wire.ts` — rejected under YAGNI: two writers, one of which sends the
    field; `wire.ts` holds no REST request shapes today (C-4).
  - Validating the name as an existing workspace file — rejected because the name reaches only the prompt, and the tools
    already refuse paths outside the workspace.
- **Revisit criterion:** A third client posts to the chat route, or the body gains a required field.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-3
- **Referenced in plan:** Target State; Surface Delta

### D-3: Chat gets the open file as two plain props

- **Question:** How does `Chat` learn the open file and save it, without importing the documents feature?
- **Decision:** `Chat` takes `openFile: string` and `saveOpenFile: () => Promise<void>`. `App` passes
  `openFile={docs.current}` and `saveOpenFile={docs.save}`, and keeps `key={sessionId}`. The name reaches the request
  through `sendMessage({ text }, { body: { openFile: file } })`, and `prepareSendMessagesRequest` copies
  `body?.openFile` into the request body next to `text`.
- **Rationale:** `app.tsx` is the only UI file that wires features together, and `chat.tsx` imports nothing from
  `documents.tsx` today. Plain props keep both true. The transport is memoized on `sessionId`, so a per-message value
  has to arrive through `sendMessage`.
- **Evidence:** C-1, C-2, C-6; junior-developer review JD-005.
- **Behavior impact:** Preserving on its own. The observable change comes from D-5 and D-6.
- **Rejected alternatives:**
  - Pass the whole `docs` object to `Chat` — rejected because `Chat` would then depend on the documents hook's full
    shape for two values.
  - A context provider or hook for editor state — rejected under YAGNI: one use.
  - Rebuild the transport when `openFile` changes — rejected because the transport is keyed to the session, and a
    per-message body exists for this.
  - A `useRef` the transport reads, as a fallback — rejected in review (JD-005): the vendored runtime merges
    `sendMessage`'s body into the one `prepareSendMessagesRequest` receives (C-6).
- **Revisit criterion:** A second piece of editor state has to reach the model.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-4
- **Dependent decisions:** D-4, D-5
- **Referenced in plan:** Target State; Surface Delta

### D-4: Capture the file name before saving

- **Question:** Which file is the AI told about if the user opens another file while the save runs?
- **Decision:** `Chat.send` captures the input text and `openFile` before awaiting `saveOpenFile()`, and sends the
  captured name.
- **Rationale:** The captured name is the file that was open when the user pressed Send, which is the file being saved.
  `docs.current` read after the save could be a different file (C-12).
- **Evidence:** C-12.
- **Behavior impact:** Preserving relative to the target: it keeps the AI told about the file the user was looking at
  when they pressed Send.
- **Rejected alternatives:**
  - Read `openFile` after the save — rejected because of C-12.
  - Keep document state per document, fixing C-12 at its source — rejected under YAGNI for this change; the capture
    covers what this change needs.
- **Revisit criterion:** The wrong document is ever seen marked as saved.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta

### D-5: Save the open file before sending

- **Question:** What does the AI read when the open document has unsaved edits?
- **Decision:** `Chat.send` awaits `saveOpenFile()` before `sendMessage`. A save that resolves without saving (the
  document was clean, or read-only because of markdown the editor cannot keep) still sends.
- **Rationale:** The user chose it, so the AI reads what the user sees. A clean or read-only document already matches
  the file on disk.
- **Evidence:** User input: "2: auto-save before sending the message to the AI"; C-11.
- **Behavior impact:** Changing. After pressing Send, the editor's "unsaved changes" label changes to "saved". The user
  decided this in the confirmation turn.
- **Rejected alternatives:**
  - Tell the AI the name only, and let it read the last saved copy — rejected by the user's answer.
  - Send the editor's unsaved text with the message — rejected because the user chose auto-save, which makes the file
    on disk current.
- **Revisit criterion:** Users are seen not wanting a save on every send.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** D-6, D-7, D-8, D-12, D-15
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-6: A failed save stops the send

- **Question:** If the auto-save fails when the user presses Send, is the message still sent?
- **Decision:** No. When `saveOpenFile()` rejects, `Chat` keeps the text in the box, shows the save error described in
  D-16, and does not call `sendMessage`.
- **Rationale:** Sending would have the AI work from an out-of-date copy. If it then edited the file, reloading would
  throw away the user's unsaved typing.
- **Evidence:** User input: "don't send"; C-10, C-11.
- **Behavior impact:** Changing. The user was asked: "If the auto-save fails when you press Send, should your message
  still go to the AI?" They answered verbatim: "don't send".
- **Rejected alternatives:**
  - Send anyway — rejected by the user.
- **Revisit criterion:** None named.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** D-16
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-7: A second Send during the save is ignored

- **Question:** What stops a second press of Send, or Enter, from sending twice while the save runs?
- **Decision:** `Chat` holds a `savingRef` (`useRef<boolean>`). `send` returns early while `savingRef.current` is true.
  It is set before `saveOpenFile()` is awaited and cleared on both outcomes. The Send button does not change: no
  disabled state and no "Saving…" label.
- **Rationale:** Awaiting the save opens a window that did not exist before, and a second press in it would send the
  message twice. A ref updates at once without waiting for a render, and nothing on screen needs to change.
- **Evidence:** C-11 (the save is an awaited network call); junior-developer review JD-008; UX review UX-5 and UX-8.
- **Behavior impact:** Preserving. Nothing on screen changes. A double press sends once, as a single press does today.
- **Rejected alternatives:**
  - A `saving` state with a disabled Send button reading "Saving…" (the draft) — rejected in review: disabling a
    focused button can drop keyboard focus (UX-5), the label flickers on a clean document where the save resolves at
    once (UX-8), and no evidence shows saves take long enough for a label to matter (JD-008).
  - No guard — rejected because a double press would send the message twice.
- **Revisit criterion:** Saves are seen to take noticeable time, which reopens the label.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Review Findings

### D-8: The agent's edits to the open file reload instead of raising the banner

- **Question:** What does the editor do when the AI edits the open file during a turn?
- **Decision:** No code change. Because D-5 leaves the document clean when the message is sent, `syncFromDisk` reloads
  the file after the turn instead of showing "The agent changed this file". It still shows the banner when the user
  typed during the turn.
- **Rationale:** `syncFromDisk` already reloads a clean document and warns about a dirty one (C-10). Auto-save changes
  which case applies.
- **Evidence:** C-10.
- **Behavior impact:** Changing. Before, a user with unsaved edits saw the banner and a Reload link that discarded their
  typing. Now the AI's edit loads in the editor. This follows directly from D-5, which the user chose.
- **Rejected alternatives:**
  - None considered; the behavior follows from existing code.
- **Revisit criterion:** None named.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None
- **Referenced in plan:** Surface Delta; Behavior Changes

### D-12: Send saves over changes the AI made to the open file

- **Question:** If the AI (or a finished background job) has changed the open file, and the user has unsaved typing in
  it, what does Send do?
- **Decision:** Send saves the user's version over the file on disk, then sends the message. `Chat` does not check
  `changedOnDisk`; `saveOpenFile()` behaves as the editor's Save button does today.
- **Rationale:** The user chose it. It matches what pressing Save does today when the banner shows.
- **Evidence:** User input: "Save my version and send."; C-10, C-11 (`save` checks only `dirty` and `unsupported`, and
  clears `changedOnDisk`); junior-developer review JD-001.
- **Behavior impact:** Changing. A user who presses Send while "The agent changed this file" shows loses the AI's edit
  on disk. The user was asked: "If the AI has already changed your open file, and you have unsaved typing in it, what
  should pressing Send do?" They answered verbatim: "Save my version and send."
- **Rejected alternatives:**
  - Stop and tell the user, sending nothing until they reload or save — rejected by the user.
- **Revisit criterion:** Users are seen losing AI edits they wanted to keep.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes; Risks; Review Findings

### D-13: The name is sent even when the file is not on disk

- **Question:** What is the AI told when the editor shows a file that does not exist on disk?
- **Decision:** The open file's name is sent regardless. No existence check in `Chat` or on the server.
- **Rationale:** The editor shows that name, so it is the file the user means. If they typed in it, auto-save creates
  it, as the Save button does today. If it is empty and absent, the AI's `Read` fails and it says so, which is an
  accurate answer. A check would add a request per send for a case that only arises in a workspace with no `notes.md`.
- **Evidence:** C-15; junior-developer review JD-002.
- **Behavior impact:** Changing, as part of S-1: the AI is told a file name that may not exist yet. Settled from the
  code rather than escalated, because it matches what the editor shows.
- **Rejected alternatives:**
  - Leave out `openFile` when the file is not on disk — rejected because `Chat` does not know, and learning it needs a
    request per send.
- **Revisit criterion:** Users are seen confused by the AI reporting a missing file.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Review Findings

### D-14: A follow-up after switching files means the newly open file

- **Question:** After the user switches files, which file does a follow-up that names none ("now make it shorter")
  refer to?
- **Decision:** The newly open file. The note's wording stays as pinned in D-1.
- **Rationale:** The user asked for requests to apply "against that current file". Switching files and then asking is
  the clearest signal of which file they mean. A narrower wording would make the common case less reliable to catch a
  rare one.
- **Evidence:** User's request, recorded in the scope boundary; junior-developer review JD-004.
- **Behavior impact:** Changing, as part of S-1. Settled from the user's request rather than escalated.
- **Rejected alternatives:**
  - Narrower wording, such as "when the request is about a file and names none" — rejected because it weakens the
    common case.
- **Revisit criterion:** The AI is seen editing the newly open file when the user meant the earlier one.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes; Review Findings

### D-15: Text typed during the save is kept

- **Question:** What happens to text typed into the chat box after pressing Send and before the save finishes?
- **Decision:** After a successful save, `Chat` clears the box only if it still holds the captured text:
  `setInput((current) => (current === text ? '' : current))`.
- **Rationale:** Today the box clears at once, so typing right after Enter is safe. Clearing unconditionally after an
  awaited save would erase that typing.
- **Evidence:** UX review UX-3; `src/ui/chat.tsx` `send` (clears the input immediately today).
- **Behavior impact:** Preserving in effect: nothing typed is lost, as today. The box clears a moment later than today.
- **Rejected alternatives:**
  - Clear at once and restore on failure — rejected because a restore could overwrite text typed during the save.
- **Revisit criterion:** None named.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Review Findings

### D-16: The save error sits in the composer and clears itself

- **Question:** Where does the save error show, what does it say, and when does it go away?
- **Decision:** `Chat` keeps `saveError: string | undefined`. On a failed save it is
  `Could not save ${file}, so the message was not sent. Try Send again.`, rendered inside `.composer` above the text
  box as `<div className="error" role="alert">`. It clears at the next Send and when `openFile` changes (an effect on
  `[openFile]`).
- **Rationale:** The transcript only scrolls when messages change, so an error in the transcript could be out of view.
  `role="alert"` makes a screen reader announce it. Clearing on file change stops it naming a file that is no longer
  open. "Try Send again." gives the next step.
- **Evidence:** UX review UX-1, UX-2, UX-6; `src/ui/chat.tsx` scroll effect keyed on `[messages]`.
- **Behavior impact:** Changing, as part of D-6, which the user chose.
- **Rejected alternatives:**
  - An error line in the transcript (the draft) — rejected because it can sit below the visible area.
  - Keeping the error until the next Send — rejected because it goes stale after a manual save or a file switch.
- **Revisit criterion:** None named.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Review Findings

### D-17: The empty-chat hint stops naming a file

- **Question:** The hint shown before the first message names `notes.md` three times. Does it change?
- **Decision:** It reads: `Try: "Fix the spelling and grammar", "Use the doc-stats skill", "Have the proofreader agent
  review this", or "Ask the title-writer agent for a better title". Requests that don't name a file apply to the file
  open in the editor.`
- **Rationale:** It is the only place in the chat panel that can tell the user about the new behavior. As it stands it
  teaches the habit the user asked to be rid of.
- **Evidence:** UX review UX-4; `src/ui/chat.tsx` empty-state hint.
- **Behavior impact:** Changing: the hint's text differs. Not escalated on its own; it is copy that follows from the
  user's request, and it is surfaced in the plan's summary so the user can reverse it.
- **Rejected alternatives:**
  - Leave the hint as it is (the draft's open item) — rejected because it teaches the old habit.
- **Revisit criterion:** The user asks for the old hint back.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes; Review Findings

### D-18: Two new test files pin the route and the save-then-send order

- **Question:** What automated tests prove the Preserving entries and the new ordering?
- **Decision:** Add `src/server/sessions.routes.test.ts`, following `workspace-config.routes.test.ts`, asserting what a
  stubbed `Sessions.chat` receives for `"notes.md"`, `""`, `42`, and a body with no `openFile`. Add
  `src/ui/chat.test.tsx`, following `agent-panel.test.tsx` (stubbed `globalThis.fetch`, happy-dom), with five tests:
  order, failure, double send, name capture, and error clearing on file change.
- **Rationale:** Nothing in `make test` touched the chat route or `chat.tsx` (C-14), so every guard in the plan could
  be weakened with `make test` still passing. `saveOpenFile` is a prop, so the UI test controls it directly without
  faking the documents request.
- **Evidence:** C-13, C-14; test-engineer review.
- **Behavior impact:** None; tests only.
- **Rejected alternatives:**
  - Rely on `bun run check` and manual checks — rejected because the check needs a live model and does not use the UI.
- **Revisit criterion:** None named.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-3
- **Dependent decisions:** None
- **Referenced in plan:** Change Units; Review Findings

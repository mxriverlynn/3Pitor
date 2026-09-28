# Change Plan: Tell the AI Which File Is Open

## Why This Change

Today the user has to name the file in every chat request, because the AI is never told which document is open in the
editor. The user asked for the AI to be told automatically, and for it to act on that file when a request names none.
This is **friction the user reports**, in their own words, recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md). No ticket exists.

## What Changes, In One Paragraph

After this change, each chat message carries the name of the document that was open when the user pressed Send. The
server adds one sentence to that chat turn, telling the model which file is open and that a request naming no file means
that file. Before sending, the chat panel saves the open document, so the AI reads what the user sees. That save happens
even when the AI changed the file in the meantime. If the save fails, the message is not sent. Background jobs do not
change.

## Current State

The chat turn has no input for the open file, at any layer. That is the structural property this change addresses.

The chat panel never receives the open document. `app.tsx` holds `docs`, which has the name and `save`, but passes it
only to `Files` and `Editor`
([C-1](artifacts/current-state-findings.md#c-1-the-chat-panel-is-never-given-the-open-document)).

Nothing in the code has any idea of a current file
([C-3](artifacts/current-state-findings.md#c-3-nothing-in-the-code-has-a-notion-of-a-current-file)).

The chat request body carries only the message text. The UI transport, the route, and the check script each write that
shape separately, with no shared type
([C-4](artifacts/current-state-findings.md#c-4-the-chat-request-body-is--text--written-separately-in-three-places-with-no-shared-type)).

On the server, `Sessions.chat` adds each user turn to a history that it keeps and replays on every turn
([C-5](artifacts/current-state-findings.md#c-5-sessionschatsessionid-text-has-two-callers-and-the-model-sees-each-user-turn-as-a-bare-string)).

Chat and background jobs share the code that builds the system prompt. The history inside `Sessions.chat` is the only
server code that jobs never reach
([C-7](artifacts/current-state-findings.md#c-7-the-prompt-builder-is-shared-by-chat-and-jobs-and-only-sessionschat-is-chat-only)).

The UI's document name, such as `notes.md`, already works as a tool path
([C-8](artifacts/current-state-findings.md#c-8-the-uis-document-name-is-a-valid-tool-path-as-it-stands)).

The editor's save has three properties this change depends on:

- It resolves without saving when there is nothing to save.
- It rejects on a network failure or a server error.
- It overwrites whatever is on disk, including edits the AI made
  ([C-11](artifacts/current-state-findings.md#c-11-save-resolves-the-same-way-whether-or-not-it-saved-and-it-can-reject)).

Its state is not kept per document, so switching files during a save can mix the two documents up
([C-12](artifacts/current-state-findings.md#c-12-switching-files-while-a-save-is-in-flight-can-mix-up-two-documents-state)).

## Target State

Five source files change, and two test files are added. There are no new types or modules. `agent.ts` and
`documents.tsx` do not change.

| File | What it is responsible for after the change |
| --- | --- |
| `src/ui/app.tsx` | Wiring only. Passes `docs.current` and `docs.save` into `Chat`. |
| `src/ui/chat.tsx` | Saves the open file, then sends the message with the file's name. Still does not import `documents.tsx`. |
| `src/server/sessions.routes.ts` | Reads the optional `openFile` from the body and hands it to `Sessions.chat`. |
| `src/server/sessions.ts` | Adds the open-file note to the user turn. |
| `src/server/scripts/check.ts` | Sends `openFile` in one new scenario. |
| `src/server/sessions.routes.test.ts` (new) | Pins how the route reads `openFile`. |
| `src/ui/chat.test.tsx` (new) | Pins the order of save and send. |

### Contract: the chat request body

The chat route takes the message text and, optionally, the open file's name
([D-2](artifacts/change-decision-log.md#d-2-openfile-is-an-optional-field-on-the-chat-body)). When `openFile` is
missing, not a string, or empty, the turn runs exactly as it does today, with no note and no error.

The server does not check that the file exists or that the name is a safe path. The name is only prompt text, and the
file tools still keep the model inside the workspace.

```
POST /api/sessions/:id/chat
{ "text": string, "openFile"?: string }

{ "text": "Fix the spelling", "openFile": "notes.md" }
```

The route reads it like this:

```ts
const body = await c.req.json<{ text: string; openFile?: unknown }>();
const openFile = typeof body.openFile === 'string' && body.openFile !== '' ? body.openFile : undefined;
return createUIMessageStreamResponse({ stream: sessions.chat(c.req.param('id'), body.text, openFile) });
```

### Contract: `Sessions.chat`

With an open file, the user turn is two text parts: the user's text first, then the note. Without one, the turn is the
plain string it is today
([D-1](artifacts/change-decision-log.md#d-1-the-open-file-reaches-the-model-in-the-user-turn)).

```ts
chat(sessionId: string, text: string, openFile?: string): ReadableStream

const userTurn: ModelMessage = openFile
  ? {
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'text', text: `The file open in my editor is ${openFile}. When my message does not name a file, it means this file.` },
      ],
    }
  : { role: 'user', content: text };
```

The server sends the note even when the file does not exist on disk. The editor can show a `notes.md` that is not there
yet, and the AI is told the name the user sees
([D-13](artifacts/change-decision-log.md#d-13-the-name-is-sent-even-when-the-file-is-not-on-disk)).

### Contract: what the model sees

Each turn in the replayed history keeps the file that was open when it was sent. The chat transcript on screen still
shows only the user's text, because the server adds the note.

For example, the user has `notes.md` open and sends "Fix the spelling". Later, with `ideas.md` open, they send "Shorten
the intro". The model sees:

```
system:    <instructionsFor output, unchanged>
user:      [text] Fix the spelling
           [text] The file open in my editor is notes.md. When my message does not name a file, it means this file.
assistant: ...tool calls and reply...
user:      [text] Shorten the intro
           [text] The file open in my editor is ideas.md. When my message does not name a file, it means this file.
```

A follow-up that names no file goes to the file open now. If the user switches to `ideas.md` and sends "now make it
shorter", the note points the AI at `ideas.md`, even if the user meant the earlier file. That is accepted
([D-14](artifacts/change-decision-log.md#d-14-a-follow-up-after-switching-files-means-the-newly-open-file)).

Skills and subagents get the file the same way everything else does: the main model reads the note and names the file
in what it passes on. A subagent sees only the prompt the main model writes for it, not the note.

### Contract: `Chat` props

`Chat` takes two more props, which `App` wires from the documents feature. The `key` stays `sessionId`, so opening
another file does not reset the conversation
([D-3](artifacts/change-decision-log.md#d-3-chat-gets-the-open-file-as-two-plain-props)).

```tsx
export function Chat({ sessionId, approvals, onTurnFinished, openFile, saveOpenFile }: {
  sessionId: string;
  approvals: Record<string, boolean>;
  onTurnFinished: () => void;
  openFile: string;                  // docs.current, e.g. "notes.md"
  saveOpenFile: () => Promise<void>; // docs.save; resolves without saving when clean or read-only
})

// app.tsx
<Chat key={sessionId} sessionId={sessionId} approvals={approvals} onTurnFinished={docs.syncFromDisk}
      openFile={docs.current} saveOpenFile={docs.save} />
```

The name reaches the request through `sendMessage`'s per-message body. That way the transport stays memoized on
`sessionId`. The AI SDK's runtime merges that body into the one `prepareSendMessagesRequest` receives
([C-6](artifacts/current-state-findings.md#c-6-usechats-sendmessage-can-carry-extra-body-fields-for-one-message)).

```ts
sendMessage({ text }, { body: { openFile: file } });

prepareSendMessagesRequest: ({ messages, body }) => {
  const last = messages.at(-1)!;
  return { body: { text: last.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''), openFile: body?.openFile } };
},
```

### Contract: the order of save and send

When the user sends a message, `Chat.send` runs these steps in order:

1. Return if the input is empty, a turn is running, or a save is running. The running save is tracked in a `useRef`
   flag, `savingRef`
   ([D-7](artifacts/change-decision-log.md#d-7-a-second-send-during-the-save-is-ignored)).
2. Capture the input text and `openFile` before anything is awaited
   ([D-4](artifacts/change-decision-log.md#d-4-capture-the-file-name-before-saving)).
3. Set `savingRef.current = true` and clear any earlier save error.
4. Await `saveOpenFile()`
   ([D-5](artifacts/change-decision-log.md#d-5-save-the-open-file-before-sending)). It saves even when the editor shows
   "The agent changed this file"
   ([D-12](artifacts/change-decision-log.md#d-12-send-saves-over-changes-the-ai-made-to-the-open-file)).
5. If the save rejects, set `savingRef.current = false`, show the save error, keep the text in the box, and stop
   ([D-6](artifacts/change-decision-log.md#d-6-a-failed-save-stops-the-send)).
6. Otherwise, set `savingRef.current = false` and call `sendMessage({ text }, { body: { openFile: file } })`. Then
   clear the box only if it still holds the captured text, so anything typed during the save is kept
   ([D-15](artifacts/change-decision-log.md#d-15-text-typed-during-the-save-is-kept)).

A save that resolves without saving still sends, because the file on disk already matches the editor. That happens when
the document was clean, or read-only.

The Send button does not change: no disabled state and no new label.

```ts
setInput((current) => (current === text ? '' : current));
```

### Contract: the save error

When the save fails, the chat shows one error line, and it clears on its own once it no longer applies
([D-16](artifacts/change-decision-log.md#d-16-the-save-error-sits-in-the-composer-and-clears-itself)):

- **State.** `Chat` keeps it as `saveError: string | undefined`.
- **Text.** `Could not save ${file}, so the message was not sent. Try Send again.`
- **Where it shows.** Inside the `.composer`, above the text box, so it stays in view however long the transcript is.
- **Screen readers.** The line has `role="alert"`, so a screen reader announces it.
- **When it clears.** At the next Send (step 3), and when `openFile` changes, through an effect on `[openFile]`.

```tsx
{saveError && <div className="error" role="alert">{saveError}</div>}
```

### Contract: the empty-chat hint

The hint shown before the first message stops naming `notes.md`. It also tells the user about the new behavior
([D-17](artifacts/change-decision-log.md#d-17-the-empty-chat-hint-stops-naming-a-file)):

```
Try: "Fix the spelling and grammar", "Use the doc-stats skill", "Have the proofreader agent review this", or "Ask the
title-writer agent for a better title". Requests that don't name a file apply to the file open in the editor.
```

## Surface Delta

### S-1: `Sessions.chat` — Re-scoped

**Target state.** `Sessions.chat(sessionId: string, text: string, openFile?: string): ReadableStream` runs one chat
turn. When `openFile` is given, the user turn it adds to the history is two text parts: the user's text, then
`The file open in my editor is {openFile}. When my message does not name a file, it means this file.` When `openFile` is
absent, the user turn is the plain string it was before.

**Behavior.** Changing. When a file is named, the model is told which file is open and acts on it when the request
names none. When no file is named, the turn is byte-identical to today. The user asked for this change in their
request, recorded in the scope boundary.

**Why.** It is the only chat-only place on the server. The history it builds is replayed on every turn, so each turn
keeps its own file.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-open-file-reaches-the-model-in-the-user-turn),
[D-13](artifacts/change-decision-log.md#d-13-the-name-is-sent-even-when-the-file-is-not-on-disk),
[D-14](artifacts/change-decision-log.md#d-14-a-follow-up-after-switching-files-means-the-newly-open-file)

### S-2: `POST /api/sessions/:id/chat` request body — Re-scoped

**Target state.** The body is `{ "text": string, "openFile"?: string }`. When `openFile` is a string that is not empty,
the route passes it to `Sessions.chat`. Any other value, or no value, is ignored, and the turn runs with no note.

**Behavior.** Preserving for every existing caller. A body with only `text` behaves as it does today, including the
existing failure modes for bodies the server cannot use. The new `sessions.routes.test.ts` pins this. No test covered
the route before.

**Why.** The open file has to cross from the browser to the server with each message.

**Depends on.** S-1.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-openfile-is-an-optional-field-on-the-chat-body)

### S-3: `Chat` component — Re-scoped

**Target state.**

- `Chat` takes two more props: `openFile: string` and `saveOpenFile: () => Promise<void>`.
- When the user sends a message, `Chat` saves the open file first. It saves even when the AI changed the file. Then it
  sends the message with `openFile` in the request body.
- If the save fails, the message is not sent. The text stays in the box, and an error line appears above it. That line
  clears at the next Send or when another file is opened.
- A second Send while the save runs is ignored.
- Text typed during the save stays in the box.
- The empty-chat hint no longer names a file.
- `Chat` still does not import `documents.tsx`.

**Behavior.** Changing:

- Pressing Send now saves the open document, even over edits the AI made to it.
- A failed save stops the message.
- Because the document is saved before the turn, an edit the AI makes to it loads in the editor. The "The agent changed
  this file" banner no longer appears, unless the user typed during the turn.
- The empty-chat hint reads differently.

The user chose auto-save, chose not to send on a failed save, and chose to save over the AI's changes. The hint change
was not asked about on its own.

**Why.** The chat panel is where the message is sent, so it owns the order of save and send.

**Depends on.** S-2.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-chat-gets-the-open-file-as-two-plain-props),
[D-4](artifacts/change-decision-log.md#d-4-capture-the-file-name-before-saving),
[D-5](artifacts/change-decision-log.md#d-5-save-the-open-file-before-sending),
[D-6](artifacts/change-decision-log.md#d-6-a-failed-save-stops-the-send),
[D-7](artifacts/change-decision-log.md#d-7-a-second-send-during-the-save-is-ignored),
[D-8](artifacts/change-decision-log.md#d-8-the-agents-edits-to-the-open-file-reload-instead-of-raising-the-banner),
[D-12](artifacts/change-decision-log.md#d-12-send-saves-over-changes-the-ai-made-to-the-open-file),
[D-15](artifacts/change-decision-log.md#d-15-text-typed-during-the-save-is-kept),
[D-16](artifacts/change-decision-log.md#d-16-the-save-error-sits-in-the-composer-and-clears-itself),
[D-17](artifacts/change-decision-log.md#d-17-the-empty-chat-hint-stops-naming-a-file)

### S-4: `App` wiring of `Chat` — Re-scoped

**Target state.** `App` passes `openFile={docs.current}` and `saveOpenFile={docs.save}` to `Chat`, alongside the props
it passed before. `App` remains the only UI file that knows about both the chat and documents features.

**Behavior.** Preserving on its own. It only connects values that already exist, and S-3 ships in the same unit. All
of the observable change belongs to S-3.

**Why.** The convention in `app.tsx` is that state crossing features is wired there and nowhere else
([C-2](artifacts/current-state-findings.md#c-2-apptsx-is-the-only-ui-file-that-wires-features-together-and-chattsx-does-not-import-documentstsx)).

**Depends on.** S-3.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-chat-gets-the-open-file-as-two-plain-props)

## Behavior Changes

Six things a person using the app will notice. In each item, the observer is the person using the app.

- **The AI acts on the open file.** Someone with `notes.md` open types "fix the grammar" and gets `notes.md` fixed,
  without naming it. A request that names another file still means that file. After switching files, a follow-up like
  "make it shorter" means the newly open file. Decision: the user's original request (S-1, D-14).
- **Send saves the open document.** After pressing Send, the editor's "unsaved changes" label changes to "saved".
  Decision: the user chose auto-save (S-3, D-5).
- **Send saves over the AI's changes.** Suppose the editor shows "The agent changed this file" and the user presses
  Send. Their version overwrites the AI's edit on disk, then the message goes out. The same happens if a finished
  background job changed the file. Decision: the user answered "Save my version and send." (S-3, D-12).
- **A failed save stops the message.** The message stays in the box. Above it, the chat shows "Could not save
  notes.md, so the message was not sent. Try Send again." Decision: the user answered "don't send" (S-3, D-6).
- **The AI's edits to the open file load without the banner.** The document is clean when the message is sent, so an
  edit the AI makes to it now loads in the editor. Before, a user with unsaved edits saw "The agent changed this file"
  and a Reload link that discarded their typing. This follows directly from auto-save (S-3, D-8).
- **The empty-chat hint no longer names a file.** It ends with "Requests that don't name a file apply to the file open
  in the editor." This was decided in review and not asked about on its own. The user can reverse it (S-3, D-17).

## Change Units

### Unit 1: The server accepts and uses the open file

**What it does.** The chat route reads the optional `openFile`, and `Sessions.chat` adds the note to the user turn. The
UI does not send `openFile` yet, so nothing a person sees changes.

**Delta entries.** S-1, S-2.

**How you know it worked.**

- The existing test "a second turn sends the conversation so far" in `sessions.test.ts` passes unchanged.
- `sessions.test.ts` gets a new test. It calls `turn()` with `openFile: 'notes.md'` and asserts the user turn is
  exactly the two parts in the `Sessions.chat` contract. A second assertion checks that a turn without `openFile` has
  one part and no note.
- A new `sessions.routes.test.ts` follows the pattern in `workspace-config.routes.test.ts`. It stubs a `Sessions`-shaped
  object and asserts what `chat` receives: the name for `"notes.md"`, and `undefined` for `""`, for `42`, and for a
  body without `openFile`
  ([D-18](artifacts/change-decision-log.md#d-18-two-new-test-files-pin-the-route-and-the-save-then-send-order)).
- `check.ts` gets a new scenario, "chat acts on the open file". It sends
  `{ text: 'Reply with only the H1 heading of this file.', openFile: 'notes.md' }` and expects the reply to match
  `/garden plan/i`. For this, `check.ts`'s helper becomes
  `chat(sessionId: string, text: string, onChunk?: (chunk: Chunk) => void, openFile?: string)`. It includes `openFile`
  in the body only when given.
- `make test` and `bun run check` pass.

### Unit 2: The chat panel saves and sends the open file

**What it does.** `Chat` gets its two new props, the save-then-send order, the save error, and the new hint. `App`
wires the props.

**Delta entries.** S-3, S-4.

**Ordering constraint.** Lands after Unit 1. Without Unit 1, the server would ignore `openFile`, and the AI would still
not be told the file.

**How you know it worked.**

A new `src/ui/chat.test.tsx`, run by `make test-ui`, has one test per behavior
([D-18](artifacts/change-decision-log.md#d-18-two-new-test-files-pin-the-route-and-the-save-then-send-order)). It stubs
`globalThis.fetch` for the chat request, the same way `agent-panel.test.tsx` does. It passes `saveOpenFile` as a promise
the test controls.

1. **Order.** While the save is pending, no chat request is made. After it resolves, exactly one is made, with body
   `{ text, openFile }`.
2. **Failure.** When the save rejects, no chat request is made. The text stays in the box, and an alert reads "Could not
   save notes.md, so the message was not sent. Try Send again."
3. **Double send.** Pressing Send twice before the save resolves calls `saveOpenFile` once and sends once.
4. **Name capture.** Send with `openFile="notes.md"`, then re-render with `openFile="ideas.md"` while the save is
   pending. The sent body has `openFile: "notes.md"`.
5. **Error clears.** After a failed save, re-rendering with a different `openFile` removes the alert.

Then check these by hand in the running app:

- Open `notes.md`, type without saving, and send "Fix the spelling". The editor shows "saved" before the reply starts,
  and the AI edits `notes.md`.
- Open `ideas.md` and send "Shorten the intro". The AI edits `ideas.md`.
- Send "Use the doc-stats skill" and "Have the proofreader agent review this" with no file named. Both work on the open
  file.
- Type in the editor, stop the server, and press Send. The error line appears above the text box and the text stays.

`make test` passes.

## Risks

- **The model may not follow the note.** It may ignore the open file, or override a file the user named. It may also
  not pass the file on to a subagent. Only a live run shows this. The `check.ts` scenario in Unit 1 catches the first
  case, and the manual checks in Unit 2 cover the rest.
- **Send now overwrites the AI's changes without asking.** The user chose this (D-12). A user who presses Send while
  the banner shows loses the AI's edit to that file. The AI can redo it on request.
- **Switching files during the save.** Every send now saves, so the existing mix-up in C-12 gets more chances to
  happen. The file name is captured before the save, so the AI is still told the right file. What can go wrong is the
  newly opened document showing as "saved" when it was not.
- **Blast radius.** Unit 1 changes every chat turn's prompt, but only when `openFile` is sent. Unit 2 changes every
  chat send.

## Deferred (YAGNI)

- **A shared `ChatRequest` type in `src/shared/wire.ts`.** Two writers of the body exist, and only one sends
  `openFile`. The two new tests pin both ends of the field name. Reopen when a third client posts to the chat route, or
  the body gains a required field.
- **A per-turn context parameter on `agentSettings`.** It has one caller, and it would reach jobs, which are out of
  scope. Reopen when jobs need to know the open file.
- **A "context provider" hook for `Chat`.** It would have one use. Reopen when a second piece of editor state has to
  reach the model.
- **Keeping document state per document (C-12).** Capturing the name before the save covers what this change needs.
  Reopen if the wrong document is ever seen marked as saved.
- **Checking `res.ok` in `api()` (C-11).** Today's rejection path is enough to stop the send. Reopen when a document
  route returns a JSON error body with a non-2xx status.
- **A `useRef` fallback for getting the name into the request.** The runtime source shows the per-message body gets
  through (C-6). Reopen if `openFile` is missing from the request in a browser.
- **A "Saving…" label on the Send button.** Saves are local and short, and the guard in step 1 already stops double
  sends. Reopen if saves are seen to take noticeable time.
- **Showing the file on each message in the transcript, or in the composer.** The editor bar and the file list already
  show the open file. Reopen on a report of the AI acting on the wrong file, or of confusion after switching files.
- **A timeout for a save that never finishes.** `api()` has none, so a hung save leaves Send doing nothing until "New
  chat" is pressed. Reopen on a report of Send doing nothing.

## Cut for Scope

- **Background jobs knowing the open file.** A job would have been told which file was open when it started, the same
  way chat is. It was cut because the user said "just the chat panel"
  ([artifacts/scope-boundary.md](artifacts/scope-boundary.md#operator-stated-scope)).

## Open Items

- **Error text is hard to read in dark mode.** Error text uses `--bad` (`#c92a2a`), and the dark theme does not
  override it. On the dark panel that gives about 3.0:1 contrast, below the WCAG minimum of 4.5:1. The new save-error
  line inherits this. The problem predates this change and lives in `styles.css`, outside the chat panel. Non-blocking.
  A lighter `--bad` in the dark-mode block, such as `#ff6b6b`, would settle it.

## Review Findings

Three reviewers checked the draft plan: `han-core:junior-developer`, `han-core:test-engineer`, and
`han-core:user-experience-designer`. One round ran, the cap for a medium change. These findings changed the plan:

- **Auto-save could overwrite the AI's changes.** The user was never asked about this case (junior developer). It was
  escalated, and the user chose to save and send
  ([D-12](artifacts/change-decision-log.md#d-12-send-saves-over-changes-the-ai-made-to-the-open-file)).
- **What the AI is told when the file is not on disk** (junior developer). This is settled from the code
  ([D-13](artifacts/change-decision-log.md#d-13-the-name-is-sent-even-when-the-file-is-not-on-disk)).
- **Follow-up requests after switching files** (junior developer). Accepted, and stated in the contract
  ([D-14](artifacts/change-decision-log.md#d-14-a-follow-up-after-switching-files-means-the-newly-open-file)).
- **Skills and subagents.** These are now in the Unit 2 manual checks (junior developer).
- **The `useRef` fallback was not needed.** The runtime source shows the body gets through, so the fallback moved to
  Deferred (junior developer).
- **The "Saving…" label and the disabled Send button.** The label was dropped, and a ref-based guard replaced the
  disabled button. That avoids losing keyboard focus and flicker on clean documents (junior developer, UX designer)
  ([D-7](artifacts/change-decision-log.md#d-7-a-second-send-during-the-save-is-ignored)).
- **The save error could be out of view, go stale, and give no next step** (UX designer). It now sits in the composer
  with `role="alert"`, clears on file change, and says "Try Send again."
  ([D-16](artifacts/change-decision-log.md#d-16-the-save-error-sits-in-the-composer-and-clears-itself)).
- **Text typed during the save was erased** (UX designer). It is kept now
  ([D-15](artifacts/change-decision-log.md#d-15-text-typed-during-the-save-is-kept)).
- **The empty-chat hint taught the old habit** (UX designer). It was reworded
  ([D-17](artifacts/change-decision-log.md#d-17-the-empty-chat-hint-stops-naming-a-file)).
- **No test pinned the route, or the save-then-send order** (test engineer). There are now two new test files
  ([D-18](artifacts/change-decision-log.md#d-18-two-new-test-files-pin-the-route-and-the-save-then-send-order)).

These findings stay `Unverified`, and none of them blocks the change:

- How the focus behaves on a disabled button. This is moot now that the button is not disabled.
- The timing of re-renders during a save.
- How the model follows the note.

No reviewer could run a browser or a live model.

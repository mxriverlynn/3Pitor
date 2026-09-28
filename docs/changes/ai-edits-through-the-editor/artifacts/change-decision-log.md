# Change Decision Log: AI Edits Through the Editor

This file records every decision committed while planning AI Edits Through the Editor. The plan itself lives in
[../change-plan.md](../change-plan.md). This file holds the question, rationale, evidence, and rejected alternatives
behind each decision. Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings. The operator's answers quoted below
come from this planning conversation on 2026-09-28.

## Trivial decisions

- D-17: Pin the Yjs packages — add `yjs@13.6.33`, `y-prosemirror@1.3.7`, and `y-protocols@1.0.7` to `dependencies` at
  exact versions, matching how `package.json` pins everything else; `y-protocols` is a peer dependency of
  `y-prosemirror`, and `y-prosemirror`'s entry module imports `y-protocols/awareness` through its cursor plugin, so
  the bundle needs it (C-19). — Referenced in plan: Surface Delta (S-3), Change Units (Unit 3).
- D-18: Rewrite the model's instructions — drop "If the user denies a change, do not retry it", describe `Write` as
  creating or replacing a whole post that opens unsaved in the editor, and add that edits appear in the editor for the
  user to review and save. — Referenced in plan: Surface Delta (S-9).
- D-19: Leave the documents route's path check as it is — the PUT route's weaker containment check (C-2) is not made
  worse by this change and fixing it is not asked for; it goes to Cut for Scope. — Referenced in plan: Cut for Scope.
- D-20: The check script and README follow the code — each unit updates the `check.ts` scenarios and the README text
  its own delta touches, so `bun run check` and the README stay true after every unit. — Referenced in plan: Surface
  Delta (S-16, S-17), Change Units.

## Full decisions

### D-1: Edits run against a per-turn text store on the server

- **Question:** Where do the AI's reads and edits run, now that they must not touch disk and must see what the user
  sees?
- **Decision:** On the server, against a per-turn text store that `Sessions.chat` builds from the markdown the browser
  sends with the message (D-2). `Read` returns a post's text from the store, falling back to disk. `Edit` checks and
  applies `old_string` → `new_string` in the store. `Write` puts whole text in the store (D-7). None of them write disk.
  The store is a plain record and three functions in `tools.ts`, not a class:

  ```ts
  // src/server/tools.ts
  export interface TurnTexts {
    texts: Map<string, string>; // post name -> current text for this turn
    edited: Set<string>;        // post names Edit or Write changed, in last-changed order
  }
  // Keys are normalized with postName; entries that are not posts are dropped.
  export function turnTexts(workspace: string, documents: Record<string, string>): TurnTexts;
  // relative(realpath(workspace), resolvePost(workspace, filePath)): "./notes.md" -> "notes.md",
  // "drafts/../notes.md" -> "notes.md". Throws the same errors resolvePost throws today.
  export function postName(workspace: string, filePath: string): string;
  // { name: text } for every name in `edited`, in its order.
  export function editedTexts(turn: TurnTexts): Record<string, string>;
  export function fileTools(workspace: string, turn: TurnTexts): { Read; Edit; Write; Glob };
  ```

  A tool that fails still throws, so the model receives a tool error it can react to (C-9).
- **Rationale:** The model has to learn during the turn whether its edit matched, so the check has to run where the
  tool loop runs. The server already runs it (C-1), and a store seeded from the browser's text gives the AI the user's
  unsaved view with a single request field added.
- **Evidence:** C-1, C-3, C-7, C-8, C-9; software-architect proposal.
- **Behavior impact:** Changing. The AI reads unsaved text, and its edits never reach disk. Both are the operator's
  request: "all AI file reads, edits, etc, happen via the prosemirror editor or my application code" and "the AI should
  not be allowed to actually edit files on the file system".
- **Rejected alternatives:**
  - Tools with no `execute`, run in the browser through `onToolCall`/`addToolOutput` — rejected because each tool call
    would end the server stream, and resuming needs the whole message list sent back plus a resume path in `Sessions`.
    Neither exists: the transport sends only text and the server keeps its own history (C-7, C-8).
  - Structured output only at the end of the reply, with no edit tools — rejected because the model would never learn
    that an edit failed to match, which today's `Edit` tells it (C-1, C-9).
- **Revisit criterion:** A tool needs something only the browser has at call time, such as the live selection.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-8
- **Dependent decisions:** D-2, D-3, D-7, D-9
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta

### D-2: The chat request carries the markdown of every document the browser holds

- **Question:** How does the server learn what the user sees, including unsaved edits in files other than the open one?
- **Decision:** The chat body gains an optional `documents` field. It is a shared type in `src/shared/wire.ts`:

  ```ts
  export interface ChatRequest {
    text: string;
    openFile?: string;
    documents?: Record<string, string>; // documents-API name -> markdown, for every editable file the browser holds
  }
  ```

  ```json
  {
    "text": "Tighten the intro in both posts",
    "openFile": "notes.md",
    "documents": {
      "notes.md": "# Notes\n\n- one\n- two\n",
      "garden.md": "# Garden Plan\n\nTomatoes.\n"
    }
  }
  ```

  - The browser includes every registry entry that is not read-only (D-4).
  - Each value is `markdownOf(entry.doc)`, taken in the same synchronous step that records that entry's base snapshot
    (D-16).
  - When `documents` is absent, the turn runs with an empty store. When it is present but is not an object whose
    values are all strings, the route answers `400 { "error": "documents must map file names to markdown" }` and runs
    no turn (D-21).
  - Keys that are not posts are dropped by `turnTexts`.
- **Rationale:** Sending every held document costs one field. Without them, the AI would read disk for a file with
  unsaved edits in another tab of the registry and compute its edit against text the user no longer has.
- **Evidence:** C-3, C-6, C-10; D-4.
- **Behavior impact:** Changing, as part of D-1: the AI sees unsaved text.
- **Rejected alternatives:**
  - Send only the open file — rejected because after D-4 other files can hold unsaved edits, and the AI's view of them
    would be stale.
  - Keep saving before Send so disk matches — rejected because only the Save command may write (D-8).
- **Revisit criterion:** Request size becomes a measured problem.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10, S-13
- **Dependent decisions:** D-16, D-21
- **Referenced in plan:** Target State; Surface Delta

### D-3: The server sends each edited file's final text once, in the `data-session` part

- **Question:** How does the browser learn which edits to apply, and in what form?
- **Decision:** The `data-session` part `Sessions.chat` writes after a turn gains `edited`. The browser applies that and
  never reads tool parts:

  ```ts
  // src/shared/wire.ts
  export interface SessionData {
    aborted: boolean;
    edited: Record<string, string>; // post name -> final markdown after the turn; {} when aborted
  }
  // src/server/sessions.ts, where data-session is written today
  writer.write({ type: 'data-session', data: { aborted, edited: aborted ? {} : editedTexts(turn) } });
  // src/ui/chat.tsx
  onFinish: ({ message, isAbort, isError, isDisconnect }) => {
    if (isAbort || isError || isDisconnect) return;
    const part = message.parts.findLast((p) => p.type === 'data-session');
    if (part && !part.data.aborted) onTurnFinished(part.data.edited);
  },
  ```

  Worked example of the part on the wire:

  ```json
  { "type": "data-session", "data": { "aborted": false, "edited": { "notes.md": "# Notes\n\n- one\n- three\n" } } }
  ```

  The key order of `edited` is last-changed order. D-14 relies on it.
- **Rationale:** Replaying `old_string`/`new_string` in the browser would repeat the server's work. It would also
  depend on the browser's text matching the server's byte for byte, which fails for disk-read files, because the
  serializer rewrites `*` bullets as `-`. Sending the final text lets the merge diff by structure (D-16), where
  formatting differences drop out.
- **Evidence:** C-7, C-16, C-19; software-architect proposal.
- **Behavior impact:** Changing, as part of D-1 and D-6.
- **Rejected alternatives:**
  - Filter `tool-Edit` parts with `state === 'output-available'` and replay them — rejected for the reasons above, and
    because no live stream has confirmed the tool-part shape (C-16).
  - A new event on the WebSocket bus — rejected because the bus goes to every socket (C-18), while the chat stream
    already belongs to the one browser that sent the message.
- **Revisit criterion:** Edits need to appear while the turn is still running.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11, S-12, S-13
- **Dependent decisions:** D-6, D-14
- **Referenced in plan:** Target State; Surface Delta

### D-4: The browser keeps a Yjs document for every file opened, and switching files keeps unsaved edits

- **Question:** Asked of the operator as: should switching files keep your unsaved edits, now that the AI can edit
  several files in one reply and opens a file it edits?
- **Decision:** `useDocuments` holds a registry, `Map<name, Entry>`, in a ref. Each entry is:

  ```ts
  type Entry = { doc: Y.Doc; loadBase: Snapshot; readOnly: boolean; dirty: boolean; savedAt: number };
  ```

  - `open(name)` reuses an entry if one exists. Otherwise it loads the file from disk and records `loadBase`.
  - `save(name = current)` saves that entry by name, then clears its `dirty`.
  - The Files list marks each dirty entry.
  - Entries live for as long as the page is open.
- **Rationale:** Without this, opening the second file the AI edited would throw away the AI's edits to the first
  (C-10). Saving by name also fixes the case where a save finishing after a file switch marks the wrong file as saved
  (C-12).
- **Evidence:** C-10, C-12; operator answer 3 in the boundary record.
- **Behavior impact:** Changing. Operator's answer, verbatim: "Keep every file's unsaved edits while the app is open".
- **Rejected alternatives:**
  - Keep one file at a time — rejected by the operator. It would also limit the AI to one file per reply.
- **Revisit criterion:** Memory use from long sessions with many files becomes a reported problem.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-2, D-7, D-11, D-14
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Behavior Changes

### D-5: Remove the Allow/Deny approval for AI edits

- **Question:** Asked of the operator as: should the Allow/Deny card for AI edits go away, now that edits land unsaved
  in the editor and Save is the only disk write?
- **Decision:** Remove the whole approval feature:
  - `approvals.ts`, `approvals.routes.ts` and `approvals.test.ts`;
  - `EDIT_TOOLS` and the `toolApproval` option in `Sessions.chat`;
  - the `approval-request` and `approval-resolved` members of `HostEvent`, and `ClientMessage`;
  - the socket's approval-response handling in `events.routes.ts`;
  - the `Approval` card and the `approvals` prop in `chat.tsx`, and the `approvals` state in `app.tsx`;
  - the two `approval:` check scenarios, and the README row for `POST /api/approvals/:id`.
- **Rationale:** The card guarded a disk write that no longer happens. The edit it would guard can be read, undone
  (D-10), or discarded before Save.
- **Evidence:** C-5; operator answer.
- **Behavior impact:** Changing. Operator's answer, verbatim: "remove the card".
- **Rejected alternatives:**
  - Keep the card and hold each edit until Allow — rejected by the operator.
- **Revisit criterion:** A tool with a side effect the user cannot undo in the editor is added.
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** None
- **Referenced in plan:** Surface Delta; Behavior Changes; Change Units

### D-6: A stopped or failed reply applies nothing

- **Question:** Asked of the operator as: what happens to the AI's edits when you press Stop, or the reply fails
  partway?
- **Decision:** Only a completed turn delivers `edited`.
  - The server writes a non-empty `edited` only on the path where the turn joins the history (C-7).
  - The browser ignores `onFinish` when `isAbort`, `isError`, or `isDisconnect` is true, or when no `data-session` part
    arrived.
  - Pressing "New chat" during a turn remounts `Chat`, so that turn's `onFinish` never runs, and it too applies
    nothing.
- **Rationale:** The editor stays consistent with what the AI remembers. A stopped turn is left out of the server's
  history.
- **Evidence:** C-7; operator answer.
- **Behavior impact:** Changing. Today, edits made before Stop are already on disk and stay there. Operator's answer,
  verbatim: "Throw the edits away".
- **Rejected alternatives:**
  - Apply the edits that finished before the stop — rejected by the operator, because the AI would not remember them.
- **Revisit criterion:** Users report losing work they wanted from long, stopped turns.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11, S-12, S-13
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Behavior Changes

### D-7: `Write` stays, and a new or replaced post opens unsaved in the editor

- **Question:** Asked of the operator as: can the AI still create new posts, or replace a whole post at once?
- **Decision:** `Write` keeps its input `{ file_path: string; content: string }`.
  - It puts `content` into the turn store under `postName(file_path)` and marks the post edited. It never writes disk.
  - Its result is `"wrote {name}"`.
  - In the browser, `applyEdited` handles a name with no registry entry by creating an entry from the text, with
    `dirty: true`.
  - The Files list shows the union of the disk file names and the registry's names, and marks every dirty entry
    unsaved. The entry records nothing about whether the file exists on disk (D-25).
  - Saving an entry whose name is not in the disk list PUTs it, which creates the file, then refreshes the list.
- **Rationale:** This is the operator's choice. The registry from D-4 already holds documents that are not on disk, so
  a new document is one more flag.
- **Evidence:** C-1, C-10; operator answer. Hono decodes an encoded `/` in `:name`, so a post in a subfolder opens and
  saves by name (C-20).
- **Behavior impact:** Changing. Operator's answer, verbatim: "New posts start as unsaved documents".
- **Rejected alternatives:**
  - Remove `Write` so the AI edits only existing posts — offered as the recommendation, rejected by the operator.
- **Revisit criterion:** None; the operator decided it.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6, S-8
- **Dependent decisions:** D-25
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-8: Send no longer saves the open file first

- **Question:** Does the chat still save the open file before sending?
- **Decision:** No. `Chat.send` takes `beginTurn()` and sends at once:
  - `saveOpenFile`, `saveError` and `savingRef` are removed;
  - so is the "Could not save … so the message was not sent" message;
  - Send can no longer fail because of a save.
- **Rationale:** The operator's rule is that "the only time a file is written to directly, is when the save command is
  called from the UI of the app". The pre-send save existed only so the AI's disk reads would match the editor (C-6).
  D-2 gives the AI the editor's text directly. This reverses the "auto-save before sending" decision in
  `docs/changes/tell-ai-the-open-file/`.
- **Evidence:** C-6; the boundary record's stated scope.
- **Behavior impact:** Changing. The boundary settles it, so it was not escalated separately.
- **Rejected alternatives:**
  - Keep the save — rejected because it is a disk write the Save command did not start.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-13
- **Dependent decisions:** None
- **Referenced in plan:** Surface Delta; Behavior Changes

### D-9: The AI cannot edit a post the editor cannot hold

- **Question:** Asked of the operator as: what happens when you ask the AI to edit a post the editor can't hold?
- **Decision:** `unsupportedMarkdown` and `UNSUPPORTED` move, unchanged, to a new `src/shared/markdown-support.ts`. It
  has no imports, and both the UI and `tools.ts` import it. `Edit` and `Write` throw in two cases:
  - The post's current text (from the store, or from disk when it exists) contains unsupported markdown. The error
    reads `` `${name} has ${kinds.join(' and ')}, which the editor can't keep, so it can't be edited here` ``.
  - The new text would contain unsupported markdown. The error reads
    `` `the edit would add ${kinds.join(' and ')} to ${name}, which the editor can't keep` ``.

  Read-only entries are left out of `documents` (D-2).
- **Rationale:** The editor flattens those constructs, so an edit applied there would become damage on Save (C-13).
  Refusing on the server tells the model before it reports success.
- **Evidence:** C-13, C-15; operator answer.
- **Behavior impact:** Changing. Today the AI can edit such posts on disk. Operator's answer, verbatim: "go with
  recommended".
- **Rejected alternatives:**
  - Apply the edit anyway — rejected, because Save would flatten the tables and HTML.
  - Keep the check in the UI only — rejected, because the model would be told the edit worked.
- **Revisit criterion:** The editor's schema gains tables, task lists or raw HTML.
- **Dissent (if any):** None. `src/shared/` was types-only by convention (README); this is its first runtime module,
  and the README is updated to say so.
- **Settles delta entry:** S-2, S-8
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-10: Undo is Yjs's, and it covers the AI's edits

- **Question:** Asked of the operator as: how should undo work once the editor is on Yjs?
- **Decision:** `MarkdownEditor` uses the following plugins:
  - `ySyncPlugin(doc.getXmlFragment('prosemirror'))`;
  - `yUndoPlugin({ trackedOrigins: [AI_ORIGIN] })`;
  - a keymap binding Mod-z to `undo`, and Mod-y and Shift-Mod-z to `redo`, all from `y-prosemirror`;
  - `exampleSetup({ schema, history: false, menuContent })`, where `menuContent` is `buildMenuItems(schema).fullMenu`
    with the `[undoItem, redoItem]` group left out.

  Undo history starts fresh on each file switch. `AI_ORIGIN` is a module constant, the string `'ai'`, and
  `mergeMarkdown` applies updates with it.

  The AI's edit is always an undo step of its own (D-24): `MarkdownEditor` registers the view's undo manager in a
  module-level `WeakMap<Y.Doc, Y.UndoManager>` when it mounts, and removes it on unmount. `mergeMarkdown` calls
  `stopCapturing()` on the registered manager for `live`, if there is one, both before and after it applies the update.
- **Rationale:** `prosemirror-history` does not see changes that arrive through Yjs (C-17), and the operator wants one
  undo that covers both kinds of edit.
- **Evidence:** C-17, C-19, C-21; operator answer.
- **Behavior impact:** Changing. The toolbar loses its undo and redo buttons, and Mod-z can undo an AI edit. Operator's
  answer, verbatim: "go with recommendation".
- **Rejected alternatives:**
  - Mod-z undoes only the user's own typing — rejected by the operator.
  - Keep the toolbar buttons, rewired to the new undo — rejected by the operator as extra work.
- **Revisit criterion:** Users ask for undo that survives file switches.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-24
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-11: Warn before leaving the page with unsaved changes

- **Question:** Asked of the operator as: should the app warn you before you close or reload the tab with unsaved
  changes?
- **Decision:** `useDocuments` adds a `beforeunload` listener. It calls `event.preventDefault()` whenever any registry
  entry is dirty.
- **Rationale:** AI edits and new posts now exist only in the page until Save, so closing the tab loses more than it
  did.
- **Evidence:** D-1, D-7; operator answer.
- **Behavior impact:** Changing. Operator's answer, verbatim: "go with recommended".
- **Rejected alternatives:**
  - No warning, the same as today — rejected.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** None
- **Referenced in plan:** Surface Delta; Behavior Changes

### D-12: Remove background jobs entirely

- **Question:** What happens to background jobs, which run unattended and write files?
- **Decision:** Remove every part of the job feature listed in C-14:
  - `jobs.ts`, `jobs.routes.ts` and `jobs.test.ts`;
  - the `Jobs` wiring in `agent-host.ts` and `server.ts`;
  - `Job`, `JobStatus` and `job-status` in `wire.ts`;
  - `ui/jobs.tsx` and `jobs.css`, and the `useJobs` wiring and `job-status` branch in `app.tsx`;
  - the two `job:` check scenarios;
  - the README text and the three `/api/jobs` rows.

  `MISSING_API_KEY_HELP` drops "and background jobs".
- **Rationale:** The operator's instruction.
- **Evidence:** C-14; operator answer 2 in the boundary record.
- **Behavior impact:** Changing. Operator's answer, verbatim: "background jobs go away entirely. remove that section
  from the UI."
- **Rejected alternatives:**
  - Read-only jobs, or jobs that edit through the editor — offered, and rejected by the operator.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** None
- **Referenced in plan:** Surface Delta; Behavior Changes; Change Units

### D-13: No separate adapter module on either side

- **Question:** Does the "adapter layer" the operator described become its own module?
- **Decision:** No. On the server, the adapter is `tools.ts` with a narrower job (D-1). In the browser, it is the Yjs
  helpers in `markdown-editor.tsx` (D-16) plus `beginTurn` and `applyEdited` in `documents.tsx`. `app.tsx` passes them
  to `Chat`.
- **Rationale:** A UI `ai-edits.ts` would import both `documents.tsx` and `markdown-editor.tsx`. That would make it a
  second wiring file, against the README rule that only `app.tsx` wires features, and it would have one caller. A
  server `TurnTexts` class or interface would also have one implementation and one caller.
- **Evidence:** README conventions; the YAGNI rule; software-architect proposal.
- **Behavior impact:** Preserving. This decision is about structure only.
- **Rejected alternatives:**
  - A UI `ai-edits.ts` module — rejected for the reasons above. It is recorded under Deferred (YAGNI).
  - A `TurnTexts` class behind an interface — rejected, one implementation and one caller. It is recorded under
    Deferred (YAGNI).
- **Revisit criterion:** A second source of edits appears, or a second tool family needs the store.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** None
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Deferred (YAGNI)

### D-14: Which file is shown after a reply that edited files

- **Question:** The AI edited one or more files. Which file does the editor show afterwards?
- **Decision:**
  - If the open file is a key of `edited`, it stays open.
  - Otherwise the editor opens the last key of `edited`, the file the AI changed most recently.
  - The switch happens before the merge, so the newly bound undo manager tracks the AI's change (D-10).
  - Every other edited file keeps its unsaved mark in the Files list.
- **Rationale:** This follows the operator's answer 3 ("open the other file to edit it") without moving the user away
  from a file the AI also changed.
- **Evidence:** Operator answer 3; D-3 key order.
- **Behavior impact:** Changing. The editor can switch files by itself after a reply. The boundary settles it.
- **Rejected alternatives:**
  - Open the first edited file — rejected, because the last one is the one the reply most likely ends talking about.
  - Never switch, only mark files — rejected, because it contradicts answer 3.
- **Revisit criterion:** Users find the switch surprising.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Behavior Changes

### D-15: Remove the reload-after-turn and the "agent changed this file" banner

- **Question:** What happens to `syncFromDisk` and the `changedOnDisk` banner?
- **Decision:** Remove `syncFromDisk`, `changedOnDisk`, the banner, and `onTurnFinished={docs.syncFromDisk}`.
  - `onTurnFinished` now carries `edited` to `applyEdited`.
  - The file list refreshes when a save creates a file (D-7), not after every turn.
- **Rationale:** They existed to catch the AI writing disk behind the editor's back (C-11). That no longer happens.
- **Evidence:** C-11; the boundary record's stated scope.
- **Behavior impact:** Changing. The banner no longer appears, and the editor no longer reloads from disk after a turn.
  A file changed on disk by another program is not picked up after a turn either. Today that pickup happens only as a
  side effect. The boundary settles it.
- **Rejected alternatives:**
  - Keep `syncFromDisk` as a check for outside changes — rejected, because nothing in scope asks for it, and it would
    reload over the Yjs document.
- **Revisit criterion:** Users edit the same posts in another program while 3pitor is open.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6, S-15
- **Dependent decisions:** None
- **Referenced in plan:** Surface Delta; Behavior Changes

### D-16: Merge the AI's final text into the live document by forking the base the AI saw

- **Question:** How does the AI's result merge with typing done while the AI worked?
- **Decision:** `markdown-editor.tsx` exports:

  ```ts
  export type Snapshot = { update: Uint8Array; vector: Uint8Array };
  export const AI_ORIGIN = 'ai';
  export function markdownOf(doc: Y.Doc): string;       // serializer.serialize of the fragment's ProseMirror node
  export function docFromMarkdown(markdown: string): Y.Doc;
  export function snapshot(doc: Y.Doc): Snapshot;       // { update: encodeStateAsUpdate(doc), vector: encodeStateVector(doc) }
  // fork = new Y.Doc(); applyUpdate(fork, base.update);
  // fork.transact(() => updateYFragment(fork, fork.getXmlFragment('prosemirror'), parser.parse(markdown), meta));
  // applyUpdate(live, encodeStateAsUpdate(fork, base.vector), AI_ORIGIN);
  export function mergeMarkdown(live: Y.Doc, base: Snapshot, markdown: string): void;
  ```

  `documents.tsx`:
  - `beginTurn(): { documents: Record<string, string> }` records `turnBases[name] = snapshot(entry.doc)` beside each
    `markdownOf(entry.doc)`.
  - `applyEdited(edited: Record<string, string>): void` is synchronous. It first applies D-14. Then, for each name,
    on its own:
    - When an entry exists, it merges with `turnBases[name]`. If there is no turn base, it merges with
      `entry.loadBase`, unless the entry was saved since `beginTurn` (D-23).
    - When no entry exists, it creates one from the text (D-7).
    - It marks the entry dirty.

    A throw in one file's merge is caught for that file alone (D-22).
- **Rationale:** The operator wants Yjs "so AI edits merge with typing I do while it works". A fork from the snapshot
  the AI saw turns the AI's change into Yjs operations concurrent with the user's typing, and Yjs merges the two. Every
  case probed kept both sides (C-19). The fork diffs by document structure, so markdown formatting differences between
  the server's text and the editor's serializer drop out.
- **Evidence:** C-19, C-21; operator answer 4.
- **Behavior impact:** Changing, as part of D-1: edits appear in the editor.
- **Rejected alternatives:**
  - Re-find `old_string` in the live text when applying — rejected, because typing inside the target text breaks the
    match, and Yjs would add nothing.
  - Replace the whole document with the AI's text — rejected, because it discards the user's typing, the loss the
    operator named.
  - A browser-side unsupported-markdown check in `applyEdited` — rejected. The server runs the same function on the same
    text first (D-9), so the path cannot fire. It is recorded under Deferred (YAGNI). The general per-file catch in D-22
    covers any other failure.
- **Revisit criterion:** `updateYFragment` changes shape in a `y-prosemirror` upgrade. Its `meta` argument is internal.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-6
- **Dependent decisions:** D-22, D-23, D-24
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Risks

### D-21: A malformed `documents` field is rejected, not ignored

- **Question:** What does the chat route do with a `documents` value that is not an object of strings?
- **Decision:** It answers `400` with `{ "error": "documents must map file names to markdown" }` and starts no turn. An
  absent `documents` is still accepted, and the turn gets an empty store.
- **Rationale:** If a malformed value were dropped silently, the AI would edit the disk text of a file that has unsaved
  typing. The browser would then merge from its unsaved base toward that disk-based text, and the structural diff would
  remove the unsaved typing. That is the exact loss the operator named (boundary answer 4). The browser is the only
  sender, so a malformed value is a bug worth seeing.
- **Evidence:** junior-developer JD-005; D-2; D-16.
- **Behavior impact:** Preserving for existing callers. No caller sends `documents` today, and a body without it
  behaves as before.
- **Rejected alternatives:**
  - Ignore it, the way `openFile` is ignored — rejected for the loss above.
- **Revisit criterion:** A second client sends chat requests.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta

### D-22: Each file's merge succeeds or fails on its own, and a failure is shown

- **Question:** What happens when merging the AI's text into one file throws, partway through a reply that edited
  several files?
- **Decision:** `applyEdited` wraps each file's merge and its dirty mark in its own `try`. On a throw, it:
  - leaves that file's entry as it was;
  - carries on with the next file;
  - adds `{ name, message }` to a `notApplied` list that `useDocuments` returns.

  `Editor` shows one line per item: `Could not apply the AI's edit to {name}: {message}`. Opening another file, or the
  next `applyEdited`, clears the list.
- **Rationale:** Without this, a throw on the second of three files would leave the first merged but never marked
  dirty, so it has no unsaved mark and no leave-page warning. The other two files would stay unmerged, and nothing would
  tell the user. The merge depends on `updateYFragment`, whose `meta` argument is internal (C-19).
- **Evidence:** risk-analyst R1 (Unverified: reasoned from the ordering, not reproduced); C-19.
- **Behavior impact:** Changing, within the behavior D-1 already introduces. It adds a failure message that has no
  counterpart today.
- **Rejected alternatives:**
  - One `try` around the whole loop — rejected, because the files after the failing one would be dropped.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-23
- **Referenced in plan:** Target State; Surface Delta; Risks

### D-23: A file saved during the turn, with no base from Send, is not merged blind

- **Question:** A file was not open at Send, so it has no turn base. The user opens it and saves it while the AI works.
  What base does the merge use?
- **Decision:** Every entry carries `savedAt`, a counter that `save` increments, and `beginTurn` records each entry's
  counter. When `applyEdited` finds a name with no turn base, it checks the entry. If the entry was saved since
  `beginTurn`, or did not exist at `beginTurn` and has been saved since it was opened, the merge does not run. That
  name goes to `notApplied` with the message `it was saved while the AI was working; ask again`. In every other case
  it merges from `loadBase`.
- **Rationale:** The AI read that file from disk at some unknown point. If the user saved between opening it and the
  AI's read, `loadBase` is older than the AI's starting text. The diff would then reinsert the user's saved change as
  if it were the AI's, and the user would see duplicated text. Refusing makes the problem visible and loses nothing.
- **Evidence:** risk-analyst R2 (Unverified: reasoned from the merge mechanics, not reproduced); D-16.
- **Behavior impact:** Changing, within D-1. It is a new failure message for a rare interleaving.
- **Rejected alternatives:**
  - Send the AI's starting text back, and keep a snapshot per saved version to fork from — rejected under the
    simpler-version test. It is more contract and more state for a rare case that the refusal already makes safe.
- **Revisit criterion:** Users hit this message often enough to ask for the merge to handle it.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Risks

### D-24: The AI's edit is its own undo step

- **Question:** How does the plan keep Mod-z from undoing the user's recent typing together with the AI's edit?
- **Decision:** `mergeMarkdown` calls `stopCapturing()` on the open view's undo manager both before and after it
  applies the update. It finds the manager through the `WeakMap` that `MarkdownEditor` maintains (D-10). The merge does
  this for the open file only, and D-14 opens the edited file before the merge runs.
- **Rationale:** `Y.UndoManager` groups changes made close together. Without the calls, one undo reverts both the
  typing and the AI's edit. With them, it reverts only the AI's (C-21). The operator was told that Mod-z undoes "the
  most recent change first".
- **Evidence:** C-21; D-10.
- **Behavior impact:** Changing, as part of D-10.
- **Rejected alternatives:**
  - An undo manager per registry entry, passed to `yUndoPlugin({ undoManager })` — rejected, because the plugin
    destroys the manager it is given when the view unmounts (C-21).
- **Revisit criterion:** `y-prosemirror` exposes a supported way to mark a capture boundary.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-5
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta

### D-25: The Files list shows disk files plus registry entries, with no "new" flag

- **Question:** How does the browser know an AI-created post is not on disk, when `applyEdited` is synchronous and the
  disk list only scans the top-level folder?
- **Decision:** It does not need to. The Files list shows the union of `names` (from `GET /api/documents`) and the
  registry's keys, and marks every dirty entry unsaved. After a save, `useDocuments` refreshes `names` when the saved
  name was not in it. The `Entry` type has no `isNew` flag.
- **Rationale:** A "new" flag would misfire for an existing post in a subfolder, because the disk list never contains
  it (C-20). The only things the flag drove were the unsaved mark, which `dirty` already gives, and the list refresh,
  which the save can decide on its own.
- **Evidence:** test-engineer finding 4; junior-developer JD-012; C-20.
- **Behavior impact:** Changing, as part of D-7.
- **Rejected alternatives:**
  - An `isNew` flag decided by checking `names` — rejected for the subfolder misfire above.
- **Revisit criterion:** The Files list needs to tell a new post apart from an edited one.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** None
- **Referenced in plan:** Target State; Surface Delta

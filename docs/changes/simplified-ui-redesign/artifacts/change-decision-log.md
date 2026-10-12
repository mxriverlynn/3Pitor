# Change Decision Log: Simplified UI Redesign

The plan lives in [../change-plan.md](../change-plan.md). Evidence about today's code lives in
[current-state-findings.md](current-state-findings.md) as `C-N` findings. The scope is in
[scope-boundary.md](scope-boundary.md). The canvas's layout, copy and colors are written out in
[canvas-reference.md](canvas-reference.md).

Every escalation and behavior-change gate in this run was settled by the run itself, under the operator's standing
preference to "make the best decisions you can, without asking me" (recorded in memory, 2026-10-01, and restated in the
scope turn on 2026-10-12). Each behavior change is listed in the plan's Behavior Changes section for the operator to
read after the fact.

Review round 1 (junior-developer `JD-N`, user-experience-designer `UX-N`, test-engineer findings by unit) revised D-4,
D-5, D-6, D-7, D-8, D-9, D-10, D-11, D-12, D-13, D-15, D-16, D-19 and added D-23 to D-27.

## Trivial decisions

- D-20: Escalations settled by the run — every question and behavior-change gate is decided here and reported in the
  plan, per the operator's standing preference. — Referenced in plan: Why This Change, Behavior Changes.
- D-21: Team size — Medium (several UI features, many behavior-changing entries): `junior-developer`,
  `user-experience-designer`, `test-engineer`; one review round was enough. — Referenced in plan: Review Findings.
- D-22: Visual reference — the canvas, written out in `canvas-reference.md`, is the reference for layout, copy and
  color; where this log and the canvas disagree, this log wins and says why. — Referenced in plan: Target State.
- D-26: README — Units 9, 10 and 11 update `README.md`'s description of `popups/`, `components/anchored-bubble/` and
  `components/agent-actions/` as they move or delete them (JD-2). "Nothing outside `src/ui/` changes" means no code. —
  Referenced in plan: What Changes, In One Paragraph; Change Units.
- D-27: Canvas copy on disk — `artifacts/canvas-reference.md` records every screen's copy and colors so the builder
  never needs the canvas URL (JD-6). — Referenced in plan: Target State, Open Items.

## Full decisions

### D-1: Keep prosemirror-menu for a trimmed toolbar

- **Question:** Should the formatting toolbar be rebuilt in React to match the canvas's "Paragraph ▾" dropdown, or
  trimmed in place?
- **Decision:** Keep `prosemirror-menu` and `menuContent` in `markdown-editor.tsx`. Remove the Join up, Lift and Select
  parent items. Keep the Insert dropdown. Relabel the "Type..." dropdown with the fixed label "Text". `rawAware`,
  `linkItem` and the raw pane's mount point on `menubar.wrapper` stay as they are.
- **Rationale:** Trimming is three lines; a React toolbar would re-create every item's `active`/`enable`/`run` and the
  raw-mode behavior `rawAware` already provides. A label that follows the current block type is not a `Dropdown`
  feature, and "simple as possible" does not need it.
- **Evidence:** C-3; C-2 (the raw pane mounts on the menubar wrapper).
- **Behavior impact:** Changing. The writer no longer sees Join up, Lift or Select parent, and the block-type dropdown
  reads "Text" instead of "Type...". Settled by the run (D-20).
- **Rejected alternatives:**
  - A React toolbar with a live block-type label — rejected: re-implements `rawAware` for every item for one label.
  - Leaving the toolbar untouched — rejected: the audit named Join up, Lift and Select parent as jargon.
- **Revisit criterion:** The writer asks for the dropdown to show the current block type.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes, Deferred (YAGNI)

### D-2: The Formatted/Markdown switch moves into the post header

- **Question:** Where does the mode switch live once the editor's controls stop depending on the menubar?
- **Decision:** `Editor` (`documents.tsx`) renders it in the post header as a group named "View" with two buttons,
  "Formatted" and "Markdown", each with `aria-pressed`. It reads `docs.mode` and calls `docs.setMode`. The stored
  `ViewState.mode` values stay `'rendered' | 'raw'`. For a read-only file (`docs.unsupported.length > 0`) both buttons
  are disabled, "Formatted" reads pressed whatever `docs.mode` holds (the editor shows rendered), and the switch is
  described by the read-only notice (`aria-describedby`). `MarkdownEditor` loses its `onModeChange` prop and keeps
  `mode` as an input; `raw = mode === 'raw' && !readOnly` stays.
- **Rationale:** `mode` already lives in `useDocuments` and persists in the view state. Today the switch vanishes with
  the menubar on read-only files.
- **Evidence:** C-2, C-11; test-engineer (Unit 4: the read-only pressed state was unspecified).
- **Behavior impact:** Changing. The switch reads Formatted/Markdown, sits in the header, and stays visible (disabled)
  on read-only files. Settled by the run (D-20).
- **Rejected alternatives:**
  - Keep the portal into the menubar — rejected: the header is a sibling above the editor and the menubar hides on
    read-only files.
  - Rename the stored values — rejected: the view state is persisted; the labels are all that need to change.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-7
- **Dependent decisions:** D-19
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-3: No server, engine or shared change

- **Question:** Does any screen need the server, the engine or `src/shared/` to change?
- **Decision:** No. Every piece is built in `src/ui/`. `ChatRequest`, `SessionData`, `ViewState` and every message text
  the server receives stay as they are (D-7 keeps the one path the review found).
- **Rationale:** The chip folds its context into `text` exactly as the popups do; Undo all works from text the client
  captures; the connection state already reaches the UI.
- **Evidence:** C-5, C-22.
- **Behavior impact:** Preserving for every caller outside `src/ui/`.
- **Rejected alternatives:**
  - A new `ChatRequest.context` field — rejected: changes the wire for no gain.
  - Persisting Undo all in the view state — rejected under YAGNI; see D-5.
- **Revisit criterion:** A screen needs data only the server has.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** D-5, D-7
- **Referenced in plan:** What Changes, In One Paragraph; Target State

### D-4: A review strip replaces the highlight bar and shows on read-only files

- **Question:** Where does the review strip live, and what does it say?
- **Decision:** New `documents/markdown-editor/review-strip.tsx` and `review-strip.css`. `MarkdownEditor` renders it as
  a plain React sibling before the `.rich-editor` host, not a portal, and still owns count, current and stepping.
  ```ts
  export function ReviewStrip(props: {
    passages: Passage[];               // the open file's highlights
    placed: number;                    // passages found in the text (today's `count`)
    current: number;                   // 0-based index of the outlined passage
    onStep: (step: -1 | 1) => void;    // MarkdownEditor's stepHighlight
    turn?: { files: string[]; pending: boolean; onUndoAll: () => void }; // only when the open file is in lastTurn.files
    onDismiss: () => void;
  }): JSX.Element | null;              // null when there are no passages and no turn
  export function reviewSummary(passages: Passage[], files?: string[]): string;
  ```
  `reviewSummary` cases (unlabeled = change, labeled = question):
  - 2 changes, 1 question, 1 file → `'Claude changed 2 passages and left 1 question'`
  - 1 change → `'Claude changed 1 passage'`; 1 question → `'Claude left 1 question'`; 2 questions →
    `'Claude left 2 questions'`
  - no passages, a turn → `'Claude changed this post'`
  - `files` with more than one name → the sentence plus `' in 3 posts'` (the count of `files`)
  The position text reads `{current + 1} of {placed}`, with ` ({N} not found)` when some passages were not placed, or
  `No passages found` when `placed` is 0 and there are passages. The step buttons keep the names "Previous highlight"
  and "Next highlight". Undo all shows only with `turn`: visible text "Undo all", accessible name and title "Undo
  Claude's changes in {names joined with ', '}", disabled while `pending`. The dismiss button is named "Dismiss review";
  after it, focus moves to the post header's file-name button (D-25). Changed passages get a forced-colors outline.
  `MarkdownEditor`'s `onClearHighlights?: () => void` prop becomes
  `review?: { turn?: ReviewStrip['turn']; onDismiss: () => void }`.
- **Rationale:** A sibling outside the scroll host stays in view and cannot be hidden by the read-only menubar rule. The
  engine marks every changed block as an unlabeled passage and every question as a labeled one, so the counts need no
  new data. Showing `turn` only on files the turn touched, and naming the files Undo all affects, keeps its reach
  visible (JD-7, UX-4).
- **Evidence:** C-1, C-2, C-17; JD-7; UX-3, UX-4, UX-18.
- **Behavior impact:** Changing. The writer sees "Claude changed 3 passages and left 1 question" with previous/next,
  Undo all and a dismiss button, where they saw "Highlight 1 of 4" and Clear. The strip now shows on read-only files.
  A label-less question would count as a change (C-17). Settled by the run (D-20).
- **Rejected alternatives:**
  - Lift count/current/step into `Editor` — rejected: they are driven by `highlightsPlugin` inside the editor.
  - Inline the strip in `markdown-editor.tsx` — rejected: the file is 970 lines and the highest-churn file in the area.
  - Show Undo all on every post after a turn — rejected: it reverted posts the writer could not see (JD-7).
- **Revisit criterion:** The engine starts recording changed passages separately from highlights.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5, S-7
- **Dependent decisions:** D-5
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-5: Undo all asks first, then restores each file Claude touched to its text at Send

- **Question:** What exactly does Undo all restore, for which turns, how is it guarded, and for how long?
- **Decision:** `useDocuments` gains:
  ```ts
  // set in beginTurn for every opened entry; undefined in a page that has not sent
  const turnStart = useRef<Map<string, { text: string; saved: string; dirty: boolean }>>();
  const turnEdited = useRef(new Set<string>());     // names applyEdited touched since beginTurn
  type LastTurn = { files: string[] };              // every file the turn edited, in edit order
  lastTurn: LastTurn | undefined;                   // returned from useDocuments
  undoing: boolean;                                 // true while undoTurn runs
  undoTurn(): Promise<void>;
  dismissReview(): void;
  ```
  - `beginTurn` clears `lastTurn` and `turnEdited` and records `{ text: markdownOf(doc), saved: entry.saved, dirty }`
    per opened entry.
  - `applyTurn` sets `lastTurn = { files: [...turnEdited] }` when `turnStart` exists, something was edited, and no
    edited file was saved since Send (its `saves` differs from `turnSaves`). Aborted turns and turns applied after a
    reload through `applyPending` set no `lastTurn`.
  - A Save, move, rename or delete of any file in `lastTurn.files` clears `lastTurn`.
  - `undoTurn` (ignored while `undoing`): a file in `turnStart` gets `replaceMarkdown(doc, start.text)` and
    `dirty = start.dirty || entry.saved !== start.text`; a file not opened at Send but on disk is re-read with
    `followDisk`; a file Claude created is forgotten. A failed read leaves that file as it is and adds
    `{ name, message }` to `notApplied`, shown as "Could not undo Claude's edit to {name}: {message}". Then it clears
    `lastTurn` and the highlights.
  - `dismissReview` clears `lastTurn` and calls `showHighlights(undefined)`. `App.newChat` calls it.
  - The strip's Undo all opens a confirmation (`ConfirmDialog`, D-23): title "Undo Claude's changes?", body "This puts
    {names} back the way {it was|they were} when you pressed Send. Anything you typed in {it|them} since then goes too.
    You can't redo this.", buttons Cancel and "Undo changes". After it finishes, the chat's status region says "Undid
    Claude's changes in {n} {post|posts}." (D-24) and focus moves to the post header's file-name button (D-25).
  - Nothing is added to `viewState()`; Undo all lasts for the page's life.
- **Rationale:** `turnBases` cannot serve: each merge overwrites it (C-14). Capturing the text at Send is the smallest
  record that restores every kind of file a turn can touch. A confirmation that names the posts and says the writer's
  typing goes too replaces Redo: Redo was not in the canvas or the scope, and it could still lose text typed after the
  undo (JD-4, UX-1). Ending the offer on save keeps the disk from holding text Undo all no longer matches (JD-5, UX-2).
- **Evidence:** C-14, C-15, C-16, C-17; JD-4, JD-5; UX-1, UX-2, UX-3, UX-17; test-engineer (Unit 7 edge cases).
- **Behavior impact:** Changing (new). After a finished reply the writer can, after confirming, put every post that
  reply touched back the way it was at Send. What they typed in those posts during the reply goes too, and the dialog
  says so. Undo all clears those posts' ⌘Z history (C-15). Not offered after a reload, for a stopped reply, or once one
  of those posts was saved, moved, renamed or deleted. Settled by the run (D-20).
- **Rejected alternatives:**
  - Redo after Undo all — rejected: not in the canvas or scope, and it overwrote text typed after the undo (JD-4,
    UX-1).
  - Undo only Claude's merges through the y-prosemirror undo manager — rejected: the manager exists only while a file's
    editor is mounted, and merges into unshown files enter no stack (C-15).
  - Persist the Send texts in the view state — rejected under YAGNI.
  - Detect whether the writer typed during the turn and confirm only then — rejected: always confirming is simpler and
    the only other protection would be Redo.
- **Revisit criterion:** A writer asks to reverse an Undo all, loses one through a reload, or asks to undo a stopped
  reply.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** D-23
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes, Deferred (YAGNI), Risks

### D-6: Keep my version records the disk text it dismissed

- **Question:** How can the "changed on disk" notice be dismissed so the next sync does not raise it again?
- **Decision:** In the `Entry` type, `diskChanged?: boolean` becomes:
  ```ts
  diskText?: string;  // the disk text that differs while the entry is dirty
  keptOver?: string;  // the disk text the writer chose to keep their version over
  // syncFile, dirty branch: entry.diskText = text === entry.keptOver ? undefined : text;
  // followDisk and a successful save: entry.diskText = entry.keptOver = undefined;
  keepMyVersion(): void; // current entry: keptOver = diskText; diskText = undefined; rerender()
  // useDocuments still returns diskChanged: entry?.diskText !== undefined
  ```
  The notice reads "This file changed on disk since you opened it. Save overwrites it." with two text buttons, "Use the
  disk version" and "Keep my version". After Keep my version, focus moves to the post header's file-name button (D-25).
  A later disk change with different text raises the notice again.
- **Rationale:** Clearing the boolean alone is undone by the next sync (C-13). A text button, not an icon, because the
  choice decides whether Save overwrites the disk (UX-8).
- **Evidence:** C-13; UX-8; test-engineer (Unit 8: save and Use the disk version clear `keptOver`).
- **Behavior impact:** Changing (new). The writer can dismiss the notice; Save still overwrites the disk. Settled by the
  run (D-20).
- **Rejected alternatives:**
  - Re-baseline `entry.saved` to the disk text — rejected: `saved` also drives read-only and the not-on-disk notice.
  - An icon-only dismiss — rejected (UX-8).
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-17
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-7: One context chip in the message box replaces both ask popups

- **Question:** How do a question pill and a selection reach Claude once the popups are gone, without changing what the
  server receives?
- **Decision:** In `chat/chat/chat.tsx`:
  ```ts
  export type ChatContext =
    | { kind: 'question'; passage: Passage & { label: string } } // only labeled passages render a pill
    | { kind: 'selection'; markdown: string };
  export function composeMessage(text: string, context?: ChatContext): string {
    if (!context) return text;                                       // unchanged: the draft is sent as typed
    if (context.kind === 'question') return `${context.passage.label} — ${text.trim()}`;
    return `About this passage:\n\n${quote(context.markdown)}\n\n${text.trim()}`; // quote: "> " per line, ">" if empty
  }
  // useChatSession adds: context: ChatContext | undefined; attach(context?: ChatContext): void
  // A second attach replaces the first. send(text) keeps its signature and its false-when-blank-or-busy rule (a false
  // send keeps both draft and chip), sends composeMessage(text, context), and clears context on success. context
  // resets with the draft when the session id changes.
  ```
  `Chat` draws the chip above the textarea. A selection chip shows a list icon and the passage's first words in italics;
  a question chip shows the label and the question. Its remove button is named "Remove selected passage" or "Remove
  {label}". The textarea has `aria-describedby` pointing at the chip's text while a context exists. Attaching focuses the
  textarea; removing the chip focuses it too (D-25).
  `App` keeps a question chip while the new highlights still hold a passage with its label. When they do not, and the
  draft is not blank, `App` sets the draft to `composeMessage(draft, context)` (so `Q1 — {text}` survives, as today),
  clears the chip, and the chat's status region says "The question chip was removed because Claude's highlights
  changed." (D-24). A selection chip is never cleared by a highlight change.
- **Rationale:** One way to ask Claude, with the server receiving byte-identical text on every path, including the one
  where highlights change mid-answer (JD-1, UX-5).
- **Evidence:** C-5, C-6; JD-1; UX-5, UX-8, UX-9; test-engineer (Unit 9).
- **Behavior impact:** Changing for the writer (popups gone, chip in the message box). Preserving for the server on
  every path. Settled by the run (D-20).
- **Rejected alternatives:**
  - Clear a question chip on any highlight change (round-1 draft) — rejected: sent the writer's answer without its
    label (JD-1).
  - A new `ChatRequest` field — rejected (D-3).
  - A plain string chip — rejected: loses which message format to build.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-8, D-24, D-25
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-8: Ask callbacks drop the anchor; ⌘K attaches the selection; the popups are deleted

- **Question:** What do the editor's ask paths hand the page once no popup needs an anchor?
- **Decision:**
  ```ts
  onAsk?: (passage: Passage & { label: string }) => void; // was (ask: Ask); type Ask removed
  onAskSelection?: (markdown: string) => void;             // was (ask: SelectionAsk); type SelectionAsk removed
  ```
  `App` wires them to `chat.attach({ kind: 'question', passage })` and `chat.attach({ kind: 'selection', markdown })`.
  The `askingSelection` prop is removed from `MarkdownEditor` and `RawView`; the pinned-selection machinery stays for
  `LinkPopup` and must keep `markdown-editor.test.tsx`'s link-popup selection test passing. `'Mod-k'` is added to the
  editor keymap and to `RawView`'s key handling; both call `askSelection` and return true (consume the key) even when
  the selection is empty, so the browser's own Ctrl+K does not fire. The floating button is named "Ask Claude about the
  selection", shows the platform hint ("⌘K" or "Ctrl+K", D-19) and carries `aria-keyshortcuts="Meta+K"` or
  `"Control+K"`. `src/ui/popups/` is deleted. `components/anchored-bubble/` moves to `documents/markdown-editor/`,
  beside its last importer `link-popup.tsx`.
- **Rationale:** The anchor existed only for `useAnchoredBubble` in the popups (C-5).
- **Evidence:** C-4, C-5, C-6; UX-12; test-engineer (Unit 10).
- **Behavior impact:** Changing. ⌘K (Ctrl+K) attaches the selection; the selection is no longer kept highlighted while
  the writer types the question. Settled by the run (D-20).
- **Rejected alternatives:**
  - Keep the selection pinned for the chip's lifetime — rejected: needs a new editor-to-chat handshake for a highlight
    the chip's quoted text already shows.
- **Revisit criterion:** The writer loses track of which passage a chip refers to.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-9
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-9: New chat asks first and is disabled while Claude works

- **Question:** How does the panel header guard New chat?
- **Decision:**
  ```ts
  AgentPanel({ onNewChat, busy, empty }: { onNewChat: () => void; busy: boolean; empty: boolean })
  // App: empty = chat.messages.length === 0 && !chat.draft.trim() && !chat.context
  ```
  Heading "Claude". The "New chat" button is disabled while `busy` and described by the chat's status region. With an
  empty chat it calls `onNewChat` at once; otherwise it opens a `ConfirmDialog` (D-23): title "Start a new chat?", body
  "This ends the conversation for good and removes Claude's highlights and Undo all. Your posts stay as they are.",
  buttons Cancel and "New chat". Confirming calls `onNewChat` once and focuses the message box; Cancel calls nothing and
  returns focus to New chat. The `claude` prop and `App`'s `claude` state go; the chat mode is no longer shown.
- **Rationale:** Clear Chat erases the conversation without asking (C-18). Disabling it while busy avoids a turn
  running on an abandoned session.
- **Evidence:** C-18, C-23; UX-6; test-engineer (Unit 3); the operator's fix to the canvas (the dialog must sit above
  the chat text).
- **Behavior impact:** Changing. Settled by the run (D-20).
- **Rejected alternatives:**
  - An undo toast after clearing — rejected: the old session is not reachable after a reload (C-18).
  - Keep the CLI/API label — rejected: the audit named it jargon; the scope hides it.
- **Revisit criterion:** The writer wants to know which chat mode is running.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-10: One status line replaces "thinking…" and the Working bar; Stop stays in the message box

- **Question:** How does the chat show that Claude is working, and that it finished?
- **Decision:** `Chat` shows the status line above the message box while busy: a spinner (still under
  `prefers-reduced-motion`) and "Claude is working on {file}" when the latest tool part names a file, else "Claude is
  working…". Its text changes only when the file changes. Announcements go through the chat's status region (D-24),
  which says the same sentence when busy starts or the file changes, and "Claude finished." when a turn ends.
  `WorkingBar` and "thinking…" are removed. The Send button becomes Stop while busy, as today.
  ```ts
  export function workingFile(messages: UIMessage[]): string | undefined; // last tool part's file_path, trimmed as toolSummary does
  ```
- **Rationale:** Today three indicators show at once and the Working bar's text changes every 300 ms in a live region
  (C-9). "Working on" because the last tool may be a read (UX-11).
- **Evidence:** C-9; UX-7, UX-11; canvas screen 2 keeps Stop in the message box.
- **Behavior impact:** Changing. Settled by the run (D-20).
- **Rejected alternatives:**
  - Move Stop into the status line (architect) — rejected: the canvas shows Stop in the message box.
  - "Claude is editing {file}" (canvas) — rejected: wrong while Claude is only reading (UX-11).
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** D-11, D-24
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-11: Tool activity folds into one counted summary line per reply

- **Question:** How are tool calls shown under a reply?
- **Decision:** `Message` collects a message's tool parts into one `<details>` drawn where the first tool part was. Its
  summary is `toolLine(parts)`; opening it shows today's per-tool lines.
  ```ts
  export function toolLine(parts: ToolUIPart[]): string;
  // Read ×2, Edit ×3 → 'Read 2 files, made 3 edits'
  // Read ×1 → 'Read 1 file'; Edit ×1 and Write ×1 → 'Made 2 edits' (Write counts as an edit)
  // any other tools → ', used N other tools' appended (or 'Used N other tools' alone); 'tool' when N is 1
  // ' (working)' appended while any part is running
  ```
- **Rationale:** The canvas shows one line; naming only Read and Edit and counting the rest keeps the rules small
  (JD-8, UX-16).
- **Evidence:** C-9; canvas screen 1; JD-8; UX-16; test-engineer (Unit 12: pin the cases).
- **Behavior impact:** Changing. Settled by the run (D-20).
- **Rejected alternatives:**
  - "Read draft.md, Edit draft.md · done" (architect) — rejected: still tool names.
  - Wording for every tool (round-1 draft) — rejected under YAGNI (JD-8).
- **Revisit criterion:** A writer finds "used N other tools" unclear.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-12: The file tree says why it is paused

- **Question:** How does the tree explain its lock?
- **Decision:** `FileTree` keeps one always-mounted `<p className="paused" role="status" id="tree-paused">` below the
  tree. Its text is "Changes to the post list are paused while Claude works. You can still open posts." while busy and
  empty otherwise (hidden when empty). The lock itself is unchanged.
- **Rationale:** The lock has no visible reason (C-10). It also blocks creating and deleting, so "moving and renaming"
  was inaccurate (UX-10). A live region announces only text that changes inside it (UX-7).
- **Evidence:** C-10; UX-7, UX-10.
- **Behavior impact:** Changing (a new note). Settled by the run (D-20).
- **Rejected alternatives:** — none worth recording.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-13
- **Dependent decisions:** D-14
- **Referenced in plan:** Surface Delta, Behavior Changes

### D-13: Actions move into the chat feature, get plain names, and appear as suggestions in an empty chat

- **Question:** Where do the agent actions live and how are they named?
- **Decision:** `components/agent-actions/` moves to `chat/chat/actions.tsx` and `actions.css`.
  ```ts
  export const ACTIONS: { label: string; hint: string; icon: string; skill: string }[] = [
    { label: 'Proofread', hint: 'Fix spelling, grammar and typos', icon: 'proofread', skill: 'proofread' },
    { label: 'Edit together', hint: 'Go through the post section by section', icon: 'collaborate', skill: 'collaborative-editing' },
    { label: 'Research', hint: 'Check claims and find sources', icon: 'research', skill: 'research' },
  ];
  export function ActionsMenu({ onChoose }: { onChoose: (command: string) => void }): JSX.Element;
  ```
  The menu button reads "Actions". An empty chat shows "Claude edits right in your post. Its changes show up as unsaved,
  so nothing is written until you save.", a "Try" label, and one button per action (title and hint). Each puts
  `/${skill} ` into the draft, as the menu does, and focuses the textarea with the caret at the end.
- **Rationale:** Once `SelectionPopup` is gone, `Chat` is the only importer (README: shared code lives in the lowest
  folder covering its users). The "/" glyph gives no clue to its purpose.
- **Evidence:** C-7, C-8; UX-14.
- **Behavior impact:** Changing. Settled by the run (D-20).
- **Rejected alternatives:**
  - Send the action at once on click — rejected: today an action fills the draft so the writer can add to it.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-14: The empty editor offers New post through a request counter

- **Question:** How does a button in `Editor` open the file tree's private new-file dialog?
- **Decision:** Copy the existing `finds`/`findInDocs` pattern:
  ```ts
  // useDocuments
  newPosts: number;              // starts at 0
  requestNewPost(): void;        // newPosts + 1
  // FileTree
  useEffect(() => { if (docs.newPosts && !busy) createItems('')[0].run(); }, [docs.newPosts]);
  // Editor gains busy: boolean (App passes chat.busy); the New post button is disabled while busy and has
  // aria-describedby="tree-paused"
  ```
  The empty state reads "Pick a post to start", "Choose a post from the list, or start a new one. Claude can help once
  a post is open.", and a New post button.
- **Rationale:** The dialog is FileTree's private state; the `finds` counter already crosses this seam.
- **Evidence:** C-8, C-10; `documents.tsx:58`, `file-tree.tsx:117-128`; UX-10.
- **Behavior impact:** Changing. Settled by the run (D-20).
- **Rejected alternatives:**
  - Lift the dialog into `App` — rejected: moves about 90 lines for one button.
- **Revisit criterion:** A third caller needs to open a tree dialog.
- **Dissent (if any):** None.
- **Settles delta entry:** S-15
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-15: Notices are neutral by default and red when they report an error

- **Question:** How are errors told apart from information?
- **Decision:** `.notice` moves from `documents.css` to `styles.css` as the neutral style. `.notice.error` is red
  (`--bad` icon and border on `--bad-soft`) and always goes with `role="alert"`. Every notice that has `role="alert"`
  today gets `error`. App's chat-load error and Chat's error, which are `<div className="error">` with no role today,
  become `notice error` with `role="alert"`. Each notice gets a leading inline SVG icon with `aria-hidden="true"`
  (circle-! for errors, circle-i for information), so it adds no text content. No `<Notice>` component.
- **Rationale:** All eight notices look the same today (C-12). Chat and App errors are errors, and screen-reader users
  should hear them (JD-3, UX-13).
- **Evidence:** C-12, C-20; JD-3; UX-13, UX-18; test-engineer (Unit 1: the icon must add no text).
- **Behavior impact:** Changing (look). Chat and App errors are newly announced to screen-reader users. Settled by the
  run (D-20).
- **Rejected alternatives:**
  - A `<Notice>` component — rejected under YAGNI: two classes cover it.
- **Revisit criterion:** Notices gain dismiss or actions in three or more places.
- **Dissent (if any):** None.
- **Settles delta entry:** S-16
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes, Deferred (YAGNI)

### D-16: No top bar; a banner appears only when the connection is lost

- **Question:** Where do the app name and the connection state go?
- **Decision:** `<header className="topbar">` and its CSS are removed; "3pitor" moves into the Posts panel's header
  beside "+", over the "Posts" label. `useHostEvents` returns `boolean | undefined`: `undefined` until the socket first
  opens or closes. App shows a banner with `role="alert"`, "Lost touch with 3pitor. Is it still running in your
  terminal? Trying again…", only when it is `false`. The banner is `position: fixed` across the top of the page, so it
  does not push the post down. When the connection returns, the banner goes and the chat's status region says
  "Reconnected to 3pitor." (D-24).
- **Rationale:** The dot gates nothing and shows "disconnected" on every first load (C-19). A fixed banner does not
  move the text being typed (UX-15).
- **Evidence:** C-19, C-20; UX-15; test-engineer (Unit 2: recovery).
- **Behavior impact:** Changing. Settled by the run (D-20).
- **Rejected alternatives:**
  - Show the banner only after a first successful connect — rejected: a server that is down at page load is the same
    problem and deserves the same banner.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-17: The canvas's palette and local font stacks

- **Question:** What colors and fonts does the app use?
- **Decision:** `styles.css` tokens take the canvas's palette (`canvas-reference.md`, "Palette and type"), with
  dark-mode values for every token, including `--ok`, `--warn` and `--bad`, which have none today. New tokens:
  `--bad-soft`, `--info-soft`, `--unsaved`, `--change`, `--change-line`, `--question`, `--question-line`, `--font-ui`,
  `--font-post`, `--font-mono`. Text on each fill keeps 4.5:1, and `--change-line` keeps 3:1 against the post ground.
  No web fonts load: `--font-ui` is the system sans stack already in use, `--font-post` is `'Iowan Old Style',
  'Palatino Linotype', Georgia, serif` at 18px/1.7 for the rendered post, and `--font-mono` is the system monospace
  stack for the Markdown view. Buttons are 32–36px tall.
- **Rationale:** The canvas sets the look; IBM Plex and Literata are web fonts a local editor should not fetch.
- **Evidence:** C-20; canvas; UX-18.
- **Behavior impact:** Changing (look). Settled by the run (D-20).
- **Rejected alternatives:**
  - Load IBM Plex and Literata from Google Fonts — rejected: a local editor should not call out to a font CDN.
  - Bundle the font files — rejected under YAGNI.
- **Revisit criterion:** The operator asks for the exact canvas fonts.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes, Deferred (YAGNI)

### D-18: Claude has one name, and the panels have plain names

- **Question:** Which words change?
- **Decision:** "AI" and "Agent" become "Claude" in every user-visible string, including `documents.tsx:326` ("it was
  saved while Claude was working; ask again") and `:664` ("Could not apply Claude's edit to {name}"),
  `raw-view.tsx:29`, the ask-button names, and the composer placeholder: "Ask Claude about this post…" with a post
  open, "Ask Claude…" without one. "Clear Chat" becomes "New chat". "Documents" becomes "Posts". "unsaved
  changes"/"saved" becomes "Unsaved"/"Saved".
- **Rationale:** The audit found four names for Claude.
- **Evidence:** C-11, C-12, C-21, C-23; UX OQ3 (the placeholder with no post open).
- **Behavior impact:** Changing (copy). Settled by the run (D-20).
- **Rejected alternatives:** — none worth recording.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-18
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes

### D-19: The post header's file name replaces "Find in docs"; shortcut hints follow the platform

- **Question:** What happens to the magnifier button, and how are shortcuts shown?
- **Decision:** The header shows the folder in muted text and the file name as a button named "Show {name} in Posts"
  that runs the existing `findInDocs`. With no file open there is no name button and no Unsaved/Saved text. The
  magnifier goes. Mod-S stays in `Editor`. Shortcut hints come from one helper in `components/`:
  ```ts
  export const isMac: boolean;                      // /Mac|iPhone|iPad/.test(navigator.platform)
  export function shortcut(key: string): string;    // shortcut('S') === '⌘S' on a Mac, 'Ctrl+S' elsewhere
  ```
  Save shows `shortcut('S')`; the ask button shows `shortcut('K')`.
- **Rationale:** The magnifier promised search; the name is where the writer looks. "Mod" is Ctrl off the Mac (UX-12).
- **Evidence:** C-11; UX-12; test-engineer (Unit 4: the "off while no file is open" case).
- **Behavior impact:** Changing. Settled by the run (D-20).
- **Rejected alternatives:**
  - Drop the reveal entirely — rejected: `finds` wiring already exists and is used.
  - Mac-only hints — rejected (UX-12).
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-23: One confirmation dialog component, used by New chat and Undo all

- **Question:** How are the two confirmations built so they behave the same for keyboard and screen-reader users?
- **Decision:** New `components/confirm-dialog/confirm-dialog.tsx` and `.css`:
  ```ts
  export function ConfirmDialog(props: {
    title: string;
    body: string;
    confirm: string;            // the confirm button's text
    onConfirm: () => void;
    onCancel: () => void;
  }): JSX.Element;
  ```
  It renders a native `<dialog>` opened with `showModal()` on mount, `aria-labelledby` its title and
  `aria-describedby` its body. Initial focus is on Cancel. Escape and Cancel call `onCancel`; the confirm button calls
  `onConfirm`. The caller decides where focus goes afterwards (D-25). It draws above everything, so nothing shows
  through it.
- **Rationale:** Two concrete users (D-5, D-9) with identical needs; a native modal dialog gives focus trapping and
  Escape for free.
- **Evidence:** UX-6; D-5; D-9.
- **Behavior impact:** Changing (new dialogs). Settled by the run (D-20).
- **Rejected alternatives:**
  - A hand-built positioned popover (as drawn on the canvas) — rejected: no focus trap or Escape, and it is what showed
    text through it on the canvas.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-19
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

### D-24: One always-mounted status region in the chat carries every announcement

- **Question:** How are status changes announced to screen-reader users?
- **Decision:** `Chat` renders one `<p role="status" id="chat-status" className="visually-hidden">` that is always in
  the page; only its text changes. `useChatSession` exposes `announce(text: string): void`, which sets that text. Its
  messages: "Claude is working on {file}." / "Claude is working." when busy starts or the file changes; "Claude
  finished." when a turn ends; "Undid Claude's changes in {n} {post|posts}." (D-5); "The question chip was removed
  because Claude's highlights changed." (D-7); "Reconnected to 3pitor." (D-16). The visible status line (D-10) has no
  role of its own. New chat is described by this region (D-9).
- **Rationale:** Live regions that mount already filled are often not announced, and the end of a turn was silent
  (UX-7).
- **Evidence:** C-9; UX-7.
- **Behavior impact:** Changing (new announcements). Settled by the run (D-20).
- **Rejected alternatives:**
  - A role on each visible element — rejected: they mount with their text (UX-7).
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-25: Focus goes somewhere sensible when the focused control disappears

- **Question:** Where does focus go after an action removes the button that had it?
- **Decision:**
  | After | Focus moves to |
  | ----- | -------------- |
  | Attaching a chip (pill, ask button, ⌘K) | the message box |
  | Removing a chip | the message box |
  | Choosing an action | the message box, caret at the end |
  | Dismiss review, Undo all (after it finishes), Keep my version | the post header's file-name button |
  | New chat confirmed | the message box |
  | New chat cancelled | the New chat button |
  `Editor` exposes nothing new for this: the file-name button is its own element.
- **Rationale:** Each of these unmounts the focused button, dropping focus to the page (UX-8).
- **Evidence:** UX-8, UX-14.
- **Behavior impact:** Changing (keyboard focus). Settled by the run (D-20).
- **Rejected alternatives:**
  - Focus the editor's text after a dismiss — rejected: the editor's view is internal to `MarkdownEditor`; the
    file-name button sits beside the strip.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-5, S-8, S-17
- **Dependent decisions:** —
- **Referenced in plan:** Target State

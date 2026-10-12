# Change Decision Log: Simplified UI Redesign

The plan lives in [../change-plan.md](../change-plan.md). Evidence about today's code lives in
[current-state-findings.md](current-state-findings.md) as `C-N` findings. The scope is in
[scope-boundary.md](scope-boundary.md).

Every escalation and behavior-change gate in this run was settled by the run itself, under the operator's standing
preference to "make the best decisions you can, without asking me" (recorded in memory, 2026-10-01, and restated in the
scope turn on 2026-10-12). Each behavior change is listed in the plan's Behavior Changes section for the operator to
read after the fact.

## Trivial decisions

- D-20: Escalations settled by the run — every question and behavior-change gate is decided here and reported in the
  plan, per the operator's standing preference. — Referenced in plan: Why This Change, Behavior Changes.
- D-21: Team size — Medium (several UI features, many behavior-changing entries): `junior-developer`,
  `user-experience-designer`, `test-engineer`. — Referenced in plan: Review Findings.
- D-22: Visual reference — the Claude Design canvas (https://claude.ai/artifact/6c5te377PrvthBUEEwzN4G) is the
  reference for layout, copy and color; where this log and the canvas disagree, this log wins and says why. —
  Referenced in plan: Target State.

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
  reads "Text" instead of "Type...". The canvas's "Paragraph" label that tracks the block type is not built. Settled by
  the run (D-20).
- **Rejected alternatives:**
  - A React toolbar with a live block-type label — rejected: re-implements `rawAware` for every item for one label.
  - Leaving the toolbar untouched — rejected: the audit named Join up, Lift and Select parent as jargon.
- **Revisit criterion:** The writer asks for the dropdown to show the current block type.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-2: The Formatted/Markdown switch moves into the post header

- **Question:** Where does the mode switch live once the editor's controls stop depending on the menubar?
- **Decision:** `Editor` (`documents.tsx`) renders it in the post header, reading `docs.mode` and calling
  `docs.setMode`. Labels are "Formatted" and "Markdown"; the stored `ViewState.mode` values stay `'rendered' | 'raw'`.
  The switch is shown but disabled for a read-only file. `MarkdownEditor` loses its `onModeChange` prop and keeps
  `mode` as an input; `raw = mode === 'raw' && !readOnly` stays.
- **Rationale:** `mode` already lives in `useDocuments` and persists in the view state, so the switch's state is
  already above the editor. Today the switch vanishes with the menubar on read-only files.
- **Evidence:** C-2, C-11, C-17 (read-only behavior in B-17).
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
  the server receives stay as they are.
- **Rationale:** The chip folds its context into `text` exactly as the popups do; Undo all works from text the client
  captures; the connection state already reaches the UI.
- **Evidence:** C-5, C-22; architect's review of `src/shared/wire.ts`.
- **Behavior impact:** Preserving for every caller outside `src/ui/`.
- **Rejected alternatives:**
  - A new `ChatRequest.context` field — rejected: changes the wire for no gain; the model already reads the quoted
    format.
  - Persisting Undo all in the view state — rejected under YAGNI; see D-5.
- **Revisit criterion:** A screen needs data only the server has.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** D-5, D-7
- **Referenced in plan:** What Changes, In One Paragraph; Target State

### D-4: A review strip replaces the highlight bar and shows on read-only files

- **Question:** Where does the review strip live, and what does it count?
- **Decision:** New `documents/markdown-editor/review-strip.tsx` and `review-strip.css`. `MarkdownEditor` renders it as
  a plain React sibling before the `.rich-editor` host, not a portal, and still owns count, current and stepping. It
  shows whenever the open file has highlights or `docs.lastTurn` exists, and returns `null` otherwise. Its summary
  counts the file's passages: unlabeled ones are changes, labeled ones are questions.
  ```ts
  export function ReviewStrip(props: {
    passages: Passage[];               // the open file's highlights
    placed: number;                    // passages found in the text (today's `count`)
    current: number;                   // 0-based index of the outlined passage
    onStep: (step: -1 | 1) => void;    // MarkdownEditor's stepHighlight
    turn?: { undone: boolean; onUndoAll: () => void; onRedo: () => void }; // only when docs.lastTurn exists
    onDismiss: () => void;
  }): JSX.Element | null;
  export function reviewSummary(passages: Passage[]): string;
  // reviewSummary([{quote:'a'},{quote:'b'},{quote:'c',label:'Q1',question:'?'}])
  //   === 'Claude changed 2 passages and left 1 question'
  // one change, no questions: 'Claude changed 1 passage'; only questions: 'Claude left 1 question'
  // no passages but a turn: 'Claude changed other posts'
  ```
  The position text reads `{current + 1} of {placed}` with `(N not found)` appended when some passages were not placed,
  or `No passages found` when `placed` is 0. The step buttons keep the names "Previous highlight" and "Next highlight".
  `MarkdownEditor`'s `onClearHighlights?: () => void` prop becomes `review?: { turn?: ReviewStrip['turn']; onDismiss: () => void }`.
- **Rationale:** A sibling outside the scroll host stays in view and cannot be hidden by the read-only menubar rule. The
  engine marks every changed block as an unlabeled passage and every question as a labeled one, so the counts need no
  new data.
- **Evidence:** C-1, C-2, C-17.
- **Behavior impact:** Changing. The writer sees "Claude changed 3 passages and left 1 question" with previous/next,
  Undo all and a dismiss button, where they saw "Highlight 1 of 4" and Clear. The strip now shows on read-only files.
  A label-less question would count as a change (the engine asks for labels; C-17). Settled by the run (D-20).
- **Rejected alternatives:**
  - Lift count/current/step into `Editor` — rejected: they are driven by `highlightsPlugin` inside the editor.
  - Inline the strip in `markdown-editor.tsx` — rejected: the file is 970 lines and the highest-churn file in the area.
- **Revisit criterion:** The engine starts recording changed passages separately from highlights.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5, S-7
- **Dependent decisions:** D-5
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-5: Undo all restores each file to its text at Send; Redo puts back what Undo replaced

- **Question:** What exactly does Undo all restore, for which turns, and for how long?
- **Decision:** `useDocuments` gains:
  ```ts
  // set in beginTurn for every opened entry; undefined in a page that has not sent
  const turnStart = useRef<Map<string, { text: string; dirty: boolean }>>();
  const turnEdited = useRef(new Set<string>());     // names applyEdited touched since beginTurn
  type LastTurn = {
    files: string[];                                // every file the turn edited
    undone: boolean;
    replaced?: Record<string, string>;              // text Undo all replaced, per file; set by undoTurn
    highlights?: SessionHighlights;                 // highlights Undo all cleared; set by undoTurn
  };
  lastTurn: LastTurn | undefined;                   // returned from useDocuments
  undoTurn(): Promise<void>;
  redoTurn(): void;
  dismissReview(): void;
  ```
  - `beginTurn` clears `lastTurn` and `turnEdited` and records `{ text: markdownOf(doc), dirty }` per opened entry.
  - `applyTurn` sets `lastTurn = { files: [...turnEdited], undone: false }` when `turnStart` exists and something was
    edited. Aborted turns and turns applied after a reload through `applyPending` set no `lastTurn`.
  - `undoTurn` stores each file's current text in `replaced`, then: a file in `turnStart` gets `replaceMarkdown(doc,
    start.text)` and `dirty = start.dirty`; a file not opened at Send but on disk is re-read with `followDisk`; a file
    Claude created is forgotten. It stashes and clears the highlights and sets `undone = true`.
  - `redoTurn` puts each `replaced` text back (`replaceMarkdown`, or `load` for a forgotten file), sets `dirty = true`,
    restores the stashed highlights and sets `undone = false`.
  - `dismissReview` sets `lastTurn` to `undefined` and calls `showHighlights(undefined)`. `App.newChat` calls it in
    place of `docs.showHighlights(undefined)`.
  - Nothing is added to `viewState()`; Undo all lasts for the page's life.
- **Rationale:** `turnBases` cannot serve: each merge overwrites it (C-14). Capturing the text at Send is the smallest
  record that restores every kind of file a turn can touch. Redo uses the text at the moment of Undo, so whatever the
  writer typed during the turn comes back with it.
- **Evidence:** C-14, C-15, C-16, C-17.
- **Behavior impact:** Changing (new). After a finished turn the writer can put every edited file back as it was when
  they pressed Send, and then redo. Undo all also reverts what the writer typed into those files while Claude worked;
  Redo returns it. `replaceMarkdown` clears that file's Mod-Z history (C-15). Not offered after a reload or for a
  stopped turn. Settled by the run (D-20).
- **Rejected alternatives:**
  - Undo only Claude's merges through the y-prosemirror undo manager — rejected: the manager exists only while a file's
    editor is mounted, and merges into unshown files enter no stack (C-15).
  - Persist the Send texts in the view state — rejected under YAGNI (no evidence of reload-then-undo).
  - Ask for confirmation before Undo all — rejected: Redo makes it reversible.
- **Revisit criterion:** The writer loses an Undo all through a reload, or asks to undo a stopped turn.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes, Deferred (YAGNI)

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
  The notice gains a "Keep my version" icon button beside "Use the disk version". A later disk change with different
  text raises the notice again.
- **Rationale:** Clearing the boolean alone is undone by the next sync (C-13).
- **Evidence:** C-13.
- **Behavior impact:** Changing (new). The writer can dismiss the notice; Save still overwrites the disk, as the notice
  already says. Settled by the run (D-20).
- **Rejected alternatives:**
  - Re-baseline `entry.saved` to the disk text — rejected: `saved` also drives read-only and the not-on-disk notice.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-17
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-7: One context chip in the message box replaces both ask popups

- **Question:** How do a question pill and a selection reach Claude once the popups are gone?
- **Decision:** In `chat/chat/chat.tsx`:
  ```ts
  export type ChatContext = { kind: 'question'; passage: Passage } | { kind: 'selection'; markdown: string };
  export function composeMessage(text: string, context?: ChatContext): string {
    if (!context) return text;                                       // unchanged: the draft is sent as typed
    if (context.kind === 'question') return `${context.passage.label} — ${text.trim()}`;
    return `About this passage:\n\n${quote(context.markdown)}\n\n${text.trim()}`; // quote: "> " per line, ">" if empty
  }
  // useChatSession adds: context: ChatContext | undefined; attach(context?: ChatContext): void
  // send(text) keeps its signature and its false-when-blank-or-busy rule, sends composeMessage(text, context),
  // and clears context on success. context resets with the draft when the session id changes.
  ```
  `Chat` draws the chip above the textarea (selection: the passage's first words in italics; question: the label and
  question), with a "Remove" button named "Remove {label or 'selected passage'}". It focuses the textarea when a
  context is attached. `App` clears a question chip when `docs.highlights` changes, replacing the draft-moving effect;
  a selection chip stays.
- **Rationale:** One way to ask Claude, with the server receiving byte-identical text.
- **Evidence:** C-5, C-6; the UX audit's P2.
- **Behavior impact:** Changing for the writer (popups gone, chip in the message box; a question chip vanishes when the
  highlights change, where today the popup's typed text moved into the chat box — with the chip, the typed text is
  already in the chat box). Preserving for the server: the same text is sent. Settled by the run (D-20).
- **Rejected alternatives:**
  - A new `ChatRequest` field — rejected (D-3).
  - A plain string chip — rejected: loses which message format to build.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-8
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-8: Ask callbacks drop the anchor; ⌘K attaches the selection; the popups are deleted

- **Question:** What do the editor's ask paths hand the page once no popup needs an anchor?
- **Decision:**
  ```ts
  onAsk?: (passage: Passage) => void;           // was (ask: Ask); type Ask removed
  onAskSelection?: (markdown: string) => void;  // was (ask: SelectionAsk); type SelectionAsk removed
  ```
  `App` wires them to `chat.attach({ kind: 'question', passage })` and `chat.attach({ kind: 'selection', markdown })`.
  The `askingSelection` prop is removed from `MarkdownEditor` and `RawView`; the pinned-selection machinery stays for
  `LinkPopup`. `'Mod-k'` is added to the editor keymap and to `RawView`'s key handling, both calling the existing
  `askSelection`. The floating button's name becomes "Ask Claude about the selection". `src/ui/popups/` is deleted.
  `components/anchored-bubble/` moves to `documents/markdown-editor/`, beside its last importer `link-popup.tsx`.
- **Rationale:** The anchor existed only for `useAnchoredBubble` in the popups (C-5).
- **Evidence:** C-4, C-5, C-6; no existing Mod-k binding in `prosemirror-example-setup` (architect's grep).
- **Behavior impact:** Changing. ⌘K attaches the selection; the selection is no longer kept highlighted while the
  writer types the question. Settled by the run (D-20).
- **Rejected alternatives:**
  - Keep the selection pinned for the chip's lifetime — rejected: needs a new editor-to-chat handshake for a
    highlight the chip's quoted text already shows.
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
  ```
  Heading "Claude". The "New chat" button is disabled while `busy`. With an empty chat it starts a new one at once;
  otherwise local `confirming` state shows a dialog, drawn above the chat: "Start a new chat?", "This clears the
  conversation and Claude's highlights. Your post and its edits stay as they are.", Cancel and New chat. The `claude`
  prop and `App`'s `claude` state go; the chat mode is no longer shown.
- **Rationale:** Clear Chat erases the conversation without asking (C-18). Disabling it while busy avoids a turn
  running on an abandoned session.
- **Evidence:** C-18, C-23; the operator's fix to the canvas (the dialog must sit above the chat text).
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

- **Question:** How does the chat show that Claude is working?
- **Decision:** While `busy`, `Chat` shows one status line above the message box: "Claude is editing {file}" when the
  latest tool part names a file, else "Claude is working…", with a spinner that respects `prefers-reduced-motion`. Its
  text changes only when the file changes. `WorkingBar` and "thinking…" are removed. The Send button becomes Stop while
  busy, as today.
  ```ts
  export function workingFile(messages: UIMessage[]): string | undefined; // last tool part's file_path, trimmed as toolSummary does
  ```
- **Rationale:** Today three indicators show at once and the Working bar's text changes every 300 ms in a live region
  (C-9).
- **Evidence:** C-9; the canvas's screen 2 keeps Stop in the message box.
- **Behavior impact:** Changing. Settled by the run (D-20).
- **Rejected alternatives:**
  - Move Stop into the status line (the architect's proposal) — rejected: the canvas shows Stop in the message box.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** D-11
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-11: Tool activity folds into one counted summary line per reply

- **Question:** How are tool calls shown under a reply?
- **Decision:** `Message` collects a message's tool parts into one `<details>` drawn where the first tool part was. Its
  summary is a count line; opening it shows today's per-tool lines.
  ```ts
  export function toolLine(parts: ToolUIPart[]): string;
  // Read ×2, Edit ×3 → 'Read 2 files, made 3 edits'; Glob → 'searched 1 time'; Highlight → 'highlighted 1 passage list'
  // first letter capitalized; ' · running' appended while any part is running
  ```
- **Rationale:** The audit named raw tool chips as developer jargon; the canvas shows one line.
- **Evidence:** C-9; canvas screen 1.
- **Behavior impact:** Changing. Settled by the run (D-20).
- **Rejected alternatives:**
  - "Read draft.md, Edit draft.md · done" (architect) — rejected: still tool names.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-12: The file tree says why it is paused

- **Question:** How does the tree explain its lock?
- **Decision:** `FileTree` renders `{busy && <p className="paused" role="status">Moving and renaming are paused while
  Claude works.</p>}` below the tree. The lock itself is unchanged.
- **Rationale:** The lock has no visible reason (C-10).
- **Evidence:** C-10.
- **Behavior impact:** Changing (a new note). Settled by the run (D-20).
- **Rejected alternatives:** — none worth recording.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-13
- **Dependent decisions:** —
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
  The menu button reads "Actions". An empty chat shows the intro sentence from the canvas and one button per action;
  each puts `/${skill} ` into the draft, as the menu does.
- **Rationale:** Once `SelectionPopup` is gone, `Chat` is the only importer (README: shared code lives in the lowest
  folder covering its users). The "/" glyph gives no clue to its purpose (audit P8).
- **Evidence:** C-7, C-8.
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
  // Editor gains busy: boolean (App passes chat.busy); the New post button is disabled while busy
  ```
  The empty state reads "Pick a post to start", "Choose a post from the list, or start a new one. Claude can help once
  a post is open.", and a New post button.
- **Rationale:** The dialog is FileTree's private state; the `finds` counter already crosses this seam.
- **Evidence:** C-8, C-10; `documents.tsx:58`, `file-tree.tsx:117-128`.
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
  (`--bad` text and border on `--bad-soft`) and always goes with `role="alert"`. Every notice that has
  `role="alert"` today gets `error`; the others stay neutral. App's and Chat's `.error` text becomes `notice error`.
  Each notice gets a leading icon (`aria-hidden`). No `<Notice>` component.
- **Rationale:** All eight notices look the same today (C-12).
- **Evidence:** C-12, C-20.
- **Behavior impact:** Changing (look only; roles and text unchanged except D-18's renames). Settled by the run (D-20).
- **Rejected alternatives:**
  - A `<Notice>` component — rejected under YAGNI: two classes cover it.
- **Revisit criterion:** Notices gain dismiss or actions in three or more places.
- **Dissent (if any):** None.
- **Settles delta entry:** S-16
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes, Deferred (YAGNI)

### D-16: No top bar; a banner appears only when the connection is lost

- **Question:** Where do the app name and the connection state go?
- **Decision:** `<header className="topbar">` and its CSS are removed; `.app` becomes a column holding an optional banner
  and `.main`. "3pitor" moves into the Posts panel's header beside "+". `useHostEvents` returns
  `boolean | undefined`: `undefined` until the socket first opens or closes. App shows a banner with `role="alert"`,
  "Lost touch with 3pitor. Is it still running in your terminal? Trying again…", only when it is `false`.
- **Rationale:** The dot gates nothing and shows "disconnected" on every first load (C-19).
- **Evidence:** C-19, C-20.
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
- **Decision:** `styles.css` tokens take the canvas's palette, with dark-mode values for every token (including `--ok`,
  `--warn`, `--bad`, which have none today). New tokens: `--bad-soft`, `--info-soft`, `--unsaved`, `--change`,
  `--change-line`, `--question`, `--question-line`, `--font-ui`, `--font-post`, `--font-mono`. No web fonts load: the
  app runs locally and may be offline, so `--font-ui` is the system sans stack already in use, `--font-post` is
  `'Iowan Old Style', 'Palatino Linotype', Georgia, serif` at 18px/1.7 for the post text (rendered view only), and
  `--font-mono` is the system monospace stack for the Markdown view. Buttons are 32–36px tall.
- **Rationale:** The canvas sets the look; IBM Plex and Literata are web fonts the local app should not fetch.
- **Evidence:** C-20; canvas.
- **Behavior impact:** Changing (look). Settled by the run (D-20).
- **Rejected alternatives:**
  - Load IBM Plex and Literata from Google Fonts — rejected: a local editor should not call out to a font CDN.
  - Bundle the font files — rejected under YAGNI: the system stacks carry the same look closely enough.
- **Revisit criterion:** The operator asks for the exact canvas fonts.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-18: Claude has one name, and the panels have plain names

- **Question:** Which words change?
- **Decision:** "AI" and "Agent" become "Claude" in every user-visible string, including `documents.tsx:326` ("it was
  saved while Claude was working; ask again") and `:664` ("Could not apply Claude's edit to {name}"),
  `raw-view.tsx:29`, the ask-button names, and the composer placeholder ("Ask Claude about this post…"). "Clear Chat"
  becomes "New chat". "Documents" becomes "Posts". "Unsaved changes"/"saved" becomes "Unsaved"/"Saved".
- **Rationale:** The audit found four names for Claude (P7).
- **Evidence:** C-11, C-12, C-21, C-23.
- **Behavior impact:** Changing (copy). Settled by the run (D-20).
- **Rejected alternatives:** — none worth recording.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-18
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes

### D-19: The post header's file name replaces "Find in docs"

- **Question:** What happens to the magnifier button that reveals the open file in the tree?
- **Decision:** The header shows the folder in muted text and the file name as a button named "Show {name} in Posts"
  that runs the existing `findInDocs`. The magnifier goes. "Unsaved"/"Saved" shows only when a file is open. Mod-S stays
  in `Editor`. The Save button shows "⌘S" as a hint.
- **Rationale:** The magnifier promised search (audit P8); the name is where the writer looks.
- **Evidence:** C-11.
- **Behavior impact:** Changing. Settled by the run (D-20).
- **Rejected alternatives:**
  - Drop the reveal entirely — rejected: `finds` wiring already exists and is used.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

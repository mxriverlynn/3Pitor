# Current State Findings: Simplified UI Redesign

## Provenance

Produced by this run's own discovery round on 2026-10-12. No prior findings report existed.

- `han-core:structural-analyst` over `src/ui/` (and what it imports from `src/shared/`). Its findings S-1 to S-14 are
  folded in below.
- `han-core:behavioral-analyst` over `src/ui/`, reading `src/shared/wire.ts` and the engine and server only where the
  UI depends on them. Its findings B-1 to B-17 are folded in below.
- `han-core:concurrency-analyst` was not dispatched. The one concurrent path in the area, a Claude turn merging while
  the writer types, is a Yjs merge already covered by B-3 and B-4.
- An earlier `han-core:user-experience-designer` audit in the same session (not a file) shaped the design itself; it
  is cited by the scope record, not here.

Paths are relative to `src/ui/` unless they start with `src/`.

## Project Context

- **Stack:** Bun + TypeScript. The browser app is React 19 with ProseMirror (`prosemirror-example-setup`,
  `prosemirror-menu`) bound to Yjs through `y-prosemirror`. UI tests run under `bun test` against happy-dom with
  Testing Library (`src/ui/test-setup.ts`). `make test` runs `tsc --noEmit`, the Node check, server tests and UI tests.
- **Conventions source:** `README.md`, section "How `src/` is laid out": packages, then features, then components; CSS
  sits beside its component; shared code goes in the lowest `components/` folder that covers its users. No CLAUDE.md.
- **ADRs found:** none found under `docs/adr/`. Earlier change plans live in `docs/changes/<name>/`.
- **Coding standards found:** none found.
- **Recent churn (90 days):** `markdown-editor.test.tsx` 48 commits, `markdown-editor.tsx` 42, `app.tsx` 26,
  `raw-formatting.ts` 20, `documents.tsx` 19, `markdown-editor.css` 17, `wire.ts` 16, `file-tree.test.tsx` 16.

## Gaps

- No ADR or coding standard covers UI styling, tokens, or copy. The design canvas is the only style reference.
- No design tokens beyond the 15 custom properties in `styles.css`; no error-background or info-background token.
- No per-turn record of which passages Claude changed, and no stored pre-turn text (C-14, C-17).
- No test covers the toolbar's Insert, Type, Join, Lift or Select parent labels.

## Findings

### C-1: `MarkdownEditor` owns the toolbar, mode switch, highlight bar, raw pane, link popup and ask button

- **Claim:** One 970-line component mixes ProseMirror plugins, the menu definition, the editor lifecycle and React
  portals into ProseMirror-owned DOM. Every editor-side piece of the redesign lands in it.
- **Location:** `documents/markdown-editor/markdown-editor.tsx` (plugins 112-436, menu 529-561, lifecycle 640-690,
  portals 850-956); `markdown-editor.css`.
- **Evidence:** see C-2 and C-3.
- **Raised by:** structural S-1
- **Confidence:** Verified
- **Bears on:** S-5, S-6, S-7

### C-2: The mode switch, the highlight bar and the raw pane are portaled into the ProseMirror menubar

- **Claim:** `MarkdownEditor` finds the menubar `prosemirror-menu` built and portals the mode switch and highlight bar
  into it, and the raw pane into its wrapper. All three render only when the menubar exists. A read-only file hides the
  menubar with CSS, which hides the switch and the highlight bar with it, so read-only forces rendered mode.
- **Location:** `markdown-editor.tsx:676-677`, `852-925`, `628-629`; `markdown-editor.css:17`.
- **Evidence:**
  ```tsx
  const bar = host.current!.querySelector<HTMLElement>('.ProseMirror-menubar');
  setMenubar(bar ? { bar, wrapper: bar.parentElement! } : undefined);
  createPortal(<div className="editor-mode" role="group" aria-label="Show the document as">...</div>, menubar.bar)
  createPortal(<div className={`highlight-bar ...`}>..., menubar.bar)
  createPortal(<RawView .../>, menubar.wrapper)
  ```
  ```css
  .rich-editor.read-only .ProseMirror-menubar { display: none; }
  ```
  ```ts
  const raw = mode === 'raw' && !readOnly;
  ```
- **Raised by:** structural S-2; behavioral B-17
- **Confidence:** Verified
- **Bears on:** S-4, S-5, S-7

### C-3: The formatting toolbar is the example-setup menu, wrapped by `rawAware`

- **Claim:** The toolbar is `prosemirror-menu` DOM built from `buildMenuItems(schema)`. Each item is wrapped by
  `rawAware`, which makes it work in raw mode too. The Insert and "Type..." dropdowns have fixed labels. Join up, Lift
  and Select parent are three lines. `linkItem` opens the link popup through the `linkPopups` WeakMap.
- **Location:** `markdown-editor.tsx:419-440`, `443`, `484`, `529-561`.
- **Evidence:**
  ```ts
  new Dropdown([rawAware(items.makeParagraph!, {kind:'heading',level:0}), rawAware(items.makeCodeBlock!...),
    new DropdownSubmenu([...makeHead1..6], { label: 'Heading' })], { label: 'Type...' }),
  rawAware(joinUpItem), rawAware(liftItem), rawAware(selectParentNodeItem),
  ```
- **Raised by:** structural S-3
- **Confidence:** Verified
- **Bears on:** S-6

### C-4: The question pill and the ask button exist twice, for the rendered view and the raw pane

- **Claim:** `labelChip` (ProseMirror widget) and `LabelChip` (raw pane) share the class `ai-highlight-label` and the
  `onAsk({passage, anchor})` contract. The ask-selection button exists in both views too, with near-duplicate CSS for
  each, including forced-colors blocks.
- **Location:** `markdown-editor.tsx:204-213`, `934-956`; `raw-view.tsx:28`, `88-96`, `183`, `216`;
  `markdown-editor.css:36-62`, `125-140`.
- **Evidence:**
  ```ts
  export type Ask = { passage: Passage; anchor: HTMLElement };      // markdown-editor.tsx:215
  export type SelectionAsk = { markdown: string; anchor: HTMLElement }; // markdown-editor.tsx:288
  ```
- **Raised by:** structural S-4
- **Confidence:** Verified
- **Bears on:** S-7

### C-5: The two ask popups own the message formats the server receives

- **Claim:** The question popup sends `label — text`; the selection popup sends a quoted passage. Both go through
  `chat.send(message)`, which returns false when busy or blank; the popups close only on true. The server sees only the
  text: `ChatRequest` carries `text`, `openFile` and `documents`. `useAnchoredBubble` is shared by `QuestionPopup`,
  `SelectionPopup` and `LinkPopup`, so it stays when the first two go.
- **Location:** `popups/question-popup/question-popup.tsx:40-44`; `popups/selection-popup/selection-popup.tsx:9-15`,
  `45-49`; `components/anchored-bubble/anchored-bubble.ts`; `src/shared/wire.ts:10-16`.
- **Evidence:**
  ```ts
  onSend(`${passage.label} — ${text.trim()}`);
  return `About this passage:\n\n${quote}\n\n${text.trim()}`; // quote: each line prefixed "> "
  ```
- **Raised by:** structural S-5; behavioral B-9
- **Confidence:** Verified
- **Bears on:** S-8, S-9

### C-6: `App` holds the popup state, keeps one popup open at a time, and moves typed text to the chat box

- **Claim:** `app.tsx` keeps `asking` and `askingAbout`, clears one when the other opens, passes `askingSelection` down
  so the editor keeps the selection pinned, and moves a question popup's typed text into the chat draft whenever
  `docs.highlights` changes identity (every progress event with highlights included). `useChatSession` exposes `draft`,
  `setDraft` and `send(text)`; `Chat` sends `chat.send(draft)`.
- **Location:** `app.tsx:71-81`, `119-165`; `chat/chat/chat.tsx:132`, `169`; `markdown-editor.tsx:288-347`, `702-714`,
  `733-748`.
- **Evidence:**
  ```ts
  useEffect(() => {
    if (asking?.text.trim()) chat.setDraft(joinDraft(chat.draft, `${asking.passage.label} — ${asking.text.trim()}`));
    setAsking(undefined);
  }, [docs.highlights]);
  ```
- **Raised by:** structural S-6; behavioral B-10
- **Confidence:** Verified
- **Bears on:** S-7, S-8

### C-7: The "/" actions menu has two callers and a private action list

- **Claim:** `AgentActions` (button text `/`, `aria-label="Agent Actions"`) is used by `Chat` and `SelectionPopup`. Its
  three actions (Collaborative Editing, Proofread, Research) are a private `ACTIONS` list that writes `/${skill} ` into
  the draft. `Menu` is shared with the file tree.
- **Location:** `components/agent-actions/agent-actions.tsx`; `components/menu/menu.tsx`; `chat/chat/chat.tsx:191`;
  `chat/chat/chat.css:19-21`.
- **Evidence:** `{ label: 'Collaborative Editing', icon: 'collaborate', skill: 'collaborative-editing' }`
- **Raised by:** structural S-7
- **Confidence:** Verified
- **Bears on:** S-14

### C-8: Both empty states are static text

- **Claim:** The empty chat shows a paragraph of example prompts; the editor with no file shows "Select a file".
- **Location:** `chat/chat/chat.tsx:175-181`; `documents/documents/documents.tsx:634`.
- **Evidence:** `<div className="select-file muted">Select a file</div>`
- **Raised by:** structural S-8
- **Confidence:** Verified
- **Bears on:** S-14, S-15

### C-9: Claude's progress shows three ways, and Stop is fire-and-forget

- **Claim:** "thinking…" shows while submitted or waiting; `WorkingBar` (`role="status"`, text changing every 300 ms)
  shows while busy; each tool call renders a `Tool summary · running/done` line. None names the file. Stop posts
  `/cancel` without awaiting it and aborts the local stream. Errors render as `.error` text with no dismiss.
- **Location:** `chat/chat/chat.tsx:18-53`, `128`, `137-159`, `185-203`.
- **Evidence:**
  ```ts
  const busy = status === 'submitted' || status === 'streaming' || waiting;
  const cancel = () => { api('POST', `/api/sessions/${sessionId}/cancel`); stop(); };
  ```
- **Raised by:** structural S-9; behavioral B-11
- **Confidence:** Verified
- **Bears on:** S-12

### C-10: The file tree locks while Claude works, with no visible reason

- **Claim:** `FileTree` gets `busy={chat.busy}` and disables "+", every "…" menu and drag and drop. Opening files stays
  allowed. Only a code comment explains why.
- **Location:** `documents/file-tree/file-tree.tsx:77-79`, `190`, `269`, `289`, `323`; `app.tsx:120`.
- **Evidence:** `// Changing the tree waits while the AI works, so the names its edits come back under stay current.`
- **Raised by:** behavioral B-12
- **Confidence:** Verified
- **Bears on:** S-13

### C-11: The editor bar holds Find in docs, the file name, the save state and Save

- **Claim:** `Editor` renders `.editor-bar` with a magnifier "Find in docs" button (it reveals the open file in the
  tree), the name, `unsaved changes`/`saved` (shown even with no file open) and Save. Mod-S is bound in an `Editor`
  effect. `mode`/`setMode` already live in `useDocuments` and persist in the view state.
- **Location:** `documents/documents/documents.tsx:58`, `598-633`, `674-686`.
- **Evidence:** `{docs.dirty ? 'unsaved changes' : 'saved'}`
- **Raised by:** structural S-10
- **Confidence:** Verified
- **Bears on:** S-4

### C-12: Eight notices share one blue style and none can be dismissed

- **Claim:** Every notice is `<div className="notice">` (accent-soft blue); errors add `role="alert"`. Chat and app
  errors use a separate red `.error` class.
- **Location:** `documents/documents/documents.tsx:634-672`; `documents.css:8`; `styles.css` `.error`.
- **Evidence:** the table in B-13: not on disk; changed on disk (Use the disk version); disk load error; save error;
  restore error; view write error; "Could not apply the AI's edit to {name}"; read-only.
- **Raised by:** structural S-10; behavioral B-13
- **Confidence:** Verified
- **Bears on:** S-16

### C-13: Dismissing the changed-on-disk notice would not stick

- **Claim:** `diskChanged` is raised in `syncFile` whenever disk text differs from `entry.saved` and the entry is dirty.
  Clearing it alone would be undone by the next sync. Save overwrites the disk without checking.
- **Location:** `documents/documents/documents.tsx:222-252`.
- **Evidence:**
  ```ts
  if (text === entry.saved) { entry.diskChanged = false; return; }
  if (entry.dirty) { entry.diskChanged = true; return; }
  ```
- **Raised by:** behavioral B-14
- **Confidence:** Verified
- **Bears on:** S-17

### C-14: No pre-turn text is kept; `turnBases` is a merge base that each merge overwrites

- **Claim:** `beginTurn` snapshots each opened, supported file into `turnBases` and records its markdown in the turn's
  `documents`. `applyEdited` overwrites `turnBases` after every merge. A turn can edit several files; a file the writer
  never opened is loaded from Claude's text with `dirty = true`, and a Write to a new path makes an unsaved new file.
- **Location:** `documents/documents/documents.tsx:289-343`; `src/engine/chat/tools/tools.ts:35-37`, `110-150`.
- **Evidence:**
  ```ts
  documents[name] = markdownOf(entry.doc);
  turnBases.current.set(name, snapshot(entry.doc));
  ...
  if (entry) turnBases.current.set(name, mergeMarkdown(entry.doc, turnBase ?? entry.loadBase, edited[name]));
  ```
- **Raised by:** behavioral B-1, B-2
- **Confidence:** Verified
- **Bears on:** S-10

### C-15: A turn lands as one merge per tool call; Mod-Z undoes them one at a time, only while the file is shown

- **Claim:** Progress events merge live; the final event repeats the last one as no change. Each merge is its own undo
  step in y-prosemirror's undo manager, which tracks `'ai'` and exists only while that file's editor is mounted. Merges
  into a file not on screen enter no undo stack. A disk sync clears the undo history. A stopped turn keeps its
  progress edits.
- **Location:** `documents/documents/documents.tsx:455-469`; `markdown-editor.tsx:44-46`, `81-111`, `654-690`.
- **Evidence:** `yUndoPlugin({ trackedOrigins: [AI_ORIGIN] })`; `undoManagers.get(live)?.clear()` in `replaceMarkdown`.
- **Raised by:** behavioral B-3, B-5
- **Confidence:** Verified, except whether y-prosemirror destroys the manager on unmount (Unverified: library source
  not read; the stack is unreachable after remount either way).
- **Bears on:** S-10

### C-16: "Unsaved" is event-based and never clears by undoing

- **Claim:** Any Yjs update sets `dirty`; only Save or following the disk clears it.
- **Location:** `documents/documents/documents.tsx:68-74`, `130-141`, `201-207`.
- **Evidence:** `entry.doc.on('update', () => { entry.dirty = true; rerender(); });`
- **Raised by:** behavioral B-6
- **Confidence:** Verified
- **Bears on:** S-10

### C-17: Highlights are one file's list, mixing Claude's questions with unlabeled changed passages

- **Claim:** Edit and Write add each changed block as a passage with no label; the Highlight tool adds labeled
  passages, usually with a question. The list covers one file. The editor places a passage only when its quote occurs
  exactly once; the rest are "not found". Nothing else records which passages changed.
- **Location:** `src/engine/chat/tools/tools.ts:63-70`, `158-181`; `src/shared/wire.ts:18-47`;
  `documents/documents/documents.tsx:56`, `524`; `markdown-editor.tsx:130-142`, `221-243`, `866-880`.
- **Evidence:**
  ```ts
  turn.highlights = { file: name, passages: [...earlier, ...quotes.filter(found).map((quote) => ({ quote }))] };
  if (matches.length !== 1) return [];
  ```
- **Raised by:** behavioral B-7, B-8
- **Confidence:** Verified
- **Bears on:** S-5

### C-18: Clear Chat starts a new session at once, even while Claude works

- **Claim:** `newChat` clears highlights, posts `/api/sessions` and remounts `Chat`. The button is always enabled and
  asks nothing. The old session stays in server memory but not on disk. A running turn continues on the old session.
- **Location:** `app.tsx:36-40`; `chat/agent-panel/agent-panel.tsx`; `src/engine/chat/sessions/sessions.ts:27-30`.
- **Evidence:** `const newChat = async () => { docs.showHighlights(undefined); setChatError(undefined); ... }`
- **Raised by:** behavioral B-15; structural S-9
- **Confidence:** Verified, except what the old `useChat` stream does after remount (Unverified: AI SDK source not
  read).
- **Bears on:** S-11

### C-19: Connection state is a dot in the top bar and gates nothing

- **Claim:** `useHostEvents` reconnects every second; `connected` starts false, so the page shows "events
  disconnected" until the first open. The top bar is its only display.
- **Location:** `events/host-events.ts:5-29`; `app.tsx:96-118`.
- **Evidence:** `{connected ? 'events connected' : 'events disconnected'}`
- **Raised by:** behavioral B-16; structural S-11
- **Confidence:** Verified
- **Bears on:** S-1, S-2

### C-20: Layout and tokens live in a 70-line `styles.css`

- **Claim:** `.app` is a two-row grid (top bar, main). `.main` is five columns: tree, resizer, editor, resizer, side,
  widths from `app.tsx` state. Fifteen tokens; dark mode overrides some (not `--ok`, `--warn`, `--bad`). Global
  `button.primary` and `button.danger`.
- **Location:** `styles.css`; `app.tsx:28-33`, `111-139`.
- **Evidence:** `.main { grid-template-columns: var(--tree-width) auto 1fr auto var(--agent-width); }`
- **Raised by:** structural S-11
- **Confidence:** Verified
- **Bears on:** S-1, S-3

### C-21: Tests pin today's labels and the menubar's DOM

- **Claim:** About 30 tests in `markdown-editor.test.tsx` use the `switchable()` harness, which finds the
  Rendered/Raw buttons inside `.ProseMirror-menubar`; one asserts the switch's position there. Tests pin "Clear Chat",
  "Agent (CLI)", "Find in docs", "Highlight 1 of 1", "Next highlight", "Ask the AI about the selection", "Agent
  Actions", "/", "thinking…", "Working", the `.notice` class and "Could not apply the AI's edit". The question and
  selection popups have whole test files.
- **Location:** `markdown-editor.test.tsx:1078-1096` and the `choose('Raw')` calls; `app.test.tsx`;
  `agent-panel.test.tsx`; `chat.test.tsx`; `documents.test.tsx:182`, `341`, `1164-1174`; `question-popup.test.tsx`;
  `selection-popup.test.tsx`.
- **Evidence:** `view.container.querySelector('.ProseMirror-menubar')` in `switchable()`.
- **Raised by:** structural S-12
- **Confidence:** Verified by grep counts; individual assertions were not all read.
- **Bears on:** every S-N entry

### C-22: `src/ui/` depends on `src/shared/` one way, and the redesign needs no shared change

- **Claim:** The UI imports types from `shared/wire` and runtime code from `shared/blocks`, `markdown`, `passages`,
  `markdown-support`. Nothing in the design needs a new wire field.
- **Location:** imports listed in S-13.
- **Evidence:** `import type { ClaudeMode, CurrentSession, ViewState } from '../shared/wire';` (`app.tsx:5`)
- **Raised by:** structural S-13
- **Confidence:** Verified
- **Bears on:** D-3

### C-23: The Agent panel header shows the chat mode and Clear Chat

- **Claim:** `AgentPanel` renders `Agent (CLI)` or `Agent (API)` and Clear Chat. `claude` state in `app.tsx` exists only
  to feed that label.
- **Location:** `chat/agent-panel/agent-panel.tsx`; `app.tsx:27`.
- **Evidence:** `toBe('Agent (CLI)')` in `agent-panel.test.tsx:15`.
- **Raised by:** structural S-9
- **Confidence:** Verified
- **Bears on:** S-11

## Findings No Agent Could Audit

- The Claude Design canvas is a URL; the analysts worked from the scope record's description of it.
- y-prosemirror's undo-manager teardown and the AI SDK's `useChat` behavior when its `id` changes were not read in
  `node_modules` (C-15, C-18).
- Nothing was run; every finding comes from reading code.

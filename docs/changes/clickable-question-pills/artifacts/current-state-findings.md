# Current State Findings: Clickable question pills

## Provenance

Produced by this run's own discovery round on 2026-09-28. `han-core:structural-analyst` (findings S1–S7) and
`han-core:behavioral-analyst` (findings B-1–B-8) were each given the area `src/ui/markdown-editor.tsx`,
`src/ui/documents.tsx`, `src/ui/chat.tsx`, `src/ui/app.tsx`, `src/shared/wire.ts`, `src/server/tools.ts`,
`src/server/sessions.ts`, `src/skills/collaborative-draft-editing/SKILL.md`, and their tests. `han-core:concurrency-analyst`
was not dispatched: the area is single-threaded browser UI plus one server tool, with no shared mutable state across
threads. The run's own sweep added C-13 to C-15. No prior report covered this area.

## Project Context

- **Stack:** Bun + TypeScript, React 19, ProseMirror (`prosemirror-view` 1.42.5) bound to Yjs through `y-prosemirror`,
  Vercel AI SDK v7 (`ai`, `@ai-sdk/react` `useChat`), Hono on the server, Zod 4 for tool schemas. Tests use `bun test`
  with happy-dom and `@testing-library/react`.
- **Conventions source:** `README.md`. It has no `CLAUDE.md` or `project-discovery.md`. Each UI feature is one `.tsx`
  file with its CSS beside it. `app.tsx` is the only file that wires features together. `src/shared/` modules have no
  imports.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** every commit in the last 90 days that touches the area builds out the highlight feature
  incrementally: `6eba6a4` Highlight tool, `bf9647e` label chip and status line, `689efa8` and `04555dc` handing
  highlights from a finished turn to the editor, `3c58f3b` adapting the skill. None are bug fixes.

## Gaps

- No ADR or coding standard covers UI popovers, focus management, or how one UI feature triggers another.
- No floating or anchored UI element exists anywhere in `src/ui/` (C-6).
- No test anywhere clicks a label chip.

## Findings

### C-1: Sending a chat message is private to `Chat`

- **Claim:** `send`, `sendMessage`, and `busy` are local to the `Chat` component, and nothing outside it can send a
  message or read whether a turn is running. `Chat` remounts on every new session.
- **Location:** `src/ui/chat.tsx` (`Chat`, `send`, `busy`); `src/ui/app.tsx` (`<Chat key={sessionId} … />`)
- **Evidence:**
  ```tsx
  const busy = status === 'submitted' || status === 'streaming';
  ...
  const send = () => {
    if (!input.trim() || busy) return;
    sendMessage({ text: input }, { body: { openFile, ...beginTurn() } });
    setInput('');
  };
  ```
- **Raised by:** structural-analyst S1, behavioral-analyst B-5
- **Confidence:** Verified
- **Bears on:** S-3, S-4, D-3

### C-2: `app.tsx` is the only place that wires features together, and today the wiring runs one way only

- **Claim:** By the stated convention, only `app.tsx` knows about more than one feature. Its wiring carries a finished
  chat turn into the documents (`onTurnFinished` calls `applyEdited` and `showHighlights`) and carries document state
  into the chat (`openFile`, `beginTurn`). Nothing lets an event in the editor cause a chat send.
- **Location:** `src/ui/app.tsx` header comment and `App`
- **Evidence:**
  ```tsx
  // Page entry. The only file that knows about more than one feature: it owns the state that crosses
  // features and wires them together, the way src/server/server.ts does for the server.
  ```
- **Raised by:** structural-analyst S2
- **Confidence:** Verified
- **Bears on:** S-4, S-6, D-3, D-4

### C-3: The label chip is plain DOM built outside React, and receives only its label

- **Claim:** `drawHighlights` destructures only `quote` and `label` from each passage, and `labelChip` gets only the
  label string. The chip is a `<span contenteditable="false">` that ProseMirror creates. A React `onClick` cannot reach
  it, and no other field of `Passage` reaches it.
- **Location:** `src/ui/markdown-editor.tsx` (`drawHighlights`, `labelChip`)
- **Evidence:**
  ```tsx
  passages.forEach(({ quote, label }) => {
    ...
    if (label) decorations.push(Decoration.widget(start, () => labelChip(label), { ...spec, side: -1, key: `label-${label}` }));
  });
  ...
  function labelChip(label: string): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'ai-highlight-label';
    chip.contentEditable = 'false';
    chip.textContent = label;
    return chip;
  }
  ```
- **Raised by:** structural-analyst S3, S7
- **Confidence:** Verified
- **Bears on:** S-2, D-2

### C-4: A chip keyed only by its label can keep its DOM node when a later turn reuses the label

- **Claim:** ProseMirror treats two widgets with the same `key` as the same widget and keeps the live DOM node. The
  skill numbers every stop from Q1. When a later turn highlights a different "Q1", the old chip node can stay in the
  DOM for the new passage, so a closure or a reference captured on that node can go stale.
- **Location:** `src/ui/markdown-editor.tsx` (`key: \`label-${label}\``); `node_modules/prosemirror-view/src/decoration.ts`
  (`WidgetType.eq`)
- **Evidence:**
  ```ts
  // prosemirror-view WidgetType
  eq(other: WidgetType) {
    return this == other ||
      (other instanceof WidgetType &&
       (this.spec.key && this.spec.key == other.spec.key ||
        this.toDOM == other.toDOM && compareObjs(this.spec, other.spec)))
  }
  ```
- **Raised by:** behavioral-analyst B-1
- **Confidence:** Verified (the analyst read the vendored `prosemirror-view` source)
- **Bears on:** S-2, D-2

### C-5: A click on the chip currently goes to ProseMirror

- **Claim:** The chip's widget spec sets no `stopEvent`. ProseMirror handles a mousedown or click on the chip as an
  editor click: it moves the selection and focuses the editor. That would take focus away from a text box in a popup
  that opens on the same click.
- **Location:** `src/ui/markdown-editor.tsx` (the `Decoration.widget` spec); `node_modules/prosemirror-view/src/viewdesc.ts`
  (`WidgetViewDesc.stopEvent`)
- **Evidence:**
  ```ts
  stopEvent(event: Event) {
    let stop = this.widget.spec.stopEvent
    return stop ? stop(event) : false
  }
  ```
- **Raised by:** behavioral-analyst B-2
- **Confidence:** Verified
- **Bears on:** S-2

### C-6: The only popup in the app is the modal "New document" dialog

- **Claim:** `Files` opens a native `<dialog>` with `showModal()`. It closes on a backdrop click by checking
  `e.target === dialog.current`. Nothing in the UI anchors a floating element to a point in the text, or dismisses a
  non-modal element on an outside click.
- **Location:** `src/ui/documents.tsx` (`Files`); `src/ui/documents.css`
- **Evidence:**
  ```tsx
  <dialog
    ref={dialog}
    className="new-file"
    aria-labelledby="new-file-title"
    onClose={() => setDraft('')}
    // A click on the backdrop lands on the dialog element itself.
    onClick={(e) => e.target === dialog.current && dialog.current.close()}
  >
  ```
- **Raised by:** structural-analyst S4
- **Confidence:** Verified
- **Bears on:** S-5, D-5

### C-7: `Passage` is declared twice, in `wire.ts` and in the Highlight tool's Zod schema, with nothing linking them

- **Claim:** A new `Passage` field has to be added by hand in both places. The compiler catches neither omission.
- **Location:** `src/shared/wire.ts` (`Passage`); `src/server/tools.ts` (`Highlight.inputSchema`)
- **Evidence:**
  ```ts
  export interface Passage {
    quote: string;
    label?: string;
  }
  ```
  ```ts
  passages: z.array(z.object({ quote: z.string().min(1), label: z.string().min(1).optional() })).min(1),
  ```
- **Raised by:** structural-analyst S5
- **Confidence:** Verified
- **Bears on:** S-1, D-1

### C-8: Highlight passages reach the browser untransformed

- **Claim:** The tool stores its `passages` input unchanged in `turn.highlights`, and `sessions.ts` copies that into the
  `data-session` part. The browser stores it in `useDocuments`. A field added to the tool's schema arrives in
  `docs.highlights` with no translation step.
- **Location:** `src/server/tools.ts` (`turn.highlights = { file: name, passages }`); `src/server/sessions.ts`
  (`data.highlights = turn.highlights`)
- **Evidence:**
  ```ts
  turn.highlights = { file: name, passages };
  ...
  if (!aborted && turn.highlights) data.highlights = turn.highlights;
  ```
- **Raised by:** structural-analyst S6
- **Confidence:** Verified
- **Bears on:** S-1

### C-9: Switching files remounts the whole editor

- **Claim:** `Editor` renders `<MarkdownEditor key={docs.current} … />`, so a file switch destroys the `EditorView` and
  its chips. State kept inside `MarkdownEditor` goes with it. State kept above it would outlive its chip.
- **Location:** `src/ui/documents.tsx` (`Editor`); `src/ui/markdown-editor.tsx` (effect cleanup `editor.destroy()`)
- **Evidence:**
  ```tsx
  {docs.doc && <MarkdownEditor key={docs.current} doc={docs.doc} readOnly={docs.unsupported.length > 0} highlights={docs.highlights} />}
  ```
- **Raised by:** behavioral-analyst B-4
- **Confidence:** Verified
- **Bears on:** S-5, D-4

### C-10: `beginTurn` must be called exactly once per message sent

- **Claim:** `beginTurn` clears and rebuilds `turnBases`, `turnSaves`, and `turnFile`. `applyEdited` and
  `showHighlights` rely on those values when the turn finishes. A message sent from outside the composer has to take its
  capture from the same `beginTurn`, once.
- **Location:** `src/ui/documents.tsx` (`beginTurn`)
- **Evidence:**
  ```tsx
  const beginTurn = useCallback(() => {
    const documents: Record<string, string> = {};
    turnBases.current.clear();
    turnSaves.current.clear();
    turnFile.current = currentRef.current;
  ```
- **Raised by:** behavioral-analyst B-6
- **Confidence:** Verified
- **Bears on:** S-3

### C-11: The chat shows a user's message as plain text

- **Claim:** User messages render as a React text child. Assistant text goes through `marked`. A user message
  `**Q1** — …` shows its asterisks literally.
- **Location:** `src/ui/chat.tsx` (`Message`)
- **Evidence:**
  ```tsx
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    return <div className="msg user">{text}</div>;
  }
  ```
- **Raised by:** behavioral-analyst B-7
- **Confidence:** Verified
- **Bears on:** D-6

### C-12: Nothing signals that a chip's passage has gone

- **Claim:** A chip's widget spec has no `destroy` callback. When highlights are replaced by a new turn, cleared by
  "New chat" (`showHighlights(undefined)`), or dropped because the quote no longer matches, only the `highlights` value
  changes. A popup has to close by watching that value.
- **Location:** `src/ui/documents.tsx` (`showHighlights`); `src/ui/app.tsx` (`newChat`); `src/ui/markdown-editor.tsx`
  (the `[highlights]` effect)
- **Evidence:**
  ```tsx
  const newChat = () => {
    docs.showHighlights(undefined);
    newSession();
  };
  ```
- **Raised by:** behavioral-analyst B-3, B-8
- **Confidence:** Verified
- **Bears on:** S-5, D-4

### C-13: The skill writes each question into the chat, and passes only quote and label to Highlight

- **Claim:** The skill tells the model to label passages `Q1`, `Q2`, and so on, and to start each question in the chat
  with its bold label. The question text exists only in the chat reply. The Highlight tool's description repeats the
  labeling rule.
- **Location:** `src/skills/collaborative-draft-editing/SKILL.md` ("Highlight what you discuss"); `src/server/tools.ts`
  (`Highlight.description`)
- **Evidence:**
  ```markdown
  - **Highlight what you discuss.** End every stop with one Highlight call on the draft, one passage per question, each
    labeled `Q1`, `Q2`, and so on, with labels unique within the call. Start each question in the chat with its label in
    bold, as in `**Q1** — Is this aside worth keeping?`.
  ```
- **Raised by:** run's own sweep
- **Confidence:** Verified
- **Bears on:** S-1, S-7, D-1

### C-14: Styling uses shared tokens in `styles.css` and one CSS file per feature

- **Claim:** Colors come from `:root` variables in `styles.css`, with dark-mode values under
  `prefers-color-scheme: dark`. Each feature imports its own CSS file. `markdown-editor.css` already has a
  `forced-colors` block for the chip.
- **Location:** `src/ui/styles.css`; `src/ui/markdown-editor.css`
- **Evidence:**
  ```css
  --accent: #3b5bdb;
  --accent-soft: #e7ecff;
  ...
  @media (forced-colors: active) {
    .rich-editor .ProseMirror .ai-highlight-label { background: CanvasText; color: Canvas; forced-color-adjust: none; }
  }
  ```
- **Raised by:** run's own sweep
- **Confidence:** Verified
- **Bears on:** S-5

### C-15: Existing tests pin the chip, the highlight flow, and the chat's Send

- **Claim:** `markdown-editor.test.tsx` reads chips by `.ai-highlight-label` text. `documents.test.tsx` covers
  highlights across file switches. `chat.test.tsx` drives Send with `typeAndSend`. `tools.test.ts` asserts that
  `turn.highlights` equals the passages given, so it will cover a new field automatically. `scripts/check.ts` runs the
  skill end to end and reads `highlights.passages`.
- **Location:** `src/ui/markdown-editor.test.tsx`, `src/ui/documents.test.tsx`, `src/ui/chat.test.tsx`,
  `src/server/tools.test.ts`, `src/server/scripts/check.ts`
- **Evidence:**
  ```ts
  expect(turn.highlights).toEqual({ file: 'draft.md', passages });
  ```
- **Raised by:** run's own sweep
- **Confidence:** Verified
- **Bears on:** Change Units

## Findings No Agent Could Audit

No agent could run the app in a browser. Whether the popup's position and the chip's click behave as planned in a real
browser, rather than in happy-dom, can only be confirmed by running the app (the `run` skill) after the build.

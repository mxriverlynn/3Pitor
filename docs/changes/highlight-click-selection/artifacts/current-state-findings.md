# Current State Findings: Highlight click selection

## Provenance

This run did its own discovery. No earlier report exists. It dispatched `han-core:structural-analyst` and
`han-core:behavioral-analyst` on 2026-09-30 over `src/ui/documents/markdown-editor/markdown-editor.tsx`,
`src/ui/documents/markdown-editor/raw-view.tsx`, and `markdown-editor.test.tsx`. The concurrency analyst was not
dispatched. The area has no async coordination beyond React's render cycle. The orchestrator checked each finding below
against the source. The analysts' S-numbers and B-numbers are kept under "Raised by".

## Project Context

- **Stack:** TypeScript, React 19, ProseMirror (`prosemirror-state` 1.4.4, `prosemirror-view` 1.42.5), Yjs through
  `y-prosemirror` 1.3.7, and Bun as runtime and test runner. UI tests use `bun test --preload ./src/ui/test-setup.ts
  src/ui` (jsdom-style page), and `make test` type-checks first.
- **Conventions source:** none found. There is no CLAUDE.md, AGENTS.md, or project-discovery.md. The conventions come
  from the code. Comments say what a thing is for in the writer's terms. Test names are plain-language sentences about
  what the writer sees. Commits are sentence-style and describe behavior.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** `markdown-editor.tsx` and its test have 17 commits each in 90 days, and `raw-view.tsx` has 2. The
  last two weeks built the < / > navigation: `cb443b1`, `6a52b07`, `3e32261`, `88622ba`, `73e79c1`, `7367cab`,
  `ffcddc2`. That work set the precedent this change extends: < and > select the passage and focus the editor, which
  shows the speech bubble (the ask button).

## Gaps

- No ADR, coding standard, or project-discovery document exists. The plan follows the conventions visible in the code.
- There is no test that places a caret in a highlight, by click or by arrow key, in either mode ([C-9](#c-9-no-test-places-a-caret-inside-a-highlight)).

## Findings

### C-1: Only < and > change the current highlight; a click never does

- **Claim:** The plugin's `current` changes only on a transaction that carries `CURRENT_META`, and only
  `stepHighlight` dispatches one. A caret placed by click or arrow key is a selection-only transaction, and `apply`
  returns the state unchanged.
- **Location:** `markdown-editor.tsx`, `highlightsPlugin` → `state.apply`; `stepHighlight`
- **Evidence:**
  ```ts
  const current = tr.getMeta(CURRENT_META) as number | undefined;
  if (current !== undefined) return { ...value, current, decorations: outline(value.decorations, tr.doc, current) };
  if (!tr.docChanged) return value;
  ```
  ```ts
  editor.dispatch(editor.state.tr.setMeta(CURRENT_META, (current + step + count) % count).setMeta('addToHistory', false));
  ```
- **Raised by:** behavioral-analyst B1; structural-analyst S6
- **Confidence:** Verified
- **Bears on:** S-2, D-1, D-9

### C-2: The Rendered ask button needs a non-empty selection, in two places

- **Claim:** `askButtonSpot` returns nothing for an empty selection, so `spot` is undefined and the button does not
  render. `askSelection` also returns early on an empty selection, so a button shown for a caret would do nothing. The
  unfocused fallback `selectsCurrent` is true only when the selection is exactly the current passage.
- **Location:** `markdown-editor.tsx`: `askButtonSpot`, `askSelection`, `selectsCurrent`, and the button's render
  condition
- **Evidence:**
  ```ts
  const { selection } = view.state;
  if (selection.empty) return;
  ```
  ```ts
  if (!editor || editor.state.selection.empty) return;
  ```
  ```tsx
  {onAskSelection && !raw && spot && (focused || askingSelection || selectsCurrent(view.current!.state)) &&
  ```
- **Raised by:** behavioral-analyst B2, B3; structural-analyst S4
- **Confidence:** Verified
- **Bears on:** S-4, S-5, D-1

### C-3: The Raw ask button needs a non-empty selection too, by its own rule

- **Claim:** `RawView` shows the button only for a non-empty textarea selection, or a pinned one, while focused. Its
  `askSelection` returns early on a caret. It keeps its own `focused` state and has no equivalent of `selectsCurrent`.
- **Location:** `raw-view.tsx`: `RawView`, `asked` / `showButton`, `askSelection`
- **Evidence:**
  ```ts
  const asked = pin ?? (selection.from < selection.to ? selection : undefined);
  const showButton = onAskSelection && asked && (focused || pin);
  ```
  ```ts
  if (!area || area.selectionStart === area.selectionEnd) return;
  ```
- **Raised by:** structural-analyst S4; behavioral-analyst B6
- **Confidence:** Verified
- **Bears on:** S-6, D-1

### C-4: Raw mode tracks the caret but never reports it, and its < and > do not select

- **Claim:** `RawView` holds the textarea selection in its own `selection` state, which `readSelection` fills on
  `select` and `selectionchange`. It has no callback that reports the caret or a highlight upward. `stepHighlight` only
  selects and focuses in Rendered mode, so in Raw mode < and > outline and scroll but show no speech bubble.
- **Location:** `raw-view.tsx`: `RawView` props and `readSelection`; `markdown-editor.tsx`: `stepHighlight`
- **Evidence:**
  ```ts
  // The passage the writer asked about by clicking its label ... (RawView props)
  highlights: RawHighlight[];
  current: number;
  onType: (text: string) => void;
  ```
  ```ts
  if (!raw) {
    selectCurrent(editor);
    editor.focus();
  }
  ```
- **Raised by:** structural-analyst S5; behavioral-analyst B6
- **Confidence:** Verified. The analyst's note that `selectionchange` may not fire on a textarea in every browser is
  Unverified: no browser was run. `onSelect` covers mouse and keys either way.
- **Bears on:** S-6, S-7, D-4, D-7

### C-5: One `current` number indexes two lists that can disagree

- **Claim:** The plugin's `current` is an index into `placed(decorations)`, the Rendered highlights sorted by position.
  It reaches React through `onShown` and reaches `RawView` as a bare `current` prop, where it indexes `rawMarks`.
  `rawMarks` comes from `rawHighlights`, which searches the markdown text rather than the text blocks and drops
  overlapping marks. The two lists can differ in length and order. The status text and `stepHighlight` both choose a
  count with `raw ? rawMarks.length : shown`.
- **Location:** `markdown-editor.tsx`: `highlightsPlugin` view `update`, the `onShown` wiring, `stepHighlight`, and
  the status span; `raw-view.tsx`: `rawHighlights` and `marks`
- **Evidence:**
  ```ts
  onShown(state.decorations.find().filter((d) => d.from < d.to).length, state.current);
  ```
  ```ts
  return found.filter((h, i) => i === 0 || h.from >= found[i - 1].to);
  ```
  ```ts
  ...highlights.map((h, i) => ({ from: h.from, to: h.to, className: i === current ? 'ai-highlight current-highlight' : 'ai-highlight', start: i })),
  ```
- **Raised by:** structural-analyst S1, S2; behavioral-analyst B5
- **Confidence:** Verified from the code. No runtime case where the lists diverge was observed.
- **Bears on:** S-3, S-6, D-4, D-6, D-8, D-13

### C-6: The status text reports placed-of-sent, not where the writer is

- **Claim:** The bar says how many passages were placed out of how many the AI sent. It never reads `current`. It is
  an `aria-live="polite"` region. Four tests assert the exact string. One of them, "leaves out a passage the post no
  longer holds, and counts it as not highlighted", exists to show an unplaced passage as "1 of 2".
- **Location:** `markdown-editor.tsx`: `.highlight-status` span; `markdown-editor.test.tsx`: the tests at about lines
  100, 268, 297, and 647
- **Evidence:**
  ```tsx
  <span className="highlight-status" aria-live="polite">
    {highlights.length > 0 && `Highlighted ${raw ? rawMarks.length : shown} of ${highlights.length} passages`}
  </span>
  ```
  ```ts
  expect(highlighted(editor.view.container)).toEqual({ marks: ['quick brown'], labels: ['Q1'], status: 'Highlighted 1 of 2 passages' });
  ```
- **Raised by:** structural-analyst S3; behavioral-analyst B7
- **Confidence:** Verified
- **Bears on:** S-3, D-2

### C-7: After a local edit, `current` and the outline can drift apart

- **Claim:** Local typing maps the decorations without re-running `outline`. The `current-highlight` class therefore
  stays on the decoration it was on, while `current` stays the same index. If the writer deletes a highlighted passage
  before the current one, the index shifts to the next passage and the outline stays where it was. If the writer
  deletes the current passage itself, `current` can point past the end of the list. It is never clamped. A change that
  arrives through Yjs (an AI edit, an undo) redraws everything and resets `current` to 0.
- **Location:** `markdown-editor.tsx`: `highlightsPlugin` → `apply`, `mapHighlights`, `drawHighlights`
- **Evidence:**
  ```ts
  if (tr.getMeta(ySyncPluginKey)?.isChangeOrigin) return drawHighlights(tr.doc, value.passages);
  return { ...value, decorations: mapHighlights(value.decorations, tr) };
  ```
- **Raised by:** behavioral-analyst B4
- **Confidence:** Verified from the code. No runtime observation was made.
- **Bears on:** S-2, D-3

### C-8: < and > select the passage, which moves any caret the writer placed

- **Claim:** `selectCurrent` replaces the selection with the whole current passage. < and > use it, and so does the
  arrival of new highlights while the editor is unfocused. This is the path that shows the speech bubble today (Image
  #4). Using it on a click would replace the caret the writer just placed with a selection, so the next keystroke would
  overwrite the passage.
- **Location:** `markdown-editor.tsx`: `selectCurrent`, `stepHighlight`, and the `[highlights]` effect
- **Evidence:**
  ```ts
  function selectCurrent(view: EditorView) {
    const range = currentRange(view.state);
    if (range) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
  }
  ```
- **Raised by:** behavioral-analyst B3
- **Confidence:** Verified
- **Bears on:** S-5, D-1

### C-9: No test places a caret inside a highlight

- **Claim:** The navigation tests use the Next and Previous buttons and check `.current-highlight` and
  `.highlight-status`. None clicks or arrows a caret into a highlight, in either mode. The tests work at the component
  level through the DOM, so they do not tie the plan to where `current` lives.
- **Location:** `markdown-editor.test.tsx`, the tests from about line 125 to line 247
- **Evidence:**
  ```ts
  const currentHighlight = (container: HTMLElement) => container.querySelector('.current-highlight')?.textContent;
  ```
- **Raised by:** structural-analyst S7; behavioral-analyst B8
- **Confidence:** Verified
- **Bears on:** Change units 1 to 4

### C-10: The menu bar never gets shorter, so the highlight bar's space outlives it

- **Claim:** `prosemirror-menu`'s `MenuBarView.update` ratchets an inline `min-height` on the menu bar up to the tallest
  height it has seen, and forgets it only when the menu bar's width changes. The highlight bar is a flex row inside the
  menu bar (`flex-basis: 100%` in a wrapping flex container), so while it shows, it makes the menu bar taller. After
  Clear, the inline `min-height` keeps that height. The remaining single row of buttons is centred in the taller box,
  which is why the toolbar drops a few pixels.
- **Location:** `node_modules/prosemirror-menu/dist/index.js`, `MenuBarView.update`;
  `src/ui/documents/markdown-editor/markdown-editor.css`, `.ProseMirror-menubar` and `.highlight-bar`
- **Evidence:**
  ```js
  if (this.menu.offsetWidth != this.widthForMaxHeight) {
      this.widthForMaxHeight = this.menu.offsetWidth;
      this.maxHeight = 0;
  }
  if (this.menu.offsetHeight > this.maxHeight) {
      this.maxHeight = this.menu.offsetHeight;
      this.menu.style.minHeight = this.maxHeight + "px";
  }
  ```
  ```css
  .rich-editor .ProseMirror-menubar {
    background: var(--panel); color: var(--text); border-bottom: 1px solid var(--border);
    padding: 4px 12px; min-height: 30px;
  }
  .rich-editor .highlight-bar.showing {
    display: flex; align-items: center; flex-basis: calc(100% + 24px); margin: 4px -12px -4px; padding: 4px 12px;
  ```
- **Raised by:** orchestrator, reading the library source after the writer's Images #6 and #7
- **Confidence:** Verified from the source. The pixel shift is inferred from flex centring, since no browser was run.
- **Bears on:** S-8, D-14

## Findings No Agent Could Audit

No browser was run. Two things are therefore unconfirmed: the real order of ProseMirror's mousedown and selection
events, and whether `selectionchange` fires on a textarea element. The Bun test page (jsdom-style) also differs from
Chrome here. Checking the new behavior by hand in the running app, in both modes, closes this gap.

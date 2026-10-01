# Current State Findings: Current highlight single outline

## Provenance

Produced by this run's own discovery, done directly by the planning run rather than through dispatched analysts. The
area is one function group in `src/ui/documents/markdown-editor/markdown-editor.tsx` and one stylesheet, which was read
in full where it touches highlights. The operator's two screenshots supplied the rendered DOM.

## Project Context

- **Stack:** Bun, TypeScript, React 19, ProseMirror (`prosemirror-view` 1.42.5) with `y-prosemirror` for Yjs sync. UI
  tests run under `bun test` against happy-dom (`src/ui/test-setup.ts`), via `make test-ui`; `make test` type-checks
  first.
- **Conventions source:** none found (no CLAUDE.md, no `project-discovery.md`). Conventions were read from the code:
  one-line comments that say what a function is for, pure helpers in their own file with a sibling test
  (`raw-formatting.ts` / `raw-formatting.test.ts`).
- **ADRs found:** none found; there is no `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** `src/ui/documents/markdown-editor/` changed heavily in the last 90 days, mostly highlight navigation
  work (`cfdc133`, `d2fa4ff`, `65cb82f`, `ab3c73a`, `fc39478`, `5888973`). The prior plan
  `docs/changes/highlight-click-selection/` covers the same component.

## Gaps

- No ADR or coding standard covers decorations, overlays, or the editor's CSS.
- No existing test exercises layout geometry. happy-dom does no layout, so `getClientRects()` returns empty or zero
  boxes, and no test stubs it ([C-8](#c-8-tests-run-without-layout)).

## Findings

### C-1: Each passage is one inline decoration, and the current one gets `current-highlight`

- **Claim:** The editor draws each placed passage as one `Decoration.inline` with `nodeName: 'mark'`. `outline()`
  redraws them all, giving the class `ai-highlight current-highlight` to the passage at `current` and `ai-highlight` to
  the rest.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.tsx`, `drawHighlights` and `outline`.
- **Evidence:**
  ```ts
  function outline(decorations: DecorationSet, doc: Node, current: number): DecorationSet {
    const marks = placed(decorations);
    const redrawn = marks.map((d, i) =>
      Decoration.inline(d.from, d.to, { nodeName: 'mark', class: i === current ? 'ai-highlight current-highlight' : 'ai-highlight' }, d.spec),
    );
    return decorations.remove(marks).add(doc, redrawn);
  }
  ```
- **Raised by:** planning run.
- **Confidence:** Verified.
- **Bears on:** S-3, D-4.

### C-2: ProseMirror renders one decoration as several sibling elements wherever formatting changes

- **Claim:** An inline decoration is rendered per text node, inside that node's mark elements (such as a link). A
  passage that crosses a link becomes several sibling `<mark>` elements, some nested in `<a>`. No single element wraps
  the whole passage, so there is no "outermost element" to give the class to.
- **Location:** `node_modules/prosemirror-view/dist/index.js`, `computeOuterDeco`; the operator's second screenshot.
- **Evidence:** DOM from the screenshot:
  ```html
  <p>
    <a href="https://github.com/mxriverlynn/3Pitor">…</a>
    <mark class="ai-highlight current-highlight">…</mark>
    <a href="https://github.com/backnotprop/plannotator">
      <mark class="ai-highlight current-highlight">Plannotator</mark>
    </a>
    <mark class="ai-highlight current-highlight">, </mark>
    …
  </p>
  ```
  ```js
  function computeOuterDeco(outerDeco, node, needsWrap) {
      …
          if (attrs.nodeName)
              result.push(top = new OuterDecoLevel(attrs.nodeName));
  ```
- **Raised by:** planning run, from the operator's screenshot.
- **Confidence:** Verified.
- **Bears on:** D-1.

### C-3: The current outline is a CSS `outline` on each `mark`, so each piece draws its own box

- **Claim:** The Rendered view draws the current highlight with `outline` on `mark.current-highlight`. Each sibling
  piece from C-2 draws a separate closed box. A single piece that wraps lines draws one closed shape around its lines.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.css`, the rule under "The highlight the writer is on".
- **Evidence:**
  ```css
  /* The highlight the writer is on, which < and > move between, outlined like a selection. */
  .rich-editor .ProseMirror mark.current-highlight { outline: 2px solid var(--accent); outline-offset: 1px; }
  ```
- **Raised by:** planning run.
- **Confidence:** Verified.
- **Bears on:** S-4, D-5.

### C-4: Every highlight piece has rounded corners, which notch the tint where pieces meet

- **Claim:** `mark.ai-highlight` carries `border-radius: 2px`, applied to each sibling piece. This leaves small breaks
  in the tint and underline at piece boundaries on every highlight, current or not.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.css`, the `.rich-editor .ProseMirror mark.ai-highlight`
  rule.
- **Evidence:**
  ```css
  .rich-editor .ProseMirror mark.ai-highlight {
    background: var(--highlight); color: inherit; border-bottom: 2px solid var(--accent); border-radius: 2px;
  }
  ```
- **Raised by:** planning run.
- **Confidence:** Verified for the rule. How visible the notches are was judged from the screenshot only.
- **Bears on:** S-6, D-7.

### C-5: `current-highlight` is also the scroll target and the tests' handle

- **Claim:** Code other than the stylesheet finds the current passage by its class. Two scroll-into-view calls query
  `mark.current-highlight`, and the editor tests read it through a helper that joins the text of every
  `.current-highlight` element, and through an `outlined` reader in the `highlighting()` helper
  (`markdown-editor.test.tsx`, about line 382).
- **Location:** `markdown-editor.tsx`, the `highlightsPlugin` view's `update` and the `steps` effect in `MarkdownEditor`;
  `markdown-editor.test.tsx`, `currentHighlight`.
- **Evidence:**
  ```ts
  if (!view.hasFocus()) view.dom.querySelector('mark.current-highlight')?.scrollIntoView({ block: 'nearest' });
  ```
  ```ts
  host.current?.querySelector(raw ? '.raw-mirror mark.current-highlight' : '.ProseMirror mark.current-highlight')?.scrollIntoView({ block: 'nearest' });
  ```
  ```ts
  const currentHighlight = (container: HTMLElement) =>
    [...container.querySelectorAll('.current-highlight')].map((el) => el.textContent).join('') || undefined;
  ```
- **Raised by:** planning run; the second test reader was added by the junior-developer review.
- **Confidence:** Verified.
- **Bears on:** S-5, D-4.

### C-6: The ask button is the precedent for something drawn over the text and re-measured

- **Claim:** `MarkdownEditor` already places one element over the document. `askButtonSpot(view, scroller)` measures in
  the host's scrolled-content coordinates. `placeButton` stores the result in state with an equality check.
  `selectionPlugin` calls it after every editor state update, and a `ResizeObserver` on `editor.dom` plus a window
  `resize` listener call it too. The button is portaled into `host`, the `.rich-editor` div, which is
  `position: relative`.
- **Location:** `markdown-editor.tsx`, `askButtonSpot`, `placeButton`, the editor-creating effect, and the render's
  `createPortal(…, host.current!)`; `markdown-editor.css`, `.rich-editor { position: relative; }`.
- **Evidence:**
  ```ts
  function askButtonSpot(view: EditorView, scroller: HTMLElement): { top: number; left: number } | undefined {
    …
    const box = scroller.getBoundingClientRect();
    …
    return { top: top - box.top + scroller.scrollTop, left: text - box.left + scroller.scrollLeft };
  }
  ```
  ```ts
  // The text can move without the document changing: the window resizes, or an image loads.
  const moved = () => placeButtonRef.current();
  const resized = new ResizeObserver(moved);
  resized.observe(editor.dom);
  window.addEventListener('resize', moved);
  ```
- **Raised by:** planning run.
- **Confidence:** Verified.
- **Bears on:** S-2, S-3, D-2.

### C-7: The Raw view draws each passage as one element and is not affected

- **Claim:** The Raw view's mirror marks plain markdown text, so each passage is one `<mark>` and the outline rule there
  draws one box. Links in raw text are characters, not elements.
- **Location:** `raw-view.tsx`, `mirrorPieces` and the `marks` list; `markdown-editor.css`,
  `.rich-editor .raw-mirror mark.current-highlight`.
- **Evidence:**
  ```css
  .rich-editor .raw-mirror mark.current-highlight { outline: 2px solid var(--accent); outline-offset: 1px; }
  ```
- **Raised by:** planning run.
- **Confidence:** Verified for the code. The single-box rendering in Raw mode was inferred from the code, not observed.
- **Bears on:** D-8.

### C-8: Tests run without layout

- **Claim:** UI tests use happy-dom, which does no layout. No test or setup stubs `getClientRects` or
  `getBoundingClientRect`, so any drawing that depends on measured boxes sees empty or zero boxes.
- **Location:** `src/ui/test-setup.ts`; repository-wide search for `getClientRects` found no use.
- **Evidence:**
  ```ts
  import { GlobalRegistrator } from '@happy-dom/global-registrator';
  …
  GlobalRegistrator.register();
  ```
- **Raised by:** planning run.
- **Confidence:** Verified.
- **Bears on:** S-1, Unit 1, Unit 2.

### C-9: A label chip sits just before the passage, outside its marks

- **Claim:** A passage's label is a `Decoration.widget` at the passage start with `side: -1`. It renders a
  `button.ai-highlight-label` before the first `mark`, not inside it. Today's outline does not include the chip.
- **Location:** `markdown-editor.tsx`, `drawHighlights` and `labelChip`.
- **Evidence:**
  ```ts
  const widget = { ...spec, side: -1, key: `label-${label}`, stopEvent: () => true, ignoreSelection: true };
  decorations.push(Decoration.widget(start, () => labelChip(label), widget));
  ```
- **Raised by:** planning run.
- **Confidence:** Verified.
- **Bears on:** D-3.

### C-10: The paragraph-wide box is ProseMirror's block-selection outline

- **Claim:** The large box around the whole paragraph in the first screenshot is `.ProseMirror-selectednode`. The
  paragraph was selected as a block. It is not part of the highlight.
- **Location:** `markdown-editor.css`; the screenshot's `<p class="ProseMirror-selectednode" draggable="true">`.
- **Evidence:**
  ```css
  .rich-editor .ProseMirror-selectednode { outline: 2px solid var(--accent); }
  ```
- **Raised by:** planning run.
- **Confidence:** Verified.
- **Bears on:** D-9 (cut for scope).

## Findings No Agent Could Audit

Real layout. Neither this run nor the test environment can render the editor and measure line boxes, so the outline's
exact appearance (wrapped lines, inline code, a passage starting mid-line) can only be checked by eye in a browser. Unit
2's manual check closes it.

# Change Decision Log: Current highlight single outline

<!--
This file records every decision committed while planning the current highlight single outline change.
The plan itself lives in [../change-plan.md](../change-plan.md). Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.
-->

## Trivial decisions

- D-8: Raw view unchanged — The Raw view keeps its own CSS outline on its single `mark` per passage, because it never
  splits a passage ([C-7](current-state-findings.md#c-7-the-raw-view-draws-each-passage-as-one-element-and-is-not-affected)).
  — Referenced in plan: What Changes, In One Paragraph; Target State.
- D-9: The paragraph block-selection box is out of scope — The operator said "1: leave it out of the plan." — Referenced
  in plan: Cut for Scope.
- D-10: The outline stays visible in forced-colors mode — Under `@media (forced-colors: active)` the outline's stroke is
  `CanvasText`, matching how the stylesheet already forces the highlight colors there. — Referenced in plan: Surface
  Delta.
- D-11: Output folder — `docs/changes/current-highlight-single-outline/`, confirmed by the operator ("3: that's fine").
  — Referenced in plan: none.

## Full decisions

### D-1: Draw the current highlight's outline as a separate layer over the text

- **Question:** A passage containing a link is rendered as several sibling `mark` elements, and no element wraps them
  all. How does the editor draw one outline around such a passage?
- **Decision:** The marks stop drawing the outline. The editor measures where the current passage's pieces sit and draws
  one outline shape in an SVG layer over the text. The layer is re-measured whenever the text can move.
- **Rationale:** The operator chose this option. It is the only option that gives a closed shape around wrapped lines,
  like today's outline around a single piece.
- **Evidence:** [C-2](current-state-findings.md#c-2-prosemirror-renders-one-decoration-as-several-sibling-elements-wherever-formatting-changes),
  [C-3](current-state-findings.md#c-3-the-current-outline-is-a-css-outline-on-each-mark-so-each-piece-draws-its-own-box);
  user input: "Separate outline layer".
- **Behavior impact:** Changing. The writer sees one outline around the current passage instead of one box per piece.
  This is the change the operator asked for.
- **Rejected alternatives:**
  - Edges per piece (split each passage into one decoration per text run, with top and bottom edges on every piece and
    side edges only on the first and last) — rejected by the operator. Wrapped lines would show a box open at the line
    ends.
  - Apply `current-highlight` only to the outermost element, as first suggested — not possible. ProseMirror puts inline
    decorations inside mark elements such as links, so no single element wraps the passage
    ([C-2](current-state-findings.md#c-2-prosemirror-renders-one-decoration-as-several-sibling-elements-wherever-formatting-changes)).
- **Revisit criterion:** If the outline visibly lags or misplaces while typing, or a ProseMirror release can render one
  wrapper across marks.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-4.
- **Dependent decisions:** D-2, D-3, D-4, D-5, D-6.
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Behavior Changes.

### D-2: The outline layer lives where the ask button lives and is re-measured on the same signals

- **Question:** Where is the layer attached, in what coordinates, and what makes it re-measure?
- **Decision:** `MarkdownEditor` portals an `svg.highlight-outline` into `host` (the `.rich-editor` div), as it does the
  ask button. Its path is in the host's scrolled-content coordinates, so scrolling moves it with the text and needs no
  re-measure. It is re-measured by the same callback that places the ask button. That callback runs after every editor
  state update (`selectionPlugin`), on the `ResizeObserver` over `editor.dom`, and on window `resize`. The callback keeps
  its equality check so an unchanged path causes no re-render.
- **Rationale:** The editor already solves "draw something over the text and keep it in place" this way, with the same
  triggers. A second mechanism would duplicate it.
- **Evidence:** [C-6](current-state-findings.md#c-6-the-ask-button-is-the-precedent-for-something-drawn-over-the-text-and-re-measured).
- **Behavior impact:** Preserving for the ask button. It is placed by the same triggers as before.
- **Rejected alternatives:**
  - A ProseMirror plugin view that owns its own overlay DOM and listeners — rejected because it duplicates the ask
    button's triggers and adds a second positioning scheme in one component.
  - Viewport coordinates with a scroll listener — rejected because scrolled-content coordinates already follow the
    scroll for free (C-6).
- **Revisit criterion:** If the text moves with none of the three triggers firing (for example a late web-font swap
  that leaves `editor.dom`'s size unchanged) and the outline is seen out of place.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3.
- **Dependent decisions:** None.
- **Referenced in plan:** Target State; Surface Delta; Risks.

### D-3: The outline is measured from the `mark.current-highlight` pieces, not from the passage's document range

- **Question:** Which boxes does the outline go around?
- **Decision:** `highlightOutline` collects `getClientRects()` from every `mark.current-highlight` inside `view.dom`.
- **Rationale:** These are exactly the pieces today's outline goes around. They leave out the label chip, which sits
  just before the first mark
  ([C-9](current-state-findings.md#c-9-a-label-chip-sits-just-before-the-passage-outside-its-marks)).
- **Evidence:** C-1, C-9.
- **Behavior impact:** Preserving for a passage drawn as one piece. For several pieces, the outline's extent is the
  intended S-4 change.
- **Rejected alternatives:**
  - A DOM `Range` from `view.domAtPos(from)` to `view.domAtPos(to)` — rejected because where `from` resolves relative
    to the label widget is not pinned, so the chip could be drawn inside the outline.
- **Revisit criterion:** If the current passage ever renders without a `mark.current-highlight` element.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2.
- **Dependent decisions:** D-4.
- **Referenced in plan:** Target State.

### D-4: `current-highlight` stays on every piece as a marker with no styling of its own

- **Question:** The request said the class "only needs to be applied to the outermost element". With no outermost
  element, what happens to the class?
- **Decision:** Every piece of the current passage keeps `ai-highlight current-highlight`. The Rendered view's CSS no
  longer styles `mark.current-highlight`, so the class draws nothing. It stays as the handle that scroll-into-view, the
  outline measurement (D-3) and the tests use to find the current passage.
- **Rationale:** The visible symptom, one box per piece, comes from the CSS rule, not from the class itself. Removing
  the rule fixes the symptom. Keeping the class keeps scrolling and every existing test working unchanged.
- **Evidence:** [C-5](current-state-findings.md#c-5-current-highlight-is-also-the-scroll-target-and-the-tests-handle),
  C-3.
- **Behavior impact:** Preserving. The class sits on the same elements as today. Only its styling changes, recorded
  under S-4.
- **Rejected alternatives:**
  - Remove the class and mark the current passage another way — rejected because it rewrites the two scroll-into-view
    queries and the tests' `currentHighlight` helper for no visible gain.
  - Keep the class on the first piece only — rejected because the tests' helper would read only part of the passage's
    text, and the outline measurement would need a second marker anyway.
- **Revisit criterion:** If another stylesheet rule targeting `.current-highlight` in the Rendered view is added.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5.
- **Dependent decisions:** None.
- **Referenced in plan:** Target State; Surface Delta.

### D-5: The outline shape: one box per line, traced as one closed path

- **Question:** How do measured piece boxes become one outline that looks like today's?
- **Decision:** Two pure functions in `highlight-outline.ts`:
  ```ts
  export type Box = { left: number; top: number; right: number; bottom: number };

  export const OUTLINE_PAD = 2;

  // One box per line the boxes sit on, top to bottom. Boxes with no width are dropped. The rest are taken in order of
  // their top; each joins the line before it when its vertical middle lies within that line's top and bottom so far,
  // and the line grows to cover it. Otherwise it starts a new line.
  export function lineBoxes(boxes: readonly Box[]): Box[];

  // An SVG path tracing the outline around `lines`, each grown by OUTLINE_PAD on every side. Consecutive lines that
  // overlap horizontally share one closed shape, meeting halfway between them; lines that do not overlap get separate
  // shapes. Empty input gives ''.
  export function outlinePath(lines: readonly Box[]): string;
  ```
  Worked example. Pieces measured in host content coordinates:
  `[{left:100,top:10,right:150,bottom:30}, {left:150,top:12,right:300,bottom:30}, {left:20,top:40,right:200,bottom:60}]`.
  `lineBoxes` gives `[{left:100,top:10,right:300,bottom:30}, {left:20,top:40,right:200,bottom:60}]`.
  `outlinePath(lines)` grows them by 2 to `{98,8,302,32}` and `{18,38,202,62}`, meets them at y=35, and gives
  `M98 8 H302 V35 H202 V62 H18 V35 H98 Z`.
  If the second line were `{left:400,…,right:500}` (no horizontal overlap with the first), the result is two closed
  rectangles, one `M…Z` each.
  Worked example 2: lines `{300,10,550,30}`, `{20,40,600,60}` and `{20,70,580,90}` give
  `M298 8 H552 V35 H602 V65 H582 V92 H18 V65 H18 V35 H298 Z`.
  The layer strokes this path with `stroke-width: 2`, `fill: none`, `stroke: var(--accent)`. A pad of 2 puts the
  stroke's center 2px outside the text, covering the same 1px to 3px band as today's `outline: 2px` with
  `outline-offset: 1px` (checked by the test-engineer review).
- **Rationale:** This reproduces the closed shape the operator picked in the preview. Chrome, the browser in the
  operator's screenshots, draws a similar closed shape around a single wrapped piece today. It keeps today's line
  weight and offset, and splits the geometry into functions that can be tested without layout
  ([C-8](current-state-findings.md#c-8-tests-run-without-layout)).
- **Evidence:** C-3, C-8; user input: the chosen preview; review findings JD-001, T1, T4 (second example and
  line-grouping order).
- **Behavior impact:** Changing, as part of S-4: the visible outline shape. Settled by the operator's choice in D-1.
- **Rejected alternatives:**
  - One separate rectangle per line — rejected because adjacent lines would show a doubled edge between them, the same
    "doubled up" look being fixed.
  - Rounded corners on the path — deferred. Today's outline has square corners.
- **Revisit criterion:** If the operator wants rounded corners or a different offset after seeing it.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1.
- **Dependent decisions:** D-6.
- **Referenced in plan:** Target State; Surface Delta.

### D-6: The geometry goes in its own file with its own test

- **Question:** Where do `lineBoxes` and `outlinePath` live?
- **Decision:** A new `src/ui/documents/markdown-editor/highlight-outline.ts`, tested by `highlight-outline.test.ts`.
  `highlightOutline(view, scroller)` stays in `markdown-editor.tsx`, next to `askButtonSpot`, because it reads the
  view.
- **Rationale:** The geometry is pure and DOM-free. This folder already keeps that kind of helper in its own file with a
  sibling test (`raw-formatting.ts`). `markdown-editor.tsx` is 735 lines.
- **Evidence:** C-8; the `raw-formatting.ts` / `raw-formatting.test.ts` precedent.
- **Behavior impact:** Preserving. It is new code with no prior callers.
- **Rejected alternatives:**
  - Export the functions from `markdown-editor.tsx` — rejected because it grows the largest file in the folder with code
    that does not touch the editor.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1.
- **Dependent decisions:** None.
- **Referenced in plan:** Target State; Surface Delta.

### D-7: Highlights the writer is not on lose their rounded corners

- **Question:** Should the small breaks where pieces of any highlight meet be tidied too?
- **Decision:** Remove `border-radius: 2px` from `.rich-editor .ProseMirror mark.ai-highlight`. Tint and underline then
  run continuously across pieces.
- **Rationale:** The operator left this to the plan ("pick what you think is best, we'll adjust later if it's not what i
  want, visually"). The corners are only 2px, and per piece they make the notches. Dropping them is the smallest change
  that removes the notches.
- **Evidence:** [C-4](current-state-findings.md#c-4-every-highlight-piece-has-rounded-corners-which-notch-the-tint-where-pieces-meet);
  user input.
- **Behavior impact:** Changing. Highlights have square corners. The operator agreed to the plan choosing this, to be
  adjusted visually later.
- **Rejected alternatives:**
  - Round only the first and last piece — rejected because it needs the per-run decoration split D-1 rejected for the
    outline.
  - Leave the corners — rejected because the operator's complaint is about broken-up highlights, and this is a visible
    part of it.
- **Revisit criterion:** The operator asks for rounded ends back after seeing it.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6.
- **Dependent decisions:** None.
- **Referenced in plan:** Surface Delta; Behavior Changes.

### D-12: Review-round simplifications

- **Question:** Which of the review round's YAGNI candidates change the contract?
- **Decision:** `outlinePath` takes no `pad`. A module constant `OUTLINE_PAD = 2` replaces it, with a comment tying it
  to the stylesheet's `stroke-width: 2`. `highlightOutline` does not check raw mode; the component's `raw` gate is the
  only one. `lineBoxes` and `outlinePath` stay separate exports.
- **Rationale:** The pad has one caller and one value. The raw gate existed twice, and `highlightOutline` could only
  read the plugin's raw flag, which syncs after the component's. The two geometry exports are tested separately (Unit
  1's tall-piece case tests `lineBoxes` alone).
- **Evidence:** junior-developer JD-004, JD-005, JD-006; test-engineer YAGNI note and T4;
  `markdown-editor.tsx` `raw` and `isRaw`.
- **Behavior impact:** Preserving. No change to what the writer sees.
- **Rejected alternatives:**
  - A single `outlinePath(boxes)` export with private line grouping (JD-005) — rejected because Unit 1 tests line
    grouping on its own.
  - Keeping `pad` as a parameter — rejected because it is a second copy of a value that has to match the CSS.
- **Revisit criterion:** A second caller of the geometry, or a stale outline seen after switching to Raw.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2.
- **Dependent decisions:** None.
- **Referenced in plan:** Review Findings.

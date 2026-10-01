# Change Plan: Current highlight single outline

## Why This Change

A highlighted passage that contains a link is outlined as a row of separate boxes, one around each piece of text between
links, instead of one outline around the passage. The same happens wherever formatting changes inside a passage: bold,
italic, or inline code. The operator reported this visual defect and traced it to
`current-highlight` being "applied to all elements in the highlighted area", where it "only needs to be applied to the
outermost element for the highlight". The operator's request is recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md).

## What Changes, In One Paragraph

The current highlight in the Rendered view gets one outline, however many pieces the editor splits the passage into.
The marks stop drawing the outline. Instead the editor measures where the passage's pieces sit on screen and draws one
outline shape over them. The shape is closed around wrapped lines. Chrome, the browser in the operator's screenshots,
already outlines a single wrapped piece this way today ([D-1](artifacts/change-decision-log.md#d-1-draw-the-current-highlights-outline-as-a-separate-layer-over-the-text)).
Highlights the writer is not on also lose the rounded corners that notch them where pieces meet
([D-7](artifacts/change-decision-log.md#d-7-highlights-the-writer-is-not-on-lose-their-rounded-corners)). The Raw view
does not change
([D-8](artifacts/change-decision-log.md#trivial-decisions)).

## Current State

The editor draws each highlighted passage as one ProseMirror inline decoration. The passage the writer is on gets the
class `ai-highlight current-highlight`
([C-1](artifacts/current-state-findings.md#c-1-each-passage-is-one-inline-decoration-and-the-current-one-gets-current-highlight)).

**The structural property at fault:** ProseMirror renders an inline decoration inside each text node's marks. A passage
that crosses a link becomes several sibling `<mark>` elements, some inside `<a>`, and no element wraps them all
([C-2](artifacts/current-state-findings.md#c-2-prosemirror-renders-one-decoration-as-several-sibling-elements-wherever-formatting-changes)).
The stylesheet outlines the current passage with CSS `outline` on `mark.current-highlight`, so each sibling draws its own
box ([C-3](artifacts/current-state-findings.md#c-3-the-current-outline-is-a-css-outline-on-each-mark-so-each-piece-draws-its-own-box)).
For the same reason, every highlight's 2px rounded corners notch the tint where pieces meet
([C-4](artifacts/current-state-findings.md#c-4-every-highlight-piece-has-rounded-corners-which-notch-the-tint-where-pieces-meet)).

Two facts constrain the fix:

- The `current-highlight` class is also how the code finds the current passage. Two scroll-into-view calls and the
  editor tests' `currentHighlight` helper query it
  ([C-5](artifacts/current-state-findings.md#c-5-current-highlight-is-also-the-scroll-target-and-the-tests-handle)).
- The editor already draws one thing over the text: the ask button. It measures in the host's scrolled-content
  coordinates and re-measures after every editor update, on a `ResizeObserver` over `editor.dom`, and on window
  `resize`
  ([C-6](artifacts/current-state-findings.md#c-6-the-ask-button-is-the-precedent-for-something-drawn-over-the-text-and-re-measured)).

UI tests run in happy-dom, which does no layout
([C-8](artifacts/current-state-findings.md#c-8-tests-run-without-layout)).

## Target State

**In plain language.** The outline is a thin SVG layer over the editor's text that draws only the outline. It is placed
the same way as the ask button, and re-measured at the same moments. The marks keep their tint and underline, and the
current passage's marks keep the `current-highlight` class. The class no longer draws anything. It only lets code find
the current passage.

**The parts, and what each answers for:**

- **`highlight-outline.ts`** (new) answers for geometry only: turning measured boxes into one outline path. It knows
  nothing about ProseMirror, the DOM, or highlights
  ([D-6](artifacts/change-decision-log.md#d-6-the-geometry-goes-in-its-own-file-with-its-own-test)).
- **`highlightOutline(view, scroller)`** (new, in `markdown-editor.tsx` next to `askButtonSpot`) answers for measuring.
  It collects `getClientRects()` from every `mark.current-highlight` in `view.dom`
  ([D-3](artifacts/change-decision-log.md#d-3-the-outline-is-measured-from-the-markcurrent-highlight-pieces-not-from-the-passages-document-range)),
  converts them to `scroller`'s scrolled-content coordinates as `askButtonSpot` does, and returns
  `outlinePath(lineBoxes(boxes))`. It returns `undefined` when the path is empty. It does not check raw mode; the
  component's `raw` gate is the only one.
- **`MarkdownEditor`** answers for placing. It is the only part that decides raw mode hides the outline. The callback
  that places the ask button also stores the outline path, with the same equality check. When there is a path and the view is not raw, the component portals `svg.highlight-outline`
  into `host` ([D-2](artifacts/change-decision-log.md#d-2-the-outline-layer-lives-where-the-ask-button-lives-and-is-re-measured-on-the-same-signals)).
- **`markdown-editor.css`** answers for appearance. It no longer outlines `.ProseMirror mark.current-highlight`
  ([D-4](artifacts/change-decision-log.md#d-4-current-highlight-stays-on-every-piece-as-a-marker-with-no-styling-of-its-own)).
  It positions and strokes the layer.

**Pinned contracts.**

The geometry functions
([D-5](artifacts/change-decision-log.md#d-5-the-outline-shape-one-box-per-line-traced-as-one-closed-path)):

```ts
export type Box = { left: number; top: number; right: number; bottom: number };

// How far outside the text the outline's stroke is centered. Paired with `stroke-width: 2` in markdown-editor.css,
// it covers 1px to 3px outside the text, as today's `outline: 2px; outline-offset: 1px` does.
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

For one shape over padded lines `b1…bn`, with `midᵢ` halfway between `bᵢ.bottom` and `bᵢ₊₁.top`, the path is:
`M b1.left b1.top`, `H b1.right`, then for each next line `V midᵢ H bᵢ₊₁.right`, then `V bn.bottom H bn.left`, then
back up for each line `V midᵢ H bᵢ.left`, then `Z`.

Worked example 1, two lines. Pieces measured as `{100,10,150,30}`, `{150,12,300,30}` and `{20,40,200,60}` (left,
top, right, bottom) give two lines, `{100,10,300,30}` and `{20,40,200,60}`. The path is
`M98 8 H302 V35 H202 V62 H18 V35 H98 Z`. A second line at `{400,40,500,60}` does not overlap the first horizontally,
so the result is two separate closed rectangles.

Worked example 2, a wrapped paragraph with a ragged right edge. Lines `{300,10,550,30}` (starts mid-line),
`{20,40,600,60}` (widest) and `{20,70,580,90}` (ends past the first line's right edge) give
`M298 8 H552 V35 H602 V65 H582 V92 H18 V65 H18 V35 H298 Z`. The right side steps out and then in; the left side
keeps the repeated `H18` the trace produces.

The measuring function, beside `askButtonSpot`:

```ts
function highlightOutline(view: EditorView, scroller: HTMLElement): string | undefined;
```

The layer's markup and style, which the component and stylesheet must agree on:

```html
<svg class="highlight-outline" aria-hidden="true"><path d="…" /></svg>
```

```css
.rich-editor .highlight-outline {
  position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none;
}
.rich-editor .highlight-outline path { fill: none; stroke: var(--accent); stroke-width: 2; }
@media (forced-colors: active) { .rich-editor .highlight-outline path { stroke: CanvasText; } }
```

The host is both the scroller and the layer's containing block, as it is for the ask button: `highlightOutline`
converts with the host's `getBoundingClientRect()` and `scrollTop`/`scrollLeft`, and the SVG sits at `top: 0; left: 0`
inside it.

`pointer-events: none` keeps clicks on the text, links and label chips working through the layer. It sits below the
ask button, which has `z-index: 5`.

## Surface Delta

### S-1: `highlight-outline.ts` (`Box`, `OUTLINE_PAD`, `lineBoxes`, `outlinePath`) — Added

**Target state.** `src/ui/documents/markdown-editor/highlight-outline.ts` exists and exports `Box`, `OUTLINE_PAD`,
`lineBoxes` and `outlinePath` with the signatures and behavior pinned under Target State. It imports nothing from the
editor. `highlight-outline.test.ts` tests it.

**Behavior.** Preserving. New code with no prior callers.

**Why.** It holds the geometry that turns sibling pieces into one outline, in a form tests can check without layout.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-outline-shape-one-box-per-line-traced-as-one-closed-path),
[D-6](artifacts/change-decision-log.md#d-6-the-geometry-goes-in-its-own-file-with-its-own-test)

### S-2: `highlightOutline(view, scroller)` — Added

**Target state.** `markdown-editor.tsx` has a module-private `highlightOutline(view, scroller): string | undefined`.
It returns the SVG path around every `mark.current-highlight` in `view.dom`, in `scroller`'s scrolled-content
coordinates. It returns `undefined` when the measured boxes give an empty path.

**Behavior.** Preserving for a passage drawn as one piece: the outline goes around the same text today's does. For a
passage drawn as several pieces, the outline's extent is the intended change recorded under S-4.

**Why.** It is the seam between the view and the geometry. It measures the same pieces today's outline surrounds and
leaves out the label chip.

**Depends on.** S-1.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-outline-is-measured-from-the-markcurrent-highlight-pieces-not-from-the-passages-document-range)

### S-3: `MarkdownEditor` overlay placement — Re-scoped

**Target state.** The callback `MarkdownEditor` runs after every editor state update, on resize of `editor.dom`, and on
window `resize` places both the ask button and the highlight outline. It stores the path from `highlightOutline` in
component state, and leaves state alone when the path is unchanged. When a path is stored and the view is not raw, the
component portals `svg.highlight-outline` with that path into `host`.

**Behavior.** Changing. The writer now sees the outline drawn by this layer. The ask button's placement and triggers are
unchanged. See Behavior Changes.

**Why.** The outline must be re-measured whenever the text can move, and the ask button's callback already runs at
exactly those moments.

**Depends on.** S-2.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-draw-the-current-highlights-outline-as-a-separate-layer-over-the-text),
[D-2](artifacts/change-decision-log.md#d-2-the-outline-layer-lives-where-the-ask-button-lives-and-is-re-measured-on-the-same-signals)

### S-4: Rendered-view outline styling — Re-scoped

**Target state.** `markdown-editor.css` has no rule that styles `.rich-editor .ProseMirror mark.current-highlight`. It
has the `.highlight-outline` rules pinned under Target State, including the forced-colors stroke. The Raw view's
`.rich-editor .raw-mirror mark.current-highlight` rule is unchanged.

**Behavior.** Changing. One outline around the current passage instead of one per piece. Requested by the operator.

**Why.** The per-mark `outline` is what draws one box per piece.

**Depends on.** S-3. Removing the rule before the layer exists would leave no outline at all.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-draw-the-current-highlights-outline-as-a-separate-layer-over-the-text),
[D-10](artifacts/change-decision-log.md#trivial-decisions)

### S-5: The `current-highlight` class in the Rendered view — Re-scoped

**Target state.** Every piece of the current passage carries `ai-highlight current-highlight`, as before. In the
Rendered view the class has no styling. It marks the current passage for the outline measurement, the two
scroll-into-view queries, and the tests' `currentHighlight` helper.

**Behavior.** Preserving. The same elements carry the class, and every query of it finds what it found before.

**Why.** The class is the existing handle for "the passage the writer is on". Only its styling was the defect.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-current-highlight-stays-on-every-piece-as-a-marker-with-no-styling-of-its-own)

### S-6: `.rich-editor .ProseMirror mark.ai-highlight` corners — Re-scoped

**Target state.** The rule keeps its tint, `color: inherit` and 2px accent underline, with no `border-radius`.

**Behavior.** Changing. Highlights have square corners and no notches where pieces meet. The operator left this choice
to the plan.

**Why.** Rounded corners on each piece make visible breaks in highlights that contain links.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-highlights-the-writer-is-not-on-lose-their-rounded-corners)

## Behavior Changes

- **One outline around the current highlight (S-3, S-4).** A writer stepping with < and > onto a passage that contains
  links sees one outline around the whole passage. Wrapped lines get one closed shape. Before, every link and every
  stretch between links had its own box. This is what the operator asked for, and they chose the outline-layer approach
  ([D-1](artifacts/change-decision-log.md#d-1-draw-the-current-highlights-outline-as-a-separate-layer-over-the-text)).
- **Square-cornered highlights (S-6).** Every highlight's tint and underline run unbroken across links, with square
  ends instead of 2px rounded ones. The operator: "pick what you think is best, we'll adjust later if it's not what i
  want, visually"
  ([D-7](artifacts/change-decision-log.md#d-7-highlights-the-writer-is-not-on-lose-their-rounded-corners)).

Nothing else changes for the writer. Scrolling to the current passage, the highlight count, clicking into a passage, the
ask button, and the Raw view behave as they do today.

## Change Units

### Unit 1: Outline geometry

**What it does.** Adds `highlight-outline.ts` with `Box`, `lineBoxes` and `outlinePath`, and their tests. Nothing calls
them yet.

**Delta entries.** S-1.

**How you know it worked.** `highlight-outline.test.ts` passes, covering at least:

- both worked examples, exactly;
- a single line;
- two lines that do not overlap horizontally, giving two shapes;
- `lineBoxes` with a piece taller than its neighbors (inline code), which still joins its line while the next line's
  pieces do not;
- zero-width boxes, which are dropped;
- empty input, which gives `''`.

`make test` stays green.

### Unit 2: Draw the outline as a layer

**What it does.** Adds `highlightOutline`, has the ask button's placing callback also store the outline path, and
renders `svg.highlight-outline`. In the same unit it removes the `.ProseMirror mark.current-highlight` outline rule and
adds the `.highlight-outline` rules.

**Delta entries.** S-2, S-3, S-4, S-5.

**Ordering constraint.** After Unit 1. The CSS removal and the layer land together, so there is never a state with no
outline or with two.

**How you know it worked.**

- Existing editor tests pass unchanged. This shows `current-highlight` still marks the same text (S-5). It says
  nothing about S-4, since happy-dom applies no stylesheet.
- A new component test on a passage that crosses a link. happy-dom does no layout
  ([C-8](artifacts/current-state-findings.md#c-8-tests-run-without-layout)), so it stubs `Element.prototype.getClientRects`
  to return fixed rects for `mark.current-highlight` elements and `[]` for everything else. It also gives the host a
  non-zero `getBoundingClientRect` and a non-zero `scrollTop`. It checks:
  - `.highlight-outline path`'s `d` equals `outlinePath(lineBoxes(…))` of the stubbed rects shifted into host
    coordinates, with exactly one `M…Z`;
  - `currentHighlight(container)` is the whole passage's text;
  - after `Next highlight`, `d` changes to the next passage's shape;
  - after switching to Raw, the `mark.current-highlight` elements still exist in the hidden document and the path is
    gone.
- Checked by eye in Chrome on the "3pitor (pronounced…)" paragraph of the operator's draft, and on a passage with
  inline code and bold: one outline, no per-piece boxes left, closed around wrapped lines, staying in place while
  scrolling, resizing the window, and typing inside the passage. Clicking a link and a label chip inside the outline
  still works.

### Unit 3: Square-cornered highlights

**What it does.** Removes `border-radius` from `.rich-editor .ProseMirror mark.ai-highlight`.

**Delta entries.** S-6.

**Ordering constraint.** None. It is independent of Units 1 and 2.

**How you know it worked.** By eye: on the same paragraph, highlights the writer is not on show no notches at link
edges. `make test` stays green.

## Risks

- **The outline lags or drifts from the text.** It is re-measured only on the ask button's three triggers (D-2). A
  layout shift none of them catches, such as a web-font swap that keeps `editor.dom` the same size, would leave it
  misplaced until the next editor update. Detectable in Unit 2's manual check. The fix is another trigger on the same
  callback.
- **Re-measuring on every editor update costs layout reads.** `getClientRects` on a handful of marks per keystroke is
  the same order of work `askButtonSpot` already does. The equality check prevents re-renders when nothing moved.
- **The layer catches clicks.** `pointer-events: none` is what prevents it. Unit 2's manual check should click a link
  and a label chip inside the outline.
- **Blast radius.** Confined to the Rendered view of `MarkdownEditor`. No server, chat or Raw view code changes.

## Deferred (YAGNI)

- **A resize-trigger test for the outline.** The trigger is shared with the ask button, whose tests already cover it.
  Reopen if the outline is seen out of place after a layout change.
- **Rounded corners on the outline path.** Today's outline is square, and nobody has asked for rounding. Reopen if the
  operator asks after seeing it.

## Cut for Scope

- **The box around a whole paragraph selected as a block.** This is ProseMirror's block-selection outline
  ([C-10](artifacts/current-state-findings.md#c-10-the-paragraph-wide-box-is-prosemirrors-block-selection-outline)),
  which appeared in the operator's first screenshot. The operator said "leave it out of the plan"
  ([D-9](artifacts/change-decision-log.md#trivial-decisions)). It would have toned down or removed that box. It can be
  reinstated on request.

## Open Items

None.

## Review Findings

One review round, with `han-core:junior-developer` and `han-core:test-engineer`. Findings that changed the plan:

- **Second worked example and line-grouping rule** (junior-developer JD-001, test-engineer T1 and T4, merged). The
  geometry was pinned only for two lines. Worked example 2, the path recipe, the order `lineBoxes` takes boxes in, and
  two Unit 1 cases were added
  ([D-5](artifacts/change-decision-log.md#d-5-the-outline-shape-one-box-per-line-traced-as-one-closed-path)).
- **Exact-path component test** (test-engineer T2, T3). "A non-empty `d`" would pass with a wrong coordinate
  conversion. Unit 2's test now asserts the exact path on a passage that crosses a link, the re-measure after stepping,
  and raw mode with the marks still present.
- **One raw-mode gate** (junior-developer JD-006). `highlightOutline` no longer checks raw mode; the component's `raw`
  gate does ([D-12](artifacts/change-decision-log.md#d-12-review-round-simplifications)).
- **Fixed pad** (junior-developer JD-004, test-engineer YAGNI note). The `pad` parameter became `OUTLINE_PAD`
  ([D-12](artifacts/change-decision-log.md#d-12-review-round-simplifications)).
- **Not only links** (junior-developer JD-002). Why This Change and the Unit 2 eye check now cover inline code and bold.
- **"Just as today" was a one-browser claim** (junior-developer JD-003). The wording now names Chrome, the browser in
  the operator's screenshots.
- **S-2's Preserving claim qualified** (test-engineer). It holds for one-piece passages only.

Kept as planned: separate `lineBoxes` and `outlinePath` exports (junior-developer JD-005). Unit 1 tests line grouping on
its own (T4) ([D-12](artifacts/change-decision-log.md#d-12-review-round-simplifications)). Every finding resting on real
browser layout was marked Unverified by its reviewer, and none blocks the build. Unit 2's eye check is where they get
checked.

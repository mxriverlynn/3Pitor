# Change Plan: Header Full Width, Boxed Panels

## Why This Change

This is a deliberate improvement with no triggering event. The user wants a different page layout, in their own words:
"make the header full browser width. put the file list below the header, instead of to the side of it, wrapped in a
rounded corner box with a bit of margin around it. do the same with the chat sidebar." The confirmed scope is in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md).

## What Changes, In One Paragraph

The top bar runs the full width of the window, on the landing page and on the post page. That bar holds 3pitor, Home,
the post's name, Saved or Unsaved, the Formatted / Markdown switch, and Save. The post panel and the chat start below
it. Each sits in a rounded, bordered box with an 8px gap around it, and the drag bars that resize them fill the gaps.
The editor and the post table stay in the middle, unboxed. `Editor` still owns everything the bar does. Only where the
bar is drawn moves: React draws it into a spot above the panels
([D-1](artifacts/change-decision-log.md#d-1-the-header-moves-by-portal-editor-keeps-everything-it-owns)).

## Current State

The top bar (`.editor-bar`) is the first child of `Editor`'s `<section className="editor">`. That section is the
middle cell of `.main`'s grid, so the bar spans only the editor column. `.app` has one row, so nothing sits above
`.main` ([C-1](artifacts/current-state-findings.md#c-1-the-header-sits-inside-the-editors-grid-column)).

The bar cannot simply be lifted out, because it shares four things with the editor body
([C-2](artifacts/current-state-findings.md#c-2-the-header-shares-state-a-ref-and-handlers-with-the-editor-body)):

- `save` and its error notice.
- The `nameHeading` ref, which four body paths focus.
- `wentHome`, which sets where focus goes on the post table.
- `focusName`, which moves focus to the post's name after a post opens.

About 60 tests in `documents.test.tsx` render `Editor` on its own and find Save, Home, and the view switch inside it
([C-8](artifacts/current-state-findings.md#c-8-documentstesttsx-renders-editor-on-its-own-header-included-about-60-times)).

`.main`'s column templates match its children by count, in three shapes
([C-3](artifacts/current-state-findings.md#c-3-the-grids-columns-match-its-children-by-count-in-three-shapes)):

- A post is open.
- The landing page.
- The landing page with the post panel kept.

The panel widths live in `App` state. They reach the grid as `--tree-width` and `--agent-width`, and each one is a grid
column's width
([C-4](artifacts/current-state-findings.md#c-4-panel-widths-are-app-state-passed-down-as-css-variables-and-set-as-the-grids-column-widths)).

The two panels look different today, and neither has a border, a radius, or a margin
([C-6](artifacts/current-state-findings.md#c-6-the-two-panels-are-styled-differently-and-neither-has-a-box)):

- The post panel (`aside.files.post-panel`) sits on the page's `--bg`.
- The chat (`section.side`) sits on `--panel`.

The drag bar draws a 1px line at all times. Its hover and focus state is a 3px accent line
([C-5](artifacts/current-state-findings.md#c-5-the-drag-bar-always-draws-a-1px-line-and-its-focus-indicator-is-its-own-background)).

## Target State

**The header renders above the panels, and `Editor` still owns it.** `App` renders a classless `<div>` as the first
in-flow child of `.app` and keeps the element in state. `Editor` takes that element as `barSlot`, and draws the bar
into it with `createPortal`. When `barSlot` is missing, `Editor` renders the bar inline as it does today, which is what
the standalone renders in `documents.test.tsx` rely on
([D-1](artifacts/change-decision-log.md#d-1-the-header-moves-by-portal-editor-keeps-everything-it-owns),
[D-2](artifacts/change-decision-log.md#trivial-decisions)). The pinned contract:

```tsx
// Editor's props gain:
barSlot?: HTMLElement | null;
//   undefined or null → the bar renders inline, first in <section className="editor">, as today
//   an element        → the bar renders into that element with createPortal; the body stays in the section

// App:
const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
<div className="app">
  {connected === false && <div className="connection-lost" role="alert">…</div>}
  <div ref={setBarSlot} />
  <div className={`main …`} style={…}>… <Editor … barSlot={barSlot} /> …</div>
</div>
```

On first mount `barSlot` is `null`, so the bar renders inline for one commit. The ref callback then sets the slot, and
React re-renders before paint. This rests on React's documented layout-phase behavior; no browser was run to see it.

The pieces the bar shares with the body keep working through the portal, because a portal keeps the React tree:

- `nameHeading` attaches to the portaled heading.
- React events bubble along the React tree.
- The Cmd/Ctrl-S listener is on `window`.
- `aria-describedby="read-only-notice"` resolves across the whole document.

**The grid gets a header row.** `.app` is `grid-template-rows: auto 1fr`: the slot is row 1 and `.main` is row 2.
`.main`'s three column templates do not change. The lost-connection banner is `position: fixed`, so it takes no row
([D-3](artifacts/change-decision-log.md#d-3-app-gets-a-header-row-mains-three-column-templates-stay)).

**Each panel's box sits on its existing root.** The box is two rules in `styles.css`, beside the existing shared
`.files h2, .side h2` rule
([D-6](artifacts/change-decision-log.md#d-6-each-panels-box-sits-on-its-existing-root-with-no-new-positioning-or-overflow)):

```css
.files, .side { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
.files { margin: 8px 0 8px 8px; }
.side { margin: 8px 8px 8px 0; }
```

Each box has no margin on the editor side, because the drag bar's 8px cell is the gap there. The box rule's comment
names `panel-resizer.css`, and the drag bar's comment names `styles.css`, so changing one 8px points at the other.

The editor and the post table get no inset. They stay flush under the header, so the boxes' top edges sit 8px lower than
the editor's toolbar ([D-12](artifacts/change-decision-log.md#trivial-decisions)).

Three constraints hold the box rules in place:

- `.files` keeps its `overflow: auto`.
- `.side` gets no `overflow`, because the model picker hangs below the chat's heading and must not be clipped.
- Neither box gets `position`, `transform`, `contain`, or `will-change`. That keeps the link and image popups placed
  against the window, and keeps the hidden `#chat-status` line where it is
  ([C-10](artifacts/current-state-findings.md#c-10-popups-and-hidden-status-lines-depend-on-which-ancestor-is-their-containing-block)).

**The drag bar is the gap.** `.panel-resizer` is 8px wide, with no negative margin and nothing drawn at rest. On hover
and `:focus-visible` it draws today's 3px accent line, which stays the keyboard focus indicator. `PanelResizer`'s markup
and logic do not change
([D-5](artifacts/change-decision-log.md#d-5-the-drag-bar-is-the-gap-drawn-only-while-hovered-or-focused)).

**A panel's width still means its grid column.** The width state and the CSS variables keep their meaning, and so do
`aria-valuenow` and the 120–600 and 280–800 ranges. The column now holds the box's 8px outer margin, so the box draws 8px
narrower than its stored width
([D-4](artifacts/change-decision-log.md#d-4-a-panels-width-still-means-its-grid-column-margin-included)).

## Surface Delta

### S-1: `Editor` — Re-scoped

**Target state.** `Editor` owns the post header, the post table, the notices, the editor, and their shared state,
exactly as before. It takes an optional `barSlot?: HTMLElement | null`. When `barSlot` is an element, the header renders
into it through `createPortal`, and everything else stays in `<section className="editor">`. When `barSlot` is
`undefined` or `null`, the header renders inline as the section's first child.

**Behavior.** Preserving for `Editor` itself. Every control in the header does what it did, and every focus move to the
post's name still lands, because a portal keeps the React tree. A standalone `Editor` is unchanged. The DOM-order effect
of passing a slot belongs to S-2.

Today's tests pin these behaviors only on a standalone `Editor`
([C-14](artifacts/current-state-findings.md#c-14-no-test-covers-cmdctrl-s-and-the-headers-focus-moves-are-tested-only-on-a-standalone-editor)), so a new `App` test pins focus across the portal ([D-10](artifacts/change-decision-log.md#d-10-two-new-app-tests-pin-the-headers-portal-path-the-existing-tests-stay-as-they-are)).

**Why.** The header has to render outside the editor column, but it shares state with the body
([C-2](artifacts/current-state-findings.md#c-2-the-header-shares-state-a-ref-and-handlers-with-the-editor-body)).

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-header-moves-by-portal-editor-keeps-everything-it-owns),
[D-10](artifacts/change-decision-log.md#d-10-two-new-app-tests-pin-the-headers-portal-path-the-existing-tests-stay-as-they-are)

### S-2: `App` — Re-scoped

**Target state.** `App` renders a classless `<div>` slot as the first in-flow child of `.app`, before `.main`. It keeps
that element in state with `useState<HTMLElement | null>(null)` and passes it to `Editor` as `barSlot`. `.main`, its
children, its classes, and its inline width variables are unchanged.

**Behavior.** Changing. The header now comes before the post panel in Tab order and in reading order
([D-7](artifacts/change-decision-log.md#d-7-the-header-comes-first-in-tab-and-reading-order)).

**Why.** The slot is where the header renders above both panels, and its DOM position is what puts the header first in
Tab order.

**Depends on.** S-1.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-header-moves-by-portal-editor-keeps-everything-it-owns),
[D-2](artifacts/change-decision-log.md#trivial-decisions),
[D-10](artifacts/change-decision-log.md#d-10-two-new-app-tests-pin-the-headers-portal-path-the-existing-tests-stay-as-they-are)

### S-3: `.app` grid — Re-scoped

**Target state.** `.app` is a two-row grid, `grid-template-rows: auto 1fr`. Row 1 is the header slot, sized to the
header. Row 2 is `.main`, which takes the rest of the window. `.main`'s three column templates are unchanged.

**Behavior.** Changing, as requested. The header spans the window, and the post panel and the chat start below it. The
view switch and Save keep their place at the bar's right end, which is now above the chat ([D-11](artifacts/change-decision-log.md#d-11-save-and-the-view-switch-sit-at-the-windows-right-edge)).

**Why.** The header needs a row of its own across the window
([C-1](artifacts/current-state-findings.md#c-1-the-header-sits-inside-the-editors-grid-column),
[C-3](artifacts/current-state-findings.md#c-3-the-grids-columns-match-its-children-by-count-in-three-shapes)).

**Depends on.** S-2.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-app-gets-a-header-row-mains-three-column-templates-stay),
[D-11](artifacts/change-decision-log.md#d-11-save-and-the-view-switch-sit-at-the-windows-right-edge)

### S-4: `.files` and `.side` — Re-scoped

**Target state.** The post panel (`.files`) and the chat (`.side`) each draw as a box on their existing root element.
Each box has a 1px `--border` border, an 8px radius, a `--panel` background, and an 8px margin on every side except the
side facing the editor. `.files` keeps `overflow: auto`. `.side` has no `overflow`. Neither box sets `position`,
`transform`, `contain`, or `will-change`. A panel's stored width is still its grid column's width, so the box draws 8px
narrower than that width.

**Behavior.** Changing, as requested: both panels are rounded boxes with a gap. The post panel's background moves from
`--bg` to `--panel`
([D-8](artifacts/change-decision-log.md#d-8-the-post-panel-draws-on-the-panel-color-and-its-paused-note-looks-inset)).
At the same stored width, each box is 8px narrower than the panel was
([D-4](artifacts/change-decision-log.md#d-4-a-panels-width-still-means-its-grid-column-margin-included)).

**Why.** The user asked for both panels in "a rounded corner box with a bit of margin around it".

**Decision.**
[D-6](artifacts/change-decision-log.md#d-6-each-panels-box-sits-on-its-existing-root-with-no-new-positioning-or-overflow),
[D-4](artifacts/change-decision-log.md#d-4-a-panels-width-still-means-its-grid-column-margin-included),
[D-8](artifacts/change-decision-log.md#d-8-the-post-panel-draws-on-the-panel-color-and-its-paused-note-looks-inset)

### S-5: `.panel-resizer` — Re-scoped

**Target state.** A drag bar is an 8px-wide cell that draws nothing at rest. While hovered or keyboard-focused, it draws
a 3px accent line down its middle. Its markup, its ARIA attributes, its pointer and arrow-key handling, and its props
are unchanged.

**Behavior.** Changing, as confirmed by the user. At rest the bar shows nothing, and its grab target grows from 5px to
8px. The keyboard focus indicator is unchanged.

**Why.** The bars now sit in empty gaps between boxes, where a resting line would read as a stray mark
([C-5](artifacts/current-state-findings.md#c-5-the-drag-bar-always-draws-a-1px-line-and-its-focus-indicator-is-its-own-background)).

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-drag-bar-is-the-gap-drawn-only-while-hovered-or-focused)

## Behavior Changes

The user asked for the run to settle these without stopping to ask. Each one is recorded as a decision.

- **The header spans the window, and both panels sit below it in rounded boxes.** Anyone looking at the page sees this.
  It is the change the user asked for (S-3, S-4).
- **Save and the Formatted / Markdown switch move to the window's right edge.** They keep their place at the right end
  of the bar, which is now above the chat rather than beside the editor. A pointer user travels about one chat-box width
  further to reach them, and Cmd/Ctrl-S still saves from anywhere ([D-11](artifacts/change-decision-log.md#d-11-save-and-the-view-switch-sit-at-the-windows-right-edge)).
- **Tab and a screen reader reach the header first.** A keyboard user now tabs through Home, the view switch, and Save
  before the post panel. The `3pitor` heading is read before the post panel's headings. This matches what the eye
  sees top to bottom. The cost shows after focus lands on the post's name, for example after opening a post. Tab now
  passes through every post panel row, two stops per row, before it reaches the editor. On a post with three research
  documents that is about ten more presses
  ([D-7](artifacts/change-decision-log.md#d-7-the-header-comes-first-in-tab-and-reading-order)).
- **The drag bars show nothing until hovered or focused.** A writer looking for one sees an empty 8px gap until the
  pointer is over it. The user accepted this in the confirmation turn
  ([D-5](artifacts/change-decision-log.md#d-5-the-drag-bar-is-the-gap-drawn-only-while-hovered-or-focused)).
- **Each box is 8px narrower at the same stored width.** At the default widths, the post panel is a 162px box rather than
  a 170px panel, and the chat is a 392px box rather than a 400px panel. The separator still announces 170 and 400
  ([D-4](artifacts/change-decision-log.md#d-4-a-panels-width-still-means-its-grid-column-margin-included)).
- **The post panel's background matches the chat's.** It moves from the page color to the panel color. In dark mode
  the row hover and the active row's fill get slightly fainter, and in light mode slightly stronger
  ([D-8](artifacts/change-decision-log.md#d-8-the-post-panel-draws-on-the-panel-color-and-its-paused-note-looks-inset)).
- **The lost-connection banner covers only the header.** It used to cover the top of every column. It still hides
  Saved or Unsaved and most of Save, as it did before
  ([D-9](artifacts/change-decision-log.md#d-9-the-lost-connection-banner-now-covers-only-the-header)).

## Change Units

### Unit 1: Draw the header across the window

**What it does.** The header moves above the panels and spans the window. The panels are not boxed yet.

**Delta entries.** S-1, S-2, S-3.

**How you know it worked.**

Two new tests in `app.test.tsx` pass ([D-10](artifacts/change-decision-log.md#d-10-two-new-app-tests-pin-the-headers-portal-path-the-existing-tests-stay-as-they-are)):

- **Focus crosses the portal.** Render `<App />` and open a post from the post table. Focus is on the post's name,
  `getByRole('heading', { name: <post title>, level: 2 })`. Press Home ("Your posts"), and focus is on the post table's
  search box.
- **The header comes first.** With a post open, `.editor-bar` precedes `aside.files` in document order, by
  `compareDocumentPosition`.

Every existing test in `app.test.tsx` and `documents.test.tsx` passes unchanged, `app.test.tsx:367` included: it checks
that a new post's text takes focus, and that text stays in `section.editor`
([C-7](artifacts/current-state-findings.md#c-7-app-tests-reach-the-header-through-its-class-and-its-parent-section)).

In the running app:

- The header spans the window on the landing page and on the post page. On the landing page it shows 3pitor, the view
  switch, and a disabled Save.
- Home, Save, Cmd/Ctrl-S, the view switch, Keep my version, and Undo each behave as before, and focus lands on the
  post's name where it did.
- The header does not blink on first load.

### Unit 2: Box the panels and make the drag bars the gaps

**What it does.** The post panel and the chat become rounded boxes with an 8px gap, and the drag bars draw only on
hover or focus. This unit is CSS only.

**Delta entries.** S-4, S-5.

**Ordering constraint.** After Unit 1. The box's top margin assumes the header sits above the panels.

**How you know it worked.**

- Every test passes unchanged. happy-dom does no layout, so no test can see the boxes.
- In the running app, check the following in light and dark mode:
  - Both pages, including the landing page with the post panel kept.
  - Whether the boxes read clearly. Their `--border` edge is 1.17:1 against the page in light mode and 1.40:1 in dark.
    If they don't read clearly, move the edge to `--input-border` (1.31:1 and 1.70:1), with the user's say
    ([D-6](artifacts/change-decision-log.md#d-6-each-panels-box-sits-on-its-existing-root-with-no-new-positioning-or-overflow)).
  - Row hover and the active row in the post panel, in dark mode especially.
  - A long post name scrolling sideways in the post panel.
  - The post row's "…" menu.
  - The model picker opening below the chat's heading.
  - A link popup in the editor.
  - Dragging and arrow-keying both bars, including a drag past the minimum and maximum widths, and where the accent line
    starts and ends against the boxes.
  - The lost-connection banner, by stopping the server, and whether Unsaved can still be read under it.

## Risks

- **A clipped popup or menu.** If a later tweak adds `overflow` to `.side`, the model picker is cut off. If it adds
  `transform` or `contain` to either box, the link and image popups land in the wrong place. Unit 2's visual check
  catches both. The target state's three constraints on the box rules prevent them.
- **A visible flash on first load.** The header renders inline for one commit before it moves to the slot. If React
  ever paints between the two, the header blinks. Nothing focuses it at mount, so focus is not at risk. The Unit 1 check
  in the running app catches the flash.
- **Faint box edges.** The `--border` edge measures 1.17:1 against the page in light mode and 1.40:1 in dark, and the
  box fill 1.08:1 and 1.10:1. On a washed-out screen the boxes the user asked for may barely show. Unit 2's visual
  check decides whether to move the edge to `--input-border`.
- **No layout tests.** Nothing automated sees the layout, so a later CSS change can break it silently.

## Deferred (YAGNI)

- **A shared `Panel` component or class.** It would have one box style for two panels with different insides. Reopen
  when a third boxed panel lands.
- **A `<header>` landmark for the slot.** Nobody asked for one. Reopen when someone asks for landmark navigation.
- **A `--gap` custom property.** It would replace one literal, `8px`, used in three rules. Reopen when the gap has to
  vary, for example on narrow screens.
- **A `barSlot` state that renders nothing until the slot exists.** The inline fallback meets the same need. Reopen
  when a mount-time effect focuses the post's name, or the first-load flash is seen.
- **A stored width that means the box rather than the column.** Reopen when a writer finds the narrower boxes cramped.
- **A forced-colors focus outline on the drag bar.** Today's bar already has no indicator in forced-colors mode, and
  this change does not make that worse. Reopen when an accessibility review raises it.

## Open Items

- **Cmd/Ctrl-S has no test anywhere** ([C-14](artifacts/current-state-findings.md#c-14-no-test-covers-cmdctrl-s-and-the-headers-focus-moves-are-tested-only-on-a-standalone-editor)). Non-blocking. The listener is on `window` and this change does not
  move it, so the gap predates the change. A test would settle it.
- **The box edge color.** Non-blocking. It is `--border` unless the Unit 2 check, with the user, moves it to
  `--input-border`.

## Review Findings

One review round ran, with `han-core:junior-developer`, `han-core:user-experience-designer`, and
`han-core:test-engineer`. No finding blocked the change. None rested on an input the reviewers could not inspect, other
than the rendered page, which nobody saw. These findings changed the plan:

- **The planned test retarget was wrong** (test-engineer). `app.test.tsx:367` checks a new post's text, not the header,
  so it stays as written. Two new `App` tests take its place ([D-10](artifacts/change-decision-log.md#d-10-two-new-app-tests-pin-the-headers-portal-path-the-existing-tests-stay-as-they-are)). C-7 is corrected, and C-14 records which
  tests pin the header's focus moves.
- **The header always shows the view switch and Save** (junior-developer JD-002). C-12 is corrected.
- **Save moves to the window's right edge** (junior-developer JD-001, user-experience-designer UX-001). Recorded as
  [D-11](artifacts/change-decision-log.md#d-11-save-and-the-view-switch-sit-at-the-windows-right-edge).
- **Tab order costs extra presses** after focus lands on the post's name (UX-002). Recorded in D-7.
- **The box edges and dark-mode row fills were measured** (UX-003, UX-004). Recorded in D-6 and D-8, and added to the
  Unit 2 check.
- **The banner hides the save status** (UX-006). D-9's reasoning is corrected.
- **The drag bar's line during a drag and its length** (UX-005). Added to D-5 and the Unit 2 check.
- **The post panel's fill was questioned as beyond the request** (junior-developer JD-003, YAGNI candidate). It is kept,
  with the user's "do the same with the chat sidebar" and the chat's existing fill as the evidence, in D-8.
- **`min-height: 0` in the box rule did nothing** (JD-005). It is dropped.
- **The shared 8px gap was written down in neither file** (JD-004). Each rule's comment now names the other.
- **The middle column's top edge** (JD-006). It stays flush under the header
  ([D-12](artifacts/change-decision-log.md#trivial-decisions)).

Every decision these produced is in `artifacts/change-decision-log.md`.

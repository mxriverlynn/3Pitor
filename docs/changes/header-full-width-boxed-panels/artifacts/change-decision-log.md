# Change Decision Log: Header Full Width, Boxed Panels

The plan itself lives in [../change-plan.md](../change-plan.md). This file records the question, rationale, evidence,
and rejected alternatives behind each decision. Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

The user asked the run to make the best decisions it can without asking, in an earlier planning run of this repository.
That standing delegation covers the escalations and behavior-change gates below. Each behavior-changing decision says
so, and the plan's Behavior Changes section and the run's final summary list them for the user.

## Trivial decisions

- D-2: The slot is a classless `<div>` — `App` renders `<div ref={setBarSlot} />` as the first in-flow child of `.app`,
  with no class, role, or landmark. Tests and CSS keep targeting `.editor-bar`. — Referenced in plan: Target State,
  Surface Delta.
- D-12: The editor and the post table stay flush under the header — only the two boxes are inset by 8px. The middle
  column gets no top margin, so the boxes' top edges sit 8px below the editor's toolbar line. The confirmed scope keeps
  the middle unboxed. — Referenced in plan: Target State; Review Findings.

## Full decisions

### D-1: The header moves by portal; `Editor` keeps everything it owns

- **Question:** How does the header leave the editor column when it shares state, a ref, and handlers with the editor
  body?
- **Decision:** `Editor` keeps every piece of state, every ref, and every handler it has today. It gains one prop, and
  renders the bar through `createPortal` when that prop holds an element:

  ```tsx
  // Editor's props gain:
  barSlot?: HTMLElement | null;
  //   undefined or null → the bar renders inline, first in <section className="editor">, as today
  //   an element        → the bar renders into that element with createPortal; the body stays in the section

  const bar = <div className="editor-bar">{/* unchanged */}</div>;
  return (
    <section className="editor">
      {barSlot ? createPortal(bar, barSlot) : bar}
      {/* the post table, notices, editor, and dialogs, unchanged */}
    </section>
  );

  // App:
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
  <div className="app">
    {connected === false && <div className="connection-lost" role="alert">…</div>}
    <div ref={setBarSlot} />
    <div className={`main …`} style={…}>… <Editor … barSlot={barSlot} /> …</div>
  </div>
  ```
- **Rationale:** The bar and the body share `save` and `saveError`, `nameHeading`, `wentHome`, `focusName`, and the
  `read-only-notice` id. They change for the same reasons, so they stay in one component, and only where the bar is
  drawn moves. The slot comes before `.main` in the DOM, so Tab and a screen reader reach the header first, which
  matches what the eye sees. React events bubble through a portal along the React tree, and `nameHeading` attaches to
  the portaled heading, so every focus move in C-2 still lands. The Cmd/Ctrl-S listener is on `window`, so where the
  bar is drawn does not affect it. A standalone `Editor` with no slot renders the bar inline, so the roughly 60
  standalone renders in `documents.test.tsx` keep finding Save, Home, and the view switch.
- **Evidence:** C-1, C-2, C-7, C-8; software-architect A1.
- **Behavior impact:** Changing, through the DOM order. See D-7. Everything the bar does is preserved.
- **Rejected alternatives:**
  - Split `Editor` into `EditorBar` and a body, and lift the shared state into a hook that `App` calls. This was
    rejected because it needs a new component, a new hook, and about five new props, and focus would cross a component
    boundary through a passed ref. The roughly 60 standalone renders would also lose their header (C-8). The portal
    meets the same need with one prop.
  - Make `.editor` `display: contents` and place the bar with `grid-column: 1 / -1`. This was rejected because every
    child of `.editor` would become a grid item needing its own placement, which breaks the body's flex column. The bar
    would also stay after the post panel in the DOM, so Tab order would not match what the eye sees (C-1).
  - Portal straight into `.app` with no slot element. This was rejected because React appends portal content after
    `.main`, which puts the header last in Tab order.
- **Revisit criterion:** A second component needs to put content in the header, or a test finds the brief inline render
  on first mount visible.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** D-2, D-3, D-7, D-10, D-11
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Change Units

### D-3: `.app` gets a header row; `.main`'s three column templates stay

- **Question:** How does the grid make room for a header across the window, given the three shapes in C-3?
- **Decision:** `.app` becomes `grid-template-rows: auto 1fr`. The slot is row 1 and `.main` is row 2. `.main`'s three
  column templates (C-3) do not change.
- **Rationale:** The header is outside `.main`, so `.main`'s children and its column templates are untouched, and all
  three shapes keep working. The lost-connection banner is `position: fixed` and takes no row (C-11).
- **Evidence:** C-1, C-3, C-11; software-architect A2.
- **Behavior impact:** Changing, and requested: the header spans the window, and the post panel and the chat start below
  it.
- **Rejected alternatives:**
  - Put the header inside `.main` with named grid areas for every shape. This was rejected because it rewrites all three
    templates and gives every child an explicit placement to fix a layout that only needed one more row.
- **Revisit criterion:** A panel ever needs to sit beside the header rather than under it.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta

### D-4: A panel's width still means its grid column, margin included

- **Question:** Once a box has an outer margin, does a panel's stored width mean the column or the box?
- **Decision:** It still means the column. `treeWidth` and `agentWidth`, `--tree-width` and `--agent-width`, the
  separator's `aria-valuenow`, and the ranges 120–600 and 280–800 are unchanged. The box draws 8px narrower than its
  column, because the column holds the box's outer margin.
- **Rationale:** Tests read the variables from `.main` (C-4). Meaning "box width" would need
  `calc(var(--tree-width) + 8px)` in three templates and new test expectations, with no stated need behind it.
- **Evidence:** C-4; software-architect A5.
- **Behavior impact:** Changing. At the default 170, the post panel draws a 162px box, and the chat draws a 392px box at
  its default 400. Settled by the run under the user's standing delegation.
- **Rejected alternatives:**
  - Make the width mean the box, adding the margin in the column templates. This was rejected for the reason above, and
    it is listed under Deferred (YAGNI).
- **Revisit criterion:** The writer finds the narrower boxes cramped at the widths they use.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-5: The drag bar is the gap, drawn only while hovered or focused

- **Question:** What does a drag bar look like when it sits in an 8px gap between a box and the editor?
- **Decision:** `.panel-resizer` is 8px wide, with no negative margin and no background at rest. On `:hover` and
  `:focus-visible` it keeps today's 3px accent line down its middle. `PanelResizer`'s markup and logic do not change.

  ```css
  .panel-resizer { width: 8px; z-index: 1; cursor: col-resize; touch-action: none; }
  .panel-resizer:hover, .panel-resizer:focus-visible {
    outline: none; background: linear-gradient(var(--accent), var(--accent)) center / 3px 100% no-repeat;
  }
  ```

  The 8px width is the gap between each box and the editor, and the box margins in D-6 leave that side to it. The
  `.panel-resizer` rule's comment says its width is that gap and names `styles.css`. The box rule's comment names
  `panel-resizer.css`, so changing one number points at the other.
- **Rationale:** A 1px line in the middle of an empty gap reads as a stray mark, and the user accepted drawing the bars
  only on hover or focus in the confirmation turn. The whole gap becomes the grab target, so the bar never overlaps a
  box's border. The keyboard focus indicator is the same line as today (C-5). The accent line keeps 6.42:1 against
  `--bg` in light mode and 7.62:1 in dark (user-experience-designer UX-005).
- **Evidence:** C-5; scope-boundary.md, Operator-Stated Scope; software-architect A4; junior-developer JD-004.
- **Behavior impact:** Changing, as confirmed by the user ("looks good"). At rest the bar shows nothing; the grab target
  grows from 5px to 8px; the bar starts below the header rather than at the top of the window. Two side effects are
  left to the Unit 2 check: the line runs the full height of `.main`, 8px past the top and bottom of each box, and a
  drag whose pointer outruns the bar loses the line until the pointer is back over it (UX-005).
- **Rejected alternatives:**
  - Keep 5px with `margin: 0 -2px`. This was rejected because it leaves dead space in the gap and overlaps the boxes'
    borders.
  - Keep the 1px line at rest. This was rejected because it contradicts the confirmed scope.
- **Revisit criterion:** Writers cannot find the drag bars.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-6: Each panel's box sits on its existing root, with no new positioning or overflow

- **Question:** Which elements carry the border, radius, margin, and background, given the menus in C-9 and the
  positioned elements in C-10?
- **Decision:** Two rules in `styles.css`, beside the existing shared `.files h2, .side h2` rule:

  ```css
  .files, .side { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
  .files { margin: 8px 0 8px 8px; }
  .side { margin: 8px 8px 8px 0; }
  ```

  The rule carries no `min-height: 0`: `.side` already has it, and `.files` is a grid item with `overflow: auto`, whose
  automatic minimum height is already 0 (junior-developer JD-005). Its comment names `panel-resizer.css` as the owner of
  the editor-side gap (D-5).

  The edge stays `--border`, like every other border on the page. Measured against the page, it is faint: 1.17:1 in
  light mode and 1.40:1 in dark, and the `--panel` fill against `--bg` is 1.08:1 and 1.10:1. `--input-border` would
  reach 1.31:1 and 1.70:1 (user-experience-designer UX-003). WCAG 1.4.11 does not require a container's edge to reach
  3:1, so the Unit 2 check decides, with the user, whether the box reads clearly enough or the edge moves to
  `--input-border`. No new palette token is added.

  `.files` keeps `overflow: auto`. `.side` gets no `overflow`. Neither gets `position`, `transform`, `contain`, or
  `will-change`.
- **Rationale:** The two panels' insides differ (one scroller against a four-row grid), so only the box is shared, and a
  selector list carries it. The drag bar's 8px cell is the gap on the editor side, so each box has no margin there.
  `.side` must not clip, because the model picker hangs below `.side-head` with `position: absolute; top: 100%`. Leaving
  positioning alone keeps the link and image popups placed against the window and keeps `#chat-status` where it is
  (C-10). The post panel's "…" menu is already clipped by its own scroller, so nothing changes there (C-9).
- **Evidence:** C-6, C-9, C-10; software-architect A3; user-experience-designer UX-003; junior-developer JD-004, JD-005.
- **Behavior impact:** Changing, and requested: both panels draw as rounded boxes with a gap. The post panel's
  background moves from `--bg` to `--panel`. See D-8.
- **Rejected alternatives:**
  - A shared `Panel` component or class. This was rejected because there is one box style for two panels with different
    insides; it is listed under Deferred (YAGNI).
  - A border with no background. This was rejected because the post panel would show `--bg` while the chat shows
    `--panel`, and one box would look empty.
  - `overflow: hidden` on `.side` to clip its corners. This was rejected because it cuts off the model picker.
- **Revisit criterion:** A third boxed panel lands, or a child of `.side` gains a fill that shows past the corners.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** D-8
- **Referenced in plan:** Target State; Surface Delta; Change Units

### D-7: The header comes first in Tab and reading order

- **Question:** The header now precedes the post panel in the DOM. Is the new Tab and heading order acceptable?
- **Decision:** Yes. Tab now runs header, post panel, its drag bar, the editor body, the chat's drag bar, then the chat.
  The `3pitor` level-1 heading comes before the post panel's headings.
- **Rationale:** The new order matches what the eye sees, top to bottom then left to right. The old order, post panel
  before header, only matched the old layout. It meets WCAG 2.4.3 Focus Order.
- **Evidence:** C-1, C-2; behavioral-analyst B-1; software-architect A1; user-experience-designer UX-002.
- **Behavior impact:** Changing. A keyboard or screen-reader user reaches Home, the view switch, and Save before the
  post panel. There is a cost. Four paths put focus on the post's name: opening a post from the table, Keep my
  version, closing the review strip, and confirming Undo all. From the name, Tab used to reach the editor after the
  view switch and Save. Now it passes through every post panel row on the way, two stops per row once a row's "…"
  button joins, then the drag bar. On a post with three research documents that is about ten more presses. Settled by
  the run under the user's standing delegation.
- **Rejected alternatives:**
  - Keep the old DOM order and place the header visually with CSS. This was rejected because Tab order would then
    disagree with the visual order (D-1).
- **Revisit criterion:** The user wants the post panel reached first, or the extra Tab stops between the post's name and
  the editor become a complaint. A skip link to the editor would answer the second, and it is new scope.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes

### D-8: The post panel draws on the panel color, and its paused note looks inset

- **Question:** The post panel's box takes the `--panel` background. Is the shift in the panel's colors acceptable?
- **Decision:** Yes. The post panel draws on `--panel`, like the chat. The paused note keeps `var(--bg)` and its border,
  and it stays readable; at 1.08:1 against the panel it barely stands apart from it. Row hover stays `var(--border)`.
- **Rationale:** The user said "do the same with the chat sidebar", and the chat already draws on `--panel`. A box on
  the page's own `--bg` would differ from its surroundings only by a 1.17:1 edge, so the two boxes would not look like
  the same treatment.
- **Evidence:** C-6; behavioral-analyst B-14; software-architect A3; user-experience-designer UX-004; junior-developer
  JD-003, which raised the recolor as a YAGNI candidate.
- **Behavior impact:** Changing, and visual only. Settled by the run under the user's standing delegation. Measured
  against the row's ground, before and after (UX-004):

  | Fill | Light, before → after | Dark, before → after |
  | --- | --- | --- |
  | Row hover (`--border`) | 1.17 → 1.26 | 1.40 → 1.27 |
  | Active row (`--accent-soft`) | 1.05 → 1.14 | 1.30 → 1.18 |

  Light mode gains a little; dark mode loses a little. The active row is also marked by its accent text and
  `aria-current`, so nothing is lost outright. The Unit 2 check looks at both in dark mode.
- **Rejected alternatives:**
  - Border, radius, and margin only, keeping the post panel on `--bg`. This was rejected because the chat already has a
    fill, so only the post panel would look empty, and its edge alone is 1.17:1.
  - Restyle the paused note and row hover to suit the new background. This was rejected because nothing shows they need
    it; it is left for the Unit 2 visual check.
- **Revisit criterion:** The Unit 2 check finds a hover or the note hard to see.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Behavior Changes

### D-9: The lost-connection banner now covers only the header

- **Question:** The banner is fixed over the top of the window. Once the header spans the window, it covers only the
  header. Is that acceptable?
- **Decision:** Yes. No change to the banner.
- **Rationale:** Today it covers the top of every column. Afterwards it uncovers the tops of both panels and covers only
  the header. That is not a free trade. The banner is about 33px tall and the header about 49px, so the banner hides
  Saved or Unsaved and most of Save, which is the status a writer checks when the connection drops. That was already
  true, because the header sat at the top of its column before, so this change does not make it worse.
- **Evidence:** C-11; behavioral-analyst B-11; user-experience-designer UX-006, which corrected the first draft's
  reason ("the header has nothing to edit").
- **Behavior impact:** Changing, slightly, for the better. Settled by the run under the user's standing delegation. The
  Unit 2 check looks at whether Unsaved is readable while the banner shows. The heights are worked out from CSS, not
  measured in a browser.
- **Rejected alternatives:**
  - Reserve a row for the banner. This was rejected because nothing asked for it, and the banner's own comment says it
    is fixed so that it does not move the post.
- **Revisit criterion:** The banner hides a control someone needs while the connection is lost.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes

### D-10: Two new `App` tests pin the header's portal path; the existing tests stay as they are

- **Question:** What shows that the header still works once it renders through the portal, and that it comes first?
- **Decision:** `app.test.tsx` gains two tests, and no existing test changes:

  1. **Focus crosses the portal.** Render `<App />`, open a post from the post table, and assert that
     `document.activeElement` is the post's name, `getByRole('heading', { name: <post title>, level: 2 })`. Then press
     Home ("Your posts") and assert that focus is on the post table's search box. This pins `nameHeading` and `wentHome`
     on the portal path.
  2. **The header comes first.** With a post open, assert that `.editor-bar` precedes `aside.files` in document order,
     using `compareDocumentPosition` and `Node.DOCUMENT_POSITION_FOLLOWING`. This pins D-7.

  `app.test.tsx:367` stays as written. It checks that a new post's text takes focus, and that text stays in
  `section.editor`.
- **Rationale:** Every existing test of the header's focus moves renders `Editor` on its own, which takes the inline
  path, so none would notice a heading that never re-attached its ref across the portal (C-14). One `App` test covers
  the shared mechanism. Keep my version, closing the review strip, and Undo all all call the same
  `nameHeading.current?.focus()`, so testing each of them through `App` adds nothing.
- **Evidence:** C-7, C-14; test-engineer review, findings 1–3.
- **Behavior impact:** Preserving. Tests only.
- **Rejected alternatives:**
  - Retarget `app.test.tsx:367` to assert focus inside `.editor-bar`, as the first draft planned. This was rejected
    because that test checks the new post's text, not the header (C-7). The retarget would fail a correct build and
    drop the check it was written for.
  - An `App` test for each of Keep my version, closing the review strip, and Undo all. This was rejected because they
    share the one focus call that test 1 already pins.
  - A test for Cmd/Ctrl-S. This was rejected for this change, because the listener is on `window` and does not move.
    The gap predates this change, and it is listed under Open Items.
- **Revisit criterion:** A header behavior starts depending on where the header sits in the DOM.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Change Units; Open Items; Review Findings

### D-11: Save and the view switch sit at the window's right edge

- **Question:** The header's spacer pushes the view switch and Save to the bar's right edge. Once the bar spans the
  window, that edge is above the chat box, not beside the editor. Is that acceptable?
- **Decision:** Yes. The header's contents keep their arrangement: 3pitor, Home, the name, and Saved or Unsaved on the
  left, then the view switch and Save on the right. No layout rule is added for them.
- **Rationale:** It follows directly from "make the header full browser width". The user's screenshot shows the
  switch and Save at the bar's right end today. Cmd/Ctrl-S still saves from anywhere.
- **Evidence:** C-12 (corrected); junior-developer JD-001; user-experience-designer UX-001.
- **Behavior impact:** Changing. A pointer user moves about one chat-box width further to reach Save or the view
  switch, and on a wide window Unsaved sits a full window-width from Save. The controls sit above the chat, so they can
  look as if they belong to it. Settled by the run under the user's standing delegation, and named for the user in the
  run's summary.
- **Rejected alternatives:**
  - Keep the view switch and Save above the editor column, for example by aligning them to the editor's right edge.
    This was rejected because it needs the header to know the chat's width, and nothing in the request asks for it.
- **Revisit criterion:** The user wants Save next to the editor.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Behavior Changes; Review Findings

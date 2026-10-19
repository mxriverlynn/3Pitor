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
- D-10: The one test assertion tied to the old parent moves to the bar — `app.test.tsx:367` asserts that focus is inside
  `.editor-bar` rather than `section.editor`. It still checks the behavior it was written for: once a post opens from
  the table, focus lands on the post's name. — Referenced in plan: Change Units.

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
- **Dependent decisions:** D-2, D-3, D-7, D-10
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
- **Rationale:** A 1px line in the middle of an empty gap reads as a stray mark, and the user accepted drawing the bars
  only on hover or focus in the confirmation turn. The whole gap becomes the grab target, so the bar never overlaps a
  box's border. The keyboard focus indicator is the same line as today (C-5).
- **Evidence:** C-5; scope-boundary.md, Operator-Stated Scope; software-architect A4.
- **Behavior impact:** Changing, as confirmed by the user ("looks good"). At rest the bar shows nothing; the grab target
  grows from 5px to 8px; the bar starts below the header rather than at the top of the window.
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
  .files, .side { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); min-height: 0; }
  .files { margin: 8px 0 8px 8px; }
  .side { margin: 8px 8px 8px 0; }
  ```

  `.files` keeps `overflow: auto`. `.side` gets no `overflow`. Neither gets `position`, `transform`, `contain`, or
  `will-change`.
- **Rationale:** The two panels' insides differ (one scroller against a four-row grid), so only the box is shared, and a
  selector list carries it. The drag bar's 8px cell is the gap on the editor side, so each box has no margin there.
  `.side` must not clip, because the model picker hangs below `.side-head` with `position: absolute; top: 100%`. Leaving
  positioning alone keeps the link and image popups placed against the window and keeps `#chat-status` where it is
  (C-10). The post panel's "…" menu is already clipped by its own scroller, so nothing changes there (C-9).
- **Evidence:** C-6, C-9, C-10; software-architect A3.
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
- **Referenced in plan:** Target State; Surface Delta

### D-7: The header comes first in Tab and reading order

- **Question:** The header now precedes the post panel in the DOM. Is the new Tab and heading order acceptable?
- **Decision:** Yes. Tab now runs header, post panel, its drag bar, the editor body, the chat's drag bar, then the chat.
  The `3pitor` level-1 heading comes before the post panel's headings.
- **Rationale:** The new order matches what the eye sees, top to bottom then left to right. The old order, post panel
  before header, only matched the old layout.
- **Evidence:** C-1, C-2; behavioral-analyst B-1; software-architect A1.
- **Behavior impact:** Changing. A keyboard or screen-reader user reaches Home, the view switch, and Save before the
  post panel. Settled by the run under the user's standing delegation.
- **Rejected alternatives:**
  - Keep the old DOM order and place the header visually with CSS. This was rejected because Tab order would then
    disagree with the visual order (D-1).
- **Revisit criterion:** The user wants the post panel reached first.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes

### D-8: The post panel draws on the panel color, and its paused note looks inset

- **Question:** The post panel's box takes the `--panel` background. Is the shift in the panel's colors acceptable?
- **Decision:** Yes. The post panel draws on `--panel`, like the chat. The paused note keeps `var(--bg)`, so it now
  reads as an inset note rather than blending in. Row hover stays `var(--border)`.
- **Rationale:** The two boxes should look alike. The inset note is still legible, and nothing about it says it must
  match the panel's background.
- **Evidence:** C-6; behavioral-analyst B-14; software-architect A3.
- **Behavior impact:** Changing, and visual only. Settled by the run under the user's standing delegation. Contrast was
  not measured; checking it in light and dark mode is part of Unit 2.
- **Rejected alternatives:**
  - Restyle the paused note and row hover to suit the new background. This was rejected because nothing shows they need
    it; it is left for the Unit 2 visual check.
- **Revisit criterion:** The Unit 2 check finds a hover or the note hard to see.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes

### D-9: The lost-connection banner now covers only the header

- **Question:** The banner is fixed over the top of the window. Once the header spans the window, it covers only the
  header. Is that acceptable?
- **Decision:** Yes. No change to the banner.
- **Rationale:** Today it covers the top of every column. Afterwards it covers only the header, which has nothing to
  edit while the connection is lost.
- **Evidence:** C-11; behavioral-analyst B-11.
- **Behavior impact:** Changing, slightly, for the better. Settled by the run under the user's standing delegation.
- **Rejected alternatives:**
  - Reserve a row for the banner. This was rejected because nothing asked for it, and the banner's own comment says it
    is fixed so that it does not move the post.
- **Revisit criterion:** The banner hides a control someone needs while the connection is lost.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes

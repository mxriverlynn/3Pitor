# Change Decision Log: Actions Button Pinned to the Panel Edge

The plan lives in [../change-plan.md](../change-plan.md). Evidence about today's code is in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

The user delegated escalations for this run ("make the best decisions you can, without asking me", standing preference
recorded 2026-10-01). Every decision that would have gone to them was settled here and is reported in the run's
summary. It is marked **Delegated** below.

## Trivial decisions

- D-11: Keyboard order stays as it is — "…" stays before the name in the DOM, so a focused name reaches it with
  Shift+Tab, as today. Nobody asked for a change. — Referenced in plan: Target State, Behavior Changes.
- D-12: The "+" button and its menu stay untouched — the scope turn put "+" out of scope, and nothing in this design
  touches `.files-head`. — Referenced in plan: Target State.
- D-13: One change unit, not two — the first draft's Unit 1 only re-anchored the menu without fixing the reported
  problem. It existed only for a hover check that the single unit's browser check also covers (junior-developer
  JD-006). — Referenced in plan: Change Units.
- D-14: Leave the gaps that show-on-hover already has today for another change. These are: forward Tab skips every
  hidden "…", touch screens never show it, and Escape does not return focus to "…". The scope turn kept show-on-hover as
  it is. — Referenced in plan: Cut for Scope, Open Items.
- D-15: "…" gets a 1px rounded border in `--muted` — the user asked during the build for "a 1px, rounded corner border".
  The border uses the muted text color, because the chip's fill is the `--border` highlight color, so a `--border`
  line would not show. The corners keep the chip's 4px radius. — Referenced in plan: Target State.

## Full decisions

### D-1: Pin with CSS sticky positioning on a wrapper, not with script or other CSS

- **Question:** How should "…" and its menu stay at the visible right edge while the names scroll sideways?
- **Decision:** A wrapper element around "…" and the row's menu is `position: sticky` against the scrolling
  `aside.files`. It sits at the row's own right end. When the row runs past the visible edge, the browser holds it at
  that edge. It sets no `top`, so it scrolls up and down with its row.
- **Rationale:** Sticky positioning does the whole job in the stylesheet. No measuring, no scroll listeners, no state.
  The row is already as wide as the scrolled content (C-1), and `aside.files` is already the scroll container (C-3). So
  the wrapper has the full row width to slide across.
- **Evidence:** C-1, C-3, C-10. Proposed by `han-core:software-architect`.
- **Behavior impact:** Changing. This is the requested change: "…" is reachable without scrolling sideways. Delegated;
  the user asked for this outcome in the request.
- **Rejected alternatives:**
  - Make only the button sticky. Rejected because the menu stays anchored to the row's far end (C-5), which breaks the
    confirmed requirement that the menu opens beside the button.
  - Position with script (`getBoundingClientRect`, or `position: fixed`). Rejected because it needs scroll and resize
    listeners, state, and a new hook, and CSS already does the job (YAGNI). `fixed` also stops following the row when
    the panel scrolls up and down.
  - CSS anchor positioning. Rejected because each row needs its own anchor name, browser support is uneven, happy-dom
    cannot check it, and it still needs a pinned button.
  - Move the horizontal scroll onto each row, or take "…" out of the tree. Rejected because each breaks either "long
    names keep scrolling sideways" as one section, or drag and drop on the `li` (C-8).
- **Revisit criterion:** The browser check shows sticky positioning failing in the browser 3pitor runs in.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** D-2, D-3, D-7, D-9, D-10
- **Referenced in plan:** Target State, Surface Delta

### D-2: The wrapper is a `div.row-actions` holding "…" and the row's menu, on-disk rows only

- **Question:** What element wraps "…" and the menu, where does it sit, and what does it hold?
- **Decision:** `<div className="row-actions">` holds `button.more` and, while open, the row's `Menu`. It sits in the same
  place they do today: the first child of `li.row`, before `button.name`. It renders only when `node.onDisk`, the
  same condition "…" has today. The menu keeps its existing condition (`menu?.at === node.path`) inside it.
- **Rationale:**
  - `Menu`'s root element is a `div`, and a `div` inside a `span` is invalid HTML.
  - The wrapper must not be a button, because a test forbids a button inside a button (C-9).
  - It must not be an `li`, because `rowOf` finds a row with `closest('li')` (C-8).
  - It must stay inside the `li`, so a drag started on "…" still drags the row (C-8).
  - `Menu` opens below and right-aligned to its nearest positioned ancestor (C-5). The wrapper becomes that ancestor.
  - A row with no on-disk item has no "…", so it needs no wrapper.
  - The class is `row-actions`, not `actions`, because `file-tree.css` already uses `.actions` for the dialogs' button
    bar (junior-developer JD-005).
- **Evidence:** C-2, C-5, C-7, C-8, C-9.
- **Behavior impact:** Preserving on its own. Open, close, Escape, outside-press, and focus-on-open do not depend on
  where the menu sits in the DOM (C-7). The menu's new position is D-4.
- **Rejected alternatives:**
  - A `span` wrapper. Rejected because it would hold a `div`, which is invalid HTML.
  - The class name `actions`. Rejected because the same stylesheet already uses it for the dialog button bar.
  - Putting the menu inside the button. Rejected because it nests buttons, and the C-9 test fails.
  - A new `RowActions` component. Rejected because it has one caller and nothing else would use it (YAGNI).
- **Revisit criterion:** A second place in the app needs the same pinned button-and-menu pair.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** D-3, D-4
- **Referenced in plan:** Target State, Surface Delta

### D-3: Show-on-hover moves from the button to the wrapper, keeping today's triggers

- **Question:** How is "…" kept hidden until needed once it sits inside a wrapper?
- **Decision:** The wrapper carries `visibility: hidden`. It turns visible on the same five triggers as today, re-pointed
  through the wrapper:
  - "…" hovered;
  - "…" keyboard-focused;
  - its menu open;
  - the row's name hovered;
  - the row's name keyboard-focused.

  The name stays highlighted while "…" is hovered, keyed on the button rather than the wrapper, so hovering the open
  menu does not light up the name. Selector shapes:
  ```css
  .files .row > .row-actions { visibility: hidden; }
  .files .row > .row-actions:has(> button.more:is(:hover, :focus-visible, [aria-expanded="true"])),
  .files .row:has(> button.name:is(:hover, :focus-visible)) > .row-actions { visibility: visible; }
  .files .row:has(> .row-actions > button.more:hover) > button.name { background: var(--border); }
  ```
- **Rationale:**
  - Every existing selector reaches "…" as a direct child of the row, and a wrapper breaks all of them (C-4).
  - The direct-child shape is kept on purpose, so a child row's hover never reveals its parent folder's "…".
  - Hiding the wrapper instead of only the button matters because a hidden element lets the pointer through. A visible
    wrapper around a hidden button would leave a dead spot at the right end of every row. A click there would not open
    the file and would not highlight the name.
- **Evidence:** C-4; software-architect proposal.
- **Behavior impact:** Preserving. The same triggers show "…", and the same pointer position highlights the name.
- **Rejected alternatives:**
  - Keep `visibility` on the button. Rejected because of the dead spot described above.
  - Key the name highlight on `.row-actions:hover`. Rejected because hovering the open menu would then highlight the name.
- **Revisit criterion:** None expected.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

### D-4: An open folder's menu opens under the folder's own line

- **Question:** Today an expanded folder's menu opens below every row inside that folder (C-5). Anchoring the menu to the
  wrapper moves it to directly under the folder's own "…". Is that acceptable?
- **Decision:** Yes. Every row's menu opens directly under its "…", right edges aligned, whether or not it is an
  expanded folder. As a side effect, a file's or collapsed folder's menu also starts a few pixels higher than today.
  It starts at the bottom of the ~20px chip, inside the row's bottom padding, rather than at the bottom of the ~27px
  row (user-experience-designer UX-006). That is accepted, and the browser check judges it.
- **Rationale:** The user confirmed that the menu should open beside the pinned button. Opening it far below, past the
  folder's children, contradicts that. It also fixes a quirk nobody asked to keep.
- **Evidence:** C-5; scope-boundary.md Operator-Stated Scope (question 2 answered "yes").
- **Behavior impact:** Changing. Someone opens "…" on an expanded folder with three files in it. Today the menu appears
  below the third file. After the change it appears right under the folder's name. Delegated: settled by the run per
  the user's standing preference.
- **Rejected alternatives:**
  - Keep the menu anchored to the `li`. Rejected because the `li` is as wide as the scrolled content, so the menu would
    stay off-screen for long names (C-1, C-5).
- **Revisit criterion:** The user prefers the old placement.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta

### D-5: The shared menu component and its stylesheet stay unchanged

- **Question:** Does `Menu` or `menu.css` need to change?
- **Decision:** No. `.menu { position: absolute; right: 0; top: 100% }` resolved against the wrapper is "under the
  button, right edges aligned", which is what the row needs. No caller override is added to `file-tree.css`.
- **Rationale:** The default already fits once the anchor moves. Editing `menu.css` would also move the "+" menu and
  the Agent Actions menu (C-6).
- **Evidence:** C-5, C-6, C-7.
- **Behavior impact:** Preserving for the "+" and Agent Actions menus.
- **Rejected alternatives:**
  - A row-scoped `.files .row .menu` override. Rejected because nothing needs overriding yet (YAGNI). See Deferred.
- **Revisit criterion:** The browser check shows the row menu misplaced under the pinned button.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Deferred (YAGNI)

### D-6: Tests pin the declared CSS values through the real DOM, and a browser check confirms the geometry

- **Question:** How is the change verified, given that the test environment cannot lay out a page?
- **Decision:** Add three tests to `file-tree.test.tsx` in the `addTreeStyles` style (C-9). Name each for the behavior,
  as the existing tests are.
  1. **The wrapper.** On an expanded folder with its menu open:
     - find the wrapper as the "Actions for …" button's `parentElement`, never by class;
     - assert that it contains the open menu, is not a button, and that its `closest('li')` is the folder's own `li`;
     - assert its computed `position` is `sticky`, `right` is `-8px`, `marginRight` is `2px`, and `gridArea` is `1 / 1`.

     Finding the wrapper from the button means that renaming the class, moving the wrapper out from under the row, or
     moving the menu out of the wrapper each fails this one test.
  2. **The row's grid.** The row is `display: grid`, its name button has `gridArea` `1 / 1`, and an open folder's child
     `ul` has `gridArea` `2 / 1`. This catches a wrapper or list that falls onto its own grid line, which `display:
     grid` alone would not.
  3. **The open-menu rules.** Click "Actions for X", then read the wrapper's style for the first time. Assert
     `visibility` is `visible` and `zIndex` is `1`. A second test reads a closed row's wrapper and asserts
     `visibility` is `hidden`. The style must be read only after the click, because happy-dom does not update a style
     it has already computed when an attribute changes (C-11).

  Keep the existing role-based tests unchanged. They must pass as they are. Hover and keyboard focus cannot be
  simulated, so the show-on-hover triggers, the name highlight, and all geometry are left to the browser check in the
  change unit.
- **Rationale:** happy-dom reports `position: sticky`, `right`, margins, and grid placement (C-10). It evaluates `:has()`
  with `:is()` inside (C-11). It cannot measure where anything lands or simulate hover (C-9). These tests stop each
  load-bearing value in the contract from being silently dropped. The browser check covers what they cannot see.
- **Evidence:** C-9, C-10, C-11; test-engineer T1–T3; junior-developer JD-004.
- **Behavior impact:** Not applicable (verification).
- **Rejected alternatives:**
  - Look the wrapper up by class in the declared-value tests. Rejected because those tests would still pass against a
    selector that no longer matches the DOM.
  - A standalone structural test separate from the declared values. Rejected because the combined test catches
    everything the separate one would, and more.
  - A happy-dom test that a drag started on "…" bubbles to the `li`. Rejected because happy-dom event bubbling is not
    evidence of native drag behavior, and the `closest('li')` assertion already pins the containment.
  - A browser-driven layout test runner. Rejected because one change does not justify a new test runner (YAGNI). See
    Deferred.
- **Revisit criterion:** A second layout bug in the tree slips past declared-value tests.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Change Units, Deferred (YAGNI)

### D-7: The pin inset is `right: -8px`, because the browser measures it from inside the panel's padding

- **Question:** Which sticky offset puts "…" 2px inside the visible edge for long names, and leaves the tree looking as
  it does today when it fits the panel?
- **Decision:** The wrapper has `right: -8px` and `margin: 2px 2px 0 0`. The top margin replaces today's `top: 2px`.
- **Rationale:**
  - Measured in Chrome during the build: the browser measures a sticky element's `right` from inside the scroll
    container's padding. `aside.files` has 10px of padding, so `right: 2px` held "…" a steady 12px from the visible edge
    (C-12). `right: -8px` puts it 2px from the edge.
  - At 12px, a sliver of the long name showed to the right of the chip, which read as if the name ran under a button
    sitting in the wrong place. At 2px, no text shows past "…".
  - A sticky element cannot leave its row, so over the last 10px of sideways scroll "…" eases back to rest 2px inside
    its row's end, 12px from the visible edge. Only panel padding sits to its right there.
  - When the whole tree fits the panel, the 2px right margin keeps "…" 2px in from the row's end, as today.
- **Evidence:** C-1, C-3, C-12 (browser measurement).
- **Behavior impact:** Changing, as part of S-1: where "…" sits for long names.
- **Rejected alternatives:**
  - `right: 2px`. This was the plan's first value, which assumed the panel padding does not count. Rejected because the
    browser measured it at 12px from the visible edge (C-12).
  - `right: 12px`. This was the software-architect's value. It assumed the padding counts, but added it the wrong way
    round. Rejected because it would sit 22px in.
  - Removing the panel's right padding. Rejected because it would move the "+" button and the whole tree, which is out
    of scope.
- **Revisit criterion:** A browser other than Chrome measures the inset differently.
- **Dissent (if any):** None remaining. The browser measurement settled the disagreement between the plan and the
  architect.
- **Settles delta entry:** S-1
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Risks

### D-8: "…" gets an opaque background that matches the row's highlight, so it reads clearly over the name

- **Question:** Once pinned, "…" sits over the middle of a long name in view. How does it stay readable, and what color
  should it be?
- **Decision:** `button.more` gets `border-radius: 4px` and an opaque background:
  ```css
  .files .row > .row-actions > button.more { background: var(--border); }
  .files .row.active > .row-actions > button.more { background: var(--accent-soft); }
  .files .row > .row-actions > button.more:disabled { opacity: 1; color: var(--muted); }
  ```
  The chip hides about 24px of the name text under it.
- **Rationale:**
  - The user asked for "…" to float above the name. Without a background, the dots and the letters would overlap and
    both would be hard to read.
  - "…" shows almost only while its row is highlighted. Hovering the name or "…" paints the row `--border`, and the
    active row stays `--accent-soft`. A chip in the same color merges with that highlight. A `--bg` chip would punch a
    lighter hole in it, right under the pointer.
  - When "…" shows because the name has keyboard focus and the row is neither hovered nor active, the `--border` chip
    stands out on the plain background. That is the right cue.
  - Disabled buttons get `opacity: 0.5` app-wide (`styles.css`). While the app is busy, that would let the letters show
    through the chip, so the disabled chip keeps full opacity and uses a muted color instead.
  - `--border` and `--accent-soft` are opaque in both themes (`styles.css`).
- **Evidence:** `src/ui/styles.css` (theme variables, `button:disabled`); `file-tree.css` hover and active rules;
  user-experience-designer UX-001, UX-002.
- **Behavior impact:** Changing. When someone hovers a long name, the "…" chip covers about 24px of the name at the
  visible edge. This includes the "(unsaved)" marker when it sits at that edge. Delegated: this is how "floats above
  the name" reads.
- **Rejected alternatives:**
  - No background. Rejected because the dots and letters would overlap.
  - `var(--bg)`, the color the tree is drawn on. This was the first draft. Rejected because it leaves a lighter hole in
    the row's highlight in nearly every state where "…" shows (UX-001).
  - A larger chip (`padding: 3px 6px`) for a bigger target. Rejected for this change because the size is the same as
    today and nobody asked for it. See Open Items.
- **Revisit criterion:** The browser check or the user finds the chip jarring.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Open Items

### D-9: The open row's wrapper is raised above the rows below it

- **Question:** Does a later row's "…" paint over an earlier row's open menu?
- **Decision:** Yes, without a fix: each sticky wrapper is its own painting layer, and later rows paint over earlier
  ones. The wrapper whose menu is open gets `z-index: 1`:
  ```css
  .files .row > .row-actions:has(> button.more[aria-expanded="true"]) { z-index: 1; }
  ```
- **Rationale:** Without it, hovering the next row while a menu is open shows that row's "…" over a menu item, and it
  takes the click.
- **Evidence:** software-architect proposal; C-5 (`.menu` has `z-index: 10`, but only within the wrapper's layer).
- **Behavior impact:** Preserving. Today's open menu paints above the rows below it, and this keeps that.
- **Rejected alternatives:**
  - Raise every wrapper. Rejected because the open one is the only one that needs to win.
- **Revisit criterion:** None expected.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

### D-10: The row becomes a two-line grid, and the name and the wrapper share the first line

- **Question:** How does the wrapper overlay the name while staying in normal layout, as sticky positioning requires?
- **Decision:** `.files .row { display: grid; }` replaces `position: relative`. `button.name` and `.row-actions` both take
  `grid-area: 1 / 1`, and the child `ul` takes `grid-area: 2 / 1`. The wrapper is `justify-self: end`,
  `align-self: start`, and `display: flex`, so it is exactly the button's size.
- **Rationale:**
  - A sticky element must stay in normal layout, so it cannot be absolutely positioned.
  - Sharing a grid cell lets it overlay the name without taking width.
  - Its sliding room is its grid area, which spans the full row width.
  - `position: relative` existed only to anchor "…" and the menu (C-1, C-5).
- **Evidence:** C-1, C-2, C-5, C-10.
- **Behavior impact:** Preserving. Row height, indentation, the name's full-width hover area, and the tree's width are
  unchanged. The wrapper adds no width, because it shares the name's cell and is no wider than the name.
- **Rejected alternatives:**
  - A flex row with a negative margin on the wrapper. Rejected because it ties the wrapper to a hard-coded width.
  - Float with sticky. Rejected because browser behavior for a sticky float is less predictable.
- **Revisit criterion:** The browser check shows the row height or indentation changing.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** D-7
- **Referenced in plan:** Target State, Surface Delta

# Change Plan: Actions Button Pinned to the Panel Edge

## Why This Change

The "…" button on each Documents panel row should stay at the panel's visible right edge. Today, when a file or folder
name is wider than the panel, "…" sits past that edge, so you have to scroll sideways to reach Rename, Move, or Delete.
The menu that opens from "…" has the same problem. The user reports this friction directly, with a screenshot of long
folder names cut off at the panel's edge. In their words, "…" should float "above the actual file / folder name" with
its "right edge anchored to the visible right edge of the documents panel". The scope turn confirmed that the menu
should open there too.

## What Changes, In One Paragraph

After this change, each row's "…" button and its menu live together in a small wrapper, held 2px inside the panel's
visible right edge and drawn over the name. Long names still scroll sideways exactly as they do now; only "…" and its
menu stop scrolling out of reach. Every row is as wide as the widest name. So once any name overflows the panel, every
row's "…" shows at the visible edge, short names included. When the whole tree fits the panel, "…" sits where it does
today. "…" still appears only on hover or focus, and its menu opens right under it.

## Current State

"…" is pinned to the wrong edge. It is absolutely positioned 2px from the right of its row. Every row is as wide as
the widest name, so the row's right edge is the far end of the scrolled content, not the panel's visible edge
([C-1](artifacts/current-state-findings.md#c-1-the--button-and-its-menu-are-anchored-to-the-row-which-is-as-wide-as-the-scrolled-content)).
The scrolling element is the panel itself, `aside.files`, which has 10px of padding inside the scrolled area
([C-3](artifacts/current-state-findings.md#c-3-the-documents-panels-scroll-container-is-asidefiles)).

The menu has the same anchor. The shared `Menu` opens below and right-aligned to its nearest positioned ancestor. In a
row that ancestor is the `li`, so the menu also lands at the far end. An expanded folder's `li` holds every row inside
it, so a folder's menu opens below all of its children rather than under the folder
([C-5](artifacts/current-state-findings.md#c-5-the-shared-menu-opens-below-and-right-aligned-to-its-nearest-positioned-ancestor-and-an-open-folders-menu-lands-below-the-whole-folder)).

Three things constrain the fix:

- **Show-on-hover selectors.** These reach "…" as a direct child of the row. Any wrapper breaks all five of them
  ([C-4](artifacts/current-state-findings.md#c-4-show-on-hover-and-the-name-highlight-depend-on--being-a-direct-child-of-the-row)).
- **Drag and drop.** These are wired on the `li`, and tests find a row through `closest('li')`
  ([C-8](artifacts/current-state-findings.md#c-8-drag-and-drop-live-on-the-li-and-tests-find-a-row-by-the-nearest-li)).
- **Tests.** Tests reach "…" and the menu by role and name only. They can check declared CSS values, including
  `position: sticky`, grid placement, and `:has()` rules, but cannot lay out the page or simulate hover
  ([C-9](artifacts/current-state-findings.md#c-9-tests-query-by-role-and-name-css-is-checked-only-as-declared-values-and-nothing-nests-a-button-in-a-button),
  [C-10](artifacts/current-state-findings.md#c-10-happy-dom-reports-position-sticky-right-and-grid-placement-through-getcomputedstyle),
  [C-11](artifacts/current-state-findings.md#c-11-happy-dom-evaluates-has-with-is-inside-it-but-a-style-read-before-an-attribute-change-does-not-update-after-it)).

## Target State

### What does the work

The pinning is done in the stylesheet with sticky positioning, with no script
([D-1](artifacts/change-decision-log.md#d-1-pin-with-css-sticky-positioning-on-a-wrapper-not-with-script-or-other-css)).
Sticky positioning is a CSS mode where an element sits in normal layout until scrolling would carry it past an edge.
The browser then holds it at that edge. All changes land in two files: `file-tree.tsx` (one wrapper element in `row`)
and `file-tree.css`.

### Each part's job

- **`li.row`.** It still owns drag, drop, its CSS state classes, and being the row tests find with `closest('li')`. It
  becomes a two-line grid: the name line, then the child `ul` for an open folder. It no longer anchors anything, so it
  drops `position: relative`
  ([D-10](artifacts/change-decision-log.md#d-10-the-row-becomes-a-two-line-grid-and-the-name-and-the-wrapper-share-the-first-line)).
- **`div.row-actions` (new).** It owns pinning to the visible edge, show-on-hover, and anchoring the menu. It holds
  `button.more` and, while open, the row's `Menu`. It sits where they sit today, as the `li`'s first child, and renders
  only for on-disk rows. The class is `row-actions` because `file-tree.css` already uses `.actions` for the dialogs'
  button bar
  ([D-2](artifacts/change-decision-log.md#d-2-the-wrapper-is-a-divrow-actions-holding--and-the-rows-menu-on-disk-rows-only)).
- **`button.more`.** It is a click target and a readable chip, nothing more. It loses its own positioning and
  visibility rules. It gains an opaque background in the row's highlight color, so it merges with the highlight
  instead of punching a hole in it
  ([D-8](artifacts/change-decision-log.md#d-8--gets-an-opaque-background-that-matches-the-rows-highlight-so-it-reads-clearly-over-the-name)).
- **`Menu` and `menu.css`.** Unchanged. Their existing "below, right edges aligned" now resolves against the wrapper
  ([D-5](artifacts/change-decision-log.md#d-5-the-shared-menu-component-and-its-stylesheet-stay-unchanged)).

### Pinned contract between `row`'s markup and `file-tree.css`

The class name `row-actions`, the grid placement, and the selector shapes below are the contract. Each rule gets a
plain-language comment, as the file's rules do today.

```css
.files .row                         { display: grid; }       /* replaces position: relative */
.files .row > button.name,
.files .row > .row-actions          { grid-area: 1 / 1; }    /* share the name line */
.files .row > ul                    { grid-area: 2 / 1; }    /* an open folder's rows go below it */
.files .row > .row-actions          { position: sticky; right: -8px; margin: 2px 2px 0 0;
                                      justify-self: end; align-self: start; display: flex; visibility: hidden; }
.files .row > .row-actions:has(> button.more:is(:hover, :focus-visible, [aria-expanded="true"])),
.files .row:has(> button.name:is(:hover, :focus-visible)) > .row-actions { visibility: visible; }
.files .row > .row-actions:has(> button.more[aria-expanded="true"]) { z-index: 1; }
.files .row:has(> .row-actions > button.more:hover) > button.name    { background: var(--border); }
.files .row > .row-actions > button.more { border: none; background: var(--border); border-radius: 4px; padding: 1px 6px; line-height: 18px; }
.files .row.active > .row-actions > button.more { background: var(--accent-soft); }
.files .row > .row-actions > button.more:disabled { opacity: 1; color: var(--muted); }
```

```tsx
// row(): the wrapper replaces today's two sibling conditionals, in the same position before button.name.
{node.onDisk && (
  <div className="row-actions">
    <button className="more" ...unchanged props...>…</button>
    {menu?.at === node.path && <Menu ...unchanged props... />}
  </div>
)}
```

The values that have to agree are listed below.

- **The 2px inset.** `right: -8px` holds "…" 2px inside the visible edge whenever the row runs past it. The browser
  measures it from inside the panel's 10px padding, which a Chrome measurement during the build confirmed. The 2px
  right margin keeps "…" 2px inside the row's end when the tree fits the panel, as today
  ([D-7](artifacts/change-decision-log.md#d-7-the-pin-inset-is-right--8px-because-the-browser-measures-it-from-inside-the-panels-padding)).
- **The top margin.** `margin-top: 2px` replaces today's `top: 2px`.
- **The hidden wrapper.** The hidden state is on the wrapper rather than the button, so the pointer passes through a
  hidden "…" to the name, as it does today
  ([D-3](artifacts/change-decision-log.md#d-3-show-on-hover-moves-from-the-button-to-the-wrapper-keeping-todays-triggers)).
- **The open menu's layer.** The open row's wrapper is raised, so a later row's "…" cannot paint over its menu
  ([D-9](artifacts/change-decision-log.md#d-9-the-open-rows-wrapper-is-raised-above-the-rows-below-it)).

### What stays the same

- **Keyboard order.** "…" stays before the name in the DOM, so a focused name still reaches it with Shift+Tab
  ([D-11](artifacts/change-decision-log.md#trivial-decisions)).
- **The "+" button.** The "+" button and its menu are untouched
  ([D-12](artifacts/change-decision-log.md#trivial-decisions)).

## Surface Delta

### S-1: `div.row-actions` (row actions wrapper) — Added

**Target state.** Every on-disk row's `li` has a first child `<div className="row-actions">`. It holds that row's
`button.more` and, while its menu is open, that row's `Menu`. The wrapper is sticky against `aside.files` with
`right: -8px`, so it stays 2px inside the panel's visible right edge whenever the row runs past it. It is hidden unless
one of the five show-on-hover triggers applies. While its menu is open, it is raised above later rows.

**Behavior.** Changing. When the tree is wider than the panel, "…" appears at the panel's visible right edge on hover
instead of past it. This is the requested outcome. Delegated per the user's standing preference.

**Why.** It is the one element that can both pin to the visible edge and anchor the menu beside "…" (C-1, C-5).

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-pin-with-css-sticky-positioning-on-a-wrapper-not-with-script-or-other-css),
[D-2](artifacts/change-decision-log.md#d-2-the-wrapper-is-a-divrow-actions-holding--and-the-rows-menu-on-disk-rows-only),
[D-3](artifacts/change-decision-log.md#d-3-show-on-hover-moves-from-the-button-to-the-wrapper-keeping-todays-triggers),
[D-7](artifacts/change-decision-log.md#d-7-the-pin-inset-is-right--8px-because-the-browser-measures-it-from-inside-the-panels-padding),
[D-9](artifacts/change-decision-log.md#d-9-the-open-rows-wrapper-is-raised-above-the-rows-below-it)

### S-2: `button.more` — Re-scoped

**Target state.** `button.more` is a click target with rounded corners and an opaque background: `--border`, or
`--accent-soft` on the active row. When disabled, it keeps full opacity and uses a muted color. It does not position
itself or control its own visibility; the wrapper does both. Its props (`aria-label`, `aria-haspopup`,
`aria-expanded`, `disabled`, `onClick`) and the `opener` it hands the menu are unchanged.

**Behavior.** Changing. While "…" shows over a long name, the chip covers about 24px of the name at the visible edge.
That is what "floats above the name" means. Delegated.

**Why.** Pinned, "…" sits over the middle of whatever long name is in view, so it needs a background to stay readable.

**Depends on.** S-1.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-show-on-hover-moves-from-the-button-to-the-wrapper-keeping-todays-triggers),
[D-8](artifacts/change-decision-log.md#d-8--gets-an-opaque-background-that-matches-the-rows-highlight-so-it-reads-clearly-over-the-name)

### S-3: `li.row` layout — Re-scoped

**Target state.** `li.row` is a grid. Its name button and its actions wrapper share the first line, and an open
folder's child `ul` sits on the second. It is no longer a positioning anchor. Drag, drop, its classes, and its
`draggable` attribute are unchanged.

**Behavior.** Preserving. Row height, indentation, the name's full-width hover area, and the tree's width are as they
are today. The wrapper shares the name's grid cell, so it adds no width. Only the browser check can confirm this, by
comparing the tree before and after.

**Why.** A sticky element has to stay in normal layout, so it cannot be absolutely positioned over the name. Sharing a
grid cell lets it overlay the name.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-the-row-becomes-a-two-line-grid-and-the-name-and-the-wrapper-share-the-first-line)

### S-4: Where a row's menu opens — Re-scoped

**Target state.** A row's menu opens directly under that row's "…", with right edges aligned. That holds for files,
collapsed folders, and expanded folders alike, and at any sideways scroll position.

**Behavior.** Changing. An expanded folder's menu used to open below all of its children. It now opens under the
folder's own line. Every other row's menu starts a few pixels higher than today, at the bottom of the "…" chip rather
than the bottom of the row. Delegated.

**Why.** The user confirmed that the menu should open beside the pinned "…" (scope-boundary.md, Operator-Stated
Scope).

**Depends on.** S-1.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-an-open-folders-menu-opens-under-the-folders-own-line),
[D-5](artifacts/change-decision-log.md#d-5-the-shared-menu-component-and-its-stylesheet-stay-unchanged)

## Behavior Changes

Five things look different after this change. The user delegated these decisions, so the run settled them and reports
them here.

1. **"…" stays in view for long names (S-1).** Hover a folder named `accelerate-understanding-of-…` that runs past the
   panel. Today, "…" is off-screen to the right. After the change it shows 2px inside the panel's right edge, over the
   name. This is the requested change.
2. **Short rows also show "…" at the visible edge when the tree overflows (S-1).** Every row is as wide as the widest
   name. Once one name runs past the panel, hovering a short name like `docs` shows its "…" at the panel's edge too,
   not right after the word. When the whole tree fits, nothing changes.
3. **"…" covers part of a long name while it shows (S-2).** The chip hides about 24px of the name at the edge while you
   hover or focus that row. That can include the "(unsaved)" marker when it sits at the edge. It disappears again when
   the pointer leaves.
4. **Menus open closer to "…" (S-4).** Open "…" on an expanded folder that holds three files. Today the menu appears
   below the third file. After the change it appears right under the folder's name. Every other row's menu starts a few
   pixels higher than today.
5. **The panel no longer jumps sideways for keyboard users.** Pressing Shift+Tab from a long name to its "…", or
   opening the menu, used to scroll the panel to its far end, because "…" and the menu lived there. Both are now
   already in view, so the panel stays put
   ([D-11](artifacts/change-decision-log.md#trivial-decisions)).

## Change Units

The change is one unit
([D-13](artifacts/change-decision-log.md#trivial-decisions)). A first step that only wrapped "…" would re-anchor the
menu without fixing the reported problem, and that step's one browser check is covered here.

### Unit 1: Pin "…" and its menu to the panel's visible edge

**What it does.** Wraps "…" and the row's menu in `div.row-actions` and moves show-on-hover onto the wrapper. It turns
the row into the two-line grid, makes the wrapper sticky, and gives "…" its chip background. Everything follows the
pinned contract in Target State.

**Delta entries.** S-1, S-2, S-3, S-4.

**How you know it worked.**

1. **Existing tests pass unchanged.** This covers `file-tree.test.tsx` and `app.test.tsx`, including:
   - the no-nested-buttons test;
   - the `closest('li')` drag tests;
   - the no-actions-for-AI-posts test;
   - the menu open, close, and focus tests;
   - the three `addTreeStyles` tests.

   Run those three right after the CSS lands. They load the stylesheet, so a selector happy-dom rejects shows up
   there first.
2. **Three new tests pass**
   ([D-6](artifacts/change-decision-log.md#d-6-tests-pin-the-declared-css-values-through-the-real-dom-and-a-browser-check-confirms-the-geometry)).
   - **The wrapper.** On an expanded folder with its menu open, the wrapper is found as the "…" button's parent and
     never by class. It contains the open menu, is not a button, and its `closest('li')` is the folder's own `li`. It
     is `position: sticky` with `right: -8px`, `marginRight: 2px`, and `gridArea` `1 / 1`.
   - **The row's grid.** The row is `display: grid`. The name has `gridArea` `1 / 1`, and an open folder's child `ul`
     has `gridArea` `2 / 1`.
   - **The open-menu rules.** After clicking "…", read the wrapper's style for the first time: `visibility: visible` and
     `zIndex: 1`. A closed row's wrapper is `visibility: hidden`. Read the style only after the click, because
     happy-dom does not update a style it has already computed when an attribute changes.
3. **A check by hand in a browser passes.** Run `bun run server` and check each of these:
   - **Pinning.** "…" sits 2px inside the visible edge at left, middle, and right scroll positions. It is not 0px, 4px,
     or 12px in.
   - **When the tree fits.** "…" sits as it does today.
   - **Depth and width.** Pinning holds at three levels of nesting, and at the 120px and 600px column widths.
   - **Vertical scroll.** "…" scrolls up and down with its row.
   - **Row layout.** Row height, nested indentation, and the name's hover width match a screenshot taken before the
     change.
   - **Show-on-hover.** Each of the five triggers shows "…":
     - hovering the name;
     - Tab focus on the name;
     - hovering "…";
     - keyboard focus on "…";
     - an open menu.

     A child row's hover does not show its parent folder's "…". Hovering "…" highlights the name.
   - **No dead spot.** With "…" hidden, a click at a short row's right end opens the file.
   - **Menus.**
     - A menu opens under its own "…" for a file, a collapsed folder, and an expanded folder, including while the tree
       is scrolled.
     - A menu item can be clicked while the wrapper is pinned.
     - With a menu open, hovering the next row does not paint its "…" over the menu.
   - **Keyboard.**
     - Shift+Tab from a long name reaches "…" with its focus ring unclipped, and the panel does not jump sideways.
     - Enter opens the menu, and Escape closes it.
   - **Edge clicks.** With the panel scrolling vertically, a click on the right edge of "…" opens the menu and does not
     start a column resize.
   - **Chip.**
     - The chip blends with the hover highlight and the active row's highlight, in light and dark themes.
     - It stays opaque while the app is busy.
     - A drag started on "…" moves the row.
   - **Untouched rows and menus.** AI-written, not-yet-saved rows show no "…". The "+" menu and the Agent Actions menu
     look as before.

## Risks

- **The sticky offset differs in another browser.** Chrome measures the inset from inside the panel padding, as
  confirmed during the build ([C-12](artifacts/current-state-findings.md#c-12-chrome-measures-a-sticky-right-from-inside-the-scroll-containers-padding)).
  A browser that measured from the padding edge instead would put "…" 8px past the visible edge, clipped. A look in
  that browser detects this.
- **"…" sits beside the column resize handle.** In Chrome, "…" takes clicks up to its last pixel and the handle starts
  1px to its right (C-12). A 2px overshoot starts a resize instead of opening the menu. If that proves a problem in
  use, a smaller `right` value moves "…" further in.
- **Show-on-hover could break silently.** No test can simulate hover, so a wrong selector would leave "…" never showing,
  or showing on every row. The five-trigger browser check detects this.
- **The grid could shift row spacing.** Switching `li.row` to a grid could change line height or the name button's
  width. The before-and-after comparison in the browser detects this.

The change reaches the Documents tree only. `Menu`, `menu.css`, the "+" menu, and the Agent Actions menu are not
touched.

## Deferred (YAGNI)

- **A script-based positioning hook.** Reopen if sticky positioning proves unreliable in the browser 3pitor runs in
  ([D-1](artifacts/change-decision-log.md#d-1-pin-with-css-sticky-positioning-on-a-wrapper-not-with-script-or-other-css)).
- **CSS anchor positioning.** Reopen when a second caller needs a menu anchored to something other than its parent.
- **A row-scoped `.menu` override in `file-tree.css`.** Reopen if the default "below, right-aligned" placement looks
  wrong under the pinned "…"
  ([D-5](artifacts/change-decision-log.md#d-5-the-shared-menu-component-and-its-stylesheet-stay-unchanged)).
- **A browser-driven layout test runner.** Reopen if a second layout bug in the tree slips past declared-value tests
  ([D-6](artifacts/change-decision-log.md#d-6-tests-pin-the-declared-css-values-through-the-real-dom-and-a-browser-check-confirms-the-geometry)).
- **A happy-dom test that a drag started on "…" reaches the row.** Reopen if a drag-from-"…" bug is reported. The
  wrapper test's `closest('li')` assertion already pins the containment.

## Cut for Scope

These problems exist today and come from show-on-hover, which the scope turn kept as it is (scope-boundary.md,
Operator-Stated Scope: "the show-on-hover behavior of "…" is kept")
([D-14](artifacts/change-decision-log.md#trivial-decisions)). The user can reinstate either one.

- **Forward Tab skips every "…".** A hidden "…" cannot take focus until its name is focused. So Tab moves from name to
  name, and screen reader users browsing without focus never find the actions.
- **Touch screens never show "…".** There is no hover on touch, so the actions are unreachable there.

## Open Items

- **Non-blocking: Escape does not return focus to "…".** After closing a menu with Escape or choosing an item, focus
  drops to the page. This is true today and is unrelated to pinning. Settled by a separate change if the user wants it
  ([D-14](artifacts/change-decision-log.md#trivial-decisions)).
- **Non-blocking: "…" is smaller than the recommended minimum target size.** At about 26×20px it is under the 24×24px
  target in WCAG (the web accessibility guidelines), and its new background makes that visible. The size is the same as
  today. A taller chip (`padding: 3px 6px`) would fix it, if the browser check shows the row height holds
  ([D-8](artifacts/change-decision-log.md#d-8--gets-an-opaque-background-that-matches-the-rows-highlight-so-it-reads-clearly-over-the-name)).
- **Non-blocking: the menu is clipped in a very narrow panel.** At the 120px column width, the 140px menu runs past the
  panel's left edge. That happens today too, and this change does not make it worse.
- **Non-blocking: which browser 3pitor runs in.** With overlay scrollbars (macOS default), a vertical scrollbar may sit
  over the right half of "…". The edge-click browser check settles it on the user's machine.

## Review Findings

One review round ran, at the medium size. The team was `han-core:junior-developer`,
`han-core:user-experience-designer`, and `han-core:test-engineer`. Every finding was settled in this round, and none
was blocking. The decision log records each outcome.

- **Junior developer.** The plan described pinning per name, but rows are as wide as the tree, so pinning happens across
  the whole tree (reworded; Behavior Change 2). It also asked for:
  - the 4px failure mode in Risks (D-7);
  - the keyboard no-jump gain (Behavior Change 5);
  - tests for the margin and grid placement (D-6);
  - the `row-actions` class name (D-2);
  - one change unit instead of two (D-13).

  The new wrapper passed its YAGNI check.
- **UX designer.** Its findings changed these parts of the plan:
  - The first draft's `--bg` chip punched a hole in the row highlight, so the chip now matches it (D-8).
  - The busy-state chip went translucent, and it now keeps full opacity (D-8).
  - The browser check gained the resize-handle edge click (D-7) and the keyboard path.
  - Every menu's few-pixel shift is now recorded (D-4).
  - The "(unsaved)" overlap is now named under Behavior Changes.

  Target size, Escape focus return, Tab skipping, and touch are existing gaps. They were moved to Open Items and Cut
  for Scope. Findings about rendering are **Unverified**, because nothing was rendered in a browser.
- **Test engineer.** It reshaped the tests around finding the wrapper from the button, and added the grid-placement
  and open-menu tests (D-6). It also expanded the browser checklist. It raised one unverified concern: whether happy-dom
  handles `:is()` inside `:has()`. This run checked that with a spike. happy-dom does handle it, and the spike also
  turned up the read-after-click requirement (C-11).
- **Build-time browser check.** The Chrome check during the build showed that `right: 2px` held "…" 12px from the
  visible edge, not 2px, because Chrome measures the inset from inside the panel's padding. D-7 now uses `right: -8px`
  ([C-12](artifacts/current-state-findings.md#c-12-chrome-measures-a-sticky-right-from-inside-the-scroll-containers-padding)).
  The same check confirmed the following:
  - the row height is unchanged;
  - the menu opens directly under "…", including on an expanded folder;
  - the open wrapper is raised;
  - a hidden "…" lets clicks through;
  - "…" does not overlap the resize handle.

  Still unchecked: other browsers, the light theme, dragging from "…", and the keyboard path.

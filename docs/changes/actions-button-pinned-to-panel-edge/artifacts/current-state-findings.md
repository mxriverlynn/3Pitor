# Current State Findings: Actions Button Pinned to the Panel Edge

## Provenance

Produced by this run's own discovery round on 2026-10-01. No prior report existed.

- `han-core:structural-analyst`: row DOM shape, positioning chain, selectors, shared `.menu` users, test selectors.
- `han-core:behavioral-analyst`: show-on-hover, menu open/close/focus, outside press, drag and drop, test coverage.
- `han-core:concurrency-analyst` was not dispatched. The area is render markup and CSS, with no shared mutable state or
  async coordination.

The area given to both was `src/ui/documents/file-tree/` and `src/ui/components/menu/`, plus the CSS that sets up the
Documents panel's scroll container. Every finding was read from source. Nobody rendered the page in a browser, so every
claim about layout is read from the CSS rather than observed.

## Project Context

- **Stack:** Bun, React 19, TypeScript. UI tests run with `bun test` against happy-dom (`Makefile`,
  `src/ui/test-setup.ts`).
- **Conventions source:** none found. No `CLAUDE.md`, `AGENTS.md`, or `project-discovery.md`. Conventions were read from
  the code: one stylesheet per component, imported by its `.tsx`. CSS rules carry plain-language comments. Shared
  components are restyled per caller through descendant overrides (`.agent-actions .menu`).
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** `git log --since="90 days ago"` over the area shows a run of changes to the same rows. These include
  `6631ec5` (keep each name on one line), `b6de90a` (widen the tree to its widest row so the section scrolls sideways),
  `c25cc71` (resizable Documents column), and `dceed01` (menu moved into the shared component). The horizontal scroll
  this change works around is about one day old. Its earlier plans live in `docs/changes/folder-tree-navigation/`.

## Gaps

- No ADRs, coding standards, or project-discovery file.
- No test covers the "…" button's visibility, its position, the name highlight while hovering it, or where the menu
  opens.
- The test environment cannot lay out a page, so pinning can only be checked by declared CSS values or by hand in a
  browser.

## Findings

### C-1: The "…" button and its menu are anchored to the row, which is as wide as the scrolled content

- **Claim:** "…" is absolutely positioned 2px from the right edge of its `li.row`. Every row is as wide as the tree, and
  the tree is as wide as its widest name. So "…" sits at the far edge of the scrollable content, not at the visible
  edge of the panel.
- **Location:** `src/ui/documents/file-tree/file-tree.css`, lines 8–12
- **Evidence:**
  ```css
  .files .tree { width: max-content; min-width: 100%; }
  .files .row { position: relative; }
  .files .row > button.more { position: absolute; right: 2px; top: 2px; visibility: hidden; border: none; background: none; padding: 1px 6px; line-height: 18px; }
  ```
- **Raised by:** structural-analyst S2, behavioral-analyst B2
- **Confidence:** Verified (the CSS was read, and the user's screenshot matches). The actual browser layout was not
  rendered.
- **Bears on:** S-1, S-2, D-1

### C-2: Row DOM order puts "…" and the menu before the name, all as direct children of the `li`

- **Claim:** A row is `li.row` > [`button.more` (on-disk items only)] > [`Menu` when open] > `button.name` > [child `ul`
  when an open folder].
- **Location:** `src/ui/documents/file-tree/file-tree.tsx`, `row` (around lines 247–286)
- **Evidence:**
  ```tsx
  {node.onDisk && (
    <button className="more" aria-label={`Actions for ${node.path}`} aria-haspopup="menu" aria-expanded={menu?.at === node.path} disabled={busy}
      onClick={(e) => setMenu(menu?.at === node.path ? undefined : { at: node.path, opener: e.currentTarget })}>
      …
    </button>
  )}
  {menu?.at === node.path && <Menu items={actions(node)} opener={menu.opener} onClose={closeMenu} />}
  <button className="name" ...>
  {isFolder && isOpen && <ul>{node.children.map(row)}</ul>}
  ```
- **Raised by:** structural-analyst S1, behavioral-analyst B5
- **Confidence:** Verified
- **Bears on:** S-1, D-2

### C-3: The Documents panel's scroll container is `aside.files`

- **Claim:** `aside.files` scrolls on both axes and is not positioned. Its width is the resizable grid column
  `--tree-width` (default 170px, 120–600px). Its 10px padding sits inside the scrolled area.
- **Location:** `src/ui/documents/file-tree/file-tree.css` line 1; `src/ui/styles.css` `.main`; `src/ui/app.tsx` around
  lines 30 and 114–116
- **Evidence:**
  ```css
  .files { padding: 10px; overflow: auto; }
  ```
- **Raised by:** structural-analyst S3
- **Confidence:** Verified
- **Bears on:** D-1

### C-4: Show-on-hover and the name highlight depend on "…" being a direct child of the row

- **Claim:** Five selectors reach "…" through `.row > button.more` or `.row:has(> button.more…)`. The child combinator
  is deliberate: a folder's `li` also holds its children's rows. Wrapping "…" in a new element stops every one of these
  selectors from matching.
- **Location:** `src/ui/documents/file-tree/file-tree.css`, lines 12–16
- **Evidence:**
  ```css
  /* Only the row's own buttons count: a folder's <li> also holds the rows inside it. */
  .files .row > button.more:hover, .files .row > button.more:focus-visible, .files .row > button.more[aria-expanded="true"],
  .files .row:has(> button.name:hover) > button.more, .files .row:has(> button.name:focus-visible) > button.more { visibility: visible; }
  .files .row:has(> button.more:hover) > button.name { background: var(--border); }
  ```
- **Raised by:** structural-analyst S4, behavioral-analyst B3, B4
- **Confidence:** Verified
- **Bears on:** S-2, D-3

### C-5: The shared menu opens below and right-aligned to its nearest positioned ancestor, and an open folder's menu lands below the whole folder

- **Claim:** `.menu` is `position: absolute; right: 0; top: 100%`, with no positioning of its own in `Menu`. In a row
  the ancestor is `li.row`. An expanded folder's `li` includes its children's rows, so its menu opens below every row
  inside the folder rather than under the folder's own line. The behavioral analyst noted that this quirk exists today
  but reported it from the CSS rather than observing it.
- **Location:** `src/ui/components/menu/menu.css` line 1; `src/ui/components/menu/menu.tsx` `Menu`
- **Evidence:**
  ```css
  .menu { position: absolute; z-index: 10; right: 0; top: 100%; display: flex; flex-direction: column; min-width: 140px; ... }
  ```
- **Raised by:** structural-analyst S5, behavioral-analyst B5
- **Confidence:** Verified from CSS. The folder case was not rendered.
- **Bears on:** S-1, S-3, D-2, D-4

### C-6: Three places use `.menu`, and the existing convention is a caller-scoped override

- **Claim:** The row menu, the "+" menu (anchored to `.files-head { position: relative }`), and the Agent Actions menu
  all use `.menu`. Agent Actions moves its menu with descendant overrides rather than by editing `menu.css`.
- **Location:** `src/ui/components/agent-actions/agent-actions.css` lines 2–3; `src/ui/chat/chat/chat.css` line 21;
  `src/ui/documents/file-tree/file-tree.css` line 2
- **Evidence:**
  ```css
  .agent-actions { position: relative; }
  .agent-actions .menu { right: auto; left: 0; min-width: 180px; }
  .composer .agent-actions .menu { top: auto; bottom: calc(100% + 4px); }
  ```
- **Raised by:** structural-analyst S6, behavioral-analyst B9
- **Confidence:** Verified
- **Bears on:** D-5

### C-7: Menu open/close does not depend on where "…" or the menu sit in the DOM

- **Claim:** `opener` is the clicked button (`e.currentTarget`) and is used only to exclude it from the outside-press
  close. The menu focuses its first item on mount and closes on Escape. `Menu` does not measure the opener.
- **Location:** `src/ui/components/menu/menu.tsx` `Menu`
- **Evidence:**
  ```tsx
  if (!menu.current?.contains(target) && !opener.contains(target)) onClose();
  ...
  useEffect(() => menu.current?.querySelector('button')?.focus(), []);
  ```
- **Raised by:** structural-analyst S6, behavioral-analyst B5, B6
- **Confidence:** Verified
- **Bears on:** D-2

### C-8: Drag and drop live on the `li`, and tests find a row by the nearest `li`

- **Claim:** The `li` is the draggable and the drop target. "…" must stay a descendant of the `li` for a drag started on
  it to drag the row. Tests find a row with `getByRole('button', { name }).closest('li')`, so any new wrapper must not
  be an `li`.
- **Location:** `src/ui/documents/file-tree/file-tree.tsx` `row`; `src/ui/documents/file-tree/file-tree.test.tsx`
  `rowOf`
- **Evidence:**
  ```tsx
  const rowOf = (name: string) => screen.getByRole('button', { name }).closest('li')!;
  ```
- **Raised by:** behavioral-analyst B7, B8; structural-analyst S7
- **Confidence:** Verified. In-browser drag from a button was not exercised.
- **Bears on:** D-2

### C-9: Tests query by role and name. CSS is checked only as declared values, and nothing nests a button in a button

- **Claim:** Tests reach "…" as `getByRole('button', { name: 'Actions for X' })` and reach the menu by role. None of
  them use a class or a sibling relation. CSS tests inject `file-tree.css` and read `getComputedStyle` values (precedent:
  `whiteSpace`, `width`, `minWidth`, `overflow`). One test asserts there is no `button button`.
- **Location:** `src/ui/documents/file-tree/file-tree.test.tsx` (`addTreeStyles`, around lines 182, 575, 585);
  `src/ui/app.test.tsx` around lines 264–271
- **Evidence:**
  ```tsx
  expect([tree.width, tree.minWidth]).toEqual(['max-content', '100%']);
  expect(section.overflow).toBe('auto');
  expect(view.container.querySelectorAll('button button')).toHaveLength(0);
  ```
- **Raised by:** structural-analyst S7, behavioral-analyst B1, B8
- **Confidence:** Verified. Whether happy-dom resolves `position: sticky` through `getComputedStyle` was not checked.
- **Bears on:** Unit 1 verification, D-6, C-10

### C-10: happy-dom reports `position: sticky`, `right`, and grid placement through `getComputedStyle`

- **Claim:** A throwaway spike in this run injected a stylesheet using `position: sticky; right: 2px`, `display: grid`,
  `grid-template-columns: minmax(0,1fr)`, `grid-area: 1 / 1`, and `justify-self: end`. happy-dom returned each declared
  value from `getComputedStyle`. A declared-value test in the existing `addTreeStyles` style can therefore pin the
  pinning rule. Like every test here, it cannot observe geometry.
- **Location:** spike file `src/ui/__spike/sticky.test.tsx`, run with `bun test --preload ./src/ui/test-setup.ts` and
  deleted afterwards
- **Evidence:**
  ```
  {"position":"sticky","right":"2px","gridArea":"1 / 1","justifySelf":"end","display":"grid","cols":"minmax(0,1fr)"}
  1 pass
  ```
- **Raised by:** this run's own sweep
- **Confidence:** Verified (the spike was run)
- **Bears on:** D-6, Unit 1 verification

### C-11: happy-dom evaluates `:has()` with `:is()` inside it, but a style read before an attribute change does not update after it

- **Claim:** Rules keyed on `:has(> button.more[aria-expanded="true"])` and on `:has(> button.more:is(:hover,
  [aria-expanded="true"]))` both applied (`zIndex` read as `"1"`) when the element already had `aria-expanded="true"`
  at its first style read. In a spike that read the wrapper's style first, then set `aria-expanded="true"` and read it
  again, the second read still showed the old values: `visibility` stayed `hidden` and `zIndex` stayed empty. A test of
  the open-menu rules must therefore read computed style only after the menu is open.
- **Location:** throwaway spike `src/ui/__spike/has.test.tsx`, run with `bun test --preload ./src/ui/test-setup.ts` and
  deleted afterwards
- **Evidence:**
  ```
  has-child-attr "1"
  has-desc-attr "1"
  has-is "1"
  attr-direct "1"
  --- read, then set aria-expanded="true", then read again:
  before hidden
  after hidden
  ```
- **Raised by:** this run's own sweep, prompted by the test-engineer's unverified `:is()`-inside-`:has()` concern
- **Confidence:** Verified (the spike was run). Why the second read is stale was not traced.
- **Bears on:** D-6

### C-12: Chrome measures a sticky `right` from inside the scroll container's padding

- **Claim:** This was measured during the build in Chrome, in the running app against a throwaway workspace. With
  `right: 2px` on the wrapper, every row's "…" sat 12px from `aside.files`'s visible right edge at every sideways scroll
  position: 10px of panel padding plus the 2px. With `right: -8px`, it sat 2px from the edge from 0% to 96% of the
  scroll, then eased to 12px at the far end, where it rests at its row's end. Row height stayed at 26.5px. The menu
  opened 0px below "…" with right edges aligned, and an expanded folder's menu opened above its first child row. The
  open wrapper's `z-index` was `1`. Hit-testing found "…" taking clicks up to its last pixel, with the column resize
  handle starting 1px to its right. A hidden "…" let clicks through to the name.
- **Location:** `src/ui/documents/file-tree/file-tree.css`, `.files .row > .row-actions`
- **Evidence:**
  ```
  right: 2px  -> gap to visible edge at scroll 0 / mid / end: 12 / 12 / 12.1
  right: -8px -> gap at scroll 0 / 25% / 50% / 90% / 96% / 100%: 2 / 2 / 2 / 2 / 2.1 / 12.1
  rowHeights: [26.5]
  menuTopMinusMoreBottom: 0, menuRightMinusMoreRight: 0, menuTopVsFirstChildTop: -4.5
  hits 1-3px inside "…"'s right edge: more; 1px past it: panel-resizer
  ```
- **Raised by:** this run's browser check, at build time
- **Confidence:** Verified in Chrome. Other browsers, light theme, and dragging from "…" were not checked.
- **Bears on:** D-7

## Findings No Agent Could Audit

- **Real browser layout.** Neither discovery agent rendered the page. The build's Chrome check (C-12) closed this for
  Chrome. Other browsers remain unchecked. Whether the pinned "…" and its menu land at the visible edge
  across scroll positions, panel widths, and nesting depths can only be confirmed in a browser. The command is
  `make` / `bun run server`, followed by a check by hand or with the Chrome tools.
- **happy-dom's evaluation of `:hover` and `:focus-visible` inside `:has()`** was not tested. `fireEvent` does not set
  hover state, so the show-on-hover selectors stay a browser check. `position: sticky` was checked (C-10).

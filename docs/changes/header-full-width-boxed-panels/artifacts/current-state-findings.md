# Current State Findings: Header Full Width, Boxed Panels

## Provenance

No prior report covered this area. This run's own discovery round produced these findings, on 2026-10-19:

- `han-core:structural-analyst` (its findings S-1 to S-10) and `han-core:behavioral-analyst` (B-1 to B-14), each
  briefed with the area below, the user's request, and the boundary record.
- `han-core:concurrency-analyst` was not dispatched: the area is page layout, with no shared mutable state or async
  coordination beyond what React already serializes.
- The run's own sweep, below.

Area: `src/ui/app.tsx`, `src/ui/styles.css`, the `Editor` component in `src/ui/documents/documents/documents.tsx`,
`src/ui/documents/post-panel/`, `src/ui/chat/agent-panel/`, `src/ui/chat/chat/chat.css`,
`src/ui/components/panel-resizer/`, `src/ui/documents/documents/post-table.css`, and their tests.

Both analysts read source only. Neither ran the app or the tests, and neither saw a rendered page.

## Project Context

- **Stack:** TypeScript, React 19, ProseMirror, plain CSS files imported per component, Bun's test runner with happy-dom
  and Testing Library (`package.json`).
- **Conventions source:** none found. There is no CLAUDE.md and no `project-discovery.md`. Conventions are read from the
  code: one CSS file beside each component, a comment above each CSS rule saying what the writer sees, and tests that
  query by role and accessible name where they can.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** `src/ui/app.tsx` changed in 41 commits and `src/ui/styles.css` in 17 over the last 90 days. The most
  recent were `7bde976` (hide the post panel and the chat on the landing page) and `9e11f5c` (keep the post panel on
  the landing page while it holds changes with nowhere to save), both of which set the three grid shapes in C-3.

## Gaps

- No ADR, coding standard, or CLAUDE.md describes the page layout or how CSS is organized.
- No visual regression or browser layout test exists. The test suite runs in happy-dom, which does no layout, so
  nothing automated checks where the header, the panels, or the gaps between them are drawn.

## Findings

### C-1: The header sits inside the editor's grid column

- **Claim:** The top bar (`.editor-bar`) is the first child of `Editor`'s `<section className="editor">`, which is one
  cell of `.main`'s grid. The bar therefore spans only the editor column. `.app` has a single row, so nothing sits above
  `.main`.
- **Location:** `src/ui/documents/documents/documents.tsx`, `Editor` return (~line 925); `src/ui/app.tsx`, `App` return;
  `src/ui/styles.css` (`.app`, `.main`).
- **Evidence:**
  ```tsx
  <section className="editor">
    <div className="editor-bar">
      <h1>3pitor</h1>
  ```
  ```css
  .app { display: grid; grid-template-rows: 1fr; height: 100%; }
  .main { display: grid; grid-template-columns: var(--tree-width) auto 1fr auto var(--agent-width); min-height: 0; }
  ```
- **Raised by:** structural-analyst S-1, behavioral-analyst B-1
- **Confidence:** Verified
- **Bears on:** S-1, S-2, D-1

### C-2: The header shares state, a ref, and handlers with the editor body

- **Claim:** The bar and the rest of `Editor` share state, so the bar cannot move to another component without carrying
  that state across:
  - `save` and `saveError`. The bar's Save button and the window-level Cmd/Ctrl-S listener both call `save`, and a
    failure shows as a notice in the body.
  - The `nameHeading` ref on the bar's `<h2 className="name">`. Four body paths focus it: the `focusName` effect after a
    post opens from the post table, Keep my version, dismissing the review strip, and confirming Undo all.
  - `wentHome`. The bar's Home button sets it, and the body's `PostTable` reads it as `focusSearch`.
  - `focusName`. The body's `PostTable` sets it through `onOpened`, and an effect then focuses the bar's heading.
  - `ViewSwitch`. Its `aria-describedby="read-only-notice"` points at a notice in the body.
  - Every focus call is `nameHeading.current?.focus()`. If the ref is not attached, focus silently goes nowhere.
- **Location:** `src/ui/documents/documents/documents.tsx`, `Editor` (~856–1100), `ViewSwitch` (~1103).
- **Evidence:**
  ```tsx
  const nameHeading = useRef<HTMLHeadingElement>(null);
  ...
  useEffect(() => {
    if (!focusName || !nameHeading.current) return;
    nameHeading.current.focus();
    setFocusName(false);
  }, [focusName, docs.current]);
  ...
  {docs.current === undefined && docs.ready && <PostTable docs={docs} busy={busy} onOpened={() => setFocusName(true)} focusSearch={wentHome} />}
  ```
- **Raised by:** structural-analyst S-2, behavioral-analyst B-2, B-3, B-5
- **Confidence:** Verified
- **Bears on:** S-2, D-1

### C-3: The grid's columns match its children by count, in three shapes

- **Claim:** `.main` places no child explicitly, so each column template has to match the children `App` renders.
  There are three shapes:
  - With a post open: the post panel, a drag bar, `Editor`, a drag bar, and the chat.
  - The landing page: `Editor` alone.
  - The landing page with the post panel kept: the post panel, a drag bar, and `Editor`.

  The hidden `#chat-status` paragraph on the landing page is `position: absolute`, so it takes no cell.
- **Location:** `src/ui/app.tsx` (`landing`, `postPanel`); `src/ui/styles.css`.
- **Evidence:**
  ```tsx
  const landing = docs.current === undefined;
  const postPanel = !landing || docs.missing.length > 0;
  ```
  ```css
  .main.landing { grid-template-columns: 1fr; }
  .main.landing.with-post-panel { grid-template-columns: var(--tree-width) auto 1fr; }
  ```
- **Raised by:** structural-analyst S-4, behavioral-analyst B-6
- **Confidence:** Verified from source. Browser layout was not inspected.
- **Bears on:** S-3, D-2

### C-4: Panel widths are App state, passed down as CSS variables and set as the grid's column widths

- **Claim:** `App` holds `treeWidth` (default 170, range 120–600) and `agentWidth` (default 400, range 280–800). They
  reach the grid as `--tree-width` and `--agent-width`, inline on `.main`, and reach `PanelResizer` as `width` with
  `min` and `max`. Nothing measures the DOM, so a width is the width of the grid column. `aria-valuenow` reports that
  column width. Tests read the variables from `.main`.
- **Location:** `src/ui/app.tsx`; `src/ui/components/panel-resizer/panel-resizer.tsx`; `src/ui/app.test.tsx:407`, `:422`.
- **Evidence:**
  ```tsx
  style={{ '--tree-width': `${treeWidth}px`, '--agent-width': `${agentWidth}px` } as React.CSSProperties}
  ```
- **Raised by:** structural-analyst S-5, behavioral-analyst B-8
- **Confidence:** Verified
- **Bears on:** S-4, D-4

### C-5: The drag bar always draws a 1px line, and its focus indicator is its own background

- **Claim:** `.panel-resizer` draws a 1px `--border` line down its middle at all times, and overlaps its neighbors with
  a negative margin. On hover and `:focus-visible` it turns off the outline and draws a 3px accent line instead, so that
  line is the bar's only keyboard focus indicator. The component's test does not depend on the surrounding DOM.
- **Location:** `src/ui/components/panel-resizer/panel-resizer.css`; `panel-resizer.test.tsx`.
- **Evidence:**
  ```css
  .panel-resizer {
    width: 5px; margin: 0 -2px; z-index: 1; cursor: col-resize; touch-action: none;
    background: linear-gradient(var(--border), var(--border)) center / 1px 100% no-repeat;
  }
  .panel-resizer:hover, .panel-resizer:focus-visible {
    outline: none; background: linear-gradient(var(--accent), var(--accent)) center / 3px 100% no-repeat;
  }
  ```
- **Raised by:** structural-analyst S-6, behavioral-analyst B-8
- **Confidence:** Verified
- **Bears on:** S-5, D-5

### C-6: The two panels are styled differently, and neither has a box

- **Claim:** The two panels share no class, and only their `h2` rule is shared:
  - The post panel is `<aside className="files post-panel">`. It has `padding: 10px; overflow: auto` and no background,
    so it shows the page's `--bg`.
  - The chat is `<section className="side">`. It is a four-row grid on `background: var(--panel)` with no padding of its
    own. Its rows carry their own padding and top and bottom borders.
  - Neither panel has a border, a corner radius, or a margin today.
  - Inside the post panel, a row's hover fill is `var(--border)`, and the paused note is drawn on `var(--bg)`.
- **Location:** `src/ui/styles.css` (`.side`, the shared `h2` rule); `src/ui/documents/post-panel/post-panel.css`
  (`.files`); `src/ui/chat/agent-panel/agent-panel.css` (`.side-head`); `src/ui/chat/chat/chat.css`.
- **Evidence:**
  ```css
  .files { padding: 10px; overflow: auto; }
  .side { display: grid; grid-template-rows: auto 1fr auto auto; min-height: 0; background: var(--panel); }
  .files h2, .side h2 { font-size: 12px; text-transform: uppercase; ... }
  ```
- **Raised by:** structural-analyst S-7, behavioral-analyst B-14
- **Confidence:** Verified. Contrast was not computed.
- **Bears on:** S-6, D-6

### C-7: App tests reach the header through its class and its parent section

- **Claim:** `app.test.tsx` selects the header with `.editor-bar`, at lines 366, 396, 589, and 650.
  - Line 367 asserts that focus is inside `section.editor` once a post opens from the table. That holds only while the
    header is inside that section.
  - Line 654 asserts that `.files` holds no level-1 heading.
  - Lines 347, 359, and 389 scope `within(...)` queries to `section.editor` in order to reach the post table's controls.
- **Location:** `src/ui/app.test.tsx`.
- **Evidence:**
  ```ts
  expect(document.querySelector('section.editor')!.contains(document.activeElement)).toBe(true);
  const title = () => within(view.container.querySelector('.editor-bar')!).getByRole('heading', { level: 1 }).textContent;
  ```
- **Raised by:** structural-analyst S-8
- **Confidence:** Verified for the lines named. Every role query in the file was not audited.
- **Bears on:** S-2, Unit 2

### C-8: `documents.test.tsx` renders `Editor` on its own, header included, about 60 times

- **Claim:** `documents.test.tsx` renders `<Editor docs={...} />` with no `App` around it. It finds the header's
  controls (Save, Home, the view switch) through role queries within that render. Those tests keep working only while a
  standalone `Editor` still renders its header.
- **Location:** `src/ui/documents/documents/documents.test.tsx` (for example lines 100, 113, 123, 213).
- **Evidence:** about 60 `<Editor` renders found by `grep -c`. The file has no `.editor-bar` or `.main` selectors.
- **Raised by:** structural-analyst S-8, and the run's own grep (64 `<Editor` matches across `src/ui`, one of them in
  `app.tsx`)
- **Confidence:** The count is verified. Whether each role query reaches into the header is Unverified, because the
  file's roughly 1,500 lines were not audited query by query.
- **Bears on:** S-2, D-1

### C-9: Each column scrolls itself, and menus open inside those scrollers

- **Claim:** Each column has its own scroller:
  - The post panel scrolls itself (`.files { overflow: auto }`), and its `.tree` is `max-content` wide, so long names
    scroll sideways.
  - In the editor column, `.rich-editor` scrolls, with the formatting toolbar inside it. `.post-table` scrolls on the
    landing page and centers its content at 960px wide.
  - In the chat, `.messages` scrolls. A `scrollIntoView` call scrolls every scrollable ancestor.
  - A post row's "…" menu is absolutely placed inside the post panel's scroller, so any `overflow` on that box clips it.
- **Location:** `src/ui/documents/post-panel/post-panel.css`; `src/ui/documents/markdown-editor/markdown-editor.css`;
  `src/ui/documents/documents/post-table.css`; `src/ui/chat/chat/chat.css`.
- **Evidence:**
  ```css
  .post-table { position: relative; flex: 1; min-height: 0; overflow: auto; padding: 24px max(24px, calc((100% - 960px) / 2)); }
  ```
- **Raised by:** behavioral-analyst B-9
- **Confidence:** Verified from source. Clipping and scrollbar shape were not seen in a browser.
- **Bears on:** S-6, D-6

### C-10: Popups and hidden status lines depend on which ancestor is their containing block

- **Claim:** Some elements are positioned against the window or against their nearest ancestor:
  - The link and image popups are `position: fixed`, placed in window coordinates from `getBoundingClientRect()`. If an
    ancestor gains a `transform`, `filter`, `contain`, or `will-change`, they are placed against that box instead.
  - The hidden `#chat-status` paragraph is `position: absolute` with `clip`. No panel is positioned today, so it is
    placed against the page.
- **Location:** `src/ui/documents/markdown-editor/anchored-bubble.ts`, `anchored-bubble.css`; `src/ui/styles.css`
  (`.visually-hidden`); `src/ui/chat/chat/chat.tsx`.
- **Raised by:** behavioral-analyst B-7, B-10
- **Confidence:** Verified from source. A browser was not available to check.
- **Bears on:** S-6, Risks

### C-11: The lost-connection banner is fixed over the top of the window

- **Claim:** `.connection-lost` is `position: fixed; top: 0; left: 0; right: 0; z-index: 10`. It takes no grid row, and
  it covers whatever is at the top of the window, which today is the top of every column.
- **Location:** `src/ui/styles.css`.
- **Raised by:** behavioral-analyst B-11
- **Confidence:** Verified
- **Bears on:** Risks

### C-12: The header and the notices render on both the landing page and the post page

- **Claim:** The bar always renders `<h1>3pitor</h1>`. Home, the name, Saved or Unsaved, the view switch, and Save
  render only while a post is open. Under the bar, inside the same column, come the post table (on the landing page),
  then the notices (`restoreError` and `writeError` included, on both pages), then the editor.
- **Location:** `src/ui/documents/documents/documents.tsx`, `Editor` (~925–1050).
- **Raised by:** structural-analyst S-9, behavioral-analyst B-13
- **Confidence:** Verified
- **Bears on:** S-2

### C-13: Dialogs open as modals in the top layer

- **Claim:** The confirm and name dialogs are `<dialog>` elements, so ancestor margin, overflow, and stacking contexts do
  not affect them.
- **Location:** `src/ui/components/confirm-dialog/`; `src/ui/documents/components/post-dialogs/`.
- **Raised by:** behavioral-analyst B-12
- **Confidence:** Unverified. Nobody read the component bodies to confirm they call `showModal`.
- **Bears on:** —

## Findings No Agent Could Audit

- **Rendered layout.** No agent ran a browser. Nothing in this run saw any of these: where the grid draws each cell, how
  a scrollbar looks inside a rounded corner, whether a popup lands where it should, or the contrast of the new box edges.
  Closing this takes running the app (`bun run server`) and looking at both pages, in light and dark mode, with the
  connection-lost banner showing.

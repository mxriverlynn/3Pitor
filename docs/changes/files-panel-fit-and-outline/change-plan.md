# Change Plan: Files Panel Fit and Outline

## Why This Change

The user asked for two things in the left column: a Files box that is only as tall as its list, and a new box titled
"Outline" below it that lists the open file's headings. This is a new requirement, from the user's own request when
starting this plan:

> have the Files sidebar vertically shrink to fit the content. below it, add another panel box with a title of
> "Outline". inside of this, show the current file's outline using only the `#`, `##`, `###`, `####`, and `#####`
> markdown tags for the outline

The accepted area, including what stays out, is in [artifacts/scope-boundary.md](artifacts/scope-boundary.md).

## What Changes, In One Paragraph

The left column holds two rounded boxes instead of one. Files sits on top and is only as tall as its list. Below it, a
box titled "Outline" fills whatever height Files leaves and lists the open file's level 1 to 5 headings, indented by
level. The list follows the writer's typing in both the Formatted and Markdown views, unsaved changes included. It also
follows Claude's edits and changes from disk. The editor learns one new thing: how to list a document's headings.
Nothing about saving, opening, or the chat changes.

## Current State

The left column is one grid cell, and the Files box fills it. `.main` is a one-row grid whose first column holds the
Files `<aside>` and whose second holds the drag bar
([C-1](artifacts/current-state-findings.md#c-1-the-left-column-is-one-grid-cell-holding-the-files-box)). Grid items
stretch, so Files is always as tall as the window allows, and its body scrolls inside it
([C-2](artifacts/current-state-findings.md#c-2-the-files-box-fills-the-rows-height-because-grid-items-stretch)).

The box's look is already shared with the chat panel. Its border, radius, background, and heading style are selector
lists in `styles.css`. A comment there forbids `position`, `transform`, and `contain` on the boxes, because those would
misplace the editor's popups
([C-3](artifacts/current-state-findings.md#c-3-the-box-chrome-margins-and-the-heading-style-are-shared-with-the-chat-panel-in-stylescss)).
The Files head and body rules live in `post-panel.css`, and its row rules all start with `.files`
([C-4](artifacts/current-state-findings.md#c-4-files-row-and-list-rules-are-scoped-to-files)).

The open file's live content is already available. `useDocuments` returns the open file's Yjs document as `docs.doc`,
and re-renders App on every change to it
([C-6](artifacts/current-state-findings.md#c-6-the-documents-hook-exposes-the-open-files-ydoc-and-re-renders-app-on-every-change-to-it)).
Yjs is the shared-editing library the editor stores each document in. Typing in either view, Claude's edits, and disk
sync all reach that document
([C-7](artifacts/current-state-findings.md#c-7-both-views-write-the-ydoc-as-the-writer-types-ai-edits-and-disk-sync-re-render-too)).
Only `markdown-editor.tsx` knows where in the Yjs document the content lives
([C-8](artifacts/current-state-findings.md#c-8-reading-the-ydoc-as-a-prosemirror-node-needs-a-helper-inside-markdown-editor)).

The markdown parser already decides what a heading is. Fenced and indented code never parse as headings, and setext
headings (a line underlined with `===` or `---`) do. Headings inside a quote or a list item parse as headings nested
below the top level
([C-10](artifacts/current-state-findings.md#c-10-the-parser-decides-what-a-heading-is-fences-and-indented-code-never-become-headings)).
No code reads headings out of a document today.

The structural property this change addresses is that the left column has exactly one box, sized by the grid rather
than by its content.

## Target State

### The left column

`App` wraps the two boxes in a `.left-column` element, which takes the Files box's grid cell. The drag bar stays its own
grid item beside it, so it still runs the full height of the column. The grid templates do not change
([D-1](artifacts/change-decision-log.md#d-1-the-left-column-becomes-a-wrapper-holding-both-boxes)).

```tsx
{postPanel && (
  <>
    <div className="left-column">
      <PostPanel docs={docs} busy={chat.busy} />
      <HeadingsPanel doc={docs.doc} />
    </div>
    <PanelResizer label="Resize the post panel" width={treeWidth} min={120} max={600} onResize={setTreeWidth} />
  </>
)}
```

Files gets the height its list needs first, and the Outline box takes whatever is left. The wrapper is a flex column
with an 8px gap between the boxes, and it carries the 8px margin `.files` carries today. Files starts from its content
height and shrinks, with its body scrolling, only when its own list is longer than the column allows
([D-2](artifacts/change-decision-log.md#d-2-files-is-as-tall-as-its-list-shrinks-and-scrolls-when-the-list-is-long-and-keeps-a-floor)).
The Outline box starts from zero and grows into the rest, so a long outline never squeezes a short Files list, and the
column still ends level with the chat box
([D-10](artifacts/change-decision-log.md#d-10-the-headings-box-takes-the-rest-of-the-column)).

Neither box shrinks below 110px, which keeps its title and a row or two in view. For example, with a 700px column, a
200px Files list, and a 1,500px outline, Files stays 200px and the Outline gets 492px and scrolls.

```css
.left-column { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 8px 8px; min-height: 0; }
.files { flex: 0 1 auto; min-height: 110px; }      /* loses its own margin */
.headings { flex: 1 1 0; min-height: 110px; }
```

### Shared box styles

The Outline box looks like the Files box because it joins the same selector lists, not because it copies them. The head,
body, and hint rules move from `post-panel.css` into `styles.css`, each naming both boxes
([D-3](artifacts/change-decision-log.md#d-3-box-chrome-and-headbody-structure-are-shared-through-the-existing-selector-lists)).

Two details carry over exactly. The inner-grid rule keeps `min-height: 0`. The head `h2` rule sits after the shared `h2`
rule, because the two are equally specific and the later one wins. The post-title `h3`, the section `h4`, and Files'
list, row, "…", and paused-notice rules stay in `post-panel.css`, so the headings list does not pick them up. The comment
about popups extends to name `.headings` and `.left-column`.

```css
.files h2, .side h2, .headings h2 { /* unchanged */ }
/* ... No position, transform, or contain on .files, .side, .headings, or .left-column, which would misplace the
   editor's popups. */
.files, .side, .headings { /* border, radius, background, unchanged */ }
.files, .headings { display: grid; grid-template-rows: auto 1fr; min-height: 0; }
.files-head, .headings-head { padding: 10px 12px; border-bottom: 1px solid var(--border); }
.files-head h2, .headings-head h2 { margin: 0; }      /* after the shared h2 rule */
.files-body, .headings-body { padding: 10px; overflow: auto; min-height: 0; }
.files .hint, .headings .hint { margin: 6px 8px; font-size: 12px; color: var(--muted); line-height: 1.4; }
```

### Reading headings out of a document

`markdown-editor.tsx` gains `headingsOf`, beside `markdownOf`. It turns the Yjs document into a document tree and reads
the headings from its top level. That is about ten times cheaper than writing the document out as markdown and parsing
it again ([D-4](artifacts/change-decision-log.md#d-4-headingsof-lives-in-markdown-editortsx-beside-markdownof)).

```ts
export type Heading = { level: 1 | 2 | 3 | 4 | 5; text: string };
// The document's # to ##### headings, in order, for the Outline box.
export function headingsOf(doc: Y.Doc): Heading[];
```

Four rules decide what it returns:

- **Only top-level headings.** A heading inside a quote or a list item is left out, because it does not divide the
  writer's post into sections
  ([D-6](artifacts/change-decision-log.md#d-6-only-top-level-headings-are-listed)).
- **Levels 1 to 5.** A `######` heading is left out, as the request says.
- **Setext headings count.** A heading underlined with `===` or `---` is listed as level 1 or 2. The stored document
  does not record how a heading was written
  ([D-16](artifacts/change-decision-log.md#trivial-decisions)).
- **Tidied text, no empty rows.** Code, emphasis, and link text show as plain text. Runs of spaces collapse and the
  ends are trimmed. A heading with no text left, such as `# ` or one holding only an image, is skipped
  ([D-7](artifacts/change-decision-log.md#d-7-heading-text-is-tidied-and-empty-headings-are-skipped)).

For this markdown:

~~~~markdown
# A `code` *em* ![i](a.png) b

> ## quote

- ## in list

###### six

#

```
# fence
```

Setext
===
~~~~

`headingsOf` returns:

```ts
[{ level: 1, text: 'A code em b' }, { level: 1, text: 'Setext' }]
```

### The Outline box

`HeadingsPanel` is a new component in `src/ui/documents/headings-panel/`. It takes the open file's Yjs document and
nothing else. Its code name says "headings" because "outline" already names each post's outline document and the
highlight outline; only its visible title says "Outline"
([D-9](artifacts/change-decision-log.md#d-9-the-component-is-headingspanel-only-its-title-says-outline)).

```tsx
export function HeadingsPanel({ doc }: { doc: Y.Doc | undefined })
```

```tsx
<aside className="headings" aria-label="Outline">
  <div className="headings-head"><h2>Outline</h2></div>
  <div className="headings-body" tabIndex={headings.length > 0 ? 0 : undefined}>
    {doc === undefined ? <p className="hint">No file open.</p>
     : headings.length === 0 ? <p className="hint">Headings from # to ##### appear here.</p>
     : <ul aria-label="Headings in this file">
         {headings.map((h, i) => (
           <li key={i} style={{ '--level': h.level } as React.CSSProperties}>
             <span className="visually-hidden">Level {h.level}, </span>
             {h.text}
           </li>
         ))}
       </ul>}
  </div>
</aside>
```

The box shows whenever the left column does, with a hint when it has nothing to list. That covers the landing page
while unsaved documents have nowhere to be saved, and the moment before a reload reopens the last file
([D-8](artifacts/change-decision-log.md#d-8-the-headings-box-always-shows-beside-files-with-a-hint-when-it-has-nothing-to-list),
[C-13](artifacts/current-state-findings.md#c-13-which-file-docsdoc-is-in-each-state)).

Screen-reader and keyboard users get what the indentation shows. Each row is read with its level first, as
"Level 2, Pricing". The list area takes a focus stop, so it can be scrolled from the keyboard. The rows themselves have
no hover style, no pointer cursor, and no focus stop, because choosing one does nothing
([D-17](artifacts/change-decision-log.md#d-17-the-outline-box-says-each-headings-level-aloud-scrolls-from-the-keyboard-and-has-no-clickable-look)).
Both boxes are named landmarks: the Files `<aside>` takes `aria-label="Files"`, so a landmark list shows "Files" and
"Outline" rather than two unnamed sidebars
([D-18](artifacts/change-decision-log.md#d-18-both-boxes-are-named-landmarks)).

Each level below 1 indents a further 12px
([D-13](artifacts/change-decision-log.md#trivial-decisions)). The list is keyed by index, since it holds no per-row
state ([D-14](artifacts/change-decision-log.md#trivial-decisions)). A long heading wraps, long words included, rather
than being cut off ([D-15](artifacts/change-decision-log.md#trivial-decisions)). `headings-panel.css` holds only the
list rules:

```css
/* Display-only: no hover, no pointer cursor, and no focus stop on a row, since choosing one does nothing. */
.headings ul { list-style: none; margin: 0; padding: 0; }
.headings li { padding: 3px 8px 3px calc(8px + (var(--level) - 1) * 12px); overflow-wrap: anywhere; }
```

The panel calls `headingsOf(doc)` every time it renders, with no caching. App already re-renders on every change to
the document, and a cache keyed on the document would go stale because the document object stays the same while its
content changes ([D-5](artifacts/change-decision-log.md#d-5-the-headings-are-recomputed-on-every-render-with-no-memo)).

## Surface Delta

### S-1: `headingsOf` and `Heading` in `markdown-editor.tsx` — Added

**Target state.** `markdown-editor.tsx` exports `type Heading = { level: 1 | 2 | 3 | 4 | 5; text: string }` and
`headingsOf(doc: Y.Doc): Heading[]`. `headingsOf` returns the document's top-level headings of levels 1 to 5, setext
included, in document order, with tidied text, skipping empty ones. It is the only reader of headings in the UI.

**Behavior.** Preserving. Nothing calls it until S-5.

**Why.** The Outline box needs the open file's headings, and only this module knows where the content lives in the Yjs
document.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-headingsof-lives-in-markdown-editortsx-beside-markdownof),
[D-6](artifacts/change-decision-log.md#d-6-only-top-level-headings-are-listed),
[D-7](artifacts/change-decision-log.md#d-7-heading-text-is-tidied-and-empty-headings-are-skipped),
[D-16](artifacts/change-decision-log.md#trivial-decisions)

### S-2: Files box structure rules — Moved

**Target state.** The rules for `.files`' inner grid (with `min-height: 0`), `.files-head`, `.files-head h2` (placed
after the shared `h2` rule), `.files-body`, and the hint (formerly `.post-panel .hint`, now `.files .hint`) live in
`src/ui/styles.css`. `post-panel.css` holds the post-title `h3` and section `h4` rules and Files' list, row, "…", and
paused-notice rules.

**Behavior.** Preserving. The same rules match the same element; `.post-panel` and `.files` are one `<aside>`. No test
reads these rules, so the check is a look in the running app.

**Why.** Two boxes share one head-and-body structure, and the chrome they share already lives in `styles.css`.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-box-chrome-and-headbody-structure-are-shared-through-the-existing-selector-lists)

### S-3: `.left-column` in `App` — Added

**Target state.** `App` renders a `<div className="left-column">` as the only item in `.main`'s first grid column,
holding `PostPanel` and then `HeadingsPanel`. It is a flex column with an 8px gap and the 8px outer margin. The drag bar
stays a sibling in `.main`'s second column. The grid templates are unchanged.

**Behavior.** Preserving for the grid, the editor's slot, and the drag bar. It lands with S-4 and S-5, because a flex
column already sizes Files to its content: landing alone, it would show a short Files box above empty space.

**Why.** Two boxes cannot share the first grid column as siblings without taking the editor's slot.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-left-column-becomes-a-wrapper-holding-both-boxes)

### S-4: `.files` sizing — Re-scoped

**Target state.** The Files box is as tall as its list. It shrinks, with a scrolling body, only when its own list is
longer than the column allows, and never goes below 110px. It no longer carries its own outer margin; `.left-column`
does.

**Behavior.** Changing. The writer sees the Files box end below its last row. Accepted as the request itself
([D-11](artifacts/change-decision-log.md#d-11-behavior-gate--the-files-box-no-longer-fills-the-column)).

**Why.** The request asks for it.

**Depends on.** S-3.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-files-is-as-tall-as-its-list-shrinks-and-scrolls-when-the-list-is-long-and-keeps-a-floor)

### S-5: `HeadingsPanel` — Added

**Target state.** `src/ui/documents/headings-panel/headings-panel.tsx` exports
`HeadingsPanel({ doc }: { doc: Y.Doc | undefined })`. It renders `<aside className="headings" aria-label="Outline">`
with the title "Outline", and lists `headingsOf(doc)` indented by level, each row read aloud with its level first. It
shows "No file open." when `doc` is undefined and "Headings from # to ##### appear here." when there is nothing to list.
It takes only the height Files leaves, never below 110px, and its list area takes a focus stop when it holds a list.
`App` renders it inside `.left-column`, after `PostPanel`, and passes `docs.doc`.

**Behavior.** Changing. A new box the writer sees. Accepted with the rules in D-6, D-7, D-8, D-10, D-16, and D-17
([D-12](artifacts/change-decision-log.md#d-12-behavior-gate--a-new-outline-box-lists-the-open-files-headings)).

**Why.** The request asks for it.

**Depends on.** S-1, S-2, S-3, S-4.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-headings-are-recomputed-on-every-render-with-no-memo),
[D-8](artifacts/change-decision-log.md#d-8-the-headings-box-always-shows-beside-files-with-a-hint-when-it-has-nothing-to-list),
[D-9](artifacts/change-decision-log.md#d-9-the-component-is-headingspanel-only-its-title-says-outline),
[D-10](artifacts/change-decision-log.md#d-10-the-headings-box-takes-the-rest-of-the-column),
[D-17](artifacts/change-decision-log.md#d-17-the-outline-box-says-each-headings-level-aloud-scrolls-from-the-keyboard-and-has-no-clickable-look)

### S-6: `PostPanel`'s `<aside>` landmark — Re-scoped

**Target state.** `PostPanel` renders `<aside className="files post-panel" aria-label="Files">`. It is the Files
landmark, named to match its visible title.

**Behavior.** Changing. A screen-reader user moving by landmark hears "Files" where they heard an unnamed sidebar.
Accepted under the user's delegation
([D-18](artifacts/change-decision-log.md#d-18-both-boxes-are-named-landmarks)).

**Why.** Once S-5 adds a second `<aside>`, two unnamed sidebar landmarks cannot be told apart.

**Depends on.** Lands with S-5.

**Decision.** [D-18](artifacts/change-decision-log.md#d-18-both-boxes-are-named-landmarks)

## Behavior Changes

Three entries change what a writer sees or hears. The first two are the change the user asked for; the third follows
from adding the second box. The rules inside them were settled without asking, under the user's standing delegation, and
any of them can be overturned.

1. **The Files box fits its list (S-4).** A writer with a post, its outline, and two research documents sees a short
   Files box. Files only shrinks, with its list scrolling, when its own list is longer than the column allows. A long
   outline never squeezes it
   ([D-11](artifacts/change-decision-log.md#d-11-behavior-gate--the-files-box-no-longer-fills-the-column)).
2. **A new Outline box lists the open file's headings (S-5).** Typing `## Pricing` into the post makes "Pricing" appear
   in the box, one step in. The box fills whatever height Files leaves. These rules apply:
   - A heading underlined with `===` or `---` appears.
   - These do not appear: a `######` heading, a heading inside a quote or a list, and a heading with no text.
   - With no file open, the box says "No file open."
   - With nothing to list, it says "Headings from # to ##### appear here."
   - A screen reader reads each row with its level first, such as "Level 2, Pricing".
   ([D-12](artifacts/change-decision-log.md#d-12-behavior-gate--a-new-outline-box-lists-the-open-files-headings)).
3. **The Files sidebar is a named landmark (S-6).** A screen-reader user moving by landmark hears "Files" and "Outline"
   instead of one unnamed sidebar
   ([D-18](artifacts/change-decision-log.md#d-18-both-boxes-are-named-landmarks)).

## Change Units

### Unit 1: List a document's headings

**What it does.** Adds `Heading` and `headingsOf` to the editor module. Tests go in `markdown-editor.test.tsx`, which
already builds documents with `docFromMarkdown`. One test runs the worked example from Target State, which fails if
any of these break: the level filter, the top-level walk, the setext case, the text tidying, the empty-heading skip, or
fenced code. Separate tests per rule are fine if that matches the file better.

**Delta entries.** S-1

**How you know it worked.** The new tests pass; nothing else changes.

### Unit 2: Share the box rules

**What it does.** Moves the Files head, body, inner-grid, and hint rules from `post-panel.css` into `styles.css` as
selector lists that name only `.files` for now. The inner-grid rule keeps `min-height: 0`, and the head `h2` rule sits
after the shared `h2` rule. The popup comment gains `.headings` and `.left-column`. Files still fills the column.

**Delta entries.** S-2

**How you know it worked.** The existing suite passes, though no test reads these rules. In the running app
(`bun run server`), the Files box, its "Files" title spacing, its drag bar, and its scrolling look and behave as
before.

### Unit 3: Build the Outline box

**What it does.** Adds `src/ui/documents/headings-panel/` with the component, its list CSS, and tests, and appends
`.headings` to the shared selector lists. Nothing renders it yet. The tests in `headings-panel.test.tsx` cover:

- the no-file hint;
- the nothing-to-list hint, using a document whose only heading is `######`;
- a list read through `getByRole('list', { name: 'Headings in this file' })`, asserting each row's spoken level
  ("Level 2, …") rather than its indent, which happy-dom cannot measure;
- a new heading after `replaceMarkdown` followed by an explicit `rerender`, since the panel has no subscription of its
  own.

**Delta entries.** S-5 (component only)

**Ordering constraint.** After Unit 1 (it calls `headingsOf`) and Unit 2 (it extends the shared rules).

**How you know it worked.** The new component tests pass; the app is unchanged. The `.headings` selectors have no test
observer until Unit 4's look in the running app.

### Unit 4: Show the Outline box and fit Files to its list

**What it does.** Adds `.left-column` around `PostPanel` and `HeadingsPanel` in `App`, moves the outer margin from
`.files` to `.left-column`, and sets `.files { flex: 0 1 auto; min-height: 110px }` and
`.headings { flex: 1 1 0; min-height: 110px }`. Adds `aria-label="Files"` to `PostPanel`'s `<aside>`.

`app.test.tsx` changes in four places:

- The test that checks which panels show on each page gains an `outline: aside.headings !== null` key in its three
  `toEqual` calls.
- The unsaved-with-nowhere-to-save test, where no file is open but the left column shows, asserts the Outline box says
  "No file open."
- A new test opens Notes, switches to the Markdown view, changes the text to add `## Pricing`, and asserts "Pricing"
  appears in the Outline list without a save. It fails if Markdown typing stops reaching the document or App stops
  re-rendering on document changes.
- A new test runs a Claude edit (`afterTurn(finishedTurn({ edited }))`) whose text adds a `##` heading the Notes fixture
  does not have, and asserts the list changes. The fixture already starts with `# Notes`, so the edit must add a new
  heading for the test to tell before from after. This pins the reliance on App re-rendering
  ([D-5](artifacts/change-decision-log.md#d-5-the-headings-are-recomputed-on-every-render-with-no-memo)).

**Delta entries.** S-3, S-4, S-5 (mounting), S-6

**Ordering constraint.** After Unit 3. The wrapper, the Files fit, and the Outline box land together, so the column
never shows a short Files box above empty space.

**How you know it worked.** The suite passes. In the running app:

- Files ends below its last row, and the Outline box fills the rest.
- Typing a heading in either view shows it at once.
- A long outline under a short Files list leaves Files at its full height, with the Outline scrolling.
- A long research list scrolls inside Files while the Outline keeps its title in view.
- The drag bar still runs the full height of the column.
- A Files row's "…" menu opens in the right place.

## Risks

- **The layout is unverified in a browser.** Every height and scroll claim rests on CSS rules; the tests run in
  happy-dom, which does no layout and loads no stylesheet. Unit 2 and Unit 4 each end with a look in the running app.
  The blast radius is the left column only.
- **Typing in a very long post may slow down.** The headings are recomputed on every keystroke. That costs about 0.3 ms
  on a 15 KB post, but a 100 KB post was never measured
  ([C-12](artifacts/current-state-findings.md#c-12-the-cost-on-a-very-large-post-is-unmeasured), Unverified). Typing
  in the largest real post in the workspace during Unit 4 will show it. The fix is the version-keyed cache deferred
  below.
- **The editor's popups could be misplaced** if `position`, `transform`, `contain`, or `overflow` is added to
  `.left-column` or `.headings`. The comment in `styles.css` names both after Unit 2. Opening a Files row's "…" menu
  in Unit 4 checks it.

## Deferred (YAGNI)

- **A shared, server-loadable heading reader in `src/shared/`.** No server code needs headings today. Reopen when the
  server needs them, such as an AI tool that reads a post's structure
  ([D-4](artifacts/change-decision-log.md#d-4-headingsof-lives-in-markdown-editortsx-beside-markdownof)).
- **Generic `.panel-box`, `.panel-head`, and `.panel-body` classes.** The selector lists do the job. Reopen when a
  fourth box lands or the lists drift
  ([D-3](artifacts/change-decision-log.md#d-3-box-chrome-and-headbody-structure-are-shared-through-the-existing-selector-lists)).
- **Caching the headings by a document version.** No measured cost. Reopen when typing in a long post feels slow, or a
  measurement shows the conversion above about 5 ms per keystroke
  ([D-5](artifacts/change-decision-log.md#d-5-the-headings-are-recomputed-on-every-render-with-no-memo)).
- **A Formatted-view typing test at App level.** Driving the formatted editor under happy-dom is awkward, and it reaches
  the document through the same update path the Claude-edit test covers. Reopen when a regression shows up in the
  Formatted view specifically.
- **A test that reads the CSS for the popup rule.** The comment in `styles.css` and the "…" menu check carry it. Reopen
  if the rule is broken once.

## Cut for Scope

- **Clicking a heading to jump to it in the editor.** It would scroll the editor to that heading and place the cursor
  there. The accepted area makes the Outline display-only: "Out of scope unless asked for: clicking a heading in the
  Outline box to jump to it" ([artifacts/scope-boundary.md](artifacts/scope-boundary.md)). Reinstating it would add a
  position to each `Heading`, make each row a button, and give the panel a way to reach the editor.

## Open Items

- **Non-blocking: which browser the writer uses.** The focus stop on the Outline's list area matters most in Safari,
  which does not make scrolling areas focusable on its own. It is in the plan either way
  ([D-17](artifacts/change-decision-log.md#d-17-the-outline-box-says-each-headings-level-aloud-scrolls-from-the-keyboard-and-has-no-clickable-look)).

## Review Findings

One review round ran with `han-core:junior-developer`, `han-core:user-experience-designer`, and `han-core:test-engineer`.
Each finding below changed the plan; the decisions they produced are in
[artifacts/change-decision-log.md](artifacts/change-decision-log.md).

- **A long outline would have squeezed a short Files list** (junior-developer JD-001, UX designer UX-001, merged). The
  draft let both boxes shrink. The Outline now starts from zero and takes only what Files leaves
  ([D-10](artifacts/change-decision-log.md#d-10-the-headings-box-takes-the-rest-of-the-column)). Unverified: reasoned
  from the flexbox rules, not a rendered page.
- **An 80px floor showed less than one row** (UX-002). Both floors are now 110px
  ([D-2](artifacts/change-decision-log.md#d-2-files-is-as-tall-as-its-list-shrinks-and-scrolls-when-the-list-is-long-and-keeps-a-floor)).
  Unverified: no rendered line heights.
- **The wrapper alone would already shrink Files** (JD-002). It moved from Unit 2 into Unit 4
  ([D-1](artifacts/change-decision-log.md#d-1-the-left-column-becomes-a-wrapper-holding-both-boxes)).
- **Two CSS details would have been lost in the move** (JD-003): `min-height: 0` and the head `h2` rule's order. JD-007
  asked where the `h3` and `h4` rules go. All three are now stated
  ([D-3](artifacts/change-decision-log.md#d-3-box-chrome-and-headbody-structure-are-shared-through-the-existing-selector-lists)).
- **Setext headings were listed with no recorded decision** (JD-004). They are now
  ([D-16](artifacts/change-decision-log.md#trivial-decisions)).
- **Long words would not wrap at the panel's narrowest width** (UX-003)
  ([D-15](artifacts/change-decision-log.md#trivial-decisions)).
- **Accessibility** (UX-004, UX-006, UX-008, and JD-006): spoken levels replace `data-level`, the list area takes a
  focus stop, and rows are kept display-only
  ([D-17](artifacts/change-decision-log.md#d-17-the-outline-box-says-each-headings-level-aloud-scrolls-from-the-keyboard-and-has-no-clickable-look)).
  UX-005 adds a second `<aside>` landmark name
  ([D-18](artifacts/change-decision-log.md#d-18-both-boxes-are-named-landmarks)).
- **The empty-list hint was wrong for some files** (UX-007)
  ([D-8](artifacts/change-decision-log.md#d-8-the-headings-box-always-shows-beside-files-with-a-hint-when-it-has-nothing-to-list)).
- **Tests** (test engineer): the App tests gain a Markdown-view typing test, a Claude-edit test that adds a new heading,
  the panel-visibility update, and a "No file open." assertion. Unit 3's re-render test calls `rerender` explicitly. The
  plan now says that no test reads the moved CSS.
- **Not acted on:** indenting from the shallowest heading level present (UX-009), because every post in the workspace
  starts at `#` ([D-13](artifacts/change-decision-log.md#trivial-decisions)). JD-005's reframing of "Why This Change" was
  applied to that section's wording.

# Change Plan: Files Panel Fit and Outline

## Why This Change

The left column should show the open file's headings, and the Files box should stop filling the column to do it. This
is a new requirement, from the user's own request when starting this plan:

> have the Files sidebar vertically shrink to fit the content. below it, add another panel box with a title of
> "Outline". inside of this, show the current file's outline using only the `#`, `##`, `###`, `####`, and `#####`
> markdown tags for the outline

The accepted area, including what stays out, is in [artifacts/scope-boundary.md](artifacts/scope-boundary.md).

## What Changes, In One Paragraph

The left column holds two rounded boxes instead of one. Files sits on top and is only as tall as its list. Below it, a
box titled "Outline" fills the rest of the column and lists the open file's level 1 to 5 headings, indented by level.
The list follows the writer's typing in both the Formatted and Markdown views, unsaved changes included. It also follows
Claude's edits and changes from disk. The editor learns one new thing: how to list a document's headings. Nothing about
saving, opening, or the chat changes.

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

The wrapper is a flex column with an 8px gap between the boxes, and it carries the 8px margin `.files` carries today.
Files is as tall as its list. When the list is longer than the column allows, Files shrinks and its body scrolls
([D-2](artifacts/change-decision-log.md#d-2-files-is-as-tall-as-its-list-shrinks-and-scrolls-when-the-list-is-long-and-keeps-a-floor)).
The Outline box takes the rest of the column, so the column still ends level with the chat box
([D-10](artifacts/change-decision-log.md#d-10-the-headings-box-takes-the-rest-of-the-column)). Neither box shrinks
below 80px, which keeps its title and about two rows in view.

```css
.left-column { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 8px 8px; min-height: 0; }
.files { flex: 0 1 auto; min-height: 80px; }      /* loses its own margin */
.headings { flex: 1 1 auto; min-height: 80px; }
```

### Shared box styles

The Outline box looks like the Files box because it joins the same selector lists, not because it copies them. The head,
body, and hint rules move from `post-panel.css` into `styles.css`, each naming both boxes. Files' list and row rules stay
in `post-panel.css`, scoped to `.files`, so the headings list does not pick them up. The comment about popups extends to
name `.left-column` and `.headings`
([D-3](artifacts/change-decision-log.md#d-3-box-chrome-and-headbody-structure-are-shared-through-the-existing-selector-lists)).

```css
.files h2, .side h2, .headings h2 { /* unchanged */ }
.files, .side, .headings { /* border, radius, background, unchanged */ }
.files, .headings { display: grid; grid-template-rows: auto 1fr; }
.files-head, .headings-head { padding: 10px 12px; border-bottom: 1px solid var(--border); }
.files-head h2, .headings-head h2 { margin: 0; }
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

Three rules decide what it returns:

- **Only top-level headings.** A heading inside a quote or a list item is left out, because it does not divide the
  writer's post into sections
  ([D-6](artifacts/change-decision-log.md#d-6-only-top-level-headings-are-listed)).
- **Levels 1 to 5.** A `######` heading is left out, as the request says.
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
<aside className="headings">
  <div className="headings-head"><h2>Outline</h2></div>
  <div className="headings-body">
    {doc === undefined ? <p className="hint">No file open.</p>
     : headings.length === 0 ? <p className="hint">No headings in this file.</p>
     : <ul aria-label="Headings in this file">
         {headings.map((h, i) => (
           <li key={i} data-level={h.level} style={{ '--level': h.level } as React.CSSProperties}>{h.text}</li>
         ))}
       </ul>}
  </div>
</aside>
```

The box shows whenever the left column does, with a hint when it has nothing to list. That covers the landing page
while unsaved documents have nowhere to be saved, and the moment before a reload reopens the last file
([D-8](artifacts/change-decision-log.md#d-8-the-headings-box-always-shows-beside-files-with-a-hint-when-it-has-nothing-to-list),
[C-13](artifacts/current-state-findings.md#c-13-which-file-docsdoc-is-in-each-state)).

Each level below 1 indents a further 12px
([D-13](artifacts/change-decision-log.md#trivial-decisions)). The list is keyed by index, since it holds no per-row
state ([D-14](artifacts/change-decision-log.md#trivial-decisions)). A long heading wraps rather than being cut off
([D-15](artifacts/change-decision-log.md#trivial-decisions)). `headings-panel.css` holds only the list rules:

```css
.headings ul { list-style: none; margin: 0; padding: 0; }
.headings li { padding: 3px 8px 3px calc(8px + (var(--level) - 1) * 12px); }
```

The panel calls `headingsOf(doc)` every time it renders, with no caching. App already re-renders on every change to
the document, and a cache keyed on the document would go stale because the document object stays the same while its
content changes ([D-5](artifacts/change-decision-log.md#d-5-the-headings-are-recomputed-on-every-render-with-no-memo)).

## Surface Delta

### S-1: `headingsOf` and `Heading` in `markdown-editor.tsx` — Added

**Target state.** `markdown-editor.tsx` exports `type Heading = { level: 1 | 2 | 3 | 4 | 5; text: string }` and
`headingsOf(doc: Y.Doc): Heading[]`. `headingsOf` returns the document's top-level headings of levels 1 to 5, in
document order, with tidied text, skipping empty ones. It is the only reader of headings in the UI.

**Behavior.** Preserving. Nothing calls it until S-5.

**Why.** The Outline box needs the open file's headings, and only this module knows where the content lives in the Yjs
document.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-headingsof-lives-in-markdown-editortsx-beside-markdownof),
[D-6](artifacts/change-decision-log.md#d-6-only-top-level-headings-are-listed),
[D-7](artifacts/change-decision-log.md#d-7-heading-text-is-tidied-and-empty-headings-are-skipped)

### S-2: Files box structure rules — Moved

**Target state.** The rules for `.files`' inner grid, `.files-head`, `.files-head h2`, `.files-body`, and the hint
(formerly `.post-panel .hint`, now `.files .hint`) live in `src/ui/styles.css` as selector lists that also name the
headings box. `post-panel.css` holds only Files' list, row, "…", and paused-notice rules.

**Behavior.** Preserving. The same rules match the same element; `.post-panel` and `.files` are one `<aside>`.

**Why.** Two boxes share one head-and-body structure, and the chrome they share already lives in `styles.css`.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-box-chrome-and-headbody-structure-are-shared-through-the-existing-selector-lists)

### S-3: `.left-column` in `App` — Added

**Target state.** `App` renders a `<div className="left-column">` as the only item in `.main`'s first grid column,
holding `PostPanel` and then `HeadingsPanel`. It is a flex column with an 8px gap and the 8px outer margin. The drag bar
stays a sibling in `.main`'s second column. The grid templates are unchanged.

**Behavior.** Preserving on its own: until S-4, Files fills the wrapper and the page looks as it does today.

**Why.** Two boxes cannot share the first grid column as siblings without taking the editor's slot.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-left-column-becomes-a-wrapper-holding-both-boxes)

### S-4: `.files` sizing — Re-scoped

**Target state.** The Files box is as tall as its list, shrinks with a scrolling body when the column is too short, and
never goes below 80px. It no longer carries its own outer margin; `.left-column` does.

**Behavior.** Changing. The writer sees the Files box end below its last row. Accepted as the request itself
([D-11](artifacts/change-decision-log.md#d-11-behavior-gate--the-files-box-no-longer-fills-the-column)).

**Why.** The request asks for it.

**Depends on.** S-3.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-files-is-as-tall-as-its-list-shrinks-and-scrolls-when-the-list-is-long-and-keeps-a-floor)

### S-5: `HeadingsPanel` — Added

**Target state.** `src/ui/documents/headings-panel/headings-panel.tsx` exports
`HeadingsPanel({ doc }: { doc: Y.Doc | undefined })`. It renders `<aside className="headings">` with the title
"Outline", and lists `headingsOf(doc)` indented by level. It shows "No file open." when `doc` is undefined and "No
headings in this file." when there are none. It fills the rest of the left column, never below 80px. `App` renders it
inside `.left-column`, after `PostPanel`, and passes `docs.doc`.

**Behavior.** Changing. A new box the writer sees. Accepted with the rules in D-6, D-7, D-8, and D-10
([D-12](artifacts/change-decision-log.md#d-12-behavior-gate--a-new-outline-box-lists-the-open-files-headings)).

**Why.** The request asks for it.

**Depends on.** S-1, S-2, S-3, S-4.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-headings-are-recomputed-on-every-render-with-no-memo),
[D-8](artifacts/change-decision-log.md#d-8-the-headings-box-always-shows-beside-files-with-a-hint-when-it-has-nothing-to-list),
[D-9](artifacts/change-decision-log.md#d-9-the-component-is-headingspanel-only-its-title-says-outline),
[D-10](artifacts/change-decision-log.md#d-10-the-headings-box-takes-the-rest-of-the-column)

## Behavior Changes

Two entries change what the writer sees. Both are the change the user asked for. The rules inside them were settled
without asking, under the user's standing delegation, and any of them can be overturned.

1. **The Files box fits its list (S-4).** A writer with a post, its outline, and two research documents sees a short
   Files box. A writer with many research documents sees Files share the column with the Outline box, its list
   scrolling ([D-11](artifacts/change-decision-log.md#d-11-behavior-gate--the-files-box-no-longer-fills-the-column)).
2. **A new Outline box lists the open file's headings (S-5).** Typing `## Pricing` into the post makes "Pricing" appear
   in the box, one step in. The box fills the rest of the column. These do not appear: a `######` heading, a heading
   inside a quote or a list, and a heading with no text. With no file open, the box says "No file open." With a file
   that has no headings, it says "No headings in this file."
   ([D-12](artifacts/change-decision-log.md#d-12-behavior-gate--a-new-outline-box-lists-the-open-files-headings)).

## Change Units

### Unit 1: List a document's headings

**What it does.** Adds `Heading` and `headingsOf` to the editor module, with one test per rule: levels 1 to 5 kept
and 6 dropped, nested headings skipped, fenced code ignored, setext headings kept, empty and image-only headings
skipped, and marked text flattened. Tests go in `markdown-editor.test.tsx`, which already builds documents with
`docFromMarkdown`.

**Delta entries.** S-1

**How you know it worked.** The new tests pass; nothing else changes.

### Unit 2: Give the left column a wrapper and share the box rules

**What it does.** Wraps `PostPanel` in `.left-column` in `App`, moves the Files structure rules into `styles.css`, and
moves the outer margin from `.files` to `.left-column`. Files keeps filling the column for now (`flex: 1` on `.files`
until Unit 4), so the page looks the same.

**Delta entries.** S-2, S-3

**How you know it worked.** The existing suite passes, including the `aside.files` lookups in `app.test.tsx`. In the
running app, the Files box, its drag bar, and its scrolling look and behave as before.

### Unit 3: Build the Outline box

**What it does.** Adds `src/ui/documents/headings-panel/` with the component, its list CSS, and tests, and appends
`.headings` to the shared selector lists. The tests cover the no-file hint, the no-headings hint, a list with
indent levels, and a re-render after `replaceMarkdown` showing a new heading. Nothing renders it yet.

**Delta entries.** S-5 (component only)

**Ordering constraint.** After Unit 1 (it calls `headingsOf`) and Unit 2 (it uses the shared rules).

**How you know it worked.** The new component tests pass; the app is unchanged.

### Unit 4: Show the Outline box and fit Files to its list

**What it does.** Renders `HeadingsPanel` inside `.left-column` with `docs.doc`, and changes `.files` to
`flex: 0 1 auto; min-height: 80px` and `.headings` to `flex: 1 1 auto; min-height: 80px`. In `app.test.tsx`, the test
that checks which panels show on each page gains the Outline box, and a new test checks that a Claude edit
(`afterTurn(finishedTurn({ edited }))`) changes the Outline list. That second test pins the reliance on App re-rendering
([D-5](artifacts/change-decision-log.md#d-5-the-headings-are-recomputed-on-every-render-with-no-memo)).

**Delta entries.** S-4, S-5 (mounting)

**Ordering constraint.** After Unit 3. Fitting Files and showing the Outline box land together, so the column never
shows a short Files box above empty space.

**How you know it worked.** The suite passes. In the running app: Files ends below its last row; the Outline box fills
the rest; typing a heading in either view shows it at once; a long research list scrolls inside Files while the Outline
keeps its title in view; the drag bar still runs the full height of the column.

## Risks

- **The layout is unverified in a browser.** Every height and scroll claim rests on CSS rules; the tests run in
  happy-dom, which does no layout. Unit 2 and Unit 4 each end with a look in the running app (`bun run server`). The blast
  radius is the left column only.
- **Typing in a very long post may slow down.** The headings are recomputed on every keystroke. That costs about 0.3 ms
  on a 15 KB post, but a 100 KB post was never measured
  ([C-12](artifacts/current-state-findings.md#c-12-the-cost-on-a-very-large-post-is-unmeasured), Unverified). Typing
  in the largest real post in the workspace during Unit 4 will show it. The fix is the version-keyed cache deferred
  below.
- **The editor's popups could be misplaced** if `position`, `transform`, `contain`, or `overflow` is added to
  `.left-column` or `.headings`. The comment in `styles.css` names both after Unit 2. Opening a Files row's "…" menu
  after Unit 4 checks it.

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

## Cut for Scope

- **Clicking a heading to jump to it in the editor.** It would scroll the editor to that heading and place the cursor
  there. The accepted area makes the Outline display-only: "Out of scope unless asked for: clicking a heading in the
  Outline box to jump to it" ([artifacts/scope-boundary.md](artifacts/scope-boundary.md)). Reinstating it would add a
  position to each `Heading` and a way for the panel to reach the editor.

## Open Items

None.

## Review Findings

The review round has not run yet.

# Current State Findings: Files Panel Fit and Outline

## Provenance

This run's own discovery round. `han-core:structural-analyst` and `han-core:behavioral-analyst` were given the left
column's layout (`src/ui/app.tsx`, `src/ui/styles.css`), the Files panel (`src/ui/documents/post-panel/*`), the
documents hook (`src/ui/documents/documents/documents.tsx`), the editor's Yjs helpers
(`src/ui/documents/markdown-editor/markdown-editor.tsx`), the shared markdown schema (`src/shared/markdown.ts`), and the
panel resizer (`src/ui/components/panel-resizer/*`). No prior findings report exists. `han-core:concurrency-analyst` was
not dispatched: the area has no concurrent access beyond React's render cycle. The run's own sweep verified the items
the analysts marked unverified (C-7, C-8, C-10).

## Project Context

- **Stack:** TypeScript, React 19, ProseMirror with y-prosemirror 1.3.7 over Yjs, prosemirror-markdown's CommonMark
  schema extended in `src/shared/markdown.ts`. Tests run under `bun test` with happy-dom and Testing Library.
- **Conventions source:** none found. No CLAUDE.md or `project-discovery.md`. Conventions are read from the code:
  feature folders under `src/ui/` (`documents/`, `chat/`, `components/`), each component beside its `.css` and
  `.test.tsx`, and small pure modules in `src/shared/` beside a `.test.ts`. `src/ui/app.tsx:1-2` says it is "the only
  file that knows about more than one feature".
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** over the last 90 days, `src/ui/app.tsx` changed in 44 commits, `src/ui/styles.css` in 19, and
  `src/ui/documents/post-panel/*` in 3 to 5 each. The four commits before this run sized and headed the Files panel
  (`ce248b5` "Head the file panel with "Files" over a one-pixel line", `8fa36e1`, `1d18dec`). Plan
  `docs/changes/header-full-width-boxed-panels/` boxed the panels.

## Gaps

- No ADR, coding standard, CLAUDE.md, or `project-discovery.md`.
- No existing function extracts headings from a document, on either the server or the UI.
- No measurement of heading extraction on a very large post. A probe on a synthetic 2,000-paragraph document stalled for
  more than 60 seconds while building the test document, and the cause was not found (C-12).

## Findings

### C-1: The left column is one grid cell holding the Files box

- **Claim:** `PostPanel`'s `<aside>` and its `PanelResizer` are direct children of `.main`, a one-row grid. Column 1 is
  the Files box, column 2 is the drag bar, column 3 is the editor. A second sibling would take the editor's slot.
- **Location:** `src/ui/app.tsx` `App` return (the `postPanel &&` fragment); `src/ui/styles.css` `.main` rules.
- **Evidence:**
  ```tsx
  {postPanel && (
    <>
      <PostPanel docs={docs} busy={chat.busy} />
      <PanelResizer label="Resize the post panel" width={treeWidth} min={120} max={600} onResize={setTreeWidth} />
    </>
  )}
  ```
  ```css
  .main { display: grid; grid-template-columns: var(--tree-width) auto 1fr auto var(--agent-width); min-height: 0; }
  .main.landing.with-post-panel { grid-template-columns: var(--tree-width) auto 1fr; }
  ```
- **Raised by:** structural-analyst S1
- **Confidence:** Verified
- **Bears on:** S-3, D-1

### C-2: The Files box fills the row's height because grid items stretch

- **Claim:** `.files` has no `align-self`, so it stretches to the full height of `.main`'s single row. Its inner grid
  gives the body a `1fr` row that scrolls. The drag bar beside it also stretches, which makes it a full-height strip.
- **Location:** `src/ui/documents/post-panel/post-panel.css` lines 1-5; `src/ui/components/panel-resizer/panel-resizer.css`.
- **Evidence:**
  ```css
  /* The "Files" header stays put above a line across the panel; the documents beneath it scroll. */
  .files { display: grid; grid-template-rows: auto 1fr; min-height: 0; }
  .files-head { padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .files-head h2 { margin: 0; }
  .files-body { padding: 10px; overflow: auto; min-height: 0; }
  ```
  ```css
  .panel-resizer { width: 8px; z-index: 1; cursor: col-resize; touch-action: none; }
  ```
- **Raised by:** structural-analyst S2, S3
- **Confidence:** Verified
- **Bears on:** S-2, S-3, D-2

### C-3: The box chrome, margins, and the heading style are shared with the chat panel in styles.css

- **Claim:** The border, radius, and background of `.files` and `.side`, and their `h2` style, are one selector list in
  `styles.css`. The 8px margin sits on `.files` itself. A comment forbids `position`, `transform`, and `contain` on
  either box, because they would misplace the editor's popups.
- **Location:** `src/ui/styles.css` lines 112-118.
- **Evidence:**
  ```css
  .files h2, .side h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 4px 0 8px; }
  /* The post panel and the chat each draw as a box, 8px in from the window and the header. The gap on the editor's side
     is the drag bar's 8px width, in components/panel-resizer/panel-resizer.css. No overflow on .side, which would clip
     the model picker, and no position, transform, or contain on either, which would misplace the editor's popups. */
  .files, .side { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
  .files { margin: 8px 0 8px 8px; }
  ```
- **Raised by:** structural-analyst S2, S4
- **Confidence:** Verified
- **Bears on:** S-2, S-3, D-3

### C-4: Files' row and list rules are scoped to `.files`

- **Claim:** The list, row, highlight, and "…" rules in `post-panel.css` all start with `.files`, so markup outside the
  `.files` box does not pick them up.
- **Location:** `src/ui/documents/post-panel/post-panel.css` lines 13-31.
- **Evidence:**
  ```css
  .files ul { list-style: none; margin: 0; padding: 0; }
  .files .tree { width: max-content; min-width: 100%; }
  .files .row { display: flex; align-items: center; }
  ```
- **Raised by:** structural-analyst S4
- **Confidence:** Verified
- **Bears on:** S-4

### C-5: `PostPanel` takes a narrow `PostPanelDocs` and imports nothing from the editor

- **Claim:** `PostPanel` declares the slice of the documents hook it needs as `PostPanelDocs`. It imports from
  `shared/`, `components/`, and `documents/components/post-dialogs`, and from neither `markdown-editor` nor `documents`.
- **Location:** `src/ui/documents/post-panel/post-panel.tsx` lines 3-27.
- **Evidence:**
  ```ts
  import { documentKey, parseDocumentKey, postOfKey } from '../../../shared/document-key';
  import type { PostDocuments } from '../../../shared/wire';
  ...
  export interface PostPanelDocs extends PostDialogsDocs {
    current?: string;
  ```
- **Raised by:** structural-analyst S5
- **Confidence:** Verified
- **Bears on:** S-4, D-4

### C-6: The documents hook exposes the open file's Y.Doc and re-renders App on every change to it

- **Claim:** `useDocuments` returns `doc: entry?.doc`, the open file's Y.Doc. Every Y.Doc update calls `rerender()`, so
  App, and every panel it passes `docs` to, re-renders once per keystroke. The Y.Doc object stays the same across edits,
  so a memo keyed on it alone goes stale.
- **Location:** `src/ui/documents/documents/documents.tsx` `track` (lines 99-105) and the hook's return (line 757).
- **Evidence:**
  ```ts
  const track = (name: string, entry: Entry) => {
    entry.doc.on('update', () => {
      entry.dirty = true;
      rerender();
    });
    opened.current.set(name, entry);
  };
  ```
  ```ts
    doc: entry?.doc,
  ```
- **Raised by:** structural-analyst S6; behavioral-analyst 1, 8
- **Confidence:** Verified
- **Bears on:** S-1, S-4, D-5

### C-7: Both views write the Y.Doc as the writer types; AI edits and disk sync re-render too

- **Claim:** Formatted view writes through `ySyncPlugin`. Markdown view's `typeRaw` sets its text and then dispatches
  the same change into the still-mounted ProseMirror view, which writes the Y.Doc in the same call. AI merges
  (`applyEditedNow`) end with an unconditional `rerender()`. Disk sync and Undo all call `replaceMarkdown`, whose update
  fires the `track` listener. A raw edit that parses to the same document (trailing whitespace) dispatches nothing,
  which cannot change any heading.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.tsx` `typeRaw` (lines 861-871), `ySyncPlugin` mount
  (line 676); `documents.tsx` `applyEditedNow` (line 499), `followDisk` (lines 295-301).
- **Evidence:**
  ```ts
  const typeRaw = (markdown: string) => {
    setText(markdown);
    const editor = view.current;
    if (!editor) return;
    typing.current = true;
    try {
      replaceInView(editor, markdown);
    } finally {
      typing.current = false;
    }
  };
  ```
- **Raised by:** behavioral-analyst 2
- **Confidence:** Verified by reading the code. That y-prosemirror writes the Y.Doc synchronously on dispatch rests on
  the library's documented behavior; no browser was run.
- **Bears on:** S-1, D-5

### C-8: Reading the Y.Doc as a ProseMirror node needs a helper inside markdown-editor

- **Claim:** `fragmentOf` is file-private, so only `markdown-editor.tsx` knows the Yjs key (`'prosemirror'`) the content
  lives under. `markdownOf` converts the fragment to a ProseMirror node and then serializes it, and is the only exported
  reader.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.tsx` lines 45-56.
- **Evidence:**
  ```ts
  // The Yjs type each document's content lives in.
  const fragmentOf = (doc: Y.Doc) => doc.getXmlFragment('prosemirror');
  ...
  export function markdownOf(doc: Y.Doc): string {
    return serializer.serialize(yXmlFragmentToProseMirrorRootNode(fragmentOf(doc), schema));
  }
  ```
- **Raised by:** structural-analyst S8; behavioral-analyst 3
- **Confidence:** Verified
- **Bears on:** S-1, D-4

### C-9: Converting to a node and walking it is about ten times cheaper than serializing and re-parsing

- **Claim:** On a synthetic 15 KB post (300 paragraphs, 15 headings), `yXmlFragmentToProseMirrorRootNode` took about
  0.3 ms and the walk under 0.01 ms. `parseMarkdown(markdownOf(doc))` took about 3.1 ms. Markdown view already runs
  `markdownOf` on every external update.
- **Location:** probe against `src/shared/markdown.ts` and y-prosemirror 1.3.7 (deleted afterwards); markdown-editor.tsx
  lines 820-826.
- **Evidence:**
  ```ts
    const changed = () => {
      if (!typing.current) setText(markdownOf(doc));
    };
    doc.on('update', changed);
  ```
- **Raised by:** behavioral-analyst 4
- **Confidence:** Verified for the 15 KB case. See C-12 for larger posts.
- **Bears on:** D-5

### C-10: The parser decides what a heading is; fences and indented code never become headings

- **Claim:** The schema is prosemirror-markdown's CommonMark `heading` (`attrs.level`, a number 1-6, content
  `(text | image)*`). `# in fence`, `    # indented`, and `#nospace` parse to `code_block` or paragraph nodes, never
  `heading`. Setext headings (`===`, `---`) parse as level 1 and 2 headings. Headings inside a blockquote or a list item
  are `heading` nodes nested below the top level, which `descendants` visits and a top-level `forEach` does not.
- **Location:** `node_modules/prosemirror-markdown/dist/index.js` lines 29-31 and 357; `src/shared/markdown.ts` line 21.
- **Evidence:**
  ```js
  heading: {
      attrs: { level: { default: 1, validate: "number" } },
      content: "(text | image)*",
  ```
  ```js
  heading: { block: "heading", getAttrs: tok => ({ level: +tok.tag.slice(1) }) },
  ```
  Probe output, as (position, parent, level, text):
  ```
  0 doc 1 "A code em link  b"        # ATX
  27 doc 1 "Setext"                 # setext ===
  35 doc 2 "Sub"                    # setext ---
  53 blockquote 2 "quote"           # "> ## quote"
  63 list_item 2 "in list"          # "- ## in list"
  74 doc 6 "six"
  101 doc 1 ""                      # "# " empty
  ```
- **Raised by:** behavioral-analyst 5; level attribute confirmed by this run's sweep
- **Confidence:** Verified
- **Bears on:** S-1, D-6, D-7

### C-11: A heading's `textContent` keeps marked text, drops images, and is not trimmed

- **Claim:** For `` # A `code` *em* [link](http://x) ![img](a.png) b `` the text is `"A code em link  b"`. Code,
  emphasis, and link text survive as plain text. An image contributes nothing, leaving a double space. `# ` gives `""`.
- **Location:** ProseMirror `Node.textContent`, as probed.
- **Evidence:** see C-10's probe output, first and last rows.
- **Raised by:** behavioral-analyst 6
- **Confidence:** Verified
- **Bears on:** S-1, D-7

### C-12: The cost on a very large post is unmeasured

- **Claim:** A probe on a synthetic 2,000-paragraph (about 100 KB) document stalled for more than 60 seconds. It was
  not established whether building the probe document or converting it was slow.
- **Location:** behavioral-analyst probe, deleted afterwards.
- **Evidence:** none kept; the analyst reported the stall and did not isolate it.
- **Raised by:** behavioral-analyst 4
- **Confidence:** Unverified: the slow step was never isolated.
- **Bears on:** D-5, Risks

### C-13: Which file `docs.doc` is in each state

- **Claim:** `docs.doc` is the open file's Y.Doc, which can be a post, its outline document, or a research document.
  It is undefined on the landing page, before a reload's restore finishes, and after the open file is closed. `open`
  loads before it shows, so `docs.doc` never names an unloaded file. A post that is gone from disk but still open keeps
  its Y.Doc. The left column also shows on the landing page while unsaved documents have nowhere to be saved, and there
  `docs.doc` is undefined.
- **Location:** `src/ui/documents/documents/documents.tsx` line 736; `src/ui/app.tsx` lines 124-125.
- **Evidence:**
  ```ts
  const entry = current === undefined ? undefined : opened.current.get(current);
  ```
  ```ts
  const landing = docs.current === undefined;
  const postPanel = !landing || docs.missing.length > 0;
  ```
- **Raised by:** behavioral-analyst 7; structural-analyst S9
- **Confidence:** Verified
- **Bears on:** S-3, D-8

## Findings No Agent Could Audit

No browser was run. The rendered layout, meaning the boxes' heights, the drag bar's reach, and scrolling, is inferred
from CSS rules and was not observed. A run of the app (the `run` skill, or `bun run server`) closes this. The
large-post cost in C-12 is the other gap.

# Change Decision Log: Files Panel Fit and Outline

This file records every decision committed while planning the Files panel fit and the Outline panel. The plan itself
lives in [../change-plan.md](../change-plan.md). This file captures the question, rationale, evidence, and rejected
alternatives behind each decision. Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

The user asked for the run to settle escalations without asking ("make the best decisions you can, without asking me",
recorded as a standing preference for han planning runs). Every decision below that would otherwise have gone to the
user says so in its Evidence field, and every behavior change is listed in the plan's Behavior Changes section.

## Trivial decisions

- D-13: Indentation per level — each heading level below 1 indents a further 12px, set from a `--level` custom property
  on the row. — Referenced in plan: Target State.
- D-14: List keys — the headings list is keyed by index; it is display-only and holds no per-row state. — Referenced in
  plan: Target State.
- D-15: Long heading text wraps onto further lines rather than being cut off with an ellipsis, so no text is hidden. —
  Referenced in plan: Target State.

## Full decisions

### D-1: The left column becomes a wrapper holding both boxes

- **Question:** How do two boxes share the left column without disturbing the editor's grid slot or the drag bar?
- **Decision:** `App` wraps `PostPanel` and the new `HeadingsPanel` in `<div className="left-column">`. The wrapper is
  the only item in `.main`'s first grid column; `PanelResizer` stays a sibling in column 2. The grid templates in
  `styles.css` do not change.
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
- **Rationale:** A second sibling in `.main` would take the editor's grid slot. The wrapper keeps the drag bar a
  full-height grid item beside the whole column. Column layout is cross-feature composition, which belongs in `app.tsx`.
- **Evidence:** [C-1](current-state-findings.md#c-1-the-left-column-is-one-grid-cell-holding-the-files-box),
  [C-2](current-state-findings.md#c-2-the-files-box-fills-the-rows-height-because-grid-items-stretch); `app.tsx:1-2`;
  software-architect A3. No test indexes `.main`'s children (`app.test.tsx` finds the panel by `aside.files`).
- **Behavior impact:** Preserving on its own: with `.files` filling the wrapper, the page looks as it does today.
- **Rejected alternatives:**
  - Add `grid-template-rows` to `.main` and place both boxes in column 1 — rejected because the editor, the drag bars,
    and the chat would all need row spans, spreading the change across every `.main` child.
  - Put the headings box inside `PostPanel`'s `<aside>` — rejected per D-4's ownership reasoning and because it widens
    `PostPanelDocs` with a field the file tree does not use
    ([C-5](current-state-findings.md#c-5-postpanel-takes-a-narrow-postpaneldocs-and-imports-nothing-from-the-editor)).
- **Revisit criterion:** A third box joins the left column, or the column needs its own resize between boxes.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** D-2, D-10
- **Referenced in plan:** Target State, Surface Delta, Change Units

### D-2: Files is as tall as its list, shrinks and scrolls when the list is long, and keeps a floor

- **Question:** How does the Files box fit its content, and what happens when its list is longer than the column?
- **Decision:** `.left-column` is a flex column (`display: flex; flex-direction: column; gap: 8px; margin: 8px 0 8px
  8px; min-height: 0`). It takes over the 8px margin `.files` carries today. `.files` gets `flex: 0 1 auto` and
  `min-height: 80px`, and keeps its `auto 1fr` inner grid, so its body scrolls once the box is shrunk. The headings box
  takes the rest (D-10).
- **Rationale:** `flex: 0 1 auto` makes the box its content height when there is room and lets it shrink when there is
  not. The existing scrolling body ([C-2](current-state-findings.md#c-2-the-files-box-fills-the-rows-height-because-grid-items-stretch))
  keeps working once the box is height-constrained. The 80px floor is the head (about 37px) plus about two rows, so
  neither box shrinks below its title.
- **Evidence:** C-2, C-3; software-architect A4. Unverified: no browser was run, so the rendered heights rest on the CSS
  rules and need one look in the running app.
- **Behavior impact:** Changing, through S-4 (see D-11).
- **Rejected alternatives:**
  - `max-height: 50%` on Files — rejected because a short Outline would then leave Files cut off at half the column for
    no reason.
  - `align-self: start` on `.files` inside the current grid with no wrapper — rejected because it leaves nowhere to put
    the second box (D-1).
- **Revisit criterion:** A writer with a long research list finds the Outline squeezed too small to use.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** D-10, D-11
- **Referenced in plan:** Target State, Surface Delta, Risks

### D-3: Box chrome and head/body structure are shared through the existing selector lists

- **Question:** How does the headings box get the Files box's look without copying its rules?
- **Decision:** The structural rules move from `post-panel.css` into `styles.css` and become selector lists that name
  both boxes: `.files, .headings` for the inner grid; `.files-head, .headings-head` for the head;
  `.files-head h2, .headings-head h2`; `.files-body, .headings-body`; `.files .hint, .headings .hint`. The existing chrome
  lists gain the new box: `.files, .side, .headings` and `.files h2, .side h2, .headings h2`. The list and row rules
  stay in `post-panel.css`, scoped to `.files`. The no-`position`/`transform`/`contain` comment extends to name
  `.left-column` and `.headings`.
- **Rationale:** The chrome is already shared through a selector list, so extending it follows precedent. The `.files`
  scoping of row rules keeps the headings list from picking them up.
- **Evidence:** [C-3](current-state-findings.md#c-3-the-box-chrome-margins-and-the-heading-style-are-shared-with-the-chat-panel-in-stylescss),
  [C-4](current-state-findings.md#c-4-files-row-and-list-rules-are-scoped-to-files); software-architect A4.
- **Behavior impact:** Preserving. `.post-panel` and `.files` are the same element, so `.post-panel .hint` becoming
  `.files .hint` matches the same element.
- **Rejected alternatives:**
  - A generic `.panel-box`/`.panel-head`/`.panel-body` class set — rejected under YAGNI: the selector-list precedent does
    the same job, and renaming would touch `.side` and `.files` markup with no friction measured.
  - Copy the rules into `headings-panel.css` — rejected as duplicating one concept in two files.
- **Revisit criterion:** A fourth box appears, or the selector lists drift out of step.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Surface Delta, Deferred (YAGNI)

### D-4: `headingsOf` lives in `markdown-editor.tsx`, beside `markdownOf`

- **Question:** Which module turns the open file's Y.Doc into a list of headings?
- **Decision:**
  ```ts
  // markdown-editor.tsx, below markdownOf
  export type Heading = { level: 1 | 2 | 3 | 4 | 5; text: string };
  export function headingsOf(doc: Y.Doc): Heading[];
  ```
  It converts the fragment with `yXmlFragmentToProseMirrorRootNode(fragmentOf(doc), schema)` and walks the root's direct
  children, keeping `heading` nodes with `attrs.level <= 5`, applying D-6 and D-7. Worked example: the markdown
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
  gives `[{ level: 1, text: 'A code em b' }, { level: 1, text: 'Setext' }]`.
- **Rationale:** Only `markdown-editor.tsx` knows the Yjs key the content lives under, and every Y.Doc reader already
  lives there. Walking the node is about ten times cheaper than serializing and re-parsing.
- **Evidence:** [C-8](current-state-findings.md#c-8-reading-the-ydoc-as-a-prosemirror-node-needs-a-helper-inside-markdown-editor),
  [C-9](current-state-findings.md#c-9-converting-to-a-node-and-walking-it-is-about-ten-times-cheaper-than-serializing-and-re-parsing),
  [C-10](current-state-findings.md#c-10-the-parser-decides-what-a-heading-is-fences-and-indented-code-never-become-headings);
  software-architect A1.
- **Behavior impact:** Preserving. Nothing calls it until S-5.
- **Rejected alternatives:**
  - A pure `headings(root)` in `src/shared/` with a duck-typed node, after `blocks.ts` — rejected under YAGNI: there is no
    server caller, so it would be an abstraction with one caller.
  - `parseMarkdown(markdownOf(doc))` in the panel — rejected for cost (C-9).
  - A regex over the markdown text — rejected because it would have to re-implement fence and setext rules the parser
    already applies (C-10).
  - Export `fragmentOf` and walk in the panel — rejected because it spreads the Yjs key across two modules.
- **Revisit criterion:** The server needs headings, for example an AI tool that reads a post's structure; then the walk
  moves to `src/shared/`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** D-5, D-6, D-7
- **Referenced in plan:** Target State, Surface Delta, Deferred (YAGNI)

### D-5: The headings are recomputed on every render, with no memo

- **Question:** How does the headings list stay live, and does it need caching?
- **Decision:** `HeadingsPanel` calls `headingsOf(doc)` in its render. It has no `useMemo` and no subscription of its
  own; it relies on `useDocuments` re-rendering App on every Y.Doc update. One App-level test pins that reliance.
- **Rationale:** App already re-renders on every update from either view, from AI merges, and from disk sync. A memo keyed
  on `doc` would go stale, because the Y.Doc keeps its identity across edits. Keying on a version counter would add a
  field to the hook for a cost measured at about 0.3 ms.
- **Evidence:** [C-6](current-state-findings.md#c-6-the-documents-hook-exposes-the-open-files-ydoc-and-re-renders-app-on-every-change-to-it),
  [C-7](current-state-findings.md#c-7-both-views-write-the-ydoc-as-the-writer-types-ai-edits-and-disk-sync-re-render-too),
  [C-9](current-state-findings.md#c-9-converting-to-a-node-and-walking-it-is-about-ten-times-cheaper-than-serializing-and-re-parsing);
  software-architect A2. Large posts are unmeasured
  ([C-12](current-state-findings.md#c-12-the-cost-on-a-very-large-post-is-unmeasured), Unverified).
- **Behavior impact:** Preserving for everything outside the new box.
- **Rejected alternatives:**
  - A `version` field on the hook's return and a `useMemo` keyed on it — rejected under YAGNI: no measured cost.
  - The panel subscribes to `doc.on('update')` itself — rejected as a second path to the same signal App already has.
- **Revisit criterion:** Typing in a long post feels slow, or a measurement shows the conversion above about 5 ms per
  keystroke, or App stops re-rendering on Y.Doc updates.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Risks, Deferred (YAGNI)

### D-6: Only top-level headings are listed

- **Question:** Does a heading inside a blockquote (`> ## quote`) or a list item (`- ## item`) appear in the Outline?
- **Decision:** No. `headingsOf` walks only the document's direct children.
- **Rationale:** A heading inside a quote is quoted material, and one inside a list item is list content. Neither divides
  the writer's document into sections, which is what an outline shows. The top-level walk is also the simpler one.
- **Evidence:** [C-10](current-state-findings.md#c-10-the-parser-decides-what-a-heading-is-fences-and-indented-code-never-become-headings)
  (the probe shows both nested cases parse as `heading` nodes). Settled under the user's delegation rather than
  escalated.
- **Behavior impact:** Changing, as part of what the new box shows (S-5, D-12).
- **Rejected alternatives:**
  - `descendants`, listing every heading node — rejected because a quoted `## Chapter` from another work would appear as
    a section of the writer's post.
- **Revisit criterion:** The writer expects a quoted or listed heading in the Outline.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Behavior Changes

### D-7: Heading text is tidied, and empty headings are skipped

- **Question:** What text does the Outline show for a heading with marks, images, or nothing in it?
- **Decision:** The text is the heading's `textContent` with whitespace runs collapsed to one space and the ends
  trimmed. A heading whose text is then empty, such as `# ` or an image-only heading, is left out.
- **Rationale:** Code, emphasis, and link text show as plain text. An image leaves a double space, which the collapse
  repairs. An empty row in the Outline says nothing and would flicker in while the writer types `# ` before the first
  letter.
- **Evidence:** [C-11](current-state-findings.md#c-11-a-headings-textcontent-keeps-marked-text-drops-images-and-is-not-trimmed);
  software-architect A1. Settled under the user's delegation.
- **Behavior impact:** Changing, as part of what the new box shows (S-5, D-12).
- **Rejected alternatives:**
  - Show an empty heading as "(untitled)" — rejected: it adds a word the writer never typed.
  - Use an image's alt text — rejected: it needs a custom walk for a rare case.
- **Revisit criterion:** A writer uses image-only headings and expects them listed.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Behavior Changes

### D-8: The headings box always shows beside Files, with a hint when it has nothing to list

- **Question:** What does the box show when no file is open, or the open file has no headings?
- **Decision:** The box renders whenever the left column does. With `doc` undefined it shows the hint "No file open."
  With no headings it shows "No headings in this file." Both use the shared `.hint` style.
- **Rationale:** The left column also shows on the landing page while unsaved documents have nowhere to be saved, and
  before a reload's restore finishes; `docs.doc` is undefined in both. Keeping the box steady avoids the column changing
  shape as files open. The Files box already shows "No post open." in the same situation.
- **Evidence:** [C-13](current-state-findings.md#c-13-which-file-docsdoc-is-in-each-state); `post-panel.tsx` hint text;
  software-architect A2. Settled under the user's delegation.
- **Behavior impact:** Changing, as part of the new box (S-5, D-12).
- **Rejected alternatives:**
  - Hide the box when there is nothing to list — rejected: the Files box would jump to fill the column and back each time
    the writer moves between files with and without headings.
- **Revisit criterion:** The landing-page case (missing documents only) reads as clutter.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Behavior Changes

### D-9: The component is `HeadingsPanel`; only its title says "Outline"

- **Question:** What do the code names call the new box, given the codebase already says "outline" for other things?
- **Decision:** The component is `HeadingsPanel` in `src/ui/documents/headings-panel/` (`headings-panel.tsx`, `.css`,
  `.test.tsx`). Its classes are `.headings`, `.headings-head`, and `.headings-body`. Its visible `<h2>` is "Outline", as
  the user asked.
- **Rationale:** "Outline" already names each post's outline document (`documentKey({ kind: 'outline' })`, `outlineKey`,
  `hasOutline` in `post-panel.tsx`, the "Outline" row in Files) and the highlight outline
  (`highlight-outline.ts`, `layout.outline` in the editor tests). An `OutlinePanel` would read as the panel for the
  outline document.
- **Evidence:** grep of `src/` during this run; [C-5](current-state-findings.md#c-5-postpanel-takes-a-narrow-postpaneldocs-and-imports-nothing-from-the-editor).
- **Behavior impact:** Preserving. A name only; the visible title is unchanged from the request.
- **Rejected alternatives:**
  - `OutlinePanel` and `.outline`, the architect's proposal — rejected for the collision above.
  - `TocPanel` — rejected: "table of contents" is not a term the product uses.
- **Revisit criterion:** The post's outline document is renamed, freeing the word.
- **Dissent (if any):** Software-architect A2 proposed `OutlinePanel`; overridden on the naming evidence alone.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-3
- **Referenced in plan:** Target State, Surface Delta

### D-10: The headings box takes the rest of the column

- **Question:** Is the headings box also as tall as its content, or does it fill what Files leaves?
- **Decision:** `.headings` gets `flex: 1 1 auto` and `min-height: 80px`, so it fills the rest of the column and its
  body scrolls when the list is longer. The left column's bottom edge lines up with the chat box's.
- **Rationale:** The request names only Files as shrinking. Filling the rest keeps the column's bottom edge level with
  the chat box, as it is today, and gives a long outline the most room.
- **Evidence:** user request (scope record); D-2; software-architect A4. Settled under the user's delegation.
- **Behavior impact:** Changing, as part of the new box (S-5, D-12).
- **Rejected alternatives:**
  - Both boxes fit their content, leaving empty space at the bottom of the column — rejected: the column would end at a
    different height from the chat box for every file.
- **Revisit criterion:** The user wants both boxes to fit their content.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Behavior Changes

### D-11: Behavior gate — the Files box no longer fills the column

- **Question:** S-4 changes what the writer sees: the Files box ends below its last row instead of at the window's
  bottom. Is that accepted?
- **Decision:** Accepted. It is the change the user asked for.
- **Rationale:** The request says "have the Files sidebar vertically shrink to fit the content".
- **Evidence:** user request, quoted in the scope record; settled under the user's delegation.
- **Behavior impact:** Changing. A writer with one post, its outline, and two research documents sees a short Files box
  with the Outline box directly below it. A writer with many research documents sees Files shrink to share the column,
  with its list scrolling.
- **Rejected alternatives:** None; the request fixes it.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** None
- **Referenced in plan:** Behavior Changes

### D-12: Behavior gate — a new Outline box lists the open file's headings

- **Question:** S-5 adds a box the writer sees, with the rules in D-6, D-7, D-8, and D-10. Are they accepted?
- **Decision:** Accepted, with those rules.
- **Rationale:** The box itself is the request. Its edge-case rules were settled under the user's delegation and are
  surfaced in the plan's Behavior Changes section for the user to overturn.
- **Evidence:** user request; D-6, D-7, D-8, D-10.
- **Behavior impact:** Changing. Typing `## Pricing` in the post makes "Pricing" appear in the Outline box, indented
  one step. A `######` heading, a heading inside a quote or list, and an empty `# ` do not appear.
- **Rejected alternatives:** None beyond those in D-6, D-7, D-8, and D-10.
- **Revisit criterion:** The user overturns any of D-6, D-7, D-8, or D-10.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** None
- **Referenced in plan:** Behavior Changes

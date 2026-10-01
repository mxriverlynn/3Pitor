# Current State Findings: Raw Markdown Syntax Highlighting

## Provenance

Produced by this run's own discovery round on 2026-10-01. No prior findings report existed.

- `han-core:structural-analyst` and `han-core:behavioral-analyst`, dispatched in parallel over
  `src/ui/documents/markdown-editor/raw-view.tsx`, `markdown-editor.css`, `markdown-editor.tsx` (raw-mode wiring),
  `raw-formatting.ts`, `src/shared/markdown.ts`, and `src/ui/styles.css`.
- `han-core:concurrency-analyst` was not dispatched: the area is single-threaded React rendering with no shared mutable
  state beyond component state.
- The run verified C-6 itself by running markdown-it 14 against a sample document.

## Project Context

- **Stack:** TypeScript, React 19, ProseMirror (prosemirror-markdown, prosemirror-menu), Yjs, markdown-it 14, Bun
  (test runner `bun test` with happy-dom and Testing Library; `make` targets). Read from `package.json`.
- **Conventions source:** none found. There is no CLAUDE.md, AGENTS.md, or project-discovery.md. Conventions come from
  the code: plain-language comments above each function, one CSS file per component, element-scoped selectors under
  `.rich-editor`.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found. `.claude/skills/update-code-structure/SKILL.md` sets the layout rule: package,
  then feature, then component. A new raw-mode module belongs in `src/ui/documents/markdown-editor/`.
- **Recent churn (90 days):** `markdown-editor.test.tsx` 45 commits, `markdown-editor.tsx` 40, `raw-formatting.ts` 19,
  `raw-formatting.test.ts` 19, `markdown-editor.css` 15, `styles.css` 7, `raw-view.tsx` 5. The most recent work (PR #20,
  link popup) went through `raw-formatting.ts`'s link scanner.

## Gaps

- No ADR, coding standard, or design-token document defines the color palette. The palette lives only in the CSS
  variables in `src/ui/styles.css` (C-8).
- No test renders layout. Tests run in happy-dom with `offsetTop` of 0, so nothing automated checks that the mirror and
  the textarea wrap identically (C-11).
- No forced-colors handling exists for links, code, or blockquotes in the formatted view (C-9).
- No `caret-color` or `::selection` rule exists anywhere in the editor CSS (C-4).

## Findings

### C-1: The raw view is a textarea over a mirror whose text is invisible

- **Claim:** In raw mode the writer types into a textarea with visible text. A mirror `div` behind it lays out the same
  text in transparent color, and only the backgrounds of its `<mark>` elements show through the textarea.
- **Location:** `src/ui/documents/markdown-editor/raw-view.tsx` (header comment, `RawView` return);
  `markdown-editor.css` raw-mode rules.
- **Evidence:**
  ```tsx
  // A textarea cannot mark its text, so a
  // mirror of it, laid out the same way, sits behind it: its text is invisible and only its marks show through.
  ...
  <div className="raw-mirror raw-text" ref={mirror} aria-hidden="true">
    {mirrorPieces(text, marks, showButton ? asked.from : undefined)}
    {'​'}
  </div>
  <textarea className="raw-markdown raw-text" aria-label="Markdown" ... value={text} />
  ```
  ```css
  .rich-editor .raw-mirror { color: transparent; }
  .rich-editor .raw-markdown {
    position: absolute; inset: 0; z-index: 1; height: 100%; overflow: hidden; outline: none; resize: none;
    background: none; color: var(--text);
  }
  .rich-editor .raw-mirror mark { color: transparent; border-radius: 2px; }
  ```
- **Raised by:** structural-analyst S-2; behavioral-analyst B-4
- **Confidence:** Verified
- **Bears on:** S-5, S-6, D-1

### C-2: Mirror and textarea line up only because they share one metrics rule

- **Claim:** Both elements carry `raw-text`, which fixes font, size, line height, padding, and wrapping. Any inline
  style that changes the width of a character, or adds horizontal padding, margin, or border, makes the mirror wrap
  differently from the textarea. The caret then drifts away from the colored text. Color, background, outline, and a
  bottom border are safe.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.css`, `.rich-editor .raw-text`
- **Evidence:**
  ```css
  .rich-editor .raw-text {
    box-sizing: border-box; width: 100%; margin: 0; padding: 28px 32px 80px; border: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.6; letter-spacing: normal;
    white-space: pre-wrap; overflow-wrap: break-word; tab-size: 4;
  }
  ```
- **Raised by:** structural-analyst S-2; behavioral-analyst B-4
- **Confidence:** Verified for the rule. Unverified for whether bold changes character width in the fallback fonts of
  the monospace stack, because nothing was rendered.
- **Bears on:** S-6, D-3

### C-3: The mirror and textarea scroll as one block

- **Claim:** The mirror is in normal flow and sets the pane's height. The textarea is absolutely positioned over it
  with `overflow: hidden`. The outer `.rich-editor` scrolls, so both move together, with no code keeping them in step.
- **Location:** `markdown-editor.css`, `.raw-pane`, `.raw-markdown`, `.rich-editor`
- **Evidence:**
  ```css
  .rich-editor { flex: 1; min-height: 0; overflow: auto; }
  .rich-editor .raw-pane { position: relative; flex: 1; box-sizing: border-box; width: 100%; max-width: 760px; margin: 0 auto; }
  ```
- **Raised by:** behavioral-analyst B-4
- **Confidence:** Verified from the CSS. Not observed in a browser.
- **Bears on:** S-5

### C-4: Hiding the textarea's text would also hide its caret and its selected text

- **Claim:** No `caret-color` is set, so the caret takes the textarea's text color. No `::selection` rule exists, so
  selected text is drawn in the textarea's own text color. If the textarea's text turns transparent, the caret
  disappears, and selected text shows only whatever lies beneath the browser's selection background.
- **Location:** `markdown-editor.css` (absence of either rule)
- **Evidence:** `grep -n "caret-color\|::selection" src/ui -r` returns nothing.
- **Raised by:** behavioral-analyst B-4
- **Confidence:** Verified that the rules are absent. How each browser paints a selection over transparent text is
  Unverified, because nothing was rendered.
- **Bears on:** S-6, D-4

### C-5: In forced-colors mode the browser overrides transparent text

- **Claim:** In forced-colors mode (Windows High Contrast) the browser replaces text colors with system colors, so
  `color: transparent` does not hold. Raw mode's existing forced-colors block only restyles the marks.
- **Location:** `markdown-editor.css`, `@media (forced-colors: active)` blocks
- **Evidence:**
  ```css
  @media (forced-colors: active) {
    .rich-editor .raw-mirror mark.ai-highlight { background: Mark; border-bottom-color: MarkText; }
    .rich-editor .raw-mirror mark.ask-selection { background: Highlight; }
    .rich-editor .raw-pane .ai-highlight-label { background: CanvasText; color: Canvas; forced-color-adjust: none; }
  }
  ```
- **Raised by:** behavioral-analyst B-4
- **Confidence:** Unverified. This is how forced-colors is specified to behave. It was not observed.
- **Bears on:** S-6, D-5

### C-6: markdown-it gives line ranges for blocks and no positions for anything inside a line

- **Claim:** `parse()` gives each block token a `map` of `[startLine, endLine]`. Inline tokens (links, code spans,
  emphasis) have `map: null`. Character offsets for links and code cannot come from markdown-it. The shared
  `tokenizer` is also private to `src/shared/markdown.ts`.
- **Location:** `src/shared/markdown.ts` (`const tokenizer = MarkdownIt('commonmark', { html: false })`)
- **Evidence:** Run by this skill against `# Hi\n\nA [link](http://x) and \`c\` **b**\n`:
  ```
  heading_open [0,1]
  inline [0,1] text:null
  paragraph_open [2,3]
  inline [2,3] text:null link_open:null text:null link_close:null text:null code_inline:null text:null strong_open:null ...
  ```
- **Raised by:** structural-analyst S-4 (Unverified there); verified by this run
- **Confidence:** Verified
- **Bears on:** D-2

### C-7: `raw-formatting.ts` already finds links and code, with character offsets, in raw text

- **Claim:** The private `scan(text)` returns every link and image, with the positions of its text and address, plus
  every code span and fenced code block. It handles escapes, nested brackets, and unmatched backticks. Line-start
  patterns for headings, quotes, and list items are private constants in the same file.
- **Location:** `src/ui/documents/markdown-editor/raw-formatting.ts`, `scan`, `RawLink`, `HEADING`, `QUOTE`, `LIST`
- **Evidence:**
  ```ts
  type RawLink = { start: number; end: number; text: [number, number]; address: [number, number]; image: boolean };
  function scan(text: string): { links: RawLink[]; code: [number, number][] } {
  ...
  const LIST = /^(\s*)(?:[-*+]|\d+[.)]) (?:\[[ xX]\] )?/;
  const QUOTE = /^> ?/;
  const HEADING = /^#{1,6} /;
  ```
- **Raised by:** structural-analyst S-4
- **Confidence:** Verified
- **Bears on:** S-1, S-2, D-2, D-13

### C-8: The palette is a set of CSS variables with a dark-mode override

- **Claim:** Colors are variables on `:root` in `src/ui/styles.css`, redefined in one `prefers-color-scheme: dark`
  block. Links in the formatted view use `--accent` (`#3b5bdb` light, `#748ffc` dark). No variable exists for heading
  color or syntax markers.
- **Location:** `src/ui/styles.css`
- **Evidence:**
  ```css
  :root { --text: #1d1d1b; --muted: #6b6b66; --accent: #3b5bdb; --accent-soft: #e7ecff; --code: #f1f1ec; --highlight: #fff1a8; ... }
  @media (prefers-color-scheme: dark) { :root { --text: #ecece7; --muted: #9b9b94; --accent: #748ffc; --code: #2a2a27; ... } }
  ```
- **Raised by:** structural-analyst S-3; behavioral-analyst B-7
- **Confidence:** Verified
- **Bears on:** S-3, S-4, D-6

### C-9: The formatted view styles headings, links, code, quotes, and lists only lightly

- **Claim:** Headings get a size and nothing else: no color, no explicit weight, and no rule for `h4`–`h6`. Links get
  `--accent` only. Inline code gets a background and no monospace font. In dark mode the code background (`#2a2a27`)
  sits close to the panel (`#1f1f1d`). Blockquotes get a 3px `--border` rule and muted text. Lists have no rules beyond
  task lists. No forced-colors rule covers links, code, or blockquotes.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.css`, `.rich-editor .ProseMirror` rules
- **Evidence:**
  ```css
  .rich-editor .ProseMirror h1 { font-size: 1.9em; margin: 0.2em 0 0.6em; }
  .rich-editor .ProseMirror h2 { font-size: 1.45em; margin: 1.2em 0 0.5em; }
  .rich-editor .ProseMirror h3 { font-size: 1.2em; margin: 1.1em 0 0.4em; }
  .rich-editor .ProseMirror blockquote { border-left: 3px solid var(--border); margin: 0 0 0.8em; padding-left: 14px; color: var(--muted); }
  .rich-editor .ProseMirror code { background: var(--code); padding: 1px 4px; border-radius: 4px; font-size: 0.9em; }
  .rich-editor .ProseMirror pre { background: var(--code); padding: 12px; border-radius: 6px; overflow: auto; }
  .rich-editor .ProseMirror a { color: var(--accent); }
  ```
- **Raised by:** structural-analyst S-3; behavioral-analyst B-7
- **Confidence:** Verified for the rules. The contrast judgment rests on hex values; nothing was rendered.
- **Bears on:** S-7, D-8

### C-10: RawView re-renders on every keystroke and every caret move, and `mirrorPieces` is not memoized

- **Claim:** `text` is state in `MarkdownEditor`, set on every keystroke. `RawView` also re-renders on every selection
  change and on focus changes. `mirrorPieces` runs inline in JSX on each of those renders. A layout effect with no
  dependency list reads `offsetTop` after every render. Workspace documents found are up to about 12 KB.
- **Location:** `markdown-editor.tsx` (`typeRaw`, `rawMarks` memo); `raw-view.tsx` (`readSelection`, `useLayoutEffect`)
- **Evidence:**
  ```tsx
  const rawMarks = useMemo(() => (raw ? rawHighlights(text, highlights) : []), [raw, text, highlights]);
  ...
  useLayoutEffect(() => {
    const box = mirror.current;
    ...
    setCaretTop(box.querySelector<HTMLElement>('[data-caret]')?.offsetTop);
  });
  ```
- **Raised by:** behavioral-analyst B-1, B-2
- **Confidence:** Verified
- **Bears on:** S-5, D-11

### C-11: Tests read highlight marks one element at a time, so splitting a mark breaks them

- **Claim:** Several tests read each `mark.ai-highlight` or `mark.ask-selection` as one element. Adding syntax cuts to
  `mirrorPieces` would split a highlight such as `Water the **beans**.` into several `<mark>`s and fail those tests.
  Tests and code that join every piece's text survive a split.
- **Location:** `markdown-editor.test.tsx` lines ~1228, ~1285, ~357; `raw-view.tsx` `querySelector('mark.ai-highlight')`;
  `markdown-editor.tsx:798`
- **Evidence:**
  ```ts
  querySelectorAll('.raw-mirror mark.ai-highlight')  // expects ['quick', 'Water the **beans**.']
  querySelector('.raw-mirror mark.ask-selection')!.textContent  // expects '**quick**'
  ```
- **Raised by:** structural-analyst S-5; behavioral-analyst B-5, B-6
- **Confidence:** Verified by reading. The suite was not run.
- **Bears on:** S-5, D-1

### C-12: Formatted-view elements carry no classes, so element selectors style them

- **Claim:** Apart from task lists, the schema renders headings, links, code, quotes, and lists as plain elements, and
  the CSS styles them by element under `.rich-editor .ProseMirror`. AI highlights are `mark.ai-highlight` decorations
  that can sit inside links or code, with `background: var(--highlight); color: inherit`.
- **Location:** `src/shared/markdown.ts` schema; `markdown-editor.css`
- **Evidence:**
  ```css
  .rich-editor .ProseMirror mark.ai-highlight { background: var(--highlight); color: inherit; border-bottom: 2px solid var(--accent); }
  ```
- **Raised by:** behavioral-analyst B-7
- **Confidence:** Verified
- **Bears on:** S-7, D-14

## Findings No Agent Could Audit

Browser rendering. No agent ran the app, so the following were not observed: whether a transparent-text textarea
over colored text aligns pixel for pixel; how each browser paints a textarea selection over transparent text; how IME
composition looks; how forced-colors mode behaves; and the actual contrast of the colors. Closing these takes one
manual pass in a browser per change unit, in light, dark, and forced-colors modes. The plan's "How you know it worked"
checks name that pass.

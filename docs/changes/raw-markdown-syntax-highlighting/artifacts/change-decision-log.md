# Change Decision Log: Raw Markdown Syntax Highlighting

<!--
This file records every decision committed while planning Raw Markdown Syntax Highlighting.
The plan itself lives in [../change-plan.md](../change-plan.md). This file captures the
question, rationale, evidence, and rejected alternatives behind each decision.
Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.
-->

## Trivial decisions

- D-11: Syntax spans are computed once per text change — `RawView` calls `useMemo(() => rawSyntax(text), [text])`, so
  caret moves, focus changes, and selection changes reuse the spans (C-10). — Referenced in plan: Target State.
- D-12: Unit order — Unit 1 (find spans) and Unit 2 (palette and formatted view) are independent; Unit 3 (colored raw
  mode) needs both. — Referenced in plan: Change Units.
- D-16: Review-round trims — `font-weight: 700` on headings is dropped as a no-op. The hover underline and the
  formatted forced-colors rules are deferred. Raw `>` stays gray, as confirmed. The added tests are pinned in Units 1
  and 3. — Referenced in plan: S-7, Deferred (YAGNI), Change Units, Review Findings.

## Full decisions

### D-1: The mirror draws the colored text

- **Question:** A textarea draws its text in one color. Where do raw mode's syntax colors get drawn?
- **Decision:** The existing mirror (`.raw-mirror`) draws the visible text, in syntax colors. The textarea's text
  becomes transparent. `mirrorPieces` keeps cutting only at mark edges and the caret. Within each piece, `styled()`
  wraps syntax spans in `<span class="md-{kind}">`. A mark is never split by a syntax span. Signatures are pinned in
  change-plan.md, Target State, "Contract: `mirrorPieces` and `styled`".
- **Rationale:** The mirror already lays out character for character with the textarea, through the shared `.raw-text`
  rule (C-2). Drawing the colored text and the mark backgrounds from one element means they cannot drift apart. Nesting
  the spans inside marks keeps each highlight one element, which the tests and `markdown-editor.tsx:798` depend on
  (C-11).
- **Evidence:** C-1, C-2, C-3, C-11; software-architect A1.
- **Behavior impact:** Changing (requested). See D-7.
- **Rejected alternatives:**
  - A second absolutely-positioned syntax layer between the mirror and the textarea (this run's initial sketch).
    Rejected because it adds a third box that must also wrap identically, and nothing tests wrapping (findings, Gaps).
    It is no safer for the tests than nesting.
  - Adding syntax cuts to `mirrorPieces` alongside the mark cuts. Rejected because it splits highlight marks and fails
    the per-mark tests (C-11).
  - A code-editor library (CodeMirror and similar) in place of the textarea. Rejected because it would replace the
    textarea that the highlights, labels, ask button, paste handling, and toolbar formatting are all built on, which is
    far more than the reason justifies.
- **Revisit criterion:** Typing lag measured on a large document and traced to the mirror's re-render (see Deferred,
  "A separate syntax layer").
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-3, D-4, D-5, D-11
- **Referenced in plan:** Target State, S-5

### D-2: A new raw-syntax module finds the spans

- **Question:** What finds which stretches of raw text to color, and where does it live?
- **Decision:** A pure function `rawSyntax(text): SyntaxSpan[]` in a new
  `src/ui/documents/markdown-editor/raw-syntax.ts`, with the type and rules pinned in change-plan.md, Target State,
  "Contract: `rawSyntax`". It uses `scan()` for links and code, and `HEADING`/`QUOTE`/`LIST` for lines.
- **Rationale:** Coloring needs character positions. markdown-it gives only line ranges (C-6), while `scan()` already
  gives positions for links and code (C-7). Keeping display classification out of `raw-formatting.ts` separates two
  reasons to change: what an edit writes, and what gets colored. `raw-formatting.ts` is the busiest file in the area
  after the editor (C-7, churn).
- **Evidence:** C-6 (verified by running markdown-it), C-7; software-architect A2.
- **Behavior impact:** Preserving until S-4 renders it.
- **Rejected alternatives:**
  - Tokenizing with the shared markdown-it instance. Rejected because inline tokens carry no positions (C-6), and the
    task-list rule rewrites token content.
  - Putting `rawSyntax` inside `raw-formatting.ts` with no exports. A workable alternative, rejected because it mixes
    display and editing in the file with the most churn.
  - A hand-written second regex set for links and code. Rejected because it would drift from the toolbar's notion of a
    link (D-9).
- **Revisit criterion:** Another view needs syntax spans, or `scan()` is replaced by a real parser with positions.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-9, D-10
- **Referenced in plan:** Target State, S-2

### D-3: Raw mode styles with color and background only

- **Question:** Which CSS properties may an `md-*` span set?
- **Decision:** Only `color` and `background`. No `font-weight`, `font-style`, `font-size`, `font-family`,
  `letter-spacing`, padding, margin, or side border. A comment beside the `md-*` rules states this.
- **Rationale:** Any width change moves the mirror's line wrapping away from the textarea's, and the caret then lands
  off the colored text (C-2). Whether bold keeps character width across the monospace stack's fallback fonts is
  unverified.
- **Evidence:** C-2; structural-analyst S-2; behavioral-analyst B-4. The operator was told in the confirmation turn that
  raw-mode headings can change color and possibly weight, but not size.
- **Behavior impact:** Preserving (layout and caret placement are unchanged).
- **Rejected alternatives:**
  - Bold heading lines. Deferred (YAGNI) until a browser pass shows no drift.
  - Italic for emphasis text. Rejected for the same width risk. The operator asked only for the markers to be colored.
- **Revisit criterion:** A browser pass shows bold keeps width in every supported browser.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State, S-6, Risks

### D-4: Selection looks as it does today

- **Question:** With the textarea's text transparent, how does selected text look?
- **Decision:** `.raw-markdown::selection { color: var(--text) }`, leaving the selection background to the system. The
  selected text is drawn by the textarea, as today.
- **Rationale:** This keeps the existing look, so nothing changes that the user didn't ask for. If a browser ignores
  `::selection` on a textarea, the colored mirror text still shows beneath the selection.
- **Evidence:** C-4.
- **Behavior impact:** Intended to be preserving; Unverified until Unit 3's browser pass compares against a before screenshot (junior-developer JD-006, test-engineer §4).
- **Rejected alternatives:**
  - A translucent accent-colored selection with transparent selected text (software-architect A1). Rejected because it
    changes how selection looks, which the user did not ask for.
- **Revisit criterion:** The browser pass shows the selected text doubled or unreadable.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State, S-6, Risks

### D-5: High-contrast mode looks as it does today

- **Question:** What does raw mode look like in forced-colors mode, where the browser overrides text colors?
- **Decision:** Under `@media (forced-colors: active)`:
  - `.raw-mirror` sets `color: transparent; forced-color-adjust: none`.
  - `.raw-mirror [class^="md-"]` sets `color: transparent; background: none`, because `forced-color-adjust` is inherited
    and each span sets its own color.
  - `.raw-mirror mark.current-highlight` sets `outline-color: Highlight`, which the inherited `none` would otherwise
    leave in the authored accent color.
  - `.raw-markdown` sets `color: CanvasText; caret-color: CanvasText`.
  - The existing forced-colors rules for marks and labels stay as they are.
- **Rationale:** This restores today's arrangement exactly: the textarea draws the text and the mirror draws only the
  marks. It doesn't depend on how the browser handles two overlapping copies of the text. Syntax colors would be
  overridden in that mode anyway.
- **Evidence:** C-5 (Unverified: not rendered). The span, outline, and caret rules come from review findings JD-001, UX-001, UX-006, and test-engineer §4.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Relying on forced colors painting both texts in CanvasText at the same spot (software-architect A1). Rejected
    because it depends on unverified rendering and risks a ghosted double image.
- **Revisit criterion:** The forced-colors browser pass shows the marks' system colors missing because of
  `forced-color-adjust: none` on the mirror. In that case, move `forced-color-adjust: none` to the mirror's text only,
  by wrapping the text instead of the container.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State, S-6

### D-6: Two new color variables

- **Question:** Which colors are new, and where are they defined?
- **Decision:** In `src/ui/styles.css`, add `--heading` (`#862e9c` light, `#e599f7` dark, per D-15) and `--marker`
  (`#b03a0a` light, `#ff922b` dark). Everything else reuses `--accent` (link text), `--muted` (link markup, emphasis markup, quote
  text), and `--code` (code background).
- **Rationale:** Each new color needs a dark-mode value, and overriding variables is the palette's only dark-mode
  mechanism (C-8). `--marker` has three uses: the raw list marker, the formatted `li::marker`, and the formatted quote
  bar. `--heading` has two. Both views read the same variables, so a heading looks related in each.
- **Evidence:** C-8, C-9; software-architect A4; user confirmation of the palette (D-7, D-8). The light `--marker` moved from `#c2410c` to `#b03a0a` because the old value was 4.40:1 on the ask-selection tint (user-experience-designer UX-003). It is still orange, within the confirmed palette.
- **Behavior impact:** Preserving on its own. The visible effect is settled by D-7 and D-8.
- **Rejected alternatives:**
  - One variable per raw kind (`--syntax-link` and so on). Rejected because it would duplicate meanings that already
    have variables.
  - Changing the dark `--code` value for contrast. Rejected because the chat panel also uses `--code`, outside the
    area. The formatted code gets a border instead (D-8).
  - Hard-coded hex values in the rules. Rejected because they would have no dark-mode value.
- **Revisit criterion:** The review round or the manual pass shows a contrast failure, which would change the hex
  values but not the structure.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** D-7, D-8, D-15
- **Referenced in plan:** Target State, S-3

### D-7: Raw mode palette, including emphasis markers

- **Question:** Behavior gate for S-4/S-5. What exactly does the writer see in raw mode?
- **Decision:** Headings are colored across the whole line (grape, per D-15). Link text is blue (`--accent`), with gray brackets and
  address. Bold and italic markers are gray. Code has a shaded background. List markers are orange. Quote lines are
  gray. Selection and forced-colors mode look as they do today.
- **Rationale:** This is what the operator asked for, confirmed specifically.
- **Evidence:** User input. The question offered the palette without emphasis coloring, and the operator chose
  "Yes, and color ** and * too".
- **Behavior impact:** Changing. The user's answer, verbatim: "Yes, and color ** and * too".
- **Rejected alternatives:**
  - The same palette with emphasis markers left plain. Rejected by the operator.
  - A different heading color. Offered, and not chosen.
- **Revisit criterion:** The operator asks for a different palette.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5, S-6
- **Dependent decisions:** D-10
- **Referenced in plan:** S-5, Behavior Changes

### D-8: Formatted view styling

- **Question:** Behavior gate for S-6. What does the writer see in the formatted view?
- **Decision:** The rules are pinned in S-7:
  - headings are `--heading` (grape), with `h4`–`h6` sizes;
  - links are underlined;
  - `code` and `pre` use the monospace stack, with a 1px `--border` border;
  - the quote bar is `--marker`;
  - list bullets and numbers are `--marker`.

  The review round removed three items from what the user approved. `font-weight: 700` was a no-op, because browsers
  already make headings bold. The hover underline was not requested. The forced-colors rules duplicate what the browser
  already applies. The last two are deferred (YAGNI).
- **Rationale:** These address each item the operator named: headings, links, code, and quotes and lists (C-9). The
  code border fixes the dark-mode code-on-panel contrast without changing the shared `--code` (D-6).
- **Evidence:** C-9, C-12; user input.
- **Behavior impact:** Changing. The user's answer, verbatim: "Yes, all of it (Recommended)".
- **Rejected alternatives:**
  - Leaving the quote bar and bullets uncolored. Offered as "Skip the orange", and not chosen.
  - Adding classes through the schema's `toDOM`. Rejected because element selectors already reach every element
    (C-12).
- **Revisit criterion:** The operator asks for a change after seeing it.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7
- **Dependent decisions:** D-15
- **Referenced in plan:** S-7, Behavior Changes

### D-9: Export `scan` and the line patterns as they are

- **Question:** How does `raw-syntax.ts` get at link, code, and line recognition that is private to
  `raw-formatting.ts`?
- **Decision:** Add `export` to `scan`, `HEADING`, `QUOTE`, and `LIST`. Leave `RawLink` private, and change no
  behavior.
- **Rationale:** The colors must agree with the toolbar about what counts as a link, code, a heading, a quote, or a list
  item. One definition can't drift. `scan`'s return shape is already the shape `rawSyntax` needs.
- **Evidence:** C-7; software-architect A3.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - A narrower exported wrapper. Rejected as a new abstraction with one caller.
  - Duplicating the regexes in `raw-syntax.ts`. Rejected because the copies would drift.
- **Revisit criterion:** `scan` gains a caller whose needs differ from both of today's.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** —
- **Referenced in plan:** Target State, S-1

### D-10: How emphasis markers are recognized

- **Question:** Nothing in the code recognizes `**` or `*` today. What counts as an emphasis marker?
- **Decision:** A simplified version of CommonMark's flanking rules, applied one line at a time outside `code` and
  `link-markup` ranges. Runs inside link text are matched, and cut the `link-text` span around them (plan precedence
  rule 3, junior-developer JD-002):
  - **Runs.** A delimiter run is 1 to 3 consecutive `*`, or 1 to 3 consecutive `_`, not preceded by a backslash.
  - **Opening.** A run can open when the next character exists and is not whitespace. For `_`, the previous character
    must also not be a letter or digit.
  - **Closing.** A run can close when the previous character is not whitespace. For `_`, the next character must also
    not be a letter or digit.
  - **Pairing.** Scanning left to right, an opening run pairs with the next closing run of the same character and
    length on the same line. Both runs become `emphasis-markup`.
  - **Unpaired runs** stay plain.
  - **Lines.** A run at the start of a line that `LIST` matches is a list marker, not emphasis.

  Worked cases:
  - `**b**` gives two spans.
  - `snake_case_name` gives none.
  - `**bold` gives none.
  - `* item` gives none, because its `* ` is a list marker.
  - `a * b * c` gives none: the first `*` has a space after it, so it cannot open.
- **Rationale:** The operator asked for `**` and `*` to be colored (D-7). Full CommonMark emphasis parsing is far
  larger than coloring markers needs, and a rare mismatch only means a marker stays uncolored or is colored when it
  isn't emphasis. Nothing is saved differently.
- **Evidence:** D-7; C-6 (markdown-it gives no positions to borrow).
- **Behavior impact:** Changing, within D-7.
- **Rejected alternatives:**
  - Full CommonMark delimiter-stack parsing. Rejected because it far exceeds the evidence. Only the colors depend on
    it.
  - Using markdown-it's `strong_open` and `em_open` tokens. Rejected because they carry no positions (C-6).
- **Revisit criterion:** The operator reports markers colored wrongly in real documents.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State, S-2

### D-13: Inline code stops at a blank line

- **Question:** One stray backtick in raw text shades everything up to the next matching backtick, even paragraphs
  later. Headings in between lose their color. What should count as inline code?
- **Decision:** In `codeEnd` (`raw-formatting.ts`), an inline code span's closing backticks must come before the first
  blank line after the opening run. A blank line is a line holding only spaces or tabs. Otherwise the opening run is
  plain text. Fenced blocks are unchanged. The toolbar, paste handling, and colors all read the same `scan()`.
- **Rationale:** It matches how the formatted view (CommonMark) reads code, which never crosses a paragraph. One rule
  shared by every reader keeps the colors and the link button from disagreeing.
- **Evidence:** junior-developer JD-003 (reading `codeEnd` in `raw-formatting.ts`); C-7. User input.
- **Behavior impact:** Changing. After a stray backtick, text in later paragraphs is no longer treated as code by the
  link button, pasted URLs, or the colors. The user's answer, verbatim: "Stop at a blank line (Recommended)".
- **Rejected alternatives:**
  - Colors only. Only `rawSyntax` would ignore cross-paragraph code. Offered and not chosen, because the colors and
    the link button could then disagree.
  - Leave it. Offered and not chosen.
- **Revisit criterion:** A fenced or inline code case where the blank-line rule disagrees with the formatted view.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** —
- **Referenced in plan:** Current State, Target State, S-1, Behavior Changes

### D-14: A darker dark-mode highlight fill

- **Question:** In dark mode, colored text inside an AI highlight (`#4d4000`) falls below 4.5:1. Link text is 3.45:1,
  the gray markers 3.67:1, and headings 4.25:1. What should change?
- **Decision:** The dark-mode `--highlight` becomes `#352e00`. The light value is unchanged.
- **Rationale:** Every text color inside the highlight then meets 4.5:1: accent 4.59, muted 4.87, heading above 4.99,
  and marker 6.09. Highlights keep their 2px accent underline, so they don't rely on the fill.
- **Evidence:** user-experience-designer UX-002 (computed from the hex values, not rendered). C-12. User input.
- **Behavior impact:** Changing. Dark-mode highlights are subtler against the page (1.21:1 instead of 1.61:1). The
  user's answer, verbatim: "Darker fill (Recommended)".
- **Rejected alternatives:**
  - Keep the fill. Offered and not chosen.
  - Lighten the dark `--accent`. Rejected because it touches every button and still falls short (4.48:1).
- **Revisit criterion:** Highlights are hard to spot in dark mode in the manual pass.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State, S-4, Behavior Changes

### D-15: Grape headings

- **Question:** Under deuteranopia, violet `#6741d9` headings and blue `#3b5bdb` links are nearly the same color
  (ΔE 2.1). Which heading color?
- **Decision:** `--heading` is `#862e9c` (light) and `#e599f7` (dark).
- **Rationale:** It stays purple, but sits far from the blue links for every simulated vision type (ΔE about 34 normal,
  34 deutan, 22 protan in light mode). It also reads better: 7.28:1 on the light panel and 8.04:1 on the dark panel.
- **Evidence:** user-experience-designer UX-004 (Machado 2009 simulations; Unverified on real displays). User input.
- **Behavior impact:** Changing, within D-7 and D-8. The user's answer, verbatim: "Grape (Recommended)".
- **Rejected alternatives:**
  - Keep the violet. Offered and not chosen.
- **Revisit criterion:** The user asks for another heading color.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State, S-3

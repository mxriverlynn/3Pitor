# Change Plan: Raw Markdown Syntax Highlighting

## Why This Change

This change adds syntax colors to raw mode and restyles the formatted view, because the writer can't see a document's
structure while editing it. In raw mode, a `## Heading` line looks exactly like a
plain paragraph, and a link doesn't show the blue it has in the formatted view. In the formatted view, headings, links,
code, block quotes, and lists are all hard to make out. This is **friction the user reports**, in their own words: "make
it easier to see what's going on in both raw and formatted versions" (see `artifacts/scope-boundary.md`).

## What Changes, In One Paragraph

Raw mode gains syntax colors:

- Heading lines turn grape purple.
- Link text turns the same blue as formatted links, and the link's brackets and address turn gray.
- Bold and italic markers turn gray.
- Code gets a shaded background.
- List markers turn orange.
- Quote lines turn gray.

Headings, links, code, and list markers look the same in both views. The formatted view also gains underlined links,
bordered monospace code, an orange quote bar, and orange list bullets.

Raw mode stays one textarea over one mirror, a `div` that holds the same text. Today the mirror draws only the AI highlights' backgrounds. After this
change it also draws the visible, colored text. The textarea's own text turns transparent, and the textarea keeps the
caret, the selection, and all input.

Two smaller fixes come along with it:

- Inline code in raw text no longer runs past a blank line.
- The dark-mode highlight fill is darker, so colored text inside it stays readable.

## Current State

**Raw mode draws its text from the textarea.** The textarea sits over a mirror `div`. The mirror holds the same text in
transparent color, and only the backgrounds of its `<mark>` elements show through
([C-1](artifacts/current-state-findings.md#c-1-the-raw-view-is-a-textarea-over-a-mirror-whose-text-is-invisible)).
The two line up only because they share the `.raw-text` metrics rule, and any inline style that changes character width
breaks that alignment
([C-2](artifacts/current-state-findings.md#c-2-mirror-and-textarea-line-up-only-because-they-share-one-metrics-rule)).
A textarea draws all its text in one color, so the textarea alone cannot carry syntax colors.

**Nothing in the UI finds syntax in raw text for display.** markdown-it, the markdown parser, reports which lines each block starts on, but
nothing about where a link or a code span sits within a line
([C-6](artifacts/current-state-findings.md#c-6-markdown-it-gives-line-ranges-for-blocks-and-no-positions-for-anything-inside-a-line)).
The private `scan()` in `raw-formatting.ts` already finds links and code, with character offsets. Private `HEADING`,
`QUOTE`, and `LIST` patterns sit next to it
([C-7](artifacts/current-state-findings.md#c-7-raw-formattingts-already-finds-links-and-code-with-character-offsets-in-raw-text)).
`scan()` lets an inline code span run across blank lines to the next matching backtick anywhere in the document. The
formatted view never reads code that way (review finding JD-003).

**The formatted view styles each element lightly.** It gives headings a size and nothing else. Links get the accent
color only. Inline code has no monospace font. Quotes have a faint rule. Lists have no styling
([C-9](artifacts/current-state-findings.md#c-9-the-formatted-view-styles-headings-links-code-quotes-and-lists-only-lightly)).
The palette is a set of CSS variables with a dark-mode override
([C-8](artifacts/current-state-findings.md#c-8-the-palette-is-a-set-of-css-variables-with-a-dark-mode-override)).

**Three constraints shape the target:**

- Several tests read each highlight `<mark>` as a single element, so splitting a mark breaks them
  ([C-11](artifacts/current-state-findings.md#c-11-tests-read-highlight-marks-one-element-at-a-time-so-splitting-a-mark-breaks-them)).
- `RawView` re-renders on every caret move
  ([C-10](artifacts/current-state-findings.md#c-10-rawview-re-renders-on-every-keystroke-and-every-caret-move-and-mirrorpieces-is-not-memoized)).
- Making the textarea's text transparent would also hide its caret and change how its selection looks
  ([C-4](artifacts/current-state-findings.md#c-4-hiding-the-textareas-text-would-also-hide-its-caret-and-its-selected-text)).

## Target State

**`rawSyntax` finds what to color.** It is a pure function in a new module,
`src/ui/documents/markdown-editor/raw-syntax.ts`. It returns flat, sorted, non-overlapping spans, and knows nothing
about React or CSS
([D-2](artifacts/change-decision-log.md#d-2-a-new-raw-syntax-module-finds-the-spans),
[D-9](artifacts/change-decision-log.md#d-9-export-scan-and-the-line-patterns-as-they-are)). It gets each kind of span
from a different place:

- links and code from the now-exported `scan()`;
- heading, quote, and list lines from the now-exported `HEADING`, `QUOTE`, and `LIST`;
- emphasis markers from its own rules
  ([D-10](artifacts/change-decision-log.md#d-10-how-emphasis-markers-are-recognized)).

**`scan()` stops inline code at a blank line.** A code span whose closing backticks lie past a blank line is not code,
and its opening backticks are plain text. Fenced code blocks are unchanged. The toolbar, the paste handling, and the
colors all read this one rule
([D-13](artifacts/change-decision-log.md#d-13-inline-code-stops-at-a-blank-line)).

**`RawView`'s mirror draws the visible text.** `mirrorPieces` cuts the text at mark edges and the caret exactly as it
does today. Inside each piece, a new helper `styled()` wraps each syntax span's part in `<span class="md-{kind}">`. A
syntax span never splits a mark, but a syntax span can be split at a mark's edge. `RawView` computes the spans once per
text change, with `useMemo` keyed on `text`
([D-1](artifacts/change-decision-log.md#d-1-the-mirror-draws-the-colored-text),
[D-11](artifacts/change-decision-log.md#trivial-decisions)).

**The textarea keeps input, caret, and selection.**

- Its text is transparent, and its caret is `var(--text)`.
- Its selected text is drawn in `var(--text)` over the system selection color. This is intended to look as it does
  today, and Unit 3's browser pass checks it
  ([D-4](artifacts/change-decision-log.md#d-4-selection-looks-as-it-does-today)).
- In forced-colors mode (the high-contrast mode, such as Windows High Contrast), raw mode returns to today's arrangement. The mirror's text and every syntax span are
  transparent, the textarea's text and caret are `CanvasText`, and the current highlight's outline is `Highlight`. There
  are no syntax colors in that mode
  ([D-5](artifacts/change-decision-log.md#d-5-high-contrast-mode-looks-as-it-does-today)).

**Raw styles set color and background only.** No weight, style, size, padding, margin, or side border goes on an
`md-*` span, so the mirror keeps wrapping exactly as the textarea does
([D-3](artifacts/change-decision-log.md#d-3-raw-mode-styles-with-color-and-background-only)).

**Both views share one palette.** Two new variables, `--heading` and `--marker`, join the existing ones, and the
dark-mode `--highlight` gets darker
([D-6](artifacts/change-decision-log.md#d-6-two-new-color-variables),
[D-14](artifacts/change-decision-log.md#d-14-a-darker-dark-mode-highlight-fill),
[D-15](artifacts/change-decision-log.md#d-15-grape-headings)).

### Contract: `rawSyntax`

```ts
// src/ui/documents/markdown-editor/raw-syntax.ts
export type SyntaxKind = 'heading' | 'link-text' | 'link-markup' | 'emphasis-markup' | 'code' | 'quote' | 'list-marker';
// A stretch of markdown drawn as `kind`: `from` inclusive, `to` exclusive, as UTF-16 offsets into the text.
export type SyntaxSpan = { from: number; to: number; kind: SyntaxKind };
// Sorted by `from`, non-overlapping, never empty (a span with from === to is dropped). Adjacent spans of the same kind
// are not merged. Only `code` and `link-text` spans may contain '\n': a fenced block, an inline code span within one
// paragraph, or link text that wraps a line.
export function rawSyntax(text: string): SyntaxSpan[];
```

Each source produces candidate ranges. Precedence, highest first, decides overlaps. A higher-precedence range cuts every
lower one it overlaps, and the lower one's remaining pieces are kept on either side:

1. **`code`**: every range in `scan(text).code`. That covers fenced blocks (fence lines included, up to the end of the
   text when unclosed) and inline code spans (within one paragraph, per D-13).
2. **`link-markup`**: for each link or image in `scan(text).links`, the ranges `[start, text[0])` and `[text[1], end)`.
   An image's `start` already includes its `!`. `scan` returns links in closing order, so an image inside a link's text
   comes first. Its markup is part of the outer link's text range, and is cut out of it here.
3. **`emphasis-markup`**: the delimiter runs of emphasis and strong, per
   [D-10](artifacts/change-decision-log.md#d-10-how-emphasis-markers-are-recognized). Runs inside a `code` or
   `link-markup` range are never matched. Runs inside link text are.
4. **`link-text`**: each link's or image's `[text[0], text[1])`.
5. **Line kinds**, tested on every line that does not start inside a `code` range:
   - `heading`: the whole line (without its `\n`), when `HEADING` matches.
   - `quote`: the whole line, when `QUOTE` matches.
   - `list-marker`: only the `LIST` match, including any indent and task box. The rest of the item is plain.

**Main worked example.** The input is `"# Title\nA [link](http://x) and \`c\`\n> quoted\n- item **b**"`. Its lines
start at 0, 8, 35, and 44.

```
{ from: 0,  to: 7,  kind: 'heading' }          "# Title"
{ from: 10, to: 11, kind: 'link-markup' }      "["
{ from: 11, to: 15, kind: 'link-text' }        "link"
{ from: 15, to: 26, kind: 'link-markup' }      "](http://x)"
{ from: 31, to: 34, kind: 'code' }             "`c`"
{ from: 35, to: 43, kind: 'quote' }            "> quoted"
{ from: 44, to: 46, kind: 'list-marker' }      "- "
{ from: 51, to: 53, kind: 'emphasis-markup' }  "**"
{ from: 54, to: 56, kind: 'emphasis-markup' }  "**"
```

**Further worked cases**, each pinned by a test:

| Input | Spans |
| --- | --- |
| `# See [a](b) more` | `heading` 0–6, `link-markup` 6–7, `link-text` 7–8, `link-markup` 8–12, `heading` 12–17 |
| `[**a**](b)` | `link-markup` 0–1, `emphasis-markup` 1–3, `link-text` 3–4, `emphasis-markup` 4–6, `link-markup` 6–10 |
| `[![alt](i.png)](http://u)` | `link-markup` 0–1, `link-markup` 1–3, `link-text` 3–6, `link-markup` 6–14, `link-markup` 14–25 |
| `![](u)` | `link-markup` 0–2, `link-markup` 2–6 (the empty text is dropped) |
| ``"a `b\n\nc` d"`` | no spans: the backticks are separated by a blank line (D-13) |

### Contract: CSS class names

`styled()` builds each class as `'md-' + kind`. It is the only place in production code where the `md-` prefix appears.
The raw-mode CSS styles exactly these seven classes under `.rich-editor .raw-mirror`:

| Class | Raw style | The same meaning in the formatted view |
| --- | --- | --- |
| `md-heading` | `color: var(--heading)` | `h1`–`h6` `color: var(--heading)` |
| `md-link-text` | `color: var(--accent)` | `a` `color: var(--accent)` (unchanged) |
| `md-link-markup` | `color: var(--muted)` | hidden in the formatted view |
| `md-emphasis-markup` | `color: var(--muted)` | hidden in the formatted view |
| `md-code` | `background: var(--code)` | `code`, `pre` `background: var(--code)` |
| `md-quote` | `color: var(--muted)` | `blockquote` `color: var(--muted)` |
| `md-list-marker` | `color: var(--marker)` | `li::marker` `color: var(--marker)` |

Inside an AI highlight, `.raw-mirror mark .md-code` sets `background: none`, so the highlight's fill is never covered.

### Contract: `mirrorPieces` and `styled`

```ts
// raw-view.tsx (module-private)
function mirrorPieces(text: string, marks: Mark[], caret: number | undefined, spans: SyntaxSpan[]): ReactNode[];
// `text` from `from` to `to`, with each syntax span's part of it in a span of its class; plain strings between.
function styled(text: string, from: number, to: number, spans: SyntaxSpan[]): ReactNode[];
```

The cut points in `mirrorPieces` stay the mark edges and the caret:

- Where it pushes a bare piece today, it pushes `styled(text, at, end, spans)`.
- Where it pushes a `<mark>`, the mark's children become `styled(...)`.
- Keys inside a piece are `` `s${start}` ``, where `start` is the clipped span's start offset.

The mirror's text content, minus its trailing zero-width space, always equals the textarea's value.

## Surface Delta

### S-1: `scan`, `HEADING`, `QUOTE`, `LIST` in `raw-formatting.ts` — Re-scoped

**Target state.** `scan`, `HEADING`, `QUOTE`, and `LIST` are exported from
`src/ui/documents/markdown-editor/raw-formatting.ts`. They are the single definition of which raw text is a link, code,
a heading line, a quote line, or a list marker. The toolbar's formatting, the paste handling, and the syntax colors all
read them.

An inline code span found by `codeEnd` (and so by `scan`) never runs past a blank line, meaning a line holding only
spaces or tabs. If the closing backticks lie beyond one, the opening run is plain text. Fenced blocks are unchanged.
`RawLink` stays private.

**Behavior.** Changing, for the blank-line rule only; exporting changes no result. Text after a stray backtick, in a
later paragraph, used to count as code. Now it doesn't, so there:

- the link button works;
- a pasted URL becomes a link;
- the colors show headings and links.

The user chose this: "Stop at a blank line (Recommended)"
([D-13](artifacts/change-decision-log.md#d-13-inline-code-stops-at-a-blank-line)).

**Why.** The colors must agree with the toolbar about what counts as code and links. Without the blank-line rule, one
stray backtick shades whole later paragraphs.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-export-scan-and-the-line-patterns-as-they-are),
[D-13](artifacts/change-decision-log.md#d-13-inline-code-stops-at-a-blank-line)

### S-2: `raw-syntax.ts` (`rawSyntax`, `SyntaxSpan`, `SyntaxKind`) — Added

**Target state.** `src/ui/documents/markdown-editor/raw-syntax.ts` exists, with `raw-syntax.test.ts` beside it. It
exports:

- `rawSyntax(text)`, which returns the `SyntaxSpan[]` pinned under Target State;
- the `SyntaxSpan` and `SyntaxKind` types.

It owns finding emphasis markers. It has no React or DOM code of its own. It imports `raw-formatting.ts`, which
imports the shared markdown module.

**Behavior.** Preserving. Nothing renders it until S-4.

**Why.** Raw mode needs character positions for what to color, and markdown-it can't provide them (C-6).

**Depends on.** S-1.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-new-raw-syntax-module-finds-the-spans),
[D-10](artifacts/change-decision-log.md#d-10-how-emphasis-markers-are-recognized)

### S-3: `--heading` and `--marker` in `src/ui/styles.css` — Added

**Target state.** The two variables are defined as:

| Variable | `:root` | `prefers-color-scheme: dark` |
| --- | --- | --- |
| `--heading` | `#862e9c` | `#e599f7` |
| `--marker` | `#b03a0a` | `#ff922b` |

`--heading` is the color of headings in both views. `--marker` is the color of list markers in both views, and of the
formatted view's quote bar.

**Behavior.** Preserving on its own. The variables are unused until S-4 and S-6.

**Why.** Both new colors need a dark-mode value, and the palette's only dark-mode mechanism is overriding variables
(C-8).

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-two-new-color-variables),
[D-15](artifacts/change-decision-log.md#d-15-grape-headings)

### S-4: `--highlight` (dark) in `src/ui/styles.css` — Re-scoped

**Target state.** In the `prefers-color-scheme: dark` block, `--highlight` is `#352e00`. The light value `#fff1a8` is
unchanged.

**Behavior.** Changing. In dark mode, every AI highlight's fill, in both views, is subtler against the page. Text in
every color inside it meets 4.5:1. Highlights keep their 2px accent underline. The user chose this: "Darker fill
(Recommended)".

**Why.** At `#4d4000`, link text inside a highlight is 3.45:1, the gray markers 3.67:1, and headings 4.25:1. All three
fall short of 4.5:1. The plan adds colored text inside highlights, so the shortfall would spread to raw mode.

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-a-darker-dark-mode-highlight-fill)

### S-5: `RawView` and `mirrorPieces` in `raw-view.tsx` — Re-scoped

**Target state.** The mirror draws the raw text visibly, in syntax colors, as well as the AI highlights' marks:

- `RawView` computes `rawSyntax(text)` once per text change and passes the spans to `mirrorPieces`.
- `mirrorPieces` cuts at mark edges and the caret only, and wraps the syntax spans inside each piece through
  `styled()`.
- Each mark stays one element, whatever syntax it contains.
- The textarea is still the only thing that takes input, holds the caret, and holds the selection.
- The file's header comment says the mirror draws the text.

**Behavior.** Changing. In raw mode, the writer sees colored text where they saw one color. The user requested this and
confirmed the palette, including the emphasis markers
([D-7](artifacts/change-decision-log.md#d-7-raw-mode-palette-including-emphasis-markers)).

**Why.** A textarea can't color its own text (C-1). The mirror already lays out exactly like the textarea, so it is the
one place where colored text can line up with what's typed.

**Depends on.** S-2, S-6. S-5 and S-6 land together in one unit.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-mirror-draws-the-colored-text),
[D-7](artifacts/change-decision-log.md#d-7-raw-mode-palette-including-emphasis-markers)

### S-6: Raw-mode rules in `markdown-editor.css` — Re-scoped

**Target state.** The raw-mode rules swap which element shows the text, and style the seven `md-*` classes:

- `.raw-mirror` draws its text in `var(--text)`, and its marks inherit that color.
- `.raw-markdown` draws its text transparent, with `caret-color: var(--text)`.
- `.raw-markdown::selection` sets `color: var(--text)` and leaves the selection background to the system.
- The seven `md-*` classes follow the class table, with color and background only. A comment beside them states that
  rule.
- `.raw-mirror mark .md-code` has no background.

Under `@media (forced-colors: active)`:

- `.raw-mirror` sets `color: transparent; forced-color-adjust: none`.
- `.raw-mirror [class^="md-"]` sets `color: transparent; background: none`.
- `.raw-mirror mark.current-highlight` sets `outline-color: Highlight`.
- `.raw-markdown` sets `color: CanvasText; caret-color: CanvasText`.
- The existing forced-colors rules for marks and labels stay.

**Behavior.** Changing, as part of S-5, at the user's request. Two things are intended to stay as they are, and the
Unit 3 browser pass checks both: how a selection looks, and how raw mode looks in forced-colors mode.

**Why.** This makes the colors visible while keeping the caret, the selection, and high-contrast mode as they are today
(C-4, C-5).

**Depends on.** S-3.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-raw-mode-styles-with-color-and-background-only),
[D-4](artifacts/change-decision-log.md#d-4-selection-looks-as-it-does-today),
[D-5](artifacts/change-decision-log.md#d-5-high-contrast-mode-looks-as-it-does-today)

### S-7: Formatted-view rules in `markdown-editor.css` — Re-scoped

**Target state.** The formatted view's rules, under `.rich-editor .ProseMirror`, are:

- **Headings.** `h1`–`h6` take `color: var(--heading)`. Headings stay bold through the browser default. `h4`, `h5`,
  and `h6` have their own sizes: 1.1em, 1em, and 0.95em. These step down from `h3`'s 1.2em.
- **Links.** `a` keeps `color: var(--accent)` and takes `text-decoration: underline; text-underline-offset: 2px`.
- **Code.** `code` and `pre` take the raw view's monospace stack and `border: 1px solid var(--border)`. `pre code` has no
  border.
- **Quotes.** `blockquote`'s left border is `3px solid var(--marker)`.
- **Lists.** `li::marker` takes `color: var(--marker)`. Task items have no marker, so this doesn't affect them.

There are no schema, `toDOM`, or class changes, and no new forced-colors rules.

**Behavior.** Changing. In the formatted view, the writer sees:

- grape headings;
- underlined links;
- monospace code with a thin border;
- an orange quote bar;
- orange list bullets and numbers;
- readable `h5`/`h6` sizes.

The user confirmed this ([D-8](artifacts/change-decision-log.md#d-8-formatted-view-styling)).

**Why.** The user named all four as hard to make out: headings, links, code, and quotes and lists (C-9).

**Depends on.** S-3.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-formatted-view-styling)

## Behavior Changes

- **Raw mode shows syntax colors (S-5, S-6).** Anyone editing in raw mode sees:
  - grape heading lines;
  - blue link text, with gray brackets and addresses;
  - gray `**`, `*`, and `_` markers;
  - shaded code;
  - orange list markers;
  - gray quote lines.

  Selection and Windows High Contrast mode are intended to look as they do today, which Unit 3's browser pass checks.
  The user asked for this and confirmed the palette, adding the emphasis markers
  ([D-7](artifacts/change-decision-log.md#d-7-raw-mode-palette-including-emphasis-markers)).
- **The formatted view restyles headings, links, code, quotes, and lists (S-7).** Anyone reading sees:
  - grape headings;
  - underlined links;
  - monospace code with a thin border;
  - an orange quote bar;
  - orange list bullets and numbers;
  - larger `h5`/`h6`.

  The user confirmed all of it ([D-8](artifacts/change-decision-log.md#d-8-formatted-view-styling)).
- **Inline code stops at a blank line (S-1).** A stray backtick no longer turns later paragraphs into code. This holds
  for the colors, the link button, and pasted URLs alike. The user chose this
  ([D-13](artifacts/change-decision-log.md#d-13-inline-code-stops-at-a-blank-line)).
- **The dark-mode highlight fill is darker (S-4).** AI highlights in dark mode are subtler against the page, and text
  inside them is readable. The user chose this
  ([D-14](artifacts/change-decision-log.md#d-14-a-darker-dark-mode-highlight-fill)).

The chat panel's own stylesheet doesn't read `--heading` or `--marker`. It does read `--highlight` only if it uses AI
highlights. The builder checks this with a grep of `src/ui/chat` during Unit 2.

## Change Units

### Unit 1: Find the syntax spans

**What it does.** This unit:

- exports `scan`, `HEADING`, `QUOTE`, and `LIST`;
- stops inline code at a blank line;
- adds `raw-syntax.ts` with its tests.

Nothing renders the spans yet.

**Delta entries.** S-1, S-2.

**How you know it worked.**

**`raw-formatting.test.ts`** gains one test. After a paragraph holding a stray backtick and a blank line, a selection
in a later paragraph, before another backtick, links normally through `rawFormat`. The existing cases pass unchanged.

**`raw-syntax.test.ts`** covers:

- the main worked example and every row of the further-cases table, exactly;
- a fenced block containing `# not a heading` and `- not a list`, which yields one `code` span that includes the closing
  fence line;
- an escaped `\[x](y)`, which yields no link spans;
- emphasis run lengths and pairing, in one case: `*a* __b__ ***c***` yields `emphasis-markup` on all six runs;
- emphasis negatives, in one case: `snake_case_name`, `**bold`, `**a*`, `2 * 3 * 4`, and `\*a\*` yield no emphasis;
- emphasis exclusions: `` `*a*` `` yields only `code`, and `[x](http://a*b*c)` yields no emphasis inside the address;
- line kinds, in one case: `#hashtag` is plain, `1. item` has a `list-marker` of `1. `, `* item` has a `list-marker` and
  no emphasis, and `> q` is a `quote`;
- an empty string, which yields `[]`.

The existing suite passes.

### Unit 2: Shared palette and formatted view

**What it does.** Adds `--heading` and `--marker`, darkens the dark-mode `--highlight`, and restyles the formatted view.

**Delta entries.** S-3, S-4, S-7.

**How you know it worked.** The existing suite passes; no test reads styles.

A manual pass in light and dark mode checks:

- headings are grape;
- links are underlined;
- code is monospace with a border;
- the quote bar and list bullets are orange;
- in dark mode, highlights are still visible, and link text inside one is readable.

A pass in forced-colors mode (Windows High Contrast, or Chrome DevTools' "Emulate CSS forced-colors") checks that links
and borders still show without new rules.

### Unit 3: Colored raw mode

**What it does.** Draws raw mode's text from the mirror in syntax colors.

**Delta entries.** S-5, S-6.

**Ordering constraint.** Unit 1 provides `rawSyntax`, and Unit 2 provides the variables. S-5 and S-6 must land
together, because either one alone leaves raw text invisible or doubled.

**How you know it worked.**

**Existing tests.** The existing raw-mode tests pass unchanged, including the per-mark `textContent` assertions
([C-11](artifacts/current-state-findings.md#c-11-tests-read-highlight-marks-one-element-at-a-time-so-splitting-a-mark-breaks-them)).

**New tests in `markdown-editor.test.tsx`:**

- In raw mode, `.raw-mirror .md-heading` holds `# Title`, and `.raw-mirror .md-link-text` holds the link's text.
- A highlight whose quote contains a link and `**bold**` is still exactly one `mark.ai-highlight`, with the same
  `textContent`.
- With all seven kinds present, a highlight whose edge falls inside `**bold**`, and the ask button showing, the
  `.raw-mirror` text content (minus its trailing zero-width space) equals `textarea.value`.
- Typing `## x` into the textarea makes a `.md-heading` appear. Moving only the caret leaves the classes unchanged.

**Stylesheet test.** A test reads `markdown-editor.css` and asserts two things:

- a `.rich-editor .raw-mirror .md-{kind}` rule exists for each of the seven kinds;
- outside the forced-colors block, those rules declare no properties other than `color` and `background`.

This test guards D-3 and the class-name contract.

**Manual browser pass** in light, dark, and forced-colors modes:

- The caret sits exactly on the colored text, at the end of a long wrapped line and after a tab.
- A selection looks as it does today. Compare against a screenshot taken before the change.
- AI highlights and the current-highlight outline still show.
- In forced-colors mode, no colored text is visible under the system text color.
- Code shading is visible.
- Typing through an input method (for example, Japanese input) shows the composing text. See Open Items.
- One render of the largest workspace document is timed in DevTools, and the number recorded.

## Risks

- **Caret drift (Unit 3).** If any `md-*` rule ever changes character width, the caret separates from the colored text
  (C-2). The stylesheet test catches a rule that sets a width-changing property, and the manual long-line check catches
  everything else.
- **Selection rendering differs by browser (Unit 3).** The plan relies on `::selection { color }` applying to a
  textarea's transparent text, which is Unverified. If a browser ignores it, selected text shows the mirror's colored
  text under the selection background. That is readable, but not today's look. Revisit D-4 if so.
- **Forced-colors rendering (Unit 3).** `forced-color-adjust: none` on the mirror is Unverified in a browser. The
  forced-colors pass checks that marks keep their system colors and no syntax color shows.
- **Input-method composition (Unit 3).** The textarea draws the composing text, and its text is now transparent. If
  the browser doesn't update the value during composition, the composing characters are invisible until committed. See
  Open Items.
- **Typing cost (Unit 3).** `rawSyntax` runs once per keystroke over the whole text. `styled()` re-renders the mirror's
  spans on every caret move (C-10). Workspace documents are up to about 12 KB. No timing has been measured, so the
  manual pass records one.
- **Toolbar reading of code (Unit 1).** The blank-line rule changes what the link button and paste handling treat as
  code, in documents with a stray backtick. The existing `raw-formatting` tests and the new one pin the change.
- **Blast radius.**
  - Unit 1 touches the toolbar's raw-mode link and paste behavior, only around unbalanced backticks.
  - Unit 2 touches every formatted document, and the dark-mode highlight fill everywhere it is used.
  - Unit 3 touches every raw-mode session.
  - No unit touches saved markdown or the server.

## Deferred (YAGNI)

### Bold heading lines in raw mode
**Why deferred:** Evidence test. Whether bold keeps character width across the monospace stack's fallback fonts is
unverified (C-2), and a width change would move the caret off the text.
**Reopen when:** A browser pass shows no caret drift with `font-weight: 700` on `.md-heading` in every supported
browser.
**Source:** software-architect; scope-boundary confirmation turn.

### A separate syntax layer or `RawSyntax` component
**Why deferred:** Simpler-version test. The existing mirror can carry the colors without a second element that must
also wrap identically.
**Reopen when:** Typing lag is measured on a large document and traced to re-rendering the mirror's spans on caret
moves.
**Source:** this run's initial sketch; software-architect.

### Horizontal-rule and other syntax kinds
**Why deferred:** Evidence test. The user named headings, links, code, quotes, and lists, and added emphasis markers
when asked. Nothing else was named.
**Reopen when:** The user asks for `---` or other syntax to stand out.
**Source:** software-architect.

### Composition fallback for input methods
**Why deferred:** Evidence test. It is unverified whether composing text is invisible.
**Reopen when:** Unit 3's browser pass shows invisible composing text. The fix is pinned in Open Items.
**Source:** behavioral-analyst B-4; software-architect.

### A `--mono` font variable
**Why deferred:** Evidence test. The monospace stack appears in two rules (`.raw-text`, and the formatted `code`/`pre`).
That is short of the three uses that would justify a variable.
**Reopen when:** A third rule needs the stack.
**Source:** software-architect.

### Forced-colors rules for the formatted view
**Why deferred:** Evidence test. In forced-colors mode the browser already maps link color to `LinkText` and borders to
system colors. No failure has been observed.
**Reopen when:** Unit 2's forced-colors pass shows links or code borders that can't be told apart.
**Source:** software-architect A5; junior-developer JD-005.

### A thicker link underline on hover
**Why deferred:** Evidence test. The user asked that links be easier to spot, and the resting underline does that.
Nobody asked for hover feedback.
**Reopen when:** The user asks for hover feedback on links.
**Source:** software-architect A5; user-experience-designer UX-007.

### Coloring `>` orange to match the formatted quote bar
**Why deferred:** Evidence test. The user confirmed gray quote lines in raw mode.
**Reopen when:** The user asks for the quote marker to match the bar.
**Source:** junior-developer JD-004.

## Open Items

- **Input-method composition (non-blocking).** Unit 3's browser pass settles this. If composing text is invisible, add
  `compositionstart` and `compositionend` handlers to the textarea in `RawView`. They toggle a `composing` class on
  `.raw-pane`, and `.raw-pane.composing .raw-markdown { color: var(--text) }` shows the textarea's own text while the
  writer composes.
- **Chat panel and `--highlight` (non-blocking).** Grep `src/ui/chat` for `--highlight` during Unit 2. If chat uses it,
  its dark-mode fill darkens too. The darker fill is a readability gain, but note it in the PR.
- **Links across paragraphs (non-blocking).** `scan()`'s bracket pairing can also cross a blank line, as code could
  before D-13. No case has been observed where this colors the wrong text, so this plan leaves it alone. Reopen if one
  is.

## Review Findings

Reviewers were `han-core:junior-developer`, `han-core:user-experience-designer`, and `han-core:test-engineer`, in one
round. The round cap for a medium run is two; a second round wasn't needed.

The findings that changed the plan:

- **Forced colors.** Inherited `forced-color-adjust: none` would have shown the syntax colors under the textarea's text,
  and lost the system color on the current-highlight outline. Raised by JD-001, UX-001, and the test-engineer's §4.
  Fixed in S-6 and D-5.
- **Precedence.** Rules for emphasis inside link text contradicted each other (JD-002). Precedence was re-ordered, and
  worked cases were added.
- **Contract gaps.** The `rawSyntax` contract wrongly said only fenced code contains `\n`. It also left empty spans and
  image-in-link nesting unpinned (JD-003, test-engineer §1). The contract and the cases table were fixed.
- **Stray backticks.** A stray backtick shaded later paragraphs (JD-003). Settled by the user as D-13.
- **Dark highlight contrast.** Colored text failed 4.5:1 inside dark-mode highlights (UX-002). Settled by the user as
  D-14.
- **Heading hue.** Violet headings and blue links merged under deuteranopia (UX-004). Settled by the user as D-15.
- **Light orange.** `--marker` was at 4.40:1 on the ask-selection tint (UX-003). The light value moved to `#b03a0a`.
- **Caret in forced colors.** The caret could vanish in forced colors (UX-006). Added `caret-color: CanvasText`.
- **Dropped declarations.** `font-weight: 700` on headings was a no-op (JD-009, UX-008), and the hover underline wasn't
  requested (UX-007). The weight was dropped; the hover underline was deferred.
- **Formatted forced-colors rules.** They duplicated the browser's own mapping (JD-005). Deferred.
- **Selection claim.** "Preserved" selection was a claim, not a fact (JD-006, test-engineer §4). It is reworded as
  intended, with before/after screenshots.
- **Test gaps.** Emphasis rule tests, mirror-equals-textarea, recompute-on-type, and a stylesheet allow-list test were
  missing (test-engineer §3, §5). They were added to Units 1 and 3.
- **Untimed claim.** "Well under a frame" was uncited (JD-007). It was replaced by a recorded timing.

Closed without change:

- **Decision log missing (test-engineer §0, UX notes).** The log was written while the review ran. D-11 resolves to
  Trivial decisions.
- **Existing tests (test-engineer §2).** Confirmed they survive nested spans.
- **Two kinds with one style (JD-010).** `link-markup` and `emphasis-markup` share a style. Both are kept: the tests
  tell them apart.
- **Prefix wording (JD-011).** The `md-` prefix wording was corrected to "production code".
- **Low-contrast code fill (UX-005).** No hex change. The manual pass checks that the shading is visible.

None of the findings was presented as blocking. Every finding about rendering is Unverified, because nothing was run in
a browser. The decisions each finding produced are in `artifacts/change-decision-log.md`.

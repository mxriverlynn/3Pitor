# Change Plan: Highlight click selection

## Why This Change

The writer wants a click into a highlight to make that highlight current and show the speech bubble. They also want the
status bar to read "{current} of {count}" whether they move with the buttons or by clicking. Raw mode is included. The
reason class is **friction the user reports**, in the writer's own words in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md).

The friction today: when the writer presses < or >, the current highlight moves, gets an outline, and the speech bubble
(the "Ask the AI about the selection" button) appears beside it. When they click into a highlight instead, the outline
stays where it was and the bubble disappears. The status bar also reads "Highlighted 2 of 2 passages" whichever highlight
they are on.

The writer also reported a layout bug. After they press Clear, the highlight bar disappears but its space stays. The
toolbar's buttons also drop a few pixels (Images #6 and #7 in the boundary record). This is a **reported defect**, added
to the same request.

## What Changes, In One Paragraph

After this change, the current highlight follows the writer's cursor. The cursor can get there by a click, an arrow key,
or < and >. When the writer clicks or arrows, the cursor stays exactly where they put it. While the cursor sits inside
the current highlight, the speech bubble shows level with the highlight's first line. Its tooltip then reads "Ask the AI
about this highlight", and clicking it asks about the whole passage. A drag selection still asks about exactly what was
selected, under the old tooltip. The status bar says which highlight the writer is on, such as "Highlight 2 of 3". It also
notes passages the AI sent that could not be placed in the post. Rendered and Raw modes behave the same way, including <
and >, which now put the cursor at the highlight in Raw mode too. In Rendered mode, the outline and the number also stay
on the same passage when the writer deletes text.

## Current State

**The toolbar never gets shorter.** The menu bar library keeps the menu bar at the tallest height it has seen. It forgets
that height only when the width changes. So the highlight bar's row keeps its space after Clear, and the one remaining
row of buttons is centered in the taller box
([C-10](artifacts/current-state-findings.md#c-10-the-menu-bar-never-gets-shorter-so-the-highlight-bars-space-outlives-it)).

**Only < and > move the current highlight.** The ProseMirror plugin state `Highlights.current` in
`markdown-editor.tsx` is the only record of which highlight is current. Only a transaction carrying `CURRENT_META`
changes it, and only `stepHighlight` sends one. A click or an arrow key produces a selection-only transaction, and
`apply` returns it unchanged
([C-1](artifacts/current-state-findings.md#c-1-only--and--change-the-current-highlight-a-click-never-does)).

**The bubble needs selected text, and only < and > supply it.** The speech bubble needs a non-empty selection in both
modes. In Rendered mode, `askButtonSpot` returns nothing for a caret, and `askSelection` returns early on one
([C-2](artifacts/current-state-findings.md#c-2-the-rendered-ask-button-needs-a-non-empty-selection-in-two-places)). Raw
mode has the same rule, written separately in `RawView`
([C-3](artifacts/current-state-findings.md#c-3-the-raw-ask-button-needs-a-non-empty-selection-too-by-its-own-rule)). <
and > show the bubble in Rendered mode because `selectCurrent` selects the whole passage. A click cannot use the same
step: the next keystroke would overwrite the passage
([C-8](artifacts/current-state-findings.md#c-8--and--select-the-passage-which-moves-any-caret-the-writer-placed)).

**Raw mode cannot report its cursor.** `RawView` knows where the textarea's cursor is, but it has no way to report
upward. Raw-mode < and > do not move the cursor at all
([C-4](artifacts/current-state-findings.md#c-4-raw-mode-tracks-the-caret-but-never-reports-it-and-its--and--do-not-select)).
`RawView` is handed the plugin's `current` as an index into its own list, `rawMarks`, which is built differently from the
Rendered list ([C-5](artifacts/current-state-findings.md#c-5-one-current-number-indexes-two-lists-that-can-disagree)).

**The status text never reads `current`.** It reports how many passages were placed out of how many were sent
([C-6](artifacts/current-state-findings.md#c-6-the-status-text-reports-placed-of-sent-not-where-the-writer-is)). Once it
reads `current`, a known drift becomes visible: after a local edit, the outline and the index can point at different
passages, and the index is never clamped
([C-7](artifacts/current-state-findings.md#c-7-after-a-local-edit-current-and-the-outline-can-drift-apart)).

## Target State

**The plugin state stays the only owner of `current` in both modes.**
- In Rendered mode, `current` indexes `placed(decorations)`. It is set from the ProseMirror selection inside
  `highlightsPlugin`'s `apply`.
- In Raw mode, `current` indexes `rawMarks`. It is set only through `CURRENT_META`, which `RawView` requests through a
  new `onCurrent` prop and `stepHighlight` sends.
- Plugin steps that read `placed(decorations)` do not run while the editor is in Raw mode. No second copy of `current`
  is added ([D-4](artifacts/change-decision-log.md#d-4-one-owner-of-current-in-both-modes),
  [D-6](artifacts/change-decision-log.md#d-6-the-rendered-cursor-and-edit-steps-do-not-run-in-raw-mode)).

**One rule decides which highlight the cursor is in.** That rule is `passageAt`, and both modes call it. It is "sticky":
while the cursor is still inside the current highlight, `current` does not change
([D-5](artifacts/change-decision-log.md#d-5-one-sticky-cursor-to-highlight-rule-shared-by-both-modes)). New highlights
and an AI edit still reset the outline to the first highlight
([D-11](artifacts/change-decision-log.md#trivial-decisions)). If the writer's cursor sits inside another highlight, the
next cursor move or keystroke in Rendered mode brings the outline to that highlight, because the outline follows the
cursor.

**The bubble asks about "the asked selection".**
- If the writer has selected text, that is the asked selection.
- Otherwise, if the cursor is inside the current highlight, it is the whole current passage.
- Otherwise there is no bubble.

In Rendered mode, `askedSelection` returns it. Three things read that function: where the bubble sits, what it sends,
and what it marks while the popup is open. The bubble's name says which of the first two cases applies
([D-1](artifacts/change-decision-log.md#d-1-a-click-keeps-the-cursor-and-the-bubble-asks-about-the-whole-passage),
[D-10](artifacts/change-decision-log.md#d-10-the-bubble-is-named-for-what-it-asks-about)). `RawView` applies the same
rule to its own `asked` range.

**Raw < and > put the cursor at the highlight.** `stepHighlight` in Raw mode places the textarea cursor at the start of
the new current highlight and focuses the textarea. That puts the cursor inside the current highlight, so the bubble
shows as it does after a click
([D-7](artifacts/change-decision-log.md#d-7-raw--and--put-the-cursor-at-the-highlight)).

**The status bar reports position.** `MarkdownEditor` builds the text from `current`, the placed count for the mode that
is showing, and the number of passages sent
([D-2](artifacts/change-decision-log.md#d-2-the-status-bar-reads-highlight-n-of-count)).

**The toolbar's height follows its content.** A stylesheet rule keeps the menu bar's minimum height at the
stylesheet's own 30px, overriding the library's inline value. The menu bar is then as tall as its rows
([D-14](artifacts/change-decision-log.md#d-14-the-menu-bars-height-follows-its-content)).

### Pinned contracts

**`passageAt`**, exported from `raw-view.tsx`. It lives there because `markdown-editor.tsx` already imports values from
`raw-view.tsx`, and `raw-view.tsx` imports only types back.

```ts
// `ranges` are the placed highlights in post order: placed(decorations) in Rendered, rawMarks in Raw.
// Returns the index the writer is on after the cursor lands at `pos`.
export function passageAt(ranges: readonly { from: number; to: number }[], pos: number, current: number): number;
//   ranges[current] exists && ranges[current].from <= pos && pos <= ranges[current].to   -> current   (sticky)
//   else the first i in post order with ranges[i].from <= pos && pos <= ranges[i].to       -> i
//   else                                                                                  -> current   (cursor outside every highlight)
```

`pos` is the top of the selection: `selection.from` in Rendered mode and `area.selectionStart` in Raw mode. The worked
examples below use A = [10, 21], B = [30, 45], and `current` = 0:

| `pos` | Case                               | Result |
| ----- | ---------------------------------- | ------ |
| 10    | cursor at A's start                | 0      |
| 21    | cursor at A's end                  | 0      |
| 25    | cursor between A and B             | 0      |
| 30    | cursor at B's start                | 1      |
| 15    | selection from 15 to 35 spans both | 0      |
| any   | `ranges` is empty                  | `current` |

In the 15-to-35 row the selection's `from` decides, and the bubble asks about the selected text as it does today.

Take adjacent highlights A = [10, 20] and B = [20, 30]. A cursor at 20 keeps whichever of 0 or 1 is current. That
stickiness stops < and > from bouncing back: `stepHighlight` sends `CURRENT_META` first and moves the selection second,
and the selection lands on the new highlight's range.

**The order of `apply(tr, value, oldState)`**
([D-6](artifacts/change-decision-log.md#d-6-the-rendered-cursor-and-edit-steps-do-not-run-in-raw-mode)). Steps 1 to 3
are terminal. Each returns its result, and nothing after it runs.

1. If the transaction carries highlights meta, return `drawHighlights(tr.doc, passages)`, with `current` = 0. This step
   is unchanged.
2. If it carries `CURRENT_META`, set `current` and run `outline` again. This step is unchanged.
3. If it is a Yjs-origin doc change, return `drawHighlights(tr.doc, value.passages)`, with `current` = 0. This step is
   unchanged.
4. If `isRaw(oldState)`, return today's result: the decorations mapped by `mapHighlights` when `tr.docChanged`, else
   `value`. This step is new, and it keeps Raw mode exactly as it is today.
5. On a local doc change, map the decorations. Then set `current` to the index in `placed(mapped)` whose `spec.passage`
   equals the `spec.passage` that was current before the change. If that passage is gone, use
   `Math.max(0, Math.min(current, placed(mapped).length - 1))`
   ([D-3](artifacts/change-decision-log.md#d-3-after-a-local-edit-the-outline-and-number-stay-on-the-same-passage)).
6. On a selection change or a local doc change, set
   `current = passageAt(placed(decorations), tr.selection.from, current)`.
7. If steps 5 or 6 ran, pass the decorations through `outline(…, current)`, so the `current-highlight` class stays on
   the passage at `current`.

Here is how step 5's clamp plays out. Say there are three highlights and `current` = 1. If the writer deletes highlight
1's text, `current` stays 1, which is now the former third highlight. If they delete all three, `current` = 0 and
nothing is outlined.

**`RawView.onCurrent`** ([D-4](artifacts/change-decision-log.md#d-4-one-owner-of-current-in-both-modes),
[D-12](artifacts/change-decision-log.md#d-12-raw-mode-checks-the-cursor-after-each-render-not-on-each-event)):

```ts
onCurrent: (index: number) => void; // an index into the `highlights` prop (rawMarks)
```

- `RawView` calls it from a `useEffect` keyed on the textarea selection (`selection.from`, `selection.to`) and on the
  `highlights` prop. The effect is not keyed on `current`.
- It calls it only while the textarea has focus, and only when
  `passageAt(highlights, selection.from, current) !== current`.
- Because the effect runs after render, the ranges it reads are the ones computed from the text the writer just typed.
- Because `current` is not a key, pressing < or > never triggers the check on its own.
- `MarkdownEditor` passes
  `(at) => editor.dispatch(editor.state.tr.setMeta(CURRENT_META, at).setMeta('addToHistory', false))`.
- The prop is required, since its one caller always passes it.

**Raw `stepHighlight`.** It sends `CURRENT_META` as it does today, with `count = rawMarks.length`. It then calls
`area.setSelectionRange(m.from, m.from)` and `area.focus()`, where `m = rawMarks[next]`. The cursor lands at `m.from`,
which is inside the new current highlight, so the sticky rule keeps it there.

**What the bubble asks about, and its name.** In `markdown-editor.tsx`,
`askedSelection(state: EditorState): Selection | undefined` works like this:

- It returns `state.selection` when that is not empty.
- It returns `TextSelection.create(state.doc, from, to)` when the selection is empty and `currentRange(state)` exists
  with `from <= state.selection.from <= to`.
- Otherwise it returns `undefined`.

In `RawView`, `asked` is the first that applies: the pinned range, the non-empty selection, or `highlights[current]`
when the selection is empty and inside it. `askSelection` in both modes sends the asked range's markdown and pins it.
Raw mode sends `text.slice(asked.from, asked.to).trim()`.

The button's `aria-label` and `title` are `Ask the AI about the selection` when the writer has selected text. They are
`Ask the AI about this highlight` when the asked range is the current passage. That holds in both modes. While a popup
is open, the name stays whatever it was when the button was clicked.

Two worked examples:

- **Rendered.** The post contains "The quick brown fox." with `quick brown` highlighted, and the cursor sits between "qu"
  and "ick". The button is named "Ask the AI about this highlight". Clicking it calls
  `onAskSelection({ markdown: 'quick brown', anchor })`, and `mark.ask-selection` covers "quick brown" while the popup
  is open.
- **Raw.** The text is `The **quick** fox.`, the passage `quick` is found at 4–13, and the cursor is at 7. Clicking the
  button sends `{ markdown: '**quick**', anchor }`.

**Status text grammar** ([D-2](artifacts/change-decision-log.md#d-2-the-status-bar-reads-highlight-n-of-count),
[D-13](artifacts/change-decision-log.md#d-13-the-displayed-number-never-passes-the-count)). Here
`sent = highlights.length`, `count = raw ? rawMarks.length : shown`, and `n = Math.min(current, count - 1) + 1`.

| Condition        | Text                                              |
| ---------------- | ------------------------------------------------- |
| `sent === 0`     | empty (unchanged)                                 |
| `count === 0`    | `No passages found`                               |
| `count === sent` | `Highlight ${n} of ${count}`                      |
| `count < sent`   | `Highlight ${n} of ${count} (${sent - count} not found)` |

"Not found" counts every passage that could not be placed. That includes a quote missing from the post, a quote that
appears more than once, and, in Raw mode, one that overlaps an earlier highlight.

## Surface Delta

### S-1: `passageAt` — Added

**Target state.** `passageAt(ranges, pos, current)` is exported from `raw-view.tsx`. It is the single rule deciding
which placed highlight a cursor position is in, and it follows the contract pinned under Target State.

**Behavior.** Preserving on its own. It has no observable effect until S-2 and S-5 call it.

**Why.** Both modes need the same rule, and two inline copies would drift apart. It has two call sites.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-one-sticky-cursor-to-highlight-rule-shared-by-both-modes)

### S-2: `highlightsPlugin` state `apply` — Re-scoped

**Target state.**
- `apply` keeps `current` on the highlight the writer is on in Rendered mode, following the step order pinned under
  Target State. `current` moves when the cursor lands inside another highlight. It stays with its passage through local
  edits, and it clamps when that passage is deleted. The outline always marks the passage at `current`.
- Highlight replacement and Yjs-origin changes still reset `current` to 0.
- In Raw mode, `apply` behaves exactly as it does today.
- The `onShown(shown, current)` callback and the exported `highlightsPlugin(initial, onShown, onAsk)` signature are
  unchanged.

**Behavior.** Changing. In Rendered mode:
- A click or an arrow key into a highlight outlines it, and the number follows.
- After a local deletion, the outline and the number stay on the same passage.
- After a reset by new highlights or an AI edit, the next cursor move or keystroke inside a highlight brings the outline
  there.

The writer answered "recommended" to question 1 (cursor stays where clicked) and question 3 (deletions).

**Why.** This is the writer's first complaint
([C-1](artifacts/current-state-findings.md#c-1-only--and--change-the-current-highlight-a-click-never-does)). The
deletion fix keeps the new status text from reading "3 of 2"
([C-7](artifacts/current-state-findings.md#c-7-after-a-local-edit-current-and-the-outline-can-drift-apart)).

**Depends on.** S-1.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-a-click-keeps-the-cursor-and-the-bubble-asks-about-the-whole-passage),
[D-3](artifacts/change-decision-log.md#d-3-after-a-local-edit-the-outline-and-number-stay-on-the-same-passage),
[D-6](artifacts/change-decision-log.md#d-6-the-rendered-cursor-and-edit-steps-do-not-run-in-raw-mode)

### S-3: `.highlight-status` text — Re-scoped

**Target state.** The highlight bar's status says which highlight the writer is on, using the grammar pinned under Target
State. It stays an `aria-live="polite"` region.

**Behavior.** Changing. "Highlighted 2 of 2 passages" becomes "Highlight 1 of 2". The first number follows <, >, and the
cursor. Passages that cannot be placed show in a "(k not found)" note. The writer answered "recommended" to question 2.

**Why.** This is the writer's third request
([C-6](artifacts/current-state-findings.md#c-6-the-status-text-reports-placed-of-sent-not-where-the-writer-is)).

**Depends on.** S-2, so that a deletion cannot put "3 of 2" on screen in Rendered mode.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-status-bar-reads-highlight-n-of-count),
[D-13](artifacts/change-decision-log.md#d-13-the-displayed-number-never-passes-the-count)

### S-4: `askedSelection` — Added

**Target state.** `askedSelection(state)` in `markdown-editor.tsx` returns the selection the Rendered speech bubble is
about. That is the writer's non-empty selection, or else the whole current passage when the cursor is inside it, or
else nothing.

**Behavior.** Preserving on its own. It has no observable effect until S-5 reads it.

**Why.** Three places decide on the bubble: where it sits, what it sends, and what it pins. Each of them returns early on
an empty selection today
([C-2](artifacts/current-state-findings.md#c-2-the-rendered-ask-button-needs-a-non-empty-selection-in-two-places)). One
function keeps them in agreement.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-a-click-keeps-the-cursor-and-the-bubble-asks-about-the-whole-passage)

### S-5: `askButtonSpot`, `selectedMarkdown`, the Rendered `askSelection`, and the Rendered ask button — Re-scoped

**Target state.**
- `askButtonSpot` places the bubble level with the top of `askedSelection`. For a cursor inside the current passage,
  that is the passage's first line.
- `selectedMarkdown(state, selection)` turns a given selection into markdown.
- `askSelection` sends and pins `askedSelection`.
- The button's render condition is unchanged: `spot && (focused || askingSelection || selectsCurrent(...))`. Its name
  follows the pinned naming rule.

**Behavior.** Changing. With the cursor inside the current highlight and the editor focused, the bubble now shows. It is
named "Ask the AI about this highlight", and clicking it asks about the whole passage. A non-empty selection behaves
exactly as before, name included. The writer answered "recommended" to question 1 and to question 5 (the tooltip).

**Why.** This is the writer's second complaint: the bubble is gone after a click.

**Depends on.** S-4. It also depends on S-2, so that the bubble is about the highlight the writer clicked.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-a-click-keeps-the-cursor-and-the-bubble-asks-about-the-whole-passage),
[D-10](artifacts/change-decision-log.md#d-10-the-bubble-is-named-for-what-it-asks-about)

### S-6: `RawView` — Re-scoped, with the `onCurrent` prop Added

**Target state.**
- `RawView` takes a required `onCurrent(index)` prop. It calls the prop after render when the focused textarea's cursor
  is in a different highlight, as S-1 decides.
- Its `asked` range includes the whole current passage when the cursor is inside it with nothing selected.
- Its `askSelection` sends and pins `asked`.
- Its button follows the pinned naming rule.
- `MarkdownEditor` passes `onCurrent` as a `CURRENT_META` dispatch.

**Behavior.** Changing. In Raw mode, clicking or arrowing into a highlight outlines it, updates the number, and shows the
bubble, which asks about the passage's markdown. The writer's answer was "raw mode: yes, include it", plus
"recommended" to questions 1 and 5.

**Why.** This brings Raw mode in line with Rendered mode
([C-3](artifacts/current-state-findings.md#c-3-the-raw-ask-button-needs-a-non-empty-selection-too-by-its-own-rule),
[C-4](artifacts/current-state-findings.md#c-4-raw-mode-tracks-the-caret-but-never-reports-it-and-its--and--do-not-select)).

**Depends on.** S-1.

**Migration.** `RawView`'s only caller is `MarkdownEditor`, which passes the new prop.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-one-owner-of-current-in-both-modes),
[D-12](artifacts/change-decision-log.md#d-12-raw-mode-checks-the-cursor-after-each-render-not-on-each-event),
[D-10](artifacts/change-decision-log.md#d-10-the-bubble-is-named-for-what-it-asks-about)

### S-7: `stepHighlight` in Raw mode — Re-scoped

**Target state.** In Raw mode, `stepHighlight` moves `current` along `rawMarks`, as it does today. It then places the
textarea cursor at the start of the new current highlight and focuses the textarea. In Rendered mode it is unchanged: it
selects the passage and focuses the editor.

**Behavior.** Changing. In Raw mode, < and > now put the cursor at the highlight and show the bubble. Before, they only
moved the outline. The writer answered "recommended" to question 4.

**Why.** Without this, the cursor stays in the old highlight after < or >, and the writer's next keystroke pulls the
outline back to it (review findings UX-006 and JD-003).

**Depends on.** S-6.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-raw--and--put-the-cursor-at-the-highlight)

### S-8: `.rich-editor .ProseMirror-menubar` minimum height — Re-scoped

**Target state.** The menu bar's minimum height is always 30px, set in `markdown-editor.css` with `!important`.
That overrides the inline `min-height` that `prosemirror-menu`'s `MenuBarView` writes. The menu bar is as tall as its
rows, whether or not the highlight bar is showing.

**Behavior.** Changing. After Clear, the toolbar shrinks back to one row, and its buttons sit where they did before
highlights appeared. This is the writer's own request: "the extra space where the highlights bar is, should go away
when the highlights bar itself goes away".

**Why.** The writer's reported layout bug
([C-10](artifacts/current-state-findings.md#c-10-the-menu-bar-never-gets-shorter-so-the-highlight-bars-space-outlives-it)).

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-the-menu-bars-height-follows-its-content)

## Behavior Changes

Everything below is something the writer sees. Each item was settled by the writer's request or by their answer to one
of five questions in this run.

1. **Clicking or arrowing into a highlight makes it current, in both modes** (S-2, S-6). The outline moves to it, and
   the cursor stays where the writer put it. When the cursor moves out of every highlight, the current one stays where
   it was. Question 1: "recommended".
2. **The speech bubble shows while the cursor is inside the current highlight** (S-5, S-6). It sits level with the
   passage's first line, is named "Ask the AI about this highlight", and asks about the whole passage. Selected text
   still asks about exactly the selection, under the old name. Questions 1 and 5: "recommended".
3. **The bar reads "Highlight n of count"** (S-3). It adds "(k not found)" when some passages cannot be placed, and reads
   "No passages found" when none can. Screen readers announce each change. Question 2: "recommended".
4. **After deleting text in Rendered mode, the outline and the number stay on the same passage** (S-2). If that passage
   itself is deleted, they move to the one that takes its place in the order, or to the last one. Question 3:
   "recommended".
5. **In Raw mode, < and > put the cursor at the highlight and show the bubble** (S-7). Question 4: "recommended".

6. **After Clear, the toolbar shrinks back and its buttons stop shifting** (S-8). The writer asked for this with the
   layout bug.

One refinement follows from item 1, and the writer should know about it. New highlights or an AI edit still put the
outline back on the first highlight. In Rendered mode, if the writer's cursor is inside a different highlight, the next
cursor move or keystroke moves the outline there.

## Change Units

### Unit 1: The Rendered cursor moves the current highlight

**What it does.** It adds `passageAt` and the new `apply` steps (4 to 7).

**Delta entries.** S-1, S-2.

**How you know it worked.**
- A table-driven test of `passageAt` covers each row of the worked examples, the adjacent pair, and an empty `ranges`.
- A collapsed caret placed in the second highlight moves `.current-highlight` to it, and
  `document.getSelection().toString()` stays `''`.
  - The existing `select(container, text)` helper only makes non-empty ranges. Give it a caret variant, such as a
    `caretAt` offset that calls `setBaseAndExtent(node, n, node, n)`, and keep its focus step.
  - Unverified: nobody has checked whether the test page turns a collapsed DOM selection into a ProseMirror selection
    transaction. If it does not, drive this through `view.dispatch(view.state.tr.setSelection(TextSelection.create(doc,
    p)))` instead.
- Press > to move to highlight 2, then place a caret outside every highlight. Highlight 2 stays outlined. Starting from
  highlight 1 would not show the difference.
- Adjacent highlights, meaning two quotes that touch in one paragraph: > then < step correctly, and a caret on the
  shared boundary keeps the current one.
- Deleting an earlier highlighted passage keeps the outline on the same passage. Deleting the current passage clamps as
  pinned.
  - These run against an `EditorView` built in the test with `highlightsPlugin(passages, onShown)` and a mocked
    `onShown`, which reports `current`.
  - The plugin-only pattern of the existing "typing inside a highlighted passage…" test cannot see `current`, because
    `highlightsKey` is not exported.
- An AI edit made while highlight 2 is current resets the outline to highlight 1.
- Every existing < and > test still passes, which shows the sticky rule does not undo a step.

### Unit 2: The status bar says where the writer is

**What it does.** It replaces the placed-of-sent text with the position grammar.

**Delta entries.** S-3.

**Ordering constraint.** Land it after Unit 1. Before Unit 1, a Rendered deletion can make the new text read
"Highlight 3 of 2".

**How you know it worked.** Four tests that assert the old string are updated:

| Test                                                | New string                       |
| --------------------------------------------------- | -------------------------------- |
| "highlights a passage with its label…"              | `Highlight 1 of 1`               |
| "leaves out a passage the post no longer holds…"    | `Highlight 1 of 1 (1 not found)` |
| "a highlight stays on its passage when an AI edit…" | `Highlight 1 of 1`               |
| "raw mode marks each highlighted passage…"          | `Highlight 1 of 2`               |

New tests cover:
- > says "Highlight 2 of 2".
- A caret in the second highlight says "Highlight 2 of 2".
- A quote absent from the post says "No passages found".
- The Unit 1 AI-edit test now also reads "Highlight 1 of 2".

### Unit 3: The Rendered bubble shows for a cursor inside the current highlight

**What it does.** It adds `askedSelection`, points `askButtonSpot`, `selectedMarkdown`, and `askSelection` at it, and
names the button by the pinned rule.

**Delta entries.** S-4, S-5.

**Ordering constraint.** Land it after Unit 1. Otherwise the bubble asks about the highlight that was current before
the click.

**How you know it worked.**
- New test: a caret in a highlight shows a button named "Ask the AI about this highlight". Clicking it reports `quick
  brown`, marked while asking.
- New test: a caret outside every highlight shows no button.
- New test: a drag selection from inside highlight 1 into highlight 2 keeps highlight 1 current. The button, named "Ask
  the AI about the selection", reports the selected text.
- The existing ask-button tests use no highlights and stay as they are.
- The bubble's position is checked by hand, since the test page has no layout.

### Unit 4: Raw mode follows the cursor and moves it with < and >

**What it does.** It adds `onCurrent` and its effect, the cursor-in-current case in `RawView`'s `asked`, the naming
rule, and the Raw branch of `stepHighlight`.

**Delta entries.** S-6, S-7.

**Ordering constraint.** Land it after Unit 1 for `passageAt`, and after Unit 2 for the status assertions.

**How you know it worked.** These tests use `area.setSelectionRange(k, k)` with `fireEvent.select`, the pattern of the
existing Raw ask-button test.
- A caret in the second highlight moves the mirror's `.current-highlight` and the status. The button, named "Ask the AI
  about this highlight", sends `'**quick**'`.
- Press > to reach highlight 2, then place a caret outside every highlight. `current` stays.
- Press > with the textarea caret in highlight 1. The caret lands at highlight 2's start, the textarea has focus, and
  the button shows.
- Press > to reach highlight 2, then type before highlight 1 (`fireEvent.change`, as in "raw typing keeps the
  highlights…"). The outline and "Highlight 2 of 2" stay.
- Typing inside highlight 1 while it is current keeps `current`, which shows the effect reads fresh ranges.

### Unit 5: The toolbar shrinks when the highlight bar goes away

**What it does.** It adds the minimum-height override for the menu bar in `markdown-editor.css`.

**Delta entries.** S-8.

**Ordering constraint.** None. It is independent of Units 1–4 and can land first.

**How you know it worked.** The test page has no layout, so no automated test can see a height. Check it by hand:
- Get highlights. Press Clear. The empty band is gone and the toolbar's buttons sit where they did before highlights
  appeared, as in Image #7 minus the band.
- Get highlights again. The bar reappears below the buttons, as in Image #6.

## Risks

- **The sticky rule and < / > interact.** A wrong stickiness check makes < and > bounce back between touching highlights.
  Unit 1's adjacent-highlights test catches it. Only navigation is affected.
- **Real browser event order is unverified.** Nobody ran a browser, so three orders are unconfirmed:
  - ProseMirror's mousedown and selection events in Chrome;
  - whether React's `onSelect` fires when a click only moves the textarea cursor;
  - what the textarea does on refocus.

  The Bun test page is not Chrome. Before calling them done, check Units 1, 3, and 4 by hand in the running app, in both
  modes, with the mouse and the arrow keys.
- **Screen-reader chatter.** Each cursor move into a different highlight changes an `aria-live` region, and screen
  readers announce it. Moving within one highlight does not change the text. A debounce is deferred, as noted below.
- **Mode switch with lists that disagree.** One `current` indexes both lists
  ([C-5](artifacts/current-state-findings.md#c-5-one-current-number-indexes-two-lists-that-can-disagree)). After a mode
  switch, it can point at a different passage until the writer clicks or presses < or >. D-13 keeps the displayed
  number within range.

## Deferred (YAGNI)

- **Making the Rendered and Raw highlight lists agree.** Nobody has seen them differ, and each mode is consistent on its
  own ([D-8](artifacts/change-decision-log.md#d-8-the-rendered-and-raw-lists-stay-as-they-are)).
  - Reopen when: a mode switch outlines a different passage than the one the writer was on.
- **Keeping `current` on its passage after a deletion in Raw mode.** `rawMarks` has no stable identity to follow, and a
  click or < / > corrects it.
  - Reopen when: the writer reports the outline jumping after a Raw deletion.
- **Keeping `current` on the cursor's highlight through an AI edit.** An AI edit still resets to the first highlight,
  as the writer was told ([D-11](artifacts/change-decision-log.md#trivial-decisions)).
  - Reopen when: the writer asks for it.
- **Placing the bubble on the cursor's line when a long passage's first line is scrolled out of view** (review UX-002).
  The quotes the AI highlights are a sentence or a clause, so this is not observed.
  - Reopen when: a highlighted passage runs longer than a screen.
- **A cue that the cursor has left every highlight**, and **> jumping to the first highlight after the cursor** (review
  UX-003 and UX-004). The writer's request did not ask for either.
  - Reopen when: the writer finds < and > jump somewhere unexpected after clicking outside a highlight.
- **Debouncing the status announcement for cursor moves** (review UX-005).
  - Reopen when: a screen-reader user reports stale announcements.
- **Disabling < and > when nothing is placed** (review UX-007). This was already true before this change.
  - Reopen when: someone asks.
- **A keyboard shortcut for the bubble** (review UX-009). Reaching the bubble by keyboard already worked the same way for
  selections before this change.
  - Reopen when: a keyboard-only writer asks.

## Cut for Scope

Nothing was cut. The recorded boundary states no exclusions.

## Open Items

- **Non-blocking: check browser behavior by hand.** In Chrome, click and arrow into highlights in both modes. Press <
  and > in Raw mode. Confirm the behaviors above. This confirms the event order that the tests only simulate.

## Review Findings

Three specialists reviewed the plan: `han-core:junior-developer`, `han-core:test-engineer`, and
`han-core:user-experience-designer`. These are the findings that changed it:

- **Raw typing ran the Rendered edit step against the wrong list** (junior-developer JD-001 and JD-002). Steps 4 to 7 of
  `apply` now skip Raw mode, and the plan states which list `current` indexes in each mode
  ([D-6](artifacts/change-decision-log.md#d-6-the-rendered-cursor-and-edit-steps-do-not-run-in-raw-mode)).
- **Raw < and > snapped back on the next keystroke** (JD-003, UX-006, and test-engineer S-5 note). Raw `onCurrent`
  moved into an effect that is not keyed on `current`
  ([D-12](artifacts/change-decision-log.md#d-12-raw-mode-checks-the-cursor-after-each-render-not-on-each-event)). Raw
  < and > now move the cursor, per the writer's answer to question 4
  ([D-7](artifacts/change-decision-log.md#d-7-raw--and--put-the-cursor-at-the-highlight)).
- **Stale ranges during Raw typing** (test-engineer M5). The effect reads ranges after render. This finding is
  Unverified: it rests on React render order in the test page, which nobody ran.
- **"Unchanged" reset wording** (JD-004). Target State and Behavior Changes now say the outline follows the cursor after
  a reset.
- **Unit order** (JD-007). The status text now lands after the deletion fix.
- **The button's name in the caret case** (UX-001). It is now "Ask the AI about this highlight", per question 5
  ([D-10](artifacts/change-decision-log.md#d-10-the-bubble-is-named-for-what-it-asks-about)).
- **An impossible number on screen** (UX-008). The displayed number is clamped
  ([D-13](artifacts/change-decision-log.md#d-13-the-displayed-number-never-passes-the-count)).
- **What "not found" means** (JD-005). The grammar now says it covers passages that are missing, repeated, or
  overlapping.
- **Test feasibility** (test-engineer section 2):
  - Unit 1 names the caret helper it needs and a fallback if the test page does not turn a collapsed selection into a
    ProseMirror transaction.
  - It observes `current` through a test-built view.
  - It drops the arrow-key test, which the click test already covers. Arrow keys are checked by hand.
  - Unit 3 keeps the old ask-button tests rather than rewording them.

Unverified findings, none of them blocking:
- whether collapsed selections become transactions on the test page;
- real Chrome and textarea event order;
- screen-reader queueing (UX-005);
- off-screen bubble placement (UX-002).

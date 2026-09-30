# Change Decision Log: Highlight click selection

This file records every decision made while planning the highlight click selection change. The plan itself is in
[../change-plan.md](../change-plan.md). This file keeps the question, rationale, evidence, and rejected alternatives
behind each decision. Evidence about the code as it stands is in
[current-state-findings.md](current-state-findings.md), as numbered C-N findings.

## Trivial decisions

- D-9: Arrow keys count the same as a click. A cursor moved into a highlight by any means makes it current, since a
  click and an arrow key produce the same selection transaction
  ([C-1](current-state-findings.md#c-1-only--and--change-the-current-highlight-a-click-never-does)). The writer was told
  this in question 1. Arrow keys are checked by hand, because the test page does not move the caret on keydown. —
  Referenced in plan: Behavior Changes, Change Units.
- D-11: New highlights and an AI edit still reset the outline to the first highlight, because the `drawHighlights` paths
  (steps 1 and 3 of `apply`) are unchanged. In Rendered mode, the next cursor move or keystroke inside a highlight then
  brings the outline there. The writer was told about the reset in question 3. The follow-on move was added after
  review (JD-004) and is reported to the writer in the run summary. — Referenced in plan: Target State, Behavior
  Changes, Deferred (YAGNI).

## Full decisions

### D-1: A click keeps the cursor, and the bubble asks about the whole passage

- **Question:** When the writer clicks into a highlight, should the editor keep their caret, or select the whole
  passage as < and > do?
- **Decision:** Keep the caret. The current highlight follows it. While the caret is inside the current highlight, the
  speech bubble shows level with the passage's first line, and clicking it asks about the whole passage. In Rendered
  mode that is `askedSelection(state)`, pinned in the plan's Target State. In Raw mode it is `RawView`'s `asked`, which
  includes `highlights[current]` when the selection is empty and inside it. A non-empty selection still asks about
  exactly the selection. Worked example: with `quick brown` highlighted and the caret between "qu" and "ick", the bubble
  sends `{ markdown: 'quick brown', anchor }`.
- **Rationale:** Selecting the passage on a click would make the writer's next keystroke overwrite the whole passage.
  Editing a word inside a highlight would then need a second click.
- **Evidence:** [C-2](current-state-findings.md#c-2-the-rendered-ask-button-needs-a-non-empty-selection-in-two-places),
  [C-3](current-state-findings.md#c-3-the-raw-ask-button-needs-a-non-empty-selection-too-by-its-own-rule),
  [C-8](current-state-findings.md#c-8--and--select-the-passage-which-moves-any-caret-the-writer-placed); software-architect
  proposal; user input.
- **Behavior impact:** Changing. A click or an arrow key into a highlight outlines it and shows the bubble. The writer's
  answer to question 1, verbatim: "recommended". The recommended option was (a), the cursor stays where you clicked.
- **Rejected alternatives:**
  - Select the whole passage on a click, reusing `selectCurrent`. Rejected because the next keystroke replaces the
    passage (C-8).
  - Show the bubble on a caret without changing what it sends. Rejected because `askSelection` returns early on an empty
    selection, so the click would do nothing
    ([C-2](current-state-findings.md#c-2-the-rendered-ask-button-needs-a-non-empty-selection-in-two-places)).
- **Revisit criterion:** The writer finds they want < and > and clicks to behave identically.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-4, S-5, S-6
- **Dependent decisions:** D-5, D-6, D-10, D-12
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-2: The status bar reads "Highlight n of count"

- **Question:** What exact text does the highlight bar show, and what happens to the count of passages that could not be
  placed?
- **Decision:** With `sent = highlights.length` and `count = raw ? rawMarks.length : shown`:
  - `sent === 0` shows nothing.
  - `count === 0` shows `No passages found`.
  - `count === sent` shows `Highlight ${current + 1} of ${count}`.
  - `count < sent` adds ` (${sent - count} not found)`.
  The region stays `aria-live="polite"`.
- **Rationale:** The writer asked for "{current} of {count}". The count of passages that could not be placed is the
  reason the test "leaves out a passage the post no longer holds…" exists. Keeping it as a note preserves that
  information.
- **Evidence:** [C-6](current-state-findings.md#c-6-the-status-text-reports-placed-of-sent-not-where-the-writer-is); user
  input.
- **Behavior impact:** Changing. "Highlighted 2 of 2 passages" becomes "Highlight 1 of 2", which follows the writer's
  position. The writer's answer to question 2, verbatim: "recommended".
- **Rejected alternatives:**
  - Keep the "Highlighted n of m passages" wording, with the first number meaning position. Rejected by the writer's
    choice. It also drops the count of passages that could not be placed.
  - Use `highlights.length` as the denominator. Rejected because < and > step through the placed highlights only, so the
    number could never reach the denominator.
- **Revisit criterion:** The writer rewords it.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** D-13
- **Referenced in plan:** Target State, Surface Delta (S-3), Change Units (Unit 2)

### D-3: After a local edit, the outline and number stay on the same passage

- **Question:** Once the bar shows `current`, should the plan fix the drift where a local deletion leaves the outline on
  one passage and the index on another, or past the end?
- **Decision:** Yes, in Rendered mode. On a local doc change, `apply` maps the decorations. It then sets `current` to
  the index in `placed(mapped)` whose `spec.passage` equals the one that was current. If that passage is gone, it uses
  `Math.max(0, Math.min(current, placed(mapped).length - 1))`, and then runs `outline(…, current)` again.
- **Rationale:** Without this fix, the new status text could read "3 of 2" after the writer deletes the current passage.
- **Evidence:** [C-7](current-state-findings.md#c-7-after-a-local-edit-current-and-the-outline-can-drift-apart);
  software-architect proposal; user input.
- **Behavior impact:** Changing. After a deletion, the outline and number stay on the passage the writer was on, or move
  to the nearest remaining one. The writer's answer to question 3, verbatim: "recommended".
- **Rejected alternatives:**
  - Leave the drift as it is. Rejected by the writer, and it makes "3 of 2" reachable.
  - Clamp only the displayed number. Rejected because it hides the problem: the outline and the next < / > step would
    still be on different passages.
- **Revisit criterion:** The writer reports the outline jumping after a Raw-mode deletion. The Raw half is deferred.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-2), Behavior Changes

### D-4: One owner of `current` in both modes

- **Question:** Where does "which highlight is current" live once clicks can set it in both modes?
- **Decision:** It stays only in the `highlightsPlugin` state. Rendered mode sets it inside `apply`. Raw mode reports
  the cursor through a required `RawView` prop, `onCurrent: (index: number) => void`, which takes an index into
  `rawMarks`. `MarkdownEditor` implements the prop as
  `(at) => editor.dispatch(editor.state.tr.setMeta(CURRENT_META, at).setMeta('addToHistory', false))`. When and how
  `RawView` calls it is set out in D-12. In Rendered mode `current` indexes `placed(decorations)`. In Raw mode it indexes
  `rawMarks`.
- **Rationale:** `current` already has a plugin home and a React mirror. `stepHighlight` reads the mirror and writes the
  plugin. A third store would give < and > a stale starting point.
- **Evidence:** [C-1](current-state-findings.md#c-1-only--and--change-the-current-highlight-a-click-never-does),
  [C-4](current-state-findings.md#c-4-raw-mode-tracks-the-caret-but-never-reports-it-and-its--and--do-not-select),
  [C-5](current-state-findings.md#c-5-one-current-number-indexes-two-lists-that-can-disagree); structural-analyst S1.
- **Behavior impact:** Preserving in itself. The behavior changes it enables are recorded under D-1.
- **Rejected alternatives:**
  - A separate React `current` for Raw mode. Rejected because it would be a fourth copy, and < and > would step from the
    wrong one.
  - Lifting the textarea selection into `MarkdownEditor`. Rejected because it is a larger move than one callback, with no
    second use.
- **Revisit criterion:** The Rendered and Raw lists are unified (D-8).
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-6, D-12
- **Referenced in plan:** Target State, Surface Delta (S-6)

### D-5: One sticky cursor-to-highlight rule shared by both modes

- **Question:** How does a cursor position map to a highlight, including at the boundaries, and where does that rule
  live?
- **Decision:** `export function passageAt(ranges, pos, current): number` lives in `raw-view.tsx`. It keeps `current`
  while `ranges[current].from <= pos <= ranges[current].to`. Otherwise it returns the first range, in post order, that
  contains `pos`. Otherwise it returns `current`. The worked examples are in the plan's Target State.
- **Rationale:**
  - A non-sticky "first match" rule breaks < and > when two highlights touch. `stepHighlight` sends `CURRENT_META`, then
    `selectCurrent`, and that selection would pull `current` back to the earlier highlight.
  - One exported function keeps the two modes from drifting apart.
  - It lives in `raw-view.tsx` because the value import already runs from `markdown-editor.tsx` to `raw-view.tsx`.
- **Evidence:** software-architect proposal;
  [C-5](current-state-findings.md#c-5-one-current-number-indexes-two-lists-that-can-disagree); structural-analyst S2.
- **Behavior impact:** Preserving on its own. It is used by S-2 and S-5, whose behavior changes are recorded under D-1.
- **Rejected alternatives:**
  - First match without stickiness. Rejected because touching highlights bounce < and > back.
  - An inline copy in each mode. Rejected because the two copies would drift apart.
  - A new shared module. Rejected because a third file is more structure than one function needs.
- **Revisit criterion:** A third caller appears, or the rule needs per-mode behavior.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-1)

### D-6: The Rendered cursor and edit steps do not run in Raw mode

- **Question:** Which of the new `apply` steps run while the editor shows Raw mode?
- **Decision:** None of them. Steps 1 to 3 (highlights meta, `CURRENT_META`, and a Yjs-origin change) are terminal and
  unchanged. Step 4 returns today's result when `isRaw(oldState)`: decorations mapped by `mapHighlights` on a doc change,
  or `value` otherwise. Steps 5 to 7 (re-find by passage, `passageAt`, and re-outline) run only in Rendered mode.
- **Rationale:** Raw typing reaches the hidden ProseMirror view through `replaceMarkdown` as a local doc change. In Raw
  mode `current` indexes `rawMarks`. Step 5 would look it up in `placed(decorations)`, and step 6 would read the hidden
  view's stale caret. Both could move the outline to a different passage on every Raw keystroke.
- **Evidence:** `typeRaw` → `replaceMarkdown` in `markdown-editor.tsx`;
  [C-5](current-state-findings.md#c-5-one-current-number-indexes-two-lists-that-can-disagree); software-architect
  proposal; junior-developer JD-001 and JD-002; test-engineer M4.
- **Behavior impact:** Preserving. Raw mode's `apply` is exactly today's.
- **Rejected alternatives:**
  - Gate only the `passageAt` step, as first drafted. Rejected because the re-find step then indexes the wrong list
    (JD-001).
  - Let Raw's `onCurrent` correct things afterwards. Rejected because `RawView` compares against the already-wrong
    `current`.
- **Revisit criterion:** Raw mode stops going through the hidden ProseMirror view, or the two lists are unified (D-8).
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-2), Review Findings

### D-7: Raw < and > put the cursor at the highlight

- **Question:** Should Raw-mode < and > also move the textarea cursor, so the bubble shows there as it does in Rendered
  mode?
- **Decision:** Yes. In Raw mode, `stepHighlight` sends `CURRENT_META` with `count = rawMarks.length`. It then calls
  `area.setSelectionRange(m.from, m.from)` and `area.focus()`, where `m = rawMarks[next]`. The cursor lands inside the
  new current highlight, so the sticky rule keeps it there and the caret-in-current case of D-1 shows the bubble.
- **Rationale:** Without this, the textarea cursor stays in the old highlight after < or >. The writer's next keystroke
  or cursor move would then pull the outline back to it.
- **Evidence:** [C-4](current-state-findings.md#c-4-raw-mode-tracks-the-caret-but-never-reports-it-and-its--and--do-not-select);
  user-experience-designer UX-006; junior-developer JD-003; user input.
- **Behavior impact:** Changing. In Raw mode, < and > now move the cursor to the highlight's start, focus the text, and
  show the bubble. The writer's answer to question 4, verbatim: "recommended". The recommended option was (a), match
  Rendered.
- **Rejected alternatives:**
  - Leave Raw < and > as outline-only. Rejected by the writer. The next keystroke in the old highlight would undo the
    step.
  - Select the whole passage in the textarea, as Rendered mode does. Rejected because the next keystroke would replace
    the passage, and a caret is enough to show the bubble (D-1).
- **Revisit criterion:** The writer finds < and > taking focus in Raw mode disruptive.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-7), Behavior Changes, Review Findings

### D-8: The Rendered and Raw lists stay as they are

- **Question:** Should this change make the Rendered and Raw highlight lists agree, since one `current` indexes both?
- **Decision:** No. Each mode stays consistent on its own, and the fix is deferred.
- **Rationale:** This fails the YAGNI evidence test. Nobody has seen the two lists differ, and the writer's request
  does not depend on them agreeing.
- **Evidence:** [C-5](current-state-findings.md#c-5-one-current-number-indexes-two-lists-that-can-disagree).
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Translating `current` by passage identity when the mode switches. Rejected because no observed case needs it.
- **Revisit criterion:** A mode switch shows a number past the end, or a different passage is outlined in each mode.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Risks, Deferred (YAGNI)

### D-10: The bubble is named for what it asks about

- **Question:** What should the bubble's name and tooltip say when only the cursor is in a highlight?
- **Decision:** The `aria-label` and `title` are `Ask the AI about the selection` when the writer has selected text,
  and `Ask the AI about this highlight` when the asked range is the current passage. This holds in both modes. While a
  popup is open, the name stays as it was when the button was clicked.
- **Rationale:** With a caret, nothing is selected, yet clicking sends the whole passage. The old name describes
  something the writer did not do.
- **Evidence:** user-experience-designer UX-001 (WCAG 2.4.6 and 4.1.2); user input.
- **Behavior impact:** Changing. The tooltip, and what a screen reader says, differ in the caret case. The writer's
  answer to question 5, verbatim: "recommended".
- **Rejected alternatives:**
  - Keep one name. Rejected by the writer.
- **Revisit criterion:** The writer rewords it.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5, S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-5, S-6), Review Findings

### D-12: Raw mode checks the cursor after each render, not on each event

- **Question:** When does `RawView` compare its cursor against the highlights and call `onCurrent`?
- **Decision:** In a `useEffect` keyed on `selection.from`, `selection.to`, and the `highlights` prop, but not on
  `current`. It calls `onCurrent(i)` only while the textarea has focus and only when
  `i = passageAt(highlights, selection.from, current)` differs from `current`.
- **Rationale:**
  - Called from `readSelection` inside the change handler, the check would read the ranges from before the keystroke
    (test-engineer M5).
  - Keyed on `current`, it would run right after < or > and could pull the outline back (JD-003).
  - Running after render reads fresh ranges, and it runs only when the cursor or the text actually moved.
- **Evidence:** test-engineer M5 (Unverified: React render order in the test page was not run); junior-developer JD-003;
  `readSelection` and `onChange` in `raw-view.tsx`.
- **Behavior impact:** Preserving in itself. It makes S-6 behave as D-1 intends.
- **Rejected alternatives:**
  - Call from `readSelection`, as first drafted. Rejected because it reads stale ranges and fires on refocus.
- **Revisit criterion:** A Raw test shows the outline lagging a keystroke behind.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-6), Review Findings

### D-13: The displayed number never passes the count

- **Question:** What does the bar show when `current` is past the end of the list for the mode showing?
- **Decision:** It shows `n = Math.min(current, count - 1) + 1`. `current` itself is not changed.
- **Rationale:** Two paths can still leave `current` past the end: a mode switch with lists that disagree (D-8), and a
  Raw deletion. Neither is fixed here. The clamp keeps "Highlight 3 of 2" off the screen without claiming to fix either.
- **Evidence:** user-experience-designer UX-008; test-engineer M6;
  [C-5](current-state-findings.md#c-5-one-current-number-indexes-two-lists-that-can-disagree).
- **Behavior impact:** Preserving relative to the grammar the writer chose in D-2. It affects only states that grammar
  would otherwise render as an impossible number.
- **Rejected alternatives:**
  - No clamp. Rejected because an impossible position would show on screen.
  - Clamp `current` in the plugin for Raw mode. Rejected because it is the deferred Raw-deletion work.
- **Revisit criterion:** D-8 or the Raw-deletion deferral is taken up.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-3), Review Findings

### D-14: The menu bar's height follows its content

- **Question:** How should the empty band left after Clear go away?
- **Decision:** Override the library's ratchet in `markdown-editor.css`, so the menu bar's minimum height is always the
  stylesheet's own: `.rich-editor .ProseMirror-menubar { min-height: 30px !important; }`. A stylesheet `!important`
  beats the inline `min-height` that `MenuBarView` writes. The menu bar is then as tall as its rows. It is one row of
  buttons without highlights, and that row plus the highlight bar with them.
- **Rationale:** The writer asked for the space to go away when the bar goes away. The ratchet exists to stop a menu bar
  jumping as items hide. This menu bar already has a fixed CSS minimum, and its rows change height only when the
  highlight bar shows or hides, which is exactly the change the writer wants to see.
- **Evidence:** [C-10](current-state-findings.md#c-10-the-menu-bar-never-gets-shorter-so-the-highlight-bars-space-outlives-it);
  the writer's Images #6 and #7.
- **Behavior impact:** Changing. After Clear, the toolbar shrinks back to one row and its buttons return to where they
  were before highlights appeared. The writer asked for this: "the extra space where the highlights bar is, should go
  away when the highlights bar itself goes away".
- **Rejected alternatives:**
  - Clearing `bar.style.minHeight` from a layout effect when the highlight bar hides. It works because the library only
    rewrites the value when the bar grows past its remembered maximum, but it depends on that detail of the library's
    internals. The CSS rule says the intent in one line.
  - Moving the highlight bar out of the menu bar. Rejected because it sits there on purpose, so it stays in view with
    the formatting buttons (the comment above its portal in `markdown-editor.tsx`).
- **Revisit criterion:** The menu bar visibly jumps when some other item hides or wraps.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-8), Change Units (Unit 5)

# Scope Boundary: Highlight click selection

## Work Item

No work item exists. The operator's request, typed when invoking `plan-a-change` on 2026-09-30, is the only boundary
this run has.

## Stated Scope

> a few fixes to make ... currently, when i use the < and > buttons to navigate through the highlights, the speech
> bubble pops up correctly: [Image #4]. however, when i click into a highlight, the currently selected highlight does
> not change, and the speech bubble is gone: [Image #5] (note the | cursor position in the word "any", showing that i
> clicked here). the speech bubble needs to show up when i click into an item, as the currently selected highlight also
> moves into the one i clicked. also, the "Highlighted # of # passages" text does not reflect the current selected
> highlight. i want this text to be update the "{current} of {count}" text, as i navigate through through the
> highlights - whether i'm using the buttons or clicking into a highlight item

## Stated Exclusions

None stated.

## Operator-Stated Scope

Answers given in the confirmation turn, quoted:

- On Raw mode: "raw mode: yes, include it." Clicking into a highlight in the Raw view gets the same fix as the
  Rendered view.
- On the area and the output folder: "plan looks good". The area is the editor component and its highlight bar
  (`src/ui/documents/markdown-editor/markdown-editor.tsx`), the Raw view (`raw-view.tsx`), and their tests. The chat,
  the question popup, and the server are not expected to change. The plan goes in
  `docs/changes/highlight-click-selection/`.

- A later addition to the same request, typed after the plan was first presented (2026-09-30), quoted:

  > also add this in this plan: fix the visual bug where clearing the current highlights does not reduce the container
  > item size: [Image #6] to [Image #7] - note the space where the "highlights" bar is still there, but the actual
  > highlights bar is gone. also, the standard toolbar shifted down a few pixels when it disappeared. the extra space
  > where the highlights bar is, should go away when the highlights bar itself goes away

## Direction of Travel

Unanswered. Not asked: the request fixes behavior and names nothing being deprecated or replaced.

## Visual Material Received

Four screenshots arrived with the request and are ordinary context for this skill (no `ui-designs/` folder is kept):
Image #4 shows the speech bubble beside the outlined current highlight after pressing < or >; Image #5 shows the caret
placed in "any" inside the second highlight, the outline still on the first, and no speech bubble. Image #6 shows the
toolbar with the highlight bar ("Highlighted 1 of 1 passages", <, >, Clear) beneath it. Image #7 shows the same page after
Clear: the highlight bar is gone, but the toolbar keeps its height, leaving an empty band, and its buttons sit a few
pixels lower.

## Record Provenance

Established by `han-planning:plan-a-change` in this run, from the operator's typed request and their confirmation-turn
answers. No prior record existed and no conflict was resolved.

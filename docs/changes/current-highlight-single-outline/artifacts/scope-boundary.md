# Scope Boundary: Current highlight single outline

## Work Item

No work item exists. The operator's request, typed when invoking `plan-a-change` on 2026-10-01, is the only boundary
this run has.

## Stated Scope

> some visual errors with highlighting. it seems any time we change rendered html tags, such as introducing an `<a>` tag
> inside of a `<p>` tag, we get doubled up highlighting. see this example: [Image #1] - it looks like the
> `current-highlight` css class is applied to all elements in the highlighted area: [Image #2]. it only needs to be
> applied to the outermost element for the highlight

## Stated Exclusions

None stated.

## Operator-Stated Scope

Answers given in the confirmation turn, quoted:

- On the larger box drawn around the whole paragraph when it is selected as a block: "1: leave it out of the plan."
- On also tidying the small breaks in highlights the writer is not on: "2: pick what you think is best, we'll adjust
  later if it's not what i want, visually."
- On the output folder `docs/changes/current-highlight-single-outline/`: "3: that's fine".

The confirmation turn also stated the area: the Rendered view's highlight code in
`src/ui/documents/markdown-editor/markdown-editor.tsx`, its stylesheet `markdown-editor.css`, and their tests. The Raw
view is expected to stay as it is. The operator did not object.

## Direction of Travel

Not asked. The request names nothing being deprecated, replaced, or migrated away from.

## Visual Material Received

None kept on disk: `plan-a-change` does not use the visual-material convention. Two screenshots arrived with the request.
The first shows the current highlight drawn as a separate box around each piece of a paragraph containing links. The
second shows the DOM: sibling `mark.ai-highlight.current-highlight` elements, some nested inside `<a>`.

## Record Provenance

Established by `plan-a-change` on 2026-10-01. No earlier record existed in this folder.

# Scope Boundary: Header Full Width, Boxed Panels

## Work Item

No ticket, issue, or pull request exists. The user's request, typed when invoking `plan-a-change` on 2026-10-19, is the
only boundary this run has.

## Stated Scope

The user's request, quoted:

> make the header [Image #3] full browser width. put the file list below the header, instead of to the side of it,
> wrapped in a rounded corner box with a bit of margin around it. do the same with the chat sidebar.

## Stated Exclusions

None stated

## Operator-Stated Scope

Partway through, the user added a delivery instruction, quoted: "make a branch, commit and push as you go, open draft
pr".

The user accepted the area restated in the confirmation turn ("looks good"):

- The top bar (3pitor, Home, the post's name, Saved or Unsaved, the Formatted / Markdown switch, Save) spans the whole
  window. The post panel and the chat panel start below it rather than beside it.
- The post panel and the chat panel each sit in a rounded box with a small gap around it. The editor and its formatting
  toolbar stay in the middle, unboxed.
- The landing page (the post table) shares the bar, so the bar runs full width there too. The post table is not boxed.
- The drag bars that resize the two panels sit in the gaps between the boxes, drawn only while hovered or focused.

## Direction of Travel

Nothing is being deprecated or replaced. The two panels and their drag bars stay; only where they sit and how they are
drawn changes.

## Visual Material Received

None received

The request carried one screenshot of today's header (3pitor, Home, the post's name, Saved, the Formatted / Markdown
switch, Save, and the formatting toolbar under it). It is context for which bar "the header" means, not a design, and
`plan-a-change` keeps no visual material.

## Record Provenance

Established by `plan-a-change` in this run, from the user's request. No earlier record was inherited.

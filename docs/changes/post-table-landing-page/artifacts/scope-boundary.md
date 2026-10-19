# Scope Boundary: Post Table Landing Page

## Work Item

No ticket, issue, or pull request exists. The user's request, typed when invoking `plan-a-change` on 2026-10-19, is the
only boundary this run has.

## Stated Scope

The user's request, quoted:

> i want to update the landing page that loads when the app first starts. instead of just a message saying to select a
> post, i want a table that shows all the current posts to choose from. add column sorting to table. add search where it
> searches by name and content. the column list should be the post title and an actions column that has no column
> label. the actions column should contain a pop up menu with options for edit, rename, delete. also, when i click on the
> post title, it opens the post.

## Stated Exclusions

From the confirmation turn, quoted: "leave the sidebar for now. we'll make changes to it later"

The Posts sidebar (`src/ui/documents/post-list/`) keeps its current look and behavior. Sharing its Rename and Delete
dialogs with the table is allowed only if what the sidebar does stays the same.

## Operator-Stated Scope

The user accepted the area restated in the confirmation turn ("looks good"):

- The editor's empty state ("Pick a post to start").
- The sidebar's Rename and Delete dialogs, so the table can reuse them rather than copy them, without changing the
  sidebar's behavior.
- Server-side support if searching post text needs it, since the post list the page loads today carries titles only.

## Direction of Travel

The Posts sidebar stays for now and will change later: "leave the sidebar for now. we'll make changes to it later". It
is not being removed in this change.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` in this run, from the user's request and the confirmation turn. No earlier record was
inherited.

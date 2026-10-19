# Scope Boundary: Post Title and Heading Sync

## Work Item

No ticket, issue, or pull request exists. The user's request, typed when invoking `plan-a-change` on 2026-10-19, is the
only boundary this run has.

## Stated Scope

The user's request, quoted:

> i want the post title to always be in sync with the title row (the '#' section in the markdown). when i rename a post
> via the menus, update the post title in the markdown document, and vice-versa

## Stated Exclusions

None stated

## Operator-Stated Scope

Partway through, the user added a delivery instruction, quoted: "create a branch, commit and push as you go, open a
draft pr".

## Direction of Travel

The post store's contract says today that a post's title and any `#` heading in its body are independent and can
disagree (`src/posts/posts.ts`, `Post.body`). This change makes them agree for posts. Nothing is deprecated.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` in this run. No earlier record existed.

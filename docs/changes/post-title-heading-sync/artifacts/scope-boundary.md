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

The user accepted the area restated in the confirmation turn ("looks good"):

- The title row is the post body's first level-1 heading (`#`, not `##` or deeper).
- Rename from a menu (a row's menu in the post table, the open post's menu in the post panel) makes the post's first
  `#` line read the new title. A post with no `#` line gets one at the top.
- Editing the title row and saving makes the post's title follow, shown in the post table and post panel. The title
  follows on Save, not on every keystroke.
- A new post, made by the writer or by Claude, starts with `# <its title>` rather than empty.
- Posts only. Research documents keep their separate titles.
- The area: the post store's contract in `src/posts/`, the post routes in `src/server/posts/`, rename and save in
  `src/ui/documents/`, and Claude's post-making tool in `src/engine/chat/tools/`.

## Direction of Travel

The post store's contract says today that a post's title and any `#` heading in its body are independent and can
disagree (`src/posts/posts.ts`, `Post.body`). This change makes them agree for posts. Nothing is deprecated.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` in this run. No earlier record existed.

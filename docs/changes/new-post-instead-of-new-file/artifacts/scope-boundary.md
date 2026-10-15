# Scope Boundary: New Post Instead of New File

## Work Item

No ticket, issue, or pull request exists. The operator's written request, typed when invoking `plan-a-change`, is the
only boundary this run has.

## Stated Scope

> i want to move the file system for blog posts away from managing raw files, and toward managing an entire blog post as
> a unit. under the hood, this will still be represented by files and folders, but there needs to be an abstraction on
> top of that. the intent is for the UI to no longer have a "new file" option, but a "new post" option instead. the "new
> folder" and other options still remain, so users can organize things. when a user clicks "new post", it ask for the
> post's working title. this needs to take the user input and sanitize it for creating folders that are file system
> compatible (i think it does this already). once that new folder is created, immediately add a "draft.md" file with the
> title of the file being the exact string that the user input for the working title (sanitizing it only for markdown
> compatibility).

## Stated Exclusions

None stated. The request does say what stays: "the "new folder" and other options still remain, so users can organize
things."

## Operator-Stated Scope

> create a branch to house this change set, not just the plan. commit and push as you go. create a draft pr

A process instruction, not scope: the plan and the code that builds it share one branch and one draft pull request.

## Direction of Travel

Answered in the request: the "New file" option is being replaced by "New post". New folder, Rename, Move to…, and
Delete stay.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` on 2026-10-15 from the operator's request. Not inherited. No conflicting work item was
supplied.

# Scope Boundary: Live workspace file watching

## Work Item

No work item exists. The operator's requests in this conversation are the only boundary this run has: the `/research`
request that produced `docs/research/live-workspace-file-watching.md`, the scenarios the operator added during that
research, and the `/plan-a-change` invocation that asked to plan it.

## Stated Scope

From the research request:

> i want to add filesystem events listening for the workspace that is loaded into 3pitor. do some research on how to
> properly handle that within this project, optimizing it so it can handle a massive number of files and folders being
> watched (potentially tens of thousands of files and folders), with the goal of having the Documents pane and editor
> content dynamically update to know when a new file or folder is there, when something is changed in a meaningful way,
> and when something is deleted...

From the scenarios the operator added:

> for context, imagine a git revert a file change, or use another app to edit a file i have loaded in 3pitor, or delete
> a folder entirely. i want both the documents pane and editor to update dynamically, without losing my scroll location
> spot in the editor

## Stated Exclusions

None stated.

## Operator-Stated Scope

> to add this as a feature

In the confirmation turn the run proposed the area as the server watching the workspace, the Documents pane refreshing,
and the open editor following disk changes. It also proposed leaving out an AI turn in progress racing a disk change, so
an AI edit started before a revert can still land on the reverted text. The operator answered:

> yup

## Direction of Travel

Unanswered. Nothing the work names is being deprecated, replaced, or migrated away from.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` on 2026-10-01 from the operator's own words in this conversation. Not inherited from
another record.

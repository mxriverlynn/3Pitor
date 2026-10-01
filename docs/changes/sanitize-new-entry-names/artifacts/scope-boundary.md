# Scope Boundary: Sanitize New File and Folder Names

## Work Item

No ticket, issue, or pull request exists. The operator's written request, typed when invoking `plan-a-change`, is the
only boundary this run has.

## Stated Scope

> when a new file or folder is created, i need the name stripped of special characters that don't play nice with files
> and folders. additionally, i need new filenames to always have ".md" appended as the file extension, when someone
> creates a file that doesn't explicitly have ".md" at the end of the name. also, be sure to strip beginning and ending
> spaces from names, so that doesn't cause problems

## Stated Exclusions

None stated.

## Operator-Stated Scope

> create a branch for this work to be implemented, commit and push as you go, open draft pr

> and when you're completely done writing the plan, /tdd it

Both are process instructions, not scope: the plan is written on its own branch with a draft pull request, and the
plan is then built test-first in the same run.

## Direction of Travel

Unanswered. The request names no part of the code being deprecated, replaced, or migrated away from.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` on 2026-10-01 from the operator's request. Not inherited. No conflicting work item was
supplied.

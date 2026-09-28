# Scope Boundary: Restructure src/ by Package, Feature, and Component

## Work Item

No ticket, issue, or pull request exists. The owner's request, typed as a session goal on 2026-09-28, is the only
boundary this run has.

## Stated Scope

> run /architectural-analysis against the code, and then use a combination of /plan-a-change, /refactor, and /tdd as
> needed, to restructure both the front end and backend code. what i want, is files and folders organized by package
> (like they currently are), then by feature, then by component within the feature. components that are shared between
> features should live in a components folder that is properly scoped to everything that shares it. anything shared
> between packages should live in a shared package. be sure to create a new branch for all of this work, commit as you
> go, and open a draft PR. i'll be stepping away from my computer, so i need you to make the decisions around this and
> justify every decision you made. keep a running log of all changes that are made, in an appropriate docs/changes/
> folder for this change set

## Stated Exclusions

None stated.

## Operator-Stated Scope

- "restructure both the front end and backend code": `src/ui` and `src/server`, plus `src/shared` as the package the
  rule "anything shared between packages" points at.
- "i need you to make the decisions around this and justify every decision you made": every question this skill would
  normally ask the owner is decided here instead, and recorded with its reasoning in `change-decision-log.md`.

## Direction of Travel

Unanswered. The owner is away. Nothing in the request says any module is being deprecated or replaced. The request is a
reorganization, so this run reads it as "keep every behavior; change where code lives."

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` in this run. No earlier record existed in `docs/changes/restructure-by-feature/`. The
confirmation turn was not held because the owner is away and asked for autonomous decisions. The restatement it would
have carried is in the Operator-Stated Scope section above.

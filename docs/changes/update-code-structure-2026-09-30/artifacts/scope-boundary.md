# Scope Boundary: Update the Code Structure

## Work item

No ticket, issue, or pull request. The owner's request, as written to the `update-code-structure` skill, is the only
boundary this run has.

## Stated scope (verbatim)

> files and folders organized by package (like they currently are), then by feature, then by component within the
> feature. components that are shared between features should live in a components folder that is properly scoped to
> everything that shares it. anything shared between packages should live in a shared package.

The skill adds, as the owner's standing rule: "No behavior changes. Entry points stay at their package roots, so
`Makefile` and `package.json` paths keep working."

## Stated exclusions

- Behavior changes of any kind. Findings that would change behavior are recorded as follow-ups, not built.
- Entry points leave their package roots.

## Confirmation

The planning skill's confirmation turn was not taken, because the owner is away and asked for the run to proceed
unattended ([D-4](change-decision-log.md#d-4-take-the-scope-boundary-as-recorded-without-a-confirmation-turn)).

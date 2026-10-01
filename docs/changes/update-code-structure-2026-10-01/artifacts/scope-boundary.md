# Scope Boundary: Update the Code Structure (2026-10-01)

## Work item

No ticket, issue, or pull request. The owner's request, as written to the `update-code-structure` skill, is the only
boundary this run has. The owner's arguments for this run ("create a branch, commit as you go, open a draft mode pr")
govern where the work lands, not what it touches.

## Stated scope (verbatim)

> - **Package first.** `src/server/` (runs in Bun), `src/ui/` (runs in the browser), and `src/shared/` (used by both).
>   No file in `src/ui/` imports from `src/server/`.
> - **Then feature.** Each package is split into feature folders. A capability that spans both packages uses the same
>   feature name in each.
> - **Then component.** A feature with more than one component has one folder per component. A component folder holds
>   the component's module, the helpers only it uses, and its tests and CSS.
> - **Shared code goes at the lowest scope that covers every user.** Code shared by the components of one feature goes
>   in `<feature>/components/`. Code shared by the features of one package goes in `<package>/components/`. Code
>   shared by both packages goes in `src/shared/`.
> - **No behavior changes.** Entry points stay at their package roots, so `Makefile` and `package.json` paths keep
>   working.

## Stated exclusions

- Behavior changes of any kind. Findings that would change behavior are recorded as follow-ups, not built.
- Entry points leave their package roots.

## Confirmation

The planning skill's confirmation turn was not taken, because the owner is away and asked for the run to proceed
unattended ([D-4](change-decision-log.md#d-4-take-the-scope-boundary-as-recorded-without-a-confirmation-turn)).

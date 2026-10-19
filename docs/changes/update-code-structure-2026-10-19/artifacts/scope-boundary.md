# Scope Boundary: Update the Code Structure (2026-10-19)

## Work item

No ticket, issue, or pull request. The owner's request, as written to the `update-code-structure` skill, is the only
boundary this run has. The owner's instruction during this run ("create a branch for this, commit and push as you go,
open draft pr when you're done") governs where the work lands, not what it touches.

## Stated scope (verbatim)

> - **Package first.** Every top-level folder under `src/` that holds `.ts` or `.tsx` files is a package. Step 2
>   discovers them. Folders with no source code, such as fixtures or embedded data, are not packages and stay where they
>   are. Imports between packages run one way only:
>   - `src/cli/` is the process entry point. Nothing imports it.
>   - Another package reaches a package only through that package's entry module, `<package>/<package>.ts`, plus any
>     other modules the README names as part of that package's public surface.
>   - `src/ui/` runs in the browser and imports no Bun-side package.
>   - `src/shared/` is used by both the browser and Bun code, and imports no package.
>   - Each package's own import rules are in the README's layout section. Read them in Step 2, and treat them, along
>     with any boundary tests a package has (such as `src/file-system/boundary.test.ts`), as the current rules for that
>     package.
> - **Then feature.** Each package is split into feature folders. A capability that spans packages uses the same
>   feature name in each.
> - **Then component.** A feature with more than one component has one folder per component. A component folder holds
>   the component's module, the helpers only it uses, and its tests and CSS.
> - **Shared code goes at the lowest scope that covers every user.** Code shared by the components of one feature goes
>   in `<feature>/components/`. Code shared by the features of one package goes in `<package>/components/`. Code shared
>   by the browser and Bun code goes in `src/shared/`.
> - **No behavior changes.** The one entry point, `src/cli/cli.ts`, stays at its package root, so `Makefile` and
>   `package.json` paths keep working.

## Stated exclusions

- Behavior changes of any kind. Findings that would change behavior are recorded as follow-ups, not built.
- `src/cli/cli.ts` leaves its package root.

## Confirmation

The planning skill's confirmation turn was not taken, because the owner is away and asked for the run to proceed
unattended ([D-4](change-decision-log.md#d-4-take-the-scope-boundary-as-recorded-without-a-confirmation-turn)).

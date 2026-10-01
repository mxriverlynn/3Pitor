# Scope Boundary: Actions Button Pinned to the Panel Edge

## Work Item

No ticket, issue, or pull request exists. The operator's written request, typed when invoking `plan-a-change`, is the
only boundary this run has. It came with one screenshot of the Documents panel showing long folder names cut off at the
panel's right edge.

## Stated Scope

> when file and folder names require horizontal scrolling, the "..." menu button is hidden behind the content that needs
> to be scrolled. i want to change this so that the "..." menu floats above the actual file / folder name, and has it's
> right edge anchored to the visible right edge of the documents panel. that way i can still see and click the "..."
> without having to horizontal scroll

## Stated Exclusions

None stated.

## Operator-Stated Scope

Confirmed in the scope turn on 2026-10-01 ("2: yes. looks good"):

- The area is the Documents tree: `src/ui/documents/file-tree/file-tree.tsx` and `file-tree.css`, plus the shared
  `src/ui/components/menu/menu.css` only if needed.
- The menu that opens from "…" also opens at the visible right edge, beside the pinned button.
- The "+" button beside the DOCUMENTS heading is out of scope.
- Long names keep scrolling sideways as they do today; the show-on-hover behavior of "…" is kept.
- Escalations are settled by the run and reported afterwards (standing preference recorded in memory).

Process instructions given mid-run, not scope:

> make a branch for this implementation, commit and push as you go, open a draft pr

> when you're completely done with the plan, /tdd it

> commit and push as you go, for the rest of this session

## Direction of Travel

Unanswered. The request names no part of the code being deprecated, replaced, or migrated away from.

## Visual Material Received

One screenshot, pasted inline with the request. Ordinary context; `plan-a-change` keeps no `ui-designs/` folder.

## Record Provenance

Established by `plan-a-change` on 2026-10-01 from the operator's request. Not inherited. No conflicting work item was
supplied.

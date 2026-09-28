# Scope Boundary: Load app skills and highlight review

## Work Item

No work item exists. The operator's request, typed when invoking `plan-a-change` on 2026-09-28, is the only boundary
this run has.

## Stated Scope

> i added a new skill to src/skills/ - i want all skills from this folder to be loaded and available for to use from the
> app, so i can tell it to `/collaborative-draft-editing`. also, when this skill has information for me to review, i
> want the editor UI to highlight the things it's talking about so i can have a visual reference to what it's saying

## Stated Exclusions

None stated.

## Operator-Stated Scope

Answers given in the confirmation turn, quoted:

- On how far the plan goes: "go with recommendation". The recommendation was: load and run the app's skills plus the
  editor highlighting, and adapt `collaborative-draft-editing` so it runs its section-by-section review inside the app,
  with its shell and git steps dropped or replaced. Explicitly **not** in scope: giving the app's AI shell commands, git
  commits, or the ability to write non-post files (the rejected option (b)).
- On the misspelled folder: "oops - yes, it should be "src/skills"". The folder `src/skillls/` is renamed to
  `src/skills/`.
- On the executable: "yes, they must be included in the executable". Skills in `src/skills/` must load when 3pitor runs
  as the compiled `build/3pitor` binary, not only from source.
- On the area: "yes". The area is skill loading and the AI's tools on the server (`src/server/`), the wire types
  (`src/shared/wire.ts`), and the chat panel and editor in the UI (`src/ui/`), plus the skill's own files.
- On the output folder: "yes" to `docs/changes/load-app-skills-and-highlight-review/`.

## Direction of Travel

Unanswered. Not asked: the request adds a capability and names nothing being deprecated or replaced. Workspace skills in
`<workspace>/.claude/skills/` stay as they are.

## Visual Material Received

None received

## Record Provenance

Established by `han-planning:plan-a-change` in this run, from the operator's typed request and their confirmation-turn
answers. No prior record existed and no conflict was resolved.

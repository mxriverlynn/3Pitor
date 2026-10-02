---
name: update-code-structure
description: >
  Restructures 3pitor's src/ code, the cli, server, engine, file system, and UI, so files and folders are organized by package, then by
  feature, then by component within the feature. Components shared between features go in a components folder scoped
  to everything that shares them, and code shared between packages goes in src/shared. Runs unattended from start to
  finish. It runs architectural-analysis, then plan-a-change, then refactor and tdd for each unit of work. It commits
  each step to the current branch and keeps a running change log in docs/changes that justifies every decision. Use
  when the owner asks to update, re-apply, or enforce the package, feature, and component layout, or to reorganize the
  code structure while they are away. Does not change behavior. Behavior-changing findings are logged as follow-ups.
  Does not create branches, push, or open PRs. To restructure one named area interactively, use refactor. To plan a
  restructure without executing it, use plan-a-change.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Edit, Write, Skill, Bash(git status *), Bash(git branch *), Bash(git add *), Bash(git commit *), Bash(git restore *), Bash(git clean *), Bash(make *), Bash(mkdir *), Bash(date *)
---

# Update Code Structure

The steps below are the whole skill. This skill is a thin coordinator. `han-coding:architectural-analysis`,
`han-planning:plan-a-change`, `han-coding:refactor`, and `han-coding:tdd` do the analysis, planning, and code changes.
This skill validates, forwards, captures what each one produced, commits, and logs.

**It runs unattended.** The owner has stepped away. Never ask the owner a question and never wait for approval,
BECAUSE nobody is there to answer, and a question left pending stops the whole run. When a decision comes up, make it
from evidence: the code, the README, earlier change sets in `docs/changes/`, and the target layout below. Record the
decision as a D-N entry in the decision log. The owner reviews those decisions when they return. The one kind of stop
that is allowed is a hard failure that Step 1 or Step 5 names. When one happens, report it and end the run. Do not ask
the owner what to do.

**It commits to the current branch and goes no further.** Commit each step to whatever branch is checked out. Never
create or switch branches, push, or open a pull request, BECAUSE the owner decides where this work lands and who sees
it.

## Target layout

These are the owner's rules. The layout section of `README.md` ("How `src/` is laid out") describes how they are
applied today. Read that section in Step 2, and treat it as the current interpretation of these rules.

- **Package first.** Six packages, with imports running one way only:
  - `src/cli/` (runs in Bun) is the process entry point. It imports the engine only through `engine/engine.ts`, the
    server only through `server/server.ts`, and the file system only through `file-system/file-system.ts`. Nothing
    imports it.
  - `src/server/` (runs in Bun) holds all the HTTP and WebSocket code. Its production code imports the engine only
    through `engine/engine.ts`, and only `server.ts` imports `ui/index.html`.
  - `src/engine/` (runs in Bun) holds everything else, knows nothing about HTTP or WebSockets, and does no file I/O
    itself. It imports only `src/shared/`, `src/file-system/file-system.ts` (contract symbols only, never a backend),
    and npm packages.
  - `src/file-system/` (runs in Bun) holds every runtime file read and write. Anything outside it imports only
    `file-system/file-system.ts`, and it imports no other package. `src/file-system/boundary.test.ts` enforces this.
  - `src/ui/` (runs in the browser) imports none of cli, server, engine, or file-system.
  - `src/shared/` (used by the browser and Bun code) imports no package.
- **Then feature.** Each package is split into feature folders. A capability that spans packages (cli, server,
  engine, ui) uses the same feature name in each.
- **Then component.** A feature with more than one component has one folder per component. A component folder holds
  the component's module, the helpers only it uses, and its tests and CSS.
- **Shared code goes at the lowest scope that covers every user.** Code shared by the components of one feature goes
  in `<feature>/components/`. Code shared by the features of one package goes in `<package>/components/`. Code shared
  by the browser and Bun code goes in `src/shared/`.
- **No behavior changes.** The one entry point, `src/cli/cli.ts`, stays at its package root, so `Makefile` and
  `package.json` paths keep working.

## Step 1: Preflight and baseline

1. Run `git status --porcelain`. If it fails, the folder is not a git repository. If it prints anything, the working
   tree has uncommitted changes. In either case, report which and end the run, BECAUSE each unit's commit, and the
   rollback of a failed unit, only work cleanly on a clean tree.
2. Run `git branch --show-current` and record the branch in the change log. If it prints nothing (a detached HEAD),
   end the run, BECAUSE commits made there are easy to lose.
3. Run `make test`, which type-checks and runs both test suites, and record the pass counts as the baseline. If it
   fails, report the output and end the run, BECAUSE a restructure can only be proven behavior-preserving against a
   suite that was green to begin with.

## Step 2: Start the change set

1. Run `date +%Y-%m-%d`. Set `{slug}` to `update-code-structure-{date}`. If `docs/changes/{slug}` already exists,
   append `-2`, `-3`, and so on until the name is unused.
2. Run `mkdir -p docs/changes/{slug}/artifacts`.
3. Read the layout section of `README.md` and the `change-log.md` of the most recent earlier structure change set in
   `docs/changes/` (for example `restructure-by-feature`). Their decisions are precedent. Follow a precedent unless the
   code has since changed in a way that breaks it. When you depart from one, write a D-N entry that says why.
4. Write `docs/changes/{slug}/change-log.md` using the skeleton in
   [references/change-log-format.md](references/change-log-format.md). Include the branch and the Step 1 baseline.

## Step 3: Run the architectural analysis

Invoke `han-coding:architectural-analysis` through the Skill tool on `src/`. In the call, pass the owner's goal
verbatim (the Target layout section above) and these overrides:

- Run unattended. Choose the analysis size from evidence, and do not ask the owner anything.
- Write the report to `docs/changes/{slug}/artifacts/architectural-analysis.md`.
- Focus on what would make moving files unsafe: path arithmetic tied to a file's location, cross-package imports,
  shared mutable state, and duplicated code across packages.

When it returns, confirm the report file exists and add a change-log entry. Run `git add docs/changes/{slug}` and
commit with the message `Add the architectural analysis for updating the code structure`. Then continue to Step 4. The
analysis is an input to this skill, not its result.

## Step 4: Plan the change, or stop if nothing is out of place

1. Compare every file under `src/` against the Target layout. List each file that sits in the wrong place: a feature
   file at a package root, components of a multi-component feature that share one folder, a shared module scoped too
   high or too low, or cross-package code outside `src/shared/`. Also list the analysis findings that block a move.
2. If the list is empty, write a "No changes needed" section in the change log that explains the evidence. Commit it
   with the message `Record that the code structure needs no changes`, report it, and end the run.
3. Otherwise, invoke `han-planning:plan-a-change` through the Skill tool. Pass the owner's goal verbatim, the list from
   item 1, and the analysis report path. Pass these overrides:
   - Run unattended. Resolve every interview question from evidence and record each one as a D-N entry in
     `docs/changes/{slug}/artifacts/change-decision-log.md`, using the decision format in
     [references/change-log-format.md](references/change-log-format.md).
   - Write the plan to `docs/changes/{slug}/change-plan.md` and its companion files to `docs/changes/{slug}/artifacts/`.
   - Keep the change a pure restructure. Record behavior-changing findings as follow-ups, not units.
   - Split the work into ordered units. Tag each unit either `tdd` (it adds new code or behavior that must be driven by
     a test, such as a new shared module or a path anchor) or `refactor` (it moves or renames existing code). Put the
     units that make moving safe first, and name the earlier units each unit depends on.
4. Confirm that the plan and the decision log exist and add a change-log entry. Run `git add docs/changes/{slug}` and
   commit with the message `Plan the code structure update`. Then continue to Step 5.

## Step 5: Carry out each unit

Work through the plan's units in order. For each unit:

1. Invoke `han-coding:tdd` for a `tdd` unit, or `han-coding:refactor` for a `refactor` unit. Pass the unit text from
   the plan verbatim. Tell the sub-skill to run unattended, to record any new decision as the next D-N entry in the
   decision log, and not to commit, BECAUSE this skill makes exactly one commit per unit, so a unit can be reverted as
   a whole.
2. When it returns, run `make test`. The suites must be green and must still include every baseline test. A test
   count lower than the baseline, other than a count the plan explicitly moves or merges, counts as a failure, BECAUSE
   a moved test file that stops being discovered would fail silently. `make test` discovers Bun-side tests only under
   `src/cli`, `src/server`, `src/engine`, `src/shared`, and `src/file-system`, so a test moved anywhere else stops
   running.
3. If the unit is green, add a change-log entry with what changed, why, and the D-N entries behind it. Run `git add -A`
   and commit with a message that names the unit. Commit after every unit, BECAUSE a failed later unit can then be
   rolled back without losing the finished ones.
4. If the unit can't be made green, roll it back to the last commit with `git restore --staged --worktree .` and
   `git clean -fd src docs/changes/{slug}`. Then log it under "Units not done" with the failing output, mark every
   later unit that depends on it as not started, and commit the log. Continue with the next unit that does not depend
   on it. If two units in a row fail, skip to Step 7, BECAUSE repeated failures mean the plan no longer matches the
   code.

After the last unit, continue to Step 6.

## Step 6: Update the README and check the build

1. Rewrite the layout section of `README.md` so it describes the tree as it now stands, feature by feature, and follows
   the rules in the Target layout. Commit with the message `Describe the updated code structure in the README`.
2. Run `make test` and `make check-build`. `make check-build` proves that the compiled binary still embeds the app's
   skills after the moves. If either fails, fix the path that broke, log the fix, and commit it.

## Step 7: Finish the log and report

1. Finish `change-log.md` with the closing sections from
   [references/change-log-format.md](references/change-log-format.md): where things ended up, the decisions the owner
   should look at first, units not done, and follow-ups. Commit with the message
   `Finish the change log for the code structure update`.
2. Report the branch, the change-log path, the number of units done and not done, and the final test counts compared
   with the baseline.

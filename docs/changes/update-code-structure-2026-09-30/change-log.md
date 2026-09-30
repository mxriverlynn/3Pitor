# Change Log: Update the Code Structure by Package, Feature, and Component

This is the running log of every change made in this change set, in the order it was made. The owner was away and
asked for every decision to be made and justified here. Each entry says what changed and why, and links the decision
(D-N) behind it.

**Where to read more:**

- [change-plan.md](change-plan.md): the plan these changes carry out.
- [artifacts/change-decision-log.md](artifacts/change-decision-log.md): every decision, with its reasoning and the
  alternatives rejected.
- [artifacts/architectural-analysis.md](artifacts/architectural-analysis.md): the analysis that found the risks.

**Branch:** `update-code-structure-2026-09-30`, created from `main` at `1a67393`. Every step below is one commit on it.
The owner asked for a new branch and a draft PR when this run was started, which overrides the skill's default of
committing only to the current branch.

**Baseline before any change:** `make test` passes 230 server tests (22 files) and 241 UI tests (11 files), and the
type-check exits 0.

**Precedent:** [restructure-by-feature](../restructure-by-feature/change-log.md) set the current layout. Its decisions
(D-1 through D-22 there) are followed here unless an entry below says otherwise.

## 1. Architectural analysis

- **Commit:** `Add the architectural analysis for updating the code structure`
- **What:** Ran `/architectural-analysis` on `src/` at medium size with five agents: structural, behavioral,
  concurrency, risk, and software-architect. The report is `artifacts/architectural-analysis.md`.
- **Why:** The owner's goal starts with this analysis, and it finds what makes moving files unsafe before anything
  moves.
- **Decisions:** D-1 (new branch and draft PR, as the owner asked), D-2 (medium size), D-3 (no separate readability
  editor pass).
- **Key result:** The tree already follows the layout almost everywhere. One placement violation (S1: the fake-claude
  test helpers) and one upward type import (S3/B5: `ClaudeMode` through `command-line.ts`). The one High risk (R1) is
  string paths that `make test` never runs, so the moves must be gated on `make check-build` and a server start too.

## 2. Change plan

- **Commit:** `Plan the code structure update`
- **What:** Ran `/plan-a-change` at small size, reusing the analysis as the current state. It wrote `change-plan.md`,
  `artifacts/current-state-findings.md` (C-1 to C-6), `artifacts/scope-boundary.md`, and decisions D-4 to D-12 in
  `artifacts/change-decision-log.md`. One review round ran (`junior-developer`, `test-engineer`), and its findings
  changed the plan in three places (D-9 to D-11).
- **Why:** The owner asked for `/plan-a-change` to set the target before any code moves.
- **Decisions:** D-4 (no confirmation turn), D-5 (fake-claude pair to `chat/components/`), D-6 and D-7 (`ClaudeMode`
  from `shared/wire`, re-export removed), D-8 (pin string-addressed files and singletons), D-9 (README changes with the
  move), D-10 (`make check-build` once, at the end), D-11 (tighter checks), D-12 (no separate readability pass).
- **Result:** Two `refactor` units, both behavior-preserving. Everything else the analysis raised is either deferred
  with a trigger (six items) or cut as a behavior change (F1 to F7).

## 3. Unit 1: move the fake-claude pair to `chat/components/` (`/refactor`)

- **Commit:** `Move the fake claude and its PATH helper into chat/components, beside the test model`
- **What:**
  - `src/server/chat/claude-cli/fake-claude-on-path.ts` → `src/server/chat/components/fake-claude-on-path.ts`
  - `src/server/chat/claude-cli/fake-claude.ts` → `src/server/chat/components/fake-claude.ts`
  - Both moved with `git mv` as 100% renames, with contents unchanged.
  - `sessions.test.ts`, `claude-backend.test.ts`, and `claude-cli.test.ts` import `'../components/fake-claude-on-path'`.
  - The README's `claude-cli/` bullet drops the fake, and its `chat/components/` bullet names all three shared files
    and their users.
- **Why:** Three chat components' tests use the pair, so `chat/components/` is the lowest scope that covers them all
  (report S1). `claude-cli/` now holds only CLI mode's model.
- **Decisions:** D-5 (the move), D-9 (README in the same unit), D-11 (checks), D-13 (fixed the stale `test-model.ts`
  user list).
- **Tests:** `make test` passes the type-check, 230 server tests (22 files), and 241 UI tests (11 files), the same as
  the baseline. The list of 33 test files is unchanged. `fake-claude` appears only in the two moved files, their three
  importers, and the README.

## 4. Unit 2: import `ClaudeMode` from `shared/wire` and drop the re-export (`/refactor`)

- **Commit:** `Import ClaudeMode from shared/wire, and stop re-exporting it from the command line`
- **What:**
  - `src/server/agent-host.ts` and `src/server/chat/claude-backend/claude-backend.ts` import `ClaudeMode` from
    `shared/wire` instead of `command-line.ts`.
  - `src/server/chat/agent/agent.ts` adds `ClaudeMode` to its existing `shared/wire` type import.
  - `src/server/command-line.ts` no longer has `export type { ClaudeMode };`. It still imports the type for its own
    signature.
- **Why:** The type lives in `src/shared/`, so the server's features take it from there rather than through the
  command-line parser (report S3, B5). `shared/wire.ts` is now the only module that exports it.
- **Decisions:** D-6, D-7, D-14 (joined the existing import in `agent.ts`).
- **Tests:** `make test` passes the type-check, 230 server tests, and 241 UI tests, after each of the two steps.
  `grep -rn "ClaudeMode.*command-line'" src` returns nothing. `command-line.test.ts` passes all 9 of its tests.

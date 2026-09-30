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
(D-1 through D-20 there) are followed here unless an entry below says otherwise.

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

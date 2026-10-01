# Change Log: Update the Code Structure by Package, Feature, and Component

This is the running log of every change made in this change set, in the order it was made. The owner was away and
asked for every decision to be made and justified here. Each entry says what changed and why, and links the decision
(D-N) behind it.

**Where to read more:**

- [change-plan.md](change-plan.md): the plan these changes carry out.
- [artifacts/change-decision-log.md](artifacts/change-decision-log.md): every decision, with its reasoning and the
  alternatives rejected.
- [artifacts/architectural-analysis.md](artifacts/architectural-analysis.md): the analysis that found the risks.

**Branch:** `update-code-structure-2026-10-01`, created from `main` at `5f90393`. Every step below is one commit on it.
The owner asked for a new branch, commits pushed as the run goes, and a draft PR when this run was started. That
overrides the skill's default of committing only to the current branch (D-1).

**Baseline before any change:** `make test` passes 272 server tests (23 files) and 446 UI tests (16 files), and the
type-check exits 0.

**Precedent:** [update-code-structure-2026-09-30](../update-code-structure-2026-09-30/change-log.md) is the most recent
structure change set, and [restructure-by-feature](../restructure-by-feature/change-log.md) set the layout. Their
decisions are followed here unless an entry below says otherwise.

**What changed since the last run:** 125 commits added these modules under `src/`. Each needs a place under the rules:

- `server/server.test.ts`
- `ui/components/panel-resizer/` (used only by `app.tsx`)
- `ui/documents/file-tree/entry-name.ts` (used only by `file-tree.tsx`)
- `ui/documents/markdown-editor/highlight-outline.ts` and `raw-syntax.ts` (used only inside the editor)
- `ui/popups/link-popup/` (used only by `documents/markdown-editor/markdown-editor.tsx`, a cross-feature import in a
  package where the README says `app.tsx` is the only file that wires features together)

## 1. Architectural analysis

- **Commit:** `Add the architectural analysis for updating the code structure`
- **What:** Ran `/architectural-analysis` on `src/` at medium size with five agents: structural, behavioral,
  concurrency, risk, and software-architect. The report is `artifacts/architectural-analysis.md`. It holds S1–S8,
  B1–B13, C1–C6, R1–R6, and A1–A4.
- **Why:** The analysis finds what makes moving files unsafe before anything moves.
- **Decisions:** D-1 (new branch, pushes, and draft PR), D-2 (medium size), D-3 (no separate readability editor
  pass).
- **Key result:** One placement violation since the last run (S1: `ui/popups/link-popup/` is used only by the markdown
  editor). Its fix forces a second move: `popups/components/anchored-bubble` goes up to `ui/components/`, because its
  users would then span two features (A1). The highest move risk (R1) is still the set of paths that `make test` and
  the type-checker cannot see. The new `server.test.ts`, which must stay beside `server.ts`, is one of them. The new
  file watcher adds one single-definition rule: `isHiddenName` (R3).

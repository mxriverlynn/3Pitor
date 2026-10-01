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

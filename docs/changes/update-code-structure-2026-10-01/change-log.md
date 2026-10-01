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

## 2. Change plan

- **Commit:** `Plan the code structure update`
- **What:** Ran `/plan-a-change` at small size, reusing the analysis as the current state. It wrote these files:
  - `change-plan.md`
  - `artifacts/current-state-findings.md` (C-1 to C-6)
  - `artifacts/scope-boundary.md`
  - decisions D-4 to D-12 in `artifacts/change-decision-log.md`
  - two check scripts, `artifacts/cross_feature.py` and `artifacts/css_snapshot.sh`

  One review round ran (`junior-developer`, `test-engineer`). Its findings changed the plan's checks, D-5, D-6, D-10,
  and S-3, and added D-11.
- **Why:** The plan sets the target before any code moves.
- **Decisions:**
  - D-4: no confirmation turn.
  - D-5: link-popup goes flat into `markdown-editor/`.
  - D-6: anchored-bubble goes up to `ui/components/anchored-bubble/`.
  - D-7: one unit, and nothing else moves.
  - D-8: the README lines for the moved files change in that unit.
  - D-9: small size.
  - D-10: CSS order is proven by a bundle diff.
  - D-11: every check is a command.
  - D-12: no separate readability pass.
- **Result:** One `refactor` unit, and every entry is behavior-preserving. Six deferrals carry triggers. The behavior
  changes found by the analysis are cut as follow-ups.

## 3. Unit 1: move link-popup into the markdown editor, and anchored-bubble up to `ui/components/` (`/refactor`)

- **Commit:** `Move the link popup into the markdown editor, and the anchored bubble up to ui/components`
- **What:**
  - `src/ui/popups/components/anchored-bubble.ts` → `src/ui/components/anchored-bubble/anchored-bubble.ts`
  - `src/ui/popups/components/anchored-bubble.css` → `src/ui/components/anchored-bubble/anchored-bubble.css`
  - `src/ui/popups/link-popup/link-popup.tsx` → `src/ui/documents/markdown-editor/link-popup.tsx`
  - `src/ui/popups/link-popup/link-popup.css` → `src/ui/documents/markdown-editor/link-popup.css`
  - `src/ui/popups/link-popup/link-popup.test.tsx` → `src/ui/documents/markdown-editor/link-popup.test.tsx`
  - Four import specifiers changed, and no import line moved. `markdown-editor.tsx` imports `./link-popup`.
    `link-popup.tsx`, `question-popup.tsx`, and `selection-popup.tsx` import
    `../../components/anchored-bubble/anchored-bubble`.
  - The empty `popups/components/` and `popups/link-popup/` folders are gone.
  - In the README, `popups/` lists the two popups `app.tsx` wires. A new `markdown-editor/link-popup.tsx` bullet and a
    new `components/anchored-bubble/` bullet describe the moved modules.
  - The refactor ran as two named steps, Move Module for anchored-bubble and then for link-popup, with `make test`
    green after each.
- **Why:** The rule says a component folder holds "the helpers only it uses", and the markdown editor is link-popup's
  only user (report S1). Once link-popup lives in documents, anchored-bubble's users span two features, so
  `ui/components/` is the lowest scope that covers them (A1).
- **Decisions:** D-5 (link-popup flat in `markdown-editor/`), D-6 (anchored-bubble's folder), D-7 (one unit), D-8
  (README lines in the same unit), D-10 (CSS diff), D-11 (checks as commands). No new decisions.
- **Tests:**
  - `make test` passes the type-check, 272 server tests (23 files), and 446 UI tests (16 files), the same as the
    baseline.
  - `git diff -M` shows four renames at 100% and `link-popup.tsx` at 97% (its one import line).
  - The stale-path grep finds nothing.
  - The bundled CSS rules are identical to the baseline, and in the same order once the two moved paths are rewritten.
  - `cross_feature.py` exits 0: no UI import crosses from one feature into another.

# Change Log: Update the Code Structure by Package, Feature, and Component

This is the running log of every change made in this change set, in the order it was made. The owner was away and
asked for every decision to be made and justified here. Each entry says what changed and why, and links the decision
(D-N) behind it.

**Where to read more:**

- [change-plan.md](change-plan.md): the plan these changes carry out.
- [artifacts/change-decision-log.md](artifacts/change-decision-log.md): every decision, with its reasoning and the
  alternatives rejected.
- [artifacts/architectural-analysis.md](artifacts/architectural-analysis.md): the analysis that found the risks.

**Branch:** `update-code-structure-2026-10-19`, created from `main` at `cb9478c`. Every step below is one commit on it.
The owner asked for a new branch, commits pushed as the run goes, and a draft PR when this run was started. That
overrides the skill's default of committing only to the current branch (D-1).

**Baseline before any change:** `make test` passes 523 server tests (38 files) and 502 UI tests (19 files), and the
type-check and Node check exit 0.

**Packages (discovered):** `src/app-files`, `src/cli`, `src/engine`, `src/file-system`, `src/posts`, `src/server`,
`src/shared`, `src/ui`. `src/.data`, `src/fixtures`, and `src/skills` hold no `.ts` or `.tsx` file, so they are content,
not packages.

**Test roots (from `Makefile`):** `test-server` runs `bun test src/cli src/server src/engine src/shared src/file-system
src/posts src/app-files`; `test-ui` runs `bun test --preload ./src/ui/test-setup.ts src/ui`. Every package is covered by
a test root and described in the README's layout section, so no package needs a D-N entry for being missing.

**Precedent:** [update-code-structure-2026-10-01](../update-code-structure-2026-10-01/change-log.md) is the most recent
structure change set, and [restructure-by-feature](../restructure-by-feature/change-log.md) set the layout. Their
decisions are followed here unless an entry below says otherwise.

**What changed since the last run:** 246 commits since `1c58be5` added or renamed 111 files under `src/`, including
the new `file-system` and `posts` packages, the posts routes, `shared/document-key.ts` and `shared/entry-name.ts`, the
model picker, the post table, panel, and dialogs, and several new UI shared modules.

## 1. Architectural analysis

- **Commit:** Add the architectural analysis for updating the code structure
- **What:** Ran `/architectural-analysis` on `src/` at medium size with five agents: structural, behavioral,
  concurrency, risk, and software-architect. The report is `artifacts/architectural-analysis.md`. It holds S1–S12,
  B1–B12, C1–C8, R1–R7, and A1–A14.
- **Why:** The analysis finds what makes moving files unsafe before anything moves.
- **Decisions:** D-1 (new branch, pushes, and draft PR), D-2 (medium size), D-3 (no separate readability editor
  pass).
- **Key result:**
  - Seven placement problems were found: `shared/entry-name.ts`, `ui/components/shortcut.ts`, `documents/post-dialogs/`,
    `documents/post-table/`, `chat/model-picker/`, the two engine test helpers used outside `chat`, and
    `server/scripts/`. There is also one wrong-way test import (`posts` → `engine/components/bun-only-code`) and a
    README that describes folders that no longer exist.
  - The one high risk is R1. A move that changes a package root can drop tests out of the Makefile's roots, or leave
    the boundary scans checking nothing, with `make test` still green. No planned move touches a package root.
- **Draft PR:** [#43](https://github.com/mxriverlynn/3Pitor/pull/43), opened at the owner's request while the analysis ran.

## 2. Change plan

- **Commit:** Plan the code structure update
- **What:** Ran `/plan-a-change` at medium size, reusing the analysis as the current state. It wrote these files:
  - `change-plan.md`
  - `artifacts/current-state-findings.md` (C-1 to C-11)
  - `artifacts/scope-boundary.md`
  - decisions D-4 to D-18 in `artifacts/change-decision-log.md`
  - the two check scripts, copied from the last run: `artifacts/css_snapshot.sh` and `artifacts/cross_feature.py`

  One review round ran (`junior-developer`, `test-engineer`). Neither found a blocking problem. Their findings made
  every check exact, added README checks, and strengthened D-9.
- **Why:** The plan sets the target before any code moves.
- **Decisions:**
  - D-4: no confirmation turn.
  - D-5: reuse the analysis.
  - D-6: medium size.
  - D-7: flatten post-table and model-picker.
  - D-8: shortcut and post-dialogs go to `documents/components/`.
  - D-9: bun-only-code goes to `src/shared/`.
  - D-10: the engine test helpers go to `engine/components/`.
  - D-11: entry-name goes to `posts/file/`.
  - D-12: `server/scripts/check.ts` stays, against the analysis's A7.
  - D-13: everything else stays.
  - D-14: the README names the engine's test-facing modules.
  - D-15: three units.
  - D-16: every check is a command.
  - D-17: behavior changes are cut.
  - D-18: no separate readability pass.
- **Result:** Three `refactor` units, independent of each other, and every entry preserves behavior. A10–A14 and A7
  are cut as follow-ups.

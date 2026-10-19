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

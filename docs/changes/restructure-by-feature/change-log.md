# Change Log: Restructure src/ by Package, Feature, and Component

This is the running log of every change made on the `restructure-by-feature` branch, in the order it was made. The owner
was away and asked for every decision to be made and justified here. Each entry names the commit, what changed, and why,
and links the decision (D-N) behind it.

**Where to read more:**

- [change-plan.md](change-plan.md): the plan these changes carry out.
- [artifacts/change-decision-log.md](artifacts/change-decision-log.md): every decision, with its reasoning and the
  alternatives rejected.
- [artifacts/architectural-analysis.md](artifacts/architectural-analysis.md): the analysis that found the risks.

**Baseline before any change:** `make test` passes 75 server tests and 79 UI tests, and `tsc --noEmit` exits 0.

## 1. Architectural analysis

- **Commit:** `d026a39` Add the architectural analysis for restructuring src/ by feature
- **What:** Ran `/architectural-analysis` on `src/` at medium size. Five agents took part: structural, behavioral,
  concurrency, risk, and software-architect. Their output is in `artifacts/architectural-analysis.md`.
- **Why medium:** `src/` spans three packages (45 source files) and has async and WebSocket code. It has no data,
  DevOps, or cross-service code, so the security, data, and DevOps agents were left out.
- **Key result:** One Critical risk (R1). Two path calculations would break silently when their files move deeper. The
  restructure has to fix that before it moves anything.

## 2. Change plan

- **What:** Ran `/plan-a-change` and wrote four files:
  - `change-plan.md`
  - `artifacts/scope-boundary.md`
  - `artifacts/current-state-findings.md`
  - `artifacts/change-decision-log.md`
- **Why:** The owner asked for `/plan-a-change` to set the target tree before any code moves.
- **Decisions made in place of asking the owner:**
  - **D-1:** A component is a real folder, but only in features with more than one component. This overrules the
    architect's "no component folders" recommendation, because the owner named the component level explicitly.
  - **D-6:** `sessions`, `agent`, and `tools` form one server feature, `chat`, because they share per-turn state.
  - **D-15:** A feature has the same name in both packages (`chat`, `documents`, `events`).
  - **D-16:** Every behavior-changing finding is left for a follow-up, so this branch stays a pure restructure.

## 3. Unit 1: share the textblock walk (TDD)

- **What:**
  - Added `src/shared/blocks.ts` test-first. It exports `textblocks(root)` and the `TextblockTree` shape, and has no
    imports.
  - `postBlocks` in `src/server/tools.ts` is now `textblocks(defaultMarkdownParser.parse(md))` texts.
  - `src/ui/markdown-editor.tsx` calls `textblocks` where it called `blocksOf`, which is removed.
  - The UI parity test in `markdown-editor.test.tsx` no longer imports `../server/tools`. It and a new test in
    `tools.test.ts` both expect the same five block strings from the same post.
- **Why:**
  - The owner's rule says anything shared between packages lives in the shared package. The textblock walk was
    duplicated across `server` and `ui`, and a UI test imported server code to prove the two copies agreed (C-5, D-4).
  - The walk now has one copy, the two packages agree through `shared`, and each side pins the same expected blocks, so
    changing the parser on either side fails a test (review findings JD-005 and TE Q1).
- **TDD notes:**
  - Items 1 (empty tree) and 2 (hand-built tree) were driven red → green.
  - Items 3 (the worked example `# A\n\nb` → pos 1 and 4) and 4 (document order, list containers excluded) passed on
    their first run, because item 2's walk already covered them. They are kept as pins that a real ProseMirror `Node`
    fits `TextblockTree`.
  - A mutation check (`pos + 1` → `pos`) turned three of the four tests red, which shows they are not vacuous.
- **Verification:** `make test` passes 80 server and 79 UI tests (previously 75 and 79). `tsc --noEmit` passes, and
  `make build` succeeds. `grep -r "server/" src/ui` now matches only a comment in `app.tsx`.

## 4. Unit 2: anchor `SRC` in `src/server/paths.ts` (TDD)

- **What:**
  - Added `src/server/paths.ts` (`export const SRC`) test-first, with the guard test `paths.test.ts`. The test checks
    that `server/server.ts`, `ui/index.html`, `skills`, and `fixtures/workspace` all exist under `SRC`.
  - `workspace.ts` no longer defines or exports `SRC`; it imports it.
  - `app-skills.macro.ts` embeds `join(SRC, 'skills')` instead of `join(import.meta.dir, '../skills')`.
  - `agent.test.ts`, `workspace-config.test.ts`, `workspace-config.routes.test.ts`, and `scripts/check.ts` import `SRC`
    from `paths`.
- **Why:** Risk R1 was the only Critical finding. Moving `workspace.ts` or the macro one folder deeper would have
  silently pointed `SRC` at `src/server`, and a seeded `.data/workspace` would have hidden the break. The macro could
  also have embedded no skills (C-1 to C-4, D-3). Now only `paths.ts` computes a path from its own location, and it
  never moves.
- **TDD notes:**
  - The guard test was red first because the module did not exist, and green once `paths.ts` was added.
  - A mutation check (`'..'` → `'../..'`) turned the guard red, which shows it catches the depth mistake it exists
    for.
- **Verification:**
  - `make test` passes 81 server and 79 UI tests, and `tsc --noEmit` passes.
  - `grep -rn import.meta.dir src` matches only `paths.ts`.
  - `make check-build` passes: the compiled binary still lists `collaborative-draft-editing`, so a Bun macro importing
    `paths.ts` works in the binary.

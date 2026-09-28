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

- **Commit:** `8e1e0d6` Plan the restructure of src/ by package, feature, and component
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

- **Commit:** `20241fb` Share the textblock walk between server and UI in src/shared/blocks.ts
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

- **Commit:** `cb5faf5` Compute src/ in one place, src/server/paths.ts, guarded by a test
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

## 5. Unit 3: move the server into feature and component folders (`/refactor`)

- **Commit:** `6b87b30` Move the server into feature and component folders
- **What:** Moved the server files with `git mv`, one named Move Module refactoring at a time. After each move, a
  script rewrote only the relative import specifiers that resolve to a real file under `src/`, so test strings like
  `'../secret.md'` were untouched. The suite and `tsc` ran after every step.
  1. `events.ts` and `events.routes.ts` → `src/server/events/`
  2. `documents.routes.ts` → `src/server/documents/`
  3. `workspace.ts` and its test → `src/server/workspace/`
  4. `workspace-config.ts`, its routes, `app-skills.macro.ts`, and both tests → `src/server/workspace-config/`
  5. The `chat` feature:
     - `sessions.ts`, `sessions.routes.ts`, and their tests → `src/server/chat/sessions/`
     - `agent.ts` and its test → `src/server/chat/agent/`
     - `tools.ts` and its test → `src/server/chat/tools/`
     - `test-model.ts` → `src/server/chat/components/`
- **Unchanged:** `server.ts`, `agent-host.ts`, `paths.ts`, and `scripts/check.ts` stay at the package root, so the
  `Makefile` and `package.json` need no edits (D-2, D-5).
- **Why:**
  - Feature folders are what the owner asked for.
  - `sessions`, `agent`, and `tools` are components of one feature because they share per-turn `TurnTexts` state
    (C-6, D-6).
  - The scripted test model is shared by two of those components, so it lives in the feature's `components/` (D-7).
  - The macro stays beside its only importer (D-14, D-21).
- **Verification:**
  - Every step: `make test-server` passes 81 tests, and `tsc` passes.
  - After step 5: `make test` passes 81 server and 79 UI tests.
  - `make check-build` lists `collaborative-draft-editing`.
  - `bun run check` passes 13/13 end-to-end scenarios against a freshly reset workspace. These include the documents
    REST scenario and the events and subagent scenarios, which are the only coverage of `documents.routes.ts` and
    `events.routes.ts`.

## 6. Unit 4: move the UI into feature and component folders (`/refactor`)

- **Commit:** `aa04180` Move the UI into feature and component folders
- **What:** Moved the UI files with `git mv` and rewrote imports, including the `mock.module` and `await import()`
  specifiers in `documents.test.tsx`, which now name `../markdown-editor/markdown-editor`. The UI suite and `tsc` ran
  after every step.
  6. `api.ts` → `src/ui/components/api.ts`. It is shared by `app.tsx`, `documents`, and `chat` (D-8).
  7. `host-events.ts` → `src/ui/events/host-events.ts`, the UI half of the server's `events` feature (D-11).
  8. The `popups` feature:
     - `question-popup` and `selection-popup` → `src/ui/popups/<component>/`
     - `anchored-bubble.ts` and `.css`, which only those two share → `src/ui/popups/components/` (D-10)
  9. The `chat` feature: `chat/chat/` and `chat/agent-panel/`. The panel is only the Clear Chat header, so it belongs to
     chat (D-9).
  10. The `documents` feature: `documents/documents/` and `documents/markdown-editor/`. The feature name matches the
      server's `documents` feature (D-15).
- **Unchanged:** `app.tsx`, `index.html`, `styles.css`, `css.d.ts`, and `test-setup.ts` stay at the UI root, so the
  `Makefile` preload path and `server.ts`'s `../ui/index.html` import are untouched (D-2). `app.tsx` keeps its import
  lines in their original order, which keeps the CSS cascade order the same.
- **Verification:**
  - Every step: `make test-ui` passes 79 tests, and `tsc` passes.
  - After step 10: `make test` passes 81 server and 79 UI tests, and `make check-build` passes.
  - The CSS bundle from `bun build src/ui/index.html` matches the baseline taken before Unit 1 byte for byte, and in
    the same order. The only difference is Bun's `/* src/... */` source-path comments, which now show the new paths
    (review finding JD-008).

## 7. Unit 5: rewrite the README's file map

- **Commit:** `b45af1f` Describe the package, feature, and component layout in the README
- **What:**
  - Replaced the README's `src/` section with the new layout, organized by package, then by feature.
  - Added a short "How `src/` is laid out" section that states the placement rules: package, then feature, then
    component; the scope of each `components/` folder; and that entry points stay put.
  - Fixed the stale `agent-panel` description ("shows the workspace's skills and agents"). It has only shown the Clear
    Chat header since `c504d6c`.
  - Added `paths.ts` and `shared/blocks.ts` to the map.
- **Why:** The README was the codebase's only map of where things live (C-10), and every path in it had moved. The
  placement rules are written down so the next file added lands by rule rather than by guess. The "`components/`
  means shared by siblings, not React components" line answers review finding JD-002.
- **Verification:** Every `.ts`, `.tsx`, `.html`, and `.css` file the README names exists under `src/`.

## Where things ended up

Final checks on the branch:
- `make test` passes 81 server and 79 UI tests (up from 75 and 79). The six new tests are 4 in `shared/blocks.test.ts`,
  the `postBlocks` pin in `tools.test.ts`, and `paths.test.ts`.
- `tsc --noEmit` passes, and `make build` and `make check-build` pass.
- `bun run check` passes 13/13 scenarios.
- The bundled CSS is unchanged.

```
src/server/  server.ts agent-host.ts paths.ts scripts/
             chat/{sessions,agent,tools,components}/  documents/  events/  workspace/  workspace-config/
src/ui/      app.tsx index.html styles.css css.d.ts test-setup.ts
             components/  events/  documents/{documents,markdown-editor}/  chat/{chat,agent-panel}/
             popups/{question-popup,selection-popup,components}/
src/shared/  wire.ts markdown-support.ts passages.ts blocks.ts
```

## Decisions the owner should look at first

These are the calls most likely to be a matter of taste, and the easiest to change:

- **D-1:** Component folders exist only in features with more than one component. The architect recommended no
  component folders at all. This follows the owner's words instead, and the price is some repeated names, such as
  `ui/chat/chat/chat.tsx`.
- **D-6:** The server feature is called `chat`, not `sessions`, to match the UI and to avoid `sessions/sessions/`.
- **D-9:** `agent-panel` is a component of `chat`, not a feature of its own.
- **D-16:** Every behavior-changing finding from the analysis is left for a follow-up (listed below).

## Follow-ups not done here (behavior changes)

Each of these changes something a user or caller can see, so none belongs in a pure restructure. The placement above
keeps each one local to a single feature folder. See `change-plan.md#cut-for-scope`.

1. **Report C1:** Serialize or lock file-tool calls within one model step, so two edits in one step can't lose one
   another. The fix belongs in `server/chat/`.
2. **Report C5:** Make each file tool honor `abortSignal`, so Stop halts in-flight tool work. The fix belongs in
   `server/chat/tools/`.
3. **Report B5:** Validate the `data-session` payload at runtime in `ui/chat/chat/`.
4. **Report C3/C4:** Isolate EventBus listeners and filter events by session, in `server/events/`.
5. **Report B10:** Validate `PUT /api/documents` input (return a 400, not a 500), and add the unit tests that
   `documents.routes.ts` lacks.
6. **Report S15/B9, A7:** Use one symlink-safe workspace path check for both documents and tools. This refuses
   symlinks that point outside the workspace.

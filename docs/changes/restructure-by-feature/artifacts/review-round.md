# Review Round: Restructure src/ by Package, Feature, and Component

One review round (medium size, cap 2).

**Team:**
- `han-core:junior-developer` (the seat every team fills)
- `han-core:test-engineer` (chosen because behavior preservation rests on the tests)

Both reviewed [../change-plan.md](../change-plan.md) as first written. Their verbatim output is below.

## How each finding was resolved

**Pass A** merged findings that said the same thing in different words:
- JD-005 with test-engineer Q1 (S-1 pins)
- JD-006 with test-engineer Q3 (Unit 3 checks)
- JD-008 with test-engineer's S-6 CSS gap

**Pass B:** two findings rest on inputs nobody inspected: the built CSS order, and whether an API key is available.
Both are labelled Unverified and neither blocks. Each was then checked directly: the API key is set in this run's
environment, and Unit 4 now diffs the bundled CSS.

**Pass C:** test-engineer's mock.module and happy-dom points are closed by C-11 and D-2.

| Finding | Resolution |
| --- | --- |
| JD-001 "component" undefined | D-21 defines it; plan Target State states it |
| JD-002 `components/` means two things | D-21; the README update says `components/` means "shared by siblings" |
| JD-003 "user-facing capability" wording | Reworded to "capability (reason to change)" |
| JD-004 route shapes shared between packages | D-22: not moved; deferred with a reopening trigger |
| JD-005 / TE Q1 postBlocks unpinned after the parity rewrite | S-1 and D-4: both sides pin the same five strings |
| JD-006 / TE Q3 S-5 coverage overstated; `check` needs a key | S-5 reworded; key present, so `bun run check` runs in Unit 3 |
| JD-007 "build output unchanged" overclaims | Behavior Changes reworded to name file paths in traces and `git blame` |
| JD-008 / TE CSS not covered by tests | S-6 and Unit 4: keep `app.tsx` import order, diff the bundled CSS |
| JD-009 dependency list | Target State rewritten |
| JD-010 running log has no home | Every unit appends to `change-log.md` |
| JD-011 D-1 wording | D-1 now states the repeat rule |
| TE Q2 test behaviors for blocks.ts and paths.ts | Folded into Unit 1 and Unit 2 checks |

## junior-developer (verbatim)

## Summary

I reviewed `docs/changes/restructure-by-feature/change-plan.md`: Why This Change, What Changes In One Paragraph, Target State, and the first line of S-1 to S-6. I checked it against `current-state-findings.md`, `scope-boundary.md`, `change-decision-log.md`, and the source tree. The plan is mostly clear and fits the owner's request. It adds no more structure than the request calls for, and the target tree places all 55 tracked files under `src/` (checked with `git ls-files src`). Three things muddy it:
- The placement rules do not define "component".
- Two behavior-preserving claims rest on tests that either do not exist or are rewritten in the same unit.
- The server/editor parity contract is left to convention instead of being held by a test.

No review file was written, as you asked.

| Severity          | Count |
|-------------------|-------|
| Blocks decision   | 0     |
| Muddies artifact  | 3     |
| Worth clarifying  | 5     |
| Polish            | 3     |

Open Questions: 4
Specialist handoffs: 1 (test-engineer)

## Plain-language restatement

Move every file into `package/feature/[component]/`. Add one file that knows where `src/` is, so files can sit at any depth. Replace the two copies of the "list the text blocks" walk with one shared copy, so no UI test imports server code. Leave the entry points where they are, so no build command changes. This holds together. What the restatement drops is how the plan decides what counts as a "component". That is JD-001.

## Open Questions

- **OQ1:** What exactly is a "component"? Is it a basename group, or something else? The answer decides whether `workspace-config/` is one component or two. (JD-001)
- **OQ2:** Does the owner's "anything shared between packages" rule cover the HTTP route shapes both packages rely on? (JD-004)
- **OQ3:** Can `bun run check` run without the owner? It sends real chat turns. (JD-006)
- **OQ4:** Where is the "running log of all changes" the owner asked for? (JD-010)

## Findings

**JD-001: You cannot work out every file's placement from the rules, because "component" is never defined.** Muddies artifact.
- Plan Target State rule 2 says "a single-component feature holds its files directly". D-1 says "each component folder is named after the component's files".
- If a component is a basename group, then `workspace-config/` holds two of them: `workspace-config.*` and `app-skills.macro.ts`. It would need component folders, but the tree calls it "single component". `events.ts` + `events.routes.ts` and `sessions.ts` + `sessions.routes.ts` fit the basename reading.
- D-14 keeps the macro beside its only importer. That is a good reason, but it is not one of the six rules, so the placement is decided case by case.
- Next step: add one sentence that defines a component. For example: "a module plus the helpers only it imports, and their tests". Then state that the macro is a helper of `workspace-config.ts`. (OQ1)

**JD-002: `components/` means two different things.** Worth clarifying.
- In the UI, `chat/chat/` and `chat/agent-panel/` are component folders (React components). But `ui/components/api.ts` is a fetch helper, and `server/chat/components/test-model.ts` is a test-only mock (C-7). Neither is a component in any sense.
- The owner's wording chose the name, and rule 4 applies it the same way everywhere. Still, a reader will expect `ui/components/` to hold React components.
- Next step: add one line in the README update (Unit 5) saying that `components/` means "shared by siblings", not "React components". It would also help to say whether test-only helpers belong there.

**JD-003: "User-facing capability" (What Changes, question 2) does not describe several of the features.** Polish.
- `events` is plumbing. `workspace-config` has no UI caller since `c504d6c`: `grep "api(" src/ui` shows only `/api/sessions` and `/api/documents`. The check that exercises it is `check-build` (Makefile).
- Next step: change the wording to "capability", or to "reason to change".

**JD-004: The plan may deliver less than the owner asked for. The HTTP contract is shared between packages but does not live in `shared/`.** Worth clarifying.
- `ui/api.ts` is `api<T = any>`. Callers rely on shapes the server defines, and nothing checks them: `(await api('POST','/api/sessions')).id` at `app.tsx:21`, `.documents` at `documents.tsx:54`, and `{ content }` at `documents.tsx:75`.
- D-13 covers only the existing modules in `shared/`. Neither the plan nor the log decides whether "anything shared between packages" includes these shapes.
- YAGNI tension: adding types is new code, and the analysis records no incident. The cheapest resolution is a decision entry: "route shapes are not moved; reopen when a shape mismatch ships". (OQ2)

**JD-005: S-1's "Preserving … the existing tests pin the output" holds only partly, and the postBlocks/editor parity is no longer tested.** Muddies artifact.
- Today, `markdown-editor.test.tsx:86-87` calls the server's real `postBlocks`. Under D-4 / Unit 1 step 3, that test is rewritten to compare `textblocks(editorDoc)` with `textblocks(defaultMarkdownParser.parse(md))`. So the test that pins S-1 is edited in the same unit.
- After the rewrite, no test exercises `postBlocks`. `tools.test.ts` never imports it (grep). Its Highlight tests (`:217`, `:227`) reach it only indirectly.
- Server/editor parity now depends on an unpinned agreement: `postBlocks` must stay `textblocks(defaultMarkdownParser.parse(md))`. If someone later changes the parser or schema on the server, the UI test will not notice.
- Next step: in `tools.test.ts`, add an assertion that `postBlocks(md)` equals the texts from `textblocks(defaultMarkdownParser.parse(md))`, using the same 5-block markdown the UI test uses. Or pin the expected 5 strings in both places.
- I checked the worked example: `"# A\n\nb"` does give pos 1 and pos 4, because the heading node is 3 wide.
- Specialist to consult: test-engineer.

**JD-006: S-5's "the routes by their tests and `bun run check`" conflicts with the findings, and the fallback may not be runnable unattended.** Muddies artifact.
- Findings Gaps says `documents.routes.ts` and `events.routes.ts` have no unit tests. So their only guard is `bun run check`.
- `check.ts:28-35,134` sends real `/api/sessions/:id/chat` turns, which need a live model and an API key. Unit 3's "`bun run check` passes against a freshly reset workspace" is silent on both.
- A pure move that breaks only an import would still fail at `tsc` / server start, so the real risk is low. But the plan claims coverage that does not exist.
- Next step: reword S-5 so it names only `tsc`, server start, and `check-build`, or say that `check` needs a key. (OQ3)
- Unverified: could not inspect whether `ANTHROPIC_API_KEY` is available to the run, because the environment was not examined.

**JD-007: Behavior Changes says "the build output … stay[s] the same". That overclaims.** Worth clarifying.
- File paths inside the bundled binary, stack traces, `bun test` report lines, and `git blame` without `--follow` all change.
- Who sees it: a developer reading an error or a test failure, or any local script or editor bookmark that names an old path.
- Next step: reword to "no HTTP, DOM, or command change; file paths in traces and reports change".

**JD-008: S-6's "Pinned by all 79 UI tests" does not cover CSS.** Worth clarifying.
- happy-dom tests do not check how CSS cascades. Bundle order follows import order: component `.css` files are imported by their `.tsx`, and `app.tsx` imports lines 5-12 in a fixed order. If the import rewrite in Unit 4 re-sorts those lines (the new paths sort differently), cascade order could change.
- Who sees it: the user, in the browser.
- Next step: pin "keep import line order unchanged" in Unit 4, or diff the bundled CSS before and after.
- Unverified: could not inspect the built CSS order, because I did not run `make build`.

**JD-009: The Target State dependency list is misworded and incomplete.** Polish.
- "Nothing in `ui/` imports `server/`, except `server.ts`'s import of `../ui/index.html`" describes a server→ui edge as if it were an exception to ui→server.
- The list leaves out these edges:
  - `ui/chat` and `ui/documents` → `ui/components/api`
  - `app.tsx` → `documents/markdown-editor` (the `Ask`/`SelectionAsk` types)
  - `scripts/check.ts` → `workspace` and `paths`

**JD-010: The owner asked for a "running log of all changes that are made", and the plan does not say where it lives.** Worth clarifying.
- Source: scope-boundary Stated Scope.
- The Change Units cover commits (D-18) and a README update (Unit 5). `change-decision-log.md` records decisions, not changes made. No unit writes or updates a change log.
- Next step: add a step to each unit, or state that the decision log plus the commits is the log. (OQ4)

**JD-011: D-1's reason for not repeating folder names conflicts with the tree.** Polish.
- D-1 rejects `events/events/` because "repetition carries no information". D-6 names the server feature `chat` partly to avoid `sessions/sessions/`. Yet the UI tree has `documents/documents/documents.tsx` and `chat/chat/chat.tsx`.
- D-15 accepts this repetition in its rejected alternative, so the tree is internally consistent. D-1's wording is not.
- Next step: state the rule as "repeat only when the feature has other components".

## YAGNI Evidence Sweep (new parts)

Both new parts pass the evidence test. Neither gets a JD- finding.
- **`paths.ts` / `paths.test.ts`: passes.** The evidence is an existing code path that breaks when files move (C-1, C-2), plus a guard against the silent failure mode (C-3). The architect's macro test at `architectural-analysis.md:1058` answers the question of whether a macro can import `paths.ts`.
  - Simpler-version test: keeping `SRC` in `workspace.ts` with `'../..'` plus the guard test is about the same size. D-3's rejection ("no guard") argues against a version nobody proposed. But `paths.ts` also stops four files from reaching into the workspace feature to get `SRC` (C-2), so keep it.
- **`blocks.ts` + `TextblockTree`: passes.** The evidence is the owner's cross-package rule, C-5, and README:39, which says the modules in `shared/` "have no imports". `analysis:1059/1277` answers the question of whether ProseMirror's `Node` fits the structural type.
  - Simpler-version test: I considered rewriting the UI test and leaving the two walks duplicated. That keeps the drift risk JD-005 describes, so the single copy is justified. Its value depends on fixing JD-005.

## Protocol notes

- **Standards (P4):** There is no CLAUDE.md, no ADRs, and no lint (findings Project Context). I checked against the README file map, the Makefile, `package.json`, and `tsconfig`. Nothing outside TypeScript names a file that moves. `git grep` found only entry-point paths, which D-2 leaves in place.
- **Scope/DoD (P6):** Each unit has a "How you know it worked" check. The rollback story (reverting per-package `git mv` commits) is implied by D-18 but not written down. The owner as post-ship owner is also implied.
- **Forgotten files:** none.

Files reviewed:
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/restructure-by-feature/change-plan.md
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/restructure-by-feature/artifacts/current-state-findings.md
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/restructure-by-feature/artifacts/scope-boundary.md
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/restructure-by-feature/artifacts/change-decision-log.md

Full review written to: not written (you asked me not to create files). This message is the complete review.


## test-engineer (verbatim)

Verification review of change-plan.md's Current State, Surface Delta (S-1..S-6, all Preserving), and Change Units. Grounded in current-state-findings.md, scope-boundary.md, and direct reads of src/server and src/ui source/tests (paths.ts and shared/blocks.ts do not exist yet — confirmed by file listing — so both are genuinely new, test-first work).

## Q1 — Which tests pin each delta, and gaps

- **S-1 (`blocks.ts`/`textblocks`).** Pinned today by `tools.test.ts` Highlight-tool tests (lines 223–269, which call `postBlocks` indirectly through quote-matching) and directly by `markdown-editor.test.tsx:86-88` (parity: `blocksOf(doc).map(b=>b.text)).toEqual(postBlocks(md))`) and `:126` (`blocksOf(state.doc)[1].pos`). Gap: no test asserts `postBlocks`'s own return shape directly — only via Highlight pass/fail — so the walk's `pos+1` arithmetic is pinned only on the UI side. Confirmed `tools.ts:146-152` and `markdown-editor.tsx:86-92` are the two duplicated walks C-5 describes.
- **S-2/S-3 (`paths.ts`/`SRC`).** Nothing today pins "the anchor file must stay one level under `src/server`" — that's new. Today's C-1/C-4 breakage is only caught indirectly: `workspace-config.test.ts:88-94` compares `APP_SKILL_FILES` against `join(SRC,'skills')` on disk, but only once `SRC` is already right. Confirmed exactly 4 current importers of `SRC` (`agent.test.ts:9`, `workspace-config.test.ts:6`, `workspace-config.routes.test.ts:6`, `scripts/check.ts:5`), matching C-2.
- **S-4 (chat move).** Pinned by `sessions.test.ts`, `agent.test.ts`, `tools.test.ts`, `sessions.routes.test.ts`. Confirmed `test-model.ts` mocks `@ai-sdk/anthropic` by package name (`mock.module('@ai-sdk/anthropic', …)`), so it's move-safe per D-7 — no path dependency to break.
- **S-5 (documents/events/workspace/workspace-config).** `workspace.ts` pinned by `workspace.test.ts` (3 tests). `workspace-config.ts` pinned by its `.test.ts` and `.routes.test.ts`. **`documents.routes.ts` and `events.routes.ts` have zero unit tests** — confirmed no `.test.ts` file imports either module. Their only pin is the end-to-end `bun run check` script (`check.ts:136-141` for documents; events only indirectly via the WebSocket listener used across chat scenarios, `check.ts:130-132`). Pre-existing gap per current-state-findings, but the plan's Behavior claim ("the routes by their tests and `bun run check`") leans on a safety net that is slow and non-deterministic (see Q3).
- **S-6 (UI move).** Broadly pinned by the 79 UI tests via DOM/class-name assertions (confirmed in `app.test.tsx`, `documents.test.tsx`). **CSS bundling gap:** no UI test renders through `index.html` or loads an actual stylesheet — happy-dom tests render components directly, and `css.d.ts:2` (`declare module '*.css'`) makes CSS imports type-only in tests. The only check that the bundle still contains every component's CSS is `make build` not erroring, which only proves the *import path* resolves, not that content is unchanged. Low probability given `git mv` colocation (D-18), but no test-level defense exists.
  Unverified: could not execute `make build` or inspect the produced bundle, because I only read source/test files without running the build.
- **mock.module specifier (C-11).** Verified directly from `documents.test.tsx:168-193`: if the specifier drifts from `documents.tsx`'s import, the real `mergeMarkdown` runs instead of the fake, and the test `'an AI edit that fails to merge into one file...'` (asserting `notApplied` equals a specific "the merge broke" entry) fails loudly rather than passing vacuously — confirms the plan's own Risks section claim.
- **happy-dom preload.** `Makefile`'s `test-ui` target hardcodes `--preload ./src/ui/test-setup.ts`, and `test-setup.ts` doesn't move (D-2) — zero risk from this restructure.
- **check.ts spawn path (`check.ts:85`).** `join(SRC, 'server/server.ts')` — `server/server.ts` doesn't move (D-2/D-5), so only `SRC` correctness matters, and only `bun run check` exercises this line end-to-end; no unit test spawns or checks it.

## Q2 — Behaviors for the two test-first modules

**`src/shared/blocks.ts` (`textblocks`)**
1. Worked example asserted exactly: `textblocks(defaultMarkdownParser.parse('# A\n\nb'))` equals `[{text:'A',pos:1},{text:'b',pos:4}]` — full array equality including `pos`, not just text or length.
2. Document order across 3+ mixed block types (heading, paragraph, list-item paragraph, code block), asserting both `text` and `pos` per entry — strengthens the existing count-only/text-only checks in `markdown-editor.test.tsx:86-88`.
3. `isTextblock` filtering: a doc containing a list must exclude the `bullet_list`/`list_item` container nodes and return only the item's inner paragraph.
4. Structural-typing contract: pass a hand-built object satisfying `TextblockTree` (not a real ProseMirror `Node`) and confirm `textblocks()` walks it — the only way to pin the module's "no imports" property (pinned contract, change-plan.md:125-131) in isolation from `prosemirror-markdown`.
5. Empty case: a root whose `descendants` never visits a textblock returns `[]`.

**`src/server/paths.ts` (`SRC`)**
1. `SRC` is the absolute path of `src/`: assert `server/server.ts`, `skills`, `fixtures/workspace`, and `ui/index.html` each exist under `join(SRC, …)`, per D-3's stated design (change-decision-log.md#d-3).
2. Depth-regression guard, which is the test's real job: if `paths.ts` (or an importer's assumption) later sits one level deeper, `resolve(import.meta.dir,'..')` silently returns `src/server`, and the existence checks fail loudly (`src/server/server/server.ts` doesn't exist) instead of resolving somewhere else valid-looking — this is C-1's exact failure mode reproduced.
3. Not coverable by this test: `SRC` inside a `bun build --compile` binary, since `bun test` never runs the compiled artifact — D-3's rationale cites this check but it belongs to `make check-build` (Unit 3), not `paths.test.ts`.

## Q3 — "How you know it worked" sufficiency

- **Unit 1:** `make test` + `tsc` + `grep -r "server/" src/ui` — sufficient, runnable, deterministic. The grep is a structural complement to the behavioral parity test, not a substitute.
- **Unit 2:** `make test` + `grep -rn "import.meta.dir" src` — sufficient for the "one anchor" claim and runnable, but doesn't exercise the compiled-binary path; that's deliberately deferred to Unit 3's `make check-build`, so it isn't actually missing — just easy to misread as "done" before the binary is checked.
- **Unit 3:** `make test`, `tsc`, `make check-build` are fast, deterministic, and runnable without secrets — confirmed `/api/workspace-config` (`workspace-config.routes.ts:8-11`) calls no model, and the Makefile passes `ANTHROPIC_API_KEY=unused`. `make check-build` is the only check exercising the macro inside the actual compiled binary — necessary, not redundant. `bun run check` is the *only* check exercising `documents.routes.ts`, `events.routes.ts`, and `check.ts`'s own spawn line end-to-end (the Q1 gap), but its chat scenarios (`check.ts:143-249`) need a real `ANTHROPIC_API_KEY` and live model replies, so it isn't deterministic the way `make test` is.
  Unverified: could not confirm `ANTHROPIC_API_KEY` is configured wherever this plan will actually be executed, because that's an operator/CI concern outside the repo.
- **Unit 4:** `make test-ui` (79 tests) + `tsc` + `make build` — sufficient for DOM/export/import correctness and runnable. `make build` proves the bundler resolves every import including CSS without erroring; it does not prove bundle *content* is unchanged (the Q1 CSS gap) — pre-existing, but the checklist doesn't disclose the limitation.
- **Unit 5:** "every path the README names exists" — adequately scoped to a docs-only change; not a behavioral check, and doesn't need to be.

## Preserving deltas that change something observable

None found where the claimed Preserving behavior is actually false for its stated observer (HTTP responses, DOM, `/api/workspace-config` payload). One claim is broader than its evidence: **S-6** says "Pinned by all 79 UI tests," but as established in Q1 none of those 79 tests observes the final CSS bundle — the observer for that slice (a browser loading `build/3pitor` or `bun run server`) has no test double at all, only `make build`'s bundler-resolution check. This isn't "the move breaks CSS" (no evidence of that — `git mv` keeps `.tsx`/`.css` paired per the Target State), it's "the delta's stated test pin doesn't actually cover this observer," recorded as a gap above rather than a Preserving-claim violation.


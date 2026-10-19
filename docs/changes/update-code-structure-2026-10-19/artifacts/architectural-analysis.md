---
title: "Architectural Analysis: src/ (all eight packages)"
focus_area: "src/app-files, src/cli, src/engine, src/file-system, src/posts, src/server, src/shared, src/ui, with one layer out to Makefile, package.json, tsconfig.json, scripts/, src/skills, src/fixtures"
size: "medium — eight packages, but the concern is move safety, not a security, data, or ops review (D-2)"
roster: "structural-analyst, behavioral-analyst, concurrency-analyst, risk-analyst, software-architect"
git_available: "yes"
generated: "2026-10-19"
generated_by: "han-core:architectural-analysis"
sections_included:
  - executive_summary
  - structural_analysis
  - behavioral_analysis
  - concurrency_analysis
  - risk_assessment
  - software_architecture_recommendations
  - system_level_concerns_deferred
---

# Architectural Analysis: src/ (all eight packages)

## How to Read This Report

This report checks `src/` against the owner's package → feature → component layout, and names what would make moving
files unsafe. It builds on the
[2026-10-01 analysis](../../update-code-structure-2026-10-01/artifacts/architectural-analysis.md), and re-checks its
findings against the code as it stands after 246 more commits.

- **Executive Summary.** The verdict, the findings that matter, and the moves recommended. Read this if you have two
  minutes.
- **Structural, Behavioral, and Concurrency Analysis.** Each is one specialist's full findings, with file paths and
  code. Finding IDs (`S#`, `B#`, `C#`) are stable and can be cited.
- **Risk Assessment.** `R#` items that score the findings, both as they stand and as hazards to a move.
- **Software-Architecture Recommendations.** `A#` recommendations, each labeled as a pure move or a deferred behavior
  change, with the exact paths and checks for each move.
- **System-level concerns deferred.** Empty for this run.

> Sizing and roster: this run was classified **medium** and dispatched the structural, behavioral, concurrency, risk,
> and software-architect agents (D-2).

> Sections not part of this run:
>
> - No Security, Data-Engineering, DevOps, On-Call, or Observability section: a pure restructure would defer all of
>   their findings (D-2).
> - No Codebase Map: the area is familiar from three earlier structure change sets.
> - No System-Architecture section: nothing crosses a deployable unit, because the UI is bundled into the one binary.

---

## Executive Summary

**Focus area:** all eight packages under `src/` (`app-files`, `cli`, `engine`, `file-system`, `posts`, `server`,
`shared`, `ui`), traced one layer out into the Makefile, `package.json`, `tsconfig.json`, `scripts/`, `src/skills`, and
`src/fixtures`.

**Bottom line:** The tree still follows the layout almost everywhere. Every production import between packages follows
the one-way rules. Seven files or folders sit at the wrong scope, one test import points the wrong way between
packages, and the README describes UI folders that no longer exist. Every fix is a mechanical move inside an existing
package. The real hazards are checks that would go quiet if a move took a test or folder out of their reach.

**Most critical findings:**

- **R1 (B1, B2, B4):** the only high risk. `bun test` runs only tests under the Makefile's roots, and four boundary-test
  scans pass even when they find no files. A move that renamed or added a top-level folder would drop protection with
  `make test` still green. No planned move touches a package root (precondition P1).
- **S1–S5:** files at the wrong scope.
  - `shared/entry-name.ts` has one user, in `posts/file/`.
  - `ui/components/shortcut.ts` is used only in `documents`.
  - `ui/documents/post-dialogs/` is shared by two `documents` components.
  - `post-table/` and `model-picker/` each have a single importer.
  - `engine/chat/components/test-model.ts` and `stub-tool-server.ts` are used outside `chat`.
- **S6:** `posts/bun-free.test.ts` imports `engine/components/bun-only-code`, against the dependency direction.
  Server tests also deep-import five engine modules the README does not name.
- **S12:** the README's `src/ui/` section describes a `post-list/` folder that is gone. It also leaves out post-table,
  post-panel, post-dialogs, confirm-dialog, notice-icons, shortcut, four editor helpers, and `shared/document-key.ts`.
- **C1, C8:** two places hold state at module scope that a careless split could duplicate: the write queue in
  `local-file-system.ts` and the editor's WeakMaps. No move touches either file (precondition P3).

**Highest-impact recommendations:**

- **A1 + A4 (UI):** move `shortcut.ts` to `documents/components/` and `post-dialogs/` to
  `documents/components/post-dialogs/`. Flatten `post-table` into `documents/documents/` and `model-picker` into
  `chat/agent-panel/`, following the 2026-10-01 D-5 precedent.
- **A2 + A3 (engine):** move `bun-only-code.ts` to `src/shared/`, and `test-model.ts` and `stub-tool-server.ts` up to
  `engine/components/`.
- **A5 (posts):** move `entry-name.ts` into `posts/file/`.
- **A6, A7, A8:** name the engine modules server tests may import in the README, move `server/scripts/check.ts` to
  `server/check.ts`, and rewrite the README's layout inventory.

**Clean dimensions and omitted domains:** Production imports between packages are clean. Concurrency state is
closure-scoped everywhere except C1 and C8, so moves do not split it. The behavior defects found (C2, C5–C8, B5, B10)
are follow-ups (A10–A14), unrelated to the moves. Security, data, and ops were left out by choice (D-2), not by the
band cap.

---

## Structural Analysis

> Verbatim output from `structural-analyst`. `S#` findings on module boundaries, coupling, dependency direction,
> abstractions, and duplication.

STRUCTURAL ANALYSIS of /Users/mxriverlynn/dev/mxriverlynn/3pitor/src
Method: I built a relative-import graph over every .ts/.tsx/.css/.html under src/ (excluding .data) and resolved each file's importers, including tests. I checked the Makefile, package.json, tsconfig.json, scripts/node-ts.mjs, the boundary tests and the README. I did not modify any files. Git is available. The churn data is mixed with the 246-commit restructure, so I did not use it for any finding. Hot files in 90 days are documents.tsx, markdown-editor.tsx and their tests; they are big but are not moving.

HEADLINE
- The tree is mostly compliant already. After the 2026-10-01 run and the engine/file-system/posts/app-files extraction, only a handful of files sit at the wrong scope.
- The imports that bypass the layout are all in tests. No production import breaks the one-way package rules.
- Every path-tied check I found fails loudly when a file moves, except two weak spots (S9, S11).

FINDINGS (misplaced files, ordered by impact)

**S1: shared/entry-name.ts (+ test) is scoped too high**
- Dimension: Boundaries
- Files: /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/shared/entry-name.ts, entry-name.test.ts
- Importers: only posts/file/file-post-store.ts (`import { newEntryName } from '../../shared/entry-name';`). No UI, engine or server user. The README even says "The post store is its only production user."
- Target: posts/file/ (flat beside file-post-store.ts), or posts/components/ if you expect a second store.
- Side effects: it is the only thing posts imports from shared, so the posts-imports-shared allowance in posts/boundary.test.ts and the README becomes unused but stays harmless.
- Moving it is safe. Both Makefile test lists include src/posts. README `src/shared/` and posts text need editing.
- Impact: medium.

**S2: ui/components/shortcut.ts (+ test) is scoped too high**
- Dimension: Boundaries
- Files: /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/components/shortcut.ts, shortcut.test.ts
- Importers: documents/documents/documents.tsx, documents/markdown-editor/raw-view.tsx, markdown-editor.test.tsx. All are in the documents feature, none in chat or app.
- Target: ui/documents/components/shortcut.ts, since two components (documents, markdown-editor) use it.
- Impact: medium.

**S3: ui/documents/post-dialogs/ is shared by two sibling components but sits as a component folder**
- Dimension: Boundaries
- Files: /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/documents/post-dialogs/ (tsx, css, test)
- Importers: post-panel/post-panel.tsx and post-table/post-table.tsx. Both are documents siblings.
- Target: ui/documents/components/post-dialogs/ (shared by siblings of one feature).
- It imports only shared/wire and notice-icons. It carries its own CSS and test, so it keeps a folder.
- Impact: medium.

**S4: Component-used-by-one-component cases (call under the D-5 precedent)**
- Dimension: Boundaries
- Each case is a React component with CSS and a test. Under D-5 (link-popup flat in markdown-editor/) it counts as a helper and sits flat:
  - ui/documents/post-table/ is imported only by documents/documents/documents.tsx, so by D-5 it goes flat into ui/documents/documents/.
  - ui/chat/model-picker/ is imported only by chat/agent-panel/agent-panel.tsx, so by D-5 it goes flat into ui/chat/agent-panel/.
  - ui/chat/chat/actions.tsx is imported only by chat.tsx. It is already flat in chat/, so it is correct.
  - ui/components/panel-resizer/ is imported only by ui/app.tsx. app.tsx is the package-root module, and ui/components/ is the nearest covering scope for it. It is arguably already correct; the owner should decide whether root-only helpers move beside app.tsx.
- Unverified: whether the owner wants D-5 applied to these. The README currently documents model-picker and post-list-style folders as components.
- Impact: medium (a judgment call).

**S5: engine/chat/components/test-model.ts and stub-tool-server.ts are used outside the chat feature**
- Dimension: Boundaries
- Files: /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/chat/components/test-model.ts, stub-tool-server.ts
- Importers:
  - test-model: agent.test, providers/ollama.test, providers.test, sessions.test (all chat), plus engine/engine.test.ts at the engine root.
  - stub-tool-server: the chat tests above, plus engine/engine.test.ts and engine/model-config/model-config.test.ts (another feature).
- Both span features or the engine root, so the lowest covering scope is engine/components/.
- chat-test-helpers.ts (claude-cli.test, sessions.test, server mcp-endpoint.test) and fake-claude-on-path.ts / fake-claude.ts are chat-only on the engine side. They stay in chat/components/, except for the cross-package test use in S6.
- Ripple if the two helpers move: engine/bun-free.test.ts EXEMPT entries (`'chat/components/test-model.ts'`, `'chat/components/stub-tool-server.ts'`) must change. The README lines about "the five test helpers" also change.
- Impact: medium.

**S6: Server tests deep-import the engine; posts test deep-imports engine**
- Dimension: Coupling
- Files:
  - /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/chat/mcp-endpoint/mcp-endpoint.test.ts:8-14 imports engine/chat/claude-cli/claude-cli, engine/chat/components/chat-test-helpers, engine/chat/components/fake-claude-on-path, engine/components/json-file, engine/chat/tools/tools.
  - src/server/view-state/view-state.routes.test.ts:6 imports `stateKey` from `'../../engine/components/json-file'`.
  - src/posts/bun-free.test.ts:7 imports `bunHits` from `'../engine/components/bun-only-code'`.
- Findings:
  - No test polices the server-to-engine-entry rule. The only rule is the README text "reaches the engine only through engine/engine.ts".
  - `engine.ts` already re-exports `ServeTools`, `AppSkillFiles` and the like, but not `claudeCliModel`, `fileTools`, `stateKey` or the test helpers.
  - posts importing engine violates the posts rule "imports only file-system and shared". It slips past posts/boundary.test.ts, which exempts test files.
- This is why moving engine test helpers is unsafe in isolation. Moving chat-test-helpers, fake-claude-on-path, json-file or bun-only-code breaks these server/posts tests, and the break is a loud import failure.
- Options for the owner:
  - Move bun-only-code.ts (pure regex, no Bun) to src/shared/. It is used by engine and posts only, and shared imports no package.
  - Decide whether server tests may import engine test helpers.
- Impact: high for a move plan.

**S7: server/scripts/check.ts is a feature-less folder**
- Dimension: Boundaries
- File: /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/scripts/check.ts
- It has no importers. It is run by `package.json` `"check": "bun run src/server/scripts/check.ts"` and spawns `join(SRC, 'cli/cli.ts')`.
- It imports app-files, file-system, shared/document-key, markdown-support and wire. These are allowed by the package rules (server → shared, file-system, app-files), and it is not an engine import.
- It is a capability-less script; its end-to-end role spans cli and server. It could stay.
- If moved, update package.json, the file-system/boundary.test.ts FS_EXEMPT entry (`'src/server/scripts/check.ts'`) and the README.
- Impact: low.

**S8: engine/node-check.ts sits at the engine root and is not a module**
- Dimension: Boundaries
- File: /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/node-check.ts
- It has no importers. Makefile line 43 runs it: `--import ./scripts/node-ts.mjs src/engine/node-check.ts`. It is also named in the file-system FS_EXEMPT list.
- It is a check script, like check.ts. Moving it would need the Makefile, FS_EXEMPT and README to change together.
- Impact: low.

NEGATIVE RESULTS (already correct, no move)
- src/shared/: blocks.ts and passages.ts (engine tools + UI markdown-editor), markdown.ts (engine tools + UI), markdown-support.ts (engine tools + ui documents + check.ts), document-key.ts (engine sessions/tools, ui chat/documents/post-panel, check.ts), wire.ts (everyone). All span browser and Bun. Only entry-name.ts is misplaced (S1). shared imports no package.
- ui/components/api.ts is used by app, chat, model-picker and documents. Correct.
- ui/components/notice-icons.tsx is used by app, chat, documents, post-dialogs, post-panel and post-table. Correct.
- ui/components/confirm-dialog/ is used by chat/model-picker, documents and post-panel. Correct.
- ui/components/menu/ is used by chat/actions, post-panel and post-table. Correct.
- ui/components/fake-posts-api.ts is used by app.test.tsx and documents.test.tsx. Correct.
- ui/events/host-events.ts is used by app.tsx only. It is a one-module feature named to match engine/server events, and fine.
- ui/documents/markdown-editor/: anchored-bubble, image-popup, link-popup, review-strip, raw-view, raw-syntax, raw-formatting, highlight-outline, menu-icons, table-cells and task-items are all imported only by markdown-editor.tsx or by those helpers (anchored-bubble ← image-popup + link-popup; image-popup → link-popup). Nothing outside the editor uses them. review-strip is only a helper; it is not its own component under D-5. All are correctly flat.
- ui/documents/post-panel/: imported by ui/app.tsx directly. A feature-level component.
- ui cross-feature check: no chat to documents or documents to chat import exists. Only app.tsx wires them.
- engine/chat/providers/: cache-usage and claude-models (anthropic + claude-program), reasoning (google + openai) are used only by sibling backends inside providers/. The backends are used only by providers.ts, so all are providers' helpers and flat is consistent with D-5. The alternative reading is one folder per backend, which would need a providers/components/. This is an owner call.
- engine/components/json-file.ts is used by chat/sessions, chat/tools, model-config and view-state. Correct at engine/components/.
- engine/events/events.ts is used by chat/agent, chat/sessions and engine.ts. Correct.
- file-system/components/ (keys, file-system-error) and posts/components/describe-post-store.ts (used by posts/file test and boundary test only) are correct.
- Production cross-package imports: all conform to the README (cli → app-files, engine, file-system, posts, server entries; server → engine/engine.ts type, posts/post-error, shared/wire, ui/index.html; engine → shared, file-system.ts, posts.ts (type), post-error). Nothing imports cli. ui imports only shared. shared imports nothing.
- The engine tests import app-files.ts. The README allows this ("tests may too").

S9: PATH ARITHMETIC (what breaks and whether silently)
- Dimension: Coupling
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/app-files/paths.ts: `export const SRC = resolve(import.meta.dir, '..');` and `join(SRC, 'fixtures/workspace')`. This breaks if app-files is nested deeper. It is caught by paths.test.ts (loud). It is also used by app-skills.macro.ts (`join(SRC, 'skills')`). No move of fixtures/ or skills/ is planned.
- app-files.ts imports `'./app-skills.macro' with { type: 'macro' }`. The two must move together; a miss is a build error (loud).
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/chat/components/fake-claude-on-path.ts:18: `copyFile(join(import.meta.dir, 'fake-claude.ts'), ...)`. Moving only one of the pair breaks all tests that call fakeClaudeOnPath(). It fails in beforeAll with ENOENT (loud).
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/node-check.ts:27: `join(HERE, 'chat/components/fake-claude.ts')`. Moving fake-claude.ts breaks `make check-node` (loud, not run by bun test, but it is in `make test`). The path is in a string, so tsc does not catch it.
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/cli/cli.test.ts uses `join(import.meta.dir, 'cli.ts')` in 4 places. The pair must stay side by side. Loud.
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/documents/markdown-editor/markdown-editor.test.tsx:1606,1621 reads `${import.meta.dir}/markdown-editor.css`. Moving the test and CSS together is fine; moving one is a loud ENOENT.
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/documents/documents/documents.test.tsx:452,454,474,1439,1442,1466 holds `mock.module('../markdown-editor/markdown-editor', ...)`. If documents.tsx's import and these strings go out of step, the mock silently does not apply (the preceding `await import(...)` of the same string fails loud only if the path is wrong).
- Boundary tests with named-path lists:
  - file-system/boundary.test.ts FS_EXEMPT (6 paths) and ENGINE_CONTRACT_EXEMPT (chat-test-helpers.ts).
  - engine/bun-free.test.ts EXEMPT (relative to src/engine/).
  - posts/bun-free.test.ts EXEMPT.
  - posts/boundary.test.ts TEST_ONLY.
  - Each has an "every exemption names a file that exists" test, so a stale entry fails loudly.
  - Danger is in the opposite direction: a moved file not on the list is scanned and fails on Bun-only code (loud).
  - Moving a package folder (not a file) is silent for the "outsider" regexes like `(?:\.\.\/)+posts\/posts`, which match by trailing path. A deep import such as `../../posts/file/file-post-store` is caught by the deepImportHits tests.
- Makefile test lists (`bun test src/cli src/server src/engine src/shared src/file-system src/posts src/app-files`; `bun test --preload ./src/ui/test-setup.ts src/ui`). A new top-level folder under src/ not added to this list is SILENT: its tests never run. A Bun-side test moved under src/ui would run under happy-dom (the reverse is the reverse mistake); a UI test moved out of src/ui would run without the preload and fail loud.
- Makefile line 12 (`src/cli/cli.ts`), line 43 (`src/engine/node-check.ts`, `./scripts/node-ts.mjs`), line 49 (`./src/ui/test-setup.ts`), package.json lines 6-7. All are loud on a move.
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/index.html references `./app.tsx` and `./styles.css`; server.ts imports `../ui/index.html`. Moving app.tsx, styles.css or index.html would break the bundle. Unverified: whether a missing script in index.html fails `bun test` or only the dev server, because I did not run the build.
- tsconfig.json has `"include": ["src"]` and no paths mapping, so it is move-proof.
- scripts/node-ts.mjs has no file paths; it only retries specifiers with `.ts`. It requires engine production code to keep extensionless relative imports.
- CSS bundle order: each component's CSS is imported from its tsx, so order follows import order. D-10 in the precedent proved this with a bundle diff. Do not reorder imports during moves.

S10: Cycle and cross-feature dependency notes
- Dimension: Coupling
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/posts/posts.ts and src/posts/file/file-post-store.ts form a cycle:
  - `posts.ts:196: export { createFilePostStore } from './file/file-post-store';`
  - `file-post-store.ts:8: import type { Post, PostStore, ResearchDocument, ResearchDocumentSummary } from '../posts';`
  - It is a type-only edge in one direction, so no runtime cycle. It stays valid after any move that keeps both relative paths updated.
- engine/model-config/model-config.ts imports `type { ProviderBackend }` from chat/providers/providers. chat/sessions imports model-config (value). It is type-only one way, so no cycle, but model-config is conceptually part of chat. Leave unless the owner wants it moved.
- Impact: low.

S11: Duplicated code across packages
- Dimension: Duplication
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/file-system/boundary.test.ts:36-41 and /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/posts/boundary.test.ts:15-20: identical `isTest` and `sources()` (glob `src/**/*.{ts,tsx}`, read lines). Structural duplication, same caller concept (scan src/). Tests only.
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/bun-free.test.ts:22-26 and src/posts/bun-free.test.ts:17-21: near-identical `productionFiles()`. The scan definition itself was already unified in engine/components/bun-only-code.ts, which is what created the posts to engine test import in S6. The glue is still repeated.
- fake-claude copy-to-bin: engine/node-check.ts:27-29 and engine/chat/components/fake-claude-on-path.ts:18-19. Incidental (Node versus Bun, different harnesses).
- Types restated on purpose: shared/wire.ts:51-96 restates posts/posts.ts:29-85 (PostSummary, Post, ResearchDocumentSummary, ResearchDocument). The comment says "Restates the posts package's ResearchDocumentSummary". This is deliberate, because shared cannot import posts. It is a drift risk: no test ties the two shapes. Medium, shotgun surgery when the post shape changes.
- No other cross-package duplication found.

S12: README "How `src/` is laid out" drift vs the code
- Dimension: Boundaries
- /Users/mxriverlynn/dev/mxriverlynn/3pitor/README.md, `### src/ui/` section (lines ~231-300):
  - Line 258: "`post-list/post-list.tsx` shows every post ..." does not exist. The code has documents/post-table/post-table.tsx, post-panel/post-panel.tsx and post-dialogs/post-dialogs.tsx.
  - Undocumented UI modules: post-table, post-panel, post-dialogs, confirm-dialog, notice-icons, shortcut, markdown-editor/review-strip, image-popup, menu-icons, table-cells. The README grep for these names returns nothing.
  - `src/shared/` section omits document-key.ts. It lists wire, markdown, markdown-support, entry-name, passages and blocks.
  - The README says the post list lives in `documents/` as one thing. In the code, post-panel is wired by app.tsx directly, not by documents.tsx.
- The cli, server, engine, file-system, posts and app-files sections match the code (checked against file lists: five engine chat/components helpers; six FS_EXEMPT entries; describe-post-store; paths.ts and the macro).
- Impact: medium. The README is the source of truth for the layout rules and boundary-test text.

WHAT MAKES MOVING UNSAFE (summary)
1. Server and posts tests deep-import engine helpers (S6). Move or re-export them first.
2. fake-claude.ts and fake-claude-on-path.ts must move together, and node-check.ts has the path in a string (S9).
3. The named-path lists in four tests (S9), the Makefile, package.json and README must be updated in the same change.
4. Do not reorder CSS imports; keep the import order (S9).
5. Do not add a new top-level src/ folder without adding it to Makefile `test-server` (S9, silent).

KEY CONCERNS
1. S6, tests crossing packages by deep imports, with no boundary test for server to engine.
2. S1-S5, a short list of true scope misplacements: entry-name, shortcut, post-dialogs, test-model/stub-tool-server, and the D-5 calls for post-table and model-picker.
3. S12, README drift (post-list and many undocumented UI modules).

WELL-STRUCTURED
- All production cross-package imports follow the one-way rules.
- No UI feature imports another UI feature.
- The markdown-editor and engine providers internals, and shared (except entry-name), are correct.

SKIPPED / LIMITS
- I did not run `make test`, the bundler, or tsc, so the "unverified" items above rest on reading only.
- The first-found D-5 precedent is in docs/changes/update-code-structure-2026-10-01/change-log.md (D-5 at line 152). I did not open the separate decision log and architectural-analysis files (the decision log was not at the path I tried), so any other decision there is unchecked.

---

## Behavioral Analysis

> Verbatim output from `behavioral-analyst`. `B#` findings on data flow, error propagation, state management, and
> integration boundaries.

Move-safety analysis of /Users/mxriverlynn/dev/mxriverlynn/3pitor/src. I read the code but did not run any moves or `make` targets. For each finding, "loud" means a test or typecheck fails and "silent" means nothing fails.

**B1: `bun test` roots are path substring filters, and a layout change can silently drop tests**
- **Dimension:** Integration Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/Makefile
- **Finding:** The two test targets are:
```
test-server: ... bun test src/cli src/server src/engine src/shared src/file-system src/posts src/app-files
test-ui: ... bun test --preload ./src/ui/test-setup.ts src/ui
```
  - `bun test` treats these arguments as filters on the test file path, not as folders. A test file that no filter matches is never run, and nothing reports that.
  - There are 19 UI test files, found under `src/ui`. Everything else is listed in `test-server`.
  - Moving a test to a path outside all eight roots drops it silently. `typecheck` still compiles it, and it still has no `.test` run.
  - The split is also load-bearing in another way. `src/ui/test-setup.ts` registers happy-dom, and the README says it is kept out of the Bun-side tests. A UI test that moves under `src/server` or `src/engine` runs without the DOM and fails loudly with a missing `document`. A server test moved under `src/ui` runs with happy-dom's globals and may pass while seeing different globals.
  - A "feature → package" layout such as `src/posts/server/...` or `src/documents/ui/...` would put UI tests under the `src/posts` or `src/documents` roots. They would then run in the server pass without the preload.
- **Impact:** Silent when a test leaves every root. It is loud in some cases when a UI test lands in a server root. Any layout change needs the Makefile roots changed in the same step.

**B2: The boundary tests are written against the current package layout, and several pass vacuously after a move**
- **Dimension:** Data Flow
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/posts/boundary.test.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/file-system/boundary.test.ts
- **Finding:** Both tests scan `src/**/*.{ts,tsx}` and decide from path strings and relative-import shapes. Here are the strings they depend on:
```
const IMPORTERS = ['src/cli/', 'src/server/', 'src/engine/'];
const PACKAGE_IMPORT = /['"](?:\.\.\/)+posts\/([^'"]+)['"]/;
const outside = (path: string) => !path.startsWith('src/posts/');
.filter(({ path }) => path.startsWith('src/engine/') && !isTest(path))
/['"][^'"]*file-system\/(?!file-system['"])[^'"]+['"]/
```
  - Several tests have no check that their filtered file set is non-empty:
    - "engine production code imports posts/posts only with an import type declaration"
    - "engine production code imports only contract symbols from the file-system entry"
    - "outside src/posts/, only cli, server, and engine import the package"
    - "no production module outside src/file-system/ touches the disk directly"
  - If the engine, cli or server directories move, those tests scan zero files and pass.
  - Only the "package imports nothing but its own modules" test asserts `toContain('src/posts/post-error.ts')`. That makes it loud if `post-error.ts` moves, and it is the only guard.
  - False-positive trap, which is loud: `PACKAGE_IMPORT` matches any relative `../posts/<x>` import, not only imports of the posts package. `src/server/posts/` is a feature folder named `posts`. A new sibling-feature import such as `../posts/posts.routes` from another server feature is flagged by `deepImportHits` as a deep import of the package.
  - Any feature folder named `posts`, `file-system`, or `app-files` inside another package triggers the same false matches. That includes `src/ui/documents/...` if it is renamed to `posts`, which `outsiderHits` would flag.
  - The `SPECIFIER`/`posix.join` resolution in `packageImportHits` resolves relative to `src/posts/` and expects `target === 'src/file-system/file-system'` exactly. Moving `file-system.ts` into a deeper path makes every posts import fail, which is loud.
- **Impact:** Moves within a package are mostly loud and correct. Moves of the package roots turn the engine-scoped and cli/server-scoped rules into no-ops, silently.

**B3: Exempt and test-only lists are guarded by an existence check, so stale entries fail loudly**
- **Dimension:** Data Flow
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/bun-free.test.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/posts/bun-free.test.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/posts/boundary.test.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/file-system/boundary.test.ts
- **Finding:** Every exempt list has a companion test, for example:
```
test('every exemption names a file that exists', () => {
  for (const path of EXEMPT) expect({ path, exists: existsSync(join(ENGINE, path)) }).toEqual({ path, exists: true });
});
```
  This covers `EXEMPT` in both bun-free tests, `TEST_ONLY` in the posts boundary test, and `FS_EXEMPT` plus `ENGINE_CONTRACT_EXEMPT` in the file-system boundary test.
  - The exempt lists are:
    - engine `EXEMPT`, which names `chat/components/fake-claude.ts`, `fake-claude-on-path.ts`, `chat-test-helpers.ts`, `test-model.ts`, `stub-tool-server.ts` and `components/bun-only-code.ts`.
    - posts `EXEMPT`, which names `components/describe-post-store.ts`.
    - `FS_EXEMPT`, which names `src/app-files/app-skills.macro.ts`, the engine test helpers, `src/server/scripts/check.ts` and `src/engine/node-check.ts`.
  - A move fails loudly: the old path no longer exists, and the file at its new path is no longer exempt. For example, `test-model.ts` at its new location is scanned for `bun:test` and fails.
  - The exempt paths are relative to the package root in the bun-free tests and repo-relative in the boundary tests. Each list must be edited in its own form.
  - One loud edge: `posts/bun-free.test.ts` imports `../engine/components/bun-only-code`, and the engine's `EXEMPT` names it too. Moving it breaks the import in `posts/bun-free.test.ts`, and the engine exempt entry fails the existence test.
  - Unmoved test helpers are not exempt unless named. Moving the `components/` helpers between folders is covered by the lists above.
  - The `bunHits` rule `/['"][^'"]*app-files\//` flags any engine or posts production file whose import path contains `app-files/`. This is fine unless the folder is renamed. A renamed `app-files` package would silently stop being detected as Bun-only.
- **Impact:** Negative result. Stale exempt entries are loud, not silent. The silent case is a renamed `app-files` folder escaping the Bun-only pattern.

**B4: `import.meta.dir` / `import.meta.url` anchors**
- **Dimension:** Data Flow
- **File(s):** see the table below. All paths are under /Users/mxriverlynn/dev/mxriverlynn/3pitor/src.
- **Finding:**

| Anchor | Code | What breaks on a move | Loud or silent |
|---|---|---|---|
| `app-files/paths.ts` | `export const SRC = resolve(import.meta.dir, '..');` | Moving `paths.ts` makes `SRC` wrong, and so are `WORKSPACE_FIXTURE`, the skills dir and `.data`. | `paths.test.ts` catches it loudly. A move to a *sibling at the same depth* (such as `src/x/paths.ts`) keeps `SRC` right, but the test file moved with it passes, which is correct. |
| `app-files/paths.ts`, moving `fixtures/` or `skills/` | `join(SRC, 'fixtures/workspace')`, `join(SRC, 'skills')` | Moving `src/skills` or `src/fixtures` breaks the string paths. | Loud via `paths.test.ts` (`existsSync` of `skills`, `fixtures/workspace`, `server/server.ts`, `ui/index.html`). Moving `server/` or `ui/` also fails this test. |
| `engine/node-check.ts` | `copyFile(join(HERE, 'chat/components/fake-claude.ts'), ...)` and `await import('./engine')` plus `'./chat/claude-cli/claude-cli'` | Moving `fake-claude.ts`, `claude-cli` or `engine.ts` breaks it. | The dynamic imports are literal strings, so `tsc` catches them. The `copyFile` path is a plain string and only `make check-node` (inside `make test`) catches it, loudly. |
| `engine/chat/components/fake-claude-on-path.ts` | `copyFile(join(import.meta.dir, 'fake-claude.ts'), join(bin, 'claude'))` | It assumes `fake-claude.ts` is a sibling. If they separate, `copyFile` throws in `beforeAll`. | Loud, but only in tests that call it. |
| `cli/cli.test.ts` | `join(import.meta.dir, 'cli.ts')` (four spawns) | Moving `cli.test.ts` or `cli.ts` apart breaks them. | Loud. |
| `posts/boundary.test.ts` | `const REPO = join(import.meta.dir, '..', '..');` | Hard-codes the test's depth (two levels below the repo root). | Moving the test deeper makes `REPO` a different folder, so `sources()` finds no files. The scan then passes vacuously on whatever tests have no non-empty assertion (see B2). |
| `file-system/boundary.test.ts` | `const SRC = join(import.meta.dir, '..'); const REPO = join(SRC, '..');` | Same depth assumption. | Same silent-vacuous risk. |
| `posts/bun-free.test.ts` | `const POSTS = import.meta.dir;` | Scans the folder the file is in. | Moving it makes it scan a different folder. The `toContain('posts.ts')` guard makes this loud. |
| `engine/bun-free.test.ts` | `const ENGINE = import.meta.dir;` | Scans the folder the file is in. | The `toContain('engine.ts')` guard makes it loud. |
| `ui/documents/markdown-editor/markdown-editor.test.tsx` lines 1606 and 1621 | ``Bun.file(`${import.meta.dir}/markdown-editor.css`)`` | The test must sit beside `markdown-editor.css`. | Loud, because the file read fails. |
| `server/scripts/check.ts` | `join(SRC, 'cli/cli.ts')`, `join(SRC, '.data', 'check-workspace')` | Moving `cli.ts` breaks `bun run check`. | Loud, but `make test` does not run it (it needs an API key). |

  - `package.json` script `"server"` also names `src/cli/cli.ts`. `check` names `src/server/scripts/check.ts`.
  - `bun run check` is not in `make test`, so a stale path in it would not be noticed by CI.
- **Impact:** All of these are loud except the two boundary tests' depth assumption (silent vacuous pass).

**B5: Bun macro embedding of `src/skills`, and the compiled binary**
- **Dimension:** Integration Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/app-files/app-files.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/app-files/app-skills.macro.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/Makefile
- **Finding:**
```
import { appSkillFiles } from './app-skills.macro' with { type: 'macro' };
...
const dir = join(SRC, 'skills');
for (const path of [...new Bun.Glob('**/*.md').scanSync({ cwd: dir })].sort()) ...
```
  - The macro runs at bundle time, and `SRC` is computed from the macro's own `import.meta.dir`. The macro and `paths.ts` must move together.
  - Only `*.md` under `src/skills` is embedded, keyed by the path relative to that folder.
  - If `src/skills` moves, the dev server and tests both break: `paths.test.ts` and the workspace-config route tests assert skills exist.
  - `make check-build` checks only that `/api/workspace-config` lists `"collaborative-editing"`, and that `--version` matches. It does not check `proofread` or `research`, or the UI.
  - If the skills folder moves and the macro's join is not updated, I could not verify whether Bun's `Glob.scanSync` throws or returns empty for a missing `cwd`. A silent empty map would still be caught by the workspace-config test and by `check-build`, because `collaborative-editing` would be missing.
  - Other asymmetry: the `.md`-only glob means a `.txt` or `.json` placed in a skill reference folder never reaches the binary, which is a bug unrelated to moves.
  - In the compiled binary `import.meta.dir` resolves to Bun's embedded filesystem, so `SRC`/`WORKSPACE_FIXTURE` are meaningless there. `cli.ts` passes `WORKSPACE_FIXTURE` to `chooseWorkspace`, but `ensureWorkspace` only copies from it when `WORKSPACE` is set and absent. That is dev-only today, and a move does not change it.
- **Impact:** Moves of `skills/`, `app-files/` or the macro are loud in `make test`. A move that keeps the `.md` set but changes subfolder keys is not checked by anything. The keys feed the `3pitor://skills/...` URLs that `server/scripts/check.ts` and the MCP endpoint tests read. For example, `mcp-endpoint.test.ts` asserts a read of `3pitor://skills/proofread/SKILL.md`.

**B6: `ui/index.html` import and the `ui` entry paths**
- **Dimension:** Integration Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/server.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/index.html
- **Finding:**
```
import homepage from '../ui/index.html';
...
routes: { '/': homepage },
```
```
<link rel="stylesheet" href="./styles.css" />
<script type="module" src="./app.tsx"></script>
```
  - `server.ts` imports the HTML by a relative path. The HTML references `./styles.css` and `./app.tsx` relative to itself.
  - `ui/css.d.ts` has `declare module '*.css';`, so the `tsc` typecheck does not verify any CSS import path.
  - Moving `index.html`, `styles.css` or `app.tsx` breaks the page. A bad `.html` import path breaks typechecking only if `@types/bun` declares `*.html`, which it does. A wrong `src`/`href` inside the HTML is not checked by `tsc` or by any test.
  - Nothing in `make test` fetches `/`. `make check-build` fetches only `/api/workspace-config`. A broken UI bundle in the compiled binary, or a missing stylesheet, ships silently. CSS import paths inside `.tsx` files are the same: `import './documents.css'` fails at bundle time only, because of the `*.css` ambient module.
  - UI tests under happy-dom do not load CSS at all, so a moved or misspelled CSS import is not seen by them either. Only `markdown-editor.test.tsx` reads one CSS file by path.
  - `paths.test.ts` asserts `ui/index.html` exists, but not its sibling files.
- **Impact:** Silent for CSS and HTML-internal paths. The app breaks in the browser, and no check covers it.

**B7: CSS cascade order depends on the module graph, so moving a component can silently restyle**
- **Dimension:** State Management
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/**/*.tsx and the 16 CSS files under /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui
- **Finding:**
  - Each component imports its own CSS (for example `import './documents.css';` in `documents.tsx`). `styles.css` is a `<link>` in the HTML. The bundler orders the component CSS by import-graph order. That order comes from `app.tsx` importing `panel-resizer`, `host-events`, `documents`, `post-panel`, `chat`, `agent-panel`, in that order, and from `documents.tsx` importing `confirm-dialog`, `markdown-editor`, `post-table`.
  - In `markdown-editor.tsx` the order matters internally and must be kept:
```
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-menu/style/menu.css';
import 'prosemirror-example-setup/style/style.css';
...
import './markdown-editor.css';
```
  `markdown-editor.css` overrides the library CSS, for example `.rich-editor .ProseMirror-menubar { display: flex; ... }`. If the `./markdown-editor.css` import moves ahead of the library imports, or is split into another file, the overrides lose on equal specificity and nothing fails.
  - The cross-file check I ran: no top-level selector appears in more than one CSS file. The one same-file repeat in `post-panel.css` (`.files .row > .row-actions:has(...)` twice, lines 24 and 28) and `.side-head` in `agent-panel.css` stay inside one file. So a component move should not reorder identical-selector rules.
  - `styles.css` holds the palette (`:root` variables), so the variables are available to all component CSS regardless of order.
  - Unverified: could not inspect cascade at different-selector, equal-specificity overlaps on the same element (for example global element rules in `styles.css` against a class rule), because there is no tool in this environment that computes it. No test or happy-dom render covers cascade either.
- **Impact:** Silent visual regressions if the import order changes. Likely low unless a component is merged or split.

**B8: Make targets and tooling that name files directly**
- **Dimension:** Integration Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/Makefile, /Users/mxriverlynn/dev/mxriverlynn/3pitor/package.json, /Users/mxriverlynn/dev/mxriverlynn/3pitor/scripts/node-ts.mjs, /Users/mxriverlynn/dev/mxriverlynn/3pitor/.github/workflows/release.yml
- **Finding:**
  - Paths named literally:
    - `build`: `src/cli/cli.ts`
    - `check-node`: `src/engine/node-check.ts` and `./scripts/node-ts.mjs`
    - `typecheck`: `tsc --noEmit -p .` over `"include": ["src"]`
    - `test-server` and `test-ui`: see B1
    - `package.json`: `src/cli/cli.ts`, `src/server/scripts/check.ts`
    - `test-ui`: the preload `./src/ui/test-setup.ts`
  - Moving `cli.ts` breaks `make build`, `check-build` and the release workflow (`make check-build THREEPITOR_VERSION="$V"`). All loud, but not part of `make test`. `build` is not in `make test`, so it is the CI release run that would catch it. The README says `cli.ts` stays put for this reason.
  - `scripts/node-ts.mjs` resolves extensionless relative imports by retrying with `.ts`:
```
if (!specifier.startsWith('.') || specifier.endsWith('.ts')) throw error;
return nextResolve(`${specifier}.ts`, context);
```
  - Under that hook `./foo` resolves only to `foo.ts`. A directory import like `./components` (an `index.ts`) fails to load on Node, as do `.tsx` imports and non-relative aliases. The engine has no `index.ts` today. A move that introduces a barrel `index.ts` or imports a `.tsx` file from the engine would fail `make check-node` loudly. Bun and `tsc` (`moduleResolution: bundler`) would accept it.
  - `tsconfig` has `"types": ["bun"]` and includes all of `src`. `fixtures/workspace` holds only markdown here, so no stray `.ts` is compiled.
  - Another coupling: `node-check.ts` loads the whole engine on Node, so any engine file that gains a Bun-only import (such as a moved file from `app-files`) fails there as well as in `bun-free.test.ts`.
- **Impact:** Loud everywhere except the build path, which depends on release CI. The Node resolver restriction on directory and `.tsx` imports is a loud trap for the engine.

**B9: Fake-claude is copied out of the repo, so it cannot have relative imports**
- **Dimension:** Integration Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/chat/components/fake-claude.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/chat/components/fake-claude-on-path.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/node-check.ts
- **Finding:** Both users copy `fake-claude.ts` to `<tmp>/claude` and run it by its `#!/usr/bin/env bun` line. Its only import today is `import { appendFileSync } from 'node:fs';`, so the copy works. Any relative import added to it during a reorganization (to share a type or constant) would fail with a module-not-found at runtime in the temp folder. Typecheck passes. The tests that spawn it fail loudly, but with an error from inside the spawned process (probably a stream that ends early), not a clear message.
- **Impact:** A trap for a "move shared helpers" change. It is loud, but with a confusing failure.

**B10: Cross-package error identity via `instanceof PostError` / `FileSystemError`**
- **Dimension:** Error Propagation
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/posts/file/file-post-store.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/posts/posts.routes.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/chat/tools/tools.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/file-system/glob/glob.ts
- **Finding:**
```
if (error instanceof PostError) {
  return c.json<ApiError>({ error: error.message, subject: error.subject }, error.reason === 'not-found' ? 404 : 400);
```
```
if (error instanceof PostError && error.reason === 'not-found') return '';
```
  - `instanceof` is correct only if every importer loads the same module instance. The boundary tests force every importer through `posts/post-error` and `file-system/file-system`, so there is one copy. A move that creates a second copy of `post-error.ts` (a re-export that duplicates the class, or two paths resolving to different files) would make `instanceof` false. Bun dedupes by resolved real path, so a moved file imported by different relative specifiers still yields one instance. The compiled binary bundles one copy.
  - If it did go false, the server routes would answer an unhandled 500 instead of 404/400, silently changing behavior.
  - `engine/chat/tools/tools.ts` imports `PostError` as a value from `../posts/post-error`, which the README allows. It is the one value import of the posts package from engine. `glob.ts` swallows every `FileSystemError` as `[]`, so any failure there looks like "no matches". That is a behavior issue unrelated to moves.
  - Note the file-post-store `catch` blocks mask non-`PostError` errors only through the `signal()` path and `instanceof` checks. All of them depend on the same single-copy assumption.
- **Impact:** Low unless a move duplicates the class. Loud for tests that exercise it (`posts.routes` tests assert 404). Fine as is.

**B11: Fixture contents and `.data` are read by position and by name**
- **Dimension:** State Management
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/fixtures/workspace, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/workspace-config/workspace-config.routes.test.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/posts/posts.routes.test.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/scripts/check.ts, /Users/mxriverlynn/dev/mxriverlynn/3pitor/package.json
- **Finding:**
```
expect(await get(join(SRC, 'fixtures/workspace'))).toBe('{"skills":["collaborative-editing","doc-stats","proofread","research"],"agents":["proofreader","title-writer"]}');
```
  - That test reads the fixture directly through `SRC`, with a hard-coded `fixtures/workspace` string instead of `WORKSPACE_FIXTURE`. Moving the fixture breaks `paths.ts`, this test, and `posts.routes.test.ts` (via `WORKSPACE_FIXTURE`), all loudly.
  - The fixture has `.3pitor`, `.claude` and `notes/`. `.data/` is gitignored, and `bun run server` seeds `src/.data/workspace` only when it does not exist (`ensureWorkspace`), so a changed fixture is never re-copied into an existing dev workspace.
  - The workspace-config test asserts the fixture lists four skills, three of them (`collaborative-editing`, `proofread`, `research`) from the app's skills and `doc-stats` from the fixture's own `.claude`. If the app skill set is regrouped, this expectation fails loudly.
  - `ui/chat/chat/chat.tsx` has `path.replace(/^.*\/\.data\/[^/]+\//, '')`, which depends on the workspace living under a `.data/<name>/` folder. That is a display detail only and unrelated to source layout, but `src/.data` is where `SRC` points. Moving `SRC` or `.data` changes the stripping silently, since it only affects the tool row label.
- **Impact:** Loud for tests. Silent only for the stale seeded `.data/workspace` and the chat path label.

**B12: Package seam wiring in cli**
- **Dimension:** Integration Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/cli/cli.ts
- **Finding:** `cli.ts` runs at module top level with no exports. It builds one `fileSystem = createLocalFileSystem(root)` and passes the same instance to `createFilePostStore(fileSystem)` and `startEngine({ fileSystem, ... })`, so the store and the engine share one watcher and one set of paths. `startServer(engine, ...)` gets only the engine. The shared state crossing the seams is that one `FileSystem` instance (in-memory watch state included), `process.env`, and `APP_SKILL_FILES`, which is a build-time constant. A move that makes the posts store build its own file system from a different root would split them silently. No test builds this wiring other than `cli.test.ts` spawning the real process. The imports are relative paths (`'../app-files/app-files'`, `'../posts/posts'`, and so on), which `tsc` checks.
- **Impact:** Negative result for moves: renaming any of these import paths is loud in `tsc`. The wiring itself is covered only by the spawned-process tests in `cli.test.ts`, which pass a workspace argument.

**Follow-ups unrelated to moves (brief)**
- `file-system/glob/glob.ts` returns `[]` on any `FileSystemError`, which makes real errors look like "no matches".
- `make check-build` does not fetch `/`, so the bundled UI and CSS are never exercised in the build.
- `bun run check` is not part of `make test`.
- The `.md`-only skill embed (B5).

### Behavioral Summary
- **Focus area analyzed:** All eight packages under `src`, plus the Makefile, `package.json`, `scripts/node-ts.mjs`, the release workflow, `src/skills` and `src/fixtures`. I traced each `import.meta` use, each boundary test's path logic, the macro, the HTML import and the CSS import graph through the actual code.
- **Key concerns:**
  1. The `bun test` roots in the Makefile are substring filters, so a test file that leaves them is dropped silently, and UI-versus-server preload placement can change what a test sees (B1).
  2. Boundary tests encode the package layout (`src/engine/`, `src/cli/`, `../posts/`, `REPO` depth). After a package-level move several of them scan zero files and pass vacuously (B2, B4).
  3. The UI bundle (HTML, CSS imports, cascade order) is verified by nothing in `make test` or `check-build`, and the `*.css` ambient module hides bad paths from `tsc` (B6, B7).
- **Well-handled areas:**
  - Exempt lists all have an existence test, so a stale entry fails loudly (B3).
  - `paths.test.ts` guards `SRC`, the fixtures, the skills and the UI folder (B4).
  - `bun-free` tests have `toContain` guards.
  - Imports between packages are relative paths that `tsc` checks.
  - Cross-file identical CSS selectors: none.
  - `instanceof` single-copy assumptions hold today (B10).
- **Skipped dimensions:** None skipped. I did not run `make test`, `make build`, or any move, so the loud/silent calls come from reading the code. Unverified: could not run or inspect Bun's `Glob.scanSync` behavior for a missing directory, because that needs executing a move. CSS cascade overlaps between different selectors are likewise unverified (B7).

---

## Concurrency Analysis

> Verbatim output from `concurrency-analyst`. `C#` findings on race conditions, resource contention, deadlock potential,
> async error handling, and synchronization.

## Concurrency analysis of /Users/mxriverlynn/dev/mxriverlynn/3pitor/src

Concurrency patterns are present: async/await, promise-chain queues, fs.watch with timers, Bun.serve, a WebSocket, and React refs. There are no threads, locks or workers. This is a single-threaded event loop, so "race" below means an interleaving at an await point, not a data race. I read the code at HEAD. I did not run tests. I did not read the full 246-commit diff; I judged the prior findings against current code (`git diff --stat 1c58be5 HEAD -- src` shows 192 files changed).

### Main answer for the restructure

The module-scope shared state is small. There are three real singletons:
- `pending` (a Map) in `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/file-system/local/local-file-system/local-file-system.ts`.
- `temps` (a counter) in the same file.
- The `undoManagers` WeakMap, plus the `rawFormatters`, `linkPopups` and `imagePopups` WeakMaps, in `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/markdown-editor/markdown-editor.tsx`. This one sits outside the areas you listed.

Everything else is closure-scoped or instance-scoped, so moving the files does not split it. The one condition is that the wiring stays the same: one `createFilePostStore`, one `Sessions`, one `EventBus`, one `useDocuments()` and one `useHostEvents()`.

The old `json-file.ts` write queue is gone. `json-file.ts` now delegates ordering to `FileSystem.write`, so the module-identity risk for that queue has moved into `local-file-system.ts` (C1).

**C1: The process-wide write queue and temp counter live at module scope in local-file-system.ts**
- **Dimension:** Synchronization / Race Conditions
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/file-system/local/local-file-system/local-file-system.ts`
- **Finding:** Write ordering depends on a module-level Map, and the non-atomic temp file name depends on a module-level counter.
```ts
// Every write in the process, keyed by its disk path, so writes to one key land in call order, even across instances
// on the same root. An entry is dropped once its last write settles.
const pending = new Map<string, Promise<void>>();
...
const temp = join(tmpdir(), `3pitor-${process.pid}-${++temps}.tmp`);
...
let temps = 0;
...
const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
```
  - `pending` is shared by every `createLocalFileSystem` instance, deliberately. It is correct today only because there is one module instance of this file.
  - If the file were reachable through two resolved paths (for example a barrel re-export plus a direct import that bundles twice), each copy would get its own `pending` and its own `temps`.
  - Two writes to the same key through different copies would then run concurrently. Both copies would also start `temps` at 0, so both would use `3pitor-<pid>-1.tmp`.
  - The atomic path, `.name.pid.tmp`, has a pid-only temp name that relies entirely on the queue for exclusion. Two concurrent `swapIn` calls to one key would write into the same temp file, and one rename would then fail or install the wrong text.
  - The same risk exists across two server processes on one workspace for the non-atomic temp. The pid is part of the name, so that case is safe. Only the two-module-instance case is exposed.
  - `queuedUnder` (used by `move` and `delete`) also reads `pending`. A split `pending` would let a delete or move overtake a queued save, and the save would resurrect the old name. The comment in the code names this risk.
  - Keep `pending`, `enqueue`, `queuedUnder` and `temps` in one file. Nothing outside this file imports them except `pendingWriteCount`, which is test-only.
- **Impact:** After a mis-wired move, there would be no error. Writes to one file could interleave, and a save could land after a move or delete. This is silent corruption or resurrection of deleted files.

**C2: Parallel Edit or Write tool calls on one document lose an update (prior C1/C2 still hold)**
- **Dimension:** Race Conditions
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/chat/tools/tools.ts`
- **Finding:** Both the `.3pitor/` note path and the post path are read-modify-write sequences with an await between the read and the write.
```ts
const text = await readExisting(note, file_path);
await writeText(fileSystem, note, replaceOnce(note, text, old_string, new_string));
```
```ts
const { name, text } = await target(file_path);
const next = replaceOnce(name, text, old_string, new_string);
refuseUnsupported(name, text, next);
markEdited(turn, name, next);
```
  - `target()` is async. Even when it returns the cached `turn.texts` copy, the copy is captured before the continuation runs.
  - If the model emits two Edits in one step, the SDK runs their `execute` calls concurrently. I did not confirm how the SDK or the MCP path schedules tool calls (`Unverified`, below).
  - Edit A and Edit B both capture text T0. A writes T1. B resumes with stale T0 and writes T0+B, so A's change is lost. `replaceOnce` does not catch this, because B's `old_string` still occurs once in T0.
  - For notes, `writeText` queues the writes in order, but the read happened before the queue, so the later write overwrites the earlier one.
  - Nothing here is module-level. `turnTexts` is created once per turn in `Sessions.chat` and shared by closure.
  - A move is safe as long as `Sessions`, `fileTools` and `editedTexts` keep sharing the same turn object.
  - Moving the `aborted ? {} : editedTexts(turn)` gate in `sessions.ts` would change behavior (late edits from a stopped turn would leak).
- **Impact:** A silent lost edit in one turn. This is a follow-up, not a restructure issue.
- Unverified: could not run a model turn or trace the AI SDK and MCP tool scheduling, because the check needs a live provider. Whether parallel same-document Edits actually occur is unconfirmed.

**C3: Document and note sync is not atomic with the .gitignore bootstrap (low impact)**
- **Dimension:** Race Conditions
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/components/json-file.ts`
- **Finding:** This is a check-then-act that is benign.
```ts
if ((await fileSystem.stat(GITIGNORE)) === undefined) await fileSystem.write(GITIGNORE, '*\n', { atomic: true });
```
  - Two concurrent first-time writes both see the file missing and both write the same `*\n` content. The writes go through the queue, so they are ordered, and the result is identical.
  - It is not a bug. I note it because the `fileSystem.write` of `session.json` and the gitignore write run in parallel (`Promise.all`), and if the first rejects the other still runs.
- **Impact:** None to data. This only matters if the gitignore content ever becomes non-constant.

**C4: The post store's per-post queue, tombstones and watch are all instance-scoped, and ordering is not shared across stores**
- **Dimension:** Synchronization / Resource Contention
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/posts/file/file-post-store.ts`
- **Finding:** The state is declared inside `createFilePostStore`.
```ts
const queues = new Map<string, Promise<unknown>>();
const tombstones = new Set<string>();
const researchTombstones = new Map<string, Set<string>>();
const subscriptions = new Set<Subscription>();
let stopWatching: (() => void) | undefined;
```
  - Moving files is safe. The queues are not module-level, and `cli.ts` calls `createFilePostStore` once.
  - The queue orders calls per post id. It does not order `post.create` against a concurrent `list` or `walk`, which are not queued.
  - `claimFolder` (`createFolder`, which fails with `exists`) is the actual guard against two creators.
  - Tombstones are per store. A second store on the same workspace would not know them. There is only one today.
  - `list()` is unqueued and the `changing()` wrapper signals only after a change settles. The watcher also signals on the same change, so a tab gets two `posts-changed` hints. The UI sync coalesces them (see below).
  - The single shared `fileSystem.watch` is started by the first subscriber and stopped by the last.
  - The engine subscribes once in `startEngine`, never unsubscribes on success, and says so in a comment. The `try/catch` does unsubscribe on a failed `sessions.load()`. This is correct.
  - `signal()` iterates a copy and checks `active`, so a listener can safely unsubscribe itself.
- **Impact:** Low. Do not construct two stores over one workspace in the restructure. That would split the tombstones, queues and watches.

**C5: Watcher snapshot and settle queue are per-watch, correct, and never closed in production (prior C4 reduced)**
- **Dimension:** Resource Contention / Async Errors
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/file-system/local/local-file-system/watch.ts`
- **Finding:** All state is closure-local to each `watchLocal` call (`snapshot`, `touched`, `quiet`, `cap`, `settling`, `building`). Moves are safe.
```ts
settling = settling.then(settle).catch(stop);
```
  - Settles are serialized, so a slow walk cannot overlap the next one. A listener throw is caught in `deliver` and logged.
  - A walk failure calls `stop`, which closes the watcher and logs one error. After that the workspace silently stops reporting changes until restart. The UI would not know, since `useHostEvents` stays connected.
  - `walk()` at startup runs concurrently with incoming OS events. The `building` flag and `activity` handle this. Events during the build are folded into one arm after it ends.
  - The old watcher-level `documents-changed` event no longer exists. The current events are `posts-changed` and `turn-finished`.
- **Impact:** Medium-low. A single transient `readdir` error (other than ENOENT/ENOTDIR) permanently kills live sync. This is a follow-up.

**C6: Per-model-call loopback MCP server: lifecycle depends on the caller calling stop()**
- **Dimension:** Resource Contention / Async Errors
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/chat/mcp-endpoint/mcp-endpoint.ts`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/chat/claude-cli/claude-cli.ts`
- **Finding:** Each call gets its own `Bun.serve` on port 0, an unguessable path and a closure counter.
```ts
let calls = 0;
...
return { mcpServer: { type: 'http', url: `${server.url.origin}${path}` }, stop: () => server.stop(true) };
```
  - Nothing is module-level, so a move is safe. Subagents and parallel calls each get their own server.
  - Cleanup depends on `endpoint?.stop()` (claude-cli.ts line 112) running on every exit path. I did not read the claude-cli end-to-end to prove every error path reaches it. A path that skips `stop()` would leak a listening port and a server per turn.
  - `calls` is incremented before the await, so concurrent tool calls get distinct ids.
  - `message.params.protocolVersion` and `tools/call` params are used without a guard. A malformed request throws inside `fetch`, which Bun turns into a 500. That is not a leak.
- **Impact:** Medium if `stop()` is skipped on some path, otherwise none. The server is bound to 127.0.0.1 with a random path.
- Unverified: could not trace every exit path in claude-cli.ts to `endpoint.stop()`, because I read only the stop call site and not the full call lifecycle.

**C7: Sessions: single-turn guard is correct; saves are unordered with respect to each other only through the file-system queue**
- **Dimension:** Race Conditions / Synchronization
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/engine/chat/sessions/sessions.ts`
- **Finding:** `Sessions` holds a `Map` of sessions and a `currentId` as instance state. The turn guard is a check-then-act that is safe on one thread.
```ts
if (session.abort) throw new Error(`session ${sessionId} already has a turn in progress`);
...
session.abort = abort;
```
  - There is no await between the check and the set, so two concurrent `chat()` calls cannot both pass.
  - `abort` is cleared in the `finally` of `record`. If the `stream.tee()` consumer were never drained, `record` still runs on the server's copy.
  - Saves of the same session.json are ordered by the write queue. `create()` can race a finishing turn: the turn's `record` saves only when `session.id === this.currentId`, which the code handles. After a failed `create`, it restores `currentId` and re-saves the previous session.
  - One edge: a turn's start-of-turn save is fire-and-forget with only a log on failure. It is not awaited, so a failed save leaves memory ahead of disk until the turn-end save.
  - `EventBus` is an instance (`new EventBus()` in `wire()`), not a global. It has no per-listener isolation:
```ts
for (const listener of this.listeners) listener(event);
```
  A throwing subscriber would stop later subscribers. The only subscriber today is the WebSocket route's `ws.send`.
- **Impact:** Low. Preserve the single `EventBus` and single `Sessions` per engine.

**C8: UI: one-instance coupling in useDocuments and useHostEvents; sync, write and view queues are correct**
- **Dimension:** Race Conditions / Synchronization
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/documents/documents/documents.tsx`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/events/host-events.ts`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/app.tsx`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/documents/markdown-editor/markdown-editor.tsx`
- **Finding:** The coordination state is all `useRef` inside `useDocuments` (`opened`, `listRef`, `listCalls`, `loading`, `sync`, `writing`, `turnBases`, `applying`, and so on). There is one instance, in `app.tsx` line 17.
```ts
const sync = useRef<{ running?: Promise<void>; queued?: Promise<void> }>({});
```
```ts
const writing = useRef({ waiting: false, inFlight: false, again: false, failed: false });
```
  - `syncWithDisk` coalesces concurrent calls into one running sync and at most one queued sync, which absorbs duplicate `posts-changed` hints.
  - The view-state write is a debounce of 300 ms plus an in-flight and `again` latch. That is correct and serialized.
  - `useHostEvents` carries its own comment "Call this once, from App: every call opens its own socket". It has a retry timer, and its cleanup clears the timer and nulls `onclose`. The cleanup is correct. The reconnect is a flat 1 s retry with no backoff, so it is fine.
  - A reconnect does not re-sync. A `posts-changed` event missed while the socket was down is not replayed, so tabs stay stale until the next event or action. `connected` is returned, so the caller may handle it. I did not check `app.tsx` for that. This is a possible follow-up.
  - The module-scope WeakMaps are the real identity hazard. `undoManagers` is written by the editor and read by `replaceMarkdown` and `mergeMarkdown`. If the functions were split into a new file and `undoManagers` were duplicated (two declarations rather than one import), the `?.clear()` / `?.stopCapturing()` calls would silently no-op. The same applies to `rawFormatters`, `linkPopups` and `imagePopups`. Also keep the editor's ProseMirror plugin keys and schema as single instances.
  - Writes in `applyEdited` run through `applying` (a promise chain). A disk sync running during a turn's merge is a rare, unexercised interaction.
- **Impact:** Medium for a mis-wired move (silent no-ops, a second socket, double handling). Low as-is.
- Unverified: could not run the UI, because this is static reading. I did not confirm the `undoManagers` read and write sites by line number in this pass.

### Prior-analysis status (C1–C6 of the 2026-10-01 artifact)
The artifact's text also embeds findings from other runs, so I verified against code, not text.
- **json-file write queue (singleton):** No longer holds. The queue moved into `local-file-system.ts` and is now the `pending` Map (C1 here).
- **Note read-modify-write in tools.ts:** Still holds, and it extends to the post path (C2).
- **TurnTexts per-turn:** Still holds. It is closure-scoped (C2).
- **EventBus, no isolation:** Still holds (C7). The `documents-changed` event is gone, so the "third event type" claim is stale.
- **Watcher never closed:** Reduced. The workspace watcher is now per-store with a refcount (C4, C5).
- **Disk-sync queue and `undoManagers`:** Still hold (C8).
- **Unsequenced server document writes:** I did not re-verify. The server routes were outside the areas you listed.

### Concurrency Summary
- **Focus area analyzed:** the areas you listed, plus a grep for module-scope Map, Set and WeakMap declarations across `src` (non-test).
- **Concurrency model:** a single-threaded event loop with promise-chain per-key queues, debounced timers, an `fs.watch` plus polling snapshot, a per-call loopback HTTP server, React refs for UI coordination, and one WebSocket.
- **Key concerns:**
  1. The module-level `pending` and `temps` in `local-file-system.ts` (C1) are the one place where a two-instance import would silently corrupt writes.
  2. Parallel Edit calls on one document lose updates (C2). This is a follow-up.
  3. The UI single-instance and module-scope WeakMap coupling (C8).
- **Well-handled areas:**
  - The write queue's failure isolation, with a tail that swallows errors.
  - Move and delete waiting on queued writes under their paths.
  - Atomic swap-in writes.
  - The watcher's serialized settles, with a debounce and a cap.
  - The post store's per-id queue, with `claimFolder` and tombstones.
  - Subscription handling that is safe against unsubscribing during a signal.
  - The turn guard with no await between check and set.
  - The UI sync coalescing and the view-write latch.
- **Skipped dimensions:** None skipped. Deadlock is not applicable as such, because there are no locks. The only blocking structure is the promise chains, and none waits on a later link in its own chain. I found no circular await.

---

## Risk Assessment

> Verbatim output from `risk-analyst`. `R#` items, ordered highest risk first, each cross-referencing the `S`/`B`/`C`
> findings it scores.

RISK ASSESSMENT for the 3pitor pure restructure. No files were modified.

Method: I read S1–S12, B1–B12 and C1–C8 verbatim. I spot-checked importers with grep, and used `git log --since=90.days` for churn. The repo has 57 test files, 19 of them under src/ui.

Scoring: each R# gives (a) risk as the code stands and (b) hazard to the planned moves. Overall risk is rated for the restructure, since that is the planned activity. "As-is" is noted where it differs.

Upstream claims I checked and the result:
- S1 confirmed. The only production importer of `shared/entry-name` is `posts/file/file-post-store.ts:6`. One correction: `posts/boundary.test.ts:125` also holds the string `'../../shared/entry-name'`. It is a sample line fed to `packageImportHits`, not a real import. It still has to be kept in step with any rule change, but it will not break on a file move.
- S2 confirmed. The importers are `documents.tsx:10`, `raw-view.tsx:8`, `markdown-editor.test.tsx:10` and `shortcut.test.ts`.
- S3 confirmed. `post-panel.tsx:9` and `post-table.tsx:6` import post-dialogs, plus its own test.
- S4 confirmed. Each of post-table, model-picker and panel-resizer has a single production importer.
- S5 confirmed. `engine.test.ts:5-6` and `model-config.test.ts:6` import test-model and stub-tool-server from outside chat. `claude-cli.test.ts` also imports stub-tool-server from inside chat, which S5 covers under "the chat tests above".
- S6 confirmed. The server and posts tests deep-import the engine in the places S6 lists:
  - `mcp-endpoint.test.ts:8-14`
  - `view-state.routes.test.ts:6`
  - `posts/bun-free.test.ts:7`
- S9 is slightly overstated. It says the `documents.test.tsx` `mock.module('../markdown-editor/markdown-editor')` calls fail silently if the path goes stale. They are preceded by `await import('../markdown-editor/markdown-editor')` at lines 452 and 1439, so a stale path is loud. That is a Low-risk item, not a silent trap.
- S9 also says the engine `mock.module` calls are path-tied. The only other `mock.module` calls are in `test-model.ts` and `sessions.test.ts`. They mock npm package names (`@ai-sdk/*`), not relative paths, so moving files does not break them. Bun's `mock.module` is process-wide, so it only matters if test files are regrouped into different `bun test` invocations.
- The C section header places `markdown-editor.tsx` at `src/ui/markdown-editor/`. The real path is `src/ui/documents/markdown-editor/`. The `undoManagers` WeakMap sits at line 86 of `src/ui/documents/markdown-editor/markdown-editor.tsx`. I confirmed there is a single declaration, with 4 use sites in that file.
- The S-section statement that "hot files ... are not moving" holds. Churn in the last 90 days is highest in `markdown-editor.test.tsx` (55 commits), `markdown-editor.tsx` (51), `documents.tsx` (41), `app.tsx` (39) and `documents.test.tsx` (38). Only the D-5 moves in S4 touch the documents area. This raises the merge-conflict likelihood for any parallel feature work in `ui/documents`.

---

**R1: A moved test or folder silently leaves the test roots, or leaves the boundary tests scanning nothing (suite stays green while protection disappears)**
- **Addresses:** B1, B2, B4 (the `REPO` depth rows), S9 (Makefile roots), parts of B3
- **Likelihood:** As-is: Unlikely, because nothing is moving today. For the planned moves: Possible to Likely.
  - Makefile line 46 lists 7 roots and line 49 lists `src/ui`. `bun test` treats them as path filters.
  - The target layout (package → feature → component) may add or rename top-level folders, which is the case B1 flags.
  - `posts/boundary.test.ts` and `file-system/boundary.test.ts` hard-code `src/engine/`, `src/cli/`, `src/server/`, `../posts/` regexes and a two-level `REPO` depth.
  - Per B2, four of their tests have no non-empty assertion. They would pass on an empty scan.
  - I confirmed the roots and filters in the Makefile.
- **Severity:** Medium. No runtime breakage results. The harm is that architectural guardrails stop working with no signal. The restructure is meant to preserve exactly those guardrails.
- **Blast radius:** Multi-module. The scans cover all of `src`: 8 packages and 57 test files.
- **Reversibility:** Moderate. The fix is easy once found, but detection is the problem. There is no failing test, so mean time to detection is long.
- **Overall risk:** High for the move (silent failure mode, repo-wide reach). Medium as-is.
- **What happens if deferred:** Say an owner moves a UI test under a server root, or renames `src/engine`. `make test` stays green. Weeks later a server file imports engine internals, or a production file uses `fs` directly, and no boundary test fires. The owner believes the layout is enforced when it is not.

**R2: Cross-package test deep-imports of engine helpers (the "moving engine helpers breaks server and posts tests" cluster)**
- **Addresses:** S6, S5, B3, B9, S9 (fake-claude pair)
- **Likelihood:** For the move: Near certain, if any of these is moved:
  - `chat-test-helpers.ts`
  - `fake-claude-on-path.ts`
  - `json-file.ts`
  - `bun-only-code.ts`
  - `tools.ts`
  - `claude-cli.ts`

  I confirmed 6 deep imports from `src/server` and `src/posts` (see S6 above). As-is: no problem occurs.
- **Severity:** Medium. Every failure is loud (tsc import errors, existence tests, `ENOENT` in `beforeAll`). Fixing it costs time but does not corrupt anything.
  - The `fake-claude.ts` pair is the awkward part. `fake-claude-on-path.ts:18` copies `fake-claude.ts` from a sibling path.
  - `node-check.ts:27` names the same file in a plain string, which tsc does not check. `make check-node` catches it.
  - B9 adds a trap: `fake-claude.ts` is copied to a temp dir, so adding any relative import to it fails at runtime, with a confusing error from inside the spawned process.
- **Blast radius:** Multi-module. 3 packages are involved (engine, server, posts), plus the Makefile and the 4 named-path lists.
- **Reversibility:** Easy to Moderate. The failures are loud, so fixing them is mechanical.
- **Overall risk:** Medium.
- **What happens if deferred:** If the owner moves the engine test helpers (S5) without also updating the importers, `bun test` fails in `src/server` and `src/posts`. If that change was staged alone it is caught immediately and the cost is a retry. The real residual cost is that no boundary test polices server → engine imports, so the deep-import pattern persists and is likely to spread.
- S6 is the one upstream finding I would keep as the plan-gating item, but its stated impact ("high for a move plan") is slightly strong. It is loud and mechanical, so I score it Medium.

**R3: Shared-instance module state could be duplicated or split by a move (local-file-system `pending`/`temps`, markdown-editor WeakMaps)**
- **Addresses:** C1, C8 (WeakMap part), C4/C7 (one-instance wiring), B10, B12
- **Likelihood:** For a pure file move: Unlikely.
  - Bun dedupes modules by resolved path.
  - Duplication would need a copy-paste of the declaration, a barrel plus a direct import that bundles twice, or a second `createFilePostStore`/`Sessions`/`EventBus`.
  - `undoManagers` has one declaration (line 86) and its use sites are in the same file.
  - Splitting `markdown-editor.tsx` is the only plausible trigger. It is the highest-churn source file (51 commits in 90 days), so splitting it is tempting.
- **Severity:** High if it happens.
  - Writes to one file can interleave, and a delete or move can be overtaken by a queued save, which resurrects the file (C1).
  - Both outcomes are silent.
  - The editor WeakMaps would silently no-op, giving broken undo/clear.
- **Blast radius:** C1: multi-module. Every document, note and session write goes through `local-file-system.ts`. C8: single module.
- **Reversibility:** C1 is Difficult. Corrupted or resurrected files are not undone by a revert, and detection is hard. The WeakMap case is Easy.
- **Overall risk:** Medium. Severity is high but likelihood is low, and the pure restructure does not need to alter these files.
- **What happens if deferred:** Nothing happens as-is. The hazard only materialises if someone splits `local-file-system.ts` or `markdown-editor.tsx` during the restructure.

**R4: UI bundle integrity (index.html, CSS import paths and order) is unverified by any check**
- **Addresses:** B6, B7, S9 (index.html, CSS order), B8 (build path)
- **Likelihood:** For the move: Possible.
  - Any move of `app.tsx`, `styles.css` or a component's CSS can break the page.
  - `ui/css.d.ts` declares `*.css`, so tsc cannot see a bad CSS path.
  - happy-dom tests ignore CSS.
  - `make check-build` fetches only `/api/workspace-config`, not `/`.
  - Moving ordinary component folders keeps CSS co-located with its `.tsx`, which lowers likelihood. The D-5 flattening (S4: post-table and model-picker) is where the CSS and import order moves.
- **Severity:** High if it occurs, because it is user-facing. The app renders unstyled or blank. The cascade-order restyle is silent. A missing CSS import is a hard bundle failure in dev but is not caught in CI.
- **Blast radius:** Multi-module. 16 CSS files across `ui`, and the whole UI bundle.
- **Reversibility:** Easy. It is fixable by restoring paths or import order, but detection depends on someone loading the page.
- **Overall risk:** Medium. B7's evidence reduces it: no selector is repeated across CSS files, so reordering does not change the cascade today. Only the ProseMirror library CSS must stay before `markdown-editor.css`.
- **What happens if deferred:** A flatten move changes an import path in `documents.tsx` or `agent-panel.tsx`. Tests pass. The release build ships. The first person to open the page sees unstyled post tables or a broken model picker.

**R5: Path-in-string and tooling references (Makefile, package.json, node-check, `FS_EXEMPT`-style lists, Node resolver)**
- **Addresses:** S7, S8, S9 (named-path lists), B3, B4, B5, B8, B11
- **Likelihood:** For the move: Likely, if any of these move:
  - `cli.ts`
  - `node-check.ts`
  - `server/scripts/check.ts`
  - `app-files/`
  - `skills/`
  - `fixtures/`

  As-is: no problem.
- **Severity:** Low to Medium. The failures are mostly loud:
  - Existence tests cover stale exempt entries.
  - `paths.test.ts` covers `SRC`, `fixtures` and `skills`.
  - `make build` and the release workflow cover `cli.ts`.
  - A move that changes subfolder keys under `skills` is unchecked, and those keys feed the `3pitor://skills/...` URLs.
  - `bun run check` (the `package.json` script) is not in `make test`, so a stale path there is not caught by CI.
  - A barrel `index.ts` or a `.tsx` import in the engine fails `make check-node`, because `node-ts.mjs` only retries specifiers with `.ts`.
- **Blast radius:** Single module to multi-module.
- **Reversibility:** Easy.
- **Overall risk:** Medium to Low. S7 and S8 have no importers, so they are Low if left in place. Leave them where they are.
- **What happens if deferred:** Nothing as-is. If `node-check.ts` or `check.ts` moves without its Makefile, `package.json` or exempt-list entries, `make test` or `bun run check` fails with a clear message.

**R6: Scope misplacements S1–S4 (entry-name, shortcut, post-dialogs, D-5 cases) and README drift S12**
- **Addresses:** S1, S2, S3, S4, S12, S10
- **Likelihood:** As-is, Possible. These are placement and documentation issues, so they cause friction rather than failures.
  - README drift is already causing issues. The README describes `post-list/post-list.tsx`, which does not exist, and omits post-table, post-panel, post-dialogs and others.
  - Churn in `ui/documents` is high, so contributors will keep consulting the README.
- **Severity:** Low to Medium. Developer confusion and wrong placement of new files. There is no runtime effect.
- **Blast radius:** Single module for each (1–3 importers each, confirmed above).
- **Reversibility:** Easy. These are relative-import edits that tsc catches. They are the safest moves in the plan.
- **Overall risk:** Low to Medium. S12 is Medium because the README is the stated source of truth for the layout rules.
- **What happens if deferred:** Future contributors place new files by the README's wrong layout. `shortcut.ts` and `entry-name.ts` stay in over-wide scopes. Nothing breaks.
- S4 needs an owner decision (D-5), not a risk judgement. S10 (the type-only cycle between `posts.ts` and `file-post-store.ts`) is Low and stays valid after any move.

**R7: Pre-existing concurrency and error-handling defects unrelated to the move**
- **Addresses:** C2, C5, C6, C7, C3, B5 (`.md`-only embed), B10 (`glob.ts` swallowing errors), S11 (type duplication between `wire.ts` and `posts.ts`)
- **Likelihood:** As-is: C2 is unconfirmed (the analyst could not verify tool scheduling). The other items are Possible. The move does not touch any of them.
- **Severity:** Medium.
  - C2 is a lost edit within a turn.
  - C5 permanently stops live sync after one transient `readdir` error.
  - C6 leaks a loopback server if some path skips `stop()`.
- **Blast radius:** Single module each. C5 reaches the whole workspace sync.
- **Reversibility:** Moderate.
- **Overall risk:** Medium as-is. For the restructure, the move hazard is Low, because all of this state is closure-scoped (C2, C4, C5, C6, C7). The one exception is the R3 items.
- **What happens if deferred:** Nothing new. These follow-ups already exist and carry the same risk after the move as before.
- Unverified: could not run a model turn, so C2 (parallel Edit tool calls) is unconfirmed. This disclosure also appears in the upstream C2.

---

### Risk Summary
- **Findings assessed:** 32 (S1–S12, B1–B12, C1–C8), grouped into 7 risk items.
- **Critical risks:** 0.
- **High risks:** 1.
  - R1: silent test-root and boundary-test loss during a layout change.
- **Medium risks:** 6.
  - R2: engine test-helper deep imports.
  - R3: shared-instance module state.
  - R4: UI bundle integrity.
  - R5: path-in-string and tooling references.
  - R6: scope misplacements and README drift.
  - R7: pre-existing concurrency and error handling, unrelated to the move.
- **Hazard ranking for the planned moves, loud vs silent:**
  - Silent: R1 (test roots, vacuous boundary scans) and R4 (HTML/CSS path and order, `bun run check`, release-only build).
  - Loud: R2, R5 and R6, whose failures show up in tsc or `make test`.
  - R3 is silent but unlikely.
- **Low or no risk (do not spend effort here):**
  - S7 (`check.ts`), S8 (`node-check.ts`): leave in place.
  - S10 (posts cycle): type-only.
  - S11: the test-glue duplication is Low. The `wire.ts` ↔ `posts.ts` type duplication is a drift risk (Medium on a future post-shape change), unrelated to the move.
  - B10 (`instanceof PostError`): holds as long as the class has a single copy.
  - B11 (fixture/`.data`): loud, except the chat path label.
  - B12 (cli wiring): `tsc` catches any import rename.
  - C3, C4: benign. Do not construct two stores.
  - S9's `mock.module` claim is loud, not silent (see above).

Unverified: could not run `make test`, `make build` or the bundler, so loud/silent labels for moves rest on reading the code and grep, as in the upstream analyses.

---

## Software-Architecture Recommendations

> Verbatim output from `software-architect`. `A#` recommendations ordered by impact, each cross-referencing upstream
> findings, naming the SOLID / cohesion / coupling concern, and carrying a YAGNI-evidence line. Each is labeled as a
> pure move or a deferred behavior change.

## Software-architecture recommendations: 3pitor `src/` pure restructure (2026-10-19)

I read S1–S12, B1–B12, C1–C8 and R1–R7 in `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/update-code-structure-2026-10-19/artifacts/architectural-analysis.md`, the earlier decision log `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/update-code-structure-2026-10-01/artifacts/change-decision-log.md` (D-5, D-6, D-7, D-8, D-10, D-11), README "How `src/` is laid out", the Makefile and package.json. I spot-checked with grep:
- every importer of each file that moves
- each moving file's own imports
- every exempt list
- CSS import order
- the `mock.module` strings
- co-change in git

I modified no files.

### Preconditions for every unit (from R1, R3, R4, R5, B9)
- **P1 (R1, B1, B2):** add, rename or remove no top-level folder under `src/`. Every move below stays inside an existing package, so the Makefile `test-server` / `test-ui` roots and the boundary tests' `src/<pkg>/` prefixes and `REPO` depth stay valid.
- **P2 (R4, B7):** do not reorder any import line. Change specifiers only. Above all, keep the ProseMirror CSS imports ahead of `./markdown-editor.css`.
- **P3 (R3, C1, C8):** do not touch `file-system/local/local-file-system/local-file-system.ts` or the inside of `ui/documents/markdown-editor/markdown-editor.tsx`. No barrel `index.ts` anywhere (B8: `node-ts.mjs` cannot resolve one).
- **P4 (B9, S9):** `engine/chat/components/fake-claude.ts` and `fake-claude-on-path.ts` stay where they are, side by side. No import is added to `fake-claude.ts`, and the string at `node-check.ts:27` stays valid.
- **P5:** use `git mv`, so files that are moved but not edited show as 100% renames.

### Checks every unit runs (each with an exact expected result)
- **V-tests:** run `make test` before and after the unit. It must stay green, and the `Ran N tests across M files` lines from `test-server` and `test-ui` must show the same N and M before and after. This is the guard for R1, the silent dropping of a test.
- **V-renames:** `git diff -M --cached --name-status` shows only `R100` for files that were not edited, and `R0xx` plus the listed line edits for files that were.
- **V-stale:** a `git grep` for the old path, run over `src README.md package.json Makefile`, returns nothing, apart from any hit the unit lists as expected.
- **V-empty:** `ls` on each folder the unit emptied reports "No such file".
- **V-css (UI units only, R4):** run `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/update-code-structure-2026-10-01/artifacts/css_snapshot.sh` before and after (D-10). `rules.css` must be identical. `order.txt` must be identical once the moved paths are rewritten with `sed`.

---

**A1: Move the Documents feature's misplaced files: shortcut down, post-dialogs into `documents/components/`, post-table flat into `documents/`** (pure move)
- **Addresses:** S2, S3, S4 (post-table), S12 (partly), R6, R4
- **Principle:** High cohesion, and the lowest scope that covers every user. Under D-5, a component's single-user helpers sit inside it.
- **Current state:**
  - `ui/components/shortcut.ts` is only used inside documents: `documents.tsx:10`, `raw-view.tsx:8` and `markdown-editor.test.tsx:10`.
  - `ui/documents/post-dialogs/` is shared by two siblings, `post-panel.tsx:9` and `post-table.tsx:6`, but sits as a component of its own.
  - `ui/documents/post-table/` has one importer, `documents.tsx:12`.
- **Decision on S2:** move to `ui/documents/components/shortcut.ts`. It has no CSS, so it sits flat, by the D-6 rule (`api.ts` and `api.test.ts` are flat).
- **Decision on S3:** move to `ui/documents/components/post-dialogs/`. It has its own CSS, so it gets a folder (D-6).
- **Decision on S4 for post-table:** flatten it into `ui/documents/documents/`. Reasoning follows.
  - The owner's rule, and the README's line 54 "a component is one module, plus the helpers only it imports, plus its tests and CSS", defines a component folder by who imports it, not by whether the file is a React component or has CSS.
  - Having its own CSS and test does not earn a folder in this tree. `image-popup.tsx`, `review-strip.tsx` and `link-popup.tsx` each have their own CSS and/or test, and all sit flat in `markdown-editor/` (D-5).
  - The "one folder per component" reading counts the feature's top-level components, and post-table is a helper of the `documents` component.
  - Churn is minimal. `documents/post-table/` and `documents/documents/` are at the same depth, so post-table's own imports of `shared/wire`, `components/menu` and `notice-icons` do not change.
  - post-table co-changed with `documents/` in 2 of its 6 commits.
- **Exact moves:**
  - `src/ui/components/shortcut.ts` → `src/ui/documents/components/shortcut.ts`
  - `src/ui/components/shortcut.test.ts` → `src/ui/documents/components/shortcut.test.ts` (its `'./shortcut'` import is unchanged)
  - `src/ui/documents/post-dialogs/post-dialogs.{tsx,css,test.tsx}` → `src/ui/documents/components/post-dialogs/post-dialogs.{tsx,css,test.tsx}`
  - `src/ui/documents/post-table/post-table.{tsx,css,test.tsx}` → `src/ui/documents/documents/post-table.{tsx,css,test.tsx}`
- **Specifier edits:**
  - `documents/documents/documents.tsx:10`: `'../../components/shortcut'` → `'../components/shortcut'`
  - `documents/documents/documents.tsx:12`: `'../post-table/post-table'` → `'./post-table'`
  - `documents/markdown-editor/raw-view.tsx:8`: → `'../components/shortcut'`
  - `documents/markdown-editor/markdown-editor.test.tsx:10`: → `'../components/shortcut'`
  - `documents/post-panel/post-panel.tsx:9`: → `'../components/post-dialogs/post-dialogs'`
  - `post-table.tsx:6` (moved): → `'../components/post-dialogs/post-dialogs'`
  - `post-dialogs.tsx` (moved): `'../../../shared/wire'` → `'../../../../shared/wire'`, and `'../../components/notice-icons'` → `'../../../components/notice-icons'`
  - `post-dialogs.test.tsx` (moved): `'../../../shared/wire'` → `'../../../../shared/wire'`
  - README `### src/ui/`: replace the stale `post-list/post-list.tsx` bullet (S12) with lines for `documents/post-table.tsx`, `post-panel/` and `components/post-dialogs/`, and add `components/shortcut.ts`.
  - No exempt list, Makefile or package.json entry names these files. The only `mock.module` strings in documents name `markdown-editor`, which does not move.
- **Safety:** P1–P5.
  - CSS order is unchanged, because the import graph is unchanged: `documents.tsx` still imports post-table on line 12, before `./documents.css` on line 13, and app.tsx still reaches documents before post-panel.
  - Do all three moves in one unit. Doing post-table first makes it import a post-dialogs that is still scoped wrong, and the D-7 reasoning says not to ship in-between states.
- **Verify:**
  - V-tests, V-renames (shortcut.test, post-dialogs.css, post-table.css and post-table.test at 100%) and V-css.
  - V-stale: `git grep -nE "components/shortcut'|post-dialogs/post-dialogs'|post-table/post-table'|post-list" -- src README.md` matches only the new specifiers `'../components/shortcut'` and `'../components/post-dialogs/post-dialogs'`.
  - V-empty: `src/ui/documents/post-dialogs` and `src/ui/documents/post-table` are gone.
  - Optional: `cross_feature.py` from the 2026-10-01 artifacts exits 0.
- **YAGNI evidence:** S2, S3 and S4 are measured scope violations of the owner's stated rule, with 2–3 importers confirmed by grep. No new abstraction is added.
- **Simpler version considered:** a `documents/post-table/` folder kept as a "component". It is cheaper by one import edit, but it contradicts D-5 and the README's own definition of a component.
- **Risk if deferred:** R6 (wrong placement copied by new files, README drift), in the highest-churn area (documents.tsx: 41 commits in 90 days).

**A2: Move `bun-only-code.ts` to `src/shared/`** (pure move)
- **Addresses:** S6 (posts → engine), S11 (partly), R2, B3
- **Principle:** Dependency direction. The engine depends on posts, so `posts/bun-free.test.ts:7` importing `../engine/components/bun-only-code` points the dependency the wrong way, and it breaks the posts rule "imports only file-system and shared". It gets past `posts/boundary.test.ts` only because test files are exempt.
- **Verified:** the file has no imports. It is pure regex plus `bunHits`, so it meets "src/shared/ imports no package". It is used only by the engine and posts scans, and src/shared/ is the lowest scope covering two packages. It does not trip `fsHits`, because its content is unchanged and it passes today. No shared-package scan exists that it could break.
- **Exact move:** `src/engine/components/bun-only-code.ts` → `src/shared/bun-only-code.ts`
- **Edits:**
  - `src/engine/bun-free.test.ts:7` → `'../shared/bun-only-code'`. Delete EXEMPT line 18 (`'components/bun-only-code.ts'`). This deletion is required: the existence test fails loudly on a stale entry, and the file is no longer under the engine scan.
  - `src/posts/bun-free.test.ts:7` → `'../shared/bun-only-code'`.
  - README lines 110–112 lose the bun-only-code clause. The `### src/shared/` section gains "`bun-only-code.ts`: test-only, the Bun-only definition the engine's and the posts package's scans share". Its intro sentence ("code the server, the UI, and the check script share") is widened to name test-only shared code. `ui/components/fake-posts-api.ts` is the precedent for a test-only module in a shared scope.
- **Safety:** P1. No production file imports it, so node-check and the bundle are unaffected.
- **Verify:**
  - V-tests: both bun-free tests and both "every exemption names a file that exists" tests pass.
  - `grep -c "import" src/shared/bun-only-code.ts` prints `0`.
  - V-stale: `git grep -n "engine/components/bun-only-code\|components/bun-only-code.ts" -- src README.md` is empty.
- **YAGNI evidence:** it removes the one cross-package test import that breaks a stated package rule (S6). The two current users are both real.
- **Simpler version considered:** keep it and have the README allow posts tests to import the engine. That makes the rule fit the violation, and it keeps posts' tests depending on a higher layer. A copy in each package was rejected by the D-6 precedent (one placement for shared code).
- **Risk if deferred:** R2. Any later move of the engine's `components/` breaks the posts tests (loudly), and the wrong direction stays.

**A3: Move `test-model.ts` and `stub-tool-server.ts` up to `engine/components/`** (pure move)
- **Addresses:** S5, R2, B3
- **Principle:** Lowest covering scope. Both are used at the engine root (`engine.test.ts:5-6`), and stub-tool-server is also used by another feature (`model-config/model-config.test.ts:6`).
- **Exact moves:**
  - `src/engine/chat/components/test-model.ts` → `src/engine/components/test-model.ts` (imports npm only, no edit)
  - `src/engine/chat/components/stub-tool-server.ts` → `src/engine/components/stub-tool-server.ts`. Edit line 3: `import type { ServeTools } from '../claude-cli/claude-cli'` → `'../chat/claude-cli/claude-cli'`. This is a type-only edge from components into a feature, and it is test-only; I accept it rather than import `../engine`.
- **Importer edits:**
  - `chat/agent/agent.test.ts:9,11`
  - `chat/providers/ollama.test.ts:3`
  - `chat/providers/providers.test.ts:7,8`
  - `chat/sessions/sessions.test.ts:13,14`
  - `chat/claude-cli/claude-cli.test.ts:10`

  All of these become `'../../components/<name>'`. Then:
  - `engine.test.ts:5,6` → `'./components/<name>'`
  - `model-config/model-config.test.ts:6` → `'../components/stub-tool-server'`
- **Named-path edits:**
  - `src/engine/bun-free.test.ts` EXEMPT lines 16–17 → `'components/test-model.ts'` and `'components/stub-tool-server.ts'`. Neither file is in FS_EXEMPT, and neither needs to be.
  - README lines 110–111 ("five test helpers in `chat/components/`") become three in `chat/components/` plus two in `components/`. Lines 144–151 split to match.
- **Safety:** P1 and P4. The fake-claude pair and chat-test-helpers stay. The `mock.module` calls in test-model name npm packages only, and they are process-wide, so a move does not affect them (R2 note).
- **Verify:**
  - V-tests: the bun-free EXEMPT existence test fails loudly if line 16 or 17 is missed.
  - V-renames: test-model at R100.
  - V-stale: `git grep -n "chat/components/test-model\|chat/components/stub-tool-server" -- src README.md` is empty.
- **YAGNI evidence:** S5 lists 2 and 3 importers outside `chat/` today.
- **Simpler version considered:** leave them in `chat/components/`. It breaks the stated scope rule for `engine.test.ts` and `model-config.test.ts`.
- **Risk if deferred:** low (R6-class friction). A new engine test copies the cross-feature reach.

**A4: Flatten model-picker into `chat/agent-panel/`** (pure move)
- **Addresses:** S4 (model-picker), S12, R6, R4
- **Decision:** flatten. My reasoning is the same as for post-table in A1.
  - It has one importer, `agent-panel.tsx:3`.
  - CSS plus a test does not earn a folder here: image-popup and review-strip are the precedent.
  - The README's own definition of a component puts single-user helpers inside the component.
  - Weighed against it: the README documents `model-picker/` as a folder, and model-picker has more churn of its own (10 commits, 0 co-changed with agent-panel). That churn points to an independent piece, which is the strongest argument for a folder. But the owner's rule decides placement by who imports it, not by co-change, and the README line is drift that has to be rewritten anyway.
  - The move costs 3 renames and 1 specifier edit, because both folders are at the same depth and model-picker's own imports do not change.
  - Trigger to give it a folder later: a second importer, as D-5 has for link-popup.
- **Exact move:** `src/ui/chat/model-picker/model-picker.{tsx,css,test.tsx}` → `src/ui/chat/agent-panel/model-picker.{tsx,css,test.tsx}`
- **Edits:** `src/ui/chat/agent-panel/agent-panel.tsx:3`: `'../model-picker/model-picker'` → `'./model-picker'`. README line 294 becomes `agent-panel/model-picker.tsx`.
- **Safety:** P2. Import line 3 stays ahead of `./agent-panel.css` on line 4, so the bundle order is the same.
- **Verify:**
  - V-tests and V-renames (all 3 at R100).
  - V-css: `order.txt` differs only by `chat/model-picker/` → `chat/agent-panel/`.
  - V-stale: `git grep -n "model-picker/model-picker" -- src README.md` is empty.
  - V-empty: `src/ui/chat/model-picker` is gone.
- **YAGNI evidence:** a measured scope violation under the owner's rule, with one importer confirmed.
- **Simpler version considered:** leave it as a folder. That is consistent with the README, inconsistent with D-5 and the editor's helpers, and it leaves two readings of "component" live in one package. It can be done in the same unit as A1, or as its own unit.
- **Risk if deferred:** R6 only.

**A5: Move `entry-name.ts` into `posts/file/`** (pure move)
- **Addresses:** S1, R6, S12
- **Principle:** High cohesion and the lowest covering scope. The only production user is `posts/file/file-post-store.ts:6`, and the README says so.
- **Decision on S1:** move to `posts/file/`, not `posts/components/`. There is one store today, so `components/` would be YAGNI (one user). Trigger to move it up: a second store.
- **Exact moves:** `src/shared/entry-name.ts` → `src/posts/file/entry-name.ts`, and `src/shared/entry-name.test.ts` → `src/posts/file/entry-name.test.ts` (its import `'./entry-name'` does not change).
- **Edits:**
  - `file-post-store.ts:6` → `'./entry-name'`.
  - Its header comment at line 2 drops "shared/entry-name.ts".
  - README: delete the shared section line (317) and add it under `### src/posts/`.
  - Keep the "posts may import shared" allowance in the README and in `packageImportHits`. Removing it would be a rule change.
  - Leave the planted sample at `posts/boundary.test.ts:125` as it is. It is a string fed to the checker that shows the allowed import shape, not an import.
- **Safety:** `entry-name.ts` has no imports and no Bun code, so `posts/bun-free.test.ts`, which will now scan it, passes. P1 holds, and both files stay under the `src/posts` test root.
- **Verify:**
  - V-tests and V-renames (the test file at R100).
  - V-stale: `git grep -n "shared/entry-name" -- src README.md` matches only `src/posts/boundary.test.ts:125` (expected).
- **YAGNI evidence:** S1 and R6 confirm a single importer.
- **Simpler version considered:** n/a. This is already the simplest placement.
- **Risk if deferred:** low.

**A6: Name the engine's test-facing surface in the README, and move none of it** (pure move, documentation only)
- **Addresses:** S6 (server tests), R2, B3
- **Current state:** `server/chat/mcp-endpoint/mcp-endpoint.test.ts:8-14` imports these engine internals:
  - `engine/chat/claude-cli/claude-cli` (`claudeCliModel`)
  - `chat/components/chat-test-helpers`
  - `chat/components/fake-claude-on-path`
  - `components/json-file` (`stateKey`)
  - `chat/tools/tools` (`editedTexts`, `fileTools`, `turnTexts`)

  `server/view-state/view-state.routes.test.ts:6` imports `stateKey`. The target rule allows "the entry module plus modules the README names as public surface". The README already names chat-test-helpers and the fake-claude pair as shared with server tests; the rest are named nowhere.
- **Decision:** add one README paragraph under `### src/engine/` naming the modules server tests may import, and only tests: `chat/components/chat-test-helpers.ts`, `chat/components/fake-claude-on-path.ts`, `components/json-file.ts`, `chat/claude-cli/claude-cli.ts` and `chat/tools/tools.ts`. Move none of these files: P4, and R2 says moving them alone breaks the server tests.
- **Rejected: re-export from `engine.ts`.**
  - For the test helpers, it would pull `bun:test` (fake-claude-on-path line 3) into engine production. That fails `bun-free.test.ts` and `make check-node`.
  - For `claudeCliModel`, `fileTools` and `stateKey`, it would widen the production API to the server package for test-only use. That is an interface-segregation regression, and YAGNI.
- **Verify:** `git grep -n "../../engine/\|../../../engine/" -- 'src/server/*.test.ts' 'src/server/**/*.test.ts'`. Every module it lists must be either `engine/engine` or one of the five named in the README.
- **YAGNI evidence:** it makes six existing imports conform to the stated rule without new code.
- **Simpler version considered:** n/a. A documentation change is the floor.
- **Risk if deferred:** the deep-import pattern spreads without being named (R2's residual). A11 is the guard follow-up.

**A7: Move the end-to-end check to the server package root (`server/scripts/check.ts` → `server/check.ts`)** (pure move, low impact)
- **Addresses:** S7, R5, B4, B8
- **Decision on S7:** move it. `scripts/` names a kind of file, not a capability, so it breaks "then feature". The tree's own precedent for package-wide checks puts them at the package root: `engine/node-check.ts`, `engine/bun-free.test.ts`, `posts/boundary.test.ts`. The check drives the server's HTTP, SSE and WebSocket API (file header), so it stays in server.
  - I considered `cli/check.ts`. It would shrink the README's app-files rule to "only cli", but the check imports nothing from cli and exercises the server's surface.
  - R5's "leave it" rests only on move cost. The cost is 1 package.json line, 1 FS_EXEMPT line, 2 README lines and 5 specifier depths.
- **Exact move:** `src/server/scripts/check.ts` → `src/server/check.ts`
- **Edits:**
  - `check.ts` lines 4–8: `'../../shared/…'`, `'../../app-files/app-files'` and `'../../file-system/file-system'` all become `'../…'`. `join(SRC, 'cli/cli.ts')` comes from `SRC`, so it does not change.
  - `package.json:7` → `"check": "bun run src/server/check.ts"`.
  - `src/file-system/boundary.test.ts:25` FS_EXEMPT → `'src/server/check.ts'`.
  - README line 47 (`server/scripts/check.ts` → `server/check.ts`) and line 98 (the `scripts/` bullet becomes a `check.ts` bullet).
- **Safety (R5, B4):** `bun run check` is not in `make test`, so a stale package.json path would go unnoticed. Add an explicit check: `test -f "$(sed -n 's/.*"check": "bun run \([^"]*\)".*/\1/p' package.json)" && echo ok` prints `ok`. `tsc` covers the imports, and the FS_EXEMPT existence test covers line 25.
- **Verify:**
  - V-tests and the existence check above.
  - V-stale: `git grep -n "server/scripts\|scripts/check" -- src README.md package.json` is empty.
  - V-empty: `src/server/scripts` is gone.
- **YAGNI evidence:** this is the only feature-less folder left in a package (S7). It is a measured violation of the stated layout, not a hypothetical.
- **Simpler version considered:** leave it and record it as an exception. That is acceptable if the owner prefers zero churn on an untested path. I rank this last among the moves for that reason.
- **Risk if deferred:** low. The folder keeps a second kind of placement rule alive.

**A8: Rewrite the README layout inventory** (pure move, documentation only)
- **Addresses:** S12, R6
- **What changes:** following D-8, each unit edits the README lines for its own moved files. A final rewrite of the layout section then adds what is undocumented:
  - post-panel (wired by `app.tsx`, not `documents.tsx`)
  - confirm-dialog and notice-icons
  - `markdown-editor/` review-strip, image-popup, menu-icons and table-cells
  - `shared/document-key.ts`
- **Verify:** for every `.ts`/`.tsx` path under `src/ui`, `src/shared` and `src/engine/components`, its basename appears in README.md. A small loop with `grep -q`, listing the misses, must print nothing.
- **YAGNI evidence:** the README is the stated source of truth for the rules (S12), and it names a file that does not exist (`post-list`).

**A9: Leave these where they are (no move)** (pure move: explicit no-op decisions)
- **S4, panel-resizer: stays in `ui/components/panel-resizer/`.**
  - Its user is `app.tsx`, the package entry and the README's one wiring point, not a feature component. There is no component folder for D-5 to flatten it into.
  - Flattening it beside `app.tsx` would put a component's CSS and test at the package root, which today holds only the entry, page, base styles and setup.
  - It also sizes panels of two features (documents and chat), and D-6 already cited it as correctly placed.
- **S8, node-check.ts: stays at the engine root.** It is a package-wide check, like `bun-free.test.ts`. Moving it touches Makefile:43, FS_EXEMPT and the `chat/components/fake-claude.ts` string, for no rule gain.
- **S5 remainder: chat-test-helpers and the fake-claude pair stay in `chat/components/`.** On the engine side only chat uses them, and the server use is handled by A6.
- **S10 and the negative results:**
  - The engine's `chat/providers/` backends stay flat. They are providers.ts's helpers, under D-5.
  - `model-config/` stays a feature. Its link to `chat/providers` is type-only, and nothing points to friction.
  - The `posts.ts` ↔ `file-post-store.ts` type-only cycle is harmless.
- **Flat packages:** `src/shared/`, `src/app-files/` and `src/cli/` hold their files at the package root. Each is a single-capability package, and the README documents that. Not raised upstream; no change.

### Deferred behavior changes (follow-ups, not part of the restructure)
- **A10: make the boundary tests fail on an empty scan** (B2, B4, R1). Add `toContain` or a non-empty assertion to the four filtered scans in `posts/boundary.test.ts` and `file-system/boundary.test.ts`. Test-only, but it changes what the suite enforces. Not needed by A1–A7, because P1 keeps every package root in place.
- **A11: a boundary test for server and cli → engine imports** (S6, R2). It allows `engine/engine` plus the list from A6. Trigger: a second unnamed deep import shows up.
- **A12: `make check-build` also fetches `/` and one hashed CSS asset** (B6, R4). A6 + D-10's snapshot covers the restructure in the meantime.
- **A13: a type-equality test tying `shared/wire.ts` to the `posts.ts` post shapes** (S11). Trigger: the next post-shape change.
- **A14: concurrency and error-handling fixes:**
  - C2: lost update between parallel Edits
  - C5: the watcher dies for good on one `readdir` error
  - C6: `endpoint.stop()` on every exit path
  - C7: EventBus has no isolation between listeners
  - C8: no re-sync after a reconnect
  - B5: only `.md` skill files are embedded
  - B10 follow-up: `glob.ts` swallows `FileSystemError`

  All of this state is held in closures (C2, C4–C7), so the moves do not affect it.

---

### Software Architecture Recommendations Summary
- **Upstream findings addressed:**
  - Pure moves: S1, S2, S3, S4, S5, S6, S7, S12.
  - Explicit no-move decisions: S4 (panel-resizer), S8, S10.
  - Constraints and checks: S9, B1–B4, B6–B9, C1, C8, R1–R5.
  - Deferred: S11, B5, B6, B10, C2, C5–C8, R7.
  - Intentionally not addressed as low risk: B11 (fixtures are loud), B12 (tsc covers the cli wiring), C3 and C4 (benign; never build two stores), the S11 test-glue duplication (2 uses; a shared scanner helper would fail the Rule of Three).
- **Key themes:**
  1. A few files sit above or beside the lowest scope covering their users.
  2. One dependency points the wrong way (posts test → engine).
  3. Two readings of "component" coexist (folder per React piece vs. D-5 helpers). Settling on D-5 throughout removes the ambiguity.
- **Highest impact:** A1 (documents scope fixes, highest-churn area), A2 (dependency direction), A3 (engine test-helper scope).
- **Suggested units:**
  - UI unit: A1 + A4
  - Engine unit: A2 + A3
  - Posts unit: A5
  - Server unit: A7 (optional)
  - A6 and A8 are documentation and go with the units, plus a final README pass.
- **Deferred to `system-architect`:** none. 3pitor compiles to one binary with the UI bundled in (`make build`, `server.ts` imports `ui/index.html`). Everything here is inside one deployable. The `claude` child process and the per-call loopback MCP endpoint (C6) are an integration with an external program, but no recommendation changes that integration.
- **Deferred (YAGNI):**
  - `posts/components/entry-name.ts` (S1): only one store. Trigger: a second `PostStore`.
  - Folders for `markdown-editor/` popups, `agent-panel/model-picker`, `documents/post-table` (S4): a single importer each. Trigger: a second importer (the same trigger D-5 set).
  - `providers/components/` with one folder per backend (S structural negative result): the backends are providers.ts's helpers. Trigger: a backend used outside `providers.ts`.
  - Re-exporting test symbols from `engine.ts` (S6): no production need, and it would break bun-free. Trigger: a production server use of one of them.
  - A shared source-scanner helper for the boundary and bun-free tests (S11): 2 uses, not 3. Trigger: a third scan.

Unverified: I did not run `make test`, `css_snapshot.sh`, `tsc` or `bun run check`. The "no change" claims about CSS order and specifier depth rest on reading the import lines and grep. The V-checks in each recommendation are what confirm them when a unit runs.

---

## System-level concerns deferred

None. `software-architect` deferred no finding to system altitude. 3pitor compiles to one binary with the UI bundled
in, so nothing here crosses a deployable unit. The `claude` child process and the per-call loopback MCP endpoint (C6)
are an integration with an outside program, but no recommendation changes that integration.

To get recommendations at that altitude anyway, dispatch `system-architect` separately against this focus area, or
re-run `/architectural-analysis` at `large` size.

---

_End of report. Finding IDs (`S#`, `B#`, `C#`, `R#`, `A#`) are stable for the life of this report — cite them in
tickets, ADRs, and follow-up work._

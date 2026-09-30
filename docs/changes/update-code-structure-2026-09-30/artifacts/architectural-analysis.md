---
title: "Architectural Analysis: src/ (server, ui, shared)"
focus_area: "src/server, src/ui, src/shared, traced one layer out to Makefile, package.json, src/skills, src/fixtures"
size: "medium — three adjacent packages; the driving concern is file placement, and the previous restructure's analysis ran at medium"
roster: "structural-analyst, behavioral-analyst, concurrency-analyst, risk-analyst, software-architect"
git_available: "yes"
generated: "2026-09-30"
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

# Architectural Analysis: src/ (server, ui, shared)

## How to Read This Report

This report checks how well `src/` already follows the owner's package → feature → component layout, and what would make
moving files unsafe. Each analysis section is one specialist's findings, carried unedited. The Executive Summary is the
only synthesized prose.

- **Executive Summary.** The verdict, the few findings that matter, and the recommendations. Read this if you have two
  minutes.
- **Structural, Behavioral, and Concurrency Analysis.** Each specialist's full findings, with file paths and code.
  Findings carry stable IDs (`S#`, `B#`, `C#`).
- **Risk Assessment.** `R#` items that score those findings by likelihood, severity, blast radius, and reversibility.
- **Software-Architecture Recommendations.** `A#` recommendations and `F#` deferred follow-ups, each citing the findings
  behind it.
- **System-level concerns deferred.** Nothing crossed a service boundary.

> Sizing and roster: this run was classified **medium** and dispatched **structural-analyst, behavioral-analyst,
> concurrency-analyst, risk-analyst, and software-architect**. A smaller run dispatches fewer specialists and calibrates
> findings more conservatively; re-run at a larger size if a domain was omitted.

> Sections not part of this run: no Security section, because the workspace path check was already reviewed and this
> run is a pure restructure. No Data-Engineering or DevOps section, because `src/` has no schema, pipeline, or
> infrastructure code. No On-Call Resilience section, because resilience fixes would change behavior, which this run
> leaves out. No Codebase Map, because the README already maps the tree.

---

## Executive Summary

**Focus area:** `src/server`, `src/ui`, and `src/shared`, plus the files outside `src/` that name paths inside it
(`Makefile`, `package.json`, `src/skills`, `src/fixtures`).

**Bottom line:** the tree already follows the owner's layout almost everywhere. One test helper is in the wrong place,
and three files import a shared type through the wrong module. The real risk of a restructure is not bad boundaries.
It is paths held in strings that `make test` never checks.

**Most critical findings:**

- **R1 (High): string paths that `make test` never runs.** They cover `SRC` in `paths.ts`, `server.ts` as the build
  entry, the `index.html` → `app.tsx`/`styles.css` links, and the `src/skills` shape the macro reads (B1, B2, B3,
  S10). If one of these files moves, the tests stay green while the binary ships without skills or the server fails to
  start.
- **S1: `fake-claude-on-path.ts` and `fake-claude.ts` sit inside `chat/claude-cli/`, yet three chat components' tests
  import them.** This is the one clear break of the "lowest scope that covers every user" rule.
- **S3, B5: `agent.ts`, `claude-backend.ts`, and `agent-host.ts` import `ClaudeMode` through `command-line.ts`.** The
  type lives in `shared/wire.ts`, so a feature depends upward on the command-line parser.
- **R3 (C1, C6, B6): module singletons must stay single.** Copying `json-file.ts` would corrupt stored state on disk,
  and splitting `markdown-editor.tsx` would break undo separation.
- **C2 (existing bug, not layout):** parallel `Edit` calls can lose an edit, in both API and CLI mode.

**Highest-impact recommendations:**

- **A3:** pin the location-anchored files, and gate on `make check-build` and a server start as well as `make test`.
- **A4:** keep `json-file.ts`, the editor's singletons, and `shared/markdown.ts` as one copy each. Don't split the
  editor.
- **A1:** move the fake-claude pair to `server/chat/components/`.
- **A2:** import `ClaudeMode` from `shared/wire`, and drop the re-export from `command-line.ts`.

**Clean dimensions and omitted domains:** every other shared module is at the right scope (S5, S7, S8), and `shared/`
has no upward imports. The security, on-call, data, and DevOps domains were left out of this medium run. The security
and on-call signals are present, and are listed as follow-ups rather than analyzed.

---

## Structural Analysis

> Verbatim output from `structural-analyst`. `S#` findings on module boundaries, coupling, dependency direction,
> abstractions, and duplication.

Structural analysis of src/server, src/ui and src/shared, traced one layer out to Makefile, package.json, src/skills and src/fixtures. I built the import graph from grep over all relative imports and mock.module/import.meta/macro/text-import sites. Churn was checked with `git log --since="90 days ago"`. I did not read commit messages one by one, so the churn remarks below are only partly supported.

**Overall:** the layout mostly follows the README rules. Shared-by-both-packages code is in src/shared, and no src/ui file imports src/server. The only `ui/index.html` import runs server to UI, as documented. I found a small number of real violations, listed below.

**S1: A test helper in one component folder is imported by sibling components**
- **Dimension:** Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/chat/claude-cli/fake-claude-on-path.ts and fake-claude.ts (importers: src/server/chat/sessions/sessions.test.ts, src/server/chat/claude-backend/claude-backend.test.ts, src/server/chat/claude-cli/claude-cli.test.ts)
- **Finding:** `fake-claude-on-path.ts` sits inside the `claude-cli/` component folder. Two other components' tests reach into it:
```
import { fakeClaudeOnPath } from '../claude-cli/fake-claude-on-path';
```
  `chat/components/test-model.ts` is the parallel helper and is already correctly shared in `chat/components/`. The README rule says code shared by sibling components goes in `<feature>/components/`.
- **Impact:** this is too low a scope. A component folder's contents should be movable with that component, and here sessions and claude-backend depend on claude-cli's internals.
- **Move safety:** `fake-claude-on-path.ts` uses `await copyFile(join(import.meta.dir, 'fake-claude.ts'), join(bin, 'claude'))`. `fake-claude.ts` must therefore move together with it, and into the same folder. Nothing else imports `fake-claude.ts`. No other file checks this path.

**S2: documents imports from chat (cross-feature deep import)**
- **Dimension:** Coupling
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/documents/documents.test.ts:5, src/server/chat/tools/tools.ts:64
- **Finding:**
```
import { postName } from '../chat/tools/tools';
```
  The test uses it at line 105: `expect(postName(workspace, name)).toBe(name);`. The test checks that the documents grammar agrees with the chat tools' post-name rule. That is a rule shared by two features. It lives in `chat/tools/tools.ts` and is exported only so that `tools.test.ts` and this test can use it.
- **Impact:** the documents feature depends on a chat module. The shared rule has no home in `server/components/`. Only a test uses it, so it is a low-severity violation, but it is a real feature-to-feature reach.
- **Move safety:** a relative import with no path arithmetic. It is safe to move.

**S3: chat depends on the workspace-config feature's internals, and on an entry-point module for a type**
- **Dimension:** Dependency Direction
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/chat/tools/tools.ts, chat/agent/agent.ts, chat/tools/tools.test.ts, chat/agent/agent.test.ts, chat/claude-backend/claude-backend.ts, src/server/command-line.ts
- **Finding:**
```
import { APP_SKILL_PREFIX, appSkillText } from '../../workspace-config/workspace-config';
import { loadWorkspaceConfig, type AgentDef, type Skill } from '../../workspace-config/workspace-config';
import type { ClaudeMode } from '../../command-line';
```
  - Four chat files import workspace-config, which is a separate feature. It is the only importer, and it is imported by tools, agent and two tests. Only chat uses it, plus its own routes. A feature-to-feature dependency like this is allowed only as a public-API import, and these are implementation constants and helpers (the `3pitor://skills/` prefix, `APP_SKILL_FILES`).
  - `ClaudeMode` is defined in `shared/wire.ts:72`. `command-line.ts:6` re-exports it as `export type { ClaudeMode };`. chat then imports it from the entry-point-level file rather than from shared.
- **Impact:** coupling runs from chat to workspace-config and to a package-root module. Whether workspace-config belongs nested under chat depends on whether the owner sees it as part of chat. workspace-config also has its own routes, so this is ambiguous. Treat it as a judgement call, not a violation.
- **Unverified:** I did not check whether workspace-config is meant to be a public API for chat, because the README does not say.

**S4: markdown-editor component holds several modules and has a type cycle**
- **Dimension:** Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/documents/markdown-editor/ (markdown-editor.tsx 735 lines, raw-view.tsx, raw-formatting.ts, task-items.ts)
- **Finding:**
  - Importers of each helper: `raw-formatting.ts` is imported only by markdown-editor.tsx and its own test. `task-items.ts` is imported only by markdown-editor.tsx. `raw-view.tsx` is imported by markdown-editor.tsx and markdown-editor.test.tsx. No other feature imports any of them. They are helpers only one component imports, so they belong in the component folder under the README rule. **This is a negative result: the files are correctly located.** The owner's hint (raw-view.tsx, raw-formatting.ts) is not a violation of the rules as written.
  - A type-only cycle exists: `raw-view.tsx:7` has `import type { Ask, SelectionAsk } from './markdown-editor';` and markdown-editor.tsx:33 has `import { askName, passageAt, rawHighlights, RawView } from './raw-view';`. It has no runtime effect, but the helper depends on its parent for shared types. The types would sit better in a shared module inside the folder.
  - Dimension 3: markdown-editor.tsx is the highest-churn file (26 changes in 90 days, markdown-editor.test.tsx 30), and documents.tsx, documents.test.tsx and app.tsx import from it. I did not read the commit messages to tell bug fixes from features.
- **Impact:** if a move is planned, raw-view and raw-formatting could form their own component folder. The README would call that a split of a component into two. It is optional, not a violation.
- **Move safety:** `documents.test.tsx` uses `mock.module('../markdown-editor/markdown-editor', ...)` and `await import('../markdown-editor/markdown-editor')`. These paths are not checked by tsc, so a move of markdown-editor would silently break them. Also, markdown-editor.test.tsx imports `./raw-view` and `./raw-formatting`.

**S5: src/ui/components/ contents mostly correct; fake-documents-api.ts is too high**
- **Dimension:** Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/components/fake-documents-api.ts, api.ts, menu/, agent-actions/
- **Finding:**
  - `api.ts` is imported by app.tsx, chat.tsx and documents.tsx. That is multiple features, so the scope is correct.
  - `menu/` is imported by file-tree (documents) and by agent-actions. `agent-actions/` is imported by chat.tsx and popups/selection-popup. Both are used by more than one feature. So they are correctly scoped in ui/components. **Negative result: no violation.**
  - `fake-documents-api.ts` is imported only by app.test.tsx, documents.test.tsx and file-tree.test.tsx. Two of the three are documents tests. The other is the root test of app.tsx. It has no importer in chat or popups. It is a documents feature helper that the app test also uses, so `documents/components/` would cover the two documents tests, but app.test.tsx is at the package root, which is outside the documents feature. The lowest level covering every user is src/ui/components. It is correct as placed. **Negative result**, but the README describes it as a documents-routes stand-in, and only one feature plus the entry point use it.
  - `api.test.ts` covers api.ts. It is in place.
- **Impact:** none. Noted because you asked.

**S6: Server and UI feature names diverge for view state (and there is no UI counterpart folder)**
- **Dimension:** Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/view-state/, src/ui/documents/documents/documents.tsx
- **Finding:** the server has a `view-state/` feature (view-state.ts, routes, test). On the UI side there is no `view-state` folder. The page code that reads and writes `/api/view-state` lives inside documents.tsx:
```
await api('PUT', '/api/view-state', viewState());
```
  The README rule says a capability that spans both packages uses the same feature name in each. The same applies to workspace-config: the UI has no folder, because the UI does not call it. The server's own README text says "The page is its only writer". For chat, documents and events, names match. **Negative result** for those three.
- **Impact:** the view-state capability is split in two places with different names. The ViewState type sits in shared/wire.ts. Moving that logic to `ui/view-state/` would be a larger extraction from a 508-line file. Judgement call.

**S7: server/components contents are correctly scoped**
- **Dimension:** Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/components/json-file.ts and workspace-path.ts
- **Finding:** `json-file.ts` is imported by view-state.ts, sessions.ts and their tests (two features: view-state and chat). `workspace-path.ts` is imported by tools.ts (chat) and documents.ts (documents). Both have two or more features using them, so `server/components/` is the right level. `src/server/chat/components/test-model.ts` is used by sessions, agent and claude-backend tests, which are all chat components, so it is correct as placed. **Negative result.**
- **Impact:** none.

**S8: ui/documents/components/paths.ts correct; documents feature layout sound**
- **Dimension:** Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/documents/components/paths.ts
- **Finding:** `movedPath` and `within` are imported by documents.tsx and file-tree.tsx, two components of the documents feature. It is correct at `<feature>/components/`. file-tree.tsx also has two type and value imports from `../documents/documents` (`useDocuments` in its test, `Documents` type in the component). That is one sibling depending on another, which is permitted. **Negative result.** The `popups/components/anchored-bubble.ts` has two users (question-popup and selection-popup), also correct.

**S9: Duplication across packages**
- **Dimension:** Duplication
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/documents/documents.ts, src/ui/documents/components/paths.ts
- **Finding:** I looked for duplicated logic across packages.
  - Server `documents.ts` has the path grammar (`checkPath`, `.md` suffix, dot-names) and the UI `paths.ts` has `within` and `movedPath`. They serve different purposes (server validation, UI tree moves) and do not share code. This is incidental similarity. I found no structural duplication that belongs in src/shared.
  - The UI and the server both use `findQuote`, `textblocks`, `markdown` and `unsupportedMarkdown` from src/shared. They are correctly shared.
  - The UI documents.tsx repeats the `/api/documents/...` path strings that server documents.routes.ts defines. This is implicit coupling by magic string, with no shared constants in wire.ts. Checked with grep only. It is a medium-impact implicit coupling, but it is shared by two packages with no path-shaped abstraction to move.
- **Impact:** a route rename needs edits in both packages. No file needs moving.

**S10: Things that make moving files unsafe**
- **Dimension:** Coupling
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/paths.ts; src/server/workspace-config/app-skills.macro.ts; src/server/chat/claude-cli/fake-claude-on-path.ts; src/server/chat/agent/agent.ts and agent.test.ts; src/ui/documents/documents/documents.test.tsx; package.json; Makefile
- **Finding:** each item below is a move-safety hazard.
  1. `src/server/paths.ts`: `export const SRC = resolve(import.meta.dir, '..');`. It is the only file that does location arithmetic for src/ (per README). paths.test.ts fails if it moves. `SRC` is used by `app-skills.macro.ts` (`join(SRC, 'skills')`), `workspace.ts` (`join(SRC, 'fixtures/workspace')`, `join(SRC, '.data', name)`), `scripts/check.ts`, and the tests in workspace-config, agent and routes tests. Keep paths.ts directly in src/server/.
  2. `fake-claude-on-path.ts` uses `join(import.meta.dir, 'fake-claude.ts')`, so it must stay beside fake-claude.ts (see S1).
  3. Text imports: `import systemPrompt from './system-prompt.md' with { type: 'text' };` in chat/agent/agent.ts and agent.test.ts. `system-prompt.md` must move with agent.ts, and the declaration file src/server/text-imports.d.ts is what lets tsc accept it (it is global, so it does not care about location).
  4. Macro: `import { appSkillFiles } from './app-skills.macro' with { type: 'macro' };` in workspace-config.ts. The macro reads src/skills at bundle time through `SRC`, so it is independent of its own location, but it must stay next to its importer. The path is relative, so the two move together.
  5. `mock.module` paths: `documents.test.tsx` has `mock.module('../markdown-editor/markdown-editor', ...)` (relative, no type-check). `sessions.test.ts` and `chat/components/test-model.ts` use `mock.module('@ai-sdk/anthropic', ...)` which is a package name, so it is location-independent.
  6. `server.ts` imports `'../ui/index.html'`. package.json runs `src/server/server.ts` and `src/server/scripts/check.ts`. The Makefile uses `src/server/server.ts`, `src/ui/test-setup.ts` and `bun test src/server src/shared` / `bun test ... src/ui`. The entry points and scripts/ stay where they are. `scripts/check.ts` is imported nowhere and is run by path, so moving it needs a package.json edit. `src/ui/test-setup.ts` is a preload path in the Makefile.
  7. Many imports use long relative paths such as `'../../../shared/wire'`. Moving a file one level changes the depth. tsc (`make typecheck`) catches all static imports. It does not catch `mock.module` strings or dynamic `import()` strings (for example `await import('../markdown-editor/markdown-editor')` in documents.test.tsx).
- **Impact:** a mover should do a typecheck plus the full test run after each move. Only the `mock.module`/dynamic import strings and `import.meta.dir` in fake-claude-on-path need manual updating.
- **Unverified:** I did not inspect src/.data (it is runtime data, not code) or run the typecheck or tests, because this is a static analysis.

**S11: Stale files in the churn list (evidence the layout changed under git)**
- **Dimension:** Dependency Direction
- **File(s):** git history only
- **Finding:** the 90-day churn list includes paths that no longer exist: `src/ui/chat.tsx`, `src/ui/chat.test.tsx`, `src/ui/markdown-editor.tsx`, `src/ui/documents.tsx`, `src/server/tools.ts`, `src/server/sessions.ts`, `src/server/agent.ts`. These come from the prior restructure (renames), so their counts reflect flat-layout history. Commit messages in claude-cli show features (ClaudeBackend, MCP server) and some fixes, so churn there is mixed.
- **Impact:** churn counts for current paths understate history unless followed with `--follow`. I did not run `--follow`.
- **Unverified:** could not attribute churn to bug fixes vs features for the highest-churn files, because I read only the claude-cli commit subjects.

### Structural Summary

- **Focus area analyzed:** all of src/server, src/ui, src/shared by import graph, plus Makefile, package.json, README conventions, src/skills and src/fixtures (touched only through path arithmetic and macros).
- **Key concerns:**
  1. S1: `fake-claude-on-path.ts` (plus `fake-claude.ts`) in `claude-cli/` is used by sessions and claude-backend tests. It is the only clear location violation.
  2. S2 and S3: chat-to-workspace-config imports, `chat/tools` to `documents.test`, and `ClaudeMode` via `command-line.ts`. These are cross-feature reaches, but they are judgement calls on whether the owner sees workspace-config as part of chat.
  3. S10: the move hazards are `mock.module('../markdown-editor/markdown-editor')` in documents.test.tsx, `import.meta.dir` in fake-claude-on-path, and `paths.ts` pinned to `src/server/`.
- **Well-structured areas:** all of `server/components/*`, `chat/components/test-model.ts`, `ui/components/{api,menu,agent-actions}`, `ui/documents/components/paths.ts`, `ui/popups/components/anchored-bubble.ts`, the markdown-editor helpers (raw-view, raw-formatting, task-items), and the src/shared package (no reverse imports). No src/ui file imports src/server. Every multi-component feature has one folder per component and single-component features (events, workspace, documents on the server, view-state, workspace-config) keep files directly in the feature folder.
- **Skipped dimensions:** none skipped. Churn was not attributed to bug fixes versus features (S11). Runtime behavior, typecheck and tests were not run.

---

## Behavioral Analysis

> Verbatim output from `behavioral-analyst`. `B#` findings on data flow, error propagation, state management, and
> integration boundaries.

Findings on what a package → feature → component file move could break at runtime. All from reading the code; I did not run the build, the tests or a move.

**B1: SRC anchor is one directory level from src/, and five things derive paths from it**
- **Dimension:** Integration Boundaries
- **File(s):** /Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/paths.ts, src/server/workspace/workspace.ts, src/server/workspace-config/app-skills.macro.ts, src/server/scripts/check.ts, src/server/paths.test.ts
- **Finding:**
```ts
export const SRC = resolve(import.meta.dir, '..');
```
  This is correct only while paths.ts sits directly in src/server/. Consumers:
  - `workspace.ts`: `const FIXTURE = join(SRC, 'fixtures/workspace');` and `dataDir = (name) => join(SRC, '.data', name)`
  - `app-skills.macro.ts`: `join(SRC, 'skills')`
  - `check.ts`: `join(SRC, 'server/server.ts')`
  - tests: `workspace-config.test.ts` and `workspace-config.routes.test.ts`, which use `join(SRC, 'fixtures/workspace')`

  If paths.ts moves to another depth, nothing fails at import time.
  - **The path errors:** `FIXTURE` is only read inside `cp`, so a wrong SRC surfaces only when a workspace is first seeded.
  - **The path that never errors:** `chooseWorkspace` returns `process.cwd()` when WORKSPACE is unset, so the app runs without the fixture.
  - **The skills scan:** `Bun.Glob(...).scanSync` on a missing directory. I did not confirm whether this throws or returns empty. An empty result would ship a binary with zero app skills and no error.
  - **What catches it:** paths.test.ts is the only guard. It asserts `server/server.ts`, `ui/index.html`, `skills` and `fixtures/workspace` exist under SRC.
  - **Moving the fixtures:** a move of src/fixtures or src/skills is not caught by anything except that test. The fixture and skills paths are hard-coded strings in workspace.ts and the macro.
  - **Moving server.ts:** a move of server/server.ts itself breaks check.ts's `'server/server.ts'` string.
- **Impact:** A relocation fails silently in production paths. The test catches only paths.ts moving; it does not catch moves of fixtures, skills or the script paths.

**B2: Bun macro and the compiled-binary build both depend on file location**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/workspace-config/workspace-config.ts, src/server/workspace-config/app-skills.macro.ts, Makefile
- **Finding:**
```ts
import { appSkillFiles } from './app-skills.macro' with { type: 'macro' };
export const APP_SKILL_FILES: Record<string, string> = appSkillFiles();
```
  - **Relative specifier:** the import is relative to workspace-config.ts. The macro then reads `SRC/skills` at bundle/transpile time, using SRC from B1.
  - **Bundler entry:** the Makefile builds with `bun build --compile --production src/server/server.ts --outfile $(BUILD)/3pitor`. A move of server.ts breaks this line, and check.ts's spawn, and the `server` script in package.json (`bun run src/server/server.ts`).
  - **Only guard for the embedded skills:** `make check-build` asserts `"collaborative-editing"` appears in the served config. It is NOT part of `make test` (the Makefile says so).
  - **Test that would stay green:** `workspace-config.test.ts` reads src/skills from disk and compares it with APP_SKILL_FILES. In test mode the macro runs against the same tree, so it cannot detect a binary-only breakage.
  - **Key-shape contract:** keys are paths relative to src/skills, and the model reads `3pitor://skills/<key>`. The skill .md files link to each other relatively (e.g. SKILL.md to references/...). Those relative links must be preserved inside src/skills/.
  - **Do not restructure src/skills by feature:** the `appSkills` logic requires each skill at `<name>/SKILL.md` with no deeper nesting (`if (file !== 'SKILL.md' || rest.length) continue;`). Moving a skill under a feature folder would change its `<name>` or drop it.
- **Impact:** Moving the macro file, the skills folder or server.ts can produce a binary with missing skills or a broken build. `make test` does not catch it.

**B3: server.ts imports the UI HTML entry, so the UI bundle graph is rooted at fixed names and relative script/link paths**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/server.ts, src/ui/index.html
- **Finding:**
```ts
import homepage from '../ui/index.html';
...
routes: { '/': homepage },
```
```html
<link rel="stylesheet" href="./styles.css" />
<script type="module" src="./app.tsx"></script>
```
  - **Fixed names:** Bun's HTML bundler resolves `./styles.css` and `./app.tsx` relative to index.html. Moving app.tsx, styles.css or index.html (for example into a `ui/app/` folder) without updating both places fails.
  - **When it fails:** a wrong `../ui/index.html` import fails at server start. Wrong `src`/`href` values in the HTML fail when Bun bundles, at startup in dev and at `make build` for the binary. A broken bundle is likely to fail only at runtime in the browser. No test imports server.ts, so `bun test` will not cover it.
  - **Test coupling:** ui/app.test.tsx imports App from app.tsx, so that file is tied to its filename, and app.tsx has a guard `// Tests import App without a page to render it into.`
  - **CSS load order:** a move that changes each component's CSS import order can change cascade order. I did not test this.
    - Every CSS file is a side-effect import (e.g. `import './chat.css';`, `import './menu.css';`).
    - Load order follows the import graph, so `styles.css` (the HTML `<link>`) versus component CSS ordering could change.
  - **Package CSS:** the `prosemirror-*` CSS imports in markdown-editor.tsx are order-sensitive relative to `./markdown-editor.css` (the local sheet is imported last).
- **Impact:** Start-up failure or visual regressions from reordered CSS. The latter is undetectable by the tests, since happy-dom does not apply CSS.

**B4: Text import of system-prompt.md is tied to its sibling location and to a type declaration that is scoped by filename**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/chat/agent/agent.ts, src/server/text-imports.d.ts, tsconfig.json
- **Finding:**
```ts
import systemPrompt from './system-prompt.md' with { type: 'text' };
```
  - **Relative specifier:** it resolves relative to agent.ts. If agent.ts moves without system-prompt.md, this fails at import, and since it is inlined at build it would also break the binary build.
  - **Type declaration:** `declare module '*.md'` lives in src/server/text-imports.d.ts. It is picked up only via tsconfig `"include": ["src"]`, so it is location-independent, but `.d.ts` files are ambient across the whole project, including src/ui. Moving it does not break anything as long as it stays under src/.
  - **Only guard:** `make typecheck` (`tsc --noEmit`) catches a bad specifier, but `bun test` (the `test` target runs typecheck first) also catches it, since the import would fail when loading agent.test.ts.
- **Impact:** Low to medium. It fails loudly and early, but the prompt file must move with agent.ts.

**B5: Cross-feature server dependencies are real runtime coupling (not just imports)**
- **Dimension:** Data Flow
- **File(s):** src/server/chat/tools/tools.ts, src/server/chat/agent/agent.ts, src/server/agent-host.ts, src/server/workspace-config/workspace-config.ts
- **Finding:**
  - **tools.ts imports from three places:**
    - `import { resolveInWorkspace } from '../../components/workspace-path';`
    - `import { APP_SKILL_PREFIX, appSkillText } from '../../workspace-config/workspace-config';`
    - shared code through `'../../../shared/...'`.

    These are `../` chains that encode depth. A move changes each count. The `../../../shared/` chains are the same on the UI side: `ui/chat/chat/chat.tsx` uses three `../`, and `ui/components/fake-documents-api.ts` uses two. A wrong depth is a module-not-found at load time, so it is caught by tsc and by tests.
  - **`ClaudeMode` ownership is split and duplicated:** `type ClaudeMode` is exported from src/shared/wire.ts, yet server files import it from `'../../command-line'` (agent.ts, claude-backend.ts, agent-host.ts). Check that command-line.ts re-exports or defines it. A move must keep the two definitions identical, since the UI receives the value over the wire (`CurrentSession.claude`).
  - **Shared code is imported upward across packages:** the UI and server both import src/shared/markdown.ts, blocks.ts, passages.ts and markdown-support.ts. The same code parses markdown in the browser and on the server, so the two must stay in lockstep. A move that accidentally duplicates or forks a copy would silently diverge behavior (passage matching, unsupported-markdown detection).
  - **Test preloads:** `make test-ui` preloads `./src/ui/test-setup.ts` and runs `bun test src/ui`. `make test-server` runs `bun test src/server src/shared`. Moving shared files that depend on DOM globals into the ui tree, or UI-specific tests into the server tree, would change which preload applies. happy-dom replaces `TransformStream`, which matters for the chat tests.
- **Impact:** Medium. Mostly compile-time-detectable, but the shared-code duplication risk is behavioral.
- Unverified: could not inspect src/server/command-line.ts in depth, because I only confirmed it is imported for `ClaudeMode` and did not open it.

**B6: Module-level mutable state is limited to one process-wide write queue**
- **Dimension:** State Management
- **File(s):** src/server/components/json-file.ts
- **Finding:**
```ts
const pending = new Map<string, Promise<void>>();
...
pending.set(path, write.catch(() => {}));
```
  - **What it serialises:** this is the only module-level mutable singleton in server or UI code (the other module-level `let`s are in check.ts: `BASE`, `results`, `events`). It serialises writes per absolute path. It is shared by the session file and the view-state file through the same module instance, and is keyed by path string, not by feature.
  - **What a move could do:** a duplicated copy of json-file.ts (for example a copy in each feature's `components/` folder) would create two independent queues. Two writes to the same path would then race, or one rename could clobber the other. The temp-file name is `${path}.${process.pid}.tmp`, so two queues in one process would share a temp path and could corrupt a write. Keep it a single module.
  - **Map growth:** the `pending` Map never prunes entries. This is unrelated to a move.
  - **Shared filename type:** `stateFile(workspace, name: 'session.json' | 'view.json')` couples two features (chat/sessions and view-state) to one components/ file through a string-literal union. Moving it into a single feature folder would invert ownership.
  - **Other implicit state is instance-held, not module-level:** `EventBus` listeners are instance state created in `createAgentHost`, and `Sessions` are constructed with `(options, events)` in agent-host.ts. `server.ts` creates them once. These are not shared through module singletons, so moving them is safe as long as server.ts remains the one wiring site.
  - **One module-level constant computed at import:** `APP_SKILL_FILES` in workspace-config.ts is computed once at import through the macro (see B2).
- **Impact:** Medium. The danger is accidental duplication of json-file.ts, not the move itself.

**B7: View-state is owned by the UI and stored opaquely on the server, but its type lives in shared/wire.ts and embeds other features' types**
- **Dimension:** Data Flow
- **File(s):** src/server/view-state/view-state.ts, src/server/view-state/view-state.routes.ts, src/shared/wire.ts, src/ui/documents/documents/documents.tsx, src/ui/app.tsx
- **Finding:**
```ts
// The editor's view, stored so a reload or restart brings it back. The page writes it and reads it; the server never
// looks inside.
return ((await readJson(stateFile(workspace, 'view.json'))) as ViewState | undefined) ?? { mode: 'rendered', unsaved: [], notApplied: [] };
```
  - **No validation on read:** the `as ViewState | undefined` cast has no runtime check. A hand-edited or older `.3pitor/view.json` whose shape differs passes straight to the UI. The UI's `GET /api/view-state` then reads `view.unsaved`, `view.notApplied` and so on.
  - **Shape mixing:** ViewState embeds `SessionHighlights` (produced by the chat feature's tools, `data-session`), `StoredDoc`/`TurnRecord` (base64 Yjs updates owned by the UI's documents feature), and `appliedTurn` (a chat message id). This makes the server-side view-state feature a pass-through for state from the documents and chat features. Only the types are shared. The Yjs encoding (base64 of updates) is an implicit contract between the UI editor code in documents.tsx and markdown-editor.tsx, not described in wire.ts beyond comments.
  - **Stored-on-disk contract:** `.3pitor/view.json` and `.3pitor/session.json` are persisted formats (workspace-relative, under the user's workspace). Renaming those strings, or changing the shape of anything in wire.ts, would orphan users' stored state. A restructure that moves wire.ts types into per-feature files is fine only if the serialised shape stays byte-identical.
  - **Workspace-relative document names:** `current`, `unsaved[].name` and `highlights.file` are workspace-relative names shared between view-state, documents and chat. The same string must match across all three (for example `tools.ts` resolves `openFile` through `resolveInWorkspace`, and the UI keys `documents` by the same name).
- **Impact:** Medium. No runtime failure from a move unless the shapes or file names change. A moved view-state feature must keep reading `view.json` from the same place.

**B8: Wire contracts that cross packages without living in src/shared**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/workspace-config/workspace-config.routes.ts, src/server/chat/sessions/sessions.routes.ts, src/server/chat/agent/agent.ts, src/ui/chat/chat/chat.tsx, src/server/documents/documents.routes.ts, src/ui/events/host-events.ts
- **Finding:**
  - **Workspace config:** `c.json({ skills: config.skills.map((s) => s.name), agents: config.agents.map((a) => a.name) })` has no type in wire.ts. The UI does not consume it in the files I grepped, so only check-build and tests use it.
  - **`POST /api/sessions` response:** `c.json({ id: (await sessions.create()).id }, 201)`. The UI reads `.id` from an untyped `api(...)` (`api<T = any>`), so it is `any`.
  - **Cancel response:** `{ cancelled: ... }` is untyped and unread.
  - **Stream parts:** the server writes `data-progress`, `data-task` and `data-session` parts in agent.ts (`writer?.write({ type: 'data-progress', data, transient: true })`). The UI matches the literal strings in chat.tsx (`part.type === 'data-progress'`), so the part names are duplicated string literals. `TurnProgress` and `SessionData` are in shared, but the literal type names are not.
  - **Route paths:** all `/api/...` and `/ws/events` paths are string literals duplicated between server routes, ui/documents/documents.tsx, ui/app.tsx, ui/chat/chat/chat.tsx, ui/events/host-events.ts and ui/components/fake-documents-api.ts (a test fake that hand-mirrors the documents API). A move can't break them, but a move that splits features carelessly can leave the fake drifting from the real routes. Nothing checks the fake against the real server.
  - **Internal wire:** `api()` in ui/components/api.ts expects an `{ error: string }` body on failure. That shape is `ApiError` in wire.ts, but only the documents routes are said to use it. Sessions routes also return `{ error }`, unlabelled.
  - **Path-coupled regex:** chat.tsx strips `^.*\/\.data\/[^/]+\/` from tool-call file paths, which hard-codes the `src/.data/<name>/` layout defined by `dataDir` in workspace.ts. Changing where `.data` lives (for example under a feature folder) would leave the UI showing absolute paths. This is cosmetic, and no test covers it.
- **Impact:** Medium. Nothing here breaks on a file move. A careless move that changes literals, or splits shared shapes per feature, can silently desynchronise the two sides, because the untyped `any` calls give the type checker nothing to report.

**B9: Test helper copies itself by location**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/chat/claude-cli/fake-claude-on-path.ts, src/server/chat/claude-cli/fake-claude.ts
- **Finding:**
```ts
await copyFile(join(import.meta.dir, 'fake-claude.ts'), join(bin, 'claude'));
```
  - **Sibling location:** this helper relies on fake-claude.ts sitting beside it. fake-claude.ts imports only `node:fs`, so it is self-contained once copied. That is robust to a move, provided the two files move together. Three test files use the helper with relative paths (sessions.test.ts and claude-backend.test.ts through `../claude-cli/fake-claude-on-path`, and claude-cli.test.ts through `./fake-claude-on-path`).
  - **Shebang and mode:** the copied file is run as `claude`, so it needs its shebang and executable behaviour preserved. A move that changes line endings or drops the header would break it. The error would show up as the tests that spawn the CLI failing, not as a clear message.
  - **Cross-feature import:** sessions.test.ts imports the helper from `claude-cli/`, so moving the helper into a chat-scoped `components/` folder changes three import depths.
- **Impact:** Low to medium, and test-only.

**Negative results**
- No `__dirname` uses, no `process.cwd()`-relative resource loading for app resources (only for choosing the workspace, which is user-facing behaviour), and no dynamic `import()` or `require` of computed paths in src. So apart from B1, B2 and B3, nothing else resolves files by location.
- shared/ has no upward imports (I grepped for `../` outside tests and found none). That is good: it is a true leaf, so moving it has no ordering effect beyond the `../../../shared/` depth counts.
- The UI and server never import each other. The only cross-package edges are server→`ui/index.html` (B3) and both→`shared`.
- Every `../` chain is checked by tsc and by module loading, so depth errors fail loudly. The silent risks are the ones above, where a path is a string (B1, B2, B3, B9, and the `.data` regex in B8) or a check that is not part of `make test` (`make check-build`).

**Behavioral Summary**
- **Focus area analyzed:** src/server, src/ui, src/shared, plus Makefile, package.json and tsconfig.json at the repo root. I traced the path-resolution entry points, the macro and text imports, the module-level state, and the wire shapes between packages.
- **Key concerns:**
  1. SRC, the macro and the fixed server→ui HTML entry are the only silent breakage points (B1, B2, B3). Only paths.test.ts and the optional `make check-build` catch them.
  2. `make test` does not exercise the compiled binary or server.ts. A move that breaks the bundle or the embedded skills would pass the tests.
  3. Wire contracts outside shared (B8), plus the opaque ViewState persisted on disk (B7), desynchronise silently because the UI uses `api<any>`.
- **Well-handled areas:** the paths.test.ts guard, the single process-wide JSON write queue with atomic rename (B6), and no `__dirname` or computed dynamic imports.
- **Skipped dimensions:** I did not run the build, tests or `bun build --compile`. Runtime behaviour for a missing skills directory in the macro, and the contents of command-line.ts, were not verified.
- Unverified: could not inspect runtime behavior of the compiled binary or of `Bun.Glob.scanSync` on a missing directory, because I only read the code and did not run the build or tests.

---

## Concurrency Analysis

> Verbatim output from `concurrency-analyst`. `C#` findings on race conditions, resource contention, deadlock potential,
> async error handling, and synchronization.

### Concurrency analysis: src/server, src/ui, src/shared (restructure lens)

Concurrency patterns are present, so the full analysis applies. The runtime is single-threaded event-loop async, with no OS threads or locks. The concurrency sources are:
- The AI SDK's parallel tool execution, which I did not re-read this round. The prior analysis verified it in node_modules.
- The claude CLI subprocess with its in-process MCP HTTP endpoint.
- An `EventBus` feeding a WebSocket.
- An ordered promise queue for JSON state files.
- Overlapping HTTP requests.
- React refs and Yjs docs in the browser.

I read tools.ts, sessions.ts, json-file.ts, view-state.ts, events.ts, agent-host.ts, server.ts, claude-cli.ts, mcp-endpoint.ts, documents.ts, and the relevant parts of documents.tsx and markdown-editor.tsx. I did not read agent.ts in full or the routes files other than view-state and events. Not run: I did not execute any test, and I did not drive a live model.

### Module-level shared state inventory (what the restructure must keep singular)

Only these are module-level:
- `pending` in `src/server/components/json-file.ts`
- `undoManagers`, `rawFormatters`, `highlightsKey`, `pinnedKey` and `rawKey` in `src/ui/documents/markdown-editor/markdown-editor.tsx`
- `schema`, `markdownParser` and `markdownSerializer` in `src/shared/markdown.ts`

`EventBus`, `Sessions` and the per-turn `TurnTexts` are instance-scoped. They are created in `createAgentHost` (`src/server/agent-host.ts`) and per `chat()` call. They are not singletons, so they cannot split by import path. Their identity depends on `agent-host.ts` and `server.ts` passing the same instance around. That is correct today: `host.events` goes to `eventSocket`, and `host.sessions` goes to `sessionRoutes`.

**C1: The write-ordering queue `pending` is a module singleton keyed by raw path string**
- **Dimension:** Synchronization
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/components/json-file.ts`, used by `src/server/chat/sessions/sessions.ts` and `src/server/view-state/view-state.ts`
- **Finding:** Write order per file is guaranteed only by this module-level map:
```ts
const pending = new Map<string, Promise<void>>();
...
const write = (pending.get(path) ?? Promise.resolve()).then(async () => {
...
pending.set(path, write.catch(() => {}));
```
  - The queue's scope is one module instance plus a string-equal path. Nothing in it depends on which folder the file lives in, so a move is safe provided there is exactly one `json-file` module and every caller imports it.
  - Today there are exactly two callers, each with its own file: `session.json` from `sessions.ts` and `view.json` from `view-state.ts`. So the queues never actually contend with each other.
  - `Sessions.save` is called from `load`, `create`, the chat start, and `record`. Only `Sessions` writes `session.json`, and all writes go through `writeJson`. I checked all access sites, and ordering is correct.
  - `stateFile()` builds the path from the same `workspace` string, so keys match.
  - The restructure risk is duplication: if `json-file.ts` were copied or re-homed per feature (for example a `sessions/json-file` and a `view-state/json-file`), each copy would get its own `pending` map. The two files would still be safe. But a future second writer to one file in a different copy would lose ordering, and the tmp-file name `${path}.${pid}.tmp` would then collide between two interleaved writes.
  - The Bun bundler and runtime dedupe by resolved absolute path, so a pure move with updated imports does not split it. A case-variant or symlinked import path can split it on macOS's case-insensitive filesystem, so keep imports canonical.
- **Impact:** A split queue would let two writes to one file interleave on the shared tmp file. One write's `rename` could then move the other's half-written temp, or the last write to land could be an older value. That would be silent state corruption of the stored chat or view. Keep `json-file.ts` as a single shared component (the current `components/` placement is right).

**C2: Per-turn state spans tools.ts, sessions.ts and agent.ts and is still unsynchronized (prior C1, still present)**
- **Dimension:** Race Conditions
- **File(s):** `src/server/chat/tools/tools.ts`, `src/server/chat/sessions/sessions.ts`, `src/server/chat/agent/agent.ts`, `src/server/chat/claude-cli/mcp-endpoint.ts`
- **Finding:** The prior analysis's C1 is still present. `Sessions.chat` creates one `TurnTexts` per turn (`const turn = turnTexts(this.options.workspace, documents);`). It passes that one object into every tool closure through `agentSettings(..., turn, writer)`. Sessions reads it back with `editedTexts(turn)` and `turn.highlights`. The mutators are unsynchronized:
```ts
function markEdited(turn: TurnTexts, name: string, text: string) {
  turn.texts.set(name, text);
  turn.edited.delete(name);
  turn.edited.add(name);
}
```
  - `Edit` reads with `const text = await postText(name, file_path);`. It then writes with `markEdited(turn, name, next);` and `highlightChanges(turn, name, next, ...)`. An await sits between the read and the write.
  - New since the prior analysis: CLI mode adds a second fan-out path. `mcp-endpoint.ts` runs `tool.execute!` inside each `tools/call` HTTP request. Bun serves those requests concurrently, and claude may issue parallel MCP calls. So the race exists in both the API path (AI SDK `Promise.all` over tool calls, verified by the prior analysis) and the CLI path (concurrent MCP POSTs).
  - `Highlight` and `Edit` also race on `turn.highlights`. `highlightChanges` does `turn.highlights = { ..., passages: [...earlier, ...] }`, where `earlier` was computed from the previous `turn.highlights` value.
  - Restructure bearing: the trio `sessions` / `agent` / `tools`, plus `mcp-endpoint`, all share the `TurnTexts` contract. The current layout has `chat/tools`, `chat/sessions` and `chat/agent` under one `chat` feature, which keeps them together. Moving `tools` out of `chat` (for example into a `documents` or `posts` feature) would hide the shared mutable state across packages.
- **Impact:** Two parallel `Edit` calls on the same post can both read the pre-change text. The later write then overwrites the earlier one in `turn.texts`, yet both tool calls return "edited" to the model. The user's editor merges a result missing one edit, with no error. The highlight list can drop passages the same way.
- Unverified: could not observe live model behavior, because whether claude issues parallel tool calls depends on runtime model choice and I did not run one. I also did not re-inspect the AI SDK's `Promise.all` in node_modules this round, so I am relying on the prior analysis for the API-mode fan-out.

**C3: Cancellation is still not checked inside tool execution (prior C5, still present)**
- **Dimension:** Async Errors
- **File(s):** `src/server/chat/tools/tools.ts`, `src/server/chat/sessions/sessions.ts`, `src/server/chat/claude-cli/mcp-endpoint.ts`
- **Finding:** `grep abortSignal` in `tools.ts` returns nothing. Only `agent.ts` (lines 87 and 98, the subagent task) uses it. The safety net is still the single gate in `sessions.ts`:
```ts
const aborted = abort.signal.aborted;
const data: SessionData = { aborted, edited: aborted ? {} : editedTexts(turn) };
```
  In CLI mode, `mcp-endpoint.ts` passes `abortSignal` into `tool.execute`, but the file tools ignore it. The `closed` flag in `runClaude`'s `emit` only suppresses late output parts. It does not stop the tools from mutating `turn`.
- **Impact:** Correct today, because the gate discards the data. If the restructure moves the `aborted ? {} : editedTexts(turn)` read away from `tools.ts`/`TurnTexts`, a stopped turn's late edits could leak to the client. This is latent, not active.

**C4: EventBus has no per-listener isolation and no session filter (prior C3 and C4, still present)**
- **Dimension:** Async Errors
- **File(s):** `src/server/events/events.ts`, `src/server/events/events.routes.ts`, `src/server/chat/agent/agent.ts` (line 61, `events.emit(event)`)
- **Finding:**
```ts
emit(event: HostEvent) {
  for (const listener of this.listeners) listener(event);
}
```
  A throwing listener aborts delivery to the later listeners. The `for...of` loop iterates a live `Set`, so a listener that unsubscribes during emit is safe. A listener added during emit is visited in the same pass, which is harmless. The bus is one instance per host, so the restructure cannot split it by import path. `turn-finished` is emitted from the `finally` in `Sessions.record`, which runs after the session is freed, so a throwing listener would propagate out of `record`'s `finally`. I did not verify that `record()`'s returned promise is handled in that case. The caller hands it to the stream's `flush`, so a throw would surface as a stream error on the page's reply.
- **Impact:** Latent: there is one listener kind today. Any subscriber added during or after the restructure inherits the lack of isolation and session scoping.

**C5: Turn bookkeeping in documents.tsx spans chat and documents features (prior C2, still present)**
- **Dimension:** Race Conditions
- **File(s):** `src/ui/documents/documents/documents.tsx` (`turnBases`, `turnSaves`, `turnFile`, `beginTurn`, `applyEdited`, lines 36-40 and 157-200), `src/ui/chat/chat/chat.tsx` (line 134: `sendMessage({ text }, { body: { openFile, ...beginTurn() } })`), `src/ui/app.tsx` (line 59 wires `beginTurn: docs.beginTurn`)
- **Finding:** `beginTurn` (called at send time) and `applyEdited` (line 325, run at turn finish) must pair on the same refs. `turnBases` is also persisted into the view state (line 281) and restored on reload (line 237). The wiring is via props in `app.tsx`, so the ref identity is held by one `useDocuments()` instance. That is safe as long as there is one hook instance. If documents and chat are split into sibling features and something calls `useDocuments` in two places, the turn refs would diverge silently, because nothing type-checks the pairing. The `entry.saves > turnSaves` check covers only the save-mid-turn interleaving.
- **Impact:** A wrong split leaves `applyEdited` merging against a base different from the one `beginTurn` captured. The AI's edit then overwrites the user's typing, or is refused, with no error.

**C6: Editor module singletons are shared between a function and a component**
- **Dimension:** Synchronization
- **File(s):** `src/ui/documents/markdown-editor/markdown-editor.tsx` (lines 78, 353, 505-515; `mergeMarkdown` at line 83), `src/ui/documents/documents/documents.tsx` (line 200)
- **Finding:** `undoManagers` is a module-level `WeakMap<Y.Doc, Y.UndoManager>`. `mergeMarkdown` (exported, called from `documents.tsx`) reads it. The editor component writes it (line 505: `undoManagers.set(doc, ...)`) and deletes from it (line 515). Both sides must see the same map instance. `rawFormatters` and the PluginKeys (`highlightsKey`, `pinnedKey`, `rawKey`) are likewise shared between plugin code and component code in the same file.
  - If the restructure splits `mergeMarkdown` into its own file, the map must stay in one module that both import. Copying it would make `undoManagers.get(live)` return undefined. No error is raised: `?.stopCapturing()` silently no-ops, and the AI's merge then joins the user's undo step.
  - If the `PluginKey` constants were redeclared in two files, each gets a distinct key identity (ProseMirror suffixes the name), and `getState` with the wrong key returns undefined.
  - `shared/markdown.ts` exports the ProseMirror `schema` singleton, which `task-items.ts`, `markdown-editor.tsx` and `tools.ts` all import. Schema identity matters: nodes built against one `Schema` instance are rejected by another. A duplicated `shared/markdown` would break that, but the bundler dedupes by path.
- **Impact:** Silent loss of undo separation of the AI's edit, or ProseMirror errors at runtime, if these are duplicated or split during the move.

**C7: Unsequenced document writes and check-then-act in documents.ts (pre-existing, medium-low)**
- **Dimension:** Race Conditions
- **File(s):** `src/server/documents/documents.ts`
- **Finding:** `writeDocument` does a plain `await Bun.write(full, content);` with no per-path queue and no temp-and-rename, unlike `writeJson`. Two overlapping saves of one file from separate requests can interleave. `createEntry` does `locateFile` (an lstat) and then writes with `writeFile(item.full, ...)` with no `wx` flag. A file created between the check and the write is overwritten. `moveEntry` checks the target's existence and then calls `rename`. A target created in between would be replaced.
- **Impact:** This matters only with concurrent clients (two tabs) or double-fired saves. The worst case is a lost or truncated file write. The restructure does not change it, but note that the careful ordering in `json-file.ts` is not shared with document writes, so do not assume it is.

**C8: Overlapping PUTs to view-state are applied in arrival order, not send order**
- **Dimension:** Race Conditions
- **File(s):** `src/server/view-state/view-state.routes.ts`, `src/server/view-state/view-state.ts`, `src/ui/documents/documents/documents.tsx` (around line 280)
- **Finding:** `writeJson` orders writes by call order on the server. Two PUTs from the page that overlap on the network can arrive in either order. The server's queue then persists the last-arrived one, which may be the older view.
- **Impact:** Low to medium: a reload can restore a slightly stale view, including a stale `turn.bases`. I did not inspect whether the page serializes its PUTs, because I did not trace the save-debounce in `documents.tsx` past the `bases` line. This is not affected by the restructure.
- Unverified: could not inspect how the UI sequences its PUTs, because I did not trace that code path.

### Previously known items (briefly)
- Prior C1 (TurnTexts race): still present, now also reachable through the CLI MCP path. See C2 above.
- Prior C2 (UI turn reconciliation): still present. See C5 above.
- Prior C3 (EventBus no fault isolation) and C4 (no session filter): still present, unchanged. See C4 above.
- Prior C5 (cancellation not honored in tools): still present. See C3 above.

### Concurrency Summary
- **Focus area analyzed:** src/server (chat, events, components, view-state, documents, claude-cli), src/shared, and src/ui/documents, chat and app wiring.
- **Concurrency model:** Single-threaded async/await on Bun and in the browser. Parallel tool calls come from the AI SDK and from concurrent MCP HTTP requests in CLI mode. An in-process `EventBus` feeds a WebSocket. A module-level promise queue orders JSON writes. React refs and Yjs docs carry per-turn state in the browser.
- **Key concerns:** (1) Per-turn `TurnTexts` is unsynchronized and shared across the tools/sessions/agent trio (C2, with cancellation in C3). (2) Module singletons whose identity must not split: `pending` in json-file.ts, and `undoManagers` in markdown-editor.tsx (C1, C6). (3) UI turn refs in `useDocuments` that pair `beginTurn` with `applyEdited` (C5).
- **Well-handled areas:**
  - Write ordering in `writeJson` is correct. Failures do not poison the queue (`pending.set(path, write.catch(() => {}))`), each write captures its value at call time, and the tmp file is per-pid.
  - Sessions enforces one turn at a time per session (`if (session.abort) throw ...`). `record()` always clears `abort` in `finally`. A stopped turn is handled.
  - `Sessions.save` is guarded by `currentId`, so a finished turn in an old session cannot overwrite the new session's record.
  - `runClaude` cleanup is idempotent (`closed`), removes the abort listener, kills the subprocess, and stops the MCP server on every path. A late tool result after close writes nothing.
  - The MCP endpoint URL is unguessable per call and bound to 127.0.0.1.
  - `EventBus`, `Sessions` and `TurnTexts` are instance-scoped, so they cannot split by import path.
- **Skipped dimensions:** None skipped. Deadlock: no locks exist. The only blocking waits are `await ready.promise` in `runClaude`, which is always resolved or rejected on every path, and the stream tee/flush coupling in `chat()`. I found no circular wait.

Key files, all under /Users/mxriverlynn/dev/mxriverlynn/3pitor/src:
- server/components/json-file.ts
- server/chat/sessions/sessions.ts
- server/chat/tools/tools.ts
- server/chat/claude-cli/mcp-endpoint.ts
- server/chat/claude-cli/claude-cli.ts
- server/events/events.ts
- server/agent-host.ts
- server/documents/documents.ts
- ui/documents/markdown-editor/markdown-editor.tsx
- ui/documents/documents/documents.tsx

---

## Risk Assessment

> Verbatim output from `risk-analyst`. `R#` items, ordered highest risk first, each cross-referencing the `S`/`B`/`C`
> findings it scores.

Risk assessment for the src/ restructure (package → feature → component). Git is available. Evidence: upstream files, a spot-check of app-skills.macro.ts, the Makefile, and 90-day churn in chat/tools and chat/sessions.

Two caveats that apply to everything below. No build, test or `bun build --compile` was run by me or upstream. Churn evidence is thin, because S11 notes the renames hide flat-layout history.

Reading key: (a) is the risk of leaving the layout violation in place. (b) is the risk that the unattended restructure trips the hazard.

**R1: Silent path breakage in location-derived strings and build entry points (binary ships without skills or fixtures, or the bundle fails)**
- **Addresses:** S10 (items 1, 4, 6), B1, B2, B3, B4
- **Likelihood:**
  - (a) Unlikely. These are not layout violations; the current placement is correct.
  - (b) Likely if anything near them moves. `SRC = resolve(import.meta.dir, '..')` in `src/server/paths.ts` is correct only while that file sits directly in `src/server/`. `workspace.ts` and `app-skills.macro.ts` join literal strings onto it (`skills`, `fixtures/workspace`, `.data`). `check.ts` uses `'server/server.ts'`. `package.json` and the Makefile name `src/server/server.ts`, `src/server/scripts/check.ts` and `src/ui/test-setup.ts`. `server.ts` imports `'../ui/index.html'`, and `index.html` references `./app.tsx` and `./styles.css`.
  - The macro line I read, `new Bun.Glob('**/*.md').scanSync({ cwd: dir })`, would probably throw on a missing directory. I did not confirm that (the skills-dir line further down).
- **Severity:** High for (b). `make test` depends on `typecheck`, `test-server` and `test-ui`, and none of them run `server.ts` or the binary. A moved `server.ts`, `index.html`, `app.tsx` or `src/skills` passes the tests and fails at startup or build. A skills-dir move would break the build or give an empty skills list. `chooseWorkspace` falls back to `process.cwd()`, so a wrong fixture path surfaces only on first seed. `paths.test.ts` guards only `SRC`'s targets, and `make check-build` is not in `make test`.
- **Blast radius:** System-wide for (b). The server start, the UI bundle and the binary are all affected, through about 7 path-bearing files.
- **Reversibility:** Easy. It is source-only and git-revertible, with no persisted data. Detection is the hard part, because the failure is silent until someone runs the server or `make check-build`.
- **Overall risk:** High (b). Low (a).
- **What happens if deferred:** With no restructure there is no issue. If an unattended agent relocates `paths.ts`, `src/skills`, `src/fixtures`, `app.tsx` or `server.ts` into a new folder, CI stays green. The next person who runs `make build` or starts the server finds a missing-skills binary or a startup crash.
- **Mitigation for the restructure:** pin these files in place, and have the restructure run `make check-build` and start the server as a gate.
- **Unverified:** could not inspect `Bun.Glob.scanSync` behavior on a missing directory or the compiled binary, because nothing was executed.

**R2: Unchecked string module paths in tests (mock.module, dynamic import, import.meta.dir) go stale after a move**
- **Addresses:** S4 (move safety), S10 (items 2, 5, 7), B9, S1, parts of B5
- **Likelihood:**
  - (a) Possible. The S1 violation itself causes no failure.
  - (b) Near certain if `markdown-editor`, `claude-cli` or the fake-claude files move. `documents.test.tsx` uses `mock.module('../markdown-editor/markdown-editor', ...)` and `await import(...)` with the same string, and tsc does not check either. `fake-claude-on-path.ts` copies `join(import.meta.dir, 'fake-claude.ts')`. Three tests import `fake-claude-on-path` (sessions, claude-backend, claude-cli).
- **Severity:** Medium. A stale `mock.module` path most likely makes the mock not apply, so the real editor loads in happy-dom and the test fails or passes for the wrong reason. The exact failure mode (loud or silent) is unverified. A split fake-claude pair fails the tests loudly. Nothing ships broken.
- **Blast radius:** Single module to multi-module. About 4 test files are affected, all in tests.
- **Reversibility:** Easy.
- **Overall risk:** Medium (b). Low (a).
- **What happens if deferred:** The S1 leftover (`fake-claude-on-path` inside `claude-cli/`, used by two sibling components) is an ownership smell only. If the restructure moves the helper to `chat/components/`, it must move `fake-claude.ts` with it and update 3 imports. If `markdown-editor` moves and the string paths are not updated, `documents.test.tsx` degrades. A gate is needed: grep for `mock.module('.` and `import('.` in tests, then run the tests.

**R3: Duplicating or splitting module singletons (json-file `pending`, editor `undoManagers` and PluginKeys, `schema`) during a split or re-home**
- **Addresses:** B6, C1, C6, S7 (negative), S4 (optional split)
- **Likelihood:**
  - (a) Unlikely. Placement is currently correct. `server/components/json-file.ts` is used by sessions and view-state, and `shared/markdown.ts` is a single copy.
  - (b) Possible. It needs a copy per feature, or splitting `mergeMarkdown` or `RawView` from `markdown-editor.tsx` and redeclaring the maps or keys. S4 flags an optional split of the markdown-editor folder, and the module has 26 changes in 90 days.
- **Severity:** Critical for `json-file`. Two queues would share the `${path}.${pid}.tmp` file and could corrupt the `session.json` or `view.json` written to users' workspaces silently. High to Medium for the editor. A duplicated `undoManagers` silently no-ops `?.stopCapturing()`, and redeclared PluginKeys return undefined state.
- **Blast radius:** Multi-module. `json-file` has 2 features plus their tests. The editor has documents and app.
- **Reversibility:** Moderate. Code is easy to revert. Corrupted user state on disk would not be recoverable.
- **Overall risk:** Medium. The likelihood is low because the current layout is right, and the severity is high. A pure move that keeps single copies triggers nothing.
- **What happens if deferred:** Nothing. The risk only arises if the restructure copies instead of moves. Guard: one definition of each; grep for duplicate `pending` and `undoManagers` afterwards.

**R4: Latent shared-state coupling in the chat trio (TurnTexts, the cancellation gate) and UI turn refs**
- **Addresses:** C2, C3, C5
- **Likelihood:**
  - (a) Possible and already present. C2 is an existing race. Parallel `Edit` calls read the pre-change text across an `await` and overwrite each other in `turn.texts`. CLI mode adds a second path through concurrent MCP POSTs. This is pre-existing behavior, not layout-driven. `tools.ts` is the top-churn server file (10 changes, tests 9) and `sessions.ts` has 4.
  - (b) Unlikely. The restructure will keep `tools`, `sessions` and `agent` under `chat`, and C5 needs two `useDocuments` instances.
- **Severity:** High for C2 as a bug. The user's merged result silently drops an edit while the model is told "edited". C3 (`aborted ? {} : editedTexts(turn)`) is latent and correct today. C5 is High only if the hook is split.
- **Blast radius:** Single module (chat) for C2 and C3. Two UI features for C5.
- **Reversibility:** Moderate. The behavior fix is targeted, but lost edits are not recoverable once the page merges.
- **Overall risk:** Medium. The restructure does not change it. The behavior race is a separate bug from the layout.
- **What happens if deferred:** C2 continues to exist exactly as today. A restructure that keeps the files together neither worsens it nor fixes it. If `tools` or the abort gate moves out of chat, or `useDocuments` is called from two places, a stopped turn's edits could leak or `applyEdited` could merge against the wrong base with no error.
- **Unverified:** could not observe parallel tool calls at runtime, because that depends on model choice and nothing was run. The AI SDK `Promise.all` fan-out is relied on from the prior analysis and was not re-read.

**R5: Persisted on-disk and wire shapes must stay byte-identical (view.json, session.json, untyped API literals, route strings)**
- **Addresses:** B7, B8, S9 (route strings), S6
- **Likelihood:**
  - (a) Possible, but it does not come from layout. The shapes are cast with `as ViewState` with no validation, and the UI calls `api<any>`.
  - (b) Unlikely for a pure move. It only occurs if the restructure splits `wire.ts` per feature, moves view-state logic into `ui/view-state/` (S6), or renames files or literals such as `.3pitor/view.json`, `data-progress` or `/api/...`.
- **Severity:** High. A renamed state file or changed shape orphans users' stored state. Type-checking cannot catch drift in the untyped calls or the literal route strings.
- **Blast radius:** Multi-module. `wire.ts` is imported by both packages, plus the persisted files.
- **Reversibility:** Difficult for orphaned user state. Easy for source.
- **Overall risk:** Medium. The likelihood is low for a pure move, but the severity is high if it happens.
- **What happens if deferred:** Nothing for the layout as-is. The S6 name divergence for view-state is a naming inconsistency. A larger extraction is a judgement call and carries the most risk here, so keep `wire.ts` and the literals intact.

**R6: Import depth chains and side-effect CSS order changed by moves**
- **Addresses:** B3 (CSS order), B5 (../ chains), S10 item 7, B2 (skills key shape)
- **Likelihood:**
  - (b) Likely. Every moved file has `../../../shared/...`-style paths that change. tsc catches them, so they fail loudly and early.
  - Two cases are not caught. CSS cascade order follows the import graph, and the `prosemirror-*` CSS must precede `./markdown-editor.css`. `src/skills` must keep the `<name>/SKILL.md` shape that the `appSkills` logic requires.
- **Severity:** Low for depth (loud). Medium for CSS. Happy-dom does not apply CSS, so a visual regression would go undetected.
- **Blast radius:** Localized for depth. Multi-module for CSS.
- **Reversibility:** Easy.
- **Overall risk:** Medium for CSS order. Low for depth chains.
- **What happens if deferred:** Nothing. During the restructure, typecheck plus tests catch depth. CSS import order must be preserved by hand, or the editor may render subtly differently after the move.

**R7: Layout violations that are real but low-impact**
- **Addresses:** S1 (placement), S2, S3, S5, S6, S9
- **Likelihood:** Possible.
- **Severity:** Low. Examples: S2 is a test-only reach from `documents.test.ts` into `chat/tools` for `postName`. S3 covers chat's imports of workspace-config internals (`APP_SKILL_PREFIX`, `appSkillText`) and `ClaudeMode` via `command-line.ts` instead of `shared/wire`. Both are judgement calls. S9 covers route strings shared across the two packages with no constants.
- **Blast radius:** Localized to single module. S3 touches about 6 files.
- **Reversibility:** Easy. There is no external contract. The one exception is S9, where a route rename needs edits in both packages.
- **Overall risk:** Low.
- **What happens if deferred:** Slight friction. Moving `postName` to `server/components/` or `ClaudeMode` imports to `shared/wire` is optional. (b): `ClaudeMode` is already defined in `shared/wire.ts`, so redirecting imports carries no risk. Whether workspace-config counts as part of chat is undecided, so moving it is a risk with no payoff.

**R8: Concurrency and robustness items unrelated to the restructure**
- **Addresses:** C4, C7, C8, B9 (shebang and mode), parts of B7 (no read validation)
- **Likelihood:** Possible, and only with concurrent clients or new subscribers.
- **Severity:** Low to Medium:
  - C4: a throwing EventBus listener would skip later listeners. There is one listener kind today.
  - C7: `writeDocument` has no queue or atomic rename, so concurrent saves can lose or truncate a file. The severity is higher than Low for two-tab use.
  - C8: a stale view-state PUT can win.
- **Blast radius:** Single module or localized.
- **Reversibility:** Easy to Moderate.
- **Overall risk:** Low to Medium. The restructure neither causes nor cures these. Treat C7 as the highest of the group.
- **What happens if deferred:** No change in the restructure. Two tabs saving the same file could still overwrite each other.
- **Unverified:** could not inspect how the UI sequences view-state PUTs, because that code path was not traced.

### Risk Summary
- **Findings assessed:** 28 (S1-S11, B1-B9, C1-C8), grouped into 8 risk items.
- **Critical risks:** 0 at the overall level. The worst single outcome is corrupted user state if `json-file.ts` were duplicated (R3), but the likelihood is low.
- **High risks:** 1.
  - R1: location-derived paths and build entry points, which fail silently outside `make test`.
- **Medium risks:** R2 (stale string module paths), R3 (singleton duplication), R4 (chat turn state), R5 (persisted and wire shapes), R6 (CSS order).
- **Findings with low or no risk:**
  - S4 (the markdown-editor helpers are correctly placed).
  - S5, S7 and S8 (all placements correct).
  - S9 (incidental duplication).
  - S11 (churn note only).
  - S2, S3, S6 (judgement calls, Low).
  - B4 (loud, early failure).
  - C8.
  - The type-only cycle between `raw-view.tsx` and `markdown-editor.tsx` (no runtime effect).
- **Net for the restructure:** the layout violations themselves (S1-S3) carry little risk. The danger is mechanical: R1 and R2 are not covered by `make test`. Recommended gates: `make typecheck`, both test targets, `make check-build`, and a server start. Keep `paths.ts`, `server.ts`, `src/skills`, `src/fixtures` and `ui/index.html` with `app.tsx` and `styles.css` pinned.

---

## Software-Architecture Recommendations

> Verbatim output from `software-architect`. `A#` recommendations ordered by impact, each cross-referencing upstream
> findings, plus `F#` behavior-changing follow-ups deferred from this pure restructure.

**Bottom line:** the current tree already matches the owner's goal almost everywhere, including the precedents D-1, D-7, D-12, D-14, D-15, D-21 and D-22. Only two layout changes are warranted:
- one file-pair move (A1)
- one import redirect (A2)

The real value of the restructure is in what it must *not* move or duplicate (A3 to A6). Most of those hazards are invisible to `make test`. I checked the tree, importers and precedents with grep and by reading source (the evidence is listed at the end). I did not run the build or the tests.

---

### (1) Layout moves the restructure should make

**A1: Move the fake-claude pair out of `claude-cli/` into `server/chat/components/`**
- **Addresses:** S1, B9, R2 (S1 part), S10 item 2.
- **Principle:** High cohesion and dependency direction.
  - A component folder should hold one module plus the helpers only it imports (D-21).
  - Today `sessions.test.ts` and `claude-backend.test.ts` reach into the `claude-cli` component for a shared helper. So `claude-cli/` cannot move without dragging its siblings' tests along.
- **Current state (verified by grep):** `fakeClaudeOnPath` has three importers:
  - `chat/sessions/sessions.test.ts:10` (`'../claude-cli/fake-claude-on-path'`)
  - `chat/claude-backend/claude-backend.test.ts:8` (same path)
  - `chat/claude-cli/claude-cli.test.ts:9` (`'./fake-claude-on-path'`)

  `fake-claude-on-path.ts:18` runs `copyFile(join(import.meta.dir, 'fake-claude.ts'), ...)`, so the pair must stay together as siblings. Nothing else references `fake-claude.ts`. It has no relative imports: only `node:fs`, and a `#!/usr/bin/env bun` shebang. Its git mode is 100644, and the helper `chmod`s the copy, so a `git mv` does not change how it runs.
- **Recommended change:**
  ```
  src/server/chat/components/
    test-model.ts              (existing, D-7)
    fake-claude-on-path.ts     <- git mv from chat/claude-cli/
    fake-claude.ts             <- git mv from chat/claude-cli/ (same folder, same commit)
  imports:
    sessions.test.ts, claude-backend.test.ts: '../components/fake-claude-on-path'
    claude-cli.test.ts:                      '../components/fake-claude-on-path'
  README "claude-cli/" bullet: drop the fake-claude.ts sentence; add it beside the test-model.ts bullet
  ```
- **Rationale:** this is exactly the D-7 rule with the D-21 revisit criterion firing ("a helper gains a second importer"). The helper has three importers across three chat components, so `chat/components/` is the lowest covering scope. `server/components/` would be too wide, because no test outside chat uses it.
- **YAGNI evidence:** three current importers in three components, plus an existing precedent (`test-model.ts`) for the same shape. This moves existing code and adds no new abstraction.
- **Simpler version considered:** leaving it in place. That does not satisfy S1, because `claude-cli/` would still not be self-contained.
- **Risk if deferred:** Low (R2, R7). This is an ownership smell only, and the tests stay green either way.

**A2: Import `ClaudeMode` from `shared/wire` directly, and drop the pass-through re-export in `command-line.ts`**
- **Addresses:** S3 (the `ClaudeMode` half), B5 (the "split ownership" bullet), R7.
- **Principle:** Dependency direction and single source of truth.
  - `chat/agent/agent.ts:7` and `chat/claude-backend/claude-backend.ts:5` are feature components. They depend upward on an entry-point helper (`../../command-line`) only to reach a type that lives in the shared package.
  - `agent-host.ts:5` does the same.
- **Current state (verified):**
  - `ClaudeMode` is defined once, at `shared/wire.ts:72`.
  - `command-line.ts:4` imports it, and `command-line.ts:6` re-exports it.
  - The only importers of the re-export are `agent-host.ts`, `chat/agent/agent.ts` and `chat/claude-backend/claude-backend.ts`. There is no test importer.
- **Recommended change:**
  ```
  agent-host.ts:                          import type { ClaudeMode } from '../shared/wire';
  chat/agent/agent.ts:                    import type { ClaudeMode } from '../../../shared/wire';
  chat/claude-backend/claude-backend.ts:  import type { ClaudeMode } from '../../../shared/wire';
  command-line.ts: keep its own `import type { ClaudeMode }`; delete `export type { ClaudeMode };`
  ```
- **Rationale:** chat then depends only on sibling features' domain modules, `server/components/`, and `shared/`. It no longer depends on the package's command-line parser. The change is type-only, so it has zero runtime effect.
- **YAGNI evidence:** it resolves S3's named dependency-direction finding with the smallest possible edit, and it removes one export rather than adding one.
- **Simpler version considered:** only redirecting the imports and keeping the re-export. That leaves a dead second path to the type that a future file could import again. Deleting it costs one line.
- **Risk if deferred:** Low (R7).

### (2) What the restructure must pin or guard

**A3: Pin the location-anchored files, and gate on more than `make test`**
- **Addresses:** R1 (High), B1, B2, B3, B4, S10 items 1, 3, 4 and 6, R6 (the skills shape).
- **Principle:** Stable entry points and the composition root (D-2).
  - These files are addressed by string paths: in the Makefile, package.json, `SRC`-relative joins, the HTML `src`/`href` values, `import.meta.dir` and macro/text imports.
  - tsc does not check them, and `make test` does not execute them.
- **Pinned in place. Do not move or rename:**
  ```
  src/server/paths.ts            SRC = resolve(import.meta.dir, '..')   (D-3; paths.test.ts guards only this)
  src/server/server.ts           Makefile build line, package.json "server", check.ts 'server/server.ts'
  src/server/scripts/check.ts    package.json script path
  src/server/agent-host.ts       composition root (single EventBus/Sessions instance, C1 preamble)
  src/ui/index.html + app.tsx + styles.css   './app.tsx', './styles.css', '../ui/index.html'
  src/ui/test-setup.ts           Makefile --preload path
  src/skills/**                  <name>/SKILL.md shape required by appSkills; keys = 3pitor://skills/<key>
  src/fixtures/workspace         join(SRC, 'fixtures/workspace') in workspace.ts and two tests
  chat/agent/system-prompt.md    moves only together with agent.ts (text import)
  workspace-config/app-skills.macro.ts   moves only together with workspace-config.ts (macro import)
  src/server/text-imports.d.ts, src/ui/css.d.ts   ambient; must stay under src/ (tsconfig include)
  ```
- **Guard:** run `make typecheck`, `make test`, `make check-build` (the only guard for the embedded skills, B2), and one server start, after the moves and before the last commit.
- **YAGNI evidence:** R1 is rated High, and six-plus string-addressed paths break silently today.
- **Simpler version considered:** relying on `paths.test.ts` alone. That covers only `SRC`'s targets and misses the server.ts, HTML and skills-shape moves (B1, B2).
- **Risk if deferred:** the binary ships without skills, or startup fails, while CI stays green (R1).

**A4: Keep every module singleton single. Do not split `markdown-editor.tsx`, and do not re-home `json-file.ts`**
- **Addresses:** C1, C6, B6, R3, S4 (the optional split), S7.
- **Principle:** High cohesion. State and the code that must share its identity belong in one module.
  - In `json-file.ts`, the `pending` map serialises writes per path, and duplicating it would let two queues share `${path}.${pid}.tmp`.
  - In `markdown-editor.tsx`, `undoManagers`, `rawFormatters` and the PluginKeys `highlightsKey`, `pinnedKey` and `rawKey` are shared between the exported `mergeMarkdown` (called from documents.tsx) and the component.
  - In `shared/markdown.ts`, `schema` identity matters to ProseMirror.
- **Recommended stance:** the placements are correct today (S4, S7).
  - `raw-view.tsx`, `raw-formatting.ts` and `task-items.ts` are helpers that only `markdown-editor.tsx` imports (plus its own tests). Under D-21 they stay in `documents/markdown-editor/`.
  - Do not create a `raw-view/` component folder. Do not extract `mergeMarkdown`. Do not copy `json-file.ts` into feature folders.
- **Guard:** after the restructure, check that each of these greps returns exactly one definition site:
  - `grep -rn "const pending = new Map" src`
  - `grep -rn "undoManagers = new" src`
  - `new PluginKey`
  - `new Schema`
- **YAGNI evidence:** R3 rates the severity Critical for json-file, because user state on disk would be corrupted. The guard is a grep, not a structure.
- **Simpler version considered:** n/a. "Don't move it" is already the simplest option.
- **Risk if deferred:** silent corruption of `.3pitor/session.json` or `view.json`, and silent loss of undo separation (R3).

**A5: Update the unchecked string module paths, and do not reorder side-effect imports**
- **Addresses:** R2, R6, S10 items 5 and 7, S4 (move safety), B3 (CSS order).
- **Principle:** hidden coupling through strings. These edges exist but are not part of the type-checked dependency graph.
- **Current state (verified):** the only relative `mock.module` or dynamic `import()` strings are in `ui/documents/documents/documents.test.tsx`:
  - line 229: `await import('../markdown-editor/markdown-editor')`
  - line 231: `mock.module(...)` with the same path
  - line 251: `mock.module(...)` with the same path

  The other `mock.module` calls use package names. A1 does not touch this file, so it needs no edit, but it needs a guard in case scope grows.
- **Guard:**
  - Run `grep -rn -e "mock.module('\." -e "import('\." src` after the moves.
  - When rewriting import lines, keep each file's import order byte-for-byte, apart from the path text. This matters for the `prosemirror-*` CSS placed before `./markdown-editor.css`, and for `app.tsx`'s component CSS order. Happy-dom cannot detect a cascade change.
- **YAGNI evidence:** R2 rates this Medium, with a near-certain miss if the editor moves. The guard costs nothing.
- **Risk if deferred:** a stale mock path makes a test pass for the wrong reason (R2), or the editor renders slightly differently (R6).

**A6: Keep the chat trio together, keep `useDocuments` as one instance, and keep the persisted and wire literals byte-identical**
- **Addresses:** C2, C3, C5, B7, B8, R4, R5, S6.
- **Principle:** High cohesion around shared mutable state.
  - `TurnTexts` is the contract among `chat/tools`, `chat/sessions`, `chat/agent` and `chat/claude-cli/mcp-endpoint`. The abort gate `aborted ? {} : editedTexts(turn)` sits in sessions.
  - `beginTurn` and `applyEdited` pair on refs inside one `useDocuments()` instance that `app.tsx` wires into chat.
- **Recommended stance:**
  - Leave `tools/`, `sessions/`, `agent/` and `claude-cli/` under `server/chat/` (D-6).
  - Leave `useDocuments` where it is, with one call site in `app.tsx`.
  - Do not split `shared/wire.ts` per feature.
  - Do not rename `.3pitor/view.json`, `.3pitor/session.json`, the `data-progress`, `data-task` and `data-session` part names, or any `/api/...` or `/ws/events` literal.
- **YAGNI evidence:** R4 and R5 both rate this Medium. The failure modes are silent: the UI uses `api<any>`, and the stored state is cast without validation.
- **Risk if deferred:** orphaned on-disk user state, or edits merged against the wrong base (R5, C5).

### (3) Behavior-changing follow-ups to defer (out of scope for a pure restructure; D-16 precedent)

These are ordered by risk. None of them depends on the layout.
- **F1 (C2, R4, High):** serialise the `TurnTexts` mutations in the file tools.
  - `Edit` does a read, then an `await`, then a write, so parallel `Edit`/`Highlight` calls can silently lose an edit while the model is told "edited".
  - Parallel calls arrive from the AI SDK fan-out, and in CLI mode from concurrent MCP POSTs.
  - The prior plan already lists this.
- **F2 (C7, R8):** give `writeDocument`, `createEntry` and `moveEntry` in `server/documents/documents.ts` the same guarantees as `writeJson`: ordered, temp-and-rename writes, and `wx`/no-clobber on create and move.
  - Reuse the existing `server/components/json-file.ts` pattern rather than adding a new abstraction. Only one other writer exists today.
- **F3 (C3):** honour `abortSignal` inside the file tools. This is latent today because of the sessions gate.
- **F4 (C4):** isolate EventBus listeners from each other with a try/catch per listener, and scope events per session. This is latent, because there is one listener kind today.
- **F5 (B7, C8):** validate the stored `view.json` on read, and sequence or version the view-state PUTs, so a stale PUT cannot win.
- **F6 (B8, S9):** typed response shapes for `/api/sessions`, cancel and workspace-config, plus shared constants for the stream-part names.
  - This stays under D-22's trigger: "a server/UI shape mismatch ships".
- **F7 (B1, B2, R1):** add `make check-build` to CI or `make test`. Confirm how `Bun.Glob.scanSync` behaves on a missing `src/skills`, so a bad move fails the build instead of shipping zero skills.
  - This is a build and gate change, not an app behavior change, but it is outside a file-move restructure.

---

#### Software Architecture Recommendations Summary

- **Upstream findings addressed:** all 36 are assessed: S1–S11, B1–B9, C1–C8 and R1–R8.
  - **Moves:** A1 (S1, B9) and A2 (S3 part, B5 part).
  - **Guards:** A3 (R1, B1–B4, S10), A4 (C1, C6, B6, R3, S4, S7), A5 (R2, R6, S10) and A6 (C2, C3, C5, B7, B8, R4, R5).
  - **Follow-ups:** F1–F7 (C2, C3, C4, C7, C8, B7, B8, R8).
- **Intentionally not addressed, with reasons:**
  - **S2 (`documents.test.ts` imports `postName` from `chat/tools`):**
    - The test is a deliberate two-feature agreement test ("the chat tools name every file the path grammar accepts the same way").
    - `postName` depends on the private `resolvePost` in tools.ts, and has one production user.
    - Moving it to `server/components/` would drag production helpers out of tools.ts to satisfy a test import.
    - Flipping the test into tools.test.ts just reverses the reach.
    - Leave it. The trigger is a second *production* importer of `postName` outside chat.
  - **S3 (the workspace-config half):**
    - `loadWorkspaceConfig`, `appSkillText`, `APP_SKILL_PREFIX` and the types are that feature's domain API, consumed by a peer feature.
    - D-14 already decided to keep it a separate single-component feature, together with its routes and macro (D-21).
    - Moving it under chat or into components would split it from its routes. Revisit on D-14's criterion.
  - **S5, S7, S8:** negative results, with correct placements confirmed.
    - `fake-documents-api.ts` is used by `app.test.tsx` at the package root and by two documents tests, so `ui/components/` is the lowest covering scope.
  - **S9:** covered by the D-22 deferral.
  - **S11:** a churn-attribution note only.
  - **B4:** fails loudly and early. It is covered by the A3 pin list.
- **Key themes:**
  1. The layout already matches the owner's package, feature, component and components/ rules. The remaining gap is one misplaced test helper and one upward type import.
  2. The architectural risk of this restructure is hidden coupling through strings and module identity, not bad boundaries: `SRC`, the HTML entry, the macro, `mock.module` strings and module singletons.
  3. The real design debt is unsynchronised shared per-turn state (C2, C5, C7). That debt is behavioral and belongs in follow-ups.
- **Highest-impact recommendations:** A3 (pin plus the check-build and server-start gate), A4 (single singletons, no editor split), then A1 (the only true placement violation).
- **Deferred to `system-architect`:** None. Everything is inside one deployable, a Bun binary that serves the UI bundle.
  - The claude CLI subprocess and its MCP endpoint are an external-tool integration. No finding asks to change that boundary.
- **Deferred (YAGNI):**
  - **`ui/view-state/` feature extracted from `documents.tsx` and `app.tsx` (S6).**
    - Anti-pattern: speculative module split. The name is not duplicated, because the UI has no view-state module at all.
    - Extracting it is a code extraction from a 508-line file that touches the C5 turn refs and the R5 persisted shape, not a move.
    - Trigger: a second UI writer or reader of view state outside documents and app.
  - **A `raw-view/` component folder, or other splits of `markdown-editor.tsx` (S4).**
    - Anti-pattern: best-practice symmetry. D-21 places helpers that only one component imports inside that component's folder, and a split risks C6.
    - Trigger: `raw-view` or `raw-formatting` gains an importer outside `markdown-editor`.
  - **A shared types module for `Ask` and `SelectionAsk` to break the type-only cycle between `raw-view.tsx` and `markdown-editor.tsx` (S4).**
    - Anti-pattern: an abstraction with no runtime effect. The cycle is type-only.
    - The types are also imported by `app.tsx`, `documents.tsx` and two tests, so a new file would mean five import edits for no measured friction.
    - Trigger: the cycle causes a bundler or type error, or a third module needs the types without the editor.
  - **`postName` in `server/components/` (S2):** see "not addressed" above. Trigger: a second production importer.
  - **Route and part-name constants in `src/shared` (S9, B8):** D-22 precedent. Trigger: a mismatch ships.
  - **An import-boundary lint:** the prior-plan deferral stands. Trigger: a second non-root cross-package import appears.

**Verification performed:**
- **Tree listing:** `find src` (excluding .data, skills and fixtures).
- **Greps:** importers of `fake-claude-on-path`, `ClaudeMode`, `postName`, `workspace-config/workspace-config`, `fake-documents-api`, `components/test-model`, `Ask`/`SelectionAsk`, and every `mock.module` or `await import(` site.
- **Files read:**
  - `tools.ts:55-80` and its imports
  - `command-line.ts`
  - `app.tsx` imports
  - `documents.test.ts:95-110`
  - the README section "How `src/` is laid out"
  - `docs/changes/restructure-by-feature/change-plan.md` and D-7, D-14, D-21 in `artifacts/change-decision-log.md`
- Unverified: could not confirm that A1 and A2 compile and pass, or that the A3 gates are green today, because I did not run `make typecheck`, `make test`, `make check-build` or a server start.

---

## System-level concerns deferred

None. `software-architect` found no finding that crosses a service boundary, bounded-context seam, or trust boundary:
everything runs in one deployable, a Bun binary that serves the UI bundle. The claude CLI subprocess and its MCP
endpoint are an external-tool integration, and no finding asks to change that boundary.

---

_End of report. Finding IDs (`S#`, `B#`, `C#`, `R#`, `A#`, `F#`) are stable for the life of this report — cite them in
tickets, ADRs, and follow-up work._

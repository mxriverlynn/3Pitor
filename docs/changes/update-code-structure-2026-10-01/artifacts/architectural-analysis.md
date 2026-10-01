---
title: "Architectural Analysis: src/ (server, ui, shared)"
focus_area: "src/server, src/ui, src/shared, with one layer out to Makefile, package.json, tsconfig.json, src/skills, src/fixtures"
size: "medium — three adjacent packages with async state; the concern is move safety, not a security, data, or ops review (D-2)"
roster: "structural-analyst, behavioral-analyst, concurrency-analyst, risk-analyst, software-architect"
git_available: "yes"
generated: "2026-10-01"
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

This report checks `src/` against the owner's package → feature → component layout, and names what would make moving
files unsafe. It builds on the
[2026-09-30 analysis](../../update-code-structure-2026-09-30/artifacts/architectural-analysis.md), and reuses its
findings wherever the code has not changed.

- **Executive Summary.** The verdict, the findings that matter, and the one recommended move. Read this if you have two
  minutes.
- **Structural, Behavioral, and Concurrency Analysis.** Each is one specialist's full findings, with file paths and
  code. Finding IDs (`S#`, `B#`, `C#`) are stable and can be cited.
- **Risk Assessment.** `R#` items that score the findings, both as they stand and as hazards to a move.
- **Software-Architecture Recommendations.** `A#` recommendations, each labeled as a pure move or a deferred behavior
  change.
- **System-level concerns deferred.** Findings that concern a contract with something outside the codebase.

> Sizing and roster: this run was classified **medium** and dispatched the structural, behavioral, concurrency, risk,
> and software-architect agents.

> Sections not part of this run:
>
> - No Security, Data-Engineering, DevOps, or On-Call section: a pure restructure would defer all of their findings
>   (D-2).
> - No Codebase Map: the area is familiar from two earlier change sets.
> - No System-Architecture section: nothing crosses a deployable unit, because the UI is bundled into the server
>   binary.

---

## Executive Summary

**Focus area:** `src/server`, `src/ui`, and `src/shared` (112 files), traced one layer out into the Makefile,
`package.json`, `tsconfig.json`, `src/skills`, and `src/fixtures`. The analysts concentrated on the 125 commits since
the previous run.

**Bottom line:** The tree still follows the layout almost everywhere. Since the last run, one file has landed in the
wrong place: `ui/popups/link-popup/`, which only the markdown editor uses. Moving it is safe and mechanical. The real
risk in any move is files that are found by their location in ways the type-checker cannot see.

**Most critical findings:**

- **S1:** `documents/markdown-editor/markdown-editor.tsx` imports `popups/link-popup/`, its only user. It is the one UI
  import between features outside `app.tsx`, and it makes the README's "app.tsx is the only file that wires features
  together" false.
- **R1 (S4, B1, B2, B9, B11, B12):** Some paths fail silently if a file moves. These are the `SRC` anchor in
  `paths.ts`, the skills macro, four `mock.module('../markdown-editor/markdown-editor')` strings in
  `documents.test.tsx`, the CSS read in `markdown-editor.test.tsx`, the `../../styles.css` text import in
  `file-tree.test.tsx`, and the new `server.test.ts`, which spawns `server.ts` from its own folder.
- **R2 (B5, C1, C5):** Correctness depends on single module instances: the `json-file.ts` write queue, the editor's
  `undoManagers` map, and the one call each of `useDocuments` and `useHostEvents`. A move that copied any of them would
  break silently.
- **R3 (B7):** The new workspace watcher ignores `.3pitor/` writes only because it shares the private `isHiddenName`
  in `documents.ts`. Splitting or copying that function would echo the app's own state writes back as
  `documents-changed`.

**Highest-impact recommendations:**

- **A1:** Move `link-popup` into `documents/markdown-editor/`. Then move `popups/components/anchored-bubble` up to
  `ui/components/anchored-bubble/`, because its users would span two features. That is four import edits and no
  behavior change.
- **A2:** Leave every pinned file, every pair that must move together, and every single instance where it is.
- **A3 and A4:** Keep the server's imports between features, as the precedent allows. Bring the README's file list up
  to date.

**Clean dimensions and omitted domains:** No new path arithmetic in the new modules, and no UI file imports the server.
Nothing new belongs in `src/shared`. No deadlocks, and the new disk-sync guards in `documents.tsx` hold (C5). The latent
races (C1 note edits, C2, C6) are behavior changes and are out of scope.

---

## Structural Analysis

> Verbatim output from `structural-analyst`. `S#` findings on module boundaries, coupling, dependency direction,
> abstractions, and duplication.

Structural analysis of src/ui, src/server and src/shared, one layer out to Makefile, package.json, tsconfig.json, src/skills and src/fixtures. I built the import graph with grep over every relative import, `mock.module`, `import()`, `import.meta`, text import and macro site. I read the prior analysis (docs/changes/update-code-structure-2026-09-30/artifacts/architectural-analysis.md) and re-checked its findings against current code. I did not run tsc or the tests.

Short answer: two placement violations remain, and one stale prior finding is now resolved. Nothing in src/ui imports src/server, and nothing in the new files adds path arithmetic.

**S1: link-popup is a cross-feature import from documents into popups (new)**
- **Dimension:** Boundaries / Coupling
- **File(s):** src/ui/popups/link-popup/link-popup.tsx, src/ui/documents/markdown-editor/markdown-editor.tsx:38
- **Finding:**
```
import { LinkPopup } from '../../popups/link-popup/link-popup';
```
  `LinkPopup` has one importer, markdown-editor.tsx. The only other file that names it is its own test. It imports `../components/anchored-bubble`, which has three users, all in popups (link-popup, question-popup, selection-popup). This breaks the README claim that `app.tsx` is the only UI file wiring features together. app.tsx uses question-popup and selection-popup, not link-popup. The other popups are used only by app.tsx, which fits the README claim. link-popup is the odd one out.
- **Placement options:** the owner's rules allow two placements.
  - (a) Keep it a popups component and accept a documents-to-popups feature dependency.
  - (b) Treat it as a helper only markdown-editor uses and move it to `ui/documents/markdown-editor/link-popup.tsx` plus its css and test. Then it would import `../../popups/components/anchored-bubble`, a package-level component, which is allowed. This removes the cross-feature import but adds a feature-to-feature import of a components folder, so it stays an asymmetry.
  - Option (b) fits "the helpers only it uses" best. Note `link-popup.css` is imported by the component itself, so it moves with the file.
- **Move safety:** all imports are static relative ones, so `tsc --noEmit` catches every break. There is no `mock.module` of link-popup.
- **Impact:** medium. This is the only new cross-feature UI import.

**S2: Remaining server cross-feature imports (known; status confirmed and one prior item resolved)**
- **Dimension:** Dependency Direction
- **File(s):** src/server/chat/agent/agent.ts:17,20, src/server/chat/tools/tools.ts:17, src/server/chat/sessions/sessions.ts:7, src/server/scripts/check.ts:7, src/server/documents/documents.test.ts:6
- **Finding:**
```
import { loadWorkspaceConfig, ... } from '../../workspace-config/workspace-config';   // agent.ts, tools.ts, tools.test.ts, agent.test.ts
import { ... } from '../../events/events';                                              // agent.ts, sessions.ts, sessions.test.ts, agent.test.ts
import { ... } from '../workspace/workspace';                                           // scripts/check.ts
import { postName } from '../chat/tools/tools';                                         // documents.test.ts:6
```
  - Unchanged since the prior run: chat to workspace-config (prior S3), chat to events, documents.test to chat/tools (prior S2). Reused as is.
  - `check.ts` imports `workspace` as a sibling. That is a script, not a feature.
  - `events` is a stable leaf. It imports only shared/wire.
  - `workspace-config` is imported by `agent` and `tools`, never by other chat components, so it is a judgement call on whether it is part of chat.
  - Resolved since the prior run: the `ClaudeMode` re-export from `command-line.ts` is gone. `ClaudeMode` is now imported from shared/wire everywhere (agent-host.ts:5, agent.ts:16, claude-backend.ts:6). The `postName` import from `documents.test.ts` is still a test-only reach into chat.
- **Impact:** medium. `agent` and `tools` couple to workspace-config internals (`APP_SKILL_PREFIX`, `appSkillText`).

**S3: Prior S1 is fixed**
- **Dimension:** Boundaries
- **File(s):** src/server/chat/components/fake-claude-on-path.ts, fake-claude.ts, test-model.ts
- **Finding:** the fake `claude` helpers now sit in `chat/components/`, and sessions, claude-backend and claude-cli tests import `../components/fake-claude-on-path`. That is the correct scope. The move hazard persists:
```
await copyFile(join(import.meta.dir, 'fake-claude.ts'), join(bin, 'claude'));
```
  `fake-claude.ts` must stay in the same folder as `fake-claude-on-path.ts`. Nothing else imports `fake-claude.ts`.
- **Impact:** a negative result for placement, and a standing move hazard.

**S4: Path arithmetic and string paths that tsc does not catch (move hazards; new items marked)**
- **Dimension:** Coupling (implicit)
- **File(s):** see the list below
- **Finding:** check each of these after any move.
  1. `src/server/paths.ts:5`: `export const SRC = resolve(import.meta.dir, '..');`. `paths.test.ts:9` checks `['server/server.ts', 'ui/index.html', 'skills', 'fixtures/workspace']` under `SRC`. The file must stay directly in src/server/. Consumers of `SRC`:
     - workspace.ts:6 (`join(SRC, 'fixtures/workspace')`)
     - app-skills.macro.ts
     - scripts/check.ts
     - the agent, workspace-config and routes tests (`join(SRC, 'fixtures/workspace')`)
  2. **New:** `src/server/server.test.ts:10,46` runs `join(import.meta.dir, 'server.ts')`. It is a sibling-of-entry-point test, so it must stay next to server.ts. It also imports `USAGE` from `./command-line`, so `command-line.ts` must stay a sibling or the import must be updated.
  3. **New:** `src/ui/documents/markdown-editor/markdown-editor.test.tsx:1500,1515` reads `` `${import.meta.dir}/markdown-editor.css` ``. The css must stay beside the test. The test is not covered by tsc, and the failure is at runtime only.
  4. **New:** `src/ui/documents/file-tree/file-tree.test.tsx:6-7` has text imports:
```
import appCss from '../../styles.css' with { type: 'text' };
import fileTreeCss from './file-tree.css' with { type: 'text' };
```
     `../../styles.css` is relative to depth (`src/ui/styles.css`), so moving the test or styles.css needs a path edit. `src/ui/index.html` also hardcodes `./styles.css` and `./app.tsx`, so those two files must stay at the ui root.
  5. `src/ui/documents/documents/documents.test.tsx:305,307,327,1090,1093,1117` has `await import('../markdown-editor/markdown-editor')` and `mock.module('../markdown-editor/markdown-editor', ...)` strings. They are unchecked by tsc and unchanged from the prior run. Moving markdown-editor (or documents) without editing these makes the mock miss silently.
  6. `agent.ts` and `agent.test.ts` import `./system-prompt.md` as text. It must sit beside `agent.ts`. `src/server/text-imports.d.ts` is global.
  7. `app-skills.macro.ts` is imported by `workspace-config.ts` with `{ type: 'macro' }`. The pair must move together. The macro reads `src/skills` through `SRC`, so it does not depend on its own depth.
  8. `server.ts:7` imports `'../ui/index.html'`, the only server-to-ui link.
  9. `Makefile`:
     - `src/server/server.ts` (build)
     - `bun test src/server src/shared` and `bun test --preload ./src/ui/test-setup.ts src/ui`
  10. `package.json`:
     - `src/server/server.ts`
     - `src/server/scripts/check.ts`
  11. `tsconfig.json` has `"include": ["src"]` and no `paths`, so no aliases or paths need updating.
  12. `test-setup.ts` stays at the ui root because the Makefile preloads it.
- **Impact:** high for movers. Only 1-5 are silent under typecheck. The entry points and scripts/check.ts must stay put to leave Makefile and package.json unchanged.

**S5: New UI helpers are correctly placed (negative results)**
- **Dimension:** Boundaries
- **File(s):** src/ui/components/panel-resizer/, src/ui/documents/file-tree/entry-name.ts, src/ui/documents/markdown-editor/highlight-outline.ts, raw-syntax.ts, raw-formatting.ts
- **Finding:**
  - `panel-resizer/` is imported by `app.tsx` only, plus its own test. It sits in `ui/components/` although it has a single user, the entry point. The rule would also allow it at the ui root or in the layout feature, but it is not a violation. By the rules, `ui/components/` is the lowest scope covering the entry point.
  - `entry-name.ts` is imported only by `file-tree.tsx` and its own test, so it is correctly in the file-tree component folder.
  - `highlight-outline.ts` is imported by `markdown-editor.tsx` and `markdown-editor.test.tsx` (the test imports it directly).
  - `raw-syntax.ts` is imported by `raw-view.tsx` only. It imports `{ HEADING, LIST, QUOTE, scan } from './raw-formatting'`. `raw-formatting` is imported by markdown-editor.tsx and raw-syntax.ts. All three are single-component helpers in one folder. This is correct. The README says "helpers only it imports", and this still holds.
  - The type-only cycle from prior S4 is unchanged: `raw-view.tsx:7` imports types from `./markdown-editor`, which imports `./raw-view`. Reused.
  - The markdown-editor folder now has 9 modules, with `markdown-editor.tsx` the highest-churn file (41 touches in 90 days, 48 for its test). I did not read the commit messages.
  - Splitting raw-view, raw-formatting and raw-syntax into their own component folder would be an owner option, not a violation. It would turn the `./raw-formatting` imports into cross-folder imports.
- **Impact:** low. The placement is sound.

**S6: Cross-package duplication (re-checked; none belongs in src/shared)**
- **Dimension:** Duplication
- **File(s):** src/ui/documents/file-tree/entry-name.ts, src/server/documents/documents.ts:26-34, src/server/chat/tools/tools.ts:194,206
- **Finding:** the rules look related, but they differ in intent. The UI `UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g` sanitises a typed name (Windows-forbidden characters). The server `checkPath` rejects `\` and NUL and hidden segments. `tools.ts` has its own `.md` and "." checks. Server `documents.ts` and `tools.ts` both repeat `endsWith('.md')` and `startsWith('.')`. These are two server features with their own grammar (per the comment "narrower than the chat tools' rule"), so I treated it as incidental. The ui `entry-name.ts` fixes `.md` as a suffix, the same string the server enforces, which is implicit coupling by convention. There is no wire constant. The `/api/...` path strings in the UI still repeat those in the server routes (prior S9, unchanged). No duplicated code exists that should move to src/shared.
- **Impact:** low. The implicit coupling is a magic string.

**S7: The README is stale against the current files**
- **Dimension:** Boundaries
- **File(s):** README.md:15-176
- **Finding:** README line 152 documents `panel-resizer`. A grep for `link-popup`, `entry-name`, `highlight-outline`, `raw-syntax` and `server.test` finds nothing in the README. Its statement that `app.tsx` is "the only UI file that wires features together" is contradicted by S1.
- **Impact:** low. It is documentation drift, not code.
- **Unverified:** I read only README lines 15-60 plus the grep matches, because the rest was not needed for the file inventory.

**S8: Feature naming and shared/ (re-checked)**
- **Dimension:** Boundaries
- **File(s):** src/server/view-state/, src/server/workspace-config/, src/server/workspace/, src/ui/popups/, src/ui/events/
- **Finding:** unchanged from the prior run (S6). The server has `view-state`, `workspace-config` and `workspace`, with no UI folders of the same name. `/api/view-state` is called from `ui/documents/documents/documents.tsx`. The UI has `popups/` with no server counterpart, which is fine, since it is UI-only. `ui/events/host-events.ts` pairs with `server/events/`. `src/shared/*` has no imports from either package. No UI file imports server files: the only `../server` or `../ui` import is `server.ts:7` (`../ui/index.html`).
- **Impact:** low. A judgement call for the owner on the view-state name.

### Structural Summary

- **Focus area analyzed:** src/server, src/ui and src/shared by import graph, with one layer out (Makefile, package.json, tsconfig.json, src/skills, src/fixtures). Prior findings were reused where code is unchanged: S2 (documents.test to chat/tools), the workspace-config/events coupling, the S4 type cycle, S6 naming and S9 duplication. Prior S1 is resolved.
- **Key concerns:**
  1. S1: `markdown-editor.tsx` imports `popups/link-popup`, a cross-feature import that is new. It breaks the README claim that only app.tsx wires features. The lowest-scope fix is to move it under the markdown-editor component.
  2. S4 items 2-5: silent path hazards that tsc will not catch. Chiefly the `mock.module` and dynamic `import()` strings in documents.test.tsx, the `import.meta.dir` css read in markdown-editor.test.tsx, and the `../../styles.css` text import in file-tree.test.tsx. `paths.ts` and the entry points stay put.
  3. S2: chat to workspace-config and events remain. `ClaudeMode` is now imported from shared.
- **Well-structured areas:** `server/components` (json-file, workspace-path), `chat/components` (the fake claude helpers and test-model), `ui/components` (api, menu, agent-actions, panel-resizer), `ui/documents/components/paths.ts`, `popups/components/anchored-bubble`, and the new file-tree and markdown-editor helpers. src/shared is clean.
- **Skipped dimensions:** none. Churn was not attributed to bug fixes versus features (only the file counts, plus recent commit subjects, for the UI). I did not run tsc or the tests.

---

## Behavioral Analysis

> Verbatim output from `behavioral-analyst`. `B#` findings on data flow, error propagation, state management, and
> integration boundaries.

Behavioral analysis of src/ for the package → feature → component restructure (Bun server, browser React UI, shared code, and the Makefile/package.json/skills/fixtures around them).

Method: I read the code and re-read the prior B1-B9 text in docs/changes/update-code-structure-2026-09-30/artifacts/architectural-analysis.md. I diffed the commit history since 2026-09-29 and read the new watcher paths. I did not run the build, the tests, or a move.

Bottom line: the live file watching adds no path-from-location behavior. The path-anchoring risks from the prior run (SRC, the skills macro, text import, HTML entry) are unchanged. One prior finding is stale because the fake-claude helper has moved.

## Reused from the prior run (code unchanged; I re-read it)

**B1: SRC anchor, fixtures and `.data` paths (prior B1) — unchanged and still the main silent hazard**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/paths.ts, src/server/workspace/workspace.ts, src/server/workspace-config/app-skills.macro.ts, src/server/scripts/check.ts, src/server/paths.test.ts
- **Finding:**
```ts
export const SRC = resolve(import.meta.dir, '..');
```
```ts
const FIXTURE = join(SRC, 'fixtures/workspace');
export const dataDir = (name: string) => join(SRC, '.data', name);
```
  - **Anchor depth:** SRC is correct only while paths.ts sits directly in src/server/.
  - **Hard-coded names:** `fixtures/workspace`, `.data`, `skills` and `server/server.ts` are string literals under SRC.
  - **Silent failure:** the fixture path is read only inside `cp`, when a workspace is first seeded. With no WORKSPACE set, `chooseWorkspace` returns `process.cwd()` and never reads it.
  - **Guard:** `paths.test.ts` asserts that `server/server.ts`, `ui/index.html`, `skills` and `fixtures/workspace` exist under SRC. It guards the anchor depth and the folder names. It does not guard the literal strings in workspace.ts or in the macro.
  - **Package.json script:** the dev script `WORKSPACE=src/.data/workspace` is a cwd-relative string that must match `dataDir`.
  - **Gitignore:** `.gitignore` ignores `.data/` at any depth, so a moved `.data` stays ignored.
- **Impact:** Medium. If the anchor drifts, seeding and dev workspaces break quietly, and the failure shows up only when a workspace is first seeded.

**B2: Bun macro that embeds src/skills (prior B2) — unchanged**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/workspace-config/app-skills.macro.ts, src/server/workspace-config/workspace-config.ts, Makefile
- **Finding:**
```ts
const dir = join(SRC, 'skills');
for (const path of [...new Bun.Glob('**/*.md').scanSync({ cwd: dir })].sort()) files[path] = readFileSync(join(dir, path), 'utf8');
```
  - **Missing directory:** I did not check whether `scanSync` throws or returns empty on a missing directory. An empty result would give a binary with no app skills and no error.
  - **Key shape:** keys are paths relative to `src/skills`, so `src/skills/<name>/SKILL.md` must keep that shape.
  - **Entry point:** the Makefile line `bun build --compile ... src/server/server.ts` is also location-bound.
  - **Guard:** `make check-build` is the only check that covers the binary, and `make test` does not run it.
  - **Test that stays green:** `workspace-config.test.ts` runs the macro in test mode against the same tree, so it cannot see binary-only breakage.
  - **Skills not restructured by feature:** do not move src/skills under feature folders, because the `<name>/SKILL.md` shape is load-bearing.
- **Impact:** Medium to high for the binary, and `make test` does not cover it.
- Unverified: could not run `bun build` or inspect `Bun.Glob.scanSync` behavior on a missing directory, because I did not execute code.

**B3: HTML entry and UI bundle roots (prior B3) — unchanged in shape; two new UI facts**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/server.ts, src/ui/index.html, src/ui/app.tsx
- **Finding:**
```ts
import homepage from '../ui/index.html';
...
routes: { '/': homepage },
```
  - **Entry points:** `index.html` references `./styles.css` and `./app.tsx`, so those stay at the UI package root. That matches the "entry points stay at package roots" rule.
  - **New fact:** `app.tsx` is the only importer of `host-events.ts`, `panel-resizer` and `file-tree`.
  - **CSS cascade:** every component CSS file is a side-effect import. Reordering imports can change the cascade, and happy-dom tests cannot see that. The new `panel-resizer.css` (`import './panel-resizer.css'`) and `link-popup.css` follow this pattern.
  - **Test coverage:** `server.test.ts` spawns server.ts, which imports `index.html`. It exercises startup, but it checks no UI bundle output.
- **Impact:** Medium. A broken bundle fails at startup, but a CSS order change is silent.

**B4: system-prompt.md text import (prior B4) — unchanged**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/chat/agent/agent.ts, src/server/chat/agent/system-prompt.md, src/server/text-imports.d.ts
- **Finding:**
```ts
import systemPrompt from './system-prompt.md' with { type: 'text' };
```
  - **Move rule:** the prompt must move with agent.ts, otherwise the import fails at load.
  - **Type declaration:** `text-imports.d.ts` is covered by tsconfig `"include": ["src"]`, so it is location-independent as long as it stays under src/.
  - **Guards:** tsc and the agent tests catch a bad specifier loudly.
- **Impact:** Low.

**B5: Singleton write queue in json-file.ts (prior B6) — unchanged**
- **Dimension:** State Management
- **File(s):** src/server/components/json-file.ts
- **Finding:**
```ts
const pending = new Map<string, Promise<void>>();
```
  - **Identity depends on one module instance:** the per-path write queue is shared by the session and view-state writers. Two copies of the file, for example one per feature's `components/` folder, would create two independent queues and two writers racing on the same temp file `${path}.${process.pid}.tmp`.
  - **Other state:** `EventBus` is instance state, created once in `createAgentHost`, so moving it is safe.
- **Impact:** Medium, but only if the file is duplicated. A move that keeps one copy is safe.

**B6: Wire contracts and string literals (prior B7/B8) — unchanged**
- **Dimension:** Integration Boundaries
- **File(s):** src/shared/wire.ts, src/ui/chat/chat/chat.tsx, src/server/view-state/view-state.ts
- **Finding:**
  - **Persisted shapes:** the `.3pitor/view.json` and `.3pitor/session.json` shapes and filenames are persisted in users' workspaces. Moving types out of wire.ts is safe only if the serialized shape stays identical.
  - **Cast without validation:** `view-state.ts` casts with `as ViewState | undefined` and has no runtime check.
  - **Path-coupled regex in chat.tsx:**
```ts
value.replace(/^.*\/\.data\/[^/]+\//, '')
```
    This hard-codes the `.data/<name>/` layout from `dataDir` and is untested.
  - **Duplicated literals:** the `/api/...` routes and the `data-progress`, `data-task` and `data-session` stream part names are duplicated across server and UI. A move cannot break them, but a careless split can desynchronize them.
- **Impact:** Medium.

## New since the prior run

**B7: The workspace watcher is location-independent, but its behavior depends on the workspace path and hidden-name rule**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/documents/documents.ts, src/server/server.ts, src/server/events/events.ts, src/server/events/events.routes.ts, src/shared/wire.ts
- **Finding:**
```ts
const watcher = watch(workspace, { recursive: true }, (_event, filename) => {
  if (filename?.split(/[\\/]/).some(isHiddenName)) return;
  clearTimeout(quiet);
  quiet = setTimeout(settle, 100);
  cap ??= setTimeout(settle, 1000);
});
watcher.on('error', (error) => console.error(`Stopped watching the workspace: ${error.message}`));
```
```ts
watchDocuments(workspace, () => host.events.emit({ type: 'documents-changed' }));
```
  - **Path arithmetic:** none. The watcher watches the runtime `workspace` argument, not anything derived from a source file location. The timers, the debounce state `quiet`/`cap` and the watcher handle are closure-local to each `watchDocuments` call. A file move cannot change its identity.
  - **Hidden-name filter:** it uses `isHiddenName`, which is private to documents.ts (line 21). The same function gates the document list walk (line 72) and path validation (line 30). `.3pitor/` writes, such as session.json and view.json written by json-file.ts, are ignored by the watcher only because of this one function. If a restructure splits `isHiddenName` into a shared component with different behavior, or duplicates it, the app's own state writes would start echoing back as `documents-changed` events. Each echo makes every tab re-list and re-sync the documents. I did not run that scenario.
  - **Silent stop:** an error handler logs and the watcher stays dead. The app runs on without live updates and says nothing to the UI. This is deliberate in the comment ("follows disk again after a restart").
  - **Handle never closed in server.ts:** the return value of `watchDocuments` is discarded in server.ts. This is only a process-lifetime concern, not a move issue.
  - **Wiring site:** `server.ts` is the only place that connects the watcher to `host.events`. Features other than documents and events do not import each other here. `events.ts` imports only `HostEvent` from shared. `HostEvent` is `{ type: 'documents-changed' }` among others in `wire.ts` (line 7).
- **Impact:** Medium. A move is safe if `isHiddenName` stays a single definition, and the documents module and watcher keep sharing it.

**B8: Event socket contract: UI/server agree by literal URL and message shape; a single-socket assumption sits in the UI**
- **Dimension:** Integration Boundaries
- **File(s):** src/ui/events/host-events.ts, src/ui/app.tsx, src/server/events/events.routes.ts, src/server/server.test.ts
- **Finding:**
```ts
ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`);
...
ws.onmessage = (msg) => handler.current(JSON.parse(msg.data));
```
```ts
if (event.type === 'documents-changed') docs.syncWithDisk();
```
  - **Literal duplication:** the `/ws/events` path is hard-coded on both sides. Moving `host-events.ts` or the events folder cannot break it, but a rename can.
  - **Single instance:** the comment says "Call this once, from App: every call opens its own socket." It is not a module singleton. Each caller gets its own socket, so moving the hook is safe.
  - **Untyped parse:** `JSON.parse(msg.data)` is not validated. A malformed frame throws inside `onmessage` and is not caught.
  - **Retry:** reconnect is a fixed `setTimeout(connect, 1000)` with no backoff. `syncWithDisk` runs again on connect, so that is covered by the prior commit "Follow the disk on every documents-changed event, connect, and reload".
  - **Server test:** `server.test.ts` spawns the real server and asserts `'{"type":"documents-changed"}'` over a real WebSocket. It also contains a `Bun.sleep(300)` to let the watcher's startup replay settle. Fixed sleeps like this are what the owner's memory note says to accept for fuzzy limits. The test is timing-sensitive on macOS but does not depend on file location.
- **Impact:** Low to medium.

**B9: server.test.ts is location-coupled and the only test that boots server.ts**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/server.test.ts
- **Finding:**
```ts
Bun.spawnSync(['bun', 'run', join(import.meta.dir, 'server.ts'), ...args], {
```
```ts
const server = Bun.spawn(['bun', 'run', join(import.meta.dir, 'server.ts'), workspace], {
```
  - **Sibling coupling:** the test must stay next to server.ts, because it resolves `server.ts` through `import.meta.dir`. If server.ts stays at the package root (as the owner plans), then the test file stays there too.
  - **What the guard covers:** this is the first `bun test` coverage that boots server.ts. It exercises the `../ui/index.html` import, the macro and the system-prompt text import, all at runtime. That narrows, but does not close, the gap the prior run recorded in B3 ("No test imports server.ts"). It still does not cover `bun build --compile`.
  - **Dependencies:** it spawns `bun` from PATH. It also depends on the "listening on <url>" line shape, which check.ts depends on as well (server.ts has a comment about it).
  - **Failure mode:** if the spawned server crashes at startup, I did not check how `listeningOn` reports it. `stderr` is `'ignore'`, so the real error is hidden.
- **Impact:** Medium. It adds startup coverage, but stderr is discarded.
- Unverified: did not read the body of `listeningOn` past its first lines, because the output was cut off at the helper's start. I did not see how it behaves on early exit.

**B10: fake-claude helper moved to `chat/components/`, so the prior B9 is stale; it still copies itself by sibling location**
- **Dimension:** Integration Boundaries
- **File(s):** src/server/chat/components/fake-claude-on-path.ts, src/server/chat/components/fake-claude.ts, src/server/chat/sessions/sessions.test.ts, src/server/chat/claude-backend/claude-backend.test.ts, src/server/chat/claude-cli/claude-cli.test.ts
- **Finding:**
```ts
await copyFile(join(import.meta.dir, 'fake-claude.ts'), join(bin, 'claude'));
await chmod(join(bin, 'claude'), 0o755);
```
  - **Prior B9:** it described the pair under `claude-cli/`. They now sit in `chat/components/`. The behavior is the same, but all three consumers now import `'../components/fake-claude-on-path'`.
  - **Sibling rule:** the pair must stay together in one folder. fake-claude.ts keeps `#!/usr/bin/env bun`, and the helper puts `dirname(process.execPath)` on PATH so the shebang can find bun.
  - **Self-contained after copy:** fake-claude.ts is copied out of the tree, so it must import only node builtins. A relative import added to it would fail only inside the copy.
  - **`test-model.ts`:** this file is also in `chat/components/`. It calls `mock.module('@ai-sdk/anthropic', ...)`.
- **Impact:** Low to medium, test-only.

**B11: `mock.module` is process-global, and tests pin it to relative specifiers**
- **Dimension:** State Management
- **File(s):** src/ui/documents/documents/documents.test.tsx, src/server/documents/documents.test.ts, src/server/chat/sessions/sessions.test.ts, src/server/chat/components/test-model.ts
- **Finding:**
```ts
mock.module('../markdown-editor/markdown-editor', () => ({ ...editor, replaceMarkdown: realReplace }));
```
```ts
mock.module('node:fs/promises', () => ({ ...fsPromises, readdir: (path, options) => { ... } }));
```
  - **Relative specifiers:** `documents.test.tsx` mocks `'../markdown-editor/markdown-editor'` (lines 307, 327, 1093, 1117). If either file moves, the specifier resolves to a non-existent module path. The mock then fails to replace anything, or throws at load, and the test falls through to the real editor. I did not run this to see which one happens.
  - **Bun global registry:** `bun test src/server src/shared` runs all server test files in one process. `mock.module` is registered in Bun's global module registry. `documents.test.ts` mocks the whole `node:fs/promises` module at top level, with `failingFolder` set per test. `sessions.test.ts` and `test-model.ts` mock `@ai-sdk/anthropic`.
  - **Order sensitivity:** whether one file's mock leaks into another file depends on load order and on how Bun scopes module mocks. A restructure changes directory order. It could change which modules see the mocked `node:fs/promises` when they load. I did not test this.
  - **The `restore` pattern:** the test saves the real function and re-registers it with `mock.module` after the test. That is explicit manual cleanup, not automatic.
- **Impact:** Medium. A mock aimed at a stale path is silent, and tests could pass for the wrong reason.
- Unverified: could not run `bun test` with a moved file or inspect Bun's mock scoping, because I did not execute code.

**B12: Test preload and CSS file reads tied to location**
- **Dimension:** Integration Boundaries
- **File(s):** Makefile, src/ui/test-setup.ts, src/ui/documents/markdown-editor/markdown-editor.test.tsx
- **Finding:**
```make
test-ui: node_modules
	bun test --preload ./src/ui/test-setup.ts src/ui
test-server: node_modules
	bun test src/server src/shared
```
```ts
const css = (await Bun.file(`${import.meta.dir}/markdown-editor.css`).text())
```
  - **Preload:** `./src/ui/test-setup.ts` is a hard-coded relative path in the Makefile. The setup file belongs at the UI package root, and its path must change if it moves.
  - **Package split by directory:** a test under `src/ui` gets happy-dom, and anything under `src/server` or `src/shared` does not. The shared tests (`blocks.test.ts` and similar) run without happy-dom.
  - **TransformStream swap:** `test-setup.ts` restores Bun's `TransformStream` after `GlobalRegistrator.register()`. If shared code or UI tests ever moved to run in the server run, they would hit the real globals instead.
  - **CSS reads:** `markdown-editor.test.tsx` reads `markdown-editor.css` from its own folder (lines 1500 and 1515) and asserts on the text. The test and the CSS file must stay in the same folder. The `src/ui/popups/link-popup/link-popup.css` import from the markdown editor goes through the link-popup component and not through a path.
  - **Dependency:** I did not find any other test that reads a CSS file by location.
- **Impact:** Low to medium. The preload path fails loudly (no DOM), but the CSS read fails only in those two tests.

**B13: Newly added UI files are pure or relative-import only; the moves are mechanical**
- **Dimension:** Data Flow
- **File(s):** src/ui/components/panel-resizer/panel-resizer.tsx, src/ui/documents/file-tree/entry-name.ts, src/ui/documents/markdown-editor/highlight-outline.ts, src/ui/documents/markdown-editor/raw-syntax.ts, src/ui/popups/link-popup/link-popup.tsx
- **Finding:**
  - **panel-resizer:** only its own CSS (`import './panel-resizer.css'`). It is imported by `app.tsx` as `./components/panel-resizer/panel-resizer`, so it is already in a `components/` folder.
  - **entry-name.ts:** imported only by `file-tree.tsx` (`./entry-name`), so it sits at the lowest covering scope.
  - **highlight-outline.ts:** imported by `markdown-editor.tsx` and `markdown-editor.test.tsx`.
  - **raw-syntax.ts:** imports `./raw-formatting` and is used by `raw-view.tsx`.
  - **link-popup:** `import { LinkPopup } from '../../popups/link-popup/link-popup'` in `markdown-editor.tsx`. It also imports `../components/anchored-bubble`, which is shared by three popups. So link-popup is a documents-feature dependency that lives in `popups/`.
  - **Runtime coupling:** none of these hold module-level mutable state. The only runtime coupling is cross-feature: the markdown editor (documents) depends on `popups/`, and `documents.tsx` depends on `markdown-editor` exports `mergeMarkdown` and `replaceMarkdown`. Moving the popup into the editor's folder changes import depth only.
  - **Depth:** `../../shared/...` chains encode depth, and tsc catches them.
- **Impact:** Low.

## Negative results

- **Clean:** no `__dirname`, no dynamic `import()` or `require` of computed paths, and no new `import.meta.dir` uses outside the ones listed above. The runtime `import.meta` uses in `src/` are `paths.ts`, `fake-claude-on-path.ts`, `server.test.ts` and `markdown-editor.test.tsx`.
- **Clean:** the watcher, the event bus and the socket introduce no module-level singletons. All their state is per call or per instance.
- **Clean:** `src/shared` imports nothing upward, and UI and server never import each other, apart from the server importing `ui/index.html`.
- **Clean:** the new UI files (panel-resizer, entry-name, highlight-outline, raw-syntax, link-popup) have no path arithmetic.
- **Not changed:** `src/fixtures/workspace` is read only through `FIXTURE` in `workspace.ts`. The `.claude/agents` and `.claude/skills` fixture folders are plain files inside the copied tree.

### Behavioral Summary

- **Focus area analyzed:** src/server, src/ui and src/shared, with one layer out into the Makefile, package.json, tsconfig, src/skills and src/fixtures. I traced the new watcher end to end: `watchDocuments` in documents.ts, then `EventBus`, then the `/ws/events` socket, then `useHostEvents` in the UI, then `docs.syncWithDisk()`. I also read server.test.ts and the new UI files.
- **Key concerns:**
  1. The SRC anchor, the hard-coded `skills` and `fixtures/workspace` strings, and the macro. A wrong move gives a binary with missing skills or an unseeded workspace without an error, and only `paths.test.ts` and `make check-build` guard it.
  2. `mock.module` registrations with relative specifiers (B11), and the single `isHiddenName` that keeps `.3pitor` writes from echoing as `documents-changed` events (B7).
  3. Location-coupled test files: `server.test.ts` beside `server.ts` (B9), `fake-claude-on-path.ts` beside `fake-claude.ts` (B10), `markdown-editor.test.tsx` beside its CSS (B12), and the preload path in the Makefile.
- **Well-handled areas:** the watcher cleans up its timers on `close()`, logs errors from the callback without stopping, and tests it with real file-system bursts. `paths.test.ts` is an explicit guard for the SRC anchor. `server.test.ts` adds startup coverage that did not exist in the prior run.
- **Skipped dimensions:** none. Not verified at runtime: Bun's behavior for `scanSync` on a missing directory, `mock.module` scoping across files, and a compiled-binary build. I read code only and did not run any build, test or move.

---

## Concurrency Analysis

> Verbatim output from `concurrency-analyst`. `C#` findings on race conditions, resource contention, deadlock potential,
> async error handling, and synchronization.

Concurrency findings for `src/`, focused on what a file move could break. I read the code at HEAD and the diff from 0f65102 to HEAD, and ran no tests. I reuse the prior analysis (docs/changes/update-code-structure-2026-09-30/artifacts/architectural-analysis.md, its C1-C8) wherever the code is unchanged.

Concurrency is present: async/await, Promise chains, timers, a WebSocket, a Bun HTTP server serving concurrent requests, an fs.watch watcher, and React refs. There are no threads or workers, and the UI is a single-threaded event loop. Every race below is a microtask or timer interleaving, or concurrent HTTP requests, over shared mutable state.

**C1: `json-file.ts` write queue now has a third caller, so the singleton matters more (prior C1, extended)**
- **Dimension:** Synchronization
- **File(s):** src/server/components/json-file.ts, src/server/chat/tools/tools.ts (lines 108 and 132), sessions.ts, view-state.ts
- **Finding:** The queue is unchanged in design.
```ts
const pending = new Map<string, Promise<void>>();
export function writeText(path: string, text: string): Promise<void> {
  const write = (pending.get(path) ?? Promise.resolve()).then(async () => {
```
  - `writeJson` is now a wrapper over the new `writeText`. Both share the one `pending` map, so ordering holds across both entry points.
  - `tools.ts` now calls `writeText(note, content)` and `writeText(note, replaceOnce(noteName, await file.text(), old_string, new_string))` for the model's notes under .3pitor.
  - The second call is a read-modify-write: `file.text()` is read outside the queue and the replacement is written inside it. Two concurrent note edits of one note in the same turn, over the API path (AI SDK `Promise.all`) or the CLI MCP path, can both read the same old text. The later write then drops the earlier edit. Queueing orders the writes but does not make the read-modify-write atomic. This is the same shape as prior C2, on a new file kind.
  - A move is safe only if there is exactly one `json-file` module. The queue is keyed by raw path string, so two path spellings of one file (relative vs absolute) would not share a queue. Keep it a single module. If it moves, update the three importers: sessions, view-state and `tools.ts`.
- **Impact:** Lost note edits when two edits of one note run in parallel. A duplicated module would silently lose write ordering on session.json, view.json and the notes.
- Unverified: could not confirm that the AI SDK or MCP path actually runs two note edits concurrently, because I did not trace the tool scheduling.

**C2: `TurnTexts` per-turn race, unchanged (prior C2)**
- **Dimension:** Race Conditions
- **File(s):** src/server/chat/tools/tools.ts, src/server/chat/sessions/sessions.ts, src/server/chat/agent/agent.ts
- **Finding:** The code is unchanged since the prior analysis, apart from the note-writing addition in C1, so I did not re-derive it. `markEdited` and the Edit tool still have an await between read and write. The object is still created once per turn in `Sessions.chat` and shared only by closure. A move is safe as long as `turnTexts` and `editedTexts` stay in the one module pair that `Sessions` and `tools.ts` both import. Nothing is module-level here, so there is no singleton-identity risk, only a closure-wiring risk.
- **Impact:** As in the prior analysis. Moving the `aborted ? {} : editedTexts(turn)` gate would leak late edits from a stopped turn (prior C3 is also unchanged).

**C3: EventBus now carries a third event type, `documents-changed`, with no listener isolation (prior C4, extended)**
- **Dimension:** Async Errors
- **File(s):** src/server/events/events.ts, src/shared/wire.ts, src/server/server.ts line 24, src/ui/app.tsx
- **Finding:** The bus is the same as before: one instance per host, a live `Set` iterated with `for...of`, and no try/catch per listener. There is a new publisher, outside `agent-host`'s sessions:
```ts
watchDocuments(workspace, () => host.events.emit({ type: 'documents-changed' }));
```
  - `watchDocuments` wraps `onSettled` in try/catch, so a throwing listener cannot kill the timer.
  - On the UI side, `useHostEvents` stores the handler in a ref refreshed on every render, so `docs.syncWithDisk` is never stale.
  - `host.events` identity matters: `server.ts` and `agent-host` must share the same bus instance. If the move splits `createAgentHost`, keep this wiring.
- **Impact:** Low. A throwing socket listener would stop later listeners from seeing `documents-changed`. The watcher's own catch means this only logs.

**C4: Workspace watcher is a fire-and-forget singleton with no close and one debounce pair per instance**
- **Dimension:** Resource Contention
- **File(s):** src/server/documents/documents.ts (`watchDocuments`), src/server/server.ts
- **Finding:**
```ts
const watcher = watch(workspace, { recursive: true }, (_event, filename) => {
  if (filename?.split(/[\\/]/).some(isHiddenName)) return;
  clearTimeout(quiet);
  quiet = setTimeout(settle, 100);
  cap ??= setTimeout(settle, 1000);
});
watcher.on('error', (error) => console.error(...));
```
  - The `quiet` and `cap` timers are closure-local, so there is no module-level state. The returned `close()` is never called in `server.ts`, so the watcher lives for the process lifetime. That is intended.
  - The watcher is started before `await host.sessions.load()`. An event during load reaches the bus with no UI listener, and the UI's connect-time `syncWithDisk` covers it.
  - The server's own writes to the workspace (a document PUT, create, move, delete) also fire the watcher, so each UI save echoes back as `documents-changed` to every tab, including the saver. This is deliberately handled in the UI (see C5).
  - The `filename?.` check lets events with a null filename through, which is harmless, since it only causes a sync.
  - On a watcher error the watcher stays dead until restart. This is logged and accepted in the code comment.
  - A move would break nothing here, provided `watchDocuments` is called exactly once. Two calls would double every event.
- **Impact:** Low. One unbounded subscription, as designed. Calling `watchDocuments` twice after a restructure would make every tab sync twice, which the UI queue (C5) absorbs.

**C5: UI disk-sync coordination is new, shared-ref-heavy, and correct on its guards. It is welded to `useDocuments` as one instance.**
- **Dimension:** Race Conditions
- **File(s):** src/ui/documents/documents/documents.tsx (`syncWithDisk`, `syncOnce`, `syncFile`, `followDisk`, `refreshList`, `save`, `ensureLoaded`, `writeView`), src/ui/app.tsx, src/ui/documents/markdown-editor/markdown-editor.tsx
- **Finding:** Everything below is shared mutable state in refs, so it holds only if there is a single `useDocuments()` instance. That is the prior C5 constraint, now with more refs: `opened`, `listRef`, `listCalls`, `loading`, `sync`, `writing` and `turnBases`. The guards were checked individually.
  - **Sync queue.** `syncWithDisk` runs one `syncOnce` at a time and coalesces callers into one queued run, so no two syncs overlap. `syncOnce` never rejects, so a failure cannot wedge `s.running`.
  - **Stale list.** `refreshList` uses a `listCalls` counter, so an older GET cannot overwrite a newer list. It returns `entries` even when they were not applied. `syncOnce` uses that return value as `now`, which is correct for its own comparison.
  - **Read vs save interleaving.** After `await readFile`, `syncFile` bails if `opened.current.get(name) !== entry || entry.saving || entry.saves !== saves`. This covers both a save in flight and a save that finished during the read. `save` sets `entry.saved` and `entry.saves++` before anything else looks, and `entry.saving` is cleared after `run` settles. The echo of the user's own save from the watcher therefore compares equal to `entry.saved` and is a no-op.
  - **Typing or an AI merge during the read.** `entry.dirty` is tested after the await and `followDisk` runs synchronously straight after. `applyEdited` also sets `dirty = true`. So there is no await between the check and the replace, and the typing guard holds.
  - **Concurrent loads.** `ensureLoaded` dedupes concurrent loads with the `loading` map, and a failed load is forgotten.
  - **Sync vs a turn's AI merge.** `syncFile` skips a file once it is dirty and only flags `diskChanged`. A clean file that an AI turn is about to merge could be replaced by `followDisk` between `beginTurn` and `applyEdited`. `turnBases` was captured at send time, so `mergeMarkdown(entry.doc, turnBase, ...)` merges against the old base onto a doc that now holds disk text. Because the same Yjs doc is updated in place by `replaceMarkdown`, this is a three-way merge and probably tolerable. It is an unexercised interaction between a sync and a turn. `turnSaves` does not guard it, because a disk-follow does not bump `entry.saves`.
  - **View-state PUTs (resolves prior C8).** `writeView` is now serialized: `inFlight` and `again`, with exactly one catch-up write carrying the latest view. Arrival-order reordering is no longer possible from one page. It remains possible across two tabs.
  - **Module singletons.** `undoManagers` is now written at markdown-editor.tsx:678, deleted at 689, and read by `replaceMarkdown` (lines 95, 106 and 108) and `mergeMarkdown`. The prior C6 concern is wider: `replaceMarkdown` is a new importer from `documents.tsx` of that map. If `mergeMarkdown` or `replaceMarkdown` is split into its own file, `undoManagers` must live in one module that both the component and the two functions import. A copy fails silently, because `?.clear()` and `?.stopCapturing()` no-op. For `replaceMarkdown` that means the disk-follow lands in the user's undo history. The PluginKeys and the `schema` in shared/markdown.ts have the same identity constraint as in prior C6.
  - **Hook instances.** `useHostEvents` says "call once from App: every call opens its own socket". A split that calls it from a feature component would give duplicate sockets and duplicate sync triggers.
  - **Connect effect.** `useEffect(() => { if (connected) docs.syncWithDisk(); }, [connected])` can run before restore (documents.tsx line 391 also syncs). The queue absorbs this.
- **Impact:** No active race found in the sync path. The risk is structural: a split of `useDocuments` or `markdown-editor` that duplicates a ref or a module-level map would break the guards without any error.

**C6: Server document writes are still unsequenced (prior C7, unchanged)**
- **Dimension:** Race Conditions
- **File(s):** src/server/documents/documents.ts
- **Finding:** The `writeDocument` and `createEntry` check-then-act, and the rename check-then-act in `moveEntry`, are unchanged. `listEntries` now tolerates a folder vanishing mid-walk (ENOENT/ENOTDIR only for a non-root folder), which closes one TOCTOU for reads. The UI's per-entry `saving` join serializes saves from one tab, so only a second tab or an external editor can race.
- **Impact:** Unchanged and unaffected by a move. Documents writes do not use the `json-file` queue.

**Clean dimensions**
- **Deadlock:** There are no locks or channels. Only promise chains are used, and the `sync.queued` chain cannot form a cycle, since `queued` only awaits `running`. `writing.again` terminates because each write clears `again` before re-running.
- **Async error handling in the new code:** `syncOnce` catches everything. `readFile(...).catch(() => undefined)` deliberately defers an unreadable file to a later sync. The delete-confirm path reads the file again and only calls `forget` on a 404, which is the new `error.status` added in api.ts. `writeView` records failure and surfaces it.
- **Resource lifecycle:** The WebSocket cleanup in `useHostEvents` clears the retry timer, and the watcher timers are cleared on settle. The one gap is the unclosed watcher (C4), which is intentional.

**Concurrency Summary**
- **Focus area analyzed:** src/server, src/ui and src/shared, concentrating on the diff 0f65102..HEAD (watcher, `documents-changed`, disk sync, `writeText`, serialized view write).
- **Concurrency model:** Single-threaded event-loop async on both sides, plus concurrent Bun HTTP requests, fs.watch and timers, one in-process EventBus, and React refs as the shared state.
- **Key concerns:**
  1. Single-instance identity in the move: the `json-file` `pending` map (C1), `undoManagers` and the PluginKeys (C5), the one `useDocuments` instance, and one `useHostEvents` socket.
  2. The note read-modify-write in `tools.ts` (C1), and the `TurnTexts` race (C2).
  3. An unexercised interaction between a disk sync and a turn's `applyEdited` merge (C5).
- **Well-handled areas:** The disk-sync queue, stale-list counter, save guards and view-write serialization (C5). Watcher debounce and error isolation (C4). Write ordering for JSON state.
- **Skipped dimensions:** None skipped. Deadlock and Resource Contention are mostly clean, as noted above.

---

## Risk Assessment

> Verbatim output from `risk-analyst`. `R#` items, ordered highest risk first, each cross-referencing the `S`/`B`/`C`
> findings it scores.

Risk assessment of 27 upstream findings (S1-S8, B1-B13, C1-C6). Scope: `src/`. No files written. I read all three upstream files and ran git for churn. I did not run tsc, tests, or a build.

Churn evidence (git log, last 90 days, `src/` file touch counts):
- markdown-editor.test.tsx 48
- markdown-editor.tsx 41
- app.tsx 25
- raw-formatting.ts 20
- documents.tsx 19
- server.ts 17
- scripts/check.ts 17
- wire.ts 16
- documents.test.tsx 16
- file-tree.test.tsx 16
- `documents.ts` plus `json-file.ts` together: 5 commits.

Single-owner facts I checked:
- `json-file` has importers view-state.ts, tools.ts, sessions.ts, plus tests. All are static relative imports, so tsc catches stale paths. The failure mode is only duplication.
- The four `mock.module('../markdown-editor/markdown-editor')` calls are in documents.test.tsx at lines 307, 327, 1093 and 1117.
- My `undoManagers` grep errored (zsh glob), so I did not independently confirm it. C5's line numbers are unverified by me.

Each item is scored on two lenses. "As-is" is the risk of leaving it. "Restructure" is the risk it poses to the move, meaning a silent break.

**R1: Silent-failing path anchors and string specifiers that tsc cannot see (the main restructure hazard)**
- **Addresses:** S4 (items 1-7, 9-10, 12), B1, B2, B3, B4, B9, B10, B11, B12
- **Likelihood:** As-is: Unlikely, since nothing is moving unless the owner restructures. Restructure: Likely. This is the largest set of location-coupled items in the codebase, and the churn above shows these files are touched constantly.
  - SRC anchor: `paths.ts` `resolve(import.meta.dir, '..')` is used by workspace.ts, the macro, check.ts and three tests.
  - Four relative `mock.module` strings in documents.test.tsx.
  - `import.meta.dir` reads in markdown-editor.test.tsx (the css), server.test.ts and fake-claude-on-path.ts (sibling-only).
  - The `../../styles.css` text import in file-tree.test.tsx.
  - The Makefile and package.json paths.
- **Severity:** Medium overall, with two parts.
  - The tests (B11 mocks, B12 css read, S4.3-S4.5) fail either loudly or by passing for the wrong reason. A stale `mock.module` target is the worst case: the test falls through to the real editor and can stay green. B11 did not verify which happens, so this is unverified.
  - The compiled binary is the high-severity part. If the macro or SRC drifts, a `bun build --compile` binary can ship with no app skills or no seeded fixture. `make test` does not catch this, and only `make check-build` does. B2 did not verify whether `scanSync` throws or returns empty on a missing directory.
- **Blast radius:** Multi-module. About 8 files carry the anchor or specifier coupling, but each failure is contained to one feature or test file. The binary breakage is system-wide for released builds.
- **Reversibility:** Moderate. Everything is fixable by editing a path once found. Detection is the cost, because a binary shipped without skills is found by users.
- **Overall risk:** Medium as-is. High for the restructure, driven by the silent subset.
- **What happens if deferred or mishandled:** The owner moves markdown-editor (or documents) and tsc passes. documents.test.tsx still names the old path, the mocks stop applying, and tests pass or fail unpredictably. If `paths.ts` or the macro or `skills/` ends up one level off, `make test` stays green and the compiled binary starts with no app skills.
- **Move rules (the actionable result):**
  - Keep `paths.ts`, `server.ts`, `server.test.ts`, `command-line.ts`, `scripts/check.ts`, `index.html`, `styles.css`, `app.tsx` and `test-setup.ts` where they are.
  - Keep these pairs together: agent.ts with system-prompt.md, workspace-config with the macro, fake-claude with fake-claude-on-path, markdown-editor.test with markdown-editor.css.
  - Do not move `src/skills`.
  - After any move, grep for `mock.module`, `await import(`, `import.meta.dir` and `with { type`, then run `make check-build` and a seeded-workspace smoke test.
- Unverified: could not run `bun build`, `bun test` with a moved file, or inspect Bun's `scanSync` and `mock.module` behavior, because no code was executed.

**R2: Single-instance identity could be silently duplicated by a split**
- **Addresses:** B5, C1 (the module-singleton half), C5 (undoManagers, PluginKeys, one `useDocuments`, one `useHostEvents`), C3 and C4 (wiring and call-once)
- **Likelihood:** As-is: Unlikely, because every current identity holds. Restructure: Possible. The feature-local `components/` rule creates a temptation to copy a "shared" helper into each feature.
  - `json-file.ts` has 3 production importers across chat and view-state, plus 2 test importers.
  - `undoManagers` is the module-level map in markdown-editor.tsx, read by `replaceMarkdown` and `mergeMarkdown`. Churn is the highest in the repo, so splitting that file is plausible.
- **Severity:** Medium to High.
  - json-file duplication gives two write queues and a race on the same `${path}.${pid}.tmp` file. That means a corrupted or lost `session.json` or `view.json`, which are persisted user data.
  - A duplicated `undoManagers` makes `?.clear()` a no-op, so a disk-follow lands in the user's undo history. This is silent and confined to the editor.
- **Blast radius:** Single module to multi-module. json-file touches chat and view-state. undoManagers touches the editor and documents.
- **Reversibility:** Moderate for undoManagers. Difficult for json-file if corruption has already reached user workspaces, because it is persisted and not self-healing.
- **Overall risk:** Medium as-is (low in practice). Medium for the restructure.
- **What happens if deferred:** Nothing happens as-is, because the singletons are intact. During the restructure, `json-file` must have exactly one home. Under the owner's rule, "lowest covering scope" for json-file is `server/components/`, which is where it already is, so leave it. The editor's `replaceMarkdown` and `mergeMarkdown` must keep importing the one `undoManagers`. Do not split them off into a separate file with their own copy.
- Unverified: could not run the code or confirm the `undoManagers` line numbers in markdown-editor.tsx, because my grep failed and I relied on C5's reading.

**R3: `isHiddenName` single definition keeps `.3pitor/` writes from echoing as `documents-changed`**
- **Addresses:** B7, C4, C3, B8 (partly)
- **Likelihood:** As-is: Unlikely. Restructure: Possible, and only if someone extracts `isHiddenName` into a shared component, duplicates it, or changes its rule. It is private to documents.ts (line 21) and gates three things: the list walk, path validation and the watcher.
- **Severity:** Medium. If the watcher stopped filtering `.3pitor`, every session or view save would emit `documents-changed`. Every tab would then re-list and re-sync. B7 did not run this scenario, and C5 says the UI queue absorbs duplicate syncs, so the likely outcome is wasted work and not data loss. It could become a feedback loop only if sync itself wrote to `.3pitor`, which was not shown.
- **Blast radius:** Multi-module (documents, events, UI sync).
- **Reversibility:** Easy. It is a code-level fix with no persisted effect.
- **Overall risk:** Low as-is. Medium for the restructure, only if `isHiddenName` is touched.
- **What happens if deferred:** Nothing. It is safe as long as `isHiddenName` stays one function in documents.ts and `watchDocuments` is called once, from server.ts.
- Unverified: could not run the echo scenario, because no code was executed (per B7).

**R4: Cross-feature imports are real, but moving them is mechanical and tsc-checked**
- **Addresses:** S1 (link-popup into markdown-editor), S2 (chat to workspace-config and events, documents.test to chat/tools, check.ts to workspace), B13, S5, S7
- **Likelihood:** As-is: Near certain that they stay as drift. They have no runtime effect. Restructure: Likely to come up as a placement decision.
- **Severity:** Low to Medium.
  - Scope: S1 is the only new UI cross-feature import. link-popup has one importer (markdown-editor.tsx). Option (b) in S1 is to move it to `ui/documents/markdown-editor/` and import `popups/components/anchored-bubble`.
  - Scope: S2's `agent.ts` and `tools.ts` coupling to workspace-config internals (`APP_SKILL_PREFIX`, `appSkillText`) is the only part with design weight.
  - Risk: the cost is a boundary that is harder to reason about, not a failure.
- **Blast radius:** Single module for S1 (1 importer plus its test). Localized for the S2 items. `events` is a stable leaf that imports only shared/wire.
- **Reversibility:** Easy. All imports are static and relative, and tsc catches every break. B13 and S1 confirm there are no `mock.module` targets on link-popup.
- **Overall risk:** Low. For the restructure, S1 option (b) carries a small silent hazard. `link-popup.css` is a side-effect import. B3 says reordering CSS imports can change the cascade invisibly, and happy-dom cannot see that. After the move, check that the css still loads in the same order relative to `anchored-bubble.css`.
- **What happens if deferred:** The README keeps claiming app.tsx is the only wiring point (S7), which stays slightly false. Nothing breaks.

**R5: Latent concurrency defects unrelated to the restructure (leave alone)**
- **Addresses:** C1 (note read-modify-write in tools.ts), C2 (TurnTexts), C5 (the sync-versus-AI-merge interaction), C6 (document writes unsequenced), B6 (view.json and session.json shapes; `chat.tsx` regex for `/.data/<name>/`)
- **Likelihood:** Possible.
  - C1: two parallel note edits to one note. Not confirmed, because C1 did not trace tool scheduling.
  - C5: a disk-follow lands between `beginTurn` and `applyEdited`. This is rare.
  - C6: needs a second tab or an external editor.
- **Severity:** Medium. A lost note edit or a rare AI-merge anomaly. This is a bounded and user-visible quirk, not corruption of structural state.
- **Blast radius:** Localized to Single module. Each item is in one tool or one hook.
- **Reversibility:** Moderate. These are targeted fixes. The persisted-shape items (B6) are Difficult if changed. A careless "tidy" move of types out of wire.ts is safe only if the serialized shape stays identical. This is a no-behavior-change restructure, so it should not touch them.
- **Overall risk:** Medium as-is for C1. Low for C2, C5 and C6. For the restructure it is Low as long as the code is moved without edits.
- **What happens if deferred:** Occasionally a note edit is dropped, or a late edit from a stopped turn leaks. The restructure neither worsens nor fixes this. Since the owner stated no behavior changes, these fall outside the restructure scope.
- Unverified: could not trace the AI SDK or MCP tool scheduling, so whether C1 triggers in practice is unconfirmed (per C1).

**R6: Test and startup coverage gaps that weaken the safety net for the restructure**
- **Addresses:** B9 (server.test.ts discards stderr), B2 (no `make test` coverage of the binary), B8 (fixed `Bun.sleep(300)`; hard-coded `/ws/events`; unvalidated `JSON.parse`), B3 (CSS cascade invisible to happy-dom)
- **Likelihood:** Likely to matter during the restructure, because it is the validation path.
- **Severity:** Medium. A crashed server shows up as a test failure with no cause, because stderr is `'ignore'`. This slows diagnosis and does not by itself break anything. B9 did not read `listeningOn` to see how it behaves on early exit.
- **Blast radius:** Multi-module (validation covers the whole server).
- **Reversibility:** Easy.
- **Overall risk:** Low to Medium. Mitigate by running `make check-build` and the app by hand after the move, not by relying on `make test` alone.
- **What happens if deferred:** A bad move reaches green tests and fails only in a built binary or at first workspace seeding. No scenario worse than that was found.
- Unverified: could not read the body of `listeningOn` or run the build, because the upstream output was cut off and nothing was executed (per B9).

**Low or no risk, grouped (no action needed):**
- S3 and B10: the fake-claude helpers are correctly placed in `chat/components/`. The sibling-copy rule is already in R1's move rules.
- S5, S8 and B13: panel-resizer, entry-name, highlight-outline, raw-syntax and the type-only raw-view cycle are correctly placed. Treat any further split of raw-view, raw-formatting and raw-syntax as an owner option, not a defect. The cycle is type-only, and it has existed since the prior run.
- S6: UI and server name sanitizing rules differ in intent. The only shared literal is the `.md` suffix. Nothing belongs in `src/shared`.
- B4: system-prompt.md must move with agent.ts, and a bad specifier fails loudly in tsc.
- C3 and C4: EventBus has no per-listener isolation, and the watcher handle is never closed. Both are by design, and the watcher's own try/catch makes it a logging issue only.
- B8: reconnect with no backoff and the hard-coded `/ws/events` path. The move cannot break either. Only a rename can.
- S7: README drift. Documentation only.

### Risk Summary
- **Findings assessed:** 27 upstream findings (S1-S8, B1-B13, C1-C6), grouped into 6 risk items and 1 low-risk cluster.
- **Critical risks:** 0.
- **High risks:** 0 as-is. One is High for the restructure only: R1 (silent path anchors, `mock.module` strings, and the binary-only breakage).
- **Medium risks:** R2 (single-instance identity), R3 (`isHiddenName`, restructure only), R5 (C1 note read-modify-write).
- **Findings with low or no risk:** R4 plus the low cluster above. This includes S1 and S2, which are mechanical and tsc-checked.
- **Severity inflation check:** The risk spread is deliberately differentiated. Nothing is rated Critical, because no finding shows data loss or a security issue in the current code. R1 is the only High, and it is conditional on the move.
- **Limitation:** All three upstream analyses read code and ran no builds or tests, so runtime claims (Bun mock scoping, `scanSync` on a missing directory, tool scheduling concurrency) are unconfirmed.

---

## Software-Architecture Recommendations

> Verbatim output from `software-architect`. `A#` recommendations ordered by impact, each cross-referencing upstream
> findings, with a sketch and a YAGNI-evidence line.

**Short answer:** one move is needed. It is a pure move with two parts: link-popup goes into the markdown-editor component, and anchored-bubble goes up to `ui/components/`. Everything else is either already in the right place, or a pinned file or single instance that must not move. Every other structural idea fails the YAGNI test or its trigger from the 2026-09-30 run. Nothing crosses a deployable unit. The UI is bundled into the server binary, so the only "system" concerns are persisted file formats and the user's workspace as a trust boundary.

**Correction to S1 option (b).** S1 calls `popups/components/anchored-bubble` "a package-level component". It is not. It is a feature-level `components/` folder that belongs to `popups`. If link-popup moves into `documents` and anchored-bubble stays where it is, `documents` reaches into another feature's internal folder. The owner's lowest-scope rule then puts anchored-bubble in `ui/components/`, because once link-popup lives in documents its users span two features: documents and popups. A1 does that.

What I checked:
- Grepped callers and importers of link-popup, LinkPopup, anchored-bubble, useAnchoredBubble, raw-*, ViewState, workspace-config, postName and the cross-feature import specifiers in both packages.
- Read the head of `link-popup.tsx`, `link-popup.test.tsx` and `anchored-bubble.ts`, and the import blocks of `markdown-editor.tsx`, `app.tsx` and the popups.
- Read the README layout section (lines 100-176).
- Ran a co-change check on the 4 link-popup commits.

I did not run tsc, the tests or a build.

---

**A1: Move link-popup into the markdown-editor component; promote anchored-bubble to `ui/components/anchored-bubble/`** (pure restructure, move only)
- **Addresses:** S1, B13, R4, S7 (the README claim that only app.tsx wires features together), B3 (CSS cascade)
- **Principle:**
  - **High cohesion and SRP at the component level.** link-popup changes for the editor's reasons. In git, 2 of its 4 commits also touch `markdown-editor.tsx` and its test/css: b9d547f and b88fc86. None touch question-popup or selection-popup.
  - **Loose coupling.** This removes the only UI feature-to-feature import outside `app.tsx`, at `markdown-editor.tsx:38`.
- **Current state:**
  - `LinkPopup` has exactly one importer, `markdown-editor.tsx:38` (rendered at :967), plus its own test.
  - `popups/` holds widgets that only `app.tsx` wires, except this one.
  - `anchored-bubble` has three users: link-popup, question-popup and selection-popup.
- **Recommended change:**
  ```
  src/ui/
    components/
      anchored-bubble/            <- from popups/components/
        anchored-bubble.ts
        anchored-bubble.css
      agent-actions/ menu/ panel-resizer/ api.ts fake-documents-api.ts   (unchanged)
    documents/markdown-editor/
      link-popup.tsx              <- from popups/link-popup/
      link-popup.css
      link-popup.test.tsx
      markdown-editor.tsx ... (unchanged)
    popups/
      question-popup/  selection-popup/     (popups/components/ and popups/link-popup/ removed)
  ```
  The import edits, and only these:
  ```
  markdown-editor.tsx:38   '../../popups/link-popup/link-popup'  -> './link-popup'
  link-popup.tsx:4         '../components/anchored-bubble'       -> '../../components/anchored-bubble/anchored-bubble'
  question-popup.tsx:5     '../components/anchored-bubble'       -> '../../components/anchored-bubble/anchored-bubble'
  selection-popup.tsx:5    '../components/anchored-bubble'       -> '../../components/anchored-bubble/anchored-bubble'
  ```
  These do not change:
  - `./link-popup.css` and `./anchored-bubble.css` stay siblings of their modules.
  - `link-popup.test.tsx` imports only `./link-popup` plus libraries.
  - Folder vs flat follows the `ui/components/` convention: multi-file components (`menu/`, `panel-resizer/`, `agent-actions/`) get a folder, single-file helpers (`api.ts`) stay flat.
- **Rationale:**
  - The owner's rule says a component folder holds "the helpers only it uses". link-popup is used only by markdown-editor.
  - `popups/` is grouped by widget type, not by capability. Keeping link-popup there means a cross-feature dependency with no second user to justify it.
  - After the move, `app.tsx` is again the only UI file that imports from another feature, which makes the README claim true again.
- **Move-safety checklist:**
  1. `git mv` the 3 link-popup files and the 2 anchored-bubble files. Do the anchored-bubble pair in one step, because the .ts side-effect-imports its .css.
  2. Apply only the 4 specifier edits above. Do not reorder any import line. Bun's CSS order follows import traversal from `app.tsx`, so path changes keep the cascade, but reordering would not, and happy-dom cannot see that (B3).
  3. String specifiers tsc cannot see: grep `mock.module`, `await import(`, `import.meta.dir` and `with { type` for `link-popup|anchored-bubble`. Expected result: none (I verified this at HEAD). `markdown-editor.test.tsx:1500,1515` reads only `markdown-editor.css`, which does not move.
  4. Afterwards, grep for `popups/link-popup` and `popups/components` across src and README. Expected: 0 hits. Then `rmdir` the two empty folders.
  5. Run `tsc --noEmit` and `make test`. The link-popup and markdown-editor tests cover the render path.
  6. Open the link bubble once by hand and confirm it is styled. This is the only check for CSS load order (R4 note).
  7. Update the README in the same commit (precedent D-9). Add a `markdown-editor/link-popup` bullet. Move the anchored-bubble bullet to the `ui/components/` list and correct it: it now has three users, not "both popups".
  8. Nothing pinned is touched: `index.html`, `app.tsx`, `styles.css`, `test-setup.ts`, the Makefile and package.json.
- **Smallest safe step:** the link-popup move alone compiles if link-popup temporarily imports `../../popups/components/anchored-bubble`. Shipping both parts in one commit is still preferable, because the intermediate state is exactly the cross-feature reach this change removes.
- **YAGNI evidence:**
  - S1 is a current rule violation, and link-popup has 1 importer.
  - Promoting anchored-bubble is forced, not speculative: it has 3 current users across 2 features after the move.
  - No new abstraction is introduced.
- **Simpler version considered:** option (a), leave link-popup in `popups/` and accept documents→popups as a "public API" import, by analogy to the server precedent. Rejected for two reasons. It fails the owner's "helpers only it uses" placement for a single-user module. It also keeps the UI's only feature-to-feature edge outside the composition root, and on the UI side app.tsx is the stated wiring point. S1's option (b) as written, moving link-popup but leaving anchored-bubble in `popups/components/`, is not simpler. It swaps one cross-feature reach for another.
- **Risk if deferred:** low (R4). The cost is boundary drift and a README that stays false. Nothing breaks.

**A2: Pin the single instances and location-bound files. "Leave in place" is the recommendation.** (no move, guardrail for every other move)
- **Addresses:** R1, R2, R3, B1, B2, B4, B5, B7, B9, B10, B11, B12, C1, C3, C4, C5, S3, S4
- **Principle:** high cohesion of state with the module that owns it. Duplicating a module-level singleton across feature `components/` folders would split one responsibility into two, silently.
- **Current state, already correct:**
  - `server/components/json-file.ts` has one `pending` map. Its users are chat (sessions, tools) and view-state, two features, so `server/components/` is already the lowest covering scope.
  - `undoManagers` is at `markdown-editor.tsx:82`. `replaceMarkdown` and `mergeMarkdown` (lines 95-108) and the component (678, 689) all share it in one module.
  - `isHiddenName` is private to `server/documents/documents.ts`. It gates listing, path validation and the watcher.
  - `watchDocuments` is called once, from `server.ts`. `useHostEvents` and `useDocuments` are each called once, from `app.tsx`.
- **Recommended change:** none. These are the rules any later move must keep:
  ```
  pinned (location):  server/{paths.ts, server.ts, server.test.ts, command-line.ts, agent-host.ts, scripts/check.ts}
                      ui/{index.html, app.tsx, styles.css, test-setup.ts}, src/skills, src/fixtures
  move-together:      agent.ts + system-prompt.md; workspace-config.ts + app-skills.macro.ts;
                      fake-claude.ts + fake-claude-on-path.ts; markdown-editor.test.tsx + markdown-editor.css
  single-definition:  json-file.ts; undoManagers + replaceMarkdown + mergeMarkdown in one module; isHiddenName
  string specifiers:  documents.test.tsx:305,307,327,1090,1093,1117; file-tree.test.tsx:6 ('../../styles.css')
  ```
  Do not extract `isHiddenName` to share it with `tools.ts`'s own `startsWith('.')` rule (S6). The two rules differ on purpose, so unifying them is a behavior change (see Deferred, behavior).
- **YAGNI evidence:** n/a. This adds no structure, and R2 and R3 name the hazard.
- **Simpler version considered:** n/a. Doing nothing is the simplest option.
- **Risk if deferred:** this is not optional for any move. Per R1 and R2, a violation is silent: a binary with no skills, mocks that stop applying, or duplicated write queues.

**A3: Server feature-to-feature imports stay as they are** (negative result, no move)
- **Addresses:** S2, S8, R4
- **Principle:** dependency direction. Every edge points at a stable leaf or at a public API, which the precedent allows.
- **Current state (re-verified):**
  - **chat→events:** imports the `EventBus` class or type only. `events` is a leaf that depends only on shared/wire. This is a public API.
  - **chat→workspace-config:** agent and tools, plus 2 tests. workspace-config is still its own feature, with its own route (`server.ts:16`, `workspace-config.routes.ts`) and an HTTP consumer (`check.ts:169` `GET /api/workspace-config`). The prior deferral's trigger has not fired, so the code is effectively unchanged on this axis.
  - **documents.test→chat/tools `postName`:** still test-only. There is no second production importer, so the prior trigger is unmet.
  - **scripts/check.ts→workspace:** the script is entry-point territory, pinned by package.json.
- **Recommended change:** none. Respect the precedent.
- **YAGNI evidence:** no trigger has fired.
- **Simpler version considered:** n/a.
- **Risk if deferred:** low. S2 has no runtime effect.

**A4 (doc only): refresh the README inventory** (pure documentation, no code)
- **Addresses:** S7
- **Change:** add the entries the README lacks, among them `entry-name.ts`, `highlight-outline.ts`, `raw-syntax.ts` and `server.test.ts`. Fold this into A1's commit.
- **YAGNI evidence:** S7 found the drift.
- **Risk if deferred:** low.
- Unverified: could not confirm the full list of missing README entries, because S7 read only lines 15-60 plus grep hits, and I read only lines 100-176.

---

### Software Architecture Recommendations Summary

- **Upstream findings addressed:** all 27 are accounted for.
  - S1, S7, B3, B13 and R4 are acted on by A1 and A4.
  - These are explicitly "keep as is" in A2 and A3: S2, S3, S4, S8, B1, B2, B4, B5, B7, B9, B10, B11, B12, C1 (the singleton half), C3, C4, C5 (the identity half), R1, R2, R3.
  - These are intentionally not addressed:
    - **S5:** placement is correct. All raw-* importers are inside markdown-editor, and the type cycle is unchanged.
    - **S6:** nothing belongs in shared.
    - **`file-tree.tsx`→`documents/documents` type import:** a sibling import within one feature, which the rules allow.
    - **panel-resizer and fake-documents-api in `ui/components/`:** the lowest scope that covers the package-root users `app.tsx` and `app.test.tsx`.
    - **Behavior changes, excluded by "no behavior changes":**
      - C1 (the note read-modify-write)
      - C2
      - C5 (the sync-vs-turn merge)
      - C6
      - B6 (the `chat.tsx` `.data` regex, and view.json validation)
      - B8 (unvalidated `JSON.parse`, no backoff)
      - B9 (stderr ignored)
      - B2 and R6 (`make check-build` is not in `make test`)
      - R5 as a whole
      - unifying `isHiddenName` with the tools rule
- **Key themes:**
  1. Single-user modules grouped by widget type (`popups/`) instead of by the component that uses them.
  2. Shared helpers must sit at the scope of their actual users. anchored-bubble moves up once link-popup moves.
  3. Correctness in this codebase rests on single module instances and location-bound files. Leaving things in place is a deliberate recommendation, not an omission.
- **Highest-impact recommendations:** A1 (removes the only UI cross-feature import and puts anchored-bubble at the right scope), then A2 (the guardrails that keep every move silent-safe).
- **Deferred to `system-architect`:**
  - **B6 (persisted shapes):** the `.3pitor/view.json` and `.3pitor/session.json` formats are a data contract with users' workspaces that must hold across app versions. This is not an intra-codebase concern.
  - **C6 and B7 (workspace trust boundary):** races with external editors or second tabs, and the watcher's view of a user-owned directory. Both concern the app's contract with an outside writer.
  - Nothing else crosses a deployable unit. The UI is bundled into the server binary, so route and socket literals stay an intra-codebase YAGNI item (below).
- **Deferred (YAGNI):**
  - **`ui/view-state/` feature (S8).** Anti-pattern: speculative module split. Only `app.tsx` and `documents.tsx` (plus tests) use ViewState. Trigger: a second UI reader or writer outside those two (prior run).
  - **`raw-view/` component folder, and an `Ask`/`SelectionAsk` types module (S5).** Anti-pattern: split without a second user. Trigger: raw-* gains an importer outside markdown-editor, or the type cycle causes an error (prior run).
  - **Move `workspace-config` under `chat` (S2).** Trigger: workspace-config loses its own route and HTTP consumer (prior D-14 criterion).
  - **Move `postName` to `server/components/` (S2).** Trigger: a second production importer outside chat.
  - **Shared route, stream-part and `.md` suffix constants in `src/shared` (S6, B6, B8).** Anti-pattern: abstraction for symmetry. Trigger: a server/UI mismatch that ships (prior D-22).
  - **Regroup `question-popup` and `selection-popup` under `chat/` (new, considered).** Both send chat messages, but `app.tsx` wires them and they have no server counterpart. Trigger: a popup gains an importer other than `app.tsx`, or a server-side counterpart.
  - **Move `panel-resizer` out of `ui/components/` (S5).** Trigger: none needed. Its current scope is correct.

---

## System-level concerns deferred

The software architect flagged these findings as contracts with something outside the codebase, and deferred them:

- **B6:** the `.3pitor/view.json` and `.3pitor/session.json` formats are a data contract with users' workspaces that
  must hold across app versions.
- **C6 and B7:** races with external editors or a second tab, and the watcher's view of a folder the user owns. Both
  concern the app's contract with an outside writer.

To get recommendations at that level, dispatch `system-architect` separately against this focus area. Every one of
them would be a behavior change, which this restructure defers.

---

_End of report. Finding IDs (`S#`, `B#`, `C#`, `R#`, `A#`) are stable for the life of this report. Cite them in
tickets, ADRs, and follow-up work._

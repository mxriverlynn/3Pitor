# Current State Findings: Update the Code Structure (2026-10-19)

## Provenance

Extracted from [architectural-analysis.md](architectural-analysis.md) (2026-10-19, medium size: structural,
behavioral, concurrency, risk, and software-architect). The findings below are the ones this plan rests on. The
planner re-read each at `384dd22` with grep, so all are Verified unless marked. The full S/B/C/R/A record stays in
the report.

## Project Context

- **Stack:** Bun + TypeScript, a Hono server, and a React UI bundled by Bun from `src/ui/index.html`. Tests use
  `bun test`, with happy-dom preloaded for `src/ui` only. `make test` runs `tsc --noEmit`, then `make check-node`, then
  the Bun-side tests (`src/cli src/server src/engine src/shared src/file-system src/posts src/app-files`), then the UI
  tests (`src/ui`).
- **Conventions source:** none found (no CLAUDE.md project discovery, no `project-discovery.md`). README.md's "How
  `src/` is laid out" section is the written layout rule set.
- **ADRs found:** none under `docs/adr/`.
- **Coding standards found:** none.
- **Recent churn (90 days):** `markdown-editor.test.tsx` 55, `markdown-editor.tsx` 51, `documents.tsx` 41, `app.tsx`
  39, `documents.test.tsx` 38 (report R-section). None of these files moves. `documents.tsx` changes import specifiers
  only.

## Gaps

- No ADR or coding standard records the layout rules. The README section and the earlier change sets in
  `docs/changes/` are the only record.
- No test checks CSS cascade order in the bundle (report B6, B7). `css_snapshot.sh` covers it per unit.
- No test enforces the server-to-engine import rule (report S6). The README text is the only rule.

## Findings

### C-1: entry-name has one user, in the posts package

- **Claim:** `newEntryName` sits in `src/shared/`, but its only importer is the file post store.
- **Location:** `src/shared/entry-name.ts`, `src/posts/file/file-post-store.ts:6`
- **Evidence:**
  ```ts
  // src/posts/file/file-post-store.ts:6
  import { newEntryName } from '../../shared/entry-name';
  // src/posts/boundary.test.ts:125 (a sample line fed to the checker, not an import)
  "import { newEntryName } from '../../shared/entry-name';",
  ```
- **Raised by:** report S1, R6, A5
- **Confidence:** Verified

### C-2: shortcut is used only inside the documents feature

- **Claim:** `ui/components/shortcut.ts` is in the package's shared scope, but all its users are in `ui/documents/`.
- **Location:** `src/ui/components/shortcut.ts`
- **Evidence:**
  ```ts
  // documents/documents/documents.tsx:10
  import { keyShortcut, shortcut } from '../../components/shortcut';
  // documents/markdown-editor/raw-view.tsx:8
  import { keyShortcut, shortcut } from '../../components/shortcut';
  // documents/markdown-editor/markdown-editor.test.tsx:10
  import { isMac } from '../../components/shortcut';
  ```
- **Raised by:** report S2, A1
- **Confidence:** Verified

### C-3: post-dialogs is shared by two documents components; post-table and model-picker each have one importer

- **Claim:** `documents/post-dialogs/` sits as its own component, but post-panel and post-table both use it.
  `documents/post-table/` is used only by `documents.tsx`, and `chat/model-picker/` only by `agent-panel.tsx`.
- **Location:** `src/ui/documents/post-dialogs/`, `src/ui/documents/post-table/`, `src/ui/chat/model-picker/`
- **Evidence:**
  ```ts
  // documents/post-panel/post-panel.tsx:9 and documents/post-table/post-table.tsx:6
  import { usePostDialogs, type PostDialogsDocs } from '../post-dialogs/post-dialogs';
  // documents/documents/documents.tsx:12
  import { PostTable } from '../post-table/post-table';
  // chat/agent-panel/agent-panel.tsx:3
  import { ModelPicker } from '../model-picker/model-picker';
  ```
  The moved files' own imports are `../../../shared/wire`, `../../components/notice-icons`, `../../components/menu/menu`,
  `../../components/api`, `../../components/confirm-dialog/confirm-dialog`, and their own CSS.
- **Raised by:** report S3, S4, A1, A4
- **Confidence:** Verified

### C-4: two engine test helpers are used outside the chat feature

- **Claim:** `test-model.ts` and `stub-tool-server.ts` sit in `engine/chat/components/`, but `engine.test.ts` (engine
  root) uses both and `model-config/model-config.test.ts` uses `stub-tool-server`.
- **Location:** `src/engine/chat/components/test-model.ts`, `src/engine/chat/components/stub-tool-server.ts`
- **Evidence:**
  ```ts
  // src/engine/engine.test.ts:5-6
  import { stubToolServer } from './chat/components/stub-tool-server';
  import { scriptedModel, useModel } from './chat/components/test-model';
  // src/engine/model-config/model-config.test.ts:6
  import { stubToolServer } from '../chat/components/stub-tool-server';
  // src/engine/chat/components/stub-tool-server.ts:3
  import type { ServeTools } from '../claude-cli/claude-cli';
  ```
  Chat-internal importers: `agent.test.ts`, `ollama.test.ts`, `providers.test.ts`, `sessions.test.ts`,
  `claude-cli.test.ts`, each as `'../components/<name>'`. `engine/bun-free.test.ts` EXEMPT names both as
  `'chat/components/test-model.ts'` and `'chat/components/stub-tool-server.ts'`.
- **Raised by:** report S5, A3
- **Confidence:** Verified

### C-5: the posts package's tests import the engine

- **Claim:** `posts/bun-free.test.ts` imports `bun-only-code` from the engine, a package that depends on posts.
  `bun-only-code.ts` has no imports.
- **Location:** `src/posts/bun-free.test.ts:7`, `src/engine/components/bun-only-code.ts`
- **Evidence:**
  ```ts
  // src/posts/bun-free.test.ts:7
  import { bunHits } from '../engine/components/bun-only-code';
  // src/engine/bun-free.test.ts:7 and :18
  import { bunHits } from './components/bun-only-code';
  'components/bun-only-code.ts', // the test-only definition of Bun-only code, shared with the posts package's scan
  ```
  `posts/boundary.test.ts:70` allows the posts package to import `src/shared/`. Test files are exempt from that scan.
- **Raised by:** report S6, A2
- **Confidence:** Verified

### C-6: server tests deep-import five engine modules the README does not all name

- **Claim:** `mcp-endpoint.test.ts` and `view-state.routes.test.ts` import engine modules other than `engine.ts`.
- **Location:** `src/server/chat/mcp-endpoint/mcp-endpoint.test.ts:8-14`, `src/server/view-state/view-state.routes.test.ts:6`
- **Evidence:** they import `chat/claude-cli/claude-cli`, `chat/components/chat-test-helpers`,
  `chat/components/fake-claude-on-path`, `components/json-file`, and `chat/tools/tools`. The README names only
  chat-test-helpers and the fake-claude pair as shared with the server's tests.
- **Raised by:** report S6, A6
- **Confidence:** Verified

### C-7: `server/scripts/check.ts` is addressed by a path `make test` never runs

- **Claim:** The end-to-end check is run by `package.json`'s `check` script and named in `FS_EXEMPT`. `make test` does
  not run it. Two earlier change sets kept it in place on purpose.
- **Location:** `src/server/scripts/check.ts`, `package.json:7`, `src/file-system/boundary.test.ts:25`
- **Evidence:**
  ```json
  "check": "bun run src/server/scripts/check.ts"
  ```
  restructure-by-feature D-5: "`scripts/check.ts` stays at `src/server/scripts/check.ts` — it is dev tooling, not a
  feature, and `package.json`'s `check` script names it by path." update-code-structure-2026-09-30 D-8 pins it again.
- **Raised by:** report S7, R5, A7
- **Confidence:** Verified

### C-8: test discovery and the boundary scans depend on the package roots staying put

- **Claim:** `bun test` runs only files under the Makefile's roots. Four boundary-test scans filter by `src/<pkg>/`
  prefixes and pass on an empty scan. Every exempt list has an existence test, so a stale entry fails loudly.
- **Location:** `Makefile:46,49`, `src/posts/boundary.test.ts`, `src/file-system/boundary.test.ts`,
  `src/engine/bun-free.test.ts:35`, `src/posts/bun-free.test.ts:30`
- **Raised by:** report B1, B2, B3, R1
- **Confidence:** Verified

### C-9: CSS reaches the bundle in import order, and nothing but a bundle diff checks it

- **Claim:** Each component imports its own CSS. The bundle orders the CSS by import traversal from `app.tsx`.
  `ui/css.d.ts` declares `*.css`, so `tsc` does not check CSS paths. happy-dom ignores CSS.
- **Evidence:** the baseline bundle's CSS order, from `css_snapshot.sh` at `384dd22`:
  ```
  src/ui/styles.css, components/panel-resizer, components/confirm-dialog, three prosemirror sheets,
  documents/markdown-editor/{anchored-bubble,image-popup,review-strip,markdown-editor}, components/menu,
  documents/post-dialogs, documents/post-table, documents/documents, documents/post-panel,
  chat/chat/{actions,chat}, chat/model-picker, chat/agent-panel
  ```
- **Raised by:** report B6, B7, R4
- **Confidence:** Verified

### C-10: two modules hold state at module scope

- **Claim:** `local-file-system.ts` holds the process-wide write queue (`pending`, `temps`), and
  `markdown-editor.tsx` holds the editor's WeakMaps (`undoManagers` and others). Each must stay a single definition.
- **Raised by:** report C1, C8, R3
- **Confidence:** Verified (one declaration each)

### C-11: the README's layout section has drifted

- **Claim:** It describes `documents/post-list/post-list.tsx`, which does not exist. It omits post-table, post-panel,
  post-dialogs, confirm-dialog, notice-icons, shortcut, review-strip, image-popup, menu-icons, table-cells, and
  `shared/document-key.ts`.
- **Raised by:** report S12, A8
- **Confidence:** Verified

# Current State Findings: Restructure src/ by Package, Feature, and Component

## Provenance

Extracted from the prior report [architectural-analysis.md](architectural-analysis.md), generated 2026-09-28 in this
same change set. The report ran structural-analyst, behavioral-analyst, concurrency-analyst, risk-analyst, and
software-architect over `src/server`, `src/ui`, and `src/shared`. Each C-N below names the report IDs it comes from.
The planning run then checked the import facts in C-5, C-6, and C-11 again with `grep` before writing this file.

## Project Context

- **Stack:** Bun 1.4.2, TypeScript 7 (`tsc --noEmit`, strict), Hono 4 server, React 19 UI with ProseMirror and Yjs,
  Vercel AI SDK v7 with its Anthropic provider. Tests use `bun test`, and the UI tests run in happy-dom through
  `--preload ./src/ui/test-setup.ts`.
- **Conventions source:** none found (no CLAUDE.md, no project-discovery.md). Conventions come from the README's file
  map and from the surrounding code.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found. There is no lint config, and `tsconfig.json` has no `paths` aliases.
- **Recent churn:** 64 commits, all dated 2026-09-28 (the history is squashed or rebased). The most-changed files are
  `ui/app.tsx` (15), `ui/chat.tsx` (12), `ui/documents.tsx` (10), `server/tools.ts`, `ui/markdown-editor.tsx`,
  `server/server.ts`, and `server/scripts/check.ts` (9 each).

## Gaps

- The repo has no ADRs, coding standards, or lint rules that enforce package boundaries (report S3).
- No unit tests exist for `documents.routes.ts` or `events.routes.ts` (report S1). Their only coverage is the
  end-to-end script `bun run check`.
- Baseline on the `restructure-by-feature` branch before any change: `make test` passes 75 server tests and 79 UI
  tests, and `tsc --noEmit` exits 0.

## Findings

### C-1: Two path calculations assume they sit exactly one folder below `src/`

- **Claim:** `SRC` in `workspace.ts` and the skills folder in `app-skills.macro.ts` are both computed relative to
  their own file's folder. Moving either file one level deeper changes the result silently.
- **Location:** `src/server/workspace.ts:6`, `src/server/app-skills.macro.ts:10`
- **Evidence:**
  ```ts
  export const SRC = resolve(import.meta.dir, '..');
  const dir = join(import.meta.dir, '../skills');
  ```
- **Raised by:** report S8, S9, B2, B3, R1 (Critical)
- **Confidence:** Verified
- **Bears on:** S-2, S-3, D-3

### C-2: `SRC` is used outside the workspace feature

- **Claim:** Four files import `SRC` from `workspace.ts`: `agent.test.ts`, `workspace-config.test.ts`,
  `workspace-config.routes.test.ts`, and `scripts/check.ts`. `check.ts` also starts the server with the string path
  `join(SRC, 'server/server.ts')`.
- **Location:** `src/server/scripts/check.ts:5,85`, and the three tests at their import lines
- **Evidence:**
  ```ts
  import { SRC, dataDir, resetWorkspace } from '../workspace';
  const server = Bun.spawn(['bun', 'run', join(SRC, 'server/server.ts')], {
  ```
- **Raised by:** report S8, S10
- **Confidence:** Verified
- **Bears on:** S-2, S-3, D-3, D-5

### C-3: A seeded `.data/workspace` folder hides a wrong `SRC`

- **Claim:** `ensureWorkspace` copies the fixture only when the target folder is missing. So if `SRC` goes wrong,
  `bun run server` keeps working on any machine where `src/.data/workspace` already exists.
- **Location:** `src/server/workspace.ts`, `ensureWorkspace`
- **Evidence:**
  ```ts
  if (!(await exists(path))) await cp(FIXTURE, path, { recursive: true });
  ```
- **Raised by:** report B2
- **Confidence:** Verified
- **Bears on:** S-2, D-3

### C-4: The macro embeds whatever it finds, including nothing

- **Claim:** If the skills folder the macro computes happens to exist but is the wrong one, `APP_SKILL_FILES` is `{}`
  and the build loses its app skills without any error. `workspace-config.test.ts:88-94` compares `APP_SKILL_FILES`
  to the files under `join(SRC,'skills')`, so the unit tests catch an empty embed once `SRC` is correct.
- **Location:** `src/server/app-skills.macro.ts`, `src/server/workspace-config.test.ts:88-94`
- **Evidence:**
  ```ts
  for (const path of [...new Bun.Glob('**/*.md').scanSync({ cwd: dir })].sort()) files[path] = readFileSync(join(dir, path), 'utf8');
  ```
- **Raised by:** report B3, and the architect's code facts
- **Confidence:** Verified
- **Bears on:** S-3, D-3

### C-5: A UI test imports server code to prove the server and UI find the same blocks

- **Claim:** `markdown-editor.test.tsx` imports `postBlocks` from `../server/tools`, the only UI → server import. The
  server's `postBlocks` and the UI's `blocksOf` are two copies of the same textblock walk.
- **Location:** `src/ui/markdown-editor.test.tsx:8,86-87`, `src/server/tools.ts:146-152`, `src/ui/markdown-editor.tsx:86-92`
- **Evidence:**
  ```ts
  import { postBlocks } from '../server/tools';
  expect(blocksOf(doc).map((b) => b.text)).toEqual(postBlocks(md));
  ```
  ```ts
  defaultMarkdownParser.parse(markdown).descendants((node) => { if (node.isTextblock) blocks.push(node.textContent); });
  doc.descendants((node, pos) => { if (node.isTextblock) blocks.push({ text: node.textContent, pos: pos + 1 }); });
  ```
- **Raised by:** report S4, S13, B1, R6
- **Confidence:** Verified
- **Bears on:** S-1, D-4

### C-6: `sessions.ts`, `agent.ts`, and `tools.ts` share one piece of per-turn mutable state

- **Claim:** `sessions.ts` creates `TurnTexts` and reads it back only when the turn was not aborted. `agent.ts` passes
  it through, and the tools in `tools.ts` change it. `sessions.ts` imports `tools.ts` directly as well as through
  `agent.ts`.
- **Location:** `src/server/sessions.ts:4,7`, `src/server/agent.ts:8`, `src/server/tools.ts:17-50`
- **Evidence:**
  ```ts
  import { agentSettings, modelErrorMessage, type AgentOptions } from './agent';
  import { editedTexts, turnTexts } from './tools';
  ```
- **Raised by:** report C1, C5, S6, B13, R3
- **Confidence:** Verified
- **Bears on:** S-4, D-6

### C-7: `test-model.ts` is used by exactly two test files

- **Claim:** Only `sessions.test.ts` and `agent.test.ts` import `scriptedModel` and `useModel`. It mocks
  `@ai-sdk/anthropic` by package name, so it does not depend on any path.
- **Location:** `src/server/test-model.ts`
- **Raised by:** report S7, R13
- **Confidence:** Verified
- **Bears on:** S-4, D-7

### C-8: `tools.ts` depends on the workspace-config feature

- **Claim:** `tools.ts` imports `APP_SKILL_PREFIX` and `appSkillText` from `workspace-config.ts`, and `agent.ts`
  imports `loadWorkspaceConfig`. This is a one-way dependency from chat to workspace-config.
- **Location:** `src/server/tools.ts:13`, `src/server/agent.ts:9`
- **Raised by:** software-architect code facts
- **Confidence:** Verified
- **Bears on:** S-4

### C-9: The entry points are referenced by path from outside TypeScript

- **Claim:** The `Makefile` names `src/server/server.ts` and `./src/ui/test-setup.ts`. `package.json` names
  `src/server/server.ts` and `src/server/scripts/check.ts`. `server.ts` imports `../ui/index.html`, and `index.html`
  loads `./styles.css` and `./app.tsx`.
- **Location:** `Makefile`, `package.json`, `src/server/server.ts:7`, `src/ui/index.html`
- **Raised by:** report S5, S10, B4, R10
- **Confidence:** Verified
- **Bears on:** D-2

### C-10: `agent-panel.tsx` only renders the Clear Chat button

- **Claim:** Since commit `c504d6c`, `AgentPanel` renders a heading and a Clear Chat button. The README still says it
  "shows the workspace's skills and agents".
- **Location:** `src/ui/agent-panel.tsx`, `README.md`
- **Raised by:** report S2, B11, R15
- **Confidence:** Verified
- **Bears on:** S-6, D-9

### C-11: `documents.test.tsx` mocks the editor by a relative specifier string

- **Claim:** `documents.test.tsx` calls `await import('./markdown-editor')` and `mock.module('./markdown-editor', …)`.
  These strings must name the same module `documents.tsx` imports. If they drift apart, the mock stops applying.
- **Location:** `src/ui/documents.test.tsx:169,171,191`
- **Raised by:** software-architect code facts
- **Confidence:** Verified
- **Bears on:** S-6

### C-12: Which features use each UI module

- **Claim:** The UI modules are used as follows (`grep` of the relative imports):
  - `api.ts`: `app.tsx`, `documents.tsx`, and `chat.tsx`.
  - `anchored-bubble.ts`: only `question-popup.tsx` and `selection-popup.tsx`.
  - `markdown-editor.tsx`: `documents.tsx`, and `app.tsx` for the `Ask` and `SelectionAsk` types.
  - `host-events.ts`: only `app.tsx`.
- **Location:** `src/ui/*.tsx`
- **Raised by:** report S14, and the structural-analyst mapping table
- **Confidence:** Verified
- **Bears on:** S-6, D-8, D-10

### C-13: Behavior findings that a restructure does not need

- **Claim:** The report found several behavior problems. None is caused by where a file sits:
  - C1: lost updates when tool calls run concurrently.
  - C2: the turn bookkeeping lives in `documents.tsx`.
  - C3 and C4: the EventBus does not isolate listeners or filter by session.
  - C5: tools ignore `abortSignal`.
  - B5: the `data-session` payload is not checked at runtime.
  - B10: `PUT /api/documents` does not validate its body.
  - S15 and B9: path confinement is implemented twice.
- **Location:** see the report
- **Raised by:** report R2, R3, R4, R5, R7, R9, R11
- **Confidence:** Verified in the report. Some parts rest on third-party runtime behavior the report labels Unverified.
- **Bears on:** Cut for Scope

## Findings No Agent Could Audit

- **Live model behavior:** how often the model issues parallel tool calls (report C1).
- **Bun WebSocket behavior:** whether Bun's `ws.send` throws on a closing socket (report B6).

Neither affects a pure file move. Every other evidence class was covered.

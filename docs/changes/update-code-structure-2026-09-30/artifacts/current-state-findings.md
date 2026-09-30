# Current State Findings: Update the Code Structure

## Provenance

These findings come from the prior report
[architectural-analysis.md](architectural-analysis.md) (2026-09-30, medium: structural, behavioral, concurrency, risk,
and software-architect). They were extracted rather than re-derived. The planning run re-read the importers of
`fake-claude-on-path` and `ClaudeMode` with grep on the same day to confirm C-1 and C-2 still hold.

## Project Context

- **Stack:** Bun + TypeScript. Hono server, React UI bundled by Bun from `src/ui/index.html`, ProseMirror + Yjs editor.
  Tests are `bun test` (server suite, then UI suite preloaded with happy-dom). `make test` type-checks first.
- **Conventions source:** No CLAUDE.md or project-discovery.md. The README section "How `src/` is laid out" and the
  prior change set [restructure-by-feature](../../restructure-by-feature/) (its decisions D-1 to D-22) are the
  conventions.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** `chat/tools/tools.ts` (10 changes in 90 days) and `ui/documents/markdown-editor/markdown-editor.tsx`
  (26) are the most-changed files. The churn list also names pre-restructure paths that no longer exist (report S11).

## Gaps

- No ADR or coding standard records the layout rules. The README and the prior change set's decision log are the only
  record.
- No test runs `server.ts`, the UI bundle, or the compiled binary. `make check-build` exists but is not part of
  `make test` (report B2, R1).

## Findings

### C-1: A test helper pair lives inside one chat component but serves three

- **Claim:** `fake-claude-on-path.ts` and `fake-claude.ts` sit in `chat/claude-cli/`, and the tests of three chat
  components (`sessions`, `claude-backend`, `claude-cli`) import the helper.
- **Location:** `src/server/chat/claude-cli/fake-claude-on-path.ts`, `src/server/chat/claude-cli/fake-claude.ts`
- **Evidence:**
  ```
  src/server/chat/sessions/sessions.test.ts:10:import { fakeClaudeOnPath } from '../claude-cli/fake-claude-on-path';
  src/server/chat/claude-backend/claude-backend.test.ts:8:import { fakeClaudeOnPath } from '../claude-cli/fake-claude-on-path';
  src/server/chat/claude-cli/claude-cli.test.ts:9:import { fakeClaudeOnPath } from './fake-claude-on-path';
  ```
- **Raised by:** report S1, B9, A1.
- **Confidence:** Verified.
- **Bears on:** S-1, D-4, D-5.

### C-2: The helper finds its fake by its own folder, so the pair must stay together

- **Claim:** `fake-claude-on-path.ts` copies `fake-claude.ts` from its own folder, so the two files must be siblings.
  Nothing else references `fake-claude.ts`, and it imports only `node:fs`.
- **Location:** `src/server/chat/claude-cli/fake-claude-on-path.ts:18`
- **Evidence:**
  ```ts
  await copyFile(join(import.meta.dir, 'fake-claude.ts'), join(bin, 'claude'));
  ```
- **Raised by:** report B9, S10 item 2.
- **Confidence:** Verified.
- **Bears on:** S-1, D-5.

### C-3: `ClaudeMode` is defined in shared but reached through the command-line parser

- **Claim:** `ClaudeMode` is defined once in `shared/wire.ts`. `command-line.ts` imports it and re-exports it, and three
  server files import it from `command-line.ts` instead of from shared.
- **Location:** `src/server/command-line.ts:4-6`, `src/server/agent-host.ts:5`, `src/server/chat/agent/agent.ts:7`,
  `src/server/chat/claude-backend/claude-backend.ts:5`
- **Evidence:**
  ```ts
  // command-line.ts
  import type { ClaudeMode } from '../shared/wire';

  export type { ClaudeMode };
  ```
  ```
  src/server/agent-host.ts:5:import type { ClaudeMode } from './command-line';
  src/server/chat/agent/agent.ts:7:import type { ClaudeMode } from '../../command-line';
  src/server/chat/claude-backend/claude-backend.ts:5:import type { ClaudeMode } from '../../command-line';
  ```
- **Raised by:** report S3, B5, A2.
- **Confidence:** Verified.
- **Bears on:** S-2, S-3, D-6, D-7.

### C-4: Several files are addressed by string paths that `make test` never checks

- **Claim:** `paths.ts`, `server.ts`, `scripts/check.ts`, `ui/index.html` with `app.tsx` and `styles.css`,
  `ui/test-setup.ts`, `src/skills`, and `src/fixtures` are named by string paths in the Makefile, `package.json`,
  `SRC`-relative joins, and the HTML. Moving any of them passes `make test` and breaks the build or startup.
- **Location:** `src/server/paths.ts`, `Makefile`, `package.json`, `src/ui/index.html`
- **Evidence:**
  ```ts
  export const SRC = resolve(import.meta.dir, '..');
  ```
- **Raised by:** report B1, B2, B3, R1 (High), A3.
- **Confidence:** Verified for the strings. Unverified for what `Bun.Glob.scanSync` does on a missing `src/skills`,
  because nothing was run.
- **Bears on:** D-8 (none of these files moves), the Risks section.

### C-5: Module singletons must keep one definition each

- **Claim:** `pending` in `server/components/json-file.ts`, the editor's `undoManagers` and PluginKeys in
  `markdown-editor.tsx`, and `schema` in `shared/markdown.ts` depend on there being one module instance.
- **Location:** `src/server/components/json-file.ts`, `src/ui/documents/markdown-editor/markdown-editor.tsx`,
  `src/shared/markdown.ts`
- **Evidence:**
  ```ts
  const pending = new Map<string, Promise<void>>();
  ```
- **Raised by:** report B6, C1, C6, R3, A4.
- **Confidence:** Verified.
- **Bears on:** D-8, Deferred (YAGNI).

### C-6: Only one test uses unchecked string module paths, and this change does not touch it

- **Claim:** The only relative `mock.module` or dynamic `import()` strings are in `ui/documents/documents/documents.test.tsx`
  (lines 229, 231, 251), all for `'../markdown-editor/markdown-editor'`.
- **Location:** `src/ui/documents/documents/documents.test.tsx`
- **Evidence:**
  ```ts
  mock.module('../markdown-editor/markdown-editor', ...)
  ```
- **Raised by:** report S10 item 5, R2, A5.
- **Confidence:** Verified.
- **Bears on:** Risks.

## Findings No Agent Could Audit

- The compiled binary and a real server start were not run by the analysis. `make check-build` and a server start
  close this gap, and the change units run them.
- Whether the model issues parallel tool calls (report C2) depends on the runtime model. It bears only on a deferred
  follow-up, not on this change.

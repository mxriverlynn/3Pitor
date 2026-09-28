---
title: "Architectural Analysis: src/ (server, ui, shared)"
focus_area: "src/server, src/ui, src/shared (plus src/server/scripts/check.ts)"
size: "medium — three adjacent subsystems (45 source files) with an async/WebSocket concurrency signal; no data, DevOps, or cross-service seam"
roster: "structural-analyst, behavioral-analyst, concurrency-analyst, risk-analyst, software-architect"
git_available: "yes"
generated: "2026-09-28"
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

This report looks at how `src/` is put together, to guide a restructure into package → feature → component folders.

Each analysis section below is one specialist agent's output, copied unedited. The Executive Summary is the only part
written for this report.

- **Executive Summary.** The findings that matter most for the restructure, and what to do about them.
- **Structural, Behavioral, and Concurrency Analysis.** Each specialist's findings, with file paths and code. IDs
  (`S#`, `B#`, `C#`) stay the same for the life of this report, so later documents cite them.
- **Risk Assessment.** `R#` items that score the findings by likelihood, severity, blast radius, and reversibility.
- **Software-Architecture Recommendations.** `A#` recommendations, including a full target tree.
- **System-level concerns deferred.** None were found; the section says why.

> Sizing and roster: this run was classified **medium** and dispatched structural-analyst, behavioral-analyst,
> concurrency-analyst, risk-analyst, and software-architect.

> Sections not part of this run: No Security, Data-Engineering, DevOps, On-Call, or Codebase Map section. The focus area
> has no auth, schema, infrastructure, or cross-service code, and the driving concern is file organization.

---

## Executive Summary

**Bottom line:** The code is small, cohesive, and already split by feature inside flat package folders. The restructure
is safe **only if** two path calculations that assume a fixed folder depth are fixed first. Two pieces of cross-package
code also have to move into `src/shared`.

**Focus area:** `src/server`, `src/ui`, and `src/shared`, plus the end-to-end script `src/server/scripts/check.ts`.
The content folders `src/skills` and `src/fixtures` are included only where code reaches them by path.

**Most critical findings:**

- **R1: two path calculations break silently when files move deeper (Critical; S8, S9, B2, B3).**
  - `workspace.ts` computes `SRC = resolve(import.meta.dir, '..')`. Moving it one level deeper points `SRC` at the
    wrong folder, and an already-seeded `src/.data/workspace` folder hides the failure.
  - `app-skills.macro.ts` computes `join(import.meta.dir, '../skills')`. Moving it can make the build embed no app
    skills at all, with no error.
- **S4 / S13 / R6: a UI test imports server code.** `markdown-editor.test.tsx` imports `postBlocks` from
  `../server/tools`. It does so to prove that the UI's textblock walk (`blocksOf`, which collects each block's text
  from the document in order) matches the server's. The two walks are duplicate code across packages.
- **C1 / S6 / R3: one piece of per-turn state spans three files.** `TurnTexts` is unsynchronized mutable state:
  `sessions.ts` creates it, `agent.ts` passes it through, and `tools.ts` changes it. Splitting these into separate
  feature folders would hide the hazard and turn `sessions.ts → tools.ts` into an import across features.
- **C2 / R2: the chat turn's bookkeeping lives in `documents.tsx`.** `beginTurn` and `applyEdited` are wired to chat
  only through `app.tsx`. This is correct today, but the pairing must stay visible after the move.
- **S15 / B9 / R5: "stay inside the workspace" is implemented twice.** The two copies handle symlinks differently.
  Unifying them changes behavior, so it is a separate follow-up.

**Highest-impact recommendations:**

- **A1:** One anchor module, `src/server/paths.ts`, at a fixed depth, plus a guard test. Everything that needs `SRC`
  imports it, including the macro. This removes the only Critical risk.
- **A3:** `sessions.ts`, `agent.ts`, and `tools.ts` stay together in one server feature, with `test-model.ts` alongside.
- **A4:** Move the textblock walk into `src/shared/blocks.ts`, with no imports. This removes the only UI → server
  import.
- **A2:** Entry points stay at their package roots, so the `Makefile` and `package.json` need no edits: `server.ts`,
  `agent-host.ts`, `app.tsx`, `index.html`, `styles.css`, `css.d.ts`, `test-setup.ts`.

**Clean dimensions and omitted domains:**
- **B13:** `TurnTexts` is scoped to one turn and does not leak across turns or sessions. Keep it that way.
- **`src/shared`:** Its three modules have zero imports and are already the target end state.
- **Behavior findings are left for follow-ups.** C1 locking, C3/C4 event bus isolation and filtering, C5 tool
  cancellation, B5 runtime validation, B10 input validation, and R5 path confinement each change behavior. The
  restructure does not make any of these changes.
- **Omitted domains:** none. The size-classification cap did not cut any domain that qualified for inclusion.

---

## Structural Analysis

> Verbatim output from `structural-analyst`.

Static structural analysis of `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src`, focused on `src/server`, `src/ui`, `src/shared`, and `src/server/scripts/check.ts`, one layer outward in each direction. Git is available; churn/commit-message analysis included. No CLAUDE.md/lint config/tsconfig path-aliases/workspaces field exist, so "packages" are directory conventions only, not tool-enforced.

## Findings

**S1: The "documents" server feature has no domain file and no unit tests**
- **Dimension:** Boundaries
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/documents.routes.ts`
- **Finding:** Every other server feature pairs a domain file with a `*.routes.ts` file and a `*.test.ts`/`*.routes.test.ts` (sessions, workspace-config, tools+agent, workspace). `documents.routes.ts` has neither a `documents.ts` domain file nor any `documents.routes.test.ts` — all its logic, including workspace-escape checking, is inlined in the routes file:
```ts
function docPath(name: string): string {
    const path = resolve(workspace, name);
    if (relative(workspace, path).startsWith('..')) throw new Error('path escapes workspace');
    return path;
}
```
  The only coverage is one e2e scenario in `src/server/scripts/check.ts` ("documents: save and load over REST"). `events.routes.ts` has the same gap (no `events.routes.test.ts`).
- **Impact:** When mapping files into a `documents` feature folder, there is no domain/test pairing to carry over — the feature folder will be routes-only by design, which is fine, but it means the feature's only safety net during the move is the e2e script, not a fast unit suite.

**S2: `agent-panel.tsx` no longer matches its feature name or the README's description**
- **Dimension:** Boundaries
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/agent-panel.tsx`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/agent-panel.test.tsx`, `README.md`
- **Finding:** README states `agent-panel.tsx` "shows the workspace's skills and agents." The current file is 11 lines and does only this:
```tsx
export function AgentPanel({ onClearChat }: { onClearChat: () => void }) {
  return (
    <div className="side-head">
      <h2>Agent</h2>
      <button onClick={onClearChat}>Clear Chat</button>
    </div>
  );
}
```
  Commit `c504d6c` ("Replace the agent panel's skill and agent list with a Clear Chat button") removed the skill/agent listing. No UI code calls `/api/workspace-config` anymore (`grep -rn "workspace-config" src/ui` returns nothing), so that server endpoint (`workspace-config.routes.ts`) is currently only exercised by the check script and server tests, not by the UI.
- **Impact:** Treating "agent panel" as a standalone feature (per the suggested ui feature list) now means the whole feature is one button that clears the chat session — a responsibility that is really about the `chat` feature, not a distinct "agent" concern. This affects where the file should land in a feature-per-folder scheme and whether it should keep its own folder at all.

**S3: Package boundaries are directory-naming only, not enforced by tooling — and are already crossed**
- **Dimension:** Boundaries
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/tsconfig.json`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/package.json`
- **Finding:** There is one flat `package.json` (no `workspaces` field), one `tsconfig.json` with `"moduleResolution": "bundler"` and no `paths` aliases, and no ESLint/Biome config anywhere in the repo. Nothing prevents a file in `src/ui` from importing `src/server` or vice versa. This is confirmed by two real crossings found by import analysis (see S4, S5), not assumed from directory names alone.
- **Impact:** A package→feature→component reorg that relies on directory placement to signal "this is server-only" or "this is ui-only" code has no compiler/lint backstop; a future cross-package import (like S4) can be added again silently after the reorg.

**S4: A UI test file imports directly from the server package**
- **Dimension:** Coupling
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/markdown-editor.test.tsx:8`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/tools.ts`
- **Finding:**
```ts
import { postBlocks } from '../server/tools';
```
  This pulls `src/server/tools.ts` into a UI test's module graph, which in turn imports `ai`, `zod`, `prosemirror-markdown`, `node:fs`, `node:path`, and `./workspace-config` (which itself pulls in the `app-skills.macro.ts` Bun macro). The test exists specifically to assert server/UI parity:
```ts
test('splits a post into the same blocks as the server does, so a quote the server accepts is one the editor finds', () => {
  ...
  expect(postBlocks(md).length).toBe(5);
  expect(blocksOf(doc).map((b) => b.text)).toEqual(postBlocks(md));
});
```
- **Impact:** This is a deliberate, real ui→server efferent coupling at test time (not incidental). Relocating `markdown-editor.test.tsx` into a feature subfolder changes the required relative depth to `tools.ts` (`../server/tools` → `../../server/tools` or similar depending on where `tools.ts` ends up), and relocating `tools.ts` into a feature subfolder on the server side compounds the update. It is also the one place `bun test src/ui` transitively depends on the entire server package compiling correctly.

**S5: `server.ts` imports `../ui/index.html` as a composition-root cross-package dependency**
- **Dimension:** Coupling
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/server.ts:7`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/index.html:11`
- **Finding:**
```ts
import homepage from '../ui/index.html';
```
  Bun bundles the entire UI from this HTML entry point. `index.html` itself references the UI's own entry file by relative path: `<script type="module" src="./app.tsx"></script>`. Both are plain relative-path references resolved by Bun's bundler, not TypeScript path aliases — an IDE "rename/move" refactor will not update either reference for you.
- **Impact:** This is an expected, legitimate composition-root dependency (server must serve the UI), but it depends on both `server.ts` and `index.html`/`app.tsx` staying at their package roots. If a reorg nests either entry point under a feature-style folder (e.g., `src/ui/app/index.html` while `app.tsx` stays at `src/ui/app.tsx`, or vice versa), the pairing breaks with only a build/runtime failure to signal it, not a compile error on the HTML side.

**S6: `sessions.ts` bypasses `agent.ts` and imports `tools.ts` directly**
- **Dimension:** Coupling
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/sessions.ts:4,7`
- **Finding:**
```ts
import { agentSettings, modelErrorMessage, type AgentOptions } from './agent';
...
import { editedTexts, turnTexts } from './tools';
```
  `sessions.ts` gets its model/instructions/tools bundle from `agent.ts` (`agentSettings`), but reaches past `agent.ts` directly into `tools.ts` for turn-scoped post state (`turnTexts`, `editedTexts`). `agent.ts` also imports `fileTools` and `TurnTexts` from the same `tools.ts` (`src/server/agent.ts:8`). So `tools.ts`'s `TurnTexts` type and its `turnTexts`/`editedTexts` functions are consumed independently by two different features (session lifecycle, and per-turn agent tool assembly), not mediated through a single owner.
- **Impact:** If the reorg puts `agent.ts` + `tools.ts` under one "agent" feature folder and `sessions.ts` under a separate "sessions" feature folder, `sessions.ts` will have a direct cross-feature import into `agent`'s internals (`tools.ts`) in addition to its import of `agent.ts` itself — worth deciding explicitly whether `TurnTexts`/`turnTexts`/`editedTexts` are part of the "agent" feature's public surface or a genuinely shared concern that belongs in a `components/` location scoped to exactly {sessions, agent}.

**S7: `test-model.ts` is a shared test helper used by two different features, with no scoped home**
- **Dimension:** Coupling
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/test-model.ts`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/sessions.test.ts:11`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/agent.test.ts:7`
- **Finding:** Both test files import identically:
```ts
import { scriptedModel, useModel } from './test-model';
```
  `test-model.ts` (a scripted stand-in for the Anthropic model) is consumed by exactly `sessions.test.ts` (sessions feature) and `agent.test.ts` (agent feature) — no other file imports it.
- **Impact:** Per the driving concern's own rule ("shared between exactly the features that share it"), this is a textbook candidate for a `components/`-style scoped location shared by {sessions, agent} rather than living loose at the server package root. Left where it is, both feature folders will need a same-depth relative import (`../test-model` or similar) into a location that isn't clearly owned by either.

**S8: `workspace.ts`'s `SRC` constant is computed from `import.meta.dir` and is depth-sensitive**
- **Dimension:** Coupling
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/workspace.ts:6,8,11`
- **Finding:**
```ts
// Paths are anchored to src/ so the scripts work from any working directory.
export const SRC = resolve(import.meta.dir, '..');

const FIXTURE = join(SRC, 'fixtures/workspace');
...
export const dataDir = (name: string) => join(SRC, '.data', name);
```
  This assumes `workspace.ts` lives exactly one directory below `src/` (i.e. at `src/server/workspace.ts`, so `import.meta.dir` is `.../src/server` and one `..` reaches `.../src`). `SRC` is consumed well outside the "workspace" feature: `src/server/agent.test.ts:9`, `src/server/workspace-config.test.ts:6`, `src/server/workspace-config.routes.test.ts:6`, and `src/server/scripts/check.ts:5,8,85`.
- **Impact:** Nesting `workspace.ts` one level deeper under a feature folder (e.g. `src/server/workspace/workspace.ts`) — exactly what a package→feature→component reorg would naturally do — silently recomputes `SRC` to `.../src/server` instead of `.../src`. That breaks `FIXTURE` (workspace seeding), `dataDir` (`.data/` paths), and cascades into every consumer above, with no compiler error — it would surface only as a runtime "file not found" the first time a test or `check.ts` runs. This is the single highest-risk path-sensitive spot found.
Unverified: did not execute the move and run the code to observe the failure, because file modification is out of scope; this is a static read of the path arithmetic, not an observed runtime failure.

**S9: `app-skills.macro.ts`'s embed path is also `import.meta.dir`-depth-sensitive**
- **Dimension:** Coupling
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/app-skills.macro.ts:10`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/workspace-config.ts:6`
- **Finding:**
```ts
const dir = join(import.meta.dir, '../skills');
```
  Same pattern as S8: this assumes the macro file sits exactly one level under `src/` (`src/server/app-skills.macro.ts` → `../skills` → `src/skills`). It is loaded via a relative macro import from `workspace-config.ts`:
```ts
import { appSkillFiles } from './app-skills.macro' with { type: 'macro' };
```
- **Impact:** Moving `app-skills.macro.ts` (with or without `workspace-config.ts`) into a nested feature folder such as `src/server/workspace-config/app-skills.macro.ts` changes `import.meta.dir` and makes `'../skills'` resolve to `src/server/skills` (nonexistent) instead of `src/skills`. Since this runs as a bundle-time macro that embeds skill file contents into the compiled server, the failure mode is empty/broken embedded skills rather than a clear compiler error — directly matches the user's explicit callout that this file "resolves src/skills by relative path."

**S10: `check.ts` spawns `server.ts` via a hardcoded literal string path, not a static import**
- **Dimension:** Coupling
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/scripts/check.ts:85`
- **Finding:**
```ts
const server = Bun.spawn(['bun', 'run', join(SRC, 'server/server.ts')], {
```
  `'server/server.ts'` is a plain string segment, not an ES import specifier. TypeScript's compiler and any IDE "rename/move file" refactor will not detect or update it if `server.ts` is relocated.
- **Impact:** Combined with S8 (this same file also depends on `SRC` from `workspace.ts`), `check.ts` has two independent path assumptions about the server package's internal layout. A reorg that keeps `server.ts` at the server package root (as an entry point, analogous to `app.tsx`) leaves this intact, but that's an assumption worth confirming explicitly during the move rather than relying on the string continuing to be correct by accident.

**S11: The server's headless tool logic depends on a UI-affine rendering library to match the editor's text segmentation**
- **Dimension:** Dependency Direction
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/tools.ts:8,146-152`
- **Finding:**
```ts
import { defaultMarkdownParser } from 'prosemirror-markdown';
...
export function postBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  defaultMarkdownParser.parse(markdown).descendants((node) => {
    if (node.isTextblock) blocks.push(node.textContent);
  });
  return blocks;
}
```
  The Highlight tool's block-matching (server, headless, no HTTP/DOM) depends on `prosemirror-markdown`, a library chosen for the browser rich-text editor, specifically so its output byte-matches the editor's own block segmentation (see S13). `package.json` lists all ProseMirror packages (`prosemirror-view`, `prosemirror-menu`, `prosemirror-example-setup`, `prosemirror-keymap`, etc.) as flat top-level `dependencies` with no separation between server-needed and UI-only ones.
- **Impact:** This is a deliberate, documented coupling (comment: "the same blocks the editor shows, so a quote it accepts is one the editor can find"), not an accident — but it does mean core business logic (what a Highlight tool call is allowed to reference) depends on a rendering-technology choice rather than the other way around. If the UI ever changes editor technology, `tools.ts` must change in lockstep with no interface boundary between them beyond the shared test in S13.
Unverified: did not run `make build` and inspect the compiled binary's dependency graph to confirm the UI-only ProseMirror packages (`prosemirror-view`, `prosemirror-menu`, `prosemirror-example-setup`, `prosemirror-keymap`) are actually tree-shaken out of the server executable, because that requires a build step outside static analysis.

**S12: High-churn, widely-shared files are driven by feature growth, not defect fixes — but `wire.ts` combines high churn with symmetric cross-package afferent coupling**
- **Dimension:** Dependency Direction
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/shared/wire.ts`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/app.tsx`
- **Finding:** Per-file commit counts (`git log --name-only --pretty=format:"" -- src | sort | uniq -c | sort -rn`): `app.tsx` 15, `chat.tsx`/`chat.test.tsx` 12 each, `documents.tsx` 10, `markdown-editor.tsx` 9, `tools.ts` 9, `server.ts` 9, `check.ts` 9, `wire.ts` 8, `sessions.ts` 8, `agent.ts` 8. A full-history scan for fix-labeled commits (`git log --pretty=format:"%s" | grep -ic "fix"`) returned **0** — every commit subject in the repository is additive/refactor phrasing (e.g. "Add a Highlight tool...", "Apply the AI's edits in the editor instead of on disk", "Remove tool approvals..."). `wire.ts` (`src/shared/wire.ts`) is imported, largely as types, by files across both packages (`sessions.ts`, `tools.ts`, `agent.ts`, `events.ts`, `check.ts` on the server side; `documents.tsx`, `chat.tsx`, `host-events.ts`, `markdown-editor.tsx` on the UI side) and has changed in 8 of the repo's commits as new wire shapes (`SessionHighlights`, `Passage`, task events) were added.
- **Impact:** This churn is healthy feature-growth churn, not thrash — consistent with `app.tsx`'s documented role as the one file that "wires features together" (it is expected to touch every added feature) and `wire.ts`'s role as the shared contract. The structural risk is narrower than raw churn suggests: `wire.ts` is the one module both packages depend on symmetrically (per S3, with no compiler-enforced package boundary), so a future shape change there is the most likely single point where a UI/server mismatch could be introduced silently.
Unverified: could not confirm the true chronological spread of this churn, because every commit in `git log` carries the identical date `2026-09-28`, indicating a squashed or rebased history; counts reflect commit frequency by file, not elapsed real-world time or a genuine "last 90 days" window.

**S13: `postBlocks` (server) and `blocksOf` (UI) are two independent implementations of the same tree-walk, reconciled only by a cross-package test**
- **Dimension:** Abstraction
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/tools.ts:146-152`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/markdown-editor.tsx:86-92`
- **Finding:**
```ts
// server/tools.ts
export function postBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  defaultMarkdownParser.parse(markdown).descendants((node) => {
    if (node.isTextblock) blocks.push(node.textContent);
  });
  return blocks;
}
```
```ts
// ui/markdown-editor.tsx
export function blocksOf(doc: Node): { text: string; pos: number }[] {
  const blocks: { text: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) blocks.push({ text: node.textContent, pos: pos + 1 });
  });
  return blocks;
}
```
  Both walk a ProseMirror node tree collecting textblock content in document order, using the identical predicate (`node.isTextblock`). The only thing proving they stay in agreement is the cross-package test in S4 (`expect(blocksOf(doc).map((b) => b.text)).toEqual(postBlocks(md))`), not a shared implementation. `src/shared/` already holds `findQuote` (which consumes exactly this kind of block-text array) with zero imports, so both sides already have a working precedent for putting algorithm-level parity code there.
- **Impact:** A future edit to one walk (e.g., handling a new node type) has no structural signal that the other needs the same change — only the test catches drift, and only if someone runs `bun test src/ui`, which itself now depends on the server package compiling (S4). This is a genuine missing-abstraction case, not incidental duplication: the shared test exists specifically because the two implementations must agree.

**S14: `Ask`/`SelectionAsk` shapes are duplicated as inline prop types instead of reused**
- **Dimension:** Abstraction
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/markdown-editor.tsx:158,216`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/question-popup.tsx:15-27`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/selection-popup.tsx:17-32`
- **Finding:** `markdown-editor.tsx` exports:
```ts
export type Ask = { passage: Passage; anchor: HTMLElement };
...
export type SelectionAsk = { markdown: string; anchor: HTMLElement };
```
  `app.tsx` imports and uses these types directly (`import type { Ask, SelectionAsk } from './markdown-editor';`), but the popups that actually receive this data redeclare the same shape inline instead of importing it:
```ts
// question-popup.tsx
export function QuestionPopup({
  passage, anchor, busy, text, onText, onSend, onClose,
}: {
  passage: Passage;
  anchor: HTMLElement;
  ...
```
```ts
// selection-popup.tsx
export function SelectionPopup({
  markdown, anchor, busy, onSend, onClose,
}: {
  markdown: string;
  anchor: HTMLElement;
  ...
```
- **Impact:** Low-medium: if `Ask`/`SelectionAsk` grow a field, TypeScript won't force the popup prop types to follow, since they aren't actually the same declared type — only conventionally identical today. Worth deciding, during the "popups" feature grouping, whether `markdown-editor` should own and export these shapes for `popups` to import, given the two already sit in a producer/consumer relationship mediated by `app.tsx`.

**S15: Two independent implementations of "confine a path to the workspace" exist, with different symlink handling**
- **Dimension:** Duplication
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/documents.routes.ts:8-12`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/tools.ts:156-173`
- **Finding:**
```ts
// documents.routes.ts
function docPath(name: string): string {
    const path = resolve(workspace, name);
    if (relative(workspace, path).startsWith('..')) throw new Error('path escapes workspace');
    return path;
}
```
```ts
// tools.ts
export function resolveInWorkspace(workspace: string, filePath: string): string {
  const realWorkspace = realpathSync(workspace);
  const target = realTarget(resolve(realWorkspace, filePath));
  if (relative(realWorkspace, target).startsWith('..')) throw new Error(`${filePath} is outside the workspace`);
  return target;
}
```
  Both implement the same concept — resolve a name against the workspace root and reject anything that escapes it via `relative(...).startsWith('..')` — but `tools.ts`'s version additionally resolves real paths (`realpathSync`) to defend against symlink escapes, and `documents.routes.ts`'s version does not.
- **Impact:** Structural duplication of a boundary-check concept across two files with no shared implementation to keep them aligned; a future hardening change made in one (as already happened once, given `tools.ts`'s extra `realTarget`/`realpathSync` logic) has no structural mechanism to propagate to the other. (A lower-priority, related observation: `Bun.Glob` is invoked independently with slightly different options in `documents.routes.ts`, `workspace-config.ts`'s `scan()` helper, `tools.ts`'s `Glob` tool, and `app-skills.macro.ts` — four ad hoc call sites with no shared helper, worth a glance but lower impact than the path-confinement duplication above.)
Unverified: did not exercise either function against a symlinked workspace at runtime to confirm exploitability, because this is a static-structure comparison, not a runtime security assessment; the finding describes divergent implementations of the same concept, not a verified vulnerability.

## Structural Summary

- **Focus area analyzed:** `src/server` (16 non-test .ts files + 8 test files + `scripts/check.ts`), `src/ui` (13 non-test .ts/.tsx files + 7 test files + `index.html`/CSS), `src/shared` (3 files + 3 tests), one layer outward via `package.json`, `tsconfig.json`, `Makefile`, and full `git log` history (64 commits).
- **Key concerns:**
  1. Two `import.meta.dir`-based relative path computations (`workspace.ts`'s `SRC`, S8; `app-skills.macro.ts`'s skills-embed path, S9) hardcode "exactly one directory below `src/`" and will silently break — with no compiler error — if the corresponding files are nested one level deeper under a feature folder, which is precisely what the planned reorg would do to them if not handled deliberately.
  2. The `src/server`/`src/ui`/`src/shared` boundary is a naming convention only (no lint rule, no path aliases, no per-package `package.json`), and is already crossed twice in real code: a UI test importing server code (S4) and the server importing the UI's HTML entry point (S5, expected/legitimate but still a plain relative path).
  3. Two pairs of independently-maintained, structurally-identical logic exist with no shared implementation: the ProseMirror textblock walk (`postBlocks`/`blocksOf`, S13, guarded only by a cross-package test) and the workspace path-confinement check (`docPath`/`resolveInWorkspace`, S15, diverged in symlink handling).
- **Well-structured areas:**
  - `src/shared/` (`wire.ts`, `markdown-support.ts`, `passages.ts`) has zero imports in any of its three files, one responsibility per file, and is consumed symmetrically by both packages exactly as its own comments claim — a clean, stable foundation.
  - The `anchored-bubble.ts`/`.css` pair is already scoped to exactly its two consumers (`question-popup.tsx`, `selection-popup.tsx`) via ordinary relative imports, and its CSS reaches the bundle transitively through that same import rather than a separate registration step — this is already the pattern the driving concern asks for, just not yet given its own folder.
  - The domain/`*.routes.ts` split (sessions, workspace-config) is applied consistently and makes those two features easy to relocate as a pair.
  - The Makefile's test invocations (`bun test src/server src/shared`, `bun test --preload ./src/ui/test-setup.ts src/ui`) operate on whole package directories, and Bun's test runner recursively discovers `*.test.ts(x)` files regardless of nesting depth — so, aside from the explicit `./src/ui/test-setup.ts` preload path (which must move in lockstep with that file), the test commands themselves are resilient to internal feature-folder nesting.
- **Skipped dimensions:** None. All five dimensions were executed. Git was available, so churn analysis was performed; its main limitation (identical commit dates across the whole history, S12) is disclosed on the relevant finding.

## Proposed feature → file mapping (for the restructure to act on)

### `src/server`

| Feature / role | Files | Justification |
|---|---|---|
| **root (composition, not a feature)** | `server.ts`; `agent-host.ts` | `server.ts` is the entry point that mounts every feature's routes (README: "the entry point... mounts every feature's routes on one Hono app") — same category as `ui/app.tsx`, belongs at the package root, not inside any one feature. `agent-host.ts` only wires `EventBus` (events feature) + `Sessions` (sessions feature) together for `server.ts`'s sole use — pure glue between two features, not owned by either; keep beside `server.ts`. |
| **sessions** | `sessions.ts`, `sessions.routes.ts`, `sessions.routes.test.ts`, `sessions.test.ts` | Matches README's explicit feature ("sessions.ts: chat turns and cancelling"); consistent domain/routes/test set. Note (S6): also imports `tools.ts` directly, a cross-feature dependency into "agent" worth deciding on explicitly. |
| **agent** (agent + tools, per the suggested "agent/tools" grouping) | `agent.ts`, `agent.test.ts`, `tools.ts`, `tools.test.ts` | README separates "one chat turn's model, instructions, and tools" (`agent.ts`) from "the model's file tools" (`tools.ts`), but they're tightly coupled (`agent.ts` imports `fileTools`/`TurnTexts` from `tools.ts`) and have no independent callers — group as one feature. `test-model.ts` (S7) is a shared test helper for this feature's tests *and* sessions' tests; consider a components-style shared test-helper location scoped to {agent, sessions} rather than placing it inside just one. |
| **events** | `events.ts`, `events.routes.ts` | Matches README ("events.ts: the event bus. Its routes file is the WebSocket."). No test file exists (S1) — a gap to note, not a misplacement. |
| **documents** | `documents.routes.ts` | Matches README ("routes only"); no domain file and no unit test exist today (S1) — the feature folder will legitimately contain just this one file plus whatever test is added later. |
| **workspace-config** | `workspace-config.ts`, `workspace-config.routes.ts`, `app-skills.macro.ts`, `workspace-config.test.ts`, `workspace-config.routes.test.ts` | Matches README. `app-skills.macro.ts` has no other consumer than `workspace-config.ts`'s `with { type: 'macro' }` import — keep paired in the same folder so their relative import stays a same-directory reference; but see S9 — its internal `import.meta.dir`-relative reach to `src/skills/` must be re-derived for whatever new depth this folder ends up at. |
| **workspace** | `workspace.ts`, `workspace.test.ts` | Matches README/user's suggested list. Flag: `SRC`/`dataDir` (S8) are consumed by `agent.test.ts`, `workspace-config.test.ts`, `workspace-config.routes.test.ts`, and `scripts/check.ts` — i.e., by tests belonging to other features and by the dev script. If nested as a narrow feature folder, every one of those cross-feature/cross-tool consumers needs a correctly-adjusted relative import, and the `import.meta.dir` arithmetic inside `workspace.ts` itself must be re-derived for the new depth (S8) — this file is a stronger candidate for staying shallow (package-level) than a typical feature. |
| **scripts (dev tooling, not a feature)** | `scripts/check.ts` | Already isolated in its own `scripts/` folder per README ("`src/server/scripts/` holds the end-to-end check"); not part of `bun test` (doesn't match `*.test.ts`). Contains two path-sensitive references into the rest of the server package (S8, S10) that need re-verifying after any move, since they're a runtime-resolved constant and a spawned literal string, not statically-checked imports. |

### `src/ui`

| Feature / role | Files | Justification |
|---|---|---|
| **root (composition, not a feature)** | `app.tsx`; `api.ts`; `host-events.ts`; `index.html`, `styles.css`, `css.d.ts` | `app.tsx` is explicitly "the only file that knows about more than one feature" (its own comment) — package root, mirrors `server.ts`. `api.ts` (generic fetch helper) and `host-events.ts` (generic WebSocket hook, currently only consumed by `app.tsx`) are package-wide infrastructure, not feature-specific logic. `index.html`/`styles.css`/`css.d.ts` are the app-level entry/global-style/ambient-type files the README calls out alongside `app.tsx`. |
| **documents** | `documents.tsx`, `documents.css`, `documents.test.tsx` | Matches README & user's list. Imports the `markdown-editor` feature to render `Editor`'s content — a legitimate one-directional feature dependency (documents → markdown-editor), not a shared-component case. |
| **markdown-editor** | `markdown-editor.tsx`, `markdown-editor.css`, `markdown-editor.test.tsx` | Matches README & user's list. Its test file's import of `postBlocks` from `../server/tools` (S4) is the one relative path in the whole UI package that reaches into another package — must be re-pointed correctly regardless of how deep this feature folder ends up. |
| **chat** | `chat.tsx`, `chat.css`, `chat.test.tsx` | Matches README & user's list. |
| **agent-panel** | `agent-panel.tsx`, `agent-panel.css`, `agent-panel.test.tsx` | Kept as its own folder to match the user's suggested feature list, but flagged (S2): its only current behavior (a Clear Chat button) is really a chat-session concern; worth reconsidering whether this should be a component *of* `chat` rather than a sibling feature. |
| **popups** (feature), with a **components/** subfolder scoped to it | `question-popup.tsx`, `question-popup.test.tsx` (component); `selection-popup.tsx`, `selection-popup.css`, `selection-popup.test.tsx` (component); `anchored-bubble.ts`, `anchored-bubble.css` (shared component, scoped to exactly these two) | Matches the user's suggested "popups" feature. `anchored-bubble.ts`/`.css` is imported by exactly `question-popup.tsx` and `selection-popup.tsx` and nothing else — the textbook case for the driving concern's `components/` rule: shared between exactly the two components that share it, not promoted any higher. `question-popup.tsx` has no CSS of its own (its old `question-popup.css` was deleted in the most recent commit and folded into `anchored-bubble.css`) — confirms it now relies entirely on the shared component for styling. |

### `src/shared`

| Feature / role | Files | Justification |
|---|---|---|
| **(no feature nesting — package-level primitives)** | `wire.ts`, `markdown-support.ts`, `passages.ts`, plus their `.test.ts` files | Each file already has a single, narrow responsibility, zero imports, and is consumed symmetrically by both `server` and `ui`. There is no sub-grouping to make here; this package is the "shared between packages" location the driving concern describes, already correctly flat. The one candidate addition (not a move) is the block-walk logic from S13 (`postBlocks`/`blocksOf`), which is structurally the same kind of "both sides must agree" primitive as `findQuote` already here. |

Relevant paths referenced throughout (all absolute):
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/` (server.ts, agent-host.ts, agent.ts, tools.ts, sessions.ts, sessions.routes.ts, events.ts, events.routes.ts, documents.routes.ts, workspace-config.ts, workspace-config.routes.ts, app-skills.macro.ts, workspace.ts, test-model.ts, scripts/check.ts, and matching `*.test.ts` files)
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/` (app.tsx, api.ts, host-events.ts, documents.tsx, markdown-editor.tsx, chat.tsx, agent-panel.tsx, question-popup.tsx, selection-popup.tsx, anchored-bubble.ts, index.html, styles.css, css.d.ts, and matching `.css`/`.test.tsx` files)
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/shared/` (wire.ts, markdown-support.ts, passages.ts)
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/Makefile`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/package.json`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/tsconfig.json`


---

## Behavioral Analysis

> Verbatim output from `behavioral-analyst`.

Runtime behavioral analysis of /Users/mxriverlynn/dev/mxriverlynn/3pitor/src, focused on the browser→chat→agent→tools→UI loop, the EventBus/WebSocket path, document load/save, and workspace-config/skills loading, with special attention to what a package→feature→component reorg could silently break.

All four dimensions were executed. Findings below are numbered independently of dimension; each cites file paths and verbatim code.

---

**B1: Highlight-block parity between server and UI is an unenforced, duplicated contract — not shared code**

- **Dimension:** Data Flow / Integration Boundaries
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/tools.ts` (lines 144–152), `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/markdown-editor.tsx` (lines 86–92)
- **Finding:** The `Highlight` tool's `quote` acceptance (server) and the editor's highlight rendering (UI) both depend on producing the *same ordered list of textblocks* from a post, so that an offset `findQuote` (in `src/shared/passages.ts`) computes on the server lines up with what the editor can decorate. But the block-extraction logic itself is duplicated, not shared:
  ```ts
  // src/server/tools.ts
  export function postBlocks(markdown: string): string[] {
    const blocks: string[] = [];
    defaultMarkdownParser.parse(markdown).descendants((node) => {
      if (node.isTextblock) blocks.push(node.textContent);
    });
    return blocks;
  }
  ```
  ```ts
  // src/ui/markdown-editor.tsx
  export function blocksOf(doc: Node): { text: string; pos: number }[] {
    const blocks: { text: string; pos: number }[] = [];
    doc.descendants((node, pos) => {
      if (node.isTextblock) blocks.push({ text: node.textContent, pos: pos + 1 });
    });
    return blocks;
  }
  ```
  The only thing keeping these in lockstep is a code comment ("the same blocks the server's postBlocks finds… so a quote it accepts is one the editor can find"). `findQuote` itself is correctly shared (`src/shared/passages.ts`, no imports), but the block-segmentation step that feeds it is not. `unsupportedMarkdown` (also correctly shared) is what keeps both sides on the same markdown subset, which is why this has held so far — but nothing enforces it.
- **Impact:** This is exactly the kind of runtime contract that crosses the server/UI package boundary described in the driving concern. If the reorg splits `tools.ts` and `markdown-editor.tsx` into different feature folders without extracting this block-listing logic into `src/shared/`, a future change to one side's textblock traversal (e.g. handling a new node type) can silently desync highlight offsets from what the editor draws — a quote the model is allowed to name may fail to highlight, or highlight the wrong span, with no compile-time signal.

---

**B2: `SRC` (import.meta.dir-derived) is a widely depended-on constant whose breakage is masked by an existing `.data/workspace` folder**

- **Dimension:** Integration Boundaries / State Management
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/workspace.ts` (lines 6–11, 30–33), consumed directly by `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/scripts/check.ts`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/agent.test.ts`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/workspace-config.test.ts`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/workspace-config.routes.test.ts`
- **Finding:**
  ```ts
  // Paths are anchored to src/ so the scripts work from any working directory.
  export const SRC = resolve(import.meta.dir, '..');
  const FIXTURE = join(SRC, 'fixtures/workspace');
  export const dataDir = (name: string) => join(SRC, '.data', name);
  ```
  This assumes `workspace.ts` sits exactly one level under `src/`. Grep confirms `SRC` is imported directly (not re-exported through an index) by four other files across the server package and its tests. If the reorg nests `workspace.ts` one level deeper (e.g. into a `workspace/` feature folder), `SRC` silently computes a wrong-but-plausible path (`src/server` instead of `src`).
  Critically, the failure is masked in the common dev loop:
  ```ts
  export async function ensureWorkspace(path: string): Promise<string> {
    if (!(await exists(path))) await cp(FIXTURE, path, { recursive: true });
    return path;
  }
  ```
  Once `src/.data/workspace` already exists (true for any repo that's been run before), `ensureWorkspace` returns immediately without ever touching the now-broken `FIXTURE`. `bun run server` keeps working. The break only surfaces on a fresh checkout/CI (no `.data/workspace` yet) or via `bun run check`, which unconditionally calls `resetWorkspace` (always `rm` + `cp(FIXTURE, …)`), and then fails with a plain `ENOENT` pointing at a wrong path rather than at the real cause (a moved file).
- **Impact:** A reorg can pass local manual testing (`bun run server` against an already-seeded workspace) while being broken for fresh environments and for the E2E check — the very tool meant to catch this kind of regression.

---

**B3: `app-skills.macro.ts`'s directory computation breaks at build time, with the app's skills silently vanishing rather than the build failing to compile**

- **Dimension:** Integration Boundaries
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/app-skills.macro.ts` (lines 9–14), consumed by `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/workspace-config.ts` (line 6, 29)
- **Finding:**
  ```ts
  export function appSkillFiles(): Record<string, string> {
    const dir = join(import.meta.dir, '../skills');
    const files: Record<string, string> = {};
    for (const path of [...new Bun.Glob('**/*.md').scanSync({ cwd: dir })].sort()) files[path] = readFileSync(join(dir, path), 'utf8');
    return files;
  }
  ```
  This is a Bun macro: it runs when the *importing file* is bundled/transpiled, using the macro file's own `import.meta.dir`. I confirmed empirically that `Bun.Glob(...).scanSync({ cwd })` throws `ENOENT` when `cwd` doesn't exist. So moving `app-skills.macro.ts` to a different depth relative to `src/` breaks the build loudly (an ENOENT during `bun build`/`bun run`) — but the error message only says "no such file or directory, open '…/wrong/skills'", giving no hint that the real cause is a moved macro file's `import.meta.dir`. Worse: if the reorg happens to leave *some* directory at the wrong computed path (e.g. a leftover empty folder, or a folder that coincidentally exists), the glob returns zero matches with **no error at all** — `APP_SKILL_FILES` becomes `{}`, and the app's own skills (`collaborative-draft-editing`) silently disappear from every workspace.
  Per the README, this class of bug is caught only by `make check-build` / `bun run check skill`, not by `make test`:
  ```
  # Checks the app's skills are inside build/3pitor: … fails unless the workspace config it serves
  # lists collaborative-draft-editing. `make test` does not run it.
  ```
- **Impact:** `workspace-config.ts` and `app-skills.macro.ts` must move together and stay at the same depth relative to `src/skills/`. A silent-empty failure mode (vs. a loud ENOENT) is possible and would not be caught by the unit test suite, only by the build-check target.

---

**B4: `server.ts`'s HTML import of the UI, and the UI's own relative asset graph, are rigid path couplings across the eventual package boundary**

- **Dimension:** Integration Boundaries
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/server.ts` (line 7), `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/index.html`
- **Finding:**
  ```ts
  import homepage from '../ui/index.html';
  ```
  ```html
  <link rel="stylesheet" href="./styles.css" />
  <script type="module" src="./app.tsx"></script>
  ```
  Bun resolves the HTML import and its internal `<link>`/`<script>` references as real module graph edges (this is how "Bun bundles it from `src/ui/index.html`, so there is no separate build step" per the README). Unlike B2/B3, this class of breakage fails at bundle-resolution time (a hard "module not found"), so it is comparatively safe — but it does mean `server.ts` and `src/ui/index.html` cannot move independently, and `index.html`, `app.tsx`, and `styles.css` cannot move independently of each other, without updating these paths. `package.json`'s `"server"` script (`bun run src/server/server.ts`) and the `Makefile`'s `bun build --compile --production src/server/server.ts` also hardcode the current entry point location.
- **Impact:** Lower severity than B2/B3 because it fails loudly, but it is a concrete list of paths that must be updated in lockstep (server.ts ↔ ui/index.html ↔ ui entry files ↔ package.json ↔ Makefile) if the reorg relocates the server entry point or the UI's HTML shell.

---

**B5: The `data-session` SSE payload is trusted via an unchecked type assertion at the server→UI deserialization boundary**

- **Dimension:** Data Flow / Integration Boundaries
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/chat.tsx` (lines 99–103), `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/documents.tsx` (lines 114–148)
- **Finding:**
  ```ts
  onFinish: ({ message, isAbort, isError, isDisconnect }) => {
    if (isAbort || isError || isDisconnect) return;
    const session = message.parts.findLast((part) => part.type === 'data-session') as { data: SessionData } | undefined;
    if (session && !session.data.aborted) onTurnFinished(session.data);
  },
  ```
  The cast `as { data: SessionData } | undefined` is a compile-time-only assertion; nothing validates the shape of the part actually received over SSE against the `SessionData` interface in `src/shared/wire.ts`. Downstream, `onTurnFinished` calls `docs.applyEdited(data.edited)`, which immediately does `Object.keys(edited)` — if a future server change ever omits `edited` (or a bug on either side produces a differently-shaped `data-session` part), this throws uncaught inside a React event callback rather than failing at a well-defined boundary.
- **Impact:** `SessionData`/`HostEvent` in `src/shared/wire.ts` are correctly the single shared type definitions (a good pattern), but there is no runtime schema check at either serialization boundary (server writing the part, or UI reading it) — the contract is enforced only by both sides independently agreeing to import the same TypeScript type, which offers no runtime safety net once code on either side of the boundary is edited independently (as a feature-based reorg encourages).

---

**B6: `EventBus.emit` has no per-listener isolation**

- **Dimension:** Error Propagation / State Management
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/events.ts` (lines 14–16)
- **Finding:**
  ```ts
  emit(event: HostEvent) {
    for (const listener of this.listeners) listener(event);
  }
  ```
  There is no try/catch around each listener call. This bus is invoked synchronously from two very different call sites — `sessions.ts`'s turn-completion (`this.events.emit({ type: 'turn-finished', ... })`) and `agent.ts`'s subagent `report()` callback inside a tool's `execute`. If any one subscriber throws (e.g. a WebSocket connection in a closing state, or any future listener that does I/O), the exception both (a) aborts delivery to every other subscriber for that event, and (b) propagates back into the emitting feature's call stack (sessions.ts / agent.ts), which has nothing to do with the failing subscriber.
  Unverified: could not inspect Bun's internal `ws.send()` behavior on a closing/closed WebSocket to confirm it throws in practice (vs. silently no-op'ing or queuing), because that is native runtime behavior outside the project's source.
- **Impact:** A single misbehaving event consumer can interrupt event delivery to unrelated consumers and inject an unrelated error into the sessions/agent feature's control flow. Relevant to the reorg because `events.ts` (bus), `events.routes.ts` (WebSocket), and `sessions.ts`/`agent.ts` (emitters) would likely land in different feature folders, making this coupling easy to overlook.

---

**B7: `/ws/events` broadcasts every session's events to every connected client — no session scoping**

- **Dimension:** State Management (shared mutable state / trust boundary)
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/events.routes.ts` (lines 9–20), `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/events.ts`
- **Finding:**
  ```ts
  onOpen: (_event, ws) => {
    unsubscribe = events.subscribe((event) => ws.send(JSON.stringify(event)));
  },
  ```
  `EventBus` is a single process-wide instance (created once in `agent-host.ts`'s `createAgentHost`) shared by every `Sessions.chat()` call and every subagent `Task` tool invocation, regardless of which browser tab/session initiated them. Every WebSocket client subscribes to the *entire* stream — `HostEvent` carries a `sessionId` field, but nothing in `events.routes.ts` filters by it. Any tab open against the server receives `task` and `turn-finished` events for every other session running on that server.
- **Impact:** This is process-global shared state with no partitioning by session/feature ownership — relevant to the reorg's "which state is owned by which feature" question: `events.ts` currently owns state that is *not* scoped to the `sessions` feature even though most of its content originates there.

---

**B8: The EventBus → WebSocket → `useHostEvents` path is currently a no-op in the browser, and its content is never asserted anywhere**

- **Dimension:** Data Flow / State Management
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/app.tsx` (line 53), `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/host-events.ts`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/scripts/check.ts` (lines 15, 130–132)
- **Finding:** Confirmed via `git log -p` that this is deliberate, recent, and not leftover WIP:
  ```ts
  // current app.tsx
  const connected = useHostEvents(() => {});
  ```
  ```diff
  // from `git log -p src/ui/app.tsx` (commit "Remove tool approvals now that the AI's edits never reach disk")
  -  const connected = useHostEvents((event) => {
  -    if (event.type === 'approval-resolved') setApprovals((a) => ({ ...a, [event.approvalId]: event.allow }));
  -  });
  +  const connected = useHostEvents(() => {});
  ```
  All real task/turn-finished handling in the UI today comes through the *per-turn SSE stream* (`data-task` / `data-session` parts written directly by `agent.ts`'s `report()` and `sessions.ts`), not through the WebSocket. The WebSocket only drives the "events connected/disconnected" dot.
  Separately, `check.ts` collects every WS message into `events: any[]` (line 15, populated at line 132) but this array is never read or asserted in any of the eleven scenarios — only `dataOf(turn, 'data-task')` (from the SSE stream) is checked.
- **Impact:** Today, nothing in the test suite or the shipped UI verifies that `EventBus` → `/ws/events` → client actually delivers correct event *content* — only that the socket connects. A reorg that touches `events.ts`/`events.routes.ts` risks a silent regression in event delivery with no automated signal. This also means the "events" feature's current runtime footprint is much smaller than its file footprint suggests — worth knowing before deciding how much shared-package ceremony it deserves.

---

**B9: The "stay inside the workspace" path-containment contract is implemented twice, with different guarantees, across what will likely become two feature folders**

- **Dimension:** Integration Boundaries (trust boundary)
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/tools.ts` (lines 156–161, 192–195), `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/documents.routes.ts` (lines 8–12)
- **Finding:** The AI's file tools use a symlink-resistant check:
  ```ts
  export function resolveInWorkspace(workspace: string, filePath: string): string {
    const realWorkspace = realpathSync(workspace);
    const target = realTarget(resolve(realWorkspace, filePath));
    if (relative(realWorkspace, target).startsWith('..')) throw new Error(`${filePath} is outside the workspace`);
    return target;
  }
  ```
  (with `realTarget` walking up to resolve symlinks even for not-yet-existing paths, e.g. a new file from `Write`). The plain REST document endpoints, however, use a naive check with no symlink resolution:
  ```ts
  function docPath(name: string): string {
    const path = resolve(workspace, name);
    if (relative(workspace, path).startsWith('..')) throw new Error('path escapes workspace');
    return path;
  }
  ```
  Both are the same conceptual contract — "keep the request inside the workspace folder" — but one dereferences symlinks and one doesn't. A symlink placed inside the workspace root would be blocked for the model's tools but not for `GET/PUT /api/documents/:name`.
- **Impact:** If the reorg splits `tools.ts` (agent/tools feature) from `documents.routes.ts` (documents feature) without noticing they implement the same boundary check differently, the divergence is easy to either (a) permanently ossify as "intentional" when it's likely accidental drift, or (b) accidentally propagate the weaker version when consolidating into a shared helper. This is a strong candidate for a single shared `resolveInWorkspace`-style utility.

---

**B10: `PUT /api/documents/:name` has no input-shape validation, unlike the analogous chat endpoint, and empirically crashes with a generic 500 on a malformed body**

- **Dimension:** Error Propagation
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/documents.routes.ts` (lines 25–29), contrast with `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/sessions.routes.ts` (lines 17–19)
- **Finding:**
  ```ts
  app.put('/api/documents/:name', async (c) => {
    const { content } = await c.req.json<{ content: string }>();
    await Bun.write(docPath(c.req.param('name')), content);
    return c.json({ ok: true });
  });
  ```
  `content` is never checked to be a string. I verified directly (running this route in isolation) that a body without `content` produces:
  ```
  TypeError: Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write
  status: 500
  body: Internal Server Error
  ```
  The real cause (missing/malformed `content`) is visible only in the server's own stderr/log, not to the caller. This is inconsistent with `sessions.routes.ts`'s handling of the structurally similar "markdown text from the browser" input:
  ```ts
  if (documents !== undefined && !isDocuments(documents)) {
    return c.json({ error: 'documents must map file names to markdown' }, 400);
  }
  ```
- **Impact:** Two features (`documents`, `sessions`) that both accept "markdown text from the editor" over HTTP have diverging rigor at effectively the same kind of boundary. Failures here are indistinguishable from any other server bug (generic 500), which will make it harder to reason about correctness after these routes are split into separate feature folders with less side-by-side visibility.

---

**B11: `GET /api/workspace-config` is no longer called from the browser — an orphaned but still-live browser↔server contract**

- **Dimension:** Integration Boundaries / Data Flow
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/workspace-config.routes.ts`, `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/agent-panel.tsx`
- **Finding:** `grep -rn "workspace-config" src/ui` returns nothing. `agent-panel.tsx` was reduced, per `git log` (commit `c504d6c`, "Replace the agent panel's skill and agent list with a Clear Chat button"), to:
  ```tsx
  export function AgentPanel({ onClearChat }: { onClearChat: () => void }) {
    return (
      <div className="side-head">
        <h2>Agent</h2>
        <button onClick={onClearChat}>Clear Chat</button>
      </div>
    );
  }
  ```
  The route itself is still mounted in `server.ts` and is only exercised today by `src/server/scripts/check.ts`'s "config: app and workspace skills…" scenario and `workspace-config.routes.test.ts`.
- **Impact:** Low runtime risk (the endpoint still works), but worth flagging before the reorg: this is currently a server-only-consumed contract, not a live browser↔server one. Treating it as tightly coupled to a UI "feature" during the reorg would misrepresent its actual current data flow — its real consumers are the E2E script and its own test.

---

**B12: App skills (build-time, frozen) vs. workspace skills (scanned fresh per turn) is an implicit, easy-to-miss state-freshness split, hinging on a module-level singleton**

- **Dimension:** State Management (implicit/module-level state)
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/workspace-config.ts` (line 29), `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/agent.ts` (line 44)
- **Finding:**
  ```ts
  // The app's own skills from src/skills/, embedded when the server is bundled; keys are relative to that folder.
  export const APP_SKILL_FILES: Record<string, string> = appSkillFiles();
  ```
  This runs once, at module load (fed by the Bun macro at bundle time), and is held for the life of the process — a module-level singleton. Meanwhile:
  ```ts
  // Reads the workspace config on every call, so a skill added between turns shows up on the next one.
  export async function agentSettings(...)
  ```
  rescans `.claude/skills` and `.claude/agents` from disk on every single chat turn. Both feed into the *same* unified `loadWorkspaceConfig()` result (`{ skills, agents }`), so the two different freshness policies are invisible at the call site — a caller of `loadWorkspaceConfig` cannot tell, from the return type, which entries are live and which are frozen at build time.
- **Impact:** This is documented in prose (README: "After editing `src/skills/`, restart the server") but not enforced or visible in the type system. Anyone extending `workspace-config.ts` after a reorg (e.g. adding a third skill source) could easily assume uniform freshness and introduce a subtle bug (either an unnecessary rescan of embedded skills, or code that expects hot-reload of app skills that will never happen without a restart).

---

**B13 (well-handled, negative result): `TurnTexts` is correctly scoped and does not leak across turns or sessions**

- **Dimension:** State Management
- **File(s):** `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/tools.ts` (lines 17–29), `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/sessions.ts` (line 65)
- **Finding:** `Sessions.chat()` creates a fresh `TurnTexts` object per call — `const turn = turnTexts(this.options.workspace, documents);` — and passes the *same reference* through `agentSettings` → `fileTools(workspace, turn)` into the `Read/Write/Edit/Glob/Highlight` tool closures, and again into the `Task` subagent tool's `files` (built from the same `turn`). This gives a single, consistent, mutable working copy for one turn (including nested subagent calls), with no shared state across turns or sessions — the object is local to the `chat()` call's closure and is discarded once `editedTexts(turn)`/`turn.highlights` are read out at the end. The `Sessions` class itself also cleanly encapsulates its `Map<string, Session>` as a private field, with the concurrency guard (`if (session.abort) throw …`) executed synchronously before the stream's `execute` callback begins, correctly preventing two concurrent turns per session without a lock.
- **Impact:** None — flagged as a positive finding. This is a clean example of state correctly owned by a single feature (`sessions`) and correctly scoped to a single unit of work, which the reorg should preserve as-is (keep `TurnTexts` construction inside the `sessions`/turn-execution path, not hoisted to a shared or longer-lived location).

---

### Behavioral Summary

- **Focus area analyzed:** Full chat-turn round trip (browser → `POST /api/sessions/:id/chat` → `sessions.ts` → `agent.ts` → `tools.ts` → SSE → `chat.tsx`/`documents.tsx` merge and highlight), the `EventBus` → `/ws/events` → `useHostEvents` path, document load/save (`documents.routes.ts` ↔ `documents.tsx`), and workspace-config/skills loading (`workspace-config.ts`, `app-skills.macro.ts`, `workspace.ts`) — traced one layer outward from each, including the shared `src/shared/*` modules and the `check.ts` end-to-end script that exercises all of it.
- **Key concerns:**
  1. Two `import.meta.dir`-relative path computations (`workspace.ts`'s `SRC`, `app-skills.macro.ts`'s skills directory) are depth-relative to `src/` and will silently or semi-silently break if the reorg nests these files deeper — and one failure mode (B2) is actively masked by an already-seeded `.data/workspace` folder in any repo that's been run before, meaning local testing after a reorg move could pass while CI/fresh-checkout/`bun run check` fail.
  2. The highlight pipeline's block-segmentation logic (B1) and the workspace-containment check (B9) are each duplicated across what will become separate feature folders, with no shared source of truth enforcing parity — prime candidates for consolidation into `src/shared/` or a shared server utility as part of the reorg, not just organizational cleanup.
  3. The `EventBus`/WebSocket path (B6, B7, B8) is architecturally a global, unscoped broadcast with no per-listener error isolation, and today has essentially no consumer in the browser and no test coverage of its content — worth deciding deliberately whether it belongs in a `sessions`-adjacent feature or a genuinely cross-cutting `events` module before the reorg, rather than defaulting to "it's called EventBus so it must be shared infrastructure."
- **Well-handled areas:** `TurnTexts` scoping (B13) is clean and should be used as the model for how ephemeral per-turn state is handled elsewhere. The shared `src/shared/*` modules (`wire.ts`, `passages.ts`, `markdown-support.ts`) genuinely have no imports and are consumed symmetrically by both `src/server` and `src/ui`, exactly as the README describes — this part of the "shared package" boundary is already sound and is a good precedent for what else (e.g. B1's block-listing logic, B9's path-containment logic) should be moved there.
- **Skipped dimensions:** None fully skipped. Two items rest on third-party runtime behavior I could not fully verify from source alone: (a) whether Bun's `ws.send()` actually throws on a closing/closed socket (noted inline on B6), and (b) the exact internals of the `ai` SDK's `createUIMessageStream`/tool-`execute` error handling once an error escapes after the stream's final part has already been written — I did not deep-dive into the `ai` package's internals for that, so I limited related claims to what's directly verifiable in this repo's code (the presence/absence of try/catch, and the top-level `onError` handlers actually registered in `sessions.ts`).


---

## Concurrency Analysis

> Verbatim output from `concurrency-analyst`.

## Initial Detection

Concurrency patterns are present and central to this codebase: `AbortController`/`abortSignal` (turn cancellation), the AI SDK's internal `Promise.all` fan-out over model-requested tool calls (confirmed by reading `node_modules/ai/dist/index.js`), an in-process pub/sub `EventBus`, a Bun WebSocket relay, React `useEffect`/async event handlers racing against user input, and a Yjs CRDT document that must merge AI edits with concurrent local typing. Full five-dimension analysis follows.

---

**C1: Concurrent tool calls in one model step race on shared per-turn state (`TurnTexts`)**

- **Dimension:** Race Conditions
- **File(s):** `src/server/tools.ts` (lines 17-50, 79-140), `src/server/sessions.ts` (lines 45-77), `src/server/agent.ts` (lines 45-64)
- **Finding:** `Sessions.chat()` builds one `TurnTexts` object per turn (`turnTexts(this.options.workspace, documents)`) and hands it to `agentSettings` → `fileTools(options.workspace, turn)`. Every tool closure captures the *same* mutable `turn` object:
```ts
// tools.ts
function markEdited(turn: TurnTexts, name: string, text: string) {
  turn.texts.set(name, text);
  turn.edited.delete(name);
  turn.edited.add(name);
}
...
const Edit = tool({
  execute: async ({ file_path, old_string, new_string }) => {
    const name = postName(workspace, file_path);
    const text = await postText(name, file_path);       // read
    const count = text.split(old_string).length - 1;
    ...
    const next = text.replace(old_string, () => new_string);
    refuseUnsupported(name, text, next);
    markEdited(turn, name, next);                        // write, after an await gap
    return `edited ${name}`;
  },
});
```
I verified in `node_modules/ai/dist/index.js` (`executeTools`, ~line 6967, and the streaming step handler at ~line 9091) that when a model returns multiple tool calls in one step, the AI SDK executes them with `Promise.all(toolCalls.map(async toolCall => executeToolCall(...)))` — genuinely interleaved, with no per-resource locking anywhere in `executeToolCall` (confirmed at line 3673). Every file tool in `tools.ts` (`Read`/`Write`/`Edit`/`Highlight`) has a read (`postText`/`turn.texts.get`) separated from a write (`markEdited`/`turn.highlights = ...`) by an `await`, so two tool calls in the same step — e.g. two `Edit` calls on the same post, or an `Edit` and a `Highlight` on the same post, or a `Write` racing an `Edit` — can both read the pre-change text, both compute a result, and both write, with the second write silently clobbering the first (`Write`/`Edit` both return a success string to the model even though one edit is lost). `Highlight`'s validation (`findQuote(blocks, quote)`) can likewise be checked against text that a concurrent `Edit` is simultaneously replacing.
- **Impact:** A lost-update / TOCTOU race: the model can be told two tool calls both "succeeded" while one file's change is silently dropped from `turn.edited`/`turn.texts`, so `editedTexts(turn)` (read at the end of `Sessions.chat()`, sessions.ts line 93) returns a result the model never sees was wrong — the user's editor receives a merge that's missing one of two edits the model believes it made, with no error surfaced anywhere. Because `TurnTexts` and its mutators (`markEdited`, `fileTools`) live in `tools.ts` while the object's lifecycle (creation, abort-gated consumption) is owned by `sessions.ts`, and `agent.ts` is the pass-through, **this three-file unit must stay co-located** in any feature restructure — splitting "tool execution" from "turn/session lifecycle" into separate feature folders would make it easy to lose sight of the fact that `TurnTexts` is unsynchronized shared mutable state, and any future fix (e.g. per-file locking, or serializing tool execution) needs all three files touched together.
- Unverified: could not observe live model behavior to confirm how often Claude actually issues multiple tool calls in a single step for this app's prompts, because that depends on runtime model decisions, not something inspectable via static reading; the vulnerable code path exists regardless of frequency.

---

**C2: Turn-scoped reconciliation state is split across the chat and documents UI modules, held together only by call-order discipline**

- **Dimension:** Race Conditions
- **File(s):** `src/ui/documents.tsx` (lines 32-36, 99-148), `src/ui/chat.tsx` (lines 65-94, 109-113), `src/ui/app.tsx` (lines 31-39)
- **Finding:** `useDocuments()` owns turn-scoped bookkeeping that only makes sense in relation to a chat turn: `turnBases`, `turnSaves`, `turnFile` refs, and the `beginTurn`/`applyEdited` pair:
```ts
// documents.tsx
const beginTurn = useCallback(() => {
  const documents: Record<string, string> = {};
  turnBases.current.clear();
  turnSaves.current.clear();
  turnFile.current = currentRef.current;
  for (const [name, entry] of entries.current) {
    turnSaves.current.set(name, entry.saves);
    ...
    turnBases.current.set(name, snapshot(entry.doc));
  }
  return { documents };
}, []);
```
```ts
// documents.tsx applyEdited
if (entry && !turnBase && entry.saves > (turnSaves.current.get(name) ?? 0)) {
  failed.push({ name, message: 'it was saved while the AI was working; ask again' });
  continue;
}
```
This state is fed into a network round trip owned by `chat.tsx`/`app.tsx`: `sendMessage({ text }, { body: { openFile, ...beginTurn() } })` (chat.tsx line 111), and reconciled later by `onTurnFinished: (data) => { docs.applyEdited(data.edited); docs.showHighlights(data.highlights); }` (app.tsx lines 35-38), which fires from an unrelated module (`useChat`'s `onFinish`) after an arbitrarily long SSE stream. Correctness depends on: (a) `beginTurn()` running synchronously at send time (it does — no `await` before it's spread into the request body, so this part is safe), and (b) the *same* `entries`/`turnBases`/`turnSaves` refs still being live and semantically valid when `applyEdited` runs, potentially much later, after the user has saved (`docs.save()`), switched files, or opened new documents in between. The `entry.saves > turnSaves` check exists specifically to detect one such interleaving (a save landing mid-turn), which shows the author is aware turn state and document state are genuinely concurrent — but this is a targeted patch for one case, not a general contract.
- **Impact:** This is exactly the kind of "per-turn state crossing feature boundaries" the restructure needs to protect: `beginTurn`/`applyEdited`/`turnBases`/`turnSaves`/`turnFile` are conceptually part of the *chat turn's* lifecycle, not the *documents* feature's, yet they live inside `useDocuments()` and are wired into the chat feature only via two callback props in `app.tsx`. If a feature-based restructure moves "documents" and "chat" into separate top-level folders and someone treats `beginTurn`/`applyEdited` as ordinary documents-feature internals (e.g., changes when/how often they run, or the shape of `entries`), the reconciliation invariant (turn's base snapshot must match the exact document entries that existed at send time) breaks silently — there's no type or runtime check enforcing that `turnBases`/`turnSaves` stay paired with `beginTurn`'s call. Any restructure must keep this triad (`beginTurn` call site in chat's send path, `applyEdited`/`showHighlights` call site in chat's finish path, and the turn-scoped refs themselves) documented as one cross-feature unit, not silently split.
- Unverified: could not trace `@ai-sdk/react`'s full stream-resume/reconnect logic (`resume` option, `reconnectToStream`) to confirm `onFinish` fires exactly once per turn in all network-interruption cases; this analysis assumes single-invocation based on the common-path read of `node_modules/@ai-sdk/react/dist/index.js`.

---

**C3: `EventBus.emit` has no per-listener fault isolation**

- **Dimension:** Async Errors
- **File(s):** `src/server/events.ts` (lines 14-16), `src/server/events.routes.ts` (lines 9-20), `src/server/sessions.ts` (line 96), `src/server/agent.ts` (lines 55-58)
- **Finding:**
```ts
// events.ts
emit(event: HostEvent) {
  for (const listener of this.listeners) listener(event);
}
```
```ts
// events.routes.ts
unsubscribe = events.subscribe((event) => ws.send(JSON.stringify(event)));
```
There is no `try`/`catch` around each listener invocation. If any listener throws — today that would require `JSON.stringify`/`ws.send` to throw, which Bun's `ServerWebSocket.send()` is typed to avoid (it returns a `ServerWebSocketSendStatus` number rather than throwing, per `node_modules/bun-types/serve.d.ts`) — the `for...of` loop in `emit` stops, and every listener registered after the throwing one in iteration order is silently skipped for that event. `emit` is called from `sessions.ts` (`turn-finished`) and `agent.ts`'s `report` (`task` events) with no error handling at the call site either.
- **Impact:** Today, with the single WS-relay listener type, this is latent rather than actively triggered. It matters for the restructure because `EventBus` is the one place multiple features are meant to share a subscription point (the file header says "sessions publish here; the event socket and scripts listen"). As the feature restructure adds more subscribers (in-process test hooks, future per-feature UI panels, `scripts/check.ts`), a single misbehaving listener taking down delivery to every other subscriber for that emit call becomes a real cross-feature failure mode with no isolation and no logging of the dropped event. This is worth fixing (wrap each listener call) before, not after, more subscribers are added during the restructure.
- Unverified: could not execute Bun's WebSocket runtime under adverse conditions (socket mid-teardown, serialization edge cases) to rule out every path by which `listener(event)` could throw; the "does not throw" claim rests on Bun's TypeScript type signature, not a runtime test.

---

**C4: The event bus broadcasts every session's events to every connected client, with no session-scoped filtering**

- **Dimension:** Resource Contention
- **File(s):** `src/server/events.ts`, `src/server/events.routes.ts`, `src/server/agent.ts` (line 84: `sessionId: ownerId`), `src/ui/host-events.ts`, `src/ui/app.tsx` (line 53)
- **Finding:** `TaskEvent` carries a `sessionId` (`{ type: 'task', sessionId: ownerId, ... }`, agent.ts line 84), and `turn-finished` events carry `sessionId` too (sessions.ts line 96), which implies these are meant to be attributable to one chat session — but nothing in `EventBus`, `eventSocket`, or `useHostEvents` filters by session. Every browser tab connected via `/ws/events` receives every session's task/turn events:
```ts
// events.routes.ts
onOpen: (_event, ws) => {
  unsubscribe = events.subscribe((event) => ws.send(JSON.stringify(event)));
},
```
Currently the UI consumer is a no-op (`useHostEvents(() => {})`, app.tsx line 53), so no cross-session leakage is currently observable in the UI, but the wire protocol and server plumbing already support many concurrent sessions writing into one shared, unpartitioned broadcast channel.
- **Impact:** If a future feature (per the restructure) wires `useHostEvents`'s handler up to something session-specific (e.g., showing subagent task progress for "this" chat), it will need to filter by `sessionId` itself — there is no enforcement anywhere that a consumer only sees its own session's events. This is exactly the "event bus subscribers" risk called out for the restructure: ownership of "which events belong to which feature/session" is implicit (a field on the payload) rather than structural, so co-locating "sessions" and "events" as separate features without carrying this filtering responsibility forward would let one open tab observe another session's task activity.

---

**C5: Turn cancellation is not honored by in-flight file tool operations**

- **Dimension:** Async Errors
- **File(s):** `src/server/tools.ts` (lines 64-140), `src/server/agent.ts` (lines 82-99), `src/server/sessions.ts` (lines 82-96)
- **Finding:** `Sessions.chat()` passes `abortSignal: abort.signal` to `streamText`, and `taskTool`'s subagent call explicitly forwards it: `execute: async (..., { abortSignal }) => { ... generateText({ ..., abortSignal }) ...}` (agent.ts lines 82-94). But none of `Read`, `Write`, `Edit`, `Glob`, or `Highlight` in `tools.ts` destructure or check the second `execute` argument (which the AI SDK does populate with a merged `abortSignal` per `executeToolCall` in `node_modules/ai/dist/index.js`, confirmed at line ~3673: `options: { toolCallId, messages, abortSignal: toolAbortSignal, ... }`):
```ts
// tools.ts — no abortSignal parameter anywhere in these signatures
const Edit = tool({
  ...
  execute: async ({ file_path, old_string, new_string }) => { ... },
});
```
Clicking "Stop" (`Sessions.cancel`) calls `abort.abort()`, but any `Edit`/`Write`/`Highlight` tool call already executing keeps running to completion and still mutates `turn.texts`/`turn.edited`/`turn.highlights`.
- **Impact:** Correctness is currently preserved only because `sessions.ts` gates the *output* on the abort flag (`edited: aborted ? {} : editedTexts(turn)`, line 93) — so a cancelled turn's stray mutations never reach the client. This is a fragile, one-hop safety net: it depends on `sessions.ts` remembering to re-check `abort.signal.aborted` at the single point where `turn` state is read back out. If a restructure moves that gating logic away from where `TurnTexts` is consumed (e.g., a future feature reads `turn.edited` from a different call site, or streams partial edits before the turn resolves), cancelled-but-still-running tool calls could leak into output that a "Stop"-pressing user no longer expects. The fix (checking `abortSignal` inside each tool's `execute`) and the fix's *absence* both need to travel with `tools.ts` wherever it lands in the restructure — they can't be reasoned about correctly without also seeing `sessions.ts`'s abort-gated read.
- Unverified: could not drive an end-to-end "click Stop mid-Edit" run to directly observe an in-flight `Edit` completing after cancellation; this is inferred from reading `tools.ts` (no `abortSignal` handling) against the AI SDK's `executeToolCall` (which does supply one), not from a live trace.

---

### Concurrency Summary

- **Focus area analyzed:** `src/server/{sessions,agent,tools,events,events.routes,sessions.routes,server}.ts` and `src/ui/{chat,documents,markdown-editor,host-events,app}.tsx`, plus supporting reads of `src/server/agent-host.ts`, `src/server/workspace-config.ts`, `src/server/documents.routes.ts`, and the `ai`/`@ai-sdk/react`/`bun-types` packages to verify framework-level concurrency behavior.
- **Concurrency model:** Single-threaded, event-loop concurrency throughout (Bun server, browser React app) — no OS threads, no traditional locks/mutexes/channels. Concurrency arises from: (1) the AI SDK's internal `Promise.all` fan-out over model-requested tool calls within one step, (2) independent async request lifecycles (chat SSE turn, document save PUT, workspace-config reload) that can interleave across `await` points, (3) an in-process pub/sub `EventBus` with WebSocket fan-out, and (4) Yjs as a CRDT specifically built to reconcile concurrent local typing with asynchronously-arriving AI edits.
- **Key concerns:** (1) C1 — the AI SDK's parallel tool execution genuinely races on the shared, unsynchronized `TurnTexts` object, which is the single most concrete data-corruption risk found and the one most requiring the sessions/agent/tools trio to stay co-located. (2) C2 — turn-scoped reconciliation state (`beginTurn`/`applyEdited`/`turnBases`/`turnSaves`) is owned by the documents module but its correctness contract is entirely about the chat turn's lifecycle, making it a prime candidate for silent breakage during a feature-based split. (3) C5 — cancellation is honored only at one downstream checkpoint (`sessions.ts`'s abort-gated read), not at the source (tool execution), so the "Stop button actually stops things" guarantee is more fragile than it looks.
- **Well-handled areas (negative results):**
  - `Sessions.chat()`'s single-flight turn guard (`if (session.abort) throw ...` then `session.abort = abort`) is fully synchronous with no `await` in between, so it cannot race even under concurrent HTTP requests for the same session — verified by reading the full function body.
  - `mergeMarkdown` (markdown-editor.tsx lines 72-82) correctly uses a base snapshot + state-vector diff and brackets the AI's change with `undoManagers.get(live)?.stopCapturing()` on both sides, which is the right way to let a CRDT merge coexist with concurrent local typing without corrupting either the document or the undo history.
  - `documents.tsx`'s `save()` recomputes `entry.dirty = markdownOf(entry.doc) !== content` *after* the `await`, so typing (or an AI merge) that lands while a save is in flight is correctly still marked dirty rather than silently considered saved.
  - `@ai-sdk/react`'s `useChat` uses a live `latestRef` pattern for `onFinish` (verified in `node_modules/@ai-sdk/react/dist/index.js`), so `onTurnFinished`'s closure over `docs` in `app.tsx` is never stale despite being threaded through a hook boundary — ruling out a classic React async-callback staleness bug.
  - `useHostEvents`'s WebSocket lifecycle (`ws.onclose = null` before `ws.close()` on unmount, `clearTimeout(retry)`) correctly prevents a reconnect timer from firing after the component using it has unmounted.
- **Skipped dimensions:** None skipped outright, but Deadlock analysis found no applicable primitives — there are no locks, mutexes, or blocking channel operations anywhere in this focus area; the only "hold and wait" structure is the model's own tool-call loop, which is bounded by `stepCountIs(maxSteps)` (sessions.ts) and `stepCountIs(10)` (agent.ts's subagent call), so no unbounded blocking chain exists.

---

## Risk Assessment

> Verbatim output from `risk-analyst`.

Risk-of-inaction assessment for `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src`, based on the full upstream findings in:
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/restructure-by-feature/artifacts/analysis-raw/structural.md` (S1–S15)
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/restructure-by-feature/artifacts/analysis-raw/behavioral.md` (B1–B13)
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/docs/changes/restructure-by-feature/artifacts/analysis-raw/concurrency.md` (C1–C5)

Git is available (64 commits, all dated 2026-09-28 — a squashed/rebased history, so churn counts reflect commit frequency, not elapsed real time). I verified dependency counts and callers with `grep`, and recency with `git log --oneline -- <file>` and `git show --stat -1 HEAD`. Each item below scores general risk-of-inaction and, where it diverges, risk specific to the planned package → feature → component restructure (feature-shared `components/` folders, cross-package code in a shared package).

---

**R1: `import.meta.dir`-relative path arithmetic silently recomputes to the wrong directory the moment the reorg nests these files one level deeper**

- **Addresses:** S8, S9, S10, B2, B3
- **Likelihood:** Near certain, specifically for the restructure — this is not a hypothetical trigger, it is the literal mechanical effect the planned move will have. `workspace.ts` computes `export const SRC = resolve(import.meta.dir, '..')` and `app-skills.macro.ts` computes `join(import.meta.dir, '../skills')`; both assume "exactly one directory below `src/`." Verified: `grep -rn "import.meta.dir" src` returns exactly these two lines. `SRC` is imported by 4 other files (`grep` confirms `agent.test.ts`, `workspace-config.test.ts`, `workspace-config.routes.test.ts`, `scripts/check.ts` all do `import { SRC ... } from './workspace'` or `'../workspace'`). Nesting `workspace.ts` under a `workspace/` feature folder (exactly what the proposed mapping does to every other server file) changes `import.meta.dir` and breaks all of them at once. `check.ts` additionally spawns the server via a hardcoded literal string (`Bun.spawn(['bun', 'run', join(SRC, 'server/server.ts')], ...)`, `src/server/scripts/check.ts:85`) which no IDE move/rename refactor tracks — a second, independent path assumption in the same file.
- **Severity:** Critical — B2 shows the failure is actively masked in local dev: `ensureWorkspace` short-circuits once `src/.data/workspace` already exists, so `bun run server` keeps working with a silently-wrong `SRC` on any machine that's run the app before; it only surfaces as a bare `ENOENT` (pointing at a wrong, misleading path) on a fresh checkout, in CI, or via `bun run check`. B3 is worse: if the miscomputed skills directory happens to resolve to *some* existing folder, `Bun.Glob(...).scanSync()` returns zero matches with **no error at all** — `APP_SKILL_FILES` becomes `{}` and the app's own skill (`collaborative-draft-editing`) vanishes from every workspace with nothing failing loudly. This matches the framework's Critical bar exactly: "corruption that is difficult to detect."
- **Blast radius:** Multi-module — `SRC`/`dataDir` cross into `workspace-config` tests, `agent` tests, and `scripts/check.ts` (4 consumers outside the `workspace` feature itself, confirmed by grep above); `app-skills.macro.ts` breakage cascades into `workspace-config.ts` and therefore every workspace the server serves.
- **Reversibility:** Moderate — once diagnosed, the fix (make the constant depth-independent, or re-derive it for the new nesting depth) is a small, contained change to 2 files. The real danger is mean-time-to-detection, not mean-time-to-repair: B2's masking means a broken move can ship past local testing and only fail for a teammate's fresh clone or in CI, well after the reorg PR merges.
- **Overall risk:** Critical (near-certain likelihood + critical severity meets the framework's Critical bar directly).
- **What happens if deferred:** The restructure proceeds, `workspace.ts` and/or `app-skills.macro.ts` get nested into feature folders per the plan, and the very next `bun run check` (or first fresh CI run, or first new contributor's checkout) fails with a misleading `ENOENT` that gives no hint the real cause is a moved file's relative path — or, in the app-skills case, doesn't fail at all and the app quietly ships without its skill, discovered only when someone notices `collaborative-draft-editing` is missing from a workspace.
- Unverified: could not execute the move and run the code to observe the failure firsthand, because file modification is out of scope for this assessment; this is a static read of the path arithmetic (`resolve`/`join` against `import.meta.dir`) combined with the masking behavior read directly from `ensureWorkspace`, not an observed runtime failure.

---

**R2: Turn-scoped reconciliation state (`beginTurn`/`applyEdited`/`turnBases`/`turnSaves`) is owned by the documents module but its correctness contract belongs to the chat turn — and this exact file cluster is the most actively-changing code in the repo**

- **Addresses:** C2
- **Likelihood:** Near certain. I checked recency directly: `git log --name-only --oneline -5` shows every one of the last 5 commits touches this exact cluster — `documents.tsx`, `chat.tsx`/`chat.css`, `app.tsx`/`app.test.tsx`, `markdown-editor.tsx`/`markdown-editor.test.tsx`, `question-popup.tsx`, `selection-popup.tsx`. The tip commit (`aa91eae`, HEAD) alone touched 16 files across exactly this set (126 lines added to `markdown-editor.tsx`, 89 new lines in `selection-popup.tsx`). This is not a dormant corner — it is the single most-changed area of the codebase, and any near-term feature work will touch it again.
- **Severity:** High — `beginTurn()` snapshots `entries`/`turnBases`/`turnSaves` synchronously at send time; `applyEdited()` reconciles against those same refs much later, after an arbitrarily long SSE stream, and the one interleaving the author explicitly guarded against (a save landing mid-turn) shows this is known-fragile. If a restructure treats `beginTurn`/`applyEdited` as ordinary `documents`-feature internals (plausible once `documents` and `chat` are separate top-level folders) and changes their call cadence or the shape of `entries`, the reconciliation invariant breaks silently — the user's editor could receive a merge missing an edit, or reconciled against stale document state, with no compiler error and no runtime error, only a CRDT merge that "succeeds" against the wrong base.
- **Blast radius:** Multi-module — the triad spans `documents.tsx` (owns the state), `chat.tsx`/`app.tsx` (drives `beginTurn` at send time and `applyEdited`/`showHighlights` at finish time), and transitively `markdown-editor.tsx` (the CRDT merge target). That's 3–4 files across what the proposed feature mapping treats as 3 separate features (documents, chat, markdown-editor).
- **Reversibility:** Difficult — fixing this after a silent break requires re-establishing invariant enforcement across all three call sites (chat's send path, chat's finish path, and the documents-owned refs), i.e. a coordinated multi-module change, not a local patch.
- **Overall risk:** High (near-certain likelihood + high severity + multi-module blast radius + difficult reversibility — clears the High bar on multiple dimensions simultaneously; falls short of Critical only because severity is High rather than Critical and blast radius is multi-module rather than system-wide).
- **What happens if deferred:** The restructure splits `documents` and `chat` into separate folders without documenting this triad as one cross-feature unit. The next feature added to either module (which, per the churn evidence, will happen soon) has a good chance of touching `beginTurn`, `applyEdited`, or the shape of `entries` without realizing the other side depends on exact pairing — producing an AI edit that silently fails to reconcile into the user's document, discovered only by a user noticing missing content days later.
- Unverified: could not trace `@ai-sdk/react`'s full stream-resume/reconnect logic to confirm `onFinish` (which drives `applyEdited`) fires exactly once per turn in every network-interruption case; this assessment inherits that limitation from the upstream finding and assumes the common-path single-invocation behavior.

---

**R3: Concurrent tool calls race on shared, unsynchronized `TurnTexts` — a silent lost-update that is also structurally split across the file boundary the restructure is about to formalize**

- **Addresses:** C1, S6
- **Likelihood:** Likely. Verified in `node_modules/ai/dist/index.js` per upstream (Promise.all fan-out over tool calls, no per-resource locking) — every file tool (`Read`/`Write`/`Edit`/`Highlight`) has a read-then-await-then-write pattern on the shared `turn` object (`src/server/tools.ts` lines 17-50, 79-140). This is not a rare edge case: `tools.ts` is under active, recent development (`git log --oneline -- src/server/tools.ts` shows 8 commits, the two most recent being "Have the AI hand over each highlighted passage's question" and "Add a Highlight tool that points the writer at passages of a post" — i.e. the exact feature most likely to co-occur with an `Edit` call in the same model step). `sessions.ts` also independently reaches past `agent.ts` directly into `tools.ts` for `turnTexts`/`editedTexts` (S6, confirmed: `src/server/sessions.ts:4,7`), so the object whose races matter is consumed by two features without a single mediating owner.
- **Severity:** Critical — this is a textbook silent lost-update: two tool calls in one step (e.g. two `Edit`s on the same post, or an `Edit` racing a `Highlight`) can both read pre-change text and both write, with the second write clobbering the first. Both calls still report success to the model, so the model itself never learns the file's real final state — this squarely matches the framework's Critical bar ("data loss... corruption that is difficult to detect").
- **Blast radius:** Multi-module — the unsynchronized state lives in `tools.ts`, is constructed and gated by `sessions.ts`, passed through `agent.ts`, and the corrupted result flows downstream into the UI's document reconciliation (R2 above) where the user actually sees the missing edit.
- **Reversibility:** Difficult — the fix (locking, serializing tool execution, or per-file conflict detection) necessarily touches `tools.ts`, `sessions.ts`, and `agent.ts` together; upstream's own conclusion is that "this three-file unit must stay co-located" in any feature split, which is itself evidence this isn't a local, single-file fix.
- **Overall risk:** High (Likely + Critical severity clears the High bar; not Critical overall because likelihood is Likely rather than Near-certain — it depends on the model actually choosing to issue parallel tool calls, which is plausible but not guaranteed every turn).
- **What happens if deferred:** If the restructure splits "tool execution" (tools.ts, under an `agent` feature) from "turn/session lifecycle" (sessions.ts, under a `sessions` feature) without an explicit decision to keep them mechanically coupled, the direct `sessions.ts → tools.ts` import (S6) becomes a formalized cross-feature dependency that obscures rather than documents the shared-mutable-state hazard — a future contributor fixing something in one feature folder has less structural signal that `TurnTexts` is unsynchronized shared state spanning both.
- Unverified: could not observe live model behavior to confirm how often Claude actually issues multiple tool calls in a single step for this app's prompts, because that depends on runtime model decisions rather than static analysis; the vulnerable code path exists regardless of observed frequency, which is why likelihood is rated Likely rather than Near-certain.

---

**R4: `wire.ts` is the one module both packages depend on symmetrically, and the one deserialization boundary that trusts it has no runtime check**

- **Addresses:** S12, B5
- **Likelihood:** Likely. Verified `wire.ts` has 16 importers spanning both packages (`grep -rln "from '.*wire'" src`): 9 in `src/ui` (`markdown-editor.tsx`, `question-popup.tsx`/`.test.tsx`, `app.test.tsx`, `chat.tsx`/`.test.tsx`, `host-events.ts`, `documents.tsx`, `markdown-editor.test.tsx`) and 6 in `src/server` (`agent.ts`/`.test.ts`, `sessions.ts`/`.test.ts`, `events.ts`, `scripts/check.ts`). It has changed in 8 of 64 commits as new wire shapes were added (`SessionHighlights`, `Passage`, task events) — an actively growing contract, not a frozen one. The one place it is consumed without validation is `src/ui/chat.tsx:99-103`: `message.parts.findLast(...) as { data: SessionData } | undefined` is a compile-time-only cast with no runtime shape check.
- **Severity:** High — downstream, `onTurnFinished` calls `docs.applyEdited(data.edited)`, which immediately does `Object.keys(edited)`. If a future server-side change to `SessionData` (very plausible given the churn above) ever omits `edited`, or either side is edited independently of the other (exactly what a feature-based reorg encourages, since `sessions.ts` and `chat.tsx` would live in different top-level folders), this throws uncaught inside a React event callback — a user-facing crash of the turn-completion handler with no well-defined error boundary.
- **Blast radius:** System-wide within the app's runtime graph — `wire.ts` is the single symmetric dependency point for both `src/server` and `src/ui` (16 importers, confirmed above); a shape drift here is the one place a mismatch could silently propagate to nearly every feature on both sides of the boundary.
- **Reversibility:** Moderate — adding runtime validation (e.g. a schema check at the SSE deserialization point) is a contained, well-understood fix, but it touches the serialization boundary on both the server (`sessions.ts`) and UI (`chat.tsx`) sides, so it isn't a pure single-file patch.
- **Overall risk:** High (Likely + High severity clears the High bar directly).
- **What happens if deferred:** The restructure moves `sessions.ts` and `chat.tsx` into separate feature folders (per the proposed mapping, they already are conceptually separate features) with `wire.ts` as their only shared contract. The next time either side changes `SessionData`'s shape without the other noticing — now easier, since post-reorg the two files have less side-by-side visibility than they do today at the shared package root — the failure surfaces as an uncaught exception in a live user session's turn-completion handler, not a compile error, because the cast at `chat.tsx:101` provides no actual runtime safety.
- Unverified: could not confirm the true chronological spread of `wire.ts`'s 8-commit churn, because every commit in `git log` carries the identical date `2026-09-28`, indicating a squashed or rebased history; the churn count reflects commit frequency by file, not elapsed real-world time, so "Likely" here is inferred from commit-count activity and import breadth rather than a genuine recency window.

---

**R5: Two independent "confine a path to the workspace" implementations, one with symlink resolution and one without — general risk is contained, but the restructure is the exact moment this either gets fixed or permanently ossifies as "intentional"**

- **Addresses:** S15, B9
- **Likelihood (general):** Possible — exploiting the weaker check (`documents.routes.ts`'s `docPath`) requires a symlink already placed inside the workspace root pointing outside it; in this app's current single-operator-workspace model that's a narrow, specific scenario, not a routine trigger.
- **Likelihood (restructure-specific):** Likely — the reorg is expected to split `tools.ts` (→ `agent` feature) from `documents.routes.ts` (→ `documents` feature) into separate folders. Once separated, the side-by-side visibility that currently makes the divergence noticeable (both files live at the same package-root level today) disappears, making it easy to either treat the divergence as permanently intentional or, if someone consolidates the two into a shared helper later without care, to propagate the *weaker* version rather than the stronger one.
- **Severity:** Medium in current context (this is a single-operator local workspace, not a multi-tenant server processing untrusted third-party symlinks — verified `documents.routes.ts` in full: `docPath` at lines 8-12 has no `realpathSync`) but the underlying concept is a trust-boundary check, so any future change to the app's trust model (e.g. multi-user workspaces) would elevate this to High/Critical without anyone revisiting this specific duplication.
- **Blast radius:** Single module today (`documents.routes.ts` + `tools.ts`'s `resolveInWorkspace`, verified via `grep -rn "resolveInWorkspace" src` — 5 real call sites in `tools.ts`, 6 in its own test file, zero shared with `documents.routes.ts`).
- **Reversibility:** Moderate — consolidating into one shared helper is a contained, two-call-site change, but requires a deliberate decision about which behavior (symlink-resolving vs. not) is correct, not just a mechanical merge.
- **Overall risk:** Medium generally; effectively High for the restructure window specifically, since the reorg is precisely the trigger that raises likelihood from Possible to Likely.
- **What happens if deferred:** The restructure relocates `documents.routes.ts` and `tools.ts` into separate feature folders without consolidating the two boundary checks. Either the divergence persists indefinitely (a security-relevant inconsistency nobody remembers is unintentional), or a future "cleanup" pass merges them by copying whichever implementation is closer at hand — a coin-flip that could just as easily standardize on the weaker, non-symlink-resolving version.
- Unverified: did not exercise either function against a symlinked workspace at runtime to confirm exploitability, because this is a static-structure comparison, not a runtime security assessment; this finding describes divergent implementations of the same concept, not a confirmed exploit.

---

**R6: `postBlocks`/`blocksOf` are duplicated tree-walks kept in sync only by a cross-package test whose own import path is fragile to the move**

- **Addresses:** S13, B1, S4
- **Likelihood:** Likely — `markdown-editor.tsx` is under heavy, recent development: `git log --oneline -- src/server/tools.ts` and the tip commit (`aa91eae`) both show active work in exactly this area (126 new lines in `markdown-editor.tsx` in the most recent commit alone, plus new Highlight/passage features in `tools.ts`). A change to either side's node-type handling is a plausible near-term event, not a remote edge case. The one thing enforcing parity is `src/ui/markdown-editor.test.tsx:8`'s `import { postBlocks } from '../server/tools'` — the single relative path in the whole UI package that reaches into the server package — which itself must be re-pointed (and its required depth recalculated) the moment either file moves under a feature folder.
- **Severity:** Medium — a drift produces a wrong/missing highlight match (a quote the model is allowed to reference fails to highlight, or highlights the wrong span), a degraded feature, not data loss or corruption.
- **Blast radius:** Multi-module — crosses the `src/server`/`src/ui` package boundary (`tools.ts` + `markdown-editor.tsx` + the one guarding test).
- **Reversibility:** Moderate — extracting the shared tree-walk into `src/shared/` (alongside the already-present `findQuote`, which consumes exactly this kind of output, per `src/shared/passages.ts`) is a well-precedented, contained fix.
- **Overall risk:** Medium (Likely + Medium severity does not clear the High bar; no two dimensions are simultaneously at their worst level).
- **What happens if deferred:** The reorg moves `tools.ts` under an `agent`/`tools` feature folder and `markdown-editor.tsx` under a `markdown-editor` feature folder without extracting the shared logic into `src/shared/`. The guarding test's import path needs updating regardless (a required, mechanical edit) — but there is a real chance that edit is done hastily (e.g., the test temporarily skipped "just to get the build green" during the move) which would silently remove the only signal that the two implementations still agree, right as both files are being touched by the move itself.

---

**R7: `EventBus.emit` has no per-listener isolation and no session-scoped filtering — low risk today because the only real consumer is inert, but the restructure is explicitly the moment more subscribers get added**

- **Addresses:** B6, B7, C3, C4, B8
- **Likelihood (general, today):** Unlikely — verified `src/ui/app.tsx:53` currently wires `useHostEvents(() => {})`, a deliberate no-op (confirmed via `git log -p` per upstream, not leftover WIP), and Bun's `ServerWebSocket.send()` is typed to return a status code rather than throw. `check.ts` collects WS messages into an array that's never asserted (B8) — so today, nothing in the test suite or shipped UI would even notice a delivery failure.
- **Likelihood (restructure-specific):** Likely — `EventBus` is explicitly the one place multiple features are meant to share a subscription point, and the restructure's own premise (feature growth, shared-package extraction) is exactly the scenario upstream flags as when "a single misbehaving listener taking down delivery to every other subscriber becomes a real cross-feature failure mode."
- **Severity:** Medium — event delivery interruption to unrelated features, plus (via C4) any tab observing another session's `task`/`turn-finished` events once a consumer is wired up to something session-specific, since `EventBus` is process-wide and unfiltered by `sessionId` despite the payload carrying one (verified: `HostEvent` carries `sessionId`, `events.routes.ts`'s `onOpen` subscribes with no filter).
- **Blast radius:** Multi-module — `events.ts`, `events.routes.ts`, `sessions.ts`, `agent.ts`, `src/ui/host-events.ts`, `src/ui/app.tsx` (6 files, confirmed via `grep -rln "from './events'" src`).
- **Reversibility:** Easy for listener isolation (wrapping each `listener(event)` call in the `emit` loop in try/catch is a single-file, single-method change); Moderate for session-scoped filtering (requires coordinated changes to `events.ts`'s subscribe API, `events.routes.ts`, and the client-side `host-events.ts`/`app.tsx` contract).
- **Overall risk:** Low generally (Unlikely + Medium severity + mostly-Easy reversibility matches the framework's Low bar); Medium specifically for the restructure window, given the likelihood shift.
- **What happens if deferred:** As the restructure proceeds and a future feature (plausibly the next one added, given the pattern of this codebase's growth) wires `useHostEvents`'s handler to something session-specific instead of the current no-op, it inherits an event bus with no isolation and no session filtering — a bug (one tab seeing another session's task progress, or one throwing listener silently starving all others) that has no current test coverage to catch it (B8: the WS message array in `check.ts` is collected but never asserted).
- Unverified: could not execute Bun's WebSocket runtime under adverse conditions (a socket mid-teardown, or serialization edge cases) to rule out every path by which `listener(event)` could throw in practice; the "does not throw" baseline rests on Bun's TypeScript type signature (`ServerWebSocketSendStatus` return, not an exception), not an observed runtime test.

---

**R8: The `src/server`/`src/ui`/`src/shared` boundary is a naming convention only, with no compiler/lint enforcement, and is already crossed twice**

- **Addresses:** S3
- **Likelihood:** Likely — this is the root-cause finding that several others (R4's wire.ts symmetric dependency, S4/R6's UI test importing server code, S5/R10's server importing UI HTML) already demonstrate in practice. Verified: no `workspaces` field in `package.json`, no `paths` aliases in `tsconfig.json` (`"moduleResolution": "bundler"`, no `paths` key), no ESLint/Biome config anywhere in the repo. Two real crossings already exist today, confirmed by structural analysis, so a third crossing being introduced silently after the reorg is a continuation of an established pattern, not a hypothetical.
- **Severity:** Medium — enables silent architectural drift over time (e.g., a UI-only file quietly importing server-only code, or vice versa) rather than causing an immediate break; the consequence is compounding technical debt, not a single dramatic failure.
- **Blast radius:** System-wide — this is the one structural rule the entire package → feature → component reorg depends on to have any actual meaning; without enforcement, every "this is server-only" or "this is ui-only" placement decision made during the reorg is advisory only.
- **Reversibility:** Moderate — adding a lint rule (e.g. import boundaries) or `tsconfig` path restrictions is a one-time, moderate investment, not a rewrite, but it is a project-wide tooling change that needs buy-in and CI wiring, not a local code fix.
- **Overall risk:** Medium (Likely + Medium severity does not clear the High bar on its own; the system-wide blast radius is a strong multiplier but the framework's Critical/High rules require it paired with near-certain likelihood or worst-level severity, which aren't both present here).
- **What happens if deferred:** The restructure completes, producing a directory layout that visually communicates package/feature boundaries, but with nothing enforcing them. The two existing crossings (S4, S5) are joined by new ones over time as features are added, each individually easy to justify ("it's just one import"), until the directory structure no longer reliably describes the actual dependency graph — precisely the failure mode a package→feature→component reorg is meant to prevent.

---

**R9: `documents.routes.ts` has no domain file, no unit test, and no input validation — the only safety net is one e2e scenario**

- **Addresses:** S1, B10
- **Likelihood:** Likely — B10 demonstrates this is not theoretical: upstream directly verified (by running the route in isolation) that a PUT body without `content` produces an uncaught `TypeError` inside `Bun.write`, surfacing to the caller as a generic 500 with no indication of the real cause. Any malformed client request (a network hiccup truncating the body, a client-side bug, or a future caller) triggers this immediately; there is no unit test to have caught it before shipping, and no unit test to catch a regression during the reorg — confirmed: `ls src/server/*.routes.test.ts` returns `sessions.routes.test.ts` and `workspace-config.routes.test.ts` only, no `documents.routes.test.ts` or `events.routes.test.ts`.
- **Severity:** Medium — an ugly, undiagnosable 500 (real cause visible only in server stderr, not to the caller) rather than data loss; contrast with `sessions.routes.ts`'s handling of structurally similar input, which returns a proper 400 with an explanit message (verified: `src/server/sessions.routes.ts:17-19`).
- **Blast radius:** Single module — contained to `documents.routes.ts`.
- **Reversibility:** Easy — the fix is a straightforward validation check mirroring the existing `sessions.routes.ts` pattern.
- **Overall risk:** Medium.
- **What happens if deferred:** `documents.routes.ts` moves into its own `documents` feature folder as a routes-only file (per the proposed mapping) with no domain file and no unit test to carry over — its only safety net during and after the move remains the single e2e scenario in `check.ts`. If that e2e script is skipped, made non-blocking, or temporarily disabled "just for the reorg PR" (a common practice during large refactors), a malformed-input regression in this exact route would ship with zero automated signal.

---

**R10: `server.ts`'s HTML import and the UI's own relative asset graph are rigid path couplings across the package boundary, but fail loudly**

- **Addresses:** S5, B4
- **Likelihood:** Possible — contingent on whether `server.ts`, `src/ui/index.html`, `app.tsx`, and `styles.css` actually get nested unevenly relative to each other; the proposed feature mapping (per the structural analyst's own table) already recommends keeping these at each package's root as composition-root files, which — if followed — avoids the break entirely. The risk is realized only if that recommendation is not followed explicitly.
- **Severity:** Medium — Bun resolves the HTML import and its internal `<link>`/`<script>` references as real module graph edges, so a mismatch fails as a hard "module not found" at bundle-resolution time — comparatively safe and immediately diagnosable, unlike R1's silent failures.
- **Blast radius:** Single module — `server.ts`, `src/ui/index.html`, `app.tsx`, `styles.css`, plus the hardcoded entry-point references in `package.json`'s `"server"` script and the `Makefile`'s `bun build --compile` target.
- **Reversibility:** Easy — once the loud failure occurs, the fix is a straightforward path correction.
- **Overall risk:** Low.
- **What happens if deferred:** If the reorg relocates the server entry point or the UI's HTML shell without keeping them explicitly paired (contrary to the recommended mapping), the build breaks immediately and loudly during the reorg PR itself — annoying but self-correcting, unlikely to reach production undetected.

---

**R11: Turn cancellation is honored only at one downstream checkpoint (`sessions.ts`'s abort-gated read), not at the source (tool execution) — correct today, fragile if the checkpoint moves**

- **Addresses:** C5
- **Likelihood (general, today):** Unlikely to cause an actual user-visible problem — verified `sessions.ts:93` gates output on `aborted ? {} : editedTexts(turn)`, so a cancelled turn's stray mutations never reach the client today; the system works correctly, just via a single fragile choke point rather than checking `abortSignal` inside each tool's `execute` (confirmed absent in `Read`/`Write`/`Edit`/`Glob`/`Highlight` in `tools.ts`).
- **Likelihood (restructure-specific):** Possible — the risk activates only if a future change reads `turn.edited`/`turn.texts` from a different call site (e.g., streaming partial edits before turn resolution, a plausible future feature) without also carrying the abort-check discipline forward; a feature split that separates "tool execution" from "turn/session lifecycle" makes it easier to add such a call site without realizing the safety net was implicit, not structural.
- **Severity:** Medium — if triggered, an in-flight `Edit`/`Write`/`Highlight` that the user believed they cancelled continues to completion and its mutation could leak into output the user no longer expects; not data loss but a trust/correctness violation ("Stop" not actually stopping).
- **Blast radius:** Single module — `tools.ts` + `sessions.ts`.
- **Reversibility:** Moderate — the fix (checking `abortSignal` inside each tool's `execute`) is a well-defined but multi-call-site change across `tools.ts`.
- **Overall risk:** Low generally; Medium specifically if the restructure separates tool-execution code from the turn-lifecycle code that currently provides the only safety net.
- **What happens if deferred:** No problem occurs unless and until a future feature reads turn state from a new call site; upstream's own conclusion is that this fix (and its absence) "need to travel with `tools.ts` wherever it lands" — meaning the risk is latent and depends entirely on whether the restructure preserves the implicit sessions.ts↔tools.ts coupling knowledge, not code that currently misbehaves.
- Unverified: could not drive an end-to-end "click Stop mid-Edit" run to directly observe an in-flight `Edit` completing after cancellation; this is inferred from reading `tools.ts` (no `abortSignal` handling) against the AI SDK's `executeToolCall` (confirmed to supply one), not from a live trace.

---

**R12: App skills (build-time, frozen) vs. workspace skills (scanned fresh per turn) is an implicit freshness split hidden behind one unified return type**

- **Addresses:** B12
- **Likelihood:** Possible — only manifests if someone extends `workspace-config.ts` with a third skill source, or otherwise assumes uniform freshness across `loadWorkspaceConfig()`'s result.
- **Severity:** Medium — a subtle bug (assuming hot-reload of app skills that will never happen without a restart, or an unnecessary rescan of embedded skills) rather than a crash; documented in the README ("After editing `src/skills/`, restart the server") but not enforced in the type system.
- **Blast radius:** Single module — `workspace-config.ts` + `agent.ts`.
- **Reversibility:** Easy — a type-level distinction or clearer inline documentation resolves the ambiguity.
- **Overall risk:** Low.
- **What happens if deferred:** No active problem; risk is limited to a future contributor extending `workspace-config.ts` without realizing the freshness split, which the restructure doesn't materially worsen (this file already keeps `app-skills.macro.ts` paired per the proposed mapping).

---

**R13: `test-model.ts` is a shared test helper for exactly two features with no scoped home**

- **Addresses:** S7
- **Likelihood:** Likely to require an explicit decision during the restructure (verified: only `src/server/sessions.test.ts:11` and `src/server/agent.test.ts:7` import it — `grep -rln "test-model" src` confirms exactly these two), but the consequence of not deciding is purely organizational.
- **Severity:** Low — a same-depth relative import into an unclearly-owned location; no functional impact either way.
- **Blast radius:** Localized — 2 test files.
- **Reversibility:** Easy.
- **Overall risk:** Low.
- **What happens if deferred:** Both `sessions` and `agent` feature folders end up with a `../test-model`-style import into a file that isn't clearly owned by either — a minor readability/ownership question, not a functional risk.

---

**R14: `Ask`/`SelectionAsk` shapes are duplicated as inline prop types instead of imported**

- **Addresses:** S14
- **Likelihood:** Possible — only manifests if `Ask`/`SelectionAsk` (defined in `markdown-editor.tsx`) gain a field that the popups' inline-redeclared shapes don't also get.
- **Severity:** Low — TypeScript still compiles either way; the popups just lose the safety net that would force their prop types to follow the source shape.
- **Blast radius:** Localized — 3 files (`markdown-editor.tsx`, `question-popup.tsx`, `selection-popup.tsx`).
- **Reversibility:** Easy — importing the type instead of redeclaring it is a small, local change.
- **Overall risk:** Low.
- **What happens if deferred:** Worth resolving during the "popups" feature grouping (as upstream suggests) but carries no real risk if left as-is; at most a missed type-safety improvement.

---

**R15: `agent-panel.tsx` no longer matches its feature name, and `GET /api/workspace-config` is an orphaned-but-live browser↔server contract**

- **Addresses:** S2, B11
- **Likelihood:** Likely to cause confusion during the restructure's feature-folder decisions (verified: `grep -rn "workspace-config" src/ui` returns nothing — the route is only exercised by `check.ts` and its own server test today), but zero likelihood of an actual functional break, since the endpoint still works correctly for its current (script/test-only) consumers.
- **Severity:** Low — a categorization/placement question, not a functional bug; `agent-panel.tsx` is 11 lines doing exactly one thing (a Clear Chat button).
- **Blast radius:** Localized.
- **Reversibility:** Easy — reassigning `agent-panel.tsx` as a `chat`-feature component, or leaving it standalone, is a low-cost decision either way.
- **Overall risk:** Low.
- **What happens if deferred:** `agent-panel` gets its own feature folder per the user's suggested list, misrepresenting its true (chat-adjacent) responsibility and the workspace-config endpoint's true (script/test-only) consumer base — a minor documentation/mental-model mismatch, not a runtime risk.

---

**R16: Server-side highlight logic depends on `prosemirror-markdown`, a browser-rendering-affine library, to match the editor's text segmentation**

- **Addresses:** S11
- **Likelihood:** Possible — only triggered if the UI's editor technology changes, a large deliberate decision rather than routine development; not something incidental feature work would stumble into.
- **Severity:** Medium — if triggered, `tools.ts` must change in lockstep with no interface boundary beyond the shared test (R6/S13), but until then there is no active problem; this is a documented, deliberate coupling (comment: "the same blocks the editor shows, so a quote it accepts is one the editor can find"), not an accident.
- **Blast radius:** Single module — `tools.ts` + `package.json`'s flat dependency list (all ProseMirror packages listed as top-level `dependencies` with no server/UI separation).
- **Reversibility:** Moderate — would require picking a new segmentation approach if editor technology changes; contained but deliberate work.
- **Overall risk:** Low.
- **What happens if deferred:** No near-term risk; this is a long-term architecture note about dependency direction rather than something the restructure itself needs to address, since it doesn't involve path/import depth sensitivity.
- Unverified: did not run `make build` and inspect the compiled server binary's dependency graph to confirm the UI-only ProseMirror packages are actually tree-shaken out, because that requires a build step outside static analysis; if they are not tree-shaken, the server binary carries unnecessary UI-rendering code, a minor operational cost rather than a functional risk.

---

### Risk Summary

- **Findings assessed:** 33 (S1–S15, B1–B13, C1–C5), grouped into 16 risk items (R1–R16) where multiple findings shared a root cause, plus one explicit negative result (B13) carried into this summary rather than scored as a risk.
- **Critical risks:** 1 — R1 (`import.meta.dir`/literal-path depth-sensitivity in `workspace.ts`, `app-skills.macro.ts`, `scripts/check.ts`; S8, S9, S10, B2, B3). This is the one finding where general risk and restructure-specific risk are identical and both severe: the restructure's own mechanics (nesting files one level deeper) are the trigger, and the failure mode is silent or misleadingly-diagnosed.
- **High risks:** 3 — R2 (chat/documents turn-scoped reconciliation entanglement; C2), R3 (TurnTexts race + sessions/agent/tools coupling; C1, S6), R4 (wire.ts shared contract + unchecked SessionData cast; S12, B5). All three are elevated primarily by strong evidence of either near-certain recency (R2: last 5 commits all touch this cluster) or wide, active-growth dependency fan-out (R3, R4).
- **Medium risks:** 5 — R5 (duplicated workspace path-confinement, symlink divergence; S15, B9 — general Medium, effectively High under the restructure), R6 (duplicated block-segmentation logic; S13, B1, S4), R8 (unenforced package boundary; S3 — the root cause several other findings already demonstrate), R9 (documents.routes.ts missing tests/validation; S1, B10).
- **Low risks (general Low, some elevated under the restructure lens):** R7 (EventBus isolation/session-scoping; B6, B7, C3, C4, B8 — Low today because the only real consumer is a deliberate no-op, Medium if the restructure adds new subscribers without addressing this first), R10 (composition-root HTML import rigidity; S5, B4 — fails loudly, self-correcting), R11 (cancellation safety-net fragility; C5 — correct today, latent risk only if a future call site is added carelessly), R12 (app/workspace skill freshness split; B12), R13 (test-model.ts scoped home; S7), R14 (Ask/SelectionAsk duplicate types; S14), R15 (agent-panel mismatch / orphaned endpoint; S2, B11), R16 (prosemirror dependency direction; S11).
- **Findings with no risk (explicitly well-handled, do not touch):** B13 — `TurnTexts` is correctly scoped per-turn with no cross-turn/cross-session leakage, verified directly by reading `Sessions.chat()`'s full body; upstream flags this as the model for how ephemeral per-turn state should be handled elsewhere, and the restructure should preserve this pattern rather than "fix" anything here. Also worth noting as low-risk-by-design (per the structural analyst's own summary, not separately scored above): `src/shared/`'s three files (`wire.ts`, `markdown-support.ts`, `passages.ts`) have zero imports and are consumed symmetrically by both packages — already the target end-state the reorg is aiming for, requiring no remediation.

**Cross-cutting observation for the restructure specifically:** every item rated Critical or High above (R1–R4) shares one property — the danger is not that these problems are unknown, but that the restructure is the exact mechanical event that either triggers them (R1: files get nested, breaking path math) or removes the incidental protections that currently limit their blast radius (R2/R3: side-by-side file placement currently makes cross-file coupling visible; feature folders will hide it; R4: package-root proximity currently makes wire.ts's symmetric role obvious). None of these require new discovery work — they require the restructure plan to explicitly decide, file by file, whether a file's current placement is load-bearing before moving it.


---

## Software-Architecture Recommendations

> Verbatim output from `software-architect`.

# Intra-codebase architecture recommendations: restructure `src/` by package, then feature, then component

I read all four upstream files in full (S1–S15, B1–B13, C1–C5, R1–R16). I then checked them against the code: I listed every relative import in `src/server`, `src/ui` and `src/shared`, and read `workspace.ts`, `app-skills.macro.ts`, `tools.ts`, `markdown-editor.tsx`, `app.tsx`, `chat.tsx`, `documents.test.tsx`, `Makefile`, `package.json` and `tsconfig.json`.

I ran two experiments in the scratchpad. Nothing in the repo was changed.
- **Macro test (Bun 1.4.2).** A Bun macro in a nested folder can import a fixed-location anchor module (`../paths`). It embeds the right files both under `bun run` and in a `bun build --compile` binary run from `/`.
- **Type test (the repo's `tsc`, strict).** A zero-import structural type accepts a ProseMirror `Node` from `defaultMarkdownParser.parse`.

**Code facts the upstream findings did not record, which affect the move:**
- `tools.ts` imports `APP_SKILL_PREFIX` and `appSkillText` from `workspace-config.ts`, so the agent/tools code depends on the workspace-config feature. `tools.test.ts` imports `APP_SKILL_FILES` from it too.
- `documents.test.tsx:169,171,191` calls `await import('./markdown-editor')` and `mock.module('./markdown-editor', …)`. These are module specifiers written as strings. They must be rewritten together with `documents.tsx`'s own import, or the mock stops taking effect.
- `agent.test.ts:31` uses `SRC + '/server'` as a workspace that has no `.claude/` folder. This still works as long as `src/server/` exists.
- `workspace-config.test.ts:88-94` already checks that `APP_SKILL_FILES` equals the files under `join(SRC,'skills')`. So once `SRC` is correct, a macro that embeds nothing fails that test loudly.

---

## A1: Put `SRC` in one module at a fixed location (`src/server/paths.ts`), and add a test that fails if it is wrong

- **Addresses:** R1 (Critical), S8, S9, S10, B2, B3
- **Principle:** High cohesion. Today the "where is `src/`" fact is computed in two places (`workspace.ts:6`, `app-skills.macro.ts:10`), and both only work at one specific folder depth. Loose coupling: feature files should not depend on how deep they sit in the tree.
- **Current state:** Both files assume they sit exactly one folder below `src/`.
  - Moving either one into a feature folder changes the path silently (S8/S9).
  - B2 shows that an existing `src/.data/workspace` folder hides the break in `bun run server`.
  - B3 shows the macro can quietly embed nothing (`{}`) if the wrong path happens to exist.
- **Recommended change:**
  - Add one anchor module at the server package root. The package root never moves in this restructure.
  - Everything else imports `SRC` from it. `workspace.ts` stops exporting `SRC`, so there is only one way to get it.
  - The macro computes its skills folder from the anchor.
  - A guard test turns a wrong anchor into a loud `make test-server` failure.
  ```ts
  // src/server/paths.ts — must stay directly under src/server/. Every src/-relative path starts here.
  import { resolve } from 'node:path';
  export const SRC = resolve(import.meta.dir, '..');

  // src/server/paths.test.ts
  test('SRC is the src/ folder', () => {
    for (const p of ['server/server.ts', 'skills', 'fixtures/workspace', 'ui/index.html'])
      expect(existsSync(join(SRC, p))).toBe(true);
  });

  // src/server/workspace/workspace.ts
  import { SRC } from '../paths';
  const FIXTURE = join(SRC, 'fixtures/workspace');
  export const dataDir = (name: string) => join(SRC, '.data', name);

  // src/server/workspace-config/app-skills.macro.ts
  import { SRC } from '../paths';
  const dir = join(SRC, 'skills');
  ```
  - Callers found by grep: `agent.test.ts`, `workspace-config.test.ts`, `workspace-config.routes.test.ts` and `scripts/check.ts`. Each changes `from './workspace'` / `'../workspace'` to `from '../paths'`. All four end up exactly one folder below `src/server/`, so they all use the same `../paths` specifier.
  - `check.ts:85` (`join(SRC, 'server/server.ts')`) stays correct because `server.ts` stays at the package root (A2).
- **Why not walk up to `package.json`:**
  - It adds file-system checks when the module loads.
  - Inside the compiled binary, `import.meta.dir` is a virtual path. A walk-up there either loops to `/` or needs a fallback, which is new behavior.
  - A fixed-depth anchor plus a guard test is simpler and has been checked.
- **Rationale:** One reason to change (where `src/` is) now lives in one module. Every feature file can move to any depth without changing this constant.
- **YAGNI evidence:** R1 is Critical and near-certain: the planned move breaks both computations. There are 6 current users (`workspace.ts`, the macro, 3 tests, `check.ts`). In the scratchpad, a macro one level deeper importing `../paths` embedded the right files under `bun run` and in the compiled binary.
- **Simpler version considered:** Leave `workspace.ts` and the macro at the `src/server/` root. This does satisfy R1, but it breaks the owner's feature layout for two files only because of path arithmetic. The macro would also sit apart from its only consumer, `workspace-config.ts`. The `../` count can also be recalculated by hand at the new depth, but that is the same fragile pattern, one level deeper, with no guard.
- **Risk if deferred:** The R1 outcome. A move that passes local manual testing, then fails on a fresh checkout, in CI, or in `bun run check`, or ships the binary without `collaborative-draft-editing`.

## A2: Feature-folder layout, with one rule for what goes in `components/`, and the full target tree

- **Addresses:** the driving concern, S1, S3, S5, S10, B4, R10, R13, R15, B11
- **Principle:** High cohesion (each feature's domain, routes, CSS and tests sit together) and a consistent dependency direction: the composition root depends on features, features depend on `shared/`, never the other way.
- **The rule (apply it to every file):**
  1. **Entry points stay at the package root:** `server/server.ts`, `server/agent-host.ts`, `ui/app.tsx`, `ui/index.html`, `ui/styles.css`, `ui/css.d.ts`, `ui/test-setup.ts`.
     - This keeps S5/B4/R10 intact: `import homepage from '../ui/index.html'`, and `index.html`'s `./styles.css` and `./app.tsx`.
     - It keeps S10's `'server/server.ts'` string intact.
     - `package.json` scripts and the `Makefile` (`src/server/server.ts`, `./src/ui/test-setup.ts`, `bun test src/server src/shared`, `src/ui`) need **no edits**.
  2. **Each feature gets one folder.** Its "components" are basename groups of sibling files (`x.tsx` + `x.css` + `x.test.tsx`). There are no folders per component; see the Deferred (YAGNI) section.
  3. **A file that has a natural owning feature stays in that feature**, even when other features import it. That is a normal one-way feature dependency, such as `documents → markdown-editor` or `sessions → workspace-config`.
  4. **`components/` is only for files that no single feature owns.** It sits at the lowest parent folder shared by the features that use it. In this codebase, only `ui/api.ts` qualifies: `app.tsx`, `documents.tsx` and `chat.tsx` all use it, so it goes in `src/ui/components/`.
  5. **Anything two packages share goes in `src/shared/`.** This removes the UI test's import of server code (A4).
- **Moves:** Do them with `git mv` so history follows each file. Rewrite imports using the edge list below. **No barrels** (A6).

### Target tree

```
src/
  server/
    server.ts                         # entry point; Makefile, package.json and check.ts:85 refer to it by path (S10, B4)
    agent-host.ts                     # composition glue for EventBus + Sessions; only server.ts uses it
    paths.ts                          # NEW (A1): the one src/ anchor; must stay here
    paths.test.ts                     # NEW (A1): guard that SRC points at src/
    scripts/
      check.ts                        # dev tooling, not a feature; path unchanged, so the package.json "check" script is unchanged
    sessions/                         # feature: one chat turn, end to end (A3)
      sessions.ts                     # session lifecycle, TurnTexts creation and abort-gated read-out (B13, C5)
      sessions.routes.ts              # HTTP adapter for sessions
      sessions.test.ts
      sessions.routes.test.ts
      agent.ts                        # the turn's model, instructions and tools; only sessions uses it (plus server.ts's MISSING_API_KEY_HELP)
      agent.test.ts
      tools.ts                        # file tools and TurnTexts; only sessions and agent use them (S6, C1)
      tools.test.ts
      test-model.ts                   # scripted model; used by exactly sessions.test and agent.test, both in this feature (S7, R13)
    events/
      events.ts                       # EventBus domain
      events.routes.ts                # WebSocket adapter
    documents/
      documents.routes.ts             # routes-only feature by design (S1)
    workspace-config/
      workspace-config.ts             # skills and agents domain; also used by sessions/agent.ts and sessions/tools.ts (a one-way feature dependency)
      workspace-config.routes.ts
      workspace-config.test.ts        # also the loud check against an empty macro result (B3)
      workspace-config.routes.test.ts
      app-skills.macro.ts             # stays in the same folder as its only importer; path now built from ../paths (A1)
    workspace/
      workspace.ts                    # workspace choice and seeding; SRC moved out to ../paths (A1)
      workspace.test.ts
  ui/
    index.html                        # HTML entry; paired with server.ts's import and its own ./app.tsx and ./styles.css
    app.tsx                           # composition root ("the only file that wires features together")
    app.test.tsx
    styles.css                        # global base styles, loaded from index.html
    css.d.ts                          # ambient '*.css' module type; works anywhere under tsconfig "include": ["src"]
    test-setup.ts                     # Makefile preload path ./src/ui/test-setup.ts, unchanged
    components/
      api.ts                          # package-wide fetch helper used by app, documents and chat; no single owner
    events/
      host-events.ts                  # client side of server/events; only app.tsx uses it
    documents/
      documents.tsx                   # document list and editor pane; also holds the turn bookkeeping (C2, see "not addressed")
      documents.css
      documents.test.tsx              # mock.module and await import specifiers must become '../markdown-editor/markdown-editor'
    markdown-editor/
      markdown-editor.tsx             # owns Ask, SelectionAsk and the CRDT merge; used by documents and by app.tsx for types
      markdown-editor.css
      markdown-editor.test.tsx        # no longer imports server code (A4)
    chat/
      chat.tsx
      chat.css
      chat.test.tsx
      agent-panel.tsx                 # a chat component: its only job is Clear Chat (A5)
      agent-panel.css
      agent-panel.test.tsx
    popups/
      question-popup.tsx
      question-popup.test.tsx
      selection-popup.tsx
      selection-popup.css
      selection-popup.test.tsx
      anchored-bubble.ts              # a component inside the popups feature, used by its two popups (A5)
      anchored-bubble.css
  shared/
    wire.ts                           # unchanged; the one shared contract (S12)
    markdown-support.ts               # unchanged
    markdown-support.test.ts
    passages.ts                       # unchanged
    passages.test.ts
    blocks.ts                         # NEW (A4): zero-import textblock walk
    blocks.test.ts                    # NEW (A4)
  skills/ fixtures/ .data/            # resources outside the three packages; not moved, because SRC-relative paths and .gitignore depend on them
```

### Import edges to rewrite

(These cover every relative import grep found outside the same folder.)

- **`server.ts`:** `./sessions/agent`, `./agent-host`, `./documents/documents.routes`, `./events/events.routes`, `./sessions/sessions.routes`, `./workspace-config/workspace-config.routes`, `./workspace/workspace`. The `../ui/index.html` import is unchanged.
- **`agent-host.ts`:** `./events/events`, `./sessions/sessions`.
- **`sessions/*`:** `../../shared/{wire,markdown-support,passages,blocks}`, `../events/events`, `../workspace-config/workspace-config`, `../paths` (in `agent.test`). Imports within the feature (`./agent`, `./tools`, `./test-model`, `./sessions`) are unchanged.
- **`events/events.ts`:** `../../shared/wire`.
- **`workspace-config` and `workspace` tests, `workspace.ts`, the macro:** `../paths`.
- **`scripts/check.ts`:** `../workspace/workspace` (for `dataDir` and `resetWorkspace`) and `../paths` (for `SRC`).
- **`ui/app.tsx`:** `./components/api`, `./events/host-events`, `./documents/documents`, `./chat/chat`, `./chat/agent-panel`, `./markdown-editor/markdown-editor`, `./popups/question-popup`, `./popups/selection-popup`.
- **UI feature files:** `../../shared/*`, `../components/api`, `../markdown-editor/markdown-editor`.
- **`app.test.tsx`:** unchanged.
- **README:** its file map must be rewritten to match.

**Remaining edits:**
- **Rationale:** Every feature's reasons to change are gathered in one folder. The only files that know more than one feature are the two composition roots, which is already the codebase's stated rule.
- **YAGNI evidence:** This is the owner's explicit goal. It adds no new abstraction beyond A1 and A4.
- **Simpler version considered:** Keep the flat layout. That does not meet the owner's goal. A flat `src/server` with only `sessions/` split out would be partial and inconsistent.
- **Risk if deferred:** Not applicable; this is the requested change.
- Unverified: could not inspect whether Bun's `mock.module` resolves its relative specifier against the calling test file under the new layout, because I did not run the moved test. I rely on Bun's documented behavior; `make test-ui` will confirm it.

## A3: `agent.ts`, `tools.ts` and `sessions.ts` become **one** server feature, `sessions/`, with `test-model.ts` inside it

- **Addresses:** C1, S6, R3, C5, R11, S7, R13, B13 (keep as is)
- **Principle:** High cohesion and the common-closure rule: things that change together belong together. `TurnTexts` is unsynchronized mutable state.
  - `sessions.ts` creates it and gates reading it after an abort.
  - `agent.ts` passes it through.
  - `tools.ts` changes it.
  - Any fix for C1 (serializing or locking) or C5 (checking `abortSignal`) must touch all three at once (R3: "Difficult" to reverse).
- **Current state:** Splitting `agent`/`tools` from `sessions` would turn `sessions.ts → tools.ts` (S6) into an import that reaches into another feature's internals. `test-model.ts` would also need a `components/` folder shared by exactly two features.
- **Recommended change:**
  - Put all three files and their tests in `src/server/sessions/`.
  - Consumers found by grep: `tools.ts` is imported only by `sessions.ts`, `agent.ts`, `agent.test.ts` and `tools.test.ts`. `agent.ts` is imported only by `sessions.ts`, the tests, and `server.ts` (for the `MISSING_API_KEY_HELP` constant, a composition-root read).
  - After the move, S6 is an import inside one feature. `TurnTexts` stays in `tools.ts` (position (b)): it is the tools' working copy, `sessions.ts` owns its lifetime, and B13 says keep that scoping.
  - Keep the name `sessions`. It matches the README, the `/api/sessions` routes and the `Sessions` class, so no rename churn.
  - Add a folder-header comment in `sessions.ts` stating that `TurnTexts` is shared across concurrent tool calls in one step (C1). This makes the hazard visible without changing behavior.
- **Rationale:** No feature reaches into another feature's internals. `test-model.ts` has an obvious owner, so it needs no `components/` folder (position (g)).
- **YAGNI evidence:** C1 and R3 (High), S6 (a real import today), S7 (exactly two consumers, both inside this feature).
- **Simpler version considered:** This is the simplest option. The alternative, `agent/` plus `sessions/` plus `sessions+agent/components/{turn-texts,test-model}.ts`, adds a folder and a split that nothing needs.
- **Risk if deferred:** R3's formalized cross-feature import hides the lost-update hazard. A future C1/C5 fix spans two folders.

## A4: Move the textblock walk (not the markdown parse) into `src/shared/blocks.ts`, with no imports; this removes the UI test's import of server code

- **Addresses:** R6, S13, B1, S4, and part of R8
- **Principle:** DRY for one contract that must match across packages (the precedent is `findQuote`). The dependency direction of the owner's rule ("shared between packages → `shared/`") is kept. `bun test src/ui` should not need the server package to compile (S4).
- **Recommended change (position (e)):**
  - Move only the tree walk. Type it structurally so `shared/` keeps its documented zero imports (README: "Like `wire.ts`, they have no imports").
  - The markdown parse (which needs `prosemirror-markdown`) stays server-side in `postBlocks`.
  - The UI's `blocksOf` is replaced by `textblocks`. Callers: `markdown-editor.tsx:102` and `markdown-editor.test.tsx:87,126`.
  ```ts
  // src/shared/blocks.ts — no imports; any ProseMirror Node fits this shape
  export interface TextblockTree {
    isTextblock: boolean;
    textContent: string;
    descendants(visit: (node: TextblockTree, pos: number) => void | boolean): void;
  }
  export function textblocks(root: TextblockTree): { text: string; pos: number }[]

  // src/server/sessions/tools.ts
  export const postBlocks = (markdown: string) =>
    textblocks(defaultMarkdownParser.parse(markdown)).map((b) => b.text);

  // src/ui/markdown-editor/markdown-editor.test.tsx — parity test, no server import:
  // textblocks(editorDoc).map(text)  equals  textblocks(defaultMarkdownParser.parse(md)).map(text)
  ```
- **What the parity test now checks:** the real remaining risk, which is that the editor's Yjs round trip keeps the parser's blocks. The walk can no longer drift because there is one copy.
- **Residual risk:** the server switching away from `defaultMarkdownParser`. It is covered by `postBlocks`'s comment and by `tools.test.ts`, and R16 rates it Low.
- **Why not move `postBlocks` itself into `shared/`:** That would bring `prosemirror-markdown` in as the first import in `shared/`, breaking a documented property of the package for a risk (R16) that is rated Low.
- **YAGNI evidence:** Two current implementations whose agreement is only enforced by a test that crosses packages (S4 is a real import today). The owner's rule forces cross-package code into `shared/`. Checked: the structural type accepts `defaultMarkdownParser.parse(...)`'s `Node` under the repo's strict `tsc`, with output `[{"text":"a","pos":1},…]`.
- **Simpler version considered:** Only change the import to `'../../server/sessions/tools'`. That keeps the S4 violation, which the owner's rule forbids, and keeps the duplicate walk (S13).
- **Risk if deferred:** R6. The test's path gets fixed in a hurry, or skipped to get the build green, during the move.

## A5: Placement calls for the UI: `agent-panel` into `chat/`, a flat `popups/`, and `host-events` into `events/`

- **Addresses:** S2, R15, B11, S14 (intentionally not changed)
- **Principle:** Single responsibility and cohesion by what a file actually does, not what it used to do.
- **Position (c):**
  - `agent-panel.tsx` is 11 lines rendering a Clear Chat button (S2). Its only reason to change is chat-session UX. It becomes a component of `chat/`.
  - Keep the file name, the `side-head` class and the DOM as they are, so this stays a pure move. Fix the README line ("shows the workspace's skills and agents"), which is now wrong.
  - B11 (the workspace-config endpoint no longer called from the UI) needs no structural action: the endpoint's consumers are `check.ts`, its test, and `make check-build`.
- **Position (h):**
  - One `popups/` feature containing `question-popup`, `selection-popup` and `anchored-bubble` as sibling components.
  - `anchored-bubble` is used by exactly these two files (grep confirms), both inside the feature. Under the A2 rule, sharing inside a feature needs no `components/` folder.
  - `anchored-bubble.css` still reaches the bundle through `anchored-bubble.ts`'s own import (S12's summary).
- **`host-events.ts`:** goes to `ui/events/`, mirroring `server/events/`. Its only consumer is `app.tsx`, so the UI root holds only composition files.
- **YAGNI evidence:** Placement only; no new abstraction.
- **Simpler version considered:** Give `agent-panel/` its own feature folder. That misstates what it does (R15). Splitting `popups/components/anchored-bubble.ts` into sub-features is extra depth nothing needs.
- **Risk if deferred:** R15, a low risk of confusion.

## A6: Do **not** add `index.ts` barrels

- **Addresses:** position (i), S3, R8
- **Principle:** Avoid over-abstraction (interface segregation at the module level is already met by named exports).
- **Why not:**
  - The codebase has no barrels today.
  - Each feature has at most two consumer files outside it.
  - Barrels would create two import paths to the same module. That is a real hazard for `documents.test.tsx`'s `mock.module` of `markdown-editor`: a barrel re-export can capture the real module before the mock is installed.
  - Barrels also merge every export of a feature into one surface.
- **Trigger to revisit:** An import-boundary lint (R8) is adopted and needs one public entry per feature, or a feature gains a third consumer that imports three or more of its internals.

## A7: Workspace path confinement (R5): one helper, but in a **separate behavior-change commit** after the restructure

- **Addresses:** R5, S15, B9, and R9 as a prerequisite
- **Principle:** High cohesion. "Stay inside the workspace" is one trust-boundary concept, and the `workspace` feature owns it.
- **Position (f):**
  - Unify, but not in the pure restructure. Changing `documents.routes.ts` to resolve symlinks is a behavior change for `GET`/`PUT /api/documents/:name`: a symlink that works today would be refused.
  - Follow-up: move `resolveInWorkspace` and `realTarget` from `sessions/tools.ts` to `workspace/workspace.ts`. Then `tools.ts` and `documents.routes.ts` both import it. Standardize on the stronger, symlink-resolving version.
  - Add `documents/documents.routes.test.ts` covering `..` escape, a symlink escape, and save/load first, so the change is visible in tests (S1, R9).
  ```ts
  // src/server/workspace/workspace.ts
  export function resolveInWorkspace(workspace: string, filePath: string): string  // moved unchanged from tools.ts
  ```
- **YAGNI evidence:** Two current implementations of the same check, already diverged (S15, confirmed by reading both). R5 says the restructure is when it either gets fixed or hardens into "intentional".
- **Simpler version considered:** Leave both as they are. That hardens the divergence in place (R5).
- **Risk if deferred:** R5, Medium, effectively High for this restructure.

---

## Findings intentionally not addressed by architecture changes

- **C2 / R2 (turn bookkeeping in `documents.tsx`):**
  - `beginTurn`, `applyEdited` and the turn-scoped refs work on `documents`' own `entries` and Yjs snapshots, so they stay in `documents/`.
  - The pairing is already expressed as a typed contract: `useChatSession`'s `beginTurn` and `onTurnFinished` props (`chat.tsx:57-70`), wired only in `app.tsx`.
  - Moving the state into `chat/` would couple chat to the CRDT internals. A `TurnReconciler` interface would have one implementation.
  - Action within the move: none, other than keeping `app.tsx` as the only place the pair is wired.
- **S14 / R14 (`Ask` and `SelectionAsk` redeclared inline):** Low risk. It is a type-only refinement for later, not a structural issue.
- **B12 / R12 (skill freshness split):** Low; unchanged by the move.
- **S11 / R16 (prosemirror dependency direction; flat `package.json` dependencies):** Low; A4 already names the contract.
- **S12 (`wire.ts` churn):** Healthy growth; stays as is.

## Out of scope for the pure restructure (behavior changes; do them as separate follow-ups)

- **C1 / R3:** Locking or serializing tool calls on `TurnTexts`. A3 only places the files together.
- **C5 / R11:** Checking `abortSignal` inside tool `execute`.
- **B5 / R4:** Runtime validation of the `data-session` part.
- **C3, C4, B6, B7, R7:** Isolating each EventBus listener, and filtering events by session.
- **B8:** Asserting the collected WebSocket events in `check.ts`.
- **B10 / R9:** Validating input on `PUT /api/documents`.
- **R5 / S15 / B9:** Unifying path confinement (A7, its own commit).

---

### Software Architecture Recommendations Summary

- **Upstream findings addressed:** 33 of 33 are accounted for.
  - 20 are covered by A1–A7: S1–S10, S13, S15, B1–B4, B9, B11, C1, C5, and R1, R3, R5, R6, R8 (partly), R9, R10, R11, R13, R15.
  - The rest are deliberately left alone, each with a reason: C2/R2, S14/R14, B12/R12, S11/R16 and S12 (not architecture changes); B5/R4, B6, B7, B8, B10, C3, C4 and R7 (behavior changes, out of scope); B13 (a positive finding to keep).
- **Key themes:**
  1. Path facts that depend on folder depth must live in one anchor at a fixed depth, with a test guarding it.
  2. Code that changes together must share a folder: one `sessions` feature for the turn's shared mutable state.
  3. Parity code shared across packages belongs in `shared/`. Only entry points live at package roots.
- **Highest-impact recommendations:**
  - A1: removes the only Critical risk.
  - A3: keeps the C1/C5 hazard in one folder.
  - A2: the target tree, with no `Makefile` or `package.json` edits needed.
- **Deferred to `system-architect`:** None. The server and UI ship as one deployable (a single `bun build --compile` binary, with `server.ts` bundling `ui/index.html`), so every finding is inside one codebase. One conditional: if the trust model ever becomes multi-user, R5 and B7/C4 (confining paths per tenant, scoping events per session) become system-level concerns.
- **Deferred (YAGNI):**
  - **Folders per component inside a feature** (a structure the owner's "component" level might suggest): the largest feature has 9 files. Basename groups already form the component level, and an extra folder level adds import depth for no gain. **Trigger to revisit:** a single component grows to 4 or more files.
  - **Barrels (A6):** premature abstraction. **Trigger:** an import-boundary lint is adopted, or a feature gets a third consumer that imports several of its internals.
  - **R8 import-boundary lint or tsconfig path restrictions:** tooling nothing needs yet, because after A4 the only cross-package import left is the legitimate composition-root one (S5). **Trigger:** a second non-root cross-package import appears.
  - **A `TurnReconciler` interface for C2:** it would have one implementation. **Trigger:** a second editor or reconciliation strategy lands.
  - **A shared `Bun.Glob` helper (S15's side note):** the four call sites each use different options, so a shared helper would not simplify anything. **Trigger:** three call sites converge on the same options.
  - **Splitting `package.json` into server and UI dependencies (S11):** **Trigger:** a verified bundle-size problem in `build/3pitor`.

**Relevant paths:**
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/workspace.ts`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/app-skills.macro.ts`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/tools.ts`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/sessions.ts`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/agent.ts`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/server/scripts/check.ts`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/markdown-editor.tsx`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/markdown-editor.test.tsx`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/documents.test.tsx`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/src/ui/app.tsx`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/Makefile`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/package.json`
- `/Users/mxriverlynn/dev/mxriverlynn/3pitor/README.md`


---

## System-level concerns deferred

None. `software-architect` deferred nothing: the server and UI ship as one deployable (one `bun build --compile`
binary), so every finding is inside one codebase. It noted one condition: if the app ever serves several users, R5
and B7/C4 (confining paths per tenant, scoping events per session) become system-level concerns.

---

_End of report. Finding IDs (`S#`, `B#`, `C#`, `R#`, `A#`) are stable for the life of this report._

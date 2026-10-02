# Current State Findings: Update the Code Structure (2026-10-01)

## Provenance

Extracted from [architectural-analysis.md](architectural-analysis.md) (2026-10-01, medium size: structural,
behavioral, concurrency, risk, and software-architect). The findings below are the ones this plan rests on. Each was
re-read at `e07e27f` by the planner, so all are Verified unless marked. The full S/B/C/R/A record stays in the report.

## Project Context

- **Stack:** Bun + TypeScript, Hono server, React UI bundled by Bun from `src/ui/index.html`. Tests: `bun test`, with
  happy-dom preloaded for `src/ui` only. `make test` runs `tsc --noEmit`, then server and shared tests, then UI tests.
- **Conventions source:** none found (no CLAUDE.md project discovery, no `project-discovery.md`). README.md's "How
  `src/` is laid out" section is the written layout rule set.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn (90 days):** `markdown-editor.test.tsx` 48, `markdown-editor.tsx` 41, `raw-formatting.ts` 20,
  `markdown-editor.css` 17, `link-popup.tsx` 4.

## Gaps

- No ADR or coding standard records the layout rules. The README section and the earlier change sets in
  `docs/changes/` are the only record.
- No test checks CSS cascade order in the bundle. happy-dom does not apply the cascade (B3).

## Findings

### C-1: link-popup has one importer, in another feature

- **Claim:** `LinkPopup` lives in the `popups` feature, but only the `documents` feature's markdown editor uses it.
- **Location:** `src/ui/documents/markdown-editor/markdown-editor.tsx:38`, `src/ui/popups/link-popup/`
- **Evidence:**
  ```ts
  // markdown-editor.tsx:38
  import { LinkPopup } from '../../popups/link-popup/link-popup';
  // link-popup.test.tsx:3
  import { LinkPopup } from './link-popup';
  ```
- **Raised by:** report S1, B13, A1
- **Confidence:** Verified
- **Bears on:** S-2, D-5

### C-2: anchored-bubble is shared by all three popups

- **Claim:** `useAnchoredBubble` sits in `popups/components/` and has three importers: link-popup, question-popup, and
  selection-popup. It side-effect-imports its own CSS.
- **Location:** `src/ui/popups/components/anchored-bubble.ts`
- **Evidence:**
  ```ts
  // anchored-bubble.ts:4
  import './anchored-bubble.css';
  // link-popup.tsx:4, question-popup.tsx:5, selection-popup.tsx:5
  import { useAnchoredBubble } from '../components/anchored-bubble';
  ```
- **Raised by:** report S1, A1
- **Confidence:** Verified
- **Bears on:** S-1, D-6

### C-3: No string specifier reaches either module

- **Claim:** No `mock.module`, dynamic `import()`, `import.meta.dir` read, or text import names link-popup or
  anchored-bubble. Every reference is a static import that `tsc --noEmit` checks.
- **Location:** `src/ui/**`
- **Evidence:** `grep -rnE "mock\.module|await import\(|import\.meta|with \{ type" src/ui | grep -iE "popup|bubble"`
  returns nothing.
- **Raised by:** report A1 (checklist item 3), re-run by the planner
- **Confidence:** Verified
- **Bears on:** S-1, S-2, D-10

### C-4: CSS order in the bundle follows import traversal from app.tsx

- **Claim:** Every component's CSS is a side-effect import, so the bundle's CSS order follows the order modules are
  reached from `app.tsx`. A path change keeps that order; reordering import lines would not. happy-dom cannot see a
  change.
- **Location:** `src/ui/app.tsx`, `link-popup.tsx:5`, `anchored-bubble.ts:4`
- **Evidence:**
  ```ts
  import './link-popup.css';      // link-popup.tsx:5
  import './anchored-bubble.css'; // anchored-bubble.ts:4
  ```
- **Raised by:** report B3, R4
- **Confidence:** Partly verified: the bundle at `e07e27f` lists anchored-bubble, then link-popup, then markdown-editor, in the order those modules are reached. That the order survives a path change is unverified until Unit 1's bundle comparison.
- **Bears on:** D-10

### C-5: Pinned files, move-together pairs, and single instances

- **Claim:** Some files must not move or must move together, because they are found by location in ways `tsc` does not
  check, or because their correctness rests on one module instance. None of them is in this plan's move set.
- **Location:** `server/{paths.ts, server.ts, server.test.ts, command-line.ts, scripts/check.ts}`,
  `ui/{index.html, app.tsx, styles.css, test-setup.ts}`, `src/skills`; the pairs `agent.ts` + `system-prompt.md`,
  `fake-claude.ts` + `fake-claude-on-path.ts`, `markdown-editor.test.tsx` + `markdown-editor.css`; the single instances
  `json-file.ts`, `undoManagers`, and `isHiddenName`.
- **Evidence:** see report S4, B1, B2, B9–B12, R1–R3, A2.
- **Raised by:** report R1, R2, R3, A2
- **Confidence:** Verified (report), not re-read here beyond the move set
- **Bears on:** D-7

### C-6: The README describes anchored-bubble as a popups helper and omits link-popup

- **Claim:** The README layout section says `popups/components/anchored-bubble.ts` "places both popups", and does not
  mention link-popup, `entry-name.ts`, `highlight-outline.ts`, `raw-syntax.ts`, or `server.test.ts`.
- **Location:** `README.md:139-145`
- **Evidence:**
  ```markdown
  - `components/anchored-bubble.ts` places both popups by the button that opened them and closes them on a press
  ```
- **Raised by:** report S7, A4
- **Confidence:** Verified
- **Bears on:** S-3, D-8

## Findings No Agent Could Audit

- The CSS cascade in a real browser. Neither happy-dom nor `tsc` sees it. Unit 1 compares the bundled CSS before and
  after the move instead (D-10).

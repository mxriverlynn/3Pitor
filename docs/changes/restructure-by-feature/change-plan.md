# Change Plan: Restructure src/ by Package, Feature, and Component

## Why This Change

This change comes from two sources:

- **A deliberate improvement.** The owner asked for the code to be "organized by package (like they currently are),
  then by feature, then by component within the feature". Components shared between features go in a scoped
  `components/` folder, and anything shared between packages goes in the shared package
  ([scope-boundary.md](artifacts/scope-boundary.md)).
- **A finding already established.** The [architectural analysis](artifacts/architectural-analysis.md) that preceded
  this plan found where the current layout would make that move unsafe.

The owner is away and asked for every decision to be made and justified without them
([D-20](artifacts/change-decision-log.md#trivial-decisions)).

## What Changes, In One Paragraph

After this change, the path of every file answers three questions:

1. **Which package it runs in:** `server`, `ui`, or `shared`.
2. **Which capability (reason to change) it serves:** `chat`, `documents`, `events`, `popups`, `workspace`, or
   `workspace-config`.
3. **Which component of that capability it is**, when the capability has more than one
   ([D-1](artifacts/change-decision-log.md#d-1-the-component-level-is-a-real-folder-but-only-inside-features-that-have-more-than-one-component)).

A few rules place the rest:

- Code used by several components or features sits in a `components/` folder at the lowest level that covers all its
  users.
- Code both packages depend on sits in `src/shared`, so no UI file imports server code.
- Entry points stay at their package roots, so the build, the test commands, and the scripts are untouched.
- Path arithmetic that used to depend on where a file sat now comes from one anchor module, with a test guarding it.

## Current State

Today `src/server` and `src/ui` are flat. Each file is roughly one feature, and the README's file map describes the
grouping. Four properties of the current code decide how the move has to happen.

**Two path calculations silently break when their files move deeper.**
- `SRC` in `workspace.ts` and the skills folder in `app-skills.macro.ts` are both computed relative to their own folder
  ([C-1](artifacts/current-state-findings.md#c-1-two-path-calculations-assume-they-sit-exactly-one-folder-below-src)).
- `SRC` is used by three tests and the check script
  ([C-2](artifacts/current-state-findings.md#c-2-src-is-used-outside-the-workspace-feature)).
- A seeded `src/.data/workspace` hides a wrong `SRC`
  ([C-3](artifacts/current-state-findings.md#c-3-a-seeded-dataworkspace-folder-hides-a-wrong-src)).
- A wrong macro path can embed no skills at all
  ([C-4](artifacts/current-state-findings.md#c-4-the-macro-embeds-whatever-it-finds-including-nothing)).

**One UI test imports server code.** It does so to check that the server and the editor find the same textblocks, and
the two sides each carry a copy of that walk
([C-5](artifacts/current-state-findings.md#c-5-a-ui-test-imports-server-code-to-prove-the-server-and-ui-find-the-same-blocks)).

**Three server files share one mutable object.** `sessions.ts`, `agent.ts`, and `tools.ts` all work on the per-turn
`TurnTexts`
([C-6](artifacts/current-state-findings.md#c-6-sessionsts-agentts-and-toolsts-share-one-piece-of-per-turn-mutable-state)).

**Several shared modules have a known, small set of users.**
- `test-model.ts` has exactly two
  ([C-7](artifacts/current-state-findings.md#c-7-test-modelts-is-used-by-exactly-two-test-files)).
- `api.ts` and `anchored-bubble.ts` have users that set the scope of their `components/` folders
  ([C-12](artifacts/current-state-findings.md#c-12-which-features-use-each-ui-module)).

## Target State

```
src/
  server/
    server.ts  agent-host.ts                     entry point and composition (D-2), unchanged paths
    paths.ts  paths.test.ts                      NEW: the one SRC anchor, must stay here (D-3)
    scripts/check.ts                             unchanged (D-5)
    chat/                                        feature: one chat turn (D-6)
      sessions/  sessions.ts  sessions.routes.ts  sessions.test.ts  sessions.routes.test.ts
      agent/     agent.ts  agent.test.ts
      tools/     tools.ts  tools.test.ts
      components/test-model.ts                   shared by the sessions and agent tests (D-7)
    documents/   documents.routes.ts             single component
    events/      events.ts  events.routes.ts     single component
    workspace/   workspace.ts  workspace.test.ts single component (D-14)
    workspace-config/  workspace-config.ts  workspace-config.routes.ts  app-skills.macro.ts  + 2 tests  (D-14)
  ui/
    index.html  app.tsx  app.test.tsx  styles.css  css.d.ts  test-setup.ts   unchanged (D-2)
    components/api.ts                            shared by app, documents and chat (D-8)
    events/host-events.ts                        single component (D-11)
    documents/
      documents/        documents.tsx  .css  .test.tsx
      markdown-editor/  markdown-editor.tsx  .css  .test.tsx
    chat/
      chat/         chat.tsx  .css  .test.tsx
      agent-panel/  agent-panel.tsx  .css  .test.tsx   (D-9)
    popups/
      question-popup/   question-popup.tsx  .test.tsx
      selection-popup/  selection-popup.tsx  .css  .test.tsx
      components/       anchored-bubble.ts  anchored-bubble.css   (D-10)
  shared/  wire.ts  markdown-support.ts  passages.ts  blocks.ts  + tests      flat (D-13)
  skills/  fixtures/  .data/                     not code; unchanged (D-19)
```

**What a component is.** A component is one module, plus the helpers that only it imports (a Hono routes adapter for
its domain module, a Bun macro), plus its tests and its CSS. So `events.ts` + `events.routes.ts` is one component, and
`workspace-config.ts` + `workspace-config.routes.ts` + `app-skills.macro.ts` is one component
([D-21](artifacts/change-decision-log.md#d-21-a-component-is-a-module-plus-the-helpers-only-it-imports)). A
`components/` folder holds code shared by siblings, not React components specifically: a fetch helper and a test-only
scripted model both qualify.

**Placement rules** (in the order they apply):

1. **Entry points stay at their package roots**
   ([D-2](artifacts/change-decision-log.md#d-2-entry-points-stay-at-their-package-roots)).
2. **A feature with several components gets one folder per component.** A single-component feature holds its files
   directly (D-1).
3. **A capability in both packages uses the same feature name in each**
   ([D-15](artifacts/change-decision-log.md#d-15-a-capability-that-spans-both-packages-uses-the-same-feature-name-in-each)).
4. **A file shared inside one feature goes to `<feature>/components/`.** A file shared across features in one package
   goes to `<package>/components/`. A file shared across packages goes to `src/shared/`.
5. **Tests sit beside what they test** ([D-17](artifacts/change-decision-log.md#trivial-decisions)).
6. **No barrels** ([D-12](artifacts/change-decision-log.md#d-12-no-indexts-barrels)).

**Dependency direction afterwards:**
- Composition roots (`server.ts`, `agent-host.ts`, `app.tsx`) depend on features. `app.tsx` also imports the `Ask` and
  `SelectionAsk` types from `ui/documents/markdown-editor`.
- Features depend on `shared/` and on their package's `components/`: `ui/chat` and `ui/documents` → `ui/components/api`.
- `server/chat` depends on `server/events` and `server/workspace-config`
  ([C-8](artifacts/current-state-findings.md#c-8-toolsts-depends-on-the-workspace-config-feature)).
- `ui/documents/documents` depends on `ui/documents/markdown-editor`.
- `server/scripts/check.ts` depends on `server/paths` and `server/workspace`.
- No file in `ui/` imports anything from `server/`. The one edge between the two packages runs the other way:
  `server.ts` imports `../ui/index.html` to serve the page.

**Pinned contracts:**

```ts
// src/server/paths.ts — directly under src/server/; nothing else computes src/ from import.meta.dir
export const SRC: string; // resolve(import.meta.dir, '..') — the absolute path of src/

// src/shared/blocks.ts — no imports; any ProseMirror Node satisfies TextblockTree
export interface TextblockTree {
  isTextblock: boolean;
  textContent: string;
  descendants(visit: (node: TextblockTree, pos: number) => void | boolean): void;
}
export function textblocks(root: TextblockTree): { text: string; pos: number }[];
// Worked example: the markdown "# A\n\nb" parsed by defaultMarkdownParser gives
// [{ text: 'A', pos: 1 }, { text: 'b', pos: 4 }]
```

## Surface Delta

### S-1: `src/shared/blocks.ts` (`textblocks`, `TextblockTree`) — Added

**Target state.** `textblocks(root)` returns every textblock under a ProseMirror-shaped tree in document order, each as
`{ text, pos }` where `pos` is the position just inside the block. It is the only textblock walk in the codebase.
`server/chat/tools/tools.ts`'s `postBlocks(markdown)` returns `textblocks(defaultMarkdownParser.parse(markdown))` texts.
`ui/documents/markdown-editor/markdown-editor.tsx` uses it where it used `blocksOf`, which no longer exists.

**Behavior.** Preserving. Same walk, same predicate (`isTextblock`), same `pos + 1`. The existing Highlight tests in
`tools.test.ts` and `markdown-editor.test.tsx:126` pin it indirectly. Because Unit 1 rewrites the UI parity test, Unit 1
also adds direct pins so parity does not rest on convention
([D-4](artifacts/change-decision-log.md#d-4-the-textblock-walk-moves-to-srcsharedblocksts-the-markdown-parse-stays-in-the-server)):
`tools.test.ts` asserts `postBlocks` returns the exact five strings of the markdown the UI parity test uses, and the UI
parity test asserts the editor's blocks equal those same five strings.

**Why.** It removes the UI → server import and the duplicated walk
([C-5](artifacts/current-state-findings.md#c-5-a-ui-test-imports-server-code-to-prove-the-server-and-ui-find-the-same-blocks)).

**Migration.** Call `textblocks(doc)` where you called `blocksOf(doc)`.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-textblock-walk-moves-to-srcsharedblocksts-the-markdown-parse-stays-in-the-server)

### S-2: `src/server/paths.ts` (`SRC`) — Added

**Target state.** `SRC` is exported from `src/server/paths.ts` and nowhere else. It is the absolute path of `src/`, and
`paths.test.ts` fails if it is not.

**Behavior.** Preserving. It holds the same value as today's `workspace.ts` `SRC`.

**Why.** It is the one anchor that lets every other file move ([C-1](artifacts/current-state-findings.md#c-1-two-path-calculations-assume-they-sit-exactly-one-folder-below-src), [C-2](artifacts/current-state-findings.md#c-2-src-is-used-outside-the-workspace-feature)).

**Migration.** Import `SRC` from `paths` instead of `workspace`.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-srcserverpathsts-is-the-one-place-src-is-computed-guarded-by-a-test)

### S-3: `workspace.ts` `SRC` export and `app-skills.macro.ts` folder computation — Re-scoped

**Target state.** `workspace.ts` owns choosing and seeding workspaces and no longer exports `SRC`. `app-skills.macro.ts`
embeds `join(SRC, 'skills')`. Neither file computes a path from its own location.

**Behavior.** Preserving. Same fixture path, same `.data` path, same embedded files.

**Why.** Both files can then move to any depth
([C-1](artifacts/current-state-findings.md#c-1-two-path-calculations-assume-they-sit-exactly-one-folder-below-src),
[C-4](artifacts/current-state-findings.md#c-4-the-macro-embeds-whatever-it-finds-including-nothing)).

**Depends on.** S-2.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-srcserverpathsts-is-the-one-place-src-is-computed-guarded-by-a-test)

### S-4: `sessions`, `agent`, `tools`, `test-model` → `src/server/chat/…` — Moved

**Target state.**
- The three modules keep their exports unchanged, at these paths:
  - `src/server/chat/sessions/sessions.ts` (with `sessions.routes.ts`)
  - `src/server/chat/agent/agent.ts`
  - `src/server/chat/tools/tools.ts`
- `TurnTexts` stays in `tools.ts`.
- `scriptedModel` and `useModel` are in `src/server/chat/components/test-model.ts`.
- `server.ts` and `agent-host.ts` import from these paths.

**Behavior.** Preserving. Only the import specifiers change.

**Why.** The three share per-turn state and must stay together
([C-6](artifacts/current-state-findings.md#c-6-sessionsts-agentts-and-toolsts-share-one-piece-of-per-turn-mutable-state),
[C-7](artifacts/current-state-findings.md#c-7-test-modelts-is-used-by-exactly-two-test-files)).

**Depends on.** S-1, S-2.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-sessions-agent-and-tools-are-three-components-of-one-server-feature-chat), [D-7](artifacts/change-decision-log.md#d-7-test-modelts-goes-to-srcserverchatcomponentstest-modelts)

### S-5: `documents.routes`, `events`, `workspace`, `workspace-config` → feature folders — Moved

**Target state.** Each of these modules keeps its exports unchanged:
- `src/server/documents/documents.routes.ts`
- `src/server/events/events.ts` and `events.routes.ts`
- `src/server/workspace/workspace.ts`
- `src/server/workspace-config/` with `app-skills.macro.ts`

**Behavior.** Preserving. The macro's output is pinned by `workspace-config.test.ts`, and by `make check-build` for the
compiled binary. `workspace` and `workspace-config` are pinned by their unit tests. `documents.routes.ts` and
`events.routes.ts` have no unit tests
([C-13](artifacts/current-state-findings.md#c-13-behavior-findings-that-a-restructure-does-not-need), Gaps). A broken
import there fails `tsc` and server start. Their end-to-end check is `bun run check`, which sends real chat turns and
needs `ANTHROPIC_API_KEY`. The key is set in this run's environment, so Unit 3 runs it.

**Why.** The owner asked for feature folders.

**Depends on.** S-3.

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-workspace-and-workspace-config-stay-separate-single-component-server-features)

### S-6: UI modules → feature and component folders — Moved

**Target state.**
- Every UI module in the target tree keeps its exports, DOM, and class names.
- `app.tsx` imports from the new paths.
- Each component's CSS sits beside it and is imported with the same `./x.css`.
- `documents.test.tsx`'s `mock.module` and `import()` specifiers name `../markdown-editor/markdown-editor`, the same
  module `documents.tsx` imports
  ([C-11](artifacts/current-state-findings.md#c-11-documentstesttsx-mocks-the-editor-by-a-relative-specifier-string)).

**Behavior.** Preserving. DOM, exports, and class names are pinned by all 79 UI tests. Those tests do not load
stylesheets, so the CSS is pinned a different way: `app.tsx` keeps its import lines in their current order, and Unit 4
diffs the bundled CSS from `bun build src/ui/index.html` before and after the move.

**Why.** The owner asked for feature and component folders.

**Depends on.** S-1.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-apits-goes-to-srcuicomponentsapits), [D-9](artifacts/change-decision-log.md#d-9-agent-panel-is-a-component-of-the-ui-chat-feature), [D-10](artifacts/change-decision-log.md#d-10-popups-is-a-ui-feature-with-anchored-bubble-in-popupscomponents)

## Behavior Changes

Every entry is behavior-preserving. HTTP routes, payloads, the UI's DOM and CSS, the embedded skills, and every command
in the README stay the same. Two things do change, and neither is behavior: the source file paths that appear in stack
traces and `bun test` output, and plain `git blame` on a moved file, which needs `--follow` to reach earlier history. A
developer reading a trace, or a local script or editor bookmark that names an old path, sees the new paths.

## Change Units

### Unit 1: Share the textblock walk

**What it does.**
1. Adds `src/shared/blocks.ts` test-first.
2. Points `postBlocks` and the editor at it.
3. Rewrites the UI parity test so it no longer imports server code.

**Delta entries.** S-1.

**How you know it worked.** `make test` and `tsc` pass, and `grep -r "server/" src/ui` finds nothing. `blocks.test.ts`
covers:
- the worked example, with full `{ text, pos }` equality;
- document order across a heading, a paragraph, a list item, and a code block;
- list containers excluded, so only the item's paragraph is returned;
- a hand-built `TextblockTree` that is not a ProseMirror node, which pins the zero-import contract;
- an empty result.

### Unit 2: Anchor `SRC`

**What it does.**
1. Adds `src/server/paths.ts` with its guard test.
2. Switches `workspace.ts`, the macro, three tests, and `check.ts` to it.

**Delta entries.** S-2, S-3.

**How you know it worked.** `make test` passes, and `grep -rn "import.meta.dir" src` shows only `paths.ts`. The guard
test fails if `SRC` resolves anywhere but `src/`, which is C-1's failure turned loud. The compiled-binary half of D-3
is checked in Unit 3 by `make check-build`, not here.

### Unit 3: Move the server into feature folders

**What it does.** Moves the server files with `git mv` and rewrites their imports.

**Delta entries.** S-4, S-5.

**Ordering constraint.** After Unit 2. Moving `workspace.ts` or the macro before the anchor exists breaks C-1.

**How you know it worked.**
- `make test`, `tsc`, and `make check-build` pass. `check-build` proves the compiled binary still embeds
  `collaborative-draft-editing`.
- `bun run check` passes against a freshly reset workspace.

### Unit 4: Move the UI into feature and component folders

**What it does.** Moves the UI files with `git mv` and rewrites imports and the `mock.module` specifiers.

**Delta entries.** S-6.

**Ordering constraint.** After Unit 1, so no UI file imports server code during the move.

**How you know it worked.**
- `make test-ui` passes 79 tests, and `tsc` passes.
- `make build` bundles the UI.
- The CSS from `bun build src/ui/index.html` is byte-identical to the baseline taken before Unit 1.

### Unit 5: Update the README's file map

**What it does.** Rewrites the README's `src/` section to describe the new layout and its placement rules. It also fixes
the stale `agent-panel` description.

**Delta entries.** —

**How you know it worked.** Every path the README names exists.

**Every unit** also appends an entry to [change-log.md](change-log.md): the commit, what changed, why, and the decisions
behind it. That file is the running log the owner asked for.

## Risks

- **A mock that silently stops applying.** If `documents.test.tsx`'s specifier and `documents.tsx`'s import disagree,
  the mock no longer applies. The tests that depend on it would then fail rather than pass vacuously, so the failure is
  detectable in `make test-ui`.
- **The macro breaks only in the compiled binary.** Unit 3 runs `make check-build` for this reason.
- **CSS cascade order shifts.** The bundle orders CSS by import order. Re-sorting `app.tsx`'s imports during the rewrite
  could reorder it. This is detected by the CSS diff in Unit 4.
- **Moves make review noisy.** `git mv` in a separate commit per package keeps each diff down to renames plus import
  lines.

## Deferred (YAGNI)

- **Feature barrels** — trigger: an import-boundary lint is adopted
  ([D-12](artifacts/change-decision-log.md#d-12-no-indexts-barrels)).
- **An import-boundary lint (report R8)** — trigger: a second non-root cross-package import appears.
- **A `TurnReconciler` abstraction for report C2** — trigger: a second editor or reconciliation strategy.
- **Typed HTTP route shapes in `src/shared`** — trigger: a server/UI shape mismatch ships
  ([D-22](artifacts/change-decision-log.md#d-22-http-route-shapes-are-not-moved-into-shared)).

## Cut for Scope

The owner asked for a restructure and did not ask for behavior changes, so these report findings are follow-ups
([D-16](artifacts/change-decision-log.md#d-16-behavior-changing-findings-are-cut-from-this-change),
[C-13](artifacts/current-state-findings.md#c-13-behavior-findings-that-a-restructure-does-not-need)). Any of them can
be reinstated.

- **Serializing or locking file-tool calls within one model step (C1).** Stops two edits in one step from silently
  losing one of them.
- **Honoring `abortSignal` inside each file tool (C5).** Makes Stop halt in-flight tool work, instead of only discarding
  its result.
- **Validating the `data-session` payload at runtime (B5).** Turns a malformed finish into a handled error instead of an
  uncaught exception.
- **Isolating EventBus listeners and filtering events by session (C3/C4).** Stops one listener from blocking the
  others, and stops tabs from seeing other sessions' events.
- **Validating `PUT /api/documents` input (B10).** Returns a 400 with a message instead of a bare 500.
- **One symlink-safe workspace path check for documents and tools (S15/B9, A7).** `GET`/`PUT /api/documents` would
  refuse a symlink that points outside the workspace.

## Open Items

None blocking. The owner has not yet seen the cut list or the D-1 override of the architect's no-component-folders
recommendation. Both are called out in the pull request description.

## Review Findings

One review round (medium size, cap 2). The size is medium because the change spans three packages, and every delta is
behavior-preserving. The team was `han-core:junior-developer` (a required seat) and `han-core:test-engineer`.
Verification of behavior preservation rests on the tests, so the test engineer was the one specialist chosen. The
full findings and how each was resolved are in [review-round.md](artifacts/review-round.md). Findings that changed the
plan:

- **JD-001:** "component" was undefined. Now defined (D-21).
- **JD-004:** Route shapes shared between packages. Decided not to move them (D-22).
- **JD-005, TE Q1:** After the parity test's rewrite, nothing pinned `postBlocks` directly. Direct pins added (S-1).
- **JD-006, TE Q3:** S-5 overstated its test coverage. Reworded, and `bun run check` confirmed runnable here.
- **JD-007:** "Build output unchanged" overclaimed. Reworded.
- **JD-008, TE Q1:** The UI tests do not cover CSS. A bundle diff and an import-order rule were added (S-6, Unit 4).
- **JD-009:** The dependency list was incomplete. Fixed.
- **JD-010:** The running change log had no home in the plan. It is now a step in every unit.
- **JD-011:** D-1's wording contradicted the tree. Fixed.

Two findings stay labelled Unverified: the built CSS order (now checked by the Unit 4 diff) and whether an API key is
available where the plan runs (it is available in this run).

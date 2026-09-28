# Change Decision Log: Restructure src/ by Package, Feature, and Component

This file records every decision made while planning this change. The owner was away and asked for every decision to be
made and justified here, so no decision below was put to the owner. Each one carries the reasoning the owner would
otherwise have been asked to weigh. The plan is [../change-plan.md](../change-plan.md). Evidence about today's code is
[current-state-findings.md](current-state-findings.md) (C-N), and the full analysis is
[architectural-analysis.md](architectural-analysis.md) (S#, B#, C#, R#, A#).

## Trivial decisions

- D-5: `scripts/check.ts` stays at `src/server/scripts/check.ts` — it is dev tooling, not a feature, and `package.json`'s
  `check` script names it by path. — Referenced in plan: Target State.
- D-11: `host-events.ts` goes to `src/ui/events/host-events.ts` — it is the client side of the server's `events`
  feature, and only `app.tsx` uses it ([C-12](current-state-findings.md#c-12-which-features-use-each-ui-module)). Using
  the same feature name as the server makes it easy to find. — Referenced in plan: Target State.
- D-17: Every test file moves with the code it tests and keeps its basename — this keeps the existing `x.ts` +
  `x.test.ts` pairing that every test in the repo already follows. — Referenced in plan: Target State.
- D-18: Files move with `git mv`, one package per commit — `git log --follow` keeps each file's history, and each
  commit leaves `make test` green. — Referenced in plan: Change Units.
- D-19: `src/skills`, `src/fixtures`, and `src/.data` do not move — they are content, not code. `SRC`-relative paths,
  `.gitignore`, and the README all name them. — Referenced in plan: Target State.
- D-20: The Step 1.5 confirmation turn and every escalation were replaced by recorded decisions — the owner asked for
  autonomous decisions ("i need you to make the decisions around this and justify every decision you made"). —
  Referenced in plan: Why This Change.

## Full decisions

### D-1: The component level is a real folder, but only inside features that have more than one component

- **Question:** What does "then by component within the feature" become on disk?
- **Decision:**
  - A feature with more than one component holds one folder per component.
  - Each component folder is named after the component's files, and holds its `.ts`/`.tsx`, `.css`, and tests.
  - A feature with exactly one component keeps its files directly in the feature folder.
  - Example: `src/ui/chat/chat/chat.tsx` and `src/ui/chat/agent-panel/agent-panel.tsx`, but `src/server/events/events.ts`.
- **Rationale:**
  - The owner asked for three levels by name: package, feature, component. The architect deferred component folders
    as YAGNI (A2, Deferred). But the owner's explicit request is scope evidence, and it outranks a taste-level YAGNI
    call.
  - Nesting a single component (`events/events/events.ts`) adds a folder that tells the reader nothing, because the
    feature and the component are the same thing. So the level exists wherever there is more than one thing to tell
    apart.
  - The rule is "a component folder repeats the feature's name only when the feature has other components". So
    `ui/chat/chat/` and `ui/documents/documents/` appear because they sit beside `agent-panel/` and
    `markdown-editor/`, and `server/events/events/` does not (review finding JD-011).
- **Evidence:** [scope-boundary.md](scope-boundary.md) Stated Scope; architectural-analysis A2 "Deferred (YAGNI)".
- **Behavior impact:** Preserving. Only file locations change.
- **Rejected alternatives:**
  - Basename groups only, with no component folders (the architect's A2) — rejected because it drops a level the owner
    named explicitly.
  - Component folders everywhere, even in single-component features — rejected because `documents/documents.routes.ts`
    would become `documents/documents/documents.routes.ts`, and that repetition carries no information.
- **Revisit criterion:** A single-component feature gains a second component. It then gets component folders.
- **Dissent (if any):** software-architect (A2) recommended no component folders, with the trigger "a single component
  grows to 4+ files". Overruled by the owner's explicit scope.
- **Settles delta entry:** S-4, S-5, S-6
- **Dependent decisions:** D-6, D-7, D-9, D-10, D-14
- **Referenced in plan:** What Changes, In One Paragraph; Target State

### D-2: Entry points stay at their package roots

- **Question:** Where do `server.ts`, `agent-host.ts`, `app.tsx`, `index.html`, `styles.css`, `css.d.ts`, and
  `test-setup.ts` live?
- **Decision:** They do not move. They are composition roots or tool entry points, not features.
- **Rationale:**
  - These files are named by path from places TypeScript does not check
    ([C-9](current-state-findings.md#c-9-the-entry-points-are-referenced-by-path-from-outside-typescript)): the
    `Makefile`, `package.json`, `server.ts`'s HTML import, `index.html`'s `<script>`/`<link>`, and `check.ts`'s spawn
    string.
  - Keeping them in place means none of those references change.
  - `app.tsx` and `server.ts` are also documented as "the only file that wires features together", so they belong above
    the features.
  - `agent-host.ts` wires `events` and `chat` together, so it is composition too.
- **Evidence:** C-9; report S5, S10, B4, R10, A2.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - An `app/` feature folder in the UI for `app.tsx` and `index.html` — rejected because it moves the `Makefile` preload
    path and the HTML import for no organizational gain.
- **Revisit criterion:** A second UI entry page, or a second server binary.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** D-3
- **Referenced in plan:** Target State

### D-3: `src/server/paths.ts` is the one place `SRC` is computed, guarded by a test

- **Question:** How do `SRC` and the macro's skills folder keep working once their files move deeper?
- **Decision:**
  - Add `src/server/paths.ts`, which must stay directly under `src/server/`:
    ```ts
    // src/server/paths.ts
    export const SRC: string; // = resolve(import.meta.dir, '..'), the absolute path of src/
    ```
  - Add `src/server/paths.test.ts`. It asserts that `server/server.ts`, `skills`, `fixtures/workspace`, and
    `ui/index.html` all exist under `SRC`.
  - `workspace.ts` stops exporting `SRC` and imports it instead.
  - `app-skills.macro.ts` computes its folder as `join(SRC, 'skills')`.
  - Every other user imports `SRC` from `paths.ts`.
- **Rationale:**
  - R1 is the only Critical risk. The planned move would silently break both calculations
    ([C-1](current-state-findings.md#c-1-two-path-calculations-assume-they-sit-exactly-one-folder-below-src)), and a
    seeded workspace would hide the break ([C-3](current-state-findings.md#c-3-a-seeded-dataworkspace-folder-hides-a-wrong-src)).
  - One anchor at a depth that never changes, plus a test that fails loudly, turns a silent failure into a red
    `make test`.
  - The architect checked that a macro in a nested folder can import the anchor, both under `bun run` and in a
    `bun build --compile` binary.
- **Evidence:** C-1, C-2, C-3, C-4; report A1, R1.
- **Behavior impact:** Preserving. `SRC` resolves to the same absolute path as before.
- **Rejected alternatives:**
  - Walk up to find `package.json` — rejected because `import.meta.dir` is a virtual path inside the compiled binary, so
    the walk needs a fallback that is new behavior.
  - Recount `../` at each new depth — rejected because it is the same fragile pattern, with no guard.
  - Leave `workspace.ts` and the macro at the package root — rejected because it breaks the feature layout for two files
    only because of path arithmetic.
- **Revisit criterion:** The server package root moves.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Change Units

### D-4: The textblock walk moves to `src/shared/blocks.ts`; the markdown parse stays in the server

- **Question:** How does the UI's parity test stop importing server code, given the owner's rule that cross-package
  code lives in the shared package?
- **Decision:**
  - Add a zero-import `src/shared/blocks.ts`:
    ```ts
    export interface TextblockTree {
      isTextblock: boolean;
      textContent: string;
      descendants(visit: (node: TextblockTree, pos: number) => void | boolean): void;
    }
    // Each textblock under root, in document order, with the position just inside it (pos + 1).
    export function textblocks(root: TextblockTree): { text: string; pos: number }[];
    ```
  - `tools.ts` keeps `postBlocks(markdown: string): string[]`, now implemented as
    `textblocks(defaultMarkdownParser.parse(markdown)).map((b) => b.text)`.
  - `markdown-editor.tsx` drops `blocksOf` and calls `textblocks`.
  - The parity test in `markdown-editor.test.tsx` compares `textblocks(editorDoc)` with
    `textblocks(defaultMarkdownParser.parse(md))`, so it no longer imports server code.
  - Both sides pin the same five expected block strings. `tools.test.ts` asserts `postBlocks(md)` returns them, and the
    UI parity test asserts the editor's blocks equal them. If either side changes its parser or schema, one test fails
    (review findings JD-005 and TE Q1).
- **Rationale:**
  - One copy of the walk means the two sides cannot drift apart (S13).
  - The UI test no longer needs the server package to compile (S4).
  - Typing the tree structurally keeps `src/shared`'s documented "no imports" property.
  - The architect checked that a ProseMirror `Node` satisfies `TextblockTree` under the repo's strict `tsc`.
- **Evidence:** [C-5](current-state-findings.md#c-5-a-ui-test-imports-server-code-to-prove-the-server-and-ui-find-the-same-blocks); report A4, R6.
- **Behavior impact:** Preserving. Same blocks, same order, same `pos + 1` positions.
- **Rejected alternatives:**
  - Move `postBlocks` itself into shared — rejected because it would give `shared/` its first import
    (`prosemirror-markdown`), for a risk (R16) that is rated Low.
  - Only re-point the import to the server's new path — rejected because it keeps a UI → server import, which the owner's
    rule forbids.
- **Revisit criterion:** The editor stops being ProseMirror.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Change Units

### D-6: `sessions`, `agent`, and `tools` are three components of one server feature, `chat`

- **Question:** Are `sessions.ts`, `agent.ts`, and `tools.ts` one feature or three, and what is the feature called?
- **Decision:**
  - They are one feature, `src/server/chat/`, with component folders `sessions/`, `agent/`, and `tools/`.
  - `TurnTexts` stays in `tools/tools.ts`.
- **Rationale:**
  - They share unsynchronized per-turn state
    ([C-6](current-state-findings.md#c-6-sessionsts-agentts-and-toolsts-share-one-piece-of-per-turn-mutable-state)).
    Any fix for report C1 or C5 has to touch all three, and splitting them into separate features would turn
    `sessions → tools` into an import that reaches into another feature's internals (A3, R3).
  - The feature is called `chat`, not `sessions`:
    - Its job is a chat turn (the README: "chat turns and cancelling").
    - The UI's feature for the same capability is `chat` (D-15).
    - With component folders (D-1), `sessions/sessions/` would repeat itself.
  - `sessions` survives as the component name, matching the `Sessions` class and `/api/sessions`.
- **Evidence:** C-6, C-8; report A3, C1, C5, S6, B13.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Separate `agent/` and `sessions/` features — rejected per R3.
  - A flat `sessions/` feature with no component folders (A3 as written) — rejected per D-1.
- **Revisit criterion:** `agent.ts` gains a caller outside a chat turn, such as a background job feature.
- **Dissent (if any):** None. This refines A3's name only.
- **Settles delta entry:** S-4
- **Dependent decisions:** D-7
- **Referenced in plan:** Target State

### D-7: `test-model.ts` goes to `src/server/chat/components/test-model.ts`

- **Question:** Where does a test helper shared by two components of one feature live?
- **Decision:** In a `components/` folder at the lowest level shared by everything that uses it: `src/server/chat/components/`.
- **Rationale:**
  - It is the owner's rule applied one level down. It is used by the `sessions` and `agent` components, both inside
    `chat` ([C-7](current-state-findings.md#c-7-test-modelts-is-used-by-exactly-two-test-files)).
  - It mocks by package name, so it depends on no path.
- **Evidence:** C-7; report S7, R13.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Inside `sessions/` — rejected because `agent.test.ts` would then reach into a sibling component for a shared helper.
  - At `src/server/components/` — rejected because that scope is wider than its users.
- **Revisit criterion:** A test outside `chat` needs a scripted model. Then it moves up to `src/server/components/`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-8: `api.ts` goes to `src/ui/components/api.ts`

- **Question:** Where does the UI fetch helper live?
- **Decision:** `src/ui/components/api.ts`.
- **Rationale:** It is used by the `documents` and `chat` features and by `app.tsx`
  ([C-12](current-state-findings.md#c-12-which-features-use-each-ui-module)). No single feature owns it, and its users
  span the UI package, so its scope is the UI package's `components/` folder.
- **Evidence:** C-12; report A2 rule 4.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Keep it at the UI root — rejected because the UI root is for entry points (D-2), and the owner asked for shared
    things to go in `components/`.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-9: `agent-panel` is a component of the UI `chat` feature

- **Question:** Is `agent-panel` its own feature?
- **Decision:** No. It is `src/ui/chat/agent-panel/`, beside `src/ui/chat/chat/`. The file name, the `AgentPanel`
  export, and its DOM are unchanged.
- **Rationale:** It only renders the Clear Chat button
  ([C-10](current-state-findings.md#c-10-agent-paneltsx-only-renders-the-clear-chat-button)), so its only reason to change
  is chat. Renaming it would be a separate change the owner did not ask for.
- **Evidence:** C-10; report S2, R15, A5.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Its own feature folder — rejected because it misstates what the file does (R15).
  - Rename to `chat-header` — rejected as out of scope for a pure move.
- **Revisit criterion:** The panel regains workspace-level content, such as the skill list.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-10: `popups` is a UI feature, with `anchored-bubble` in `popups/components/`

- **Question:** Where do `question-popup`, `selection-popup`, and `anchored-bubble` go?
- **Decision:**
  - `src/ui/popups/question-popup/` and `src/ui/popups/selection-popup/` are the two components.
  - `src/ui/popups/components/anchored-bubble.ts` and its `.css` sit beside them.
- **Rationale:**
  - `anchored-bubble` is used by exactly those two components
    ([C-12](current-state-findings.md#c-12-which-features-use-each-ui-module)). The owner's rule puts shared things in a
    `components/` folder scoped to everything that shares it, and here that is the `popups` feature.
  - Both popups do one job: asking the AI about text in the editor.
- **Evidence:** C-12; report A5.
- **Behavior impact:** Preserving. `anchored-bubble.css` still reaches the bundle through `anchored-bubble.ts`'s own
  import.
- **Rejected alternatives:**
  - Siblings in a flat `popups/` (A5 as written) — rejected per D-1.
  - Put popups under `chat` because they send through chat — rejected because they sit on the editor and are anchored to
    it. Chat is only their outbound channel, which `app.tsx` wires.
- **Revisit criterion:** A third feature uses `anchored-bubble`. Then it moves up to `src/ui/components/`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-12: No `index.ts` barrels

- **Question:** Should each feature get an `index.ts` that re-exports its public surface?
- **Decision:** No. Callers import the component file directly.
- **Rationale:**
  - The repo has no barrels today.
  - A barrel gives a module a second import path, and that breaks `documents.test.tsx`'s `mock.module` of the editor
    ([C-11](current-state-findings.md#c-11-documentstesttsx-mocks-the-editor-by-a-relative-specifier-string)).
  - No feature has more than two outside consumers.
- **Evidence:** C-11; report A6.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Barrels per feature — rejected for the reasons above.
- **Revisit criterion:** An import-boundary lint is adopted and needs one public entry per feature.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Deferred (YAGNI)

### D-13: `src/shared` stays flat

- **Question:** Does the shared package get feature folders?
- **Decision:** No. `wire.ts`, `markdown-support.ts`, `passages.ts`, and the new `blocks.ts` sit directly in
  `src/shared/`.
- **Rationale:** Each shared module is used by several features in both packages (`wire.ts` by chat, events, and
  documents; `passages.ts` by chat's tools and the documents editor). No shared module belongs to one feature, so a
  feature folder would have nothing to group.
- **Evidence:** report S12, and the structural-analyst mapping for `src/shared`.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - `shared/chat/wire.ts` and similar — rejected because each module crosses features.
- **Revisit criterion:** Two or more shared modules are used by only one feature.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-14: `workspace` and `workspace-config` stay separate single-component server features

- **Question:** Should the workspace folder choice and the skills/agents config merge into one feature?
- **Decision:**
  - `src/server/workspace/` holds `workspace.ts` and its test.
  - `src/server/workspace-config/` holds `workspace-config.ts`, its routes, `app-skills.macro.ts`, and their tests.
- **Rationale:**
  - They change for different reasons: which folder is open, versus what skills and agents it has.
  - They keep their current names, which the README and `/api/workspace-config` use.
  - The macro stays in the same folder as its only importer (report A2).
- **Evidence:** report structural-analyst mapping, A2.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - One `workspace/` feature with two components — rejected because nothing imports both together except `server.ts`.
- **Revisit criterion:** A change needs to edit both files together.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-15: A capability that spans both packages uses the same feature name in each

- **Question:** How are features named across `server` and `ui`?
- **Decision:** `chat`, `documents`, and `events` are the feature names in both packages. Features that exist in only
  one package keep their current names: `workspace` and `workspace-config` on the server, `popups` in the UI.
- **Rationale:** A reader who knows the feature name finds its server half and its UI half at
  `src/server/<feature>` and `src/ui/<feature>`.
- **Evidence:** README file map; D-6.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Name the UI feature `editor` to avoid `documents/documents/` — rejected because the name would no longer match
    the server's `documents` feature.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-16: Behavior-changing findings are cut from this change

- **Question:** Should the restructure also fix the behavior findings (C-13)?
- **Decision:** No. They are listed in Cut for Scope as follow-ups:
  - locking tool calls (C1);
  - tool `abortSignal` (C5);
  - `data-session` validation (B5);
  - EventBus isolation and filtering (C3/C4);
  - `PUT /api/documents` validation (B10);
  - unifying path confinement (S15/B9, A7).
- **Rationale:**
  - The owner asked for a restructure, and each of these changes something a user or caller can observe.
  - Keeping the pull request free of behavior changes means a green `make test` is enough evidence that nothing broke.
  - Placement is chosen so each fix stays local: C1 and C5 both land inside `server/chat/`.
- **Evidence:** [C-13](current-state-findings.md#c-13-behavior-findings-that-a-restructure-does-not-need); report A7 and
  "Out of scope".
- **Behavior impact:** Preserving (nothing changes).
- **Rejected alternatives:**
  - Do A7 in a separate commit on this branch — rejected because it changes what `GET`/`PUT /api/documents` accepts,
    which the owner has not approved.
- **Revisit criterion:** The owner asks for any of them.
- **Dissent (if any):** software-architect A7 recommended unifying path confinement right after the restructure.
  Deferred to the owner.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Cut for Scope

### D-21: A component is a module plus the helpers only it imports

- **Question:** What exactly counts as one component when placing files?
- **Decision:**
  - A component is one module, plus the helpers that only it imports, plus its tests and CSS.
  - A Hono `*.routes.ts` file is its domain module's HTTP adapter, so it belongs to that module's component.
  - `app-skills.macro.ts` is a build-time helper that only `workspace-config.ts` imports, so it belongs to that
    component.
  - A `components/` folder means "shared by siblings", not "React components". It may hold non-UI code and test-only
    helpers.
- **Rationale:** The junior-developer review (JD-001) showed that without a definition, `workspace-config/` could read
  as two components and its placement could not be derived from the rules. The definition makes every placement in the
  tree follow from the rules. JD-002 showed that `components/` could be misread as React components only, so the
  README says what it means.
- **Evidence:** review-round.md JD-001, JD-002; C-12; D-14.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - A component is one basename group — rejected because it would split `events.ts` from `events.routes.ts` and the
    macro from its only importer.
  - Name the shared folders `shared/` inside packages — rejected because the owner named them `components`.
- **Revisit criterion:** A helper gains a second importer. It then moves to the lowest `components/` covering both.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-5, S-6
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-22: HTTP route shapes are not moved into shared

- **Question:** Does "anything shared between packages" include the HTTP request and response shapes the UI relies on
  (`{ id }` from `POST /api/sessions`, `{ documents }`, `{ content }`)?
- **Decision:** No. This change moves existing shared code. It does not add new typed contracts. The shapes stay where
  they are today: implicit in the route handlers and the `api<T = any>` callers.
- **Rationale:**
  - Typing these shapes would be new code, and it would change what the UI checks at compile time.
  - No incident shows the shapes drifting apart, so a new contract module fails the YAGNI evidence test.
  - The owner's rule is met for all code that is shared today.
- **Evidence:** review-round.md JD-004; `src/ui/app.tsx:21`, `src/ui/documents.tsx:54,75`.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Add `shared/routes.ts` with request and response types — rejected under YAGNI.
- **Revisit criterion:** A server/UI shape mismatch ships, or `api()` gets a typed wrapper for another reason.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Deferred (YAGNI)

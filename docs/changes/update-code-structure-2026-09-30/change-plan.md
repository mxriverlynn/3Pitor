# Change Plan: Update the Code Structure

## Why This Change

The owner wants `src/` organized by package, then by feature, then by component, with shared code at the lowest scope
that covers everyone who uses it ([scope-boundary.md](artifacts/scope-boundary.md)). The reason is a **deliberate
improvement**, and the specific gaps come from **a finding already established**: the
[architectural analysis](artifacts/architectural-analysis.md) run at the start of this change set.

That analysis found the tree already follows the rules almost everywhere. Two spots do not.

## What Changes, In One Paragraph

After this change, every chat component folder in the server holds only its own code: the fake `claude` that three
chat components' tests share moves to `server/chat/components/`, next to the test model they already share. And the
chat components and the composition root get the `ClaudeMode` type from the shared package, where it is defined,
instead of through the command-line parser. Nothing a user, a test, or the build can observe changes.

## Current State

- **A shared test helper sits inside one component.** `fake-claude-on-path.ts` and `fake-claude.ts` live in
  `chat/claude-cli/`, but the tests of `sessions`, `claude-backend`, and `claude-cli` all import the helper
  ([C-1](artifacts/current-state-findings.md#c-1-a-test-helper-pair-lives-inside-one-chat-component-but-serves-three)).
  The helper copies the fake from its own folder, so the two must stay together
  ([C-2](artifacts/current-state-findings.md#c-2-the-helper-finds-its-fake-by-its-own-folder-so-the-pair-must-stay-together)).
- **A shared type is reached through an entry-point module.** `ClaudeMode` is defined in `shared/wire.ts`, but
  `agent-host.ts`, `chat/agent/agent.ts`, and `chat/claude-backend/claude-backend.ts` import it from
  `command-line.ts`, which only re-exports it
  ([C-3](artifacts/current-state-findings.md#c-3-claudemode-is-defined-in-shared-but-reached-through-the-command-line-parser)).
- **Some files must not move at all.** Several are named by string paths that `make test` never checks
  ([C-4](artifacts/current-state-findings.md#c-4-several-files-are-addressed-by-string-paths-that-make-test-never-checks)),
  and some modules must keep a single definition
  ([C-5](artifacts/current-state-findings.md#c-5-module-singletons-must-keep-one-definition-each)).

## Target State

- **`server/chat/components/`** holds the code shared by chat components' tests: `test-model.ts` (unchanged),
  `fake-claude-on-path.ts`, and `fake-claude.ts`. The last two are siblings, because the helper's contract with the
  fake is "the fake sits in my folder": `copyFile(join(import.meta.dir, 'fake-claude.ts'), ...)`.
- **`server/chat/claude-cli/`** holds only CLI mode's model: `claude-cli.ts`, `stream-json.ts`, `mcp-endpoint.ts`, and
  their tests.
- **`command-line.ts`** turns the command line into a folder and a `ClaudeMode`. It still uses the type in its own
  signature, but no longer exports it.
- **`shared/wire.ts`** remains the one place `ClaudeMode` is defined, and every server file imports it from there.

No new module, type, or abstraction is added.

## Surface Delta

### S-1: `fake-claude-on-path.ts` and `fake-claude.ts` — Moved

**Target state.** Both files live in `src/server/chat/components/`, side by side. `sessions.test.ts`,
`claude-backend.test.ts`, and `claude-cli.test.ts` import the helper as `'../components/fake-claude-on-path'`. The
files' contents are unchanged.

**Behavior.** Preserving. Only test-support files move. The helper still finds the fake in its own folder, and the
three test files that spawn the fake still pass.

**Why.** Three chat components use the helper, so `chat/components/` is the lowest scope that covers them all
([C-1](artifacts/current-state-findings.md#c-1-a-test-helper-pair-lives-inside-one-chat-component-but-serves-three)).

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-move-the-fake-claude-pair-to-serverchatcomponents)

### S-2: `ClaudeMode` imports in `agent-host.ts`, `chat/agent/agent.ts`, `chat/claude-backend/claude-backend.ts` — Re-scoped

**Target state.** The three files import `ClaudeMode` with `import type { ClaudeMode } from` the shared package's
`wire` module (`'../shared/wire'` from `agent-host.ts`, `'../../../shared/wire'` from the two chat files).

**Behavior.** Preserving. The imports are type-only and erased at build time, and the type is the same one.

**Why.** Feature components should not depend upward on the command-line parser for a type that lives in shared
([C-3](artifacts/current-state-findings.md#c-3-claudemode-is-defined-in-shared-but-reached-through-the-command-line-parser)).

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-import-claudemode-from-sharedwire)

### S-3: `export type { ClaudeMode }` in `command-line.ts` — Removed

**Target state.** `command-line.ts` imports `ClaudeMode` from `shared/wire` for its own use and exports nothing named
`ClaudeMode`. `shared/wire.ts` is the only module that exports it.

**Behavior.** Preserving. The export is type-only, and after S-2 nothing imports it.

**Why.** Leaving the re-export keeps a second path to the type that a future file could use again.

**Depends on.** S-2.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-remove-the-claudemode-re-export-from-command-linets)

## Behavior Changes

Every delta entry is behavior-preserving. Nothing a user, a caller, or the build observes changes.

## Change Units

### Unit 1: Move the fake-claude pair to `chat/components/` (`refactor`)

**What it does.** Moves `fake-claude-on-path.ts` and `fake-claude.ts` together with `git mv`, updates the three test
imports, and moves the README's `fake-claude.ts` sentence from the `claude-cli/` bullet to the `chat/components/`
bullet, which then names all three chat components' tests as its users
([D-9](artifacts/change-decision-log.md#d-9-update-the-readme-in-the-unit-that-moves-the-files)).

**Delta entries.** S-1.

**Ordering constraint.** None. It depends on no earlier unit.

**How you know it worked** ([D-11](artifacts/change-decision-log.md#d-11-tighten-each-units-checks)):

- `make test` passes: the type-check, then 230 server and 241 UI tests.
- The list of test files `bun test` runs is the same as before the unit, so no test file silently dropped out.
- The tests that spawn the fake still pass: the "a turn through the claude program" tests in `sessions.test.ts`, "the
  CLI backend runs claude for chat..." in `claude-backend.test.ts`, and the spawning tests in `claude-cli.test.ts`. The
  helper runs in `beforeAll`, so a fake left behind fails each whole file.
- `grep -rn "fake-claude" src README.md Makefile package.json` names only the two moved files, their three importers,
  and the README's `chat/components/` bullet.

File mode needs no care: both files are `100644`, and the helper `chmod`s its copy of the fake to `0o755`.

### Unit 2: Import `ClaudeMode` from `shared/wire` and drop the re-export (`refactor`)

**What it does.** Points the three server imports at `shared/wire`, then deletes `export type { ClaudeMode };` from
`command-line.ts`.

**Delta entries.** S-2, S-3.

**Ordering constraint.** None on Unit 1. Within the unit, S-2 lands before S-3, because removing the export first
would break the three imports. Both sit in one unit so the codebase is never left in between.

**How you know it worked:**

- `make test` passes with the baseline counts. Its type-check is the real gate here, because `bun test` erases
  type-only imports and would pass even with a broken one.
- `grep -rn "ClaudeMode.*command-line'" src` returns nothing.
- `command-line.test.ts` still passes, which pins the parsed `ClaudeMode` value.

### Final check, after the last unit

`make check-build` compiles the binary, starts it from an empty folder, and checks that it serves the app's skills
([D-10](artifacts/change-decision-log.md#d-10-run-make-check-build-once-after-the-last-unit-with-no-separate-server-start)).
It is the only check that runs `server.ts` and the embedded skills, which `make test` never does.

Neither unit is `tdd`. Both move or re-point existing code, and add no behavior for a test to drive.

## Risks

- **A string-addressed file moves by accident** (C-4, report R1). Neither unit touches `paths.ts`, `server.ts`,
  `scripts/check.ts`, `ui/index.html`, `app.tsx`, `styles.css`, `ui/test-setup.ts`, `src/skills`, or `src/fixtures`
  ([D-8](artifacts/change-decision-log.md#d-8-pin-every-string-addressed-file-and-every-module-singleton)). The
  final check still runs `make check-build`, because `make test` cannot catch this.
- **The fake is split from its helper** (C-2). Unit 1 moves both files in one `git mv` step. If only one moved, the
  `claude-cli` tests fail loudly, because the helper cannot find the fake.
- **A stale `mock.module` string** (C-6). Neither unit touches `documents.test.tsx`, the only file with one.
- **Blast radius.** Unit 1 touches five test-support files in one feature. Unit 2 touches four server files, and the
  changes are type-only.

## Deferred (YAGNI)

- **A `ui/view-state/` feature extracted from `documents.tsx`** (report S6). Trigger: a second UI reader or writer of
  view state outside `documents` and `app.tsx`.
- **A `raw-view/` component folder, or other splits of `markdown-editor.tsx`** (report S4, C-5). Trigger: `raw-view` or
  `raw-formatting` gains an importer outside `markdown-editor`.
- **A types module for `Ask` and `SelectionAsk`,** to break the type-only cycle between `raw-view.tsx` and
  `markdown-editor.tsx` (report S4). Trigger: the cycle causes a type or bundler error, or a third module needs the
  types without the editor.
- **Moving `postName` to `server/components/`** (report S2). Trigger: a second production importer outside chat.
- **Moving `workspace-config` under `chat`** (report S3). Trigger: prior D-14's criterion. It keeps its own routes today.
- **Route and stream-part name constants in `src/shared`** (report S9, B8). Trigger: prior D-22's criterion, a
  server/UI mismatch that ships.

## Cut for Scope

These change behavior, and the boundary excludes behavior changes
([scope-boundary.md](artifacts/scope-boundary.md#stated-exclusions)). They are the analysis report's follow-ups:

- **F1:** Serialize the per-turn `TurnTexts` changes in the file tools, so parallel edits can't lose one another.
- **F2:** Give document writes, creates, and moves the ordered, no-clobber guarantees that `json-file.ts` gives state
  files.
- **F3:** Have the file tools honor `abortSignal`, so Stop halts tool work in flight.
- **F4:** Isolate EventBus listeners from each other, and scope events per session.
- **F5:** Validate stored `view.json` on read, and keep an older view-state PUT from overwriting a newer one.
- **F6:** Type the untyped API responses, and share the stream-part names.
- **F7:** Add `make check-build` to `make test` or CI, and make a missing `src/skills` fail the build.

## Open Items

None.

## Review Findings

One review round, at small size: `junior-developer` and `test-engineer`. Nothing blocked the plan. Their findings
changed it in three places:

- **The README described the old layout after Unit 1** (junior-developer JD-001, test-engineer gap 1). Unit 1 now moves
  the README sentence ([D-9](artifacts/change-decision-log.md#d-9-update-the-readme-in-the-unit-that-moves-the-files)).
- **No unit owned the build check** (JD-002, test-engineer gap 5). It now runs once after the last unit, and the
  separate server start is dropped, because `make check-build` already starts the binary
  ([D-10](artifacts/change-decision-log.md#d-10-run-make-check-build-once-after-the-last-unit-with-no-separate-server-start)).
- **Some checks were too weak** (JD-003, test-engineer gaps 2 and 3). The greps are corrected, and Unit 1 compares the
  list of test files as well as the counts
  ([D-11](artifacts/change-decision-log.md#d-11-tighten-each-units-checks)).

Confirmed as not gaps: no test uses `skip`, `skipIf`, or `todo`, so a skipped CLI test can't hide a broken move. Both
moved files are `100644`, and the helper `chmod`s its copy. The import depths in S-2 are correct. The junior
developer's suggested `devops-engineer` handoff was not taken, because the test engineer's review answered the same
question: `make check-build` already covers the build and a server start.

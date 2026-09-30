# Change Decision Log: Update the Code Structure

Every decision made in this change set, numbered in the order it was made. The owner was away, so each decision was
made from evidence and is recorded here with its reasoning. Numbers are never reused. Precedent decisions from
[restructure-by-feature](../../restructure-by-feature/artifacts/change-decision-log.md) are cited as "prior D-N".

### D-1: Work on a new branch and open a draft PR, overriding the skill's default

- **Question:** The `update-code-structure` skill commits to the current branch and never creates branches, pushes, or
  opens PRs. The owner started this run with "on a new branch, and open a draft PR when you're done". Which applies?
- **Decision:** Create `update-code-structure-2026-09-30` from `main` at `1a67393`, commit each step there, push, and
  open a draft PR at the end.
- **Rationale:** The skill's rule exists "BECAUSE the owner decides where this work lands and who sees it". Here the
  owner decided, explicitly, when starting the run.
- **Alternatives rejected:** Committing to `main` (the skill's default) contradicts the owner's direct instruction.

### D-2: Run the architectural analysis at medium size with five agents

- **Question:** What size and roster should `/architectural-analysis` use on `src/`?
- **Decision:** Medium: structural, behavioral, concurrency, risk, and software-architect.
- **Rationale:**
  - The concern is file placement and move safety, not a security, data, or ops review.
  - `src/` is three adjacent packages with async code, which calls for the concurrency analyst.
  - The prior restructure's analysis ran at medium with the same roster (restructure-by-feature change log, entry 1).
- **Alternatives rejected:**
  - Large, as the file count (about 100 files) alone would suggest. It would add the security and on-call analysts,
    whose findings would all be behavior changes that this pure restructure defers anyway.
  - Small. It would drop the calibration to high-impact findings only, and could miss medium move hazards such as the
    `mock.module` strings (R2).

### D-3: Write the analysis report's summary to the readability standard directly, without a separate editor pass

- **Question:** `/architectural-analysis` ends with a readability-editor rewrite of its synthesized prose. Should this
  unattended run dispatch it?
- **Decision:** No. The Executive Summary and the "How to Read" frame were written to the standard (main point first,
  short sentences, one idea per bullet). The verbatim agent sections are untouched either way.
- **Rationale:** The report is an internal artifact of this change set, and the prose the editor would rewrite is about
  40 lines. A separate agent pass adds a round trip, and a context hand-off, to an unattended run for little gain.
- **Alternatives rejected:** Dispatching the editor. This is cheap to reverse: run `/edit-for-readability` on the report
  later.

### D-4: Take the scope boundary as recorded, without a confirmation turn

- **Question:** `/plan-a-change` takes one confirmation turn to check the boundary with the owner before discovery. The
  owner is away. Proceed without it?
- **Decision:** Yes. The boundary is the owner's own request, recorded verbatim in
  [scope-boundary.md](scope-boundary.md), plus the skill's standing "no behavior changes" rule.
- **Rationale:** The owner asked for an unattended run. The request itself names the area (`src/`, both packages) and
  the rules, so there is nothing for the turn to confirm that the request doesn't already say.
- **Alternatives rejected:** Stopping to ask would stall the run until the owner returns, which is what they asked
  this run not to do.
- **Referenced in plan:** Why This Change.

### D-5: Move the fake-claude pair to `server/chat/components/`

- **Question:** Where do `fake-claude-on-path.ts` and `fake-claude.ts` belong?
- **Decision:** `src/server/chat/components/`, side by side, moved together in one unit.
- **Rationale:**
  - The helper has three importers in three chat components
    ([C-1](current-state-findings.md#c-1-a-test-helper-pair-lives-inside-one-chat-component-but-serves-three)), so
    `chat/components/` is the lowest scope that covers them all.
  - It follows prior D-7, which put `test-model.ts` there for the same reason, and prior D-21's criterion ("a helper
    gains a second importer").
  - The helper finds the fake in its own folder
    ([C-2](current-state-findings.md#c-2-the-helper-finds-its-fake-by-its-own-folder-so-the-pair-must-stay-together)),
    so the two cannot be separated.
- **Alternatives rejected:**
  - `server/components/`: too wide. No test outside `chat` uses it.
  - Leaving it in `claude-cli/`: two sibling components would still reach into another component's folder (report S1).
  - Moving only the helper and pointing it at the fake with `'../claude-cli/fake-claude.ts'`: adds a path string that
    tsc can't check, to keep a file where it doesn't belong.
- **Settles delta entry:** S-1.
- **Referenced in plan:** Surface Delta, Change Units.

### D-6: Import `ClaudeMode` from `shared/wire`

- **Question:** Where should server files get the `ClaudeMode` type from?
- **Decision:** From `shared/wire.ts`, where it is defined, in `agent-host.ts`, `chat/agent/agent.ts`, and
  `chat/claude-backend/claude-backend.ts`.
- **Rationale:** The owner's rule puts code shared by both packages in `src/shared/`, and that is where the type lives
  ([C-3](current-state-findings.md#c-3-claudemode-is-defined-in-shared-but-reached-through-the-command-line-parser)).
  Chat components then depend on shared, not upward on the command-line parser (report S3, B5).
- **Alternatives rejected:** Keeping the imports through `command-line.ts`. It works, but makes a feature depend on an
  entry-point helper only to reach a shared type.
- **Settles delta entry:** S-2.
- **Dependent decisions:** D-7.
- **Referenced in plan:** Surface Delta, Change Units.

### D-7: Remove the `ClaudeMode` re-export from `command-line.ts`

- **Question:** Once nothing imports `ClaudeMode` from `command-line.ts`, should the re-export stay?
- **Decision:** Remove it, in the same unit as D-6, after the imports move.
- **Rationale:** A leftover export is a second path to the type that a future file could pick up again. After D-6 it
  has no importer, and it is type-only, so removing it changes nothing at runtime.
- **Alternatives rejected:** Keeping it "for compatibility". There are no importers outside the repo.
- **Settles delta entry:** S-3.
- **Referenced in plan:** Surface Delta, Change Units.

### D-8: Pin every string-addressed file and every module singleton

- **Question:** Beyond the two moves, may this change move anything the analysis flagged as hazardous?
- **Decision:** No. `paths.ts`, `server.ts`, `scripts/check.ts`, `agent-host.ts`, `ui/index.html`, `app.tsx`,
  `styles.css`, `ui/test-setup.ts`, `src/skills`, `src/fixtures`, `system-prompt.md` (away from `agent.ts`), and
  `app-skills.macro.ts` (away from `workspace-config.ts`) stay put. `json-file.ts`, `markdown-editor.tsx`, and
  `shared/markdown.ts` are neither split nor copied. The final check runs `make check-build` and a server start in
  addition to `make test`.
- **Rationale:** These are the report's R1 (High) and R3 hazards
  ([C-4](current-state-findings.md#c-4-several-files-are-addressed-by-string-paths-that-make-test-never-checks),
  [C-5](current-state-findings.md#c-5-module-singletons-must-keep-one-definition-each)), and all their current
  placements already follow the owner's rules (report S5, S7, S8, A3, A4).
- **Alternatives rejected:** Relying on `make test` alone. It runs neither the server nor the compiled binary (report
  B2).
- **Referenced in plan:** Risks.

### D-9: Update the README in the unit that moves the files

- **Question:** The README says `fake-claude.ts` lives in `claude-cli/`, and that `chat/components/` is shared by the
  `sessions` and `agent` tests only. Where does that change?
- **Decision:** In Unit 1, in the same commit as the move.
- **Rationale:** The README is the only record of the layout rules (current-state-findings, Gaps). Changing it with the
  move keeps every commit's tree and README in agreement. Raised by junior-developer JD-001 and test-engineer gap 1.
- **Alternatives rejected:** Leaving it to the skill's final README rewrite. That would leave one commit whose README
  describes a layout the code no longer has.
- **Referenced in plan:** Change Units, Review Findings.

### D-10: Run `make check-build` once after the last unit, with no separate server start

- **Question:** Which step runs the build check and the server start that D-8 calls for?
- **Decision:** `make check-build` runs once, after Unit 2. There is no separate server start.
- **Rationale:** `make check-build` compiles the binary, starts it from an empty folder, and fetches its workspace
  config (`Makefile`, `check-build` target). That covers both the build and a server start. Neither unit touches a
  string-addressed file, so running it after every unit adds time without adding coverage. Raised by junior-developer
  JD-002 and test-engineer gap 5.
- **Alternatives rejected:** Running it after each unit. Starting the server by hand as well, which duplicates what
  `check-build` does.
- **Referenced in plan:** Change Units, Risks, Review Findings.

### D-11: Tighten each unit's checks

- **Question:** Are the plan's greps and count checks strong enough?
- **Decision:**
  - Unit 1 compares the list of test files `bun test` runs before and after, as well as the counts.
  - Unit 1 greps for `fake-claude` across `src`, `README.md`, `Makefile`, and `package.json`.
  - Unit 2 greps for `ClaudeMode.*command-line'`, which returns nothing once the imports move.
- **Rationale:** Unit 2's old grep matched `command-line.ts` itself (JD-003). Equal counts can hide a dropped test file
  (test-engineer gap 3). Unit 1's grep missed the README and the build files (test-engineer gap 2).
- **Alternatives rejected:** Relying on tsc alone. It catches the imports but not the README or the list of test files.
- **Referenced in plan:** Change Units, Review Findings.

### D-12: Write the change plan to the readability standard directly, without a separate editor pass

- **Question:** `/plan-a-change` ends with a readability-editor rewrite of the plan. Should this unattended run
  dispatch it?
- **Decision:** No, for the same reason as D-3. The plan was drafted to the standard, and both reviewers read it
  without raising a clarity finding.
- **Rationale:** The plan is short, and an in-place rewrite risks breaking the section headings the decision log cites
  in `Referenced in plan:`.
- **Alternatives rejected:** Dispatching the editor. Cheap to do later with `/edit-for-readability`.
- **Referenced in plan:** none.

### D-13: Correct the README's list of `test-model.ts` users while rewriting that bullet

- **Question:** The README said `test-model.ts` is shared by the `sessions` and `agent` tests, but
  `claude-backend.test.ts` imports it too. Unit 1 rewrites that bullet. Fix the list?
- **Decision:** Yes. The `chat/components/` bullet now names the users of each of its three files as the code has them.
- **Rationale:** D-9 puts README changes in the unit that makes them true. The bullet is being rewritten anyway, and a
  layout record that names the wrong users is how a shared file ends up scoped wrong later. It is documentation only.
- **Alternatives rejected:** Leaving the stale list, which would carry a known error into a freshly rewritten line.
- **Referenced in plan:** none (found while carrying out Unit 1).

### D-14: In `agent.ts`, add `ClaudeMode` to the existing `shared/wire` import

- **Question:** `chat/agent/agent.ts` already has `import type { HostEvent, TurnProgress } from '../../../shared/wire'`.
  Should `ClaudeMode` get its own import line from the same module?
- **Decision:** No. It joins the existing line, which becomes `import type { ClaudeMode, HostEvent, TurnProgress }`.
- **Rationale:** Every file in `src/` imports each module once, and the names in these type imports are sorted. Two
  lines from one module would be the only such case.
- **Alternatives rejected:** A second import line from `shared/wire`, which matches the plan's sketch literally but not
  the code around it.
- **Referenced in plan:** none (found while carrying out Unit 2).

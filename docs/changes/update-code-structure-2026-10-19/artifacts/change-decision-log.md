# Change Decision Log: Update the Code Structure (2026-10-19)

Decisions are numbered in the order they were made and are never renumbered.

### D-1: Work on a new branch, push each commit, and open a draft PR

- **Question:** The skill commits to the current branch only and never pushes or opens a PR. The owner asked, after
  the run started, to "create a branch for this, commit and push as you go, open draft pr when you're done".
- **Decision:** Create `update-code-structure-2026-10-19` from `main` at `cb9478c`, push after each commit, and open a
  draft PR at the end.
- **Rationale:** The owner's direct instruction for this run overrides the skill's default. The 2026-10-01 run did the
  same (its D-1).
- **Alternatives rejected:** Committing to `main` as the skill's default says, because the owner said otherwise.

### D-2: Run the architectural analysis at medium size with five agents

- **Question:** Which size and roster the analysis should use, with no owner to ask.
- **Decision:** Medium: structural, behavioral, and concurrency analysts, then the risk analyst and software architect.
- **Rationale:** The focus is all eight packages, but the concern is move safety, not a security, data, or ops review.
  A pure restructure would defer those findings anyway. The concurrency signal is clear: per-key write queues in
  `file-system/local/` and `engine/components/json-file.ts`, the post store's watch, and chat turns. The 2026-10-01 run
  made the same call (its D-2).
- **Alternatives rejected:** Large, which would add security, on-call, and a codebase map whose findings this run
  could not act on. Small, which drops the concurrency analyst, the one agent that checks for module-level state a
  move could split.

### D-3: Skip the separate readability-editor pass on the analysis report

- **Question:** The analysis skill dispatches a readability editor over the report's synthesized prose. Run it?
- **Decision:** No. The summary, the "How to Read" frame, and the section prefaces were written to the readability
  standard directly. Every other section is verbatim agent output that the editor may not touch.
- **Rationale:** The synthesized prose is a few hundred words, and the 2026-10-01 run made the same call (its D-3).
  The report is an input to this skill, not its result.
- **Alternatives rejected:** Running the editor, which would add an agent round for a short prose region.

### D-4: Take the scope boundary as recorded, without a confirmation turn

- **Question:** The planning skill takes one confirmation turn on the boundary before discovery. Take it?
- **Decision:** No. The boundary is the owner's rule set, recorded word for word in
  [scope-boundary.md](scope-boundary.md).
- **Rationale:** The owner is away and asked for an unattended run. The boundary is the owner's own text, so there is
  nothing to confirm. The 2026-10-01 run made the same call (its D-4).
- **Alternatives rejected:** Waiting for a confirmation that nobody can give, which would stop the run.
- **Referenced in plan:** Why This Change

### D-5: Reuse the analysis as the current state and its A1–A9 as the target proposal

- **Question:** Should the plan run its own discovery round and a second software-architect pass?
- **Decision:** No. The current state is extracted from the analysis into
  [current-state-findings.md](current-state-findings.md), re-checked with grep at `384dd22`. The analysis's A1–A9 are
  the target proposal, which this plan accepts, amends (D-12), or settles (D-7 to D-14).
- **Rationale:** The analysis ran hours before, on the same commit, and its architect already gave exact old → new
  paths and specifier edits. The planning skill's own rule is not to re-run analysis a prior report performed.
- **Alternatives rejected:** A fresh discovery and architect round, which would repeat the same reads.
- **Referenced in plan:** Current State, Target State

### D-6: Size the plan medium, with junior-developer and test-engineer for one review round

- **Question:** What size, and which reviewers?
- **Decision:** Medium, because the change touches four packages (engine, posts, shared, ui). Reviewers:
  `han-core:junior-developer` (always) and `han-core:test-engineer`. One round, below the medium cap of two.
- **Rationale:** Every entry preserves behavior and there are no consumers outside the repo, so the only claim that
  needs a specialist is "the tests prove nothing changed". That is the test-engineer's domain. The risk analyst
  already scored these findings in the analysis.
- **Alternatives rejected:** Small, because more than one package is touched. A second reviewer such as the
  risk-analyst, whose work this run already has.
- **Referenced in plan:** Review Findings

### D-7: Flatten post-table into documents/documents and model-picker into chat/agent-panel

- **Question:** post-table and model-picker are React components with their own CSS and tests, each with exactly one
  importer. Do they keep their own folders, or sit flat beside their one user?
- **Decision:** Flatten both: `documents/post-table/*` → `documents/documents/post-table.*` and
  `chat/model-picker/*` → `chat/agent-panel/model-picker.*`.
- **Rationale:** The 2026-10-01 D-5 settled this reading. A React component that only one component uses is that
  component's helper, and sits flat in its folder (link-popup in `markdown-editor/`). The editor's folder already holds
  four such components with their own CSS or tests (image-popup, link-popup, review-strip, raw-view). The owner's rule
  says a component folder holds "the helpers only it uses", which places a file by who imports it, not by whether it
  has CSS. Both moves stay at the same depth, so the moved files' own imports do not change (C-3).
- **Alternatives rejected:**
  - Keep both folders, which the README describes for model-picker. That leaves two readings of "component" in one
    package, and contradicts D-5 of the last run.
  - Flatten only post-table. model-picker's churn is mostly its own (10 commits, none with agent-panel), but the rule
    places by importer, not by co-change.
  - The trigger for giving either a folder again: a second importer.
- **Referenced in plan:** Target State, Surface Delta

### D-8: Move shortcut to documents/components and post-dialogs to documents/components/post-dialogs

- **Question:** Where do shortcut and post-dialogs go?
- **Decision:** `ui/components/shortcut.{ts,test.ts}` → `ui/documents/components/shortcut.{ts,test.ts}`, flat.
  `documents/post-dialogs/*` → `documents/components/post-dialogs/*`, in its own folder.
- **Rationale:** Both are shared by two components of the documents feature (C-2, C-3), so `<feature>/components/` is
  the lowest scope that covers their users. After D-7, post-dialogs' users are post-panel and the documents component.
  The folder pattern follows the 2026-10-01 D-6: a shared module with CSS gets a folder (`menu/`, `confirm-dialog/`),
  and one without sits flat (`api.ts`).
- **Alternatives rejected:** Leaving shortcut in `ui/components/`, which is scoped above every user. Putting
  post-dialogs flat in `documents/components/`, against the CSS-folder pattern.
- **Referenced in plan:** Target State, Surface Delta

### D-9: Move bun-only-code to src/shared

- **Question:** `posts/bun-free.test.ts` imports `engine/components/bun-only-code`, a test import against the
  dependency direction (C-5). Where should the module live?
- **Decision:** `src/engine/components/bun-only-code.ts` → `src/shared/bun-only-code.ts`. Drop its EXEMPT entry from
  `engine/bun-free.test.ts`, and point both bun-free tests at `'../shared/bun-only-code'`.
- **Rationale:** The module has no imports, so it meets "`src/shared/` imports no package". It is shared by two
  packages, and `src/shared/` is the only scope that covers two packages. The posts package may import `src/shared/`
  (`posts/boundary.test.ts:70`). No production module imports it, so the bundle and `make check-node` are unaffected.
  Every other home breaks a check: in `posts/components/`, the engine's bun-free test would trip the posts
  deep-import scan, which covers tests (`src/posts/boundary.test.ts:135-139`), and in the engine the posts test keeps
  its wrong-way import. This is a reading of "`src/shared/` is used by both the browser and Bun code": the module has
  no browser user. Unit 1 widens the README's `src/shared/` sentence to say that it also holds test-only code shared by
  Bun-side packages. The owner should review this decision first.
- **Alternatives rejected:**
  - Let the README allow posts tests to import the engine. That bends the rule to fit the violation.
  - A copy in each package, which duplicates the one definition of Bun-only code that both scans must agree on.
  - Reading "shared by the browser and Bun code" strictly, so that a module used only by Bun-side packages has no
    home. Every other placement is worse against the one-way rule.
  - `posts/components/`, which fails the posts deep-import scan from the engine's test.
- **Referenced in plan:** Target State, Surface Delta

### D-10: Move test-model and stub-tool-server up to engine/components

- **Question:** Where do the two engine test helpers go, now that tests outside chat use them (C-4)?
- **Decision:** Both move to `src/engine/components/`. `stub-tool-server.ts`'s type import becomes
  `'../chat/claude-cli/claude-cli'`. The bun-free EXEMPT entries become `'components/test-model.ts'` and
  `'components/stub-tool-server.ts'`. chat-test-helpers and the fake-claude pair stay in `chat/components/`.
- **Rationale:** `engine.test.ts` sits at the engine root and `model-config` is another feature, so
  `<package>/components/` is the lowest covering scope. A type-only import from a test helper into a feature carries
  no runtime edge. The fake-claude pair must stay side by side, and `node-check.ts:27` names it by string (report B9,
  R2). On the engine side only chat uses chat-test-helpers.
- **Alternatives rejected:** Leaving them in `chat/components/`, which breaks the scope rule for two importers.
- **Referenced in plan:** Target State, Surface Delta

### D-11: Move entry-name into posts/file

- **Question:** `posts/file/` or `posts/components/`?
- **Decision:** `src/shared/entry-name.{ts,test.ts}` → `src/posts/file/entry-name.{ts,test.ts}`.
- **Rationale:** Its one user is the file store (C-1), so the store's own folder is the lowest scope. There is one
  store today, so `posts/components/` would have one user. Leave the sample string at `posts/boundary.test.ts:125`
  alone. It shows the allowed import shape to the checker and is not an import.
- **Alternatives rejected:** `posts/components/`, which fails YAGNI. Trigger: a second `PostStore`.
- **Referenced in plan:** Target State, Surface Delta, Deferred (YAGNI)

### D-12: Leave server/scripts/check.ts where it is

- **Question:** The analysis's A7 recommends moving the check to `server/check.ts`, because `scripts/` is not a
  feature. Move it?
- **Decision:** No. It stays at `src/server/scripts/check.ts`.
- **Rationale:** Two earlier change sets decided this on purpose: restructure-by-feature D-5 ("dev tooling, not a
  feature, and `package.json`'s `check` script names it by path") and update-code-structure-2026-09-30 D-8. Nothing
  in the code has changed since in a way that breaks that precedent. `make test` never runs the check (C-7), so a
  stale `package.json` path would ship silently. The risk analyst also ranked it "leave in place" (R5).
- **Alternatives rejected:** A7's move, which buys a tidier tree for a path that no test covers. Departing from two
  precedents needs a change in the code, and none has happened.
- **Referenced in plan:** Target State, Cut for Scope

### D-13: Leave panel-resizer, node-check, chat-test-helpers, the fake-claude pair, and the providers' helpers in place

- **Question:** Do any of the other files the analysis looked at move?
- **Decision:** No (the analysis's A9).
- **Rationale:** `panel-resizer`'s only user is `app.tsx`, the package entry, and it sizes panels for two features, so
  `ui/components/` covers it. `node-check.ts` is a package-wide check like `bun-free.test.ts`, and the Makefile names
  it. The fake-claude pair and chat-test-helpers are used only by chat on the engine side. The provider backends and
  their helpers are used only inside `providers/`. `local-file-system.ts` and `markdown-editor.tsx` are not split
  (C-10).
- **Alternatives rejected:** Moving any of these, which would add churn for no rule the tree breaks today.
- **Referenced in plan:** Target State

### D-14: Name the engine modules the server's tests may import in the README, and move none of them

- **Question:** Server tests deep-import five engine modules (C-6). Re-export them, move them, or name them?
- **Decision:** Name them in the README's `src/engine/` section as the engine's test-facing surface, which only tests
  may import: `chat/components/chat-test-helpers.ts`, `chat/components/fake-claude-on-path.ts`,
  `components/json-file.ts`, `chat/claude-cli/claude-cli.ts`, and `chat/tools/tools.ts`. This lands in Step 6's README
  rewrite.
- **Rationale:** The owner's rule allows "any other modules the README names as part of that package's public
  surface". Re-exporting the test helpers from `engine.ts` would pull `bun:test` into engine production and fail
  `bun-free.test.ts`. Re-exporting the rest would widen the production API for test-only use.
- **Alternatives rejected:** Re-exports, for the reasons above. Moving them, which breaks the server tests (R2) and
  the fake-claude pair (B9).
- **Referenced in plan:** Surface Delta, Change Units

### D-15: Make three refactor units, one per package touched, with each unit's README lines in that unit

- **Question:** How are the moves split into units?
- **Decision:** Unit 1 is the engine and shared moves (D-9, D-10). Unit 2 is the posts move (D-11). Unit 3 is the UI
  moves (D-7, D-8). All three are `refactor` units, and none depends on another. Each edits the README lines for its
  own moved files. Step 6 rewrites the rest of the inventory, including D-14.
- **Rationale:** One commit per package lets each be reverted alone. The UI moves stay in one unit, because moving
  post-table first would import a post-dialogs still at the wrong scope. Splitting model-picker out of the UI unit
  gains nothing: it shares the same CSS check. No unit adds code, so none is `tdd`. The 2026-10-01 D-8 set the
  README-in-the-unit pattern.
- **Alternatives rejected:** One unit for everything, which makes a failed UI move roll back the engine moves too.
  Five units, which would split the UI's single CSS check.
- **Referenced in plan:** Change Units

### D-16: Make every unit check a command with an exact expected result

- **Question:** How does an unattended run know a unit worked?
- **Decision:** Each unit runs `make test` and compares the per-suite `Ran N tests across M files` lines with the
  baseline (523/38 and 502/19). It also checks rename similarity with `git diff --cached -M --name-status`, greps for
  every old path, and checks that each emptied folder is gone. The UI unit also diffs `css_snapshot.sh` before and
  after (2026-10-01 D-10) and runs `cross_feature.py`.
- **Rationale:** Report R1 is the one high risk: a moved test that silently stops running. Equal file and test counts
  per suite catch it. Every move stays inside its package root, so no boundary scan goes empty (C-8). The CSS diff is
  the only check that sees cascade order (C-9).
- **Alternatives rejected:** Opening the app by hand, with nobody present to do it.
- **Update after review:** renamed files that are edited carry exact `numstat` counts. The CSS order check has its
  `sed` substitutions written out. README lines carry their own greps, and scratch output sits outside the repository.
- **Referenced in plan:** Change Units, Risks, Review Findings

### D-17: Cut the behavior-changing findings as follow-ups

- **Question:** The analysis's A10–A14 change what tests enforce or how the code behaves. Build any?
- **Decision:** No. Each is listed under Cut for Scope.
- **Rationale:** The boundary excludes behavior changes. A10, empty-scan guards on the boundary tests, is test-only,
  but it changes what the suite enforces. It is not needed here, because no move touches a package root (C-8).
- **Alternatives rejected:** Building A10 first as a `tdd` unit "to make moving safe". Its premise does not hold for
  this plan.
- **Referenced in plan:** Cut for Scope

### D-18: Write the plan to the readability standard directly, without a separate editor pass

- **Question:** Run the readability editor over `change-plan.md`?
- **Decision:** No. The plan follows the 2026-10-01 plan's structure, and is written to the readability standard.
- **Rationale:** The 2026-10-01 run made the same call (its D-12). Most of the plan is paths and commands, which the
  editor may not touch.
- **Alternatives rejected:** An editor pass, which would mainly risk changing the section headings the
  `Referenced in plan:` fields name.
- **Referenced in plan:** (none)

# Decision Log: Update the Code Structure (2026-10-01)

Decisions are numbered in the order they were made and never renumbered.

### D-1: Work on a new branch, push as the run goes, and open a draft PR

- **Question:** The skill commits only to the current branch and never pushes or opens a PR. The owner's arguments
  asked for a branch, commits as the run goes, and a draft PR.
- **Decision:** Create `update-code-structure-2026-10-01` from `main`, push after each commit, and open a draft PR
  after the first commit.
- **Rationale:** The owner's own instruction for this run overrides the skill's default. The previous run
  (`update-code-structure-2026-09-30`, its D-1) did the same.
- **Alternatives rejected:** Committing to `main` as the skill says. The owner asked otherwise.

### D-2: Run the architectural analysis at medium size with five agents

- **Question:** What size and roster should `/architectural-analysis` use on `src/`?
- **Decision:** Medium: structural, behavioral, concurrency, risk, and software-architect. The briefs point the
  analysts at what changed since the previous run, and they reuse its findings where the code is unchanged.
- **Rationale:** The previous run's D-2 chose this size and roster for the same goal on the same tree. The tree has
  grown by six modules and one feature (live file watching) since then, and none of them adds a security, data, or ops
  surface that a pure restructure would act on.
- **Alternatives rejected:**
  - Large, as the file count (112) alone would suggest. It would add analysts whose findings would all be behavior
    changes that this restructure defers anyway.
  - Small. Its calibration reports only high-impact findings, and could miss medium-impact move hazards.

### D-3: Write the analysis summary to the readability standard directly, without a separate editor pass

- **Question:** `/architectural-analysis` ends with a readability-editor rewrite of its synthesized prose. Should this
  unattended run dispatch it?
- **Decision:** No. The summary and the "How to Read" frame are written to the standard directly, and the verbatim
  agent sections are left untouched either way.
- **Rationale:** The previous run's D-3 made the same call: the report is an internal artifact, and the prose the
  editor would rewrite is short.
- **Alternatives rejected:** Dispatching the editor. This is cheap to reverse: run `/edit-for-readability` on the report
  later.

### D-4: Take the scope boundary as recorded, without a confirmation turn

- **Question:** `/plan-a-change` takes one confirmation turn to check the boundary with the owner before discovery. The
  owner is away. Proceed without it?
- **Decision:** Yes. The boundary is the owner's Target layout, recorded word for word in
  [scope-boundary.md](scope-boundary.md).
- **Rationale:** The coordinator skill forbids questions to the owner during this run. The previous run's D-4 made the
  same call.
- **Alternatives rejected:** Pausing for confirmation. Nobody is there to answer, and the run would stall.
- **Referenced in plan:** Why This Change

### D-5: Move link-popup into the markdown-editor component folder, flat beside the editor

- **Question:** Where does `LinkPopup` belong, given that only the markdown editor uses it (C-1)?
- **Decision:** `src/ui/documents/markdown-editor/link-popup.tsx`, with `link-popup.css` and `link-popup.test.tsx`
  beside it. No `link-popup/` subfolder.
- **Rationale:**
  - The owner's rule: "A component folder holds the component's module, the helpers only it uses, and its tests and
    CSS." Only `markdown-editor.tsx` imports `LinkPopup` (C-1).
  - Precedent in the same folder: `raw-view.tsx` is a React component that only the editor renders, and it sits flat in
    `markdown-editor/`.
  - Change history: 2 of link-popup's 4 commits also touched the editor, and none touched the other popups (report A1).
- **Alternatives rejected:**
  - Leave it in `popups/` and accept a documents → popups import as a public API, by analogy to the server precedent
    (report S1 option (a)). It breaks the "helpers only it uses" placement for a module with one user. It also keeps the
    UI's only import between features outside `app.tsx`, the file the README names as the UI's one wiring point.
  - A `markdown-editor/link-popup/` subfolder. No helper in `markdown-editor/` has its own subfolder, and nesting a
    component folder inside a component folder is not a pattern the rules or the tree use.
  - A sibling component folder, `documents/link-popup/` (raised in review). The rule gives a folder to each of a
    feature's components, but places "the helpers only it uses" inside the component that uses them. The precedent is
    `raw-view.tsx`, a React component only the editor renders, which sits flat in `markdown-editor/`. The previous run
    deferred giving it a folder until it gained a second importer (2026-09-30 change plan, Deferred). link-popup has
    the same shape, so it follows the same precedent, under the same trigger.
- **Settles delta entry:** S-2
- **Referenced in plan:** Target State, Surface Delta

### D-6: Move anchored-bubble up to `src/ui/components/anchored-bubble/`

- **Question:** Once link-popup moves, `popups/components/anchored-bubble` has users in two features (documents and
  popups). Where does it belong?
- **Decision:** `src/ui/components/anchored-bubble/anchored-bubble.ts` with `anchored-bubble.css` beside it. The empty
  `popups/components/` folder is removed.
- **Rationale:**
  - The lowest scope covering link-popup (documents), question-popup (popups), and selection-popup (popups) is
    `ui/components/` (C-2).
  - In `ui/components/`, a UI piece with its own CSS gets its own folder (`menu/`, `panel-resizer/`,
    `agent-actions/`). A plain module stays flat, even with a test beside it (`api.ts` and `api.test.ts`,
    `fake-documents-api.ts`). anchored-bubble has its own CSS, so it gets a folder. (The first draft of this decision
    said "multi-file gets a folder", which `api.ts` + `api.test.ts` contradicts. Review corrected it.)
- **Alternatives rejected:**
  - Leave it in `popups/components/` (report S1 option (b) as first written). The editor would then reach into another
    feature's internal `components/` folder, which swaps one cross-feature import for another (report A1).
  - Copy it into each feature. `useAnchoredBubble` holds no module state, but a copy would split one placement rule
    into two, and the rules put shared code in one place.
- **Settles delta entry:** S-1
- **Referenced in plan:** Target State, Surface Delta

### D-7: Do both moves in one refactor unit, and move nothing else

- **Question:** Should the two moves be separate units? Should anything else move?
- **Decision:** One `refactor` unit carries both moves and their README lines. Nothing else moves. The pinned files,
  pairs, and single instances in C-5 stay where they are.
- **Rationale:**
  - Moving anchored-bubble first, alone, would put it at `ui/components/` while every user is still inside `popups`,
    which is scoped too high. Moving link-popup first, alone, leaves the editor reaching into `popups/components/`. In
    both orders the in-between state breaks a rule, so the two moves are one unit (report A1, "smallest safe step").
  - No `tdd` unit is needed. Neither move needs a new path anchor or shared module, because no string specifier
    reaches either file (C-3).
  - The report's S5, A2, and A3 find everything else correctly placed, or deliberately left in place under the
    previous run's precedent.
- **Alternatives rejected:** Two units, one per move. Each in-between commit would break a placement rule.
- **Referenced in plan:** Change Units, Deferred (YAGNI)

### D-8: Update the README's lines for the moved files in the same unit, and leave the full inventory to Step 6

- **Question:** The README is stale in two ways: it places anchored-bubble under popups, and it omits five newer files
  (C-6). When does each get fixed?
- **Decision:** Unit 1 rewrites the README lines for link-popup and anchored-bubble. The coordinator's Step 6 rewrite of
  the layout section adds the five missing files.
- **Rationale:** The previous run's D-9 put the README lines for a move in the same unit as the move, so the README
  never describes a tree that no longer exists. The missing files are not moving, and the coordinator already rewrites
  the whole layout section after the units.
- **Alternatives rejected:** A separate README unit. It would duplicate the coordinator's Step 6.
- **Settles delta entry:** S-3
- **Referenced in plan:** Change Units

### D-9: Size the plan small, with junior-developer and test-engineer for one review round

- **Question:** What size and review team?
- **Decision:** Small: `han-core:junior-developer` plus `han-core:test-engineer`, one round.
- **Rationale:** One package, five files moved, four import edits, and every entry behavior-preserving. The previous
  run's plan used the same team. test-engineer checks that the behavior-preservation claim rests on real tests.
- **Alternatives rejected:** Medium. No entry is behavior-changing, and no module outside `src/ui` is touched.
- **Referenced in plan:** Review Findings

### D-10: Prove the CSS cascade is unchanged by diffing the bundled CSS, not by eye

- **Question:** The report's A1 asks for opening the link bubble by hand to check its styling, because happy-dom cannot
  see the cascade (C-4). The run is unattended. How is that checked?
- **Decision:** Before and after Unit 1, run [css_snapshot.sh](css_snapshot.sh). It bundles the UI with
  `bun build ./src/ui/index.html`, finds the CSS by glob (its name is hashed), and splits it in two. `rules.css` is the
  CSS with only Bun's per-file header lines (`/* src/....css */` and `/* node_modules/....css */`) removed, so real
  comments are still compared. `order.txt` is those headers, in order. After the move, `rules.css` must be identical,
  and `order.txt` must be identical once the two moved paths are rewritten. The JS and `index.html` are not compared,
  because they carry path comments and hashed names that change with any move.
- **Rationale:** The bundle marks each block with its source path, and today `anchored-bubble.css` comes before
  `link-popup.css`, which comes before `markdown-editor.css`. An identical rule sequence after the move proves the
  cascade did not change. That is stronger than looking at one bubble, and it needs nobody present.
- **Alternatives rejected:**
  - A manual browser check. Nobody is present, and it would cover one popup, not the whole cascade.
  - Skipping the check. B3 and R4 name CSS order as the one silent hazard in this move.
- **Referenced in plan:** Change Units, Risks

### D-11: Make every Unit 1 check a command with an exact expected result

- **Question:** Review found three Unit 1 checks that could not run unattended, or would give the wrong answer. Check 2
  expected 100% similarity for `link-popup.tsx`, which the unit edits. Check 3's grep could not match the real stale
  specifier `'../components/anchored-bubble'`. Check 5 named no command. How should they be stated?
- **Decision:**
  - Each check is a command with its exact expected output.
  - The rename check expects four renames at 100%, plus `link-popup.tsx` with one import line changed.
  - The grep also matches `'../components/anchored-bubble'`, and covers README.md.
  - An `ls` confirms the emptied folders are gone.
  - The cross-feature check is [cross_feature.py](cross_feature.py). Before the move it lists exactly
    `markdown-editor.tsx:38`, and after the move it must exit 0.
- **Rationale:** The run is unattended, so a check a person has to interpret is not a check. Both reviewers raised
  checks 2, 3, and 5 independently. The script was run at `e07e27f` and found exactly the one crossing C-1 names.
- **Alternatives rejected:**
  - Rely on `tsc` alone. It covers specifiers under `src/`, but not README.md, not CSS order, and not placement.
  - A negative control for the CSS diff, swapping two imports to prove the diff fails (test-engineer, note). Any
    change to the rule sequence shows up as a non-empty text diff by construction, so the control would test `diff`
    itself.
- **Referenced in plan:** Change Units, Review Findings

### D-12: Write the plan to the readability standard directly, without a separate editor pass

- **Question:** `/plan-a-change` ends with a readability-editor rewrite of the plan. Should this unattended run
  dispatch it?
- **Decision:** No. The plan is written to the standard directly: main point first, short sentences, one idea per
  bullet, and descriptive headings.
- **Rationale:** The previous run's D-12 made the same call, for the same reasons. The plan is one unit long. Its
  section headings, `D-N` and `C-N` anchors, and command blocks must survive unchanged, and those are most of the text.
- **Alternatives rejected:** Dispatching the editor. This is cheap to reverse: run `/edit-for-readability` on the plan
  later.

# Research: How 3pitor Was Built With AI, as Source Material for a Blog Post

How did River build 3pitor with AI, in terms of the prompts typed, the skills and subagents used, and the working rhythm,
and how should that story be framed for developers who already use AI tools? Evidence mode: strict.

## Summary

3pitor was built in four working days, September 25 and 28 to 30, 2026, almost entirely through Claude Code. River's
prompts were mostly short: plain-language feature descriptions, one-word answers to planning questions, and "commit and
push". The method lived in reusable skills from the Han plugin, which is made at River's employer, Test Double. One
skill researched the stack, one wrote a change plan for each feature, and one built each plan test-first. Each skill
sent out specialist reviewer agents. River decided, cut scope, and checked the running app in the browser.

The strongest story for the post is one job done three times. River reorganized the code with a skill on day one, again
with one long instruction on day three, and on day four turned that instruction into a project skill and ran it.

The recommended post shape is a short tour of the workflow, then a day-by-day account of the build. Quote the real
prompts and name what went wrong. The facts about the build are well-corroborated from the session history and the
repository. The advice on post shape rests on a handful of practitioner posts, not on reader research.

- **Confidence:** Medium
- **Web search:** used

## Research Results

### The build took four working days and 210 commits

The repository holds 210 commits: 20 on September 25, 54 on the 28th, 51 on the 29th, and 85 on the 30th (A9). Sixteen
of those are pull-request merges, which leaves 194 commits of work (A9). There are no commits on the 26th or 27th (A9).

Seventeen pull requests were opened. Sixteen are merged, and the seventeenth, for resizable side panels, was still open
when this report was written (A10).

By line count, the code has more tests than app code. There are 6,190 lines across 34 test files and 5,475 lines of
production TypeScript, counting blank lines and comments (A16).

Twelve change sets in the planning folder each hold a
change plan of 145 to 780 non-blank lines, plus a decision log and supporting findings (A11).

### Claude ran most commits, far more than the trailer suggests

Git lists River as the author of 209 of the 210 commits (A8). The exception is one commit from a Claude Code web
session, which became pull request 6 (A8, A10). Fifty-five commits carry a "Co-Authored-By: Claude" trailer, about a
quarter (A8).

The trailer undercounts Claude's part. In the developer sessions, Claude issued 184 `git commit` calls, and about 176
succeeded (A8). That is roughly 90% of the 194 non-merge commits, almost always on River's "commit and push" (A8). The
real share may be a little higher, because commits made inside subagents were not counted (A8).

### What the build cost is known only roughly

Claude Code's own cost counter recorded about $306 of API-priced usage across the 39 developer sessions (A30). That
figure is what the usage would cost at API prices. The history does not show whether River paid it per call or through
a subscription [single-source] (A30).

### The prompts fall into a small set of kinds

The history holds 39 developer sessions, with about 134 prompts and 76 slash commands (A7). Of the slash commands, 35
were `/clear` or `/exit`, which leaves about 41 that started work (A7). Sessions the app itself launched while it was
being tested are left out of these counts (A7). The prompts fall into these kinds:

- **Research questions.** The first prompt of the project asked how to build an AI-backed markdown editor, and which
  library to use for AI sessions (A1). Its report is still in the repository (A14). A second research run, on September 29, covered a content-editor system prompt
  (A5).
- **One-line decisions.** "ok, let's go with Hono" picked the web framework (A1). "i also want to use
  https://ai-sdk.dev/ for the AI sdk rather than claude's sdk directly" picked the AI library (A1).
- **Feature descriptions handed to the planning skill.** These are paragraphs of plain intent. One begins: "when i have
  a file open, and i send a request to the AI, the AI should automatically be told which file i'm currently working
  in…" (A3).
- **Quoting the AI back to itself.** One plan request opened with a line from Claude's earlier answer: "'you could skip
  the claude program by calling the Anthropic API directly, …' - that's what i want to do" (A2).
- **Answers to the planning interview.** The planning skill asks numbered questions, and most replies were short:
  "recommended", "go with recommendation", "looks good" (A3, A5, A6). Some replies carried the real design decisions:
  "1) edit whatever is needed, keeping the scope of this work as small and tight as possible. 2) background jobs go
  away entirely…" (A3).
- **Scope cuts.** "drop commands. the entire point of this project is to be a blog post editor. we're not writing
  code…" (A2).
- **Visual feedback.** "works great, looks terrible. [Image #1] [Image #2]. make it look like the other buttons and
  menus [Image #3]" (A5). Others asked for icons, colors, and alignment after River looked at the running app (A5).
- **Housekeeping.** "commit and push", "create a branch for this work", "open a draft mode pr after the first commit"
  (A3, A5, A6).
- **Pragmatic limits.** When the copied research skill's limits proved fuzzy, River wrote, in part: "we don't need it
  to be exactly timed perfectly. … if the current working solution is 'good enough' to generally limit things, let's
  just roll with that…" (A5).
- **Naming.** A brainstorm asked for "a list of random star wars characters", then to "riff on c3po, blog, editor". The
  project was renamed from "aiditor" to "3pitor" later that day (A1, A2).

### Skills carried the method, so the typed prompts stayed short

Most of the working method lived in Han skills, not in the prompts (A7, A18). River typed the test-first skill 22 times
and the change-planning skill 11 times (A7). Claude started those two skills 5 more times from inside other skills (A7).
Some test-first runs fixed bugs rather than building features (A5). `/clear` ran 28 times, usually before the next
feature (A7). Other skills in use were research, architecture analysis, refactor, and a skill-writing skill (A7).

Most features followed the same loop (A3, A5, A6, A11):

1. River describes the feature to the planning skill.
2. The skill sends out reviewer agents and asks River a few numbered questions.
3. River answers, usually by accepting the recommendation, sometimes by cutting scope.
4. The plan is written to the change-set folder, with a decision log.
5. River runs the test-first skill against the plan, usually with "on a new branch, commit as you go, open a draft PR".
6. River looks at the result, asks for visual fixes, then says "commit and push".

The skills sent out 131 agents in total (A7). The most frequent were a readability editor (16), a software architect
(14), a structural analyst (13), a behavioral analyst (13), a "junior developer" who questions plans (12), and a test
engineer (12) (A7). A UX designer agent reviewed UI plans five times (A7).

### The best arc: one job done three times became a skill

On September 25, River used the architecture-analysis skill twice to split the server and then the UI into per-feature
files (A29). On September 28, River typed one long `/goal` instruction (a Claude Code command that keeps the agent working until a stated goal is met) to reorganize the code by package, feature, and
component, and stepped away (A4). It ended: "i'll be stepping away from my computer, so i need you to make the
decisions around this and justify every decision you made. keep a running log of all changes…" (A4). That run became
pull request 5 (A10).

On September 30, River pasted the same instruction into the skill-writing skill and asked for "a skill called
'update-code-structure' within this repository" (A6). The skill that came out is narrower than the instruction (A13).
It runs the analysis, planning, refactor, and test-first skills in order, commits each step, and records every decision
without asking (A13). Unlike the instruction, it does not create branches, push, or open pull requests (A13). That
change came from a design talk about commits and rollbacks: "good point about git commits and rollbacks. have the skill
do commits as it goes, directly on the current branch" (A6).

River then ran it with "on a new branch, and open a draft PR when you're done" (A6). The run's decision log records
taking River's instruction over the skill's own rule, as decision D-1 (A12). That run became pull request 16 (A10).

### Two API decisions show River steering, not the agent

The first came later on September 25, about four hours after the first prompt (A2). River noticed that `make build`
copied a `claude` program into the build folder, and asked why (A2). A change plan then replaced it with direct calls
to the Anthropic API, and the `claude` dependency was removed (A2, A17).

On September 30 River reversed half of that choice. A new adapter lets the app reach Claude through either an API key
or the installed `claude` program on a Claude subscription (A6, A17). Partway through planning it, River added: "add
these two things to the plan: A shared interface over both modes, A type-check step in make test" (A6).

### Things went wrong, and River caught them

A search of River's prompts turns up these problems. The list is not complete (A2, A5, A6):

- `make build` put a `claude` program in the build folder, which set off the API change (A2).
- A missing API key printed "a giant error message", and River asked for a plain explanation instead (A2).
- The research skill copied into the app "isn't working as expected" on open-ended topics (A5).
- All highlights vanished while Claude worked on a reply to one of two open questions (A5).
- River asked Claude to "fix the typescript errors" after one change (A5).
- Clearing highlights left an empty bar behind in the layout (A6).

The evidence does not show how closely River read the code or the diffs. The history records River judging results in
the running app, but it has no record of code review either way.

### The browser checked the UI, and River checked the browser

Claude drove Chrome through the browser extension to check UI work. The history holds 123 screenshot-and-click calls,
39 page-script calls, and 4 recorded GIFs (A7). River's own look at the running app produced most of the design
feedback, often with pasted screenshots (A5).

### The product copies the workflow

3pitor treats Claude the way River treated Claude Code. Claude never writes a file. Its edits appear as unsaved changes,
and only the writer's Save writes to disk (A15). The app's system prompt asks Claude to number its suggestions and
highlight each one, "so the writer can answer with 'Q2, yes'" (A15). That mirrors the numbered questions the planning
skill asked River, answered with "recommended" [single-source: the parallel is this report's reading of A3 and A15].

### What prior art says makes this kind of post credible

Practitioners agree on a few traits. The first is that the human stays accountable and checks the running result.
Simon Willison puts it as "If you haven't seen it run, it's not a working system" (A25). The second is that real
prompts make a post useful, and Harper Reed's workflow post is the best-known example (A24). The third is candor about
mistakes (A25). Reed's post shows few concrete failures, which leaves room for a post that shows more (A24).

The techniques River used each have backing somewhere:

- **Plan first.** Endorsed by Anthropic and by practitioners (A19, A23, A24). Birgitta Böckeler at Thoughtworks warns
  that spec tools produce a lot of repetitive markdown and are overkill for small changes (A22).
- **Test-first with an agent.** Endorsed by Willison and Kent Beck (A20, A21). Beck also reports agents deleting tests
  to make them pass [single-source] (A21).
- **Fresh-context and adversarial review agents.** Described by Anthropic, which also warns that such reviewers report
  gaps "even when the work is sound" (A19). No independent evidence was found that multi-agent review improves results.
- **Clearing context between tasks.** Recommended by Anthropic; no independent source was found [single-source] (A19).
- **Browser checks of UI work.** Recommended by Anthropic (A19), and listed as a pattern by Willison (A20, A26).

A 2025 study found experienced developers were 19% slower with early-2025 AI tools while believing they were about 20%
faster (A28, caveated: secondary reports only). That argues for reporting counts and dates, as this report does, rather
than speed claims.

## Options to Consider

### O1: A tour of the workflow

- **What it is:** Walk through each stage (research, plan, test-first build, review, visual check, commit) with 3pitor
  as the running example.
- **Trade-offs:** Readers can copy it, and it matches the best-known prior posts (A24). It can read like an ad for a
  plugin made at River's employer, so it needs a plain disclosure (A18). It also hides the moments River changed
  direction. Böckeler's critique means it should say when the process was too heavy (A22).
- **Rests on:** (A19), (A24), (A11), (A18)
- **Evidence status:** corroborated

### O2: A day-by-day build diary

- **What it is:** Tell the four days in order, with the pivots, cuts, and corrections as they happened.
- **Trade-offs:** It shows River steering and naturally includes failures, which the credibility sources favor (A25).
  It can bury the reusable method. No source was found for this format itself.
- **Rests on:** (A1)–(A6), (A9), (A25)
- **Evidence status:** single-source (caveated) for the format; the build facts are corroborated

### O3: "The prompts I typed"

- **What it is:** Lead with verbatim prompts and what each one produced.
- **Trade-offs:** A proven format (A24). But River's prompts are short because the skills carried the method, so the
  prompts alone undersell it (A7, A18).
- **Rests on:** (A24), (A3), (A5), (A7)
- **Evidence status:** corroborated

### O4: Lessons learned

- **What it is:** Lead with what went wrong and what River had to catch.
- **Trade-offs:** It fits the candor the credibility sources favor (A25). The failures found are small and fixed
  quickly (A2, A5, A6), so a post built around them risks overstating trouble.
- **Rests on:** (A25), (A2), (A5), (A6)
- **Evidence status:** single-source (caveated)

### O5: A short workflow tour, then the build diary, with the three-restructures arc as the spine

- **What it is:** Open with the six-step loop, tell the four days, and quote real prompts at each turn. Build toward
  the restructure done three times and turned into the `update-code-structure` skill. Name the failures and where the
  process was heavy.
- **Trade-offs:** It covers the traits the sources favor: real prompts, visible steering, candor. It runs longer, and
  it combines O1 and O2 rather than being a distinct shape. No single source models this mix.
- **Rests on:** (A19), (A24), (A25), (A29), (A4), (A6), (A13)
- **Evidence status:** corroborated for its parts; the combination is a judgment

### O6: The story of one skill

- **What it is:** A shorter post about the restructure alone: done by skill, then by one long instruction, then turned
  into a project skill and run.
- **Trade-offs:** Tight and unusual, and it teaches one reusable move: turning a prompt you repeat into a skill. It
  leaves out the feature work, the pivots, and most of the prompts.
- **Rests on:** (A29), (A4), (A6), (A12), (A13)
- **Evidence status:** corroborated

## Recommendation

- **Recommendation:** O5. Open with the loop, tell the days in order, quote the real prompts, and make the restructure
  that became a skill the turning point. Disclose that Han comes from River's employer. Give numbers as counts, dates,
  and the recorded cost, not speed claims. If a shorter post fits better, O6 is the strongest single thread.
- **Evidence basis:** Corroborated: the build facts (A7–A13, A16, A17, A29), the value of showing checks and candor
  (A25, A19), and plan-first work (A19, A23, A24). Single-source or vendor-only: the value of real prompts as a format
  (A24), context clearing and adversarial review (A19), agents resisting test-first work (A21), the cost figure (A30),
  and the perception-gap study (A28). Choosing O5 over O6 is a judgment about which story is best. The primary evidence
  backs the arc itself, not the choice of format. Dropping any single web source does not change the pick, because the
  pick rests mainly on the session history and repository.

## Validation

### V1: Commit counts by day

- **Strategy:** Challenge the Evidence
- **Investigation:** Re-ran the per-day count over all branches.
- **Result:** Confirmed
- **Impact:** Added that 16 of the 210 commits are merges.

### V2: How many commits Claude made

- **Strategy:** Challenge the Evidence
- **Investigation:** Matched each of the 184 `git commit` calls to its result. Eight failed or had nothing to commit.
  The trailer appears on 55 commits in git.
- **Result:** Partially Refuted
- **Impact:** Changed "nearly every commit" to about 176 successful commits, roughly 90% of non-merge commits, and
  corrected the trailer count from 51 to 55.

### V3: Session and prompt counts

- **Strategy:** Challenge the Evidence
- **Investigation:** Recounted from the transcripts and checked for prompts the extraction could have dropped or
  miscounted. None were.
- **Result:** Partially Refuted
- **Impact:** Noted that 35 of the 76 slash commands were `/clear` or `/exit`, and softened "134 prompts" to "about
  134", since 42 lack the typed-prompt tag.

### V4: Skill run counts and "each feature followed the loop"

- **Strategy:** Challenge the Evidence
- **Investigation:** Separated slash commands River typed from skills Claude started inside other skills.
- **Result:** Partially Refuted
- **Impact:** Split the counts into 22 and 11 typed runs, plus 5 started by Claude. Changed "each feature" to "most
  features" and noted that some test-first runs fixed bugs.

### V5: Timing of the first API decision

- **Strategy:** Challenge the Evidence
- **Investigation:** Compared the question's timestamp with the first prompt and the first commit.
- **Result:** Refuted
- **Impact:** Replaced "an hour into the build" with "about four hours after the first prompt". Added the trigger: the
  `claude` program appearing in the build folder.

### V6: The prompt-to-skill arc

- **Strategy:** Challenge the Evidence
- **Investigation:** Checked the pull-request links for both sessions and compared the `/goal` text with the text given
  to the skill-writing skill.
- **Result:** Confirmed, with an omission
- **Impact:** Added that the skill dropped branching, pushing, and pull requests after a design exchange about commits
  and rollbacks.

### V7: Verbatim quotes

- **Strategy:** Challenge the Evidence
- **Investigation:** Matched every quote against the transcripts.
- **Result:** Partially Refuted (formatting only)
- **Impact:** Marked the shortened quotes with ellipses and restored lead-in text.

### V8: Line counts and plan sizes

- **Strategy:** Challenge the Evidence
- **Investigation:** Recounted test and production lines and plan lengths.
- **Result:** Confirmed
- **Impact:** Stated that the counts include blank lines and comments.

### V9: Failures, cost, and code reading

- **Strategy:** Challenge the Evidence
- **Investigation:** Searched the prompts for problems River raised, and checked what the transcripts record about cost
  and code review.
- **Result:** Refuted as a completeness claim
- **Impact:** Added a list of problems, the recorded cost, and a statement that code reading is not in the evidence.
  Reworded O4.

### V10: Disclosure of the plugin's origin

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Checked the plugin's location and manifests against River's employer.
- **Result:** Refuted (it was not disclosed)
- **Impact:** Disclosed in the Summary, O1, the Recommendation, and the source entry that Han is made at Test Double.

### V11: Citation support

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Checked each cited source's summary against the sentence it supports.
- **Result:** Partially Refuted
- **Impact:** Removed the commit-summary citation from the commit claim, cited only the Willison post for his quote,
  removed the speed study from O4, and removed the Beck interview from the candor claim.

### V12: Weight of the web sources

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Re-fetched the Willison and Reed posts and checked whether removing any web source changes the
  pick. The Willison browser-testing page returned nothing on re-fetch.
- **Result:** Partially Refuted
- **Impact:** Changed "no concrete failures" in Reed's post to "few". Marked the browser-testing page as
  snippet-only. Stated that the pick is a judgment and does not hinge on any one web source.

### V13: The set of options

- **Strategy:** Challenge the Options Framing
- **Investigation:** Compared the options with the strongest story the evidence supports.
- **Result:** Partially Refuted
- **Impact:** Added O6, the story of one skill, and noted that O5 blends O1 and O2.

### V14: Day-one restructures

- **Strategy:** Challenge the Evidence
- **Investigation:** Checked September 25 for earlier restructuring.
- **Result:** Partially Refuted (the report left it out)
- **Impact:** Added the two architecture-analysis runs of September 25. The arc now shows the job done three times
  before it became a skill.

### Adjustments Made

Validation corrected one false timing claim and an overstated commit share. It added the failures, the recorded cost,
the plugin's origin, the day-one restructures, and a sixth option. The recommendation still stands, and O6 is now named
as the shorter alternative.

### Confidence Assessment

- **Confidence:** Medium
- **Remaining Risks:** The failure list comes from a search of River's prompts and may miss problems Claude fixed
  without River raising them. The evidence does not show how much code River read. The cost figure is at API prices and
  may not match what River paid. Four web sources (A23, A26, A27, A28) were seen only through search summaries or
  secondary reports. The advice on post shape rests on example posts, not on reader research.

## Sources

| ID  | Source | Link / location | Retrieved | Trust class | Summary (one line) | Evidence status |
| --- | ------ | --------------- | --------- | ----------- | ------------------ | --------------- |
| A1  | Kickoff session (project then named "aiditor"), Sep 25 | `~/.claude/projects/-Users-mxriverlynn-dev-mxriverlynn-aiditor/162d8888-e313-43de-8a8e-46f4aa6077fe.jsonl` | n/a | codebase | First prompt is a research request on building an AI-backed markdown editor; one-line stack picks (Bun, Hono, AI SDK); spike and browser UI; Star Wars naming brainstorm | corroborated by A9, A14 |
| A2  | Rename and API-change sessions, Sep 25 | `~/.claude/projects/-Users-mxriverlynn-dev-mxriverlynn-3pitor/4f09d760-2be1-4b2d-93f1-2b0d9f1a278c.jsonl`, `b6a6ae3f-fd5f-4613-873c-a82fdfce715f.jsonl` | n/a | codebase | Rename to 3pitor; asks why `make build` copies `claude` into the build folder; plan to call the Anthropic API, opened by quoting Claude's own line; "drop commands"; API-key error message fix | corroborated by A9, A17 |
| A3  | Feature-planning sessions, Sep 28 | `…-3pitor/02ac2572-de14-4c2f-b32c-8b5f681bc312.jsonl`, `6c17fb39-cbcc-46c7-8d0e-27371e680d1c.jsonl`, `24bfcca0-fd7f-41cf-ac89-9a6937e67a45.jsonl` | n/a | codebase | Feature descriptions given to the planning skill; numbered answers ("go with recommended", "remove the card"); test-first build on a new branch with a draft PR | corroborated by A10, A11 |
| A4  | `/goal` restructure session, Sep 28 | `…-3pitor/aff7ad90-3bf5-4b03-bc87-df10574562ea.jsonl` | n/a | codebase | One long instruction to analyze, plan, refactor, and build test-first, ending "i'll be stepping away … justify every decision"; linked to PR 5 | corroborated by A6, A10 |
| A5  | Sessions of Sep 29 | `…-3pitor/a58bab62-….jsonl`, `53e23523-….jsonl`, `6a57fe1b-….jsonl`, `2898115f-….jsonl` | n/a | codebase | Folder-tree build with visual feedback; system-prompt research; "works great, looks terrible"; copied research skill failing, then "good enough"; highlights vanishing bug; "fix the typescript errors" | corroborated by A10 |
| A6  | Sessions of Sep 30 | `…-3pitor/730dcdb4-….jsonl`, `56a46f80-7b23-4d0f-aaad-b19a227078b1.jsonl`, `ae9d2ac1-….jsonl` | n/a | codebase | API-or-CLI adapter plan with "add these two things to the plan"; skill-builder turns the `/goal` text into `update-code-structure`, with the commits-and-rollbacks change; run on a new branch; empty highlights-bar bug | corroborated by A12, A13 |
| A7  | Session digest (all developer sessions) | scratchpad `session-digest.md`, built from all `…-aiditor/*.jsonl` and `…-3pitor/*.jsonl`, app-test sessions excluded | n/a | codebase | 39 sessions, about 134 prompts, 76 slash commands (35 `/clear` or `/exit`); tdd 22 typed + 3, plan-a-change 11 typed + 2; 131 agents by type; 123 browser screenshot calls | single source (derived from raw transcripts; recounted in V3) |
| A8  | Commit authorship check | Bash `git commit` calls in the transcripts; `git log --all` authors and trailers | n/a | codebase | 184 `git commit` calls by Claude, about 176 successful; 209 of 210 commits list River as author; 55 commits carry a Claude trailer; one Claude web-session commit (14c39e6) | corroborated by A9 |
| A9  | Git history | `git log --all` in this repository | n/a | codebase | 210 commits (16 merges): 20 on Sep 25, 54 on Sep 28, 51 on Sep 29, 85 on Sep 30; none on Sep 26–27 | corroborated by A7 |
| A10 | Pull requests 1–17 | GitHub `mxriverlynn/3Pitor` PRs #1–#17 | 2026-09-30 | codebase | 16 merged, 1 open; PR 5 from the `/goal` run, PR 6 from a Claude web session, PR 13 the API-or-CLI adapter, PR 16 from the `update-code-structure` run | corroborated by A9 |
| A11 | Change sets | `docs/changes/*/` | n/a | codebase | 12 change sets; each has a change plan (145–780 non-blank lines), a decision log, a scope boundary, and current-state findings | corroborated by A3, A5 |
| A12 | Decision log, code-structure update | `docs/changes/update-code-structure-2026-09-30/artifacts/change-decision-log.md` (D-1, D-5) | n/a | codebase | D-1 records taking River's "new branch, draft PR" over the skill's own rule; D-5 cites earlier decisions as precedent | corroborated by A6 |
| A13 | Project skill `update-code-structure` | `.claude/skills/update-code-structure/SKILL.md` | n/a | codebase | Runs architecture analysis, change planning, then refactor and test-first build per unit; commits each step; records decisions without asking; does not branch, push, or open PRs | corroborated by A6, A12 |
| A14 | Kickoff research report | `docs/research/ai-session-library-for-markdown-editor.md` | n/a | codebase | The research report the first prompt produced, weighing libraries and languages for AI sessions | corroborated by A1 |
| A15 | App design and system prompt | `README.md` (opening); `src/server/chat/agent/system-prompt.md:39` | n/a | codebase | Claude never writes files; edits land unsaved; suggestions are numbered and highlighted "so the writer can answer with 'Q2, yes'" | corroborated by A10 |
| A16 | Code and test size | `git ls-files src` with `wc -l` | n/a | codebase | 5,475 lines of production TypeScript and 6,190 lines of tests in 34 test files, blank lines included | single source (direct count; recounted in V8) |
| A17 | The two API decisions | `docs/changes/replace-claude-code-with-anthropic-api/change-plan.md`; commits 4023ada, 52634a1, 6d19d87, f96b829; `docs/changes/claude-api-or-cli-adapter/change-plan.md` | n/a | codebase | Sep 25 switch to the Anthropic API and removal of the `claude` dependency; Sep 30 adapter supporting both | corroborated by A2, A6, A10 |
| A18 | Han plugin skill definitions | `~/dev/testdouble/han/*/skills/*/SKILL.md` | n/a | provided | What each skill (research, plan-a-change, tdd, refactor, architectural-analysis, skill-builder) does and which reviewer agents it sends out; the plugin is made at Test Double, River's employer | corroborated by A7 |
| A19 | Anthropic, Best practices for Claude Code | https://code.claude.com/docs/en/best-practices | 2026-09-30 | web | Verify work with tests or screenshots; explore, plan, implement, commit; `/clear` between tasks; fresh-context review; reviewers over-report gaps | corroborated by A20, A23, A25 (vendor source) |
| A20 | Simon Willison, Agentic Engineering Patterns (incl. red/green TDD) | https://simonwillison.net/guides/agentic-engineering-patterns/ | 2026-09-30 | web | Patterns for red/green TDD, subagents, version control, and browser testing; separates careful practice from vibe coding | corroborated by A19, A21 |
| A21 | Kent Beck interview, Pragmatic Engineer | https://newsletter.pragmaticengineer.com/p/tdd-ai-agents-and-coding-with-kent | 2026-09-30 | web | TDD is a "superpower" with agents; agents sometimes delete tests to make them pass | corroborated by A20 (TDD value); test deletion single source |
| A22 | Birgitta Böckeler, spec-driven development tools | https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html | 2026-09-30 | web | Spec tools produce repetitive markdown, agents ignore specs, and the process is overkill for small fixes | counterweight to A19, A23 |
| A23 | Addy Osmani, "My LLM coding workflow going into 2026" | https://addyosmani.com/blog/ai-coding-workflow/ | 2026-09-30 | web | Spec and plan first, small chunks, frequent commits, never commit code you can't explain | single source (seen through search summary only) |
| A24 | Harper Reed, "My LLM codegen workflow atm" | https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/ | 2026-09-30 | web | Brainstorm, plan, execute, with the real prompts shown; few concrete failures shown | single source (as a format model) |
| A25 | Simon Willison, "Here's how I use LLMs to help me write code" | https://simonwillison.net/2025/Mar/11/using-llms-for-code/ | 2026-09-30 | web | "If you haven't seen it run, it's not a working system"; candid about model mistakes | corroborated by A19, A20 |
| A26 | Simon Willison, agentic manual testing | https://simonwillison.net/guides/agentic-engineering-patterns/agentic-manual-testing/ | 2026-09-30 | web | Browser automation to check interactive UI work | corroborated by A19 (snippet only; re-fetch returned nothing) |
| A27 | Simon Willison, "Vibe engineering" | https://simonwillison.net/2025/Oct/7/vibe-engineering/ | 2026-09-30 | web | Separates unreviewed AI output from accountable AI-assisted engineering | single source (snippet only; not cited in the results) |
| A28 | METR trial of experienced developers | https://metr.org/research/ (and secondary coverage) | 2026-09-30 | web | 16 developers, 246 tasks, 19% slower with early-2025 tools while believing they were about 20% faster | secondary reports only (caveated) |
| A29 | Day-one restructure sessions, Sep 25 | `…-aiditor/95ec9ba6-….jsonl`, `56b6c806-….jsonl`; commits 4dae15c, 90ae33b | n/a | codebase | Two architecture-analysis runs split the server, then the UI, into per-feature files | corroborated by A9 |
| A30 | Claude Code cost records | last `cost-state` record in each of the 39 developer transcripts | n/a | codebase | Recorded usage totals about $306 at API prices across the 39 sessions; the billing arrangement is not recorded | single source |

### A19: Anthropic, Best practices for Claude Code — recommendation-bearing

- **Link / location:** https://code.claude.com/docs/en/best-practices
- **Retrieved:** 2026-09-30
- **Trust class:** web (vendor documentation; Anthropic is an interested party)
- **Summary:** Recommends giving the agent a way to check its work, such as tests or a browser screenshot, and working
  in an explore, plan, implement, commit sequence. It says to skip planning when the change fits in one sentence and to
  clear context between unrelated tasks. It describes a fresh-context review step and warns that a reviewer asked to
  find gaps will usually report some even when the work is sound.
- **Evidence status:** corroborated by A20, A23, A25 on checking work and planning; vendor-only on context clearing and
  review agents.

### A24: Harper Reed, "My LLM codegen workflow atm" — recommendation-bearing

- **Link / location:** https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/
- **Retrieved:** 2026-09-30
- **Trust class:** web (practitioner blog)
- **Summary:** A widely shared workflow post that walks through brainstorm, plan, and execute steps and shows the
  prompts used, such as "Ask me one question at a time". It covers new and existing codebases separately. It mentions
  that the back and forth "can be annoying" and gives general cautions, but shows few concrete failures from the
  author's own work.
- **Evidence status:** single source as a model of the format.

### A25: Simon Willison, "Here's how I use LLMs to help me write code" — recommendation-bearing

- **Link / location:** https://simonwillison.net/2025/Mar/11/using-llms-for-code/
- **Retrieved:** 2026-09-30
- **Trust class:** web (independent practitioner)
- **Summary:** Sets realistic expectations for coding with LLMs, insists the developer must test what the model writes,
  and is open about the model's mistakes. Its line "If you haven't seen it run, it's not a working system" puts
  responsibility on the human. The quote was confirmed on re-fetch during validation.
- **Evidence status:** corroborated by A19 and A20.

### A4 and A13: The `/goal` instruction and the skill made from it — recommendation-bearing

- **Link / location:** `~/.claude/projects/-Users-mxriverlynn-dev-mxriverlynn-3pitor/aff7ad90-3bf5-4b03-bc87-df10574562ea.jsonl`
  and `.claude/skills/update-code-structure/SKILL.md`
- **Retrieved:** n/a
- **Trust class:** codebase
- **Summary:** On September 28 River gave one long instruction to reorganize the code and stepped away, and the run
  became pull request 5. On September 30 the same text was turned into a project skill that runs the same four skills,
  commits each step, and records its decisions. The skill leaves out branching, pushing, and pull requests.
- **Evidence status:** corroborated by A6, A10, A12.

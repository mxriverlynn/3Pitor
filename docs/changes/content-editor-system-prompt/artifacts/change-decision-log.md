# Change Decision Log: Content editor system prompt

<!--
This file records every decision committed while planning the content editor system prompt.
The plan itself lives in [../change-plan.md](../change-plan.md). Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.
-->

## Trivial decisions

- D-7: Type declaration for `.md` imports — `src/server/text-imports.d.ts` declares `*.md` as a string default export,
  following `src/ui/css.d.ts`, because the type checker otherwise rejects the import with TS2307. — Referenced in plan:
  Target State, Surface Delta (S-1).
- D-8: The prompt file sits beside `agent.ts` — `src/server/chat/agent/system-prompt.md`, since `agent.ts` is its only
  reader (C-11). — Referenced in plan: Target State.
- D-9: Tool mechanics carry over in meaning — the `<tools>` section keeps every rule today's prompt states (C-1). —
  Referenced in plan: Target State.
- D-10: The writer section stays general — "keep their voice, tone, and point of view", with no traits of one writer,
  because 3pitor is a general blog editor (README, research A13) and the research's voice profile describes one writer
  (research V4). — Referenced in plan: Target State.
- D-11: Eight XML-tagged sections, with two examples — the order and tags listed in the plan follow research O5 and its
  source A1 (labeled sections, a few varied examples). The two examples are the ones O5 names: a program request
  redirected, and a typo fixed in a post's code sample. A third, for "make this post better", was deferred on
  junior-developer JD-006. — Referenced in plan: Target State, Deferred (YAGNI).
- D-17: Reading a source file to check a post's sample is editing — `<code_in_posts>` allows Reading a workspace source
  file to check that a post's code sample matches it, and still declines changing or reviewing the source itself. D-3
  already has the editor "check the prose against" code, and this is the same check against the code's origin
  (user-experience-designer OQ1). — Referenced in plan: Target State, Behavior Changes.

## Full decisions

### D-1: The prompt text lives in a markdown file loaded by a Bun text import

- **Question:** Where does the fixed prompt text live, and how does it get into the compiled build?
- **Decision:** In `src/server/chat/agent/system-prompt.md`, imported by `agent.ts` as
  `import systemPrompt from './system-prompt.md' with { type: 'text' };`. Editing it needs a server restart in dev and a
  rebuild for the binary, stated in a one-line comment above the import.
- **Rationale:** The research's code-typo example needs a markdown code fence, which a template literal can hold only
  with every backtick escaped. A separate file also lets the prose change without a test changing. The text import puts
  the file's text inside `build/3pitor` with no bundle-time code of the app's own.
- **Evidence:** C-10 (template literal and backticks); C-6 (test copies the prose); C-8 (the compiled binary cannot read
  computed paths). The software-architect verified with Bun 1.4.2 that a `.md` text import is byte-for-byte correct under
  `bun run`, `bun test`, and a `bun build --compile` binary run after the source file was deleted.
- **Behavior impact:** Preserving on its own (Unit 1 moves today's text unchanged); the text's new content is settled by
  D-3, D-4, and D-5.
- **Rejected alternatives:**
  - Keep a template literal in `agent.ts` — rejected because of C-10: the example code fence would need escaping.
  - A Bun macro like `app-skills.macro.ts` — rejected by the simpler-version test: that macro exists to glob a folder
    (C-8), and one fixed file needs only the text import.
  - Keep the template literal and write the example's fence as `~~~` (junior-developer JD-004) — rejected because the
    prose also needs inline backticks around names like `.md` and tool names, which still need escaping, and because the
    writer's posts use backtick fences, so an example with a tilde fence would show the model the wrong fence to match
    when it Edits a post.
- **Revisit criterion:** The prompt's path becomes computed, or the text import stops being embedded by `bun build
  --compile`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-2, D-6, D-7
- **Referenced in plan:** Target State, Surface Delta (S-2), Deferred (YAGNI), Review Findings

### D-2: `instructionsFor` keeps its signature and owns the join

- **Question:** What does `instructionsFor` become, and how is the file's text joined to the skills list?
- **Decision:** `function instructionsFor(skills: Skill[]): string` keeps its name, signature, and privacy. It returns:

  ```ts
  `${systemPrompt.trimEnd()}\n\n<skills>\n${SKILLS_INTRO}\n${lines.join('\n')}\n</skills>`
  ```

  where `SKILLS_INTRO` is today's sentence word for word minus its "Skills. " label: "When a request matches one, or the
  user types /<name>, Read its file first and follow its instructions exactly. Links inside a skill are relative to its
  SKILL.md's folder; Read them with the same prefix."
- **Rationale:** The function already knows the skill-line format, so it owns the join. `agentSettings` and
  `Sessions.chat` need no change (C-2). Fixed text first and the per-turn list after it keeps a future cache breakpoint
  possible (research A6, C-7). The `<skills>` tag matches the tagged sections of the file.
- **Evidence:** C-1, C-2, C-7, C-11; research A1 and A6; software-architect proposal A2.
- **Behavior impact:** Changing. The returned string differs; the observable effects are the three settled in D-3, D-4,
  and D-5.
- **Rejected alternatives:**
  - Put the skills intro and an open `<skills>` tag at the end of the `.md` and have code append only the lines —
    rejected because the file would then have to end in one particular way, a dependency nobody could see from the
    file.
  - Drop "exactly" from the skills intro, as the architect proposed for calm wording — rejected because skills such as
    collaborative-draft-editing depend on step-by-step adherence, and "exactly" is not the shouted wording research A1
    warns about.
- **Revisit criterion:** A skill is observed skipping its steps, or prompt caching is turned on and needs a breakpoint
  between the two parts.
- **Dissent (if any):** The software-architect proposed removing "exactly"; the run kept it for the reason above.
- **Settles delta entry:** S-3
- **Dependent decisions:** D-6
- **Referenced in plan:** Target State, Surface Delta (S-3)

### D-3: Decline software requests and steer back to the writing

- **Question:** What does the AI do when asked to write software, review source files, or add code?
- **Decision:** Code inside a post is part of the post, and the AI reads, checks, and fixes it. Writing software,
  reviewing source files, or adding a program to a post that isn't about it is outside what 3pitor is for. When asked,
  the AI says so briefly, gives that reason, and offers help with the writing.
- **Rationale:** The operator's request asks for an editor that "not know anything about writing code", and the research
  recommends a reasoned boundary over a flat ban because the writer's own posts carry code samples.
- **Evidence:** User input; research O3/O5, A1, A2, A16; C-4 (the tools leave reading source files and writing code into a
  post open).
- **Behavior impact:** Changing. A writer who asks "write a Python script to rename my files" gets a short decline and
  an offer to help with a post, instead of the script. The operator was asked with options A (decline and steer back),
  B (stricter, no new code samples unless pasted in), and C (looser, small snippets allowed). Operator's answer,
  verbatim: "recommended" (A).
- **Rejected alternatives:**
  - B, stricter — rejected by the operator; it would block drafting code samples for technical posts.
  - C, looser — rejected by the operator; it leaves "small snippet" undefined for the model.
- **Revisit criterion:** A Unit 3 request gets the wrong answer, or a writer reports the AI refusing to touch code that
  belongs in a post.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-3
- **Dependent decisions:** D-15, D-17
- **Referenced in plan:** Target State, Surface Delta (S-2, S-3), Behavior Changes

### D-4: Suggest before large rewrites, fix small things directly

- **Question:** When does the AI change the post, and when does it suggest first?
- **Decision:** For large rewrites and structural moves, the AI suggests and explains first and changes only once the
  writer agrees. It makes small, clear fixes directly: a typo, a broken sentence, a grammar slip.
- **Rationale:** Developmental feedback is usually given as comments, not rewrites, and the research recommends the
  editing levels in order.
- **Evidence:** Research A7; user input.
- **Behavior impact:** Changing. A writer who says "make this post better" gets notes on structure and argument before
  any section is rewritten. The operator was asked with options A (suggest first for big changes, fix small things),
  B (today's behavior, edit freely), and C (always ask, even for typos). Operator's answer, verbatim: "recommended" (A).
- **Rejected alternatives:**
  - B, edit freely — rejected by the operator.
  - C, always ask first — rejected by the operator; it would slow down typo fixes.
- **Revisit criterion:** Writers report the AI asking permission for trivial fixes, or rewriting without asking.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-3
- **Dependent decisions:** D-12, D-14, D-16
- **Referenced in plan:** Target State, Behavior Changes

### D-5: The editor watches for five blog-specific things

- **Question:** Which blog-specific points does the editor raise without being asked?
- **Decision:** Five, raised as suggestions: whether the title says what the post delivers; whether the opening gets the
  reader into the topic quickly; whether the headings let a reader skim and follow; whether the post makes one clear
  point; whether the ending lands that point or tells the reader what to do next.
- **Rationale:** The operator asked for an AI "configured for this explicitly" with a blog-post focus. The research found
  no source for blog craft, so the list rests on the operator's choice.
- **Evidence:** User input; research (blog craft marked not evidenced).
- **Behavior impact:** Changing. The AI raises these points in its feedback. The operator was asked with options A (the
  five), B (the five plus light search-engine help), and C (none unless asked). Operator's answer, verbatim:
  "recommended" (A).
- **Rejected alternatives:**
  - B, add search-engine help — rejected by the operator.
  - C, no blog-specific list — rejected by the operator.
- **Revisit criterion:** The writer wants a point added or dropped after using the editor.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-13
- **Referenced in plan:** Target State, Behavior Changes

### D-6: The test pins the join by importing the same file

- **Question:** How does `agent.test.ts` pin the prompt without copying its prose?
- **Decision:** The first test imports `system-prompt.md` with the same text import and asserts `toBe` on the
  expectation shown in the plan's Unit 2: the file's trimmed text, a blank line, `<skills>`, the skills intro written out
  as a literal, `APP_SKILL_LINE`, the fixture's doc-stats line as a literal, and `</skills>`. The intro and skill lines
  are literals, not rebuilt from the implementation, so a drift in the join is caught. It is renamed "instructs the model
  as the blog content editor, then lists the app and workspace skills". The second test is unchanged.
- **Rationale:** The test's job is the assembly contract (D-2). Copying the prose made every wording change a test
  change (C-6).
- **Evidence:** C-6; software-architect proposal A3.
- **Behavior impact:** Preserving. Test code only.
- **Rejected alternatives:**
  - Keep copying the prose into the test — rejected because of C-6.
  - Assert only `toContain` on the skills lines — rejected because it would not catch a broken join.
- **Revisit criterion:** The join changes shape.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** None
- **Referenced in plan:** Change Units (Unit 2), Review Findings

### D-12: A running skill's steps take precedence over these defaults

- **Question:** When a skill such as collaborative-draft-editing is running, do the prompt's suggest-first and blog-point
  defaults still apply?
- **Decision:** No. `<suggest_or_change>` ends with: when a skill is running, its steps decide what to change directly,
  what to suggest, and where a turn ends; these defaults apply outside skills.
- **Rationale:** The skill's first pass applies edits beyond typos without asking, forbids structural moves in that pass,
  and ends each stop on its question, within a 20-tool-call turn. Suggest-first and unrequested blog points would pull
  against those steps, and the prompt had no rule saying which wins.
- **Evidence:** `src/skills/collaborative-draft-editing/SKILL.md` Step 3 and its turn-limit line; user-experience-designer
  UX-002; test-engineer F3.
- **Behavior impact:** Preserving for skill runs: it keeps today's skill behavior from being changed by D-4 and D-5.
- **Rejected alternatives:**
  - Rely on "follow its instructions exactly" in the skills intro alone — rejected because it sits after the conflicting
    sections and says nothing about priority (UX-002).
- **Revisit criterion:** Unit 3 row 10 or `bun run check` shows a skill departing from its steps.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Risks, Review Findings

### D-13: Blog points come with broad requests, not narrow fixes

- **Question:** When does the editor raise the five blog points the operator chose in D-5?
- **Decision:** When the piece is a blog post and the writer asks for feedback, a review, or to make the post better, or
  when working at the developmental level. Only the points that need work, as a short list after the answer. A narrow
  fix gets only the fix, unless a point is badly broken, and then one line.
- **Rationale:** The chat panel's first suggested request is "Fix the spelling and grammar", and without a trigger that
  request would pick up title and opening advice. `<editing>` already says to work at the level the writer asks for, and
  this ties the blog points to it. `<role>` also names other prose, which the five points do not fit.
- **Evidence:** `src/ui/chat/chat/chat.tsx:139` hint text; user-experience-designer UX-001 and OQ2; junior-developer
  JD-005; D-5.
- **Behavior impact:** Changing, within D-5's operator answer: the points are still raised without the writer naming
  them, on broad requests. No new escalation, because it narrows when D-5 applies and does not change what it is.
- **Rejected alternatives:**
  - Raise the points on every reply — rejected because it buries narrow fixes (UX-001).
  - Raise them only when the writer names blog craft — rejected because that is D-5's option C, which the operator
    declined.
- **Revisit criterion:** The writer reports missing a blog point they expected, or seeing them on narrow fixes.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Behavior Changes, Review Findings

### D-14: Large and small changes are defined, and a specific request is agreement

- **Question:** Where is the line between a large change the editor suggests first and a small fix it makes directly?
- **Decision:** A change is large when it rewrites more than a sentence or two of the writer's own wording, cuts, merges,
  or moves a paragraph or section, or changes what the post argues. Many small fixes across a post are still small. A
  specific change the writer asked for is their agreement, so the editor makes it.
- **Rationale:** D-4 names only the edges (typos versus structural moves), which leaves tightening a paragraph or
  rewording a sentence to the model's guess. Asking again after "rewrite my intro" is the permission-for-trivial-fixes
  failure D-4's revisit criterion names.
- **Evidence:** user-experience-designer UX-003; D-4.
- **Behavior impact:** Changing, within D-4's operator answer.
- **Rejected alternatives:**
  - Leave the line to the model — rejected because D-4's revisit criterion names both failure directions.
- **Revisit criterion:** Unit 3 rows 8 or 9 fail, or a writer reports either failure.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Review Findings

### D-15: The decline is short, and code samples for a post are writing

- **Question:** How does the decline read, and does it cover code a technical post needs?
- **Decision:** Decline in one or two sentences, without lecturing, give the reason once, and offer the nearest writing
  task. If asked again, restate what the editor can help with instead of repeating the reason. Drafting or extending a
  code sample for a post about that code is writing the post.
- **Rationale:** D-3's operator answer rejected option B because it would block drafting samples for technical posts,
  but the draft plan's Behavior Change 1 declined "adding a function to code", which read as the same block. An
  unbounded "briefly" and one example redirect also risk a repeated, preachy decline.
- **Evidence:** user-experience-designer UX-004 and UX-005; D-3; research A16.
- **Behavior impact:** Changing, within D-3's operator answer.
- **Rejected alternatives:**
  - Keep "adding a function to code" in the decline list — rejected because it contradicts D-3's reason for rejecting B.
- **Revisit criterion:** Unit 3 rows 1, 3, or 5 fail.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Behavior Changes, Review Findings

### D-16: Suggestions are numbered and highlighted

- **Question:** How does the writer accept one suggestion and decline another after suggest-first?
- **Decision:** The editor numbers its suggestions and Highlights each passage with its label (Q1, Q2), so the writer can
  answer "Q2, yes".
- **Rationale:** D-4's "once the writer agrees" needs a way to agree to one item. The Highlight tool already takes a
  distinct label per passage and a question for it, and the collaborative-draft-editing skill already uses that pattern.
- **Evidence:** `src/server/chat/tools/tools.ts` Highlight description (research A10); user-experience-designer UX-006;
  D-4.
- **Behavior impact:** Changing, within D-4's operator answer: suggestion replies outside skills now highlight passages.
- **Rejected alternatives:**
  - Unlabeled suggestions — rejected because the writer then has to quote the suggestion back to accept it.
- **Revisit criterion:** Writers find the highlights noisy on short replies.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Review Findings

### D-18: The hand check uses a scratch workspace and new wording

- **Question:** Where and how does Unit 3's hand check run?
- **Decision:** In a scratch folder outside the repository holding a technical post with a flawed code sample and a small
  `utils.ts`, served with `bun run src/server/server.ts <scratch folder>`. The ten requests in the plan's Unit 3 are
  worded differently from the prompt's examples. Each runs once, again if borderline, with pass or fail recorded in the
  pull request description, and `bun run check` runs after them.
- **Rationale:** The committed fixture holds only a two-line garden plan with no code and no source file, so the code
  requests had nothing to act on and saved edits would land in a test fixture. Requests copied from the examples would
  show only that the model can repeat an example.
- **Evidence:** `src/fixtures/workspace/notes.md`; `src/server/server.ts:17` (`chooseWorkspace(process.argv[2])`);
  junior-developer JD-001 and JD-002; test-engineer F1, F2, and F3.
- **Behavior impact:** Preserving. Verification only.
- **Rejected alternatives:**
  - Add a technical post and a source file to `src/fixtures/workspace` — rejected because other tests read that fixture,
    and doc-stats and the end-to-end check depend on its contents.
- **Revisit criterion:** The end-to-end scenarios cut for scope are reinstated, and the scratch files move into them.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** None
- **Referenced in plan:** Change Units (Unit 3), Review Findings

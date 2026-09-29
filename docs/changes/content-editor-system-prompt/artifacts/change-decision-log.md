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
- D-11: Eight XML-tagged sections, with three examples — the order and tags listed in the plan follow research O5 and its
  source A1 (labeled sections, a few varied examples). — Referenced in plan: Target State.

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
- **Revisit criterion:** The prompt's path becomes computed, or the text import stops being embedded by `bun build
  --compile`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-2, D-6, D-7
- **Referenced in plan:** Target State, Surface Delta (S-2), Deferred (YAGNI)

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
- **Dependent decisions:** None
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
- **Dependent decisions:** None
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
- **Dependent decisions:** None
- **Referenced in plan:** Target State, Behavior Changes

### D-6: The test pins the join by importing the same file

- **Question:** How does `agent.test.ts` pin the prompt without copying its prose?
- **Decision:** The first test imports `system-prompt.md` with the same text import and asserts `toBe` on
  `` `${systemPrompt.trimEnd()}\n\n<skills>\n${SKILLS_INTRO_SPELLED_OUT}\n${APP_SKILL_LINE}\n- doc-stats (...): ...\n</skills>` ``,
  with the skills intro written out in full in the test so a change to it is caught. It is renamed "instructs the model
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
- **Referenced in plan:** Change Units (Unit 2)

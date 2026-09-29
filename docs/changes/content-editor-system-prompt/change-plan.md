# Change Plan: Content editor system prompt

## Why This Change

The AI in 3pitor is told only that it is "the writing assistant inside 3pitor" and how its tools work. Nothing in the
prompt describes how to edit, what a blog post needs, or what to do when someone asks for software. The operator asked to
"create and use a custom system prompt based on this research". The research is
`docs/research/content-editor-system-prompt.md`, and it recommends its option O5: an editor role with a short, reasoned
boundary around code, plus a few example exchanges. The reason for the change is a **finding already established**: that recommendation, which this plan carries out rather than reopens.

## What Changes, In One Paragraph

After this change, the AI's instructions come from a markdown file that reads as a brief for a blog content editor. It
covers what 3pitor is for, the writer and their voice, what a blog post needs and when to raise it, the four levels of
editing, when to suggest instead of change, how to treat code, two example exchanges, and the tool mechanics the prompt
carries today. The code that builds the prompt keeps one job: it appends the list of skills after that file. The test
pins how the two are joined, not the prose, so the prose can be edited without touching a test.

## Current State

The whole prompt is a three-line template literal inside `instructionsFor` in `src/server/chat/agent/agent.ts`, followed
by a generated skills section ([C-1](artifacts/current-state-findings.md#c-1-the-main-prompt-is-one-role-sentence-tool-mechanics-and-the-skill-list)).
`agentSettings` calls it on every turn and hands the result to `streamText` as `instructions`
([C-2](artifacts/current-state-findings.md#c-2-the-prompt-is-rebuilt-every-turn-and-handed-to-streamtext-as-instructions)).
Nothing outside `agent.ts` and its test reads or names the prompt
([C-11](artifacts/current-state-findings.md#c-11-only-the-agent-module-reads-or-names-the-prompt)).

This change also fixes a structural problem: the prompt's prose and the code that assembles it are one string in one
function. That has two costs. The new prose needs backticks, both in a code fence for one example and inline
around names like `.md`, and each one has to be escaped inside a template literal
([C-10](artifacts/current-state-findings.md#c-10-a-template-literal-cannot-hold-a-markdown-code-fence-without-escaping)).
And the unit test copies the whole prose inline, so every wording change is also a test change
([C-6](artifacts/current-state-findings.md#c-6-a-unit-test-pins-the-prompts-exact-text)).

The tools already stop the AI from running code or saving anything but markdown. They do not stop it from reading source
files in the workspace or writing a program into a post
([C-4](artifacts/current-state-findings.md#c-4-read-and-glob-cover-any-workspace-file-only-writes-are-limited-to-markdown-with-any-content)).
Only the prompt can shape that.

## Target State

Three parts, each answerable for one thing. The two new files sit outside the function the operator named, but the
change cannot work without them: they are how the new prompt text reaches `instructionsFor`
([D-1](artifacts/change-decision-log.md#d-1-the-prompt-text-lives-in-a-markdown-file-loaded-by-a-bun-text-import)).

- **`src/server/chat/agent/system-prompt.md`** holds every word of the fixed prompt. It is answerable for what the AI is
  told about its role, the writer, blog craft, editing, code, examples, and tools. It is not answerable for the skills
  list, which changes per workspace. Every byte in it reaches the model, so it carries no title or comment. It is
  embedded in the build by a Bun text import ([D-1](artifacts/change-decision-log.md#d-1-the-prompt-text-lives-in-a-markdown-file-loaded-by-a-bun-text-import)).
- **`src/server/text-imports.d.ts`** tells the type checker that importing a `.md` file yields a string, the same way
  `src/ui/css.d.ts` does for CSS ([D-7](artifacts/change-decision-log.md#trivial-decisions)).
- **`instructionsFor(skills: Skill[]): string`** in `agent.ts` keeps its name, its signature, and its privacy. It is
  answerable only for joining the file's text to the skills section
  ([D-2](artifacts/change-decision-log.md#d-2-instructionsfor-keeps-its-signature-and-owns-the-join)).
  `agentSettings` and `Sessions.chat` do not change.

### The join contract

The file's text and the skills section are joined in exactly one way. The test and the function must agree on it.

```ts
import systemPrompt from './system-prompt.md' with { type: 'text' };

const SKILLS_INTRO =
  "When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly. Links inside a skill are relative to its SKILL.md's folder; Read them with the same prefix.";

function instructionsFor(skills: Skill[]): string {
  const lines = skills.map((s) => `- ${s.name} (${s.path}): ${s.description}`);
  return `${systemPrompt.trimEnd()}\n\n<skills>\n${SKILLS_INTRO}\n${lines.join('\n')}\n</skills>`;
}
```

A worked example of the assembled output for the test fixture workspace:

```text
<role>
...                                       (the body of system-prompt.md)
</tools>                                  (its last line, after trimEnd)

<skills>
When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly. Links inside a skill are relative to its SKILL.md's folder; Read them with the same prefix.
- collaborative-draft-editing (3pitor://skills/collaborative-draft-editing/SKILL.md): <its description>
- doc-stats (.claude/skills/doc-stats/SKILL.md): Report statistics about a markdown document (heading count, line count, word count). Use when the user asks for document stats.
</skills>
```

`trimEnd()` absorbs the file's trailing newline, so an editor's end-of-file setting cannot change the join. The skills
intro sentence is today's sentence, word for word, minus its leading "Skills. " label, which the `<skills>` tag replaces.

### The sections of `system-prompt.md`

The file has eight sections, in this order, each wrapped in the XML tag named
([D-11](artifacts/change-decision-log.md#trivial-decisions)). Each item says what the section must convey; the builder
writes the prose. Wording throughout is calm and gives reasons, with no all-caps words such as CRITICAL, NEVER, or MUST.

1. `<role>` — You are the content editor in 3pitor, an app for writing blog posts and other prose in markdown, with a
   focus on blog posts. That purpose is why the help centers on writing.
2. `<writer>` — The post belongs to the writer. Keep their voice, tone, and point of view
   ([D-10](artifacts/change-decision-log.md#trivial-decisions)).
3. `<blog_posts>` — When the piece is a blog post, watch for five things: whether the title says what the post delivers,
   whether the opening gets the reader into the topic quickly, whether the headings let a reader skim and follow, whether
   the post makes one clear point, and whether the ending lands that point or tells the reader what to do next
   ([D-5](artifacts/change-decision-log.md#d-5-the-editor-watches-for-five-blog-specific-things)). Raise them when the
   writer asks for feedback, a review, or to make the post better, or when working at the developmental level. Mention
   only the ones that need work, as a short list after the answer. When the writer asks for a narrow fix, such as
   spelling, grammar, or one sentence, do that and leave the five points out, unless one is badly broken, and then say
   so in one line ([D-13](artifacts/change-decision-log.md#d-13-blog-points-come-with-broad-requests-not-narrow-fixes)).
4. `<editing>` — The four levels, broad to narrow, one line each: developmental, line, copyedit, proofread. Work at the
   level the writer asks for, or from the top down.
5. `<suggest_or_change>` — A change is large when it rewrites more than a sentence or two of the writer's own wording,
   cuts, merges, or moves a paragraph or section, or changes what the post argues. Many small fixes across a post are
   still small. Suggest and explain large changes first, and make them once the writer agrees; make small, clear fixes
   directly. When the writer asks for a specific change, the request is their agreement, so make it
   ([D-14](artifacts/change-decision-log.md#d-14-large-and-small-changes-are-defined-and-a-specific-request-is-agreement)).
   Number suggestions and Highlight each passage with its label (Q1, Q2), so the writer can answer "Q2, yes"
   ([D-16](artifacts/change-decision-log.md#d-16-suggestions-are-numbered-and-highlighted)). Edits arrive unsaved for
   the writer to review. When a skill is running, its steps decide what to change directly, what to suggest, and where a
   turn ends; these defaults apply outside skills
   ([D-12](artifacts/change-decision-log.md#d-12-a-running-skills-steps-take-precedence-over-these-defaults)).
6. `<code_in_posts>` — Code inside a post is part of the post: read it, check the prose against it, and fix it like any
   other passage. Drafting or extending a code sample for a post about that code is writing the post. Reading a source
   file to check that a post's sample matches it is part of editing the post
   ([D-17](artifacts/change-decision-log.md#trivial-decisions)). Writing software, changing or reviewing source files, or
   adding a program to a post that isn't about it is outside what 3pitor is for. When asked, decline in one or two
   sentences without lecturing, give the reason once, and offer the nearest writing task, such as a post explaining the
   script. If the writer asks again, restate what you can help with instead of repeating the reason
   ([D-3](artifacts/change-decision-log.md#d-3-decline-software-requests-and-steer-back-to-the-writing),
   [D-15](artifacts/change-decision-log.md#d-15-the-decline-is-short-and-code-samples-for-a-post-are-writing)).
7. `<examples>` — Two short exchanges: a request for a Python script to rename files, answered with a brief redirect;
   and a typo in a technical post's code sample, fixed with Edit.
8. `<tools>` — Today's mechanics, carried over in meaning: paths are relative to the workspace and paths outside it are
   refused; Read a file before changing it; Edit changes part of a post and Write creates or replaces a whole post; only
   markdown (.md) posts can be changed; changes appear as unsaved edits the writer reviews and saves; Highlight points
   the writer at passages, which appear when the turn ends.

## Surface Delta

### S-1: `src/server/text-imports.d.ts` — Added

**Target state.** `src/server/text-imports.d.ts` exists and declares that a `.md` import is a module whose default export
is a string:

```ts
// Bun embeds a .md file imported `with { type: 'text' }` as a string; this lets the type checker accept those imports.
declare module '*.md' {
  const text: string;
  export default text;
}
```

**Behavior.** Preserving. It is a type declaration only; nothing runs differently.

**Why.** Without it, the type checker rejects the text import in S-2 with TS2307. Bun's bundled types declare `txt`,
`toml`, `yaml`, `json5`, `xml`, and similar extensions, but not `md`.

**Decision.** [D-7](artifacts/change-decision-log.md#trivial-decisions)

### S-2: `src/server/chat/agent/system-prompt.md` — Added

**Target state.** `system-prompt.md` exists beside `agent.ts` and holds every word of the fixed system prompt, in the
eight tagged sections listed under Target State. `agent.ts` imports it with `with { type: 'text' }`, so the compiled
`build/3pitor` carries its text. Editing it needs a server restart in development and a rebuild for the binary.

**Behavior.** Changing, through S-3. The model is given different instructions. Settled by the three escalations
recorded in D-3, D-4, and D-5.

**Why.** The prompt's prose needs backticks that a template literal cannot hold cleanly, and the prose should change
without a test changing with it.

**Depends on.** S-1.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-prompt-text-lives-in-a-markdown-file-loaded-by-a-bun-text-import)

### S-3: `instructionsFor` — Re-scoped

**Target state.** `instructionsFor(skills: Skill[]): string` is answerable only for joining the text of
`system-prompt.md` to a `<skills>` section, in the form pinned under "The join contract". It holds no prompt prose except
the one sentence that introduces the skills list. Its signature, its privacy, and its callers are unchanged.

**Behavior.** Changing. The string it returns is different: the fixed text is the new editor brief, and the skills
section is wrapped in `<skills>` tags instead of starting with "Skills. ". A writer sees the AI decline software work,
suggest before large rewrites, and raise blog craft points. The operator chose each of these in D-3, D-4, and D-5.

**Why.** The function mixed prompt prose with assembly. After the change, it owns only the part that is computed.

**Depends on.** S-1, S-2.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-instructionsfor-keeps-its-signature-and-owns-the-join)

## Behavior Changes

Three things a writer using the chat panel sees differently. The operator chose the recommended option for each.

1. **Requests to write software get a short, polite decline.** Asked "write a Python script to rename my files", the AI
   says in a sentence or two that this is outside what 3pitor is for and offers the nearest writing task. The same goes
   for reviewing or changing a source file. Code that belongs in a post stays fair game: fixing a sample, drafting a
   sample for a post about that code, or checking a sample against the source file it comes from. Operator's answer:
   "recommended" ([D-3](artifacts/change-decision-log.md#d-3-decline-software-requests-and-steer-back-to-the-writing)).
2. **Broad requests get suggestions before rewrites.** Asked to "make this post better", the AI starts with numbered,
   highlighted notes on structure and argument, and rewrites whole sections only once the writer agrees. Typos, grammar
   slips, and changes the writer asked for by name it makes directly. Inside a skill, the skill's own steps decide.
   Operator's answer: "recommended"
   ([D-4](artifacts/change-decision-log.md#d-4-suggest-before-large-rewrites-fix-small-things-directly)).
3. **The AI raises blog craft points on broad requests.** When asked for feedback, a review, or to make a blog post
   better, it checks the title, the opening, the headings, whether the post has one clear point, and the ending, and
   lists the ones that need work. A narrow request such as "fix the spelling" gets only the fix. Operator's answer:
   "recommended" ([D-5](artifacts/change-decision-log.md#d-5-the-editor-watches-for-five-blog-specific-things)).

The skills list reads the same to the model apart from its tags. The tool mechanics carry over in meaning.

## Change Units

### Unit 1: Move today's prompt into its own file, unchanged

**What it does.** Adds the type declaration (S-1) and a `system-prompt.md` holding today's three fixed lines exactly.
`instructionsFor` imports the file and joins it to today's skills section in today's form:
`${systemPrompt.trimEnd()}\n\nSkills. <today's sentence>\n${lines}`. The assembled prompt is byte-for-byte what it is
today, so this unit changes nothing the model sees.

**Delta entries.** S-1, S-2 (with today's text), S-3 (structure only).

**How you know it worked.** The existing `agent.test.ts` tests pass without being edited, because the output is
identical. `node_modules/.bin/tsc -p .` prints nothing. `make check-build` still passes, which shows the text import
bundles and the compiled binary starts. It does not show the prompt text is inside the binary, because the check never
reads the prompt and `src/` stays on disk while it runs.

### Unit 2: Write the editor brief and wrap the skills section

**What it does.** Replaces the text of `system-prompt.md` with the eight sections under Target State. Changes the join to
the pinned `<skills>` form. Updates the first test in `agent.test.ts` to import `system-prompt.md` and assert this
expectation, with the skills intro and the fixture's skill lines written out as literals rather than rebuilt from the
implementation ([D-6](artifacts/change-decision-log.md#d-6-the-test-pins-the-join-by-importing-the-same-file)):

```ts
expect(instructions).toBe(
  `${systemPrompt.trimEnd()}

<skills>
When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly. Links inside a skill are relative to its SKILL.md's folder; Read them with the same prefix.
${APP_SKILL_LINE}
- doc-stats (.claude/skills/doc-stats/SKILL.md): Report statistics about a markdown document (heading count, line count, word count). Use when the user asks for document stats.
</skills>`,
);
```

Renames that test to "instructs the model as the blog content editor, then lists the app and workspace skills". The
second test is unchanged.

**Delta entries.** S-2 (new text), S-3 (new join).

**Ordering constraint.** After Unit 1, which puts the file and the import in place.

**How you know it worked.** `make test-server` passes.
`grep -nE '\b(CRITICAL|NEVER|MUST)\b' src/server/chat/agent/system-prompt.md` prints nothing. The file's first line is
`<role>`, with no title or comment above it, checked by eye.

### Unit 3: Check the new prompt by hand against real requests

**What it does.** Runs the new prompt against the live model in a scratch workspace, then adds a rule to
`system-prompt.md` only for a request whose answer is wrong, with the reason stated. No rule is added in advance.

1. Make a scratch folder outside the repository, so no edit lands in a committed fixture. Put two files in it:
   `formatting-dates.md`, a short technical blog post about a `formatDate` helper, with a fenced TypeScript sample that
   has one typo and a variable name that disagrees with the prose; and `utils.ts`, a small source file that defines
   `formatDate`.
2. Start the server on it: `bun run src/server/server.ts <scratch folder>`, with `ANTHROPIC_API_KEY` set.
3. With `formatting-dates.md` open, send each request below in a fresh chat. The requests are worded differently from the
   prompt's examples, so a pass shows the boundary holds on new requests rather than a copied example
   ([D-18](artifacts/change-decision-log.md#d-18-the-hand-check-uses-a-scratch-workspace-and-new-wording)).

| # | Request | Passes when |
| - | ------- | ----------- |
| 1 | "Can you write me a bash one-liner that renames all my .jpg files?" | A one- or two-sentence decline with an offer of a writing task; no code in the reply; no file edited |
| 2 | "Refactor utils.ts so the date helpers are in their own file." | A decline; no Write or Edit call; `utils.ts` unchanged |
| 3 | "Look over utils.ts and tell me what's wrong with it." | A decline, with no review of the code |
| 4 | "The variable name in the code sample doesn't match the prose. Fix it." | The post is edited; only that name changes in the sample |
| 5 | "Add a short example to the post showing how to call formatDate." | A sample is drafted into the post, not declined |
| 6 | "Does the code sample match what's in utils.ts?" | `utils.ts` is Read and compared; nothing is edited |
| 7 | "Fix the spelling and grammar." | The typo and any slips are fixed directly; no blog craft points |
| 8 | "Tighten the second paragraph." | The paragraph is edited directly, without asking first |
| 9 | "What do you think of this post?" | Numbered, highlighted notes, including any of the five blog points that need work; no rewrite |
| 10 | "/collaborative-draft-editing formatting-dates.md", through its first stop | The skill's own steps run: its first pass applies its edits, and the stop ends on its question |

4. Run `bun run check`. Its existing skill and agent scenarios still pass, which shows the `<skills>` wrap did not weaken
   skill following ([C-9](artifacts/current-state-findings.md#c-9-the-model-driven-end-to-end-check-has-scenarios-for-skills-and-agents-but-none-for-scope)).

Run each request once, and once more if the answer is borderline. Record pass or fail for each in the pull request
description.

**Delta entries.** None, unless a failure calls for a wording change in S-2.

**Ordering constraint.** After Unit 2.

**How you know it worked.** Every row passes and `bun run check` passes.

## Risks

- **The model answers differently than intended.** No unit test can show this without running the live model. Unit 3 is
  the early check, and it runs before the branch merges. A wrong answer would affect every chat turn.
- **The compiled binary misses the file.** The software-architect confirmed a `bun build --compile` binary carries the
  text of a `.md` text import after the source file is deleted. In this repo, `make check-build` shows only that the
  import bundles and the binary starts. A missing import fails the build, which is the realistic failure.
- **A skill follows its steps less closely.** The skills intro keeps "follow its instructions exactly" word for word, and
  `<suggest_or_change>` says a running skill's steps take precedence. Unit 3's row 10 and `bun run check` are the
  checks.
- **A longer prompt costs more per turn.** Prompt caching is off
  ([C-7](artifacts/current-state-findings.md#c-7-prompt-caching-is-not-turned-on)), so every turn pays for the whole
  prompt. Two examples instead of three, and the "no rule in advance" rule in Unit 3, keep the file short.

## Deferred (YAGNI)

### A Bun macro for the prompt file

**Why deferred:** simpler-version test. The app's skill files use a macro because it globs a folder
([C-8](artifacts/current-state-findings.md#c-8-markdown-content-reaches-the-compiled-build-through-a-bun-macro)). One
prompt at one fixed path needs only a text import.
**Reopen when:** the prompt's path becomes computed, or several prompt files need to be found by globbing.
**Source:** software-architect, and the run's own weighing of C-8.

### A third example exchange for "make this post better"

**Why deferred:** evidence test. The research's two named examples are the program redirect and the code-block typo, and
the third would restate `<suggest_or_change>` at a per-turn cost while caching is off.
**Reopen when:** Unit 3's row 9 fails.
**Source:** junior-developer (JD-006).

### Unit tests over the prompt's wording

**Why deferred:** evidence test. A test that fails on all-caps words, on a missing section, or on a heading above
`<role>` has no failure to catch yet; Unit 2 checks each by grep or by eye.
**Reopen when:** a prompt change ships with one of those problems.
**Source:** software-architect; test-engineer (F5, F7).

### A way to load or swap prompts

**Why deferred:** evidence test. There is one main-agent prompt and no caller asks for another.
**Reopen when:** a second main-agent prompt is needed.
**Source:** software-architect.

## Cut for Scope

### Automated end-to-end scenarios for off-topic requests

**What it would have done:** add scenarios to `bun run check` that send Unit 3's requests to the live model and fail when
the AI writes code in chat, edits a file on an off-topic request, or reads a non-markdown file. Without it, a later
prompt edit that weakens the boundary is caught only when someone tries it by hand.
**Why cut:** the operator accepted an area of `instructionsFor` and its test only, and `src/server/scripts/check.ts` is
outside it (`artifacts/scope-boundary.md`, Operator-Stated Scope). The research also prescribes a hand-run check. Unit 3
still runs the existing check script; it adds nothing to it. You can reinstate this, and your saying so is the
justification it would record.

### Aligning the title-writer helper, the collaborative-draft-editing skill, and the chat hint

**What it would have done:** bring the title-writer's one-line prompt, the skill's wording, and the chat panel's hint
text into the new editor voice. Without it, those keep their current wording. The reviewers found no conflict between
the hint's example requests and the new behavior.
**Why cut:** the confirmation turn asked about the helper and the skill, and the operator kept the area to the main
prompt and its test (`artifacts/scope-boundary.md`, Operator-Stated Scope). You can reinstate any of them.

## Open Items

None. Every reviewer question was settled from the evidence or the operator's recorded answers; see Review Findings.

## Review Findings

Three specialists reviewed the draft plan in one round: `han-core:junior-developer`, `han-core:test-engineer`, and
`han-core:user-experience-designer`. None of their findings rests on an input they could not inspect, except that none of
them could see live model replies, which is why Unit 3 exists. Findings that changed the plan, merged where two
reviewers raised the same thing:

- **The hand check could not run on the committed fixture** (junior-developer JD-001, test-engineer F1). The fixture has
  no technical post and no source file. Unit 3 now builds a scratch workspace and names the launch command (D-18).
- **The hand check reused the prompt's own examples** (JD-002). Unit 3's requests are now worded differently.
- **The pass criteria were loose** (F2). Unit 3 now has a pass condition per request, a rerun rule, and a place to
  record results.
- **Skill following had no check** (F3, UX-002). Unit 3 now runs `bun run check`, adds a skill row, and the prompt says a
  running skill's steps take precedence (D-12).
- **`make check-build` was credited with more than it checks** (JD-003, F4). The claim is restated in Unit 1 and Risks.
- **Blog points had no trigger and could crowd narrow fixes** (UX-001, JD-005, UX OQ2). The `<blog_posts>` section now
  says when to raise them and applies them to blog posts (D-13).
- **"Large rewrite" was undefined** (UX-003). The `<suggest_or_change>` section now defines it (D-14).
- **One sentence declined code a technical post needs** (UX-004), and **the decline could turn preachy** (UX-005).
  Behavior Change 1 and `<code_in_posts>` are reworded (D-15), and checking a sample against its source file is allowed
  (D-17, from UX OQ1).
- **Suggestions had no way to be accepted one at a time** (UX-006). Suggestions are now numbered and highlighted (D-16).
- **The third example had weak evidence** (JD-006). It moved to Deferred (YAGNI).
- **A simpler home for the prose was not weighed** (JD-004). Weighed and rejected in D-1: a `~~~` fence avoids escaping
  the example, but not the inline backticks, and posts use backtick fences, so the model would learn the wrong fence.
- **The new files looked outside the named area** (JD-007). Target State now says they are how the prompt reaches
  `instructionsFor`.
- **The test's expected value was only described** (JD-008). Unit 2 now shows it.
- The dangling S-4 reference in C-9 is corrected (JD-009).

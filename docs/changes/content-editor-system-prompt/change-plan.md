# Change Plan: Content editor system prompt

## Why This Change

The AI in 3pitor is told only that it is "the writing assistant inside 3pitor" and how its tools work. Nothing in the
prompt describes how to edit, what a blog post needs, or what to do when someone asks for software. The operator asked to
"create and use a custom system prompt based on this research". The research is
`docs/research/content-editor-system-prompt.md`, and it recommends its option O5: an editor role with a short, reasoned
boundary around code, plus a few example exchanges. This is a **finding already established**.

## What Changes, In One Paragraph

After this change, the AI's instructions come from a markdown file that reads as a brief for a blog content editor. It
covers what 3pitor is for, the writer and their voice, what a blog post needs, the four levels of editing, when to
suggest instead of change, how to treat code, three example exchanges, and the tool mechanics the prompt carries today.
The code that builds the prompt keeps one job: it appends the list of skills after that file. The test pins how the two
are joined, not the prose, so the prose can be edited without touching a test.

## Current State

The whole prompt is a three-line template literal inside `instructionsFor` in `src/server/chat/agent/agent.ts`, followed
by a generated skills section ([C-1](artifacts/current-state-findings.md#c-1-the-main-prompt-is-one-role-sentence-tool-mechanics-and-the-skill-list)).
`agentSettings` calls it on every turn and hands the result to `streamText` as `instructions`
([C-2](artifacts/current-state-findings.md#c-2-the-prompt-is-rebuilt-every-turn-and-handed-to-streamtext-as-instructions)).
Nothing outside `agent.ts` and its test reads or names the prompt
([C-11](artifacts/current-state-findings.md#c-11-only-the-agent-module-reads-or-names-the-prompt)).

The structural property this change addresses is that the prompt's prose and the code that assembles it are one string
in one function. That has two costs. The research's example of a typo fixed in a post's code block needs a markdown code
fence, and each backtick in it would have to be escaped inside the literal
([C-10](artifacts/current-state-findings.md#c-10-a-template-literal-cannot-hold-a-markdown-code-fence-without-escaping)).
And the unit test copies the whole prose inline, so every wording change is also a test change
([C-6](artifacts/current-state-findings.md#c-6-a-unit-test-pins-the-prompts-exact-text)).

The tools already stop the AI from running code or saving anything but markdown. They do not stop it from reading source
files in the workspace or writing a program into a post
([C-4](artifacts/current-state-findings.md#c-4-read-and-glob-cover-any-workspace-file-only-writes-are-limited-to-markdown-with-any-content)).
Only the prompt can shape that.

## Target State

Three parts, each answerable for one thing.

- **`src/server/chat/agent/system-prompt.md`** holds every word of the fixed prompt. It is answerable for what the AI is
  told about its role, the writer, blog craft, editing, code, examples, and tools. It is not answerable for the skills
  list, which changes per workspace. Every byte in it reaches the model, so it carries no title or comment. It is
  embedded in the build by a Bun text import ([D-1](artifacts/change-decision-log.md#d-1-the-prompt-text-lives-in-a-markdown-file-loaded-by-a-bun-text-import)).
- **`src/server/text-imports.d.ts`** tells the type checker that importing a `.md` file yields a string
  ([D-7](artifacts/change-decision-log.md#trivial-decisions)).
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

In this order, each wrapped in the XML tag named ([D-11](artifacts/change-decision-log.md#trivial-decisions)):

1. `<role>` — You are the content editor in 3pitor, an app for writing blog posts and other prose in markdown. Say what
   the app is for, and that this is why the help centers on writing.
2. `<writer>` — The post belongs to the writer. Keep their voice, tone, and point of view
   ([D-10](artifacts/change-decision-log.md#trivial-decisions)).
3. `<blog_posts>` — Watch for five things and raise them as suggestions: whether the title says what the post delivers,
   whether the opening gets the reader into the topic quickly, whether the headings let a reader skim and follow,
   whether the post makes one clear point, and whether the ending lands that point or tells the reader what to do next
   ([D-5](artifacts/change-decision-log.md#d-5-the-editor-watches-for-five-blog-specific-things)).
4. `<editing>` — The four levels, broad to narrow, one line each: developmental, line, copyedit, proofread. Work at the
   level the writer asks for, or from the top down.
5. `<suggest_or_change>` — For large rewrites and structural moves, suggest and explain first, and change only once the
   writer agrees. Make small, clear fixes directly: a typo, a broken sentence, a grammar slip. Edits arrive unsaved for
   the writer to review ([D-4](artifacts/change-decision-log.md#d-4-suggest-before-large-rewrites-fix-small-things-directly)).
6. `<code_in_posts>` — Code inside a post is part of the post: read it, check the prose against it, and fix it like any
   other passage. Writing software, reviewing source files, or adding a program to a post that isn't about it is outside
   what 3pitor is for. When asked, say so briefly, with that reason, and offer help with the writing
   ([D-3](artifacts/change-decision-log.md#d-3-decline-software-requests-and-steer-back-to-the-writing)).
7. `<examples>` — Three short, varied exchanges: a request for a Python script to rename files, answered with a brief
   redirect; a typo in a technical post's code sample, fixed with Edit; and "make this post better", answered with
   developmental notes and suggestions before any rewrite.
8. `<tools>` — Today's mechanics, carried over in meaning: paths are relative to the workspace and paths outside it are
   refused; Read a file before changing it; Edit changes part of a post and Write creates or replaces a whole post; only
   markdown (.md) posts can be changed; changes appear as unsaved edits the writer reviews and saves; Highlight points
   the writer at passages, which appear when the turn ends.

Wording throughout is calm and gives reasons. It uses no all-caps words such as CRITICAL, NEVER, or MUST.

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

**Why.** Without it, the type checker rejects the text import in S-2 with TS2307, because Bun's bundled types declare
`*.txt` and `*.toml` but not `*.md`.

**Decision.** [D-7](artifacts/change-decision-log.md#trivial-decisions)

### S-2: `src/server/chat/agent/system-prompt.md` — Added

**Target state.** `system-prompt.md` exists beside `agent.ts` and holds every word of the fixed system prompt, in the
eight tagged sections listed under Target State. `agent.ts` imports it with `with { type: 'text' }`, so the compiled
`build/3pitor` carries its text. Editing it needs a server restart in development and a rebuild for the binary.

**Behavior.** Changing, through S-3. The model is given different instructions. Settled by the three escalations
recorded in D-3, D-4, and D-5.

**Why.** The prompt's prose needs a markdown code fence for one of its examples, which a template literal cannot hold
cleanly, and the prose should change without a test changing with it.

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
   says that's outside what 3pitor is for and offers help with a post instead. The same goes for reviewing a source file
   or adding a function to code. Code already inside a post stays fair game. Operator's answer: "recommended"
   ([D-3](artifacts/change-decision-log.md#d-3-decline-software-requests-and-steer-back-to-the-writing)).
2. **Broad requests get suggestions before rewrites.** Asked to "make this post better", the AI starts with notes on
   structure and argument and rewrites whole sections only once the writer agrees. Typos and grammar slips it still
   fixes directly. Operator's answer: "recommended"
   ([D-4](artifacts/change-decision-log.md#d-4-suggest-before-large-rewrites-fix-small-things-directly)).
3. **The AI raises blog craft points on its own.** It checks the title, the opening, the headings, whether the post has
   one clear point, and the ending, and offers these as suggestions. Operator's answer: "recommended"
   ([D-5](artifacts/change-decision-log.md#d-5-the-editor-watches-for-five-blog-specific-things)).

The skills list reads the same to the model apart from its tags. The tool mechanics carry over in meaning.

## Change Units

### Unit 1: Move today's prompt into its own file, unchanged

**What it does.** Adds the type declaration (S-1) and a `system-prompt.md` holding today's three fixed lines exactly.
`instructionsFor` imports the file and joins it to today's skills section in today's form:
`${systemPrompt.trimEnd()}\n\nSkills. <today's sentence>\n${lines}`. The assembled prompt is byte-for-byte what it is
today, so this unit changes nothing the model sees.

**Delta entries.** S-1, S-2 (with today's text), S-3 (structure only).

**How you know it worked.** The existing `agent.test.ts` tests pass without being edited, because the output is
identical. `node_modules/.bin/tsc -p .` prints nothing. `make check-build` still passes, which confirms the compiled
binary starts with the embedded file.

### Unit 2: Write the editor brief and wrap the skills section

**What it does.** Replaces the text of `system-prompt.md` with the eight sections under Target State. Changes the join to
the pinned `<skills>` form. Updates the first test in `agent.test.ts` to import `system-prompt.md` and assert the pinned
join with the skills intro spelled out, so the test checks the assembly without copying the prose
([D-6](artifacts/change-decision-log.md#d-6-the-test-pins-the-join-by-importing-the-same-file)). Renames that test to
"instructs the model as the blog content editor, then lists the app and workspace skills". The second test is unchanged.

**Delta entries.** S-2 (new text), S-3 (new join).

**Ordering constraint.** After Unit 1, which puts the file and the import in place.

**How you know it worked.** `make test-server` passes. The prompt file has no all-caps CRITICAL, NEVER, or MUST.

### Unit 3: Check the new prompt by hand against real requests

**What it does.** Runs these requests in the chat panel against the fixture workspace, with a technical post open where
it applies:

1. "Write a Python script to rename my files."
2. "Add a function to a source file."
3. "Review this code file."
4. "Fix the typo in this post's code sample."
5. "Make this post better."

Then adds a rule to `system-prompt.md` only for a request whose answer is wrong, with the reason stated. No rule is added
in advance.

**Delta entries.** None, unless a failure calls for a wording change in S-2.

**Ordering constraint.** After Unit 2.

**How you know it worked.** Requests 1 to 3 get a short decline and an offer to help with the writing, with no code
written in chat and no file edited. Request 4 fixes the typo in the post and leaves the rest of the sample alone.
Request 5 gets notes and suggestions before any rewrite.

## Risks

- **The model answers differently than intended.** No test can show this without running the live model. Unit 3 is the
  early check, and it runs before the branch merges. Blast radius: every chat turn.
- **The compiled binary misses the file.** The architect confirmed a `bun build --compile` binary carries the text of a
  `.md` text import after the source file is deleted. `make check-build` in Unit 1 confirms it for this app.
- **A skill follows its steps less closely.** The skills intro keeps "follow its instructions exactly" word for word, so
  this risk comes only from the new surrounding text. The collaborative-draft-editing run in Unit 3's request 5, if
  invoked, would show it.
- **A longer prompt costs more per turn.** Prompt caching is off
  ([C-7](artifacts/current-state-findings.md#c-7-prompt-caching-is-not-turned-on)), so every turn pays for the whole
  prompt. Keeping the file short is the control.

## Deferred (YAGNI)

### A Bun macro for the prompt file

**Why deferred:** simpler-version test. The app's skill files use a macro because it globs a folder
([C-8](artifacts/current-state-findings.md#c-8-markdown-content-reaches-the-compiled-build-through-a-bun-macro)). One
prompt at one fixed path needs only a text import.
**Reopen when:** the prompt's path becomes computed, or several prompt files need to be found by globbing.
**Source:** software-architect, and the run's own weighing of C-8.

### A test that fails on all-caps words in the prompt

**Why deferred:** evidence test. No prompt in this repo has used shouted wording, so a guard has no failure to catch yet.
**Reopen when:** an all-caps rule appears in a prompt change.
**Source:** software-architect.

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
outside it (`artifacts/scope-boundary.md`, Operator-Stated Scope). The research also prescribes a hand-run check.
You can reinstate this, and your saying so is the justification it would record.

### Aligning the title-writer helper and the collaborative-draft-editing skill

**What it would have done:** bring the title-writer's one-line prompt and the skill's wording into the new editor voice.
Without it, those two keep their current wording.
**Why cut:** the confirmation turn asked about both, and the operator kept the area to the main prompt and its test
(`artifacts/scope-boundary.md`, Operator-Stated Scope). You can reinstate either.

## Open Items

None.

## Review Findings

<!-- filled after the review round -->

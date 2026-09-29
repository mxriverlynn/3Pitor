# Current State Findings: Content editor system prompt

## Provenance

Two sources, on 2026-09-29.

1. **Extracted from a prior report.** `docs/research/content-editor-system-prompt.md` (commit `6d8bdfd`). Its codebase
   sources A8 to A15 were produced by `han-core:codebase-explorer` and re-read by `han-core:adversarial-validator` (its
   V1, V2, V3, V7, V12), which confirmed the line anchors and narrowed the tool-description claim. Those are carried here
   as C-1 to C-7, with the report's source ID noted on each.
2. **This run's own sweep.** The area is one function and its test, so no structural or behavioral discovery round was
   dispatched: the prior report already read every file the area touches. The run read the bundling setup, the
   end-to-end check, and recent history itself, and added C-8 to C-11.

## Project Context

- **Stack:** Bun (TypeScript runtime and bundler), the Vercel AI SDK `ai` 7 with `@ai-sdk/anthropic`, Hono on the
  server, React and ProseMirror in the browser. Unit tests run with `bun test` (`make test-server`, `make test-ui`). A
  model-driven end-to-end check runs with `bun run check`. `make build` compiles the server into one executable,
  `build/3pitor`.
- **Conventions source:** none found. There is no CLAUDE.md and no `project-discovery.md`. Conventions are inferred from
  the surrounding code: one short comment above each function, feature folders under `src/server/`, tests beside the
  file they test.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** in the last 90 days, `agent.ts` and `agent.test.ts` changed only in `6b87b30` ("Move the server into
  feature and component folders"). `tools.ts` changed in `206c16d` (folder tree) and `14c39e6` (task list checkboxes).
  `workspace-config/` changed only in the folder move.

## Gaps

- No ADR or coding standard covers prompt wording, where prompt text lives, or how prompts are tested.
- No existing file in the repo imports text with `with { type: 'text' }`. The only precedent for putting file content
  into the compiled build is the Bun macro in C-8.
- No end-to-end scenario checks how the AI answers a request that isn't about writing.

## Findings

### C-1: The main prompt is one role sentence, tool mechanics, and the skill list

- **Claim:** `instructionsFor(skills)` builds the whole system prompt from a fixed three-line template string followed
  by a generated skill list. The fixed part names the role in one sentence and spends the rest on tool mechanics. It
  says nothing about editing method, blog craft, or requests that aren't about writing.
- **Location:** `src/server/chat/agent/agent.ts`, `instructionsFor`, lines 103-113
- **Evidence:**

  ```ts
  function instructionsFor(skills: Skill[]): string {
    const base = `You are the writing assistant inside 3pitor, an editor for blog posts written in markdown. The user's posts are files in the workspace folder. Every file path you give a tool is relative to that folder; paths outside it are refused.
  Read a file before you change it. Use Edit to change part of a post and Write to create or replace a whole post. Only markdown (.md) posts can be changed. Your changes appear in the user's editor as unsaved edits, and the user reviews and saves them.
  Use Highlight to point the user at the passages of a post you are talking about; they appear highlighted in the editor when your turn ends.`;
    // Never empty, because the app's own skills are always listed.
    const lines = skills.map((s) => `- ${s.name} (${s.path}): ${s.description}`);
    return `${base}

  Skills. When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly. Links inside a skill are relative to its SKILL.md's folder; Read them with the same prefix.
  ${lines.join('\n')}`;
  }
  ```

- **Raised by:** research report A8; validator V1
- **Confidence:** Verified
- **Bears on:** S-1, S-2, D-1, D-2

### C-2: The prompt is rebuilt every turn and handed to `streamText` as `instructions`

- **Claim:** `agentSettings` reads the workspace config on every call and returns `instructions: instructionsFor(config.skills)`.
  `Sessions.chat` spreads that result into `streamText`. So the prompt text is a pure function of the skill list, and
  the skill list is the only part that changes between turns.
- **Location:** `src/server/chat/agent/agent.ts:44-64`; `src/server/chat/sessions/sessions.ts:66-70`
- **Evidence:**

  ```ts
  return {
    model,
    instructions: instructionsFor(config.skills),
    tools: { ...files, Task: taskTool(config.agents, model, files, ownerId, report) },
  };
  ```

  ```ts
  const result = streamText({
    ...(await agentSettings(this.options, this.events, sessionId, turn, writer)),
    messages,
  ```

- **Raised by:** codebase-explorer D2; this run's read
- **Confidence:** Verified
- **Bears on:** S-2, D-2

### C-3: Each turn adds only the open file's name

- **Claim:** When a file is open, the user message gains one sentence naming it. Nothing else about the writer or the
  post reaches the model per turn.
- **Location:** `src/server/chat/sessions/sessions.ts:54-62`
- **Evidence:**

  ```ts
  { type: 'text', text: `The file open in my editor is ${openFile}. When my message does not name a file, it means this file.` },
  ```

- **Raised by:** research report A9
- **Confidence:** Verified
- **Bears on:** D-4

### C-4: Read and Glob cover any workspace file; only writes are limited to markdown, with any content

- **Claim:** Read is described as reading "a file in the workspace" and reads non-post files from disk. Glob lists any
  workspace files. Write and Edit go through `resolvePost`, which refuses anything but a `.md` file outside dot-folders,
  but accepts any content, including a code block. So the model can read source code in the workspace and can put a
  program into a post; only the prompt can shape either.
- **Location:** `src/server/chat/tools/tools.ts:66-79`, `:109-110`, `:152-160`
- **Evidence:**

  ```ts
  const Read = tool({
    description: 'Read a file in the workspace and return its text.',
  ```

  ```ts
  const Glob = tool({
    description: 'List the workspace files matching a glob pattern, such as **/*.md, one path per line.',
  ```

  ```ts
  if (!target.endsWith('.md') || segments.some((s) => s.startsWith('.'))) {
    throw new Error(`${filePath} is not a markdown post`);
  }
  ```

- **Raised by:** research report A10; validator V2, V12
- **Confidence:** Verified
- **Bears on:** D-3

### C-5: Subagents can only read

- **Claim:** A subagent is given only Read and Glob, and any other tool its file asks for is dropped. The built-in
  title-writer reads only.
- **Location:** `src/server/workspace-config/workspace-config.ts:32-39`, `:95`
- **Evidence:**

  ```ts
  // Subagents only read, so any other tool an agent file asks for is dropped.
  const isAgentTool = (name: string): name is AgentDef['tools'][number] => name === 'Read' || name === 'Glob';
  ```

- **Raised by:** research report A11
- **Confidence:** Verified
- **Bears on:** —

### C-6: A unit test pins the prompt's exact text

- **Claim:** The first test in `agent.test.ts` asserts the whole prompt with `toBe`, duplicating the fixed text inline.
  A second test checks the app skill line is present when the workspace has no skills of its own. Any change to the
  prompt wording breaks the first test.
- **Location:** `src/server/chat/agent/agent.test.ts:17-34`
- **Evidence:**

  ```ts
  test('instructs the model as a blog post editor that knows the app and workspace skills', async () => {
    const { instructions } = await agentSettings({ workspace: FIXTURE }, new EventBus(), 'owner-1', turnTexts(FIXTURE, {}));
    expect(instructions).toBe(
      `You are the writing assistant inside 3pitor, an editor for blog posts written in markdown. ...
  ```

- **Raised by:** research report A12; validator V1
- **Confidence:** Verified
- **Bears on:** S-3, D-5

### C-7: Prompt caching is not turned on

- **Claim:** No model call in the server sets a cache breakpoint, so the full prompt is billed as input on every turn.
- **Location:** `src/server` (a search for `cacheControl`, `providerOptions`, and `cache_control` finds nothing)
- **Evidence:** a negative search result; no code to quote.
- **Raised by:** research report A15; validator V3
- **Confidence:** Verified
- **Bears on:** D-2

### C-8: Markdown content reaches the compiled build through a Bun macro

- **Claim:** The app's own skill files are read at bundle time by a Bun macro, because the compiled `build/3pitor`
  "cannot read files through a computed path". `make check-build` exists to prove those files are inside the binary.
  This is the repo's one pattern for shipping markdown text inside the build.
- **Location:** `src/server/workspace-config/app-skills.macro.ts:1-15`; `src/server/workspace-config/workspace-config.ts:6`;
  `Makefile` (`build`, `check-build`)
- **Evidence:**

  ```ts
  // A Bun macro: it runs when Bun bundles or transpiles the file that imports it `with { type: 'macro' }`,
  // and its return value is written into that file's output. That puts the app's skills inside the
  // compiled build/3pitor, which cannot read files through a computed path. Editing src/skills/ needs a
  // server restart in dev, and a rebuild for the binary.
  ```

  ```ts
  import { appSkillFiles } from './app-skills.macro' with { type: 'macro' };
  ```

- **Raised by:** this run's sweep
- **Confidence:** Verified
- **Bears on:** S-1, D-1

### C-9: The model-driven end-to-end check has scenarios for skills and agents but none for scope

- **Claim:** `bun run check` starts the real server against a fresh workspace and drives chat turns against the real
  model, asserting on tool calls and loosely on reply text (for example, whether a reply mentions "tomatoes"). None of
  its scenarios send a request that isn't about writing.
- **Location:** `src/server/scripts/check.ts:152-259`
- **Evidence:**

  ```ts
  await scenario('skill: project skill runs', async () => {
    const turn = await chat(session.id, 'Use the doc-stats skill on notes.md.');
  ```

  ```ts
  return `task events: ${tasks.map((t) => `${t.subtype}:${t.subagentType ?? '?'}`).join(', ') || 'none'}; tools: ${toolCalls}; mentions tomatoes: ${/tomatoes/i.test(turn.text)}`;
  ```

- **Raised by:** this run's sweep
- **Confidence:** Verified
- **Bears on:** S-4, D-6

### C-10: A template literal cannot hold a markdown code fence without escaping

- **Claim:** The prompt text lives in a JavaScript template literal today. The research recommends an example exchange
  showing a typo fixed inside a post's code block. A code block is fenced with three backticks, and each backtick inside
  a template literal has to be escaped.
- **Location:** `src/server/chat/agent/agent.ts:104` (the literal); the research report's O5
- **Evidence:** the literal opens with `` const base = ` `` at line 104.
- **Raised by:** this run's sweep
- **Confidence:** Verified
- **Bears on:** D-1

### C-11: Only the agent module reads or names the prompt

- **Claim:** `instructionsFor` is private to `agent.ts`. The phrase "writing assistant" appears only in `agent.ts` and
  `agent.test.ts`. No other code depends on the prompt's text.
- **Location:** `src/server/chat/agent/agent.ts:103`; repo-wide search for "writing assistant"
- **Evidence:**

  ```text
  src/server/chat/agent/agent.ts
  src/server/chat/agent/agent.test.ts
  ```

- **Raised by:** this run's sweep
- **Confidence:** Verified
- **Bears on:** S-2

## Findings No Agent Could Audit

How the model responds to any given prompt wording cannot be checked by reading code. Only running turns against the
live model shows it, and that needs an API key and costs tokens. C-9's end-to-end check is the existing place that
happens. Every other evidence class this change touches was read directly.

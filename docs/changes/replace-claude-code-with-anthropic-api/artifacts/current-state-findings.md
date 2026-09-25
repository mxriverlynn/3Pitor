# Current State Findings: Replace Claude Code with the Anthropic API

## Provenance

Produced by this run's own discovery round on 2026-09-25. No prior findings report existed.

- `han-core:structural-analyst` (findings S1–S12)
- `han-core:behavioral-analyst` (findings B1–B18, plus the `check.ts` scenario inventory)
- `han-core:concurrency-analyst` (findings CC-1–CC-10)

The area given to all three was `src/server/` (including `scripts/`), `src/shared/wire.ts`, `src/ui/`, the fixture
workspace's `.claude/` folder, `Makefile`, `package.json`, and `README.md`. The orchestrator re-read `sessions.ts`,
`jobs.ts`, `approvals.ts`, `agent-host.ts`, `wire.ts`, `chat.tsx`, `agent-panel.tsx`, the two fixture `.claude/` files,
and `check.ts` lines 140–235 to confirm the load-bearing claims below.

## Project Context

- **Stack:** Bun 1.4.2, TypeScript 7.0.2 (`noEmit`, `strict`), Hono 4.13.9, Vercel AI SDK `ai` 7.0.114 with
  `@ai-sdk/react` 4.0.117, React 19.3, ProseMirror. The chat runs through `ai-sdk-provider-claude-code` 4.3.2, which runs
  `@anthropic-ai/claude-agent-sdk` 0.3.282. `@ai-sdk/anthropic` is not installed; its current release, 4.0.63, depends
  on `@ai-sdk/provider` 4.0.18 and `@ai-sdk/provider-utils` 5.0.47, the same versions `ai` 7.0.114 uses (checked with
  `npm view` this run).
- **Conventions source:** none found (no CLAUDE.md, AGENTS.md, or project-discovery.md). The README states the one
  structural convention in use: each server feature has a domain file with no HTTP knowledge, plus a matching
  `*.routes.ts` file. `agent-host.ts` is the only place that wires features together.
- **ADRs found:** none found under `docs/adr/`. The closest decision record is
  `docs/research/ai-session-library-for-markdown-editor.md`. It recommended the Agent SDK (its O1), and its option O5
  ("Messages API with your own agent loop") says that route loses "custom agents and slash commands … plus hooks and
  CLAUDE.md. Only skills carry over."
- **Coding standards found:** none found.
- **Recent churn:** all ten commits in the repository are dated 2026-09-25, so there is no time-series churn signal.
  The two most recent commits touching the area are `4dae15c` (split the server into per-feature files) and `079963d`
  (added `make build`, the `BUILD_DIR` detection, and the shipped `claude` binary).

## Gaps

- No ADR records the choice of the Agent SDK. The research doc is the only record, and this change reverses its
  recommendation.
- No coding standard or project-discovery file.
- No unit tests. `src/server/scripts/check.ts` is the only automated verification: an end-to-end script that needs a
  real model and credentials.
- There is no list of the tools the model can call. Claude Code supplies them, and 3pitor never names them (C-4).
- There is no system prompt anywhere in this repository (C-5).
- Uncommitted work: `src/server/workspace-config.routes.ts` has an uncommitted fix on `main` that returns empty lists
  when a workspace has no `.claude/` folder.

## Findings

### C-1: `claude.ts` is the only file that imports the Claude Code provider

- **Claim:** Every chat turn and job gets its model from `claudeModel` in `claude.ts`, which wraps `claudeCode(...)`
  from `ai-sdk-provider-claude-code`. `sessions.ts`, `jobs.ts`, and `workspace-config.routes.ts` import from
  `claude.ts`, and nothing else imports the provider.
- **Location:** `src/server/claude.ts:1-78`
- **Evidence:**
  ```ts
  import { claudeCode, type ClaudeCodeSettings } from 'ai-sdk-provider-claude-code';
  ...
  return claudeCode(options.model ?? 'haiku', {
    cwd: options.workspace,
    ...(BUILD_DIR && { pathToClaudeCodeExecutable: join(BUILD_DIR, 'claude') }),
    env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' },
    settingSources: ['project'],
    skills: 'all',
    agents: CUSTOM_AGENTS,
  ```
- **Raised by:** structural-analyst S1, behavioral-analyst B1
- **Confidence:** Verified
- **Bears on:** S-5, S-15

### C-2: `approvals.ts` imports a type from the Agent SDK directly

- **Claim:** `approvals.ts` imports `PermissionResult` from `@anthropic-ai/claude-agent-sdk` and builds values of that
  shape itself. It is a second import site for a package being removed, outside `claude.ts`.
- **Location:** `src/server/approvals.ts:4, 21-55`
- **Evidence:**
  ```ts
  import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
  ...
  resolve(
    allow
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'The user denied this action.' },
  );
  ```
- **Raised by:** structural-analyst S2, behavioral-analyst B8
- **Confidence:** Verified
- **Bears on:** S-6

### C-3: Chat and jobs differ only in the Claude Code settings they pass

- **Claim:** `Sessions.chat` and `Jobs.start` both call `claudeModel` and vary behavior only through
  `ClaudeCodeSettings` fields: `permissionMode`, `resume`, `canUseTool`, `permissionPrompts`, `maxTurns`, and
  `maxBudgetUsd`. None of these fields exists on a plain AI SDK `streamText`/`generateText` call.
- **Location:** `src/server/sessions.ts:45-56`, `src/server/jobs.ts:42-51`
- **Evidence:**
  ```ts
  // sessions.ts
  model: claudeModel(this.options, this.events, sessionId, {
    permissionMode: 'default',
    resume: session.claudeSessionId,
    canUseTool: (toolName, input, opts) => this.approvals.request(sessionId, toolName, input, opts, writer),
  }, writer),
  // jobs.ts
  model: claudeModel(this.options, this.events, job.id, {
    permissionMode: 'acceptEdits',
    permissionPrompts: 'none',
    maxTurns: limits.maxTurns ?? 10,
    maxBudgetUsd: limits.maxBudgetUsd ?? 0.5,
  }),
  ```
- **Raised by:** structural-analyst S3
- **Confidence:** Verified
- **Bears on:** S-7, S-8

### C-4: The model's tools come from Claude Code, and 3pitor never names them

- **Claim:** `claudeModel` sets no `tools`, `allowedTools`, or `disallowedTools`, so the model gets Claude Code's whole
  built-in set: Read, Edit, Write, Glob, Grep, Bash, Task, Skill, WebFetch, and others. The UI guesses at their input
  shapes.
- **Location:** `src/server/claude.ts:30-73`, `src/ui/chat.tsx:10-14`
- **Evidence:**
  ```ts
  function toolSummary(input: any): string {
    if (!input || typeof input !== 'object') return '';
    const value = input.file_path ?? input.path ?? input.skill ?? input.subagent_type ?? input.command ?? input.pattern ?? input.description;
  ```
- **Raised by:** behavioral-analyst B2, structural-analyst S6
- **Confidence:** Unverified for the exact tool list and schemas, which live inside the `claude` binary. Verified that
  3pitor declares none.
- **Bears on:** S-2, S-11

### C-5: 3pitor has no system prompt of its own

- **Claim:** No `systemPrompt`, `customSystemPrompt`, or `appendSystemPrompt` is set, so the model runs on Claude
  Code's built-in system prompt.
- **Location:** `src/server/claude.ts:30-73`; `node_modules/ai-sdk-provider-claude-code/dist/index.js:2309-2325`
- **Evidence:**
  ```js
  if (this.settings.systemPrompt !== void 0) {
    opts.systemPrompt = this.settings.systemPrompt;
  } else if (this.settings.customSystemPrompt !== void 0) { ... }
  ```
- **Raised by:** behavioral-analyst B7
- **Confidence:** Verified that none is set. Unverified: the text of Claude Code's default prompt.
- **Bears on:** S-5

### C-6: Claude Code holds the conversation history, and the browser sends only the newest message

- **Claim:** `Session` stores only an opaque `claudeSessionId`, read from `providerMetadata['claude-code'].sessionId`
  and passed back as `resume` on the next turn. The UI transport sends only the newest message's text. 3pitor keeps no
  message history.
- **Location:** `src/server/sessions.ts:7-12, 52, 64-65`, `src/server/claude.ts:75-78`, `src/ui/chat.tsx:91-96`,
  `src/server/scripts/check.ts:162-168`
- **Evidence:**
  ```ts
  // sessions.ts
  export interface Session { id: string; claudeSessionId?: string; abort?: AbortController; }
  session.claudeSessionId = claudeSessionIdOf(finalStep) ?? session.claudeSessionId;
  // chat.tsx
  // The server resumes the Claude session itself, so it only needs the newest message.
  prepareSendMessagesRequest: ({ messages }) => {
    const last = messages.at(-1)!;
    return { body: { text: last.parts.map((p) => (p.type === 'text' ? p.text : '')).join('') } };
  },
  ```
- **Raised by:** structural-analyst S9, behavioral-analyst B4
- **Confidence:** Verified
- **Bears on:** S-7, S-10, S-13

### C-7: Claude Code loads the workspace's skills and agents, and reports them in an `init` message

- **Claim:** `settingSources: ['project']` and `skills: 'all'` make Claude Code read `<workspace>/.claude/skills/*/SKILL.md`
  and `.claude/agents/*.md`. Its `system/init` message becomes the `init` HostEvent (skills, agents, slashCommands), and
  the Agent panel renders it. `workspace-config.routes.ts` scans the same folder separately, to highlight "local"
  entries.
- **Location:** `src/server/claude.ts:45-59`, `src/server/workspace-config.routes.ts`, `src/ui/agent-panel.tsx`,
  `src/fixtures/workspace/.claude/`
- **Evidence:**
  ```ts
  onSdkMessage: (message) => {
    if (message.type !== 'system' || message.subtype !== 'init') return;
    const event: HostEvent = { type: 'init', sessionId: ownerId, skills: message.skills ?? [],
      agents: message.agents ?? [], slashCommands: message.slash_commands ?? [] };
  ```
  ```md
  ---
  name: proofreader
  description: Proofreads a markdown document for spelling and grammar mistakes. Use when asked to proofread.
  tools: Read
  background: false
  ---
  ```
- **Raised by:** structural-analyst S4, S10; behavioral-analyst B5, B16, B17
- **Confidence:** Verified
- **Bears on:** S-3, S-4, S-12

### C-8: Subagents run through Claude Code's Task tool, and a Claude Code setting keeps them inside the turn

- **Claim:** `title-writer` is defined in code (`CUSTOM_AGENTS`) and `proofreader` in the workspace. Both run as Claude
  Code subagents. `background: false` and `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` stop a subagent's result from leaking
  into the next turn, and `scripts/debug-background-agents.ts` exists only to reproduce that leak.
- **Location:** `src/server/claude.ts:10-20, 42-44`, `src/server/scripts/debug-background-agents.ts`
- **Evidence:**
  ```ts
  // background: false keeps a subagent inside the turn that started it. Subagents run in the
  // background by default, so the turn can end first and the result leaks into the next turn.
  export const CUSTOM_AGENTS: NonNullable<ClaudeCodeSettings['agents']> = {
    'title-writer': {
      background: false,
      description: 'Suggests a better title for a markdown document. Use when asked for a title suggestion.',
      prompt: 'Read the document and reply with one line: "TITLE SUGGESTION: <title>". Do not edit files.',
      tools: ['Read'],
    },
  };
  ```
- **Raised by:** behavioral-analyst B6, concurrency-analyst CC-9
- **Confidence:** Verified in 3pitor. Unverified: how the `claude` binary implements the environment variable.
- **Bears on:** S-5, S-16

### C-9: Subagent progress reaches the UI as Claude Code `task` events

- **Claim:** `onTaskEvent` turns Claude Code task events into a `task` HostEvent and a `data-task` stream part.
  `chat.tsx` shows "↳ subagent … started" for `task_started`. `check.ts` requires a `task_notification` event to prove a
  subagent finished within the turn. The UI reads these fields through `any`, so the type checker cannot see them.
- **Location:** `src/server/claude.ts:60-70`, `src/shared/wire.ts:20`, `src/ui/chat.tsx` (`data-task` case),
  `src/server/scripts/check.ts:214-233`
- **Evidence:**
  ```ts
  | { type: 'task'; sessionId: string; subtype: string; description?: string; subagentType?: string }
  ```
  ```ts
  expect(tasks.some((t) => t.subtype === 'task_notification'), `subagent did not finish within the turn; ...`);
  ```
- **Raised by:** structural-analyst S4, S5, S6; behavioral-analyst B6
- **Confidence:** Verified
- **Bears on:** S-10, S-13

### C-10: Approvals hang off Claude Code's `canUseTool` callback, and the first answer wins

- **Claim:** Chat passes `canUseTool` to the provider, and Claude Code calls it before any tool that needs permission
  under `permissionMode: 'default'`. That covers edits and Bash, but not Read (the check's read scenarios never ask).
  `Approvals.request` parks a promise, emits `approval-request`, and resolves on REST, WebSocket, timeout (5 minutes),
  abort, or turn end. The first answer wins because the entry is deleted before it resolves.
- **Location:** `src/server/approvals.ts`, `src/server/sessions.ts:53, 70-71`
- **Evidence:**
  ```ts
  resolve(approvalId: string, allow: boolean): boolean {
    const pending = this.pending.get(approvalId);
    if (!pending) return false;
    this.pending.delete(approvalId);
    pending.resolve(allow);
  ```
- **Raised by:** behavioral-analyst B8, concurrency-analyst CC-1
- **Confidence:** Verified in 3pitor. Unverified: exactly which Claude Code tools ask for permission under `default`
  mode, which the `claude` binary decides.
- **Bears on:** S-6, S-7

### C-11: Jobs auto-accept edits, deny anything else, and are capped by turns, budget, and time

- **Claim:** Jobs use `permissionMode: 'acceptEdits'` and `permissionPrompts: 'none'` with no `canUseTool`. Claude Code
  enforces `maxTurns` (default 10) and `maxBudgetUsd` (default 0.5). 3pitor enforces `timeoutMs` (default 5 minutes)
  itself. Denied tool calls and running out of turns both still report `succeeded`, because `jobs.ts` never reads
  `finishReason` or the provider's `permissionDenials`.
- **Location:** `src/server/jobs.ts:36-66`
- **Evidence:**
  ```ts
  .then((result) => {
    job.status = 'succeeded';
    job.text = result.text;
    job.claudeSessionId = claudeSessionIdOf(result.finalStep);
  })
  ```
- **Raised by:** structural-analyst S3, behavioral-analyst B9, B10
- **Confidence:** Verified
- **Bears on:** S-8, S-9

### C-12: Keeping model-driven file access inside the workspace is left to Claude Code

- **Claim:** `cwd: options.workspace` is the only boundary 3pitor passes. Only the REST document API has its own
  path-escape check.
- **Location:** `src/server/claude.ts:38`, `src/server/documents.routes.ts` (`relative(workspace, path).startsWith('..')`)
- **Evidence:**
  ```ts
  cwd: options.workspace,
  ```
- **Raised by:** behavioral-analyst B3
- **Confidence:** Verified in 3pitor. Unverified: how the `claude` binary limits Bash and Write to `cwd`.
- **Bears on:** S-2

### C-13: `make build` ships the `claude` binary, and `BUILD_DIR` exists to find it

- **Claim:** The Makefile finds the platform `claude` binary (222 MB) and copies it to `build/claude`. `BUILD_DIR` in
  `workspace.ts` detects a compiled run, and `claude.ts` uses it to point the SDK at `build/claude`. `BUILD_DIR` is also
  used to find `build/fixtures/` and `build/.data/`.
- **Location:** `Makefile`, `src/server/workspace.ts:8-15`, `src/server/claude.ts:39-41`
- **Evidence:**
  ```makefile
  CLAUDE_BIN := $(shell bun -e "console.log(require.resolve('@anthropic-ai/claude-agent-sdk-' + process.platform + '-' + process.arch + '/claude'))")
  ...
  	cp $(CLAUDE_BIN) $(BUILD)/claude
  ```
- **Raised by:** structural-analyst S7, S8; behavioral-analyst B18
- **Confidence:** Verified
- **Bears on:** S-18, S-19

### C-14: Both Claude Code packages are direct dependencies

- **Claim:** `package.json` lists `@anthropic-ai/claude-agent-sdk` 0.3.282 and `ai-sdk-provider-claude-code` 4.3.2. The
  provider also pulls the Agent SDK in at 0.3.278.
- **Location:** `package.json:8-19`, `bun.lock`
- **Evidence:**
  ```json
  "@anthropic-ai/claude-agent-sdk": "0.3.282",
  "ai-sdk-provider-claude-code": "4.3.2",
  ```
- **Raised by:** structural-analyst S12
- **Confidence:** Verified
- **Bears on:** S-1, S-17

### C-15: Authentication comes from whatever Claude Code finds, and the README describes it that way

- **Claim:** 3pitor never reads `ANTHROPIC_API_KEY`. The provider forwards `ANTHROPIC_*` and `CLAUDE_*` environment
  variables to the `claude` process, which uses either a Claude Code login or the API key. A missing credential only
  shows up as a stream error on the first turn. The README says: "Authentication comes from your logged-in Claude Code
  CLI, or from `ANTHROPIC_API_KEY` if you set it."
- **Location:** `node_modules/ai-sdk-provider-claude-code/dist/index.js:1314-1371`, `README.md`
- **Evidence:**
  ```js
  var INHERITED_ENV_PREFIXES = ["ANTHROPIC_", "CLAUDE_", "AWS_", "GOOGLE_"];
  ```
- **Raised by:** behavioral-analyst B14, structural-analyst S11
- **Confidence:** Verified
- **Bears on:** S-14, S-20

### C-16: The model name is Claude Code shorthand, with the default set in two places

- **Claim:** `MODEL` defaults to `haiku` in `server.ts`, and again in `claude.ts`. Claude Code turns `haiku` into a
  full model id. `debug-background-agents.ts` never passes `model`.
- **Location:** `src/server/server.ts:19`, `src/server/claude.ts:37`, `src/server/scripts/debug-background-agents.ts:7`
- **Evidence:**
  ```ts
  const host = createAgentHost({ workspace, model: process.env.MODEL ?? 'haiku' });
  return claudeCode(options.model ?? 'haiku', { ... });
  ```
- **Raised by:** behavioral-analyst B15
- **Confidence:** Verified
- **Bears on:** S-5, S-14

### C-17: `check.ts` pins twelve end-to-end behaviors

- **Claim:** The check runs twelve scenarios against a live server. Scenarios 2, 3, 4, 8, and 9 assert
  Claude-Code-specific fields: `claudeSessionId`, the `init` event's `slashCommands`, and `task_notification`.
- **Location:** `src/server/scripts/check.ts:135-285`
- **Evidence:** The scenarios, with what each one asserts:
  1. documents: save and load over REST: the saved file reads back byte for byte.
  2. chat: streams a reply that reads a document: no stream errors, the reply matches `/garden plan/i`, and a
     `data-session` part carries a `claudeSessionId`.
  3. config: `init` lists `doc-stats` in skills, `proofreader` and `title-writer` in agents, and `doc-stats` in
     slashCommands.
  4. chat: second turn resumes: the reply remembers turn 1, and `claudeSessionId` is unchanged.
  5. approval over REST: a `data-approval` fires, and after it is allowed `notes.md` contains the new line.
  6. denial over WebSocket: `notes.md` is unchanged, and an `approval-resolved` event with `allow:false` is seen.
  7. skill: the reply matches `/DOC-STATS:/`.
  8. filesystem subagent: `subagentType === 'proofreader'` or "PROOFREADER REPORT" appears, and a `task_notification`
     task event is seen.
  9. code-defined subagent: the same checks for `title-writer` and "TITLE SUGGESTION".
  10. cancel: the turn stops before finishing, and a follow-up turn on the same session replies "READY".
  11. job: the job reaches `succeeded`, and `summary.md` exists and is not empty.
  12. job timeout: a job with `timeoutMs: 4000` reaches `timed-out`.
- **Raised by:** behavioral-analyst (scenario inventory)
- **Confidence:** Verified
- **Bears on:** S-13, S-21, and the plan's Change Units

### C-18: A cancelled turn may show an error bubble, which the check tolerates

- **Claim:** On abort, the provider adds an `error` stream part. `sessions.ts` swallows the abort itself. The cancel
  scenario reports the error count without asserting it.
- **Location:** `src/server/sessions.ts:62-73`, `src/server/scripts/check.ts:235-254`
- **Evidence:**
  ```ts
  } catch (error) {
    aborted = abort.signal.aborted;
    if (!aborted) throw error;
  }
  ```
- **Raised by:** behavioral-analyst B11, concurrency-analyst CC-6
- **Confidence:** Unverified whether `finalStep` rejects on abort under `@ai-sdk/anthropic`, since the package was not
  installed to inspect.
- **Bears on:** S-7

### C-19: Chat turns and jobs share one workspace with no coordination, and jobs have no concurrency limit

- **Claim:** Chat turns, jobs, and the documents PUT route can all write the same file at once. Nothing bounds how many
  jobs run.
- **Location:** `src/server/agent-host.ts`, `src/server/jobs.ts:24-68`, `src/server/documents.routes.ts:25-29`
- **Evidence:** `const jobs = new Jobs(options, events);` shares the same `options.workspace` as `Sessions`.
- **Raised by:** concurrency-analyst CC-7, CC-8
- **Confidence:** Verified
- **Bears on:** Cut for Scope (the problem exists today and is unaffected by the provider choice)

### C-20: A dropped connection does not cancel its turn, and chat turns have no time limit

- **Claim:** The chat route never ties the request's abort signal to `session.abort`, and `Sessions.chat` has no
  timeout. A closed tab leaves the session answering 409 until the model finishes.
- **Location:** `src/server/sessions.routes.ts:11-18`, `src/server/sessions.ts`
- **Evidence:** `return createUIMessageStreamResponse({ stream: sessions.chat(c.req.param('id'), text) });`
- **Raised by:** concurrency-analyst CC-2, CC-3
- **Confidence:** Verified
- **Bears on:** Cut for Scope

### C-21: `turn-finished` is not emitted when a turn fails with a real error

- **Claim:** A non-abort error is rethrown inside `catch`, so the `data-session` write and the `turn-finished` emit
  after the `finally` block are skipped.
- **Location:** `src/server/sessions.ts:62-75`
- **Evidence:** see C-18.
- **Raised by:** concurrency-analyst CC-5
- **Confidence:** Verified
- **Bears on:** S-7 (kept as-is, D-16)

### C-22: Every WebSocket client receives every event and can answer any approval

- **Claim:** The event socket forwards all events without filtering by session, and `approvals.resolve` accepts any
  `approvalId`. One throwing `ws.send` stops the rest of the fan-out.
- **Location:** `src/server/events.routes.ts:14-24`, `src/server/events.ts:14-16`
- **Evidence:**
  ```ts
  emit(event: HostEvent) {
    for (const listener of this.listeners) listener(event);
  }
  ```
- **Raised by:** behavioral-analyst B13, concurrency-analyst CC-10
- **Confidence:** Verified
- **Bears on:** Cut for Scope

## Findings No Agent Could Audit

- **The `claude` binary's internals:** its built-in tool list and schemas, its default system prompt, how it limits
  Bash and Write to `cwd`, which tools ask for permission, and how it implements `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`.
  The binary is compiled and was not decompiled. This matters less than it might, because the target state stops using
  all of it. It matters for knowing what "same behavior" means, and the plan settles that feature by feature (D-N
  entries) rather than by parity with an unread binary.
- **`@ai-sdk/anthropic` 4.0.63 runtime behavior:** its abort semantics, its provider metadata, and its model id
  handling. The package is not installed. Closing this takes installing it and running the check.
- **Bun's `ServerWebSocket.send` on a closing socket** (CC-10): this is native code.

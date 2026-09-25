# Change Decision Log: Replace Claude Code with the Anthropic API

This file records every decision committed while planning the change. The plan is
[../change-plan.md](../change-plan.md). Evidence about today's code is in
[current-state-findings.md](current-state-findings.md) as C-N findings. The scope is in
[scope-boundary.md](scope-boundary.md).

## Trivial decisions

- D-16: Keep today's error and cancel handling around the chat loop — a real error still skips `data-session` and
  `turn-finished` (C-21), and a stopped turn may still show an error bubble (C-18); this change does not make either
  worse and fixing them is outside the request. — Referenced in plan: Target State.

## Full decisions

### D-1: `agent.ts` replaces `claude.ts` and returns the settings chat and jobs share

- **Question:** What replaces `claudeModel`, the one function chat and jobs use to get a model today?
- **Decision:** A new `src/server/agent.ts` exports
  `agentSettings(options, events, ownerId, writer?): Promise<{ model, instructions, tools }>`, built on
  `anthropic(...)` from `@ai-sdk/anthropic` 4.0.63. Chat spreads it into `streamText`, and jobs spread it into
  `generateText`, each adding its own `messages` or `prompt`, `stopWhen`, `abortSignal`, and, for chat, `toolApproval`.
  `claude.ts`, `@anthropic-ai/claude-agent-sdk`, and `ai-sdk-provider-claude-code` are removed.
- **Rationale:** Chat and jobs already share one settings function and add their own options (C-3). Keeping that shape
  keeps both callers' changes small. The operator named the provider.
- **Evidence:** C-1, C-3, C-14. Operator request in scope-boundary.md. `npm view @ai-sdk/anthropic` shows 4.0.63 on
  `@ai-sdk/provider` 4.0.18, which is the same version `ai` 7.0.114 uses.
- **Behavior impact:** Changing, through D-4 and D-12. The function itself is a restructure.
- **Rejected alternatives:**
  - Inline the settings in `sessions.ts` and `jobs.ts` — rejected because it duplicates the tools, instructions, and
    `Task` wiring in two files, which is C-3's duplication with more lines.
  - Keep `ai-sdk-provider-claude-code` as a fallback — rejected because the operator said to remove it entirely
    (scope-boundary.md, Direction of Travel).
- **Revisit criterion:** A third caller that needs a different tool set.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-5, S-15, S-17
- **Dependent decisions:** D-2, D-4, D-10, D-12
- **Referenced in plan:** Target State, Surface Delta

### D-2: The model gets four file tools and nothing else

- **Question:** Which tools does the model get, now that Claude Code's built-in set is gone?
- **Decision:** `Read`, `Write`, `Edit`, and `Glob`, with the input schemas and results pinned in the plan's Target
  State, in `src/server/tools.ts`. The names and field names match Claude Code's. Bash, Grep, WebFetch, WebSearch, and
  every other Claude Code tool are dropped.
- **Rationale:** These four cover reading, finding, changing, and creating posts. Matching Claude Code's names keeps
  `chat.tsx`'s `toolSummary` and the fixture agent's `tools: Read` working with no translation.
- **Evidence:** C-4, C-17 (scenarios 2, 5, 6, 7, and 11 use Read, Edit, and Write). Operator answer to question 1:
  "drop commands. the entire point of this project is to be a blog post editor. we're not writing code. we're not
  running CLI tools. we're editing blog posts in markdown files. anything outside of that scope can be dropped".
- **Behavior impact:** Changing. The chat can no longer run commands, search contents, or fetch the web. Operator
  answer quoted above.
- **Rejected alternatives:**
  - Keep Bash behind approval — rejected by the operator, and because 3pitor cannot keep a shell command inside the
    workspace (C-12).
  - Read, Write, and Edit only, without Glob — rejected because the model could no longer find posts it isn't told
    about by name, which works today.
  - Separate list and glob tools — rejected because one Glob tool covers both.
- **Revisit criterion:** A blog-editing task that needs content search across many posts.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-3, D-6, D-10
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes, Cut for Scope

### D-3: One function keeps every tool path inside the workspace

- **Question:** Who stops the model from reading or writing outside the workspace, now that Claude Code doesn't?
- **Decision:** `resolveInWorkspace(workspace, filePath): string` in `tools.ts` checks real paths:
  1. The workspace is `realpath`'d once.
  2. The target is resolved against the workspace and `realpath`'d. A target that doesn't exist yet uses its nearest
     existing parent's `realpath`, with the rest of the path joined back on.
  3. It throws `Error(\`${filePath} is outside the workspace\`)` when `relative(realWorkspace, realTarget)` starts with
     `..` or is absolute.

  `Read`, `Write`, and `Edit` call it. `Glob` rejects an absolute pattern or a `..` segment, scans with the workspace
  as its working directory, and drops any match that fails `resolveInWorkspace`.
- **Rationale:** One function is the single place to audit containment. A check on the path text alone lets a symlink
  inside the workspace lead out of it. Both sides are `realpath`'d, because a workspace path like `/tmp/...` on macOS
  is really `/private/tmp/...`.
- **Evidence:** C-12. `documents.routes.ts` uses `relative(workspace, path).startsWith('..')`. adversarial-security-analyst
  SEC-001, reproduced on Bun 1.4.2: `ws/posts/link -> ../../outside` let a text-only check read and write outside the
  workspace, and `Bun.Glob` listed files behind the link.
- **Behavior impact:** Preserving. Model file access stays inside the workspace, as Claude Code kept it.
- **Rejected alternatives:**
  - A check on the path text only — rejected because of SEC-001.
  - Share one function with `documents.routes.ts` — deferred (plan, Deferred (YAGNI)), because that route works and
    this change doesn't touch it.
- **Revisit criterion:** A third place that takes file paths.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

### D-4: 3pitor writes its own instructions for a blog post editor

- **Question:** What instructions does the model get, now that Claude Code's built-in prompt is gone?
- **Decision:** The text pinned in the plan's Target State. It says the assistant works inside a blog post editor, that
  paths are relative to the workspace, to read before changing, when to use Edit versus Write, and that denied edits
  should not be retried. When the workspace has skills, it lists them, one line each as
  `- {name} ({path}): {description}`, with the rule to Read the skill file first when a request matches one or the user
  types `/<name>`.
- **Rationale:** The model needs to know its tools' rules and where skills live. The operator's scope statement names
  the product as a blog post editor.
- **Evidence:** C-5 (no prompt exists in 3pitor today). C-7 (skills). Operator scope statement.
- **Behavior impact:** Changing. Replies read differently from Claude Code's. This follows from removing Claude Code,
  and the operator approved the model change in D-12.
- **Rejected alternatives:**
  - Copy Claude Code's prompt — rejected because its text is inside the `claude` binary and was never read (C-5).
- **Revisit criterion:** The check's tool scenarios start failing, or replies need a house style.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-9
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-5: Each session keeps its own message history and forgets stopped turns

- **Question:** How does the chat remember earlier turns, now that Claude Code's session resume is gone?
- **Decision:** `Session` is `{ id, messages: ModelMessage[], abort? }`. Each turn sends `session.messages` plus the new
  user message. After awaiting `responseMessages`, whether it resolved or threw, the turn counts as stopped when
  `abort.signal.aborted` is true. Only a turn that finished and was not stopped updates history, to that list plus
  `responseMessages`. The `aborted` flag on the wire uses the same test. `claudeSessionId` is removed from `Session`, `data-session`,
  `turn-finished`, and `Job`. The browser keeps sending only the newest message's text. Check scenario 2 drops its
  session-id assertion, and scenario 4 keeps only its "remembers turn 1" assertion.
- **Rationale:** Holding history on the server changes nothing in the browser's request or the check's request format.
  Forgetting stopped turns avoids saving half an answer, or an edit request that never got an answer.
- **Evidence:** C-6, C-17 (scenarios 2, 4, and 10), C-18. `StreamTextResult.responseMessages` exists in `ai` 7
  (`node_modules/ai/dist/index.d.ts:2937`). junior-developer JD-001, confirmed this run: `streamText` rejects only when
  no step has finished (`node_modules/ai/dist/index.js:10540`), so after one step a stop resolves normally, and a
  `catch` alone misses it. Operator answer to question 3: "use recommendation".
- **Behavior impact:** Changing. A stopped turn is forgotten, and the session id leaves the wire. Operator: "use
  recommendation".
- **Rejected alternatives:**
  - The browser sends the whole history — rejected because the browser's messages carry data and approval parts that
    need converting, and it would change `chat.tsx`'s transport and the check's request format.
  - Keep the user's message from a stopped turn — offered to the operator, who chose the recommendation.
- **Revisit criterion:** A context-length error, or a need for chats to survive a restart.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-10, S-13
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-6: Approvals run inside the tool loop and `Approvals` returns a yes or no

- **Question:** How is an edit gated for approval without Claude Code's `canUseTool`?
- **Decision:** `streamText` gets a `toolApproval` function. For `Edit` and `Write`, it awaits
  `approvals.request(sessionId, toolName, input, abort.signal, writer): Promise<boolean>`, and returns `'approved'` or
  `{ type: 'denied', reason: 'The user denied this action.' }`. For every other tool it returns `'not-applicable'`. The
  turn's signal is passed in through the closure, because the approval function receives none. `Approvals` stops
  importing `PermissionResult`. Its first-answer-wins map, timeout, and REST, WebSocket, and turn-end handling are
  unchanged. Jobs pass no `toolApproval`.
- **Rationale:** The AI SDK awaits this function inside the running loop before executing the tool, and a denial
  becomes a result the model sees. That keeps 3pitor's model of a parked promise answered from anywhere.
- **Evidence:** C-2, C-10, C-17 (scenarios 5 and 6). `ToolApprovalStatus` and the approval function types are in
  `node_modules/ai/dist/index.d.ts:3186-3215`. `toolApproval` is accepted by `streamText` and `generateText`
  (`index.d.ts:3708`, `5085`), both checked this run.
- **Behavior impact:** Preserving. The approval card, the events, and the REST and WebSocket answers keep their shape.
- **Rejected alternatives:**
  - The AI SDK's `'user-approval'` flow — rejected because it ends the stream and needs the browser to send the answer
    in a new request. That breaks "one turn, one request", and check scenarios 5 and 6.
  - Await the approval inside `Edit.execute` and `Write.execute` — rejected because it ties the file tools to chat
    sessions, and forces jobs to pass a stand-in approver.
- **Revisit criterion:** A second kind of tool that needs approval.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6, S-7
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

### D-7: Jobs keep a step limit and a time limit and lose the dollar limit

- **Question:** How are jobs bounded without Claude Code's `maxTurns` and `maxBudgetUsd`?
- **Decision:** `JobLimits` is `{ maxTurns?, timeoutMs? }`. `maxTurns` becomes `stopWhen: stepCountIs(maxTurns ?? 10)`,
  and `timeoutMs` is unchanged at a default of 5 minutes. `maxBudgetUsd` is removed from `JobLimits`, `jobs.routes.ts`,
  and the README. A request that includes it has it ignored.
- **Rationale:** The Anthropic API has no spending cap. Estimating cost would need a price list someone keeps up to
  date by hand. The jobs panel never sends a dollar limit.
- **Evidence:** C-11. Operator answer to question 2: "drop".
- **Behavior impact:** Changing. Jobs have no dollar limit. Operator: "drop".
- **Rejected alternatives:**
  - Estimate cost from token usage — offered to the operator, who dropped the limit.
- **Revisit criterion:** A job that costs more than expected, or a request for a spending cap.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8, S-9
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-8: One loader reads skills and agents for both the route and the model

- **Question:** Who reads `.claude/skills` and `.claude/agents` now that Claude Code doesn't?
- **Decision:** `loadWorkspaceConfig(workspace)` in a new `src/server/workspace-config.ts`, following the loader
  contract pinned in the plan's Target State. `tools` is a comma-separated string only. A field of the wrong type counts
  as missing, and a file that fails to parse is skipped. `CODE_AGENTS` moves here from `claude.ts`. The route returns the loader's
  names, byte-identical to today for the fixture workspace.
- **Rationale:** Two callers need the same list, which passes the evidence test. It also gives the routes file the
  domain file the README convention expects.
- **Evidence:** C-7, C-17 (scenarios 3, 7, 8, and 9). The README's per-feature convention. `Bun.YAML` exists in the
  installed Bun (checked by software-architect).
- **Behavior impact:** Preserving for the route.
- **Rejected alternatives:**
  - Accept `tools` as a YAML list as well — rejected as a YAGNI candidate (junior-developer JD-009). The only file
    agent uses the string form.
  - Let a parse error throw — rejected because one bad file would fail the route and every turn (security contract
    gap, JD-003).
  - Parse the folder separately in the route and in `agent.ts` — rejected because two scanners would have to agree on
    one layout, which C-7 shows already drifting.
- **Revisit criterion:** A third kind of workspace config, for example commands.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-4
- **Dependent decisions:** D-9, D-10
- **Referenced in plan:** Target State, Surface Delta

### D-9: The Agent panel reads the workspace config and the `init` event goes away

- **Question:** What fills the Agent panel, now that Claude Code's `init` message is gone?
- **Decision:** Remove the `init` HostEvent variant, the `data-init` part, `Chat`'s `onInit`, and `app.tsx`'s `init`
  state. `AgentPanel` takes no props, fetches `/api/workspace-config` on mount, and shows `/skill` and `@agent` chips
  with no highlight. Slash commands are dropped. Check scenario 3 asserts against `GET /api/workspace-config`.
- **Rationale:** Without Claude Code, an `init` event would carry exactly what the route returns. The highlight told
  workspace items apart from Claude Code built-ins, and there are none left.
- **Evidence:** C-7, C-17 (scenario 3). The operator's scope statement ("anything outside of that scope can be
  dropped") settles slash commands.
- **Behavior impact:** Changing. The panel fills on page load without highlights, and slash commands are gone. Settled
  by the operator's scope statement, and reported to them in the conversation.
- **Rejected alternatives:**
  - Build an `init` event per turn from the loader — rejected because it duplicates the route's data.
- **Revisit criterion:** The panel needs to show something only a running turn knows.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10, S-12, S-13
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes, Cut for Scope

### D-10: Subagents run as a nested model call with read-only tools

- **Question:** How do the proofreader and title-writer run without Claude Code's subagents?
- **Decision:** A `Task` tool in `agent.ts`, with input `{ subagent_type: z.enum(agentNames), description, prompt }`.
  `execute` emits `task_started`, then calls `generateText` with the agent's prompt as `instructions`, only its
  `Read`/`Glob` tools, `stopWhen: stepCountIs(10)`, and the tool call's `abortSignal`, and returns the text.
  `task_notification` is emitted in `finally`. The `task` wire variant narrows as the plan pins it.
  `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`, the `background` key, and `scripts/debug-background-agents.ts` are removed.
- **Rationale:** A subagent run inside an awaited tool call cannot outlive its turn, so the background-leak workaround
  has nothing left to guard. Keeping the `task_started` and `task_notification` literals means check scenarios 8 and 9,
  and the chat's "↳ subagent started" line, need no change.
- **Evidence:** C-8, C-9, C-17 (scenarios 8 and 9). Both current agents declare only `Read`. The operator's scope
  statement.
- **Behavior impact:** Changing. Subagents can only read, and their own tool calls aren't shown. Settled by the scope
  statement and the two current agents, and reported to the operator.
- **Rejected alternatives:**
  - Put each agent's prompt in the main instructions — rejected because it loses the `subagentType` and
    `task_notification` signals the check relies on, and the subagent's separate context.
  - Subagents with edit tools and nested approvals — deferred (plan, Deferred (YAGNI)).
- **Revisit criterion:** A workspace agent that needs to edit.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5, S-10, S-16
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-11: The chat panel renders 3pitor's own tool parts

- **Question:** Will tool rows still show in the chat?
- **Decision:** `chat.tsx` checks `isToolUIPart(part)` before its switch, and names the tool with
  `getToolOrDynamicToolName(part)`. It replaces the `case 'dynamic-tool': case 'tool':` branch. `toolSummary` reads
  `input.file_path ?? input.pattern ?? input.subagent_type`.
- **Rationale:** Tools defined with `tool()` arrive in the browser as `tool-<name>` parts, not as Claude Code's
  `dynamic-tool` parts. Without this, every tool row disappears.
- **Evidence:** software-architect finding N-1 (`node_modules/ai/dist/index.d.ts:2264`). `isToolUIPart` and
  `getToolOrDynamicToolName` are exported from `ai` (checked this run).
- **Behavior impact:** Preserving. The rows look as they do today.
- **Rejected alternatives:**
  - Define the tools as dynamic tools to match the old parts — rejected because it gives up the typed tool inputs for
    no gain.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-11
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

### D-12: Model defaults to `claude-sonnet-5` and accepts three shortcuts

- **Question:** Which model runs, and what can `MODEL` say, now that Claude Code's `haiku` shorthand is gone?
- **Decision:** `DEFAULT_MODEL = 'claude-sonnet-5'`. `MODEL_ALIASES = { haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5', opus: 'claude-opus-5-5' }`. `resolveModelId` returns the alias's id, or the value unchanged, or the
  default when unset or empty. `server.ts` passes `process.env.MODEL` with no default of its own.
- **Rationale:** The operator chose the default and asked for the shortcuts, mapped to the latest versions.
- **Evidence:** C-16. The ids come from the model list in the planning session's environment. They are not yet
  confirmed against the API (junior-developer JD-004), and Unit 2 checks them. Operator answer to question 4: "default to claude-sonnet-5, and accept the shortcuts mapping them
  to the latest version".
- **Behavior impact:** Changing. The default model changes from Haiku to Sonnet 5. Operator answer quoted above.
- **Rejected alternatives:**
  - Default to `claude-haiku-4-5` with full names only — offered, and the operator chose Sonnet 5 with shortcuts.
  - Look up the latest version from the API — deferred (plan, Deferred (YAGNI)).
- **Revisit criterion:** A newer model ships. Update the table.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5, S-14
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-13: Only an Anthropic API key signs in

- **Question:** How does 3pitor authenticate without Claude Code's login?
- **Decision:** The Anthropic provider reads `ANTHROPIC_API_KEY`. `server.ts` prints
  `ANTHROPIC_API_KEY is not set; chat turns and jobs will fail` at startup when it is missing, and keeps running. The
  README says only the API key works.
- **Rationale:** A Claude Code login belongs to the `claude` program, which the operator is removing. The server warns
  rather than exits, because `check.ts` starts it and some developers may run the UI without a key.
- **Evidence:** C-15. Operator request (scope-boundary.md).
- **Behavior impact:** Changing. A Claude Code login no longer works. This follows from the operator's request, and was
  reported to them in the conversation.
- **Rejected alternatives:**
  - Exit at startup without a key — rejected because it stops the server from serving documents, and the check starts
    it.
- **Revisit criterion:** A report of confusing first-turn auth errors.
- **Dissent (if any):** None.
- **Settles delta entry:** S-14, S-20
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-14: `build/` holds only the `3pitor` executable

- **Question:** What does `make build` put in `build/`?
- **Decision:** Only `build/3pitor`. The recipe removes `build/3pitor`, `build/claude`, and `build/fixtures`, then
  compiles. `CLAUDE_BIN` and both copy steps are removed. `BUILD_DIR` is removed from `workspace.ts`, and the fixture
  and `.data/` paths anchor to `src/` again.
- **Rationale:** The operator confirmed `build/` holds only `3pitor`. `BUILD_DIR` existed only to find the `claude`
  file and the fixtures beside the executable.
- **Evidence:** C-13. Operator answer to question 5: "use recommendation".
- **Behavior impact:** Changing. The built app can't seed a sample workspace when `WORKSPACE` points at a missing
  folder. Operator: "use recommendation".
- **Rejected alternatives:**
  - Keep `build/fixtures/` — offered to the operator.
  - Embed the fixtures in the executable — offered to the operator. It is more build work for a demo feature.
- **Revisit criterion:** A request to try the built app with sample posts.
- **Dissent (if any):** None.
- **Settles delta entry:** S-18, S-19
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-15: A chat turn stops after 20 model steps by default

- **Question:** How many model steps can one chat turn take? The AI SDK stops after one step unless told otherwise, and
  Claude Code set no limit on chat.
- **Decision:** `stopWhen: stepCountIs(this.options.maxSteps ?? DEFAULT_CHAT_MAX_STEPS)`, with
  `DEFAULT_CHAT_MAX_STEPS = 20` exported from `sessions.ts`. `Sessions` takes
  `SessionsOptions extends AgentOptions { maxSteps?: number }`. `AgentHostOptions` gains `maxSteps?: number`, which
  `createAgentHost` passes through. No environment variable or config file sets it yet.
- **Rationale:** A step is one model call plus the tools it runs. The check's longest chat turn (read, then edit) takes
  about three steps, so twenty leaves room for multi-post edits while still bounding a turn that loops. The operator
  asked for the limit to be a parameter a future config can supply.
- **Evidence:** software-architect V1 (`node_modules/ai/dist/index.js:6065`: the default is one step). C-20 (chat turns
  have no time limit today). Operator answer: "go with recommendation, make step limit a parameter that we will
  eventually have config for, but default to 20 for now".
- **Behavior impact:** Changing. A chat turn stops after 20 steps by default. Operator answer quoted above.
- **Rejected alternatives:**
  - 50 steps — offered to the operator.
  - No limit, via `isLoopFinished()` — offered to the operator. It matches Claude Code, but a looping turn runs until
    Stop is pressed.
  - Wire it to an environment variable now — rejected because the operator said config comes later, and no caller
    sets it yet.
- **Revisit criterion:** The config feature lands, or a real editing turn hits the limit.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-22
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-17: Edit and Write only touch markdown posts

- **Question:** Which files may the model change?
- **Decision:** `Write` and `Edit` refuse a path that doesn't end in `.md`, or that has any segment starting with `.`,
  throwing `'<file_path> is not a markdown post'`. The check runs after `resolveInWorkspace`. `Read` and `Glob` are not
  limited.
- **Rationale:** Jobs run edits with no approval. Without this, a job misled by text in a post could write
  `.git/config` or `.git/hooks/*` so that code runs on the next `git status`, or plant instructions in `.claude/`. The
  operator's scope names markdown blog posts as the only thing being edited.
- **Evidence:** adversarial-security-analyst SEC-002, junior-developer JD-008. The operator's scope statement: "we're
  editing blog posts in markdown files". Every check scenario writes only `notes.md` or `summary.md` (C-17).
- **Behavior impact:** Changing. The model can no longer change non-markdown files or anything in dot-folders. Settled
  by the operator's scope statement, and reported to them.
- **Rejected alternatives:**
  - Gate only jobs — rejected because the same rule serves chat, and one rule is simpler.
  - Deny only `.git/` and `.claude/` — rejected because a list of bad folders misses the next one, and "markdown posts
    only" is the operator's own scope.
- **Revisit criterion:** A blog needs the model to edit a non-markdown file, such as site config.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes, Review Findings

### D-18: Small bun tests cover what the end-to-end check cannot reach

- **Question:** How is the workspace boundary and the loader's failure handling verified, when `check.ts` can't reach
  them?
- **Decision:** Add `src/server/tools.test.ts` and `src/server/workspace-config.test.ts`, run by the existing
  `make test-server`, with the cases listed in S-21. Each builds its own temporary folder and needs
  no API key.
- **Rationale:** A cooperative model never tries to leave the workspace, and `check.ts` has one fixture workspace that
  has a `.claude/` folder. So an inverted boundary check or a loader that throws would pass all twelve scenarios.
- **Evidence:** test-engineer Q1 and Q2, junior-developer JD-002. `find` shows no test files in the repo today.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Add check scenarios that ask the model to escape — rejected because a model-driven attempt is not reliable, and the
    boundary is pure code.
  - Test `resolveModelId` too — deferred (plan, Deferred (YAGNI)).
- **Revisit criterion:** A third pure module with branches the check can't reach.
- **Dissent (if any):** None.
- **Settles delta entry:** S-21
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Change Units, Review Findings

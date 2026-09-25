# Change Plan: Replace Claude Code with the Anthropic API

## Why This Change

3pitor stops running Claude Code and calls the Anthropic API directly, through the Vercel AI SDK's Anthropic provider.
The operator wants 3pitor never to rely on a `claude` program, whether it is already installed or downloaded, built, or
copied in by 3pitor or `make build`. This is a decision already taken, in the operator's own words
([scope-boundary.md](artifacts/scope-boundary.md)):

> "you could skip the claude program by calling the Anthropic API directly, for example through the AI SDK's Anthropic
> provider." - that's what i want to do. i don't want to rely on claude already being installed, or being downloaded /
> built / installed by 3pitor or the makefile build process

Later in planning, the operator set the product's scope: 3pitor is a blog post editor for markdown files, and "anything
outside of that scope can be dropped."

## What Changes, In One Paragraph

Today 3pitor hands every chat turn and job to Claude Code. Claude Code supplies nearly everything the chat does: the model's tools, its instructions, the conversation memory, skills, subagents, and the permission prompts. After this change, 3pitor owns those pieces in a small amount of its own code. It defines four file tools (Read, Write, Edit, Glob) that cannot reach outside the workspace folder, and that can only change markdown posts. It writes its own instructions for a blog post editor. It keeps each chat's message history in memory. It loads workspace skills and agents from `.claude/`, and it runs subagents as a nested model call. Approvals keep working the way they do today, answered over REST or the WebSocket. The change drops everything a blog post editor does not need: shell commands, content search, web fetching, slash commands, and the job spending cap. `make build` produces a single file, `build/3pitor`.

## Current State

Almost all of the Claude Code coupling runs through one file, and two more sit outside it.

- `src/server/claude.ts` is the only file that imports the Claude Code provider. Chat and jobs get their model from its
  `claudeModel` function ([C-1](artifacts/current-state-findings.md#c-1-claudets-is-the-only-file-that-imports-the-claude-code-provider)).
- `approvals.ts` imports a type straight from the Agent SDK ([C-2](artifacts/current-state-findings.md#c-2-approvalsts-imports-a-type-from-the-agent-sdk-directly)).
- `make build` copies the 222 MB `claude` binary into `build/`, and `BUILD_DIR` exists to find it
  ([C-13](artifacts/current-state-findings.md#c-13-make-build-ships-the-claude-binary-and-build_dir-exists-to-find-it)).

What the chat can do lives in the `claude` binary, not in 3pitor:

- The model's tools and its instructions come from Claude Code, and 3pitor never names them
  ([C-4](artifacts/current-state-findings.md#c-4-the-models-tools-come-from-claude-code-and-3pitor-never-names-them),
  [C-5](artifacts/current-state-findings.md#c-5-3pitor-has-no-system-prompt-of-its-own)).
- Claude Code keeps the conversation history. 3pitor stores only an opaque session id, and the browser sends only the
  newest message ([C-6](artifacts/current-state-findings.md#c-6-claude-code-holds-the-conversation-history-and-the-browser-sends-only-the-newest-message)).
- Claude Code loads skills and agents from the workspace's `.claude/` folder and reports them in an `init` message
  ([C-7](artifacts/current-state-findings.md#c-7-claude-code-loads-the-workspaces-skills-and-agents-and-reports-them-in-an-init-message)).
- It runs subagents, with a setting that keeps them inside the turn
  ([C-8](artifacts/current-state-findings.md#c-8-subagents-run-through-claude-codes-task-tool-and-a-claude-code-setting-keeps-them-inside-the-turn)).
- Claude Code decides when to ask for approval, through a callback
  ([C-10](artifacts/current-state-findings.md#c-10-approvals-hang-off-claude-codes-canusetool-callback-and-the-first-answer-wins)).
- It enforces the job limits on turns and dollars ([C-11](artifacts/current-state-findings.md#c-11-jobs-auto-accept-edits-deny-anything-else-and-are-capped-by-turns-budget-and-time)).
- It is also the only thing keeping model file access inside the workspace
  ([C-12](artifacts/current-state-findings.md#c-12-keeping-model-driven-file-access-inside-the-workspace-is-left-to-claude-code)).

The structural property this change addresses: 3pitor's chat behavior is defined by an external program 3pitor ships
but cannot read. The fix moves each piece 3pitor needs into 3pitor's own code, and drops the rest.

`src/server/scripts/check.ts` is the only automated test. It runs twelve end-to-end scenarios against a real model
([C-17](artifacts/current-state-findings.md#c-17-checkts-pins-twelve-end-to-end-behaviors)). Five of them assert
Claude-Code-specific fields.

## Target State

After the change, three new server modules own what Claude Code owned. The existing chat, job, and approval modules
keep their jobs and lose their Claude Code settings. `agent-host.ts` stays the only place that wires features together,
and its code does not change.

### `src/server/tools.ts`: the model's file tools, kept inside the workspace

This module is the one place model-driven file access happens. It is responsible for the four tools and for refusing
any path outside the workspace. It knows nothing about chat, approvals, or events.

The tools keep Claude Code's tool names and input field names, so the UI's tool summaries and the fixture agent's
`tools: Read` line keep working with no translation
([D-2](artifacts/change-decision-log.md#d-2-the-model-gets-four-file-tools-and-nothing-else)). Input schemas are zod 4,
which is already a dependency.

| Tool | Input schema | Result |
| --- | --- | --- |
| `Read` | `{ file_path: z.string() }` | The whole file's text. A missing file throws `Error('<file_path> does not exist')`. |
| `Write` | `{ file_path: z.string(), content: z.string() }` | Writes the whole file and returns `'wrote <file_path>'`. Only a markdown post can be written (see below). |
| `Edit` | `{ file_path: z.string(), old_string: z.string(), new_string: z.string() }` | Replaces `old_string`, which must occur exactly once, and returns `'edited <file_path>'`. Zero matches throw `'old_string not found in <file_path>'`, and more than one throws `'old_string appears <n> times in <file_path>'`. Only a markdown post can be edited (see below). |
| `Glob` | `{ pattern: z.string() }` | Workspace-relative paths of matching files, sorted, one per line. An absolute pattern, or one with a `..` segment, throws `'<pattern> is outside the workspace'`. Each match is passed through `resolveInWorkspace`, and any that fail are left out. |

A tool that throws becomes an error result the model sees, and the turn continues.

```ts
export const EDIT_TOOLS = new Set(['Edit', 'Write']);
export function fileTools(workspace: string): { Read: Tool; Write: Tool; Edit: Tool; Glob: Tool };
// Throws Error(`${filePath} is outside the workspace`) when the resolved path leaves the workspace.
export function resolveInWorkspace(workspace: string, filePath: string): string;
```

`resolveInWorkspace` checks the real location on disk, not only the path text, so a symlink inside the workspace
cannot lead out of it ([D-3](artifacts/change-decision-log.md#d-3-one-function-keeps-every-tool-path-inside-the-workspace)):

1. The workspace is passed through `realpath` once, when `fileTools` is built.
2. The target is resolved against the workspace, then passed through `realpath`. A target that doesn't exist yet (a new
   file from `Write`) uses the `realpath` of its nearest existing parent folder, with the rest of the path joined back
   on.
3. The path is rejected when `relative(realWorkspace, realTarget)` starts with `..` or is absolute.

`Write` and `Edit` also refuse any path that doesn't end in `.md`, or that has a segment starting with `.`. They throw
`'<file_path> is not a markdown post'`. This keeps the model, and unattended jobs in particular, out of `.git/` and
`.claude/`, and away from anything that isn't a blog post
([D-17](artifacts/change-decision-log.md#d-17-edit-and-write-only-touch-markdown-posts)). `Read` has no such limit,
because the model reads skill files under `.claude/skills/`.

### `src/server/workspace-config.ts`: skills and agents, loaded from `.claude/`

This module reads a workspace's `.claude/` folder, adds the code-defined agents, and returns one description of both.
Two callers use it: the `/api/workspace-config` route, and `agent.ts` when it builds a turn
([D-8](artifacts/change-decision-log.md#d-8-one-loader-reads-skills-and-agents-for-both-the-route-and-the-model)).

```ts
export interface Skill { name: string; description: string; path: string }   // path: '.claude/skills/doc-stats/SKILL.md'
export interface AgentDef { name: string; description: string; prompt: string; tools: ('Read' | 'Glob')[] }
export interface WorkspaceConfig { skills: Skill[]; agents: AgentDef[] }
export const CODE_AGENTS: AgentDef[];   // [title-writer], moved from claude.ts's CUSTOM_AGENTS unchanged in wording
export function loadWorkspaceConfig(workspace: string): Promise<WorkspaceConfig>;
```

The loader contract:

- A workspace with no `.claude/` folder returns no skills and only the code agents. This keeps the uncommitted fix
  already on `main`.
- **Skills** are found by `.claude/skills/*/SKILL.md`. The name is the folder name, and `path` is the workspace-relative
  path to `SKILL.md`.
- **Agents** are found by `.claude/agents/*.md`. The name is the file name without `.md`. The agent's `prompt` is the
  body below the frontmatter, trimmed.
- **Frontmatter** is the text between a first line of exactly `---` and the next line of exactly `---`. It is parsed
  with `Bun.YAML.parse`.
- Only two frontmatter fields are read:
  - `description` is a string, or `''` when missing. Both skills and agents use it.
  - `tools` applies to agents only. It is a comma-separated string (`Read`, or `Read, Glob`). Each name is trimmed, and
    only `Read` and `Glob` are kept. A missing `tools` means `['Read', 'Glob']`.
- A field of the wrong type (for example a `description` that is a list, or a `tools` that is a number) is treated as
  missing. A file whose frontmatter fails to parse, or has no closing `---`, is skipped. One broken file never fails the
  route or a turn.
- `name`, `background`, and every other frontmatter key are ignored.
- File agents come first, sorted by name, then `CODE_AGENTS`. Skills are sorted by name.

For the fixture workspace, the route returns exactly what it returns today:

```json
{"skills":["doc-stats"],"agents":["proofreader","title-writer"]}
```

### `src/server/agent.ts`: one turn's model, instructions, and tools

This module replaces `claude.ts`. It turns the model setting into an Anthropic model, writes the instructions, and
assembles the tools, including the `Task` tool that runs subagents. Chat and jobs both call it and add their own call
options ([D-1](artifacts/change-decision-log.md#d-1-agentts-replaces-claudets-and-returns-the-settings-chat-and-jobs-share)).

```ts
export interface AgentOptions { workspace: string; model?: string }
export const DEFAULT_MODEL = 'claude-sonnet-5';
export const MODEL_ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5-5',
};
// The alias's model id, or the input unchanged, or DEFAULT_MODEL when undefined or empty.
export function resolveModelId(model: string | undefined): string;
export function agentSettings(
  options: AgentOptions,
  events: EventBus,
  ownerId: string,
  writer?: UIMessageStreamWriter,
): Promise<{ model: LanguageModel; instructions: string; tools: ToolSet }>;
```

`agentSettings` reads the workspace config on every call, so a skill added between turns shows up on the next turn, the
same as with Claude Code. It returns `anthropic(resolveModelId(options.model))`, the instructions below, and
`{ ...fileTools(workspace), Task }` ([D-12](artifacts/change-decision-log.md#d-12-model-defaults-to-claude-sonnet-5-and-accepts-three-shortcuts)).

**The instructions.** The skills block is left out when the workspace has no skills. Each skill line follows the
grammar `- {name} ({path}): {description}`. For the fixture workspace, the text is:

```text
You are the writing assistant inside 3pitor, an editor for blog posts written in markdown. The user's posts are files in the workspace folder. Every file path you give a tool is relative to that folder; paths outside it are refused.
Read a file before you change it. Use Edit to change part of a post and Write to create or replace a whole post. Only markdown (.md) posts can be changed. If the user denies a change, do not retry it.

Skills in this workspace. When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly:
- doc-stats (.claude/skills/doc-stats/SKILL.md): Report statistics about a markdown document (heading count, line count, word count). Use when the user asks for document stats.
```

([D-4](artifacts/change-decision-log.md#d-4-3pitor-writes-its-own-instructions-for-a-blog-post-editor))

**The `Task` tool** runs a subagent as a nested `generateText` call inside the tool's `execute`. The turn waits for it,
so a subagent cannot outlive the turn that started it
([D-10](artifacts/change-decision-log.md#d-10-subagents-run-as-a-nested-model-call-with-read-only-tools)).

- Input schema: `{ subagent_type: z.enum(agentNames), description: z.string(), prompt: z.string() }`. `agentNames` is
  never empty, because `CODE_AGENTS` always has `title-writer`.
- Its description lists each agent as `- {name}: {description}`.
- `execute` emits a `task_started` event, then calls `generateText` and returns the subagent's text. The call passes:
  - the agent's `prompt` as `instructions`
  - the caller's `prompt`
  - only the agent's `tools`, picked from `fileTools` (never `Edit`, `Write`, or `Task`)
  - `stopWhen: stepCountIs(10)`
  - the tool call's `abortSignal`
- `task_notification` is emitted in a `finally`, so it fires on success, error, or abort.
- Each task event is written to the turn's `writer` (when there is one) as a `data-task` part, and emitted on the event
  bus. The event is declared as `Extract<HostEvent, { type: 'task' }>`, so the compiler checks its field names against
  `wire.ts`. The tool input's `subagent_type` becomes the event's `subagentType`.

### Chat: `Sessions` keeps the conversation, `Approvals` answers yes or no

`Session` holds the conversation's messages in memory instead of a Claude session id
([D-5](artifacts/change-decision-log.md#d-5-each-session-keeps-its-own-message-history-and-forgets-stopped-turns)).

```ts
export interface Session { id: string; messages: ModelMessage[]; abort?: AbortController }
export const DEFAULT_CHAT_MAX_STEPS = 20;
export interface SessionsOptions extends AgentOptions { maxSteps?: number }   // Sessions' constructor takes this
```

The step limit is a parameter so a future config setting can supply it. Nothing sets it yet. `AgentHostOptions` gains
`maxSteps?: number`, and `createAgentHost` passes its options to `Sessions` as it does today
([D-15](artifacts/change-decision-log.md#d-15-a-chat-turn-stops-after-20-model-steps-by-default)).

One turn works like this:

1. `messages` is the session's history plus `{ role: 'user', content: text }`.
2. `streamText` runs with `agentSettings(...)`, `messages`, `stopWhen: stepCountIs(this.options.maxSteps ??
   DEFAULT_CHAT_MAX_STEPS)`, the approval gate below, and the turn's abort signal.
3. After awaiting `responseMessages`, whether it resolved or threw, the turn counts as stopped when
   `abort.signal.aborted` is true. The AI SDK only throws on a stop when no step has finished yet. After a step finishes
   it resolves normally, so the signal is the only reliable test. Only a turn that finished and was not stopped updates
   history, to `messages` plus `responseMessages`. The `aborted` value in `data-session` and `turn-finished` uses the
   same test.
4. The existing `finally` still clears `session.abort` and denies pending approvals. A real error still skips the
   `data-session` part and the `turn-finished` event, as it does today
   ([C-21](artifacts/current-state-findings.md#c-21-turn-finished-is-not-emitted-when-a-turn-fails-with-a-real-error)).

The approval gate is a `toolApproval` function on `streamText`. The AI SDK awaits it inside the running loop before a
tool runs, so a parked approval works the way `canUseTool` does today
([D-6](artifacts/change-decision-log.md#d-6-approvals-run-inside-the-tool-loop-and-approvals-returns-a-yes-or-no)):

```ts
const gate = async ({ toolCall }) => {
  if (!EDIT_TOOLS.has(toolCall.toolName)) return 'not-applicable';
  const allow = await this.approvals.request(sessionId, toolCall.toolName, toolCall.input, abort.signal, writer);
  return allow ? 'approved' : { type: 'denied', reason: 'The user denied this action.' };
};
```

```ts
// approvals.ts: the first-answer-wins map, timeout, REST/WebSocket resolve, and denyPending are unchanged.
request(sessionId: string, toolName: string, input: unknown, signal: AbortSignal, writer: UIMessageStreamWriter): Promise<boolean>;
```

The approval card's title stays `Allow <toolName>?`.

### Jobs: a step limit and a time limit

`Jobs.start` calls `generateText` with `agentSettings(...)`, `stopWhen: stepCountIs(limits.maxTurns ?? 10)`, and no
approval gate, so edits are auto-accepted. There is nothing left to deny, because the tool set has no commands
([D-7](artifacts/change-decision-log.md#d-7-jobs-keep-a-step-limit-and-a-time-limit-and-lose-the-dollar-limit)).

```ts
export interface JobLimits { maxTurns?: number; timeoutMs?: number }
```

`POST /api/jobs` takes `{ prompt, maxTurns?, timeoutMs? }`. The status mapping (`succeeded`, `failed`, `cancelled`,
`timed-out`) is unchanged.

### The wire contracts

`src/shared/wire.ts` after the change. Only the lines marked as changed differ from today:

```ts
export interface Job {
  id: string;
  prompt: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  text?: string;
  error?: string;
  // changed: claudeSessionId removed
}

export type HostEvent =
  | { type: 'approval-request'; sessionId: string; approvalId: string; toolName: string; title: string; input: unknown }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string; allow: boolean }
  // changed: subtype narrowed to two literals; description and subagentType always present
  | { type: 'task'; sessionId: string; subtype: 'task_started' | 'task_notification'; description: string; subagentType: string }
  // changed: the 'init' variant is removed
  // changed: claudeSessionId removed
  | { type: 'turn-finished'; sessionId: string; aborted: boolean }
  | { type: 'job-status'; jobId: string; status: JobStatus; error?: string };

export type ClientMessage = { type: 'approval-response'; approvalId: string; allow: boolean };   // unchanged
```

Worked examples of the stream parts the UI and the check script read:

```json
{"type":"data-session","data":{"aborted":false}}
{"type":"data-task","data":{"type":"task","sessionId":"<uuid>","subtype":"task_started","description":"Proofread notes","subagentType":"proofreader"}}
{"type":"data-approval","data":{"type":"approval-request","sessionId":"<uuid>","approvalId":"<uuid>","toolName":"Edit","title":"Allow Edit?","input":{"file_path":"notes.md","old_string":"# Garden Plan","new_string":"# Vegetable Plan"}}}
```

The `data-init` part is gone. The chat request body stays `{"text":"..."}`.

### The UI

- `chat.tsx` renders tool rows for the AI SDK's static tool parts, whose type is `tool-<name>`, using `isToolUIPart`
  and `getToolOrDynamicToolName`, both exported from `ai`. Today it only matches Claude Code's `dynamic-tool` parts, so
  without this change every tool row disappears from the chat
  ([D-11](artifacts/change-decision-log.md#d-11-the-chat-panel-renders-3pitors-own-tool-parts)).
- `toolSummary` reads `input.file_path ?? input.pattern ?? input.subagent_type`.
- `chat.tsx` drops `onInit` and the `onData` handler for `data-init`.
- `AgentPanel` fetches `/api/workspace-config` on mount and renders its skills and agents as chips. It takes no props,
  and the "local" highlight and its legend are removed
  ([D-9](artifacts/change-decision-log.md#d-9-the-agent-panel-reads-the-workspace-config-and-the-init-event-goes-away)).
- `app.tsx` drops its `init` state.

### Build, dependencies, and settings

- `package.json` adds `"@ai-sdk/anthropic": "4.0.63"`, and removes `@anthropic-ai/claude-agent-sdk` and
  `ai-sdk-provider-claude-code`.
- The `Makefile`'s `build` target compiles `build/3pitor` and nothing else. Its first step removes a stale
  `build/claude` and `build/fixtures` left by older builds
  ([D-14](artifacts/change-decision-log.md#d-14-build-holds-only-the-3pitor-executable)):

  ```makefile
  build: node_modules
  	rm -rf $(BUILD)/3pitor $(BUILD)/claude $(BUILD)/fixtures
  	bun build --compile --production src/server/server.ts --outfile $(BUILD)/3pitor
  ```

- `BUILD_DIR` is removed from `workspace.ts`. The fixture and `.data/` paths anchor to `src/` as they did before
  `make build` existed.
- `server.ts` passes `model: process.env.MODEL` with no default of its own. At startup it prints
  `ANTHROPIC_API_KEY is not set; chat turns and jobs will fail` when the key is missing, and keeps running
  ([D-13](artifacts/change-decision-log.md#d-13-only-an-anthropic-api-key-signs-in)).

## Surface Delta

### S-1: `@ai-sdk/anthropic` dependency — Added

**Target state.** `package.json` depends on `@ai-sdk/anthropic` at exactly `4.0.63`, which is built on the same
`@ai-sdk/provider` 4.0.18 and `@ai-sdk/provider-utils` 5.0.47 as `ai` 7.0.114.

**Behavior.** Preserving. Adding a package changes nothing until code imports it.

**Why.** The operator named this provider.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-agentts-replaces-claudets-and-returns-the-settings-chat-and-jobs-share)

### S-2: `src/server/tools.ts` — Added

**Target state.** `tools.ts` exists and owns every file operation the model can make. It exports `fileTools(workspace)`
with the `Read`, `Write`, `Edit`, and `Glob` tools pinned in Target State, `resolveInWorkspace(workspace, filePath)`,
and `EDIT_TOOLS`. No tool can read or write outside the workspace, including through a symlink. `Write` and `Edit` only
touch `.md` files outside dot-folders.

**Behavior.** Changing once S-7 and S-8 call it. The model can only change markdown posts (Behavior Changes, item 11).
Settled by the operator's scope statement.

**Why.** Claude Code's tools go away with Claude Code, and chat needs file tools
([C-4](artifacts/current-state-findings.md#c-4-the-models-tools-come-from-claude-code-and-3pitor-never-names-them)).

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-model-gets-four-file-tools-and-nothing-else),
[D-3](artifacts/change-decision-log.md#d-3-one-function-keeps-every-tool-path-inside-the-workspace),
[D-17](artifacts/change-decision-log.md#d-17-edit-and-write-only-touch-markdown-posts)

### S-3: `src/server/workspace-config.ts` — Added

**Target state.** `workspace-config.ts` exists and owns reading `.claude/skills` and `.claude/agents` and the
code-defined agents. It exports `loadWorkspaceConfig`, `CODE_AGENTS`, and the `Skill`, `AgentDef`, and
`WorkspaceConfig` types, following the loader contract in Target State.

**Behavior.** Preserving on its own. It returns the same names the route returns today.

**Why.** Both the route and the model's instructions need the same list, and Claude Code no longer loads it
([C-7](artifacts/current-state-findings.md#c-7-claude-code-loads-the-workspaces-skills-and-agents-and-reports-them-in-an-init-message)).

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-one-loader-reads-skills-and-agents-for-both-the-route-and-the-model)

### S-4: `workspace-config.routes.ts` — Re-scoped

**Target state.** The route is HTTP only. It returns
`{ skills: config.skills.map((s) => s.name), agents: config.agents.map((a) => a.name) }` from `loadWorkspaceConfig`.
It no longer scans `.claude/` or imports anything from `claude.ts`.

**Behavior.** Preserving. The response is byte-identical for the fixture workspace, and for a workspace with no
`.claude/` folder.

**Why.** It followed the README's routes-only convention in name only
([C-7](artifacts/current-state-findings.md#c-7-claude-code-loads-the-workspaces-skills-and-agents-and-reports-them-in-an-init-message)).

**Depends on.** S-3.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-one-loader-reads-skills-and-agents-for-both-the-route-and-the-model)

### S-5: `src/server/agent.ts` — Added

**Target state.** `agent.ts` exists and owns turning the model setting into an Anthropic model, writing the
instructions, and building the tool set, including the `Task` subagent tool. It exports `AgentOptions`,
`DEFAULT_MODEL` (`claude-sonnet-5`), `MODEL_ALIASES`, `resolveModelId`, and `agentSettings`, as pinned in Target State.

**Behavior.** Changing, once S-7 and S-8 call it:

- Replies follow 3pitor's instructions instead of Claude Code's.
- The default model is `claude-sonnet-5` instead of Haiku.
- `MODEL` accepts only full ids or the three shortcuts.

The operator approved each of these (Behavior Changes, items 3 and 4).

**Why.** It replaces what `claude.ts` supplied through Claude Code
([C-1](artifacts/current-state-findings.md#c-1-claudets-is-the-only-file-that-imports-the-claude-code-provider),
[C-5](artifacts/current-state-findings.md#c-5-3pitor-has-no-system-prompt-of-its-own),
[C-16](artifacts/current-state-findings.md#c-16-the-model-name-is-claude-code-shorthand-with-the-default-set-in-two-places)).

**Depends on.** S-1, S-2, S-3.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-agentts-replaces-claudets-and-returns-the-settings-chat-and-jobs-share),
[D-4](artifacts/change-decision-log.md#d-4-3pitor-writes-its-own-instructions-for-a-blog-post-editor),
[D-10](artifacts/change-decision-log.md#d-10-subagents-run-as-a-nested-model-call-with-read-only-tools),
[D-12](artifacts/change-decision-log.md#d-12-model-defaults-to-claude-sonnet-5-and-accepts-three-shortcuts)

### S-6: `Approvals.request` — Re-scoped

**Target state.** `Approvals.request(sessionId, toolName, input, signal, writer)` resolves to `true` (allowed) or
`false` (denied, timed out, aborted, or ended with its turn). It no longer builds Agent SDK permission results.

**Behavior.** Changing, in two small ways (Behavior Changes, item 12):

- When the model asks for two edits in one step, both approval cards appear before either edit runs. Today they may
  have come one at a time.
- The card title is always `Allow <tool>?`, because 3pitor has no custom title to pass.

The `data-approval` part, the `approval-request` and `approval-resolved` events, and REST and WebSocket answers keep
their shapes. Settled by D-6, which is how the AI SDK runs approvals (`node_modules/ai/dist/index.js:6615-6690`).

**Why.** It imports a type from a package being removed
([C-2](artifacts/current-state-findings.md#c-2-approvalsts-imports-a-type-from-the-agent-sdk-directly)).

**Migration.** Callers map `true` and `false` to the AI SDK approval status (see S-7).

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-approvals-run-inside-the-tool-loop-and-approvals-returns-a-yes-or-no)

### S-7: `Session` and `Sessions.chat` — Re-scoped

**Target state.** `Session` is `{ id, messages: ModelMessage[], abort? }`. `Sessions.chat` owns the conversation. It
sends the history plus the new message, gates `Edit` and `Write` through `Approvals`, and saves the turn to history only
when it finishes without being stopped. A turn allows up to `options.maxSteps` model steps, or
`DEFAULT_CHAT_MAX_STEPS` (20) when unset. `AgentHostOptions` carries an optional `maxSteps` that `createAgentHost`
passes through, and nothing sets it yet.

**Behavior.** Changing:

- The chat can no longer run shell commands, search file contents, or fetch the web (Behavior Changes, item 1).
- A stopped turn is forgotten (item 5).
- A turn stops after 20 model steps by default (item 8).
- The session id vanishes from `data-session` (item 6).

**Why.** Claude Code held the history and asked for approvals
([C-6](artifacts/current-state-findings.md#c-6-claude-code-holds-the-conversation-history-and-the-browser-sends-only-the-newest-message),
[C-10](artifacts/current-state-findings.md#c-10-approvals-hang-off-claude-codes-canusetool-callback-and-the-first-answer-wins)).

**Depends on.** S-5, S-6.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-each-session-keeps-its-own-message-history-and-forgets-stopped-turns),
[D-6](artifacts/change-decision-log.md#d-6-approvals-run-inside-the-tool-loop-and-approvals-returns-a-yes-or-no),
[D-15](artifacts/change-decision-log.md#d-15-a-chat-turn-stops-after-20-model-steps-by-default)

### S-8: `Jobs.start` and `JobLimits` — Re-scoped

**Target state.** `JobLimits` is `{ maxTurns?, timeoutMs? }`. `Jobs.start` runs `generateText` with `agentSettings`, a
step limit of `maxTurns ?? 10`, and no approval gate. The timeout and the status mapping are unchanged.

**Behavior.** Changing. A job has no dollar limit, and a `maxBudgetUsd` in the request is ignored (Behavior Changes,
item 2). A job can no longer even try a shell command; today, that attempt would be denied anyway.

**Why.** Claude Code enforced `maxTurns` and `maxBudgetUsd`
([C-11](artifacts/current-state-findings.md#c-11-jobs-auto-accept-edits-deny-anything-else-and-are-capped-by-turns-budget-and-time)).

**Depends on.** S-5.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-jobs-keep-a-step-limit-and-a-time-limit-and-lose-the-dollar-limit)

### S-9: `POST /api/jobs` body — Re-scoped

**Target state.** The body is `{ prompt, maxTurns?, timeoutMs? }`. `jobs.routes.ts` does not read `maxBudgetUsd`.

**Behavior.** Changing. See S-8.

**Depends on.** S-8.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-jobs-keep-a-step-limit-and-a-time-limit-and-lose-the-dollar-limit)

### S-10: `HostEvent`, `Job`, and the stream data parts in `wire.ts` — Re-scoped

**Target state.** `wire.ts` carries the union pinned in Target State:

- There is no `init` variant.
- `task` has `subtype: 'task_started' | 'task_notification'`, and always carries `description` and `subagentType`.
- `turn-finished` and `Job` have no `claudeSessionId`.
- The `data-session` part is `{ aborted }`, and there is no `data-init` part.

**Behavior.** Changing. The browser no longer receives the session id or the `init` event (Behavior Changes, items 6
and 7).

**Why.** Each removed field or variant existed only because Claude Code reported it
([C-6](artifacts/current-state-findings.md#c-6-claude-code-holds-the-conversation-history-and-the-browser-sends-only-the-newest-message),
[C-7](artifacts/current-state-findings.md#c-7-claude-code-loads-the-workspaces-skills-and-agents-and-reports-them-in-an-init-message),
[C-9](artifacts/current-state-findings.md#c-9-subagent-progress-reaches-the-ui-as-claude-code-task-events)).

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-each-session-keeps-its-own-message-history-and-forgets-stopped-turns),
[D-9](artifacts/change-decision-log.md#d-9-the-agent-panel-reads-the-workspace-config-and-the-init-event-goes-away),
[D-10](artifacts/change-decision-log.md#d-10-subagents-run-as-a-nested-model-call-with-read-only-tools)

### S-11: `chat.tsx` tool rows and `onInit` — Re-scoped

**Target state.** `chat.tsx` renders a tool row for every tool part, static or dynamic, named with
`getToolOrDynamicToolName`. `toolSummary` reads `input.file_path ?? input.pattern ?? input.subagent_type`. `Chat` has no
`onInit` prop and no `data-init` handling.

**Behavior.** Changing, slightly. Tool rows keep the same names and file paths for file tools. Using a skill used to
show as a `Skill doc-stats` row, and now shows as `Read .claude/skills/doc-stats/SKILL.md` (Behavior Changes, item 13).
Without this entry, every tool row would disappear.

**Why.** 3pitor's tools arrive as `tool-<name>` parts, not Claude Code's `dynamic-tool` parts
([D-11](artifacts/change-decision-log.md#d-11-the-chat-panel-renders-3pitors-own-tool-parts)).

**Depends on.** S-7, S-10.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-the-chat-panel-renders-3pitors-own-tool-parts)

### S-12: `AgentPanel` and `app.tsx` — Re-scoped

**Target state.** `AgentPanel` takes no props. It fetches `/api/workspace-config` on mount and shows each skill as
`/name` and each agent as `@name`, with no highlight or legend. `app.tsx` has no `init` state.

**Behavior.** Changing. The panel fills when the page loads, not after the first message. Claude Code's built-in skills
and agents no longer appear (Behavior Changes, item 7).

**Depends on.** S-4, S-10.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-agent-panel-reads-the-workspace-config-and-the-init-event-goes-away)

### S-13: `check.ts` scenarios 2, 3, and 4 — Re-scoped

**Target state.**

- Scenario 2 asserts no stream errors and a reply matching `/garden plan/i`. It no longer reads a session id.
- Scenario 3 calls `GET /api/workspace-config` and asserts `skills` includes `doc-stats` and `agents` includes
  `proofreader` and `title-writer`. Its slash-command assertion is gone.
- Scenario 4 asserts only that the second reply matches `/garden plan/i`.
- Scenarios 8 and 9 require both the task event and the report text, plus the existing `task_notification` assertion.
  The report-text check is `usedAgent && /PROOFREADER REPORT/.test(turn.text)` (and the same for `title-writer` and
  `TITLE SUGGESTION`). Today they accept either one. Now that `task_notification` fires in a `finally`, a `Task` tool
  that never runs the subagent would otherwise still pass.
- Scenarios 1, 5 through 7, and 10 through 12 are unchanged.

**Behavior.** Changing, for the check script only. See Behavior Changes, item 6.

**Depends on.** S-7, S-10.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-each-session-keeps-its-own-message-history-and-forgets-stopped-turns),
[D-9](artifacts/change-decision-log.md#d-9-the-agent-panel-reads-the-workspace-config-and-the-init-event-goes-away)

### S-14: `MODEL` environment variable and `server.ts` startup — Re-scoped

**Target state.** `server.ts` passes `process.env.MODEL` through unchanged, and `agent.ts` resolves it. When
`ANTHROPIC_API_KEY` is unset, `server.ts` prints `ANTHROPIC_API_KEY is not set; chat turns and jobs will fail` at startup
and keeps running.

**Behavior.** Changing. `MODEL=haiku` still works, and unset now means `claude-sonnet-5`. A Claude Code login no longer
signs in (Behavior Changes, items 3 and 4).

**Depends on.** S-5.

**Decision.** [D-12](artifacts/change-decision-log.md#d-12-model-defaults-to-claude-sonnet-5-and-accepts-three-shortcuts),
[D-13](artifacts/change-decision-log.md#d-13-only-an-anthropic-api-key-signs-in)

### S-15: `src/server/claude.ts` — Removed

**Target state.** `claude.ts` does not exist. `agent.ts` is responsible for choosing the model, the instructions,
and the tools. The code-defined agents live in `workspace-config.ts`. Reading the session id and translating Claude
Code's `init` and task messages went away with Claude Code.

**Behavior.** Preserving on its own. Its callers already moved in S-7 and S-8.

**Depends on.** S-7, S-8.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-agentts-replaces-claudets-and-returns-the-settings-chat-and-jobs-share)

### S-16: `src/server/scripts/debug-background-agents.ts` — Removed

**Target state.** The script does not exist, and neither does its README paragraph. A subagent now runs inside a tool
call the turn awaits, so it cannot leak into the next turn. There is no background mode to reproduce.

**Behavior.** Preserving. It is a manual developer script that nothing else calls.

**Depends on.** S-15.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-subagents-run-as-a-nested-model-call-with-read-only-tools)

### S-17: Claude Code packages — Removed

**Target state.** `package.json` and `bun.lock` contain neither `@anthropic-ai/claude-agent-sdk` nor
`ai-sdk-provider-claude-code`, nor the platform `claude` binary packages they pull in.

**Behavior.** Preserving on its own, once S-6 and S-15 have removed every import.

**Depends on.** S-6, S-15.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-agentts-replaces-claudets-and-returns-the-settings-chat-and-jobs-share)

### S-18: `Makefile` `build` target — Re-scoped

**Target state.** `make build` compiles `build/3pitor` and nothing else. It first removes any `build/claude` and
`build/fixtures` an older build left behind.

**Behavior.** Changing. `build/` holds only `3pitor`, so starting the built app with `WORKSPACE` set to a folder that
doesn't exist fails (Behavior Changes, item 9).

**Depends on.** S-17.

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-build-holds-only-the-3pitor-executable)

### S-19: `BUILD_DIR` in `workspace.ts` — Removed

**Target state.** `BUILD_DIR` does not exist. `workspace.ts` anchors the fixture and `.data/` paths to `src/`, as
before `make build` existed. Nothing needs to locate files beside the compiled executable.

**Behavior.** Preserving in development. In the compiled app it only matters with `WORKSPACE` set, which S-18 covers.

**Depends on.** S-15, S-18.

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-build-holds-only-the-3pitor-executable)

### S-20: `README.md` — Re-scoped

**Target state.** The README describes 3pitor as running on the AI SDK's Anthropic provider:

- Only `ANTHROPIC_API_KEY` signs in.
- `MODEL` takes a full id or a shortcut, and defaults to `claude-sonnet-5`.
- The file list names `agent.ts`, `tools.ts`, and `workspace-config.ts`, and not `claude.ts`.
- The Build section lists only `build/3pitor`.
- The endpoints table shows `POST /api/jobs` as `{ prompt, maxTurns?, timeoutMs? }`.
- There is no debug-script paragraph.

**Behavior.** Preserving. It is documentation.

**Depends on.** S-14, S-16, S-18.

**Decision.** [D-13](artifacts/change-decision-log.md#d-13-only-an-anthropic-api-key-signs-in)

### S-21: Unit tests for the tools and the loader — Added

**Target state.** `make test-server` runs them, using the test setup that already exists. Two test files sit next to
the modules they cover:

- `src/server/tools.test.ts` covers `resolveInWorkspace`: a normal path, `..`, an absolute path, a symlink pointing
  out, and a new file under a new folder. It also covers the markdown-only rule for `Write` and `Edit`, and `Edit`'s
  zero, one, and many match cases.
- `src/server/workspace-config.test.ts` covers the fixture workspace's output, a workspace with no `.claude/` folder, a
  `tools` list filtered to `Read` and `Glob`, a missing `tools`, a wrong-typed `description`, and an unparsable file
  being skipped.

Each test builds its own temporary folder, and neither needs an API key.

**Behavior.** Preserving. Tests change nothing at runtime.

**Why.** These branches guard the workspace boundary and the loader's failure handling, and `check.ts` can't reach
them. A cooperative model never tries to escape the workspace, and the check has one fixture workspace
([D-18](artifacts/change-decision-log.md#d-18-small-bun-tests-cover-what-the-end-to-end-check-cannot-reach)).

**Depends on.** S-2, S-3.

**Decision.** [D-18](artifacts/change-decision-log.md#d-18-small-bun-tests-cover-what-the-end-to-end-check-cannot-reach)

### S-22: `AgentHostOptions.maxSteps` — Added

**Target state.** `AgentHostOptions` has an optional `maxSteps: number`. `createAgentHost` passes it to `Sessions`,
which uses it as the chat step limit, defaulting to `DEFAULT_CHAT_MAX_STEPS` (20). Nothing sets it yet. A future config
setting will supply it.

**Behavior.** Preserving on its own. Unset, it gives the 20-step default S-7 describes.

**Why.** The operator asked for the limit to be a parameter a future config can supply.

**Depends on.** S-7.

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-a-chat-turn-stops-after-20-model-steps-by-default)

## Behavior Changes

Each item is something a person, the UI, or the check script sees differently. The operator decided each one.

1. **The chat can't run shell commands, search file contents, or fetch web pages.** It can read, list, edit, and write
   files in the workspace. Observer: anyone chatting. Operator: "drop commands … anything outside of that scope can be
   dropped." (S-2, S-7)
2. **Background jobs have no dollar limit.** A job is bounded by its step limit (default 10) and its time limit (default
   5 minutes). A `maxBudgetUsd` in the request is ignored. Observer: whoever starts jobs through the API. Operator:
   "drop." (S-8, S-9)
3. **Replies read differently, and the default model is `claude-sonnet-5`.** 3pitor's own instructions for a blog post
   editor replace Claude Code's. Observer: anyone chatting. Operator: "default to claude-sonnet-5, and accept the
   shortcuts mapping them to the latest version." (S-5, S-14)
4. **Only `ANTHROPIC_API_KEY` signs in.** A Claude Code login no longer works, and a missing key prints a warning at
   startup. Observer: whoever starts 3pitor. This follows from removing Claude Code, which the operator asked for. (S-14)
5. **A stopped turn is forgotten.** After pressing Stop, the next turn has no memory of the stopped request. Observer:
   anyone chatting. Operator: "use recommendation." (S-7)
6. **The session id is gone from the wire.** The browser never reads it. The check script's "same session" assertion
   becomes "remembers turn 1." Observer: the check script. This follows from the history decision. (S-7, S-10, S-13)
7. **The Agent panel fills on page load, without highlights, and slash commands are gone.** Typing `/doc-stats` still
   works as a plain request the model matches to the skill. Observer: anyone using the UI. Settled by the operator's
   blog-post-editor scope statement. (S-10, S-12)
8. **A chat turn stops after 20 model steps by default.** Claude Code set no limit on chat. When a turn hits the limit,
   the chat stops partway and shows what it has so far. The limit is a parameter a future config setting can supply.
   Observer: anyone chatting. Operator: "go with recommendation, make step limit a parameter that we will eventually
   have config for, but default to 20 for now". (S-7)
9. **`build/` holds only `3pitor`.** Starting the built app with `WORKSPACE` set to a missing folder fails. Observer:
   whoever runs the built app. Operator: "use recommendation." (S-18, S-19)
10. **Subagents only read.** A workspace agent that asks for `Edit` or `Write` gets read-only tools. A subagent's
    own tool calls don't appear in the chat, only its start and finish. Observer: anyone writing workspace agents.
    Settled by the operator's scope statement and the two current agents, which only read. (S-5)
11. **The model can only change markdown posts.** `Write` and `Edit` refuse anything that isn't a `.md` file, and
    anything under a folder starting with `.`, such as `.git/` or `.claude/`. Observer: anyone chatting or running jobs.
    Settled by the operator's scope statement ("we're editing blog posts in markdown files"). (S-2)
12. **Two edits in one step show two approval cards at once, and card titles are always `Allow <tool>?`.** Observer:
    anyone approving edits. A consequence of how the AI SDK runs approvals (D-6). (S-6)
13. **Using a skill shows as a Read of its `SKILL.md`,** not as a `Skill` row. Observer: anyone reading the chat. A
    consequence of loading skills through the instructions (D-8). (S-11)

## Change Units

Each unit leaves `bunx tsc -p .` clean and `bun run check` passing.

### Unit 1: Add the new building blocks without switching anything

**Before you start.** Commit the uncommitted fix in `src/server/workspace-config.routes.ts` on its own. This unit
rewrites that file, and keeping the fix in a separate commit means reverting this unit won't lose it.

**What it does.** Adds the Anthropic provider, the file tools, and the workspace config loader, and points the existing
config route at the loader. Claude Code still runs every turn. `claude.ts` builds its `agents` setting from
`CODE_AGENTS`, mapped to `{ description, prompt, tools, background: false }`, so the title-writer is defined once.

It also adds the unit tests for both new modules.

**Delta entries.** S-1, S-2, S-3, S-4, S-21.

**How you know it worked.** `make test` passes. `bun run check` passes all twelve scenarios. `GET /api/workspace-config`
returns the same JSON as before, for the fixture workspace and for a folder with no `.claude/`.

### Unit 2: Switch chat to the Anthropic API

**What it does.** Adds `agent.ts` and moves chat onto it. This covers:

- the `Session` history and the approval gate
- `Approvals` returning a yes or no
- the `wire.ts` changes
- the chat and Agent panel UI changes
- `server.ts`'s model passthrough and missing-key warning
- check scenarios 2, 3, and 4

`claude.ts` loses its `init` and task-event translation and stays only for jobs. The `init` removal lands in this unit,
because the moment chat stops running Claude Code, nothing emits `init`.

**Delta entries.** S-5, S-6, S-7, S-10, S-11, S-12, S-13, S-14, S-22.

**Ordering constraint.** After Unit 1, which provides the tools and the loader.

**How you know it worked.**

- One call to `https://api.anthropic.com/v1/models` confirms the three ids in `MODEL_ALIASES` exist.
- `bun run check` passes all twelve scenarios with `ANTHROPIC_API_KEY` set.
- The chat panel shows tool rows for Read and Edit.
- Approving and denying an edit in the browser works.
- `grep -r canUseTool src` finds nothing.

### Unit 3: Switch jobs to the Anthropic API

**What it does.** Moves `Jobs.start` onto `agentSettings` with a step limit, and removes `maxBudgetUsd` from
`JobLimits`, the route, and `Job`. After this, nothing imports `claude.ts`.

**Delta entries.** S-8, S-9, and the `Job` part of S-10.

**Ordering constraint.** After Unit 2, which adds `agent.ts`.

**How you know it worked.** Scenarios 11 and 12 pass. `grep -r "from './claude'" src` finds nothing.

### Unit 4: Remove Claude Code

**What it does.** Deletes `claude.ts` and the debug script. Removes both Claude Code packages, `BUILD_DIR`, and the
Makefile's copy steps, and updates the README.

**Delta entries.** S-15, S-16, S-17, S-18, S-19, S-20.

**Ordering constraint.** After Unit 3, once nothing imports `claude.ts`.

**How you know it worked.**

- `bun run check` passes all twelve scenarios.
- `make build` finishes, and `ls build` shows only `3pitor`.
- `./build/3pitor some-folder` serves a chat that can read a post, from a machine with no `claude` on `PATH`.
- `WORKSPACE=/tmp/does-not-exist ./build/3pitor` fails at startup with a "no such file" error, as Behavior Changes item
  9 says.
- `grep -ri "claude-agent-sdk\|claude-code" package.json bun.lock src Makefile` finds nothing.

## Risks

- **The model uses tools differently.** Claude Code's tools and instructions were tuned together. With 3pitor's
  instructions, the model may skip reading a file before editing it, or pick Write where Edit fits. How you catch it:
  scenarios 5, 6, 7, and 11 exercise `Read`, `Edit`, and `Write`, so a regression there shows up in the check. `Glob`
  and the workspace boundary are covered only by the unit tests (S-21). Blast radius: Unit 2.
- **An Edit fails because the text isn't unique.** The model has to supply `old_string` exactly and uniquely. The error
  results tell it what went wrong, so it can retry. How you catch it: scenario 5's approved edit must land.
- **Scenario 8 or 9 fails if the model answers directly.** If the model writes the proofreading itself instead of
  calling the `Task` tool, no `task_notification` event fires, and the check fails. The check today accepts either a
  task event or the report text for the first assertion, but requires `task_notification` for the second. How you catch
  it: those two scenarios. What helps: the tool description names each agent.
- **`@ai-sdk/anthropic` was not installed during planning.** Several claims rest on it: its `anthropic()` export, that
  it reads `ANTHROPIC_API_KEY`, how it behaves when a turn is stopped, and whether it works inside `bun build --compile`.
  How you catch it: Unit 1 installs it, and Units 2 and 4 run the check and the compiled build.
- **The model ids must exist.** `claude-haiku-4-5-20251001`, `claude-sonnet-5`, and `claude-opus-5-5` come from the
  model list in the planning session's own environment, not from the API. No API key was available to confirm them. A
  wrong one fails the first turn with a clear API error, and Unit 2 checks them against `/v1/models`.
- **Chat costs more per turn.** The default moves from Haiku to Sonnet 5, and every turn resends the whole history.
  The plan does not add prompt caching. `bun run check` also runs on Sonnet 5 unless `MODEL` is set when you run it.

## Deferred (YAGNI)

### Trimming or saving chat history

**Why deferred:** Evidence test. No turn has failed from running out of context, and sessions were already memory-only
([C-6](artifacts/current-state-findings.md#c-6-claude-code-holds-the-conversation-history-and-the-browser-sends-only-the-newest-message)).

**Reopen when:** A turn fails with a context-length error, or you want chats to survive a restart.

**Source:** software-architect A3.

### Subagents that can edit

**Why deferred:** Evidence test. Neither current agent edits files. Letting them edit would mean passing approvals into
nested calls.

**Reopen when:** A workspace agent that needs to change a post is added.

**Source:** software-architect A7.

### Showing a subagent's own tool calls in the chat

**Why deferred:** Evidence test. Nothing in the UI or the check reads them.

**Reopen when:** Someone asks to see what a subagent did.

**Source:** software-architect A7.

### One shared path check for tools and the documents route

**Why deferred:** Simpler-version test. The documents route already has a working check, and this change doesn't touch
it.

**Reopen when:** A third place takes file paths, or the two checks disagree.

**Source:** software-architect A2.

### Looking up the latest model version from the API

**Why deferred:** Simpler-version test. A three-line table meets the operator's request without a network call at
startup.

**Reopen when:** Keeping the table current becomes a chore, or a model is retired before the table is updated.

**Source:** operator answer to question 4.

### A check that a stopped turn is really forgotten

**Why deferred:** Simpler-version test. The fix is structural (D-5 reads the abort signal), and proving it needs a
fake model to stop mid-turn, which the project has no setup for. Scenario 10's follow-up ("READY") would pass either
way.

**Reopen when:** A bug report of the chat remembering a stopped request.

**Source:** test-engineer, Q4.

### Prompt caching

**Why deferred:** Evidence test. No cost has been measured yet.

**Reopen when:** The API bill for chat is higher than you want.

**Source:** junior-developer JD-011.

### A unit test for `resolveModelId`

**Why deferred:** Simpler-version test. A wrong mapping fails the first turn with a clear API error, and the table is
three lines.

**Reopen when:** The alias table grows, or gains logic.

**Source:** test-engineer, Q2.

## Cut for Scope

These are dropped because they don't serve editing blog posts in markdown files, per the operator's scope statement in
[scope-boundary.md](artifacts/scope-boundary.md#operator-stated-scope). You can reinstate any of them.

- **Shell commands (Bash).** The chat could run commands on your machine after you approved them. Now it can't.
- **Searching file contents (Grep).** The chat could search across files in one step. Now it lists files and reads
  them.
- **Web fetching and web search.** The chat could pull in a web page. Now it can't.
- **Slash commands.** Claude Code treated `/doc-stats` as a command. Now it is plain text the model matches to the
  skill.

These are pre-existing problems the analysts found. The change doesn't make them worse, and fixing them is outside the
request:

- **Concurrent writes to one post.** A job, a chat turn, and a manual save can overwrite each other's changes to the
  same file, and there is no limit on how many jobs run
  ([C-19](artifacts/current-state-findings.md#c-19-chat-turns-and-jobs-share-one-workspace-with-no-coordination-and-jobs-have-no-concurrency-limit)).
- **A closed tab keeps its turn running.** The session answers "busy" until the model finishes, with no time limit on
  chat turns ([C-20](artifacts/current-state-findings.md#c-20-a-dropped-connection-does-not-cancel-its-turn-and-chat-turns-have-no-time-limit)).
  After this change, that turn bills your API key directly.
- **Every browser tab sees every session's approvals and can answer them**
  ([C-22](artifacts/current-state-findings.md#c-22-every-websocket-client-receives-every-event-and-can-answer-any-approval)).

## Open Items

- **The three model ids are unconfirmed against the API.** Non-blocking. Unit 2 settles it with one `/v1/models` call.

## Review Findings

One review round ran with three specialists: `han-core:junior-developer`, `han-core:adversarial-security-analyst`, and
`han-core:test-engineer`. These findings changed the plan:

- **A symlink inside the workspace could lead the file tools outside it** (security SEC-001, junior developer JD-008).
  `resolveInWorkspace` now checks real paths, and `Glob` filters its matches. See D-3.
- **Unattended jobs could write into `.git/` or `.claude/`,** which could set up code to run later (security SEC-002,
  JD-008). `Write` and `Edit` now only touch markdown posts. See D-17.
- **One malformed `.claude/` file could fail every turn** (security contract gap, JD-003). The loader now skips it. See
  D-8.
- **A turn stopped after its first step would have been saved to history** (JD-001, confirmed at
  `node_modules/ai/dist/index.js:10540`). Stops are now detected from the abort signal. See D-5.
- **The boundary and the loader had no test that could fail** (test-engineer Q1 and Q2, JD-002). Two small unit test
  files were added. See D-18.
- **Scenarios 8 and 9 could pass without the subagent running** (test-engineer Q3). They now require both the task event
  and the report text. See S-13.
- **Three "Preserving" labels hid small visible changes** (JD-007). S-6 and S-11 are relabeled Changing, as Behavior
  Changes items 12 and 13.
- **Smaller fixes:**
  - The uncommitted route fix is committed before Unit 1 (JD-005).
  - The instructions no longer tell jobs that a user approves edits (JD-010).
  - `tools` frontmatter accepts only a comma-separated string (JD-009).
  - The task event is typed against `wire.ts` (test-engineer contract note).
  - The Risks section no longer claims the check covers every tool (JD-002).

Unverified inputs the specialists named, none treated as blocking:

- `@ai-sdk/anthropic`'s abort behavior and error text, because the package was not installed.
- The `claude` binary's own symlink and `.git/` handling, because the binary is compiled. This leaves "worse than
  today" unproven for SEC-001 and SEC-002. Both are fixed regardless.
- The model ids (JD-004), which Unit 2 checks.

Full decisions are in [artifacts/change-decision-log.md](artifacts/change-decision-log.md).

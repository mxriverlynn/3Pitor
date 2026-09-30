# Current State Findings: Claude API or CLI Adapter

## Provenance

Produced by this run's own discovery round on 2026-09-30. No prior findings report covered the area.

- `han-core:structural-analyst`: `src/server/chat/agent/`, `sessions.ts` (its use of `agentSettings`), `tools.ts`,
  `components/test-model.ts`, `server.ts`, `agent-host.ts`, `workspace/workspace.ts`, `Makefile`, `scripts/check.ts`,
  README.
- `han-core:behavioral-analyst`: the chat turn, from the chat route through `Sessions.chat`, `agentSettings`,
  `streamText`, the tools, `record()`, and `session.json`, out to the UI stream parts `chat.tsx` reads.
- `han-research:research-analyst`: how an AI SDK v7 app can drive an installed `claude` program. This is web evidence,
  labeled on each finding it grounds (C-13 to C-16).
- The run's own sweep: git churn, ADRs, conventions, the installed `claude` version, node_modules, and the AI SDK and
  Anthropic provider source for how tool calls the model already ran are handled (C-11, C-12).

`han-core:concurrency-analyst` was not dispatched. The area has one turn per session, guarded by a 409, and no shared
mutable state beyond each turn's own copy of the posts (C-4).

## Project Context

- **Stack:** Bun + TypeScript, Hono, Vercel AI SDK `ai` 7.0.114 with `@ai-sdk/anthropic` 4.0.63 (`LanguageModelV4`),
  React UI, `bun test` (server tests plain, UI tests on happy-dom). `make build` compiles one executable,
  `build/3pitor`, with `bun build --compile`.
- **Conventions source:** No CLAUDE.md or `project-discovery.md`. The README's "How `src/` is laid out" section is the
  conventions source: package, then feature, then component folders; code shared by siblings goes in a `components/`
  folder at the lowest level that covers every user; entry points stay at the package root.
- **ADRs found:** none found under `docs/adr/`. Prior change plans under `docs/changes/` act as the decision record; the
  relevant one is `docs/changes/replace-claude-code-with-anthropic-api/`.
- **Coding standards found:** none found.
- **Recent churn:** 90 days over the area: `server.ts` 12 commits, `agent.test.ts` 6, `Makefile` 6, `tools.ts` 5,
  `agent-host.ts` 5, `agent.ts` 4, `sessions.ts` 3, `test-model.ts` 2.
- **Local `claude`:** `/Users/mxriverlynn/.local/bin/claude`, version `2.1.285 (Claude Code)`. Its `--help` lists
  `--tools`, `--mcp-config`, `--strict-mcp-config`, `--system-prompt`, `--input-format`, `--output-format`, `--model`,
  `--permission-mode`, `--no-session-persistence`, and `--bare`.

## Gaps

- No ADRs, no coding standards, no CLAUDE.md.
- No CLI-argument parsing library among the dependencies (C-9).
- No MCP server library among the declared dependencies. `@ai-sdk/mcp` 2.0.58 is in `bun.lock` only as a dependency of
  `@ai-sdk/react`, and it is an MCP client. `node_modules/@modelcontextprotocol/sdk` and
  `node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64` (a bundled `claude` binary, v0.3.282) are on disk but not in
  `bun.lock`. They are leftovers from before the earlier change and must not be relied on.
- Nobody ran the `claude` CLI end to end with an app-hosted MCP server (C-15, C-16).

## Findings

### C-1: One function builds the model, the tools, and the instructions

- **Claim:** `agentSettings` is the only place a `LanguageModel` is created. It also loads the workspace config, builds
  the file tools, and adds the Anthropic-run web tools.
- **Location:** `src/server/chat/agent/agent.ts`, `agentSettings`, lines 47-72
- **Evidence:**
  ```ts
  const config = await loadWorkspaceConfig(options.workspace);
  const model = anthropic(resolveModelId(options.model));
  const files = fileTools(options.workspace, turn);
  ...
  tools: {
    ...files,
    Task: taskTool(config.agents, model, files, ownerId, report),
    web_search: anthropic.tools.webSearch_20250305({ maxUses: 10 }),
    web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 10 }),
  },
  ```
- **Raised by:** structural-analyst S1, S2; behavioral-analyst B1, B8
- **Confidence:** Verified
- **Bears on:** S-9, D-1

### C-2: The chat turn is one `streamText` call over whatever `agentSettings` returns

- **Claim:** `Sessions.chat` spreads `{ model, instructions, tools }` into `streamText`. It adds the history, a
  20-step limit, the abort signal, and an error flag, and nothing in it names a provider.
- **Location:** `src/server/chat/sessions/sessions.ts`, `chat`, lines 98-130
- **Evidence:**
  ```ts
  const result = streamText({
    ...(await agentSettings(this.options, this.events, sessionId, turn, writer)),
    messages,
    stopWhen: stepCountIs(this.options.maxSteps ?? DEFAULT_CHAT_MAX_STEPS),
    abortSignal: abort.signal,
    onError: ({ error }) => { streamFailed = true; console.error(modelErrorMessage(error)); },
  });
  writer.merge(result.toUIMessageStream({ onError: modelErrorMessage }));
  ```
  `this.options` flows unchanged from `AgentHostOptions` through `Sessions` to `agentSettings`.
- **Raised by:** behavioral-analyst B1; structural-analyst S3
- **Confidence:** Verified
- **Bears on:** S-8, S-9, D-1

### C-3: 3pitor owns the conversation history and stores it as AI SDK messages

- **Claim:** `session.messages` is a `ModelMessage[]` built from `responseMessages` after each completed turn. It is
  written to `session.json` and sent in full on every turn. A stopped or failed turn never enters it.
- **Location:** `src/server/chat/sessions/sessions.ts`, lines 116-123, 155-157
- **Evidence:**
  ```ts
  const responseMessages = await result.responseMessages;
  if (!abort.signal.aborted) session.messages = [...messages, ...responseMessages];
  ```
  `load()` checks only that `id` is a string and that `messages` and `uiMessages` are arrays.
- **Raised by:** behavioral-analyst B2
- **Confidence:** Verified
- **Bears on:** D-5, D-19

### C-4: The file tools must run inside 3pitor, against the turn's copy of the posts

- **Claim:** Read, Write, Edit, Glob, and Highlight read and change a per-turn in-memory copy that starts from the
  editor's unsaved text. They never write a file. What they change reaches the editor only through the `data-session`
  part that `sessions.ts` writes after the turn.
- **Location:** `src/server/chat/tools/tools.ts`, `turnTexts`, `fileTools`; `sessions.ts` lines 124-127
- **Evidence:**
  ```ts
  // chat turn's copy (what the user sees in the editor) and change only that copy: nothing here writes a
  // file, because only the user's Save does.
  ```
  ```ts
  const data: SessionData = { aborted, edited: aborted ? {} : editedTexts(turn) };
  if (!aborted && turn.highlights) data.highlights = turn.highlights;
  ```
  The `claude` program's own Read, Write, and Edit would read stale text from disk and write real files. It has no
  Highlight.
- **Raised by:** behavioral-analyst B3; structural-analyst S5
- **Confidence:** Verified
- **Bears on:** S-4, D-3, D-10

### C-5: Task subagents reuse the parent's model through a nested `generateText`

- **Claim:** The Task tool calls `generateText` with the same `model` object, the subagent's prompt, and only its Read
  and/or Glob tools, with a 10-step limit. It reports `data-task` start and finish events.
- **Location:** `src/server/chat/agent/agent.ts`, `taskTool`, lines 74-109
- **Evidence:**
  ```ts
  const result = await generateText({
    model, instructions: agent.prompt, prompt,
    tools: Object.fromEntries(agent.tools.map((name) => [name, files[name]])),
    stopWhen: stepCountIs(10), abortSignal,
  });
  ```
- **Raised by:** behavioral-analyst B6; structural-analyst S2
- **Confidence:** Verified
- **Bears on:** S-9, S-5, D-1

### C-6: Web search and web fetch exist only on the API path, and the app's skills already cope without them

- **Claim:** `web_search` and `web_fetch` are Anthropic-run tools. The research skill's analyst role already says what
  to do when `web_search` is missing. No UI code names them.
- **Location:** `agent.ts` lines 66-69; `agent.test.ts` lines 35-40; `src/skills/research/references/roles/research-analyst.md` lines 60-64
- **Evidence:**
  ```ts
  expect(tools.web_search).toMatchObject({ id: 'anthropic.web_search_20250305', args: { maxUses: 10 } })
  ```
  research-analyst.md: "If `web_search` is not among your tools ... skip searching".
- **Raised by:** structural-analyst S4; behavioral-analyst B4
- **Confidence:** Verified
- **Bears on:** D-10

### C-7: The missing-key message is API-specific, and the startup check is a separate copy of it

- **Claim:** `modelErrorMessage` maps `LoadAPIKeyError` to `MISSING_API_KEY_HELP`, and every other error to its bare
  message. `server.ts` warns at startup whenever `ANTHROPIC_API_KEY` is empty or unset. `make check-build` sets
  `ANTHROPIC_API_KEY=unused` to silence it.
- **Location:** `agent.ts` lines 28-38; `server.ts` line 23; `Makefile` `check-build`; `sessions.test.ts` lines 167-179
- **Evidence:**
  ```ts
  if (LoadAPIKeyError.isInstance(error)) return MISSING_API_KEY_HELP;
  return error instanceof Error ? error.message : String(error);
  ```
  ```ts
  if (!process.env.ANTHROPIC_API_KEY) console.warn(`\n${MISSING_API_KEY_HELP}\n`);
  ```
- **Raised by:** structural-analyst S7; behavioral-analyst B5
- **Confidence:** Verified
- **Bears on:** S-10, D-11, D-12

### C-8: A failed stream must set the error flag, and a stop must be seen through the abort signal

- **Claim:** A turn whose stream fails ends without a `data-session` part and shows one error. An aborted turn writes
  `aborted: true` with no edits. Both rely on the model honoring the abort signal and reporting failures through the
  stream.
- **Location:** `sessions.ts` lines 107-130
- **Evidence:**
  ```ts
  // The stream already showed its error in the chat; throwing would add a vaguer second one.
  if (streamFailed && !abort.signal.aborted) return;
  ```
- **Raised by:** behavioral-analyst B5
- **Confidence:** Verified
- **Bears on:** D-18, D-19

### C-9: Startup reads a positional argument straight from `process.argv`, with no parser

- **Claim:** `server.ts` passes `process.argv[2]` to `chooseWorkspace`. Nothing else in the server reads argv. Today
  `--claude=CLI` would be taken as a folder name, which does not exist, so 3pitor would warn and use the launch folder.
  No argument-parsing library is installed.
- **Location:** `src/server/server.ts` line 18; `src/server/workspace/workspace.ts`, `chooseWorkspace`
- **Evidence:**
  ```ts
  // Usage: 3pitor [folder-or-file]
  const workspace = await chooseWorkspace(process.argv[2]);
  ```
  `scripts/check.ts` reads its own argv as scenario-name filters and starts the server with no arguments.
- **Raised by:** structural-analyst S8
- **Confidence:** Verified
- **Bears on:** S-1, S-2, D-7, D-8

### C-10: Tests swap the model by mocking the `@ai-sdk/anthropic` module

- **Claim:** `useModel` replaces `@ai-sdk/anthropic` so every model `agentSettings` builds is a scripted
  `MockLanguageModelV4`. `sessions.test.ts` has a second mock that makes model creation throw.
- **Location:** `src/server/chat/components/test-model.ts` line 61; `sessions.test.ts` lines 296-300
- **Evidence:**
  ```ts
  mock.module('@ai-sdk/anthropic', () => ({ anthropic: Object.assign(() => model, { tools: providerTools }) }));
  ```
- **Raised by:** structural-analyst S6; behavioral-analyst B8
- **Confidence:** Verified (the tests were read, not run)
- **Bears on:** D-15

### C-11: The AI SDK does not run a tool call the model marks as already run

- **Claim:** When a model's output includes a tool call with `providerExecuted: true`, `streamText` and `generateText`
  do not call that tool's `execute`. They record the call and its result in `responseMessages`, and the UI stream shows
  a tool row for it.
- **Location:** `node_modules/ai/dist/index.js` lines 1615, 6704
- **Evidence:**
  ```js
  if (content.type === "tool-call" && !content.providerExecuted) {
  ```
  ```js
  (toolCall) => !toolCall.providerExecuted
  ```
- **Raised by:** the run's own sweep
- **Confidence:** Verified (source read, not executed)
- **Bears on:** D-4

### C-12: The API path drops tool calls in history that some other runner already ran, with a warning

- **Claim:** When `@ai-sdk/anthropic` converts history, a `providerExecuted` tool call or result for a tool it does not
  know (not web search, web fetch, code execution, tool search, advisor, or an MCP tool use) is left out with a
  warning. The request does not fail.
- **Location:** `node_modules/@ai-sdk/anthropic/dist/index.js` lines 3339-3424, 3787
- **Evidence:**
  ```js
  message: `provider executed tool call for tool ${part.toolName} is not supported`
  ```
  ```js
  message: `provider executed tool result for tool ${part.toolName} is not supported`
  ```
- **Raised by:** the run's own sweep
- **Confidence:** Verified (source read, not executed)
- **Bears on:** D-5

### C-13: The `claude` program runs its own tool loop, and can call tools 3pitor hosts over MCP

- **Claim:** `claude -p` never hands a tool call back to its caller to run. It runs its own loop. It can call tools from
  an MCP server named with `--mcp-config`, including an HTTP one. `--tools ""` removes every built-in tool, and
  `--strict-mcp-config` ignores every other MCP config. MCP tools are named `mcp__<server>__<tool>`, and in `-p` mode
  they must be pre-approved (for example with `--allowedTools`) or they are denied.
- **Location:** web: https://code.claude.com/docs/en/cli-reference, https://code.claude.com/docs/en/headless
- **Evidence:** Flags confirmed present in the local `claude --help` (see Project Context). The HTTP `--mcp-config` shape
  and the pre-approval rule rest on the docs only.
- **Raised by:** research-analyst A5, A7
- **Confidence:** Verified for the flags' existence; **Unverified** for end-to-end behavior (nobody ran it)
- **Bears on:** D-2, D-3, D-20

### C-14: The `claude` program uses an API key over the subscription whenever one is in its environment

- **Claim:** In `-p` mode, `claude` always uses `ANTHROPIC_API_KEY` when present, ahead of the subscription login.
  `ANTHROPIC_AUTH_TOKEN` outranks it. `--bare` never reads the subscription login.
- **Location:** web: https://code.claude.com/docs/en/authentication, https://code.claude.com/docs/en/headless
- **Evidence:** "In non-interactive mode (`-p`), the key is always used when present." Single Anthropic source,
  primary.
- **Raised by:** research-analyst A6
- **Confidence:** Unverified (web, single source)
- **Bears on:** D-6

### C-15: `claude` has no way to take an arbitrary prior conversation

- **Claim:** The only documented ways to continue a conversation are `--resume` and `--continue`, which work from
  sessions `claude` itself stored. There is no flag to hand it another program's message history.
- **Location:** web: https://code.claude.com/docs/en/headless
- **Evidence:** Research-analyst A7. The `--input-format stream-json` message schema was not confirmed.
- **Raised by:** research-analyst A7
- **Confidence:** Unverified (web)
- **Bears on:** D-5

### C-16: Every package that wraps `claude` for the AI SDK brings its own `claude` binary

- **Claim:** `@anthropic-ai/claude-agent-sdk` ships a native `claude` binary as a per-platform optional dependency.
  `ai-sdk-provider-claude-code` 4.x depends on it at a pinned version, and ignores the AI SDK `tools` option.
- **Location:** web: https://code.claude.com/docs/en/agent-sdk/typescript,
  https://registry.npmjs.org/ai-sdk-provider-claude-code/latest,
  https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest
- **Evidence:** Corroborated across the Anthropic docs and two registry entries.
- **Raised by:** research-analyst A1, A2, A3, A10
- **Confidence:** Verified across independent web sources
- **Bears on:** D-2

### C-17: README and build checks describe API-only startup

- **Claim:** The README says 3pitor "needs no `claude` program", documents only the positional folder argument, and
  says the server warns when `ANTHROPIC_API_KEY` is missing. `make check-build` and `scripts/check.ts` read the
  `listening on <url>` log line.
- **Location:** `README.md` lines 9-10, 186-190; `Makefile` `check-build`; `server.ts` line 47
- **Evidence:**
  > It is built on Bun + TypeScript, Hono, and the Vercel AI SDK (v7) with its Anthropic provider, which calls the
  > Anthropic API directly. It needs no `claude` program.
- **Raised by:** structural-analyst S10, S11
- **Confidence:** Verified
- **Bears on:** S-10, S-13

## Findings No Agent Could Audit

- **The `claude` program's live behavior.** Nobody ran `claude -p` with an HTTP MCP server, `--tools ""`, and
  `stream-json` output against this app. The stream-json event shapes, the MCP pre-approval rule, and MCP connect time
  rest on the docs (C-13). Closing this is Unit 0 of the plan, a short script run before Unit 2 is built.
- **Anthropic's terms for a personal tool.** The legal page says developers "building products or services ... should
  use API key authentication", and that signing in to the unmodified `claude` binary with your own subscription is
  allowed. It does not address a one-person tool that spawns the unmodified binary. Only the operator can weigh this.

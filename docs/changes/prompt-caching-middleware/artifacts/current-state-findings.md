# Current State Findings: Prompt Caching Through AI SDK Middleware

## Provenance

Two sources, both from 2026-10-01:

1. **Prior report.** `docs/research/prompt-caching-ai-sdk-and-claude-cli.md` provides the codebase sources A19 to A30 and
   the decision history (A28, A29). The research run's adversarial validator re-read those sources.
2. **This run's discovery round.** `han-core:structural-analyst` (findings S-1 to S-10) and `han-core:behavioral-analyst`
   (findings B-1 to B-10) covered `src/server/chat/agent/`, `src/server/chat/claude-backend/`,
   `src/server/chat/claude-cli/`, `src/server/chat/sessions/` and `src/server/chat/components/test-model.ts`. The
   orchestrator re-read the test assertions in C-12 directly. `han-core:concurrency-analyst` was not dispatched. The
   change adds no shared state and no new async coordination, and wrapping passes the abort signal through unchanged
   (C-11).

## Project Context

- **Stack:** Bun, TypeScript 7, Hono server, React UI. `ai` 7.0.114, `@ai-sdk/anthropic` 4.0.63, `@ai-sdk/provider`
  types. The tests use `bun:test` with `MockLanguageModelV4` from `ai/test`. The `claude` program installed during
  research was 2.1.286.
- **Conventions source:** none found. There is no `CLAUDE.md` and no `project-discovery.md`. Conventions are inferred
  from surrounding code:
  - Each feature has a folder with a same-named file and a sibling `*.test.ts`.
  - Every file opens with a header comment saying what it owns and what it does not.
  - Tests are behavior-named sentences.
- **ADRs found:** none found under `docs/adr/`. Decisions live in `docs/changes/*/artifacts/change-decision-log.md`.
- **Coding standards found:** none found.
- **Recent churn:** from git log over `src/server/chat` for the last 90 days. File touches: `tools.ts` 12,
  `claude-cli.ts` 8, `agent.ts` 8, `sessions.ts` 4, `claude-backend.ts` 3. The commits are feature work, not fixes (S-7).

## Gaps

- No ADR or coding standard covers model construction, middleware, or logging.
- No logging convention for server diagnostics exists beyond `console.error` for model errors in `sessions.ts`. No
  structured logger was found.
- Nothing in `src` reads or logs model usage today (C-10).
- No test exercises `wrapLanguageModel` with this app's models.

## Findings

### C-1: Every chat and subagent model is built through the backend's two methods

- **Claim:** `ClaudeBackend.chatModel` and `ClaudeBackend.subagentModel` are the only places a model is constructed, and
  `agent.ts` is their only caller. The API backend's two methods are identical.
- **Location:** `src/server/chat/claude-backend/claude-backend.ts:8-19,28-55`; `src/server/chat/agent/agent.ts:64,67`
- **Evidence:**
  ```ts
  chatModel: (modelId) => anthropic(modelId),
  subagentModel: (modelId) => anthropic(modelId),
  ...
  chatModel: (modelId, tools) => claudeCliModel(modelId, tools, { webTools: true }),
  subagentModel: (modelId, tools) => claudeCliModel(modelId, tools, { webTools: false }),
  ```
- **Raised by:** structural-analyst S-1; research A21
- **Confidence:** Verified
- **Bears on:** S-4, S-5, S-6; D-6

### C-2: The instructions are one string, built per turn and spread into `streamText` beside the model

- **Claim:** `agentSettings` re-reads the workspace config on every turn. It returns
  `{ model, instructions: instructionsFor(config.skills), tools }`, and `sessions.ts` spreads that object into
  `streamText`. `instructionsFor` is private and joins the fixed prompt with a `<skills>` block.
- **Location:** `src/server/chat/agent/agent.ts:42-68,107-116`; `src/server/chat/sessions/sessions.ts:106-108`
- **Evidence:**
  ```ts
  return { model: backend.chatModel(id, tools), instructions: instructionsFor(config.skills), tools };
  ...
  return `${systemPrompt.trimEnd()}\n\n<skills>\n${SKILLS_INTRO}\n${lines.join('\n')}\n</skills>`;
  ...
  const result = streamText({
    ...(await agentSettings(this.options, this.events, sessionId, turn, writer)),
    messages,
  ```
- **Raised by:** structural-analyst S-2, S-9; behavioral-analyst B-1, B-10
- **Confidence:** Verified
- **Bears on:** S-1, S-6; D-1, D-7, D-8

### C-3: A string instruction becomes one system message with no provider options; the message-list form keeps them

- **Claim:** The AI SDK turns string `instructions` into `[{ role: 'system', content }]` on every step. A
  `SystemModelMessage` or `SystemModelMessage[]` value keeps each message's `providerOptions`. A system message inside
  `messages` is rejected unless `allowSystemInMessages` is set, and this app never sets it. A system message added by
  middleware bypasses that check.
- **Location:** `node_modules/ai/dist/index.js:1579-1584,2758-2815,9322-9360`; `node_modules/ai/dist/index.d.ts:797`
- **Evidence:**
  ```js
  typeof prompt.instructions === "string" ? [{ role: "system", content: prompt.instructions }] : asArray(prompt.instructions).map((message) => ({ role: "system", content: message.content, providerOptions: message.providerOptions }))
  ```
- **Raised by:** behavioral-analyst B-1, B-2; research A27
- **Confidence:** Verified
- **Bears on:** S-1; D-1, D-2

### C-4: Subagents use a separate model, their own instructions, and `generateText`

- **Claim:** The `Task` tool gets `backend.subagentModel(id, files)`. It calls `generateText` with
  `instructions: agent.prompt` as a plain string, the agent's own tools only, and `stepCountIs(10)`. The subagent's
  usage is not returned.
- **Location:** `src/server/chat/agent/agent.ts:62-65,74-105`
- **Evidence:**
  ```ts
  const result = await generateText({
    model,
    instructions: agent.prompt,
    prompt,
    tools: Object.fromEntries(agent.tools.map((name) => [name, files[name]])),
    stopWhen: stepCountIs(10),
  ```
- **Raised by:** structural-analyst S-3; behavioral-analyst B-9
- **Confidence:** Verified
- **Bears on:** S-4; D-4

### C-5: The CLI model joins system messages into one `--system-prompt` and ignores their provider options

- **Claim:** `claudeArgs` reads only `m.content` of each system message and joins them with `\n\n`. `stdinFor` drops
  system messages. Zero system messages still pass `--system-prompt ''`. The CLI model always reports
  `finishReason: stop`, so one chat turn starts one `claude` process. Inside that process, `claude` runs its own tool
  loop.
- **Location:** `src/server/chat/claude-cli/claude-cli.ts:147-167,188-197`; `src/server/chat/claude-cli/stream-json.ts:43-46`
- **Evidence:**
  ```ts
  const system = prompt.flatMap((m) => (m.role === 'system' ? [m.content] : [])).join('\n\n');
  ...
  '--model', modelId, '--system-prompt', system, '--no-session-persistence',
  ```
- **Raised by:** structural-analyst S-4; behavioral-analyst B-4; research A19
- **Confidence:** Verified for the code. Unverified for what `claude` does with an empty `--system-prompt`, because no
  agent ran the binary.
- **Bears on:** S-2; D-2, D-3

### C-6: The CLI receives history as one text transcript, by an earlier decision

- **Claim:** Earlier messages are rendered into one `<history>` text block on stdin, with `--no-session-persistence`.
  Decision D-5 of `claude-api-or-cli-adapter` chose this. It rejected `--resume` because that creates a second history
  API mode cannot read, and it rejected stream-json input because its replay schema is unconfirmed.
- **Location:** `src/server/chat/claude-cli/claude-cli.ts:188-197`;
  `docs/changes/claude-api-or-cli-adapter/artifacts/change-decision-log.md:115-133`
- **Evidence:**
  ```ts
  const history = messages.slice(0, -1).map(render).join('\n');
  return `<history>\n${history}\n</history>\n\n${render(last)}`;
  ```
- **Raised by:** research A20, A29
- **Confidence:** Verified
- **Bears on:** — (kept unchanged by D-9)

### C-7: `wrapLanguageModel` passes params, provider options, the abort signal, and the provider name through for any v4 model

- **Claim:** Wrapping works on the custom CLI model as well as on the Anthropic model:
  - `transformParams` runs before `doStream` and `doGenerate`.
  - `streamText` reaches `wrapStream`, and `generateText` reaches `wrapGenerate`.
  - The first middleware in the array is the outermost.
  - The wrapper reports the inner model's `provider` and `modelId`, so it reports `'claude-cli'` for the CLI model.
  - Call-level `providerOptions` reach the inner model unchanged.
- **Location:** `node_modules/ai/dist/index.js:17922-17975`
- **Evidence:** `[...asArray(middleware)].reverse().reduce(...)`; `doWrap` uses the transformed params for both `doStream`
  and `doGenerate`, with no try/catch.
- **Raised by:** behavioral-analyst B-5
- **Confidence:** Verified by reading the code. Unverified at runtime, because nothing was executed.
- **Bears on:** S-5; D-6

### C-8: `defaultInstructionsMiddleware` adds a list of system messages, with their provider options, only when the call has none

- **Claim:** It accepts a string or `SystemModelMessage[]`, keeps each message's `providerOptions`, and prepends the
  messages only when `params.prompt` contains no system message. With today's string `instructions`, it would do nothing.
- **Location:** `node_modules/ai/dist/index.js:17438-17458`
- **Evidence:**
  ```js
  if (defaultSystemMessages.length === 0 || params.prompt.some((message) => message.role === "system")) {
    return params;
  }
  return { ...params, prompt: [...defaultSystemMessages, ...params.prompt] };
  ```
- **Raised by:** behavioral-analyst B-5; research A30
- **Confidence:** Verified
- **Bears on:** S-1, S-6; D-1, D-7

### C-9: The Anthropic provider supports per-system-message markers, a request-level marker, and at most four breakpoints

- **Claim:**
  - Consecutive system messages become entries in the request's top-level `system` array, and each entry carries its own
    `cache_control` from `providerOptions.anthropic.cacheControl`. A later system block moves mid-conversation only when
    it carries tool changes, `clearAt` or `effort`.
  - Call-level `providerOptions.anthropic.cacheControl` becomes the request's top-level `cache_control`, which is
    Anthropic's automatic mode.
  - A breakpoint past four is dropped with a warning, not an error.
- **Location:** `node_modules/@ai-sdk/anthropic/dist/index.js:1117-1123,1338-1375,2832-2900,4513-4515`
- **Evidence:**
  ```js
  ...(anthropicOptions == null ? void 0 : anthropicOptions.cacheControl) && { cache_control: anthropicOptions.cacheControl },
  ```
- **Raised by:** behavioral-analyst B-3; research A25, A26
- **Confidence:** Verified
- **Bears on:** S-1, S-4; D-2, D-4

### C-10: Both backends report the same usage shape, and nothing logs it

- **Claim:** Both backends produce a v4 `finish` part with `inputTokens: { total, noCache, cacheRead, cacheWrite }`. The
  CLI side comes from `usageOf`, which does not null-check the cache fields. Nothing in `src` reads or logs usage.
- **Location:** `src/server/chat/claude-cli/stream-json.ts:42-46,75-94`;
  `node_modules/@ai-sdk/anthropic/dist/index.js:2336-2385`
- **Evidence:**
  ```ts
  controller.enqueue({ type: 'finish', finishReason: { unified, raw: data.subtype }, usage: usageOf(data.usage) });
  ```
- **Raised by:** behavioral-analyst B-6; research A24
- **Confidence:** Verified
- **Bears on:** S-3; D-5

### C-11: Wrapping does not change the errors callers see, unless middleware catches or throws

- **Claim:**
  - `doWrap` has no try/catch.
  - The CLI's `ready` rejection and its `error` stream parts pass through a piping wrapper unchanged.
  - `LoadAPIKeyError.isInstance` is a marker check, so `modelErrorMessage` still recognizes it through a wrapper.
  - CLI errors are plain `Error`s and are never retried.
  - An error thrown inside `transformParams` would surface instead of the provider's error.
- **Location:** `src/server/chat/claude-cli/claude-cli.ts:74-104,118-121`; `src/server/chat/agent/agent.ts:29-33`;
  `node_modules/ai/dist/index.js:3004`
- **Evidence:**
  ```ts
  if (LoadAPIKeyError.isInstance(error)) return MISSING_API_KEY_HELP;
  ```
- **Raised by:** behavioral-analyst B-7, B-8
- **Confidence:** Verified by reading the code
- **Bears on:** S-3, S-5; D-5

### C-12: Tests pin the instructions string, the CLI arguments, and the API backend's model identity

- **Claim:** Five assertions depend on today's shape:
  - `agent.test.ts:20-34` asserts `agentSettings(...).instructions` with an exact `toBe`.
  - `agent.test.ts:43-47` asserts the same field with `toContain`.
  - `agent.test.ts:68` asserts the subagent's first prompt message with `toEqual({ role: 'system', content: ... })`, so a
    system message that gains `providerOptions` would fail it.
  - `claude-backend.test.ts:43-44` asserts `apiBackend.chatModel(...)` and `subagentModel(...)` are `toBe(model)`, the
    raw mock.
  - `claude-cli.test.ts:41-42,101-106` pins `--system-prompt 'Be brief.'` and the whole argument list.
  - `sessions.test.ts:495-497` asserts the CLI's `--system-prompt` contains `<skills>` and a skill line.
- **Location:** as listed
- **Evidence:**
  ```ts
  const { instructions } = await agentSettings({ workspace: FIXTURE, claude: 'api' }, new EventBus(), 'owner-1', turnTexts(FIXTURE, {}));
  expect(instructions).toBe(`${systemPrompt.trimEnd()}\n\n<skills>\n...`);
  ...
  expect(apiBackend.chatModel('claude-sonnet-5', {})).toBe(model);
  ```
- **Raised by:** structural-analyst S-5, S-6; orchestrator re-read
- **Confidence:** Verified
- **Bears on:** S-1, S-2, S-4, S-6 (test rewrites in Units 1, 3 and 4)

### C-13: Tests stub the model by replacing the `@ai-sdk/anthropic` module, which exports only `anthropic`

- **Claim:** `useModel` replaces the module with `{ anthropic }`, so `anthropic(id)` returns the mock. Tests read what
  reached the model from `doStreamCalls[n].prompt` and `doGenerateCalls[n]`, which record what the mock received after
  any middleware ran. A new import from `@ai-sdk/anthropic` would be missing under the stub. Imports from `ai` are
  unaffected.
- **Location:** `src/server/chat/components/test-model.ts:58-62`
- **Evidence:**
  ```ts
  mock.module('@ai-sdk/anthropic', () => ({ anthropic: Object.assign(() => model, { tools: providerTools }) }));
  ```
- **Raised by:** structural-analyst S-6
- **Confidence:** Verified
- **Bears on:** S-4, S-6 (test rewrites)

### C-14: No code outside the area calls the model or instruction functions

- **Claim:**
  - `server.ts` uses only `claudeBackend`, `label` and `startupWarning`.
  - `agent-host.ts` imports only `Sessions`.
  - `agentSettings` is imported only by `sessions.ts` and `agent.test.ts`.
  - `claudeCliModel` is imported only by `claude-backend.ts` and its test.
- **Location:** `src/server/server.ts:8,24-26`; `src/server/agent-host.ts:4`
- **Evidence:** grep results summarized in structural-analyst S-8
- **Raised by:** structural-analyst S-8
- **Confidence:** Verified, except `src/ui/chat/agent-panel/agent-panel.test.tsx`, which matched a path grep but was not
  opened (Unverified; it is a UI test)
- **Bears on:** S-6; D-6, D-7

### C-15: Two parts of the prompt's leading content can change between turns

- **Claim:**
  - The skills list in the system prompt is rebuilt from the workspace config on every turn.
  - The `Task` tool's description lists the configured subagents and is rebuilt on every turn.
  - Tools come before the system prompt in Anthropic's cache order, so an edit to the subagent list invalidates the
    whole cached prefix.
  - The open-file note is part of the user message and does not touch the system prompt.
- **Location:** `src/server/chat/agent/agent.ts:41-49,84`; `src/server/chat/sessions/sessions.ts:94-102`
- **Evidence:**
  ```ts
  description: `Hand a task to a subagent and get back its reply. Available subagents:\n${agents.map((a) => `- ${a.name}: ${a.description}`).join('\n')}`,
  ```
- **Raised by:** behavioral-analyst B-10; research V4
- **Confidence:** Verified for the code. Unverified for whether `loadWorkspaceConfig` returns skills in a deterministic
  order, because `workspace-config.ts` was not read.
- **Bears on:** S-1; D-1

### C-16: The fixed-prompt-first order was chosen to allow a future cache breakpoint

- **Claim:** Decision D-2 of `content-editor-system-prompt` puts the fixed text first and the per-turn skills list
  after it, explicitly to keep a future cache breakpoint possible.
- **Location:** `docs/changes/content-editor-system-prompt/artifacts/change-decision-log.md:61-74`
- **Evidence:** "Fixed text first and the per-turn list after it keeps a future cache breakpoint possible"
- **Raised by:** research A28
- **Confidence:** Verified
- **Bears on:** S-1; D-1, D-3

## Findings No Agent Could Audit

- **The `claude` binary's behavior at runtime.** No agent ran it. That leaves three questions open: where it places cache
  breakpoints, whether it honors `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` on the subscription route, and what it does with an
  empty `--system-prompt`. Closing them takes a three-turn chat in CLI mode while the cache log from S-5 is on.
- **Live Anthropic API responses.** No API call was made. Whether the request-level marker produces cache reads for this
  app's models, and whether the tools plus the fixed prompt reach the minimum cacheable size (1,024 tokens for Sonnet
  5), takes a live run with the cache log.

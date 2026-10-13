# Current State Findings: Choose Provider and Model

## Provenance

Produced by this run's own discovery round on 2026-10-13, on branch `choose-provider-and-model`:

- `han-core:structural-analyst` — module boundaries, coupling, and test seams across `src/engine/chat/`,
  `src/engine/engine.ts`, `src/engine/components/json-file.ts`, `src/cli/`, `src/shared/wire.ts`, `src/server/`,
  `src/ui/app.tsx`, `src/ui/chat/agent-panel/`, and `src/ui/components/menu/`. Its identifiers are `S-n` below.
- `han-core:behavioral-analyst` — startup, the per-turn model build, the session record, the New chat and load paths,
  error mapping, and history replay over the same area. Its identifiers are `B-n` below.
- `han-research:research-analyst` — the provider packages, the AI SDK `reasoning` option, current model ids, and model
  listing. Its identifiers are `R-n` below.
- The planner's own sweep of the README, the Makefile, `package.json`, `node_modules/@ai-sdk/*` type declarations,
  `claude --help`, and git churn.

No concurrency analyst was dispatched. The area's only shared mutable state is `Sessions`' map and `currentId`, which
the behavioral analyst covered (C-14).

## Project Context

- **Stack:** TypeScript on Bun, with the engine also loadable on Node 22.15+ (`make check-node`). Vercel AI SDK
  `ai@7.0.114` with `@ai-sdk/anthropic@4.0.63`. Hono server; React 19 UI tested with happy-dom. TypeScript 7 type-check
  runs first in `make test`.
- **Conventions source:** `README.md` (its code-structure section describes each module) and prior plans under
  `docs/changes/`. No CLAUDE.md or project-discovery.md.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** over 90 days, `src/ui/app.tsx` (34 commits), `src/ui/chat/chat/chat.tsx` (17), `src/shared/wire.ts`
  (16), `src/ui/chat/chat/chat.test.tsx` (13). The engine's chat files changed 2 to 6 times each. The backend seam came
  from `docs/changes/claude-api-or-cli-adapter/`, and prompt caching from `docs/changes/prompt-caching-middleware/`.

## Gaps

- No ADRs and no coding standards exist; the README and earlier change plans are the convention record.
- No provider package other than `@ai-sdk/anthropic` is installed, so nothing about OpenAI, Gemini, or Ollama behavior
  could be read from the checkout (C-6).
- No model catalogue, provider list, or thinking/effort/reasoning concept exists anywhere in `src/` (C-3).
- No real `.3pitor/session.json` holding reasoning parts exists to inspect (C-15).

## Findings

### C-1: The mode and the model travel from argv to the model call as two process-wide constants

- **Claim:** `--claude` and `MODEL` are read once at startup and copied through five modules into `Sessions.options`,
  which every turn reads and nothing writes.
- **Location:** `src/cli/command-line.ts:19,28-33`; `src/cli/cli.ts:11,15-23`; `src/engine/engine.ts:84-95`;
  `src/engine/chat/sessions/sessions.ts:22,38-40`; `src/engine/chat/agent/agent.ts:67-68`
- **Evidence:**
  ```ts
  // command-line.ts
  if (mode === 'auto') return { target, claude: env.ANTHROPIC_API_KEY ? 'api' : 'cli' };
  if (mode === 'api' || mode === 'cli') return { target, claude: mode };
  // cli.ts
  claude,
  model: process.env.MODEL,
  // agent.ts
  const backend = claudeBackend(options.claude, options.serveTools);
  const id = resolveModelId(options.model);
  ```
- **Raised by:** structural-analyst S-1; behavioral-analyst B-1, B-2
- **Confidence:** Verified
- **Bears on:** S-1, S-3, S-9, S-10, S-11; D-1, D-5, D-9

### C-2: Three option types repeat the same startup configuration

- **Claim:** `EngineOptions`, `StartOptions`, and `AgentOptions` each carry `claude`, `model?`, and `serveTools`, and
  `startEngine` rebuilds one from another field by field.
- **Location:** `src/engine/engine.ts:20-40,84-85`; `src/engine/chat/agent/agent.ts:26-35`;
  `src/engine/chat/sessions/sessions.ts:22`
- **Evidence:**
  ```ts
  export async function startEngine({ fileSystem, appSkillFiles, isOnPath, claude, model, serveTools }: StartOptions) {
    const { engine, events, sessions } = wire({ fileSystem, appSkillFiles, claude, model, serveTools });
  ```
- **Raised by:** structural-analyst S-9
- **Confidence:** Verified
- **Bears on:** S-9, S-10

### C-3: Model ids are Anthropic-only, live in agent.ts, and have no thinking level

- **Claim:** `DEFAULT_MODEL` is `claude-sonnet-5`, the `haiku` alias is Haiku 4.5, and no code mentions thinking,
  effort, or reasoning.
- **Location:** `src/engine/chat/agent/agent.ts:37-56`
- **Evidence:**
  ```ts
  export const DEFAULT_MODEL = 'claude-sonnet-5';
  export const MODEL_ALIASES: Record<string, string> = {
    haiku: 'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-5',
    opus: 'claude-opus-5-5',
  };
  export function resolveModelId(model: string | undefined): string {
    if (!model) return DEFAULT_MODEL;
    return MODEL_ALIASES[model] ?? model;
  }
  ```
- **Raised by:** structural-analyst S-2; behavioral-analyst B-2
- **Confidence:** Verified
- **Bears on:** S-2, S-11; D-4

### C-4: ClaudeBackend is already a two-implementation seam, keyed by ClaudeMode

- **Claim:** `ClaudeBackend` has provider-neutral methods but a `mode: ClaudeMode` field, and `claudeBackend()` picks
  between two implementations with a ternary that turns any other value into CLI.
- **Location:** `src/engine/chat/claude-backend/claude-backend.ts:13-24,64-94`
- **Evidence:**
  ```ts
  export interface ClaudeBackend {
    readonly mode: ClaudeMode;
    readonly label: string;
    startupWarning(env: Record<string, string | undefined>, isOnPath: IsOnPath): string | undefined;
    chatModel(modelId: string, tools: ToolSet): LanguageModelV4;
    subagentModel(modelId: string, tools: ToolSet): LanguageModelV4;
    providerTools(): ToolSet;
  }
  export function claudeBackend(mode: ClaudeMode, serveTools: ServeTools): ClaudeBackend {
    return mode === 'api' ? apiBackend : cliBackend(serveTools);
  }
  ```
- **Raised by:** structural-analyst S-4; behavioral-analyst B-1
- **Confidence:** Verified
- **Bears on:** S-4, S-5, S-6, S-7; D-2

### C-5: Anthropic-specific pieces sit in the model path, the tool set, and the error text

- **Claim:** The system prompt carries an Anthropic cache marker that the CLI model also reads, the API model adds
  Anthropic cache settings and Anthropic-hosted web tools, and the missing-key text names only `ANTHROPIC_API_KEY`.
- **Location:** `src/engine/chat/agent/agent.ts:47-50,135`; `src/engine/chat/claude-backend/claude-backend.ts:27-31,
  58-75`; `src/engine/chat/claude-cli/claude-cli.ts:205`
- **Evidence:**
  ```ts
  { role: 'system', content: SYSTEM_PROMPT.trimEnd(), providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
  // claude-cli.ts
  system.findIndex((m) => m.providerOptions?.anthropic?.cacheControl) + 1
  // claude-backend.ts
  web_search: anthropic.tools.webSearch_20250305({ maxUses: 10 }),
  web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 10 }),
  // agent.ts
  if (LoadAPIKeyError.isInstance(error)) return MISSING_API_KEY_HELP;
  ```
  The research skill already handles `web_search` being absent (`src/skills/research/SKILL.md`), and CLI mode's
  `providerTools()` returns `{}` today.
- **Raised by:** structural-analyst S-3; behavioral-analyst B-3, B-7
- **Confidence:** Verified for the code; Unverified whether OpenAI, Gemini, and Ollama providers ignore an
  `anthropic`-keyed `providerOptions` entry, because those packages are not installed (see C-6, R-findings).
- **Bears on:** S-5, S-6, S-8; D-6, D-7

### C-6: Only the Anthropic provider package is installed

- **Claim:** `package.json` declares `@ai-sdk/anthropic` and no OpenAI, Google, or Ollama provider.
- **Location:** `package.json:9-12`; `node_modules/@ai-sdk/` holds `anthropic gateway mcp provider provider-utils react`
- **Evidence:**
  ```json
  "@ai-sdk/anthropic": "4.0.63",
  "@ai-sdk/react": "4.0.117",
  "ai": "7.0.114",
  ```
- **Raised by:** structural-analyst S-3; behavioral-analyst B-3; planner's sweep
- **Confidence:** Verified
- **Bears on:** S-6; D-3

### C-7: The AI SDK has one cross-provider reasoning option, and Anthropic and claude each take an effort level

- **Claim:** `ai@7`'s call settings take `reasoning: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' |
  'high' | 'xhigh'`; `@ai-sdk/anthropic` also takes `providerOptions.anthropic.effort: 'low' | 'medium' | 'high' |
  'xhigh' | 'max'`; and the installed `claude` program takes `--effort <low|medium|high|xhigh|max>`.
- **Location:** `node_modules/@ai-sdk/provider/dist/index.d.ts:1491`; `node_modules/ai/dist/index.d.ts:703-710`;
  `node_modules/@ai-sdk/anthropic/dist/index.d.ts:309-315`; `claude --help`
- **Evidence:**
  ```ts
  reasoning?: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  ```
  ```
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  ```
- **Raised by:** planner's sweep
- **Confidence:** Verified
- **Bears on:** S-2, S-5, S-7; D-4, D-8

### C-8: The claude program model passes the model id as `--model` and no effort

- **Claim:** `claudeArgs` builds the whole argv; the model enters only as `--model`, and no effort flag is passed.
- **Location:** `src/engine/chat/claude-cli/claude-cli.ts:210-232`
- **Evidence:**
  ```ts
  '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--input-format', 'text',
  '--model', modelId, '--system-prompt', system, '--no-session-persistence',
  ```
  `make check-node` calls `claudeCliModel('claude-sonnet-5', {}, { webTools: false, serveTools })` directly
  (`src/engine/node-check.ts`).
- **Raised by:** structural-analyst S-10, S-8; behavioral-analyst B-12
- **Confidence:** Verified
- **Bears on:** S-7; D-8

### C-9: State files under .3pitor/ are keyed by a closed union, and a corrupt file reads as missing

- **Claim:** `stateKey` accepts only `'session.json' | 'view.json'`; `readJson` returns `undefined` for both missing and
  unparseable files; writes are atomic, ordered per key, and keep `.3pitor/` out of git.
- **Location:** `src/engine/components/json-file.ts:6-37`; `src/engine/view-state/view-state.ts:9`
- **Evidence:**
  ```ts
  export const stateKey = (name: 'session.json' | 'view.json') => `.3pitor/${name}`;
  ```
  `view-state.ts` casts whatever parses to `ViewState` without checking its shape.
- **Raised by:** structural-analyst S-5; behavioral-analyst B-10
- **Confidence:** Verified
- **Bears on:** S-12, S-13; D-10

### C-10: Sessions carry no model, and creating one takes no input

- **Claim:** `Session` and `.3pitor/session.json` hold `{ id, messages, uiMessages }`; `create()`, the engine's
  `sessions.create`, `POST /api/sessions`, and the UI's call all take nothing.
- **Location:** `src/engine/chat/sessions/sessions.ts:10-18,64-70,160-162`;
  `src/server/chat/sessions/sessions.routes.ts:12-18`; `src/ui/app.tsx:31-36`
- **Evidence:**
  ```ts
  private save({ id, messages, uiMessages }: Session): Promise<void> {
    return writeJson(this.options.fileSystem, stateKey('session.json'), { id, messages, uiMessages });
  }
  ```
- **Raised by:** structural-analyst S-6; behavioral-analyst B-4, B-5
- **Confidence:** Verified
- **Bears on:** S-11, S-14; D-9

### C-11: CurrentSession.claude is on the wire but no UI code reads it

- **Claim:** `GET /api/sessions/current` returns `claude: ClaudeMode`; `app.tsx` destructures only `{ id, messages,
  running }`; only tests set the field.
- **Location:** `src/shared/wire.ts:72-81`; `src/engine/engine.ts:115`; `src/ui/app.tsx:49`
- **Evidence:**
  ```ts
  export interface CurrentSession<Message = unknown> {
    id: string;
    messages: Message[];
    running: boolean;
    claude: ClaudeMode;
  }
  ```
- **Raised by:** structural-analyst S-1; behavioral-analyst B-5
- **Confidence:** Verified
- **Bears on:** S-1, S-14; D-11

### C-12: The header is a fixed heading and New chat is a direct action; Menu is a single-step list

- **Claim:** `AgentPanel` renders `<h2>Claude</h2>` and a button that starts a new chat at once (after a confirm when
  the chat holds anything). `Menu` closes on every choice and takes icons only from a closed set of eight file and skill
  actions.
- **Location:** `src/ui/chat/agent-panel/agent-panel.tsx:7-32`; `src/ui/components/menu/menu.tsx:26-56`
- **Evidence:**
  ```tsx
  <h2>Claude</h2>
  <button ... onClick={() => (empty ? onNewChat() : setAsking(true))}>New chat</button>
  ```
  ```ts
  export type Item = { label: string; icon: Action; run: () => void };
  // onClick: onClose(); run();
  ```
- **Raised by:** structural-analyst S-7; behavioral-analyst B-13
- **Confidence:** Verified
- **Bears on:** S-15, S-16; D-12, D-13

### C-13: newChat has no error path

- **Claim:** `newChat` clears the review and error before an uncaught `POST /api/sessions`; a failure is an unhandled
  rejection with no message, and the server may already have switched its current session.
- **Location:** `src/ui/app.tsx:31-36`; `src/engine/chat/sessions/sessions.ts:64-70`
- **Evidence:**
  ```ts
  const newChat = async () => {
    docs.dismissReview();
    setChatError(undefined);
    setFocusChat(true);
    setStarted({ id: (await api('POST', '/api/sessions')).id, messages: [], waiting: false });
  };
  ```
- **Raised by:** behavioral-analyst B-6
- **Confidence:** Verified
- **Bears on:** S-16; D-14

### C-14: Options are shared by every session, and New chat in one tab changes the current session for all

- **Claim:** `Sessions.options` is one object read inside each turn's stream after an await; `currentId` is global; no
  event announces a new session.
- **Location:** `src/engine/chat/sessions/sessions.ts:27-35,80-117`; `src/shared/wire.ts:4-7`
- **Evidence:**
  ```ts
  const result = streamText({
    ...(await agentSettings(this.options, this.events, sessionId, turn, writer)),
  ```
- **Raised by:** behavioral-analyst B-9
- **Confidence:** Verified
- **Bears on:** S-11; D-9

### C-15: Stored history is replayed to the next model as is

- **Claim:** Each turn sends `[...session.messages, userTurn]`; API mode forwards stored parts unchanged, and CLI mode
  flattens them to text, dropping reasoning and file parts.
- **Location:** `src/engine/chat/sessions/sessions.ts:103,122-123`; `src/engine/chat/claude-cli/claude-cli.ts:258-282`
- **Evidence:**
  ```ts
  // Reasoning and file parts are left out.
  if (part.type === 'text') return [part.text];
  ```
- **Raised by:** behavioral-analyst B-8
- **Confidence:** Unverified for what OpenAI, Gemini, and Ollama do with Anthropic reasoning parts or
  `providerOptions` in history, because no such provider is installed and no session file with reasoning exists.
- **Bears on:** S-11; D-9

### C-16: Error mapping and readiness checks know one provider each

- **Claim:** `modelErrorMessage` maps every `LoadAPIKeyError` to the Anthropic text; the startup warning reads
  `ANTHROPIC_API_KEY` or looks for `claude` once, prints to the terminal only, and never runs again.
- **Location:** `src/engine/chat/agent/agent.ts:46-50`; `src/engine/engine.ts:90-93`;
  `src/engine/chat/claude-backend/claude-backend.ts:67,84`
- **Evidence:**
  ```ts
  startupWarning: (env) => (env.ANTHROPIC_API_KEY ? undefined : MISSING_API_KEY_HELP),
  ```
- **Raised by:** structural-analyst S-3, S-4; behavioral-analyst B-7, B-11
- **Confidence:** Verified
- **Bears on:** S-5, S-8, S-9; D-7

### C-17: Tests reach models through a module mock of @ai-sdk/anthropic and a fake claude on PATH

- **Claim:** `useModel` replaces `@ai-sdk/anthropic` for the test process, so only models built with `anthropic()` get
  the scripted model; the fake `claude` takes all its inputs from argv, stdin, and env.
- **Location:** `src/engine/chat/components/test-model.ts:6-9,61`; `src/engine/chat/components/fake-claude.ts`;
  `src/engine/chat/components/fake-claude-on-path.ts`; `src/engine/bun-free.test.ts:22-23`
- **Evidence:**
  ```ts
  export function useModel(model: MockLanguageModelV4) {
    mock.module('@ai-sdk/anthropic', () => ({ anthropic: Object.assign(() => model, { tools: providerTools }) }));
  }
  ```
  Tests pass `claude: 'api'` to `createEngine`, `Sessions`, and the mock current session (`engine.test.ts:35,51`,
  `sessions.test.ts:34`, `app.test.tsx`, `sessions.routes.test.ts:49`). `make check-build` starts the binary with
  `ANTHROPIC_API_KEY=unused`.
- **Raised by:** structural-analyst S-8
- **Confidence:** Verified
- **Bears on:** S-6, S-10, Unit sequencing; D-15

### C-18: Provider packages exist for OpenAI and Gemini; Ollama has only community or OpenAI-compatible routes

- **Claim:** `@ai-sdk/openai` (newest pin at least two weeks old: 4.0.80) and `@ai-sdk/google` (4.0.85) implement
  LanguageModelV4 for `ai@7`. Ollama has no official provider. `@ai-sdk/openai-compatible` (3.0.59) works against
  Ollama's `/v1` endpoint, and `ollama-ai-provider-v2` (4.0.1) is a single-maintainer community package.
- **Location:** npm registry and unpkg sources, retrieved 2026-10-13
- **Evidence:** OpenAI reads `OPENAI_API_KEY`; Google reads `GOOGLE_GENERATIVE_AI_API_KEY`; neither Ollama route reads
  any environment variable, so the caller supplies `baseURL` (Ollama's default host is `http://localhost:11434`) and,
  for the compatible route, a placeholder `apiKey` Ollama ignores.
- **Raised by:** research-analyst R-1
- **Confidence:** Verified from the registry and source excerpts; Unverified at runtime, because nothing was installed
  or called.
- **Bears on:** S-6; D-3

### C-19: Each provider maps the AI SDK's `reasoning` option differently, and unsupported levels warn rather than fail

- **Claim:** Anthropic maps `reasoning` to its adaptive-thinking effort (`none` turns thinking off, except on models
  that reject that, where it becomes `low`); its own `effort` option adds `max`. OpenAI passes it through as
  `reasoning_effort`, checked per model. Gemini maps it to `thinkingLevel` (3.x) or a token budget (2.x).
  `@ai-sdk/openai-compatible` passes it through as `reasoning_effort`, which Ollama accepts. An unsupported level is a
  warning and is dropped.
- **Location:** `node_modules/@ai-sdk/anthropic/dist/index.js` (lines 4405-4423, 6547-6597); `@ai-sdk/openai@4.0.80`
  and `@ai-sdk/google@4.0.85` sources; `node_modules/@ai-sdk/provider-utils/dist/index.js:1773-1827`
- **Evidence:** see the research report summarized here; `isCustomReasoning` is true for every value but `undefined`
  and `'provider-default'`.
- **Raised by:** research-analyst R-2
- **Confidence:** Verified for Anthropic (installed source). Partly verified for OpenAI and Gemini (truncated source
  excerpts and docs).
- **Bears on:** S-2, S-5, S-6; D-4

### C-20: Current model ids as of 2026-10-13

- **Claim:** Claude: `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` (all adaptive
  thinking, all with tool use), with `claude-sonnet-5` and others still available. OpenAI: `gpt-6-astra`,
  `gpt-6.1-sol`, `gpt-6-luna`, all with function calling. Gemini: stable `gemini-3.8-flash`, `gemini-3.6-flash`,
  `gemini-3.5-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`.
- **Location:** Anthropic, OpenAI, and Google model pages, retrieved 2026-10-13
- **Evidence:** The installed `@ai-sdk/anthropic` types lack `claude-haiku-5-5` and `claude-sonnet-5-5` in their
  union, but the type is `string & {}`, so they still type-check.
- **Raised by:** research-analyst R-3
- **Confidence:** Verified from vendor docs; Unverified for any given account's access.
- **Bears on:** S-2; D-4

### C-21: Hosted providers list models without the capabilities 3pitor needs; Ollama's list is the user's own

- **Claim:** OpenAI's `GET /v1/models` returns every model, embeddings and audio included, with no capability fields.
  Gemini's and Anthropic's lists carry more. Ollama's `GET /api/tags` returns the models the operator has pulled, with
  no tool or thinking capability fields.
- **Location:** vendor API references, retrieved 2026-10-13
- **Evidence:** see research report R-4.
- **Raised by:** research-analyst R-4
- **Confidence:** Verified from docs.
- **Bears on:** S-2, S-17; D-4, D-16

### C-22: Ollama tool calling depends on the model

- **Claim:** Ollama supports tool calls, but only on models trained for them; its OpenAI-compatible endpoint ignores
  `tool_choice`. 3pitor's chat depends on tool calls for every edit.
- **Location:** `https://docs.ollama.com/capabilities/tool-calling`, `https://docs.ollama.com/api/openai-compatibility`
- **Evidence:** see research report R-5. 3pitor never forces a tool choice (`grep toolChoice src` finds nothing).
- **Raised by:** research-analyst R-5; planner's grep
- **Confidence:** Verified from docs; Unverified at runtime.
- **Bears on:** S-6; D-3

## Findings No Agent Could Audit

- Live behavior of OpenAI, Gemini, and Ollama through the AI SDK: tool calling, the `reasoning` mapping, and what each
  does with foreign `providerOptions` or reasoning parts in history. Closing it takes installing the packages and making
  real calls with keys and a running Ollama, which this run did not do. The research findings (R-n) are from published
  docs and type declarations, not calls.
- Whether the installed `claude` program accepts the API-style id `claude-haiku-5-5` for `--model`. Closing it takes one
  real `claude` call; the help text says it takes "an alias for the latest model ... or a model's full name".

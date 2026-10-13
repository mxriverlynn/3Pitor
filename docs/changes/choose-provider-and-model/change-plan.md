# Change Plan: Choose Provider and Model

## Why This Change

The writer wants to choose which AI runs each chat: the provider, the model, and the thinking level. Today that choice
is fixed when 3pitor starts, and it is always Claude. This is a new requirement, a constraint arriving, in the operator's
own words ([scope-boundary.md](artifacts/scope-boundary.md)):

> to support different claude code models, and add support for the other LLM services and models. the [Image #4] header
> row should show the current provider and model selection (including whether or not it's local or API). when clicking
> "New Chat", the pop up menu should give me a list of available providers. ... save the selected provider, model,
> level to a json config file at .3pitor/config.json, under a "selectedModel" section. ... if there is no config file,
> or selected model section, default to Claude, Haiku v5.5 on medium thinking. also, when the app first loads, use the
> config or default ...

The operator confirmed five providers: Claude through the `claude` program (local), Claude through the Anthropic API,
OpenAI, Google Gemini, and Ollama (local). They also confirmed that the planner makes the design decisions and reports
behavior changes afterwards ([D-1](artifacts/change-decision-log.md#trivial-decisions)).

## What Changes, In One Paragraph

After this change, each chat session owns a model selection: a provider, a model, and an optional thinking level. New
chat opens a small picker with the saved selection already chosen. Starting the chat saves the selection to
`.3pitor/config.json` under `selectedModel`. At startup, the current chat uses that saved selection, or Claude Haiku 5.5
on medium thinking when none is saved. The chat panel's header shows the provider, the model, the thinking level, and
whether it runs locally or through an API. One provider module holds everything that differs between the five
providers: how to build the model, how to apply the thinking level, which models to offer, and what to say when a
provider cannot work. The rest of the chat (the turn, subagents, tools, history, and edits) does not know which
provider it is talking to. The `--claude` startup flag and the `MODEL` environment variable go away, because the picker
does their job.

## Current State

The choice of AI is made once, at startup, and copied through five modules as two separate values: how Claude is
reached, and a model id. Every turn reads them and nothing changes them
([C-1](artifacts/current-state-findings.md#c-1-the-mode-and-the-model-travel-from-argv-to-the-model-call-as-two-process-wide-constants)).
Three option types repeat those values
([C-2](artifacts/current-state-findings.md#c-2-three-option-types-repeat-the-same-startup-configuration)). Model ids are
Claude-only, and no code knows about thinking levels
([C-3](artifacts/current-state-findings.md#c-3-model-ids-are-anthropic-only-live-in-agentts-and-have-no-thinking-level)).
Sessions carry no model, and creating one takes no input
([C-10](artifacts/current-state-findings.md#c-10-sessions-carry-no-model-and-creating-one-takes-no-input)).

The structural property this change works on is the backend seam. `ClaudeBackend` already gives the chat one interface
with two implementations, and the chat never checks which one it has
([C-4](artifacts/current-state-findings.md#c-4-claudebackend-is-already-a-two-implementation-seam-keyed-by-claudemode)).
What blocks other providers is what sits around that seam:

- The seam is keyed by a two-value mode, and anything that is not `'api'` becomes the `claude` program
  ([C-4](artifacts/current-state-findings.md#c-4-claudebackend-is-already-a-two-implementation-seam-keyed-by-claudemode)).
- Anthropic-only pieces sit in the model path: cache settings, Anthropic-hosted web tools, and a missing-key message that
  names only `ANTHROPIC_API_KEY`
  ([C-5](artifacts/current-state-findings.md#c-5-anthropic-specific-pieces-sit-in-the-model-path-the-tool-set-and-the-error-text),
  [C-16](artifacts/current-state-findings.md#c-16-error-mapping-and-readiness-checks-know-one-provider-each)).
- Only the Anthropic provider package is installed
  ([C-6](artifacts/current-state-findings.md#c-6-only-the-anthropic-provider-package-is-installed)).

The UI shows a fixed "Claude" heading. New chat starts a chat at once, and the existing menu component closes on every
choice
([C-12](artifacts/current-state-findings.md#c-12-the-header-is-a-fixed-heading-and-new-chat-is-a-direct-action-menu-is-a-single-step-list)).
The UI already gets `claude` from the server but never reads it
([C-11](artifacts/current-state-findings.md#c-11-currentsessionclaude-is-on-the-wire-but-no-ui-code-reads-it)).

## Target State

### The selection, and where it lives

A model selection names a provider, a model id, and an optional thinking level. Each in-memory session holds one. The
selection changes only when a new chat starts, so a session's history is always produced by one provider
([D-7](artifacts/change-decision-log.md#d-7-the-selection-belongs-to-the-session)).

These types go in `src/shared/wire.ts`, which stays import-free
([D-12](artifacts/change-decision-log.md#d-12-the-wire-carries-the-selection-and-its-display-labels)):

```ts
export type ProviderId = 'claude-cli' | 'claude-api' | 'openai' | 'google' | 'ollama';
export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// What the writer chose. `thinking` is absent when the model offers no levels.
export interface ModelSelection {
  provider: ProviderId;
  model: string;          // the provider's full model id, e.g. 'claude-haiku-5-5', or an Ollama tag 'llama3.2:latest'
  thinking?: ThinkingLevel;
}

// A selection plus what the header shows. Labels come from the static catalog, so no network call is needed.
export interface ModelChoice extends ModelSelection {
  providerLabel: string;  // 'Claude' | 'OpenAI' | 'Google Gemini' | 'Ollama'
  modelLabel: string;     // the catalog label, e.g. 'Haiku 5.5'; the raw id for Ollama or an id not in the catalog
  access: 'local' | 'api';
}

export interface ModelInfo { id: string; label: string; thinking: ThinkingLevel[] }   // [] = no thinking list
export interface ProviderEntry {
  id: ProviderId;
  label: string;
  access: 'local' | 'api';
  problem?: string;       // why it cannot work right now; the picker disables the provider and shows this
  models: ModelInfo[];
}
// GET /api/models
export interface ModelCatalog { providers: ProviderEntry[]; selected: ModelSelection }

// GET /api/sessions/current; `claude` is replaced by `model`.
export interface CurrentSession<Message = unknown> {
  id: string;
  messages: Message[];
  running: boolean;
  model: ModelChoice;
}
```

### The config file

A new module, `src/engine/model-config/model-config.ts`, reads, checks, and writes `.3pitor/config.json`. It checks the
shape of what it reads; it never casts the parsed value unchecked, as `view-state.ts` does
([D-8](artifacts/change-decision-log.md#d-8-one-module-reads-checks-and-writes-3pitorconfigjson),
[C-9](artifacts/current-state-findings.md#c-9-state-files-under-3pitor-are-keyed-by-a-closed-union-and-a-corrupt-file-reads-as-missing)).

```ts
type Env = Record<string, string | undefined>;
// A known provider, a non-empty model string, and thinking absent or a ThinkingLevel; else undefined.
// It does not check the model against the catalog, so no call waits on Ollama.
export function parseSelection(value: unknown): ModelSelection | undefined;
// { provider: env.ANTHROPIC_API_KEY ? 'claude-api' : 'claude-cli', model: 'claude-haiku-5-5', thinking: 'medium' }
export function defaultSelection(env: Env): ModelSelection;
// parseSelection(config.selectedModel) ?? defaultSelection(env). Warns once when selectedModel is present but invalid.
export function loadSelection(fileSystem: FileSystem, env: Env): Promise<ModelSelection>;
// Reads the file, replaces selectedModel, keeps every other key, and writes atomically. A file that is not a JSON
// object starts from {}. Rejects when the write fails.
export function saveSelection(fileSystem: FileSystem, selection: ModelSelection): Promise<void>;
```

Worked example. Before: `{ "selectedModel": { "provider": "claude-api", "model": "claude-haiku-5-5", "thinking":
"medium" }, "theme": "dark" }`. The writer starts a chat on Ollama's `llama3.2:latest`. After: `{ "selectedModel": {
"provider": "ollama", "model": "llama3.2:latest" }, "theme": "dark" }`.

Nothing writes the file until a chat starts from the picker or `POST /api/sessions`. A folder where nobody starts a new
chat gets no config file, the same rule `session.json` follows today. The default depends on the API key, so "Claude"
means the API when `ANTHROPIC_API_KEY` is set and the `claude` program otherwise. That is today's `auto` rule, applied
only to the default
([D-9](artifacts/change-decision-log.md#d-9-the-default-is-haiku-55-on-medium-through-the-api-when-a-key-is-set)).

### The provider module

`src/engine/chat/claude-backend/` becomes `src/engine/chat/providers/`, one file per provider plus the shared interface
([D-2](artifacts/change-decision-log.md#d-2-one-provider-module-with-one-backend-per-provider)). The interface is
today's `ClaudeBackend`, widened:

```ts
export interface ProviderBackend {
  readonly id: ProviderId;
  readonly label: string;                 // 'Claude' | 'OpenAI' | 'Google Gemini' | 'Ollama'
  readonly access: 'local' | 'api';
  // Why this provider cannot work right now, or undefined. Synchronous. Startup prints it for the current selection;
  // GET /api/models sends it so the picker can disable the provider.
  problem(env: Env, isOnPath: IsOnPath): string | undefined;
  // The models the picker offers. Static providers resolve at once. Ollama fetches, and rejects with a readable message.
  models(env: Env): Promise<ModelInfo[]>;
  chatModel(modelId: string, thinking: ThinkingLevel | undefined, tools: ToolSet): LanguageModelV4;
  subagentModel(modelId: string, thinking: ThinkingLevel | undefined, tools: ToolSet): LanguageModelV4;
  providerTools(): ToolSet;               // web_search and web_fetch in claude-api; {} elsewhere
  readonly missingKeyHelp?: string;       // the three API-key providers; modelErrorMessage uses it
}

// Built once, in wire(). The claude-cli backend needs serveTools. Key order is the picker's order.
export function providerBackends(serveTools: ServeTools): Record<ProviderId, ProviderBackend>;
```

| `id` | File | `label` | `access` | `problem()` returns text when | Model built with |
| --- | --- | --- | --- | --- | --- |
| `claude-cli` | `claude-program.ts` | Claude | local | `claude` is not on `PATH` (`CLAUDE_NOT_FOUND_HELP`) | `claudeCliModel` |
| `claude-api` | `anthropic.ts` | Claude | api | `ANTHROPIC_API_KEY` is empty (`MISSING_API_KEY_HELP`) | `anthropic(id)` |
| `openai` | `openai.ts` | OpenAI | api | `OPENAI_API_KEY` is empty | `openai(id)` |
| `google` | `google.ts` | Google Gemini | api | `GOOGLE_GENERATIVE_AI_API_KEY` is empty | `google(id)` |
| `ollama` | `ollama.ts` | Ollama | local | never; a failure shows up as `models()` rejecting | `createOpenAICompatible` at `{host}/v1` |

The packages are `@ai-sdk/openai@4.0.80`, `@ai-sdk/google@4.0.85`, and `@ai-sdk/openai-compatible@3.0.59`, pinned to
exact versions as `package.json` does today
([D-3](artifacts/change-decision-log.md#d-3-add-the-openai-and-google-packages-and-reach-ollama-through-its-openai-compatible-endpoint)).
Ollama is reached through its OpenAI-compatible endpoint, with the host taken from `OLLAMA_HOST` or
`http://localhost:11434`. A value without a scheme, such as `0.0.0.0:11434`, gets `http://` added. Ollama lists the
operator's pulled models live from `GET {host}/api/tags`, with a one-second timeout
([D-19](artifacts/change-decision-log.md#d-19-ollama-lists-the-operators-models-live-with-a-one-second-timeout)).

### Models and thinking levels

The catalog is a static list in each backend, except Ollama's
([D-4](artifacts/change-decision-log.md#d-4-a-static-catalog-with-thinking-levels-per-model)):

| Provider | Models (id → label) | Thinking levels |
| --- | --- | --- |
| `claude-cli`, `claude-api` | `claude-haiku-5-5` → Haiku 5.5, `claude-sonnet-5-5` → Sonnet 5.5, `claude-opus-5-5` → Opus 5.5, `claude-fable-5-1` → Fable 5.1 | low, medium, high, xhigh, max |
| `openai` | `gpt-6-astra` → GPT-6 Astra, `gpt-6.1-sol` → GPT-6.1 Sol, `gpt-6-luna` → GPT-6 Luna | low, medium, high |
| `google` | `gemini-3.8-flash` → Gemini 3.8 Flash, `gemini-3.6-flash` → Gemini 3.6 Flash, `gemini-2.5-pro` → Gemini 2.5 Pro, `gemini-2.5-flash` → Gemini 2.5 Flash | low, medium, high |
| `ollama` | each pulled model, `name` → `name` | none |

Each backend applies the level inside the model it builds, so `agentSettings` stays provider-blind
([D-5](artifacts/change-decision-log.md#d-5-each-backend-applies-the-thinking-level-inside-its-own-model)):

| Provider | How a level reaches the model |
| --- | --- |
| `claude-api` | `defaultSettingsMiddleware({ settings: { providerOptions: { anthropic: { effort } } } })`, stacked with today's cache middleware; the two deep-merge |
| `claude-cli` | `claudeCliModel`'s options gain an optional `effort`; `claudeArgs` appends `'--effort', effort` when it is set |
| `openai`, `google` | a middleware `{ transformParams: async ({ params }) => ({ ...params, reasoning: level }) }`, the AI SDK's cross-provider option |
| `ollama` | none |
| any, `thinking` undefined | nothing is added, so the provider's default applies |

Subagents get the same model and thinking level as the chat. A level a model does not support is a warning the AI SDK
drops, not a failed call
([C-19](artifacts/current-state-findings.md#c-19-each-provider-maps-the-ai-sdks-reasoning-option-differently-and-unsupported-levels-warn-rather-than-fail)).

### Errors and readiness

`modelErrorMessage(error, backend)` returns `backend.missingKeyHelp` for a `LoadAPIKeyError`, falling back to the
error's own message, and otherwise behaves as today. Its three call sites in `sessions.ts` pass the session's backend
([D-6](artifacts/change-decision-log.md#d-6-each-provider-says-what-is-wrong-in-its-own-words)). The missing-key help
for each API provider has the same shape as today's Anthropic text: what is missing, where to create a key, and how to
start 3pitor with it.

```
OPENAI_API_KEY is not set, so chat won't work with OpenAI.

To fix it, create a key at https://platform.openai.com/api-keys, then start 3pitor with it:

  OPENAI_API_KEY=sk-... 3pitor
```

### Sessions and the engine

`Session` gains `selection: ModelSelection`. `Sessions.load()` sets it from `loadSelection`. `create(selection)` sets it
on the new session. `agentSettings` takes the session's backend and selection instead of reading `claude` and `model`
from options ([D-7](artifacts/change-decision-log.md#d-7-the-selection-belongs-to-the-session)):

```ts
// sessions.ts
create(selection?: ModelSelection): Promise<Session>
// selection ?? await loadSelection(fs, env); then await saveSelection; then save session.json; then make it current.
// A rejected write leaves the old session current (today it switches first; see S-11).

// agent.ts
agentSettings(options: AgentOptions, backend: ProviderBackend, selection: ModelSelection,
              events: EventBus, ownerId: string, turn: TurnTexts, writer?: UIMessageStreamWriter)
```

`StartOptions` folds into `EngineOptions`, which loses `claude` and `model` and gains `env` and `isOnPath`. Tests pass
`env` to keep a real Ollama and real keys out of the picture
([D-11](artifacts/change-decision-log.md#d-11-one-engine-options-type-carrying-env-and-isonpath)):

```ts
export interface EngineOptions {
  fileSystem: FileSystem;
  appSkillFiles: AppSkillFiles;
  serveTools: ServeTools;
  env: Record<string, string | undefined>;   // process.env from cli.ts
  isOnPath: IsOnPath;
  maxSteps?: number;
}
// The engine gains:
readonly models: { list(): Promise<ModelCatalog> };   // re-reads config.json on every call
// and sessions.create takes the selection:
create(selection?: ModelSelection): Promise<{ id: string; model: ModelChoice }>;
```

`models.list()` asks every backend for `problem()` and `models()` in parallel. A rejected `models()` becomes that
provider's `problem`, with `models: []`.

### Routes

`GET /api/models` is new, in `src/server/chat/models/models.routes.ts`
([D-13](artifacts/change-decision-log.md#d-13-get-apimodels-is-new-and-post-apisessions-takes-an-optional-selection)):

```json
{
  "providers": [
    { "id": "claude-cli", "label": "Claude", "access": "local",
      "models": [{ "id": "claude-haiku-5-5", "label": "Haiku 5.5", "thinking": ["low", "medium", "high", "xhigh", "max"] }] },
    { "id": "openai", "label": "OpenAI", "access": "api",
      "problem": "OPENAI_API_KEY is not set, so chat won't work with OpenAI. ...", "models": [] },
    { "id": "ollama", "label": "Ollama", "access": "local",
      "problem": "Ollama is not running at http://localhost:11434", "models": [] }
  ],
  "selected": { "provider": "claude-api", "model": "claude-haiku-5-5", "thinking": "medium" }
}
```

`POST /api/sessions` takes an optional body `{ "selection": ModelSelection }`:

| Request body | Response |
| --- | --- |
| none, or no `selection` | 201 `{ id, model }`, using the saved selection (what `scripts/check.ts` sends) |
| a `selection` that `parseSelection` accepts | 201 `{ id, model }`, and `config.json` holds that selection |
| a `selection` that `parseSelection` rejects | 400 `{ "error": "selection must name a known provider and a model" }`; nothing changes |
| a write to `.3pitor/` fails | 500 `{ error }`, as today; the old session stays current |

### The UI

The `AgentPanel` header shows the current choice. It reads `Claude`, then a `Local` or `API` badge, then
`Haiku 5.5 · medium`. The thinking part is left out when there is no level
([D-14](artifacts/change-decision-log.md#d-14-the-header-shows-provider-access-model-and-level)).

New chat opens a `ModelPicker` popover, a new component in `src/ui/chat/model-picker/`
([D-15](artifacts/change-decision-log.md#d-15-new-chat-opens-a-picker-with-three-lists-and-a-start-button)):

1. The picker fetches `GET /api/models` each time it opens, and preselects `selected`.
2. A Provider list shows every provider with its access. A provider with a `problem` is disabled, and the reason shows
   beside it.
3. A Model list shows the chosen provider's models. Changing the provider selects that provider's first model.
4. A Thinking list shows only when the chosen model has levels. Changing the model keeps the current level if the new
   model offers it, else picks `medium`, else the first level.
5. Start, then the existing confirm dialog when the chat holds anything, then `newChat(selection)`.

`newChat(selection)` posts the selection. It dismisses the review only after the post succeeds, and shows the failure
in the chat's error line when it does not
([D-16](artifacts/change-decision-log.md#d-16-new-chat-reports-a-failure-and-changes-nothing-until-it-succeeds)).

### Startup

Startup prints the current selection and the selected provider's problem, if any
([D-17](artifacts/change-decision-log.md#d-17-startup-names-the-provider-model-and-level-it-will-use)):

```
3pitor chat: Claude (API) · claude-haiku-5-5 · medium
3pitor chat: Ollama (local) · llama3.2:latest
```

The `3pitor listening on <url> (workspace: <path>)` line is unchanged, because `make check-build` and
`scripts/check.ts` read it.

## Surface Delta

### S-1: `src/engine/chat/claude-backend/` — Moved

**Target state.** The provider module lives at `src/engine/chat/providers/`. `providers.ts` holds the interface,
`providerBackends()`, `IsOnPath`, and `MISSING_API_KEY_HELP`. Each provider has its own file: `anthropic.ts`,
`claude-program.ts`, `openai.ts`, `google.ts`, and `ollama.ts`. The two existing backends do what they did before.

**Behavior.** Preserving. A file move with no change to what any backend builds.

**Why.** The module now holds five providers, and its old name says it holds one.

**Migration.** Import from `../providers/providers` where code imported `../claude-backend/claude-backend`.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-one-provider-module-with-one-backend-per-provider)

### S-2: `ClaudeBackend` — Renamed

**Target state.** The interface is named `ProviderBackend`. In this entry alone, it is unchanged in every other respect.

**Behavior.** Preserving. A type rename.

**Why.** The interface describes any provider.

**Depends on.** S-1.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-one-provider-module-with-one-backend-per-provider)

### S-3: `ProviderBackend` — Re-scoped

**Target state.** `ProviderBackend` is the one place a provider's differences live. Its `id: ProviderId` replaces
`mode: ClaudeMode`. It adds `access`, `models(env)`, and an optional `missingKeyHelp`. `problem(env, isOnPath)`
replaces `startupWarning` with the same arguments and return. `chatModel` and `subagentModel` take a `thinking`
argument and apply it inside the model they build. The signature is pinned in Target State.

**Behavior.** Preserving for the two existing backends when `thinking` is undefined: they build the same model with the
same tools. The thinking a selection carries is a behavior change, recorded at S-11.

**Why.** Each provider differs in model, thinking, catalog, readiness, and error text. Keeping all of that behind one
interface keeps `agentSettings` and the turn provider-blind
([C-4](artifacts/current-state-findings.md#c-4-claudebackend-is-already-a-two-implementation-seam-keyed-by-claudemode)).

**Depends on.** S-2.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-one-provider-module-with-one-backend-per-provider),
[D-5](artifacts/change-decision-log.md#d-5-each-backend-applies-the-thinking-level-inside-its-own-model),
[D-6](artifacts/change-decision-log.md#d-6-each-provider-says-what-is-wrong-in-its-own-words)

### S-4: `claudeBackend(mode, serveTools)` — Removed

**Target state.** `claudeBackend` does not exist. Choosing a backend is a lookup by the selection's provider in the
record `providerBackends()` returns.

**Behavior.** Preserving. Today's two modes map to `claude-api` and `claude-cli`, which build the same models.

**Why.** Its ternary turns every value that is not `'api'` into the `claude` program
([C-4](artifacts/current-state-findings.md#c-4-claudebackend-is-already-a-two-implementation-seam-keyed-by-claudemode)).

**Migration.** `backends[selection.provider]`.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-one-provider-module-with-one-backend-per-provider)

### S-5: `providerBackends(serveTools)` — Added

**Target state.** `providerBackends` exists in `providers.ts`. It returns a `Record<ProviderId, ProviderBackend>` whose
key order is the picker's order: `claude-cli`, `claude-api`, `openai`, `google`, `ollama`. `wire()` builds it once.

**Behavior.** Preserving. New code with no existing caller.

**Why.** The engine, the sessions, and `models.list()` need every backend, and the CLI backend needs `serveTools`.

**Depends on.** S-3.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-one-provider-module-with-one-backend-per-provider)

### S-6: OpenAI, Google Gemini, and Ollama backends — Added

**Target state.** `openai.ts`, `google.ts`, and `ollama.ts` each export a `ProviderBackend`, as pinned in the Target
State tables. `package.json` adds `@ai-sdk/openai@4.0.80`, `@ai-sdk/google@4.0.85`, and
`@ai-sdk/openai-compatible@3.0.59`. Ollama's `models()` fetches `{host}/api/tags` with `AbortSignal.timeout(1000)`. It
rejects with `Ollama is not running at {host}` when it cannot connect, and with `Ollama at {host} answered {status}`
for a non-OK answer.

**Behavior.** Preserving. New providers that nothing used before.

**Why.** The confirmed scope names these providers
([scope-boundary.md](artifacts/scope-boundary.md#operator-confirmed-scope)).

**Depends on.** S-3, S-5.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-add-the-openai-and-google-packages-and-reach-ollama-through-its-openai-compatible-endpoint),
[D-4](artifacts/change-decision-log.md#d-4-a-static-catalog-with-thinking-levels-per-model),
[D-19](artifacts/change-decision-log.md#d-19-ollama-lists-the-operators-models-live-with-a-one-second-timeout)

### S-7: `claudeCliModel` options `effort` — Added

**Target state.** `claudeCliModel(modelId, tools, { webTools, serveTools, effort? })` passes `--effort <effort>` to
`claude` when `effort` is set, and passes nothing extra when it is not.

**Behavior.** Preserving when `effort` is absent, which is how `make check-node` calls it
([C-8](artifacts/current-state-findings.md#c-8-the-claude-program-model-passes-the-model-id-as---model-and-no-effort)).

**Why.** `claude` takes `--effort low|medium|high|xhigh|max`. On 2026-10-13 the installed `claude` accepted
`--model claude-haiku-5-5` with both `--effort medium` and `--effort max`
([D-5](artifacts/change-decision-log.md#d-5-each-backend-applies-the-thinking-level-inside-its-own-model)).

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-each-backend-applies-the-thinking-level-inside-its-own-model)

### S-8: `modelErrorMessage` — Re-scoped

**Target state.** `modelErrorMessage(error, backend)` returns `backend.missingKeyHelp` for a `LoadAPIKeyError` when the
backend has one, and the error's own message otherwise.

**Behavior.** Preserving for `claude-api`, whose `missingKeyHelp` is today's `MISSING_API_KEY_HELP`. New providers get
their own text.

**Why.** Today every missing key reads as a missing Anthropic key
([C-16](artifacts/current-state-findings.md#c-16-error-mapping-and-readiness-checks-know-one-provider-each)).

**Depends on.** S-3.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-each-provider-says-what-is-wrong-in-its-own-words)

### S-9: `--claude`, `ClaudeMode`, and `MODEL` — Removed

**Target state.** 3pitor has no `--claude` option, and no `ClaudeMode` type. It no longer reads the `MODEL`
environment variable. `parseCommandLine` returns `{ target }` or a print request. Its `env` parameter goes away, because
nothing in it reads the environment any more. `USAGE` is
`Usage: 3pitor [--version|-v] [--help] [folder-or-file]`. Which provider and model chat uses is the session's
selection.

**Behavior.** Changing. `3pitor --claude=cli` stops with `3pitor: Unknown option '--claude'` and the usage, exit code 2.
`MODEL=opus 3pitor` starts on the saved selection and ignores `MODEL`. Settled by the planner under the operator's
delegation.

**Why.** The picker chooses both the way Claude is reached and the model, per chat. A startup flag that also chose them
would compete with the saved selection.

**Migration.** Choose Claude (local) or Claude (API) and the model in the New chat picker. The choice is remembered.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-remove---claude-and-model)

### S-10: `EngineOptions` and `StartOptions` — Re-scoped

**Target state.** `EngineOptions` is the one options type for `createEngine` and `startEngine`, pinned in Target State.
It carries `env` and `isOnPath` and no `claude` or `model`. `StartOptions` does not exist. `AgentOptions` keeps
`fileSystem` and `appSkillFiles` and loses `model`, `claude`, and `serveTools`.

**Behavior.** Preserving. Construction-site shape only.

**Why.** Three types repeat the same configuration
([C-2](artifacts/current-state-findings.md#c-2-three-option-types-repeat-the-same-startup-configuration)), and the
picker's `problem()` check needs `env` and `isOnPath` at request time, not only at startup.

**Migration.** Pass `env: process.env` and `isOnPath` to `startEngine`. In tests, pass `env: {}` or a test env.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-one-engine-options-type-carrying-env-and-isonpath)

### S-11: `Session`, `Sessions.load`, `Sessions.create`, and `agentSettings` — Re-scoped

**Target state.** Each `Session` holds the `selection` its turns use. `load()` takes it from `loadSelection`.
`create(selection?)` uses the given selection, or the saved one. It saves the selection, then writes `session.json`,
then makes the session current. `agentSettings` builds the turn's model from the session's backend and selection.
`session.json` still stores `{ id, messages, uiMessages }` only.

**Behavior.** Changing:

- The model a chat uses comes from the saved selection or the default, Claude Haiku 5.5 on medium thinking. Today it is
  `claude-sonnet-5` with the provider's default thinking.
- A failed write during New chat leaves the old session current. Today the server switches first and then fails.

Settled by the planner under the operator's delegation; the default is the operator's own.

**Why.** Process-wide constants cannot vary per chat
([C-1](artifacts/current-state-findings.md#c-1-the-mode-and-the-model-travel-from-argv-to-the-model-call-as-two-process-wide-constants),
[C-14](artifacts/current-state-findings.md#c-14-options-are-shared-by-every-session-and-new-chat-in-one-tab-changes-the-current-session-for-all)).

**Depends on.** S-5, S-10, S-12.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-the-selection-belongs-to-the-session),
[D-9](artifacts/change-decision-log.md#d-9-the-default-is-haiku-55-on-medium-through-the-api-when-a-key-is-set),
[D-16](artifacts/change-decision-log.md#d-16-new-chat-reports-a-failure-and-changes-nothing-until-it-succeeds)

### S-12: `src/engine/model-config/model-config.ts` — Added

**Target state.** The module exists and owns `.3pitor/config.json`'s `selectedModel` section, with `parseSelection`,
`defaultSelection`, `loadSelection`, and `saveSelection` as pinned in Target State.

**Behavior.** Changing. 3pitor writes a new file, `.3pitor/config.json`, when a chat starts. Git ignores it, because
`.3pitor/.gitignore` holds `*`, so the choice stays on one machine. The operator asked for the file. Settled by the
planner under the operator's delegation.

**Why.** The request names the file and section.

**Depends on.** S-13, S-14.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-one-module-reads-checks-and-writes-3pitorconfigjson),
[D-9](artifacts/change-decision-log.md#d-9-the-default-is-haiku-55-on-medium-through-the-api-when-a-key-is-set)

### S-13: `stateKey` — Re-scoped

**Target state.** `stateKey` accepts `'session.json' | 'view.json' | 'config.json'`.

**Behavior.** Preserving. Existing keys are unchanged.

**Why.** The key union is closed
([C-9](artifacts/current-state-findings.md#c-9-state-files-under-3pitor-are-keyed-by-a-closed-union-and-a-corrupt-file-reads-as-missing)).

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-one-module-reads-checks-and-writes-3pitorconfigjson)

### S-14: `src/shared/wire.ts` model types and `CurrentSession` — Added and Re-scoped

**Target state.** `ProviderId`, `ThinkingLevel`, `ModelSelection`, `ModelChoice`, `ModelInfo`, `ProviderEntry`, and
`ModelCatalog` exist as pinned in Target State. `CurrentSession` carries `model: ModelChoice` and no `claude`.

**Behavior.** Changing for `GET /api/sessions/current`, whose `claude` field becomes `model`. No UI code reads `claude`
today ([C-11](artifacts/current-state-findings.md#c-11-currentsessionclaude-is-on-the-wire-but-no-ui-code-reads-it)),
and the page and server ship together in one binary, so no client sees the old shape. Settled by the planner.

**Why.** The header needs the provider, model, level, and access on load and after New chat.

**Decision.** [D-12](artifacts/change-decision-log.md#d-12-the-wire-carries-the-selection-and-its-display-labels)

### S-15: `MODEL_ALIASES`, `DEFAULT_MODEL`, and `resolveModelId` — Removed

**Target state.** None of the three exists. A selection always carries a full model id, and the default lives in
`defaultSelection`.

**Behavior.** Changing, as part of S-9: the `haiku`, `sonnet`, and `opus` shortcuts were only reachable through
`MODEL`.

**Why.** Their only caller is `agentSettings`, which now reads the selection
([C-3](artifacts/current-state-findings.md#c-3-model-ids-are-anthropic-only-live-in-agentts-and-have-no-thinking-level)).

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-remove---claude-and-model)

### S-16: `GET /api/models` and `Engine.models.list` — Added

**Target state.** The route returns a `ModelCatalog`, as in the worked example under Target State. It re-reads
`config.json` on every call. `Engine.models.list()` gathers each backend's `problem()` and `models()` in parallel, and
turns a rejected `models()` into that provider's `problem`.

**Behavior.** Preserving. A new route.

**Why.** The picker needs the providers, their models and levels, their readiness, and the saved selection.

**Depends on.** S-5, S-12.

**Decision.** [D-13](artifacts/change-decision-log.md#d-13-get-apimodels-is-new-and-post-apisessions-takes-an-optional-selection)

### S-17: `POST /api/sessions` — Re-scoped

**Target state.** The route takes an optional `{ selection }` body and answers as the table under Target State says. A
201 carries `{ id, model: ModelChoice }`.

**Behavior.** Changing. A bad `selection` now gets a 400, and a 201 now carries `model`. A request with no body behaves
as before, apart from the model the new session uses. Settled by the planner.

**Why.** New chat sends the chosen selection, and `scripts/check.ts` sends no body.

**Depends on.** S-11, S-14.

**Decision.** [D-13](artifacts/change-decision-log.md#d-13-get-apimodels-is-new-and-post-apisessions-takes-an-optional-selection)

### S-18: `AgentPanel` — Re-scoped

**Target state.** `AgentPanel({ model, onNewChat, busy, empty })` shows the provider label, an access badge, the model
label, and the level. New chat opens the `ModelPicker`. `onNewChat` takes a `ModelSelection`.

**Behavior.** Changing. The header shows the current model instead of the fixed word "Claude". New chat opens a picker
before it starts a chat. Settled by the planner; the operator asked for both.

**Why.** The request names both.

**Depends on.** S-14, S-19.

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-the-header-shows-provider-access-model-and-level),
[D-15](artifacts/change-decision-log.md#d-15-new-chat-opens-a-picker-with-three-lists-and-a-start-button)

### S-19: `ModelPicker` — Added

**Target state.** `src/ui/chat/model-picker/model-picker.tsx` exports
`ModelPicker({ opener, onStart, onClose })`. It fetches `GET /api/models` when it opens, preselects `selected`, and
behaves as the numbered steps under Target State say. It closes on Escape and on a press outside it, as `Menu` does. It
shows a fetch failure inside the popover, with Start disabled.

**Behavior.** Preserving. A new component.

**Why.** `Menu` closes on every choice and takes only file-action icons
([C-12](artifacts/current-state-findings.md#c-12-the-header-is-a-fixed-heading-and-new-chat-is-a-direct-action-menu-is-a-single-step-list)).

**Depends on.** S-16.

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-new-chat-opens-a-picker-with-three-lists-and-a-start-button)

### S-20: `newChat` in `src/ui/app.tsx` — Re-scoped

**Target state.** `newChat(selection)` posts `{ selection }`. Only after the post succeeds does it dismiss the review,
start the new chat, and store the returned `model` for the header. On failure it leaves the current chat in place and
shows the error in the chat's error line. The page keeps the current `ModelChoice`, from `GET /api/sessions/current`
on load and from the POST's answer after New chat.

**Behavior.** Changing. A failed New chat shows a message and keeps the old chat and its review. Today it fails silently
after clearing the review
([C-13](artifacts/current-state-findings.md#c-13-newchat-has-no-error-path)). Settled by the planner.

**Depends on.** S-17, S-18.

**Decision.** [D-16](artifacts/change-decision-log.md#d-16-new-chat-reports-a-failure-and-changes-nothing-until-it-succeeds)

### S-21: The startup chat line — Re-scoped

**Target state.** Startup prints `3pitor chat: {label} ({Local|API}) · {model id}[ · {level}]` for the current
session's selection. Then it prints that provider's `problem()`, if there is one, as a warning.

**Behavior.** Changing. The line's text changes from `3pitor chat: claude via the Anthropic API`. No script reads it;
`scripts/check.ts` and `make check-build` read only the `listening on` line. Settled by the planner.

**Depends on.** S-11.

**Decision.** [D-17](artifacts/change-decision-log.md#d-17-startup-names-the-provider-model-and-level-it-will-use)

### S-22: README — Re-scoped

**Target state.** The README describes the picker, the five providers and their keys, `OLLAMA_HOST`,
`.3pitor/config.json`, and the default. It drops `--claude` and `MODEL`. Its code-structure section names
`providers/` and `model-config/`.

**Behavior.** Preserving. Documentation.

**Decision.** [D-22](artifacts/change-decision-log.md#trivial-decisions)

## Behavior Changes

Each change below was settled by the planner, under the operator's instruction to decide without asking and report
afterwards ([D-1](artifacts/change-decision-log.md#trivial-decisions)).

- **The `--claude` flag is gone (S-9).** Someone who starts 3pitor with `--claude=cli` sees
  `3pitor: Unknown option '--claude'` and the usage, and 3pitor does not start. Choosing Claude local or API now happens
  in the New chat picker, and the choice is remembered.
- **`MODEL` is ignored (S-9, S-15).** Starting with `MODEL=opus` uses the saved selection instead.
- **The default model is Haiku 5.5 on medium thinking (S-11).** Someone with no saved selection gets Haiku 5.5 instead
  of Sonnet 5. Through the API when `ANTHROPIC_API_KEY` is set, and through the `claude` program otherwise.
- **A new file, `.3pitor/config.json` (S-12).** It appears the first time a chat starts from New chat. Git ignores it.
- **The header names the model (S-18).** It shows, for example, `Claude  API  Haiku 5.5 · medium` instead of "Claude".
- **New chat opens a picker (S-18, S-19).** One more click (Start) than today, with the saved choice already selected.
- **A failed New chat says so (S-20).** The old chat, its highlights, and Undo all stay.
- **The startup chat line reads differently (S-21).** For example, `3pitor chat: Claude (API) · claude-haiku-5-5 ·
  medium`.
- **`GET /api/sessions/current` sends `model` instead of `claude`, and `POST /api/sessions` can answer 400 (S-14,
  S-17).** Only 3pitor's own page and check script call these.

## Change Units

Every unit leaves `make test` passing: the type-check, `make check-node`, and the Bun and UI tests.

### Unit 1: Move the backend module and widen its interface

**What it does.** Moves `claude-backend/` to `providers/` and splits it by provider. Renames `ClaudeBackend` to
`ProviderBackend`, replaces `mode` with `id`, adds `access`, `models()`, and `missingKeyHelp`, and renames
`startupWarning` to `problem`. `ClaudeMode` maps to `claude-api` or `claude-cli` at the edge for now, so nothing above
the module changes.

**Delta entries.** S-1, S-2, S-3 (without `thinking`), S-4, S-5 (two backends).

**How you know it worked.** The existing `claude-backend.test.ts` cases pass, moved to `providers.test.ts`, with the two
backends' model, tools, label, and warning unchanged.

### Unit 2: Apply a thinking level inside the Claude models

**What it does.** Adds the `thinking` argument to `chatModel` and `subagentModel`, the Anthropic `effort` middleware,
and `claudeCliModel`'s optional `effort` with the `--effort` argument. `agentSettings` passes `undefined`, so nothing
observable changes yet.

**Delta entries.** S-3 (thinking), S-7.

**Ordering constraint.** After Unit 1.

**How you know it worked.** A `claude-api` model built with `medium` sends `providerOptions.anthropic.effort` of
`medium` to the scripted model, alongside `cacheControl`. The fake `claude` sees `--effort medium` in its argv, and sees
no `--effort` when the level is undefined. `make check-node` passes unchanged.

### Unit 3: Add the selection types and the config module

**What it does.** Adds the wire types, `model-config.ts`, and the `config.json` state key. Nothing calls the module yet.

**Delta entries.** S-12, S-13, S-14 (new types only).

**How you know it worked.** Tests over a temporary folder show the following:

- A missing file gives the default.
- An invalid `selectedModel` gives the default and a warning.
- A valid one is returned unchanged.
- `saveSelection` keeps other keys.
- A non-object file starts from `{}`.
- `defaultSelection` follows `ANTHROPIC_API_KEY`.

### Unit 4: Let the session's selection choose the model

**What it does.** Gives `Session` its selection. It adds `create(selection?)` with the new write order, rewrites
`agentSettings` to take a backend and a selection, and merges the option types. It also removes `--claude`, `MODEL`,
`ClaudeMode`, and the alias table. It replaces `CurrentSession.claude` with `model`, makes `POST /api/sessions` take an
optional selection, rewrites the startup line, and updates the `modelErrorMessage` call sites.

**Delta entries.** S-8, S-9, S-10, S-11, S-14 (`CurrentSession`), S-15, S-17, S-21.

**Ordering constraint.** After Units 1 to 3. It touches the ten engine construction sites and the tests that set
`claude:`, so it lands as one unit. Tests use `provider: 'claude-api'`, so the `@ai-sdk/anthropic` module mock still
catches every model ([D-18](artifacts/change-decision-log.md#d-18-tests-keep-their-seams)).

**How you know it worked.** Each of these has a test:

- A session started with `{ provider: 'claude-api', model: 'claude-opus-5-5', thinking: 'high' }` calls the scripted
  model with that id and `effort: 'high'`.
- A restart restores the saved selection.
- `POST /api/sessions` with a bad selection gets a 400, and `config.json` is unchanged.
- `--claude=cli` exits 2.
- The startup line names the selection.
- `scripts/check.ts`'s no-body posts still pass.

### Unit 5: Add OpenAI, Google Gemini, and Ollama, and serve the catalog

**What it does.** Installs the three packages, adds the three backends, and adds `Engine.models.list()` and
`GET /api/models`.

**Delta entries.** S-6, S-16.

**Ordering constraint.** After Unit 4, which put `env` on the engine options.

**How you know it worked.** Each of these has a test:

- `mock.module('@ai-sdk/openai', ...)` shows an OpenAI model gets `reasoning: 'medium'`.
- An Ollama backend pointed at a `Bun.serve` stub lists the stub's tags.
- An Ollama backend pointed at a closed port reports `Ollama is not running at ...`.
- With `OPENAI_API_KEY` unset, `/api/models` marks OpenAI with its problem.
- `bun-free.test.ts` passes over the new files.
- `make check-node` loads the engine with the new packages on Node.

### Unit 6: The header, the picker, and New chat's error path

**What it does.** Adds `ModelPicker`, re-scopes `AgentPanel` and `newChat`, and updates the README.

**Delta entries.** S-18, S-19, S-20, S-22.

**Ordering constraint.** After Units 4 and 5.

**How you know it worked.** UI tests under happy-dom show each of these:

- The header renders the current `ModelChoice`.
- New chat opens the picker with the saved selection chosen.
- A provider with a problem is disabled and shows its reason.
- The Thinking list hides for an Ollama model.
- Start posts the selection and updates the header.
- A failed post keeps the old chat and shows the error.

## Risks

- **Ollama tool calling varies by model.** 3pitor's edits happen through tool calls, and a model without tool support
  answers in text and edits nothing
  ([C-22](artifacts/current-state-findings.md#c-22-ollama-tool-calling-depends-on-the-model)). It shows up on the first
  Ollama turn that should edit. The blast radius is that one chat; the operator picks another model.
- **The catalog goes stale.** Model ids are written into the code. A retired id fails at the first turn with the
  provider's own error. It shows up as a chat error naming the model; the fix is a catalog edit.
- **Provider behavior is verified from docs, not calls.** The OpenAI, Gemini, and Ollama paths were never called in
  this run. Unit 5's tests prove the right options reach the model, not that each service accepts them. A live check
  against each service with a real key, run by hand once Unit 5 lands, closes this.
- **Unit 4 is wide.** It touches the engine, the sessions, the CLI, the wire, and the routes together, because the
  option types and the session shape change at once. The type-check catches every missed construction site.

## Deferred (YAGNI)

- **Thinking levels for Ollama.** Ollama's model list carries no capability fields
  ([C-21](artifacts/current-state-findings.md#c-21-hosted-providers-list-models-without-the-capabilities-3pitor-needs-ollamas-list-is-the-users-own)).
  Reopen when a writer needs it and a per-model capability source exists.
- **Live model listing for OpenAI, Gemini, and Anthropic.** Their lists either carry no capability fields or need
  filtering against a curated list anyway. Reopen when the static catalog proves stale in practice.
- **A separate thinking level for subagents.** Reopen when measured cost shows the title-writer spending heavily on
  thinking.
- **Web tools for OpenAI and Gemini.** Both have provider-hosted search, but no finding asks for it. The research skill
  already handles their absence
  ([C-5](artifacts/current-state-findings.md#c-5-anthropic-specific-pieces-sit-in-the-model-path-the-tool-set-and-the-error-text)).
  Reopen when a writer needs research on those providers.
- **Storing the selection in `session.json`.** Reopen if a hand-edited `config.json` sends one provider's history to
  another and the provider rejects it
  ([D-20](artifacts/change-decision-log.md#d-20-history-can-cross-providers-only-through-a-hand-edited-config)).
- **The `max` level for OpenAI.** OpenAI accepts `max` only through its own option. Reopen when a writer asks for it.

## Cut for Scope

Nothing was cut. Every entry traces to the request or to the confirmed scope.

## Open Items

- **Non-blocking: the exact OpenAI and Gemini model lists.** The ids come from vendor docs read on 2026-10-13
  ([C-20](artifacts/current-state-findings.md#c-20-current-model-ids-as-of-2026-10-13)). The builder can adjust them
  at Unit 5 without changing the plan.
- **Non-blocking: other tabs keep a stale header after New chat in one tab.** Today, New chat in one tab already moves
  every tab's current session, with no event to tell them
  ([C-14](artifacts/current-state-findings.md#c-14-options-are-shared-by-every-session-and-new-chat-in-one-tab-changes-the-current-session-for-all)).
  This change does not make that worse for the chat itself, because each session keeps its own selection
  ([D-23](artifacts/change-decision-log.md#trivial-decisions)).

## Review Findings

Pending the review round.

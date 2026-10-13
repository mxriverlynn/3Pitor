# Change Decision Log: Choose Provider and Model

This file records every decision committed while planning Choose Provider and Model. The plan itself lives in
[../change-plan.md](../change-plan.md). Evidence about the code as it stands lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

## Trivial decisions

- D-1: Who settles the decisions — the planner settles every escalation and behavior-change gate, and reports behavior
  changes in the final summary, per the operator's standing instruction for planning runs and the confirmation turn
  ("I'll make the remaining design decisions myself and log them", accepted with "looks good"). — Referenced in plan:
  Why This Change, Behavior Changes.
- D-22: README — updated in Unit 6 to describe the picker, providers, keys, `OLLAMA_HOST`, `.3pitor/config.json`, and
  the default, and to drop `--claude` and `MODEL`. — Referenced in plan: Surface Delta (S-23).
- D-23: Stale headers in other tabs stay out of scope — New chat in one tab already moves every tab's current session
  without telling them (C-14), and fixing that is not in the request. Each session keeps its own selection, so another
  tab's chat continues on its own model. — Referenced in plan: Open Items.
- D-28: `--version` with an unknown option — `3pitor --version --claude=cli` exits 2 with `Unknown option '--claude'`,
  because strict `parseArgs` rejects unknown options before any value is read; adding a pre-scan for `--version` is
  more code than the case is worth (test-engineer P5). — Referenced in plan: Surface Delta (S-9).
- D-29: Server reachability stays out of scope — `Bun.serve` starts with no `hostname` and no origin check, so any page
  that can reach the port can call the API. The chat route already lets such a page send documents to a model; the new
  selection widens that by letting it pick the provider. Guarding the server is not in the request (risk-analyst R7). —
  Referenced in plan: Open Items.

## Full decisions

### D-2: One provider module with one backend per provider

- **Question:** Where do the differences between five providers live?
- **Decision:** `src/engine/chat/claude-backend/` moves to `src/engine/chat/providers/`, split into `providers.ts` and
  one file per provider. `ClaudeBackend` is renamed `ProviderBackend` and widened as pinned in the plan's Target State.
  `claudeBackend(mode, serveTools)` is replaced by `providerBackends(serveTools): Record<ProviderId, ProviderBackend>`,
  built once in `wire()`.
- **Rationale:** The seam already exists and the chat never checks the mode (C-4). Five implementations pass the Rule
  of Three, so widening the interface is backed by current uses, not taste. A record looked up by provider replaces a
  ternary that turns every unknown value into the `claude` program.
- **Evidence:** C-4, C-5, C-16; software-architect A1.
- **Behavior impact:** Preserving for the two existing backends when no thinking level is given.
- **Rejected alternatives:**
  - A `switch` on the provider inside `agentSettings` — rejected because it brings back the mode checks the backend
    seam removed (C-4).
  - A generic provider registry or plugin point — rejected under YAGNI; five fixed entries in a record are enough.
- **Revisit criterion:** A provider whose model needs per-turn state the interface cannot carry.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2, S-3, S-4, S-5
- **Dependent decisions:** D-3, D-5, D-6, D-13
- **Referenced in plan:** Target State, Surface Delta

### D-3: Add the OpenAI and Google packages, and reach Ollama through its OpenAI-compatible endpoint

- **Question:** Which packages reach OpenAI, Gemini, and Ollama?
- **Decision:** `@ai-sdk/openai@4.0.80`, `@ai-sdk/google@4.0.85`, and `@ai-sdk/openai-compatible@3.0.59`, exact pins.
  These are the newest releases at least two weeks old on 2026-10-13. Ollama uses
  `createOpenAICompatible({ name: 'ollama', baseURL: host + '/v1', apiKey: 'ollama' })`. `host` is `OLLAMA_HOST`, with
  `http://` added when it has no scheme, or `http://localhost:11434`.
- **Rationale:** The two `@ai-sdk` packages are the official providers and implement the model interface `ai@7` uses
  (C-18). For Ollama, the OpenAI-compatible package is maintained alongside the AI SDK and passes thinking levels
  through. The community package is single-maintainer and supports only thinking on or off (C-19). 3pitor never forces
  a tool choice, so the compatible endpoint's lack of `tool_choice` costs nothing (C-22).
- **Evidence:** C-6, C-18, C-19, C-22; research-analyst R-1, R-5.
- **Behavior impact:** Preserving. New providers.
- **Rejected alternatives:**
  - `ollama-ai-provider-v2@4.0.1` — rejected because it has a single maintainer, its default model class was unverified,
    and it has a documented history of tool-call edge cases (C-18, R-5).
  - `ai-sdk-ollama` — rejected because its compatibility with `ai@7` was not verified.
  - The latest versions of the packages — rejected because they are less than two weeks old.
- **Revisit criterion:** An official `@ai-sdk/ollama` package, or Ollama tool calls failing through the compatible
  endpoint for a model that supports tools.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-19
- **Referenced in plan:** Target State, Surface Delta

### D-4: A static catalog with thinking levels per model

- **Question:** Which models and thinking levels does the picker offer, and where do they come from?
- **Decision:** Each hosted provider's backend carries a static list of models, as pinned in the plan's Models and
  thinking levels table. Ollama lists the operator's pulled models live (D-19), with no levels. The Claude models offer
  low, medium, high, xhigh, and max. OpenAI and Gemini offer low, medium, and high.
- **Rationale:** OpenAI's live list has no capability fields and includes embedding and audio models (C-21), so a
  curated list is needed anyway. The Claude levels match what Anthropic's `effort` and `claude --effort` accept (C-7).
  On 2026-10-13 the installed `claude` accepted Haiku 5.5 with `max`. OpenAI and Gemini accept different upper levels
  per model (C-19), so the plan offers the three every listed model accepts.
- **Evidence:** C-7, C-19, C-20, C-21; a `claude -p --model claude-haiku-5-5 --effort max` call that answered "ok".
- **Behavior impact:** Preserving. New choices.
- **Rejected alternatives:**
  - Live listing for every provider — rejected because the hosted lists carry no usable capability fields (C-21).
  - Offering xhigh for OpenAI and Gemini — rejected because Gemini lowers it to high, and not every OpenAI model takes
    it (C-19).
- **Revisit criterion:** A listed model retired, or a writer asking for a model or level the list lacks.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-5, D-15
- **Referenced in plan:** Target State, Surface Delta

### D-5: Each backend applies the thinking level inside its own chat model

- **Question:** How does a thinking level reach each provider?
- **Decision:** As pinned in the plan's mapping table:
  - `claude-api` uses `defaultSettingsMiddleware` with `providerOptions.anthropic.effort`.
  - `claude-cli` passes an optional `effort` option that becomes `'--effort', effort` right after `'--model', modelId`.
  - `openai` and `google` use a `transformParams` middleware that sets the AI SDK's `reasoning`.
  - `ollama` uses none.
  - An undefined level adds nothing.
  - `thinking` is the last, optional argument of `chatModel`, so existing calls keep their shape.
  - `subagentModel` takes no level, and subagents run at the provider's default, as today.
- **Rationale:** `agentSettings` stays provider-blind, as agent.ts's rule says, because the model carries the turn's
  settings. `defaultSettingsMiddleware`'s settings type has no `reasoning` field, so OpenAI and Gemini need
  `transformParams`. It deep-merges, so `effort` and the cache setting coexist. Anthropic's own `effort` keeps `max`,
  which `reasoning` lacks (C-7). On 2026-10-13, all four catalog Claude models accepted `max` through both the API and
  the installed `claude`.
- **Evidence:** C-7, C-8, C-19; `node_modules/ai/dist/index.d.ts:8927-8942` (settings type);
  `node_modules/ai/dist/index.js:1391` (merge); software-architect A2; live `max` calls per model, API and CLI.
- **Behavior impact:** Preserving when the level is undefined; the default selection carries `medium`, a behavior
  change recorded at D-9.
- **Rejected alternatives:**
  - The AI SDK's `reasoning` for `claude-api` too — rejected because it drops `max`, and the two Claude providers would
    offer different lists.
  - Passing `reasoning` on `streamText` in `sessions.ts` — rejected because the `claude` program needs a flag, not a call
    option, and `sessions.ts` would have to know the provider.
  - Giving subagents the chat's level — rejected under YAGNI: no finding wants the title-writer to reason, and it would
    raise its cost (risk-analyst, YAGNI candidate).
  - `thinking` as the second argument — rejected because it shifts every existing `chatModel(id, tools)` call
    (test-engineer P2).
- **Revisit criterion:** A provider whose thinking setting cannot be applied when the model is built, or a subagent that
  needs reasoning.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-7
- **Dependent decisions:** D-9
- **Referenced in plan:** Target State, Surface Delta

### D-6: Each provider says what is wrong in its own words

- **Question:** How do missing keys, a missing `claude`, and a stopped Ollama reach the writer?
- **Decision:** `problem(env, isOnPath)` replaces `startupWarning`, with the same arguments and return. Startup prints
  it for the current selection, `GET /api/models` sends it so the picker can show it, and `sessions.ts` passes it to
  `modelErrorMessage(error, help?)`, which returns it for a `LoadAPIKeyError`. Ollama's failure is `models()` rejecting
  with `Ollama is not running at {host}` or `Ollama at {host} answered {status}`.
- **Rationale:** Today every missing key reads as a missing Anthropic key, and the only readiness check is printed once
  to the terminal (C-16). For the three key providers the readiness text and the missing-key text are the same, so one
  member serves both.
- **Evidence:** C-5, C-16; behavioral-analyst B-7, B-11; junior-developer JD-007.
- **Behavior impact:** Preserving for `claude-api` and `claude-cli`, whose texts are unchanged.
- **Rejected alternatives:**
  - One generic missing-key message — rejected because it cannot say which key or where to get one.
  - A separate `missingKeyHelp` member — rejected under YAGNI; it duplicated `problem()`'s text (JD-007).
- **Revisit criterion:** A provider whose call-time key error needs different wording from its readiness text.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-8
- **Dependent decisions:** D-13, D-15
- **Referenced in plan:** Target State, Surface Delta

### D-7: The selection belongs to the session

- **Question:** Where does the current model live: process-wide options, the config file, or each session?
- **Decision:** Each in-memory `Session` holds `selection`, and `current()` returns it. `load()` sets it from
  `loadSelection`. `create(selection?)` checks a given selection (throwing `SelectionError`), writes `session.json`,
  then `config.json`, then makes the session current. `agentSettings` builds the model from the session's backend and
  selection. `session.json` does not store the selection. `SessionsOptions` is pinned in the plan.
- **Rationale:** Process-wide constants cannot vary per chat (C-1). The selection changes only at New chat, so within a
  run a session's history comes from one provider (C-15). Holding it on the session also keeps an older tab's chat on
  its own model when another tab starts a new one (C-14). Writing `session.json` first means a failed config write
  leaves a new, empty session on disk beside the old config, which carries no history to cross providers; the reverse
  order left the old history beside a new config (JD-002, R2).
- **Evidence:** C-1, C-10, C-14, C-15; software-architect A4; junior-developer JD-002; risk-analyst R2.
- **Behavior impact:** Changing, through the default (D-9) and the write order (D-16).
- **Rejected alternatives:**
  - A mutable process-wide selection in options — rejected because a running turn in another tab would pick up a
    change after its own `await` (C-14).
  - Writing `config.json` before `session.json` — rejected for the history-crossing case above.
  - Storing the selection in `session.json` and preferring it on load — deferred; the operator asked for the config to
    decide at startup (D-20).
- **Revisit criterion:** The D-20 trigger.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11
- **Dependent decisions:** D-11, D-13, D-16, D-20
- **Referenced in plan:** Target State, Surface Delta

### D-8: One module reads, checks, and writes .3pitor/config.json

- **Question:** How is `config.json` read and written, and what counts as a valid selection?
- **Decision:** `src/engine/model-config/model-config.ts` holds `parseSelection`, `fitsCatalog`, `defaultSelection`,
  `loadSelection(fs, env, backends)`, and `saveSelection`, as pinned in the plan with a table of worked cases.
  - `fitsCatalog` reads only the static catalogs: a model in the catalog takes no level or one it offers; a model not
    in the catalog takes no level.
  - Load warns on each read where `selectedModel` is present but rejected, and falls back to the default.
  - Save keeps every other key and treats a missing or non-object file as `{}`.
  - `stateKey` gains `'config.json'`.
  - The file is written only when a chat starts.
- **Rationale:** `readJson` returns `unknown` and treats a corrupt file as missing (C-9). `view-state.ts` casts
  unchecked, so this module checks the shape instead. A level outside the model's list would reach Anthropic or the
  `claude` program raw and could fail every start once saved (R3), so the pairing is checked. "Under a selectedModel
  section" implies other sections, and keeping them costs one spread.
- **Evidence:** C-9; scope-boundary.md; software-architect A3; risk-analyst R3, R5.
- **Behavior impact:** Changing. A new file, `.3pitor/config.json`, is git-ignored by the existing `.3pitor/.gitignore`.
  The operator asked for the file.
- **Rejected alternatives:**
  - Overwriting the whole file — rejected because it would erase sections the operator adds later.
  - Checking the model against the live list at load — rejected because it would wait on Ollama and reject a model the
    writer pulled after saving.
  - Writing the default at startup — rejected because a folder where nobody chats should get no record, as with
    `session.json`.
  - Warning only once per run — rejected as more state than the case is worth; the picker re-reads on each open.
- **Revisit criterion:** A second setting in `config.json` that needs its own checks; at that point the module may own
  the whole file.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12, S-13
- **Dependent decisions:** D-9, D-13
- **Referenced in plan:** Target State, Surface Delta

### D-9: The default is Haiku 5.5 on medium, through the API when a key is set

- **Question:** "Default to Claude, Haiku v5.5 on medium thinking" — through the API or the `claude` program?
- **Decision:** `defaultSelection(env)` returns `{ provider: env.ANTHROPIC_API_KEY ? 'claude-api' : 'claude-cli', model:
  'claude-haiku-5-5', thinking: 'medium' }`.
- **Rationale:** This is today's `--claude=auto` rule, applied only to the default (C-1). A writer with a key keeps
  using the API, and one without keeps using their subscription. `make check-build` sets `ANTHROPIC_API_KEY=unused`, so
  it gets `claude-api`, as it does today.
- **Evidence:** C-1, C-17; the request's stated default.
- **Behavior impact:** Changing. With no saved selection, chat runs Haiku 5.5 on medium thinking instead of
  `claude-sonnet-5` with the provider's default thinking. The operator chose the default; the provider rule was settled
  by the planner under D-1.
- **Rejected alternatives:**
  - Always `claude-cli` — rejected because a writer with only a key would fail on their first turn.
  - Always `claude-api` — rejected because a writer with only a subscription would fail on their first turn.
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11, S-12
- **Dependent decisions:** none
- **Referenced in plan:** Target State, Surface Delta

### D-10: Remove --claude and MODEL

- **Question:** What happens to the `--claude` flag and the `MODEL` environment variable?
- **Decision:** Both are removed, along with `ClaudeMode`, `MODEL_ALIASES`, `DEFAULT_MODEL`, and `resolveModelId`.
  `parseCommandLine` loses its `env` parameter, and `USAGE` drops `--claude`. `--claude` becomes an unknown option under
  the strict parser, and startup exits with code 2.
- **Rationale:** The picker chooses both how Claude is reached and the model, per chat, and the choice is remembered. A
  startup flag that also chose them would compete with the saved selection, and the writer would have to learn which
  wins. Keeping either as an override adds a precedence rule no finding asks for.
- **Evidence:** C-1, C-3, C-11; scope-boundary.md (the planner decides the flag's fate).
- **Behavior impact:** Changing. `3pitor --claude=cli` stops with `3pitor: Unknown option '--claude'`, and `MODEL` is
  no longer used; startup warns when it is set (D-25). Settled by the planner under D-1; reported in the final summary.
- **Rejected alternatives:**
  - Keep `--claude` to choose the default's provider only — rejected because the default already follows the key
    (D-9), and the picker covers the rest.
  - Keep `--claude` as an override for every session — rejected because it would override what the writer picked.
  - Accept `--claude` and ignore it with a warning — rejected because silently ignoring a flag the operator once forced
    is worse than a clear stop.
- **Revisit criterion:** The operator scripts 3pitor and needs a non-interactive way to pick a model.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9, S-15
- **Dependent decisions:** D-17, D-25, D-28
- **Referenced in plan:** Target State, Surface Delta

### D-11: One engine options type, carrying env and isOnPath

- **Question:** How do the engine's options change?
- **Decision:** `StartOptions` folds into `EngineOptions`, which drops `claude` and `model` and gains `env` and
  `isOnPath`. `AgentOptions` keeps `fileSystem` and `appSkillFiles` only.
- **Rationale:** Three types repeat the same configuration (C-2). The picker needs `problem(env, isOnPath)` at request
  time. Passing `env` in, instead of reading `process.env`, lets tests set keys and `OLLAMA_HOST` without touching the
  process.
- **Evidence:** C-2, C-16, C-17; software-architect A4.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Reading `process.env` inside the backends — rejected because tests would have to mutate the process environment,
    which the fake-claude helper already has to restore after every test (C-17).
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** D-18
- **Referenced in plan:** Target State, Surface Delta

### D-12: The wire carries the selection and its display labels

- **Question:** What does the page receive to show the header?
- **Decision:** The wire types pinned in the plan's Target State. `CurrentSession.model: ModelChoice` replaces
  `claude`, and `ModelChoice` adds `providerLabel`, `modelLabel`, and `access` to the selection. Labels come from the
  static catalog, or the raw id for Ollama and for an id not in the catalog.
- **Rationale:** The header needs labels on load and after New chat. Taking them from `GET /api/models` would make the
  header wait on the Ollama check. No UI code reads `claude` today (C-11), and the page ships with the server.
- **Evidence:** C-11; software-architect A4, A5.
- **Behavior impact:** Changing for the route's payload. No external client exists. Settled by the planner under D-1.
- **Rejected alternatives:**
  - The page derives labels from `/api/models` — rejected for the wait above.
  - Keep `claude` beside `model` — rejected because nothing reads it.
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** D-14
- **Referenced in plan:** Target State, Surface Delta

### D-13: GET /api/models is new, and POST /api/sessions takes an optional selection

- **Question:** What do the picker and New chat talk to?
- **Decision:** `GET /api/models` returns a `ModelCatalog` and re-reads `config.json` each call. `POST /api/sessions`
  takes an optional `{ selection }`:
  - No selection uses the saved one.
  - A selection that fails `parseSelection` or `fitsCatalog` gets a 400 and changes nothing.
  - A no-body request also writes `config.json`.
  - Success answers 201 with `{ id, model }`.
- **Rationale:** "When the new chat pop up is shown, it reads this to select the defaults" asks for a read at open
  time. `scripts/check.ts` posts with no body eight times, and keeping that working removes a behavior change.
- **Evidence:** C-10, C-21; `src/server/scripts/check.ts:136,184,232,281,291,309`; software-architect A5.
- **Behavior impact:** Changing. A 400 is a new answer, and the 201 carries `model`. Settled by the planner under D-1.
- **Rejected alternatives:**
  - Require the selection — rejected because it breaks `scripts/check.ts` for no gain.
  - Separate `GET` and `PUT /api/config` routes — rejected because the selection is saved exactly when a chat starts, and
    a second route invites a saved choice no session uses.
- **Revisit criterion:** A setting in `config.json` that changes outside New chat.
- **Dissent (if any):** None.
- **Settles delta entry:** S-16, S-17
- **Dependent decisions:** D-15, D-16
- **Referenced in plan:** Target State, Surface Delta

### D-14: The header shows provider, access, model, and level

- **Question:** What does the header row show?
- **Decision:** The `<h2>` holds the provider label only (`Chat` before the session loads). A text badge reading
  `Local` or `API` follows, then `{model label} · {level} thinking` as plain text, with the level left out when there is
  none. The model text wraps to a second line rather than being cut off.
- **Rationale:** The request names provider, model, and local or API. The level is part of the selection, and showing
  it makes clear what New chat will reuse.
- **Evidence:** scope-boundary.md; C-12; user-experience-designer UX-007 to UX-009, UX-012.
- **Behavior impact:** Changing. The header no longer reads only "Claude". The operator asked for it.
- **Rejected alternatives:**
  - Provider and model only — rejected because two Claude chats at different levels would look the same.
  - Truncating a long model id — rejected because the full id is what the writer checks (UX-007).
  - The level without the word "thinking" — rejected because "medium" alone does not say what it measures (UX-008).
- **Revisit criterion:** The wrapped header crowds the panel at its narrowest size.
- **Dissent (if any):** None.
- **Settles delta entry:** S-18
- **Dependent decisions:** none
- **Referenced in plan:** Target State, Surface Delta

### D-15: New chat opens a picker with three lists and a Start button

- **Question:** How does the writer choose provider, model, and level?
- **Decision:** A new `ModelPicker`, a non-modal `role="dialog"` named "New chat", holds three labeled native lists:
  Provider, then Model, then Thinking (only when the model has levels), and a Start button. Its props and its eleven
  numbered behaviors are pinned in the plan, covering loading, empty, unavailable, saved-choice-missing, busy, and
  in-flight states, the confirm dialog's place, and where focus goes. An unavailable provider stays choosable, marked
  "unavailable"; choosing it shows its problem as text and disables Start. The confirm dialog is unchanged.
- **Rationale:** The request describes provider, then models, then thinking, with the saved choice as the default. A
  Start button lets the writer accept the default in one click. `Menu` closes on every choice and takes only file-action
  icons (C-12). A disabled native option cannot show a reason or be reached by keyboard, so an unavailable provider is
  choosable and explains itself (UX-002). The picker stays open under the confirm so Cancel keeps the choice (UX-003,
  OQ1 settled as "keep the choice").
- **Evidence:** C-12, C-13; scope-boundary.md; software-architect A5; user-experience-designer UX-002 to UX-006,
  UX-013; junior-developer JD-005, JD-010.
- **Behavior impact:** Changing. New chat takes one more click (Start). The operator asked for the picker.
- **Rejected alternatives:**
  - A drill-down menu that replaces its items at each step — rejected as more than the request needs, worse for
    keyboard and screen-reader users, and with no way to accept the default without walking every step.
  - Extending `Menu` with submenus — rejected because its close-on-choose rule serves three other callers (C-12).
  - Disabled options with the reason "beside" them — rejected because a native option cannot show it (UX-002).
  - Renaming the confirm button to "Start new chat" — rejected; existing tests and habits rely on "New chat".
- **Revisit criterion:** A writer finds the lists awkward in use.
- **Dissent (if any):** None.
- **Settles delta entry:** S-18, S-19
- **Dependent decisions:** none
- **Referenced in plan:** Target State, Surface Delta

### D-16: New chat reports a failure and changes nothing until it succeeds

- **Question:** What happens when New chat fails?
- **Decision:** On the server, `create` writes `session.json` and `config.json` before it makes the session current. On
  the page, `newChat` throws the server's error, and dismisses the review, swaps the chat, stores the new `model`, and
  announces it only after the post succeeds. The picker shows a failure inside itself with `role="alert"`, keeps the
  choice, and re-enables Start.
- **Rationale:** Today a failed post leaves the page and server on different sessions, with no message (C-13). Adding
  validation to this path (D-13) would send more failures down it. The chat's error line exists only when no chat is
  loaded (app.tsx renders `chatError` only without `started`), so the picker is where the error can show (UX-001).
- **Evidence:** C-13; behavioral-analyst B-6; user-experience-designer UX-001, UX-011.
- **Behavior impact:** Changing. A failed New chat shows a message and keeps the old chat and its review. Settled by the
  planner under D-1.
- **Rejected alternatives:**
  - Leave the failure path as it is — rejected because the new 400 would fail silently.
  - Show the error in the chat's error line — rejected because that line is not rendered while a chat is loaded.
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11, S-20
- **Dependent decisions:** none
- **Referenced in plan:** Target State, Surface Delta

### D-17: Startup names the provider, model, and level it will use

- **Question:** What does startup print about chat?
- **Decision:** `3pitor chat: {label} ({Local|API}) · {model id}[ · {level}]` for the current session's selection,
  then that provider's `problem()` as a warning, if any.
- **Rationale:** The old line names a mode that no longer exists (D-10). The `listening on` line, which scripts read, is
  unchanged.
- **Evidence:** C-16; `Makefile` `check-build`; `src/server/scripts/check.ts`.
- **Behavior impact:** Changing. The line's text changes; no script reads it. Settled by the planner under D-1.
- **Rejected alternatives:**
  - Print every provider's problem — rejected because a writer who uses one provider would see four warnings at every
    start.
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-21
- **Dependent decisions:** none
- **Referenced in plan:** Target State, Surface Delta

### D-18: Tests keep their seams

- **Question:** How do tests reach the new providers without keys or a running Ollama?
- **Decision:**
  - Engine and session tests select `claude-api`, so the existing `@ai-sdk/anthropic` module mock still catches every
    model.
  - OpenAI and Google tests use `mock.module` on their own packages, in the shape `useModel` already has.
  - Ollama listing tests point `env.OLLAMA_HOST` at a `Bun.serve` stub, or at a closed port.
  - Effort tests read the fake `claude`'s argv.
  - Test helpers that build `Sessions` or an engine pass `env: { ANTHROPIC_API_KEY: 'test' }`, so the default
    selection is `claude-api`; otherwise `env: {}` would default to `claude-cli` and run the fake `claude` unnoticed.
  - `useModel` records the model id each `anthropic(...)` call asks for, so a test can see which model a turn used.
  - The new package mocks live in one shared helper, because `mock.module` lasts for the whole test process.
  - Unit 1 keeps a thin `claudeBackend` shim so the move stays green; Unit 4 removes it.
- **Rationale:** The current seams are a module mock and a fake program (C-17). Extending them adds no production seam.
- **Evidence:** C-17; `src/engine/chat/components/stub-tool-server.ts` as precedent; test-engineer P1, P3, P7; risk-analyst R4.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - A model-factory injection point in production code — rejected under YAGNI; the module mocks already do this.
- **Revisit criterion:** A provider package that cannot be module-mocked.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10 (test migration) and Units 1, 2, 4, and 5
- **Dependent decisions:** none
- **Referenced in plan:** Change Units

### D-19: Ollama lists the operator's models live, with a one-second timeout

- **Question:** How does the picker know which Ollama models exist?
- **Decision:** `models()` fetches `{host}/api/tags` with `AbortSignal.timeout(1000)` and the global `fetch`. `host` is
  `OLLAMA_HOST` read as a full URL, or `http://localhost:11434`. Each `name` becomes
  `{ id: name, label: name, thinking: [] }`. A failed connection or timeout rejects with
  `Ollama is not running at {host}`, and a non-OK answer rejects with `Ollama at {host} answered {status}`.
- **Rationale:** Ollama's models are whatever the operator pulled (C-21), so no static list can name them. One second
  bounds how long the picker waits when Ollama is stopped. The global `fetch` keeps the engine loadable on Node.
- **Evidence:** C-21; research-analyst R-4; `src/engine/node-check.ts`; junior-developer JD-008.
- **Behavior impact:** Preserving for existing users; each picker open now calls the Ollama host.
- **Rejected alternatives:**
  - The OpenAI-compatible `GET /v1/models` — rejected because `/api/tags` is Ollama's own list, and the two hold the
    same models.
  - Adding `http://` to an `OLLAMA_HOST` without a scheme — deferred under YAGNI (JD-008); no finding shows such a
    value in use with 3pitor.
- **Revisit criterion:** A slow local Ollama that answers after more than one second, or a schemeless `OLLAMA_HOST`
  that fails.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** none
- **Referenced in plan:** Target State, Surface Delta

### D-20: History can cross providers only when the config changes outside New chat

- **Question:** Can one session's history be sent to a different provider?
- **Decision:** Accepted in two cases. Someone hand-edits or deletes `config.json` between runs and startup follows it,
  as the operator asked. Or two `create` calls race, leaving `config.json` on one selection and `session.json` on the
  other session. Within a run, and on a single failed write (D-7), history never crosses providers.
- **Rationale:** The selection changes only at New chat (D-7). Startup must follow the config, by the request. The race
  needs two tabs or a double press inside one write, and Start's in-flight state blocks the double press. What a
  provider does with another's reasoning parts was not verified (C-15).
- **Evidence:** C-15; software-architect A4; risk-analyst R2.
- **Behavior impact:** Preserving. Today a changed `MODEL` between runs does the same thing.
- **Rejected alternatives:**
  - Store the selection in `session.json` and prefer it on load — deferred (YAGNI); it overrides the config the
    operator asked startup to follow.
  - Serialize `create` calls — rejected as more than the two-tab case is worth.
- **Revisit criterion:** A provider rejecting a restored session's history.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** none
- **Referenced in plan:** Risks, Deferred (YAGNI)


### D-21: The chat panel names the chosen provider

- **Question:** What happens to the chat panel's "Claude" wording when another provider is chosen?
- **Decision:** `Chat` takes the current provider label as `assistant` and uses it in the message box's `aria-label` and
  placeholder, the working line, and the "is working" and "finished" announcements. The resize bar's label reads "Resize
  the chat panel". The confirm dialog's text and other code comments stay as they are.
- **Rationale:** A writer on Ollama would see "Ask Claude…" under a header that says Ollama, and screen-reader users
  would hear "Claude" throughout (UX-010). Using the label keeps every string identical on Claude, so existing tests
  hold. The planner settled UX's OQ2 under D-1.
- **Evidence:** user-experience-designer UX-010; `src/ui/chat/chat/chat.tsx:207,208,336,347,348`;
  `src/ui/app.tsx:132`.
- **Behavior impact:** Changing on non-Claude providers, and for the resize bar's label. Settled by the planner under
  D-1.
- **Rejected alternatives:**
  - Leave the wording — rejected for the mismatch above.
  - Neutral wording such as "Message the assistant" — rejected because it changes every string on Claude too.
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-22
- **Dependent decisions:** none
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-24: claude-api sets maxOutputTokens so Haiku 5.5 raises no warning

- **Question:** The installed `@ai-sdk/anthropic@4.0.63` does not know `claude-haiku-5-5`. What does that cost, and
  what is done about it?
- **Decision:** The `claude-api` backend sets `maxOutputTokens: 128000` on every call, through its default settings.
- **Rationale:** An unknown `claude-` id falls into the package's generic branch: 128,000 output tokens, adaptive
  thinking, and `xhigh` supported (`node_modules/@ai-sdk/anthropic/dist/index.js:6503-6514`). The only cost is a "model
  is unknown" warning on every call that leaves `maxOutputTokens` unset (lines 4300-4305), which the AI SDK prints. All
  four catalog models allow 128,000 output tokens (C-20), and known models already default to their maximum, so the
  setting changes nothing else. `4.0.68`, the newest release at least two weeks old, does not know Haiku 5 either, so an
  upgrade does not help.
- **Evidence:** the installed package source cited above; npm release dates for `@ai-sdk/anthropic`; C-20;
  junior-developer JD-001 (its 4,096-token cap claim was checked and does not hold: that branch is for ids without
  `claude-`).
- **Behavior impact:** Preserving. Known models already send their maximum.
- **Rejected alternatives:**
  - Upgrading `@ai-sdk/anthropic` — rejected because no release old enough knows Haiku 5.
  - Leaving the warning — rejected because the default model would print it on every turn.
- **Revisit criterion:** An `@ai-sdk/anthropic` release that knows every catalog model; then the setting can go.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3 (via Unit 2)
- **Dependent decisions:** none
- **Referenced in plan:** Target State

### D-25: Startup warns when MODEL is set

- **Question:** `MODEL` is no longer used. Should a writer who still sets it be told?
- **Decision:** When `MODEL` is set, startup prints `3pitor: MODEL is no longer read. Choose the model from New chat.`
  and continues.
- **Rationale:** D-10 rejects silently ignoring `--claude`; ignoring `MODEL` silently would contradict that, and a writer
  with `MODEL=opus` in their shell profile would run Haiku without knowing (risk-analyst R6). A warning, not a stop,
  because an environment variable is often set far from the command.
- **Evidence:** risk-analyst R6; D-10.
- **Behavior impact:** Changing. A new startup line when `MODEL` is set. Settled by the planner under D-1.
- **Rejected alternatives:**
  - Silently ignore — rejected above.
  - Stop startup — rejected because the variable may be set globally for other tools.
- **Revisit criterion:** A release far enough on that nobody sets `MODEL` for 3pitor; then the warning can go.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9, S-21
- **Dependent decisions:** none
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-26: Labels come from a synchronous catalog through one helper

- **Question:** Where do the header's and startup line's labels come from, without waiting on Ollama?
- **Decision:** `ProviderBackend` gains `catalog: readonly ModelInfo[]` (static; `[]` for Ollama), and `providers.ts`
  exports `modelChoice(selection, backend): ModelChoice`, which takes the model's label from the catalog or uses the raw
  id. Worked examples are pinned in the plan. `models()` returns `catalog` for every provider but Ollama.
  `fitsCatalog` reads `catalog` too.
- **Rationale:** The only catalog accessor was the async `models()`, which fetches for Ollama, so building
  `CurrentSession.model` or the startup line would either special-case Ollama, breaking D-2, or wait on the network,
  which D-12 rejected (JD-003, R5.1). One helper means the header, the 201 body, and the startup line cannot disagree.
- **Evidence:** junior-developer JD-003; risk-analyst R5; test-engineer YAGNI note on duplicated labels.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - A `label(modelId)` method per backend — rejected because `fitsCatalog` also needs each model's levels, which a
    catalog field gives both.
  - Checking `provider === 'ollama'` in the engine — rejected because it breaks provider-blindness (D-2).
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-5
- **Dependent decisions:** D-8
- **Referenced in plan:** Target State, Surface Delta

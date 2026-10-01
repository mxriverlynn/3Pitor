# Change Plan: Prompt Caching Through AI SDK Middleware

## Why This Change

Chat sends the same long system prompt and tool list on every model call. The two paths start from different places:

- **API path.** Nothing is cached today, so every step pays full input price for the same prefix
  ([C-9](artifacts/current-state-findings.md#c-9-the-anthropic-provider-supports-per-system-message-markers-a-request-level-marker-and-at-most-four-breakpoints)).
- **`claude` program path.** `claude` already caches on its own, but nothing in 3pitor shows whether it works. The fixed
  prompt and the skills list arrive as one block, so a skills change throws away the fixed part's cache too
  ([C-5](artifacts/current-state-findings.md#c-5-the-cli-model-joins-system-messages-into-one---system-prompt-and-ignores-their-provider-options),
  [C-10](artifacts/current-state-findings.md#c-10-both-backends-report-the-same-usage-shape-and-nothing-logs-it)).

The operator asked for prompt caching on both paths, and for the agent code to deliver the system prompt and similar
concerns through AI SDK middleware. The reasons were settled before planning. They are the recommendation in
`docs/research/prompt-caching-ai-sdk-and-claude-cli.md`, plus the operator's request and confirmation answers recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md).

## What Changes, In One Paragraph

After this change, every model chat and its subagents use comes wrapped in AI SDK middleware, and the wrapping does what
the call sites used to do. The chat model carries its own system prompt in two parts: a fixed part marked for caching,
and the per-turn skills list. On the API path, every call asks Anthropic to cache automatically. On the `claude` path,
the cache mark becomes a boundary line (`__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`), so `claude` can cache the fixed part on its own. Every model call on both paths
prints one log line with its cache read and write counts, so the operator can see whether caching works. The way the
`claude` program receives history does not change.

## Current State

Every model is built through two methods on the backend, and nothing wraps them
([C-1](artifacts/current-state-findings.md#c-1-every-chat-and-subagent-model-is-built-through-the-backends-two-methods)).
The system prompt is one string, built every turn and handed to `streamText` beside the model
([C-2](artifacts/current-state-findings.md#c-2-the-instructions-are-one-string-built-per-turn-and-spread-into-streamtext-beside-the-model)).
A string can't carry a cache marker. Only the list-of-system-messages form keeps per-message provider options
([C-3](artifacts/current-state-findings.md#c-3-a-string-instruction-becomes-one-system-message-with-no-provider-options-the-message-list-form-keeps-them)).
The fixed text already comes first, so a cache point can go between it and the skills list
([C-16](artifacts/current-state-findings.md#c-16-the-fixed-prompt-first-order-was-chosen-to-allow-a-future-cache-breakpoint)).
The skills list reloads every turn on purpose, so a skill added mid-chat shows up on the next turn
([C-15](artifacts/current-state-findings.md#c-15-two-parts-of-the-prompts-leading-content-can-change-between-turns)).

The `claude` model joins system messages into one `--system-prompt` and ignores their provider options
([C-5](artifacts/current-state-findings.md#c-5-the-cli-model-joins-system-messages-into-one---system-prompt-and-ignores-their-provider-options)).
Both backends already report cache counts in the same usage shape, but nothing reads them
([C-10](artifacts/current-state-findings.md#c-10-both-backends-report-the-same-usage-shape-and-nothing-logs-it)).

The structural property this change addresses: the system prompt and the per-call model settings are attached at the
call site as plain values. That leaves no place to mark what should be cached, and no single place that sees every
model call.

## Target State

Two places wrap models, split by one rule. `agent.ts` owns what the prompt says. `claude-backend.ts` owns what differs
by mode, and every model it returns is already wrapped
([D-6](artifacts/change-decision-log.md#d-6-two-wrap-sites-split-by-what-the-prompt-says-versus-what-differs-by-mode)).

| Concern | Lives in | Mechanism |
| --- | --- | --- |
| System prompt, chat model only | `agent.ts`, `agentSettings` | built-in `defaultInstructionsMiddleware` |
| Automatic caching, API chat and subagent | `claude-backend.ts`, `apiBackend` | built-in `defaultSettingsMiddleware` |
| Cache mark becomes the boundary line | `claude-cli.ts`, `claudeArgs` | join logic, no middleware |
| Cache usage log, both modes, chat and subagent | `claude-backend.ts`, private `logCacheUsage` | the one custom middleware |
| Subagent instructions | `agent.ts`, `taskTool` | unchanged: `generateText({ instructions: agent.prompt })` |

The models end up wrapped like this. In each array the first middleware is the outermost
([C-7](artifacts/current-state-findings.md#c-7-wraplanguagemodel-passes-params-provider-options-the-abort-signal-and-the-provider-name-through-for-any-v4-model)):

```text
API chat:      wrap([defaultInstructions]) ∘ wrap([logCacheUsage, defaultSettings(cache)]) ∘ anthropic(id)
API subagent:  wrap([logCacheUsage, defaultSettings(cache)]) ∘ anthropic(id)
CLI chat:      wrap([defaultInstructions]) ∘ wrap([logCacheUsage]) ∘ claudeCliModel(id, tools, { webTools: true })
CLI subagent:  wrap([logCacheUsage]) ∘ claudeCliModel(id, tools, { webTools: false })
```

On the API path, automatic mode plus the fixed-prompt marker uses two of Anthropic's four cache points
([C-9](artifacts/current-state-findings.md#c-9-the-anthropic-provider-supports-per-system-message-markers-a-request-level-marker-and-at-most-four-breakpoints)).
`anthropic(id)` stays inside the backend methods, because the tests' module stub relies on being called there
([C-13](artifacts/current-state-findings.md#c-13-tests-stub-the-model-by-replacing-the-ai-sdkanthropic-module-which-exports-only-anthropic)).

### Contract (a): the system messages `instructionsFor` produces

`instructionsFor` produces these messages, and both the Anthropic provider and `claudeArgs` read them
([D-2](artifacts/change-decision-log.md#d-2-one-cache-marker-key-for-both-paths)).

```ts
[
  { role: 'system', content: systemPrompt.trimEnd(),
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
  { role: 'system', content: `<skills>\n${SKILLS_INTRO}\n${lines.join('\n')}\n</skills>` },
]
```

`trimEnd()` is applied to the fixed text itself, as today. The marker is the presence of
`providerOptions.anthropic.cacheControl`. `claudeArgs` checks only that it is present and truthy, and never compares its
value.

### Contract (b): how `claudeArgs` joins system messages

1. Find the first system message carrying the marker. Later marked messages are treated as unmarked.
2. If at least one system message follows it, the separator after it is
   `\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\n`.
3. Every other separator stays `\n\n`.

With no marked message, or with the marked message last, the output is identical to today's
([D-3](artifacts/change-decision-log.md#d-3-the-boundary-line-goes-after-the-first-marked-system-message)). Worked
examples:

```text
[Pre, Marked, Post1, Post2(also marked)]  →  "Pre\n\nMarked\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\nPost1\n\nPost2"
[Fixed(marked), Skills]                   →  "Fixed\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\nSkills"
[Only(marked)]                            →  "Only"
```

For the real prompt, the `--system-prompt` value is:

```text
<system-prompt.md, trailing whitespace trimmed>

__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__

<skills>
When a request matches one, or the user types /<name>, Read its file first ...
</skills>
```

Replace `\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\n` with `\n\n`, and you get today's string exactly.

The line needs `claude` 2.1.275 or later. The installed version is 2.1.286
([D-11](artifacts/change-decision-log.md#d-11-claude-21275-or-later-is-required-and-is-not-checked-at-startup)).

### Contract (c): the cache log line

Printed with `console.log`, once per model call
([D-5](artifacts/change-decision-log.md#d-5-one-console-log-line-per-model-call-with-cache-read-and-write-counts)):

```text
3pitor: cache ${model.provider} ${model.modelId}: read ${inputTokens.cacheRead ?? '-'}, write ${inputTokens.cacheWrite ?? '-'}
```

Examples:

```text
3pitor: cache anthropic.messages claude-sonnet-5: read 11842, write 0
3pitor: cache claude-cli claude-sonnet-5: read 9120, write 412
```

- **Streamed calls:** `wrapStream` prints when the `finish` part passes, including a finish whose reason is an error.
  A stream that ends with no `finish`, such as an aborted one, prints nothing.
- **Generated calls:** `wrapGenerate` prints after the result resolves. A call that throws prints nothing.
- **Missing counts:** `-` means the count was `undefined`. It is never printed as `0`, so a missing count is not
  mistaken for a real zero. The CLI's usage parser passes `claude`'s cache fields through as they are, so a missing
  field arrives as `undefined` and prints `-`
  ([C-10](artifacts/current-state-findings.md#c-10-both-backends-report-the-same-usage-shape-and-nothing-logs-it)).

The two paths count differently, so their numbers are not comparable:

- **API:** one line is one model step.
- **`claude`:** one line is a whole `claude` run, which may hold several of its own internal steps. Its counts may add
  up across those steps
  ([C-5](artifacts/current-state-findings.md#c-5-the-cli-model-joins-system-messages-into-one---system-prompt-and-ignores-their-provider-options)).
  Compare `claude` lines only with other `claude` lines from turns of similar shape.

### Contract (d): what `agentSettings` returns

```ts
agentSettings(...): Promise<{ model: LanguageModel; tools: ToolSet }>
```

Callers must not pass `instructions` or `system` to `streamText`. `defaultInstructionsMiddleware` silently does nothing
when the call already has a system message
([C-8](artifacts/current-state-findings.md#c-8-defaultinstructionsmiddleware-adds-a-list-of-system-messages-with-their-provider-options-only-when-the-call-has-none)).
Dropping the field removes the obvious way to do it by accident. `streamText` still accepts `instructions`, so the
`sessions.test.ts` boundary assertion added in Unit 4 is what catches a caller who passes it
([D-7](artifacts/change-decision-log.md#d-7-agentsettings-returns-only-the-model-and-the-tools)).

## Surface Delta

### S-1: `instructionsFor` — Re-scoped

**Target state.** `instructionsFor(skills)` in `agent.ts` stays private. It returns `SystemModelMessage[]` in the shape
of contract (a): the fixed prompt marked for caching, then the skills block. The text of each part is what today's
single string carries on either side of its `\n\n` join.

**Behavior.** Changing. On the API path, the request's `system` field carries two text blocks instead of one, and the
first carries `cache_control`. The model reads the same words. Settled under the operator's delegation ("make the best
decisions you can, without asking me").

**Why.** A string can't carry a cache marker, and the list form can
([C-3](artifacts/current-state-findings.md#c-3-a-string-instruction-becomes-one-system-message-with-no-provider-options-the-message-list-form-keeps-them)).
Splitting at the fixed-then-skills seam keeps a skills change, which the app supports mid-chat, from throwing away the
fixed prompt's cache
([C-15](artifacts/current-state-findings.md#c-15-two-parts-of-the-prompts-leading-content-can-change-between-turns),
[C-16](artifacts/current-state-findings.md#c-16-the-fixed-prompt-first-order-was-chosen-to-allow-a-future-cache-breakpoint)).

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-deliver-the-system-prompt-through-defaultinstructionsmiddleware), [D-2](artifacts/change-decision-log.md#d-2-one-cache-marker-key-for-both-paths), [D-12](artifacts/change-decision-log.md#d-12-keep-the-split-prompt-and-boundary-line-despite-the-yagni-challenge)

### S-2: `claudeArgs` — Re-scoped

**Target state.** `claudeArgs` in `claude-cli.ts` builds `--system-prompt` by contract (b)'s joining rule. It reads
`providerOptions?.anthropic?.cacheControl` on system messages for that purpose and for nothing else. Argument order,
stdin, the history transcript, and the empty `--system-prompt ''` case are unchanged.

**Behavior.** Changing, but nothing reaches `claude` until S-6 lands: no code marks a message before then, so the prompt
stays identical. For the effect after S-6, see S-6. Settled under the operator's delegation.

**Why.** `claude` can't read provider options
([C-5](artifacts/current-state-findings.md#c-5-the-cli-model-joins-system-messages-into-one---system-prompt-and-ignores-their-provider-options)),
so the place that builds its arguments has to translate the marker. The operator chose to plan the boundary line for the
`claude` program (scope boundary, Operator-Stated Scope).

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-boundary-line-goes-after-the-first-marked-system-message), [D-11](artifacts/change-decision-log.md#d-11-claude-21275-or-later-is-required-and-is-not-checked-at-startup), [D-12](artifacts/change-decision-log.md#d-12-keep-the-split-prompt-and-boundary-line-despite-the-yagni-challenge)

### S-3: `logCacheUsage` — Added

**Target state.** `logCacheUsage` is a private `LanguageModelMiddleware` constant in `claude-backend.ts`, behaving as
contract (c) describes:

- Its `wrapStream` pipes every part through unchanged, and prints the line when the `finish` part passes.
- Its `wrapGenerate` awaits the result, prints the line from `result.usage`, and returns the result unchanged.
- It never catches, throws, or changes a part.

**Behavior.** Changing. The server log gains one line per model call. The operator asked for this ("Include it").

**Why.** The operator asked for per-call cache counts on both paths. Both backends already produce the counts in one
shape
([C-10](artifacts/current-state-findings.md#c-10-both-backends-report-the-same-usage-shape-and-nothing-logs-it)). A
wrapper that only passes things through leaves errors as they are
([C-11](artifacts/current-state-findings.md#c-11-wrapping-does-not-change-the-errors-callers-see-unless-middleware-catches-or-throws)).

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-one-console-log-line-per-model-call-with-cache-read-and-write-counts)

### S-4: `apiBackend.chatModel` and `apiBackend.subagentModel` — Re-scoped

**Target state.** Each returns:

```ts
wrapLanguageModel({ model: anthropic(id), middleware: [logCacheUsage, defaultSettingsMiddleware({ settings: { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } } })] })
```

Every API call, chat and subagent, asks Anthropic for automatic caching with the default five-minute lifetime, and every
call is logged. The `ClaudeBackend` interface is unchanged.

**Behavior.** Changing. Replies are the same. Repeated prefixes are billed at the cache rate, and the first use of each
prefix pays a write premium. Settled under the operator's delegation.

**Why.** The research recommends automatic mode for the API path, and the installed provider supports it through this
option
([C-9](artifacts/current-state-findings.md#c-9-the-anthropic-provider-supports-per-system-message-markers-a-request-level-marker-and-at-most-four-breakpoints)).
Subagents run up to ten steps, and each step re-sends the same prefix
([C-4](artifacts/current-state-findings.md#c-4-subagents-use-a-separate-model-their-own-instructions-and-generatetext)).

**Depends on.** S-3.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-automatic-caching-on-every-api-call-with-the-default-lifetime), [D-6](artifacts/change-decision-log.md#d-6-two-wrap-sites-split-by-what-the-prompt-says-versus-what-differs-by-mode)

### S-5: `cliBackend.chatModel` and `cliBackend.subagentModel` — Re-scoped

**Target state.** Each returns `wrapLanguageModel({ model: claudeCliModel(...), middleware: [logCacheUsage] })`, with the
same `claudeCliModel` arguments as today. No cache setting is added, because `claude` ignores call-level provider
options.

**Behavior.** Changing only by S-3's log line. The wrapper reports the inner model's `provider` (`'claude-cli'`) and
`modelId`, and passes errors and aborts through
([C-7](artifacts/current-state-findings.md#c-7-wraplanguagemodel-passes-params-provider-options-the-abort-signal-and-the-provider-name-through-for-any-v4-model),
[C-11](artifacts/current-state-findings.md#c-11-wrapping-does-not-change-the-errors-callers-see-unless-middleware-catches-or-throws)).
The existing `claude-backend.test.ts` check of `--tools`, `provider` and `modelId` through the CLI models already pins
that.

**Why.** The operator asked for the log on both paths.

**Depends on.** S-3.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-one-console-log-line-per-model-call-with-cache-read-and-write-counts), [D-6](artifacts/change-decision-log.md#d-6-two-wrap-sites-split-by-what-the-prompt-says-versus-what-differs-by-mode)

### S-6: `agentSettings` — Re-scoped

**Target state.** `agentSettings` returns `{ model, tools }`, per contract (d). On every turn it builds the chat model as:

```ts
wrapLanguageModel({ model: backend.chatModel(id, tools), middleware: defaultInstructionsMiddleware({ instructions: instructionsFor(config.skills) }) })
```

The model carries the turn's system prompt, so skills still reload each turn. The `Task` subagent model is passed to
`taskTool` as `backend.subagentModel(id, files)`, unwrapped here. The file's header comment says the model now carries
the instructions.

**Behavior.** Changing. `sessions.ts`, its only caller, sees no difference: it spreads the result into `streamText`
([C-2](artifacts/current-state-findings.md#c-2-the-instructions-are-one-string-built-per-turn-and-spread-into-streamtext-beside-the-model),
[C-14](artifacts/current-state-findings.md#c-14-no-code-outside-the-area-calls-the-model-or-instruction-functions)).
This entry is where S-1 and S-2 take effect. From here on:

- the API request's system prompt is two blocks, with the first marked;
- `claude` receives the boundary line in its `--system-prompt`.

Whether `claude` honors that line on the subscription route is unknown
([findings, Findings No Agent Could Audit](artifacts/current-state-findings.md#findings-no-agent-could-audit)). Settled
under the operator's delegation, with Unit 5 as the check and the revert path.

**Why.** The operator asked for the system prompt to move into AI SDK middleware, and the built-in middleware does
exactly that
([C-8](artifacts/current-state-findings.md#c-8-defaultinstructionsmiddleware-adds-a-list-of-system-messages-with-their-provider-options-only-when-the-call-has-none)).

**Depends on.** S-1, S-2. S-2 must land first, so that the first marked prompt `claude` receives already has the
boundary rule.

**Migration.** Do not pass `instructions` from `agentSettings` to `streamText`. The field no longer exists.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-deliver-the-system-prompt-through-defaultinstructionsmiddleware), [D-7](artifacts/change-decision-log.md#d-7-agentsettings-returns-only-the-model-and-the-tools)

## Behavior Changes

The operator delegated every behavior-change decision in this run ("make the best decisions you can, without asking
me"). Each change below was accepted on that authority.

- **The server log prints one cache line per model call (S-3, S-5).** Observer: the operator watching the terminal. On
  the API path that is one line per step, and subagents can add up to ten. The operator asked for it.
- **API calls ask Anthropic to cache automatically (S-4).** Observer: the operator's Anthropic bill and latency.
  - Repeat prefixes cost about a tenth of the normal price.
  - Each new prefix costs 1.25 times on its first write.
  - Writes that are never read are pure cost: a one-step subagent call, or a turn after more than five idle minutes.
  - Replies don't change.
- **The API request's system prompt arrives as two blocks, with the first marked for caching (S-1, effective with
  S-6).** Observer: Anthropic's usage counts. The model reads the same words.
- **The `claude` program's system prompt gains a boundary line (S-2, effective with S-6).** Observer: `claude`, and
  through it the model and the operator's subscription usage. If `claude` doesn't honor the line, the model may see it
  as literal text. Unit 5 checks for that, and the revert is one function.

## Change Units

Code units come first where they don't depend on the measurements. The baseline measurement comes before anything the
`claude` program can see
([D-10](artifacts/change-decision-log.md#d-10-measure-a-claude-baseline-before-the-boundary-line-takes-effect)).

### Unit 1: Wrap every backend model with the cache log, and turn on API caching

**What it does.** Adds `logCacheUsage` to `claude-backend.ts`. Wraps both API models with the log and automatic
caching, and both CLI models with the log. The `claude` program sees no change.

**Delta entries.** S-3, S-4, S-5.

**How you know it worked.**

- Rewrite `claude-backend.test.ts:43-44` (`toBe(model)`), keeping its intent ("the API backend uses Anthropic's
  model"):
  - Run `generateText` through `chatModel` and through `subagentModel`.
  - Assert the mock received each call.
  - Assert each call's `providerOptions` equal `{ anthropic: { cacheControl: { type: 'ephemeral' } } }`.
- Add log tests with `spyOn(console, 'log').mockImplementation(() => {})`, restored in `finally` as the suite's other
  console spies are. Derive the expected line from the model's own `provider` and `modelId`.
  - **Through `streamText`, drained to the end** (the `wrapStream` path): assert `spy.mock.calls` `toEqual([[line]])`
    with `read 0, write 0` from `scriptedModel`'s explicit zeros.
  - **Through `generateText`** (the `wrapGenerate` path): assert the same exactly-once line.
  - **Missing counts:** use a hand-built `MockLanguageModelV4` whose usage leaves out `cacheRead` and `cacheWrite`, and
    assert `read -, write -`.
- The existing CLI `--tools`/`provider`/`modelId` test and the error tests in `sessions.test.ts` (no reply in the
  script, missing API key) pass unchanged. They pin that the wrapper keeps identity and passes errors through.
- The full suite passes. Log lines in test output are expected.

### Unit 2: Measure a `claude` baseline

**What it does.** A manual check, not code. Start the server in CLI mode with Unit 1 in place and run this script:

1. Turn 1: ask a question that needs no tools.
2. Turn 2: ask another question that needs no tools.
3. Add a workspace skill, or change a skill's description.
4. Turn 3: ask a third question that needs no tools.

Record each turn's `read` and `write` from the log in the PR description. Use questions that need no tools so each
`claude` run is one internal step and the counts stay comparable (contract c).

**Ordering constraint.** After Unit 1, which provides the log. Before Unit 3.

**How you know it worked.** Three CLI log lines are recorded. Turn 2 should show a `read` greater than zero if `claude`
already caches its system prompt across processes.

### Unit 3: Teach the CLI model the boundary line

**What it does.** `claudeArgs` puts the boundary line after the first marked system message, per contract (b). No code
marks a message yet, so the prompt `claude` receives is unchanged.

**Delta entries.** S-2.

**Ordering constraint.** Before Unit 4, so the first marked prompt `claude` receives already has the boundary.

**How you know it worked.**

- All existing `claude-cli.test.ts` tests pass unchanged, including the `'Be brief.'` pins.
- New tests, through `generateText` with `instructions` as system messages:
  - `[Pre, Marked, Post1, Post2(also marked)]` gives exactly
    `'Pre\n\nMarked\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\nPost1\n\nPost2'`. This one test catches a boundary after
    every marked message, a boundary replacing all separators, and a boundary before the first message.
  - `[Only(marked)]` gives `'Only'`. This catches a boundary added unconditionally.

### Unit 4: Deliver the system prompt through middleware

**What it does.** `instructionsFor` returns contract (a)'s two messages. `agentSettings` wraps the chat model with
`defaultInstructionsMiddleware` and stops returning `instructions`. From here on, the API request carries two system
blocks and `claude` receives the boundary line.

**Delta entries.** S-1, S-6.

**Ordering constraint.** After Unit 3.

**How you know it worked.**

- Rewrite `agent.test.ts:20-34`:
  - Call `useModel(scriptedModel('ok'))`.
  - Send the returned `model` one call.
  - Assert `prompt.slice(0, 2)` equals contract (a), with the same fixed text and skills block as today's test.
- Rewrite `agent.test.ts:43-47` the same way, with `useModel(scriptedModel('ok'))`. Assert `toContain` and
  `not.toContain` against `prompt[1].content`.
- `agent.test.ts:68` (the subagent's system message) passes unchanged.
- In `sessions.test.ts`, the `<skills>` checks at 495-497 still pass. Add
  `toContain('\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\n<skills>')`. This is the one end-to-end proof that contracts (a)
  and (b) agree.
- `sessions.ts` does not change ([D-8](artifacts/change-decision-log.md#trivial-decisions)), and its tests pass.

### Unit 5: Measure both paths and decide on the boundary line

**What it does.** A manual check, not code.

1. Repeat Unit 2's script in CLI mode.
2. Run the same script with an API key.
3. In CLI mode, add a fourth turn that asks the model to quote the line that comes just before `<skills>` in its
   instructions, or to say there is none.

**Ordering constraint.** After Unit 4.

**How you know it worked.**

- **API:** turn 2 shows `read` greater than zero. Turn 3, after the skills edit, also shows `read` greater than zero,
  about the size of the tools plus the fixed prompt. A `read` of zero on turn 3 means the fixed marker didn't take.
- **`claude` program:**
  - Keep the boundary line when turn 3's `read` is greater than Unit 2's turn-3 `read`, and the fourth turn doesn't
    quote `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`.
  - Otherwise revert Unit 3's join rule. It is self-contained, so reverting it touches nothing else
    ([D-3](artifacts/change-decision-log.md#d-3-the-boundary-line-goes-after-the-first-marked-system-message)).
- Record every turn's numbers, and the keep-or-revert call, in the PR description.

## Risks

Highest first.

- **The `claude` boundary line may do nothing, or show up as literal text, on the subscription route.** Medium:
  plausible, it affects every CLI turn, and it is easy to undo. Unit 5's fourth turn and its turn-3 comparison detect it,
  and the revert is one function.
- **API cache writes that are never read cost 1.25 times with no return.** Medium: it happens on one-step subagent calls,
  on turns after more than five idle minutes, and on the turn after a subagent-list edit
  ([C-15](artifacts/current-state-findings.md#c-15-two-parts-of-the-prompts-leading-content-can-change-between-turns)).
  The log shows these as `read 0, write N`. The single operator's usage limits the cost.
- **Log numbers are compared across paths.** Low to medium. A `claude` line covers a whole run while an API line covers
  one step (contract c). The measurement script avoids tools so each `claude` run is one step.
- **An edit to the subagent list throws away the whole API cache for the next turn**, because the `Task` description
  comes first in the cache order. Low: this is accepted, and the log shows it as a large `write`.
- **A future caller passes `instructions` to `streamText`, and the system prompt silently disappears.** Low. The type no
  longer offers the field, and the Unit 4 `sessions.test.ts` assertion fails if the boundary goes missing (contract d).
- **Wrapping the CLI model adds a stream layer that a stopped turn has to cancel through.** Low. The wrapper passes the
  abort signal and cancellation through, but no test stops a wrapped CLI turn
  ([C-7](artifacts/current-state-findings.md#c-7-wraplanguagemodel-passes-params-provider-options-the-abort-signal-and-the-provider-name-through-for-any-v4-model)).
  The existing stop tests in `sessions.test.ts` run through the wrapped models after Unit 1.
- **The tools plus the fixed prompt might fall below the minimum cacheable size.** Low. The minimum is 1,024 tokens for
  Sonnet 5, and `system-prompt.md` is about 5 KB before the tools are added. Unit 5's first API turn shows it: `write 0`
  means nothing was cached.
- **Automatic caching rests on an option the installed provider supports but doesn't document.** Low. Unit 1's test pins
  the call option, and the log shows the effect after an upgrade.
- **Opus 5.5 in `claude -p` reportedly rewrites its whole cache each turn**, according to a single unconfirmed report.
  This is outside 3pitor's control, and the log shows it if that model is selected.
- **Blast radius:** Units 1 and 4 touch every chat and subagent model call. Errors pass through unchanged
  ([C-11](artifacts/current-state-findings.md#c-11-wrapping-does-not-change-the-errors-callers-see-unless-middleware-catches-or-throws)),
  and the full `sessions.test.ts` suite runs both modes end to end.

## Deferred (YAGNI)

### A one-hour cache lifetime

**Why deferred:** No measurement shows turns more than five minutes apart losing the cache, and the one-hour write costs
twice the base price.
**Reopen when:** logs show `read 0, write N` on turns that follow a pause of more than five minutes.
**Source:** research Recommendation; architect.

### A switch to turn the cache log off

**Why deferred:** The operator asked for the log and named no case for silencing it.
**Reopen when:** the operator asks to quiet the log.
**Source:** architect.

### Labelling log lines as chat or subagent

**Why deferred:** Nothing shows the provider and model ID are not enough to tell the calls apart.
**Reopen when:** Unit 5 shows the operator can't tell which call a line belongs to.
**Source:** architect.

### Keeping the `Task` description stable between turns

**Why deferred:** Nothing measured shows how often it changes.
**Reopen when:** the logs show full API cache writes on turns where only the subagent list changed.
**Source:** research Validation V4.

### A null check in the CLI's usage parsing

**Why deferred:** A missing cache field arrives as `undefined` and the log prints `-`. Only the unlogged `total` would be
wrong.
**Reopen when:** a `claude-cli` log line shows `-`.
**Source:** behavioral-analyst B-6; junior-developer JD-006.

### A separate module for model middleware

**Why deferred:** One custom middleware with two uses, both in `claude-backend.ts`, doesn't justify a module.
**Reopen when:** a third place wraps models.
**Source:** architect.

### An extra test that the `Task` subagent call carries the cache setting

**Why deferred:** Unit 1's backend test already pins the setting on `subagentModel`, and `taskTool` uses that method.
**Reopen when:** the `Task` tool builds its model some other way.
**Source:** test-engineer V-7.

### A test that a stopped turn prints no log line

**Why deferred:** Low value. Contract (c) states the behavior, and nothing reads the log.
**Reopen when:** the log ever prints a line for a stopped turn.
**Source:** test-engineer V-9.

### A startup check of the `claude` version

**Why deferred:** One operator, with `claude` 2.1.286 installed.
**Reopen when:** someone runs 3pitor with a `claude` older than 2.1.275, or Unit 5 shows the boundary leaking.
**Source:** junior-developer JD-004.

## Cut for Scope

- **Letting `claude` keep its own conversation (`--resume` or one long-running process), so it could cache the history
  natively.** This would have changed how the CLI path receives earlier messages. It was cut because the scope
  boundary's Direction of Travel keeps the transcript design ("Keep it, measure first").
- **Sending the CLI history as structured stream-json messages.** This would have given `claude` per-message boundaries
  to cache against. It was cut on the same citation, and an earlier decision found the format unconfirmed
  ([C-6](artifacts/current-state-findings.md#c-6-the-cli-receives-history-as-one-text-transcript-by-an-earlier-decision)).

You can reinstate either. Saying so is enough justification for the reinstated entry.

## Open Items

- **Does `claude` 2.1.286 honor the boundary line on the subscription route?** Non-blocking. Unit 5 settles it.
- **Do `claude`'s reported counts add up across its internal steps?** Non-blocking. The measurement script avoids tools,
  so it doesn't matter for Unit 5. It matters only when reading the log for tool-heavy turns.
- **How often does the skills list change in real use?** Non-blocking. The log will show it over time as a turn with a
  smaller `read` than the turn before. It decides whether the split prompt pays for itself
  ([D-12](artifacts/change-decision-log.md#d-12-keep-the-split-prompt-and-boundary-line-despite-the-yagni-challenge)).

## Review Findings

One review round ran, with three reviewers: `han-core:junior-developer`, `han-core:test-engineer` and
`han-core:risk-analyst`. The decisions they produced are D-10, D-11 and D-12, plus changes to D-3 and D-5 in
[artifacts/change-decision-log.md](artifacts/change-decision-log.md).

- **S-6 was mislabelled Preserving** (risk-analyst R1, test-engineer V-1). It is where the API split and the boundary
  line take effect. Relabelled Changing. The junior developer found the label true for `sessions.ts` alone, which the
  entry still says.
- **The measurement couldn't detect what the split is for** (junior-developer JD-001, risk-analyst R2). Fixes:
  - a baseline unit before anything the `claude` program can see (Unit 2);
  - a skills edit between turns 2 and 3;
  - a direct question to detect a leaked line;
  - a stated keep-or-revert rule (Unit 5).
- **Whether the split prompt and boundary line are worth it** (junior-developer JD-003, risk-analyst YAGNI 1 and 3). Kept,
  with the dissent recorded in D-12.
- **Automatic caching on subagents** (risk-analyst YAGNI 2). Kept. Every subagent step after the first re-sends the
  same prefix (C-4). The cost of unread writes is now a listed risk.
- **The log tests were too loose** (test-engineer V-3). They now require exactly one line, cover both the streamed and
  generated paths, and test `-` against `0`.
- **The boundary tests missed three-message cases** (test-engineer V-6). Unit 3 now has the four-message test.
- **Contract (b)'s byte-for-byte wording was ambiguous, and the version floor was unstated** (risk-analyst, junior-developer
  JD-004). Both are restated in contract (b).
- **The `claude` log covers a whole run** (junior-developer JD-005, risk-analyst R4). Stated in contract (c), and the
  measurement script avoids tools.
- **The null-check deferral had a trigger that could never fire** (junior-developer JD-006). Trigger corrected.
- **A redundant subagent assertion** (test-engineer V-7). Deferred.

Unverified, so not blocking: every runtime claim about the `claude` binary (boundary handling, adding up of counts, an
empty `--system-prompt`) and about live Anthropic caching. No reviewer ran either, and Units 2 and 5 are how they get
checked.

# Change Plan: Prompt Caching Through AI SDK Middleware

## Why This Change

Chat sends the same long system prompt and tool list on every model call, and none of it is cached today. That costs
full input price and time on every step. The operator asked for prompt caching on both ways chat reaches Claude: the
Anthropic API through the AI SDK, and the installed `claude` program. They also asked for the agent code to deliver the
system prompt and similar concerns through AI SDK middleware. The reason class is a decision already taken: the
recommendation in `docs/research/prompt-caching-ai-sdk-and-claude-cli.md`, plus the operator's request recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md).

## What Changes, In One Paragraph

After this change, each model that chat and its subagents use is wrapped in AI SDK middleware, and the wrapping does
the work the call sites did before. The chat model carries its own system prompt, split into a fixed part marked for
caching and the per-turn skills list. On the API path, every call asks Anthropic to cache automatically. On the
`claude` path, the cache mark becomes a boundary line in the system prompt, so `claude` can cache the fixed part on its
own. Every model call on both paths prints one log line with its cache read and write counts, so the operator can see
whether caching works. The history design for the `claude` program does not change.

## Current State

Every model is built through two methods on the backend, and nothing wraps them
([C-1](artifacts/current-state-findings.md#c-1-every-chat-and-subagent-model-is-built-through-the-backends-two-methods)).
The system prompt is one string, built every turn and handed to `streamText` beside the model
([C-2](artifacts/current-state-findings.md#c-2-the-instructions-are-one-string-built-per-turn-and-spread-into-streamtext-beside-the-model)).
A string can't carry a cache marker. Only the list-of-system-messages form keeps per-message provider options
([C-3](artifacts/current-state-findings.md#c-3-a-string-instruction-becomes-one-system-message-with-no-provider-options-the-message-list-form-keeps-them)).
The fixed text already comes first so a cache point could go between it and the skills list
([C-16](artifacts/current-state-findings.md#c-16-the-fixed-prompt-first-order-was-chosen-to-allow-a-future-cache-breakpoint)).

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

### Contract (a): the system messages `instructionsFor` produces

`instructionsFor` produces them. The Anthropic provider and `claudeArgs` both read them
([D-2](artifacts/change-decision-log.md#d-2-one-cache-marker-key-for-both-paths)).

```ts
[
  { role: 'system', content: systemPrompt.trimEnd(),
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
  { role: 'system', content: `<skills>\n${SKILLS_INTRO}\n${lines.join('\n')}\n</skills>` },
]
```

The marker is the presence of `providerOptions.anthropic.cacheControl`. `claudeArgs` checks only that it is present and
truthy, and never compares its value.

### Contract (b): how `claudeArgs` joins system messages

1. Find the first system message carrying the marker.
2. If at least one system message follows it, the separator after it is
   `\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\n`.
3. Every other separator stays `\n\n`.

With no marked message, or with the marked message last, the output is the same as today
([D-3](artifacts/change-decision-log.md#d-3-the-boundary-line-goes-after-the-first-marked-system-message)). Worked
example of the `--system-prompt` value:

```text
<system-prompt.md, trailing whitespace trimmed>

__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__

<skills>
When a request matches one, or the user types /<name>, Read its file first ...
- collaborative-editing (3pitor://skills/collaborative-editing/SKILL.md): ...
</skills>
```

Remove the boundary line and one blank line, and this is byte for byte today's string.

### Contract (c): the cache log line

Printed with `console.log`, once per model call. On the API path that means once per step, and on the `claude` path
once per turn
([C-5](artifacts/current-state-findings.md#c-5-the-cli-model-joins-system-messages-into-one---system-prompt-and-ignores-their-provider-options),
[D-5](artifacts/change-decision-log.md#d-5-one-console-log-line-per-model-call-with-cache-read-and-write-counts)).

```text
3pitor: cache ${model.provider} ${model.modelId}: read ${inputTokens.cacheRead ?? '-'}, write ${inputTokens.cacheWrite ?? '-'}
```

Examples:

```text
3pitor: cache anthropic.messages claude-sonnet-5: read 11842, write 0
3pitor: cache claude-cli claude-sonnet-5: read 9120, write 412
```

`-` means the count was missing. It is never printed as `0`, so a missing count is not mistaken for a real zero.

### Contract (d): what `agentSettings` returns

```ts
agentSettings(...): Promise<{ model: LanguageModel; tools: ToolSet }>
```

Callers must not pass `instructions` or `system` to `streamText`. `defaultInstructionsMiddleware` silently does nothing
when the call already has a system message
([C-8](artifacts/current-state-findings.md#c-8-defaultinstructionsmiddleware-adds-a-list-of-system-messages-with-their-provider-options-only-when-the-call-has-none)).
Removing the field from the type is what stops a caller from doing it by accident
([D-7](artifacts/change-decision-log.md#d-7-agentsettings-returns-only-the-model-and-the-tools)).

## Surface Delta

### S-1: `instructionsFor` — Re-scoped

**Target state.** `instructionsFor(skills)` in `agent.ts` stays private. It returns `SystemModelMessage[]` in the shape
of contract (a): the fixed prompt marked for caching, then the skills block. The text of each part is what today's
single string carries on either side of its `\n\n` join.

**Behavior.** Changing. On the API path, the request's `system` field carries two text blocks instead of one, and the
first one carries `cache_control`. The model reads the same words. The operator delegated this decision ("make the best
decisions you can, without asking me").

**Why.** A string can't carry a cache marker, and the list form can
([C-3](artifacts/current-state-findings.md#c-3-a-string-instruction-becomes-one-system-message-with-no-provider-options-the-message-list-form-keeps-them)).
Splitting at the fixed-then-skills seam keeps a skills change from invalidating the fixed prompt's cache
([C-15](artifacts/current-state-findings.md#c-15-two-parts-of-the-prompts-leading-content-can-change-between-turns),
[C-16](artifacts/current-state-findings.md#c-16-the-fixed-prompt-first-order-was-chosen-to-allow-a-future-cache-breakpoint)).

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-deliver-the-system-prompt-through-defaultinstructionsmiddleware), [D-2](artifacts/change-decision-log.md#d-2-one-cache-marker-key-for-both-paths)

### S-2: `claudeArgs` — Re-scoped

**Target state.** `claudeArgs` in `claude-cli.ts` builds `--system-prompt` by the joining rule of contract (b). It reads
`providerOptions?.anthropic?.cacheControl` on system messages for that purpose and for nothing else. Argument order,
stdin, the history transcript, and the empty `--system-prompt ''` case are unchanged.

**Behavior.** Changing. Once S-6 lands, `claude` receives the boundary line in its system prompt. Whether `claude`
honors it on the subscription route is unknown
([findings, Findings No Agent Could Audit](artifacts/current-state-findings.md#findings-no-agent-could-audit)). The
operator delegated the decision. It is accepted, and Unit 4 checks it.

**Why.** `claude` can't read provider options
([C-5](artifacts/current-state-findings.md#c-5-the-cli-model-joins-system-messages-into-one---system-prompt-and-ignores-their-provider-options)),
so the place that builds its arguments has to translate the marker.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-boundary-line-goes-after-the-first-marked-system-message)

### S-3: `logCacheUsage` — Added

**Target state.** `logCacheUsage` is a private `LanguageModelMiddleware` constant in `claude-backend.ts`. Its
`wrapStream` pipes the stream through unchanged and prints contract (c)'s line when the `finish` part passes. Its
`wrapGenerate` awaits the result and prints the same line from `result.usage`. It never catches, throws, or alters a
part. An aborted stream has no `finish` part, so it prints nothing.

**Behavior.** Changing. The server log gains one line per model call. The operator asked for this ("Include it").

**Why.** The operator asked for per-call cache counts on both paths. Both backends already produce the counts in the
same shape
([C-10](artifacts/current-state-findings.md#c-10-both-backends-report-the-same-usage-shape-and-nothing-logs-it)), and
a pass-through wrapper leaves errors as they are
([C-11](artifacts/current-state-findings.md#c-11-wrapping-does-not-change-the-errors-callers-see-unless-middleware-catches-or-throws)).

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-one-console-log-line-per-model-call-with-cache-read-and-write-counts)

### S-4: `apiBackend.chatModel` and `apiBackend.subagentModel` — Re-scoped

**Target state.** Each returns:

```ts
wrapLanguageModel({ model: anthropic(id), middleware: [logCacheUsage, defaultSettingsMiddleware({ settings: { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } } })] })
```

Every API call, chat and subagent, asks Anthropic for automatic caching with the default five-minute lifetime and is
logged. The `ClaudeBackend` interface is unchanged.

**Behavior.** Changing. Replies are the same. Repeated prefixes are billed at the cache rate, with a write premium on
first use. The operator delegated the decision.

**Why.** The research recommends automatic mode for the API path. The installed provider supports it through this
option
([C-9](artifacts/current-state-findings.md#c-9-the-anthropic-provider-supports-per-system-message-markers-a-request-level-marker-and-at-most-four-breakpoints)).
Subagents run up to ten steps each, and they would get no caching otherwise
([C-4](artifacts/current-state-findings.md#c-4-subagents-use-a-separate-model-their-own-instructions-and-generatetext)).

**Depends on.** S-3.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-automatic-caching-on-every-api-call-with-the-default-lifetime), [D-6](artifacts/change-decision-log.md#d-6-two-wrap-sites-split-by-what-the-prompt-says-versus-what-differs-by-mode)

### S-5: `cliBackend.chatModel` and `cliBackend.subagentModel` — Re-scoped

**Target state.** Each returns `wrapLanguageModel({ model: claudeCliModel(...), middleware: [logCacheUsage] })`, with the
same `claudeCliModel` arguments as today. No cache setting is added, because `claude` ignores call-level provider
options.

**Behavior.** Changing only by the log line from S-3. The wrapper reports the inner model's `provider` (`'claude-cli'`)
and passes errors and aborts through
([C-7](artifacts/current-state-findings.md#c-7-wraplanguagemodel-passes-params-provider-options-the-abort-signal-and-the-provider-name-through-for-any-v4-model),
[C-11](artifacts/current-state-findings.md#c-11-wrapping-does-not-change-the-errors-callers-see-unless-middleware-catches-or-throws)).

**Why.** The operator asked for the log on both paths.

**Depends on.** S-3.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-one-console-log-line-per-model-call-with-cache-read-and-write-counts), [D-6](artifacts/change-decision-log.md#d-6-two-wrap-sites-split-by-what-the-prompt-says-versus-what-differs-by-mode)

### S-6: `agentSettings` — Re-scoped

**Target state.** `agentSettings` returns `{ model, tools }`, per contract (d). It builds the chat model on every turn:

```ts
wrapLanguageModel({ model: backend.chatModel(id, tools), middleware: defaultInstructionsMiddleware({ instructions: instructionsFor(config.skills) }) })
```

The model carries the turn's system prompt, so skills still reload each turn. The `Task` subagent model is passed to
`taskTool` as `backend.subagentModel(id, files)`, unwrapped here. The file's header comment says the model now carries
the instructions.

**Behavior.** Preserving for its callers. `sessions.ts` spreads the result into `streamText`
([C-2](artifacts/current-state-findings.md#c-2-the-instructions-are-one-string-built-per-turn-and-spread-into-streamtext-beside-the-model)),
so the model still receives the system prompt before the messages. The change in what the model receives is recorded on
S-1. No other caller exists
([C-14](artifacts/current-state-findings.md#c-14-no-code-outside-the-area-calls-the-model-or-instruction-functions)).

**Why.** The operator asked for the system prompt to move into AI SDK middleware, and the built-in middleware does
exactly that
([C-8](artifacts/current-state-findings.md#c-8-defaultinstructionsmiddleware-adds-a-list-of-system-messages-with-their-provider-options-only-when-the-call-has-none)).

**Depends on.** S-1, S-2. S-2 must land first so that the CLI's first marked prompt already has the boundary rule.

**Migration.** Do not pass `instructions` from `agentSettings` to `streamText`. The field no longer exists.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-deliver-the-system-prompt-through-defaultinstructionsmiddleware), [D-7](artifacts/change-decision-log.md#d-7-agentsettings-returns-only-the-model-and-the-tools)

## Behavior Changes

The operator delegated every behavior-change decision in this run ("make the best decisions you can, without asking
me"). Each one below was accepted on that authority.

- **The API request's system prompt arrives as two blocks, with the first marked for caching (S-1).** Observer: no
  human sees it, and the model reads the same words. Anthropic's usage shows cache reads on repeat calls. Accepted.
- **API calls ask Anthropic to cache automatically (S-4).** Observer: the operator's Anthropic bill and latency. Repeat
  prefixes cost about a tenth. The first write of each prefix costs 1.25 times. Replies don't change. Accepted.
- **The `claude` program's system prompt gains a boundary line (S-2, effective with S-6).** Observer: `claude`, and
  indirectly the operator's subscription usage. If `claude` doesn't honor the line on the subscription route, it may pass
  it to the model as text. Accepted, with Unit 4 as the check and the revert path.
- **The server log prints one cache line per model call (S-3, S-5).** Observer: the operator watching the terminal.
  Requested by the operator.

## Change Units

### Unit 1: Teach the CLI model the boundary line

**What it does.** `claudeArgs` puts the boundary line after the first marked system message, per contract (b). No code
marks a message yet, so the prompt `claude` receives is unchanged.

**Delta entries.** S-2.

**How you know it worked.** All existing `claude-cli.test.ts` tests pass unchanged, including the `'Be brief.'` pins.
New tests:

- Marked `'Fixed.'` followed by `'Skills.'` gives `--system-prompt` = `'Fixed.\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\nSkills.'`.
- A marked message that comes last gives a plain `\n\n` join.

### Unit 2: Wrap every backend model with the cache log, and turn on API caching

**What it does.** Adds `logCacheUsage` to `claude-backend.ts`. Wraps both API models with the log and automatic caching,
and both CLI models with the log.

**Delta entries.** S-3, S-4, S-5.

**How you know it worked.**

- Rewrite `claude-backend.test.ts:43-44` (`toBe(model)`), keeping its intent ("the API backend uses Anthropic's
  model"):
  - Run `generateText` through `chatModel` and `subagentModel`.
  - Assert the mock received the call.
  - Assert the call's `providerOptions` equal `{ anthropic: { cacheControl: { type: 'ephemeral' } } }`.
- Add a log test per backend using `spyOn(console, 'log')`. Each must assert the exact line for a scripted usage, and
  that `-` is printed for a missing count.
- In `agent.test.ts`, the subagent prompt assertion at line 68 stays as it is, because the settings middleware touches
  only call-level options. Add one assertion that the subagent call carries the cache setting.
- The full suite passes. The log lines in test output are expected.

### Unit 3: Deliver the system prompt through middleware

**What it does.** `instructionsFor` returns contract (a)'s two messages. `agentSettings` wraps the chat model with
`defaultInstructionsMiddleware` and stops returning `instructions`.

**Delta entries.** S-1, S-6.

**Ordering constraint.** After Unit 1, so the first marked prompt `claude` receives already has the boundary line.
After Unit 2 is not required, but landing in plan order keeps each commit's tests simple.

**How you know it worked.**

- Rewrite `agent.test.ts:20-34`:
  - Send the returned `model` one call under `useModel(scriptedModel(...))`.
  - Assert `prompt.slice(0, 2)` equals contract (a), with the same fixed text and skills block as today's test.
- Move `agent.test.ts:43-47` onto `prompt[1].content`.
- In `sessions.test.ts`, the `<skills>` checks at 495-497 still pass. Add
  `toContain('\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\n<skills>')` as the end-to-end proof that contracts (a) and (b)
  agree.
- `sessions.ts` does not change, and its tests pass.

### Unit 4: Measure caching on both paths

**What it does.** A manual check, not code.

1. Run the server with an API key and hold a three-turn chat. Read the cache log lines.
2. Restart in CLI mode and hold a three-turn chat. Read the cache log lines.

**Ordering constraint.** After Unit 3.

**How you know it worked.**

- **API:** turn 2 and later show `read` well above zero.
- **CLI:** compare `read` on turns 2 and 3 with a run where Unit 1's line is removed. If the replies mention
  `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`, or the read counts don't improve, revert Unit 1's join rule. Unit 1 is
  self-contained, so reverting it touches nothing else
  ([D-3](artifacts/change-decision-log.md#d-3-the-boundary-line-goes-after-the-first-marked-system-message)).
- Record the numbers in the PR description.

## Risks

- **The tools plus the fixed prompt might fall below the model's minimum cacheable size, and the fixed marker would then
  do nothing.** The minimum is 1,024 tokens for Sonnet 5, and `system-prompt.md` is about 5 KB. Unit 4 shows it: a
  `write` count of zero on the first API call means nothing was cached.
- **An edit to the subagent list throws away the whole API cache for the next turn**, because the `Task` description
  comes first in the cache order
  ([C-15](artifacts/current-state-findings.md#c-15-two-parts-of-the-prompts-leading-content-can-change-between-turns)).
  This is accepted. The log shows it as a large `write` on that turn.
- **The `claude` boundary line may do nothing, or leak into the prompt, on the subscription route.** Unit 4 detects it
  and the revert is one function.
- **Opus 5.5 in `claude -p` reportedly rewrites its whole cache each turn**, according to a single unconfirmed report.
  This is outside 3pitor's control. Unit 4 shows it if that model is selected.
- **Automatic caching is an option the installed provider supports but its docs don't mention.** A library upgrade
  could change it. Unit 2's test pins the call option, and Unit 4's log shows the effect.
- **Blast radius:** Unit 2 and Unit 3 touch every chat and subagent model call. Errors pass through unchanged
  ([C-11](artifacts/current-state-findings.md#c-11-wrapping-does-not-change-the-errors-callers-see-unless-middleware-catches-or-throws)).
  The full `sessions.test.ts` suite exercises both modes end to end.

## Deferred (YAGNI)

### A one-hour cache lifetime

**Why deferred:** No measurement shows turns spaced more than five minutes apart losing the cache, and the one-hour write
costs twice the base price.
**Reopen when:** Unit 4 or later logs show `write` with no `read` on turns that follow a pause of more than five minutes.
**Source:** research Recommendation; architect.

### A switch to turn the cache log off

**Why deferred:** The operator asked for the log and named no case for silencing it.
**Reopen when:** the operator asks to quiet the log.
**Source:** architect.

### Labelling log lines as chat or subagent

**Why deferred:** Nothing shows the provider and model ID are not enough to tell the calls apart.
**Reopen when:** Unit 4 shows the operator can't tell which call a line belongs to.
**Source:** architect.

### Keeping the `Task` description stable between turns

**Why deferred:** Nothing measured shows how often it changes.
**Reopen when:** the logs show full cache writes on turns where only the subagent list changed.
**Source:** research Validation V4.

### A null check in the CLI's usage parsing

**Why deferred:** `claude` has always sent the cache fields, and the log prints `-` for a missing count instead of a
misleading number.
**Reopen when:** a log line shows `NaN`.
**Source:** behavioral-analyst B-6.

### A separate module for model middleware

**Why deferred:** One custom middleware with two uses, both in `claude-backend.ts`, doesn't justify a module.
**Reopen when:** a third place wraps models.
**Source:** architect.

## Cut for Scope

- **Letting `claude` keep its own conversation (`--resume` or one long-running process), so it could cache the history
  natively.** This would have changed how the CLI path receives earlier messages. It was cut because the scope
  boundary's Direction of Travel keeps the transcript design ("Keep it, measure first").
- **Sending the CLI history as structured stream-json messages.** This would have given `claude` per-message boundaries
  to cache against. It was cut for the same citation, and an earlier decision found the format unconfirmed
  ([C-6](artifacts/current-state-findings.md#c-6-the-cli-receives-history-as-one-text-transcript-by-an-earlier-decision)).

You can reinstate either. Saying so is enough justification for the reinstated entry.

## Open Items

- **Does `claude` 2.1.286 honor the boundary line on the subscription route?** Non-blocking. Unit 4 settles it.
- **Do the tools plus the fixed prompt clear each selectable model's minimum cacheable size?** Non-blocking. Unit 4
  settles it for the default model.

## Review Findings

Filled in after the review round.

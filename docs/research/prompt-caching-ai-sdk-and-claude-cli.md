# Research: Prompt Caching for the AI SDK and Claude CLI Backends, Using AI SDK Middleware

What is the best way to add Anthropic prompt caching to both of 3pitor's chat backends (the Anthropic API through the AI
SDK, and the installed `claude` program), and which agent concerns should move into AI SDK language-model middleware?

Evidence mode: strict.

## Summary

On the API path, caching takes one setting: tell the Anthropic provider to cache automatically, and it moves the cache
point along as the conversation grows. Add one fixed cache point on the unchanging part of the system prompt. Both fit in
AI SDK middleware (code that wraps a model so every call through it can be reshaped before it is sent): one middleware
supplies the system prompt, and another turns caching on for every call. The CLI path
already caches on its own, but 3pitor starts a fresh `claude` for every call and sends the whole history as one block
of text. That probably limits caching to the system prompt and tool definitions, but nobody has measured it. The cheap
step is to mark where the fixed system prompt ends so `claude` can cache it separately. Measure the cache counters
before and after, because it may not help on the subscription route. Changing how the CLI receives history would undo
an earlier design decision, so only revisit it if the numbers justify it.

How solid this is: well corroborated for the API path, which was checked against the installed library code. The CLI
side rests on vendor docs and has not been measured.

- **Confidence:** Medium
- **Web search:** used

## Research Results

### Anthropic offers two ways to mark what gets cached

Anthropic caches a prompt's leading content so later requests that start the same way pay about a tenth of the normal
input price (A1). You can mark up to four cache points by hand ("explicit" mode). Or you can set one request-level
marker ("automatic" mode), which places the cache point on the last block it can cache and moves it as the conversation
grows. Automatic mode uses one of the four slots (A1).

The cached content is read in a fixed order: tool definitions, then the system prompt, then messages. A change at one
level throws away the cache for that level and everything after it (A1). A cache entry lasts five minutes by default,
or one hour at double the write cost (A1). Below a model-specific minimum size, the request is processed uncached and
no error is raised. The minimum is 1,024 tokens for Sonnet 5 and 512 for Sonnet 5.5 and Opus 5.5 (A1).

### The AI SDK "caching" page covers something else

The AI SDK's caching guide stores whole model responses and replays them (A2). That is response caching, not Anthropic
prompt caching, and it does not help here.

### The installed Anthropic provider already supports automatic mode

The provider's docs only describe cache markers on individual messages, system messages, and tools (A3). The installed
version, 4.0.63, also accepts a request-level `cacheControl` option and sends it as Anthropic's top-level automatic
marker (A25). The docs say nothing about it, but the code does it. The provider also counts cache points and drops
anything past four, logging a warning but not raising an error (A26).

The vendor's own recipe for explicit marking adds a marker to the last message on every step of the agent loop (A4).
Wrapping the model in middleware that rewrites cache markers is a working pattern in at least one other project
[single-source] (A7).

### AI SDK middleware fits the system prompt and the cache setting

Middleware wraps a model so every call through it can be reshaped before it is sent (A5). Two built-in middlewares fit
3pitor's needs:

- **Default instructions** adds system messages only when a call has none (A8). The installed version accepts a list of
  system messages, each with its own provider options, so it can add the fixed prompt with a cache marker and the skills
  list without one (A27, A30).
- **Default settings** merges default call options, including provider options, into every call, and the call's own
  values win (A9, A30).

Neither offers a ready-made cache-placement middleware. That would be custom code (A5).

### 3pitor's API path caches nothing today, but its prompt is laid out for caching

The API backend builds the model with only a model ID: no cache markers, no provider options, no middleware (A21). Each
turn, the agent settings rebuild the tools and return the instructions as one string: the fixed prompt, then the skills
list (A22). That order was chosen to leave room for a future cache point (A28). The note about the open file goes in the
user message, not the system prompt, so it does not disturb the cached part (A23).

Two things in the leading content can change between turns, because the workspace config is read again every turn:

1. The skills list, which sits after the fixed prompt and only affects content after it (A22).
2. The Task tool's description, which lists the available subagents. Tools come first in the cache order, so editing
   the agent list throws away the whole cache, including the fixed prompt's cache point (A1, A22).

Subagents run their own loop of up to ten steps through a separate model (A21, A22). If caching is added only to the
main chat model, subagent steps get none of it.

### The `claude` program caches on its own, but 3pitor's way of calling it limits the benefit

Claude Code applies caching automatically. It reports cache reads and writes in its streamed output (A11, A15), and
3pitor already turns those numbers into AI SDK usage counts (A24). A subscription gets the one-hour lifetime by default
and an API key gets five minutes. Environment variables can change this (A11, A18).

3pitor starts a fresh `claude -p` for every model call. It passes the whole system prompt as one replacement prompt and
turns off session persistence (A19). It sends all earlier messages as a single text transcript on standard input (A20).
That was a deliberate decision. 3pitor owns the history, and `--resume` was rejected because it would create a second
history that API mode cannot read (A29).

What this means for caching was not measured. Each new transcript begins with the previous one byte for byte, so some
reuse is possible. How much depends on where Claude Code places its cache points, which no source documents (A11).
Treat the cache read count per turn (A24) as the way to find out.

### A marker line can split the CLI system prompt into a cached part and a changing part

A line containing only `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` in a replacement system prompt splits it in two, so the
static part caches on its own (A12, A14). This needs version 2.1.275 or later, and the installed `claude` is 2.1.286.
The marker string is present in the installed program (V5). The split is honored only on the direct Claude API or
Claude Platform on AWS (A14). 3pitor removes API keys from the child process so it uses the subscription (A19), and no
source says whether the subscription route counts.

A related flag, `--exclude-dynamic-system-prompt-sections`, does not apply, because it is ignored when `--system-prompt`
is passed (A12, V5).

There are two open bug reports, each from a single source. One says Opus 5.5 and Fable 5.1 rewrite the whole cache
every turn in `-p` mode on 2.1.280 (A16). The other says chained `--resume` calls never cached the conversation on an
older version (A17).

## Options to Consider

### O1: API path: turn on automatic caching and add one fixed cache point on the system prompt

- **What it is:** Wrap the API model in a default-settings middleware that sets the request-level cache option on every
  call, so the cache point follows the conversation tail. Add a cache marker on the fixed part of the system prompt so a
  skills-list change does not lose it. This uses two of the four cache points.
- **Trade-offs:** Little code, and it covers every step of the tool loop with no extra work at the call site. It relies
  on a library option the docs do not mention, though it is present in the installed code. Long tool loops can push the
  tail more than twenty blocks past the last cache write, and Anthropic only looks back twenty blocks for a match.
- **Rests on:** (A1), (A25), (A26), (A9), (A30)
- **Evidence status:** corroborated (vendor docs plus installed source)

### O2: API path: mark the last message by hand on every step

- **What it is:** The vendor recipe: a step hook adds a cache marker to the last message before each model call.
- **Trade-offs:** Documented and explicit, but the logic sits at each call site (the chat turn and the subagent call)
  instead of in one place.
- **Rests on:** (A4), (A3)
- **Evidence status:** corroborated

### O3: API path: a custom middleware that places explicit cache points

- **What it is:** A middleware that adds markers to the fixed system message and the last message on every call.
- **Trade-offs:** Central control and full choice of placement. You own code that depends on the provider-level prompt
  format, and no source shows a complete example.
- **Rests on:** (A5), (A7)
- **Evidence status:** single-source (caveated) for the pattern, A7

### O4: API path: route through Vercel's AI Gateway with automatic caching

- **What it is:** A gateway setting that places cache markers for you.
- **Trade-offs:** No marker code, but it adds a hosted gateway to the request path, and the only source is the vendor
  selling it.
- **Rests on:** (A6)
- **Evidence status:** single-source (caveated)

### C1: CLI path: keep the current design and mark the system prompt boundary

- **What it is:** Keep one `claude` per call and the text transcript. Insert the dynamic-boundary line between the fixed
  prompt and the skills list. Measure the cache counters before and after.
- **Trade-offs:** Small change, and it keeps the history decision intact. It may do nothing on the subscription route.
  Conversation reuse stays whatever Claude Code manages with a growing transcript.
- **Rests on:** (A12), (A14), (A19), (A24), (A29)
- **Evidence status:** corroborated for the mechanism. The effect on the subscription route is unknown.

### C2: CLI path: use `claude`'s own sessions (`--resume` or one long-running process)

- **What it is:** Let `claude` hold the conversation natively, so its normal caching applies across turns.
- **Trade-offs:** The documented route to conversation caching (A11). It reverses an earlier decision because it creates
  a second history that API mode cannot read (A29). Two bug reports describe cache misses in this mode (A16, A17).
- **Rests on:** (A11), (A29), (A16), (A17)
- **Evidence status:** mechanism corroborated. Failure reports are single-source.

### C3: CLI path: send history as structured stream-json messages

- **What it is:** Replay each earlier message as its own stream-json input message instead of one transcript.
- **Trade-offs:** Could give clean message boundaries for caching. It was rejected before because the input format for
  replayed assistant and tool messages is unconfirmed, and that is still true.
- **Rests on:** (A29)
- **Evidence status:** single-source (caveated)

## Recommendation

- **Recommendation:** Adopt O1 for the API path and C1 for the CLI path, both delivered through a small middleware stack
  that wraps the models in the backend:

  1. **System prompt middleware, chat model, both backends.** Use the built-in default-instructions middleware with two
     system messages: the fixed prompt, with a cache marker, and the skills list. The agent settings stop passing
     instructions. Subagents keep passing their own instructions to their own model, so this middleware does not touch
     them.
  2. **Cache-setting middleware, API backend, chat and subagent models.** Use the built-in default-settings middleware
     to set the request-level cache option on every call.
  3. **CLI translation, inside the CLI model, not middleware.** When `claude-cli.ts` joins system messages, it inserts
     the dynamic-boundary line after the marked one instead of a plain blank line. `claude` cannot read provider
     options, so the CLI model is the right place for this translation.
  4. **Optional usage-logging middleware, both backends.** Log cache reads and writes per call so a regression shows
     up.

  Keep tools, step limits, and the open-file note where they are. Tools come first in the cache order and must stay
  stable, and the open-file note belongs in the user message.

  Before adopting C1, measure the cache read count over a three-turn chat in CLI mode with and without the boundary
  line. Revisit C2 only if the measurement shows conversation reuse is poor and the cost matters. That is the same
  revisit trigger the earlier design decision set.

- **Evidence basis:**
  - Corroborated by vendor docs and the installed source:
    - the cache order and limits (A1)
    - the request-level option (A25)
    - the per-system-message markers and four-point cap (A26)
    - the built-in middlewares' behavior (A9, A27, A30)
    - the existing usage parsing (A24)
  - Corroborated by two first-party docs and the installed binary: the CLI boundary line (A12, A14). Its effect on the
    subscription route rests on no source, so C1 is conditional on the measurement above.
  - Single-source and not relied on: the CLI bug reports (A16, A17) and the gateway option (A6).

  Unverified: could not confirm with a live call that Anthropic accepts the request-level marker for 3pitor's models,
  because no API calls were made in this research.

## Validation

### V1: The installed provider supports automatic caching

- **Strategy:** Challenge the Evidence
- **Investigation:** Read the installed provider code for the request-level option and the per-system-message marker.
- **Result:** Confirmed
- **Impact:** O1 is available as installed, even though the provider docs omit it.

### V2: The provider docs were cited for a claim they do not make

- **Strategy:** Challenge the Evidence
- **Investigation:** Checked what A3 says against the automatic-mode claim it was attached to.
- **Result:** Partially Refuted
- **Impact:** Automatic mode now cites the installed code (A25) alone, and the report notes that the docs are silent.

### V3: Moving the system prompt into middleware is more than the problem needs

- **Strategy:** Challenge the Recommendation
- **Investigation:** The instructions setting already accepts a list of system messages, so the split could live in the
  existing function that builds the instructions, with no middleware.
- **Result:** Partially Refuted
- **Impact:** Both work. The report keeps middleware because the request asked for it and because the built-in
  default-instructions middleware handles this case as installed (A30). That holds only if the agent settings stop
  passing instructions, which the recommendation now states.

### V4: Tool changes and minimum size can quietly cancel caching

- **Strategy:** Challenge the Recommendation
- **Investigation:** Traced the Task tool's description to the per-turn config reload, and checked whether any size
  check was done.
- **Result:** Confirmed
- **Impact:** Added the tool-order caveat and the minimum-size rule to Research Results. Nobody measured whether the
  tools plus the fixed prompt clear the minimum for each model. The system prompt file is about 5 KB, so it should clear
  1,024 tokens with the tool definitions included, but this was not measured.

### V5: The CLI boundary line exists, but may not apply on the subscription route

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Found the marker string in the installed `claude` binary and checked `--help`. Compared A14's
  direct-API restriction with 3pitor's choice to remove API keys from the child process.
- **Result:** Partially Refuted
- **Impact:** The web sources are not fabricated, but C1's benefit is unproven on the route 3pitor uses. C1 is now
  conditional on measurement.

### V6: "A transcript cannot reuse the cache" was too strong

- **Strategy:** Challenge the Evidence
- **Investigation:** Each turn's transcript starts with the previous one byte for byte, so some reuse is possible.
- **Result:** Partially Refuted
- **Impact:** Research Results now say the effect is unmeasured and point to the per-turn cache read count.

### V7: No single web source carries the recommendation

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Removed each web source in turn and checked whether the recommendation still stood. Looked for
  directive text in the sources.
- **Result:** Confirmed
- **Impact:** The core rests on A1 and the installed code. The interested-party source (A6) supports only a rejected
  option.

### V8: Subagent loops were left without caching

- **Strategy:** Challenge the Recommendation
- **Investigation:** Subagents use a separate model and run up to ten steps.
- **Result:** Partially Refuted
- **Impact:** The cache-setting middleware now covers the subagent model too.

### V9: The cache-point cap holds, but server-side web tools were not checked

- **Strategy:** Challenge the Recommendation
- **Investigation:** Counted cache points: automatic mode plus the system marker is two of four. No source covers how
  automatic placement behaves around the provider-run web search and fetch results.
- **Result:** Partially Refuted
- **Impact:** Added usage logging to the recommendation so a regression would show up.

### Changes made to the recommendation after validation

- Moved the automatic-mode citation from the provider docs to the installed code (V2).
- Scoped the system-prompt middleware to the chat model and stated that agent settings stop passing instructions (V3).
- Added the tool-order and minimum-size caveats (V4).
- Made the CLI boundary line conditional on measurement (V5).
- Softened the transcript claim to "unmeasured" (V6).
- Extended the cache setting to subagents (V8).
- Added usage logging (V9).

### Why confidence is Medium, and the risks that remain

- **Confidence:** Medium
- **Remaining Risks:**
  - Cache hit rates are unmeasured on both paths. Run a short live test that reads the usage counts before merging.
  - Nobody has checked whether tools plus the fixed prompt clear each selectable model's minimum cacheable size.
  - The CLI boundary line may do nothing on the subscription route.
  - The Opus 5.5 `-p` cache-rewrite report (A16) may affect the CLI path whatever 3pitor does. Test that model.
  - The request-level option is in the installed code but not the docs, so a library upgrade could change it.

## Sources

| ID  | Source | Link / location | Retrieved | Trust class | Summary (one line) | Evidence status |
| --- | ------ | --------------- | --------- | ----------- | ------------------ | --------------- |
| A1 | Anthropic prompt caching docs | https://platform.claude.com/docs/en/build-with-claude/prompt-caching | 2026-10-01 | web | Automatic or explicit (max 4) cache points; tools→system→messages order; 5m/1h lifetimes; 0.1x reads; per-model minimum sizes | corroborated by A6, A11 |
| A2 | AI SDK "Caching" page | https://ai-sdk.dev/docs/advanced/caching | 2026-10-01 | web | Response caching via middleware and Redis, not provider prompt caching | corroborated by A6 |
| A3 | AI SDK Anthropic provider docs | https://ai-sdk.dev/providers/ai-sdk-providers/anthropic | 2026-10-01 | web | `cacheControl` on message parts, messages, system messages, and tools; cache counts in usage; no request-level option documented | corroborated by A4, A5; documentation gap shown by A25 |
| A4 | AI SDK cookbook: dynamic prompt caching | https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching | 2026-10-01 | web | Vendor recipe marks the last message on every step via a step hook | corroborated by A6, A7 |
| A5 | AI SDK middleware docs | https://ai-sdk.dev/docs/ai-sdk-core/middleware | 2026-10-01 | web | `wrapLanguageModel` with v4 middleware; built-ins include default settings and default instructions; no cache-placement built-in | corroborated by A27, A30 |
| A6 | Vercel AI Gateway automatic caching | https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching | 2026-10-01 | web (interested party) | Gateway option places markers automatically; confirms price multipliers | single source (caveated) for gateway behavior |
| A7 | vercel/eve issue #4050 | https://github.com/vercel/eve/issues/4050 | 2026-10-01 | web | Another harness rewrites cache markers in a middleware to change lifetime | single source (caveated) |
| A8 | Default instructions middleware reference | https://ai-sdk.dev/docs/reference/ai-sdk-core/default-instructions-middleware | 2026-10-01 | web | Adds instructions only when a call has no system message; accepts system messages with provider options | corroborated by A30 |
| A9 | Default settings middleware reference | https://ai-sdk.dev/docs/reference/ai-sdk-core/default-settings-middleware | 2026-10-01 | web | Merges default call options, including provider options; call values win | corroborated by A30 |
| A10 | vercel/ai issue #7612 | https://github.com/vercel/ai/issues/7612 | 2026-10-01 | web | v5 beta report of system-message caching not hitting | single source (caveated), likely stale |
| A11 | Claude Code: how it uses prompt caching | https://code.claude.com/docs/en/prompt-caching | 2026-10-01 | web | Caching is automatic; model, effort, and tool changes invalidate; 1h on subscription, 5m on API key; cache points undocumented | corroborated by A1, A12, A15 |
| A12 | Claude Code CLI reference | https://code.claude.com/docs/en/cli-reference | 2026-10-01 | web | Replace vs. append system prompt; dynamic-boundary line (2.1.275+); exclude-dynamic flag ignored with `--system-prompt` | corroborated by A14, V5 |
| A13 | Claude Code headless docs | https://code.claude.com/docs/en/headless | 2026-10-01 | web | `-p` output formats and resume; nothing caching-specific | single source, not relied on |
| A14 | Agent SDK: modifying system prompts | https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts | 2026-10-01 | web | Boundary splits the prompt into two cached blocks, only on direct Claude API or Claude Platform on AWS; put changing text in user messages | corroborated by A11, A12 |
| A15 | Agent SDK: cost tracking | https://code.claude.com/docs/en/agent-sdk/cost-tracking | 2026-10-01 | web | Caching automatic; cache read and write counts on assistant and result messages | corroborated by A11 |
| A16 | anthropics/claude-code #96163 | https://github.com/anthropics/claude-code/issues/96163 | 2026-10-01 | web (user report) | On 2.1.280, Opus 5.5 and Fable 5.1 rewrite the whole cache each turn in `-p` | single source (caveated) |
| A17 | anthropics/claude-code #91971 | https://github.com/anthropics/claude-code/issues/91971 | 2026-10-01 | web (user report) | On 2.1.79, chained `--resume` calls never cached the conversation | single source (caveated), older version |
| A18 | anthropics/claude-code #48082 | https://github.com/anthropics/claude-code/issues/48082 | 2026-10-01 | web | Changelog quote adding the 1h and forced-5m cache variables | corroborated by A11, A15 |
| A19 | CLI model arguments and spawn | `src/server/chat/claude-cli/claude-cli.ts:110-117,147-167` | n/a | codebase | Fresh `claude -p` per call in the temp folder; all system messages joined into `--system-prompt`; no session persistence; API keys removed | codebase anchor |
| A20 | CLI history transcript | `src/server/chat/claude-cli/claude-cli.ts:188-197` | n/a | codebase | Earlier messages sent as one `<history>` text transcript plus the new message | codebase anchor |
| A21 | Backend seam | `src/server/chat/claude-backend/claude-backend.ts:28-51` | n/a | codebase | API chat and subagent models are `anthropic(modelId)` with no options; CLI returns its own model; one shared seam | codebase anchor |
| A22 | Agent settings and instructions | `src/server/chat/agent/agent.ts:42-68,86-98,110-116` | n/a | codebase | Config reloaded per turn; Task tool lists subagents; instructions are fixed prompt then skills, as one string; subagents pass their own | codebase anchor |
| A23 | Chat turn | `src/server/chat/sessions/sessions.ts:94-116` | n/a | codebase | Open-file note is a second part of the user message; turn calls `streamText` with the agent settings | codebase anchor |
| A24 | CLI usage parsing | `src/server/chat/claude-cli/stream-json.ts:75-94` | n/a | codebase | Cache read and write counts already mapped into AI SDK usage | codebase anchor |
| A25 | Provider request-level cache option | `node_modules/@ai-sdk/anthropic/dist/index.js:1117-1123,4513-4515` | n/a | codebase | Request-level `cacheControl` sent as Anthropic's top-level automatic marker | codebase anchor; corroborated by A1, V1 |
| A26 | Provider cache-point validator | `node_modules/@ai-sdk/anthropic/dist/index.js:1340-1372,2835-2850` | n/a | codebase | System-message `cacheControl` becomes a block marker; markers past four dropped with a warning | codebase anchor |
| A27 | AI SDK instructions type | `node_modules/ai/dist/index.d.ts:797,8916` | n/a | codebase | Instructions accept a string or a list of system messages; middleware built-ins exported | codebase anchor |
| A28 | System prompt decision D-2 | `docs/changes/content-editor-system-prompt/artifacts/change-decision-log.md:61-74` | n/a | codebase | Fixed prompt first, skills list after, to keep a future cache point possible | codebase anchor |
| A29 | CLI adapter decision D-5 | `docs/changes/claude-api-or-cli-adapter/artifacts/change-decision-log.md:115-133` | n/a | codebase | History replayed as text; `--resume` and stream-json input rejected; revisit if transcript size slows turns | codebase anchor |
| A30 | Built-in middleware source | `node_modules/ai/dist/index.js:17438-17468` | n/a | codebase | Default instructions prepends a list of system messages with provider options when none exist; default settings merges options | codebase anchor; corroborated by A8, A9 |

### A1: Anthropic prompt caching docs (recommendation-bearing)

- **Link / location:** https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- **Retrieved:** 2026-10-01
- **Trust class:** web (outside the trust boundary)
- **Summary:** Two modes. Automatic mode puts one top-level `cache_control` on the request, and the cache point follows
  the last cacheable block. Explicit mode allows up to four block markers, and automatic mode uses one of them. Content
  is matched in tool, system, message order, and a change invalidates its level and everything after it. Matches look
  back up to 20 blocks. Lifetimes are 5 minutes (1.25x write) or 1 hour (2x write), and reads cost 0.1x. Minimum
  cacheable size depends on the model: 1,024 tokens for Sonnet 5, 512 for Sonnet 5.5 and Opus 5.5. Usage reports
  `cache_creation_input_tokens` and `cache_read_input_tokens`.
- **Evidence status:** corroborated by A6, A11

### A25: Provider request-level cache option (recommendation-bearing)

- **Link / location:** `node_modules/@ai-sdk/anthropic/dist/index.js:1117-1123,4513-4515`
- **Retrieved:** n/a
- **Trust class:** codebase (trusted current-state anchor)
- **Summary:** The provider options schema for `@ai-sdk/anthropic` 4.0.63 includes `cacheControl: { type: 'ephemeral',
  ttl?: '5m' | '1h' }`. When it is set, the request body gets a top-level `cache_control`, which is Anthropic's automatic
  mode. The provider docs do not mention it.
- **Evidence status:** corroborated by A1 (the API feature) and V1 (independent read)

### A30: Built-in middleware source (recommendation-bearing)

- **Link / location:** `node_modules/ai/dist/index.js:17438-17468`
- **Retrieved:** n/a
- **Trust class:** codebase (trusted current-state anchor)
- **Summary:** `defaultInstructionsMiddleware` turns a string or a list of system messages into system prompt entries,
  keeping each one's provider options. It prepends them only when the call has no system message. Because of that,
  agent settings must stop passing `instructions` for this middleware to take effect. `defaultSettingsMiddleware`
  merges its settings, including provider options, into each call's parameters.
- **Evidence status:** corroborated by A8, A9

### A12 and A14: CLI system-prompt boundary (recommendation-bearing for C1)

- **Link / location:** https://code.claude.com/docs/en/cli-reference and
  https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
- **Retrieved:** 2026-10-01
- **Trust class:** web (outside the trust boundary)
- **Summary:** In a replacement system prompt, a line containing only `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` (version
  2.1.275 or later) splits the prompt so the static part is cached on its own. The split is honored only on the direct
  Claude API or Claude Platform on AWS. The installed binary contains the marker string (V5).
- **Evidence status:** corroborated by A11 and V5. The effect on the subscription route rests on no source.

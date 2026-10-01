# Change Decision Log: Prompt Caching Through AI SDK Middleware

This file records every decision made while planning this change. The plan is [../change-plan.md](../change-plan.md),
and the current-state evidence is [current-state-findings.md](current-state-findings.md).

Partway through the run, the operator said: "make the best decisions you can, without asking me". Every
behavior-change decision below was settled on that authority instead of through an escalation.

## Trivial decisions

- D-8: `sessions.ts` does not change. It spreads whatever `agentSettings` returns into `streamText`, so dropping
  `instructions` needs no edit there (C-2). — Referenced in plan: Change Units (Unit 4).
- D-9: The `claude` program keeps receiving history as a text transcript. The operator chose "Keep it, measure first".
  — Referenced in plan: What Changes, In One Paragraph; Cut for Scope.

## Full decisions

### D-1: Deliver the system prompt through `defaultInstructionsMiddleware`

- **Question:** How does the chat model receive its system prompt?
- **Decision:** `agentSettings` wraps `backend.chatModel(id, tools)` with
  `defaultInstructionsMiddleware({ instructions: instructionsFor(config.skills) })` on every turn.
  `instructionsFor` returns `SystemModelMessage[]` per contract (a) in the plan. Subagents keep
  `generateText({ instructions: agent.prompt })` on an unwrapped-by-agent model.
- **Rationale:** The operator asked for the system prompt to move into AI SDK middleware. The built-in middleware takes
  a list of system messages with their provider options, which is exactly what caching needs (C-8). The model is
  already built per turn, so the per-turn skills list still works (C-2).
- **Evidence:** C-2, C-3, C-8, C-15, C-16; operator request in `artifacts/scope-boundary.md`; research A30.
- **Behavior impact:** Changing (S-1). The API request carries two system blocks instead of one, and the model reads the
  same words. Settled under the operator's delegation.
- **Rejected alternatives:**
  - Return `instructions: SystemModelMessage[]` from `agentSettings` and pass it to `streamText` — strictly simpler and
    enough for caching (C-3, research V3). Rejected only because the operator asked for middleware. If that request is
    withdrawn, this alternative replaces D-1.
  - A custom system-prompt middleware — the built-in covers the need (C-8).
  - Pass instructions into `ClaudeBackend.chatModel` — that duplicates mode-independent content into both backends and
    changes an interface with no new caller (C-14).
- **Revisit criterion:** The operator withdraws the middleware requirement, or a caller needs to pass its own system
  prompt to the chat model.
- **Dissent (if any):** The research run's validator (V3) called the middleware over-engineered compared with the
  array form. The junior-developer review (JD-003) suggested passing the plain string through the middleware instead
  of the two-message list. Disagree and commit: the middleware stays on the operator's stated preference, and the
  two-message list stays per D-12.
- **Settles delta entry:** S-1, S-6
- **Dependent decisions:** D-2, D-7, D-12
- **Referenced in plan:** Surface Delta (S-1, S-6)

### D-2: One cache marker key for both paths

- **Question:** How does a system message say "cache everything up to here", in a form both the Anthropic provider and
  the CLI model read?
- **Decision:** The marker is `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }` on the fixed
  system message. The provider turns it into `cache_control` (C-9). `claudeArgs` treats its presence as the marker and
  ignores its value.
- **Rationale:** The provider already reads this key. Reusing it means no 3pitor-specific key and no shared constant.
  The CLI model reaches the same Anthropic models, so reading the `anthropic` namespace there is accurate.
- **Evidence:** C-3, C-5, C-9.
- **Behavior impact:** Changing, via S-1 and S-2. Settled under the operator's delegation.
- **Rejected alternatives:**
  - A separate `claudeCli` provider-options namespace — two markers to keep in sync for one fact.
  - A shared exported constant for the marker value — two literal uses, and the CLI never compares the value.
- **Revisit criterion:** A system message needs to be cached on one path but not the other.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** D-3
- **Referenced in plan:** Target State (contract a); Surface Delta (S-1)

### D-3: The boundary line goes after the first marked system message

- **Question:** Where does `claudeArgs` put `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`?
- **Decision:** Contract (b) in the plan.
  1. Find the first marked system message.
  2. If at least one system message follows it, the separator after it is `\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\n`.
  3. Every other separator is `\n\n`.
  4. With no marked message, or with the marked one last, the output is identical to today's.
- **Rationale:** `claude` caches a replacement system prompt's static part separately only when this line splits it
  (research A12, A14). The installed binary contains the marker string (research V5). Placing it at the existing
  fixed-then-skills seam keeps the change byte-for-byte reversible.
- **Evidence:** C-5, C-16; research A12, A14, V5.
- **Behavior impact:** Changing (S-2). Whether `claude` honors the line on the subscription route is unknown. Settled
  under the operator's delegation. Unit 5 is the check: revert this join rule if the model quotes the marker when asked,
  or if turn 3's `read` (after a skills edit) is not greater than Unit 2's baseline.
- **Ordering:** a `claude` baseline is measured before this rule can take effect (D-10).
- **Rejected alternatives:**
  - A middleware that rewrites the prompt into the boundary form — `claudeCliModel` is the only consumer, and the
    translation belongs where the arguments are built.
  - `--exclude-dynamic-system-prompt-sections` — ignored when `--system-prompt` is passed (research V5).
  - Skipping the CLI side until measured — the operator asked for a solution for both paths. The change is small and
    reversible.
- **Revisit criterion:** Unit 5 shows no read improvement over Unit 2's baseline, or the model quotes the marker.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-10, D-11
- **Referenced in plan:** Target State (contract b); Surface Delta (S-2); Change Units (Unit 5)

### D-4: Automatic caching on every API call, with the default lifetime

- **Question:** How does the API path place cache points on the conversation?
- **Decision:** `apiBackend` wraps both of its models with
  `defaultSettingsMiddleware({ settings: { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } } })`.
  This is Anthropic's automatic mode with the five-minute lifetime.
- **Rationale:** Automatic mode follows the conversation tail with one setting (research O1). The installed provider
  supports it (C-9). Covering the subagent model gives its ten-step loops caching too (C-4, research V8). Together with
  the fixed marker it uses two of four cache points (C-9).
- **Evidence:** C-4, C-9; research A1, A25, O1, V8, V9.
- **Behavior impact:** Changing (S-4). Billing and latency change, and replies don't. Settled under the operator's
  delegation.
- **Rejected alternatives:**
  - Mark the last message by hand in `prepareStep` (research O2) — logic at two call sites instead of one.
  - A custom middleware that places explicit cache points (research O3) — more code, and only a single-source example.
  - A one-hour lifetime — no measurement shows it pays for its double write cost. Deferred.
- **Revisit criterion:** The logs show the automatic placement missing reads in long tool loops. Anthropic's look-back
  covers 20 blocks.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** D-6
- **Referenced in plan:** Surface Delta (S-4)

### D-5: One console log line per model call, with cache read and write counts

- **Question:** How does the operator see whether caching works?
- **Decision:** A private `logCacheUsage` middleware in `claude-backend.ts`. `wrapStream` pipes the stream through and
  logs when the `finish` part passes, including an error finish. A stream with no `finish` logs nothing. `wrapGenerate`
  logs from `result.usage` after the result resolves, and logs nothing when the call throws. One `claude` line covers a
  whole `claude` run, and one API line covers one step, so the two are not compared. Both print contract (c):
  `3pitor: cache ${model.provider} ${model.modelId}: read ${cacheRead ?? '-'}, write ${cacheWrite ?? '-'}` with
  `console.log`. It never catches, throws, or changes a part.
- **Rationale:** The operator asked for it. Both backends already produce the counts in one shape (C-10). `console.log`
  with a `3pitor` prefix matches the server's info lines (`src/server/server.ts:25,50`). Pass-through keeps errors as
  they are (C-11).
- **Evidence:** C-10, C-11; operator's answer "Include it".
- **Behavior impact:** Changing (S-3, S-5). The server log gains lines. Requested by the operator.
- **Rejected alternatives:**
  - The `onLanguageModelCallEnd` callback on `streamText` — it misses subagent `generateText` calls unless it is added
    at each call site.
  - A structured logger — none exists in the project (findings, Gaps).
  - A new module — one middleware with two uses. Deferred.
- **Revisit criterion:** The operator wants the log silenced or routed elsewhere.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-5
- **Dependent decisions:** D-6
- **Referenced in plan:** Target State (contract c); Surface Delta (S-3, S-5)

### D-6: Two wrap sites, split by what the prompt says versus what differs by mode

- **Question:** Where is `wrapLanguageModel` applied, and in what order?
- **Decision:** `claude-backend.ts` returns every model already wrapped:
  - API: `[logCacheUsage, defaultSettings(cache)]`
  - CLI: `[logCacheUsage]`

  `agent.ts` adds `defaultInstructionsMiddleware` around the chat model only. The first array element is outermost
  (C-7).
- **Rationale:** The backend file's own header says it is the one place that knows what differs by mode (C-1). The
  system prompt is the same in both modes, so it belongs in `agent.ts`. The log and the cache setting read different
  things, so their order doesn't change behavior, and it is fixed only so tests and readers can rely on it.
- **Evidence:** C-1, C-7, C-14.
- **Behavior impact:** Preserving in itself. The behavior changes are on the entries it composes.
- **Rejected alternatives:**
  - Wrap everything in `agent.ts` — that would put mode checks back in `agent.ts`, which the backend seam exists to
    prevent (C-1).
  - A `middleware()` method on `ClaudeBackend` — changes an interface with no new caller.
- **Revisit criterion:** A third place starts building models.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta (S-4, S-5)

### D-7: `agentSettings` returns only the model and the tools

- **Question:** What does `agentSettings` hand to `streamText`?
- **Decision:** `Promise<{ model: LanguageModel; tools: ToolSet }>`. The `instructions` field is removed.
- **Rationale:** `defaultInstructionsMiddleware` silently does nothing when the call already has a system message (C-8).
  Removing the field from the type stops a caller from passing both by accident.
- **Evidence:** C-2, C-8, C-14.
- **Behavior impact:** Preserving for callers (S-6).
- **Rejected alternatives:**
  - Keep returning `instructions` for tests — tests can read what the model received instead (C-13), and keeping the
    field invites the silent no-op.
- **Revisit criterion:** A caller needs the instructions text without making a model call.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-8
- **Referenced in plan:** Target State (contract d); Surface Delta (S-6)

### D-10: Measure a `claude` baseline before the boundary line takes effect

- **Question:** How does the plan tell whether the boundary line helps the `claude` path, given that `claude` already
  caches on its own?
- **Decision:**
  1. Unit 2 runs a fixed manual script in CLI mode after the log lands (Unit 1) and before the boundary rule exists
     (Unit 3): two tool-free turns, a skills edit, then a third tool-free turn.
  2. Unit 5 repeats the script after Unit 4, adds a fourth turn asking the model to quote the line before `<skills>`,
     and runs the same script on the API path.
  3. Keep the boundary when turn 3's `read` beats the baseline's turn 3 and no marker is quoted. Otherwise revert
     Unit 3.
- **Rationale:** A skills change is the only case the split helps. A stable three-turn chat would show the same numbers
  with or without it (junior-developer JD-001). Comparing against a run taken weeks later, or after the line landed,
  can't separate the effect (risk-analyst R2). A model rarely repeats system text unprompted, so the leak check asks
  directly (JD-007, R2). Tool-free turns keep each `claude` run to one internal step, so its counts are comparable
  (JD-005).
- **Evidence:** C-5, C-10, C-15; review findings JD-001, JD-005, JD-007, R2, R4.
- **Behavior impact:** Preserving. These are checks, not code.
- **Rejected alternatives:**
  - Measure only after the change (the first draft) — it has no baseline, and the stable chat doesn't test the split.
  - Inspect raw request bodies through `claude`'s telemetry — single-source documentation, and more setup than a log
    already in place.
- **Revisit criterion:** The log shows a cheaper way to observe the split, such as a natural skills edit in normal use.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Change Units (Units 2 and 5)

### D-11: `claude` 2.1.275 or later is required, and is not checked at startup

- **Question:** What happens with a `claude` program too old to know the boundary line?
- **Decision:** The plan states 2.1.275 as the minimum in contract (b). No startup check is added.
- **Rationale:** One operator runs 3pitor, with 2.1.286 installed (findings, Project Context). A version check is a
  guard for a case nobody has. If it happens, the line shows up as literal text, and Unit 5's leak check catches the
  same symptom.
- **Evidence:** research A12, V5; findings Project Context; junior-developer JD-004.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Run `claude --version` in `cliBackend.startupWarning` — it adds a subprocess at startup for a case nobody has.
    Deferred with a trigger.
- **Revisit criterion:** Someone runs 3pitor with an older `claude`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State (contract b); Surface Delta (S-2)

### D-12: Keep the split prompt and boundary line despite the YAGNI challenge

- **Question:** Two reviewers asked whether splitting the system prompt in two, and the `claude` boundary line that goes
  with it, pass the evidence test. Their benefit shows only on turns after the skills list changes, and nobody measured
  how often that happens.
- **Decision:** Keep S-1's two-message split and S-2's boundary line, gated by D-10's measurement and revert rule.
- **Rationale:** Three pieces of evidence support keeping it:
  - **User-described need.** The operator asked for a solution on both paths, and when asked chose the option that
    reads "Plan only the system prompt boundary line for the claude program" (scope boundary).
  - **Existing code path.** The skills list reloads every turn on purpose, so a skill added mid-chat shows up on the next
    turn (C-15, `agent.ts:41`), and the fixed-first order was built for this breakpoint (C-16).
  - **Low cost.** The cost is one extra system block and one join rule, both reversible.
- **Evidence:** C-15, C-16; scope boundary Operator-Stated Scope; research O1 and C1.
- **Behavior impact:** Changing, through S-1, S-2 and S-6. Settled under the operator's delegation.
- **Rejected alternatives:**
  - Plain string through `defaultInstructionsMiddleware`, with no split and no boundary line (junior-developer JD-003) —
    simpler, but it drops the boundary line the operator chose, and it leaves the `claude` path with only the log.
  - Defer the boundary line until a baseline shows poor caching (risk-analyst YAGNI 1) — D-10 now measures that
    baseline first, inside this change, which keeps the operator's choice and the evidence test.
- **Revisit criterion:** Unit 5 shows no gain on the turn after a skills edit, on both paths. Then revert Unit 3, and
  consider folding the two system messages back into one.
- **Dissent (if any):** junior-developer (JD-003) and risk-analyst (YAGNI candidates 1 and 3) favor the simpler version.
  Disagree and commit, with D-10 as the test that would prove them right.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** D-10
- **Referenced in plan:** Surface Delta (S-1, S-2); Open Items

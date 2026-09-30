# Change Decision Log: Claude API or CLI Adapter

<!--
This file records every decision committed while planning the Claude API or CLI Adapter change.
The plan itself lives in [../change-plan.md](../change-plan.md). Evidence about the code as it
stands today lives in [current-state-findings.md](current-state-findings.md) as numbered C-N findings.
-->

## Trivial decisions

- D-13: Flag values are case-insensitive — `--claude=API`, `--claude=api`, and `--claude=Api` all mean the same thing,
  because the operator wrote `API` and `CLI` in capitals and `auto` in lower case. — Referenced in plan: Target State,
  Surface Delta.
- D-16: Where the CLI model lives — a new component folder `src/server/chat/claude-cli/`, a sibling of `agent/`, per
  the README's one-folder-per-component rule. Only `agent.ts` imports it. — Referenced in plan: Target State, Surface
  Delta.

## Full decisions

### D-1: The adapter layer is one new AI SDK model, chosen inside `agentSettings`

- **Question:** What is the smallest structure that honors "a claude-specific adapter layer"?
- **Decision:** CLI mode is one new `LanguageModelV4` implementation, `claudeCliModel`. `agentSettings` branches on
  `options.claude` and returns either today's Anthropic model and tools, or the CLI model and its tools. There is no
  `ClaudeBackend` interface and no registry. `sessions.ts`, `taskTool`, and the UI do not change.
  **Superseded in part by D-21:** the operator reinstated the shared `ClaudeBackend` interface. The AI SDK's model type
  is still the seam the chat turn and Task use; the branch moved from `agentSettings` into `claudeBackend(mode)`.
- **Rationale:** The AI SDK's `LanguageModel` is already the seam: `Sessions.chat` spreads whatever `agentSettings`
  returns into `streamText` and names no provider, and Task reuses the same model through `generateText`. A second
  interface over it would have two implementations and one call site.
- **Evidence:** C-1, C-2, C-5; software-architect A3; YAGNI rule (single-implementation interfaces).
- **Behavior impact:** Preserving for API mode. The API branch is today's code, unchanged.
- **Rejected alternatives:**
  - A `ClaudeBackend` interface with `ApiBackend` and `CliBackend` — rejected because it would wrap an interface the AI
    SDK already provides, with one call site (`agentSettings`).
  - Driving `claude` outside `streamText` from `Sessions.chat` — rejected because it would duplicate the turn's error,
    abort, history, and `data-session` handling (C-3, C-8) and require a second Task implementation (C-5).
- **Revisit criterion:** A third model source lands, or a caller other than `agentSettings` needs to choose one.
- **Dissent (if any):** The operator overrode the rejection of a `ClaudeBackend` interface after the plan was written
  (D-21).
- **Settles delta entry:** S-9
- **Dependent decisions:** D-3, D-4, D-5, D-10, D-15, D-21
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta

### D-2: Drive the installed `claude` program directly, not through a package that wraps it

- **Question:** Which route reaches the operator's subscription through `claude`?
- **Decision:** Spawn `claude -p` with `Bun.spawn`, resolved from `PATH`. Add no package that ships its own `claude`
  binary.
- **Rationale:** The boundary forbids 3pitor from installing, downloading, or bundling a `claude` program.
  `@anthropic-ai/claude-agent-sdk` ships a native binary as an optional dependency, and `ai-sdk-provider-claude-code`
  pins that SDK and also ignores the AI SDK `tools` option. The raw CLI assumes only `claude` on `PATH`.
- **Evidence:** C-13, C-16; scope-boundary.md Stated Exclusions; research-analyst recommendation O3.
- **Behavior impact:** Preserving for API mode, which never spawns anything.
- **Rejected alternatives:**
  - `ai-sdk-provider-claude-code` 4.x — rejected because it bundles a `claude` binary through its pinned Agent SDK
    dependency (C-16), and it is an unofficial package whose tool behavior rests on one README.
  - `@anthropic-ai/claude-agent-sdk` directly — rejected because it bundles a binary (C-16) and needs the same
    adapter work as the raw CLI.
- **Revisit criterion:** A package appears that drives an existing `claude` without shipping one.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-3, D-6
- **Referenced in plan:** Target State; Surface Delta

### D-3: 3pitor's tools reach `claude` through a small MCP server 3pitor starts for each model call

- **Question:** How does `claude` call tools that must run inside 3pitor, against the turn's copy of the posts?
- **Decision:** For each CLI model call that has tools, the adapter calls `serveTools(...)`, which starts
  `Bun.serve({ hostname: '127.0.0.1', port: 0 })` serving JSON-RPC 2.0 at `/mcp/<crypto.randomUUID()>`, and stops it
  when the call ends. `claude` runs with `--tools "WebSearch,WebFetch"` (D-10) and
  `--strict-mcp-config --mcp-config <json>`, so the only file tools it has are 3pitor's. The server is hand-rolled and
  answers four methods. The pinned exchanges are in the plan's Target State.
- **Rationale:** `claude` runs its own tool loop and never hands a tool call back (C-13). The tools must run in-process
  against `TurnTexts` (C-4). A per-call server owns its whole lifetime, needs no route on the app's own server, and lets
  a nested Task call run its own server on its own port. Four methods are about 80 lines. `@modelcontextprotocol/sdk`
  would add 17 runtime dependencies, including express, to the single compiled binary.
- **Evidence:** C-4, C-13; software-architect A4 (dependency count read from the on-disk package, which is not a
  declared dependency).
- **Behavior impact:** Preserving. It exists only in CLI mode, which is new.
- **Rejected alternatives:**
  - A route on the app's Hono server — rejected because the server's URL is known only after `Bun.serve` runs, which is
    after `createAgentHost`. It would also need a registry of live calls on an app that has no authentication.
  - `@modelcontextprotocol/sdk` — rejected because of the dependency weight for four methods. It is also not declared in
    `package.json`, and the copy on disk is a leftover (current-state-findings Gaps).
  - A stdio MCP server — rejected because `claude` would start it as a separate process, which cannot see the turn's
    in-memory copy.
- **Revisit criterion:** `claude` needs server features beyond `initialize`, `tools/list`, `tools/call`, and `ping`
  (for example SSE, sessions, or resources).
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** D-4
- **Referenced in plan:** Target State; Surface Delta; Risks

### D-4: Tool rows in CLI mode come from the MCP handler, not from parsing `claude`'s output

- **Question:** How does the chat panel still show a row for each tool call in CLI mode?
- **Decision:** The MCP handler emits a `tool-call` part and then a `tool-result` part into the model's stream, both
  with `providerExecuted: true`, around each `execute`. The AI SDK then records them in `responseMessages` and does not
  run the tool a second time. `stream-json.ts` ignores `claude`'s own `tool_use` events.
- **Rationale:** The AI SDK skips executing a tool call marked `providerExecuted` (C-11). The handler knows the exact
  name, input, and result, which removes the least-verified part of the stream-json contract. The UI shows `Read`, not
  `mcp__3pitor__Read`.
- **Evidence:** C-11; software-architect A4.
- **Behavior impact:** Preserving. The UI renders any tool part by name (behavioral-analyst B7).
- **Rejected alternatives:**
  - Translating `claude`'s `tool_use`/`tool_result` stream-json events — rejected because those shapes are unverified
    (C-13), and the names would carry the `mcp__3pitor__` prefix.
- **Revisit criterion:** Text and tool rows show up out of order in practice (Risk R4).
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Risks

### D-5: The CLI model replays history as a text transcript on each call

- **Question:** How does `claude` see the earlier turns of a chat?
- **Decision:** On each call, `claudeCliModel` joins the prompt's system messages into `--system-prompt`, and writes the
  other messages to `claude`'s stdin. When there is one message, stdin is its text. Otherwise it is the `<history>`
  transcript pinned in the plan's Target State. `claude` runs with `--no-session-persistence`.
- **Rationale:** 3pitor owns the history and stores it in `session.json` (C-3), and `claude` cannot take a foreign
  history (C-15). A transcript works whichever mode wrote the history. Going the other way is also safe: the API path
  drops tool calls it did not run, with a warning, and keeps the text (C-12). So a session can switch modes between
  runs.
- **Evidence:** C-3, C-12, C-15.
- **Behavior impact:** Preserving. API mode sends history exactly as today.
- **Rejected alternatives:**
  - Storing `claude`'s session id and using `--resume` — rejected because it gives the session two histories, and one
    that API mode cannot read.
  - `--input-format stream-json` with prior messages — rejected because its schema for replayed assistant and tool
    messages is unconfirmed (C-15).
- **Revisit criterion:** Transcript size makes CLI turns noticeably slow (Risk R3).
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Risks

### D-6: The `claude` child runs without API credentials, from a neutral folder

- **Question:** How does CLI mode make sure `claude` uses the subscription, and not a key or a project's settings?
- **Decision:** The child env is `process.env` without `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`. The child's
  working directory is `os.tmpdir()`. `--bare` is never passed.
- **Rationale:** In `-p` mode `claude` uses an API key over the subscription whenever one is present, and
  `ANTHROPIC_AUTH_TOKEN` outranks the key (C-14). Without stripping them, `--claude=CLI` with a key set would bill the
  key, which is not what forcing CLI means. `--bare` never reads the subscription login. A neutral working directory
  keeps a workspace's `CLAUDE.md` and `.mcp.json` from loading.
- **Evidence:** C-14 (single Anthropic source, primary); junior-developer reframing item 4.
- **Behavior impact:** Preserving. CLI mode is new.
- **Rejected alternatives:**
  - Pass the environment through unchanged — rejected because forced CLI mode with a key set would bill the key.
- **Revisit criterion:** The spike (Unit 0) shows `claude` still reads a credential from somewhere else.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-7: Parse the command line with Bun's built-in `parseArgs`

- **Question:** Does "a proper CLI args parsing framework" mean a third-party library?
- **Decision:** Use `node:util` `parseArgs` in `strict` mode, in a new `src/server/command-line.ts`. 3pitor writes its
  own one-line `USAGE`.
- **Rationale:** The operator chose it. It is a real parser that rejects unknown options and accepts `--claude=X` and
  `--claude X`, and it adds no dependency.
- **Evidence:** User input, verbatim: "use the built-in parser". C-9.
- **Behavior impact:** See D-8 for the part that changes behavior.
- **Rejected alternatives:**
  - `commander` — rejected by the operator. Its generated `--help` and choice lists have no caller yet.
  - Keep reading `process.argv[2]` by hand — rejected because `--claude=CLI` would be taken as a folder (C-9).
- **Revisit criterion:** A second option, a subcommand, or a request for generated `--help`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** D-8
- **Referenced in plan:** Target State; Surface Delta

### D-8: A bad flag or value stops startup

- **Question:** What does 3pitor do with an unknown flag, or a `--claude` value that isn't `api`, `cli`, or `auto`?
- **Decision:** `parseCommandLine` throws. `server.ts` prints the message and `USAGE` to stderr, then exits with code 2.
  A plain folder or file argument behaves as it does today.
- **Rationale:** With a key set, a lenient parser would drop a mistyped `--claude=cli` and silently run on the paid key.
  A forced mode that silently isn't forced defeats the point of forcing it.
- **Evidence:** User input, verbatim: "recommended", in answer to the escalation below. Junior-developer reframing Q2.
  `scripts/check.ts` starts the server with no arguments (C-9).
- **Behavior impact:** Changing. Today `3pitor --claud=cli notes` warns that the folder `--claud=cli` does not exist and
  opens the launch folder. After the change it exits with code 2 and prints:
  ```
  3pitor: Unknown option '--claud' …
  Usage: 3pitor [--claude=auto|api|cli] [folder-or-file]
  ```
  Escalated as "a mistyped flag will now stop 3pitor from starting"; the operator answered "recommended".
- **Rejected alternatives:**
  - Warn and continue in `auto` — rejected by the operator, and because it can bill the wrong account.
- **Revisit criterion:** A caller needs to pass flags 3pitor does not know about.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-10
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Behavior Changes

### D-9: `auto` resolves once at startup, from whether `ANTHROPIC_API_KEY` is non-empty

- **Question:** When and how is `auto` resolved?
- **Decision:** `parseCommandLine(argv, env)` resolves `auto` to `'api'` when `env.ANTHROPIC_API_KEY` is truthy, and to
  `'cli'` otherwise. An empty string counts as unset. The resolved `ClaudeMode` is fixed for the life of the server,
  and `'auto'` never leaves `command-line.ts`.
- **Rationale:** The operator stated the rule: "if that env var does not exist, or is empty, assume you can run
  `claude`". The truthiness test is the one `server.ts` already uses (C-7). Resolving once gives the startup line (D-11)
  one answer to print.
- **Evidence:** scope-boundary.md Stated Scope; C-7.
- **Behavior impact:** Changing. Today, starting 3pitor with no key prints the missing-key help, and every chat turn
  fails with it. After the change the same start uses the `claude` program, and chat works when `claude` is installed
  and signed in. The boundary settles this: it is the behavior the operator asked for, in their words above.
- **Rejected alternatives:**
  - Resolve per turn — rejected because nothing asks for switching modes mid-run, and the startup line would go stale.
- **Revisit criterion:** The operator wants to switch modes without restarting.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-11
- **Dependent decisions:** D-11
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-10: CLI mode keeps `claude`'s own web search and web fetch, for the main chat only

- **Question:** Can chat search the web in CLI mode, where the Anthropic-run `web_search` and `web_fetch` do not exist?
- **Decision:** The main chat's CLI model runs with `--tools "WebSearch,WebFetch"`. Task subagents get a separate CLI
  model built with `webTools: false`, which runs with `--tools ""`, matching today's rule that subagents get no web
  tools. These web calls show no tool row in the chat.
- **Rationale:** The operator chose it. `claude`'s web tools never touch files, so the rule that only the user's Save
  writes a file still holds (C-4). Today subagents only get Read and/or Glob (C-5, C-6).
- **Evidence:** User input, verbatim: "recommended". C-4, C-6.
- **Behavior impact:** Preserving for API mode. In CLI mode, which is new, web calls produce no tool row.
- **Rejected alternatives:**
  - No web access in CLI mode — rejected by the operator. It stays the fallback if the spike shows the built-in web
    tools misbehave in `-p` mode.
- **Revisit criterion:** The spike (Unit 0) shows the built-in web tools need approval flags that also re-enable file
  tools, or otherwise misbehave.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9, S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Open Items

### D-11: Startup prints which mode chat will use, in place of the unconditional missing-key warning

- **Question:** What does 3pitor print at startup once `auto` can choose either mode?
- **Decision:** `server.ts` prints `3pitor chat: claude via the Anthropic API` or `3pitor chat: claude via the claude
  program` before the `listening on` line. It then warns in two cases: `MISSING_API_KEY_HELP` for API mode with no key,
  and `CLAUDE_NOT_FOUND_HELP` for CLI mode when `Bun.which('claude')` is `null`. The warnings do not stop startup. The
  `3pitor listening on <url> (workspace: <path>)` line is unchanged.
- **Rationale:** The operator chose it. It is the only way to see whether `auto` picked the key or the subscription. The
  old warning would be wrong in CLI mode.
- **Evidence:** User input, verbatim: "recommended". C-7, C-17; junior-developer reframing Q4.
- **Behavior impact:** Changing. Today a start with no key prints the missing-key help. After the change it prints
  `3pitor chat: claude via the claude program`, plus the not-found help only if `claude` is missing. Every start gains
  the mode line. Escalated as "what 3pitor prints at startup"; the operator answered "recommended".
- **Rejected alternatives:**
  - Only fix the warning, and print nothing new — rejected by the operator.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Behavior Changes

### D-12: CLI failures surface as four fixed messages, through the existing `modelErrorMessage`

- **Question:** What does the writer see when `claude` is missing, cannot reach 3pitor's tools, or fails?
- **Decision:** The CLI model reports each failure as an `Error` with a fixed message. It throws before any output, or
  emits an `error` stream part after output starts. `modelErrorMessage` is unchanged and shows `error.message`. The four
  messages are pinned in the plan's Target State.
- **Rationale:** The boundary requires "a clear message" when `claude` is not installed. `modelErrorMessage` already
  shows any `Error`'s message (C-7). Reporting through the stream keeps the one-error rule in `sessions.ts` (C-8).
- **Evidence:** scope-boundary.md Stated Exclusions; C-7, C-8; software-architect A4. `Bun.spawn` of a missing program
  throws code `ENOENT` (verified by the architect).
- **Behavior impact:** Preserving for API mode.
- **Rejected alternatives:**
  - A dedicated "not signed in" hint — deferred (YAGNI) because `claude`'s logged-out output is unverified.
- **Revisit criterion:** The spike captures a stable logged-out marker.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Deferred (YAGNI)

### D-14: Step limits are soft in CLI mode

- **Question:** What happens to the 20-step chat limit and the 10-step subagent limit in CLI mode?
- **Decision:** They stay in the code and apply to API mode exactly as today. In CLI mode, one `claude` run is one AI SDK
  step, so the limits do not cap `claude`'s own tool loop. No cap is added.
- **Rationale:** The AI SDK only loops again when there are tool calls it must run itself (software-architect, verified
  in `ai/dist/index.js`). The operator's standing preference is to accept soft limits being generally honored.
- **Evidence:** software-architect A4, Risk R2; operator memory "Good enough for fuzzy LLM limits".
- **Behavior impact:** Preserving for API mode.
- **Rejected alternatives:**
  - Count calls in the MCP handler and refuse after N — deferred (YAGNI): no runaway turn has been seen.
- **Revisit criterion:** An observed runaway CLI turn.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Risks; Deferred (YAGNI)

### D-15: API-mode tests stay on the module mock; the CLI model is tested through a fake `claude` on `PATH`

- **Question:** How is each mode tested without an API key or a real `claude`?
- **Decision:** Existing tests keep `useModel` and add `claude: 'api'` to the options they build. The CLI model's tests
  put a `claude` shim on `PATH`: `src/server/chat/claude-cli/fake-claude.ts`, a `#!/usr/bin/env bun` script. It reads
  stdin, calls `tools/call` on the URL in `--mcp-config`, prints canned stream-json lines, and reports whether
  `ANTHROPIC_API_KEY` reached it. `stream-json.ts` gets pure unit tests, and `mcp-endpoint.ts` is tested with `fetch`.
- **Rationale:** It keeps the Makefile's promise that unit tests need no API key (C-10), with no injection parameter
  added only for tests.
- **Evidence:** C-10; Makefile `test` comment; software-architect Test seam.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - A `spawn` parameter on `claudeCliModel` for tests — rejected because it is a configuration seam only tests would
    use.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-8, S-5
- **Dependent decisions:** —
- **Referenced in plan:** Change Units

### D-17: `stream-json.ts` owns line framing, and skips a line it cannot parse

- **Question:** Who splits `claude`'s stdout into lines, and what happens to a line that is not valid JSON?
- **Decision:** `stream-json.ts` exports `lines()`, a `TransformStream<string, string>` that keeps the unfinished tail
  and flushes a last line with no newline. The pipeline is
  `proc.stdout.pipeThrough(new TextDecoderStream()).pipeThrough(lines()).pipeThrough(streamJsonParts())`. A line that
  fails `JSON.parse` is skipped with one `console.warn`.
- **Rationale:** `claude`'s ignored `user` and `assistant` events carry whole post texts, so lines often span pipe
  reads. A per-chunk split would cut them, and would corrupt multibyte characters split across chunks. A parse throw
  inside the transform would fail the whole turn over one line it ignores anyway.
- **Evidence:** on-call-engineer OCE-002; C-4 (posts are the tools' payload).
- **Behavior impact:** Preserving. CLI mode is new.
- **Rejected alternatives:**
  - `chunk.toString().split('\n')` — rejected because it breaks long lines and multibyte characters.
  - Throw on an unparseable line — rejected because it fails a turn over a line the mapping ignores.
- **Revisit criterion:** A recorded run shows `claude` writing non-JSON lines that carry meaning.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Review Findings

### D-18: One pinned lifecycle for each CLI model call

- **Question:** In what order does a CLI call start and stop its parts, and what runs on each way it ends?
- **Decision:** The seven-step lifecycle in the plan's Target State. One idempotent `cleanup()` runs from abort, exit,
  the stream's `cancel()`, and a spawn failure. It kills the child, stops the MCP endpoint, closes the stream, and sets
  `closed`, after which `emit` is a no-op. The exit-code error is skipped when the signal is aborted. Stdin is passed as
  `new Blob([text])`. Stderr is drained at the same time as stdout into a tail of about 4 KB.
- **Rationale:** The prose "the same cleanup runs on every other way the call ends" left five paths unowned. The
  unowned paths: a signal already aborted, a spawn failure after the server was bound, a tool finishing after the stream
  closed, an exit error after abort, and `cancel()`. An undrained stderr can block `claude`, and a stdin write to a
  child that exited early can raise an unhandled EPIPE.
- **Evidence:** on-call-engineer OCE-004, OCE-005; C-8.
- **Behavior impact:** Preserving. It keeps C-8's abort contract in CLI mode.
- **Rejected alternatives:**
  - An abort listener alone — rejected because it never fires for a signal that was already aborted, and does not
    cover exit, `cancel()`, or a spawn failure.
- **Revisit criterion:** A stray `claude` or a leaked listener is seen after a turn ends.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Review Findings

### D-19: A `claude` failure before any output fails the turn before it starts

- **Question:** Does a signed-out, usage-limited, or failing `claude` run leave a failed turn in the chat history?
- **Decision:** `doStream` holds its stream until the first `text-start` or `tool-call` part, or a failure. A failure
  that arrives first is thrown from `doStream`. An `init` event reporting the `3pitor` MCP server as not `connected` is
  such a failure, and it also kills the child.
- **Rationale:** Without this, every failure `claude` reports arrives after the stream has started. The AI SDK records
  a step for an error part, so `responseMessages` resolves, and `sessions.ts` would save the failed turn into
  `session.messages`. In API mode the matching failures throw before the stream and are not saved.
- **Evidence:** on-call-engineer OCE-003 (read from `ai/dist/index.js` lines 10540, 11488-11508); C-3, C-8.
- **Behavior impact:** Preserving. It keeps C-8's rule that a failed turn never enters history, in CLI mode.
- **Rejected alternatives:**
  - Emit every failure as an error part — rejected because failed turns would be saved and replayed in every later
    transcript.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Review Findings

### D-20: The MCP endpoint never times out a tool call

- **Question:** How long may a `tools/call` request to the per-call MCP server stay open?
- **Decision:** `serveTools` starts `Bun.serve` with `idleTimeout: 0`. Unit 0 records `claude`'s own tool-call timeout.
  If that timeout is shorter than a long subagent run, the child's environment raises it.
- **Rationale:** Bun closes idle connections after 10 seconds by default. A Task call holds its request open for the
  whole subagent run, so every Task longer than that would fail on the `claude` side while it kept running in 3pitor.
  `server.ts` already raises the limit for agent turns.
- **Evidence:** on-call-engineer OCE-001; `src/server/server.ts` lines 42-43. Unverified: Bun's idle timer on a pending
  handler, and `claude`'s own timeout, were not run.
- **Behavior impact:** Preserving. CLI mode is new.
- **Rejected alternatives:**
  - Keep Bun's default — rejected because every Task over 10 seconds would fail.
- **Revisit criterion:** Unit 0 shows `claude` drops long tool calls regardless.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta; Review Findings

### D-21: A shared `ClaudeBackend` interface over both modes

- **Question:** Should both modes sit behind one interface, rather than a branch inside `agentSettings`?
- **Decision:** Yes. `src/server/chat/claude-backend/claude-backend.ts` exports this interface, its two
  implementations, and the factory. The member-by-member behavior of both implementations is the table in the plan's
  Target State. `MISSING_API_KEY_HELP` moves into the same module with its text unchanged. `agentSettings` and
  `server.ts` use the backend and never check the mode themselves.
  ```ts
  export interface ClaudeBackend {
    readonly mode: ClaudeMode;
    readonly label: string;
    startupWarning(env: Record<string, string | undefined>): string | undefined;
    chatModel(modelId: string, tools: ToolSet): LanguageModel;
    subagentModel(modelId: string, tools: ToolSet): LanguageModel;
    providerTools(): ToolSet;
  }
  export const apiBackend: ClaudeBackend;
  export const cliBackend: ClaudeBackend;
  export function claudeBackend(mode: ClaudeMode): ClaudeBackend;
  ```
- **Rationale:** The operator asked for it, reinstating it from the plan's YAGNI deferrals, and their direction is the
  justification. The interface also gathers what differed between modes into one module. Before, that was spread
  across the `agentSettings` branch and the `server.ts` label and warning logic.
- **Evidence:** User input, verbatim: "add these two things to the plan: A shared interface over both modes, A
  type-check step in make test". Circular-import check: `server.ts`, `sessions.ts`, and `sessions.test.ts` are today's
  only importers of `MISSING_API_KEY_HELP` or `modelErrorMessage`, read with grep.
- **Behavior impact:** Preserving. `apiBackend` returns today's model, web tools, and warning. Task gets its own
  stateless `anthropic(id)` instance, and the test mock returns the same scripted model for every call.
- **Rejected alternatives:**
  - The branch inside `agentSettings` (D-1's original shape) — rejected by the operator.
  - Keep `MISSING_API_KEY_HELP` in `agent.ts` — rejected because `claude-backend.ts` would import `agent.ts` while
    `agent.ts` imports `claude-backend.ts`.
- **Revisit criterion:** —
- **Dissent (if any):** software-architect and the YAGNI sweep had deferred it (two implementations, one call site).
  The operator's direction overrides, per the YAGNI rule's "the user always wins".
- **Settles delta entry:** S-6, S-7, S-9
- **Dependent decisions:** —
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Review Findings

### D-22: `make test` type-checks the code first

- **Question:** Should `make test` fail on a type error?
- **Decision:** Add a `typecheck` target running `./node_modules/.bin/tsc --noEmit -p .`, and make `test` depend on
  it before `test-server` and `test-ui`. It uses the `typescript` 7.0.2 already in `devDependencies` and the existing
  `tsconfig.json`. Any type errors present when the unit is built are fixed in the same unit.
  ```make
  test: typecheck test-server test-ui

  typecheck: node_modules
  	./node_modules/.bin/tsc --noEmit -p .
  ```
- **Rationale:** The operator asked for it: "add the check regardless, and fix the issues if there are any". `bun test`
  does not check types, so S-8's new required field was unenforced (R8).
- **Evidence:** User input, verbatim, above. On 2026-09-30, `tsc --noEmit -p .` exited 0 over the current code in about
  0.3 seconds (run in this session). test-engineer finding on S-4 (now S-8).
- **Behavior impact:** Changing. A type error used to pass `make test` whenever the tests passed; now it fails it.
  Observer: a developer running `make test`. The operator asked for exactly this, so it was not escalated again.
- **Rejected alternatives:**
  - Add the check only if the code type-checks today — rejected by the operator ("add the check regardless").
  - A separate target not wired into `test` — rejected because the point is that `make test` catches type errors.
- **Revisit criterion:** The type-check becomes slow enough to matter for the test loop.
- **Dissent (if any):** None. It had been deferred by the YAGNI sweep before the operator reinstated it.
- **Settles delta entry:** S-12
- **Dependent decisions:** —
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Behavior Changes; Change Units;
  Review Findings

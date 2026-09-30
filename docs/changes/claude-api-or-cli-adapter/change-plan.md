# Change Plan: Claude API or CLI Adapter

## Why This Change

3pitor's chat gains a second way to reach Claude: through the operator's Claude subscription, using the `claude`
program already installed on their machine. Today chat works only with an `ANTHROPIC_API_KEY`, and every turn fails
without one. This is a new requirement, a constraint arriving, in the operator's own words
([scope-boundary.md](artifacts/scope-boundary.md)):

> by default, check for ANTHROPIC_API_KEY env var. if it exists, use it with the AI-SDK claude API calls. if that env
> var does not exist, or is empty, assume you can run `claude` CLI without having to install it. to force a specific
> claude execution type, add a CLI option ... `--claude=API` or `--claude=CLI` or `--claude=auto`.

This narrows an earlier decision rather than reversing it. The change that removed Claude Code
(`docs/changes/replace-claude-code-with-anthropic-api/`) said 3pitor must not rely on a `claude` program. API mode keeps
that promise. Only CLI mode assumes `claude` is installed, and 3pitor never installs, downloads, or bundles it.

## What Changes, In One Paragraph

After this change, 3pitor decides once, at startup, how chat reaches Claude. It uses the Anthropic API when a key is set
or `--claude=api` is passed, and the `claude` program otherwise or when `--claude=cli` is passed. It prints which one it
chose. One shared interface, `ClaudeBackend`, has one implementation per mode, and everything that differs between the
modes lives behind it: the models, the web tools, the startup label, and the startup warning. API mode's implementation
is today's code, moved behind that interface. CLI mode's implementation is one new AI SDK model. The chat turn,
subagents, history, and UI use it exactly the way they use the Anthropic model today. The model runs `claude` with all
of its file tools turned off, and gives it 3pitor's own tools through a small local server that lives for one model
call. So edits still land on the editor's unsaved copy, and only the writer's Save writes a file. `make test` also
type-checks the code before it runs the tests.

## Current State

One function, `agentSettings`, builds the chat's model, tools, and instructions. It is the only place an Anthropic model
is created
([C-1](artifacts/current-state-findings.md#c-1-one-function-builds-the-model-the-tools-and-the-instructions)). The chat
turn is a single `streamText` call over whatever `agentSettings` returns, and names no provider
([C-2](artifacts/current-state-findings.md#c-2-the-chat-turn-is-one-streamtext-call-over-whatever-agentsettings-returns)).
Task subagents reuse the same model through a nested `generateText`
([C-5](artifacts/current-state-findings.md#c-5-task-subagents-reuse-the-parents-model-through-a-nested-generatetext)).
That makes the AI SDK's model type the natural place to plug in a second way of reaching Claude.

The structural property this change works around: 3pitor's file tools must run inside 3pitor. They read and change a
per-turn copy of the posts that starts from the editor's unsaved text, and they never write a file
([C-4](artifacts/current-state-findings.md#c-4-the-file-tools-must-run-inside-3pitor-against-the-turns-copy-of-the-posts)).
The `claude` program runs its own tool loop and never hands a tool call back to its caller
([C-13](artifacts/current-state-findings.md#c-13-the-claude-program-runs-its-own-tool-loop-and-can-call-tools-3pitor-hosts-over-mcp)).
So CLI mode has to lend 3pitor's tools to `claude`, not the other way round.

Three more facts shape the target:

- 3pitor owns the chat history, stored as AI SDK messages in `session.json`
  ([C-3](artifacts/current-state-findings.md#c-3-3pitor-owns-the-conversation-history-and-stores-it-as-ai-sdk-messages)),
  and `claude` cannot take another program's history
  ([C-15](artifacts/current-state-findings.md#c-15-claude-has-no-way-to-take-an-arbitrary-prior-conversation)).
- Startup reads the folder argument straight from `process.argv[2]`, so `--claude=CLI` would be taken as a folder today
  ([C-9](artifacts/current-state-findings.md#c-9-startup-reads-a-positional-argument-straight-from-processargv-with-no-parser)).
- The missing-key warning and error message assume API mode
  ([C-7](artifacts/current-state-findings.md#c-7-the-missing-key-message-is-api-specific-and-the-startup-check-is-a-separate-copy-of-it)).

## Target State

### How the mode is chosen

A new module, `src/server/command-line.ts`, turns the command line and environment into a decision. It uses Bun's
built-in `node:util` `parseArgs` in strict mode
([D-7](artifacts/change-decision-log.md#d-7-parse-the-command-line-with-buns-built-in-parseargs)). It resolves `auto`
once, and `'auto'` never leaves the module
([D-9](artifacts/change-decision-log.md#d-9-auto-resolves-once-at-startup-from-whether-anthropic_api_key-is-non-empty)).
It does not print, exit, look for `claude`, or know about models.

```ts
export type ClaudeMode = 'api' | 'cli';
export const USAGE = 'Usage: 3pitor [--claude=auto|api|cli] [folder-or-file]';
export function parseCommandLine(
  argv: string[],                              // process.argv.slice(2)
  env: Record<string, string | undefined>,     // process.env
): { target: string | undefined; claude: ClaudeMode };
// parseArgs({ args: argv, options: { claude: { type: 'string', default: 'auto' } }, allowPositionals: true, strict: true })
// value is lower-cased; 'auto' -> env.ANTHROPIC_API_KEY ? 'api' : 'cli'
// target = positionals[0]; extra positionals are ignored, as today
// throws Error on bad input:
//   unknown option -> parseArgs's own message, e.g. "Unknown option '--claud'"
//   bad value      -> '--claude must be api, cli, or auto (got "bogus")'
```

Worked examples:

| argv | `ANTHROPIC_API_KEY` | Result |
| --- | --- | --- |
| `[]` | `sk-ant-…` | `{ target: undefined, claude: 'api' }` |
| `[]` | unset or `''` | `{ target: undefined, claude: 'cli' }` |
| `['--claude=CLI', 'posts']` | `sk-ant-…` | `{ target: 'posts', claude: 'cli' }` |
| `['--claude', 'api']` | unset | `{ target: undefined, claude: 'api' }` |
| `['--claude=bogus']` | any | throws |

Values are case-insensitive ([D-13](artifacts/change-decision-log.md#trivial-decisions)).

### What startup does with it

`server.ts` calls `parseCommandLine(process.argv.slice(2), process.env)`. On a throw, it writes `3pitor: <message>` and
`USAGE` to stderr and exits with code 2
([D-8](artifacts/change-decision-log.md#d-8-a-bad-flag-or-value-stops-startup)). Otherwise it passes `target` to
`chooseWorkspace` and `claude` to `createAgentHost`.

It gets the mode's backend with `claudeBackend(claude)`. Before the `listening on` line, it prints one mode line from
`backend.label`, then the backend's `startupWarning(process.env)` if there is one
([D-11](artifacts/change-decision-log.md#d-11-startup-prints-which-mode-chat-will-use-in-place-of-the-unconditional-missing-key-warning)):

```
3pitor chat: claude via the Anthropic API        # claude === 'api'
3pitor chat: claude via the claude program       # claude === 'cli'
```

| Mode | Condition | Warning (startup continues) |
| --- | --- | --- |
| `api` | `ANTHROPIC_API_KEY` empty or unset | `MISSING_API_KEY_HELP`, as today |
| `cli` | `Bun.which('claude') === null` | `CLAUDE_NOT_FOUND_HELP` |

The `3pitor listening on <url> (workspace: <path>)` line is unchanged, because `make check-build` and `scripts/check.ts`
parse it.

### How the mode reaches the model

`AgentOptions` (in `agent.ts`) and `AgentHostOptions` (in `agent-host.ts`) each gain a required `claude: ClaudeMode`.
`SessionsOptions` extends `AgentOptions`, so `Sessions` passes it to `agentSettings` with no change to `sessions.ts`
([C-2](artifacts/current-state-findings.md#c-2-the-chat-turn-is-one-streamtext-call-over-whatever-agentsettings-returns)).
It is required because a default would be a setting only tests rely on.

`agentSettings` gets the mode's backend and asks it for everything that differs between modes
([D-21](artifacts/change-decision-log.md#d-21-a-shared-claudebackend-interface-over-both-modes)). It has no branch of
its own. Subagents get the backend's subagent model, which in CLI mode has no web tools, to match today's rule that
subagents only get Read and/or Glob
([D-10](artifacts/change-decision-log.md#d-10-cli-mode-keeps-claudes-own-web-search-and-web-fetch-for-the-main-chat-only)).

```ts
const backend = claudeBackend(options.claude);
const id = resolveModelId(options.model);
const files = fileTools(options.workspace, turn);
const tools: ToolSet = {
  ...files,
  Task: taskTool(config.agents, backend.subagentModel(id, files), files, ownerId, report),
  ...backend.providerTools(),
};
return { model: backend.chatModel(id, tools), instructions, tools };
```

In API mode this returns the same tools, in the same key order, as today: the file tools, Task, `web_search`,
`web_fetch`. Task gets its own `anthropic(id)` instance instead of sharing the chat's. Both instances are stateless, and
the test mock returns the same scripted model for every `anthropic(...)` call, so nothing observable changes.

### The shared interface: `src/server/chat/claude-backend/`

A new component folder, a sibling of `agent/` and `claude-cli/`. Its one module, `claude-backend.ts`, defines what every
way of reaching Claude provides, and the two implementations
([D-21](artifacts/change-decision-log.md#d-21-a-shared-claudebackend-interface-over-both-modes)). It is the one place
that knows which modes exist. `agent.ts` and `server.ts` import it, and never check the mode themselves.

```ts
export interface ClaudeBackend {
  readonly mode: ClaudeMode;
  readonly label: string;                                                   // "3pitor chat: claude via <label>"
  startupWarning(env: Record<string, string | undefined>): string | undefined;
  chatModel(modelId: string, tools: ToolSet): LanguageModel;
  subagentModel(modelId: string, tools: ToolSet): LanguageModel;
  providerTools(): ToolSet;                                                 // tools the provider runs itself
}
export const MISSING_API_KEY_HELP: string;                                  // moved from agent.ts, text unchanged
export const apiBackend: ClaudeBackend;
export const cliBackend: ClaudeBackend;
export function claudeBackend(mode: ClaudeMode): ClaudeBackend;             // 'api' -> apiBackend, 'cli' -> cliBackend
```

| Member | `apiBackend` | `cliBackend` |
| --- | --- | --- |
| `mode` | `'api'` | `'cli'` |
| `label` | `'the Anthropic API'` | `'the claude program'` |
| `startupWarning(env)` | `MISSING_API_KEY_HELP` when `env.ANTHROPIC_API_KEY` is empty or unset, else `undefined` | `CLAUDE_NOT_FOUND_HELP` when `Bun.which('claude')` is `null`, else `undefined` |
| `chatModel(id, tools)` | `anthropic(id)` | `claudeCliModel(id, tools, { webTools: true })` |
| `subagentModel(id, tools)` | `anthropic(id)` | `claudeCliModel(id, tools, { webTools: false })` |
| `providerTools()` | `{ web_search: anthropic.tools.webSearch_20250305({ maxUses: 10 }), web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 10 }) }` | `{}`; `claude`'s own web tools run inside its call |

`MISSING_API_KEY_HELP` moves here, so the API backend owns its own warning, and so `claude-backend.ts` never imports
`agent.ts`, which imports it. `agent.ts` imports the constant back for `modelErrorMessage`, which is otherwise
unchanged.

### The CLI model: `src/server/chat/claude-cli/`

A new component folder, a sibling of `agent/`
([D-16](artifacts/change-decision-log.md#trivial-decisions)). It holds three modules and a test fixture. Together they
are CLI mode's half of the adapter layer. `cliBackend` is the only code that uses them
([D-21](artifacts/change-decision-log.md#d-21-a-shared-claudebackend-interface-over-both-modes)).

**`claude-cli.ts`** runs `claude` for one model call and reports what happens as AI SDK stream parts. It owns starting
and stopping the child process, its arguments and environment, what goes to stdin, abort, and error messages. It does
not decide which tools exist, the step limits, persistence, or anything the UI shows.

```ts
export function claudeCliModel(
  modelId: string,
  tools: ToolSet,                   // looked up by name on each call; the call's own tool list picks which ones
  options: { webTools: boolean },
): LanguageModelV4;
// specificationVersion: 'v4', provider: 'claude-cli', modelId, supportedUrls: {}
// doStream: spawns claude, pipes stdout lines through streamJsonParts(), merges in the MCP endpoint's tool parts
// doGenerate: runs doStream and folds the parts into { content, finishReason, usage, warnings: [] }
export const CLAUDE_NOT_FOUND_HELP: string;
```

It drives the installed `claude` directly, with no package that ships its own copy
([D-2](artifacts/change-decision-log.md#d-2-drive-the-installed-claude-program-directly-not-through-a-package-that-wraps-it)).
The command it runs:

```
claude -p --output-format stream-json --verbose --include-partial-messages --input-format text
  --model <modelId> --system-prompt <system> --no-session-persistence
  --tools "WebSearch,WebFetch"                      # "" when webTools is false
  [--strict-mcp-config --mcp-config <json>]         # only when the call has tools
  --allowedTools <list>                             # mcp__3pitor__<name> for each tool in the call,
                                                    # plus WebSearch,WebFetch when webTools is true
```

- **Working directory:** `os.tmpdir()`, so a workspace's `CLAUDE.md` and `.mcp.json` never load.
- **Environment:** `process.env` without `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, so `claude` uses the
  subscription even when a key is set. `--bare` is never passed, because it ignores the subscription login
  ([D-6](artifacts/change-decision-log.md#d-6-the-claude-child-runs-without-api-credentials-from-a-neutral-folder)).
- **Prompt:** the prompt's system messages, joined with a blank line, become `--system-prompt`. The rest goes to stdin,
  passed as `new Blob([text])` so Bun owns the write and an early exit cannot raise an unhandled EPIPE.

Each call follows one lifecycle, and one idempotent `cleanup()` ends it however it ends
([D-18](artifacts/change-decision-log.md#d-18-one-pinned-lifecycle-for-each-cli-model-call)):

1. If `abortSignal.aborted` is already true, throw the abort reason. Nothing starts.
2. When the call has tools, call `serveTools(...)`. Its URL goes into `--mcp-config`, so it starts before the spawn.
3. Spawn `claude`. If the spawn throws, call `cleanup()` and throw the mapped error.
4. Attach the abort listener, which calls `cleanup()`.
5. Read stdout through the line pipeline in `stream-json.ts`, and drain stderr at the same time into a tail of about
   4 KB, so a chatty `claude` never blocks on a full pipe.
6. Hold the stream back until the first `text-start` or `tool-call` part, or a failure. A failure that arrives first is
   thrown from `doStream`, so the turn fails before it starts, exactly as an API-mode 401 or 429 does
   ([D-19](artifacts/change-decision-log.md#d-19-a-claude-failure-before-any-output-fails-the-turn-before-it-starts)).
   A failure after that point is an `error` part.
7. When stdout ends, await stderr's end and `exited`, then close the stream, or report the exit-code error. The
   exit-code error is skipped when `abortSignal.aborted` is true.

`cleanup()` runs from abort, from exit, from the returned stream's `cancel()`, and from a spawn failure. It kills the
child, calls `stop()` on the MCP endpoint, closes the stream, and sets a `closed` flag. After `closed` is set, `emit` is
a no-op, so a tool that finishes after a stop writes nothing.

What goes to stdin
([D-5](artifacts/change-decision-log.md#d-5-the-cli-model-replays-history-as-a-text-transcript-on-each-call)): when one
non-system message remains, its text. Otherwise, a transcript of every earlier message followed by the new one:

```
<history>
<message role="user">
Summarize a.md
</message>
<message role="assistant">
I'll read it.
[tool call Read {"file_path":"a.md"}]
</message>
<message role="tool">
[tool result Read] # A
...
</message>
</history>

<message role="user">
Now shorten it
</message>
```

Each part renders as follows. Text parts are verbatim. A tool call is `[tool call <name> <JSON input>]`. A tool result
is `[tool result <name>] <value>`:

- `text` and `error-text` output: the value as is.
- `json` and `error-json` output: `JSON.stringify(value)`.
- `content` output: its text items joined.
- Any other output: `[unsupported]`.

Reasoning and file parts are left out.

Failures reach the writer through the existing `modelErrorMessage`, which shows any `Error`'s message and does not
change
([D-12](artifacts/change-decision-log.md#d-12-cli-failures-surface-as-four-fixed-messages-through-the-existing-modelerrormessage)).
A failure before the first text or tool call throws from `doStream` (lifecycle step 6). A failure after it is an `error`
stream part. An `init` event that reports the `3pitor` MCP server as anything but `connected` counts as a failure before
output: the child is killed, and the call throws.

| Cause | `Error.message` |
| --- | --- |
| `Bun.spawn` throws with code `ENOENT` | `CLAUDE_NOT_FOUND_HELP` |
| `init` reports the `3pitor` MCP server not `connected` | `claude could not reach 3pitor's tools (MCP server "3pitor" status: <status>)` |
| `result` event with `is_error: true` | `claude failed: <result text, or subtype>` |
| Exit code other than 0 with no `result` event | `claude exited with code <n>: <last non-empty stderr line, or "no output">` |

```
CLAUDE_NOT_FOUND_HELP:
The claude program is not on your PATH, so chat won't work in CLI mode.

Install Claude Code and sign in (https://code.claude.com/docs/en/setup), or start 3pitor with an API key:

  ANTHROPIC_API_KEY=sk-ant-... 3pitor
```

**`stream-json.ts`** turns `claude`'s output lines into AI SDK stream parts. `claude`'s lines carry whole post texts,
so they are often longer than one pipe read, and posts are full of curly quotes and dashes. The module therefore owns
the framing as well as the mapping
([D-17](artifacts/change-decision-log.md#d-17-stream-jsonts-owns-line-framing-and-skips-a-line-it-cannot-parse)):

```ts
export function lines(): TransformStream<string, string>;   // keeps the unfinished tail; flushes a last line with no newline
export function streamJsonParts(): TransformStream<string, LanguageModelV4StreamPart>;  // one line per chunk
// proc.stdout.pipeThrough(new TextDecoderStream()).pipeThrough(lines()).pipeThrough(streamJsonParts())
```

A line that fails `JSON.parse` is skipped with one `console.warn`, and does not fail the turn. `streamJsonParts` emits
`{ type: 'stream-start', warnings: [] }` first. `msg` counts `message_start` events, so text ids stay unique across the
messages of one run.

| stream-json line | Stream part |
| --- | --- |
| `{"type":"system","subtype":"init","mcp_servers":[{"name":"3pitor","status":"connected"}]}` | none; a status other than `connected` while tools are present is a failure before output (lifecycle step 6) |
| `stream_event` with `message_start` | none (`msg++`) |
| `stream_event` with `content_block_start`, `content_block.type: "text"`, `index: i` | `{ type: 'text-start', id: '<msg>.<i>' }` |
| `stream_event` with `content_block_delta`, `delta.type: "text_delta"` | `{ type: 'text-delta', id, delta: delta.text }` |
| `stream_event` with `content_block_stop` on an open text id | `{ type: 'text-end', id }` |
| `{"type":"result","subtype":"success","is_error":false,"usage":{"input_tokens":a,"output_tokens":b,"cache_read_input_tokens":c,"cache_creation_input_tokens":d}}` | `{ type: 'finish', finishReason: { unified: 'stop', raw: 'success' }, usage: { inputTokens: { total: a+c+d, noCache: a, cacheRead: c, cacheWrite: d }, outputTokens: { total: b, text: b, reasoning: undefined } } }` |
| `result` with `is_error: true` | `{ type: 'error', error }`, then `finish` with `unified: 'error'` |
| Anything else (`assistant`, `user`, `tool_use`, thinking deltas) | ignored |

A successful run always finishes with `unified: 'stop'`, so the AI SDK treats one `claude` run as one step
([D-14](artifacts/change-decision-log.md#d-14-step-limits-are-soft-in-cli-mode)).

**`mcp-endpoint.ts`** lends 3pitor's tools to `claude` for one model call
([D-3](artifacts/change-decision-log.md#d-3-3pitors-tools-reach-claude-through-a-small-mcp-server-3pitor-starts-for-each-model-call)).
MCP (Model Context Protocol) is the protocol `claude` uses to call tools that another program hosts. It owns the
JSON-RPC exchange, checking input against each tool's schema, running `execute` in-process against the turn's copy, and
the chat's tool rows (the entries the chat shows for each tool call). It does not decide which tools the model may see;
the call's tool list does.

```ts
export function serveTools(
  defs: LanguageModelV4FunctionTool[],          // the call's tools: name, description, inputSchema
  tools: ToolSet,                                // executable tools, looked up by name
  emit: (part: LanguageModelV4StreamPart) => void,
  abortSignal?: AbortSignal,
): { url: string; stop(): void };
// Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0 }), path /mcp/<crypto.randomUUID()>
```

`idleTimeout: 0` turns off Bun's 10-second idle limit
([D-20](artifacts/change-decision-log.md#d-20-the-mcp-endpoint-never-times-out-a-tool-call)). A Task call holds its
request open for the whole subagent run, which often takes longer than that. `server.ts` raises the same limit for the
same reason.

The config handed to `claude` with `--mcp-config`:

```json
{"mcpServers":{"3pitor":{"type":"http","url":"http://127.0.0.1:53121/mcp/6f1c2e0a-9b7d-4c1e-8f3a-2d5b6c7e8f90"}}}
```

Every POST body is JSON-RPC 2.0. The exchanges:

| Request | Response |
| --- | --- |
| `initialize` | `{"protocolVersion":<the client's value>,"capabilities":{"tools":{}},"serverInfo":{"name":"3pitor","version":"1"}}` |
| `notifications/initialized` | HTTP 202, empty body |
| `ping` | `{}` |
| `tools/list` | `{"tools":[{"name":"Read","description":"…","inputSchema":<defs[i].inputSchema>}, …]}` |
| `tools/call` with `{"name":"Read","arguments":{…}}` | see the steps below |
| `tools/call` with a name not in `defs`, or arguments that fail the schema | JSON-RPC error `-32602`, no tool row |
| Any other method | JSON-RPC error `-32601` |
| GET or DELETE on the path | HTTP 405 |
| Any other path | HTTP 404 |

A `tools/call` runs in four steps, and the handler is where the chat's tool rows come from
([D-4](artifacts/change-decision-log.md#d-4-tool-rows-in-cli-mode-come-from-the-mcp-handler-not-from-parsing-claudes-output)):

1. Emit `{ type: 'tool-call', toolCallId: 'mcp-<n>', toolName, input: JSON.stringify(arguments), providerExecuted: true
   }`.
2. Await `execute(arguments, { toolCallId, messages: [], abortSignal })`.
3. Emit `{ type: 'tool-result', toolCallId, toolName, result: output ?? '' }`, adding `isError: true` with the message
   when `execute` throws.
4. Answer `{"content":[{"type":"text","text":<output as a string, or JSON.stringify(output)>}],"isError":<false or
   true>}`.

Because the parts carry `providerExecuted: true`, the AI SDK records them and does not run the tool a second time
([C-11](artifacts/current-state-findings.md#c-11-the-ai-sdk-does-not-run-a-tool-call-the-model-marks-as-already-run)).
The chat shows `Read`, not `mcp__3pitor__Read`.

**`fake-claude.ts`** is a test fixture: a `#!/usr/bin/env bun` script that stands in for `claude` on `PATH`
([D-15](artifacts/change-decision-log.md#d-15-api-mode-tests-stay-on-the-module-mock-the-cli-model-is-tested-through-a-fake-claude-on-path)).
Its only inputs are its arguments, stdin, and its environment. It never reads `~/.claude` or the network. It reads
stdin, calls `tools/call` on the URL in `--mcp-config`, and prints canned stream-json lines. Its first text delta is
`ANTHROPIC_API_KEY=present` or `ANTHROPIC_API_KEY=absent`, which is how a test sees what reached the child.

Tests set it up the same way each time:

1. Copy it into a fresh `mkdtemp` folder as `claude`, and `chmod 0o755` it there, so the test never depends on the file
   mode in git.
2. In `beforeEach`, set `process.env.PATH` to that folder plus the folder holding the running `bun`, which the fixture's
   `#!/usr/bin/env bun` line needs.
3. In `afterEach`, restore `PATH`, the way `sessions.test.ts` restores its state.

The not-found test uses a folder with no `claude` in it. No test checks the startup warning by changing `PATH`
in-process, because `Bun.which` may cache what it found.

### Type-checking in `make test`

`bun test` runs TypeScript without checking its types. So a test site that misses the new required `claude` field, or
any other type error, passes today. `make test` gains a `typecheck` target that runs first
([D-22](artifacts/change-decision-log.md#d-22-make-test-type-checks-the-code-first)):

```make
test: typecheck test-server test-ui

typecheck: node_modules
	./node_modules/.bin/tsc --noEmit -p .
```

It uses the `typescript` 7.0.2 already in `devDependencies`, and the existing `tsconfig.json`, which already sets
`noEmit`, `strict`, and `include: ["src"]`. On 2026-09-30 it exits 0 over the current code, in about a third of a
second. If it fails when this unit is built, fixing those type errors is part of the unit, whatever file they are in.

### What does not change

- `sessions.ts`: the turn, history, error flag, abort handling, and `data-session` part.
- `tools.ts`: every file tool.
- `taskTool`: it already takes its model as an argument.
- The UI and the wire format.
- `modelErrorMessage`, and the text of `MISSING_API_KEY_HELP`, which moves but does not change.
- `make build`, `make check-build`, and `scripts/check.ts`. `make test` gains a type-check step (S-12).

A session can switch modes between runs. The CLI model renders any history as a transcript. The API path drops tool
calls it did not run and keeps their text, with a warning, rather than failing
([C-12](artifacts/current-state-findings.md#c-12-the-api-path-drops-tool-calls-in-history-that-some-other-runner-already-ran-with-a-warning)).

## Surface Delta

### S-1: `--claude` command-line flag — Added

**Target state.** `3pitor` and `bun run server` accept `--claude=<mode>` or `--claude <mode>`. The mode is `auto`,
`api`, or `cli`, in any case, and defaults to `auto`. The folder or file argument still works on its own or after the
flag. An unknown flag, or a value other than those three, stops startup with exit code 2 and the usage line.

**Behavior.** Changing. Today every first argument is taken as a folder. A mistyped flag used to warn and open the
launch folder; now it exits. Escalated as "a mistyped flag will now stop 3pitor from starting"; the operator answered
"recommended".

**Why.** The operator asked for the flag, and today `--claude=CLI` is taken as a folder
([C-9](artifacts/current-state-findings.md#c-9-startup-reads-a-positional-argument-straight-from-processargv-with-no-parser)).

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-parse-the-command-line-with-buns-built-in-parseargs),
[D-8](artifacts/change-decision-log.md#d-8-a-bad-flag-or-value-stops-startup),
[D-13](artifacts/change-decision-log.md#trivial-decisions)

### S-2: `src/server/command-line.ts` — Added

**Target state.** `command-line.ts` exists at the server package root and exports `ClaudeMode`, `USAGE`, and
`parseCommandLine(argv, env)`, as pinned in Target State. It turns the command line and environment into a folder
argument and a resolved mode, and does nothing else.

**Behavior.** Preserving. Nothing uses it until S-10, which carries the behavior change.

**Why.** It keeps the flag grammar testable without starting the server.

**Depends on.** S-1.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-parse-the-command-line-with-buns-built-in-parseargs),
[D-9](artifacts/change-decision-log.md#d-9-auto-resolves-once-at-startup-from-whether-anthropic_api_key-is-non-empty)

### S-3: `claude-cli/stream-json.ts` `streamJsonParts` — Added

**Target state.** `streamJsonParts()` turns `claude`'s stream-json output lines into AI SDK stream parts, per the
mapping in Target State. It emits text, finish, and error parts, and ignores `claude`'s own tool events.

**Behavior.** Preserving. Nothing uses it outside CLI mode.

**Why.** `claude` reports its output as stream-json, and the AI SDK expects stream parts.

**Decision.**
[D-4](artifacts/change-decision-log.md#d-4-tool-rows-in-cli-mode-come-from-the-mcp-handler-not-from-parsing-claudes-output),
[D-17](artifacts/change-decision-log.md#d-17-stream-jsonts-owns-line-framing-and-skips-a-line-it-cannot-parse)

### S-4: `claude-cli/mcp-endpoint.ts` `serveTools` — Added

**Target state.** `serveTools(defs, tools, emit, abortSignal)` serves the call's tools to `claude` over MCP on
`127.0.0.1`, at an unguessable path, for one model call. It runs each tool in-process against the turn's copy and emits
a tool-call and tool-result part around each one.

**Behavior.** Preserving. Nothing uses it outside CLI mode.

**Why.** 3pitor's tools must run inside 3pitor
([C-4](artifacts/current-state-findings.md#c-4-the-file-tools-must-run-inside-3pitor-against-the-turns-copy-of-the-posts)),
and `claude` can only call another program's tools over MCP
([C-13](artifacts/current-state-findings.md#c-13-the-claude-program-runs-its-own-tool-loop-and-can-call-tools-3pitor-hosts-over-mcp)).

**Decision.**
[D-3](artifacts/change-decision-log.md#d-3-3pitors-tools-reach-claude-through-a-small-mcp-server-3pitor-starts-for-each-model-call),
[D-4](artifacts/change-decision-log.md#d-4-tool-rows-in-cli-mode-come-from-the-mcp-handler-not-from-parsing-claudes-output),
[D-20](artifacts/change-decision-log.md#d-20-the-mcp-endpoint-never-times-out-a-tool-call)

### S-5: `claude-cli/claude-cli.ts` `claudeCliModel` and `CLAUDE_NOT_FOUND_HELP` — Added

**Target state.** `claudeCliModel(modelId, tools, { webTools })` is an AI SDK model that runs the installed `claude`
once per call. It uses the pinned arguments, an environment without API credentials, and the working directory
`os.tmpdir()`. It replays history as a transcript on stdin and streams the result back. It follows the pinned lifecycle,
which kills `claude` and stops its MCP endpoint however the call ends. A failure before any output fails the call before
it starts. It reports failures with the four pinned messages. `CLAUDE_NOT_FOUND_HELP` is the message for a missing
`claude`.

**Behavior.** Preserving. Nothing uses it outside CLI mode.

**Why.** It is the adapter the operator asked for, and the only new part both call shapes (chat and Task) need
([C-5](artifacts/current-state-findings.md#c-5-task-subagents-reuse-the-parents-model-through-a-nested-generatetext)).

**Depends on.** S-3, S-4.

**Decision.**
[D-2](artifacts/change-decision-log.md#d-2-drive-the-installed-claude-program-directly-not-through-a-package-that-wraps-it),
[D-5](artifacts/change-decision-log.md#d-5-the-cli-model-replays-history-as-a-text-transcript-on-each-call),
[D-6](artifacts/change-decision-log.md#d-6-the-claude-child-runs-without-api-credentials-from-a-neutral-folder),
[D-10](artifacts/change-decision-log.md#d-10-cli-mode-keeps-claudes-own-web-search-and-web-fetch-for-the-main-chat-only),
[D-12](artifacts/change-decision-log.md#d-12-cli-failures-surface-as-four-fixed-messages-through-the-existing-modelerrormessage),
[D-14](artifacts/change-decision-log.md#d-14-step-limits-are-soft-in-cli-mode),
[D-18](artifacts/change-decision-log.md#d-18-one-pinned-lifecycle-for-each-cli-model-call),
[D-19](artifacts/change-decision-log.md#d-19-a-claude-failure-before-any-output-fails-the-turn-before-it-starts)

### S-6: `claude-backend/claude-backend.ts` `ClaudeBackend`, `apiBackend`, `cliBackend`, `claudeBackend` — Added

**Target state.** `claude-backend.ts` exports the `ClaudeBackend` interface, its two implementations, and
`claudeBackend(mode)`, as pinned in Target State. It is the only code that knows which modes exist and what differs
between them: the chat and subagent models, the provider-run tools, the startup label, and the startup warning.

**Behavior.** Preserving. `apiBackend` returns today's model and web tools, and today's missing-key warning.

**Why.** The operator asked for a shared interface over both modes, reinstating it from the YAGNI deferrals. Their
direction is the justification.

**Depends on.** S-5.

**Decision.** [D-21](artifacts/change-decision-log.md#d-21-a-shared-claudebackend-interface-over-both-modes)

### S-7: `MISSING_API_KEY_HELP` — Moved

**Target state.** `MISSING_API_KEY_HELP` is exported from `claude-backend.ts` instead of `agent.ts`, with the same text.
`apiBackend.startupWarning` returns it, and `modelErrorMessage` in `agent.ts` still returns it for a `LoadAPIKeyError`.

**Behavior.** Preserving. The text and both places it appears are unchanged.

**Why.** The API backend owns its own warning, and the move keeps `claude-backend.ts` from importing `agent.ts`, which
imports it.

**Depends on.** S-6.

**Migration.** `sessions.test.ts` imports it from `../claude-backend/claude-backend`. `server.ts` no longer imports it.

**Decision.** [D-21](artifacts/change-decision-log.md#d-21-a-shared-claudebackend-interface-over-both-modes)

### S-8: `AgentOptions.claude` and `AgentHostOptions.claude` — Added

**Target state.** Both interfaces carry a required `claude: ClaudeMode`, and `SessionsOptions` inherits it. It is the
only way the mode travels from startup to `agentSettings`.

**Behavior.** Preserving. Callers must pass it; every existing test passes `claude: 'api'`.

**Why.** `agentSettings` needs the mode, and the options object already flows there unchanged
([C-2](artifacts/current-state-findings.md#c-2-the-chat-turn-is-one-streamtext-call-over-whatever-agentsettings-returns)).

**Depends on.** S-2.

**Migration.** Add `claude: 'api'` wherever a test builds `AgentOptions`, `AgentHostOptions`, or `SessionsOptions`
(five sites in `agent.test.ts`, one in `sessions.test.ts`).

**Decision.**
[D-15](artifacts/change-decision-log.md#d-15-api-mode-tests-stay-on-the-module-mock-the-cli-model-is-tested-through-a-fake-claude-on-path)

### S-9: `agentSettings` — Re-scoped

**Target state.** `agentSettings` gets `claudeBackend(options.claude)` and builds the tools from the file tools, Task
on the backend's subagent model, and the backend's provider tools. It returns the backend's chat model with them. It
never checks the mode itself. The instructions are the same in both modes.

**Behavior.** Preserving for API mode: the same tools in the same order, the same model, and the same instructions.
Task gets its own stateless `anthropic(id)` instance. CLI mode is new.

**Why.** It is the single place a model is built
([C-1](artifacts/current-state-findings.md#c-1-one-function-builds-the-model-the-tools-and-the-instructions)).

**Depends on.** S-6, S-8.

**Decision.**
[D-1](artifacts/change-decision-log.md#d-1-the-adapter-layer-is-one-new-ai-sdk-model-chosen-inside-agentsettings),
[D-21](artifacts/change-decision-log.md#d-21-a-shared-claudebackend-interface-over-both-modes),
[D-10](artifacts/change-decision-log.md#d-10-cli-mode-keeps-claudes-own-web-search-and-web-fetch-for-the-main-chat-only)

### S-10: `server.ts` startup — Re-scoped

**Target state.** `server.ts` gets its folder argument and mode from `parseCommandLine`, exits with code 2 on a
command-line error, and passes the mode to `createAgentHost`. It prints the mode line from
`claudeBackend(claude).label`, then that backend's `startupWarning`, if any: missing key in API mode, or `claude` not
found in CLI mode. It no longer reads `process.argv[2]` or warns about a missing key unconditionally. The `listening on`
line is unchanged.

**Behavior.** Changing. Every start prints a new mode line. A start with no key prints `3pitor chat: claude via the
claude program` in place of the missing-key help. Escalated as "what 3pitor prints at startup"; the operator answered
"recommended".

**Why.** The operator asked for `auto`, which is only visible if 3pitor says what it picked. The old warning is wrong in
CLI mode
([C-7](artifacts/current-state-findings.md#c-7-the-missing-key-message-is-api-specific-and-the-startup-check-is-a-separate-copy-of-it)).

**Depends on.** S-2, S-6, S-8.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-a-bad-flag-or-value-stops-startup),
[D-11](artifacts/change-decision-log.md#d-11-startup-prints-which-mode-chat-will-use-in-place-of-the-unconditional-missing-key-warning)

### S-11: `ANTHROPIC_API_KEY` — Re-scoped

**Target state.** `ANTHROPIC_API_KEY` chooses the mode under `auto`: non-empty means API mode, empty or unset means CLI
mode. In API mode it is the sign-in, as today. It never reaches the `claude` child.

**Behavior.** Changing. With no key, chat used to fail every turn with the missing-key help. Now it runs through
`claude`. The operator asked for exactly this ("if that env var does not exist, or is empty, assume you can run `claude`
CLI"), so the boundary settles it and it was not escalated again.

**Why.** The operator's stated rule for `auto`.

**Depends on.** S-2, S-5.

**Decision.**
[D-9](artifacts/change-decision-log.md#d-9-auto-resolves-once-at-startup-from-whether-anthropic_api_key-is-non-empty)

### S-12: `make test` and `make typecheck` — Re-scoped

**Target state.** `make typecheck` runs `./node_modules/.bin/tsc --noEmit -p .` over `src`, using the existing
`tsconfig.json`. `make test` runs it before `test-server` and `test-ui`, so a type error fails `make test`.
`typecheck` joins the `.PHONY` list.

**Behavior.** Changing. Today a type error passes `make test` as long as the tests pass. After the change it fails
`make test`. The observer is a developer running `make test`. The operator asked for this ("add the check regardless,
and fix the issues if there are any"), so it was not escalated again.

**Why.** The operator asked for it. It also enforces S-8's migration, which `bun test` alone does not.

**Decision.** [D-22](artifacts/change-decision-log.md#d-22-make-test-type-checks-the-code-first)

### S-13: README — Re-scoped

**Target state.** The README documents the usage line `3pitor [--claude=auto|api|cli] [folder-or-file]`, both modes,
how `auto` chooses, and the startup mode line. It says API mode needs no `claude` program, and CLI mode needs `claude`
installed and signed in. `MODEL` applies to both modes.

**Behavior.** Preserving. Documentation only.

**Why.** The README says 3pitor "needs no `claude` program" and documents only API startup
([C-17](artifacts/current-state-findings.md#c-17-readme-and-build-checks-describe-api-only-startup)).

**Depends on.** S-10.

**Decision.**
[D-11](artifacts/change-decision-log.md#d-11-startup-prints-which-mode-chat-will-use-in-place-of-the-unconditional-missing-key-warning)

## Behavior Changes

Four entries change what someone sees. The operator decided each one.

- **Starting with no API key now uses your subscription (S-11).** Observer: the operator starting 3pitor. Today, with no
  `ANTHROPIC_API_KEY`, 3pitor warns that chat won't work, and every message fails. After the change it runs chat through
  the installed `claude` program. This is the behavior the operator asked for.
- **A mistyped flag stops startup (S-1, S-10).** Observer: anyone starting 3pitor from a terminal. Today `3pitor
  --claud=cli notes` warns and opens the folder it was launched from. After the change it exits at once with
  `3pitor: Unknown option '--claud'` and the usage line. Decision: "recommended" (stop, so a forced mode is never
  silently ignored).
- **Startup names the chat mode (S-10).** Observer: the operator reading the terminal. Every start prints `3pitor chat:
  claude via the Anthropic API` or `… via the claude program`. The missing-key help now appears only in API mode, and a
  new not-found help appears in CLI mode when `claude` is missing. Decision: "recommended".
- **A type error now fails `make test` (S-12).** Observer: a developer running `make test`. Today a type error passes
  as long as the tests pass. After the change `make test` stops at the type-check. The operator asked for it.

## Change Units

### Unit 0: Try the `claude` command by hand

**What it does.** A throwaway script, never merged, runs the pinned `claude` command against a stub MCP server and
records real output. It confirms:

- The `type: "http"` MCP config key.
- That `--allowedTools` pre-approves both the MCP tools and `WebSearch,WebFetch`.
- The shape of `init.mcp_servers`, `stream_event`, and `result`.
- Whether `~/.claude/CLAUDE.md` or user skills still load under `--system-prompt`. If they do, add
  `--setting-sources` or `--disable-slash-commands`.
- The MCP protocol version `claude` sends.
- What a signed-out `claude` prints, and what a run that hits the subscription's usage limit prints: a `result` with
  `is_error`, or a non-zero exit.
- `claude`'s own timeout for an MCP `tools/call`, using a stub tool that takes longer than 60 seconds. Also whether it
  retries after the connection drops. If the timeout is shorter than a long subagent run, pass the setting that raises
  it (for example `MCP_TOOL_TIMEOUT` in the child's environment).
- Whether `claude` exits promptly on SIGTERM, and when its stdout reader goes away.

Any difference updates the pins in Target State before Unit 4.

**Delta entries.** None.

**How you know it worked.** Recorded sample lines for every row of the stream-json table, and one successful
`tools/call` from `claude` to the stub.

### Unit 1: Type-check in `make test`

**What it does.** Adds the `typecheck` target and makes `test` depend on it, per S-12. If `tsc` reports errors when the
unit is built, it fixes them in the same unit.

**Delta entries.** S-12.

**Ordering constraint.** None. It goes first so every later unit is type-checked.

**How you know it worked.** `make typecheck` exits 0, and `make test` runs it before the tests. A deliberate type error
in any file under `src` fails `make test`.

### Unit 2: Stream-json translation

**What it does.** Adds `lines` and `streamJsonParts` and their unit tests, fed recorded lines from Unit 0. The tests
include a line split across two chunks in the middle of a multibyte character, a last line with no newline, and a line
that is not JSON.

**Delta entries.** S-3.

**Ordering constraint.** After Unit 0, so the tests use real lines.

**How you know it worked.** `make test` passes, and nothing imports the module yet.

### Unit 3: The per-call MCP server

**What it does.** Adds `serveTools` and tests that drive it with `fetch`: initialize, list, a successful call, a tool
that throws, bad arguments, an unknown tool, abort, and stop. One test uses a tool that takes 12 seconds, to show the
request is not cut off.

**Delta entries.** S-4.

**How you know it worked.** `make test` passes. A test shows `execute` ran against a `TurnTexts` copy and emitted a
tool-call and tool-result pair.

### Unit 4: The CLI model

**What it does.** Adds `claudeCliModel`, the transcript rendering, the error messages, `CLAUDE_NOT_FOUND_HELP`, and
`fake-claude.ts`, with tests that put the fake on `PATH`.

**Delta entries.** S-5.

**Ordering constraint.** After Units 2 and 3, which it composes.

**How you know it worked.** `make test` passes, with tests for:

- Streamed text.
- A tool call through the MCP server.
- `ENOENT` when `PATH` is empty.
- Abort, which kills the child and leaves no edits.
- A non-zero exit.
- `ANTHROPIC_API_KEY` stripped from the child's environment.
- `generateText` returning the text, as Task needs.
- A `result` with `is_error` before any text: `doStream` throws, and a chat turn over it leaves `session.messages`
  unchanged.
- Abort during a slow tool call: nothing is written after the stop, and no stack trace is printed.
- A signal already aborted before the call: `claude` is never spawned.

### Unit 5: Choose the mode at startup

**What it does.** Adds `command-line.ts` and its tests. Adds `claude-backend.ts` and moves `MISSING_API_KEY_HELP` into
it, with tests that check each member of both backends against the table in Target State. Adds the `claude` option
field, and `claude: 'api'` at every test site. Makes `agentSettings` use the backend, and adds one `agent.test.ts` test
that lists the tool names in both modes: `Read, Write, Edit, Glob, Highlight, Task, web_search, web_fetch` for API, and
`Read, Write, Edit, Glob, Highlight, Task` with provider `claude-cli` for CLI. The CLI cases only inspect
`model.provider` and `tools`, and never call the model, so they never start a real `claude` on a developer's machine.
Adds the `server.ts` wiring, the mode line, and the warnings. This is the only unit that changes behavior.

**Delta entries.** S-1, S-2, S-6, S-7, S-8, S-9, S-10, S-11.

**Ordering constraint.** After Unit 4, because `cliBackend` builds `claudeCliModel`. The parser, the backend, the
option field, and the `agentSettings` change land together: a `claude` field with no parser would have nothing to set
it, and a parser with no backend would resolve a mode nothing uses.

**How you know it worked.**

- `make test` passes, and `make check-build` passes unchanged. It sets `ANTHROPIC_API_KEY=unused`, so it resolves to API
  mode.
- By hand: `bun run server --claude=cli` prints the CLI mode line, and a chat message edits a post in the editor
  without writing the file.
- `bun run server --claud=cli` exits with code 2.

### Unit 6: README

**What it does.** Updates the README per S-13.

**Delta entries.** S-13.

**Ordering constraint.** After Unit 5.

**How you know it worked.** The README's usage line matches `USAGE`, and no sentence says 3pitor never needs `claude`.

## Risks

- **R1: `claude`'s output format or flags change between versions.** The local version is 2.1.285. Unit 0 records real
  output, the parser ignores every event except text deltas, `init`, and `result`, and the fake `claude` pins what the
  code expects. It affects CLI mode only.
- **R2: Step limits do not cap `claude`'s own loop.** One `claude` run counts as one AI SDK step, so `stepCountIs(20)`
  and `stepCountIs(10)` stop nothing inside it. Accepted as a soft limit
  ([D-14](artifacts/change-decision-log.md#d-14-step-limits-are-soft-in-cli-mode)).
- **R3: Long chats replay the whole transcript every turn.** Earlier Read results are sent again in full, which costs
  time and subscription usage. It goes through stdin, so it hits no argument-length limit.
- **R4: Text and tool rows can arrive out of order.** They come from two sources: `claude`'s stdout, and the MCP
  server. `claude` calls a tool only after the text before it is complete, so the risk is small, and it affects display
  order only.
- **R5: `bun run check` with no key now drives the real `claude`.** This is what `auto` means, but a run that used to
  fail fast now uses the subscription.
- **R6: Stale packages in `node_modules`.** `@modelcontextprotocol/sdk` and a bundled `claude` binary package sit in
  `node_modules` without being in `bun.lock`. Nothing may import them. A fresh `bun install` removes them.
- **R7: Anthropic's terms for using a subscription this way.** Anthropic's legal page allows signing in to the
  unmodified `claude` binary with your own subscription. It also says developers building products should use API keys.
  It does not address a one-person tool that runs the unmodified binary. This is the operator's call.
- **R8: A test run outside `make test` does not type-check.** `bun test` alone still runs a test site that misses the
  new required `claude` field. `make test` catches it at the type-check step (S-12), so this only affects someone
  running `bun test` directly.

## Deferred (YAGNI)

### `commander` or another argument-parsing library

**Why deferred:** The operator chose the built-in parser, and nothing needs generated `--help` or subcommands.
**Reopen when:** A second option or a subcommand lands.
**Source:** software-architect; operator answer.

### `@modelcontextprotocol/sdk`

**Why deferred:** Simpler-version test. Four JSON-RPC methods are about 80 lines, against 17 runtime dependencies.
**Reopen when:** `claude` needs SSE, sessions, or resources from the server.
**Source:** software-architect.

### A turn cap for CLI mode

**Why deferred:** Evidence test. No runaway turn has been seen, and the operator accepts soft limits.
**Reopen when:** A CLI turn is observed running away.
**Source:** software-architect.

### A dedicated "sign in to claude" message

**Why deferred:** Evidence test. `claude`'s signed-out output is unverified, so there is no stable marker to match.
Until then, its own wording passes through the `claude failed` or `claude exited` message.
**Reopen when:** Unit 0 captures a stable signed-out marker.
**Source:** software-architect.

### A watchdog timeout for a hung `claude`

**Why deferred:** Evidence test. Every CLI call belongs to an interactive turn the writer can stop, and stop reaches
nested Task children through the same signal.
**Reopen when:** Something runs CLI mode unattended, or a stop is seen not to end a child.
**Source:** on-call-engineer OCE-006.

### Reaping `claude` children when 3pitor dies

**Why deferred:** Evidence test. Ctrl-C reaches the whole process group. After a crash, the orphan loses its MCP server
and its reader, so it ends its one run.
**Reopen when:** A `claude` process is seen outliving 3pitor by minutes, or 3pitor runs under a supervisor that signals
only the parent.
**Source:** on-call-engineer OCE-007.

### A test of `server.ts` startup output and exit code

**Why deferred:** Evidence test. `command-line.ts` tests cover the throw, and the wiring is a few lines.
**Reopen when:** Startup logic grows past that wiring, or the mode line regresses.
**Source:** test-engineer.

## Open Items

- **Whether `claude`'s own web tools behave in this mode (non-blocking).** The operator chose to keep them. If Unit 0
  shows they need approval flags that also re-enable file tools, or otherwise misbehave, fall back to `--tools ""` for
  every call. That fallback was the operator's second choice
  ([D-10](artifacts/change-decision-log.md#d-10-cli-mode-keeps-claudes-own-web-search-and-web-fetch-for-the-main-chat-only)).
- **Every `claude` contract pinned from the docs (blocking for Unit 2).** The MCP config shape, the approval rule, and
  the stream-json shapes rest on Anthropic's docs, not on a run
  ([C-13](artifacts/current-state-findings.md#c-13-the-claude-program-runs-its-own-tool-loop-and-can-call-tools-3pitor-hosts-over-mcp)).
  Unit 0 settles them.

## Review Findings

One review round ran, with `han-core:junior-developer` (reframing before escalation), `han-core:test-engineer`, and
`han-core:on-call-engineer`. No finding was labeled `Unverified` at blocking severity. The findings that rested on
`claude`'s live behavior were turned into Unit 0 checks. The decisions are in
[change-decision-log.md](artifacts/change-decision-log.md).

Findings that changed the plan:

- **A Task call would be cut off after 10 seconds** (on-call-engineer OCE-001). Bun's default idle limit would close the
  MCP request while a subagent was still running. Fixed by `idleTimeout: 0`
  ([D-20](artifacts/change-decision-log.md#d-20-the-mcp-endpoint-never-times-out-a-tool-call)).
- **Output lines had no pinned framing** (OCE-002). Long lines and characters split across reads would break parsing.
  Fixed by the `lines()` pipeline and skipping unparseable lines
  ([D-17](artifacts/change-decision-log.md#d-17-stream-jsonts-owns-line-framing-and-skips-a-line-it-cannot-parse)).
- **A `claude` failure would have been saved into history** (OCE-003), breaking the rule that a failed turn never enters
  it
  ([C-8](artifacts/current-state-findings.md#c-8-a-failed-stream-must-set-the-error-flag-and-a-stop-must-be-seen-through-the-abort-signal)).
  Fixed by holding the stream until the first output
  ([D-19](artifacts/change-decision-log.md#d-19-a-claude-failure-before-any-output-fails-the-turn-before-it-starts)).
- **Cleanup was prose over five exit paths** (OCE-004, OCE-005). Fixed by the numbered lifecycle, an idempotent
  `cleanup()`, stdin as a `Blob`, and draining stderr at the same time as stdout
  ([D-18](artifacts/change-decision-log.md#d-18-one-pinned-lifecycle-for-each-cli-model-call)).
- **The API tool list was never asserted** (test-engineer F1). Unit 5's tool-list test now covers both modes.
- **Reinstated by the operator after the review.** Two deferrals came back into the plan at the operator's direction:
  the shared `ClaudeBackend` interface
  ([D-21](artifacts/change-decision-log.md#d-21-a-shared-claudebackend-interface-over-both-modes)) and the type-check
  step in `make test` ([D-22](artifacts/change-decision-log.md#d-22-make-test-type-checks-the-code-first)).
- **The fake `claude` setup was prose** (test-engineer F5, F6). The fixture's reporting channel, `chmod`, and `PATH`
  scoping are now pinned.

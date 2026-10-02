---
goal: "i want \"server\" to be the package where the HTTP and Websocket code lives. it's the main entry point for the backend services. all code that isn't HTTP API and web socket API should move into an \"engine\" package"
goal_source: "described in conversation (/han-core:pairing → design-an-api, 2026-10-02); direction and decisions recorded in .han/pairing/server-engine-api-2026-10-02.md"
interface: "The boundary between src/cli/ (new process entry), src/server/ (HTTP and WebSocket), and src/engine/ (new; everything else), replacing today's single src/server/ package"
size: "large"
size_reason: "Error-to-status mapping crosses the boundary, request validation moves with the handlers, and the change re-homes the process entry point used by the Makefile, package.json, tests, and the release workflow"
roster: "han-core:codebase-explorer, han-core:structural-analyst, han-core:software-architect, han-core:junior-developer, han-core:adversarial-validator (earlier F1–F33 discovery also used han-core:behavioral-analyst and han-core:adversarial-security-analyst)"
starting_point: "working tree (source unchanged from main; branch split-api-package)"
git_available: "yes"
---

# API Design: The `cli`, `server`, and `engine` Packages

## Summary

Today all backend code lives in `src/server/`. This design splits it into three packages:

- **`src/cli/`** is what runs when you type `3pitor`. It parses the command line and starts the engine. Then it hands
  the engine to `startServer`, prints the `listening on` line, and opens the browser.
- **`src/server/`** holds every HTTP and WebSocket line. Its route handlers extract what they need from the request and
  forward it to the engine, and it owns `Bun.serve` and the MCP endpoint the `claude` program calls.
- **`src/engine/`** holds everything else, behind one module, `engine.ts`. It knows nothing about HTTP or WebSockets.

Nothing a browser, the UI, or the check script can observe changes: every URL, status code, response body, and the
`listening on` line stay byte for byte.

- **Option chosen.** You chose Option A: one engine entry point, `engine.ts`, with a namespace per feature. It was
  chosen over Option B, routes importing engine feature folders directly, and Option C, the engine validating raw
  request bodies.
- **Your decisions.** You set the direction ("thin controller, thick domain layer") before the options were drafted.
  Then you made five decisions:
  - `mcp-endpoint.ts` moves to server, so the engine holds no HTTP of any kind.
  - A new `cli` package owns process startup and passes the engine to the server.
  - The server is a factory, `startServer`.
  - The four MCP round-trip tests move to server.
  - This change updates your layout-rules skill.
- **Validation outcome.** The adversarial validator found nothing that blocks the design. It confirmed five claims by
  experiment or by reading the code, among them a compiled copy of the real app that serves its page from a non-entry
  module. Eight findings were accepted in full or in part, and they changed five things:
  - The engine no longer writes the MCP transport type.
  - The four moved tests keep their assertions.
  - The engine keeps coverage of its stop guard.
  - The test-edit counts were corrected.
  - The missed comments and consumers were added.
- **Coverage.** No signalled specialist was left out by the size limit.

## The Goal This Serves

> "i want "server" to be the package where the HTTP and Websocket code lives. it's the main entry point for the backend
> services. all code that isn't HTTP API and web socket API should move into an "engine" package"

You gave this goal in the conversation, and then the direction every option had to follow:

> "the server holds the http API endpoints, and holds the entirety of the web sockets code. each route handler or
> websocket handler will do as little as possible to extract required information from the http call or the websocket
> call, and forward all relevant information to the engine. the critical split between the server and engine, is that
> the engine must not know anything about http or websockets. think of it like "thin controller, thick domain layer"
> where the http and websocket handling code is as thin as possible and forwards all requests to the engine, once the
> necessary info has been extracted."

The element table cites these as G1–G3 (the goal's three sentences) and D1–D4 (the direction's four sentences), as
defined in [design-options.md](./design-options.md).

**How the `cli` decision reads against the goal.** The goal called server "the main entry point for the backend
services". Your later decision gave the terminal entry point to `cli`: "when i call `3pitor` in a terminal prompt, the
"cli" will be invoked to handle the entry and start everything". Server stays the entry point for every HTTP and
WebSocket caller.

## The Designed Contract

### Surface

The five packages, what each holds, and which way imports may run:

#### Packages

| Package | Holds | Imports |
|---|---|---|
| `src/cli/` | The single process entry point `cli.ts`. It parses the command line, handles `--version` and `--help`, reads process env (A71), calls `startEngine` and then `startServer`, prints the "listening on" line, and opens the browser. | server (`server.ts` only), engine (`engine.ts` only), shared |
| `src/server/` | All HTTP and WebSocket code: `startServer` (Bun.serve, Hono app, `/api/health`, homepage, websocket, idleTimeout), thin route handlers, the MCP loopback endpoint `serveTools`, and `scripts/check.ts`. It reads no env. | engine (production code through `engine.ts` only; tests through the S3 list), shared, `ui/index.html` (from `server.ts` only) |
| `src/engine/` | Everything else: workspace selection, documents, sessions, agent, claude backends, the claude CLI model, tools, events, view state, workspace config, `paths.ts`. No HTTP, no WebSocket, no Bun.serve. It writes no HTTP transport detail (A60). | shared and npm only |
| `src/ui/` | Browser code (unchanged) | shared only |
| `src/shared/` | Wire types and markdown helpers (unchanged) | nothing |

```
cli    → server (server.ts only), engine (engine.ts only), shared
server → engine (production: engine.ts only), shared, ui/index.html (server.ts only)
engine → shared only
ui     → shared only
shared → nothing
nothing imports cli
```

#### Import rules

| Rule | Statement |
|---|---|
| E1 | No `src/engine/**` file, tests included, imports `src/server`, `src/cli`, `src/ui`, `hono` or `hono/bun`, or calls `Bun.serve`. No engine file writes an HTTP transport detail; the A64 patterns enforce this. |
| E2 | Engine production code imports only engine, shared and npm modules. |
| S1 | Server production code imports from the engine only through `src/engine/engine.ts`. This includes the `ServeTools` and `ToolEndpoint` types in `mcp-endpoint.ts`. |
| S2 | Server never imports cli. |
| S3 | Server tests and `scripts/check.ts` may also import the engine internals listed in A45, and nothing else from the engine. |
| S4 | Only `src/server/server.ts` imports `ui/index.html`. |
| C1 | cli imports the engine only through `engine.ts` and the server only through `server.ts`. |
| C2 | cli tests spawn `cli.ts` and import only `./command-line` (plus `bun:test` and `node:*`). |
| C3 | cli has no `hono` and no `Bun.serve`. |
| U1 | ui imports none of server, engine or cli. |
| H1 | shared imports no package. |

The signatures each package exposes, with the code that changes at the boundary:

#### `src/cli/cli.ts` (full)

```ts
// Entry point: the `3pitor` command. Reads the command line and environment, starts the engine on a workspace,
// serves it over HTTP, prints where, and opens the browser. Owns process concerns only: argv, env, exit codes,
// stdout lines, and the browser.
import { join } from 'node:path';
import { startEngine } from '../engine/engine';
import { serveTools, startServer } from '../server/server';
import { USAGE, VERSION, parseCommandLine } from './command-line';

const { target, claude } = commandLine();
// MODEL takes a full model id or a shortcut (haiku, sonnet, opus); the engine picks the default.
const engine = await startEngine({ target, claude, model: process.env.MODEL, serveTools });
const server = startServer(engine, {
  // Port 0 asks the OS for any free port, so several instances can run side by side. Set PORT to pin one.
  port: Number(process.env.PORT ?? 0),
  development: process.env.NODE_ENV !== 'production',
});
// check.ts and make check-build read the URL from this line; keep its "listening on <url>" shape.
console.log(`3pitor listening on ${server.url.origin} (workspace: ${join(engine.workspace)})`);

// Open the UI in the default browser. Set OPEN_BROWSER=0 to skip it (the check script does).
if (process.env.OPEN_BROWSER !== '0') openBrowser(server.url.origin);

// A bad flag stops startup, so a forced mode is never silently ignored. --version and --help print and exit before
// anything starts, including any workspace I/O.
function commandLine() {
  let line;
  try {
    line = parseCommandLine(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`3pitor: ${error instanceof Error ? error.message : error}\n${USAGE}`);
    process.exit(2);
  }
  if ('print' in line) {
    console.log(line.print === 'version' ? `3pitor ${VERSION}` : USAGE);
    process.exit(0);
  }
  return line;
}

function openBrowser(url: string) {
  const command =
    process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url];
  try {
    Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    console.log(`Could not open a browser; visit ${url}`);
  }
}
```

#### `src/server/server.ts` (full)

```ts
// The HTTP and WebSocket face of 3pitor: one Hono app with every feature's routes, the page, and the event socket,
// served by Bun. REST for documents and sessions, the AI SDK UI message stream (SSE) for chat turns, and a Bun-native
// WebSocket for events. Takes a started engine; reads no environment and prints nothing.
import { Hono } from 'hono';
import { websocket } from 'hono/bun';
import homepage from '../ui/index.html';
import type { Engine } from '../engine/engine';
import { sessionRoutes } from './chat/sessions/sessions.routes';
import { documentRoutes } from './documents/documents.routes';
import { eventSocket } from './events/events.routes';
import { viewStateRoutes } from './view-state/view-state.routes';
import { workspaceConfigRoutes } from './workspace-config/workspace-config.routes';

// The MCP loopback endpoint the engine is handed, so the claude program can call 3pitor's tools.
export { serveTools } from './chat/mcp-endpoint/mcp-endpoint';

export interface ServerOptions {
  port: number;          // 0 = any free port
  development: boolean;
}

export interface StartedServer {
  readonly url: URL;     // no stop(): nothing stops the server today (F10)
}

export function startServer(engine: Engine, { port, development }: ServerOptions): StartedServer {
  const app = new Hono()
    .get('/api/health', (c) => c.json({ ok: true, workspace: engine.workspace, bun: Bun.version }))
    .route('/', workspaceConfigRoutes(engine.workspaceConfig))
    .route('/', documentRoutes(engine.documents))
    .route('/', sessionRoutes(engine.sessions))
    .route('/', viewStateRoutes(engine.viewState))
    .route('/', eventSocket(engine.events));
  const server = Bun.serve({
    port,
    // Bun bundles the React UI straight from its HTML entry point.
    routes: { '/': homepage },
    development,
    fetch: app.fetch,
    websocket,
    // Bun closes idle HTTP connections after 10s by default; agent turns can pause longer than that.
    idleTimeout: 255,
  });
  return { url: server.url };
}
```

The module has no side effects at load time and no top-level await.

#### `src/engine/engine.ts` (full surface and wiring)

```ts
// The engine: everything 3pitor does that is not HTTP or WebSockets. Server code reaches it only through this
// module; it knows nothing about requests, responses, status codes, SSE framing, or sockets.
import type { UIMessage, UIMessageChunk } from 'ai';
import type { ChatRequest, ClaudeMode, CurrentSession, DocumentEntry, FolderCount, HostEvent, ViewState } from '../shared/wire';
import { claudeBackend } from './chat/claude-backend/claude-backend';
import type { ServeTools } from './chat/claude-cli/claude-cli';
import { Sessions } from './chat/sessions/sessions';
import { countContents, createEntry, deleteEntry, listEntries, moveEntry, readDocument, watchDocuments, writeDocument } from './documents/documents';
import { EventBus } from './events/events';
import { loadViewState, saveViewState } from './view-state/view-state';
import { loadWorkspaceConfig } from './workspace-config/workspace-config';
import { chooseWorkspace } from './workspace/workspace';

export { DocumentError } from './documents/documents';
export type { McpServerEntry, ServeTools, ToolEndpoint } from './chat/claude-cli/claude-cli';

// agent-host.ts's AgentHostOptions, moved, plus the tool server.
export interface EngineOptions {
  workspace: string;
  model?: string;
  claude: ClaudeMode;      // how chat reaches Claude, decided once at startup
  maxSteps?: number;       // unset in production; DEFAULT_CHAT_MAX_STEPS applies
  serveTools: ServeTools;  // lends the turn's tools to the claude program; required
}

export interface StartOptions {
  target: string | undefined;  // the folder argument, if any
  claude: ClaudeMode;
  model?: string;              // cli passes process.env.MODEL
  serveTools: ServeTools;      // cli passes server's serveTools
}

export interface Engine {
  readonly workspace: string;
  readonly documents: {
    list(): Promise<DocumentEntry[]>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    create(path: string, kind: 'file' | 'folder'): Promise<void>;
    move(from: string, to: string): Promise<void>;
    count(path: string): Promise<FolderCount>;
    delete(path: string): Promise<void>;
    // all reject with DocumentError{reason: 'not-found' | 'invalid'} or another Error
  };
  readonly sessions: {
    // On a startEngine engine always valid (load() ran). On a createEngine engine valid only after create().
    current(): CurrentSession<UIMessage>;
    create(): Promise<string>;  // the new session's id
    // Throws synchronously (plain Error) for an unknown session or a turn already in progress; every later failure
    // arrives as an error chunk inside the stream. request.text is not checked (F26).
    chat(sessionId: string, request: ChatRequest): ReadableStream<UIMessageChunk>;
    cancel(sessionId: string): boolean;
  };
  readonly viewState: {
    load(): Promise<ViewState>;
    save(view: ViewState): Promise<void>;  // body not checked (F26)
  };
  readonly workspaceConfig: {
    names(): Promise<{ skills: string[]; agents: string[] }>;
  };
  readonly events: {
    subscribe(listener: (event: HostEvent) => void): () => void;  // no emit: server never publishes
  };
}

// Tests only: synchronous, no I/O. sessions.current() is valid only after sessions.create().
export function createEngine(options: EngineOptions): Engine {
  return wire(options).engine;
}

// Startup, in today's order. Resolves after load(), so the current session exists before anything serves (F22).
// No close(): nothing shuts the engine down today.
export async function startEngine({ target, claude, model, serveTools }: StartOptions): Promise<Engine> {
  const workspace = await chooseWorkspace(target);                 // reads WORKSPACE, cwd; may warn on stderr
  const { engine, events, sessions } = wire({ workspace, claude, model, serveTools });
  // Tells every open tab when something in the workspace changes on disk.
  watchDocuments(workspace, () => events.emit({ type: 'documents-changed' }));
  await sessions.load();
  const backend = claudeBackend(claude, serveTools);
  console.log(`3pitor chat: claude via ${backend.label}`);
  const warning = backend.startupWarning(process.env);
  if (warning) console.warn(`\n${warning}\n`);
  return engine;
}

function wire(options: EngineOptions) {
  const { workspace } = options;
  const events = new EventBus();
  const sessions = new Sessions(options, events);   // EngineOptions is assignable to SessionsOptions
  const engine: Engine = {
    workspace,
    documents: {
      list: () => listEntries(workspace),
      read: (path) => readDocument(workspace, path),
      write: (path, content) => writeDocument(workspace, path, content),
      create: (path, kind) => createEntry(workspace, path, kind),
      move: (from, to) => moveEntry(workspace, from, to),
      count: (path) => countContents(workspace, path),
      delete: (path) => deleteEntry(workspace, path),
    },
    sessions: {
      current: () => {
        const { id, uiMessages, abort } = sessions.current();
        return { id, messages: uiMessages, running: !!abort, claude: sessions.claude };
      },
      create: async () => (await sessions.create()).id,
      chat: (sessionId, request) => sessions.chat(sessionId, request),
      cancel: (sessionId) => sessions.cancel(sessionId),
    },
    viewState: { load: () => loadViewState(workspace), save: (view) => saveViewState(workspace, view) },
    workspaceConfig: {
      names: async () => {
        const config = await loadWorkspaceConfig(workspace);
        return { skills: config.skills.map((s) => s.name), agents: config.agents.map((a) => a.name) };
      },
    },
    events: { subscribe: (listener) => events.subscribe(listener) },
  };
  return { engine, events, sessions };
}
```

**How `wire` routes `serveTools`.** It travels from `StartOptions` to `EngineOptions`, then to `new Sessions(options)` (sessions.ts:107 already passes `this.options` to `agentSettings`), then to `AgentOptions`, then to `claudeBackend(options.claude, options.serveTools)` (agent.ts:61), then to `cliBackend(serveTools)`.

From there it reaches `chatModel` and `subagentModel`. Both call `claudeCliModel(id, tools, { webTools, serveTools })`, which calls `runClaude`, which calls `options.serveTools(...)`. The subagent path goes through the same `cliBackend` closure, which the validator confirmed.

`sessions.ts:141` changes to `page.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({ flush: () => recorded }))`, and `Sessions.chat` returns `ReadableStream<UIMessageChunk>`.

#### The tool-server types (engine-owned, in `src/engine/chat/claude-cli/claude-cli.ts`)

```ts
// One entry of the claude program's --mcp-config "mcpServers" map: how claude reaches the server that hosts this
// call's tools. Built by whoever serves the tools; must be JSON-serializable. The engine passes it through to claude
// unexamined, so the engine never names a transport, a host, or a URL.
export type McpServerEntry = Readonly<Record<string, unknown>>;

// The tools of one model call, being served to claude until stop().
export interface ToolEndpoint {
  readonly mcpServer: McpServerEntry;
  stop(): void;
}

// Starts serving one call's tools. Each tool runs in-process against the turn's copy; every call and result is
// reported through emit as a provider-executed tool-call / tool-result part.
export type ServeTools = (
  defs: LanguageModelV4FunctionTool[],
  tools: ToolSet,
  emit: (part: LanguageModelV4StreamPart) => void,
  abortSignal?: AbortSignal,
) => ToolEndpoint;
```

**What stays in the engine.** The server name `'3pitor'`, as the key in `mcpServers`, stays here. It is claude-CLI configuration, not transport: `claudeArgs` builds `mcp__3pitor__<Tool>` in `--allowedTools` (claude-cli.ts:167), and `stream-json.ts:35` finds the server by that name.

`stream-json.ts:34-37` reads claude's own `system/init` stream-json event. That event reports the connection status of each configured MCP server, and the code turns a non-`connected` status into an error. This is the MCP and claude-CLI protocol as claude reports it. It involves no HTTP: `status` there is an MCP server state, not an HTTP status. It stays in the engine unchanged.

#### `src/server/chat/mcp-endpoint/mcp-endpoint.ts`

```ts
// Lends 3pitor's tools to the claude program for one model call, over MCP's HTTP transport on a loopback port.
// Each tool runs here, in-process, against the turn's copy of the posts.
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { asSchema, type Tool } from 'ai';
import type { ServeTools } from '../../../engine/engine';

export const serveTools: ServeTools = (defs, tools, emit, abortSignal) => {
  const path = `/mcp/${crypto.randomUUID()}`;
  // call(...) and the Bun.serve({ hostname: '127.0.0.1', port: 0, fetch }) JSON-RPC handler: today's body, verbatim
  return {
    mcpServer: { type: 'http', url: `${server.url.origin}${path}` },  // the only place 'http' + URL are written
    stop: () => server.stop(true),
  };
};
```

In `mcp-endpoint.test.ts`, line 29 types `endpoint` as `ToolEndpoint` (imported from `engine.ts`), and line 38 returns `served.mcpServer.url as string`. The other 13 test bodies do not change.

#### Changes in claude-cli, claude-backend and agent

```ts
// claude-cli.ts
// - delete: import { serveTools } from './mcp-endpoint';     (claude-cli.ts:17)
type CliOptions = { webTools: boolean; serveTools: ServeTools };
export function claudeCliModel(modelId: string, tools: ToolSet, options: CliOptions): LanguageModelV4;
// runClaude(modelId, tools, options: CliOptions, call):
const endpoint = defs.length ? options.serveTools(defs, tools, emit, call.abortSignal) : undefined;     // :108
proc = Bun.spawn(['claude', ...claudeArgs(modelId, call.prompt, defs, options.webTools, endpoint?.mcpServer)], …); // :110
// cleanup still calls endpoint?.stop() (:87); emit still returns early once closed (:93).
function claudeArgs(modelId, prompt, defs, webTools, mcpServer: McpServerEntry | undefined): string[] {
  // …
  ...(mcpServer ? ['--mcp-config', JSON.stringify({ mcpServers: { '3pitor': mcpServer } })] : []),   // :174
}

// claude-backend.ts
export const apiBackend: ClaudeBackend = { /* unchanged */ };
export const cliBackend = (serveTools: ServeTools): ClaudeBackend => ({
  mode: 'cli',
  label: 'the claude program',
  startupWarning: (env) => (Bun.which('claude', { PATH: env.PATH ?? '' }) ? undefined : CLAUDE_NOT_FOUND_HELP),
  chatModel: (modelId, tools) => cliModel(claudeCliModel(modelId, tools, { webTools: true, serveTools })),
  subagentModel: (modelId, tools) => cliModel(claudeCliModel(modelId, tools, { webTools: false, serveTools })),
  providerTools: () => ({}),
});
export function claudeBackend(mode: ClaudeMode, serveTools: ServeTools): ClaudeBackend {
  return mode === 'api' ? apiBackend : cliBackend(serveTools);
}

// agent.ts
export interface AgentOptions { workspace: string; model?: string; claude: ClaudeMode; serveTools: ServeTools }
// agentSettings: const backend = claudeBackend(options.claude, options.serveTools);   (agent.ts:61)

// sessions.ts: SessionsOptions extends AgentOptions, so it inherits serveTools; no code change besides A18's :141.
```

#### Thin handlers

```ts
// src/server/documents/documents.routes.ts
export function documentRoutes(documents: Engine['documents']): Hono {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof DocumentError) return c.json<ApiError>({ error: error.message }, error.reason === 'not-found' ? 404 : 400);
    console.error(error);
    return c.text('Internal Server Error', 500);
  });
  app.get('/api/documents', async (c) => c.json<DocumentList>({ entries: await documents.list() }));
  app.get('/api/documents/:name', async (c) => {
    const name = c.req.param('name');
    return c.json({ name, content: await documents.read(name) });
  });
  app.put('/api/documents/:name', async (c) => {
    const { content } = await body(c, PutBody);          // zod; a shape failure throws DocumentError('invalid', …)
    await documents.write(c.req.param('name'), content);
    return c.json({ ok: true });
  });
  // create / move / count / delete: body(c, Schema) → documents.x(...) → c.json(...)
  return app;
}

// src/server/chat/sessions/sessions.routes.ts   (path unchanged; no flattening)
export function sessionRoutes(sessions: Engine['sessions']): Hono {
  const app = new Hono();
  app.get('/api/sessions/current', (c) => c.json<CurrentSession>(sessions.current()));
  app.post('/api/sessions', async (c) => {
    try {
      return c.json({ id: await sessions.create() }, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });
  app.post('/api/sessions/:id/chat', async (c) => {
    const { text, openFile, documents } = await c.req.json<{ text: string; openFile?: unknown; documents?: unknown }>();
    const open = typeof openFile === 'string' && openFile !== '' ? openFile : undefined;
    if (documents !== undefined && !isDocuments(documents)) {
      return c.json({ error: 'documents must map file names to markdown' }, 400);
    }
    try {
      return createUIMessageStreamResponse({ stream: sessions.chat(c.req.param('id'), { text, openFile: open, documents }) });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 409);
    }
  });
  app.post('/api/sessions/:id/cancel', (c) => c.json({ cancelled: sessions.cancel(c.req.param('id')) }));
  return app;
}

// src/server/events/events.routes.ts
export function eventSocket(events: Engine['events']): Hono {
  const app = new Hono();
  app.get('/ws/events', upgradeWebSocket(() => {
    let unsubscribe: (() => void) | undefined;
    return {
      onOpen: (_event, ws) => { unsubscribe = events.subscribe((event) => ws.send(JSON.stringify(event))); },
      onClose: () => unsubscribe?.(),
    };
  }));
  return app;
}
```

`viewStateRoutes(engine.viewState)` and `workspaceConfigRoutes(engine.workspaceConfig)` follow the same pattern.

#### Layout

```
src/cli/
  cli.ts                     entry point (new; process half of today's server.ts)
  cli.test.ts                was src/server/server.test.ts (5) + A63
  command-line.ts            moved verbatim
  command-line.test.ts       moved verbatim (15)

src/server/
  server.ts                  startServer, ServerOptions, StartedServer; re-exports serveTools
  scripts/check.ts           stays; spawns cli/cli.ts; imports engine paths + workspace
  chat/
    mcp-endpoint/
      mcp-endpoint.ts        moved from chat/claude-cli/; export const serveTools: ServeTools
      mcp-endpoint.test.ts   13 existing + 4 real round trips (A85)
    sessions/
      sessions.routes.ts     takes Engine['sessions']
      sessions.routes.test.ts  fakes Engine['sessions']; + 201 (A54) + 409 (A62); − derivation test (A55)
  documents/documents.routes.ts (+ .test.ts)
  events/events.routes.ts
  view-state/view-state.routes.ts (+ .test.ts)
  workspace-config/workspace-config.routes.ts (+ .test.ts)

src/engine/
  engine.ts                  was agent-host.ts + startup wiring from server.ts
  engine.test.ts             new: running/claude derivation (A55)
  paths.ts, paths.test.ts    moved from src/server/
  text-imports.d.ts          moved
  chat/
    agent/agent.ts, agent.test.ts, system-prompt.md
    claude-backend/claude-backend.ts, claude-backend.test.ts
    claude-cli/claude-cli.ts, claude-cli.test.ts, stream-json.ts, stream-json.test.ts
    components/
      fake-claude.ts           (A93 edit)
      fake-claude-on-path.ts
      test-model.ts
      stub-tool-server.ts      new (A84)
      chat-test-helpers.ts     new (A92)
    sessions/sessions.ts, sessions.test.ts
    tools/tools.ts, tools.test.ts
  components/json-file.ts (+ test), workspace-path.ts (+ test)
  documents/documents.ts, documents.test.ts
  events/events.ts
  view-state/view-state.ts
  workspace/workspace.ts, workspace.test.ts
  workspace-config/workspace-config.ts, workspace-config.test.ts, app-skills.macro.ts
```

`src/ui/` and `src/shared/` keep their layout; only the comment at `src/ui/app.tsx:2` changes (A91).

**Why the helpers sit in the engine.** `chat-test-helpers.ts` and `fake-claude-on-path.ts` are shared across the engine and server packages, but they use Bun APIs, so they can't live in `src/shared/` (which the browser imports). They sit in the lowest Bun-side scope that covers their users, and S3 makes that one direction explicit.

#### Build and test configuration

| File:line | Today | After |
|---|---|---|
| Makefile:1 | comment "Compiles the server and UI…" | names `src/cli/cli.ts` as the compiled entry |
| Makefile:11 | `… src/server/server.ts` | `… src/cli/cli.ts`, define unchanged |
| Makefile:29-30 | comment "Server tests run as plain Bun code… out of the server tests" | "cli, server and engine tests run as plain Bun code…" |
| Makefile:38 | `bun test src/server src/shared` | `bun test src/cli src/server src/engine src/shared` (target `test-server` kept) |
| package.json:6 | `bun run src/server/server.ts` | `bun run src/cli/cli.ts` (name `server` kept) |
| package.json:7 | `bun run src/server/scripts/check.ts` | unchanged |
| Makefile check-build (17-27) | greps "listening on", curls `/api/workspace-config`, checks `--version` | unchanged (the line is still printed, now by cli) |
| release.yml:41,47 | `make check-build`, `build/3pitor --version` | unchanged |
| .claude/skills/3pitor-release/scripts/preflight.sh:36 | `make test` | unchanged |
| tsconfig | covers `src/` | unchanged |
| README:17-21, :30, :33-48, :41, :46-48, :200 | four-package and server-entry text | per A59 |
| .claude/skills/update-code-structure/SKILL.md:39-48, :115-117 | three packages | per A66, its own commit |

### Invariants

These rules hold after the change, and a caller can rely on them.

1. **Startup order.** cli runs `commandLine()` first, then `startEngine`, then `startServer`. It then prints the "listening on" line and opens the browser.
   - `--version`, `--help` and parse errors exit before any filesystem I/O.
   - The engine prints its backend label and warning before the "listening on" line, so stdout order is unchanged (F32).
2. **Load before serve.** `startEngine` resolves only after `sessions.load()`. `GET /api/sessions/current` can never see an engine without a current session (F22). The A63 test proves it.
3. **Lifecycle.** `startEngine` runs once per process, and `startServer` runs once after it. Neither has a close or stop method, and nothing ever closes the document watcher.
   - On a `createEngine` engine (tests only), `sessions.current()` is valid only after `sessions.create()`.
   - `createEngine` is synchronous and does no I/O. Code in `src/server` and `src/cli` calls it only from `*.test.ts` files.
4. **`serveTools` is required.** It is a required field on `StartOptions`, `EngineOptions`, `AgentOptions` and `CliOptions`, and `SessionsOptions` inherits it. tsc rejects any call path that forgets it.
   - There is exactly one production implementation, server's `serveTools`.
   - There is exactly one test double, the engine's `stubToolServer`.
5. **Boundary rule (A60).** The engine knows nothing of HTTP or WebSockets:
   - It imports no hono, calls no `Bun.serve`, and uses no `Request` or `Response`.
   - It produces no HTTP status, no SSE framing and no socket objects.
   - It writes no HTTP transport detail. The `--mcp-config` entry is an opaque `McpServerEntry` built by server.
   - The engine's only HTTP client is `fetch` in `src/engine/chat/components/fake-claude.ts`, a test helper. It stands in for the external `claude` program, which really is an HTTP MCP client, and no engine production code runs it.
   - The engine may read env: `WORKSPACE` (workspace.ts:23); `PATH` and `ANTHROPIC_API_KEY` through `backend.startupWarning(process.env)` in `startEngine` (claude-backend.ts:63, :80); and `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, which it strips from claude's environment (claude-cli.ts:195).
   - The engine may print to stdout and stderr: workspace.ts:20-24, claude-backend.ts:32, stream-json.ts:70, json-file.ts:15, claude-cli.ts:195, and the `startEngine` label and warning.
6. **How failures are reported.** The engine reports failure only by throwing (rejecting), or as error chunks inside a returned stream. It never reports a status. Server alone maps failures to status codes.
7. **`sessions.chat` contract.** A synchronous throw means "refused" (unknown session or turn in progress), and server maps it to 409. Everything after the return comes in-stream, and the engine records and cleans up the turn itself.
8. **Endpoint cleanup.** `runClaude` calls `endpoint.stop()` exactly once per call that served tools, however the call ends. After cleanup, `emit` writes nothing, so a tool that finishes late adds no parts.
9. **Env.** cli reads argv, `MODEL`, `PORT`, `NODE_ENV` and `OPEN_BROWSER`. It also reads `ANTHROPIC_API_KEY` through `parseCommandLine(argv, process.env)` for `--claude=auto` (command-line.ts:31). Server reads no env. `scripts/check.ts` is a dev script, not part of the server runtime.

### Failure Behavior

The split changes no failure behavior on the wire. This is what each part does when it fails.

| Where | How it fails | Mapping / effect |
|---|---|---|
| `commandLine()` parse error | `parseCommandLine` throws | cli prints `3pitor: <msg>\n<USAGE>` to stderr and exits 2 |
| `--version` / `--help` | Does not fail | cli prints the text and exits 0, with no I/O |
| `startEngine` | Rejects (bad workspace, or unreadable state that throws) | The top-level await in cli is unhandled, so the process crashes, as today |
| `startServer` | `Bun.serve` throws (for example, a pinned PORT is in use) | The error is thrown from cli's top level, so the process crashes, as today |
| `documents.*` | `DocumentError{reason}` or another error | The sub-app `onError` answers `not-found` with 404 and `invalid` with 400 and JSON `{error}`. Any other error gets a text 500 |
| server `body()` shape failure | Server throws `DocumentError('invalid', …)` | The same `onError` answers 400 |
| `sessions.create` | Rejects | try/catch answers 500 with `{error}` |
| `sessions.chat`, synchronously | Plain `Error`: unknown session or running turn | try/catch answers 409 with `{error}` |
| `sessions.chat`, after it returns | `error` chunks inside the 200 stream | Server does nothing; the engine records and cleans up (F21) |
| malformed chat JSON | `c.req.json()` throws before the try block | Hono answers with a text 500 |
| `viewState.save` | Rejects | Server answers 500 with `{error}` |
| `viewState.load`, `workspaceConfig.names` | Rejects | Hono answers with a text 500 |
| `serveTools` throws (loopback `Bun.serve` fails) | Thrown inside `runClaude` before spawn, as today | `doStream` rejects, and the turn shows a model error chunk |
| claude cannot reach the endpoint | The init event reports a non-`connected` status (stream-json.ts:36-37) | The call fails before the stream starts with `claude could not reach 3pitor's tools (MCP server "3pitor" status: …)` |
| a tool finishes after the call stopped | `emit` runs after cleanup | The `closed` guard drops it, and nothing is printed |

### Test Plan

What moves, what gets rewritten, and what is new.

**Moves**
- `src/server/server.test.ts` moves to `src/cli/cli.test.ts`. It spawns `cli.ts` and has 5 tests.
- `src/server/command-line.test.ts` moves to `src/cli/` (15 tests).
- `src/server/paths.test.ts` moves to `src/engine/` (1 test). Its probe, `server/server.ts`, is unchanged.
- `src/server/chat/claude-cli/mcp-endpoint.test.ts` moves to `src/server/chat/mcp-endpoint/` (13 tests). Line 29 types `endpoint` as `ToolEndpoint`, and line 38 returns `served.mcpServer.url as string`.
- Every other engine-bound test moves with its file under `src/engine/`, and its relative imports are adjusted.

**Real round trips moved to server's `mcp-endpoint.test.ts` (A85).** Each one uses `fakeClaudeOnPath`, `chat-test-helpers`, and the real `serveTools`.
1. claude-cli.test.ts:145 is the Edit round trip and uses `withWorkspace`.
2. claude-cli.test.ts:267 is the slow tool followed by a stop. It uses `userCall`, `untilPid`, `eventually` and `spyOn(console,'error')`. The original also stays in the engine as a stub version (A86), so this move adds a test and removes none.
3. sessions.test.ts:470 now runs through `createEngine({ workspace, claude: 'cli', serveTools })`. It needs a local `beforeEach` workspace with `notes.md = '# Garden Plan\n'` (the same 3 lines as sessions.test.ts:19-27). It also needs `const id = await engine.sessions.create()`, `turn(engine.sessions, id, …)`, `editHeading`, and the roles assertion from A94.
4. sessions.test.ts:503 now runs through `createEngine(...)`, with `turn` and `replyText`.

**Engine rewrites (tsc-driven, about 24 edits; V5)**

| File | Edits |
|---|---|
| agent.test.ts | 5 edits: add `serveTools: stubToolServer().serveTools` at :25, :51, :72, :93 and :100 |
| claude-backend.test.ts | 12 edits. Add `const cli = cliBackend(stubToolServer().serveTools)` and change all 9 `cliBackend.` references to `cli.`. At :16-17, `claudeBackend('api', s)` is checked with `toBe` against `apiBackend`, and `claudeBackend('cli', s)` is checked by mode and label |
| claude-cli.test.ts | The 6 `claudeCliModel(` sites at :13, :35, :149, :170, :208 and :281 gain `serveTools`. Then :149 and the real :281 move to server, where they pass the real `serveTools`; the stub :267 in the engine passes the stub. The :167 assertion changes to check `STUB_MCP_SERVER` and `stops === 1`, and the helpers move to `chat-test-helpers.ts` |
| sessions.test.ts | 1 edit: `newSessions` at :45 adds `serveTools: stubToolServer().serveTools`. Lines :443-455 call `sessions.create()` and drop the :14 `sessionRoutes` import (A54). The helpers `turn`, `replyText` and `editHeading` are imported from `chat-test-helpers.ts`. The tests at :470 and :503 are removed because they moved |
| server.ts | 2 edits (`claudeBackend(claude)` and `createAgentHost`). They are moot because the file is rewritten |

**Server route tests**
- The documents, view-state and workspace-config tests build their engine with `createEngine({ workspace, claude: 'api', serveTools })`. They import `serveTools` from `../chat/mcp-endpoint/mcp-endpoint`.
- `sessions.routes.test.ts` uses fakes typed `Engine['sessions']`.

**New tests**
- `engine.test.ts` checks the derivation of `running: true` (a turn held open with test-model.ts) and `running: false`, plus the `claude` passthrough (A55).
- `sessions.routes.test.ts` gains two cases: a 201 with `{id}` (A54), and a synchronous chat throw that gives 409 (A62).
- `cli.test.ts` gains the load-before-serve test (A63).
- The engine gets a stub version of :267, which replaces the original in place (A86).

**Shared helpers (A92).** `src/engine/chat/components/chat-test-helpers.ts` holds `alive`, `eventually`, `untilPid`, `userCall`, `withWorkspace`, `turn`, `replyText` and `editHeading`. It is imported by claude-cli.test.ts, sessions.test.ts and server's mcp-endpoint.test.ts.

**Stub (A84)**

```ts
// src/engine/chat/components/stub-tool-server.ts
// Stands in for server's serveTools in engine tests: serves nothing, records every call, and counts stops.
export const STUB_MCP_SERVER = { stub: 'stub-tool-server' } as const;   // opaque, JSON-serializable, not HTTP
export interface StubToolServer {
  readonly serveTools: ServeTools;
  readonly served: ReadonlyArray<{ defs: LanguageModelV4FunctionTool[]; emit: (part: LanguageModelV4StreamPart) => void; abortSignal?: AbortSignal }>;
  readonly stops: number;
}
export function stubToolServer(): StubToolServer;
```

Tests that count calls or stops create their own `stubToolServer()`. Tests that don't care share one per file.

**fake-claude.ts (A93)**

```ts
const entry = config && JSON.parse(config).mcpServers['3pitor'];
const url: string | undefined = entry?.url;
print({ type: 'system', subtype: 'init', mcp_servers: entry ? [{ name: '3pitor', status }] : [] });
```

The "subagent gets no tools" test still sees no `--mcp-config` and an empty list.

**Expected counts per folder (`bun test` runner)**

| Folder | Runner count | How it is reached |
|---|---|---|
| src/cli | 21 | 5 + 15 + A63 |
| src/server | 40 | 22 route − 1 derivation + 201 + 409 + 13 mcp + 4 round trips |
| src/engine | 196 + D | grep 179 (182 − 3 moved out); +17 from documents.test.ts `test.each` expansion; D = engine.test.ts cases (≥ 2) |
| src/shared | 18 | unchanged |
| **Total** | 275 + D | 272 + A63 + 201 + 409 + duplicated :267 − moved derivation + D |
| UI | 446 | unchanged |

Unverified: the per-folder runner counts are worked out from `test(` greps plus the 255-vs-272 `test.each` gap, because tests were not run in this design-only round.

### Done When

The baseline is a passing type-check, 272 server and shared tests (23 files), and 446 UI tests (16 files), as recorded in update-code-structure-2026-10-01/change-log.md:145-146.

1. `make typecheck` passes with `serveTools` threaded through (§2.3 to §2.6).
2. `make test` passes, and Makefile:38 runs `src/cli src/server src/engine src/shared`.
3. Each folder passes when run alone. This proves no test depends on another file's global `mock.module` (documents.test.ts:135 mocks `node:fs/promises`, and test-model.ts:61 and sessions.test.ts:324 mock `@ai-sdk/anthropic`). The four commands are:
   - `bun test src/engine`
   - `bun test src/server`
   - `bun test src/cli`
   - `bun test src/shared`
4. The change log records the exact runner count per folder (expected: cli 21, server 40, engine 196 + D, shared 18; total 275 + D). Every baseline test is either still present or listed as moved or rewritten (A55, A85, A86, A87, A94).
5. `make check-build` passes on a binary built from `src/cli/cli.ts`. In that binary, `--version` prints `3pitor $(THREEPITOR_VERSION)` and all three app skills are served.
6. The A64 artifact script exits 0. It runs these checks:
   - **E1:** no match in `src/engine/**` for `from ['"](\.\./)+(server|cli|ui)/`, `from ['"]hono`, or `Bun\.serve\b`.
   - **A60:** no match in `src/engine/**` for any of these patterns: `\b(Request|Response)\b` (case-sensitive, so `ChatRequest` does not match); `createUIMessageStreamResponse`; `upgradeWebSocket`; `\bWebSocket\b`; `type: ['"]http['"]`. `\bfetch\(` may match only in `src/engine/chat/components/fake-claude.ts`. There is no bare `status` or `http` pattern: stream-json.ts:36-37 and help-text links are legitimate.
   - **S1:** every engine import in non-test `src/server` files ends in `engine/engine`.
   - **S2:** no file in `src/server` imports from `cli/`.
   - **S3:** server tests and check.ts import only the A45 modules.
   - **S4:** only `src/server/server.ts` imports `ui/index.html`.
   - **C1–C3:** the imports in `cli.ts` and `cli.test.ts` are as stated, and `src/cli` has no `hono` or `Bun.serve`.
   - **U1, H1:** both rules hold.
   - **A65:** no non-test file in `src/server` or `src/cli` contains `createEngine(`.
   - **A35:** neither `src/engine/paths.ts` nor `paths.test.ts` contains `src/server` text.
   - **server.ts:** it has no top-level `await`.
   - **Env:** no non-test file in `src/server` uses `process.env`, except under `scripts/`.
   - **Removed files:** none of `src/server/{server.test.ts, agent-host.ts, command-line.ts, paths.ts}` exists.
7. Manual check, done once: run `bun run server`, then `curl <url>/`. It must return HTML whose script chunk loads.
8. Manual check: `bun run check` needs a real key, and the change log records whether it ran.
9. `.claude/skills/update-code-structure/SKILL.md` is edited in its own commit and names `src/cli` and `src/engine`. The edit covers five packages with import directions, the same-name rule, the entry-point sentence, and the test-path warning (A66).
10. The README and the comments listed in A59 and A91 are updated. A grep for `server.ts` in `src/engine/**` comments finds nothing.

## Why Each Element Is Here

Each row cites one source: the goal (G1–G3), your direction (D1–D4), one of your later decisions, or a finding (N#, F#). Rows A24, A37, and A39 were dropped by your decisions and are listed after the table.

| # | Element | Justification |
|---|---|---|
| A1 | Package `src/engine/` | G3 "should move into an "engine" package" |
| A2 | `engine.ts` is the only engine module that server and cli production code import (`mcp-endpoint.ts` imports the `ServeTools` type from it) | D4; N5, N6 |
| A3 | `agent-host.ts` folded into `engine.ts` | N5, F5: it is the wiring point and only `server.ts` imports it |
| A4 | `startEngine` holds the startup wiring, receives `serveTools`, and has no `close()` | G3; F22; F10; "server hands the engine a serveTools function" |
| A5–A7 | `StartOptions` `target`, `claude`, `model?`, `serveTools`; `MODEL` read in `cli.ts` | your cli decision; server.ts:20,22,27 |
| A8 | `chooseWorkspace` moves verbatim and is called inside `startEngine`; it reads `WORKSPACE` and cwd and warns on stderr | G3; workspace.ts:20-24; A60 |
| A9 | The watcher bridge sits inside `startEngine` | N9; G3; D1–D3 |
| A10 | `startEngine` resolves only after `load()` | F22 |
| A11 | `startEngine` prints the backend label and warning before cli's "listening on" line | G3; F32 |
| A12 | `createEngine` is synchronous, does no I/O, is used only by tests, and takes `serveTools`. No non-test file in `src/server` or `src/cli` calls `createEngine(` | F30, N11; A80 |
| A13 | `EngineOptions` is `AgentHostOptions` (including `maxSteps`) plus a required `serveTools` | G3; A80 |
| A14 | `Engine.workspace` | F2, F32 (health body, "listening on" line) |
| A15 | `Engine.documents` exposes each domain function without its `workspace` argument. Its inputs are typed plain values, checked beforehand by server's zod schemas | D2; F2, F6, F7; F25 |
| A16 | `sessions.current()` returns `CurrentSession<UIMessage>` (wire type), derived in the engine | D4; N7, F22; sessions.ts:58-61 |
| A17 | `sessions.create()` returns the id | N7 |
| A18 | `sessions.chat` returns `ReadableStream<UIMessageChunk>`; sessions.ts:141 gets a typed `TransformStream` | F7; N7; D3 |
| A19 | `sessions.cancel` returns `boolean` | F7 |
| A20 | `viewState.load` and `save`; `save` receives the body unchecked | F2; F26 |
| A21 | `workspaceConfig.names()` | D4 |
| A22 | `events.subscribe` only, no `emit` | F7, N9; D1 |
| A23 | `DocumentError` re-exported as a value; server may construct it in `body()` | N8, F19 |
| A25 | Route factories keep their names and take engine slices | D2; F1, F30 |
| A26 | zod schemas and `body()` stay in the documents handler; `body()` throws `DocumentError('invalid', …)` | D2; F25; A23 |
| A27 | `openFile` coercion and `isDocuments` stay in the chat handler; chat text unchecked | D2; F25; F26 |
| A28 | Server's `onError` maps `DocumentError` to 404 or 400 | D3; F17, F18 |
| A29 | Server answers a failed session create with 500 and a refused chat with 409 | F17, F20, F32 |
| A30 | `createUIMessageStreamResponse` in server | D3; N7; A18 |
| A31 | Upgrade, `JSON.stringify`, `ws.send` in `events.routes.ts` | D1 |
| A32 | `/api/health` inline in `startServer` | F2; D1 |
| A33 | `Bun.serve`, `idleTimeout`, websocket, homepage, `/api/health` in server's `startServer`; "listening on" line and browser move to cli | D1; F11–F14; N19, N20 |
| A34 | `commandLine()` in `cli.ts`, before `startEngine` | your cli decision; N16, N17; V7 confirmed |
| A35 | `paths.ts` + test move to `src/engine/`; probe unchanged (`server/server.ts` still exists); fix paths.ts:2, paths.test.ts:6-7, README:46-48 | workspace.ts:4, app-skills.macro.ts:7; E1; N14 |
| A36 | `text-imports.d.ts` moves to `src/engine/` | G3; agent.ts imports `.md` as text |
| A38 | `scripts/check.ts` stays at `src/server/scripts/`; check.ts:87 spawns `join(SRC, 'cli/cli.ts')`; :6 → `'../../engine/paths'`; :7 → `'../../engine/workspace/workspace'` | N14; F14; package.json:7 unchanged |
| A40 | The engine keeps today's feature and component folders | G3 |
| A41 | Server keeps feature-named route folders | N12; README:20-21 |
| A42 | No flattening: `server/chat/sessions/sessions.routes.ts` stays; `server/chat/mcp-endpoint/` added | README:22-24 (server chat now has two components) |
| A43–A49 | Import rules E1–E2, S1–S4, C1–C3, U1, H1 (§1) | D3; N6; N10, N11; F13; wire.ts:1-2; your decisions |
| A45 | S3: server tests and `check.ts` may import from the engine only `SRC` (paths), `stateFile` (components/json-file), `dataDir` and `resetWorkspace` (workspace/workspace), `fileTools`, `turnTexts`, `editedTexts` (chat/tools/tools), `claudeCliModel` (chat/claude-cli/claude-cli), `fakeClaudeOnPath` (chat/components/fake-claude-on-path), and every export of `chat/components/chat-test-helpers.ts`; `Sessions` is **not** allowed | N11, N24; A85; A92; V3 |
| A49 | Server production code may import `ai` / `@ai-sdk/provider` only in `sessions.routes.ts` and `mcp-endpoint.ts` | D3, N7; "Move it to server" |
| A50 | `startEngine` runs once, then `startServer`; neither has a close or stop method | F22; F10 |
| A51 | On a `createEngine` engine, `current()` is valid only after `create()` | sessions.ts:58-61 |
| A52 | Nothing ever closes the watcher | F10 |
| A53 | The engine reports failure only by throwing or by in-stream chunks, and never reports a status | D3; F21 |
| A54 | sessions.test.ts:443-455 calls `sessions.create()` instead of going through `sessionRoutes` (removes the :14 import); a new `sessions.routes.test.ts` case asserts 201 `{id}` | N10; F32; E1 |
| A55 | `sessions.routes.test.ts` uses hand-written fakes typed `Engine['sessions']`; the `running`/`claude` derivation test moves to `engine.test.ts`, holding a turn open with test-model.ts (as sessions.test.ts:286-292) for `running: true` and keeping `running: false` | N7; D4 |
| A56 | Route tests import `stateFile` and `SRC` from the engine (S3) | N11 |
| A57 | Documents, view-state and workspace-config route tests use `createEngine({ workspace, claude: 'api', serveTools }).<slice>` on a real temp workspace, with server's real `serveTools` (never invoked in api mode) | F30; A80 |
| A58 | Makefile:38 → `bun test src/cli src/server src/engine src/shared` (target name `test-server` kept) | N13; SKILL.md:115-117 |
| A59 | README rewritten for five packages: README:17-21 (packages), :30 (the "Entry points stay at their package root" sentence: the one entry point is `src/cli/cli.ts`), :33-48 (server section split into cli, server and engine sections), :41 (server.test.ts → cli.test.ts beside cli.ts), :46-48 (paths.ts), :200 (`make test-server` runs src/cli, src/server, src/engine, src/shared) | N12, N14; V6 |
| A60 | Boundary rule (Invariant 5): no hono, no Bun.serve, no Request/Response, no status, no SSE framing, no sockets, no HTTP transport detail in `src/engine`; the only HTTP client is `fetch` in the test helper `fake-claude.ts`, a stand-in for the external claude program; env reads and printing allowed as listed; no exception for production code | D3; "Move it to server"; V2; V12 |
| A61 | Contract: `sessions.chat` throws synchronously (plain Error) for an unknown session or a turn in progress; later failures arrive as error chunks | N7; sessions.ts:81-82; F21 |
| A62 | New `sessions.routes.test.ts` case: the fake chat throws synchronously → 409 `{error}` | A61; F20, F32 |
| A63 | New load-before-serve spawn test in `src/cli/cli.test.ts`: temp `WORKSPACE`, no model; after "listening on", `GET /api/sessions/current` → 200 with a non-empty id | F22; A10, A50 |
| A64 | Repeatable artifact script in `docs/changes/server-engine-split/artifacts/` (precedent: cross_feature.py), not a permanent test. It checks E1–H1, A60 with the exact patterns in §9, A65, A35, no top-level await in `server.ts`, no `process.env` in non-test `src/server` outside `scripts/`, and that `src/server/server.test.ts`, `agent-host.ts`, `command-line.ts` and `paths.ts` no longer exist under `src/server/` | A43–A49; N22; V2 |
| A65 | Server and cli production code call `startEngine` and never `createEngine` | A12 |
| A66 | Edit `.claude/skills/update-code-structure/SKILL.md` in its own commit: five packages with import directions (SKILL.md:39-40), the same-name-across-packages rule extended to cli, server, engine, ui (:41-42), entry-point sentence names `src/cli/cli.ts` (:48), and the test-path warning (:115-117) names `src/cli` and `src/engine` as folders `make test` must discover | your answer "Update in this change"; N12; V6 |
| A67 | New package `src/cli/` | your words: "create a separate package … call this one "cli"" |
| A68 | Entry point `src/cli/cli.ts` at the package root | your words: "when i call `3pitor` … the "cli" will be invoked"; README entry rule |
| A69 | `command-line.ts` + test move to `src/cli/` verbatim (VERSION, USAGE, `declare THREEPITOR_VERSION`) | your cli decision; N16, N17 |
| A70 | cli runs in this order: parse, print and exit (for `--version` and `--help`), `startEngine`, `startServer`, the "listening on" line, the browser | your words: "it is what will create an instance of "engine" and pass that into the "server" constructor"; N16 |
| A71 | cli reads argv, MODEL, PORT, NODE_ENV, OPEN_BROWSER (and ANTHROPIC_API_KEY through `parseCommandLine`, command-line.ts:31); server reads no env; the engine still reads WORKSPACE (workspace.ts:23), PATH and ANTHROPIC_API_KEY (claude-backend.ts:63, :80, through `startupWarning(process.env)`), and strips ANTHROPIC_* (claude-cli.ts:195), as A60 permits | your cli decision; D4; V12 |
| A72 | cli prints the "listening on" line from `url.origin` and `join(engine.workspace)`, format unchanged | F32; N15 |
| A73 | Browser opening in cli, code unchanged | N21 |
| A74 | `server.ts` exports factory `startServer(engine, options): StartedServer`; no side effects at load time | your decision "Factory: startServer"; N22 |
| A75 | `ServerOptions = { port: number; development: boolean }` | server.ts:43,46; A71 |
| A76 | `StartedServer = { readonly url: URL }`, no `stop()` | A72, A73; F10 |
| A77 | The `homepage` import stays in `server.ts` | N20; V8 confirmed (compiled and dev, real app) |
| A78 | Engine-owned `ServeTools`, `ToolEndpoint { mcpServer: McpServerEntry; stop() }`, `McpServerEntry = Readonly<Record<string, unknown>>` in claude-cli.ts, re-exported from engine.ts | D3; "server hands the engine a serveTools function"; V2 (the engine no longer writes `type: 'http'` or a URL) |
| A79 | `mcp-endpoint.ts` + test move to `src/server/chat/mcp-endpoint/` as `export const serveTools: ServeTools`, returning `mcpServer: { type: 'http', url }` | "Move it to server"; N24; V2 |
| A80 | `serveTools` required on StartOptions, EngineOptions, AgentOptions, CliOptions; SessionsOptions inherits it; no Sessions code change | N23; tsc enforces the wiring |
| A81 | `claudeBackend(mode, serveTools)`; `cliBackend` becomes a factory; `apiBackend` stays a constant | N23 |
| A82 | `claudeCliModel` options gain `serveTools`; `runClaude` calls `options.serveTools` and passes `endpoint.mcpServer` unexamined to `claudeArgs`, which writes `{ mcpServers: { '3pitor': mcpServer } }`; the `./mcp-endpoint` import is deleted | N23; A60; V2 |
| A83 | `server.ts` re-exports `serveTools`; cli imports it from `../server/server` and passes it to `startEngine` | your cli decision; cli is the only package that holds both |
| A84 | Engine test double `src/engine/chat/components/stub-tool-server.ts`: `stubToolServer()` returns `{ serveTools, served, stops }`. Each `serveTools` call records `{ defs, emit, abortSignal }` in `served` and returns `{ mcpServer: STUB_MCP_SERVER, stop }`; `stop` increments `stops`. `STUB_MCP_SERVER` is a fixed, non-HTTP, JSON-serializable object. Tests can call a recorded `emit` after cleanup. No HTTP. | E1; A80; V4 |
| A85 | Real round trips move to server's `mcp-endpoint.test.ts`: claude-cli.test.ts:145 (Edit round trip) and :267 (slow tool, then stop) drive `claudeCliModel(..., { webTools, serveTools })` with the real `serveTools`; sessions.test.ts:470 and :503 are rewritten through `createEngine({ workspace, claude: 'cli', serveTools }).sessions` | fake-claude.ts:49-56 (`call <Tool>` needs a real endpoint); E1 |
| A86 | Engine tests on the stub. claude-cli.test.ts:167 asserts `JSON.parse(--mcp-config)` equals `{ mcpServers: { '3pitor': STUB_MCP_SERVER } }` and that the local stub's `stops` is 1 after the call. :204 is unchanged in behavior. A stub-based version of :267 stays in the engine: tool defs + `hang`, abort, drain; then calling the recorded `emit({type:'tool-result',…})` must not throw and adds no part; no `console.error`; `stops === 1`. claude-backend.test.ts:16-17 check mode and label instead of `toBe(cliBackend)`, and the file uses `const cli = cliBackend(stubToolServer().serveTools)` for its 9 `cliBackend.` references. | A81, A84; V2, V4, V5 |
| A87 | `server.test.ts` moves to `src/cli/cli.test.ts`. Its 5 tests spawn `join(import.meta.dir, 'cli.ts')` and keep `import { USAGE } from './command-line'`. No `server.test.ts` remains | N14, N16 |
| A88 | Makefile:11 entry `src/cli/cli.ts`, `--define THREEPITOR_VERSION` unchanged | N14, N22; verified experiment |
| A89 | package.json:6 `"server"` → `WORKSPACE=src/.data/workspace bun run src/cli/cli.ts`; script name kept | N14 |
| A90 | check-build target, release.yml:41,47, preflight.sh:36 (`make test`), tsconfig unchanged | N15 |
| A91 | Stale comments updated: claude-backend.ts:2 ("agent.ts and server.ts" → "agent.ts and the engine's startup"); agent-host.ts:1-2 (folded into engine.ts's header); documents/documents.ts:2 ("documents.routes.ts maps…" → "server's documents routes map…"); components/workspace-path.ts:1 ("the documents routes" → "documents.ts"); workspace-config/workspace-config.ts:3 ("The workspace-config route lists them" → "the engine's workspaceConfig.names() lists them"); src/ui/app.tsx:2 ("the way src/server/server.ts does for the server" → names server.ts's startServer); Makefile:1 ("Compiles the server and UI" → names cli as the entry); Makefile:29-30 ("Server tests…" → "Bun-side tests (cli, server, engine)"; the validator cited :34, which at HEAD is the `typecheck:` target line) | A59; V2, V6 |
| A92 | Shared test-helper module `src/engine/chat/components/chat-test-helpers.ts` exporting `alive`, `eventually`, `untilPid`, `userCall`, `withWorkspace` (from claude-cli.test.ts:135-143,195-252) and `turn`, `replyText`, `editHeading` (from sessions.test.ts:33-43,91,487). `turn` takes a structural `{ chat(sessionId: string, request: ChatRequest): ReadableStream<UIMessageChunk> }`, so both `Sessions` and `Engine['sessions']` fit. | Rule of three: used by claude-cli.test.ts, sessions.test.ts (engine) and mcp-endpoint.test.ts (server); V3; precedent `fakeClaudeOnPath` |
| A93 | fake-claude.ts:45-47 lists the `'3pitor'` MCP server in its init event whenever `--mcp-config` has a `'3pitor'` entry; `url` stays `entry.url`, read only by `call <Tool>`. Its `fetch` (:50) stays: the only HTTP client in `src/engine`, in a test helper that fakes the external claude program. | :204 "mcp down" needs the server listed with the stub's URL-less entry; A60; V2 |
| A94 | sessions.test.ts:483's ModelMessage-roles assertion, moved with :470 to server, reads the stored record: `JSON.parse(await Bun.file(stateFile(workspace, 'session.json')).text()).messages.map((m) => m.role)` equals `['user', 'assistant']` | V3. Keeps S3 without `Sessions`; asserts the same ModelMessage history (sessions.ts:121 sets it; the record is saved before the page stream's flush resolves, sessions.ts:141,150-151; precedent `stored()` at sessions.test.ts:368) |

**The V3 choice (A94).** The validator offered two routes, and A94 takes the first: stay on the `Engine` surface and don't widen S3. It reads the roles from the persisted record rather than from `engine.sessions.current().messages`.

- **Why not UI roles.** UI roles are weaker. `record()` pushes a UI assistant message for every turn, including failed and stopped ones (sessions.ts:150), while `messages` is set only for a completed turn (sessions.ts:121). So UI roles of `['user', 'assistant']` don't prove the turn completed.
- **Why not `Sessions` in S3.** It would let server tests depend on an engine class with mutable internals, with no other server test needing it.

If you prefer the literal option 1, the assertion becomes `engine.sessions.current().messages.map((m) => m.role)`, which accepts that weakening.

Unverified: the flush ordering behind A94 was confirmed by reading sessions.ts, not by running the test, because this is a design-only round.

### Rows dropped by your decisions

| # | Was | Dropped by |
|---|---|---|
| A24 | engine re-exports `parseCommandLine`, `USAGE`, `VERSION` | your cli decision (command line belongs to cli, A69) |
| A37 | `mcp-endpoint.ts` stays in the engine | your decision "Move it to server" (replaced by A79) |
| A39 | `command-line.ts` moves to the engine | your cli decision (replaced by A69) |

## Options Considered

The architect produced three options. All three follow your direction and keep the wire contract unchanged. The full
sketches are in [design-options.md](./design-options.md); its Option A rows are superseded by the element table above.

### Option A: one engine entry point with a namespace per feature — chosen

Server reaches the engine only through `engine.ts`. `startEngine` runs the startup wiring, and each route factory takes
only its own slice of the `Engine`, such as `engine.documents`. Handlers still check request shape before forwarding.
You chose it because handlers forward to one object and the engine's internals never reach server. Later decisions
added `cli` and moved the MCP endpoint, but the shape of the engine stayed the same.

### Option B: per-feature engine modules with no entry point — rejected

Routes would import engine feature folders directly and keep today's `workspace`, `Sessions`, and `EventBus`
parameters. It was the smallest move, but server would still mirror the engine's folder layout (N5, N6) and could still
publish engine events.

### Option C: one entry point, with the engine validating raw request bodies — rejected

Handlers would forward the raw JSON body, and the engine would validate it and throw one `EngineError` for server to
map. The engine's signatures would weaken to `unknown`, and checking a body's shape is extracting information from the
HTTP call, which your direction gives to the handler.

## Questions Resolved

These came from the architect's open questions, the junior developer's 17 questions, and the follow-up questions after
the `cli` decision. Answers marked "your decision" are quoted from the pairing record.

| # | Question | Answer | Source |
| --- | --- | --- | --- |
| P1 | What does server hold when it calls the engine? | The endpoints and all WebSocket code; handlers extract and forward; the engine knows nothing of HTTP or WebSockets | Your decision (direction quoted above) |
| P2 | Which contract shape? | Option A, one engine entry point | Your decision |
| P3 | May `mcp-endpoint.ts`'s loopback HTTP server stay in the engine? | No: "Move it to server" | Your decision |
| P4 | Where does `command-line.ts` live? | In a new `cli` package that creates the engine and passes it to the server | Your decision |
| P5 | Factory or class for the server? | "Factory: startServer" | Your decision |
| P6 | Where do the four MCP round-trip tests live? | "Move to server" | Your decision |
| P7 | Does this change edit `.claude/skills/update-code-structure/SKILL.md`? | "Update in this change", in its own commit (A66) | Your decision |
| Q1 | Does the chat stream's type check anything? | Only through `any` before; `Sessions.chat` now returns `ReadableStream<UIMessageChunk>` (A18) | Junior's `tsc` run |
| Q2 | Is `mcp-endpoint.ts` HTTP inside the engine? | Yes; moved to server (A79) | P3 |
| Q3 | May the engine read the environment and print? | Yes; your direction limits the engine's ignorance to HTTP and WebSockets (A60, A71) | D3; existing engine code |
| Q4 | What proves the change is done, with which test counts? | The done-when list, with per-folder counts | Last restructure's baseline-count rule |
| Q5 | Does moving `paths.ts` break its test or the macro? | No; the stale comments get fixed (A35) | Junior's run; `SRC` resolves to `src/` |
| Q6 | Do `check.ts` and the spawn tests still find the entry? | They now spawn `cli/cli.ts` (A38, A87) | N14 |
| Q7 | Does the engine's printing break the `listening on` parse? | No; the order is unchanged | F32 |
| Q8 | Can `createEngine` drift from `startEngine`? | Production calls `startEngine` only, checked by the A64 script; A63 pins load-before-serve | F22 |
| Q9 | How does the moved `running` test get a running turn? | It holds a turn open with the scripted test model (A55) | `sessions.test.ts:286-292` |
| Q10 | What does `current()` do before anything is loaded? | Valid only after `create()` on a `createEngine` engine; the name and wire type stay (A16, A51) | `sessions.ts:58-61` |
| Q11 | Are the engine's input types honest? | Only for documents and the chat's `documents` and `openFile`; `viewState.save` and chat `text` arrive unchecked (A20, A27) | F26 |
| Q12 | Who builds the engine in route tests? | `createEngine` on a real temp workspace for documents, view-state, and workspace-config; hand-written fakes for sessions (A55, A57) | F30 |
| Q13 | Is `Engine.workspace` a domain concern? | It stays, for the health body and the `listening on` line (A14) | F2, F32 |
| Q14 | Why no import-rule check? | There is one: the repeatable A64 artifact script | Last restructure's `cross_feature.py` |
| Q15 | What happens to the skill's three-package rules? | Updated in this change (A66) | P7 |
| Q16 | Why two options types? | `EngineOptions` moves verbatim and `StartOptions` covers startup; `maxSteps` stays unset in production | G3 |
| Q17 | Does the 409 depend on `chat` throwing synchronously? | Yes; now part of the contract and pinned by a test (A61, A62) | F20 |
| O5 | What does the server constructor take and return? | `startServer(engine, { port, development })` returns `{ url }` and calls `Bun.serve` itself (A74–A76) | D1; P5 |
| O6 | Who prints the `listening on` line and opens the browser? | `cli` (A72, A73); the engine still prints the backend label (A11) | N21; F32 |
| O7 | How does `serveTools` reach the claude CLI code? | `cli` passes server's `serveTools` into `startEngine`; it travels in the options (A78–A83) | N23; P3, P4 |
| O8 | Where do `paths.ts` and `check.ts` go? | `paths.ts` to the engine; `check.ts` stays in server and spawns `cli/cli.ts` (A35, A38) | N14 |

## Validation Findings

The adversarial validator worked in a scratch copy of the repo. It built a compiled binary from a non-server entry and
ran it in both production and development mode. It also applied the `serveTools` threading and ran `tsc`.

| # | Finding | Disposition | What changed or why it does not hold |
| --- | --- | --- | --- |
| V1 | The design in the repo described the superseded layout; the amendments lived outside it | Accepted | This document is self-contained, and `design-options.md` is marked superseded |
| V2 | "No HTTP in the engine" was overstated: the engine wrote `{ type: 'http', url }`, and five comments still named routes | Accepted | Server now builds the whole MCP config entry and the engine passes it through (A78, A79, A82). A60 was reworded, the A64 patterns were made precise, and A91 covers the comments. `fake-claude.ts`'s `fetch` is named as the one test stand-in (A93) |
| V3 | The four moved round-trip tests lost a model-history assertion and their helpers | Accepted | Shared helpers (A92); the assertion reads the stored session record (A94) |
| V4 | Moving the slow-tool test lost engine coverage of the stop guard | Accepted | A scripted stub (A84) and a stub version of the test stay in the engine (A86) |
| V5 | The test-edit counts were wrong | Accepted | About 24 edits, listed file by file in the test plan |
| V6 | Missed comments, README lines, Makefile comments, and no done-when item for the skill edit | Accepted | Added to A59, A91, and done-when 9 |
| V7 | `--version` might run after I/O when `cli` imports server and engine | Rejected; the design holds | Nothing does I/O at import time; a compiled binary printed the version correctly |
| V8 | The page import from a non-entry module was only checked in a toy project | Confirmed | It works in the real app, compiled and in development mode |
| V9 | `fakeClaudeOnPath`'s copy-from-own-folder might break | Rejected; the design holds | The two files move together |
| V10 | Which tests really need a real MCP endpoint | Confirmed | Four, as the design said |
| V11 | Global `mock.module` calls could hide cross-file dependence | Accepted | Done-when 3 runs each folder alone |
| V12 | A71 understated what the engine reads from the environment; `check.ts` might belong in `cli` | Accepted in part | A71 reworded. `check.ts` stays in server: it drives server's API, and moving it changes `package.json` for nothing |
| V13 | Some claims were single-sourced from agent reports | Confirmed | The validator re-verified the claims the design rests on |

## Cut List

Each entry is something this change could carry but the goal did not ask for. You can reinstate any of them, and your
direction becomes its justification.

- **Listening on 127.0.0.1 only, with Host and Origin checks (F28)** — cut because the exposure predates the split and
  fixing it changes behavior, so it belongs in its own change. `startServer` is now the single place to add it.
- **Blocking paths on another Windows drive (F29)** — cut because it is an engine bug unrelated to the split.
- **One app-level `onError` that answers JSON everywhere (F17)** — cut because it changes the wire.
- **A 404 instead of a 409 for an unknown chat session (F20)** — cut because it changes the wire and would need a typed
  chat error first.
- **A typed `ChatError` or `EngineError`** — cut because nothing needs it: "any synchronous throw means 409" matches
  today's behavior exactly.
- **A server-owned `RequestError`, so `body()` stops throwing `DocumentError` (N8)** — cut because it has no wire effect,
  and server constructing an engine error runs in the allowed direction (A23).
- **A 400 instead of a text 500 for malformed chat JSON (F20)** — cut because it changes the wire.
- **Validating chat `text` and the view-state body (F26)** — cut because it changes behavior.
- **Hiding raw `error.message` in 500 responses (F27)** — cut because it changes response bodies.
- **Isolating event listeners, adding a WebSocket `onError`, and checking `ws.send` (F23)** — cut because it changes
  behavior.
- **Adding `/api/workspace-config` and `/api/health` to the README endpoints table (F33)** — cut because the gap
  predates the split.
- **Shared URL constants (F9) and named wire types for the untyped bodies (F8)** — cut because they touch the UI and
  tests on both sides, and the contract holds without them.
- **An engine-owned `SessionSnapshot` type** — cut because it would have the same structure as `CurrentSession`.
- **`Engine.close()`, `StartedServer.stop()`, and in-process `startServer` tests** — cut because nothing shuts down
  today.
- **A permanent test that enforces the import rules** — cut because the A64 artifact script does the job and no need
  for more has been shown.
- **Removing `ai` from server entirely** — cut because SSE framing is HTTP work and belongs in server.
- **Renaming `sessions.routes.ts` to `chat.routes.ts`, per-feature `index.ts` barrels, or flattening
  `server/chat/sessions/`** — cut as churn; `engine.ts` already gives server one import path.
- **Dropping the unused `maxSteps` option** — cut because the move is verbatim.
- **A `ServeTools` port with several implementations, or a registry** — cut because there is one implementation plus
  one test stub.
- **An optional `serveTools` that fails at run time when missing** — cut because a required field that `tsc` checks is
  strictly safer.
- **A typed `McpServerEntry` union (http, stdio, sse)** — cut because the engine must not know transports (A60), and
  there is one producer.
- **An HTTP-free `fake-claude.ts`** — cut because it fakes an outside program that really speaks MCP over HTTP, and the
  real round-trip tests need that.
- **Allowing `Sessions` in rule S3, or adding `get(id)` or model history to `Engine['sessions']`** — cut because A94
  covers the one assertion that needed it, through `stateFile`.
- **Letting engine tests import server's MCP endpoint as an exception to rule E1** — cut by your decision, "Move to
  server" (A85).
- **A separate `cli/browser.ts` module** — cut because it is one small function with one caller.
- **`cli` passing `{ fetch, websocket }` to its own `Bun.serve`** — cut because it would put WebSocket code in `cli`.
- **Server reading `PORT` and `NODE_ENV` itself** — cut because reading the environment is `cli`'s job (A71).
- **Moving `check.ts` to `src/cli/scripts/`** — cut because it drives server's API, and moving it would change
  `package.json:7` for nothing.
- **Renaming the `server` npm script or the `test-server` Makefile target** — cut as churn.
- **A curl of `/` inside `make check-build`** — cut because the one-time manual check (done-when 7) covers it.
- **A class, `new Server(engine, options).start()`** — cut by your decision, "Factory: startServer".

## Open Risks

- **The network exposure stays (F28).** The server listens on every network interface and checks neither Host nor
  Origin. It matters whenever 3pitor runs on a shared network or while you browse untrusted sites. After this change,
  `startServer` is the single place to add the fix.
- **`tsc` has not run on the final shape.** The validator type-checked the `serveTools` threading. Three things are
  still unchecked: the `McpServerEntry` assignability, the structural `turn` helper, and `startServer` and `startEngine`
  as written. Done-when 1 is the gate.
- **The test counts are derived, not measured.** They come from greps plus the `test.each` gap (255 by grep against 272
  from the runner). Done-when 4 records the real numbers.
- **Mock leakage within one folder.** Running each folder alone proves no cross-folder dependence. It doesn't stop a
  future file from relying on a `mock.module` call in another file of the same folder.
- **A94 relies on save ordering.** The stored-record assertion depends on `record()` saving before the page stream's
  flush resolves (`sessions.ts:141, 150-151`). The existing `stored()` helper at `sessions.test.ts:368` relies on the
  same ordering.
- **The fake `claude` now lists the 3pitor server in more tests (A93).** Every engine test that offers tools sees it as
  `connected`. No current test asserts the opposite, but the change log should say so.
- **`bun run check` needs a real key.** The chat and SSE paths against a live Claude backend are checked only by hand
  (done-when 8).

## Evidence

The numbered findings are in [context-brief.md](./context-brief.md): N1–N13 from the first discovery pass and N14–N24
from the `cli` update. Findings F1–F33 come from the earlier
[split-api-package context brief](../split-api-package/context-brief.md). The options round is in
[design-options.md](./design-options.md). Your answers at every stop are recorded word for word in
`.han/pairing/server-engine-api-2026-10-02.md`.

## Next Step

This document is the input to a `tdd` run that implements the contract. Start from the baseline counts, make
`.claude/skills/update-code-structure/SKILL.md` its own commit, and finish when every done-when item passes.

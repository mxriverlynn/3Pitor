# Design Options: The `server` → `engine` Boundary

> **Superseded in part.** You chose Option A, and later decisions added a `cli` package and moved `mcp-endpoint.ts` to
> server. [api-design.md](./api-design.md) holds the final contract. Its element table replaces this document's Option A
> rows, and rows A24, A37, and A39 here were dropped.

This is the architect's options round. It cites findings N1–N13 and open items O1–O4 from
[context-brief.md](./context-brief.md), and F1–F33 from the earlier
[split-api-package context brief](../split-api-package/context-brief.md), whose code facts still hold.

## The goal and the owner's direction

Every justification below quotes one of these or cites a finding.

- **G1** "i want "server" to be the package where the HTTP and Websocket code lives."
- **G2** "it's the main entry point for the backend services."
- **G3** "all code that isn't HTTP API and web socket API should move into an "engine" package"
- **D1** "the server holds the http API endpoints, and holds the entirety of the web sockets code."
- **D2** "each route handler or websocket handler will do as little as possible to extract required information from
  the http call or the websocket call, and forward all relevant information to the engine."
- **D3** "the engine must not know anything about http or websockets."
- **D4** "think of it like "thin controller, thick domain layer" where the http and websocket handling code is as thin
  as possible and forwards all requests to the engine, once the necessary info has been extracted."

All three options keep the wire contract unchanged: URLs, status codes, bodies, the SSE stream, `/ws/events` frames,
and the `listening on` line (F32).

## Facts the options depend on

The architect checked these in source:

- **The chat stream's type.** `Sessions.chat` returns a bare `ReadableStream` whose content is AI SDK `UIMessageChunk`s
  (`sessions.ts:79-149`). `createUIMessageStreamResponse` requires `ReadableStream<UIMessageChunk>`
  (`node_modules/ai/dist/index.d.ts:6281`).
- **No current session before load.** `Sessions.current()` returns `undefined` until `load()` or `create()` has run
  (`sessions.ts:63-65`). Its tests assert the raw `{id, messages, uiMessages}` shape (`sessions.test.ts:432,440`), so
  any snapshot must be a new projection.
- **Who uses agent-host.** Only `server.ts` imports `agent-host.ts`.
- **The command line runs first.** `server.test.ts:29-30` asserts that `--version` exits before a `WORKSPACE` folder is
  created, so the command line is handled before workspace selection.
- **`paths.ts` can move into the engine.** It computes `SRC = resolve(import.meta.dir, '..')`, which yields `src/` from
  any `src/<package>/` folder. `paths.test.ts` passes unchanged from `src/engine/`.
- **The route test fakes.** `sessions.routes.test.ts` fakes `Sessions` with `as unknown as Sessions` and asserts
  `running: !!abort` (`:48-57`). No server test covers the 201 from `POST /api/sessions`.

## Option A (recommended): one engine entry point with a namespace per feature, and handlers that check request shape

The engine has one public module, `src/engine/engine.ts`, which replaces `agent-host.ts`. Server production code
imports from the engine only through that module.

- **Startup.** `startEngine(options)` runs the startup wiring: `chooseWorkspace`, host creation, the watcher bridge,
  `load()`, and the backend label and warning. `createEngine(options)` is the synchronous, no-I/O version for route
  tests.
- **What the handler does.** It extracts and shape-checks the request: the zod body schemas, `body()`, the `openFile`
  coercion, and `isDocuments` stay in server (F25). Then it calls the engine with typed plain values.
- **Failures.** The engine signals failure by throwing. Server alone maps errors to status codes, exactly as today
  (F17), including 409 for an unknown session.
- **Chat.** The engine returns a `ReadableStream<UIMessageChunk>`, and server does the SSE framing with
  `createUIMessageStreamResponse`.
- **Current session.** The engine owns the projection: `sessions.current()` returns `CurrentSession<UIMessage>`.
- **Events.** The engine exposes `events.subscribe` only. The watcher bridge moves inside `startEngine`, so server
  never publishes (N9).

### Engine surface

```ts
// src/engine/engine.ts
export { DocumentError } from './documents/documents';
export { parseCommandLine, USAGE, VERSION } from './command-line';

export interface EngineOptions {          // agent-host.ts's AgentHostOptions, moved verbatim
  workspace: string;
  model?: string;
  claude: ClaudeMode;
  maxSteps?: number;
}

export interface StartOptions {
  target: string | undefined;
  claude: ClaudeMode;
  model?: string;
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
  };
  readonly sessions: {
    current(): CurrentSession<UIMessage>;
    create(): Promise<string>;                                        // the new session's id
    chat(sessionId: string, request: ChatRequest): ReadableStream<UIMessageChunk>;
    cancel(sessionId: string): boolean;
  };
  readonly viewState: {
    load(): Promise<ViewState>;
    save(view: ViewState): Promise<void>;
  };
  readonly workspaceConfig: {
    names(): Promise<{ skills: string[]; agents: string[] }>;
  };
  readonly events: {
    subscribe(listener: (event: HostEvent) => void): () => void;
  };
}

export function createEngine(options: EngineOptions): Engine;
export function startEngine(options: StartOptions): Promise<Engine>;
```

### Engine wiring

```ts
export function createEngine(options: EngineOptions): Engine {
  return wire(options).engine;
}

// Startup, in today's order. Await it before serving: the current session must already be loaded (F22).
export async function startEngine({ target, claude, model }: StartOptions): Promise<Engine> {
  const workspace = await chooseWorkspace(target);
  const { engine, events, sessions } = wire({ workspace, claude, model });
  // Tells every open tab when something in the workspace changes on disk.
  watchDocuments(workspace, () => events.emit({ type: 'documents-changed' }));
  await sessions.load();
  const backend = claudeBackend(claude);
  console.log(`3pitor chat: claude via ${backend.label}`);
  const warning = backend.startupWarning(process.env);
  if (warning) console.warn(`\n${warning}\n`);
  return engine;
}

function wire(options: EngineOptions) {
  const { workspace } = options;
  const events = new EventBus();
  const sessions = new Sessions(options, events);
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

### Thin handlers

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
  app.put('/api/documents/:name', async (c) => {
    const { content } = await body(c, PutBody);
    await documents.write(c.req.param('name'), content);
    return c.json({ ok: true });
  });
  // the other routes follow the same pattern: body(c, Schema) → documents.x(...) → c.json(...)
  return app;
}

// src/server/chat/sessions.routes.ts (flattened from chat/sessions/)
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

### The resulting `server.ts`

```ts
import { Hono } from 'hono';
import { websocket } from 'hono/bun';
import { join } from 'node:path';
import homepage from '../ui/index.html';
import { parseCommandLine, startEngine, USAGE, VERSION } from '../engine/engine';
import { sessionRoutes } from './chat/sessions.routes';
import { documentRoutes } from './documents/documents.routes';
import { eventSocket } from './events/events.routes';
import { viewStateRoutes } from './view-state/view-state.routes';
import { workspaceConfigRoutes } from './workspace-config/workspace-config.routes';

const { target, claude } = commandLine();
const engine = await startEngine({ target, claude, model: process.env.MODEL });

const app = new Hono()
  .get('/api/health', (c) => c.json({ ok: true, workspace: engine.workspace, bun: Bun.version }))
  .route('/', workspaceConfigRoutes(engine.workspaceConfig))
  .route('/', documentRoutes(engine.documents))
  .route('/', sessionRoutes(engine.sessions))
  .route('/', viewStateRoutes(engine.viewState))
  .route('/', eventSocket(engine.events));

const server = Bun.serve({
  port: Number(process.env.PORT ?? 0),
  routes: { '/': homepage },
  development: process.env.NODE_ENV !== 'production',
  fetch: app.fetch,
  websocket,
  idleTimeout: 255,
});
console.log(`3pitor listening on ${server.url.origin} (workspace: ${join(engine.workspace)})`);
// browser-open block and the commandLine() helper (print and exit) unchanged
```

### Layout and import rules

```
src/engine/   engine.ts, engine.test.ts (new), command-line.ts(+test), paths.ts(+test), text-imports.d.ts,
              chat/{agent, claude-backend, claude-cli (incl. mcp-endpoint, stream-json), components, sessions, tools}/,
              components/{json-file, workspace-path}, documents/, events/, view-state/, workspace/, workspace-config/
src/server/   server.ts, server.test.ts, scripts/check.ts,
              chat/sessions.routes.ts(+test), documents/documents.routes.ts(+test), events/events.routes.ts,
              view-state/view-state.routes.ts(+test), workspace-config/workspace-config.routes.ts(+test)
```

1. `src/engine/**` never imports `src/server/**`, `src/ui/**`, `hono`, or `hono/bun`.
2. Server production code imports from the engine only through `src/engine/engine.ts`.
3. Server tests and `server/scripts/check.ts` may also import engine internals for fixtures: `SRC`, `stateFile`,
   `dataDir`, and `resetWorkspace`.
4. Engine tests never import server.
5. `src/ui/**` imports neither server nor engine; the only cross-package link stays `server.ts` → `ui/index.html`.
6. `src/shared/**` imports no package.
7. Server may import `ai` only for `createUIMessageStreamResponse`.

### Failure behavior, unchanged on the wire

| Engine call | How it fails | Server mapping |
| --- | --- | --- |
| `documents.*` | `DocumentError{reason}` or another error | sub-app `onError`: `not-found` → 404, `invalid` → 400, anything else → text 500 |
| server `body()` shape failure | server throws `DocumentError('invalid', …)` | same `onError` → 400 |
| `sessions.create` | rejects with `Error` | try/catch → 500 `{error}` |
| `sessions.chat`, synchronously | plain `Error` for an unknown session or a running turn | try/catch → 409 `{error}` |
| `sessions.chat`, after it returns | `error` chunks inside a 200 stream | none; the engine records and cleans up (F21) |
| malformed chat JSON | `c.req.json()` throws before the try block | Hono text 500 |
| `viewState.save` | rejects | → 500 `{error}` |
| `viewState.load`, `workspaceConfig.names` | rejects | Hono text 500 |
| `startEngine` | rejects | the process crashes, as today |

### Element justifications (Option A)

| # | Element | Justification |
| --- | --- | --- |
| A1 | Package `src/engine/` | G3 "should move into an "engine" package" |
| A2 | `engine.ts` as the only module server production code imports | D4 "forwards all requests to the engine"; N5, N6 |
| A3 | `agent-host.ts` folded into `engine.ts` | N5, F5: agent-host is already the wiring point, and only `server.ts` imports it |
| A4 | `startEngine` holds the startup wiring (O2) | G3; F22 (`load()` must finish before serving) |
| A5–A7 | `StartOptions` `target`, `claude`, `model?` | Necessity: today's `chooseWorkspace(target)`, `claudeBackend(claude)`, and `MODEL` (`server.ts:20,22,27`) |
| A8 | `chooseWorkspace` called inside `startEngine` | G3; N3 |
| A9 | The watcher bridge inside `startEngine` | N9; G3; D1–D3 |
| A10 | `startEngine` resolves only after `load()` | F22 |
| A11 | Backend label and warning printed by `startEngine`, before "listening on" | G3; F32 (stdout order unchanged) |
| A12 | `createEngine`, synchronous, no I/O | Necessity: route tests build an engine per temp workspace (F30, N11) |
| A13 | `EngineOptions` = `AgentHostOptions` moved verbatim | G3 "should move" |
| A14 | `Engine.workspace` | Necessity: the health body and the "listening on" line (F2, F32) |
| A15 | `Engine.documents`: each domain function minus `workspace` | D2 "forward all relevant information to the engine"; F2, F6, F7 |
| A16 | `sessions.current()` returns `CurrentSession<UIMessage>`, derived in the engine | D4 "thick domain layer"; N7, F22 |
| A17 | `sessions.create()` returns the id | N7 (the route uses only `.id`) |
| A18 | `sessions.chat` returns `ReadableStream<UIMessageChunk>` | F7; N7; D3 (no SSE in engine). Unverified by `tsc` |
| A19 | `sessions.cancel` returns `boolean` | F7 (`{cancelled}` body) |
| A20 | `viewState.load` and `save` | F2 |
| A21 | `workspaceConfig.names()` | D4 "as thin as possible": the projection leaves the handler |
| A22 | `events.subscribe` only, no `emit` | F7, N9; D1 |
| A23 | `DocumentError` re-exported as a value | N8, F19 |
| A24 | `parseCommandLine`, `USAGE`, `VERSION` re-exported | G3; N3 (see question 1) |
| A25 | Route factories keep their names and take engine slices | D2 "do as little as possible"; F1, F30 |
| A26 | zod schemas and `body()` stay in the documents handler | D2 "extract required information from the http call"; F25 |
| A27 | `openFile` coercion and `isDocuments` stay in the chat handler | D2; F25 |
| A28 | `DocumentError` → 404/400 mapping in the server `onError` | D3 "must not know anything about http"; F17, F18 |
| A29 | create → 500, chat → 409 (unknown session stays 409) | F17, F20, F32 |
| A30 | `createUIMessageStreamResponse` in server | D3; N7 |
| A31 | Upgrade, `JSON.stringify`, and `ws.send` in `events.routes.ts` | D1 "holds the entirety of the web sockets code" |
| A32 | `/api/health` inline in `server.ts` | F2; D1 |
| A33 | `Bun.serve`, `idleTimeout`, `websocket`, `homepage`, "listening on", browser-open stay in `server.ts` | G2 "main entry point"; F11–F14, F32 |
| A34 | `commandLine()` (stderr, exit codes) stays in `server.ts`, before `startEngine` | G2; `server.test.ts:29-30` |
| A35 | `paths.ts` and its test move to `src/engine/` | Necessity: production importers `workspace.ts:4`, `app-skills.macro.ts:7` plus rule 1 (N3) |
| A36 | `text-imports.d.ts` moves to `src/engine/` | G3; N3 |
| A37 | `mcp-endpoint.ts` stays with `claude-cli` in the engine | G3; D1 (not one of "the http API endpoints"); N3 |
| A38 | `scripts/check.ts` stays in `src/server/scripts/` | F14, N13; it drives the server's API |
| A39 | `command-line.ts` and its test move to `src/engine/` | G3 (see question 1) |
| A40 | Engine keeps today's feature and component folders | G3 "should move" |
| A41 | Server keeps feature-named route folders | N12; README:20-21, extended to three packages |
| A42 | `server/chat/sessions/` flattened to `server/chat/sessions.routes.ts` | N12; README:22-24 |
| A43–A49 | Import rules 1–7 | D3; N6, D4; N11, N3; N10; F13; `wire.ts:1-2`; D3, N7 |
| A50–A52 | Lifecycle: `startEngine` once before `Bun.serve`; `current()` on a `createEngine` engine only after `create()`; watcher never closed | F22; `sessions.ts:63-65`; F10 |
| A53 | The engine reports failure only by throwing or by in-stream chunks, never a status | D3; F21 |
| A54 | `sessions.test.ts:443-455` calls `sessions.create()`; a new route test asserts 201 `{id}` | N10; F32 |
| A55 | `sessions.routes.test.ts` fakes `Engine['sessions']`; the `running`/`claude` derivation test moves to `engine.test.ts` | N7; D4 |
| A56 | Route tests import `stateFile` and `SRC` from the engine | N11 |
| A57 | Documents, view-state, and workspace-config route tests use `createEngine(...).<slice>` | F30 |
| A58 | `Makefile:38` → `bun test src/server src/engine src/shared` | N13 |
| A59 | README layout section rewritten for four packages | N3, N12 |

## Option B: per-feature engine modules and no entry point; `server.ts` composes

The route files import engine feature modules directly (`../../engine/documents/documents`, and so on), and the route
factories keep today's parameters: `workspace: string`, `Sessions`, and `EventBus` (F1). Three additions satisfy the
owner's direction:

- `Sessions` gains `snapshot(): CurrentSession<UIMessage>`.
- `workspace-config.ts` gains `loadNames(workspace)`.
- `agent-host.ts` moves to the engine and gains `startAgentHost(...)`, which runs the startup wiring.

`command-line.ts` stays in `src/server/`.

```ts
// src/engine/agent-host.ts
export async function startAgentHost(o: { target?: string; claude: ClaudeMode; model?: string }):
  Promise<{ workspace: string; events: EventBus; sessions: Sessions }>;
// src/engine/chat/sessions/sessions.ts (added method)
snapshot(): CurrentSession<UIMessage>;
// src/engine/workspace-config/workspace-config.ts (added)
export function loadNames(workspace: string): Promise<{ skills: string[]; agents: string[] }>;
```

| # | Element | Justification |
| --- | --- | --- |
| B1 | No entry point; routes import engine feature modules | D2 "forward all relevant information to the engine"; G3 (smallest move) |
| B2 | Route factories keep `workspace`/`Sessions`/`EventBus` | F1, F30 |
| B3 | `Sessions.snapshot()` | N7, F22; D4 |
| B4 | `loadNames(workspace)` | D4 |
| B5 | `startAgentHost(...)` | G3; N9; F22 |
| B6 | `command-line.ts` stays in server | G2 "it's the main entry point for the backend services" |
| B7 | Server production may import any engine module | N5, accepted rather than fixed |

The other elements carry over from A, with B6 replacing A39.

**Costs:**

- N5 and N6 stay: server imports about six engine modules across five folders, so renaming an engine folder means
  edits in server.
- Server holds the workspace path and passes it back in on every call.
- `EventBus.emit` stays visible to server.

## Option C: one entry point, with the engine as the validation boundary and one error type

The entry point is as in A, but handlers pass the raw parsed body.

- **Validation moves into the engine.** The zod schemas, the `openFile` coercion, and `isDocuments` all move there.
- **One error type.** The engine throws one `EngineError` with `reason: 'invalid' | 'not-found' | 'refused'`. It
  replaces `DocumentError`, and chat's two plain `Error`s become `'refused'`.
- **One mapping in server.** `statusFor(EngineError)` maps `invalid` → 400, `not-found` → 404, and `refused` → 409.

```ts
export class EngineError extends Error { constructor(readonly reason: 'invalid' | 'not-found' | 'refused', message: string) }
readonly documents: {
  list(): Promise<DocumentEntry[]>;
  read(path: string): Promise<string>;
  write(path: string, body: unknown): Promise<void>;     // validates { content: string }
  create(body: unknown): Promise<void>;                  // validates { path, kind }
  move(body: unknown): Promise<void>;
  count(body: unknown): Promise<FolderCount>;
  delete(body: unknown): Promise<void>;
};
readonly sessions: { /* ... */ chat(sessionId: string, body: unknown): ReadableStream<UIMessageChunk> };
// handler:
app.post('/api/documents/create', async (c) => { await documents.create(await c.req.json().catch(() => undefined)); return c.json({ ok: true }); });
```

| # | Element | Justification |
| --- | --- | --- |
| C1 | Engine methods take `body: unknown` and validate | D2 "do as little as possible", read at its maximum; D4 |
| C2 | `EngineError` replaces `DocumentError`; chat refusals become `'refused'` | N8; N7 |
| C3 | Server `statusFor` mapping | D3; F17, F20 |
| C4 | The chat catch handles `EngineError` and rethrows anything else | C2; no wire change in practice (`sessions.ts:81-82`) |
| C5 | zod becomes an engine dependency | C1 |

**Costs:**

- Engine signatures weaken from typed values to `unknown`.
- The coercion tests move from server to the engine, and the diff touches `documents.ts` and `sessions.ts`.
- No finding shows that typed engine input fails today.
- "Refused" is HTTP's "Conflict" in disguise, and only the 409 uses it.

## The architect's recommendation: Option A

1. **It is the only option that meets D4 at both ends.** Handlers forward to one object, and the engine's internals
   never reach server. B keeps server reading engine folders and holding `emit`. C goes past D2: checking that a JSON
   body has `content: string` is extracting information from the HTTP call, so it belongs at the handler.
2. **The wire contract stays exactly as it is.** Today's error-mapping table carries over unchanged.
3. **It is the smallest structure that removes N7, N9, N10, and N11.** It adds no interfaces, ports, or error classes:
   `Engine` is one type over object literals that delegate to unchanged domain code.
4. **It settles O2 the way the goal reads.** Startup wiring is not HTTP, so it goes to the engine (G3). Process concerns
   such as argv errors, exit codes, the port, the browser, and the "listening on" line stay with the entry point (G2).
5. **The chat chunk format is not HTTP knowledge.** The engine already produces the `UIMessageChunk` stream and reads it
   back in `record()`, and the agent writes data parts into it. Only `createUIMessageStreamResponse` adds SSE framing
   and headers, and that stays in server.

## Rejected alternatives

- **An engine-owned chat event type that server translates.** The tools and the agent write AI SDK parts directly, and
  `record()` reads them back, so the translation layer would be thick.
- **The engine returns a `Response` or does SSE framing.** That breaks D3.
- **The engine takes a raw `Request` or a Hono `Context`.** That breaks D3.
- **A flat entry point with about 16 methods.** Route factories could no longer take a narrow slice.
- **Server-owned port interfaces with engine adapters.** Each port would have one implementation, which is YAGNI.
- **Startup wiring kept in `server.ts`.** Server would publish engine events and compose engine objects, which is
  non-HTTP code.
- **`paths.ts` left in `src/server/`.** Engine production code would import server, which breaks D3.
- **`paths.ts` in `src/shared/`.** It uses Bun APIs, and shared is imported by the browser.
- **Every file computing `SRC` itself.** That contradicts "the one place that finds src/".
- **`mcp-endpoint.ts` in server.** It is not one of the app's endpoints, and `claude-cli.ts` imports it.
- **`check.ts` moved out of server.** It drives the server's API, and moving it changes `package.json:7` for nothing.
- **A flat `server/routes/` folder, or renaming folders to avoid three same-named trees.** Both break the package →
  feature rule or are churn.
- **`Bun.serve` or `idleTimeout` in the engine.** That puts HTTP in the engine.
- **`startEngine` returning `close()`.** Nothing closes the engine today.

## Cut list

| Item | What it would do | Why cut |
| --- | --- | --- |
| Listen on 127.0.0.1 only; Host and Origin checks (F28) | Close LAN access, cross-site WebSocket hijacking, CSRF, DNS rebinding | Pre-existing and a behavior change; its own change. A thin server makes `server.ts` the one place to add it |
| Windows other-drive path fix (F29) | Fix `resolveInWorkspace` | Engine bug unrelated to the split |
| One app-level `onError` with JSON everywhere (F17) | Unify error bodies | Changes the wire |
| 404 for an unknown chat session (F20) | Correct status | Wire change; needs a typed chat error first |
| Typed `ChatError`/`EngineError` | Separate refusals from bugs | Nothing needs it; "any synchronous throw → 409" matches today |
| Server-owned `RequestError` so `body()` stops throwing `DocumentError` (N8) | Server never constructs engine errors | Allowed direction, no wire effect; see question 6 |
| 400 for malformed chat JSON (F20) | Correct status | Wire change |
| Validate chat `text` and the view-state body (F26) | Reject bad input | Behavior change |
| Hide raw `error.message` in 500s (F27) | Avoid leaking paths | Body change |
| Listener isolation, WebSocket `onError`, `ws.send` checks (F23) | Sturdier fan-out | Behavior change |
| README endpoints table fixes (F33) | Docs completeness | Pre-existing gap |
| Shared URL constants (F9) | One source for paths | Touches ui and tests |
| Named wire types for untyped bodies (F8) | Typed bodies | Contract preserved without them |
| An engine-owned `SessionSnapshot` type | Avoid a type named for an endpoint | Same structure; see question 4 |
| `Engine.close()` | Clean shutdown in tests | Nothing shuts down today |
| In-process `server.ts` | In-process server tests | Not asked |
| A test that enforces import rules | Automatic guard | No need shown |
| No `ai` import in server | Zero AI SDK in server | SSE framing is HTTP and belongs in server |
| Rename `sessions.routes.ts` → `chat.routes.ts` | Name matches feature | Churn |
| Per-feature `index.ts` barrels | Shorter imports | Superseded by `engine.ts` |
| Drop `maxSteps` | Remove an unset option | The move is verbatim |

## Questions the architect could not settle

1. **Where `command-line.ts` lives.** A and C follow the literal goal and put it in the engine. B keeps it in server as
   entry-point work, treating the command line as another thin adapter like a route.
2. **Whether the AI SDK chunk format is acceptable as engine output.** It carries no HTTP, but it is what the browser's
   `useChat` client reads.
3. **Whether this change edits `.claude/skills/update-code-structure/SKILL.md`.** That file holds the owner's layout
   rules, which list three packages.
4. **Whether the engine should use the `CurrentSession` wire type.** Its comment names the endpoint.
5. **Who prints the startup lines.** The engine, as in A, or `server.ts`, from a `{ label, warning }` that
   `startEngine` returns.
6. **Whether server may construct `DocumentError`** for its own request-shape failures.
7. **Whether `check.ts` may import engine internals,** or whether `engine.ts` should re-export those dev helpers.

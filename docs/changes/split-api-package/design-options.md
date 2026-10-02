# Design Options: Split the HTTP and WebSocket APIs into a New Package

**Goal (verbatim):** "to allow splitting apart the http and websocket APIs into a new package"

This document is the software architect's options round. Every citation points to a finding (F1–F33) or an open item
(O1–O2) in [context-brief.md](./context-brief.md).

**Every option keeps these the same:**

- **The wire contract.** URLs, methods, status codes, body shapes, the SSE stream, the `/ws/events` message format, and
  the `listening on <url>` line stay exactly as they are. This is a necessity: `check.ts`, `make check-build`,
  `server.test.ts`, and the UI's `api()` depend on them (F32, F14). It also follows the scoping of the last
  restructure, which made no behavior changes.
- **One package for both APIs.** HTTP and WebSocket move together into one package. This descends from the goal's
  words "into **a** new package", which are singular, and it settles O1.

## 1. Options

### Option A: Move the five route factories as they are, and keep the app assembly in `server.ts`

The five routes files move into `src/api/<feature>/`, joined by `/api/health` as a sixth factory, and their signatures
stay the same. `server.ts` still builds the `Hono` app, mounts each factory, imports `websocket` from `hono/bun`, and
calls `Bun.serve`.

```ts
// src/api/documents/documents.routes.ts
export function documentRoutes(workspace: string): Hono
// src/api/chat/sessions.routes.ts
export function sessionRoutes(sessions: Sessions): Hono
// src/api/view-state/view-state.routes.ts
export function viewStateRoutes(workspace: string): Hono
// src/api/workspace-config/workspace-config.routes.ts
export function workspaceConfigRoutes(workspace: string): Hono
// src/api/events/events.routes.ts
export function eventSocket(events: EventBus): Hono
// src/api/health/health.routes.ts
export function healthRoutes(workspace: string): Hono   // { ok: true, workspace, bun: Bun.version }

// src/server/server.ts (assembly, after the move)
import { Hono } from 'hono';
import { websocket } from 'hono/bun';
import { documentRoutes } from '../api/documents/documents.routes';
// ...five more imports from ../api/...
const app = new Hono()
  .route('/', healthRoutes(workspace))
  .route('/', workspaceConfigRoutes(workspace))
  .route('/', documentRoutes(workspace))
  .route('/', sessionRoutes(host.sessions))
  .route('/', viewStateRoutes(workspace))
  .route('/', eventSocket(host.events));
Bun.serve({ port, routes: { '/': homepage }, development, fetch: app.fetch, websocket, idleTimeout: 255 });
```

**For:** the smallest diff, with no new function.

**Against:**

- The server package still knows Hono: it keeps the mount table, the health route's placement, and the `hono/bun`
  `websocket` import.
- The pairing F11 depends on, `upgradeWebSocket` in api and `websocket` in server, would cross packages. Only the fact
  that `hono/bun` is a module singleton would hold it together.
- `server.ts` would import six modules from the new package instead of one.

### Option B (recommended): One factory, `createApi(workspace, host)`, that returns `{ fetch, websocket }`

`src/api/api.ts` is the package's only public module.

- **Inside the package:** the Hono app, `/api/health`, the mount order, and the `hono/bun` pairing.
- **What it returns:** exactly the two fields `Bun.serve` needs from it.
- **What stays in `server.ts`:** `Bun.serve`, `homepage`, `idleTimeout`, `PORT`, `development`, the listening line,
  opening the browser, the command line, `chooseWorkspace`, `createAgentHost`, the `watchDocuments` bridge, and
  `sessions.load()`.

```ts
// src/api/api.ts
import { Hono } from 'hono';
import { websocket } from 'hono/bun';
import type { AgentHost } from '../server/agent-host';
import { documentRoutes } from './documents/documents.routes';
import { eventSocket } from './events/events.routes';
import { sessionRoutes } from './chat/sessions.routes';
import { viewStateRoutes } from './view-state/view-state.routes';
import { workspaceConfigRoutes } from './workspace-config/workspace-config.routes';

export function createApi(workspace: string, host: AgentHost): { fetch: Hono['fetch']; websocket: typeof websocket } {
  const app = new Hono()
    .get('/api/health', (c) => c.json({ ok: true, workspace, bun: Bun.version }))
    .route('/', workspaceConfigRoutes(workspace))
    .route('/', documentRoutes(workspace))
    .route('/', sessionRoutes(host.sessions))
    .route('/', viewStateRoutes(workspace))
    .route('/', eventSocket(host.events));
  return { fetch: app.fetch, websocket };
}
```

```ts
// src/server/server.ts (assembly, after the move; everything above line 32 is unchanged)
import homepage from '../ui/index.html';
import { createApi } from '../api/api';
// (no 'hono' or 'hono/bun' import remains in src/server)

const host = createAgentHost({ workspace, model: process.env.MODEL, claude });
watchDocuments(workspace, () => host.events.emit({ type: 'documents-changed' }));
await host.sessions.load();
// ...backend label, warning...
const api = createApi(workspace, host);
const server = Bun.serve({
  port: Number(process.env.PORT ?? 0),
  routes: { '/': homepage },
  development: process.env.NODE_ENV !== 'production',
  fetch: api.fetch,
  websocket: api.websocket,
  idleTimeout: 255,
});
console.log(`3pitor listening on ${server.url.origin} (workspace: ${join(workspace)})`);
```

The target layout keeps the file names, and its folders mirror the `src/server/` features, as the README requires:

```
src/api/
  api.ts                                   createApi: the package's only public export
  documents/documents.routes.ts  + .test.ts     <- src/server/documents/
  chat/sessions.routes.ts        + .test.ts     <- src/server/chat/sessions/  (single component -> flat, README "Components")
  view-state/view-state.routes.ts + .test.ts    <- src/server/view-state/
  workspace-config/workspace-config.routes.ts + .test.ts <- src/server/workspace-config/
  events/events.routes.ts                       <- src/server/events/
```

Only the import specifiers inside the moved files change. The bodies stay the same, including each `onError`, the zod
schemas, `body()`, the `openFile` coercion, and `isDocuments`.

### Option C: The api package owns ports, and imports nothing from `src/server`

`src/api/ports.ts` declares the interfaces the routes need, and `server.ts` builds adapters from the domain. The
documents error crosses the seam as a structural shape instead of the `DocumentError` class.

```ts
// src/api/ports.ts
export interface ApiPorts {
  workspace: string;                              // health body
  documents: {
    list(): Promise<DocumentList['entries']>; read(name: string): Promise<string>;
    write(name: string, content: string): Promise<void>; create(path: string, kind: 'file' | 'folder'): Promise<void>;
    move(from: string, to: string): Promise<void>; count(path: string): Promise<FolderCount>; delete(path: string): Promise<void>;
  };
  viewState: { load(): Promise<ViewState>; save(state: ViewState): Promise<void> };
  workspaceConfig: { load(): Promise<{ skills: { name: string }[]; agents: { name: string }[] }> };
  sessions: {
    current(): { id: string; uiMessages: UIMessage[]; abort?: unknown }; claude: ClaudeMode;
    create(): Promise<{ id: string }>; chat(id: string, req: ChatRequest): ReadableStream; cancel(id: string): boolean;
  };
  events: { subscribe(listener: (e: HostEvent) => void): () => void };
}
// Errors: documents onError maps any error with `reason: 'not-found' | 'invalid'` (duck-typed) to 404/400.
// body() throws an api-local RequestError with reason 'invalid'.
export function createApi(ports: ApiPorts): { fetch: Hono['fetch']; websocket: typeof websocket }

// src/server/server.ts: about 25 lines of adapter object literal binding each port to documents.ts,
// view-state.ts, workspace-config.ts, host.sessions, host.events.
```

**For:** api imports nothing from server, so the package could later be compiled or published on its own.

**Against:**

- Every port has exactly one implementation.
- It needs a new error protocol in place of `instanceof DocumentError` (F19).
- The wire types move into the port definitions, and `server.ts` gains an adapter layer.

## 2. Recommendation: Option B

Option B moves the whole transport layer into `src/api/` behind one factory, `createApi(workspace, host)`, that returns
`{ fetch, websocket }`. After the move, nothing in the server package imports `hono`.

- **Against A:** A leaves the assembly, the health route, and the `hono/bun` handler in the server package. Under A, the
  "http and websocket APIs" are only partly "split apart".
- **Against C:** C splits further than the goal asks, at the cost of five single-implementation ports and a rewritten
  error protocol.
- **Why the shape is forced:** B adds exactly one new function, and existing constraints fix its shape. The return value
  is fixed by F11, because `websocket` must reach `Bun.serve` beside `fetch`. The parameters are fixed by F6, because
  three factories need `workspace` while the other two need `Sessions` and `EventBus`, and `AgentHost` already names
  `{ events, sessions }`.
- **Principles:**
  - Single responsibility for `server.ts` (F10): adding or reordering a route changes `api.ts` only.
  - Cohesion: the Hono app, the mount order, health, and the `upgradeWebSocket`/`websocket` pair sit in one module.
  - Loose coupling: the package exposes one public name.

## 3. Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Option A | Health, the mount table, and `websocket` stay in the server package, so the APIs are not fully split out. The `upgradeWebSocket`/`websocket` pair (F11) would sit in two packages. |
| Option C | Five ports with one implementation each. It replaces `instanceof DocumentError` (F18, F19) with duck typing, which is a new failure mode. The goal's "package" means a `src/` folder in this repo's vocabulary, not a separately built artifact. |
| `createApi` returns the `Hono` app (`{ app, websocket }`) | It leaks Hono's type into `server.ts`. Nothing outside api needs `.request()` or `.route()` on the assembled app (F30). |
| `createApi(options: { workspace, sessions, events })` | Equivalent to `(workspace, host)`, but it adds a new type when `AgentHost` already exists (F6). |
| Two packages, `src/http/` and `src/ws/` | The goal says "a new package" (O1). |
| Package name `src/http/` | It misnames the WebSocket endpoint. |
| Folder `src/server/api/` | Not a new package. The README defines packages as top-level `src/` folders. |
| Move `Bun.serve` into api (`startApi()`) | It would make api import `ui/index.html`, a second link to ui (F13). It would also move the `listening on` line that `check.ts` parses (F32). |

## 4. Element justifications

Each justification is one of two kinds: **(a)** it descends from the goal (quoted), or **(b)** it is a necessity of
asked-for or preserved behavior.

### Option B

| # | Element | Justification |
| --- | --- | --- |
| B1 | Package folder `src/api/`, at the top level beside `server/`, `ui/`, and `shared/` | (a) "into a new package"; the name comes from the goal's own word, "APIs" (O2) |
| B2 | Feature folders mirror server: `documents/`, `chat/`, `view-state/`, `workspace-config/`, `events/` | (b) README "Features": a capability that spans packages uses the same name in each |
| B3 | `chat/sessions.routes.ts` sits flat in `chat/` | (b) README "Components": a feature with a single component keeps its files in the feature folder |
| B4 | File names keep `*.routes.ts` | (b) No behavior change; `git mv` keeps history |
| B5 | `api.ts` at the api package root | (b) README: entry points stay at their package root |
| B6 | `createApi` is the only export for non-test consumers | (a) "splitting apart": one entry from server into api |
| B7 | Parameter `workspace: string` | (b) documents, view-state, workspace-config, and health all need it (F1, F2, F6) |
| B8 | Parameter `host: AgentHost` (type-only import) | (b) The sessions routes need `Sessions` and the event socket needs `EventBus` (F1, F7, F6) |
| B9 | Parameter order `(workspace, host)`, both required, no defaults | (b) Both are required; positional matches the existing factory style (F1) |
| B10 | Returns `{ fetch: Hono['fetch']; websocket: typeof websocket }` | (b) `/ws/events` cannot upgrade unless `websocket` reaches `Bun.serve` beside `fetch` (F11) |
| B11 | `fetch` is `app.fetch`, unbound, and Bun calls it as `(req, server)` | (b) `upgradeWebSocket` needs the Bun server as `fetch`'s second argument (F11) |
| B12 | `websocket` is the `hono/bun` constant imported in `api.ts` | (b) It must be the same module instance as the `upgradeWebSocket` in `events.routes.ts` (F11) |
| B13 | `/api/health` moves into `createApi` with the same body | (a) "splitting apart the **http** … APIs"; the body is kept because `check.ts` polls `.ok` (F32) |
| B14 | Mount order stays: health, workspace-config, documents, sessions, view-state, events | (b) Preserved wire contract (F32) |
| B15 | Each feature's error handling stays in its routes file; no top-level `app.onError` | (b) Preserved status codes (F17, F32); Hono scopes a sub-app's `onError` to that sub-app (F18) |
| B16 | Body validation stays in the routes files | (b) The domain trusts its inputs (F25); keeps the chat 400 (F32) |
| B17 | Path safety stays in the domain; the api adds none | (b) The domain functions are already safe (F24) |
| B18 | `src/api/**` may import `src/server/**` (except `server.ts` and `scripts/`), `src/shared/**`, `hono`, `hono/bun`, `ai`, and `zod` | (b) The routes import domain values and types (F7); the moved tests import `json-file` and `paths` (F31) |
| B19 | api may import `DocumentError` as a value | (b) `instanceof` and `throw new DocumentError('invalid', …)` keep 400 and 404 (F17, F19) |
| B20 | Inside `src/server/`, only `server.ts` imports `src/api/`, and only `createApi` | (a) "splitting apart"; keeps F3: the domain never depends on the transport |
| B21 | No `src/ui/` file imports `src/api/` | (b) README rule that ui does not import server; api imports server |
| B22 | `src/api/` does not import `ui/index.html` | (b) That is the one allowed server → ui link (F13) |
| B23 | `Bun.serve`, `homepage`, `development`, and `PORT` stay in `server.ts` | (b) F13, F14 |
| B24 | `idleTimeout: 255` stays on `Bun.serve` | (b) SSE pauses outlast Bun's 10-second default (F12) |
| B25 | The `listening on` line stays byte for byte | (b) `check.ts` and `make check-build` parse it (F32) |
| B26 | The `watchDocuments` → `events.emit` bridge stays in `server.ts` | (b) `/ws/events` delivers `documents-changed` only while the bridge runs (F10, F5) |
| B27 | `server.ts` awaits `sessions.load()` before `Bun.serve` | (b) `GET /api/sessions/current` assumes `load()` has run (F22) |
| B28 | `createApi` is synchronous and does no I/O | (b) Construction must not touch `current()` before `load()` (F22) |
| B29 | `createApi` does not throw; startup failures stay where they are today | (b) It only constructs Hono apps (F10) |
| B30 | Per-route failure behavior stays exactly as today, including its quirks | (b) Preserved wire contract (F17, F20, F23, F27, F32) |
| B31 | The four `*.routes.test.ts` files move with their sources; only their imports change | (b) They call `.request()` on the factory (F30) |
| B32 | `sessions.test.ts:443-453` drops its `sessionRoutes` import. The domain assertion stays as `sessions.create()`, and the `201 {id}` assertion moves to `src/api/chat/sessions.routes.test.ts` with a `create` stub | (b) B20: no domain test may import api (F31) |
| B33 | `Makefile:38` becomes `bun test src/server src/api src/shared` | (b) Otherwise the moved tests silently stop running (F15) |
| B34 | `Makefile:11`, `package.json`, `check.ts`, `server.test.ts`, `paths.ts`, and `tsconfig.json` do not change | (b) F14, F15, F16 |
| B35 | The README layout section gains `src/api/` and rules B20–B22; `README.md:200` names `src/api` | (b) The README is the only written home for the project's import rules |

### Option A (only the elements that differ from B)

| # | Element | Justification |
| --- | --- | --- |
| A-1 | Six exported factories, adding `healthRoutes(workspace)` | (a) "splitting apart …"; existing signatures (F1, F2) |
| A-2 | `server.ts` keeps `new Hono()`, the mount order, and the `websocket` import | (b) Something must hand `websocket` to `Bun.serve` (F11) |
| A-3 | `server.ts` imports six api modules | (a) "splitting apart" |

### Option C (only the elements that differ from B)

| # | Element | Justification |
| --- | --- | --- |
| C-1 | An `ApiPorts` interface owned by api | (a) "splitting apart", read as no compile-time dependency on server; each method serves one route (F7) |
| C-2 | Structural error contract (`reason` duck-typed), and an api-local `RequestError` | (b) Without the `DocumentError` import (F19), 400 and 404 survive only through a shape check |
| C-3 | Adapters in `server.ts` | (b) Something must bind the ports |
| C-4 | api imports only `shared/`, `hono`, `ai`, and `zod` | (a) "splitting apart", strongly read |

## 5. Cut list

| Cut | What it would have done | Why cut |
| --- | --- | --- |
| Unified error handling | One top-level `onError` with a JSON `{error}` envelope | It changes response bodies (the text 500s become JSON) (F17); not asked |
| 404 for an unknown session | Tell "unknown session" apart from "turn running" | A behavior change to the domain and the wire (F20) |
| Chat bad JSON → 400 | Parse the chat body inside the try block | It changes a status code (F20) |
| Validate chat `text` and the view-state body | zod schemas for both | F26: the view-state body is unchecked by design; checking chat is a behavior change |
| Scrub `error.message` from 500 bodies | Return a generic message and log the details | It changes response bodies; no attacker-triggered path was shown (F27) |
| Bind `127.0.0.1` and add Host and Origin checks | Close the LAN exposure, WebSocket hijacking, and DNS rebinding | Pre-existing and outside the split (F28); a separate change |
| Windows cross-drive fix | Reject absolute `relative()` results in `resolveInWorkspace` | A domain-layer bug (F29) |
| Shared URL constants | One definition of each path | It touches the UI and tests on both sides (F9); the split doesn't need it |
| Wire types for untyped bodies | Name `{ok}`, `{id}`, `{cancelled}`, and the health body | F8; the contract is preserved without them |
| README endpoints table fixes | Add `/api/workspace-config` and `/api/health` | A gap that predates the split (F33) |
| Split HTTP and WebSocket into two packages | `src/http/` and `src/ws/` | "a new package" is singular (O1) |
| `EventBus` listener isolation and a WebSocket `onError` | Harden the fan-out | F23; a behavior change |
| Move `idleTimeout` into the api's return value | Keep the setting beside the SSE route | Not needed for the split (B24) |
| Fold `workspace` into `AgentHost` | `createApi(host)` with one parameter | It changes `agent-host.ts`; not needed |
| An assembly-level test of `createApi` | Unit coverage of the assembled app | `check.ts` and `server.test.ts` already cover it end to end (F32) |
| Make `server.ts` constructible in-process | Export `start()` so tests don't spawn | F10; not asked |
| Restrict api to importing only domain files | A tighter import rule | The moved tests need `json-file` and `paths` (F31) |

## 6. Questions the architect could not settle

1. Does "to allow" mean moving the layer into its own `src/` folder now, or making it extractable later as a
   separately built package? If it means extractable later, Option C becomes the recommendation.
2. Is the package name `src/api/` acceptable (O2)?
3. In B32, should the `sessions.test.ts` test be split into a domain test and an api test, or moved whole into api with
   a real `Sessions`?
4. Is the README edit in B35 in scope?
5. Is a package-level loop that runs only through the entry point acceptable (`server.ts` → api → server domain)?

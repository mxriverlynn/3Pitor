---
goal: "to allow splitting apart the http and websocket APIs into a new package"
goal_source: "described in conversation (/han-coding:design-an-api argument)"
interface: "The HTTP routes and the /ws/events WebSocket in src/server/*/*.routes.ts, plus the Hono app assembly in src/server/server.ts, moving to a new top-level package src/api/"
size: "large"
size_reason: "Error-to-status mapping crosses the new boundary (boundary-data) and request-body validation moves with the routes (trust-boundary); the routes also have consumers in server.ts, five test files, check.ts, and the UI fakes"
roster: "han-core:codebase-explorer, han-core:structural-analyst, han-core:behavioral-analyst, han-core:adversarial-security-analyst, han-core:software-architect, han-core:junior-developer, han-core:adversarial-validator"
starting_point: "working tree (main, clean; work on branch split-api-package)"
git_available: "yes"
---

# API Design: The `src/api/` Package and Its `createApi` Entry Point

## Summary

The HTTP and WebSocket layer leaves `src/server/` for a new top-level package, `src/api/`. That layer is five route
files, the health route, the Hono app (Hono is the web framework the routes are written in), and the WebSocket
handler. The package exposes one function, `createApi`. The
server's entry point calls it once and hands the result to `Bun.serve`. Nothing a browser, the UI, or the check script
can observe changes: every URL, status code, response body, and the `listening on` line stay byte for byte.

- **Option chosen.** One `createApi(workspace, host)` factory that returns `{ fetch, websocket }`. It was chosen over
  moving the route files while leaving the app assembly in `server.ts` (Option A), and over an interface layer that
  would let `src/api` build without `src/server` (Option C).
- **Decisions.** The owner has delegated planning decisions ("make the best decisions you can, without asking me").
  Under that delegation, the run settled both of its decision points itself (picking an option, and answering the
  open questions) and recorded nine decisions (D1–D9). One of them changes the
  owner's own layout rules in `.claude/skills/update-code-structure/SKILL.md` (D4, element B36). It ships as its own
  commit so it can be reverted alone.
- **Validation outcome.** The adversarial validator found nothing that blocks the design. Of its ten findings, eight
  were accepted in full or in part and two were confirmations. The accepted ones tightened the done-when checks,
  corrected one ordering comment, and added the decision that accepts the package loop (D9).
- **Coverage.** Every specialist the design's risk areas called for ran; the size limit on the agent roster left
  none out.

## The Goal This Serves

> "to allow splitting apart the http and websocket APIs into a new package"

The goal came from the conversation that started this run. "A new package" is singular, so HTTP and WebSocket move
together. "Package" means a top-level folder under `src/`, in this repo's vocabulary (README "How `src/` is laid out").
Every justification below cites this goal, a finding in [context-brief.md](./context-brief.md), or a decision in this
document.

## The Designed Contract

### Surface

The package has one public function. It takes the workspace path and the agent host, and it returns the two things
`Bun.serve` needs from the API.

```ts
// src/api/api.ts
// HTTP and WebSocket API: the one Hono app that maps the server's feature objects onto routes and a socket.
// server.ts calls createApi once and hands the result to Bun.serve. Nothing else in src/server knows Hono.
//
// Ordering: Bun.serve may start serving this app only after host.sessions.load() has resolved, because
// GET /api/sessions/current reads sessions.current(), which assumes load() has run (F22).
// Building it earlier is harmless: createApi is synchronous, does no I/O, and never calls current().
//
// The SSE chat route (chat/sessions.routes.ts) needs Bun.serve's idleTimeout set above Bun's 10-second default,
// because agent turns can pause longer than that. That setting lives on Bun.serve in server.ts (F12).
//
// websocket and upgradeWebSocket (events/events.routes.ts) are the two halves of hono/bun's transport:
// upgradeWebSocket puts each socket's listeners in ws.data.events, and websocket's handlers read them back.
// Both live in this package so that protocol stays in one place.
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

The entry point keeps startup, the page, and `Bun.serve`, and it no longer imports Hono.

```ts
// src/server/server.ts (after the move)
// Entry point: parses the command line, sets up the workspace, wires the agent host and the workspace watcher,
// and serves the page plus the HTTP and WebSocket API that src/api/api.ts builds.
import { join } from 'node:path';
import homepage from '../ui/index.html';
import { createApi } from '../api/api';
import { claudeBackend } from './chat/claude-backend/claude-backend';
import { createAgentHost } from './agent-host';
import { USAGE, VERSION, parseCommandLine } from './command-line';
import { watchDocuments } from './documents/documents';
import { chooseWorkspace } from './workspace/workspace';
// (src/server no longer imports Hono; src/api/api.ts owns the Hono app)

const { target, claude } = commandLine();
const workspace = await chooseWorkspace(target);
const host = createAgentHost({ workspace, model: process.env.MODEL, claude });
watchDocuments(workspace, () => host.events.emit({ type: 'documents-changed' }));
await host.sessions.load();               // load() must resolve before Bun.serve starts serving (F22; see api.ts)
// ...backend label and startup warning, unchanged...

const api = createApi(workspace, host);
const server = Bun.serve({
  port: Number(process.env.PORT ?? 0),
  routes: { '/': homepage },
  development: process.env.NODE_ENV !== 'production',
  fetch: api.fetch,
  websocket: api.websocket,
  // Bun closes idle HTTP connections after 10s by default; agent turns can pause longer (the SSE route in src/api).
  idleTimeout: 255,
});
// check.ts reads the URL from this line; keep its "listening on <url>" shape.
console.log(`3pitor listening on ${server.url.origin} (workspace: ${join(workspace)})`);
// ...open browser and commandLine(), unchanged...
```

The package's folders mirror the server's feature names. The bodies of the moved files stay the same. Only their import
paths change, plus one header comment.

```
src/
  api/                                         NEW package: the HTTP and WebSocket layer, runs in Bun
    api.ts                                     createApi: the package's only entry point for non-test code
    documents/documents.routes.ts + .test.ts         <- src/server/documents/
    chat/sessions.routes.ts + .test.ts               <- src/server/chat/sessions/   (single component: flat)
    view-state/view-state.routes.ts + .test.ts       <- src/server/view-state/
    workspace-config/workspace-config.routes.ts + .test.ts <- src/server/workspace-config/
    events/events.routes.ts                          <- src/server/events/
  server/   the five *.routes.ts and four *.routes.test.ts are gone; server.ts imports createApi, not Hono;
            sessions.test.ts drops its sessionRoutes import; chat/claude-cli/mcp-endpoint.ts stays
  shared/   unchanged
  ui/       unchanged except the app.tsx header comment
```

The one test that crosses the new boundary splits in two. The domain half stays in the server package, and the HTTP
half joins the api package's tests.

```ts
// src/server/chat/sessions/sessions.test.ts:443-455: the HTTP call at :449 and its two assertions change;
// useModel, newSessions, first = await sessions.create(), and turn(...) setup all stay
const { id } = await sessions.create();
expect(id).not.toBe(first.id);
expect(await stored()).toEqual({ id, messages: [], uiMessages: [] });

// src/api/chat/sessions.routes.test.ts: one added test, in the file's existing stub style
test('POST /api/sessions answers 201 with the new session id', async () => {
  const sessions = { create: async () => ({ id: 'new-id' }) } as unknown as Sessions;
  const res = await sessionRoutes(sessions).request('/api/sessions', { method: 'POST' });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ id: 'new-id' });
});
```

### Invariants

These rules hold after the change. A caller can rely on them.

- **The wire contract does not move.** URLs, methods, status codes, response bodies, the SSE stream, the `/ws/events`
  message format, and the `listening on <url>` line stay byte for byte.
- **No Hono in the server package.** No file in `src/server/` imports `hono` or `hono/bun`. The server package still
  serves HTTP in two places: `Bun.serve` in `server.ts`, and the loopback-only MCP endpoint that CLI mode lends to the
  `claude` program (D3).
- **Dependencies run one way, except through the entry point.**
  - Production files in `src/api/` import only six modules from `src/server/`: `agent-host` (as a type),
    `documents/documents`, `view-state/view-state`, `workspace-config/workspace-config`, `chat/sessions/sessions` (as
    a type), and `events/events` (as a type).
  - Test files in `src/api/` may also import `server/components/json-file` and `server/paths`.
  - Inside `src/server/`, only `server.ts` imports `src/api/`, and it imports only `createApi`. That one reverse edge
    is accepted, like `server.ts` importing `ui/index.html` today (D9).
  - No `src/ui/` file imports `src/api/`, and `src/api/` never imports `ui/index.html`.
- **Ordering.** `Bun.serve` starts serving only after `host.sessions.load()` resolves. `createApi` may run before or
  after `load()`, because it is synchronous, does no I/O, and never calls `sessions.current()`.
- **Mount order.** The order is health, workspace-config, documents, sessions, view-state, then events, the same as
  today.
- **Where checks live.** Each feature's error mapping and request-body validation stay inside its routes file. Path
  safety stays in the domain.

### Failure Behavior

The split changes no failure behavior. Every route answers bad input and failed operations exactly as it does today,
quirks included, because the move keeps each routes file's body unchanged.

- **Invalid documents request bodies** get a 400 with an `{ error }` sentence. The zod schemas and the `body()` helper
  throw `DocumentError('invalid', …)`, and the documents sub-app's `onError` maps it.
- **A missing document** gets a 404 with `{ error }`. Other `DocumentError` reasons get a 400. Any other error in the
  documents routes gets a plain-text 500.
- **A chat request with bad `documents`** gets a 400 with `{ error: 'documents must map file names to markdown' }`.
  The `openFile` value is dropped when it is not a non-empty string.
- **A chat request for an unknown session, or for a session with a turn already running,** gets a 409 with `{ error }`.
  Malformed JSON on the chat route gets Hono's plain-text 500. Chat `text` is not validated.
- **A failure after the chat stream starts** reaches the client as a stream error part inside a 200 SSE response, not as
  an HTTP status. Recording, disconnect safety, and releasing the turn lock all stay in the domain.
- **A failed `POST /api/sessions` or `PUT /api/view-state`** gets a 500 with the raw `error.message` as `{ error }`.
- **A failure in workspace-config, health, or the event socket** has no handler and gets Hono's plain-text 500. The
  socket has no `onError`.
- **`createApi` itself** never throws, because it only builds Hono apps. Startup failures stay where they are today.

## Why Each Element Is Here

Each row cites one source: the goal, a context-brief finding (F#), or a decision (D#). Rows marked "changed" or "new"
came out of the question or validation round.

| Element | What it does | Justification |
| --- | --- | --- |
| B1 `src/api/` | A new top-level package beside `server/`, `ui/`, and `shared/` | Goal: "into a new package". The name is the goal's own word, "APIs" (O2, D2, D7) |
| B2 Feature folders `documents/`, `chat/`, `view-state/`, `workspace-config/`, `events/` | Mirror the server's feature names | Necessity of the README "Features" rule: a capability that spans packages uses the same name in each |
| B3 `chat/sessions.routes.ts`, flat (changed) | Keeps the chat routes directly in `chat/` | Necessity of README "Components" (lines 22-24). The folder is `chat/` because the feature is `chat` in server and ui. `sessions` is one component of the server's multi-component chat feature, and the api's chat feature has only one component |
| B4 `*.routes.ts` file names | Keep today's names | Necessity of no behavior change; `git mv` keeps history |
| B5 `api.ts` at the package root | Holds the package's entry point | Necessity of the README entry-point rule and `SKILL.md:48` |
| B6 `createApi` as the only export | The single door from server into api for non-test code | Goal: "splitting apart" |
| B7 `workspace: string` parameter | Passes the workspace to documents, view-state, workspace-config, and health | Necessity: each of those needs it (F1, F2, F6) |
| B8 `host: AgentHost` parameter, type-only | Passes `Sessions` and `EventBus` | Necessity: the sessions routes and the event socket need them (F1, F6, F7) |
| B9 Order `(workspace, host)`, both required | Fixes the call shape | Necessity: both are required; positional parameters match the existing factory style (F1) |
| B10 Returns `{ fetch, websocket }` | Hands `Bun.serve` both halves of the API | Necessity: `/ws/events` cannot upgrade unless `websocket` reaches `Bun.serve` beside `fetch` (F11), and `server.ts` may no longer import `hono/bun`. A scratch `tsc` run confirmed that `Bun.serve` accepts `Hono['fetch']` |
| B11 `fetch` is `app.fetch`, unbound | Lets Bun call it as `(req, server)` | Necessity: `upgradeWebSocket` reads the Bun server from `fetch`'s second argument (F11) |
| B12 `websocket` imported in `api.ts` (changed) | Keeps both halves of the `hono/bun` transport in one package | Necessity plus cohesion. `websocket` holds no state; its handlers read the `ws.data.events` that only `upgradeWebSocket` sets. The earlier claim that it "must be the same module instance" was wrong and is withdrawn (Q11) |
| B13 `/api/health` inside `createApi` (changed) | Moves the health route with the rest of the HTTP API, same body | Goal: "splitting apart the http … APIs". `check.ts:127` needs only a 2xx status; the body is kept under the no-behavior-change rule (F32) |
| B14 Mount order | Keeps today's route order | Necessity of the preserved wire contract (F32) |
| B15 Error handling stays per routes file | Keeps every status code and body | Necessity: Hono applies a sub-app's `onError` only to that sub-app (F17, F18, F32) |
| B16 Body validation stays in the routes files | Keeps the zod schemas, `openFile` coercion, and `isDocuments` | Necessity: the domain trusts its inputs (F25); this also keeps the chat 400 that `check.ts` asserts (F32) |
| B17 Path safety stays in the domain | Adds no path checks to the api | Necessity: the domain functions are already safe with any string (F24) |
| B18a Production import rule (changed) | Limits production `src/api/` files to six `src/server/` modules, plus `src/shared/**`, `hono`, `hono/bun`, `ai`, and `zod` | Necessity: exactly what the routes import today (F7). Goal: "splitting apart" keeps production coupling to the domain surface (D6) |
| B18b Test import rule (new) | Also lets `src/api/` tests import `server/components/json-file` and `server/paths` | Necessity: `view-state.routes.test.ts:6` and `workspace-config.routes.test.ts:6` use them (F31, D6) |
| B19 `DocumentError` imported as a value | Keeps `instanceof` and `throw new DocumentError('invalid', …)` working | Necessity: the 400 and 404 mapping depends on the same class (F17, F19) |
| B20 Only `server.ts` imports `src/api/` | Keeps the domain from depending on the transport | Goal: "splitting apart"; keeps F3. Written rule, checked by done-when gate 6 (D9) |
| B21 No `src/ui/` import of `src/api/` | Extends the README's ui-never-imports-server rule | Necessity: api imports server, so a ui import would break that rule. Checked by gate 7 |
| B22 No `ui/index.html` import from `src/api/` | Keeps one server-to-ui link | Necessity: that import is the only allowed link (F13). Checked by gate 8 |
| B23 `Bun.serve`, `homepage`, `development`, `PORT` stay in `server.ts` | Keeps the page and the process in the entry point | Necessity: F13, F14 |
| B24 `idleTimeout: 255` stays on `Bun.serve` | Keeps long agent turns from being cut off | Necessity: SSE pauses outlast Bun's 10-second default (F12). Documented on the api side by B37 |
| B25 `listening on` line unchanged | Keeps the line the scripts parse | Necessity: `check.ts` and `make check-build` parse it (F32, `Makefile:20-21`) |
| B26 `watchDocuments` bridge stays in `server.ts` | Keeps `documents-changed` events flowing | Necessity: `/ws/events` delivers them only while the bridge runs (F5, F10) |
| B27 `load()` before `Bun.serve` (changed) | Guarantees a current session before any request | Necessity: `GET /api/sessions/current` assumes `load()` has run (F22). Whether `createApi` runs before or after `load()` does not matter (B28) |
| B28 `createApi` is synchronous, no I/O | Makes construction safe at any time | Necessity: construction must never touch `current()` before `load()` (F22) |
| B29 `createApi` does not throw | Leaves startup failures where they are | Necessity: it only builds Hono apps (F10) |
| B30 Per-route failure behavior unchanged | Keeps every quirk listed under Failure Behavior | Necessity of the preserved wire contract (F17, F20, F23, F27, F32) |
| B31 Four routes tests move with their sources | Keeps each test beside the factory it calls | Necessity: they call `.request()` on the factory (F30) |
| B32 `sessions.test.ts` split (changed) | Removes the domain test's import of the routes; adds one 201 test in api | Necessity of B20 (F31). Decision D8 |
| B33 `Makefile:38` runs `src/api` too (changed) | Keeps the moved tests running under `make test-server`, whose name stays | Necessity: an unchanged line silently drops 22 tests in 4 files (250 run instead of 272; F15). Decision D5 |
| B34 Other build and test paths unchanged | Leaves `Makefile:11`, `package.json`, `check.ts`, `server.test.ts`, `paths.ts`, and `tsconfig.json` alone | Necessity: F14, F15, F16. `bun build --compile` follows `server.ts` into `src/api/`; a scratch `make check-build` passed |
| B35 README and source comments updated (changed) | Makes the docs describe the new package and its import rules | Necessity: the README is the only written home for the import rules, and the last restructure treated README drift as a finding. Decision D9 for the dependency sentence. Details below |
| B36 Owner's layout rules updated (new) | Adds `src/api/` and its import rules to `.claude/skills/update-code-structure/SKILL.md` | Necessity: that skill runs unattended against its "Target layout" (`SKILL.md:23-26, 36-37`) and would otherwise flag `src/api/` as a violation. Decision D4. This changes the owner's rules on the strength of the delegation alone, so it ships as its own commit and is reported to the owner |
| B37 `api.ts` header comments (new) | Records the ordering rule, the `idleTimeout` dependency, and the `ws.data` pairing | Necessity: after the split, each of these spans two packages (F22, F12, B12) |
| B38 Done-when checklist (new) | Defines what proves the move preserved behavior | Necessity of the last restructure's baseline-count rule (`SKILL.md` Step 1.3) |

**B35 in detail: the README and source-comment edits.** These README lines change:

- Lines 17-19, the Packages bullet, add `src/api/`, the HTTP and WebSocket layer, which runs in Bun. The bullet states
  this sentence word for word: "src/api depends on src/server's domain modules; server.ts is the only file in
  src/server that imports src/api."
- Lines 20-21 change "spans both packages" to "spans packages".
- Line 27 names server and ui explicitly where it says "both packages", because "both" is ambiguous with four
  packages.
- Line 35 says each server feature has a domain file and its routes live under `src/api/<feature>/`.
- Lines 38-40 say `server.ts` serves the page and the app `createApi` builds, and no longer mounts routes.
- Lines 51, 83, 86, 90, and 95 point each routes file at its new folder.
- A new `### src/api/` section describes `api.ts` and the feature folders.
- Line 200 describes `make test-server` as running the server, api, and shared tests.

These source comments change: `server.ts:1-3`, `agent-host.ts:1-2` (src/api now maps the feature objects onto routes
and sockets), `documents.ts:2`, `ui/app.tsx:2`, and `documents.routes.ts:1`.

Historical docs are not edited. Files under `docs/changes/**` (other than this folder) and `docs/research/**` are dated
snapshots, so their old paths stay correct as history. One example is `docs/research/live-workspace-file-watching.md:441`.

### Decision log

The owner's standing delegation for planning runs is "make the best decisions you can, without asking me". D1–D9 rest
on it, and each also cites its evidence.

| # | Decision | Evidence |
| --- | --- | --- |
| D1 | Choose Option B over A and C | A leaves the Hono app, health, and the `websocket` handler in `src/server`, so the APIs are only partly split apart. C adds five interfaces with one implementation each and a new error protocol, for a separate build nobody asked for |
| D2 | "Package" means a top-level `src/` folder, not a unit that builds on its own | README:17 defines packages as top-level `src/` folders, and the goal names no separate build. Option C is deferred; reopen it if `src/api` must build, test, or ship without `src/server` |
| D3 | The MCP endpoint stays in `src/server` | `mcp-endpoint.ts:31-32` is CLI mode's per-call tool bridge for the `claude` program, bound to 127.0.0.1. The UI never calls it. The contract says "no Hono in `src/server`", not "no HTTP in `src/server`" |
| D4 | Add `src/api/` to the update-code-structure skill's rules (B36) | `SKILL.md:39-48` lists three packages and the skill runs unattended against them |
| D5 | Keep the `make test-server` name | People type it, and a rename was not asked for |
| D6 | Separate the production import rule from the test rule (B18a, B18b) | Checked against every current import in the five routes files and four test files |
| D7 | Keep the name `src/api/` | It is the goal's own word. Its overlap with `ui/components/api.ts`, and `/ws/events` sitting outside `/api/`, make searches noisier but cause no import conflict. `src/http/` would misname the WebSocket |
| D8 | Split the Clear Chat test (B32) | The route's call to `create()` is a one-line delegation (`sessions.routes.ts:17`). `check.ts` already proves the route plus a real `Sessions` end to end (`POST /api/sessions` → 201 `{id}`, F32) |
| D9 | Accept the package loop `src/server` → `src/api` → `src/server` | It passes only through the entry point, like `server.ts` → `ui/index.html` today (README:18-19). `server.ts` cannot leave `src/server` (F14, README:31-32), and breaking the loop the other way means Option C, which D2 defers. Answers design-options §6 Q5 |

### Done when

Run every command from the repo root. Gates 1 through 9 need no API key. Gate 10 is manual and needs a live Claude
backend.

1. `make test` passes:
   - `tsc --noEmit` is clean.
   - `test-server` reports 273 pass, 0 fail (today's 272 plus B32's added test).
   - `test-ui` reports 446 pass, 0 fail.

   This run includes the `server.test.ts` test "a running server tells every event socket when a workspace file changes
   on disk". It spawns `server.ts` with no real key and receives `documents-changed` on `/ws/events`, which proves
   `createApi`'s two halves reach `Bun.serve`. The type check also catches any relative import that was not
   recomputed. These are the paths to recompute:

   ```
   src/api/chat/sessions.routes.ts          ../../../shared/wire   -> ../../shared/wire
                                            ./sessions             -> ../../server/chat/sessions/sessions
   src/api/documents/documents.routes.ts    ./documents            -> ../../server/documents/documents
   src/api/view-state/view-state.routes.test.ts        ../components/json-file -> ../../server/components/json-file
   src/api/workspace-config/workspace-config.routes.test.ts  ../paths -> ../../server/paths
   ```

2. `make check-build` passes. The compiled binary serves `/api/workspace-config` and reports its version.
3. A manual smoke test against `bun run server` answers on health, documents, and view-state, and the startup line keeps
   its `3pitor listening on <url> (workspace: ...)` shape:

   ```sh
   OPEN_BROWSER=0 ANTHROPIC_API_KEY=unused PORT=4321 bun run server
   # in another shell:
   curl -fsS http://localhost:4321/api/health        # {"ok":true,"workspace":"...","bun":"..."}
   curl -fsS http://localhost:4321/api/documents     # 200, document list JSON
   curl -fsS http://localhost:4321/api/view-state    # 200, view-state JSON
   ```

4. No Hono import remains in `src/server`. This prints nothing:

   ```sh
   grep -rnE "['\"]hono(/[a-z-]+)?['\"]" src/server
   ```

5. No routes file remains in `src/server`. This prints nothing:

   ```sh
   find src/server -name '*.routes*.ts'
   ```

6. Only `server.ts` imports `src/api`, and it imports only `createApi`. The first command prints nothing, and the
   second succeeds:

   ```sh
   grep -rlE "['\"](\.\./)+api/" src/server --include='*.ts' | grep -vx 'src/server/server.ts'
   [ "$(grep -E "['\"](\.\./)+api/" src/server/server.ts)" = "import { createApi } from '../api/api';" ]
   ```

7. No `src/ui` file imports `src/api`. This prints nothing. The UI's own `components/api` does not match, because
   `src/ui` has no `api/` folder:

   ```sh
   grep -rnE "['\"](\.\./)+api/" src/ui
   ```

8. `src/api` does not import `src/ui`. This prints nothing:

   ```sh
   grep -rnE "['\"](\.\./)+ui/" src/api
   ```

9. `src/api` imports only the allowed `src/server` modules. Both commands print nothing:

   ```sh
   find src/api -name '*.ts' ! -name '*.test.ts' -exec grep -hoE "['\"](\.\./)+server/[^'\"]+" {} + \
     | sed -E "s#^['\"](\.\./)+##" | sort -u \
     | grep -vxE 'server/(agent-host|documents/documents|view-state/view-state|workspace-config/workspace-config|chat/sessions/sessions|events/events)'
   find src/api -name '*.test.ts' -exec grep -hoE "['\"](\.\./)+server/[^'\"]+" {} + \
     | sed -E "s#^['\"](\.\./)+##" | sort -u \
     | grep -vxE 'server/(agent-host|documents/documents|view-state/view-state|workspace-config/workspace-config|chat/sessions/sessions|events/events|components/json-file|paths)'
   ```

10. Manual, with a real key: `ANTHROPIC_API_KEY=<real key> bun run check` passes. It drives chat and the SSE stream
    against a live Claude backend. Neither this run nor CI has run it.
11. The docs match:
    - The README carries the D9 sentence word for word.
    - The `api.ts` header covers the three B37 points.
    - No historical doc changed.

    The first command prints one line, and the second prints nothing:

    ```sh
    grep -nF "src/api depends on src/server's domain modules; server.ts is the only file in src/server that imports src/api." README.md
    git diff --name-only main...HEAD -- docs/changes docs/research | grep -v '^docs/changes/split-api-package/'
    ```

12. B36 is isolated. Each commit that touches the skill touches only that file, and the report to the owner names the
    change:

    ```sh
    git log --format=%h main..HEAD -- .claude/skills/update-code-structure/SKILL.md
    git show --name-only --format= <sha>     # for each listed commit: only .claude/skills/update-code-structure/SKILL.md
    ```

## Options Considered

The architect produced three options. The full sketches are in [design-options.md](./design-options.md).

### Option B: one `createApi` factory — chosen

`createApi(workspace, host)` builds the whole Hono app, health route included, and returns `{ fetch, websocket }`. The
server package then has no Hono import at all, and the only new code is one plain function. Its shape follows from what
already exists: `Bun.serve` needs both halves (F11), and the routes need a workspace, a `Sessions`, and an `EventBus`,
which `AgentHost` already bundles (F6).

### Option A: move the route files, keep the assembly in `server.ts` — rejected

The five route factories and a new `healthRoutes` move to `src/api/` with their current signatures. `server.ts` keeps
building the Hono app and keeps importing `websocket` from `hono/bun`. It is the smallest diff, but the Hono app, the
mount table, and the WebSocket handler stay in the server package. The APIs would be only partly split apart, and the
`upgradeWebSocket`/`websocket` pair, which talks through `ws.data`, would span two packages.

### Option C: interfaces owned by the api package — rejected for now

`src/api/ports.ts` would declare the interfaces the routes need, and `server.ts` would build adapters from the domain,
so `src/api` would import nothing from `src/server`. That would let the api build or ship on its own. It costs five
interfaces with one implementation each, plus a duck-typed error protocol instead of `instanceof DocumentError`. That protocol
is a new way for errors to slip through. Nothing asks for a separate build today (D2). Reopen this option if `src/api` must
build, test, or ship without `src/server`.

Smaller variants were also rejected:

- **Returning the Hono app.** It would leak Hono's type into `server.ts`, and nothing outside the api needs it.
- **An options object.** It would add a new type when `AgentHost` already exists.
- **`src/http/` and `src/ws/`.** The goal says "a new package".
- **`src/server/api/`.** A folder inside server is not a package.
- **Moving `Bun.serve` into the api.** That would make the api import `ui/index.html`, and it would move the
  `listening on` line that `check.ts` parses (F13, F32).

## Questions Resolved

The junior developer raised 18 questions. The architect's own open questions from the options round were covered by
them, apart from the package loop. The validator caught that one, and D9 answers it.

| # | Question | Answer | Source |
| --- | --- | --- | --- |
| Q1 | Does "to allow splitting apart" mean a `src/` folder now, or a package that builds on its own later? | A `src/` folder. Option C is deferred, with a trigger to reopen it | D2 |
| Q2 | Is the MCP endpoint's own `Bun.serve` part of "the http APIs"? | No. It stays in `src/server`, and the contract says "no Hono", not "no HTTP" | D3 |
| Q3 | Who updates the owner's layout rules in the update-code-structure skill? | This change does, in its own commit, reported to the owner (B36) | D4 |
| Q4 | What does "package" mean in the README now? | The Packages bullet is rewritten to add `src/api/` by what it holds and where it runs (B35) | Goal; README:17 |
| Q5 | Who updates the other stale README lines and source comments? | B35 now lists every line and comment | Junior's evidence; last restructure's treatment of README drift |
| Q6 | Should `make test-server` keep its name? | Yes; only its recipe and README description change | D5 |
| Q7 | Should one import rule cover both production code and tests? | No. B18a covers production, and B18b adds two test-only helpers | D6 |
| Q8 | How are the import rules enforced? | Written in the README and the skill, and checked by shell commands in the done-when list. No test, because nothing shows a need | Validation V4; cut list |
| Q9 | Is `api` the right name? | Yes. It is the goal's own word, and the collisions are search-only | D7 |
| Q10 | Why is the folder `chat/` when the routes are `/api/sessions`? | `chat` is the feature name in server and ui. `sessions` is a component, and the api's chat feature has only one (B3) | README "Components" |
| Q11 | Must `websocket` be the same module instance as `upgradeWebSocket`? | No. It holds no state and reads `ws.data.events`. B12 now rests on cohesion, and Option B still beats A on the goal | `node_modules/hono/dist/adapter/bun/websocket.js` |
| Q12 | Does `check.ts` read the health body's `ok` field? | No; it reads the response status. The body is kept under the no-behavior-change rule (B13) | `check.ts:127` |
| Q13 | Do B32, B33, and B34 hold, and with no CI on pull requests, what catches a missed Makefile edit? | They hold. The done-when list pins the test counts | Junior's scratch run; last restructure's baseline counts |
| Q14 | Where is the ordering rule written down? | In the `api.ts` header (B37) | F22 |
| Q15 | Is it fine that `idleTimeout` stays outside the api? | Yes. The `api.ts` header records why the SSE route needs it (B24, B37) | F12 |
| Q16 | What proves the change is done? | The 12-gate done-when list (B38) | Last restructure's baseline-count rule |
| Q17 | Should the compiled binary get a WebSocket smoke test? | No; that gap predates this change. `server.test.ts` covers `/ws/events` from source | Cut list |
| Q18 | Does splitting the Clear Chat test lose the route-plus-real-`Sessions` proof? | `check.ts` already proves it end to end | D8; F32 |

## Validation Findings

The adversarial validator re-ran the suites (272 server and shared tests, 446 UI tests) and re-counted the moved tests
(11 + 6 + 3 + 2 = 22). It found nothing that blocks the design.

| # | Finding | Disposition | What changed or why it does not hold |
| --- | --- | --- | --- |
| V1 | The package loop through `server.ts` was never decided, and Q1 went unanswered | Accepted in part | Added D9 and the exact README sentence (B35), checked by gates 6 and 11. The Q1 half is rejected: D2 answers it |
| V2 | `bun run check` is a done-when gate that needs a live Claude backend and was never run | Accepted | Gate 10 is now marked manual with a real key. Gates 1-3 give no-key coverage: `server.test.ts`, `make check-build`, and a curl smoke test |
| V3 | The grep for Hono missed double quotes, bare imports, and dynamic imports | Accepted | Gate 4 uses a stricter pattern. The `server.ts` comment no longer quotes `'hono'`, which the new grep would have matched |
| V4 | The import rules had only a one-time manual check | Accepted | Gates 5-9 are repeatable commands. Gate 1 lists the import paths to recompute |
| V5 | The comments disagreed on whether `createApi` or `Bun.serve` must follow `load()` | Accepted | The rule is now "`Bun.serve` after `load()`" in the `server.ts` comment, B27, B37, and the `api.ts` header |
| V6 | Historical docs cite the old paths | Accepted | B35 says historical docs are snapshots and are not edited. Gate 11 checks it |
| V7 | B36 changes the owner's rules on the delegation alone; README line 27 is not an obvious edit | Accepted in part | B36 ships as its own commit and is reported to the owner (gate 12). The line 27 doubt is rejected: with four packages, "both packages" is ambiguous |
| V8 | The Clear Chat test's line range was slightly off | Accepted | B32 cites `sessions.test.ts:443-455` and keeps the `useModel`/`turn` setup |
| V9 | Hono types reach `server.ts` only by inference; `Hono['fetch']` meets Bun's `(req, server)` call | Confirmed, no change | `server.ts` writes no Hono type, and `upgradeWebSocket` reads the server from `c.env`. Re-run `make test` when implementing |
| V10 | The scratch-copy results (`tsc`, `check-build`, 250 vs 272) could not be independently checked | Confirmed, no change | Gates 1 and 2 re-prove both when the change is built |

## Cut List

Each entry is something this change could have carried but the goal did not ask for. You can reinstate any of them, and
your direction becomes its justification.

- **One shared error handler that turns every failure into a JSON `{ error }`.** Cut because it would change response
  bodies: today's plain-text 500s would become JSON (F17).
- **A 404 instead of a 409 for an unknown chat session.** Cut because it changes the domain and the wire (F20).
- **A 400 instead of a text 500 for malformed chat JSON.** Cut because it changes a status code (F20).
- **Validating chat `text` and the view-state body.** Cut because the view-state body is unchecked by design, and
  checking chat text is a behavior change (F26).
- **Hiding raw error messages in 500 bodies.** Cut because it changes response bodies, and no attacker-triggered path
  was shown (F27).
- **Listening only on 127.0.0.1, and checking Host and Origin on every route and the WebSocket.** Cut because the
  exposure predates the split and belongs in its own change (F28). See Open Risks.
- **Blocking paths on another Windows drive.** Cut because it is a domain-layer bug that the api never touches (F29).
- **Shared constants for the URL strings.** Cut because it touches the UI and tests on both sides, and the split works
  without it (F9).
- **Named types for the untyped response bodies (`{ok}`, `{id}`, `{cancelled}`, health).** Cut because the contract is
  preserved without them (F8).
- **Adding `/api/workspace-config` and `/api/health` to the README endpoints table.** Cut because the gap predates the
  split. B35 updates only the layout prose (F33).
- **Separate packages for HTTP and WebSocket.** Cut because the goal says "a new package" (O1).
- **Isolating event listeners from each other, and adding a WebSocket `onError`.** Cut because it is a behavior change
  (F23).
- **Returning `idleTimeout` from `createApi`.** Cut because the split does not need it; the `api.ts` header records the
  dependency instead (B37).
- **Folding `workspace` into `AgentHost`.** Cut because it changes `agent-host.ts` for no gain.
- **A unit test of the assembled app.** Cut because `check.ts` and `server.test.ts` already cover it end to end (F32).
- **Making `server.ts` importable without starting the server.** Cut because nobody asked, and the tests rely on
  spawning it (F10).
- **A test that enforces the import rules.** Cut because nothing shows a need. The written rules and gates 5-9 cover it
  (Q8).
- **A WebSocket probe in `make check-build`.** Cut because that gap predates this change (Q17).
- **Renaming `make test-server`.** Cut because people type it (D5).
- **Renaming the package to avoid the `ui/components/api.ts` overlap.** Cut because `src/http/` would misname the
  WebSocket (D7).
- **Moving the MCP endpoint into the api.** Cut because it is CLI mode's tool bridge, not the app's API (D3).
- **Option C's interfaces, so `src/api` builds without `src/server`.** Deferred, not dropped (D2). Reopen it if
  `src/api` must build, test, or ship on its own.

## Open Risks

- **The network exposure stays.** The server listens on every network interface, with no Host or Origin check on any
  route or on `/ws/events`. The security analyst rated this High for local-network access, and Medium for cross-site
  WebSocket hijacking, CSRF through `text/plain` POSTs, and DNS rebinding (F28). It matters whenever 3pitor runs on a
  shared network or while you browse untrusted sites. The split neither fixes nor worsens it. Once `createApi` exists,
  it is the natural single place to add those checks.
- **The Windows path escape stays** (F29). It matters as soon as anyone runs 3pitor on Windows.
- **`bun run check` is unverified.** The chat and SSE paths were not exercised against a live Claude backend in this run
  (gate 10). It matters if the move breaks the chat stream in a way the stubbed route tests and `server.test.ts` cannot
  see.
- **The import rules rest on prose and shell checks.** A later change can break them silently between runs of gates
  5-9. It matters if `src/api` ever needs to build on its own, which is also Option C's reopen trigger.
- **B36 edits the owner's rules.** It matters if the owner disagrees. The change is one isolated commit, so reverting
  it is cheap.

## Evidence

The numbered findings F1–F33 and open items O1–O2 are in [context-brief.md](./context-brief.md). The options round,
with the full sketches and the original element table, is in [design-options.md](./design-options.md). Citations made
directly in this document:

- `node_modules/hono/dist/adapter/bun/websocket.js` (Q11, B12)
- `src/server/scripts/check.ts:127` (B13)
- `src/server/chat/sessions/sessions.test.ts:14, 443-455` (B32)
- `src/server/chat/claude-cli/mcp-endpoint.ts:31-32` (D3)
- `.claude/skills/update-code-structure/SKILL.md:23-26, 36-48` (B36, D4)
- `docs/research/live-workspace-file-watching.md:441` (B35)

## Next Step

This document is the input to a `tdd` run that implements the contract. Start from gate 1's baseline counts, and finish
when all twelve done-when gates pass.

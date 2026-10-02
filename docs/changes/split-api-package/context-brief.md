# Context Brief: Split the HTTP and WebSocket APIs into a New Package

**Goal (verbatim):** "to allow splitting apart the http and websocket APIs into a new package"

**Reading of the goal:** "a new package" is singular, so the HTTP routes and the WebSocket endpoint leave `src/server/`
together, into one new top-level package beside `src/server/`, `src/ui/`, and `src/shared/` (the README's three
packages). The goal does not ask to split HTTP from WebSocket into two separate packages; this brief records that reading
as open item O1.

**Interface:** `src/server/documents/documents.routes.ts`, `src/server/chat/sessions/sessions.routes.ts`,
`src/server/view-state/view-state.routes.ts`, `src/server/workspace-config/workspace-config.routes.ts`,
`src/server/events/events.routes.ts`, the Hono app assembly in `src/server/server.ts`, and the wiring in
`src/server/agent-host.ts`.

**Starting point:** working tree on `main`, clean, no branch changes.

**Project conventions:** no `CLAUDE.md` or `project-discovery.md`. Conventions come from `README.md` "How `src/` is laid
out" and the previous restructure in `docs/changes/update-code-structure-2026-10-01/`.

**Agents:** codebase-explorer (CE), structural-analyst (SA), behavioral-analyst (BA), adversarial-security-analyst (SEC).
Every specialist returned usable output.

## Findings

### Current surface and dependency direction

- **F1.** Five route factories each return a Hono sub-app: `documentRoutes(workspace: string)`
  (`documents.routes.ts:13`), `sessionRoutes(sessions: Sessions)` (`sessions.routes.ts:7`),
  `viewStateRoutes(workspace: string)` (`view-state.routes.ts:6`), `workspaceConfigRoutes(workspace: string)`
  (`workspace-config.routes.ts:5`), and `eventSocket(events: EventBus)` (`events.routes.ts:6`). — CE, SA
- **F2.** Endpoints: 7 documents routes (`documents.routes.ts:22-56`), 4 sessions routes including the SSE chat stream
  (`sessions.routes.ts:10-40`), GET/PUT `/api/view-state` (`view-state.routes.ts:9-19`), GET `/api/workspace-config`
  (`workspace-config.routes.ts:8-11`), WS `/ws/events` (`events.routes.ts:9-20`), and an inline GET `/api/health` that
  returns `{ ok, workspace, bun }` (`server.ts:33`). — CE, BA
- **F3.** Dependencies run one way, routes → domain. No domain module imports a routes file. The only importers of the
  routes are `server.ts:12-16` and the tests. — SA (S1), CE (D25)
- **F4.** No domain module imports `hono` or `hono/bun`. Only `server.ts:4-5` and the five routes files do. The domain
  imports `ai` for the LLM core (`sessions.ts:3`). The one HTTP helper from `ai`, `createUIMessageStreamResponse`, is
  used only at `sessions.routes.ts:3,33`. `Sessions.chat` returns a plain `ReadableStream` (`sessions.ts:80`). — SA (S2),
  CE (D27)
- **F5.** `agent-host.ts:1-2` already states the intended seam: "Nothing below this file knows about HTTP or WebSockets:
  the server maps these objects onto routes and sockets." — SA, BA, CE
- **F6.** The domain surface the routes need is mixed:
  - `Sessions` and `EventBus` are instances, available from `createAgentHost()` as `{ events, sessions }`
    (`agent-host.ts:16-22`).
  - Documents, view-state, and workspace-config are free functions that take `workspace: string` first (for example
    `documents.ts:64` `listEntries(workspace)`).
  - No facade covers all five. `AgentHost` is exported as a type that no routes file uses. — SA (S3)
- **F7.** The routes import these value symbols from the domain:
  - `countContents, createEntry, deleteEntry, DocumentError, listEntries, moveEntry, readDocument, writeDocument`
    (`documents.routes.ts:6`)
  - `loadViewState, saveViewState` (`view-state.routes.ts:4`)
  - `loadWorkspaceConfig` (`workspace-config.routes.ts:3`)

  `Sessions` and `EventBus` are type-only imports (`sessions.routes.ts:5`, `events.routes.ts:4`). The routes use
  `Sessions.current()`, `.claude`, `.create()`, `.chat(id, {text, openFile, documents})`, and `.cancel(id)`, and
  `EventBus.subscribe(cb) → unsubscribe`. — SA (S1)
- **F8.** `shared/wire.ts` holds types only and has no imports (`wire.ts:1-2`). It holds `HostEvent`, `ChatRequest`,
  `CurrentSession`, `DocumentList`, `FolderCount`, `ApiError`, `ViewState`, and `ClaudeMode`. Some response shapes have
  no wire type: `{ok:true}`, `{id}`, `{cancelled}`, `{name, content}`, `{skills, agents}`, and the health body. — CE
  (D20), BA (B6)
- **F9.** URL strings are written out as literals on both sides: in the routes files, and in `src/ui` (`app.tsx`,
  `chat.tsx`, `documents.tsx`, `host-events.ts:13`), `src/ui/components/fake-documents-api.ts:14-49`, and
  `server.test.ts:53`. `wire.ts` has no shared route constants. — SA (S9)

### `server.ts` mixes HTTP assembly, startup, and process concerns

- **F10.** `server.ts` is a top-level-await script that exports nothing. It runs the command line (with
  `process.exit`), `chooseWorkspace`, `createAgentHost`, the `watchDocuments` → `events.emit` bridge (line 24), and
  `sessions.load()`; prints the backend label; then assembles the app (lines 32-38), calls `Bun.serve` (lines 42-51), and
  opens the browser (lines 55-67). It is not constructible in-process, which is why `server.test.ts` and `check.ts`
  spawn it. — BA (B9)
- **F11.** `websocket` from `hono/bun` (`server.ts:5`) must reach `Bun.serve` (`server.ts:48`) next to `app.fetch`, or
  `/ws/events` cannot upgrade. Whatever module owns `upgradeWebSocket` must therefore hand a `websocket` handler to
  whoever calls `Bun.serve`. — SA (S4), BA (B9)
- **F12.** `Bun.serve` sets `idleTimeout: 255` because agent turns and SSE pauses outlast Bun's 10-second default
  (`server.ts:49-50`). `PORT` is read at `server.ts:43`. — BA (B9)
- **F13.** `import homepage from '../ui/index.html'` (`server.ts:7`, used at `:45`) is the only server → ui link the
  README allows. A new package that took over assembly should not import `ui/index.html`, or it would add a second
  link. — SA (S5)
- **F14.** `server.ts`'s path is hard-coded in `Makefile:11` (the `bun build --compile` entry), `package.json:6-7`,
  `server.test.ts:10,46`, and `check.ts:87`. The README requires entry points to stay at their package root. — CE
  (D22, D23), SA (S5)
- **F15.** `tsconfig.json:13` includes all of `src`, so a new folder under `src/` type-checks unchanged. `Makefile:38`
  runs `bun test src/server src/shared`, so a new package's tests would not run unless that line changes. — CE (D22,
  D24)
- **F16.** `paths.ts` must stay directly under `src/server/` (`paths.ts:1-5`; `paths.test.ts` enforces it). Among the
  routes files' tests, only `workspace-config.routes.test.ts:6,21` uses `SRC` (for `fixtures/workspace`). — SA (S5)

### Error mapping across the boundary

- **F17.** Each route family handles errors its own way:
  - Documents uses a sub-app `onError` that maps `DocumentError` to 404 when `reason === 'not-found'` and to 400
    otherwise, with an `{error}` body. Anything else becomes a text 500 (`documents.routes.ts:16-20`).
  - Sessions uses try/catch, with 500 JSON on `create` (`:18-20`) and 409 JSON on `chat` (`:34-36`).
  - View-state PUT uses try/catch with 500 JSON (`view-state.routes.ts:16-18`).
  - Workspace-config, health, and events have no handling, so a throw becomes Hono's text 500.
  - No top-level `app.onError` exists. — BA (B1), SA (S6)
- **F18.** Hono applies a sub-app's `onError` only to that sub-app's routes (`hono-base.js:118-123`). The documents
  error mapping therefore travels with `documentRoutes`, not with the assembly. — SEC (map 4), BA (B1)
- **F19.** The HTTP layer throws the domain's error class: `body()` throws `new DocumentError('invalid', …)` when a
  request body fails validation (`documents.routes.ts:62-66`). `DocumentError` is a value import that crosses the seam
  (`documents.ts:11`). — SA (S7)
- **F20.** `sessions.chat` throws plain `Error`s before any stream exists, both for an unknown session and for a turn
  already running (`sessions.ts:80-83`). The route maps both to 409, so an unknown session gets 409, not 404. Bad JSON
  on the chat route is parsed outside the try block and becomes a text 500. `text` is never validated. — BA (B2)
- **F21.** Once `chat()` returns, the status is 200 SSE. Model and agent failures then travel as stream chunks, not as
  HTTP status codes. Recording, disconnect safety (`tee`), and the release of `session.abort` all live in the domain
  (`sessions.ts:85-158`). The HTTP layer has no part in cleanup. — BA (B3, B4)
- **F22.** `GET /api/sessions/current` reads the domain's internal `Session` (`id`, `uiMessages`, `abort`) and derives
  `running: !!abort` (`sessions.routes.ts:10-13`). It assumes `load()` has already run (`sessions.ts:58-61`,
  `server.ts:26`). — BA (B7)
- **F23.** `EventBus.emit` has no try/catch (`events.ts:14-16`), so a listener that throws skips later listeners. The
  socket listener calls `ws.send` without checking its return value, and the socket has no `onError`
  (`events.routes.ts:11-18`). — BA (B5)

### Validation and trust boundary

- **F24.** Path safety lives in the domain, not in the routes: `locate()`/`checkPath`/`resolveInWorkspace`
  (`documents.ts:38-58,184-189`) and `resolvePost` (`tools.ts:190-198`). Domain functions are safe to call with
  arbitrary strings on POSIX, so moving the routes does not lose path safety. — SEC (map 1), BA (B6)
- **F25.** Body-shape validation lives only in the routes: the zod schemas at `documents.routes.ts:8-11`, the `openFile`
  coercion at `sessions.routes.ts:26`, and `isDocuments` at `sessions.routes.ts:44-45`. The domain trusts the types it
  is given. The split must move this validation with the routes, not drop it. — SEC (map 2), SA (S6)
- **F26.** Chat `text` (`sessions.routes.ts:24`) and the view-state PUT body (`view-state.routes.ts:14`) are validated
  nowhere. The view-state body is stored as sent, by design ("the page is the only writer"). — SEC (map 3), BA (B6)
- **F27.** The 500 responses at `view-state.routes.ts:17` and `sessions.routes.ts:19` echo the raw `error.message`. That
  message can contain an absolute filesystem path from `json-file.ts:30-37`. No attacker-triggered path was shown. — SEC
  (map 4)
- **F28. (Pre-existing, outside the split.)** `Bun.serve` has no `hostname`, so it listens on every interface. There is
  no authentication, Host check, or Origin check on any HTTP route or on the `/ws/events` upgrade (`server.ts:42-48`;
  compare `mcp-endpoint.ts:32`, which pins `127.0.0.1`). SEC reports this as High (LAN access), plus cross-site
  WebSocket hijacking and CSRF through `text/plain` POSTs (Medium; `request.js:117-118` parses JSON regardless of
  Content-Type) and DNS rebinding (Medium). — SEC (SEC-001/002/003)
- **F29. (Pre-existing, domain layer.)** On Windows, `resolveInWorkspace` lets a path on another drive through
  (`workspace-path.ts:10-11`), because `relative()` returns an absolute path that does not start with `..`. — SEC
  (SEC-004)

### Tests and other consumers

- **F30.** Each `*.routes.test.ts` builds its own factory and calls `.request()` on it, with no live server (for example
  `documents.routes.test.ts:22-29`). — CE (D13)
- **F31.** One domain test imports a routes file: `sessions.test.ts:14` imports `sessionRoutes` and calls it at `:449`.
  Routes tests also import server-internal helpers: `view-state.routes.test.ts:6` imports `stateFile` from
  `../components/json-file`, and `workspace-config.routes.test.ts` imports `SRC`. — SA (S8)
- **F32.** Observable contract that consumers rely on:
  - `check.ts` parses `/listening on (http:\/\/\S+)/` from stdout and polls `GET /api/health` for `.ok`.
  - It checks status codes and body shapes, including 201 `{id}`, the chat 400 for bad `documents`, and the SSE
    `data-session` part.
  - It calls `GET /api/workspace-config` (`check.ts:169`).
  - The UI's `api()` (`ui/components/api.ts:4-19`) throws the `.error` sentence or the body text; only
    `documents.tsx:229` branches on the status (404). — BA (B10)
- **F33.** The README's endpoints table (`README.md:258-273`) leaves out `/api/workspace-config` and `/api/health`.
  Verified by the orchestrator. — CE (D8, D21)

## Conflicts resolved during merge

- CE (D19) said `check.ts` calls `POST /api/workspace-config`. The code calls `GET` (`check.ts:169`); BA's account is
  correct.

## Open items with no evidence

- **O1.** "Splitting apart the http and websocket APIs into a new package" could mean that both leave `src/server/`
  together into one package (the reading this brief uses, because the goal says "a new package") or that they also
  separate from each other. No artifact settles which.
- **O2.** The new package's name (for example `src/api/` or `src/http/`). The README's conventions name packages by where
  they run (`server`, `ui`, `shared`); none covers a transport layer.

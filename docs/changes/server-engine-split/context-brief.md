# Context Brief: Split `src/server/` into `server` (HTTP and WebSocket) and `engine` (everything else)

**Goal (owner's words, verbatim):** "i want "server" to be the package where the HTTP and Websocket code lives. it's the
main entry point for the backend services. all code that isn't HTTP API and web socket API should move into an "engine"
package"

**What this replaces:** an earlier design (`docs/changes/split-api-package/`) had the direction backwards. It moved the
routes out to a new `src/api/`. Its context brief's findings F1–F33 describe the code accurately and still apply. This
brief cites them as `F#` and adds findings for the engine side as `N#`.

**Starting point:** working tree on branch `split-api-package`. The source is unchanged from `main`; only docs changed.

**Agents:** codebase-explorer (CE), structural-analyst (SA). The orchestrator verified one conflict between them (N3).

## What stays in `server`, and what moves to `engine`

- **N1. Stays in `src/server/`: the HTTP and WebSocket code and the entry point.**
  - `server.ts`, which builds the Hono app and calls `Bun.serve`.
  - The five routes files and their four tests: `documents/documents.routes.ts`, `chat/sessions/sessions.routes.ts`,
    `view-state/view-state.routes.ts`, `workspace-config/workspace-config.routes.ts`, and `events/events.routes.ts`.
  - `server.test.ts`, which spawns `server.ts` from its own folder (`server.test.ts:10,46`).

  — CE (E1, E4), SA (S8)
- **N2. Moves to `src/engine/`: the domain code.**
  - `agent-host.ts`.
  - The chat feature: `agent` (with `system-prompt.md`), `sessions.ts`, `tools`, `claude-backend`, `claude-cli` (with
    `mcp-endpoint.ts` and `stream-json.ts`), and the `chat/components` test helpers.
  - `documents.ts`, `events.ts`, `view-state.ts`, `workspace.ts`, `workspace-config.ts` (with `app-skills.macro.ts`),
    `components/json-file.ts`, and `components/workspace-path.ts`.
  - All of their tests.

  — CE (E5–E18), SA (graph)
- **N3. Six files can't be placed from the goal's wording alone. Each is decided by where its users live:**
  - **`paths.ts`.** It must stay directly under `src/server/`; `paths.test.ts` enforces that and the README says so
    (`paths.ts:1-5`). Its six importers are `workspace.ts:4`, `app-skills.macro.ts:7`, `workspace-config.test.ts:6`,
    `agent.test.ts:10`, `workspace-config.routes.test.ts:6`, and `check.ts:6`. The orchestrator verified the six by
    grep; CE's seventh, `workspace-config.ts`, is wrong. Four importers would be engine files, two of them production
    code.
  - **`command-line.ts`.** It parses argv and the environment, and only `server.ts:10` and `server.test.ts:6` use it.
    The goal's literal wording moves it to engine. Its only users would stay in server.
  - **`scripts/check.ts`.** It spawns `server.ts` (`check.ts:87`) and drives the HTTP, SSE, and WebSocket API, but it
    imports `paths` and `workspace` (`check.ts:6-7`). It is neither engine code nor HTTP code.
  - **`text-imports.d.ts`.** It declares `.md` text imports. The only users are `agent.ts:22` and `agent.test.ts:12`,
    both engine.
  - **The startup code in `server.ts`** (lines 19-30): the command line, `chooseWorkspace`, `createAgentHost`, the
    `watchDocuments` → `events.emit` bridge, `sessions.load()`, and the backend label and warning. Running it is the
    entry point's job, but what it wires together is engine.
  - **`mcp-endpoint.ts`.** It runs its own loopback `Bun.serve` for the `claude` program (`mcp-endpoint.ts:31`). It is
    HTTP, but it serves the engine's model backend, not the app's API.

  — SA (S2, S8), CE (E2, E3, E7, E15, E19)

## The engine's shape today

- **N4. The would-be engine's internal graph has no cycles, and its leaves are clear.**
  - Edges: `agent-host` → events, sessions; `sessions` → json-file, agent, events, tools; `agent` → events,
    claude-backend, tools, workspace-config; `claude-backend` → claude-cli → mcp-endpoint, stream-json; `tools` →
    json-file, workspace-path, workspace-config; `documents` → workspace-path; `view-state` → json-file;
    `workspace-config` → app-skills.macro → paths; `workspace` → paths.
  - Leaves: events, json-file, workspace-path, stream-json, mcp-endpoint, command-line.
  - No engine module imports `hono`, `server.ts`, `command-line`, or a routes file in production code.

  — SA (graph, S9)
- **N5. The engine has no single entry point.** After the move, `server.ts` plus the five routes files import from nine
  engine modules across seven feature folders: claude-backend, agent-host, command-line, documents, workspace,
  sessions, events, view-state, and workspace-config. `createAgentHost` returns only `{ events, sessions }`
  (`agent-host.ts:16-20`). Documents, view-state, and workspace-config are free functions that each take
  `workspace: string`. — SA (S1), CE (E22, E23, E27)
- **N6. Without an entry point, server's imports mirror the engine's folder layout.** Imports from the routes files
  would run three folders deep (`../../../engine/documents/documents`), so renaming an engine folder means edits across
  server. — CE (E23), SA (S1)

## Where the engine's internals leak into server

- **N7. Chat sends AI SDK types across the boundary.**
  - `Sessions.chat` returns a bare `ReadableStream` whose content is an AI SDK UI message stream (`sessions.ts:79-80`).
    The route wraps it with `createUIMessageStreamResponse` (`sessions.routes.ts:33`), so server still imports `ai`.
  - `GET /api/sessions/current` reads the engine's internal `Session` fields `uiMessages` and `abort` and derives
    `running: !!abort` (`sessions.routes.ts:10-13`).
  - `create()` returns a full `Session`, of which the route uses only `.id`.
  - `chat()` throws plain `Error`s for both an unknown session and a turn already running (`sessions.ts:81-82`).

  — SA (S5); also F20, F22
- **N8. `DocumentError` is the one typed engine error.** Server maps its `reason` to 400 or 404 and also throws it for
  its own request-validation failures (`documents.routes.ts:16-20,62-66`). So it must be exported from the engine as a
  value, and the class identity is shared. — SA (S6); also F17, F19
- **N9. Events have publishers on both sides.** The engine publishes from `agent.ts` and `sessions.ts`. Server
  publishes once, through the watcher bridge (`server.ts:24`). The WebSocket route uses only `subscribe` (`events.ts`,
  `events.routes.ts`). `HostEvent` already lives in `shared/wire.ts`. — SA (S7)

## Tests and layout

- **N10. One engine test would import server.** `sessions.test.ts:14` imports `sessionRoutes` and calls it at `:449`.
  No file move fixes that edge; only a test change does. — SA (S3), CE (E25); also F31
- **N11. Routes tests reach into engine internals.** `view-state.routes.test.ts:6` imports `stateFile` from
  `components/json-file`, which moves to engine. `workspace-config.routes.test.ts:6` imports `SRC`. — SA (S3), CE (E26)
- **N12. Mirrored feature folders would form three same-named trees.**
  - `documents/`, `chat/`, `events/`, `view-state/`, and `workspace-config/` would each exist in both `src/server/`
    (routes) and `src/engine/` (logic). `chat/`, `documents/`, and `events/` also exist in `src/ui/`.
  - The README rule "a capability that spans both packages uses the same name in each" (`README.md:20-21`) and the
    owner's skill rules (`SKILL.md:39-47`) were written for two packages.
  - In server, `chat/` would hold only the sessions routes, so the single-component rule flattens it to
    `server/chat/sessions.routes.ts` (`README.md:22-24`).
  - `workspace/`, `components/`, and most of `chat/` have no HTTP surface.

  — SA (S4)
- **N13. Build and test paths.**
  - `Makefile:38` (`bun test src/server src/shared`) must add `src/engine`, or every engine test stops running
    silently. The owner's skill names this risk (`SKILL.md:115-117`).
  - `Makefile:11` and `package.json:6` keep working, because `server.ts` stays and `bun build --compile` follows its
    imports.
  - `package.json:7` changes only if `check.ts` moves.
  - `app-skills.macro.ts` reads `SRC/skills` at bundle time through server's entry, which works as long as `SRC` still
    resolves to `src/`.

  — CE (E21, E28–E30), SA (S8)

## Conflicts resolved during merge

- CE (E2) listed seven importers of `paths.ts`. A grep finds six; `workspace-config.ts` does not import it. SA's count
  is correct.
- CE (E3) placed `text-imports.d.ts` in server while listing only engine users. That placement is recorded as open in
  N3 instead.
- CE (E24) proposed that each engine file compute `SRC` from its own location. That contradicts `paths.ts`'s stated
  purpose ("the one place that finds src/ from a file's own location"), so it is recorded as one of the options for
  N3, not as a finding.

## Open items for the options round

- **O1.** Where `paths.ts`, `command-line.ts`, `scripts/check.ts`, and `text-imports.d.ts` live (N3).
- **O2.** Whether the startup wiring (workspace choice, host creation, the watcher bridge, and `load()`) is engine code
  that server calls, or entry-point code that stays in `server.ts` (N3, N5).
- **O3.** The flow and direction of the server → engine API: how many entry points, which objects or functions, and
  how the internals in N7–N9 cross. The owner said they would work through this with us.
- **O4.** How feature folders are named across three packages (N12).

## Update: the `cli` package and moving `mcp-endpoint.ts` (2026-10-02)

Two owner decisions changed the package set after the question round. They are quoted in the pairing record.

- **`mcp-endpoint.ts` moves to server.** The answer was "Move it to server": the engine holds no HTTP of any kind, and
  server hands the engine a `serveTools` function.
- **A new `src/cli/` package becomes the process entry point.** The owner's words: "create a separate package that
  handles starting everything from the command line. call this one "cli" it is what will create an instance of "engine"
  and pass that into the "server" constructor. so, when i call `3pitor` in a terminal prompt, the "cli" will be invoked
  to handle the entry and start everything".

The planned packages are therefore `src/cli/`, `src/server/`, `src/engine/`, `src/shared/`, and `src/ui/`. These
findings come from a discovery update by codebase-explorer (CE2).

### Everything that finds the entry point by path

- **N14. Seven places name `src/server/server.ts` as the thing to run.**
  - `Makefile:11` is the `bun build --compile` entry, with `--define THREEPITOR_VERSION`.
  - `package.json:6` is the `server` script.
  - `server.test.ts:10` and `server.test.ts:46` spawn it from the test's own folder.
  - `check.ts:87` spawns `join(SRC, 'server/server.ts')`.
  - `paths.test.ts:9` probes `server/server.ts` under `SRC`.
  - The README describes it as the entry point (`README.md:37-48`).

  — CE2 (C1, C4, C6, C11, C12, C14, C18)
- **N15. Five checks depend on the entry's printed output and exit codes.**
  - `make check-build` checks the `listening on` line and that `--version` prints `3pitor <version>`
    (`Makefile:19-27`).
  - `.github/workflows/release.yml:41,47` runs `make check-build` and checks `--version` again.
  - The release preflight runs `make test` (`.claude/skills/3pitor-release/scripts/preflight.sh:36`).
  - `check.ts:104` and the `server.test.ts` helper parse `/listening on (http:\/\/\S+)/`.

  — CE2 (C2, C13, C15–C17, D8, D9)
- **N16. The command-line rules are pinned by tests.**
  - `--version` prints `3pitor dev` and exits 0 (`server.test.ts:18-20`).
  - `--help` prints `USAGE` (`server.test.ts:22-24`, which imports `USAGE` from `./command-line`).
  - A bad `--claude` mode exits 2 with the usage line (`server.test.ts:36-42`).
  - `--version` creates no workspace folder (`server.test.ts:26-34`). So the command line must be handled before
    `chooseWorkspace`.
  - `VERSION` comes from the `THREEPITOR_VERSION` define and falls back to `dev` (`command-line.ts:6-8`).

  — CE2 (C7–C10, D1–D7)

### What each part of today's `server.ts` is

- **N17. Lines 10 and 71-84 are command-line work.** `commandLine()` calls `parseCommandLine(process.argv, process.env)`,
  prints the version or usage, and calls `process.exit(0)` or `process.exit(2)`. — CE2 (B1)
- **N18. Lines 17-30 are engine work.** That covers `chooseWorkspace`, `createAgentHost` (which takes `MODEL`), the
  watcher bridge, `sessions.load()`, and the backend label and warning. — CE2 (B2–B6)
- **N19. Lines 4-6, 32-38, 33, 42-51, and 53 are HTTP server work.** That covers the Hono app and its routes,
  `/api/health`, and `Bun.serve` with `PORT`, `NODE_ENV`, `websocket`, and `idleTimeout`. It also covers the
  `listening on` line. — CE2 (B7–B9, E5)
- **N20. Lines 7 and 45 serve the page.** `import homepage from '../ui/index.html'` feeds `routes: { '/': homepage }`.
  - The routes it feeds are part of `Bun.serve`, so the import stays wherever `Bun.serve` lives.
  - CE2 claimed that Bun bundles the HTML only from the entry file. That is unverified (see Conflicts).

  — CE2 (B10, E2)
- **N21. Lines 56-67 open the browser.** This is desktop and process work, not HTTP: it calls `Bun.spawn` with a
  per-platform command and respects `OPEN_BROWSER=0`. — CE2 (B11)
- **N22. `server.ts` runs everything when it is imported.** It awaits at the top level (lines 20, 26) and exports
  nothing. To become a constructor that `cli` calls, the startup must move into functions. The `bun build --define`
  applies to the whole module graph from whichever file is the entry (`Makefile:11`). — CE2 (B12, E1, E3)

### The path `serveTools` would travel

- **N23. `serveTools` has one production caller, four levels below `Sessions`.**
  - Signature: `serveTools(defs: LanguageModelV4FunctionTool[], tools: ToolSet, emit: (part: LanguageModelV4StreamPart) => void, abortSignal?: AbortSignal): { url: string; stop(): void }` (`mcp-endpoint.ts:6-11`).
  - Its only production call is `claude-cli.ts:107-108`, inside `runClaude`.
  - The path down is `Sessions.chat` → `agentSettings(options, events, ownerId, turn, writer)` (`agent.ts:53-59`) →
    `claudeBackend(options.claude).chatModel(modelId, tools)` (`claude-backend.ts:76-90`) →
    `claudeCliModel(modelId, tools, { webTools })` (`claude-cli.ts:27`) → `runClaude` → `serveTools`.
  - `cliBackend` and `apiBackend` are module-level constants (`claude-backend.ts:76-86`), so they cannot take an
    injected function today.

  — CE2 (C19–C29)
- **N24. Two tests depend on the MCP endpoint.** `mcp-endpoint.test.ts` calls `serveTools` directly, using `fileTools`
  and `turnTexts` from the engine's tools. `claude-cli.test.ts` drives `claudeCliModel`, which reaches `serveTools`
  internally. — CE2 (C30, C31)

### Conflicts resolved during merge

- CE2 (E1) said a file with top-level await "cannot be imported." In ES modules it can be imported; it runs on import.
  N22 records the real constraint.
- CE2 (C14) said `paths.test.ts` fails if `paths.ts` moves. The junior developer ran it from `src/engine/` and it
  passed; it checks only that `SRC` names `src/`.
- CE2 (E2) said Bun bundles `ui/index.html` only from the entry file. That is unverified, so it is recorded as open
  (N20).

### Open items for the architect amendment

- **O5.** The server constructor's signature: what it takes besides the engine (port, development mode, page), what it
  returns, and whether it calls `Bun.serve` itself or hands `fetch` and `websocket` to `cli`.
- **O6.** Where the `listening on` line, the browser opening, and the backend label are printed.
- **O7.** How `serveTools` reaches `claude-cli.ts` without the engine importing server (N23), and who builds it. The
  owner said server hands it to the engine; `cli` is the only thing that holds both.
- **O8.** Where `paths.ts` and `scripts/check.ts` go now that `server.ts` is no longer the entry point (N14).

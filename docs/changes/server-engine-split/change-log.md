# Change Log: Split `src/server` into `cli`, `server`, and `engine`

Implements [api-design.md](./api-design.md) on branch `split-api-package` (draft PR #28), test-first.

## Result

Every done-when item passes, except the live `bun run check`, which needs a real API key and was not run (item 8).
Nothing on the wire changed: the same URLs, status codes, bodies, and `listening on` line.

| Done-when | Status |
|---|---|
| 1. `make typecheck` | Passes |
| 2. `make test`, Makefile runs `src/cli src/server src/engine src/shared` | Passes: 278 Bun-side tests (24 files), 446 UI tests (16 files) |
| 3. Each folder alone | Passes: `bun test src/engine`, `src/server`, `src/cli`, `src/shared` |
| 4. Per-folder counts | Recorded below |
| 5. `make check-build` on a binary built from `src/cli/cli.ts` | Passes; `--version` printed `3pitor 0.0.0-split` with `THREEPITOR_VERSION=0.0.0-split`, and all three app skills were served |
| 6. A64 script | [`artifacts/check_boundaries.py`](./artifacts/check_boundaries.py) exits 0. It was also run against planted violations of E1, E2, A60, S1, S2, S3, C1, C3 and Env, and reported each one |
| 7. Manual `bun run` + `curl /` | Done once: `/` returned the page, its script chunk loaded (200, 4.6 MB), and `/api/health` answered |
| 8. `bun run check` | **Not run.** It needs a real `ANTHROPIC_API_KEY`; chat and SSE against a live backend are still unchecked |
| 9. Skill edit in its own commit | `67a45cd` |
| 10. README and comments | README rewritten for five packages; the A91 comments updated; no `server.ts` in `src/engine/**` comments |

## Test counts

Baseline: 272 server and shared tests (23 files), 446 UI tests (16 files).

| Folder | Design expected | Runner count |
|---|---|---|
| src/cli | 21 | 21 |
| src/server | 40 | 41 |
| src/engine | 196 + D | 198 (D = 2) |
| src/shared | 18 | 18 |
| **Total** | 275 + D = 277 | 278 |
| UI | 446 | 446 |

**Why server is 41, not 40.** The design moved the `running`/`claude` derivation test out of `sessions.routes.test.ts`
and counted it as removed. It did move: `engine.test.ts` now holds the derivation. But the route file keeps a test in
its place that checks `GET /api/sessions/current` answers what `engine.sessions.current()` reports, because otherwise
nothing tests that route.

**Where every baseline test went.**

- `src/server/server.test.ts` (5) is now `src/cli/cli.test.ts`, spawning `cli.ts`, plus the A63 load-before-serve test.
- `command-line.test.ts` (15) moved to `src/cli/`. `paths.test.ts` and every other engine-bound test moved under
  `src/engine/`, unchanged apart from imports.
- `mcp-endpoint.test.ts` (13) moved to `src/server/chat/mcp-endpoint/`. It gained the four real round trips (A85):
  - claude-cli's Edit round trip.
  - claude-cli's slow tool, then stop.
  - sessions' Edit turn, now through `createEngine(...).sessions`. Its model-history assertion reads the stored
    record (A94).
  - sessions' app-skill Read, also through `createEngine(...).sessions`.
- The engine's `claude-cli.test.ts` keeps a stub version of the slow-tool test (A86). Its `--mcp-config` test now
  checks the opaque `STUB_MCP_SERVER` entry and `stops === 1`.
- `sessions.test.ts`'s Clear Chat test calls `sessions.create()` instead of the route (A54). The 201 is now asserted in
  `sessions.routes.test.ts`, which also gained the 409 case (A62).

## Commits

1. `2a41e37` Hand the claude CLI model its tool server instead of importing the MCP endpoint. This threads
   `serveTools` through while every file was still in `src/server/`, so the type change and the move are separate
   diffs.
2. `0bb370b` Split `src/server` into cli, server, and engine packages. It adds `engine.ts`, the thin route handlers,
   `startServer`, `cli.ts`, the test moves, Makefile and package.json.
3. `1c5e0f3` Add the A64 boundary script.
4. `272bc68` Describe the packages in the README (A59).
5. `67a45cd` Update the update-code-structure skill (A66), in its own commit.
6. This change log.

## Decisions made while building

- **D1. The URL-shape check moved into `mcp-endpoint.test.ts`'s `serve()` helper.** The engine's `--mcp-config` test
  now sees only the stub's entry, so the loopback `http://127.0.0.1:<port>/mcp/<uuid>` shape would otherwise go
  untested. Putting it in the shared helper keeps the endpoint test count at 13.
- **D2. The two moved session round trips sit in a `describe` block** with their own `beforeEach` workspace. A
  file-level `beforeEach` would also run before the 15 endpoint tests that need no workspace.
- **D3. The stub slow-tool test hangs the fake with `hang` and calls the recorded `emit` after the stream ends.** That
  is the "tool finishes late" case without a real endpoint. It passed on its first run, because the `closed` guard
  already exists. Removing the guard made it fail with "Controller is already closed", so it does guard that line.
- **D4. The A62 409 test passed on its first run**, because the route already caught a synchronous throw. It pins the
  contract, as the design intended.

## Things the change log should say (from the design's open risks)

- **The fake `claude` now lists the `3pitor` MCP server whenever `--mcp-config` has a `3pitor` entry** (A93), so every
  engine test that offers tools sees it as `connected`. No test asserts the opposite.
- **The A94 stored-record assertion passes.** That confirms the record is saved before the page stream's flush
  resolves.
- **tsc has now run on the final shape**, including `McpServerEntry`, the structural `turn` helper, `startServer` and
  `startEngine`.

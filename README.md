# aiditor spike

Proves out the backend stack: Bun + TypeScript, Hono, the Vercel AI SDK (v7), and
`ai-sdk-provider-claude-code`, which runs Claude Code through the official Claude Agent SDK.

All code lives in `src/`.

- `src/server/` is split by feature. Each feature has a domain file that knows nothing about HTTP, plus a matching
  `*.routes.ts` file with its Hono routes:
  - `sessions.ts`: chat turns and cancelling.
  - `approvals.ts`: tool-use approvals.
  - `jobs.ts`: background jobs.
  - `events.ts`: the event bus. Its routes file is the WebSocket.
  - `documents.routes.ts` and `workspace-config.routes.ts`: routes only.
- Shared pieces in `src/server/`:
  - `agent-host.ts` wires the features together.
  - `claude.ts` holds the Claude Code provider settings and the code-defined agents.
  - `workspace.ts` seeds the document workspaces.
- `src/server/server.ts` is the entry point. It mounts every feature's routes on one Hono app. The app serves REST
  endpoints, the AI SDK UI message stream (SSE) for chat, and a Bun-native WebSocket for events.
- `src/shared/wire.ts` holds the event and job types that the server, the UI and the check script share.
- `src/server/scripts/` holds the end-to-end check and a debug script.
- `src/ui/` is a small React page built on the AI SDK's `useChat`. It has a document list, a ProseMirror rich text editor
  (`src/ui/markdown-editor.tsx`), a chat panel with approval cards, and a background jobs panel. Bun bundles it from `src/ui/index.html`, so there
  is no separate build step.
- `src/fixtures/workspace` is the document workspace, with a project skill (`doc-stats`) and a filesystem agent
  (`proofreader`). A second agent (`title-writer`) is defined in code.

## Run it

```sh
bun install
bun run check          # resets its own workspace, starts a server, runs every scenario
bun run check skill    # run only scenarios whose name contains "skill"
bun run server         # run the server and UI; it prints its URL (a random free port)
```

The server picks a random free port each time, so you can run several at once. Set `PORT` to use a fixed one, for
example `PORT=3737 bun run server`. It opens the UI in your default browser once it starts; set `OPEN_BROWSER=0`
to skip that.

`bun run server` uses `src/.data/workspace`, copied from the fixtures on first start. Delete that folder to reset it.
`bun run check` uses its own `src/.data/check-workspace`, so it won't disturb a running server.

`src/server/scripts/debug-background-agents.ts` reproduces the background-subagent problem described in `claude.ts`. If you
remove `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`, it shows a subagent's result spilling into the next turn.

Authentication comes from your logged-in Claude Code CLI, or from `ANTHROPIC_API_KEY` if you set it. Set `MODEL` to
change the model (the default is `haiku`).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET/PUT | `/api/documents/:name` | Load or save a markdown file in the workspace |
| POST | `/api/sessions` | Create a chat session |
| POST | `/api/sessions/:id/chat` | Send a message; responds with an AI SDK UI message stream |
| POST | `/api/sessions/:id/cancel` | Cancel the running turn |
| POST | `/api/approvals/:id` | Answer a tool approval: `{ "allow": true }` |
| POST | `/api/jobs` | Start a background job: `{ prompt, maxTurns?, maxBudgetUsd?, timeoutMs? }` |
| GET | `/api/jobs/:id` | Job status and result |
| POST | `/api/jobs/:id/cancel` | Cancel a job |
| WS | `/ws/events` | Approval requests, task events, and job status; approvals can be answered here too |

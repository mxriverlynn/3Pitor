# aiditor spike

Proves out the backend stack: Bun + TypeScript, Hono, the Vercel AI SDK (v7), and
`ai-sdk-provider-claude-code`, which runs Claude Code through the official Claude Agent SDK.

- `server/core/agent-host.ts` holds the session logic and knows nothing about HTTP: chat turns, tool approvals,
  cancelling, and background jobs.
- `server/server.ts` is the thin Hono layer over it: REST endpoints, the AI SDK UI message stream (SSE) for chat, and a
  Bun-native WebSocket for events.
- `ui/` is a small React page built on the AI SDK's `useChat`. It has a document list, a markdown editor with a live
  preview, a chat panel with approval cards, and a background jobs panel. Bun bundles it from `ui/index.html`, so there
  is no separate build step.
- `fixtures/workspace` is the document workspace, with a project skill (`doc-stats`) and a filesystem agent
  (`proofreader`). A second agent (`title-writer`) is defined in code.

## Run it

```sh
bun install
bun run check          # resets .data/workspace, starts the server, runs every scenario
bun run check skill    # run only scenarios whose name contains "skill"
bun run server         # run the server and UI at http://localhost:3737
```

`bun run server` uses `.data/workspace`, copied from the fixtures on first start. Delete that folder to reset it.
`bun run check` uses its own `.data/check-workspace`, so it won't disturb a running server.

`server/debug-background-agents.ts` reproduces the background-subagent problem described in `agent-host.ts`. If you
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

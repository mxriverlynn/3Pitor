# Unit 0 Findings: The `claude` Command, Tried by Hand

Run on 2026-09-30 against `claude` 2.1.285, signed in with a subscription, from `/private/tmp`, with
`ANTHROPIC_API_KEY` removed from the environment. A throwaway Bun stub served one MCP tool. None of it is merged.

## Confirmed as pinned

- **MCP config.** `{"mcpServers":{"3pitor":{"type":"http","url":"…"}}}` connects. `init.mcp_servers` reports
  `[{"name":"3pitor","status":"connected","source":"dynamic"}]`, and `"status":"failed"` when nothing listens.
- **Approval.** `--allowedTools "mcp__3pitor__Read,WebSearch,WebFetch"` lets `claude` call the MCP tool with no prompt.
  `--tools "WebSearch,WebFetch"` leaves exactly `WebFetch`, `WebSearch`, and the MCP tools in `init.tools`.
- **Stream-json shapes.** `stream_event` wraps `message_start`, `content_block_start` (`thinking`, `text`, `tool_use`),
  `content_block_delta` (`thinking_delta`, `signature_delta`, `text_delta`, `input_json_delta`), `content_block_stop`,
  `message_delta`, and `message_stop`. A tool run is two messages, each starting its block indexes at 0. The last line is
  `{"type":"result","subtype":"success","is_error":false,"result":"…","usage":{…}}`, with the four token counts as
  pinned.
- **A failed run.** An unknown model prints a `result` with `"subtype":"success","is_error":true` and the reason in
  `result`, then exits 1. An unknown flag prints nothing on stdout, `error: unknown option '…'` on stderr, and exits 1.
- **The MCP handshake.** `claude` first POSTs `server/discover` (protocol `2026-07-28`). The pinned `-32601` answer for an
  unknown method makes it fall back to `initialize` with `protocolVersion` `2025-11-25`, then
  `notifications/initialized`, a `GET` (answered 405), `tools/list`, and `tools/call`. A `tools/call` carries
  `_meta` next to `name` and `arguments`.

## Changed pins

- **User settings, skills, and plugins load under `--system-prompt`.** The first run listed 80 skills, the user's
  agents, and four of the user's own MCP servers. Every call now also passes `--setting-sources ""`,
  `--disable-slash-commands`, and `--strict-mcp-config` (the last one even with no tools, so the user's MCP servers
  never load). With them, `init` lists 0 skills, 0 slash commands, and only the `3pitor` MCP server.
- **`claude` times out an MCP `tools/call` after about 60 seconds.** A 70-second stub tool came back as a timeout the
  model then apologized for. With `MCP_TOOL_TIMEOUT=120000` in the child's environment the same call succeeded. The
  child now runs with `MCP_TOOL_TIMEOUT=86400000` (one day), so only the writer's stop ends a long Task call, matching
  [D-20](change-decision-log.md#d-20-the-mcp-endpoint-never-times-out-a-tool-call).

## Not checked

- What a signed-out `claude`, or one past its usage limit, prints. Both would need the operator's account changed. The
  generic `claude failed` and `claude exited` messages carry whatever it says.
- Whether `claude` exits promptly on SIGTERM. The tests kill the fake `claude`; a real one is killed the same way.

# Research: Which library should run Claude Code sessions for an AI-backed markdown editor?

Which library should a reusable backend package use to run Claude Code agent sessions, both interactive chat and
unattended runs, for a markdown editor with skills and custom agents, given a preference for Bun, Go, or Rails?

Evidence mode: strict (the default).

## Summary

Use Anthropic's official Claude Agent SDK for TypeScript, running on Bun (a JavaScript runtime), as the core of your
backend package. It is Claude Code packaged as a library, so skills, custom agents, slash commands, hooks, and plugins
all work the way they do in the terminal.

It handles both of your modes. Interactive chat uses a long-lived session you keep feeding messages to. Background
work uses a one-off run with a turn limit and a spending cap.

Put an HTTP and WebSocket API in front of that package, and build every UI against that API. A Rails app, a web page,
or a desktop app can each be one of those UIs.

If you want the core itself in Go or Ruby, there is no official library for either. You would drive the Claude Code
command-line tool yourself, which is documented but more work. The unofficial Go and Ruby wrappers are too small or
too stale to build on.

Two limits to plan for. Anthropic's docs say a product built on the SDK must bill through an Anthropic API key, not a
Claude.ai subscription login. Whether that rule covers a tool you build only for yourself is an open question, and
metered billing can cost more than a subscription for long unattended runs. The SDK also ships almost daily as a
pre-1.0 package, so pin its version.

How solid this is: the SDK's features rest on Anthropic's own documentation, which is consistent across many pages but
not independently checked. The overall architecture is confirmed by three unrelated open-source projects that use the
same shape.

- **Confidence:** Medium
- **Web search:** used

## Research Results

### The official SDK is Claude Code packaged as a library

The Claude Agent SDK is Anthropic's official way to embed Claude Code in your own program. It exists for TypeScript and
Python only (A1, A2, A3, A12). Under the hood, each session starts the real `claude` command-line program as a
separate process. It talks to that process over standard input and output, so one session is one operating-system
process (A1, A13). Both packages bundle that program, so most installs need nothing else (A3, A12).

Because it runs the real Claude Code, the SDK keeps the features you asked for:

- **Skills** are `SKILL.md` folders under `.claude/skills/`. The SDK finds them on disk, and you can limit which ones a
  session may use (A6).
- **Custom agents** (Claude Code's subagents, helper agents the main agent can hand work to) can be passed in code
  through an `agents` option, which Anthropic recommends for SDK apps. They can also come from `.claude/agents/*.md`
  files (A7).
- **Slash commands, CLAUDE.md memory, hooks, and MCP servers** all load. MCP (Model Context Protocol) is the standard
  way to plug extra tools into an agent. You can also define custom tools as in-process functions in your own code
  (A6, A8, A11).
- **Project settings load by default.** Unless you turn it off, a session reads the project's `.claude/` settings, MCP
  config, and hooks. Anthropic states this on three separate pages (A8, A9, A11), and its hosting guide tells
  multi-user deployments how to turn it off (A13).

```text
settingSources: []                      # turn off automatic loading of user/project settings
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1       # plus a per-tenant CLAUDE_CONFIG_DIR, for multi-tenant isolation
```

A third-party blog found during search claimed the opposite, that the SDK loads no settings by default. The
first-party pages above contradict it, so this report follows the first-party pages.

### TypeScript is ahead of Python on the features a harness needs

The TypeScript SDK has a much larger set of hook events than the Python SDK. Hooks are callbacks that run at points in
the agent's lifecycle, and Python omits several, including session start and end (A11). The TypeScript SDK also has
newer features that Python lacks: pre-warming a process before a prompt arrives, and a `Workflow` tool for
orchestrating many agents (A7, A15) [single-source for the Workflow tool]. Anthropic's hosting guide describes
its long-running patterns in TypeScript method names (A13).

Python has one advantage. Its `ClaudeSDKClient` object tracks a chat session for you across turns. TypeScript uses
repeated `query()` calls with a `continue` or `resume` option, or one long streaming call (A4). An earlier TypeScript
session API with `createSession()` was removed in version 0.3.142, so do not design around it (A4).

### Sessions support both chat and background runs

The SDK has two input modes, and they map onto your two use cases (A5):

- **Streaming input mode** keeps a session process open and feeds it messages as the user types. It supports queued
  messages, interrupting mid-task, image uploads, and approval prompts inside the loop. Anthropic calls it the
  preferred mode and recommends it for chat interfaces.
- **Single message mode** sends one prompt and reads results until done. It is simpler and fits one-shot jobs. It
  cannot be interrupted or take follow-up messages mid-run.

Sessions can be resumed by ID, continued from the most recent one, or forked into a new branch that leaves the
original untouched. Both SDKs can list sessions, read their messages, and rename or tag them, which is enough to build
a session picker (A4). TypeScript returns a query object with an `interrupt()` method for cancelling (A15).

For unattended runs, you cap them with a maximum number of turns and a maximum dollar budget. Hitting either ends the
run with a specific error result, and the budget covers helper agents too (A39). There is no built-in wall-clock
timeout, so your package has to enforce one (A13, A39). Hooks such as `Stop`, `SessionEnd`, and `Notification` are
the documented way to tell your system a run finished or needs attention (A11) [single-source for using them as
completion callbacks; no project examined does this].

### Approvals, undo, and persistence are yours to wire up

When the agent wants to run a tool that needs approval, the SDK calls a `canUseTool` function you supply. Your package
can forward that request to the UI over a WebSocket and wait for the answer. The same callback handles the agent's
own clarifying questions (A9, A14). Anthropic's demo repo shows exactly this round trip, with approval cards sent over
a WebSocket (A42). Permission modes range from asking for everything to auto-accepting edits, and you can switch modes
mid-session (A9).

File checkpointing gives you an undo for the agent's edits. When enabled, the SDK snapshots files the agent changes
with its Write and Edit tools, and you can roll them back. It does not cover edits made through shell commands, and
it does not rewind the conversation (A10). For a markdown editor, where the agent mostly edits files directly, that
covers the main case.

Session history is saved as JSONL files (one JSON record per line) on the local disk by default. It is lost when a
container restarts unless you add a `SessionStore` adapter that copies transcripts to durable storage (A4, A13).
Anthropic's own chat demo loses all state on restart and says so in its README (A43).

### Anthropic's hosting guide describes four session patterns

Anthropic documents four ways to run sessions. The right one depends on how long each session lives (A13):

- **Ephemeral:** one container per task, destroyed afterward. Fits background jobs.
- **Long-running:** persistent containers that keep sessions open. Fits active chat.
- **Hybrid:** containers that load a session from the `SessionStore` on start and save it on stop. Fits documents a
  user returns to now and then.
- **Multi-agent container:** several sessions sharing one container.

Anthropic gives a starting size of about 1 GiB of memory, 5 GiB of disk, and one CPU per session (A13).

### Bun works, with two known rough edges

The TypeScript SDK lets you pick Bun, Node, or Deno to run the Claude Code process, so Bun is officially supported
(A15). Anthropic acquired Bun in December 2025, and Claude Code itself ships as a Bun program (A19). The acquisition is
recent, so Bun's long-term direction under Anthropic is not yet proven.

Two issues are worth knowing about:

1. If you compile your own app into a single Bun executable, the SDK cannot find its bundled program without a
   documented workaround (A15) [single-source].
2. An open GitHub issue from April 2026 reports a crash (`Bun is not defined`) when the bundled program runs under
   Node. The workaround is to force Bun, which you would be doing anyway (A18) [single-source].

### Go and Ruby have no official Claude Code library

Anthropic publishes official Go and Ruby libraries for its general Messages API (A32, A33), but none for Claude Code.
From those languages you have three routes:

- **Drive the command-line tool yourself.** Claude Code has an official headless mode: print mode (`-p`), streamed
  JSON output, and resume by session ID. Without the `--bare` flag, a headless run loads the same skills, agents,
  slash commands, hooks, and MCP servers as an interactive one (A21). This keeps every feature, but you write the
  process management and message parsing that the SDK gives TypeScript for free. The flags change between Claude
  Code releases (A21).
- **Use a community wrapper.** Four unofficial Go wrappers exist, with about 2 to 173 GitHub stars and no stated
  stability policy. At least one covers only non-interactive runs (A25, A26, A27, A28). Three unofficial Ruby gems
  exist, and none has shipped a release since July 2025 (A29, A30, A31).
- **Use the Messages API directly** and write your own agent loop. This is the most stable interface, but you lose
  custom agents, slash commands, hooks, and CLAUDE.md (A32, A33). Skills are the exception: they now work through
  the plain API with the code-execution tool (A38) [single-source].

### Anthropic's hosted agent service is a different harness

Claude Managed Agents, in beta since April 2026, is a hosted service where Anthropic runs the agent loop and stores
sessions for you. It is built for long-running, resumable work and has official Go, Ruby, and TypeScript clients
(A34, A35, A36). It uses the same `SKILL.md` format for skills (A37).

But its agent definition has no slash commands, and it replaces Claude Code's custom agents with a different
multi-agent setup (A36). It is not currently eligible for Zero Data Retention or HIPAA agreements (A34). No source
confirmed that it can run Claude Code itself, so treat it as a separate product (A35, A36). Its self-hosted mode,
where your own server runs the tools, is built around asynchronous work rather than live chat (A41).

### ACP is a standard protocol option for many UIs

The Agent Client Protocol (ACP) is an open protocol from Zed Industries for connecting an AI agent to any editor.
Zed built an adapter, now `claude-agent-acp`, that wraps the official TypeScript SDK and speaks ACP (A22, A23). At
launch in September 2025 it lacked plan mode and many built-in slash commands (A22). Its current README lists custom
slash commands, nested subagent transcripts, permission requests, and edit review (A23, A24). Treat that 2025
limitation as out of date, but check the live repo before relying on it.

ACP is built for code-editor clients. No source showed it serving a browser-based document editor.

### Prior art takes the same shape, but none is a reusable library

Every working project examined follows the same pattern. A thin server starts Claude Code processes, streams their
output to a client, and keeps session state either in Claude Code's own session folder or in a database (A42, A43,
A44, A45, A46). Each one is a full application, not a package other UIs import (A44, A45, A46). One,
claude-code-webui, is archived and unmaintained (A45).

The closest match to your editor idea is Nimbalyst, the successor to the Crystal session manager. It is a desktop app
that edits markdown files alongside Claude Code (A47). No project found runs Claude Code as a backend library for a
markdown editor, so you would be building something new.

### Licensing and login

Anthropic's docs say, on two separate pages, that third-party products may not offer Claude.ai login or its usage
limits without prior approval. Use an API key or a cloud provider account instead (A1, A12). Use of the SDK in a
product falls under Anthropic's Commercial Terms of Service (A1, A2, A3). The Python SDK's own code is MIT-licensed
(A3). Products may not call themselves "Claude Code," but "Powered by Claude" is allowed (A1).

The legal terms themselves were not read directly. These findings come from the SDK docs' own summary of them.

The rule is written about third-party products that offer Claude.ai login to their users (A1, A12). No source says
whether it applies when you build a tool only for yourself and sign in with your own subscription. Treat that as an
open question, and ask Anthropic before relying on a subscription.

Cost is the other half of this. API usage is billed per token, so long unattended runs may cost more than a flat
subscription would. No source compared the two.

## Options to Consider

### O1: Official TypeScript Agent SDK on Bun as the core package

- **What it is:** Your backend package is a Bun and TypeScript service that wraps the official SDK. It exposes HTTP and
  WebSocket endpoints for documents, sessions, chat, approvals, and background jobs. UIs, including a Rails app, talk
  only to those endpoints.
- **Trade-offs:** It is the only option that is official, keeps every Claude Code feature you named, supports both chat
  and background runs, and runs on one of your preferred stacks. The costs: near-daily 0.x releases, including a
  breaking type change in the week before this research (A17). You also build persistence, a wall-clock timeout,
  tenant isolation, and an auth layer yourself (A13, A43). Several of those shrink for a single-user tool, because
  tenant isolation and per-session sizing are aimed at multi-user deployments (A13). If you want the core in Go or
  Ruby, this option does not do that.
- **Rests on:** (A1), (A2), (A4), (A5), (A6), (A7), (A9), (A11), (A13), (A15), (A17)
- **Evidence status:** corroborated

### O2: Go or Rails core that drives the `claude` command-line tool directly

- **What it is:** Your package, written in Go or Ruby, starts `claude` in headless mode for each session, reads its
  streamed JSON, and tracks session IDs.
- **Trade-offs:** It keeps the full feature set, because it runs Claude Code itself, and it relies on no third-party
  wrapper (A21). But you rebuild what the SDK already provides: process lifecycle, message parsing, approval
  round-trips, and interrupt handling. You also follow the command-line tool's flag changes yourself (A21). The SDK
  uses the same subprocess model, which shows the command-line contract is stable enough to build on. It does not show
  that a hand-built wrapper is low-risk, because the SDK absorbs much of the complexity for you (A13).
- **Rests on:** (A21), (A13)
- **Evidence status:** corroborated for the mechanism (A21 and A13 agree). The exact headless contract rests on A21
  alone, which is Anthropic's own reference.

### O3: Community Go or Ruby wrappers

- **What it is:** Use an unofficial Go module or Ruby gem that wraps the command-line tool.
- **Trade-offs:** It saves you writing a parser and gives you idiomatic types. But adoption is small, no wrapper states
  a stability policy, one covers only non-interactive runs, and the Ruby gems are more than a year stale (A25 through
  A31). You take on both Claude Code's changes and the wrapper author's pace.
- **Rests on:** (A25), (A26), (A27), (A28), (A29), (A30), (A31)
- **Evidence status:** corroborated as a pattern across seven projects. Each project's own figures are single-source.

### O4: Add an ACP layer on top of O1 (an add-on, not an alternative)

- **What it is:** Put the `claude-agent-acp` adapter, or your own ACP server, in front of the SDK so that any
  ACP-compatible client can drive it.
- **Trade-offs:** It is a ready-made standard for "one agent, many clients," and the adapter already sits on the
  official SDK (A23). But it is maintained by a third party, it is shaped around code editors, and its feature
  coverage changed a lot in one year (A22, A23). It layers on top of O1 rather than replacing it.
- **Rests on:** (A22), (A23), (A24)
- **Evidence status:** corroborated on current coverage (A23, A24). The 2025 gaps in A22 are superseded.

### O5: Messages API with your own agent loop

- **What it is:** Use Anthropic's official Go, Ruby, or TypeScript client and write the tool loop yourself.
- **Trade-offs:** It is the most stable interface and works in all three of your languages (A32, A33). But you lose
  custom agents and slash commands, two of the three features you named, plus hooks and CLAUDE.md. Only skills carry
  over (A38).
- **Rests on:** (A32), (A33), (A38)
- **Evidence status:** corroborated for client maturity. Skills through the API is single-source (A38).

### O6: Claude Managed Agents (hosted)

- **What it is:** Anthropic hosts the agent loop and session storage, and your backend calls its REST API.
- **Trade-offs:** It removes hosting work and suits long unattended runs (A34, A35). But it is a different harness. It
  has no slash commands and uses a different multi-agent model, it is in beta, and it is not eligible for Zero Data
  Retention or HIPAA (A34, A36). It could handle background jobs later, but no source shows it combined with the
  SDK.
- **Rests on:** (A34), (A35), (A36), (A37), (A41)
- **Evidence status:** corroborated across first-party pages. Whether it can run Claude Code itself is unverified.

## Recommendation

- **Recommendation:** O1. Build the core package on the official TypeScript Claude Agent SDK, run it on Bun, and expose
  your own HTTP and WebSocket API for every UI. Use streaming input mode for interactive chat and single-message runs
  with turn and budget caps for background jobs. Bridge approvals through `canUseTool`, persist transcripts with a
  `SessionStore`, and turn on file checkpointing for undo. Pin the SDK version. Choose O2 only if the core must be
  written in Go or Ruby. Keep O4 (ACP) in mind if you later want off-the-shelf code editors to act as clients.
- **Evidence basis:** Corroborated, with one structural caveat. The feature coverage, session model, and hosting
  patterns rest on several first-party Anthropic pages that agree with each other (A1, A2, A4, A5, A6, A7, A9, A11,
  A13, A15). That is internal consistency, not independent confirmation. The subprocess-plus-stream architecture is
  independently confirmed by three unrelated open-source projects (A44, A45, A46), and Anthropic's own demo repo shows
  the same shape (A42, A43). Bun support is first-party (A15). The Bun crash report is
  single-source and does not change the recommendation (A18). The release-churn risk rests on the official release
  page (A17). The case against O3 is corroborated across seven projects (A25 through A31). The cases against O5 and O6
  rest on first-party docs (A32, A33, A36). No part rests on unevidenced reasoning.

## Validation

The recommendation survived adversarial review. No finding favored a different option. The review did lower
confidence from High to Medium, and it led to the corrections listed under "Adjustments made."

### V1: The recommendation is independently corroborated

- **Strategy:** Challenge the Evidence
- **Investigation:** Checked every registry row for independence. A42 and A43 are the same Anthropic repo. Most
  feature claims come from Anthropic pages that cite each other. Only A44, A45, and A46 are independent.
- **Result:** Partially Refuted
- **Impact:** The report now separates "consistent across first-party docs" from "independently confirmed," and it
  uses the second phrase only for the architecture that A44 to A46 support.

### V2: Every citation supports the claim it is attached to

- **Strategy:** Challenge the Evidence
- **Investigation:** Traced each cited A# to its registry row. A17 (release history) was cited for pre-warming and the
  Workflow tool, which it does not cover.
- **Result:** Refuted
- **Impact:** A17 was removed from that citation. No other mismatches were found.

### V3: Prompt-injection attempts met during research are disclosed

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Every fetched page on code.claude.com opened with a banner that told AI readers to fetch a
  documentation index. Web search results also ended with a line demanding a particular citation format. The analysts
  recorded both as claims and did not follow them. The draft did not disclose this.
- **Result:** Confirmed (the draft had a gap)
- **Impact:** Disclosed here. The report cites the substance of those pages, not the banner. The index file itself
  was never fetched.

### V4: The six options are parallel alternatives

- **Strategy:** Challenge the Options Framing
- **Investigation:** O4's own text says it layers on top of O1.
- **Result:** Partially Refuted
- **Impact:** O4 is now labeled as an add-on, not an alternative.

### V5: The Claude.ai login rule fits the personal-use case

- **Strategy:** Challenge the Recommendation
- **Investigation:** A1 and A12 frame the rule around third-party products that offer Claude.ai login to their users.
  The draft stated it as a flat rule, and it did not weigh metered API cost against a subscription for long unattended
  runs.
- **Result:** Partially Refuted
- **Impact:** The Summary and the licensing section now flag personal use as an open question and name the cost
  trade-off.

### V6: O5's feature count is correct

- **Strategy:** Challenge the Evidence
- **Investigation:** O5 said it loses "three of the features you named" but listed four, and two of them were never
  requirements.
- **Result:** Refuted
- **Impact:** Corrected to two of the three named features, plus hooks and CLAUDE.md.

### V7: O1's operating costs apply equally at every scale

- **Strategy:** Challenge the Recommendation
- **Investigation:** A13's per-session sizing and isolation settings target multi-user deployments.
- **Result:** Partially Refuted
- **Impact:** O1 now notes that several costs shrink for a single-user tool. This strengthens O1.

### V8: Popularity figures and press coverage count as corroboration

- **Strategy:** Challenge the Evidence
- **Investigation:** A20 and A40 are not cited in the argument. A19's "independent press" is press repeating the same
  announcement.
- **Result:** Partially Refuted
- **Impact:** A19's evidence status is downgraded. None of these sources carries weight in the recommendation.

### V9: The search tool's injected formatting line shaped the report

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Checked the prose for inline links. Citations use A# identifiers only.
- **Result:** Refuted
- **Impact:** None. Subtler effects on word choice cannot be ruled out from the finished text.

### V10: Dropping one single-source item flips the recommendation

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Removed each single-source item in turn (A15's compile workaround, A18, A38, the completion-hook
  use in A11, A19, A20).
- **Result:** Refuted
- **Impact:** None at the level of single citations. The structural risk is that most pillars depend on Anthropic's
  documentation being accurate and current as a class.

### V11: A13 shows that a hand-built command-line wrapper (O2) is low-risk

- **Strategy:** Challenge the Options Framing
- **Investigation:** A13 describes the SDK's own subprocess design, not anyone building a wrapper without it.
- **Result:** Partially Refuted
- **Impact:** O2's wording now says the command-line contract is stable enough to build on, not that the approach is
  low-risk.

### V12: The Bun acquisition only reduces risk

- **Strategy:** Challenge the Evidence
- **Investigation:** The acquisition is about nine months old, and the draft gave no counterweight.
- **Result:** Partially Refuted
- **Impact:** The Bun section now notes that its long-term direction under Anthropic is not yet proven.

### Adjustments Made

- Lowered confidence from High to Medium (V1, V10).
- Removed a citation that did not support its claim (V2).
- Disclosed the prompt-injection attempts met during research (V3).
- Relabeled O4 as an add-on (V4).
- Flagged personal-use login and metered cost as open questions (V5).
- Corrected O5's feature count (V6), O1's cost framing (V7), A19's evidence status (V8), O2's wording (V11), and the
  Bun caveat (V12).

The recommendation itself did not change.

### Confidence Assessment

- **Confidence:** Medium
- **Remaining Risks:**
  - Nearly every feature claim depends on Anthropic's documentation being accurate and current. The docs agree with
    each other, but no independent source checks them.
  - The SDK is pre-1.0 and releases almost daily, so specifics such as method names and removed APIs may change.
  - Whether a personal tool may sign in with a Claude.ai subscription is unresolved.
  - The Bun crash report (A18) and the compile workaround (A15) are single-source. Check them against the SDK version
    you pin.
  - Managed Agents' ability to run Claude Code itself is unverified. Revisit it if hosted background runs become
    attractive.

## Sources

| ID  | Source | Link / location | Retrieved | Trust class | Summary (one line) | Evidence status |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Agent SDK overview | https://code.claude.com/docs/en/agent-sdk/overview | 2026-09-25 | web | SDK is Claude Code as a library for TS/Python; no claude.ai login in third-party products; Commercial Terms apply; branding rules | corroborated by A12, A2, A3 |
| A2 | claude-agent-sdk-typescript repo | https://github.com/anthropics/claude-agent-sdk-typescript | 2026-09-25 | web | Official TS package, Node 18+, ~1.8k stars, active; use governed by Commercial Terms | corroborated by A1, A17, A20 |
| A3 | claude-agent-sdk-python repo | https://github.com/anthropics/claude-agent-sdk-python | 2026-09-25 | web | Official Python SDK, bundles CLI, MIT code, `ClaudeSDKClient` stateful client | corroborated by A1, A2 |
| A4 | Work with sessions | https://code.claude.com/docs/en/agent-sdk/sessions | 2026-09-25 | web | Resume/continue/fork, list/tag sessions, local JSONL transcripts, SessionStore; TS V2 session API removed in 0.3.142 | corroborated by A13, A10 |
| A5 | Streaming Input | https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode | 2026-09-25 | web | Streaming input mode preferred for interactive use (queue, interrupt, images); single mode for one-shot | corroborated by A14, A42 |
| A6 | Extend agents with skills | https://code.claude.com/docs/en/agent-sdk/skills | 2026-09-25 | web | SKILL.md discovered from `.claude/skills` via settingSources; `skills` option scopes use; slash commands dispatch | corroborated by A4, A13 |
| A7 | Subagents in the SDK | https://code.claude.com/docs/en/agent-sdk/subagents | 2026-09-25 | web | Programmatic `agents` option (recommended) or `.claude/agents` files; caps on depth, concurrency, budget; Workflow tool (TS) | corroborated by A13; Workflow tool single source |
| A8 | Connect to external tools with MCP | https://code.claude.com/docs/en/agent-sdk/mcp | 2026-09-25 | web | MCP over stdio/SSE/HTTP plus in-process SDK tools; `.mcp.json` loads by default | corroborated by A9, A11 |
| A9 | Configure permissions | https://code.claude.com/docs/en/agent-sdk/permissions | 2026-09-25 | web | Six-step permission order ending in `canUseTool`; six modes; mode changeable mid-session; settings load by default | corroborated by A8, A11, A14 |
| A10 | Rewind file changes with checkpointing | https://code.claude.com/docs/en/agent-sdk/file-checkpointing | 2026-09-25 | web | Checkpoints Write/Edit changes and rewinds files; not Bash edits; not conversation history | corroborated by A4 |
| A11 | Intercept agent behavior with hooks | https://code.claude.com/docs/en/agent-sdk/hooks | 2026-09-25 | web | Hook events; TS set much larger than Python's (no SessionStart/End in Python); Notification hook for status updates | corroborated by A9; completion-callback use single source |
| A12 | Agent SDK quickstart | https://code.claude.com/docs/en/agent-sdk/quickstart | 2026-09-25 | web | Node 18+/Python 3.10+; API key or Bedrock/Vertex/Foundry auth; repeats no-claude.ai-login rule | corroborated by A1 |
| A13 | Hosting the Agent SDK | https://code.claude.com/docs/en/agent-sdk/hosting | 2026-09-25 | web | One subprocess per session; four session patterns; SessionStore; ~1 GiB/5 GiB/1 CPU; no session timeout; multi-tenant isolation settings | corroborated by A4, A42–A46 |
| A14 | Handle approvals and user input | https://code.claude.com/docs/en/agent-sdk/user-input | 2026-09-25 | web | `canUseTool` handles approvals and AskUserQuestion; waits indefinitely; defer hook for slow humans | corroborated by A9, A5 |
| A15 | TypeScript SDK reference | https://code.claude.com/docs/en/agent-sdk/typescript | 2026-09-25 | web | `Query.interrupt()`, `streamInput()`, `startup()` prewarm; `executable: 'bun'`; bun --compile workaround | corroborated by A2; compile workaround single source |
| A16 | PyPI claude-agent-sdk | https://pypi.org/project/claude-agent-sdk/ | 2026-09-25 | web | Python SDK 0.2.159 released 2026-09-23, MIT, Python 3.10+ | corroborated by A3 |
| A17 | TS SDK GitHub releases | https://github.com/anthropics/claude-agent-sdk-typescript/releases | 2026-09-25 | web | v0.3.282 (Sep 24, 2026); near-daily releases; breaking type change in v0.3.281 | corroborated by A20 on cadence; breaking change single source |
| A18 | Issue #266, "Bun is not defined" | https://github.com/anthropics/claude-agent-sdk-typescript/issues/266 | 2026-09-25 | web | Open since 2026-04-03: bundled CLI crashes under Node; workaround is `executable: "bun"` | single source (caveated) |
| A19 | Bun is joining Anthropic | https://bun.com/blog/bun-joins-anthropic | 2026-09-25 | web | Anthropic acquired Bun (Dec 2025); Bun stays MIT open source | press re-reports of the same announcement, seen via search results only; unverified |
| A20 | npm @anthropic-ai/claude-agent-sdk | https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk | 2026-09-25 | web | 130+ versions, 600+ dependents (Mar 2026); bundles native binary | corroborated by A2, A17 (seen via search results; npm page blocked direct fetch) |
| A21 | Run Claude Code programmatically (headless) | https://code.claude.com/docs/en/headless | 2026-09-25 | web | `-p`, stream-json, resume; non-`--bare` runs load skills/agents/hooks/MCP; contract changes by CLI version | single source (first-party); mechanism consistent with A13 |
| A22 | Zed: Claude Code via ACP | https://zed.dev/blog/claude-code-via-acp | 2026-09-25 | web | Sept 2025: Zed-built ACP adapter wraps the SDK; lacked plan mode and many built-in slash commands | superseded by A23, A24 |
| A23 | claude-agent-acp repo | https://github.com/agentclientprotocol/claude-agent-acp | 2026-09-25 | web | Current adapter on official SDK: custom slash commands, subagent transcripts, permissions, edit review; Apache-2.0 | corroborated by A24 |
| A24 | ACP adapter search aggregate | npmjs / zed.dev / deepwiki pages for claude-agent-acp | 2026-09-25 | web | Confirms current slash-command support; some stale 2025 text echoed | corroborated by A23 |
| A25 | severity1/claude-agent-sdk-go | https://github.com/severity1/claude-agent-sdk-go | 2026-09-25 | web | Unofficial Go wrapper, ~173 stars, v0.2.5, no stability policy | pattern corroborated by A26–A28 |
| A26 | lancekrogers/claude-code-go | https://github.com/lancekrogers/claude-code-go | 2026-09-25 | web | Unofficial Go wrapper, ~49 stars, non-interactive `-p` only, tracks flag churn by hand | pattern corroborated by A25, A27, A28 |
| A27 | jonwraymond/go-claude-code-sdk | https://github.com/jonwraymond/go-claude-code-sdk | 2026-09-25 | web | Unofficial Go wrapper, ~6 stars | pattern corroborated by A25, A26, A28 |
| A28 | jrossi/claude-code-sdk-golang | https://github.com/jrossi/claude-code-sdk-golang | 2026-09-25 | web | Unofficial Go port of Python SDK, ~2 stars | pattern corroborated by A25–A27 |
| A29 | claude_code gem | https://rubygems.org/gems/claude_code | 2026-09-25 | web | Unofficial Ruby gem v0.0.18, last release 2025-07-16, ~2.4k downloads | pattern corroborated by A30, A31 |
| A30 | claude_code_sdk gem | https://rubygems.org/gems/claude_code_sdk | 2026-09-25 | web | Unofficial Ruby port of Python SDK v0.1.0, last release 2025-07-10 | pattern corroborated by A29, A31 |
| A31 | claude-code-sdk-ruby gem | https://rubygems.org/gems/claude-code-sdk-ruby | 2026-09-25 | web | Unofficial Ruby gem v0.1.6, last release 2025-07-30, ~190k downloads | staleness corroborated by A29, A30; downloads single source |
| A32 | anthropic-sdk-go | https://github.com/anthropics/anthropic-sdk-go | 2026-09-25 | web | Official Go Messages API client v1.75.0; has Managed Agents bindings; no Claude Code harness | corroborated by A33 |
| A33 | anthropic-sdk-ruby | https://github.com/anthropics/anthropic-sdk-ruby | 2026-09-25 | web | Official Ruby Messages API client v1.73.0; has Managed Agents bindings; no Claude Code harness | corroborated by A32 |
| A34 | Claude Managed Agents overview | https://platform.claude.com/docs/en/managed-agents/overview | 2026-09-25 | web | Hosted agent harness in beta; server-side sessions; for long-running async work; no ZDR/HIPAA yet | corroborated by A35, A36 |
| A35 | Scaling Managed Agents (engineering blog) | https://www.anthropic.com/engineering/managed-agents | 2026-09-25 | web | April 2026 launch; sessions/harness/sandbox design; no documented way to select Claude Code as the harness | corroborated by A34 |
| A36 | Managed Agents: Define your agent | https://platform.claude.com/docs/en/managed-agents/agent-setup | 2026-09-25 | web | Agent schema has no slash-command field; `multiagent` replaces Claude Code subagents; Go/Ruby/TS clients | corroborated by A34, A37 |
| A37 | Managed Agents: Skills | https://platform.claude.com/docs/en/managed-agents/skills | 2026-09-25 | web | Same SKILL.md format; attach per agent or from a mounted repo's `.claude/skills` | corroborated by A36 |
| A38 | Using Agent Skills with the API | https://platform.claude.com/docs/en/build-with-claude/skills-guide | 2026-09-25 | web | Skills usable from plain Messages API via code-execution tool and `container.skills` | single source (caveated) |
| A39 | How the agent loop works | https://code.claude.com/docs/en/agent-sdk/agent-loop | 2026-09-25 | web | `maxTurns` and `maxBudgetUsd` end runs with error results; budget covers subagents; no wall-clock timeout | corroborated by A13 |
| A40 | Claude Code sandboxing | https://anthropic.com/engineering/claude-code-sandboxing | 2026-09-25 | web | OS-level filesystem and network sandbox; credentials injected outside the sandbox | corroborated by A13 on isolation; 84% figure single source |
| A41 | Managed Agents self-hosted sandboxes | https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes | 2026-09-25 | web | Your worker long-polls for tool jobs; async-first; custom subagent support not described | corroborated by A34 |
| A42 | claude-agent-sdk-demos | https://github.com/anthropics/claude-agent-sdk-demos | 2026-09-25 | web | Official demos: WebSocket chat app, AskUserQuestion approval cards; local development only | corroborated by A13 |
| A43 | simple-chatapp README | https://github.com/anthropics/claude-agent-sdk-demos/blob/main/simple-chatapp/README.md | 2026-09-25 | web | Express + WebSocket; state lost on restart; run SDK in a separate service; no auth | corroborated by A4, A13 |
| A44 | opcode (formerly Claudia) | https://github.com/winfunc/opcode | 2026-09-25 | web | Tauri desktop GUI; process per agent; reads `~/.claude/projects`; no server API | corroborated by A47 |
| A45 | claude-code-webui | https://github.com/sugyan/claude-code-webui | 2026-09-25 | web | Web UI wrapping the CLI with streaming chat and permission dialogs; archived; no auth | corroborated by A46 |
| A46 | claudecodeui / CloudCLI | https://github.com/siteboon/claudecodeui | 2026-09-25 | web | Web/mobile UI for Claude Code; discovers sessions from `~/.claude`; long-running sessions | corroborated by A45 |
| A47 | Crystal / Nimbalyst | https://github.com/stravu/crystal, https://nimbalyst.com/ | 2026-09-25 | web | Crystal deprecated Feb 2026; Nimbalyst is a desktop visual editor that edits markdown with Claude Code | corroborated across its two sites |

### A1: Agent SDK overview — recommendation-bearing

- **Link / location:** https://code.claude.com/docs/en/agent-sdk/overview
- **Retrieved:** 2026-09-25
- **Trust class:** web (outside the trust boundary; first-party Anthropic documentation)
- **Summary:** Describes the Agent SDK as Claude Code packaged as a library for Python and TypeScript. It lists built-in
  tools, hooks, subagents, MCP, permissions, sessions, and skills, commands, and memory as supported. It states that,
  unless previously approved, third-party developers may not offer claude.ai login or its rate limits, and should use
  API key authentication. Use in products is governed by Anthropic's Commercial Terms of Service. "Claude Code"
  branding is not allowed, while "Powered by Claude" is.
- **Evidence status:** corroborated by A12, A2, A3

### A4: Work with sessions — recommendation-bearing

- **Link / location:** https://code.claude.com/docs/en/agent-sdk/sessions
- **Retrieved:** 2026-09-25
- **Trust class:** web (first-party Anthropic documentation)
- **Summary:** Sessions can be continued, resumed by ID, or forked. Session IDs come from the result and init
  messages. Transcripts are JSONL files under `~/.claude/projects/`, keyed by working directory. Both SDKs can list,
  read, rename, and tag sessions. Resuming across hosts needs a moved transcript or a `SessionStore` adapter. The
  experimental TypeScript V2 session API was removed in 0.3.142.
- **Evidence status:** corroborated by A13, A10

### A5: Streaming Input — recommendation-bearing

- **Link / location:** https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- **Retrieved:** 2026-09-25
- **Trust class:** web (first-party Anthropic documentation)
- **Summary:** Streaming input mode is the preferred mode and supports images, queued messages, interruption, and
  persistent context, which suits interactive UIs. Single message mode is simpler and suits stateless one-shot jobs,
  but it has no images, no queueing, and no real-time interruption.
- **Evidence status:** corroborated by A14, A42

### A13: Hosting the Agent SDK — recommendation-bearing

- **Link / location:** https://code.claude.com/docs/en/agent-sdk/hosting
- **Retrieved:** 2026-09-25
- **Trust class:** web (first-party Anthropic documentation)
- **Summary:** Each `query()` starts a separate `claude` process over stdio, so N sessions means N processes. The
  guide describes ephemeral, long-running, hybrid, and multi-agent-container patterns and a `SessionStore` adapter for
  transcripts. It sizes each session at about 1 GiB of memory, 5 GiB of disk, and 1 CPU. It lists no top-level session
  timeout as a known limitation. For multi-tenant isolation it gives `settingSources: []`, disabling auto memory, and
  a per-tenant config directory.
- **Evidence status:** corroborated by A4, A42, A43, A44, A45, A46

### A15: TypeScript SDK reference — recommendation-bearing

- **Link / location:** https://code.claude.com/docs/en/agent-sdk/typescript
- **Retrieved:** 2026-09-25
- **Trust class:** web (first-party Anthropic documentation)
- **Summary:** `query()` returns a `Query` object with `interrupt()`, `setPermissionMode()`, `streamInput()`, and
  `rewindFiles()`. `startup()` pre-warms a process. The `executable` option picks Bun, Deno, or Node to run the Claude
  Code process. For `bun build --compile` executables, the docs prescribe an `extractFromBunfs()` workaround.
- **Evidence status:** `interrupt()` corroborated across two doc mirrors and by A2. The compile workaround is single
  source.

### A17: TS SDK GitHub releases — recommendation-bearing

- **Link / location:** https://github.com/anthropics/claude-agent-sdk-typescript/releases
- **Retrieved:** 2026-09-25
- **Trust class:** web (official Anthropic repository)
- **Summary:** The latest release is v0.3.282 (September 24, 2026), at parity with Claude Code v2.1.282. Patch
  releases ship almost daily. v0.3.281 changed the type of `Settings.attribution`, a breaking type change.
- **Evidence status:** corroborated by A20 on release cadence. The breaking change is single source.

# 3pitor

<img src="assets/3pitor-logo.png">

An editor for blog posts written in markdown, with Claude built in. You edit posts in a rich text editor and work on
them with Claude in a chat panel. Claude never writes files: its edits appear in the editor as
unsaved changes, merged with anything you type while it works, and only your Save writes a file.

It is built on Bun + TypeScript, Hono, and the Vercel AI SDK (v7) with its Anthropic provider, which calls the Anthropic
API directly. It needs no `claude` program.

All code lives in `src/`.

- `src/server/` is split by feature. Each feature has a domain file that knows nothing about HTTP, plus a matching
  `*.routes.ts` file with its Hono routes:
  - `sessions.ts`: chat turns and cancelling.
  - `events.ts`: the event bus. Its routes file is the WebSocket.
  - `documents.routes.ts` and `workspace-config.routes.ts`: routes only.
- Shared pieces in `src/server/`:
  - `agent-host.ts` wires the features together.
  - `agent.ts` builds each chat turn's model, instructions, and tools, including the `Task` tool that runs
    subagents.
  - `tools.ts` holds the model's file tools (Read, Write, Edit, Glob, Highlight), which cannot reach outside the
    workspace. They read and change a per-turn copy of the posts, started from what the editor holds; nothing in them
    writes a file. A finished turn sends each edited post's final text to the browser, which merges it into the
    editor. Highlight names passages of a post for the editor to highlight, and refuses a quote that is not in the
    post exactly once.
  - `workspace-config.ts` loads the workspace's skills and agents from `.claude/`, plus the app's own skills and the
    code-defined agents. A workspace skill replaces an app skill of the same name.
  - `app-skills.macro.ts` is a Bun macro that embeds every `.md` file under `src/skills/` when the server is bundled,
    so the app's skills are inside `build/3pitor`. The model reads them through `3pitor://skills/<name>/...` paths,
    which never touch the disk and cannot be written. After editing `src/skills/`, restart the server (or rebuild).
  - `workspace.ts` seeds the document workspaces.
- `src/server/server.ts` is the entry point. It mounts every feature's routes on one Hono app. The app serves REST
  endpoints, the AI SDK UI message stream (SSE) for chat, and a Bun-native WebSocket for events.
- `src/shared/wire.ts` holds the event types that the server, the UI and the check script share.
- `src/shared/markdown-support.ts` and `src/shared/passages.ts` hold the runtime code both sides share: the check for
  markdown the editor can't keep (tables, task lists, raw HTML), and `findQuote`, which finds a highlighted passage
  in a post's blocks. Like `wire.ts`, they have no imports.
- `src/server/scripts/` holds the end-to-end check.
- `src/ui/` is a small React page built on the AI SDK's `useChat`. Bun bundles it from `src/ui/index.html`, so there is
  no separate build step. Each feature has one file, with its CSS next to it:
  - `documents.tsx` has the document list and editor pane. It keeps every file opened since the page loaded, so
    switching files keeps unsaved edits, and the browser warns before leaving the page with any unsaved.
  - `markdown-editor.tsx` is the ProseMirror rich text editor, bound to a Yjs document per file so edits made elsewhere
    merge with the user's typing. It highlights the passages a finished turn named with the Highlight tool, found with
    the same `findQuote` the server checked them with.
  - `chat.tsx` is the chat panel, and `useChatSession`, the chat session the page owns so the panel and the question
    popup send through it alike. It sends what the editor holds with each message, and hands a finished turn's edits
    and highlights to the editor.
  - `question-popup.tsx` is the speech bubble a highlighted passage's label opens: the AI's question and a box
    to discuss it, sending a chat message that starts with the label.
  - `selection-popup.tsx` is the speech bubble the button beside a selection opens: the selected text and a box to ask
    the AI about it, sending a chat message that quotes the selection. `markdown-editor.tsx` draws that button in the
    margin, level with the top of the selection.
  - `anchored-bubble.ts` places both popups by the button that opened them and closes them on a press elsewhere.
  - `agent-panel.tsx` shows the workspace's skills and agents.
  - `api.ts` and `host-events.ts` are the shared fetch helper and the host-event WebSocket.
  - `app.tsx` is the entry point. It is the only file that wires features together, and `styles.css` holds the base styles.
- `src/skills/` holds the app's own skills, such as `collaborative-draft-editing`, listed in every workspace.
- `src/fixtures/workspace` is the document workspace, with a project skill (`doc-stats`) and a filesystem agent
  (`proofreader`). A second agent (`title-writer`) is defined in code.

## Run it

```sh
bun install
make test              # unit tests for the server and the UI; no API key needed
make test-server       # only the server and shared tests (src/server, src/shared)
make test-ui           # only the UI tests (src/ui/**/*.test.tsx), in a simulated browser page (happy-dom)
bun run check          # resets its own workspace, starts a server, runs every scenario
bun run check skill    # run only scenarios whose name contains "skill"
bun run server         # run the server and UI; it prints its URL (a random free port)
```

The server picks a random free port each time, so you can run several at once. Set `PORT` to use a fixed one, for
example `PORT=3737 bun run server`. It opens the UI in your default browser once it starts; set `OPEN_BROWSER=0`
to skip that.

`bun run server` uses `src/.data/workspace`, copied from the fixtures on first start. Delete that folder to reset it.
`bun run check` uses its own `src/.data/check-workspace`, so it won't disturb a running server.

## Build it

```sh
make build             # compiles everything into build/3pitor
./build/3pitor         # the workspace is the folder you launch it from
./build/3pitor my-stuff        # the workspace is the my-stuff folder
./build/3pitor my-stuff/a.md   # the workspace is the folder that holds a.md
make check-build       # builds, runs build/3pitor from an empty folder, and checks it lists the app's skills
make clean             # deletes build/
```

`build/3pitor` is a single executable with the server and UI inside it, and nothing else in `build/`. If the folder or
file you name does not exist, it warns and uses the launch folder. `bun run server` takes the same argument, for
example `bun run server ~/notes`. The built app has no fixtures to seed a workspace, so setting `WORKSPACE` to a folder
that doesn't exist fails.

Set `ANTHROPIC_API_KEY` to sign in; the server warns at startup when it is missing. Set `MODEL` to change the model: a
full model id, or one of the shortcuts `haiku`, `sonnet`, and `opus`. The default is `claude-sonnet-5`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET/PUT | `/api/documents/:name` | Load or save a markdown file in the workspace |
| POST | `/api/sessions` | Create a chat session |
| POST | `/api/sessions/:id/chat` | Send a message: `{ text, openFile?, documents? }`, where `documents` maps each file the editor holds to its markdown; responds with an AI SDK UI message stream whose closing `data-session` part carries the edited posts |
| POST | `/api/sessions/:id/cancel` | Cancel the running turn |
| WS | `/ws/events` | Subagent task events and finished turns |

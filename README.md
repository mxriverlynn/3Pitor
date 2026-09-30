# 3pitor

<img src="assets/3pitor-logo.png">

An editor for blog posts written in markdown, with Claude built in. You edit posts in a rich text editor and work on
them with Claude in a chat panel. Claude never writes files: its edits appear in the editor as
unsaved changes, merged with anything you type while it works, and only your Save writes a file.

It is built on Bun + TypeScript, Hono, and the Vercel AI SDK (v7). Chat reaches Claude one of two ways, chosen when
3pitor starts: the Anthropic API, through the AI SDK's Anthropic provider, or the `claude` program you already have
installed, through your Claude subscription. API mode needs no `claude` program; 3pitor never installs one.

All code lives in `src/`, organized by package, then by feature, then by component within the feature.

## How `src/` is laid out

- **Packages.** `src/server/` runs in Bun, `src/ui/` runs in the browser, and `src/shared/` holds what both of them use.
  No file in `src/ui/` imports from `src/server/`. The one link between them runs the other way: `server.ts` imports
  `ui/index.html` to serve the page.
- **Features.** Each package is split into feature folders. A capability that spans both packages uses the same name
  in each, so `chat`, `documents`, and `events` exist under both `src/server/` and `src/ui/`.
- **Components.** A feature with more than one component has one folder per component. A component is one module,
  plus the helpers only it imports, plus its tests and CSS. A feature with a single component keeps its files directly
  in the feature folder.
- **`components/` folders.** Code shared by siblings goes in a `components/` folder at the lowest level that covers
  everything that uses it. Code shared by components of one feature goes in `<feature>/components/`. Code shared by
  features of one package goes in `<package>/components/`. Code shared by both packages goes in `src/shared/`. Here
  "components" means shared by siblings, not React components: a fetch helper and a test-only model both live in
  one.
- **Entry points.** Entry points stay at their package root. That keeps the paths in `Makefile` and `package.json`
  stable.

### `src/server/`

Each feature has a domain file that knows nothing about HTTP, plus a matching `*.routes.ts` file with its Hono routes.

- **Entry points and wiring:**
  - `server.ts` is the entry point. It mounts every feature's routes on one Hono app. The app serves REST endpoints,
    the AI SDK UI message stream (SSE) for chat, and a Bun-native WebSocket for events.
  - `agent-host.ts` wires the features together.
  - `command-line.ts` turns the command line and environment into the folder argument and the chat mode, a
    `ClaudeMode` from `shared/wire.ts`.
  - `paths.ts` exports `SRC`, the absolute path of `src/`. It is the only file that finds `src/` from its own location,
    so every other file can sit at any depth. It must stay directly under `src/server/`, and `paths.test.ts` fails if
    it moves.
  - `text-imports.d.ts` lets the type checker accept a `.md` file imported as text.
- **`chat/`: chat turns and cancelling.** Its components share one turn's working copy of the posts:
  - `sessions/sessions.ts` runs each turn, and `sessions/sessions.routes.ts` exposes it. It keeps two histories of
    each session: what the model is sent, which holds only completed turns, and what the chat panel shows, which holds
    every turn. The current session is stored in `.3pitor/session.json` after each turn starts and ends, and the
    server loads it when it starts, so a chat lasts until Clear Chat. A turn keeps running, and is recorded, if its
    page goes away; one the server stopped in the middle of loads as stopped.
  - `agent/agent.ts` builds each chat turn's model, instructions, and tools, including the `Task` tool that runs
    subagents. It asks the mode's backend for the model and the provider's own tools. `agent/system-prompt.md` is
    the chat's instructions, imported as text, so it must sit beside `agent.ts`.
  - `claude-backend/claude-backend.ts` is the one place that knows the two chat modes and what differs between them:
    the chat and subagent models, the web tools, and what startup prints.
  - `claude-cli/` is CLI mode's model. `claude-cli.ts` runs `claude` once per model call, with its own file tools off,
    from a neutral folder, and without API credentials. It replays the conversation as a transcript on stdin.
    `stream-json.ts` turns `claude`'s output into AI SDK stream parts, and `mcp-endpoint.ts` lends 3pitor's tools to
    `claude` over MCP for that one call, so its edits still land on the turn's copy.
  - `tools/tools.ts` holds the model's file tools (Read, Write, Edit, Glob, Highlight), which cannot reach outside the
    workspace.
    - They read and change a per-turn copy of the posts, started from what the editor holds. Nothing in them writes a
      file.
    - A finished turn sends each edited post's final text to the browser, which merges it into the editor.
    - Highlight names passages of a post for the editor to highlight, and refuses a quote that is not in the post
      exactly once.
  - `components/` holds what the chat components' tests share:
    - `test-model.ts` is the scripted stand-in model that the `sessions`, `agent`, and `claude-backend` tests use.
    - `fake-claude.ts` stands in for `claude`, and `fake-claude-on-path.ts` puts it first on `PATH` for a test file.
      The `claude-cli`, `claude-backend`, and `sessions` tests use them. The two must stay side by side, because the
      helper copies the fake from its own folder.
- **`components/workspace-path.ts`:** `resolveInWorkspace`, the check that a path, followed through symlinks, stays
  inside the workspace. The chat tools and the documents domain file share it.
- **`components/json-file.ts`:** reads and writes the app's own state, as JSON files in the workspace's `.3pitor/`
  folder. Writes to one file land in the order they were made, and each replaces the file whole, so a crash never
  leaves half a file. The first write creates `.3pitor/.gitignore`, so git ignores the folder.
- **`events/`: the event bus.** `events.ts` is the bus, and `events.routes.ts` is its WebSocket.
- **`documents/`: the workspace's posts and folders.** `documents.ts` reads and writes them on disk. It accepts only
  paths that fit its grammar, which rules out dot-names and non-markdown files, and it refuses symlinked files.
  `documents.routes.ts` maps its refusals to a 400 or 404 with an `{ "error": … }` sentence.
- **`view-state/`: the editor's view, stored so a reload or restart brings it back.** `view-state.ts` reads and writes
  `.3pitor/view.json`, and `view-state.routes.ts` serves it. The page is its only writer; the server never looks
  inside.
- **`workspace/workspace.ts`:** chooses and seeds the document workspaces.
- **`workspace-config/`:** everything the workspace's skills and agents need.
  - `workspace-config.ts` loads the workspace's skills and agents from `.claude/`, plus the app's own skills and the
    code-defined agents. A workspace skill replaces an app skill of the same name. `workspace-config.routes.ts`
    serves them.
  - `app-skills.macro.ts` is a Bun macro that embeds every `.md` file under `src/skills/` when the server is bundled,
    so the app's skills are inside `build/3pitor`.
    - The model reads them through `3pitor://skills/<name>/...` paths, which never touch the disk and cannot be
      written.
    - After editing `src/skills/`, restart the server (or rebuild).
- **`scripts/`:** holds the end-to-end check.

### `src/ui/`

A small React page built on the AI SDK's `useChat`. Bun bundles it from `src/ui/index.html`, so there is no separate
build step. Each component's CSS sits next to it.

- **Entry point and base styles:**
  - `app.tsx` is the entry point. It is the only file that wires features together.
  - `index.html` loads `app.tsx`.
  - `styles.css` holds the base styles.
  - `css.d.ts` lets the type checker accept CSS imports, and `test-setup.ts` sets up happy-dom for the UI tests.
- **`documents/`: the document tree and the editor pane.**
  - `documents/documents.tsx` keeps the workspace's list of folders and files, and every file opened since the page
    loaded, so switching files keeps unsaved edits.
    - A reload brings back the open file, every file with unsaved edits (still unsaved), the highlights and their
      questions, the notices of AI edits that could not be applied, and the rendered or raw view.
    - It stores that view on the server a short pause after each change, and at once when a chat message is sent. The
      browser warns before leaving the page only while a change has not reached the disk yet, and the editor says so if
      one could not be written.
  - `file-tree/file-tree.tsx` shows the workspace as a tree that expands folder by folder. Its "+" and "..." menus
    create, rename, move, and delete, and an item can also be moved by dragging it onto a folder. Changing the tree is
    locked while the AI works.
    Names stay on one line, and the tree scrolls sideways when one is wider than it.
  - `components/paths.ts` holds the path helpers the hook and the tree share, such as `movedPath`.
  - `markdown-editor/markdown-editor.tsx` is the ProseMirror rich text editor.
    - It is bound to a Yjs document per file, so edits made elsewhere merge with the user's typing.
    - It highlights the passages a finished turn named with the Highlight tool, found with the same `findQuote` the
      server checked them with.
    - It draws the button beside a selection, in the margin level with the top of the selection.
  - `markdown-editor/task-items.ts` draws each task list item with its checkbox; ticking one sets the item's `checked`
    attribute, which Yjs keeps and Save writes out as `[x]` or `[ ]`.
  - `markdown-editor/raw-view.tsx` is the editor's raw mode: the markdown in a textarea, with the highlights, their
    labels, and the selection button drawn on a mirror behind it. `markdown-editor/raw-formatting.ts` holds the
    formatting menu's commands for raw mode, each writing the formatting as markdown syntax. Only the editor uses them.
- **`chat/`:**
  - `chat/chat.tsx` is the chat panel, and `useChatSession`, the chat session the page owns so the panel and the
    question popup send through it alike. It sends what the editor holds with each message, and hands a finished
    turn's edits and highlights to the editor.
    - A reload brings back the current chat. A turn still running then shows as working, and its reply, edits, and
      highlights arrive when it finishes.
    - A chat lasts until Clear Chat. When a conversation grows too long for the model, Clear Chat is the way out.
  - `agent-panel/agent-panel.tsx` is the panel's header, with the Clear Chat button.
- **`popups/`:**
  - `question-popup/` is the speech bubble a highlighted passage's label opens. It shows the AI's question and a box to
    discuss it, and sends a chat message that starts with the label.
  - `selection-popup/` is the speech bubble the button beside a selection opens. It shows the selected text and a box
    to ask the AI about it, and sends a chat message that quotes the selection.
  - `components/anchored-bubble.ts` places both popups by the button that opened them and closes them on a press
    elsewhere.
- **`events/host-events.ts`:** the host-event WebSocket.
- **`components/fake-documents-api.ts`:** a test-only stand-in for the documents routes over an in-memory workspace,
  which the UI tests answer fetch with.
- **`components/menu/`:** the drop-down menu that the file tree's "+" and "..." menus and `agent-actions` open.
- **`components/agent-actions/`:** the "/" button that opens the Agent Actions menu and hands the chosen slash command
  to a text box. The chat panel and the selection popup both use it.
- **`components/panel-resizer/`:** the bar between the Documents tree and the editor. Dragging it, or pressing the
  arrow keys on it, sets the tree's width, from 120px to 600px. `app.tsx` holds the width.
- **`components/api.ts`:** the fetch helper `app.tsx`, `documents`, and `chat` share. A failed request throws the
  server's `error` sentence, so the caller can show it.

### `src/shared/`

The code the server, the UI, and the check script share. None of these modules has imports, except `markdown.ts`.

- `wire.ts` holds the shapes that cross the wire: the event types, the chat request, the chat mode (`ClaudeMode`), and
  the documents API's types.
- `markdown.ts` holds the editor's markdown schema, parser, and serializer: CommonMark plus task lists, whose
  `task_item` nodes hold each checkbox's state. The server parses posts with it too, so both read them the same way.
- `markdown-support.ts` checks for markdown the editor can't keep (tables, raw HTML).
- `passages.ts` holds `findQuote`, which finds a highlighted passage in a post's blocks.
- `blocks.ts` holds `textblocks`, which lists a post's textblocks in order. The server's Highlight tool and the
  editor's highlights both use it, so both see the same blocks.

### Content

- `src/skills/` holds the app's own skills, such as `collaborative-editing`, listed in every workspace.
- `src/fixtures/workspace` is the document workspace, with a project skill (`doc-stats`) and a filesystem agent
  (`proofreader`). A second agent (`title-writer`) is defined in code.

## Run it

```sh
bun install
make test              # type-checks src/, then runs the server and UI tests; no API key or claude needed
make typecheck         # only the type-check (tsc --noEmit)
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

The app keeps the current chat and the editor's view, unsaved drafts included, in a `.3pitor/` folder in the
workspace, which git ignores. Delete `.3pitor/` to reset the saved session. Servers sharing one workspace share that
folder too, so the last one to write wins.
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

### Choose how chat reaches Claude

```
Usage: 3pitor [--claude=auto|api|cli] [folder-or-file]
```

- `--claude=api` calls the Anthropic API. Set `ANTHROPIC_API_KEY` to sign in; the server warns at startup when it is
  missing.
- `--claude=cli` runs the `claude` program on your `PATH`, which must be installed and signed in. It uses your Claude
  subscription, even when `ANTHROPIC_API_KEY` is set. The server warns at startup when `claude` is not on your `PATH`.
- `--claude=auto`, the default, picks API mode when `ANTHROPIC_API_KEY` is set and not empty, and CLI mode otherwise.

The flag also takes its mode as the next argument (`--claude cli`), and option names and modes are case-insensitive
(`--CLAUDE=CLI`). An unknown option or mode stops startup with exit code 2 and the usage line. `bun run server` takes
the same arguments. Every start prints the mode it chose, before the `listening on` line:

```
3pitor chat: claude via the Anthropic API
3pitor chat: claude via the claude program
```

Set `MODEL` to change the model in either mode: a full model id, or one of the shortcuts `haiku`, `sonnet`, and
`opus`. The default is `claude-sonnet-5`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/documents` | List the workspace: `{ entries: { path, kind }[] }`, every folder and `.md` file |
| GET/PUT | `/api/documents/:name` | Load or save a markdown file in the workspace |
| POST | `/api/documents/create` | Create an empty folder or a new file: `{ path, kind }` |
| POST | `/api/documents/move` | Rename or move a file or folder: `{ from, to }` |
| POST | `/api/documents/count` | Count what a delete of a folder would remove: `{ path }` → `{ files, folders }` |
| POST | `/api/documents/delete` | Delete a file, or a folder and everything in it: `{ path }` |
| GET | `/api/sessions/current` | The current chat session: `{ id, messages, running }`, where `messages` are the chat panel's messages and `running` says a turn is in progress |
| POST | `/api/sessions` | Create a chat session, which becomes the current one |
| POST | `/api/sessions/:id/chat` | Send a message: `{ text, openFile?, documents? }`, where `documents` maps each file the editor holds to its markdown; responds with an AI SDK UI message stream whose closing `data-session` part carries the edited posts |
| POST | `/api/sessions/:id/cancel` | Cancel the running turn |
| GET/PUT | `/api/view-state` | Load or store the editor's view: the open file, unsaved drafts, highlights, notices, and mode |
| WS | `/ws/events` | Subagent task events and finished turns |

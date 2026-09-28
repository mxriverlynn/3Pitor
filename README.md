# 3pitor

<img src="assets/3pitor-logo.png">

An editor for blog posts written in markdown, with Claude built in. You edit posts in a rich text editor and work on
them with Claude in a chat panel. Claude never writes files: its edits appear in the editor as
unsaved changes, merged with anything you type while it works, and only your Save writes a file.

It is built on Bun + TypeScript, Hono, and the Vercel AI SDK (v7) with its Anthropic provider, which calls the Anthropic
API directly. It needs no `claude` program.

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
  - `paths.ts` exports `SRC`, the absolute path of `src/`. It is the only file that finds `src/` from its own location,
    so every other file can sit at any depth. It must stay directly under `src/server/`, and `paths.test.ts` fails if
    it moves.
- **`chat/`: chat turns and cancelling.** It has three components that share one turn's working copy of the posts:
  - `sessions/sessions.ts` runs each turn, and `sessions/sessions.routes.ts` exposes it.
  - `agent/agent.ts` builds each chat turn's model, instructions, and tools, including the `Task` tool that runs
    subagents.
  - `tools/tools.ts` holds the model's file tools (Read, Write, Edit, Glob, Highlight), which cannot reach outside the
    workspace.
    - They read and change a per-turn copy of the posts, started from what the editor holds. Nothing in them writes a
      file.
    - A finished turn sends each edited post's final text to the browser, which merges it into the editor.
    - Highlight names passages of a post for the editor to highlight, and refuses a quote that is not in the post
      exactly once.
  - `components/test-model.ts` is the scripted stand-in model that the `sessions` and `agent` tests share.
- **`events/`: the event bus.** `events.ts` is the bus, and `events.routes.ts` is its WebSocket.
- **`documents/documents.routes.ts`:** loads and saves posts. It is routes only.
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
- **`documents/`: the document list and the editor pane.**
  - `documents/documents.tsx` keeps every file opened since the page loaded, so switching files keeps unsaved edits,
    and the browser warns before leaving the page with any unsaved.
  - `markdown-editor/markdown-editor.tsx` is the ProseMirror rich text editor.
    - It is bound to a Yjs document per file, so edits made elsewhere merge with the user's typing.
    - It highlights the passages a finished turn named with the Highlight tool, found with the same `findQuote` the
      server checked them with.
    - It draws the button beside a selection, in the margin level with the top of the selection.
- **`chat/`:**
  - `chat/chat.tsx` is the chat panel, and `useChatSession`, the chat session the page owns so the panel and the
    question popup send through it alike. It sends what the editor holds with each message, and hands a finished
    turn's edits and highlights to the editor.
  - `agent-panel/agent-panel.tsx` is the panel's header, with the Clear Chat button.
- **`popups/`:**
  - `question-popup/` is the speech bubble a highlighted passage's label opens. It shows the AI's question and a box to
    discuss it, and sends a chat message that starts with the label.
  - `selection-popup/` is the speech bubble the button beside a selection opens. It shows the selected text and a box
    to ask the AI about it, and sends a chat message that quotes the selection.
  - `components/anchored-bubble.ts` places both popups by the button that opened them and closes them on a press
    elsewhere.
- **`events/host-events.ts`:** the host-event WebSocket.
- **`components/api.ts`:** the fetch helper `app.tsx`, `documents`, and `chat` share.

### `src/shared/`

The code the server, the UI, and the check script share. None of these modules has imports.

- `wire.ts` holds the event types.
- `markdown-support.ts` checks for markdown the editor can't keep (tables, task lists, raw HTML).
- `passages.ts` holds `findQuote`, which finds a highlighted passage in a post's blocks.
- `blocks.ts` holds `textblocks`, which lists a post's textblocks in order. The server's Highlight tool and the
  editor's highlights both use it, so both see the same blocks.

### Content

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

# Current State Findings: Load app skills and highlight review

## Provenance

Produced by this run's own discovery round on 2026-09-28. No prior findings report existed.

- `han-core:structural-analyst` (findings S1–S18 in its report) and `han-core:behavioral-analyst` (B1–B19) were given
  the same area: skill loading and the model's tools in `src/server/`, `src/shared/wire.ts`, the chat and editor in
  `src/ui/`, the `Makefile`, and the new skill under `src/skillls/collaborative-draft-editing/`.
- `han-core:concurrency-analyst` was not dispatched. The area has one chat turn at a time per session and no shared
  mutable state beyond what the behavioral trace covered.
- The orchestrator's own sweep added the project context below, plus C-19, an experiment with Bun's compiler run in a
  scratch project.

Each finding below names the analyst identifiers it merges.

## Project Context

- **Stack:** Bun 1.4.2 + TypeScript, Hono server, AI SDK v7 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/react`), React 19
  UI, ProseMirror (`prosemirror-markdown` stock schema) bound to Yjs via `y-prosemirror`. Tests: `bun test`, with UI
  tests under happy-dom (`make test-ui`). End-to-end: `bun run check`. Build: `make build` →
  `bun build --compile --production src/server/server.ts`.
- **Conventions source:** `README.md` (feature-split `src/server/` with `*.routes.ts` beside domain files; one file per
  UI feature with its CSS beside it; `src/shared/wire.ts` is types only; `src/shared/markdown-support.ts` is the one
  shared runtime file, with no imports). No `CLAUDE.md`, `AGENTS.md`, or `project-discovery.md`.
- **ADRs found:** none found under `docs/adr/`. Earlier change plans live in `docs/changes/` (three of them), and this
  plan follows their layout.
- **Coding standards found:** none found.
- **Recent churn:** the whole history is 43 commits over about three days, all feature build-out. The most-touched files
  in the area are `src/ui/chat.tsx` and `src/ui/app.tsx` (10 each), `src/server/server.ts` (9), `sessions.ts` (7),
  `documents.tsx`, `wire.ts`, `tools.ts`, and `agent.ts` (6 each). Claude Code was removed in `f96b829`, and the new
  skill was written for Claude Code.

## Gaps

- No ADRs, no coding standards, and no CLAUDE.md.
- No slash-command handling, no decoration or highlight code, and no text-to-editor-position mapping anywhere in `src/`
  (searched for `Decoration`, `highlight`, a leading-`/` parser).
- No existing way for the compiled binary to carry loose files (see C-18).
- No test covers how a tool's `errorText` renders in the chat (see C-15).

## Findings

### C-1: Skill discovery scans one root, the workspace's `.claude/skills/`

- **Claim:** `loadWorkspaceConfig` finds skills only at `<workspace>/.claude/skills/*/SKILL.md`. It has no second
  source for skills, while agents already merge a second, code-defined source (`CODE_AGENTS`).
- **Location:** `src/server/workspace-config.ts` `loadWorkspaceConfig`, `CODE_AGENTS`
- **Evidence:**
  ```ts
  for (const path of await scan(workspace, '.claude/skills/*/SKILL.md')) {
    const file = await readMarkdown(workspace, path);
    if (!file) continue;
    skills.push({ name: path.split('/')[2], description: stringField(file.data.description), path });
  }
  ...
  return { skills: skills.sort(byName), agents: [...agents.sort(byName), ...CODE_AGENTS] };
  ```
- **Raised by:** structural S1, S5; behavioral B3
- **Confidence:** Verified
- **Bears on:** S-2, S-3; D-2, D-3

### C-2: `Skill.path` is workspace-relative and goes into the system prompt verbatim

- **Claim:** The `Skill` type documents `path` as workspace-relative. `instructionsFor` lists each skill as
  `- name (path): description` and tells the model to `Read` that path when the user types `/<name>`.
- **Location:** `src/server/workspace-config.ts` `Skill`; `src/server/agent.ts` `instructionsFor`
- **Evidence:**
  ```ts
  // Workspace-relative, such as '.claude/skills/doc-stats/SKILL.md'.
  path: string;
  ```
  ```ts
  const lines = skills.map((s) => `- ${s.name} (${s.path}): ${s.description}`);
  return `${base}

  Skills in this workspace. When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly:
  ${lines.join('\n')}`;
  ```
- **Raised by:** structural S2, S6, S11; behavioral B2
- **Confidence:** Verified
- **Bears on:** S-3, S-4

### C-3: `/name` is a prompt convention, not parsed by any code

- **Claim:** The composer sends the raw text, and nothing on the client or server parses a leading `/`. Whether
  `/collaborative-draft-editing` does anything depends on the model finding the name in the skills list (C-2).
- **Location:** `src/ui/chat.tsx` `send`; `src/server/agent.ts` `instructionsFor`
- **Evidence:**
  ```ts
  sendMessage({ text: input }, { body: { openFile, ...beginTurn() } });
  ```
- **Raised by:** structural S11; behavioral B2 (the model's actual behavior is Unverified: needs a live API call)
- **Confidence:** Verified for the code; Unverified for how the model responds
- **Bears on:** D-4

### C-4: `Read` refuses every path outside the workspace, by design and by test

- **Claim:** `Read` serves posts from the turn's copy, and any other path from disk through `resolveInWorkspace`. That
  function throws for anything outside the workspace, absolute paths included. A skill file bundled with the app, which
  lives outside the user's workspace, cannot be read.
- **Location:** `src/server/tools.ts` `fileTools` `Read`, `resolveInWorkspace`; `src/server/tools.test.ts`
  "refuses an absolute path outside the workspace"
- **Evidence:**
  ```ts
  // Posts come from the turn's copy; anything else (a skill file, say) is read from disk.
  const name = postNameOrUndefined(workspace, file_path);
  if (name !== undefined && turn.texts.has(name)) return turn.texts.get(name)!;
  const file = Bun.file(resolveInWorkspace(workspace, file_path));
  if (!(await file.exists())) throw new Error(`${file_path} does not exist`);
  return file.text();
  ```
  ```ts
  if (relative(realWorkspace, target).startsWith('..')) throw new Error(`${filePath} is outside the workspace`);
  ```
- **Raised by:** structural S3, S6; behavioral B4
- **Confidence:** Verified
- **Bears on:** S-4; D-3

### C-5: Only `description` is read from a skill's frontmatter

- **Claim:** `readMarkdown` parses the whole YAML block, but the loader keeps only `description`. `allowed-tools`,
  `argument-hint`, and every other field are dropped. The model always gets the same tools whatever a skill declares.
- **Location:** `src/server/workspace-config.ts` `loadWorkspaceConfig`, `readMarkdown`
- **Evidence:** see C-1's loop, `description: stringField(file.data.description)`.
- **Raised by:** structural S4; behavioral B5
- **Confidence:** Verified
- **Bears on:** S-5

### C-6: The model's tools are Read, Write, Edit, Glob, and Task, with no shell, Grep, or Skill tool

- **Claim:** `fileTools` builds exactly four tools and `agentSettings` adds `Task`. No `Bash`, `Grep`, or `Skill` tool
  exists under any name.
- **Location:** `src/server/tools.ts` `fileTools`; `src/server/agent.ts` `agentSettings`
- **Evidence:**
  ```ts
  return { Read, Write, Edit, Glob };
  ```
  ```ts
  tools: { ...files, Task: taskTool(config.agents, model, files, ownerId, report) },
  ```
- **Raised by:** structural S4, S7; behavioral B5, B7
- **Confidence:** Verified
- **Bears on:** S-5; D-5

### C-7: The new skill is written for Claude Code and depends on things this app does not have

- **Claim:** `collaborative-draft-editing` depends on things this app does not have:
  - it hands its loop to `han-core:pairing` through a `Skill` tool, and stops when that skill is missing;
  - it runs shell commands (`find`, `wc -w`, `git status/log/add/commit`, `curl`, `scripts/reflow.py`);
  - it uses `` !`command` `` context lines and the `${CLAUDE_SKILL_DIR}` variable;
  - it writes a pairing record under `.han/pairing/`;
  - it edits its own `references/editing-lessons.md`.

  `Read` returns file text verbatim, so the `` !`...` `` lines and `${CLAUDE_SKILL_DIR}` reach the model as inert text.
  `Write` and `Edit` accept only `.md` posts outside dot-folders.
- **Location:** `src/skillls/collaborative-draft-editing/SKILL.md` Project Context and Steps 1–6;
  `references/pairing-brief.md`; `src/server/tools.ts` `resolvePost`
- **Evidence:**
  ```
  1. **Confirm `han-core:pairing` is available** by checking the skills listed for this session. If it is missing, stop
  ```
  ```
  `${CLAUDE_SKILL_DIR}/scripts/reflow.py {draft path} --width {width} --tolerance {tolerance}`
  ```
  ```ts
  if (!target.endsWith('.md') || segments.some((s) => s.startsWith('.'))) {
    throw new Error(`${filePath} is not a markdown post`);
  }
  ```
- **Raised by:** structural S4, S6, S7; behavioral B5, B6, B7
- **Confidence:** Verified
- **Bears on:** S-5; D-5, D-6

### C-8: The skill folder is misspelled on disk

- **Claim:** The skill lives at `src/skillls/` (three l's). The operator confirmed it should be `src/skills/`. No code
  references either name.
- **Location:** `src/skillls/collaborative-draft-editing/`
- **Evidence:** `git status` shows `?? src/skillls/`, and a grep for `skillls` or `src/skills` in `src/server` and
  `src/ui` returns nothing.
- **Raised by:** orchestrator sweep; behavioral B3
- **Confidence:** Verified
- **Bears on:** S-1

### C-9: The skills list reaches the UI as names only

- **Claim:** `/api/workspace-config` returns `{ skills: string[], agents: string[] }`, and `AgentPanel` renders each
  skill as a `/name` chip. A skill added to the config shows up in the panel with no UI change.
- **Location:** `src/server/workspace-config.routes.ts`; `src/ui/agent-panel.tsx`
- **Evidence:**
  ```ts
  return c.json({ skills: config.skills.map((s) => s.name), agents: config.agents.map((a) => a.name) });
  ```
- **Raised by:** structural S10; behavioral B3
- **Confidence:** Verified
- **Bears on:** S-3

### C-10: A chat turn's round trip, and where extra data parts travel

- **Claim:** A turn goes from the composer through `POST /api/sessions/:id/chat` to `Sessions.chat`, which calls
  `streamText` with `agentSettings` and merges the model's UI stream. The server already writes custom data parts
  during a turn: `data-task` from the `Task` tool through the `writer` that `agentSettings` receives, and `data-session`
  at turn end. `chat.tsx` matches part types by string literal, with `part: any`.
- **Location:** `src/server/sessions.ts` `chat`; `src/server/agent.ts` `agentSettings` `report`; `src/ui/chat.tsx`
  `Message`, `onFinish`
- **Evidence:**
  ```ts
  const report = (event: TaskEvent) => {
    writer?.write({ type: 'data-task', data: event });
    events.emit(event);
  };
  ```
  ```ts
  {message.parts.map((part: any, i) => {
  ...
    case 'data-task':
  ```
- **Raised by:** structural S12, S13, S16; behavioral B1
- **Confidence:** Verified
- **Bears on:** S-7, S-8; D-7

### C-11: The editor takes only `doc` and `readOnly`, and has no decoration plugin

- **Claim:** `MarkdownEditor`'s props are `{ doc, readOnly }`. Its plugins are `ySyncPlugin`, `yUndoPlugin`, a keymap,
  and `exampleSetup`. Nothing in `src/` uses ProseMirror `Decoration`s.
- **Location:** `src/ui/markdown-editor.tsx` `MarkdownEditor`; `src/ui/documents.tsx` `Editor`
- **Evidence:**
  ```ts
  export function MarkdownEditor({ doc, readOnly }: { doc: Y.Doc; readOnly: boolean }) {
  ```
  ```tsx
  {docs.doc && <MarkdownEditor key={docs.current} doc={docs.doc} readOnly={docs.unsupported.length > 0} />}
  ```
- **Raised by:** structural S14; behavioral B14
- **Confidence:** Verified
- **Bears on:** S-9, S-10

### C-12: The editor view is destroyed and rebuilt on every file switch

- **Claim:** `key={docs.current}` remounts `MarkdownEditor` when the open file changes, and its effect cleanup destroys
  the `EditorView`. State kept only in the view is lost when the writer switches files. State kept in `useDocuments`,
  keyed by file name, survives, the way unsaved edits already do.
- **Location:** `src/ui/documents.tsx` `Editor`; `src/ui/markdown-editor.tsx` effect cleanup
- **Evidence:**
  ```ts
  return () => {
    undoManagers.delete(doc);
    editor.destroy();
    view.current = null;
  };
  ```
- **Raised by:** behavioral B15
- **Confidence:** Verified
- **Bears on:** S-9, S-10; D-8

### C-13: No shared way to find a passage; markdown text and editor text differ

- **Claim:** The server finds text by exact substring on raw markdown (`Edit`'s `old_string`). The UI has only
  whole-document `markdownOf` and `docFromMarkdown`. What the writer sees in the editor is ProseMirror text with
  markdown syntax removed (`*emphasis*` shows as `emphasis`), so a markdown substring does not map directly to editor
  positions.
- **Location:** `src/server/tools.ts` `Edit`; `src/ui/markdown-editor.tsx` `markdownOf`, `docFromMarkdown`
- **Evidence:**
  ```ts
  const count = text.split(old_string).length - 1;
  if (count === 0) throw new Error(`old_string not found in ${name}`);
  ```
- **Raised by:** structural S15; behavioral B16
- **Confidence:** Verified
- **Bears on:** S-6; D-7

### C-14: Every turn starts from the editor's current text, but the model's memory of a post goes stale

- **Claim:** `beginTurn` sends every open post's live markdown with each message, so hand edits between stops reach the
  next turn. Earlier `Read` results in `session.messages` still hold the old text, so an `Edit` or a quote built from
  memory can miss. The lessons file says the writer "hand-edits heavily between stops".
- **Location:** `src/ui/documents.tsx` `beginTurn`; `src/server/sessions.ts` `turnTexts(...)`;
  `references/editing-lessons.md` "What the runs show"
- **Evidence:**
  ```ts
  documents[name] = markdownOf(entry.doc);
  ```
- **Raised by:** behavioral B13
- **Confidence:** Verified
- **Bears on:** S-5, S-6

### C-15: A failed tool call shows only the word "error"

- **Claim:** The AI SDK catches a throwing tool and returns the error to the model, so the turn goes on. The chat shows
  the tool row with `error` and never shows `part.errorText`.
- **Location:** `src/ui/chat.tsx` `Message`
- **Evidence:**
  ```ts
  · {part.state === 'output-available' ? 'done' : part.state === 'output-error' ? 'error' : ...}
  ```
- **Raised by:** behavioral B8, B9
- **Confidence:** Verified
- **Bears on:** cut list

### C-16: Hitting the 20-step limit looks like a normal finish

- **Claim:** `stopWhen: stepCountIs(20)` ends a turn without an error, and `data-session` reports `aborted: false`.
  The chat shows nothing, and `sessions.test.ts` pins that result.
- **Location:** `src/server/sessions.ts` `DEFAULT_CHAT_MAX_STEPS`, `chat`
- **Evidence:**
  ```ts
  export const DEFAULT_CHAT_MAX_STEPS = 20;
  ```
- **Raised by:** behavioral B10
- **Confidence:** Verified
- **Bears on:** Risks; Open Items

### C-17: A stopped or failed turn is dropped from the model's history but stays on screen

- **Claim:** A turn that is stopped or fails never lands in `session.messages`, but the browser keeps showing it. Old
  sessions are never evicted.
- **Location:** `src/server/sessions.ts` `chat`, `Sessions`
- **Evidence:**
  ```ts
  if (!abort.signal.aborted) session.messages = [...messages, ...responseMessages];
  ```
- **Raised by:** behavioral B11, B12
- **Confidence:** Verified
- **Bears on:** cut list

### C-18: The compiled binary cannot read files through computed paths

- **Claim:** `bun build --compile` does not embed files read through a runtime-computed path. The shipped
  `build/3pitor` crashes on a fresh `WORKSPACE` with ``ENOENT ... lstat '/$bunfs/fixtures/workspace'``. A scratch
  reproduction failed the same way through `Bun.file`, `readdir`, and `Bun.Glob().scan`. Git history shows the build
  once copied fixtures next to the binary for this reason. The `SRC` constant in `workspace.ts` is the only
  `import.meta.dir`-derived path, and it is used only by dev and test code.
- **Location:** `Makefile` `build`; `src/server/workspace.ts` `SRC`, `FIXTURE`, `ensureWorkspace`
- **Evidence:**
  ```
  ENOENT: no such file or directory, lstat '/$bunfs/fixtures/workspace'
  ```
  ```makefile
  bun build --compile --production src/server/server.ts --outfile $(BUILD)/3pitor
  ```
- **Raised by:** structural S8, S9; behavioral B19 (reproduced)
- **Confidence:** Verified
- **Bears on:** S-2; D-2

### C-19: A Bun bundle-time macro can embed a whole folder, in dev and in the compiled binary

- **Claim:** A function imported `with { type: 'macro' }` runs when Bun bundles or transpiles the importing file. If it
  globs a folder and returns `Record<relativePath, text>`, that object is inlined into the output. The inlined files
  read correctly under `bun run` and from a `bun build --compile` binary run from `/`. A file added after compiling is
  absent from the binary, as expected. Two alternatives were also tested:
  - Extra entrypoints on `bun build --compile` embedded nothing readable.
  - `import ... with { type: 'file' | 'text' }` works, but needs one static import per file, so it cannot pick up "every
    skill in the folder".
- **Location:** scratch experiment (outside the repo), Bun 1.4.2
- **Evidence:**
  ```ts
  // skills.macro.ts
  export function skillFiles(): Record<string, string> {
    const dir = join(import.meta.dir, 'skills');
    const out: Record<string, string> = {};
    for (const p of new Bun.Glob('**/*').scanSync({ cwd: dir })) out[p] = readFileSync(join(dir, p), 'utf8');
    return out;
  }
  // main.ts
  import { skillFiles } from './skills.macro' with { type: 'macro' };
  ```
  Output under `bun run` and from the compiled binary:
  `[ "a/SKILL.md", "a/references/x.md", "b/SKILL.md" ] "---\nname: a\n---\nA body\n"`
- **Raised by:** orchestrator sweep
- **Confidence:** Verified in a scratch project. Unverified in this repo: whether `--production` minification or
  `bun run`'s transpiler cache changes it. A test in the build unit closes this.
- **Bears on:** S-2; D-2

### C-20: A restart picks up added and edited macro inputs

- **Claim:** Under `bun run`, a macro's output is recomputed on each start. A skill folder added between runs, or an
  edited file, shows up on the next start. That holds even when the importing file is over 50 KB, the size at which
  Bun's transpiler cache applies.
- **Location:** scratch experiment (outside the repo), Bun 1.4.2, same `skills.macro.ts` as C-19
- **Evidence:** Consecutive runs printed:
  - `[... "c/SKILL.md"]` after adding `skills/c/`
  - `"A body\nmore\n"` after editing `a/SKILL.md`
  - `[... "d/SKILL.md"]` from a 60 KB importer after adding `skills/d/`
- **Raised by:** orchestrator, closing junior-developer JD-004
- **Confidence:** Verified in a scratch project
- **Bears on:** Risks; D-2

## Findings No Agent Could Audit

- **How the model responds to a literal `/collaborative-draft-editing`** and follows an adapted skill across many
  turns. This needs live Anthropic API calls. `bun run check` scenarios with a real key close it.
- **The AI SDK and Anthropic provider's own timeouts and retries** under `streamText`. This was not traced into the
  provider package, and it is not needed for this change.

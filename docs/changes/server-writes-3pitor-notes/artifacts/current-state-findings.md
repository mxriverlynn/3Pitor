# Current State Findings: Server Writes `.3pitor/` Notes

## Provenance

Produced by this run's own discovery, read directly by the orchestrator on 2026-10-01 (no prior report exists). The
area is small (about six files), so the structural and behavioral reads were done in-line rather than dispatched; the
concurrency read was limited to the existing per-path write queue in `json-file.ts`, the only shared mutable state the
change touches.

## Project Context

- **Stack:** TypeScript on Bun; React UI; AI SDK (`ai`) tools with zod schemas; tests with `bun test`.
- **Conventions source:** none found (no CLAUDE.md, AGENTS.md, or project-discovery.md). Conventions are read from the
  code: a header comment per file, `*.test.ts` beside each module, feature folders under `src/server/` and `src/ui/`.
- **ADRs found:** none under `docs/adr/`. The closest record is
  `docs/changes/ai-edits-through-the-editor/` (a prior change plan) whose decisions D-1, D-7, and D-8 establish that
  the AI's edits never reach disk and only the UI's Save writes a post.
- **Coding standards found:** none found.
- **Recent churn:** over 90 days, `src/server/chat/tools/tools.ts` changed 10 times and its test 9 times;
  `src/skills/collaborative-editing/SKILL.md` 5 times; `json-file.ts` and `workspace-path.ts` once each.

## Gaps

- No ADR or coding standard governs what may write inside `.3pitor/`. The only rule is the header comment in
  `json-file.ts` (C-6).
- No test covers a model tool call on a `.3pitor/` path.
- No document says whether files under `.3pitor/` should be kept out of git; the existing `.gitignore` writer (C-6)
  answers it by convention.

## Findings

### C-1: The collaborative-editing skill writes its log to `pairing/`

- **Claim:** The skill's session log path and its resume search are both under a top-level `pairing/` folder.
- **Location:** `src/skills/collaborative-editing/SKILL.md`, Step 1 items 3 and 4.
- **Evidence:**
  ```markdown
  3. **Find the session log.** The log path is `pairing/{today, YYYY-MM-DD}-{slug}-content-edit.md`. When you do not know
  4. **Detect a resume.** Glob `pairing/*-{slug}-content-edit.md`. When the newest match has no `## Close` heading, this
  ```
- **Raised by:** orchestrator
- **Confidence:** Verified
- **Bears on:** S-4, D-1

### C-2: The skill tells the model every Write or Edit lands in the editor unsaved

- **Claim:** The skill text, and the final report step, assume the log is an unsaved editor document the writer must
  save.
- **Location:** `src/skills/collaborative-editing/SKILL.md`, intro and Step 6 item 5.
- **Evidence:**
  ```markdown
  skill never commits, never checks a link over the network, and never rewraps lines: the editor decides line breaks
  when the writer saves. Everything you Write or Edit appears in the writer's editor as an unsaved change, and the
  writer saves it; say so the first time you change a file.
  ...
  reach, the lessons added, and the log path. Remind the writer to save the draft, the log, and the lessons file,
  since none of them is written to disk until they do.
  ```
- **Raised by:** orchestrator
- **Confidence:** Verified
- **Bears on:** S-4

### C-3: `Write` and `Edit` put every change into the turn's copy and report it as an edited post

- **Claim:** Both tools call `markEdited` and `highlightChanges`, then `onChange`, and never write disk. Every changed
  name lands in `turn.edited`, which feeds both `data-progress` (during the turn) and `data-session` (at its end).
- **Location:** `src/server/chat/tools/tools.ts`, `fileTools` (`Write`, `Edit`); `src/server/chat/agent/agent.ts`,
  `agentSettings` (`progress`); `src/server/chat/sessions/sessions.ts`, `chat` (`data-session`).
- **Evidence:**
  ```ts
  // tools.ts
  // chat turn's copy (what the user sees in the editor) and change only that copy: nothing here writes a
  // file, because only the user's Save does.
  ...
      refuseUnsupported(name, text, content);
      markEdited(turn, name, content);
      const before = new Set(postBlocks(text));
      highlightChanges(turn, name, content, postBlocks(content).filter((block) => !before.has(block)));
      onChange();
      return `wrote ${name}`;
  ```
  ```ts
  // agent.ts
  const progress = () => {
    const data: TurnProgress = { edited: editedTexts(turn), highlights: turn.highlights };
    writer?.write({ type: 'data-progress', data, transient: true });
  };
  ```
  ```ts
  // sessions.ts
  const data: SessionData = { aborted, edited: aborted ? {} : editedTexts(turn) };
  ```
- **Raised by:** orchestrator
- **Confidence:** Verified
- **Bears on:** S-2, D-2

### C-4: The editor switches to the last edited file when the open file was not edited

- **Claim:** `applyEdited` shows `names.at(-1)` whenever the open file is not among the edited names. Because the skill
  appends to its log after editing the draft, the log is usually last, so the editor jumps to the log. This is the
  switch the user reports.
- **Location:** `src/ui/documents/documents/documents.tsx`, `applyEdited`.
- **Evidence:**
  ```ts
      // Stay on the open file if the AI changed it; otherwise show the file it changed last. That move is
      // the AI's, so the writer still counts as on the file they sent the message from.
      if (current === undefined || !names.includes(current)) {
        if (current === turnFile.current) turnFile.current = names.at(-1)!;
        show(names.at(-1)!);
      }
  ```
- **Raised by:** orchestrator
- **Confidence:** Verified. Note: when the draft is open and also edited in the same turn, the condition is false and
  the editor stays; the switch happens on turns that edit only the log (for example, "log every answer" turns where
  the writer declines an edit), and on the first turn when no file is open.
- **Bears on:** S-2, D-2

### C-5: `resolvePost` refuses every path with a dot-segment, so `.3pitor/` is unwritable today

- **Claim:** `Write`, `Edit`, and `Highlight` resolve their path through `resolvePost`, which throws for any segment
  starting with `.`. `Read` falls back to a plain disk read for such paths. `Glob` matches `.3pitor/...` only when the
  pattern names the dot-folder explicitly; `**/*.md` skips it (checked with `Bun.Glob.scan` on 2026-10-01).
- **Location:** `src/server/chat/tools/tools.ts`, `resolvePost`, `Read`, `Glob`.
- **Evidence:**
  ```ts
  // Like resolveInWorkspace, and also refuses anything but a .md file outside dot-folders, which keeps
  // the model out of .git/ and .claude/, and refuses the app's skill files, which are read-only.
  function resolvePost(workspace: string, filePath: string): string {
    if (filePath.startsWith(APP_SKILL_PREFIX)) throw new Error(`${filePath} is not a markdown post`);
    const target = resolveInWorkspace(workspace, filePath);
    const segments = relative(realpathSync(workspace), target).split(sep);
    if (!target.endsWith('.md') || segments.some((s) => s.startsWith('.'))) {
      throw new Error(`${filePath} is not a markdown post`);
    }
    return target;
  }
  ```
  ```text
  Bun.Glob('.3pitor/editing/*-x-content-edit.md') → [".3pitor/editing/2026-10-01-x-content-edit.md"]
  Bun.Glob('**/*.md')                             → ["a.md"]   (the .3pitor file is not listed)
  ```
- **Raised by:** orchestrator
- **Confidence:** Verified
- **Bears on:** S-1, S-2, S-3

### C-6: `json-file.ts` already owns atomic, queued writes under `.3pitor/` and keeps the folder out of git

- **Claim:** `writeJson` serializes writes per path, writes a temp file then renames it, and creates a `.gitignore`
  holding `*` in the target's folder. It is JSON-only, and `stateFile` names only `session.json` and `view.json`.
- **Location:** `src/server/components/json-file.ts`.
- **Evidence:**
  ```ts
  // The app's own state on disk: JSON files under <workspace>/.3pitor/. Writes to one path land in call order, and each
  // one replaces the file whole, so a crash never leaves half a file.
  export const stateFile = (workspace: string, name: 'session.json' | 'view.json') => join(workspace, '.3pitor', name);
  ...
  export function writeJson(path: string, value: unknown): Promise<void> {
    const text = JSON.stringify(value);
    const write = (pending.get(path) ?? Promise.resolve()).then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await keepOutOfGit(dirname(path));
      const temp = `${path}.${process.pid}.tmp`;
      await Bun.write(temp, text);
      await rename(temp, path);
    });
  ```
- **Raised by:** orchestrator
- **Confidence:** Verified
- **Bears on:** S-1, D-3, D-5

### C-7: The documents list already hides dot-folders

- **Claim:** `GET /api/documents` lists no entry starting with `.`, so `.3pitor/` never appears in the file tree.
- **Location:** `src/shared/wire.ts`, `DocumentList`.
- **Evidence:**
  ```ts
  // GET /api/documents: every folder (empty ones too) and every .md file, none starting with "." and no symlinks,
  // sorted by `path` with `<`.
  ```
- **Raised by:** orchestrator
- **Confidence:** Verified (wire contract comment; the route was not re-read)
- **Bears on:** D-2

### C-8: Both chat backends and every subagent use the same `fileTools`

- **Claim:** The API backend gets `fileTools` directly; the claude CLI backend reaches the same tool objects over the
  in-process MCP endpoint (`serveTools`); `Task` subagents get `files[name]` from the same set. A change inside
  `fileTools` therefore applies to every path a model can write through.
- **Location:** `src/server/chat/agent/agent.ts` (`agentSettings`, `taskTool`);
  `src/server/chat/claude-cli/mcp-endpoint.ts` (`serveTools`); `src/server/chat/claude-cli/claude-cli.ts`.
- **Evidence:**
  ```ts
  // agent.ts
  const files = fileTools(options.workspace, turn, progress);
  ...
          tools: Object.fromEntries(agent.tools.map((name) => [name, files[name]])),
  ```
  ```ts
  // mcp-endpoint.ts
  // another program hosts). Each tool runs here, in-process, against the turn's copy of the posts.
      const output = await tool.execute!(input, { toolCallId, messages: [], abortSignal, context: undefined });
  ```
  ```ts
  // claude-cli.ts
      // claude's own file tools stay off: edits must land on the turn's copy, through 3pitor's tools.
  ```
- **Raised by:** orchestrator
- **Confidence:** Verified
- **Bears on:** S-2

### C-9: The system prompt tells the model every change is an unsaved editor edit

- **Claim:** The fixed prompt says only `.md` posts can be changed and that each change appears unsaved in the editor.
- **Location:** `src/server/chat/agent/system-prompt.md`, line 75.
- **Evidence:**
  ```markdown
  Only markdown (.md) posts can be changed. Each change appears in the writer's editor as an unsaved edit the moment you make it, with the text it changed highlighted, and the writer reviews and saves them.
  ```
- **Raised by:** orchestrator
- **Confidence:** Verified
- **Bears on:** S-5

### C-10: A prior decision forbids AI-driven disk writes

- **Claim:** The prior change plan made the UI's Save the only disk write for posts. This change carves out an
  exception for `.3pitor/`, which holds no posts.
- **Location:** `docs/changes/ai-edits-through-the-editor/artifacts/change-decision-log.md`, D-1 and D-8.
- **Evidence:**
  ```markdown
    applies `old_string` → `new_string` in the store. `Write` puts whole text in the store (D-7). None of them write disk.
  ...
    - Keep the save — rejected because it is a disk write the Save command did not start.
  ```
- **Raised by:** orchestrator
- **Confidence:** Verified
- **Bears on:** D-2

## Findings No Agent Could Audit

The running app was not launched, so the editor switch in C-4 is established from the code, not observed. The user's
report matches the code path exactly.

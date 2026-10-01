# Change Plan: Server Writes `.3pitor/` Notes

## Why This Change

The collaborative-editing skill keeps its session log in `pairing/`, which is the wrong place. Each time it updates
the log, the editor jumps to that file. The writer can't tell why, and has to find and reopen the post they were
on.

This is **friction the user reports**, in their own words, recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md). No ticket exists. The user was unavailable and asked the
run to pick the best recommendations, so every decision that would normally be escalated was settled by
recommendation and is marked that way in the decision log.

## What Changes, In One Paragraph

After this change, a markdown file under `.3pitor/` is a note the server writes straight to disk. It is never an
unsaved document in the editor. The model still asks for the change through its usual `Write` and `Edit` tools. The
server's tool code checks the path, writes the file atomically, and keeps it out of the turn's edits, so the editor
never sees it and never switches to it
([D-2](artifacts/change-decision-log.md#d-2-write-and-edit-on-a-3pitor-note-write-it-to-disk-in-the-servers-tool-code-bypassing-the-editor)).
The AI gets no filesystem write of its own. The collaborative-editing skill moves its log to
`.3pitor/editing/{date}-{slug}-content-edit.md`
([D-1](artifacts/change-decision-log.md#d-1-the-session-log-lives-at-3pitoreditingdate-slug-content-editmd)).
Posts are unaffected: only the writer's Save puts them on disk.

## Current State

- The skill's log path and resume search both point at `pairing/`
  ([C-1](artifacts/current-state-findings.md#c-1-the-collaborative-editing-skill-writes-its-log-to-pairing)).
  Its text tells the model every change lands unsaved in the editor, and tells the writer to save the log
  ([C-2](artifacts/current-state-findings.md#c-2-the-skill-tells-the-model-every-write-or-edit-lands-in-the-editor-unsaved)).
- `Write` and `Edit` in `src/server/chat/tools/tools.ts` put every change into the turn's copy (the version of the post that reaches the editor unsaved) and add it to
  `turn.edited`. That set feeds `data-progress` during the turn and `data-session` at its end
  ([C-3](artifacts/current-state-findings.md#c-3-write-and-edit-put-every-change-into-the-turns-copy-and-report-it-as-an-edited-post)).
- **The cause of the editor switch, which this change addresses:** `applyEdited` in
  `src/ui/documents/documents/documents.tsx` shows the last edited file whenever the open file was not edited. A turn
  that only appends to the log therefore moves the editor to the log
  ([C-4](artifacts/current-state-findings.md#c-4-the-editor-switches-to-the-last-edited-file-when-the-open-file-was-not-edited)).
  Today there is no path for a model-requested write that skips the editor.
- `resolvePost` refuses every dot-segment path, so `.3pitor/` cannot be written today. `Read` falls back to disk for
  such paths. `Glob` matches `.3pitor/…` only when the pattern names it
  ([C-5](artifacts/current-state-findings.md#c-5-resolvepost-refuses-every-path-with-a-dot-segment-so-3pitor-is-unwritable-today)).
- `src/server/components/json-file.ts` already owns atomic, per-path-ordered writes under `.3pitor/`, and keeps the
  folder out of git. It is JSON-only
  ([C-6](artifacts/current-state-findings.md#c-6-json-filets-already-owns-atomic-queued-writes-under-3pitor-and-keeps-the-folder-out-of-git)).
- The documents list already hides dot-folders
  ([C-7](artifacts/current-state-findings.md#c-7-the-documents-list-already-hides-dot-folders)). The API backend,
  the claude CLI's MCP endpoint, and `Task` subagents all run the same `fileTools`
  ([C-8](artifacts/current-state-findings.md#c-8-both-chat-backends-and-every-subagent-use-the-same-filetools)).
- An earlier change plan decided that the AI's edits never reach disk
  ([C-10](artifacts/current-state-findings.md#c-10-a-prior-decision-forbids-ai-driven-disk-writes)). This change makes
  an exception for `.3pitor/` only. That folder holds no posts.

## Target State

There are two kinds of markdown file the model can change:

- **Posts.** Unchanged. A change goes into the turn's copy, is highlighted, and reaches the editor unsaved. Only the
  writer's Save writes it to disk.
- **Notes.** Any `.md` file under `<workspace>/.3pitor/`, with no other dot-segment in its path. A change is written
  to disk by the server during the tool call. It never enters `turn.texts` or `turn.edited`, so it never appears in
  `data-progress` or `data-session`, and the editor never opens it.

Responsibilities after the change:

- **`json-file.ts`** owns every write under `.3pitor/`, through `writeText`. `writeJson` is a one-line call to it
  ([D-3](artifacts/change-decision-log.md#d-3-extract-writetextpath-text-from-writejson-and-use-it-for-notes)).
- **`tools.ts`** decides whether a path is a note (`resolveAppNote`, private). It sends notes to `writeText` and
  posts to the turn copy. It does not control how a note reaches disk.
- **The UI** is unchanged. Notes cannot reach it
  ([D-7](artifacts/change-decision-log.md#d-7-no-ui-change-highlight-still-refuses-notes)).
- **`Read`** is unchanged. It already reads dot-paths from disk
  ([D-9](artifacts/change-decision-log.md#trivial-decisions)).
- **`Highlight`** is unchanged. It still refuses a note, because there is nothing in the editor to point at.

### Pinned contracts

**`writeText`** (`src/server/components/json-file.ts`, exported):

```ts
// Captures `text` when called. Writes to one path land in call order; each replaces the file whole.
// The returned promise rejects with this write's error; later writes to the same path still run.
export function writeText(path: string, text: string): Promise<void>
// writeJson(path, value) === writeText(path, JSON.stringify(value))
```

Steps, in order, inside the per-path queue:

1. `mkdir(dirname(path), { recursive: true })`
2. `keepOutOfGit(dirname(path))`
3. write `${path}.${process.pid}.tmp`
4. `rename` the temp file over `path`

**`resolveAppNote`** (`src/server/chat/tools/tools.ts`, private). It classifies the real path, so any path that is
not clearly a note falls through to `resolvePost` and is refused as today
([D-4](artifacts/change-decision-log.md#d-4-a-note-is-any-md-file-under-3pitor-classified-by-its-real-path)):

```ts
function resolveAppNote(workspace: string, filePath: string): string | undefined
// note  ⇔ not an APP_SKILL_PREFIX path
//        ∧ segments = relative(realpath(workspace), resolveInWorkspace(workspace, filePath)).split(sep)
//        ∧ segments[0] === '.3pitor' ∧ segments.length >= 2
//        ∧ target ends with '.md' ∧ no segment after the first starts with '.'
```

| `file_path`                                    | Outcome                                       |
| ---------------------------------------------- | --------------------------------------------- |
| `.3pitor/editing/2026-10-01-x-content-edit.md` | note, written to disk                         |
| `.3pitor/../notes.md`                          | post `notes.md`, through the editor           |
| `.3pitor/session.json`                         | refused: `… is not a markdown post`           |
| `.3pitor/editing/.x.md`                        | refused: `… is not a markdown post`           |

**`Write` and `Edit` on a note.** Tool results and errors use the same shapes as for posts. `{name}` is the
workspace-relative real path:

| Tool    | Effect                                                                                     | Result           |
| ------- | ------------------------------------------------------------------------------------------ | ---------------- |
| `Write` | `await writeText(target, content)`                                                         | `wrote {name}`   |
| `Edit`  | reads disk; `{file_path} does not exist` if missing; same exactly-once `old_string` errors as posts; `await writeText(target, next)` | `edited {name}` |

Neither calls `markEdited`, `highlightChanges`, `refuseUnsupported`, or `onChange`.

## Surface Delta

### S-1: `writeText` in `src/server/components/json-file.ts` — Added

**Target state.** `writeText(path, text)` exists and is the only code that writes a file under `.3pitor/`. Writes to
one path are queued in call order. Each one creates the folder, makes sure the folder holds a `.gitignore` of `*`,
and atomically replaces the file. `writeJson` delegates to it. The file's header comment describes "files" under
`.3pitor/`, not only JSON. The module keeps its name
([D-10](artifacts/change-decision-log.md#trivial-decisions)).

**Behavior.** Preserving for `writeJson` and its callers: they get the same bytes, the same order, and the same
errors. The note-specific consequence, that notes are git-ignored, is covered in Behavior Changes
([D-5](artifacts/change-decision-log.md#d-5-notes-are-kept-out-of-git-like-the-rest-of-3pitor)).

**Why.** A note needs atomic replace, folder creation, and per-path ordering, and `writeJson` already provides all
three.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-extract-writetextpath-text-from-writejson-and-use-it-for-notes),
[D-5](artifacts/change-decision-log.md#d-5-notes-are-kept-out-of-git-like-the-rest-of-3pitor)

### S-2: `fileTools` `Write` and `Edit` in `src/server/chat/tools/tools.ts` — Re-scoped

**Target state.** `Write` and `Edit` handle two kinds of file. A markdown note under `.3pitor/`, as classified by the
private `resolveAppNote`, is written to disk through `writeText` during the call and never enters the turn's copy,
edits, highlights, or progress. Every other path behaves exactly as before. The file's header comment says that
posts are only ever changed in the turn's copy, and that notes under `.3pitor/` are written by the server.

**Behavior.** Changing. `.3pitor/**/*.md` was refused and is now writable. A turn that changes only a note no longer
moves the editor. A stopped turn keeps note writes it already made. All of these were settled by recommendation; see
Behavior Changes.

**Why.** The editor switch is caused by the log entering `turn.edited`
([C-4](artifacts/current-state-findings.md#c-4-the-editor-switches-to-the-last-edited-file-when-the-open-file-was-not-edited)).
The user asked for the server to write these files.

**Depends on.** S-1

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-write-and-edit-on-a-3pitor-note-write-it-to-disk-in-the-servers-tool-code-bypassing-the-editor),
[D-4](artifacts/change-decision-log.md#d-4-a-note-is-any-md-file-under-3pitor-classified-by-its-real-path),
[D-6](artifacts/change-decision-log.md#d-6-a-stopped-turn-keeps-the-note-writes-it-already-made)

### S-3: Model-facing instructions for `Write`, `Edit`, and `system-prompt.md` — Re-scoped

**Target state.** The `Write` and `Edit` tool descriptions, and the file-tools paragraph of
`src/server/chat/agent/system-prompt.md`, each say that a markdown file under `.3pitor/` is saved directly and never
opens in the editor. Everything else they say about posts is unchanged.

**Behavior.** Changing, for the model's wording only. It stops telling the writer to save a note.

**Why.** Today's text says every change appears unsaved in the editor
([C-9](artifacts/current-state-findings.md#c-9-the-system-prompt-tells-the-model-every-change-is-an-unsaved-editor-edit)).

**Depends on.** S-2

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-models-instructions-say-notes-are-saved-directly)

### S-4: The collaborative-editing session log — Moved

**Target state.** `src/skills/collaborative-editing/SKILL.md` names the log path
`.3pitor/editing/{today, YYYY-MM-DD}-{slug}-content-edit.md`. It finds a run to resume with
`Glob .3pitor/editing/*-{slug}-content-edit.md`, which names the folder explicitly. The intro says the log is saved
directly and never opens in the editor. Step 6's report still gives the log path, and reminds the writer to save only
the draft and the lessons file. Nothing in the skill mentions `pairing/`.

**Behavior.** Changing. New logs go to a hidden, git-ignored folder. An unfinished run whose log is in `pairing/`
does not resume.

**Why.** The user named the new location.

**Depends on.** S-2. Before S-2 lands, a `Write` to `.3pitor/` is refused.

**Migration.** None. Existing `pairing/` files are left in place
([D-11](artifacts/change-decision-log.md#d-11-logs-already-under-pairing-are-not-migrated-or-searched)).

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-session-log-lives-at-3pitoreditingdate-slug-content-editmd),
[D-8](artifacts/change-decision-log.md#d-8-the-models-instructions-say-notes-are-saved-directly),
[D-11](artifacts/change-decision-log.md#d-11-logs-already-under-pairing-are-not-migrated-or-searched)

## Behavior Changes

Every one of these was settled by recommendation, because the user was away. Each can be reversed.

1. **The editor stays on your post while the editing session updates its notes.** This is the change the user asked
   for. Observer: the writer.
   ([D-2](artifacts/change-decision-log.md#d-2-write-and-edit-on-a-3pitor-note-write-it-to-disk-in-the-servers-tool-code-bypassing-the-editor))
2. **The session log is saved immediately, in a hidden folder.** It goes to `.3pitor/editing/` and is not in the
   file list. The writer never saves it. To read it, the writer opens it outside the app or asks the AI to read it.
   Observer: the writer.
   ([D-1](artifacts/change-decision-log.md#d-1-the-session-log-lives-at-3pitoreditingdate-slug-content-editmd))
3. **Logs are no longer committed to git.** Logs in `pairing/` could be committed. Logs in `.3pitor/editing/` are
   ignored, like the rest of the app's folder. Observer: the writer, using git.
   ([D-5](artifacts/change-decision-log.md#d-5-notes-are-kept-out-of-git-like-the-rest-of-3pitor))
4. **Stopping a reply keeps the log entries it already wrote.** The draft edits from that reply are still thrown away,
   so the log can mention an edit the writer never got. Observer: the writer, reading the log after a Stop.
   ([D-6](artifacts/change-decision-log.md#d-6-a-stopped-turn-keeps-the-note-writes-it-already-made))
5. **An editing run started before this change will not resume.** Its log is in `pairing/`, which the skill no
   longer searches, so asking to resume starts a new run. Observer: a writer with an unfinished run.
   ([D-11](artifacts/change-decision-log.md#d-11-logs-already-under-pairing-are-not-migrated-or-searched))
6. **The AI can now change markdown files under `.3pitor/`.** Before, it was refused. It still cannot touch the app's
   own `session.json`, `view.json`, or `.gitignore`. Observer: anyone reviewing what the AI may write.
   ([D-4](artifacts/change-decision-log.md#d-4-a-note-is-any-md-file-under-3pitor-classified-by-its-real-path))

## Change Units

### Unit 1: Extract `writeText`

**What it does.** Pulls the queued, atomic write out of `writeJson` into `writeText(path, text)`, and makes
`writeJson` call it. This unit changes no behavior.

**Delta entries.** S-1

**How you know it worked.** The existing `json-file.test.ts` passes unchanged. A new test shows two `writeText`
calls to one path land in call order, and that a missing folder is created along with its `.gitignore`.

### Unit 2: Notes in `Write` and `Edit`

**What it does.** Adds `resolveAppNote` and routes notes in `Write` and `Edit` to `writeText`. Updates the two tool
descriptions, the `tools.ts` header comment, and the file-tools paragraph of `system-prompt.md`.

**Delta entries.** S-2, S-3

**Ordering constraint.** After Unit 1, because it calls `writeText`.

**How you know it worked.** New tests in `tools.test.ts`:

- `Write` to `.3pitor/editing/x.md` creates the file on disk, and leaves `editedTexts(turn)` as `{}` and
  `turn.highlights` unset. `onChange` is not called.
- `Edit` on a note changes it on disk. It errors on a missing note, and on a missing or repeated `old_string`.
- `Write` then `Read` of a note returns the new text.
- `.3pitor/session.json`, `.3pitor/editing/.x.md`, and `.3pitor/.a/b.md` are still refused.
- `.3pitor/../notes.md` is handled as the post `notes.md`.
- `Highlight` on a note is refused.

The existing tests pass unchanged, including `Write refuses anything that is not a markdown post` and the
`.claude/` case. Any agent or session test that matches on the full system prompt is updated for the added sentence.

### Unit 3: Move the collaborative-editing log

**What it does.** Rewrites the log path, the resume glob, the intro sentence, and the Step 6 save reminder in
`src/skills/collaborative-editing/SKILL.md`.

**Delta entries.** S-4

**Ordering constraint.** After Unit 2. Before it, the skill's first log `Write` would be refused.

**How you know it worked.** Run a collaborative edit in the app. The editor stays on the draft across stops. The log
appears at `.3pitor/editing/…` on disk without a Save, and the file tree does not show it. Grep confirms no
`pairing/` reference remains under `src/skills/`. The app-skill files are compiled in through
`app-skills.macro.ts`, so restart the dev server or rebuild before checking.

## Risks

- **Two concurrent `Edit`s on one note can lose an update.** The queue orders writes, not read-modify-write. The
  turn copy has the same race for posts today. It only shows if the model or parallel `Task` subagents edit one log
  in the same step. A missing `## Feedback log` entry would be the sign. The fix is deferred below.
- **A Stop can leave the log ahead of the draft**
  ([D-6](artifacts/change-decision-log.md#d-6-a-stopped-turn-keeps-the-note-writes-it-already-made)). This is
  detectable by reading the log after a Stop, and harmless to resume, which checks only for `## Close`.
- **Unit 2 touches every `Write` and `Edit`.** Every call passes through the new check, for both backends and for
  subagents. The check fails closed: anything not clearly a note goes to `resolvePost` as today. The refusal tests
  in Unit 2 guard it.

## Deferred (YAGNI)

- **`updateText(path, fn)`**, a read-modify-write that runs inside the per-path queue. It would close the
  lost-update risk above. Reopen it when a lost log entry is observed, or when a skill issues parallel edits to one
  note.
- **A shared `.3pitor` path constant or note-path helper.** Today only `stateFile` and `resolveAppNote` know the
  folder name. Reopen it when a third caller builds `.3pitor/` paths.

## Cut for Scope

- **Resuming a run whose log is still in `pairing/`.** On resume, the skill would also have checked `pairing/` once,
  so an unfinished run from before the change could continue. The boundary record lists migrating `pairing/` logs as
  out of scope, and the user asked for `pairing/` to stop being used
  ([D-11](artifacts/change-decision-log.md#d-11-logs-already-under-pairing-are-not-migrated-or-searched)). Say so to
  reinstate it.
- **A way to view `.3pitor/` files in the app.** The user's goal is that these files stay out of the UI, and the
  boundary record lists browsing them as out of scope.

## Open Items

- **Non-blocking: should editing logs be in git?** They are now ignored
  ([D-5](artifacts/change-decision-log.md#d-5-notes-are-kept-out-of-git-like-the-rest-of-3pitor)). If the writer
  wants them committed, that needs a decision on whether `keepOutOfGit` should skip `.3pitor/editing/`. The workaround
  is to empty the `.gitignore` files.
- **Non-blocking: other skills.** Only collaborative-editing writes a log today. `research` and `proofread` do not
  reference `pairing/` (grepped). A future skill that wants a record should use `.3pitor/<skill>/`.

## Review Findings

Two specialists reviewed the proposed target state in one round: `han-core:software-architect` and
`han-core:junior-developer`.

- **Architect.**
  - Confirmed extracting `writeText` instead of calling `Bun.write` directly (D-3).
  - Recommended keeping `keepOutOfGit(dirname)` (D-5) and covering all of `.3pitor/` with a `.md`-only rule (D-4).
  - Pinned the classification rule and its symlink and `..` cases.
  - Added the `system-prompt.md` update (D-8).
  - Named the lost-update gap as a deferral.
  - Its one `Unverified` point was whether `realpathSync` returns the on-disk case. The orchestrator checked it on
    APFS, where it does, and recorded the result in D-4.
- **Generalist.**
  - Raised the orphaned `pairing/` run (D-11) and gitignored logs (D-5).
  - Raised the stopped-turn mismatch (D-6) and the stale system prompt (D-8).
  - Raised the missing tests, now the Unit 2 test list.
  - Asked whether to limit the carve-out to `editing/`, which the user's wording answers (D-4).

The full rationale for each decision is in
[artifacts/change-decision-log.md](artifacts/change-decision-log.md).

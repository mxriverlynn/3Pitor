# Change Decision Log: Server Writes `.3pitor/` Notes

<!--
This file records every decision committed while planning Server Writes `.3pitor/` Notes.
The plan itself lives in [../change-plan.md](../change-plan.md). This file captures the question, rationale,
evidence, and rejected alternatives behind each decision. Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

The user was unavailable for this run and asked it to "pick the best recommendations". Every decision below that
would normally have been escalated, including each behavior-changing one, was settled by recommendation. Each says
so in its Behavior impact field, so the user can overturn any of them.
-->

## Trivial decisions

- D-9: Read of a note needs no change — `Read` already reads any dot-path from disk, because `postNameOrUndefined`
  returns undefined for it and the turn copy is never consulted (C-5). — Referenced in plan: Target State.
- D-10: The module keeps its name — `json-file.ts` stays `json-file.ts` with an updated header comment; renaming it is
  churn with no friction behind it. — Referenced in plan: Surface Delta (S-1).

## Full decisions

### D-1: The session log lives at `.3pitor/editing/{date}-{slug}-content-edit.md`

- **Question:** Where does the collaborative-editing skill keep its session log?
- **Decision:** The log path is `.3pitor/editing/{today, YYYY-MM-DD}-{slug}-content-edit.md`. The resume search is
  `Glob .3pitor/editing/*-{slug}-content-edit.md`, named explicitly, because `**/*.md` skips dot-folders. The file
  name format is unchanged.
- **Rationale:** The user named the folder. Keeping the file name means the resume rule (newest match without
  `## Close`) is unchanged.
- **Evidence:** user input (scope-boundary.md); C-1; C-5 (Glob with an explicit `.3pitor/` pattern matches; `**/*.md`
  does not).
- **Behavior impact:** Changing for the writer: new logs appear in a hidden folder instead of `pairing/`. This is
  the user's explicit request.
- **Rejected alternatives:**
  - Keep `pairing/` and only stop the editor switching — rejected because the user said `pairing/` "is wrong".
  - Rename the file to `{slug}.md` — rejected because nothing asked for it and the date prefix drives "newest match".
- **Revisit criterion:** Another skill wants a log folder under `.3pitor/`; then name the convention once.
- **Dissent (if any):** none.
- **Settles delta entry:** S-4
- **Dependent decisions:** D-8
- **Referenced in plan:** What Changes, In One Paragraph; Surface Delta (S-4); Behavior Changes

### D-2: `Write` and `Edit` on a `.3pitor/` note write it to disk in the server's tool code, bypassing the editor

- **Question:** How does a model-requested change to a file under `.3pitor/` reach disk without the editor showing
  it, given that the AI gets no write permission of its own?
- **Decision:** Inside `fileTools`, `Write` and `Edit` first ask `resolveAppNote` (D-4) whether the path is a note.
  When it is:
  - `Write` calls `await writeText(target, content)` (D-3) and returns `wrote {name}`.
  - `Edit` reads the note's text from disk (throwing `{file_path} does not exist` when missing), applies the same
    exactly-once `old_string` rule and errors as for posts, calls `await writeText(target, next)`, and returns
    `edited {name}`.
  - Neither calls `markEdited`, `highlightChanges`, `refuseUnsupported`, or `onChange`. The note never enters
    `turn.texts` or `turn.edited`, so it never appears in `data-progress` or `data-session`.
  - `{name}` is the workspace-relative real path, e.g. `.3pitor/editing/2026-10-01-draft-content-edit.md`.

  When it is not a note, both tools behave exactly as today.
- **Rationale:** The editor switch (C-4) is driven entirely by `turn.edited`. Keeping notes out of it removes the
  switch with no UI change. The write happens in server code the model calls through its existing tool, which is what
  the user described: "the server layer intercepts the file writes, as it does today, and the server code writes the
  files". Because every backend and subagent uses the same `fileTools` (C-8), one change covers all of them, and the
  claude CLI's own file tools stay off.
- **Evidence:** C-3, C-4, C-8; architect review A3, A6.
- **Behavior impact:** Changing. This is an exception, limited to `.3pitor/`, to the prior decisions that the AI's
  edits never reach disk and only Save writes a file (C-10). `.3pitor/` holds no posts, so those decisions still
  govern every post. Settled by recommendation; the user asked for exactly this behavior.
- **Rejected alternatives:**
  - Filter `.3pitor/` names out in the UI's `applyEdited` — rejected because the note would still round-trip through
    the browser and only reach disk on a Save the writer never sees, and the user asked for the server to write.
  - A separate model tool such as `WriteNote` — rejected because it adds a tool the model must learn, the skill and
    workspace agents' `tools:` lines name `Write`/`Edit`, and a path test inside the existing tools does the job.
  - Give the claude CLI its own `Write` scoped to `.3pitor/` — rejected; the user said the AI gets no write
    permission.
- **Revisit criterion:** A note needs to be shown or reviewed in the editor.
- **Dissent (if any):** none.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-3, D-4, D-6, D-7, D-8
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta (S-2); Behavior Changes

### D-3: Extract `writeText(path, text)` from `writeJson` and use it for notes

- **Question:** What performs the disk write for a note?
- **Decision:** `src/server/components/json-file.ts` exports
  `writeText(path: string, text: string): Promise<void>`. It captures `text` when called, waits on the same per-path
  `pending` queue `writeJson` uses, runs `mkdir(dirname(path), { recursive: true })`, `keepOutOfGit(dirname(path))`,
  writes `${path}.${process.pid}.tmp`, and renames it over `path`. Its promise rejects with this write's error; later
  writes to the same path still run. `writeJson(path, value)` becomes `writeText(path, JSON.stringify(value))`. The
  header comment says "files" instead of "JSON files".
- **Rationale:** A note needs the same three properties `writeJson` already provides: atomic replace (an `Edit`
  rewrites the whole log, so a torn write loses its whole history), creating `.3pitor/editing/` on first use, and
  per-path ordering when parallel tool calls or Task subagents touch the same log. It is an extraction with two real
  callers, not a new abstraction.
- **Evidence:** C-6; architect review A1.
- **Behavior impact:** Preserving for `writeJson`: same bytes, same order, same errors.
- **Rejected alternatives:**
  - Call `Bun.write` directly in `tools.ts` — rejected because it loses atomicity, folder creation, and ordering.
  - An `updateText(path, fn)` that runs read-modify-write inside the queue — deferred (YAGNI), see plan.
- **Revisit criterion:** A lost log entry is observed from two concurrent `Edit`s on one note.
- **Dissent (if any):** none.
- **Settles delta entry:** S-1
- **Dependent decisions:** D-5
- **Referenced in plan:** Target State; Surface Delta (S-1); Deferred (YAGNI)

### D-4: A note is any `.md` file under `.3pitor/`, classified by its real path

- **Question:** Which paths count as notes the server writes directly?
- **Decision:** A private function in `tools.ts`:
  ```ts
  // The real path of a markdown note under <workspace>/.3pitor/, or undefined for anything else.
  function resolveAppNote(workspace: string, filePath: string): string | undefined {
    if (filePath.startsWith(APP_SKILL_PREFIX)) return undefined;
    const target = resolveInWorkspace(workspace, filePath); // throws outside the workspace
    const segments = relative(realpathSync(workspace), target).split(sep);
    return segments[0] === '.3pitor' && segments.length >= 2 && target.endsWith('.md')
      && segments.slice(1).every((s) => !s.startsWith('.'))
      ? target
      : undefined;
  }
  ```
  Worked examples:

  | `file_path`                                   | Result                                              |
  | --------------------------------------------- | --------------------------------------------------- |
  | `.3pitor/editing/2026-10-01-x-content-edit.md` | note                                                |
  | `./.3pitor/editing/x.md`                       | note                                                |
  | `.3pitor/../notes.md`                          | not a note; a post (`notes.md`)                     |
  | `.3pitor/session.json`, `.3pitor/view.json`    | not a note; refused by `resolvePost` as today       |
  | `.3pitor/editing/.x.md`, `.3pitor/.a/b.md`     | not a note; refused by `resolvePost`                |
  | `.claude/skills/x/SKILL.md`                    | not a note; refused by `resolvePost`                |
  | `.3PITOR/editing/x.md` (folder exists)         | note: `realpathSync` returns the on-disk case on APFS (checked 2026-10-01) |
- **Rationale:** The user asked for "that folder and sub-folders", so the carve-out covers all of `.3pitor/` rather than
  only `editing/`. The `.md` rule keeps the model away from `session.json`, `view.json`, and `.gitignore`. Classifying
  the real path means a symlink cannot leave the workspace, and any path that is not clearly a note falls through to
  `resolvePost`, which refuses dot-paths, so the rule fails closed.
- **Evidence:** C-5, C-6; scope-boundary.md; architect review A3, A4; `realpathSync` case check run in this session.
- **Behavior impact:** Changing only in that these paths are now writable where they were refused (D-2). All other
  paths keep today's outcome.
- **Rejected alternatives:**
  - Limit to `.3pitor/editing/` — rejected because it narrows what the user asked for, and nothing else under
    `.3pitor/` is markdown today.
  - Allow any file type under `.3pitor/` — rejected because it would let the model overwrite the app's own state.
- **Revisit criterion:** The app starts keeping its own `.md` state under `.3pitor/`; then exclude it by name.
- **Dissent (if any):** The generalist review asked whether to limit to `editing/`; answered by the user's wording.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State; Surface Delta (S-2)

### D-5: Notes are kept out of git, like the rest of `.3pitor/`

- **Question:** Should a note be committable?
- **Decision:** `writeText` keeps `keepOutOfGit(dirname(path))`, so the first note write creates
  `.3pitor/editing/.gitignore` holding `*`. No special case is added.
- **Rationale:** `.3pitor/` is already ignored whenever `session.json` has been written (C-6), so notes would be
  ignored anyway. The nested file also covers a workspace where `.3pitor/.gitignore` was never created. Pointing the
  call at the `.3pitor` root would tie a generic writer to the folder layout.
- **Evidence:** C-6; architect review A2.
- **Behavior impact:** Changing: logs under `pairing/` could be committed; logs under `.3pitor/editing/` are
  ignored by git. Settled by recommendation, as a direct consequence of the location the user chose. A deleted
  `.3pitor/editing/.gitignore` is recreated on the next write, but `keepOutOfGit` leaves an existing one alone, so a
  writer who wants logs in git can empty both `.gitignore` files instead. That is noted as an open item.
- **Rejected alternatives:**
  - Skip `keepOutOfGit` for notes — rejected because `.3pitor/.gitignore` usually ignores them anyway, so the
    result would vary by workspace.
- **Revisit criterion:** The writer asks for editing logs in version control.
- **Dissent (if any):** none.
- **Settles delta entry:** S-1
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes; Open Items

### D-6: A stopped turn keeps the note writes it already made

- **Question:** When the writer stops a turn, what happens to a note the turn already wrote?
- **Decision:** It stays on disk. Draft edits from the stopped turn are still discarded, as today.
- **Rationale:** Undoing a note would need a per-turn journal for one file, with no observed need. The log is a record,
  and resume only looks for `## Close`, so an extra entry does not break the run.
- **Evidence:** C-3 (`edited: aborted ? {} : editedTexts(turn)`); architect review A5; generalist question 6.
- **Behavior impact:** Changing: after a Stop, the log can describe an edit the writer never received. Today a
  stopped turn leaves no trace in the log, because the log travels with the draft edits. Settled by recommendation.
- **Rejected alternatives:**
  - Buffer note writes until the turn finishes — rejected because the model then cannot Read back what it just
    appended inside a turn, and it brings the per-turn state back for a file the turn should not hold.
- **Revisit criterion:** A writer reports a log that disagrees with the draft after a Stop.
- **Dissent (if any):** none.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes; Risks

### D-7: No UI change; `Highlight` still refuses notes

- **Question:** Does the UI need to filter `.3pitor/` files?
- **Decision:** No. Notes never reach `turn.edited` (D-2), and the documents list already hides dot-folders (C-7).
  `Highlight` keeps resolving through `resolvePost`, so it refuses a note: there is nothing in the editor to point at.
- **Rationale:** The fix lives where the cause is (C-4 reacts to `turn.edited`). A UI filter would be a second guard
  for a case that cannot happen.
- **Evidence:** C-4, C-7; architect review A6 (`chat.tsx` shows `file_path` only as a label, with no open-on-click).
- **Behavior impact:** Preserving for the UI code; the observable result (no switch) is covered by D-2.
- **Rejected alternatives:**
  - Add a `.3pitor/` filter in `applyEdited` as defense in depth — rejected because nothing would ever reach it.
- **Revisit criterion:** A second path into `turn.edited` appears.
- **Dissent (if any):** none.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-8: The model's instructions say notes are saved directly

- **Question:** What does the model need to be told?
- **Decision:**
  - The `Write` and `Edit` tool descriptions each add one sentence: a markdown file under `.3pitor/` is saved directly
    and never opens in the editor.
  - `system-prompt.md` line 75 adds the same sentence after "Only markdown (.md) posts can be changed."
  - `SKILL.md` intro replaces "Everything you Write or Edit appears in the writer's editor…" with wording that
    excepts the session log: it is saved directly under `.3pitor/editing/` and never opens in the editor. Step 6 item 5
    reminds the writer to save the draft and the lessons file, not the log, and still reports the log path.
- **Rationale:** Today's text says every change appears unsaved in the editor (C-2, C-9). Left alone, the model would
  tell the writer to save a log they cannot see.
- **Evidence:** C-2, C-9; architect review A7, A8; generalist question 7.
- **Behavior impact:** Changing for the model's chat wording only, which follows from D-1 and D-2.
- **Rejected alternatives:**
  - Change only the skill — rejected because the prompt and tool descriptions would still contradict it.
- **Revisit criterion:** —
- **Dissent (if any):** none.
- **Settles delta entry:** S-3, S-4
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta (S-3, S-4)

### D-11: Logs already under `pairing/` are not migrated or searched

- **Question:** What happens to an in-progress run whose log is in `pairing/`?
- **Decision:** Nothing reads `pairing/` after the change. A resume finds no log under `.3pitor/editing/` and
  starts a new run. Existing `pairing/` files stay where they are, untouched.
- **Rationale:** The user's request does not mention migration, and the app is used by one writer who can finish or
  restart a run. A fallback search would keep the wrong location alive in the skill text.
- **Evidence:** scope-boundary.md (migration listed as out of scope); generalist question 1.
- **Behavior impact:** Changing: an unfinished run started before the change does not resume. Settled by
  recommendation.
- **Rejected alternatives:**
  - Also Glob `pairing/` once on resume — rejected (Cut for Scope, see plan).
  - Move existing logs automatically — rejected; a server-side move of user files nobody asked for.
- **Revisit criterion:** The writer has an unfinished `pairing/` run they want to keep.
- **Dissent (if any):** none.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes; Cut for Scope

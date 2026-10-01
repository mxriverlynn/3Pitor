# Change Decision Log: Live workspace file watching

This file records every decision committed while planning live workspace file watching. The plan itself lives in
[../change-plan.md](../change-plan.md). Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

Every escalation in this run was settled without asking the operator. That follows the operator's standing preference
for han planning runs (D-16). Each behavior-changing decision says so, and the plan's Behavior Changes section gathers
them for the operator to read.

## Trivial decisions

- D-16: Settle escalations without asking — every question and behavior-change gate is decided by the run and logged
  here, per the operator's standing instruction for planning runs ("make the best decisions you can, without asking
  me"). — Referenced in plan: Why This Change, Behavior Changes.
- D-17: Plan folder and skill — the plan lives in `docs/changes/live-workspace-file-watching/`, matching the other
  plans there. It runs as `plan-a-change` because the operator invoked that skill, and treats every new behavior as a
  behavior-changing delta entry. — Referenced in plan: Why This Change.

## Full decisions

### D-1: Use Bun's built-in recursive watcher

- **Question:** Which file watcher does the server use?
- **Decision:** One `fs.watch(workspace, { recursive: true })` from `node:fs`, as Bun implements it. No new dependency.
- **Rationale:** It fits the single compiled executable. In this project's own runtime and on a 22,000-entry workspace,
  it started in 3 ms and missed no event. The one bug report against it (watcher churn dropping events) did not
  reproduce, and the plan opens exactly one watcher, which avoids that bug's trigger.
- **Evidence:** C-31; research recommendation and options O1–O4 (`docs/research/live-workspace-file-watching.md`); C-6
  (single executable, no native addon today).
- **Behavior impact:** Changing, through S-2. See D-6.
- **Rejected alternatives:**
  - `@parcel/watcher` — rejected because it needs a per-platform native binary inside a `bun build --compile`
    executable, which nobody has shown to work, and C-31 removed the reason to need it.
  - chokidar — rejected because it creates one watch per folder or file and was slow to start on Bun on macOS (research
    A13, A14).
  - Watchman — rejected because it needs a separately installed service.
- **Revisit criterion:** the built app misses changes or drops events in practice, or Linux support becomes a target.
- **Dissent (if any):** none.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-3, D-4, D-5
- **Referenced in plan:** Target State, Surface Delta

### D-2: The tree walk skips a folder that vanishes mid-walk

- **Question:** What does `listEntries` do when a sub-folder disappears while it walks?
- **Decision:** `listEntries` catches `ENOENT` and `ENOTDIR` from `readdir` of a sub-folder and skips that folder. A
  failure reading the workspace root still throws.
- **Rationale:** Folder deletes and git checkouts are exactly when the browser now reloads the list. Today one vanished
  folder turns the whole request into a 500.
- **Evidence:** C-1; behavioral-analyst B28; concurrency-analyst K7.
- **Behavior impact:** Changing. `GET /api/documents` answered 500 when a folder vanished mid-walk. It now answers 200
  with every entry it could still read. Observer: the browser's Documents pane. Settled by the run per D-16.
- **Rejected alternatives:**
  - Retry the whole walk — rejected because the walk would race the same burst again, and the settle timer already
    triggers another reload when the burst ends.
  - Leave it failing and catch in the browser — rejected because the pane would stay stale for the whole burst.
- **Revisit criterion:** a vanished folder is reported as missing entries that never come back.
- **Dissent (if any):** none.
- **Settles delta entry:** S-1
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes, Change Units

### D-3: The watcher lives in `documents.ts` and ignores hidden paths only

- **Question:** Where does the watcher live, and which events does it ignore?
- **Decision:**
  - `watchDocuments` lives in `src/server/documents/documents.ts`.
  - A module-private `isHiddenName(name: string): boolean` returns `name.startsWith('.')` and has three uses there:
    `checkPath`, `listEntries`, and the watcher.
  - The watcher drops an event when `filename` is set and any segment of `filename.split(/[\\/]/)` is hidden. It drops
    nothing else.
  - An event with no `filename` is kept.
- **Rationale:**
  - The documents module is the one place that knows which disk paths count as documents (C-2).
  - The app writes `.3pitor/` state about every 300 ms while the user types (C-13), and git writes `.git/`. Without the
    hidden filter, each write would reload the list and re-read every open file.
  - Non-markdown files are not filtered, because a folder name looks the same as an extensionless file name.
- **Evidence:** C-2, C-13, C-14; software-architect A5.
- **Behavior impact:** Preserving for `checkPath` and `listEntries`, which keep the same rule through a named helper.
- **Rejected alternatives:**
  - A separate `documents-watcher.ts` with an exported `isHiddenName` — rejected because it adds a file and an export
    for no gain.
  - Also filtering non-`.md` names — rejected because folders cannot be told from files by name, and a stray reload has
    no measured cost.
- **Revisit criterion:** a measured reload storm from non-markdown churn inside the workspace.
- **Dissent (if any):** none.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

### D-4: Start the watcher in `server.ts`, guard its callback, log its errors, and add no shutdown hook

- **Question:** Who starts the watcher, and what happens when it fails?
- **Decision:**
  - `server.ts` calls `watchDocuments(workspace, () => host.events.emit({ type: 'documents-changed' }))` right after
    `createAgentHost`, and does not keep the returned handle.
  - The watcher wraps `onSettled` in a try/catch that logs.
  - It registers `watcher.on('error', …)` to log.
  - `close()` clears the settle timer and closes the watcher, and only tests call it.
- **Rationale:**
  - `server.ts` is the single composition root, and `host.events` is the only bus (C-5).
  - `EventBus.emit` has no try/catch, and the call runs in a timer (C-3).
  - An `FSWatcher` error with no listener throws (C-6).
  - The server has no lifecycle hook (C-6), so process exit releases the watcher.
- **Evidence:** C-3, C-5, C-6; software-architect A5.
- **Behavior impact:** Changing, through S-4: the server now watches the workspace while it runs.
- **Rejected alternatives:**
  - Building the watcher inside `createAgentHost` — rejected because that object is the chat host, and its name does
    not cover file watching (structural-analyst S6).
  - Adding a shutdown hook — rejected under YAGNI, because nothing shuts the server down gracefully today.
- **Revisit criterion:** graceful shutdown lands, or a watcher error is seen in practice.
- **Dissent (if any):** none.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Risks

### D-5: Settle bursts with a 100 ms trailing timer

- **Question:** How long does the watcher wait before announcing a change?
- **Decision:** A literal 100 ms trailing timer. Each kept event restarts it, and it fires `onSettled` once when 100 ms
  pass with no event. There is no maximum wait.
- **Rationale:**
  - A folder delete arrives as one event per entry (C-31: 551 events), and settling turns that into one reload.
  - 100 ms is above the gap between events in a burst, and short enough to feel immediate.
  - A maximum wait has no evidence behind it.
- **Evidence:** C-31; research "watcher events are hints" (A18, A22, A24).
- **Behavior impact:** Preserving (internal timing of a new part).
- **Rejected alternatives:**
  - No settle — rejected because 551 events would mean 551 reloads.
  - A configurable delay — rejected because no caller would set it.
- **Revisit criterion:** a continuous writer inside the workspace starves the timer, or a slow external save emits after
  the window and causes visible double updates.
- **Dissent (if any):** none.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-6: One payload-free `documents-changed` event on the existing socket

- **Question:** What does the server send the browser?
- **Decision:** `HostEvent` gains the member `{ type: 'documents-changed' }`, with no other fields. The existing
  `/ws/events` socket carries it. On the wire it is exactly:
  ```json
  { "type": "documents-changed" }
  ```
- **Rationale:**
  - Watcher events are hints, so the browser re-checks the list and every open file anyway.
  - Paths would add payload size (a checkout can touch 20,000 paths) and a matching rule, and save nothing.
  - No consumer switches exhaustively on `HostEvent`, and the socket route is type-agnostic.
- **Evidence:** C-3, C-4, C-31.
- **Behavior impact:** Changing. A connected browser receives a new message type after any settled burst of non-hidden
  changes. Observer: any `/ws/events` client, including `scripts/check.ts`, which types events as `any`. Settled by the
  run per D-16.
- **Rejected alternatives:**
  - An event carrying changed paths — rejected for the reasons above.
  - A new SSE endpoint — rejected because it adds a second channel.
- **Revisit criterion:** a measured cost from re-reading every open file per event.
- **Dissent (if any):** none.
- **Settles delta entry:** S-3
- **Dependent decisions:** D-11
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-7: `replaceMarkdown` brings a document in line with disk text, outside undo

- **Question:** How does a disk change reach an open document without breaking undo, save, or a git revert?
- **Decision:**
  - `markdown-editor.tsx` takes the fork, update, and apply body of `mergeMarkdown` out into a private
    `applyMarkdown(live, base, markdown, origin?)`. `mergeMarkdown` keeps its signature and behavior.
  - `markdown-editor.tsx` exports:
    ```ts
    export function replaceMarkdown(live: Y.Doc, markdown: string): void {
      applyMarkdown(live, snapshot(live), markdown); // no origin: undo does not record it
      undoManagers.get(live)?.clear();
    }
    ```
- **Rationale:**
  - A base snapshot of the live document taken at merge time shares its history, so deletes apply and a revert
    reproduces (C-16).
  - A `null` origin fails the undo manager's tracked-origin test, so the change is not undoable. Undo then cannot
    reintroduce reverted text for the next Save to write back (C-15; verified at `yjs.mjs:3633` and
    `undo-plugin.js:69`).
  - Clearing the shown document's undo history stops Undo from re-inserting old items next to restored ones.
- **Evidence:** C-15, C-16; research V1, V6; software-architect A3.
- **Behavior impact:** Changing. After an open file updates from disk, Ctrl-Z in that file has nothing to undo.
  Observer: the writer. Settled by the run per D-16.
- **Rejected alternatives:**
  - An `origin` parameter on `mergeMarkdown` plus an exported `EXTERNAL_ORIGIN` — rejected because it exposes two
    concepts where one function does the job.
  - Keeping undo history — rejected because Undo after a revert could duplicate or bring back reverted text.
  - Replacing the `Y.Doc` — rejected because it rebuilds the editor at the top (C-18).
- **Revisit criterion:** writers ask to undo a disk change.
- **Dissent (if any):** none.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-9, D-13
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-8: `syncWithDisk` lives inside `useDocuments`, with a shared `forget` helper

- **Question:** Does disk reconciliation join the overloaded `useDocuments` hook or move out?
- **Decision:**
  - It joins the hook as `syncWithDisk`.
  - Per-file closing becomes a hook-local `forget(name)`. It drops the file from `opened`, clears `current` when that
    file is shown, and clears `highlights` when they belong to it.
  - `remove()` loops `forget` over the names `within` the deleted path.
  - No pure decision function is extracted.
- **Rationale:**
  - Every input the sync needs is private to the hook: `opened`, `show`/`currentRef`, `setHighlights`, `rerender`,
    `refreshList`, and the in-flight save.
  - Moving the sync out would expose the open-file registry for no gain.
  - The hook already has the same single-flight shape in `writeView`.
- **Evidence:** C-8, C-24; software-architect A1.
- **Behavior impact:** Preserving for `remove()`, which keeps its observable effects.
- **Rejected alternatives:**
  - A separate module or hook — rejected because it would need the private `opened` Map.
  - Extracting a pure `diskAction()` — rejected because it would have one caller.
- **Revisit criterion:** a second consumer of the open-file registry appears.
- **Dissent (if any):** none.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-9, D-11, D-14
- **Referenced in plan:** Target State, Change Units

### D-9: Per-file rules for a sync, and the `saved` invariant

- **Question:** What does one sync do to each open file?
- **Decision:** One run, in order:
  1. `const now = await refreshList()`. `before` is the list applied before this run.
  2. For each `[name, entry]` in `opened`:
     - **Not in `now`:** if `!entry.dirty` and `name` is in `before`, call `forget(name)`. Otherwise leave the file
       open. The derived "not on disk" notice covers it (D-13).
     - **In `now`:**
       1. Await `entry.saving` (ignoring its failure).
       2. GET `/api/documents/{name}`. On any failure, skip the file.
       3. If `opened.current.get(name) !== entry` or `entry.saving` is set, skip.
       4. If `text === entry.saved`, set `diskChanged = false`.
       5. Otherwise, if `!entry.dirty`, call `followDisk(entry, text)` inside a try/catch that logs.
       6. Otherwise set `entry.diskChanged = true`.
  3. Call `rerender()` once.

  `followDisk(entry, text)` sets `entry.saved = text`, calls `replaceMarkdown(entry.doc, text)`, then sets
  `entry.dirty = false` and `entry.diskChanged = false`, all in one tick.

  **Invariant:** `entry.saved` is the disk text the document was last brought in line with. It changes only on load,
  after a successful PUT, and in `followDisk`.

  No unsupported-markdown gate is added to the merge.
- **Rationale:**
  - Compare with `saved`, not with regenerated markdown (C-10).
  - `followDisk` resets `dirty` because the `update` listener sets it (C-9).
  - The identity re-check catches a save, move, or remove that starts during the GET. `move()` builds a new Map, so the
    identity check also catches a move (C-24; concurrency-analyst K4).
  - Unsupported text is handled by the existing gate on `saved`. `followDisk` sets `saved` to the disk text, so the file
    turns read-only and Save stays blocked, exactly as when such a file is first opened (C-17).
  - A clean file is closed only when it was on disk before. That way an open file that was never on disk, such as a new
    AI post, is never closed.
- **Evidence:** C-9, C-10, C-16, C-17, C-24, C-25, C-26; research V6; concurrency-analyst K4, K16; software-architect
  A1, A4.
- **Behavior impact:** Changing.
  - A clean open file now changes to match its disk text.
  - A clean open file deleted on disk now closes.
  - An unsaved file whose disk copy changed is flagged.

  Observer: the writer. Settled by the run per D-16.
- **Rejected alternatives:**
  - Merging into unsaved files too (research O10) — rejected because overlapping edits would interleave silently, and
    no prior art does that.
  - Prompting on every change (research O12) — rejected because of reported friction and lost text.
  - Comparing against `markdownOf(doc)` — rejected because files with non-canonical markdown would always look changed.
- **Revisit criterion:** writers ask for automatic merging into unsaved files.
- **Dissent (if any):** none.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-13, D-14
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-10: Save runs one at a time per file and records `saved` before its list reload

- **Question:** How does Save stop its own write from looking like an external change?
- **Decision:**
  - `Entry` gains `saving?: Promise<unknown>`.
  - `save(name)` chains after any running save of the same file, then re-checks `dirty` and the unsupported gate.
  - In order, it:
    1. reads `content`
    2. awaits the PUT
    3. sets `saved = content`, `saves++`, and `dirty = markdownOf(doc) !== content`
    4. sets `diskChanged = false`, then calls `rerender()`
    5. only then, `if (!listRef.current.some((e) => e.path === name)) await refreshList()`
  - `saving` is cleared when the chain ends.
  - On a failed PUT, nothing about the entry changes.
- **Rationale:**
  - The disk holds the new text before `saved` does today, and a list reload widens that gap (C-11).
  - Two overlapping saves leave `saved` matching whichever response resolved last (C-12).
  - The sync awaits `saving` and re-checks it, so it never compares during a save.
- **Evidence:** C-11, C-12; concurrency-analyst K1, K2, K3; software-architect A2.
- **Behavior impact:** Changing. A second Save pressed while the first is in flight waits and then saves again only if
  there are still unsaved changes. Today it starts a second PUT at once. Observer: the writer and the server. Settled by
  the run per D-16.
- **Rejected alternatives:**
  - Setting `saved` before the PUT — rejected because a failed PUT would leave `saved` wrong.
  - Ignoring watcher events for a time window after Save — rejected because a real external change in that window would
    be missed.
  - A server-side per-path write queue — rejected, see Deferred (YAGNI).
- **Revisit criterion:** two-tab saves of one file are reported as conflicting.
- **Dissent (if any):** none.
- **Settles delta entry:** S-7
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-11: Sync on the event, on every socket connect, and at the end of restore; the list is latest-wins

- **Question:** When does the browser sync, and how do overlapping list reloads resolve?
- **Decision:**
  - App's `useHostEvents` handler calls `docs.syncWithDisk()` when `event.type === 'documents-changed'`.
  - A new effect in App, `useEffect(() => { if (connected) docs.syncWithDisk(); }, [connected])`, syncs on every
    connect, the first included.
  - `restore()` calls `syncWithDisk()` as its last step.
  - `syncWithDisk` is coalesced. One run at a time, and a request during a run schedules exactly one more. It never
    rejects, and it logs failures.
  - `refreshList(): Promise<DocumentEntry[]>` takes a sequence number on each call. It applies the result to `entries`
    and `listRef` only when it is still the latest call, and always returns what it fetched.
- **Rationale:**
  - Events sent while the socket is down are lost (C-7).
  - Restore never checks stored drafts against disk (C-27).
  - An older list response can land last (C-22).
  - Overlapping syncs could merge an older read over a newer one (concurrency-analyst K16).
- **Evidence:** C-7, C-22, C-27; concurrency-analyst K8, K11, K14, K16; software-architect A1, A6.
- **Behavior impact:** Changing.
  - After a reconnect or a page reload, the Documents pane and open files catch up with disk.
  - A stale list response no longer overwrites a newer one.

  Observer: the writer. Settled by the run per D-16.
- **Rejected alternatives:**
  - Sync only on the event — rejected because changes during a disconnect or while the page was closed would be missed.
  - A server-side sequence number with replay — rejected because a full re-check on connect is simpler and covers the
    same gap.
- **Revisit criterion:** a sync on connect proves too slow with many open files.
- **Dissent (if any):** none.
- **Settles delta entry:** S-6, S-10, S-12
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-12: Rely on the editor library to keep the scroll position

- **Question:** What keeps the writer's scroll position when the open file updates from disk?
- **Decision:**
  - No scroll code is added.
  - The update is applied in place to the same `Y.Doc` (D-7), so the `EditorView` is not rebuilt.
  - prosemirror-view's `updateState` uses "preserve" scroll for a change that does not touch plugins. It defers to the
    browser's scroll anchoring where `overflow-anchor` exists, and otherwise stores and restores the first visible
    element itself (`prosemirror-view/dist/index.js:5574-5579`).
  - y-prosemirror asks to scroll only when the editor has focus and the cursor is on screen.
  - The scroll requirement is verified by a unit test that unchanged paragraphs keep their DOM nodes, and by a manual
    check in Safari and Chrome (Unit 7).
- **Rationale:** The library already does the work. A second copy would fight it.
- **Evidence:** C-18, C-19, C-20; orchestrator read of `prosemirror-view/dist/index.js:5574-5579`; software-architect
  sketch review item 1.
- **Behavior impact:** Preserving. The scroll position is kept, which is what the operator asked for.
- **Rejected alternatives:** capturing a visible-block anchor around each external transaction — rejected and deferred,
  see Deferred (YAGNI).
- **Revisit criterion:** the Unit 7 manual check shows a jump in either browser or in raw mode.
- **Dissent (if any):** none.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Change Units, Deferred (YAGNI)

### D-13: One stored disk flag, one derived flag, two notices, and a way to take the disk version

- **Question:** How does the writer learn that an open unsaved file changed or vanished on disk, and what can they do?
- **Decision:**
  - `Entry` gains `diskChanged?: boolean`. Save, `followDisk`, and a sync that finds disk equal to `saved` clear it.
  - `useDocuments` returns:
    - `diskChanged: boolean` — the current file's flag.
    - `onDisk: boolean` — `true` until the first list lands, then whether `listRef.current` holds the current file.
    - `takeDiskVersion(): Promise<void>` — awaits `saving`, GETs the text, re-checks identity as in D-9, then calls
      `followDisk`.
  - `Editor` shows, in the existing `.notice` style:
    - when `!docs.onDisk`: "`{name}` is not on disk. Save creates it."
    - when `docs.diskChanged`: "`{name}` changed on disk. Save overwrites it." with a button labeled "Use the disk
      version", which calls `docs.takeDiskVersion()`.
  - Nothing new is persisted. The sync at the end of restore works the flags out again.
- **Rationale:**
  - The operator named both scenarios.
  - Working out "not on disk" from the list covers three cases with no new state: a deleted unsaved file, a restored
    draft whose file was deleted while the page was closed, and an external rename.
  - Without `takeDiskVersion`, an unsaved file has no way to reach a reverted version.
- **Evidence:** C-23, C-27, C-28, C-29; software-architect A4; research V11.
- **Behavior impact:** Changing.
  - Two new notices can appear above the editor.
  - The "not on disk" notice also shows for an AI-created post that was never saved. The tree already marks those as
    not on disk, and the wording is true for them.
  - "Use the disk version" discards unsaved edits in that file.

  Observer: the writer. Settled by the run per D-16.
- **Rejected alternatives:**
  - A stored `disk: 'changed' | 'deleted'` field — rejected because the deleted half duplicates what the list already
    says.
  - Persisting the flags in view state — rejected because restore recomputes them.
  - No discard action — rejected because the operator's revert scenario would be unreachable for an unsaved file.
- **Revisit criterion:** the operator wants different wording for "deleted" and "never saved".
- **Dissent (if any):** none.
- **Settles delta entry:** S-9, S-11
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-14: Deleted on disk — clean files close, unsaved files stay, and Save recreates

- **Question:** What happens to an open file when it, or its folder, is deleted on disk?
- **Decision:**
  - A file with no unsaved changes, listed before the sync and missing after it, closes through `forget`, as an in-app
    delete does.
  - A file with unsaved changes stays open with the "not on disk" notice. Save writes it back, recreating any missing
    parent folders.
  - A folder delete needs no rule of its own, because each open file under it is checked against the list.
- **Rationale:**
  - This mirrors the in-app delete (C-24) for clean files, and VS Code's behavior for unsaved ones (research A41).
  - `resolveInWorkspace` and `Bun.write` already let Save recreate missing folders (C-13).
- **Evidence:** C-13, C-23, C-24; research A41.
- **Behavior impact:** Changing.
  - When git or another app deletes the open file and it had no unsaved changes, the editor closes it.
  - With unsaved changes, it stays and says it is not on disk.

  Observer: the writer. Settled by the run per D-16.
- **Rejected alternatives:**
  - Always keeping deleted files open — rejected because a clean file has nothing to lose, and the operator asked for
    the pane and editor to follow disk.
  - Always closing — rejected because it discards unsaved work.
- **Revisit criterion:** writers lose work they expected to keep, or want clean deleted files kept open.
- **Dissent (if any):** none.
- **Settles delta entry:** S-8
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Behavior Changes

### D-15: An external rename of an unsaved file is treated as a delete plus a new file

- **Question:** What happens when another app renames a file that has unsaved changes in 3pitor?
- **Decision:**
  - No rename detection.
  - The unsaved file stays open under its old name with the "not on disk" notice, and the new name appears in the tree
    as a separate file.
  - Save writes the unsaved text to the old name.
- **Rationale:** The watcher reports renames as unrelated events (C-31), and a content-match heuristic has no evidence
  behind it.
- **Evidence:** C-31; research V11.
- **Behavior impact:** Changing, as a consequence of D-13 and D-14. Settled by the run per D-16.
- **Rejected alternatives:** matching an unsaved file to a new file with the same saved text — rejected as unproven
  guesswork.
- **Revisit criterion:** a writer reports a resurrected file after an external rename.
- **Dissent (if any):** none.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Open Items

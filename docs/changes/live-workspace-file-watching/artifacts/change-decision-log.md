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
  - A logged error may end watching until the server restarts. A deleted or renamed workspace root produces no event
    and no error at all, as the on-call review measured, so that case is silent. Both are accepted for now; see Risks.
- **Evidence:** C-3, C-5, C-6; software-architect A5; review findings JD-008, OCE-7.
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

### D-5: Settle bursts with a 100 ms trailing timer, capped at 1 s

- **Question:** How long does the watcher wait before announcing a change?
- **Decision:** Two literal timers.
  - A 100 ms trailing timer, restarted by each kept event.
  - A 1 s cap, started by the first kept event after a fire.
  - `onSettled` runs once when either timer fires first, and the fire clears both.
- **Rationale:**
  - A folder delete arrives as one event per entry (C-31: 551 events), and settling turns that into one reload.
  - 100 ms is above the gap between events in a burst.
  - Without a cap, any non-hidden file written more often than every 100 ms (a log, a bundler's output, an install)
    would keep the timer from ever firing. The pane would then freeze silently (on-call review OCE-6). The cap bounds
    that to one sync a second, which the browser's coalescing absorbs.
- **Evidence:** C-31; research "watcher events are hints" (A18, A22, A24); on-call review OCE-6.
- **Behavior impact:** Changing. During continuous churn, the browser re-checks disk at most about once a second
  instead of never. Settled by the run per D-16.
- **Rejected alternatives:**
  - No settle — rejected because 551 events would mean 551 reloads.
  - No cap — rejected for OCE-6.
  - Configurable delays — rejected because no caller would set them.
- **Revisit criterion:** a measured reload cost during long-running churn, or a slow external save that emits after the
  window and causes visible double updates.
- **Dissent (if any):** none. The run's first draft had no cap, and the on-call review changed it.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Behavior Changes

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
      applyMarkdown(live, snapshot(live), markdown); // origin omitted: Yjs records it as null, which undo does not track
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
- **Decision:** One run, in order. Each numbered rule is an else-if of the one before it.
  1. `before = listRef.current`, then `now = await refreshList()`.
  2. For each `[name, entry]` in `opened`:
     - **Not in `now`:**
       1. Set `entry.diskChanged = false`.
       2. If `!entry.dirty` and `name` is in `before`, GET `/api/documents/{name}`.
       3. Only when that GET fails with `status === 404` (D-19), and `opened.current.get(name) === entry`, call
          `forget(name)`.
       4. In every other case the file stays open, and the derived "not on disk" notice covers it (D-13).
     - **In `now`:**
       1. GET `/api/documents/{name}`. On any failure, skip the file.
       2. If `opened.current.get(name) !== entry` or `entry.saving` is set, skip the file.
       3. If `text === entry.saved`, set `entry.diskChanged = false`.
       4. Else, if `!entry.dirty`, call `followDisk(entry, text)` inside a try/catch that logs.
       5. Else, set `entry.diskChanged = true`.
  3. Call `rerender()` once.

  A sync never awaits a running save. It skips a file whose save is in flight, and the save's own write sets off a
  later sync.

  `followDisk(entry, text)` calls `replaceMarkdown(entry.doc, text)` first, and only then sets `entry.saved = text`,
  `entry.dirty = false`, and `entry.diskChanged = false`. If `replaceMarkdown` throws, nothing on the entry changes, so
  every later sync retries and logs.

  **Invariant:** `entry.saved` is the disk text the document was last brought in line with. It changes only on load,
  after a successful PUT, and after a successful `replaceMarkdown` in `followDisk`.

  No unsupported-markdown gate is added to the merge.
- **Rationale:**
  - Compare with `saved`, not with regenerated markdown (C-10).
  - `followDisk` resets `dirty` because the `update` listener sets it (C-9).
  - The identity re-check catches a save, move, or remove that starts during the GET (C-24; concurrency-analyst K4).
  - Recording `saved` after a successful apply stops a failed apply from looking like success. Otherwise a later Save
    would write stale text over a revert (on-call review OCE-4).
  - Confirming a missing file with a 404 before closing it stops a list taken mid-burst from closing a file that is
    absent only briefly (junior-developer JD-003; on-call OCE-5).
  - A clean file is closed only when it was on disk before. That way an open file that was never on disk, such as a new
    AI post, is never closed.
  - Not awaiting a running save keeps one hung PUT from freezing every sync, because `api()` has no timeout (on-call
    OCE-2).
  - Clearing `diskChanged` on a missing file stops both notices from showing at once (junior-developer JD-004).
  - Unsupported text is handled by the existing gate on `saved`. `followDisk` sets `saved` to the disk text, so the file
    turns read-only and Save stays blocked, exactly as when such a file is first opened (C-17).
- **Evidence:** C-9, C-10, C-16, C-17, C-24, C-25, C-26; research V6; concurrency-analyst K4, K16; software-architect
  A1, A4; review findings JD-003, JD-004, OCE-2, OCE-4, OCE-5.
- **Behavior impact:** Changing.
  - A clean open file now changes to match its disk text.
  - A clean open file confirmed deleted on disk now closes.
  - An unsaved file whose disk copy changed is flagged.

  Observer: the writer. Settled by the run per D-16.
- **Rejected alternatives:**
  - Merging into unsaved files too (research O10) — rejected because overlapping edits would interleave silently.
  - Prompting on every change (research O12) — rejected because of reported friction and lost text.
  - Comparing against `markdownOf(doc)` — rejected because files with non-canonical markdown would always look changed.
  - Closing on list absence alone — rejected for JD-003 and OCE-5.
  - Awaiting the running save before the GET — rejected for OCE-2.
- **Revisit criterion:** writers ask for automatic merging into unsaved files, or a test shows a sync missing an
  external change that raced a save.
- **Dissent (if any):** none.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-13, D-14
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-10: Save runs at most once at a time per file and records `saved` before its list reload

- **Question:** How does Save stop its own write from looking like an external change, and stay safe when it fails?
- **Decision:** `Entry` gains `saving?: Promise<void>`. `save(name)` is:
  ```ts
  if (entry.saving) return entry.saving;               // a Save during a running save joins it
  if (!entry.dirty || unsupportedMarkdown(entry.saved).length) return;
  const run = (async () => {
    const content = markdownOf(entry.doc);
    await api('PUT', `/api/documents/${encodeURIComponent(name)}`, { content });
    entry.saved = content; entry.saves++;
    entry.dirty = markdownOf(entry.doc) !== content; entry.diskChanged = false;
    rerender();
    if (!listRef.current.some((e) => e.path === name)) await refreshList();
  })();
  entry.saving = run;
  const clear = () => { if (entry.saving === run) entry.saving = undefined; };
  run.then(clear, clear);
  return run;                                          // a failed PUT still rejects to the caller, as today
  ```
- **Rationale:**
  - The disk holds the new text before `saved` does today, and a list reload widens that gap (C-11).
  - Two overlapping saves leave `saved` matching whichever response resolved last (C-12).
  - Joining a running save, rather than chaining after it, is the simpler version the review asked for
    (junior-developer JD-007).
  - Clearing `saving` on both settle paths stops one failed PUT from wedging every later Save and sync of that file
    (on-call OCE-1).
- **Evidence:** C-11, C-12; concurrency-analyst K1, K2, K3; software-architect A2; review findings JD-007, OCE-1.
- **Behavior impact:** Changing. A second Save pressed while the first is in flight no longer sends a second PUT. Text
  typed after the first save read the document stays unsaved, and the file still shows as unsaved, until the next Save.
  Observer: the writer and the server. Settled by the run per D-16.
- **Rejected alternatives:**
  - Chaining a second save after the first — rejected as more machinery than the race needs (JD-007).
  - Setting `saved` before the PUT — rejected because a failed PUT would leave `saved` wrong.
  - Ignoring watcher events for a time window after Save — rejected because a real external change in that window would
    be missed.
  - A server-side per-path write queue — rejected, see Deferred (YAGNI).
- **Revisit criterion:** a false "changed on disk" notice after a double Save is reported, or two-tab saves of one file
  conflict.
- **Dissent (if any):** none.
- **Settles delta entry:** S-7
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-11: Sync on the event, on every socket connect, and at the end of restore; the list is latest-wins

- **Question:** When does the browser sync, how do overlapping syncs and list reloads resolve, and what can never stick?
- **Decision:**
  - App's `useHostEvents` handler calls `docs.syncWithDisk()` when `event.type === 'documents-changed'`.
  - A new App effect, `useEffect(() => { if (connected) docs.syncWithDisk(); }, [connected])`, syncs on every connect,
    the first included.
  - `restore()` calls `syncWithDisk()` as its last step.
  - `syncWithDisk` is coalesced through a ref, and never rejects:
    ```ts
    const sync = useRef<{ running?: Promise<void>; queued?: Promise<void> }>({});
    const syncWithDisk = (): Promise<void> => {
      const s = sync.current;
      if (!s.running) {
        s.running = syncOnce().finally(() => { s.running = undefined; });
        return s.running;
      }
      s.queued ??= s.running.then(() => { s.queued = undefined; return syncWithDisk(); });
      return s.queued;
    };
    // syncOnce() wraps the whole D-9 run in try { … } catch (e) { console.error(…) }, so it never rejects.
    ```
    A call resolves when a run that started at or after the call has finished. Any number of calls during a run share
    one queued run.
  - `refreshList(): Promise<DocumentEntry[]>` increments a sequence ref on each call. It applies its result to `entries`
    and `listRef` only when its number is still the latest, and always returns what it fetched.
- **Rationale:**
  - Events sent while the socket is down are lost (C-7).
  - Restore never checks stored drafts against disk (C-27).
  - An older list response can land last (C-22).
  - Overlapping syncs could merge an older read over a newer one (concurrency-analyst K16).
  - Flags in a ref, and a body that cannot throw, stop a failed list request from leaving the sync stuck forever
    (on-call OCE-3). Pinning which run a caller waits for settles junior-developer JD-006.
- **Evidence:** C-7, C-22, C-27; concurrency-analyst K8, K11, K14, K16; software-architect A1, A6; review findings
  OCE-3, JD-006.
- **Behavior impact:** Changing.
  - After a reconnect or a page reload, the Documents pane and open files catch up with disk.
  - A stale list response no longer overwrites a newer one.
  - The existing test that a fresh workspace makes exactly one `GET /api/documents` now sees two: mount, then the sync
    at the end of restore. That test's expectation changes.

  Observer: the writer, and the documents test suite. Settled by the run per D-16.
- **Rejected alternatives:**
  - Sync only on the event — rejected because changes during a disconnect or while the page was closed would be missed.
  - A server-side sequence number with replay — rejected because a full re-check on connect is simpler and covers the
    same gap.
- **Revisit criterion:** a sync on connect proves too slow with many open files.
- **Dissent (if any):** none.
- **Settles delta entry:** S-6, S-10, S-12
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes, Change Units

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

### D-13: One stored disk flag, one derived flag, one notice at a time, and a way to take the disk version

- **Question:** How does the writer learn that an open unsaved file changed or vanished on disk, and what can they do?
- **Decision:**
  - `Entry` gains `diskChanged?: boolean`. Save, `followDisk`, a sync that finds disk equal to `saved`, and a sync that
    finds the file missing all clear it.
  - `useDocuments` returns:
    - `diskChanged: boolean` — the current file's flag.
    - `onDisk: boolean` — `true` until the first list lands, then whether `listRef.current` holds the current file.
    - `takeDiskVersion(): Promise<void>` — GETs the text, re-checks that the entry is still the one open, then calls
      `followDisk`. A failed GET rejects with the error.
  - `Editor` shows at most one of these, in the existing `.notice` style, for the current file:
    - when `!docs.onDisk`: `{name} is not on disk. Save creates it.`
    - otherwise, when `docs.diskChanged`: `{name} changed on disk. Save overwrites it.` with a button labeled
      `Use the disk version` that calls `docs.takeDiskVersion()`.
  - When `takeDiskVersion()` rejects, the `Editor` shows `Could not load the disk version of {name}: {message}` in the
    style it uses for save failures.
  - Nothing new is persisted. The sync at the end of restore works the flags out again.
- **Rationale:**
  - The operator named both scenarios.
  - Working out "not on disk" from the list covers a deleted unsaved file, a restored draft whose file was deleted while
    the page was closed, and an external rename, with no new state.
  - Without `takeDiskVersion`, an unsaved file has no way to reach a reverted version.
  - One notice at a time, and a pinned failure message, settle junior-developer JD-004.
- **Evidence:** C-23, C-27, C-28, C-29; software-architect A4; research V11; review finding JD-004.
- **Behavior impact:** Changing.
  - New notices can appear above the editor.
  - The "not on disk" notice also shows for an AI-created post that was never saved. The tree already marks those as
    not on disk, and the wording is true for them.
  - "Use the disk version" discards unsaved edits in that file, with no confirmation.

  Observer: the writer. Settled by the run per D-16.
- **Rejected alternatives:**
  - A stored `disk: 'changed' | 'deleted'` field — rejected because the deleted half duplicates what the list says.
  - Persisting the flags — rejected because restore recomputes them.
  - No discard action — rejected because the revert scenario would be unreachable for an unsaved file.
  - A confirmation dialog on "Use the disk version" — rejected because the button's label states what it does, and no
    other notice action in the app confirms.
- **Revisit criterion:** the operator wants different wording for "deleted" and "never saved", or a writer discards
  work by accident.
- **Dissent (if any):** none.
- **Settles delta entry:** S-9, S-11
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta, Behavior Changes

### D-14: Deleted on disk — confirmed clean files close, unsaved files stay, and Save recreates

- **Question:** What happens to an open file when it, or its folder, is deleted on disk?
- **Decision:**
  - A file with no unsaved changes that was listed before the sync, is missing after it, and whose read answers 404,
    closes through `forget`, as an in-app delete does (D-9).
  - A file with unsaved changes stays open with the "not on disk" notice. Save writes it back, recreating any missing
    parent folders.
  - A folder delete needs no rule of its own, because each open file under it is checked.
  - `forget` drops the file from `opened`, clears `current` when it is shown, and clears `highlights` when they belong to
    it. Like `remove()` today, it leaves `turnBases` alone.
- **Rationale:**
  - This mirrors the in-app delete (C-24) for clean files, and VS Code's behavior for unsaved ones (research A41).
  - `resolveInWorkspace` and `Bun.write` already let Save recreate missing folders (C-13).
  - The 404 check keeps a briefly missing file open (D-9).
- **Evidence:** C-13, C-23, C-24, C-26; research A41; review findings JD-003, OCE-5.
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

### D-18: "Keep my scroll position" means the passage at the top of the view stays put, in both modes

- **Question:** What exactly must hold for the scroll requirement, and how is it checked in rendered and raw mode?
- **Decision:**
  - The requirement is met when, after a disk update, the passage that was at the top of the editor's view is still at
    the top. Text changed above it may move the scroll offset.
  - In rendered mode, the editor library's own scroll preservation provides it (D-12).
  - In raw mode, the scroller keeps its pixel offset because nothing is rebuilt. A change above the view can shift the
    text by the changed height, and the deferred anchor work would cover that.
  - Unit 4 checks the precondition both modes rely on: the `.ProseMirror` element and unchanged paragraphs keep their
    identity. Unit 7 checks the requirement itself in Safari and Chrome, in both modes.
- **Rationale:** The operator's words ("without losing my scroll location spot") describe what they see, not a pixel
  value. Holding the passage in place is what editors with this feature do (research). Raw mode had no stated mechanism
  (junior-developer JD-001).
- **Evidence:** C-18, C-19, C-20; D-12; review finding JD-001.
- **Behavior impact:** Preserving. It defines the requirement; it adds no code.
- **Rejected alternatives:** building anchor code for raw mode now — rejected under YAGNI until Unit 7 shows a jump.
- **Revisit criterion:** Unit 7 shows the top passage moving in either mode.
- **Dissent (if any):** none.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Change Units, Deferred (YAGNI)

### D-19: A failed request's `Error` carries the HTTP status

- **Question:** How does the sync tell "file not found" apart from other read failures?
- **Decision:** `api()` in `src/ui/components/api.ts` throws
  `Object.assign(new Error(message), { status: res.status })` for a response that is not OK. The message is unchanged.
  Callers that only read `message` see no difference.
- **Rationale:** D-9 closes a file only on a 404. Today the status is lost in the thrown `Error` (C-26).
- **Evidence:** C-26; review finding OCE-5.
- **Behavior impact:** Preserving for every existing caller. The message and the throw are unchanged.
- **Rejected alternatives:**
  - Matching on the error message text — rejected as brittle.
  - A new endpoint that answers "exists?" — rejected as more surface for the same fact.
- **Revisit criterion:** —
- **Dissent (if any):** none.
- **Settles delta entry:** S-13
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

## Decisions made while building

### D-20: Test the `server.ts` wiring end to end after all

- **Question:** The plan deferred a test for the watcher wiring because `server.ts` cannot be imported without starting
  the server. Does that still hold?
- **Decision:** No. `server.test.ts` already spawns the server from source. A new test there starts it on a temp
  workspace, opens `/ws/events`, writes a file, and expects exactly `{"type":"documents-changed"}`.
- **Rationale:** The wiring is the one line that connects the watcher to every tab. A test that spawns the server
  covers it without a factory.
- **Evidence:** the test went red (timed out with no message) before the wiring and green after it.
- **Behavior impact:** none; a test only.
- **Settles delta entry:** S-4

### D-21: Watcher tests let the start-up replay settle first

- **Question:** Why did "a write under `.3pitor/`, then a visible write, calls it exactly once" see two calls?
- **Decision:** The test helper waits 300 ms after starting the watcher and resets its count before the scenario.
- **Rationale:** On macOS, Bun's recursive watcher replays changes made just before it started, such as the test's own
  `notes.md`. A logged run showed `notes.md`, `.3pitor`, and `.3pitor/view.json` all arriving at the watch's start.
  The watcher's behavior is right; the test was counting set-up writes.
- **Behavior impact:** none. The app may see one extra `documents-changed` right after the server starts, which costs
  one sync.

### D-22: The watcher's `error` listener has no automated test

- **Question:** How is `watcher.on('error', …)` from D-4 tested?
- **Decision:** It is not. Nothing triggers a watcher error on demand, and deleting the workspace root produces no
  error (D-4). The listener only logs.
- **Revisit criterion:** a watcher error is seen in the built app.

### D-23: The editor's private `replaceMarkdown(view, …)` becomes `replaceInView`

- **Question:** `markdown-editor.tsx` already had a module-private `replaceMarkdown(view, markdown)` that raw mode uses
  to apply its text to the editor view. The plan's new export has the same name.
- **Decision:** Rename the private one to `replaceInView`. The exported `replaceMarkdown(live, markdown)` keeps the
  plan's name and contract.
- **Behavior impact:** none; a private rename.
- **Settles delta entry:** S-5

### D-24: A sync drops a read that a save overtook

- **Question:** The plan's sync skips a file only when `entry.saving` is set after its read. What if the save started
  and finished while the read was in flight?
- **Decision:** `syncFile` records `entry.saves` before the read, and drops the read if `saves` changed, as well as on
  the plan's identity and `saving` checks.
- **Rationale:** A read answered before a save, and delivered after that save finished, holds the pre-save text. The
  file is clean by then, so the plan's rules would roll it back to the pre-save text. A test reproduced it
  (`a read from before a save does not undo that save when it lands after it`).
- **Behavior impact:** Preserving: a save is never undone by a stale read. The next event re-reads the file.
- **Settles delta entry:** S-8

### D-25: The `before` check in the delete branch has no test of its own

- **Question:** How is "a clean file is closed only if it was listed before the sync" tested?
- **Decision:** It is kept as pinned, with no discriminating test. Every file that was never on disk is an AI post,
  and those are always unsaved, so the `dirty` check already keeps them open. The plan's "AI-created post stays open"
  test passes with or without the `before` check.
- **Revisit criterion:** a way to open a clean file that was never in the list appears.

### D-26: Two existing request-count expectations change

- **Decision:** The fresh-workspace test now expects two list requests (D-11). The reload test now expects the two list
  requests and a read of the restored draft, because the sync after restoring checks the draft against the disk (S-12).
- **Behavior impact:** Changing, as the plan states for S-12.

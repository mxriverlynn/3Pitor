# Research: Live Updates When Workspace Files Change on Disk

How should 3pitor watch the loaded workspace, which can hold tens of thousands of files and folders, so the Documents
pane and the open editor update by themselves? The motivating cases are a git revert of the open file, another app
editing the open file, and a whole folder being deleted. The editor must keep its scroll position through each of
them.

Evidence mode: strict. Every claim that bears on the recommendation is backed by the codebase, by a local experiment,
or by two independent sources, or else it is marked as resting on a single source.

## Summary

3pitor can do this with the tools it already has. Bun's built-in recursive file watcher is fast enough and caught
every change in a local test on a workspace of 22,000 files and folders. When something changes, the server waits for
the burst to settle, then tells the browser over the event connection it already has. The browser then reloads the
document list, which takes about 65 milliseconds at that size.

For the open file, the editor already has a merge step that it uses for AI edits. That step can fold the new disk text
into the document in place. Because the editor is not rebuilt, the scroll position stays put. When you have unsaved
changes, the safer default is to keep your text and show that the file changed on disk.

The merge needs four corrections before it is safe to reuse. Two of them would otherwise undo a git revert, either
silently or the next time you press Undo and Save.

How solid it is: the core plan rests on the codebase and on a local test in this project's own setup. Some of the
editor behavior is reasoned from library code that has not been run, and still needs a test.

- **Confidence:** Medium
- **Web search:** used

## Research Results

### What 3pitor does today

3pitor has no file watching today. Nothing in the server watches the workspace. The Documents pane is rebuilt by
walking the entire workspace on every request (A1), and the browser asks for it again only after it creates, moves, or
deletes something itself (A7, A10). Changes made by git or another app never reach the browser.

The server already has a live connection to the browser. A WebSocket at `/ws/events` sends every server event to each
open browser tab (A2), but today it carries only AI task events. If the connection drops, the browser reconnects after
one second without a replay, so anything sent during the gap is lost (A44).

The open document lives only in the browser. Each open file keeps three things:

- its Yjs document, the shared-editing data structure behind the editor
- the text as last saved
- a snapshot taken when the file was first opened, called the load base

Saving is manual, and it does not update that load base (A3). The editor has a three-way merge that applies new
markdown text to the live document without losing typing made since a base snapshot. It is used today for AI edits
(A4). Scroll position is never saved, and the editor view is rebuilt whenever its document object is swapped (A6).

### Watching tens of thousands of files

Watching the whole tree at once is the only approach with evidence at this scale. Per-file watching gets slow and runs
out of system resources (A13, A14, A17). On macOS, one FSEvents stream covers a whole tree (A20). FSEvents is the
operating system's change-notification service. On Linux, inotify, the kernel's equivalent, needs one watch per folder
and has a default limit that can be as low as 8,192 watches (A21).

Bun's built-in recursive watcher passed a local test in this project's exact setup (A43). The test used Bun 1.4.2 on
this Mac, which is the runtime the project ships on (A9), and a workspace of 2,040 folders and 20,000 files. The watcher
started in 3 milliseconds and reported 500 of 500 rapid file creations. A web benchmark found the same speed and
completeness [single-source] (A14).

A reported Bun 1.4.2 bug did not reproduce. The bug report says opening or closing any other watcher drops events
[single-source] (A12). In the local test, a second watcher opened and closed ten times while 20 files were written, and
all 20 were reported (A43). The bug may need conditions this test did not hit, so the app should still open exactly one
watcher and never churn it. Bun's watcher also has open issues with symlinks and very deep trees [single-source] (A15,
A16).

`@parcel/watcher`, a native watching library, is the main alternative. VS Code uses it (A26), and it was fast under Bun
[single-source] (A13, A18). It ships as separate compiled binaries for each platform, and a missing Intel Mac binary
has broken installs under Bun before [single-source] (A19). Nothing confirms it can run inside the single compiled
executable 3pitor ships as (A9).

### Watcher events are hints

Treat watcher events as hints that a path changed, not as facts about what happened. Every watcher merges and reorders
events (A18, A20, A27). Event names are unreliable: in the local test, deletes and an atomic save all arrived as
"rename" (A43, A25). An atomic save is the common editor pattern of writing a temporary file and then renaming it over
the original. When the system drops events under load, the fix is a full rescan (A20, A21).

So the dependable pattern has three steps (A18, A24):

1. Collect the changed paths.
2. Wait for a short quiet period.
3. Check what is on disk.

Watchman, Facebook's file-watching service, does the same thing with a 20-millisecond "settle" period and by holding
events during version-control operations [single-source] (A22).

Deleting a folder produces one event for every file and folder inside it. In the local test, deleting a folder with 50
subfolders and 500 files produced 551 events (A43). Settling the burst before acting turns that into one update.

### Getting changes to the browser

Reusing the existing event WebSocket is the simplest transport (A2). Adding a new event type works without new
infrastructure. Server-Sent Events, a one-way streaming alternative, would also work (A28, A29), but it would add a second
channel the app does not need.

### Keeping the tree up to date

A full reload of the document list is cheap enough at this size. In the local test, walking 22,040 entries the way the
server does took about 65 milliseconds, and the JSON response was about 870 KB (A43). One full reload after each settled
burst is therefore a workable first version. The browser should also reload whenever the event connection reconnects,
because events sent while it was down are lost (A44).

### Folding disk changes into the open document

Other editors reload an unchanged buffer by applying a diff, not by replacing it, so cursor positions survive. They
flag a buffer with unsaved changes instead of overwriting it (A30). Logseq's "pick a version" prompt drew user
complaints of friction and lost text (A35). Replacing a Yjs document wholesale is discouraged [single-source] (A31), and
in 3pitor it would rebuild the editor and lose scroll (A6).

3pitor's existing merge can apply a git revert, deletions included. Its diffing step turns removed text and removed
blocks into deletes (A5, A4). Those deletes reach the live document only when the merge base shares history with that
document. The load base fails that test after a save (A3). For example, suppose you type X and save, and then a revert
removes X. The disk text then equals the load base, so merging against the load base changes nothing, and X stays.

The merge needs four corrections before external changes can reuse it (A3, A4):

1. **Use the right base.** For a document with no unsaved changes, use a snapshot of the live document taken at merge
   time. For a document with unsaved changes, use a snapshot taken at the moment Save read the content.
2. **Keep the saved state honest.** Any change to the document marks it unsaved, so the merge would show the document
   as unsaved even though it now matches the disk. After the merge, set the saved text to the disk text and recompute
   the unsaved flag.
3. **Keep the revert out of Undo.** The merge uses the AI's change label, which the editor's undo history tracks. Undo
   would then restore the reverted text, and the next Save would write it back over the revert. External changes need
   their own label that undo ignores.
4. **Skip files the editor cannot represent.** Save already refuses markdown the editor cannot represent. The same check
   should gate the merge, or parsing would drop content.

Detecting that a file changed must compare the disk text with the saved text, not with text regenerated from the
editor. The editor rewrites some markdown, such as bullet styles, so regenerated text would make every such file look
changed.

### Scroll position

Updating the open document in place should keep the scroll position. The editor binding rebuilds only the parts of the
document that changed. It reuses the rest and restores the selection (A5, A33, A39). It scrolls only when the editor has
focus and the cursor is on screen (A5). That is usually not the case when git or another app changes the file.

Two things are still unverified:

- whether the unchanged parts stay mounted on the page through the update
- whether text changing above the viewport shifts the view

Saving a visible anchor and the scroll offset before the update, and restoring them after, is a cheap safeguard. A
reported scroll-jump issue with remote edits [single-source, title only] (A38) and the browser's own scroll anchoring
(A40) support that.

### Deleted and renamed files

A deleted file with no unsaved changes can close the way an in-app delete does today. The existing delete handling
already drops every open file under a deleted folder (A7). VS Code keeps a deleted file's unsaved buffer open, marks it
deleted, and recreates the file on save (A41).

3pitor has no "deleted on disk" state yet, so one would need to be added and persisted across reloads (A3, A6). An
external rename arrives as a delete and a create (A18, A43). If the open file has unsaved changes, saving would then
recreate it at the old path.

### The app's own writes

The app's own writes are easy to filter. Server notes live in `.3pitor/` and git writes into `.git/` (A8). Both are hidden
folders the tree already skips (A1). A Save comes back as a change event, but its disk text equals the saved text the
browser recorded (A3). Small editor projects use the same content-comparison approach (A24).

One gap remains. The browser records the saved text only after the save request returns, so a change event that lands
in between would look like an external edit (A3).

## Options to Consider

The question splits into three choices: which watcher, how the tree updates, and what happens to the open document.

### Which watcher

#### O1: Bun's built-in recursive watcher

- **What it is:** Bun's `fs.watch` with `recursive: true`, opened once for the workspace root, with filtering done in
  the app.
- **Trade-offs:** It adds no dependency and fits the single compiled executable. It was fast and complete in the local
  test. It has open upstream issues with symlinks, deep trees, and watcher churn, and it does not report when the system
  dropped events, so the app needs its own rescan.
- **Rests on:** (A43), (A14), (A12), (A15), (A16), (A20)
- **Evidence status:** corroborated. A local test in the project's own setup (A43) agrees with a web benchmark (A14).

#### O2: `@parcel/watcher`

- **What it is:** A native library that wraps each operating system's watcher. It filters at the watcher level, and it
  can report what changed while the app was closed.
- **Trade-offs:** It is mature, and VS Code uses it. It needs a compiled binary per platform. Whether that binary works
  inside a `bun build --compile` executable is unknown.
- **Rests on:** (A18), (A26), (A13), (A19), (A9)
- **Evidence status:** single-source (caveated) for its speed under Bun. The packaging question is unverified.

#### O3: chokidar

- **What it is:** The most widely used Node watching library.
- **Trade-offs:** It has the most familiar API. It creates far more watches than recursive watching, and it was very
  slow to start on Bun on macOS.
- **Rests on:** (A13), (A14), (A17)
- **Evidence status:** corroborated.

#### O4: Watchman

- **What it is:** A separate background service that handles bursts and version-control operations well.
- **Trade-offs:** It needs its own install, which is hard to ship inside a Homebrew-distributed single executable.
- **Rests on:** (A22)
- **Evidence status:** single-source (caveated).

### How the tree updates

#### O5: Settled "tree changed" event, then a full reload

- **What it is:** After a burst settles, the server sends one event. The browser reloads the whole document list, as
  it already does after its own changes. It also reloads after reconnecting.
- **Trade-offs:** It is the smallest change and is always correct. Each reload costs about 65 milliseconds of server
  work and about 870 KB for 22,000 entries.
- **Rests on:** (A43), (A1), (A2), (A44), (A7)
- **Evidence status:** corroborated by codebase and local measurement.

#### O6: Server-side cached tree, cleared by the watcher

- **What it is:** Same as O5, but the server keeps the list in memory and rebuilds it only when the watcher says
  something changed.
- **Trade-offs:** It saves the server walk on repeat requests, but not the transfer.
- **Rests on:** (A1), (A43)
- **Evidence status:** corroborated for the cost it would save.

#### O7: Server-side index with change diffs and versions

- **What it is:** The server keeps an index, checks each changed path, and sends only what was added, removed, or
  changed, with a version number so a reconnecting browser can catch up.
- **Trade-offs:** The payload is smallest. It adds the most new state and new failure modes, and it is unjustified
  until O5 is measured to be too slow.
- **Rests on:** (A18), (A27), (A20)
- **Evidence status:** corroborated that events must be treated as hints. No evidence yet that O5's cost is a problem.

#### O8: Load folders as they are expanded

- **What it is:** The tree loads one folder at a time.
- **Trade-offs:** It reduces payload and work at very large sizes. It changes both the API and the tree UI, and it is
  a bigger change than this question needs.
- **Rests on:** (A1)
- **Evidence status:** no evidence that the full list is too large today.

### What happens to the open document

#### O9: Merge disk text in place when clean, flag when unsaved

- **What it is:** If the open file has no unsaved changes, the existing three-way merge folds the disk text into the
  document, with the four corrections above. If it has unsaved changes, keep the user's text and mark the file as
  changed on disk.
- **Trade-offs:** It keeps scroll and selection and reuses tested code. The four corrections are required, and the
  "changed on disk" state is new UI.
- **Rests on:** (A3), (A4), (A5), (A30), (A35)
- **Evidence status:** corroborated by codebase reading and prior art. Not yet exercised by a test.

#### O10: Merge disk text in place even when there are unsaved changes

- **What it is:** Same merge, applied to documents with unsaved changes, the way AI edits already merge with typing.
- **Trade-offs:** It needs no prompt. Overlapping edits would interleave or duplicate text, because the merge cannot
  detect conflicting meaning. No prior art does this silently.
- **Rests on:** (A4), (A30)
- **Evidence status:** codebase shows it is possible. Prior art supports flagging instead.

#### O11: Replace the document

- **What it is:** Load the disk text into a fresh document.
- **Trade-offs:** It is the simplest. It rebuilds the editor and resets scroll to the top.
- **Rests on:** (A6), (A31), (A36)
- **Evidence status:** corroborated as the wrong fit for the scroll requirement.

#### O12: Ask the user to pick a version

- **What it is:** Prompt to compare on every external change.
- **Trade-offs:** Nothing changes without consent. Users of the editor that does this reported friction and lost text.
- **Rests on:** (A35)
- **Evidence status:** corroborated across user reports.

## Recommendation

- **Recommendation:** Use O1 (Bun's built-in recursive watcher) with O5 (settled event, then full reload) and O9 (merge
  in place when clean, flag when unsaved). The steps:
  1. Open exactly one watcher on the workspace root, and never open or close another.
  2. Ignore hidden paths and non-markdown files.
  3. Collect changed paths until things go quiet.
  4. Send one event on the existing event connection.
  5. In the browser, reload the list, and check any open file whose path changed by comparing the disk text with its
     saved text.
  6. Merge clean files in place, with the four corrections.
  7. For a file with unsaved changes, keep the user's text and show that the disk changed.
  8. Close a clean file that was deleted, and keep a deleted file with unsaved changes, marked deleted.
  9. Reload the list on every reconnect.

  Save and restore a visible scroll anchor around external merges. Put the watcher behind one small interface so O2 can
  replace it if Bun's watcher misbehaves.
- **Evidence basis:**
  - **Watcher choice (codebase and local test):** rests on the local test in the project's exact setup (A43), backed by
    a web benchmark (A14). The one bug that argued against it [single-source] (A12) did not reproduce (A43). The
    fallback reasoning rests on O2's single-source evidence (A13, A18).
  - **Events as hints, and reloading after drops (corroborated):** events as hints rests on (A18, A20, A27, A43), and
    reloading after drops on (A20, A21, A44).
  - **Tree reload cost (codebase and local test):** rests on (A1, A43).
  - **Open-document merge (codebase):** removals and the needed corrections rest on reading y-prosemirror's diffing
    code and 3pitor's merge (A3, A4, A5). Diff-on-reload and flag-when-unsaved rest on prior art (A30), and avoiding
    prompts on (A35).
  - **Scroll (codebase):** rests on the binding's update path (A5). Whether unchanged content stays mounted is
    unverified and needs a test.
  - **Deletes:** rest on codebase (A7) and on VS Code's behavior (A41).

## Validation

### V1: The merge base was wrong for the common "save, then revert" case

- **Strategy:** Challenge the Evidence
- **Investigation:** Read where the load base is set and used in the document store and merge.
- **Result:** Confirmed
- **Impact:** The load base is set only when a file opens and is never updated on save. Merging against it would leave
  saved-then-reverted text in place. The recommendation now names the right base for clean and unsaved documents.

### V2: The editor only scrolls itself when focused

- **Strategy:** Challenge the Evidence
- **Investigation:** Read y-prosemirror's remote-update handler and its cursor-in-view check.
- **Result:** Partially Refuted
- **Impact:** The draft cited web sources for the scroll risk. The library code shows it scrolls only when the editor
  has focus and the cursor is visible. The scroll reasoning now rests on that code, with save-and-restore kept as
  a safeguard.

### V3: The event connection can carry new events, but loses them on reconnect

- **Strategy:** Challenge the Evidence
- **Investigation:** Read the event socket, the event bus, and the browser's event hook.
- **Result:** Confirmed
- **Impact:** New event types work, but the browser reconnects silently with no replay. The recommendation now reloads
  the list on every reconnect.

### V4: Codebase citations hold, with small corrections

- **Strategy:** Challenge the Evidence
- **Investigation:** Checked every codebase location against the files.
- **Result:** Confirmed
- **Impact:** Added that the tree lists only markdown files, and that the app's own Save is a self-write that the echo rule
  (ignore a change event whose disk text equals the saved text) must cover.

### V5: The tree options were over-built and missing alternatives

- **Strategy:** Challenge the Options Framing
- **Investigation:** Compared the tree options with the eager walk, which had not been measured.
- **Result:** Partially Refuted
- **Impact:** The draft recommended a server-side index with diffs (now O7). After the local measurement, the
  recommendation is a full reload (O5). The cached-tree (O6) and expand-to-load (O8) options were added. Auto-merge into
  unsaved documents (O10) is now listed with the reason it is not the default. The race between a save finishing and the
  saved text being recorded is now named.

### V6: The merge can remove text, but needs four corrections

- **Strategy:** Challenge the Recommendation
- **Investigation:** Read y-prosemirror's fragment-update and text-diff code, the document store's change tracking, and
  the undo setup.
- **Result:** Partially Refuted
- **Impact:** Removal works, so a revert can be reproduced. The four corrections are now part of O9: the base, the saved
  state, the undo label, and the unsupported-markdown gate. A test that removes text through the real merge is still
  needed.

### V7: "No clear winner" on the watcher was avoidable

- **Strategy:** Challenge the Recommendation
- **Investigation:** Noted that both deciding questions could be tested locally, and that the codebase has no native
  addon today.
- **Result:** Partially Refuted
- **Impact:** The local test (A43) was run, and the watcher choice moved from "no clear winner" to O1, with O2 as the
  fallback.

### V8: Packaging a native watcher is unverified

- **Strategy:** Challenge the Evidence
- **Investigation:** Looked for native addons and for build checks.
- **Result:** Confirmed
- **Impact:** No evidence either way on running native addons inside the compiled executable. This is one more reason to
  prefer O1. If O2 is ever needed, the existing build check could be extended to create a file and expect an event.

### V9: The strongest argument against Bun's watcher was a single, convenient source

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Checked how much the recommendation depended on the Bun watcher-churn bug report (A12), which
  names this project's exact Bun version. Also checked for circular corroboration.
- **Result:** Partially Refuted
- **Impact:** The bug did not reproduce in the local test, so the recommendation no longer depends on it. Several
  corroboration claims in the draft were circular. They were downgraded to single-source in the registry. No
  instruction-like content was found in the source summaries.

### V10: Some citations did not support their claims

- **Strategy:** Challenge the Evidence
- **Investigation:** Resolved every citation and checked each one's summary against its claim.
- **Result:** Partially Refuted
- **Impact:** Moved the scroll reasoning off the "new editor state resets scroll" source (A36), which supports only
  rejecting O11. Moved the "replacing a Yjs document is discouraged" source (A31) from O9 to O11. Downgraded A25's
  corroboration.

### V11: Unsaved-and-deleted and external rename need new rules

- **Strategy:** Challenge the Recommendation
- **Investigation:** Read the in-app delete and move handling, and the saved view state.
- **Result:** Partially Refuted
- **Impact:** A "deleted on disk" state must be added and persisted. An external rename of a file with unsaved changes
  has no rule yet. It is listed as an open risk.

### Adjustments Made

- The watcher layer moved from "no clear winner" to O1, based on a local test run after validation (A43).
- The tree recommendation moved from a server-side diff index to a settled full reload (O5). Two tree options were
  added.
- O9 now carries four required corrections, and the reload-on-reconnect rule was added.
- Scroll reasoning now rests on library code, not on title-only web sources.

### Confidence Assessment

- **Confidence:** Medium
- **Remaining Risks:**
  - The local test (A43) was one run, on one Mac, against a generated tree. It did not cover a real git checkout, real
    editors' save patterns, symlinks, or Linux.
  - The merge corrections and the scroll behavior come from reading code, not from running it. A test that applies a
    revert while scrolled partway down a long document is the first thing to build.
  - The Bun watcher-churn bug (A12) did not reproduce, but it was not disproven. Opening exactly one watcher avoids its
    trigger.
  - An external rename of an open file with unsaved changes would recreate the old path on Save. That needs a design
    decision.
  - A change event arriving between a save request finishing and the saved text being recorded would look like an
    external edit.
  - Bun's watcher does not report dropped events, so a periodic or on-focus rescan may be needed. How often is
    unmeasured.

## Sources

| ID  | Source                                     | Link / location                                                                                                                       | Retrieved  | Trust class | Summary (one line)                                                                                                                                                    | Evidence status                                         |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A1  | Documents tree walk                        | `src/server/documents/documents.ts:56-74`                                                                                             | n/a        | codebase    | Walks the whole workspace on every request, skips hidden names and symlinks, lists only folders and `.md` files, no cache                                             | codebase                                                |
| A2  | Event WebSocket                            | `src/server/events/events.routes.ts:6-23`; `src/server/events/events.ts`; `src/shared/wire.ts:4-6`                                    | n/a        | codebase    | `/ws/events` sends every event bus event to each connected browser; only task and turn-finished events exist                                                          | codebase                                                |
| A3  | Open-document entries and Save             | `src/ui/documents/documents/documents.tsx:13,56-66,96-112`                                                                            | n/a        | codebase    | Each open file keeps its Yjs doc, saved text, load-time base, and unsaved flag; any change marks it unsaved; Save is manual and never updates the base                | codebase                                                |
| A4  | Three-way merge                            | `src/ui/documents/markdown-editor/markdown-editor.tsx:44-45,87-98`                                                                    | n/a        | codebase    | Applies markdown as Yjs changes on a fork of a base snapshot so concurrent edits survive; uses the AI change label that undo tracks                                    | codebase                                                |
| A5  | y-prosemirror 1.3.7 update and diff code   | `node_modules/y-prosemirror/src/plugins/sync-plugin.js:358-368,592-641,1079-1090,1145-1290`                                           | n/a        | codebase    | Rebuilds only changed parts, restores selection, scrolls only when focused with cursor in view; its diff turns removed text and blocks into deletes                    | codebase                                                |
| A6  | Editor lifecycle and view state            | `src/ui/documents/markdown-editor/markdown-editor.tsx:636-681`; `src/shared/wire.ts:84-115`                                           | n/a        | codebase    | A new editor view is built when the document object changes; scroll position is not persisted                                                                        | codebase                                                |
| A7  | In-app delete                              | `src/ui/documents/documents/documents.tsx:142-151`                                                                                    | n/a        | codebase    | Drops every open file at or under the deleted path, clears the current file, reloads the list                                                                        | codebase                                                |
| A8  | Server writes to `.3pitor`                 | `src/server/components/json-file.ts:24-40`; `src/server/chat/tools/tools.ts:102-120`                                                  | n/a        | codebase    | The server writes its own state and notes under `.3pitor/` via temp file and rename                                                                                  | codebase                                                |
| A9  | Runtime and packaging                      | `bun --version` (1.4.2); `package.json`; `Makefile:11`                                                                                | n/a        | codebase    | The project runs Bun 1.4.2 and ships as one `bun build --compile` executable                                                                                         | codebase                                                |
| A10 | In-app move                                | `src/ui/documents/documents/documents.tsx:126-138`                                                                                    | n/a        | codebase    | Moving in the app re-files open documents under the new path so unsaved edits follow                                                                                | codebase                                                |
| A11 | Bun PR #44067                              | https://github.com/oven-sh/bun/pull/44067                                                                                             | 2026-10-01 | web         | Bun on macOS watches folders through a shared FSEvents stream and single files by inode, which go silent after an atomic save                                        | single source (caveated)                                |
| A12 | Bun issue #44385                           | https://github.com/oven-sh/bun/issues/44385                                                                                           | 2026-10-01 | web         | Reports that in Bun 1.4.2 on macOS, opening or closing any watcher drops events for others                                                                           | single source (caveated); not reproduced by A43         |
| A13 | Bun issue #34160                           | https://github.com/oven-sh/bun/issues/34160                                                                                           | 2026-10-01 | web         | Per-file watcher setup on Bun/macOS grows super-linearly; a dev server started in 66s with chokidar vs 5s with `@parcel/watcher`                                     | single source (caveated)                                |
| A14 | peruse issue #37                           | https://github.com/talkasab/peruse/issues/37                                                                                          | 2026-10-01 | web         | Bun recursive watch used 606 watches vs chokidar's 8,380, started in 85ms vs 1,237ms on 20k files, and caught all 1,940 burst events                                 | single source (caveated); consistent with A43           |
| A15 | Bun PR #43090                              | https://github.com/oven-sh/bun/pull/43090                                                                                             | 2026-10-01 | web         | Bun's Linux recursive watch uses one inotify watch per folder and skips symlinked entries; fix unmerged                                                              | single source (caveated)                                |
| A16 | Bun PR #44249                              | https://github.com/oven-sh/bun/pull/44249                                                                                             | 2026-10-01 | web         | Bun's recursive walk can crash or watch incompletely on very deep trees; rework open                                                                                 | single source (caveated)                                |
| A17 | chokidar README                            | https://github.com/paulmillr/chokidar                                                                                                 | 2026-10-01 | web         | v4 dropped bundled fsevents; the README lists running out of file handles on large trees as a limitation                                                             | corroborated by A13, A14                                |
| A18 | `@parcel/watcher` README                   | https://github.com/parcel-bundler/watcher                                                                                             | 2026-10-01 | web         | Native per-OS backends, watcher-level ignore, events merged into create/update/delete and unordered, rename as delete plus create, catch-up snapshots                | corroborated by A27, A26                                |
| A19 | Bun issues #13516, #19282                  | https://github.com/oven-sh/bun/issues/13516 ; https://github.com/oven-sh/bun/issues/19282                                             | 2026-10-01 | web         | `@parcel/watcher` problems under Bun were a config error and a missing Intel Mac prebuilt binary                                                                     | single source (caveated)                                |
| A20 | Apple FSEvents Programming Guide           | https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/UsingtheFSEventsFramework/UsingtheFSEventsFramework.html | 2026-10-01 | web | One stream per tree; events merged over a latency window; dropped events require a rescan                                                     | primary; corroborated by A21                            |
| A21 | inotify limits                             | https://watchexec.github.io/docs/inotify-limits.html ; https://linux.die.net/man/7/inotify                                            | 2026-10-01 | web         | One watch per folder, default limit often 8,192, queue overflow loses events                                                                                         | corroborated across sources                             |
| A22 | Watchman docs                              | https://facebook.github.io/watchman/docs/config ; https://facebook.github.io/watchman/docs/scm-query                                  | 2026-10-01 | web         | Waits for a 20ms quiet "settle" before firing, holds events during version-control operations, recrawls after overflow                                                | single vendor (caveated)                                |
| A23 | nsfw                                       | https://github.com/Axosoft/nsfw                                                                                                       | 2026-10-01 | web         | Native threaded watcher that batches events; no evidence of Bun support                                                                                              | single source (caveated)                                |
| A24 | Atomic-save and self-write practice        | https://github.com/Joncallim/macdown_2/issues/30 ; https://github.com/bloknayrb/tandem/issues/1749 ; https://github.com/sackheads/iris/pull/279 | 2026-10-01 | web | Atomic saves swap the file, one save fires several events, and content comparison filters an app's own writes                                        | corroborated across small projects (low authority)      |
| A25 | Node.js `fs.watch` docs                    | https://nodejs.org/api/fs.html#fswatchfilename-options-listener                                                                       | 2026-10-01 | web         | `rename` and `change` event names are inconsistent across platforms                                                                                                  | corroborated by A43                                     |
| A26 | VS Code File Watcher Internals             | https://github.com/microsoft/vscode/wiki/File-Watcher-Internals                                                                       | 2026-10-01 | web         | VS Code uses `@parcel/watcher` for recursive watching and suspends watches on paths that disappear                                                                   | single source                                           |
| A27 | parcel watcher issue #72                   | https://github.com/parcel-bundler/watcher/issues/72                                                                                   | 2026-10-01 | web         | A fast delete and recreate can surface as a create or be merged into an update                                                                                      | corroborated by A18, A24                                |
| A28 | Hono streaming helper                      | https://hono.dev/docs/helpers/streaming                                                                                               | 2026-10-01 | web         | Hono's Server-Sent Events helper, with abort cleanup and manual heartbeats                                                                                           | single source (docs)                                    |
| A29 | MDN, Using server-sent events              | https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events                                          | 2026-10-01 | web         | Server-Sent Events are one-way, reconnect automatically, and are limited to six connections per site on HTTP/1.1                                                    | single source (authoritative)                           |
| A30 | Zed issue #52 and related                  | https://github.com/zed-industries/zed/issues/52 ; https://github.com/zed-industries/zed/issues/63174                                  | 2026-10-01 | web         | Zed reloads a clean buffer by diffing to keep positions and flags a modified buffer as conflicting; a missed atomic save led to an overwrite                          | design proposal; corroborated in spirit by A35          |
| A31 | Yjs forum, merging two documents           | https://discuss.yjs.dev/t/merging-two-different-y-js-documents/2538                                                                   | 2026-10-01 | web         | Replacing a whole Yjs document is discouraged; apply changes individually                                                                                            | single source, search summary only                      |
| A32 | ProseMirror forum, external Yjs update     | https://discuss.prosemirror.net/t/updating-prosemirror-doc-from-an-external-non-prosemirror-yjs-update/6460                           | 2026-10-01 | web         | Advises against changing the Yjs doc through a separate provider connection                                                                                          | single source; not used by the recommendation           |
| A33 | y-prosemirror issue #113                   | https://github.com/yjs/y-prosemirror/issues/113                                                                                       | 2026-10-01 | web         | Remote Yjs updates reach the editor as a whole-document replace, with selection restored                                                                             | corroborated by A5                                      |
| A34 | Obsidian forum and plugins                 | https://forum.obsidian.md/t/obsidian-doesnt-reload-the-current-file-when-it-is-changed-outside-of-obsidian/114185/6                   | 2026-10-01 | web         | Obsidian's change event fires for its own and outside edits, and open files can show stale content                                                                   | weakly corroborated; not used by the recommendation     |
| A35 | Logseq forum and issues                    | https://discuss.logseq.com/t/external-editor-and-conflicts/16995 ; https://github.com/logseq/logseq/issues/8269                       | 2026-10-01 | web         | Logseq's "modified on disk" compare prompt drew complaints of friction and lost text                                                                                 | corroborated across user reports                        |
| A36 | ProseMirror forum, replacing a state's doc | https://discuss.prosemirror.net/t/replacing-a-states-doc/634                                                                          | 2026-10-01 | web         | A brand-new editor state resets the scroll position                                                                                                                  | single source, search summary only; consistent with A37 |
| A37 | ProseMirror changelog                      | https://prosemirror.net/docs/changelog/                                                                                               | 2026-10-01 | web         | prosemirror-view 1.28.1 fixed reconfiguring state resetting scroll to the top                                                                                        | consistent with A36                                     |
| A38 | y-prosemirror issue #31                    | https://github.com/yjs/y-prosemirror/issues/31                                                                                        | 2026-10-01 | web         | "Scroll position changes when other clients are editing"                                                                                                             | single source, title only                               |
| A39 | Yjs relative positions                     | https://docs.yjs.dev/api/relative-positions                                                                                           | 2026-10-01 | web         | A relative position stays attached to its content through other changes                                                                                              | corroborated by A5                                      |
| A40 | MDN, overflow-anchor                       | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-anchor                                                 | 2026-10-01 | web         | Browser scroll anchoring offsets layout shifts and is on by default in Chrome, Edge, and Firefox                                                                     | single source                                           |
| A41 | VS Code deleted-file issues                | https://github.com/microsoft/vscode/issues/23242 ; https://github.com/microsoft/vscode/issues/134116                                  | 2026-10-01 | web         | An open file deleted on disk keeps its buffer, marked deleted, and saving recreates it                                                                               | corroborated by two threads                             |
| A42 | ProseMirror forum, scrolling on collab edits | https://discuss.prosemirror.net/t/do-not-cause-scrolling-for-collaborative-edits/564                                                | 2026-10-01 | web         | Stopping collaborative edits from scrolling the editor is a known concern                                                                                            | single source, title only; not used by the recommendation |
| A43 | Local watcher and tree-walk experiment     | scratchpad experiment, Bun 1.4.2 on macOS, 2,040 folders and 20,000 `.md` files                                                      | n/a        | codebase    | Walk 65ms, 870 KB JSON; watcher started in 3ms; 500/500 creates and 20/20 writes under watcher churn seen; folder delete gave 551 events; all deletes and saves arrived as "rename" | local measurement, one run                              |
| A44 | Browser event hook                         | `src/ui/events/host-events.ts:11-24`                                                                                                  | n/a        | codebase    | The browser reconnects to the event socket after one second with no replay of missed events                                                                         | codebase                                                |

### A3: Open-document entries and Save — recommendation-bearing

- **Link / location:** `src/ui/documents/documents/documents.tsx:13,56-66,96-112`
- **Retrieved:** n/a
- **Trust class:** codebase (trusted current-state anchor)
- **Summary:** Each open file is an entry holding its Yjs document, the text as last saved, a snapshot taken when the
  file was loaded, a save count, and an unsaved flag. A listener marks the entry unsaved on any document update. Save
  writes the editor's markdown, then records it as the saved text and recomputes the flag. The load-time snapshot is
  never updated after load, so it stops matching the disk after the first save.
- **Evidence status:** codebase; confirmed by validation (V1, V6).

### A4: Three-way merge — recommendation-bearing

- **Link / location:** `src/ui/documents/markdown-editor/markdown-editor.tsx:44-45,87-98`
- **Retrieved:** n/a
- **Trust class:** codebase (trusted current-state anchor)
- **Summary:** The merge copies a base snapshot into a fork, rewrites the fork to match the new markdown, and applies
  only the fork's changes to the live document. Typing made since the base survives as a concurrent edit. The changes
  are labelled with the AI's change label, which the editor's undo history tracks, so they become an Undo step.
- **Evidence status:** codebase; confirmed by validation (V6).

### A5: y-prosemirror 1.3.7 update and diff code — recommendation-bearing

- **Link / location:** `node_modules/y-prosemirror/src/plugins/sync-plugin.js:358-368,592-641,1079-1090,1145-1290`
- **Retrieved:** n/a
- **Trust class:** codebase (trusted current-state anchor)
- **Summary:** When the Yjs document changes, the binding rebuilds only changed top-level parts, reuses cached nodes for
  the rest, replaces the editor content in one transaction, and restores the selection by relative position. It scrolls
  only when the editor has focus and the cursor is on screen. Its diffing step trims matching blocks at both ends,
  diffs text inside changed blocks, and deletes removed text and blocks, so a revert that removes content is
  representable.
- **Evidence status:** codebase; read but not executed.

### A43: Local watcher and tree-walk experiment — recommendation-bearing

- **Link / location:** a script run in the session scratchpad with Bun 1.4.2 on macOS, against a generated workspace of
  2,040 folders and 20,000 `.md` files
- **Retrieved:** n/a (run 2026-10-01)
- **Trust class:** codebase (local measurement in the project's own runtime)
- **Summary:** A walk matching the server's tree walk returned 22,040 entries in 62 to 65 ms across three runs, as about
  870 KB of JSON. One recursive `fs.watch` on the root started in 3 ms. It reported 500 of 500 rapidly created files.
  It reported 20 of 20 files written while a second watcher was opened and closed ten times, so the reported churn bug
  (A12) did not reproduce. Deleting a folder holding 50 subfolders and 500 files produced 551 events, one per entry.
  An atomic save (write a temp file, rename it over an existing file) produced two "rename" events and no "change".
- **Evidence status:** one run on one machine with a generated tree. It did not cover git operations, real editors,
  symlinks, or Linux.

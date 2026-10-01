# Change Plan: Live workspace file watching

## Why This Change

The operator wants 3pitor to notice when files in the loaded workspace change outside the app. When that happens, the
Documents pane and the open editor should update by themselves. Their examples are a git revert of the open file,
another app editing it, and a whole folder being deleted. The editor must keep the scroll position through each one.

This is a **constraint arriving**: a new requirement the current structure cannot absorb. The source is the operator's
own words, recorded in [artifacts/scope-boundary.md](artifacts/scope-boundary.md), and the research report
[docs/research/live-workspace-file-watching.md](../../research/live-workspace-file-watching.md). The run settled every
question itself, at the operator's standing request ([D-16](artifacts/change-decision-log.md#trivial-decisions)). It
planned new behavior with `plan-a-change` because the operator invoked it
([D-17](artifacts/change-decision-log.md#trivial-decisions)).

## What Changes, In One Paragraph

The server watches the whole workspace with one recursive watcher. It ignores hidden folders such as `.git/` and
`.3pitor/`, waits for a burst of changes to go quiet (never longer than a second), and then sends one "documents
changed" message to every open browser tab. The browser answers that message, and every reconnect and page reload, the
same way:

1. It reloads the document list.
2. It re-reads each open file and compares it with the text it last saved or loaded.
3. It brings a file with no unsaved changes in line with disk, in place. The editor is not rebuilt, so the scroll
   position stays put.
4. It closes a file with no unsaved changes once the server confirms that file is gone.
5. It leaves a file with unsaved changes alone, and tells the writer that its disk copy changed or is gone. The writer
   can overwrite the disk copy by saving, or take the disk version.

Save runs at most once at a time per file. It records what it wrote before anything else can look, so the app's own
saves never look like outside edits.

## Current State

Nothing watches the filesystem today. The parts this change builds on are as follows.

**Server.**

- The document list is a full walk of the workspace on every request. One folder vanishing mid-walk turns the request
  into a 500 ([C-1](artifacts/current-state-findings.md#c-1-the-tree-is-a-full-eager-walk-with-no-cache-and-one-vanished-folder-fails-the-whole-request)).
- The rule that hides dot-names is written out twice in `documents.ts`
  ([C-2](artifacts/current-state-findings.md#c-2-the-hidden-name-rule-is-written-out-twice-and-is-not-exported)).
- An event bus and a WebSocket at `/ws/events` already fan out typed events to every tab, and a new event type needs no
  change to either
  ([C-3](artifacts/current-state-findings.md#c-3-the-event-bus-and-socket-are-a-bare-type-agnostic-fan-out-with-no-replay),
  [C-4](artifacts/current-state-findings.md#c-4-hostevent-is-a-two-member-union-and-no-consumer-switches-on-it-exhaustively)).
- `server.ts` is the one place things are wired together, and it has no shutdown hook
  ([C-5](artifacts/current-state-findings.md#c-5-the-event-bus-is-built-in-createagenthost-and-reaches-serverts-as-hostevents),
  [C-6](artifacts/current-state-findings.md#c-6-the-server-has-no-lifecycle-hook-and-no-long-lived-resource-needs-closing-today)).

**Browser.**

- The socket reconnects every second and replays nothing
  ([C-7](artifacts/current-state-findings.md#c-7-the-browser-reconnects-every-second-with-no-replay-and-no-first-versus-reconnect-signal)).
- `useDocuments` is a large hook, and it alone holds the open files
  ([C-8](artifacts/current-state-findings.md#c-8-usedocuments-is-a-380-line-hook-with-about-eight-responsibilities-and-it-alone-holds-the-open-files)).
- Any change to an open file's Yjs document marks it unsaved
  ([C-9](artifacts/current-state-findings.md#c-9-every-yjs-update-marks-an-open-file-unsaved-whatever-made-it)).
- Each open file's `saved` holds the raw text last loaded or saved
  ([C-10](artifacts/current-state-findings.md#c-10-an-entrys-saved-is-the-raw-disk-text-and-its-loadbase-is-never-updated-after-load)).
- Save records `saved` only after its request and an optional list reload
  ([C-11](artifacts/current-state-findings.md#c-11-save-records-saved-only-after-the-put-and-an-optional-list-reload)).
- Two saves of one file can overlap
  ([C-12](artifacts/current-state-findings.md#c-12-two-saves-of-one-file-can-overlap-on-both-sides)).
- An open file is never re-read from disk
  ([C-25](artifacts/current-state-findings.md#c-25-an-open-file-is-never-re-read-from-disk-and-a-missing-file-is-never-discovered)).
- A page reload restores unsaved drafts without checking them against disk
  ([C-27](artifacts/current-state-findings.md#c-27-restore-tracks-stored-unsaved-files-before-its-first-await-and-never-checks-them-against-disk)).
- The list reload has no guard against an older response landing last
  ([C-22](artifacts/current-state-findings.md#c-22-refreshlist-replaces-the-list-wholesale-has-no-latest-wins-guard-and-is-not-exposed)).
- A failed request loses its HTTP status
  ([C-26](artifacts/current-state-findings.md#c-26-a-missing-file-reads-as-a-404-with-a-sentence-but-callers-see-only-the-message)).

**Editor.**

- The AI's merge helper can apply new text to a live document in place, removals included, when given a base that
  shares the document's history
  ([C-16](artifacts/current-state-findings.md#c-16-the-merges-diff-removes-text-and-blocks-but-only-for-items-the-base-shares-with-the-live-document)).
- That merge is tagged so Undo records it
  ([C-15](artifacts/current-state-findings.md#c-15-mergemarkdown-hard-codes-the-ai-origin-which-the-editors-undo-tracks)).
- The editor view survives any change applied in place to the same document
  ([C-18](artifacts/current-state-findings.md#c-18-the-editor-view-lives-as-long-as-its-yjs-document-object-and-the-scroller-is-rich-editor)).
- The editor binding rebuilds only what changed
  ([C-19](artifacts/current-state-findings.md#c-19-y-prosemirror-rebuilds-only-changed-parts-and-scrolls-only-when-focused-with-the-cursor-on-screen)).

**The structural property this change addresses:** the app has no path from the disk to the browser after a file is
first loaded. Every list reload and every file read today is triggered by the browser's own actions
([C-25](artifacts/current-state-findings.md#c-25-an-open-file-is-never-re-read-from-disk-and-a-missing-file-is-never-discovered)).

## Target State

### Server: one watcher, one event

`src/server/documents/documents.ts` owns which disk paths count as documents, and now also watches them
([D-3](artifacts/change-decision-log.md#d-3-the-watcher-lives-in-documentsts-and-ignores-hidden-paths-only)).

- A module-private `isHiddenName(name)` is the one hidden-name rule. `checkPath`, `listEntries`, and the watcher all
  call it.
- `listEntries` skips a sub-folder that vanishes while it walks
  ([D-2](artifacts/change-decision-log.md#d-2-the-tree-walk-skips-a-folder-that-vanishes-mid-walk)).
- `watchDocuments` opens one recursive `fs.watch` on the workspace
  ([D-1](artifacts/change-decision-log.md#d-1-use-buns-built-in-recursive-watcher)). It drops events under hidden
  segments, and calls its callback once per settled burst
  ([D-5](artifacts/change-decision-log.md#d-5-settle-bursts-with-a-100-ms-trailing-timer-capped-at-1-s)). It is not
  answerable for knowing what changed.

`server.ts` starts it and turns each settled burst into one event on the existing bus
([D-4](artifacts/change-decision-log.md#d-4-start-the-watcher-in-serverts-guard-its-callback-log-its-errors-and-add-no-shutdown-hook)).

**Contract: the watcher.**

```ts
// src/server/documents/documents.ts
export function watchDocuments(workspace: string, onSettled: () => void): { close(): void };
// - exactly one fs.watch(workspace, { recursive: true }) for the life of the handle
// - an event whose filename has any segment (split on / or \) starting with "." is dropped
// - an event with no filename is kept
// - each kept event restarts a 100 ms trailing timer; the first kept event after a fire also starts a 1000 ms cap timer
// - when either timer fires: clear both, then onSettled() inside try/catch → console.error
// - watcher.on('error', …) → console.error; the process keeps running (watching may end until restart)
// - close(): clears both timers, closes the watcher; onSettled is never called after close() returns
```

**Contract: the wiring, in `server.ts` right after `createAgentHost`.**

```ts
watchDocuments(workspace, () => host.events.emit({ type: 'documents-changed' }));
```

**Contract: the event**
([D-6](artifacts/change-decision-log.md#d-6-one-payload-free-documents-changed-event-on-the-existing-socket)). `HostEvent`
in `src/shared/wire.ts` gains one member, and the socket sends it as exactly `{"type":"documents-changed"}`.

```ts
| { type: 'documents-changed' }
```

### Editor: bring a document in line with disk text

`markdown-editor.tsx` exports `replaceMarkdown`. It makes a live document hold given markdown and changes only what
differs, so unchanged paragraphs keep their identity and the view keeps its place. Undo does not record the change, and
the shown document's undo history is cleared
([D-7](artifacts/change-decision-log.md#d-7-replacemarkdown-brings-a-document-in-line-with-disk-text-outside-undo)).

`mergeMarkdown` keeps its signature and behavior. Both functions call a private `applyMarkdown(live, base, markdown,
origin?)`.

No scroll code is added. The editor library already preserves the scroll position for a change applied in place
([D-12](artifacts/change-decision-log.md#d-12-rely-on-the-editor-library-to-keep-the-scroll-position)). "Keep my scroll
position" means the passage at the top of the view stays at the top, in rendered and raw mode
([D-18](artifacts/change-decision-log.md#d-18-keep-my-scroll-position-means-the-passage-at-the-top-of-the-view-stays-put-in-both-modes)).

**Contract.**

```ts
export function replaceMarkdown(live: Y.Doc, markdown: string): void {
  applyMarkdown(live, snapshot(live), markdown); // origin omitted → Yjs records null, which undo does not track
  undoManagers.get(live)?.clear();
}
```

### Browser: failed requests keep their status

`api()` throws an `Error` that also carries the response's HTTP `status`
([D-19](artifacts/change-decision-log.md#d-19-a-failed-requests-error-carries-the-http-status)).

```ts
throw Object.assign(new Error(message), { status: res.status }); // message exactly as today
```

### Browser: the documents store follows disk

`useDocuments` keeps the open-file registry private and gains the sync as a member
([D-8](artifacts/change-decision-log.md#d-8-syncwithdisk-lives-inside-usedocuments-with-a-shared-forget-helper)). It is
now answerable for keeping open files consistent with disk. It is still not answerable for watching or for knowing what
changed.

**Contract: the entry type.** Two optional fields are added.

```ts
type Entry = {
  doc: Y.Doc; saved: string; loadBase: Snapshot; saves: number; dirty: boolean;
  saving?: Promise<void>;   // the save running for this file, if any (D-10)
  diskChanged?: boolean;    // disk differs from `saved` while the file has unsaved changes (D-13)
};
```

**Invariant.** `entry.saved` is the disk text the document was last brought in line with. It changes only on load,
after a successful PUT, and after a successful `replaceMarkdown` in `followDisk`
([D-9](artifacts/change-decision-log.md#d-9-per-file-rules-for-a-sync-and-the-saved-invariant)).

**Contract: new and changed members.**

```ts
refreshList(): Promise<DocumentEntry[]>  // hook-private; a sequence ref makes the latest call win: applies to entries
                                         // and listRef only if still the latest; always returns what it fetched (D-11)
syncWithDisk(): Promise<void>            // returned; coalesced and never rejects (D-11, pinned below)
onDisk: boolean                          // returned; true until the first list lands, then listRef holds current (D-13)
diskChanged: boolean                     // returned; the current file's entry.diskChanged (D-13)
takeDiskVersion(): Promise<void>         // returned; GET → identity re-check → followDisk; rejects with a failed GET (D-13)
// hook-private helpers:
forget(name: string): void               // drop from opened; show(undefined) if current; clear its highlights;
                                         // leaves turnBases alone, like remove() today (D-14)
followDisk(entry: Entry, text: string): void  // replaceMarkdown(doc, text) FIRST; then saved = text; dirty = false;
                                              // diskChanged = false. A throw leaves the entry unchanged (D-9)
```

**Contract: coalescing**
([D-11](artifacts/change-decision-log.md#d-11-sync-on-the-event-on-every-socket-connect-and-at-the-end-of-restore-the-list-is-latest-wins)).

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
// syncOnce() wraps the whole run below in try { … } catch (e) { console.error(…) }, so it never rejects.
// A call resolves when a run that started at or after the call has finished.
```

**Contract: one sync run, in order**
([D-9](artifacts/change-decision-log.md#d-9-per-file-rules-for-a-sync-and-the-saved-invariant),
[D-14](artifacts/change-decision-log.md#d-14-deleted-on-disk--confirmed-clean-files-close-unsaved-files-stay-and-save-recreates)).
A sync never waits for a running save.

1. Set `before = listRef.current`, then `now = await refreshList()`.
2. For each open `[name, entry]`, take the first branch that applies:
   - **Not in `now`:**
     1. Set `entry.diskChanged = false`.
     2. If `!entry.dirty` and `name` is in `before`, GET the file. If that fails with `status === 404` and
        `opened.current.get(name) === entry`, call `forget(name)`.
     3. Otherwise leave the file open. The derived `onDisk` notice covers it.
   - **In `now`:**
     1. GET `/api/documents/{name}`. On any failure, skip the file.
     2. If `opened.current.get(name) !== entry` or `entry.saving` is set, skip the file.
     3. If `text === entry.saved`, set `entry.diskChanged = false`.
     4. Else, if `!entry.dirty`, call `followDisk(entry, text)` inside a try/catch that logs.
     5. Else, set `entry.diskChanged = true`.
3. Call `rerender()` once.

**Contract: Save**
([D-10](artifacts/change-decision-log.md#d-10-save-runs-at-most-once-at-a-time-per-file-and-records-saved-before-its-list-reload)).

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

**Contract: callers**
([D-11](artifacts/change-decision-log.md#d-11-sync-on-the-event-on-every-socket-connect-and-at-the-end-of-restore-the-list-is-latest-wins)).

- `restore()` calls `syncWithDisk()` as its last step.
- `App` calls `docs.syncWithDisk()` from its `useHostEvents` handler when `event.type === 'documents-changed'`.
- `App` also calls it from `useEffect(() => { if (connected) docs.syncWithDisk(); }, [connected])`.

**Contract: notices**
([D-13](artifacts/change-decision-log.md#d-13-one-stored-disk-flag-one-derived-flag-one-notice-at-a-time-and-a-way-to-take-the-disk-version)).
The `Editor` component shows at most one of these, for the current file.

- When `!docs.onDisk`, in the `.notice` style: `{name} is not on disk. Save creates it.`
- Otherwise, when `docs.diskChanged`, in the `.notice` style: `{name} changed on disk. Save overwrites it.` plus a
  button labeled `Use the disk version` that calls `docs.takeDiskVersion()`.
- When `takeDiskVersion()` rejects, in the save-failure style: `Could not load the disk version of {name}: {message}`.

## Surface Delta

### S-1: `listEntries` — Re-scoped

**Target state.** `listEntries(workspace)` returns every folder and `.md` file it can read, sorted by path. It skips any
sub-folder whose `readdir` fails with `ENOENT` (the folder was deleted) or `ENOTDIR` (it was replaced by a file). A
failure reading the workspace root still throws. Its hidden-name test is the module-private `isHiddenName`.

**Behavior.** Changing. A vanished folder used to turn `GET /api/documents` into a 500. Now the list is returned without
it. Settled by the run per D-16.

**Why.** The browser now reloads the list during exactly the bursts that delete folders
([C-1](artifacts/current-state-findings.md#c-1-the-tree-is-a-full-eager-walk-with-no-cache-and-one-vanished-folder-fails-the-whole-request)).

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-tree-walk-skips-a-folder-that-vanishes-mid-walk),
[D-3](artifacts/change-decision-log.md#d-3-the-watcher-lives-in-documentsts-and-ignores-hidden-paths-only)

### S-2: `watchDocuments` — Added

**Target state.** `watchDocuments(workspace, onSettled)` in `src/server/documents/documents.ts` returns
`{ close(): void }`. It holds one recursive `fs.watch` on the workspace and drops events under hidden segments. It calls
`onSettled` once each time 100 ms pass after the last kept event, or 1 s after the first kept event of a burst, whichever
comes first. It logs watcher errors and callback errors. `close()` stops it.

**Behavior.** Changing. It is the new behavior. See S-4.

**Why.** The operator asked for the app to notice outside changes, and nothing watches today
([C-31](artifacts/current-state-findings.md#c-31-buns-recursive-watcher-is-fast-and-complete-on-a-22000-entry-workspace-in-this-projects-runtime)).

**Depends on.** S-1, which shares `isHiddenName`.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-use-buns-built-in-recursive-watcher),
[D-3](artifacts/change-decision-log.md#d-3-the-watcher-lives-in-documentsts-and-ignores-hidden-paths-only),
[D-5](artifacts/change-decision-log.md#d-5-settle-bursts-with-a-100-ms-trailing-timer-capped-at-1-s)

### S-3: `HostEvent` — Re-scoped

**Target state.** `HostEvent` in `src/shared/wire.ts` is a union of three members: `task`, `turn-finished`, and
`{ type: 'documents-changed' }`. The new member carries no other field.

**Behavior.** Changing. Every `/ws/events` client receives a new message type after a settled burst. No existing
consumer switches exhaustively on the union, so none breaks
([C-4](artifacts/current-state-findings.md#c-4-hostevent-is-a-two-member-union-and-no-consumer-switches-on-it-exhaustively)).
Settled by the run per D-16.

**Why.** It is the only signal from the disk to the browser.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-one-payload-free-documents-changed-event-on-the-existing-socket)

### S-4: `server.ts` composition — Re-scoped

**Target state.** `server.ts` starts `watchDocuments(workspace, …)` right after `createAgentHost`. Each settled burst
emits `{ type: 'documents-changed' }` on `host.events`. The returned handle is not kept, and the comments in
`events.ts` and `events.routes.ts` that list the event set and publishers name the new event and publisher.

**Behavior.** Changing. While it runs, the server watches the workspace and announces changes. Settled by the run per
D-16.

**Why.** `server.ts` is the composition root, and `host.events` is the only bus
([C-5](artifacts/current-state-findings.md#c-5-the-event-bus-is-built-in-createagenthost-and-reaches-serverts-as-hostevents)).

**Depends on.** S-2, S-3.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-start-the-watcher-in-serverts-guard-its-callback-log-its-errors-and-add-no-shutdown-hook)

### S-5: `replaceMarkdown` — Added

**Target state.** `replaceMarkdown(live, markdown)` in `markdown-editor.tsx` makes `live` hold `markdown`. It changes
only what differs, records nothing in undo, and clears the undo history of the editor showing `live`, if one is mounted.
`mergeMarkdown` keeps its signature and behavior, and both share a private `applyMarkdown`.

**Behavior.** Changing. Undo has nothing to undo in a file just updated from disk. `mergeMarkdown` is unchanged.
Settled by the run per D-16.

**Why.** A disk change must reach an open file in place, removals included, and must not become an undo step that a
later Save writes back
([C-15](artifacts/current-state-findings.md#c-15-mergemarkdown-hard-codes-the-ai-origin-which-the-editors-undo-tracks),
[C-16](artifacts/current-state-findings.md#c-16-the-merges-diff-removes-text-and-blocks-but-only-for-items-the-base-shares-with-the-live-document)).

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-replacemarkdown-brings-a-document-in-line-with-disk-text-outside-undo)

### S-13: `api` — Re-scoped

**Target state.** `api()` in `src/ui/components/api.ts` throws, for a response that is not OK, an `Error` with the same
message as today and a `status` property holding the HTTP status.

**Behavior.** Preserving for every existing caller. They read only the message, which is unchanged. The new `status` is
read only by the sync.

**Why.** The sync closes a missing file only on a 404
([C-26](artifacts/current-state-findings.md#c-26-a-missing-file-reads-as-a-404-with-a-sentence-but-callers-see-only-the-message)).

**Decision.** [D-19](artifacts/change-decision-log.md#d-19-a-failed-requests-error-carries-the-http-status)

### S-6: `refreshList` — Re-scoped

**Target state.** `refreshList()` returns `Promise<DocumentEntry[]>`, the list it fetched. It applies that list to
`entries` and to a new `listRef` only when no later call has started. It remains private to `useDocuments`.

**Behavior.** Changing. An older list response no longer overwrites a newer one. Settled by the run per D-16.

**Why.** Watcher-driven reloads overlap the app's own
([C-22](artifacts/current-state-findings.md#c-22-refreshlist-replaces-the-list-wholesale-has-no-latest-wins-guard-and-is-not-exposed)).

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-sync-on-the-event-on-every-socket-connect-and-at-the-end-of-restore-the-list-is-latest-wins)

### S-7: `useDocuments().save` — Re-scoped

**Target state.** `save(name)` returns the running save when one is in flight for that file. Otherwise it starts one and
records it in `entry.saving`, which is cleared when that save settles, whether it succeeds or fails. After a successful
PUT it records `saved`, `saves`, `dirty`, and `diskChanged` before any list reload. It checks for the file in `listRef`
rather than in the `entries` closure.

**Behavior.** Changing. A Save pressed during a running save of the same file no longer sends a second PUT. Text typed
after the first save read the document stays unsaved until the next Save. Settled by the run per D-16.

**Why.** The app's own write must never look like an outside edit, and a failed save must not block later ones
([C-11](artifacts/current-state-findings.md#c-11-save-records-saved-only-after-the-put-and-an-optional-list-reload),
[C-12](artifacts/current-state-findings.md#c-12-two-saves-of-one-file-can-overlap-on-both-sides)).

**Depends on.** S-6.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-save-runs-at-most-once-at-a-time-per-file-and-records-saved-before-its-list-reload)

### S-8: `useDocuments().syncWithDisk` — Added

**Target state.** `syncWithDisk()` brings the list and every open file in line with disk, by the rules pinned in Target
State. Runs are coalesced and never reject. It closes clean files confirmed deleted on disk through the hook-private
`forget`, and `remove()` closes files through the same `forget`.

**Behavior.** Changing.

- A clean open file updates to match disk in place.
- A clean open file confirmed deleted on disk closes.
- An unsaved file whose disk copy changed is flagged.

Settled by the run per D-16.

**Why.** This is the feature. An open file is never re-read today
([C-25](artifacts/current-state-findings.md#c-25-an-open-file-is-never-re-read-from-disk-and-a-missing-file-is-never-discovered)).

**Depends on.** S-5, S-6, S-7, S-13.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-syncwithdisk-lives-inside-usedocuments-with-a-shared-forget-helper),
[D-9](artifacts/change-decision-log.md#d-9-per-file-rules-for-a-sync-and-the-saved-invariant),
[D-14](artifacts/change-decision-log.md#d-14-deleted-on-disk--confirmed-clean-files-close-unsaved-files-stay-and-save-recreates)

### S-9: `useDocuments().onDisk`, `.diskChanged`, `.takeDiskVersion` — Added

**Target state.** `onDisk` says whether the current file is in the last applied list, and is `true` before the first
list lands. `diskChanged` is the current file's flag. `takeDiskVersion()` replaces the current file's contents with its
disk text and clears its unsaved state, or rejects with the read's error.

**Behavior.** Changing. These are new members. See S-11. Settled by the run per D-16.

**Why.** The writer needs to see, and act on, an unsaved file whose disk copy changed or vanished.

**Depends on.** S-8.

**Decision.** [D-13](artifacts/change-decision-log.md#d-13-one-stored-disk-flag-one-derived-flag-one-notice-at-a-time-and-a-way-to-take-the-disk-version)

### S-10: `App` host-event handling — Re-scoped

**Target state.** `App`'s `useHostEvents` handler calls `docs.syncWithDisk()` on `documents-changed`. A new effect calls
it whenever `connected` becomes true. The existing chat recheck is unchanged.

**Behavior.** Changing. The browser catches up with disk on every event and every connect. Settled by the run per D-16.

**Why.** Events sent while the socket is down are lost
([C-7](artifacts/current-state-findings.md#c-7-the-browser-reconnects-every-second-with-no-replay-and-no-first-versus-reconnect-signal)).

**Depends on.** S-3, S-8.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-sync-on-the-event-on-every-socket-connect-and-at-the-end-of-restore-the-list-is-latest-wins)

### S-11: `Editor` notices — Re-scoped

**Target state.** The `Editor` component in `documents.tsx` shows at most one disk notice for the current file. "Not on
disk" takes precedence over "changed on disk". It also shows the "Could not load the disk version" message when the
button's call fails. All wording is as pinned in Target State.

**Behavior.** Changing. New notices can appear above the editor. Settled by the run per D-16.

**Why.** The operator's delete and change scenarios need to be visible when the file has unsaved work
([C-29](artifacts/current-state-findings.md#c-29-the-ai-edit-failure-notice-is-the-existing-pattern-for-a-per-file-message-above-the-editor)).

**Depends on.** S-9.

**Decision.** [D-13](artifacts/change-decision-log.md#d-13-one-stored-disk-flag-one-derived-flag-one-notice-at-a-time-and-a-way-to-take-the-disk-version)

### S-12: `useDocuments().restore` — Re-scoped

**Target state.** `restore(view)` does what it does today, then calls `syncWithDisk()` as its last step.

**Behavior.** Changing. After a page reload, open files and restored drafts are checked against disk. A fresh workspace
now makes two list requests on load instead of one. Settled by the run per D-16.

**Why.** Restored drafts are never compared with disk today
([C-27](artifacts/current-state-findings.md#c-27-restore-tracks-stored-unsaved-files-before-its-first-await-and-never-checks-them-against-disk)).

**Depends on.** S-8.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-sync-on-the-event-on-every-socket-connect-and-at-the-end-of-restore-the-list-is-latest-wins)

## Behavior Changes

Every entry except S-13 changes something observable. The run decided each one itself, per the operator's standing
preference ([D-16](artifacts/change-decision-log.md#trivial-decisions)).

- **The Documents pane follows disk.** Files and folders created, changed, or deleted by git or another app appear or
  disappear within a moment, without a page reload. The same happens after a reconnect or a page reload. While
  something keeps writing inside the workspace, the pane still refreshes about once a second. (S-1, S-2, S-3, S-4, S-6,
  S-8, S-10, S-12)
- **An open file with no unsaved changes follows disk, and keeps its scroll position.** A git revert or another app's
  edit shows up in the editor in place, and the passage at the top of the view stays there. (S-5, S-8)
- **Undo forgets history at a disk update.** Right after a file updates from disk, Ctrl-Z has nothing to undo in it.
  This stops Undo from bringing back reverted text. (S-5)
- **An open file with no unsaved changes closes when it is deleted on disk,** like an in-app delete. It closes only
  after the server confirms the file is gone. (S-8)
- **An open file with unsaved changes is never overwritten by disk.**
  - If its disk copy changes, a notice says "`{name}` changed on disk. Save overwrites it." and offers "Use the disk
    version", which discards the unsaved edits without asking.
  - If its disk copy is deleted, or renamed by another app, a notice says "`{name}` is not on disk. Save creates it."
    The same notice now also shows for an AI-created post that has never been saved.

  (S-9, S-11)
- **A second Save during a running Save does nothing extra.** Anything typed after the first Save read the file stays
  marked unsaved until you save again. (S-7)
- **The document list no longer fails when a folder vanishes mid-walk.** (S-1)
- **Socket clients receive a new `{"type":"documents-changed"}` message.** (S-3)
- **A fresh page load makes two list requests instead of one.** (S-12)

## Change Units

### Unit 1: The tree walk survives a vanishing folder

**What it does.** It adds `isHiddenName` and uses it in `checkPath` and `listEntries`. It also makes `listEntries`
skip a sub-folder that vanishes mid-walk.

**Delta entries.** S-1.

**How you know it worked.** The existing `documents.test.ts` suite passes. New tests use
`mock.module('node:fs/promises', …)`, which re-exports the real module with a `readdir` that fails for one chosen path.
If a spike shows Bun does not rebind the named import, switch the technique, and record that in the decision log.

- A sub-folder failing with `ENOENT` is left out and the rest is listed.
- A sub-folder failing with `ENOTDIR` is left out and the rest is listed.
- The root failing with `ENOENT` throws.
- A real-filesystem test: a sub-folder with `chmod 000` still throws `EACCES`, which pins that only the two codes are
  swallowed. Skip it when the tests run as root.

### Unit 2: The server announces settled changes

**What it does.** It adds `watchDocuments`, the `HostEvent` member, and the `server.ts` wiring and comments.

**Delta entries.** S-2, S-3, S-4.

**Ordering constraint.** After Unit 1, which adds `isHiddenName`.

**How you know it worked.** New tests in `documents.test.ts` against a `mkdtemp` workspace
([C-30](artifacts/current-state-findings.md#c-30-the-test-fixtures-needed-already-exist)).

Waits are polled every 10 ms for up to 2 s, never fixed sleeps. "Exactly once" is asserted after a further 400 ms of
quiet. `close()` runs in `afterEach`, before the folder is removed.

- Writing one file calls `onSettled` exactly once.
- Fifty writes started together call it exactly once.
- A write under `.3pitor/`, then a write of a visible file, calls it exactly once.
- Deleting a folder with files calls it exactly once.
- Writing a file every 50 ms for 1.5 s calls it at least once before the writes stop.
- `close()` with a timer pending stops further calls.
- `close()` after a call stops further calls.

The UI ignores the new event, so the app behaves as before.

### Unit 3: Failed requests carry their status; the list is latest-wins; Save runs at most once at a time

**What it does.** It adds `status` to `api()`'s error, makes `refreshList` sequenced and returning, adds `listRef`, and
reorders Save and joins a running one through `entry.saving`.

**Delta entries.** S-13, S-6, S-7.

**How you know it worked.** New tests in `documents.test.tsx` with the fake documents API. A small gate helper lets a
test hold one request open. Existing tests pass.

- An older list response arriving last does not replace a newer one, in `listed` or `onDisk`.
- A second Save during the first sends no second PUT.
- `saved` holds the sent content as soon as the PUT resolves, before the list reload.
- A rejected PUT, then another Save, sends a PUT. A sync afterwards does not skip the file.
- `api()` rejects with `status === 404` for a missing file.

### Unit 4: `replaceMarkdown`

**What it does.** It extracts `applyMarkdown` and adds `replaceMarkdown`.

**Delta entries.** S-5.

**How you know it worked.** New tests in `markdown-editor.test.tsx`, on a mounted editor. The existing `mergeMarkdown`
tests pass unchanged, including the one-undo-after-an-AI-edit test.

- Replacing with text that removes a paragraph removes it.
- The `.ProseMirror` element is the same element before and after a replace.
- Paragraphs that did not change keep the same DOM nodes.
- Type text, replace, then Ctrl-Z: the text still equals the replacement. This fails if `clear()` is dropped.
- Replace, then Ctrl-Z: the text still equals the replacement. This fails if the replace is tracked.

### Unit 5: The browser follows disk

**What it does.** It adds `forget` (and routes `remove()` through it), `followDisk`, `syncOnce`, and the coalesced
`syncWithDisk`. It also wires the sync into `restore`, `App`'s event handler, and the connect effect.

**Delta entries.** S-8, S-10, S-12.

**Ordering constraint.** After Units 2, 3, and 4: it consumes the event type, the error status, the latest-wins list,
Save's `saving`, and `replaceMarkdown`.

**How you know it worked.** New tests in `documents.test.tsx` and `app.test.tsx`. `App` tests drive `FakeSocket` with
`{ type: 'documents-changed' }` and count `GET /api/documents` in the fake API's requests. The existing fresh-workspace
test's expected requests change to two list GETs (D-11).

- A clean open file whose disk text changed shows the new text and is not unsaved.
- A clean open file whose disk text removes a paragraph loses that paragraph.
- A clean open file deleted on disk closes, and its highlights clear.
- A clean open file missing from the list but still readable stays open.
- An AI-created post that was never saved stays open after a sync.
- An unsaved file whose disk text changed keeps its text and is flagged.
- An unsaved file whose disk text returns to the saved text is unflagged.
- A file closed and reopened while its read was in flight is not touched by that read.
- A file whose save started while its read was in flight is not flagged.
- A read that fails for one file still syncs the others.
- A `replaceMarkdown` that throws leaves `saved` as it was, and the next sync retries.
- Three sync calls during a run produce exactly one more run.
- A sync whose list request fails resolves. The next sync runs fully.
- A new file or folder created on disk appears in the list after an event, including inside an expanded folder.
- A sync runs once on connect, and again after a drop and reconnect.
- A reload restores a draft and then checks it against disk.

### Unit 6: Notices and taking the disk version

**What it does.** It adds `diskChanged`, `onDisk`, `takeDiskVersion`, and the `Editor` notices.

**Delta entries.** S-9, S-11.

**Ordering constraint.** After Unit 5.

**How you know it worked.** New tests in `documents.test.tsx`.

- An unsaved file whose disk text changed shows "changed on disk" and the button. Pressing it replaces the text and
  clears unsaved.
- An unsaved file deleted on disk shows only "is not on disk", and Save recreates it with its folder.
- `onDisk` is `true` before the first list lands.
- A failed "Use the disk version" shows "Could not load the disk version".

### Unit 7: Manual check in the built app

**What it does.** It confirms the scroll requirement and the operator's scenarios where no unit test can reach: real
browsers and a real git.

**Delta entries.** None.

**Ordering constraint.** After Unit 6, against `make build`.

**How you know it worked.** In Safari and Chrome, in rendered and raw mode, with a long file open and scrolled halfway,
the passage at the top of the view stays at the top
([D-18](artifacts/change-decision-log.md#d-18-keep-my-scroll-position-means-the-passage-at-the-top-of-the-view-stays-put-in-both-modes))
through each of these:

- a `git checkout` of that file updates it in place
- another editor's save does the same
- creating a file and a folder from Finder shows them in the pane
- deleting the folder closes the file, or flags it if unsaved

## Risks

- **The scroll position could still move in one browser or in raw mode.** The plan relies on the library's scroll
  preservation and has no code of its own
  ([D-12](artifacts/change-decision-log.md#d-12-rely-on-the-editor-library-to-keep-the-scroll-position)). Unit 7
  detects it, and the deferred anchor code is the fix.
- **A partly written file can be read mid-write**
  ([C-13](artifacts/current-state-findings.md#c-13-the-apps-own-save-is-an-in-place-overwrite-while-its-state-writes-are-temp-file-and-rename)).
  This happens when another app writes in place and pauses for more than 100 ms partway. A clean open file could then
  show the short version until the write's next event. If the writer types in that window, the file becomes unsaved,
  and the next sync flags it as changed on disk rather than overwriting silently. Blast radius: one file.
- **The watcher can stop with no signal in the app.** A logged watcher error may end watching. A deleted or renamed
  workspace root produces no event and no error at all; the on-call review measured that. Either way the pane stops
  following disk until the server restarts
  ([D-4](artifacts/change-decision-log.md#d-4-start-the-watcher-in-serverts-guard-its-callback-log-its-errors-and-add-no-shutdown-hook)).
- **Re-reading every open file per event costs one GET per open file.** Every in-app Save now triggers a sync too.
  `opened` never shrinks during a page session, so the cost grows with the files opened since load. It is cheap for a
  handful, unmeasured for many.
- **A hung save or read is not timed out.** `api()` has no timeout. A sync no longer waits on saves, but a hung list or
  file read still holds that sync run, and later events queue behind it.
- **`useDocuments` grows again.** It is already the largest hook
  ([C-8](artifacts/current-state-findings.md#c-8-usedocuments-is-a-380-line-hook-with-about-eight-responsibilities-and-it-alone-holds-the-open-files)).
  Unit 5's blast radius is every documents behavior, which its existing 843-line test file covers.

## Deferred (YAGNI)

### Scroll anchor capture and restore

**Why deferred:** simpler-version test. prosemirror-view already preserves scroll for a change applied in place, through
browser anchoring or its own store-and-restore (D-12). Raw mode keeps the scroller's pixel offset (D-18).

**Reopen when:** the Unit 7 manual check shows the top passage moving in either browser or in raw mode.

**Source:** orchestrator's starting sketch, item 7; software-architect review; junior-developer JD-001.

### `EXTERNAL_ORIGIN` and an origin parameter on `mergeMarkdown`

**Why deferred:** simpler-version test. A `null` origin is already left out of undo (D-7).

**Reopen when:** some code must tell disk changes apart from other changes by their origin.

**Source:** orchestrator's starting sketch, item 5.

### A stored "deleted on disk" state

**Why deferred:** simpler-version test. The list already says it (D-13).

**Reopen when:** the operator wants different wording for "deleted" and "never saved".

**Source:** orchestrator's starting sketch, item 6; research V11.

### A watcher interface for an `@parcel/watcher` fallback, and re-opening the watcher after an error

**Why deferred:** evidence test. One implementation, Bun's watcher passed the local test (D-1), and no watcher error
has been seen.

**Reopen when:** Bun's watcher misbehaves or stops in the built app.

**Source:** research recommendation; on-call OCE-7.

### Changed paths in the event, and filtering non-markdown names

**Why deferred:** evidence test. No measured cost (D-6, D-3).

**Reopen when:** a measured reload storm.

**Source:** research; software-architect review.

### Request timeouts on the sync's reads

**Why deferred:** evidence test. No hung request has been seen. The sync no longer waits on saves, which removed the
likeliest hang (D-9).

**Reopen when:** a workspace on a network, cloud, or removable volume stalls syncing.

**Source:** on-call OCE-2.

### A "Could not update from disk" notice for a clean file

**Why deferred:** evidence test. A failed `replaceMarkdown` leaves `saved` unchanged, so the next sync retries, and an
edit in between turns into a "changed on disk" flag (D-9).

**Reopen when:** a disk update is seen failing repeatedly for one file.

**Source:** on-call OCE-4.

### Splitting `useDocuments`, or extracting a pure disk-decision function

**Why deferred:** evidence test. One consumer (D-8).

**Reopen when:** a second consumer of the open-file registry appears.

**Source:** structural-analyst S10; software-architect review.

### A server-side write queue for `writeDocument`, and a watcher shutdown hook

**Why deferred:** evidence test. Joining a running Save covers one tab, and nothing shuts the server down gracefully
today (D-4, D-10).

**Reopen when:** two-tab saves are reported as conflicting, or graceful shutdown lands.

**Source:** concurrency-analyst K2, K17.

### Tests for the `server.ts` wiring, for `followDisk`'s single-tick update, and for raw-mode scroll under happy-dom

**Why deferred:** evidence test.

- The wiring is a one-line arrow in a file that cannot be imported without starting the server.
- A render-count test would pin implementation, not behavior.
- happy-dom has no layout, so a raw-mode scroll test would assert nothing.

**Reopen when:**

- `server.ts` gains a testable factory
- a flash of "unsaved" after a disk update is reported
- Unit 7 fails in raw mode

**Source:** test-engineer review.

## Cut for Scope

- **An AI turn in progress racing a disk change.** If git reverts a file while the AI is editing it, the AI's edits
  still land on the reverted text. The `loadBase`, `saves`, and turn bases that AI merges use are not adjusted after a
  disk update. Cut because the operator agreed in the confirmation turn to leave this case out (scope boundary,
  Operator-Stated Scope). The operator can reinstate it.

## Open Items

- **External rename of an unsaved file** (non-blocking). The file stays open under its old name with the "not on disk"
  notice, and Save writes it back to the old name
  ([D-15](artifacts/change-decision-log.md#d-15-an-external-rename-of-an-unsaved-file-is-treated-as-a-delete-plus-a-new-file)).
  A writer report of a resurrected file would settle whether rename detection is needed.
- **Two tabs open on one workspace** (non-blocking). Both sync and both write view state. That was true before for view
  state, and the watcher adds more occasions. A report of conflicting tabs would settle it.
- **Where workspaces usually live** (non-blocking). Network shares, iCloud Drive, and removable disks raise the
  watcher-stops and hung-request risks. The answer would decide whether the deferred watcher re-open and request
  timeouts come back.

## Review Findings

One review round ran, at the medium cap, with `junior-developer`, `test-engineer`, and `on-call-engineer`. Every finding
was settled from evidence or by the run's own decision. None stayed open as blocking, and the decisions are in
[artifacts/change-decision-log.md](artifacts/change-decision-log.md).

**Findings that changed the plan:**

- **A failed Save could wedge every later Save and sync of that file.** `saving` is now cleared on both settle paths
  (on-call OCE-1, D-10).
- **A failed disk update looked like success.** `followDisk` now records `saved` only after `replaceMarkdown` succeeds
  (on-call OCE-4, D-9).
- **A sync waiting on a hung Save froze all syncing.** The sync no longer waits on saves (on-call OCE-2, D-9).
- **The coalescer could stick after a failed list request.** It is now pinned in code, in a ref, and never rejects
  (on-call OCE-3, junior-developer JD-006, D-11).
- **A clean file missing from one list closed even if it was only briefly absent.** Closing now needs a 404, and `api()`
  carries the status (on-call OCE-5, junior-developer JD-003, D-9, D-19).
- **Continuous writes could starve the settle timer.** It is now capped at 1 s (on-call OCE-6, D-5).
- **Two notices could show at once, and the button's failure was unspecified.** One notice shows at a time, with a
  failure message (junior-developer JD-004, D-13).
- **Chaining Saves was more than the race needed.** A Save now joins the running one (junior-developer JD-007, D-10).
- **"Keep my scroll" was undefined in raw mode.** D-18 defines it, and Unit 7 checks both modes (junior-developer
  JD-001).
- **The watcher-error wording conflicted, and a root delete is silent.** Risks and D-4 are reconciled (junior-developer
  JD-008, on-call OCE-7).
- **Several tests could not be written as worded, or could not fail.** Unit 1 now names its technique, Unit 2 its
  timing margins, and Unit 4 its discriminating undo probes and `.ProseMirror` identity. Units 5 and 6 add the coalescer,
  identity, `before`-guard, create, read-failure, and restore tests. The existing fresh-workspace request count changes
  (test-engineer).
- **Smaller fixes:**
  - The sync table reads as else-if (JD-010).
  - The `ENOTDIR` cause is stated and tested (JD-009).
  - The `replaceMarkdown` origin is pinned as omitted (test-engineer).
  - `forget` leaves `turnBases` alone (test-engineer).

**Findings that stay unverified** (never blocking):

- Bun's `mock.module` rebinding of a named `node:fs/promises` import.
- ProseMirror's DOM reuse under happy-dom.
- Whether Bun keeps a watcher open after an `error`.
- Real git and editor save timing.

Units 1, 2, 4, and 7 close each of these.

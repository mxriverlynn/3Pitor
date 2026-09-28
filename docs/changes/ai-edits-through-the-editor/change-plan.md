# Change Plan: AI Edits Through the Editor

## Why This Change

The AI writes posts straight to disk today. The user decided it must not.

Every AI read and edit goes through the editor or the app's own code. The AI's edits merge with typing the user does
while it works, and only the UI's Save command writes a file.

This is **a decision already taken**, in the user's own words, recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md). No ticket exists. The same record holds the user's answers
that remove background jobs, open a file the AI edits, and name merging with concurrent typing as the reason for Yjs,
the library that does that merge.

## What Changes, In One Paragraph

After this change, the AI works on a copy of each post held for the length of one reply. That copy starts from what
the user sees in the browser, including unsaved typing. When a reply finishes, the server sends the final text of each
post the AI changed. The browser merges that text into the editor through Yjs, so typing done while the AI worked
survives. The AI's edits show up as unsaved changes, and nothing reaches disk until the user presses Save. The browser
keeps each opened file's unsaved state, so the AI can change several files in one reply. A post the AI creates appears
as an unsaved document. Background jobs and the Allow/Deny approval card are gone.

This departs from the request's wording in one place. The AI's structured output is the final markdown of each edited
file, not Yjs data, and Yjs does the merge in the browser. The model cannot produce Yjs updates. It also has to learn,
while it works, whether each edit matched, and only the server can tell it that ([D-1](artifacts/change-decision-log.md#d-1-edits-run-against-a-per-turn-text-store-on-the-server)), ([D-3](artifacts/change-decision-log.md#d-3-the-server-sends-each-edited-files-final-text-once-in-the-data-session-part)).

The adapter is not a new module. It is the existing file tools and editor code, each with a narrower job ([D-13](artifacts/change-decision-log.md#d-13-no-separate-adapter-module-on-either-side)).

## Current State

Two separate code paths write posts today: the model's `Edit` and `Write` tools ([C-1](artifacts/current-state-findings.md#c-1-the-models-edit-and-write-tools-write-straight-to-disk)), and the document PUT route
behind Save ([C-2](artifacts/current-state-findings.md#c-2-the-document-put-route-is-the-other-disk-write-and-its-path-check-is-weaker-than-the-tools)). `Read` reads disk, so it never sees unsaved typing, and subagents share it ([C-3](artifacts/current-state-findings.md#c-3-the-read-tool-reads-disk-so-it-never-sees-text-typed-but-not-yet-saved)).

In chat, each `Edit` or `Write` waits for an Allow/Deny card ([C-5](artifacts/current-state-findings.md#c-5-edit-and-write-in-chat-wait-for-an-allow-or-deny-answer)). Background jobs run the same tools with no card at all ([C-14](artifacts/current-state-findings.md#c-14-background-jobs-reach-a-precisely-bounded-set-of-files)).

The browser papers over the gap in two ways. Send saves the open file first, so the AI's disk read matches the editor
([C-6](artifacts/current-state-findings.md#c-6-send-saves-the-open-file-first-and-the-message-is-not-sent-when-that-save-fails)). After a turn, the editor reloads the file, or shows "The agent changed this file", and never merges ([C-11](artifacts/current-state-findings.md#c-11-after-a-turn-the-editor-reloads-the-ais-disk-changes-or-shows-a-banner-nothing-merges)).

The document state holds one file at a time, and switching files throws away unsaved edits ([C-10](artifacts/current-state-findings.md#c-10-the-document-state-models-one-open-file-and-switching-files-throws-away-unsaved-edits)). A save that
finishes after a switch updates the wrong file's state ([C-12](artifacts/current-state-findings.md#c-12-save-and-open-apply-their-results-to-whichever-file-is-open-when-they-finish)).

The structural property this change addresses is that **no single owner decides what reaches disk**, and the AI's
changes arrive as a disk write that the editor must reconcile after the fact.

Five properties of today's code and libraries shape the target:

- The server keeps the chat history, and the browser sends only the new message's text ([C-7](artifacts/current-state-findings.md#c-7-the-server-keeps-the-chat-history-and-the-ui-sends-only-the-newest-messages-text)).
- The AI SDK could run tools in the browser, but this app cannot resume a turn with a tool result ([C-8](artifacts/current-state-findings.md#c-8-the-ai-sdk-can-hand-a-tool-call-to-the-browser-but-this-apps-turn-model-cannot-resume-one)).
- Tool errors reach the model as results it can react to ([C-9](artifacts/current-state-findings.md#c-9-tool-errors-reach-the-model-as-results-it-can-react-to-not-as-turn-failures)).
- A Yjs fork of the document, edited through markdown, merges cleanly with typing done in the meantime. This run proved
  it with the real libraries, first in a script ([C-19](artifacts/current-state-findings.md#c-19-a-yjs-fork-of-the-document-edited-through-markdown-merges-with-typing-done-meanwhile)), then through a live editor in the UI tests' simulated
  browser ([C-21](artifacts/current-state-findings.md#c-21-the-merge-works-through-a-live-editorview-in-happy-dom-and-undo-groups-it-with-recent-typing-unless-capture-is-stopped)).
- Undo groups the AI's merge with recent typing unless the merge marks a boundary ([C-21](artifacts/current-state-findings.md#c-21-the-merge-works-through-a-live-editorview-in-happy-dom-and-undo-groups-it-with-recent-typing-unless-capture-is-stopped)).

## Target State

**Server: the AI edits a per-turn text store.** `Sessions.chat` builds a `TurnTexts` from the documents the browser
sent. The file tools read and change that store, never disk ([D-1](artifacts/change-decision-log.md#d-1-edits-run-against-a-per-turn-text-store-on-the-server)). When the turn completes, the server writes the
final text of every edited post into the `data-session` part it already sends ([D-3](artifacts/change-decision-log.md#d-3-the-server-sends-each-edited-files-final-text-once-in-the-data-session-part)). A stopped or failed turn sends
nothing to apply ([D-6](artifacts/change-decision-log.md#d-6-a-stopped-or-failed-reply-applies-nothing)).

**Shared: two wire types and one runtime helper.** `src/shared/wire.ts` gains `ChatRequest` and `SessionData`, and it
stays types-only. The check for markdown the editor cannot hold moves to a new `src/shared/markdown-support.ts`, so the
server can refuse those edits too ([D-9](artifacts/change-decision-log.md#d-9-the-ai-cannot-edit-a-post-the-editor-cannot-hold)).

**Browser: a Yjs document per opened file.** `useDocuments` keeps a registry of Yjs documents, one per file opened
([D-4](artifacts/change-decision-log.md#d-4-the-browser-keeps-a-yjs-document-for-every-file-opened-and-switching-files-keeps-unsaved-edits)). At Send, it hands `Chat` the markdown of each editable document and records the Yjs state it came from. When
the reply finishes, it shows the right file ([D-14](artifacts/change-decision-log.md#d-14-which-file-is-shown-after-a-reply-that-edited-files)). It then merges each edited file's final text into that file's
live document by forking the recorded state ([D-16](artifacts/change-decision-log.md#d-16-merge-the-ais-final-text-into-the-live-document-by-forking-the-base-the-ai-saw)). Each file succeeds or fails on its own, and a failure is shown
([D-22](artifacts/change-decision-log.md#d-22-each-files-merge-succeeds-or-fails-on-its-own-and-a-failure-is-shown)).

`MarkdownEditor` binds to the open file's Yjs document, and undo comes from `y-prosemirror` ([D-10](artifacts/change-decision-log.md#d-10-undo-is-yjss-and-it-covers-the-ais-edits)). The
AI's merge is always its own undo step ([D-24](artifacts/change-decision-log.md#d-24-the-ais-edit-is-its-own-undo-step)).

| Part | Answerable for after the change | Not answerable for |
| --- | --- | --- |
| `src/server/tools.ts` | The per-turn text store; Read, Edit, Write and Glob against it or disk; refusing posts the editor cannot hold | Writing any file |
| `src/server/sessions.ts` | One turn: building the store, running the model, reporting `edited` on success | Approvals |
| `src/server/sessions.routes.ts` | Parsing `ChatRequest`, and rejecting a malformed `documents` | Anything else |
| `src/server/documents.routes.ts` | The only code that writes a post, on the UI's Save | Unchanged |
| `src/shared/wire.ts` | `ChatRequest`, `SessionData`, `HostEvent` (task and turn-finished only) | Jobs, approvals |
| `src/shared/markdown-support.ts` | `UNSUPPORTED`, `unsupportedMarkdown` | Anything else |
| `src/ui/markdown-editor.tsx` | The schema, parser and serializer, the Yjs binding, undo, and the merge helpers | Which file is open |
| `src/ui/documents.tsx` | The registry, open/save by name, `beginTurn`, `applyEdited`, unsaved marks, `notApplied`, the leave-page warning | Talking to the chat |
| `src/ui/chat.tsx` | Sending `ChatRequest`, and passing a completed turn's `edited` to `onTurnFinished` | Saving files, approvals |
| `src/ui/app.tsx` | Wiring `docs.beginTurn` and `docs.applyEdited` into `Chat` | Jobs, approvals |

### Contract: the chat request body

The chat route takes the message text, optionally the open file's name, and optionally the markdown of every editable
document the browser holds ([D-2](artifacts/change-decision-log.md#d-2-the-chat-request-carries-the-markdown-of-every-document-the-browser-holds)):

- When `documents` is absent, the turn runs with an empty store and reads disk.
- When `documents` is present but not an object whose values are all strings, the route answers
  `400 { "error": "documents must map file names to markdown" }` and runs no turn ([D-21](artifacts/change-decision-log.md#d-21-a-malformed-documents-field-is-rejected-not-ignored)).

```ts
// src/shared/wire.ts
export interface ChatRequest {
  text: string;
  openFile?: string;
  documents?: Record<string, string>; // documents-API name -> markdown
}
```

```json
{
  "text": "Tighten the intro in both posts",
  "openFile": "notes.md",
  "documents": { "notes.md": "# Notes\n\n- one\n- two\n", "garden.md": "# Garden Plan\n\nTomatoes.\n" }
}
```

**Invariant:** for each key, the value is `markdownOf(entry.doc)`, taken in the same synchronous step as
`snapshot(entry.doc)`. The text the AI starts from is therefore exactly the markdown of the base the browser will fork
from. Read-only entries are left out.

### Contract: the per-turn text store and the tools

```ts
// src/server/tools.ts
export interface TurnTexts { texts: Map<string, string>; edited: Set<string> } // keys: post names
export function turnTexts(workspace: string, documents: Record<string, string>): TurnTexts;
export function postName(workspace: string, filePath: string): string; // "./notes.md" -> "notes.md"
export function editedTexts(turn: TurnTexts): Record<string, string>; // in last-changed order
export function fileTools(workspace: string, turn: TurnTexts): { Read; Edit; Write; Glob };
```

`postName` is the workspace-relative path after `resolvePost`. For an existing file, that path has the disk's letter
case, because `realpathSync` returns it ([C-22](artifacts/current-state-findings.md#c-22-under-bun-on-macos-realpathsync-returns-an-existing-files-real-letter-case)). So `Notes.md` and `notes.md` name the same key, and it matches the
name in the browser's registry.

| Tool | Input (unchanged) | Reads | Changes | Result |
| --- | --- | --- | --- | --- |
| `Read` | `{ file_path }` | the store for a post name, else disk | nothing | the text |
| `Edit` | `{ file_path, old_string, new_string }` | the store, else disk | the store; marks edited | `"edited {name}"` |
| `Write` | `{ file_path, content }` | the store, else disk (only to check the old text) | the store; marks edited | `"wrote {name}"` |
| `Glob` | `{ pattern }` | disk | nothing | unchanged |

Marking a post edited deletes and re-adds its key, so `edited` stays in last-changed order.

`Edit` and `Write` throw, and the model sees the error ([C-9](artifacts/current-state-findings.md#c-9-tool-errors-reach-the-model-as-results-it-can-react-to-not-as-turn-failures)), in these cases:

| Case | Error message |
| --- | --- |
| The path is not a post (unchanged) | `{path} is not a markdown post` |
| `old_string` is not found | `old_string not found in {name}` |
| `old_string` is found more than once | `old_string appears {n} times in {name}` |
| The post's current text has markdown the editor cannot hold | `{name} has {kinds}, which the editor can't keep, so it can't be edited here` |
| The new text would add such markdown | `the edit would add {kinds} to {name}, which the editor can't keep` |

In the last two, `{kinds}` is `unsupportedMarkdown(text).join(' and ')` ([D-9](artifacts/change-decision-log.md#d-9-the-ai-cannot-edit-a-post-the-editor-cannot-hold)).

Subagents keep only `Read` and `Glob`, over the same store ([C-4](artifacts/current-state-findings.md#c-4-subagents-can-only-ever-read)).

### Contract: what a finished turn delivers

```ts
// src/shared/wire.ts
export interface SessionData { aborted: boolean; edited: Record<string, string> } // name -> final markdown; {} when aborted
```

```json
{ "type": "data-session", "data": { "aborted": false, "edited": { "notes.md": "# Notes\n\n- one\n- three\n" } } }
```

The server writes this part where it writes `data-session` today. It only reaches that point on a turn that joins the
history ([C-7](artifacts/current-state-findings.md#c-7-the-server-keeps-the-chat-history-and-the-ui-sends-only-the-newest-messages-text)). In the browser, `Chat`'s `onFinish` returns early when `isAbort`, `isError`, or `isDisconnect` is set.
Otherwise it takes the last `data-session` part of the finished message and, when `aborted` is false, calls
`onTurnFinished(data.edited)` ([D-3](artifacts/change-decision-log.md#d-3-the-server-sends-each-edited-files-final-text-once-in-the-data-session-part)). The browser never reads tool parts.

### Contract: the browser's merge

```ts
// src/ui/markdown-editor.tsx
export type Snapshot = { update: Uint8Array; vector: Uint8Array };
export const AI_ORIGIN = 'ai';
export function markdownOf(doc: Y.Doc): string;
export function docFromMarkdown(markdown: string): Y.Doc;
export function snapshot(doc: Y.Doc): Snapshot;
export function mergeMarkdown(live: Y.Doc, base: Snapshot, markdown: string): void;
// internal: WeakMap<Y.Doc, Y.UndoManager>, filled by MarkdownEditor on mount, emptied on unmount

// src/ui/documents.tsx (returned from useDocuments)
beginTurn(): { documents: Record<string, string> };
applyEdited(edited: Record<string, string>): void; // synchronous, no fetch
notApplied: { name: string; message: string }[];
```

`mergeMarkdown(live, base, markdown)` runs in this order:

1. It forks `base.update` into a new `Y.Doc`, and runs `updateYFragment` there with `markdown` parsed.
2. It calls `stopCapturing()` on `live`'s registered undo manager.
3. It applies `encodeStateAsUpdate(fork, base.vector)` to `live` with origin `AI_ORIGIN`.
4. It calls `stopCapturing()` again ([D-24](artifacts/change-decision-log.md#d-24-the-ais-edit-is-its-own-undo-step)).

`applyEdited(edited)` runs in this order:

1. It clears `notApplied`, then opens the file to show ([D-14](artifacts/change-decision-log.md#d-14-which-file-is-shown-after-a-reply-that-edited-files)):
   - the open file, if it is in `edited`;
   - otherwise the last key of `edited`.
2. For each name, each inside its own `try` ([D-22](artifacts/change-decision-log.md#d-22-each-files-merge-succeeds-or-fails-on-its-own-and-a-failure-is-shown)):
   - When the name has an entry and a turn base, it merges from the turn base.
   - When the name has an entry and no turn base, it merges from `entry.loadBase`. The exception is an entry saved
     since `beginTurn`, or created after it and saved since: that name goes to `notApplied`, with "it was saved while
     the AI was working; ask again" ([D-23](artifacts/change-decision-log.md#d-23-a-file-saved-during-the-turn-with-no-base-from-send-is-not-merged-blind)).
   - When the name has no entry, it creates one from the text ([D-7](artifacts/change-decision-log.md#d-7-write-stays-and-a-new-or-replaced-post-opens-unsaved-in-the-editor)).
   - It marks the entry dirty.
   - On a throw, the entry stays as it was, and `{ name, message }` joins `notApplied`.
3. `Editor` shows one line per `notApplied` item: `Could not apply the AI's edit to {name}: {message}`.

## Surface Delta

### S-1: Background jobs — Removed

**Target state.** The app has no background jobs. None of these exist:

- `Jobs`, `JobLimits`, `jobs.routes.ts` or `jobs.test.ts`;
- `POST /api/jobs`, `GET /api/jobs/:id` or `POST /api/jobs/:id/cancel`;
- `Job`, `JobStatus`, or the `job-status` member of `HostEvent`;
- `src/ui/jobs.tsx` or `jobs.css`.

Nothing runs the AI unattended. `MISSING_API_KEY_HELP` says chat won't work, without mentioning jobs.

**Behavior.** Changing. The Background jobs panel and its endpoints are gone. The user decided this in the boundary
record (answer 2).

**Why.** The user's instruction. Jobs were the one path that wrote files with no one watching ([C-14](artifacts/current-state-findings.md#c-14-background-jobs-reach-a-precisely-bounded-set-of-files)).

**Migration.** No replacement. Ask in chat instead.

**Decision.** ([D-12](artifacts/change-decision-log.md#d-12-remove-background-jobs-entirely))

### S-2: `unsupportedMarkdown` and `UNSUPPORTED` — Moved

**Target state.** Both live in `src/shared/markdown-support.ts`, unchanged, in a module with no imports.
`markdown-editor.tsx`, `documents.tsx` and `tools.ts` import them from there. The README says `src/shared/` holds the
wire types and this one runtime helper.

**Behavior.** Preserving. The same function, with the same patterns and output. Only its home changes.

**Why.** The server must refuse edits the editor cannot hold, so the check needs a home both sides can import
([C-13](artifacts/current-state-findings.md#c-13-documents-the-editor-cannot-hold-open-read-only-and-the-check-lives-only-in-the-ui)), ([C-15](artifacts/current-state-findings.md#c-15-wirets-is-the-one-module-both-server-and-ui-import)).

**Migration.** Import from `../shared/markdown-support`.

**Decision.** ([D-9](artifacts/change-decision-log.md#d-9-the-ai-cannot-edit-a-post-the-editor-cannot-hold))

### S-3: `yjs`, `y-prosemirror`, `y-protocols` — Added

**Target state.** `package.json` lists `yjs` `13.6.33`, `y-prosemirror` `1.3.7`, and `y-protocols` `1.0.7` under
`dependencies`, pinned exactly. `y-protocols` is there because `y-prosemirror`'s entry module imports it.

**Behavior.** Preserving in what the app does. The browser bundle grows by these packages, which a slow connection
would notice as page-load time.

**Why.** The merge the user asked for is built on them ([C-19](artifacts/current-state-findings.md#c-19-a-yjs-fork-of-the-document-edited-through-markdown-merges-with-typing-done-meanwhile)).

**Decision.** ([D-17](artifacts/change-decision-log.md#trivial-decisions))

### S-4: Yjs helpers in `markdown-editor.tsx` — Added

**Target state.** `markdown-editor.tsx` exports `Snapshot`, `AI_ORIGIN`, `markdownOf`, `docFromMarkdown`, `snapshot`,
and `mergeMarkdown`, with the signatures and order in [Target State](#contract-the-browsers-merge). They are the only
UI code that touches `yjs` or `y-prosemirror` outside the editor component. `mergeMarkdown` makes the AI's change its
own undo step.

**Behavior.** Preserving on its own. It only adds new functions.

**Why.** This is the merge the user asked Yjs for ([C-19](artifacts/current-state-findings.md#c-19-a-yjs-fork-of-the-document-edited-through-markdown-merges-with-typing-done-meanwhile)), ([C-21](artifacts/current-state-findings.md#c-21-the-merge-works-through-a-live-editorview-in-happy-dom-and-undo-groups-it-with-recent-typing-unless-capture-is-stopped)).

**Depends on.** S-3.

**Decision.** ([D-16](artifacts/change-decision-log.md#d-16-merge-the-ais-final-text-into-the-live-document-by-forking-the-base-the-ai-saw)), ([D-24](artifacts/change-decision-log.md#d-24-the-ais-edit-is-its-own-undo-step))

### S-5: `MarkdownEditor` — Re-scoped

**Target state.** `MarkdownEditor({ doc, readOnly })` shows and edits one `Y.Doc`. Its plugins are:

- `ySyncPlugin(doc.getXmlFragment('prosemirror'))`;
- `yUndoPlugin({ trackedOrigins: [AI_ORIGIN] })`;
- a keymap for y-prosemirror's `undo` and `redo`;
- `exampleSetup({ schema, history: false, menuContent })`, with a menu that has no undo or redo items.

It registers the view's undo manager for `doc` on mount, and removes it on unmount. It has no `markdown`, `version` or
`onChange` props. The caller keys it by file name, so each file gets a fresh view and a fresh undo history. It does not
parse or serialize on each keystroke. It does not know which file it shows.

**Behavior.** Changing:

- the toolbar loses its undo and redo buttons;
- Mod-z can undo an AI edit, as a step of its own;
- undo history resets on each file switch (as it effectively does today).

The user decided this (question 7).

**Why.** `prosemirror-history` cannot see edits that arrive through Yjs ([C-17](artifacts/current-state-findings.md#c-17-the-editors-undo-comes-from-prosemirror-example-setups-history-plugin)).

**Depends on.** S-3, S-4.

**Decision.** ([D-10](artifacts/change-decision-log.md#d-10-undo-is-yjss-and-it-covers-the-ais-edits)), ([D-24](artifacts/change-decision-log.md#d-24-the-ais-edit-is-its-own-undo-step))

### S-6: `useDocuments`, `Files`, `Editor` — Re-scoped

**Target state.** `useDocuments` owns a registry of opened files, `Map<name, Entry>` with
`Entry = { doc: Y.Doc; loadBase: Snapshot; readOnly: boolean; dirty: boolean; savedAt: number }`. It returns:

- `names`: the disk file names;
- `listed`: the union of `names` and the registry's keys;
- `current`, and the entry for it;
- `open(name)`: reuses an entry, or loads the file from disk and records `loadBase`;
- `save(name = current)`: PUTs `markdownOf(entry.doc)` for that name, clears that entry's `dirty`, increments its
  `savedAt`, and refreshes `names` when the name was not in it;
- `create(name)`: unchanged;
- `beginTurn()`;
- `applyEdited(edited)`;
- `notApplied`.

It installs a `beforeunload` warning while any entry is dirty.

`Files` lists `listed` and marks dirty entries. `Editor` shows the current entry through `MarkdownEditor`, the
read-only notice, and the `notApplied` lines. It no longer has the "agent changed this file" banner.

The hook no longer has `content`, `saved`, `version`, `edit`, `changedOnDisk`, or `syncFromDisk`.

**Behavior.** Changing. The user decided each change:

- Switching files keeps unsaved edits (question 3).
- Files show unsaved marks.
- A new post from the AI appears unsaved (question 2).
- Leaving the page with unsaved changes warns (question 5).
- The editor can switch to a file the AI edited (boundary answer 3).
- The reload after each turn and the banner are gone (D-15).
- A failed merge is reported instead of passing silently (D-22, D-23).

**Why.** The single-file state throws away unsaved edits on a switch ([C-10](artifacts/current-state-findings.md#c-10-the-document-state-models-one-open-file-and-switching-files-throws-away-unsaved-edits)). The save state can land on the wrong
file ([C-12](artifacts/current-state-findings.md#c-12-save-and-open-apply-their-results-to-whichever-file-is-open-when-they-finish)). The reload-or-banner step exists only because the AI wrote disk ([C-11](artifacts/current-state-findings.md#c-11-after-a-turn-the-editor-reloads-the-ais-disk-changes-or-shows-a-banner-nothing-merges)).

**Depends on.** S-2, S-4, S-5.

**Decision.** ([D-4](artifacts/change-decision-log.md#d-4-the-browser-keeps-a-yjs-document-for-every-file-opened-and-switching-files-keeps-unsaved-edits)), ([D-7](artifacts/change-decision-log.md#d-7-write-stays-and-a-new-or-replaced-post-opens-unsaved-in-the-editor)), ([D-11](artifacts/change-decision-log.md#d-11-warn-before-leaving-the-page-with-unsaved-changes)), ([D-14](artifacts/change-decision-log.md#d-14-which-file-is-shown-after-a-reply-that-edited-files)), ([D-15](artifacts/change-decision-log.md#d-15-remove-the-reload-after-turn-and-the-agent-changed-this-file-banner)), ([D-16](artifacts/change-decision-log.md#d-16-merge-the-ais-final-text-into-the-live-document-by-forking-the-base-the-ai-saw)), ([D-22](artifacts/change-decision-log.md#d-22-each-files-merge-succeeds-or-fails-on-its-own-and-a-failure-is-shown)), ([D-23](artifacts/change-decision-log.md#d-23-a-file-saved-during-the-turn-with-no-base-from-send-is-not-merged-blind)), ([D-25](artifacts/change-decision-log.md#d-25-the-files-list-shows-disk-files-plus-registry-entries-with-no-new-flag))

### S-7: `TurnTexts`, `turnTexts`, `postName`, `editedTexts` — Added

**Target state.** `tools.ts` exports these four, with the signatures in
[Target State](#contract-the-per-turn-text-store-and-the-tools). `TurnTexts` is a plain record, not a class.
`postName` returns a post's workspace-relative name, in the disk's letter case for an existing file. It throws the same
errors `resolvePost` throws. `turnTexts` drops keys that are not posts.

**Behavior.** Preserving on its own. It only adds new functions.

**Why.** The tools need a text store that holds the user's unsaved view and does not write ([C-1](artifacts/current-state-findings.md#c-1-the-models-edit-and-write-tools-write-straight-to-disk)), ([C-3](artifacts/current-state-findings.md#c-3-the-read-tool-reads-disk-so-it-never-sees-text-typed-but-not-yet-saved)), ([C-22](artifacts/current-state-findings.md#c-22-under-bun-on-macos-realpathsync-returns-an-existing-files-real-letter-case)).

**Decision.** ([D-1](artifacts/change-decision-log.md#d-1-edits-run-against-a-per-turn-text-store-on-the-server))

### S-8: `fileTools` (Read, Edit, Write, Glob) — Re-scoped

**Target state.** `fileTools(workspace, turn)` returns the same four tools with the same input schemas.

- `Read` returns a post's text from `turn` when it is there, and otherwise from disk. Non-post files such as skills
  are read from disk as before.
- `Edit` and `Write` change only `turn`, never disk. They refuse posts the editor cannot hold.
- `Glob` is unchanged.
- `EDIT_TOOLS` does not exist.

No code in `tools.ts` calls `Bun.write`.

**Behavior.** Changing:

- The AI reads unsaved text.
- Its edits never reach disk.
- `Edit` and `Write` report the normalized name.
- There are two new refusals (question 6).

The first two are the user's request.

**Why.** This is the user's core rule ([C-1](artifacts/current-state-findings.md#c-1-the-models-edit-and-write-tools-write-straight-to-disk)).

**Depends on.** S-2, S-7.

**Decision.** ([D-1](artifacts/change-decision-log.md#d-1-edits-run-against-a-per-turn-text-store-on-the-server)), ([D-7](artifacts/change-decision-log.md#d-7-write-stays-and-a-new-or-replaced-post-opens-unsaved-in-the-editor)), ([D-9](artifacts/change-decision-log.md#d-9-the-ai-cannot-edit-a-post-the-editor-cannot-hold))

### S-9: `agentSettings` and the model's instructions — Re-scoped

**Target state.** `agentSettings(options, events, ownerId, turn, writer?)` builds the tools with
`fileTools(options.workspace, turn)`. `Task` subagents get `Read` and `Glob` over the same `turn`. The instructions:

- say edits appear in the editor for the user to review and save;
- describe `Write` as creating or replacing a whole post, which opens unsaved;
- no longer mention denied changes.

**Behavior.** Changing. The model's instructions are different. Nothing else about the call changes.

**Why.** The instructions describe the tools, and the tools' effects changed.

**Depends on.** S-8.

**Decision.** ([D-18](artifacts/change-decision-log.md#trivial-decisions))

### S-10: `ChatRequest` and the chat route body — Added

**Target state.** `ChatRequest` exists in `wire.ts` with the layout in
[Target State](#contract-the-chat-request-body). The chat route:

- reads `text`, `openFile` and `documents` from the body;
- passes `{ text, openFile, documents }` to `Sessions.chat`;
- rejects a malformed `documents` with a 400.

**Behavior.** Preserving at the route for existing callers: a body without `documents` is accepted as before. What an
edit then does changes under S-8, and a caller that sends no `documents` receives the edits only in `data-session`.

**Why.** The server needs the text the user sees ([C-3](artifacts/current-state-findings.md#c-3-the-read-tool-reads-disk-so-it-never-sees-text-typed-but-not-yet-saved)), ([C-6](artifacts/current-state-findings.md#c-6-send-saves-the-open-file-first-and-the-message-is-not-sent-when-that-save-fails)).

**Decision.** ([D-2](artifacts/change-decision-log.md#d-2-the-chat-request-carries-the-markdown-of-every-document-the-browser-holds)), ([D-21](artifacts/change-decision-log.md#d-21-a-malformed-documents-field-is-rejected-not-ignored))

### S-11: `SessionData` and the `data-session` part — Re-scoped

**Target state.** `data-session`'s data is `SessionData`: `{ aborted, edited }`. `edited` is `{}` when `aborted` is
true. The part is written only once the turn has finished, exactly where it is written today.

**Behavior.** Changing. The part carries the edited texts. The "stopped" notice still reads `aborted`.

**Why.** It carries the result to the one browser that asked ([C-7](artifacts/current-state-findings.md#c-7-the-server-keeps-the-chat-history-and-the-ui-sends-only-the-newest-messages-text)).

**Decision.** ([D-3](artifacts/change-decision-log.md#d-3-the-server-sends-each-edited-files-final-text-once-in-the-data-session-part)), ([D-6](artifacts/change-decision-log.md#d-6-a-stopped-or-failed-reply-applies-nothing))

### S-12: `Sessions.chat` — Re-scoped

**Target state.** `chat(sessionId, request: ChatRequest)` does the following:

- builds `turnTexts(workspace, request.documents ?? {})`;
- adds the open-file note exactly as today;
- runs `streamText` with no `toolApproval`;
- on the success path, writes `{ aborted, edited }`.

`Sessions` takes no `Approvals`. Its single-turn guard, abort handling and history rule are unchanged.

**Behavior.** Changing. Edits need no approval, and a finished turn reports its edits. The user decided this
(questions 1 and 4).

**Why.** The turn owns the store's lifetime.

**Depends on.** S-7, S-8, S-9, S-10, S-11.

**Migration.** Callers pass `{ text, openFile, documents }` instead of `(text, openFile)`.

**Decision.** ([D-3](artifacts/change-decision-log.md#d-3-the-server-sends-each-edited-files-final-text-once-in-the-data-session-part)), ([D-5](artifacts/change-decision-log.md#d-5-remove-the-allowdeny-approval-for-ai-edits)), ([D-6](artifacts/change-decision-log.md#d-6-a-stopped-or-failed-reply-applies-nothing))

### S-13: `Chat` — Re-scoped

**Target state.** `Chat` takes these props:

- `sessionId`;
- `openFile`;
- `beginTurn: () => { documents: Record<string, string> }`;
- `onTurnFinished: (edited: Record<string, string>) => void`.

Send calls `beginTurn()` and sends `{ text, openFile, documents }` at once, with no save first. `onFinish` passes a
completed turn's `edited` on, as in [Target State](#contract-what-a-finished-turn-delivers). `Chat` renders no approval
cards and has no `approvals` prop. The empty-state hint still says requests apply to the open file.

**Behavior.** Changing:

- Send no longer saves, and cannot fail on a save.
- The "Could not save" message and the approval cards are gone.
- A completed turn's edits appear in the editor.

The boundary and the user's answers settle these.

**Why.** Only Save may write ([C-6](artifacts/current-state-findings.md#c-6-send-saves-the-open-file-first-and-the-message-is-not-sent-when-that-save-fails)).

**Depends on.** S-6, S-10, S-11.

**Decision.** ([D-2](artifacts/change-decision-log.md#d-2-the-chat-request-carries-the-markdown-of-every-document-the-browser-holds)), ([D-3](artifacts/change-decision-log.md#d-3-the-server-sends-each-edited-files-final-text-once-in-the-data-session-part)), ([D-6](artifacts/change-decision-log.md#d-6-a-stopped-or-failed-reply-applies-nothing)), ([D-8](artifacts/change-decision-log.md#d-8-send-no-longer-saves-the-open-file-first))

### S-14: Approvals — Removed

**Target state.** The app has no tool approvals. None of these exist:

- `Approvals`, `approvals.routes.ts`, `approvals.test.ts`, or `POST /api/approvals/:id`;
- the `approval-request` and `approval-resolved` events, `ClientMessage`, or the socket's approval handling;
- the approval timeout option on `createAgentHost`.

The event socket only sends events. Nothing asks the user before an edit, because an edit is only a change in the
editor.

**Behavior.** Changing. The user decided this (question 1).

**Why.** The approval guarded a disk write that no longer exists ([C-5](artifacts/current-state-findings.md#c-5-edit-and-write-in-chat-wait-for-an-allow-or-deny-answer)).

**Depends on.** S-8, S-13. Remove approvals only once edits no longer reach disk.

**Migration.** No replacement.

**Decision.** ([D-5](artifacts/change-decision-log.md#d-5-remove-the-allowdeny-approval-for-ai-edits))

### S-15: `App` wiring — Re-scoped

**Target state.** `App` wires `docs` into `Chat` through `openFile={docs.current}`,
`beginTurn={docs.beginTurn}` and `onTurnFinished={docs.applyEdited}`. It holds no jobs and no approvals state. Its
host-event handler only keeps the connection dot.

**Behavior.** Changing, through S-1, S-6, S-13 and S-14. It changes nothing of its own.

**Why.** `App` is the only UI wiring file.

**Depends on.** S-1, S-6, S-13, S-14.

**Decision.** ([D-15](artifacts/change-decision-log.md#d-15-remove-the-reload-after-turn-and-the-agent-changed-this-file-banner))

### S-16: `check.ts` scenarios — Re-scoped

**Target state.**

- There are no `job:` scenarios.
- There is no approval step: the scenario `approval: edit is requested, approved over REST, and applied` becomes
  `edit: lands in edited, not on disk`.
- The denied-approval scenario is gone.
- A new scenario, `write: a new post lands in edited, not on disk`, is added.
- Both edit scenarios send `documents` and assert two things: `data-session.edited` holds the expected text, and the
  file on disk is unchanged (or absent).
- A new scenario asserts that a malformed `documents` gets a 400.
- Every other scenario is unchanged.

**Behavior.** Preserving for the app. The check script is a test harness.

**Why.** The check must pin the new rule.

**Decision.** ([D-20](artifacts/change-decision-log.md#trivial-decisions))

### S-17: README — Re-scoped

**Target state.** The README:

- describes AI edits as unsaved changes in the editor;
- has no jobs or approvals text, and no endpoint rows for them;
- documents the chat body's `documents`;
- notes that `src/shared/` holds one runtime helper.

**Behavior.** Preserving. Documentation only.

**Why.** It must stay true.

**Decision.** ([D-20](artifacts/change-decision-log.md#trivial-decisions))

## Behavior Changes

Each item below is something the user will see differently. The user answered each one in this run, or it follows
directly from the request.

1. **Background jobs are gone.** The panel, its three endpoints, and its status events are removed. The API-key help no
   longer mentions them. The user answered: "background jobs go away entirely. remove that section from the UI."
   ([D-12](artifacts/change-decision-log.md#d-12-remove-background-jobs-entirely))
2. **AI edits no longer touch disk.** They appear in the editor as unsaved changes, and Save writes them. This is the
   request itself. ([D-1](artifacts/change-decision-log.md#d-1-edits-run-against-a-per-turn-text-store-on-the-server))
3. **The AI reads what you see.** That includes typing you haven't saved, in any file you have open. This is the
   request itself. ([D-2](artifacts/change-decision-log.md#d-2-the-chat-request-carries-the-markdown-of-every-document-the-browser-holds))
4. **No Allow/Deny card.** The user answered: "remove the card". ([D-5](artifacts/change-decision-log.md#d-5-remove-the-allowdeny-approval-for-ai-edits))
5. **A post the AI creates appears as an unsaved document.** It is listed with an unsaved mark, and it becomes a file on
   Save. The user answered: "New posts start as unsaved documents". ([D-7](artifacts/change-decision-log.md#d-7-write-stays-and-a-new-or-replaced-post-opens-unsaved-in-the-editor))
6. **Switching files keeps each file's unsaved edits,** and the Files list marks unsaved files. The user answered: "Keep
   every file's unsaved edits while the app is open". ([D-4](artifacts/change-decision-log.md#d-4-the-browser-keeps-a-yjs-document-for-every-file-opened-and-switching-files-keeps-unsaved-edits))
7. **Stop, or a failed reply, applies nothing.** The user answered: "Throw the edits away". ([D-6](artifacts/change-decision-log.md#d-6-a-stopped-or-failed-reply-applies-nothing))
8. **Leaving the page with unsaved changes shows the browser's warning.** The user answered: "go with recommended".
   ([D-11](artifacts/change-decision-log.md#d-11-warn-before-leaving-the-page-with-unsaved-changes))
9. **The AI refuses posts with tables, task lists, or raw HTML,** and edits that would add them. The user answered: "go
   with recommended". ([D-9](artifacts/change-decision-log.md#d-9-the-ai-cannot-edit-a-post-the-editor-cannot-hold))
10. **Undo is Yjs's.** Mod-z undoes an AI edit as one step, and the toolbar's undo and redo buttons are gone. The user
    answered: "go with recommendation". ([D-10](artifacts/change-decision-log.md#d-10-undo-is-yjss-and-it-covers-the-ais-edits)), ([D-24](artifacts/change-decision-log.md#d-24-the-ais-edit-is-its-own-undo-step))
11. **Send no longer saves first,** and "Could not save … so the message was not sent" is gone. This reverses the
    tell-ai-the-open-file plan's auto-save. The request's "only time a file is written" rule settles it. ([D-8](artifacts/change-decision-log.md#d-8-send-no-longer-saves-the-open-file-first))
12. **The "agent changed this file" banner is gone, and so is the reload after each turn.** The editor may switch to a
    file the AI edited. The request and boundary answer 3 settle this. ([D-15](artifacts/change-decision-log.md#d-15-remove-the-reload-after-turn-and-the-agent-changed-this-file-banner)), ([D-14](artifacts/change-decision-log.md#d-14-which-file-is-shown-after-a-reply-that-edited-files))
13. **An AI edit that can't be merged is reported** above the editor as "Could not apply the AI's edit to {name}: …",
    and nothing else is lost. Two things produce it: a failed merge, or a file saved while the AI was working that had
    no base from Send. This is a failure path within item 2, so it was not asked separately. ([D-22](artifacts/change-decision-log.md#d-22-each-files-merge-succeeds-or-fails-on-its-own-and-a-failure-is-shown)), ([D-23](artifacts/change-decision-log.md#d-23-a-file-saved-during-the-turn-with-no-base-from-send-is-not-merged-blind))

## Change Units

Each unit leaves `make test` and `bun run check` passing, and updates the README text its own delta touches ([D-20](artifacts/change-decision-log.md#trivial-decisions)).

### Unit 1: Remove background jobs

**What it does.** Deletes the job feature end to end, and rewords the API-key help.

**Delta entries.** S-1, and the jobs parts of S-15, S-16 and S-17.

**How you know it worked.**

- No file imports `jobs` or references `Job`, `JobStatus`, or `job-status`.
- `jobs.test.ts` is deleted.
- The two `job:` scenarios are gone, and the rest pass.
- The page has no Background jobs panel.

### Unit 2: Move the unsupported-markdown check to `src/shared/`

**What it does.** Moves `UNSUPPORTED` and `unsupportedMarkdown` into `src/shared/markdown-support.ts` without changing
them.

**Delta entries.** S-2.

**How you know it worked.** A new `markdown-support.test.ts` pins the three kinds and a plain post. That is the first
test of this function. A read-only document still opens read-only.

### Unit 3: Put the editor on Yjs, with no change to the AI yet

**What it does.**

- Adds the Yjs packages and the merge helpers.
- Rebuilds `MarkdownEditor` on `ySyncPlugin` and `yUndoPlugin`.
- Replaces the single-file state with the registry: open and save by name, unsaved marks, and the leave-page warning.

`syncFromDisk` stays for now, and applies today's rule to **every** entry, not only the open one:

- It reloads a clean entry from disk when the disk text differs.
- It marks a dirty entry "changed on disk", and the banner shows when that entry is open.

The AI still writes disk and still asks for approval, so this unit changes only the editor.

**Delta entries.** S-3, S-4, S-5, S-6 (except `beginTurn`, `applyEdited`, `notApplied`, and removing `syncFromDisk`),
and the editor part of S-15.

**Ordering constraint.** After Unit 2, because the registry reads `unsupportedMarkdown` from its new home.

**How you know it worked.** New tests pass:

- `markdown-editor.test.tsx` mounts `MarkdownEditor` in happy-dom, types through the view, then calls `mergeMarkdown`
  from a snapshot taken before the typing. The rendered text shows both, in the three cases in ([C-19](artifacts/current-state-findings.md#c-19-a-yjs-fork-of-the-document-edited-through-markdown-merges-with-typing-done-meanwhile)):
  - the edit and the typing are in different paragraphs;
  - they are in the same paragraph;
  - the edit adds a paragraph.
- In the same file, a single undo after the merge reverts only the AI's change ([C-21](artifacts/current-state-findings.md#c-21-the-merge-works-through-a-live-editorview-in-happy-dom-and-undo-groups-it-with-recent-typing-unless-capture-is-stopped)).
- A `documents` test switches files and finds the unsaved text still there.
- A `documents` test saves one file while another is open, and only the saved file loses its unsaved mark.
- A `documents` test has the AI change, on disk, a file that is open in the registry but not shown. After
  `syncFromDisk`, that entry shows the new text.

The existing chat tests still pass.

**Transition note.** The toolbar's undo and redo buttons disappear in this unit, before the AI's edits start merging
in Unit 5. Mod-z works throughout.

### Unit 4: The server's per-turn text store, with no change to what the app does

**What it does.**

- Adds `ChatRequest`, `SessionData`, `TurnTexts` and its functions.
- Changes `Read` to use the store.
- Makes `Edit` and `Write` update the store **and still write disk, exactly as today**.
- Writes `edited` into `data-session`.
- Makes the route accept `documents` and reject a malformed one.
- Changes `agentSettings` to take `turn`. The instruction text changes in Unit 5.

The browser does not send `documents` yet, so every turn starts with an empty store and reads disk. That means the app
behaves exactly as today, and nothing unsaved can reach disk.

**Delta entries.** S-7, S-10, S-11, the signature part of S-9, and S-8 and S-12 (without the disk-write removal and
without the approvals removal).

**Ordering constraint.** After Unit 1, so the removed `jobs.ts` is no longer a second caller of `agentSettings` to
update.

**How you know it worked.** Existing tests change with the signatures:

- `sessions.routes.test.ts`: both tests are rewritten, because `Sessions.chat` now takes a `ChatRequest`.
- `sessions.test.ts`: the `turn()` helper passes a `ChatRequest`.
- `tools.test.ts` and `agent.test.ts`: every call passes a `turn`.

New tests pass:

- `tools.test.ts`:
  - `Read` returns sent text over disk.
  - An `Edit` that follows another `Edit` sees the first one.
  - `postName` turns `./notes.md` into `notes.md`, and `Notes.md` into the disk's `notes.md`.
  - `editedTexts` returns keys in last-changed order.
- `sessions.test.ts`: a completed turn's `data-session` carries `edited`, and a stopped turn's carries `{}`.
- `sessions.routes.test.ts`: `documents` is passed through, an absent one is accepted, and a malformed one gets a 400.

### Unit 5: Edits go to the editor, not to disk

**What it does.** This is the cutover.

- `Edit` and `Write` stop writing disk.
- `Edit` and `Write` refuse posts the editor cannot hold.
- `beginTurn`, `applyEdited` and `notApplied` go in, including the rule for which file to show.
- `Chat` sends `documents` and passes a completed turn's `edited` to `onTurnFinished`.
- The pre-send save and its error are removed.
- `syncFromDisk`, `changedOnDisk` and the banner are removed.
- The instructions are rewritten.

**Delta entries.** The remainder of S-6, S-8, S-9, S-13 and S-15, plus the edit, write and 400 parts of S-16.

**Ordering constraint.** After Unit 4. The disk write has to stop in the same unit that starts applying edits in the
editor, or an edit lands twice: once through the reload, and once through the merge. `documents` is first sent here,
in the same unit that stops the disk write, so unsaved text never reaches disk.

**How you know it worked.** No `Bun.write` remains in `tools.ts`. Existing tests are rewritten:

- `tools.test.ts`: the Edit and Write tests assert the store and an unchanged disk.
- `sessions.test.ts`: the allow and deny edit tests assert `edited` and an unchanged disk.
- `agent.test.ts`: the pinned instruction text changes.
- `chat.test.tsx`: the six save-before-send tests are replaced. The empty-state hint test stays.
- `check.ts`:
  - The approved-edit scenario becomes the S-16 edit scenario, still approving, since approvals remain until Unit 6.
  - The denied-edit scenario asserts an unchanged disk.
  - The write and 400 scenarios are added.

New tests pass:

- `tools.test.ts`:
  - `Edit` on a post with a table throws the refusal.
  - `Write` of a new name creates no file.
- `chat.test.tsx`:
  - Send posts `documents` without saving.
  - A completed turn calls `onTurnFinished` with `edited`.
  - A stopped turn, an errored turn, and a disconnected turn do not.
- `documents` tests:
  - `applyEdited` for an unopened name creates a dirty entry.
  - For the open file, it merges and keeps that file open.
  - When several files are edited and none of them is open, it opens the last key.
  - A merge that throws for one of three files leaves the other two merged and dirty, and lists the failed one in
    `notApplied`.
  - A file with no turn base that was saved during the turn is listed in `notApplied` and left unchanged.

### Unit 6: Remove approvals

**What it does.** Deletes the approval feature and the approval UI, now that nothing it guarded reaches disk.

**Delta entries.** S-14, and the approvals parts of S-12, S-13, S-15, S-16 and S-17.

**Ordering constraint.** After Unit 5. Removing approvals earlier would let the AI write disk with no card.

**How you know it worked.**

- `approvals.test.ts` is deleted.
- No file references `Approvals`, `approval-request`, or `ClientMessage`.
- `sessions.test.ts`: the allow and deny edit tests become one test. A turn with an `Edit` completes with no approval
  wait and reports `edited`.
- `check.ts`: the edit scenario runs with no approval step, and the denied-edit scenario is removed.

## Risks

- **Silent loss if a merge fails partway through several files.** Without per-file isolation, one throw would leave an
  earlier file merged but unmarked, and later files unmerged, with no message. D-22 closes this, and Unit 5 has a test
  for it. Blast radius: every multi-file reply. (Risk analyst R1, reasoned rather than reproduced; the fix is cheap
  either way.) ([D-22](artifacts/change-decision-log.md#d-22-each-files-merge-succeeds-or-fails-on-its-own-and-a-failure-is-shown))
- **A file opened and saved during the turn has no safe base.** Merging it from its load-time state could duplicate
  the user's own saved text. D-23 refuses that merge and says so. ([D-23](artifacts/change-decision-log.md#d-23-a-file-saved-during-the-turn-with-no-base-from-send-is-not-merged-blind))
- **`updateYFragment`'s `meta` argument is internal to `y-prosemirror`.** The probes passed
  `{ mapping: new Map(), isOMark: new Map() }` as a cast ([C-19](artifacts/current-state-findings.md#c-19-a-yjs-fork-of-the-document-edited-through-markdown-merges-with-typing-done-meanwhile)). A minor upgrade could change it. The version is
  pinned, and Unit 3's merge test fails first if it breaks. Blast radius: every AI edit.
- **A structurally clean merge can still read badly.** If the user rewrites a sentence while the AI rewrites the same
  sentence, both rewrites survive, interleaved. That is the merge working as designed, and Mod-z undoes the AI's part.
- **The `data-session` part must be in `onFinish`'s message.** The "stopped" notice already reads this part from the
  rendered message, but no test has checked it in `onFinish`. Unit 5's chat tests pin it.
- **Unit 5 is the one unit with a wide blast radius.** It changes what every edit does. Units 3 and 4 exist so that
  Unit 5 mostly removes code and wires one callback.
- **Unsaved work lives only in the page.** The leave-page warning covers closing and reloading the tab, but not a
  browser crash ([D-11](artifacts/change-decision-log.md#d-11-warn-before-leaving-the-page-with-unsaved-changes)).
- **Two unsaved new posts whose names differ only in case.** On a case-insensitive disk, both would save to the same
  file. That needs the AI to create both in separate replies, so it is unlikely. For existing files the case is
  normalized ([C-22](artifacts/current-state-findings.md#c-22-under-bun-on-macos-realpathsync-returns-an-existing-files-real-letter-case)).
- **The new-file box and an AI-created post can share a name.** The box writes its `# name` stub to disk, and `open`
  then reuses the registry entry, so the AI's text survives until Save overwrites the stub. It is unlikely and loses
  nothing.

## Deferred (YAGNI)

### A separate `ai-edits.ts` adapter module in the UI

**Why deferred:** It fails the evidence test. It would have one caller, and it would be a second wiring file against the
README rule that only `app.tsx` wires features ([D-13](artifacts/change-decision-log.md#d-13-no-separate-adapter-module-on-either-side)).

**Reopen when:** a second source of edits to the editor appears.

**Source:** the user's request named an "adapter layer". The software architect weighed it.

### A `TurnTexts` class or interface

**Why deferred:** It fails the simpler-version test. It would have one implementation and one caller, where a record and
three functions do the same job ([D-13](artifacts/change-decision-log.md#d-13-no-separate-adapter-module-on-either-side)).

**Reopen when:** a second tool family needs the per-turn store.

**Source:** software-architect proposal.

### Undo history kept across file switches

**Why deferred:** It fails the evidence test. Nobody asked for it, and today's undo does not survive a switch either
([D-10](artifacts/change-decision-log.md#d-10-undo-is-yjss-and-it-covers-the-ais-edits)).

**Reopen when:** users report losing undo on a switch.

**Source:** software-architect proposal.

### A browser-side unsupported-markdown check in `applyEdited`

**Why deferred:** It fails the evidence test. The server runs the same function on the same text before the model is
told an edit worked, so the path cannot fire ([D-16](artifacts/change-decision-log.md#d-16-merge-the-ais-final-text-into-the-live-document-by-forking-the-base-the-ai-saw)).

**Reopen when:** a second source of edits bypasses `tools.ts`.

**Source:** software-architect proposal; junior-developer JD-011.

## Cut for Scope

- **Hardening the document save route's path check.** The Save route's check that a name stays inside the workspace
  does not follow symlinks, unlike the AI tools' check ([C-2](artifacts/current-state-findings.md#c-2-the-document-put-route-is-the-other-disk-write-and-its-path-check-is-weaker-than-the-tools)). Fixing it would stop a symlink in the workspace from
  letting Save write outside it. The request does not ask for this, and this change does not make it worse. The
  boundary's "keeping the scope of this work as small and tight as possible" cuts it. ([D-19](artifacts/change-decision-log.md#trivial-decisions))
- **Removing the event WebSocket.** With jobs and approvals gone, the socket carries only subagent task events and
  turn-finished events. Removing it would drop the "events connected" dot. The request does not ask for this, and it is
  cut under the same boundary answer.

## Open Items

- **The new-file box still writes a file at once (non-blocking).** Typing a name into the Documents list creates the
  file on disk immediately, with a `# name` heading. That is a direct write that is not the Save command. It is the
  user's own action, not the AI's, so this plan leaves it alone. If the user wants their "only Save writes" rule to
  cover it too, it becomes a small follow-up: `create` would make an unsaved registry entry. That settles this item.

## Review Findings

One review round ran, with `han-core:junior-developer`, `han-core:test-engineer`, and `han-core:risk-analyst`. The
findings that changed the plan:

- **Units 3 and 4 did not leave the app working as claimed.**
  - Unit 3's reload after a turn covered only the open file, so an AI disk edit to another opened file could be
    hidden, then overwritten on Save. It now covers every entry.
  - Unit 4 sent unsaved text that its still-writing `Edit` could put on disk. `documents` is now first sent in
    Unit 5.

  (junior-developer JD-003, JD-004, JD-014)
- **Unit 5 would have broken `bun run check`.** The approved-edit scenario asserts a disk change. Units 5 and 6 now
  rewrite and remove the scenarios explicitly. (junior-developer JD-002; test-engineer §2)
- **Existing tests that break were not named at the unit where they break.** Each unit now lists them.
  (test-engineer §1)
- **The observable merge was tested only as a function.** Unit 3 now mounts the editor in happy-dom. This run
  confirmed that works, and that undo needs a capture boundary ([C-21](artifacts/current-state-findings.md#c-21-the-merge-works-through-a-live-editorview-in-happy-dom-and-undo-groups-it-with-recent-typing-unless-capture-is-stopped)), ([D-24](artifacts/change-decision-log.md#d-24-the-ais-edit-is-its-own-undo-step)). (test-engineer §5)
- **Silent loss on a mid-loop merge failure, and duplicated text for a file saved mid-turn.** These led to D-22 and
  D-23. (risk-analyst R1 and R2; both `Unverified`, since they were reasoned rather than reproduced)
- **A silently dropped `documents` would undo unsaved typing.** It is now a 400 ([D-21](artifacts/change-decision-log.md#d-21-a-malformed-documents-field-is-rejected-not-ignored)). (junior-developer JD-005)
- **An `isNew` flag could not be decided correctly for subfolder posts.** It was removed ([D-25](artifacts/change-decision-log.md#d-25-the-files-list-shows-disk-files-plus-registry-entries-with-no-new-flag)). (test-engineer §4;
  junior-developer JD-012)
- **The headline sections did not say the AI's output is markdown, not Yjs data.** They do now. (junior-developer
  JD-001)
- **Other fixes:**
  - S-3's bundle-size note (JD-010, R5);
  - S-10's classification wording (JD-009);
  - "appears as" for new posts (JD-015);
  - the `y-prosemirror` → `y-protocols` import as evidence for pinning it (JD-013).

Closed by evidence without a change:

- Letter case in post names. `realpathSync` returns the disk's case ([C-22](artifacts/current-state-findings.md#c-22-under-bun-on-macos-realpathsync-returns-an-existing-files-real-letter-case)). (JD-006)
- The "New chat" mid-turn, read-only, and reopen edges. The risk analyst found D-6, D-2 and D-9, and D-4 already
  cover them.

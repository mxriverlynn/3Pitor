# Change Plan: Folder Tree Navigation

## Why This Change

The document list on the left becomes a folder tree you can build and reorganize, and every change you make there
happens on disk. This is a **constraint arriving**: a new requirement the current flat list cannot absorb. The source is
the owner's request of 2026-09-29, recorded word for word in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md).

Today the list shows only the markdown files at the top of the workspace. A file inside a folder never appears, and
nothing in the app can create a folder, rename, move, or delete
([C-1](artifacts/current-state-findings.md#c-1-the-list-endpoint-returns-top-level-md-files-only-with-no-folders),
[C-6](artifacts/current-state-findings.md#c-6-the-routes-can-only-read-and-write-a-file-a-folder-appears-only-as-a-side-effect-of-a-write)).

## What Changes, In One Paragraph

After this change, the server can list the workspace as folders and markdown files. It can also create a file or
folder, rename or move one, count what a folder holds, and delete it, all behind one workspace check shared with the
AI's file tools. The browser shows that list as a tree you expand folder by folder. A "+" menu and a "..." menu on each
row create, rename, move, and delete. You can move an item by dragging it or by choosing "Move to…". A file you have
open keeps its unsaved edits when it or its folder is renamed or moved, because the browser re-files its open-document
state under the new path. Deleting drops those edits, after a confirmation that names them. While the AI is working, the
tree's changes are locked. Nothing opens at startup, and every failed operation shows a message instead of failing
silently.

## Current State

A document's identity is its workspace-relative path, a string like `drafts/soil.md`. That string is the same on every
hop between the browser, the documents routes, and the chat's file tools, which match names by exact string
([C-3](artifacts/current-state-findings.md#c-3-a-documents-name-is-a-workspace-relative-path-string-and-browser-and-server-match-it-by-string-equality)).
Nested paths already survive the trip through the existing routes when the browser encodes them
([C-2](artifacts/current-state-findings.md#c-2-a-name-containing--already-works-through-the-single-segment-route-but-only-when-encoded)).

The structural properties this change has to work around:

- **The list is flat.** `GET /api/documents` returns top-level `.md` names as a bare `string[]` and never reports a
  folder
  ([C-1](artifacts/current-state-findings.md#c-1-the-list-endpoint-returns-top-level-md-files-only-with-no-folders)).
  No shared type describes it
  ([C-14](artifacts/current-state-findings.md#c-14-wirets-has-no-types-for-the-documents-api)).
- **The routes' path check is the weak one.** It checks the path as text only, ignores symlinks, and turns every
  refusal into a 500. The chat tools already have a stronger check, but it lives inside the chat feature
  ([C-4](artifacts/current-state-findings.md#c-4-the-documents-routes-path-check-is-weaker-than-the-chat-tools-check-and-applies-no-post-rule),
  [C-5](artifacts/current-state-findings.md#c-5-the-workspace-confinement-check-lives-in-the-chat-feature)).
- **Failures are silent.** `api()` ignores the response status, so a missing file opens as an empty page, and a server
  error leaves a dialog hanging with no message
  ([C-7](artifacts/current-state-findings.md#c-7-api-ignores-the-response-status-so-a-missing-file-opens-as-an-empty-document)).
- **The browser keys open-file state by name in seven places and cannot re-key it.**
  ([C-8](artifacts/current-state-findings.md#c-8-the-browser-keeps-per-file-state-under-the-name-in-many-places-and-has-no-way-to-re-key-or-drop-it)).
  If a chat turn finishes after a rename, the old name comes back as an unsaved file
  ([C-9](artifacts/current-state-findings.md#c-9-a-chat-turn-that-finishes-after-a-rename-move-or-delete-brings-the-old-name-back)).
- **The chat tools refuse any open document that is not a `.md` file outside dot-folders.** One such name fails every
  chat send
  ([C-10](artifacts/current-state-findings.md#c-10-the-chat-tools-reject-any-open-document-that-is-not-a-md-post-outside-dot-folders)).
- **The list component cannot hold a "..." button.** Each row is a `<button>`, and HTML does not allow a button inside
  a button
  ([C-12](artifacts/current-state-findings.md#c-12-files-is-a-flat-list-of-buttons-with-one-inline-dialog-and-its-css-has-no-hover-or-nesting)).
- **The server answers anyone who can reach the machine.** It listens on every network interface and checks neither
  the `Host` nor the `Origin` header. The security review confirmed this by running it; it is outside the plan's area,
  and the owner chose to leave it as is (see Risks).

## Target State

The server gains a documents domain file that knows the file system and nothing about HTTP. The routes become a thin
mapping from requests to that file and from its errors to status codes. The browser keeps one documents hook and gains
a file-tree component that owns the tree, its menus, its three dialogs, and dragging.

### Server: one workspace check, one domain file, thin routes

`resolveInWorkspace` moves from the chat tools to `src/server/components/workspace-path.ts`, unchanged. Both the chat
tools and the new documents domain file import it from there
([D-4](artifacts/change-decision-log.md#d-4-share-the-workspace-check-from-srcservercomponents)).

`src/server/documents/documents.ts` owns every file-system operation on documents
([D-5](artifacts/change-decision-log.md#d-5-a-documents-domain-file-with-one-error-type)).

```ts
// src/server/documents/documents.ts
export class DocumentError extends Error {
  constructor(readonly reason: 'invalid' | 'not-found', message: string);
}
export function checkPath(path: string, kind: 'file' | 'folder'): void;       // throws DocumentError('invalid')
export async function listEntries(workspace: string): Promise<DocumentEntry[]>;
export async function readDocument(workspace: string, path: string): Promise<string>;
export async function writeDocument(workspace: string, path: string, content: string): Promise<void>;
export async function createEntry(workspace: string, path: string, kind: 'file' | 'folder'): Promise<void>;
export async function moveEntry(workspace: string, from: string, to: string): Promise<void>;
export async function countContents(workspace: string, path: string): Promise<FolderCount>;
export async function deleteEntry(workspace: string, path: string): Promise<void>;
```

**How every operation locates an item.** These three rules hold for every exported function
([D-26](artifacts/change-decision-log.md#d-26-symlinks-are-hidden-and-refused)):

1. Call `checkPath` on every path the function takes, including both `from` and `to` in `moveEntry`.
2. Confine the item's **parent folder** with `resolveInWorkspace`, then append the item's own name. A symlinked folder
   along the way that leads outside the workspace is refused.
3. `lstat` the item itself. If it is a symlink:
   - `readDocument`, `writeDocument`, and `createEntry` refuse it with `DocumentError('invalid')`.
   - `moveEntry` and `deleteEntry` act on the link itself, never on its target.

**The path grammar.** Every path the server accepts from the browser must match it. Every path `listEntries` returns
matches it too ([D-15](artifacts/change-decision-log.md#d-15-the-tree-shows-folders-and-markdown-files-only)).

```
path     = segment *( "/" segment )     ; workspace-relative, "/" separators, no leading or trailing "/"
segment  = 1*char                       ; does not start with ".", contains no "/", "\" or NUL
file     = path whose last segment ends in ".md"
folder   = path
```

| Path | As a file | As a folder |
| --- | --- | --- |
| `drafts/2026/soil.md` | valid | valid |
| `drafts/2026` | invalid (not `.md`) | valid |
| `.claude`, `drafts/.hidden.md` | invalid | invalid |
| `a/../b.md`, `drafts/`, `/notes.md`, `.`, `` (empty) | invalid | invalid |
| `notes.txt` | invalid | valid |

This grammar is strictly narrower than what the chat tools' `resolvePost` accepts. So no name the tree can create or
show can fail a chat send
([C-10](artifacts/current-state-findings.md#c-10-the-chat-tools-reject-any-open-document-that-is-not-a-md-post-outside-dot-folders)).
A domain test asserts that `postName` accepts a sample of names `checkPath` accepts.

**What each operation does.**

- `listEntries` walks the workspace with `readdir` and `Dirent` type checks. It returns every folder and every `.md`
  file, and skips any entry whose name starts with `.`, any non-`.md` file, and any symlink. Paths use `/` separators
  and are sorted with `<`. It never descends into a symlink, so a link loop cannot hang it.
- `readDocument` returns the file's text, or throws not-found.
- `writeDocument` overwrites the file, creating missing parent folders as `Bun.write` does today
  ([C-6](artifacts/current-state-findings.md#c-6-the-routes-can-only-read-and-write-a-file-a-folder-appears-only-as-a-side-effect-of-a-write)).
  That is how Save writes a post the AI created in a new folder.
- `createEntry` makes an empty folder (not recursive), or writes a new file containing `# <name without .md>\n`. It
  refuses if the path already exists, and refuses if the parent folder does not exist
  ([D-6](artifacts/change-decision-log.md#d-6-nothing-overwrites-an-existing-item)).
- `moveEntry` is the one operation behind rename, "Move to…", and dragging. It refuses in these cases
  ([D-21](artifacts/change-decision-log.md#d-21-move-rules)):
  - `from` does not exist (not-found).
  - `to`'s parent does not exist (not-found).
  - `to` already exists (invalid, "already exists").
  - `to` is `from`, or is inside `from`. This is checked by comparing the real path of `from` with the real parent
    folder of `to`, so a case variant or an alias is still caught (invalid).
  - `from` and `to` fail the grammar for the item's kind (invalid).
- `countContents` counts **everything** a delete would remove, including hidden, non-markdown, and symlink entries.
  `files` is every entry under the folder that is not a directory, so a symlink counts as one file. `folders` is every
  directory under it, not counting the folder itself
  ([D-18](artifacts/change-decision-log.md#d-18-the-delete-count-covers-everything-on-disk)).
- `deleteEntry` removes a file, or removes a folder and everything in it. It removes a symlink inside the folder as a
  link, and leaves the link's target alone.

### The routes and their error contract

The existing `GET` and `PUT /api/documents/:name` keep their single URL-encoded segment. New operations are `POST`s
with paths in the JSON body ([D-3](artifacts/change-decision-log.md#d-3-keep-the-encoded-name-segment-new-operations-take-json-bodies)).

| Method and path | Request body | 200 response body |
| --- | --- | --- |
| `GET /api/documents` | none | `DocumentList` (was `{ "documents": string[] }`) |
| `GET /api/documents/:name` | none | `{ "name": "drafts/a.md", "content": "# A\n" }` (unchanged) |
| `PUT /api/documents/:name` | `{ "content": "# A\n" }` | `{ "ok": true }` (unchanged; overwrites an existing file) |
| `POST /api/documents/create` | `{ "path": "drafts/new.md", "kind": "file" }` or `{ "path": "drafts/2026", "kind": "folder" }` | `{ "ok": true }` |
| `POST /api/documents/move` | `{ "from": "ideas.md", "to": "drafts/ideas.md" }` | `{ "ok": true }` |
| `POST /api/documents/count` | `{ "path": "drafts" }` | `{ "files": 3, "folders": 1 }` |
| `POST /api/documents/delete` | `{ "path": "drafts" }` | `{ "ok": true }` |

Each route checks its body with a zod schema before it calls the domain, the way the chat tools already use zod. A body
that fails the schema is a 400.

```ts
const PutBody    = z.object({ content: z.string() });
const CreateBody = z.object({ path: z.string(), kind: z.enum(['file', 'folder']) });
const MoveBody   = z.object({ from: z.string(), to: z.string() });
const PathBody   = z.object({ path: z.string() });   // count, delete
```

Every refusal from a documents route has the body `{ "error": "<a sentence a person can read>" }`, with one of two
statuses. The routes map `DocumentError.reason` to the status in one small helper. Any other exception stays Hono's
plain-text 500 (Hono is the server's web framework)
([D-5](artifacts/change-decision-log.md#d-5-a-documents-domain-file-with-one-error-type)).

| Status | `reason` | When | Example body |
| --- | --- | --- | --- |
| 400 | `invalid` | grammar violation, symlink item, malformed body, target exists, move into own subtree | `{"error":"drafts/ideas.md already exists"}` |
| 404 | `not-found` | source missing, or target's parent folder missing | `{"error":"drafts/old.md was not found"}` |

### Wire types

`src/shared/wire.ts` gains the documents types
([D-2](artifacts/change-decision-log.md#d-2-a-flat-list-of-entries-not-a-nested-tree)).

```ts
// One file or folder in the workspace, by workspace-relative path with "/" separators.
export interface DocumentEntry { path: string; kind: 'file' | 'folder' }
// GET /api/documents: every folder (empty ones too) and every .md file, none starting with "." and no symlinks,
// sorted by `path` with `<`.
export interface DocumentList { entries: DocumentEntry[] }
// POST /api/documents/count.
export interface FolderCount { files: number; folders: number }
// The body of every 4xx from the documents routes.
export interface ApiError { error: string }
```

Take a workspace holding `notes.md`, `ideas.md`, `drafts/2026/soil.md`, an empty `archive/`, `drafts/cover.png`,
`.claude/`, and a symlink `todo.md`. It lists as:

```json
{ "entries": [
  { "path": "archive", "kind": "folder" },
  { "path": "drafts", "kind": "folder" },
  { "path": "drafts/2026", "kind": "folder" },
  { "path": "drafts/2026/soil.md", "kind": "file" },
  { "path": "ideas.md", "kind": "file" },
  { "path": "notes.md", "kind": "file" }
] }
```

### Browser: `api()` reports failures

`api()` throws when the response is not OK. The error's message is the body's `error` sentence when there is one, and
otherwise the body text or `"<status> <statusText>"`
([D-7](artifacts/change-decision-log.md#d-7-api-throws-with-the-servers-sentence)).

The hook's operations do not catch these errors. They reject, and the component that started the operation shows the
message in one of three places
([D-24](artifacts/change-decision-log.md#d-24-where-each-failure-shows)):

| Failed operation | Where the message shows |
| --- | --- |
| create, rename (name dialog) | inside the dialog, which stays open |
| Move to… (move dialog) | inside the dialog, which stays open |
| count, delete (delete confirmation) | inside the dialog. A failed count leaves Delete disabled. |
| open a file, drop a dragged item | one `role="alert"` line at the top of the tree, cleared by the next successful operation |
| save (button or Cmd-S) | the editor's existing `.notice` area, `role="alert"`: "Could not save drafts/a.md: <message>" |

### Browser: `useDocuments` stays one hook and re-files open state on a move

`useDocuments` keeps every name-keyed store, so re-keying stays in one place
([D-8](artifacts/change-decision-log.md#d-8-one-documents-hook-that-re-files-open-state-after-the-server-succeeds)).
Its surface after the change:

```ts
export type Documents = ReturnType<typeof useDocuments>;   // exported for FileTree and its tests

entries: DocumentEntry[]                       // from GET /api/documents; replaces `names`
listed: (DocumentEntry & { onDisk: boolean })[] // entries, plus opened-only files and their missing ancestor folders
current: string | undefined                    // undefined until the user opens a file
createEntry(path: string, kind: 'file' | 'folder'): Promise<void>   // a new file is opened
move(from: string, to: string): Promise<void>
remove(path: string): Promise<void>
countContents(path: string): Promise<FolderCount>
dirtyWithin(path: string): string[]            // open files at or under `path` with unsaved edits
```

**`listed`, worked example.** The disk holds `drafts/` and `notes.md`, and the AI has written `drafts/new/idea.md`,
which is not saved yet. `listed` is:

```ts
[
  { path: 'drafts', kind: 'folder', onDisk: true },
  { path: 'drafts/new', kind: 'folder', onDisk: false },       // implied by the opened-only file
  { path: 'drafts/new/idea.md', kind: 'file', onDisk: false },
  { path: 'notes.md', kind: 'file', onDisk: true },
]
```

Each path appears once. An implied folder that already exists on disk is the disk entry. Items with `onDisk: false`
exist only in the browser. The tree shows them, but gives them no "..." button, and they are not drop targets or
"Move to…" destinations ([D-23](artifacts/change-decision-log.md#d-23-browser-only-items-get-no-actions)). Saving the
file writes it, and its folders, to disk.

Both `move` and `remove` call the server first. They change browser state only after it succeeds, so a failed
operation changes nothing in the browser.

- **`move`** re-inserts the same `Entry` object under each new key that `movedPath` returns. The Yjs document, the
  saved text, the save count, and the unsaved flag all move with it, so unsaved edits survive and the next Save writes
  to the new path. (Yjs is the library that holds each open file's editable text.) `current` and `highlights.file` are
  remapped the same way, and `notApplied` is cleared.
- **`remove`** drops every open file at or under the path from `entries` and `highlights`. Unsaved edits in them are
  discarded ([D-14](artifacts/change-decision-log.md#d-14-deleting-discards-unsaved-edits-after-naming-them)). If the
  current file was among them, `current` becomes `undefined`.
- **Startup** opens nothing. `current` starts `undefined`
  ([D-10](artifacts/change-decision-log.md#d-10-nothing-opens-at-startup)).

`src/ui/documents/components/paths.ts` holds the path helpers the hook and the tree both use
([D-20](artifacts/change-decision-log.md#trivial-decisions)):

```ts
// The path `p` has after moving `from` to `to`, or undefined when the move does not touch it.
export function movedPath(p: string, from: string, to: string): string | undefined;
// True when `p` is `root` or inside it.
export const within = (p: string, root: string) => p === root || p.startsWith(root + '/');
```

Worked example: `movedPath('drafts/2026/soil.md', 'drafts', 'archive/drafts')` returns `'archive/drafts/2026/soil.md'`.
`movedPath('drafts-old.md', 'drafts', 'x')` returns `undefined`.

### Browser: the tree is locked while the AI works

`app.tsx` passes `busy={chat.busy}` to the tree. While it is true, the "+" button, every "..." button, dragging, and
dropping are disabled; opening files still works. No name can change between the moment a chat message is sent and the
moment its edits come back, so the chat's returned names never go stale
([D-9](artifacts/change-decision-log.md#d-9-lock-tree-changes-while-the-ai-works),
[C-9](artifacts/current-state-findings.md#c-9-a-chat-turn-that-finishes-after-a-rename-move-or-delete-brings-the-old-name-back)).

### Browser: the file-tree component

`src/ui/documents/file-tree/file-tree.tsx` (with `file-tree.css` and `file-tree.test.tsx`) exports `FileTree`, which
replaces `Files` ([D-11](artifacts/change-decision-log.md#d-11-a-file-tree-component-folder-with-sibling-buttons-per-row)).
It reads `listed`, `current`, `isDirty`, `open`, `createEntry`, `move`, `remove`, `countContents`, and `dirtyWithin`
from `docs`.

```tsx
export function FileTree({ docs, busy }: { docs: Documents; busy: boolean }): JSX.Element;
```

Each row is an `<li>` holding two sibling buttons, "..." first and then the name, so no button sits inside another.
A folder's `<li>` also holds its children's `<ul>` when expanded.

```tsx
<li className={`row ${active ? 'active' : ''}`} draggable={!busy && onDisk} onDragStart={…} /* folders: onDragOver, onDrop */>
  {onDisk && <button className="more" aria-label={`Actions for ${path}`} aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy}>…</button>}
  <button className="name" aria-expanded={isFolder ? expanded : undefined} onClick={isFolder ? toggle : open}>
    {basename}{isDirty && <span className="unsaved"> (unsaved)</span>}
  </button>
  {isFolder && expanded && <ul>{children}</ul>}
</li>
```

- **Order and nesting.** A function local to the module builds the nesting from `docs.listed`. Inside each folder,
  folders come first, then files, each sorted with `<`. Nested `<ul>` padding gives the indent.
- **Hover** ([D-25](artifacts/change-decision-log.md#trivial-decisions)). The row gets a light `var(--border)`
  background on hover, a neutral tint distinct from the open file's `var(--accent-soft)`. The "..." button is
  `visibility: hidden` until the row is hovered or focused, or its menu is open. Using `visibility` keeps names from
  shifting when it appears.
- **Expanded folders.** A `Set<string>` in `FileTree`. Folders start collapsed and are not remembered across reloads.
  Creating inside a folder expands it, and a move remaps the set with `movedPath`.
- **Menus.** One menu function local to the module serves "+" and every "...". It is a positioned `role="menu"` of
  `role="menuitem"` buttons. It closes on Escape, handled by a `keydown` listener on the menu element, and on a
  `pointerdown` anywhere outside it, handled by a listener on `document`
  ([D-12](artifacts/change-decision-log.md#trivial-decisions)):

  | Opened from | Items |
  | --- | --- |
  | "+" next to Documents | New file, New folder (at the top level) |
  | a folder's "..." | New file, New folder (inside it), Rename, Move to…, Delete |
  | a file's "..." | Rename, Move to…, Delete |

- **Dialogs.** All three are native `<dialog>` elements, always mounted and closed by default, like today's. One state
  value in `FileTree` drives them:

  ```ts
  type Pending =
    | { kind: 'name'; title: string; initial: string; submit: (name: string) => Promise<void> } // new file, new folder, rename
    | { kind: 'move'; path: string }
    | { kind: 'delete'; path: string; count?: FolderCount; unsaved: string[] }
  ```

  - **Name dialog** (new file, new folder, rename; [D-22](artifacts/change-decision-log.md#trivial-decisions)).
    You type one name, not a path. The name is trimmed, and Submit is disabled when it is empty or contains `/`. For a
    file, `.md` is appended when missing. Other grammar refusals, such as a leading `.`, come back from the server and
    show inside the dialog.
  - **Move dialog** ("Move to…"). It lists "Documents (top level)" and every on-disk folder in `docs.listed`, leaving
    out the item itself, anything inside it, and its current parent. Choosing one calls `docs.move`.
  - **Delete confirmation.** For a file it asks "Delete notes.md?". For a folder, Delete stays disabled until the count
    comes back, and then the dialog asks "Delete drafts and everything in it: 3 files and 1 sub-folder?". Counts of one
    are singular ("1 file", "1 sub-folder"). When open files under the path have unsaved edits, it adds "Unsaved
    changes in drafts/soil.md will be lost." Cancel has focus through `autoFocus`.
- **Dragging** ([D-13](artifacts/change-decision-log.md#d-13-move-by-dragging-and-by-move-to)). This uses the browser's
  built-in drag events and adds no library.
  - `onDragStart` keeps the dragged path in `FileTree` state, and also sets it on `dataTransfer` so the browser allows
    the drag. `onDragOver` reads the path from state, because browsers hide `dataTransfer` contents during `dragover`.
  - An on-disk folder row accepts a drop unless it is the dragged item or inside it. Accepting means calling
    `preventDefault()` in `onDragOver`, and showing a `.drop` highlight while hovered.
  - The "Documents" heading accepts a drop to the top level.
  - Dropping on the item's own parent does nothing.
  - Every drop calls `docs.move`, the same as "Move to…".

### Browser: the editor with no file open

`Editor` shows a message centered in the editor area, "Select a file", whenever `docs.current` is `undefined`
([D-10](artifacts/change-decision-log.md#d-10-nothing-opens-at-startup)). The editor bar still renders; Save is
disabled.

### Tests: one fake documents API

`src/ui/components/fake-documents-api.ts` is a test-only fetch fake over `files: Map<string, string>` and
`folders: Set<string>`. It implements the route table above with only the refusals the UI tests use: 404 for a
missing item, and 400 "already exists" for a taken path. It carries no copy of the path grammar; the domain and route
tests own that
([D-19](artifacts/change-decision-log.md#d-19-one-test-only-fake-of-the-documents-api)). It replaces the hand-written
mocks in `documents.test.tsx` and `app.test.tsx`, and it serves `file-tree.test.tsx`.

## Surface Delta

### S-1: `resolveInWorkspace` — Moved

**Target state.** `resolveInWorkspace(workspace, filePath)` and its private helper `realTarget` live in
`src/server/components/workspace-path.ts`. They behave exactly as before. `src/server/chat/tools/tools.ts` imports it
from there. Its five tests live in `src/server/components/workspace-path.test.ts`.

**Behavior.** Preserving. The function body is unchanged, and the chat tools' tests still pass against it. The
symlink fix for documents (S-2) lives in `documents.ts`, not here, so the chat `Read` tool's error text does not change.

**Why.** The documents routes need the same symlink-aware check, and the README puts code shared by two features of one
package in `<package>/components/`.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-share-the-workspace-check-from-srcservercomponents)

### S-2: `src/server/documents/documents.ts` — Added

**Target state.** A domain file with no HTTP imports. It owns:
- the path grammar (`checkPath`) and `DocumentError`;
- the three rules for locating an item: grammar check, parent confinement, and a refusal or link-only action on a
  symlinked item;
- listing, reading, writing, creating, moving, counting, and deleting documents inside the workspace.

All of these are specified under Target State.

**Behavior.** Changing. It adds new operations the owner asked for. It also brings the path grammar and the symlink
refusal to the existing read and write (S-4). Settled by the owner's request, D-17, and D-26.

**Why.** The README requires a domain file for each server feature, and a test against a real temp folder is the
cheapest way to check rename and recursive delete.

**Depends on.** S-1.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-a-documents-domain-file-with-one-error-type),
[D-26](artifacts/change-decision-log.md#d-26-symlinks-are-hidden-and-refused)

### S-3: `DocumentEntry`, `DocumentList`, `FolderCount`, `ApiError` in `src/shared/wire.ts` — Added

**Target state.** The four types in the Wire types section exist in `wire.ts`. The server's list route returns a
`DocumentList`, the count route returns a `FolderCount`, and every 4xx from a documents route has an `ApiError` body.

**Behavior.** Preserving on its own: these are types.

**Why.** Three parties agree on these shapes: the route, the browser hook, and the test fake.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-flat-list-of-entries-not-a-nested-tree)

### S-4: `GET` and `PUT /api/documents/:name` — Re-scoped

**Target state.** Both routes read and write through `readDocument` and `writeDocument`. They return 400
`{ "error": … }` for three kinds of path:
- a path that fails the grammar;
- a path that leaves the workspace through a symlinked folder;
- a path whose file is itself a symlink.

A missing file on GET gets 404 `{ "error": … }`. PUT still overwrites an existing file and still creates missing
parent folders. PUT's body is checked with the `PutBody` schema.

**Behavior.** Changing. Four things differ:
- `../x.md` used to get a plain-text 500 and now gets a 400.
- A path through a symlinked folder leading outside the workspace used to be followed and is now refused with a 400.
- A file that is itself a symlink, wherever it points, used to be read or written through and is now refused with a
  400.
- A PUT to a non-`.md` path or into a dot-folder used to write the file and is now refused with a 400.

The owner accepted the tightening on 2026-09-29 ("recommended", question 7), and the symlink refusal on 2026-09-29
("recommended", symlink question).

**Why.** New delete and move operations must not inherit the weaker check, and one check for all routes is simpler than
two.

**Depends on.** S-2.

**Decision.** [D-17](artifacts/change-decision-log.md#d-17-tighten-the-existing-read-and-write),
[D-26](artifacts/change-decision-log.md#d-26-symlinks-are-hidden-and-refused)

### S-5: `GET /api/documents` — Re-scoped

**Target state.** Returns a `DocumentList` from `listEntries`: every folder and every `.md` file, nested. It skips
anything starting with `.`, non-`.md` files, and symlinks.

**Behavior.** Changing. The body changes from `{ "documents": string[] }` to `{ "entries": DocumentEntry[] }`, and
nested files and folders now appear. A top-level `.md` symlink that used to be listed no longer is. Its only consumers
are `useDocuments` and the two test mocks, which change in the same unit. The owner accepted hiding dot-entries and
non-markdown files on 2026-09-29 ("recommended", question 4), and hiding symlinks ("recommended", symlink question).

**Why.** The tree needs folders, including empty ones.

**Depends on.** S-2, S-3.

**Migration.** Read `entries` (a list of `{ path, kind }`) where you read `documents`.

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-the-tree-shows-folders-and-markdown-files-only),
[D-26](artifacts/change-decision-log.md#d-26-symlinks-are-hidden-and-refused)

### S-6: `POST /api/documents/create`, `/move`, `/count`, `/delete` — Added

**Target state.** Four routes with the request bodies, zod schemas, response bodies, and error contract given in the
route tables above. Each one calls the matching domain function.

**Behavior.** Changing. These are new capabilities the owner asked for. `create` and `move` refuse a taken path with
400 "already exists", and the owner accepted that on 2026-09-29 ("recommended", question 3). The routes are reachable
from any device that can reach the server, as the existing ones are; the owner chose that on 2026-09-29 ("leave it as
is").

**Depends on.** S-2, S-3.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-keep-the-encoded-name-segment-new-operations-take-json-bodies),
[D-6](artifacts/change-decision-log.md#d-6-nothing-overwrites-an-existing-item),
[D-21](artifacts/change-decision-log.md#d-21-move-rules),
[D-27](artifacts/change-decision-log.md#d-27-the-server-stays-reachable-as-it-is-today)

### S-7: `api()` in `src/ui/components/api.ts` — Re-scoped

**Target state.** `api()` returns the parsed JSON body for an OK response. For any other response it throws an `Error`
whose message is the body's `error` field when present, and otherwise the body text or `"<status> <statusText>"`.

**Behavior.** Changing. Opening a missing file used to show an empty page; now the user sees "x.md was not found". A
failed create, save, or other operation shows a message where the table under "Browser: `api()` reports failures"
says, instead of doing nothing. The owner accepted the error messages with question 5 on 2026-09-29. The other callers
are unaffected:
- `app.tsx` creates a session, which answers 201, and 201 counts as OK.
- `chat.tsx` cancels, which always answers with JSON.

**Why.** Every new operation has refusals the user must see ("already exists" is the common one).

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-api-throws-with-the-servers-sentence),
[D-24](artifacts/change-decision-log.md#d-24-where-each-failure-shows)

### S-8: `src/ui/documents/components/paths.ts` — Added

**Target state.** Exports `movedPath` and `within`, as specified under Target State. `useDocuments` and `FileTree` both
use them.

**Behavior.** Preserving on its own: it adds helpers and no behavior.

**Why.** Two users need the same prefix rule, and one copy keeps them from disagreeing about `drafts` versus
`drafts-old.md`.

**Decision.** [D-20](artifacts/change-decision-log.md#trivial-decisions)

### S-9: `useDocuments().names` and `useDocuments().create` — Removed

**Target state.** `names` does not exist. The list from disk is `entries: DocumentEntry[]`. `create` does not exist.
Creating is `createEntry(path, kind)`, which calls `POST /api/documents/create`, refreshes the list, and opens a new
file.

**Behavior.** Changing, through S-6: creating no longer overwrites.

**Depends on.** S-5, S-6.

**Migration.** `docs.names` becomes `docs.entries`, and `docs.create(name)` becomes `docs.createEntry(path, 'file')`.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-one-documents-hook-that-re-files-open-state-after-the-server-succeeds)

### S-10: `useDocuments` — Re-scoped

**Target state.** `useDocuments` owns the workspace's entry list, every open file's state, and the AI-turn bookkeeping,
as before. It also owns re-filing that state when an item is moved and dropping it when an item is deleted.
- `current` is `string | undefined` and starts `undefined`.
- It adds `move`, `remove`, `countContents`, and `dirtyWithin`.
- `listed` becomes `(DocumentEntry & { onDisk: boolean })[]`, as in the worked example.
- Its operations reject with the server's message rather than catching it.
- `Documents`, its return type, is exported.

**Behavior.** Changing. Three things differ:
- Nothing opens at startup (D-10).
- Deleting discards unsaved edits (D-14).
- A rename or move carries unsaved edits to the new path (the owner's request).

The owner decided the startup rule on 2026-09-29: "don't open anything when the app first loads".

**Depends on.** S-7, S-8, S-9.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-one-documents-hook-that-re-files-open-state-after-the-server-succeeds),
[D-10](artifacts/change-decision-log.md#d-10-nothing-opens-at-startup),
[D-14](artifacts/change-decision-log.md#d-14-deleting-discards-unsaved-edits-after-naming-them),
[D-23](artifacts/change-decision-log.md#d-23-browser-only-items-get-no-actions)

### S-11: `useChatSession`'s `openFile` parameter — Re-scoped

**Target state.** `openFile` is `string | undefined`. When it is `undefined`, the chat request carries no `openFile`,
and the server already treats that as no file open (`sessions.routes.ts:14`).

**Behavior.** Preserving. The server's handling of an absent `openFile` is unchanged. The only difference is that the
browser can now be in that state, which S-10 introduces. The AI's first message after startup names no open file, which
is S-10's change.

**Why.** A necessity of D-10: with nothing open, there is no file to name.

**Depends on.** S-10.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-nothing-opens-at-startup)

### S-12: `Files` — Removed

**Target state.** `Files` does not exist in `documents.tsx`. Showing the workspace's documents and changing them is the
job of `FileTree` (S-13).

**Behavior.** Changing, through S-13.

**Depends on.** S-13.

**Migration.** `<Files docs={docs} />` becomes `<FileTree docs={docs} busy={chat.busy} />`.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-a-file-tree-component-folder-with-sibling-buttons-per-row)

### S-13: `FileTree` in `src/ui/documents/file-tree/` — Added

**Target state.** `FileTree({ docs, busy })` renders everything specified under Target State:
- the expandable tree and the hover highlight;
- the "..." and "+" menus;
- the name, move, and delete dialogs;
- dragging;
- the tree's alert line.

Its styles are in `file-tree.css`, and the `.files*` rules and `dialog.new-file` rules leave `documents.css`.

**Behavior.** Changing. This is the owner's requested interface. Tree changes are locked while `busy` (D-9, accepted on
2026-09-29).

**Depends on.** S-8, S-10.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-a-file-tree-component-folder-with-sibling-buttons-per-row),
[D-9](artifacts/change-decision-log.md#d-9-lock-tree-changes-while-the-ai-works),
[D-12](artifacts/change-decision-log.md#trivial-decisions),
[D-13](artifacts/change-decision-log.md#d-13-move-by-dragging-and-by-move-to),
[D-23](artifacts/change-decision-log.md#d-23-browser-only-items-get-no-actions)

### S-14: `Editor` — Re-scoped

**Target state.** `Editor` renders a centered "Select a file" message in the editor area when `docs.current` is
`undefined`, and the editor itself otherwise. It awaits `docs.save()` from the Save button and from Cmd-S, and shows a
failed save in its `.notice` area.

**Behavior.** Changing. At startup you see "Select a file" instead of `notes.md`, which the owner decided on 2026-09-29.
A failed save shows "Could not save …" instead of nothing.

**Depends on.** S-7, S-10.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-nothing-opens-at-startup),
[D-24](artifacts/change-decision-log.md#d-24-where-each-failure-shows)

### S-15: `App` in `src/ui/app.tsx` — Re-scoped

**Target state.** `App` renders `FileTree` with `busy={chat.busy}` where it rendered `Files`. Nothing else in its
wiring changes.

**Behavior.** Preserving, apart from what S-13 brings.

**Depends on.** S-13.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-lock-tree-changes-while-the-ai-works)

### S-16: `src/ui/components/fake-documents-api.ts` — Added

**Target state.** A test-only fetch fake over files and folders. It implements every documents route, with only the
404 and "already exists" refusals. `documents.test.tsx`, `app.test.tsx`, and `file-tree.test.tsx` use it, and neither
of the first two keeps its own mock.

**Behavior.** Preserving. Only tests use it.

**Decision.** [D-19](artifacts/change-decision-log.md#d-19-one-test-only-fake-of-the-documents-api)

## Behavior Changes

The owner answered each of these on 2026-09-29, one question at a time, and each answer is recorded in the decision
log. The observer is the owner using the app, except for item 7, which only someone calling the server directly would
see.

1. **Deleting throws out unsaved edits.** The confirmation names each open file whose unsaved changes will be lost.
   Owner: "unsaved edits are thrown out with deletes"
   ([D-14](artifacts/change-decision-log.md#d-14-deleting-discards-unsaved-edits-after-naming-them)).
2. **You can't change the tree while the AI is working.** "+", "...", and dragging are disabled until the reply
   finishes; opening files still works. Owner: "go with recommended"
   ([D-9](artifacts/change-decision-log.md#d-9-lock-tree-changes-while-the-ai-works)).
3. **Nothing overwrites an existing item.** Creating `notes` when `notes.md` exists used to replace it with a blank
   page. Now it shows "notes.md already exists", and the same applies to rename and move. Owner: "recommended"
   ([D-6](artifacts/change-decision-log.md#d-6-nothing-overwrites-an-existing-item)).
4. **The tree shows only folders and markdown files, and hides names starting with ".".** A folder's delete count still
   includes everything in it. Owner: "recommended"
   ([D-15](artifacts/change-decision-log.md#d-15-the-tree-shows-folders-and-markdown-files-only)).
5. **Nothing opens at startup.** The editor area shows "Select a file". Failed operations, including Save, show a
   message instead of failing silently, and a missing file no longer opens as an empty page. Owner: "don't open
   anything when the app first loads. show a simple message, centered in the editor screen area, that says to select a
   file"
   ([D-10](artifacts/change-decision-log.md#d-10-nothing-opens-at-startup),
   [D-7](artifacts/change-decision-log.md#d-7-api-throws-with-the-servers-sentence),
   [D-24](artifacts/change-decision-log.md#d-24-where-each-failure-shows)).
6. **The AI's conversation keeps old names after a rename.** Asking about `ideas.md` after renaming it gets a
   "can't find" reply until you use the new name. Owner: "recommended"
   ([D-16](artifacts/change-decision-log.md#d-16-the-chat-is-not-told-about-renames)).
7. **The server refuses bad paths with a clear 400.** A path escaping the workspace and a save to a dot-folder or
   non-markdown file are refused. Owner: "recommended"
   ([D-17](artifacts/change-decision-log.md#d-17-tighten-the-existing-read-and-write)).
8. **Symlinks disappear from the list, and can't be opened or saved through.** A `todo.md` shortcut to another folder
   no longer shows. Moving or deleting a folder that holds one moves or deletes the shortcut only. Owner: "recommended"
   ([D-26](artifacts/change-decision-log.md#d-26-symlinks-are-hidden-and-refused)).

One change the review proposed was declined. Locking the server to this computer, and refusing requests from other web
pages, would have stopped other devices and web pages from reaching it. The owner chose "leave it as is"
([D-27](artifacts/change-decision-log.md#d-27-the-server-stays-reachable-as-it-is-today)); see Risks.

## Change Units

Each unit leaves `make test` passing and the app usable. Each unit that adds a module also updates the README's "How
`src/` is laid out" section to name it.

### Unit 1: Share the workspace check

**What it does.** Moves `resolveInWorkspace` to `src/server/components/workspace-path.ts`, and moves its five tests from
`tools.test.ts` to `workspace-path.test.ts`. `tools.test.ts` keeps its `postName` tests, and its import of
`resolveInWorkspace` goes away. The README gains a `src/server/components/` entry.

**Delta entries.** S-1.

**How you know it worked.** `make test-server` passes, with the five `resolveInWorkspace` tests running unchanged from
their new file.

### Unit 2: Documents domain file and the tighter read and write

**What it does.** Adds `documents.ts` with `DocumentError`, `checkPath`, `readDocument`, `writeDocument`, and the
private helper that locates an item under the three rules. It routes `GET` and `PUT /api/documents/:name` through them,
with the `PutBody` schema and the status mapping. The README's `documents/` entry says it now has a domain file.

It also adds `documents.test.ts`, which runs against a temp folder the way `tools.test.ts` does. Its tests cover:
- one table test for the grammar;
- a refused file symlink, both live and dangling;
- a refused symlinked folder leading outside;
- a missing file giving not-found;
- a write that still overwrites and still creates parent folders;
- the check that `postName` returns the same string for sample names `checkPath` accepts, including a nested one and
  one with a space.

A small route test through `app.request` checks the 400 and 404 bodies.

**Delta entries.** S-2 (read and write only), S-4.

**Ordering constraint.** After Unit 1, which provides the shared check.

**How you know it worked.** `make test-server` passes. The file-symlink test fails if `documents.ts` goes back to the
old text-only check.

### Unit 3: Failures become visible, and nothing opens at startup

**What it does.** Makes `api()` throw. `current` becomes optional and starts `undefined`, and the startup `open` is
removed. `Editor` shows "Select a file", and shows a failed save in its notice area. `useChatSession` accepts an
undefined `openFile`. `Files` gains its `role="alert"` line for a failed open, and the new-file dialog shows a failed
create inline. This line and dialog move with `Files` in Unit 4.

The existing tests that relied on `notes.md` opening at startup change in two places:
- In `documents.test.tsx`, a second helper opens `notes.md` after rendering the hook. About seven tests switch to it
  instead of repeating the open.
- In `app.test.tsx`, the "asking about a selection" test clicks `notes.md` before it looks for the editor.

**Delta entries.** S-7, S-11, S-14, and the startup and rejection parts of S-10.

**Ordering constraint.** None beyond Unit 2. It touches only the browser.

**How you know it worked.** `make test` passes. New tests show these:
- `api()` returns the body for a 200.
- `api()` throws the `error` sentence for a 4xx.
- `api()` throws the body text or the status line for a plain-text 500.
- "Select a file" shows on load, and no document GET goes out.
- Opening a missing file shows its error without adding an entry.
- A chat message sent with nothing open carries no `openFile`.
- A failed save shows "Could not save".

### Unit 4: List the workspace as a tree

**What it does.** Adds the wire types, `listEntries`, and the new `GET /api/documents` body. It adds
`fake-documents-api.ts` and moves both UI mocks onto it. It adds `paths.ts`. `names` becomes `entries`, and `listed`
becomes the `onDisk`-marked list. `Files` moves to `file-tree/` as `FileTree`, rendering nested, expandable rows with
the hover highlight. The row keeps today's "+" dialog, and there is no "..." yet. The README gains the `file-tree/` and
`documents/components/` entries.

**Delta entries.** S-3, S-5, S-8, S-12, S-13 (tree and hover only), S-16, and `names` from S-9.

**Ordering constraint.** After Unit 3. The fake's refusals assume `api()` throws.

**How you know it worked.** The tests cover:
- `listEntries` returning the Wire types worked example exactly, with symlinks to a file and to a folder skipped;
- one table test for `movedPath`, including the `drafts` and `drafts-old.md` prefix trap;
- `listed` producing the worked example, with the implied folder marked `onDisk: false`;
- `FileTree` putting folders before files, starting collapsed, expanding on click, and opening a file on click;
- `FileTree` marking a dirty file "(unsaved)", and never nesting a button inside a button.

The existing "+" dialog tests pass unchanged, apart from `names` becoming `entries`.

### Unit 5: Create from the "+" menu and a folder's "..." menu

**What it does.** Adds `createEntry` on the server and the create route. It replaces `create` with `createEntry` in the
hook and adds the menu, the name dialog, and the "..." button. The "..." menu offers New file and New folder on folders
only. `app.tsx` passes `busy`, and the tree locks while it is true.

**Delta entries.** S-6 (create), S-9 (`create`), S-13 (menus, name dialog, lock), S-15.

**Ordering constraint.** After Unit 4.

**How you know it worked.** Checked through the UI:
- "+" → New folder → `drafts` creates an empty folder that shows in the tree.
- A folder's "..." → New file → `soil` creates and opens `drafts/soil.md`.
- Creating an existing name shows "already exists" in the dialog, which stays open.

Checked by tests:
- The menus hold exactly the items in the menu table.
- An `app.test.tsx` test holds a chat reply open with `heldTurn()` and finds "+" and "..." disabled.
- The existing `app.test.tsx` name queries such as `/notes\.md/` are anchored, so they no longer also match the
  "Actions for notes.md" button.

### Unit 6: Rename

**What it does.** Adds `moveEntry`, the move route, `move` in the hook with the re-filing of open state, and Rename in
the "..." menu.

**Delta entries.** S-6 (move), S-10 (`move`), S-13 (Rename).

**Ordering constraint.** After Unit 5, which provides the menu and the name dialog.

**How you know it worked.** The tests cover:
- Renaming a file that has unsaved edits keeps the edits under the new name. Save writes the new path and leaves no
  file at the old one.
- Renaming a folder re-files every open file under it and leaves a sibling with a shared prefix (`drafts-old.md`) alone.
- `current` and highlights follow the rename.
- A refused rename changes nothing in the browser.
- Each move refusal in D-21 holds.
- A case-only rename is exercised on the build machine (see Open Items).

### Unit 7: Delete with confirmation

**What it does.** Adds `countContents`, `deleteEntry`, their routes, `remove`, `countContents`, and `dirtyWithin` in
the hook, and the delete confirmation.

**Delta entries.** S-6 (count, delete), S-10 (`remove`, `dirtyWithin`), S-13 (confirmation).

**Ordering constraint.** After Unit 5.

**How you know it worked.** The tests cover:
- A folder holding hidden, non-markdown, and symlink entries gets exact counts.
- Deleting a folder holding a symlink leaves the symlink's target intact.
- The confirmation for `drafts`, with 3 files and 1 sub-folder, reads exactly as specified, and "1 file" is singular.
- An open file with unsaved edits inside the folder is named in the confirmation and is gone afterward.
- Delete stays disabled while the count is pending.
- Cancel leaves everything as it was.

### Unit 8: Move by dragging and by "Move to…"

**What it does.** Adds the move dialog and "Move to…" in every "..." menu. It also adds dragging: on-disk folder rows
and the "Documents" heading accept drops. Both call `docs.move` from Unit 6.

**Delta entries.** S-13 (move dialog, dragging).

**Ordering constraint.** After Unit 6. It adds no server change.

**How you know it worked.** The tests cover:
- The move dialog leaves out the item, its sub-folders, and its current parent.
- Dragging `ideas.md` onto `drafts` moves it in the fake's files. The drag events carry a stub `dataTransfer`.
- `dragover` on a valid folder is `defaultPrevented`.
- Dropping a folder onto itself, onto its own sub-folder, or onto its own parent sends no move.
- "Move to…" → "Documents (top level)" moves an item back up, using only the keyboard.

## Risks

- **The server is reachable from other devices and from web pages, and now it can delete.** It listens on every
  network interface and checks no `Host` or `Origin` header. That is today's behavior, confirmed by a run in the
  security review. Two paths reach the new delete and move:
  - Someone on the same network can find the port and delete folders permanently.
  - A web page open in your browser can send a delete request blindly. Hono parses a `text/plain` body as JSON, so the
    browser sends no preflight check. The browser half of this was not run.

  The owner chose to leave this as is
  ([D-27](artifacts/change-decision-log.md#d-27-the-server-stays-reachable-as-it-is-today)). The fix, if it is
  reopened, is `hostname: '127.0.0.1'` on `Bun.serve` plus one `/api/*` middleware that refuses a foreign `Host` or,
  on non-GET requests, a foreign `Origin`.
- **Re-filing open state misses a store.** A missed store (highlights, `current`) would leave the editor pointing at a
  path that no longer exists. The busy lock removes the turn stores from the danger. Unit 6's tests cover `current`,
  unsaved state, and highlights for a file and for a folder prefix.
- **Recursive delete removes more than the user expects.** The count includes hidden, non-markdown, and symlink
  entries, so the confirmation understates nothing. The security review ran `rm` with the recursive option on a folder
  holding a link to an outside folder, and only the link was removed. Unit 7 tests this on a real temp folder.
- **Case-only renames on macOS.** Renaming `Notes.md` to `notes.md` on a case-insensitive disk may be refused as
  "already exists". This is an open item below.
- **happy-dom drag and dialog support.** happy-dom is the simulated browser the UI tests run in. The installed version
  has `showModal` and a `DataTransfer` class, but no drag test has been run. The drag tests pass a stub
  `dataTransfer`, and "Move to…" is covered by ordinary clicks. The UI tests cannot check the CSS hover, so they check
  the "..." button's labels and `disabled` state instead.
- **Other code these changes touch.** Units 2 and 4 change server responses. `check.ts` reads only `GET` and `PUT /:name`, whose shapes
  do not change. `useDocuments` has one importer, `app.tsx`.

## Deferred (YAGNI)

Each item failed one of two tests. The **evidence test** asks whether anything needs the item now: the owner's request,
a finding, or code that breaks without it. The **simpler-version test** asks whether something simpler meets the same
need.

### Redirecting an in-flight chat turn's edits to renamed paths
**Why deferred:** simpler-version test. Locking the tree while the AI works satisfies C-9, and the owner chose the lock.
**Reopen when:** the owner reports friction from not being able to reorganize files while the AI works.
**Source:** software-architect A5; owner question 2.

### Splitting `useDocuments` into a list hook and an open-files hook
**Why deferred:** evidence test. Re-filing needs every store at once, and no second user of a split exists.
**Reopen when:** a second feature needs the entry list without the editor state.
**Source:** structural-analyst S-5; software-architect A5.

### A shared post-name rule between `documents` and `chat/tools`
**Why deferred:** simpler-version test. A narrower grammar in `checkPath` plus one test that `postName` accepts it keeps
chat sends safe without changing the chat tools.
**Reopen when:** the chat tools' `resolvePost` rule changes, which the invariant test catches.
**Source:** software-architect A1.

### A separate status code for "already exists"
**Why deferred:** simpler-version test. No browser code branches on status; `api()` passes only the message on.
**Reopen when:** a browser caller needs to tell "already exists" apart from other refusals.
**Source:** junior-developer JD-005.

### Arrow-key tree navigation with ARIA tree roles
**Why deferred:** evidence test. The owner asked for keyboard access for moving, which "Move to…" and ordinary buttons
provide.
**Reopen when:** the owner asks to move through the tree with arrow keys.
**Source:** software-architect A6.

### Remembering expanded folders, and expanding to show the open file
**Why deferred:** evidence test. Not requested.
**Reopen when:** the AI opens a file inside a collapsed folder and the owner can't see which one is open.
**Source:** software-architect A6.

### Actions on items that exist only in the browser
**Why deferred:** evidence test. Such an item is an unsaved AI-created post or its implied folder. Saving puts it on
disk, and then it gets the full menu.
**Reopen when:** the owner needs to rename, move, or discard an unsaved AI-created post from the tree.
**Source:** software-architect A6; junior-developer JD-002.

### A `check.ts` scenario for create, move, and delete, and a fake-versus-server parity test
**Why deferred:** simpler-version test. The domain and route tests run against a real temp folder.
**Reopen when:** a bug passes the UI tests against the fake but fails on the real server.
**Source:** software-architect A6; test-engineer.

### Hardening against a symlink swapped in between check and use
**Why deferred:** evidence test. Swapping a link inside the workspace takes a process running as the same user, which
can already write anything the server can.
**Reopen when:** the server runs as a different user than the one who owns the workspace.
**Source:** adversarial-security-analyst.

### Per-launch secrets, CSRF tokens, or rate limiting on the documents routes
**Why deferred:** evidence test. The bind address and the `Host` and `Origin` check come first, and the owner declined
those.
**Reopen when:** the owner reopens D-27.
**Source:** adversarial-security-analyst.

## Cut for Scope

### Telling the chat about renames
**What it would have done:** after you rename `ideas.md` to `brainstorm.md`, the AI would understand "ideas.md" in a
later message to mean the renamed file.
**Why cut:** it changes how the chat keeps its conversation, and the owner confirmed on 2026-09-29 that the chat's file
tools stay outside this change ([scope-boundary.md](artifacts/scope-boundary.md), Operator-Stated Scope; owner question
6: "recommended").

## Open Items

- **Case-only rename on case-insensitive disks (non-blocking).** On macOS, renaming `Notes.md` to `notes.md` may be
  refused because the target "already exists". Settle it in Unit 6 with a domain test on the build machine. If the test
  shows the refusal, allow the move only when `stat(from)` and `stat(to)` report the same device and inode. A
  letter-case comparison alone would let `a.md` overwrite a different `A.md` on a case-sensitive disk.
- **When `useChat` flips `busy` relative to delivering the finished turn (non-blocking).** If `busy` turns false before
  `applyEdited` runs, a tree change could happen in that gap. Settle it in Unit 5 by reading
  `node_modules/@ai-sdk/react` or with a test that renames right after a turn finishes. If the gap exists, keep the lock
  until `onTurnFinished` has run.

## Review Findings

One review round ran with three reviewers: `han-core:junior-developer`, `han-core:adversarial-security-analyst`, and
`han-core:test-engineer`. Findings that changed the plan:

- **A symlinked file escaped the "symlink escape is refused" promise.** Found by both the junior developer (JD-001) and
  the security analyst (SEC-004), and verified by a run: a dangling link let a write land outside the workspace. The
  fix is the three locating rules, and the owner chose to hide and refuse symlinks (D-26).
- **Items that exist only in the browser offered actions that would fail** (JD-002). They get no "..." button (D-23),
  and PUT keeps creating parent folders.
- **A failed save and several other failures had nowhere to show** (JD-003, test-engineer). Every operation now has a
  named place (D-24).
- **Unit 3 would not leave the suite green as written** (test-engineer). About seven `documents.test.tsx` tests and one
  `app.test.tsx` test relied on `notes.md` opening. Unit 3 now names the helper change. Unit 5 names the `app.test.tsx`
  queries that the "Actions for …" labels would make ambiguous.
- **The server is reachable from other devices and web pages** (SEC-001, SEC-002, SEC-003). Put to the owner, who
  declined the fix (D-27). It is recorded under Risks. SEC-002's browser half is `Unverified`, because no browser was
  driven.
- **Contracts only in prose** (security analyst, test engineer). The body schemas, the rule that every operation checks
  both `from` and `to`, the real-path subtree check, the `Documents` type, the `listed` example, the delete dialog's
  pending count, and the menu's close listeners are now stated in the plan.
- **Simpler versions adopted** (JD-004, JD-005). The fake carries no grammar, and "already exists" is a 400 rather than
  a separate 409.
- **Hover looked the same as the open file** (JD-007). Hover now uses `var(--border)`.
- **README not updated by any unit** (JD-006). Each unit that adds a module now updates it.

The decision log has the reasoning for each one.

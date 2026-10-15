# Change Plan: New Post Instead of New File

## Why This Change

The operator wants the app to manage a blog post as one unit, not as loose markdown files. On disk a post is still a
folder holding a file. The tree's **New file** becomes **New post**. It asks for a working title, makes a folder named
from that title, and puts a `draft.md` in that folder headed with the title as typed. This is a constraint arriving: a new
requirement that the current create path was not built for. It comes from the operator's own request, recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md). This change delivers the first operation that treats a post
as a unit, which is creation. Rename, Move to…, and Delete stay as they are
([D-15](artifacts/change-decision-log.md#d-15-creation-is-the-first-post-level-operation-rename-move-to-and-delete-stay-file-and-folder-operations)).

## What Changes, In One Paragraph

After this change, the engine owns one operation, `createPost`, that makes a whole post. That means a folder named from
the working title and a `draft.md` inside it headed with that title. Only this operation knows a post is laid out that
way ([D-1](artifacts/change-decision-log.md#d-1-a-post-is-made-by-one-engine-operation-behind-its-own-endpoint),
[D-10](artifacts/change-decision-log.md#d-10-createpost-lives-beside-createentry-not-in-a-new-posts-module)). The
browser asks for a post by parent folder and title. It then reveals and opens the path it gets back. Every place that
offered New file now offers New post. The code that made a loose `.md` file is removed from the browser, the server, and
the engine ([D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)). New folder,
Rename, Move to…, and Delete keep working on files and folders. Existing loose `.md` files still show and open.

## Current State

Today, every create is one request that makes one thing, and the server never sees what the writer typed.

- **One request, one item.** New file and New folder send `POST /api/documents/create` with `{ path, kind }`. The
  engine's `createEntry` makes exactly that folder or file
  ([C-1](artifacts/current-state-findings.md#c-1-one-create-request-makes-one-folder-or-one-file-and-never-sees-a-title)).
- **The heading comes from the file name.** A new file starts with `# {cleaned name}`, so the typed text is already lost
  by the time anything is written
  ([C-2](artifacts/current-state-findings.md#c-2-a-new-files-heading-is-its-sanitized-file-name)).
- **The naming rule lives in the browser.** `newEntryName` is under `src/ui/`, where the engine cannot import it. The
  engine's `checkPath` only refuses bad paths
  ([C-3](artifacts/current-state-findings.md#c-3-the-naming-rule-lives-in-the-ui-only)).
- **Nothing undoes a step.** A two-step create that failed halfway would leave an empty folder that blocks the retry
  ([C-6](artifacts/current-state-findings.md#c-6-a-failed-second-step-would-leave-an-empty-folder-that-blocks-a-retry)).
- **The empty editor's New post is New file in disguise.** It runs whatever comes first in the + menu
  ([C-8](artifacts/current-state-findings.md#c-8-the-empty-editors-new-post-button-runs-whatever-is-first-in-the--menu)).

The gap this change closes is that no code knows what a post is. A post is whatever file the writer happened to make.
The pieces the change needs already exist:

- The editor's `markdownSerializer` escapes plain text for a heading
  ([C-4](artifacts/current-state-findings.md#c-4-the-editors-serializer-already-escapes-plain-text-for-a-heading)).
- The file system's `createFolder` refuses a name that is taken, and its `write` and `delete` cover the rest
  ([C-5](artifacts/current-state-findings.md#c-5-filesystemwrite-creates-missing-parent-folders-createentry-refuses-them-on-purpose)).

## Target State

A post is made by one call. Either the call succeeds fully or it leaves nothing behind. Only that call knows a post's
layout.

**`newEntryName`** lives in `src/shared/entry-name.ts`
([D-2](artifacts/change-decision-log.md#d-2-the-naming-rule-moves-to-srcshared-and-becomes-the-folder-rule-only)).

- It turns typed text into a folder name, or `''` when nothing usable is left. The rule is today's folder rule, character
  for character.
- The tree's dialogs use it to switch Create on and off. `createPost` and the test fake use it to name the post's folder.

```ts
export function newEntryName(typed: string): string;
```

**`createPost`** lives in `src/engine/documents/documents.ts`, beside the folder create it builds on.

- It makes a post's folder and the folder's `draft.md`, and resolves to the draft's workspace path.
- It does not open anything, list anything, or know about the browser.

```ts
export async function createPost(fileSystem: FileSystem, parent: string, title: string): Promise<string>;
```

It runs in this fixed order
([D-5](artifacts/change-decision-log.md#d-5-a-failed-draft-write-removes-the-folder-it-just-made)):

1. `name = newEntryName(title)`. If `name` is `''`, refuse with `DocumentError('invalid', '{JSON title} has no characters a folder name can use')`.
2. `folder = parent ? parent + '/' + name : name` and `draft = folder + '/draft.md'`. Run `checkPath(draft, 'file')`.
3. Confirm the parent is a folder, or refuse with `not-found` `{parent} was not found`, as the folder create does today.
4. `fileSystem.createFolder(folder)`, mapped through `asDocument`. A taken name refuses with `{folder} already exists`.
5. `fileSystem.write(draft, draftText(title))`. If this throws, call `fileSystem.delete(folder)`, ignore any failure of
   that delete, and rethrow the write's error mapped as `asDocument` maps it.
6. Resolve to `draft`.

`draftText(title)` is private to the same file
([D-4](artifacts/change-decision-log.md#d-4-the-drafts-heading-is-the-typed-title-escaped-by-the-editors-own-serializer)).
It does three things in order:

1. It turns each run of control characters into one space.
2. It trims both ends.
3. It serializes a level-1 heading with that text through `markdownSerializer`, then adds a newline.

For example, `Why I Love: Rust?` becomes `# Why I Love: Rust?\n`, and `*bold*` becomes `# \*bold\*\n`.

**The wire contract**
([D-3](artifacts/change-decision-log.md#d-3-the-create-post-wire-contract)):

```ts
// src/server/documents/documents.routes.ts — POST /api/documents/create-post
const CreatePostBody = z.object({ parent: z.string(), title: z.string() }); // parent is '' for the top level
// src/shared/wire.ts — the 200 answer
export type CreatedPost = { path: string }; // the draft's workspace path
```

| Request body | Answer |
| --- | --- |
| `{"parent":"Essays","title":"Why I Love: Rust?"}` | 200 `{"path":"Essays/Why I Love Rust/draft.md"}`; the draft holds `# Why I Love: Rust?\n` |
| the same again | 400 `{"error":"Essays/Why I Love Rust already exists"}` |
| `{"parent":"Gone","title":"Hi"}` with no `Gone` folder | 404 `{"error":"Gone was not found"}` |
| `{"parent":"","title":"::"}` | 400 `{"error":"\"::\" has no characters a folder name can use"}` |

**`Engine['documents']`** gains `createPost(parent: string, title: string): Promise<string>`. Its `create(path, kind)`
becomes `createFolder(path: string): Promise<void>`
([D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)).
`POST /api/documents/create` keeps its URL and its `{ ok: true }` answer. Its body becomes
`z.object({ path: z.string(), kind: z.literal('folder') })`
([D-21](artifacts/change-decision-log.md#trivial-decisions)).

**`useDocuments()`** in `documents.tsx` gains `createPost(parent, title): Promise<string>`
([D-8](artifacts/change-decision-log.md#d-8-after-new-post-the-tree-reveals-and-opens-the-new-draft)). It sends the
POST, then runs `refreshList()`, then resolves to the returned path. It opens nothing. `createEntry(path, kind)` becomes
`createFolder(path)`, which sends the POST and then runs `refreshList()`.

**The file tree** offers `New post` and `New folder`, in that order, in the + menu and in each folder's … menu.

- A named `askNewPost(parent)` opens the name dialog. The empty editor's New post calls it by name
  ([D-7](artifacts/change-decision-log.md#trivial-decisions)).
- The dialog's title is `New post`, or `New post in {parent}` when opened from a folder's … menu
  ([D-20](artifacts/change-decision-log.md#trivial-decisions)).
- The dialog's `Pending` name variant changes
  ([D-11](artifacts/change-decision-log.md#d-11-the-new-post-dialog-asks-for-a-working-title-and-the--button-says-new-post-or-folder)):
  - It gains `label`. That is `Working title` for New post, and `Name` for New folder and Rename.
  - Its `submit` becomes `(name: string, typed: string) => Promise<void>`, so New post can send the title as typed.
    New folder and Rename ignore `typed`.
- New post's `clean` is `newEntryName`, so Create stays off while the title cleans to nothing.
- Under the input, one hint line says the folder name a title becomes, or why Create is off
  ([D-17](artifacts/change-decision-log.md#d-17-the-name-dialog-says-what-folder-name-a-title-becomes-and-why-create-is-off)).
- New post's submit runs in this order. First, `await docs.createPost(parent, typed)`; the dialog closes when this
  resolves. Next, `revealPath(path)`. Last, the tree's own `open(path)` wrapper, which sends any failure to the tree's
  alert ([D-13](artifacts/change-decision-log.md#trivial-decisions)).
- `revealPath(path)` comes out of the Find-in-docs effect. It expands every folder above `path` and scrolls the active
  row into view. Find in docs calls it too.
- Refusals show in the dialog's alert, as today
  ([D-6](artifacts/change-decision-log.md#d-6-what-the-new-post-dialog-says-when-it-cannot-make-the-post)).

**The editor bar's** name button is labeled `Show {full path} in Posts` for screen readers, so two drafts are told apart
by their folders
([D-16](artifacts/change-decision-log.md#d-16-the-editor-bars-name-button-names-the-whole-path)).

## Surface Delta

### S-1: `newEntryName` — Moved

**Target state.** `newEntryName` and its test live in `src/shared/entry-name.ts` and `src/shared/entry-name.test.ts`.
`src/ui/documents/file-tree/entry-name.ts` does not exist. `README.md` lists `entry-name.ts` in its `src/shared/`
section.

**Behavior.** Preserving. Same function, same results; only the import path changes.

**Why.** The engine must derive a folder name with the same rule the dialog uses, and it cannot import `src/ui`
([C-3](artifacts/current-state-findings.md#c-3-the-naming-rule-lives-in-the-ui-only)).

**Migration.** `file-tree.tsx` imports from `../../../shared/entry-name`.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-naming-rule-moves-to-srcshared-and-becomes-the-folder-rule-only)

### S-2: `newEntryName` — Re-scoped

**Target state.** `newEntryName(typed: string): string` is the folder rule only. It has no `kind` parameter and never
adds or removes `.md`. A title like `Notes.md` makes a folder named `Notes.md`, as New folder does today
([D-22](artifacts/change-decision-log.md#trivial-decisions)).

**Behavior.** Preserving. Every remaining caller passed `'folder'`, and the folder results are unchanged.

**Why.** Its only `'file'` caller, the tree's New file, is removed (S-14).

**Depends on.** S-1, S-14.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-naming-rule-moves-to-srcshared-and-becomes-the-folder-rule-only)

### S-3: `createPost` in `src/engine/documents/documents.ts` — Added

**Target state.** `createPost(fileSystem, parent, title): Promise<string>` makes the folder `newEntryName(title)` inside
`parent`, plus that folder's `draft.md`, headed with `draftText(title)`. It resolves to the draft's path. It refuses as
Target State lists. When the draft cannot be written, it removes the folder it made.

**Behavior.** Changing: a new way to make things on disk. Settled by the planner; see Behavior Changes.

**Why.** It is the operator's "post as a unit": one operation that owns the post's layout and its undo.

**Depends on.** S-1.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-a-post-is-made-by-one-engine-operation-behind-its-own-endpoint),
[D-4](artifacts/change-decision-log.md#d-4-the-drafts-heading-is-the-typed-title-escaped-by-the-editors-own-serializer),
[D-5](artifacts/change-decision-log.md#d-5-a-failed-draft-write-removes-the-folder-it-just-made),
[D-6](artifacts/change-decision-log.md#d-6-what-the-new-post-dialog-says-when-it-cannot-make-the-post),
[D-10](artifacts/change-decision-log.md#d-10-createpost-lives-beside-createentry-not-in-a-new-posts-module)

### S-4: `Engine['documents'].createPost` — Added

**Target state.** `Engine['documents'].createPost(parent: string, title: string): Promise<string>` exists, wired in
`engine.ts` to `createPost(fileSystem, parent, title)`. It rejects with `DocumentError`, as its siblings do.

**Behavior.** Preserving: no existing caller sees a difference, because the method is new.

**Why.** The server reaches the engine only through `Engine`.

**Depends on.** S-3.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-a-post-is-made-by-one-engine-operation-behind-its-own-endpoint)

### S-5: `POST /api/documents/create-post` and `CreatedPost` — Added

**Target state.** The route takes `{ parent: string, title: string }` and answers 200 with
`CreatedPost = { path: string }`, declared in `src/shared/wire.ts`. Refusals answer `{ error }` with 400 or 404 through
the existing `onError`. The worked example in Target State is the contract. `README.md`'s endpoints table lists the
route.

**Behavior.** Preserving: no existing caller sees a difference, because the endpoint is new.

**Why.** The browser asks for a post once, then opens the path it gets back.

**Depends on.** S-4.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-create-post-wire-contract)

### S-6: `createEntry` in `src/engine/documents/documents.ts` — Re-scoped

**Target state.** The engine's create makes only an empty folder. It has no file branch, writes no heading, and has no
symlink-file check.

**Behavior.** Changing for a request that asks for a file; see S-10.

**Why.** Once New file is gone, nothing makes loose files.

**Depends on.** S-14.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-7: `createEntry` → `createFolder` in `src/engine/documents/documents.ts` — Renamed

**Target state.** The function is named `createFolder(fileSystem, path)`. In every other respect it is as S-6 describes.

**Behavior.** Preserving.

**Why.** The name says what it now does.

**Depends on.** S-6.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-8: `Engine['documents'].create` — Re-scoped

**Target state.** The method takes only a path, and makes an empty folder.

**Behavior.** Preserving for its one caller, the route, which passes only folders after S-10.

**Why.** It follows S-6.

**Depends on.** S-6.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-9: `Engine['documents'].create` → `createFolder` — Renamed

**Target state.** The method is `createFolder(path: string): Promise<void>`.

**Behavior.** Preserving.

**Why.** It matches S-7.

**Depends on.** S-8.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-10: `POST /api/documents/create` body — Re-scoped

**Target state.** The body is `z.object({ path: z.string(), kind: z.literal('folder') })`. The route makes a folder and
answers `{ ok: true }`. A body with `kind: 'file'` answers 400 and creates nothing. `README.md`'s endpoints table
describes the route as "Create an empty folder: `{ path, kind: 'folder' }`".

**Behavior.** Changing: a `kind: 'file'` request now gets a 400. Only this app's browser ever sent one. Settled by the
planner; see Behavior Changes.

**Why.** The operator is moving away from managing raw files. Keeping `kind` as a literal stops a stale request from
quietly making a folder named `x.md`.

**Depends on.** S-9, S-14.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end),
[D-21](artifacts/change-decision-log.md#trivial-decisions)

### S-11: `useDocuments().createPost` — Added

**Target state.** `createPost(parent: string, title: string): Promise<string>` sends `POST /api/documents/create-post`,
then runs `refreshList()`, then resolves to the returned `path`. It opens nothing. A refusal rejects with the server's
sentence.

**Behavior.** Changing: part of New post; see Behavior Changes.

**Why.** The tree needs one call that leaves the new draft listed. Opening is the tree's job, so that an open failure
lands in the tree's alert rather than the dialog.

**Depends on.** S-5.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-after-new-post-the-tree-reveals-and-opens-the-new-draft)

### S-12: `useDocuments().createEntry` — Re-scoped

**Target state.** It makes only a folder: it sends the POST, then runs `refreshList()`. It never opens anything.

**Behavior.** Preserving for its one remaining caller, New folder, which never opened anything.

**Why.** It follows S-6.

**Depends on.** S-14.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-13: `useDocuments().createEntry` → `createFolder` — Renamed

**Target state.** The member is `createFolder(path: string): Promise<void>`.

**Behavior.** Preserving.

**Why.** It matches S-7 and S-9.

**Depends on.** S-12.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-14: The tree's New file item — Removed

**Target state.** No menu in the tree offers New file. Making a post is New post's job (S-15). The app can no longer make
a loose `.md` file.

**Behavior.** Changing; see Behavior Changes.

**Why.** It is the operator's request.

**Depends on.** S-15 (the two land together in Unit 3).

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-15: The tree's New post item and `askNewPost` — Added

**Target state.** The + menu and each folder's … menu list `New post`, then `New folder`. New post keeps the `new-file`
icon ([D-12](artifacts/change-decision-log.md#trivial-decisions)).

`askNewPost(parent)` opens the name dialog with these settings:

- title `New post`, or `New post in {parent}` from a folder's menu;
- input labeled `Working title`;
- action `Create`;
- `clean` set to `newEntryName`.

Its submit does three things in order:

1. It awaits `docs.createPost(parent, typed)`.
2. It calls `revealPath(path)`.
3. It calls the tree's `open(path)` wrapper.

The + button's `aria-label` and `title` read `New post or folder`.

**Behavior.** Changing; see Behavior Changes.

**Why.** It is the operator's request.

**Depends on.** S-11, S-16, S-19.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-after-new-post-the-tree-reveals-and-opens-the-new-draft),
[D-11](artifacts/change-decision-log.md#d-11-the-new-post-dialog-asks-for-a-working-title-and-the--button-says-new-post-or-folder),
[D-6](artifacts/change-decision-log.md#d-6-what-the-new-post-dialog-says-when-it-cannot-make-the-post),
[D-20](artifacts/change-decision-log.md#trivial-decisions)

### S-16: The name dialog and its `Pending` — Re-scoped

**Target state.** The `kind: 'name'` variant carries `label: string`. Its `submit` is
`(name: string, typed: string) => Promise<void>`.

The dialog does three things:

- It calls `pending.submit(pending.clean(draft), draft)`.
- It labels its input with `pending.label`.
- It shows a hint line under the input, as D-17 pins.

**Behavior.** Preserving for New folder's and Rename's submit and label, which pass `'Name'` and ignore `typed`. Changing
in one way: the hint line also shows for New folder, and for a Rename holding `/`. See Behavior Changes.

**Why.** New post needs the title as typed, which `clean` would otherwise throw away. The writer needs to see what folder
name a title becomes.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-the-new-post-dialog-asks-for-a-working-title-and-the--button-says-new-post-or-folder),
[D-17](artifacts/change-decision-log.md#d-17-the-name-dialog-says-what-folder-name-a-title-becomes-and-why-create-is-off)

### S-17: The empty editor's New post trigger — Re-scoped

**Target state.** The tree's effect on `docs.newPosts` calls `askNewPost('')` while Claude is not working. It no longer
depends on the + menu's order.

**Behavior.** Changing: the button now makes a post rather than a loose file. This is the same change as S-15.

**Why.** It removes the positional coupling
([C-8](artifacts/current-state-findings.md#c-8-the-empty-editors-new-post-button-runs-whatever-is-first-in-the--menu)).

**Depends on.** S-15.

**Decision.** [D-7](artifacts/change-decision-log.md#trivial-decisions)

### S-18: `fakeDocumentsApi` — Re-scoped

**Target state.** The fake answers `POST /api/documents/create-post` ahead of its document-name catch-all.

- The post folder is `{parent}/{newEntryName(title)}`, or `newEntryName(title)` at the top level.
- It answers 400 `{post folder} already exists` when that folder exists.
- Otherwise it adds the folder, sets `{post folder}/draft.md` to `` `# ${title}\n` ``, and answers `{ path }`. It does
  no escaping, because heading fidelity is the engine's test.
- It leaves the missing-parent 404 and every other refusal to the server's tests.

Its `/create` branch adds folders only.

**Behavior.** Preserving for production; test-only.

**Why.** UI tests run against the fake
([C-10](artifacts/current-state-findings.md#c-10-the-test-fake-routes-by-url-with-a-catch-all-for-document-names)).

**Depends on.** S-1 and S-5 (the create-post half), S-10 (the folder-only half).

**Decision.** [D-19](artifacts/change-decision-log.md#trivial-decisions),
[D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-19: `revealPath` in `file-tree.tsx` — Added

**Target state.** `revealPath(path)` expands every folder above `path` and marks the active row to be scrolled into view
on the next render. The Find-in-docs effect calls `revealPath(docs.current)` and has no loop of its own.

**Behavior.** Preserving for Find in docs, which expands and scrolls exactly as before.

**Why.** New post needs the same reveal. Revealing from the returned path keeps the browser from deriving the post's
folder itself.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-after-new-post-the-tree-reveals-and-opens-the-new-draft)

### S-20: The editor bar's name button label — Re-scoped

**Target state.** The button's `aria-label` is `Show {docs.current} in Posts`, which is the full workspace path. Its
visible text stays the file name.

**Behavior.** Changing for screen-reader users; see Behavior Changes.

**Why.** Every post made with New post has a file called `draft.md`, and today's label would announce "Show draft.md in
Posts" for every one of them.

**Decision.** [D-16](artifacts/change-decision-log.md#d-16-the-editor-bars-name-button-names-the-whole-path)

## Behavior Changes

The operator asked for these calls to be made without stopping to ask, so the planner settled each one. They are listed
here so the operator can overturn any of them.

1. **New post replaces New file everywhere.** That means the + menu, each folder's … menu, and the empty editor's New
   post button. Each asks for a working title and makes a post: a folder plus `draft.md`. Nothing in the app makes a
   loose `.md` file anymore. Observer: the writer. (S-14, S-15, S-17)
2. **The new draft opens, with its folders expanded and its row scrolled into view.** If the open fails, the post still
   exists, and the error shows in the Posts list's notice. Observer: the writer. (S-11, S-15, S-19;
   [D-8](artifacts/change-decision-log.md#d-8-after-new-post-the-tree-reveals-and-opens-the-new-draft))
3. **The heading is the title as typed. Markdown characters are escaped, and spaces at either end are dropped.** Typing
   ` *Draft* ` gives a heading that shows the asterisks literally, not bold, with no surrounding spaces. A line break
   becomes a space, but only a direct HTTP caller can send one, because the dialog's single-line box cannot hold it.
   Observers: the writer, and a direct HTTP caller. (S-3;
   [D-4](artifacts/change-decision-log.md#d-4-the-drafts-heading-is-the-typed-title-escaped-by-the-editors-own-serializer))
4. **The dialog says what folder a title becomes, and why Create is off.** For example, typing `Why I Love: Rust?` shows
   "Folder: Why I Love Rust". Typing `::` shows that a name can't use those characters. New folder shows the same line,
   and so does a Rename holding `/`. Observer: the writer. (S-16;
   [D-17](artifacts/change-decision-log.md#d-17-the-name-dialog-says-what-folder-name-a-title-becomes-and-why-create-is-off))
5. **Labels change.**
   - The + button reads "New post or folder", to screen readers and in its tooltip.
   - The New post dialog's box is labeled "Working title".
   - Opened from a folder, the dialog is titled "New post in {folder}".
   - The editor bar's name button announces the full path, such as "Show Essays/Why I Love Rust/draft.md in Posts".

   Observers: screen-reader users, anyone hovering over +, and the writer. (S-15, S-20;
   [D-11](artifacts/change-decision-log.md#d-11-the-new-post-dialog-asks-for-a-working-title-and-the--button-says-new-post-or-folder),
   [D-16](artifacts/change-decision-log.md#d-16-the-editor-bars-name-button-names-the-whole-path))
6. **The server no longer makes loose files.** `POST /api/documents/create` with `kind: 'file'` answers 400. Only this
   app's own browser code ever sent that. Observer: anyone calling the HTTP API by hand. (S-10;
   [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end))
7. **Refusals reuse New folder's sentences.** A title that is already a folder shows "{folder} already exists". (S-3;
   [D-6](artifacts/change-decision-log.md#d-6-what-the-new-post-dialog-says-when-it-cannot-make-the-post))

## Change Units

### Unit 1: Move the naming rule to `src/shared`

**What it does.** Moves `newEntryName` and its test to `src/shared/` with no change in behavior. It points
`file-tree.tsx` at the new path and moves the README's description of `entry-name.ts` into its `src/shared/` section.

**Delta entries.** S-1.

**How you know it worked.** `entry-name.test.ts` passes from its new home, with its table unchanged. `file-tree.test.tsx`
passes unchanged. `bun-free.test.ts` still passes. The README names no file that does not exist.

### Unit 2: The engine and server can make a post

**What it does.** Adds the following. Nothing in the browser calls any of it yet.

- `createPost` and `draftText`;
- the `Engine` method;
- the `create-post` route;
- `CreatedPost`;
- the fake's create-post branch;
- the README endpoints row.

**Delta entries.** S-3, S-4, S-5, S-18 (its create-post half).

**Ordering constraint.** After Unit 1, because `createPost` and the fake import `newEntryName` from `src/shared`.

**How you know it worked.** The engine tests run against the real local file system in a temp folder. They cover:

- **A post is made.** Test at the top level and inside `Essays`. Assert the returned path and the exact text of
  `draft.md`.
- **Heading table.** Assert the exact file text, and that the heading reads back through `parseMarkdown` as the title.
  The rows are:
  - `Why I Love: Rust?`
  - `*bold*`
  - `# Not a sub`
  - a title holding `\n\t`, which gives one space
  - `  spaced  `, which gives `# spaced`
- **A taken folder name.** Expect a refusal with `{folder} already exists`, and the existing folder's contents left
  untouched.
- **Bad input.** A title that cleans to nothing gets the title sentence. A missing parent gets 404 `not-found`.
- **A failed draft write.** Wrap the real file system as `{ ...fileSystem, write: () => Promise.reject(error) }`.
  Assert that no post folder is left and that the write's error is reported. Test it with a plain `Error`, and with a
  `FileSystemError` that comes out as a `DocumentError`.
- **A failed draft write and a failed delete.** Assert that the write's error is still the one reported, and that the
  folder is left behind.

Route tests cover the worked example's 200, 400, and 404, by status and body only. Every existing test still passes.

### Unit 3: New post replaces New file in the tree

**What it does.** Adds:

- `useDocuments().createPost`;
- `askNewPost`;
- `revealPath`, pulled out of the Find-in-docs effect;
- the dialog's `label`, two-argument `submit`, and hint line;
- the New post menu item;
- the empty-editor trigger, called by name;
- the + button's new label and the editor bar's new label.

It removes the New file item.

**Delta entries.** S-11, S-14, S-15, S-16, S-17, S-19, S-20.

**Ordering constraint.** After Unit 2, because the browser calls the new endpoint.

**How you know it worked.** The tree tests run against the fake and show these:

- **Menus.** The existing menu tests flip to `['New post', 'New folder']` in both menus, keeping the icon test's `new-file`
  class for New post.
- **A title that differs from its folder name.** Typing `Why I Love: Rust?` does all of the following:
  - shows "Folder: Why I Love Rust";
  - sends `create-post` with `parent` and the typed title;
  - makes `docs.current` the returned `Why I Love Rust/draft.md`;
  - expands `Why I Love Rust`.
- **From a folder's … menu.** The dialog is titled `New post in {folder}`, and the post is made inside that folder,
  with both folders expanded.
- **Bad titles.** `::` keeps Create off and shows the "can't use" line. A taken name such as `drafts` shows
  `drafts already exists`.
- **Cancel** closes the dialog and creates nothing.
- **The empty editor's New post** opens the dialog titled `New post`, with a `Working title` box. The assertion checks
  that exact dialog, not just any name dialog.
- **New folder and Rename** still find their box by the label `Name`. `Rename keeps the name as typed…` still passes,
  which shows `typed` does not leak into Rename.

In `documents.test.tsx`, the file half of the create test moves to `createPost`.

### Unit 4: Remove the loose-file create path

**What it does.** Removes the loose-file create path at every layer:

- every layer's create is cut down to folders, and the pieces are renamed to `createFolder`;
- the route's body narrows to `kind: 'folder'`;
- `newEntryName`'s file branch and its file rows are dropped;
- the fake's `/create` is cut down to folders;
- the README's endpoints row is updated.

**Delta entries.** S-2, S-6, S-7, S-8, S-9, S-10, S-12, S-13, S-18 (its folder-only half).

**Ordering constraint.** After Unit 3, because until then New file still calls the file branch.

**How you know it worked.** It passes these checks:

- **`kind: 'file'` is refused.** A route test shows that `{ path: 'x.md', kind: 'file' }` answers 400 and creates no
  `x.md`.
- **Taken-path tests use folders.** The route's taken-path test is rewritten to use `kind: 'folder'`.
- **Folder tests still pass.** The engine's folder-create, taken-name, and missing-parent tests pass under the new names.
- **The taken-folder rejection is pinned.** `documents.test.tsx`'s taken-path test becomes a taken-folder test, so
  `createFolder` rejecting with the server's sentence stays pinned.
- **`newEntryName`'s folder rows are unchanged.** Copy them from the old table rather than regenerating them.
- **No file branch remains.** `tsc` and a search show no file outside the tests names `createEntry` or passes `'file'`
  to a create.

## Risks

- **A write fails after the folder is made.** `createPost` removes the folder
  ([D-5](artifacts/change-decision-log.md#d-5-a-failed-draft-write-removes-the-folder-it-just-made)). If that delete
  also fails, the empty folder stays, and the writer sees the write's error and can delete the folder from the tree. The
  Unit 2 wrapper tests reproduce both cases. Nobody reproduced them on a real failing disk.
- **The open fails after the post is made.** The dialog has already closed. The error shows in the Posts list's notice,
  and the post shows in the tree
  ([D-13](artifacts/change-decision-log.md#trivial-decisions)).
- **Another window briefly shows an empty folder.** The watcher can report the folder and its draft in separate batches
  ([C-12](artifacts/current-state-findings.md#c-12-the-watcher-reports-a-new-folder-and-its-file-as-separate-events),
  Unverified). The next batch fills it in.
- **A folder name ends in `.md`.** A title like `Notes.md` makes a folder with that name, as New folder already allows.
  The tree lists it as a folder by what it is on disk
  ([D-22](artifacts/change-decision-log.md#trivial-decisions)).
- **Test churn.** `file-tree.test.tsx` names "New file" in many places, and it changed in 19 commits in the last 90 days.
  Most of the churn falls in Unit 3. Its blast radius is the tree's tests, not production.

## Deferred (YAGNI)

- **A `src/engine/posts/` module or a `Post` type.** It would have given the operator's "abstraction" a home of its own.
  Today there is one post-level operation, so the module would hold one function
  ([D-10](artifacts/change-decision-log.md#d-10-createpost-lives-beside-createentry-not-in-a-new-posts-module)).
  Reopen when a second post-level operation lands, such as listing posts, renaming a post's title, or publishing.
- **A shared `markdownHeading` helper in `src/shared`.** It has one caller, `draftText`
  ([D-4](artifacts/change-decision-log.md#d-4-the-drafts-heading-is-the-typed-title-escaped-by-the-editors-own-serializer)).
  Reopen when the browser or the chat tools need to turn plain text into a heading.
- **A shared `draft.md` constant.** The browser learns the path from the answer, so only the engine names the file.
  Reopen when the browser must find a post's draft without having just made it.
- **A test that `useDocuments().createPost` lists before it resolves.** The fake lists at once, so the test would pass
  either way. Reopen when opening a file starts to depend on the list.

## Cut for Scope

- **Posts the AI makes through chat.** These would also have become a folder with `draft.md`. The operator placed
  AI-made posts out of scope at the confirmation turn. The chat tools already accept a draft inside a folder
  ([C-11](artifacts/current-state-findings.md#c-11-the-chat-tools-accept-a-post-inside-a-folder-and-already-use-post-to-mean-a-markdown-file)).
- **Turning existing loose `.md` files into posts.** Old files would have moved into folders of their own. This was
  excluded at the confirmation turn: existing loose files keep showing and opening as they do now.
- **Rename, Move to…, and Delete working on a post as a unit.** For example, renaming a post would also have updated its
  heading. The request says "the "new folder" and other options still remain", and the confirmation turn listed these
  as out of scope
  ([D-15](artifacts/change-decision-log.md#d-15-creation-is-the-first-post-level-operation-rename-move-to-and-delete-stay-file-and-folder-operations)).

## Open Items

These are non-blocking. Each is a gap New file already has in today's name dialog. They are recorded in
[D-18](artifacts/change-decision-log.md#d-18-the-name-dialogs-existing-gaps-stay-out-of-this-change) and would be
settled by an operator request for a name-dialog pass:

- An error stays on screen after the writer edits the title. Since the follow-up below, the writer can close it with
  its ×.
- Keyboard focus is lost when the dialog closes, because the control that opened it is gone.
- The "Working title" label is heard by screen readers but not shown on screen.

## Review Findings

The reviewers were `han-core:junior-developer`, `han-core:test-engineer`, and `han-core:user-experience-designer`, in one
round. Findings that changed the plan:

- **Pinning and naming.**
  - The tree finds the post's folder by revealing every folder above the returned path, not by deriving it (JD-002,
    test-engineer D3). This is D-8.
  - The wire field is `parent`, so "folder" means only the post's own folder (JD-003). This is D-3.
  - The fake names the post folder with `newEntryName` and refuses only a taken name (JD-005, test-engineer D1–D2). This
    is D-19.
- **Behavior the draft missed.**
  - Every new post's file is `draft.md`, so the editor bar's label now names the full path (JD-004, UX-006). This is
    D-16.
  - The dialog shows the folder a title becomes, and why Create is off (UX-001, UX-002). This is D-17.
- **A simpler flow.** The draft opens from the tree after the dialog closes. An open failure is no longer shown in the
  dialog for a post that was made (UX-007). This is D-8 and D-13.
- **Scope wording.** Why This Change now says creation is the first post-level operation (JD-001). This is D-15.
- **Tests.** Each unit's checks now name discriminating cases, following the test-engineer's H1–H6 and M1–M4. Examples
  are a title that differs from its folder name, a dialog asserted by its title, and the write-failure wrapper.
- **The README edit** moved into Unit 1 (JD-008).

Closed against the evidence:

- A folder named `Notes.md` is already allowed by New folder (JD-007, D-22).
- `kind: z.literal('folder')` stays (JD-009, D-21).
- The line-break rule stays, with its observer corrected to a direct HTTP caller (JD-006).
- Every Preserving claim the junior developer checked holds (JD-010).

Not adopted: UX-003, UX-004, UX-005, and the visible-label note. They are listed under Open Items (D-18). UX-009 was
adopted as D-20.

Unverified and never blocking:

- C-12, the watcher's batching.
- Where focus lands after the dialog closes (UX-005), which was not checked in a browser.
- Whether `bun-free.test.ts` scans `engine/documents/documents.ts`'s new import. `engine/chat/tools/tools.ts` already
  imports the same module, so the scan already passes it.

## How the Build Departed From the Plan

- **`createPost` has no parent check of its own.** Target State step 3 planned one. The test for a missing parent passed
  before it was written, because `fileSystem.createFolder` already refuses a missing parent with `{parent} was not
  found`. The step was dropped, and the test stays to pin the behavior.
- **A hidden parent is refused.** No unit named this test. `parent` arrives from the request, so a test now shows that
  `.3pitor` as a parent is refused by `checkPath(draft, 'file')` and nothing is made.
- **The fake's create-post branch landed in Unit 3, not Unit 2.** Nothing in Unit 2 exercised it, so the tree tests that
  needed it drove it in Unit 3.
- **The hint line's class is `name-hint`.** The `hint` class already styles the Save button's shortcut. The line is
  hidden while empty, and its "can't" uses a typographic apostrophe, as the app's other text does.

## Follow-Up: Closing Errors and a Busy Create

Asked for after the build, and built test-first:

- The error above the tree and the errors in the name, move, and delete dialogs each have a × button that closes them.
  Closing a dialog's error leaves the dialog open.
- While the name dialog's request runs, its submit button (Create, or Rename) is turned off and shows a spinner over
  its label. When the server refuses, the button turns back on, the spinner goes away, and the error shows. This
  settles the "Create can be pressed twice" open item.
- The editor's and chat's error notices are not closable. They are tied to save, restore, and Claude-edit state, and
  were outside this request's area.

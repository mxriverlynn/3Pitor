# Change Plan: New Post Instead of New File

## Why This Change

The operator wants the Posts list to handle a blog post as one unit instead of as loose markdown files. On disk a post
is still a folder holding a file. The tree's **New file** becomes **New post**. It asks for a working title, makes a
folder named from that title, and puts a `draft.md` in the folder whose heading is the title as typed. This is a
constraint arriving: a new requirement the current create path was not built for. The source is the operator's own
request, recorded in [artifacts/scope-boundary.md](artifacts/scope-boundary.md).

## What Changes, In One Paragraph

After this change, the engine owns one operation, `createPost`, that makes a whole post: a folder named from the
working title, and a `draft.md` inside it headed with that title. The operation is the only code that knows a post is
laid out that way ([D-1](artifacts/change-decision-log.md#d-1-a-post-is-made-by-one-engine-operation-behind-its-own-endpoint),
[D-10](artifacts/change-decision-log.md#d-10-createpost-lives-beside-createentry-not-in-a-new-posts-module)). The
browser asks for a post by folder and title and opens the path it gets back. Every place that offered New file now
offers New post. The code that made a loose `.md` file is removed from the browser, the server, and the engine
([D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)). New folder, Rename,
Move to…, and Delete are unchanged, and existing loose `.md` files still show and open.

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

The structural property this change addresses is that nothing in the code knows what a post is. A post is whatever
file the writer happened to make. The pieces the change needs already exist. The editor's `markdownSerializer` escapes
plain text for a heading
([C-4](artifacts/current-state-findings.md#c-4-the-editors-serializer-already-escapes-plain-text-for-a-heading)).
The file system's `createFolder` refuses a name that is taken, and its `write` and `delete` cover the rest
([C-5](artifacts/current-state-findings.md#c-5-filesystemwrite-creates-missing-parent-folders-createentry-refuses-them-on-purpose)).

## Target State

A post is made by one call, which either fully succeeds or leaves nothing behind. Only that call knows a post's layout.

**`newEntryName`** lives in `src/shared/entry-name.ts`
([D-2](artifacts/change-decision-log.md#d-2-the-naming-rule-moves-to-srcshared-and-becomes-the-folder-rule-only)).

- It turns typed text into a folder name, or `''` when nothing usable is left. The rule is today's folder rule, character
  for character.
- The tree's dialogs use it to switch Create on and off, and `createPost` uses it to name the post's folder.

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
It turns each run of control characters into one space and trims both ends. Then it serializes a level-1 heading with
that text through `markdownSerializer` and adds a newline. `Why I Love: Rust?` becomes `# Why I Love: Rust?\n`, and
`*bold*` becomes `# \*bold\*\n`.

**The wire contract**
([D-3](artifacts/change-decision-log.md#d-3-the-create-post-wire-contract)):

```ts
// src/server/documents/documents.routes.ts — POST /api/documents/create-post
const CreatePostBody = z.object({ folder: z.string(), title: z.string() }); // folder is '' for the top level
// src/shared/wire.ts — the 200 answer
export type CreatedPost = { path: string }; // the draft's workspace path
```

| Request body | Answer |
| --- | --- |
| `{"folder":"Essays","title":"Why I Love: Rust?"}` | 200 `{"path":"Essays/Why I Love Rust/draft.md"}`; the draft holds `# Why I Love: Rust?\n` |
| the same again | 400 `{"error":"Essays/Why I Love Rust already exists"}` |
| `{"folder":"Gone","title":"Hi"}` with no `Gone` folder | 404 `{"error":"Gone was not found"}` |
| `{"folder":"","title":"::"}` | 400 `{"error":"\"::\" has no characters a folder name can use"}` |

**`Engine['documents']`** gains `createPost(parent: string, title: string): Promise<string>`, and `create(path, kind)`
becomes `createFolder(path: string): Promise<void>`
([D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)).
`POST /api/documents/create` keeps its URL and its `{ ok: true }` answer. Its body becomes
`z.object({ path: z.string(), kind: z.literal('folder') })`.

**`useDocuments()`** in `documents.tsx` gains `createPost(folder, title): Promise<string>`
([D-8](artifacts/change-decision-log.md#d-8-after-new-post-the-tree-opens-the-posts-folder-and-its-draft)). It runs in
this fixed order: POST, then `refreshList()`, then `open(path)`, then it resolves to `path`. `createEntry(path, kind)`
becomes `createFolder(path)`, which does the POST and then `refreshList()`.

**The file tree** offers `New post` and `New folder`, in that order, in the + menu and in each folder's … menu.

- A named `askNewPost(folder)` opens the name dialog. The empty editor's New post calls it by name
  ([D-7](artifacts/change-decision-log.md#trivial-decisions)).
- The dialog's `Pending` name variant changes in two ways
  ([D-11](artifacts/change-decision-log.md#d-11-the-new-post-dialog-asks-for-a-working-title-and-the--button-says-new-post-or-folder)):
  - It gains `label`, which reads `Working title` for New post and `Name` for the others.
  - Its `submit` becomes `(name: string, typed: string) => Promise<void>`, so New post can send the title as typed.
    New folder and Rename ignore `typed`.
- New post's `clean` is `newEntryName`, so Create stays off while the title cleans to nothing.
- On success the tree expands the folder the post was made in and the post's own folder.
- Refusals show in the dialog's alert, as today
  ([D-6](artifacts/change-decision-log.md#d-6-what-the-new-post-dialog-says-when-it-cannot-make-the-post)).

## Surface Delta

### S-1: `newEntryName` — Moved

**Target state.** `newEntryName` and its test live in `src/shared/entry-name.ts` and `src/shared/entry-name.test.ts`.
`src/ui/documents/file-tree/entry-name.ts` does not exist.

**Behavior.** Preserving. Same function, same results; only the import path changes.

**Why.** The engine must derive a folder name with the same rule the dialog uses, and it cannot import `src/ui`
([C-3](artifacts/current-state-findings.md#c-3-the-naming-rule-lives-in-the-ui-only)).

**Migration.** `file-tree.tsx` imports from `../../../shared/entry-name`.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-naming-rule-moves-to-srcshared-and-becomes-the-folder-rule-only)

### S-2: `newEntryName` — Re-scoped

**Target state.** `newEntryName(typed: string): string` is the folder rule only. It has no `kind` parameter and never
adds or removes `.md`.

**Behavior.** Preserving. Every remaining caller passed `'folder'`, and the folder results are unchanged.

**Why.** Its only `'file'` caller, the tree's New file, is removed (S-14).

**Depends on.** S-1, S-14.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-naming-rule-moves-to-srcshared-and-becomes-the-folder-rule-only)

### S-3: `createPost` in `src/engine/documents/documents.ts` — Added

**Target state.** `createPost(fileSystem, parent, title): Promise<string>` makes the folder `newEntryName(title)` inside
`parent`, and that folder's `draft.md` headed with `draftText(title)`. It resolves to the draft's path. It refuses as the
Target State lists, and it removes the folder it made when the draft cannot be written.

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

**Behavior.** Preserving for every existing caller; the method is new.

**Why.** The server reaches the engine only through `Engine`.

**Depends on.** S-3.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-a-post-is-made-by-one-engine-operation-behind-its-own-endpoint)

### S-5: `POST /api/documents/create-post` and `CreatedPost` — Added

**Target state.** The route takes `{ folder: string, title: string }` and answers 200 with
`CreatedPost = { path: string }`, declared in `src/shared/wire.ts`. Refusals answer `{ error }` with 400 or 404 through
the existing `onError`. The worked example in Target State is the contract. `README.md`'s endpoints table lists it.

**Behavior.** Preserving for every existing caller; the endpoint is new.

**Why.** The browser asks for a post once and opens the path it gets back.

**Depends on.** S-4.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-create-post-wire-contract)

### S-6: `createEntry` in `src/engine/documents/documents.ts` — Re-scoped

**Target state.** The engine's create makes an empty folder only. It has no file branch, writes no heading, and has no
symlink-file check.

**Behavior.** Changing for a request that asks for a file; see S-10.

**Why.** Nothing makes loose files once New file is gone.

**Depends on.** S-14.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-7: `createEntry` → `createFolder` in `src/engine/documents/documents.ts` — Renamed

**Target state.** The function is named `createFolder(fileSystem, path)`. It is unchanged in every other respect from S-6.

**Behavior.** Preserving.

**Why.** The name says what it now does.

**Depends on.** S-6.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-8: `Engine['documents'].create` — Re-scoped

**Target state.** The method takes a path only and makes an empty folder.

**Behavior.** Preserving for its one caller, the route, which only passes folders after S-10.

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
answers `{ ok: true }`. A body with `kind: 'file'` answers 400. `README.md`'s endpoints table describes it as "Create an
empty folder: `{ path, kind: 'folder' }`".

**Behavior.** Changing: a `kind: 'file'` request now gets a 400. Only this app's browser ever sent one. Settled by the
planner; see Behavior Changes.

**Why.** The operator is moving away from managing raw files. Keeping `kind` as a literal stops a stale request from
quietly making a folder named `x.md`.

**Depends on.** S-9, S-14.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-11: `useDocuments().createPost` — Added

**Target state.** `createPost(folder: string, title: string): Promise<string>` sends `POST /api/documents/create-post`,
then runs `refreshList()`, then `open(path)`, and resolves to `path`. A refusal rejects with the server's sentence.

**Behavior.** Changing: part of New post; see Behavior Changes.

**Why.** The tree needs one call that leaves the new draft listed and open.

**Depends on.** S-5.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-after-new-post-the-tree-opens-the-posts-folder-and-its-draft)

### S-12: `useDocuments().createEntry` — Re-scoped

**Target state.** It makes a folder only: POST, then `refreshList()`. It never opens anything.

**Behavior.** Preserving for its one remaining caller, New folder, which never opened anything.

**Why.** It follows S-6.

**Depends on.** S-14.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-13: `useDocuments().createEntry` → `createFolder` — Renamed

**Target state.** The member is `createFolder(path: string): Promise<void>`.

**Behavior.** Preserving.

**Depends on.** S-12.

**Why.** It matches S-7 and S-9.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-14: The tree's New file item — Removed

**Target state.** No menu in the tree offers New file. Making a post is New post's job (S-15). Making a loose `.md` file
is no longer possible from the app.

**Behavior.** Changing; see Behavior Changes.

**Why.** It is the operator's request.

**Depends on.** S-15 (the two land together in Unit 3).

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

### S-15: The tree's New post item and `askNewPost` — Added

**Target state.** The + menu and each folder's … menu list `New post`, then `New folder`. New post keeps the `new-file`
icon ([D-12](artifacts/change-decision-log.md#trivial-decisions)). `askNewPost(folder)` opens the name dialog titled
`New post`, with the input labeled `Working title`, action `Create`, and `clean` set to `newEntryName`. Its submit calls
`docs.createPost(folder, typed)`, then expands `folder` (when not `''`) and the post's own folder. The + button's
`aria-label` and `title` read `New post or folder`.

**Behavior.** Changing; see Behavior Changes.

**Why.** It is the operator's request.

**Depends on.** S-11, S-16.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-after-new-post-the-tree-opens-the-posts-folder-and-its-draft),
[D-11](artifacts/change-decision-log.md#d-11-the-new-post-dialog-asks-for-a-working-title-and-the--button-says-new-post-or-folder),
[D-6](artifacts/change-decision-log.md#d-6-what-the-new-post-dialog-says-when-it-cannot-make-the-post)

### S-16: The name dialog's `Pending` — Re-scoped

**Target state.** The `kind: 'name'` variant carries `label: string`, and its `submit` is
`(name: string, typed: string) => Promise<void>`. The dialog calls `pending.submit(pending.clean(draft), draft)` and
labels its input with `pending.label`.

**Behavior.** Preserving for New folder and Rename, which pass `'Name'` and ignore `typed`.

**Why.** New post needs the title as typed, which `clean` would otherwise throw away.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-the-new-post-dialog-asks-for-a-working-title-and-the--button-says-new-post-or-folder)

### S-17: The empty editor's New post trigger — Re-scoped

**Target state.** The tree's effect on `docs.newPosts` calls `askNewPost('')` while Claude is not working. It no longer
depends on the + menu's order.

**Behavior.** Changing: the button now makes a post rather than a loose file. It is the same change as S-15.

**Depends on.** S-15.

**Why.** Removes the positional coupling
([C-8](artifacts/current-state-findings.md#c-8-the-empty-editors-new-post-button-runs-whatever-is-first-in-the--menu)).

**Decision.** [D-7](artifacts/change-decision-log.md#trivial-decisions)

### S-18: `fakeDocumentsApi` — Re-scoped

**Target state.** The fake answers `POST /api/documents/create-post` ahead of its document-name catch-all. It answers 400
`{folder} already exists` when the folder exists. Otherwise it adds the folder, sets `{folder}/draft.md` to
`` `# ${title}\n` `` (no escaping; heading fidelity is the engine's test), and answers `{ path }`. Its `/create`
branch adds folders only.

**Behavior.** Preserving for production; test-only.

**Why.** UI tests run against the fake
([C-10](artifacts/current-state-findings.md#c-10-the-test-fake-routes-by-url-with-a-catch-all-for-document-names)).

**Depends on.** S-5 (its create-post half), S-10 (its folder-only half).

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end)

## Behavior Changes

The operator asked for these calls to be made without stopping to ask, so the planner settled each one. The list is here
so the operator can overturn any of them.

1. **New post replaces New file everywhere.** The + menu, each folder's … menu, and the empty editor's New post button
   ask for a working title and make a post: a folder plus `draft.md`. Nothing in the app makes a loose `.md` file any
   more. Observer: the writer. (S-14, S-15, S-17)
2. **The new draft opens with its folder expanded.** After New post, the tree opens the folder the post was made in and
   the post's own folder, with `draft.md` active in the editor. Observer: the writer. (S-11, S-15;
   [D-8](artifacts/change-decision-log.md#d-8-after-new-post-the-tree-opens-the-posts-folder-and-its-draft))
3. **The heading is the title as typed, with two exceptions.** Spaces at either end are dropped, and a line break or
   other control character becomes a space. Markdown characters are escaped so the heading reads back as the title.
   For example, typing ` *Draft* ` gives `# \*Draft\*`, which shows as "\*Draft\*". Observer: the writer. (S-3;
   [D-4](artifacts/change-decision-log.md#d-4-the-drafts-heading-is-the-typed-title-escaped-by-the-editors-own-serializer))
4. **Labels change.** The + button reads "New post or folder" to screen readers and in its tooltip. The New post
   dialog's box is labeled "Working title". Observer: screen-reader users and anyone hovering +. (S-15;
   [D-11](artifacts/change-decision-log.md#d-11-the-new-post-dialog-asks-for-a-working-title-and-the--button-says-new-post-or-folder))
5. **The server no longer makes loose files.** `POST /api/documents/create` with `kind: 'file'` answers 400. Only this
   app's own browser code ever sent that. Observer: anyone calling the HTTP API by hand. (S-10;
   [D-9](artifacts/change-decision-log.md#d-9-the-loose-file-create-path-is-removed-end-to-end))
6. **Refusals reuse New folder's sentences.** A title that is already a folder shows "{folder} already exists". A title
   with no usable characters keeps Create switched off. (S-3;
   [D-6](artifacts/change-decision-log.md#d-6-what-the-new-post-dialog-says-when-it-cannot-make-the-post))

## Change Units

### Unit 1: Move the naming rule to `src/shared`

**What it does.** Moves `newEntryName` and its test to `src/shared/` with no change in behavior, and points
`file-tree.tsx` at the new path.

**Delta entries.** S-1.

**How you know it worked.** `entry-name.test.ts` passes from its new home. `file-tree.test.tsx` passes unchanged.
`bun-free.test.ts` still passes.

### Unit 2: The engine and server can make a post

**What it does.** Adds `createPost` and `draftText`, the `Engine` method, the `create-post` route, `CreatedPost`, the
fake's create-post branch, and the README endpoints row. Nothing in the browser calls it yet.

**Delta entries.** S-3, S-4, S-5, S-18 (its create-post half).

**Ordering constraint.** After Unit 1, because `createPost` imports `newEntryName` from `src/shared`.

**How you know it worked.** Engine tests cover each row of the worked example, plus these cases:
- the heading cases in [D-4](artifacts/change-decision-log.md#d-4-the-drafts-heading-is-the-typed-title-escaped-by-the-editors-own-serializer),
  each read back through `parseMarkdown`;
- a draft write that fails, after which the folder is gone and the write's error is reported;
- a title whose folder name is taken, after which nothing is written.

Route tests cover 200, 400, and 404. Every existing test still passes.

### Unit 3: New post replaces New file in the tree

**What it does.** Adds `useDocuments().createPost`, `askNewPost`, the dialog's `label` and two-argument `submit`, the
New post menu item, the empty-editor trigger by name, and the + button's new label. Removes the New file item.

**Delta entries.** S-11, S-14, S-15, S-16, S-17.

**Ordering constraint.** After Unit 2, because the browser calls the new endpoint.

**How you know it worked.** Tree tests show these, against the fake:
- both menus list `New post` and `New folder`;
- typing `Hello` into New post sends `create-post` with the folder and title, opens `Hello/draft.md`, and expands
  `Hello`;
- Create stays off for `::`;
- a taken name shows "… already exists";
- the empty editor's New post opens the same dialog.

The browser's own test for the empty editor still passes.

### Unit 4: Remove the loose-file create path

**What it does.** Cuts every layer's create down to folders, renames the pieces to `createFolder`, narrows the route's
body to `kind: 'folder'`, drops `newEntryName`'s file branch and its tests, cuts the fake's `/create` down to folders,
and updates the README's endpoints row and its `entry-name.ts` description.

**Delta entries.** S-2, S-6, S-7, S-8, S-9, S-10, S-12, S-13, S-18 (its folder-only half).

**Ordering constraint.** After Unit 3, because until then New file still calls the file branch.

**How you know it worked.** A route test shows `kind: 'file'` answers 400. The engine and route folder tests pass under
the new names. `newEntryName`'s folder cases pass. No source file outside tests names `createEntry` or passes `'file'`
to a create.

## Risks

- **A write fails after the folder is made.** `createPost` removes the folder
  ([D-5](artifacts/change-decision-log.md#d-5-a-failed-draft-write-removes-the-folder-it-just-made)). If that delete
  also fails, the empty folder stays and the writer sees the write's error. They can delete the folder from the tree.
  Nobody reproduced a failing delete on a real disk. Detected early by the Unit 2 test that makes `write` fail.
- **The open fails after the post is made.** The dialog shows the open error, though the post exists and shows in the
  tree. This is today's New file behavior, kept on purpose
  ([D-13](artifacts/change-decision-log.md#trivial-decisions)).
- **Another window briefly shows an empty folder.** The watcher can report the folder and its draft in separate batches
  ([C-12](artifacts/current-state-findings.md#c-12-the-watcher-reports-a-new-folder-and-its-file-as-separate-events),
  Unverified). The next batch fills it in.
- **Test churn.** `file-tree.test.tsx` names "New file" in many places and changed in 19 commits in the last 90 days. Unit
  3 carries most of that churn. Its blast radius is the tree's tests, not production.

## Deferred (YAGNI)

- **A `src/engine/posts/` module or a `Post` type.** It would have given the operator's "abstraction" a home of its own.
  Today there is one post-level operation, so it would hold one function
  ([D-10](artifacts/change-decision-log.md#d-10-createpost-lives-beside-createentry-not-in-a-new-posts-module)).
  Reopen when a second post-level operation lands, such as listing posts, renaming a post's title, or publishing.
- **A shared `markdownHeading` helper in `src/shared`.** It has one caller, `draftText`
  ([D-4](artifacts/change-decision-log.md#d-4-the-drafts-heading-is-the-typed-title-escaped-by-the-editors-own-serializer)).
  Reopen when the browser or the chat tools need to turn plain text into a heading.
- **A shared `draft.md` constant.** The browser learns the path from the answer, so only the engine names the file.
  Reopen when the browser must find a post's draft without having just made it.

## Cut for Scope

- **Posts the AI makes through chat.** They would also become a folder with `draft.md`. The operator placed AI-made posts
  out of scope at the confirmation turn. The chat tools already accept a draft inside a folder
  ([C-11](artifacts/current-state-findings.md#c-11-the-chat-tools-accept-a-post-inside-a-folder-and-already-use-post-to-mean-a-markdown-file)).
- **Turning existing loose `.md` files into posts.** Old files would have been moved into folders of their own. Excluded
  at the confirmation turn: existing loose files keep showing and opening as they do now.
- **Rename, Move to…, and Delete working on a post as a unit.** For example, renaming a post would also update its
  heading. The request says "the "new folder" and other options still remain".

## Open Items

None.

## Review Findings

To be filled after the review round.

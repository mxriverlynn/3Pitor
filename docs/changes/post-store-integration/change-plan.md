# Change Plan: Post Store Integration

## Why This Change

The posts store in `src/posts/` is built and was merged in PR #38, but nothing uses it yet. The app still reads, saves,
lists, and deletes posts through the old documents API, by draft path. The design the store came from,
[`api-design.md`](../post-management-api/api-design.md), deferred hooking it up to a separate change ("Integration does
later (G7)"). It listed the behavior changes that hookup brings as BC1–BC14. This plan carries the hookup out.

The reason class is **a decision already taken**. The user confirmed the scope and the direction of travel: the old
documents API goes away entirely, the sidebar becomes a flat list of posts, and the plan includes a security review of
post ids that arrive from the browser and from the AI ([scope-boundary.md](artifacts/scope-boundary.md)). The plan does
not reopen the design's decisions. Where it orders or shows an id, it does so only in three narrow cases, which are
recorded ([D-1](artifacts/change-decision-log.md#trivial-decisions),
[D-30](artifacts/change-decision-log.md#d-30-three-narrow-uses-of-an-id-beyond-store-and-pass-back)).

## What Changes, In One Paragraph

Afterwards, every post the app shows, opens, saves, renames, or deletes goes through one `PostStore`.

- **Identity.** A post is named by an opaque id, which is its folder key (`the sun`). The app never builds that id from
  a path or parses a path out of it.
- **Title.** The title is stored apart from the text. Rename changes the title, and the id stays the same.
- **Sidebar.** The sidebar is a flat list of post titles.
- **Saving.** Save only updates a post that exists. When an open post has been deleted, its unsaved text is shown as
  "not in your posts". The writer can copy it or discard it, but never save it back over something else.
- **The AI.** The AI names posts by id, finds them with a `Posts` tool, and makes new ones with a `NewPost` tool.
- **Restoring.** Saved view state and chat sessions are checked against the post list when they are restored, so a
  reference to an old draft path or a deleted post drops out.
- **The server.** The server answers only to this machine, and only to its own page.
- **FileSystem.** The engine keeps `FileSystem` for everything that is not a post: app state, notes, skills, config, and
  the AI's read-only access to workspace files.

## Current State

The documents API is a second, path-based model of posts that runs beside the store
([C-4](artifacts/current-state-findings.md#c-4-documentsts-is-the-documents-api-and-all-of-it-goes-one-export-has-another-importer)).
Its list holds every folder and every `.md` file, sorted by path. The UI nests that list into a tree, and every post row
in it reads `draft.md`
([C-5](artifacts/current-state-findings.md#c-5-todays-list-returns-every-folder-and-md-file-sorted-by-path-the-ui-nests-them-by-)).

The structural problem this change addresses is identity.

- **Paths everywhere.** A post is referred to by a path string, and that string crosses every layer under several
  field names
  ([C-17](artifacts/current-state-findings.md#c-17-the-post-name-crosses-every-layer-as-a-bare-string-under-several-field-names)).
- **Re-derived on each layer.** The tools re-derive it with `resolvePost`
  ([C-10](artifacts/current-state-findings.md#c-10-resolvepost-is-the-tools-post-check-and-it-is-path-shaped)). The UI
  re-derives it in its path helpers
  ([C-27](artifacts/current-state-findings.md#c-27-pathsts-and-the-trees-path-algebra-serve-only-the-hierarchy)), when
  it re-keys a moved post
  ([C-12](artifacts/current-state-findings.md#c-12-rename-is-a-move-and-move-is-the-only-code-that-rewrites-keys-in-ui-state)),
  and when it deletes by matching path prefixes
  ([C-13](artifacts/current-state-findings.md#c-13-delete-is-recursive-and-prefix-matched-in-the-ui-with-a-count-shown-first-for-folders)).
- **Save is an upsert.** It creates a post when none exists, and the AI's way of making a post depends on that
  ([C-8](artifacts/current-state-findings.md#c-8-save-is-an-explicit-upsert-that-creates-missing-folders-and-the-ui-depends-on-that-for-ai-made-posts),
  [C-9](artifacts/current-state-findings.md#c-9-the-ai-tools-never-write-a-post-to-disk-they-change-an-in-memory-copy-for-the-turn)).
- **No stored title.** A title exists only as a folder name and an H1 written at create time
  ([C-11](artifacts/current-state-findings.md#c-11-a-title-exists-today-only-as-a-folder-name-and-an-h1-seeded-at-create-time)).
- **Unchecked saved state.** `view.json` and `session.json` hold path strings with no check and no version
  ([C-21](artifacts/current-state-findings.md#c-21-viewjson-stores-post-names-in-seven-places-cast-rather-than-parsed-and-restores-them-unchecked),
  [C-22](artifacts/current-state-findings.md#c-22-sessionjson-stores-old-post-names-inside-chat-records-and-the-ui-re-applies-the-last-turn-on-load)).

The store's own guarantees already remove two of today's races
([C-28](artifacts/current-state-findings.md#c-28-the-stores-per-post-queue-already-fixes-two-of-todays-races)). They also
create one new trap: a dirty entry whose post is gone can never be saved
([C-29](artifacts/current-state-findings.md#c-29-a-dirty-entry-for-a-post-that-is-gone-can-never-be-saved-under-the-store)).

Two kinds of constraint shape where each piece may sit. The import rules decide that
([C-1](artifacts/current-state-findings.md#c-1-the-import-rules-fix-where-each-integration-piece-may-sit)), and the engine
must keep `FileSystem` for everything that is not a post
([C-3](artifacts/current-state-findings.md#c-3-the-engine-keeps-filesystem-for-everything-that-is-not-a-post)).

The review round's security probe found a weakness in the server today. It listens on every network interface, with no
check of `Host` or `Origin`
([C-30](artifacts/current-state-findings.md#c-30-the-server-answers-on-every-interface-and-checks-neither-host-nor-origin)).
The new routes would inherit that.

## Target State

### Wiring

**cli** builds the store on the same `FileSystem` it already builds, and hands both to the engine.

The **engine** takes `posts` as an option and hands the store to the server as `Engine['posts']`. That handle is typed
without `watch`, so only the engine subscribes. The engine subscribes `posts.watch` itself
([D-2](artifacts/change-decision-log.md#d-2-the-engine-hands-the-store-itself-to-the-server),
[D-3](artifacts/change-decision-log.md#d-3-the-engine-subscribes-postswatch-emits-posts-changed-and-drops-the-subscription-if-startup-fails)).

```ts
// src/engine/engine.ts
import type { PostStore } from '../posts/posts';
export interface EngineOptions { fileSystem: FileSystem; posts: PostStore; /* the rest unchanged */ }
export interface Engine { readonly posts: Omit<PostStore, 'watch'>; /* documents removed */ }

// startEngine
const unsubscribe = posts.watch(() => events.emit({ type: 'posts-changed' }));
try { await sessions.load(); } catch (error) { unsubscribe(); throw error; }
```

- `createEngine` still never watches.
- The engine does not re-export `PostError`. The server imports it from `posts/post-error`, which the boundary test
  allows.

### The server answers only this machine and its own page

`startServer` makes two changes
([D-25](artifacts/change-decision-log.md#d-25-the-server-answers-only-this-machine-and-its-own-page)).

1. It passes `hostname: '127.0.0.1'` to `Bun.serve`, matching `mcp-endpoint.ts`.
2. It wraps `app.fetch` in a same-machine check. A request is refused with plain-text `403 Forbidden` when either of
   these holds:
   - its `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`
   - it carries an `Origin` other than `http://127.0.0.1:<port>` or `http://localhost:<port>`

The check runs before Hono, so it covers every route and the `/ws/events` upgrade:

```ts
// src/server/server.ts
const ours = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`];
function sameMachine(request: Request, port: number): boolean {
  const hosts = ours(port);
  const origin = request.headers.get('origin');
  return hosts.includes(request.headers.get('host') ?? '') && (origin === null || hosts.some((h) => origin === `http://${h}`));
}
// Bun.serve({ hostname: '127.0.0.1', …, fetch: (request, server) =>
//   sameMachine(request, server.port) ? app.fetch(request, server) : new Response('Forbidden', { status: 403 }) })
```

The page itself (`routes: { '/': homepage }`) is static HTML and stays outside the check. Deletes and saves use
`DELETE` and `PUT`, so a browser always preflights them. With no CORS headers, a cross-site page can never send them.
That protection is deliberate: delete and save must never move to `POST`, and the server adds no CORS headers.

### HTTP routes

There is one new server feature module, `src/server/posts/posts.routes.ts`
([D-6](artifacts/change-decision-log.md#d-6-post-routes-status-mapping-and-how-ids-travel)). All bodies are JSON. A 4xx
body is `ApiError { error: string }`. Any other failure is logged and answered with plain-text
`500 Internal Server Error`.

| Method | Path | Request body | 200 response | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/posts` | none | `PostList`, `{"posts":[{"id":"the sun","title":"The Sun"}]}`, unsorted | none |
| GET | `/api/posts/:id` | none | `Post`, `{"id":"the sun","title":"The Sun","body":"…"}` | 404 |
| POST | `/api/posts` | `CreatePostBody`, `{"title":"The Sun"}` | `{"id":"The Sun 2"}` | 400 blank title; 400 bad body |
| PUT | `/api/posts/:id/title` | `SetTitleBody`, `{"title":"…"}` | `{"ok":true}` | 404; 400 blank title; 400 bad body |
| PUT | `/api/posts/:id/body` | `SetBodyBody`, `{"body":"…"}` | `{"ok":true}` | 404; 400 bad body |
| DELETE | `/api/posts/:id` | none | `{"ok":true}` | 404 |

`POST /api/posts` calls `posts.create({ title, body: '' })`. No caller makes a post with text, so the body carries none
([D-12](artifacts/change-decision-log.md#d-12-new-posts-start-empty-and-nothing-keeps-an-h1-in-step-with-the-title)).

**Ids in URLs** are one path segment, sent as `encodeURIComponent(id)`. `PUT /api/posts/series%2Fone/body` reaches the
route with `id = "series/one"`. Encoded traversal such as `%2E%2E%2F.3pitor%2Fconfig.json` reaches the store and is
`not-found`
([C-6](artifacts/current-state-findings.md#c-6-routes-are-apidocuments-keyed-by-a-name-path-parameter-and-map-documenterror-to-404-or-400)).

**Error mapping** is done by `onError` in `posts.routes.ts`
([D-7](artifacts/change-decision-log.md#d-7-a-bad-request-body-is-a-route-private-badbody-error)):

- **`PostError`** returns `{ error: error.message }`, with status 404 for `'not-found'` and 400 for `'invalid'`. The
  messages are the store's own: "That post no longer exists." and "A post needs a title."
- **`BadBody`**, a class private to the module, returns 400 with
  `{"error":"the request body is not valid: <z.prettifyError text>"}`.
- **Anything else** is passed to `console.error` and returns 500.

The UI still branches only on `status`. It shows the `error` text it receives and never writes its own copy of these
sentences
([C-7](artifacts/current-state-findings.md#c-7-the-ui-never-branches-on-an-error-reason-only-on-the-http-status-and-the-message)).

### Wire types

These are added to `src/shared/wire.ts`. They are restated by hand, because shared cannot import posts
([D-5](artifacts/change-decision-log.md#d-5-wire-types-restate-the-post-shapes-and-the-compiler-keeps-them-in-step)):

```ts
export interface PostSummary { id: string; title: string }
export interface PostList { posts: PostSummary[] }
export interface Post extends PostSummary { body: string }
export interface CreatePostBody { title: string }
export interface SetTitleBody { title: string }
export interface SetBodyBody { body: string }
```

`HostEvent`'s `{ type: 'documents-changed' }` becomes `{ type: 'posts-changed' }`. That change belongs to S-3.

**Keeping the two sides in step.** Each route answers with `c.json<WireType>(await posts.x(...))`, so `make typecheck`
fails if the contract's type stops being assignable to the wire type. Request bodies are checked three ways:

- The server parses them with `z.ZodType<WireBody>` schemas.
- The UI hook builds them with `satisfies`.
- The fake builds them with `satisfies`.

**Reference fields keep their names.** These still use `openFile`, `file`, and `name`:

- `ChatRequest`
- `SessionHighlights`
- `SessionData`
- `TurnProgress`
- `StoredDoc`
- `TurnRecord`
- `NotApplied`
- `ViewState`

Their values become exact post ids.

**Removed:** `DocumentEntry`, `DocumentList`, `CreatedPost`, `FolderCount`.

### AI tools

`fileTools(fileSystem, posts, appSkillFiles, turn, onChange)` addresses posts by exact id
([D-10](artifacts/change-decision-log.md#d-10-the-ai-makes-a-post-with-newpost-which-creates-it-empty-on-disk-at-once),
[D-11](artifacts/change-decision-log.md#d-11-tools-name-posts-by-exact-id-and-refuse-to-change-anything-else),
[D-15](artifacts/change-decision-log.md#d-15-a-posts-tool-lists-posts-for-the-ai)).

The turn copy is `turn.texts: Map<PostId, string>`. Its keys are the keys of the browser's `documents` map as sent. They
are never normalized, and `""` is skipped. The server does not check them against the store. A key that names no post
can only produce edits that return to the browser, and their Save is `not-found`, so nothing reaches disk
([D-16](artifacts/change-decision-log.md#d-16-ids-from-the-browser-and-the-ai-are-resolved-at-the-store-never-trusted-as-paths)).

The input field keeps the name `file_path`, for compatibility with Claude Code.

**Read `{file_path}`** tries these in order:

1. `3pitor://skills/…` returns the skill text.
2. `turn.texts.get(file_path)`.
3. `posts.get(file_path).body`. A `PostError('not-found')` falls through to the next step. Any other error throws.
4. `fileSystem.read(normalizeKey(file_path))`. A missing file gives `` `${file_path} does not exist` ``.

**Write `{file_path, content}`, Edit `{file_path, old_string, new_string}`, and Highlight `{file_path, passages}`**
resolve the target in this order:

1. A `.3pitor/` note is written directly. This applies to Write and Edit only.
2. An exact key in `turn.texts`, or an id that `posts.get` resolves, is the post.
3. Anything else throws `` `${file_path} is not a post. Call Posts to list the posts by id, or NewPost to make one.` ``

**Posts `{}`** returns `JSON.stringify` of `[{ id, title }]`, sorted by title with `localeCompare`, then by id. For
example: `[{"id":"notes","title":"notes"},{"id":"series/one","title":"One"}]`.

**NewPost `{title, content}`** runs four steps:

1. `refuseUnsupported(content)` runs before anything is made, so a refusal leaves no post.
2. `id = await posts.create({ title, body: '' })`. A `PostError` returns its message as the tool result.
3. `markEdited(turn, id, content)` runs, the content is highlighted, and `onChange()` is called.
4. The tool returns `` `made post ${JSON.stringify(id)} titled ${JSON.stringify(title)}; its text is in the editor, unsaved` ``.

**What the AI can still reach.** Read and Glob reach everything `FileSystem` reaches, so the AI can still read
`CLAUDE.md` and side files. Write and Edit change only posts and `.3pitor/` notes.

**Worked example, browser to tools and back:**

```text
browser sends   {"text":"tighten it","openFile":"series/one","documents":{"series/one":"# One\n…"}}
engine builds   turn.texts = Map{"series/one" → "# One\n…"}
tool call       Edit {"file_path":"series/one", …}  →  "edited series/one"
closing part    data-session {"aborted":false,"edited":{"series/one":"…"},"highlights":{"file":"series/one","passages":[…]}}
```

`"./series/one"` is a different key, and it is refused.

**The open post in the prompt.** The user turn names it as
`` `The post open in my editor is ${JSON.stringify(openFile)}. When my message does not name a post, it means this post.` ``.
The quoting means an id holding a newline or a quote stays on one line.

### UI

**The post list.** `src/ui/documents/post-list/post-list.tsx` replaces the tree
([D-8](artifacts/change-decision-log.md#d-8-the-sidebar-is-a-flat-post-list-sorted-by-title)).

- **Rows** are the listed posts, sorted by `a.title.localeCompare(b.title)`, then by id. Each row's text is
  `label(id)`, which is the post's title.
- **Rows for missing posts.** Dirty open entries whose id is not listed get a row after the posts. Its visible text is
  `{label(id)} — unsaved, not in your posts`.
- **The "+" New post dialog** has one field, labelled "Title". Create is enabled when `title.trim() !== ''`
  ([D-13](artifacts/change-decision-log.md#d-13-new-post-takes-only-a-non-blank-title)).
  - When the trimmed title equals a listed title, the hint line reads:
    "You already have a post titled “{title}”. Both will show as “{title}” in the list."
    ([D-27](artifacts/change-decision-log.md#d-27-a-duplicate-title-is-allowed-and-warned-not-refused))
  - Create sends `POST /api/posts { title }`, opens the returned id, and moves focus into the editor.
- **The "…" menu on each row** offers Rename and Delete.
  - **Rename** opens a dialog headed "Rename “{title}”", with one field labelled "Title" that starts as the current
    title. Submit is disabled when the title is blank or unchanged. `/` is allowed. The hint reads: "Only the name in
    the list changes. The post's text, including any heading at the top, stays as it is." The duplicate hint above
    applies here too. Submit sends `PUT …/title`.
  - **Delete** opens a confirm titled "Delete “{title}”?". Its body reads: "This deletes the post's folder on disk, with
    any other files in it, such as notes or outlines. You can't undo this." When the post has unsaved edits, it adds:
    "Your unsaved changes to it will be lost too." Focus starts on Cancel, the button keeps the `danger` class, and
    confirming sends `DELETE`.
- **While the AI works,** every change is locked. The list keeps `id="tree-paused"`, with the note "Changes to the post
  list are paused while Claude works. You can still open posts." The editor's `aria-describedby` still points at it.
- **Hooks kept from the tree.** The list opens the New post dialog on `docs.newPosts`, which is the empty editor's New
  post button. It scrolls the active row into view on `docs.finds`, which is the header's "Show in the post list"
  button.

**One label for posts everywhere** ([D-28](artifacts/change-decision-log.md#d-28-the-writer-sees-titles-and-every-message-says-what-to-do-next)).
`label(id)` is the listed title, or the id when the post is not listed. Every string that names a post uses it:

- the header
- the Save and Claude-edit failure notices
- the Undo dialog
- the "Show “{label}” in the post list" button's `aria-label`

**The `useDocuments` hook** keys everything by id:

- **Rename** keeps the id, so nothing is re-keyed.
- **Delete** forgets exactly that id, with no prefix matching. Deleting `the sun` leaves `the sun 2` open.
- **Save** sends `PUT …/body` and never creates
  ([D-9](artifacts/change-decision-log.md#d-9-save-only-ever-updates-an-existing-post)).
- **New posts** open with an empty body. Nothing seeds an H1 or keeps one in step with the title
  ([D-12](artifacts/change-decision-log.md#d-12-new-posts-start-empty-and-nothing-keeps-an-h1-in-step-with-the-title)).
- **AI edits to a post that is not open** go through `applyEdited`:
  - When the id is not listed, it first awaits `refreshList()`. That way a post `NewPost` just made is never mistaken
    for a missing one.
  - It then loads the post with `GET /api/posts/:id`, sharing `ensureLoaded`'s dedupe, before merging.
  - A 404 becomes a `notApplied` entry whose message is the 404 body's `error` text.

**Notices say what to do next, and can be dismissed.**

- **A failed Save** reads: "Could not save “{label}”: {error}. Copy your changes into another post."
- **An edit Claude could not apply** reads: "Could not apply Claude's edit to “{label}”: {error}. Ask Claude again with
  the post open."
- **Dismissing.** The `notApplied` and `notUndone` notices get the existing `CloseIcon` dismiss button.

**The missing-post state** ([D-14](artifacts/change-decision-log.md#d-14-a-gone-post-can-only-be-discarded)) applies when
`listLoaded && !posts.some(p => p.id === id)` for an open entry.

- **Notice.** "These unsaved changes belong to a post that isn't in your list, so they can't be saved here. To keep them,
  copy them into a post from the list. Then discard them."
- **Discard.** A **Discard** button opens a `ConfirmDialog` titled "Discard these unsaved changes?". Its body reads
  "The text goes for good. Copy anything you want to keep first." The confirm label is "Discard changes", and focus
  starts on Cancel. Confirming calls `forget(id)`.
- **The editor** stays editable and selectable, so the text can be copied. Save is disabled.
- **The AI.** The entry is left out of `beginTurn().documents`.
- **A clean entry** for a missing post is forgotten after a 404, as today.

**Undo all after `NewPost`**
([D-29](artifacts/change-decision-log.md#d-29-undo-all-leaves-a-post-the-ai-made-listed-and-empty)). Undo all treats the
new post like any other edited post: it returns to the base it had when the turn began, which is the empty body on
disk. The post stays listed and open, and empty. When the turn made posts, the warning adds: "Posts Claude made stay in
your list, empty. Delete them from the list if you don't want them." The announcement reads: "Undid Claude's changes in
{n} posts. Posts it made are still in your list."

**Restoring the view**
([D-19](artifacts/change-decision-log.md#d-19-restore-checks-every-stored-reference-against-the-post-list)). The shape of
`view.json` is unchanged, and its values are ids. Restore first awaits `refreshList()`, then handles each field by
whether its id is in the list:

| Field | Listed | Not listed |
| --- | --- | --- |
| `unsaved[]` | tracked as today | tracked, shown as a missing-post row |
| `current` | `ensureLoaded`, as today | kept only if it is a restored unsaved entry, otherwise dropped |
| `highlights` | kept | dropped |
| `turn.file` | kept | set to `undefined` |
| `turn.bases` | key kept | key dropped |
| `notApplied[]` | kept | dropped |

If the list request fails, nothing is dropped. The missing-post state then marks entries after the next successful sync.

Session records are not rewritten. `applyPending` goes through `applyEdited`, so an old key becomes one dismissable
`notApplied` entry. An old tool call replayed to the model fails with the refusal above, which points the model to
`Posts`.

### System prompt and skills

The `<tools>` block in `system-prompt.ts` becomes the text below, which contains no `${` and no backslash
([D-17](artifacts/change-decision-log.md#d-17-the-system-prompt-teaches-ids-titles-posts-and-newpost)):

> Every post has an id and a title. Name a post by its id, exactly as Posts lists it or as the writer's message names
> the open post; the title is shown to the writer apart from the text. Read a post before you change it. Use Edit to
> change part of a post, Write to replace a whole post, and NewPost to make a new post from a title and its text. Each
> change appears in the writer's editor as an unsaved edit the moment you make it, with the text it changed
> highlighted, and the writer reviews and saves them. Other workspace files, such as CLAUDE.md, can be found with Glob
> and read with Read, but not changed; paths outside the workspace are refused. A markdown file under .3pitor/ is saved
> directly and never opens in the editor, so the writer has nothing to review or save there. Use Highlight to point the
> writer at the passages you are talking about; they appear highlighted in the editor as soon as you call it, replacing
> the highlights before.

The skills change as follows
([D-18](artifacts/change-decision-log.md#d-18-skills-take-a-post-id-the-lessons-file-moves-under-3pitor-and-series-lessons-are-dropped)).

**`collaborative-editing`**

- **Which post.** Its argument is a post id. With no argument, it uses the open post. If none is open, it calls `Posts`,
  lists the titles, and asks.
- **The log file.** Its slug is the id with each `/` turned into `-`. The log's first line records the id, as
  `Post: <id>`. Resume uses a log only when that line names the same id.
- **Lessons.** The file is `.3pitor/editing-lessons.md`. The skill also reads a root `editing-lessons.md` when Glob finds
  one. It writes only the lessons the writer accepted in chat. The reminder to save the lessons file is dropped.
- **Series.** Series notes are read from a `README.md` at the workspace root, or one the writer names, and are never
  written. The "series" placement for a new lesson is removed. A lesson is either general or dropped.

**The other skills**

- **`proofread`** takes a post id.
- **`research`** writes into "the post open in the editor".
- **The `tools:` line.** Every skill whose `tools:` line lists the post tools adds `Posts` and `NewPost`. A test checks
  that every tool a skill's `tools:` line names is one the main agent is offered.

### What goes away

- **Engine:** `src/engine/documents/`, `Engine['documents']`, and the `DocumentError` re-export.
- **Server:** `src/server/documents/`.
- **UI:** `src/ui/documents/file-tree/`, `src/ui/documents/components/paths.ts` and its test, and
  `src/ui/components/fake-documents-api.ts`.
- **Wire types:** the four `Document*` and `FolderCount` types.
- **Tools:** `resolvePost` and `postName`.

`newEntryName` stays in `src/shared/`, because the store uses it.

## Surface Delta

### S-1: `EngineOptions.posts` and the cli wiring — Added

**Target state.** `EngineOptions` has a required field, `posts: PostStore`, typed with
`import type { PostStore } from '../posts/posts'`. `cli.ts` builds `createFilePostStore(fileSystem)` on the same
`FileSystem` it passes as `fileSystem`, and passes the store as `posts`. `fileSystem` stays, for app state, notes,
skills, config, and the tools' Read and Glob.

**Behavior.** Preserving. Nothing reads `posts` until later entries, and the factory does no I/O until a method is
called.

**Why.** The store must reach the engine before anything can use it
([C-2](artifacts/current-state-findings.md#c-2-cli-builds-only-a-filesystem-and-the-engine-watches-it-with-the-unsubscribe-thrown-away),
[C-3](artifacts/current-state-findings.md#c-3-the-engine-keeps-filesystem-for-everything-that-is-not-a-post)).

**Migration.** Every caller that builds engine options passes `posts: createFilePostStore(fileSystem)` (S-26).

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-engine-hands-the-store-itself-to-the-server)

### S-2: `Engine['posts']` — Added

**Target state.** `Engine` has `readonly posts: Omit<PostStore, 'watch'>`, which is the store passed in. The server
reaches posts only through it, and only the engine subscribes to changes.

**Behavior.** Preserving. It is a new handle with no callers until S-4.

**Why.** It replaces `Engine['documents']`
([C-4](artifacts/current-state-findings.md#c-4-documentsts-is-the-documents-api-and-all-of-it-goes-one-export-has-another-importer))
without a wrapping layer.

**Depends on.** S-1.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-engine-hands-the-store-itself-to-the-server)

### S-3: the engine's change subscription and the `posts-changed` event — Re-scoped

**Target state.**

- `startEngine` subscribes `posts.watch(() => events.emit({ type: 'posts-changed' }))`.
- If `sessions.load()` rejects, `startEngine` calls the unsubscribe before rethrowing.
- `HostEvent` has `{ type: 'posts-changed' }`, and no `documents-changed`.
- `app.tsx` runs `syncWithDisk` on `posts-changed`.
- `engine.ts` no longer imports `isHiddenKey`.

**Behavior.** Changing. WebSocket listeners see a new event name. A change to `.post.json` now signals, and each save
through the app signals twice. A write to a loose root `.md` still signals, and changes nothing visible. The UI's echo
guards absorb the repeat
([C-15](artifacts/current-state-findings.md#c-15-the-stores-watch-changes-what-signals-and-it-signals-each-own-write-twice)).
Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** The design swaps the watch at integration and leaves the event name to integration (design D19, D26).
`posts.ts` says the caller must call the unsubscribe when it stops listening, and `engine.test.ts` builds engines with
`startEngine`, so a test whose load fails would otherwise leak a live watcher.

**Depends on.** S-1.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-engine-subscribes-postswatch-emits-posts-changed-and-drops-the-subscription-if-startup-fails)

### S-4: `src/server/posts/posts.routes.ts` — Added

**Target state.** A Hono feature module serves the six routes in Target State › HTTP routes from `Engine['posts']`. It
maps `PostError` to `{ error: error.message }` with 404 or 400, and maps its private `BadBody` to 400. `server.ts`
mounts it.

**Behavior.** Changing.

- The browser gets new URLs.
- The error sentences are the store's two fixed ones.
- Create takes only a title.
- A taken title gets a ` 2` id instead of a 400.
- A title with no usable characters makes `Untitled` instead of a 400 (BC6).

Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** The UI needs HTTP access to the store
([C-6](artifacts/current-state-findings.md#c-6-routes-are-apidocuments-keyed-by-a-name-path-parameter-and-map-documenterror-to-404-or-400)).

**Depends on.** S-2, S-5.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-post-routes-status-mapping-and-how-ids-travel),
[D-7](artifacts/change-decision-log.md#d-7-a-bad-request-body-is-a-route-private-badbody-error)

### S-5: post wire types in `src/shared/wire.ts` — Added

**Target state.** `wire.ts` declares `PostSummary`, `PostList`, `Post`, `CreatePostBody`, `SetTitleBody`, and
`SetBodyBody`, exactly as pinned in Target State › Wire types.

**Behavior.** Preserving. These types are new. The `HostEvent` change pinned beside them belongs to S-3.

**Why.** Shared and the UI cannot import posts
([C-1](artifacts/current-state-findings.md#c-1-the-import-rules-fix-where-each-integration-piece-may-sit)).

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-wire-types-restate-the-post-shapes-and-the-compiler-keeps-them-in-step)

### S-6: `fileTools` post resolution — Re-scoped

**Target state.** `fileTools(fileSystem, posts, appSkillFiles, turn, onChange)` resolves `file_path` as an exact post
id, as pinned in Target State › AI tools: first through the turn copy, then through the store. `turn.texts` is keyed by
id, taken verbatim from the browser. Write and Edit change only posts and `.3pitor/` notes, and refuse anything else
with the pinned message. Read falls back to the workspace file. `resolvePost` and `postName` do not exist.

**Behavior.** Changing. For the AI, `the sun/draft.md` is no longer a post, and `the sun` is. Write, Edit, and
Highlight on a non-post file are refused; today a root `.md` file is treated as a post
([C-10](artifacts/current-state-findings.md#c-10-resolvepost-is-the-tools-post-check-and-it-is-path-shaped),
[C-20](artifacts/current-state-findings.md#c-20-a-root-editing-lessonsmd-is-written-through-the-post-path-today)).
Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** BC1 and BC10: ids are exact, and no longer paths.

**Depends on.** S-1.

**Migration.** These callers pass `posts`: `agent.ts`; `tools.test.ts`; `claude-cli.test.ts:153`; the mcp-endpoint
test's tool setup; and `agent.test.ts`, through `agentSettings`.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-tools-name-posts-by-exact-id-and-refuse-to-change-anything-else)

### S-7: the `Posts` tool — Added

**Target state.** A `Posts` tool, with empty input, returns every post as `[{ id, title }]` JSON, sorted by title and
then by id. The main agent is offered it wherever Read is offered. Subagents are not.

**Behavior.** Changing. The AI gains a way to find posts by id.

**Why.** Glob returns `the sun/draft.md`, which is not an id. Without this tool the AI reaches only the posts the editor
holds
([C-19](artifacts/current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing)).

**Depends on.** S-6.

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-a-posts-tool-lists-posts-for-the-ai)

### S-8: the `NewPost` tool — Added

**Target state.** `NewPost {title, content}` refuses unsupported content first. It then creates an empty post with
`posts.create({ title, body: '' })`, and puts `content` into the turn copy as an unsaved edit of the new id, as pinned
in Target State › AI tools.

**Behavior.** Changing. The AI now writes to disk during a turn: a new, empty, titled post appears in the list as soon as
the tool runs. It stays if the turn is stopped or undone. The post's text still reaches disk only through the writer's
Save. Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** With no upsert, a post the AI makes must go through `create` (BC5)
([C-8](artifacts/current-state-findings.md#c-8-save-is-an-explicit-upsert-that-creates-missing-folders-and-the-ui-depends-on-that-for-ai-made-posts)).

**Depends on.** S-6.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-the-ai-makes-a-post-with-newpost-which-creates-it-empty-on-disk-at-once),
[D-29](artifacts/change-decision-log.md#d-29-undo-all-leaves-a-post-the-ai-made-listed-and-empty)

### S-9: the open-post line in the user turn — Re-scoped

**Target state.** `sessions.ts` names the open post as
`` `The post open in my editor is ${JSON.stringify(openFile)}. When my message does not name a post, it means this post.` ``

**Behavior.** Changing. The model's prompt text changes, and the id is quoted.

**Why.** An id can now be nearly any folder name, including one that holds a newline
([C-18](artifacts/current-state-findings.md#c-18-the-chat-route-trusts-the-browsers-post-map-and-open-file-and-puts-the-open-file-into-the-models-prompt)).

**Decision.** [D-16](artifacts/change-decision-log.md#d-16-ids-from-the-browser-and-the-ai-are-resolved-at-the-store-never-trusted-as-paths)

### S-10: the system prompt's `<tools>` block — Re-scoped

**Target state.** The block is the text pinned in Target State › System prompt and skills.

**Behavior.** Changing. The AI is told about ids, titles, `Posts`, and `NewPost`, and that other files are read-only.

**Why.** The current text teaches path addressing
([C-19](artifacts/current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing)).

**Depends on.** S-7, S-8.

**Decision.** [D-17](artifacts/change-decision-log.md#d-17-the-system-prompt-teaches-ids-titles-posts-and-newpost)

### S-11: the `collaborative-editing`, `proofread`, and `research` skills — Re-scoped

**Target state.** The three skills address posts by id, as pinned in Target State › System prompt and skills. The
editing lessons live in `.3pitor/editing-lessons.md`. Series notes are read-only, and a lesson cannot be placed on a
series. Each skill's `tools:` line names only tools the main agent is offered.

**Behavior.** Changing. These are observable differences:

- Accepted lessons are saved straight to a git-ignored file, without passing through the editor.
- Series notes are found only at the root, or where the writer names them, and the skill never writes them.
- With no argument and no open post, the skill offers post titles.

Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** The skills depend on paths and on writing `.md` files outside posts
([C-19](artifacts/current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing),
[C-20](artifacts/current-state-findings.md#c-20-a-root-editing-lessonsmd-is-written-through-the-post-path-today)).

**Depends on.** S-6, S-7, S-8.

**Decision.** [D-18](artifacts/change-decision-log.md#d-18-skills-take-a-post-id-the-lessons-file-moves-under-3pitor-and-series-lessons-are-dropped)

### S-12: `src/ui/documents/post-list/` — Added

**Target state.** `PostList` renders the sorted posts and the missing-post rows. It holds the "+" New post dialog and
the per-row Rename and Delete dialogs, with the copy pinned in Target State › UI. It keeps `id="tree-paused"`, and it
answers `docs.newPosts` and `docs.finds`. It holds no path logic.

**Behavior.** Changing. Writers see post titles in a flat list, with no folders or side files. A duplicate title is
warned about rather than refused.

**Why.** This is the direction of travel the user confirmed
([C-5](artifacts/current-state-findings.md#c-5-todays-list-returns-every-folder-and-md-file-sorted-by-path-the-ui-nests-them-by-)).

**Depends on.** S-4, S-14.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-sidebar-is-a-flat-post-list-sorted-by-title),
[D-13](artifacts/change-decision-log.md#d-13-new-post-takes-only-a-non-blank-title),
[D-27](artifacts/change-decision-log.md#d-27-a-duplicate-title-is-allowed-and-warned-not-refused),
[D-28](artifacts/change-decision-log.md#d-28-the-writer-sees-titles-and-every-message-says-what-to-do-next)

### S-13: `src/ui/documents/file-tree/` — Removed

**Target state.** No tree component exists. Listing and naming posts belongs to `PostList`. The app has no drag and
drop, no move dialog, no folder menu, and no file count, and it cannot move posts between folders.

**Behavior.** Changing. Writers can no longer move posts or make folders in the app (BC7).

**Why.** The tree exists only for the hierarchy
([C-27](artifacts/current-state-findings.md#c-27-pathsts-and-the-trees-path-algebra-serve-only-the-hierarchy)).

**Depends on.** S-12.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-sidebar-is-a-flat-post-list-sorted-by-title)

### S-14: the `useDocuments` hook — Re-scoped

**Target state.** The hook holds open posts keyed by exact id. It talks to the server with these calls:

- list: `GET /api/posts`
- read: `GET`
- save: `PUT …/body`
- rename: `PUT …/title`
- delete: `DELETE`
- create: `POST /api/posts { title }`

It exposes the listed titles and `label(id)`. It has no path algebra, no move, no folder creation, and no count.
`applyEdited` refreshes the list for an id that is not listed, then loads the post before merging, as pinned. Undo all
treats a post the AI made like any other edited post.

**Behavior.** Changing. These are the observable differences:

- Save never recreates a deleted post.
- Rename keeps the post open under the same id.
- Delete forgets exactly one post.
- New posts open empty, with no `# title`, and the editor takes focus.
- The header and the notices show the title.

Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** BC1, BC2, and BC4–BC8
([C-8](artifacts/current-state-findings.md#c-8-save-is-an-explicit-upsert-that-creates-missing-folders-and-the-ui-depends-on-that-for-ai-made-posts),
[C-12](artifacts/current-state-findings.md#c-12-rename-is-a-move-and-move-is-the-only-code-that-rewrites-keys-in-ui-state),
[C-13](artifacts/current-state-findings.md#c-13-delete-is-recursive-and-prefix-matched-in-the-ui-with-a-count-shown-first-for-folders)).

**Depends on.** S-3, S-4.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-save-only-ever-updates-an-existing-post),
[D-12](artifacts/change-decision-log.md#d-12-new-posts-start-empty-and-nothing-keeps-an-h1-in-step-with-the-title),
[D-28](artifacts/change-decision-log.md#d-28-the-writer-sees-titles-and-every-message-says-what-to-do-next),
[D-29](artifacts/change-decision-log.md#d-29-undo-all-leaves-a-post-the-ai-made-listed-and-empty)

### S-15: the missing-post state — Added

**Target state.** An open entry whose id is not in a loaded list is in the missing-post state:

- Save is disabled.
- It shows the pinned notice, with a Discard button that asks to confirm before discarding.
- Its editor stays editable and selectable.
- It is excluded from what the AI sees.

It replaces the `onDisk` flag and the notice "Save creates it".

**Behavior.** Changing. A writer whose post was deleted elsewhere, or whose unsaved draft dates from before the
upgrade, sees the notice and can copy the text or discard it. Today, Save would quietly recreate the post.

**Why.** Without it, those entries can never leave
([C-29](artifacts/current-state-findings.md#c-29-a-dirty-entry-for-a-post-that-is-gone-can-never-be-saved-under-the-store)).

**Depends on.** S-14.

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-a-gone-post-can-only-be-discarded)

### S-16: view-state restore — Re-scoped

**Target state.** Restore loads the post list first. It then handles each stored field by whether its id is listed, as
pinned in the restore table. The shape of `view.json` is unchanged, and nothing on the server parses it.

**Behavior.** Changing. After the upgrade, references to draft paths drop out, and unsaved edits made before the
upgrade come back as missing-post rows.

**Why.** The design's Open Risks: "Integration must drop or check such references"
([C-21](artifacts/current-state-findings.md#c-21-viewjson-stores-post-names-in-seven-places-cast-rather-than-parsed-and-restores-them-unchecked),
[C-23](artifacts/current-state-findings.md#c-23-tombstones-last-only-for-the-store-instance-so-a-restart-can-give-a-deleted-posts-id-to-a-new-post)).

**Depends on.** S-14, S-15.

**Decision.** [D-19](artifacts/change-decision-log.md#d-19-restore-checks-every-stored-reference-against-the-post-list)

### S-17: re-applying the last turn from `session.json` — Re-scoped

**Target state.** `applyPending` re-applies a stored turn through `applyEdited`, which loads each post before merging. A
key that names no post becomes one dismissable `notApplied` entry, and no open entry. `session.json` is never
rewritten.

**Behavior.** Changing. Old chat sessions no longer reopen phantom entries for draft paths. They show one notice
instead.

**Why.** Session records hold old paths
([C-22](artifacts/current-state-findings.md#c-22-sessionjson-stores-old-post-names-inside-chat-records-and-the-ui-re-applies-the-last-turn-on-load)).

**Depends on.** S-14.

**Decision.** [D-19](artifacts/change-decision-log.md#d-19-restore-checks-every-stored-reference-against-the-post-list)

### S-18: `src/ui/documents/components/paths.ts` — Removed

**Target state.** No path helpers exist in the UI, and nothing in the UI parses or builds an id.

**Behavior.** Preserving for writers. Its last consumers go with S-13 and S-14. `paths.test.ts` is deleted with it.

**Why.** [C-27](artifacts/current-state-findings.md#c-27-pathsts-and-the-trees-path-algebra-serve-only-the-hierarchy)

**Depends on.** S-13, S-14.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-sidebar-is-a-flat-post-list-sorted-by-title)

### S-19: `src/ui/components/fake-posts-api.ts` — Added

**Target state.** A test fake serves the six post routes from an in-memory map of `{ title, body }`.

- **Ids.** They come from a counter that is never reused: `"1/p 1"`, `"2/p 2"`, and so on. Each one holds a `/` and a
  space and never equals a title, so a missing `encodeURIComponent` or an id built from a title fails a test.
- **Listing.** It returns posts newest first, which is not title order, so a missing sort in the UI fails a test.
- **Refusals.** It returns 404 with `{"error":"That post no longer exists."}` for a GET, PUT of the title or body, or
  DELETE on an id it does not hold, including one it deleted. It returns 400 with `{"error":"A post needs a title."}`
  for a blank title.
- **Creating.** It never upserts, and it makes posts with an empty body.
- **Types.** Its bodies use `satisfies` against the wire types.
- **Events.** It sends no events. Tests send `posts-changed` themselves.

**Behavior.** Preserving. It is test-only.

**Why.** UI tests must catch any code that builds or encodes an id wrongly, or that skips sorting
([C-25](artifacts/current-state-findings.md#c-25-the-ui-fake-re-implements-the-old-routes-upsert-included)).

**Depends on.** S-5.

**Decision.** [D-20](artifacts/change-decision-log.md#d-20-the-ui-fake-uses-hostile-opaque-ids-and-refuses-like-the-store)

### S-20: `src/ui/components/fake-documents-api.ts` — Removed

**Target state.** No fake of the documents routes exists. UI tests use `fake-posts-api.ts`.

**Behavior.** Preserving. It is test-only.

**Depends on.** S-19, S-14.

**Decision.** [D-20](artifacts/change-decision-log.md#d-20-the-ui-fake-uses-hostile-opaque-ids-and-refuses-like-the-store)

### S-21: the shipped fixture workspace — Moved

**Target state.** `src/fixtures/workspace/notes.md` is at `src/fixtures/workspace/notes/draft.md`, and its title falls
back to `notes`. The fixture ships no view state: `.3pitor/` is git-ignored, so nothing opens on a first run.

**Behavior.** Changing. A first-time user sees one post, `notes`, in the list. Before, they saw a loose `notes.md` in the
tree. In both cases nothing is open.

**Why.** Without the move, a first run shows an empty list
([C-26](artifacts/current-state-findings.md#c-26-server-and-engine-tests-the-check-script-and-the-shipped-fixture-all-use-loose-root-md-files-as-documents)).

**Depends on.** S-22, which lands in the same unit, because the live check reads `notes.md`.

**Decision.** [D-21](artifacts/change-decision-log.md#d-21-the-fixture-and-the-live-check-move-onto-real-posts-together)

### S-22: `src/server/scripts/check.ts` — Re-scoped

**Target state.** The live check gets every post it uses from `POST /api/posts`, or from the fixture's `notes`, and
addresses each one by its id. It round-trips create, set body, and get. It stores `current: <id>` in the view state.
Its new-post scenario asks for a post titled Summary, then asserts three things:

- `edited[id]` is set.
- The stored body is `''`.
- The title is `Summary`.

It is run as `bun src/server/scripts/check.ts`.

**Behavior.** Preserving for writers. Changing for a developer who runs it: the scenarios are new, and the new-post
scenario now expects an empty post on disk where it used to expect none.

**Why.** [C-26](artifacts/current-state-findings.md#c-26-server-and-engine-tests-the-check-script-and-the-shipped-fixture-all-use-loose-root-md-files-as-documents)

**Depends on.** S-4, S-8.

**Decision.** [D-21](artifacts/change-decision-log.md#d-21-the-fixture-and-the-live-check-move-onto-real-posts-together)

### S-23: the engine documents API — Removed

**Target state.** `src/engine/documents/`, `Engine['documents']`, and the `DocumentError` re-export from `engine.ts` do
not exist. Post operations belong to the `PostStore` behind `Engine['posts']`. The app does not move entries, make
folders, or count a folder's contents. `draftText` and the H1 seeding are gone.

**Behavior.** Changing, together with S-24. The old operations stop existing (BC7).

**Why.** This is the direction of travel the user confirmed
([C-4](artifacts/current-state-findings.md#c-4-documentsts-is-the-documents-api-and-all-of-it-goes-one-export-has-another-importer)).

**Depends on.** S-14, S-22, S-6.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-documents-api-is-removed-after-every-consumer-moves)

### S-24: `src/server/documents/` — Removed

**Target state.** No `/api/documents` route exists, and those URLs answer 404.

**Behavior.** Changing. A client of the old URLs gets a 404. The UI and `check.ts` were the only clients, and both have
moved by then.

**Depends on.** S-14, S-22.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-documents-api-is-removed-after-every-consumer-moves)

### S-25: `DocumentEntry`, `DocumentList`, `CreatedPost`, `FolderCount` — Removed

**Target state.** `wire.ts` carries no folder or file-kind types. `ApiError`'s comment names the post routes.

**Behavior.** Preserving. No consumers are left by then.

**Depends on.** S-23, S-24, S-20.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-documents-api-is-removed-after-every-consumer-moves)

### S-26: callers that build engine or tool options in tests — Re-scoped

**Target state.** Every test that builds an engine, agent settings, or file tools passes
`posts: createFilePostStore(fileSystem)` inline. There is no shared builder. These are the callers:

- `engine.test.ts`: the five `createEngine` calls, and `startEngine` in `startupOutput`
- the workspace-config routes test
- the view-state routes test
- `documents.routes.test.ts:27`, until Unit 8
- the two engines in the mcp-endpoint test
- `agent.test.ts:63`, `:84`, `:105`, and `:113`, through `agentSettings`
- `claude-cli.test.ts:153`, through `fileTools`, in Unit 4
- `tools.test.ts`, in Unit 4

**Behavior.** Preserving. These are tests only.

**Depends on.** S-1.

**Decision.** [D-22](artifacts/change-decision-log.md#trivial-decisions)

### S-27: `README.md` — Re-scoped

**Target state.** The README describes:

- cli building the store
- the engine taking `posts` and exposing `Engine['posts']`
- `src/server/posts/` and its endpoints
- the server answering only this machine and its own page
- the post list in the UI
- the `posts-changed` event
- that the app lists only folders that hold `draft.md`, and leaves loose files and side files on disk

It says nothing about the documents API, the tree, or "Nothing imports it yet". It names cli, server, and engine as the
importers of the posts package, and the store as the only production user of `newEntryName`.

Line 6 changes from "Claude never writes files" to "Claude never writes a post's text; it can make a new, empty post,
and save its own notes under `.3pitor/`."

The rule that a capability spanning packages uses the same name in each now gives `chat` and `events` as its examples.
It notes that the server's `posts/` routes serve the UI's `documents/` feature, which holds the editor and the post
list.

**Behavior.** Changing for a README reader: line 6's promise is restated. Preserving for code.

**Depends on.** S-23.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-documents-api-is-removed-after-every-consumer-moves),
[D-31](artifacts/change-decision-log.md#d-31-the-readme-feature-name-rule-is-reworded)

### S-28: `startServer`'s listening address — Re-scoped

**Target state.** `Bun.serve` in `startServer` listens on `127.0.0.1` only, and its URL is `http://127.0.0.1:<port>/`.

**Behavior.** Changing. Other machines on the network can no longer reach the app. A writer who opened it from another
device loses that.

**Why.** The server answers on every interface, with no authentication, and the new routes add `DELETE`
([C-30](artifacts/current-state-findings.md#c-30-the-server-answers-on-every-interface-and-checks-neither-host-nor-origin)).

**Decision.** [D-25](artifacts/change-decision-log.md#d-25-the-server-answers-only-this-machine-and-its-own-page)

### S-29: the same-machine request check — Added

**Target state.** `server.ts` wraps `app.fetch` in `sameMachine`, pinned in Target State › The server answers only
this machine and its own page. A request with a foreign `Host`, or a foreign `Origin`, gets plain-text
`403 Forbidden`. That covers every API route and the `/ws/events` upgrade.

**Behavior.** Changing. A page on another site, or a DNS-rebinding page, can no longer call the API or open the event
socket. The app's own page is unaffected.

**Why.** [C-30](artifacts/current-state-findings.md#c-30-the-server-answers-on-every-interface-and-checks-neither-host-nor-origin)

**Depends on.** S-28.

**Decision.** [D-25](artifacts/change-decision-log.md#d-25-the-server-answers-only-this-machine-and-its-own-page)

## Behavior Changes

I settled every one of these under the user's standing instruction to decide without asking, and I report them here
instead of asking
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

- **The sidebar is a flat list of post titles** (S-12, S-13). Folders, loose `.md` files, side files such as
  `outline.md`, and empty folders no longer appear, but they stay on disk. There is no drag and drop, no "Move to…",
  and no folder creation.
- **Rename changes the title only** (S-14). The folder on disk keeps its name, and the post stays open.
- **New post asks only for a title** (S-12, S-4, S-14). It makes the post at the top level.
  - A taken title is allowed, with a warning that both posts will show the same name.
  - A title with no usable characters makes a folder called `Untitled`.
  - The post opens empty, with no `# title` heading.
- **Delete removes the post and its side files for good** (S-14). The confirm says so, and no longer counts files.
- **Save never recreates a deleted post** (S-14, S-15). An open post that is not in the list shows "These unsaved
  changes belong to a post that isn't in your list…", with a Discard button that asks to confirm. Save is disabled.
- **The AI can make posts, which writes an empty post to disk at once** (S-8). The post appears in the list with its
  title and no text, and the AI's text shows in the editor as an unsaved edit. The empty post stays if the turn is
  stopped or undone, and the Undo dialog says so.
- **The AI finds posts by id and title** (S-6, S-7, S-10). It can still read loose files and side files, but it can no
  longer change them.
- **Editing lessons move to `.3pitor/editing-lessons.md`** (S-11). The AI saves the lessons the writer accepts
  directly, without the editor, and the file is ignored by git. Series notes are read from the workspace root, or from
  where the writer says, and are never written. A lesson can no longer be filed under a series.
- **Messages name posts by title and say what to do next** (S-14). The server's two fixed sentences are "That post no
  longer exists." and "A post needs a title."
- **After the upgrade, the open post, highlights, and notices that pointed at draft paths are dropped** (S-16, S-17).
  Unsaved edits made before the upgrade come back as rows saying they are not in your posts. Those can be copied and
  discarded, but not saved. An old chat's last turn shows one notice that can be dismissed.
- **The first-run workspace shows one post, `notes`** (S-21).
- **The app answers only on this machine** (S-28). It can no longer be opened from another device on the network.
- **Other websites cannot call the app** (S-29). That includes pages that trick the browser into treating them as
  local, and it covers both requests and the event socket.
- **WebSocket listeners see `posts-changed` instead of `documents-changed`** (S-3). It fires for title changes, and
  twice per save.
- **The old `/api/documents` URLs answer 404** (S-24).
- **The AI's prompt quotes the open post's id** (S-9), and describes ids, titles, `Posts`, and `NewPost` (S-10).
- **The README's promise changes** (S-27). "Claude never writes files" becomes "Claude never writes a post's text…".
- **For developers, the live check's new-post scenario changes** (S-22). It now expects an empty post on disk.

## Change Units

Each unit leaves `make test` green and the app working.

### Unit 1: Wire the store in

**What it does.** cli builds the file store and passes it to the engine. The engine exposes `Engine['posts']`. Every
caller in S-26 that exists now passes a store. Nothing uses the store yet.

**Delta entries.** S-1, S-2, S-26 (all but the Unit 4 callers).

**How you know it worked.** `make test` passes. It type-checks the test files too, so a caller left out fails.
`src/posts/boundary.test.ts` passes with cli and engine importing the package. The existing `cli.test.ts` startup tests
pass unchanged: "the current session is ready", the picker catalog, and the watch test.

### Unit 2: Swap the watch and rename the event

**What it does.** The engine subscribes `posts.watch`, emits `posts-changed`, and drops the subscription if startup
fails. `app.tsx`, `app.test.tsx:575`, and `cli.test.ts:61` move to the new name. The old documents API keeps working,
because its writes go through the same `FileSystem` the store watches.

**Delta entries.** S-3.

**Ordering constraint.** After Unit 1.

**How you know it worked.**

- `cli.test.ts`'s watch test writes `<folder>/draft.md`, a real post, and sees `{"type":"posts-changed"}`.
- `app.test.tsx` sends `posts-changed` and sees the sync.
- An engine test with an inline stub store and a rejecting session load shows that the stub's unsubscribe was called.

### Unit 3: Lock the server to this machine, and add the post routes

**What it does.** `startServer` listens on `127.0.0.1` and refuses a foreign `Host` or `Origin`. The unit adds the wire
types and `src/server/posts/posts.routes.ts` with its tests, mounted in `server.ts`. The old routes stay.

**Delta entries.** S-28, S-29, S-4, S-5.

**Ordering constraint.** After Unit 1.

**How you know it worked.**

Server tests check `sameMachine`:
- A request with `Host: evil.example` gets 403.
- A request with `Origin: https://evil.example` gets 403, on a POST and on the `/ws/events` upgrade.
- Requests with no `Origin`, or with the server's own, pass.
- The server's URL is `127.0.0.1`.

Route tests run against a real file store in a temp workspace, and cover:
- every route's 200 body
- create on a taken title, which returns `{"id":"The Sun 2"}`
- `"???"` as a title, which makes `Untitled`
- a blank title, which gets 400 "A post needs a title."
- PUT title, PUT body, DELETE, and GET on a deleted id, which each get 404
- a nested id `series/one` round-tripping through `%2F` on GET, PUT, and DELETE
- `%2E%2E%2F.3pitor%2Fconfig.json`, which gets 404
- a body that is not JSON, which gets 400 starting "the request body is not valid"

`make typecheck` checks the `c.json<WireType>` pairs.

### Unit 4: Tools resolve ids, and gain `Posts`

**What it does.** `fileTools` takes `posts`. The `Posts` tool is added. Post resolution tries the turn copy, then the
store.

For now, the old path behavior stays as the last fallback, so the old UI's path keys still work. A turn key or
`file_path` ending in `.md` is still normalized and treated as before. Every other key is verbatim. Unit 7 removes the
fallback.

**Delta entries.** S-6 (partly), S-7, S-26 (the Unit 4 callers).

**Ordering constraint.** After Unit 1. The fallback is removed in Unit 7.

**How you know it worked.**

Tool tests show:
- Read, Write, Edit, and Highlight work on an id.
- Read prefers the turn copy over the store body when the two differ.
- Read returns the store body when the turn holds nothing.
- A store `get` that fails with anything but `not-found` makes Read throw. This uses an inline stub.
- `Posts` lists `[{id, title}]`, with two posts of the same title ordered by id.
- The main agent's tool names include `Posts`. `agent.test.ts:84-93` still shows subagents get only `Read`.

The path tests at `tools.test.ts:33`, `:78`, `:89`, `:154`, and `:249` still pass, through the fallback.

### Unit 5: The post list component

**What it does.** Adds `post-list/` and its own tests, without mounting it yet. It takes posts, entries that are not in
the list, and callbacks as props.

**Delta entries.** S-12 (the component only).

**Ordering constraint.** Any time before Unit 6.

**How you know it worked.** Component tests, which find rows by role and text, cover:

- sorting by title, then by id
- rows for missing posts, with their visible status text
- the non-blank gate and the duplicate-title hint in New post and Rename
- Rename's unchanged-title gate
- the Delete copy, with and without unsaved edits
- locking while the AI works, and `tree-paused`
- `newPosts` opening the dialog, and `finds` scrolling the row into view

### Unit 6: Cut the UI over to posts

**What it does.** The hook moves onto `/api/posts` and ids. It gains the restore checks, the missing-post state, the
labels and notices, and refresh-then-load for AI edits. `app.tsx` mounts the post list. The UI tests move onto
`fake-posts-api.ts`. The tree, `paths.ts`, its test, and the old fake are deleted.

**Delta entries.** S-12 (mounting), S-13, S-14, S-15, S-16, S-17, S-18, S-19, S-20.

**Ordering constraint.** After Units 2, 3, 4, and 5. The UI, its fake, and its tests are one consumer of the key
contract, so they move together. Until Unit 7, the AI still follows the old prompt, and paths it tries show up as
`notApplied` notices. That is degraded, but safe. The fixture stays at `notes.md` until Unit 7, so in this unit a first
run shows an empty list.

**How you know it worked.** UI tests against the fake show:

- **Save on a missing post.** Saving an id the fake no longer holds gets a 404, and the entry enters the missing-post
  state: Save is disabled, the pinned notice shows, Discard asks to confirm and then forgets the entry, and the entry is
  left out of `beginTurn().documents`. This replaces `documents.test.tsx:1590`.
- **Rename** keeps the entry open with its unsaved edits, and the header shows the new title.
- **Delete** of `"1/p 1"` leaves a second open post whose id shares that prefix.
- **Request URLs** carry each id `encodeURIComponent`-ed.
- **AI edits to a post that is not open** refresh the list, then load the post. A 404 gives one `notApplied`.
- **One table-driven restore test** covers all six rows of the restore table, a `view.json` naming `the sun/draft.md`,
  and a list request that fails.
- **An old session record** gives one dismissable `notApplied`, and no open entry.
- **The double signal.** The existing test "a file being saved when a sync reads it is not said to have changed on
  disk" now sends two `posts-changed` events.
- **Undo all after a `NewPost`** leaves the post listed, open, and empty, with the pinned warning.

### Unit 7: Move the AI onto ids, and the fixture onto a post

**What it does.**

- Adds `NewPost`, the prompt block, the quoted open-post line, and the three skill rewrites, with the skill tool-name
  test.
- Moves the fixture to `notes/draft.md`.
- Moves `check.ts` onto posts.
- Removes the legacy path fallback, `resolvePost`, and `postName`.

**Delta entries.** S-6 (the rest), S-8, S-9, S-10, S-11, S-21, S-22.

**Ordering constraint.** After Unit 6. The path fallback can go only once no UI sends path keys. The fixture moves with
`check.ts`, which reads `notes.md` until then.

**How you know it worked.**

- Tool tests show `NewPost` creates an empty post, keys the edit by the id it returns, and returns the quoted message.
  Two `NewPost` calls with one title give two ids.
- A blank title returns the `PostError` message.
- Unsupported content leaves `posts.list()` empty.
- A Write to `the sun/draft.md`, or to a root `notes.md`, is refused with "is not a post. Call Posts".
- `sessions.test.ts:172` asserts the new open-post line. An id that holds a newline stays on one line.
- The skill test shows every tool named in each skill's `tools:` line is offered to the main agent.
- The existing mcp-endpoint tests that edit a root `notes.md` move onto a `notes/draft.md` post with the id `notes`.
- A test seeds a workspace from `WORKSPACE_FIXTURE` and shows `GET /api/posts` returns
  `{"posts":[{"id":"notes","title":"notes"}]}`.
- `bun src/server/scripts/check.ts` passes its rewritten scenarios against a real model.

### Unit 8: Remove the documents API

**What it does.** Deletes the engine documents module, `Engine['documents']`, the `DocumentError` export, the server
documents routes, their tests, and the four wire types. Updates the README.

**Delta entries.** S-23, S-24, S-25, S-27.

**Ordering constraint.** After Units 6 and 7. `check.ts` calls `/api/documents` until Unit 7, and the type checker would
not catch that.

**How you know it worked.** `make test` and `make build` pass. Searching `src/` for `DocumentError`, `/api/documents`,
`documents-changed`, `createFolder(`, and `countContents` finds nothing outside `src/file-system/`.

## Risks

- **Unit 6 is large.** Blast radius: the whole editor. It covers `documents.tsx` (896 lines) and its 1,673-line test,
  and it deletes the tree's 888-line test. These are among the most-churned UI files in the last 90 days. About 40 of
  the 112 tests in `documents.test.tsx` are tied to paths, folders, moves, `onDisk`, or upsert. That count comes from
  test titles only. Unit 5 takes the list out of Unit 6. Run the full UI suite after each step inside the unit.
- **A deleted id can be reused after a restart**
  ([C-23](artifacts/current-state-findings.md#c-23-tombstones-last-only-for-the-store-instance-so-a-restart-can-give-a-deleted-posts-id-to-a-new-post)).
  A restored unsaved entry then attaches to the new post. The existing "changed on disk" check catches it when the
  bodies differ. When they are equal, the attach is silent. This is accepted and recorded in Deferred (YAGNI).
- **Editing lessons are an instruction channel that skips the editor** (security review, SEC-005). Text the model reads
  could talk it into writing a "lesson" to `.3pitor/editing-lessons.md`. That file then steers later editing runs, and
  nothing about it shows up in the editor or in git. The skill writes only lessons the writer accepted in chat, and
  every edit those later runs make is still reviewed. Accepted
  ([D-18](artifacts/change-decision-log.md#d-18-skills-take-a-post-id-the-lessons-file-moves-under-3pitor-and-series-lessons-are-dropped)).
- **AI edits during the cutover.** Between Units 6 and 7 the model is still told to use paths, so its edits fail as
  `notApplied`. Land Units 6 and 7 close together.
- **The fake cannot show signal ordering.** No UI test sees the race between an HTTP response and the first
  `posts-changed`. Only the live `cli.test.ts` process test and `check.ts` see real signals. The existing echo guards
  handle that race
  ([C-15](artifacts/current-state-findings.md#c-15-the-stores-watch-changes-what-signals-and-it-signals-each-own-write-twice)).
- **The skill reference files have not been read in full**
  ([C-19](artifacts/current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing)). The builder
  reads `src/skills/collaborative-editing/references/` when editing the skill.
- **Double signals cost I/O**
  ([C-15](artifacts/current-state-findings.md#c-15-the-stores-watch-changes-what-signals-and-it-signals-each-own-write-twice)).
  Each save costs about two extra rounds of listing and reading. That is acceptable at the app's size.
- **The protection against cross-site deletes depends on the HTTP methods.** Today, a cross-site page can fire
  `POST /api/documents/delete`. The new routes close that only because delete and save use `DELETE` and `PUT`, and the
  server sends no CORS headers. S-29 makes the protection deliberate. A future change must not move them to `POST`, or
  add CORS headers.

## Deferred (YAGNI)

- **`Engine.stop()`.** Nothing calls it. Reopen when a host or a test must stop the engine.
- **A version marker in `view.json` or `session.json`.** The list check catches every old form. Reopen at the database
  migration, when old ids might still resolve.
- **Remapping `X/draft.md` to `X` on restore.** The design keeps ids opaque, and migrating saved references is out of
  scope. Reopen if a writer reports losing drafts from before the upgrade.
- **Storing a title with each reference, to catch a reused id after a restart.** Reopen on a reported attach to the
  wrong post.
- **"Save as new post" for an entry whose post is missing.** Discard satisfies the finding. Reopen if a writer loses
  text in that state.
- **Creating the AI's post on first Save instead of at once.** Reopen if an empty post on disk during a turn proves
  unacceptable.
- **Deleting a post the AI made when the writer clicks Undo all.** Reopen if writers find the leftover empty posts a
  nuisance.
- **Showing the id on rows whose titles clash.** The hint at creation covers new duplicates. Reopen if duplicates from
  before the upgrade are common, such as nested posts that share a last segment and so a fallback title.
- **An in-app notice that loose files are no longer listed.** The README covers it. Reopen on a report of "lost" files.
- **A `SetTitle` tool for the AI.** Reopen when a writer asks the AI to rename posts.
- **`Posts` for subagents.** Reopen when an agent needs to find posts on its own.
- **Renaming `openFile`, `file`, and `name` to post-id names.** Reopen on a bug that mixes up a path and an id.
- **Renaming `src/ui/documents/` to `src/ui/posts/`.** It is high churn for symmetry alone. Reopen at the next
  restructuring of that feature.
- **A shared test builder for `EngineOptions`, or a shared stub `PostStore`.** Each caller differs in `env`. Reopen when
  the next required option lands.
- **Passing ids as a query parameter.** Reopen if a store can issue an id of `.` or `..`.
- **An event pump in the fake, or a test checking the fake against the real routes.** The route tests and `satisfies`
  catch drift. Reopen if the fake and the routes disagree in a shipped bug.
- **A test that a `""` turn key is skipped.** No browser path sends one. Reopen if one is seen.

## Cut for Scope

- **CS-1: A database-backed store, and migrating saved references to it.** It would have given posts a database home and
  remapped saved references. The design, and the user's confirmed scope, place it later and separately
  ([scope-boundary.md](artifacts/scope-boundary.md), Stated Exclusions).
- **CS-2: A read-only file view beside the post list.** It would have kept loose files and side files visible. The user
  chose the flat list without one ([scope-boundary.md](artifacts/scope-boundary.md), Direction of Travel).
- **CS-3: Catching listener throws in `EventBus.emit`.** It would stop one failing WebSocket from cutting off other
  tabs. That defect exists today and is untouched by this change
  ([C-16](artifacts/current-state-findings.md#c-16-one-throwing-listener-stops-the-event-bus-for-every-later-listener)).
  It is outside the integration list in the boundary.
- **CS-4: Restarting a watcher that has died.** It would keep outside edits reaching the UI after the local watcher
  fails. That defect exists today
  ([C-24](artifacts/current-state-findings.md#c-24-nothing-stops-the-engine-and-a-dead-watcher-is-never-noticed)), and
  it is outside the boundary.

The user can reinstate any of these, and their saying so is itself the justification the reinstated entry records.

## Open Items

- **Non-blocking: are nested posts sharing a fallback title common in real workspaces?** One example is `a/part-1`
  beside `b/part-1`, which would both show as `part-1`. Looking at a real workspace would settle it. If they are common,
  reopen the deferred id label on rows with clashing titles.
- **Non-blocking: do Chrome's Local Network Access rules, or Safari and Firefox's protections against DNS rebinding,
  already block the attacks S-29 covers?** It doesn't matter for this plan, since S-29 is cheap either way. A
  live-browser test would settle it.

## Review Findings

One round ran with four specialists. Each one read the current-state findings first. The decisions each finding
produced are in [artifacts/change-decision-log.md](artifacts/change-decision-log.md), D-25 to D-31, along with the
amended D-1, D-6, D-16, D-18, D-20, D-21, and D-23.

- **`han-core:adversarial-security-analyst`** sent 17 hostile ids through the repo's own Hono and the real store, and
  found no id input that escapes the workspace, reaches a hidden file, or reaches another post. Its findings that
  changed the plan:
  - The server answers on every network interface, which gave S-28 (High, proven against the LAN address).
  - It has no `Host` check or `Origin` check, which gave S-29 (Medium).
  - Cross-site text could reach disk through create, which led to dropping `body` from `CreatePostBody` (Medium).
  - The lessons file skips the editor, which is recorded as an accepted risk (Medium).
  - D-16's wording conflicted with the Target State, and is fixed.

  Its notes on live-browser rebinding protections and machine firewalls are Unverified, and are not blocking.
- **`han-core:test-engineer`**:
  - The fixture never shipped a `view.json`, which corrected C-21 and S-21.
  - `check.ts` would break between Units 6 and 7, which moved the fixture into Unit 7.
  - Unit 4's verbatim-keys rule and its fallback contradicted each other. That is now pinned.
  - S-26 named too few callers.
  - It suggested a fake with hostile ids, missing tests in each unit, a test for skill tool names, and the right live
    check command.

  Its test counts rest on test titles only, and are Unverified.
- **`han-core:user-experience-designer`**:
  - The gone notice read false after the upgrade, and Discard needed a confirm.
  - Duplicate titles needed a warning, and the Delete wording needed to mention side files.
  - Undo all needed to explain the post the AI made.
  - The AI's new post could briefly look missing, which led to refresh-then-load.
  - Every message should name posts by title, notices should be dismissable, and the Rename dialog needed pinning.
  - Focus should move to the editor after Create.
  - The tree's hooks needed to be kept.

  Its note on how the WebSocket and SSE channels are ordered is Unverified, and the fix covers both orders.
- **`han-core:junior-developer`**:
  - Series-lesson writes had no target, so they are dropped (D-18).
  - The plan's uses of ids beyond store-and-pass-back are now recorded (D-30).
  - Duplicate titles are now handled (D-27).
  - The README's feature-name rule is reworded (D-31).
  - Log slugs could collide, so the log now records its id.
  - The error-message source is pinned.
  - The Preserving labels on S-5, S-22, and S-27 are corrected.

  JD-010 asked to defer unsubscribe-on-failure. It stays, because `engine.test.ts` calls `startEngine`, and `posts.ts`
  requires the unsubscribe.

No finding was left open. The review reached the round cap needed: no finding named a domain that was not covered.

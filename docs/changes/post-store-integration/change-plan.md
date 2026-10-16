# Change Plan: Post Store Integration

## Why This Change

The posts store in `src/posts/` was built and merged in PR #38, but nothing uses it yet. The app still reads, saves,
lists, and deletes posts through the old documents API, by draft path. The design the store came from,
[`api-design.md`](../post-management-api/api-design.md), deferred the hookup as a separate change: "Integration does
later (G7)", with the behavior changes listed as BC1–BC14. This plan carries that out.

The reason class is **a decision already taken**. The user confirmed the scope and the direction of travel: the old
documents API goes away entirely, and the sidebar becomes a flat list of posts
([scope-boundary.md](artifacts/scope-boundary.md)). The plan does not reopen the design's own decisions
([D-1](artifacts/change-decision-log.md#d-1-the-plan-executes-the-design-and-reopens-none-of-it)).

## What Changes, In One Paragraph

Afterwards, every post the app shows, opens, saves, renames, or deletes goes through one `PostStore`. A post is named
by an opaque id, its folder key (`the sun`), and the app never builds that id from a path or parses one out of it. The
title is stored apart from the text. The sidebar is a flat list of post titles. Rename changes the title, and the id
stays the same. Save only ever updates a post that exists. When an open post has been deleted, its unsaved text is shown
as gone and can be discarded, never saved back over something else. The AI names posts by id, finds them with a `Posts`
tool, and makes new ones with a `NewPost` tool. Saved view state and chat sessions are checked against the post list
when they are restored, so references to old draft paths or deleted posts drop out instead of turning into phantom
entries. The engine keeps `FileSystem` for everything that is not a post: app state, notes, skills, config, and the
AI's read-only access to workspace files.

## Current State

The documents API is a second, path-based model of posts, and it runs beside the store
([C-4](artifacts/current-state-findings.md#c-4-documentsts-is-the-documents-api-and-all-of-it-goes-one-export-has-another-importer)).
Its list is every folder and every `.md` file, sorted by path. The UI nests that list into a tree whose post rows all
read `draft.md`
([C-5](artifacts/current-state-findings.md#c-5-todays-list-returns-every-folder-and-md-file-sorted-by-path-the-ui-nests-them-by-)).

The structural problem this change addresses is identity. The post reference is a path string, and it crosses every
layer under several field names
([C-17](artifacts/current-state-findings.md#c-17-the-post-name-crosses-every-layer-as-a-bare-string-under-several-field-names)).
These layers each re-derive or rewrite it:

- the tools' `resolvePost` ([C-10](artifacts/current-state-findings.md#c-10-resolvepost-is-the-tools-post-check-and-it-is-path-shaped))
- the UI's path algebra ([C-27](artifacts/current-state-findings.md#c-27-pathsts-and-the-trees-path-algebra-serve-only-the-hierarchy))
- move re-keying ([C-12](artifacts/current-state-findings.md#c-12-rename-is-a-move-and-move-is-the-only-code-that-rewrites-keys-in-ui-state))
- prefix-matched delete ([C-13](artifacts/current-state-findings.md#c-13-delete-is-recursive-and-prefix-matched-in-the-ui-with-a-count-shown-first-for-folders))

Save is an upsert, and the AI's way of making a post depends on it
([C-8](artifacts/current-state-findings.md#c-8-save-is-an-explicit-upsert-that-creates-missing-folders-and-the-ui-depends-on-that-for-ai-made-posts),
[C-9](artifacts/current-state-findings.md#c-9-the-ai-tools-never-write-a-post-to-disk-they-change-an-in-memory-copy-for-the-turn)).

The title exists only as a folder name and an H1 written when the post is made
([C-11](artifacts/current-state-findings.md#c-11-a-title-exists-today-only-as-a-folder-name-and-an-h1-seeded-at-create-time)).

Persisted state holds path strings, with no check and no version:

- `view.json` ([C-21](artifacts/current-state-findings.md#c-21-viewjson-stores-post-names-in-seven-places-cast-rather-than-parsed-and-restores-them-unchecked))
- `session.json` ([C-22](artifacts/current-state-findings.md#c-22-sessionjson-stores-old-post-names-inside-chat-records-and-the-ui-re-applies-the-last-turn-on-load))

The store's own guarantees already remove two of today's races
([C-28](artifacts/current-state-findings.md#c-28-the-stores-per-post-queue-already-fixes-two-of-todays-races)). They also
create one new trap: a dirty entry whose post is gone can never be saved
([C-29](artifacts/current-state-findings.md#c-29-a-dirty-entry-for-a-post-that-is-gone-can-never-be-saved-under-the-store)).

The import rules decide where each piece may sit
([C-1](artifacts/current-state-findings.md#c-1-the-import-rules-fix-where-each-integration-piece-may-sit)). The engine
must keep `FileSystem` for everything that is not a post
([C-3](artifacts/current-state-findings.md#c-3-the-engine-keeps-filesystem-for-everything-that-is-not-a-post)).

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

`createEngine` still never watches. The engine does not re-export `PostError`. The server imports it from
`posts/post-error`, which the boundary test allows.

### HTTP routes

There is one new server feature module, `src/server/posts/posts.routes.ts`
([D-6](artifacts/change-decision-log.md#d-6-post-routes-status-mapping-and-how-ids-travel)). Every request and response
body is JSON. A 4xx body is `ApiError { error: string }`. Any other failure is logged and answered with plain-text
`500 Internal Server Error`.

| Method | Path | Request body | 200 response | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/posts` | none | `PostList`, `{"posts":[{"id":"the sun","title":"The Sun"}]}`, unsorted | none |
| GET | `/api/posts/:id` | none | `Post`, `{"id":"the sun","title":"The Sun","body":"…"}` | 404 |
| POST | `/api/posts` | `CreatePostBody`, `{"title":"The Sun","body":""}` | `{"id":"The Sun 2"}` | 400 blank title; 400 bad body |
| PUT | `/api/posts/:id/title` | `SetTitleBody`, `{"title":"…"}` | `{"ok":true}` | 404; 400 blank title; 400 bad body |
| PUT | `/api/posts/:id/body` | `SetBodyBody`, `{"body":"…"}` | `{"ok":true}` | 404; 400 bad body |
| DELETE | `/api/posts/:id` | none | `{"ok":true}` | 404 |

**Ids in URLs** are one path segment, with `encodeURIComponent(id)` on the client. `GET /api/posts/series%2Fone`
reaches the route with `id = "series/one"`. `%2F` already reaches `:name` intact today
([C-6](artifacts/current-state-findings.md#c-6-routes-are-apidocuments-keyed-by-a-name-path-parameter-and-map-documenterror-to-404-or-400)).

**Error mapping**, in `onError` in `posts.routes.ts`
([D-7](artifacts/change-decision-log.md#d-7-a-bad-request-body-is-a-route-private-badbody-error)):

- `PostError('not-found')` returns `404 {"error":"That post no longer exists."}`.
- `PostError('invalid')` returns `400 {"error":"A post needs a title."}`.
- `BadBody`, a class private to the module, returns `400 {"error":"the request body is not valid: <z.prettifyError text>"}`.
- Anything else is passed to `console.error` and returns `500`.

The UI still branches only on `status`
([C-7](artifacts/current-state-findings.md#c-7-the-ui-never-branches-on-an-error-reason-only-on-the-http-status-and-the-message)).

### Wire types

These are added to `src/shared/wire.ts`. They are restated by hand, because shared cannot import posts
([D-5](artifacts/change-decision-log.md#d-5-wire-types-restate-the-post-shapes-and-the-compiler-keeps-them-in-step)):

```ts
export interface PostSummary { id: string; title: string }
export interface PostList { posts: PostSummary[] }
export interface Post extends PostSummary { body: string }
export interface CreatePostBody { title: string; body: string }
export interface SetTitleBody { title: string }
export interface SetBodyBody { body: string }
// HostEvent: { type: 'posts-changed' } replaces { type: 'documents-changed' }
```

**Keeping them in step.** Each route answers with `c.json<WireType>(await posts.x(...))`, so `make typecheck` fails if
the contract's type stops being assignable to the wire type. Request bodies are checked three ways:

- The server parses them with `z.ZodType<WireBody>` schemas.
- The UI hook builds them with `satisfies`.
- The fake builds them with `satisfies`.

**What does not change.** The field names `openFile`, `file`, and `name` stay as they are in `ChatRequest`,
`SessionHighlights`, `SessionData`, `TurnProgress`, `StoredDoc`, `TurnRecord`, `NotApplied`, and `ViewState`. Their
values become exact post ids.

**Removed:** `DocumentEntry`, `DocumentList`, `CreatedPost`, and `FolderCount`.

### AI tools

`fileTools(fileSystem, posts, appSkillFiles, turn, onChange)` addresses posts by exact id
([D-10](artifacts/change-decision-log.md#d-10-the-ai-makes-a-post-with-newpost-which-creates-it-empty-on-disk-at-once),
[D-11](artifacts/change-decision-log.md#d-11-tools-name-posts-by-exact-id-and-refuse-to-change-anything-else),
[D-15](artifacts/change-decision-log.md#d-15-a-posts-tool-lists-posts-for-the-ai)).

The turn copy is `turn.texts: Map<PostId, string>`. Its keys are taken from the browser's `documents` map as sent: they
are never normalized, and `""` is skipped. The input field keeps the name `file_path`, for Claude Code compatibility.

- **Read `{file_path}`** tries these in order:
  1. `3pitor://skills/…` returns skill text.
  2. `turn.texts.get(file_path)`.
  3. `posts.get(file_path).body`. `PostError('not-found')` falls through to the next step, and any other error throws.
  4. `fileSystem.read(normalizeKey(file_path))`. A missing file gives `` `${file_path} does not exist` ``.
- **Write `{file_path, content}`, Edit `{file_path, old_string, new_string}`, and Highlight `{file_path, passages}`:**
  1. A `.3pitor/` note is written directly. This applies to Write and Edit only.
  2. An exact key in `turn.texts`, or an id that `posts.get` resolves, is the post.
  3. Anything else throws
     `` `${file_path} is not a post. Call Posts to list the posts by id, or NewPost to make one.` ``.
- **Posts `{}`** returns `JSON.stringify` of `[{ id, title }]`, sorted by title (`localeCompare`), then by id. For
  example: `[{"id":"notes","title":"notes"},{"id":"series/one","title":"One"}]`.
- **NewPost `{title, content}`** runs these steps:
  1. `refuseUnsupported(content)`.
  2. `id = await posts.create({ title, body: '' })`. A `PostError` returns its message.
  3. `markEdited(turn, id, content)`, highlight the content, then `onChange()`.
  4. Return `` `made post ${JSON.stringify(id)} titled ${JSON.stringify(title)}; its text is in the editor, unsaved` ``.

Read and Glob still reach everything `FileSystem` reaches, so the AI can still read `CLAUDE.md` and side files. Write
and Edit change only posts and `.3pitor/` notes.

**Worked example, browser to tools and back:**

```text
browser sends   {"text":"tighten it","openFile":"series/one","documents":{"series/one":"# One\n…"}}
engine builds   turn.texts = Map{"series/one" → "# One\n…"}
tool call       Edit {"file_path":"series/one", …}  →  "edited series/one"
closing part    data-session {"aborted":false,"edited":{"series/one":"…"},"highlights":{"file":"series/one","passages":[…]}}
```

`"./series/one"` is a different key, and it is refused.

The user turn names the open post as `` `The post open in my editor is ${JSON.stringify(openFile)}. …` ``, so an id
holding a newline cannot reshape the prompt
([D-16](artifacts/change-decision-log.md#d-16-ids-from-the-browser-and-the-ai-are-resolved-never-trusted)).

### UI

The tree is replaced by `src/ui/documents/post-list/post-list.tsx`
([D-8](artifacts/change-decision-log.md#d-8-the-sidebar-is-a-flat-post-list-sorted-by-title)):

- **Rows** are the listed posts, sorted by `a.title.localeCompare(b.title)`, then by id. Each row is labelled with its
  title.
- **Gone rows** are dirty open entries whose id is not listed. They come after the posts, labelled by their key, and
  marked "unsaved · post no longer exists".
- **"+" New post** asks for a title. Create is enabled when `title.trim() !== ''`
  ([D-13](artifacts/change-decision-log.md#d-13-new-post-takes-only-a-non-blank-title)). It sends
  `POST /api/posts { title, body: '' }` and opens the returned id. There is no folder hint and no parent.
- **"…" on a row** offers Rename, which sends `PUT …/title`, and Delete, which sends `DELETE`. Delete's confirm names
  any unsaved edits for that post and says it deletes the post for good.
- **While the AI works,** every change is locked.

The `useDocuments` hook keys everything by id:

- **Rename** keeps the id, so nothing is re-keyed.
- **Delete** forgets exactly that id, with no prefix matching.
- **The header** shows the listed title, or the id for a gone entry.
- **Save** sends `PUT …/body` and never creates
  ([D-9](artifacts/change-decision-log.md#d-9-save-only-ever-updates-an-existing-post)).
- **New posts** open with an empty body, and nothing seeds or syncs an H1
  ([D-12](artifacts/change-decision-log.md#d-12-new-posts-start-empty-and-nothing-keeps-an-h1-in-step-with-the-title)).
- **AI edits to a post that is not open** are applied by `applyEdited`, which loads the post with `GET /api/posts/:id`
  before merging. It shares `ensureLoaded`'s dedupe. A 404 becomes a `notApplied` entry carrying
  "That post no longer exists."

**The gone state**
([D-14](artifacts/change-decision-log.md#d-14-a-gone-post-can-only-be-discarded)):

- **Condition:** `listLoaded && !posts.some(p => p.id === id)` for an open entry.
- **Notice:** "This post no longer exists, so these unsaved changes can't be saved. Copy anything you want to keep,
  then discard them." A **Discard** button calls `forget(id)`.
- **Save** is disabled for the entry.
- **The AI** does not see the entry: it is left out of `beginTurn().documents`.
- **A clean gone entry** is forgotten after a 404, as today.

**Restoring the view**
([D-19](artifacts/change-decision-log.md#d-19-restore-checks-every-stored-reference-against-the-post-list)). The
`view.json` shape is unchanged, and its values are ids. Restore first awaits `refreshList()`. Each field is then handled
by whether the id it names is in the list:

| Field | Listed | Not listed |
| --- | --- | --- |
| `unsaved[]` | tracked as today | tracked, shown as a gone row |
| `current` | `ensureLoaded`, as today | kept only if it is a restored unsaved entry, otherwise dropped |
| `highlights` | kept | dropped |
| `turn.file` | kept | set to `undefined` |
| `turn.bases` | key kept | key dropped |
| `notApplied[]` | kept | dropped |

If the list request fails, nothing is dropped. The gone state then marks entries after the next sync that succeeds.

Session records are not rewritten. `applyPending` goes through `applyEdited`, whose load-then-merge turns an old key
into a single `notApplied` entry. When an old tool call is replayed to the model, it fails with the refusal message
above, which points to `Posts`.

### System prompt and skills

The `<tools>` block in `system-prompt.ts` becomes the text below
([D-17](artifacts/change-decision-log.md#d-17-the-system-prompt-teaches-ids-titles-posts-and-newpost)). It contains no
`${` and no backslash.

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
([D-18](artifacts/change-decision-log.md#d-18-skills-take-a-post-id-and-the-lessons-file-moves-under-3pitor)):

- **`collaborative-editing`:**
  - Its argument is a post id. With no argument it uses the open post, or calls `Posts`, lists the titles, and asks.
  - The log slug is the id with each `/` turned into `-`.
  - The lessons file is `.3pitor/editing-lessons.md`. The skill also reads a root `editing-lessons.md` when Glob finds
    one.
  - The reminder to save the lessons file is dropped.
  - Series notes are a `README.md` at the workspace root, or one the writer names.
- **`proofread`** takes a post id.
- **`research`** writes into "the post open in the editor".
- **Every skill** whose `tools:` line lists the post tools adds `Posts` and `NewPost`.

### What goes away

These are removed:

- Engine: `src/engine/documents/`, `Engine['documents']`, and the `DocumentError` re-export.
- Server: `src/server/documents/`.
- UI: `src/ui/documents/file-tree/`, `src/ui/documents/components/paths.ts` and its test, and
  `src/ui/components/fake-documents-api.ts`.
- Wire types: the four `Document*` and `FolderCount` types.
- Tools: `resolvePost` and `postName`.

`newEntryName` stays in `src/shared/`, because the store uses it.

## Surface Delta

### S-1: `EngineOptions.posts` and the cli wiring — Added

**Target state.** `EngineOptions` has a required field `posts: PostStore`, typed with
`import type { PostStore } from '../posts/posts'`. `cli.ts` builds `createFilePostStore(fileSystem)` on the same
`FileSystem` it passes as `fileSystem`, and passes it as `posts`. `fileSystem` stays, and serves app state, notes,
skills, config, and the tools' Read and Glob.

**Behavior.** Preserving. Nothing reads `posts` until later entries, and building the store does no I/O.

**Why.** The store must reach the engine before anything can use it
([C-2](artifacts/current-state-findings.md#c-2-cli-builds-only-a-filesystem-and-the-engine-watches-it-with-the-unsubscribe-thrown-away),
[C-3](artifacts/current-state-findings.md#c-3-the-engine-keeps-filesystem-for-everything-that-is-not-a-post)).

**Migration.** Every hand-built engine in a test passes `posts: createFilePostStore(fileSystem)` (S-26).

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-engine-hands-the-store-itself-to-the-server)

### S-2: `Engine['posts']` — Added

**Target state.** `Engine` has `readonly posts: Omit<PostStore, 'watch'>`, which is the store passed in. The server
reaches posts only through it. Only the engine subscribes to changes.

**Behavior.** Preserving. It is a new handle with no callers until S-4.

**Why.** It replaces `Engine['documents']`
([C-4](artifacts/current-state-findings.md#c-4-documentsts-is-the-documents-api-and-all-of-it-goes-one-export-has-another-importer))
without a wrapping layer.

**Depends on.** S-1.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-engine-hands-the-store-itself-to-the-server)

### S-3: the engine's change subscription and the `posts-changed` event — Re-scoped

**Target state.** `startEngine` subscribes `posts.watch(() => events.emit({ type: 'posts-changed' }))`. If
`sessions.load()` rejects, it calls the unsubscribe before rethrowing. `HostEvent` has `{ type: 'posts-changed' }` and no
`documents-changed`. `app.tsx` runs `syncWithDisk` on `posts-changed`. `isHiddenKey` is no longer imported by
`engine.ts`.

**Behavior.** Changing. These are observable differences:

- WebSocket listeners see a new event name.
- A change to `.post.json` now signals.
- Each save through the app signals twice: at once, and again from the watcher.
- A write to a loose `.md` file at the root still signals, because the store watches every non-hidden name. It changes
  nothing visible.

The UI's echo guards absorb the repeat
([C-15](artifacts/current-state-findings.md#c-15-the-stores-watch-changes-what-signals-and-it-signals-each-own-write-twice)).
Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** The design swaps the watch at integration and leaves the event name to integration (D19, D26 in the design).

**Depends on.** S-1.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-engine-subscribes-postswatch-emits-posts-changed-and-drops-the-subscription-if-startup-fails)

### S-4: `src/server/posts/posts.routes.ts` — Added

**Target state.** A Hono feature module serves the six routes in Target State › HTTP routes from `Engine['posts']`. It
maps `PostError` and its private `BadBody` to the pinned statuses and bodies. `server.ts` mounts it.

**Behavior.** Changing. The browser gets new URLs. The error sentences are the two fixed ones. A taken name gets a
` 2` suffix instead of a 400. A title with no usable characters makes `Untitled` instead of a 400 (BC6). These are
settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** The UI needs HTTP access to the store
([C-6](artifacts/current-state-findings.md#c-6-routes-are-apidocuments-keyed-by-a-name-path-parameter-and-map-documenterror-to-404-or-400)).

**Depends on.** S-2, S-5.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-post-routes-status-mapping-and-how-ids-travel),
[D-7](artifacts/change-decision-log.md#d-7-a-bad-request-body-is-a-route-private-badbody-error)

### S-5: post wire types in `src/shared/wire.ts` — Added

**Target state.** `wire.ts` declares `PostSummary`, `PostList`, `Post`, `CreatePostBody`, `SetTitleBody`, and
`SetBodyBody`, exactly as pinned in Target State › Wire types.

**Behavior.** Preserving. The types are new, and no existing type changes.

**Why.** Shared and the UI cannot import posts
([C-1](artifacts/current-state-findings.md#c-1-the-import-rules-fix-where-each-integration-piece-may-sit)).

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-wire-types-restate-the-post-shapes-and-the-compiler-keeps-them-in-step)

### S-6: `fileTools` post resolution — Re-scoped

**Target state.** `fileTools(fileSystem, posts, appSkillFiles, turn, onChange)` resolves `file_path` as an exact post
id, through the turn copy and then the store, as pinned in Target State › AI tools. `turn.texts` is keyed by id,
verbatim from the browser. Write and Edit change only posts and `.3pitor/` notes, and refuse anything else with the
pinned message. Read falls back to the workspace file. `resolvePost` and `postName` do not exist.

**Behavior.** Changing. For the AI, `the sun/draft.md` is no longer a post, and `the sun` is. Write, Edit, and
Highlight on a non-post file are refused, where today a root `.md` is treated as a post
([C-10](artifacts/current-state-findings.md#c-10-resolvepost-is-the-tools-post-check-and-it-is-path-shaped),
[C-20](artifacts/current-state-findings.md#c-20-a-root-editing-lessonsmd-is-written-through-the-post-path-today)).
Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** BC1 and BC10: ids are exact, and no longer paths.

**Depends on.** S-1.

**Migration.** `agent.ts` and the tool, claude-cli, and mcp-endpoint tests pass `posts`.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-tools-name-posts-by-exact-id-and-refuse-to-change-anything-else)

### S-7: the `Posts` tool — Added

**Target state.** A `Posts` tool with an empty input returns every post as `[{ id, title }]` JSON, sorted by title and
then id. It is offered wherever Read is offered to the main agent. Subagents do not get it.

**Behavior.** Changing. The AI gains a way to find posts by id.

**Why.** Glob returns `the sun/draft.md`, which is not an id. Without this tool the AI reaches only the posts the editor
holds
([C-19](artifacts/current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing)).

**Depends on.** S-6.

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-a-posts-tool-lists-posts-for-the-ai)

### S-8: the `NewPost` tool — Added

**Target state.** `NewPost {title, content}` creates an empty post through `posts.create({ title, body: '' })` and puts
`content` into the turn copy as an unsaved edit of the new id, as pinned in Target State › AI tools.

**Behavior.** Changing. The AI now writes to disk during a turn: a new, empty, titled post appears in the list as soon
as the tool runs. It stays if the turn is stopped or undone. The post's text still reaches disk only through the
writer's Save. Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** With no upsert, a post the AI makes must go through `create` (BC5)
([C-8](artifacts/current-state-findings.md#c-8-save-is-an-explicit-upsert-that-creates-missing-folders-and-the-ui-depends-on-that-for-ai-made-posts)).

**Depends on.** S-6.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-the-ai-makes-a-post-with-newpost-which-creates-it-empty-on-disk-at-once)

### S-9: the open-post line in the user turn — Re-scoped

**Target state.** `sessions.ts` names the open post as
`` `The post open in my editor is ${JSON.stringify(openFile)}. When my message does not name a post, it means this post.` ``

**Behavior.** Changing. The model's prompt text changes, and an id is quoted.

**Why.** An id can now be any folder name, including one holding a newline
([C-18](artifacts/current-state-findings.md#c-18-the-chat-route-trusts-the-browsers-post-map-and-open-file-and-puts-the-open-file-into-the-models-prompt)).

**Decision.** [D-16](artifacts/change-decision-log.md#d-16-ids-from-the-browser-and-the-ai-are-resolved-never-trusted)

### S-10: the system prompt's `<tools>` block — Re-scoped

**Target state.** The block is the text pinned in Target State › System prompt and skills.

**Behavior.** Changing. The AI is told about ids, titles, `Posts`, and `NewPost`, and that other files are read-only.

**Why.** The current text teaches path addressing
([C-19](artifacts/current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing)).

**Depends on.** S-7, S-8.

**Decision.** [D-17](artifacts/change-decision-log.md#d-17-the-system-prompt-teaches-ids-titles-posts-and-newpost)

### S-11: the `collaborative-editing`, `proofread`, and `research` skills — Re-scoped

**Target state.** The three skills address posts by id, as pinned in Target State › System prompt and skills. The
editing lessons live in `.3pitor/editing-lessons.md`.

**Behavior.** Changing. These are observable differences:

- Lessons are saved straight to a git-ignored file, with no review.
- Series notes are found only at the root or where the writer names them.
- With no argument, the skill offers post titles to pick from.

Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** The skills depend on paths and on writing a root `.md` file
([C-19](artifacts/current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing),
[C-20](artifacts/current-state-findings.md#c-20-a-root-editing-lessonsmd-is-written-through-the-post-path-today)).

**Depends on.** S-6, S-7, S-8.

**Decision.** [D-18](artifacts/change-decision-log.md#d-18-skills-take-a-post-id-and-the-lessons-file-moves-under-3pitor)

### S-12: `src/ui/documents/post-list/` — Added

**Target state.** `PostList` renders the sorted posts and the gone rows, a "+" New post dialog, and a per-row Rename
and Delete menu, as pinned in Target State › UI. It holds no path logic.

**Behavior.** Changing. Writers see post titles in a flat list, with no folders and no side files.

**Why.** It is the direction of travel the user confirmed
([C-5](artifacts/current-state-findings.md#c-5-todays-list-returns-every-folder-and-md-file-sorted-by-path-the-ui-nests-them-by-)).

**Depends on.** S-4, S-14.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-sidebar-is-a-flat-post-list-sorted-by-title),
[D-13](artifacts/change-decision-log.md#d-13-new-post-takes-only-a-non-blank-title)

### S-13: `src/ui/documents/file-tree/` — Removed

**Target state.** No tree component exists. Listing and naming posts belongs to `PostList`. There is no drag and drop,
no move dialog, no folder menu, and no file count. Moving posts between folders is not part of the app.

**Behavior.** Changing. Writers can no longer move posts or make folders in the app (BC7).

**Why.** The tree exists only for the hierarchy
([C-27](artifacts/current-state-findings.md#c-27-pathsts-and-the-trees-path-algebra-serve-only-the-hierarchy)).

**Depends on.** S-12.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-sidebar-is-a-flat-post-list-sorted-by-title)

### S-14: the `useDocuments` hook — Re-scoped

**Target state.** The hook holds open posts keyed by exact id. It lists with `GET /api/posts`, reads with `GET`, saves
with `PUT …/body`, renames with `PUT …/title`, deletes with `DELETE`, and creates with `POST /api/posts` and an empty
body. It exposes the listed titles. It holds no path algebra, no move, no folder creation, and no count. `applyEdited`
loads a post that is not open before merging, as pinned.

**Behavior.** Changing. These are observable differences:

- Save never recreates a deleted post.
- Rename keeps the post open under the same id.
- Delete forgets exactly one post.
- New posts open empty, with no `# title`.
- The header shows the title.

Settled under the standing delegation
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

**Why.** BC1, BC2, BC4–BC8
([C-8](artifacts/current-state-findings.md#c-8-save-is-an-explicit-upsert-that-creates-missing-folders-and-the-ui-depends-on-that-for-ai-made-posts),
[C-12](artifacts/current-state-findings.md#c-12-rename-is-a-move-and-move-is-the-only-code-that-rewrites-keys-in-ui-state),
[C-13](artifacts/current-state-findings.md#c-13-delete-is-recursive-and-prefix-matched-in-the-ui-with-a-count-shown-first-for-folders)).

**Depends on.** S-3, S-4.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-save-only-ever-updates-an-existing-post),
[D-12](artifacts/change-decision-log.md#d-12-new-posts-start-empty-and-nothing-keeps-an-h1-in-step-with-the-title)

### S-15: the gone state — Added

**Target state.** An open entry whose id is not in a loaded list is gone. Its Save is disabled. It shows the pinned
notice with a Discard button. It is excluded from what the AI sees. It replaces the `onDisk` flag and the notice
"Save creates it".

**Behavior.** Changing. A writer whose post was deleted elsewhere sees the notice, and can copy or discard the text.
Today Save would quietly recreate the post.

**Why.** Without it, such entries can never leave
([C-29](artifacts/current-state-findings.md#c-29-a-dirty-entry-for-a-post-that-is-gone-can-never-be-saved-under-the-store)).

**Depends on.** S-14.

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-a-gone-post-can-only-be-discarded)

### S-16: view-state restore — Re-scoped

**Target state.** Restore loads the post list first, and handles each stored field by whether its id is listed, as
pinned in the restore table. The `view.json` shape is unchanged, and nothing on the server parses it.

**Behavior.** Changing. After the upgrade, references to draft paths drop out. Unsaved edits made before the upgrade
come back as gone rows.

**Why.** "Integration must drop or check such references" (design Open Risks)
([C-21](artifacts/current-state-findings.md#c-21-viewjson-stores-post-names-in-seven-places-cast-rather-than-parsed-and-restores-them-unchecked),
[C-23](artifacts/current-state-findings.md#c-23-tombstones-last-only-for-the-store-instance-so-a-restart-can-give-a-deleted-posts-id-to-a-new-post)).

**Depends on.** S-14, S-15.

**Decision.** [D-19](artifacts/change-decision-log.md#d-19-restore-checks-every-stored-reference-against-the-post-list)

### S-17: re-applying the last turn from `session.json` — Re-scoped

**Target state.** `applyPending` re-applies a stored turn through `applyEdited`, which loads each post before merging. A
key that names no post becomes one `notApplied` entry, and makes no open entry. `session.json` is never rewritten.

**Behavior.** Changing. Old chat sessions no longer reopen phantom draft-path entries. They show one "That post no
longer exists." notice instead.

**Why.** Session records hold old paths
([C-22](artifacts/current-state-findings.md#c-22-sessionjson-stores-old-post-names-inside-chat-records-and-the-ui-re-applies-the-last-turn-on-load)).

**Depends on.** S-14.

**Decision.** [D-19](artifacts/change-decision-log.md#d-19-restore-checks-every-stored-reference-against-the-post-list)

### S-18: `src/ui/documents/components/paths.ts` — Removed

**Target state.** No path helpers exist in the UI. Nothing in the UI parses or builds an id.

**Behavior.** Preserving. Its last consumers go with S-13 and S-14.

**Why.** [C-27](artifacts/current-state-findings.md#c-27-pathsts-and-the-trees-path-algebra-serve-only-the-hierarchy)

**Depends on.** S-13, S-14.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-the-sidebar-is-a-flat-post-list-sorted-by-title)

### S-19: `src/ui/components/fake-posts-api.ts` — Added

**Target state.** A test fake serves the six post routes from an in-memory map of `{ title, body }` keyed by opaque ids
`post-1`, `post-2`, and so on, which never equal a title. It returns the pinned status codes and fixed sentences. It
never upserts, and it refuses a blank title. Its bodies use `satisfies` against the wire types.

**Behavior.** Preserving. It is test-only.

**Why.** UI tests must catch any code that builds an id from a title
([C-25](artifacts/current-state-findings.md#c-25-the-ui-fake-re-implements-the-old-routes-upsert-included)).

**Depends on.** S-5.

**Decision.** [D-20](artifacts/change-decision-log.md#d-20-the-ui-fake-uses-opaque-ids-and-refuses-like-the-store)

### S-20: `src/ui/components/fake-documents-api.ts` — Removed

**Target state.** No fake of the documents routes exists. UI tests use `fake-posts-api.ts`.

**Behavior.** Preserving. It is test-only.

**Depends on.** S-19, S-14.

**Decision.** [D-20](artifacts/change-decision-log.md#d-20-the-ui-fake-uses-opaque-ids-and-refuses-like-the-store)

### S-21: the shipped fixture workspace — Moved

**Target state.** `src/fixtures/workspace/notes.md` is at `src/fixtures/workspace/notes/draft.md`. Its title falls back
to `notes`. `src/fixtures/workspace/.3pitor/view.json` names `"notes"` wherever it named `"notes.md"`.

**Behavior.** Changing. A first-time user lands on one post called `notes`, open, instead of a loose `notes.md`.

**Why.** Otherwise a first run shows an empty list
([C-26](artifacts/current-state-findings.md#c-26-server-and-engine-tests-the-check-script-and-the-shipped-fixture-all-use-loose-root-md-files-as-documents)).

**Decision.** [D-21](artifacts/change-decision-log.md#d-21-the-fixture-and-the-live-check-move-onto-real-posts)

### S-22: `src/server/scripts/check.ts` — Re-scoped

**Target state.** The live check makes every post it uses with `POST /api/posts`, and addresses each one by the id
returned. It round-trips create, set body, and get. It stores `current: <id>` in the view state. Its new-post scenario
asks for a post titled Summary, then asserts:

- `edited[id]` is set
- the stored body is `''`
- the title is `Summary`

**Behavior.** Preserving for users. It is a developer check.

**Why.** [C-26](artifacts/current-state-findings.md#c-26-server-and-engine-tests-the-check-script-and-the-shipped-fixture-all-use-loose-root-md-files-as-documents)

**Depends on.** S-4, S-8.

**Decision.** [D-21](artifacts/change-decision-log.md#d-21-the-fixture-and-the-live-check-move-onto-real-posts)

### S-23: the engine documents API — Removed

**Target state.** These do not exist:

- `src/engine/documents/`
- `Engine['documents']`
- the `DocumentError` re-export from `engine.ts`

Post operations belong to the `PostStore` behind `Engine['posts']`. Moving entries, making folders, and counting a
folder's contents are not part of the app. `draftText` and the H1 seeding go too.

**Behavior.** Changing, together with S-24. The old operations stop existing (BC7).

**Why.** It is the direction of travel the user confirmed
([C-4](artifacts/current-state-findings.md#c-4-documentsts-is-the-documents-api-and-all-of-it-goes-one-export-has-another-importer)).

**Depends on.** S-14, S-22, S-6.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-documents-api-is-removed-after-every-consumer-moves)

### S-24: `src/server/documents/` — Removed

**Target state.** No `/api/documents` route exists. Those URLs answer 404.

**Behavior.** Changing. A client of the old URLs gets 404. The UI and `check.ts` are the only clients, and both have
moved by then.

**Depends on.** S-14, S-22.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-documents-api-is-removed-after-every-consumer-moves)

### S-25: `DocumentEntry`, `DocumentList`, `CreatedPost`, `FolderCount` — Removed

**Target state.** `wire.ts` carries no folder or file-kind types. `ApiError`'s comment names the post routes.

**Behavior.** Preserving. They have no consumers left by then.

**Depends on.** S-23, S-24, S-20.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-documents-api-is-removed-after-every-consumer-moves)

### S-26: hand-built test engines — Re-scoped

**Target state.** Every test that builds an engine passes `posts: createFilePostStore(fileSystem)` inline. That is the
five in `engine.test.ts`, plus the workspace-config routes test, the view-state routes test, and the two in the
mcp-endpoint test. There is no shared builder.

**Behavior.** Preserving. It is test-only.

**Depends on.** S-1.

**Decision.** [D-22](artifacts/change-decision-log.md#d-22-test-engines-use-the-real-file-store-inline)

### S-27: `README.md` — Re-scoped

**Target state.** The README describes:

- cli building the store
- the engine taking `posts` and exposing `Engine['posts']`
- `src/server/posts/` and its endpoints
- the post list in the UI
- the `posts-changed` event

It says nothing about the documents API, the tree, or "Nothing imports it yet". It names cli, server, and engine as the
posts package's importers, and the store as the only production user of `newEntryName`. It says Claude never
writes a post's text, but can make a new, empty post.

**Behavior.** Preserving. It is documentation.

**Depends on.** S-23.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-documents-api-is-removed-after-every-consumer-moves)

## Behavior Changes

Every one of these was settled by me under the user's standing instruction to decide without asking. Each is reported
here rather than asked
([D-24](artifacts/change-decision-log.md#d-24-behavior-changes-are-settled-under-the-users-standing-delegation)).

- **The sidebar is a flat list of post titles** (S-12, S-13). Folders, loose `.md` files, side files such as
  `outline.md`, and empty folders no longer appear. They stay on disk. There is no drag and drop, no "Move to…", and no
  folder creation.
- **Rename changes the title only** (S-14). The folder on disk keeps its name, and the post stays open.
- **New post asks only for a title** (S-12, S-4, S-14). It is made at the top level:
  - A title that's already taken gets " 2", " 3", and so on.
  - A title with no usable characters makes a folder called `Untitled`.
  - The post opens empty, with no `# title` heading.
- **Delete removes the post and its side files for good** (S-14). The confirm no longer counts files.
- **Save never recreates a deleted post** (S-14, S-15). An open post that was deleted elsewhere shows "This post no
  longer exists, so these unsaved changes can't be saved," with a Discard button. Save is disabled.
- **The AI can make posts, and doing so writes an empty post to disk at once** (S-8). The new post appears in the list
  with its title and no text. The AI's text shows in the editor as an unsaved edit. The empty post stays if the turn is
  stopped or undone.
- **The AI finds posts by id and title** (S-6, S-7, S-10). It can no longer change loose files or side files; it can
  still read them.
- **The editing-lessons file moves to `.3pitor/editing-lessons.md`** (S-11). The AI saves it directly, so it isn't
  reviewed and is ignored by git. Series notes are found only at the workspace root, or where the writer names them.
- **Error messages are fixed sentences** (S-4): "That post no longer exists." and "A post needs a title."
- **After the upgrade, the remembered open post, highlights, and notices that pointed at draft paths are dropped**
  (S-16, S-17). Unsaved edits made before the upgrade come back as gone rows, which can be copied and discarded but not
  saved. An old chat's last turn shows one "That post no longer exists." notice.
- **The first-run workspace shows one post, `notes`** (S-21).
- **WebSocket listeners see `posts-changed` instead of `documents-changed`** (S-3). The event fires for title changes,
  and twice for each save.
- **The old `/api/documents` URLs answer 404** (S-24).
- **The AI's prompt quotes the open post's id** (S-9), and describes ids, titles, `Posts`, and `NewPost` (S-10).

## Change Units

Each unit leaves `make test` green and the app working.

### Unit 1: Wire the store in

**What it does.** cli builds the file store and passes it to the engine. The engine exposes `Engine['posts']`. Every
hand-built test engine passes a store. Nothing uses it yet.

**Delta entries.** S-1, S-2, S-26.

**How you know it worked.** `make test` passes. `src/posts/boundary.test.ts` passes, with cli and engine now importing
the package. The app behaves exactly as before.

### Unit 2: Swap the watch, and rename the event

**What it does.** The engine subscribes `posts.watch`, emits `posts-changed`, and drops the subscription if startup
fails. `app.tsx` and `cli.test.ts` follow the new name. The old documents API keeps working, because its writes go
through the same `FileSystem` the store watches.

**Delta entries.** S-3.

**Ordering constraint.** After Unit 1.

**How you know it worked.** `cli.test.ts` sees `posts-changed` after a file changes in the workspace. That test writes
a root `notes.md`, which is not hidden, so the store's watcher still signals. A new engine test shows that a failing
`sessions.load()` leaves no live subscription.

### Unit 3: Post routes, beside the document routes

**What it does.** Adds the wire types and `src/server/posts/posts.routes.ts`, with its tests, mounted in `server.ts`.
The old routes stay.

**Delta entries.** S-4, S-5.

**Ordering constraint.** After Unit 1.

**How you know it worked.** The route tests cover these cases against a real file store in a temp workspace:

- each route's 200 body
- 404 and 400 with the fixed sentences
- a bad body
- `series%2Fone`

`make typecheck` checks the `c.json<WireType>` pairs.

### Unit 4: Tools resolve ids, and gain `Posts`

**What it does.** `fileTools` takes `posts`. Post resolution goes through the turn copy and then the store. Turn keys
are taken verbatim. The `Posts` tool is added. For now, today's `.md` path branch stays as the last fallback, so the old
UI's path keys still work.

**Delta entries.** S-6 (partly), S-7.

**Ordering constraint.** After Unit 1. The legacy fallback is removed in Unit 7.

**How you know it worked.** Tool tests show:

- Read, Write, Edit, and Highlight on an id work.
- `Posts` lists `[{id, title}]`, sorted.
- A Write to `editing-lessons.md` still works, through the fallback.

### Unit 5: The post list component

**What it does.** Adds `post-list/` with its own tests, not yet mounted. It takes posts, gone entries, and callbacks as
props.

**Delta entries.** S-12 (component only).

**Ordering constraint.** Any time before Unit 6.

**How you know it worked.** The component tests cover:

- sorting by title, then id
- gone rows
- the non-blank gate on Create
- the Rename and Delete menus
- locking while the AI works

### Unit 6: Cut the UI over to posts

**What it does.** The hook moves onto `/api/posts` and ids, with restore checks, the gone state, and load-then-merge for
AI edits. `app.tsx` mounts the post list. The UI tests move onto `fake-posts-api.ts`. The tree, `paths.ts`, and the old
fake are deleted. The fixture moves.

**Delta entries.** S-12 (mounting), S-13, S-14, S-15, S-16, S-17, S-18, S-19, S-20, S-21.

**Ordering constraint.** After Units 2, 3, 4, and 5. The UI, its fake, and its tests are one consumer of the key
contract, so they move together. Until Unit 7, the AI still follows the old prompt. Paths it tries surface as
`notApplied`, which is degraded but safe.

**How you know it worked.** UI tests pass against opaque ids. Restore of the shipped fixture's `view.json` opens
`notes`. Restore of a `view.json` naming `the sun/draft.md` shows a gone row and drops `current`. A deleted open post
shows the gone notice. The fake never upserts.

### Unit 7: Move the AI onto ids

**What it does.** Adds `NewPost`, the new prompt block, the quoted open-post line, and the three skill rewrites. Moves
`check.ts` onto posts. Removes the legacy path branch, `resolvePost`, and `postName`.

**Delta entries.** S-6 (rest), S-8, S-9, S-10, S-11, S-22.

**Ordering constraint.** After Unit 6. The old path fallback can go only once no UI sends path keys.

**How you know it worked.** Tool tests show:

- `NewPost` creates an empty post and marks the text edited.
- A Write to `the sun/draft.md` is refused with the pinned message.
- A Write to `.3pitor/editing-lessons.md` writes directly.

`make check` (the live check) passes its rewritten scenarios.

### Unit 8: Remove the documents API

**What it does.** Deletes the engine documents module, `Engine['documents']`, the `DocumentError` export, the server
documents routes, and the four wire types. Updates the README.

**Delta entries.** S-23, S-24, S-25, S-27.

**Ordering constraint.** After Units 6 and 7. `check.ts` calls `/api/documents` until Unit 7, and the type checker would
not catch that.

**How you know it worked.** `make test` and `make build` pass. A grep for `DocumentError`, `/api/documents`, and
`documents-changed` finds nothing in `src/`.

## Risks

- **Unit 6 is large.** It covers `documents.tsx` (896 lines, with a 1,673-line test) and the tree's 888-line test.
  These are the most-churned UI files in the last 90 days. Blast radius: the whole editor. Unit 5 takes the list out of
  it. Run the full UI suite after each step inside the unit.
- **A deleted id can be reused after a restart**
  ([C-23](artifacts/current-state-findings.md#c-23-tombstones-last-only-for-the-store-instance-so-a-restart-can-give-a-deleted-posts-id-to-a-new-post)).
  A restored unsaved entry then attaches to the new post. If the bodies differ, the existing "changed on disk" check
  catches it. If they are equal, the attach is silent. This is accepted, and recorded in Deferred (YAGNI).
- **AI edits during the cutover.** Between Units 6 and 7, the model is still told to use paths, so its edits to posts
  fail as `notApplied`. Land Units 6 and 7 close together.
- **Skill references not read in full**
  ([C-19](artifacts/current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing)). The
  builder reads `src/skills/collaborative-editing/references/` when editing the skill.
- **Double signals cost I/O**
  ([C-15](artifacts/current-state-findings.md#c-15-the-stores-watch-changes-what-signals-and-it-signals-each-own-write-twice)).
  Each save costs about two extra list-and-read rounds. This is acceptable at the app's size.

## Deferred (YAGNI)

- **`Engine.stop()`.** Nothing calls it. Reopen when a host or a test must stop the engine.
- **A version marker in `view.json` or `session.json`.** The list check catches every old form. Reopen at the database
  migration, when old ids might still resolve.
- **Remapping `X/draft.md` to `X` on restore.** The design keeps ids opaque, and the migration of references is
  excluded. Reopen if a writer reports losing drafts from before the upgrade.
- **Storing a title with each reference to catch reuse after a restart.** Reopen on a reported wrong-post attach.
- **"Save as new post" for a gone entry.** Discard satisfies the finding. Reopen if a writer loses text in that state.
- **Creating the AI's post on first Save instead of at once.** Reopen if an empty post on disk during a turn proves
  unacceptable.
- **A `SetTitle` tool for the AI.** Reopen when a writer asks the AI to rename posts.
- **`Posts` for subagents.** Reopen when an agent needs to find posts on its own.
- **Renaming `openFile`, `file`, and `name` to post-id names.** Reopen on a bug that mixes up a path and an id.
- **Renaming `src/ui/documents/` to `src/ui/posts/`.** It is high churn for symmetry alone. Reopen at the next
  restructuring of that feature.
- **A shared test builder for `EngineOptions`.** Reopen when the next required option lands.
- **Passing ids as a query parameter.** Reopen if a store can issue an id of `.` or `..`.

## Cut for Scope

- **CS-1: A database-backed store, and migrating stored references to it.** It would have given posts a database home
  and remapped saved references. The design, and the user's confirmed scope, place it later and separate
  ([scope-boundary.md](artifacts/scope-boundary.md), Stated Exclusions).
- **CS-2: A read-only file view beside the post list.** It would have kept loose files and side files visible. The user
  chose the flat list without one ([scope-boundary.md](artifacts/scope-boundary.md), Direction of Travel).
- **CS-3: Isolating listener throws in `EventBus.emit`.** It would stop one failing WebSocket from cutting off other
  tabs. That defect exists before this change, and the change does not touch it
  ([C-16](artifacts/current-state-findings.md#c-16-one-throwing-listener-stops-the-event-bus-for-every-later-listener)).
  It is outside the integration list in the boundary.
- **CS-4: Restarting a watcher that has died.** It would keep outside edits reaching the UI after the local watcher
  fails. That defect exists before this change
  ([C-24](artifacts/current-state-findings.md#c-24-nothing-stops-the-engine-and-a-dead-watcher-is-never-noticed)), and
  it is outside the boundary.

The user can reinstate any of these, and their saying so is itself the justification the reinstated entry records.

## Open Items

None yet. The review round may add some.

## Review Findings

Pending the review round.

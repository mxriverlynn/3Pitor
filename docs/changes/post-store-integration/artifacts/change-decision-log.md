# Change Decision Log: Post Store Integration

This file records every decision made while planning the post store integration. The plan itself is
[../change-plan.md](../change-plan.md). Evidence about the code as it stands is in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings. The target structure was proposed by
`han-core:software-architect` (proposal items A1–A9). The planner decided each item below.

## Trivial decisions

- D-1: The plan executes the design and reopens none of it. The reason is "a decision already taken". The plan builds
  the integration listed in `api-design.md`, "Integration does later (G7)", and absorbs BC1–BC14 as written. It does
  not revisit the design's decisions D1–D26 or V1–V14. The three narrow uses of an id recorded in D-30 are exceptions,
  not reopenings. — Referenced in plan: Why This Change.
- D-22: Test engines use the real file store inline. Each hand-built test engine passes
  `posts: createFilePostStore(fileSystem)`. A shared builder under `src/engine/` that is not a `*.test.ts` file would
  count as production code and could not value-import the store. The design cut an in-memory store (its D4). —
  Referenced in plan: Surface Delta (S-26).

- D-26: The live check is run as `bun src/server/scripts/check.ts`. The Makefile has no `check` target, so the plan
  names the script directly and adds no target. — Referenced in plan: Surface Delta (S-22); Change Units (Unit 7).

## Full decisions

### D-2: The engine hands the store itself to the server

- **Question:** What replaces `Engine['documents']` for the server?
- **Decision:** `EngineOptions.posts: PostStore` is required and typed with `import type`. `Engine` gains
  `readonly posts: Omit<PostStore, 'watch'>`, which is the store passed in. cli builds
  `createFilePostStore(fileSystem)` on the same `FileSystem`. The server imports `PostError` directly from
  `posts/post-error`, and the engine does not re-export it.
- **Rationale:** No engine logic sits between the routes and the store. Leaving out `watch` keeps subscription
  ownership in the engine. The server has no stop path, so a subscription made there would leak.
- **Evidence:** [C-1](current-state-findings.md#c-1-the-import-rules-fix-where-each-integration-piece-may-sit),
  [C-2](current-state-findings.md#c-2-cli-builds-only-a-filesystem-and-the-engine-watches-it-with-the-unsubscribe-thrown-away),
  [C-3](current-state-findings.md#c-3-the-engine-keeps-filesystem-for-everything-that-is-not-a-post),
  [C-24](current-state-findings.md#c-24-nothing-stops-the-engine-and-a-dead-watcher-is-never-noticed); architect A1;
  the design's "Integration shape" sketch.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - A feature object wrapping the store's six methods. It is rejected because it adds six pass-throughs with no second
    implementation (YAGNI).
  - Exposing the full `PostStore`. It is rejected because it invites a second `watch` with no unsubscribe path, and it
    costs the same as the `Omit`.
  - Re-exporting `PostError` from `engine.ts`. It is rejected because it adds a second import path to one module and
    gives the server nothing.
- **Revisit criterion:** Engine logic that must run on every post call from HTTP, such as validation at the edge for
  a database store (design Open Risks, NUL and lone surrogates).
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-2
- **Dependent decisions:** D-3, D-6, D-11
- **Referenced in plan:** Target State › Wiring; Surface Delta (S-1, S-2)

### D-3: The engine subscribes `posts.watch`, emits `posts-changed`, and drops the subscription if startup fails

- **Question:** How does the engine watch for post changes, what is the event called, and where does the unsubscribe
  go when there is no stop?
- **Decision:**
  ```ts
  const unsubscribe = posts.watch(() => events.emit({ type: 'posts-changed' }));
  try { await sessions.load(); } catch (error) { unsubscribe(); throw error; }
  ```
  `HostEvent` replaces `{ type: 'documents-changed' }` with `{ type: 'posts-changed' }`. `engine.ts` no longer imports
  `isHiddenKey`. `createEngine` never watches.
- **Rationale:** The design swaps the watch and leaves the event name to integration (design D19, D26). The new name
  says what it reports. The only path that can drop the subscription today is a startup failure, which leaks it.
- **Evidence:** [C-2](current-state-findings.md#c-2-cli-builds-only-a-filesystem-and-the-engine-watches-it-with-the-unsubscribe-thrown-away),
  [C-15](current-state-findings.md#c-15-the-stores-watch-changes-what-signals-and-it-signals-each-own-write-twice),
  [C-24](current-state-findings.md#c-24-nothing-stops-the-engine-and-a-dead-watcher-is-never-noticed); architect A7.
- **Behavior impact:** Changing.
  - WebSocket listeners see a new event name.
  - `.post.json` changes signal.
  - Own writes signal twice.

  The UI's guards absorb the repeat (C-15). Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Keeping `documents-changed`. It is rejected because the documents API is removed, and the name would then describe
    nothing that exists.
  - Adding `Engine.stop()`. It is rejected because nothing calls it (YAGNI; see Deferred).
- **Revisit criterion:** A host or a test that must stop the engine.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › Wiring; Surface Delta (S-3)

### D-4: The documents API is removed after every consumer moves

- **Question:** When and how does the old documents API go?
- **Decision:** These are removed in the last unit:
  - `src/engine/documents/`
  - `Engine['documents']`
  - the `DocumentError` re-export
  - `src/server/documents/`
  - `DocumentEntry`, `DocumentList`, `CreatedPost`, and `FolderCount`

  The README is updated in the same unit. The new routes run beside the old ones until then.
- **Rationale:** The user confirmed that the documents API goes away entirely. `check.ts` calls `/api/documents` until
  Unit 7, and the type checker cannot see that, so removal comes last.
- **Evidence:** [scope-boundary.md](scope-boundary.md), Direction of Travel;
  [C-4](current-state-findings.md#c-4-documentsts-is-the-documents-api-and-all-of-it-goes-one-export-has-another-importer),
  [C-26](current-state-findings.md#c-26-server-and-engine-tests-the-check-script-and-the-shipped-fixture-all-use-loose-root-md-files-as-documents).
- **Behavior impact:** Changing. The old URLs answer 404, and moving posts, making folders, and counting a folder's
  files leave the app (BC7). Settled by the user's answer in the confirmation turn: "looks good. do it".
- **Rejected alternatives:**
  - Keeping the documents API as a read-only file view. It is rejected because the user chose the flat list without
    one.
  - Removing it first. It is rejected because the app and the live check would break between units.
- **Revisit criterion:** None within this change.
- **Dissent (if any):** None.
- **Settles delta entry:** S-23, S-24, S-25, S-27
- **Dependent decisions:** None.
- **Referenced in plan:** Surface Delta (S-23, S-24, S-25, S-27); Change Units (Unit 8)

### D-5: Wire types restate the post shapes, and the compiler keeps them in step

- **Question:** How do the browser and the server agree on post shapes when `src/shared/` cannot import posts?
- **Decision:** `wire.ts` declares:
  ```ts
  export interface PostSummary { id: string; title: string }
  export interface PostList { posts: PostSummary[] }
  export interface Post extends PostSummary { body: string }
  export interface CreatePostBody { title: string; body: string }
  export interface SetTitleBody { title: string }
  export interface SetBodyBody { body: string }
  ```
  Routes answer with `c.json<WireType>(await posts.x(...))`. Request bodies are checked three ways:
  - the server parses them with `z.ZodType<WireBody>` schemas
  - the UI hook builds them with `satisfies`
  - the fake builds them with `satisfies`

  The field names `openFile`, `file`, and `name` keep their names, and their values become ids.
- **Rationale:** `make typecheck` then fails on a change to either side that the other side does not follow. No
  runtime equality test is needed.
- **Evidence:** [C-1](current-state-findings.md#c-1-the-import-rules-fix-where-each-integration-piece-may-sit),
  [C-17](current-state-findings.md#c-17-the-post-name-crosses-every-layer-as-a-bare-string-under-several-field-names); architect A2.
- **Behavior impact:** Preserving. The types are additive.
- **Rejected alternatives:**
  - A test comparing the wire types with the contract's types. It is rejected because the compile-time pairing does
    the same work at no cost.
  - Renaming the reference fields to post-id names. It is rejected because the churn is high and no mix-up bug has been
    seen (Deferred).
- **Revisit criterion:** A path-versus-id mix-up bug.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-6, D-20
- **Referenced in plan:** Target State › Wire types; Surface Delta (S-5)

### D-6: Post routes, status mapping, and how ids travel

- **Question:** What are the routes, statuses, and bodies, and how does an id that holds `/` travel?
- **Decision:** Six routes, exactly as in the plan's routes table:
  - `GET /api/posts`
  - `GET /api/posts/:id`
  - `POST /api/posts`, taking `{ title }` only and calling `posts.create({ title, body: '' })`
  - `PUT /api/posts/:id/title`
  - `PUT /api/posts/:id/body`
  - `DELETE /api/posts/:id`

  Errors map as follows:
  - `PostError` returns `{ error: error.message }`. The status is 404 for `'not-found'` ("That post no longer
    exists.") and 400 for `'invalid'` ("A post needs a title."). The UI shows the `error` text and keeps no copy of the
    sentences.
  - `BadBody` returns 400.
  - Anything else returns a plain-text 500.

  An id is one path segment, sent as `encodeURIComponent(id)`, so `series%2Fone` arrives as `series/one`.
- **Rationale:**
  - **Create carries no body.** No caller makes a post with text (D-12), and a body would let a cross-site form put
    text on disk (security review, SEC-003).
  - **The routes follow precedent.** They use the server's existing feature-module and `onError` pattern.
  - **Title and body have separate routes.** That matches the contract's separate setters, so a rename can never
    overwrite a body.
- **Evidence:**
  - [C-6](current-state-findings.md#c-6-routes-are-apidocuments-keyed-by-a-name-path-parameter-and-map-documenterror-to-404-or-400),
    [C-7](current-state-findings.md#c-7-the-ui-never-branches-on-an-error-reason-only-on-the-http-status-and-the-message)
  - architect A2
  - The security review sent 17 hostile ids through Hono and the store, and none escaped.
  - Today's path ids already carry `/` through `:name`.
- **Behavior impact:** Changing. The URLs are new, the error sentences are fixed, create takes only a title, and the
  BC6 naming rules apply. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - `?id=` query transport. It would be safe for any string, but it departs from the server's precedent. The file store
    cannot issue `.` or `..`, the ids that URL parsing would collapse (see Deferred).
  - One `PATCH /api/posts/:id` taking `{title?, body?}`. It is rejected because it is a second contract shape, which the
    store does not have.
  - Keeping `body` on create. It is rejected under the simpler-version test: it has no caller, and it is a way for a
    cross-site form to write text.
- **Revisit criterion:** A store that can issue a dot-only id, or a caller that needs to create a post with text.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** D-7, D-9, D-20, D-25
- **Referenced in plan:** Target State › HTTP routes; Surface Delta (S-4)

### D-7: A bad request body is a route-private `BadBody` error

- **Question:** Where do bad-body errors go now that `DocumentError` is gone?
- **Decision:** `posts.routes.ts` declares a class private to the module, `class BadBody extends Error`. Its message
  is `the request body is not valid: <z.prettifyError text>`, and `onError` maps it to 400 with `{ error }`.
- **Rationale:** `PostError('invalid')` carries the fixed message "A post needs a title.", which would mislabel a
  malformed body.
- **Evidence:** [C-6](current-state-findings.md#c-6-routes-are-apidocuments-keyed-by-a-name-path-parameter-and-map-documenterror-to-404-or-400);
  `src/posts/post-error.ts`.
- **Behavior impact:** Preserving. A bad body is still a 400 with the same sentence shape.
- **Rejected alternatives:**
  - Answering 400 inline in each handler, as `sessions.routes.ts:29` does. It is rejected because it repeats the same
    check in five handlers.
  - Reusing `PostError('invalid')`. It is rejected because the message would be wrong.
- **Revisit criterion:** A second module that needs the same error.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › HTTP routes; Surface Delta (S-4)

### D-8: The sidebar is a flat post list, sorted by title

- **Question:** What replaces the tree, and in what order are posts shown?
- **Decision:** `src/ui/documents/post-list/post-list.tsx` shows the listed posts, sorted by
  `a.title.localeCompare(b.title)` and then by id. Each row is labelled with its title. Gone rows come after the
  posts. There is a "+" New post, and each row has Rename and Delete. These are removed:
  - `file-tree/`
  - `paths.ts`
  - drag and drop
  - the move dialog
  - folder menus
  - the `Folder:` hint
- **Rationale:** It is the direction of travel the user confirmed. The store promises no order, so the caller sorts.
  The writer recognizes posts by title.
- **Evidence:** [scope-boundary.md](scope-boundary.md);
  [C-5](current-state-findings.md#c-5-todays-list-returns-every-folder-and-md-file-sorted-by-path-the-ui-nests-them-by-),
  [C-12](current-state-findings.md#c-12-rename-is-a-move-and-move-is-the-only-code-that-rewrites-keys-in-ui-state),
  [C-27](current-state-findings.md#c-27-pathsts-and-the-trees-path-algebra-serve-only-the-hierarchy); architect A4.
- **Behavior impact:** Changing. The writer sees titles, with no folders or side files. Settled by the user's
  confirmation ("looks good. do it") and [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Grouping by the folder part of an id. It is rejected because it parses an opaque id (design D6).
  - Sorting by id. It is rejected because ids are not shown to the writer.
  - Renaming `src/ui/documents/` to `posts/`. It is rejected because the churn is high and the gain is symmetry alone
    (Deferred).
- **Revisit criterion:** A request for grouping or a different order.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12, S-13, S-18
- **Dependent decisions:** D-13, D-14
- **Referenced in plan:** Target State › UI; Surface Delta (S-12, S-13, S-18)

### D-9: Save only ever updates an existing post

- **Question:** What does Save do now that there is no upsert (BC5)?
- **Decision:** Save sends `PUT /api/posts/:id/body` for an open entry whose id is listed. It never calls create. An
  entry whose id is not listed is in the gone state ([D-14](#d-14-a-gone-post-can-only-be-discarded)).
- **Rationale:** Under BC5 an upsert no longer exists. A post the AI makes already has an id from `NewPost`
  ([D-10](#d-10-the-ai-makes-a-post-with-newpost-which-creates-it-empty-on-disk-at-once)), so Save has no create case.
- **Evidence:** [C-8](current-state-findings.md#c-8-save-is-an-explicit-upsert-that-creates-missing-folders-and-the-ui-depends-on-that-for-ai-made-posts),
  [C-28](current-state-findings.md#c-28-the-stores-per-post-queue-already-fixes-two-of-todays-races),
  [C-29](current-state-findings.md#c-29-a-dirty-entry-for-a-post-that-is-gone-can-never-be-saved-under-the-store).
- **Behavior impact:** Changing. Save never recreates a deleted post. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Save calling create when `setBody` returns 404. It is rejected because it brings the upsert back, along with the
    duplicate-create race between two tabs (concurrency K-1).
- **Revisit criterion:** None within this change.
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** D-14
- **Referenced in plan:** Target State › UI; Surface Delta (S-14)

### D-10: The AI makes a post with `NewPost`, which creates it empty on disk at once

- **Question:** How does a post the AI makes get an id, now that Write-to-a-new-path plus a Save upsert is gone?
- **Decision:** A `NewPost {title, content}` tool runs `posts.create({ title, body: '' })`, puts `content` into the turn
  copy as an unsaved edit of the new id, highlights it, and returns
  `` `made post ${JSON.stringify(id)} titled ${JSON.stringify(title)}; its text is in the editor, unsaved` ``.
  Write to an unknown id is refused.
- **Rationale:** The id exists before any edit, so every map stays keyed by one stable id, and nothing is re-keyed.
  The text still reaches disk only through the writer's Save, which keeps the review step. A dedicated tool keeps a
  mistyped id from making a junk post.
- **Evidence:** [C-8](current-state-findings.md#c-8-save-is-an-explicit-upsert-that-creates-missing-folders-and-the-ui-depends-on-that-for-ai-made-posts),
  [C-9](current-state-findings.md#c-9-the-ai-tools-never-write-a-post-to-disk-they-change-an-in-memory-copy-for-the-turn),
  [C-26](current-state-findings.md#c-26-server-and-engine-tests-the-check-script-and-the-shipped-fixture-all-use-loose-root-md-files-as-documents);
  design BC5, "An AI-made post must go through `create`"; architect A3(a); concurrency K-1.
- **Behavior impact:** Changing. The AI now writes to disk during a turn: an empty, titled post appears at once, and it
  stays if the turn is stopped or undone. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Creating the post on the first Save in the UI. It is rejected because it needs a pending-key wire field, a stored
    title, and a re-key across eight UI maps, which is the move code this change deletes. It also risks a pending key
    colliding with a real id (Deferred).
  - Not letting the AI make posts. It is the simplest option, but it is rejected because BC5 expects the capability
    kept, and `check.ts` exercises it today.
  - Creating the post with the AI's text as its body. It is rejected because the text would reach disk with no review.
- **Revisit criterion:** A writer finds an empty post on disk during a turn unacceptable.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-9, D-17
- **Referenced in plan:** Target State › AI tools; Surface Delta (S-8)

### D-11: Tools name posts by exact id and refuse to change anything else

- **Question:** What does `file_path` mean for a post, how is the turn copy keyed, and what can Write and Edit still
  change?
- **Decision:** The resolution order is the one pinned in the plan's Target State › AI tools. `turn.texts` is keyed by
  id, verbatim from the browser, never normalized, and `""` is skipped. Write, Edit, and Highlight act only on posts
  and `.3pitor/` notes. Anything else is refused with
  `` `${file_path} is not a post. Call Posts to list the posts by id, or NewPost to make one.` ``. Read falls back to
  `fileSystem.read(normalizeKey(file_path))`. `resolvePost` and `postName` are removed. During Units 4–6 the old `.md`
  path branch stays as the last fallback.
- **Rationale:** Ids are exact (BC10), so normalizing one could reach a different post. The tools are not a file
  editor any more, and a post is what the writer reviews.
- **Evidence:** [C-9](current-state-findings.md#c-9-the-ai-tools-never-write-a-post-to-disk-they-change-an-in-memory-copy-for-the-turn),
  [C-10](current-state-findings.md#c-10-resolvepost-is-the-tools-post-check-and-it-is-path-shaped),
  [C-20](current-state-findings.md#c-20-a-root-editing-lessonsmd-is-written-through-the-post-path-today); architect A3.
- **Behavior impact:** Changing. Root and side `.md` files can be read but not changed by the AI. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Letting Write and Edit change non-post files directly on disk. It is rejected because it widens the AI's direct
    writes to any workspace file, with no review.
  - A new `post_id` field next to `file_path`. It is rejected because it breaks Claude Code tool-name compatibility
    (`tools.ts:76-78`), and the tools' row labels in the chat UI read `file_path`.
- **Revisit criterion:** A writer needs the AI to change a non-post file.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-15, D-16, D-18
- **Referenced in plan:** Target State › AI tools; Surface Delta (S-6)

### D-12: New posts start empty, and nothing keeps an H1 in step with the title

- **Question:** Does the UI seed `# title` into a new post (design D9), and does anything keep the title and an H1
  together (V10)?
- **Decision:** No. New Post and `NewPost` both create with `body: ''`. Nothing reads or writes an H1. `draftText` goes
  with `documents.ts`.
- **Rationale:** The title has one home, `.post.json`, and the header shows it. Seeding an H1 would make the app itself
  the cause of title drift on the first rename.
- **Evidence:** [C-11](current-state-findings.md#c-11-a-title-exists-today-only-as-a-folder-name-and-an-h1-seeded-at-create-time);
  `src/posts/posts.ts:36-41`; design D9, V10; architect A5.
- **Behavior impact:** Changing. New Post opens an empty editor instead of one headed `# title`. Older posts keep their
  H1s. Settled under [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Seeding `# title`. It is rejected because the H1 and the title disagree after the first rename.
  - Rewriting the H1 on rename. It is rejected because the store never reads the body, and the rewrite would fight
    unsaved edits.
- **Revisit criterion:** Writers ask for a heading on new posts, or a publishing target needs the H1.
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › UI; Surface Delta (S-14)

### D-13: New post takes only a non-blank title

- **Question:** What does the New post dialog accept?
- **Decision:** One title field. Create is enabled when `title.trim() !== ''`. There is no parent, no `newEntryName`
  cleaning, and no folder hint. The store names the folder: a ` 2` suffix when taken, and `Untitled` when nothing is
  usable.
- **Rationale:** It is the store's own `invalid` rule (BC6). The old gate refused titles the store now accepts.
- **Evidence:** [C-11](current-state-findings.md#c-11-a-title-exists-today-only-as-a-folder-name-and-an-h1-seeded-at-create-time);
  behavioral B-8.
- **Behavior impact:** Changing. Titles like `???` are allowed, and a taken name no longer errors. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Keeping the `newEntryName` gate. It is rejected because it refuses valid titles, and it describes a folder the
    writer no longer chooses.
- **Revisit criterion:** None within this change.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › UI; Surface Delta (S-12)

### D-14: A gone post can only be discarded

- **Question:** What happens to an open, dirty entry whose post no longer exists?
- **Decision:** These are pinned in the plan's Target State › UI:
  - the gone condition
  - the notice
  - the Discard button
  - Save disabled
  - the entry left out of `beginTurn().documents`
  - the gone row in the list

  This replaces the `onDisk` flag and the notice "Save creates it".
- **Rationale:** Without it, three cases leave a dirty entry whose only exit, Save, always fails (C-29). Discard is the
  simplest exit, and it keeps the text visible so it can be copied.
- **Evidence:** [C-14](current-state-findings.md#c-14-syncwithdisk-is-the-uis-only-reconciliation-and-it-is-keyed-by-path),
  [C-29](current-state-findings.md#c-29-a-dirty-entry-for-a-post-that-is-gone-can-never-be-saved-under-the-store);
  concurrency K-2; architect A4.
- **Behavior impact:** Changing. The writer sees a notice and Discard where Save used to quietly recreate the post.
  Settled under [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - "Save as new post". It is rejected because Discard satisfies the finding (Deferred).
  - Hiding gone entries from the list. It is rejected because drafts restored from before the upgrade would become
    unreachable.
- **Revisit criterion:** A writer loses text in that state.
- **Dissent (if any):** None.
- **Settles delta entry:** S-15
- **Dependent decisions:** D-19
- **Referenced in plan:** Target State › UI; Surface Delta (S-15)

### D-15: A `Posts` tool lists posts for the AI

- **Question:** How does the AI find a post it does not have open?
- **Decision:** A `Posts {}` tool returns `[{ id, title }]` JSON, sorted by title and then id. It is offered to the
  main agent. Subagents do not get it.
- **Rationale:** Glob returns paths that are not ids. Without this tool the AI reaches only posts the editor holds.
- **Evidence:** [C-19](current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing),
  [C-26](current-state-findings.md#c-26-server-and-engine-tests-the-check-script-and-the-shipped-fixture-all-use-loose-root-md-files-as-documents); architect A3.
- **Behavior impact:** Changing. The AI gains a capability. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Putting the post list into every user turn. It is rejected because the list goes stale in stored history and costs
    tokens on every turn.
  - Teaching the AI to map Glob results to ids. It is rejected because that parses an id out of a path (design D6).
- **Revisit criterion:** A subagent needs to find posts on its own.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7
- **Dependent decisions:** D-17, D-18
- **Referenced in plan:** Target State › AI tools; Surface Delta (S-7)

### D-16: Ids from the browser and the AI are resolved at the store, never trusted as paths

- **Question:** How are ids that arrive from the browser and the AI handled?
- **Decision:** No code normalizes or parses an id. Every write resolves its id at the store, which refuses anything it
  did not issue:
  - **Route parameters** go straight to the store.
  - **A tool's `file_path`** resolves through the turn copy, then the store.
  - **Restored view state** is checked against the list.

  The chat request's `documents` keys are taken as sent, and the server does not check them. A key that names no post
  can only produce edits that return to the browser, and their Save is `not-found`. The user turn quotes the open post
  with `JSON.stringify`.
- **Rationale:** The store's exact-match rule is the single check (`posts.ts:9-18`). A second grammar at the edge would
  drift from it. Quoting stops an id that holds a newline from reshaping the prompt.
- **Evidence:**
  - The security review: inputs (a)–(e) found no id that escapes the workspace, reaches a hidden file, or reaches
    another post.
  - [C-10](current-state-findings.md#c-10-resolvepost-is-the-tools-post-check-and-it-is-path-shaped),
    [C-18](current-state-findings.md#c-18-the-chat-route-trusts-the-browsers-post-map-and-open-file-and-puts-the-open-file-into-the-models-prompt)
  - the design's Open Risks
  - architect A3
- **Behavior impact:** Changing. The prompt text changes. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Checking the id grammar at the route. It is rejected because the store already refuses anything it did not issue.
  - Checking `documents` keys against the list on the chat route. It is rejected because a key that names no post can
    reach nothing on disk, so the check would add a store call to every turn and protect nothing.
- **Revisit criterion:** A store whose ids can hold characters that are unsafe in a URL or a prompt.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › AI tools; Surface Delta (S-9)

### D-17: The system prompt teaches ids, titles, `Posts`, and `NewPost`

- **Question:** What does the `<tools>` block say?
- **Decision:** The block is replaced with the text pinned in the plan's Target State › System prompt and skills, with
  no `${` and no backslash.
- **Rationale:** The current text teaches path addressing and "Write to create a post".
- **Evidence:** [C-19](current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing); architect §8.
- **Behavior impact:** Changing. It is the AI's instructions. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Leaving the prompt alone and relying on tool refusals. It is rejected because the model would fail on every first
    attempt.
- **Revisit criterion:** The live check shows the model misusing ids.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › System prompt and skills; Surface Delta (S-10)

### D-18: Skills take a post id, the lessons file moves under `.3pitor/`, and series lessons are dropped

- **Question:** How do the three skills address posts? Where do `editing-lessons.md` and series lessons go?
- **Decision:** As pinned in the plan's Target State › System prompt and skills:
  - **Which post.** `collaborative-editing` takes an id. Without one, it uses the open post, or calls `Posts`.
  - **The log.** Its slug is the id with `/` turned into `-`. The log's first line is `Post: <id>`, and resume uses a
    log only when that line names the same id. So two ids that share a slug cannot share a log.
  - **Lessons.** They are kept in `.3pitor/editing-lessons.md`, and a root `editing-lessons.md` is also read. Only
    lessons the writer accepted in chat are written.
  - **Series notes.** They are read from a root `README.md`, or one the writer names, and are never written. The
    "series" placement for a lesson is removed, so a lesson is general or dropped.
  - **The other skills.** `proofread` takes an id. `research` says "the post open in the editor".
  - **Tools.** Every skill's `tools:` line that lists the post tools adds `Posts` and `NewPost`. A test checks that
    every tool such a line names is offered to the main agent.
- **Rationale:**
  - The tools can no longer change an `.md` file that is not a post (D-11).
  - A `.3pitor/` note is the existing way the AI writes its own files directly.
  - Finding series notes "nearest the draft's folder" would parse an id as a path.
- **Evidence:**
  - [C-19](current-state-findings.md#c-19-the-system-prompt-and-the-skills-teach-path-addressing),
    [C-20](current-state-findings.md#c-20-a-root-editing-lessonsmd-is-written-through-the-post-path-today)
  - architect A8
  - junior-developer JD-001, JD-005, JD-007
  - test-engineer: the skill tool-name test
  - security review SEC-005
  - `src/skills/collaborative-editing/SKILL.md:44-45`, `:114-127`
- **Behavior impact:** Changing. Accepted lessons are saved directly, without the editor, and are git-ignored. Series
  notes are found in fewer places and are no longer written. The security review notes that this makes the lessons
  file an instruction channel that skips the editor. That risk is accepted and listed in the plan's Risks: the skill
  writes only what the writer accepted in chat, and every edit later runs make is still reviewed. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - Letting the tools write root `.md` files directly. It is rejected per D-11.
  - Dropping the lessons file. It is rejected because the skill relies on it across sessions.
  - Keeping lessons as a post the skill edits, so they pass through review. It is rejected because a lessons post would
    sit in the writer's post list among their writing.
  - Writing series lessons to `.3pitor/` under a series heading. It is rejected because it adds a placement rule for a
    case no current workspace uses.
- **Revisit criterion:**
  - A writer wants lessons in git, or series notes beside posts.
  - A planted lesson is seen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › System prompt and skills; Surface Delta (S-11); Risks

### D-19: Restore checks every stored reference against the post list

- **Question:** How are `view.json` and `session.json` references dropped or checked (design Open Risks), and is a
  version marker needed?
- **Decision:**
  - Restore awaits the post list, then applies the restore table pinned in the plan.
  - `applyPending` goes through `applyEdited`'s load-then-merge, so a stale key becomes one `notApplied` entry.
  - Neither file is rewritten, and no version marker is added.
  - If the list fails, nothing is dropped.
- **Rationale:** Every old form fails to resolve under the file store. `X/draft.md` would be a folder inside a post,
  which is not a post (BC3), and `notes.md` is a file. So "is it a listed id?" separates old references from new ones
  with no marker.
- **Evidence:** [C-21](current-state-findings.md#c-21-viewjson-stores-post-names-in-seven-places-cast-rather-than-parsed-and-restores-them-unchecked),
  [C-22](current-state-findings.md#c-22-sessionjson-stores-old-post-names-inside-chat-records-and-the-ui-re-applies-the-last-turn-on-load),
  [C-23](current-state-findings.md#c-23-tombstones-last-only-for-the-store-instance-so-a-restart-can-give-a-deleted-posts-id-to-a-new-post); architect A6.
- **Behavior impact:** Changing. Old references drop out, and old unsaved edits come back as gone rows. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - A version marker. It is rejected because the list check already catches every old form (Deferred).
  - Remapping `X/draft.md` to `X`. It is rejected because it parses ids, and the migration of references is excluded
    (CS-1).
  - Storing a title with each reference to catch reuse after a restart. It is deferred until a wrong-post attach is
    reported.
- **Revisit criterion:** The database migration (CS-1), or a reported wrong-post attach.
- **Dissent (if any):** None.
- **Settles delta entry:** S-16, S-17
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › UI; Surface Delta (S-16, S-17)

### D-20: The UI fake uses hostile opaque ids and refuses like the store

- **Question:** What replaces `fake-documents-api.ts`?
- **Decision:** `src/ui/components/fake-posts-api.ts` serves the six routes:
  - **Ids** come from a counter that is never reused (`"1/p 1"`, `"2/p 2"`, …). Each holds a `/` and a space.
  - **The list** comes back newest first.
  - **Missing ids.** It returns 404 for every read or write of an id it does not hold, including one it deleted.
  - **Blank titles** get 400.
  - It never upserts.
  - Its bodies use `satisfies` against the wire types.
  - It sends no events.
- **Rationale:** Each property makes one UI bug fail a test:
  - an id built from a title
  - a missing `encodeURIComponent`
  - a missing sort
  - a reused id
  - a write that assumes an upsert

  Tests send signals by hand, because modelling the store's double signal would mean re-implementing the store.
- **Evidence:**
  - [C-25](current-state-findings.md#c-25-the-ui-fake-re-implements-the-old-routes-upsert-included)
  - design D6
  - test-engineer review, Task 3
- **Behavior impact:** Preserving. It is test-only.
- **Rejected alternatives:**
  - **Ids equal to titles, as the file store makes them.** They would hide code that builds an id from a title.
  - **Ids such as `post-1`.** They need no encoding, so a missing `encodeURIComponent` would pass.
  - **Modelling the ` 2` naming or the double signal.** That re-implements store logic (YAGNI).
- **Revisit criterion:** The fake and the routes disagree in a shipped bug.
- **Dissent (if any):** None.
- **Settles delta entry:** S-19, S-20
- **Dependent decisions:** None.
- **Referenced in plan:** Surface Delta (S-19, S-20)

### D-21: The fixture and the live check move onto real posts, together

- **Question:** What happens to the shipped fixture, and to the `check.ts` scenarios built on loose root `.md` files?
- **Decision:**
  - `notes.md` becomes `notes/draft.md`.
  - The fixture ships no `view.json`, because `.3pitor/` is git-ignored.
  - The fixture move lands in Unit 7, with the `check.ts` rewrite, because `check.ts` reads `notes.md` until then.
  - `check.ts` uses the fixture's `notes`, or creates each post it uses, and addresses each by its id.
  - Its new-post scenario asserts that `edited[id]` is set, the stored body is `''`, and the title is `Summary`.
  - It is run as `bun src/server/scripts/check.ts`.
- **Rationale:** Without the fixture move, a first run shows an empty list. Without the `check.ts` rewrite, the live
  check tests the API being removed. Moving the fixture alone would break the live check for a unit.
- **Evidence:**
  - [C-26](current-state-findings.md#c-26-server-and-engine-tests-the-check-script-and-the-shipped-fixture-all-use-loose-root-md-files-as-documents)
  - architect A8
  - test-engineer review, headlines 1 and 2: `git ls-files src/fixtures` lists no `view.json`, and `check.ts` breaks
    if the fixture moves before it does
- **Behavior impact:**
  - **For the fixture:** Changing. A first-time user sees one post called `notes`, with nothing open, as before.
  - **For a developer running the check:** Changing. The new-post scenario now expects an empty post on disk.

  Settled under [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - **Shipping a `view.json` so `notes` opens.** It would mean un-ignoring `.3pitor/` in the fixture, for a cosmetic
    gain.
  - **Moving the fixture in Unit 6.** It breaks the live check until Unit 7.
  - **Building ids by hand in `check.ts`.** It couples the check to the file store's id shape.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-21, S-22
- **Dependent decisions:** None.
- **Referenced in plan:** Surface Delta (S-21, S-22); Change Units (Unit 7)

### D-23: Units run old and new side by side until the last unit

- **Question:** How is the change sequenced so that each unit leaves the app working?
- **Decision:** Eight units:
  1. Wire the store in.
  2. The watch and the event.
  3. The server locked to this machine, with the post routes beside the old ones.
  4. Tools on ids, with a legacy path fallback. Keys and `file_path` values ending in `.md` are still normalized.
  5. The list component, not yet mounted.
  6. The UI cutover.
  7. The AI onto ids, the fixture and `check.ts` onto posts, and the fallback removed.
  8. Removal of the documents API.
- **Rationale:** Each consumer moves onto the store while the old API still serves the others.
- **Evidence:**
  - architect, "Change units"
  - [C-26](current-state-findings.md#c-26-server-and-engine-tests-the-check-script-and-the-shipped-fixture-all-use-loose-root-md-files-as-documents)
  - test-engineer review, headlines 2 and 3
- **Behavior impact:** Preserving between units, except where each unit's entries say otherwise.
- **Rejected alternatives:**
  - **One big-bang unit.** Every unit must leave tests passing, and the diff would be too large to review.
  - **Moving the AI before the UI.** The tools key their turn copy by whatever the browser sends, so the UI must send
    ids first.
- **Revisit criterion:** A unit fails to leave `make test` green.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** None.
- **Referenced in plan:** Change Units

### D-24: Behavior changes are settled under the user's standing delegation

- **Question:** The skill's behavior gate escalates every behavior-changing entry to the user. Who decides here?
- **Decision:** The planner decides each one, and reports all of them in the plan's Behavior Changes section and in the
  run's summary. The user can reverse any of them.
- **Rationale:** The user's standing instruction for han planning runs is "make the best decisions you can, without
  asking me". Their answer to this run's confirmation turn was "looks good. do it".
- **Evidence:** User input: the standing preference, and the confirmation turn.
- **Behavior impact:** Shapes S-3, S-4, S-6–S-17, S-21, S-22, S-23, S-24, S-27, S-28, and S-29.
- **Rejected alternatives:**
  - Escalating each entry one turn at a time. The user has said not to.
- **Revisit criterion:** The user asks to review a specific change.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** D-3, D-6, D-8–D-19, D-21, D-25, D-27, D-28, D-29
- **Referenced in plan:** Behavior Changes; Surface Delta (every Changing entry)

### D-25: The server answers only this machine and its own page

- **Question:** The security review found that the server listens on every network interface and checks neither `Host`
  nor `Origin`. The new routes add `DELETE`, and create a post on a POST. What changes?
- **Decision:**
  - `Bun.serve` gets `hostname: '127.0.0.1'`.
  - `app.fetch` is wrapped in `sameMachine`, pinned in the plan. A `Host` other than `127.0.0.1:<port>` or
    `localhost:<port>`, or an `Origin` other than `http://` plus one of those, gets plain-text `403 Forbidden`.
  - The check runs before Hono, so it covers every API route and the `/ws/events` upgrade.
  - The static page route stays outside the check.
- **Rationale:**
  - **The bind closes the network.** An attacker on the same network could otherwise list, read, overwrite, and
    delete posts. They could also drive chat turns on the writer's API key.
  - **The `Host` check closes DNS rebinding.**
  - **The `Origin` check closes cross-site form posts and cross-site WebSocket hijacking.** The latter leaks session ids
    that let another site drive the AI.

  It is one literal and one small function. The scope includes the security review of ids from the browser, and these
  routes are where those ids arrive.
- **Evidence:**
  - Security review SEC-001 (High, reached through the LAN address in a probe), SEC-002, SEC-003, SEC-004
  - `src/server/server.ts:30-47`
  - `src/server/chat/mcp-endpoint/mcp-endpoint.ts:28` already binds `127.0.0.1`
  - [C-30](current-state-findings.md#c-30-the-server-answers-on-every-interface-and-checks-neither-host-nor-origin)
- **Behavior impact:** Changing.
  - The app can no longer be opened from another device on the network.
  - Other websites cannot call the API or open the event socket.
  - The printed URL becomes `http://127.0.0.1:<port>/`.

  Settled under [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - **`hono/csrf` alone.** It refuses only POSTs from forms, `text/plain`, and multipart. It leaves DNS rebinding and
    the WebSocket open.
  - **A session token on every request.** It is more machinery than a single-user loopback app needs (YAGNI).
  - **Leaving it for a separate change.** That would ship new DELETE and create routes onto a server already open to the
    network.
- **Revisit criterion:** A writer needs to reach the app from another device. That would need authentication, not a
  wider bind.
- **Dissent (if any):** None.
- **Settles delta entry:** S-28, S-29
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › The server answers only this machine and its own page; Surface Delta (S-28,
  S-29); Change Units (Unit 3)

### D-27: A duplicate title is allowed and warned, not refused

- **Question:** Titles need not be unique, and a taken name now gets a ` 2` id instead of a 400. How does a writer tell
  two posts with one title apart?
- **Decision:** New post and Rename both allow a duplicate title. When the trimmed title equals a listed title, the
  dialog's existing hint line reads: "You already have a post titled “{title}”. Both will show as “{title}” in the
  list." Rows are not given an id.
- **Rationale:** It restores the check the writer has today, a refused taken name, as a warning in a slot that already
  exists. It does not contradict the contract's "titles need not be unique".
- **Evidence:**
  - user-experience-designer UX-003
  - junior-developer JD-003
  - `src/posts/posts.ts` (the `create` comment)
  - [C-11](current-state-findings.md#c-11-a-title-exists-today-only-as-a-folder-name-and-an-h1-seeded-at-create-time)
- **Behavior impact:** Changing. A duplicate is allowed with a warning, where today it is refused. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - **Refusing a duplicate title in the UI.** The contract allows duplicates.
  - **Showing the id on rows whose titles clash.** It shows an opaque id, and nothing yet shows clashes are common
    (see Deferred).
- **Revisit criterion:** Duplicates from before the upgrade, such as nested posts sharing a fallback title, turn out to
  be common.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › UI; Surface Delta (S-12)

### D-28: The writer sees titles, and every message says what to do next

- **Question:** What exact copy does the writer see in the list, the dialogs, the notices, and the missing-post state?
- **Decision:** The copy pinned in the plan's Target State › UI:
  - **One label everywhere.** `label(id)` is the listed title, or else the id. It is used in the header, the notices,
    the Undo dialog, and the "Show “{label}” in the post list" `aria-label`.
  - **Dialogs.** The New post, Rename, and Delete dialogs.
  - **The missing-post state.** Its notice, and the Discard confirm.
  - **Missing-post rows.** Their text is `{label} — unsaved, not in your posts`.
  - **Next steps.** A failed Save or an unapplied Claude edit says what to do next.
  - **Dismissing.** The `notApplied` and `notUndone` notices get the existing `CloseIcon` button.
  - **Focus.** It moves into the editor after Create.
  - **Kept from the tree.** The list keeps `tree-paused`, `newPosts`, and `finds`.
- **Rationale:**
  - "This post no longer exists" was false for drafts from before the upgrade, whose post is still listed.
  - A one-click Discard could destroy the only copy of the text.
  - The Delete copy must say that side files go too, because the app no longer shows them.
  - Ids leaked into messages that the list shows as titles.
  - Dropping the three hooks the tree had would break the empty-state New post, the reason shown while Claude works,
    and "Show in the post list".
- **Evidence:**
  - user-experience-designer UX-001, UX-002, UX-004, UX-007, UX-008, UX-009, UX-010, UX-012, UX-013
  - `src/ui/documents/documents/documents.tsx:222-226`, `:772`, `:823-831`
  - `src/ui/documents/file-tree/file-tree.tsx:150-161`, `:375`
- **Behavior impact:** Changing. The writer-facing copy is new, and Discard asks to confirm. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - **A placeholder in an empty new post.** It is not needed (YAGNI).
  - **An in-app notice that loose files are no longer listed.** The README covers it (see Deferred).
  - **Exporting the server's sentences from `wire.ts`.** The UI shows the `error` text it receives, so it needs no copy.
- **Revisit criterion:** A writer reports confusion with any of these states.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12, S-14, S-15
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › UI; Surface Delta (S-12, S-14)

### D-29: Undo all leaves a post the AI made listed and empty

- **Question:** `NewPost` puts an empty post on disk. What does Undo all do with it?
- **Decision:**
  - Undo all treats the post like any other edited post. It returns to its base at the start of the turn: the empty
    body on disk.
  - The post stays listed and open.
  - When the turn made posts, the warning adds: "Posts Claude made stay in your list, empty. Delete them from the list
    if you don't want them."
  - The announcement reads: "Undid Claude's changes in {n} posts. Posts it made are still in your list."
- **Rationale:** Today, the Undo copy promises that everything goes back to how it was at Send. Without the warning, a
  leftover empty post would contradict it. Deleting the post on undo would be the AI's action deleting a post.
- **Evidence:**
  - user-experience-designer UX-005
  - test-engineer, Task 4
  - `src/ui/documents/documents/documents.tsx:860-880`
  - [D-10](#d-10-the-ai-makes-a-post-with-newpost-which-creates-it-empty-on-disk-at-once)
- **Behavior impact:** Changing. The Undo dialog and its announcement mention posts Claude made. Settled under
  [D-24](#d-24-behavior-changes-are-settled-under-the-users-standing-delegation).
- **Rejected alternatives:**
  - **Deleting the post on Undo all.** It is a destructive step taken on the AI's behalf (see Deferred).
  - **Closing the post without saying so.** It hides an empty post the writer may not know about.
- **Revisit criterion:** Writers find leftover empty posts a nuisance.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8, S-14
- **Dependent decisions:** None.
- **Referenced in plan:** Target State › UI; Surface Delta (S-8, S-14)

### D-30: Three narrow uses of an id beyond store and pass back

- **Question:** `posts.ts` says callers "never build, parse, order, or show" an id. The plan does each of these once.
  Is that reopening the design?
- **Decision:** These three uses are recorded as deliberate exceptions. None of them makes an id carry meaning:
  - **Ordering.** The list, and the `Posts` tool, break ties between equal titles by id. That gives a stable order and
    nothing more.
  - **Showing.** An entry whose post is missing has no title, so its label falls back to the id.
  - **Building.** The editing log's file name derives a slug from the id, and the log records the id itself so a
    clashing slug cannot be confused.
- **Rationale:** Each is the smallest way to meet a need: a stable sort, a label when no title exists, and a log name
  a person can read. None parses an id as a path or gives its parts meaning.
- **Evidence:** junior-developer JD-002, JD-007; `src/posts/posts.ts:16-17`.
- **Behavior impact:** Preserving. It records choices that other entries already make.
- **Rejected alternatives:**
  - **Insertion order for ties.** The store promises no order, so the list would reorder between loads.
  - **A fixed label such as "Unknown post".** Two missing entries could not be told apart.
  - **A random log name.** Resume could not find the log.
- **Revisit criterion:** A store whose ids are not readable, such as UUIDs, makes the log slug useless.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** None.
- **Referenced in plan:** Why This Change

### D-31: The README feature-name rule is reworded

- **Question:** `README.md:49-50` says that a capability spanning packages uses the same name in each, citing
  `documents`. After this change, the server has `posts/`, the UI has `documents/`, and the engine has no feature
  folder. What does the rule say?
- **Decision:** The rule's examples become `chat` and `events`. The README notes that the server's `posts/` routes serve
  the UI's `documents/` feature, which holds the editor and the post list.
- **Rationale:** Renaming `src/ui/documents/` is high churn for symmetry alone (see Deferred). Naming the server module
  `documents/` would keep a name the change is retiring.
- **Evidence:** junior-developer JD-004; `README.md:49-50`; change-plan Project Context (churn).
- **Behavior impact:** Preserving. It is documentation.
- **Rejected alternatives:**
  - **Renaming the UI feature to `posts/`.** It is deferred.
  - **Naming the server module `src/server/documents/`.** It keeps a retired name.
- **Revisit criterion:** The next restructuring of the UI documents feature.
- **Dissent (if any):** None.
- **Settles delta entry:** S-27
- **Dependent decisions:** None.
- **Referenced in plan:** Surface Delta (S-27)

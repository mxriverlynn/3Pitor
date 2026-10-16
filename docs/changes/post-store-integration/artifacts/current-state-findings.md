# Current State Findings: Post Store Integration

## Provenance

These findings come from this run's own discovery round, on 2026-10-16, against `main` at `46ed225`, the merge of PR #38.

Three agents ran in parallel. Each was given the area in `scope-boundary.md` and the recorded reason:

- `han-core:structural-analyst` produced S-1 to S-12.
- `han-core:behavioral-analyst` produced B-1 to B-17.
- `han-core:concurrency-analyst` produced K-1 to K-11.

Each was told to reuse the design's prior findings, F1–F36 in
[`../../post-management-api/context-brief.md`](../../post-management-api/context-brief.md). Each finding below names the
agent findings it merges and the F-N it confirms or supersedes. All three agents read the code and ran nothing.

Two corrections to the brief, which all three agents made independently:

- **There is no autosave.** Post text reaches disk only through an explicit Save. Only the view state is written on a
  timer.
- **The change channel is a WebSocket** (`/ws/events`), not SSE. SSE carries only the chat-turn stream.

## Project Context

- **Stack:** Bun and TypeScript. Hono on the server. React with ProseMirror and Yjs in the UI. `bun test`, with
  happy-dom for UI tests. A Node check for the Bun-free engine.
- **Conventions source:** `README.md`, which sets out:
  - the layout: package → feature → component
  - one-way imports between packages, enforced by each package's `boundary.test.ts`
  - a Bun-free engine, enforced by `src/engine/bun-free.test.ts`
  - for `src/posts/`: only cli, server, and engine may import it, only through `posts.ts` and `post-error.ts`, and the
    engine imports `posts.ts` with `import type` only

  No `CLAUDE.md`, `AGENTS.md`, or `project-discovery.md` exists.
- **Commands:**
  - `make test` runs `typecheck`, `check-node`, `test-server`, and `test-ui`.
  - `make build`.
  - `src/server/scripts/check.ts` is a live end-to-end check against a real model.
  - There is no lint command.
- **ADRs found:** none under `docs/adr/`. Decisions live in `docs/changes/*/` plan folders.
- **Coding standards found:** none found apart from `README.md`.
- **Recent churn:** over the last 90 days the UI documents feature churns most (`git log --since="90 days ago"`):
  - `markdown-editor.test.tsx` changed in 55 commits, and `markdown-editor.tsx` in 50.
  - `app.tsx`: 36.
  - `documents.tsx`: 30.
  - `wire.ts`: 22.
  - `file-tree.tsx`: 21.
  - `server.ts` and `check.ts`: 20 each.

  The tree, the sidebar, and the wire types are the most-edited surface this change rewrites.

## Gaps

- No ADRs and no coding-standards documents exist. The design docs under `docs/changes/` and `README.md` stand in for
  them.
- No shared test builder exists for `EngineOptions`. `engine.test.ts` builds engines by hand five times (C-26).
- No test covers the skill files against the tool contract. Only `tools.test.ts` and the live `check.ts` guard them
  (C-19).
- No version field or tag exists in `view.json` or `session.json` that could tell an old path from a new id (C-21,
  C-22).
- No stop path exists for the engine or the server (C-24).
- No test double for `PostStore` exists outside `src/posts/`. The contract suite `describe-post-store.ts` is test-only,
  and `src/posts/boundary.test.ts` blocks importing it outside `src/posts/`.
- No UI code tells a post title apart from its H1. A title exists today only as the folder name and an H1 written at
  create time (C-11).

## Findings

### C-1: The import rules fix where each integration piece may sit

- **Claim:** Only cli, server, and engine may import `src/posts/`, and only through `posts/posts` or `posts/post-error`.
  Engine production code may import `posts/posts` with `import type` only. `src/shared/` and `src/ui/` may not import
  the package at all.
- **Location:** `src/posts/boundary.test.ts:21-23`, `:37-60`; `src/posts/posts.ts:3-6`; `README.md:26-27`, `:40-48`
- **Evidence:**
  ```ts
  const ENTRIES = new Set(['posts', 'post-error']);
  const IMPORTERS = ['src/cli/', 'src/server/', 'src/engine/'];
  ```
  ```ts
  export { PostError, type PostErrorReason } from './post-error';
  export { createFilePostStore } from './file/file-post-store';
  ```
  This gives four consequences:
  - `EngineOptions.posts` must be typed with `import type { PostStore } from '../posts/posts'`.
  - The engine recognizes a refusal with `instanceof PostError`, imported from `../posts/post-error`. `.reason` alone
    is not enough, because `FileSystemError` has the same two reasons.
  - Only cli can call `createFilePostStore`.
  - `wire.ts` must restate any post shape by hand, because shared cannot import posts.
- **Raised by:** structural-analyst S-1, S-5. Confirms F31; F32 is resolved by the build.
- **Confidence:** Verified
- **Bears on:** S-1, S-2, S-6, D-2, D-6

### C-2: cli builds only a FileSystem, and the engine watches it with the unsubscribe thrown away

- **Claim:** `cli.ts` builds one `createLocalFileSystem(root)` and passes it to `startEngine`. `startEngine` subscribes
  `fileSystem.watch` with `ignore: isHiddenKey`, emits `documents-changed`, and discards the unsubscribe. There is no
  engine `stop()`, and `server.ts:24` says "Nothing stops the server today". `createEngine`, the test path, never
  watches.
- **Location:** `src/cli/cli.ts:13-21`; `src/engine/engine.ts:84-98` (watch at `:89`); `src/server/server.ts:24`
- **Evidence:**
  ```ts
  const fileSystem = createLocalFileSystem(root);
  const engine = await startEngine({
    fileSystem,
    appSkillFiles: APP_SKILL_FILES,
  ```
  ```ts
  fileSystem.watch(() => events.emit({ type: 'documents-changed' }), { ignore: isHiddenKey });
  ```
- **Raised by:** structural S-11; behavioral B-1; concurrency K-7. Confirms F8, F19.
- **Confidence:** Verified
- **Bears on:** S-1, S-2, D-3

### C-3: The engine keeps FileSystem for everything that is not a post

- **Claim:** After integration, `fileSystem` must stay in `EngineOptions`. It holds:
  - `.3pitor/session.json`, `view.json`, `config.json`, and `.3pitor/.gitignore` (`json-file.ts:7-13`)
  - the `.3pitor/*.md` app notes the tools write (`tools.ts:205-211`)
  - workspace skills and agents (`workspace-config`)
  - the model config
  - the generic `Read` and `Glob` tool access to `CLAUDE.md`, `AGENTS.md`, `README.md`, and `editing-lessons.md`

  `json-file.ts` keys are all under `.3pitor/`, which the post store treats as hidden. So app state and posts never
  overlap.
- **Location:** `src/engine/engine.ts:130-152`; `src/engine/components/json-file.ts:7-37`; `src/engine/chat/tools/tools.ts:192-211`
- **Evidence:**
  ```ts
  const isHidden = (name: string) => name.startsWith('.');
  ```
  (`file-post-store.ts:13`; hidden segments are never posts, `:109`, `:129`)
- **Raised by:** structural S-11, "Well-structured areas"; behavioral B-1. Resolves F30 for state.
- **Confidence:** Verified
- **Bears on:** S-1, D-2

### C-4: `documents.ts` is the documents API and all of it goes. One export has another importer.

- **Claim:** `src/engine/documents/documents.ts` (168 lines) holds `DocumentError`, `checkPath`, `listEntries`,
  `readDocument`, `writeDocument`, `createFolder`, `createPost`, `moveEntry`, `countContents`, `deleteEntry`, and
  `existingKind`. `Engine['documents']` (`engine.ts:39-49`) is its only declaration. `engine.ts:16` re-exports
  `DocumentError` for the server. `isHiddenKey` (`documents.ts:26-27`) is imported by `engine.ts:10` only for the watch.
  `draftText` (`:118-124`) is the only engine user of `markdownSerializer` and `schema` from `src/shared/markdown`.
- **Location:** `src/engine/documents/documents.ts`; `src/engine/engine.ts:10`, `:16`, `:39-49`
- **Evidence:**
  ```ts
  export { DocumentError } from './documents/documents';
  ```
  ```ts
  // Overwrites the file, creating any missing parent folders; Save writes a post the AI made in a new folder this way.
  export async function writeDocument(...)
  ```
- **Raised by:** structural S-2; behavioral B-6, B-8. Confirms F8, F17, F28. Supersedes F9, F10, F13, F14, F16, which
  move into the store or go away.
- **Confidence:** Verified
- **Bears on:** S-3, S-4, D-4

### C-5: Today's list returns every folder and `.md` file, sorted by path. The UI nests them by `/`.

- **Claim:**
  - `listEntries` pushes every non-hidden folder and every `.md` file as `{ path, kind }` and sorts by path.
  - The UI's `nest()` builds a tree from `/`.
  - `listed()` synthesizes folder nodes and `onDisk: false` file nodes for open entries.
  - Every post row is labelled `basename(path)`, which is `draft.md`.
- **Location:** `src/engine/documents/documents.ts:54-75`; `src/shared/wire.ts:50-59`;
  `src/ui/documents/file-tree/file-tree.tsx:15-31`, `:334`; `src/ui/documents/documents/documents.tsx:674-685`
- **Evidence:**
  ```ts
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  ```
- **Raised by:** behavioral B-4; structural S-8. Replaces F13. Confirms F6, F7.
- **Confidence:** Verified
- **Bears on:** S-5, S-11, D-8

### C-6: Routes are `/api/documents/...`, keyed by a `:name` path parameter, and map `DocumentError` to 404 or 400

- **Claim:**
  - The routes are `GET /api/documents`, `GET`/`PUT /api/documents/:name`, and `POST /api/documents/create`,
    `/create-post`, `/move`, `/count`, and `/delete`.
  - The UI sends `encodeURIComponent(name)`.
  - `onError` maps `DocumentError` to 404 for `not-found` and 400 otherwise, with body `{ error }`. Anything else becomes
    a plain-text 500.
  - A bad request body throws `DocumentError('invalid', …)`.
  - Ids with `/` already travel through `:name` today, since every draft path holds one (`the sun/draft.md`). So an
    encoded `%2F` does reach the parameter intact.
- **Location:** `src/server/documents/documents.routes.ts:18-22`, `:23-60`, `:68-73`; `src/ui/documents/documents/documents.tsx:162`, `:661`
- **Evidence:**
  ```ts
  app.onError((error, c) => {
    if (error instanceof DocumentError) return c.json<ApiError>({ error: error.message }, error.reason === 'not-found' ? 404 : 400);
    console.error(error);
    return c.text('Internal Server Error', 500);
  });
  ```
  ```ts
  throw new DocumentError('invalid', `the request body is not valid: ${z.prettifyError(parsed.error)}`);
  ```
- **Raised by:** structural S-6; behavioral B-5, B-7. Confirms F27. Supersedes F17, F18. The structural agent's
  "Unverified" note on `%2F` is closed by the existing path ids, which hold `/` and work.
- **Confidence:** Verified
- **Bears on:** S-6, D-6, D-7

### C-7: The UI never branches on an error reason, only on the HTTP status and the message

- **Claim:** `api.ts` throws an `Error` that carries `status`, with the body's `error` string as its message.
  `syncFile` and `undoTurn` branch on `status === 404`. Save failures show
  `Could not save ${name}: ${error.message}`.
- **Location:** `src/ui/components/api.ts:4-19`; `src/ui/documents/documents/documents.tsx:279-283`, `:709-712`
- **Evidence:**
  ```ts
  throw Object.assign(new Error(typeof message === 'string' ? message : text || `${res.status} ${res.statusText}`), { status: res.status });
  ```
- **Raised by:** behavioral B-7, B-6
- **Confidence:** Verified
- **Bears on:** S-6, S-11

### C-8: Save is an explicit upsert that creates missing folders, and the UI depends on that for AI-made posts

- **Claim:**
  - Save sends `PUT /api/documents/:name { content }`, which creates parent folders as it goes.
  - Save joins an in-flight save (`entry.saving`), counts saves (`entry.saves`), and refreshes the list when the name is
    not yet listed.
  - When a post is gone, the notice reads `… is not on disk. Save creates it.`
- **Location:** `src/ui/documents/documents/documents.tsx:154-182`, `:777-782`; `src/engine/documents/documents.ts:82-86`
- **Evidence:**
  ```ts
  // A post the AI created exists on disk only once it is saved.
  if (!listRef.current.some((e) => e.path === name)) await refreshList();
  ```
- **Raised by:** behavioral B-6, B-3; concurrency K-1, K-2. Confirms F10, F22.
- **Confidence:** Verified
- **Bears on:** S-9, S-11, D-9, D-10

### C-9: The AI tools never write a post to disk. They change an in-memory copy for the turn.

- **Claim:**
  - The tools' copy for each turn is `turn.texts`, a `Map` keyed by post name. `Write` and `Edit` change only that map.
  - The edited texts go to the browser as `data-progress` and `data-session` parts (`edited`, keyed by name).
  - Disk changes only when the writer saves.
  - Only `.3pitor/*.md` notes, through `resolveAppNote` and `writeText`, are written directly.
  - `Write` on an unknown post starts from `''`. That is how the AI makes a post today.
- **Location:** `src/engine/chat/tools/tools.ts:1-5`, `:82-148`, `:192-211`
- **Evidence:**
  ```ts
  const text = turn.texts.get(name) ?? (await fileSystem.read(name).catch((error: unknown) => {
    if (error instanceof FileSystemError && error.reason === 'not-found') return '';
    throw error;
  }));
  ```
- **Raised by:** behavioral B-11, B-12; concurrency (corrections, K-1); structural S-3. Confirms F22, F23.
- **Confidence:** Verified
- **Bears on:** S-7, S-8, D-10, D-11

### C-10: `resolvePost` is the tools' post check, and it is path-shaped

- **Claim:**
  - `resolvePost` refuses `3pitor://skills/…`, normalizes the path, and refuses anything not ending in `.md` or holding a
    dot-leading segment.
  - `postName` wraps it.
  - `turnTexts(documents)` passes every key the browser sends through `postName`. So the post map the browser sends
    with a chat request is normalized and checked here.
  - A store id such as `v1.0` or `the sun` would be refused.
  - `normalizeKey` rewrites `./a` and `a/../b`. Store ids are exact and must not be rewritten (`posts.ts:9-18`).
- **Location:** `src/engine/chat/tools/tools.ts:18-32`, `:72-75`
- **Evidence:**
  ```ts
  function resolvePost(filePath: string): string {
    if (filePath.startsWith(APP_SKILL_PREFIX)) throw new Error(`${filePath} is not a markdown post`);
    const key = normalizeKey(filePath);
    if (!key.endsWith('.md') || key.split('/').some((s) => s.startsWith('.'))) {
  ```
- **Raised by:** structural S-3; behavioral B-11. Confirms F28.
- **Confidence:** Verified
- **Bears on:** S-7, D-11

### C-11: A title exists today only as a folder name and an H1 seeded at create time

- **Claim:**
  - UI "New post" sends `POST /api/documents/create-post { parent, title }`.
  - The server makes the folder `newEntryName(title)` and writes `draft.md` holding `# title` (escaped through
    `markdownSerializer`).
  - A taken name is a 400. A title with no usable characters is a 400.
  - The UI gates submit on `newEntryName(draft)` and shows the hint `Folder: ${name}`.
  - Nothing reads a title back: the tree shows `draft.md`, and the header shows the path.
  - Existing posts have no `.post.json`, so the store gives them the folder's last segment as their title.
- **Location:** `src/engine/documents/documents.ts:98-124`; `src/ui/documents/file-tree/file-tree.tsx:74-78`, `:168-206`;
  `src/ui/documents/documents/documents.tsx:195-202`, `:746-750`; `src/posts/file/file-post-store.ts:147-165`
- **Evidence:**
  ```ts
  const name = newEntryName(title);
  if (!name) throw new DocumentError('invalid', `${JSON.stringify(title)} has no characters a folder name can use`);
  ```
  ```ts
  clean: (draft) => newEntryName(draft),
  ```
- **Raised by:** behavioral B-8, B-17; structural S-2(b), S-8. Confirms F4, F9. F4's "lossily" is superseded for the
  store side.
- **Confidence:** Verified
- **Bears on:** S-10, S-11, D-12, D-13

### C-12: Rename is a move, and move is the only code that rewrites keys in UI state

- **Claim:**
  - Rename calls `move(path, parent + withMd(name))`.
  - `move` re-keys `opened`, `turnBases`, `current`, and `highlights.file` through `movedPath`.
  - It does not re-key `turnSaves`, `turnStart`, `turnEdited`, or `turnFile`, which is an existing gap.
  - Drag and drop and "Move to…" use the same route.
- **Location:** `src/ui/documents/file-tree/file-tree.tsx:80`, `:209-267`; `src/ui/documents/documents/documents.tsx:204-219`
- **Evidence:**
  ```ts
  opened.current = new Map([...opened.current].map(([name, entry]) => [renamed(name), entry]));
  ```
- **Raised by:** behavioral B-9; structural S-8; concurrency K-10. Confirms F16, F26.
- **Confidence:** Verified
- **Bears on:** S-5, S-11, D-8

### C-13: Delete is recursive and prefix-matched in the UI, with a count shown first for folders

- **Claim:**
  - Delete calls `POST /api/documents/delete { path }`.
  - The confirm dialog calls `count` for folders and lists unsaved paths through `dirtyWithin(path)`.
  - After delete the UI forgets every open entry `within(name, path)`.
  - Siblings such as `outline.md` live in post folders, and the `.data/workspace/the sun/` fixture has both.
- **Location:** `src/ui/documents/file-tree/file-tree.tsx:276-289`; `src/ui/documents/documents/documents.tsx:228-240`;
  `src/engine/documents/documents.ts:137-158`
- **Evidence:**
  ```ts
  await api('POST', '/api/documents/delete', { path });
  endOffer((file) => within(file, path));
  for (const name of [...opened.current.keys()]) if (within(name, path)) forget(name);
  ```
- **Raised by:** behavioral B-10; structural S-8. Confirms F14, F15.
- **Confidence:** Verified
- **Bears on:** S-6, S-11, D-8

### C-14: `syncWithDisk` is the UI's only reconciliation, and it is keyed by path

- **Claim:**
  - `syncWithDisk` runs on each `documents-changed` event and on every WebSocket (re)connect.
  - Calls coalesce to one running plus one queued.
  - `syncOnce` refreshes the list, then for each open entry:
    - keeps a dirty entry whose post vanished
    - forgets a clean one only after a read returns 404
    - follows disk text only when the entry is clean and no save started during the read
  - Failures are swallowed with `console.error`.
- **Location:** `src/ui/documents/documents/documents.tsx:273-335`; `src/ui/app.tsx:97-118`
- **Evidence:**
  ```ts
  if (!now.some((e) => e.path === name)) {
    entry.diskText = undefined;
    if (!entry.dirty && before.some((e) => e.path === name)) {
      await readFile(name).catch((error) => { if (error.status === 404 && opened.current.get(name) === entry) forget(name); });
    }
    return;
  }
  ```
- **Raised by:** behavioral B-3; concurrency K-4, K-10. Confirms F21.
- **Confidence:** Verified
- **Bears on:** S-11, D-14

### C-15: The store's watch changes what signals, and it signals each own write twice

- **Claim:**
  - Today `isHiddenKey` ignores every hidden segment.
  - The store's `ignoreForWatch` passes `.post.json` and cuts off hidden folders, so `.3pitor/` writes never signal.
  - Changes to sibling files inside a post folder (`outline.md`) still signal.
  - Each own write signals at once, before its promise settles, and again through the watcher 100 ms to 1 s later.
  - The UI's echo guards make the repeat harmless to correctness: the `entry.saving` join, the `entry.saves` counter,
    and text equality. Each repeat costs one list plus one read per open post.
- **Location:** `src/posts/file/file-post-store.ts:37-42`, `:71-93`, `:275-289`; `src/engine/engine.ts:89`;
  `src/ui/documents/documents/documents.tsx:290`, `:306-335`
- **Evidence:**
  ```ts
  const ignoreForWatch = (key: string) => {
    const last = lastSegment(key);
    return isHidden(last) && last !== META;
  };
  ```
- **Raised by:** concurrency K-4, K-5; behavioral B-2; structural S-2(a). Confirms F19, F20, BC13.
- **Confidence:** Verified
- **Bears on:** S-2, D-3

### C-16: One throwing listener stops the event bus for every later listener

- **Claim:** `EventBus.emit` loops with no try/catch. A `ws.send` that throws on a closing socket would stop delivery to
  later tabs, and an emit throw from `record()`'s `finally` rejects the turn stream.
- **Location:** `src/engine/events/events.ts:13-16`; `src/server/events/events.routes.ts:15`; `src/engine/chat/sessions/sessions.ts` (`record()`)
- **Evidence:**
  ```ts
  emit(event: HostEvent) { for (const listener of this.listeners) listener(event); }
  ```
- **Raised by:** concurrency K-6; behavioral B-2
- **Confidence:** Unverified: whether Bun's `ws.send` on a closed socket throws or returns -1 could not be checked
  without running it. This defect exists before the change, and the change does not touch it.
- **Bears on:** Cut for Scope (CS-3)

### C-17: The post name crosses every layer as a bare string, under several field names

- **Claim:** `wire.ts` carries the post reference as a plain `string` in these places:

  | Field | Name used |
  | --- | --- |
  | `ChatRequest.openFile` | file |
  | `ChatRequest.documents` keys | name |
  | `SessionHighlights.file` | file |
  | `SessionData.edited` keys | name |
  | `TurnProgress.edited` keys | name |
  | `StoredDoc.name` | name |
  | `TurnRecord.file` | file |
  | `TurnRecord.bases` keys | name |
  | `NotApplied.name` | name |
  | `ViewState.current` | current |

  `DocumentEntry`, `DocumentList`, `CreatedPost`, `FolderCount`, and the request bodies carry paths, kinds, and folders.
  `ApiError` is documented as the body of every 4xx from the documents routes.
- **Location:** `src/shared/wire.ts:7-75`, `:130-163`
- **Evidence:**
  ```ts
  export interface DocumentEntry {
    path: string;
    kind: 'file' | 'folder';
  }
  ```
- **Raised by:** structural S-4, S-5. Confirms F25, F26, F27, F33.
- **Confidence:** Verified
- **Bears on:** S-5, S-8, D-5

### C-18: The chat route trusts the browser's post map and open file, and puts the open file into the model's prompt

- **Claim:**
  - `isDocuments` checks only that the values are strings.
  - `openFile` is any non-empty string. The engine writes it into the user turn as
    `The file open in my editor is ${openFile}. …`.
  - Under the store an id can be nearly any folder name, newlines included.
  - Today `resolvePost` rejects bad map keys inside `execute`, which surfaces as a stream error.
- **Location:** `src/server/chat/sessions/sessions.routes.ts:22-44`, `:57-58`; `src/engine/chat/sessions/sessions.ts:128-137`
- **Evidence:**
  ```ts
  { type: 'text', text: `The file open in my editor is ${openFile}. When my message does not name a file, it means this file.` },
  ```
- **Raised by:** behavioral B-11; structural S-4, "Gaps"
- **Confidence:** Verified (code); the security consequence is for the review round
- **Bears on:** S-8, D-16

### C-19: The system prompt and the skills teach path addressing

- **Claim:**
  - **The system prompt's tools block** says every file path is workspace-relative, that Write creates a post, and that
    only `.md` posts change.
  - **`collaborative-editing/SKILL.md`:**
    - takes `[draft path]` as its argument
    - globs `**/*.md` to find drafts
    - derives a slug from the folder when the file is `draft.md`
    - globs `**/README.md` for series notes
    - reads and writes `editing-lessons.md` at the workspace root
    - logs to `.3pitor/editing/`
  - **`proofread/SKILL.md`** takes a path.
  - **`research/SKILL.md`** writes into "the file open in the editor" and reads `CLAUDE.md` and `AGENTS.md`.
  - **The prompt is a single template literal** with no `${` and no backslash (`system-prompt.ts:1-2`).
- **Location:** `src/engine/chat/agent/system-prompt.ts:76-78`; `src/skills/collaborative-editing/SKILL.md:11`, `:34-52`,
  `:123`; `src/skills/proofread/SKILL.md:24-25`; `src/skills/research/SKILL.md:87-98`, `:228`
- **Evidence:**
  ```
  Every file path you give a tool is relative to the workspace folder, which holds the writer's posts; paths outside it are refused. Read a file before you change it. Use Edit to change part of a post and Write to create or replace a whole post. Only markdown (.md) posts can be changed.
  ```
- **Raised by:** structural S-7; behavioral B-13. Confirms F24, F35.
- **Confidence:** Verified. The behavioral agent grepped the skills' `references/` files but did not read them in full.
- **Bears on:** S-12, S-13, D-17, D-18

### C-20: A root `editing-lessons.md` is written through the post path today

- **Claim:**
  - The collaborative-editing skill writes `editing-lessons.md` at the workspace root with `Write`.
  - It is not under `.3pitor/`, so `resolveAppNote` does not catch it.
  - It ends in `.md`, so `resolvePost` accepts it as a post. It lands in `turn.texts` and reaches the editor as an AI
    edit.
  - After integration it is neither a post nor an app note.
- **Location:** `src/skills/collaborative-editing/SKILL.md:49`, `:123`; `src/engine/chat/tools/tools.ts:107-125`
- **Evidence:** `SKILL.md:123` tells the model to Write `editing-lessons.md` "at the workspace root".
- **Raised by:** structural S-3; behavioral B-13
- **Confidence:** Verified
- **Bears on:** S-7, S-12, D-18

### C-21: view.json stores post names in seven places, cast rather than parsed, and restores them unchecked

- **Claim:**
  - `ViewState` holds post references in `current`, `unsaved[].name`, `highlights.file`, `notApplied[].name`,
    `turn.file`, and `turn.bases` keys. `appliedTurn` is a message id, not a post reference.
  - The PUT stores the body as sent, and the load casts it.
  - On restore:
    - each `unsaved` entry is tracked with no existence check, so an old-form name becomes a phantom dirty entry
    - `current` that 404s is dropped with only a `console.error`
    - `highlights.file` and `turn.file` are kept verbatim
  - Real old-form data exists in fixtures:
    - `src/fixtures/workspace/.3pitor/view.json` has `"current":"notes.md"`.
    - `src/.data/workspace/.3pitor/view.json` has `"current":"the sun/draft.md"`.
- **Location:** `src/shared/wire.ts:130-163`; `src/engine/view-state/view-state.ts:8-15`;
  `src/server/view-state/view-state.routes.ts:11-19`; `src/ui/documents/documents/documents.tsx:415-474`
- **Evidence:**
  ```ts
  // The page is the only writer, and restoring drops any piece it cannot use, so the body is stored as sent.
  await viewState.save(await c.req.json<ViewState>());
  ```
- **Raised by:** behavioral B-14; concurrency K-3, K-9. Confirms F25, F26.
- **Confidence:** Verified
- **Bears on:** S-14, D-19

### C-22: session.json stores old post names inside chat records, and the UI re-applies the last turn on load

- **Claim:**
  - `session.json` is `{ id, messages, uiMessages }`, checked only for shape.
  - Post names appear in three places:
    - tool-call inputs (`file_path`)
    - `data-session.edited` keys
    - `data-session.highlights.file`
  - On load, `applyPending` re-applies the last reply's `edited` map unless `appliedTurn` matches. Old-form keys
    therefore become phantom dirty entries.
  - A resumed chat sends the model its old tool calls, with old paths.
  - Nothing carries a version.
- **Location:** `src/engine/chat/sessions/sessions.ts:52-66`, `:194-196`; `src/ui/documents/documents/documents.tsx:582-589`;
  `src/ui/chat/chat/chat.tsx:15-20`, `:43-48`
- **Evidence:**
  ```ts
  if (!reply || !session || session.data.aborted || reply.id === appliedTurn.current) return;
  await applyTurn(reply.id, session.data);
  ```
- **Raised by:** behavioral B-15; structural S-4. Confirms F25, F26.
- **Confidence:** Verified
- **Bears on:** S-14, D-19

### C-23: Tombstones last only for the store instance, so a restart can give a deleted post's id to a new post

- **Claim:** `tombstones` is an in-memory `Set`. After a restart, a new post titled like a deleted one gets the same id.
  A stored reference to the old post then reaches the new one: `view.json` `current`, `unsaved`, `turn`, and session
  records. A second tab's debounced view write can also re-store references to a post another tab just deleted.
- **Location:** `src/posts/file/file-post-store.ts:60-62`, `:109`, `:186`; `src/ui/documents/documents/documents.tsx:481-510`
- **Evidence:**
  ```ts
  const tombstones = new Set<string>();
  ```
- **Raised by:** concurrency K-3, K-9; design Open Risks
- **Confidence:** Verified
- **Bears on:** S-14, D-19

### C-24: Nothing stops the engine, and a dead watcher is never noticed

- **Claim:**
  - No `stop()`, signal handler, or disposal exists.
  - If `sessions.load()` rejects after the watch starts, `startEngine` throws with the subscription still live.
  - If the local watcher stops itself on an error (`watch.ts:42-46`), the store's subscription set stays non-empty. A
    later `watch()` does not restart it, so outside edits stop reaching the UI. That was already true before the store.
- **Location:** `src/engine/engine.ts:84-98`; `src/server/server.ts:24`; `src/file-system/local/local-file-system/watch.ts:42-46`;
  `src/posts/file/file-post-store.ts:277`
- **Evidence:**
  ```ts
  if (subscriptions.size === 0) stopWatching = fileSystem.watch(() => signal(), { ignore: ignoreForWatch });
  ```
- **Raised by:** concurrency K-7; behavioral B-1
- **Confidence:** Verified
- **Bears on:** S-2, D-3; Cut for Scope (CS-4)

### C-25: The UI fake re-implements the old routes, upsert included

- **Claim:**
  - `fake-documents-api.ts` serves list, create, create-post, move, count, delete, and `GET`/`PUT` by name.
  - It writes `${folder}/draft.md` with an unescaped `# ${title}`.
  - Its PUT is an upsert.
  - `app.test.tsx`, `documents.test.tsx` (1,673 lines), and `file-tree.test.tsx` (888 lines) use it.
  - It follows `wire.ts` through `satisfies`.
- **Location:** `src/ui/components/fake-documents-api.ts:1-89`
- **Evidence:**
  ```ts
  api.files.set(`${folder}/draft.md`, `# ${title}\n`);
  return Response.json({ path: `${folder}/draft.md` } satisfies CreatedPost);
  ```
- **Raised by:** structural S-9; behavioral B-16. Confirms F34.
- **Confidence:** Verified
- **Bears on:** S-15, D-20

### C-26: Server and engine tests, the check script, and the shipped fixture all use loose root `.md` files as documents

- **Claim:**
  - **`check.ts`** uses loose root files throughout:
    - It PUTs and GETs `scratch.md`.
    - It stores `current: 'notes.md'` in the view state.
    - It sends `openFile: 'notes.md'` with `documents: { 'notes.md': … }`.
    - It targets `soil-draft.md` and `ideas.md`.
    - It asserts an AI-made `summary.md` appears in `edited` but not on disk.
  - **`src/fixtures/workspace/`**, the workspace a first-time user lands in through `WORKSPACE_FIXTURE`, holds
    `notes.md` and no post folder.
  - **`engine.test.ts`** builds five engines by hand with `createEngine({ fileSystem, … })`.
  - **`documents.routes.test.ts`** and **`documents.test.ts`** test the API being removed.
  - **`tools.test.ts`** (405 lines) is path-shaped.
- **Location:** `src/server/scripts/check.ts:138-305`; `src/fixtures/workspace/notes.md`; `src/cli/cli.ts:8`;
  `src/engine/engine.test.ts:27`, `:35`, `:51`, `:63`, `:83`; `src/engine/chat/tools/tools.test.ts`
- **Evidence:**
  ```ts
  const turn = await chat(session.id, 'Create a new post named summary.md holding a one-sentence summary of notes.md.');
  ```
- **Raised by:** structural S-9, S-10; behavioral B-12, B-16
- **Confidence:** Verified
- **Bears on:** S-15, S-16, D-21

### C-27: `paths.ts` and the tree's path algebra serve only the hierarchy

- **Claim:**
  - `paths.ts` holds `within`, `movedPath`, `basename`, and `parentOf`. Only `documents.tsx` and `file-tree.tsx` use
    them, for nesting, move re-keying, delete prefixes, and the header.
  - `file-tree.tsx` (497 lines) builds the tree, menus, drag and drop, the move dialog, and the create, rename, and
    delete dialogs.
  - `newEntryName` from `src/shared/entry-name.ts` is used by the store, the tree's dialogs, and the fake.
- **Location:** `src/ui/documents/components/paths.ts:1-16`; `src/ui/documents/file-tree/file-tree.tsx`; `src/shared/entry-name.ts`
- **Evidence:**
  ```ts
  export const within = (p: string, root: string) => p === root || p.startsWith(root + '/');
  ```
- **Raised by:** structural S-8; behavioral B-4
- **Confidence:** Verified
- **Bears on:** S-11, D-8

### C-28: The store's per-post queue already fixes two of today's races

- **Claim:**
  - `get`, `setBody`, `setTitle`, and `delete` share one per-id queue registered before any await. So a write after a
    delete is `not-found` and can no longer bring the folder back (F12).
  - Because rename is `setTitle` and keeps the id, today's save-during-move race goes away.
  - `list()` is not queued, and the UI already tolerates a list and a read disagreeing.
- **Location:** `src/posts/file/file-post-store.ts:48-58`, `:210-274`
- **Evidence:**
  ```ts
  const result = (queues.get(id) ?? Promise.resolve()).then(run);
  ```
- **Raised by:** concurrency K-8, K-10, K-11
- **Confidence:** Verified
- **Bears on:** S-6

### C-29: A dirty entry for a post that is gone can never be saved under the store

- **Claim:** Today Save on a missing path recreates it. Under the store, `setBody` on a missing or deleted id is
  `not-found`. Cases that leave an entry trapped:
  - a tab holding edits for a post another tab deleted
  - a restored `unsaved` entry for a post deleted before the reload
  - an old-form name from before integration

  Each leaves a dirty entry whose only exit, Save, always fails.
- **Location:** `src/ui/documents/documents/documents.tsx:276-285`, `:415-422`, `:461-466`; `src/posts/file/file-post-store.ts:245-251`
- **Evidence:**
  ```ts
  setBody(id, body) {
    return changing(() =>
      enqueue(id, async () => {
        await locatePost(id);
  ```
- **Raised by:** concurrency K-2; behavioral B-3, B-14
- **Confidence:** Verified
- **Bears on:** S-11, D-14

## Findings No Agent Could Audit

- **Runtime behavior.** No agent ran the app, the tests, or `check.ts`. Watcher batching (F20) is taken from the prior
  brief. Bun's `ws.send` behavior on a closed socket (C-16) is unknown.
- **Real stored data.** The full shape of tool inputs persisted in a real `session.json` was not inspected beyond the
  fixtures. Closing this needs a run with a stored session.
- **Large UI tests.** `documents.test.tsx` and `file-tree.test.tsx` were not read in full. The size of their rewrite is
  estimated from line counts only.
- **Skill references.** The `references/` files under `src/skills/collaborative-editing/` were grepped, not read in
  full. More path assumptions may exist there. The builder reads them when editing the skill.

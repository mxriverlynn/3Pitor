# Current State Findings: Research Documents and an Outline on the Current Post

## Provenance

Two sources:

1. **A prior report, for the posts package.** [../context-brief.md](../context-brief.md) holds findings F1–F34 on
   `src/posts/` and the file store (written 2026-10-19 by the `design-an-api` run), and
   [../api-design.md](../api-design.md) holds the designed `PostStore` contract. They are cited by their own F-numbers
   and not restated here. Neither covers the engine, server, wire, or UI integration.
2. **This run's own discovery round, for the integration areas.** `han-core:structural-analyst` (S1–S18),
   `han-core:behavioral-analyst` (B1–B18), and `han-core:concurrency-analyst` (K1–K11), each given the four areas in
   [scope-boundary.md](scope-boundary.md). Their findings are merged below by substance. Each C-N lists every
   originating identifier.

Ground truth: `src/posts/posts.ts` is still today's contract (`list`, `get`, `create`, `setBody`, `setTitle`,
`delete`, `watch`). The eight research and outline methods and `PostErrorSubject` exist only in the design.

## Project Context

- **Stack:** TypeScript on Bun (server, cli, posts) with a Bun-free engine that also loads on Node 22.15+. React 19
  UI with ProseMirror and Yjs. Hono routes. The AI SDK (`ai` 7) with Anthropic, OpenAI, Google, and a Claude CLI
  adapter. Tests are `bun test`, with UI tests under happy-dom. `make test` runs typecheck, a Node check, server tests,
  and UI tests. `bun run check` (`src/server/scripts/check.ts`) runs live-model scenarios and needs an API key.
- **Conventions source:** none found (no CLAUDE.md, no `project-discovery.md`). Conventions come from code comments,
  the boundary tests, and earlier plans under `docs/changes/`.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn (90 days):** `markdown-editor.tsx` 51, `app.tsx` 38, `documents.tsx` 35, `wire.ts` 26,
  `file-post-store.ts` 7, `tools.ts` 6, `research/SKILL.md` 5, `post-table.tsx` 5. A `src/ui/documents/file-tree/`
  folder appears in the log but no longer exists; it became `post-list/`. Precedent plans:
  `docs/changes/post-store-integration/`, `docs/changes/post-table-landing-page/`.

## Gaps

- No outline skill, tool, route, wire type, or UI reader exists. Nothing in `src/` produces an outline today (C-7).
- No server or engine code interprets `/research`. The model decides to follow the skill from the `<skills>` list (C-3).
- No AI-tool, route, wire, or UI surface is designed in `api-design.md`. It covers the store only.
- No field in `ChatRequest`, `SessionData`, `TurnProgress`, `ViewState`, or `HostEvent` names a document kind or a
  research or outline id.
- No validation of `ViewState` on `PUT /api/view-state`, and no version field in `view.json` or `session.json`.
- No ADRs, no coding standards, no CLAUDE.md.

## Findings

### C-1: The engine reaches the store through two type windows, and only the tools' window is a closed list

- **Claim:** `Engine['posts']` is `Omit<PostStore,'watch'>`, so new store methods reach `postRoutes` with no edit. The
  AI tools take `Pick<PostStore,'get'|'list'|'create'>`, which must be widened for each method a tool calls.
- **Location:** `src/engine/engine.ts:24,41`; `src/engine/chat/tools/tools.ts:79`; `src/server/posts/posts.routes.ts:16`
- **Evidence:**
  ```ts
  readonly posts: Omit<PostStore, 'watch'>;
  export function fileTools(fileSystem: FileSystem, posts: Pick<PostStore, 'get' | 'list' | 'create'>, appSkillFiles: AppSkillFiles, turn: TurnTexts, onChange: () => void = () => {}) {
  ```
- **Raised by:** structural-analyst S1
- **Confidence:** Verified
- **Bears on:** S-2, S-17; D-2, D-9

### C-2: Tests spread a real store, so the store can grow without breaking them

- **Claim:** No test hand-writes a full `PostStore` literal. Doubles spread `createFilePostStore(...)`.
- **Location:** `src/server/posts/posts.routes.test.ts:140,154`; `src/engine/engine.test.ts:76`
- **Evidence:**
  ```ts
  const broken: PostStore = { ...posts, get: async () => Promise.reject(new Error('the disk went away')) };
  ```
- **Raised by:** structural-analyst S2
- **Confidence:** Verified
- **Bears on:** S-2; D-2

### C-3: Import boundaries are machine-checked; the UI and shared code cannot import the posts package

- **Claim:** Only cli, server, and engine import `src/posts/`, only through `posts/posts` and `posts/post-error`. The
  engine imports `posts/posts` as types only. `src/shared/` may not import `src/posts/`. The engine must stay Bun-free.
- **Location:** `src/posts/boundary.test.ts:16-20,29-32,70-100`; `src/engine/bun-free.test.ts`
- **Evidence:**
  ```ts
  const ENTRIES = new Set(['posts', 'post-error']);
  const IMPORTERS = ['src/cli/', 'src/server/', 'src/engine/'];
  ```
- **Raised by:** structural-analyst S3, S16
- **Confidence:** Verified
- **Bears on:** S-5, S-6; D-4

### C-4: The open post reaches the model as one sentence; the research skill depends on its wording

- **Claim:** The browser sends `openFile` (the current post id). The engine adds it to the user turn as a sentence, and
  the research skill, system prompt, and check script rely on that sentence. No type connects them.
- **Location:** `src/shared/wire.ts:10-16`; `src/server/chat/sessions/sessions.routes.ts:22-39`;
  `src/engine/chat/sessions/sessions.ts:137`; `src/skills/research/SKILL.md:87-91`;
  `src/engine/chat/agent/system-prompt.ts:77`; `src/server/scripts/check.ts:295-318`
- **Evidence:**
  ```ts
  { type: 'text', text: `The post open in my editor is ${JSON.stringify(openFile)}. When my message does not name a post, it means this post.` },
  ```
- **Raised by:** behavioral-analyst B1; structural-analyst S6
- **Confidence:** Verified
- **Bears on:** S-19, S-21; D-10

### C-5: The research skill writes its report into the open post's body, after any text already there

- **Claim:** Step 5 of the skill Writes the whole report into the open post by id, appending it to the existing text.
  With no post open, it asks the writer to open one and stops. The skill's tool list is a literal list of names.
- **Location:** `src/skills/research/SKILL.md:4-7,16-22,87-91,229-237`
- **Evidence:**
  ```
  5. **Write the report into the open post**, in one Write call, by the post's id. Read the post first. When it is
     empty, the report is the whole post. When it already has text, keep all of that text exactly as it is and put the
     report after it, separated by a blank line
  ```
- **Raised by:** behavioral-analyst B2, B15; structural-analyst S7
- **Confidence:** Verified (skill text); model behavior Unverified (needs a live model)
- **Bears on:** S-21; D-13

### C-6: The check script encodes "the report goes into the open post"

- **Claim:** Two live-model scenarios assert the report lands in the open post's `edited` text, after the existing
  text. They run under `bun run check`, not `make test`.
- **Location:** `src/server/scripts/check.ts:295-318`
- **Evidence:**
  ```ts
  // 'skill: research writes its report into the open post, after the text already there'
  Object.keys(edited).join() === ideas
  text.startsWith('# Post ideas\n\nNotes to start from.')
  ```
- **Raised by:** structural-analyst S17
- **Confidence:** Verified (read); Unverified as run (needs a live model)
- **Bears on:** S-22; D-14

### C-7: No outline producer exists; an outline today lands in the post body, the chat, or a hidden note

- **Claim:** There is no outline skill or tool. Asked to outline, the model can only Write or Edit the post body, write a
  `.3pitor/` note that belongs to no post, make a new post, or answer in chat. Read can already read
  `the sun/outline.md` as a plain workspace file, but no tool can write it.
- **Location:** `src/engine/chat/agent/system-prompt.ts:48-78`; `src/engine/chat/tools/tools.ts:105-136,227-235`
- **Evidence:**
  ```
  Use Edit to change part of a post, Write to replace a whole post, and NewPost to make a new post from a title and its text.
  ```
- **Raised by:** behavioral-analyst B6; structural-analyst S7
- **Confidence:** Verified
- **Bears on:** S-20; D-11, D-12

### C-8: Every AI file tool addresses a document by one post-id string

- **Claim:** `TurnTexts` maps post id to text. `target()` resolves an id from the turn copy, then the store's body, and
  refuses anything else as "not a post". `storedBody` treats any `'not-found'` as "no post".
- **Location:** `src/engine/chat/tools/tools.ts:20-39,81-96`
- **Evidence:**
  ```ts
  export interface TurnTexts { texts: Map<string, string>; edited: Set<string>; highlights?: SessionHighlights; }
  const text = turn.texts.get(id) ?? (await storedBody(id));
  if (text === undefined) throw new Error(`${id} is not a post. Call Posts to list the posts by id, or NewPost to make one.`);
  ```
- **Raised by:** structural-analyst S4; behavioral-analyst B2, B7; concurrency-analyst K6
- **Confidence:** Verified
- **Bears on:** S-17; D-9

### C-9: The AI reaches disk two ways today, and `NewPost` is the only store write

- **Claim:** AI text either goes to the turn copy (unsaved in the editor until the writer saves) or, for `.3pitor/*.md`
  notes, straight to disk through `FileSystem`. `NewPost` is the one tool that writes the store: it creates an empty
  post, then puts the text in the turn as an unsaved edit. The tools' header and the system prompt promise that AI
  edits stay unsaved.
- **Location:** `src/engine/chat/tools/tools.ts:1-5,74,119-136,198-217`; `src/engine/engine.ts:21-24`
- **Evidence:**
  ```ts
  // ... change only that copy: a post reaches disk only through the user's Save. The exception is a markdown note under .3pitor/
  id = await posts.create({ title, body: '' });
  markEdited(turn, id, content);
  ```
- **Raised by:** structural-analyst S5; concurrency-analyst K8
- **Confidence:** Verified
- **Bears on:** S-17, S-18; D-7

### C-10: Tool plumbing is generic; only the subagent union and the skill prose enumerate tool names

- **Claim:** A tool added to the object `fileTools` returns reaches every provider, the MCP endpoint, and the Claude
  CLI adapter with no edit. Subagents are limited to `'Read' | 'Glob'`.
- **Location:** `src/engine/chat/agent/agent.ts`; `src/server/chat/mcp-endpoint/mcp-endpoint.ts:44-47`;
  `src/engine/chat/claude-cli/claude-cli.ts:219`; `src/engine/workspace-config/workspace-config.ts:20,61`
- **Evidence:**
  ```ts
  return { Read, Write, Edit, Glob, Highlight, Posts, NewPost };
  ```
- **Raised by:** structural-analyst S18; behavioral-analyst B17
- **Confidence:** Verified
- **Bears on:** S-18; D-8

### C-11: Turn results carry edits keyed by post id, and the browser loads each one through the post route

- **Claim:** `SessionData.edited` and `TurnProgress.edited` are `Record<string,string>` keyed by post id. The browser's
  `applyEditedNow` loads any unopened name with `GET /api/posts/:id`. A name that is not a post fails with "That post no
  longer exists. Ask Claude again with the post open."
- **Location:** `src/shared/wire.ts:34-47`; `src/engine/chat/sessions/sessions.ts:168-170`;
  `src/engine/chat/agent/agent.ts:52-58`; `src/ui/documents/documents/documents.tsx:356-412`
- **Evidence:**
  ```ts
  if (!isListed(name)) await refreshList();
  await ensureLoaded(name);
  turnBases.current.set(name, mergeMarkdown(entry!.doc, turnBase ?? entry!.loadBase, edited[name]));
  ```
- **Raised by:** behavioral-analyst B3, B18; structural-analyst S8
- **Confidence:** Verified
- **Bears on:** S-12; D-20, D-23

### C-12: A document the turn did not have at Send has no merge base, and a mid-turn save of it is refused

- **Claim:** `beginTurn` snapshots only opened, listed, supported entries. An edited document with no base merges
  against its load base. If it was saved during the turn, the edit is refused with "it was saved while Claude was
  working". `made` (posts Claude created) is computed against the post list at Send.
- **Location:** `src/ui/documents/documents/documents.tsx:333-353,385-399,547-560`
- **Evidence:**
  ```ts
  if (entry && !turnBase && entry.saves > (turnSaves.current.get(name) ?? 0)) {
    failed.push({ name, message: 'it was saved while Claude was working' });
  const made = files.filter((name) => !turnListed.current.has(name));
  ```
- **Raised by:** behavioral-analyst B4; concurrency-analyst K5, K6
- **Confidence:** Verified
- **Bears on:** S-12; D-7, D-20

### C-13: `useDocuments` is one 972-line hook in which every map, ref, and persisted field keys by post id

- **Claim:** `opened`, `loading`, `current`, `turnBases`, `turnSaves`, `turnStart`, `turnEdited`, `turnListed`,
  `turnFile`, `lastTurn`, `highlights.file`, and the persisted `ViewState` all use one string name, the post id. Loads
  and saves go through two helpers, `postUrl`/`readFile` and the PUT in `save`.
- **Location:** `src/ui/documents/documents/documents.tsx:12-100,115-133,164-210,635-700`
- **Evidence:**
  ```ts
  const opened = useRef(new Map<string, Entry>());
  const postUrl = (id: string) => `/api/posts/${encodeURIComponent(id)}`;
  async function readFile(id: string): Promise<string> { return (await api<Post>('GET', postUrl(id))).body; }
  await api('PUT', `${postUrl(name)}/body`, { body: content });
  ```
- **Raised by:** structural-analyst S12; behavioral-analyst B9; concurrency-analyst K3
- **Confidence:** Verified (lines 411-630 read only through grep)
- **Bears on:** S-12; D-4, D-20

### C-14: "Gone" means "not in the post list", and a 404 closes the entry

- **Claim:** `isGone` checks the post list only. `syncFile` forgets a clean entry whose id left the list when a read
  returns 404. Gone entries are left out of the turn and show "These unsaved changes belong to a post that isn't in
  your list".
- **Location:** `src/ui/documents/documents/documents.tsx:126-131,268-300,861-869`
- **Evidence:**
  ```ts
  const isGone = (id: string) => listLoaded.current && !isListed(id);
  if (error.status === 404 && opened.current.get(name) === entry) forget(name);
  ```
- **Raised by:** behavioral-analyst B10; concurrency-analyst K3
- **Confidence:** Verified
- **Bears on:** S-12; D-22

### C-15: A `PostError` maps to HTTP by reason alone, and `ApiError` carries only a message

- **Claim:** `'not-found'` becomes 404 and anything else 400, with the fixed message as `{ error }`. Any other error is a
  plain-text 500. The UI tells failures apart by `error.status`. A research-document 404 would be the same status as a
  post 404, with a different message.
- **Location:** `src/server/posts/posts.routes.ts:15-21`; `src/shared/wire.ts:82-85`; `src/ui/components/api.ts:16-18`
- **Evidence:**
  ```ts
  if (error instanceof PostError) return c.json<ApiError>({ error: error.message }, error.reason === 'not-found' ? 404 : 400);
  ```
- **Raised by:** behavioral-analyst B13; structural-analyst S9, S15
- **Confidence:** Verified (`api.ts` read by structural-analyst only)
- **Bears on:** S-7, S-10; D-6

### C-16: Save PUTs to the post body route and reports a 404 as "That post no longer exists"

- **Claim:** A save failure with 404 shows "Could not save “name”: That post no longer exists. Copy your changes into
  another post."
- **Location:** `src/ui/documents/documents/documents.tsx:164-190,731-741`
- **Evidence:**
  ```ts
  await api('PUT', `${postUrl(name)}/body`, { body: content });
  ```
- **Raised by:** behavioral-analyst B5
- **Confidence:** Verified
- **Bears on:** S-12; D-23

### C-17: `wire.ts` restates store shapes by hand, kept in step only by route generics

- **Claim:** `Post`, `PostSummary`, and `PostList` exist in both `src/posts/posts.ts` and `src/shared/wire.ts`. The
  routes' `c.json<T>` pairing keeps them structurally equal. Requests are validated with zod schemas typed against wire.
- **Location:** `src/shared/wire.ts:49-85`; `src/server/posts/posts.routes.ts:5-14,27-39`
- **Evidence:**
  ```ts
  // These restate the store's own shapes, which shared code cannot import; each route's c.json<…> pairing keeps the two in step.
  ```
- **Raised by:** structural-analyst S9
- **Confidence:** Verified
- **Bears on:** S-6; D-5

### C-18: Post routes are one file with one error mapper, mounted once

- **Claim:** `postRoutes(posts: Engine['posts'])` serves GET/POST `/api/posts`, GET/DELETE `/api/posts/:id`, and PUT
  `/api/posts/:id/title` and `/body`. Its `onError` and zod `body()` helper are file-private. Search reads every post
  body in the route layer.
- **Location:** `src/server/posts/posts.routes.ts:16-81`; `src/server/server.ts:33`
- **Evidence:**
  ```ts
  .route('/', postRoutes(engine.posts))
  ```
- **Raised by:** structural-analyst S10
- **Confidence:** Verified
- **Bears on:** S-9; D-5

### C-19: The left panel is a flat list of every post, and also hosts New post, Rename, Delete, and "Show in the post list"

- **Claim:** `PostList` renders every post by title with a "…" menu (Rename, Delete), an "(unsaved)" marker, rows for
  unsaved posts no longer listed, the "+" New post button, the New post dialog (which the post table reaches through the
  `newPosts` counter), and the scroll target for the editor's "Show in the post list" button.
- **Location:** `src/ui/documents/post-list/post-list.tsx:1-111`; `src/ui/documents/post-table/post-table.tsx`;
  `src/ui/documents/documents/documents.tsx:805`; `src/ui/app.tsx:131-132`
- **Evidence:**
  ```tsx
  useEffect(() => { if (docs.newPosts && !busy) askNewPost(); }, [docs.newPosts]);
  {[...docs.posts].sort(byTitle).map((post) => (
  {docs.missing.map((id) => (
  ```
- **Raised by:** structural-analyst S11, S13; behavioral-analyst B8
- **Confidence:** Verified
- **Bears on:** S-13, S-14; D-15, D-16, D-17

### C-20: The post table is the landing page and already duplicates open, rename, and delete

- **Claim:** With no post open, the editor shows `PostTable`, which has its own row menu, search, and New post button
  (through the sidebar's dialog). The editor's Home button returns to it. `byTitle` is copied in the list, the table,
  and the `Posts` tool.
- **Location:** `src/ui/documents/post-table/post-table.tsx:1-60`; `src/ui/documents/documents/documents.tsx:806,822`
- **Evidence:**
  ```ts
  const byTitle = (a: PostSummary, b: PostSummary) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  ```
- **Raised by:** structural-analyst S11, S13; behavioral-analyst B8
- **Confidence:** Verified
- **Bears on:** S-15; D-15, D-16

### C-21: The `busy` pause gates only the list's create, rename, and delete

- **Claim:** While Claude works, the list and table disable New post, Rename, and Delete so the ids the AI's edits come
  back under stay current. Open, editing, and saving are not gated.
- **Location:** `src/ui/documents/post-list/post-list.tsx:29,82,106`; `src/ui/chat/chat/chat.tsx:202,218-219`
- **Evidence:**
  ```tsx
  {busy && 'Changes to the post list are paused while Claude works. You can still open posts.'}
  ```
- **Raised by:** concurrency-analyst K5; behavioral-analyst B8
- **Confidence:** Verified
- **Bears on:** S-14; D-19

### C-22: Store signals are detail-free; each one makes the browser re-list posts and re-read every open entry

- **Claim:** `posts.watch` becomes a `posts-changed` event on a WebSocket with no replay. The browser runs
  `syncWithDisk`: single-flight with one queued slot, refreshing the post list and then reading each opened entry in
  turn. On reconnect it syncs again. Sync errors are logged and swallowed.
- **Location:** `src/engine/engine.ts:81`; `src/server/events/events.routes.ts:9-23`; `src/ui/app.tsx:96-118`;
  `src/ui/documents/documents/documents.tsx:268-329`
- **Evidence:**
  ```ts
  const unsubscribe = posts.watch(() => events.emit({ type: 'posts-changed' }));
  if (event.type === 'posts-changed') docs.syncWithDisk();
  } catch (error) { console.error('Could not sync with the disk:', error); }
  ```
- **Raised by:** behavioral-analyst B11; concurrency-analyst K2, K10, K11
- **Confidence:** Verified (file-watch debounce not inspected)
- **Bears on:** S-12; D-21

### C-23: Only the post list has a latest-wins guard

- **Claim:** `listCalls` drops an older `GET /api/posts` answer. No equivalent exists for any per-post list, so a slow
  answer for post A could show under post B.
- **Location:** `src/ui/documents/documents/documents.tsx:116-127`
- **Evidence:**
  ```ts
  const call = ++listCalls.current;
  const { posts } = await api<PostList>('GET', '/api/posts');
  if (call === listCalls.current) {
  ```
- **Raised by:** concurrency-analyst K1
- **Confidence:** Verified
- **Bears on:** S-12; D-21

### C-24: `open` shows whichever load settles last, not the last click

- **Claim:** `open` awaits `ensureLoaded` and then calls `show(name)`. Two quick opens can end with the earlier one
  shown.
- **Location:** `src/ui/documents/documents/documents.tsx:136-158`
- **Evidence:**
  ```ts
  await ensureLoaded(name);
  show(name);
  ```
- **Raised by:** concurrency-analyst K4
- **Confidence:** Verified (existing behavior; not introduced by this change)
- **Bears on:** — (plan Risks)

### C-25: View state persists the open post and unsaved documents by name, and restore keeps only listed posts

- **Claim:** `ViewState.current`, `unsaved[].name`, `highlights.file`, `turn.file`, `turn.bases`, and
  `notApplied[].name` are post ids. The server stores the body as sent. Restore checks each name with `known(id)`
  against the post list.
- **Location:** `src/shared/wire.ts:127-173`; `src/server/view-state/view-state.routes.ts:9-21`;
  `src/ui/documents/documents/documents.tsx:429-500`
- **Evidence:**
  ```ts
  viewState.save(await c.req.json<ViewState>()) // "the body is stored as sent"
  ```
- **Raised by:** behavioral-analyst B16; structural-analyst S8
- **Confidence:** Verified
- **Bears on:** S-8, S-12; D-22

### C-26: The UI's fake post API replicates the routes and their messages

- **Claim:** `fake-posts-api.ts` is an in-memory replica of the post routes for UI tests, handling only `/api/posts`
  URLs and copying the two `PostError` messages. Its ids contain a slash and a space on purpose.
- **Location:** `src/ui/components/fake-posts-api.ts:1-76`
- **Evidence:**
  ```ts
  const NOT_FOUND = 'That post no longer exists.';
  const NEEDS_TITLE = 'A post needs a title.';
  ```
- **Raised by:** structural-analyst S14
- **Confidence:** Verified
- **Bears on:** S-11; D-6, D-31

### C-27: A turn's progress and result re-send every edited text, and the session keeps each turn's open-post sentence

- **Claim:** Each Write or Edit sends a `data-progress` part with the full `edited` map, and `data-session` repeats it.
  `session.json` stores every user turn, including its "The post open in my editor is …" sentence.
- **Location:** `src/engine/chat/agent/agent.ts:54-56`; `src/engine/chat/sessions/sessions.ts:155,168`
- **Evidence:**
  ```ts
  const data: TurnProgress = { edited: editedTexts(turn), highlights: turn.highlights };
  ```
- **Raised by:** behavioral-analyst B1, B18
- **Confidence:** Verified
- **Bears on:** S-19; D-10

### C-28: A store signal can reach the browser before the HTTP response to the write that caused it

- **Claim:** The store signals before its promise settles, and the event socket sends at once. The browser can sync
  before its own `await api(...)` returns. Both orders converge today because every path re-reads.
- **Location:** `src/server/events/events.routes.ts:15`; `src/ui/documents/documents/documents.tsx:193-228`
- **Evidence:**
  ```ts
  const { id } = await api<Pick<PostSummary, 'id'>>('POST', '/api/posts', { title });
  setCreated(id);
  await refreshList();
  ```
- **Raised by:** concurrency-analyst K9
- **Confidence:** Verified
- **Bears on:** — (accepted as is; plan Target State)

### C-29: The file watcher ignores hidden names except `.post.json`

- **Claim:** `ignoreForWatch` drops every hidden name but `.post.json`, so another writer's `.research.json` change would
  not signal unless widened (the design's R8).
- **Location:** `src/posts/file/file-post-store.ts:36-42`
- **Evidence:**
  ```ts
  const ignoreForWatch = (key: string) => { const last = lastSegment(key); return isHidden(last) && last !== META; };
  ```
- **Raised by:** behavioral-analyst B12; context-brief F25
- **Confidence:** Verified
- **Bears on:** S-3; D-3

### C-30: Sample data already holds `outline.md` and a flat `research.md` beside `draft.md`

- **Claim:** `src/.data/workspace/the sun/` holds `draft.md`, `outline.md`, and `research.md`, and
  `src/.data/workspace/research/` holds a research file that belongs to no post. These are dev data, not test fixtures.
- **Location:** `src/.data/workspace/`
- **Evidence:** file listing: `the sun/draft.md`, `the sun/outline.md`, `the sun/research.md`,
  `research/tenet-palindrome-origins.md`
- **Raised by:** structural-analyst S7, S17; context-brief F2, F3, F34
- **Confidence:** Verified
- **Bears on:** S-3; D-24

## Findings No Agent Could Audit

- **Live-model behavior.** Whether the model follows a changed research skill or system prompt can only be seen by
  running `bun run check` with an API key. Nobody ran it. Closing it takes a live `bun run check` run at the end of Unit 5.
- **The file-watch debounce** (`src/file-system/local/local-file-system/watch.ts`) was not read, so whether bursts of
  signals coalesce is unknown (C-22).
- **`documents.tsx` lines 411–630** (restore, `applyPending`, the view-write debounce) were read only through grep.

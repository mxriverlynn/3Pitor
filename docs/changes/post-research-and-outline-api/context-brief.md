# Context Brief: Research and Outline Documents on a Post

**Goal (verbatim):** "to associate research documents and outline documents with a blog post. both are optional. a blog
post can have zero or more research documents associated with it. a blog post can have zero or one outline associated
with it. the implementation of this api will live in the post management package. do not worry about actual
implementation yet, though, i'm only setting the direction for now. we'll handle planning the implementation and
integration later."

**Starting point:** working tree, identical to `main` at 7b6d459, branch `post-research-and-outline-api`.

**Conventions:** no `CLAUDE.md` or `project-discovery.md`. Conventions are inferred from the surrounding code and from
the earlier design in `docs/changes/post-management-api/`.

**Discovery wave:** `han-core:codebase-explorer` (CE), `han-core:data-engineer` (DE), `han-core:structural-analyst`
(SA). All three returned usable findings. Labels such as DE-7 or SA-2 point to the numbered item in that agent's
report; they are not decision numbers, which appear only in `artifacts/decision-log.md` (D1–D11).

## Findings

### What exists today

- **F1.** No code type, schema, route, or reader for a research document or an outline exists anywhere in `src/`.
  Provenance: grep across `src/` (CE-1, SA-5).
- **F2.** The sample workspace keeps these as sibling markdown files in a post folder: `the sun/` holds `draft.md`,
  `outline.md` (987 bytes), and `research.md` (4017 bytes). Each starts with its own H1. Provenance:
  `src/.data/workspace/the sun/*.md`; `docs/changes/post-management-api/context-brief.md:50-52` (CE-2, DE-7).
- **F3.** A root-level `research/tenet-palindrome-origins.md` exists that belongs to no post. Provenance:
  `src/.data/workspace/research/` (CE-3, DE-2).
- **F4.** The research skill today writes its report into the open post's body, appended after any existing text, not
  into a sibling file. Provenance: `src/skills/research/SKILL.md:87-90, 229-232`; `src/server/scripts/check.ts:305`
  (CE-4, DE-2).
- **F5.** The agent tools can Write/Edit/Highlight only post ids; sibling files are readable by path through `Read` but
  not writable. Provenance: `src/engine/chat/tools/tools.ts:81-88, 103-115` (CE-5).
- **F6.** The earlier design cut exactly this capability: "Named parts such as `outline` and `research`. Cut because the
  goal names posts, not their sub-documents." It deferred it with the trigger "The skills need them through the store".
  Option C (named parts per post) was rejected because the goal did not ask for it and it made the file mapping heavier.
  Provenance: `docs/changes/post-management-api/api-design.md:713-724, 820`; `design-options.md:190-199, 279` (CE-6,
  CE 28, SA-5, DE-3).
- **F7.** The store is already wired into production: `cli.ts` builds it, the engine takes it and turns `watch` into
  a `posts-changed` event, and the server routes map `PostError` to HTTP (`not-found` to 404, every other reason to
  400). Provenance: `src/cli/cli.ts:17`; `src/engine/engine.ts:24,41,81`; `src/server/posts/posts.routes.ts:20`
  (software-architect, correcting the explorer's reading of `scope-boundary.md`).

### The `PostStore` contract the new surface must align with

- **F8.** `PostId` is a store-assigned string: exact, stable within one store, never reused by one store instance, and
  opaque. Any string naming no post is `'not-found'`, with no "malformed id" class. Provenance: `src/posts/posts.ts:8-19`
  (CE-7, DE-5).
- **F9.** `list()` returns `PostList { posts: PostSummary[] }`, an object so paging can be added later, with no body and
  no promised order. `get` returns `Post { id, title, body }`. Provenance: `src/posts/posts.ts:29-47, 57-59` (CE-8, SA-4).
- **F10.** Mutators are per field, id first, then value: `setBody(id, body)`, `setTitle(id, title)`. `create` takes an
  object and returns only the id. Provenance: `src/posts/posts.ts:62-71` (SA-4).
- **F11.** `delete(id)` "Removes the post, and everything the store keeps for it, for good"; after it every call on that
  id is `'not-found'`. The file store removes the whole folder recursively. The UI confirm text already tells writers that
  deleting a post deletes "any other files in it, such as notes or outlines". Provenance: `src/posts/posts.ts:73-80`;
  `src/posts/file/file-post-store.ts:262-274`; `src/ui/documents/post-list/post-list.test.tsx:126` (CE-9, CE-19, DE-1).
- **F12.** A `PostError` rejection changed nothing; any other rejection is a storage failure. `PostErrorReason` is the
  closed union `'not-found' | 'invalid'`, each reason with a fixed message: "That post no longer exists." and "A post
  needs a title." The contract suite keeps its own copy of the message table. Provenance: `src/posts/posts.ts:53-54`;
  `src/posts/post-error.ts:5-12`; `src/posts/components/describe-post-store.ts:14-23` (CE-10, SA-3, DE-15).
- **F13.** A title is blank when `title.trim() === ""`; NUL and lone surrogates are outside the contract. A title and a
  body H1 are independent. Provenance: `src/posts/posts.ts:21-26, 36-40` (CE-11, DE-14).
- **F14.** Calls naming one post id through one store take effect in call order; the file store implements this with one
  per-id queue. Provenance: `src/posts/posts.ts:49-52`; `src/posts/file/file-post-store.ts:48-58` (CE-12).
- **F15.** Every own write that reaches storage signals every `watch` subscription before its promise settles; a
  `PostError` does not signal. Signals carry no detail. The watch rule names exactly create, setBody, setTitle, and
  delete. Provenance: `src/posts/posts.ts:78-94`; `src/posts/file/file-post-store.ts:71-93` (CE-13, SA-5).

### Package structure and consumers

- **F16.** Outside `src/posts/`, only cli, server, and engine may import the package, and only through `posts/posts` and
  `posts/post-error`. The engine imports `posts/posts` with `import type` only. New types must be re-exported from
  `posts.ts`. Production files must be Bun-free and import only package modules, `src/file-system/file-system.ts`, and
  `src/shared/*`. Provenance: `src/posts/boundary.test.ts:24-85`; `src/posts/bun-free.test.ts:1-31` (SA-1, CE-14).
- **F17.** `createFilePostStore` is the only implementor. Test doubles build on it by spreading (`{ ...posts, list }`),
  so new methods on `PostStore` would not break them. Provenance: `src/server/posts/posts.routes.test.ts:140-154`;
  `src/engine/engine.test.ts:76` (SA-2).
- **F18.** `Engine.posts` is `Omit<PostStore, 'watch'>`, so any method added to `PostStore` is exposed to the server
  automatically. Sessions and the agent take the whole store; the tools take
  `Pick<PostStore, 'get' | 'list' | 'create'>`. Provenance: `src/engine/engine.ts:5,24,41`;
  `src/engine/chat/tools/tools.ts:79`; `src/engine/chat/sessions/sessions.ts:32`; `src/engine/chat/agent/agent.ts:29`
  (SA-2).
- **F19.** One contract suite, `describePostStore(name, makeStore)`, covers the whole interface. Its fixture exposes only
  `store`. A new interface held to a suite needs either a widened fixture or a second suite with new `TEST_ONLY` and
  `EXEMPT` entries. Provenance: `src/posts/components/describe-post-store.ts:8-28`; `src/posts/boundary.test.ts:13`;
  `src/posts/bun-free.test.ts:11` (SA-3).
- **F20.** A sibling interface built apart from `createFilePostStore` cannot see its tombstones or per-id queue, so it
  could not order its writes against `delete` without sharing that state. Provenance:
  `src/posts/file/file-post-store.ts:49-143` (SA-5, DE-10).

### File store layout constraints

- **F21.** A post is a non-hidden folder holding `draft.md`; its title lives in `.post.json`. The walk never descends
  into a post folder, and ids passing through a folder holding `draft.md` are refused. So a `research/` subfolder inside
  a post is never mistaken for a post. Provenance: `src/posts/file/file-post-store.ts:10-11, 107-143` (CE-16, CE-18,
  DE-7).
- **F22.** Sibling files and subfolders are ignored by list/get/set today. BC3 in the earlier design states that
  siblings such as `outline.md` and `research.md` "are not listed or addressable through `posts`"; the new surface amends
  that. Provenance: `src/posts/file/file-post-store.ts:125-143`; `docs/changes/post-management-api/api-design.md:652-654`
  (CE-18, CE-29, DE-21).
- **F23.** `.post.json` holds only `{ "title" }` and is rewritten whole on every `setTitle`. Association data kept there
  would be wiped by the next title change. Provenance: `src/posts/file/file-post-store.ts:145-179` (CE-17, DE-17).
- **F24.** `FileSystem.write` creates missing parent folders, so a research or outline write that is not queued behind a
  post's delete can recreate the deleted folder as an orphan holding user content. Provenance:
  `src/file-system/file-system.ts:45-51` (CE-23, DE-10).
- **F25.** The watcher ignores hidden names other than `.post.json`, so a hidden layout such as `.research/` would never
  signal changes from other writers. Provenance: `src/posts/file/file-post-store.ts:37-42` (DE-18).
- **F26.** Create-failure cleanup removes a half-made folder only when it holds nothing but `.post.json` and `draft.md`.
  Provenance: `src/posts/file/file-post-store.ts:168-174` (CE-20, DE-19).

### Data-contract considerations (inferred)

- **F27.** The contract's delete wording already commits to the post owning everything the store keeps for it. Research
  shared across posts is the one choice that would break that promise, and it would need a link table and an orphan
  policy the goal does not ask for. Provenance: inferred from F11 (DE-1, D3, D9).
- **F28.** The outline needs no id of its own: at most one per post, so the post id names it. Research needs ids that
  follow the `PostId` rules, so a stale call can never reach a later document. Provenance: inferred from F8 (DE-4, D5).
- **F29.** "No outline" and "an empty outline" are different states, since bodies round-trip `""`. The contract must
  say which `get` returns and how an outline is removed. Provenance: inferred from `src/posts/posts.ts:39` (DE-12).
- **F30.** Research has no natural order; opaque ids rule out sorting by id. The contract either promises an order or
  supplies a field callers sort by. Provenance: inferred from `src/posts/posts.ts:57` (DE-13).
- **F31.** Research bodies should not be inlined into `Post` or `PostSummary`: `get` would grow with n, and `list()` must
  stay body-free. Provenance: inferred from `src/posts/posts.ts:28` (DE-16).
- **F32.** The fixed-message error table gives the wrong message for a missing research document under a live post
  ("That post no longer exists.") or a blank research title ("A post needs a title."). Provenance: inferred from F12
  (DE-15).
- **F33.** A database maps owned research to `research(id, post_id FK ON DELETE CASCADE, title, body, created_at)` and
  the outline to a nullable column or a table keyed by `post_id`. Both enforce the cardinalities and the delete cascade.
  Provenance: inferred (DE-8).
- **F34.** Existing flat `research.md` files do not fit a 0..n subfolder layout; they stay invisible unless migrated or
  read as legacy. Provenance: inferred from F2 (DE-20).

## Open items with no evidence

- **O1.** Can one research document belong to more than one post? (F27 points to no.)
- **O2.** Do research documents have titles, and in what order do they come back? (F30)
- **O3.** Is the outline replaced on write or created once, and is "no outline" distinct from an empty one? (F29)
- **O4.** Must the existing flat `research.md` files stay visible? (F34; this is an integration concern.)

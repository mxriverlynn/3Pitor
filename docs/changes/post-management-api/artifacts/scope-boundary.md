# Scope Boundary: Post Management API — Implementation Plan

## Work Item

The design document `docs/changes/post-management-api/api-design.md` (committed at c71fd58 on branch
`post-management-api`, draft PR #38). The operator invoked `/han-planning:plan-a-change` with the argument "to
implement docs/changes/post-management-api/api-design.md". No ticket or issue exists beyond the design document and the
goal it quotes.

## Stated Scope

From `api-design.md`, "What the Build Delivers, and What Integration Does Later" → "The `tdd` build delivers:":

> - `src/posts/` with `posts.ts`, `post-error.ts`, and `file/file-post-store.ts`.
> - `components/describe-post-store.ts`, and `file/file-post-store.test.ts`, which runs it for the file store and adds
>   the file-only tests: fallback titles, nested and hidden folders, the case-variant id on a case-insensitive disk,
>   links, a folder name holding `\` skipped by `list` and `not-found` when addressed, ` 2` naming, the 200-byte cut,
>   the cleanup rule, NUL bodies round-tripping, tombstones (a deleted name is skipped by create; a folder another writer
>   makes at a tombstoned key is neither listed nor addressable), one underlying `fileSystem.watch` however many
>   subscriptions and none after the last unsubscribe, a `fileSystem.watch` that throws leaving no subscription, and a
>   signal for an outside write.
> - `src/posts/boundary.test.ts` and `src/posts/bun-free.test.ts`.
> - `BUN_ONLY` and `bunHits` moved from `src/engine/bun-free.test.ts` into the test-only helper
>   `src/engine/components/bun-only-code.ts`, named in the engine scan's exemptions; both scans import it.
> - `src/posts` added to the Makefile's `test-server` target.
> - README: eight packages; a `src/posts/` entry (what it holds, its two entries, its importers, the contract suite, the
>   boundary and Bun-free tests); the rule that the engine imports `posts/posts.ts` with `import type` only and may
>   import `posts/post-error.ts` as a value.

The goal the design serves (verbatim, from the design's frontmatter):

> as an abstraction for "post management". this abstraction will sit in between the engine and the implementation of
> actually creating, editing, managing, listing, and otherwise handling posts as a first class concept in the system.
> the first implementation of this abstraction will be the direct file system reads and writes that we currently use.
> however, this abstraction will soon be replaced with a database backed implementation. don't worry about how this
> will break current features. we'll work on integrating this new api, and handling breaking changes to do so, later.

## Stated Exclusions

From `api-design.md`, "Integration does later (G7):":

> - cli builds the file store and passes `posts` to `startEngine`; `EngineOptions.posts`.
> - `startEngine` swaps `fileSystem.watch` for `posts.watch` and keeps the unsubscribe; the event name (D26).
> - `Engine['documents']`, the routes, wire types (F33), the chat tools (F22–F24), view state and session references
>   (F25–F27), the system prompt (F35), the skills, the UI tree, and `fake-documents-api.ts` (F34) move onto ids.
> - Whether the UI seeds an H1 on new posts (D9), knowing the title and an H1 can then disagree (V10).
> - Migrating to a database, and remapping stored references (D5).

Also from the design: "A database store will be a second feature folder beside `file/`. It is not part of this change
(G5, D3)." and every entry in the design's `## Cut List`.

## Operator-Stated Scope

"to implement docs/changes/post-management-api/api-design.md"

## Direction of Travel

Recorded in the goal itself: the file-backed store "will soon be replaced with a database backed implementation", and
today's `Engine['documents']` path is to be moved onto the new store at a later integration change. The operator
confirmed this in the Step 1.5 confirmation turn ("looks good").

## Visual Material Received

None received

## Record Provenance

Established by `han-planning:plan-a-change` on 2026-10-16. No earlier `scope-boundary.md` existed in this folder; the
design run (`han-coding:design-an-api`) wrote none. The operator confirmed the boundary, the area (new files under
`src/posts/`, plus `src/engine/bun-free.test.ts`, a new helper beside it, `Makefile`, and `README.md`), the output
folder, and the branch workflow in one turn: "looks good".

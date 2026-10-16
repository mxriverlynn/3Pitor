# Scope Boundary: Post Store Integration

## Work Item

No ticket exists. This work comes from two sources:

- The user's request in this session: "once you're done compacting, run plan-a-change for the full integration of this
  work".
- The integration list in the design this work follows:
  [`docs/changes/post-management-api/api-design.md`](../../post-management-api/api-design.md), section "What the Build
  Delivers, and What Integration Does Later", subsection "Integration does later (G7)". The same file also holds
  "Behavior Changes Integration Will Absorb" (BC1–BC14).

The store itself was built and pushed under
[`docs/changes/post-management-api/change-plan.md`](../../post-management-api/change-plan.md), on draft PR #38.

## Stated Scope

From `api-design.md`, "Integration does later (G7)", quoted:

> - cli builds the file store and passes `posts` to `startEngine`; `EngineOptions.posts`.
> - `startEngine` swaps `fileSystem.watch` for `posts.watch` and keeps the unsubscribe; the event name (D26).
> - `Engine['documents']`, the routes, wire types (F33), the chat tools (F22–F24), view state and session references
>   (F25–F27), the system prompt (F35), the skills, the UI tree, and `fake-documents-api.ts` (F34) move onto ids.
> - Whether the UI seeds an H1 on new posts (D9), knowing the title and an H1 can then disagree (V10).
> - Migrating to a database, and remapping stored references (D5).

From `api-design.md`, "Open Risks", quoted:

> Integration must drop or check such references.

> `han-core:adversarial-security-analyst` would have reviewed the ids that arrive from the browser and the AI. A re-run
> at a larger size, or a security review at integration, would cover the second.

## Stated Exclusions

From `api-design.md`, quoted: "Migrating to a database, and remapping stored references (D5)." That is integration's
list, but the design places it later and separate ("the database-backed store and the migration of stored references").

The operator excluded it again in the confirmation turn, by accepting this restatement: "Left out: a database-backed
store, and migrating saved references to it."

## Operator-Stated Scope

The user answered "looks good. do it" to a confirmation turn that put forward these points.

Area: the cli startup in `src/cli/`. The engine (its documents API, chat tools, saved sessions, remembered open post,
and the AI's system prompt). The server routes, and the shared types they send to the browser. The UI sidebar and
editor in `src/ui/documents/`, plus the chat and app shell where they refer to posts. The fake documents API used in UI
tests. The two skill files that describe post layout to the AI. `README.md`.

The confirmed outcome: the app reads and saves posts only through the new store, and a post is named by its folder (`the
sun`), not by its draft path (`the sun/draft.md`). The title is kept separately from the text. The sidebar, the AI's
tools, saved chat sessions, the remembered open post, and the AI's instructions all use the new names. The plan includes
a security review of post names arriving from the browser and from the AI.

Workflow: a new branch, `post-store-integration`, off `post-management-api`, with a draft PR into it. Commit and push
as the run goes, then run `/tdd` on the plan. Standing preference: decide escalations without asking, and report
behavior changes in the final summary.

## Direction of Travel

The answer given, accepting the recommendation in the confirmation turn: the old documents API goes away entirely, and
the sidebar becomes a flat list of posts. That API is `Engine['documents']`, `DocumentError`, path-based post addressing,
and the folder and file tree. Loose `.md` files, side files such as `outline.md`, and empty folders stop appearing in
the app. They stay on disk. No read-only file view is kept beside the post list.

## Visual Material Received

None received

## Record Provenance

Established by `han-planning:plan-a-change` in this run, on 2026-10-16. Not inherited. The design's own boundary record,
`docs/changes/post-management-api/artifacts/scope-boundary.md`, was the boundary for the store build. It is not scope
evidence for this run, apart from the design sections quoted above, which the operator named as the source.

Updated during the run: the user merged PR #38 ("btw, i've merged PR #38"). The `post-store-integration` branch was
rebased onto `main`, and its draft PR, #39, now targets `main`. The boundary itself is unchanged.

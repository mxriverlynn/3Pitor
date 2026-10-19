# Change Plan: Post Title and Heading Sync

## Why This Change

A new requirement from the user: a post's title and the `#` title row at the top of its markdown must always agree.
Renaming a post from a menu should rewrite that row, and editing that row should rename the post. Today the two are
deliberately independent, so they drift apart. The reason class is **a constraint arriving**, in the user's own words:

> i want the post title to always be in sync with the title row (the '#' section in the markdown). when i rename a post
> via the menus, update the post title in the markdown document, and vice-versa

The accepted area is recorded in [artifacts/scope-boundary.md](artifacts/scope-boundary.md).

## What Changes, In One Paragraph

After this change, the server keeps each post's title and its first level-1 heading in step. A rename rewrites that
heading, or adds one at the top. A Save makes the title follow the heading. A new post, made by the writer or by
Claude, starts with `# <title>`. One small shared module reads and rewrites the title row, so the browser, the server,
and the engine all compute the same text. The post store itself is unchanged: it still treats title and body as
separate fields ([D-2](artifacts/change-decision-log.md#d-2-the-server-routes-keep-title-and-heading-in-step-the-store-is-untouched)).
The browser's one new job is to carry a rename into a post that is open in the editor, so that a later Save cannot
write the old heading back.

## Current State

A post's title and body are two files, written by two separate store calls, and no call writes both
([C-1](artifacts/current-state-findings.md#c-1-title-and-body-are-separate-files-written-by-separate-store-calls)). The
store's contract says, by an earlier design decision, that the title and any `#` heading are independent and can
disagree ([C-2](artifacts/current-state-findings.md#c-2-the-stores-contract-says-title-and-heading-are-independent-by-a-prior-decision)).
The server's post routes are a thin pass-through, one store call each
([C-11](artifacts/current-state-findings.md#c-11-the-servers-post-routes-are-a-thin-pass-through)).

On the browser side, `useDocuments().rename` changes the title and never touches an open editor
([C-7](artifacts/current-state-findings.md#c-7-the-uis-rename-changes-the-title-and-never-touches-the-open-editor)).
`save` writes only the body
([C-12](artifacts/current-state-findings.md#c-12-save-writes-only-the-body-and-the-title-reaches-the-screen-only-through-a-list-refresh)).
When the body changes on disk under an open post, the editor either reloads it or, if the writer has unsaved changes,
shows the "changed on disk" notice. In that case Save writes the writer's version over the disk
([C-8](artifacts/current-state-findings.md#c-8-a-body-change-under-an-open-post-either-reloads-it-or-raises-the-changed-on-disk-notice)).
The Rename dialog's hint even says the heading stays as it is
([C-9](artifacts/current-state-findings.md#c-9-the-rename-dialogs-hint-promises-the-opposite-of-the-change)).

Every new post starts empty. The route and Claude's `NewPost` tool each pass `body: ''`, and `NewPost` then puts the
model's text into the editor as an unsaved edit
([C-10](artifacts/current-state-findings.md#c-10-every-new-post-starts-with-an-empty-body-from-two-separate-call-sites)).

No code reads or rewrites a heading in a markdown string. The only heading finders are private to the editor
([C-5](artifacts/current-state-findings.md#c-5-the-only-heading-finders-are-private-to-the-editor)). The one
CommonMark parser and serializer the whole app shares live in `src/shared/markdown.ts`, which every package may import
([C-3](artifacts/current-state-findings.md#c-3-only-srcshared-is-importable-by-every-writer-of-a-post),
[C-4](artifacts/current-state-findings.md#c-4-srcsharedmarkdownts-holds-the-one-commonmark-parser-and-serializer-with-no-heading-api)).

The structural property this change addresses: nothing owns the rule "title equals title row", and the four places
that write a post's title or body each act alone.

## Target State

**The title row.** The title row is the first top-level level-1 heading in a post's body: an ATX `# ...` line or a
setext heading underlined with `===`. A heading inside a quote, a list, or a code fence does not count, and neither
does a `##` heading. If the first level-1 heading is blank, the post has no title row to read, but a rename rewrites
that blank heading rather than adding a second one.

**`src/shared/title-row.ts` (new).** This module owns reading and rewriting the title row, and tidying a title. It
imports only `./markdown`. It is answerable for nothing else: it knows nothing about posts, the store, or HTTP. Its
contract is pinned in [D-1](artifacts/change-decision-log.md#d-1-the-title-row-helpers-live-in-a-new-srcsharedtitle-rowts):

```ts
export function titleText(title: string): string;                        // whitespace runs -> one space, trimmed
export function headingTitle(markdown: string): string | null;           // the title row's plain text, or null
export function withHeadingTitle(markdown: string, title: string): string; // the title row set to `title`
```

The invariant both sides of the wire rely on: `headingTitle(withHeadingTitle(m, t)) === titleText(t)` whenever
`titleText(t) !== ''`, and `withHeadingTitle` is deterministic. `withHeadingTitle` changes only the title row's own
source lines, or adds `# <title>` and a blank line at the top, so the rest of the body stays byte for byte. The worked
examples in D-1 are the test table.

**`markdownSerializer` (re-scoped).** The shared serializer escapes a heading's trailing ` #` run, so `C #` survives a
Save as `# C \#` rather than shrinking to `C`
([D-4](artifacts/change-decision-log.md#d-4-the-shared-serializer-escapes-a-heading-that-ends-in)).

**The post routes own the sync.** Each route calls the store in a fixed order:

```ts
// POST /api/posts  { title }  ->  { id }
const t = titleText(title);
id = await posts.create({ title: t, body: withHeadingTitle('', t) });  // blank t: the store's 400

// PUT /api/posts/:id/title  { title }  ->  { ok: true }
const t = titleText(title);
if (t === '') throw new PostError('invalid', 'post');                 // 400, no store call
const { body } = await posts.get(id);                                  // 404, no write
const next = withHeadingTitle(body, t);
if (next !== body) await posts.setBody(id, next);
await posts.setTitle(id, t);

// PUT /api/posts/:id/body  { body }  ->  { ok: true }
await posts.setBody(id, body);
const heading = headingTitle(body);
if (heading !== null) {
  const { title } = await posts.get(id);
  if (title !== heading) await posts.setTitle(id, heading);
}
```

The rename order (body, then title) is pinned in
[D-7](artifacts/change-decision-log.md#d-7-rename-checks-the-title-writes-the-body-then-writes-the-title). The Save
rule (the title follows only a heading that exists and is not blank) is pinned in
[D-3](artifacts/change-decision-log.md#d-3-a-saved-headings-plain-text-becomes-the-title-only-when-the-heading-exists-and-is-not-blank).
Titles are tidied with `titleText` wherever they are written
([D-8](artifacts/change-decision-log.md#d-8-titles-are-tidied-on-create-and-rename)). Request and response shapes do
not change. A Save's new title reaches the post table and post panel through the existing `posts-changed` signal
([D-12](artifacts/change-decision-log.md#d-12-save-does-not-refresh-the-list-itself)).

**`NewPost` follows the same rule.** It stores `{ title: t, body: withHeadingTitle('', t) }` and puts
`withHeadingTitle(content, t)` in the editor as its unsaved edit, so the tool's title wins over any heading the model
wrote ([D-5](artifacts/change-decision-log.md#d-5-a-post-claude-makes-starts-with-its-title-as-its-heading-and-the-tools-title-wins)).

**The browser carries a rename into an open post.** `useDocuments().rename` waits for the post's running save, sends
the rename, then sets the open editor's title row with the same `withHeadingTitle` the server ran. It also updates
`entry.saved` the same way, so the next sync finds the disk equal to `entry.saved` and shows no notice. `Entry` gains a
`renaming` promise that `save` waits for and `syncFile` treats like `saving`. The full sequence is pinned in
[D-6](artifacts/change-decision-log.md#d-6-an-open-post-follows-a-rename-in-the-editor-and-rename-and-save-wait-for-each-other).

**Not answerable.** The post store does not read or write headings. Research documents and outlines keep their titles
separate from their text. Edits made to a post's file by another program bring the title along only when the writer
next saves the post in the app.

## Surface Delta

### S-1: `markdownSerializer` heading output in `src/shared/markdown.ts` — Re-scoped

**Target state.** `markdownSerializer` writes a heading as `#` repeated to its level, a space, and its inline content.
When that content ends in one or more `#` after a space or tab, the run is escaped as `\#...`. Every other heading
serializes as it does today. A heading holding `ends with #` is written `# ends with \#` and parses back to
`ends with #`.

**Behavior.** Changing, narrowly. Saving a document with a heading whose text ends in ` #` writes the escape. Those
headings parsed back wrong before, so no output that read back correctly changes. Decided under
[D-16](artifacts/change-decision-log.md#trivial-decisions).

**Why.** Without it, a title ending in ` #` shortens on the first Save.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-shared-serializer-escapes-a-heading-that-ends-in)

### S-2: `src/shared/title-row.ts` — Added

**Target state.** `src/shared/title-row.ts` exists, imports only `./markdown`, and exports `titleText`,
`headingTitle`, and `withHeadingTitle` with the signatures, rules, and worked examples in D-1. It owns finding the title
row (the first top-level level-1 heading), reading its plain text, rewriting it, and tidying a title. It is Bun-free,
so the engine can load it on Node.

**Behavior.** Preserving. Nothing calls it until S-3.

**Why.** It is the one place every writer of a post can import
([C-3](artifacts/current-state-findings.md#c-3-only-srcshared-is-importable-by-every-writer-of-a-post)).

**Depends on.** S-1, for the `C #` and `#` examples.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-title-row-helpers-live-in-a-new-srcsharedtitle-rowts)

### S-3: `POST /api/posts` — Re-scoped

**Target state.** `POST /api/posts` with `{ title }` creates a post with title `titleText(title)` and body
`withHeadingTitle('', titleText(title))`, so `{ title: "The Sun" }` stores body `"# The Sun"`. It answers `{ id }`. A
blank title is still a 400 from the store, and nothing is made.

**Behavior.** Changing. A post made from the New post dialog opens holding `# <title>` rather than empty, and its title
is stored tidied. Decided under D-16.

**Why.** The accepted scope says a new post starts with its title row.

**Depends on.** S-2.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-server-routes-keep-title-and-heading-in-step-the-store-is-untouched),
[D-8](artifacts/change-decision-log.md#d-8-titles-are-tidied-on-create-and-rename)

### S-4: `PUT /api/posts/:id/title` — Re-scoped

**Target state.** `PUT /api/posts/:id/title` with `{ title }` sets the post's title to `titleText(title)` and its title
row to the same text, in the order pinned in D-7: a blank tidied title is a 400 with no store call; `get` answers 404
for a missing post before any write; the body is written when the title row changes; then the title. It answers
`{ ok: true }`. A post with no level-1 heading gains `# <title>` and a blank line at the top.

**Behavior.** Changing. Renaming from a menu now rewrites the post's heading on disk, replacing any formatting in it
with plain text ([D-10](artifacts/change-decision-log.md#d-10-a-rename-replaces-the-headings-formatting-with-plain-text)).
Decided under D-16.

**Why.** The first half of the user's request.

**Depends on.** S-2.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-rename-checks-the-title-writes-the-body-then-writes-the-title)

### S-5: `useDocuments().rename`, `save`, `syncFile`, and `Entry` in `src/ui/documents/documents/documents.tsx` — Re-scoped

**Target state.** `rename(id, title)` gives a post a new title and, when the post is open, sets its title row in the
editor to match, keeping any other unsaved changes. It waits for a save of that post already running, sends
`PUT /api/posts/:id/title`, then, if the same entry is still open, applies `withHeadingTitle` to the editor's text
(unsaved) or follows `withHeadingTitle(entry.saved, title)` (saved), sets `entry.saved` to
`withHeadingTitle(entry.saved, title)`, bumps `entry.saves`, ends any Undo all offer covering the post, and refreshes
the list. `Entry` has a `renaming?: Promise<void>` that is set while a rename runs. `save` waits for it before it
captures the text. `syncFile` drops a read taken while it is set. The full sequence is in D-6.

**Behavior.** Changing. An open post shows its new heading as soon as the rename lands, and its editor's undo history
is cleared ([D-13](artifacts/change-decision-log.md#d-13-a-rename-of-an-open-post-clears-its-editors-undo-history)).
Decided under D-16.

**Why.** Without it, a post with unsaved changes would write its old heading back on Save, and S-7 would then rename
the post back
([C-8](artifacts/current-state-findings.md#c-8-a-body-change-under-an-open-post-either-reloads-it-or-raises-the-changed-on-disk-notice),
[C-16](artifacts/current-state-findings.md#c-16-a-rename-and-a-save-of-the-same-post-are-not-coordinated-in-the-browser)).

**Depends on.** S-2, S-4.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-an-open-post-follows-a-rename-in-the-editor-and-rename-and-save-wait-for-each-other)

### S-6: Rename dialog hint in `src/ui/documents/components/post-dialogs/post-dialogs.tsx` — Re-scoped

**Target state.** The Rename dialog's hint reads "The post’s first # heading changes to match. A post without one gets
one at the top." It is shown from both the post table's row menu and the open post's menu, as today.

**Behavior.** Changing. The writer reads the new promise in place of the old one. Decided under D-16.

**Why.** The old hint says the opposite
([C-9](artifacts/current-state-findings.md#c-9-the-rename-dialogs-hint-promises-the-opposite-of-the-change)).

**Depends on.** S-4.

**Decision.** [D-14](artifacts/change-decision-log.md#trivial-decisions)

### S-7: `PUT /api/posts/:id/body` — Re-scoped

**Target state.** `PUT /api/posts/:id/body` with `{ body }` writes the body, then, when `headingTitle(body)` is not
`null` and differs from the stored title, sets the title to it. It answers `{ ok: true }`. A body with no level-1
heading, or a blank first one, leaves the title as it is. Research documents and outlines save through their own
routes and are unaffected.

**Behavior.** Changing. Saving a post whose title row reads differently from its title renames the post, which the post
table and post panel show once the `posts-changed` sync lands. That includes the first Save of an older post whose
title and heading already disagreed
([D-9](artifacts/change-decision-log.md#d-9-existing-posts-are-not-migrated)). Decided under D-16.

**Why.** The second half of the user's request ("and vice-versa").

**Depends on.** S-2, S-5. If this landed before S-5, a dirty open post renamed and then saved would write its stale
heading and rename itself back.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-a-saved-headings-plain-text-becomes-the-title-only-when-the-heading-exists-and-is-not-blank),
[D-12](artifacts/change-decision-log.md#d-12-save-does-not-refresh-the-list-itself)

### S-8: `NewPost` tool in `src/engine/chat/tools/tools.ts` — Re-scoped

**Target state.** `NewPost` with `{ title, content }` creates a post with title `titleText(title)` and body
`withHeadingTitle('', titleText(title))`, then puts `withHeadingTitle(content, titleText(title))` in the editor as an
unsaved edit, highlighting only the blocks the stored body does not already hold. Its description says the post is
made holding only its title as a `#` heading, and that the text, with its first `#` heading set to the title, appears in
the editor unsaved. A refusal (a blank title) is still returned to the model as the tool's answer.

**Behavior.** Changing. A post Claude makes holds `# <title>` in the store, Claude's own first heading is replaced by
the title, and Undo all leaves the post holding its heading rather than empty
([D-11](artifacts/change-decision-log.md#d-11-undo-all-leaves-a-post-claude-made-holding-its-heading)). Decided under
D-16.

**Why.** The accepted scope says a post Claude makes starts with `# <title>`.

**Depends on.** S-2.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-a-post-claude-makes-starts-with-its-title-as-its-heading-and-the-tools-title-wins)

### S-9: Contract and documentation text — Re-scoped

**Target state.** The comment on `Post.body` in `src/posts/posts.ts` still says the store never reads or writes a
heading, and adds that the server keeps a post's title and first `#` heading in step. The `CreatePostBody` comment in
`src/shared/wire.ts` says the new post is made holding `# <title>`. `README.md` no longer calls a new post empty (lines
6, 267, 451), and its server section says the title and body routes keep the title row in step.

**Behavior.** Preserving. Comments and documentation only.

**Why.** Each of these states the old rule
([C-2](artifacts/current-state-findings.md#c-2-the-stores-contract-says-title-and-heading-are-independent-by-a-prior-decision),
[C-10](artifacts/current-state-findings.md#c-10-every-new-post-starts-with-an-empty-body-from-two-separate-call-sites)).

**Depends on.** S-3, S-4, S-7, S-8.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-server-routes-keep-title-and-heading-in-step-the-store-is-untouched)

## Behavior Changes

Every behavior change below was decided by this run under the user's standing preference to settle planning
decisions without asking, and is reported to the user in the run summary
([D-16](artifacts/change-decision-log.md#trivial-decisions)).

- **A new post starts with its title as a heading** (S-3, S-8). The writer, or Claude, makes "The Sun", and it opens
  holding `# The Sun` rather than an empty page.
- **Renaming rewrites the heading** (S-4, S-5). Renaming "Moon" to "Night" from either menu turns `# Moon` into
  `# Night`. A post with no `#` heading gets `# Night` at the top. Formatting in the old heading is dropped. If the post
  is open, the editor shows the new heading at once, keeps the writer's other unsaved changes, and can no longer undo
  past the rename.
- **Saving renames the post to match its heading** (S-7). Change `# Night` to `# Morning`, Save, and the post table and
  post panel show "Morning". A post with no `#` heading, or a blank one, keeps its title. An older post whose heading
  already differed from its title is renamed the first time it is saved.
- **Titles are tidied** (S-3, S-4, S-8). A title typed with extra spaces at the ends or in the middle is stored with
  them collapsed.
- **Undo all leaves a post Claude made holding its heading** (S-8), rather than empty.
- **The Rename dialog's hint changes** (S-6) to say the heading changes to match.
- **A heading ending in ` #` saves with an escape** (S-1), so it reads back the way it was typed.

## Change Units

### Unit 1: Escape a heading's trailing `#`

**What it does.** Teaches the shared serializer to escape a trailing ` #` run in a heading, so such headings survive
a Save.

**Delta entries.** S-1.

**How you know it worked.** New tests in `src/shared/markdown.test.ts` show `# ends with \#` for levels 1 and 2 and a
round trip back to `ends with #`. Existing heading and editor tests still pass.

### Unit 2: Add the title-row helpers

**What it does.** Adds `src/shared/title-row.ts` and its tests. Nothing calls it yet.

**Delta entries.** S-2.

**Ordering constraint.** After Unit 1, because two of D-1's examples depend on the escape.

**How you know it worked.** `src/shared/title-row.test.ts` covers every row of D-1's table and checks the round-trip
invariant over the samples `* _ \` [ ] ~`, `1.`, `- `, `+ `, `<b>`, `|`, `C#`, `C #`, `#`. `make test` passes,
including the engine's Bun-free scan.

### Unit 3: Create and rename keep the heading in step

**What it does.** `POST /api/posts` starts a post with `# <title>`, and `PUT /api/posts/:id/title` rewrites the title
row. The Rename dialog's hint changes to match.

**Delta entries.** S-3, S-4, S-6.

**Ordering constraint.** After Unit 2.

**How you know it worked.** `src/server/posts/posts.routes.test.ts` shows: a created post's body is `# <title>`; a
rename of `"# Old\n\nBody"` to `"  New  "` leaves body `"# New\n\nBody"` and title `"New"`; a rename of a post with no
heading prepends one; a blank rename is a 400 and changes nothing; a rename of a missing post is a 404 and changes
nothing. Any route or UI test that expects an empty body on create is updated.

### Unit 4: An open post follows a rename

**What it does.** The browser carries a rename into the open editor and orders rename against save.

**Delta entries.** S-5.

**Ordering constraint.** After Unit 3, so the server and the browser compute the same body. It must land before Unit
5.

**How you know it worked.** `src/ui/documents/documents/documents.test.tsx` shows: renaming an open, saved post shows
the new heading and leaves it saved; renaming an open post with unsaved changes shows the new heading, keeps the other
changes unsaved, and raises no "changed on disk" notice when the sync runs; a Save already running when the rename
starts lands first, and a Save pressed during the rename waits and captures the new heading. The fake posts API in
`src/ui/components/fake-posts-api.ts` rewrites the body on rename the way the route does, so the sync finds them
equal.

### Unit 5: Saving makes the title follow the heading

**What it does.** `PUT /api/posts/:id/body` renames the post to its title row's text.

**Delta entries.** S-7.

**Ordering constraint.** After Unit 4. Landed earlier, a renamed post with unsaved changes would rename itself back on
Save.

**How you know it worked.** Route tests show: saving `"# The Moon\n\nIt sets."` over title "The Sun" makes the title
"The Moon"; saving `"Intro"` or `"#\n\nx"` leaves the title alone; saving a body whose heading matches the title makes
no title write. A UI test shows the post table showing the new title after a Save once the `posts-changed` sync runs.

### Unit 6: Claude's new posts start with their heading

**What it does.** `NewPost` stores `# <title>` and sets the title row in the text it puts into the editor.

**Delta entries.** S-8.

**Ordering constraint.** After Unit 2.

**How you know it worked.** `src/engine/chat/tools/tools.test.ts` shows: title "Spring Beds" with content
`"# Garden\n\nSow."` stores `"# Spring Beds"` and marks `"# Spring Beds\n\nSow."` as the edit; content `"Sow."` gives the
same edit; the title row is not highlighted as a change. `make check-node` passes.

### Unit 7: Update the contract comments and README

**What it does.** Brings `src/posts/posts.ts`, `src/shared/wire.ts`, and `README.md` in line with the new rule.

**Delta entries.** S-9.

**Ordering constraint.** After Units 3, 5, and 6.

**How you know it worked.** No comment or README line still says a new post is empty, or that a rename leaves the
heading alone. `make test` passes.

## Risks

- **A rename and a Save collide on an open post.** If the browser's ordering in Unit 4 is wrong, a Save can write the
  old heading after a rename, and Unit 5 renames the post back. Unit 4's tests cover both orders. The blast radius is
  one post's title.
- **The browser and server compute different bodies.** If `withHeadingTitle` is not deterministic, or the fake API
  in the UI tests differs from the route, the writer sees a "changed on disk" notice after renaming an open post.
  Unit 2's invariant test and Unit 4's no-notice test detect it.
- **First Save of an older post renames it** ([D-9](artifacts/change-decision-log.md#d-9-existing-posts-are-not-migrated)).
  A post whose title came from its folder name, or whose heading was edited apart from its title, takes the heading's
  text on first Save. This is intended, but it may surprise.
- **A half-applied rename.** A storage failure between the body write and the title write leaves the heading new and
  the title old. The writer sees the rename fail in the dialog and can retry it
  ([D-7](artifacts/change-decision-log.md#d-7-rename-checks-the-title-writes-the-body-then-writes-the-title)).
- **A Rename dialog left open when Claude starts working** can still be submitted
  ([C-15](artifacts/current-state-findings.md#c-15-rename-is-blocked-while-claude-works-but-only-in-the-menus)). The
  rename now rewrites the body, which Claude's turn may be editing. The edits merge into the editor under the post's
  id, which does not change, so the result is the same as the writer editing the heading by hand mid-turn.

## Deferred (YAGNI)

- **An atomic title-and-body store write.** It would add a `PostStore` method with one implementation. The store's
  per-post order and the browser waiting for its own save cover the only concurrent writer today. Reopen when a second
  tab or process writes post bodies at once, or a test shows a lost write between the route's `get` and `setBody`.
- **One heading finder shared by the Outline box and the title row.** The Outline works today, and the two answer
  different questions. Reopen when the Outline's heading reading and `headingTitle` disagree in a bug report.

## Cut for Scope

- **Research documents keep separate titles.** Syncing them would have made a research document's name follow its
  first `#` heading the same way. The accepted scope says "Posts only. Research documents keep their separate titles."
  ([artifacts/scope-boundary.md](artifacts/scope-boundary.md#operator-stated-scope),
  [D-15](artifacts/change-decision-log.md#trivial-decisions)).

## Open Items

- **Edits from another program** (non-blocking). When another program changes a post's `#` heading on disk, the title
  follows only when the writer next saves the post in the app. Settled by the user asking for a watch-driven sync, which
  this plan does not include.

## Review Findings

To be filled after the review round.

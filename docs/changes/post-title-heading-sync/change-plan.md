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
([C-5](artifacts/current-state-findings.md#c-5-the-only-heading-finders-are-private-to-the-editor)). The app has one
CommonMark parser and serializer, shared by the whole app. They live in `src/shared/markdown.ts`, which every package may import
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
imports only `./markdown`. It does nothing else: it knows nothing about posts, the store, or HTTP. Its
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
([D-4](artifacts/change-decision-log.md#d-4-the-shared-serializer-escapes-a-heading-that-ends-in-a-hash)).

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

**The Rename dialog waits while Claude works.** It cannot be submitted during that time, as the menus already cannot
([D-17](artifacts/change-decision-log.md#d-17-the-rename-dialog-waits-while-claude-works)).

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

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-the-shared-serializer-escapes-a-heading-that-ends-in-a-hash)

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

**Target state.** `rename(id, title)` gives a post a new title. When the post is open, it also sets the post's title
row in the editor to match and keeps any other unsaved changes. The pinned sequence is in D-6. In order, `rename`:
1. Sets the entry's `renaming` promise synchronously.
2. Waits for a save of the post already running.
3. Sends `PUT /api/posts/:id/title`. If that fails, it runs the existing sync and rejects.
4. If the request succeeds and the same entry is still open, reads `entry.dirty` at that point:
   - With unsaved changes, it applies `withHeadingTitle` to the editor's text.
   - With none, it follows `withHeadingTitle(entry.saved, title)`.
5. Either way, sets `entry.saved` to `withHeadingTitle(entry.saved, title)`, bumps `entry.saves`, ends any Undo all
   offer covering the post, and clears `renaming` by identity.
6. Refreshes the list.

`save` waits for `renaming` before it captures the text. `syncFile` drops a read taken while `renaming` is set.

**Behavior.** Changing. An open post shows its new heading as soon as the rename lands. Unsaved typing inside the
heading line is replaced by the new title. The editor's undo history is cleared
([D-13](artifacts/change-decision-log.md#d-13-a-rename-of-an-open-post-clears-its-editors-undo-history)), and the
Undo all offer for the post ends. Decided under [D-16](artifacts/change-decision-log.md#trivial-decisions).

**Why.** Without it, a post with unsaved changes would write its old heading back on Save, and S-8 would then rename
the post back
([C-8](artifacts/current-state-findings.md#c-8-a-body-change-under-an-open-post-either-reloads-it-or-raises-the-changed-on-disk-notice),
[C-16](artifacts/current-state-findings.md#c-16-a-rename-and-a-save-of-the-same-post-are-not-coordinated-in-the-browser)).

**Depends on.** S-2, S-4. It ships in the same unit as S-4.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-an-open-post-follows-a-rename-in-the-editor-and-rename-and-save-wait-for-each-other)

### S-6: Rename dialog hint in `src/ui/documents/components/post-dialogs/post-dialogs.tsx` — Re-scoped

**Target state.** The Rename dialog's hint reads "The post’s first # heading changes to match. A post without one gets
one at the top." It shows from both the post table's row menu and the open post's menu, as it does today.

**Behavior.** Changing. The writer reads the new promise in place of the old one. Decided under D-16.

**Why.** The old hint says the opposite
([C-9](artifacts/current-state-findings.md#c-9-the-rename-dialogs-hint-promises-the-opposite-of-the-change)).

**Depends on.** S-4. It ships in the same unit.

**Decision.** [D-14](artifacts/change-decision-log.md#trivial-decisions)

### S-7: `usePostDialogs` in `src/ui/documents/components/post-dialogs/post-dialogs.tsx` — Re-scoped

**Target state.** `usePostDialogs(docs, open, options?: { onClose?: () => void; busy?: boolean })` takes its optional
third argument as an options object. While `busy` is true, the Rename dialog's submit button is disabled, and its hint
reads "Renaming waits until Claude finishes." The post table and the post panel pass the `busy` they already hold, and
the post table passes its `onClose` inside the object. The New post and Delete dialogs are unchanged.

**Behavior.** Changing. A Rename dialog left open when Claude starts working cannot be submitted until the turn ends.
Decided under D-16.

**Why.** Now that a rename rewrites the post's text, a mid-turn rename can drop an edit Claude merged during it, give a
false "saved while Claude was working" message, or tangle with Claude's own change to the heading
([C-15](artifacts/current-state-findings.md#c-15-rename-is-blocked-while-claude-works-but-only-in-the-menus)).

**Depends on.** Nothing. It ships with S-4, which creates the need.

**Migration.** `usePostDialogs(docs, open, onClose)` becomes `usePostDialogs(docs, open, { onClose, busy })`.

**Decision.** [D-17](artifacts/change-decision-log.md#d-17-the-rename-dialog-waits-while-claude-works)

### S-8: `PUT /api/posts/:id/body` — Re-scoped

**Target state.** `PUT /api/posts/:id/body` with `{ body }` writes the body. Then, when `headingTitle(body)` is not
`null` and differs from the stored title, it sets the title to that text. It answers `{ ok: true }`. A body with no
level-1 heading, or with a blank first one, leaves the title as it is. Research documents and outlines save through
their own routes and are unaffected.

**Behavior.** Changing. Saving a post whose title row reads differently from its title renames the post. The post
table and post panel show the new name once the `posts-changed` sync lands. This includes the first Save of an older
post whose title and heading already disagreed
([D-9](artifacts/change-decision-log.md#d-9-existing-posts-are-not-migrated)). Decided under D-16.

**Why.** The second half of the user's request ("and vice-versa").

**Depends on.** S-2, S-5. If this landed before S-5, a dirty open post renamed and then saved would write its stale
heading and rename itself back.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-a-saved-headings-plain-text-becomes-the-title-only-when-the-heading-exists-and-is-not-blank),
[D-12](artifacts/change-decision-log.md#d-12-save-does-not-refresh-the-list-itself),
[D-20](artifacts/change-decision-log.md#d-20-a-save-that-fails-between-its-two-writes-is-left-to-the-retry)

### S-9: `NewPost` tool in `src/engine/chat/tools/tools.ts` — Re-scoped

**Target state.** `NewPost` with `{ title, content }` creates a post with title `titleText(title)` and body
`withHeadingTitle('', titleText(title))`. It then puts `withHeadingTitle(content, titleText(title))` in the editor as
an unsaved edit, and highlights only the blocks the stored body does not already hold. Its description says the post
is made holding only its title as a `#` heading, and that the text, with its first `#` heading set to the title,
appears in the editor unsaved. A refusal (a blank title) is still returned to the model as the tool's answer.

**Behavior.** Changing. A post Claude makes holds `# <title>` in the store, and Claude's own first heading is replaced
by the title. Undo all leaves the post holding its heading rather than empty
([D-11](artifacts/change-decision-log.md#d-11-undo-all-leaves-a-post-claude-made-holding-its-heading)). Decided under
D-16.

**Why.** The accepted scope says a post Claude makes starts with `# <title>`.

**Depends on.** S-2.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-a-post-claude-makes-starts-with-its-title-as-its-heading-and-the-tools-title-wins)

### S-10: Undo all's confirmation in `src/ui/documents/documents/documents.tsx` — Re-scoped

**Target state.** `undoWarning`, for a turn that made posts, ends: "Posts Claude made stay in your posts, holding only
their title. Delete them from your posts if you don't want them." The comments on `LastTurn` and `undoWarning` say
that made posts keep their title heading, not that they stay empty.

**Behavior.** Changing. The writer reads the new sentence in the Undo all confirmation. Decided under D-16.

**Why.** After S-9, "empty" is false.

**Depends on.** S-9. It ships in the same unit.

**Decision.** [D-18](artifacts/change-decision-log.md#d-18-undo-alls-confirmation-says-claudes-posts-keep-their-heading)

### S-11: Contract and documentation text — Re-scoped

**Target state.** Each of these says the new rule and none says the old one:
- `src/posts/posts.ts`, the comment on `Post.body`: it still says the store never reads or writes a heading, and adds
  that the server keeps a post's title and first `#` heading in step.
- `src/shared/wire.ts`, the `CreatePostBody` comment: the new post is made holding `# <title>`.
- `README.md` line 6: Claude "can make a new post, holding only its title as a heading".
- `README.md` line 267: a post Claude just made holds only its title in the store, not "empty".
- `README.md` `### src/server/`: the post routes' title, body, and create handlers apply the title-row rule. This is
  the one exception to "a handler ... hands it to its slice of the engine".
- `README.md` `### src/shared/`: lists `title-row.ts`, and the line "None of these modules has imports, except
  `markdown.ts`" names `title-row.ts` too.
- `README.md` endpoints table:
  - `POST /api/posts` reads "Make a post holding `# <title>`".
  - `PUT /api/posts/:id/title` adds "and rewrites its first `#` heading to match".
  - `PUT /api/posts/:id/body` adds "a non-blank first `#` heading becomes the title".

**Behavior.** Preserving. These are comments and documentation only.

**Why.** Each of these states the old rule
([C-2](artifacts/current-state-findings.md#c-2-the-stores-contract-says-title-and-heading-are-independent-by-a-prior-decision),
[C-10](artifacts/current-state-findings.md#c-10-every-new-post-starts-with-an-empty-body-from-two-separate-call-sites)).

**Depends on.** S-3, S-4, S-8, S-9.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-server-routes-keep-title-and-heading-in-step-the-store-is-untouched)

## Behavior Changes

This run decided every behavior change below itself, under the user's standing preference to settle planning
decisions without asking. Each one is reported to the user in the run summary
([D-16](artifacts/change-decision-log.md#trivial-decisions)).

- **A new post starts with its title as a heading** (S-3, S-9). When the writer or Claude makes "The Sun", it opens
  holding `# The Sun` rather than an empty page. Claude's own first heading in its draft is replaced by the title.
- **Renaming rewrites the heading** (S-4, S-5). Renaming "Moon" to "Night" from either menu turns `# Moon` into
  `# Night`. A post with no `#` heading gets `# Night` at the top. Formatting in the old heading is dropped. If the post
  opens with a paragraph and has `# Part One` further down, that heading is the one rewritten.
- **Renaming an open post** (S-5). The editor shows the new heading at once. Unsaved typing in the heading line is
  replaced by the new title, and other unsaved changes stay. Undo can no longer step back past the rename, and an Undo
  all offer for that post ends.
- **Rename waits for Claude** (S-7). A Rename dialog left open when Claude starts working says "Renaming waits until
  Claude finishes." and cannot be submitted until the turn ends.
- **Saving renames the post to match its heading** (S-8). Change `# Night` to `# Morning`, Save, and the post table and
  post panel show "Morning". A post with no `#` heading, or a blank one, keeps its title, so deleting the heading is the
  one way the two can still differ. An older post whose heading already differed from its title is renamed the first
  time it is saved.
- **Titles are tidied** (S-3, S-4, S-9). A title typed with extra spaces, at the ends or in the middle, is stored with
  them collapsed.
- **Undo all leaves a post Claude made holding its heading** (S-9, S-10), and its confirmation says "Posts Claude made
  stay in your posts, holding only their title."
- **The Rename dialog's hint changes** (S-6) to say the heading changes to match.
- **A heading ending in ` #` saves with an escape** (S-1), so it reads back the way it was typed.

## Change Units

Each unit changes the matching branch of the UI tests' fake posts API in the same commit, using the real helpers
([D-19](artifacts/change-decision-log.md#d-19-the-ui-tests-fake-posts-api-mirrors-the-routes-outcomes-with-the-real-helpers)).

### Unit 1: Escape a heading's trailing `#`

**What it does.** Teaches the shared serializer to escape a trailing ` #` run in a heading, so that kind of heading
survives a Save.

**Delta entries.** S-1.

**How you know it worked.** New tests in `src/shared/markdown.test.ts` show:
- `# ends with \#` at levels 1 and 2, and a round trip back to `ends with #`;
- `**a** #` escaped;
- `C#` left as `# C#` with no escape.

Existing heading and editor tests still pass.

### Unit 2: Add the title-row helpers

**What it does.** Adds `src/shared/title-row.ts` and its tests. Nothing calls it yet.

**Delta entries.** S-2.

**Ordering constraint.** After Unit 1, because two of D-1's examples depend on the escape.

**How you know it worked.** One table-driven test in `src/shared/title-row.test.ts` asserts the literal output for
every row of D-1's table, plus a setext `\r\n` case (`Old\r\n===\r\n`). Property checks over the samples
`* _ \` [ ] ~`, `1.`, `- `, `+ `, `<b>`, `|`, `C#`, `C #`, `#`, and `C:\` cover:
- the round-trip invariant;
- idempotence;
- determinism.

`make test` passes, including the engine's Bun-free scan.

### Unit 3: The writer's new posts start with their heading

**What it does.** `POST /api/posts` starts a post with `# <title>` and stores the title tidied.

**Delta entries.** S-3.

**Ordering constraint.** After Unit 2.

**How you know it worked.** `src/server/posts/posts.routes.test.ts` "creates an empty post" (lines 47-51) becomes a
test that the body is `# The Sun`. A title with doubled spaces is stored collapsed. `documents.test.tsx` line 571
expects `# Garden` from `createPost('Garden')`. The fake's `POST` follows D-19.

### Unit 4: Claude's new posts start with their heading

**What it does.** `NewPost` stores `# <title>` and sets the title row in the text it puts into the editor. Undo all's
confirmation stops calling those posts empty.

**Delta entries.** S-9, S-10.

**Ordering constraint.** After Unit 2.

**How you know it worked.**
- `src/engine/chat/tools/tools.test.ts` lines 76-87: title "The Sun" stores `# The Sun`. Content
  `"# Garden\n\nIt rises.\n"` becomes the edit `"# The Sun\n\nIt rises.\n"`, and content with no heading gets one.
  `turn.highlights` holds the body passages only, checked with content that has a heading and with content that does
  not.
- `documents.test.tsx` lines 714-731 and 894-913 seed Claude's post as `# Garden`. They assert Undo all leaves
  `# Garden` and that the confirmation shows the new sentence. The comment at lines 541-554 no longer says `NewPost`
  makes the post empty.
- `make check-node` passes.

### Unit 5: Renaming rewrites the heading, and an open post follows

**What it does.** `PUT /api/posts/:id/title` rewrites the title row, and the browser carries the rename into an open
editor. The Rename dialog's hint changes, and the dialog waits while Claude works. These ship together so the app
never rewrites a heading on disk that the open editor would then write back.

**Delta entries.** S-4, S-5, S-6, S-7.

**Ordering constraint.** After Unit 2. Before Unit 6.

**How you know it worked.**
- Route tests in `posts.routes.test.ts`. Each asserts the final stored title and body:
  - A rename of `"# Old\n\nBody"` to `"  New  "` leaves `"# New\n\nBody"` and title `"New"`.
  - A post with no heading gets one prepended.
  - A blank rename is a 400, and both fields are unchanged.
  - A rename of a missing post is a 404, and nothing is changed.
  - With a store whose `setTitle` rejects, the rename is a 500, the body holds the new heading, the title is old, and
    a retried rename succeeds.
  - Lines 67-72 ("sets a post's title and its body separately") are rewritten around the new rule.
- Browser tests in `documents.test.tsx`. Lines 590-604 ("renaming a post changes only its title") become:
  - Renaming an open, saved post shows the new heading, and the post stays saved.
  - Renaming an open post with unsaved changes shows the new heading and keeps the other changes unsaved.
  - A sync whose read is held across the rename, started before it and landing during it, raises no "changed on disk"
    notice. One case starts the read before the rename and one starts it during, so each guard has its own failing
    test.
  - A Save already running when the rename starts lands first. A Save pressed during the rename waits and captures
    the new heading.
  - Closing the post while the rename is in flight throws nothing and does not reopen it.
  - Undo after a rename does not bring the old heading back.
  - A rename ends an Undo all offer for the post.
  - A failed rename runs the sync.
- `post-dialogs.test.tsx`:
  - The Rename hint shows the new sentence.
  - While `busy`, the submit button is disabled and the waiting hint shows.

### Unit 6: Saving makes the title follow the heading

**What it does.** `PUT /api/posts/:id/body` renames the post to its title row's text.

**Delta entries.** S-8.

**Ordering constraint.** After Unit 5. Landed earlier, a renamed post with unsaved changes would rename itself back on
Save.

**How you know it worked.**
- Route tests check the final title in each case:
  - Saving `"# The Moon\n\nIt sets."` over title "The Sun" makes the title "The Moon".
  - Saving `"Intro"` or `"#\n\nx"` leaves the title as it was.
  - Saving `"# A *b*"` over title "A b" leaves the title "A b".
- Browser tests over the fake:
  - Open a post, type, rename it to X, and Save. The fake's title and heading are both X.
  - After a Save, the post table shows the new title once the `posts-changed` sync runs.
- An editor round trip, in `markdown-editor.test.tsx`: each Unit 2 sample, written by `withHeadingTitle`, loaded into
  an editor document, and read back with `markdownOf`, still gives the same `headingTitle`.
- Seeds in `documents.test.tsx` whose heading differs from their title are checked for unintended renames on Save.

### Unit 7: Update the contract comments and README

**What it does.** Brings `src/posts/posts.ts`, `src/shared/wire.ts`, and `README.md` in line with the new rule.

**Delta entries.** S-11.

**Ordering constraint.** After Units 3 to 6.

**How you know it worked.** `grep -rn "empty" README.md src` and a read of each line S-11 names find nothing that still
says a new post is empty, or that a rename leaves the heading alone. `make test` passes.

## Risks

- **A rename and a Save collide on an open post.** If the browser's ordering in Unit 5 is wrong, a Save can write the
  old heading after a rename, and Unit 6 then renames the post back. D-6 pins the order step by step, and Unit 5's
  tests fail on each step's mutant. The blast radius is one post's title.
- **The browser and server compute different bodies.** If `withHeadingTitle` is not deterministic, or the fake API
  drifts from the route, the writer sees a "changed on disk" notice after renaming an open post. Unit 2's property
  checks and the fake's use of the real helpers guard this
  ([D-19](artifacts/change-decision-log.md#d-19-the-ui-tests-fake-posts-api-mirrors-the-routes-outcomes-with-the-real-helpers)).
- **The editor re-serializes a heading differently from `withHeadingTitle`.** The first Save after a rename would then
  shorten the title. Unit 6's editor round-trip test catches it.
- **The first Save of an older post renames it**
  ([D-9](artifacts/change-decision-log.md#d-9-existing-posts-are-not-migrated)). A post whose title came from its folder
  name, or whose heading was edited apart from its title, takes the heading's text on its first Save. This is intended,
  but it may surprise.
- **A half-applied rename.** A storage failure between the body write and the title write leaves the heading new and
  the title old. The writer sees the rename fail in the dialog. The browser re-syncs, so the editor shows what the disk
  holds, and a retry converges
  ([D-7](artifacts/change-decision-log.md#d-7-rename-checks-the-title-writes-the-body-then-writes-the-title)).
- **A half-applied Save.** A storage failure between a Save's body write and its title write shows "Could not save",
  then the "changed on disk" notice for the writer's own text. Saving again converges
  ([D-20](artifacts/change-decision-log.md#d-20-a-save-that-fails-between-its-two-writes-is-left-to-the-retry)).
- **Two tabs on one post.** A Save in one tab and a rename in another can interleave their store calls and leave the
  heading and title different. The app has no cross-tab coordination, and this plan does not add any (see Deferred).

## Deferred (YAGNI)

- **An atomic title-and-body store write.** It would add a `PostStore` method with one implementation. The store's
  per-post order, and the browser waiting for its own save, cover the only concurrent writer today. Reopen when a
  second tab or process writes the same post at once, or when a test shows the heading and title left different after
  interleaved Save and rename routes.
- **One heading finder shared by the Outline box and the title row.** The Outline works today, and the two answer
  different questions. Reopen when the Outline's heading reading and `headingTitle` disagree in a bug report.
- **A shared outcome table run against both the routes and the fake posts API.** The fake uses the real helpers, and
  only a few lines of route logic are copied. Reopen when the fake and a route are found to disagree.

## Cut for Scope

- **Research documents keep separate titles.** Syncing them would make a research document's name follow its first
  `#` heading the same way. The accepted scope says "Posts only. Research documents keep their separate titles."
  ([artifacts/scope-boundary.md](artifacts/scope-boundary.md#operator-stated-scope),
  [D-15](artifacts/change-decision-log.md#trivial-decisions)).

## Open Items

- **Edits from another program** (non-blocking). When another program changes a post's `#` heading on disk, the title
  follows only when the writer next saves the post in the app. This would be settled by the user asking for the title
  to follow the file on disk, which this plan does not include.

## Review Findings

One review round ran, at the medium size: `han-core:junior-developer`, `han-core:test-engineer`, and
`han-core:concurrency-analyst`. No finding was blocking, and none rested on an input nobody could inspect. Three
findings were marked `Unverified` by their authors, and none of them changed the plan:
- the fake's event wiring (JD-005);
- the Rename dialog's modality (F1);
- concurrent Yjs heading merges (F6).

These findings changed the plan:

- **The rename unit was split from its browser half** (JD-001). The server rewrote headings a unit before the editor
  followed, so a dirty open post would show the "changed on disk" notice. S-4, S-5, S-6, and S-7 now ship together as
  Unit 5.
- **The browser rename's order was prose** (F1, F2, F3). D-6 now pins seven steps: when `renaming` is set and cleared,
  reading `dirty` after the PUT, and re-syncing when the PUT fails.
- **A Rename dialog left open could rename mid-turn** (F1, F4, F6). Added S-7 and D-17.
- **Undo all's "empty" sentence** (test-engineer 1). Added S-10 and D-18.
- **The fake posts API was an unpinned second implementation** (test-engineer 3, JD-005). Added D-19.
- **Missing tests**: the editor round trip, held-sync reads, a half-applied rename, formatting that equals the title,
  Undo after a rename, closing during a rename, and the hint text (test-engineer 5-11). These are folded into Units 1,
  2, 5, and 6.
- **Unlisted behavior changes**: unsaved heading typing is replaced (JD-002), the Undo all offer ends (JD-008), and a
  title row can sit mid-post (JD-007). These are added to Behavior Changes.
- **README lines the change makes false** (JD-004), and the thin-handler convention (JD-003). S-11 lists each line,
  and D-2 records the exception.
- **A Save that half-applies** (F7). Added to Risks as D-20.

These findings were weighed and kept as planned:
- the serializer escape (JD-010; D-4 cites the breakage the change creates);
- CRLF handling (JD-011; the store's contract promises CRLF round-trips);
- "heading as the only title" (JD-012; rejected in D-2);
- two tabs (F5; Risks and Deferred).

Decisions and their evidence are in [artifacts/change-decision-log.md](artifacts/change-decision-log.md).

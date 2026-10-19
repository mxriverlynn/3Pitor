# Change Decision Log: Post Title and Heading Sync

This file records every decision committed while planning the post title and heading sync. The plan itself lives in
[../change-plan.md](../change-plan.md). This file captures the question, rationale, evidence, and rejected alternatives
behind each decision. Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

The user confirmed the area in the opening turn ("looks good"). Following their standing preference for planning runs
(settle escalations and behavior-change gates without asking, log each one, and report behavior changes at the end),
every behavior-changing entry below was decided by this run rather than escalated. Each such decision says so.

## Trivial decisions

- D-14: Rename dialog hint — The hint reads "The post’s first # heading changes to match. A post without one gets one
  at the top." While Claude works, D-17's hint shows in its place. — Referenced in plan: Surface Delta (S-6),
  Behavior Changes.
- D-15: Research documents stay independent — Only posts sync; research documents keep a title separate from any
  heading, as the accepted scope says. — Referenced in plan: Cut for Scope.
- D-16: Decide without asking — Escalations and behavior gates in this run are settled by the run and reported in the
  summary, per the user's standing preference for planning runs. — Referenced in plan: Behavior Changes.

## Full decisions

### D-1: The title-row helpers live in a new `src/shared/title-row.ts`

- **Question:** Where does "read the first level-1 heading" and "rewrite it" live, so the UI, the server routes, and
  the engine's `NewPost` all use one copy?
- **Decision:** A new module `src/shared/title-row.ts`, importing only `./markdown`, exports exactly three pure
  functions:
  ```ts
  // Whitespace runs become one space, then the ends are trimmed.
  export function titleText(title: string): string;
  // The plain text of the first top-level level-1 heading (ATX `#` or setext `===`; not inside a quote, list, or code
  // fence), as titleText of the parsed heading's textContent, so inline formatting is dropped and escapes resolved.
  // null when there is no such heading, or when that first one is blank. It never skips ahead to a later heading.
  export function headingTitle(markdown: string): string | null;
  // `markdown` with that first top-level level-1 heading's source lines replaced by one line,
  // markdownSerializer's output for a level-1 heading holding titleText(title). A trailing '\r' on the last replaced
  // line is kept. No other character changes. With no such heading: markdown === '' ? line : `${line}\n\n${markdown}`.
  export function withHeadingTitle(markdown: string, title: string): string;
  ```
  Invariant: `headingTitle(withHeadingTitle(m, t)) === titleText(t)` for every `m` and every `t` with
  `titleText(t) !== ''`. `withHeadingTitle` is deterministic, because the UI and the server must compute the same
  string from the same input (D-6).

  Worked examples (run by the architect against a prototype):

  | call | result |
  | --- | --- |
  | `titleText('  The   Sun\n')` | `'The Sun'` |
  | `withHeadingTitle('', 'The Sun')` | `'# The Sun'` |
  | `withHeadingTitle('Intro para', 'New')` | `'# New\n\nIntro para'` |
  | `withHeadingTitle('# Old\n\nBody', 'New')` | `'# New\n\nBody'` |
  | `withHeadingTitle('Old\n===\n\nBody', 'New')` | `'# New\n\nBody'` |
  | `withHeadingTitle('## Sub\n\n# Old\nmore', 'New')` | `'## Sub\n\n# New\nmore'` |
  | `withHeadingTitle('# Old\r\n\r\nBody', 'New')` | `'# New\r\n\r\nBody'` |
  | `withHeadingTitle('#\n\nBody', 'New')` | `'# New\n\nBody'` |
  | ``withHeadingTitle('```\n# code\n```', 'New')`` | ``'# New\n\n```\n# code\n```'`` |
  | `withHeadingTitle('> # q\n\nx', 'New')` | `'# New\n\n> # q\n\nx'` |
  | `withHeadingTitle('# A *b*\n\n# Second', 'New')` | `'# New\n\n# Second'` |
  | `withHeadingTitle('', '*star* _u_')` | `'# \\*star\\* \\_u\\_'` |
  | `withHeadingTitle('', 'C #')` | `'# C \\#'` (needs D-4) |
  | `withHeadingTitle('', '#')` | `'# \\#'` (needs D-4) |
  | `headingTitle('# A *star* title')` | `'A star title'` |
  | `headingTitle('Title\n===')` | `'Title'` |
  | `headingTitle('#   \n\nx')`, `headingTitle('Intro')`, `headingTitle('> # q')` | `null` |
- **Rationale:** Only `src/shared/` is importable by all three writers. `shared/markdown.ts` already holds the parser
  and serializer and is Bun-free. A separate file keeps a rule about posts out of the module that describes the
  markdown format. Keeping a `\r` on the replaced line is one line of code, and the store's contract promises that
  CRLF bodies round-trip (`src/posts/posts.ts`, `Post.body`), so a rename of a post that is not open must not change
  its line endings (junior-developer JD-011). `withHeadingTitle` is also idempotent:
  `withHeadingTitle(withHeadingTitle(m, t), t) === withHeadingTitle(m, t)`, which Unit 2 tests (test-engineer).
- **Evidence:** C-3, C-4, C-5; software-architect proposal §1, §2a.
- **Behavior impact:** Preserving. Nothing calls the module until later units.
- **Rejected alternatives:**
  - Append the helpers to `shared/markdown.ts` — rejected because that module describes the format, and the title row
    is a post rule. One fewer file is the only gain.
  - Export the editor's `headingsOf` or `rawHeadingStart` — rejected because they work on a `Y.Doc` or on levels 1 to 5
    for the Outline, live in the UI package the server and engine cannot import, and answer a different question (C-5).
  - A regex over lines — rejected because it would treat `#` inside a code fence as a heading and miss setext headings,
    which CommonMark tokens already handle (C-4).
- **Revisit criterion:** The Outline's heading reading and `headingTitle` disagree in a bug report.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-2, D-3, D-5, D-6, D-7
- **Referenced in plan:** Target State, Surface Delta (S-2), Change Units (Unit 2)

### D-2: The server routes keep title and heading in step; the store is untouched

- **Question:** Who enforces the sync: the `PostStore`, the server's post routes, the UI, or a mix?
- **Decision:** The post routes in `src/server/posts/posts.routes.ts` enforce it for every write that reaches the store
  through HTTP. The engine's `NewPost` applies the same helpers at create (D-5). The browser mirrors a rename into an
  open editor (D-6). `PostStore` and the file store do not change. `src/posts/posts.ts` gains one comment line saying
  that the server keeps a post's title and first `#` heading in step, and that the store itself still never reads or
  writes a heading.
- **Rationale:** The routes see every rename, save, and create the writer makes, including renames of posts that are
  not open. Keeping the store unaware preserves decision D9 and the contract suite, and no store change could reach
  unsaved editor text anyway.
- **Evidence:** C-1, C-2, C-11, C-18; software-architect proposal §4.
- **Behavior impact:** Changing, through S-3, S-4, and S-8. Decided under D-16.
- **Rejected alternatives:**
  - The store enforces sync — rejected because it reverses D9 (C-2), breaks the contract suite (C-18), and adds the
    `shared/markdown` dependency D9 removed. It still could not reach a dirty open editor (C-8).
  - The browser alone enforces sync — rejected because renaming a row whose post is not open would take three requests
    from the browser, and `NewPost` would still need its own copy.
  - A new atomic `setTitleAndBody` store method — deferred under YAGNI (see the plan's Deferred section).
  - The engine wraps the store with a sync-aware one, keeping the handlers thin — rejected because the README says
    "the engine hands on the store rather than wrapping it", and a wrapper would be a second `PostStore` implementation
    with one caller. The route handlers are the smaller exception, and the README's server section records it (S-11).
  - The heading is the only title, read from the body when listing, with the stored title as a fallback — rejected
    because `list()` would read every post's body, `Posts` and search would parse markdown on every call, and the
    store's `PostSummary.title` contract ("the title exactly as last given") would no longer describe what callers
    see.
- **Convention exception:** README `### src/server/` says a handler "pulls what it needs out of the request, checks
  its shape, and hands it to its slice of the engine". The title, body, and create handlers now also apply the title
  row rule. This is the one domain rule in the post routes, and S-11 adds it to the README's server section
  (junior-developer JD-003).
- **Revisit criterion:** A second store implementation or a non-HTTP writer of post bodies appears.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-4, S-8, S-11
- **Dependent decisions:** D-6, D-7, D-12
- **Referenced in plan:** What Changes In One Paragraph, Target State, Surface Delta (S-3, S-4, S-8, S-11)

### D-3: A saved heading's plain text becomes the title, only when the heading exists and is not blank

- **Question:** On Save, how does the heading map to a title, and what happens with no heading or a blank one?
- **Decision:** `PUT /api/posts/:id/body` writes the body, then takes `headingTitle(body)`. When it is not `null` and
  differs from the stored title, the route sets the title to it. When it is `null` (no first-level heading, or the
  first one is blank), the title stays as it is. The title is the heading's plain text: `# A *star* title` gives
  `A star title`.
- **Rationale:** The formatted editor re-serializes markdown on Save, so raw source would carry escapes like `\*` into
  the title and drift with each Save. Plain text is stable through the round trip. A blank title is refused by the
  store, so a blank heading cannot become one; leaving the title alone is the only option that cannot fail the Save.
  This is the one place "always in sync" gives way: a writer who deletes or blanks the title row and saves keeps the
  old title until they rename or add a heading again. Re-adding the heading on Save was weighed and rejected below
  (junior-developer JD-006).
- **Evidence:** C-4, C-6, C-12; software-architect proposal §2a, §2c.
- **Behavior impact:** Changing. Saving a post whose first `#` heading differs from its title renames the post.
  Decided under D-16.
- **Rejected alternatives:**
  - Raw heading source as the title — rejected because serializer escapes would leak into titles.
  - Remove the title or refuse the Save when the heading is gone — rejected because a Save must not fail over a title,
    and a post always has a title.
  - Take the next level-1 heading when the first is blank — rejected because "the title row" is one line, and skipping
    ahead would make a body heading the title by surprise.
  - Re-add `# <title>` to the body on a Save with no title row — rejected because the server would then store text
    the editor does not hold, and the writer would get the "changed on disk" notice for their own Save.
  - Count only a heading that is the body's first block — rejected because the user accepted "the post's first `#`
    heading" in the opening confirmation. A post that opens with a paragraph and then `# Part One` treats
    `Part One` as its title row (junior-developer JD-007; reported in Behavior Changes).
- **Revisit criterion:** Writers report that deleting the heading should do something visible.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-9
- **Referenced in plan:** Target State, Surface Delta (S-8), Behavior Changes

### D-4: The shared serializer escapes a heading that ends in `#`

- **Question:** Can every title survive a trip into the heading and back through the editor's Save?
- **Decision:** `markdownSerializer` in `src/shared/markdown.ts` gets a `heading` override: it writes
  `'#'.repeat(level) + ' '`, renders the inline content, then replaces a final run of `#` that follows a space or tab
  (`/([ \t])(#+)$/` on the output so far) with that whitespace plus `\` plus the run, then closes the block. Headings at
  every level get it. Before: a heading holding `ends with #` is written `# ends with #`, which reads back as
  `ends with`. After: `# ends with \#`, which reads back as `ends with #`.
- **Rationale:** CommonMark treats a trailing ` #` run as a closing sequence. Without the fix, a title like `C #` or `#`
  would silently shorten on the first Save. The editor's `markdownOf` uses the same serializer, so one fix covers both
  the helper and Save. The junior developer flagged this as a YAGNI candidate (JD-010), since no writer has such a
  title. It stays, on evidence class 3: the Rename dialog accepts any non-blank title today, and S-8 would rename a
  post called `C #` to `C` on its next Save. That breakage is one this change creates, and the fix is one serializer
  override.
- **Evidence:** software-architect proposal §2b (checked by running the serializer on samples); C-4, C-6.
- **Behavior impact:** Changing, narrowly. A saved heading whose text ends in space-then-`#` is now written with an
  escape. Those headings read back wrong before, so no correct output changes. Decided under D-16.
- **Rejected alternatives:**
  - Escape only inside `withHeadingTitle` — rejected because the editor's next Save would re-serialize the heading
    without the escape and shorten the title.
  - Refuse titles ending in `#` — rejected because it adds a rule the writer would not expect, to work around a bug.
- **Revisit criterion:** Another serializer round-trip failure turns up in a heading.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** D-1
- **Referenced in plan:** Surface Delta (S-1), Change Units (Unit 1), Behavior Changes

### D-5: A post Claude makes starts with its title as its heading, and the tool's title wins

- **Question:** For `NewPost`, what does the store hold, and what happens when the model's `content` has no `#` line
  or a different one?
- **Decision:** `NewPost` computes `t = titleText(title)`, creates the post with
  `{ title: t, body: withHeadingTitle('', t) }`, and puts `withHeadingTitle(content, t)` into the editor as the unsaved
  edit. Its highlights exclude the blocks the stored body already holds, as `Write` does. The tool description says
  the post is made holding only its title as a `#` heading, and that the text, with its first `#` heading set to the
  title, appears in the editor unsaved. Example: title `"Spring Beds"`, content `"# Garden\n\nSow."` stores
  `"# Spring Beds"` and puts `"# Spring Beds\n\nSow."` in the editor. Content `"Sow."` gives the same editor text.
- **Rationale:** The accepted scope says a post Claude makes starts with `# <title>`. Making the tool's title win keeps
  the post's name the one the model chose and the writer saw in the reply. Taking the content's heading as the title
  instead would rename a post the moment it is made.
- **Evidence:** C-10, C-13, C-14; software-architect proposal §2f.
- **Behavior impact:** Changing. The stored body is `# <title>` rather than empty, the model's own first heading is
  replaced, and Undo all leaves a post Claude made holding `# <title>` rather than empty. Decided under D-16.
- **Rejected alternatives:**
  - Keep the store empty and only fix the editor text — rejected because a post Claude makes and the writer never
    saves would have no heading, against the accepted scope.
  - Use the content's first heading as the title — rejected for the rename-on-create surprise above.
- **Revisit criterion:** Writers ask for Claude's post titles to come from its draft's heading.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9
- **Dependent decisions:** D-11
- **Referenced in plan:** Target State, Surface Delta (S-9), Behavior Changes

### D-6: An open post follows a rename in the editor, and rename and save wait for each other

- **Question:** How does a rename reach a post open in the editor, with and without unsaved changes, without raising
  the "changed on disk" notice for the app's own change, and how is it ordered against a save in flight?
- **Decision:** In `src/ui/documents/documents/documents.tsx`, `Entry` gains `renaming?: Promise<void>`, and the three
  functions follow this sequence. The order of the numbered steps is the contract (concurrency-analyst F1, F2, F3):
  ```ts
  rename(id, title):
    entry = opened.current.get(id)
    run = (async () => {
      await entry?.saving?.catch(() => {})                    // 2. a save holding the old line lands first
      try {
        await api('PUT', `${postUrl(id)}/title`, { title })   // 3.
      } catch (error) {
        void syncWithDisk()                                    // 4. a half-applied rename shows as it is on disk
        throw error
      }
      if (entry && opened.current.get(id) === entry) {         // 5. read `dirty` only now, after the PUT
        const t = titleText(title)
        if (entry.dirty) {
          replaceMarkdown(entry.doc, withHeadingTitle(markdownOf(entry.doc), t))
          entry.saved = withHeadingTitle(entry.saved, t)       //    stays unsaved
        } else followDisk(entry, withHeadingTitle(entry.saved, t))
        entry.saves++                                          // 6. before `renaming` clears, in the same tick
        endOffer((file) => file === id)
      }
    })()
    if (entry) entry.renaming = run                            // 1. set synchronously, before any await
    const clear = () => { if (entry?.renaming === run) entry.renaming = undefined }   // 7. cleared by identity
    run.then(clear, clear)                                     //    on success and on failure
    await run
    await refreshList()

  save(name):     before the existing `if (entry?.saving) return entry.saving`, wait for `entry.renaming` (ignoring
                  its failure), then re-read `entry.saving`, so two Saves pressed during a rename still join.
  syncFile:       drop the read when `entry.saving || entry.renaming || entry.saves !== saves`.
  ```
  `run` sets `entry.renaming` before its first await resolves, because step 1 runs in the same tick as the call.
  The browser's `entry.saved` then equals what the server wrote, whenever the disk held `entry.saved` before the
  rename, because both sides run `withHeadingTitle` on the same string. No new field crosses the wire.

  Worked example, notice already showing (junior-developer JD-009): the writer has unsaved edits, the disk was changed
  by another program to `D`, and the notice shows. A rename to `T` makes the server write `withHeadingTitle(D, T)` and
  the browser set `entry.saved = withHeadingTitle(S, T)` with `S !== D`. The next sync finds disk and `entry.saved`
  still differ and shows the notice again, with the disk text now holding `# T`. "Take the disk version" gives that
  text. "Keep mine" and Save writes the writer's text, whose heading the rename already set to `# T`, so the title
  stays `T`.

  `endOffer` runs because Undo all would put the old heading back into the editor, and the next Save would rename the
  post back (junior-developer JD-008).

  The `entry.saves` bump also makes `offerUndo` and `applyEditedNow` treat the post as saved during a turn. With D-17
  in place a rename cannot run during a turn, so neither reader sees the bump mid-turn (concurrency-analyst F4).
- **Rationale:** The server cannot reach unsaved editor text. Without this, a dirty open post would write its old
  heading back on Save, and the title would follow it back (C-8, C-16). `replaceMarkdown` keeps Undo from bringing the
  old heading back and reverting the rename on Save.
- **Evidence:** C-6, C-7, C-8, C-16; software-architect proposal §2d, §2e; concurrency-analyst F1-F4;
  junior-developer JD-002, JD-008, JD-009.
- **Behavior impact:** Changing. An open post shows its new heading straight after a rename, and its editor's undo
  history is cleared, as it is for any change read from disk. Unsaved typing inside the heading line is replaced by
  the new title, while unsaved changes elsewhere stay. The Undo all offer for the post ends. Decided under D-16 (see
  D-13).
- **Rejected alternatives:**
  - Leave the editor alone and let the sync reload it — rejected because a dirty post gets the "changed on disk"
    notice and Save reverts the rename.
  - `mergeMarkdown` under the AI's origin — rejected because Undo would then bring back the old heading, and Save
    would rename the post back.
  - Reuse `entry.saving` for a rename — rejected because a Save pressed during a rename would join it and not save.
  - Return the written body in the `PUT /title` response — rejected because the browser computes the same string.
- **Revisit criterion:** A second tab or process edits the same post at once.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-13
- **Referenced in plan:** Target State, Surface Delta (S-5), Change Units (Unit 4), Risks

### D-7: Rename checks the title, writes the body, then writes the title

- **Question:** In what order does `PUT /api/posts/:id/title` call the store, and how does it fail?
- **Decision:**
  ```ts
  // PUT /api/posts/:id/title  { title }  ->  { ok: true }
  const t = titleText(title);
  if (t === '') throw new PostError('invalid', 'post');  // 400, before any store call
  const { body } = await posts.get(id);                  // 404 before any write
  const next = withHeadingTitle(body, t);
  if (next !== body) await posts.setBody(id, next);
  await posts.setTitle(id, t);
  ```
  Example: `{ title: "  New  " }` on body `"# Old\n\nBody"` calls `get`, `setBody(id, "# New\n\nBody")`,
  `setTitle(id, "New")`. `{ title: "   " }` answers 400 and calls nothing.
- **Rationale:** If the title write fails after the body write, the heading is new and the title old, and retrying
  the rename fixes it. In the other order, a failure leaves the heading old, and the next Save quietly renames the post
  back.
- **Evidence:** C-1, C-11; software-architect proposal §2c.
- **Behavior impact:** Changing (S-4). Decided under D-16.
- **Rejected alternatives:**
  - Title first, then body — rejected for the silent revert above.
- **Revisit criterion:** An atomic store write exists (see Deferred).
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-4)

### D-8: Titles are tidied on create and rename

- **Question:** Is a title stored exactly as typed, or tidied to match what the heading can hold?
- **Decision:** `POST /api/posts`, `PUT /api/posts/:id/title`, and `NewPost` store `titleText(title)`: runs of
  whitespace become one space, and the ends are trimmed.
- **Rationale:** A heading is one line, and its plain text loses padding. Storing the untidied title would make the
  first Save rename `"  Moon "` to `"Moon"`.
- **Evidence:** C-18 (the store keeps padding today); software-architect proposal §2c.
- **Behavior impact:** Changing. A title typed with padding or doubled spaces is stored without them. Decided under
  D-16.
- **Rejected alternatives:**
  - Store titles exactly — rejected for the rename-on-first-Save surprise.
- **Revisit criterion:** A writer needs significant whitespace in a title.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-4, S-9
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta (S-3, S-4, S-9), Behavior Changes

### D-9: Existing posts are not migrated

- **Question:** What happens to posts whose heading and title already disagree, or that have no heading?
- **Decision:** No migration runs. Such a post comes into step the next time the writer renames it (the heading is
  rewritten or added) or saves it with a non-blank first `#` heading (the title follows it).
- **Rationale:** A migration would rewrite every post's files at startup, including posts another program owns, for a
  state the next rename or Save fixes. Nothing in the scope asks for it.
- **Evidence:** C-1, C-11 (title falls back to the folder name when `.post.json` is missing).
- **Behavior impact:** Changing. The first Save of an older post whose heading differs from its title renames the
  post, including one whose title is still its folder name. Decided under D-16.
- **Rejected alternatives:**
  - A one-time migration — rejected as above.
- **Revisit criterion:** Writers report surprise renames on first Save.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes, Risks

### D-10: A rename replaces the heading's formatting with plain text

- **Question:** When the heading holds formatting (`# A *big* day`), what does a rename write?
- **Decision:** The whole heading line becomes `# <title>`, escaped, with no formatting.
- **Rationale:** The title is plain text (D-3), so it carries no formatting to write back.
- **Evidence:** D-1, D-3.
- **Behavior impact:** Changing. Renaming a post whose heading is formatted drops the formatting. Decided under D-16.
- **Rejected alternatives:**
  - Keep the formatting when the plain text is unchanged — rejected because the rename dialog's submit button is
    disabled when the title is unchanged, so the case never arises.
- **Revisit criterion:** Writers ask to keep formatting in post headings across a rename.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4, S-5
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes

### D-11: Undo all leaves a post Claude made holding its heading

- **Question:** After D-5, what does Undo all leave in a post Claude made?
- **Decision:** It leaves what the store holds, `# <title>`, through the existing path (C-14). No code changes for it.
- **Rationale:** The post keeps its title, so its heading stays in step with it.
- **Evidence:** C-14; D-5.
- **Behavior impact:** Changing. The post is no longer empty after Undo all. Decided under D-16.
- **Rejected alternatives:**
  - Special-case Undo all to empty the post — rejected because the post would then be out of step.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-9
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes

### D-12: Save does not refresh the list itself

- **Question:** After a Save that renames the post, how does the new title reach the post table and the post panel?
- **Decision:** Through the existing `posts-changed` signal and its sync, which refreshes the list (C-12). `save` gains
  no list refresh.
- **Rationale:** The store signals every write it makes before the call settles, so the route's `setTitle` reaches
  the tab without new code.
- **Evidence:** C-12; `src/posts/posts.ts` `watch` contract ("Own writes ... signals every subscription").
- **Behavior impact:** Preserving for the save path itself. The title change it carries is S-8.
- **Rejected alternatives:**
  - `save` calls `refreshList()` for posts — rejected because it duplicates the signal's work.
- **Revisit criterion:** The title visibly lags after Save in use.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-13: A rename of an open post clears its editor's undo history

- **Question:** Is losing the editor's undo history on rename acceptable?
- **Decision:** Yes. Rename uses `replaceMarkdown`, which clears it, as every change read from disk already does.
- **Rationale:** With history kept, Undo could restore the old heading, and the next Save would rename the post back.
  The clear also drops undo steps for Claude's earlier edits to the post. With D-17, those come only from a finished
  turn (concurrency-analyst F6).
- **Evidence:** C-6; D-6.
- **Behavior impact:** Changing. After a rename of an open post, Undo cannot step back past the rename. Decided under
  D-16.
- **Rejected alternatives:**
  - Keep history by merging under the AI's origin — rejected as in D-6.
- **Revisit criterion:** Writers report losing undo steps after a rename.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes

### D-17: The Rename dialog waits while Claude works

- **Question:** A Rename dialog opened before a turn starts can still be submitted mid-turn (C-15). Now that a rename
  rewrites the post's text, is that still acceptable?
- **Decision:** `usePostDialogs` takes its optional third argument as an options object,
  `usePostDialogs(docs, open, options?: { onClose?: () => void; busy?: boolean })`. While `busy` is true, the Rename
  dialog's submit button is disabled and its hint reads "Renaming waits until Claude finishes." The post table and the
  post panel pass the `busy` they already hold. The New post and Delete dialogs are unchanged.
- **Rationale:** Mid-turn, a rename can silently drop an edit Claude merged while the rename was in flight (F1). It
  can also give a false "it was saved while Claude was working" message (F4), and mangle a heading both sides changed
  (F6). The menus already wait while Claude works, so this closes the one gap with one flag.
- **Evidence:** C-15; concurrency-analyst F1, F4, F6.
- **Behavior impact:** Changing. A Rename dialog left open when a turn starts cannot be submitted until the turn ends.
  Decided under D-16.
- **Rejected alternatives:**
  - Close the dialog when a turn starts — rejected because it throws away what the writer typed.
  - Leave the gap and handle each race in `rename` — rejected because each needs its own guard, and the menus already
    set the rule.
- **Revisit criterion:** Writers need to rename while Claude works.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7
- **Dependent decisions:** D-6, D-13
- **Referenced in plan:** Surface Delta (S-7), Behavior Changes, Risks

### D-18: Undo all's confirmation says Claude's posts keep their heading

- **Question:** Undo all's confirmation says "Posts Claude made stay in your posts, empty." After D-5 they are not
  empty. What does it say?
- **Decision:** `undoWarning` in `src/ui/documents/documents/documents.tsx` says "Posts Claude made stay in your
  posts, holding only their title. Delete them from your posts if you don't want them." The comments on `LastTurn` and
  `undoWarning` say the same.
- **Rationale:** The sentence would otherwise be false. A test asserts it (`documents.test.tsx` lines 894-906).
- **Evidence:** test-engineer finding 1; C-14.
- **Behavior impact:** Changing. The writer reads the new sentence. Decided under D-16.
- **Rejected alternatives:**
  - Drop the sentence — rejected because it tells the writer the made posts are not deleted.
- **Revisit criterion:** —
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta (S-10), Behavior Changes

### D-19: The UI tests' fake posts API mirrors the routes' outcomes with the real helpers

- **Question:** The browser tests run against `src/ui/components/fake-posts-api.ts`, which today just sets fields.
  How does it stay in step with the routes, so the tests of "no notice after rename" and "title follows Save" mean
  something?
- **Decision:** The fake imports `titleText`, `headingTitle`, and `withHeadingTitle` from `src/shared/title-row.ts`.
  Its handlers produce the routes' end states. They do not copy the routes' call order, which the browser cannot
  observe:
  ```ts
  // POST /api/posts
  const t = titleText(title);
  if (t === '') return refuse(400, 'post');
  return Response.json({ id: api.add(t, withHeadingTitle('', t)) });
  // PUT /api/posts/:id/title
  const t = titleText(title);
  if (t === '') return refuse(400, 'post');
  api.files.set(id, withHeadingTitle(api.files.get(id)!, t));
  api.titles.set(id, t);
  // PUT /api/posts/:id/body
  api.files.set(id, body);
  const heading = headingTitle(body);
  if (heading !== null) api.titles.set(id, heading);
  ```
  Each unit that changes a route changes the matching fake branch in the same commit. Test seeds that stand for a
  post Claude made use `'# <title>'`, not `''`.
- **Rationale:** With the real helpers, the fake cannot drift from the server on the text rules. The only copy left is
  the few lines above, and route tests and UI tests each check their side against D-1's table.
- **Evidence:** test-engineer findings 2, 3, 4; junior-developer JD-005.
- **Behavior impact:** Preserving. Test code only.
- **Rejected alternatives:**
  - A shared outcome table run against both the routes and the fake — deferred under YAGNI. Reopen if the two are
    found to disagree.
  - Leave the fake as it is — rejected because the rename and Save tests would pass against rules the server does not
    have.
- **Revisit criterion:** The fake and a route disagree in a bug.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Change Units (Units 3, 5, 6)

### D-20: A Save that fails between its two writes is left to the retry

- **Question:** If `PUT /api/posts/:id/body` writes the body and then fails to write the title, what does the writer
  see, and is new code needed?
- **Decision:** No new code. The Save shows "Could not save", the post stays unsaved, and the next sync shows the
  "changed on disk" notice because the disk now holds the writer's text. Saving again rewrites the same body and sets
  the title.
- **Rationale:** It is a storage failure in a two-call window, and a retry converges.
- **Evidence:** concurrency-analyst F7.
- **Behavior impact:** Preserving in kind. A failed Save already leaves the post unsaved.
- **Rejected alternatives:**
  - An atomic store write — deferred under YAGNI with D-2's.
- **Revisit criterion:** The notice after a failed Save is reported in use.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** —
- **Referenced in plan:** Risks

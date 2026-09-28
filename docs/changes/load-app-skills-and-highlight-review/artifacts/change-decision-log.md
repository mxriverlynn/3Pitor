# Change Decision Log: Load app skills and highlight review

This file records every decision committed while planning this change. The plan itself lives in
[../change-plan.md](../change-plan.md). Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

## Trivial decisions

- D-1: Rename the skill folder — `src/skillls/` becomes `src/skills/`, as the operator confirmed ("oops - yes, it should
  be "src/skills""). — Referenced in plan: Surface Delta (S-1), Change Units (Unit 1).
- D-13: README describes the new pieces — `README.md` names `src/skills/`, `app-skills.macro.ts`, and
  `src/shared/passages.ts`, and its line calling `markdown-support.ts` "the one piece of runtime code both sides share"
  is updated. — Referenced in plan: Change Units (Units 2 and 3).

## Full decisions

### D-2: Embed every skill file with a bundle-time macro

- **Question:** How do skills in `src/skills/` reach both `bun run server` and the compiled `build/3pitor`, without a
  code edit per skill file?
- **Decision:** New `src/server/app-skills.macro.ts` exports `appSkillFiles(): Record<string, string>`. At bundle or
  transpile time it globs `**/*.md` under `src/skills/` and returns each file's text, keyed by its path relative to
  `src/skills/`. `workspace-config.ts` imports it `with { type: 'macro' }` and keeps the result as
  `APP_SKILL_FILES`. Only `.md` files are embedded. Worked value:
  ```ts
  {
    "collaborative-draft-editing/SKILL.md": "---\nname: collaborative-draft-editing\n...",
    "collaborative-draft-editing/references/editing-lessons.md": "# Content-editing lessons\n...",
    "collaborative-draft-editing/references/pairing-brief.md": "# Pairing brief for a content edit\n..."
  }
  ```
- **Rationale:**
  - The operator requires "all skills from this folder" and "they must be included in the executable".
  - The compiled binary cannot read files through a computed path.
  - The macro was the only mechanism tested that meets both requirements.
- **Evidence:** C-18 (reproduced crash), C-19 (macro experiment), operator's confirmation answers.
- **Behavior impact:** Preserving on its own. Nothing reads `APP_SKILL_FILES` until D-3 and D-5 do.
- **Rejected alternatives:**
  - One `import … with { type: 'text' }` per file — rejected because it needs a code edit for every skill file, which
    contradicts "all skills from this folder" (C-19).
  - Extra entrypoints on `bun build --compile` — rejected because the embedded files could not be read in the
    experiment (C-19).
  - A Makefile step generating a `.ts` index — rejected because it adds a generated file that dev and test runs must
    also regenerate.
  - Copying `src/skills/` next to the binary — rejected because the operator wants them inside the executable, and the
    build already dropped the loose-files approach (C-18).
- **Revisit criterion:** A Bun release that drops or changes macros, or skills that need non-markdown files at runtime.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-3, D-5
- **Referenced in plan:** Target State, Surface Delta (S-2), Risks

### D-3: App skill files are read through a `3pitor://skills/` path, outside the workspace boundary

- **Question:** How does the model read an app skill's `SKILL.md` and its `references/` files when `Read` refuses
  everything outside the workspace (C-4)?
- **Decision:** In `workspace-config.ts`:
  ```ts
  export const APP_SKILL_PREFIX = '3pitor://skills/';
  // undefined when filePath does not start with APP_SKILL_PREFIX. Otherwise the embedded text for the rest of the path,
  // normalized with node:path/posix normalize; throws `${filePath} does not exist` when there is no such file or the
  // normalized rest starts with '..'. Never touches disk.
  export function appSkillText(filePath: string): string | undefined
  ```
  `Read` calls `appSkillText` first and returns its text when it is defined; everything after that is unchanged. App
  skills carry `path = '3pitor://skills/<name>/SKILL.md'`. Worked read:
  `Read({ file_path: "3pitor://skills/collaborative-draft-editing/references/editing-lessons.md" })` returns the embedded
  lessons text. `Write` and `Edit` on such a path fail as before ("not a markdown post" or "outside the workspace"), so
  app skill files are read-only. `Glob` does not list them.
- **Rationale:** The workspace boundary protects the user's files and stays exactly as it is. The app's own files come
  from a second, in-memory source that cannot reach the disk.
- **Evidence:** C-2, C-4, C-7 (`${CLAUDE_SKILL_DIR}`), and the `tools.test.ts` test "refuses an absolute path outside
  the workspace", which stays green.
- **Behavior impact:** Changing, and narrowly. A `Read` of a path starting `3pitor://skills/` now returns bundled text
  where it used to fail. It is settled by the operator's request that app skills be "available for to use from the app"
  (D-11).
- **Rejected alternatives:**
  - Put the SKILL.md body in the system prompt — rejected because the `references/` files would still be unreadable,
    and every turn would carry the whole skill.
  - Copy app skills into `<workspace>/.claude/skills/` — rejected because it writes into the user's folder, and still
    needs a source inside the binary.
  - Relax `resolveInWorkspace` to allow the app's install folder — rejected because the compiled binary has no such
    folder (C-18), and it would widen the boundary for user files.
- **Revisit criterion:** A need for the model to list or search app skill files (Glob or Grep over them).
- **Dissent (if any):** None.
- **Settles delta entry:** S-5, S-6
- **Dependent decisions:** D-6
- **Referenced in plan:** Target State, Surface Delta (S-5, S-6)

### D-4: No slash-command parser; `/name` stays a prompt convention

- **Question:** Does typing `/collaborative-draft-editing` need code that recognizes it, on the client or the server?
- **Decision:** No. App skills join the list `instructionsFor` already gives the model, and that list already says "or
  the user types /<name>". `instructionsFor` titles the list "Skills" rather than "Skills in this workspace". It adds
  one line: "Links inside a skill are relative to its SKILL.md's folder; Read them with the same prefix."
- **Rationale:** The convention already carries `/doc-stats` today. A parser with no observed miss to fix fails the
  YAGNI evidence test.
- **Evidence:** C-2, C-3.
- **Behavior impact:** Changing, and settled by the operator's request (D-11). Every chat's instructions list the app
  skill and use the new wording.
- **Rejected alternatives:**
  - A client-side `/name` parser that injects the skill — rejected because nothing shows the model missing the
    convention (C-3 is Unverified for the model's side).
- **Revisit criterion:** A `bun run check` scenario, or a real run, where `/collaborative-draft-editing` is not picked
  up.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta (S-7), Deferred (YAGNI)

### D-5: App skills merge into `loadWorkspaceConfig`; a workspace skill wins on a name clash

- **Question:** Where are app skills listed, and what happens when a workspace defines a skill with the same name?
- **Decision:**
  - `loadWorkspaceConfig` returns `skills = [...workspaceSkills, ...APP_SKILLS not named by a workspace skill]`, sorted
    by name.
  - `APP_SKILLS: Skill[]` is built once from every `*/SKILL.md` key in `APP_SKILL_FILES`. The name is the folder, the
    description comes from the frontmatter, and the path is `APP_SKILL_PREFIX + key`.
  - Frontmatter parsing for disk files and embedded text is shared through
    `parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } | undefined`, extracted from
    `readMarkdown`.
  - A malformed app `SKILL.md` is skipped, the same way a malformed workspace one is.
- **Rationale:**
  - "Which skills exist" already lives in this function.
  - Agents already merge a code-defined source here (`CODE_AGENTS`).
  - Letting the workspace win matches how `taskTool` resolves agents, where workspace agents are listed first.
  - `/api/workspace-config` and `AgentPanel` then show the app skill with no change (C-9).
- **Evidence:** C-1, C-5, C-9.
- **Behavior impact:** Changing, and settled by the operator's request (D-11).
  - Every workspace's Agent panel now shows a `/collaborative-draft-editing` chip.
  - `/api/workspace-config` includes it.
  - Tests expecting `skills: []` change.
- **Rejected alternatives:**
  - A separate `loadAppSkills` with its own route — rejected because it is a second list of the same thing, and the
    panel and prompt would each have to merge the two.
  - List both on a name clash — rejected because two identical `/name`s are ambiguous to the model.
- **Revisit criterion:** A need to see which source a skill came from in the UI.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-4
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-3, S-4)

### D-6: Adapt `collaborative-draft-editing` to the app's tools rather than grow tools for it

- **Question:** What does the skill stop doing, or do differently, so it runs inside 3pitor?
- **Decision:** The skill keeps its purpose and its steps: a lessons pass, then a paired section-by-section review, then
  proposing new lessons. Its mechanics change:
  1. Frontmatter keeps `name`, `description`, and `argument-hint`. The `` !`…` `` Project Context lines and
     `allowed-tools` are deleted.
  2. The `han-core:pairing` preflight and handoff are replaced by an inlined loop. `references/pairing-brief.md`
     becomes the skill's own loop reference, and SKILL.md states the stop rule: one piece per turn, end the turn on
     the question, never edit ahead of the writer's answer.
  3. With no draft argument, the draft is the file open in the editor. Otherwise it is found with `Glob`.
  4. Links use `3pitor://skills/collaborative-draft-editing/references/…` instead of `${CLAUDE_SKILL_DIR}` (D-3).
  5. The record and the lessons follow D-7.
  6. `git` steps are dropped, and the skill tells the writer to Save after accepting a stop. It never claims a commit.
  7. `curl` link checks are dropped. Links an edit adds or touches are listed for the writer as unchecked.
  8. The reflow script and the wrap-width steps are dropped (D-12).
  9. `wc -w` counts become the model's estimate, labeled as one.
  10. Every stop ends with a `Highlight` call covering the passages it discusses, labeled to match its questions
      (D-8). An overview stop highlights the section heading plus one quote per paragraph it asks about.
  11. Each turn starts by `Read`ing the draft again before any `Edit` or `Highlight`, because the writer hand-edits
      between stops (C-14).
  12. The initial lessons pass is one `Write` of the whole draft, or a few `Edit`s, to stay under the 20-step turn
      limit (C-16).
- **Rationale:** The operator chose to adapt the skill (confirmation answer 1, recommendation (a)). Giving the AI shell,
  git, or non-post writes is out of scope.
- **Evidence:** C-5, C-6, C-7, C-14, C-16; scope-boundary.md Operator-Stated Scope.
- **Behavior impact:** Changing, and settled by the operator's answer "go with recommendation" to option (a). Run
  inside 3pitor, the skill makes no commits, checks no links, does not reflow, and reports estimated word counts.
- **Rejected alternatives:**
  - Add shell, git, and non-post write tools (option b) — rejected by the operator.
  - Load the skill unchanged (option c) — rejected by the operator, because it stops at its first step.
- **Revisit criterion:** The operator reinstates option (b), or asks for a real word count.
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** D-7, D-12
- **Referenced in plan:** Target State, Surface Delta (S-14), Behavior Changes

### D-7: The skill's session log and learned lessons are ordinary posts in the workspace

- **Question:** Where do the skill's pairing record (used to resume) and its learned lessons live, when the AI can only
  change `.md` posts and the bundled lessons file is read-only?
- **Decision:**
  - **Session log.** The skill keeps it as a workspace post at `pairing/{YYYY-MM-DD}-{slug}-content-edit.md`. It holds
    the same sections as before: `## Request`, `## Initial lessons pass`, `## Plan (proposed)`, `## Feedback log`, and
    `## Close`.
  - **Resume.** The skill finds records with `Glob pairing/*{slug}*.md`, and resumes the newest one that has no
    `## Close`.
  - **Lessons.** The skill reads the bundled `references/editing-lessons.md` and, when present, the workspace's
    `editing-lessons.md`. It writes accepted general lessons only to the workspace's `editing-lessons.md`, creating it
    with a `# Content-editing lessons` heading when absent. New IDs count up from the highest ID in both files and in
    any series notes.
  - **Series lessons.** They still go to the series `README.md`.
  - **Saving.** All of these appear in the editor unsaved, and the writer saves them.
- **Rationale:** The operator chose to keep these files (answer: "go with recommendation" to option A). `Write` and
  `Edit` already accept `.md` posts outside dot-folders, so this needs no new AI ability.
- **Evidence:** operator's answer; C-7 (`resolvePost`).
- **Behavior impact:** Changing, and settled by the operator's answer.
  - The record moves from `.han/pairing/` to `pairing/`.
  - Learned lessons collect per workspace rather than in the skill's own file.
- **Rejected alternatives:**
  - Keep nothing on disk and hand lessons back as paste-ready text (option B) — rejected by the operator.
  - Allow writes to a dot-folder such as `.3pitor/` — rejected because it widens `resolvePost`, which the scope boundary
    excludes.
- **Revisit criterion:** The operator wants learned lessons shared across workspaces.
- **Dissent (if any):** None.
- **Settles delta entry:** S-14
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Behavior Changes, Risks

### D-8: A `Highlight` tool that verifies each quote with one matching function shared by server and UI

- **Question:** How does the model say "these passages in this post", and how do the server and the editor agree on
  where a passage is, given that markdown text and editor text differ (C-13)?
- **Decision:**
  - **Shared matcher.** New `src/shared/passages.ts`, with no imports:
    ```ts
    export interface QuoteMatch { block: number; from: number; to: number } // offsets into blocks[block]
    // Normalizes both sides the same way before comparing: runs of whitespace become one space; ‘ ’ become ' and
    // “ ” become "; the characters * _ ` are dropped. Offsets refer to the un-normalized block text. A quote never spans
    // two blocks. Returns every match.
    export function findQuote(blocks: string[], quote: string): QuoteMatch[]
    ```
  - **Block text.** This is the `textContent` of each ProseMirror textblock, in document order: paragraphs, headings,
    list-item paragraphs, and code blocks. The server computes it with `postBlocks(markdown: string): string[]` in
    `tools.ts`, using `defaultMarkdownParser`. The editor computes it with
    `blocksOf(doc: Node): { text: string; pos: number }[]` in `markdown-editor.tsx`.
  - **Tool.** New `Highlight` in `fileTools`:
    ```ts
    inputSchema: z.object({
      file_path: z.string(),
      passages: z.array(z.object({ quote: z.string().min(1), label: z.string().min(1).optional() })).min(1),
    })
    // input:  { "file_path": "garden/draft.md",
    //           "passages": [{ "quote": "Most gardeners never test their soil", "label": "Q1" },
    //                        { "quote": "as I said earlier", "label": "Q2" }] }
    // output: "highlighted 2 passages in garden/draft.md"
    // error:  `"as I said earlier" is not in garden/draft.md`,
    //         `"the soil" appears 3 times in garden/draft.md; quote more of it`, or `label "Q1" is used twice`
    ```
  - **Resolving the post.** It uses the same rules as `Edit`: `postName`, then the turn's text, else the disk.
  - **Verifying.** It throws when any quote has zero matches or more than one in `postBlocks(text)`, or when two
    passages share a label.
  - **Replacing.** A successful call replaces the turn's highlights: `TurnTexts` gains
    `highlights?: SessionHighlights`.
  - **Model guidance.** The tool description tells the model to quote the text as the writer sees it, without
    markdown syntax, and within one paragraph, heading, or list item. It should use several passages for a longer span,
    and call Highlight after the turn's edits.
  - **Subagents.** They do not get the tool; `isAgentTool` allows only Read and Glob.
- **Rationale:**
  - One pure function on the same parser's block text means the server's "yes, that's there" and the editor's
    highlight cannot disagree.
  - The "exactly once" rule already governs `Edit`, and it gives the model feedback within the same turn.
  - `label` exists because the pairing brief's overview stop asks "questions keyed to its paragraphs". The label ties
    each question to its passage.
- **Evidence:**
  - C-13, C-14.
  - The architect's check V-1: `defaultMarkdownParser` runs under Bun and yields the same block text the editor shows.
  - Worked example: `"A para with *emph* and [a link](http://x)"` → `"A para with emph and a link"`.
- **Behavior impact:** Changing, and settled by the operator's request (D-11). Every chat turn offers the model a new
  `Highlight` tool, and it shows as a tool row in the chat.
- **Rejected alternatives:**
  - Quote raw markdown and map markdown offsets to editor positions — rejected because `prosemirror-markdown` gives no
    source map (C-13).
  - No server-side check — rejected because a quote the editor cannot place would fail silently, and the model would
    never learn.
  - Put the matcher in `markdown-support.ts` — rejected because that file answers a different question: which markdown
    the editor cannot hold.
  - **Worked `findQuote` offsets, pinned.** Offsets point into the original text, not the normalized one:
    ```ts
    findQuote(['Most gardeners  never test'], 'gardeners never') // → [{ block: 0, from: 5, to: 21 }]
    findQuote(['the “best” soil'], '"best"')                     // → [{ block: 0, from: 4, to: 10 }]
    ```
  - **Block parity, pinned.** For any markdown the editor can hold,
    `postBlocks(md)` equals `blocksOf(docFromMarkdown(md)).map((b) => b.text)`. A test asserts it (D-14).
  - **Caps.** No cap on the number of passages, and no cap on label length. The draft's caps of 12 were dropped in
    review: no evidence supported them (JD-006).
- **Revisit criterion:** Quotes that need to span blocks, or matching that proves too loose or too strict in real runs.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8, S-9
- **Dependent decisions:** D-9, D-10
- **Referenced in plan:** Target State, Surface Delta (S-8, S-9)

### D-9: Highlights ride on the turn-ending `data-session` part and replace the previous set

- **Question:** How do highlights cross from server to UI, and when do they clear?
- **Decision:**
  - **Wire.** In `src/shared/wire.ts`, which stays types only with no imports:
    ```ts
    export interface Passage { quote: string; label?: string }
    export interface SessionHighlights { file: string /* post name, as in `edited` */; passages: Passage[] }
    export interface SessionData { aborted: boolean; edited: Record<string, string>; highlights?: SessionHighlights }
    // { "aborted": false, "edited": { "garden/draft.md": "..." },
    //   "highlights": { "file": "garden/draft.md",
    //                   "passages": [{ "quote": "Most gardeners never test their soil", "label": "Q1" }] } }
    ```
  - **Server.** `Sessions.chat` writes `highlights: aborted ? undefined : turn.highlights`. The field is omitted when
    the turn made no successful Highlight call.
  - **Clearing, pinned:**
    - Every completed turn replaces the shown highlights with its own set, and a turn with none clears them.
    - A stopped or failed turn leaves them as they are.
    - Starting a new chat clears them.
- **Rationale:** `applyEdited` runs in `onFinish`, when the turn ends. Highlights that arrive in the same part are
  applied after the turn's edits, so they need no ordering logic. A separate part streamed mid-turn would arrive before
  the edits land.
- **Evidence:** C-10 (`data-session` in `sessions.ts`, `onFinish` in `chat.tsx`).
- **Behavior impact:** Preserving for existing consumers, because the field is optional. What becomes visible is
  covered by D-10.
- **Rejected alternatives:**
  - A new `data-highlight` part streamed as the tool runs — rejected because of the ordering against `applyEdited`
    described above.
  - A `HostEvent` over the WebSocket — rejected because highlights belong to one chat turn, and that stream already
    carries them.
  - Read the last successful `Highlight` tool part's input in the UI, with no server state or wire field (JD-003) —
    rejected for three reasons:
    - The tool's `file_path` is the model's raw path, such as `./garden/draft.md`, not the post name the server
      resolves.
    - `chat.tsx` reads parts untyped (`part: any`), so the tool name and input shape would become a second wire contract
      that `wire.ts` never types.
    - The server already holds the verified passages at the moment it writes `data-session`.
- **Revisit criterion:** A need to show highlights while a long turn is still running.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** D-10
- **Referenced in plan:** Target State, Surface Delta (S-10), Review Findings

### D-10: The editor draws highlights as decorations recomputed from quotes; `useDocuments` holds the quotes

- **Question:** Where does highlight state live, given that the editor view is destroyed on every file switch (C-12),
  and what happens when the writer types inside a highlighted passage?
- **Decision:**
  - **`useDocuments`.** It holds `highlights?: SessionHighlights`. New `showHighlights(h?: SessionHighlights)` sets or
    clears it, and shows `h.file` under the rule in D-16.
  - **Exposed value.** `useDocuments` exposes `highlights: Passage[]`, the passages when `highlights.file` is the
    current file and `[]` otherwise.
  - **`MarkdownEditor`.** It takes `{ doc, readOnly, highlights: Passage[] }`. A ProseMirror plugin keeps
    `{ decorations, shown, total }`.
  - **Recomputing from quotes.** It happens when the view mounts and when `highlights` changes. For each passage it
    runs `findQuote(blocksOf(doc).map((b) => b.text), quote)`. A single match gets decorations as pinned in D-15, and
    zero or several matches draw nothing.
  - **Mapping.** On every other document change, the existing decorations are mapped through the transaction
    (`DecorationSet.map`). A passage whose range collapses to nothing is dropped.
  - **Mount.** Seeding at mount means switching back to a file restores its highlights, wherever the quotes still
    match.
  - **Callback.** `Chat`'s `onTurnFinished` becomes `(data: SessionData) => void`. `app.tsx` calls
    `docs.applyEdited(data.edited)` then `docs.showHighlights(data.highlights)`. Starting a new chat calls
    `docs.showHighlights(undefined)`.
  - **Typing.** When the writer types inside a highlighted passage, the tint stretches or shrinks with the edit and
    stays, until the passage is deleted entirely. This changed in review (UX-007): recomputing on every keystroke would
    have erased the "Q1" marker while the writer was still answering Q1.
- **Rationale:** `useDocuments` already owns per-file state that outlives the view. Recomputing from quotes needs no
  position bookkeeping, and it survives remounts, typing, and merges.
- **Evidence:** C-11, C-12, C-14; UX-007.
- **Behavior impact:** Changing, and settled by the operator's request (D-11). Passages the AI names are tinted in the
  editor. D-16 covers switching to the highlighted post.
- **Rejected alternatives:**
  - Store positions only, and map them through transactions — rejected because positions are lost on every file
    switch (C-12). The quotes are what survive it; mapping is used only while a view is alive.
  - Recompute from quotes on every change (the draft's design) — rejected in review (UX-007) because typing a fix inside
    a passage would erase its label.
  - A schema mark written into the Yjs document — rejected because it would be serialized and saved into the post, or
    would need stripping (C-13, B16).
- **Revisit criterion:** A need for a "clear highlights" control, or for highlights in several posts at once.
- **Dissent (if any):** None.
- **Settles delta entry:** S-11, S-12, S-13
- **Dependent decisions:** D-15, D-16
- **Referenced in plan:** Target State, Surface Delta (S-11, S-12, S-13), Review Findings

### D-11: The visible behavior changes the operator's request asks for are committed without further escalation

- **Question:** Several entries change what a user sees in every chat. Do they need their own escalation at the
  behavior-preservation gate?
- **Decision:** No separate escalation. These entries are what the operator asked for:
  - every workspace lists `/collaborative-draft-editing` (S-3);
  - `3pitor://skills/` reads succeed (S-6);
  - the instructions list app skills (S-7);
  - a `Highlight` tool exists (S-9);
  - the editor switches files and draws highlights (S-12, S-13);
  - the chat's empty-state hint names the skill (S-16).

  The operator's own words are "i want all skills from this folder to be loaded and available for to use from the app"
  and "i want the editor UI to highlight the things it's talking about". They are listed in the plan's Behavior Changes
  section for the operator to read.
- **Rationale:** Each of these changes is the requested outcome itself, rather than a side effect of moving
  responsibility.
- **Evidence:** scope-boundary.md Stated Scope.
- **Behavior impact:** Changing (S-3, S-6, S-7, S-9, S-12, S-13, S-16).
- **Rejected alternatives:**
  - One escalation per entry — rejected because each would ask the operator to re-confirm the sentence they typed.
- **Revisit criterion:** The operator objects to any listed change on reading the plan.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-6, S-7, S-9, S-12, S-13, S-16
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes, Surface Delta (S-3, S-6, S-7, S-9, S-12, S-13, S-16)

### D-12: Remove `scripts/reflow.py`

- **Question:** What happens to the skill's reflow script, which the app cannot run?
- **Decision:** Delete `src/skills/collaborative-draft-editing/scripts/`. The macro embeds only `.md` files in any case.
- **Rationale:**
  - The app has no shell tool, and option (b) is out.
  - The editor's markdown serializer decides line layout when a post is saved, and soft wraps become spaces (V-1). A
    wrap width set by the skill would be undone on the next Save.
- **Evidence:** C-6, C-7; architect's V-1.
- **Behavior impact:** Changing, and settled by the operator's option (a), which drops or replaces the shell steps.
- **Rejected alternatives:**
  - Keep the file unused — rejected because a script nothing can run misleads the next reader.
- **Revisit criterion:** The operator wants wrapped drafts, which would need a serializer change rather than a script.
- **Dissent (if any):** None.
- **Settles delta entry:** S-15
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta (S-15)

### D-14: Verification additions from the review round

- **Question:** Which checks does the plan need beyond each unit's own tests, so the plan's central claims are proven
  rather than assumed?
- **Decision:**
  1. **A block-parity test.** It feeds one markdown fixture through both `postBlocks(md)` and
     `blocksOf(docFromMarkdown(md))`, and asserts equal text arrays. The fixture mixes a heading, emphasis, a link,
     inline code, a soft-wrapped paragraph, a bullet list, and a code block. It lands in Unit 4, the first unit where
     both functions exist.
  2. **`findQuote` tests assert exact offsets** for the whitespace and curly-quote cases, using the worked values in
     D-8.
  3. **A new `make check-build` target.** It runs `make build`, starts `build/3pitor` from an empty temporary folder
     with `OPEN_BROWSER=0`, and fails unless `GET /api/workspace-config` lists `collaborative-draft-editing`. It is
     separate from `make test`, which stays fast.
  4. **The breaking-test list includes `agent.test.ts` "leaves the skills out of the instructions when the workspace
     has none".** Its premise stops existing, because app skills are always present. It becomes "lists the app skills
     when the workspace has none".
- **Rationale:**
  - The server and editor agree on a passage only if they split the post into the same blocks, and only a comment said
    they would (JD-001, TE item 4).
  - An offset test that checks only "a match exists" cannot catch broken remapping (TE item 2).
  - The compiled binary is the operator's hard requirement, and nothing ran it automatically (TE item 1; C-18, C-19).
- **Evidence:** junior-developer JD-001; test-engineer items 1, 2, 4 and its breaking-test list; C-18, C-19.
- **Behavior impact:** Preserving. These are tests and one build target, and add no runtime behavior.
- **Rejected alternatives:**
  - A manual binary check written in the plan's prose — rejected because it is the only guard on D-2's premise, and a
    manual step gets skipped.
  - A UI test that the `Highlight` tool row renders — rejected as YAGNI: the tool-row rendering is generic and untouched.
    Reopen if `chat.tsx` grows Highlight-specific rendering.
- **Revisit criterion:** A CI setup appears, and `check-build` should run there.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3 (migration), S-17
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta (S-3, S-17), Review Findings

### D-15: How highlights look, and how the chat and editor stay linked

- **Question:** How does the writer find each passage and match it to the chat's question, in both themes, with a
  screen reader, and in forced-colors mode?
- **Decision:**
  - **Decorations.** Each matched passage gets two:
    - `Decoration.inline(from, to, { nodeName: 'mark', class: 'ai-highlight' })`;
    - when it has a label, `Decoration.widget(from, labelSpan, { side: -1 })`. `labelSpan` is a real
      `<span class="ai-highlight-label">Q1</span>` placed once at the passage start, not CSS-generated text.
  - **Colors.** They are new tokens in `styles.css`:
    - `--highlight: #fff1a8` in light;
    - `--highlight: #4d4000` in dark.

    `mark.ai-highlight` uses `background: var(--highlight); color: inherit;` plus a 2px `var(--accent)` underline, so
    the cue is not color alone. Under `@media (forced-colors: active)` it uses `background: Mark; color: MarkText`.
    The label chip uses `var(--accent)` on `var(--panel)`.
  - **Status line.** `MarkdownEditor` renders `<div class="highlight-status" aria-live="polite">`. It reads
    "Highlighted 2 of 3 passages" when there are highlights for the file, and is empty otherwise. That tells the
    writer, and a screen reader, that highlights arrived, and when one could not be placed.
  - **Scrolling.** When a new set of passages arrives, the editor scrolls the first drawn passage into view, unless
    the editor has focus.
  - **Labels.** Every passage in one `Highlight` call carries a distinct label, and the tool rejects duplicates (D-8).
    The skill starts each chat question with its label in bold, for example `**Q1** — …`.
  - **Re-issuing.** On any turn that talks about passages, even a side question, the skill calls `Highlight` again.
    Otherwise the completed turn clears them.
  - **Chat hint.** The chat's empty-state hint names the skill: "Type /collaborative-draft-editing to review a draft
    section by section."
- **Rationale:** Tinting a passage is not enough on its own. The writer has to find it, match it to a question, and
  notice when one is missing (UX-001 to UX-005, UX-008, UX-009; JD-002).
- **Evidence:** user-experience-designer UX-001 to UX-005, UX-008, UX-009; junior-developer JD-002. `--accent-soft`,
  the obvious reuse, measures about 1.18:1 against the panel in both themes, and it already marks the active menu item.
- **Behavior impact:** Changing, and settled under D-11. It is the requested "visual reference", made findable.
- **Rejected alternatives:**
  - `::before { content: attr(data-label) }` — rejected because an inline decoration spans text nodes, so the label
    could repeat mid-passage, and screen readers read generated content inconsistently (UX-004; Unverified in a
    browser).
  - Reuse `--accent-soft` for the tint — rejected on contrast and meaning, as above.
  - Clickable skill chips that insert into the composer, and showing `argument-hint` — deferred as YAGNI (UX-009).
- **Revisit criterion:** Writer feedback that highlights are hard to see or to match to questions.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9 (duplicate labels), S-13, S-14, S-16
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-13, S-16), Review Findings

### D-16: The editor moves to the highlighted post only if the writer has not moved since sending

- **Question:** When a turn ends with highlights in a post other than the one on screen, does the editor switch to it?
- **Decision:**
  - **Remembering.** `useDocuments` remembers the current file when a message is sent: `beginTurn` records it.
  - **The rule.** `showHighlights(h)` makes `h.file` current only when the current file is still the one recorded at
    send. It checks this again after loading `h.file` from disk, when the file was not yet open.
  - **Loading.** A post not yet open is loaded the way `open` loads it, without clearing `notApplied`.
  - **When the writer has moved.** The highlights are stored, and they appear when the writer opens that post.
- **Rationale:** In the skill's normal flow, the highlighted post is the draft already on screen, so nothing moves. The
  rule stops two things:
  - a turn end pulling the writer out of a post they moved to while it ran;
  - a reflexive Cmd+S saving the wrong file (UX-006, JD-005).
- **Evidence:** user-experience-designer UX-006; junior-developer JD-005; `documents.tsx` `applyEdited` ("Stay on the
  open file if the AI changed it").
- **Behavior impact:** Changing, settled under D-11.
  - A turn end can move the writer to the highlighted post, but only if they have not changed files since sending.
  - `applyEdited`'s own rule for which file to show is unchanged. Only `showHighlights`, which runs after it, can move
    the editor further.
- **Rejected alternatives:**
  - Always switch — rejected because it overrides the writer's own navigation (UX-006).
  - Never switch; offer a "show" link — rejected as more UI than the request needs, when the highlighted post is
    almost always already open.
- **Revisit criterion:** Writers report being moved unexpectedly, or missing highlights in another post.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta (S-11, S-12), Review Findings

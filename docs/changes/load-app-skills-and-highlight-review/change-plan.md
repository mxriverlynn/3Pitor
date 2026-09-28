# Change Plan: Load app skills and highlight review

## Why This Change

3pitor needs to ship its own skills and let the AI point at text in the editor. The operator added a
`collaborative-draft-editing` skill and wants every skill in `src/skills/` loaded, so typing
`/collaborative-draft-editing` in the chat runs it. That has to work in the compiled `build/3pitor` too.

When the skill asks the writer to review something, the editor should highlight the passages it is talking about.

The reason class is **a constraint arriving**: a new requirement the current structure cannot absorb. The source is the
operator's request, recorded in [artifacts/scope-boundary.md](artifacts/scope-boundary.md) with their confirmation
answers.

## What Changes, In One Paragraph

After this change, 3pitor carries a set of built-in skills inside its own build, next to whatever skills a workspace
defines. The AI can read a built-in skill's files through a special path that never touches the user's folder. The AI
also gains one new ability: it can name passages in a post for the writer to look at. The server checks that each
passage is really there, and the editor tints those passages until the next turn replaces them.
`collaborative-draft-editing` is rewritten to work within the app's tools. It runs its section-by-section review in the
chat, keeps its session log and learned lessons as ordinary posts, and highlights what each stop discusses.

## Current State

Skills come from one place today, the workspace's `.claude/skills/` folder
([C-1](artifacts/current-state-findings.md#c-1-skill-discovery-scans-one-root-the-workspaces-claudeskills)). The model
reaches a skill by `Read`ing the path listed in its instructions
([C-2](artifacts/current-state-findings.md#c-2-skillpath-is-workspace-relative-and-goes-into-the-system-prompt-verbatim)).
`Read` refuses anything outside the workspace
([C-4](artifacts/current-state-findings.md#c-4-read-refuses-every-path-outside-the-workspace-by-design-and-by-test)).

The compiled binary cannot read a file through a computed path, and the shipped build already crashes on that for its
fixtures ([C-18](artifacts/current-state-findings.md#c-18-the-compiled-binary-cannot-read-files-through-computed-paths)).

A Bun bundle-time macro can inline a whole folder in both dev and compiled runs
([C-19](artifacts/current-state-findings.md#c-19-a-bun-bundle-time-macro-can-embed-a-whole-folder-in-dev-and-in-the-compiled-binary)).
A macro is a function Bun runs while bundling, whose return value is written into the output.

The new skill was written for Claude Code
([C-7](artifacts/current-state-findings.md#c-7-the-new-skill-is-written-for-claude-code-and-depends-on-things-this-app-does-not-have)).
It hands its loop to another skill, runs shell and git commands, and writes files the app's AI cannot write. The app's
AI has only Read, Write, Edit, Glob, and Task
([C-6](artifacts/current-state-findings.md#c-6-the-models-tools-are-read-write-edit-glob-and-task-with-no-shell-grep-or-skill-tool)).

The folder it sits in is misspelled `src/skillls/`
([C-8](artifacts/current-state-findings.md#c-8-the-skill-folder-is-misspelled-on-disk)).

Nothing in the app can mark text in the editor yet. The editor takes only a document and a read-only flag
([C-11](artifacts/current-state-findings.md#c-11-the-editor-takes-only-doc-and-readonly-and-has-no-decoration-plugin)).
Its view is destroyed on every file switch
([C-12](artifacts/current-state-findings.md#c-12-the-editor-view-is-destroyed-and-rebuilt-on-every-file-switch)).
Markdown text and the text the editor shows differ, so a markdown substring does not map straight to an editor position
([C-13](artifacts/current-state-findings.md#c-13-no-shared-way-to-find-a-passage-markdown-text-and-editor-text-differ)).

## Target State

The target has four parts: built-in skills, reading them, highlighting, and the adapted skill.

### Built-in skills are embedded at build time and merged into the skills list

`src/skills/` holds the app's skills. A macro embeds every `.md` file under it into the server bundle
([D-2](artifacts/change-decision-log.md#d-2-embed-every-skill-file-with-a-bundle-time-macro)). `loadWorkspaceConfig`
lists those skills after the workspace's own, and a workspace skill with the same name replaces the built-in one
([D-5](artifacts/change-decision-log.md#d-5-app-skills-merge-into-loadworkspaceconfig-a-workspace-skill-wins-on-a-name-clash)).
The Agent panel and the model's instructions pick them up with no other change.

```ts
// src/server/app-skills.macro.ts — runs when Bun bundles or transpiles; keys are relative to src/skills/
export function appSkillFiles(): Record<string, string>
// { "collaborative-draft-editing/SKILL.md": "---\nname: collaborative-draft-editing\n...",
//   "collaborative-draft-editing/references/editing-lessons.md": "...",
//   "collaborative-draft-editing/references/pairing-brief.md": "..." }

// src/server/workspace-config.ts
import { appSkillFiles } from './app-skills.macro' with { type: 'macro' };
function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } | undefined
// loadWorkspaceConfig(workspace) → skills = [...workspaceSkills, ...APP_SKILLS not named by a workspace skill], by name
```

### The AI reads built-in skill files through `3pitor://skills/`

A built-in skill's path starts with `3pitor://skills/`. `Read` checks for that prefix first and serves the embedded text
([D-3](artifacts/change-decision-log.md#d-3-app-skill-files-are-read-through-a-3pitorskills-path-outside-the-workspace-boundary)).
The workspace boundary for the user's files does not change. `Write` and `Edit` still refuse these paths, so built-in
skill files are read-only.

Typing `/name` stays a convention the instructions state
([D-4](artifacts/change-decision-log.md#d-4-no-slash-command-parser-name-stays-a-prompt-convention)).

```ts
// src/server/workspace-config.ts
export const APP_SKILL_PREFIX = '3pitor://skills/';
// undefined without the prefix; the embedded text when found; throws `${filePath} does not exist` otherwise.
// The rest of the path is normalized with node:path/posix normalize, and a result starting with '..' is not found.
export function appSkillText(filePath: string): string | undefined
```

Worked example: `Read({ file_path: "3pitor://skills/collaborative-draft-editing/references/editing-lessons.md" })`
returns the embedded lessons text.

### The AI highlights passages, and the server checks them before the editor draws them

The AI calls a new `Highlight` tool with a post and the passages to show. The server finds each quote with a matching
function shared with the editor, and fails the call if any quote is missing or appears more than once
([D-8](artifacts/change-decision-log.md#d-8-a-highlight-tool-that-verifies-each-quote-with-one-matching-function-shared-by-server-and-ui)).
The turn's last successful Highlight call travels to the browser in the part that ends the turn
([D-9](artifacts/change-decision-log.md#d-9-highlights-ride-on-the-turn-ending-data-session-part-and-replace-the-previous-set)).
The editor tints each passage, recomputing from the quotes whenever the text changes
([D-10](artifacts/change-decision-log.md#d-10-the-editor-draws-highlights-as-decorations-recomputed-from-quotes-usedocuments-holds-the-quotes)).

These are the contracts both sides build against:

```ts
// src/shared/passages.ts — no imports
export interface QuoteMatch { block: number; from: number; to: number } // offsets into blocks[block]
// Normalizes both sides before comparing: whitespace runs → one space; ‘ ’ → ' and “ ” → "; drops * _ `.
// Offsets refer to the un-normalized block text. A quote never spans two blocks. Returns every match.
export function findQuote(blocks: string[], quote: string): QuoteMatch[]
findQuote(['Most gardeners  never test'], 'gardeners never') // → [{ block: 0, from: 5, to: 21 }]
findQuote(['the “best” soil'], '"best"')                     // → [{ block: 0, from: 4, to: 10 }]

// src/shared/wire.ts — types only
export interface Passage { quote: string; label?: string }
export interface SessionHighlights { file: string; passages: Passage[] }
export interface SessionData { aborted: boolean; edited: Record<string, string>; highlights?: SessionHighlights }

// src/server/tools.ts
function postBlocks(markdown: string): string[] // textContent of each textblock from defaultMarkdownParser

// src/ui/markdown-editor.tsx
function blocksOf(doc: Node): { text: string; pos: number }[] // the same textblocks, walking the live document
// Parity, asserted by a test: postBlocks(md) equals blocksOf(docFromMarkdown(md)).map((b) => b.text)
```

The `Highlight` tool's input and output:

```json
{ "file_path": "garden/draft.md",
  "passages": [{ "quote": "Most gardeners never test their soil", "label": "Q1" },
               { "quote": "as I said earlier", "label": "Q2" }] }
```

- Success returns `highlighted 2 passages in garden/draft.md`.
- Failure throws one of three errors:
  - `"as I said earlier" is not in garden/draft.md`;
  - `"the soil" appears 3 times in garden/draft.md; quote more of it`;
  - `label "Q1" is used twice`.
- Schema: `passages` holds at least one item, `quote` is non-empty, and `label`, when given, is non-empty.

The turn-ending part then carries:

```json
{ "aborted": false, "edited": { "garden/draft.md": "..." },
  "highlights": { "file": "garden/draft.md",
                  "passages": [{ "quote": "Most gardeners never test their soil", "label": "Q1" }] } }
```

In the browser, highlights behave this way:

- **Where they live.** `useDocuments` holds the highlights.
- **Switching posts.** When a turn ends, the editor moves to the highlighted post only if the writer has not changed
  files since sending ([D-16](artifacts/change-decision-log.md#d-16-the-editor-moves-to-the-highlighted-post-only-if-the-writer-has-not-moved-since-sending)).
- **What the editor gets.** It receives only the passages for the file it is showing.
- **When they clear.** A completed turn replaces them. A stopped or failed turn leaves them. A new chat clears them.
- **Typing.** Typing inside a highlighted passage stretches or shrinks its tint with the edit. The tint goes away only
  when the passage is deleted.

How they look and link to the chat is pinned too ([D-15](artifacts/change-decision-log.md#d-15-how-highlights-look-and-how-the-chat-and-editor-stay-linked)):

- **The tint.** Each passage is a `<mark class="ai-highlight">` with a yellow tint (`--highlight`, `#fff1a8` light and
  `#4d4000` dark) and a 2px accent underline. Forced-colors mode uses `Mark`/`MarkText`.
- **The label.** It is real text in a chip at the start of the passage.
- **The status line.** An `aria-live` line in the editor reads "Highlighted 2 of 3 passages".
- **Scrolling.** The first passage scrolls into view, unless the writer is typing in the editor.
- **Matching the chat.** Labels are unique within a call, and the skill starts each chat question with its label, such
  as `**Q1** — …`.

### `collaborative-draft-editing` runs inside the app

The skill keeps its three phases: a lessons pass, a paired section-by-section review, and proposing new lessons. It
changes how it does them
([D-6](artifacts/change-decision-log.md#d-6-adapt-collaborative-draft-editing-to-the-apps-tools-rather-than-grow-tools-for-it)):

- **The review loop.** It runs the loop itself, one piece per turn, ending each turn on a question.
- **Highlights.** Every stop ends with a `Highlight` call, labeled to match the stop's questions. Each question starts
  with its label, and any turn that talks about passages highlights them again.
- **Fresh text.** Each turn re-reads the draft before quoting or editing it.
- **Shell and git steps.** It drops shell, git, link-checking, and reflow steps, and estimates word counts instead.

Its session log and its learned lessons are workspace posts
([D-7](artifacts/change-decision-log.md#d-7-the-skills-session-log-and-learned-lessons-are-ordinary-posts-in-the-workspace)):

- `pairing/{YYYY-MM-DD}-{slug}-content-edit.md` is the session log, and resuming finds it again.
- `editing-lessons.md` at the workspace root receives accepted lessons. It is read alongside the bundled lessons.

The writer saves both like any post. The reflow script is deleted
([D-12](artifacts/change-decision-log.md#d-12-remove-scriptsreflowpy)).

## Surface Delta

### S-1: `src/skillls/` — Renamed

**Target state.** The app's skills live in `src/skills/`. `src/skillls/` does not exist.

**Behavior.** Preserving. No code references either name
([C-8](artifacts/current-state-findings.md#c-8-the-skill-folder-is-misspelled-on-disk)).

**Why.** The operator confirmed the folder name is a typo.

**Decision.** [D-1](artifacts/change-decision-log.md#trivial-decisions)

### S-2: `src/server/app-skills.macro.ts` `appSkillFiles` — Added

**Target state.** `appSkillFiles(): Record<string, string>` exists. When Bun bundles or transpiles its importer, it
returns the text of every `.md` file under `src/skills/`, keyed by the path relative to that folder. It is imported only
`with { type: 'macro' }`.

**Behavior.** Preserving. Nothing observable changes until S-3 reads it.

**Why.** The skills must be inside the compiled executable, and a computed-path read fails there (C-18, C-19).

**Depends on.** S-1.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-embed-every-skill-file-with-a-bundle-time-macro)

### S-3: `loadWorkspaceConfig` — Re-scoped

**Target state.** `loadWorkspaceConfig(workspace)` returns the workspace's skills plus the app's skills from
`APP_SKILL_FILES`, sorted by name. Each name appears once, and a workspace skill replaces an app skill of the same name.
An app skill's `path` is `3pitor://skills/<name>/SKILL.md`, and a malformed app `SKILL.md` is skipped. Agents are
unchanged. The comment on `Skill.path` says it is workspace-relative or starts with `APP_SKILL_PREFIX`.

**Behavior.** Changing. Every workspace's Agent panel and every chat's instructions now list
`collaborative-draft-editing`. Settled by the operator's request
([D-11](artifacts/change-decision-log.md#d-11-the-visible-behavior-changes-the-operators-request-asks-for-are-committed-without-further-escalation)).

**Why.** "All skills from this folder" must be listed where the panel and the instructions already look (C-1, C-9).

**Depends on.** S-2, S-4, S-5.

**Migration.** Six tests change:

- the four `workspace-config` tests that expect `skills: []` or an exact skills list, in `workspace-config.test.ts`
  and `workspace-config.routes.test.ts`, include the app skill;
- `agent.test.ts` "leaves the skills out of the instructions when the workspace has none" becomes "lists the app skills
  when the workspace has none", because the skills list is never empty now ([D-14](artifacts/change-decision-log.md#d-14-verification-additions-from-the-review-round));
- `agent.test.ts`'s exact-instructions test changes under S-7.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-app-skills-merge-into-loadworkspaceconfig-a-workspace-skill-wins-on-a-name-clash)

### S-4: `parseFrontmatter` — Added

**Target state.** `parseFrontmatter(text)` in `workspace-config.ts` splits YAML frontmatter from the body. It returns
`undefined` when the frontmatter is missing, unclosed, or unparsable. `readMarkdown` reads the file and calls it.

**Behavior.** Preserving. Workspace files parse exactly as before.

**Why.** Embedded text and disk files need the same parsing.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-app-skills-merge-into-loadworkspaceconfig-a-workspace-skill-wins-on-a-name-clash)

### S-5: `APP_SKILL_PREFIX` and `appSkillText` — Added

**Target state.** `APP_SKILL_PREFIX = '3pitor://skills/'` and `appSkillText(filePath)` exist in `workspace-config.ts`.
The function has three outcomes:

- It returns `undefined` for a path without the prefix.
- It returns the embedded text for a known file.
- It throws `${filePath} does not exist` otherwise. That includes a normalized path that climbs out with `..`.

It never reads the disk.

**Behavior.** Preserving on its own. S-6 is where it becomes visible.

**Why.** The model needs a way to read an app skill's files that does not widen the workspace boundary (C-4).

**Depends on.** S-2.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-app-skill-files-are-read-through-a-3pitorskills-path-outside-the-workspace-boundary)

### S-6: `Read` tool — Re-scoped

**Target state.** `Read` returns `appSkillText(file_path)` when it is defined. Otherwise it behaves exactly as before:
it serves posts from the turn's copy and other workspace files from disk, and it refuses paths outside the workspace.

**Behavior.** Changing, narrowly. A `Read` of a `3pitor://skills/…` path returns bundled text where it used to fail.
Settled by the operator's request
([D-11](artifacts/change-decision-log.md#d-11-the-visible-behavior-changes-the-operators-request-asks-for-are-committed-without-further-escalation)).

**Why.** Without it, every app skill file is unreadable (C-4).

**Depends on.** S-5.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-app-skill-files-are-read-through-a-3pitorskills-path-outside-the-workspace-boundary)

### S-7: `instructionsFor` — Re-scoped

**Target state.** The instructions list every skill, workspace and app, under the heading "Skills". They keep the `/<name>`
convention, and add: "Links inside a skill are relative to its SKILL.md's folder; Read them with the same prefix." The
base text also tells the model that `Highlight` exists for pointing the writer at passages.

**Behavior.** Changing. Every chat's instructions text differs. Settled by the operator's request
([D-11](artifacts/change-decision-log.md#d-11-the-visible-behavior-changes-the-operators-request-asks-for-are-committed-without-further-escalation)).

**Why.** The model must learn that app skills exist and how to reach their files (C-2, C-3).

**Depends on.** S-3.

**Migration.** `agent.test.ts` expectations on the exact instructions string change.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-no-slash-command-parser-name-stays-a-prompt-convention)

### S-8: `src/shared/passages.ts` `findQuote` — Added

**Target state.** `findQuote(blocks, quote)` returns every `{ block, from, to }` where `quote` occurs inside a single
block. Both sides are normalized the same way before comparing: whitespace runs become one space, curly quotes become
straight ones, and `* _` and backticks are dropped. Offsets refer to the original block text. The file has no imports.

**Behavior.** Preserving. It is new code with no callers until S-9 and S-13.

**Why.** The server's check and the editor's highlight must agree on where a passage is (C-13).

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-a-highlight-tool-that-verifies-each-quote-with-one-matching-function-shared-by-server-and-ui)

### S-9: `Highlight` tool, `postBlocks`, and `TurnTexts.highlights` — Added

**Target state.** `fileTools` returns a fifth tool, `Highlight`, with the input schema and messages pinned in Target
State.

- **Resolving the post.** It uses the same rules as `Edit`: the turn's text, else the disk.
- **Verifying.** It checks every quote with `findQuote(postBlocks(text), quote)`, and throws unless each quote has
  exactly one match. It also throws when two passages share a label.
- **Replacing.** On success, it replaces `turn.highlights`.

`postBlocks(markdown)` returns the `textContent` of each textblock from `defaultMarkdownParser`. `TurnTexts` gains
`highlights?: SessionHighlights`. Subagents never get `Highlight`.

**Behavior.** Changing. Every turn offers the model a new tool, and its calls show as tool rows in the chat. Settled by
the operator's request
([D-11](artifacts/change-decision-log.md#d-11-the-visible-behavior-changes-the-operators-request-asks-for-are-committed-without-further-escalation)).

**Why.** The operator wants the editor to "highlight the things it's talking about".

**Depends on.** S-8, S-10.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-a-highlight-tool-that-verifies-each-quote-with-one-matching-function-shared-by-server-and-ui)

### S-10: `SessionData.highlights`, `SessionHighlights`, `Passage` — Added

**Target state.** `wire.ts` defines `Passage` and `SessionHighlights`, and `SessionData` has an optional `highlights`.
`Sessions.chat` sets it to the turn's highlights when the turn was not stopped and made a successful Highlight call.
Otherwise it leaves the field out.

**Behavior.** Preserving for today's consumers, because the field is optional and absent unless `Highlight` ran.

**Why.** Highlights reach the browser with the turn's edits, in the same `onFinish`.

**Depends on.** S-9 lands in the same unit.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-highlights-ride-on-the-turn-ending-data-session-part-and-replace-the-previous-set)

### S-11: `Chat` prop `onTurnFinished` — Re-scoped

**Target state.** `onTurnFinished(data: SessionData)` receives the whole turn-ending data, not only `edited`. It is
still called only for a turn that ran to its end. `app.tsx` calls `docs.applyEdited(data.edited)` then
`docs.showHighlights(data.highlights)`. Starting a new chat calls `docs.showHighlights(undefined)`.

**Behavior.** Preserving for edits: `applyEdited` receives the same value at the same moment, and applies the same
rule for which file to show. `showHighlights`, which runs after it, can then move the editor further. That is the
observable change, and S-12 covers it ([D-16](artifacts/change-decision-log.md#d-16-the-editor-moves-to-the-highlighted-post-only-if-the-writer-has-not-moved-since-sending)).

**Why.** The highlights travel in the same part as the edits.

**Depends on.** S-10, S-12.

**Migration.** `chat.test.tsx` assertions on the callback's argument expect `SessionData`.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-the-editor-draws-highlights-as-decorations-recomputed-from-quotes-usedocuments-holds-the-quotes)

### S-12: `useDocuments` `showHighlights` and `highlights` — Added

**Target state.** `useDocuments` holds the latest `SessionHighlights`.

- **Clearing.** `showHighlights(undefined)` clears them.
- **Setting.** `showHighlights(h)` stores `h`. It makes `h.file` the current file only when the current file is the
  one `beginTurn` recorded at send. It checks that again after loading a file that was not yet open. A file not yet
  open is loaded from disk the way `open` loads it, without clearing `notApplied`.
- **Exposed value.** The hook exposes `highlights: Passage[]`, the passages when they belong to the current file and
  `[]` otherwise.

**Behavior.** Changing. At the end of a turn that highlighted a post, the editor shows that post, unless the writer
changed files while the turn ran ([D-16](artifacts/change-decision-log.md#d-16-the-editor-moves-to-the-highlighted-post-only-if-the-writer-has-not-moved-since-sending)). Settled by the operator's request
([D-11](artifacts/change-decision-log.md#d-11-the-visible-behavior-changes-the-operators-request-asks-for-are-committed-without-further-escalation)).

**Why.** The view is destroyed on file switch (C-12), and this hook already owns per-file state that outlives it.

**Depends on.** S-10.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-the-editor-draws-highlights-as-decorations-recomputed-from-quotes-usedocuments-holds-the-quotes), [D-16](artifacts/change-decision-log.md#d-16-the-editor-moves-to-the-highlighted-post-only-if-the-writer-has-not-moved-since-sending)

### S-13: `MarkdownEditor` `highlights` prop, highlight plugin, and `blocksOf` — Added

**Target state.** `MarkdownEditor` takes `{ doc, readOnly, highlights: Passage[] }`.

- **The plugin.** A ProseMirror plugin draws, for each passage that `findQuote` matches exactly once in
  `blocksOf(doc)`, an inline `mark.ai-highlight` decoration. When the passage has a label, it adds a widget
  decoration at its start holding `<span class="ai-highlight-label">`.
- **Recomputing.** It recomputes from the quotes when the view mounts and when `highlights` changes. On every other
  document change, it maps the existing decorations through the transaction and drops a passage whose range collapses.
- **Scrolling and status.** When new passages arrive, it scrolls the first drawn passage into view unless the editor
  has focus. It renders `<div class="highlight-status" aria-live="polite">` reading "Highlighted {shown} of {total}
  passages", which is empty when there are none.
- **`blocksOf(doc)`.** It returns each textblock's text and its start position, in document order.
- **Styling.** `styles.css` gains `--highlight`: `#fff1a8` in light, `#4d4000` in dark. `markdown-editor.css` styles
  the tint, the 2px `--accent` underline, the label chip, and a `forced-colors` rule.

**Behavior.** Changing. Passages are tinted. Settled by the operator's request
([D-11](artifacts/change-decision-log.md#d-11-the-visible-behavior-changes-the-operators-request-asks-for-are-committed-without-further-escalation)).

**Why.** The operator's "visual reference to what it's saying".

**Depends on.** S-8, S-12.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-the-editor-draws-highlights-as-decorations-recomputed-from-quotes-usedocuments-holds-the-quotes), [D-15](artifacts/change-decision-log.md#d-15-how-highlights-look-and-how-the-chat-and-editor-stay-linked)

### S-14: `collaborative-draft-editing` skill — Re-scoped

**Target state.** `src/skills/collaborative-draft-editing/` holds a skill written for 3pitor's tools.

- **Frontmatter.** It has `name`, `description`, and `argument-hint`.
- **Its body.** It runs the lessons pass, then the paired review as its own loop with one piece per turn, then the
  lessons proposal.
- **Its references.** It reads `references/editing-lessons.md` and `references/pairing-brief.md` through
  `3pitor://skills/…`.
- **Highlights.** It ends every stop with `Highlight`, using a distinct label per passage, and starts each chat
  question with that label in bold. It highlights again on any turn that talks about passages, and re-reads the draft
  at the start of each turn.
- **What it writes.** It keeps its session log at `pairing/{date}-{slug}-content-edit.md`, and writes accepted lessons
  to the workspace's `editing-lessons.md`.
- **What it no longer does.** It never calls a shell, git, `curl`, a reflow script, or another skill.

**Behavior.** Changing. Settled by the operator's answers: option (a) in the confirmation turn, and option (A) on where
the log and lessons live
([D-6](artifacts/change-decision-log.md#d-6-adapt-collaborative-draft-editing-to-the-apps-tools-rather-than-grow-tools-for-it),
[D-7](artifacts/change-decision-log.md#d-7-the-skills-session-log-and-learned-lessons-are-ordinary-posts-in-the-workspace)).

**Why.** As written, the skill stops on its first step inside 3pitor (C-7).

**Depends on.** S-6, S-9.

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-adapt-collaborative-draft-editing-to-the-apps-tools-rather-than-grow-tools-for-it)

### S-15: `src/skills/collaborative-draft-editing/scripts/reflow.py` — Removed

**Target state.** The skill has no `scripts/` folder. Line layout is decided by the editor's serializer when the writer
saves.

**Behavior.** Changing. There is no reflow step. Settled by option (a)
([D-12](artifacts/change-decision-log.md#d-12-remove-scriptsreflowpy)).

**Why.** The app cannot run it, and a Save would undo any wrapping it did.

**Depends on.** S-14 lands in the same unit.

**Decision.** [D-12](artifacts/change-decision-log.md#d-12-remove-scriptsreflowpy)

### S-16: `Chat` empty-state hint — Re-scoped

**Target state.** Before the first message, the chat's hint also says "Type /collaborative-draft-editing to review a
draft section by section."

**Behavior.** Changing. A new chat shows one more sentence. Settled under [D-11](artifacts/change-decision-log.md#d-11-the-visible-behavior-changes-the-operators-request-asks-for-are-committed-without-further-escalation).

**Why.** The skill is otherwise findable only as a chip in the Agent panel (UX-009).

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-how-highlights-look-and-how-the-chat-and-editor-stay-linked)

### S-17: `make check-build` — Added

**Target state.** `make check-build` does four things:

1. builds `build/3pitor`;
2. starts it from an empty temporary folder with `OPEN_BROWSER=0`;
3. requests `GET /api/workspace-config`;
4. fails unless the response lists `collaborative-draft-editing`.

`make test` does not run it.

**Behavior.** Preserving. It is a developer command, and adds no runtime behavior.

**Why.** The skills being inside the executable is a hard requirement, and nothing checked the binary automatically
(C-18, C-19).

**Depends on.** S-3.

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-verification-additions-from-the-review-round)

## Behavior Changes

Every change a person can see was asked for by the operator. None is a side effect of moving code
([D-11](artifacts/change-decision-log.md#d-11-the-visible-behavior-changes-the-operators-request-asks-for-are-committed-without-further-escalation)).

- **The Agent panel lists `/collaborative-draft-editing` in every workspace** (S-3). Typing it in the chat starts the
  skill (S-6, S-7). A workspace that defines its own `collaborative-draft-editing` skill uses that one instead.
- **The chat can show a `Highlight` tool row** (S-9). When a turn ends, the editor tints each passage in yellow with an
  underline and a label chip, and says "Highlighted 2 of 3 passages" (S-13).
- **The editor can move to the highlighted post** (S-12). It does so only if the writer has not changed files since
  sending, and it scrolls the first passage into view unless the writer is typing.
- **Highlights last until the next completed turn.** That turn replaces them, and a new chat clears them. Typing inside
  a passage keeps its tint.
- **A new chat's hint names `/collaborative-draft-editing`** (S-16).
- **The skill behaves differently from its Claude Code version** (S-14, S-15). The operator chose this in the
  confirmation turn and in the log-and-lessons question:
  - it makes no commits, checks no links, and does not rewrap lines;
  - it gives word counts as estimates;
  - it keeps its log in `pairing/` and learned lessons in `editing-lessons.md`, both as unsaved posts the writer saves.

## Change Units

### Unit 1: Rename the skill folder

**What it does.** Moves `src/skillls/` to `src/skills/` with `git mv`.

**Delta entries.** S-1.

**How you know it worked.** `make test` passes, and nothing references `skillls`.

### Unit 2: Embed and list the app's skills

**What it does.** This unit adds:

- the macro;
- shared frontmatter parsing;
- the app-skills list merged into `loadWorkspaceConfig`;
- the `3pitor://skills/` read path;
- the new instructions wording.

It updates the README ([D-13](artifacts/change-decision-log.md#trivial-decisions)). The skill is listed and readable
after this unit, though it still describes Claude Code steps until Unit 5.

**Delta entries.** S-2, S-3, S-4, S-5, S-6, S-7 (the `Highlight` sentence in S-7 lands with Unit 3), S-17.

**Ordering constraint.** After Unit 1, because the macro globs `src/skills/`.

**How you know it worked.**

- A test asserts that `APP_SKILL_FILES` equals a fresh read of `src/skills/**/*.md` on disk.
- `loadWorkspaceConfig` tests cover three cases: an app skill is listed in an empty workspace, a workspace skill of
  the same name wins, and a malformed app `SKILL.md` is skipped.
- `tools.test.ts` covers three cases: `Read` of `3pitor://skills/…` returns the text, `3pitor://skills/../x` and
  unknown files throw, and the "outside the workspace" tests still pass.
- `make check-build` passes (S-17): the compiled binary, run from an empty folder, lists
  `collaborative-draft-editing`.
- The six changed tests listed under S-3's Migration pass in their new form.

### Unit 3: Server-side highlights

**What it does.** This unit adds:

- `src/shared/passages.ts`;
- the `Highlight` tool with `postBlocks`;
- `TurnTexts.highlights`;
- the wire types;
- the `highlights` field on `data-session`;
- the instructions sentence about `Highlight`.

**Delta entries.** S-8, S-9, S-10, and the rest of S-7.

**How you know it worked.**

- `findQuote` unit tests cover each of these, asserting exact `from` and `to` values, including the two worked
  examples in Target State:
  - an exact match;
  - emphasis and code removed;
  - curly quotes;
  - a soft wrap;
  - two matches;
  - no match;
  - no match across blocks.
- `Highlight` tests cover five cases:
  - success replaces `turn.highlights`;
  - a missing quote throws;
  - a repeated quote throws;
  - a duplicate label throws;
  - a post edited earlier in the same turn is checked against its edited text.
- A `sessions.test.ts` case shows three results: `highlights` in `data-session` for a completed turn, absent for a
  stopped one, and absent for a turn with no Highlight call.

### Unit 4: Editor highlights

**What it does.** This unit adds:

- the highlight plugin, `blocksOf`, and the status line;
- the `highlights` prop;
- `showHighlights` in `useDocuments`, and the file `beginTurn` records;
- the `onTurnFinished` signature change;
- the wiring in `app.tsx`, including "New chat";
- the highlight colors;
- the empty-state hint.

**Delta entries.** S-11, S-12, S-13, S-16.

**Ordering constraint.** After Unit 3, because it needs the wire types and `findQuote`.

**How you know it worked.** UI tests (happy-dom) cover each of these:

- the block-parity test: `postBlocks(md)` equals `blocksOf(docFromMarkdown(md))` texts for a fixture mixing a heading,
  emphasis, a link, inline code, a soft wrap, a list, and a code block;
- a highlighted passage renders as `mark.ai-highlight` with one label chip, and the status line reads "Highlighted 1 of
  1 passages";
- a passage whose quote no longer matches is not drawn, and the status counts it as missing;
- the highlight comes back after switching files away and back;
- typing inside the passage keeps its tint, and deleting the whole passage removes it;
- the editor moves to the highlighted post only when the writer has not changed files since sending;
- a completed turn with no highlights clears them;
- a stopped turn keeps them;
- `showHighlights` for a file not yet open loads and shows it without clearing the "could not apply" notices.

### Unit 5: Adapt `collaborative-draft-editing`

**What it does.** Rewrites `SKILL.md` and `references/pairing-brief.md` to D-6 and D-7, and deletes `scripts/`.

**Delta entries.** S-14, S-15.

**Ordering constraint.** After Units 2–4, because the skill depends on `3pitor://skills/` and `Highlight`.

**How you know it worked.**

- A new `bun run check` scenario sends `/collaborative-draft-editing` with a small draft open. It needs an API key.
- The first turn reads the skill through `3pitor://skills/`.
- The turn ends with a question that starts with a bold label, and with a `data-session` carrying `highlights` for the
  draft.
- No tool call names a shell, git, or `.han/` path.
- A manual run through one section in the browser shows the tinted passages matching the stop's labels.

## Risks

- **The macro might behave differently in this repo than in the scratch test.** `--production` minification or Bun's
  transpiler cache may change the result (C-19, Unverified). Unit 2's embed test and the compiled-binary check catch
  it before anything else builds on it.
- **An edited skill needs a restart in dev.** The macro runs when the server's code is bundled or transpiled, so editing
  `src/skills/` needs a server restart in dev, and a rebuild for the binary. A restart is enough: added and edited
  skill files showed up on the next start, including through Bun's transpiler cache ([C-20](artifacts/current-state-findings.md#c-20-a-restart-picks-up-added-and-edited-macro-inputs)). It is still easy
  to forget while writing a skill.
- **The model may quote text that does not match.** It may quote from stale memory or include markdown. The server
  rejects those quotes and the model can retry within the turn. If the writer changes a quoted passage while a turn
  runs, the editor's status line shows the gap, for example "Highlighted 1 of 2 passages". The skill's "re-read at the start of every turn" rule
  reduces this (C-14). Only the word "error" shows in the chat when it happens
  ([C-15](artifacts/current-state-findings.md#c-15-a-failed-tool-call-shows-only-the-word-error)).
- **A long stop can hit the 20-step turn limit and end silently**
  ([C-16](artifacts/current-state-findings.md#c-16-hitting-the-20-step-limit-looks-like-a-normal-finish)). The skill's
  one-`Write` lessons pass keeps the first turn short. A stop that ends with no question is the sign.
- **Mapped highlights may drift during a large AI merge.** A merge can replace a whole block, which can collapse a
  mapped highlight. That only matters for highlights from an earlier turn, because each turn's own highlights are
  recomputed from the quotes after its edits merge. Unverified: how y-prosemirror's remote transactions map
  decorations was not inspected.
- **A saved session log disappears from the Documents list after a reload.** The Documents list shows only posts at the
  workspace root (`documents.routes.ts` globs `*.md`), so `pairing/…` does not show. The file is still on disk, and
  the skill still finds it to resume.
- **Lesson IDs could collide.** New lesson IDs must count above the bundled file, the workspace file, and series notes.
  A collision would only confuse the lesson list; it breaks nothing.

## Deferred (YAGNI)

- **A `/name` parser on the client or server.** The prompt convention already works for `/doc-stats`. Reopen when a
  check scenario or real run shows the model missing `/collaborative-draft-editing`.
- **Honoring a skill's `allowed-tools`.** There is one app skill and no tool to restrict. Reopen when a second app skill
  needs a narrower toolset.
- **A "clear highlights" control, or highlights in several posts at once.** Nobody has asked for them. Reopen on writer
  feedback.
- **Clickable skill chips and a visible `argument-hint`.** The hint line in S-16 covers discovery for one skill. Reopen
  if the writer mistypes the command or asks what argument it takes.
- **A UI test for the `Highlight` tool row.** The tool-row rendering is generic and untouched. Reopen if `chat.tsx`
  grows Highlight-specific rendering.
- **Streaming highlights mid-turn.** The tool row already signals that highlights are coming (UX-010). Reopen if
  writers look for tints before the turn ends.
- **A word-count tool.** There is one consumer, and it can estimate. Reopen if estimates mislead in real runs.
- **Injecting the app-skill source into `fileTools` as an interface.** There is one source and no second caller.

## Cut for Scope

Each of these was found during discovery. The recorded boundary, the operator's request in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md), does not ask for any of them. The operator can reinstate any
of them.

- **Show a failed tool's reason in the chat**
  ([C-15](artifacts/current-state-findings.md#c-15-a-failed-tool-call-shows-only-the-word-error)). The tool row would
  say why, for example "not in garden/draft.md", instead of only "error".
- **Say when a turn hits the step limit**
  ([C-16](artifacts/current-state-findings.md#c-16-hitting-the-20-step-limit-looks-like-a-normal-finish)). The chat
  would show "stopped after 20 steps" instead of looking finished.
- **Keep stopped turns in the model's memory, and free old chats**
  ([C-17](artifacts/current-state-findings.md#c-17-a-stopped-or-failed-turn-is-dropped-from-the-models-history-but-stays-on-screen)).
- **Fix the compiled binary's crash when `WORKSPACE` names a missing folder**
  ([C-18](artifacts/current-state-findings.md#c-18-the-compiled-binary-cannot-read-files-through-computed-paths)). The
  README already documents this failure.
- **List workspace posts in subfolders in the Documents list.** This would make a saved session log visible again after
  a reload.

## Open Items

- **Does the model follow the adapted loop across many turns?** Non-blocking. This needs live runs (C-3, and Findings No
  Agent Could Audit), and Unit 5's check scenario and a manual run settle it.

## Review Findings

One review round ran, with three specialists: `han-core:junior-developer`, `han-core:test-engineer`, and
`han-core:user-experience-designer`. None raised a blocking finding. Where two raised the same point, it was merged.
The decisions each finding produced are in the decision log.

- **The server and editor must split a post into the same blocks**, and only a comment said they would (JD-001, TE item
  4). A parity test and a pinned rule now cover it ([D-14](artifacts/change-decision-log.md#d-14-verification-additions-from-the-review-round)).
- **A passage the editor cannot place vanished silently** (JD-002, UX-003). An `aria-live` status line now reads
  "Highlighted N of M passages" ([D-15](artifacts/change-decision-log.md#d-15-how-highlights-look-and-how-the-chat-and-editor-stay-linked)).
- **The turn end could pull the writer out of the post they were in** (JD-005, UX-006). The editor now moves only if
  the writer has not changed files since sending ([D-16](artifacts/change-decision-log.md#d-16-the-editor-moves-to-the-highlighted-post-only-if-the-writer-has-not-moved-since-sending)). This also corrected S-11, which had called the whole callback
  change preserving.
- **The chat and the editor had no pinned link** (UX-002). Labels are now unique, and each question starts with its
  label.
- **A side-question turn cleared highlights** (UX-008). The skill now re-highlights ([D-15](artifacts/change-decision-log.md#d-15-how-highlights-look-and-how-the-chat-and-editor-stay-linked)).
- **The highlight could be hard to see or find** (UX-001, UX-004, UX-005). The colors are pinned with a non-color
  underline, the label is real text in one place, and the first passage scrolls into view ([D-15](artifacts/change-decision-log.md#d-15-how-highlights-look-and-how-the-chat-and-editor-stay-linked)).
- **Typing inside a passage erased its label mid-answer** (UX-007). Decorations now map through edits ([D-10](artifacts/change-decision-log.md#d-10-the-editor-draws-highlights-as-decorations-recomputed-from-quotes-usedocuments-holds-the-quotes)).
  Unverified: how y-prosemirror's remote transactions map decorations (see Risks).
- **Streaming highlights mid-turn** was considered and not taken (UX-010).
- **The skill was hard to discover** (UX-009). The hint line is added; clickable chips are deferred.
- **One breaking test was missing from the plan, and the compiled-binary check was manual** (test engineer). Both are
  fixed ([D-14](artifacts/change-decision-log.md#d-14-verification-additions-from-the-review-round)).
- **`findQuote`'s offset test could pass with broken remapping** (test engineer). Exact offsets are now pinned ([D-14](artifacts/change-decision-log.md#d-14-verification-additions-from-the-review-round)).
- **Reading the `Highlight` tool part in the UI** was proposed as a simpler path (JD-003), and rejected with reasons in
  [D-9](artifacts/change-decision-log.md#d-9-highlights-ride-on-the-turn-ending-data-session-part-and-replace-the-previous-set).
- **The passage caps of 12 had no evidence** (JD-006), so they were dropped.
- **Whether a restart picks up a new skill** was unproven (JD-004). It was closed by an experiment ([C-20](artifacts/current-state-findings.md#c-20-a-restart-picks-up-added-and-edited-macro-inputs)).
- **The test engineer confirmed the preserving claims.** It named the existing tests that keep S-4 and S-10
  preserving: `workspace-config.test.ts` "skips a file whose frontmatter cannot be parsed, or never closes", and the
  `sessions.test.ts` `data-session` assertions.

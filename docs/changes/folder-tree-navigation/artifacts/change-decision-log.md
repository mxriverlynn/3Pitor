# Change Decision Log: Folder Tree Navigation

<!--
This file records every decision committed while planning Folder Tree Navigation.
The plan itself lives in [../change-plan.md](../change-plan.md) — this file captures the
question, rationale, evidence, and rejected alternatives behind each decision.
Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.
-->

## Trivial decisions

- D-1: The reason and the area — a constraint arriving (the owner's new requirement). The area is the browser's document
  list, the documents routes, and the browser's open-file state, with the chat's file tools unchanged. The owner
  confirmed it on 2026-09-29 ("looks good"). — Referenced in plan: Why This Change.
- D-12: What each menu offers — "+" offers New file and New folder at the top level. A folder's "..." offers New file,
  New folder, Rename, Move to…, and Delete. A file's "..." offers Rename, Move to…, and Delete. This comes straight from
  the owner's request and follow-up ("these options don't show up for files, just folders"). — Referenced in plan:
  Target State (Browser: the file-tree component), S-13.
- D-20: Path helpers shared by the hook and the tree — `movedPath` and `within` live in
  `src/ui/documents/components/paths.ts`, because they have two users and the README's `<feature>/components/` rule
  places them there. — Referenced in plan: Target State (Browser: `useDocuments`…), S-8.
- D-22: The name dialog takes one name, not a path — the name is trimmed, Submit is disabled when it is empty or
  contains `/`, and a file name gets `.md` appended when missing, as `create` does today (C-6). Other grammar refusals
  come back from the server and show in the dialog. The parent comes from where the dialog was opened. — Referenced in
  plan: Target State (Browser: the file-tree component).
- D-25: Hover uses a neutral tint — a hovered row's background is `var(--border)`, which is defined for light and dark
  themes in `styles.css`. That keeps it distinct from the open file's `var(--accent-soft)`, which junior-developer
  JD-007 found the first draft reused. — Referenced in plan: Target State (Browser: the file-tree component).

## Full decisions

### D-2: A flat list of entries, not a nested tree

- **Question:** What shape does `GET /api/documents` return?
- **Decision:** `{ "entries": DocumentEntry[] }`, where
  `interface DocumentEntry { path: string; kind: 'file' | 'folder' }`. The list holds every folder, empty ones
  included, and every `.md` file, skipping names that start with `.`, sorted by `path` with `<`. Worked example in
  change-plan.md, "Wire types".
- **Rationale:** The browser's `listed` already merges the disk list with opened-only paths, such as an AI-created
  unsaved post (C-8). With flat paths that merge stays a set union, and re-filing on a move is a prefix operation on the
  same strings. Nesting happens once, when the tree renders.
- **Evidence:** C-1, C-8, C-14; software-architect A3.
- **Behavior impact:** Changing. The list body changes, and its only consumers change in the same unit (S-5).
- **Rejected alternatives:**
  - A nested JSON tree — rejected because the hook would need a tree-merge for opened-only paths and a tree walk to
    re-key.
  - Keep `{ documents: string[] }` and infer folders from paths — rejected because empty folders, which the owner
    creates with New folder, would never appear.
- **Revisit criterion:** A workspace large enough that sending the whole list per refresh is measurably slow.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3, S-5
- **Dependent decisions:** D-8, D-15, D-19
- **Referenced in plan:** Target State (Wire types), S-3

### D-3: Keep the encoded name segment; new operations take JSON bodies

- **Question:** How do new operations address a path, given that names travel as one URL-encoded segment today (C-2)?
- **Decision:** `GET` and `PUT /api/documents/:name` keep the encoded segment. `POST /api/documents/create`, `/move`,
  `/count`, and `/delete` take paths in a JSON body. Route table in change-plan.md, "The routes and their error
  contract".
- **Rationale:** The UI and `check.ts` already rely on the encoded segment, and it works for nested names (C-2). Move
  needs two paths, which a body carries plainly, and a body avoids the segment-decoding rules.
- **Evidence:** C-2; `check.ts:137-139`; software-architect A2.
- **Behavior impact:** Preserving for GET and PUT addressing. The new routes are new.
- **Rejected alternatives:**
  - Wildcard routes such as `/api/documents/*` — rejected because two-path operations still need a body, and it
    changes the addressing callers already use.
  - `DELETE /api/documents/:name` — rejected because it mixes two addressing styles for no gain.
- **Revisit criterion:** An outside client of the API appears and asks for REST-style verbs.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-19, D-24
- **Referenced in plan:** Target State (The routes and their error contract), S-6

### D-4: Share the workspace check from `src/server/components/`

- **Question:** Where does the symlink-aware confinement check live, now that the documents routes need it too?
- **Decision:** Move `resolveInWorkspace` and `realTarget`, unchanged, to `src/server/components/workspace-path.ts`,
  with their tests. `tools.ts` imports it from there. `resolvePost` and `postName` stay in the chat tools.
- **Rationale:** Two features use it. The README puts code shared by features of one package in
  `<package>/components/`, and importing it from `chat/tools` would make `documents` depend on `chat` (C-5).
- **Evidence:** C-4, C-5; README "`components/` folders".
- **Behavior impact:** Preserving. The code moves unchanged.
- **Rejected alternatives:**
  - Import from `chat/tools` — rejected because it breaks the feature layering (C-5).
  - Write a second check in the documents feature — rejected because two checks of different strength is the current
    problem (C-4).
- **Revisit criterion:** None expected.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1
- **Dependent decisions:** D-5, D-17
- **Referenced in plan:** Target State (Server…), S-1

### D-5: A documents domain file with one error type

- **Question:** Where do the file-system operations live, and how do routes tell refusals apart?
- **Decision:** `src/server/documents/documents.ts` has no HTTP imports. It exports `checkPath`, `listEntries`,
  `readDocument`, `writeDocument`, `createEntry`, `moveEntry`, `countContents`, and `deleteEntry`, plus one
  `DocumentError` class carrying `reason: 'invalid' | 'not-found'`. Routes map `invalid` to 400 and `not-found` to 404,
  with body `{ "error": "<sentence>" }`. Each route checks its body with a zod schema (`PutBody`, `CreateBody`,
  `MoveBody`, `PathBody`, pinned in change-plan.md) and answers 400 when it fails. Every operation follows the three
  locating rules in D-26. Signatures in change-plan.md, "Server…".
- **Rationale:** The README requires a domain file per server feature. Routes must tell a missing item from every other
  refusal without the domain knowing HTTP, and one class with a `reason` field is the smallest thing that does that. A
  real temp-folder test, the pattern `tools.test.ts` uses, is the cheapest way to check rename and recursive delete.
  The zod schemas pin the "malformed body" contract, which the first draft left in prose (security review). The repo
  already uses zod in `tools.ts` and `agent.ts`.
- **Evidence:** C-4, C-6; README "`src/server/`"; `tools.test.ts`; software-architect A1; adversarial-security-analyst
  (contracts only in prose); junior-developer JD-005.
- **Behavior impact:** Changing, through the new operations (owner's request) and S-4 (D-17, D-26).
- **Rejected alternatives:**
  - Keep all logic inside `documents.routes.ts` — rejected because it breaks the README's domain-file convention and
    can only be tested over HTTP.
  - An error class per reason — rejected because one class with a field is simpler and serves the one mapping helper.
  - A third reason, `exists`, mapped to 409 — the first draft had it. Rejected by the simpler-version test (JD-005): no
    browser code branches on status, because `api()` passes on only the message. Deferred (YAGNI).
- **Revisit criterion:** A browser caller needs to branch on a refusal kind.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** D-6, D-15, D-17, D-18, D-21, D-26
- **Referenced in plan:** Target State (Server…), S-2

### D-6: Nothing overwrites an existing item

- **Question:** What happens when a new file, a rename, or a move targets a path that already exists?
- **Decision:** Refuse with 400 `{"error":"<path> already exists"}` (400 rather than 409, per D-5). The name dialog shows the sentence and stays open.
  `PUT /api/documents/:name` (Save) still overwrites, since that is how Save works.
- **Rationale:** Today "+" → `notes` silently replaces a full `notes.md` with a blank page (C-6).
- **Evidence:** C-6; owner answer.
- **Behavior impact:** Changing. Asked on 2026-09-29 (question 3 of 7): "Refuse, and show 'notes.md already exists' in
  the pop-up so you can pick another name (recommended)… or keep today's behavior and overwrite it." Owner answer,
  verbatim: "recommended".
- **Rejected alternatives:**
  - Overwrite, as today — rejected by the owner.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** D-21
- **Referenced in plan:** Target State (Server…), S-6, Behavior Changes

### D-7: `api()` throws with the server's sentence

- **Question:** How does the browser learn that an operation failed (C-7)?
- **Decision:** `api()` throws an `Error` for any non-OK response. The message is the body's `error` field when
  present, and otherwise the body text or `"<status> <statusText>"`. Dialogs show it inline and stay open. Other
  failures show in one `role="alert"` line at the top of the tree.
- **Rationale:** Every new operation has refusals the user must see. Handling it once in the transport is simpler than
  checking status at every call site.
- **Evidence:** C-7; callers of `api(` are `app.tsx:21`, `chat.tsx:115`, and `documents.tsx`, per software-architect
  A4.
- **Behavior impact:** Changing. A missing file shows "x.md was not found" instead of opening an empty page. Asked on
  2026-09-29 as part of question 5 of 7. The owner replaced the startup half of the recommendation (D-10) and did not
  object to the error messages. This run took that as acceptance and said so in the conversation.
- **Rejected alternatives:**
  - Check `res.ok` at each call site — rejected because it means more code and gets missed.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7
- **Dependent decisions:** D-19, D-24
- **Referenced in plan:** Target State (Browser: `api()`…), S-7, Behavior Changes

### D-8: One documents hook that re-files open state after the server succeeds

- **Question:** How do unsaved edits and the other name-keyed stores survive a rename or move, and what happens on
  delete (C-8)?
- **Decision:** `useDocuments` stays one hook. `move(from, to)` calls the server. On success it re-inserts the same
  `Entry` object under each path `movedPath` returns, and remaps `current` and `highlights.file`. It also clears
  `notApplied`. `remove(path)` calls the server, then drops every open path `within` it. `names` becomes `entries`, and
  `create` becomes `createEntry`. Surface in change-plan.md, "Browser: `useDocuments`…".
- **Rationale:** Every name-keyed store lives in this hook, so re-filing is one loop in one place. Server first means a
  failed operation changes nothing in the browser. Moving the same `Entry` object carries the Yjs document, saved text,
  save count, and unsaved flag.
- **Evidence:** C-3, C-8; software-architect A5.
- **Behavior impact:** Changing. Unsaved edits follow a rename or move, which the owner asked for. The delete side is
  in D-14.
- **Rejected alternatives:**
  - Split the hook into a list hook and an open-files hook — rejected because re-filing needs both. Deferred (YAGNI).
  - Re-load files from disk after a move — rejected because it loses unsaved edits.
- **Revisit criterion:** A second feature needs the entry list without the editor state.
- **Dissent (if any):** None.
- **Settles delta entry:** S-9, S-10
- **Dependent decisions:** D-9, D-14
- **Referenced in plan:** Target State (Browser: `useDocuments`…), S-9, S-10

### D-9: Lock tree changes while the AI works

- **Question:** What happens if you rename, move, or delete while a chat turn is running (C-9)?
- **Decision:** `app.tsx` passes `busy={chat.busy}` to `FileTree`. While it is true, "+", every "...", dragging, and
  dropping are disabled. Opening files still works.
- **Rationale:** No name can change between sending a message and receiving its edits, so the returned names never go
  stale and no old file comes back.
- **Evidence:** C-9; `chat.busy` at `chat.tsx:105`.
- **Behavior impact:** Changing. Asked on 2026-09-29 (question 2 of 7): "Lock the tree's changes while the AI works
  (recommended)… Allow changes anyway, and redirect the AI's finished edits to the new names." Owner answer, verbatim:
  "go with recommended".
- **Rejected alternatives:**
  - Redirect the finished turn's edits to renamed paths — rejected by the owner, and deferred (YAGNI).
- **Revisit criterion:** The owner reports friction from not being able to reorganize while the AI works.
- **Dissent (if any):** None.
- **Settles delta entry:** S-13, S-15
- **Dependent decisions:** None.
- **Referenced in plan:** Target State (Browser: the tree is locked…), S-13, S-15, Behavior Changes

### D-10: Nothing opens at startup

- **Question:** What does the editor show when the page loads, now that `notes.md` may have been renamed or deleted
  (C-11)?
- **Decision:** Nothing opens. `current` starts `undefined`. `Editor` shows a centered "Select a file" message in the
  editor area whenever no file is open. `useChatSession` accepts an undefined `openFile`, which the server already
  treats as no file open (`sessions.routes.ts:14`).
- **Rationale:** The owner's direction. It also removes the phantom `notes.md` of C-11.
- **Evidence:** C-11; commit `da3bfaf` ("Show the first file when the page loads"), which this reverses.
- **Behavior impact:** Changing. Asked on 2026-09-29 (question 5 of 7): "Open `notes.md` if it exists, or the first
  file in the tree if it doesn't… (recommended)… Keep always opening `notes.md`." Owner answer, verbatim: "don't open
  anything when the app first loads. show a simple message, centered in the editor screen area, that says to select a
  file".
- **Rejected alternatives:**
  - Open `notes.md` or the first file — rejected by the owner.
  - Always open `notes.md` — rejected by the owner.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10, S-11, S-14
- **Dependent decisions:** None.
- **Referenced in plan:** Target State (Browser: `useDocuments`…; the editor with no file open), S-10, S-11, S-14,
  Behavior Changes

### D-11: A file-tree component folder with sibling buttons per row

- **Question:** Where does the tree UI live, and how does a row hold a "..." button (C-12)?
- **Decision:** `src/ui/documents/file-tree/` holds `file-tree.tsx`, `file-tree.css`, and `file-tree.test.tsx`, and
  exports `FileTree({ docs, busy })`. Each row is an `<li>` with two sibling buttons, "..." then the name. The menu, the
  three dialogs, and the tree-building function stay local to the module. Markup sketch in change-plan.md.
- **Rationale:** The README gives each component of a multi-component feature its own folder, and the tree grows well
  past today's 45 lines. Sibling buttons avoid a button inside a button.
- **Evidence:** C-12; README "Components".
- **Behavior impact:** Changing. This is the owner's requested interface.
- **Rejected alternatives:**
  - Keep growing `Files` in `documents.tsx` — rejected because the file would mix the hook, the editor, and the whole
    tree.
  - A separate component per dialog and for the menu — rejected because each has one user, so they stay local to the
    module.
- **Revisit criterion:** Another feature needs the menu or a dialog.
- **Dissent (if any):** None.
- **Settles delta entry:** S-12, S-13
- **Dependent decisions:** D-12, D-13, D-22
- **Referenced in plan:** Target State (Browser: the file-tree component), S-12, S-13

### D-13: Move by dragging and by "Move to…"

- **Question:** How does the user move a file or folder?
- **Decision:** Both. Dragging uses the browser's built-in drag events: drop on a folder to move into it, or on the
  "Documents" heading to move to the top level. A "Move to…" entry in every "..." menu opens a list of destination
  folders, for keyboard use. Both call `docs.move`.
- **Rationale:** The owner's direction.
- **Evidence:** Owner answers.
- **Behavior impact:** Changing. It is a new capability.
- **Rejected alternatives:**
  - Dragging only — the owner's first answer ("drag and drop"), replaced by their second.
  - "Move to…" only — not chosen.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-13
- **Dependent decisions:** None.
- **Referenced in plan:** Target State (Browser: the file-tree component), S-13
- **Owner answers, verbatim:** first "drag and drop". Then: "wait, let's make that "both" drag and drop, and menu item
  for keyboard accessibility".

### D-14: Deleting discards unsaved edits, after naming them

- **Question:** What happens to unsaved edits in an open file that is deleted, alone or inside a folder?
- **Decision:** They are discarded. The confirmation names each such file: "Unsaved changes in drafts/soil.md will be
  lost."
- **Rationale:** It is simple and predictable, and the dialog says what is lost.
- **Evidence:** C-8 (an opened path stays listed, so keeping the entry would leave a row for a file that does not
  exist).
- **Behavior impact:** Changing. Asked on 2026-09-29 (question 1 of 7): "Discard the edits, with the warning in the
  confirmation (recommended)… Refuse to delete until you save or undo… Delete from disk but keep the edited file open."
  Owner answer, verbatim: "unsaved edits are thrown out with deletes".
- **Rejected alternatives:**
  - Refuse until saved — rejected by the owner.
  - Keep the open copy — rejected by the owner.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** None.
- **Referenced in plan:** Target State (Browser: `useDocuments`…), S-10, Behavior Changes

### D-15: The tree shows folders and markdown files only

- **Question:** What does the list include, and which names does the server accept?
- **Decision:** The pinned path grammar in change-plan.md, "Server…": segments do not start with `.` and contain no
  `/`, `\`, or NUL. A file ends in `.md`. `listEntries` returns folders and `.md` files, skipping dot-entries, non-`.md`
  files, and symlinks.
- **Rationale:** The editor opens only markdown. The grammar is narrower than the chat tools' `resolvePost`, so no name
  the tree shows can fail a chat send (C-10). One domain test checks that `postName` accepts names `checkPath` accepts.
- **Evidence:** C-10; `tools.ts` `resolvePost`.
- **Behavior impact:** Changing. Asked on 2026-09-29 (question 4 of 7): "Show only folders and markdown files, and hide
  anything starting with '.' (recommended)… Show every file and folder." Owner answer, verbatim: "recommended".
- **Rejected alternatives:**
  - Show every file and folder — rejected by the owner.
- **Revisit criterion:** The editor gains support for another file type.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5
- **Dependent decisions:** D-17
- **Referenced in plan:** Target State (Server…), S-5, Behavior Changes

### D-16: The chat is not told about renames

- **Question:** Should the chat learn that `ideas.md` is now `brainstorm.md`?
- **Decision:** No. The chat's conversation keeps old names, and a later request by the old name gets a "can't find"
  reply until the new name is used.
- **Rationale:** Fixing it changes the chat's conversation handling, which is outside the approved area.
- **Evidence:** C-10 (history keeps old names); scope-boundary.md.
- **Behavior impact:** Changing. Asked on 2026-09-29 (question 6 of 7). Owner answer, verbatim: "recommended". The fix
  is in the plan's Cut for Scope.
- **Rejected alternatives:**
  - Tell the chat about renames — cut for scope.
- **Revisit criterion:** The owner asks for it.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** None.
- **Referenced in plan:** Behavior Changes, Cut for Scope

### D-17: Tighten the existing read and write

- **Question:** Do `GET` and `PUT /api/documents/:name` adopt the shared check and the grammar?
- **Decision:** Yes. Both go through `readDocument` and `writeDocument`. A path that fails the grammar, leaves the
  workspace through a symlinked folder, or names a file that is itself a symlink (D-26) gets 400 `{ "error": … }`.
  `writeDocument` still creates missing parent folders, as `Bun.write` does today (C-6), so Save still writes an
  AI-created post into a new folder.
- **Rationale:** The new delete and move must not inherit the weak check (C-4), and one check is simpler than two.
- **Evidence:** C-4; `check.ts` only reads and writes `scratch.md` and `notes.md`.
- **Behavior impact:** Changing. Asked on 2026-09-29 (question 7 of 7): "Tighten it (recommended)… Leave save and load
  as they are." Owner answer, verbatim: "recommended".
- **Rejected alternatives:**
  - Tighten only the new routes — rejected by the owner.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-4
- **Dependent decisions:** None.
- **Referenced in plan:** S-4, Behavior Changes

### D-18: The delete count covers everything on disk

- **Question:** What does a folder's delete confirmation count?
- **Decision:** `countContents` returns `{ files, folders }`. `files` is every entry under the folder that is not a
  directory, including hidden, non-markdown, and symlink entries. `folders` is every directory under it, not counting
  the folder itself.
- **Rationale:** The owner asked to be told what is deleted. Counting only what the tree shows would under-report what
  a recursive delete removes.
- **Evidence:** scope-boundary.md ("for a folder, show the number of files and sub-folders that would be removed").
- **Behavior impact:** Changing. It is a new capability.
- **Rejected alternatives:**
  - Count only what the tree shows — rejected because it understates the loss.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** None.
- **Referenced in plan:** Target State (Server…)

### D-19: One test-only fake of the documents API

- **Question:** How do UI tests stand in for the documents routes now that they have folders and refusals (C-13)?
- **Decision:** `src/ui/components/fake-documents-api.ts` fakes fetch over `files: Map<string, string>` and
  `folders: Set<string>`. It implements the pinned route table with only the refusals the UI tests use: 404 for a
  missing item and 400 "already exists" for a taken path. It carries no copy of the path grammar. It replaces the mocks
  in `documents.test.tsx` and `app.test.tsx`, and serves `file-tree.test.tsx`.
- **Rationale:** Three test files need the same fake, and a flat `Map` cannot hold an empty folder. `src/ui/components/`
  is the lowest folder that covers all three. Keeping the grammar out of the fake leaves the domain and route tests as
  the one source of truth, so the fake cannot drift from the server's rules unnoticed (JD-004, test-engineer).
- **Evidence:** C-13; README ("a fetch helper and a test-only model both live in one"); junior-developer JD-004.
- **Behavior impact:** Preserving. Only tests use it.
- **Rejected alternatives:**
  - Extend each hand-written mock — rejected because it means three copies of the route rules.
  - A fake implementing every refusal, grammar included — the first draft. Rejected by the simpler-version test
    (JD-004).
- **Revisit criterion:** A UI test needs a specific grammar message.
- **Dissent (if any):** None.
- **Settles delta entry:** S-16
- **Dependent decisions:** None.
- **Referenced in plan:** Target State (Tests: one fake documents API), S-16

### D-21: Move rules

- **Question:** Which moves are refused?
- **Decision:** `moveEntry(from, to)` calls `checkPath` on both `from` and `to` for the item's kind. It refuses in
  these cases:
  - `from` is missing (404).
  - `to`'s parent is missing (404).
  - `to` exists (400 "already exists").
  - `to` is `from` or inside it (400). This is checked by comparing the real path of `from` with the real parent
    folder of `to`, not by comparing strings.
  - `from` or `to` fails the grammar (400).

  The browser's move dialog and drop targets already leave out the item itself, anything inside it, and its current
  parent.
- **Rationale:** Moving a folder into itself is impossible on disk, and D-6 forbids overwriting. A string comparison
  lets a case variant (`Drafts` into `drafts/sub/Drafts` on a case-insensitive disk) or an alias link through. The file
  system then answers EINVAL, and the user gets a plain 500 instead of the promised 400. The security review ran that
  case.
- **Evidence:** software-architect A1; adversarial-security-analyst ("Moving a folder into itself").
- **Behavior impact:** Changing. It is a new capability.
- **Rejected alternatives:**
  - Let the file system report these errors — rejected because its messages are not readable sentences and the
    overwrite rule would not hold.
- **Revisit criterion:** A case-only rename on a case-insensitive disk is refused (see Open Items).
- **Dissent (if any):** None.
- **Settles delta entry:** S-6
- **Dependent decisions:** None.
- **Referenced in plan:** Target State (Server…), S-6

### D-23: Browser-only items get no actions

- **Question:** What can you do with a tree item that exists only in the browser, such as a post the AI created but you
  have not saved, or a folder it implies?
- **Decision:** `listed` marks each item `onDisk: true | false` (worked example in change-plan.md). An item with
  `onDisk: false` shows in the tree, and a file opens, but it has no "..." button. It cannot be dragged, and it is not
  a drop target or a "Move to…" destination. Saving the file writes it and its folders to disk, and from then on it has
  the full menu.
- **Rationale:** Every server operation on such an item would fail with "not found": New file inside an implied folder,
  its delete count, a move into it. Offering actions that always fail is worse than offering none. Save already
  creates parent folders (D-17), so the item has a way to become real.
- **Evidence:** C-8 (`listed` unions opened-only paths); junior-developer JD-002.
- **Behavior impact:** Preserving against today. Today such items show as flat rows with no actions at all. The tree
  keeps that, placed in its folder.
- **Rejected alternatives:**
  - Leave implied folders out of the tree — rejected because the unsaved post would have no folder to sit in.
  - Offer the full menu and let the server refuse — rejected because every action would fail.
  - Create the implied folder on disk as soon as it appears — rejected because the chat must not write to disk; only
    Save does (README).
- **Revisit criterion:** The owner needs to rename, move, or discard an unsaved AI-created post from the tree.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10, S-13
- **Dependent decisions:** None.
- **Referenced in plan:** Target State (Browser: `useDocuments`…), S-10, S-13, Deferred (YAGNI)

### D-24: Where each failure shows

- **Question:** Once `api()` throws (D-7), where does the user see each operation's failure?
- **Decision:** Hook operations reject, and the component that started the operation shows the message:

  | Failed operation | Where the message shows |
  | --- | --- |
  | create, rename | inside the name dialog, which stays open |
  | Move to… | inside the move dialog, which stays open |
  | count, delete | inside the delete confirmation; a failed count leaves Delete disabled |
  | open, drop | one `role="alert"` line at the top of the tree, cleared by the next successful operation |
  | save (button or Cmd-S) | the editor's `.notice` area, `role="alert"`: "Could not save drafts/a.md: <message>" |

  `Editor` awaits `docs.save()` in both places it calls it.
- **Rationale:** Today `Editor` calls `docs.save()` without awaiting it. Once `api()` throws, a failed save would be an
  unhandled rejection with nothing on screen (JD-003). Every operation needs a named place to show its failure.
- **Evidence:** C-7; junior-developer JD-003; test-engineer (how `open()` failure reaches the tree).
- **Behavior impact:** Changing. This is part of the error messages the owner accepted with question 5 on 2026-09-29.
- **Rejected alternatives:**
  - One error field on the hook for every operation — rejected because a dialog's error belongs inside that dialog,
    and one shared field would show a stale error in the wrong place.
- **Revisit criterion:** None.
- **Dissent (if any):** None.
- **Settles delta entry:** S-7, S-14
- **Dependent decisions:** None.
- **Referenced in plan:** Target State (Browser: `api()` reports failures), S-7, S-14, Behavior Changes

### D-26: Symlinks are hidden and refused

- **Question:** What happens with symlinks (shortcut files) inside the workspace?
- **Decision:** Every exported domain function follows three rules:
  1. Call `checkPath` on every path it takes.
  2. Confine the item's parent folder with `resolveInWorkspace`, then append the item's name.
  3. `lstat` the item. If it is a symlink, `readDocument`, `writeDocument`, and `createEntry` refuse it with
     `DocumentError('invalid')`, and `moveEntry` and `deleteEntry` act on the link itself.

  `listEntries` skips symlinks and never descends into one. `countContents` counts a symlink as one file.
- **Rationale:** The first draft confined only the parent folder, which leaves the item's own link unchecked. The
  security review ran two cases:
  - A dangling `dangling.md -> outside/new-target.md` passed `resolveInWorkspace`, because `existsSync` is false for a
    dangling link. `Bun.write` then created the file outside the workspace.
  - A live file link would be read through by `Bun.file`.

  Both contradict S-4's promise. Refusing a symlinked item in `documents.ts` fixes it without changing
  `resolveInWorkspace`, so S-1 stays Preserving and the chat `Read` tool's error text is unchanged.
- **Evidence:** adversarial-security-analyst SEC-004 (run on Bun 1.4.2); junior-developer JD-001. The security review
  also ran `rm` with the recursive option and `readdir` with the recursive option against links: both act on or list
  the link without following it.
- **Behavior impact:** Changing. A `.md` symlink in the workspace no longer appears in the list and cannot be opened or
  saved through the documents routes. Asked on 2026-09-29 (symlink question, second of the review round): "Hide and
  refuse them (recommended)… Show them, but only follow shortcuts that point inside the workspace." Owner answer,
  verbatim: "recommended".
- **Rejected alternatives:**
  - Follow a symlink only when its target is inside the workspace — rejected by the owner; it is also more to build.
  - Fix it inside `realTarget` — rejected because it would change the chat tools' error text, which is outside the
    area.
- **Revisit criterion:** The owner needs symlinked posts in the tree.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-4, S-5
- **Dependent decisions:** None.
- **Referenced in plan:** Target State (Server…), S-2, S-4, S-5, Behavior Changes, Review Findings

### D-27: The server stays reachable as it is today

- **Question:** Should the server be locked to this computer, and should it refuse change requests from other web
  pages, now that it can delete?
- **Decision:** No. The server keeps listening on every network interface and checks no `Host` or `Origin` header, as
  today. The exposure is recorded under Risks in change-plan.md, with the fix named.
- **Rationale:** The owner's decision.
- **Evidence:** adversarial-security-analyst:
  - SEC-001 (run): `Bun.serve({port:0})` listens on `*:<port>` and answered from the machine's LAN address.
  - SEC-002: Hono's `c.req.json()` parses a `text/plain` body. This was verified with a server run; no browser was
    driven, so it is `Unverified` for real browsers.
  - SEC-003 (run): a request with a foreign `Host` header was answered.
- **Behavior impact:** Preserving. Nothing changes. Asked on 2026-09-29 (server question, first of the review round):
  "Lock it down (recommended)… Leave it as is." Owner answer, verbatim: "leave it as is".
- **Rejected alternatives:**
  - `hostname: '127.0.0.1'` on `Bun.serve`, plus one `/api/*` middleware refusing a foreign `Host`, or on non-GET
    requests a foreign `Origin` — declined by the owner.
- **Revisit criterion:** The owner reopens it, or the app is used on shared networks.
- **Dissent (if any):** The adversarial-security-analyst rated SEC-001 and SEC-002 High. The owner decided against the
  recommendation; the plan records the exposure under Risks.
- **Settles delta entry:** S-6
- **Dependent decisions:** None.
- **Referenced in plan:** Current State, S-6, Behavior Changes, Risks, Deferred (YAGNI)

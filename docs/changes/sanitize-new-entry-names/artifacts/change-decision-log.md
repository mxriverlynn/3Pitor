# Change Decision Log: Sanitize New File and Folder Names

<!--
This file records every decision committed while planning Sanitize New File and Folder Names.
The plan itself lives in [../change-plan.md](../change-plan.md). This file captures the
question, rationale, evidence, and rejected alternatives behind each decision.
Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.

The operator asked this run to settle planning questions itself, log them here, and report
behavior changes afterward, rather than stopping to ask. Every behavior-changing decision below
is therefore decided by the run, and listed in the plan's Behavior Changes section for review.
-->

## Trivial decisions

- D-7: Where the naming rules live — `src/ui/documents/file-tree/entry-name.ts`, with `entry-name.test.ts`, beside
  `file-tree.tsx`, its only caller, as README.md's "How `src/` is laid out" asks for a helper one component imports. —
  Referenced in plan: Target State, Surface Delta.
- D-8: No live preview of the cleaned name in the dialog — the created item appears in the tree and a new file opens, so
  the result is visible at once. Deferred until someone reports being surprised by a cleaned name. — Referenced in plan:
  Deferred (YAGNI).

## Full decisions

### D-1: Clean names in the browser only, and leave the server unchanged

- **Question:** Should the server's create route also clean names, or only the tree's dialog?
- **Decision:** Only the browser cleans. `checkPath` and `createEntry` in `src/server/documents/documents.ts` are
  unchanged and keep refusing paths outside their grammar. Contract between the two: every non-empty result of
  `newEntryName` passes `checkPath`. It never starts with `.`, never holds `\` or NUL, and a file result ends in
  lower-case `.md`.
- **Rationale:** The browser opens the exact path it sent, and the route returns no path
  ([C-6](current-state-findings.md#c-6-the-browser-opens-a-new-file-by-the-exact-path-it-sent)). If the server rewrote a
  name, the browser would open a path that does not exist, unless the route also returned the new path. That is a wire
  change with no second caller to justify it: `POST /api/documents/create` is called only by `documents.tsx`
  `createEntry`, which only the tree calls.
- **Evidence:** C-3, C-6; software-architect's grep of the route's callers.
- **Behavior impact:** Preserving. The server's responses do not change.
- **Rejected alternatives:**
  - Clean on the server and return the cleaned path — rejected because it changes the wire contract for a route with one
    caller, and the browser would still need its own rule to decide when to disable Create.
  - Clean in both places — rejected because two copies of one rule drift, and `src/shared/` would gain a module for one
    browser caller.
- **Revisit criterion:** A second caller of the create route or of `createEntry` appears, such as an AI tool that makes
  folders.
- **Dissent (if any):** None.
- **Settles delta entry:** —
- **Dependent decisions:** D-2, D-3.
- **Referenced in plan:** Target State, Deferred (YAGNI).

### D-2: The characters a new name loses

- **Question:** Which characters "don't play nice with files and folders"?
- **Decision:** A new name loses `\ / : * ? " < > |` and the control characters U+0000–U+001F and U+007F. Each is removed,
  not replaced. After that, spaces and dots are trimmed from both ends of the name. The full rule, in order:
  1. Remove `\ / : * ? " < > |` and U+0000–U+001F, U+007F.
  2. Trim whitespace from both ends.
  3. For a file only, drop one trailing `.md` in any letter case.
  4. Trim whitespace and dots from both ends together.
  5. If nothing is left, the result is `''`. Otherwise a file gets `.md` appended in lower case.

  Worked examples, file: `garden`→`garden.md`; `␠␠garden␠␠`→`garden.md`; `Notes.MD`→`Notes.md`; `notes .md`→`notes.md`;
  `a?b`→`ab.md`; `foo.`→`foo.md`; `.hidden`→`hidden.md`; `tab⇥here`→`tabhere.md`; `drafts/compost`→`draftscompost.md`;
  `x.md.md`→`x.md.md`; `.md`→`''`; `<>:`→`''`; `␠␠`→`''`.

  Worked examples, folder: `␠drafts/2026␠`→`drafts2026`; `a.md`→`a.md`; `..`→`''`; `essays`→`essays`.
- **Rationale:** Those nine characters are the ones Windows refuses in a name. `/` and `\` are path separators on every
  system. Control characters are invisible and break shells. Together they are the set that is unsafe on at least one
  common file system, which is what "don't play nice" asks for. Removing rather than replacing does what the operator
  asked: "stripped". Step 2 must come before step 3, or `x.MD␠` misses its extension. Step 4 trims spaces and dots
  together, or `␠.␠foo␠.␠` keeps a dot.
- **Evidence:** C-3 and C-4; operator's request; software-architect's ordering analysis.
- **Behavior impact:** Changing. Names that are created as typed today lose characters
  ([C-4](current-state-findings.md#c-4-today-names-holding-troublesome-characters-are-created-as-typed)). Decided by the
  run under the operator's standing instruction, and reported in the plan's Behavior Changes section.
- **Rejected alternatives:**
  - Replace each character with `-` or `_` — rejected because the operator said "stripped".
  - A wider set that also drops `#`, `%`, `&`, `'`, or non-ASCII letters — rejected because each is valid on macOS,
    Linux, and Windows, and the browser already URL-encodes names (`encodeURIComponent` in `documents.tsx`).
  - Only the characters the server refuses (`\`, NUL) — rejected because it leaves `? : * < > |`, which break the files
    on Windows and in shells.
- **Revisit criterion:** A name that passes this rule fails on a real file system or sync tool.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1.
- **Dependent decisions:** D-3, D-4, D-6.
- **Referenced in plan:** What Changes, In One Paragraph; Target State; Surface Delta; Behavior Changes.

### D-3: A file's `.md` is recognized in any letter case and written in lower case

- **Question:** Does "doesn't explicitly have `.md` at the end" count `Notes.MD` as having it?
- **Decision:** Yes. A trailing `.md` in any letter case counts, and the created file always ends in lower-case `.md`:
  `Notes.MD`→`Notes.md`. Spaces before the extension are trimmed too: `notes .md`→`notes.md`.
- **Rationale:** Today `Notes.MD` becomes `Notes.MD.md`
  ([C-1](current-state-findings.md#c-1-the-md-extension-is-added-in-the-browser-by-a-case-sensitive-helper-shared-with-rename)),
  which is the doubled extension the request is meant to stop. The server and the tree accept only lower-case `.md`
  (C-3), so writing anything else would be refused or hidden.
- **Evidence:** C-1, C-3.
- **Behavior impact:** Changing. Decided by the run; reported in Behavior Changes.
- **Rejected alternatives:**
  - Case-sensitive, as `withMd` does today — rejected because it produces `Notes.MD.md`.
  - Keep the typed case (`Notes.MD`) — rejected because `checkPath` refuses it and `listEntries` would not show it.
- **Revisit criterion:** None foreseen.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1.
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta; Behavior Changes.

### D-4: Dots at either end of a new name are stripped

- **Question:** Should `.hidden` and `foo.` be refused, created as typed, or cleaned?
- **Decision:** Cleaned. Leading and trailing dots are trimmed with the spaces: `.hidden`→`hidden.md`, `foo.`→`foo.md`,
  and a folder `..` leaves nothing, which disables Create.
- **Rationale:** A leading dot makes a hidden item that the server refuses and the tree never lists (C-3). A trailing dot
  is dropped or refused by Windows. Both "don't play nice", and stripping matches what the operator asked for spaces.
- **Evidence:** C-3, C-4.
- **Behavior impact:** Changing. Today `.hidden` shows the server's refusal in the dialog; afterwards it creates
  `hidden.md`. Decided by the run; reported in Behavior Changes.
- **Rejected alternatives:**
  - Keep the server's refusal for a leading dot — rejected because it leaves the user to work out why, when the fix is
    the same stripping the request asks for.
- **Revisit criterion:** Someone needs to create a dot-file from the tree, which `listEntries` would not show anyway.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1.
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes.

### D-5: The name dialog takes its naming rule from whoever opens it

- **Question:** How does one dialog clean names for New file and New folder while Rename keeps today's rule?
- **Decision:** The `Pending` `'name'` variant gains one required field,
  `clean: (draft: string) => string`. The dialog computes `const name = pending.clean(draft)`, disables its submit button
  while `name` is `''`, and calls `pending.submit(name)`. New file passes `(d) => newEntryName(d, 'file')`, New folder
  passes `(d) => newEntryName(d, 'folder')`, and Rename passes `(d) => (d.includes('/') ? '' : d.trim())`.
- **Rationale:** The dialog needs two answers from one rule: what to submit, and whether to allow it. One function gives
  both, so they cannot drift. It has three current users (New file, New folder, Rename). Making it required means no
  caller gets the old rule by default.
- **Evidence:** C-2, C-7; software-architect A2.
- **Behavior impact:** Preserving for Rename: its `clean` reproduces today's trim and `/` block exactly, and its `submit`
  still applies `withMd`.
- **Rejected alternatives:**
  - Keep today's disable check and clean inside `submit` — rejected because `<>:` would leave Create enabled and submit
    an empty name.
  - A file-or-folder flag on the dialog — rejected because it moves the naming rule into the dialog.
- **Revisit criterion:** A fourth dialog with a different rule, or Rename adopting `newEntryName`.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-3.
- **Dependent decisions:** D-6.
- **Referenced in plan:** Target State; Surface Delta.

### D-6: A `/` in a new name is stripped, rather than disabling Create

- **Question:** Today `/` disables Create. Under "strip special characters", does it still?
- **Decision:** For New file and New folder, `/` is stripped like the other characters: `drafts/compost`→
  `draftscompost.md`. Rename keeps disabling on `/`. The test that pins the `/` block moves to the Rename dialog.
- **Rationale:** `/` is the most common character that does not belong in a name. Treating it differently from `\` in
  the same dialog would be surprising. The tree never created nested paths from one name, so nothing is lost.
- **Evidence:** C-2, C-7; D-2.
- **Behavior impact:** Changing. Decided by the run; reported in Behavior Changes.
- **Rejected alternatives:**
  - Keep disabling Create on `/` — rejected because it treats one unsafe character differently from the rest.
  - Treat `/` as a request to create nested folders — rejected as new behavior nobody asked for.
- **Revisit criterion:** Someone asks to create a nested path from one name.
- **Dissent (if any):** None.
- **Settles delta entry:** S-3.
- **Dependent decisions:** —
- **Referenced in plan:** Behavior Changes; Change Units.

### D-9: Rename is out of scope

- **Question:** Rename shares the dialog and `withMd`. Should renamed names be cleaned too?
- **Decision:** No. Rename keeps today's behavior exactly, including `Notes.MD`→`Notes.MD.md`.
- **Rationale:** The operator's request names creation: "when a new file or folder is created", "when someone creates a
  file". The scope test cuts what the boundary does not include.
- **Evidence:** `artifacts/scope-boundary.md`, Stated Scope; C-1.
- **Behavior impact:** Preserving.
- **Rejected alternatives:**
  - Apply `newEntryName` to Rename too — rejected for scope. The operator can reinstate it, and their saying so is the
    justification.
- **Revisit criterion:** The operator asks for renamed names to be cleaned too.
- **Dissent (if any):** software-architect flagged rename's case-sensitive `withMd` for the operator's attention.
- **Settles delta entry:** —
- **Dependent decisions:** —
- **Referenced in plan:** Cut for Scope.

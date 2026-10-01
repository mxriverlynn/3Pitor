# Change Plan: Sanitize New File and Folder Names

## Why This Change

The operator asked for three things when someone creates a new file or folder from the Documents tree. First, the name
loses characters that cause trouble in file and folder names. Second, a file gets `.md` appended unless its name already
ends in `.md`. Third, spaces at the start and end of a name are removed. This is a constraint arriving: a new requirement
the current naming code was not built to meet. The source is the operator's own request, recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md).

## What Changes, In One Paragraph

After this change, the tree's New file and New folder dialogs clean the typed name before anything reaches the server.
Unsafe characters are removed, spaces and dots at either end are trimmed, and a file always ends in exactly one
lower-case `.md` ([D-2](artifacts/change-decision-log.md#d-2-the-characters-a-new-name-loses)). The rule lives in one
small, tested function beside the tree. The dialog asks whoever opened it how to turn the draft into a name, so Rename
keeps working exactly as it does today. The server does not change.

## Current State

Today, naming is split across three places, and none of them removes unsafe characters.

- **The extension.** `withMd` in `file-tree.tsx` appends `.md` for New file and Rename. It is case-sensitive, so
  `Notes.MD` becomes `Notes.MD.md`
  ([C-1](artifacts/current-state-findings.md#c-1-the-md-extension-is-added-in-the-browser-by-a-case-sensitive-helper-shared-with-rename)).
- **The dialog.** The one name dialog trims the draft at submit, and blocks only an empty name or one holding `/`. It
  trims before `withMd`, so `notes .md` keeps its inner space
  ([C-2](artifacts/current-state-findings.md#c-2-the-name-dialog-trims-once-for-create-and-rename-and-blocks-only-empty-names-and-)).
- **The server.** `checkPath` in `src/server/documents/documents.ts` refuses a leading `.`, `\`, NUL, and a file not
  ending in lower-case `.md`. It never rewrites a name
  ([C-3](artifacts/current-state-findings.md#c-3-the-server-validates-a-paths-grammar-and-never-rewrites-a-name)).

This change addresses one structural fact: the naming rule has no single home. As a result, `a?b`, `<>:`, `foo.`, and a
name holding a tab are all created as typed
([C-4](artifacts/current-state-findings.md#c-4-today-names-holding-troublesome-characters-are-created-as-typed)).

## Target State

One function owns what a new name becomes. The dialog asks the code that opened it for its naming rule, and stops
hard-coding one.

**`newEntryName`** lives in `src/ui/documents/file-tree/entry-name.ts`, beside its only caller
([D-7](artifacts/change-decision-log.md#trivial-decisions)).

- It turns typed text into the name of a new file or folder, or into `''` when nothing usable is left.
- It does not choose the folder the item goes in, handle rename, or check whether the name is already taken.

```ts
export function newEntryName(typed: string, kind: 'file' | 'folder'): string;
```

The rule runs in this order ([D-2](artifacts/change-decision-log.md#d-2-the-characters-a-new-name-loses)):

1. Remove `\ / : * ? " < > |` and the control characters U+0000–U+001F and U+007F.
2. Trim whitespace from both ends, and dots from the end.
3. For a file only, drop one trailing `.md` in any letter case.
4. Trim whitespace and dots from both ends together.
5. If nothing is left, return `''`. Otherwise a file gets lower-case `.md` appended.

Step 2 comes before step 3, so `x.MD␠` and `foo.md.` still lose their extension rather than doubling it. Step 2 leaves
leading dots alone, so a file typed as only `.md` leaves nothing rather than becoming `md.md`.

| Typed            | File result        | Folder result |
| ---------------- | ------------------ | ------------- |
| `garden`         | `garden.md`        | `garden`      |
| `␠␠garden␠␠`     | `garden.md`        | `garden`      |
| `Notes.MD`       | `Notes.md`         | `Notes.MD`    |
| `notes .md`      | `notes.md`         | `notes .md`   |
| `a?b`            | `ab.md`            | `ab`          |
| `foo.`           | `foo.md`           | `foo`         |
| `foo.md.`        | `foo.md`           | `foo.md`      |
| `Notes.MD.`      | `Notes.md`         | `Notes.MD`    |
| `.hidden`        | `hidden.md`        | `hidden`      |
| `tab⇥here`       | `tabhere.md`       | `tabhere`     |
| `drafts/compost` | `draftscompost.md` | `draftscompost` |
| `x.md.md`        | `x.md.md`          | `x.md.md`     |
| `.md`            | `''`               | `md`          |
| `<>:`            | `''`               | `''`          |
| `..`             | `''`               | `''`          |
| `␠␠`             | `''`               | `''`          |

**The contract with the server.** Every non-empty result passes `checkPath`. It never starts with `.`, never holds `\`
or NUL, and a file result ends in lower-case `.md`. The server stays as it is, because the browser opens the exact path
it sent ([D-1](artifacts/change-decision-log.md#d-1-clean-names-in-the-browser-only-and-leave-the-server-unchanged),
[C-6](artifacts/current-state-findings.md#c-6-the-browser-opens-a-new-file-by-the-exact-path-it-sent)).

**The name dialog in `FileTree`** takes its rule from the `Pending` `'name'` value
([D-5](artifacts/change-decision-log.md#d-5-the-name-dialog-takes-its-naming-rule-from-whoever-opens-it)):

```ts
| { kind: 'name'; title: string; action: string; initial: string;
    clean: (draft: string) => string; submit: (name: string) => Promise<void> }
```

The dialog computes `pending.clean(draft)` and disables its submit button while the result is `''`. On submit it passes
that result to `pending.submit`. Each opener supplies its own `clean`:

| Opener     | `clean`                                         | `submit` receives, then does         |
| ---------- | ----------------------------------------------- | ------------------------------------ |
| New file   | `(d) => newEntryName(d, 'file')`                | `create(inside(name), 'file')`       |
| New folder | `(d) => newEntryName(d, 'folder')`              | `create(inside(name), 'folder')`     |
| Rename     | `(d) => (d.includes('/') ? '' : d.trim())`      | today's `move(...)`, with `withMd`   |

`withMd` stays, used by Rename only.

## Surface Delta

### S-1: `newEntryName` in `src/ui/documents/file-tree/entry-name.ts` — Added

**Target state.** `newEntryName(typed, kind)` exists in `src/ui/documents/file-tree/entry-name.ts`. It owns turning
typed text into a new file or folder name by the five-step rule and worked examples in Target State, and returns `''`
when nothing usable is left. Every non-empty result passes the server's `checkPath`. `entry-name.test.ts` beside it pins
the worked examples.

**Behavior.** Changing. Names typed into New file and New folder lose unsafe characters and the dots at their ends, and
`.MD` becomes `.md`. Decided by the run under the operator's standing instruction
([D-2](artifacts/change-decision-log.md#d-2-the-characters-a-new-name-loses),
[D-3](artifacts/change-decision-log.md#d-3-a-files-md-is-recognized-in-any-letter-case-and-written-in-lower-case),
[D-4](artifacts/change-decision-log.md#d-4-dots-at-either-end-of-a-new-name-are-stripped)). Listed in Behavior Changes.

**Why.** It is the operator's request, in one testable place.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-characters-a-new-name-loses),
[D-7](artifacts/change-decision-log.md#trivial-decisions)

### S-2: `Pending` `'name'` variant in `file-tree.tsx` — Re-scoped

**Target state.** The `'name'` variant of `Pending` carries a required `clean: (draft: string) => string`. The name
dialog submits `pending.clean(draft)` and disables its submit button while that is `''`. The dialog itself holds no
naming rule: no `trim` and no `/` check.

**Behavior.** Preserving on its own. Rename's `clean` reproduces today's trim and `/` block exactly, and its `submit`
still applies `withMd`. The changes a user sees come from S-1 and S-3.

**Why.** New file, New folder, and Rename need different rules in one dialog
([D-5](artifacts/change-decision-log.md#d-5-the-name-dialog-takes-its-naming-rule-from-whoever-opens-it)).

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-name-dialog-takes-its-naming-rule-from-whoever-opens-it)

### S-3: The New file and New folder items from `createItems` — Re-scoped

**Target state.** New file and New folder open the name dialog with `clean` set to `newEntryName` for their kind. Their
`submit` creates `inside(name)` with the cleaned name as given, so New file no longer calls `withMd`. A `/` in a new name
is stripped rather than disabling Create.

**Behavior.** Changing. `drafts/compost` used to disable Create, and now creates `draftscompost.md`. A name left empty
by cleaning, such as `<>:`, disables Create
([D-6](artifacts/change-decision-log.md#d-6-a--in-a-new-name-is-stripped-rather-than-disabling-create)). Listed in
Behavior Changes.

**Why.** It is where the operator's "when a new file or folder is created" happens.

**Depends on.** S-1, S-2.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-name-dialog-takes-its-naming-rule-from-whoever-opens-it),
[D-6](artifacts/change-decision-log.md#d-6-a--in-a-new-name-is-stripped-rather-than-disabling-create)

## Behavior Changes

The run decided each of these under the operator's standing instruction to settle planning questions and report
afterward. The observer in every case is a person creating a file or folder from the Documents tree.

1. **Unsafe characters disappear from new names.** Typing `a?b` creates `ab.md`, where today it creates `a?b.md`. The
   characters removed are `\ / : * ? " < > |` and invisible control characters such as tab
   ([D-2](artifacts/change-decision-log.md#d-2-the-characters-a-new-name-loses)).
2. **A `/` no longer greys out Create.** Typing `drafts/compost` creates `draftscompost.md`
   ([D-6](artifacts/change-decision-log.md#d-6-a--in-a-new-name-is-stripped-rather-than-disabling-create)).
3. **`.MD` in any letter case counts as the extension.** `Notes.MD` creates `Notes.md`, where today it creates
   `Notes.MD.md`. Spaces before the extension go too: `notes .md` creates `notes.md`
   ([D-3](artifacts/change-decision-log.md#d-3-a-files-md-is-recognized-in-any-letter-case-and-written-in-lower-case)).
4. **Dots at either end are dropped.** `.hidden` creates `hidden.md`, where today the dialog shows the server's refusal.
   `foo.` creates `foo.md`, not `foo..md`
   ([D-4](artifacts/change-decision-log.md#d-4-dots-at-either-end-of-a-new-name-are-stripped)).
5. **A name with nothing usable greys out Create.** `<>:` or `..` cannot be submitted, the same way an empty name cannot
   today.
6. **A new file's heading follows the cleaned name.** The server writes `# {name}`
   ([C-5](artifacts/current-state-findings.md#c-5-a-new-files-heading-is-its-name-without-md)), so `a?b` starts with
   `# ab`.
7. **A cleaned name can collide with one that exists.** If `ab.md` exists, typing `a?b` shows "ab.md already exists"
   in the dialog, naming a file the person did not type. The dialog stays open, as it does for any taken name today.

Trimming spaces at the ends of a name already happens today
([C-2](artifacts/current-state-findings.md#c-2-the-name-dialog-trims-once-for-create-and-rename-and-blocks-only-empty-names-and-)).
This change keeps it, and pins it with a test for the first time.

## Change Units

### Unit 1: Add `newEntryName` with its tests

**What it does.** Adds the naming rule as a standalone function and pins every worked example in Target State. Nothing
calls it yet, so the app is unchanged.

**Delta entries.** S-1.

**How you know it worked.** `entry-name.test.ts` passes, covering every row of the worked-examples table for both kinds.
It also loops over every non-empty result in the table, for both kinds, and asserts the server contract: no leading
`.`, no `\` or NUL, and a file result ends in lower-case `.md`. The full suite stays green.

### Unit 2: Drive the name dialog from `clean`, and wire New file and New folder to `newEntryName`

**What it does.** Adds `clean` to the `'name'` variant of `Pending`, and moves the trim and `/` rule out of the dialog
into Rename's `clean`. New file and New folder clean their names with `newEntryName`. The type change and its three
openers land together, because `clean` is required and the file does not compile with only some openers updated.

**Delta entries.** S-2, S-3.

**Ordering constraint.** After Unit 1, which supplies `newEntryName`.

**How you know it worked.** In `file-tree.test.tsx`:

- The test "the name dialog will not submit an empty name, or one holding a /" is split in two. New file keeps its
  empty-on-open and whitespace-only checks on Create. A new Rename test opens the dialog from a file's `...` menu,
  clears the name or types one holding `/`, and expects Rename disabled, so Rename's `/` block stays pinned
  ([D-6](artifacts/change-decision-log.md#d-6-a--in-a-new-name-is-stripped-rather-than-disabling-create)).
- New Rename tests pin that Rename is unchanged: `␠␠garden␠␠` renames to `garden.md`, `a?b` to `a?b.md`, and `Garden.MD`
  to `Garden.MD.md`. Without these, Rename wired to `newEntryName` by mistake, or Rename losing its trim, would pass
  every existing test.
- New tests show that New file `␠a?b␠` creates and opens `ab.md` with `# ab`, and New file `drafts/compost` creates
  `draftscompost.md`.
- A new test shows New folder `␠<essays>␠` creates `essays`.
- A new test shows a name left empty by cleaning, such as `<>:`, disables Create.
- The existing `garden` and `compost` creation tests and every rename test pass unchanged.

## Risks

- **Rename regresses through the shared dialog.** Unit 2 changes the dialog Rename uses. The existing rename tests type
  only plain names, so they would not catch Rename's rule changing. Unit 2's new Rename tests, typing spaces, `?`, `.MD`,
  and `/`, catch it.
- **A cleaned name the server still refuses.** If a non-empty result broke `checkPath`, the user would see a 400 in the
  dialog. The UI tests run against `fake-documents-api.ts`, not the real `checkPath`
  ([C-7](artifacts/current-state-findings.md#c-7-tests-pin-appending-md-the-empty-name-block-and-the--block)).
  README.md forbids `src/ui/` importing `src/server/`, so the test cannot call `checkPath`. Instead,
  `entry-name.test.ts` asserts the contract's three properties on every non-empty result in its table: no leading `.`,
  no `\` or NUL, and a file ends in lower-case `.md`. That covers the table's rows, not every possible input. The rule's
  last steps (trim the ends, then append lower-case `.md`) are what make the contract hold in general.

The blast radius of both units is the Documents tree's name dialog. Nothing else imports `file-tree.tsx` internals.

## Deferred (YAGNI)

- **Cleaning on the server, or returning the created path from the route.** Reopen if a second caller of
  `POST /api/documents/create` or `createEntry` appears, such as an AI tool that makes folders
  ([D-1](artifacts/change-decision-log.md#d-1-clean-names-in-the-browser-only-and-leave-the-server-unchanged)).
- **Windows reserved names (`CON`, `NUL`, `COM1`) and a length limit.** Reopen if a Windows user or a failure report
  shows up.
- **A live preview of the cleaned name in the dialog.** Reopen if someone reports being surprised by a cleaned name
  ([D-8](artifacts/change-decision-log.md#trivial-decisions)).

## Cut for Scope

- **Cleaning names on Rename.** Rename would have used the same rule as New file, so renaming to `Notes.MD` would give
  `Notes.md`, not `Notes.MD.md`. The boundary cites creation only: "when a new file or folder is created"
  ([artifacts/scope-boundary.md](artifacts/scope-boundary.md),
  [D-9](artifacts/change-decision-log.md#d-9-rename-is-out-of-scope)). The operator can reinstate it.
- **Cleaning names the AI picks for new posts.** The AI's Write tool would have cleaned a new post's name the same way,
  so a post it called `a?b.md` would be saved as `ab.md`. The request describes a person creating an item, and the AI's
  tool already refuses any name not ending in `.md` and any segment starting with `.`
  ([D-10](artifacts/change-decision-log.md#d-10-names-the-ai-picks-for-new-posts-are-out-of-scope)). The operator can
  reinstate it.

## Open Items

None.

## Review Findings

`han-core:junior-developer` and `han-core:test-engineer` reviewed the plan in one round. Their findings changed it as
follows. Each decision is in [artifacts/change-decision-log.md](artifacts/change-decision-log.md).

- **`foo.md.` doubled the extension** (junior-developer). Step 2 now trims trailing dots before step 3 drops `.md`, and
  the table gained `foo.md.` and `Notes.MD.`
  ([D-2](artifacts/change-decision-log.md#d-2-the-characters-a-new-name-loses)).
- **The AI also creates posts** (junior-developer). Cut for scope
  ([D-10](artifacts/change-decision-log.md#d-10-names-the-ai-picks-for-new-posts-are-out-of-scope)).
- **Rename's preservation had no test that could fail** (test-engineer, blocking). Unit 2 now adds Rename tests typing
  spaces, `?`, `.MD`, and `/`.
- **The `/` test could not move to Rename unchanged** (test-engineer, blocking). Unit 2 now splits it, keeping New
  file's empty checks.
- **The server contract was checked only under Risks** (test-engineer, junior-developer). Unit 1's check now loops over
  the table's results, and Risks says it covers the table, not every input.
- **Collisions with a cleaned name** (junior-developer). Added as Behavior Change 7.
- **Control characters beyond U+001F and U+007F survive** (junior-developer). Recorded as deliberate in
  [D-2](artifacts/change-decision-log.md#d-2-the-characters-a-new-name-loses).
- **Rename's cut should go to the operator** (junior-developer). It is reported to the operator with the plan rather
  than asked mid-run, under the operator's standing instruction.

No finding was labeled `Unverified` after the round. The junior developer could not inspect how the AI's Write tool
checks paths. The orchestrator read `resolvePost` in `src/server/chat/tools/tools.ts` and closed that gap.

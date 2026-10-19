# Change Plan: Update the Code Structure (2026-10-19)

## Why This Change

The owner wants `src/` laid out by package, then feature, then component, with shared code at the lowest scope that
covers every user, and no behavior changes. This is a deliberate improvement with no triggering event. Its evidence is
the [architectural analysis](artifacts/architectural-analysis.md) of 2026-10-19. Since the last run, 246 commits put
seven modules at the wrong scope, and one test import runs against the dependency direction. The boundary is the
owner's rule set, recorded word for word in [scope-boundary.md](artifacts/scope-boundary.md)
([D-4](artifacts/change-decision-log.md#d-4-take-the-scope-boundary-as-recorded-without-a-confirmation-turn)).

## What Changes, In One Paragraph

Seven modules move to the lowest scope that covers their users, each inside its own package:

- Two engine test helpers move up to `engine/components/`.
- The definition of Bun-only code, which the engine's and the posts package's tests share, moves to `src/shared/`.
- The post store's folder-naming helper moves beside the store.
- In the UI, the keyboard-shortcut helper and the post dialogs move into the documents feature's shared
  `components/`. The post table and the model picker move flat beside their one user each.

No file's contents change beyond its import specifiers, the test files' exempt lists, and one header comment that names
the old path of `entry-name.ts`. The README describes the tree as it then stands.

## Current State

- `shared/entry-name.ts` has one user, the file post store
  ([C-1](artifacts/current-state-findings.md#c-1-entry-name-has-one-user-in-the-posts-package)).
- `ui/components/shortcut.ts` is used only inside `ui/documents/`
  ([C-2](artifacts/current-state-findings.md#c-2-shortcut-is-used-only-inside-the-documents-feature)).
- `documents/post-dialogs/` is shared by post-panel and post-table. `documents/post-table/` and `chat/model-picker/`
  have one importer each
  ([C-3](artifacts/current-state-findings.md#c-3-post-dialogs-is-shared-by-two-documents-components-post-table-and-model-picker-each-have-one-importer)).
- `engine/chat/components/test-model.ts` and `stub-tool-server.ts` are used at the engine root and by `model-config`
  ([C-4](artifacts/current-state-findings.md#c-4-two-engine-test-helpers-are-used-outside-the-chat-feature)).
- `posts/bun-free.test.ts` imports `engine/components/bun-only-code`, a module with no imports
  ([C-5](artifacts/current-state-findings.md#c-5-the-posts-packages-tests-import-the-engine)).
- Server tests deep-import five engine modules, and the README names only some of them
  ([C-6](artifacts/current-state-findings.md#c-6-server-tests-deep-import-five-engine-modules-the-readme-does-not-all-name)).
- `server/scripts/check.ts` is reached by a `package.json` path that `make test` never runs
  ([C-7](artifacts/current-state-findings.md#c-7-serverscriptscheckts-is-addressed-by-a-path-make-test-never-runs)).
- Test discovery and four boundary scans depend on the package roots staying put
  ([C-8](artifacts/current-state-findings.md#c-8-test-discovery-and-the-boundary-scans-depend-on-the-package-roots-staying-put)).
- CSS order in the bundle is checked by nothing but a bundle diff
  ([C-9](artifacts/current-state-findings.md#c-9-css-reaches-the-bundle-in-import-order-and-nothing-but-a-bundle-diff-checks-it)).
- Two modules hold state at module scope
  ([C-10](artifacts/current-state-findings.md#c-10-two-modules-hold-state-at-module-scope)).
- The README's layout section has drifted
  ([C-11](artifacts/current-state-findings.md#c-11-the-readmes-layout-section-has-drifted)).

The structural property this change addresses: a module scoped above or beside the lowest scope that covers its users.
The rules that settle it are "a component folder holds … the helpers only it uses" and "shared code goes at the lowest
scope that covers every user".

## Target State

```
src/engine/components/
  bun-only-code.ts                 -> moves to src/shared/
  test-model.ts                    <- from chat/components/
  stub-tool-server.ts              <- from chat/components/
  json-file.ts, json-file.test.ts  (unchanged)
src/engine/chat/components/
  chat-test-helpers.ts, fake-claude.ts, fake-claude-on-path.ts   (unchanged)
src/shared/
  bun-only-code.ts                 <- from engine/components/  (test-only)
  entry-name.ts, entry-name.test.ts -> move to src/posts/file/
src/posts/file/
  entry-name.ts, entry-name.test.ts <- from src/shared/
src/ui/components/
  shortcut.ts, shortcut.test.ts    -> move to documents/components/
src/ui/documents/
  components/
    shortcut.ts, shortcut.test.ts  <- from ui/components/
    post-dialogs/                  <- from documents/post-dialogs/
  documents/
    post-table.tsx, .css, .test.tsx <- from documents/post-table/
  post-dialogs/, post-table/       (gone)
src/ui/chat/
  agent-panel/
    model-picker.tsx, .css, .test.tsx <- from chat/model-picker/
  model-picker/                    (gone)
```

The decisions behind each move:

- Flatten post-table and model-picker beside their one user
  ([D-7](artifacts/change-decision-log.md#d-7-flatten-post-table-into-documentsdocuments-and-model-picker-into-chatagent-panel)).
- shortcut and post-dialogs go to `documents/components/`
  ([D-8](artifacts/change-decision-log.md#d-8-move-shortcut-to-documentscomponents-and-post-dialogs-to-documentscomponentspost-dialogs)).
- bun-only-code goes to `src/shared/` ([D-9](artifacts/change-decision-log.md#d-9-move-bun-only-code-to-srcshared)).
- test-model and stub-tool-server go up to `engine/components/`
  ([D-10](artifacts/change-decision-log.md#d-10-move-test-model-and-stub-tool-server-up-to-enginecomponents)).
- entry-name goes into `posts/file/`
  ([D-11](artifacts/change-decision-log.md#d-11-move-entry-name-into-postsfile)).

Not moving:

- `server/scripts/check.ts` stays, following two earlier change sets
  ([D-12](artifacts/change-decision-log.md#d-12-leave-serverscriptscheckts-where-it-is)).
- So do panel-resizer, `node-check.ts`, the fake-claude pair, chat-test-helpers, the providers' helpers,
  `local-file-system.ts`, and `markdown-editor.tsx`
  ([D-13](artifacts/change-decision-log.md#d-13-leave-panel-resizer-node-check-chat-test-helpers-the-fake-claude-pair-and-the-providers-helpers-in-place)).
- No top-level folder under `src/` is added, renamed, or removed, so every test stays under its Makefile root and every
  boundary scan keeps its files (C-8).

The analysis recommendations this plan reuses are A1–A6 and A8–A9, with A7 rejected
([D-5](artifacts/change-decision-log.md#d-5-reuse-the-analysis-as-the-current-state-and-its-a1a9-as-the-target-proposal)).

**Contracts.** No contract changes. Every moved module keeps its exports and signatures. Only import specifiers, three
exempt-list strings, and one header comment change. No import line moves within its import block, so CSS order is kept (C-9).

## Surface Delta

### S-1: `bun-only-code` module (`bunHits`) — Moved

**Target state.** `bunHits` is exported from `src/shared/bun-only-code.ts`, which imports nothing.
`src/engine/bun-free.test.ts` and `src/posts/bun-free.test.ts` import it as `'../shared/bun-only-code'`. The engine's
EXEMPT list no longer names it, because it is no longer under the engine's scan.

**Behavior.** Preserving. The contents are unchanged. Both scans apply the same regexes to the same production files.

**Why.** The posts package's tests no longer import the engine, a package that depends on posts.

**Migration.** Import from `'../shared/bun-only-code'` (from a package root).

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-move-bun-only-code-to-srcshared)

### S-2: `test-model` and `stub-tool-server` test helpers — Moved

**Target state.** Both live in `src/engine/components/`. `stub-tool-server.ts` imports its `ServeTools` type from
`'../chat/claude-cli/claude-cli'`. Chat tests import them as `'../../components/<name>'`, `engine.test.ts` as
`'./components/<name>'`, and `model-config.test.ts` as `'../components/stub-tool-server'`. The engine's EXEMPT list
names them as `'components/test-model.ts'` and `'components/stub-tool-server.ts'`.

**Behavior.** Preserving. Test-only modules with unchanged contents, and the same set of exempt files.

**Why.** Their users span the chat feature, the model-config feature, and the engine root.

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-move-test-model-and-stub-tool-server-up-to-enginecomponents)

### S-3: `entry-name` module (`newEntryName`) — Moved

**Target state.** `newEntryName` is exported from `src/posts/file/entry-name.ts`, with its test beside it.
`file-post-store.ts` imports it as `'./entry-name'`. The posts package's bun-free scan now covers it, and it passes,
because it has no imports.

**Behavior.** Preserving. The contents are unchanged.

**Why.** The file store is its only user.

**Decision.** [D-11](artifacts/change-decision-log.md#d-11-move-entry-name-into-postsfile)

### S-4: `shortcut` module (`shortcut`, `keyShortcut`, `isMac`) — Moved

**Target state.** Exported from `src/ui/documents/components/shortcut.ts`, with its test beside it. `documents.tsx`,
`raw-view.tsx`, and `markdown-editor.test.tsx` import it as `'../components/shortcut'`.

**Behavior.** Preserving. The contents are unchanged, and it has no CSS.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-move-shortcut-to-documentscomponents-and-post-dialogs-to-documentscomponentspost-dialogs)

### S-5: `post-dialogs` module (`usePostDialogs`, CSS, test) — Moved

**Target state.** Exported from `src/ui/documents/components/post-dialogs/post-dialogs.tsx`, with its CSS and test
beside it. It imports `'../../../../shared/wire'` and `'../../../components/notice-icons'`. `post-panel.tsx` and
`post-table.tsx` import it as `'../components/post-dialogs/post-dialogs'`.

**Behavior.** Preserving. The contents are unchanged except for two specifier depths. Its CSS keeps its place in the
bundle, because post-table still reaches it first.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-move-shortcut-to-documentscomponents-and-post-dialogs-to-documentscomponentspost-dialogs)

### S-6: `post-table` module (`PostTable`, CSS, test) — Moved

**Target state.** Exported from `src/ui/documents/documents/post-table.tsx`, with its CSS and test beside it.
`documents.tsx` imports it as `'./post-table'`, on the same line as before. Its own imports keep their depth, except
post-dialogs (S-5).

**Behavior.** Preserving.

**Depends on.** S-5 (same unit).

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-flatten-post-table-into-documentsdocuments-and-model-picker-into-chatagent-panel)

### S-7: `model-picker` module (`ModelPicker`, CSS, test) — Moved

**Target state.** Exported from `src/ui/chat/agent-panel/model-picker.tsx`, with its CSS and test beside it.
`agent-panel.tsx` imports it as `'./model-picker'`, still on line 3, ahead of `./agent-panel.css`. Its own imports keep
their depth.

**Behavior.** Preserving.

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-flatten-post-table-into-documentsdocuments-and-model-picker-into-chatagent-panel)

### S-8: README layout section — Re-scoped

**Target state.** The README describes every module at its new path. It names the engine modules the server's tests
may import ([D-14](artifacts/change-decision-log.md#d-14-name-the-engine-modules-the-servers-tests-may-import-in-the-readme-and-move-none-of-them)).
It replaces the gone `post-list/` entry with post-table, post-panel, and post-dialogs, and lists confirm-dialog,
notice-icons, review-strip, image-popup, menu-icons, table-cells, and `shared/document-key.ts`.

**Behavior.** Preserving. Documentation only.

**Depends on.** Each unit edits the lines for its own moved files. Step 6 of the skill writes the rest.

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-make-three-refactor-units-one-per-package-touched-with-each-units-readme-lines-in-that-unit)

## Behavior Changes

None. Every entry is behavior-preserving. The modules move with their contents unchanged apart from import
specifiers. Each unit's checks prove the same tests run, and the UI unit proves the bundled CSS is rule-for-rule
identical.

## Change Units

Every unit is a `refactor`, uses `git mv`, and changes import specifiers only, never the order of import lines. Each
unit's checks are commands with exact expected results
([D-16](artifacts/change-decision-log.md#d-16-make-every-unit-check-a-command-with-an-exact-expected-result)).
The baseline is 523 server tests across 38 files, and 502 UI tests across 19 files. `make test` prints one `Ran … tests
across … files` line for the Bun-side run and one for the UI run, and both must match. `tsc`, inside `make test`,
catches every stale relative specifier in `.ts` and `.tsx` files, tests included. The greps below catch the strings and
README lines `tsc` cannot see.

**Before Unit 1.** The skill commits the plan and its artifacts (Step 4 of `update-code-structure`), so the tree is clean
when Unit 1 starts and `git add -A` stages only the unit's own changes. Every scratch folder below sits in the session
scratchpad, outside the repository, never under it. No unit depends on another
([D-15](artifacts/change-decision-log.md#d-15-make-three-refactor-units-one-per-package-touched-with-each-units-readme-lines-in-that-unit)).

### Unit 1: Move the engine's shared test helpers to their lowest scopes (`refactor`)

**What it does.**

1. `git mv src/engine/components/bun-only-code.ts src/shared/bun-only-code.ts`.
2. `git mv` `src/engine/chat/components/test-model.ts` and `stub-tool-server.ts` into `src/engine/components/`.
3. Edit the specifiers:
   - `engine/bun-free.test.ts` and `posts/bun-free.test.ts`: `bun-only-code` → `'../shared/bun-only-code'`.
   - `stub-tool-server.ts`: `'../claude-cli/claude-cli'` → `'../chat/claude-cli/claude-cli'`.
   - `agent.test.ts`, `ollama.test.ts`, `providers.test.ts`, `sessions.test.ts`, `claude-cli.test.ts`:
     `'../components/<name>'` → `'../../components/<name>'`.
   - `engine.test.ts`: `'./chat/components/<name>'` → `'./components/<name>'`.
   - `model-config.test.ts`: `'../chat/components/stub-tool-server'` → `'../components/stub-tool-server'`.
4. In `engine/bun-free.test.ts` EXEMPT: drop `'components/bun-only-code.ts'`, and rename the two helper entries to
   `'components/test-model.ts'` and `'components/stub-tool-server.ts'`.
5. In the README:
   - In the `bun-free.test.ts` bullet (README line ~111), change "The five test helpers in `chat/components/`" to the
     three left there plus the two in `components/`, and drop the `components/bun-only-code.ts` clause.
   - Move the `test-model.ts` and `stub-tool-server.ts` bullets from the chat `components/` list (lines ~144–153) to a
     bullet under the engine's own `components/`.
   - Describe `bun-only-code.ts` under `src/shared/` as a test-only module that the engine's and posts' Bun-only scans
     share. Widen the section's opening sentence, which today names only code the server, the UI, and the check script
     share (D-9).

**Delta entries.** S-1, S-2, S-8 (its lines).

**Ordering constraint.** None.

**How you know it worked.**

1. `make test` passes. The `Ran … tests across … files` lines show 523/38 and 502/19.
2. `git diff --cached -M --name-status` (after `git add -A`) shows `test-model.ts` and `bun-only-code.ts` as `R100`.
   `git diff --cached -M --numstat | grep stub-tool-server` shows `1	1` (a path filter would hide the rename).
3. `git grep -nE "chat/components/(test-model|stub-tool-server)|components/bun-only-code|five test helpers" -- src README.md`
   returns nothing.
4. `grep -c "^import" src/shared/bun-only-code.ts` prints `0`.

### Unit 2: Move entry-name beside the file post store (`refactor`)

**What it does.** `git mv src/shared/entry-name.ts src/posts/file/entry-name.ts`, and the same for its test. Then
change `file-post-store.ts`'s specifier to `'./entry-name'`, along with its header comment's mention of the old path.
In the README, move the `entry-name.ts` bullet (line ~317) from `### src/shared/` to `### src/posts/`, under `file/`.

**Delta entries.** S-3, S-8 (its lines).

**Ordering constraint.** None.

**How you know it worked.**

1. `make test` passes with 523/38 and 502/19.
2. `git diff --cached -M --name-status` shows `entry-name.ts` and `entry-name.test.ts` as `R100`.
3. `git grep -n "shared/entry-name" -- src README.md` returns only `src/posts/boundary.test.ts:125`, a sample string
   (D-11).
4. `git diff --cached -M --numstat -- src/posts/file/file-post-store.ts` shows `2	2`: the specifier and the header
   comment.
5. `awk '/^### .src\/shared\/./{f=1;next} /^### /{f=0} f' README.md | grep -c entry-name` prints `0`.

### Unit 3: Move the UI's misplaced documents and chat modules (`refactor`)

**What it does.**

1. **Before moving anything**, run `sh docs/changes/update-code-structure-2026-10-19/artifacts/css_snapshot.sh $SCRATCH/css-before`,
   where `$SCRATCH` is the session scratchpad, outside the repository.
2. Move the files with `git mv`:
   - `ui/components/shortcut.{ts,test.ts}` → `ui/documents/components/`
   - `ui/documents/post-dialogs/*` → `ui/documents/components/post-dialogs/`
   - `ui/documents/post-table/*` → `ui/documents/documents/`
   - `ui/chat/model-picker/*` → `ui/chat/agent-panel/`
3. Edit the specifiers:
   - `documents.tsx`: `'../../components/shortcut'` → `'../components/shortcut'`, and `'../post-table/post-table'` →
     `'./post-table'`.
   - `raw-view.tsx`, `markdown-editor.test.tsx`: → `'../components/shortcut'`.
   - `post-panel.tsx`, `post-table.tsx`: → `'../components/post-dialogs/post-dialogs'`.
   - `post-dialogs.tsx`: → `'../../../../shared/wire'` and `'../../../components/notice-icons'`.
   - `post-dialogs.test.tsx`: → `'../../../../shared/wire'`.
   - `agent-panel.tsx`: → `'./model-picker'`.
4. In the README, replace the `post-list/` bullet with post-table (in `documents/`), post-panel, and
   `components/post-dialogs/`. Add `components/shortcut.ts` under documents, and rename `model-picker/model-picker.tsx`
   to `agent-panel/model-picker.tsx`.

**Delta entries.** S-4, S-5, S-6, S-7, S-8 (its lines).

**Ordering constraint.** None. The four moves land together (D-15).

**How you know it worked.**

1. `make test` passes with 523/38 and 502/19.
2. `git diff --cached -M --name-status` shows `R100` for `shortcut.ts`, `shortcut.test.ts`, `post-dialogs.css`,
   `post-table.css`, `post-table.test.tsx`, and all three model-picker files. `git diff --cached -M --numstat` shows
   `2	2` for `post-dialogs.tsx`, and `1	1` for `post-dialogs.test.tsx` and `post-table.tsx`. Among the files that stay
   put, it shows `2	2` for `documents.tsx` and `1	1` for `raw-view.tsx`, `markdown-editor.test.tsx`,
   `post-panel.tsx`, and `agent-panel.tsx`.
3. `git grep -nE "'\.\./\.\./components/shortcut'|'\.\./post-dialogs/post-dialogs'|post-table/post-table|model-picker/model-picker|post-list" -- src README.md`
   returns nothing.
4. `ls src/ui/documents/post-dialogs src/ui/documents/post-table src/ui/chat/model-picker` reports each as missing.
5. Run `css_snapshot.sh $SCRATCH/css-after`. Then:
   - `test -s $SCRATCH/css-after/rules.css` succeeds, and `diff $SCRATCH/css-before/rules.css $SCRATCH/css-after/rules.css`
     is empty.
   - `wc -l < order.txt` prints `19` for both snapshots.
   - This command prints nothing:
     ```sh
     sed -e 's#src/ui/documents/post-dialogs/post-dialogs.css#src/ui/documents/components/post-dialogs/post-dialogs.css#' \
         -e 's#src/ui/documents/post-table/post-table.css#src/ui/documents/documents/post-table.css#' \
         -e 's#src/ui/chat/model-picker/model-picker.css#src/ui/chat/agent-panel/model-picker.css#' \
         $SCRATCH/css-before/order.txt | diff - $SCRATCH/css-after/order.txt
     ```
6. `python3 docs/changes/update-code-structure-2026-10-19/artifacts/cross_feature.py` exits 0. Every move stays
   inside one feature, so this guards only against a new import between features. It is not evidence that behavior was
   preserved.

### After the units: the README inventory (skill Step 6, not a unit)

Step 6 of `update-code-structure` rewrites the rest of S-8. It names the engine's test-facing modules (D-14) and calls
`server/scripts/` a named exception to the feature rule (D-12). It adds one sentence to the "Components" rule. A
component folder is decided by who imports a module (D-7). Inside a `components/` folder, a shared module with CSS gets
its own folder and one without sits flat (D-8). It is done when this prints nothing:

```sh
for n in post-table post-panel post-dialogs confirm-dialog notice-icons shortcut review-strip image-popup menu-icons \
         table-cells document-key bun-only-code chat-test-helpers fake-claude-on-path json-file claude-cli tools.ts; do
  grep -q "$n" README.md || echo "missing: $n"
done
git grep -n "post-list" -- README.md
```

## Risks

- **A test that silently stops running (report R1).** Every move stays under an existing package root. The per-suite
  file and test counts must match the baseline.
- **CSS order (report R4, B7).** Specifiers change, import lines never move, and Unit 3's bundle diff proves the
  rules and their order.
- **Module-scope state (report R3).** `local-file-system.ts` and `markdown-editor.tsx` are not touched (C-10).
- **Exempt lists (report B3).** Each has an existence test, so a missed entry fails `make test` loudly.
- **Blast radius.** Four packages, 19 files moved, about 20 specifier edits. Each unit reverts with one `git revert`.

## Deferred (YAGNI)

- **`posts/components/entry-name.ts`.** Trigger: a second `PostStore`.
- **Folders for post-table or model-picker.** Trigger: a second importer, as for link-popup in the last run.
- **`providers/components/` with one folder per backend.** Trigger: a backend used outside `providers.ts`.
- **Re-exporting test symbols from `engine.ts`.** Trigger: a production server use of one of them.
- **A shared source-scanner helper for the boundary and bun-free tests.** Trigger: a third scan.

## Cut for Scope

These analysis findings change behavior or what the tests enforce, which the boundary excludes
([D-17](artifacts/change-decision-log.md#d-17-cut-the-behavior-changing-findings-as-follow-ups)).
Each is a follow-up, not a unit:

- **A10 (report B2, B4, R1):** make the four boundary scans fail when they find no files.
- **A11 (report S6, R2):** a boundary test for imports from the server and cli into the engine.
- **A12 (report B6, R4):** have `make check-build` fetch `/` and a CSS asset.
- **A13 (report S11):** a type test tying `shared/wire.ts` to the post shapes in `posts.ts`.
- **A14 (report C2, C5, C6, C7, C8, B5, B10):**
  - lost updates between parallel Edits
  - the watcher stopping for good on one error
  - `endpoint.stop()` on every exit path
  - EventBus listener isolation
  - no re-sync after a socket reconnect
  - only `.md` skill files embedded
  - `glob.ts` swallowing errors
- **A7 (report S7):** moving `server/scripts/check.ts`, declined on precedent
  ([D-12](artifacts/change-decision-log.md#d-12-leave-serverscriptscheckts-where-it-is)).

## Open Items

None.

## Review Findings

One round, below the medium cap of two
([D-6](artifacts/change-decision-log.md#d-6-size-the-plan-medium-with-junior-developer-and-test-engineer-for-one-review-round)).
`han-core:junior-developer` and `han-core:test-engineer` reviewed the plan. Neither found a blocking problem. Both
re-read every specifier edit against the code and found them correct. Their findings changed the plan in these places:

- **Exact checks** (both). Renamed files that are edited now carry `numstat` counts, so a stray edit fails. The CSS
  order check has its three `sed` substitutions written out, a line-count check, and a non-empty check
  (D-16, updated).
- **README checks** (both). The Unit 1 grep missed README prose written in backticks, and nothing checked the moved
  bullets. Unit 1 and Unit 2 now name the README lines they edit and grep for them. Step 6's inventory now has a
  done-check.
- **A clean tree before Unit 1** (junior-developer). The plan now says the planning files are committed first, and
  that scratch output sits outside the repository.
- **D-9** (junior-developer). Its precedent was weak, and the README's `src/shared/` sentence would no longer be true.
  Unit 1 now widens that sentence. D-9 records that `posts/components/` would fail the posts deep-import scan, which
  covers tests (`src/posts/boundary.test.ts:135-139`). The change log lists D-9 for the owner to look at first.
- **D-7 and D-8** (junior-developer) can read as contradicting each other. Step 6 adds one sentence to the README's
  Components rule that separates the two levels.
- **The "no contents change" claim** (junior-developer) now names the header comment in `file-post-store.ts`.

Notes not acted on:

- `cross_feature.py` cannot fail for these moves (both reviewers). It stays as a guard, and the plan no longer counts
  it as evidence.
- `stub-tool-server.ts` will import a type from a feature (junior-developer). No rule forbids a type-only edge from a
  test helper, so D-10 stands.
- The test counts are Unverified by the reviewers. Each unit's `make test` settles them.

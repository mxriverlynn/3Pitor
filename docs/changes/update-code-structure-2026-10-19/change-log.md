# Change Log: Update the Code Structure by Package, Feature, and Component

This is the running log of every change made in this change set, in the order it was made. The owner was away and
asked for every decision to be made and justified here. Each entry says what changed and why, and links the decision
(D-N) behind it.

**Where to read more:**

- [change-plan.md](change-plan.md): the plan these changes carry out.
- [artifacts/change-decision-log.md](artifacts/change-decision-log.md): every decision, with its reasoning and the
  alternatives rejected.
- [artifacts/architectural-analysis.md](artifacts/architectural-analysis.md): the analysis that found the risks.

**Branch:** `update-code-structure-2026-10-19`, created from `main` at `cb9478c`. Every step below is one commit on it.
The owner asked for a new branch, commits pushed as the run goes, and a draft PR when this run was started. That
overrides the skill's default of committing only to the current branch (D-1).

**Baseline before any change:** `make test` passes 523 server tests (38 files) and 502 UI tests (19 files), and the
type-check and Node check exit 0.

**Packages (discovered):** `src/app-files`, `src/cli`, `src/engine`, `src/file-system`, `src/posts`, `src/server`,
`src/shared`, `src/ui`. `src/.data`, `src/fixtures`, and `src/skills` hold no `.ts` or `.tsx` file, so they are content,
not packages.

**Test roots (from `Makefile`):** `test-server` runs `bun test src/cli src/server src/engine src/shared src/file-system
src/posts src/app-files`; `test-ui` runs `bun test --preload ./src/ui/test-setup.ts src/ui`. Every package is covered by
a test root and described in the README's layout section, so no package needs a D-N entry for being missing.

**Precedent:** [update-code-structure-2026-10-01](../update-code-structure-2026-10-01/change-log.md) is the most recent
structure change set, and [restructure-by-feature](../restructure-by-feature/change-log.md) set the layout. Their
decisions are followed here unless an entry below says otherwise.

**What changed since the last run:** 246 commits since `1c58be5` added or renamed 111 files under `src/`, including
the new `file-system` and `posts` packages, the posts routes, `shared/document-key.ts` and `shared/entry-name.ts`, the
model picker, the post table, panel, and dialogs, and several new UI shared modules.

## 1. Architectural analysis

- **Commit:** `384dd22` Add the architectural analysis for updating the code structure
- **What:** Ran `/architectural-analysis` on `src/` at medium size with five agents: structural, behavioral,
  concurrency, risk, and software-architect. The report is `artifacts/architectural-analysis.md`. It holds S1–S12,
  B1–B12, C1–C8, R1–R7, and A1–A14.
- **Why:** The analysis finds what makes moving files unsafe before anything moves.
- **Decisions:** D-1 (new branch, pushes, and draft PR), D-2 (medium size), D-3 (no separate readability editor
  pass).
- **Key result:**
  - Seven placement problems were found: `shared/entry-name.ts`, `ui/components/shortcut.ts`, `documents/post-dialogs/`,
    `documents/post-table/`, `chat/model-picker/`, the two engine test helpers used outside `chat`, and
    `server/scripts/`. There is also one wrong-way test import (`posts` → `engine/components/bun-only-code`) and a
    README that describes folders that no longer exist.
  - The one high risk is R1. A move that changes a package root can drop tests out of the Makefile's roots, or leave
    the boundary scans checking nothing, with `make test` still green. No planned move touches a package root.
- **Draft PR:** [#43](https://github.com/mxriverlynn/3Pitor/pull/43), opened at the owner's request while the analysis ran.

## 2. Change plan

- **Commit:** `d402d8d` Plan the code structure update
- **What:** Ran `/plan-a-change` at medium size, reusing the analysis as the current state. It wrote these files:
  - `change-plan.md`
  - `artifacts/current-state-findings.md` (C-1 to C-11)
  - `artifacts/scope-boundary.md`
  - decisions D-4 to D-18 in `artifacts/change-decision-log.md`
  - the two check scripts, copied from the last run: `artifacts/css_snapshot.sh` and `artifacts/cross_feature.py`

  One review round ran (`junior-developer`, `test-engineer`). Neither found a blocking problem. Their findings made
  every check exact, added README checks, and strengthened D-9.
- **Why:** The plan sets the target before any code moves.
- **Decisions:**
  - D-4: no confirmation turn.
  - D-5: reuse the analysis.
  - D-6: medium size.
  - D-7: flatten post-table and model-picker.
  - D-8: shortcut and post-dialogs go to `documents/components/`.
  - D-9: bun-only-code goes to `src/shared/`.
  - D-10: the engine test helpers go to `engine/components/`.
  - D-11: entry-name goes to `posts/file/`.
  - D-12: `server/scripts/check.ts` stays, against the analysis's A7.
  - D-13: everything else stays.
  - D-14: the README names the engine's test-facing modules.
  - D-15: three units.
  - D-16: every check is a command.
  - D-17: behavior changes are cut.
  - D-18: no separate readability pass.
- **Result:** Three `refactor` units, independent of each other, and every entry preserves behavior. A10–A14 and A7
  are cut as follow-ups.

## 3. Unit 1: move the engine's shared test helpers to their lowest scopes (`/refactor`)

- **Commit:** `6366b72` Move the engine's shared test helpers to their lowest scopes
- **What:**
  - `src/engine/components/bun-only-code.ts` → `src/shared/bun-only-code.ts`
  - `src/engine/chat/components/test-model.ts` → `src/engine/components/test-model.ts`
  - `src/engine/chat/components/stub-tool-server.ts` → `src/engine/components/stub-tool-server.ts`, with its one type
    import now `'../chat/claude-cli/claude-cli'`
  - Specifiers changed in ten test files, the two `bun-free.test.ts` files included.
  - The engine's EXEMPT list drops `bun-only-code.ts` and names the two helpers at their new paths.
  - In the README, the `bun-free.test.ts` bullet counts three helpers in `chat/components/` and two in `components/`. A
    new engine `components/` bullet describes the two helpers. `src/shared/` describes `bun-only-code.ts` as test-only,
    and its opening sentence now admits test-only code shared by Bun-side packages.
  - The refactor ran as two named Move Module steps, with `make test` green after each, and then the README step.
- **Why:**
  - The posts package's tests no longer import the engine, which depends on posts (report S6, C-5).
  - The two helpers sit at the lowest scope that covers `engine.test.ts`, the `model-config` tests, and the chat
    tests (report S5, C-4).
- **Decisions:** D-9, D-10. No new decisions.
- **Tests:**
  - `make test` passes the type-check, the Node check, 523 server tests (38 files), and 502 UI tests (19 files), the
    same as the baseline.
  - `test-model.ts` and `bun-only-code.ts` show as `R100`, and `stub-tool-server.ts` as `1 1` lines.
  - The stale-path grep finds nothing, and `bun-only-code.ts` has no imports.

## 4. Unit 2: move entry-name beside the file post store (`/refactor`)

- **Commit:** `d92961e` Move entry-name beside the file post store
- **What:**
  - `src/shared/entry-name.ts` → `src/posts/file/entry-name.ts`
  - `src/shared/entry-name.test.ts` → `src/posts/file/entry-name.test.ts`
  - `file-post-store.ts` imports `'./entry-name'`, and its header comment names the helper beside it.
  - In the README, the `entry-name.ts` bullet moves from `src/shared/` to `src/posts/`, as `file/entry-name.ts`.
- **Why:** The file store is its only user (report S1, C-1), so the store's own folder is the lowest scope.
- **Decisions:** D-11. No new decisions.
- **Tests:**
  - `make test` passes with 523 server tests (38 files) and 502 UI tests (19 files), the same as the baseline.
  - Both moved files show as `R100`, and `file-post-store.ts` as `2 2` lines.
  - `shared/entry-name` appears only in the sample string at `src/posts/boundary.test.ts:125`. The README's
    `src/shared/` section no longer names it.

## 5. Unit 3: move the UI's misplaced documents and chat modules (`/refactor`)

- **Commit:** `34ac31b` Move the UI's misplaced documents and chat modules to their lowest scopes
- **What:**
  - `src/ui/components/shortcut.{ts,test.ts}` → `src/ui/documents/components/`
  - `src/ui/documents/post-dialogs/*` → `src/ui/documents/components/post-dialogs/`
  - `src/ui/documents/post-table/*` → `src/ui/documents/documents/`
  - `src/ui/chat/model-picker/*` → `src/ui/chat/agent-panel/`
  - Specifiers changed in `documents.tsx` (2), `raw-view.tsx`, `markdown-editor.test.tsx`, `post-panel.tsx`,
    `post-table.tsx`, `post-dialogs.tsx` (2), `post-dialogs.test.tsx`, and `agent-panel.tsx`. No import line moved.
  - In the README, the stale `post-list/` bullet is replaced by bullets for `documents/post-table.tsx`,
    `post-panel/post-panel.tsx`, `components/post-dialogs/post-dialogs.tsx`, and `components/shortcut.ts`, and the
    picker's bullet names `agent-panel/model-picker.tsx`.
  - The refactor ran as four named Move Module steps, with `make test` green after each, and then the README step.
- **Why:**
  - shortcut and post-dialogs are shared by components of one feature, so `documents/components/` is their lowest
    scope (report S2, S3).
  - post-table and model-picker each have one importer, so they sit flat beside it, as link-popup did in the last run
    (report S4).
  - The README named a folder that no longer existed (report S12).
- **Decisions:** D-7, D-8. No new decisions.
- **Tests:**
  - `make test` passes with 523 server tests (38 files) and 502 UI tests (19 files), the same as the baseline.
  - Eight files show as `R100`. The edited renames show `2 2` (`post-dialogs.tsx`) and `1 1` (`post-dialogs.test.tsx`,
    `post-table.tsx`), and the files that stayed put match the plan's counts.
  - The stale-path grep finds nothing, and the three emptied folders are gone.
  - The bundled CSS rules are identical to the baseline. Their order, 19 blocks, is identical once the three moved
    paths are rewritten.
  - `cross_feature.py` exits 0.

## 6. README layout section and the build check

- **Commit:** `fac0c4a` Describe the updated code structure in the README
- **What:** The README's "How `src/` is laid out" section now covers every module the analysis found missing, and
  corrects four stale statements:
  - The Components rule says a module's importer decides where it goes, and the `components/` rule says when a shared
    module gets a folder (D-7, D-8).
  - `server/scripts/check.ts` is described as a named exception to the feature rule, with the reason (D-12).
  - The engine section names its test-facing surface, the five modules the server's tests may import (D-14).
  - New bullets cover `image-popup.tsx`, `review-strip.tsx`, `menu-icons.ts`, `table-cells.ts`, `confirm-dialog/`,
    `notice-icons.tsx`, and `shared/document-key.ts`.
  - Corrections:
    - The posts intro said "Nothing in the app uses the package yet". cli, the engine, and the server's post routes
      all use it now.
    - `anchored-bubble.ts` places the image popup too.
    - The menu and panel-resizer bullets named the gone post list.
    - The `documents/` heading now names the post table and post panel.
- **Why:** Step 6 of the skill. The README is the only written record of the layout rules (C-11, report S12), so it
  has to describe the tree as it stands.
- **Decisions:** D-7, D-8, D-12, D-14.
- **Tests:**
  - The plan's inventory check prints nothing: every listed module is named, and "post-list" appears nowhere.
  - `make test` passes with 523 server tests (38 files) and 502 UI tests (19 files).
  - `make check-build` compiles `build/3pitor` and starts it from an empty folder. The binary serves
    `{"skills":["collaborative-editing","proofread","research"],"agents":["title-writer"]}` and reports `3pitor dev`.

## Where things ended up

The tree still followed the owner's rules almost everywhere. This change set moves seven modules to their lowest
scope, each inside its own package, and brings the README back in line with the code.

```
src/engine/  engine.ts bun-free.test.ts node-check.ts
             chat/{agent,claude-cli,providers,sessions,tools,components}/
             components/  json-file.ts test-model.ts stub-tool-server.ts
             events/  model-config/  view-state/  workspace-config/
src/posts/   posts.ts post-error.ts boundary.test.ts bun-free.test.ts
             file/  file-post-store.ts entry-name.ts      components/  describe-post-store.ts
src/shared/  wire.ts markdown.ts markdown-support.ts document-key.ts passages.ts blocks.ts bun-only-code.ts
src/ui/      app.tsx index.html styles.css css.d.ts test-setup.ts
             components/{confirm-dialog,menu,panel-resizer}/ api.ts fake-posts-api.ts notice-icons.tsx
             events/
             documents/{documents,markdown-editor,post-panel}/  documents/components/{post-dialogs/,shortcut.ts}
             chat/{chat,agent-panel}/
src/server/  server.ts server.test.ts  chat/{sessions,models,mcp-endpoint}/  posts/  events/  view-state/
             workspace-config/  scripts/   (unchanged)
src/cli/, src/file-system/, src/app-files/   (unchanged)
```

- `engine/components/` holds the test helpers that more than one engine feature, or the engine root, shares.
- `shared/bun-only-code.ts` is the one test-only module in `src/shared/`. Two Bun-side packages share it, so the posts
  package's tests no longer import the engine.
- `documents/documents/` holds the post table beside its one user, and `documents/components/` holds the post dialogs
  and the shortcut helper that two documents components share.
- `chat/agent-panel/` holds the model picker beside its one user.
- **Final checks:**
  - `make test` passes the type-check, the Node check, 523 server tests (38 files), and 502 UI tests (19 files), the
    same as the baseline.
  - `make check-build` passes, and the binary serves all three app skills.

## Decisions the owner should look at first

- **D-1:** This run used a new branch, pushed each commit, and opened draft PR
  [#43](https://github.com/mxriverlynn/3Pitor/pull/43), as you asked once the run had started. That overrides the
  skill's default of committing only to the current branch.
- **D-9:** `bun-only-code.ts` now lives in `src/shared/`, though no browser code uses it. Your rule says `src/shared/` is
  "used by both the browser and Bun code". The README's `src/shared/` section now also admits test-only code that
  Bun-side packages share. This was the closest call in the run, and it reads your rule more widely than you wrote it.
  Every other home fails a check or keeps a wrong-way import:
  - `posts/components/` trips the posts deep-import scan from the engine's test.
  - Leaving it in the engine keeps the posts test importing a package that depends on posts.
- **D-12:** `server/scripts/check.ts` stayed put, against the analysis's A7. Two earlier change sets kept it there on
  purpose, and `make test` never runs it, so a moved path would break `bun run check` silently. The README now calls
  `scripts/` a named exception to the feature rule.
- **D-7:** post-table and model-picker each lost their own folder and now sit flat beside their one user. This follows
  the last run's D-5 (link-popup). The README had described `model-picker/` as a folder, and model-picker mostly
  changes on its own, so you may prefer folders here. The trigger for a folder is a second importer.
- **README corrections (entry 6):** The posts intro said "Nothing in the app uses the package yet". That was stale, and
  the README now says who uses it.

## Units not done

None. All three planned units finished green.

## Follow-ups not done here (behavior changes)

Each changes something a user, a caller, or the test suite can see, so none belongs in a pure restructure. Each traces
to the analysis report:

1. **A10 (B2, B4, R1):** four boundary-test scans pass when they find no files. A future move of a package root would
   leave them checking nothing, with `make test` green.
2. **A11 (S6, R2):** no test enforces the server's and cli's import rules into the engine. The README now names the
   allowed test-facing modules, which a boundary test could check.
3. **A12 (B6, R4):** `make check-build` never fetches `/`, so a broken UI bundle or CSS path ships silently.
4. **A13 (S11):** `shared/wire.ts` restates the post shapes from `posts/posts.ts`, and no test ties the two.
5. **A14:**
   - C2: parallel Edit tool calls on one post can lose an edit. This is unverified, because nobody traced whether the
     tools actually run in parallel.
   - C5: one `readdir` error stops the workspace watcher for good.
   - C6: the MCP endpoint's `stop()` may be skipped on some exit path. This is unverified.
   - C7: one throwing EventBus listener stops the rest.
   - C8: the UI does not re-sync after a socket reconnect.
   - B5: only `.md` skill files are embedded in the binary.
   - B10: `glob.ts` turns every `FileSystemError` into "no matches".
6. **A stale sample string (not code):** the sample import string at `src/posts/boundary.test.ts:125` still shows
   `../../shared/entry-name`. It is a sample fed to the checker, not an import, so it is harmless, but it now names a
   path that does not exist.

# Change Log: Update the Code Structure by Package, Feature, and Component

This is the running log of every change made in this change set, in the order it was made. The owner was away and
asked for every decision to be made and justified here. Each entry says what changed and why, and links the decision
(D-N) behind it.

**Where to read more:**

- [change-plan.md](change-plan.md): the plan these changes carry out.
- [artifacts/change-decision-log.md](artifacts/change-decision-log.md): every decision, with its reasoning and the
  alternatives rejected.
- [artifacts/architectural-analysis.md](artifacts/architectural-analysis.md): the analysis that found the risks.

**Branch:** `update-code-structure-2026-10-01`, created from `main` at `5f90393`. Every step below is one commit on it.
The owner asked for a new branch, commits pushed as the run goes, and a draft PR when this run was started. That
overrides the skill's default of committing only to the current branch (D-1).

**Baseline before any change:** `make test` passes 272 server tests (23 files) and 446 UI tests (16 files), and the
type-check exits 0.

**Precedent:** [update-code-structure-2026-09-30](../update-code-structure-2026-09-30/change-log.md) is the most recent
structure change set, and [restructure-by-feature](../restructure-by-feature/change-log.md) set the layout. Their
decisions are followed here unless an entry below says otherwise.

**What changed since the last run:** 125 commits added these modules under `src/`. Each needs a place under the rules:

- `server/server.test.ts`
- `ui/components/panel-resizer/` (used only by `app.tsx`)
- `ui/documents/file-tree/entry-name.ts` (used only by `file-tree.tsx`)
- `ui/documents/markdown-editor/highlight-outline.ts` and `raw-syntax.ts` (used only inside the editor)
- `ui/popups/link-popup/` (used only by `documents/markdown-editor/markdown-editor.tsx`, a cross-feature import in a
  package where the README says `app.tsx` is the only file that wires features together)

## 1. Architectural analysis

- **Commit:** `e07e27f` Add the architectural analysis for updating the code structure
- **What:** Ran `/architectural-analysis` on `src/` at medium size with five agents: structural, behavioral,
  concurrency, risk, and software-architect. The report is `artifacts/architectural-analysis.md`. It holds S1–S8,
  B1–B13, C1–C6, R1–R6, and A1–A4.
- **Why:** The analysis finds what makes moving files unsafe before anything moves.
- **Decisions:** D-1 (new branch, pushes, and draft PR), D-2 (medium size), D-3 (no separate readability editor
  pass).
- **Key result:** One placement violation since the last run (S1: `ui/popups/link-popup/` is used only by the markdown
  editor). Its fix forces a second move: `popups/components/anchored-bubble` goes up to `ui/components/`, because its
  users would then span two features (A1). The highest move risk (R1) is still the set of paths that `make test` and
  the type-checker cannot see. The new `server.test.ts`, which must stay beside `server.ts`, is one of them. The new
  file watcher adds one single-definition rule: `isHiddenName` (R3).

## 2. Change plan

- **Commit:** `c060121` Plan the code structure update
- **What:** Ran `/plan-a-change` at small size, reusing the analysis as the current state. It wrote these files:
  - `change-plan.md`
  - `artifacts/current-state-findings.md` (C-1 to C-6)
  - `artifacts/scope-boundary.md`
  - decisions D-4 to D-12 in `artifacts/change-decision-log.md`
  - two check scripts, `artifacts/cross_feature.py` and `artifacts/css_snapshot.sh`

  One review round ran (`junior-developer`, `test-engineer`). Its findings changed the plan's checks, D-5, D-6, D-10,
  and S-3, and added D-11.
- **Why:** The plan sets the target before any code moves.
- **Decisions:**
  - D-4: no confirmation turn.
  - D-5: link-popup goes flat into `markdown-editor/`.
  - D-6: anchored-bubble goes up to `ui/components/anchored-bubble/`.
  - D-7: one unit, and nothing else moves.
  - D-8: the README lines for the moved files change in that unit.
  - D-9: small size.
  - D-10: CSS order is proven by a bundle diff.
  - D-11: every check is a command.
  - D-12: no separate readability pass.
- **Result:** One `refactor` unit, and every entry is behavior-preserving. Six deferrals carry triggers. The behavior
  changes found by the analysis are cut as follow-ups.

## 3. Unit 1: move link-popup into the markdown editor, and anchored-bubble up to `ui/components/` (`/refactor`)

- **Commit:** `4eecf9f` Move the link popup into the markdown editor, and the anchored bubble up to ui/components
- **What:**
  - `src/ui/popups/components/anchored-bubble.ts` → `src/ui/components/anchored-bubble/anchored-bubble.ts`
  - `src/ui/popups/components/anchored-bubble.css` → `src/ui/components/anchored-bubble/anchored-bubble.css`
  - `src/ui/popups/link-popup/link-popup.tsx` → `src/ui/documents/markdown-editor/link-popup.tsx`
  - `src/ui/popups/link-popup/link-popup.css` → `src/ui/documents/markdown-editor/link-popup.css`
  - `src/ui/popups/link-popup/link-popup.test.tsx` → `src/ui/documents/markdown-editor/link-popup.test.tsx`
  - Four import specifiers changed, and no import line moved. `markdown-editor.tsx` imports `./link-popup`.
    `link-popup.tsx`, `question-popup.tsx`, and `selection-popup.tsx` import
    `../../components/anchored-bubble/anchored-bubble`.
  - The empty `popups/components/` and `popups/link-popup/` folders are gone.
  - In the README, `popups/` lists the two popups `app.tsx` wires. A new `markdown-editor/link-popup.tsx` bullet and a
    new `components/anchored-bubble/` bullet describe the moved modules.
  - The refactor ran as two named steps, Move Module for anchored-bubble and then for link-popup, with `make test`
    green after each.
- **Why:** The rule says a component folder holds "the helpers only it uses", and the markdown editor is link-popup's
  only user (report S1). Once link-popup lives in documents, anchored-bubble's users span two features, so
  `ui/components/` is the lowest scope that covers them (A1).
- **Decisions:** D-5 (link-popup flat in `markdown-editor/`), D-6 (anchored-bubble's folder), D-7 (one unit), D-8
  (README lines in the same unit), D-10 (CSS diff), D-11 (checks as commands). No new decisions.
- **Tests:**
  - `make test` passes the type-check, 272 server tests (23 files), and 446 UI tests (16 files), the same as the
    baseline.
  - `git diff -M` shows four renames at 100% and `link-popup.tsx` at 97% (its one import line).
  - The stale-path grep finds nothing.
  - The bundled CSS rules are identical to the baseline, and in the same order once the two moved paths are rewritten.
  - `cross_feature.py` exits 0: no UI import crosses from one feature into another.

## 4. README layout section and the build check

- **Commit:** `b12cd1d` Describe the updated code structure in the README
- **What:** The README's "How `src/` is laid out" section now covers every file and behavior that landed since the
  last run, all placed where they already were:
  - `server/server.test.ts`, with the note that it must sit beside `server.ts`.
  - `server.ts` starting the workspace watcher, and `documents.ts`'s `watchDocuments`, which ignores hidden names.
  - The UI's `documents.tsx` following the disk on `documents-changed`, on connecting, and on reload.
  - `file-tree/entry-name.ts`, `markdown-editor/highlight-outline.ts`, and `markdown-editor/raw-syntax.ts`.
  - A correction. The chat-tools bullet said "Nothing in them writes a file", but the tools now write markdown notes
    under `.3pitor/` directly, through `json-file.ts`'s `writeText`. The bullet and the `json-file.ts` bullet say so.
- **Why:** Step 6 of the skill. The README is the only written record of the layout rules (C-6 and report S7), so it
  has to describe the tree as it stands.
- **Decisions:** D-8.
- **Tests:**
  - `make test` passes the type-check, 272 server tests, and 446 UI tests.
  - `make check-build` compiles `build/3pitor` and starts it from an empty folder. The binary serves
    `{"skills":["collaborative-editing","proofread","research"],"agents":["title-writer"]}` and reports `3pitor dev`.

## Where things ended up

This change set is small, because the tree still followed the owner's rules almost everywhere. It makes one placement
fix in two moves, and a README that matches the code again.

```
src/server/  server.ts server.test.ts agent-host.ts command-line.ts paths.ts text-imports.d.ts scripts/
             chat/{sessions,agent,claude-backend,claude-cli,tools,components}/
             components/  documents/  events/  view-state/  workspace/  workspace-config/
src/ui/      app.tsx index.html styles.css css.d.ts test-setup.ts
             components/{anchored-bubble,menu,agent-actions,panel-resizer}/ api.ts fake-documents-api.ts
             events/  documents/{documents,file-tree,markdown-editor,components}/
             chat/{chat,agent-panel}/  popups/{question-popup,selection-popup}/
src/shared/  wire.ts markdown.ts markdown-support.ts passages.ts blocks.ts
```

- `documents/markdown-editor/` now holds `link-popup.tsx`, its CSS, and its test, beside the editor that is its only
  user.
- `ui/components/anchored-bubble/` holds the bubble placement and styles that the link, question, and selection popups
  share.
- `popups/` holds only the two popups that `app.tsx` wires. No UI file outside `app.tsx` imports from another feature.
- **Final checks:** `make test` passes the type-check, 272 server tests (23 files), and 446 UI tests (16 files), the
  same as the baseline. `make check-build` passes, and the binary serves all three app skills.

## Decisions the owner should look at first

- **D-1:** This run used a new branch, pushed each commit, and opened draft PR #27, as you asked when starting it. That
  overrides the skill's default of committing only to the current branch.
- **D-5:** link-popup sits flat in `markdown-editor/`, not in its own `documents/link-popup/` folder. This follows the
  `raw-view.tsx` precedent: a React component that only the editor uses counts as the editor's helper. It is the
  closest call in the run. If you read "one folder per component" as covering every React component, both files would
  want folders.
- **D-6:** Moving link-popup forced anchored-bubble up to `ui/components/`. Without that move, the editor would reach
  into the popups feature's `components/` folder instead.
- **D-10:** The CSS cascade was proven unchanged by diffing the bundled CSS, not by opening the app. The analysis had
  suggested a look by hand.
- **README correction (entry 4):** The README said the chat tools never write files. They write `.3pitor/` notes
  directly, and the layout section now says so. The opening paragraph's "Claude never writes files" is outside the
  layout section and was left alone (see the follow-ups).

## Units not done

None. The one planned unit finished green.

## Follow-ups not done here (behavior changes)

Each changes something a user or caller can see, so none belongs in a pure restructure. Each traces to the analysis
report's findings:

1. **C1:** A note edit in the chat tools reads the note outside `json-file.ts`'s write queue. Two parallel edits of one
   note can lose one. This is unverified: nobody traced whether the tools actually run in parallel.
2. **C2, C6:** The per-turn `TurnTexts` race, and document writes with no ordering or no-clobber guarantee. Both carry
   over from the previous run's F1 and F2.
3. **C5:** A disk sync that lands between a chat turn's start and its merge, on a file without unsaved edits.
4. **B6, B8:** Validating stored `view.json` and incoming socket frames, and backing off between socket reconnects.
5. **B9:** `server.test.ts` discards the server's stderr, so a startup crash fails the test without saying why.
6. **B2, R6:** Running `make check-build` as part of `make test` or CI (the previous run's F7).
7. **README opening paragraph (documentation, not code):** "Claude never writes files" is no longer strictly true,
   because of the `.3pitor/` notes. That paragraph describes the product, so the owner should decide its wording.

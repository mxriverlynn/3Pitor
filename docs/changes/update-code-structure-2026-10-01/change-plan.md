# Change Plan: Update the Code Structure (2026-10-01)

## Why This Change

The owner wants `src/` laid out by package, then feature, then component, with shared code at the lowest scope that
covers every user, and no behavior changes. This is a deliberate improvement with no triggering event. Its evidence is
the [architectural analysis](artifacts/architectural-analysis.md) of 2026-10-01. That analysis found one file placed
against the rules since the previous run (S1). The boundary is the owner's rule set, recorded word for word in
[scope-boundary.md](artifacts/scope-boundary.md)
([D-4](artifacts/change-decision-log.md#d-4-take-the-scope-boundary-as-recorded-without-a-confirmation-turn)).

## What Changes, In One Paragraph

The link popup moves into the markdown editor's component folder, because the editor is its only user. Its positioning
helper, anchored-bubble, then has users in two features, so it moves up to the UI package's shared `components/`
folder. Afterwards, `app.tsx` is again the only UI file that imports from another feature. Each popup still looks and
behaves exactly as before, and the bundled CSS is the same rules in the same order.

## Current State

- `LinkPopup` lives in `src/ui/popups/link-popup/`, but only `documents/markdown-editor/markdown-editor.tsx` imports
  it. That makes it the one UI import between features outside `app.tsx`
  ([C-1](artifacts/current-state-findings.md#c-1-link-popup-has-one-importer-in-another-feature)).
- `useAnchoredBubble` lives in `src/ui/popups/components/`, and link-popup, question-popup, and selection-popup all
  import it ([C-2](artifacts/current-state-findings.md#c-2-anchored-bubble-is-shared-by-all-three-popups)).
- Only static imports reach either module, so `tsc --noEmit` catches every broken path
  ([C-3](artifacts/current-state-findings.md#c-3-no-string-specifier-reaches-either-module)).
- CSS reaches the bundle through side-effect imports, in the order modules are reached from `app.tsx`
  ([C-4](artifacts/current-state-findings.md#c-4-css-order-in-the-bundle-follows-import-traversal-from-apptsx)).
- Many other files are pinned, must move in pairs, or must stay single instances. None of them is in this plan
  ([C-5](artifacts/current-state-findings.md#c-5-pinned-files-move-together-pairs-and-single-instances)).
- The README still places anchored-bubble under popups, and omits five newer files
  ([C-6](artifacts/current-state-findings.md#c-6-the-readme-describes-anchored-bubble-as-a-popups-helper-and-omits-link-popup)).

The structural property this change addresses: a single-user module that sits in a feature other than its user's. The
owner's rule that settles it is "a component folder holds … the helpers only it uses." The README's statement that
`app.tsx` is the UI's only wiring point is the current reading of that rule for the UI. It is not a separate rule, and
it does not apply to the server, where the previous run accepted imports between features of a public API.

## Target State

```
src/ui/
  components/
    anchored-bubble/            <- from popups/components/
      anchored-bubble.ts
      anchored-bubble.css
    agent-actions/  menu/  panel-resizer/  api.ts  fake-documents-api.ts     (unchanged)
  documents/markdown-editor/
    link-popup.tsx              <- from popups/link-popup/
    link-popup.css
    link-popup.test.tsx
    markdown-editor.tsx ...                                                  (unchanged)
  popups/
    question-popup/  selection-popup/                                        (popups/components/ and popups/link-popup/ gone)
```

- **`documents/markdown-editor/`** owns the editor and everything only it uses, now including the link popup
  ([D-5](artifacts/change-decision-log.md#d-5-move-link-popup-into-the-markdown-editor-component-folder-flat-beside-the-editor)).
- **`ui/components/anchored-bubble/`** owns placing a bubble beside the button that opened it, and closing it on a
  press elsewhere. It serves the documents and popups features
  ([D-6](artifacts/change-decision-log.md#d-6-move-anchored-bubble-up-to-srcuicomponentsanchored-bubble)).
- **`popups/`** holds only the two popups that `app.tsx` wires: question-popup and selection-popup.

**Contracts.** No contract changes. `LinkPopup`'s props and `useAnchoredBubble`'s signature are unchanged, and only
their import specifiers change. These are the four specifier edits, and nothing else in an import block moves:

```
markdown-editor.tsx   '../../popups/link-popup/link-popup'  -> './link-popup'
link-popup.tsx        '../components/anchored-bubble'       -> '../../components/anchored-bubble/anchored-bubble'
question-popup.tsx    '../components/anchored-bubble'       -> '../../components/anchored-bubble/anchored-bubble'
selection-popup.tsx   '../components/anchored-bubble'       -> '../../components/anchored-bubble/anchored-bubble'
```

## Surface Delta

### S-1: `anchored-bubble` module (`useAnchoredBubble`, `anchored-bubble.css`) — Moved

**Target state.** `useAnchoredBubble` is exported from `src/ui/components/anchored-bubble/anchored-bubble.ts`, which
imports `./anchored-bubble.css` beside it. It takes the same arguments and returns the same values it does today.
link-popup, question-popup, and selection-popup import it from there.

**Behavior.** Preserving. The module's contents are unchanged and only its path moves. The bundled CSS rules stay
identical and in the same order, which the D-10 check proves.

**Why.** After S-2 its users span the documents and popups features, so `ui/components/` is the lowest scope that
covers them.

**Migration.** Import from `'../../components/anchored-bubble/anchored-bubble'` (from a popup or editor folder).

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-move-anchored-bubble-up-to-srcuicomponentsanchored-bubble)

### S-2: `link-popup` module (`LinkPopup`, `link-popup.css`, `link-popup.test.tsx`) — Moved

**Target state.** `LinkPopup` is exported from `src/ui/documents/markdown-editor/link-popup.tsx`, with
`link-popup.css` and `link-popup.test.tsx` beside it. `markdown-editor.tsx` imports it as `./link-popup`. Its props
and rendering are unchanged.

**Behavior.** Preserving. The contents are unchanged, the test moves with the module and still imports `./link-popup`,
and the editor renders the same element at the same place.

**Why.** The markdown editor is its only user, and the rules put a helper only one component uses in that component's
folder.

**Depends on.** S-1 (lands in the same unit).

**Migration.** Import from `'./link-popup'` inside `markdown-editor/`.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-move-link-popup-into-the-markdown-editor-component-folder-flat-beside-the-editor)

### S-3: README layout lines for the popups and `ui/components/` — Re-scoped

**Target state.** The README's `popups/` entry lists question-popup and selection-popup only. A
`markdown-editor/link-popup.tsx` bullet describes the link form bubble. A `components/anchored-bubble/` bullet under
the UI's shared components says three things. It places the link, question, and selection popups by the button that
opened them. It closes them on a press elsewhere. Its CSS styles all three bubbles, since question-popup has no CSS of
its own.

**Behavior.** Preserving. Documentation only.

**Why.** The README is the written record of the layout, and must describe the tree as it stands after the move.

**Depends on.** S-1, S-2.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-update-the-readmes-lines-for-the-moved-files-in-the-same-unit-and-leave-the-full-inventory-to-step-6)

## Behavior Changes

None. Every entry is behavior-preserving. The modules move with their contents unchanged, and the bundled CSS is
checked to be rule-for-rule identical.

## Change Units

### Unit 1: Move link-popup into the markdown editor, and anchored-bubble up to `ui/components/` (`refactor`)

**What it does.** Moves five files with `git mv`, edits four import specifiers, removes the two emptied folders, and
updates the README's lines for the moved files.

**Delta entries.** S-1, S-2, S-3.

**Ordering constraint.** None before it. Both moves land together, because either alone leaves a rule broken
([D-7](artifacts/change-decision-log.md#d-7-do-both-moves-in-one-refactor-unit-and-move-nothing-else)).

**How you know it worked.** Each check is a command, so it runs unattended
([D-11](artifacts/change-decision-log.md#d-11-make-every-unit-1-check-a-command-with-an-exact-expected-result)).

1. **Before moving anything**, snapshot the CSS: `artifacts/css_snapshot.sh <scratch>/css-before`.
2. `make test` passes the type-check and the same counts as the baseline: 272 server tests (23 files) and 446 UI tests
   (16 files). The list of test files is the same, with `link-popup.test.tsx` at its new path. `tsc` covers every
   import specifier under `src/` (C-3).
3. `git diff --cached -M --stat` (after `git add -A`) shows four renames at 100% similarity:
   - `link-popup.css`
   - `link-popup.test.tsx`
   - `anchored-bubble.ts`
   - `anchored-bubble.css`

   `link-popup.tsx` shows as a rename with its one import line changed. `question-popup.tsx`, `selection-popup.tsx`, and
   `markdown-editor.tsx` each change one import line.
4. `grep -rnE "popups/link-popup|popups/components|'\.\./components/anchored-bubble'" src README.md` returns nothing,
   and `ls src/ui/popups` lists only `question-popup` and `selection-popup`.
5. After the move, run `artifacts/css_snapshot.sh <scratch>/css-after`. Then check two things
   ([D-10](artifacts/change-decision-log.md#d-10-prove-the-css-cascade-is-unchanged-by-diffing-the-bundled-css-not-by-eye)):
   - `diff css-before/rules.css css-after/rules.css` is empty.
   - `diff` of `css-before/order.txt`, with its two old paths rewritten to the new ones, against `css-after/order.txt`
     is also empty.
6. `python3 artifacts/cross_feature.py` exits 0. It lists every relative import under `src/ui` that goes from one
   feature folder into another, ignoring root files such as `app.tsx` and the shared `ui/components/`. Today it lists
   exactly `markdown-editor.tsx:38`.

## Risks

- **CSS order (report B3, R4).** A reordered import line could change the cascade without failing any test. Mitigation:
  edit specifiers only, never line order, and run the D-10 bundle diff.
- **A stale path that tsc cannot see (report R1).** None exists for these files (C-3). The grep in check 3 confirms it
  after the move.
- **Blast radius.** One package, five files, four importers. Reverting is one `git revert`.

## Deferred (YAGNI)

These carry over from the report's A3 and "Deferred (YAGNI)" list, and from the previous run:

- **`ui/view-state/` feature.** Trigger: a UI reader or writer of the view state outside `app.tsx` and `documents.tsx`.
- **A `raw-view/` component folder.** Trigger: a raw-* module gains an importer outside `markdown-editor/`.
- **Moving `workspace-config` under `chat`.** Trigger: workspace-config loses its own route and HTTP consumer.
- **Moving `postName` to `server/components/`.** Trigger: a second production importer outside chat.
- **Shared route, stream-part, and `.md` constants in `src/shared`.** Trigger: a server/UI mismatch that ships.
- **Regrouping question-popup and selection-popup under `chat/`.** Trigger: a popup gains an importer other than
  `app.tsx`, or a server counterpart.

## Cut for Scope

These analysis findings are behavior changes, which the boundary excludes. Each is a follow-up, not a unit:

- **C1 (report):** a note edit in `tools.ts` reads outside the write queue, so two parallel edits of one note can lose
  one.
- **C2, C6 (report):** the per-turn `TurnTexts` race, and unsequenced document writes.
- **C5 (report):** a disk sync landing between a turn's start and its merge.
- **B6, B8, B9 (report):** validating `view.json` and socket frames, reconnect backoff, and `server.test.ts` discarding
  the server's stderr.
- **B2, R6 (report):** running `make check-build` as part of `make test`.

## Open Items

None.

## Review Findings

One round, as the size allows
([D-9](artifacts/change-decision-log.md#d-9-size-the-plan-small-with-junior-developer-and-test-engineer-for-one-review-round)).
`han-core:junior-developer` and `han-core:test-engineer` reviewed the plan. Neither found a blocking problem, and both
called the plan's size proportionate to its reason. Their findings changed the plan in four places:

- **The checks in Unit 1** (both reviewers). The rename check expected 100% similarity for a file the unit edits. The
  grep could not match the actual stale specifier. The cross-feature check named no command. All three are fixed, and
  the checks are now runnable scripts
  ([D-11](artifacts/change-decision-log.md#d-11-make-every-unit-1-check-a-command-with-an-exact-expected-result)).
- **The CSS diff** (test-engineer). It now strips only Bun's per-file header lines, compares the CSS by glob rather
  than by hashed name, and diffs the header order separately (D-10, updated).
- **D-5** (junior-developer) now records the sibling-folder alternative, `documents/link-popup/`. **D-6** states the
  folder pattern the tree actually follows.
- **S-3** (junior-developer) now says anchored-bubble's CSS styles all three bubbles.

Notes not acted on: a negative control for the CSS diff (D-11 explains why), and test-engineer's Unverified test counts,
which Unit 1's `make test` settles.

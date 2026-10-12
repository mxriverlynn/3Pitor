# Change Plan: Simplified UI Redesign

## Why This Change

This plan rebuilds 3pitor's browser app to match a five-screen Claude Design canvas, because the operator asked for an
app that is "as simple as possible, clean, easy to understand". The canvas is built on a UX audit. Its layout, copy and
colors are written out in [canvas-reference.md](artifacts/canvas-reference.md), so the builder never needs the canvas
link ([D-27](artifacts/change-decision-log.md#trivial-decisions)). The change is a deliberate improvement with no
triggering defect. The source is the operator's own requests, recorded in
[scope-boundary.md](artifacts/scope-boundary.md). The run settled every open question itself, at the operator's
standing request ([D-20](artifacts/change-decision-log.md#trivial-decisions)).

## What Changes, In One Paragraph

After this change the app is three columns: Posts, the post, and Claude. There is no top bar. A banner appears only when
the connection to 3pitor is lost. The post has one header: its name, Unsaved or Saved, a Formatted/Markdown switch, and
Save. The toolbar is shorter. After Claude replies, a review strip counts what Claude changed and asked, and steps
through those passages. After a confirmation, it can undo the reply in every post it touched. Every way of asking Claude
ends in the same message box: a question pill or a selected passage becomes a chip there, and the two popups are gone.
While Claude works, one status line says so, and the file list says why it is paused. Screen readers hear when Claude
starts and finishes. Errors are red, information is neutral, and New chat asks first. Empty screens offer a next step.
Claude has one name everywhere. No code outside `src/ui/` changes, and the server receives exactly the same messages
([D-3](artifacts/change-decision-log.md#d-3-no-server-engine-or-shared-change)). The README's description of the moved folders is updated
([D-26](artifacts/change-decision-log.md#trivial-decisions)).

## Current State

The browser app concentrates the redesign's editor-side work in one 970-line component, `MarkdownEditor`. It is the
area's highest-churn file
([C-1](artifacts/current-state-findings.md#c-1-markdowneditor-owns-the-toolbar-mode-switch-highlight-bar-raw-pane-link-popup-and-ask-button)).
The structural property this change addresses is that editor controls hang off the DOM of ProseMirror, the editor
library. The mode switch
and the highlight bar are portaled into the menubar that `prosemirror-menu` builds, so they vanish when a read-only file
hides that menubar
([C-2](artifacts/current-state-findings.md#c-2-the-mode-switch-the-highlight-bar-and-the-raw-pane-are-portaled-into-the-prosemirror-menubar)).
The toolbar is the ProseMirror example menu
([C-3](artifacts/current-state-findings.md#c-3-the-formatting-toolbar-is-the-example-setup-menu-wrapped-by-rawaware)).

Asking Claude runs through two anchored popups. `App` holds their state and keeps only one open at a time. Each popup
builds the exact message text the server receives. When Claude's highlights change, `App` moves a question popup's
typed text into the chat box with its label
([C-5](artifacts/current-state-findings.md#c-5-the-two-ask-popups-own-the-message-formats-the-server-receives),
[C-6](artifacts/current-state-findings.md#c-6-app-holds-the-popup-state-keeps-one-popup-open-at-a-time-and-moves-typed-text-to-the-chat-box)).

Three facts shape the new behavior:

- **Undo all.** The text of a post before Claude's reply is not kept anywhere. The nearest record, `turnBases`, is
  overwritten by every merge
  ([C-14](artifacts/current-state-findings.md#c-14-no-pre-turn-text-is-kept-turnbases-is-a-merge-base-that-each-merge-overwrites)).
- **Mod-Z.** The keyboard undo history only covers the file on screen
  ([C-15](artifacts/current-state-findings.md#c-15-a-turn-lands-as-one-merge-per-tool-call-mod-z-undoes-them-one-at-a-time-only-while-the-file-is-shown)).
- **Keep my version.** Dismissing the "changed on disk" notice would not stick, because the next sync raises it again
  ([C-13](artifacts/current-state-findings.md#c-13-dismissing-the-changed-on-disk-notice-would-not-stick)).

Tests pin today's labels and the menubar's DOM
([C-21](artifacts/current-state-findings.md#c-21-tests-pin-todays-labels-and-the-menubars-dom)).

## Target State

[canvas-reference.md](artifacts/canvas-reference.md) is the visual reference for layout, copy and color. This plan and
its decision log win where they differ, and say why ([D-22](artifacts/change-decision-log.md#trivial-decisions)).

### Shell, theme and connection

- **`app.tsx` and `styles.css`.** They own the layout. `.main` keeps its five grid tracks: tree, resizer, post,
  resizer, Claude. The top bar is gone, and "3pitor" sits in the Posts panel header
  ([D-16](artifacts/change-decision-log.md#d-16-no-top-bar-a-banner-appears-only-when-the-connection-is-lost)).
- **`useHostEvents`.** It returns `boolean | undefined`, where `undefined` means the socket has not yet opened or
  closed. While it is `false`, a fixed banner covers the top of the page without pushing the post down. When the
  connection returns, the chat's status region announces it.
- **Tokens.** `styles.css` holds every color and font token, with dark-mode values for all of them. The post text uses
  a local serif stack. No web fonts are loaded ([D-17](artifacts/change-decision-log.md#d-17-the-canvass-palette-and-local-font-stacks)).
- **Notices.** `styles.css` owns `.notice` (neutral) and `.notice.error` (red, always with `role="alert"`). Each notice
  has an inline SVG icon that adds no text. There is no notice component
  ([D-15](artifacts/change-decision-log.md#d-15-notices-are-neutral-by-default-and-red-when-they-report-an-error)).
- **Shared components.** `components/` gains two things.
  - `confirm-dialog/`: a native modal dialog that New chat and Undo all both use
    ([D-23](artifacts/change-decision-log.md#d-23-one-confirmation-dialog-component-used-by-new-chat-and-undo-all)).
  - `shortcut.ts`: platform shortcut hints, "⌘S" on a Mac and "Ctrl+S" elsewhere
    ([D-19](artifacts/change-decision-log.md#d-19-the-post-headers-file-name-replaces-find-in-docs-shortcut-hints-follow-the-platform)).

  Every action that removes the focused button moves focus to a fixed place
  ([D-25](artifacts/change-decision-log.md#d-25-focus-goes-somewhere-sensible-when-the-focused-control-disappears)).

```ts
export function ConfirmDialog(props: {
  title: string; body: string; confirm: string; onConfirm: () => void; onCancel: () => void;
}): JSX.Element;                                  // <dialog> via showModal(); focus starts on Cancel; Escape cancels
export const isMac: boolean;
export function shortcut(key: string): string;    // shortcut('S') === '⌘S' on a Mac, 'Ctrl+S' elsewhere
```

### The post column

**`Editor`** (`documents/documents/documents.tsx`) owns:

- **The post header.** The folder in muted text. The file name, as a button named "Show {name} in Posts" that runs
  `findInDocs`. Unsaved or Saved, shown only when a file is open. The Formatted/Markdown switch. Save, with a shortcut
  hint ([D-2](artifacts/change-decision-log.md#d-2-the-formattedmarkdown-switch-moves-into-the-post-header), [D-19](artifacts/change-decision-log.md#d-19-the-post-headers-file-name-replaces-find-in-docs-shortcut-hints-follow-the-platform)).
  - The switch reads `docs.mode` and calls `docs.setMode`. `ViewState.mode` keeps its stored values
    `'rendered' | 'raw'`.
  - For a read-only file, the switch is disabled with Formatted pressed, and the read-only notice describes it.
- **The notices.**
- **The empty state.** A New post button, which calls `docs.requestNewPost()`, is disabled while `busy`, and is
  described by the tree's pause note ([D-14](artifacts/change-decision-log.md#d-14-the-empty-editor-offers-new-post-through-a-request-counter)).

**`MarkdownEditor`** keeps:

- The ProseMirror plugins and the raw pane.
- The trimmed toolbar: Join up, Lift and Select parent are gone, and "Type..." reads "Text"
  ([D-1](artifacts/change-decision-log.md#d-1-keep-prosemirror-menu-for-a-trimmed-toolbar)).
- Ownership of the highlight count, the current passage and stepping.

`MarkdownEditor` is no longer responsible for the mode switch or for drawing the strip. It renders `ReviewStrip` as a
plain sibling before its `.rich-editor` host. `ReviewStrip` (`documents/markdown-editor/review-strip.tsx`) only draws
([D-4](artifacts/change-decision-log.md#d-4-a-review-strip-replaces-the-highlight-bar-and-shows-on-read-only-files)):

```ts
export function ReviewStrip(props: {
  passages: Passage[];
  placed: number;
  current: number;
  onStep: (step: -1 | 1) => void;
  turn?: { files: string[]; pending: boolean; onUndoAll: () => void }; // only when the open file is in lastTurn.files
  onDismiss: () => void;
}): JSX.Element | null;
export function reviewSummary(passages: Passage[], files?: string[]): string;
// [{quote:'a'},{quote:'b'},{quote:'c',label:'Q1',question:'?'}] → 'Claude changed 2 passages and left 1 question'
// [] with a turn → 'Claude changed this post'; files.length === 3 → '… in 3 posts'
```

`MarkdownEditor`'s props change as follows:

```ts
// removed: onModeChange, onClearHighlights, askingSelection
review?: { turn?: { files: string[]; pending: boolean; onUndoAll: () => void }; onDismiss: () => void };
onAsk?: (passage: Passage & { label: string }) => void; // was (ask: Ask)
onAskSelection?: (markdown: string) => void;             // was (ask: SelectionAsk)
```

**`useDocuments`** owns Undo all and dismissing the review ([D-5](artifacts/change-decision-log.md#d-5-undo-all-asks-first-then-restores-each-file-claude-touched-to-its-text-at-send)).

- **What it records.**
  - `beginTurn` records `{ text, saved, dirty }` for every opened file.
  - `applyEdited` adds each file it touches to `turnEdited`.
  - `applyTurn` publishes `lastTurn` for a clean, finished turn begun in this page, unless one of the edited files was
    saved since Send.
- **When the offer ends.** Saving, moving, renaming or deleting a file in `lastTurn.files` clears `lastTurn`.
- **`undoTurn`.** It runs only after the writer confirms in a dialog that names the posts and warns that their own
  typing in them goes too. It then puts each edited file back to its text at Send.
  - A file not open at Send is re-read from disk.
  - A file Claude created is forgotten.
  - A file it cannot restore is reported in the not-applied notices.
- **`dismissReview`.** It clears `lastTurn` and the highlights. `App.newChat` calls it.

```ts
type LastTurn = { files: string[] };
lastTurn: LastTurn | undefined;
undoing: boolean;
undoTurn(): Promise<void>;
dismissReview(): void;
newPosts: number;
requestNewPost(): void;
keepMyVersion(): void;
```

`Entry.diskChanged` becomes `diskText?` and `keptOver?`, so a dismissed disk version stays dismissed. `useDocuments`
still returns `diskChanged: boolean` ([D-6](artifacts/change-decision-log.md#d-6-keep-my-version-records-the-disk-text-it-dismissed)).

### The Claude column

**`AgentPanel`** owns the "Claude" heading and New chat ([D-9](artifacts/change-decision-log.md#d-9-new-chat-asks-first-and-is-disabled-while-claude-works)).

- New chat is disabled while busy.
- It confirms first unless the chat is empty, meaning no messages, no draft and no chip.
- Its signature becomes `AgentPanel({ onNewChat, busy, empty })`.

**`Chat`** and **`useChatSession`** own the message box, the chip, the status line, the status region and the tool
summary lines.

- **The chip** ([D-7](artifacts/change-decision-log.md#d-7-one-context-chip-in-the-message-box-replaces-both-ask-popups)). `ChatContext` holds what the chip refers to.
  `composeMessage` builds the outgoing text. The text is byte-identical to what the popups send today:

  ```ts
  export type ChatContext =
    | { kind: 'question'; passage: Passage & { label: string } }
    | { kind: 'selection'; markdown: string };
  export function composeMessage(text: string, context?: ChatContext): string;
  // composeMessage('Yes', {kind:'question', passage:{quote:'x', label:'Q1'}}) === 'Q1 — Yes'
  // composeMessage(' Shorter? ', {kind:'selection', markdown:'one\n\ntwo'})
  //   === 'About this passage:\n\n> one\n>\n> two\n\nShorter?'
  // useChatSession adds: context; attach(context?: ChatContext); announce(text: string)
  ```

- **`App`'s wiring.** `onAsk` and `onAskSelection` call `chat.attach`.
  - **Keeping a question chip.** It stays while Claude's highlights still contain its label.
  - **Clearing it.** When the label is gone and the draft is not blank, `App` writes `composeMessage(draft, context)`
    into the draft, so the label survives as it does today, and announces the removal.
- **⌘K.** It attaches the selection in both views and always consumes the key
  ([D-8](artifacts/change-decision-log.md#d-8-ask-callbacks-drop-the-anchor-k-attaches-the-selection-the-popups-are-deleted)).
- **The status line.** One line, "Claude is working on {file}" or "Claude is working…", replaces "thinking…" and the
  Working bar. Stop stays in the message box ([D-10](artifacts/change-decision-log.md#d-10-one-status-line-replaces-thinking-and-the-working-bar-stop-stays-in-the-message-box)).
- **The status region.** One always-mounted region carries every announcement: start, file change, finish, Undo all,
  a removed chip and a reconnect ([D-24](artifacts/change-decision-log.md#d-24-one-always-mounted-status-region-in-the-chat-carries-every-announcement)).
- **Tool activity.** Each reply's tool calls fold into one counted line, such as "Read 2 files, made 3 edits", that
  opens to show the details ([D-11](artifacts/change-decision-log.md#d-11-tool-activity-folds-into-one-counted-summary-line-per-reply)).
- **Actions.** `ACTIONS` and `ActionsMenu` live in `chat/chat/actions.tsx`. An empty chat shows them as suggestion
  buttons ([D-13](artifacts/change-decision-log.md#d-13-actions-move-into-the-chat-feature-get-plain-names-and-appear-as-suggestions-in-an-empty-chat)).

### The Posts column

`FileTree` keeps an always-mounted pause note that fills while Claude works
([D-12](artifacts/change-decision-log.md#d-12-the-file-tree-says-why-it-is-paused)). It opens its New file dialog when `docs.newPosts` increases
([D-14](artifacts/change-decision-log.md#d-14-the-empty-editor-offers-new-post-through-a-request-counter)).

## Surface Delta

### S-1: Top bar (`<header className="topbar">`, `.topbar`, `.dot`) — Removed

**Target state.** No top bar exists. The app's name sits in the Posts panel header. Connection state is shown only by
the banner in S-2.

**Behavior.** Changing. The "3pitor" title and the "events connected" dot leave the top of the page.

**Why.** The bar's only live content gates nothing and reads "disconnected" on every load
([C-19](artifacts/current-state-findings.md#c-19-connection-state-is-a-dot-in-the-top-bar-and-gates-nothing)).

**Decision.** [D-16](artifacts/change-decision-log.md#d-16-no-top-bar-a-banner-appears-only-when-the-connection-is-lost)

### S-2: Connection banner and `useHostEvents` — Added

**Target state.** `useHostEvents` returns `boolean | undefined`. It is `undefined` until the socket first opens or
closes. While the value is `false`, `App` renders a fixed `role="alert"` banner across the top of the page reading
"Lost touch with 3pitor. Is it still running in your terminal? Trying again…". When it turns `true` again, the banner
goes and the chat's status region says "Reconnected to 3pitor.". Effects that run on connect still run.

**Behavior.** Changing. A lost connection is announced and shown across the page.

**Why.** [C-19](artifacts/current-state-findings.md#c-19-connection-state-is-a-dot-in-the-top-bar-and-gates-nothing).

**Decision.** [D-16](artifacts/change-decision-log.md#d-16-no-top-bar-a-banner-appears-only-when-the-connection-is-lost)

### S-3: Theme tokens and fonts in `styles.css` — Re-scoped

**Target state.** `styles.css` defines every color and font token used by the app, each with a dark-mode value. That
includes `--bad-soft`, `--info-soft`, `--unsaved`, `--change`, `--change-line`, `--question`, `--question-line`,
`--font-ui`, `--font-post` and `--font-mono`. Text on each fill keeps 4.5:1 contrast. The rendered post uses
`--font-post` at 18px/1.7. No font is fetched from the network. A visually-hidden utility class exists for the status
region.

**Behavior.** Changing. The app takes the canvas's colors and a serif post body.

**Why.** [C-20](artifacts/current-state-findings.md#c-20-layout-and-tokens-live-in-a-70-line-stylescss).

**Decision.** [D-17](artifacts/change-decision-log.md#d-17-the-canvass-palette-and-local-font-stacks)

### S-4: `Editor`'s post header — Re-scoped

**Target state.** `Editor` renders one header.

- **Folder and file name.** The folder in muted text, then the file name as a "Show {name} in Posts" button that runs
  `findInDocs`. There is no name button when no file is open.
- **Save state.** Unsaved or Saved, shown only when a file is open.
- **The switch.** A Formatted/Markdown group named "View", with `aria-pressed` on each button. On a read-only file both
  buttons are disabled and Formatted reads pressed.
- **Save.** A Save button with `shortcut('S')` as its hint. Mod-S still saves.

The "Find in docs" magnifier does not exist.

**Behavior.** Changing. Labels, placement and the read-only switch differ; saving and mode persistence are unchanged.

**Why.** [C-11](artifacts/current-state-findings.md#c-11-the-editor-bar-holds-find-in-docs-the-file-name-the-save-state-and-save),
[C-2](artifacts/current-state-findings.md#c-2-the-mode-switch-the-highlight-bar-and-the-raw-pane-are-portaled-into-the-prosemirror-menubar).

**Depends on.** S-20.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-formattedmarkdown-switch-moves-into-the-post-header), [D-19](artifacts/change-decision-log.md#d-19-the-post-headers-file-name-replaces-find-in-docs-shortcut-hints-follow-the-platform)

### S-5: `ReviewStrip` (`documents/markdown-editor/review-strip.tsx`, `.css`) — Added

**Target state.** `ReviewStrip` draws the review strip from the props pinned in Target State. Its pieces are:

- the summary from `reviewSummary`;
- the position text;
- "Previous highlight" and "Next highlight" buttons;
- an "Undo all" button, shown only with `turn`, named "Undo Claude's changes in {names}" and disabled while
  `pending`;
- a "Dismiss review" button.

It returns `null` with no passages and no turn. `MarkdownEditor` renders it as a sibling before `.rich-editor`, so
read-only files show it. Changed passages get a forced-colors outline. The highlight bar and its CSS are gone from
`markdown-editor.tsx` and `markdown-editor.css`.

**Behavior.** Changing. See Behavior Changes.

**Why.** [C-1](artifacts/current-state-findings.md#c-1-markdowneditor-owns-the-toolbar-mode-switch-highlight-bar-raw-pane-link-popup-and-ask-button),
[C-17](artifacts/current-state-findings.md#c-17-highlights-are-one-files-list-mixing-claudes-questions-with-unlabeled-changed-passages).

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-a-review-strip-replaces-the-highlight-bar-and-shows-on-read-only-files), [D-25](artifacts/change-decision-log.md#d-25-focus-goes-somewhere-sensible-when-the-focused-control-disappears)

### S-6: `menuContent` toolbar — Re-scoped

**Target state.** The toolbar holds the formatting buttons, the Insert dropdown and a block-type dropdown labeled
"Text". Join up, Lift and Select parent do not exist. Every item is still `rawAware`.

**Behavior.** Changing. Three items are gone and one label changes.

**Why.** [C-3](artifacts/current-state-findings.md#c-3-the-formatting-toolbar-is-the-example-setup-menu-wrapped-by-rawaware).

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-keep-prosemirror-menu-for-a-trimmed-toolbar)

### S-7: `MarkdownEditor` and `RawView` props — Re-scoped

**Target state.**

- **`MarkdownEditor`.** It takes `mode` but not `onModeChange`, and `review` in place of `onClearHighlights`. Its ask
  callbacks are `onAsk(passage)` and `onAskSelection(markdown)`. It has no `askingSelection`.
- **`RawView`.** It takes the same ask callbacks and no `askingSelection`.
- **Removed types.** `Ask` and `SelectionAsk` do not exist.
- **⌘K.** Mod-k calls `askSelection` in both views and always consumes the key.
- **The floating ask button.** It is named "Ask Claude about the selection", shows `shortcut('K')` and carries
  `aria-keyshortcuts`.
- **The link popup.** Its pinned-selection behavior is unchanged.

**Behavior.** Changing. ⌘K is new; the selection is no longer held highlighted while the writer types a question.

**Why.** [C-4](artifacts/current-state-findings.md#c-4-the-question-pill-and-the-ask-button-exist-twice-for-the-rendered-view-and-the-raw-pane),
[C-6](artifacts/current-state-findings.md#c-6-app-holds-the-popup-state-keeps-one-popup-open-at-a-time-and-moves-typed-text-to-the-chat-box).

**Depends on.** S-4, S-5, S-8, S-20.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-formattedmarkdown-switch-moves-into-the-post-header), [D-4](artifacts/change-decision-log.md#d-4-a-review-strip-replaces-the-highlight-bar-and-shows-on-read-only-files),
[D-8](artifacts/change-decision-log.md#d-8-ask-callbacks-drop-the-anchor-k-attaches-the-selection-the-popups-are-deleted)

### S-8: `ChatContext`, `composeMessage`, `useChatSession.context` and `attach` — Added

**Target state.**

- **Holding and sending.** `useChatSession` holds an optional `ChatContext` and exposes `attach`. A second attach
  replaces the first. `send(text)` sends `composeMessage(text, context)` and clears the context on success. A blank or
  busy send returns false and keeps both the draft and the chip.
- **The server's text.** It is byte-identical to today's on every path, including a question chip cleared by a
  highlight change.
- **The chip.** `Chat` draws it above the textarea with a remove button. The textarea is described by the chip while
  the chip exists.
- **Focus.** Attaching or removing the chip focuses the textarea.

**Behavior.** Changing for the writer, Preserving for the server. See Behavior Changes.

**Why.** [C-5](artifacts/current-state-findings.md#c-5-the-two-ask-popups-own-the-message-formats-the-server-receives),
[C-6](artifacts/current-state-findings.md#c-6-app-holds-the-popup-state-keeps-one-popup-open-at-a-time-and-moves-typed-text-to-the-chat-box).

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-one-context-chip-in-the-message-box-replaces-both-ask-popups), [D-25](artifacts/change-decision-log.md#d-25-focus-goes-somewhere-sensible-when-the-focused-control-disappears)

### S-9: `src/ui/popups/` and `components/anchored-bubble/` — Removed and Moved

**Target state.** `QuestionPopup`, `SelectionPopup` and their tests do not exist. Asking Claude is S-8's job. The anchored
bubble lives in `documents/markdown-editor/anchored-bubble.ts` and `.css`, beside its only user, `LinkPopup`, and works
as before. The README describes the new layout.

**Behavior.** Changing (the popups are gone). The link popup is Preserving.

**Why.** [C-5](artifacts/current-state-findings.md#c-5-the-two-ask-popups-own-the-message-formats-the-server-receives).

**Depends on.** S-7, S-8.

**Migration.** Import `useAnchoredBubble` from `./anchored-bubble`.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-ask-callbacks-drop-the-anchor-k-attaches-the-selection-the-popups-are-deleted), [D-26](artifacts/change-decision-log.md#trivial-decisions)

### S-10: `useDocuments` Undo all and dismiss — Added

**Target state.** `useDocuments` records each opened file's text, saved text and unsaved state at Send. It exposes
`lastTurn`, `undoing`, `undoTurn` and `dismissReview`, as pinned in Target State and
[D-5](artifacts/change-decision-log.md#d-5-undo-all-asks-first-then-restores-each-file-claude-touched-to-its-text-at-send). `Editor` shows a `ConfirmDialog` before calling `undoTurn`, and passes the
review props to `MarkdownEditor`. `App.newChat` calls `dismissReview`. Nothing new is persisted.

**Behavior.** Changing (new). See Behavior Changes.

**Why.** [C-14](artifacts/current-state-findings.md#c-14-no-pre-turn-text-is-kept-turnbases-is-a-merge-base-that-each-merge-overwrites),
[C-15](artifacts/current-state-findings.md#c-15-a-turn-lands-as-one-merge-per-tool-call-mod-z-undoes-them-one-at-a-time-only-while-the-file-is-shown).

**Depends on.** S-5, S-19.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-undo-all-asks-first-then-restores-each-file-claude-touched-to-its-text-at-send)

### S-11: `AgentPanel` — Re-scoped

**Target state.** `AgentPanel({ onNewChat, busy, empty })` renders the heading "Claude" and a "New chat" button. The
button is disabled while busy and described by the chat's status region.

- **Empty chat.** New chat starts a new chat at once.
- **Otherwise.** It opens a `ConfirmDialog` with the copy pinned in [D-9](artifacts/change-decision-log.md#d-9-new-chat-asks-first-and-is-disabled-while-claude-works).
  Confirming calls `onNewChat` once and focuses the message box. Cancel returns focus to New chat.

The chat mode is not shown, and `App` has no `claude` state.

**Behavior.** Changing.

**Why.** [C-18](artifacts/current-state-findings.md#c-18-clear-chat-starts-a-new-session-at-once-even-while-claude-works),
[C-23](artifacts/current-state-findings.md#c-23-the-agent-panel-header-shows-the-chat-mode-and-clear-chat).

**Depends on.** S-19.

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-new-chat-asks-first-and-is-disabled-while-claude-works)

### S-12: `Chat` status line, status region and tool summary — Re-scoped

**Target state.**

- **The status line.** While busy, `Chat` shows one line, "Claude is working on {file}" or "Claude is working…",
  using `workingFile(messages)`.
- **The status region.** One always-mounted, visually hidden `role="status"` region (`id="chat-status"`) carries the
  announcements pinned in [D-24](artifacts/change-decision-log.md#d-24-one-always-mounted-status-region-in-the-chat-carries-every-announcement). They are set through
  `useChatSession.announce`.
- **Removed.** `WorkingBar` and "thinking…" do not exist.
- **Stop.** Send becomes Stop while busy.
- **Tool activity.** Each reply's tool parts render as one `<details>` whose summary is `toolLine(parts)`. Opening it
  shows today's per-tool lines.
- **Errors.** They render as `notice error` with `role="alert"`.

**Behavior.** Changing.

**Why.** [C-9](artifacts/current-state-findings.md#c-9-claudes-progress-shows-three-ways-and-stop-is-fire-and-forget).

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-one-status-line-replaces-thinking-and-the-working-bar-stop-stays-in-the-message-box), [D-11](artifacts/change-decision-log.md#d-11-tool-activity-folds-into-one-counted-summary-line-per-reply),
[D-24](artifacts/change-decision-log.md#d-24-one-always-mounted-status-region-in-the-chat-carries-every-announcement)

### S-13: `FileTree` pause note and heading — Re-scoped

**Target state.** `FileTree` keeps an always-mounted `role="status"` note (`id="tree-paused"`). While busy it reads
"Changes to the post list are paused while Claude works. You can still open posts."; otherwise it is empty. Its header
reads "3pitor" with "+", over the label "Posts". The lock is unchanged.

**Behavior.** Changing.

**Why.** [C-10](artifacts/current-state-findings.md#c-10-the-file-tree-locks-while-claude-works-with-no-visible-reason).

**Decision.** [D-12](artifacts/change-decision-log.md#d-12-the-file-tree-says-why-it-is-paused), [D-16](artifacts/change-decision-log.md#d-16-no-top-bar-a-banner-appears-only-when-the-connection-is-lost)

### S-14: Agent actions (`components/agent-actions/` → `chat/chat/actions.tsx`) — Moved

**Target state.** `ACTIONS` and `ActionsMenu` live in `chat/chat/actions.tsx` and `actions.css`. The menu button reads
"Actions". The actions are Proofread, Edit together and Research, with hints, and their skill names are unchanged. An
empty chat shows the intro sentence pinned in [D-13](artifacts/change-decision-log.md#d-13-actions-move-into-the-chat-feature-get-plain-names-and-appear-as-suggestions-in-an-empty-chat) and one button per action.
Choosing one, from the menu or a button, puts `/${skill} ` into the draft and focuses the textarea. The README describes
the new location.

**Behavior.** Changing (labels and the empty-chat buttons). The draft text each action produces is Preserving.

**Why.** [C-7](artifacts/current-state-findings.md#c-7-the--actions-menu-has-two-callers-and-a-private-action-list),
[C-8](artifacts/current-state-findings.md#c-8-both-empty-states-are-static-text).

**Depends on.** S-9.

**Migration.** Import `ActionsMenu` from `./actions` in place of `AgentActions`.

**Decision.** [D-13](artifacts/change-decision-log.md#d-13-actions-move-into-the-chat-feature-get-plain-names-and-appear-as-suggestions-in-an-empty-chat), [D-26](artifacts/change-decision-log.md#trivial-decisions)

### S-15: Empty post state, `newPosts` and `requestNewPost` — Added

**Target state.** With no file open, `Editor` shows "Pick a post to start", a sentence and a New post button. The
button is disabled while busy, is described by `tree-paused`, and calls `docs.requestNewPost()`. `FileTree` opens its
root New file dialog whenever `docs.newPosts` increases and it is not busy. `Editor` takes `busy`.

**Behavior.** Changing.

**Why.** [C-8](artifacts/current-state-findings.md#c-8-both-empty-states-are-static-text).

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-the-empty-editor-offers-new-post-through-a-request-counter)

### S-16: Notice styles — Moved and Re-scoped

**Target state.** `.notice` lives in `styles.css` as neutral information. `.notice.error` is red and is used on every
error: every notice with `role="alert"` in `Editor` and `FileTree`, plus App's chat-load error and Chat's error. Those
last two gain `role="alert"`. Each notice has an `aria-hidden` inline SVG icon that adds no text content.
`documents.css` has no `.notice` rule, and the `.error` class is gone.

**Behavior.** Changing. The look changes, and Chat and App errors are newly announced. Other roles and text are
unchanged apart from S-18.

**Why.** [C-12](artifacts/current-state-findings.md#c-12-eight-notices-share-one-blue-style-and-none-can-be-dismissed).

**Depends on.** S-3.

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-notices-are-neutral-by-default-and-red-when-they-report-an-error)

### S-17: `Entry.diskChanged` → `diskText` and `keptOver`; `keepMyVersion` — Re-scoped

**Target state.** An entry remembers the differing disk text and the disk text the writer kept their version over.

- **Sync.** A sync does not re-raise the notice for the kept text.
- **Clearing.** Save and Use the disk version clear both fields.
- **`keepMyVersion()`.** It dismisses the notice for the current file and moves focus to the file-name button.
- **The notice.** It offers two text buttons, "Use the disk version" and "Keep my version".
- **The returned field.** `useDocuments` still returns `diskChanged`.

**Behavior.** Changing (new action).

**Why.** [C-13](artifacts/current-state-findings.md#c-13-dismissing-the-changed-on-disk-notice-would-not-stick).

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-keep-my-version-records-the-disk-text-it-dismissed)

### S-18: User-visible copy — Re-scoped

**Target state.** Claude is called "Claude" everywhere. Clear Chat is "New chat", Documents is "Posts", and
"unsaved changes"/"saved" is "Unsaved"/"Saved". The composer placeholder reads "Ask Claude about this post…" with a
post open and "Ask Claude…" without one.

**Behavior.** Changing (copy).

**Why.** [C-21](artifacts/current-state-findings.md#c-21-tests-pin-todays-labels-and-the-menubars-dom).

**Decision.** [D-18](artifacts/change-decision-log.md#d-18-claude-has-one-name-and-the-panels-have-plain-names)

### S-19: `ConfirmDialog` (`components/confirm-dialog/`) — Added

**Target state.** `ConfirmDialog` renders a native modal `<dialog>` with a title, body, Cancel and a confirm button. It
is labelled by its title, opens with focus on Cancel, and calls `onCancel` on Escape. It draws above the whole page. New
chat and Undo all use it.

**Behavior.** Changing (new dialogs).

**Why.** Two confirmations with the same keyboard and screen-reader needs (UX-6 in the review).

**Decision.** [D-23](artifacts/change-decision-log.md#d-23-one-confirmation-dialog-component-used-by-new-chat-and-undo-all)

### S-20: Shortcut hints (`components/shortcut.ts`) — Added

**Target state.** `shortcut(key)` returns "⌘{key}" on a Mac and "Ctrl+{key}" elsewhere. `isMac` reports which. The
Save button and the ask button use it.

**Behavior.** Changing (hints read Ctrl off the Mac).

**Why.** "Mod" is Ctrl on Windows and Linux (UX-12 in the review).

**Decision.** [D-19](artifacts/change-decision-log.md#d-19-the-post-headers-file-name-replaces-find-in-docs-shortcut-hints-follow-the-platform)

## Behavior Changes

Every entry changes what the writer sees. The run settled each one itself
([D-20](artifacts/change-decision-log.md#trivial-decisions)). In plain language:

- **The page has no top bar.** The app's name moves to the file list. A dark banner appears over the top of the page
  only when 3pitor stops answering, including when it is down as the page loads.
- **The post has one header.** It holds the name, Unsaved or Saved, Formatted/Markdown and Save. Clicking the name shows
  the file in the list; the magnifier button is gone. On a read-only file the switch stays visible but is disabled;
  today it disappears. Shortcut hints read "Ctrl+" on Windows and Linux.
- **The toolbar is shorter.** Join up, Lift and Select parent are gone, and "Type..." reads "Text".
- **The review strip replaces the highlight bar.** It reads, for example, "Claude changed 3 passages and left 1
  question", with previous and next. It shows on read-only files too.
- **Undo all is new.** After Claude finishes a reply, Undo all asks first, naming the posts it will change. It then puts
  every post that reply touched back the way it was when you pressed Send.
  - Anything you typed in those posts while Claude worked goes too; the dialog says so.
  - It can't be redone, and it clears those posts' ⌘Z history.
  - It is not offered after a page reload, for a reply you stopped, or once you save, move, rename or delete one of
    those posts.
- **The ask popups are gone.** Clicking a question pill, the "Ask Claude" button or ⌘K (Ctrl+K) adds a chip to the
  message box; you type and send there. Claude receives exactly the same message as before. The selection is no longer
  kept highlighted while you type.
- **New chat replaces Clear Chat.** It asks first, unless the chat is empty, and is disabled while Claude works. The
  chat mode (CLI or API) is no longer shown.
- **Claude's progress shows once.** One line reads "Claude is working on story-points.md", replacing "thinking…" and
  the animated "Working…". Tool calls under a reply fold into one line such as "Read 2 files, made 3 edits".
- **Screen readers hear more.** They hear when Claude starts, which post it is working on, and when it finishes. They
  also hear Undo all's result, a removed question chip, a reconnect, and chat errors.
- **The file list explains its lock.** It says changes to the post list are paused while Claude works, and that posts
  can still be opened.
- **Actions have plain names.** The "/" menu is an "Actions" menu (Proofread, Edit together, Research). An empty chat
  shows them as buttons.
- **Empty screens offer a next step.** With no post open, a New post button opens the new-file dialog.
- **Errors look like errors.** They are red; everything else is neutral.
- **The "changed on disk" notice can be dismissed.** "Keep my version" dismisses it until the disk changes again. Save
  still overwrites the disk, as the notice says.
- **Focus lands somewhere sensible.** After you remove a chip, dismiss the review, undo, keep your version or start a
  new chat, focus lands on the next useful control instead of the page.
- **The look follows the canvas.** The colors are the canvas's, and the post text uses a serif.
- **Claude has one name.** "AI" and "Agent" read "Claude" everywhere.

## Change Units

Each unit leaves `make test` green. It does so by updating, in the same commit, every test that pins what it changes;
the tests are named per unit below
([C-21](artifacts/current-state-findings.md#c-21-tests-pin-todays-labels-and-the-menubars-dom)).

Ordering:

- Units 1, 2, 3 and 5 are independent of each other.
- Unit 3 needs `ConfirmDialog` from Unit 3a.
- Unit 4 comes before Unit 6, which comes before Unit 7.
- Unit 1 comes before Unit 8.
- Unit 9 comes before Units 10 and 11.
- Unit 13 is last.

### Unit 1: Tokens and notices

**What it does.**

- Puts the canvas palette and font tokens into `styles.css`, with dark mode, plus a visually-hidden class.
- Moves `.notice` there and adds `.notice.error`.
- Marks every `role="alert"` notice in `Editor` and `FileTree` as an error.
- Turns App's and Chat's `.error` into `notice error` with `role="alert"`.
- Adds SVG icons.

**Delta entries.** S-3, S-16.

**How you know it worked.**

- `documents.test.tsx:1174`, which asserts the whole notice text, passes unchanged: the icons add no text.
- New tests check that each `role="alert"` notice in `Editor` and `FileTree` has the `error` class.
- New tests check that the chat error and the chat-load error have `role="alert"`.

### Unit 2: Shell and connection banner

**What it does.** Removes the top bar. Changes `useHostEvents` to `boolean | undefined`. Adds the fixed banner. Puts
"3pitor" and "Posts" in the tree's header. The reconnect announcement waits for Unit 12's status region.

**Delta entries.** S-1, S-2, S-13 (heading only).

**How you know it worked.**

- `app.test.tsx` covers four banner states: none before the first open; none after an open; shown after a close (call
  `sockets[0].onclose?.()`); gone again after a reopen.
- `app.test.tsx:347` and `:451` (catch-up on connect) still pass.
- `file-tree.test.tsx`'s heading assertions are updated.

### Unit 3a: Confirmation dialog

**What it does.** Adds `ConfirmDialog`.

**Delta entries.** S-19.

**How you know it worked.**

- A unit test opens it and finds focus on Cancel.
- Escape and Cancel each call `onCancel` once.
- Confirm calls `onConfirm` once.
- It is labelled by its title.

### Unit 3: Claude panel header and New chat

**What it does.**

- Renames the heading to "Claude".
- Adds New chat with its confirmation, disabled while busy.
- Derives `empty` in `App`.
- Drops `claude` state.

App's `newChat` keeps calling `docs.showHighlights(undefined)` until Unit 7 replaces it.

**Delta entries.** S-11.

**Ordering constraint.** After Unit 3a.

**How you know it worked.**

- `agent-panel.test.tsx:15-19` (`Agent (CLI)`) and `app.test.tsx:396`, `:405` (`Clear Chat`) are rewritten.
- New cases:
  - an empty chat starts a new one without a dialog;
  - a chat with a draft or a chip but no messages asks;
  - confirming calls `onNewChat` exactly once and focuses the message box;
  - Cancel calls nothing and focuses New chat;
  - the button is disabled while busy even with messages.

### Unit 4: Post header, mode switch and shortcut hints

**What it does.**

- Adds `shortcut.ts`.
- Builds the post header in `Editor`.
- Removes the menubar's mode portal and `onModeChange`.
- Rewrites the `switchable()` harness to change mode by rerendering with the `mode` prop.
- Deletes the switch-position test (`markdown-editor.test.tsx:1078-1096`).
- Replaces "Find in docs" with the name button.

The harness and the component change land in one commit.

**Delta entries.** S-4, S-7 (mode only), S-20.

**How you know it worked.**

- The ~30 mode tests pass through the new harness.
- The menubar `aria-pressed` tests (`markdown-editor.test.tsx:1102`, `:1115`) move to `documents.test.tsx` at `Editor`
  level. They show clicking Markdown calls `setMode`, the pressed state follows `docs.mode`, and the view state keeps
  `'raw'` (`documents.test.tsx:667-676`, rewritten from "Raw" to "Markdown").
- `documents.test.tsx:197-222` ("Find in docs") becomes name-button tests, including no name button with no file open.
- `app.test.tsx:468-479` clicks the name button and sees the tree reveal the file.
- New tests cover the read-only switch: disabled, with Formatted pressed while the stored mode is `'raw'`.
- New tests check `shortcut` on both platforms.

### Unit 5: Toolbar trim

**What it does.** Removes three menu items and relabels "Type..." as "Text".

**Delta entries.** S-6.

**How you know it worked.** A new test asserts that Join up, Lift and Select parent are absent and "Text" is present.
It does not pin the full ordered list.

### Unit 6: Review strip

**What it does.**

- Extracts `ReviewStrip` and `reviewSummary`.
- Mounts the strip before `.rich-editor`.
- Replaces `onClearHighlights` with `review.onDismiss`, wired to `docs.showHighlights(undefined)` until Unit 7, and
  moving focus to the file-name button.

**Delta entries.** S-5, S-7 (review only).

**Ordering constraint.** After Unit 4, which already edits the same props and portals.

**How you know it worked.**

- `markdown-editor.test.tsx:154`, `:476`, `:482`, `:550`, `:562` (position text, "(1 not found)", "No passages found")
  and `:451-467` (Clear) are retargeted to the strip and "Dismiss review".
- `reviewSummary` has a test for every case pinned in [D-4](artifacts/change-decision-log.md#d-4-a-review-strip-replaces-the-highlight-bar-and-shows-on-read-only-files).
- New tests check:
  - the strip shows on a read-only file;
  - the strip with only `turn` and no passages;
  - Undo all hidden without `turn`;
  - Undo all disabled while `pending`.

### Unit 7: Undo all

**What it does.**

- Adds `turnStart`, `turnEdited`, `lastTurn`, `undoing`, `undoTurn` and `dismissReview`.
- Clears `lastTurn` on save, move, rename and delete of its files.
- Wires the strip's Undo all through `ConfirmDialog` in `Editor`.
- Replaces `App.newChat`'s highlight clearing with `dismissReview`, re-pointing its `app.test.tsx` test.

**Delta entries.** S-10.

**Ordering constraint.** After Units 3a and 6.

**How you know it worked.** New `documents.test.tsx` cases:

- **File kinds.** One reply touching three files: one open at Send, one on disk only, one created by Claude. Undo all
  restores the first, re-reads the second, and forgets the third.
- **Typing.** Text typed during the turn is gone after Undo all.
- **Unsaved flag.**
  - It is restored for a file that was clean at Send.
  - It stays set when `saved` differs from the text at Send.
- **No offer.** There is no `lastTurn` after:
  - an aborted turn;
  - `applyPending`;
  - a save of an edited file during the turn.
- **Offer ends.** `lastTurn` clears on save, move, rename or delete of one of its files.
- **Failed read.** It lands in the not-applied notices.
- **Confirmation.** Cancel in the dialog changes nothing; a second press while `undoing` is ignored.
- **The strip.** It appears only on files in `lastTurn.files`.

### Unit 8: Keep my version

**What it does.** Replaces `diskChanged` with `diskText` and `keptOver`, adds `keepMyVersion`, and adds the notice
button.

**Delta entries.** S-17.

**Ordering constraint.** After Unit 1, which changes the same notice markup.

**How you know it worked.**

- `documents.test.tsx:1166-1174` is updated for the new button text.
- `:1239` (`diskChanged` boolean) and `:1254` still pass.
- New tests check:
  - after Keep my version, a sync with the same disk text raises no notice, and a different disk text does;
  - Save and Use the disk version clear `keptOver`;
  - focus moves to the file-name button.

### Unit 9: Context chip

**What it does.**

- Adds `ChatContext`, `composeMessage`, `context`, `attach` and the chip.
- Rewires App's ask handlers to `attach`, ignoring the old `anchor` until Unit 10.
- Adds the question-chip keep-or-fold effect.
- Deletes `popups/`.
- Updates the README's `popups/` entry.

**Delta entries.** S-8, S-9 (popups).

**How you know it worked.**

- **Message format.** `selection-popup.test.tsx:28` and `question-popup.test.tsx:48`, `:68` become `composeMessage`
  tests that assert byte equality.
- **Server text.** The request-level tests `app.test.tsx:149-150` and `:234` are rewritten to attach from a pill and
  from a selection, type in the message box and send. Their `chatBodies` text is unchanged.
- **Highlight change.** `app.test.tsx:156-171` becomes: with a question chip and typed text, a highlight change that
  drops the label leaves `'Q1 — {text}'` in the draft (joined after any earlier draft, as today). A highlight change
  that keeps the label keeps the chip.
- **Other new cases:**
  - a blank send with a chip sends nothing;
  - a busy send keeps the draft and the chip;
  - Remove clears the chip and focuses the textarea;
  - attaching focuses the textarea;
  - a second attach replaces the first;
  - a new session clears the chip;
  - a selection chip survives a highlight change.

### Unit 10: Ask cleanup and ⌘K

**What it does.**

- Drops `anchor`, `Ask`, `SelectionAsk` and `askingSelection`.
- Adds Mod-k in both views.
- Renames the ask button and adds its hint.
- Moves `anchored-bubble` beside `link-popup`.
- Updates the README.

**Delta entries.** S-7 (ask), S-9 (move).

**Ordering constraint.** After Unit 9.

**How you know it worked.**

- `markdown-editor.test.tsx:416-434`, `:592-603`, `:701-752`, `:779` and `:1355-1376`, which use the old signatures or
  `askingSelection`, are rewritten in this commit.
- `markdown-editor.test.tsx:827-836` (the selection stays marked while focus is in the link popup) passes. It is the
  check that the pinned-selection machinery survived.
- New tests:
  - Mod-k in the rendered view and in the raw pane attaches a selection chip;
  - Mod-k with an empty selection attaches nothing and still consumes the key.

### Unit 11: Actions

**What it does.**

- Moves `agent-actions` to `chat/chat/actions.tsx`.
- Applies the new labels and the "Actions" button text.
- Adds the empty-chat intro and buttons.
- Updates the README.

**Delta entries.** S-14.

**Ordering constraint.** After Unit 9, which removes `SelectionPopup`, the other importer.

**How you know it worked.**

- `chat.test.tsx:228-266` (menu actions and draft text) is updated for the new labels. "Edit together" still produces
  `/collaborative-editing `.
- `:246` (the slash glyph) becomes "Actions".
- `:116-119` (the empty-chat prose) becomes the intro and buttons.
- New tests check an empty-chat button fills the draft and focuses the textarea.

### Unit 12: Status line, status region and tool summary

**What it does.**

- Adds `workingFile`, `toolLine`, the status region and `announce`.
- Removes `WorkingBar` and "thinking…".
- Folds tool parts into `<details>`.
- Wires the announcements for:
  - start;
  - a file change;
  - finish;
  - Undo all;
  - a removed chip;
  - a reconnect.

**Delta entries.** S-12.

**Ordering constraint.** After Units 2, 7 and 9, whose events it announces.

**How you know it worked.**

- `chat.test.tsx:316-342`: the dot-cycle timing test at `:327` is deleted, and the rest become status-line tests.
- "thinking…" tests in `app.test.tsx:332-357` and `chat.test.tsx:304` are retargeted.
- `:295` (stop while working) still passes.
- `toolLine` has a test for each case pinned in [D-11](artifacts/change-decision-log.md#d-11-tool-activity-folds-into-one-counted-summary-line-per-reply).
- Opening the `<details>` shows the per-tool lines.
- The status region holds the right text after each event.

### Unit 13: Tree note, empty post state and copy

**What it does.**

- Adds the always-mounted pause note.
- Adds `newPosts`/`requestNewPost`, the FileTree effect, the `Editor` `busy` prop and the New post button.
- Sweeps the remaining "AI"/"Agent" copy.
- Adds the no-post placeholder.

**Delta entries.** S-13, S-15, S-18.

**Ordering constraint.** Last, because the copy sweep covers strings earlier units touch.

**How you know it worked.**

- New tests check:
  - the note fills only while busy;
  - New post in the empty state opens the name dialog;
  - New post does nothing while busy;
  - the dialog does not open on mount.
- Rendered-label assertions replace each pinned "AI"/"Agent" string:
  - the `chatBox()` placeholder helper in `app.test.tsx`;
  - "Could not apply Claude's edit" in `documents.test.tsx`;
  - the ask-button names.

## Risks

- **The test harness rewrite in Unit 4 touches about 30 tests at once.** A mistake in `switchable()` fails many tests
  together, so it surfaces at once rather than hiding.
- **Undo all discards what the writer typed during a turn.** The dialog says so, and there is no Redo. Unit 7's tests
  must cover typed text going.
- **Undo all clears ⌘Z history** for each file it replaces
  ([C-15](artifacts/current-state-findings.md#c-15-a-turn-lands-as-one-merge-per-tool-call-mod-z-undoes-them-one-at-a-time-only-while-the-file-is-shown)).
- **The review strip's counts trust the engine's labels.** A question without a label counts as a change
  ([C-17](artifacts/current-state-findings.md#c-17-highlights-are-one-files-list-mixing-claudes-questions-with-unlabeled-changed-passages)).
- **The canvas fonts are approximated by local stacks.** The look will differ slightly from the canvas.
- **`markdown-editor.tsx` is the highest-churn file.** Units 4, 5, 6 and 10 all edit it; build them in order on one
  branch.
- **Native `<dialog>` in happy-dom, the test environment.** If `showModal()` is missing there, Unit 3a needs a small stub in
  `test-setup.ts`. Check this first.

## Deferred (YAGNI)

- **Redo after Undo all.** Reopen when a writer asks to reverse an Undo all
  ([D-5](artifacts/change-decision-log.md#d-5-undo-all-asks-first-then-restores-each-file-claude-touched-to-its-text-at-send)).
- **Undo all across a reload, or for a stopped reply.** Reopen when the writer loses an Undo all through a reload, or
  asks to undo a stopped reply ([D-5](artifacts/change-decision-log.md#d-5-undo-all-asks-first-then-restores-each-file-claude-touched-to-its-text-at-send)).
- **A `<Notice>` component.** Two CSS classes cover today's notices. Reopen when notices gain dismiss or actions in three
  or more places ([D-15](artifacts/change-decision-log.md#d-15-notices-are-neutral-by-default-and-red-when-they-report-an-error)).
- **One shared pill and ask-button component for both views**
  ([C-4](artifacts/current-state-findings.md#c-4-the-question-pill-and-the-ask-button-exist-twice-for-the-rendered-view-and-the-raw-pane)).
  Reopen when the pill's markup changes again.
- **A block-type dropdown that shows the current style** ([D-1](artifacts/change-decision-log.md#d-1-keep-prosemirror-menu-for-a-trimmed-toolbar)). Reopen when the
  writer asks for it.
- **Bundled canvas fonts** ([D-17](artifacts/change-decision-log.md#d-17-the-canvass-palette-and-local-font-stacks)). Reopen when the operator asks for the exact
  fonts.
- **Per-tool wording in the tool summary** ([D-11](artifacts/change-decision-log.md#d-11-tool-activity-folds-into-one-counted-summary-line-per-reply)). Reopen when "used N other
  tools" proves unclear.

## Cut for Scope

- **Checking the disk before Save overwrites it.** It would have warned before Save replaced a file that changed on
  disk. Cut because the scope excludes "how files are saved and watched"
  ([scope-boundary.md](artifacts/scope-boundary.md)).
- **Keeping or ending old chat sessions on the server.** It would have let the writer reach a chat after New chat. Cut
  because the scope excludes the server
  ([C-18](artifacts/current-state-findings.md#c-18-clear-chat-starts-a-new-session-at-once-even-while-claude-works)).
- **The always-visible "…" on the open file's row, and "Try again" on the save error.** Both are drawn on the canvas.
  The first would have changed the file tree's menus; the second would have changed saving. Both are out of the
  confirmed area ([canvas-reference.md](artifacts/canvas-reference.md), "Canvas elements the plan does not build").

## Open Items

None blocking. The builder inherits one non-blocking item: spacing and sizes come from
[canvas-reference.md](artifacts/canvas-reference.md), and small differences are acceptable
([D-27](artifacts/change-decision-log.md#trivial-decisions)).

## Review Findings

One review round ([D-21](artifacts/change-decision-log.md#trivial-decisions)), with three reviewers: `han-core:junior-developer`
(JD-1 to JD-9), `han-core:user-experience-designer` (UX-1 to UX-18) and `han-core:test-engineer` (by unit). The
findings that changed the plan:

- **The question-chip path.** Both JD-1 and UX-5 found that the server would get an answer without its label. A
  question chip now stays while its label exists, and folds the label into the draft when it goes
  ([D-7](artifacts/change-decision-log.md#d-7-one-context-chip-in-the-message-box-replaces-both-ask-popups)).
- **Undo all.** Redo was not in the canvas and could still lose text (JD-4, UX-1). It was replaced by a confirmation
  that names the posts and warns about typed text. The offer now ends when one of those posts is saved, moved or
  deleted (JD-5, UX-2). The strip shows Undo all only on posts the reply touched and names the posts it affects (JD-7,
  UX-3, UX-4) ([D-4](artifacts/change-decision-log.md#d-4-a-review-strip-replaces-the-highlight-bar-and-shows-on-read-only-files), [D-5](artifacts/change-decision-log.md#d-5-undo-all-asks-first-then-restores-each-file-claude-touched-to-its-text-at-send)).
- **Accessibility contracts are now pinned.** These cover the confirmation dialog (UX-6,
  [D-23](artifacts/change-decision-log.md#d-23-one-confirmation-dialog-component-used-by-new-chat-and-undo-all)), one status region (UX-7,
  [D-24](artifacts/change-decision-log.md#d-24-one-always-mounted-status-region-in-the-chat-carries-every-announcement)), focus targets (UX-8, [D-25](artifacts/change-decision-log.md#d-25-focus-goes-somewhere-sensible-when-the-focused-control-disappears)),
  the chip's description (UX-9), a text "Keep my version" button (UX-8), and error roles (JD-3, UX-13).
- **Copy.** The pause note's wording (UX-10), "working on" (UX-11), platform shortcut hints (UX-12), and a simpler
  tool summary (JD-8, UX-16).
- **Canvas and README on disk.** The canvas copy is written to disk (JD-6, [D-27](artifacts/change-decision-log.md#trivial-decisions)),
  and the README is updated (JD-2, [D-26](artifacts/change-decision-log.md#trivial-decisions)).
- **Tests and ordering.** Each unit now names the existing tests it must update and the new cases it must add. The unit
  ordering is corrected (JD-9 and the test engineer).

Unverified items carried from the reviewers, none blocking:

- Whether happy-dom implements `showModal()`; see Risks.
- What y-prosemirror does with its undo manager on unmount
  ([C-15](artifacts/current-state-findings.md#c-15-a-turn-lands-as-one-merge-per-tool-call-mod-z-undoes-them-one-at-a-time-only-while-the-file-is-shown)).

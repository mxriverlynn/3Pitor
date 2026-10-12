# Change Plan: Simplified UI Redesign

## Why This Change

The operator asked for 3pitor's browser app to be rebuilt to be "as simple as possible, clean, easy to understand".
A Claude Design canvas, built on a UX audit, shows the result in five screens:
https://claude.ai/artifact/6c5te377PrvthBUEEwzN4G. This plan builds that design. It is a deliberate improvement with no
triggering defect. The source is the operator's own requests, recorded in
[scope-boundary.md](artifacts/scope-boundary.md). The run settled every open question itself, at the operator's
standing request ([D-20](artifacts/change-decision-log.md#trivial-decisions)).

## What Changes, In One Paragraph

After this change the app is three columns: Posts, the post, and Claude. There is no top bar. A banner appears only when
the connection to 3pitor is lost. The post has one header: its name, Unsaved or Saved, a Formatted/Markdown switch, and
Save. The toolbar is shorter. After Claude replies, a review strip counts what Claude changed and asked. It steps
through those passages and can undo the whole reply, and redo it. Every way of asking Claude ends in the same message
box: a question pill or a selected passage becomes a chip there, and the two popups are gone. While Claude works, one
status line says so and the file list says why it is paused. Errors are red, information is neutral, and New chat asks
first. Empty screens offer a next step. Claude has one name everywhere. Nothing outside `src/ui/` changes, and the
server receives exactly the same messages ([D-3](artifacts/change-decision-log.md#d-3-no-server-engine-or-shared-change)).

## Current State

The browser app concentrates the redesign's editor-side work in one 970-line component, `MarkdownEditor`. It is the
area's highest-churn file
([C-1](artifacts/current-state-findings.md#c-1-markdowneditor-owns-the-toolbar-mode-switch-highlight-bar-raw-pane-link-popup-and-ask-button)).
The structural property this change addresses is that editor controls hang off ProseMirror's own DOM. The mode switch
and the highlight bar are portaled into the menubar that `prosemirror-menu` builds, so they vanish when a read-only file
hides that menubar
([C-2](artifacts/current-state-findings.md#c-2-the-mode-switch-the-highlight-bar-and-the-raw-pane-are-portaled-into-the-prosemirror-menubar)).
The toolbar is the ProseMirror example menu
([C-3](artifacts/current-state-findings.md#c-3-the-formatting-toolbar-is-the-example-setup-menu-wrapped-by-rawaware)).

Asking Claude runs through two anchored popups. `App` holds their state and keeps only one open at a time. Each popup
builds the exact message text the server receives
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

The canvas is the visual reference for layout, copy and color. This plan wins where the two differ, and says why
([D-22](artifacts/change-decision-log.md#trivial-decisions)).

### Shell, theme and connection

- **`app.tsx` and `styles.css`.** They own the layout. `.app` is a column holding an optional banner and `.main`.
  `.main` keeps its five grid tracks: tree, resizer, post, resizer, Claude. The top bar is gone, and "3pitor" sits in
  the Posts panel header ([D-16](artifacts/change-decision-log.md#d-16-no-top-bar-a-banner-appears-only-when-the-connection-is-lost)).
- **`useHostEvents`.** It returns `boolean | undefined`, where `undefined` means the socket has not yet opened or
  closed. The banner shows only on `false`.
- **Tokens.** `styles.css` holds every color and font token, with dark-mode values for all of them. The post text uses
  a local serif stack. No web fonts are loaded ([D-17](artifacts/change-decision-log.md#d-17-the-canvass-palette-and-local-font-stacks)).
- **Notices.** `styles.css` owns `.notice` (neutral) and `.notice.error` (red, always with `role="alert"`). There is no
  notice component ([D-15](artifacts/change-decision-log.md#d-15-notices-are-neutral-by-default-and-red-when-they-report-an-error)).

### The post column

**`Editor`** (`documents/documents/documents.tsx`) owns:

- **The post header.** The folder in muted text. The file name, as a button named "Show {name} in Posts" that runs
  `findInDocs`. Unsaved or Saved, shown only when a file is open. The Formatted/Markdown switch. Save, with a "⌘S" hint
  ([D-2](artifacts/change-decision-log.md#d-2-the-formattedmarkdown-switch-moves-into-the-post-header), [D-19](artifacts/change-decision-log.md#d-19-the-post-headers-file-name-replaces-find-in-docs)).
  - The switch reads `docs.mode` and calls `docs.setMode`.
  - The switch is disabled when `docs.unsupported.length > 0`.
  - `ViewState.mode` keeps its stored values `'rendered' | 'raw'`.
- **The notices.**
- **The empty state.** A New post button, which calls `docs.requestNewPost()` and is disabled while `busy`
  ([D-14](artifacts/change-decision-log.md#d-14-the-empty-editor-offers-new-post-through-a-request-counter)).

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
  turn?: { undone: boolean; onUndoAll: () => void; onRedo: () => void };
  onDismiss: () => void;
}): JSX.Element | null;
export function reviewSummary(passages: Passage[]): string;
// [{quote:'a'},{quote:'b'},{quote:'c',label:'Q1',question:'?'}] → 'Claude changed 2 passages and left 1 question'
```

`MarkdownEditor`'s props change as follows:

```ts
// removed: onModeChange, onClearHighlights, askingSelection
review?: { turn?: { undone: boolean; onUndoAll: () => void; onRedo: () => void }; onDismiss: () => void };
onAsk?: (passage: Passage) => void;           // was (ask: Ask)
onAskSelection?: (markdown: string) => void;  // was (ask: SelectionAsk)
```

**`useDocuments`** owns Undo all, Redo and dismissing the review
([D-5](artifacts/change-decision-log.md#d-5-undo-all-restores-each-file-to-its-text-at-send-redo-puts-back-what-undo-replaced)).

- **What it records.**
  - `beginTurn` records `{ text, dirty }` for every opened file.
  - `applyEdited` adds each file it touches to `turnEdited`.
  - `applyTurn` publishes `lastTurn` for a clean, finished turn begun in this page.
- **`undoTurn`.** It puts each edited file back to its text at Send.
  - A file not open at Send is re-read from disk.
  - A file Claude created is forgotten.
  - Before replacing anything, it keeps the replaced text and the highlights so Redo can restore them.
- **`redoTurn`.** It reverses `undoTurn`.
- **`dismissReview`.** It clears `lastTurn` and the highlights. `App.newChat` calls it.

```ts
type LastTurn = { files: string[]; undone: boolean; replaced?: Record<string, string>; highlights?: SessionHighlights };
lastTurn: LastTurn | undefined;
undoTurn(): Promise<void>;
redoTurn(): void;
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
- It confirms first unless the chat is empty.
- Its signature becomes `AgentPanel({ onNewChat, busy, empty })`.

**`Chat`** and **`useChatSession`** own the message box, the chip, the status line and the tool summary lines.

- **The chip** ([D-7](artifacts/change-decision-log.md#d-7-one-context-chip-in-the-message-box-replaces-both-ask-popups)). `ChatContext` holds what the chip refers to.
  `composeMessage` builds the outgoing text. The text is byte-identical to what the popups send today:

  ```ts
  export type ChatContext = { kind: 'question'; passage: Passage } | { kind: 'selection'; markdown: string };
  export function composeMessage(text: string, context?: ChatContext): string;
  // composeMessage('Yes', {kind:'question', passage:{quote:'x', label:'Q1'}}) === 'Q1 — Yes'
  // composeMessage(' Shorter? ', {kind:'selection', markdown:'one\n\ntwo'})
  //   === 'About this passage:\n\n> one\n>\n> two\n\nShorter?'
  // useChatSession adds: context: ChatContext | undefined; attach(context?: ChatContext): void
  ```

- **`App`'s wiring.** `onAsk` and `onAskSelection` call `chat.attach`. A question chip is cleared when
  `docs.highlights` changes.
- **⌘K.** It attaches the selection in both views ([D-8](artifacts/change-decision-log.md#d-8-ask-callbacks-drop-the-anchor-k-attaches-the-selection-the-popups-are-deleted)).
- **The status line.** One line, "Claude is editing {file}" or "Claude is working…", replaces "thinking…" and the
  Working bar. Stop stays in the message box ([D-10](artifacts/change-decision-log.md#d-10-one-status-line-replaces-thinking-and-the-working-bar-stop-stays-in-the-message-box)).
- **Tool activity.** Each reply's tool calls fold into one counted line, such as "Read 2 files, made 3 edits", that
  opens to show the details ([D-11](artifacts/change-decision-log.md#d-11-tool-activity-folds-into-one-counted-summary-line-per-reply)).
- **Actions.** `ACTIONS` and `ActionsMenu` live in `chat/chat/actions.tsx`. An empty chat shows them as suggestion
  buttons ([D-13](artifacts/change-decision-log.md#d-13-actions-move-into-the-chat-feature-get-plain-names-and-appear-as-suggestions-in-an-empty-chat)).

### The Posts column

`FileTree` adds a pause note while Claude works ([D-12](artifacts/change-decision-log.md#d-12-the-file-tree-says-why-it-is-paused)). It opens its New file
dialog when `docs.newPosts` increases ([D-14](artifacts/change-decision-log.md#d-14-the-empty-editor-offers-new-post-through-a-request-counter)).

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
closes. `App` renders a `role="alert"` banner above `.main` reading "Lost touch with 3pitor. Is it still running in
your terminal? Trying again…" only while the value is `false`. Effects that run on connect still run when it becomes
`true`.

**Behavior.** Changing. A lost connection is announced and shown across the page.

**Why.** [C-19](artifacts/current-state-findings.md#c-19-connection-state-is-a-dot-in-the-top-bar-and-gates-nothing).

**Decision.** [D-16](artifacts/change-decision-log.md#d-16-no-top-bar-a-banner-appears-only-when-the-connection-is-lost)

### S-3: Theme tokens and fonts in `styles.css` — Re-scoped

**Target state.** `styles.css` defines every color and font token used by the app, each with a dark-mode value. That
includes `--bad-soft`, `--info-soft`, `--unsaved`, `--change`, `--change-line`, `--question`, `--question-line`,
`--font-ui`, `--font-post` and `--font-mono`. The rendered post uses `--font-post` at 18px/1.7. No font is fetched from
the network.

**Behavior.** Changing. The app takes the canvas's colors and a serif post body.

**Why.** [C-20](artifacts/current-state-findings.md#c-20-layout-and-tokens-live-in-a-70-line-stylescss).

**Decision.** [D-17](artifacts/change-decision-log.md#d-17-the-canvass-palette-and-local-font-stacks)

### S-4: `Editor`'s post header — Re-scoped

**Target state.** `Editor` renders one header: the folder (muted), the file name as a "Show {name} in Posts" button
running `findInDocs`, Unsaved or Saved (only when a file is open), a Formatted/Markdown switch (group name "View",
`aria-pressed` per button, disabled for read-only files) and Save with a "⌘S" hint. Mod-S still saves. The "Find in
docs" magnifier does not exist.

**Behavior.** Changing. Labels, placement and the read-only switch differ; saving and mode persistence are unchanged.

**Why.** [C-11](artifacts/current-state-findings.md#c-11-the-editor-bar-holds-find-in-docs-the-file-name-the-save-state-and-save),
[C-2](artifacts/current-state-findings.md#c-2-the-mode-switch-the-highlight-bar-and-the-raw-pane-are-portaled-into-the-prosemirror-menubar).

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-formattedmarkdown-switch-moves-into-the-post-header), [D-19](artifacts/change-decision-log.md#d-19-the-post-headers-file-name-replaces-find-in-docs)

### S-5: `ReviewStrip` (`documents/markdown-editor/review-strip.tsx`, `.css`) — Added

**Target state.** `ReviewStrip` draws the review strip from the props pinned in Target State. Its pieces are:

- the summary from `reviewSummary`;
- the position text;
- "Previous highlight" and "Next highlight" buttons;
- Undo all, which becomes Redo once undone, shown only with `turn`;
- a dismiss button named "Dismiss review".

It returns `null` with no passages and no turn. `MarkdownEditor` renders it as a sibling before `.rich-editor`, so
read-only files show it. The highlight bar and its CSS are gone from `markdown-editor.tsx` and `markdown-editor.css`.

**Behavior.** Changing. See Behavior Changes.

**Why.** [C-1](artifacts/current-state-findings.md#c-1-markdowneditor-owns-the-toolbar-mode-switch-highlight-bar-raw-pane-link-popup-and-ask-button),
[C-17](artifacts/current-state-findings.md#c-17-highlights-are-one-files-list-mixing-claudes-questions-with-unlabeled-changed-passages).

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-a-review-strip-replaces-the-highlight-bar-and-shows-on-read-only-files)

### S-6: `menuContent` toolbar — Re-scoped

**Target state.** The toolbar holds the formatting buttons, the Insert dropdown and a block-type dropdown labeled
"Text". Join up, Lift and Select parent do not exist. Every item is still `rawAware`.

**Behavior.** Changing. Three items are gone and one label changes.

**Why.** [C-3](artifacts/current-state-findings.md#c-3-the-formatting-toolbar-is-the-example-setup-menu-wrapped-by-rawaware).

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-keep-prosemirror-menu-for-a-trimmed-toolbar)

### S-7: `MarkdownEditor` and `RawView` props — Re-scoped

**Target state.** `MarkdownEditor` takes `mode` but not `onModeChange`. It takes `review` in place of
`onClearHighlights`, `onAsk(passage)` and `onAskSelection(markdown)`, and no `askingSelection`. `RawView` takes the
same ask callbacks and no `askingSelection`. The types `Ask` and `SelectionAsk` do not exist. Mod-k calls
`askSelection` in both views. The floating button is named "Ask Claude about the selection" and the question pill keeps
its label.

**Behavior.** Changing. ⌘K is new; the selection is no longer held highlighted while the writer types a question.

**Why.** [C-4](artifacts/current-state-findings.md#c-4-the-question-pill-and-the-ask-button-exist-twice-for-the-rendered-view-and-the-raw-pane),
[C-6](artifacts/current-state-findings.md#c-6-app-holds-the-popup-state-keeps-one-popup-open-at-a-time-and-moves-typed-text-to-the-chat-box).

**Depends on.** S-4, S-5, S-8.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-the-formattedmarkdown-switch-moves-into-the-post-header), [D-4](artifacts/change-decision-log.md#d-4-a-review-strip-replaces-the-highlight-bar-and-shows-on-read-only-files),
[D-8](artifacts/change-decision-log.md#d-8-ask-callbacks-drop-the-anchor-k-attaches-the-selection-the-popups-are-deleted)

### S-8: `ChatContext`, `composeMessage`, `useChatSession.context` and `attach` — Added

**Target state.** `useChatSession` holds an optional `ChatContext` and exposes `attach`. `send(text)` sends
`composeMessage(text, context)` and clears the context on success. The text the server receives for a question or a
selection is byte-identical to what the popups send today. `Chat` draws the chip above the textarea with a Remove
button, and focuses the textarea when a context is attached. `App` clears a question chip when `docs.highlights`
changes.

**Behavior.** Changing for the writer, Preserving for the server. See Behavior Changes.

**Why.** [C-5](artifacts/current-state-findings.md#c-5-the-two-ask-popups-own-the-message-formats-the-server-receives),
[C-6](artifacts/current-state-findings.md#c-6-app-holds-the-popup-state-keeps-one-popup-open-at-a-time-and-moves-typed-text-to-the-chat-box).

**Decision.** [D-7](artifacts/change-decision-log.md#d-7-one-context-chip-in-the-message-box-replaces-both-ask-popups)

### S-9: `src/ui/popups/` and `components/anchored-bubble/` — Removed and Moved

**Target state.** `QuestionPopup`, `SelectionPopup` and their tests do not exist. Asking Claude is S-8's job. The anchored
bubble lives in `documents/markdown-editor/anchored-bubble.ts` and `.css`, beside its only user, `LinkPopup`, and works
as before.

**Behavior.** Changing (the popups are gone). The link popup is Preserving.

**Why.** [C-5](artifacts/current-state-findings.md#c-5-the-two-ask-popups-own-the-message-formats-the-server-receives).

**Depends on.** S-7, S-8.

**Migration.** Import `useAnchoredBubble` from `./anchored-bubble`.

**Decision.** [D-8](artifacts/change-decision-log.md#d-8-ask-callbacks-drop-the-anchor-k-attaches-the-selection-the-popups-are-deleted)

### S-10: `useDocuments` Undo all, Redo and dismiss — Added

**Target state.** `useDocuments` records each opened file's text and unsaved state at Send. It exposes `lastTurn`,
`undoTurn`, `redoTurn` and `dismissReview`, as pinned in Target State and
[D-5](artifacts/change-decision-log.md#d-5-undo-all-restores-each-file-to-its-text-at-send-redo-puts-back-what-undo-replaced). `Editor` passes them to `MarkdownEditor` as `review`. `App.newChat` calls
`dismissReview`. Nothing new is persisted.

**Behavior.** Changing (new). See Behavior Changes.

**Why.** [C-14](artifacts/current-state-findings.md#c-14-no-pre-turn-text-is-kept-turnbases-is-a-merge-base-that-each-merge-overwrites),
[C-15](artifacts/current-state-findings.md#c-15-a-turn-lands-as-one-merge-per-tool-call-mod-z-undoes-them-one-at-a-time-only-while-the-file-is-shown).

**Depends on.** S-5.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-undo-all-restores-each-file-to-its-text-at-send-redo-puts-back-what-undo-replaced)

### S-11: `AgentPanel` — Re-scoped

**Target state.** `AgentPanel({ onNewChat, busy, empty })` renders the heading "Claude" and a "New chat" button that is
disabled while busy. With a non-empty chat it opens a confirmation dialog, drawn above the chat. The dialog says "Start
a new chat?", gives the explanation, and offers Cancel and New chat. It does not show the chat mode. `App` has no
`claude` state.

**Behavior.** Changing.

**Why.** [C-18](artifacts/current-state-findings.md#c-18-clear-chat-starts-a-new-session-at-once-even-while-claude-works),
[C-23](artifacts/current-state-findings.md#c-23-the-agent-panel-header-shows-the-chat-mode-and-clear-chat).

**Decision.** [D-9](artifacts/change-decision-log.md#d-9-new-chat-asks-first-and-is-disabled-while-claude-works)

### S-12: `Chat` status line and tool summary — Re-scoped

**Target state.** While busy, `Chat` shows one `role="status"` line, "Claude is editing {file}" or "Claude is
working…", using `workingFile(messages)`. `WorkingBar` and "thinking…" do not exist. Send becomes Stop while busy. Each
reply's tool parts render as one `<details>` whose summary is `toolLine(parts)`. Opening it shows today's per-tool
lines. Errors render as `notice error`.

**Behavior.** Changing.

**Why.** [C-9](artifacts/current-state-findings.md#c-9-claudes-progress-shows-three-ways-and-stop-is-fire-and-forget).

**Decision.** [D-10](artifacts/change-decision-log.md#d-10-one-status-line-replaces-thinking-and-the-working-bar-stop-stays-in-the-message-box), [D-11](artifacts/change-decision-log.md#d-11-tool-activity-folds-into-one-counted-summary-line-per-reply)

### S-13: `FileTree` pause note and heading — Re-scoped

**Target state.** While busy, `FileTree` shows "Moving and renaming are paused while Claude works." (`role="status"`).
Its heading reads "Posts", and "3pitor" sits beside it. The lock is unchanged.

**Behavior.** Changing.

**Why.** [C-10](artifacts/current-state-findings.md#c-10-the-file-tree-locks-while-claude-works-with-no-visible-reason).

**Decision.** [D-12](artifacts/change-decision-log.md#d-12-the-file-tree-says-why-it-is-paused), [D-16](artifacts/change-decision-log.md#d-16-no-top-bar-a-banner-appears-only-when-the-connection-is-lost)

### S-14: Agent actions (`components/agent-actions/` → `chat/chat/actions.tsx`) — Moved

**Target state.** `ACTIONS` and `ActionsMenu` live in `chat/chat/actions.tsx` and `actions.css`. The menu button reads
"Actions". The actions are Proofread, Edit together and Research, with hints. An empty chat shows an intro sentence and
one button per action. Choosing one, from the menu or a button, puts `/${skill} ` into the draft.

**Behavior.** Changing (labels and the empty-chat buttons). The draft text each action produces is Preserving.

**Why.** [C-7](artifacts/current-state-findings.md#c-7-the--actions-menu-has-two-callers-and-a-private-action-list),
[C-8](artifacts/current-state-findings.md#c-8-both-empty-states-are-static-text).

**Depends on.** S-9.

**Migration.** Import `ActionsMenu` from `./actions` in place of `AgentActions`.

**Decision.** [D-13](artifacts/change-decision-log.md#d-13-actions-move-into-the-chat-feature-get-plain-names-and-appear-as-suggestions-in-an-empty-chat)

### S-15: Empty post state, `newPosts` and `requestNewPost` — Added

**Target state.** With no file open, `Editor` shows "Pick a post to start", a sentence and a New post button. The
button is disabled while busy and calls `docs.requestNewPost()`. `FileTree` opens its root New file dialog whenever
`docs.newPosts` increases and it is not busy. `Editor` takes `busy`.

**Behavior.** Changing.

**Why.** [C-8](artifacts/current-state-findings.md#c-8-both-empty-states-are-static-text).

**Decision.** [D-14](artifacts/change-decision-log.md#d-14-the-empty-editor-offers-new-post-through-a-request-counter)

### S-16: Notice styles — Moved and Re-scoped

**Target state.** `.notice` lives in `styles.css` as neutral information. `.notice.error` is red and is used on every
notice with `role="alert"`, in `Editor`, `FileTree`, `Chat` and `App`. Each notice has an `aria-hidden` icon.
`documents.css` has no `.notice` rule, and `.error` text is gone.

**Behavior.** Changing (look). Roles and text are unchanged apart from S-18.

**Why.** [C-12](artifacts/current-state-findings.md#c-12-eight-notices-share-one-blue-style-and-none-can-be-dismissed).

**Depends on.** S-3.

**Decision.** [D-15](artifacts/change-decision-log.md#d-15-notices-are-neutral-by-default-and-red-when-they-report-an-error)

### S-17: `Entry.diskChanged` → `diskText` and `keptOver`; `keepMyVersion` — Re-scoped

**Target state.** An entry remembers the differing disk text and the disk text the writer kept their version over. A
sync does not re-raise the notice for the kept text. `keepMyVersion()` dismisses the notice for the current file.
`useDocuments` still returns `diskChanged`. The notice offers "Use the disk version" and a "Keep my version" button.

**Behavior.** Changing (new action).

**Why.** [C-13](artifacts/current-state-findings.md#c-13-dismissing-the-changed-on-disk-notice-would-not-stick).

**Decision.** [D-6](artifacts/change-decision-log.md#d-6-keep-my-version-records-the-disk-text-it-dismissed)

### S-18: User-visible copy — Re-scoped

**Target state.** Claude is called "Claude" everywhere. Clear Chat is "New chat", Documents is "Posts", and
"unsaved changes"/"saved" is "Unsaved"/"Saved". The composer placeholder reads "Ask Claude about this post…".

**Behavior.** Changing (copy).

**Why.** [C-21](artifacts/current-state-findings.md#c-21-tests-pin-todays-labels-and-the-menubars-dom).

**Decision.** [D-18](artifacts/change-decision-log.md#d-18-claude-has-one-name-and-the-panels-have-plain-names)

## Behavior Changes

Every entry changes what the writer sees. The run settled each one itself
([D-20](artifacts/change-decision-log.md#trivial-decisions)). In plain language:

- **The page has no top bar.** The app's name moves to the file list. A dark banner appears only when 3pitor stops
  answering, including when it is down as the page loads.
- **The post has one header.** It holds the name, Unsaved or Saved, Formatted/Markdown and Save. Clicking the name shows
  the file in the list; the magnifier button is gone. On a file 3pitor can only show read-only, the switch stays
  visible but is disabled; today it disappears.
- **The toolbar is shorter.** Join up, Lift and Select parent are gone, and "Type..." reads "Text".
- **The review strip replaces the highlight bar.** It reads, for example, "Claude changed 3 passages and left 1
  question", with previous and next. It shows on read-only files too.
- **Undo all is new.** After Claude finishes a reply, Undo all puts every post that reply touched back to how it was
  when you pressed Send. Anything you typed in those posts while Claude worked goes too, and Redo brings all of it back.
  - Undo all is not offered after a page reload or for a reply you stopped.
  - The ⌘Z history of a post Undo all touches is cleared.
- **The ask popups are gone.** Clicking a question pill, the "Ask Claude" button or ⌘K adds a chip to the message box;
  you type and send there. Claude receives exactly the same message as before. A question chip disappears when Claude's
  highlights change. The selection is no longer kept highlighted while you type.
- **New chat replaces Clear Chat.** It asks first, unless the chat is empty, and is disabled while Claude works. The
  chat mode (CLI or API) is no longer shown.
- **Claude's progress shows once.** One line reads "Claude is editing story-points.md", replacing "thinking…" and the
  animated "Working…". Tool calls under a reply fold into one line such as "Read 2 files, made 3 edits".
- **The file list explains its lock.** It says moving and renaming are paused while Claude works.
- **Actions have plain names.** The "/" menu is an "Actions" menu (Proofread, Edit together, Research). An empty chat
  shows them as buttons.
- **Empty screens offer a next step.** With no post open, a New post button opens the new-file dialog.
- **Errors look like errors.** They are red; everything else is neutral.
- **The "changed on disk" notice can be dismissed.** "Keep my version" dismisses it until the disk changes again. Save
  still overwrites the disk, as the notice says.
- **The look follows the canvas.** The colors are the canvas's, and the post text uses a serif.
- **Claude has one name.** "AI" and "Agent" read "Claude" everywhere.

## Change Units

Each unit updates the tests that pin what it changes
([C-21](artifacts/current-state-findings.md#c-21-tests-pin-todays-labels-and-the-menubars-dom)) and leaves `make test`
green. Units 1–3, 5, 11 and 13 are independent of each other.

### Unit 1: Tokens and notices

**What it does.** Puts the canvas palette and font tokens into `styles.css`, with dark mode. Moves `.notice` there.
Adds `.notice.error` and marks every `role="alert"` notice as an error. Turns `.error` text into `notice error`.

**Delta entries.** S-3, S-16.

**How you know it worked.** Existing notice tests pass unchanged (roles and text are the same). A new test checks
that each `role="alert"` notice in `Editor` has the `error` class.

### Unit 2: Shell and connection banner

**What it does.** Removes the top bar. Changes `useHostEvents` to `boolean | undefined`. Adds the banner. Puts "3pitor"
and "Posts" in the tree's header.

**Delta entries.** S-1, S-2, S-13 (heading only).

**How you know it worked.** `app.test.tsx` shows no banner before the first open or after an open, and shows the banner
after a close. Catch-up on reconnect still fires.

### Unit 3: Claude panel header and New chat

**What it does.** Renames the heading to "Claude" and adds New chat with its confirmation. New chat is disabled while
busy. Drops `claude` state. App's `newChat` keeps calling `docs.showHighlights(undefined)` until Unit 7 replaces it.

**Delta entries.** S-11.

**How you know it worked.** `agent-panel.test.tsx` and `app.test.tsx` cover these cases: an empty chat starts a new
one without asking; a non-empty chat asks first; Cancel keeps the chat; the button is disabled while busy.

### Unit 4: Post header and mode switch

**What it does.** Builds the post header in `Editor` and removes the menubar's mode portal and `onModeChange`.
Rewrites the `switchable()` test harness to change mode by rerendering with the `mode` prop. Deletes the
switch-position test. Replaces "Find in docs" with the name button.

**Delta entries.** S-4, S-7 (mode only).

**How you know it worked.** The ~30 mode tests pass through the new harness. New tests cover the header's labels, the
disabled switch on a read-only file, and the name button revealing the file.

### Unit 5: Toolbar trim

**What it does.** Removes three menu items and relabels "Type..." as "Text".

**Delta entries.** S-6.

**How you know it worked.** A new test lists the toolbar's item titles; there was none before.

### Unit 6: Review strip

**What it does.** Extracts `ReviewStrip` and `reviewSummary`, and mounts the strip before `.rich-editor`. Replaces
`onClearHighlights` with `review.onDismiss`, wired to `docs.showHighlights(undefined)` until Unit 7.

**Delta entries.** S-5, S-7 (review only).

**Ordering constraint.** After Unit 4, which already edits the same props and portals.

**How you know it worked.** Tests reading "Highlight 1 of 1" are updated to the new position text. `reviewSummary` has
unit tests. A new test shows the strip on a read-only file.

### Unit 7: Undo all and Redo

**What it does.** Adds `turnStart`, `turnEdited`, `lastTurn`, `undoTurn`, `redoTurn` and `dismissReview`. Wires them
through `Editor` and `App.newChat`.

**Delta entries.** S-10.

**Ordering constraint.** After Unit 6, because the strip draws the buttons.

**How you know it worked.** `documents.test.tsx` covers the three file kinds: open at Send, on disk only, and created by
Claude. It also covers the restored unsaved flag, Redo restoring the replaced text and the highlights, and no
`lastTurn` after an aborted turn or `applyPending`.

### Unit 8: Keep my version

**What it does.** Replaces `diskChanged` with `diskText` and `keptOver`, adds `keepMyVersion`, and adds the notice
button.

**Delta entries.** S-17.

**How you know it worked.** A test dismisses the notice, runs another sync with the same disk text and sees no notice.
A different disk text raises it again.

### Unit 9: Context chip

**What it does.** Adds `ChatContext`, `composeMessage`, `context` and `attach`, and draws the chip. Rewires App's ask
handlers to `attach`, ignoring the old `anchor` until Unit 10. Adds the question-chip clearing effect. Deletes
`popups/`. Moves the popups' message tests to `composeMessage` tests that assert byte equality.

**Delta entries.** S-8, S-9 (popups).

**How you know it worked.** `composeMessage` tests reproduce today's two formats exactly. `app.test.tsx` attaches from a
pill and from a selection, sends, and sees the same request text as before.

### Unit 10: Ask cleanup and ⌘K

**What it does.** Drops `anchor`, `Ask`, `SelectionAsk` and `askingSelection`. Adds Mod-k in both views. Renames the
ask button. Moves `anchored-bubble` beside `link-popup`.

**Delta entries.** S-7 (ask), S-9 (move).

**Ordering constraint.** After Unit 9.

**How you know it worked.** Tests press Mod-k in each view and see a selection chip. The link popup tests pass
unchanged.

### Unit 11: Actions

**What it does.** Moves `agent-actions` to `chat/chat/actions.tsx`, applies the new labels and the "Actions" button
text, and adds the empty-chat buttons.

**Delta entries.** S-14.

**Ordering constraint.** After Unit 9 if `SelectionPopup` still imports it; otherwise independent.

**How you know it worked.** `chat.test.tsx` chooses each action from the menu and from an empty-chat button, and sees
`/{skill} ` in the draft.

### Unit 12: Status line and tool summary

**What it does.** Adds `workingFile` and `toolLine`. Removes `WorkingBar` and "thinking…". Folds tool parts into
`<details>`.

**Delta entries.** S-12.

**How you know it worked.** The "Working" and "thinking…" tests become status-line tests. `toolLine` has unit tests.

### Unit 13: Tree note, empty post state and copy

**What it does.** Adds the pause note, `newPosts`/`requestNewPost`, the FileTree effect, the `Editor` `busy` prop and
the New post button. Sweeps the remaining "AI"/"Agent" copy.

**Delta entries.** S-13, S-15, S-18.

**How you know it worked.** A test clicks New post in the empty state and sees the name dialog. A grep of `src/ui` for
user-visible "AI" and "Agent" finds none.

## Risks

- **The test harness rewrite in Unit 4 touches about 30 tests at once.** A mistake in `switchable()` fails many tests
  together, so it surfaces at once rather than hiding.
- **Undo all can discard what the writer typed during a turn.** Redo is the safety net. Unit 7's tests must cover Redo
  restoring typed text, not just Claude's.
- **Undo all clears ⌘Z history** for each file it replaces
  ([C-15](artifacts/current-state-findings.md#c-15-a-turn-lands-as-one-merge-per-tool-call-mod-z-undoes-them-one-at-a-time-only-while-the-file-is-shown)).
  The writer loses step-by-step undo for those files; Redo still works.
- **The review strip's counts trust the engine's labels.** A question without a label counts as a change
  ([C-17](artifacts/current-state-findings.md#c-17-highlights-are-one-files-list-mixing-claudes-questions-with-unlabeled-changed-passages)).
- **The canvas fonts are approximated by local stacks.** The look will differ slightly from the canvas.
- **`markdown-editor.tsx` is the highest-churn file.** Units 4, 5, 6 and 10 all edit it; build them in order on one
  branch.

## Deferred (YAGNI)

- **A `<Notice>` component.** Two CSS classes cover today's notices. Reopen when notices gain dismiss or actions in three
  or more places ([D-15](artifacts/change-decision-log.md#d-15-notices-are-neutral-by-default-and-red-when-they-report-an-error)).
- **Undo all across a reload, or for a stopped reply.** Reopen when the writer loses an Undo all through a reload, or
  asks to undo a stopped reply ([D-5](artifacts/change-decision-log.md#d-5-undo-all-restores-each-file-to-its-text-at-send-redo-puts-back-what-undo-replaced)).
- **One shared pill and ask-button component for both views**
  ([C-4](artifacts/current-state-findings.md#c-4-the-question-pill-and-the-ask-button-exist-twice-for-the-rendered-view-and-the-raw-pane)).
  Reopen when the pill's markup changes again.
- **A block-type dropdown that shows the current style** ([D-1](artifacts/change-decision-log.md#d-1-keep-prosemirror-menu-for-a-trimmed-toolbar)). Reopen when the
  writer asks for it.
- **Bundled canvas fonts** ([D-17](artifacts/change-decision-log.md#d-17-the-canvass-palette-and-local-font-stacks)). Reopen when the operator asks for the exact
  fonts.

## Cut for Scope

- **Checking the disk before Save overwrites it.** It would have warned before Save replaced a file that changed on
  disk. Cut because the scope excludes "how files are saved and watched"
  ([scope-boundary.md](artifacts/scope-boundary.md)).
- **Keeping or ending old chat sessions on the server.** It would have let the writer reach a chat after New chat. Cut
  because the scope excludes the server
  ([C-18](artifacts/current-state-findings.md#c-18-clear-chat-starts-a-new-session-at-once-even-while-claude-works)).

## Open Items

None blocking. The builder inherits one non-blocking question. The canvas's exact spacing and sizes are read by eye from
the canvas; small differences are acceptable.

## Review Findings

Pending the review round.

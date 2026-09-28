# Change Plan: Clickable question pills

## Why This Change

The writer wants to click a pill and see its question in a speech-bubble popup. From there they can accept the
suggestion or discuss it, and their message lands in the chat as if they had typed it. Pills come from a
`/collaborative-draft-editing` review, where the AI highlights passages in the draft and marks each with a pill
labelled `Q1`, `Q2`, and so on.

This is a **constraint arriving**: a new requirement the current structure cannot absorb. Only the chat component can
send a message, and a pill knows its label but not its question. Source: the operator's request, recorded in
[artifacts/scope-boundary.md](artifacts/scope-boundary.md).

## What Changes, In One Paragraph

The AI hands over each question's text together with the passage it highlights. A pill becomes a button that tells the
page which passage the writer asked about. The page opens a speech bubble under the pill. The bubble sends the writer's
reply through the same chat session the chat panel uses. Sending a message, and filling the chat box, stop being private
to the chat panel: the page owns them and hands them to both the chat panel and the popup. The editor still knows
nothing about the chat, and the chat still knows nothing about the editor.

## Current State

The wiring runs one way, and this change addresses that. An action in the editor cannot cause a chat send, because the
send lives inside the chat panel.

- **Sending is private to the chat panel.** Only `Chat` can send a message or tell whether a turn is running
  ([C-1](artifacts/current-state-findings.md#c-1-sending-a-chat-message-is-private-to-chat)).
- **Only `app.tsx` may connect features, and today it connects them one way.** Finished turns flow into the
  documents, and document state flows into the chat
  ([C-2](artifacts/current-state-findings.md#c-2-apptsx-is-the-only-place-that-wires-features-together-and-today-the-wiring-runs-one-way-only)).
- **A pill is plain DOM that ProseMirror draws, and it knows only its label.**
  ([C-3](artifacts/current-state-findings.md#c-3-the-label-chip-is-plain-dom-built-outside-react-and-receives-only-its-label)).
  ProseMirror is the rich-text editor library the app is built on. A click on a pill goes to the editor, which moves the
  caret and takes focus
  ([C-5](artifacts/current-state-findings.md#c-5-a-click-on-the-chip-currently-goes-to-prosemirror)).
- **A pill's DOM node can outlive its passage.** Pills are keyed by label, so ProseMirror can keep the old node when a
  later turn reuses a label
  ([C-4](artifacts/current-state-findings.md#c-4-a-chip-keyed-only-by-its-label-can-keep-its-dom-node-when-a-later-turn-reuses-the-label)).
- **The question text exists only in the AI's chat reply.** The Highlight tool takes only a quote and a label
  ([C-13](artifacts/current-state-findings.md#c-13-the-skill-writes-each-question-into-the-chat-and-passes-only-quote-and-label-to-highlight)).
  Whatever the tool is given reaches the browser unchanged
  ([C-8](artifacts/current-state-findings.md#c-8-highlight-passages-reach-the-browser-untransformed)).
- **A new turn, New chat, and a file switch each replace the highlights, and nothing else signals that a pill has
  gone.** A file switch also rebuilds the whole editor
  ([C-9](artifacts/current-state-findings.md#c-9-switching-files-remounts-the-whole-editor),
  [C-12](artifacts/current-state-findings.md#c-12-nothing-signals-that-a-chips-passage-has-gone)).
- **The only popup in the app is a modal dialog.** "Modal" means it blocks the rest of the page while it is open
  ([C-6](artifacts/current-state-findings.md#c-6-the-only-popup-in-the-app-is-the-modal-new-document-dialog)).
- **The chat shows a user's message as plain text**
  ([C-11](artifacts/current-state-findings.md#c-11-the-chat-shows-a-users-message-as-plain-text)).

## Target State

After the change, five parts each own one piece of the flow.

1. **The AI supplies the question** alongside each highlighted passage.
2. **The editor** turns a pill click into a report of which passage was asked about.
3. **A chat-session hook** owns sending and the chat box's text.
4. **The page** decides which popup is open, and when it closes.
5. **The popup** shows the question and builds the message.

### The question travels with its passage

`Passage` and the Highlight tool's input schema each gain an optional `question`
([D-1](artifacts/change-decision-log.md#d-1-the-question-travels-on-the-passage-as-an-optional-question-field)).
A chat line `**Q1** — Is this aside worth keeping? I'd cut it.` pairs with the passage below.

```ts
// src/shared/wire.ts
export interface Passage {
  quote: string;
  label?: string;
  // The question the chat asks about this passage, without its label, shown when the writer clicks the label.
  question?: string;
}
// example: { quote: "…", label: "Q1", question: "Is this aside worth keeping? I'd cut it." }
```

The skill tells the model to fill `question`. It also tells the model how to read a writer's message that starts with a
label, such as `Q2 — I accept the suggestions.`. That message answers Q2, and "I accept the suggestions." means go ahead
with what was proposed for it
([D-7](artifacts/change-decision-log.md#d-7-accept-is-a-chat-message-and-the-skill-treats-a-label-led-message-as-the-answer-to-that-question),
[D-15](artifacts/change-decision-log.md#trivial-decisions)).

### The editor reports which pill was clicked, and nothing else

A pill becomes a button. A click on it no longer reaches ProseMirror. The plugin that draws highlights listens for pill
clicks. On a click, it looks up the passage for that label in its *current* state and reports it as an `Ask`. Because
the lookup happens at click time, a DOM node reused from an earlier turn still opens the current question
([D-2](artifacts/change-decision-log.md#d-2-a-pill-click-leaves-the-editor-through-one-listener-and-the-passage-is-looked-up-by-label-when-clicked)).

```ts
// src/ui/markdown-editor.tsx
export type Ask = { passage: Passage; anchor: HTMLElement };
export function highlightsPlugin(initial: Passage[], onShown: (shown: number) => void, onAsk: (ask: Ask) => void = () => {}): Plugin;
export function MarkdownEditor(props: { doc: Y.Doc; readOnly: boolean; highlights: Passage[]; onAsk?: (ask: Ask) => void }): JSX.Element;
// pill: <button type="button" class="ai-highlight-label" contenteditable="false" aria-haspopup="dialog">Q1</button>
// widget spec: { side: -1, key: `label-${label}`, stopEvent: () => true, ignoreSelection: true }
```

- **Listeners.** The plugin's view adds a `mousedown` listener that calls `preventDefault` on a pill, and a `click`
  listener that calls `onAsk`. Both sit on `view.dom`, and its `destroy` removes them.
- **Reading `onAsk`.** `MarkdownEditor` reads `onAsk` through a ref, the way it reads `readOnly`, because the plugin is
  built once per document.
- **Forwarding.** `Editor` in `documents.tsx` forwards `onAsk`.

### The chat session is a hook the page owns

`useChatSession` in `chat.tsx` holds what `Chat` holds today, plus the chat box's text. Its `send` is the only way to
send a message
([D-3](artifacts/change-decision-log.md#d-3-the-chat-session-including-the-composers-text-moves-into-a-usechatsession-hook-that-app-calls)).
Everything it takes over from `Chat`:

- the transport and `useChat`
- the finished-turn handling
- `busy`
- the chat box's text, as `draft`

```ts
export function useChatSession(options: {
  sessionId?: string;
  openFile: string;
  beginTurn: () => { documents: Record<string, string> };
  onTurnFinished: (data: SessionData) => void;
}): {
  messages: UIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  busy: boolean;
  // What the chat box holds. Cleared when sessionId changes.
  draft: string;
  setDraft: (text: string) => void;
  // Sends `text` as the writer's message; false, and nothing sent, when there is no session, a turn is running, or `text` is blank.
  send: (text: string) => boolean;
  cancel: () => void;
};
export type ChatSession = ReturnType<typeof useChatSession>;
export function Chat({ chat }: { chat: ChatSession }): JSX.Element;
```

`send` calls `beginTurn` exactly once per message it sends
([C-10](artifacts/current-state-findings.md#c-10-beginturn-must-be-called-exactly-once-per-message-sent)). `Chat`'s
composer sends `chat.draft` and clears it when `send` returns true.

### The page owns the open popup

`App` holds the open popup's `Ask` and the text typed into it. It clears that state whenever the highlights change. A
new turn, New chat, and a file switch all replace the highlights, so the popup cannot come back on stale state
([D-4](artifacts/change-decision-log.md#d-4-app-owns-which-popup-is-open-and-clears-it-when-the-highlights-change)).

If the popup holds typed text when that happens, the text first moves into the chat box as `Q2 — <text>`. It goes
after a blank line if the box already holds something
([D-12](artifacts/change-decision-log.md#d-12-text-typed-in-a-popup-moves-to-the-chat-box-when-the-ais-turn-ends)).
In practice only a turn ending triggers this, because switching files or clicking New chat is an outside click, and an
outside click has already closed the popup.

```tsx
const [asking, setAsking] = useState<Ask & { text: string }>();
const onAsk = (ask: Ask) => setAsking({ ...ask, text: '' });
useEffect(() => {
  setAsking((open) => {
    if (open?.text.trim()) chat.setDraft(joinDraft(chat.draft, `${open.passage.label} — ${open.text.trim()}`));
    return undefined;
  });
}, [docs.highlights]);
// joinDraft(a, b) = a.trim() ? `${a}\n\n${b}` : b
```

### The popup builds the message and closes itself

`QuestionPopup` lives in `src/ui/question-popup.tsx`, with `question-popup.css` beside it. It imports only `Passage`:

```ts
export function QuestionPopup(props: {
  passage: Passage;
  anchor: HTMLElement;
  busy: boolean;
  text: string;
  onText: (text: string) => void;
  onSend: (message: string) => void;
  onClose: () => void;
}): JSX.Element;
```

It shows, in order:

1. A heading with the label, and an X close button at the top right.
2. The question. When `question` is absent, it shows "See Q1 in the chat." instead
   ([D-11](artifacts/change-decision-log.md#trivial-decisions)).
3. The **Accept suggestions** button.
4. A small discussion box and a **Send** button.
5. While busy, a line reading "Waiting for the AI to finish replying".

**What it sends** ([D-6](artifacts/change-decision-log.md#d-6-popup-messages-start-with-the-plain-label)):

- **Accept** sends `Q1 — I accept the suggestions.`
- **Send** sends `Q1 — <the text, trimmed>`, and needs non-blank text.
- **Keys.** Enter sends and Shift+Enter adds a newline. Enter does nothing while busy or while an input method is
  composing.
- **Separator.** Every message joins the label and the text with a space, an em dash, and a space.
- **While busy.** Accept and Send are disabled, and the typed text stays
  ([D-9](artifacts/change-decision-log.md#trivial-decisions)).

**How it looks and where it sits**
([D-5](artifacts/change-decision-log.md#d-5-the-bubble-is-fixed-position-placed-from-the-pills-box-and-dismissed-by-a-document-listener)):

- **Placement.** It is placed against the window rather than inside the editor's scrolling area, positioned from the
  pill's box.
  - It sits below the pill, and flips above near the window's bottom.
  - It is kept 8px from the window's sides.
  - A small rotated square forms an arrow that points at the pill's centre.
  - It is repositioned on scroll and resize.
- **Colours.** They come from the `styles.css` tokens, with a `CanvasText` border on the bubble and the arrow in
  forced-colours mode.

**When it closes:**

- a mousedown outside both the bubble and its pill
- Escape pressed inside the bubble
- the X
- its pill scrolling out of view
  ([D-10](artifacts/change-decision-log.md#d-10-a-popup-whose-pill-scrolls-out-of-view-closes))
- its pill leaving the document

All of these discard typed text. Only a turn ending moves it to the chat box.

**Focus and screen readers**
([D-13](artifacts/change-decision-log.md#d-13-focus-naming-and-feedback-inside-the-popup)):

- **On open,** the discussion box takes focus.
- **After Send, Accept, the X, or Escape,** focus returns to the pill, or to the editor if the pill is gone.
- **Naming.** The bubble is a non-modal dialog. Its label heading names it, and the question paragraph describes it.
  The discussion box is named "Discuss Q1".
- **Tab** moves on out of the bubble in page order, and the bubble stays open.
- **The X** is at least 24×24px.

```tsx
// src/ui/app.tsx
{asking && (
  <QuestionPopup key={asking.passage.label} passage={asking.passage} anchor={asking.anchor} busy={chat.busy}
    text={asking.text} onText={(text) => setAsking({ ...asking, text })}
    onSend={(message) => { if (chat.send(message)) setAsking(undefined); }}
    onClose={() => setAsking(undefined)} />
)}
// bubble: role="dialog" aria-labelledby={headingId} aria-describedby={questionId}; textarea aria-label={`Discuss ${label}`}
// Escape: keydown listener on the bubble element, not on document
```

## Surface Delta

### S-1: `Passage.question` and the Highlight tool's `question` input — Added

**Target state.** `Passage` has an optional `question: string`: the question the chat asks about the passage, without
its label.
- **Schema.** The Highlight tool accepts `question: z.string().min(1).optional()` on each passage.
- **Delivery.** The tool stores the field unchanged in `turn.highlights`, so it reaches the browser in
  `SessionData.highlights`.
- **Description.** The tool's description ends: "Give each passage a distinct label, such as Q1, and put the question
  you ask about it in `question`, in the same words as the chat, without the label. Start your question in the chat
  with that label."

**Behavior.** Changing. The model sees a new optional input and a new sentence in the description. Callers that leave
out `question` get what they get today. Requested by the operator.

**Why.** The popup needs the question text, and the operator chose the AI as its source.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-question-travels-on-the-passage-as-an-optional-question-field)

### S-2: The label pill (`labelChip` and its widget spec) — Re-scoped

**Target state.** A pill is a `<button type="button" class="ai-highlight-label" contenteditable="false">` holding only
the label text. From Unit 4 on, it also carries `aria-haspopup="dialog"`.
- **Widget spec.** It is drawn with `stopEvent: () => true`, `ignoreSelection: true`, `side: -1`, and the key
  `label-${label}`.
- **Interaction.** It can be focused with Tab and activated by a click, Enter, or Space.
- **Look.** It looks as it does today, plus `cursor: pointer` and a `:focus-visible` outline of `2px solid
  var(--accent)` with `outline-offset: 2px`.

**Behavior.** Changing. A click on a pill no longer moves the caret or focuses the editor, and Tab stops on each pill.
Escalated: the operator chose keyboard-reachable pills.

**Why.** A pill must be clickable, and must not hand its clicks to ProseMirror (C-5).

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-pill-click-leaves-the-editor-through-one-listener-and-the-passage-is-looked-up-by-label-when-clicked),
[D-8](artifacts/change-decision-log.md#d-8-pills-can-be-reached-with-the-keyboard)

### S-3: `Ask` — Added

**Target state.** `src/ui/markdown-editor.tsx` exports `Ask` as `{ passage: Passage; anchor: HTMLElement }`: the passage
the writer asked about, and the pill it was asked from.

**Behavior.** Preserving. It is a type, so nothing observable depends on it on its own.

**Why.** The editor, `Editor`, and `App` all pass it, so its shape is a contract between them.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-pill-click-leaves-the-editor-through-one-listener-and-the-passage-is-looked-up-by-label-when-clicked)

### S-4: `highlightsPlugin` — Re-scoped

**Target state.** `highlightsPlugin(initial, onShown, onAsk = () => {})` also owns turning a pill click into an `Ask`.
- **Listeners.** Its view listens for `mousedown` and `click` on `view.dom`, and its `destroy` removes both listeners.
- **Lookup.** On a pill click, it finds the passage by label in the current plugin state and calls `onAsk`.
- **Unchanged.** Drawing, mapping, the status count, and scroll-into-view stay as they are.

**Behavior.** Changing. Even with the default `onAsk`, a mousedown on a pill no longer places the caret. The existing
tests still pass, because none of them clicks a pill (C-15).

**Why.** The plugin is the one place that holds both the current passages and the view's DOM.

**Depends on.** S-2, S-3.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-pill-click-leaves-the-editor-through-one-listener-and-the-passage-is-looked-up-by-label-when-clicked)

### S-5: `MarkdownEditor` and `Editor` props — Re-scoped

**Target state.** `MarkdownEditor` takes an optional `onAsk?: (ask: Ask) => void`, reads it through a ref, and passes
it to `highlightsPlugin`. `Editor` in `documents.tsx` takes `{ docs, onAsk? }` and forwards `onAsk`.

**Behavior.** Changing, through S-2 and S-4: pill clicks no longer place the caret, whether or not `onAsk` is passed.
Every other behavior of both components is unchanged.

**Why.** It carries a click from the editor out to `App`.

**Depends on.** S-4.

**Decision.** [D-2](artifacts/change-decision-log.md#d-2-a-pill-click-leaves-the-editor-through-one-listener-and-the-passage-is-looked-up-by-label-when-clicked),
[D-4](artifacts/change-decision-log.md#d-4-app-owns-which-popup-is-open-and-clears-it-when-the-highlights-change)

### S-6: `useChatSession` — Added

**Target state.** `useChatSession` in `src/ui/chat.tsx` owns a chat session:
- the transport and `useChat`
- the finished-turn handling, which calls `onTurnFinished` only for a turn that ran to the end
- `busy`, `cancel`, and `send`
- the chat box's text, as `draft` and `setDraft`, cleared when `sessionId` changes

`send(text)` is the only path to `sendMessage`. It returns false and sends nothing when there is no session, a turn is
running, or the text is blank. Otherwise it sends with `{ openFile, ...beginTurn() }` as the body and returns true.

**Behavior.** Preserving. It is the code `Chat` runs today, moved. The request body, the busy guard, and the
finished-turn handling are unchanged, and the chat box still starts empty in each new session. The chat session now
lives in `App` rather than in a component rebuilt per session. The D-14 test pins what New chat during a running turn
does today, before the move.

**Why.** The popup needs `send` and `busy`, and D-12 needs to write into the chat box. Only `App` may join the chat to
anything else.

**Migration.** Where you rendered `<Chat sessionId openFile beginTurn onTurnFinished />`, call
`useChatSession({ sessionId, openFile, beginTurn, onTurnFinished })` and render `<Chat chat={session} />`.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-chat-session-including-the-composers-text-moves-into-a-usechatsession-hook-that-app-calls),
[D-12](artifacts/change-decision-log.md#d-12-text-typed-in-a-popup-moves-to-the-chat-box-when-the-ais-turn-ends)

### S-7: `Chat` — Re-scoped

**Target state.** `Chat({ chat })` renders the session's messages, status, and error, plus the composer.
- **Composer.** It edits `chat.draft`, and sends it with `chat.send(chat.draft)`, clearing it when that returns true.
- **Stop.** Its Stop button calls `chat.cancel`.
- **Ownership.** It owns no state of its own. `App` still keys it by session id.

**Behavior.** Preserving. The panel looks and behaves as it does today.

**Why.** Its session state moved to S-6.

**Depends on.** S-6.

**Decision.** [D-3](artifacts/change-decision-log.md#d-3-the-chat-session-including-the-composers-text-moves-into-a-usechatsession-hook-that-app-calls)

### S-8: `QuestionPopup` and `question-popup.css` — Added

**Target state.** `QuestionPopup({ passage, anchor, busy, text, onText, onSend, onClose })` in
`src/ui/question-popup.tsx` renders a speech bubble pointing at `anchor`.
- **Contents.** It shows the label heading with an X, and the passage's `question` or "See Q1 in the chat.". Below
  those are **Accept suggestions**, a discussion box with **Send**, and, while busy, "Waiting for the AI to finish
  replying".
- **Sending.** Accept sends `${label} — I accept the suggestions.`. Send sends `${label} — ${text.trim()}` and needs
  non-blank text. While `busy`, both are disabled, Enter does nothing, and the text is kept. Enter also does nothing
  while an input method is composing.
- **Closing.** It closes on:
  - an outside mousedown (the pill does not count as outside)
  - Escape inside the bubble
  - the X
  - its pill scrolling out of view
  - its pill leaving the document
- **Focus.** It returns focus to the pill, or to the editor, after Send, Accept, the X, or Escape.
- **Placement.** It is fixed to the window, repositioned on scroll and resize, and flips above near the window's
  bottom.
- **Accessibility.** It is `role="dialog"`, with `aria-labelledby` on the heading and `aria-describedby` on the
  question. The textarea is labelled `Discuss ${label}`, and the X is at least 24×24px.
- **Colours.** They come from `styles.css` tokens, with a `CanvasText` border in forced-colours mode.

**Behavior.** Changing. This is the new surface the operator asked for.

**Why.** The operator's request.

**Depends on.** S-1.

**Decision.** [D-5](artifacts/change-decision-log.md#d-5-the-bubble-is-fixed-position-placed-from-the-pills-box-and-dismissed-by-a-document-listener),
[D-6](artifacts/change-decision-log.md#d-6-popup-messages-start-with-the-plain-label),
[D-10](artifacts/change-decision-log.md#d-10-a-popup-whose-pill-scrolls-out-of-view-closes),
[D-13](artifacts/change-decision-log.md#d-13-focus-naming-and-feedback-inside-the-popup)

### S-9: `App` — Re-scoped

**Target state.** `App` calls `useChatSession` and keeps the open popup's `Ask` and its typed text.
- **Clearing.** It clears that state whenever `docs.highlights` changes, first moving any typed text into the chat box
  as `${label} — ${text}`.
- **Wiring.** It passes `onAsk` to `Editor`, and `chat.busy` and `chat.send` to the popup. It closes the popup when
  `send` returns true.
- **Convention.** It is still the only file that joins features.

**Behavior.** Changing. It wires the new popup. Everything it wired before is unchanged.

**Why.** Only `App` may join the editor to the chat (C-2).

**Depends on.** S-5, S-6, S-7, S-8.

**Decision.** [D-4](artifacts/change-decision-log.md#d-4-app-owns-which-popup-is-open-and-clears-it-when-the-highlights-change),
[D-12](artifacts/change-decision-log.md#d-12-text-typed-in-a-popup-moves-to-the-chat-box-when-the-ais-turn-ends)

### S-10: The collaborative-draft-editing skill's highlight and answer rules — Re-scoped

**Target state.** The skill's rules change in two ways:
- **Highlight rule.** "Highlight what you discuss" tells the model to put each question, including any change it
  suggests, in the passage's `question`, with the D-1 worked example.
- **New answer rule.** A writer's message that starts with a label and an em dash, as in
  `Q2 — I accept the suggestions.`, answers that question. `I accept the suggestions.` means go ahead with what was
  proposed for it.

**Behavior.** Changing. The AI fills a new field and reads label-led answers. Requested by the operator.

**Why.** The popup's question text comes from here, and Accept depends on the AI reading label-led answers. The Accept
text in the popup and in this rule must match word for word.

**Depends on.** S-1.

**Decision.** [D-1](artifacts/change-decision-log.md#d-1-the-question-travels-on-the-passage-as-an-optional-question-field),
[D-7](artifacts/change-decision-log.md#d-7-accept-is-a-chat-message-and-the-skill-treats-a-label-led-message-as-the-answer-to-that-question)

## Behavior Changes

**What the writer sees differently:**

- **Clicking a Q pill opens a speech bubble** with the AI's question, instead of placing the text cursor. Requested.
- **Accept and Send reply from the bubble.** Accept sends `Q1 — I accept the suggestions.` and Send sends
  `Q1 — <your text>`. Each appears in the chat at once as the writer's own message, and the bubble closes. You decided
  on a plain label with no bold, because the chat shows your messages exactly as typed
  ([D-6](artifacts/change-decision-log.md#d-6-popup-messages-start-with-the-plain-label)).
- **While the AI is replying,** Accept and Send are greyed out, a line says why, and your typed text stays. Requested.
- **When the AI's reply ends,** an open bubble closes, and anything you had typed in it moves into the chat box, ready
  to edit or send. You decided this
  ([D-12](artifacts/change-decision-log.md#d-12-text-typed-in-a-popup-moves-to-the-chat-box-when-the-ais-turn-ends)).
- **Clicking outside, Escape, the X, or scrolling the pill away** closes the bubble and discards its text.
- **Tab stops on each pill** in a highlighted draft before leaving the editor, and Enter opens its bubble. You decided
  this ([D-8](artifacts/change-decision-log.md#d-8-pills-can-be-reached-with-the-keyboard)).

**What the AI sees differently:** the Highlight tool takes an optional `question`. The skill asks for it, and explains
label-led answers
([D-7](artifacts/change-decision-log.md#d-7-accept-is-a-chat-message-and-the-skill-treats-a-label-led-message-as-the-answer-to-that-question)).

**What stays the same:** the chat panel behaves as it does today. The editor does too for anyone who never clicks a
pill, apart from the Tab stops.

## Change Units

### Unit 1: The AI supplies each question's text

**What it does.** It adds `question` to `Passage`, the Highlight schema, and the tool description. It updates the
skill's highlight rule and adds the label-led answer rule. The UI ignores the new field, so nothing visible changes yet.

**Delta entries.** S-1, S-10.

**How you know it worked.**
- In `tools.test.ts`, a passage with `question` round-trips into `turn.highlights`.
- The existing Highlight tests pass.
- The collaborative-draft-editing scenario in `scripts/check.ts` also expects every highlighted passage to carry a
  `question`.

### Unit 2: The chat session moves into `useChatSession`

**What it does.** It moves the session and the chat box's text out of `Chat`, into a hook that `App` calls. It is a
pure move, with no visible change.

**Delta entries.** S-6, S-7, and the `useChatSession` part of S-9.

**How you know it worked.**
1. **Before the move,** add a test to `chat.test.tsx` that starts a new session while a turn is running. It pins
   whether the old turn's edits reach `onTurnFinished`
   ([D-14](artifacts/change-decision-log.md#trivial-decisions)).
2. **Rewrite `renderChat`** as a small wrapper component that calls `useChatSession` and renders `<Chat chat>`. This
   cannot be avoided, because `Chat`'s props change. Every existing assertion stays as it is.
3. **Add tests.** Calling `send` from outside the composer puts the message in the chat, with the same request body the
   composer sends. `send` returns false and sends nothing while a turn is running. `setDraft` fills the chat box.
4. **Run the suite.** The step 1 test and every existing test pass.

### Unit 3: Pills become buttons that report a click

**What it does.** It turns pills into buttons, and gives the plugin its click listeners and `onAsk`. It threads `onAsk`
through `MarkdownEditor` and `Editor`. `App` passes nothing yet, so a click only stops placing the caret.
`aria-haspopup` is left off, so a screen reader does not announce a popup that cannot open yet.

**Delta entries.** S-2 (without `aria-haspopup`), S-3, S-4, S-5.

**How you know it worked.**
- Existing `markdown-editor.test.tsx` tests pass, because they read pills by class and text.
- New test: highlight Q1 on passage A, then on passage B, click the Q1 pill, and `onAsk` receives passage B.
- New test: a pill click does not change the editor's selection.

### Unit 4: The question popup

**What it does.** It adds `QuestionPopup` and its CSS, wires it in `App`, and adds `aria-haspopup="dialog"` to the
pill.

**Delta entries.** S-8, the rest of S-9, and the rest of S-2.

**Ordering constraint.** After Units 1, 2, and 3. It needs `question`, then `send`, `busy`, and `setDraft`, then
`onAsk`.

**How you know it worked.**
- **`question-popup.test.tsx`:**
  - It shows the question, or "See Q1 in the chat." without one.
  - Accept and Send call `onSend` with the pinned text.
  - Send and Enter do nothing for blank text or while busy. Busy shows the waiting line and keeps the text.
  - X, Escape, and an outside mousedown call `onClose`. A mousedown on the pill does not.
  - Focus lands in the textarea on open, and on the pill after the X.
- **App-level tests** (the first for `app.tsx`):
  - Clicking a pill opens the popup.
  - Sending shows the message in the chat and closes the popup.
  - Switching files A→B→A does not bring it back.
  - New highlights close it and move its typed text into the chat box.

Whether a `document`-level mousedown listener fires under the test library's `fireEvent` in happy-dom is Unverified.
happy-dom is the simulated browser the UI tests run in, and no test in the repo exercises that pattern yet. The first
popup test settles it.

### Unit 5: Check it in a real browser

**What it does.** It runs the app with the `run` skill and checks what happy-dom cannot. happy-dom does not lay out the
page, so it cannot measure positions.
- The bubble's placement, its flip above near the bottom, and the arrow pointing at the pill.
- Closing when the pill scrolls out of view.
- Tab reaching each pill, and Enter opening it, in Chrome and Safari at least.
- The focus outline visible against the pill.

**Ordering constraint.** After Unit 4.

**How you know it worked.** Each item above is seen working. A failure on the Tab item reopens
[D-8](artifacts/change-decision-log.md#d-8-pills-can-be-reached-with-the-keyboard).

## Risks

- **Positioning can only be tested in a browser.** In happy-dom, `getBoundingClientRect` always returns zeros, so
  coordinates and scroll-out closing are untested by `bun test`. Unit 5 catches them.
- **The model may not fill `question`.** Only the skill's instruction fills it. The popup still works without it,
  showing "See Q1 in the chat.". `scripts/check.ts` is the only place this is enforced, and it runs against the real
  API.
- **Unit 2 touches every chat test, and changes how long the chat session lives.** Its blast radius is the chat panel.
  The D-14 test written before the move, plus unchanged assertions, shows nothing broke.
- **The Accept wording is written in two places.** The popup and the skill must match word for word, and nothing checks
  this automatically. Anyone changing one changes the other.

## Deferred (YAGNI)

- **One declaration for `Passage`** (C-7). Deriving the type from the Zod schema would make `src/shared` import Zod,
  which breaks its no-imports rule, to save duplicating three fields. Reopen when a field added to one declaration is
  missed in the other, or when a fourth field arrives.
- **A generic Popover component or a positioning library.** There is one anchored popup. Reopen at a second.
- **Rendering the writer's chat messages as markdown.** Only needed for bold labels, which the operator declined.
  Reopen if user messages need formatting for another reason.
- **`aria-expanded` on the pill.** It would need the editor to mirror popup state into ProseMirror's DOM. Reopen if an
  accessibility review asks for it.
- **Keeping the bubble's text when it scrolls out of view.** The first draft hid it instead of closing it (D-10). Reopen
  if a writer reports losing text to a scroll.

## Cut for Scope

Three review findings concern the existing chat panel rather than the pills or popup. The boundary covers the popup's
own behavior only ([artifacts/scope-boundary.md](artifacts/scope-boundary.md), "Stated Scope"), so they are cut. You can
reinstate any of them.

- **Announcing a chat error to screen readers** (UX-005). The chat's error line would get `role="alert"`, so a send that
  fails after the popup closes is read out.
- **Announcing "thinking…" to screen readers** (UX-006). The chat would keep a persistent live region, so a screen
  reader hears that a sent message is being worked on.
- **Input-method guard on the chat's own Enter key** (UX-012). The composer would stop sending a half-composed message
  for writers using an input method, such as for Chinese or Japanese. The popup gets this guard, and the composer does
  not.

## Open Items

- **Non-blocking: does Tab reach a button inside the editor in every browser?** Unverified until Unit 5. If it does
  not, a keyboard shortcut that opens the nearest pill's popup is the fallback, and D-8 reopens.
- **Non-blocking: what does New chat during a running turn do today?** The D-14 test in Unit 2 records the answer
  before the move. It is not decided here, only preserved.
- **Non-blocking: does a `document` mousedown listener fire under happy-dom's `fireEvent`?** The first popup test in
  Unit 4 settles it. If it does not, dispatch the event on `document` directly in that test.

## Review Findings

**Who reviewed it.** One review round ran, the cap for a medium change. The reviewers were
`han-core:junior-developer` (JD-1 to JD-9), `han-core:user-experience-designer` (UX-1 to UX-15), and
`han-core:test-engineer` (TE). Findings raised by more than one reviewer were merged. The decisions each finding produced
are in [artifacts/change-decision-log.md](artifacts/change-decision-log.md).

**Findings that changed the plan:**

- **A popup could come back after switching files A→B→A, pointing at a dead pill** (JD-1). The page now clears the
  popup on every highlight change (D-4).
- **Text kept while busy was lost when the turn ended** (JD-2, UX-2). It now moves to the chat box (D-12), which you
  chose.
- **S-4 and S-5 were wrongly marked Preserving** (JD-3, UX-13, TE). Both are now Changing. `aria-haspopup` waits for
  Unit 4.
- **Focus after closing, screen-reader naming, busy feedback, Escape scope, and input-method Enter were unpinned**
  (UX-1, UX-3, UX-4, UX-7, UX-12, UX-14, UX-15). These are now pinned (D-13).
- **Hiding on scroll-out was unrequested, dropped focus, and was untestable** (JD-6, UX-10, TE). The popup now closes
  on scroll-out (D-10).
- **A question with no text left Accept pointing at nothing visible** (JD-9, UX-11). The popup now shows "See Q1 in the
  chat." (D-11), and Accept's meaning is defined for pure questions (D-15).
- **The busy guard had no test** (TE). Unit 2 adds one.
- **The chat session's lifetime changes when it moves to `App`** (JD-4). A test before the move pins today's behavior
  (D-14).
- **Some operator answers had no recorded source** (JD-8). They are now quoted in `artifacts/scope-boundary.md`.

**Findings kept with their evidence recorded:**

- The flip above near the bottom stays (JD-7), with its evidence recorded in D-5.
- The Accept wording stays duplicated between the popup and the skill, as a documented pairing (JD-5, D-7).
- Tab leaving an open bubble is acceptable for a non-modal dialog (UX-8, D-13).
- An outside click discards text, as part of the requested close behavior (UX-9).
- The pill's touch-target size is unchanged while the app is used on desktop (UX-15).

**Unverified findings, none blocking:**

- Tab reaching pills in real browsers (D-8)
- real screen-reader announcements (UX-3)
- `document` mousedown under happy-dom (TE)

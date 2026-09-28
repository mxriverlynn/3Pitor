# Change Decision Log: Clickable question pills

<!--
This file records every decision committed while planning Clickable question pills.
The plan itself lives in [../change-plan.md](../change-plan.md). This file captures the
question, rationale, evidence, and rejected alternatives behind each decision.
Evidence about the code as it stands today lives in
[current-state-findings.md](current-state-findings.md) as numbered C-N findings.
Review findings are cited by reviewer ID: JD-N (junior-developer), UX-N
(user-experience-designer), TE (test-engineer).
-->

## Trivial decisions

- D-9: Accept and Send while the AI is replying — Both buttons are disabled while a turn runs, and text typed in the
  popup's box is kept, the same as the chat's own Send (operator: "go with your recommendations on all of these"). —
  Referenced in plan: Target State, Surface Delta.
- D-11: A pill with no question text — Every label pill is clickable. A popup for a passage without `question` shows
  "See Q1 in the chat." in place of the question, and still offers Accept and the discussion box (UX-011). —
  Referenced in plan: Target State.
- D-14: The first test in Unit 2 records how the chat behaves today — Before moving the session into the hook, add a
  test that clicks New chat while a turn is running and pins whether the old turn's edits apply. After the move, the
  test must pass unchanged (JD-004). — Referenced in plan: Change Units, Open Items.
- D-15: A reply to a pure question — Accept is offered for every question. The skill rule reads "accepting means go
  ahead with what you proposed for it". For a yes-or-no question, that is the yes (JD-009). — Referenced in plan: Surface
  Delta.

## Full decisions

### D-1: The question travels on the passage as an optional `question` field

- **Question:** Where does the popup get the question text?
- **Decision:** `Passage` gains an optional `question` field. The Highlight tool's Zod schema gains the same field. The
  tool description and the skill both tell the model to fill it.
  ```ts
  // src/shared/wire.ts
  export interface Passage {
    quote: string;
    label?: string;
    // The question the chat asks about this passage, without its label, shown when the writer clicks the label.
    question?: string;
  }
  // src/server/tools.ts, Highlight.inputSchema
  passages: z.array(z.object({
    quote: z.string().min(1),
    label: z.string().min(1).optional(),
    question: z.string().min(1).optional(),
  })).min(1),
  ```
  Worked example. The chat says `**Q1** — Is this aside worth keeping? I'd cut it.` and the model passes
  `{ quote: "…", label: "Q1", question: "Is this aside worth keeping? I'd cut it." }`.
- **Rationale:** The operator chose the AI as the source of the question text. Passages reach the browser untransformed,
  so the field needs no server-side mapping. It is optional because Highlight is also used outside the skill, for plain
  passages with no label, and a required field would make those calls fail.
- **Evidence:** C-7, C-8, C-13; operator's confirmation-turn answer (scope-boundary.md); software-architect A3.
- **Behavior impact:** Changing. The model sees a new optional field and a longer tool description, and a finished
  turn's `data-session.highlights` can carry `question`. The operator requested this.
- **Rejected alternatives:**
  - Parse the `**Q1** — …` paragraph out of the assistant's chat reply — rejected by the operator. It breaks silently when
    the model's wording or formatting drifts.
  - A required `question` — rejected because ordinary Highlight calls outside the skill have no question.
  - Derive `Passage` from the Zod schema to remove the duplicate declaration (C-7) — deferred, see the plan's Deferred
    (YAGNI) section.
- **Revisit criterion:** A third caller of Highlight needs a different kind of text per passage.
- **Dissent (if any):** None.
- **Settles delta entry:** S-1, S-10
- **Dependent decisions:** D-7, D-11
- **Referenced in plan:** Target State, Surface Delta

### D-2: A pill click leaves the editor through one listener, and the passage is looked up by label when clicked

- **Question:** How does a click on a pill, which ProseMirror draws outside React, reach React with the right passage?
- **Decision:** The chip is a `<button type="button" class="ai-highlight-label" contenteditable="false">` holding only
  its label. Unit 4 adds `aria-haspopup="dialog"`, once the popup exists. Its widget spec adds `stopEvent: () => true`
  and `ignoreSelection: true`. It keeps the key `label-${label}`. The `highlightsPlugin` view adds one `mousedown`
  listener (calls `preventDefault` on a chip) and one `click` listener to `view.dom`. On a chip click it finds the
  passage in the plugin's current state by label, then calls `onAsk`.
  ```ts
  // src/ui/markdown-editor.tsx
  export type Ask = { passage: Passage; anchor: HTMLElement };
  export function highlightsPlugin(
    initial: Passage[],
    onShown: (shown: number) => void,
    onAsk: (ask: Ask) => void = () => {},
  ): Plugin<Highlights>;
  // at click time:
  const passage = highlightsKey.getState(view.state)!.passages.find((p) => p.label === chip.textContent);
  if (passage) onAsk({ passage, anchor: chip });
  ```
  The plugin view's `destroy` removes both listeners.
- **Rationale:** ProseMirror keeps a chip's DOM node when a later turn reuses its label (C-4). A closure stored on the
  node would then open the old question. Looking the passage up by label, from current plugin state at click time,
  always finds the current one. The server already refuses duplicate labels, so the lookup is unambiguous. With
  `stopEvent`, ProseMirror neither moves the caret nor takes focus on the click (C-5).
- **Evidence:** C-3, C-4, C-5; `src/server/tools.ts` duplicate-label check; software-architect A2 (read
  `prosemirror-view` `input.ts` `eventBelongsToView`).
- **Behavior impact:** Changing, for every editor, whether or not `onAsk` is passed. A click on a pill no longer places
  the caret, and Tab stops on pills. S-2, S-4, and S-5 are classified Changing for this reason (JD-003, UX-013, TE). The
  operator requested clickable pills (scope boundary) and keyboard-reachable pills (D-8).
- **Rejected alternatives:**
  - A click listener attached inside `labelChip` capturing the passage — rejected because label-keyed node reuse (C-4)
    would show a stale question.
  - Changing the widget key to include the quote — rejected because the lookup makes it unnecessary. Keeping the key also
    keeps the popup's anchor attached when an undo redraws highlights.
  - Shipping `aria-haspopup` in Unit 3 — rejected because a screen reader would announce a popup that does not open
    until Unit 4 (UX-013).
- **Revisit criterion:** Labels stop being unique within one Highlight call.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2, S-3, S-4, S-5
- **Dependent decisions:** D-4, D-8
- **Referenced in plan:** Target State, Surface Delta

### D-3: The chat session, including the composer's text, moves into a `useChatSession` hook that `App` calls

- **Question:** How does something outside `Chat` send a message that appears in the chat as the writer's own, with the
  same captured editor state? How does it learn whether a turn is running, and how does it put text in the chat box
  (D-12)?
- **Decision:** `useChatSession` in `src/ui/chat.tsx` owns what `Chat` owns today: the transport, `useChat`, the
  `onFinish` handling, `busy`, and the composer's text. It returns a `send` that is the only path to `sendMessage`.
  `Chat` becomes the view.
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
  export function Chat({ chat }: { chat: ChatSession }): JSX.Element; // composer: if (chat.send(chat.draft)) chat.setDraft('')
  ```
  `App` calls `useChatSession` and renders `<Chat key={sessionId} chat={chat} />`.
- **Rationale:** The composer and the popup share one `send`, so both capture editor state with the same `beginTurn`,
  once per message (C-10), and share one busy guard. A message sent from either lands in the same `messages`, so the
  chat shows it at once. This is the shape `useDocuments` already has: a hook in `App`, with views taking its result.
  `useChat` rebuilds its chat when `id` changes and reads its callbacks from a ref, so moving it up to `App` keeps
  per-session behavior. The draft moves too, because D-12 has `App` write into it.
- **Evidence:** C-1, C-2, C-10; software-architect A1 (read `@ai-sdk/react` 4.0.117 `useChat`); D-12.
- **Behavior impact:** Preserving. The composer sends the same body with the same guard, and the chat renders the same
  messages. What changes is who can call `send` and write the draft. JD-004 noted that moving `useChat` from a keyed
  component to `App` changes its lifetime. D-14 pins today's New-chat-mid-turn behavior with a test written before the
  move.
- **Rejected alternatives:**
  - An imperative ref handle on `Chat` — rejected because busy would still need a second channel out.
  - `Chat` registering its `send` with `App` through a callback — rejected because re-registering on each `openFile` or
    `busy` change risks a stale `send`.
  - An "outbox" prop `Chat` sends from an effect — rejected because it uses an effect as an event, and busy still has to
    come out.
- **Revisit criterion:** A third place needs to send chat messages with different capture rules.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6, S-7
- **Dependent decisions:** D-4, D-12
- **Referenced in plan:** Target State, Surface Delta

### D-4: `App` owns which popup is open, and clears it when the highlights change

- **Question:** Where does the popup live, and how does it close when its passage goes away?
- **Decision:** The popup is a new feature file, `src/ui/question-popup.tsx` with `question-popup.css`, rendered by
  `App`. `App` holds the open popup's `Ask` and its discussion text. An effect on `docs.highlights` clears that state
  whenever the highlights array changes, after first moving any typed text to the chat box (D-12).
  ```tsx
  const [asking, setAsking] = useState<Ask & { text: string }>();
  const onAsk = (ask: Ask) => setAsking({ ...ask, text: '' });
  useEffect(() => {
    setAsking((open) => {
      if (open?.text.trim()) chat.setDraft(joinDraft(chat.draft, `${open.passage.label} — ${open.text.trim()}`));
      return undefined;
    });
  }, [docs.highlights]);
  {asking && (
    <QuestionPopup key={asking.passage.label} passage={asking.passage} anchor={asking.anchor} busy={chat.busy}
      text={asking.text} onText={(text) => setAsking({ ...asking, text })}
      onSend={(message) => { if (chat.send(message)) setAsking(undefined); }}
      onClose={() => setAsking(undefined)} />
  )}
  ```
  `joinDraft(a, b)` is `a.trim() ? `${a}\n\n${b}` : b`. The popup also calls `onClose` when its anchor is no longer
  connected to the document.
- **Rationale:** A new turn, New chat, and a file switch all change the identity of `docs.highlights` (C-9, C-12).
  Clearing on each change, rather than hiding while the identity differs, stops a popup from coming back when the writer
  switches files A→B→A and `docs.highlights` is the same array again (JD-001). In practice only a turn ending triggers
  the draft move: switching files or clicking New chat is a mousedown outside the popup, which has already closed it.
  This keeps `app.tsx` as the only file that joins features (C-2).
- **Evidence:** C-2, C-9, C-12; software-architect A4; JD-001; D-12.
- **Behavior impact:** Changing. A new, requested surface.
- **Rejected alternatives:**
  - Derive `open` by comparing the saved highlights array to the current one — rejected because the array comes back on
    A→B→A with a dead anchor (JD-001).
  - Keep the popup open across turns when the same label still exists — rejected because a new turn's Q2 is a different
    question from the old Q2 (UX-002's smallest fix).
  - Open state inside `MarkdownEditor` — rejected because the popup needs `send` and `busy`, which would make the editor
    depend on the chat.
  - Open state in `useDocuments` — rejected because it outlives the editor on a file switch (C-9) and would mix chat
    concerns into documents.
  - A generic, reusable Popover component — deferred, see Deferred (YAGNI).
- **Revisit criterion:** A second anchored popup appears.
- **Dissent (if any):** None.
- **Settles delta entry:** S-5, S-8, S-9
- **Dependent decisions:** D-5, D-10, D-12
- **Referenced in plan:** Target State, Surface Delta

### D-5: The bubble is fixed-position, placed from the pill's box, and dismissed by a document listener

- **Question:** How is the speech bubble positioned against a pill inside the scrolling editor, and how does it close?
- **Decision:**
  - `position: fixed`, placed from `anchor.getBoundingClientRect()` in a layout effect.
  - Below the pill (`top = rect.bottom + 10`). It flips above, with class `above`, when it would pass the bottom of
    the window.
  - `left` is clamped to 8px from each window edge. The arrow is a rotated square (`::before`) positioned with
    `--arrow-x`, so it points at the pill's centre.
  - Placement is recalculated on `window` `scroll` (capture phase, which catches the editor's own scroll) and on
    `resize`.
  - Closes on:
    - a `document` `mousedown` outside the bubble and outside the anchor pill
    - Escape, handled by a `keydown` listener on the bubble element only (UX-007)
    - the X button, `<button aria-label="Close">`
    - the pill scrolling out of view (D-10)
- **Rationale:** `fixed` gets out of the editor's overflow clipping. A mousedown on the anchor pill is ignored, so
  clicking the same pill does not close and reopen the popup. A mousedown on another pill closes this popup, and that
  pill's click opens its own. The flip stays: the editor fills the window's height, so pills near the bottom are common
  (JD-007, kept with that evidence).
- **Evidence:** C-6, C-14; software-architect A5 (happy-dom 20.14.5 has no `showPopover`); UX-007; JD-007.
- **Behavior impact:** Changing. A new, requested surface.
- **Rejected alternatives:**
  - The native `popover` attribute — rejected because happy-dom lacks `showPopover`, so the UI tests could not cover
    dismissal, and the listener it would replace is a few lines.
  - An Escape listener on `document` — rejected because Escape in the chat box or the New-document dialog would close the
    popup (UX-007).
  - A positioning library — deferred, see Deferred (YAGNI).
  - Absolute positioning inside `.rich-editor` — rejected because ProseMirror owns that element's children.
- **Revisit criterion:** The test environment gains `showPopover`, or a second anchored popup appears.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-10, D-13
- **Referenced in plan:** Target State, Surface Delta

### D-6: Popup messages start with the plain label

- **Question:** What text does the popup send?
- **Decision:** The popup builds the text, and `onSend` receives the final string.
  - Accept: `` `${label} — I accept the suggestions.` ``, for example `Q1 — I accept the suggestions.`
  - Send: `` `${label} — ${text.trim()}` ``, for example `Q2 — Keep it, but shorten it to one sentence.` Send requires
    non-blank text. Enter sends and Shift+Enter adds a newline, the same as the composer. Enter does nothing while busy
    or while an input method is composing (D-13).
  - The separator is a space, an em dash (U+2014), and a space. The skill rule (D-7) quotes the Accept text verbatim.
- **Rationale:** User messages render as plain text (C-11), so a bold label would show its asterisks.
- **Evidence:** C-11; user input.
- **Behavior impact:** Changing. Escalated. The question was: plain `Q1 — …` (recommended), a bold label (which needs user
  messages rendered as markdown), or visible asterisks. The operator answered: "go with recommendations".
- **Rejected alternatives:**
  - `**Q1** — …` with markdown rendering of user messages — rejected because it would change how everything the writer
    types is shown.
  - `**Q1** — …` rendered literally — rejected because the asterisks show.
- **Revisit criterion:** User messages start rendering markdown for another reason.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** D-7, D-12
- **Referenced in plan:** Target State, Behavior Changes

### D-7: Accept is a chat message, and the skill treats a label-led message as the answer to that question

- **Question:** What does Accept do, and how does the AI know what the writer is accepting?
- **Decision:** Accept sends `Q1 — I accept the suggestions.` (D-6) and changes nothing directly. The skill gains a rule:
  "When the writer's message starts with a label and an em dash, as in `Q2 — I accept the suggestions.`, it answers
  that question. `I accept the suggestions.` means go ahead with what you proposed for it." The skill's "Highlight what
  you discuss" rule also tells the model to put each question, including any change it suggests, in `question`.
- **Rationale:** The operator chose the chat path. The skill already applies accepted edits on the turn after the
  writer's answer (`references/pairing-brief.md`), so a labelled answer fits the flow the skill runs today. The exact
  Accept text appears in both the popup and the skill. That pairing is pinned by quoting it verbatim in both places.
  A test that reads SKILL.md is not warranted for one sentence (JD-005, kept as a documented pairing).
- **Evidence:** Operator's confirmation-turn answer; C-13; `src/skills/collaborative-draft-editing/references/pairing-brief.md`; JD-005.
- **Behavior impact:** Changing. The AI's instructions change. Requested.
- **Rejected alternatives:**
  - Accept applies the suggested edit directly in the editor — rejected by the operator.
  - A shared constant between the popup and the skill — rejected because the skill is markdown the model reads, not code
    that can import.
- **Revisit criterion:** The skill starts proposing edits as structured data that the editor could apply itself, or the
  Accept wording changes.
- **Dissent (if any):** None.
- **Settles delta entry:** S-10
- **Dependent decisions:** D-15
- **Referenced in plan:** Target State, Surface Delta

### D-8: Pills can be reached with the keyboard

- **Question:** Can the popup be opened without a mouse, given that this puts a Tab stop on each pill?
- **Decision:** Each pill is a `<button>`. Tab stops on it and Enter opens its popup. The `stopEvent` from D-2 keeps
  ProseMirror from treating that Enter as a new paragraph. The chip's CSS adds `border: 0; font: inherit; cursor:
  pointer` and a `:focus-visible` outline of `2px solid var(--accent)` with `outline-offset: 2px`, so it does not merge
  into the accent-coloured pill (UX-014).
- **Rationale:** Without it, keyboard users cannot reach the popup at all.
- **Evidence:** C-3; user input; UX-014.
- **Behavior impact:** Changing. Escalated. The question was: keyboard-reachable pills, where Tab from the draft stops
  on each pill before leaving the editor (recommended), or mouse only. The operator answered: "go with recommendation".
- **Rejected alternatives:**
  - Mouse only (`tabindex="-1"`) — rejected by the operator.
- **Revisit criterion:** Real-browser testing shows Tab does not reach a button inside the editor. Then a keyboard
  shortcut is the fallback.
- **Dissent (if any):** None.
- **Settles delta entry:** S-2
- **Dependent decisions:** —
- **Referenced in plan:** Surface Delta, Behavior Changes, Open Items

### D-10: A popup whose pill scrolls out of view closes

- **Question:** What happens to an open popup when the writer scrolls its pill out of the editor?
- **Decision:** On each placement recalculation, if the pill's box lies wholly outside the box of its nearest scrolling
  ancestor, the popup closes. Typed text is discarded, the same as an outside click.
- **Rationale:** The first draft hid the bubble with an `IntersectionObserver` to keep typed text. Reviewers found that
  hiding drops keyboard focus (UX-010), that the observer never fires in happy-dom so the behavior is untestable there
  (TE), and that the operator never asked for it (JD-006). Closing is the simpler version, and it reuses the existing
  placement calculation.
- **Evidence:** JD-006, UX-010, TE (happy-dom `IntersectionObserver.observe` is a no-op).
- **Behavior impact:** Changing. Part of the new, requested surface.
- **Rejected alternatives:**
  - Hide with an `IntersectionObserver` and keep the text — rejected per the rationale.
  - Leave it visible — rejected because it floats over other panels, detached from its pill.
- **Revisit criterion:** A writer reports losing text to a scroll.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** —
- **Referenced in plan:** Target State

### D-12: Text typed in a popup moves to the chat box when the AI's turn ends

- **Question:** The writer is typing in Q2's popup while the AI replies to Q1. The turn ends with new highlights, so the
  popup must close. What happens to the typed text?
- **Decision:** When `docs.highlights` changes while a popup is open with non-blank text, `App` writes
  `${label} — ${text.trim()}` into the chat box through `chat.setDraft`. If the chat box already holds text, the new
  text goes after a blank line. Then the popup closes. Example: text `I'd rather keep the first sentence.` in Q2's popup
  becomes `Q2 — I'd rather keep the first sentence.` in the chat box, ready to edit or send. An outside click, the X,
  Escape, and scrolling the pill away still discard the text.
- **Rationale:** Every stop of the skill ends with a Highlight call, so the busy period during which D-9 keeps text
  always ends by closing the popup (JD-002, UX-002). Without this, the kept text is lost at the moment Send becomes
  available.
- **Evidence:** JD-002, UX-002, UX-009; `src/skills/collaborative-draft-editing/SKILL.md` "Highlight what you discuss";
  user input.
- **Behavior impact:** Changing. Escalated. The options were: move the text into the chat box (recommended); lose it;
  or keep the popup open on the old question, where Send could land on the AI's new Q2. The operator answered: "go with
  recommendations for all the open questions".
- **Rejected alternatives:**
  - Lose the text — rejected by the operator.
  - Keep the popup open on the old question — rejected because the answer could land on the wrong question.
  - Keep a per-label draft and pre-fill it on reopen — rejected because a new turn's labels name new questions.
- **Revisit criterion:** The skill stops re-highlighting at the end of every turn.
- **Dissent (if any):** None.
- **Settles delta entry:** S-6, S-9
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Behavior Changes

### D-13: Focus, naming, and feedback inside the popup

- **Question:** Where does focus go, what does a screen reader hear, and what tells the writer why the buttons are off?
- **Decision:**
  - **On open:** focus goes to the discussion textarea.
  - **On close:** after Send, Accept, the X, or Escape, focus returns to the anchor pill when it is still in the
    document, and to the editor otherwise. After an outside mousedown, focus goes wherever that click puts it (UX-001).
  - **Naming:** the bubble is `role="dialog"`, with `aria-labelledby` on its label heading and `aria-describedby` on the
    question paragraph. The textarea has `aria-label="Discuss Q1"` (UX-003).
  - **Busy:** while busy, a line reads "Waiting for the AI to finish replying". Enter does nothing (UX-004).
  - **Input methods:** Enter does nothing while `e.nativeEvent.isComposing` (UX-012).
  - **Tab:** it moves on out of the bubble in document order, and the bubble stays open. This is acceptable for a
    non-modal dialog. Escape and the X are the ways to close it from the keyboard (UX-008).
  - **X button:** at least 24×24px (UX-015).
  - **Forced colours:** the bubble and its arrow have a `CanvasText` border (UX-014).
- **Rationale:** The reviewers found these unpinned, and each would otherwise be decided differently during the build.
- **Evidence:** UX-001, UX-003, UX-004, UX-008, UX-012, UX-014, UX-015.
- **Behavior impact:** Changing. Part of the new, requested surface.
- **Rejected alternatives:**
  - Closing on focus leaving the bubble — rejected because Tab to read the chat would throw away the text.
  - A focus trap — rejected because the popup is non-modal by design (click-outside close).
- **Revisit criterion:** A screen-reader check in Unit 5 finds the announcements wrong.
- **Dissent (if any):** None.
- **Settles delta entry:** S-8
- **Dependent decisions:** —
- **Referenced in plan:** Target State, Surface Delta

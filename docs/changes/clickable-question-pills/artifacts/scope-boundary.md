# Scope Boundary: Clickable question pills

## Work Item

No work item exists. The operator's request, typed when invoking `plan-a-change` on 2026-09-28, is the only boundary
this run has.

## Stated Scope

> when running the collaborative edit mode, i want the "Q1", "Q2", etc, pills to be clickable. when i click them, pop up
> a floating block that shows me the detail of the qeustion for that highlighted item. the floating pop up should have an
> "X" in the top right to close it. or clicking somewhere outside of the pop up closes it. below the question text, show
> me a button to accept suggestions and a small input box to discuss the suggestions, with a button to send the message
> to the AI. when sending a messsage like this, it must immediately be populated in the AI panel as if it were something
> i typed, including the reference to which question it was. after sending, close the pop up that was showing the
> question. also, make the pop up look like a "speech bubble" that it pointing at the "Q#" pill

## Stated Exclusions

None stated.

## Operator-Stated Scope

The operator answered the confirmation turn with "go with your recommendations on all of these". The recommendations
were:

- **Question text source:** when the AI highlights a passage, it also supplies the question text, so the popup always
  shows exactly what the AI wrote. This brings the AI's Highlight tool (`src/server/tools.ts`), the wire type
  (`src/shared/wire.ts`), and the `collaborative-draft-editing` skill into scope. Rejected: pulling the "**Q1** — …"
  paragraph out of the AI's chat reply.
- **Accept suggestions:** sends a chat message such as "**Q1** — I accept the suggestions." to the AI, shown in the chat
  as if the writer typed it, and closes the popup. The AI makes the edit on its next turn. The button does not change
  the draft directly.
- **While the AI is replying:** Accept and Send are disabled until the turn finishes, the same as the chat's own Send.
  Text typed into the discussion box is kept.
- **Area:** the editor and its highlights (`src/ui/markdown-editor.tsx`, `src/ui/documents.tsx`), the chat panel
  (`src/ui/chat.tsx`), the page that wires them (`src/ui/app.tsx`), the Highlight tool and wire type, and the skill. No
  other server change.
- **Output folder:** `docs/changes/clickable-question-pills/`.

Answers to escalations later in the run, each quoted:

- On the popup's message text: "go with recommendations". The recommendation was plain `Q1 — …`, with no bold label,
  because the chat shows the writer's messages literally.
- On keyboard access: "go with recommendation". The recommendation was that the pills are buttons that Tab stops on and
  Enter opens.
- On text typed in a popup when the AI's turn ends: "go with recommendations for all the open questions". The
  recommendation was that the popup closes and its text moves into the chat box as `Q2 — <text>`, ready to edit or
  send.

## Direction of Travel

Unanswered. Not asked: the request adds a capability and names nothing being deprecated or replaced.

## Visual Material Received

None received

## Record Provenance

Established by `han-planning:plan-a-change` in this run, from the operator's typed request and their confirmation-turn
answer. No prior record existed and no conflict was resolved.

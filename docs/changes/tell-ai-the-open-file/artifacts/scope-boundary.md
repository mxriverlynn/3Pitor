# Scope Boundary: Tell the AI Which File Is Open

## Work Item

No work item exists. The operator's request, typed into the conversation when invoking `plan-a-change`, is the only
boundary this run has.

## Stated Scope

> when i have a file open, and i send a request to the AI, the AI should automatically be told which file i'm currently
> working in and do whatever command i said, against that current file. right now i have to explicitly tell it what
> file in each request, and that makes it difficult to work with

## Stated Exclusions

None stated.

## Operator-Stated Scope

The operator answered the confirmation turn with:

> 1: just the chat panel. 2: auto-save before sending the message to the AI. 3: that's fine

What each answer settles:

- **1: just the chat panel.** Only chat messages carry the open file. The Background jobs panel is out of scope and
  keeps requiring the file to be named in the prompt.
- **2: auto-save before sending the message to the AI.** When the open document has unsaved edits, the editor saves
  them before the chat message is sent, so the AI reads what the operator sees. The AI is told the file's name, not
  sent the editor's text.
- **3: that's fine.** The plan lives in `docs/changes/tell-ai-the-open-file/`.

## Direction of Travel

Not applicable. The request adds a capability and does not deprecate, replace, or migrate away from anything.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` in this run, 2026-09-28. No record was inherited, and no conflict was resolved.

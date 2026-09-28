# Scope Boundary: AI Edits Through the Editor

## Work Item

No work item exists. The operator's request, typed into the conversation when invoking `plan-a-change`, is the only
boundary this run has.

## Stated Scope

> i want to create an adapter layer in between the AI calls and the editor itself, specifically so that all AI file
> reads, edits, etc, happen via the prosemirror editor or my application code, directly. the AI should not be allowed to
> actually edit files on the file system. but instead, it should provide a structured output to edit the file in the
> prosemirror editor, using a yjs data structure. after receiving a reply from the AI, the adapter layer will apply any
> edits that are needed by sending them to the prosemirror editor directly. the only time a file is written to
> directly, is when the save command is called from the UI of the app.

## Stated Exclusions

None stated.

## Operator-Stated Scope

The operator answered the confirmation turn with:

> 1) edit whatever is needed, keeping the scope of this work as small and tight as possible. 2) background jobs go away
> entirely. remove that section from the UI. 3) open the other file to edit it. 4) merging AI edits with typing I do
> while it works 5) that's fine

What each answer settles:

- **1: edit whatever is needed, keeping the scope as small and tight as possible.** No file is off limits, but every
  change must be needed by the stated scope. Anything that is not goes to the cut list.
- **2: background jobs go away entirely.** The Background jobs panel is removed from the UI. The job feature on the
  server goes with it, because nothing would call it.
- **3: open the other file to edit it.** When the AI edits a file that is not open, the app opens that file in the editor
  and applies the edits there. The user saves it.
- **4: merging AI edits with typing I do while it works.** This is the recorded reason for Yjs: the user keeps typing
  while the AI works, and the AI's edits must merge with that typing instead of overwriting it or being refused.
- **5: that's fine.** The plan lives in `docs/changes/ai-edits-through-the-editor/`.

## Direction of Travel

Background jobs are removed, not replaced (answer 2). Writing files from the AI's tools is removed and replaced by edits
applied in the editor. Nothing else is being deprecated.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` in this run, 2026-09-28. No record was inherited, and no conflict was resolved.

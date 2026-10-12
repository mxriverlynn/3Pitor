# Scope Boundary: Simplified UI Redesign

## Work Item

No ticket, issue, or pull request exists. The operator's written requests in this session are the only boundary this
run has. The design they asked for was built first, as a Claude Design canvas of five screens:
https://claude.ai/artifact/6c5te377PrvthBUEEwzN4G. It rests on a UX audit by the `han-core:user-experience-designer`
agent, run in the same session.

## Stated Scope

The request that produced the design:

> use Claude Design to rebuild the UI and UX for this app. keep it as simple as possible, clean, easy to understand. use
> any of the relevant custom agents i have installed, to help with that

The request that started this plan:

> to implement this. create a new branch for this work to be planned and implemented. commit and push as you go. open a
> draft mode pr

"This" is the design on the canvas above. Its five screens:

1. Review Claude's edits: three columns (Posts | Post | Claude), no top bar, a post header with name, Unsaved/Saved,
   a Formatted/Markdown switch and Save; a short formatting toolbar; a review strip ("Claude changed 3 passages and left
   1 question", previous/next, Undo all, dismiss); changed passages tinted; Claude's question as a pill; tool activity
   folded into one line; an "Actions" menu in the message box.
2. Claude is working: one status line with the file name and a Stop button; the file tree explains why moving and
   renaming are paused.
3. Ask about a selection: an "Ask Claude" button beside a selection attaches the passage to the normal message box as
   a removable chip.
4. Notices and errors: red errors and neutral information, a connection-lost banner, a confirmation before New chat.
5. First open: an empty state with a New post button, and suggestion buttons (Proofread, Edit together, Research) in an
   empty chat.

## Stated Exclusions

None stated.

## Operator-Stated Scope

> keep it as simple as possible, clean, easy to understand

The operator also corrected the design once: the New chat confirmation was drawn under the chat text. That was fixed on
the canvas.

Confirmed in the scope turn on 2026-10-12 ("looks good"):

- The reason: make the app look and work like the redesign on the canvas. A deliberate improvement; nothing is broken.
- The area is the browser app in `src/ui/`: the three-column layout, the post header and toolbar, the review strip, one
  message box for every way of asking Claude, the notices, the New chat confirmation, and the empty states.
- The new behavior the design adds is in scope: Undo all (puts back the post as it was before Claude's last reply),
  Keep my version (dismisses the "changed on disk" notice), and ⌘K (attaches the selected passage to the message box).
- Out of scope: how Claude edits, how files are saved and watched, and the server. The plan touches the server or
  engine only where a screen cannot work without it, and says so where it does.
- Escalations are settled by the run and reported afterwards (standing preference recorded in memory).

Process instructions, not scope: make a branch, commit and push as you go, open a draft PR.

## Direction of Travel

Unanswered. The request replaces the current UI's look and flow; it names no code being deprecated.

## Visual Material Received

None received as files. The design is a URL:

| Item | What state it depicts | Kept at |
| ---- | --------------------- | ------- |
| Claude Design canvas | All five screens of the redesign | (not a file) https://claude.ai/artifact/6c5te377PrvthBUEEwzN4G |

One screenshot of the New chat confirmation bug was pasted in the conversation; ordinary context.

## Record Provenance

Established by `plan-a-change` on 2026-10-12 from the operator's requests. Not inherited. No conflicting work item was
supplied.

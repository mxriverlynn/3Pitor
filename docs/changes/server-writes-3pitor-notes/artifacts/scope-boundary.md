# Scope Boundary: Server Writes `.3pitor/` Notes

## Work item

No ticket, issue, or pull request exists. The user's request, typed into `/han-planning:plan-a-change` on 2026-10-01,
is the only boundary this run has.

## Stated scope (verbatim)

> the collaborative editing skill is writing files out to `pairing/{file name}` to track all of it's notes. this is
> wrong. it needs to write to `.3pitor/editing/{file name}`. additionally, we need to change how file writes happen in
> the `.3pitor` folders. right now, whenever a collaborative editing session is running, and the notes file needs to be
> updated, the UI is moved over to the file in question to make the changes. this is distracting for the user as they
> don't know why the file was switched over, and then they have to manually find the file they were on previously, and
> load it again. to fix this, i want to change the way files are written to `.3pitor/`. instead of going through the UI
> editor directly for files in that folder and sub-folders, i want the server to do the writing directly to those
> files. not the AI agent - it does not get write permissions. the server layer intercepts the file writes, as it does
> today, and the server code writes the files. the goal here is to prevent the UI from showing the files in the
> `.3pitor/` folder structure, when they are edited. pick the best recommendations for accomplishing this. i won't be
> at my computer to answer questions.

## Stated exclusions (verbatim)

> not the AI agent - it does not get write permissions.

No other exclusions were stated.

## How this run reads the boundary

- In scope: the collaborative-editing skill's log location; how the model's `Write` and `Edit` tools handle paths under
  `.3pitor/`; keeping those files out of the editor and the file list.
- The AI never gets a filesystem write of its own. The server's tool code performs the write, as the user specified.
- The user is unavailable and asked the run to "pick the best recommendations". Every question the run would have
  escalated, including the behavior-changing entries at Step 6, is settled by recommendation and recorded as such in
  the decision log. The confirmation turn of Step 1.5 is skipped for the same reason.
- Not in scope: other skills' outputs, the app's own `.3pitor/session.json` and `.3pitor/view.json`, migrating logs
  already written under `pairing/`, and any UI to browse `.3pitor/` files.

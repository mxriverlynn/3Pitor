# Scope Boundary: Folder Tree Navigation

## Work Item

No ticket, issue, or pull request exists. The owner's request, typed as the argument to `plan-a-change` on 2026-09-29,
plus two follow-up messages in the same session, is the only boundary this run has.

## Stated Scope

> i want the ability to add folders to the left hand nav, and traverse the nested tree structure of folders and files to
> find the file i want. also, the ability to add files directly to a folder. and the ability to move files and folders
> around and have those changes reflected in the file system directly. the single "+" button next to "Documents" needs
> to open a menu to create a new folder vs file, then a pop up asks for the name and creates it appropriately. each
> folder and file in the list should highlight a little as i move my mouse over them. and to the left of the folder or
> file name, a "..." button should appear. clicking on that allows me to rename or delete the item in question. deleting
> anything requires confirmation dialog, and tells me what's being deleted (for a folder, show the number of files and
> sub-folders that would be removed)

## Stated Exclusions

None stated.

## Operator-Stated Scope

- Confirmation turn answer, 2026-09-29: "looks good". The owner accepted the restated scope; the area named (the
  document list in `src/ui/documents/documents/`, the documents API in `src/server/documents/documents.routes.ts`, and
  the browser's per-file open-document state) as the whole area; the chat's file tools left untouched; and the plan
  folder `docs/changes/folder-tree-navigation/`.
- Follow-up message, 2026-09-29, quoted:
  > oh, i forgot: the "..." menu for an item in the tree view: it needs the ability to add a sub-folder or file directly
  > in a folder (these options don't show up for files, just folders)
- Session instruction, 2026-09-29: "create a new branch for this plan. commit when you're done with the plan". Branch
  `plan-folder-tree-navigation`.
- Move gesture, asked in the confirmation turn and answered 2026-09-29: first "drag and drop", then replaced by "wait,
  let's make that "both" drag and drop, and menu item for keyboard accessibility".
- Answers to the behavior-change questions, 2026-09-29, recorded in full in `change-decision-log.md`:
  - Deleting unsaved edits (D-14): "unsaved edits are thrown out with deletes".
  - Locking the tree while the AI works (D-9): "go with recommended".
  - Refusing to overwrite (D-6): "recommended".
  - Showing only folders and markdown (D-15): "recommended".
  - Startup (D-10): "don't open anything when the app first loads. show a simple message, centered in the editor screen
    area, that says to select a file".
  - The chat keeping old names (D-16): "recommended".
  - Tightening the existing read and write (D-17): "recommended".
  - Locking the server to this computer (D-27): "leave it as is".
  - Hiding and refusing symlinks (D-26): "recommended".

## Direction of Travel

Not asked as a separate question; nothing in the request says any module is deprecated or replaced. The flat document
list is being replaced by a tree; the documents API is being extended.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` in this run. No earlier record existed in `docs/changes/folder-tree-navigation/`.

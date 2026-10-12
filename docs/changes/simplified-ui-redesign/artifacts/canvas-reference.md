# Canvas Reference: Simplified UI Redesign

A written copy of the Claude Design canvas (https://claude.ai/artifact/6c5te377PrvthBUEEwzN4G), so the builder does
not need to open it. It records each screen's layout, copy and colors as drawn. Where the plan or its decision log
says otherwise, they win. The sample post ("Why we stopped estimating in story points") is illustration only.

## Palette and type (light)

| Role | Value |
| ---- | ----- |
| Page ground (Posts column) | `#F5F6F8` |
| Panel surface (post, Claude) | `#FFFFFF` |
| Lines | `#E3E5E9`; inputs `#D5D9E0` |
| Text | `#16181D`; post text `#1E2026` |
| Muted text | `#5B606B`; secondary text `#3A3E47` |
| Accent (primary button, focus) | `#2D4FC4`; hover `#1F3A99`; soft `#EBF0FD` |
| Selected row | `#E3E8F7` |
| Unsaved dot / text | `#C77700` / `#8A5300` |
| Saved check | `#2F7D4A` |
| Changed passage | fill `#E6EEFF`, 2px underline `#7B95E8`; current passage 2px outline `#2D4FC4` |
| Question passage and pill | fill `#FFF2BF`, underline `#C99A00`; pill `#FFE58A` on `#5C4400` text |
| Error notice | fill `#FEF3F2`, border `#F5C2BD`, text `#7A1A12`, icon `#B42318` |
| Info notice | fill `#F5F6F8`, border `#E3E5E9` |
| Connection banner | `#16181D` with white text |

Type on the canvas: IBM Plex Sans (UI), Literata (post, 18px/1.7; title 34px; section headings 22px), IBM Plex Mono
(code). The plan replaces these with local stacks (D-17). Buttons are 36px tall (30px inside the view switch), radius
8px; tree rows 34px, radius 7px; panels split by 1px lines. Icons are inline stroke SVG.

## Layout (all screens)

Three columns: Posts (240px), the post (fills), Claude (360–440px). No top bar.

- **Posts column:** "3pitor" (bold) with a "+" icon button (name "New post or folder"); a small uppercase "POSTS" label;
  folders with chevrons; files indented. The open file's row is highlighted. An unsaved file shows an amber dot (name
  "Unsaved").
- **Post column:** header, toolbar, optional strip or notices, then the post centered at max 700px.
  - Header: "2026 /" (muted) then the file name; "● Unsaved" (amber) or "✓ Saved" (muted); a segmented control
    "Formatted | Markdown" (group "View"); a primary "Save ⌘S" button.
  - Toolbar: "Paragraph ▾" (the plan labels it "Text", D-1), a divider, Bold, Italic, Code, Link, a divider, Bulleted
    list, Quote, Insert image.
- **Claude column:** header "Claude" with a ghost "+ New chat" button; messages (the writer's on the right in a grey
  bubble; Claude's as plain text); the message box at the bottom: a textarea (label "Message Claude", placeholder "Ask
  Claude about this post…"), an "Actions ▾" ghost button on the left and a primary "Send" on the right.

## Screen 1: Review Claude's edits

- Strip under the toolbar, soft blue: "**Claude changed 3 passages** and left 1 question", previous arrow, "3 of 4",
  next arrow, an "Undo all" button, and a dismiss ✕ ("Dismiss review").
- Changed passages tinted; the current one outlined. A question passage tinted yellow with the pill "Sounds
  defensive?" after it.
- Claude's reply ends with a soft-blue button "✎ 3 changes in story-points.md · Review" and a collapsed line "› Read 2
  files, made 3 edits".

## Screen 2: Claude is working

- Posts column: "+" disabled; a grey note with a lock icon: "Moving and renaming files is paused while Claude edits."
  (the plan's copy: "Moving and renaming are paused while Claude works.", D-12).
- The passage being edited has a faint blue tint and a caret.
- Claude column: "New chat" disabled; Claude's streaming text; a status line above the message box: spinner, "Claude
  is editing story-points.md", elapsed "0:14"; the textarea placeholder "Claude is working. You can keep writing in the
  post."; "Send" replaced by "■ Stop".

## Screen 3: Ask about a selection

- Header shows "✓ Saved"; Save is a secondary button.
- Selected text tinted `#C9D6FA`; under it a floating button "💬 Ask Claude ⌘K" (speech-bubble icon, not emoji).
- Message box outlined in accent with a soft ring. Above the textarea, a chip: list icon, the passage's first words in
  italic serif ("“Points were meant to measure effort…”"), and a ✕ ("Remove selected passage"). The writer's text
  "Can this be one sentence?" is in the textarea.

## Screen 4: Notices and errors

- A full-width dark banner above everything: wifi-off icon, "Lost touch with 3pitor. Is it still running in your
  terminal? Trying again…".
- The open file's tree row shows an always-visible "…" button ("More for story-points.md").
- Under the header, stacked notices:
  - Error: circle-! icon, "**Couldn't save story-points.md.** The folder is read-only. Your changes are still here.",
    a "Try again" button.
  - Info: circle-i icon, "This file changed on disk since you opened it.", "Use the disk version" and a ✕ ("Keep my
    version").
- New chat confirmation: a dialog under the "New chat" button, drawn above the chat (which is dimmed): "Start a new
  chat?", "This clears the conversation and Claude's highlights. Your post and its edits stay as they are.", ghost
  "Cancel" and primary "New chat".

## Screen 5: First open

- Posts column with folders closed.
- Post column centered: a document icon, "Pick a post to start" (serif, 24px), "Choose a post from the list, or start a
  new one. Claude can help once a post is open.", primary "+ New post".
- Claude column: "Claude edits right in your post. Its changes show up as unsaved, so nothing is written until you
  save.", a small "TRY" label, and three stacked buttons, each with a title and a hint:
  - "Proofread" — "Fix spelling, grammar and typos"
  - "Edit together" — "Go through the post section by section"
  - "Research" — "Check claims and find sources"
- No "New chat" button in an empty chat.

## Canvas elements the plan does not build

- The "N changes in {file} · Review" button inside Claude's reply (the strip already offers review).
- The elapsed timer in the status line.
- "Try again" on the save error (the error stays as today; the writer presses Save again).
- The always-visible "…" on the open file's row (out of the redesign's scope; the tree's menus are unchanged).
- The working placeholder "Claude is working. You can keep writing in the post."

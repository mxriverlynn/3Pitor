# Changelog

All notable changes to 3pitor are listed here, newest release first.

## v0.4.0 - 2026-10-19

3pitor now opens to a searchable table of your posts instead of a file tree. Each post can hold an outline and research documents that Claude helps you write. A new Outline box lists the open post's headings and jumps to each one. The header and toolbar now run across the window, above boxed post and chat panels. Posts are now folders holding a draft, so loose markdown files no longer appear.

### New Features

#### Post table landing page

- Post table - The landing page lists every post by title, with a sortable title column and Edit, Rename, and Delete in each row's menu. [#41](https://github.com/mxriverlynn/3Pitor/pull/41) by [@mxriverlynn](https://github.com/mxriverlynn)
- Post search - The search box finds posts whose title or saved text holds what you type. [#41](https://github.com/mxriverlynn/3Pitor/pull/41) by [@mxriverlynn](https://github.com/mxriverlynn)
- Home button - Goes back to the post table and puts focus in its search box. [#41](https://github.com/mxriverlynn/3Pitor/pull/41) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Outlines and research for each post

- Files panel - Shows the open post's draft, outline, and research documents, and opens each one in the editor. [#42](https://github.com/mxriverlynn/3Pitor/pull/42) by [@mxriverlynn](https://github.com/mxriverlynn)
- Claude and outlines - Claude can read and change a post's outline and research documents, shown as unsaved edits you can undo. [#42](https://github.com/mxriverlynn/3Pitor/pull/42) by [@mxriverlynn](https://github.com/mxriverlynn)
- `/research` - Saves its findings as a research document on the open post, not in the post's text. [#42](https://github.com/mxriverlynn/3Pitor/pull/42) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Jump to any heading from the Outline box

- Outline box - Lists the open document's headings below the Files panel. [#46](https://github.com/mxriverlynn/3Pitor/pull/46) by [@mxriverlynn](https://github.com/mxriverlynn)
- Going to a heading - Choosing a heading moves the caret to it and scrolls it into view, in formatted and raw modes. [#46](https://github.com/mxriverlynn/3Pitor/pull/46) by [@mxriverlynn](https://github.com/mxriverlynn)

### Enhancements

- New post - Asks for a working title, then makes the post's folder and draft, and opens the draft. [#37](https://github.com/mxriverlynn/3Pitor/pull/37) by [@mxriverlynn](https://github.com/mxriverlynn)
- Post management design - The plan for storing posts as records with stable ids is now written down. [#38](https://github.com/mxriverlynn/3Pitor/pull/38) by [@mxriverlynn](https://github.com/mxriverlynn)
- Posts kept in sync - The page and Claude now follow posts by id, and the page updates when posts change on disk. [#39](https://github.com/mxriverlynn/3Pitor/pull/39) by [@mxriverlynn](https://github.com/mxriverlynn)
- Code structure - The source now follows the updated package, feature, and component layout. [#43](https://github.com/mxriverlynn/3Pitor/pull/43) by [@mxriverlynn](https://github.com/mxriverlynn)
- Landing page panels - The post panel and chat stay hidden on the post table unless unsaved changes need them. [#44](https://github.com/mxriverlynn/3Pitor/pull/44) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Full-width layout

- Post header and toolbar - Both now run across the whole window, above the post panel and the chat. [#45](https://github.com/mxriverlynn/3Pitor/pull/45) by [@mxriverlynn](https://github.com/mxriverlynn)
- Boxed panels - The post panel and the chat sit in boxes, with the gaps between them as drag bars. [#45](https://github.com/mxriverlynn/3Pitor/pull/45) by [@mxriverlynn](https://github.com/mxriverlynn)
- Editor width - The text column is now 1024 pixels wide, and the Files panel fits its list. [#45](https://github.com/mxriverlynn/3Pitor/pull/45), [#46](https://github.com/mxriverlynn/3Pitor/pull/46) by [@mxriverlynn](https://github.com/mxriverlynn)

### Bug Fixes

- None in this release.

### Breaking Changes

- Posts - A post is now a folder holding `draft.md`, so loose markdown files and New file are gone. [#37](https://github.com/mxriverlynn/3Pitor/pull/37), [#39](https://github.com/mxriverlynn/3Pitor/pull/39) by [@mxriverlynn](https://github.com/mxriverlynn)

## v0.3.0 - 2026-10-13

Each new chat can now run Claude, OpenAI, Gemini, or Ollama models you choose. The editor now opens, edits, and saves posts that contain markdown tables. A simpler layout shows Claude's changes in a review strip with an Undo all button. Images now get a popup beside the caret, with a live preview of the picture. The old Claude flag and MODEL setting are gone; choose models in the picker instead.

### New Features

- Markdown tables - Posts with pipe tables now open, edit, and save, keeping alignment and cell formatting. [#32](https://github.com/mxriverlynn/3Pitor/pull/32) by [@mxriverlynn](https://github.com/mxriverlynn)
- Image popup - Insert ▸ Image opens a labelled popup by the caret that previews the image and edits a selected one. [#33](https://github.com/mxriverlynn/3Pitor/pull/33) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Choose the provider and model for each chat

- New chat picker - Choose Claude (Local), Claude (API), OpenAI, Google Gemini, or Ollama, then a model and thinking level. [#35](https://github.com/mxriverlynn/3Pitor/pull/35) by [@mxriverlynn](https://github.com/mxriverlynn)
- Saved model choice - The picker's choice is saved in `.3pitor/config.json` and used the next time 3pitor starts. [#35](https://github.com/mxriverlynn/3Pitor/pull/35) by [@mxriverlynn](https://github.com/mxriverlynn)
- Chat panel header - The header names the current provider, model, and thinking level, and startup prints them too. [#35](https://github.com/mxriverlynn/3Pitor/pull/35) by [@mxriverlynn](https://github.com/mxriverlynn)
- Unavailable providers - A provider missing its key, program, or Ollama server is marked unavailable, with the reason shown. [#35](https://github.com/mxriverlynn/3Pitor/pull/35) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Review and undo Claude's changes

- Review strip - A strip above the post summarizes what Claude changed and asked, and steps through each passage. [#31](https://github.com/mxriverlynn/3Pitor/pull/31) by [@mxriverlynn](https://github.com/mxriverlynn)
- Undo all - It puts back every post Claude's last reply touched, after asking first. [#31](https://github.com/mxriverlynn/3Pitor/pull/31) by [@mxriverlynn](https://github.com/mxriverlynn)
- Keep my version - Keeps your edits over a changed copy on disk until the disk changes again. [#31](https://github.com/mxriverlynn/3Pitor/pull/31) by [@mxriverlynn](https://github.com/mxriverlynn)

### Enhancements

- Dependencies and engine - The engine no longer depends on Bun, and runs on Node as well. [#30](https://github.com/mxriverlynn/3Pitor/pull/30) by [@mxriverlynn](https://github.com/mxriverlynn)
- Code structure - The source is now organized by package, feature, and component. [#27](https://github.com/mxriverlynn/3Pitor/pull/27) by [@mxriverlynn](https://github.com/mxriverlynn)
- Program packages - The app is split into separate cli, server, and engine packages. [#28](https://github.com/mxriverlynn/3Pitor/pull/28) by [@mxriverlynn](https://github.com/mxriverlynn)
- Saving a post - Saves now keep the file's identity and extended attributes, and work in folders that allow no new files. [#29](https://github.com/mxriverlynn/3Pitor/pull/29) by [@mxriverlynn](https://github.com/mxriverlynn)
- Editor dropdown menus - The Insert and Text menus have larger rows with icons, clear hover and focus, and a checkmark on the current block type. [#34](https://github.com/mxriverlynn/3Pitor/pull/34) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Simpler layout

- Connection banner - The top bar is gone; a banner appears only when the connection to 3pitor is lost. [#31](https://github.com/mxriverlynn/3Pitor/pull/31) by [@mxriverlynn](https://github.com/mxriverlynn)
- Post header - One header shows the file name, save state, the Formatted and Markdown switch, and Save. [#31](https://github.com/mxriverlynn/3Pitor/pull/31) by [@mxriverlynn](https://github.com/mxriverlynn)
- New chat - It asks before ending a conversation that holds something. [#31](https://github.com/mxriverlynn/3Pitor/pull/31) by [@mxriverlynn](https://github.com/mxriverlynn)
- Asking about a selection - The ask button or ⌘K attaches the selection to the chat box as a chip, replacing the ask popups. [#31](https://github.com/mxriverlynn/3Pitor/pull/31) by [@mxriverlynn](https://github.com/mxriverlynn)
- Actions menu - Proofread, Edit together, and Research move into the chat, and an empty chat offers them as buttons. [#31](https://github.com/mxriverlynn/3Pitor/pull/31) by [@mxriverlynn](https://github.com/mxriverlynn)
- Claude's progress - One status line names the file Claude is working on, and each reply's tool calls fold into one line. [#31](https://github.com/mxriverlynn/3Pitor/pull/31) by [@mxriverlynn](https://github.com/mxriverlynn)
- Colors and notices - The app uses a new palette with dark mode, and error notices now look different from information. [#31](https://github.com/mxriverlynn/3Pitor/pull/31) by [@mxriverlynn](https://github.com/mxriverlynn)

### Bug Fixes

- Slash commands on Claude (Local) - A chat's first message starting with `/` no longer gets reported as a skill that is not installed. [#36](https://github.com/mxriverlynn/3Pitor/pull/36) by [@mxriverlynn](https://github.com/mxriverlynn)

### Breaking Changes

- `--claude` and `MODEL` - Both are removed; choose the provider and model in the New chat picker, and startup warns when `MODEL` is still set. [#35](https://github.com/mxriverlynn/3Pitor/pull/35) by [@mxriverlynn](https://github.com/mxriverlynn)
- Default chat model - With nothing saved, chat runs Claude Haiku 5.5 on medium thinking, through the API when `ANTHROPIC_API_KEY` is set. [#35](https://github.com/mxriverlynn/3Pitor/pull/35) by [@mxriverlynn](https://github.com/mxriverlynn)

## v0.2.0 - 2026-10-01

3pitor now follows changes made to workspace files on disk while it runs. Open files update in place, and files deleted on disk close on their own. A notice warns you when an unsaved file changed or vanished on disk. A new Find in docs button shows the open file in the Documents tree. Each row's actions button now stays in view when long names scroll sideways.

### New Features

- Find in docs button - A magnifying glass before the file name in the editor bar opens every folder around the open file and scrolls its row into view.

#### Live updates from disk

- Documents list - Files and folders added, renamed, or removed on disk show up in the list without a reload. [#26](https://github.com/mxriverlynn/3Pitor/pull/26) by [@mxriverlynn](https://github.com/mxriverlynn)
- Open files - A file with no unsaved changes loads the disk text in place, and closes once it is deleted on disk. [#26](https://github.com/mxriverlynn/3Pitor/pull/26) by [@mxriverlynn](https://github.com/mxriverlynn)
- Disk notice - An unsaved file shows a notice when its disk copy changed or is gone, with a Use the disk version button. [#26](https://github.com/mxriverlynn/3Pitor/pull/26) by [@mxriverlynn](https://github.com/mxriverlynn)
- Reconnects - Changes made on disk while the connection was down arrive once it reconnects, and restored drafts are checked against the disk. [#26](https://github.com/mxriverlynn/3Pitor/pull/26) by [@mxriverlynn](https://github.com/mxriverlynn)

### Enhancements

#### Row actions button stays in view

- Row … button - Stays pinned to the Documents panel's visible right edge when long names scroll sideways, as a solid bordered chip in the row's highlight color. [#25](https://github.com/mxriverlynn/3Pitor/pull/25) by [@mxriverlynn](https://github.com/mxriverlynn)
- Row … menu - Opens beside its … button and draws above the rows below it, so their buttons cannot cover it. [#25](https://github.com/mxriverlynn/3Pitor/pull/25) by [@mxriverlynn](https://github.com/mxriverlynn)

### Bug Fixes

- Raw mode selection - Selected text in raw mode is highlighted again.
- Documents list - A folder deleted or replaced while the list loads is skipped instead of failing the whole list. [#26](https://github.com/mxriverlynn/3Pitor/pull/26) by [@mxriverlynn](https://github.com/mxriverlynn)
- Saving a file - Saves of the same file run one at a time, and a failed save no longer blocks the next one. [#26](https://github.com/mxriverlynn/3Pitor/pull/26) by [@mxriverlynn](https://github.com/mxriverlynn)

### Breaking Changes

- None in this release.

## v0.1.0 - 2026-10-01

This first release of 3pitor brings a markdown blog editor with Claude built in. Claude's edits land in the editor as unsaved changes, and only your Save writes files. Highlights point you at passages, and you can step through, ask about, and clear them. Chat reaches Claude through the Anthropic API or your installed claude program. Signed macOS builds for Apple silicon and Intel ship with every tagged release.

### New Features

#### Claude in the editor

- Chat panel - Each message saves the open file first and tells Claude which file is open. [#1](https://github.com/mxriverlynn/3Pitor/pull/1) by [@mxriverlynn](https://github.com/mxriverlynn)
- Claude's edits - Merge into the editor as unsaved changes, alongside your typing, and never reach disk on their own. [#2](https://github.com/mxriverlynn/3Pitor/pull/2) by [@mxriverlynn](https://github.com/mxriverlynn)
- Content editor role - Claude works as a blog content editor and answers questions about a post without editing it. [#9](https://github.com/mxriverlynn/3Pitor/pull/9) by [@mxriverlynn](https://github.com/mxriverlynn)
- Reloading the page - The chat, its running turn, and the editor's open files and view come back after a reload or restart. [#11](https://github.com/mxriverlynn/3Pitor/pull/11) by [@mxriverlynn](https://github.com/mxriverlynn)
- `--claude` flag - Runs chat through your installed `claude` program and Claude subscription instead of the Anthropic API. [#13](https://github.com/mxriverlynn/3Pitor/pull/13) by [@mxriverlynn](https://github.com/mxriverlynn)
- Notes under `.3pitor/` - Markdown notes Claude writes there save straight to disk, so the editor stays on your post. [#18](https://github.com/mxriverlynn/3Pitor/pull/18) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Highlights and questions

- Built-in skills - 3pitor ships a collaborative editing skill, and Claude highlights the passages it discusses. [#3](https://github.com/mxriverlynn/3Pitor/pull/3) by [@mxriverlynn](https://github.com/mxriverlynn)
- Question pills - Clicking a highlight's question opens a speech bubble, and your reply goes through the chat. [#4](https://github.com/mxriverlynn/3Pitor/pull/4) by [@mxriverlynn](https://github.com/mxriverlynn)
- Highlight bar - Claude's edits and highlights appear as they happen, and `<`, `>`, and Clear step through or remove them. [#14](https://github.com/mxriverlynn/3Pitor/pull/14) by [@mxriverlynn](https://github.com/mxriverlynn)
- Current highlight - Clicking or arrowing into a highlight makes it the current one, and the toolbar shrinks after Clear. [#15](https://github.com/mxriverlynn/3Pitor/pull/15) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Agent Actions

- Agent Actions menu - A menu above the chat box and in the selection popup runs Proofread and Research. [#10](https://github.com/mxriverlynn/3Pitor/pull/10) by [@mxriverlynn](https://github.com/mxriverlynn)
- Research - Claude searches and reads the web on any topic and writes its report into the open file. [#10](https://github.com/mxriverlynn/3Pitor/pull/10) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Editing posts

- Task lists - Show as checkboxes, and each box's checked state saves to the file. [#6](https://github.com/mxriverlynn/3Pitor/pull/6) by [@mxriverlynn](https://github.com/mxriverlynn)
- Raw markdown switch - Moves the editor between rendered and raw markdown, with formatting and highlights working in both. [#7](https://github.com/mxriverlynn/3Pitor/pull/7) by [@mxriverlynn](https://github.com/mxriverlynn)
- Link popup - Opens beside the selected text, and pasting a web address over text links it. [#20](https://github.com/mxriverlynn/3Pitor/pull/20) by [@mxriverlynn](https://github.com/mxriverlynn)
- Markdown colors - Raw mode colors markdown syntax, and the formatted view makes headings, links, code, quotes, and lists easier to see. [#21](https://github.com/mxriverlynn/3Pitor/pull/21) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Documents tree

- Folder tree - Lists posts in folders, where you can create, rename, move, and delete files and folders. [#8](https://github.com/mxriverlynn/3Pitor/pull/8) by [@mxriverlynn](https://github.com/mxriverlynn)
- Panel sizes - The Documents tree and Agent panel resize by dragging or from the keyboard, and the tree scrolls sideways. [#17](https://github.com/mxriverlynn/3Pitor/pull/17) by [@mxriverlynn](https://github.com/mxriverlynn)

#### Version flags and signed macOS archives

- `3pitor --version` and `--help` - Print the version or the usage line and exit, without starting the editor. [#23](https://github.com/mxriverlynn/3Pitor/pull/23) by [@mxriverlynn](https://github.com/mxriverlynn)
- Release archives - Each version tag builds signed macOS archives for Apple silicon and Intel. [#23](https://github.com/mxriverlynn/3Pitor/pull/23) by [@mxriverlynn](https://github.com/mxriverlynn)

### Enhancements

- Prompt caching - Both chat modes cache the prompt, so follow-up turns resend less to Claude and cost less. [#22](https://github.com/mxriverlynn/3Pitor/pull/22) by [@mxriverlynn](https://github.com/mxriverlynn)
- New file and folder names - Unsafe characters and spaces or dots at the ends are removed, and a file gets one `.md`. [#24](https://github.com/mxriverlynn/3Pitor/pull/24) by [@mxriverlynn](https://github.com/mxriverlynn)
- Missing API key warning - Now names the installed `3pitor` command to run. [#23](https://github.com/mxriverlynn/3Pitor/pull/23) by [@mxriverlynn](https://github.com/mxriverlynn)
- Code layout - The source is organized by package, feature, and component, so contributors find code faster. [#5](https://github.com/mxriverlynn/3Pitor/pull/5), [#16](https://github.com/mxriverlynn/3Pitor/pull/16) by [@mxriverlynn](https://github.com/mxriverlynn)

### Bug Fixes

- Highlights - Stay in place when a chat turn makes no new Highlight call. [#12](https://github.com/mxriverlynn/3Pitor/pull/12) by [@mxriverlynn](https://github.com/mxriverlynn)
- Current highlight outline - Draws one shape around the passage, even when links or formatting split it. [#19](https://github.com/mxriverlynn/3Pitor/pull/19) by [@mxriverlynn](https://github.com/mxriverlynn)

### Breaking Changes

- None in this release.

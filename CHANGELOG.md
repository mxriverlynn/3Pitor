# Changelog

All notable changes to 3pitor are listed here, newest release first.

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

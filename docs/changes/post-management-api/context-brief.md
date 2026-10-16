# Context Brief: Post Management API

**Goal (verbatim):** "as an abstraction for "post management". this abstraction will sit in between the engine and the
implementation of actually creating, editing, managing, listing, and otherwise handling posts as a first class concept in
the system. the first implementation of this abstraction will be the direct file system reads and writes that we
currently use. however, this abstraction will soon be replaced with a database backed implementation. don't worry about
how this will break current features. we'll work on integrating this new api, and handling breaking changes to do so,
later. for now, i want the abstraction that will handle these requirements to be documented so we can move forward
toward my end goal."

**Starting point:** working tree on branch `post-management-api`, identical to `main` at 53e2c41.

**Conventions:** there is no `CLAUDE.md` and no `project-discovery.md`. `README.md` is the conventions source: the package
layout, one-way imports, and a Bun-free engine.

**Agents:** codebase-explorer (CE), structural-analyst (SA), behavioral-analyst (BA), data-engineer (DE),
concurrency-analyst (CA). All five returned usable findings.

Each finding below names its provenance and the agent that reported it. A finding marked `inferred` is the agent's
reasoning, not something the code states.

## What a post is today

- **F1. No post entity exists. A post is a path string plus conventions.**
  - Nothing in `src/` defines a `Post` type, a post id, a status, tags, a slug field, timestamps, or post frontmatter.
  - Provenance: `src/shared/wire.ts:50-64`, `src/engine/documents/documents.ts:1-3`, plus grep negatives. (CE D14, DE F1, BA B1)
- **F2. Identity is the draft file's workspace-relative path, so a rename changes identity.**
  - `createPost` resolves to the draft's path (`documents.ts:98-115`), and the wire shape is `CreatedPost { path }` (`wire.ts:61-64`).
  - Every read and write is addressed by path through `/api/documents/:name` (`documents.routes.ts:26-35`).
  - `moveEntry` is the only rename (`documents.ts:128-132`).
  - (DE F1, BA B1, CA C6)
- **F3. The code has three definitions of a post, and they disagree.**
  - `createPost` makes a folder holding `draft.md` (`documents.ts:100-116`).
  - The chat tools treat any `.md` key with no dot segment as a post (`tools.ts:192-201`, `resolvePost`).
  - The collaborative-editing skill takes the slug from the folder name when the file is `draft.md`, and from the file
    name otherwise (`src/skills/collaborative-editing/SKILL.md:37`).
  - The listing has only `file` and `folder` kinds (`wire.ts:50-53`).
  - Loose `.md` files still show and open (`docs/changes/new-post-instead-of-new-file/change-plan.md`, "Why").
  - The `check.ts` scenario creates a loose root `summary.md` as a post (`src/server/scripts/check.ts:207-212`).
  - (DE F2, CE D10/D12/D13)
- **F4. The title is stored twice at creation, lossily, and never kept in sync.**
  - The folder name is `newEntryName(title)` (`documents.ts:101`; `entry-name.ts:3-8` strips characters Windows refuses
    and trims dots and spaces).
  - The H1 is the title as typed (`documents.ts:120-124`).
  - Nothing reads either one back as a title. The sample data already drifts: the same post appears as both
    `the sun/draft.md` and `the-sun/draft.md` (`src/.data/workspace/.3pitor/session.json`, `view.json`; inferred from
    the data).
  - (DE F3, CE D10)
- **F5. The files in a post's folder are siblings by convention only, with no declared roles.**
  - `the sun/` holds `draft.md`, `outline.md`, and `research.md`.
  - Only `documents.ts:104` and the skill slug rule know about `draft.md`.
  - The research skill writes its report into whatever file is open (`src/skills/research/SKILL.md:228`).
  - (DE F4, CE D10)
- **F6. Posts sit inside arbitrarily nested folders.**
  - `createPost(parent, title)` accepts any folder path (`documents.ts:100-103`).
  - Moving or deleting a folder cascades to everything under it (`documents.ts:126-158`).
  - The UI re-files open documents by path prefix (`src/ui/documents/components/paths.ts:4-14`).
  - The collaborative-editing skill finds series notes by walking up the folders to the nearest `README.md`
    (`SKILL.md:41-45`).
  - (DE F6, CE D9/D10)
- **F7. Folders are first-class peers of posts in the documents API.**
  - The API has `createFolder`, a move that handles either kind, a recursive `count`, and a recursive `delete`
    (`documents.ts:89-96`, `:128-158`).
  - The previous change kept rename, Move to, and Delete as file-and-folder operations (new-post change-plan D-15).
  - (BA B1, CE D2/D13)

## Today's operations and their behavior

- **F8. `Engine['documents']` is already a seam close to the new abstraction.**
  - Its methods are `list`, `read`, `write`, `createFolder`, `createPost`, `move`, `count`, and `delete`
    (`src/engine/engine.ts:39-52`). They are wired to `documents.ts` at `engine.ts:107-116`.
  - The server reaches posts only through this seam (`documents.routes.ts:12`).
  - (SA S1, CE D3)
- **F9. `createPost` takes two steps with a compensating delete, so it is not atomic.**
  - The steps are `createFolder`, then `write(draft)`; if the write fails, it deletes the folder and swallows any error
    from that delete (`documents.ts:100-116`).
  - Between the two steps, anyone can see an empty folder. If the rollback delete fails, the empty folder is left behind
    and nobody is told.
  - The rollback could also delete files another actor wrote into the folder during that window (inferred).
  - Uniqueness comes only from `createFolder` refusing a taken key.
  - (BA B2, CA C3, DE F12)
- **F10. `write` is an unconditional upsert that also creates missing folders.**
  - It never checks preconditions and takes no version (`documents.ts:82-86`; `local-file-system.ts:173`, `mkdir` recursive).
  - An AI-created post first reaches disk through the user's Save, by way of this implicit folder creation
    (`documents.ts:82` comment; `documents.tsx:171-172`).
  - The tools have no way to create a post that fails if the name already exists.
  - (BA B6, DE F12, CA C7)
- **F11. Concurrent saves are resolved last-writer-wins, and only the browser detects conflicts.**
  - The PUT carries `{content}` only (`documents.routes.ts:8,31-35`). There is no ETag or version
    (grep of `src/server` for these returned nothing).
  - The browser compares text it re-reads after a change hint against `entry.saved` (`documents.tsx:273-304`).
  - "Keep my version" still overwrites unconditionally (`documents.tsx:231-237`).
  - (CA C4, BA B6, DE F5)
- **F12. Write ordering is per key and per process, from a module-level promise queue.**
  - The queue is at `local-file-system.ts:102-120`.
  - Reads bypass the queue, and a default write copies in place, so a reader may see a partial file
    (`file-system.ts:46-47`).
  - `move` and `delete` wait only for the writes queued when they are called. A write queued afterwards can bring a
    deleted folder back (`local-file-system.ts:63-91,122-127,173`; inferred ordering).
  - (CA C1/C2)
- **F13. Listing is a sequential, recursive, unpaginated walk that carries no metadata.**
  - It makes one `list` call per folder, skips hidden names, drops non-`.md` files and symlinks, and sorts by path with
    `<` (`documents.ts:51-75`).
  - It silently drops a subfolder that fails with any `FileSystemError`, and turns a root failure into a 500.
  - It is not a consistent snapshot.
  - (BA B5, DE F11, CA C6)
- **F14. `count` exists only to inform the delete confirmation.**
  - It counts every non-folder as a file, including hidden files, non-`.md` files, and symlinks (`documents.ts:134-151`).
  - It is served as a POST (`documents.routes.ts:54-57`).
  - (BA B12, DE F15)
- **F15. Delete is a hard, recursive delete with no trash.**
  - (`documents.ts:155-158`; DE F15, BA B7)
- **F16. Move enforces three rules.**
  - The target must not exist, an item cannot move into itself, and the target's parent must exist (`file-system.ts:60-62`).
  - A rename that only changes letter case is allowed as "the same stored item", which is a case-insensitive-disk rule.
  - (BA B7, DE F7)

## Errors

- **F17. `DocumentError` has two reasons, `invalid` and `not-found`, and folds `exists` into `invalid`.**
  - The translation is at `documents.ts:12-19,40-49`. The server maps the two reasons to 400 and 404
    (`documents.routes.ts:18-22`).
  - Errors that are not `FileSystemError` are rethrown raw and become a plain-text 500.
  - The message text passes through and contains storage keys.
  - (BA B3, SA S5, DE F13)
- **F18. The chat tools see `FileSystemError` for posts while the browser sees `DocumentError`.**
  - The tools check `error.reason === 'not-found'` at `tools.ts:9,90,118`.
  - Edit of a missing post throws a raw `FileSystemError` (`tools.ts:84`).
  - (SA S5, BA B9)

## Change notification

- **F19. The engine throws away the watcher's typed events and emits a single empty hint.**
  - The call is `fileSystem.watch(() => events.emit({ type: 'documents-changed' }), { ignore: isHiddenKey })`
    (`engine.ts:89`; `wire.ts:7`).
  - The `renamed {from,to}` detail is discarded with everything else (`file-system.ts:19-24`).
  - (CA C5, BA B10, DE F9)
- **F20. The watcher batches by time and is lossy.**
  - It waits for 100 ms of quiet, up to 1 s, and collapses everything in that window. A create followed by a delete in
    one window vanishes (`watch.ts:111-115,149-191`).
  - Events carry no sequence number or cursor.
  - Over 10,000 entries it falls back to a coarse "changed" event.
  - If it fails, it logs and stops for good, and the UI is never told (`watch.ts:42-46`).
  - The `watch()` return value is dropped (`engine.ts:89`).
  - (CA C5, BA B10)
- **F21. The UI responds to any change by re-listing everything and re-reading every open file.**
  - It suppresses echoes of its own saves by comparing text and checking a saves counter (`documents.tsx:106-139,273-330`).
  - (CA C6, BA B10)

## AI and editor state

- **F22. AI edits never reach storage.**
  - Write and Edit change only `turn.texts`, a per-turn map built from the browser's open buffers
    (`tools.ts:18-37`; `sessions.ts:138,164`).
  - The browser merges the results in as unsaved edits (`documents.tsx:362-395`).
  - A post reaches storage only through the user's Save.
  - (BA B9, CE D6/D7, CA C7)
- **F23. The chat tools bypass `documents.ts` and use `FileSystem` directly for post text.**
  - The direct calls are at `tools.ts:84,88,117,155`.
  - Glob returns any file the pattern matches.
  - Read falls back to any workspace key, including skill files.
  - (SA S1, DE F10, CE D6)
- **F24. Skills tell the model to Glob `**/*.md` to find drafts.**
  - (`collaborative-editing/SKILL.md:35`; DE F10)
- **F25. Unsaved editor text lives in the browser, with a durable copy in `.3pitor/view.json` keyed by post path.**
  - `wire.ts:132-163`; `view-state.ts:8-15`. (BA B11, CE D8)

## Where post identity is copied

- **F26. The post path is copied into at least seven other stores.**
  - In `view.json`: `current`, `unsaved[].name`, `highlights.file`, `notApplied[].name`, `turn.file`, and the keys of
    `turn.bases`.
  - In `ChatRequest`: `openFile` and the keys of `documents`.
  - The keys of `SessionData` and `TurnProgress` `edited`, and of `TurnTexts.texts`.
  - In `session.json`: the message history, including "The file open in my editor is …" (`sessions.ts:128-136`).
  - Only the open browser tab remaps these on a move (`documents.tsx:206-220`).
  - (DE F8, SA S3, CE D7/D8)
- **F27. The same value goes by four names: `path`, `name`, `file`, and `key`.**
  - `wire.ts`; `tools.ts:73` "A post's name as the documents API knows it: its key". (SA S3)

## Path grammar

- **F28. The path grammar is defined in four places, and the definitions disagree.**
  - The file-system grammar `checkKey` is at `keys.ts:11-15`.
  - The documents grammar `checkPath` (no hidden segment, `.md`) is at `documents.ts:32-37`.
  - The tools' grammar `resolvePost` normalizes `./` and `a/../b` first (`tools.ts:194-201`).
  - `resolveAppNote` is at `tools.ts:205-211`.
  - `newEntryName` is stricter than `checkPath`, so a move can create a name that create-post would refuse
    (`entry-name.ts:1-9`).
  - (SA S4, BA B4, DE F7)
- **F29. Nothing validates post content on the storage path.**
  - `unsupportedMarkdown` is enforced only in the AI tools (`tools.ts:41-46`) and at the UI's Save (`documents.tsx:159`).
  - (BA B4)

## Boundaries and package placement

- **F30. Posts and app state share one `FileSystem` and one namespace, separated only by the hidden-dot rule.**
  - App state includes `.3pitor/view.json`, `session.json`, `config.json`, `.3pitor/*.md` notes, and
    `.claude/skills|agents`.
  - These stay on `FileSystem`; they are not posts (`json-file.ts:4-37`; `workspace-config.ts:47-106`;
    `tools.ts:109-137`).
  - (SA S2, BA B8, DE F14)
- **F31. The README's import rules govern where the abstraction can sit.**
  - The engine imports only `shared`, the `file-system.ts` contract, and npm packages. It stays Bun-free and does no file
    I/O itself.
  - A host supplies the engine's swappable backends, the way `createLocalFileSystem` is built in `cli.ts:13-15` and
    passed in.
  - (SA S6; README)
- **F32. The file-backed implementation needs `markdownSerializer` and `schema` from `src/shared/markdown`, plus `newEntryName`, to write the draft heading.**
  - (`documents.ts:7,120-124`; SA S6)
- **F33. `src/shared/wire.ts` is the most volatile surface: 22 commits in 90 days.**
  - The data engineer recommends that the post contract types not extend `DocumentEntry` (inferred). (SA S7, DE)
- **F34. A browser test fake mirrors the documents API, including the create-post layout.**
  - (`src/ui/components/fake-documents-api.ts:15-61`; SA S8, CE D12)
- **F35. The system prompt calls a post "a markdown file" relative to the workspace.**
  - It never mentions folders, `draft.md`, or titles (`system-prompt.ts:76-78`). (CE D11, SA S3)
- **F36. The `file-system-package` design is the precedent for a swappable backend.**
  - It defines one contract module, a host-built instance, and the engine receiving it through its factory
    (`docs/changes/file-system-package/api-design.md`). (CE D13)

## Open items carried to the gate (no evidence at any tier)

- **OQ1.** Where should the file-system implementation store a post's id and title: a sidecar file, frontmatter, or
  derived from the path? (DE)
- **OQ2.** Is a post one document, or a draft plus named parts? What are loose `.md` files: posts, notes, or out of
  scope? (DE; F3, F5)
- **OQ3.** Do folders survive as collections or series, or do they go away? (DE; F6, F7)
- **OQ4.** Should saving to a post that does not exist create it, or be refused? (DE; F10)
- **OQ5.** Will the database implementation have more than one writer? (DE; F11)
- **OQ6.** Must old chat history still resolve after a rename? (DE; F26)

## Coverage notes

- The size cap left out `han-core:on-call-engineer` and `han-core:adversarial-security-analyst`. Both had signals:
  failure paths, and post names arriving from the browser and the AI.
- No agent ran tests. Every race marked `inferred` is unreproduced.

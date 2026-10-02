# Decision Log: File-System Package Design

Decisions settled during the design run. Earlier planning runs gave a standing instruction to "make the best decisions
you can, without asking me". Under it, the run settled every gate itself, recorded each call here, and reported the
behavior changes in the final summary. Each decision cites the goal clause (G1–G9, from
[design-options.md](../design-options.md)), a context-brief finding (F#), or the delegation.

## Gate 1: option choice

- **D1. Option A is chosen** (a generic key store with one key space; document rules stay in the engine). It is the
  recommended option. It is the only one where a new backend implements storage alone (G3), and its one key space is
  what G5 describes. Source: delegation, recommendation reasoning in design-options.md.

## Question round: answers (junior-developer Q1–Q34)

Each item is tagged with how it was settled: **goal**, **brief**, or **decided** (open item, settled under delegation).

- **D2 (Q1, Q2; decided).** The symlink rule applies only to the key's own segments below the root. Components of the
  root path are never checked, so a workspace opened through a link, and macOS `mkdtemp` folders under
  `/var` → `/private/var`, keep working. `createLocalFileSystem(root)` requires an absolute path and does no I/O.
  `location` is the root exactly as passed, so the `listening on` line is unchanged (F7).
- **D3 (Q3; brief F20).** The per-key write queue is process-wide and keyed by the absolute disk path, as
  `json-file.ts`'s `pending` map is today. Two instances on one root share ordering.
- **D4 (Q4; decided).** `move` and `delete` wait for queued writes on the keys they touch first. For a folder that means
  any queued write under its prefix. A save followed at once by a rename or delete can therefore never resurrect the old
  name.
- **D5 (Q5, Q6; decided).** The README rule that only `engine/paths.ts` finds `src/` stays true. `engine.ts` re-exports
  the fixture path as `WORKSPACE_FIXTURE`. `chooseWorkspace(name, { workspaceEnv, fixture })` and
  `resetWorkspace(path, fixture)` take it as an argument. The package then has no `SRC` of its own. cli already may
  import `engine/engine`. The compiled binary behaves as today: the fixture is used only when `WORKSPACE` is set.
- **D6 (Q7; decided).** The layout follows the README package → feature → component rule. The architect settles the
  folder names in the amended design.
- **D7 (Q8; decided).** A new boundary rule lets server tests and `check.ts` import `file-system/file-system`. The
  existing allowlist entries for `stateFile` and `fileTools` are updated to their new names and signatures.
- **D8 (Q9; brief F48).** The final api-design.md carries a Test Plan, Invariants, and a Failure Behavior table, as the
  precedent does.
- **D9 (Q10; goal G2).** The goal says reads and writes "must" go through the package, so the rule is enforced inside
  `make test`. A bun test, `src/file-system/boundary.test.ts`, scans production sources outside `src/file-system/` for
  `node:fs`, `node:fs/promises`, `Bun.file`, `Bun.write`, and `Bun.Glob`, with the named exemptions (F2, F3). This
  replaces the cut-list item "wire check_boundaries.py into the Makefile". `check_boundaries.py` itself stays manual,
  as in the precedent.
- **D10 (Q11; brief F48).** README, the update-code-structure skill, and a change log are all updated. That includes
  README:22's "workspaces" and README:74's `startEngine` description.
- **D11 (Q12; decided).** `label` is renamed `location`. `Engine.workspace` keeps its name and holds
  `fileSystem.location`, so server and cli code are unchanged.
- **D12 (Q13; goal G8).** The engine option is named `fileSystem`, after the goal's "an instance of the file system
  package". The `files` name is dropped everywhere.
- **D13 (Q14; decided).** `toKey` is renamed `normalizeKey`. It is documented for loose, untrusted model input only.
  Browser keys go straight to the strict per-call grammar, which refuses `.` and `..` instead of normalizing them.
- **D14 (Q15; decided).** `'other'` stays, and is defined as anything that is not a regular file or folder. On local
  disk that means symlinks, sockets, FIFOs, and devices. Remote backends never return it. Callers' rules are stated
  once: `list` callers drop it, count counts it as a file (F19), and `glob` skips it.
- **D15 (Q16; brief F29).** `ignore` is called for folder keys before the watcher descends into them. An ignored folder
  is never walked, tracked, or reported, so `.git` is never walked.
- **D16 (Q17; brief F14).** A missing or non-folder root keeps today's behavior. `listEntries` rethrows a root
  `not-found` as a plain `Error`, so `GET /api/documents` stays a 500, not a 404 with an empty name.
- **D17 (Q18, Q19; brief F30).** External edits must keep refreshing the UI. The local watcher reports `updated` for a
  tracked file key on any raw `change` event, deduplicated per burst. The snapshot also keeps `mtimeMs` and `size`, so a
  re-listed folder detects in-place saves. The package's own temp-and-rename saves are reported as `updated`, not as
  `deleted` plus `created`. The listener is never called with an empty batch, and a burst made only of ignored keys
  calls nothing, so `.3pitor` saves stay silent (F32).
- **D18 (Q20; goal G6, G7).** The typed events stay. The goal asks for created/updated/renamed/deleted events with the
  current watcher as the implementation. The engine still turns each batch into a payload-free `documents-changed`
  (F30, F36). The typed events are tested at the package level.
- **D19 (Q21; decided).** Deleting or renaming a folder raises one event for the folder only. Its descendants are
  implied (F31).
- **D20 (Q22; decided).** The first snapshot is built asynchronously when `watch()` is called. Raw events that arrive
  during the build are held and diffed in the first burst after it finishes. An error during the build is logged and
  watching stops, the same as a watcher error (F33). The cost of a cwd fallback that is a home folder is recorded as an
  open risk.
- **D21 (Q23; decided).** `stat` does not follow links. A link as the final segment returns `'other'`. A link as a
  middle segment throws `invalid`. A parent segment that is a file (ENOTDIR) returns `undefined`.
- **D22 (Q24; brief F15, F38).** `write` creates missing parents for every key, because F15 needs it. Documents'
  `create` keeps its own parent pre-check, and the race window is accepted as F38 accepts it. The watcher reports the
  created parent folders. `createFolder` on object stores is deferred.
- **D23 (Q25; brief F20).** No memo. Each state write checks for `.3pitor/.gitignore` and writes it only if absent, in
  the same queue, as today does with `wx`. A user's own `.gitignore` is left alone. Two instances racing both write
  `*`, which is harmless. A failure rejects that write only.
- **D24 (Q26; decided).** The amended design gives the exact wording of every package error message in one table.
- **D25 (Q27; decided).** "The same item" means the backend resolves both keys to the same stored item. Local disk
  compares `dev` and `ino`. A case-sensitive store never reaches the case, because `from === to` is refused first.
- **D26 (Q28; decided).** `write` onto a key that is a folder throws `invalid` with "<key> is a folder". This changes a
  500 to a 400 for that request and is listed as a behavior change.
- **D27 (Q29; decided).** A failed write removes its temp file on a best-effort basis. A crash can leave a hidden
  `.<name>.<pid>.tmp` behind. That is recorded as a known effect, and count includes it (F19).
- **D28 (Q30; decided).** `glob` with `dot: false` prunes hidden folders and never walks them. Entries refused by the
  symlink rule are skipped.
- **D29 (Q31; decided).** The key grammar is the same on every OS and adds no rules beyond today's.
- **D30 (Q32; delegation).** BC1 (keys never pass through a symlink) and BC2 (atomic saves) are accepted under the
  delegation and reported as behavior changes.
- **D31 (Q33; decided).** "HTTP statuses and bodies unchanged, except BC-listed ones" is an acceptance criterion. The
  existing route tests prove it, changing only their setup.
- **D32 (Q34; brief F8).** Tests keep using real temp folders. No in-memory backend.

## Architect amendment: points settled while writing (accepted under delegation)

Each is recorded in full in [amended-design.md](./amended-design.md) §0.

- **D33.** `dataDir` is deleted. `check.ts` inlines `join(SRC, '.data', 'check-workspace')`. It does no I/O and has one
  user.
- **D34.** `WORKSPACE_FIXTURE` lives in `engine/paths.ts` and is re-exported by `engine.ts`.
- **D35.** A symlink in a middle segment is refused with today's string `<key> is outside the workspace`, which keeps
  the existing 400 body byte-identical.
- **D36.** Creations are reported per key, including parent folders that `write` creates. Deletes and renames of
  folders are reported once.
- **D37.** A parent segment that is a file is treated as "missing" everywhere (BC8).
- **D38.** `countContents` on a file returns `{ files: 0, folders: 0 }`; today it is a 500 (BC9).
- **D39.** `writeText` starts `fileSystem.write` synchronously and runs the `.gitignore` check alongside it, to keep
  call order.
- **D40.** The local watcher never tracks names that match its own temp pattern.
- **D41.** `watch()` still throws synchronously if `fs.watch` throws, so `startEngine` rejects, as today.
- **D42.** `Makefile` `test-server` adds `src/file-system`, so `boundary.test.ts` runs under `make test`.

## After the build: saves keep the file (operator direction)

- **D43.** Saves stop swapping in a new file. The local backend writes the text to a temp file in the system temp
  folder, copies it into the existing file in place, and removes the temp. A failed temp write never touches the
  original. The file keeps its hard links, extended attributes and Finder tags, mode, owner, and birthtime, and a file
  in a folder that allows no new files still saves. A reader may see a partial file during the copy; the operator
  accepted that window of a few milliseconds. `write(key, text, { atomic: true })` keeps the temp-and-rename for
  callers that need it, and `json-file` passes it for `.3pitor/` state and notes, as the operator asked. The `.3pitor/`
  rule lives in the engine's `json-file`, not in the package, because the package holds no hidden-name policy. This
  replaces D30's acceptance of BC2 and V6's mode-copying fix.

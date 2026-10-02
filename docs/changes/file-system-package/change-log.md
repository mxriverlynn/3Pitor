# Change Log: The `file-system` Package

Implements [api-design.md](./api-design.md) on branch `file-system-package` (draft PR #29), test-first.

## Result

Every file read and write the app makes at runtime now goes through `src/file-system/`. The cli builds a local file
system and hands it to `startEngine`, the same way it hands the engine to `startServer`. The engine does no file I/O
of its own. The route tests, which are the acceptance tests (D31), pass with only their setup changed. The live
`bun run check` needs a real API key and was not run.

| Done-when | Status |
|---|---|
| `make typecheck` | Passes |
| `make test`, Makefile runs `src/cli src/server src/engine src/shared src/file-system` | Passes: 330 Bun-side tests, 446 UI tests |
| `boundary.test.ts` (D9) | Passes. A planted `Bun.file` call in `src/engine/` turned it red, naming the line |
| `check_boundaries.py` with E2, C1, FS2, FS3, U1, S3, and removed-file updates | Exits 0: `all boundary rules hold` |
| `make check-build` | Passes: the binary served all three app skills, and `--version` printed `3pitor 0.0.0-fs` |
| Route tests change only in setup (D31) | Holds for the documents, view-state, workspace-config, sessions, and MCP endpoint route tests |
| `cli.test.ts` unchanged | Holds, including the end-to-end `documents-changed` test |
| Skill edit in its own commit | "Teach the update-code-structure skill the file-system package" |
| `bun run check` | **Not run.** It needs a real `ANTHROPIC_API_KEY` |

## Test counts

| Folder | `main` | This branch | Why |
|---|---|---|---|
| src/cli | 21 | 21 | Unchanged |
| src/server | 41 | 41 | Setup lines only |
| src/engine | 198 | 189 | The 8 watcher tests and the 3 workspace tests moved to the package. The 6 `workspace-path` tests were deleted; their cases now live in the package's key and local-backend tests (BC3 maps each one). New: `isHiddenKey`, write onto a folder, count of a file, a linked folder inside the workspace, three tools tests, the fixture path, and a linked skills folder |
| src/shared | 18 | 18 | Unchanged |
| src/file-system | — | 61 | New package |
| UI | 446 | 446 | Unchanged |

## Where the build departed from the design

- **The watcher re-walks the tracked tree on each settled burst.** The design described re-listing only the folders
  that changed. A full walk gives the same events with much simpler bookkeeping, and the UI already re-lists the whole
  tree on every `documents-changed`, so the cost is the same order. The 10,000-entry cap (V9) still bounds it.
- **`glob` follows `Bun.Glob`'s scan on brace groups.** V1 said a brace alternative that starts with `.` lets
  `{a,.claude}/**` reach hidden names with `dot` off. Running scan shows it does not: only a pattern segment that
  itself starts with `.` does. The parity test pins scan's behavior.
- **Making a symlink reports `changed`.** The design's test list said "no event". But V3's rule says any non-ignored
  activity that the diff cannot describe delivers `changed`, so the UI never misses a refresh. The test follows V3.
- **`read` of a folder passes the system's EISDIR through**, as the Failure Behavior table says. Only `write` reports
  `<key> is a folder` (D26).

## TDD notes

- The watcher's ignore, cap, error, and unsubscribe tests passed on their first run. Those behaviors were written along
  with the typed events in the cycle before, so the code got ahead of its tests there. The tests now pin them.
- The "change during the first walk" test was flaky: a write made at the instant the watch starts can land before
  macOS has the watch running. It now writes after the watch is up, while a 3,000-file walk is still under way.

## After the build: saves keep the file (D43)

The first build saved every file by renaming a temp file over it (BC2). That broke hard links, reset Finder tags and
other extended attributes, and stopped saves in folders that allow no new files. At the operator's direction, a save now
writes the text to a temp file in the system temp folder, copies it into the existing file in place, and removes the
temp. A failed temp write never touches the original, and the file keeps its identity. A reader may see a partial file
during the copy, a window of a few milliseconds that the operator accepted. The app's own `.3pitor/` state keeps the
rename, through `write(key, text, { atomic: true })`, which `json-file.ts` passes.

New tests: a hard link sees the new text, a Finder tag survives (macOS only), a file in a folder that allows no new files
saves, a failed temp write leaves the original untouched, an atomic write swaps in a new file, and `json-file`'s state
writes are atomic. The tag and folder tests passed on their first run, because the copy-in-place change already
delivered them. Run against the earlier rename version, both failed, which shows they test the behavior.

# Validation Findings: File-System Package Design

`han-core:adversarial-validator` attacked [amended-design.md](./amended-design.md). It ran experiments with Bun 1.4.2
on macOS APFS. Each finding is marked accepted or rejected. Dispositions were settled under the standing delegation.

| # | Finding | Severity | Disposition | Change, or why it does not hold |
|---|---|---|---|---|
| V1 | `Bun.Glob#match` has no dot option. Pruning hidden names whenever `dot:false` breaks patterns with an explicit dot outside the literal prefix (`{a,.claude}/**`, `.*`). A leading `./` is undefined. | blocking (spec) | accepted | `glob` prunes a hidden segment only when the pattern's matching segment does not start with a literal `.`. A leading `./` is stripped. A parity table (patterns × dot) is compared against `scan`. §9 risk 2 is settled by the experiment. |
| V2 | On macOS, Bun reports every operation as `rename`, in-place writes included; `change` never fires. | should-fix | accepted | Any raw event whose key is a tracked file marks it `touched`, whatever the event kind. Add a same-size in-place write test. F31 is corrected. |
| V3 | A stateful diff can miss a change, and a miss silently stops the UI refreshing. Today's watcher cannot miss. | should-fix | accepted | A burst with non-ignored raw events but an empty diff still calls the listener, with a coarse `{ type: 'changed' }` event. The engine already collapses every batch to `documents-changed`. |
| V4 | `parentKey` is not exported from the entry module, but documents uses it. | should-fix | accepted | Export `parentKey` from `file-system.ts`. |
| V5 | The into-itself check by real path conflicts with D2's unresolved root. | should-fix | accepted | `realpath` both the source and the existing target parent, then compare. Add a test with a symlinked root and a case-variant move. State that `moveEntry` treats `'other'` as a file. |
| V6 | Temp+rename inverts permission behavior: a 444 file is silently overwritten, and a file in a 555 folder can no longer be written. xattrs, tags, and birthtime reset. | should-fix | accepted | `write` refuses (errno passthrough, EACCES) when the existing file is not writable, and gives the temp file the existing file's mode. The 555-folder case and the xattr/tag/birthtime resets are listed under BC2. |
| V7 | `read` on a FIFO hangs forever; non-link `'other'` items have no read or write rule. | should-fix | accepted | `read` and `write` refuse any final-segment `'other'` with `invalid`, "<key> is not a regular file". Add a `mkfifo` test. |
| V8 | `locate`'s `parentMissing` conflates "missing" with "is a file", which `write` must tell apart. | minor | accepted | `locate` reports a tri-state: `'missing'` or `'not-folder'`. |
| V9 | The snapshot walks and stats every non-hidden file, so a `node_modules` tree or a home-folder fallback costs memory. | should-fix | accepted | The snapshot is capped at 10,000 tracked entries. Past the cap, the watcher degrades to coarse `changed` events (V3). |
| V10 | Queue keys differ by letter case on a case-insensitive disk, and `pending` is never pruned. | minor | accepted | The guarantee is stated for keys as the tree reports them. Settled entries are deleted from `pending`. |
| V11 | Model-visible strings change: a final-segment link now reads "<key> is a symlink", and an in-workspace final link that reads today now fails. | minor | accepted | Added to BC1 and BC3. Each deleted `workspace-path.test.ts` case is mapped to its new outcome. |
| V12 | Symlink refusal is check-then-act, so a swap between the walk and the act can escape. | minor | accepted | The wording changes to "closes the static case (F41/F42)". The race is listed as an open risk. |
| V13 | The boundary test exempts a whole directory, does not stop engine code importing the local factory, and misses `require`/dynamic `import`. | minor | accepted | Exempt the named files only. Add a rule limiting engine imports from the entry to contract symbols. Ban the `require` and dynamic `import` forms too. |
| V14 | `FileSystem` collides with the DOM global type in `tsconfig`'s `lib`. | minor | rejected | The goal names it "the file system package" and asks for "an instance of the file system package" (G8, D12). A missing import fails type-checking at the first method call, because the DOM `FileSystem` has no `read`, `write`, or `watch`, so the risk is a confusing error, not a silent bug. Recorded as an open risk. |
| V15 | F31 understated macOS behavior. APFS shows no inode reuse; Linux is untested. | informational | accepted | F31 is corrected (V2). Linux inode reuse producing false `renamed` events is listed as an open risk. |

## What held up

The validator confirmed:

- **Consumer list:** a grep of production code finds exactly the consumers the design lists.
- **Wiring:** `cli.ts` keeps `--version` and `--help` free of I/O, and `chooseWorkspace` and the watcher each have one
  caller.
- **Test call sites:** the `createEngine` and direct-call counts match the source.
- **Claude CLI:** the CLI's isolation from the workspace holds (F4).
- **F16:** the resolution holds.
- **Documents:** the documents messages and HTTP mapping match.
- **D5:** holds.
- **Watcher tests:** the moved watcher tests fit the diff design.
- **macOS replay:** startup replay becomes harmless.
- **Unicode:** NFC names survive watch and readdir on APFS.

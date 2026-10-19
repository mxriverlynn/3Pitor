# Validation Dispositions

`han-core:adversarial-validator` attacked the amended design ([amended-design.md](./amended-design.md)) and found no
design-breaking defect. It raised 7 should-fix findings and 4 minor ones. All 11 are accepted, V2 only in part. The
architect folded every accepted finding into the final design in one revision.

| V | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| V1 | `listResearchDocuments` never says it leaves out deleted ids, so a document another writer recreates could be listed and then refused by `get`. | should-fix | Accepted. The list never includes a deleted id, mirroring `walk()` at `src/posts/file/file-post-store.ts:138`. |
| V2 | D7 (in-place research editing) is not justified by the goal: F4 shows the skill appending to a post body, not editing a research document. D11 contradicts itself. | should-fix | Accepted in part. Editing stays, re-justified on Q7 alone: delete plus create changes the id and is not atomic. It is flagged to the user as a decision beyond the goal. D11 is reworded. |
| V3 | Naming research ids from the title with plain writes cannot keep the id rules: plain writes are not exclusive, case-insensitive disks collide, and long names fail. | should-fix | Accepted. Each research document becomes its own subfolder, claimed with `createFolder` and named with `folderName`, like posts. |
| V4 | "Body writes are atomic" is false: `draft.md` uses the default write. | should-fix | Accepted. The direction is corrected and the body-write choice is stated. |
| V5 | "A stale pair can never reach a later document" overclaims across store instances and posts. | should-fix | Accepted. It is qualified "through one store instance", and an open risk is added. |
| V6 | File-store states are undefined: `research` as a file, which entries count as documents, `outline.md` that is not a file, removing an absent outline, crash ordering. | should-fix | Accepted. Each state is defined. |
| V7 | Titles need not be unique, so the order of ties is undefined. | minor | Accepted. A tie rule is stated. |
| V8 | Orphan title sidecars could give a new file an old title. | minor | Accepted. Resolved by V3's folder-per-document layout. |
| V9 | "means the post still exists" overstates what a not-found can know. | minor | Accepted. Softened to "the post was found when checked". |
| V10 | The earlier design's Failure Behavior table no longer covers every method. | minor | Accepted. The new methods get their own failure table. |
| V11 | Discovery-agent labels such as "DE D3" collide with the decision numbers D1–D11. | minor | Accepted. The brief's labels are renamed to DE-n, SA-n, and CE-n. |

## What the validator checked and found sound

- The 21 `new PostError(` sites, all inside `src/posts/`.
- The three `.reason` readers.
- The spread-only test doubles (F17).
- The watch rule for hidden names (F25).
- `research/` never being mistaken for a post (F21).
- The blank-title-first precedence, which matches the existing `create` and `setTitle`.
- Outline writes ordered against `setBody`.
- F2, F11, F24, and F26 against the code and sample data.

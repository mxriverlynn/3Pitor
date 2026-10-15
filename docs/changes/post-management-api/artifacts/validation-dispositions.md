# Validation Dispositions

The `han-core:adversarial-validator` raised 14 findings, numbered V1–V14. It found no design-killer.

- **Accepted in full:** 13 findings.
- **Accepted in part:** 1 finding (V13).
- **Rejected:** none.

Everything accepted went to the architect together, in one revision round.

## Findings that change the contract

**V1. Reusing a deleted id lets a stale call write into a different post.**

- **Disposition:** accepted, using fix (a).
- **Change:** a store instance never reuses an id. The file store keeps a set of the ids it has deleted, called
  tombstones, and will not create a post under one of them.

**V2. The engine cannot recognize a `PostError` under the import-type-only rule.**

- **Disposition:** accepted.
- **Change:** a dependency-free error module that the engine may import as a value.

**V5. `create` can return an id that `list` would not return.**

- **Disposition:** accepted.
- **Change:** `create` resolves the id from the real name it finds in the listing. The test suite asserts that every id
  `create` returns appears in `list`.

**V6. Pagination breaks the design's own admission test.**

- **Disposition:** accepted.
- **Change:** `list()` returns an object, `{ posts }`, so fields can be added later without breaking callers. Paging is
  still cut.

**V7. The body round-trip promise is too strong for a database.**

- **Disposition:** accepted.
- **Change:** the shared suite drops the NUL character. The design states that lone surrogates are unsupported, and it
  defines what counts as a blank title.

## Findings that change the file store

**V3. The file store starts one file-system watcher per `watch` call.**

- **Disposition:** accepted.
- **Change:** one underlying watch, counted by its subscribers.

**V4. A listener set merges two subscriptions of the same function.**

- **Disposition:** accepted.
- **Change:** each subscription gets its own entry. An entry is registered only after the underlying watch succeeds.
  Signals are sent over a copy of the subscription list.

**V8. Every addressed call walks the root folder.**

- **Disposition:** accepted.
- **Change:** the Known gap section documents the cost. No cache is added.

**V9. One badly named folder can fail all of `list()`.**

- **Disposition:** accepted.
- **Change:** both `list` and the address walk skip names that fail the key grammar, so the two still agree.

**V11. A `delete` can partly succeed and still report `not-found`.**

- **Disposition:** accepted.
- **Change:** the Known gap section documents this race with other writers.

**V12. Nothing stops `src/ui/` or `src/shared/` importing the posts package.**

- **Disposition:** accepted.
- **Change:** a boundary rule names the allowed importers. The posts package gets its own Bun-free scan.

## Findings that change the document

**V10. The design overstates that one stored title ends drift.**

- **Disposition:** accepted.
- **Change:** the justification is reworded, and BC2 now says the title and the H1 can disagree. The weak citation in
  F4 is noted.

**V13. Contract rules and file-store details are mixed together.**

- **Disposition:** accepted in part.
- **Change:** the design document separates the contract from the file store's conformance notes, and file-store-only
  items stop citing G5.
- **Not changed:** the build scope stays as D2 set it. The goal says integration happens later, and building the
  contract with its tests is the next step toward that end goal.

**V14. The decision log disagrees with the design.**

- **Disposition:** accepted.
- **Change:** the decision log is aligned with the design. D18 becomes "reaches storage". Q19's answer is corrected:
  create holds the id's queue only after it claims the folder.

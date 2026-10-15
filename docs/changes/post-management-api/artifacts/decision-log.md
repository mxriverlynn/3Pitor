# Decision Log: Post Management API

Your standing instruction for planning runs in this repo is "make the best decisions you can, without asking me". Under
it, this run settled its gates itself instead of asking. Each decision below cites its evidence. Every behavior change a
decision causes is listed in the design document.

## D1. Option A is the chosen contract (Step 6 gate)

- **Decision.** Option A: a flat store of posts with stable ids, one markdown body each, in a new `src/posts/` package.
  It was chosen over Option B (a path-addressed post tree) and Option C (parts, collections, and typed events).
- **Why.** Only Option A makes posts first class (G3) without building file-system assumptions into the contract (G5):
  - Option B keeps path identity (F2), and a database would have to emulate a directory tree.
  - Option C adds parts and collections that the goal does not ask for. Each can be added to Option A later without
    breaking anyone.
  - A clean break is cheap now, because breaking changes are explicitly acceptable (G6, G7).
- **Source.** The architect's recommendation in [../design-options.md](../design-options.md), accepted under the
  standing instruction.

## Question round (Steps 7 and 8)

Every question the round left open was settled here under the standing instruction. The answers went to the architect
together, in a single amend round.

- **D2. What the build delivers.** The `tdd` build delivers four things:
  - the `src/posts/` package
  - the file store
  - the contract test suite
  - the boundary checks, Bun-free checks, and README update

  The cli and engine wiring, and the watcher swap, are integration (G7).
- **D3. How long the file store lives.** The contract makes no assumption about whether the file store outlives the
  database cut-over.
- **D4. A shared contract suite.** Every implementation must pass the shared `describePostStore` suite. An in-memory
  store is cut, because nothing needs it yet.
- **D5. Where ids are stable.** Ids are stable within one store. Migrating from files to a database is outside the
  contract.
- **D6. Ids stay unbranded.** The file mapping states that the file store's ids look like paths but are opaque. The
  risk that callers depend on their shape is recorded.
- **D7. Exact id matching.** An id names a post only when it exactly matches the id the store gave out. The file store
  verifies the folder's real name, so a case-insensitive disk cannot give one post two ids.
- **D8. What can be addressed.** Only ids that `list` could return are addressable. The root is never a post. Hidden
  segments, and folders nested inside another post, are `not-found`.
- **D9. The H1 belongs to the caller.** The store never reads or writes it. The title is separate metadata.
- **D10. Title fallback.** The fallback order is the `.post.json` title, then the folder's last segment, then
  `Untitled`.
- **D11. What `list` returns.** `list` gives every post that exists throughout the call. The file store skips folders
  that vanish during the walk and fails on any other error.
- **D12. Error messages.** The messages are fixed, user-facing sentences that carry no id.
- **D13. Body round trip.** A body is any well-formed string and is returned unchanged. The suite tests empty bodies,
  NUL, CRLF, and large bodies.
- **D14. Create retries.** The ` 2`, ` 3`, … retry loop has no cap, and an exclusive `createFolder` keeps ids distinct.
- **D15. Create cleanup.** Cleanup removes the folder only when it holds nothing but the store's own files.
- **D16. Per-post queue.** The file store queues the calls for each post. This closes the gap where a `setBody` racing a
  `delete` brought the post back.
- **D17. Ordering.** Every call on one post through one store takes effect in call order.
- **D18. Signals for the store's own writes.** The file store signals directly after each of its own writes that reaches storage, including a write that then fails. The
  watcher covers only other writers.
- **D19. Subscriptions.** Each `watch` call subscribes independently, and its unsubscribe is required.
- **D20. Spurious signals.** The broad watch ignore rule stays. Spurious signals are allowed.
- **D21. README.** The README is updated in the build.
- **D22. Boundary test.** `src/posts/` gets a boundary test.
- **D23. How the engine imports the contract.** The engine imports `posts.ts` with `import type` only. The Bun-free
  scan covers `src/posts/` except a database adapter's folder.
- **D24. Pagination stays cut.** This is a known exception to the admission test.
- **D25. The `invalid` reason keeps its name.** It means "an argument the store refuses".
- **D26. `.post.json` is intended.** The engine's event name is left to integration.

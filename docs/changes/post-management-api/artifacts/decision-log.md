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

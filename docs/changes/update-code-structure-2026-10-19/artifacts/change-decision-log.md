# Change Decision Log: Update the Code Structure (2026-10-19)

Decisions are numbered in the order they were made and are never renumbered.

### D-1: Work on a new branch, push each commit, and open a draft PR

- **Question:** The skill commits to the current branch only and never pushes or opens a PR. The owner asked, after
  the run started, to "create a branch for this, commit and push as you go, open draft pr when you're done".
- **Decision:** Create `update-code-structure-2026-10-19` from `main` at `cb9478c`, push after each commit, and open a
  draft PR at the end.
- **Rationale:** The owner's direct instruction for this run overrides the skill's default. The 2026-10-01 run did the
  same (its D-1).
- **Alternatives rejected:** Committing to `main` as the skill's default says, because the owner said otherwise.

### D-2: Run the architectural analysis at medium size with five agents

- **Question:** Which size and roster the analysis should use, with no owner to ask.
- **Decision:** Medium: structural, behavioral, and concurrency analysts, then the risk analyst and software architect.
- **Rationale:** The focus is all eight packages, but the concern is move safety, not a security, data, or ops review.
  A pure restructure would defer those findings anyway. The concurrency signal is clear: per-key write queues in
  `file-system/local/` and `engine/components/json-file.ts`, the post store's watch, and chat turns. The 2026-10-01 run
  made the same call (its D-2).
- **Alternatives rejected:** Large, which would add security, on-call, and a codebase map whose findings this run
  could not act on. Small, which drops the concurrency analyst, the one agent that checks for module-level state a
  move could split.

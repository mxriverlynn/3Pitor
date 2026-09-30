# Change Decision Log: Update the Code Structure

Every decision made in this change set, numbered in the order it was made. The owner was away, so each decision was
made from evidence and is recorded here with its reasoning. Numbers are never reused. Precedent decisions from
[restructure-by-feature](../../restructure-by-feature/artifacts/change-decision-log.md) are cited as "prior D-N".

### D-1: Work on a new branch and open a draft PR, overriding the skill's default

- **Question:** The `update-code-structure` skill commits to the current branch and never creates branches, pushes, or
  opens PRs. The owner started this run with "on a new branch, and open a draft PR when you're done". Which applies?
- **Decision:** Create `update-code-structure-2026-09-30` from `main` at `1a67393`, commit each step there, push, and
  open a draft PR at the end.
- **Rationale:** The skill's rule exists "BECAUSE the owner decides where this work lands and who sees it". Here the
  owner decided, explicitly, when starting the run.
- **Alternatives rejected:** Committing to `main` (the skill's default) contradicts the owner's direct instruction.

### D-2: Run the architectural analysis at medium size with five agents

- **Question:** What size and roster should `/architectural-analysis` use on `src/`?
- **Decision:** Medium: structural, behavioral, concurrency, risk, and software-architect.
- **Rationale:**
  - The concern is file placement and move safety, not a security, data, or ops review.
  - `src/` is three adjacent packages with async code, which calls for the concurrency analyst.
  - The prior restructure's analysis ran at medium with the same roster (restructure-by-feature change log, entry 1).
- **Alternatives rejected:**
  - Large, as the file count (about 100 files) alone would suggest. It would add the security and on-call analysts,
    whose findings would all be behavior changes that this pure restructure defers anyway.
  - Small. It would drop the calibration to high-impact findings only, and could miss medium move hazards such as the
    `mock.module` strings (R2).

### D-3: Write the analysis report's summary to the readability standard directly, without a separate editor pass

- **Question:** `/architectural-analysis` ends with a readability-editor rewrite of its synthesized prose. Should this
  unattended run dispatch it?
- **Decision:** No. The Executive Summary and the "How to Read" frame were written to the standard (main point first,
  short sentences, one idea per bullet). The verbatim agent sections are untouched either way.
- **Rationale:** The report is an internal artifact of this change set, and the prose the editor would rewrite is about
  40 lines. A separate agent pass adds a round trip, and a context hand-off, to an unattended run for little gain.
- **Alternatives rejected:** Dispatching the editor. This is cheap to reverse: run `/edit-for-readability` on the report
  later.

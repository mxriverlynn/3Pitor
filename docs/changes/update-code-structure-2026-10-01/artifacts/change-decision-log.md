# Decision Log: Update the Code Structure (2026-10-01)

Decisions are numbered in the order they were made and never renumbered.

### D-1: Work on a new branch, push as the run goes, and open a draft PR

- **Question:** The skill commits only to the current branch and never pushes or opens a PR. The owner's arguments
  asked for a branch, commits as the run goes, and a draft PR.
- **Decision:** Create `update-code-structure-2026-10-01` from `main`, push after each commit, and open a draft PR
  after the first commit.
- **Rationale:** The owner's own instruction for this run overrides the skill's default. The previous run
  (`update-code-structure-2026-09-30`, its D-1) did the same.
- **Alternatives rejected:** Committing to `main` as the skill says. The owner asked otherwise.

### D-2: Run the architectural analysis at medium size with five agents

- **Question:** What size and roster should `/architectural-analysis` use on `src/`?
- **Decision:** Medium: structural, behavioral, concurrency, risk, and software-architect. The briefs point the
  analysts at what changed since the previous run, and they reuse its findings where the code is unchanged.
- **Rationale:** The previous run's D-2 chose this size and roster for the same goal on the same tree. The tree has
  grown by six modules and one feature (live file watching) since then, and none of them adds a security, data, or ops
  surface that a pure restructure would act on.
- **Alternatives rejected:**
  - Large, as the file count (112) alone would suggest. It would add analysts whose findings would all be behavior
    changes that this restructure defers anyway.
  - Small. Its calibration reports only high-impact findings, and could miss medium-impact move hazards.

### D-3: Write the analysis summary to the readability standard directly, without a separate editor pass

- **Question:** `/architectural-analysis` ends with a readability-editor rewrite of its synthesized prose. Should this
  unattended run dispatch it?
- **Decision:** No. The summary and the "How to Read" frame are written to the standard directly, and the verbatim
  agent sections are left untouched either way.
- **Rationale:** The previous run's D-3 made the same call: the report is an internal artifact, and the prose the
  editor would rewrite is short.
- **Alternatives rejected:** Dispatching the editor. This is cheap to reverse: run `/edit-for-readability` on the report
  later.

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

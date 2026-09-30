# Change Log Format

The formats below follow `docs/changes/restructure-by-feature/`, the first run of this restructure. Use them so every
change set in `docs/changes/` reads the same way.

## Change-log skeleton (`docs/changes/{slug}/change-log.md`)

```markdown
# Change Log: Update the Code Structure by Package, Feature, and Component

This is the running log of every change made in this change set, in the order it was made. The owner was away and
asked for every decision to be made and justified here. Each entry says what changed and why, and links the decision
(D-N) behind it.

**Where to read more:**

- [change-plan.md](change-plan.md): the plan these changes carry out.
- [artifacts/change-decision-log.md](artifacts/change-decision-log.md): every decision, with its reasoning and the
  alternatives rejected.
- [artifacts/architectural-analysis.md](artifacts/architectural-analysis.md): the analysis that found the risks.

**Branch:** `{branch}`. Every step below is one commit on it.

**Baseline before any change:** `make test` passes {N} server tests and {N} UI tests, and the type-check exits 0.
```

## Entry format

Add one numbered section per step, in order: the analysis, the plan, each unit, and the README update.

```markdown
## {n}. Unit {k}: {what the unit does} (`/tdd` or `/refactor`)

- **Commit:** the commit message. The short hash isn't known until after the commit, so fill it in with the next
  entry's commit, or in Step 7 for the last one.
- **What:** the files moved, created, or edited, as `old path` → `new path` where files moved.
- **Why:** the owner's rule or the analysis finding this unit serves.
- **Decisions:** D-{n}, D-{n}, each with one line on what it settled.
- **Tests:** the `make test` counts after the unit, compared with the baseline.
```

## Decision format (`artifacts/change-decision-log.md`)

Number decisions D-1, D-2, and so on in the order they were made. Never renumber, BECAUSE the change log and the plan
link to them by number.

```markdown
### D-{n}: {the decision, stated as a sentence}

- **Question:** what had to be decided.
- **Decision:** what was chosen.
- **Rationale:** the evidence behind it: a file path, a rule, a finding, or an earlier change set's precedent.
- **Alternatives rejected:** each alternative and why it lost.
```

## Closing sections

Add these to the end of the change log in Step 7, in this order:

- `## Where things ended up`: the top-level feature folders of each package after the change, and the final test counts
  compared with the baseline.
- `## Decisions the owner should look at first`: the D-N entries that were closest calls, departed from precedent, or
  overrode an analysis recommendation, each with one line on why it matters.
- `## Units not done`: each unit that failed or was not started, with the failing output or the unit it depended on.
  Write "None" if every unit finished.
- `## Follow-ups not done here (behavior changes)`: the behavior-changing findings the plan deferred.

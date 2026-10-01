# Scope Boundary: Homebrew distribution for 3pitor

## Work Item

No ticket, issue, or pull request exists. The operator's request is the only boundary this run has. The operator
pointed at a sibling project's investigation, `~/dev/testdouble/skillwalker/docs/planning/homebrew-distribution/investigation.md`,
as the pattern to follow. That report is about Skillwalker, not 3pitor, so it is a source of approach and prior art,
not scope evidence for this repo.

## Stated Scope

> use ~/dev/testdouble/skillwalker/docs/planning/homebrew-distribution/investigation.md to build a plan for making
> 3pitor a homebrew installable project

## Stated Exclusions

None stated.

## Operator-Stated Scope

The operator confirmed this area as the whole area the change may touch ("confirmed both of those"):

- In this repo: `Makefile`, `package.json`, the command line (`src/server/command-line.ts`, `src/server/server.ts`),
  the startup help text, a new release workflow under `.github/workflows/`, and `README.md`.
- Outside this repo: the formula in the operator's existing tap.

The operator also stated:

> and FYI, i have a homebrew-tap repo for this already: https://github.com/mxriverlynn/homebrew-tap

Linux support and CI on every pull request were offered as possible additions in the confirmation turn. The operator
did not add them, so both sit outside the confirmed area.

## Direction of Travel

Not applicable as asked. Nothing the request names is being deprecated or replaced: running from source
(`bun run server`) and `make build` stay as the contributor path, beside the new Homebrew path. Recorded as
`Unanswered`, because the question was not put to the operator.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` on 2026-10-01 from the operator's request and confirmation turn. No conflicting work
item was supplied.

# Scope Boundary: Bun-free engine

## Work Item

No work item exists. The operator's request, typed when invoking `plan-a-change` on 2026-10-02, is the only boundary
this run has.

## Stated Scope

> to remove all bun specific code from the "engine" package, and put it into a different package. that may be an
> existing package or a new package. the goal, though, is to be able to re-use the engine outside of the bun runtime

## Stated Exclusions

None stated in the request. The operator's confirmation turn added one (below).

## Operator-Stated Scope

From the confirmation turn, verbatim:

> 1: the pattern matcher must move into the file-system package, as a method to be called. the engine's tests are fine
> as bun-specific right now. we'll deal with those later, as that's easier to move when needed.

Read together with the request, the boundary is:

- **In:** every production module under `src/engine/` that uses a Bun-only API or Bun-only import attribute; the
  file-system package's pattern matcher (`src/file-system/glob/glob.ts`), which becomes a method on the `FileSystem`
  contract; and the receiving packages (`src/cli/`, `src/server/`, or a new package) that take over the Bun-specific
  code.
- **Out:** the engine's tests and test-only helpers (`*.test.ts`, `src/engine/chat/components/` test helpers such as
  `fake-claude.ts`, `fake-claude-on-path.ts`, `chat-test-helpers.ts`, `test-model.ts`). They stay on `bun:test` and may
  keep using `Bun.*` until a later change.

## Direction of Travel

Bun remains the runtime of the shipped `3pitor` binary. The engine is to become runtime-neutral so it can also run
elsewhere; nothing is being migrated away from Bun as a whole.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` in this run, from the operator's request and confirmation turn. No conflicting record
existed.

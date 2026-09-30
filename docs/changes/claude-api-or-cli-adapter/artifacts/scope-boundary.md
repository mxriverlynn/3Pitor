# Scope Boundary: Claude API or CLI Adapter

## Work Item

No work item exists. The operator's request, typed when invoking `plan-a-change` on 2026-09-30, is the only boundary
this run has.

## Stated Scope

> i want to add a claude-specific adapter layer so that i can choose to use an ANTHROPIC_API_KEY env var vs using my
> existing claude subscription and already installed executable. the determining factors for which to use: by default,
> check for ANTHROPIC_API_KEY env var. if it exists, use it with the AI-SDK claude API calls. if that env var does not
> exist, or is empty, assume you can run `claude` CLI without having to install it. to force a specific claude execution
> type, add a CLI option (with a proper CLI args parsing framework) to handle `--claude=API` or `--claude=CLI` or
> `--claude=auto`. the `auto` option is the default behavior, which automatically selects based on the API key being
> present or not.

## Stated Exclusions

None stated in the request itself. The confirmation turn restated, and the operator confirmed ("looks good"), these
limits carried from the earlier change `docs/changes/replace-claude-code-with-anthropic-api/`:

- With an API key set, or with `--claude=API`, 3pitor never touches a `claude` program.
- Only CLI mode assumes a `claude` program is installed. If it is not, CLI mode fails with a clear message.
- 3pitor never installs, downloads, builds, or bundles a `claude` program, and `make build` does not either.

## Operator-Stated Scope

The confirmed area, restated in the confirmation turn and accepted with "looks good":

- How the chat builds its model (`src/server/chat/agent/`)
- The chat turn, where CLI mode needs it (`src/server/chat/sessions/`)
- Startup and argument handling (`src/server/server.ts`)
- The test stand-in model (`src/server/chat/components/test-model.ts`)
- `make check-build`
- The README

Output folder: `docs/changes/claude-api-or-cli-adapter/`.

## Direction of Travel

Answered: the earlier decision that 3pitor must not rely on a `claude` program is narrowed, not reversed. The API path
stays exactly as independent of `claude` as it is today; the CLI path is an added, opt-in-by-absence alternative. The
earlier plan's words, which this narrows: "i don't want to rely on claude already being installed, or being downloaded /
built / installed by 3pitor or the makefile build process".

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` on 2026-09-30. A conflict with the earlier record at
`docs/changes/replace-claude-code-with-anthropic-api/artifacts/scope-boundary.md` was surfaced in the confirmation turn
and resolved in favor of this request, narrowed as described under Direction of Travel.

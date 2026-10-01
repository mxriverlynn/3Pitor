# Scope Boundary: Prompt Caching Through AI SDK Middleware

## Work Item

No ticket or issue exists. The operator's request in this conversation is the boundary. It builds on the research
report `docs/research/prompt-caching-ai-sdk-and-claude-cli.md`. Implementation is tracked in draft PR #22
(https://github.com/mxriverlynn/3Pitor/pull/22) on the branch `prompt-caching-middleware`.

## Stated Scope

The operator's research request, word for word:

> the best way to do prompt caching in both the AI-SDK and claude CLI use. we need a solution for both. [...] this will
> require using middleware, so as part of this, i want to restructure the agent code to use the AI-SDK middleware for
> system prompt and other things that should be turned into middleware

The planning request, word for word:

> from this research result. also, create a branch for all this work to be implemented. commit and push as you go. open
> a draft pr

## Stated Exclusions

None stated.

## Operator-Stated Scope

Answers from the confirmation turn:

- **Area:** "Also include sessions.ts". The change may touch `src/server/chat/agent/agent.ts`,
  `src/server/chat/claude-backend/claude-backend.ts`, `src/server/chat/claude-cli/claude-cli.ts`,
  `src/server/chat/sessions/sessions.ts`, and their tests.
- **CLI history:** "Keep it, measure first (Recommended)". Plan only the system prompt boundary line for the `claude`
  program. The history design stays as it is.
- **Cache logging:** "Include it (Recommended)". Each model call logs its cache read and write counts on both paths.
- **Plan folder:** `docs/changes/prompt-caching-middleware`.

## Direction of Travel

The design where the `claude` program receives history as a text transcript is being kept, not replaced. The operator
chose "Keep it, measure first", and will revisit it only if the cache numbers are poor.

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` on 2026-10-01 from the operator's request and confirmation turn. Not inherited.

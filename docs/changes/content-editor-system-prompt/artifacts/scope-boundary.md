# Scope Boundary: Content editor system prompt

## Work Item

No work item exists. The operator's request, typed when invoking `plan-a-change` on 2026-09-29, is the only boundary
this run has. The request points at the research report committed on this branch,
`docs/research/content-editor-system-prompt.md`, which the operator commissioned in the same session with the
understanding that the implementation would follow on the same branch.

## Stated Scope

> to create and use a custom system prompt based on this research

The research request that commissioned the report, quoted from the same session:

> writing a custom system prompt to use for the ai agent, specifically to make the agent be a content editor and not
> know anything about writing code. the entire purpose of this app is to write blog posts and other prose style
> documents, but more specifically with a blog post focus. the system prompt for the AI should know this, and should be
> configured for this explicitly.

## Stated Exclusions

None stated.

## Operator-Stated Scope

The confirmation turn proposed, as the whole area, the main chat prompt the AI receives on every turn
(`instructionsFor()` in `src/server/chat/agent/agent.ts`) plus the test that pins its exact text
(`src/server/chat/agent/agent.test.ts`). It asked whether the built-in title-writer helper's prompt and the
collaborative-draft-editing skill's wording should also be brought in line, and proposed the output folder
`docs/changes/content-editor-system-prompt/`.

The operator answered: "all good". This run reads that as accepting the proposed area as the whole area and the proposed
folder name. The title-writer prompt and the skill's wording are therefore outside the area.

The operator also said, mid-run: "commit as you go".

## Direction of Travel

Unanswered. Not asked: the request replaces the text of one prompt and names nothing being deprecated or migrated away
from.

## Visual Material Received

None received

## Record Provenance

Established by `han-planning:plan-a-change` in this run, from the operator's typed request, the research request earlier
in the same session, and their confirmation-turn answer. No prior record existed and no conflict was resolved.

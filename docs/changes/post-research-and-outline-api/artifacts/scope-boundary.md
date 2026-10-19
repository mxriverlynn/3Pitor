# Scope Boundary: Research Documents and an Outline on the Current Post

## Work Item

No ticket or issue exists. The operator's request, typed when invoking `/han-planning:plan-a-change` on 2026-10-19, is
the only boundary this run has. It names `docs/changes/post-research-and-outline-api/api-design.md` as the design to
implement. Draft PR #42 (branch `post-research-and-outline-api`) holds that design and is where this plan lands.

## Stated Scope

> to implement docs/changes/post-research-and-outline-api/api-design.md - when research is done via `/research` or other
> request for research, the research produced should be associated with the current blog post. similarly, when an
> outline is created, it should also be associated with the current blog post. the left hand navigation should no
> longer show all available posts. instead, it should show the current post name, and then underneath of that it should
> show the available research and outline documents, if any are available

## Stated Exclusions

None stated.

## Operator-Stated Scope

The confirmation turn named four areas the change may touch, and the operator answered "looks good":

1. The post store (`src/posts/`), which saves posts, research documents, and outlines to disk.
2. The AI's file tools, the `/research` skill, and the AI's standing instructions (`src/engine/`, `src/skills/research/`),
   so the AI saves research and outlines to the open post.
3. The server routes and the browser–server messages (`src/server/`, `src/shared/wire.ts`), so the browser can list and
   open them.
4. The left panel and the browser's document handling (`src/ui/`), including opening a research document or outline in
   the editor.

The confirmation also stated, and the operator accepted, that after the change: a `/research` run with a post open
makes a separate research document of that post and leaves the post's text untouched; an outline the AI makes becomes
that post's outline; the left panel shows the open post as a heading with its outline and research documents beneath;
switching to another post goes through the post table on the landing page.

## Direction of Travel

Answered by the request itself: the left panel's list of every post is replaced by the open post with its research
documents and outline. The research skill's "append the report to the open post" behavior is replaced by "save the
report as a research document of the open post".

## Visual Material Received

None received

## Record Provenance

Established by `han-planning:plan-a-change` on 2026-10-19 from the operator's typed request and the confirmation turn.
No earlier record existed in this folder; the API design run (`han-coding:design-an-api`) wrote none.

# Scope Boundary: Replace Claude Code with the Anthropic API

## Work Item

No work item exists. The operator's request, typed into the conversation when invoking `plan-a-change`, is the only
boundary this run has.

## Stated Scope

> "you could skip the claude program by calling the Anthropic API directly, for example through the AI SDK's Anthropic
> provider." - that's what i want to do. i don't want to rely on claude already being installed, or being downloaded /
> built / installed by 3pitor or the makefile build process

## Stated Exclusions

None stated.

## Operator-Stated Scope

The operator answered "looks good" to the confirmation turn, which proposed this area:

- The server code that runs chat turns and background jobs, asks for approvals, and fills the skills-and-agents panel.
- The chat, jobs, and agents panels in the UI, wherever they show things only Claude Code sends today.
- The end-to-end check and debug scripts.
- The `Makefile`, `package.json`, and README.

The same answer confirmed that `build/` should hold only the `3pitor` executable afterwards, with no `claude` file.

Later in the run, answering whether chat should keep running shell commands, the operator stated the product's scope:

> drop commands. the entire point of this project is to be a blog post editor. we're not writing code. we're not
> running CLI tools. we're editing blog posts in markdown files. anything outside of that scope can be dropped

This run treats that as a standing boundary statement. A Claude Code capability that does not serve editing blog posts
in markdown files is dropped rather than rebuilt, and is not escalated again.

## Direction of Travel

Replaced. The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) and `ai-sdk-provider-claude-code` are removed
entirely, not kept as a fallback. Confirmed by the operator ("looks good").

## Visual Material Received

None received

## Record Provenance

Established by `plan-a-change` in this run, 2026-09-25. No record was inherited, and no conflict was resolved. The
Operator-Stated Scope section was extended mid-run with the operator's blog-post-editor statement.

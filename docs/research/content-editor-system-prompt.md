# Research: How should 3pitor's system prompt make the AI a blog-focused content editor instead of a coding assistant?

How should the main chat system prompt in 3pitor be written so the AI behaves as a content editor for blog posts and
other prose, and does not drift into acting like a software engineer?

Evidence mode: strict (the default).

## Summary

Rewrite the system prompt around a clear editor role, and describe the job rather than list what is forbidden. Say
plainly that 3pitor exists to write and edit blog posts. Describe how a good editor works with the writer: structure
first, then sentences, then grammar, then typos. Keep the writer's voice, and ask before large rewrites.

Handle code with a short, reasoned boundary instead of a ban. Code inside a technical post is part of the post, so the
editor reads it, checks the prose against it, and fixes it like any other passage. Building software, or adding a
program to a post that isn't about it, is outside what 3pitor is for. When asked, the editor says so briefly and offers
to help with the writing. Add two or three short example exchanges that show this behavior.

The app's tools already stop the AI from running anything or saving anything but markdown. They do not stop it from
writing code in chat, reading source files in the workspace, or pasting a program into a post. Those gaps are what the
prompt has to cover.

How solid this is: the prompt-writing advice comes from two Anthropic documents that agree, though both come from the
same company. The editing-levels advice is well corroborated. No source tests which way of keeping Claude away from code
works best, so the new prompt needs a short hand-run check against off-topic requests.

- **Confidence:** Medium
- **Web search:** used

## Research Results

### Today's prompt names the job but not the craft

The current prompt opens with one sentence of role: "the writing assistant inside 3pitor, an editor for blog posts
written in markdown" (A8). The rest of it is tool mechanics: relative paths, read before editing, how edits show up, how
highlights work, and how to use skills (A8). It says nothing about how to edit, what a blog post needs, or what to do
with a request that isn't about writing. The README describes the product the same way (A13).

Each turn adds only the open file's name (A9). The write-side tool descriptions (Write, Edit, Highlight) talk about
"markdown posts", but Read and Glob are described in terms of any workspace file (A10). The built-in
collaborative-draft-editing skill carries detailed editing method, but only while that skill is running (A14).

A test asserts the prompt's exact text, so any rewrite has to update it (A12).

### A role sets tone and focus, not accuracy

Anthropic's guidance says a role in the system prompt focuses Claude's behavior and tone, and that even one sentence
makes a difference (A1). Two studies reported, at the abstract level, that assigning a persona does not make factual
answers more accurate (A3, A4). So the role's job here is to set register, priorities, and scope. The editing method
itself still has to be written out.

### Say what to do, and say why

Anthropic recommends telling Claude what to do instead of what not to do, and explaining the reason behind an
instruction, because the model generalizes from the reason (A1). Its guide to building agents asks for a prompt at the
"right altitude": specific enough to guide behavior, but built on strong heuristics instead of brittle if-then rules. It
also advises starting minimal and adding rules only when testing shows a failure (A2). Newer Claude models also follow the system prompt closely enough that shouted words like
"CRITICAL" or "NEVER" cause over-reaction (A1).

Two caveats apply. A1 gives the "what to do instead" advice for output format, so applying it to topic scope is an
inference, not a tested result. A1 and A2 also come from the same vendor, so they agree but are not independent.

Practitioner write-ups describe a "pink elephant" effect: naming a forbidden topic keeps it in play (A5). This is
anecdotal and not tested on Claude [single-source], so it is a reason for caution, not proof.

### Short examples are the usual way to fix refusal style

Anthropic recommends a few varied examples, wrapped in their own tags, to show the model the behavior you want (A1,
A2). Two or three short exchanges can show exactly how the editor answers an off-topic request and how it handles a
code block inside a post, which is hard to get right with rules alone.

### Code in this writer's posts is content, not a task

A flat "do not write code" rule would break this writer's case. The writer's own blog posts are long technical pieces
built around running code examples (A16) [single-source]. An editor for those posts has to read code blocks, check
that the prose matches them, and fix a typo in a snippet. That profile describes one writer's past work, so it shows the
need is real here without showing it for every 3pitor user.

### Code limits cover running and saving, not writing

The model's tools are Read, Write, Edit, Glob, and Highlight, and only markdown files can be written (A8, A10).
Subagents are limited to Read and Glob, and any other tool an agent file asks for is dropped (A11). When the
collaborative-draft-editing skill is running, it tells the model directly that there is no shell, no git, and no network
(A14). Nothing can execute code.

Three gaps remain, and only the prompt can shape them. First, the model can write code in chat. Second, it can Read any
file in the workspace, including source code, which could pull it into code review (A10). Third, because Write and Edit
accept any markdown, it can paste a whole program into a post as a code block.

### The editing craft has a standard shape

Editors and style references agree on four levels of editing, from broad to narrow. Developmental editing covers
structure and argument, line editing covers sentences and style, copyediting covers grammar and consistency, and
proofreading is the final error pass. The work runs in that order (A7). Developmental feedback is usually given as
comments and questions, not rewrites (A7).

No source was found for blog-specific craft: headline, opening hook, scannable structure, calls to action, or how to
phrase feedback. Those items are not evidenced here, and should come from the writer's own judgment. The writer's voice
profile is the best local reference for what "preserve the voice" means (A16).

### Structure the prompt in labeled sections, fixed text first

Anthropic recommends separating a prompt into labeled sections, using XML tags or headers, for role, background,
instructions, and tool guidance (A1, A2). Its caching docs say stable content should come first and changing content
after it, because a change invalidates everything that follows (A6) [single-source, vendor authoritative]. 3pitor does
not turn on prompt caching today (A15), so a longer prompt costs its full input tokens on every turn. Putting the fixed
editor instructions ahead of the per-turn skill list keeps caching available later.

### Nothing directly compares the ways of scoping the model

No source was found that tests, for Claude, whether a positive-only role, an explicit ban, a reasoned boundary, or
tool limits best keep the model out of coding. The options below are weighed on Anthropic's general guidance, not on a
head-to-head test.

## Options to Consider

### O1: Rich editor role that never mentions code

- **What it is:** Describe the editor's job, audience, and method in detail, and leave code out of the prompt entirely.
- **Trade-offs:** Avoids naming the thing to avoid (A5) and follows "say what to do" (A1). It gives the model no
  guidance for a post full of code, or for a direct request to write a program. How Claude behaves in those cases
  without guidance is not evidenced. The gap to O3 is small: one sentence describing the editor as working on "prose and
  the code inside posts" moves O1 most of the way there.
- **Rests on:** (A1), (A5)
- **Evidence status:** general principle corroborated by one vendor (A1, A2); its transfer to topic scope is reasoning;
  priming risk single-source (A5)

### O2: Explicit prohibition on writing code

- **What it is:** Add a rule such as "Do not write code or help with programming."
- **Trade-offs:** Direct and short. It conflicts with editing this writer's technical posts (A16). It is the negative,
  unexplained form Anthropic advises against, and strong wording tends to over-trigger on newer models (A1).
- **Rests on:** (A1), (A16)
- **Evidence status:** no source supports it; A1 and A2 advise against its form

### O3: Editor role plus a short, reasoned boundary

- **What it is:** Describe the editor's job and method, and state why 3pitor exists. Say in one or two sentences that
  code inside a post is content to edit like any other passage, while building software, reviewing source files, or
  adding a program to a post that isn't about it falls outside what the app is for. When asked, the editor says so and
  offers to help with the writing.
- **Trade-offs:** Covers the technical-post case, the off-topic request, and the gaps the tools leave open. It follows
  the "explain why" and "heuristics over rules" guidance (A1, A2). It does mention code, so it carries some of the
  priming risk (A5).
- **Rests on:** (A1), (A2), (A10), (A16)
- **Evidence status:** reasoned from guidance corroborated by one vendor (A1, A2); the code-as-content need is
  single-source (A16)

### O4: Rely on the tool limits alone

- **What it is:** Keep the prompt as it is and trust the tool set to keep the model on task.
- **Trade-offs:** Already in place (A8, A10, A11). It stops code from running and non-markdown files from being saved.
  It does nothing about code in chat, reading source files, programs pasted into posts, or editing quality.
- **Rests on:** (A8), (A10), (A11)
- **Evidence status:** codebase evidence for what exists; no source evaluates it as a way to keep a model in scope

### O5: O3 plus two or three example exchanges

- **What it is:** O3, with a small set of short examples in their own tagged section. One shows a request to write a
  program answered with a brief redirect to the writing. One shows a typo fixed inside a code block in a technical post.
- **Trade-offs:** Shows tone and boundary behavior directly instead of describing it (A1, A2). Adds a little length on
  every turn, and caching is off today (A15). Examples can be over-copied, so they should vary.
- **Rests on:** (A1), (A2), (A15)
- **Evidence status:** use of examples corroborated by one vendor (A1, A2); their effect on scope is untested

Two other shapes were considered and set aside. Moving the editing method into a skill and keeping the base prompt thin
already partly exists (A14), but a skill only governs the turns where it runs, so it cannot set the editor's default
behavior in ordinary chat. Splitting the editor into a subagent behind a thin router adds a model call and a layer of
routing for no scope benefit the evidence shows. Neither is carried as an option.

## Recommendation

- **Recommendation:** O5: an editor role with a short, reasoned boundary around code, plus two or three example
  exchanges, kept on top of the tool limits that already exist (O4). Rewrite the fixed part of the prompt in labeled
  sections: the role and the app's purpose, the writer and their voice, the editing levels and their order, when to
  suggest versus change, how to treat code, examples, and the existing tool mechanics. Keep the skill list after it.
  Write in calm, plain language with reasons, not capitalized rules. Update the pinned prompt test (A12). Then run a
  short list of requests by hand. Examples are "write a Python script to rename my files", "add a function to a source
  file", "review this code file", and "fix the typo in this post's code sample". Add rules only for the failures that
  show up.
- **Evidence basis:** The positive, reasoned framing, the section layout, and the use of examples rest on guidance from
  two documents by one vendor (A1, A2). They agree, but are not independent, and applying the framing advice to topic
  scope is reasoning. The editing levels are corroborated across three sources (A7). The need to treat code as post
  content rests on the writer's own material, a single provided source (A16). The tool limits and their gaps rest on
  codebase evidence (A8, A10, A11). The fixed-first ordering rests on a single vendor source (A6). No source shows which
  scoping method works best for Claude, so the recommendation includes a check step instead of claiming O5 outperforms
  the others. Blog-specific craft (headlines, hooks, calls to action) is not evidenced and should come from the writer.

## Validation

### V1: The codebase line anchors hold

- **Strategy:** Challenge the Evidence
- **Investigation:** Read each cited range for the prompt, the open-file text, the pinned test, the built-in subagent
  and subagent tool filter, the README, and the skill, and checked git history on the prompt file.
- **Result:** Confirmed
- **Impact:** None. The pinned test (A12) was not cited in the draft; the report now says the rewrite must update it.

### V2: The tool descriptions are only partly about posts

- **Strategy:** Challenge the Evidence
- **Investigation:** Read the tool descriptions. Write, Edit, and Highlight say "markdown post". Read and Glob describe
  any workspace file, and Read has no markdown restriction.
- **Result:** Partially Refuted
- **Impact:** The report now narrows the claim to the write-side tools and names reading source files as a gap the
  prompt must cover.

### V3: Prompt caching is not configured

- **Strategy:** Challenge the Evidence
- **Investigation:** Searched the server code for any cache setting.
- **Result:** Confirmed
- **Impact:** None. The report now notes the per-turn token cost of a longer prompt.

### V4: The writer's profile supports the code-in-posts need only for this writer

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Read the voice profile. It describes long, code-heavy technical posts, drawn from one writer's past
  work, and it lives outside the repository.
- **Result:** Partially Refuted
- **Impact:** The report now says a flat ban "would break this writer's case" and keeps the single-source label.

### V5: The "say what to do" advice was given for format, not scope

- **Strategy:** Challenge the Evidence
- **Investigation:** Compared the claim to A1's own summary, which frames it as advice on output format.
- **Result:** Partially Refuted
- **Impact:** The report now labels its application to topic scope as reasoning, and O1 to O3 no longer claim
  corroboration for it.

### V6: The persona studies are abstract-level and off-target

- **Strategy:** Challenge the Evidence
- **Investigation:** Checked what was retrieved for A3 and A4. Both are factual-accuracy results read from abstracts or
  snippets.
- **Result:** Partially Refuted
- **Impact:** Softened to "reported, at the abstract level". Nothing in the recommendation rests on them.

### V7: Two citations stretched past their sources

- **Strategy:** Challenge the Evidence
- **Investigation:** Traced every inline citation to its registry entry. The skill's "no shell" statement was cited as if
  always active, and O4 cited A2's "keep tools small" as support for relying on tools alone.
- **Result:** Partially Refuted
- **Impact:** The report now says the skill statement applies "when the skill is running", and A2 is removed from O4.

### V8: The option set was missing example exchanges

- **Strategy:** Challenge the Options Framing
- **Investigation:** Checked A1 and A2 for methods the options ignored. Both recommend a few varied examples. A
  skill-only approach and a subagent split were also unweighed.
- **Result:** Refuted
- **Impact:** Added O5 (O3 with examples) and made it the recommendation. Added a short note on why a skill-only approach
  and a subagent split were set aside.

### V9: O3 over O1 rests on reasoning, not corroborated evidence

- **Strategy:** Challenge the Recommendation
- **Investigation:** Compared O1 and O3's evidence. The deciding difference is how each handles code, and no source
  tests that. O1's "falls back to general-assistant defaults" had no source.
- **Result:** Partially Refuted
- **Impact:** Relabeled O3's evidence status as reasoned from guidance, removed the unsourced fallback claim from O1,
  and noted that the gap between O1 and O3 is small. The recommendation survives in strict mode because it claims no
  ranking and carries a check step.

### V10: A1 and A16 are load-bearing single points

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Removed each web or provided source in turn. Dropping A5, A3, A4, A6, or A7 leaves the
  recommendation standing. Dropping A1 removes most of the framing support, and A2 is from the same vendor. Dropping A16
  removes the evidence for treating code as content.
- **Result:** Partially Refuted
- **Impact:** The Summary and Evidence basis now say A1 and A2 share a vendor.

### V11: No sign of planted or directive content

- **Strategy:** Challenge the Evidence-Gathering Integrity
- **Investigation:** Checked the recorded source content for instruction-like text and for implausibly convenient
  sources.
- **Result:** Confirmed
- **Impact:** None. The low-authority sources behind A5 were already marked anecdotal.

### V12: The tool limits miss programs pasted into posts

- **Strategy:** Challenge the Recommendation
- **Investigation:** Read the markdown-only write check. Any markdown content is allowed, so a whole program can be
  written into a post as a code block.
- **Result:** Partially Refuted
- **Impact:** The boundary in O3 and O5 now covers adding a program to a post that isn't about it, and the hand-run
  check list includes requests that probe it.

### How validation changed the recommendation

Validation changed the recommendation from O3 to O5 (O3 plus examples). It also narrowed the claims about tool
descriptions and tool limits, and relabeled several evidence statuses from "corroborated" to "reasoned" or
"single-source". It noted that A1 and A2 share a vendor, and added the pinned test and a concrete check list to the
recommendation.

### Confidence is medium, and the remaining risks

- **Confidence:** Medium
- **Remaining Risks:** No option has been tested on Claude; the hand-run check is the only guard. A1 and A2 come from one
  vendor. A3, A4, A5, and A7 rest on search snippets or abstracts, not full reads. A16 is outside the repository, may
  reflect older posts, and describes one writer. A longer prompt adds input cost on every turn while caching is off.

## Sources

| ID  | Source | Link / location | Retrieved | Trust class | Summary (one line) | Evidence status |
| --- | ------ | --------------- | --------- | ----------- | ------------------ | --------------- |
| A1  | Anthropic, Prompting best practices | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices | 2026-09-29 | web | A role focuses tone and behavior; for format, say what to do rather than what not to; explain why; use XML sections and a few examples; avoid emphatic "CRITICAL/NEVER" wording | corroborated by A2 (same vendor) |
| A2 | Anthropic Engineering, Effective context engineering for AI agents | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | 2026-09-29 | web | Write prompts at the "right altitude" with heuristics over brittle rules; start minimal and add from failures; section the prompt; use a few canonical examples; keep tools small | corroborated by A1 (same vendor) |
| A3 | Zheng et al., "When 'A Helpful Assistant' Is Not Really Helpful" (EMNLP Findings 2024) | https://arxiv.org/abs/2311.10054 | 2026-09-29 | web | 162 personas across 4 model families gave no accuracy gain on 2,410 factual questions (abstract page) | corroborated by A4 on accuracy |
| A4 | Prompting Science Report 4, "Playing Pretend" | https://arxiv.org/pdf/2512.05858 | 2026-09-29 | web | Expert personas do not improve factual accuracy (title and snippet only) | corroborates A3 |
| A5 | "Pink elephant" write-ups on negative instructions | https://eval.16x.engineer/blog/the-pink-elephant-negative-instructions-llms-effectiveness-analysis ; https://dev.to/cleverhoods/do-not-think-of-a-pink-elephant | 2026-09-29 | web | Naming a forbidden topic can keep it active; rephrase as positive instructions (anecdotal, not Claude-specific) | single source (caveated) |
| A6 | Anthropic, Prompt caching | https://platform.claude.com/docs/en/build-with-claude/prompt-caching | 2026-09-29 | web | Cache order is tools, system, messages; a change invalidates everything after it; put stable content first | single source (caveated; vendor authoritative) |
| A7 | Editorial Freelancers Association; Jane Friedman; Editorial Institute, on editing levels | https://www.the-efa.org/editorial-services-definitions/ ; https://janefriedman.com/the-differences-between-line-editing-copy-editing-and-proofreading/ ; https://blog.the-ei.org/2026/05/23/four-levels-of-editing/ | 2026-09-29 | web | Four levels (developmental, line, copyedit, proofread) run broad to narrow; developmental feedback is usually comments, not rewrites | corroborated across the three sources |
| A8 | 3pitor main chat prompt | `src/server/chat/agent/agent.ts:103-113` | n/a | codebase | One role sentence, tool mechanics, and a per-turn skill list; nothing on editing method or off-topic requests | codebase anchor |
| A9 | Open-file context per turn | `src/server/chat/sessions/sessions.ts:54-62` | n/a | codebase | Each turn adds only "The file open in my editor is …" to the user message | codebase anchor |
| A10 | Tool descriptions and the markdown-only write check | `src/server/chat/tools/tools.ts:66-120`, `:152-160` | n/a | codebase | Write, Edit, Highlight describe markdown posts; Read and Glob cover any workspace file; only .md files can be written, with any content | codebase anchor |
| A11 | Built-in subagent and subagent tool filter | `src/server/workspace-config/workspace-config.ts:32-39`, `:95` | n/a | codebase | The title-writer subagent reads only; subagents are limited to Read and Glob | codebase anchor |
| A12 | Test pinning the prompt text | `src/server/chat/agent/agent.test.ts:17-28` | n/a | codebase | The exact prompt text is asserted, so any rewrite must update this test | codebase anchor |
| A13 | README purpose statement | `README.md:1-8` | n/a | codebase | Describes 3pitor as an editor for blog posts written in markdown, with Claude built in | codebase anchor |
| A14 | collaborative-draft-editing skill | `src/skills/collaborative-draft-editing/SKILL.md:12-26` | n/a | codebase | While running, carries detailed editing method and tells the model it has no shell, git, or network | codebase anchor |
| A15 | No prompt caching configured | `src/server` (no `cacheControl` or `providerOptions` anywhere) | n/a | codebase | Prompt caching is not turned on for any model call today | codebase anchor |
| A16 | The writer's voice profile | `provided: han-communication/references/writing-voice.md` | n/a | provided | The writer's blog posts are long technical pieces built around running code examples, in a warm first-person voice | single source (caveated) |

### A1: Anthropic, Prompting best practices — recommendation-bearing

- **Link / location:** https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- **Retrieved:** 2026-09-29
- **Trust class:** web (outside the trust boundary; vendor primary source)
- **Summary:** A role in the system prompt focuses Claude's behavior and tone, and even one sentence makes a difference.
  Explaining the reason behind an instruction helps, because Claude generalizes from the explanation. For format, tell
  Claude what to do instead of what not to do. Separate instructions, context, and examples with XML tags, and use a
  few varied examples. Newer models follow the system prompt closely, so emphatic "CRITICAL / MUST" language should be
  dropped.
- **Evidence status:** corroborated by A2 (same vendor, not independent)

### A2: Anthropic Engineering, Effective context engineering for AI agents — recommendation-bearing

- **Link / location:** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- **Retrieved:** 2026-09-29
- **Trust class:** web (outside the trust boundary; vendor primary source)
- **Summary:** Write the system prompt at the "right altitude": specific enough to guide behavior, but with strong
  heuristics instead of brittle if-then logic. Use the smallest set of information that fully outlines expected
  behavior, start minimal, and add instructions when you see failures. Split the prompt into labeled sections, use a few
  diverse canonical examples rather than a list of edge cases, and keep the tool set small.
- **Evidence status:** corroborated by A1 (same vendor, not independent)

### A7: Editing levels — recommendation-bearing

- **Link / location:** https://www.the-efa.org/editorial-services-definitions/ ;
  https://janefriedman.com/the-differences-between-line-editing-copy-editing-and-proofreading/ ;
  https://blog.the-ei.org/2026/05/23/four-levels-of-editing/
- **Retrieved:** 2026-09-29 (search results; pages not read in full)
- **Trust class:** web (outside the trust boundary)
- **Summary:** Editing has four levels in order of scope. Developmental editing covers structure and comes first, often
  as critique and comments. Line editing covers sentence-level language and style. Copyediting covers grammar, usage,
  and consistency. Proofreading is the final error pass. Work moves from big problems to small.
- **Evidence status:** corroborated across three independent sources

### A10: Tool descriptions and the markdown-only write check — recommendation-bearing

- **Link / location:** `src/server/chat/tools/tools.ts:66-120`, `:152-160`
- **Retrieved:** n/a
- **Trust class:** codebase (trusted current-state anchor)
- **Summary:** Write, Edit, and Highlight are described as working on markdown posts. Read is described as reading any
  file in the workspace, and Glob as listing any workspace files. Writes are limited to `.md` files outside dot-folders,
  but any content is accepted, including a code block.
- **Evidence status:** codebase anchor

### A16: The writer's voice profile — recommendation-bearing

- **Link / location:** `provided: /Users/mxriverlynn/dev/testdouble/han/han-communication/references/writing-voice.md`
- **Retrieved:** n/a
- **Trust class:** provided (user-supplied; interested-party scrutiny)
- **Summary:** Describes the writer's long-form blog posts as 10–40 KB technical pieces with many code blocks
  interleaved with prose, built around one running example, in a warm first-person voice with direct "you" address.
  Drawn from one writer's past work; lives outside the repository.
- **Evidence status:** single source (caveated)

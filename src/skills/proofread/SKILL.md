---
name: proofread
description: >
  Proofreads one blog post in a single turn without asking questions: fixes spelling, typos, grammar, punctuation,
  capitalization, repeated words, inconsistent spellings, hyphenation, and number style, and broken markdown
  formatting, then highlights every changed passage in the editor until the writer saves. Use when the writer asks to
  proofread, spell-check, fix typos, or give a post a final pass before publishing. Makes only small edits that keep
  the writer's meaning and wording and never touches code. Does not rework flow, length, structure, or voice; use
  collaborative-editing to edit a draft together section by section, or research to research a topic.
argument-hint: "[post path]"
---

# Proofread

The steps below are the whole skill. It runs in one turn, start to finish, and never stops to ask the writer anything,
BECAUSE the writer asked for a finished pass they can review, not a conversation.

Your tools are Read, Write, Edit, Glob, and Highlight. Everything you Write or Edit appears in the writer's editor as
an unsaved change, and the writer saves it. A turn has a limit of 20 tool calls.

## Step 1: Find the Post

1. When the argument names a path, that is the post. When it names none, use the file open in the editor.
2. When there is no path and no open file, or the path does not exist, say so in one line and end the turn. Do not
   guess at a post.
3. Read the post whole.

## Step 2: Find the Writer's Style

Glob `CLAUDE.md` and `AGENTS.md` at the workspace root, Read the ones that exist, and follow any spelling, hyphenation,
number, or capitalization rule they give. Where they give none, the post's own majority usage is the rule: when it
spells a word two ways, use the spelling it uses most.

## Step 3: Fix the Post

Fix only these, and only where the fix is clear:

- spelling mistakes and typos
- grammar: agreement, tense slips, missing or doubled words
- punctuation, including stray or missing spaces
- capitalization of names, product names, and headings, kept to the post's heading style
- the same word repeated by mistake, as in "the the"
- inconsistent spelling, hyphenation, and number style, made consistent with Step 2's rule
- broken markdown: unclosed emphasis, a link missing its bracket or parenthesis, a list item missing its marker

Rules for every fix:

- **Leave anything ambiguous alone.** When a fix could change what a sentence says, or you cannot tell which word was
  meant, do not change it. Note it for the summary instead.
- **Never touch code.** Leave fenced code blocks and inline code exactly as they are, comments included, BECAUSE a
  proofread must never change how a sample reads or runs. Never change a link's URL either.
- **Spend few tool calls.** Use one Edit per fix when there are a handful. When there are many, make them all in one
  Write of the whole post, BECAUSE the turn's 20-call limit must leave room for the Highlight call. A Write must keep
  every line you did not fix exactly as it was.
- **Keep the writer's meaning and wording.** Change the fewest words that make the text correct. Never rewrite a
  sentence for style, flow, length, or tone, BECAUSE that is line editing, which the writer did not ask for, and
  collaborative-editing is where it happens.

When the post needs no fixes, make no edits and no Highlight call, say so in one line, and end the turn.

## Step 4: Highlight the Changes

Read the post again, then make exactly one Highlight call on it, with `until_saved: true` and one passage per change.
Each call replaces the highlights before it, so one call must cover every change.

- Quote the text as it reads now, after the fix, copied from the post you just read.
- Keep each quote within one paragraph, heading, or list item, and long enough to occur only once in the post: add
  words around a one-word fix until the quote is unique.
- Give no `label` and no `question`, BECAUSE these highlights mark changes already made rather than ask anything, and
  a label would show a question pill with nothing behind it.

When Highlight refuses a quote, fix that quote and call it again with every passage.

## Step 5: Summarize

End the turn with a short summary in the chat:

1. The changes, grouped by kind (spelling, grammar, punctuation, consistency, formatting), each as the old text and
   the new, as in `recieve → receive`. Name a kind with many changes by count and a few examples.
2. What you left alone and why: each ambiguous passage from Step 3, and any mistake you saw in code.
3. One closing line: the changes are highlighted in the editor as unsaved edits, and the highlights clear once the
   writer saves the post.

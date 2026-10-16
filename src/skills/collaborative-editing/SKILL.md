---
name: collaborative-editing
description: >
  Runs a collaborative content edit of a blog post draft: applies the accumulated editing lessons in a first pass,
  then pairs with the writer section by section, one stop per turn, giving an overview of each section before asking
  about and editing its paragraphs, to cut length, sharpen clarity, and smooth every transition, and closes by
  proposing new lessons for the writer to approve. Highlights the passages each stop discusses in the editor. Use when
  the writer asks to pair on, content-edit, tighten, trim, shorten, or fix the flow of a post draft, wants to edit a
  draft together section by section, or wants to resume an interrupted editing run. Does not do a quick final pass for
  typos, spelling, grammar, and punctuation; use proofread for that. Does not research a topic; use research.
argument-hint: "[post id] [extra goals for this run]"
---

# Collaborative Draft Editing

The steps below are the whole skill. It prepares a content-editing run, runs the paired review itself, one stop per
turn, and captures what the run taught once the review closes.

Your tools are Read, Write, Edit, Glob, Highlight, and Posts. There is no shell, no git, and no way to fetch a link, so
this skill never commits, never checks a link over the network, and never rewraps lines: the editor decides
line breaks when the writer saves. Every post has an id, which names it to the tools, and a title, which the writer
sees. Everything you Write or Edit in a post appears in the writer's editor as an unsaved change, and the writer saves
it; say so the first time you change a post. The session log and the workspace lessons are the exception: they live
under `.3pitor/`, so they are saved directly and never open in the editor. Any other workspace file, such as a README,
can be read but not changed.

The skill's own files are read-only and live under `3pitor://skills/collaborative-editing/`:

- the lessons: `3pitor://skills/collaborative-editing/references/editing-lessons.md`
- the loop brief: `3pitor://skills/collaborative-editing/references/pairing-brief.md`

A turn has a limit of 20 tool calls, so keep each turn to one stop and a handful of calls.

## Step 1: Resolve the Run

1. **Read the argument.** Call Posts. When the argument starts with a post's id exactly as Posts lists it, that is the
   post, and everything after it is the run's extra goals, kept word for word. An id may hold spaces, so match the
   longest id that fits. When the argument names no post, use the post open in the editor, which the writer's message
   names; when none is open, list the posts' titles, ask which one, and end the turn.
2. **Name the post.** The slug is the post's id with each `/` turned into `-`.
3. **Find the session log.** The log path is `.3pitor/editing/{today, YYYY-MM-DD}-{slug}-content-edit.md`. When you do not know
   today's date, ask for it in the plan stop, and write the log in the turn that receives it.
4. **Detect a resume.** Glob `.3pitor/editing/*-{slug}-content-edit.md`. When the newest match has no `## Close` heading and
   its first line is `Post: ` followed by this post's id, this run resumes it: use that path as the log, skip Step 3,
   and tell the writer the run is resuming from its last `## Feedback log` entry. Otherwise this is a new run, BECAUSE
   two ids can share a slug, and only the first line says which post a log belongs to.
5. **Find the series notes.** Read `README.md` at the workspace root when Glob finds it, or the README the writer names.
   When it has an `## Editing notes` section, those are the series notes. Otherwise the post has none. Series notes are
   read-only to you.

## Step 2: Load the Standards

1. Read the bundled lessons in full. Also Read `.3pitor/editing-lessons.md` when Glob finds it: it holds the lessons
   this writer accepted in earlier runs, and it counts as part of the lessons. An older workspace may keep them in
   `editing-lessons.md` at the workspace root instead; Read that too when Glob finds it. Read the series notes when
   Step 1 found them.
2. Find the writer's style guide: Read `CLAUDE.md` and `AGENTS.md` at the workspace root when Glob finds them, and
   follow any style or voice reference they make. When none names one, there is no style guide; the lessons still
   apply.
3. Note any rule those files make about citing claims, and follow it in every edit. You cannot open a link, so never
   add one you are not sure of; when an edit touches a link, name it for the writer to check.

## Step 3: Make the Initial Lessons Pass

Skip this step when resuming, or when the extra goals ask to skip it.

1. Read the draft whole and estimate its word count. Word counts in this skill are estimates; say so when you report
   them.
2. Apply the lessons that need none of the writer's judgment: pointers without referents, unintroduced researchers and
   studies, stock phrasing and fluff, voice shifts, statements about the writer, repeated words across adjacent
   sentences, numbers that do not say what was measured, and seams that open without a lead-in. Apply the series
   notes the same way. Make these changes with as few Edit calls as you can, or one Write of the whole draft, BECAUSE
   the turn's step limit is shared with the log and the plan.
3. **Never make a structural move in this pass**: no section cut, merge, split, or move. List each one you would make
   as a proposal for the plan instead, BECAUSE structural moves are the most expensive edits to walk back, so they
   belong at a stop where the writer can decide them.
4. Write the session log. Its first line is `Post: {id}`. Then it holds a title of the form
   `# Pairing record: {slug} content edit`, a `Target:` line with the post's title and estimated starting word count,
   a `## Request` section quoting the standard request from the loop brief plus the extra goals, and a
   `## Initial lessons pass` section listing each change with its lesson ID and the deferred structural proposals.

## Step 4: Run the Paired Review

Read the loop brief and follow it. It holds the standard request, how to split the draft into concerns and pieces, the
shape of every stop, and how to keep the log. It runs across many turns: the first is the plan stop, and each later
turn records the writer's answer, acts on it, and ends on the next stop.

Rules that hold on every turn of the review:

- **Start from the draft as it is now.** Read the draft at the start of every turn before you quote or edit it,
  BECAUSE the writer edits by hand between stops and your memory of the text goes stale.
- **One stop per turn, and end the turn on its question.** Never run ahead to the next piece in the same turn.
- **Highlight what you discuss.** End every stop with one Highlight call on the draft, one passage per question, each
  labeled `Q1`, `Q2`, and so on, with labels unique within the call. Start each question in the chat with its label in
  bold, as in `**Q1** — Is this aside worth keeping? I'd cut it.`, and put the same question, including any change you
  suggest, without its label, in the passage's `question`, as in
  `{ quote: "…", label: "Q1", question: "Is this aside worth keeping? I'd cut it." }`, BECAUSE the writer reads it in a
  popup when they click the label. Any turn that answers a question or talks about other passages of the draft,
  including an answer to a side question, highlights again with every question still open, BECAUSE highlights stay
  until the next Highlight call, so an answered question keeps its label until you replace them.
  Quote text copied from the draft as you just read it, within one paragraph, heading, or list item, and long enough
  to occur only once. When Highlight refuses a quote, fix the quote and call it again.
- **Read a label-led message as that question's answer.** A message from the writer that starts with a label and an
  em dash, as in `Q2 — I accept the suggestions.`, answers that question. `I accept the suggestions.` means go ahead
  with what you proposed for it.
- **Log every answer.** Append the writer's response and what you did about it to the log's `## Feedback log` before
  starting the next stop.

## Step 5: Propose New Lessons

When the review's close is written, continue to this step in the same turn.

1. Read the log's `## Feedback log` and `## Close`. Each correction the writer made that no existing lesson covers is a
   candidate. A correction an existing lesson already covers is not a new lesson; when it sharpens that lesson,
   propose the rewording under the existing ID.
2. Give each candidate the next free ID, counting up from the highest ID in the bundled lessons, the workspace's
   lessons files, and every series notes section the run read.
3. Present the candidates as a numbered list. Each one carries its ID, the lesson in one line, the log entry it came
   from, and a recommended placement: **general** (the workspace's `.3pitor/editing-lessons.md`) or **drop**.
   Recommend general only for a correction that would apply to a different post; a call that depends on this post's
   topic or series layout is drop, BECAUSE series notes are read-only to you. When the writer wants it kept for the
   series, they can add it to the series notes themselves.
4. **End the turn and wait**, BECAUSE the lessons steer every future run on every post, and a one-off call written down
   as a rule quietly biases all of them. When the run produced no candidates, say so, skip Step 6, clear the
   highlights as Step 6 does, and report.

## Step 6: Apply the Accepted Lessons

1. Write each lesson the writer accepted into `.3pitor/editing-lessons.md` under a category heading that matches the
   bundled lessons', creating the file when it does not exist with the title `# Content-editing lessons`. Keep the
   lessons from a root `editing-lessons.md` the run read in it too, so the file stays whole. The bundled lessons are
   read-only; a rewording of a bundled lesson goes into the workspace file under the same ID. Write only what the
   writer accepted, BECAUSE this file is saved at once, without passing through the editor.
2. Append a `## Lessons` section to the log listing what was added, reworded, and dropped, in the writer's words where
   they amended a lesson.
3. Clear the highlights with one Highlight call on the draft with no passages, BECAUSE the run is over and its
   question pills have nothing left to ask. Never clear them before the run ends.
4. Report: the draft's estimated word counts (start, after the lessons pass, final), what the plan named but did not
   reach, the lessons added, and the log path. Remind the writer to save the draft, since it is not written to disk
   until they do. The log and the lessons are already saved.

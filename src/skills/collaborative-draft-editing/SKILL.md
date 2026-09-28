---
name: collaborative-draft-editing
description: >
  Runs a collaborative content edit of a blog post draft: applies the accumulated editing lessons in a first pass,
  then pairs with the writer section by section through han-core:pairing, giving an overview of each section before
  asking about and editing its paragraphs, to cut length, sharpen clarity, and smooth every transition, and closes by
  proposing new lessons for the writer to approve. Use when the writer asks to pair on, content-edit, tighten, trim,
  shorten, or fix the flow of a post draft, wants to edit a draft together section by section, or wants to resume an
  interrupted editing run. Does not make one-shot copy edits without pausing — use writer-voice:copy-edit. Does not
  run a readability rewrite — use han-communication:edit-for-readability. Does not outline or draft a new post — use
  writer-voice:initial-outline. Does not pair on code or on writing that is not a post draft — use han-core:pairing.
argument-hint: "[draft path] [extra goals for this run]"
allowed-tools:
  Read, Write, Edit, Glob, Grep, Skill, Bash(find *), Bash(wc *), Bash(git status *), Bash(git diff *),
  Bash(git log *), Bash(git add *), Bash(git commit *), Bash(curl -s *)
---

## Project Context

- project .han/config.md: !`cat .han/config.md 2>/dev/null || echo ""`
- instruction files: !`find . -maxdepth 1 \( -name CLAUDE.md -o -name AGENTS.md \) -type f`
- project rules: !`find .claude/rules -name "*.md" -type f 2>/dev/null`
- git repository: !`git rev-parse --is-inside-work-tree 2>/dev/null || echo "not a git repository"`
- recent commits: !`git log --oneline -15 2>/dev/null || echo ""`

# Collaborative Draft Editing

The steps below are the whole skill. It prepares a content-editing run, hands the pairing loop to `han-core:pairing`,
and captures what the run taught once pairing closes. It does not pace the stops itself, BECAUSE the collaborative stop
rule lives in `han-core:pairing` and a second copy here would drift from it.

## Step 1: Preflight and Resolve the Run

1. **Confirm `han-core:pairing` is available** by checking the skills listed for this session. If it is missing, stop
   and tell the writer this skill needs the `han-core` plugin installed. Never hand-roll the pairing loop in its place,
   BECAUSE the stop rule is what keeps the writer in the lead, and an improvised loop drifts into editing ahead of
   review.
2. **Read the argument.** The first token is the draft path; everything after it is the run's extra goals, kept word
   for word. When no path is given, list candidate drafts with
   `find . -name "*.md" -path "*draft*" -not -path "./.git/*"`, ask which one, and end the turn. When the path does
   not exist, say so and stop.
3. **Name the post.** The slug is the draft's folder name when the file is a generic name like `draft.md`, and the
   file name without `.md` otherwise.
4. **Resolve the record directory.** Use `{output-directory}/pairing/` when the `project .han/config.md` above sets an
   `output-directory` in its frontmatter, and `.han/pairing/` otherwise. The record path is
   `{record directory}/{today, YYYY-MM-DD}-{slug}-content-edit.md`.
5. **Detect a resume.** Find records for this post with `find {record directory} -name "*{slug}*.md"`. When the newest
   one has no `## Close` heading, this run resumes it: use that path as the record, skip Step 3, and say in Step 4's
   note that the run is resuming. Otherwise this is a new run.
6. **Find the series notes.** Walk up from the draft's folder toward the repository root, stopping below the root, and
   take the first `README.md` found. When it has an `## Editing notes` section, those are the series notes. When no such
   README exists, the post has no series notes.
7. **Note git.** When `git repository` above reads "not a git repository", commits are skipped for the whole run; say
   so in the plan. Otherwise check `git status --porcelain` and name any uncommitted changes to the draft, since the
   first commit will include them.

## Step 2: Load the Standards

1. Read [editing-lessons.md](references/editing-lessons.md) in full, and the series notes when Step 1 found them.
2. Find the writer's style guide: read each file in `instruction files` and `project rules` above and follow any
   style-guide or voice reference they make. When none names one, there is no style guide; the lessons still apply.
3. Find the wrap width: look in the same files for a line-length rule for drafts. A rule gives a width and, when it
   states one, a tolerance. When no rule exists and the extra goals do not name a width, the run does not reflow, and
   Step 4 tells the writer so.
4. Find the commit form: take the message style of the drafting and editing commits in `recent commits` above, and
   pick one of them as the example. When there are none, use `edit: {what changed, naming the post}`.
5. Find the sourcing rule: note any project rule on citing claims, and follow it in every edit. Verify each link an
   edit adds or touches with `curl -s -o /dev/null -w "%{http_code}" -L {url}` before keeping it, BECAUSE a wrong link
   is worse than none.

## Step 3: Make the Initial Lessons Pass

Skip this step when resuming, or when the extra goals ask to skip it.

1. Record the starting word count with `wc -w {draft path}`.
2. Read the draft whole, then apply the lessons that need none of the writer's judgment: pointers without referents,
   unintroduced researchers and studies, stock phrasing and fluff, voice shifts, statements about the writer, repeated
   words across adjacent sentences, numbers that do not say what was measured, and seams that open without a lead-in.
   Apply the series notes the same way.
3. **Never make a structural move in this pass**: no section cut, merge, split, or move. List each one you would make
   as a proposal for the plan instead, BECAUSE structural moves are the most expensive edits to walk back, so they
   belong at a stop where the writer can decide them.
4. Reflow the draft when Step 2 found a width, by running
   `${CLAUDE_SKILL_DIR}/scripts/reflow.py {draft path} --width {width} --tolerance {tolerance}`, dropping
   `--tolerance` when the rule gives none. The script rewraps without changing a word and exits 2 without writing if a
   word would change; treat that as a bug, report it, and leave the draft unwrapped. Record the post-pass word count.
5. Write the record at the record path, creating its directory if needed. It holds a title of the form
   `# Pairing record: {slug} content edit`, a `Target:` line with the draft path and starting word count, a
   `## Request` section quoting the standard request from [pairing-brief.md](references/pairing-brief.md) plus the
   extra goals, and a `## Initial lessons pass` section listing each change with its lesson ID and the deferred
   structural proposals.

## Step 4: Hand the Run to Pairing

1. Read [pairing-brief.md](references/pairing-brief.md) and fill every placeholder:
   - `{draft_path}`, `{record_path}`, `{extra_goals}` from Step 1, and `{lessons_path}` as the full path of
     `${CLAUDE_SKILL_DIR}/references/editing-lessons.md`.
   - `{series_notes_clause}`: ` and the "Editing notes" in {README path}` when series notes exist, else empty.
   - `{resume_note}`: "This run resumes an interrupted one; pick up from the last entry in the feedback log." when
     resuming, else empty.
   - `{style_clause}`: "The voice comes from {style guide path}." when Step 2 found one, else empty.
   - `{reflow_clause}`: with a width, "Whenever the writer says reformat or format, and after every edit, run
     `${CLAUDE_SKILL_DIR}/scripts/reflow.py {draft path} --width {width}`, plus `--tolerance {tolerance}` when set; it
     rewraps without changing words, so the writer's hand edits stay untouched. Report any line it flags as over the
     tolerance." Without a width: "The project sets no wrap width, so reformat means leave line breaks as they are;
     tell the writer they can give a width in the extra goals."
   - `{commit_clause}`: in a git repository, "Commit the initial lessons pass and the record when the writer accepts
     the plan, then commit after each closed concern, in the form of `{example commit}`." Outside one, "This is not a
     git repository, so there are no commits; say so in the plan."
2. Invoke `han-core:pairing` through the Skill tool with the filled brief as its argument. Forward the extra goals
   exactly as the writer gave them; do not summarize or reinterpret them.
3. Pairing now runs its own loop across many turns: it proposes the plan, stops at every piece, and records every
   response. Follow its steps as written until its close step reports.
4. **When pairing's close step finishes, continue to Step 5 of this skill in the same turn**, BECAUSE the moment after
   a sub-skill finishes is where an orchestration most often stops and treats that output as its final answer.

## Step 5: Propose New Lessons

1. Read the record's `## Feedback log` and `## Close`. Each correction the writer made that no existing lesson covers
   is a candidate. A correction an existing lesson already covers is not a new lesson; when it sharpens that lesson,
   propose the rewording under the existing ID.
2. Give each candidate the next free ID, counting up from the highest ID in the lessons file and in every series
   notes section the run read.
3. Present the candidates as a numbered list. Each one carries its ID, the lesson in one line, the log entry it came
   from, and a recommended placement: **general** (the lessons file), **series** (the series notes), or **drop**.
   Recommend general only for a correction that would apply to a different post; a call that depends on this post's
   topic or series layout is series or drop.
4. **End the turn and wait**, BECAUSE the lessons file steers every future run on every post, and a one-off call
   written down as a rule quietly biases all of them. When the run produced no candidates, say so, skip Step 6, and
   report.

## Step 6: Apply the Accepted Lessons

1. Write each accepted general lesson into [editing-lessons.md](references/editing-lessons.md) under its category,
   adding a category heading only when none fits. Update `## What the runs show` only when the run changed a pattern
   it states.
2. Write each accepted series lesson into the series README's `## Editing notes` section, creating the section when it
   does not exist. When the post has no series README, a series lesson is dropped; say so.
3. Append a `## Lessons` section to the record listing what was added, reworded, and dropped, in the writer's words
   where they amended a lesson.
4. In a git repository, commit the lessons file, the series README, and the record together, in the commit form from
   Step 2.
5. Report: the draft's word counts (start, after the lessons pass, final), the commits made, what the plan named but
   did not reach, the lessons added, and the record path.

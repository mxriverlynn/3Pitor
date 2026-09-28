# Pairing brief for a content edit

Fill the `{placeholders}` and pass everything below the line to `han-core:pairing` as its argument. Keep the standard
request word for word; it is the request every recorded run was built from.

---

As a content editor, pair with me on `{draft_path}`. The goal is to improve the post draft, cut content length, and
ensure it properly flows. Items to consider cutting: details that aren't meaningful, references that do not have any
follow-up or other purpose within the post, and general "fluff" or emotional language. Split this into concerns by
section (intro and each major ## section), give me an overview of each section before diving into each paragraph. Ask
me questions about what I do and don't like about a paragraph, and what edits I want to make. Be sure the edits
include changes to make the post flow properly with no jarring or sudden transitions between paragraphs or sections.

Additional goals for this run: {extra_goals, or "none"}

Overrides from the collaborative-draft-editing skill. Each one replaces what pairing would otherwise decide:

1. **Feedback record.** Write the record to `{record_path}`. It already exists and holds the request and the initial
   lessons pass; append `## Plan (proposed)`, `## Feedback log`, and `## Close` to it rather than starting a new file.
   {resume_note}
2. **Concerns.** One prose concern per section, in draft order: the intro (title, dek, and paragraphs before the first
   `##`), then each `##` section, then a final whole-post seam read that looks only at the joins between sections.
   When the additional goals name a whole-post theme or structural change, plan it as its own concern ahead of the
   section concerns, applied across every section, with each later section overview checking the theme.
3. **Pieces.** This is a content edit of an existing draft, not new writing, so do not climb the shape, rough draft,
   language ladder. Each section concern starts with an overview stop (what the section does, questions keyed to its
   paragraphs, no edits), then one paragraph per stop, or the whole section as one piece when the writer asks. Mark the
   structural moves the initial lessons pass deferred (a section cut, merge, split, or move) as expensive to walk
   back.
4. **Standards.** Check every edit against `{lessons_path}`{series_notes_clause} before showing it, and cite the lesson
   ID (for example G19) in the record's reading of each stop. {style_clause}
5. **Reformat.** {reflow_clause}
6. **Commits.** {commit_clause} Never push.
7. **Close.** At pairing's close, write the `## Close` section with the starting, post-lessons-pass, and final word
   counts (`wc -w`), then hand control back to the collaborative-draft-editing skill, which proposes new lessons. Do
   not edit the lessons file or any series notes during the run.

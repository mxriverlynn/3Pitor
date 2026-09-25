---
name: doc-stats
description: Report statistics about a markdown document (heading count, line count, word count). Use when the user asks for document stats.
---

# Document stats

1. Read the markdown file the user names.
2. Count its headings, non-empty lines, and words.
3. Reply with exactly one line in this format, and nothing else:

DOC-STATS: headings=<n> lines=<n> words=<n>

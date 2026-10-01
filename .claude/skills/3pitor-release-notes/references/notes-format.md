# Release Notes Format

## Contents

- Template
- Which changes to include
- Choosing a category
- Grouping changes
- Writing the summary paragraph
- Writing bullets
- Crediting contributors
- Example

## Template

Copy this shape exactly. `scripts/check-notes.ts` enforces it.

```markdown
## v{version} - {date}

{Summary paragraph: 3 to 5 sentences, each 10 to 15 words.}

### New Features

- {thing that changed} - {summary of change} [#{pr}]({pr url}) by [@{login}](https://github.com/{login})

#### {Named change}

- {thing that changed} - {summary of change} [#{pr}]({pr url}), [#{issue}]({issue url}) by [@{login}](https://github.com/{login})
- {thing that changed} - {summary of change}

### Enhancements

- None in this release.

### Bug Fixes

- {thing that changed} - {summary of change}

### Breaking Changes

- None in this release.
```

Rules the template carries:

- All four category headings always appear, in this order: New Features, Enhancements, Bug Fixes, Breaking Changes.
- A category with nothing in it holds exactly one line: `- None in this release.`
- Ungrouped bullets come first in a category, then `####` groups. A bullet after a group would read as part of it.
- Nothing else goes in the section: no links lists, no contributor lists, no horizontal rules.

## Which changes to include

The notes are for people who install and run 3pitor. Include a change only when a user would notice it: a new
command, flag, or behavior, a fix to something they could hit, a changed default, a new way to install, or a user-facing
guide.

Leave out internal-only work BECAUSE it buries the changes users care about:

- Tests, including smoke tests and fixtures.
- CI jobs that only check code (lint, format, type check, test runs).
- Formatting, style, and refactors with no behavior change.
- Planning, research, and contributor-only docs (`docs/changes/`, `docs/research/`).
- Release chores (`chore(release):` commits) and Claude Code skills under `.claude/`. The app's own skills, which ship
  inside 3pitor, are not in `.claude/` and are user-facing.

A change that is internal in form but user-visible in effect is included. A release workflow that makes Homebrew
installs possible counts; a new unit test does not.

One exception: every merged pull request is credited (see Crediting contributors). A pull request whose changes are all
internal-only becomes a single Enhancements bullet that names what it improved for the project, such as
"Dependencies - Bun, React, and other libraries now run their latest releases." Small internal commits inside a
user-facing pull request are still left out.

## Choosing a category

Start from the Conventional Commit type, then correct it by what the change does for a user:

| Signal                                                               | Category         |
| -------------------------------------------------------------------- | ---------------- |
| `!` after the type, or a `BREAKING CHANGE:` footer                   | Breaking Changes |
| A removed or renamed command, flag, or file a user relies on         | Breaking Changes |
| A changed default or output format that breaks an existing workflow  | Breaking Changes |
| `feat`: something a user could not do before                         | New Features     |
| `feat` or `perf`, or user-facing `docs`: an existing thing got better | Enhancements     |
| `fix`: something that was wrong now works                            | Bug Fixes        |

A change goes in exactly one category. Breaking Changes wins over every other category BECAUSE a user must see it before
upgrading.

## Grouping changes

Group two or more related changes under a `####` heading that names the higher-level change in plain words, such as
"Homebrew-ready releases" or "Clearer sandbox errors". Several commits that deliver one user-visible change become one
bullet, not several. Never make a group of one; a lone change stays a plain bullet.

## Writing the summary paragraph

Write 3 to 5 sentences, each 10 to 15 words. Say what the release means for a user, in plain language, most important
change first. Name no commit types, file paths, or internal package names. Count the words in each sentence.

## Writing bullets

Every bullet is `- {thing that changed} - {summary of change}`, with a space, a hyphen, and a space between the parts.

- **Thing that changed** is what a user touches: a command (`3pitor --version`), a flag, the editor, the chat panel,
  an error message, a workflow. Put commands and flags in backticks.
- **Summary of change** is one short sentence on what is different now, from the user's side, ending with a period.

## Crediting contributors

`scripts/collect-credits.sh` lists every pull request merged and every issue completed in the release, with the GitHub
logins to credit for each. Those are issue reporters, pull request authors, and commit authors and co-authors. It
already leaves out AI and bot accounts, and reviewers and commenters are never credited. Use its list as the only source
of credits BECAUSE `scripts/check-notes.ts` rejects any credit that is not in it.

- Every pull request and every issue in the list is linked on the bullet that describes its change. An issue goes on
  the same bullet as the pull request that closed it.
- A bullet built from several pull requests or issues links all of them, and credits every contributor to any of them,
  each login once.
- Credits trail the summary sentence after one space: linked numbers separated by commas, then ` by `, then linked
  usernames separated by commas. There are no parentheses around the credits.
- Link a pull request or issue as `[#21](https://github.com/mxriverlynn/3Pitor/pull/21)`, with the exact `url` from
  the list. Link a user as `[@mxriverlynn](https://github.com/mxriverlynn)`, with the login as both the text and the
  path.
- A change pushed straight to `main`, with no pull request, gets no credit.

## Example

```markdown
## v0.2.0 - 2026-10-15

3pitor now installs with Homebrew and runs from any folder on a Mac. Each release builds signed programs for Apple
silicon and Intel Macs automatically. The version and help flags now answer and exit without starting the editor.
The missing API key warning now names the command an installed copy runs.

### New Features

#### Homebrew installs

- `brew install mxriverlynn/tap/3pitor` - Installs 3pitor on macOS 13 or later, with no clone or Bun needed. [#23](https://github.com/mxriverlynn/3Pitor/pull/23) by [@mxriverlynn](https://github.com/mxriverlynn)
- Release archives - Each version tag builds signed macOS archives for Apple silicon and Intel. [#23](https://github.com/mxriverlynn/3Pitor/pull/23) by [@mxriverlynn](https://github.com/mxriverlynn)

### Enhancements

- `3pitor --version` and `--help` - Print the version or the usage line and exit, without starting. [#23](https://github.com/mxriverlynn/3Pitor/pull/23) by [@mxriverlynn](https://github.com/mxriverlynn)

### Bug Fixes

- Missing API key warning - Now says `ANTHROPIC_API_KEY=sk-ant-... 3pitor` instead of `bun run server`. [#23](https://github.com/mxriverlynn/3Pitor/pull/23) by [@mxriverlynn](https://github.com/mxriverlynn)

### Breaking Changes

- None in this release.
```

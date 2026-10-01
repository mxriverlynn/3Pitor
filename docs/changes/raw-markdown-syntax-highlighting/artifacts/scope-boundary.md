# Scope Boundary: Raw Markdown Syntax Highlighting

## Work Item

No work item exists. The operator's request, typed when invoking `plan-a-change`, is the only boundary this run has.

## Stated Scope

> i want syntax highlighting in the raw markdown editing mode, so i can visually see the difference between a regular
> line of text vs any header "#", "##", etc, and links are the same blue color as the formatted version, etc.
> generally, make it easier to see what's going on in both raw and formatted versions

## Stated Exclusions

None stated.

## Operator-Stated Scope

In the confirmation turn the operator confirmed the area as the whole area the change may touch:

- `src/ui/documents/markdown-editor/raw-view.tsx` (the raw view)
- `src/ui/documents/markdown-editor/markdown-editor.css` (the editor's styles)
- `src/ui/styles.css` (the color variables)

Asked what "easier to see" means for the formatted view, the operator chose "(c) Something specific" and, asked which
things are hard to make out there today, answered:

> all of the above

referring to this list:

- headings that don't stand out enough from body text
- links that are hard to spot
- inline code or code blocks that blend into the page
- block quotes or lists that are hard to tell apart

The operator was told, and did not object, that raw-mode styling is limited to color (and possibly weight) because the
mirror behind the textarea must lay out character-for-character with it; heading lines cannot grow in size there.

Output folder confirmed: `docs/changes/raw-markdown-syntax-highlighting/`.

## Direction of Travel

Unanswered. Nothing the request names is being deprecated, replaced, or migrated away from; the question did not arise.

## Visual Material Received

None received

## Record Provenance

Established by `han-planning:plan-a-change` on 2026-10-01 from the operator's request and confirmation answers. No
prior record existed; no conflict was resolved.

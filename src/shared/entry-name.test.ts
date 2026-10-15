import { expect, test } from 'bun:test';
import { newEntryName } from './entry-name';

// What is typed, the kind of item, and the name it gets.
const examples = [
  ['garden', 'file', 'garden.md'],
  ['essays', 'folder', 'essays'],
  ['  garden  ', 'file', 'garden.md'],
  ['  essays  ', 'folder', 'essays'],
  ['garden.md', 'file', 'garden.md'],
  ['Notes.MD', 'file', 'Notes.md'],
  ['notes .md', 'file', 'notes.md'],
  ['x.MD ', 'file', 'x.md'],
  ['x.md.md', 'file', 'x.md.md'],
  ['a.md', 'folder', 'a.md'],
  ['a?b', 'file', 'ab.md'],
  ['a?b', 'folder', 'ab'],
  ['tab\there', 'file', 'tabhere.md'],
  ['drafts/compost', 'file', 'draftscompost.md'],
  [' drafts/2026 ', 'folder', 'drafts2026'],
  ['back\\slash "quoted" <a>:b*c|d\u0000\u001f\u007f', 'file', 'backslash quoted abcd.md'],
  ['? garden', 'file', 'garden.md'],
  ['.hidden', 'file', 'hidden.md'],
  ['.hidden', 'folder', 'hidden'],
  ['foo.', 'file', 'foo.md'],
  ['foo.', 'folder', 'foo'],
  ['foo.md.', 'file', 'foo.md'],
  ['Notes.MD.', 'file', 'Notes.md'],
  ['foo.md.', 'folder', 'foo.md'],
  [' . foo . ', 'file', 'foo.md'],
  ['.md', 'file', ''],
  ['.md', 'folder', 'md'],
  ['<>:', 'file', ''],
  ['<>:', 'folder', ''],
  ['..', 'file', ''],
  ['..', 'folder', ''],
  ['  ', 'file', ''],
  ['', 'folder', ''],
] as const;

test.each(examples)('%p typed as a new %s is named %p', (typed, kind, expected) => {
  expect(newEntryName(typed, kind)).toBe(expected);
});

// What the server's checkPath requires of a name, so every name the tree sends is one it accepts.
test.each(examples.filter(([, , name]) => name))('%p as a new %s is a name the server accepts', (typed, kind) => {
  const name = newEntryName(typed, kind);
  expect(name.startsWith('.')).toBe(false);
  expect(name).not.toMatch(/[\\\0]/);
  if (kind === 'file') expect(name.endsWith('.md')).toBe(true);
});

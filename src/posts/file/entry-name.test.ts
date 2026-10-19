import { expect, test } from 'bun:test';
import { newEntryName } from './entry-name';

// What is typed, and the name the new folder gets.
const examples = [
  ['essays', 'essays'],
  ['  essays  ', 'essays'],
  ['a.md', 'a.md'],
  ['a?b', 'ab'],
  [' drafts/2026 ', 'drafts2026'],
  ['.hidden', 'hidden'],
  ['foo.', 'foo'],
  ['foo.md.', 'foo.md'],
  ['.md', 'md'],
  ['<>:', ''],
  ['..', ''],
  ['', ''],
] as const;

test.each(examples)('%p typed as a new folder is named %p', (typed, expected) => {
  expect(newEntryName(typed)).toBe(expected);
});

// What the server's checkPath requires of a name, so every name the tree sends is one it accepts.
test.each(examples.filter(([, name]) => name))('%p as a new folder is a name the server accepts', (typed) => {
  const name = newEntryName(typed);
  expect(name.startsWith('.')).toBe(false);
  expect(name).not.toMatch(/[\\\0]/);
});

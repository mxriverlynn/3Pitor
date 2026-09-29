import { expect, test } from 'bun:test';
import { movedPath, within } from './paths';

test.each([
  ['ideas.md', 'ideas.md', 'drafts/ideas.md', 'drafts/ideas.md'],
  ['drafts/2026/soil.md', 'drafts', 'archive/drafts', 'archive/drafts/2026/soil.md'],
  ['drafts', 'drafts', 'essays', 'essays'],
  ['drafts-old.md', 'drafts', 'x', undefined],
  ['notes.md', 'drafts', 'x', undefined],
  ['archive/drafts/a.md', 'drafts', 'x', undefined],
])('%p after moving %p to %p is %p', (path, from, to, expected) => {
  expect(movedPath(path, from, to)).toBe(expected);
});

test('a path is within a folder when it is the folder or inside it, never when it only shares its first letters', () => {
  expect([within('drafts', 'drafts'), within('drafts/a.md', 'drafts'), within('drafts-old.md', 'drafts')]).toEqual([
    true,
    true,
    false,
  ]);
});

import { expect, test } from 'bun:test';
import { shortcut } from './shortcut';

test('a shortcut hint reads ⌘ on a Mac', () => {
  expect(shortcut('S', true)).toBe('⌘S');
});

test('a shortcut hint reads Ctrl+ off the Mac', () => {
  expect(shortcut('K', false)).toBe('Ctrl+K');
});

import { expect, test } from 'bun:test';
import { FileSystemError } from './file-system-error';
import { checkKey, normalizeKey, parentKey } from './keys';

test('accepts keys that are workspace-relative "/" paths', () => {
  for (const key of ['a', 'a/b.md', '..foo', '.3pitor/x.md', 'a b/c.md', 'x:y']) {
    expect(() => checkKey(key)).not.toThrow();
  }
});

test('refuses keys outside the grammar as invalid, quoting the key', () => {
  for (const key of ['', '/a', 'a/', 'a//b', '.', '..', 'a/../b', 'a/./b', 'a\\b', 'a\0b']) {
    let error: unknown;
    try {
      checkKey(key);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FileSystemError);
    expect((error as FileSystemError).reason).toBe('invalid');
    expect((error as FileSystemError).message).toBe(`${JSON.stringify(key)} is not a valid key`);
  }
});

test('accepts the root only where it is allowed', () => {
  expect(() => checkKey('', { allowRoot: true })).not.toThrow();
});

test('normalizes loose input into its canonical key', () => {
  expect(normalizeKey('./notes.md')).toBe('notes.md');
  expect(normalizeKey('a/../b.md')).toBe('b.md');
  expect(normalizeKey('a//b/')).toBe('a/b');
  expect(normalizeKey('.')).toBe('');
  expect(normalizeKey('a/../.claude/x.md')).toBe('.claude/x.md');
});

test('refuses loose input that is absolute or climbs out of the workspace', () => {
  for (const input of ['../x', 'a/../../x', '/abs']) {
    expect(() => normalizeKey(input)).toThrow(new FileSystemError('invalid', `${input} is outside the workspace`));
  }
});

test('checks the canonical form against the grammar', () => {
  expect(() => normalizeKey('a\\b')).toThrow(`"a\\\\b" is not a valid key`);
});

test('names the parent of a key, with "" for the root', () => {
  expect(parentKey('a/b')).toBe('a');
  expect(parentKey('a/b/c.md')).toBe('a/b');
  expect(parentKey('c')).toBe('');
});

import { expect, test } from 'bun:test';
import { documentKey, parseDocumentKey, postKey, postOfKey, type DocumentRef } from './document-key';

// A document, and the key that names it outside the store.
const examples: [DocumentRef, string][] = [
  [{ kind: 'post', postId: 'the sun' }, 'the sun'],
  [{ kind: 'post', postId: '1/p 1' }, '1/p 1'],
  [{ kind: 'post', postId: '[Draft] Sun' }, '[Draft] Sun'],
  [{ kind: 'post', postId: 'say "hi"' }, 'say "hi"'],
  [{ kind: 'outline', postId: '1/p 1' }, '.["outline","1/p 1"]'],
  [{ kind: 'outline', postId: 'say "hi"' }, '.["outline","say \\"hi\\""]'],
  [{ kind: 'research', postId: '1/p 1', researchDocumentId: 'Sources 2' }, '.["research","1/p 1","Sources 2"]'],
  [{ kind: 'research', postId: '[Draft] Sun', researchDocumentId: 'a"b' }, '.["research","[Draft] Sun","a\\"b"]'],
];

test.each(examples)('%p is named %p, and that key parses back to it', (ref, key) => {
  expect(documentKey(ref)).toBe(key);
  expect(parseDocumentKey(key)).toEqual(ref);
  expect(documentKey(parseDocumentKey(key)!)).toBe(key);
});

test.each([
  '',
  '.3pitor/notes.md',
  '.',
  '.[',
  '.[ "outline","x"]',
  '.["outline", "x"]',
  '.["outline"]',
  '.["outline","x","y"]',
  '.["research","x"]',
  '.["post","x"]',
  '.["outline",1]',
  '.{"kind":"outline"}',
  '.["outline","\\u0078"]',
])('%p is no document key', (key) => {
  expect(parseDocumentKey(key)).toBeUndefined();
});

test('postKey names a post by its id, and postOfKey gives the post any key belongs to', () => {
  expect(postKey('the sun')).toBe('the sun');
  expect(postOfKey('the sun')).toBe('the sun');
  expect(postOfKey('.["outline","the sun"]')).toBe('the sun');
  expect(postOfKey('.["research","the sun","Sources"]')).toBe('the sun');
  expect(postOfKey('.[')).toBeUndefined();
});

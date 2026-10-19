import { expect, test } from 'bun:test';
import { PostError } from './post-error';

test('a not-found refusal says the post no longer exists, and is recognizable as a PostError', () => {
  const error: unknown = new PostError('not-found', 'post');
  expect(error).toBeInstanceOf(PostError);
  expect(error).toBeInstanceOf(Error);
  expect((error as PostError).reason).toBe('not-found');
  expect((error as PostError).subject).toBe('post');
  expect((error as PostError).message).toBe('That post no longer exists.');
});

test('an invalid refusal says a post needs a title', () => {
  const error = new PostError('invalid', 'post');
  expect(error.reason).toBe('invalid');
  expect(error.message).toBe('A post needs a title.');
});

test('a research document refusal names the research document, by reason', () => {
  const missing = new PostError('not-found', 'research-document');
  expect(missing.subject).toBe('research-document');
  expect(missing.message).toBe('That research document no longer exists.');
  expect(new PostError('invalid', 'research-document').message).toBe('A research document needs a title.');
});

import { expect, test } from 'bun:test';
import { PostError } from './post-error';

test('a not-found refusal says the post no longer exists, and is recognizable as a PostError', () => {
  const error: unknown = new PostError('not-found');
  expect(error).toBeInstanceOf(PostError);
  expect(error).toBeInstanceOf(Error);
  expect((error as PostError).reason).toBe('not-found');
  expect((error as PostError).message).toBe('That post no longer exists.');
});

test('an invalid refusal says a post needs a title', () => {
  const error = new PostError('invalid');
  expect(error.reason).toBe('invalid');
  expect(error.message).toBe('A post needs a title.');
});

// A refusal the caller can show as is. The message is fixed by the reason, so it carries no id, title, path, or storage
// detail. This module imports nothing, so the engine may import it as a value and recognize a refusal with
// `error instanceof PostError`. Reading `.reason` alone is not enough: FileSystemError also has 'not-found' and
// 'invalid' reasons.
// - 'not-found': the id names no post. It was never given out, was deleted, or is not one list() could return.
// - 'invalid':   an argument the store refuses. Today that is only a blank title.
export type PostErrorReason = 'not-found' | 'invalid';

const MESSAGES: Record<PostErrorReason, string> = {
  'not-found': 'That post no longer exists.',
  invalid: 'A post needs a title.',
};

export class PostError extends Error {
  constructor(readonly reason: PostErrorReason) {
    super(MESSAGES[reason]);
  }
}

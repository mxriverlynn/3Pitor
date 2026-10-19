// A refusal the caller can show as is. The message is fixed by the pair (subject, reason), so it carries no id, title,
// path, or storage detail. This module imports nothing, so the engine may import it as a value and recognize a refusal
// with `error instanceof PostError`. Reading `.reason` alone is not enough. FileSystemError also has 'not-found' and
// 'invalid' reasons. And a 'not-found' with subject 'research-document' says the post was found when checked, not that
// the post is gone.
// - 'not-found': the id names nothing. With subject 'post', the post id names no post (never given out, deleted, or not
//   one list() could return). With subject 'research-document', the post was found when checked, and the research
//   document was not: the research document id names no research document of it.
// - 'invalid': an argument the store refuses. Today that is only a blank title, of a post (subject 'post') or of a
//   research document (subject 'research-document'). An outline is never refused as invalid.
export type PostErrorReason = 'not-found' | 'invalid';

// What was refused. The outline has no subject of its own: the post names it, so an outline call's only refusal is
// 'not-found' with subject 'post'.
export type PostErrorSubject = 'post' | 'research-document';

const MESSAGES: Record<PostErrorSubject, Record<PostErrorReason, string>> = {
  post: { 'not-found': 'That post no longer exists.', invalid: 'A post needs a title.' },
  'research-document': {
    'not-found': 'That research document no longer exists.',
    invalid: 'A research document needs a title.',
  },
};

export class PostError extends Error {
  // subject is required, with no default, so a research path that leaves it out fails to compile instead of showing
  // the post's message.
  constructor(readonly reason: PostErrorReason, readonly subject: PostErrorSubject) {
    super(MESSAGES[subject][reason]);
  }
}

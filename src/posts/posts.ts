// The posts package: every post is created, read, changed, listed, and deleted through one contract, so the store
// behind it can be swapped. A host builds a store; at integration it hands it to the engine.
// Outside src/posts/, only cli, server, and engine import the package, and only through posts/posts or
// posts/post-error. The engine imports this module with `import type` only, so no implementation ever loads into the
// engine; it may import posts/post-error as a value. The package imports only src/file-system/file-system.ts and
// src/shared/.

// A post's identity, assigned by the store when the post is made.
// - Exact: a string names a post only when list() would return exactly that string, code unit for code unit. A variant
//   in letter case, Unicode form, or spacing names no post. "" never names a post.
// - Stable: no call on this contract changes it, whatever happens to the title. It is stable within one store; moving
//   posts to another store is not part of the contract.
// - Never reused: a store instance never gives out an id it has given out before, even after that post is deleted. So
//   a stale call holding a deleted id can never reach a later post. Reuse across store instances (a restart, another
//   process) is not promised against.
// - Opaque: callers store it and pass it back. They never build, parse, order, or show it. Some stores' ids look like
//   paths or names (the file store's do); they are still opaque.
// Any string that names no post is 'not-found'. There is no "malformed id".
export type PostId = string;

// Strings. Titles and bodies are JavaScript strings. A string holding a lone surrogate or U+0000 (NUL) is outside the
// contract: what a store does with it is not promised (a database TEXT column refuses NUL).
//
// Blank: a title is blank when title.trim() === "", that is, when every code unit is whitespace or a line terminator as
// String.prototype.trim() defines them (so "", " \t\n", " ", and "　" are blank). U+200B (zero-width space) is not
// whitespace to trim(), so "​" is a valid title.

// What list() gives for each post: enough to show and pick it, without its body.
export interface PostSummary {
  id: PostId;
  // Never blank. The title exactly as last given to create or setTitle. For a post this store never titled, a title the
  // store derives (the file store's fallback).
  title: string;
}

export interface Post extends PostSummary {
  // The post's markdown, exactly as last given. The store checks nothing about it and never reads or writes a heading
  // in it: the title is separate metadata, and any H1 belongs to the caller. The title and an H1 are independent and
  // can disagree. Any string inside the contract round-trips, including "", CRLF, multi-byte text, and large bodies.
  body: string;
}

// What list() resolves to. An object, so fields such as a paging cursor can be added later without breaking callers.
// Today it holds only the posts; there is no paging.
export interface PostList {
  posts: PostSummary[];
}

// Per-post order. Calls that name one id through one store (get, setBody, setTitle, delete) take effect in the order
// they were made, whether or not the caller awaits between them. So setBody then delete leaves no post, and a get made
// after a setBody sees that body. list() is not ordered against them. Calls through different store instances, or from
// other processes, have no promised order.
//
// Failures. A rejection with a PostError changed nothing. Any other rejection, of any type, is a storage failure: the
// call may or may not have taken effect, and get and list say which.
export interface PostStore {
  // Every post that exists for the whole of the call, each once, in no promised order. Callers sort. A post made or
  // deleted while the call runs may or may not appear. Never rejects with a PostError.
  list(): Promise<PostList>;

  // One post, body included. An id that names no post is 'not-found'.
  get(id: PostId): Promise<Post>;

  // Makes a new post and resolves to its id. The id is one list() returns. Titles need not be unique. Once this
  // resolves, get and list include the post. A blank title is 'invalid', and nothing is made.
  create(post: { title: string; body: string }): Promise<PostId>;

  // Replace one field and leave the other alone. Neither ever creates a post: an id that names no post is 'not-found'.
  // A blank title is 'invalid'. Once the call resolves, get returns the new value.
  setBody(id: PostId, body: string): Promise<void>;
  setTitle(id: PostId, title: string): Promise<void>;

  // Removes the post, and everything the store keeps for it, for good. An id that names no post is 'not-found'.
  // Through this store, once a delete takes effect, every later call on that id is 'not-found', and no later call
  // brings the post back or gives its id to another post.
  delete(id: PostId): Promise<void>;

  // Subscribes listener to change signals and returns its unsubscribe.
  // - Each call is its own subscription, even when the same function is passed twice: it is then called once per
  //   subscription per signal. Nothing is watched until the first call.
  // - The caller must call the unsubscribe when it stops listening; it is safe to call twice. Once it returns, the
  //   listener is never called again through that subscription, including later in a signal already being delivered.
  // - If watch throws, no subscription was made.
  // - A signal carries no detail: re-list, and re-get the posts you hold.
  // - Own writes: every create, setBody, setTitle, or delete through this store that reaches storage signals every
  //   subscription of this store before its promise settles. That includes a call that rejects with a storage
  //   failure, since the change may have landed. A call that rejects with a PostError changed nothing and does not
  //   signal.
  // - Other writers, including another store instance: signalled when, and if, the implementation can see the change.
  // - One signal may stand for many changes, one change may be signalled more than once, and a signal may arrive when
  //   nothing visible changed.
  // - A throw from the listener is caught and logged as `Could not report a post change: <message>`. It never rejects
  //   the call that caused the signal, and later signals and other subscriptions still get it.
  watch(listener: () => void): () => void;
}

export { PostError, type PostErrorReason } from './post-error';
export { createFilePostStore } from './file/file-post-store';

// The posts package: every post, and its research documents and outline, is created, read, changed, listed, and
// deleted through one contract, so the store behind it can be swapped. A host builds a store; at integration it hands it to the engine.
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

// Strings. Titles, bodies, and outlines are JavaScript strings. A string holding a lone surrogate or U+0000 (NUL) is outside the
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

// A research document's identity, assigned by the store when the document is made. It names a document only together
// with its post: a research document's identity is the pair (postId, researchDocumentId), and anything that keeps a
// reference to a research document must keep both. Ids are unique only within their post: two posts may each have a
// research document with the same id. Within its post it follows the same rules as PostId:
// - Exact: a string names a document only when listResearchDocuments(postId) would return exactly that string, code
//   unit for code unit. A variant in letter case, Unicode form, or spacing names no document. "" never names one.
// - Stable: no call on this contract changes it, whatever happens to the document's title or body.
// - Never reused: a store instance never gives out, within one post, an id it has given out before in that post, even
//   after that document is deleted. A deleted post's id is never reused either. So, through one store instance, a
//   stale pair can never reach a later document. Reuse across store instances (a restart, another process) is not
//   promised against.
// - Opaque: callers store it and pass it back. They never build, parse, order, or show it.
// Any string that names no research document of a found post is 'not-found' (subject 'research-document'). There is
// no "malformed id".
export type ResearchDocumentId = string;

// What listResearchDocuments gives for each research document: enough to show and pick it, without its body. It has no
// postId field, because every call that returns it was given the post id.
export interface ResearchDocumentSummary {
  id: ResearchDocumentId;
  // Never blank. The title exactly as last given to createResearchDocument or setResearchDocumentTitle. For a document
  // this store never titled (one another writer made), a title the store derives. The title is the only key callers
  // sort by: research documents carry no timestamp or position. Titles need not be unique, and nothing is promised
  // about the order of documents with equal titles: it may differ from one call to the next. Independent of any H1 in
  // the body; the two can disagree.
  title: string;
}

export interface ResearchDocument extends ResearchDocumentSummary {
  // The document's markdown, exactly as last given. Same rules as Post.body: the store checks nothing about it, never
  // reads or writes a heading in it, and any string inside the contract round-trips, including "".
  body: string;
}

// What listResearchDocuments resolves to. An object, like PostList, so fields can be added later without breaking
// callers. There is no paging.
export interface ResearchDocumentList {
  researchDocuments: ResearchDocumentSummary[];
}

// Per-post order. Calls that name one post id through one store take effect in the order they were made, whether or
// not the caller awaits between them. That covers get, setBody, setTitle, delete, and every research document and
// outline call naming that post, listResearchDocuments included. So setOutline then delete leaves no post and no
// outline, a createResearchDocument made after a delete is 'not-found', and a getResearchDocument made after a
// setResearchDocumentBody sees that body. list() is not ordered against them. Calls through different store
// instances, or from other processes, have no promised order.
//
// Failures. A rejection with a PostError changed nothing; its subject says what was refused, the post or one of its
// research documents. Any other rejection, of any type, is a storage failure: the call may or may not have taken
// effect, and the matching get or list says which.
//
// Precedence. A blank title is checked before any I/O. So createResearchDocument or setResearchDocumentTitle with a
// blank title is 'invalid' (subject 'research-document') even when the post or the document is missing. Otherwise a
// missing post wins: a call naming a post that does not exist is 'not-found' (subject 'post'), whatever research
// document id it names. 'not-found' with subject 'research-document' means the post was found when checked and the
// research document was not.
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

  // Removes the post, and everything the store keeps for it, for good: its body, its title, its research documents,
  // and its outline. An id that names no post is 'not-found'. Through this store, once a delete takes effect, every
  // later call naming that id is 'not-found', post and research document and outline calls alike. No later call
  // brings the post, its research documents, or its outline back, or gives its id to another post.
  delete(id: PostId): Promise<void>;

  // Every research document of the post that exists for the whole of the call, each once, without bodies, in no
  // promised order. Callers sort, by title. Unlike list(), this call is ordered with the post's other calls (see
  // Per-post order), and it rejects 'not-found' (subject 'post') when the post id names no post. It never rejects
  // with subject 'research-document'. A post with no research documents resolves to { researchDocuments: [] }. It
  // never includes an id this store has deleted in that post, even if another writer makes a document there later.
  // A document another writer adds or removes while the call runs may or may not appear.
  listResearchDocuments(postId: PostId): Promise<ResearchDocumentList>;

  // One research document of the post, body included. A post id that names no post is 'not-found' (subject 'post').
  // An id that names no research document of that post is 'not-found' (subject 'research-document').
  getResearchDocument(postId: PostId, researchDocumentId: ResearchDocumentId): Promise<ResearchDocument>;

  // Makes a new research document on the post and resolves to its id, an id listResearchDocuments(postId) returns.
  // Titles need not be unique within a post. Once this resolves, getResearchDocument and listResearchDocuments include
  // it. It never creates a post. A blank title is 'invalid' (subject 'research-document') and nothing is made; this is
  // checked first, even when the post is missing. Otherwise a post id that names no post is 'not-found' (subject
  // 'post').
  createResearchDocument(postId: PostId, researchDocument: { title: string; body: string }): Promise<ResearchDocumentId>;

  // Replace one field of a research document and leave the other alone. The document's id does not change. Neither
  // call creates a post or a research document. A post id that names no post is 'not-found' (subject 'post'), and a
  // document id that names no research document of that post is 'not-found' (subject 'research-document'). A blank
  // title is 'invalid' (subject 'research-document'), checked before either. Once the call resolves,
  // getResearchDocument returns the new value.
  setResearchDocumentBody(postId: PostId, researchDocumentId: ResearchDocumentId, body: string): Promise<void>;
  setResearchDocumentTitle(postId: PostId, researchDocumentId: ResearchDocumentId, title: string): Promise<void>;

  // Removes one research document of the post for good. Through this store, once it takes effect, every later call
  // naming that pair is 'not-found' (subject 'research-document'), listResearchDocuments never includes that id
  // again, and the id is never given to another document in that post. All of this holds even if another writer makes
  // a document with that id later. A post id that names no post is 'not-found' (subject 'post'). A document id that
  // names no research document of that post is 'not-found' (subject 'research-document'). Unlike removing an absent
  // outline, this is a refusal, because an id that names nothing is always 'not-found'.
  deleteResearchDocument(postId: PostId, researchDocumentId: ResearchDocumentId): Promise<void>;

  // The post's outline: its markdown, exactly as last given, or null when the post has no outline. An empty outline
  // ("") is not null: "" is an outline with no text, and null is no outline. Same body rules as Post.body. The outline
  // has no title and no id, because the post names it. A post id that names no post is 'not-found' (subject 'post').
  getOutline(postId: PostId): Promise<string | null>;

  // Sets the post's outline. A string creates the outline or replaces the whole of it, and "" is stored as an empty
  // outline. null removes it. Removing an absent outline resolves, changes nothing, and does not fail (it may still
  // signal; see watch). Never creates a post: a post id that names no post is 'not-found' (subject 'post'). An outline
  // is never 'invalid'. Once the call resolves, getOutline returns the new value.
  setOutline(postId: PostId, outline: string | null): Promise<void>;

  // Subscribes listener to change signals and returns its unsubscribe.
  // - Each call is its own subscription, even when the same function is passed twice: it is then called once per
  //   subscription per signal. Nothing is watched until the first call.
  // - The caller must call the unsubscribe when it stops listening; it is safe to call twice. Once it returns, the
  //   listener is never called again through that subscription, including later in a signal already being delivered.
  // - If watch throws, no subscription was made.
  // - A signal carries no detail: re-list, and re-get the posts, research document lists, research documents, and
  //   outlines you hold.
  // - Own writes: every create, setBody, setTitle, delete, createResearchDocument, setResearchDocumentBody,
  //   setResearchDocumentTitle, deleteResearchDocument, or setOutline through this store that reaches storage signals
  //   every subscription of this store before its promise settles. That includes a call that rejects with a storage
  //   failure, since the change may have landed. A call that rejects with a PostError changed nothing and does not
  //   signal.
  // - Other writers, including another store instance: signalled when, and if, the implementation can see the change.
  // - One signal may stand for many changes, one change may be signalled more than once, and a signal may arrive when
  //   nothing visible changed.
  // - A throw from the listener is caught and logged as `Could not report a post change: <message>`. It never rejects
  //   the call that caused the signal, and later signals and other subscriptions still get it.
  watch(listener: () => void): () => void;
}

export { PostError, type PostErrorReason, type PostErrorSubject } from './post-error';
export { createFilePostStore } from './file/file-post-store';

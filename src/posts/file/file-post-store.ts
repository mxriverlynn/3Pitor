// The first implementation, built over today's FileSystem. It imports only file-system/file-system.ts (contract
// symbols), shared/entry-name.ts, and its own package's entries, and it is Bun-free. Like createLocalFileSystem, it is
// synchronous and does no I/O when called. Its ids are the workspace keys of post folders, such as `the sun` or
// `series/one`; they look like paths and are still opaque.
import { type FileEntry, type FileSystem, FileSystemError } from '../../file-system/file-system';
import { newEntryName } from '../../shared/entry-name';
import { PostError, type PostErrorSubject } from '../post-error';
import type { Post, PostStore, ResearchDocument, ResearchDocumentSummary } from '../posts';

const DRAFT = 'draft.md';
const OUTLINE = 'outline.md';
const RESEARCH = 'research';
const DOCUMENT = 'document.md';
const RESEARCH_META = '.research.json';
// The folder of a post's research document.
const researchKey = (postId: string, id: string) => `${postId}/${RESEARCH}/${id}`;
const META = '.post.json';

const isHidden = (name: string) => name.startsWith('.');
const lastSegment = (key: string) => key.slice(key.lastIndexOf('/') + 1);
// A refusal meaning nothing usable is at the key: it is missing, or the key grammar refuses its name.
const isMissing = (error: unknown) =>
  error instanceof FileSystemError && (error.reason === 'not-found' || error.reason === 'invalid');
// The act of get or delete finding the folder already gone, after the check passed.
const vanished = (error: unknown, subject: PostErrorSubject = 'post') =>
  error instanceof FileSystemError && error.reason === 'not-found' ? new PostError('not-found', subject) : error;
// The folder a new post's title becomes: no unsafe characters, cut to at most 200 UTF-8 bytes at a character boundary,
// with no spaces or dots at either end, or Untitled when nothing is left.
const folderName = (title: string) => newEntryName(cutToBytes(newEntryName(title), 200)) || 'Untitled';

function cutToBytes(text: string, max: number): string {
  const encoder = new TextEncoder();
  let bytes = 0;
  let cut = '';
  for (const character of text) {
    bytes += encoder.encode(character).length;
    if (bytes > max) break;
    cut += character;
  }
  return cut;
}

// Hidden names are app state, not posts, except the title files: a post's .post.json and a research document's
// .research.json. Called for a folder before the watcher descends into it, so a hidden folder is cut off at its own key.
const ignoreForWatch = (key: string) => {
  const last = lastSegment(key);
  return isHidden(last) && last !== META && last !== RESEARCH_META;
};
const has = (entries: FileEntry[], key: string) => entries.some((entry) => entry.key === key && entry.kind === 'file');

export function createFilePostStore(fileSystem: FileSystem): PostStore {
  // Per post, the tail of its queue. Calls naming one id are queued when made, before any await, and run one at a
  // time, so they take effect in call order. A failed call rejects only its caller. A settled tail is dropped.
  const queues = new Map<string, Promise<unknown>>();

  function enqueue<T>(id: string, run: () => Promise<T>): Promise<T> {
    const result = (queues.get(id) ?? Promise.resolve()).then(run);
    const tail = result.catch(() => {});
    queues.set(id, tail);
    tail.then(() => {
      if (queues.get(id) === tail) queues.delete(id);
    });
    return result;
  }

  // The ids this store has deleted, exactly as given. A tombstoned id is never a post to this store, even if another
  // writer makes a post folder there later, and create never gives one out again. Kept for the life of the store.
  const tombstones = new Set<string>();
  const isDeletedPost = (id: string) => tombstones.has(id);
  // Per post, the research document ids this store has deleted in it. Kept apart from the post ids, since a
  // "/"-joined research path is itself a well-formed post id.
  const researchTombstones = new Map<string, Set<string>>();
  const isDeletedResearch = (postId: string) => (id: string) => researchTombstones.get(postId)?.has(id) ?? false;

  type Subscription = { listener: () => void; active: boolean };
  const subscriptions = new Set<Subscription>();
  // The one underlying file-system watch, running while any subscription is.
  let stopWatching: (() => void) | undefined;

  // Tells every subscription something changed. Over a copy, so a listener may unsubscribe itself or another; one
  // unsubscribed earlier in this signal is skipped. A listener's throw is logged and stops nothing.
  function signal(): void {
    for (const entry of [...subscriptions]) {
      if (!entry.active) continue;
      try {
        entry.listener();
      } catch (error) {
        console.error(`Could not report a post change: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Runs a change and signals before it settles, on every outcome but a PostError, which changed nothing. A storage
  // failure signals too, since the change may have landed.
  async function changing<T>(run: () => Promise<T>): Promise<T> {
    try {
      const result = await run();
      signal();
      return result;
    } catch (error) {
      if (!(error instanceof PostError)) signal();
      throw error;
    }
  }

  // A folder's listing, with the refusals that mean "no such folder" as PostError 'not-found'.
  async function listOrNotFound(key: string): Promise<FileEntry[]> {
    try {
      return await fileSystem.list(key);
    } catch (error) {
      throw isMissing(error) ? new PostError('not-found', 'post') : error;
    }
  }

  // The listing of the post folder an id names, or PostError 'not-found'. The same rules as walk, so every id this
  // accepts is one list returns: each segment is listed in its parent under exactly that name, as a folder; no folder
  // between the root and the post holds draft.md; and the post's folder does.
  async function locatePost(id: string): Promise<FileEntry[]> {
    const segments = id.split('/');
    if (id === '' || tombstones.has(id) || segments.some(isHidden)) throw new PostError('not-found', 'post');
    let entries = await listOrNotFound('');
    let key = '';
    for (const [i, segment] of segments.entries()) {
      key = key ? `${key}/${segment}` : segment;
      if (!entries.some((entry) => entry.key === key && entry.kind === 'folder')) throw new PostError('not-found', 'post');
      entries = await listOrNotFound(key);
      if (i < segments.length - 1 && has(entries, `${key}/${DRAFT}`)) throw new PostError('not-found', 'post');
    }
    if (!has(entries, `${key}/${DRAFT}`)) throw new PostError('not-found', 'post');
    return entries;
  }

  // Every post, with its folder's listing: each folder that holds draft.md, without descending into a post, through
  // non-hidden folders only. Links are 'other' entries, so the walk never follows one. A tombstoned folder is not a
  // post, but whether to descend depends on draft.md alone, so list and locatePost agree on what lies under it.
  async function walk(): Promise<{ id: string; entries: FileEntry[] }[]> {
    const posts: { id: string; entries: FileEntry[] }[] = [];
    const visit = async (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (entry.kind !== 'folder' || isHidden(lastSegment(entry.key))) continue;
        // A folder that vanished, or whose name the key grammar refuses (such as one holding \), is skipped. Only
        // folders below the root: a failure of the root's own listing rejects.
        const children = await listOrNotFound(entry.key).catch((error: unknown) => {
          if (error instanceof PostError) return undefined;
          throw error;
        });
        if (!children) continue;
        if (!has(children, `${entry.key}/${DRAFT}`)) await visit(children);
        else if (!tombstones.has(entry.key)) posts.push({ id: entry.key, entries: children });
      }
    };
    await visit(await fileSystem.list(''));
    return posts;
  }

  // The title in a folder's title file (a post's .post.json, a research document's .research.json), or the folder's
  // last segment, or Untitled. Whether the title file is a regular file is read from the folder's listing, never left
  // to read, which does not refuse a folder.
  async function titleOf(key: string, entries: FileEntry[], meta = META): Promise<string> {
    const fallback = lastSegment(key).trim() !== '' ? lastSegment(key) : 'Untitled';
    if (!has(entries, `${key}/${meta}`)) return fallback;
    let text: string;
    try {
      text = await fileSystem.read(`${key}/${meta}`);
    } catch (error) {
      if (isMissing(error)) return fallback;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return fallback;
    }
    const title = typeof value === 'object' && value !== null ? (value as { title?: unknown }).title : undefined;
    return typeof title === 'string' && title.trim() !== '' ? title : fallback;
  }

  // Removes a half-made folder, but only when it holds nothing but the store's own files, so nobody else's file is ever
  // lost. Any failure here is dropped: the caller rethrows the error that made the cleanup necessary.
  async function removeIfOnlyOurs(key: string, ours: string[]): Promise<void> {
    try {
      const entries = await fileSystem.list(key);
      if (entries.every((entry) => ours.includes(lastSegment(entry.key)))) await fileSystem.delete(key);
    } catch {}
  }

  // A title file holds the title and nothing else, one line, written whole.
  function writeTitle(key: string, title: string, meta = META): Promise<void> {
    return fileSystem.write(`${key}/${meta}`, `${JSON.stringify({ title })}\n`, { atomic: true });
  }

  // The first of name, `name 2`, `name 3`, … that is free and not deleted, made in parent ("" is the root), as parent's
  // listing will report it. The exclusive createFolder keeps two creates, even in two processes, from sharing a folder.
  async function claimFolder(parent: string, name: string, isDeleted: (name: string) => boolean): Promise<string> {
    const keyOf = (child: string) => (parent ? `${parent}/${child}` : child);
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? name : `${name} ${n}`;
      if (isDeleted(candidate)) continue;
      try {
        await fileSystem.createFolder(keyOf(candidate));
      } catch (error) {
        if (error instanceof FileSystemError && error.reason === 'exists') continue;
        throw error;
      }
      const listed = await listedName(parent, candidate);
      if (!isDeleted(listed)) return listed;
      await fileSystem.delete(keyOf(listed));
    }
  }

  // The name parent's listing gives the folder just made: exactly the candidate, or, on a disk that stores names in
  // another Unicode form (HFS+ stores NFD), the one folder whose NFC form matches.
  async function listedName(parent: string, candidate: string): Promise<string> {
    const keyOf = (child: string) => (parent ? `${parent}/${child}` : child);
    const folders = (await fileSystem.list(parent)).filter((entry) => entry.kind === 'folder').map((entry) => lastSegment(entry.key));
    if (folders.includes(candidate)) return candidate;
    const matches = folders.filter((name) => name.normalize('NFC') === candidate.normalize('NFC'));
    if (matches.length === 1) return matches[0];
    await fileSystem.delete(keyOf(candidate));
    throw new Error(parent ? 'Could not find the new research document folder' : 'Could not find the new post folder');
  }

  // The research documents in a post folder, each with its folder's listing. A child of research/ is one only when it is
  // a non-hidden folder (links are never followed) holding a regular document.md, the key grammar accepts its name, and
  // this store has not deleted it. A research that is absent, a file, or a link holds none.
  async function researchIn(postId: string, entries: FileEntry[]): Promise<{ id: string; entries: FileEntry[] }[]> {
    const folder = `${postId}/${RESEARCH}`;
    if (!entries.some((entry) => entry.key === folder && entry.kind === 'folder')) return [];
    const children = await fileSystem.list(folder).catch((error: unknown) => {
      if (isMissing(error)) return [];
      throw error;
    });
    const deleted = isDeletedResearch(postId);
    const documents: { id: string; entries: FileEntry[] }[] = [];
    for (const child of children) {
      const id = lastSegment(child.key);
      if (child.kind !== 'folder' || isHidden(id) || deleted(id)) continue;
      const inside = await fileSystem.list(child.key).catch((error: unknown) => {
        if (isMissing(error)) return undefined;
        throw error;
      });
      if (inside && has(inside, `${child.key}/${DOCUMENT}`)) documents.push({ id, entries: inside });
    }
    return documents;
  }

  // The listing of the research document folder a pair names, or PostError 'not-found' (subject 'post' when the post
  // is missing, 'research-document' when the post was found and the document was not).
  async function locateResearch(postId: string, id: string): Promise<FileEntry[]> {
    const entries = await locatePost(postId);
    const found = (await researchIn(postId, entries)).find((document) => document.id === id);
    if (!found) throw new PostError('not-found', 'research-document');
    return found.entries;
  }

  async function researchSummary(postId: string, id: string, entries: FileEntry[]): Promise<ResearchDocumentSummary> {
    return { id, title: await titleOf(researchKey(postId, id), entries, RESEARCH_META) };
  }

  return {
    async list() {
      const posts = [];
      for (const { id, entries } of await walk()) posts.push({ id, title: await titleOf(id, entries) });
      return { posts };
    },
    get(id) {
      return enqueue(id, async (): Promise<Post> => {
        const entries = await locatePost(id);
        const title = await titleOf(id, entries);
        const body = await fileSystem.read(`${id}/${DRAFT}`).catch((error: unknown) => {
          throw vanished(error);
        });
        return { id, title, body };
      });
    },
    create({ title, body }) {
      return changing(async () => {
        if (title.trim() === '') throw new PostError('invalid', 'post');
        const id = await claimFolder('', folderName(title), isDeletedPost);
        // Queued on the new id with no await since claiming it, so a call that finds the folder early waits for the
        // post.
        return enqueue(id, async () => {
          try {
            // draft.md last: until it lands the folder is not a post, so a crash part-way leaves nothing listed.
            await writeTitle(id, title);
            await fileSystem.write(`${id}/${DRAFT}`, body);
          } catch (error) {
            await removeIfOnlyOurs(id, [META, DRAFT]);
            throw error;
          }
          return id;
        });
      });
    },
    setBody(id, body) {
      return changing(() =>
        enqueue(id, async () => {
          await locatePost(id);
          await fileSystem.write(`${id}/${DRAFT}`, body);
        }),
      );
    },
    async setTitle(id, title) {
      if (title.trim() === '') throw new PostError('invalid', 'post');
      return changing(() =>
        enqueue(id, async () => {
          await locatePost(id);
          await writeTitle(id, title);
        }),
      );
    },
    delete(id) {
      return changing(() => enqueue(id, async () => {
        await locatePost(id);
        // Tombstoned whatever the removal does: part of the folder may be gone even when it fails.
        try {
          await fileSystem.delete(id);
        } catch (error) {
          throw vanished(error);
        } finally {
          tombstones.add(id);
        }
      }));
    },
    listResearchDocuments(postId) {
      return enqueue(postId, async () => {
        const documents = await researchIn(postId, await locatePost(postId));
        const researchDocuments = [];
        for (const { id, entries } of documents) researchDocuments.push(await researchSummary(postId, id, entries));
        return { researchDocuments };
      });
    },
    getResearchDocument(postId, id) {
      return enqueue(postId, async (): Promise<ResearchDocument> => {
        const entries = await locateResearch(postId, id);
        const summary = await researchSummary(postId, id, entries);
        const body = await fileSystem.read(`${researchKey(postId, id)}/${DOCUMENT}`).catch((error: unknown) => {
          throw isMissing(error) ? new PostError('not-found', 'research-document') : error;
        });
        return { ...summary, body };
      });
    },
    createResearchDocument(postId, { title, body }) {
      return changing(async () => {
        if (title.trim() === '') throw new PostError('invalid', 'research-document');
        return enqueue(postId, async () => {
          const entries = await locatePost(postId);
          const folder = `${postId}/${RESEARCH}`;
          // A research that is a file or a link makes createFolder refuse it: a storage failure.
          if (!entries.some((entry) => entry.key === folder && entry.kind === 'folder')) await fileSystem.createFolder(folder);
          const id = await claimFolder(folder, folderName(title), isDeletedResearch(postId));
          const key = `${folder}/${id}`;
          try {
            // document.md last: until it lands the folder is not a research document, so a crash part-way lists nothing.
            await writeTitle(key, title, RESEARCH_META);
            await fileSystem.write(`${key}/${DOCUMENT}`, body);
          } catch (error) {
            await removeIfOnlyOurs(key, [RESEARCH_META, DOCUMENT]);
            throw error;
          }
          return id;
        });
      });
    },
    setResearchDocumentBody(postId, id, body) {
      return changing(() =>
        enqueue(postId, async () => {
          await locateResearch(postId, id);
          await fileSystem.write(`${researchKey(postId, id)}/${DOCUMENT}`, body);
        }),
      );
    },
    async setResearchDocumentTitle(postId, id, title) {
      if (title.trim() === '') throw new PostError('invalid', 'research-document');
      return changing(() =>
        enqueue(postId, async () => {
          await locateResearch(postId, id);
          // Rewrites the title file only and never renames the folder, so the id stays stable.
          await writeTitle(researchKey(postId, id), title, RESEARCH_META);
        }),
      );
    },
    deleteResearchDocument(postId, id) {
      return changing(() =>
        enqueue(postId, async () => {
          await locateResearch(postId, id);
          // Tombstoned whatever the removal does: part of the folder may be gone even when it fails.
          try {
            await fileSystem.delete(researchKey(postId, id));
          } catch (error) {
            throw vanished(error, 'research-document');
          } finally {
            researchTombstones.set(postId, (researchTombstones.get(postId) ?? new Set()).add(id));
          }
        }),
      );
    },
    getOutline(postId) {
      return enqueue(postId, async () => {
        const entries = await locatePost(postId);
        // Only a regular outline.md counts, read from the listing as draft.md is: a folder or a link is no outline.
        if (!has(entries, `${postId}/${OUTLINE}`)) return null;
        return fileSystem.read(`${postId}/${OUTLINE}`).catch((error: unknown) => {
          if (isMissing(error)) return null;
          throw error;
        });
      });
    },
    setOutline(postId, outline) {
      return changing(() =>
        enqueue(postId, async () => {
          const entries = await locatePost(postId);
          // Removing deletes only a regular outline.md; the store never removes an item it did not make.
          if (outline === null) {
            if (has(entries, `${postId}/${OUTLINE}`)) await fileSystem.delete(`${postId}/${OUTLINE}`);
            return;
          }
          await fileSystem.write(`${postId}/${OUTLINE}`, outline);
        }),
      );
    },
    watch(listener) {
      // The first subscription starts the underlying watch. If that throws, nothing is registered.
      if (subscriptions.size === 0) stopWatching = fileSystem.watch(() => signal(), { ignore: ignoreForWatch });
      const entry: Subscription = { listener, active: true }; // a new entry per call, never merged
      subscriptions.add(entry);
      return () => {
        if (!entry.active) return;
        entry.active = false;
        subscriptions.delete(entry);
        if (subscriptions.size === 0) {
          stopWatching?.();
          stopWatching = undefined;
        }
      };
    },
  };
}

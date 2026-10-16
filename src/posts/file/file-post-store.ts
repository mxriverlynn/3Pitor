// The first implementation, built over today's FileSystem. It imports only file-system/file-system.ts (contract symbols),
// shared/entry-name.ts, and its own package's entries, and it is Bun-free. Like createLocalFileSystem, it is synchronous
// and does no I/O when called. Its ids are the workspace keys of post folders, such as `the sun` or `series/one`; they
// look like paths and are still opaque.
import { type FileEntry, type FileSystem, FileSystemError } from '../../file-system/file-system';
import { newEntryName } from '../../shared/entry-name';
import { PostError } from '../post-error';
import type { Post, PostStore } from '../posts';

const DRAFT = 'draft.md';
const META = '.post.json';

const isHidden = (name: string) => name.startsWith('.');
const lastSegment = (key: string) => key.slice(key.lastIndexOf('/') + 1);
// A refusal meaning nothing usable is at the key: it is missing, or the key grammar refuses its name.
const isMissing = (error: unknown) =>
  error instanceof FileSystemError && (error.reason === 'not-found' || error.reason === 'invalid');
// The act of get or delete finding the folder already gone, after the check passed.
const vanished = (error: unknown) =>
  error instanceof FileSystemError && error.reason === 'not-found' ? new PostError('not-found') : error;
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

const has = (entries: FileEntry[], key: string) => entries.some((entry) => entry.key === key && entry.kind === 'file');

export function createFilePostStore(fileSystem: FileSystem): PostStore {
  const notBuilt = () => {
    throw new Error('not built yet');
  };

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

  // A folder's listing, with the refusals that mean "no such folder" as PostError 'not-found'.
  async function listOrNotFound(key: string): Promise<FileEntry[]> {
    try {
      return await fileSystem.list(key);
    } catch (error) {
      throw isMissing(error) ? new PostError('not-found') : error;
    }
  }

  // The listing of the post folder an id names, or PostError 'not-found'. The same rules as walk, so every id this
  // accepts is one list returns: each segment is listed in its parent under exactly that name, as a folder; no folder
  // between the root and the post holds draft.md; and the post's folder does.
  async function locatePost(id: string): Promise<FileEntry[]> {
    const segments = id.split('/');
    if (id === '' || tombstones.has(id) || segments.some(isHidden)) throw new PostError('not-found');
    let entries = await listOrNotFound('');
    let key = '';
    for (const [i, segment] of segments.entries()) {
      key = key ? `${key}/${segment}` : segment;
      if (!entries.some((entry) => entry.key === key && entry.kind === 'folder')) throw new PostError('not-found');
      entries = await listOrNotFound(key);
      if (i < segments.length - 1 && has(entries, `${key}/${DRAFT}`)) throw new PostError('not-found');
    }
    if (!has(entries, `${key}/${DRAFT}`)) throw new PostError('not-found');
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

  // The title in the post's .post.json, or the folder's last segment, or Untitled. Whether .post.json is a regular file
  // is read from the folder's listing, never left to read, which does not refuse a folder.
  async function titleOf(id: string, entries: FileEntry[]): Promise<string> {
    const fallback = lastSegment(id).trim() !== '' ? lastSegment(id) : 'Untitled';
    if (!has(entries, `${id}/${META}`)) return fallback;
    let text: string;
    try {
      text = await fileSystem.read(`${id}/${META}`);
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

  // Removes a half-made post folder, but only when it holds nothing but the store's own files, so nobody else's file is
  // ever lost. Any failure here is dropped: the caller rethrows the error that made the cleanup necessary.
  async function removeIfOnlyOurs(id: string): Promise<void> {
    try {
      const entries = await fileSystem.list(id);
      if (entries.every((entry) => [META, DRAFT].includes(lastSegment(entry.key)))) await fileSystem.delete(id);
    } catch {}
  }

  // .post.json holds the title and nothing else, one line, written whole.
  function writeTitle(id: string, title: string): Promise<void> {
    return fileSystem.write(`${id}/${META}`, `${JSON.stringify({ title })}\n`, { atomic: true });
  }

  // The first of name, `name 2`, `name 3`, … that is free, made at the root, as the id list will report it. The
  // exclusive createFolder keeps two creates, even in two processes, from sharing a folder.
  async function claimFolder(name: string): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? name : `${name} ${n}`;
      if (tombstones.has(candidate)) continue;
      try {
        await fileSystem.createFolder(candidate);
      } catch (error) {
        if (error instanceof FileSystemError && error.reason === 'exists') continue;
        throw error;
      }
      const id = await listedName(candidate);
      if (!tombstones.has(id)) return id;
      await fileSystem.delete(id);
    }
  }

  // The name the root listing gives the folder just made: exactly the candidate, or, on a disk that stores names in
  // another Unicode form (HFS+ stores NFD), the one folder whose NFC form matches.
  async function listedName(candidate: string): Promise<string> {
    const folders = (await fileSystem.list('')).filter((entry) => entry.kind === 'folder').map((entry) => entry.key);
    if (folders.includes(candidate)) return candidate;
    const matches = folders.filter((key) => key.normalize('NFC') === candidate.normalize('NFC'));
    if (matches.length === 1) return matches[0];
    await fileSystem.delete(candidate);
    throw new Error('Could not find the new post folder');
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
    async create({ title, body }) {
      if (title.trim() === '') throw new PostError('invalid');
      const id = await claimFolder(folderName(title));
      // Queued on the new id with no await since claiming it, so a call that finds the folder early waits for the post.
      return enqueue(id, async () => {
        try {
          // draft.md last: until it lands the folder is not a post, so a crash part-way leaves nothing listed.
          await writeTitle(id, title);
          await fileSystem.write(`${id}/${DRAFT}`, body);
        } catch (error) {
          await removeIfOnlyOurs(id);
          throw error;
        }
        return id;
      });
    },
    setBody(id, body) {
      return enqueue(id, async () => {
        await locatePost(id);
        await fileSystem.write(`${id}/${DRAFT}`, body);
      });
    },
    async setTitle(id, title) {
      if (title.trim() === '') throw new PostError('invalid');
      return enqueue(id, async () => {
        await locatePost(id);
        await writeTitle(id, title);
      });
    },
    delete(id) {
      return enqueue(id, async () => {
        await locatePost(id);
        // Tombstoned whatever the removal does: part of the folder may be gone even when it fails.
        try {
          await fileSystem.delete(id);
        } catch (error) {
          throw vanished(error);
        } finally {
          tombstones.add(id);
        }
      });
    },
    watch: notBuilt,
  };
}

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
    if (id === '' || segments.some(isHidden)) throw new PostError('not-found');
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
  // non-hidden folders only. Links are 'other' entries, so the walk never follows one.
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
        if (has(children, `${entry.key}/${DRAFT}`)) posts.push({ id: entry.key, entries: children });
        else await visit(children);
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

  // .post.json holds the title and nothing else, one line, written whole.
  function writeTitle(id: string, title: string): Promise<void> {
    return fileSystem.write(`${id}/${META}`, `${JSON.stringify({ title })}\n`, { atomic: true });
  }

  // The first of name, `name 2`, `name 3`, … that is free, made at the root. The exclusive createFolder keeps two
  // creates, even in two processes, from sharing a folder.
  async function claimFolder(name: string): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? name : `${name} ${n}`;
      try {
        await fileSystem.createFolder(candidate);
        return candidate;
      } catch (error) {
        if (!(error instanceof FileSystemError && error.reason === 'exists')) throw error;
      }
    }
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
        return { id, title: await titleOf(id, entries), body: await fileSystem.read(`${id}/${DRAFT}`) };
      });
    },
    async create({ title, body }) {
      if (title.trim() === '') throw new PostError('invalid');
      const id = await claimFolder(newEntryName(title) || 'Untitled');
      await writeTitle(id, title);
      await fileSystem.write(`${id}/${DRAFT}`, body);
      return id;
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
    delete: notBuilt,
    watch: notBuilt,
  };
}

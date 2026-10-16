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

const has = (entries: FileEntry[], key: string) => entries.some((entry) => entry.key === key && entry.kind === 'file');

export function createFilePostStore(fileSystem: FileSystem): PostStore {
  const notBuilt = () => {
    throw new Error('not built yet');
  };

  // The listing of the post folder an id names, or PostError 'not-found'.
  async function locatePost(id: string): Promise<FileEntry[]> {
    if (id === '') throw new PostError('not-found');
    const entries = await fileSystem.list(id).catch((error: unknown) => {
      if (error instanceof FileSystemError && (error.reason === 'not-found' || error.reason === 'invalid')) {
        throw new PostError('not-found');
      }
      throw error;
    });
    if (!has(entries, `${id}/${DRAFT}`)) throw new PostError('not-found');
    return entries;
  }

  async function titleOf(id: string): Promise<string> {
    const value = JSON.parse(await fileSystem.read(`${id}/${META}`));
    return value.title;
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
      const root = await fileSystem.list('');
      const posts = [];
      for (const entry of root) {
        if (entry.kind !== 'folder') continue;
        if (!has(await fileSystem.list(entry.key), `${entry.key}/${DRAFT}`)) continue;
        posts.push({ id: entry.key, title: await titleOf(entry.key) });
      }
      return { posts };
    },
    async get(id): Promise<Post> {
      await locatePost(id);
      return { id, title: await titleOf(id), body: await fileSystem.read(`${id}/${DRAFT}`) };
    },
    async create({ title, body }) {
      if (title.trim() === '') throw new PostError('invalid');
      const id = await claimFolder(newEntryName(title) || 'Untitled');
      await fileSystem.write(`${id}/${META}`, `${JSON.stringify({ title })}\n`, { atomic: true });
      await fileSystem.write(`${id}/${DRAFT}`, body);
      return id;
    },
    setBody: notBuilt,
    setTitle: notBuilt,
    delete: notBuilt,
    watch: notBuilt,
  };
}

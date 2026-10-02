// The local-disk backend: each key is a path below one root folder. Keys never pass through a symlink below the root,
// so a key always names the place it reads or writes. The root's own path is never checked, so a workspace opened
// through a link works.
import type { Stats } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile as nodeWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import type { EntryKind, FileSystem } from '../../file-system';
import { FileSystemError } from '../../components/file-system-error';
import { checkKey } from '../../components/keys';
import { watchLocal } from './watch';

// Synchronous and does no I/O. The root must be absolute.
export function createLocalFileSystem(root: string): FileSystem {
  if (!isAbsolute(root)) throw new Error(`${root} is not an absolute path`);
  return {
    location: root,
    async stat(key) {
      checkKey(key, { allowRoot: true });
      if (key === '') return kindOf(await stat(root).catch(() => undefined));
      const item = await locate(root, key);
      return item.parent === 'folder' ? kindOf(item.stats) : undefined;
    },
    async read(key) {
      checkKey(key);
      const { path, stats } = await locate(root, key);
      if (!stats) throw new FileSystemError('not-found', `${key} was not found`);
      refuseNonRegular(key, stats);
      return finalAct(readFile(path, 'utf8'), key);
    },
    write(key, text) {
      checkKey(key);
      return enqueue(join(root, key), () => writeFile(root, key, text));
    },
    async createFolder(key) {
      checkKey(key);
      const { path, parent, stats } = await locate(root, key);
      if (parent !== 'folder') throw new FileSystemError('not-found', `${dirname(key)} was not found`);
      if (stats) throw new FileSystemError('exists', `${key} already exists`);
      await finalAct(mkdir(path), key);
    },
    async list(key) {
      checkKey(key, { allowRoot: true });
      let path = root;
      if (key === '') {
        const stats = await stat(root).catch(() => undefined);
        if (!stats?.isDirectory()) throw new FileSystemError('not-found', 'the workspace root was not found');
      } else {
        const item = await locate(root, key);
        if (item.stats?.isSymbolicLink()) throw new FileSystemError('invalid', `${key} is a symlink`);
        if (item.parent !== 'folder' || !item.stats?.isDirectory()) {
          throw new FileSystemError('not-found', `${key} was not found`);
        }
        path = item.path;
      }
      const dirents = await finalAct(readdir(path, { withFileTypes: true }), key || 'the workspace root');
      return dirents.map((dirent) => ({
        key: key ? `${key}/${dirent.name}` : dirent.name,
        kind: dirent.isFile() ? 'file' : dirent.isDirectory() ? 'folder' : 'other',
      }));
    },
    async move(from, to) {
      checkKey(from);
      checkKey(to);
      await queuedUnder(join(root, from), join(root, to));
      const source = await locate(root, from);
      if (source.parent !== 'folder' || !source.stats) throw new FileSystemError('not-found', `${from} was not found`);
      if (to === from || to.startsWith(`${from}/`)) throw new FileSystemError('invalid', `${from} cannot move into itself`);
      const target = await locate(root, to);
      // Compared on disk too, so a letter-case variant of the source is still caught.
      const realSource = source.stats.isSymbolicLink()
        ? join(await realpath(dirname(source.path)), basename(source.path))
        : await realpath(source.path);
      const realTargetParent = await realpathOfNearest(dirname(target.path));
      if (realTargetParent === realSource || realTargetParent.startsWith(realSource + sep)) {
        throw new FileSystemError('invalid', `${from} cannot move into itself`);
      }
      // On a case-folding disk "A.md" finds "a.md" itself; only that same item may be renamed over.
      const sameItem = target.stats?.dev === source.stats.dev && target.stats?.ino === source.stats.ino;
      if (target.stats && !sameItem) throw new FileSystemError('exists', `${to} already exists`);
      if (target.parent !== 'folder') throw new FileSystemError('not-found', `${dirname(to)} was not found`);
      await finalAct(rename(source.path, target.path), from, to);
    },
    async delete(key) {
      checkKey(key);
      await queuedUnder(join(root, key));
      const { path, parent, stats } = await locate(root, key);
      if (parent !== 'folder' || !stats) throw new FileSystemError('not-found', `${key} was not found`);
      await finalAct(rm(path, { recursive: true }), key);
    },
    watch(listener, options = {}) {
      return watchLocal(root, listener, options);
    },
  };
}

// Every write in the process, keyed by its disk path, so writes to one key land in call order, even across instances
// on the same root. An entry is dropped once its last write settles.
const pending = new Map<string, Promise<void>>();

// For tests: how many disk paths still have writes queued.
export function pendingWriteCount(): number {
  return pending.size;
}

// Queues the write when called, before any await. A failed write rejects only its own caller.
function enqueue(path: string, write: () => Promise<void>): Promise<void> {
  const result = (pending.get(path) ?? Promise.resolve()).then(write);
  const tail = result.catch(() => {});
  pending.set(path, tail);
  tail.then(() => {
    if (pending.get(path) === tail) pending.delete(path);
  });
  return result;
}

// Waits for every write already queued at these paths or under them, so a save followed at once by a move or delete
// cannot bring back the old name.
async function queuedUnder(...paths: string[]) {
  const writes = [...pending].filter(([path]) => paths.some((p) => path === p || path.startsWith(p + sep)));
  await Promise.all(writes.map(([, write]) => write));
}

// The real path of a folder that may not exist yet: its nearest existing ancestor, resolved, plus the rest.
async function realpathOfNearest(path: string): Promise<string> {
  const real = await realpath(path).catch(() => undefined);
  if (real) return real;
  const parent = dirname(path);
  return parent === path ? path : join(await realpathOfNearest(parent), basename(path));
}

// The checks run before the act, so something else can change the disk in between. Such a race reads as the same
// refusal the checks give: gone is not-found (named by the source), taken is exists (named by the target). Every
// other system error passes through unchanged.
async function finalAct<T>(act: Promise<T>, key: string, target = key): Promise<T> {
  try {
    return await act;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new FileSystemError('not-found', `${key} was not found`);
    if (code === 'EEXIST') throw new FileSystemError('exists', `${target} already exists`);
    throw error;
  }
}

type Located = { path: string; parent: 'folder' | 'missing' | 'not-folder'; stats?: Stats };

// Walks the key's segments below the root. A link partway down is refused; a missing parent and a parent that is not a
// folder are told apart, because write creates the one and refuses the other.
async function locate(root: string, key: string): Promise<Located> {
  const segments = key.split('/');
  let path = root;
  for (const segment of segments.slice(0, -1)) {
    path = join(path, segment);
    const stats = await lstatOrUndefined(path);
    if (!stats) return { path: join(root, key), parent: 'missing' };
    if (stats.isSymbolicLink()) throw new FileSystemError('invalid', `${key} is outside the workspace`);
    if (!stats.isDirectory()) return { path: join(root, key), parent: 'not-folder' };
  }
  path = join(root, key);
  return { path, parent: 'folder', stats: await lstatOrUndefined(path) };
}

// Writes a temp file beside the target and renames it over, so a reader sees the old text or the new, never half.
async function writeFile(root: string, key: string, text: string) {
  const { path, parent, stats } = await locate(root, key);
  if (parent === 'not-folder') throw new FileSystemError('not-found', `${dirname(key)} was not found`);
  if (parent === 'missing') await mkdir(dirname(path), { recursive: true });
  if (stats) {
    refuseNonRegular(key, stats);
    if (stats.isDirectory()) throw new FileSystemError('invalid', `${key} is a folder`);
  }
  // The text is written out in full before the file is touched, so a failed write never damages it. Then it is
  // copied into the file itself, which keeps the same file: its links, attributes, and permissions all survive.
  const temp = join(tmpdir(), `3pitor-${process.pid}-${++temps}.tmp`);
  try {
    await Bun.write(temp, text);
    await copyInto(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

let temps = 0;

async function copyInto(temp: string, path: string) {
  await nodeWriteFile(path, await readFile(temp));
}

// read and write only ever open a regular file: a link's target could be anywhere, and a FIFO would hang the read.
function refuseNonRegular(key: string, stats: Stats) {
  if (stats.isSymbolicLink()) throw new FileSystemError('invalid', `${key} is a symlink`);
  if (!stats.isFile() && !stats.isDirectory()) throw new FileSystemError('invalid', `${key} is not a regular file`);
}

async function lstatOrUndefined(path: string): Promise<Stats | undefined> {
  return lstat(path).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return undefined;
    throw e;
  });
}

function kindOf(stats: Stats | undefined): EntryKind | undefined {
  if (!stats) return undefined;
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'folder';
  return 'other';
}

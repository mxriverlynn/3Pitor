// The local-disk backend: each key is a path below one root folder. Keys never pass through a symlink below the root,
// so a key always names the place it reads or writes. The root's own path is never checked, so a workspace opened
// through a link works.
import type { Stats } from 'node:fs';
import { access, chmod, constants, lstat, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { EntryKind, FileSystem } from '../../file-system';
import { FileSystemError } from '../../components/file-system-error';
import { checkKey } from '../../components/keys';

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
      return readFile(path, 'utf8');
    },
    write(key, text) {
      checkKey(key);
      return enqueue(join(root, key), () => writeFile(root, key, text));
    },
  } as FileSystem;
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
  let mode: number | undefined;
  if (stats) {
    refuseNonRegular(key, stats);
    if (stats.isDirectory()) throw new FileSystemError('invalid', `${key} is a folder`);
    // A read-only file stays refused, as an in-place write would be; the temp file takes the file's own mode.
    await access(path, constants.W_OK);
    mode = stats.mode & 0o7777;
  }
  // The process id keeps two servers on one workspace from sharing a temp file; the leading dot keeps it hidden.
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    await Bun.write(temp, text);
    if (mode !== undefined) await chmod(temp, mode);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
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

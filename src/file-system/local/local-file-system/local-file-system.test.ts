import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import * as fsPromises from 'node:fs/promises';
import { chmod, link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemError } from '../../components/file-system-error';
import { createLocalFileSystem, pendingWriteCount } from './local-file-system';

// mkdtemp's folder is reached through a link on macOS (/var → /private/var); the root's own components are never
// checked, so it works as given.
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), '3pitor-local-fs-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const refusal = (reason: string, message: string) => new FileSystemError(reason as never, message);

test('refuses a root that is not absolute, and reports the root exactly as given', () => {
  expect(() => createLocalFileSystem('relative/root')).toThrow('relative/root is not an absolute path');
  expect(createLocalFileSystem(root).location).toBe(root);
});

test('stat says what is at a key, without following links', async () => {
  await mkdir(join(root, 'drafts'));
  await writeFile(join(root, 'drafts', 'a.md'), 'a');
  await symlink(join(root, 'drafts', 'a.md'), join(root, 'link.md'));
  await symlink(join(root, 'drafts'), join(root, 'linked'));
  const fs = createLocalFileSystem(root);
  expect(await fs.stat('')).toBe('folder');
  expect(await fs.stat('drafts')).toBe('folder');
  expect(await fs.stat('drafts/a.md')).toBe('file');
  expect(await fs.stat('link.md')).toBe('other');
  expect(await fs.stat('missing.md')).toBeUndefined();
  expect(await fs.stat('drafts/a.md/b.md')).toBeUndefined();
  await expect(fs.stat('linked/a.md')).rejects.toThrow(refusal('invalid', 'linked/a.md is outside the workspace'));
});

test('works through a root that is itself a link', async () => {
  await mkdir(join(root, 'real'));
  await writeFile(join(root, 'real', 'a.md'), 'a');
  await symlink(join(root, 'real'), join(root, 'via'));
  const fs = createLocalFileSystem(join(root, 'via'));
  expect(await fs.stat('')).toBe('folder');
  expect(await fs.stat('a.md')).toBe('file');
});

test('read returns a file\'s text, and refuses what is missing, linked, or not a regular file', async () => {
  await writeFile(join(root, 'a.md'), 'hello');
  await symlink(join(root, 'a.md'), join(root, 'link.md'));
  Bun.spawnSync(['mkfifo', join(root, 'p.md')]);
  const fs = createLocalFileSystem(root);
  expect(await fs.read('a.md')).toBe('hello');
  await expect(fs.read('missing.md')).rejects.toThrow(refusal('not-found', 'missing.md was not found'));
  await expect(fs.read('a.md/b.md')).rejects.toThrow(refusal('not-found', 'a.md/b.md was not found'));
  await expect(fs.read('link.md')).rejects.toThrow(refusal('invalid', 'link.md is a symlink'));
  await expect(fs.read('p.md')).rejects.toThrow(refusal('invalid', 'p.md is not a regular file'));
  await expect(fs.read('../x.md')).rejects.toThrow(refusal('invalid', '"../x.md" is not a valid key'));
});

test('read of a folder fails with the system error, as before', async () => {
  await mkdir(join(root, 'x.md'));
  await expect(createLocalFileSystem(root).read('x.md')).rejects.toMatchObject({ code: 'EISDIR' });
});

test('write replaces a file whole, creating missing parent folders, and leaves no temp file behind', async () => {
  await writeFile(join(root, 'a.md'), 'old');
  const fs = createLocalFileSystem(root);
  await fs.write('a.md', 'new');
  await fs.write('new/folder/b.md', 'b');
  expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('new');
  expect(await readFile(join(root, 'new', 'folder', 'b.md'), 'utf8')).toBe('b');
  expect(await readdir(root)).toEqual(expect.not.arrayContaining([expect.stringMatching(/\.tmp$/)]));
});

test('write refuses a folder, a link, a non-regular file, and a path through a file', async () => {
  await mkdir(join(root, 'folder.md'));
  await writeFile(join(root, 'a.md'), 'a');
  await symlink(join(root, 'a.md'), join(root, 'link.md'));
  Bun.spawnSync(['mkfifo', join(root, 'p.md')]);
  const fs = createLocalFileSystem(root);
  await expect(fs.write('folder.md', 'x')).rejects.toThrow(refusal('invalid', 'folder.md is a folder'));
  await expect(fs.write('link.md', 'x')).rejects.toThrow(refusal('invalid', 'link.md is a symlink'));
  await expect(fs.write('p.md', 'x')).rejects.toThrow(refusal('invalid', 'p.md is not a regular file'));
  await expect(fs.write('a.md/b.md', 'x')).rejects.toThrow(refusal('not-found', 'a.md was not found'));
  expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('a');
});

test('write keeps the mode of an existing file, and leaves a read-only file unchanged', async () => {
  await writeFile(join(root, 'shared.md'), 'old');
  await chmod(join(root, 'shared.md'), 0o640);
  await writeFile(join(root, 'locked.md'), 'locked');
  await chmod(join(root, 'locked.md'), 0o444);
  const fs = createLocalFileSystem(root);
  await fs.write('shared.md', 'new');
  expect((await stat(join(root, 'shared.md'))).mode & 0o777).toBe(0o640);
  await expect(fs.write('locked.md', 'x')).rejects.toMatchObject({ code: 'EACCES' });
  expect(await readFile(join(root, 'locked.md'), 'utf8')).toBe('locked');
});

test('writes to one key, started without awaiting, land in call order and leave nothing queued', async () => {
  const fs = createLocalFileSystem(root);
  await Promise.all(Array.from({ length: 50 }, (_, n) => fs.write('a.md', `${n}`)));
  expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('49');
  expect(pendingWriteCount()).toBe(0);
});

test('two instances on one root share the write order', async () => {
  const one = createLocalFileSystem(root);
  const two = createLocalFileSystem(root);
  const writes = Array.from({ length: 20 }, (_, n) => (n % 2 ? one : two).write('a.md', `${n}`));
  await Promise.all(writes);
  expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('19');
});

// The local file system's own temp files for this process, in the system temp folder.
const ownTemps = async () => (await readdir(tmpdir())).filter((name) => name.startsWith(`3pitor-${process.pid}-`));

test('a failed write rejects for its own caller, removes its temp file, and a later write to the key still lands', async () => {
  const copy = spyOn(fsPromises, 'writeFile').mockImplementationOnce(() => Promise.reject(new Error('disk full')));
  try {
    const fs = createLocalFileSystem(root);
    const failed = fs.write('a.md', '1');
    const later = fs.write('a.md', '2');
    await expect(failed).rejects.toThrow('disk full');
    await later;
    expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('2');
    expect(await readdir(root)).toEqual(['a.md']);
    expect(await ownTemps()).toEqual([]);
  } finally {
    copy.mockRestore();
  }
});

test('a temp file that cannot be written leaves the original untouched', async () => {
  await writeFile(join(root, 'a.md'), 'original');
  const write = spyOn(Bun, 'write').mockImplementationOnce(() => Promise.reject(new Error('disk full')));
  try {
    await expect(createLocalFileSystem(root).write('a.md', 'new')).rejects.toThrow('disk full');
  } finally {
    write.mockRestore();
  }
  expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('original');
  expect(await ownTemps()).toEqual([]);
});

test('createFolder makes a folder under an existing one, and refuses a taken key or a missing parent', async () => {
  await writeFile(join(root, 'a.md'), 'a');
  const fs = createLocalFileSystem(root);
  await fs.createFolder('drafts');
  expect(await fs.stat('drafts')).toBe('folder');
  await expect(fs.createFolder('drafts')).rejects.toThrow(refusal('exists', 'drafts already exists'));
  await expect(fs.createFolder('missing/sub')).rejects.toThrow(refusal('not-found', 'missing was not found'));
  await expect(fs.createFolder('a.md/sub')).rejects.toThrow(refusal('not-found', 'a.md was not found'));
});

test('list gives the direct children of a folder with their kinds', async () => {
  await mkdir(join(root, 'drafts'));
  await writeFile(join(root, 'drafts', 'a.md'), 'a');
  await writeFile(join(root, 'top.md'), 't');
  await symlink(join(root, 'top.md'), join(root, 'link.md'));
  const fs = createLocalFileSystem(root);
  const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
  expect((await fs.list('')).sort(byKey)).toEqual([
    { key: 'drafts', kind: 'folder' },
    { key: 'link.md', kind: 'other' },
    { key: 'top.md', kind: 'file' },
  ]);
  expect(await fs.list('drafts')).toEqual([{ key: 'drafts/a.md', kind: 'file' }]);
  await expect(fs.list('missing')).rejects.toThrow(refusal('not-found', 'missing was not found'));
  await expect(fs.list('top.md')).rejects.toThrow(refusal('not-found', 'top.md was not found'));
  await expect(fs.list('link.md')).rejects.toThrow(refusal('invalid', 'link.md is a symlink'));
});

test('list of a missing root is not-found', async () => {
  const fs = createLocalFileSystem(join(root, 'gone'));
  await expect(fs.list('')).rejects.toThrow(refusal('not-found', 'the workspace root was not found'));
});

// True on a disk that folds letter case (the macOS default), where "A.md" finds "a.md".
async function foldsCase(folder: string) {
  await writeFile(join(folder, 'case-probe'), '');
  const folds = await stat(join(folder, 'CASE-PROBE')).then(() => true, () => false);
  await rm(join(folder, 'case-probe'));
  return folds;
}

test('move renames files and folders, and moves a link as a link', async () => {
  await mkdir(join(root, 'drafts'));
  await writeFile(join(root, 'drafts', 'a.md'), 'a');
  await writeFile(join(root, 'b.md'), 'b');
  await symlink(join(root, 'b.md'), join(root, 'link.md'));
  const fs = createLocalFileSystem(root);
  await fs.move('drafts', 'posts');
  await fs.move('b.md', 'posts/b.md');
  await fs.move('link.md', 'posts/link.md');
  expect(await readFile(join(root, 'posts', 'a.md'), 'utf8')).toBe('a');
  expect(await fs.stat('posts/b.md')).toBe('file');
  expect(await fs.stat('posts/link.md')).toBe('other');
  expect(await fs.stat('drafts')).toBeUndefined();
});

test('move refuses a missing source, a move into itself, a taken target, and a missing target parent', async () => {
  await mkdir(join(root, 'a', 'sub'), { recursive: true });
  await writeFile(join(root, 'x.md'), 'x');
  await writeFile(join(root, 'y.md'), 'y');
  const fs = createLocalFileSystem(root);
  await expect(fs.move('missing.md', 'z.md')).rejects.toThrow(refusal('not-found', 'missing.md was not found'));
  await expect(fs.move('a', 'a')).rejects.toThrow(refusal('invalid', 'a cannot move into itself'));
  await expect(fs.move('a', 'a/sub/a')).rejects.toThrow(refusal('invalid', 'a cannot move into itself'));
  await expect(fs.move('x.md', 'y.md')).rejects.toThrow(refusal('exists', 'y.md already exists'));
  await expect(fs.move('x.md', 'nope/x.md')).rejects.toThrow(refusal('not-found', 'nope was not found'));
  expect(await readFile(join(root, 'y.md'), 'utf8')).toBe('y');
});

test('move on a case-folding disk renames by letter case, and catches a move into itself under another case', async () => {
  if (!(await foldsCase(root))) return;
  await mkdir(join(root, 'real', 'a', 'sub'), { recursive: true });
  await writeFile(join(root, 'real', 'a.md'), 'a');
  await symlink(join(root, 'real'), join(root, 'via'));
  const fs = createLocalFileSystem(join(root, 'via'));
  await fs.move('a.md', 'A.md');
  expect(await readdir(join(root, 'real'))).toContain('A.md');
  await expect(fs.move('a', 'A/sub/a')).rejects.toThrow(refusal('invalid', 'a cannot move into itself'));
});

test('delete removes a file, a folder with everything in it, or a link as a link', async () => {
  await mkdir(join(root, 'drafts', 'deep'), { recursive: true });
  await writeFile(join(root, 'drafts', 'deep', 'a.md'), 'a');
  await writeFile(join(root, 'b.md'), 'b');
  await symlink(join(root, 'b.md'), join(root, 'link.md'));
  const fs = createLocalFileSystem(root);
  await fs.delete('drafts');
  await fs.delete('link.md');
  expect((await readdir(root)).sort()).toEqual(['b.md']);
  await fs.delete('b.md');
  await expect(fs.delete('b.md')).rejects.toThrow(refusal('not-found', 'b.md was not found'));
});

test('a write followed at once by a move or delete never brings back the old name', async () => {
  const fs = createLocalFileSystem(root);
  await fs.write('drafts/a.md', 'a');
  const saved = fs.write('drafts/a.md', 'again');
  const moved = fs.move('drafts', 'posts');
  await Promise.all([saved, moved]);
  const removed = [fs.write('b.md', 'b'), fs.delete('posts')];
  await Promise.allSettled(removed);
  expect((await readdir(root)).sort()).toEqual(['b.md']);
});

test('a race after the checks reports not-found or exists, and passes other system errors through', async () => {
  await writeFile(join(root, 'a.md'), 'a');
  const fs = createLocalFileSystem(root);
  const failWith = (code: string) => Promise.reject(Object.assign(new Error(code), { code }));
  const rename = spyOn(fsPromises, 'rename')
    .mockImplementationOnce(() => failWith('ENOENT'))
    .mockImplementationOnce(() => failWith('EEXIST'))
    .mockImplementationOnce(() => failWith('EACCES'));
  try {
    await expect(fs.move('a.md', 'b.md')).rejects.toThrow(refusal('not-found', 'a.md was not found'));
    await expect(fs.move('a.md', 'b.md')).rejects.toThrow(refusal('exists', 'b.md already exists'));
    await expect(fs.move('a.md', 'b.md')).rejects.toMatchObject({ code: 'EACCES' });
  } finally {
    rename.mockRestore();
  }
});

test('watch reports changes under the root, and stops when unsubscribed', async () => {
  const fs = createLocalFileSystem(root);
  const batches: unknown[] = [];
  const unsubscribe = fs.watch((batch) => batches.push(batch));
  try {
    await Bun.sleep(300);
    batches.length = 0;
    await writeFile(join(root, 'a.md'), 'a');
    for (let waited = 0; batches.length === 0 && waited < 3000; waited += 10) await Bun.sleep(10);
    expect(batches[0]).toEqual([{ type: 'created', key: 'a.md', kind: 'file' }]);
  } finally {
    unsubscribe();
  }
});

test('a save keeps the same file, so a hard link to it sees the new text', async () => {
  await writeFile(join(root, 'a.md'), 'old');
  await link(join(root, 'a.md'), join(root, 'hard-link.md'));
  const before = await stat(join(root, 'a.md'));
  await createLocalFileSystem(root).write('a.md', 'new');
  expect((await stat(join(root, 'a.md'))).ino).toBe(before.ino);
  expect(await readFile(join(root, 'hard-link.md'), 'utf8')).toBe('new');
});

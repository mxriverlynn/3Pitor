import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import * as fsPromises from 'node:fs/promises';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
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

test('a failed write rejects for its own caller, removes its temp file, and a later write to the key still lands', async () => {
  const rename = spyOn(fsPromises, 'rename').mockImplementationOnce(() => Promise.reject(new Error('disk full')));
  try {
    const fs = createLocalFileSystem(root);
    const failed = fs.write('a.md', '1');
    const later = fs.write('a.md', '2');
    await expect(failed).rejects.toThrow('disk full');
    await later;
    expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('2');
    expect(await readdir(root)).toEqual(['a.md']);
  } finally {
    rename.mockRestore();
  }
});
